import { describe, expect, test } from 'vitest'

import {
  SCOREBOARD_SIDE_STRATEGY_KEY,
  SCOREBOARD_SIDE_WINDOW_KEY,
  evaluateScoreboardSideStrategy,
} from '../src/ipl/scoreboard-side-strategy.js'
import {
  createObserverTradeIntent,
  type ObserverIntentSignalInput,
  type ObserverTradeIntentRepository,
} from '../src/trading/observer-intents.js'
import { TradingExecutor, type TradingExecutorEvaluationContext, type TradingExecutorStore } from '../src/trading/executor.js'
import { validateTradingRecipe, type TradingOrderStyle, type TradingReadinessResult, type TradingSide } from '../src/trading/config.js'
import {
  MockPolymarketTradingAdapter,
  type PolymarketCreateOrderRequest,
  type PolymarketGetTradesRequest,
  type PolymarketHealthStatus,
  type PolymarketMarketLookupRequest,
  type PolymarketMarketLookupResult,
  type PolymarketOrderRecord,
  type PolymarketTradingAdapter,
} from '../src/trading/polymarket-adapter.js'
import {
  buildTradeIntentKey,
  buildTradeRecipeKey,
  type AppendTradingExecutionEventInput,
  type AppendTradingExposureLedgerInput,
  type CreateTradeIntentInput,
  type CreateTradeIntentResult,
  type TradingExecutionEventRecord,
  type TradingExposureLedgerRecord,
  type TradingIntentRecord,
  type TradingRecipeRecord,
} from '../src/trading/repository.js'
import { calculateTradingExposureSummary } from '../src/trading/policy.js'

const FIXED_NOW = new Date('2026-05-11T10:12:00.000Z')
const DAY_START = new Date('2026-05-11T00:00:00.000Z')
const DAY_END = new Date('2026-05-12T00:00:00.000Z')
const SCOREBOARD_SIDE_RECIPE_VERSION = 'v1-value90'
const WINDOW_KEY = SCOREBOARD_SIDE_WINDOW_KEY
const FIXTURE_ID = 'fixture-scoreboard-side-001'
const MARKET_ID = 'market-001'
const CONDITION_ID = 'condition-001'
const HOME_TOKEN_ID = 'token-home-001'
const AWAY_TOKEN_ID = 'token-away-001'

const buildObserverSignalInput = (
  overrides: Partial<ObserverIntentSignalInput> = {},
): ObserverIntentSignalInput => ({
  fixture: {
    id: FIXTURE_ID,
    status: 'live',
    isLive: true,
    updatedAt: FIXED_NOW,
    homeTeam: 'Mumbai Indians',
    awayTeam: 'Chennai Super Kings',
    startTime: new Date('2026-05-11T09:00:00.000Z'),
    polymarketMarketSlug: MARKET_ID,
    polymarketConditionId: CONDITION_ID,
    homeTokenId: HOME_TOKEN_ID,
    awayTokenId: AWAY_TOKEN_ID,
    ...overrides.fixture,
  },
  inningsStates: {
    activeInnings: 2,
    first: {
      innings: 1,
      battingTeam: 'Mumbai Indians',
      bowlingTeam: 'Chennai Super Kings',
      scoreRuns: 180,
      scoreWickets: 7,
      balls: 120,
      targetRuns: null,
      chaseSuccessProbability: null,
      status: 'frozen',
    },
    second: {
      innings: 2,
      battingTeam: 'Chennai Super Kings',
      bowlingTeam: 'Mumbai Indians',
      scoreRuns: 104,
      scoreWickets: 3,
      balls: 66,
      targetRuns: 181,
      chaseSuccessProbability: 0.31,
      status: 'live',
    },
    ...overrides.inningsStates,
  },
  home: {
    team: 'Mumbai Indians',
    marketProbability: 0.63,
    ...overrides.home,
  },
  away: {
    team: 'Chennai Super Kings',
    marketProbability: 0.37,
    ...overrides.away,
  },
  sourceEvent: 'ball-state-runtime',
  confidence: 'high',
  observedAt: FIXED_NOW,
  now: () => FIXED_NOW,
  ...overrides,
})

const buildRecipeRecord = (overrides: Partial<TradingRecipeRecord> = {}): TradingRecipeRecord => {
  const identity = {
    strategyKey: overrides.strategyKey ?? SCOREBOARD_SIDE_STRATEGY_KEY,
    recipeVersion: overrides.recipeVersion ?? SCOREBOARD_SIDE_RECIPE_VERSION,
    windowKey: overrides.windowKey ?? WINDOW_KEY,
    fixtureId: overrides.fixtureId ?? FIXTURE_ID,
    marketId: overrides.marketId ?? MARKET_ID,
    tokenId: overrides.tokenId ?? HOME_TOKEN_ID,
    side: (overrides.side ?? 'buy') as TradingSide,
  }

  return {
    recipeKey: overrides.recipeKey ?? buildTradeRecipeKey(identity),
    ...identity,
    conditionId: overrides.conditionId ?? CONDITION_ID,
    orderStyle: overrides.orderStyle ?? 'limit',
    maxPrice: overrides.maxPrice ?? 0.42,
    size: overrides.size ?? 952.380952,
    expiryTime: overrides.expiryTime ?? new Date('2026-05-11T12:00:00.000Z'),
    context: overrides.context ?? { strategyMode: 'value90', priceCap: 0.9, allocationFraction: 0.2 },
    createdAt: overrides.createdAt ?? FIXED_NOW,
    updatedAt: overrides.updatedAt ?? FIXED_NOW,
  }
}

const buildIntentRecord = (
  input: CreateTradeIntentInput,
  id: number,
  overrides: Partial<TradingIntentRecord> = {},
): TradingIntentRecord => ({
  id,
  intentKey: overrides.intentKey ?? buildTradeIntentKey(input),
  recipeKey: input.recipeKey,
  strategyKey: input.strategyKey,
  recipeVersion: input.recipeVersion,
  windowKey: input.windowKey,
  fixtureId: input.fixtureId,
  marketId: input.marketId,
  conditionId: input.conditionId,
  tokenId: input.tokenId,
  side: input.side,
  status: overrides.status ?? input.status ?? 'pending',
  claimCount: overrides.claimCount ?? 0,
  claimedBy: overrides.claimedBy ?? null,
  claimedAt: overrides.claimedAt ?? null,
  claimExpiresAt: overrides.claimExpiresAt ?? null,
  lastErrorCode: overrides.lastErrorCode ?? null,
  lastErrorMessage: overrides.lastErrorMessage ?? null,
  context: overrides.context ?? input.context ?? null,
  createdAt: overrides.createdAt ?? FIXED_NOW,
  updatedAt: overrides.updatedAt ?? FIXED_NOW,
})

const buildManualIntentRecord = (overrides: Partial<TradingIntentRecord> = {}) => {
  const recipe = buildRecipeRecord(overrides)
  return buildIntentRecord(
    {
      strategyKey: recipe.strategyKey,
      recipeVersion: recipe.recipeVersion,
      windowKey: recipe.windowKey,
      fixtureId: recipe.fixtureId,
      marketId: recipe.marketId,
      conditionId: recipe.conditionId,
      tokenId: recipe.tokenId,
      side: recipe.side as TradingSide,
      recipeKey: recipe.recipeKey,
      context: { source: 'test' },
    },
    overrides.id ?? 1,
    overrides,
  )
}

const validatedRecipe = (recipe = buildRecipeRecord()) => {
  const result = validateTradingRecipe({
    marketId: recipe.marketId,
    conditionId: recipe.conditionId,
    tokenId: recipe.tokenId,
    side: recipe.side as TradingSide,
    orderStyle: recipe.orderStyle as TradingOrderStyle,
    maxPrice: recipe.maxPrice,
    expiryEpochMs: recipe.expiryTime.getTime(),
  })

  if (!result.ok) {
    throw new Error(`Expected valid recipe fixture: ${result.errors.join(', ')}`)
  }

  return result.value
}

const buildExecutionContext = (
  overrides: Partial<TradingExecutorEvaluationContext> = {},
  recipe = buildRecipeRecord(),
): TradingExecutorEvaluationContext => {
  const readinessRecipe = validateTradingRecipe({
    marketId: recipe.marketId,
    conditionId: recipe.conditionId,
    tokenId: recipe.tokenId,
    side: recipe.side as TradingSide,
    orderStyle: recipe.orderStyle as TradingOrderStyle,
    maxPrice: recipe.maxPrice,
    expiryEpochMs: recipe.expiryTime.getTime(),
  })
  const readiness = overrides.readiness ?? ({
    liveReady: true,
    mode: 'live',
    recipe: readinessRecipe.ok ? readinessRecipe.value : validatedRecipe(),
    reasons: [],
  } satisfies TradingReadinessResult)

  return {
    readiness,
    marketStatus: overrides.marketStatus ?? 'open',
    currentTokenId: overrides.currentTokenId ?? recipe.tokenId,
    balanceAvailableUsd: overrides.balanceAvailableUsd ?? 2000,
    matchStateAgeMs: overrides.matchStateAgeMs ?? 2_000,
    maxMatchStateAgeMs: overrides.maxMatchStateAgeMs ?? 30_000,
    bookAgeMs: overrides.bookAgeMs ?? 2_000,
    maxBookAgeMs: overrides.maxBookAgeMs ?? 15_000,
    dayWindow: overrides.dayWindow ?? { start: DAY_START, end: DAY_END },
  }
}

class InMemoryTradingScenarioStore implements ObserverTradeIntentRepository, TradingExecutorStore {
  recipes: TradingRecipeRecord[]
  intents: TradingIntentRecord[]
  events: TradingExecutionEventRecord[]
  exposures: TradingExposureLedgerRecord[]
  checkpoints = new Map<string, { lastCursor: string | null; details: Record<string, unknown> | null }>()
  private nextIntentId = 1
  private nextEventId = 1
  private nextExposureId = 1

  constructor(input: {
    recipes?: TradingRecipeRecord[]
    intents?: TradingIntentRecord[]
    events?: TradingExecutionEventRecord[]
    exposures?: TradingExposureLedgerRecord[]
  } = {}) {
    this.recipes = [...(input.recipes ?? [])]
    this.intents = [...(input.intents ?? [])]
    this.events = [...(input.events ?? [])]
    this.exposures = [...(input.exposures ?? [])]
    this.nextIntentId = Math.max(0, ...this.intents.map((intent) => intent.id)) + 1
  }

  async getTradingRecipe(recipeKey: string) {
    return this.recipes.find((recipe) => recipe.recipeKey === recipeKey) ?? null
  }

  async createTradeIntent(input: CreateTradeIntentInput): Promise<CreateTradeIntentResult> {
    const intentKey = input.intentKey ?? buildTradeIntentKey(input)
    const existing = this.intents.find((intent) => intent.intentKey === intentKey)
    if (existing) {
      return { created: false, record: existing }
    }

    const record = buildIntentRecord(input, this.nextIntentId++)
    this.intents.push(record)
    return { created: true, record }
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

  async listTradingExecutionEvents(intentId: number) {
    return this.events.filter((event) => event.intentId === intentId)
  }

  async listTradingExposureLedgerEntries() {
    return [...this.exposures]
  }

  async appendTradingExecutionEvent(input: AppendTradingExecutionEventInput) {
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

  async appendTradingExposureLedgerEntry(input: AppendTradingExposureLedgerInput) {
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
      lastErrorMessage: 'lastErrorMessage' in input ? input.lastErrorMessage ?? null : current.lastErrorMessage,
      claimedBy: 'claimedBy' in input ? input.claimedBy ?? null : current.claimedBy,
      claimedAt: 'claimedAt' in input ? input.claimedAt ?? null : current.claimedAt,
      claimExpiresAt: 'claimExpiresAt' in input ? input.claimExpiresAt ?? null : current.claimExpiresAt,
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

class SpyDryRunAdapter implements PolymarketTradingAdapter {
  readonly mode = 'dry-run' as const
  readonly createOrderRequests: PolymarketCreateOrderRequest[] = []

  async lookupMarket(_request: PolymarketMarketLookupRequest): Promise<PolymarketMarketLookupResult | null> {
    return null
  }

  async createOrder(request: PolymarketCreateOrderRequest): Promise<PolymarketOrderRecord> {
    this.createOrderRequests.push(request)
    throw new Error('dry-run adapter must not submit orders')
  }

  async cancelOrder(_orderId: string): Promise<PolymarketOrderRecord> {
    throw new Error('dry-run adapter must not cancel orders')
  }

  async getOrder(_orderId: string): Promise<PolymarketOrderRecord | null> {
    return null
  }

  async getTrades(_request: PolymarketGetTradesRequest) {
    return []
  }

  async getSpendablePusdBalance() {
    return 1000
  }

  async subscribeUserUpdates() {
    return () => undefined
  }

  async selfTest(): Promise<PolymarketHealthStatus> {
    return { ok: false, mode: 'dry-run', authenticated: false, reasons: ['DRY_RUN_TEST_ADAPTER'] }
  }
}

const createExecutor = (input: {
  store: InMemoryTradingScenarioStore
  adapter: PolymarketTradingAdapter
  recipe?: TradingRecipeRecord
  context?: Partial<TradingExecutorEvaluationContext>
}) => new TradingExecutor({
  workerId: 'worker-1',
  leaseMs: 30_000,
  adapter: input.adapter,
  store: input.store,
  now: () => FIXED_NOW,
  buildEvaluationContext: async ({ recipe }) => buildExecutionContext(input.context, recipe ?? input.recipe ?? buildRecipeRecord()),
})

const blockedEvent = (store: InMemoryTradingScenarioStore) => {
  const event = store.events.find((candidate) => candidate.eventType === 'blocked')
  if (!event) {
    throw new Error('Expected a blocked execution event')
  }
  return event
}

const buildExposure = (overrides: Partial<TradingExposureLedgerRecord>): TradingExposureLedgerRecord => ({
  id: overrides.id ?? 1,
  intentId: overrides.intentId ?? 99,
  fixtureId: overrides.fixtureId ?? FIXTURE_ID,
  marketId: overrides.marketId ?? MARKET_ID,
  tokenId: overrides.tokenId ?? HOME_TOKEN_ID,
  side: overrides.side ?? 'buy',
  entryType: overrides.entryType ?? 'submitted_notional',
  quantity: overrides.quantity ?? 20,
  notionalUsd: overrides.notionalUsd ?? 0,
  eventTime: overrides.eventTime ?? FIXED_NOW,
  processedAt: overrides.processedAt ?? FIXED_NOW,
  details: overrides.details ?? {},
  createdAt: overrides.createdAt ?? FIXED_NOW,
})

describe('trading dry-run end-to-end safety scenario', () => {
  test('qualifying 11-over state creates one durable intent and records dry-run would-submit without live submit', async () => {
    const input = buildObserverSignalInput()
    const recipe = buildRecipeRecord({ tokenId: AWAY_TOKEN_ID })
    const store = new InMemoryTradingScenarioStore({ recipes: [recipe] })

    const evaluation = evaluateScoreboardSideStrategy({
      fixtureId: input.fixture.id,
      inningsNumber: input.inningsStates.second.innings,
      legalBallsCompleted: input.inningsStates.second.balls,
      firstInningsScore: input.inningsStates.first.scoreRuns,
      firstInningsBalls: input.inningsStates.first.balls,
      firstInningsWickets: input.inningsStates.first.scoreWickets,
      chasingScore: input.inningsStates.second.scoreRuns,
      wicketsLost: input.inningsStates.second.scoreWickets,
      targetRuns: input.inningsStates.second.targetRuns,
      chaser: { team: input.away.team, price: input.away.marketProbability, tokenSide: 'away' },
      defender: { team: input.home.team, price: input.home.marketProbability, tokenSide: 'home' },
    })
    const created = await createObserverTradeIntent({ ...input, repository: store })
    const duplicate = await createObserverTradeIntent({ ...input, repository: store })
    const adapter = new SpyDryRunAdapter()
    const executor = createExecutor({ store, adapter, recipe })

    const outcome = await executor.processNextTradeIntent()
    const replayOutcome = await executor.processNextTradeIntent()
    const intent = store.intents[0]
    const updatedIntent = intent ? await store.getTradeIntentById(intent.id) : null

    expect(evaluation).toMatchObject({ action: 'buy', windowKey: WINDOW_KEY, signalSide: 'chaser' })
    expect(created).toMatchObject({ status: 'created', reason: 'INTENT_CREATED' })
    expect(duplicate).toMatchObject({ status: 'blocked', reason: 'INTENT_ALREADY_EXISTS' })
    expect(store.intents).toHaveLength(1)
    expect(outcome).toMatchObject({ kind: 'dry-run-approved', state: 'acknowledged', blockerCodes: [] })
    expect(replayOutcome).toEqual({ kind: 'no-op', reason: 'no-intent-available' })
    expect(adapter.createOrderRequests).toHaveLength(0)
    expect(updatedIntent).toMatchObject({ status: 'completed', lastErrorCode: null, claimedBy: null })
    expect(store.events.map((event) => event.eventType)).toEqual([
      'detected',
      'eligible',
      'approved',
      'submitted',
      'acknowledged',
    ])
    expect(store.events.find((event) => event.eventType === 'submitted')?.details).toMatchObject({
      dryRun: true,
      clientOrderId: intent?.intentKey,
      orderRequest: {
        clientOrderId: intent?.intentKey,
        marketId: MARKET_ID,
        tokenId: AWAY_TOKEN_ID,
        side: 'buy',
      },
    })
    expect(store.events.find((event) => event.eventType === 'acknowledged')?.details).toMatchObject({
      dryRun: true,
      order: {
        orderId: `dry-run:${intent?.intentKey}`,
        wouldSubmit: { clientOrderId: intent?.intentKey },
      },
    })
    expect(store.exposures.map((entry) => [entry.entryType, entry.notionalUsd, entry.quantity])).toEqual([
      ['submitted_notional', 400, 952.380952],
      ['pending_order', 400, 952.380952],
    ])
    expect(store.exposures.every((entry) => (entry.details as { dryRun?: boolean }).dryRun === true)).toBe(true)
  })

  test('observer creation fails closed for ambiguous mapping and fails open for persistence outages', async () => {
    const cases = [
      {
        name: 'ambiguous favourite mapping',
        input: buildObserverSignalInput({
          inningsStates: {
            activeInnings: 2,
            first: buildObserverSignalInput().inningsStates.first,
            second: { ...buildObserverSignalInput().inningsStates.second, battingTeam: 'Unmapped Chaser' },
          },
        }),
        repository: new InMemoryTradingScenarioStore({ recipes: [buildRecipeRecord()] }) as ObserverTradeIntentRepository,
        expected: { status: 'ignored', reason: 'STRATEGY_SKIP' },
        assert: (result: Awaited<ReturnType<typeof createObserverTradeIntent>>) => {
          expect(result.evaluation.blockers).toContain('MISSING_TEAM_OR_PRICE')
        },
      },
      {
        name: 'database unavailable during recipe lookup',
        input: buildObserverSignalInput(),
        repository: {
          getTradingRecipe: async () => {
            throw new Error('database unavailable')
          },
          createTradeIntent: async () => {
            throw new Error('createTradeIntent should not run after lookup failure')
          },
        } satisfies ObserverTradeIntentRepository,
        expected: { status: 'ignored', reason: 'INTENT_PERSISTENCE_FAILED' },
        assert: (result: Awaited<ReturnType<typeof createObserverTradeIntent>>) => {
          expect(result).toMatchObject({ details: { step: 'getTradingRecipe', error: 'database unavailable' } })
        },
      },
    ]

    for (const scenario of cases) {
      const result = await createObserverTradeIntent({ ...scenario.input, repository: scenario.repository })

      expect(result, scenario.name).toMatchObject(scenario.expected)
      scenario.assert(result)
    }
  })

  test('executor policy blocker matrix writes meaningful audit events and never reaches live submit', async () => {
    const recipe = buildRecipeRecord()
    const blockerCases: Array<{
      name: string
      recipe?: TradingRecipeRecord
      context?: Partial<TradingExecutorEvaluationContext>
      exposures?: TradingExposureLedgerRecord[]
      expectedCode: string
      expectedDetails?: Record<string, unknown>
    }> = [
      { name: 'stale match state', context: { matchStateAgeMs: 45_001 }, expectedCode: 'STALE_MATCH_STATE', expectedDetails: { maxMatchStateAgeMs: 30_000 } },
      { name: 'stale book data', context: { bookAgeMs: 15_001 }, expectedCode: 'STALE_BOOK', expectedDetails: { maxBookAgeMs: 15_000 } },
      { name: 'token mismatch', context: { currentTokenId: AWAY_TOKEN_ID }, expectedCode: 'TOKEN_MISMATCH', expectedDetails: { expectedTokenId: HOME_TOKEN_ID, actualTokenId: AWAY_TOKEN_ID } },
      { name: 'market closed', context: { marketStatus: 'closed' }, expectedCode: 'MARKET_CLOSED', expectedDetails: { marketStatus: 'closed' } },
      { name: 'market suspended', context: { marketStatus: 'halted' }, expectedCode: 'MARKET_CLOSED', expectedDetails: { marketStatus: 'halted' } },
      {
        name: 'environment live flag disabled',
        context: { readiness: { liveReady: false, mode: 'dry-run', reasons: [{ code: 'ENV_LIVE_GATE_DISABLED' }] } },
        expectedCode: 'ENV_LIVE_GATE_DISABLED',
      },
      {
        name: 'runtime database flag disabled',
        context: { readiness: { liveReady: false, mode: 'dry-run', reasons: [{ code: 'DB_RUNTIME_LIVE_GATE_DISABLED' }] } },
        expectedCode: 'DB_RUNTIME_LIVE_GATE_DISABLED',
      },
      {
        name: 'auth credentials missing',
        context: { readiness: { liveReady: false, mode: 'dry-run', reasons: [{ code: 'POLYMARKET_CREDENTIALS_MISSING' }] } },
        expectedCode: 'POLYMARKET_CREDENTIALS_MISSING',
      },
    ]

    for (const scenario of blockerCases) {
      const caseRecipe = scenario.recipe ?? recipe
      const store = new InMemoryTradingScenarioStore({
        intents: [buildManualIntentRecord({ id: 1, recipeKey: caseRecipe.recipeKey })],
        recipes: [caseRecipe],
        exposures: scenario.exposures,
      })
      const adapter = new MockPolymarketTradingAdapter()
      const executor = createExecutor({ store, adapter, recipe: caseRecipe, context: scenario.context })

      const outcome = await executor.processNextTradeIntent()
      const updatedIntent = await store.getTradeIntentById(1)
      const auditEvent = blockedEvent(store)
      const blockers = (auditEvent.details as { blockers?: Array<{ code: string; message: string; details: Record<string, unknown> }> }).blockers ?? []
      const blocker = blockers.find((candidate) => candidate.code === scenario.expectedCode)

      expect(outcome, scenario.name).toMatchObject({ kind: 'blocked', blockerCodes: expect.arrayContaining([scenario.expectedCode]) })
      expect(updatedIntent, scenario.name).toMatchObject({ status: 'failed', lastErrorCode: scenario.expectedCode })
      expect(store.events.map((event) => event.eventType), scenario.name).toEqual(['detected', 'eligible', 'blocked'])
      expect(blocker?.message, scenario.name).toEqual(expect.any(String))
      expect(blocker?.message.length, scenario.name).toBeGreaterThan(10)
      expect(blocker?.details, scenario.name).toMatchObject(scenario.expectedDetails ?? {})
      expect(adapter.getRecordedCalls().filter((call) => call.operation === 'createOrder'), scenario.name).toHaveLength(0)
    }
  })

  test('existing exposure does not block an otherwise eligible dry-run trade', async () => {
    const recipe = buildRecipeRecord()
    const store = new InMemoryTradingScenarioStore({
      intents: [buildManualIntentRecord({ id: 1 })],
      recipes: [recipe],
      exposures: [buildExposure({ entryType: 'submitted_notional', notionalUsd: 71.6 })],
    })
    const adapter = new SpyDryRunAdapter()
    const executor = createExecutor({ store, adapter, recipe })

    const outcome = await executor.processNextTradeIntent()
    const summary = calculateTradingExposureSummary(store.exposures, { fixtureId: FIXTURE_ID, dayWindow: { start: DAY_START, end: DAY_END } })

    expect(outcome).toMatchObject({ kind: 'dry-run-approved', blockerCodes: [] })
    expect(adapter.createOrderRequests).toHaveLength(0)
    expect(summary.daySubmittedNotionalUsd).toBe(471.6)
  })

  test('dry-run audit events include the scoreboard-side allocation fraction used for sizing', async () => {
    const recipe = buildRecipeRecord({
      maxPrice: 0.95,
      context: { strategyMode: 'volume95', priceCap: 0.95, allocationFraction: 0.1 },
    })
    const store = new InMemoryTradingScenarioStore({
      intents: [buildManualIntentRecord({ id: 1, recipeKey: recipe.recipeKey })],
      recipes: [recipe],
    })
    const adapter = new SpyDryRunAdapter()
    const executor = createExecutor({ store, adapter, recipe, context: { balanceAvailableUsd: 1000 } })

    const outcome = await executor.processNextTradeIntent()

    expect(outcome).toMatchObject({ kind: 'dry-run-approved', blockerCodes: [] })
    expect(store.events.find((event) => event.eventType === 'approved')?.details).toMatchObject({
      allocationFraction: 0.1,
      requestedNotionalUsd: 100,
      requestedOrderSize: 105.263158,
    })
    expect(store.events.find((event) => event.eventType === 'submitted')?.details).toMatchObject({
      allocationFraction: 0.1,
      orderRequest: { price: 0.95, size: 105.263158 },
    })
    expect(store.exposures.map((entry) => [entry.entryType, entry.notionalUsd, entry.quantity])).toEqual([
      ['submitted_notional', 100, 105.263158],
      ['pending_order', 100, 105.263158],
    ])
  })

  test('live adapter failure matrix is reconciliation-first and never blindly retries ambiguous submits', async () => {
    const cases = [
      {
        name: 'rate limit',
        arrange: (adapter: MockPolymarketTradingAdapter) => adapter.enqueueCreateOrderOutcome({ type: 'rate-limit', retryAfterMs: 7_500 }),
        expectedOutcome: { kind: 'pending-reconciliation', reason: 'RATE_LIMITED' },
        expectedLastError: 'RATE_LIMITED',
        expectedEvents: ['detected', 'eligible', 'approved', 'submitted'],
      },
      {
        name: 'duplicate order error',
        arrange: (adapter: MockPolymarketTradingAdapter) => adapter.enqueueCreateOrderOutcome({ type: 'duplicate', duplicateOfOrderId: 'venue-order-existing' }),
        expectedOutcome: { kind: 'pending-reconciliation', reason: 'DUPLICATE_ORDER' },
        expectedLastError: 'DUPLICATE_ORDER',
        expectedEvents: ['detected', 'eligible', 'approved', 'submitted', 'acknowledged'],
      },
      {
        name: 'ambiguous timeout persisted partial order',
        arrange: (adapter: MockPolymarketTradingAdapter) => adapter.enqueueCreateOrderOutcome({
          type: 'timeout',
          persistedOrderId: 'venue-order-timeout',
          matchedSize: 10,
          tradeId: 'venue-trade-timeout',
          emitUserUpdate: false,
        }),
        expectedOutcome: { kind: 'reconciled', state: 'partial', source: 'rest-fallback', orderId: 'venue-order-timeout' },
        expectedLastError: null,
        expectedEvents: ['detected', 'eligible', 'approved', 'submitted', 'partial'],
      },
    ]

    for (const scenario of cases) {
      const recipe = buildRecipeRecord()
      const store = new InMemoryTradingScenarioStore({ intents: [buildManualIntentRecord({ id: 1 })], recipes: [recipe] })
      const adapter = new MockPolymarketTradingAdapter()
      scenario.arrange(adapter)
      const executor = createExecutor({ store, adapter, recipe })

      const outcome = await executor.processNextTradeIntent()
      const updatedIntent = await store.getTradeIntentById(1)

      expect(outcome, scenario.name).toMatchObject(scenario.expectedOutcome)
      expect(updatedIntent?.lastErrorCode, scenario.name).toBe(scenario.expectedLastError)
      expect(store.events.map((event) => event.eventType), scenario.name).toEqual(scenario.expectedEvents)
      expect(adapter.getRecordedCalls().filter((call) => call.operation === 'createOrder'), scenario.name).toHaveLength(1)
      expect(store.events.find((event) => event.eventType === 'submitted')?.details, scenario.name).toMatchObject({
        orderRequest: { clientOrderId: store.intents[0]?.intentKey },
      })
    }
  })

  test('WebSocket disconnect forces REST fallback reconciliation with no second submission path', async () => {
    const recipe = buildRecipeRecord()
    const store = new InMemoryTradingScenarioStore({ intents: [buildManualIntentRecord({ id: 1 })], recipes: [recipe] })
    const adapter = new MockPolymarketTradingAdapter()
    adapter.enqueueCreateOrderOutcome({ type: 'accept', orderId: 'venue-order-disconnect' })
    const executor = createExecutor({ store, adapter, recipe })

    await executor.processNextTradeIntent()
    adapter.disconnectUserUpdates('2026-05-11T10:13:00.000Z')
    adapter.addTrade(
      'venue-order-disconnect',
      {
        tradeId: 'venue-trade-disconnect',
        marketId: MARKET_ID,
        tokenId: HOME_TOKEN_ID,
        side: 'buy',
        price: 0.42,
        size: recipe.size,
        createdAt: '2026-05-11T10:13:30.000Z',
      },
      { emitUserUpdate: false },
    )
    adapter.updateOrder(
      'venue-order-disconnect',
      {
        status: 'filled',
        matchedSize: recipe.size,
        remainingSize: 0,
        updatedAt: '2026-05-11T10:13:30.000Z',
      },
      { emitUserUpdate: false },
    )

    const outcome = await executor.processClaimedTradeIntent(store.intents[0]!)
    const checkpoint = await store.getTradingReconciliationCheckpoint('polymarket:user-updates')

    expect(outcome).toMatchObject({ kind: 'reconciled', state: 'reconciled', source: 'rest-fallback', orderId: 'venue-order-disconnect' })
    expect(adapter.getRecordedCalls().filter((call) => call.operation === 'createOrder')).toHaveLength(1)
    expect(store.events.map((event) => event.eventType)).toEqual([
      'detected',
      'eligible',
      'approved',
      'submitted',
      'acknowledged',
      'filled',
      'reconciled',
    ])
    expect(checkpoint?.details).toMatchObject({ connected: false, source: 'rest-fallback', state: 'filled', orderId: 'venue-order-disconnect' })
    expect(store.exposures.map((entry) => [entry.entryType, entry.notionalUsd])).toEqual([
      ['submitted_notional', 400],
      ['pending_order', 400],
      ['filled_exposure', 400],
      ['pending_order', -400],
    ])
  })
})
