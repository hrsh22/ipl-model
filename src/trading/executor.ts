import { validateTradingRecipe, type TradingSide, type ValidatedTradingRecipe } from "./config.js"
import type {
  PolymarketCreateOrderRequest,
  PolymarketOrderRecord,
  PolymarketTradeRecord,
  PolymarketTradingAdapter,
  PolymarketUserUpdate,
} from "./polymarket-adapter.js"
import { PolymarketAdapterError } from "./polymarket-adapter.js"
import {
  appendTradingExecutionEvent,
  appendTradingExposureLedgerEntry,
  claimNextTradeIntent,
  getTradeIntentById,
  getTradingReconciliationCheckpoint,
  getTradingRecipe,
  listTradingExecutionEvents,
  listTradingExposureLedgerEntries,
  type AppendTradingExecutionEventInput,
  type AppendTradingExposureLedgerInput,
  type TradeIntentStatus,
  type TradingExecutionEventRecord,
  type TradingExposureLedgerRecord,
  type TradingIntentRecord,
  type TradingRecipeRecord,
  upsertTradingReconciliationCheckpoint,
  updateTradeIntentStatus,
} from "./repository.js"
import {
  assertTradeExecutionTransition,
  evaluateTradeIntentPolicy,
  reduceTradeExecutionState,
  type EvaluateTradeIntentPolicyResult,
  type TradeExecutionState,
  type TradingExposureDayWindow,
} from "./policy.js"
import type { TradingReadinessResult } from "./config.js"
import {
  buildReconciliationCheckpointCursor,
  buildTradingVenueSnapshot,
  calculateExposureAdjustments,
  extractClientOrderId,
  extractKnownOrderId,
  getUserUpdateOrder,
  getUserUpdateTrade,
  isActiveVenueState,
  type TradingReconciliationSource,
  type TradingVenueSnapshot,
} from "./reconciliation.js"

export interface TradingExecutorEvaluationContext {
  readiness: TradingReadinessResult
  marketStatus: "open" | "closed" | "halted"
  currentTokenId: string | null
  balanceAvailableUsd: number | null
  matchStateAgeMs: number | null
  maxMatchStateAgeMs: number
  bookAgeMs: number | null
  maxBookAgeMs: number
  dayWindow: TradingExposureDayWindow
}

export interface TradingExecutorStore {
  claimNextTradeIntent(params: { workerId: string; leaseMs: number; now: Date }): Promise<TradingIntentRecord | null>
  getTradeIntentById(intentId: number): Promise<TradingIntentRecord | null>
  getTradingRecipe(recipeKey: string): Promise<TradingRecipeRecord | null>
  listTradingExecutionEvents(intentId: number): Promise<TradingExecutionEventRecord[]>
  listTradingExposureLedgerEntries(): Promise<TradingExposureLedgerRecord[]>
  appendTradingExecutionEvent(input: AppendTradingExecutionEventInput): Promise<TradingExecutionEventRecord | null>
  appendTradingExposureLedgerEntry(
    input: AppendTradingExposureLedgerInput,
  ): Promise<TradingExposureLedgerRecord | null>
  updateTradeIntentStatus(input: {
    intentId: number
    status: TradeIntentStatus
    updatedAt?: Date
    lastErrorCode?: string | null
    lastErrorMessage?: string | null
    claimedBy?: string | null
    claimedAt?: Date | null
    claimExpiresAt?: Date | null
  }): Promise<TradingIntentRecord | null>
  getTradingReconciliationCheckpoint?(checkpointKey: string): Promise<{ lastCursor: string | null } | null>
  upsertTradingReconciliationCheckpoint?(input: {
    checkpointKey: string
    lastCursor?: string | null
    lastReconciledAt?: Date | null
    details?: Record<string, unknown> | null
  }): Promise<void>
}

export interface TradingExecutorDependencies {
  workerId: string
  leaseMs: number
  adapter: PolymarketTradingAdapter
  store?: TradingExecutorStore
  now?: () => Date
  buildEvaluationContext: (input: {
    intent: TradingIntentRecord
    recipe: TradingRecipeRecord | null
    now: Date
  }) => Promise<TradingExecutorEvaluationContext>
}

export type TradingExecutorOutcome =
  | {
      kind: "no-op"
      reason: "no-intent-available" | "intent-already-processed" | "intent-not-claimed"
    }
  | {
      kind: "blocked"
      intentId: number
      blockerCodes: string[]
      state: TradeExecutionState
    }
  | {
      kind: "dry-run-approved"
      intentId: number
      state: TradeExecutionState
      orderRequest: PolymarketCreateOrderRequest
      blockerCodes: []
    }
  | {
      kind: "submitted"
      intentId: number
      state: TradeExecutionState
      orderId: string
      blockerCodes: []
    }
  | {
      kind: "reconciled"
      intentId: number
      state: TradeExecutionState
      source: TradingReconciliationSource
      orderId: string | null
    }
  | {
      kind: "pending-reconciliation"
      intentId: number
      state: TradeExecutionState
      reason: string
    }

const databaseTradingExecutorStore: TradingExecutorStore = {
  claimNextTradeIntent: async ({ workerId, leaseMs, now }) => claimNextTradeIntent({ workerId, leaseMs, now }),
  getTradeIntentById,
  getTradingRecipe,
  listTradingExecutionEvents,
  listTradingExposureLedgerEntries: async () => listTradingExposureLedgerEntries(),
  appendTradingExecutionEvent,
  appendTradingExposureLedgerEntry,
  updateTradeIntentStatus,
  getTradingReconciliationCheckpoint,
  upsertTradingReconciliationCheckpoint,
}

const noOpStates = new Set<TradeExecutionState>(["blocked", "reconciled"])
const ambiguousSubmitErrorCodes = new Set(["REQUEST_TIMEOUT", "RATE_LIMITED", "NETWORK_ERROR", "DUPLICATE_ORDER"])
const completeableStates = new Set<TradeExecutionState>(["filled", "cancelled", "expired", "reconciled"])
const reconciliationCheckpointKey = "polymarket:user-updates"

const asRecipeContext = (context: unknown): Record<string, unknown> | null => {
  if (context && typeof context === "object" && !Array.isArray(context)) {
    return context as Record<string, unknown>
  }

  return null
}

const toValidatedTradingRecipe = (recipe: TradingRecipeRecord | null): ValidatedTradingRecipe | null => {
  if (!recipe) {
    return null
  }

  const validation = validateTradingRecipe({
    marketId: recipe.marketId,
    conditionId: recipe.conditionId,
    tokenId: recipe.tokenId,
    side: recipe.side as ValidatedTradingRecipe["side"],
    orderStyle: recipe.orderStyle as ValidatedTradingRecipe["orderStyle"],
    maxPrice: recipe.maxPrice,
    expiryEpochMs: recipe.expiryTime.getTime(),
    context: asRecipeContext(recipe.context),
  })

  return validation.ok ? validation.value : null
}

const roundUsd = (value: number) => Math.round(value * 100) / 100

const buildOrderRequest = (
  intent: TradingIntentRecord,
  recipe: ValidatedTradingRecipe,
  size: number,
): PolymarketCreateOrderRequest => ({
  marketId: recipe.marketId,
  conditionId: recipe.conditionId,
  tokenId: recipe.tokenId,
  side: recipe.side,
  orderStyle: recipe.orderStyle,
  price: recipe.maxPrice,
  size,
  expirationMs: recipe.expiryEpochMs,
  clientOrderId: intent.intentKey,
})

const summarizeBlockers = (decision: EvaluateTradeIntentPolicyResult) =>
  decision.blockers.map((blocker) => blocker.code).join(", ")

const uniqueByTradeId = (trades: PolymarketTradeRecord[]) => {
  const seen = new Set<string>()
  return trades.filter((trade) => {
    if (seen.has(trade.tradeId)) {
      return false
    }

    seen.add(trade.tradeId)
    return true
  })
}

export class TradingExecutor {
  private readonly dependencies: TradingExecutorDependencies
  private readonly store: TradingExecutorStore
  private readonly now: () => Date
  private userUpdateSubscriptionPromise: Promise<void> | null = null
  private userChannelConnected = false
  private readonly orderUpdatesByOrderId = new Map<string, PolymarketOrderRecord>()
  private readonly orderUpdatesByClientOrderId = new Map<string, PolymarketOrderRecord>()
  private readonly tradesByOrderId = new Map<string, PolymarketTradeRecord[]>()
  private readonly tradesByClientOrderId = new Map<string, PolymarketTradeRecord[]>()
  private lastUserUpdateCursor: string | null = null

  constructor(dependencies: TradingExecutorDependencies) {
    this.dependencies = dependencies
    this.store = dependencies.store ?? databaseTradingExecutorStore
    this.now = dependencies.now ?? (() => new Date())
    this.userChannelConnected = dependencies.adapter.mode !== "dry-run"
  }

  async processNextTradeIntent(): Promise<TradingExecutorOutcome> {
    const now = this.now()
    const claimed = await this.store.claimNextTradeIntent({
      workerId: this.dependencies.workerId,
      leaseMs: this.dependencies.leaseMs,
      now,
    })

    if (!claimed) {
      return {
        kind: "no-op",
        reason: "no-intent-available",
      }
    }

    return this.processClaimedTradeIntent(claimed)
  }

  async processClaimedTradeIntent(intent: TradingIntentRecord): Promise<TradingExecutorOutcome> {
    if (intent.status !== "claimed" && intent.status !== "submitted") {
      return {
        kind: "no-op",
        reason: "intent-not-claimed",
      }
    }

    const existingEvents = await this.store.listTradingExecutionEvents(intent.id)
    const currentState = reduceTradeExecutionState(existingEvents)
    if (currentState && noOpStates.has(currentState)) {
      return {
        kind: "no-op",
        reason: "intent-already-processed",
      }
    }

    const eventHistory = [...existingEvents]
    const recipeRecord = await this.store.getTradingRecipe(intent.recipeKey)
    const recipe = toValidatedTradingRecipe(recipeRecord)

    if (isActiveVenueState(currentState)) {
      await this.ensureUserUpdateSubscription()
      return this.reconcileActiveIntent({
        intent,
        recipe,
        currentState,
        eventHistory,
      })
    }

    const eventTime = this.now()
    const evaluationContext = await this.dependencies.buildEvaluationContext({
      intent,
      recipe: recipeRecord,
      now: eventTime,
    })
    const exposureEntries = await this.store.listTradingExposureLedgerEntries()
    const decision = evaluateTradeIntentPolicy({
      recipe,
      readiness: evaluationContext.readiness,
      balanceAvailableUsd: evaluationContext.balanceAvailableUsd,
      marketStatus: evaluationContext.marketStatus,
      currentTokenId: evaluationContext.currentTokenId,
      matchStateAgeMs: evaluationContext.matchStateAgeMs,
      maxMatchStateAgeMs: evaluationContext.maxMatchStateAgeMs,
      bookAgeMs: evaluationContext.bookAgeMs,
      maxBookAgeMs: evaluationContext.maxBookAgeMs,
      fixtureId: intent.fixtureId,
      exposureEntries,
      dayWindow: evaluationContext.dayWindow,
    })

    const statesToRecord = this.getStatesToRecord(existingEvents, decision.statePath)
    for (const state of statesToRecord) {
      await this.recordStateTransition(eventHistory, intent.id, eventTime, state, {
        ...(state === "approved" || state === "blocked"
          ? {
              allocationFraction: decision.allocationFraction,
              requestedNotionalUsd: decision.requestedNotionalUsd,
              requestedOrderSize: decision.requestedOrderSize,
              blockers: decision.blockers,
              exposureSummary: decision.exposureSummary,
            }
          : {}),
      })
    }

    if (!decision.approved || !recipe || decision.requestedNotionalUsd == null || decision.requestedOrderSize == null) {
      const primaryBlocker = decision.blockers[0]
      await this.store.updateTradeIntentStatus({
        intentId: intent.id,
        status: "failed",
        updatedAt: eventTime,
        lastErrorCode: primaryBlocker?.code ?? "RECIPE_INVALID",
        lastErrorMessage: primaryBlocker?.message ?? "Trade policy blocked execution",
        claimExpiresAt: null,
      })

      return {
        kind: "blocked",
        intentId: intent.id,
        blockerCodes: decision.blockers.map((blocker) => blocker.code),
        state: "blocked",
      }
    }

    const orderRequest = buildOrderRequest(intent, recipe, decision.requestedOrderSize)
    await this.recordStateTransition(eventHistory, intent.id, eventTime, "submitted", {
      dryRun: this.dependencies.adapter.mode !== "live",
      orderRequest,
      clientOrderId: intent.intentKey,
      allocationFraction: decision.allocationFraction,
      exposureSummary: decision.exposureSummary,
    })
    await this.store.updateTradeIntentStatus({
      intentId: intent.id,
      status: "submitted",
      updatedAt: eventTime,
      lastErrorCode: null,
      lastErrorMessage: null,
    })

    if (this.dependencies.adapter.mode === "dry-run") {
      await this.recordDryRunAcknowledgement(
        eventHistory,
        intent,
        orderRequest,
        decision.requestedNotionalUsd,
        eventTime,
      )
      return {
        kind: "dry-run-approved",
        intentId: intent.id,
        state: "acknowledged",
        orderRequest,
        blockerCodes: [],
      }
    }

    await this.ensureUserUpdateSubscription()

    try {
      const venueOrder = await this.dependencies.adapter.createOrder(orderRequest)
      return this.recordLiveSubmission({
        intent,
        eventHistory,
        orderRequest,
        requestedNotionalUsd: decision.requestedNotionalUsd,
        venueOrder,
        eventTime,
      })
    } catch (error) {
      return this.handleCreateOrderFailure({
        intent,
        recipe,
        eventHistory,
        orderRequest,
        requestedNotionalUsd: decision.requestedNotionalUsd,
        error,
        eventTime,
      })
    }
  }

  private async recordLiveSubmission(input: {
    intent: TradingIntentRecord
    eventHistory: TradingExecutionEventRecord[]
    orderRequest: PolymarketCreateOrderRequest
    requestedNotionalUsd: number
    venueOrder: PolymarketOrderRecord
    eventTime: Date
  }): Promise<TradingExecutorOutcome> {
    this.indexOrderUpdate(input.venueOrder)

    const trades = await this.safeGetTradesForOrder(input.venueOrder.orderId)
    trades.forEach((trade) => this.indexTradeUpdate(trade))
    const snapshot = buildTradingVenueSnapshot({
      source: "submit-response",
      order: input.venueOrder,
      trades,
      requestedSize: input.orderRequest.size,
      requestedNotionalUsd: input.requestedNotionalUsd,
    })

    if (snapshot.nextState) {
      await this.recordStateTransition(input.eventHistory, input.intent.id, input.eventTime, snapshot.nextState, {
        dryRun: false,
        order: input.venueOrder,
        trades,
        source: snapshot.source,
      })
    }

    await this.store.appendTradingExposureLedgerEntry({
      intentId: input.intent.id,
      fixtureId: input.intent.fixtureId,
      marketId: input.intent.marketId,
      tokenId: input.intent.tokenId,
      side: input.intent.side as TradingSide,
      entryType: "submitted_notional",
      notionalUsd: input.requestedNotionalUsd,
      quantity: input.orderRequest.size,
      eventTime: input.eventTime,
      details: { dryRun: false, orderId: input.venueOrder.orderId },
    })

    await this.applyExposureSnapshot(input.intent, snapshot, input.eventTime)
    await this.finalizeCompletedIntentIfNeeded(input.intent.id, input.eventHistory, snapshot, input.eventTime)

    return {
      kind: "submitted",
      intentId: input.intent.id,
      state: reduceTradeExecutionState(input.eventHistory) ?? "submitted",
      orderId: input.venueOrder.orderId,
      blockerCodes: [],
    }
  }

  private async handleCreateOrderFailure(input: {
    intent: TradingIntentRecord
    recipe: ValidatedTradingRecipe
    eventHistory: TradingExecutionEventRecord[]
    orderRequest: PolymarketCreateOrderRequest
    requestedNotionalUsd: number
    error: unknown
    eventTime: Date
  }): Promise<TradingExecutorOutcome> {
    if (!(input.error instanceof PolymarketAdapterError)) {
      throw input.error
    }

    await this.store.updateTradeIntentStatus({
      intentId: input.intent.id,
      status: ambiguousSubmitErrorCodes.has(input.error.code) ? "submitted" : "failed",
      updatedAt: input.eventTime,
      lastErrorCode: input.error.code,
      lastErrorMessage: input.error.message,
      ...(ambiguousSubmitErrorCodes.has(input.error.code)
        ? {}
        : {
            claimedBy: null,
            claimedAt: null,
            claimExpiresAt: null,
          }),
    })

    if (!ambiguousSubmitErrorCodes.has(input.error.code)) {
      await this.recordStateTransition(input.eventHistory, input.intent.id, input.eventTime, "reconciled", {
        source: "submit-response",
        orderRequest: input.orderRequest,
        errorCode: input.error.code,
        message: input.error.message,
      })
      throw input.error
    }

    const duplicateOrderId = this.readDuplicateOrderId(input.error)
    if (duplicateOrderId) {
      await this.recordStateTransition(input.eventHistory, input.intent.id, input.eventTime, "acknowledged", {
        source: "submit-response",
        duplicateOfOrderId: duplicateOrderId,
        errorCode: input.error.code,
      })
    }

    const outcome = await this.reconcileActiveIntent({
      intent: input.intent,
      recipe: input.recipe,
      currentState: reduceTradeExecutionState(input.eventHistory) ?? "submitted",
      eventHistory: input.eventHistory,
      orderIdHint: duplicateOrderId,
      reason: input.error.code,
    })

    if (outcome.kind === "pending-reconciliation") {
      return outcome
    }

    return outcome
  }

  private async reconcileActiveIntent(input: {
    intent: TradingIntentRecord
    recipe: ValidatedTradingRecipe | null
    currentState: TradeExecutionState
    eventHistory: TradingExecutionEventRecord[]
    orderIdHint?: string | null
    reason?: string
  }): Promise<TradingExecutorOutcome> {
    const eventTime = this.now()
    const orderRequest = this.extractLatestOrderRequest(input.eventHistory)
    const requestedSize = orderRequest?.size ?? null
    const requestedNotionalUsd = orderRequest ? roundUsd(orderRequest.price * orderRequest.size) : null

    if (requestedSize == null || requestedNotionalUsd == null) {
      return {
        kind: "pending-reconciliation",
        intentId: input.intent.id,
        state: input.currentState,
        reason: input.reason ?? "missing-order-shape",
      }
    }

    const clientOrderId = extractClientOrderId(input.eventHistory) ?? input.intent.intentKey
    const knownOrderId = input.orderIdHint ?? extractKnownOrderId(input.eventHistory)
    const snapshot =
      (this.userChannelConnected
        ? this.buildSnapshotFromUserUpdates({
            knownOrderId,
            clientOrderId,
            requestedSize,
            requestedNotionalUsd,
          })
        : null) ??
      (await this.buildSnapshotFromRest({
        intent: input.intent,
        knownOrderId,
        clientOrderId,
        requestedSize,
        requestedNotionalUsd,
      }))

    await this.persistReconciliationCheckpoint(snapshot, eventTime, {
      intentId: input.intent.id,
      knownOrderId,
      clientOrderId,
      connected: this.userChannelConnected,
      reason: input.reason ?? null,
    })

    if (!snapshot || !snapshot.nextState) {
      return {
        kind: "pending-reconciliation",
        intentId: input.intent.id,
        state: input.currentState,
        reason: input.reason ?? "awaiting-authoritative-venue-state",
      }
    }

    if (snapshot.nextState !== input.currentState) {
      await this.recordStateTransition(input.eventHistory, input.intent.id, eventTime, snapshot.nextState, {
        source: snapshot.source,
        order: snapshot.order,
        trades: snapshot.trades,
        orderId: snapshot.orderId,
        clientOrderId: snapshot.clientOrderId,
      })
    }

    await this.ensureSubmittedNotionalRecorded(input.intent, requestedSize, requestedNotionalUsd, eventTime, snapshot)
    await this.applyExposureSnapshot(input.intent, snapshot, eventTime)
    await this.finalizeCompletedIntentIfNeeded(input.intent.id, input.eventHistory, snapshot, eventTime)

    const state = reduceTradeExecutionState(input.eventHistory) ?? snapshot.nextState
    return {
      kind: "reconciled",
      intentId: input.intent.id,
      state,
      source: snapshot.source,
      orderId: snapshot.orderId,
    }
  }

  private async applyExposureSnapshot(
    intent: TradingIntentRecord,
    snapshot: TradingVenueSnapshot,
    eventTime: Date,
  ) {
    const allEntries = await this.store.listTradingExposureLedgerEntries()
    const intentEntries = allEntries.filter((entry) => entry.intentId === intent.id)
    const adjustments = calculateExposureAdjustments({
      entries: intentEntries,
      targetFilledNotionalUsd: snapshot.filledNotionalUsd,
      targetFilledQuantity: snapshot.filledQuantity,
      targetPendingNotionalUsd: snapshot.pendingNotionalUsd,
      targetPendingQuantity: snapshot.pendingQuantity,
    })

    for (const adjustment of adjustments) {
      await this.store.appendTradingExposureLedgerEntry({
        intentId: intent.id,
        fixtureId: intent.fixtureId,
        marketId: intent.marketId,
        tokenId: intent.tokenId,
        side: intent.side as TradingSide,
        entryType: adjustment.entryType,
        notionalUsd: adjustment.notionalDeltaUsd,
        quantity: adjustment.quantityDelta,
        eventTime,
        details: {
          source: snapshot.source,
          orderId: snapshot.orderId,
          clientOrderId: snapshot.clientOrderId,
        },
      })
    }
  }

  private async ensureSubmittedNotionalRecorded(
    intent: TradingIntentRecord,
    requestedSize: number,
    requestedNotionalUsd: number,
    eventTime: Date,
    snapshot: TradingVenueSnapshot,
  ) {
    const entries = await this.store.listTradingExposureLedgerEntries()
    const alreadyRecorded = entries.some(
      (entry) => entry.intentId === intent.id && entry.entryType === "submitted_notional",
    )

    if (alreadyRecorded) {
      return
    }

    await this.store.appendTradingExposureLedgerEntry({
      intentId: intent.id,
      fixtureId: intent.fixtureId,
      marketId: intent.marketId,
      tokenId: intent.tokenId,
      side: intent.side as TradingSide,
      entryType: "submitted_notional",
      notionalUsd: requestedNotionalUsd,
      quantity: requestedSize,
      eventTime,
      details: {
        source: snapshot.source,
        orderId: snapshot.orderId,
        clientOrderId: snapshot.clientOrderId,
      },
    })
  }

  private async finalizeCompletedIntentIfNeeded(
    intentId: number,
    eventHistory: TradingExecutionEventRecord[],
    snapshot: TradingVenueSnapshot,
    eventTime: Date,
  ) {
    const state = reduceTradeExecutionState(eventHistory)
    if (!state || !completeableStates.has(state)) {
      await this.store.updateTradeIntentStatus({
        intentId,
        status: "submitted",
        updatedAt: eventTime,
        lastErrorCode: null,
        lastErrorMessage: null,
      })
      return
    }

    if (state !== "reconciled") {
      await this.recordStateTransition(eventHistory, intentId, eventTime, "reconciled", {
        source: snapshot.source,
        order: snapshot.order,
        trades: snapshot.trades,
        orderId: snapshot.orderId,
        clientOrderId: snapshot.clientOrderId,
      })
    }

    await this.store.updateTradeIntentStatus({
      intentId,
      status: "completed",
      updatedAt: eventTime,
      claimedBy: null,
      claimedAt: null,
      claimExpiresAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    })
  }

  private async recordDryRunAcknowledgement(
    eventHistory: TradingExecutionEventRecord[],
    intent: TradingIntentRecord,
    orderRequest: PolymarketCreateOrderRequest,
    requestedNotionalUsd: number,
    eventTime: Date,
  ) {
    const intentSide = intent.side as TradingSide
    await this.recordStateTransition(eventHistory, intent.id, eventTime, "acknowledged", {
      dryRun: true,
      order: {
        orderId: `dry-run:${intent.intentKey}`,
        clientOrderId: intent.intentKey,
        wouldSubmit: orderRequest,
      },
    })
    await this.store.appendTradingExposureLedgerEntry({
      intentId: intent.id,
      fixtureId: intent.fixtureId,
      marketId: intent.marketId,
      tokenId: intent.tokenId,
      side: intentSide,
      entryType: "submitted_notional",
      notionalUsd: requestedNotionalUsd,
      quantity: orderRequest.size,
      eventTime,
      details: {
        dryRun: true,
        orderRequest,
      },
    })
    await this.store.appendTradingExposureLedgerEntry({
      intentId: intent.id,
      fixtureId: intent.fixtureId,
      marketId: intent.marketId,
      tokenId: intent.tokenId,
      side: intentSide,
      entryType: "pending_order",
      notionalUsd: requestedNotionalUsd,
      quantity: orderRequest.size,
      eventTime,
      details: {
        dryRun: true,
        orderRequest,
      },
    })
    await this.store.updateTradeIntentStatus({
      intentId: intent.id,
      status: "completed",
      updatedAt: eventTime,
      claimedBy: null,
      claimedAt: null,
      claimExpiresAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    })
  }

  private getStatesToRecord(
    existingEvents: TradingExecutionEventRecord[],
    targetPath: TradeExecutionState[],
  ): TradeExecutionState[] {
    const recordedStates = existingEvents
      .map((event) => event.eventType)
      .filter(
        (eventType): eventType is TradeExecutionState =>
          [
            "detected",
            "eligible",
            "blocked",
            "approved",
            "submitted",
            "acknowledged",
            "partial",
            "filled",
            "cancelled",
            "expired",
            "reconciled",
          ].includes(eventType),
      )

    return targetPath.filter((state) => !recordedStates.includes(state))
  }

  private async recordStateTransition(
    eventHistory: TradingExecutionEventRecord[],
    intentId: number,
    eventTime: Date,
    nextState: TradeExecutionState,
    details: Record<string, unknown>,
  ) {
    const currentState = reduceTradeExecutionState(eventHistory)
    if (currentState === nextState) {
      return
    }

    assertTradeExecutionTransition(currentState, nextState)
    const createdEvent = await this.store.appendTradingExecutionEvent({
      intentId,
      eventType: nextState,
      eventTime,
      executorId: this.dependencies.workerId,
      details,
    })
    eventHistory.push(
      createdEvent ??
        ({
          id: -1,
          intentId,
          eventType: nextState,
          eventTime,
          processedAt: eventTime,
          executorId: this.dependencies.workerId,
          details,
          createdAt: eventTime,
        } as TradingExecutionEventRecord),
    )
  }

  private async ensureUserUpdateSubscription() {
    if (this.dependencies.adapter.mode === "dry-run") {
      return
    }

    if (this.userUpdateSubscriptionPromise) {
      return this.userUpdateSubscriptionPromise
    }

    this.userUpdateSubscriptionPromise = (async () => {
      try {
        const checkpoint = await this.store.getTradingReconciliationCheckpoint?.(reconciliationCheckpointKey)
        this.lastUserUpdateCursor = checkpoint?.lastCursor ?? this.lastUserUpdateCursor
        await this.dependencies.adapter.subscribeUserUpdates((update) => this.handleUserUpdate(update))
        this.userChannelConnected = true
      } catch {
        this.userChannelConnected = false
      }
    })()

    return this.userUpdateSubscriptionPromise
  }

  private handleUserUpdate(update: PolymarketUserUpdate) {
    this.lastUserUpdateCursor = update.recordedAt

    if (update.type === "disconnect") {
      this.userChannelConnected = false
      return
    }

    if (update.type === "heartbeat") {
      this.userChannelConnected = true
      return
    }

    this.userChannelConnected = true
    const order = getUserUpdateOrder(update)
    if (order) {
      this.indexOrderUpdate(order)
    }

    const trade = getUserUpdateTrade(update)
    if (trade) {
      this.indexTradeUpdate(trade)
    }
  }

  private indexOrderUpdate(order: PolymarketOrderRecord) {
    this.orderUpdatesByOrderId.set(order.orderId, order)
    if (order.clientOrderId) {
      this.orderUpdatesByClientOrderId.set(order.clientOrderId, order)
    }
  }

  private indexTradeUpdate(trade: PolymarketTradeRecord) {
    const byOrder = this.tradesByOrderId.get(trade.orderId) ?? []
    this.tradesByOrderId.set(trade.orderId, uniqueByTradeId([...byOrder, trade]))

    if (trade.clientOrderId) {
      const byClientId = this.tradesByClientOrderId.get(trade.clientOrderId) ?? []
      this.tradesByClientOrderId.set(trade.clientOrderId, uniqueByTradeId([...byClientId, trade]))
    }
  }

  private buildSnapshotFromUserUpdates(input: {
    knownOrderId: string | null
    clientOrderId: string
    requestedSize: number
    requestedNotionalUsd: number
  }) {
    const order =
      (input.knownOrderId ? this.orderUpdatesByOrderId.get(input.knownOrderId) : null) ??
      this.orderUpdatesByClientOrderId.get(input.clientOrderId) ??
      null
    const trades = uniqueByTradeId([
      ...(input.knownOrderId ? this.tradesByOrderId.get(input.knownOrderId) ?? [] : []),
      ...(this.tradesByClientOrderId.get(input.clientOrderId) ?? []),
    ])

    if (!order && trades.length === 0) {
      return null
    }

    return buildTradingVenueSnapshot({
      source: "user-updates",
      order,
      trades,
      requestedSize: input.requestedSize,
      requestedNotionalUsd: input.requestedNotionalUsd,
    })
  }

  private async buildSnapshotFromRest(input: {
    intent: TradingIntentRecord
    knownOrderId: string | null
    clientOrderId: string
    requestedSize: number
    requestedNotionalUsd: number
  }) {
    try {
      let orderId = input.knownOrderId
      let order = orderId ? await this.dependencies.adapter.getOrder(orderId) : null
      let trades: PolymarketTradeRecord[] = []

      if (orderId) {
        trades = await this.dependencies.adapter.getTrades({ orderId })
      } else {
        const candidateTrades = await this.dependencies.adapter.getTrades({
          marketId: input.intent.marketId,
          tokenId: input.intent.tokenId,
        })
        trades = candidateTrades.filter((trade) => trade.clientOrderId === input.clientOrderId)
        orderId = trades[0]?.orderId ?? null
        order = orderId ? await this.dependencies.adapter.getOrder(orderId) : null
      }

      trades.forEach((trade) => this.indexTradeUpdate(trade))
      if (order) {
        this.indexOrderUpdate(order)
      }

      if (!order && trades.length === 0) {
        return null
      }

      return buildTradingVenueSnapshot({
        source: "rest-fallback",
        order,
        trades,
        requestedSize: input.requestedSize,
        requestedNotionalUsd: input.requestedNotionalUsd,
      })
    } catch {
      return null
    }
  }

  private async persistReconciliationCheckpoint(
    snapshot: TradingVenueSnapshot | null,
    eventTime: Date,
    details: Record<string, unknown>,
  ) {
    await this.store.upsertTradingReconciliationCheckpoint?.({
      checkpointKey: reconciliationCheckpointKey,
      lastCursor: buildReconciliationCheckpointCursor(snapshot) ?? this.lastUserUpdateCursor,
      lastReconciledAt: eventTime,
      details: {
        ...details,
        source: snapshot?.source ?? null,
        state: snapshot?.nextState ?? null,
        orderId: snapshot?.orderId ?? null,
      },
    })
  }

  private extractLatestOrderRequest(eventHistory: TradingExecutionEventRecord[]) {
    for (const event of [...eventHistory].reverse()) {
      const details = event.details as Record<string, unknown>
      const orderRequest = details.orderRequest as PolymarketCreateOrderRequest | undefined
      if (orderRequest) {
        return orderRequest
      }
    }

    return null
  }

  private readDuplicateOrderId(error: PolymarketAdapterError) {
    const details = error.safeContext.details as Record<string, unknown> | null
    const duplicateOfOrderId = details?.duplicateOfOrderId
    return typeof duplicateOfOrderId === "string" && duplicateOfOrderId.trim() ? duplicateOfOrderId : null
  }

  private async safeGetTradesForOrder(orderId: string) {
    try {
      return await this.dependencies.adapter.getTrades({ orderId })
    } catch {
      return []
    }
  }
}

export const formatTradeExecutorEvidence = (decision: EvaluateTradeIntentPolicyResult) => {
  const status = decision.approved ? "approved" : `blocked: ${summarizeBlockers(decision)}`
  return [
    `status=${status}`,
    `requestedNotionalUsd=${decision.requestedNotionalUsd ?? "null"}`,
    `statePath=${decision.statePath.join(" -> ")}`,
    `daySubmittedNotionalUsd=${decision.exposureSummary.daySubmittedNotionalUsd}`,
    `dayPendingOrdersUsd=${decision.exposureSummary.dayPendingOrdersUsd}`,
    `totalOpenExposureUsd=${decision.exposureSummary.totalOpenExposureUsd}`,
    `totalFilledExposureUsd=${decision.exposureSummary.totalFilledExposureUsd}`,
  ].join("\n")
}
