import type {
  PolymarketOrderRecord,
  PolymarketTradeRecord,
  PolymarketUserUpdate,
} from "./polymarket-adapter.js"
import type { TradeExecutionState } from "./policy.js"
import type { TradingExecutionEventRecord, TradingExposureLedgerRecord } from "./repository.js"

export type TradingReconciliationSource = "submit-response" | "user-updates" | "rest-fallback"

export interface TradingVenueSnapshot {
  source: TradingReconciliationSource
  order: PolymarketOrderRecord | null
  trades: PolymarketTradeRecord[]
  nextState: TradeExecutionState | null
  orderId: string | null
  clientOrderId: string | null
  filledQuantity: number
  filledNotionalUsd: number
  pendingQuantity: number
  pendingNotionalUsd: number
  cursor: string | null
}

export interface TradingExposureAdjustment {
  entryType: "filled_exposure" | "pending_order"
  notionalDeltaUsd: number
  quantityDelta: number | null
}

const EXPIRED_REASON_PATTERN = /expir/i
const EPSILON = 0.000_001

const roundNumber = (value: number) => Math.round(value * 100_000_000) / 100_000_000
const roundUsd = (value: number) => Math.round(value * 100) / 100

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const readString = (value: unknown) => (typeof value === "string" && value.trim() ? value : null)

const inferCanceledState = (order: PolymarketOrderRecord) =>
  EXPIRED_REASON_PATTERN.test(order.reason ?? "") ? "expired" : "cancelled"

export const extractKnownOrderId = (events: TradingExecutionEventRecord[]) => {
  for (const event of [...events].reverse()) {
    const details = asObject(event.details)
    const order = asObject(details?.order)
    const detailOrderId = readString(details?.orderId)
    const nestedOrderId = readString(order?.orderId)
    const duplicateOrderId = readString(details?.duplicateOfOrderId)

    if (nestedOrderId) {
      return nestedOrderId
    }

    if (detailOrderId) {
      return detailOrderId
    }

    if (duplicateOrderId) {
      return duplicateOrderId
    }
  }

  return null
}

export const extractClientOrderId = (events: TradingExecutionEventRecord[]) => {
  for (const event of [...events].reverse()) {
    const details = asObject(event.details)
    const order = asObject(details?.order)
    const orderRequest = asObject(details?.orderRequest)
    const nestedOrderClientId = readString(order?.clientOrderId)
    const requestClientId = readString(orderRequest?.clientOrderId)
    const detailClientId = readString(details?.clientOrderId)

    if (nestedOrderClientId) {
      return nestedOrderClientId
    }

    if (requestClientId) {
      return requestClientId
    }

    if (detailClientId) {
      return detailClientId
    }
  }

  return null
}

export const isActiveVenueState = (state: TradeExecutionState | null) =>
  state === "submitted" ||
  state === "acknowledged" ||
  state === "partial" ||
  state === "filled" ||
  state === "cancelled" ||
  state === "expired"

const summarizeTrades = (trades: PolymarketTradeRecord[]) => {
  const filledQuantity = roundNumber(trades.reduce((total, trade) => total + trade.size, 0))
  const filledNotionalUsd = roundUsd(trades.reduce((total, trade) => total + trade.price * trade.size, 0))
  const orderId = trades.at(-1)?.orderId ?? null
  const clientOrderId = trades.at(-1)?.clientOrderId ?? null
  const cursor = trades.at(-1)?.createdAt ?? null

  return {
    filledQuantity,
    filledNotionalUsd,
    orderId,
    clientOrderId,
    cursor,
  }
}

export const inferVenueState = (input: {
  order: PolymarketOrderRecord | null
  trades: PolymarketTradeRecord[]
  requestedSize: number
}) => {
  const tradeSummary = summarizeTrades(input.trades)
  const matchedSize = Math.max(input.order?.matchedSize ?? 0, tradeSummary.filledQuantity)

  if (input.order) {
    switch (input.order.status) {
      case "filled":
        return "filled" as const
      case "canceled":
        return inferCanceledState(input.order)
      case "partially-filled":
        return matchedSize >= input.requestedSize ? ("filled" as const) : ("partial" as const)
      case "accepted":
      case "open":
        return matchedSize > 0 ? ("partial" as const) : ("acknowledged" as const)
      case "rejected":
        return "reconciled" as const
    }
  }

  if (tradeSummary.filledQuantity >= input.requestedSize) {
    return "filled" as const
  }

  if (tradeSummary.filledQuantity > 0) {
    return "partial" as const
  }

  return null
}

export const buildTradingVenueSnapshot = (input: {
  source: TradingReconciliationSource
  order: PolymarketOrderRecord | null
  trades: PolymarketTradeRecord[]
  requestedSize: number
  requestedNotionalUsd: number
}) => {
  const tradeSummary = summarizeTrades(input.trades)
  const matchedQuantity = Math.max(input.order?.matchedSize ?? 0, tradeSummary.filledQuantity)
  const fallbackFilledNotionalUsd = roundUsd(
    Math.min(matchedQuantity, input.requestedSize) * (input.order?.price ?? 0),
  )
  const filledNotionalUsd = Math.min(
    input.requestedNotionalUsd,
    tradeSummary.filledNotionalUsd > 0 ? tradeSummary.filledNotionalUsd : fallbackFilledNotionalUsd,
  )
  const nextState = inferVenueState({
    order: input.order,
    trades: input.trades,
    requestedSize: input.requestedSize,
  })
  const isOpenState = nextState === "acknowledged" || nextState === "partial"
  const pendingQuantity = isOpenState
    ? roundNumber(Math.max(0, input.requestedSize - matchedQuantity))
    : 0
  const pendingNotionalUsd = isOpenState
    ? roundUsd(Math.max(0, input.requestedNotionalUsd - filledNotionalUsd))
    : 0

  return {
    source: input.source,
    order: input.order,
    trades: input.trades,
    nextState,
    orderId: input.order?.orderId ?? tradeSummary.orderId,
    clientOrderId: input.order?.clientOrderId ?? tradeSummary.clientOrderId,
    filledQuantity: roundNumber(matchedQuantity),
    filledNotionalUsd,
    pendingQuantity,
    pendingNotionalUsd,
    cursor: input.order?.updatedAt ?? tradeSummary.cursor,
  } satisfies TradingVenueSnapshot
}

export const calculateExposureAdjustments = (input: {
  entries: TradingExposureLedgerRecord[]
  targetFilledNotionalUsd: number
  targetFilledQuantity: number
  targetPendingNotionalUsd: number
  targetPendingQuantity: number
}) => {
  const currentPendingNotionalUsd = roundUsd(
    input.entries
      .filter((entry) => entry.entryType === "pending_order")
      .reduce((total, entry) => total + entry.notionalUsd, 0),
  )
  const currentPendingQuantity = roundNumber(
    input.entries
      .filter((entry) => entry.entryType === "pending_order")
      .reduce((total, entry) => total + (entry.quantity ?? 0), 0),
  )
  const currentFilledNotionalUsd = roundUsd(
    input.entries
      .filter((entry) => entry.entryType === "filled_exposure")
      .reduce((total, entry) => total + entry.notionalUsd, 0),
  )
  const currentFilledQuantity = roundNumber(
    input.entries
      .filter((entry) => entry.entryType === "filled_exposure")
      .reduce((total, entry) => total + (entry.quantity ?? 0), 0),
  )

  const adjustments: TradingExposureAdjustment[] = []
  const filledNotionalDeltaUsd = roundUsd(input.targetFilledNotionalUsd - currentFilledNotionalUsd)
  const filledQuantityDelta = roundNumber(input.targetFilledQuantity - currentFilledQuantity)
  if (Math.abs(filledNotionalDeltaUsd) > EPSILON || Math.abs(filledQuantityDelta) > EPSILON) {
    adjustments.push({
      entryType: "filled_exposure",
      notionalDeltaUsd: filledNotionalDeltaUsd,
      quantityDelta: filledQuantityDelta,
    })
  }

  const pendingNotionalDeltaUsd = roundUsd(input.targetPendingNotionalUsd - currentPendingNotionalUsd)
  const pendingQuantityDelta = roundNumber(input.targetPendingQuantity - currentPendingQuantity)
  if (Math.abs(pendingNotionalDeltaUsd) > EPSILON || Math.abs(pendingQuantityDelta) > EPSILON) {
    adjustments.push({
      entryType: "pending_order",
      notionalDeltaUsd: pendingNotionalDeltaUsd,
      quantityDelta: pendingQuantityDelta,
    })
  }

  return adjustments
}

export const buildReconciliationCheckpointCursor = (snapshot: TradingVenueSnapshot | null) => {
  if (!snapshot) {
    return null
  }

  return snapshot.cursor ?? snapshot.orderId ?? snapshot.clientOrderId ?? null
}

export const getUserUpdateOrder = (update: PolymarketUserUpdate) => update.order ?? null

export const getUserUpdateTrade = (update: PolymarketUserUpdate) => update.trade ?? null
