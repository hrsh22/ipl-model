import { describe, expect, test } from 'vitest'

import { TradingExecutor, type TradingExecutorEvaluationContext, type TradingExecutorStore } from '../src/trading/executor.js'
import { MockPolymarketTradingAdapter, buildPolymarketTradingAdapter } from '../src/trading/polymarket-adapter.js'
import {
  buildTradeIntentKey,
  type TradingExecutionEventRecord,
  type TradingExposureLedgerRecord,
  type TradingIntentRecord,
  type TradingRecipeRecord,
} from '../src/trading/repository.js'
import { calculateTradingExposureSummary } from '../src/trading/policy.js'
import { validateTradingRecipe, type TradingReadinessResult } from '../src/trading/config.js'

const FIXED_NOW = new Date('2026-05-11T10:00:00.000Z')
const DAY_START = new Date('2026-05-11T00:00:00.000Z')
const DAY_END = new Date('2026-05-12T00:00:00.000Z')

const buildValidatedRecipe = () => {
  const result = validateTradingRecipe({
    marketId: 'market-1',
    conditionId: 'condition-1',
    tokenId: 'token-1',
    side: 'buy',
    orderStyle: 'limit',
    maxPrice: 0.42,
    expiryEpochMs: new Date('2026-05-11T12:00:00.000Z').getTime(),
  })

  if (!result.ok) {
    throw new Error(`Expected valid recipe fixture: ${result.errors.join(', ')}`)
  }

  return result.value
}

const buildRecipeRecord = (overrides: Partial<TradingRecipeRecord> = {}): TradingRecipeRecord => ({
  recipeKey: overrides.recipeKey ?? 'recipe:11-over:v1',
  strategyKey: overrides.strategyKey ?? 'eleven-over',
  recipeVersion: overrides.recipeVersion ?? '2026-05-11-v1',
  windowKey: overrides.windowKey ?? '2026-05-11-v1:fixture-1:innings-2:balls-66-72',
  fixtureId: overrides.fixtureId ?? 'fixture-1',
  marketId: overrides.marketId ?? 'market-1',
  conditionId: overrides.conditionId ?? 'condition-1',
  tokenId: overrides.tokenId ?? 'token-1',
  side: overrides.side ?? 'buy',
  orderStyle: overrides.orderStyle ?? 'limit',
  maxPrice: overrides.maxPrice ?? 0.42,
  size: overrides.size ?? 952.380952,
  expiryTime: overrides.expiryTime ?? new Date('2026-05-11T12:00:00.000Z'),
  context: overrides.context ?? { strategy: '11-over' },
  createdAt: overrides.createdAt ?? FIXED_NOW,
  updatedAt: overrides.updatedAt ?? FIXED_NOW,
})

const buildIntentRecord = (overrides: Partial<TradingIntentRecord> = {}): TradingIntentRecord => {
  const base = {
    recipeKey: 'recipe:11-over:v1',
    strategyKey: 'eleven-over',
    recipeVersion: '2026-05-11-v1',
    windowKey: '2026-05-11-v1:fixture-1:innings-2:balls-66-72',
    fixtureId: 'fixture-1',
    marketId: 'market-1',
    conditionId: 'condition-1',
    tokenId: 'token-1',
    side: 'buy',
  } as const

  return {
    id: overrides.id ?? 1,
    intentKey:
      overrides.intentKey ??
      buildTradeIntentKey({
        strategyKey: overrides.strategyKey ?? base.strategyKey,
        recipeVersion: overrides.recipeVersion ?? base.recipeVersion,
        windowKey: overrides.windowKey ?? base.windowKey,
        fixtureId: overrides.fixtureId ?? base.fixtureId,
        marketId: overrides.marketId ?? base.marketId,
        tokenId: overrides.tokenId ?? base.tokenId,
        side: (overrides.side ?? base.side) as 'buy' | 'sell',
      }),
    recipeKey: overrides.recipeKey ?? base.recipeKey,
    strategyKey: overrides.strategyKey ?? base.strategyKey,
    recipeVersion: overrides.recipeVersion ?? base.recipeVersion,
    windowKey: overrides.windowKey ?? base.windowKey,
    fixtureId: overrides.fixtureId ?? base.fixtureId,
    marketId: overrides.marketId ?? base.marketId,
    conditionId: overrides.conditionId ?? base.conditionId,
    tokenId: overrides.tokenId ?? base.tokenId,
    side: overrides.side ?? base.side,
    status: overrides.status ?? 'claimed',
    claimCount: overrides.claimCount ?? 1,
    claimedBy: 'claimedBy' in overrides ? overrides.claimedBy ?? null : 'worker-1',
    claimedAt: 'claimedAt' in overrides ? overrides.claimedAt ?? null : FIXED_NOW,
    claimExpiresAt:
      'claimExpiresAt' in overrides ? overrides.claimExpiresAt ?? null : new Date(FIXED_NOW.getTime() + 30_000),
    lastErrorCode: overrides.lastErrorCode ?? null,
    lastErrorMessage: overrides.lastErrorMessage ?? null,
    context: overrides.context ?? { signalId: 'signal-1' },
    createdAt: overrides.createdAt ?? FIXED_NOW,
    updatedAt: overrides.updatedAt ?? FIXED_NOW,
  }
}

const buildExecutionContext = (
  overrides: Partial<TradingExecutorEvaluationContext> = {},
): TradingExecutorEvaluationContext => ({
  readiness:
    overrides.readiness ??
    ({
      liveReady: true,
      mode: 'live',
      recipe: buildValidatedRecipe(),
      reasons: [],
    } satisfies TradingReadinessResult),
  marketStatus: overrides.marketStatus ?? 'open',
  currentTokenId: overrides.currentTokenId ?? 'token-1',
  balanceAvailableUsd: 'balanceAvailableUsd' in overrides ? overrides.balanceAvailableUsd ?? null : 2000,
  matchStateAgeMs: overrides.matchStateAgeMs ?? 2_000,
  maxMatchStateAgeMs: overrides.maxMatchStateAgeMs ?? 30_000,
  bookAgeMs: overrides.bookAgeMs ?? 2_000,
  maxBookAgeMs: overrides.maxBookAgeMs ?? 15_000,
  dayWindow: overrides.dayWindow ?? { start: DAY_START, end: DAY_END },
})

class InMemoryTradingExecutorStore implements TradingExecutorStore {
  intents: TradingIntentRecord[]
  recipes: TradingRecipeRecord[]
  events: TradingExecutionEventRecord[]
  exposures: TradingExposureLedgerRecord[]
  checkpoints = new Map<string, { lastCursor: string | null; details: Record<string, unknown> | null }>()
  private nextEventId = 1
  private nextExposureId = 1

  constructor(input?: {
    intents?: TradingIntentRecord[]
    recipes?: TradingRecipeRecord[]
    events?: TradingExecutionEventRecord[]
    exposures?: TradingExposureLedgerRecord[]
  }) {
    this.intents = [...(input?.intents ?? [])]
    this.recipes = [...(input?.recipes ?? [])]
    this.events = [...(input?.events ?? [])]
    this.exposures = [...(input?.exposures ?? [])]
  }

  async claimNextTradeIntent(params: { workerId: string; leaseMs: number; now: Date }) {
    const candidate = this.intents.find((intent) =>
      ['pending', 'claimed', 'submitted'].includes(intent.status) &&
      (intent.claimExpiresAt == null || intent.claimExpiresAt.getTime() <= params.now.getTime()),
    )
    if (!candidate) {
      return null
    }

    const claimed: TradingIntentRecord = {
      ...candidate,
      status: 'claimed',
      claimedBy: params.workerId,
      claimedAt: params.now,
      claimExpiresAt: new Date(params.now.getTime() + params.leaseMs),
      claimCount: candidate.claimCount + 1,
      updatedAt: params.now,
    }
    this.replaceIntent(claimed)
    return claimed
  }

  async getTradeIntentById(intentId: number) {
    return this.intents.find((intent) => intent.id === intentId) ?? null
  }

  async getTradingRecipe(recipeKey: string) {
    return this.recipes.find((recipe) => recipe.recipeKey === recipeKey) ?? null
  }

  async listTradingExecutionEvents(intentId: number) {
    return this.events.filter((event) => event.intentId === intentId)
  }

  async listTradingExposureLedgerEntries() {
    return [...this.exposures]
  }

  async appendTradingExecutionEvent(input: {
    intentId: number
    eventType: string
    eventTime: Date
    processedAt?: Date
    executorId?: string | null
    details?: Record<string, unknown>
  }) {
    const event: TradingExecutionEventRecord = {
      id: this.nextEventId++,
      intentId: input.intentId,
      eventType: input.eventType,
      eventTime: input.eventTime,
      processedAt: input.processedAt ?? input.eventTime,
      executorId: input.executorId ?? null,
      details: input.details ?? {},
      createdAt: input.eventTime,
    }
    this.events.push(event)
    return event
  }

  async appendTradingExposureLedgerEntry(input: {
    intentId?: number | null
    fixtureId: string
    marketId: string
    tokenId: string
    side: 'buy' | 'sell'
    entryType: string
    quantity?: number | null
    notionalUsd: number
    eventTime: Date
    processedAt?: Date
    details?: Record<string, unknown>
  }) {
    const entry: TradingExposureLedgerRecord = {
      id: this.nextExposureId++,
      intentId: input.intentId ?? null,
      fixtureId: input.fixtureId,
      marketId: input.marketId,
      tokenId: input.tokenId,
      side: input.side,
      entryType: input.entryType,
      quantity: input.quantity ?? null,
      notionalUsd: input.notionalUsd,
      eventTime: input.eventTime,
      processedAt: input.processedAt ?? input.eventTime,
      details: input.details ?? {},
      createdAt: input.eventTime,
    }
    this.exposures.push(entry)
    return entry
  }

  async updateTradeIntentStatus(input: {
    intentId: number
    status: 'pending' | 'claimed' | 'submitted' | 'completed' | 'failed'
    updatedAt?: Date
    lastErrorCode?: string | null
    lastErrorMessage?: string | null
    claimedBy?: string | null
    claimedAt?: Date | null
    claimExpiresAt?: Date | null
  }) {
    const current = this.intents.find((intent) => intent.id === input.intentId)
    if (!current) {
      return null
    }

    const updated: TradingIntentRecord = {
      ...current,
      status: input.status,
      updatedAt: input.updatedAt ?? current.updatedAt,
      lastErrorCode: 'lastErrorCode' in input ? input.lastErrorCode ?? null : current.lastErrorCode,
      lastErrorMessage:
        'lastErrorMessage' in input ? input.lastErrorMessage ?? null : current.lastErrorMessage,
      claimedBy: 'claimedBy' in input ? input.claimedBy ?? null : current.claimedBy,
      claimedAt: 'claimedAt' in input ? input.claimedAt ?? null : current.claimedAt,
      claimExpiresAt:
        'claimExpiresAt' in input ? input.claimExpiresAt ?? null : current.claimExpiresAt,
    }
    this.replaceIntent(updated)
    return updated
  }

  async getTradingReconciliationCheckpoint(checkpointKey: string) {
    return this.checkpoints.get(checkpointKey) ?? null
  }

  async upsertTradingReconciliationCheckpoint(input: {
    checkpointKey: string
    lastCursor?: string | null
    lastReconciledAt?: Date | null
    details?: Record<string, unknown> | null
  }) {
    this.checkpoints.set(input.checkpointKey, {
      lastCursor: input.lastCursor ?? null,
      details: input.details ?? null,
    })
  }

  private replaceIntent(intent: TradingIntentRecord) {
    const index = this.intents.findIndex((current) => current.id === intent.id)
    if (index >= 0) {
      this.intents[index] = intent
    } else {
      this.intents.push(intent)
    }
  }
}

const createLiveExecutor = (input?: {
  store?: InMemoryTradingExecutorStore
  adapter?: MockPolymarketTradingAdapter
  now?: () => Date
  context?: Partial<TradingExecutorEvaluationContext>
}) => {
  const store = input?.store ?? new InMemoryTradingExecutorStore({
    intents: [buildIntentRecord({ status: 'pending', claimCount: 0, claimedBy: null, claimedAt: null, claimExpiresAt: null })],
    recipes: [buildRecipeRecord()],
  })
  const adapter = input?.adapter ?? new MockPolymarketTradingAdapter()

  return {
    store,
    adapter,
    executor: new TradingExecutor({
      workerId: 'worker-1',
      leaseMs: 30_000,
      adapter,
      store,
      now: input?.now ?? (() => FIXED_NOW),
      buildEvaluationContext: async () => buildExecutionContext(input?.context),
    }),
  }
}

const createDryRunAdapter = () =>
  buildPolymarketTradingAdapter({
    readiness: {
      liveReady: false,
      mode: 'dry-run',
      reasons: [{ code: 'ENV_LIVE_GATE_DISABLED' }],
    },
  })

describe('trading executor dry-run policy engine', () => {
  test('records approved dry-run state transitions and would-submit payloads without live submission', async () => {
    const intent = buildIntentRecord({ status: 'pending', claimCount: 0, claimedBy: null, claimedAt: null, claimExpiresAt: null })
    const store = new InMemoryTradingExecutorStore({
      intents: [intent],
      recipes: [buildRecipeRecord()],
    })
    const adapter = createDryRunAdapter()
    const executor = new TradingExecutor({
      workerId: 'worker-1',
      leaseMs: 30_000,
      adapter,
      store,
      now: () => FIXED_NOW,
      buildEvaluationContext: async () => buildExecutionContext(),
    })

    const result = await executor.processNextTradeIntent()
    const updatedIntent = await store.getTradeIntentById(intent.id)

    expect(result).toMatchObject({
      kind: 'dry-run-approved',
      intentId: intent.id,
      state: 'acknowledged',
    })
    expect(store.events.map((event) => event.eventType)).toEqual([
      'detected',
      'eligible',
      'approved',
      'submitted',
      'acknowledged',
    ])
    expect(store.exposures.map((entry) => entry.entryType)).toEqual(['submitted_notional', 'pending_order'])
    expect(
      store.exposures.every(
        (entry) => (entry.details as Record<string, unknown> | null | undefined)?.dryRun === true,
      ),
    ).toBe(true)
    expect(updatedIntent?.status).toBe('completed')
    expect(updatedIntent?.lastErrorCode).toBeNull()
  })

  test('uses recipe allocation context for value and volume sizing while preserving legacy fallback', async () => {
    const cases: Array<{
      name: string
      recipe: TradingRecipeRecord
      expectedAllocationFraction: number
      expectedRequestedNotionalUsd: number
      expectedOrderSize: number
    }> = [
      {
        name: 'value mode allocation override',
        recipe: buildRecipeRecord({ maxPrice: 0.9, context: { strategyMode: 'value90', allocationFraction: 0.2 } }),
        expectedAllocationFraction: 0.2,
        expectedRequestedNotionalUsd: 200,
        expectedOrderSize: 222.222222,
      },
      {
        name: 'volume mode allocation override',
        recipe: buildRecipeRecord({ maxPrice: 0.95, context: { strategyMode: 'volume95', allocationFraction: 0.1 } }),
        expectedAllocationFraction: 0.1,
        expectedRequestedNotionalUsd: 100,
        expectedOrderSize: 105.263158,
      },
      {
        name: 'legacy fallback allocation',
        recipe: buildRecipeRecord({ maxPrice: 0.42, context: { strategy: '11-over' } }),
        expectedAllocationFraction: 0.2,
        expectedRequestedNotionalUsd: 200,
        expectedOrderSize: 476.190476,
      },
    ]

    for (const testCase of cases) {
      const intent = buildIntentRecord({ recipeKey: testCase.recipe.recipeKey })
      const store = new InMemoryTradingExecutorStore({ intents: [intent], recipes: [testCase.recipe] })
      const adapter = createDryRunAdapter()
      const executor = new TradingExecutor({
        workerId: 'worker-1',
        leaseMs: 30_000,
        adapter,
        store,
        now: () => FIXED_NOW,
        buildEvaluationContext: async () => buildExecutionContext({ balanceAvailableUsd: 1000 }),
      })

      const result = await executor.processClaimedTradeIntent(intent)
      const submitted = store.events.find((event) => event.eventType === 'submitted')

      expect(result, testCase.name).toMatchObject({ kind: 'dry-run-approved' })
      expect(result.kind === 'dry-run-approved' ? result.orderRequest : null, testCase.name).toMatchObject({
        price: testCase.recipe.maxPrice,
        size: testCase.expectedOrderSize,
      })
      expect(submitted?.details, testCase.name).toMatchObject({
        allocationFraction: testCase.expectedAllocationFraction,
        orderRequest: {
          size: testCase.expectedOrderSize,
          price: testCase.recipe.maxPrice,
        },
      })
      expect(store.exposures.map((entry) => [entry.entryType, entry.notionalUsd, entry.quantity]), testCase.name).toEqual([
        ['submitted_notional', testCase.expectedRequestedNotionalUsd, testCase.expectedOrderSize],
        ['pending_order', testCase.expectedRequestedNotionalUsd, testCase.expectedOrderSize],
      ])
    }
  })

  test('fails closed for the required blocker matrix', async () => {
    const cases: Array<{
      name: string
      recipe?: TradingRecipeRecord
      context?: Partial<TradingExecutorEvaluationContext>
      exposures?: TradingExposureLedgerRecord[]
      expectedCode: string
    }> = [
      { name: 'stale match state', context: { matchStateAgeMs: 45_000 }, expectedCode: 'STALE_MATCH_STATE' },
      { name: 'stale book', context: { bookAgeMs: 20_000 }, expectedCode: 'STALE_BOOK' },
      {
        name: 'missing env gate',
        context: { readiness: { liveReady: false, mode: 'dry-run', reasons: [{ code: 'ENV_LIVE_GATE_DISABLED' }] } },
        expectedCode: 'ENV_LIVE_GATE_DISABLED',
      },
      {
        name: 'missing credentials',
        context: { readiness: { liveReady: false, mode: 'dry-run', reasons: [{ code: 'POLYMARKET_CREDENTIALS_MISSING' }] } },
        expectedCode: 'POLYMARKET_CREDENTIALS_MISSING',
      },
      { name: 'token mismatch', context: { currentTokenId: 'token-other' }, expectedCode: 'TOKEN_MISMATCH' },
      { name: 'market closed', context: { marketStatus: 'closed' }, expectedCode: 'MARKET_CLOSED' },
      { name: 'missing pUSD balance', context: { balanceAvailableUsd: null }, expectedCode: 'INSUFFICIENT_BALANCE' },
    ]

    for (const testCase of cases) {
      const store = new InMemoryTradingExecutorStore({
        intents: [buildIntentRecord()],
        recipes: [testCase.recipe ?? buildRecipeRecord()],
        exposures: testCase.exposures,
      })
      const adapter = new MockPolymarketTradingAdapter()
      const executor = new TradingExecutor({
        workerId: 'worker-1',
        leaseMs: 30_000,
        adapter,
        store,
        now: () => FIXED_NOW,
        buildEvaluationContext: async () => buildExecutionContext(testCase.context),
      })

      const result = await executor.processClaimedTradeIntent(buildIntentRecord())
      const updatedIntent = await store.getTradeIntentById(1)

      expect(result, testCase.name).toMatchObject({ kind: 'blocked', blockerCodes: [testCase.expectedCode] })
      expect(updatedIntent?.status, testCase.name).toBe('failed')
      expect(updatedIntent?.lastErrorCode, testCase.name).toBe(testCase.expectedCode)
      expect(store.events.map((event) => event.eventType), testCase.name).toEqual([
        'detected',
        'eligible',
        'blocked',
      ])
      expect(store.exposures, testCase.name).toHaveLength(testCase.exposures?.length ?? 0)
      expect(adapter.getRecordedCalls(), testCase.name).toEqual([])
    }
  })

  test('re-checks policy before submit when recovering a previously claimed intent', async () => {
    const store = new InMemoryTradingExecutorStore({
      intents: [
        buildIntentRecord({
          status: 'claimed',
          claimedAt: new Date('2026-05-11T09:50:00.000Z'),
          claimExpiresAt: new Date('2026-05-11T09:50:30.000Z'),
        }),
      ],
      recipes: [buildRecipeRecord()],
    })
    const adapter = new MockPolymarketTradingAdapter()
    const executor = new TradingExecutor({
      workerId: 'worker-1',
      leaseMs: 30_000,
      adapter,
      store,
      now: () => FIXED_NOW,
      buildEvaluationContext: async () => buildExecutionContext({ marketStatus: 'closed' }),
    })

    const result = await executor.processClaimedTradeIntent(store.intents[0]!)

    expect(result).toMatchObject({ kind: 'blocked', blockerCodes: ['MARKET_CLOSED'] })
    expect(adapter.getRecordedCalls()).toEqual([])
    expect(store.events.map((event) => event.eventType)).toEqual(['detected', 'eligible', 'blocked'])
  })

  test('reconciles an ambiguous submit timeout through REST before any retry path', async () => {
    const { executor, store, adapter } = createLiveExecutor()
    adapter.enqueueCreateOrderOutcome({
      type: 'timeout',
      persistedOrderId: 'venue-order-1',
      matchedSize: buildRecipeRecord().size / 2,
      tradeId: 'venue-trade-1',
      emitUserUpdate: false,
      omitClientOrderIdFromTrade: true,
    })

    const result = await executor.processNextTradeIntent()
    const updatedIntent = await store.getTradeIntentById(1)

    expect(result).toMatchObject({
      kind: 'reconciled',
      intentId: 1,
      state: 'partial',
      source: 'rest-fallback',
      orderId: 'venue-order-1',
    })
    expect(updatedIntent?.status).toBe('submitted')
    expect(store.events.map((event) => event.eventType)).toEqual([
      'detected',
      'eligible',
      'approved',
      'submitted',
      'partial',
    ])
    expect(store.exposures.map((entry) => [entry.entryType, entry.notionalUsd])).toEqual([
      ['submitted_notional', 400],
      ['filled_exposure', 200],
      ['pending_order', 200],
    ])
    expect(adapter.getRecordedCalls().map((call) => call.operation)).toEqual([
      'subscribeUserUpdates',
      'createOrder',
      'getTrades',
      'getOrder',
      'getTrades',
    ])
  })

  test('uses user updates for partial fills and later cancel without auto re-entry', async () => {
    const { executor, store, adapter } = createLiveExecutor()
    adapter.enqueueCreateOrderOutcome({ type: 'accept', orderId: 'venue-order-2' })

    const submitResult = await executor.processNextTradeIntent()
    expect(submitResult).toMatchObject({ kind: 'submitted', state: 'acknowledged', orderId: 'venue-order-2' })

    adapter.addTrade('venue-order-2', {
      tradeId: 'trade-2',
      marketId: 'market-1',
      tokenId: 'token-1',
      side: 'buy',
      price: 0.42,
      size: buildRecipeRecord().size / 2,
      createdAt: '2026-05-11T10:01:00.000Z',
    })
    adapter.updateOrder('venue-order-2', {
      status: 'partially-filled',
      matchedSize: buildRecipeRecord().size / 2,
      remainingSize: buildRecipeRecord().size / 2,
      updatedAt: '2026-05-11T10:01:00.000Z',
    })

    const partialOutcome = await executor.processClaimedTradeIntent(store.intents[0]!)

    expect(partialOutcome).toMatchObject({ kind: 'reconciled', state: 'partial', source: 'user-updates' })
    expect(adapter.getRecordedCalls().filter((call) => call.operation === 'createOrder')).toHaveLength(1)

    adapter.updateOrder('venue-order-2', {
      status: 'canceled',
      matchedSize: buildRecipeRecord().size / 2,
      remainingSize: buildRecipeRecord().size / 2,
      reason: 'Canceled on venue',
      updatedAt: '2026-05-11T10:02:00.000Z',
    })

    const cancelOutcome = await executor.processClaimedTradeIntent(store.intents[0]!)
    const updatedIntent = await store.getTradeIntentById(1)

    expect(cancelOutcome).toMatchObject({ kind: 'reconciled', state: 'reconciled', source: 'user-updates' })
    expect(updatedIntent?.status).toBe('completed')
    expect(store.events.map((event) => event.eventType)).toEqual([
      'detected',
      'eligible',
      'approved',
      'submitted',
      'acknowledged',
      'partial',
      'cancelled',
      'reconciled',
    ])
    expect(calculateTradingExposureSummary(store.exposures, { fixtureId: 'fixture-1', dayWindow: { start: DAY_START, end: DAY_END } })).toMatchObject({
      daySubmittedNotionalUsd: 400,
      dayPendingOrdersUsd: 0,
      totalFilledExposureUsd: 200,
    })
    expect(adapter.getRecordedCalls().filter((call) => call.operation === 'createOrder')).toHaveLength(1)
  })

  test('treats venue expiry as terminal and clears pending exposure without re-entering', async () => {
    const { executor, store, adapter } = createLiveExecutor()
    adapter.enqueueCreateOrderOutcome({ type: 'accept', orderId: 'venue-order-3' })

    await executor.processNextTradeIntent()
    adapter.updateOrder('venue-order-3', {
      status: 'canceled',
      matchedSize: 0,
      remainingSize: buildRecipeRecord().size,
      reason: 'Order expired on venue',
      updatedAt: '2026-05-11T10:03:00.000Z',
    })

    const expiryOutcome = await executor.processClaimedTradeIntent(store.intents[0]!)
    const updatedIntent = await store.getTradeIntentById(1)

    expect(expiryOutcome).toMatchObject({ kind: 'reconciled', state: 'reconciled', source: 'user-updates' })
    expect(updatedIntent?.status).toBe('completed')
    expect(store.events.map((event) => event.eventType)).toContain('expired')
    expect(calculateTradingExposureSummary(store.exposures, { fixtureId: 'fixture-1', dayWindow: { start: DAY_START, end: DAY_END } })).toMatchObject({
      dayPendingOrdersUsd: 0,
      totalFilledExposureUsd: 0,
    })
    expect(adapter.getRecordedCalls().filter((call) => call.operation === 'createOrder')).toHaveLength(1)
  })

  test('falls back to REST after user channel disconnect and reconciles manual venue-side changes', async () => {
    const { executor, store, adapter } = createLiveExecutor()
    adapter.enqueueCreateOrderOutcome({ type: 'accept', orderId: 'venue-order-4' })

    await executor.processNextTradeIntent()
    adapter.disconnectUserUpdates('2026-05-11T10:04:00.000Z')
    adapter.addTrade(
      'venue-order-4',
      {
        tradeId: 'trade-4',
        marketId: 'market-1',
        tokenId: 'token-1',
        side: 'buy',
        price: 0.42,
        size: store.recipes[0]?.size ?? 0,
        createdAt: '2026-05-11T10:04:30.000Z',
      },
      { emitUserUpdate: false },
    )
    adapter.updateOrder(
      'venue-order-4',
      {
        status: 'filled',
        matchedSize: store.recipes[0]?.size ?? 0,
        remainingSize: 0,
        updatedAt: '2026-05-11T10:04:30.000Z',
      },
      { emitUserUpdate: false },
    )

    const outcome = await executor.processClaimedTradeIntent(store.intents[0]!)
    const checkpoint = await store.getTradingReconciliationCheckpoint('polymarket:user-updates')

    expect(outcome).toMatchObject({ kind: 'reconciled', state: 'reconciled', source: 'rest-fallback' })
    expect(store.events.map((event) => event.eventType)).toEqual([
      'detected',
      'eligible',
      'approved',
      'submitted',
      'acknowledged',
      'filled',
      'reconciled',
    ])
    expect(adapter.getRecordedCalls().map((call) => call.operation)).toEqual([
      'subscribeUserUpdates',
      'createOrder',
      'getTrades',
      'getOrder',
      'getTrades',
    ])
    expect(checkpoint?.details).toMatchObject({ connected: false, source: 'rest-fallback', orderId: 'venue-order-4' })
  })

  test('exposure accounting respects day boundaries and category totals', () => {
    const summary = calculateTradingExposureSummary(
      [
        {
          fixtureId: 'fixture-1',
          marketId: 'market-1',
          tokenId: 'token-1',
          entryType: 'submitted_notional',
          notionalUsd: 8.4,
          eventTime: new Date('2026-05-11T01:00:00.000Z'),
        },
        {
          fixtureId: 'fixture-1',
          marketId: 'market-1',
          tokenId: 'token-1',
          entryType: 'submitted_notional',
          notionalUsd: 100,
          eventTime: new Date('2026-05-10T23:59:00.000Z'),
        },
        {
          fixtureId: 'fixture-1',
          marketId: 'market-1',
          tokenId: 'token-1',
          entryType: 'pending_order',
          notionalUsd: 5,
          eventTime: new Date('2026-05-11T01:10:00.000Z'),
        },
        {
          fixtureId: 'fixture-1',
          marketId: 'market-1',
          tokenId: 'token-1',
          entryType: 'open_exposure',
          notionalUsd: 7,
          eventTime: new Date('2026-05-11T01:20:00.000Z'),
        },
        {
          fixtureId: 'fixture-1',
          marketId: 'market-1',
          tokenId: 'token-1',
          entryType: 'filled_exposure',
          notionalUsd: 3,
          eventTime: new Date('2026-05-11T01:30:00.000Z'),
        },
        {
          fixtureId: 'fixture-2',
          marketId: 'market-2',
          tokenId: 'token-2',
          entryType: 'open_exposure',
          notionalUsd: 9,
          eventTime: new Date('2026-05-11T01:40:00.000Z'),
        },
      ],
      {
        fixtureId: 'fixture-1',
        dayWindow: { start: DAY_START, end: DAY_END },
      },
    )

    expect(summary).toEqual({
      daySubmittedNotionalUsd: 8.4,
      dayPendingOrdersUsd: 5,
      totalOpenExposureUsd: 21,
      totalFilledExposureUsd: 3,
      fixtureOpenExposureUsd: 7,
      fixtureFilledExposureUsd: 3,
      fixturePendingOrdersUsd: 5,
    })
  })
})
