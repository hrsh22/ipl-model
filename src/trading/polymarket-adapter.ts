import { AssetType, Chain, ClobClient, OrderType, Side, SignatureTypeV2 } from "@polymarket/clob-client-v2"
import type { ApiKeyCreds, MarketDetails, OpenOrder, Trade } from "@polymarket/clob-client-v2"
import { createWalletClient, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import type { TradingOrderStyle, TradingReadinessResult, TradingSide } from "./config.js"

export type PolymarketTradingAdapterMode = "dry-run" | "mock" | "live"

export type PolymarketOrderStatus =
  | "accepted"
  | "open"
  | "partially-filled"
  | "filled"
  | "rejected"
  | "canceled"

export type PolymarketUserUpdateType = "order" | "trade" | "heartbeat" | "disconnect"

export type PolymarketAdapterErrorCode =
  | "ADAPTER_DISABLED"
  | "AUTH_FAILED"
  | "DUPLICATE_ORDER"
  | "NETWORK_ERROR"
  | "ORDER_REJECTED"
  | "RATE_LIMITED"
  | "REQUEST_TIMEOUT"
  | "UNKNOWN"

export interface PolymarketTokenLookup {
  tokenId: string
  outcome: string | null
}

export interface PolymarketMarketLookupResult {
  eventSlug: string | null
  marketSlug: string
  conditionId: string | null
  outcomes: string[]
  tokens: PolymarketTokenLookup[]
}

export interface PolymarketMarketLookupRequest {
  marketSlug?: string | null
  tokenId?: string | null
  conditionId?: string | null
}

export interface PolymarketCreateOrderRequest {
  marketId: string
  conditionId: string
  tokenId: string
  side: TradingSide
  orderStyle: TradingOrderStyle
  price: number
  size: number
  expirationMs: number
  clientOrderId?: string | null
}

export interface PolymarketOrderRecord {
  orderId: string
  clientOrderId: string | null
  marketId: string
  conditionId: string
  tokenId: string
  side: TradingSide
  orderStyle: TradingOrderStyle
  price: number
  size: number
  status: PolymarketOrderStatus
  matchedSize: number
  remainingSize: number
  createdAt: string
  updatedAt: string
  reason: string | null
  duplicateOfOrderId: string | null
}

export interface PolymarketTradeRecord {
  tradeId: string
  orderId: string
  clientOrderId: string | null
  marketId: string
  tokenId: string
  side: TradingSide
  price: number
  size: number
  createdAt: string
}

export interface PolymarketGetTradesRequest {
  orderId?: string | null
  marketId?: string | null
  tokenId?: string | null
}

export interface PolymarketUserUpdate {
  type: PolymarketUserUpdateType
  order?: PolymarketOrderRecord
  trade?: PolymarketTradeRecord
  recordedAt: string
}

export interface PolymarketHealthStatus {
  ok: boolean
  mode: PolymarketTradingAdapterMode
  authenticated: boolean
  reasons: string[]
}

export interface PolymarketRateLimitClassification {
  code: PolymarketAdapterErrorCode
  retryable: boolean
  shouldBackoff: boolean
  backoffMs: number | null
  status: number | null
}

export interface PolymarketLogSafeErrorContext {
  operation: string
  payload: unknown
  details: unknown
}

export interface PolymarketTradingAdapter {
  readonly mode: PolymarketTradingAdapterMode
  lookupMarket(request: PolymarketMarketLookupRequest): Promise<PolymarketMarketLookupResult | null>
  createOrder(request: PolymarketCreateOrderRequest): Promise<PolymarketOrderRecord>
  cancelOrder(orderId: string): Promise<PolymarketOrderRecord>
  getOrder(orderId: string): Promise<PolymarketOrderRecord | null>
  getTrades(request: PolymarketGetTradesRequest): Promise<PolymarketTradeRecord[]>
  getSpendablePusdBalance(): Promise<number | null>
  subscribeUserUpdates(listener: (update: PolymarketUserUpdate) => void): Promise<() => void>
  selfTest(): Promise<PolymarketHealthStatus>
}

export interface PolymarketLiveClient {
  lookupMarket(request: PolymarketMarketLookupRequest): Promise<PolymarketMarketLookupResult | null>
  createOrder(request: PolymarketCreateOrderRequest): Promise<PolymarketOrderRecord>
  cancelOrder(orderId: string): Promise<PolymarketOrderRecord>
  getOrder(orderId: string): Promise<PolymarketOrderRecord | null>
  getTrades(request: PolymarketGetTradesRequest): Promise<PolymarketTradeRecord[]>
  getSpendablePusdBalance(): Promise<number | null>
  subscribeUserUpdates(listener: (update: PolymarketUserUpdate) => void): Promise<() => void> | (() => void)
  selfTest(): Promise<Omit<PolymarketHealthStatus, "mode">>
}

export interface BuildPolymarketTradingAdapterInput {
  requestedMode?: PolymarketTradingAdapterMode
  readiness: TradingReadinessResult
  liveClient?: PolymarketLiveClient
  mockAdapter?: MockPolymarketTradingAdapter
}

export interface PolymarketClobV2LiveClientInput {
  host: string
  chainId: number
  privateKey: string | null | undefined
  builderCode: string | null | undefined
  signatureType?: SignatureTypeV2 | number | null
  funderAddress?: string | null | undefined
  expectedSignerAddress?: string | null | undefined
  deriveApiCredentials?: (client: Pick<ClobClient, "createOrDeriveApiKey">) => Promise<ApiKeyCreds>
}

export type PolymarketClobV2LiveClientFactoryResult =
  | { ok: true; client: PolymarketLiveClient }
  | { ok: false; reasons: string[] }

export interface PolymarketClobV2SdkClient {
  getClobMarketInfo(conditionID: string): Promise<MarketDetails>
  createAndPostOrder(
    userOrder: {
      tokenID: string
      price: number
      size: number
      side: Side
      builderCode?: string
      expiration?: number
    },
    options: { tickSize: "0.01" },
    orderType: OrderType.GTC | OrderType.GTD,
  ): Promise<unknown>
  createAndPostMarketOrder(
    userMarketOrder: {
      tokenID: string
      price: number
      amount: number
      side: Side
      orderType: OrderType.FOK
      builderCode?: string
    },
    options: { tickSize: "0.01" },
    orderType: OrderType.FOK,
  ): Promise<unknown>
  cancelOrder(payload: { orderID: string }): Promise<unknown>
  getOrder(orderID: string): Promise<OpenOrder>
  getTrades(params?: { market?: string; asset_id?: string }): Promise<Trade[]>
  updateBalanceAllowance(params?: { asset_type: AssetType; token_id?: string }): Promise<unknown>
  getBalanceAllowance(params?: { asset_type: AssetType; token_id?: string }): Promise<{ balance: string; allowances: Record<string, string> }>
  getOk(): Promise<unknown>
}

export interface MockOutcomeBase {
  message?: string
  details?: unknown
  sensitiveValues?: string[]
}

export type MockCreateOrderOutcome =
  | ({ type: "accept"; orderId?: string } & MockOutcomeBase)
  | ({ type: "reject" } & MockOutcomeBase)
  | ({
      type: "timeout"
      persistedOrderId?: string
      matchedSize?: number
      tradeId?: string
      emitUserUpdate?: boolean
      omitClientOrderIdFromTrade?: boolean
    } & MockOutcomeBase)
  | ({ type: "duplicate"; duplicateOfOrderId: string } & MockOutcomeBase)
  | ({ type: "partial-fill"; orderId?: string; matchedSize: number; tradeId?: string } & MockOutcomeBase)
  | ({ type: "rate-limit"; retryAfterMs?: number } & MockOutcomeBase)

export type MockCancelOrderOutcome =
  | ({ type: "cancel" } & MockOutcomeBase)
  | ({ type: "reject" } & MockOutcomeBase)
  | ({ type: "timeout" } & MockOutcomeBase)
  | ({ type: "rate-limit"; retryAfterMs?: number } & MockOutcomeBase)

export interface MockPolymarketCall {
  operation:
    | "lookupMarket"
    | "createOrder"
    | "cancelOrder"
    | "getOrder"
    | "getTrades"
    | "getSpendablePusdBalance"
    | "subscribeUserUpdates"
    | "selfTest"
  payload: unknown
  recordedAt: string
}

const REDACTED = "[REDACTED]"
const DEFAULT_POLYGON_RPC_URL = "https://polygon-rpc.com"
const DEFAULT_TIMEOUT_BACKOFF_MS = 1_000
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 2_000
const DEFAULT_NETWORK_BACKOFF_MS = 1_500
const SENSITIVE_KEY_PATTERN = /(authorization|api[_-]?key|secret|passphrase|private[_-]?key|signature|signed)/i

const nowIso = () => new Date().toISOString()

const normalizeString = (value: string | null | undefined) => value?.trim() ?? ""

const hasApiCredentials = (value: ApiKeyCreds): boolean =>
  Boolean(value.key?.trim() && value.secret?.trim() && value.passphrase?.trim())

const normalizeNumberString = (value: string | number | null | undefined) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const toIsoFromEpochSeconds = (value: string | number | null | undefined) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return nowIso()
  }

  return new Date(parsed * 1_000).toISOString()
}

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const extractStatus = (error: unknown): number | null => {
  const object = asObject(error)
  const directStatus = object?.status
  if (typeof directStatus === "number") {
    return directStatus
  }

  const response = asObject(object?.response)
  return typeof response?.status === "number" ? response.status : null
}

const extractRetryAfterMs = (error: unknown): number | null => {
  const object = asObject(error)
  const retryAfterMs = object?.retryAfterMs
  if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return retryAfterMs
  }

  const response = asObject(object?.response)
  const headers = asObject(response?.headers)
  const retryAfterValue = headers?.["retry-after"]
  if (typeof retryAfterValue === "number" && retryAfterValue > 0) {
    return retryAfterValue * 1_000
  }

  if (typeof retryAfterValue === "string") {
    const parsed = Number(retryAfterValue)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed * 1_000
    }
  }

  return null
}

const extractMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  const object = asObject(error)
  if (typeof object?.message === "string") {
    return object.message
  }

  return "Unknown Polymarket adapter failure"
}

const isAbortLikeError = (error: unknown) => {
  if (error instanceof Error && error.name === "AbortError") {
    return true
  }

  const message = extractMessage(error).toLowerCase()
  return message.includes("timeout") || message.includes("timed out")
}

const replaceSensitiveString = (value: string, sensitiveValues: readonly string[]) => {
  let sanitized = value

  if (/^bearer\s+/i.test(sanitized)) {
    sanitized = REDACTED
  }

  for (const secret of sensitiveValues) {
    if (!secret) {
      continue
    }

    sanitized = sanitized.split(secret).join(REDACTED)
  }

  return sanitized
}

const collectSensitiveValues = (value: unknown, target: Set<string>, keyHint?: string) => {
  if (typeof value === "string") {
    if (SENSITIVE_KEY_PATTERN.test(keyHint ?? "") || /^bearer\s+/i.test(value)) {
      target.add(value)

      if (/^bearer\s+/i.test(value)) {
        target.add(value.replace(/^bearer\s+/i, "").trim())
      }
    }

    return
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSensitiveValues(entry, target)
    }
    return
  }

  const object = asObject(value)
  if (!object) {
    return
  }

  for (const [key, entry] of Object.entries(object)) {
    collectSensitiveValues(entry, target, key)
  }
}

const sanitizeUnknown = (value: unknown, sensitiveValues: readonly string[], keyHint?: string): unknown => {
  if (typeof value === "string") {
    return SENSITIVE_KEY_PATTERN.test(keyHint ?? "")
      ? REDACTED
      : replaceSensitiveString(value, sensitiveValues)
  }

  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeUnknown(entry, sensitiveValues))
  }

  const object = asObject(value)
  if (!object) {
    return value
  }

  const sanitizedEntries = Object.entries(object).map(([key, entry]) => [
    key,
    SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitizeUnknown(entry, sensitiveValues, key),
  ])

  return Object.fromEntries(sanitizedEntries)
}

export const createPolymarketLogSafePayload = (
  payload: unknown,
  sensitiveValues: readonly string[] = [],
) => {
  const allSensitiveValues = new Set(sensitiveValues)
  collectSensitiveValues(payload, allSensitiveValues)
  return sanitizeUnknown(payload, [...allSensitiveValues])
}

export const classifyPolymarketError = (error: unknown): PolymarketRateLimitClassification => {
  const status = extractStatus(error)
  const retryAfterMs = extractRetryAfterMs(error)
  const message = extractMessage(error).toLowerCase()

  if (status === 429 || message.includes("rate limit")) {
    return {
      code: "RATE_LIMITED",
      retryable: true,
      shouldBackoff: true,
      backoffMs: retryAfterMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS,
      status,
    }
  }

  if (isAbortLikeError(error)) {
    return {
      code: "REQUEST_TIMEOUT",
      retryable: true,
      shouldBackoff: true,
      backoffMs: DEFAULT_TIMEOUT_BACKOFF_MS,
      status,
    }
  }

  if (status === 409 || message.includes("duplicate")) {
    return {
      code: "DUPLICATE_ORDER",
      retryable: false,
      shouldBackoff: false,
      backoffMs: null,
      status,
    }
  }

  if (status === 401 || status === 403 || message.includes("auth")) {
    return {
      code: "AUTH_FAILED",
      retryable: false,
      shouldBackoff: false,
      backoffMs: null,
      status,
    }
  }

  if (status === 400 || status === 422 || message.includes("reject") || message.includes("insufficient")) {
    return {
      code: "ORDER_REJECTED",
      retryable: false,
      shouldBackoff: false,
      backoffMs: null,
      status,
    }
  }

  if ((status != null && status >= 500) || message.includes("network") || message.includes("fetch")) {
    return {
      code: "NETWORK_ERROR",
      retryable: true,
      shouldBackoff: true,
      backoffMs: DEFAULT_NETWORK_BACKOFF_MS,
      status,
    }
  }

  return {
    code: "UNKNOWN",
    retryable: false,
    shouldBackoff: false,
    backoffMs: null,
    status,
  }
}

export class PolymarketAdapterError extends Error {
  readonly code: PolymarketAdapterErrorCode
  readonly retryable: boolean
  readonly shouldBackoff: boolean
  readonly backoffMs: number | null
  readonly status: number | null
  readonly safeContext: PolymarketLogSafeErrorContext

  constructor(input: {
    message: string
    code: PolymarketAdapterErrorCode
    retryable: boolean
    shouldBackoff: boolean
    backoffMs: number | null
    status: number | null
    safeContext: PolymarketLogSafeErrorContext
  }) {
    super(input.message)
    this.name = "PolymarketAdapterError"
    this.code = input.code
    this.retryable = input.retryable
    this.shouldBackoff = input.shouldBackoff
    this.backoffMs = input.backoffMs
    this.status = input.status
    this.safeContext = input.safeContext
  }
}

const toSafeAdapterError = (input: {
  operation: string
  payload: unknown
  error: unknown
  details?: unknown
  sensitiveValues?: readonly string[] | undefined
}) => {
  const classification = classifyPolymarketError(input.error)
  const sanitizedPayload = createPolymarketLogSafePayload(input.payload, input.sensitiveValues)
  const sanitizedDetails = createPolymarketLogSafePayload(
    input.details ?? { message: extractMessage(input.error) },
    input.sensitiveValues,
  )
  const sanitizedMessage = replaceSensitiveString(extractMessage(input.error), input.sensitiveValues ?? [])

  return new PolymarketAdapterError({
    message: `${input.operation} failed: ${sanitizedMessage}`,
    code: classification.code,
    retryable: classification.retryable,
    shouldBackoff: classification.shouldBackoff,
    backoffMs: classification.backoffMs,
    status: classification.status,
    safeContext: {
      operation: input.operation,
      payload: sanitizedPayload,
      details: sanitizedDetails,
    },
  })
}

const createBaseOrder = (
  request: PolymarketCreateOrderRequest,
  orderId: string,
  overrides: Partial<PolymarketOrderRecord> = {},
): PolymarketOrderRecord => {
  const createdAt = overrides.createdAt ?? nowIso()
  const matchedSize = overrides.matchedSize ?? 0
  const remainingSize = overrides.remainingSize ?? Math.max(0, request.size - matchedSize)

  return {
    orderId,
    clientOrderId: request.clientOrderId ?? null,
    marketId: request.marketId,
    conditionId: request.conditionId,
    tokenId: request.tokenId,
    side: request.side,
    orderStyle: request.orderStyle,
    price: request.price,
    size: request.size,
    status: overrides.status ?? "accepted",
    matchedSize,
    remainingSize,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    reason: overrides.reason ?? null,
    duplicateOfOrderId: overrides.duplicateOfOrderId ?? null,
  }
}

const toSdkSide = (side: TradingSide) => side === "buy" ? Side.BUY : Side.SELL

const fromSdkSide = (side: string | Side | undefined): TradingSide =>
  String(side ?? "").toUpperCase() === Side.SELL ? "sell" : "buy"

const fromSdkOrderStatus = (status: string | undefined): PolymarketOrderStatus => {
  const normalized = String(status ?? "").toLowerCase()
  if (normalized.includes("filled") || normalized === "matched") {
    return "filled"
  }
  if (normalized.includes("partial")) {
    return "partially-filled"
  }
  if (normalized.includes("cancel")) {
    return "canceled"
  }
  if (normalized.includes("reject") || normalized.includes("fail")) {
    return "rejected"
  }
  if (normalized.includes("open") || normalized.includes("live")) {
    return "open"
  }
  return "accepted"
}

const mapMarketDetails = (
  conditionId: string,
  market: MarketDetails,
): PolymarketMarketLookupResult => ({
  eventSlug: null,
  marketSlug: conditionId,
  conditionId: market.c || conditionId,
  outcomes: market.t.map((token) => token.o),
  tokens: market.t.map((token) => ({ tokenId: token.t, outcome: token.o })),
})

const mapOpenOrder = (order: OpenOrder): PolymarketOrderRecord => {
  const size = normalizeNumberString(order.original_size)
  const matchedSize = normalizeNumberString(order.size_matched)
  return {
    orderId: order.id,
    clientOrderId: null,
    marketId: order.market,
    conditionId: order.market,
    tokenId: order.asset_id,
    side: fromSdkSide(order.side),
    orderStyle: order.order_type?.toLowerCase().includes("market") ? "market" : "limit",
    price: normalizeNumberString(order.price),
    size,
    status: fromSdkOrderStatus(order.status),
    matchedSize,
    remainingSize: Math.max(0, size - matchedSize),
    createdAt: toIsoFromEpochSeconds(order.created_at),
    updatedAt: nowIso(),
    reason: null,
    duplicateOfOrderId: null,
  }
}

const findMakerOrderForTrade = (trade: Trade) =>
  trade.maker_orders.find((order) => order.asset_id === trade.asset_id) ?? trade.maker_orders[0] ?? null

const mapTrade = (trade: Trade): PolymarketTradeRecord => {
  const makerOrder = trade.trader_side === "MAKER" ? findMakerOrderForTrade(trade) : null
  return {
    tradeId: trade.id,
    orderId: makerOrder?.order_id ?? trade.taker_order_id,
    clientOrderId: null,
    marketId: trade.market,
    tokenId: makerOrder?.asset_id ?? trade.asset_id,
    side: fromSdkSide(makerOrder?.side ?? trade.side),
    price: normalizeNumberString(makerOrder?.price ?? trade.price),
    size: normalizeNumberString(makerOrder?.matched_amount ?? trade.size),
    createdAt: trade.match_time ? new Date(trade.match_time).toISOString() : nowIso(),
  }
}

export class PolymarketClobV2LiveClient implements PolymarketLiveClient {
  constructor(
    private readonly client: PolymarketClobV2SdkClient,
    private readonly builderCode?: string,
  ) {}

  async lookupMarket(request: PolymarketMarketLookupRequest): Promise<PolymarketMarketLookupResult | null> {
    const conditionId = normalizeString(request.conditionId)
    if (!conditionId) {
      return null
    }

    const market = await this.client.getClobMarketInfo(conditionId)
    return mapMarketDetails(conditionId, market)
  }

  async createOrder(request: PolymarketCreateOrderRequest): Promise<PolymarketOrderRecord> {
    const expiration = Math.floor(request.expirationMs / 1_000)
    const orderType = expiration > 0 ? OrderType.GTD : OrderType.GTC
    const response = request.orderStyle === "market"
      ? await this.client.createAndPostMarketOrder(
          {
            tokenID: request.tokenId,
            price: request.price,
            amount: request.size,
            side: toSdkSide(request.side),
            orderType: OrderType.FOK,
            ...(this.builderCode ? { builderCode: this.builderCode } : {}),
          },
          { tickSize: "0.01" },
          OrderType.FOK,
        )
      : await this.client.createAndPostOrder(
          {
            tokenID: request.tokenId,
            price: request.price,
            size: request.size,
            side: toSdkSide(request.side),
            ...(this.builderCode ? { builderCode: this.builderCode } : {}),
            ...(expiration > 0 ? { expiration } : {}),
          },
          { tickSize: "0.01" },
          orderType,
        )
    const responseObject = asObject(response)
    if (responseObject?.success === false) {
      throw { status: 422, message: responseObject.errorMsg ?? "Polymarket order rejected" }
    }

    const orderId = typeof responseObject?.orderID === "string"
      ? responseObject.orderID
      : typeof responseObject?.id === "string"
        ? responseObject.id
        : `polymarket-${Date.now()}`

    return createBaseOrder(request, orderId, {
      status: fromSdkOrderStatus(typeof responseObject?.status === "string" ? responseObject.status : "open"),
    })
  }

  async cancelOrder(orderId: string): Promise<PolymarketOrderRecord> {
    await this.client.cancelOrder({ orderID: orderId })
    const order = await this.getOrder(orderId)
    if (order) {
      return { ...order, status: "canceled", updatedAt: nowIso() }
    }

    return {
      orderId,
      clientOrderId: null,
      marketId: "unknown",
      conditionId: "unknown",
      tokenId: "unknown",
      side: "buy",
      orderStyle: "limit",
      price: 0,
      size: 0,
      status: "canceled",
      matchedSize: 0,
      remainingSize: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      reason: null,
      duplicateOfOrderId: null,
    }
  }

  async getOrder(orderId: string): Promise<PolymarketOrderRecord | null> {
    try {
      return mapOpenOrder(await this.client.getOrder(orderId))
    } catch (error) {
      if (extractStatus(error) === 404) {
        return null
      }
      throw error
    }
  }

  async getTrades(request: PolymarketGetTradesRequest): Promise<PolymarketTradeRecord[]> {
    const trades = await this.client.getTrades({
      ...(request.marketId ? { market: request.marketId } : {}),
      ...(request.tokenId ? { asset_id: request.tokenId } : {}),
    })
    const mapped = trades.map(mapTrade)
    return request.orderId ? mapped.filter((trade) => trade.orderId === request.orderId) : mapped
  }

  async getSpendablePusdBalance(): Promise<number | null> {
    await this.client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL })
    const balance = await this.client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL })
    const parsed = normalizeNumberString(balance.balance)
    return parsed > 0 ? parsed : null
  }

  subscribeUserUpdates(): () => void {
    throw new Error("Polymarket CLOB V2 user update streaming is not implemented for this client; REST reconciliation remains authoritative")
  }

  async selfTest(): Promise<Omit<PolymarketHealthStatus, "mode">> {
    await this.client.getOk()
    return { ok: true, authenticated: true, reasons: [] }
  }
}

export const createPolymarketClobV2LiveClient = async (
  input: PolymarketClobV2LiveClientInput,
): Promise<PolymarketClobV2LiveClientFactoryResult> => {
  const host = normalizeString(input.host)
  const privateKey = normalizeString(input.privateKey)
  const builderCode = normalizeString(input.builderCode)
  const signatureType = input.signatureType ?? SignatureTypeV2.EOA
  const funderAddress = normalizeString(input.funderAddress)
  const expectedSignerAddress = normalizeString(input.expectedSignerAddress)
  const reasons: string[] = []

  if (!host) reasons.push("POLYMARKET_CLOB_HOST_MISSING")
  if (input.chainId !== Chain.POLYGON && input.chainId !== Chain.AMOY) reasons.push("POLYMARKET_CHAIN_ID_INVALID")
  if (!privateKey) reasons.push("POLYMARKET_PRIVATE_KEY_MISSING")
  if (!builderCode) reasons.push("POLYMARKET_BUILDER_CODE_MISSING")
  if (![SignatureTypeV2.EOA, SignatureTypeV2.POLY_PROXY, SignatureTypeV2.POLY_GNOSIS_SAFE, SignatureTypeV2.POLY_1271].includes(signatureType as SignatureTypeV2)) {
    reasons.push("POLYMARKET_SIGNATURE_TYPE_INVALID")
  }
  if (signatureType !== SignatureTypeV2.EOA && !funderAddress) {
    reasons.push("POLYMARKET_FUNDER_ADDRESS_MISSING")
  }

  if (reasons.length > 0) {
    return { ok: false, reasons }
  }

  let account: ReturnType<typeof privateKeyToAccount>
  try {
    account = privateKeyToAccount(privateKey as `0x${string}`)
  } catch {
    return { ok: false, reasons: ["POLYMARKET_PRIVATE_KEY_INVALID"] }
  }

  if (expectedSignerAddress && account.address.toLowerCase() !== expectedSignerAddress.toLowerCase()) {
    return { ok: false, reasons: ["POLYMARKET_SIGNER_ADDRESS_MISMATCH"] }
  }

  const signer = createWalletClient({ account, transport: http(DEFAULT_POLYGON_RPC_URL) })
  const bootstrapClient = new ClobClient({
    host,
    chain: input.chainId,
    signer,
    signatureType: signatureType as SignatureTypeV2,
    ...(funderAddress ? { funderAddress } : {}),
    useServerTime: true,
    throwOnError: false,
  })
  let creds: ApiKeyCreds
  try {
    creds = await (input.deriveApiCredentials ?? ((client) => client.createOrDeriveApiKey()))(bootstrapClient)
  } catch {
    return { ok: false, reasons: ["POLYMARKET_CLOB_API_CREDENTIAL_DERIVATION_FAILED"] }
  }

  if (!hasApiCredentials(creds)) {
    return { ok: false, reasons: ["POLYMARKET_CLOB_API_CREDENTIAL_DERIVATION_FAILED"] }
  }

  return {
    ok: true,
    client: new PolymarketClobV2LiveClient(
      new ClobClient({
        host,
        chain: input.chainId,
        signer,
        creds,
        signatureType: signatureType as SignatureTypeV2,
        ...(funderAddress ? { funderAddress } : {}),
        useServerTime: true,
        throwOnError: true,
      }),
      builderCode,
    ),
  }
}

class DryRunPolymarketTradingAdapter implements PolymarketTradingAdapter {
  readonly mode = "dry-run" as const

  constructor(private readonly readiness: TradingReadinessResult) {}

  async lookupMarket(): Promise<PolymarketMarketLookupResult | null> {
    return null
  }

  async createOrder(request: PolymarketCreateOrderRequest): Promise<PolymarketOrderRecord> {
    throw toSafeAdapterError({
      operation: "createOrder",
      payload: request,
      error: new Error("Live Polymarket trading is disabled until readiness gates pass"),
      details: this.readiness,
    })
  }

  async cancelOrder(orderId: string): Promise<PolymarketOrderRecord> {
    throw toSafeAdapterError({
      operation: "cancelOrder",
      payload: { orderId },
      error: new Error("Live Polymarket trading is disabled until readiness gates pass"),
      details: this.readiness,
    })
  }

  async getOrder(): Promise<PolymarketOrderRecord | null> {
    return null
  }

  async getTrades(): Promise<PolymarketTradeRecord[]> {
    return []
  }

  async getSpendablePusdBalance(): Promise<number | null> {
    return null
  }

  async subscribeUserUpdates(): Promise<() => void> {
    return () => undefined
  }

  async selfTest(): Promise<PolymarketHealthStatus> {
    return {
      ok: false,
      mode: this.mode,
      authenticated: false,
      reasons: this.readiness.liveReady ? [] : this.readiness.reasons.map((reason) => reason.code),
    }
  }
}

class LivePolymarketTradingAdapter implements PolymarketTradingAdapter {
  readonly mode = "live" as const

  constructor(private readonly client: PolymarketLiveClient) {}

  async lookupMarket(request: PolymarketMarketLookupRequest) {
    return this.invoke("lookupMarket", request, () => this.client.lookupMarket(request))
  }

  async createOrder(request: PolymarketCreateOrderRequest) {
    return this.invoke("createOrder", request, () => this.client.createOrder(request))
  }

  async cancelOrder(orderId: string) {
    return this.invoke("cancelOrder", { orderId }, () => this.client.cancelOrder(orderId))
  }

  async getOrder(orderId: string) {
    return this.invoke("getOrder", { orderId }, () => this.client.getOrder(orderId))
  }

  async getTrades(request: PolymarketGetTradesRequest) {
    return this.invoke("getTrades", request, () => this.client.getTrades(request))
  }

  async getSpendablePusdBalance() {
    return this.invoke("getSpendablePusdBalance", {}, () => this.client.getSpendablePusdBalance())
  }

  async subscribeUserUpdates(listener: (update: PolymarketUserUpdate) => void) {
    return this.invoke("subscribeUserUpdates", { listener: "[listener]" }, async () => {
      const unsubscribe = await this.client.subscribeUserUpdates(listener)
      return typeof unsubscribe === "function" ? unsubscribe : () => undefined
    })
  }

  async selfTest(): Promise<PolymarketHealthStatus> {
    return this.invoke("selfTest", {}, async () => {
      const status = await this.client.selfTest()
      return {
        ...status,
        mode: this.mode,
      }
    })
  }

  private async invoke<T>(operation: string, payload: unknown, run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      throw toSafeAdapterError({ operation, payload, error })
    }
  }
}

export class MockPolymarketTradingAdapter implements PolymarketTradingAdapter {
  readonly mode = "mock" as const
  private readonly marketsBySlug = new Map<string, PolymarketMarketLookupResult>()
  private readonly marketsByTokenId = new Map<string, PolymarketMarketLookupResult>()
  private readonly orders = new Map<string, PolymarketOrderRecord>()
  private readonly trades = new Map<string, PolymarketTradeRecord[]>()
  private readonly createOrderOutcomes: MockCreateOrderOutcome[] = []
  private readonly cancelOrderOutcomes: MockCancelOrderOutcome[] = []
  private readonly calls: MockPolymarketCall[] = []
  private readonly subscribers = new Set<(update: PolymarketUserUpdate) => void>()
  private readonly emittedUserUpdates: PolymarketUserUpdate[] = []
  private spendablePusdBalance: number | null = 2_000
  private nextOrderSequence = 1
  private nextTradeSequence = 1

  seedMarket(market: PolymarketMarketLookupResult) {
    this.marketsBySlug.set(market.marketSlug, market)
    for (const token of market.tokens) {
      this.marketsByTokenId.set(token.tokenId, market)
    }
  }

  enqueueCreateOrderOutcome(outcome: MockCreateOrderOutcome) {
    this.createOrderOutcomes.push(outcome)
  }

  enqueueCancelOrderOutcome(outcome: MockCancelOrderOutcome) {
    this.cancelOrderOutcomes.push(outcome)
  }

  getRecordedCalls() {
    return [...this.calls]
  }

  setSpendablePusdBalance(balance: number | null) {
    this.spendablePusdBalance = balance
  }

  drainUserUpdates() {
    const updates = [...this.emittedUserUpdates]
    this.emittedUserUpdates.length = 0
    return updates
  }

  disconnectUserUpdates(recordedAt = nowIso()) {
    this.publishUpdate({ type: "disconnect", recordedAt })
  }

  updateOrder(
    orderId: string,
    patch: Partial<PolymarketOrderRecord>,
    options: { emitUserUpdate?: boolean } = {},
  ) {
    const existing = this.orders.get(orderId)
    if (!existing) {
      throw new Error(`Unknown mock order ${orderId}`)
    }

    const nextOrder: PolymarketOrderRecord = {
      ...existing,
      ...patch,
      orderId,
      updatedAt: patch.updatedAt ?? nowIso(),
      clientOrderId: patch.clientOrderId ?? existing.clientOrderId,
    }
    this.orders.set(orderId, nextOrder)

    if (options.emitUserUpdate ?? true) {
      this.publishUpdate({ type: "order", order: nextOrder, recordedAt: nextOrder.updatedAt })
    }

    return nextOrder
  }

  addTrade(
    orderId: string,
    input: Omit<PolymarketTradeRecord, "orderId" | "clientOrderId"> & { clientOrderId?: string | null },
    options: { emitUserUpdate?: boolean } = {},
  ) {
    const order = this.orders.get(orderId)
    if (!order) {
      throw new Error(`Unknown mock order ${orderId}`)
    }

    const trade: PolymarketTradeRecord = {
      ...input,
      orderId,
      clientOrderId: input.clientOrderId ?? order.clientOrderId,
    }
    const existingTrades = this.trades.get(orderId) ?? []
    this.trades.set(orderId, [...existingTrades, trade])

    if (options.emitUserUpdate ?? true) {
      this.publishUpdate({ type: "trade", trade, recordedAt: trade.createdAt })
    }

    return trade
  }

  async lookupMarket(request: PolymarketMarketLookupRequest): Promise<PolymarketMarketLookupResult | null> {
    this.recordCall("lookupMarket", request)

    const marketSlug = normalizeString(request.marketSlug)
    if (marketSlug) {
      return this.marketsBySlug.get(marketSlug) ?? null
    }

    const tokenId = normalizeString(request.tokenId)
    if (tokenId) {
      return this.marketsByTokenId.get(tokenId) ?? null
    }

    if (normalizeString(request.conditionId)) {
      return (
        [...this.marketsBySlug.values()].find((market) => market.conditionId === request.conditionId) ?? null
      )
    }

    return null
  }

  async createOrder(request: PolymarketCreateOrderRequest): Promise<PolymarketOrderRecord> {
    this.recordCall("createOrder", request)
    const outcome = this.createOrderOutcomes.shift() ?? { type: "accept" as const }
    const orderId =
      "orderId" in outcome && outcome.orderId ? outcome.orderId : `mock-order-${this.nextOrderSequence++}`

    switch (outcome.type) {
      case "accept": {
        const order = createBaseOrder(request, orderId, { status: "open" })
        this.orders.set(order.orderId, order)
        this.publishUpdate({ type: "order", order, recordedAt: nowIso() })
        return order
      }
      case "partial-fill": {
        const matchedSize = Math.min(request.size, Math.max(0, outcome.matchedSize))
        const order = createBaseOrder(request, orderId, {
          status: matchedSize >= request.size ? "filled" : "partially-filled",
          matchedSize,
          remainingSize: Math.max(0, request.size - matchedSize),
        })
        this.orders.set(order.orderId, order)
        const trade: PolymarketTradeRecord = {
          tradeId: outcome.tradeId ?? `mock-trade-${this.nextTradeSequence++}`,
          orderId: order.orderId,
          clientOrderId: request.clientOrderId ?? null,
          marketId: request.marketId,
          tokenId: request.tokenId,
          side: request.side,
          price: request.price,
          size: matchedSize,
          createdAt: nowIso(),
        }
        this.trades.set(order.orderId, [trade])
        this.publishUpdate({ type: "order", order, recordedAt: nowIso() })
        this.publishUpdate({ type: "trade", trade, recordedAt: nowIso() })
        return order
      }
      case "duplicate":
        throw toSafeAdapterError({
          operation: "createOrder",
          payload: request,
          error: { status: 409, message: outcome.message ?? "Duplicate order", retryAfterMs: null },
          details: {
            duplicateOfOrderId: outcome.duplicateOfOrderId,
            details: outcome.details,
          },
          sensitiveValues: outcome.sensitiveValues,
        })
      case "reject":
        throw toSafeAdapterError({
          operation: "createOrder",
          payload: request,
          error: { status: 422, message: outcome.message ?? "Order rejected" },
          details: outcome.details,
          sensitiveValues: outcome.sensitiveValues,
        })
      case "timeout":
        if (outcome.persistedOrderId) {
          const matchedSize = Math.min(request.size, Math.max(0, outcome.matchedSize ?? 0))
          const persistedOrder = createBaseOrder(request, outcome.persistedOrderId, {
            status: matchedSize >= request.size ? "filled" : matchedSize > 0 ? "partially-filled" : "open",
            matchedSize,
            remainingSize: Math.max(0, request.size - matchedSize),
          })
          this.orders.set(persistedOrder.orderId, persistedOrder)

          if (matchedSize > 0) {
            const trade: PolymarketTradeRecord = {
              tradeId: outcome.tradeId ?? `mock-trade-${this.nextTradeSequence++}`,
              orderId: persistedOrder.orderId,
              clientOrderId: outcome.omitClientOrderIdFromTrade ? null : request.clientOrderId ?? null,
              marketId: request.marketId,
              tokenId: request.tokenId,
              side: request.side,
              price: request.price,
              size: matchedSize,
              createdAt: nowIso(),
            }
            this.trades.set(persistedOrder.orderId, [trade])

            if (outcome.emitUserUpdate) {
              this.publishUpdate({ type: "trade", trade, recordedAt: trade.createdAt })
            }
          }

          if (outcome.emitUserUpdate) {
            this.publishUpdate({ type: "order", order: persistedOrder, recordedAt: persistedOrder.updatedAt })
          }
        }

        throw toSafeAdapterError({
          operation: "createOrder",
          payload: request,
          error: { message: outcome.message ?? "Request timed out", name: "AbortError" },
          details: outcome.details,
          sensitiveValues: outcome.sensitiveValues,
        })
      case "rate-limit":
        throw toSafeAdapterError({
          operation: "createOrder",
          payload: request,
          error: {
            status: 429,
            message: outcome.message ?? "Rate limit exceeded",
            retryAfterMs: outcome.retryAfterMs,
          },
          details: outcome.details,
          sensitiveValues: outcome.sensitiveValues,
        })
    }
  }

  async cancelOrder(orderId: string): Promise<PolymarketOrderRecord> {
    this.recordCall("cancelOrder", { orderId })
    const outcome = this.cancelOrderOutcomes.shift() ?? { type: "cancel" as const }
    const existing = this.orders.get(orderId)

    switch (outcome.type) {
      case "cancel": {
        if (!existing) {
          throw toSafeAdapterError({
            operation: "cancelOrder",
            payload: { orderId },
            error: { status: 422, message: "Order rejected: unknown order" },
          })
        }

        const canceledOrder: PolymarketOrderRecord = {
          ...existing,
          status: "canceled",
          remainingSize: Math.max(0, existing.size - existing.matchedSize),
          updatedAt: nowIso(),
          reason: outcome.message ?? existing.reason,
        }
        this.orders.set(orderId, canceledOrder)
        this.publishUpdate({ type: "order", order: canceledOrder, recordedAt: nowIso() })
        return canceledOrder
      }
      case "reject":
        throw toSafeAdapterError({
          operation: "cancelOrder",
          payload: { orderId },
          error: { status: 422, message: outcome.message ?? "Cancel rejected" },
          details: outcome.details,
          sensitiveValues: outcome.sensitiveValues,
        })
      case "timeout":
        throw toSafeAdapterError({
          operation: "cancelOrder",
          payload: { orderId },
          error: { message: outcome.message ?? "Cancel timed out", name: "AbortError" },
          details: outcome.details,
          sensitiveValues: outcome.sensitiveValues,
        })
      case "rate-limit":
        throw toSafeAdapterError({
          operation: "cancelOrder",
          payload: { orderId },
          error: {
            status: 429,
            message: outcome.message ?? "Cancel rate limited",
            retryAfterMs: outcome.retryAfterMs,
          },
          details: outcome.details,
          sensitiveValues: outcome.sensitiveValues,
        })
    }
  }

  async getOrder(orderId: string): Promise<PolymarketOrderRecord | null> {
    this.recordCall("getOrder", { orderId })
    return this.orders.get(orderId) ?? null
  }

  async getTrades(request: PolymarketGetTradesRequest): Promise<PolymarketTradeRecord[]> {
    this.recordCall("getTrades", request)
    const allTrades = [...this.trades.values()].flat()

    return allTrades.filter((trade) => {
      if (request.orderId && trade.orderId !== request.orderId) {
        return false
      }

      if (request.marketId && trade.marketId !== request.marketId) {
        return false
      }

      if (request.tokenId && trade.tokenId !== request.tokenId) {
        return false
      }

      return true
    })
  }

  async getSpendablePusdBalance(): Promise<number | null> {
    this.recordCall("getSpendablePusdBalance", {})
    return this.spendablePusdBalance
  }

  async subscribeUserUpdates(listener: (update: PolymarketUserUpdate) => void): Promise<() => void> {
    this.recordCall("subscribeUserUpdates", { listener: "[listener]" })
    this.subscribers.add(listener)
    return () => {
      this.subscribers.delete(listener)
    }
  }

  async selfTest(): Promise<PolymarketHealthStatus> {
    this.recordCall("selfTest", {})
    return {
      ok: true,
      mode: this.mode,
      authenticated: true,
      reasons: [],
    }
  }

  private publishUpdate(update: PolymarketUserUpdate) {
    this.emittedUserUpdates.push(update)
    for (const subscriber of this.subscribers) {
      subscriber(update)
    }
  }

  private recordCall(operation: MockPolymarketCall["operation"], payload: unknown) {
    this.calls.push({ operation, payload, recordedAt: nowIso() })
  }
}

export const buildPolymarketTradingAdapter = (
  input: BuildPolymarketTradingAdapterInput,
): PolymarketTradingAdapter => {
  if (input.requestedMode === "mock") {
    return input.mockAdapter ?? new MockPolymarketTradingAdapter()
  }

  if (input.requestedMode === "live" && input.liveClient) {
    return new LivePolymarketTradingAdapter(input.liveClient)
  }

  return new DryRunPolymarketTradingAdapter(input.readiness)
}
