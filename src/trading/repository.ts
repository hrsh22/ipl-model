import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm"

import { db } from "../database.js"
import {
  tradingExecutionEvents,
  tradingExposureLedger,
  tradingReconciliationCheckpoints,
  tradingRecipes,
  tradingRuntimeFlags,
  tradingTradeIntents,
} from "../db/schema.js"
import type { TradingOrderStyle, TradingSide } from "./config.js"

export type TradingRuntimeFlagRecord = typeof tradingRuntimeFlags.$inferSelect
export type TradingRecipeRecord = typeof tradingRecipes.$inferSelect
export type TradingIntentRecord = typeof tradingTradeIntents.$inferSelect
export type TradingExecutionEventRecord = typeof tradingExecutionEvents.$inferSelect
export type TradingExposureLedgerRecord = typeof tradingExposureLedger.$inferSelect
export type TradingReconciliationCheckpointRecord =
  typeof tradingReconciliationCheckpoints.$inferSelect

export type TradeIntentStatus = "pending" | "claimed" | "submitted" | "completed" | "failed"

export interface DeterministicTradeIntentIdentity {
  strategyKey: string
  recipeVersion: string
  windowKey: string
  fixtureId: string
  marketId: string
  tokenId: string
  side: TradingSide
}

export interface TradingRecipeUpsertInput extends DeterministicTradeIntentIdentity {
  recipeKey?: string
  conditionId: string
  orderStyle: TradingOrderStyle
  maxPrice: number
  size: number
  expiryTime: Date
  context?: Record<string, unknown> | null
}

export interface TradingRuntimeFlagUpsertInput {
  flagKey: string
  enabled: boolean
  reason?: string | null
  updatedBy?: string | null
  details?: Record<string, unknown> | null
}

export interface CreateTradeIntentInput extends DeterministicTradeIntentIdentity {
  intentKey?: string
  recipeKey: string
  conditionId: string
  status?: TradeIntentStatus
  context?: Record<string, unknown> | null
}

export interface CreateTradeIntentResult {
  created: boolean
  record: TradingIntentRecord
}

export interface ClaimTradeIntentParams {
  workerId: string
  now?: Date
  leaseMs: number
  limit?: number
}

export interface AppendTradingExecutionEventInput {
  intentId: number
  eventType: string
  eventTime: Date
  processedAt?: Date
  executorId?: string | null
  details?: Record<string, unknown>
}

export interface AppendTradingExposureLedgerInput {
  intentId?: number | null
  fixtureId: string
  marketId: string
  tokenId: string
  side: TradingSide
  entryType: string
  quantity?: number | null
  notionalUsd: number
  eventTime: Date
  processedAt?: Date
  details?: Record<string, unknown>
}

export interface UpsertTradingReconciliationCheckpointInput {
  checkpointKey: string
  lastCursor?: string | null
  lastReconciledAt?: Date | null
  details?: Record<string, unknown> | null
}

export interface UpdateTradeIntentStatusInput {
  intentId: number
  status: TradeIntentStatus
  updatedAt?: Date
  lastErrorCode?: string | null
  lastErrorMessage?: string | null
  claimedBy?: string | null
  claimedAt?: Date | null
  claimExpiresAt?: Date | null
}

export interface ListTradingExposureLedgerEntriesParams {
  fixtureId?: string
  marketId?: string
  tokenId?: string
  startTime?: Date
  endTime?: Date
}

export interface ListTradingIntentRecordsParams {
  limit?: number
  status?: TradeIntentStatus
}

export interface ListTradingExecutionEventsParams {
  intentId?: number
  limit?: number
}

export interface TradingPersistenceStore {
  insertTradeIntent: (intent: typeof tradingTradeIntents.$inferInsert) => Promise<TradingIntentRecord | null>
  findTradeIntentByKey: (intentKey: string) => Promise<TradingIntentRecord | null>
  listClaimableTradeIntentIds: (now: Date, limit: number) => Promise<number[]>
  tryClaimTradeIntent: (
    intentId: number,
    workerId: string,
    claimedAt: Date,
    claimExpiresAt: Date,
  ) => Promise<TradingIntentRecord | null>
}

const defaultClaimLimit = 10

const encodeKeyPart = (value: string) => encodeURIComponent(value.trim())

export const buildTradeIntentKey = (input: DeterministicTradeIntentIdentity) =>
  [
    input.strategyKey,
    input.recipeVersion,
    input.windowKey,
    input.fixtureId,
    input.marketId,
    input.tokenId,
    input.side,
  ]
    .map(encodeKeyPart)
    .join(":")

export const buildTradeRecipeKey = (input: DeterministicTradeIntentIdentity) =>
  `recipe:${buildTradeIntentKey(input)}`

export const buildTradingExecutionEventInsert = (input: AppendTradingExecutionEventInput) => ({
  intentId: input.intentId,
  eventType: input.eventType,
  eventTime: input.eventTime,
  processedAt: input.processedAt ?? new Date(),
  executorId: input.executorId ?? null,
  details: input.details ?? {},
})

export const buildTradingExposureLedgerInsert = (input: AppendTradingExposureLedgerInput) => ({
  intentId: input.intentId ?? null,
  fixtureId: input.fixtureId,
  marketId: input.marketId,
  tokenId: input.tokenId,
  side: input.side,
  entryType: input.entryType,
  quantity: input.quantity ?? null,
  notionalUsd: input.notionalUsd,
  eventTime: input.eventTime,
  processedAt: input.processedAt ?? new Date(),
  details: input.details ?? {},
})

const buildClaimableTradeIntentWhere = (now: Date) =>
  and(
    or(
      eq(tradingTradeIntents.status, "pending"),
      eq(tradingTradeIntents.status, "claimed"),
      eq(tradingTradeIntents.status, "submitted"),
    ),
    or(
      isNull(tradingTradeIntents.claimExpiresAt),
      lte(tradingTradeIntents.claimExpiresAt, now),
    ),
  )

const databaseTradingPersistenceStore: TradingPersistenceStore = {
  insertTradeIntent: async (intent) => {
    const rows = await db
      .insert(tradingTradeIntents)
      .values(intent)
      .onConflictDoNothing({ target: tradingTradeIntents.intentKey })
      .returning()

    return rows[0] ?? null
  },
  findTradeIntentByKey: async (intentKey) => {
    const rows = await db
      .select()
      .from(tradingTradeIntents)
      .where(eq(tradingTradeIntents.intentKey, intentKey))
      .limit(1)

    return rows[0] ?? null
  },
  listClaimableTradeIntentIds: async (now, limit) => {
    const rows = await db
      .select({ id: tradingTradeIntents.id })
      .from(tradingTradeIntents)
      .where(buildClaimableTradeIntentWhere(now))
      .orderBy(asc(tradingTradeIntents.createdAt), asc(tradingTradeIntents.id))
      .limit(limit)

    return rows.map((row) => row.id)
  },
  tryClaimTradeIntent: async (intentId, workerId, claimedAt, claimExpiresAt) => {
    const rows = await db
      .update(tradingTradeIntents)
      .set({
        status: "claimed",
        claimedBy: workerId,
        claimedAt,
        claimExpiresAt,
        claimCount: sql`${tradingTradeIntents.claimCount} + 1`,
        updatedAt: claimedAt,
      })
      .where(
        and(
          eq(tradingTradeIntents.id, intentId),
          buildClaimableTradeIntentWhere(claimedAt),
        ),
      )
      .returning()

    return rows[0] ?? null
  },
}

export const upsertTradingRuntimeFlag = async (input: TradingRuntimeFlagUpsertInput) => {
  await db.insert(tradingRuntimeFlags).values(input).onConflictDoUpdate({
    target: tradingRuntimeFlags.flagKey,
    set: {
      enabled: input.enabled,
      reason: input.reason ?? null,
      updatedBy: input.updatedBy ?? null,
      details: input.details ?? null,
      updatedAt: new Date(),
    },
  })
}

export const getTradingRuntimeFlag = async (flagKey: string) => {
  const rows = await db
    .select()
    .from(tradingRuntimeFlags)
    .where(eq(tradingRuntimeFlags.flagKey, flagKey))
    .limit(1)

  return rows[0] ?? null
}

export const upsertTradingRecipe = async (input: TradingRecipeUpsertInput) => {
  const recipeKey = input.recipeKey ?? buildTradeRecipeKey(input)
  const record: typeof tradingRecipes.$inferInsert = {
    recipeKey,
    strategyKey: input.strategyKey,
    recipeVersion: input.recipeVersion,
    windowKey: input.windowKey,
    fixtureId: input.fixtureId,
    marketId: input.marketId,
    conditionId: input.conditionId,
    tokenId: input.tokenId,
    side: input.side,
    orderStyle: input.orderStyle,
    maxPrice: input.maxPrice,
    size: input.size,
    expiryTime: input.expiryTime,
    context: input.context ?? null,
  }

  const rows = await db
    .insert(tradingRecipes)
    .values(record)
    .onConflictDoUpdate({
      target: tradingRecipes.recipeKey,
      set: {
        strategyKey: record.strategyKey,
        recipeVersion: record.recipeVersion,
        windowKey: record.windowKey,
        fixtureId: record.fixtureId,
        marketId: record.marketId,
        conditionId: record.conditionId,
        tokenId: record.tokenId,
        side: record.side,
        orderStyle: record.orderStyle,
        maxPrice: record.maxPrice,
        size: record.size,
        expiryTime: record.expiryTime,
        context: record.context,
        updatedAt: new Date(),
      },
    })
    .returning()

  return rows[0] ?? null
}

export const createTradeIntentWithStore = async (
  store: TradingPersistenceStore,
  input: CreateTradeIntentInput,
): Promise<CreateTradeIntentResult> => {
  const intentKey = input.intentKey ?? buildTradeIntentKey(input)
  const record: typeof tradingTradeIntents.$inferInsert = {
    intentKey,
    recipeKey: input.recipeKey,
    strategyKey: input.strategyKey,
    recipeVersion: input.recipeVersion,
    windowKey: input.windowKey,
    fixtureId: input.fixtureId,
    marketId: input.marketId,
    conditionId: input.conditionId,
    tokenId: input.tokenId,
    side: input.side,
    status: input.status ?? "pending",
    context: input.context ?? null,
  }

  const inserted = await store.insertTradeIntent(record)
  if (inserted) {
    return { created: true, record: inserted }
  }

  const existing = await store.findTradeIntentByKey(intentKey)
  if (!existing) {
    throw new Error(`Trade intent conflict fallback failed for intentKey=${intentKey}`)
  }

  return { created: false, record: existing }
}

export const createTradeIntent = async (input: CreateTradeIntentInput) =>
  createTradeIntentWithStore(databaseTradingPersistenceStore, input)

export const claimNextTradeIntentWithStore = async (
  store: TradingPersistenceStore,
  params: ClaimTradeIntentParams,
) => {
  const now = params.now ?? new Date()
  const limit = params.limit ?? defaultClaimLimit
  const claimExpiresAt = new Date(now.getTime() + params.leaseMs)
  const candidateIds = await store.listClaimableTradeIntentIds(now, limit)

  for (const intentId of candidateIds) {
    const claimed = await store.tryClaimTradeIntent(intentId, params.workerId, now, claimExpiresAt)
    if (claimed) {
      return claimed
    }
  }

  return null
}

export const claimNextTradeIntent = async (params: ClaimTradeIntentParams) =>
  claimNextTradeIntentWithStore(databaseTradingPersistenceStore, params)

export const appendTradingExecutionEvent = async (input: AppendTradingExecutionEventInput) => {
  const rows = await db
    .insert(tradingExecutionEvents)
    .values(buildTradingExecutionEventInsert(input))
    .returning()

  return rows[0] ?? null
}

export const appendTradingExposureLedgerEntry = async (input: AppendTradingExposureLedgerInput) => {
  const rows = await db
    .insert(tradingExposureLedger)
    .values(buildTradingExposureLedgerInsert(input))
    .returning()

  return rows[0] ?? null
}

export const getTradingRecipe = async (recipeKey: string) => {
  const rows = await db.select().from(tradingRecipes).where(eq(tradingRecipes.recipeKey, recipeKey)).limit(1)

  return rows[0] ?? null
}

export const getTradeIntentById = async (intentId: number) => {
  const rows = await db.select().from(tradingTradeIntents).where(eq(tradingTradeIntents.id, intentId)).limit(1)

  return rows[0] ?? null
}

export const listTradingRecipes = async (limit = 20) => {
  return db
    .select()
    .from(tradingRecipes)
    .orderBy(desc(tradingRecipes.updatedAt), desc(tradingRecipes.createdAt), desc(tradingRecipes.recipeKey))
    .limit(limit)
}

export const listTradingIntents = async (params: ListTradingIntentRecordsParams = {}) => {
  const limit = params.limit ?? 50

  return db
    .select()
    .from(tradingTradeIntents)
    .where(params.status ? eq(tradingTradeIntents.status, params.status) : undefined)
    .orderBy(desc(tradingTradeIntents.createdAt), desc(tradingTradeIntents.id))
    .limit(limit)
}

export const updateTradeIntentStatus = async (input: UpdateTradeIntentStatusInput) => {
  const updatedAt = input.updatedAt ?? new Date()
  const patch: Record<string, unknown> = {
    status: input.status,
    updatedAt,
  }

  if ("lastErrorCode" in input) {
    patch.lastErrorCode = input.lastErrorCode ?? null
  }

  if ("lastErrorMessage" in input) {
    patch.lastErrorMessage = input.lastErrorMessage ?? null
  }

  if ("claimedBy" in input) {
    patch.claimedBy = input.claimedBy ?? null
  }

  if ("claimedAt" in input) {
    patch.claimedAt = input.claimedAt ?? null
  }

  if ("claimExpiresAt" in input) {
    patch.claimExpiresAt = input.claimExpiresAt ?? null
  }

  const rows = await db
    .update(tradingTradeIntents)
    .set(patch)
    .where(eq(tradingTradeIntents.id, input.intentId))
    .returning()

  return rows[0] ?? null
}

export const listTradingExecutionEvents = async (intentId: number) => {
  return db
    .select()
    .from(tradingExecutionEvents)
    .where(eq(tradingExecutionEvents.intentId, intentId))
    .orderBy(asc(tradingExecutionEvents.eventTime), asc(tradingExecutionEvents.id))
}

export const listRecentTradingExecutionEvents = async (
  params: ListTradingExecutionEventsParams = {},
) => {
  const limit = params.limit ?? 50

  return db
    .select()
    .from(tradingExecutionEvents)
    .where(params.intentId ? eq(tradingExecutionEvents.intentId, params.intentId) : undefined)
    .orderBy(desc(tradingExecutionEvents.eventTime), desc(tradingExecutionEvents.id))
    .limit(limit)
}

export const listTradingExposureLedgerEntries = async (
  params: ListTradingExposureLedgerEntriesParams = {},
) => {
  const conditions = []

  if (params.fixtureId) {
    conditions.push(eq(tradingExposureLedger.fixtureId, params.fixtureId))
  }

  if (params.marketId) {
    conditions.push(eq(tradingExposureLedger.marketId, params.marketId))
  }

  if (params.tokenId) {
    conditions.push(eq(tradingExposureLedger.tokenId, params.tokenId))
  }

  if (params.startTime) {
    conditions.push(sql`${tradingExposureLedger.eventTime} >= ${params.startTime}`)
  }

  if (params.endTime) {
    conditions.push(sql`${tradingExposureLedger.eventTime} < ${params.endTime}`)
  }

  const query = db.select().from(tradingExposureLedger)

  return query
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(tradingExposureLedger.eventTime), asc(tradingExposureLedger.id))
}

export const getTradingReconciliationCheckpoint = async (checkpointKey: string) => {
  const rows = await db
    .select()
    .from(tradingReconciliationCheckpoints)
    .where(eq(tradingReconciliationCheckpoints.checkpointKey, checkpointKey))
    .limit(1)

  return rows[0] ?? null
}

export const upsertTradingReconciliationCheckpoint = async (
  input: UpsertTradingReconciliationCheckpointInput,
) => {
  await db
    .insert(tradingReconciliationCheckpoints)
    .values({
      checkpointKey: input.checkpointKey,
      lastCursor: input.lastCursor ?? null,
      lastReconciledAt: input.lastReconciledAt ?? null,
      details: input.details ?? null,
    })
    .onConflictDoUpdate({
      target: tradingReconciliationCheckpoints.checkpointKey,
      set: {
        lastCursor: input.lastCursor ?? null,
        lastReconciledAt: input.lastReconciledAt ?? null,
        details: input.details ?? null,
        updatedAt: new Date(),
      },
    })
}
