import { TRADING_BALANCE_ALLOCATION_FRACTION, type TradingReadinessResult, type ValidatedTradingRecipe } from "./config.js"

export const tradeExecutionStates = [
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
] as const

export type TradeExecutionState = (typeof tradeExecutionStates)[number]

export type TradePolicyBlockerCode =
  | "RECIPE_MISSING"
  | "RECIPE_INVALID"
  | "ENV_LIVE_GATE_DISABLED"
  | "DB_RUNTIME_LIVE_GATE_DISABLED"
  | "POLYMARKET_CREDENTIALS_MISSING"
  | "STALE_MATCH_STATE"
  | "STALE_BOOK"
  | "TOKEN_MISMATCH"
  | "MARKET_CLOSED"
  | "INSUFFICIENT_BALANCE"

export interface TradePolicyBlocker {
  code: TradePolicyBlockerCode
  message: string
  details: Record<string, unknown>
}

export interface TradingExposureLedgerEntryLike {
  fixtureId: string
  marketId: string
  tokenId: string
  entryType: string
  notionalUsd: number
  eventTime: Date
}

export interface TradingExposureDayWindow {
  start: Date
  end: Date
}

export interface TradingExposureSummary {
  daySubmittedNotionalUsd: number
  dayPendingOrdersUsd: number
  totalOpenExposureUsd: number
  totalFilledExposureUsd: number
  fixtureOpenExposureUsd: number
  fixtureFilledExposureUsd: number
  fixturePendingOrdersUsd: number
}

export interface EvaluateTradeIntentPolicyInput {
  recipe: ValidatedTradingRecipe | null
  readiness: TradingReadinessResult
  balanceAvailableUsd: number | null
  marketStatus: "open" | "closed" | "halted"
  currentTokenId: string | null
  matchStateAgeMs: number | null
  maxMatchStateAgeMs: number
  bookAgeMs: number | null
  maxBookAgeMs: number
  fixtureId: string
  exposureEntries: TradingExposureLedgerEntryLike[]
  dayWindow: TradingExposureDayWindow
}

export interface EvaluateTradeIntentPolicyResult {
  approved: boolean
  requestedNotionalUsd: number | null
  requestedOrderSize: number | null
  allocationFraction: number
  blockers: TradePolicyBlocker[]
  exposureSummary: TradingExposureSummary
  statePath: TradeExecutionState[]
}

const tradeExecutionStateSet = new Set<string>(tradeExecutionStates)

const transitionMap: Record<TradeExecutionState, readonly TradeExecutionState[]> = {
  detected: ["eligible", "blocked"],
  eligible: ["blocked", "approved"],
  blocked: [],
  approved: ["submitted"],
  submitted: ["acknowledged", "partial", "filled", "cancelled", "expired", "reconciled"],
  acknowledged: ["partial", "filled", "cancelled", "expired", "reconciled"],
  partial: ["filled", "cancelled", "expired", "reconciled"],
  filled: ["reconciled"],
  cancelled: ["reconciled"],
  expired: ["reconciled"],
  reconciled: [],
}

const roundUsd = (value: number) => Math.round(value * 100) / 100

const roundOrderSize = (value: number) => Math.round(value * 1_000_000) / 1_000_000

const readRecipeAllocationFraction = (recipe: ValidatedTradingRecipe | null) => {
  const allocationFraction = recipe?.context?.allocationFraction

  if (
    typeof allocationFraction === "number" &&
    Number.isFinite(allocationFraction) &&
    allocationFraction > 0 &&
    allocationFraction <= 1
  ) {
    return allocationFraction
  }

  return TRADING_BALANCE_ALLOCATION_FRACTION
}

const calculateOrderSizing = (recipe: ValidatedTradingRecipe | null, balanceAvailableUsd: number | null) => {
  const allocationFraction = readRecipeAllocationFraction(recipe)

  if (!recipe || balanceAvailableUsd == null || !Number.isFinite(balanceAvailableUsd) || balanceAvailableUsd <= 0) {
    return { requestedNotionalUsd: null, requestedOrderSize: null, allocationFraction }
  }

  const requestedNotionalUsd = roundUsd(balanceAvailableUsd * allocationFraction)
  return {
    requestedNotionalUsd,
    requestedOrderSize: roundOrderSize(requestedNotionalUsd / recipe.maxPrice),
    allocationFraction,
  }
}

const isWithinDayWindow = (eventTime: Date, dayWindow: TradingExposureDayWindow) =>
  eventTime.getTime() >= dayWindow.start.getTime() && eventTime.getTime() < dayWindow.end.getTime()

export const isTradeExecutionState = (value: string): value is TradeExecutionState =>
  tradeExecutionStateSet.has(value)

export const assertTradeExecutionTransition = (
  currentState: TradeExecutionState | null,
  nextState: TradeExecutionState,
) => {
  if (currentState == null) {
    if (nextState !== "detected") {
      throw new Error(`Trade execution state must start at detected, received ${nextState}`)
    }

    return
  }

  if (!transitionMap[currentState].includes(nextState)) {
    throw new Error(`Invalid trade execution transition ${currentState} -> ${nextState}`)
  }
}

export const reduceTradeExecutionState = (
  events: Array<{ eventType: string }>,
): TradeExecutionState | null => {
  let currentState: TradeExecutionState | null = null

  for (const event of events) {
    if (!isTradeExecutionState(event.eventType)) {
      continue
    }

    assertTradeExecutionTransition(currentState, event.eventType)
    currentState = event.eventType
  }

  return currentState
}

export const calculateTradingExposureSummary = (
  entries: TradingExposureLedgerEntryLike[],
  input: {
    fixtureId: string
    dayWindow: TradingExposureDayWindow
  },
): TradingExposureSummary => {
  const summary: TradingExposureSummary = {
    daySubmittedNotionalUsd: 0,
    dayPendingOrdersUsd: 0,
    totalOpenExposureUsd: 0,
    totalFilledExposureUsd: 0,
    fixtureOpenExposureUsd: 0,
    fixtureFilledExposureUsd: 0,
    fixturePendingOrdersUsd: 0,
  }

  for (const entry of entries) {
    const notionalUsd = Number.isFinite(entry.notionalUsd) ? entry.notionalUsd : 0
    const inDayWindow = isWithinDayWindow(entry.eventTime, input.dayWindow)
    const sameFixture = entry.fixtureId === input.fixtureId

    switch (entry.entryType) {
      case "submitted_notional":
        if (inDayWindow) {
          summary.daySubmittedNotionalUsd += notionalUsd
        }
        break
      case "pending_order":
        if (inDayWindow) {
          summary.dayPendingOrdersUsd += notionalUsd
        }
        summary.totalOpenExposureUsd += notionalUsd
        if (sameFixture) {
          summary.fixturePendingOrdersUsd += notionalUsd
        }
        break
      case "open_exposure":
        summary.totalOpenExposureUsd += notionalUsd
        if (sameFixture) {
          summary.fixtureOpenExposureUsd += notionalUsd
        }
        break
      case "filled_exposure":
        summary.totalFilledExposureUsd += notionalUsd
        if (sameFixture) {
          summary.fixtureFilledExposureUsd += notionalUsd
        }
        break
      default:
        break
    }
  }

  return {
    daySubmittedNotionalUsd: roundUsd(summary.daySubmittedNotionalUsd),
    dayPendingOrdersUsd: roundUsd(summary.dayPendingOrdersUsd),
    totalOpenExposureUsd: roundUsd(summary.totalOpenExposureUsd),
    totalFilledExposureUsd: roundUsd(summary.totalFilledExposureUsd),
    fixtureOpenExposureUsd: roundUsd(summary.fixtureOpenExposureUsd),
    fixtureFilledExposureUsd: roundUsd(summary.fixtureFilledExposureUsd),
    fixturePendingOrdersUsd: roundUsd(summary.fixturePendingOrdersUsd),
  }
}

const mapReadinessBlockers = (readiness: TradingReadinessResult): TradePolicyBlocker[] => {
  if (readiness.liveReady) {
    return []
  }

  return readiness.reasons.map((reason) => {
    switch (reason.code) {
      case "ENV_LIVE_GATE_DISABLED":
        return {
          code: reason.code,
          message: "Trading env gate is disabled",
          details: {},
        }
      case "DB_RUNTIME_LIVE_GATE_DISABLED":
        return {
          code: reason.code,
          message: "Trading runtime DB flag is disabled",
          details: {},
        }
      case "POLYMARKET_CREDENTIALS_MISSING":
        return {
          code: reason.code,
          message: "Polymarket credentials are missing",
          details: {},
        }
      case "RECIPE_MISSING":
        return {
          code: "RECIPE_MISSING",
          message: "Trading recipe is missing",
          details: {},
        }
      case "RECIPE_INVALID":
        return {
          code: "RECIPE_INVALID",
          message: "Trading recipe failed validation",
          details: { errors: reason.errors ?? [] },
        }
    }
  })
}

export const evaluateTradeIntentPolicy = (
  input: EvaluateTradeIntentPolicyInput,
): EvaluateTradeIntentPolicyResult => {
  const blockers = mapReadinessBlockers(input.readiness)
  const exposureSummary = calculateTradingExposureSummary(input.exposureEntries, {
    fixtureId: input.fixtureId,
    dayWindow: input.dayWindow,
  })
  const { requestedNotionalUsd, requestedOrderSize, allocationFraction } = calculateOrderSizing(input.recipe, input.balanceAvailableUsd)

  if (!input.recipe) {
    blockers.push({
      code: "RECIPE_MISSING",
      message: "Trading recipe is missing",
      details: {},
    })
  }

  if (input.matchStateAgeMs == null || input.matchStateAgeMs > input.maxMatchStateAgeMs) {
    blockers.push({
      code: "STALE_MATCH_STATE",
      message: "Match state is stale",
      details: {
        matchStateAgeMs: input.matchStateAgeMs,
        maxMatchStateAgeMs: input.maxMatchStateAgeMs,
      },
    })
  }

  if (input.bookAgeMs == null || input.bookAgeMs > input.maxBookAgeMs) {
    blockers.push({
      code: "STALE_BOOK",
      message: "Book state is stale",
      details: {
        bookAgeMs: input.bookAgeMs,
        maxBookAgeMs: input.maxBookAgeMs,
      },
    })
  }

  if (
    input.recipe &&
    input.currentTokenId != null &&
    input.currentTokenId.trim() !== "" &&
    input.currentTokenId !== input.recipe.tokenId
  ) {
    blockers.push({
      code: "TOKEN_MISMATCH",
      message: "Current token does not match the recipe token",
      details: {
        expectedTokenId: input.recipe.tokenId,
        actualTokenId: input.currentTokenId,
      },
    })
  }

  if (input.marketStatus !== "open") {
    blockers.push({
      code: "MARKET_CLOSED",
      message: "Market is not open for trading",
      details: {
        marketStatus: input.marketStatus,
      },
    })
  }

  if (input.recipe && (requestedNotionalUsd == null || requestedOrderSize == null)) {
    blockers.push({
      code: "INSUFFICIENT_BALANCE",
      message: "Available pUSD balance is unavailable or insufficient",
      details: {
        balanceAvailableUsd: input.balanceAvailableUsd,
        allocationFraction,
      },
    })
  }

  return {
    approved: blockers.length === 0,
    requestedNotionalUsd,
    requestedOrderSize,
    allocationFraction,
    blockers,
    exposureSummary,
    statePath: blockers.length === 0 ? ["detected", "eligible", "approved"] : ["detected", "eligible", "blocked"],
  }
}
