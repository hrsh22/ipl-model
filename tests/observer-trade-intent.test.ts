import { describe, expect, test } from 'vitest'

import {
  SCOREBOARD_SIDE_STRATEGY_KEY,
  SCOREBOARD_SIDE_WINDOW_KEY,
} from '../src/ipl/scoreboard-side-strategy.js'
import {
  createObserverTradeIntent,
  type ObserverIntentSignalInput,
  type ObserverTradeIntentRepository,
} from '../src/trading/observer-intents.js'
import {
  buildTradeIntentKey,
  buildTradeRecipeKey,
  type CreateTradeIntentInput,
  type CreateTradeIntentResult,
  type FixtureTradeIntentIdentity,
  type TradingIntentRecord,
  type TradingRecipeRecord,
  type TradingRecipeUpsertInput,
} from '../src/trading/repository.js'

const FIXED_NOW = new Date('2026-05-11T10:12:00.000Z')
const SCOREBOARD_SIDE_RECIPE_VERSION = 'v1-value90'
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
      scoreRuns: 70,
      scoreWickets: 5,
      balls: 66,
      targetRuns: 181,
      chaseSuccessProbability: 0.31,
      status: 'live',
    },
    ...overrides.inningsStates,
  },
  home: {
    team: 'Mumbai Indians',
    marketProbability: 0.37,
    ...overrides.home,
  },
  away: {
    team: 'Chennai Super Kings',
    marketProbability: 0.63,
    ...overrides.away,
  },
  sourceEvent: 'ball-state-runtime',
  confidence: 'high',
  observedAt: FIXED_NOW,
  now: () => FIXED_NOW,
  ...overrides,
})

const buildRecipeRecord = (
  input: ObserverIntentSignalInput,
  tokenSide: 'home' | 'away' = 'home',
): TradingRecipeRecord => {
  const identity = {
    strategyKey: SCOREBOARD_SIDE_STRATEGY_KEY,
    recipeVersion: SCOREBOARD_SIDE_RECIPE_VERSION,
    windowKey: SCOREBOARD_SIDE_WINDOW_KEY,
    fixtureId: input.fixture.id,
    marketId: input.fixture.polymarketMarketSlug ?? 'missing-market',
    tokenId: tokenSide === 'home'
      ? input.fixture.homeTokenId ?? 'missing-token'
      : input.fixture.awayTokenId ?? 'missing-token',
    side: 'buy' as const,
  }
  const recipeKey = buildTradeRecipeKey(identity)

  return {
    recipeKey,
    strategyKey: identity.strategyKey,
    recipeVersion: identity.recipeVersion,
    windowKey: identity.windowKey,
    fixtureId: identity.fixtureId,
    marketId: identity.marketId,
    conditionId: CONDITION_ID,
    tokenId: identity.tokenId,
    side: identity.side,
    orderStyle: 'limit',
    maxPrice: 0.9,
    size: 975.609756,
    expiryTime: new Date('2026-05-11T12:00:00.000Z'),
    context: { strategy: 'scoreboard-side-11-13' },
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  }
}

const buildIntentRecord = (
  input: CreateTradeIntentInput,
  id = 1,
): TradingIntentRecord => ({
  id,
  intentKey: buildTradeIntentKey(input),
  recipeKey: input.recipeKey,
  strategyKey: input.strategyKey,
  recipeVersion: input.recipeVersion,
  windowKey: input.windowKey,
  fixtureId: input.fixtureId,
  marketId: input.marketId,
  conditionId: input.conditionId,
  tokenId: input.tokenId,
  side: input.side,
  status: 'pending',
  claimCount: 0,
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  context: input.context ?? null,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
})

class InMemoryObserverTradeIntentRepository implements ObserverTradeIntentRepository {
  recipes: TradingRecipeRecord[]
  intents: TradingIntentRecord[]
  getTradingRecipeCalls = 0
  createTradeIntentCalls = 0
  upsertTradingRecipeCalls: TradingRecipeUpsertInput[] = []

  constructor(input?: { recipes?: TradingRecipeRecord[]; intents?: TradingIntentRecord[] }) {
    this.recipes = [...(input?.recipes ?? [])]
    this.intents = [...(input?.intents ?? [])]
  }

  async getTradingRecipe(recipeKey: string) {
    this.getTradingRecipeCalls += 1
    return this.recipes.find((recipe) => recipe.recipeKey === recipeKey) ?? null
  }

  async findTradeIntentByFixtureScope(input: FixtureTradeIntentIdentity) {
    return this.intents.find((intent) => (
      intent.strategyKey === input.strategyKey
      && intent.windowKey === input.windowKey
      && intent.fixtureId === input.fixtureId
      && intent.marketId === input.marketId
      && intent.side === input.side
    )) ?? null
  }

  async upsertTradingRecipe(input: TradingRecipeUpsertInput) {
    this.upsertTradingRecipeCalls.push(input)
    const recipeKey = input.recipeKey ?? buildTradeRecipeKey(input)
    const existingIndex = this.recipes.findIndex((recipe) => recipe.recipeKey === recipeKey)
    const existing = existingIndex >= 0 ? this.recipes[existingIndex] : null
    const record: TradingRecipeRecord = {
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
      createdAt: existing?.createdAt ?? FIXED_NOW,
      updatedAt: existing ? new Date(FIXED_NOW.getTime() + this.upsertTradingRecipeCalls.length) : FIXED_NOW,
    }

    if (existingIndex >= 0) {
      this.recipes[existingIndex] = record
    } else {
      this.recipes.push(record)
    }

    return record
  }

  async createTradeIntent(input: CreateTradeIntentInput): Promise<CreateTradeIntentResult> {
    this.createTradeIntentCalls += 1
    const existingFixtureIntent = await this.findTradeIntentByFixtureScope(input)
    if (existingFixtureIntent) {
      return { created: false, record: existingFixtureIntent }
    }

    const existing = this.intents.find((intent) => intent.intentKey === buildTradeIntentKey(input))
    if (existing) {
      return { created: false, record: existing }
    }

    const record = buildIntentRecord(input, this.intents.length + 1)
    this.intents.push(record)
    return { created: true, record }
  }
}

describe('observer durable trade intent integration', () => {
  test('creates one durable trade intent for a fresh eligible defender signal using the defender token', async () => {
    const input = buildObserverSignalInput()
    const repository = new InMemoryObserverTradeIntentRepository({
      recipes: [buildRecipeRecord(input)],
    })

    const result = await createObserverTradeIntent({
      ...input,
      repository,
    })

    expect(result.status).toBe('created')
    expect(result.reason).toBe('INTENT_CREATED')
    expect(repository.intents).toHaveLength(1)
    expect(repository.intents[0]).toMatchObject({
      strategyKey: SCOREBOARD_SIDE_STRATEGY_KEY,
      recipeVersion: SCOREBOARD_SIDE_RECIPE_VERSION,
      windowKey: SCOREBOARD_SIDE_WINDOW_KEY,
      fixtureId: FIXTURE_ID,
      marketId: MARKET_ID,
      conditionId: CONDITION_ID,
      tokenId: HOME_TOKEN_ID,
      side: 'buy',
    })
    expect(repository.intents[0].context).toMatchObject({
      source: 'observer-live-model',
      sourceEvent: 'ball-state-runtime',
      selectedSide: {
        team: 'Mumbai Indians',
        side: 'home',
        tokenId: HOME_TOKEN_ID,
      },
      metrics: {
        target: 181,
        runsNeeded: 111,
        wicketsLost: 5,
        chasingTeam: 'Chennai Super Kings',
        defendingTeam: 'Mumbai Indians',
      },
      evaluation: {
        action: 'buy',
        signalSide: 'defender',
        tokenSide: 'home',
        strategyVersion: SCOREBOARD_SIDE_RECIPE_VERSION,
      },
    })
  })

  test('seeds both scoreboard-side token recipes at runtime before lookup on a clean repository', async () => {
    const input = buildObserverSignalInput()
    const repository = new InMemoryObserverTradeIntentRepository()

    const result = await createObserverTradeIntent({
      ...input,
      repository,
    })

    expect(result).toMatchObject({
      status: 'created',
      reason: 'INTENT_CREATED',
      recipeKey: 'recipe:scoreboard-side-11-13:v1-value90:balls-66-78:fixture-scoreboard-side-001:market-001:token-home-001:buy',
    })
    expect(repository.upsertTradingRecipeCalls).toHaveLength(2)
    expect(repository.upsertTradingRecipeCalls.map((recipe) => recipe.tokenId)).toEqual([HOME_TOKEN_ID, AWAY_TOKEN_ID])
    expect(repository.upsertTradingRecipeCalls).toEqual([
      expect.objectContaining({
        conditionId: CONDITION_ID,
        recipeVersion: 'v1-value90',
        maxPrice: 0.9,
        size: 100,
      }),
      expect.objectContaining({
        conditionId: CONDITION_ID,
        recipeVersion: 'v1-value90',
        maxPrice: 0.9,
        size: 100,
      }),
    ])
    expect(repository.getTradingRecipeCalls).toBe(1)
    expect(repository.intents).toHaveLength(1)
  })

  test('looks up the away-token recipe for an underdog chaser buy without persisting inactive volume mode', async () => {
    const input = buildObserverSignalInput({
      inningsStates: {
        ...buildObserverSignalInput().inningsStates,
        second: {
          ...buildObserverSignalInput().inningsStates.second,
          scoreRuns: 104,
          scoreWickets: 3,
        },
      },
      home: { team: 'Mumbai Indians', marketProbability: 0.63 },
      away: { team: 'Chennai Super Kings', marketProbability: 0.37 },
    })
    const repository = new InMemoryObserverTradeIntentRepository({
      recipes: [
        buildRecipeRecord(input, 'home'),
        buildRecipeRecord(input, 'away'),
        {
          ...buildRecipeRecord(input, 'away'),
          recipeKey: 'recipe:scoreboard-side-11-13:v1-volume95:balls-66-78:fixture-scoreboard-side-001:market-001:token-away-001:buy',
          recipeVersion: 'v1-volume95',
          maxPrice: 0.95,
          context: { strategy: 'scoreboard-side-11-13', strategyMode: 'volume95' },
        },
      ],
    })

    const result = await createObserverTradeIntent({
      ...input,
      repository,
    })

    expect(result).toMatchObject({
      status: 'created',
      reason: 'INTENT_CREATED',
      recipeKey: 'recipe:scoreboard-side-11-13:v1-value90:balls-66-78:fixture-scoreboard-side-001:market-001:token-away-001:buy',
      evaluation: {
        action: 'buy',
        signalSide: 'chaser',
        tokenSide: 'away',
        strategyVersion: 'v1-value90',
        mode: 'value90',
      },
    })
    expect(repository.intents).toHaveLength(1)
    expect(repository.intents[0]).toMatchObject({
      recipeVersion: 'v1-value90',
      tokenId: AWAY_TOKEN_ID,
      context: {
        scoreboardSideStrategy: {
          mode: 'value90',
          priceCap: 0.9,
          allocationFraction: 0.2,
        },
        selectedSide: {
          side: 'away',
          tokenId: AWAY_TOKEN_ID,
        },
      },
    })
    expect(repository.intents[0]?.recipeKey).not.toContain('v1-volume95')
  })

  test('does not create an intent when scoreboard teams map ambiguously to market tokens', async () => {
    const input = buildObserverSignalInput({
      fixture: {
        ...buildObserverSignalInput().fixture,
        awayTeam: 'Mumbai Indians',
      },
    })
    const repository = new InMemoryObserverTradeIntentRepository({
      recipes: [buildRecipeRecord(input)],
    })

    const result = await createObserverTradeIntent({
      ...input,
      repository,
    })

    expect(result).toMatchObject({
      status: 'ignored',
      reason: 'STRATEGY_SKIP',
      evaluation: {
        action: 'blocked',
        blockers: expect.arrayContaining(['MISSING_TEAM_OR_PRICE']),
      },
    })
    expect(repository.intents).toHaveLength(0)
  })

  test('ignores stale and historical signals with deterministic reasons', async () => {
    const staleInput = buildObserverSignalInput({
      observedAt: new Date(FIXED_NOW.getTime() - 31_000),
    })
    const historicalInput = buildObserverSignalInput({
      fixture: {
        ...buildObserverSignalInput().fixture,
        isLive: false,
        status: 'completed',
      },
    })
    const firstInningsInput = buildObserverSignalInput({
      inningsStates: {
        ...buildObserverSignalInput().inningsStates,
        activeInnings: 1,
        second: {
          ...buildObserverSignalInput().inningsStates.second,
          innings: null,
          status: 'pending',
        },
      },
    })
    const repository = new InMemoryObserverTradeIntentRepository({
      recipes: [buildRecipeRecord(staleInput)],
    })

    const staleResult = await createObserverTradeIntent({
      ...staleInput,
      repository,
    })
    const historicalResult = await createObserverTradeIntent({
      ...historicalInput,
      repository,
    })
    const firstInningsResult = await createObserverTradeIntent({
      ...firstInningsInput,
      repository,
    })

    expect(staleResult).toMatchObject({
      status: 'ignored',
      reason: 'SIGNAL_STALE',
    })
    expect(historicalResult).toMatchObject({
      status: 'ignored',
      reason: 'FIXTURE_NOT_LIVE',
    })
    expect(firstInningsResult).toMatchObject({
      status: 'ignored',
      reason: 'SECOND_INNINGS_NOT_LIVE',
    })
    expect(repository.intents).toHaveLength(0)
  })

  test('ignores stale fixture state before recipe lookup', async () => {
    const input = buildObserverSignalInput({
      fixture: {
        ...buildObserverSignalInput().fixture,
        updatedAt: new Date(FIXED_NOW.getTime() - (46 * 60 * 1000)),
      },
    })
    const repository = new InMemoryObserverTradeIntentRepository({ recipes: [buildRecipeRecord(input)] })

    const result = await createObserverTradeIntent({ ...input, repository })

    expect(result).toMatchObject({
      status: 'ignored',
      reason: 'FIXTURE_STATE_STALE',
      evaluation: {
        action: 'buy',
        blockers: [],
      },
    })
    expect(repository.getTradingRecipeCalls).toBe(0)
    expect(repository.createTradeIntentCalls).toBe(0)
  })

  test('maps evaluator no-trade safety blocks to deterministic ignored results without recipe lookup', async () => {
    const cases: Array<{
      name: string
      input: ObserverIntentSignalInput
      expectedReason: 'STRATEGY_WAIT' | 'STRATEGY_PASSED' | 'STRATEGY_SKIP'
      expectedAction: 'wait' | 'passed' | 'blocked'
      expectedBlockers: string[]
    }> = [
      {
        name: 'missing legal balls',
        input: buildObserverSignalInput({
          inningsStates: {
            ...buildObserverSignalInput().inningsStates,
            second: { ...buildObserverSignalInput().inningsStates.second, balls: null },
          },
        }),
        expectedReason: 'STRATEGY_SKIP',
        expectedAction: 'blocked',
        expectedBlockers: ['MISSING_BALLS'],
      },
      {
        name: 'before ball 66',
        input: buildObserverSignalInput({
          inningsStates: {
            ...buildObserverSignalInput().inningsStates,
            second: { ...buildObserverSignalInput().inningsStates.second, balls: 65 },
          },
        }),
        expectedReason: 'STRATEGY_WAIT',
        expectedAction: 'wait',
        expectedBlockers: ['BEFORE_WINDOW'],
      },
      {
        name: 'after ball 78',
        input: buildObserverSignalInput({
          inningsStates: {
            ...buildObserverSignalInput().inningsStates,
            second: { ...buildObserverSignalInput().inningsStates.second, balls: 79 },
          },
        }),
        expectedReason: 'STRATEGY_PASSED',
        expectedAction: 'passed',
        expectedBlockers: ['AFTER_WINDOW'],
      },
      {
        name: 'reduced DLS target mismatch',
        input: buildObserverSignalInput({
          inningsStates: {
            ...buildObserverSignalInput().inningsStates,
            first: { ...buildObserverSignalInput().inningsStates.first, balls: 108, scoreWickets: 8 },
            second: { ...buildObserverSignalInput().inningsStates.second, targetRuns: 180 },
          },
        }),
        expectedReason: 'STRATEGY_SKIP',
        expectedAction: 'blocked',
        expectedBlockers: ['REDUCED_OVER_RISK', 'TARGET_MISMATCH'],
      },
      {
        name: 'tie or super-over integrity warning from finished status',
        input: buildObserverSignalInput({
          fixture: { ...buildObserverSignalInput().fixture, status: 'completed after super over' },
          inningsStates: {
            ...buildObserverSignalInput().inningsStates,
            second: { ...buildObserverSignalInput().inningsStates.second, status: 'frozen' },
          },
        }),
        expectedReason: 'STRATEGY_SKIP',
        expectedAction: 'blocked',
        expectedBlockers: ['FIXTURE_FINISHED'],
      },
      {
        name: 'missing chase target blocks possible DLS or reduced-over state',
        input: buildObserverSignalInput({
          inningsStates: {
            ...buildObserverSignalInput().inningsStates,
            second: { ...buildObserverSignalInput().inningsStates.second, targetRuns: null },
          },
        }),
        expectedReason: 'STRATEGY_SKIP',
        expectedAction: 'blocked',
        expectedBlockers: ['MISSING_TARGET'],
      },
      {
        name: 'terminal no-result status blocks before recipe lookup',
        input: buildObserverSignalInput({
          fixture: { ...buildObserverSignalInput().fixture, status: 'no result' },
        }),
        expectedReason: 'STRATEGY_SKIP',
        expectedAction: 'blocked',
        expectedBlockers: ['FIXTURE_FINISHED'],
      },
      {
        name: 'abandoned rain-affected status blocks before recipe lookup',
        input: buildObserverSignalInput({
          fixture: { ...buildObserverSignalInput().fixture, status: 'abandoned due to rain' },
        }),
        expectedReason: 'STRATEGY_SKIP',
        expectedAction: 'blocked',
        expectedBlockers: ['FIXTURE_FINISHED'],
      },
      {
        name: 'settled or closed market price',
        input: buildObserverSignalInput({
          home: { team: 'Mumbai Indians', marketProbability: 0.99 },
        }),
        expectedReason: 'STRATEGY_SKIP',
        expectedAction: 'blocked',
        expectedBlockers: ['SETTLED_MARKET'],
      },
    ]

    for (const scenario of cases) {
      const repository = new InMemoryObserverTradeIntentRepository({ recipes: [buildRecipeRecord(scenario.input)] })

      const result = await createObserverTradeIntent({ ...scenario.input, repository })

      expect(result, scenario.name).toMatchObject({
        status: 'ignored',
        reason: scenario.expectedReason,
        evaluation: {
          action: scenario.expectedAction,
          blockers: expect.arrayContaining(scenario.expectedBlockers),
        },
      })
      expect(repository.getTradingRecipeCalls, scenario.name).toBe(0)
      expect(repository.createTradeIntentCalls, scenario.name).toBe(0)
    }
  })

  test('blocks duplicate fixture-scope polling cycles across mode changes before recipe lookup or insert', async () => {
    const input = buildObserverSignalInput()
    const existingIdentity = {
      strategyKey: SCOREBOARD_SIDE_STRATEGY_KEY,
      recipeVersion: 'v1-volume95',
      windowKey: SCOREBOARD_SIDE_WINDOW_KEY,
      fixtureId: input.fixture.id,
      marketId: input.fixture.polymarketMarketSlug ?? 'missing-market',
      tokenId: input.fixture.awayTokenId ?? 'missing-token',
      side: 'buy' as const,
      recipeKey: 'recipe:scoreboard-side-11-13:v1-volume95:balls-66-78:fixture-scoreboard-side-001:market-001:token-away-001:buy',
      conditionId: 'condition-existing',
    }
    const repository = new InMemoryObserverTradeIntentRepository({
      intents: [buildIntentRecord(existingIdentity)],
    })

    const result = await createObserverTradeIntent({
      ...input,
      repository,
    })

    expect(result).toMatchObject({ status: 'blocked', reason: 'INTENT_ALREADY_EXISTS' })
    expect(repository.intents).toHaveLength(1)
    expect(repository.getTradingRecipeCalls).toBe(0)
    expect(repository.createTradeIntentCalls).toBe(0)
  })

  test('fails open with a deterministic ignored result when recipe lookup throws unexpectedly', async () => {
    const input = buildObserverSignalInput()
    const repository: ObserverTradeIntentRepository = {
      getTradingRecipe: async () => {
        throw new Error('database temporarily unavailable')
      },
      createTradeIntent: async () => {
        throw new Error('should not be called after recipe lookup failure')
      },
    }

    const result = await createObserverTradeIntent({
      ...input,
      repository,
    })

    expect(result).toMatchObject({
      status: 'ignored',
      reason: 'INTENT_PERSISTENCE_FAILED',
      recipeKey: 'recipe:scoreboard-side-11-13:v1-value90:balls-66-78:fixture-scoreboard-side-001:market-001:token-home-001:buy',
      details: {
        step: 'getTradingRecipe',
        error: 'database temporarily unavailable',
      },
    })
  })

  test('fails open with a deterministic ignored result when durable intent creation throws unexpectedly', async () => {
    const input = buildObserverSignalInput()
    const repository: ObserverTradeIntentRepository = {
      getTradingRecipe: async () => buildRecipeRecord(input),
      createTradeIntent: async () => {
        throw new Error('intent insert failed')
      },
    }

    const result = await createObserverTradeIntent({
      ...input,
      repository,
    })

    expect(result).toMatchObject({
      status: 'ignored',
      reason: 'INTENT_PERSISTENCE_FAILED',
      details: {
        step: 'createTradeIntent',
        error: 'intent insert failed',
      },
    })
  })
})
