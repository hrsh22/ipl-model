import { afterEach, describe, expect, test, vi } from 'vitest'

import { validateTradingRecipe, type TradingReadinessResult } from '../src/trading/config.js'
import { buildPolymarketTradingAdapter } from '../src/trading/polymarket-adapter.js'
import { buildTradeIntentKey, type TradingExecutionEventRecord, type TradingExposureLedgerRecord, type TradingIntentRecord, type TradingRecipeRecord } from '../src/trading/repository.js'
import type { TradingExecutorStore } from '../src/trading/executor.js'

const FIXED_NOW = new Date('2026-05-11T10:00:00.000Z')
const DAY_START = new Date('2026-05-11T00:00:00.000Z')
const DAY_END = new Date('2026-05-12T00:00:00.000Z')
const originalEnv = { ...process.env }

const buildRecipeRecord = (): TradingRecipeRecord => ({
  recipeKey: 'recipe:runtime-test',
  strategyKey: 'eleven-over',
  recipeVersion: '2026-05-11-v1',
  windowKey: '2026-05-11-v1:fixture-1:innings-2:balls-66-72',
  fixtureId: 'fixture-1',
  marketId: 'market-1',
  conditionId: 'condition-1',
  tokenId: 'token-1',
  side: 'buy',
  orderStyle: 'limit',
  maxPrice: 0.42,
  size: 952.380952,
  expiryTime: new Date('2026-05-11T12:00:00.000Z'),
  context: { strategy: '11-over' },
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
})

const buildIntentRecord = (recipe = buildRecipeRecord()): TradingIntentRecord => ({
  id: 1,
  intentKey: buildTradeIntentKey({
    strategyKey: recipe.strategyKey,
    recipeVersion: recipe.recipeVersion,
    windowKey: recipe.windowKey,
    fixtureId: recipe.fixtureId,
    marketId: recipe.marketId,
    tokenId: recipe.tokenId,
    side: 'buy',
  }),
  recipeKey: recipe.recipeKey,
  strategyKey: recipe.strategyKey,
  recipeVersion: recipe.recipeVersion,
  windowKey: recipe.windowKey,
  fixtureId: recipe.fixtureId,
  marketId: recipe.marketId,
  conditionId: recipe.conditionId,
  tokenId: recipe.tokenId,
  side: 'buy',
  status: 'pending',
  claimCount: 0,
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  context: { observedAt: FIXED_NOW.toISOString() },
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
})

class RuntimeStore implements TradingExecutorStore {
  events: TradingExecutionEventRecord[] = []
  exposures: TradingExposureLedgerRecord[] = []
  private nextEventId = 1
  private nextExposureId = 1

  constructor(
    private intent: TradingIntentRecord,
    private recipe: TradingRecipeRecord,
  ) {}

  async claimNextTradeIntent(params: { workerId: string; leaseMs: number; now: Date }) {
    if (this.intent.status !== 'pending') return null
    this.intent = {
      ...this.intent,
      status: 'claimed',
      claimedBy: params.workerId,
      claimedAt: params.now,
      claimExpiresAt: new Date(params.now.getTime() + params.leaseMs),
      claimCount: this.intent.claimCount + 1,
      updatedAt: params.now,
    }
    return this.intent
  }

  async getTradeIntentById() { return this.intent }
  async getTradingRecipe() { return this.recipe }
  async listTradingExecutionEvents() { return this.events }
  async listTradingExposureLedgerEntries() { return this.exposures }
  async appendTradingExecutionEvent(input: { intentId: number; eventType: string; eventTime: Date; processedAt?: Date; executorId?: string | null; details?: Record<string, unknown> }) {
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

  async appendTradingExposureLedgerEntry(input: { intentId?: number | null; fixtureId: string; marketId: string; tokenId: string; side: 'buy' | 'sell'; entryType: string; quantity?: number | null; notionalUsd: number; eventTime: Date; processedAt?: Date; details?: Record<string, unknown> }) {
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

  async updateTradeIntentStatus(input: { intentId: number; status: 'pending' | 'claimed' | 'submitted' | 'completed' | 'failed'; updatedAt?: Date; lastErrorCode?: string | null; lastErrorMessage?: string | null; claimedBy?: string | null; claimedAt?: Date | null; claimExpiresAt?: Date | null }) {
    this.intent = {
      ...this.intent,
      status: input.status,
      updatedAt: input.updatedAt ?? this.intent.updatedAt,
      lastErrorCode: 'lastErrorCode' in input ? input.lastErrorCode ?? null : this.intent.lastErrorCode,
      lastErrorMessage: 'lastErrorMessage' in input ? input.lastErrorMessage ?? null : this.intent.lastErrorMessage,
      claimedBy: 'claimedBy' in input ? input.claimedBy ?? null : this.intent.claimedBy,
      claimedAt: 'claimedAt' in input ? input.claimedAt ?? null : this.intent.claimedAt,
      claimExpiresAt: 'claimExpiresAt' in input ? input.claimExpiresAt ?? null : this.intent.claimExpiresAt,
    }
    return this.intent
  }
}

afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe('trading runtime executor loop', () => {
  test('processes a pending intent through TradingExecutor in dry-run mode without venue submission', async () => {
    process.env = {
      ...originalEnv,
      PORT: '8080',
      LOG_LEVEL: 'info',
      DATABASE_URL: 'postgresql://localhost:5432/ipl_trader_test',
    }
    vi.resetModules()
    const { createTradingRuntimeService } = await import('../src/trading/runtime.js')
    const recipe = buildRecipeRecord()
    const store = new RuntimeStore(buildIntentRecord(recipe), recipe)
    const adapter = buildPolymarketTradingAdapter({
      requestedMode: 'dry-run',
      readiness: { liveReady: false, mode: 'dry-run', reasons: [{ code: 'ENV_LIVE_GATE_DISABLED' }] },
    })
    const validatedRecipe = validateTradingRecipe({
      marketId: recipe.marketId,
      conditionId: recipe.conditionId,
      tokenId: recipe.tokenId,
      side: 'buy',
      orderStyle: 'limit',
      maxPrice: recipe.maxPrice,
      expiryEpochMs: recipe.expiryTime.getTime(),
    })
    if (!validatedRecipe.ok) throw new Error('Expected valid recipe')

    const runtime = await createTradingRuntimeService({
      enabled: false,
      intervalMs: 5000,
      leaseMs: 30000,
      workerId: 'runtime-test-worker',
      maxMatchStateAgeMs: 30000,
      maxBookAgeMs: 15000,
      dailyBoundaryTimezone: 'UTC',
      adapter,
      store,
      now: () => FIXED_NOW,
      getRuntimeTradingEnabled: async () => true,
      buildEvaluationContext: async () => ({
        readiness: { liveReady: true, mode: 'live', recipe: validatedRecipe.value, reasons: [] } satisfies TradingReadinessResult,
        marketStatus: 'open',
        currentTokenId: recipe.tokenId,
        balanceAvailableUsd: 2000,
        matchStateAgeMs: 1000,
        maxMatchStateAgeMs: 30000,
        bookAgeMs: 1000,
        maxBookAgeMs: 15000,
        dayWindow: { start: DAY_START, end: DAY_END },
      }),
    })

    await runtime.processOnce()

    expect(store.events.map((event) => event.eventType)).toEqual([
      'detected',
      'eligible',
      'approved',
      'submitted',
      'acknowledged',
    ])
    expect(store.exposures.map((entry) => entry.entryType)).toEqual(['submitted_notional', 'pending_order'])
    expect(adapter.mode).toBe('dry-run')
  })
})
