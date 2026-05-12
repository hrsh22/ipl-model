import { describe, expect, test } from 'vitest'

import { ELEVEN_OVER_STRATEGY_VERSION } from '../src/ipl/eleven-over-strategy.js'
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
  type TradingIntentRecord,
  type TradingRecipeRecord,
} from '../src/trading/repository.js'

const FIXED_NOW = new Date('2026-05-11T10:12:00.000Z')

const buildObserverSignalInput = (
  overrides: Partial<ObserverIntentSignalInput> = {},
): ObserverIntentSignalInput => ({
  fixture: {
    id: 'fixture-1',
    status: 'live',
    isLive: true,
    updatedAt: FIXED_NOW,
    homeTeam: 'Mumbai Indians',
    awayTeam: 'Chennai Super Kings',
    polymarketMarketSlug: 'mumbai-vs-chennai',
    homeTokenId: 'token-home',
    awayTokenId: 'token-away',
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
      scoreWickets: 4,
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

const buildRecipeRecord = (input: ObserverIntentSignalInput): TradingRecipeRecord => {
  const identity = {
    strategyKey: 'eleven-over',
    recipeVersion: ELEVEN_OVER_STRATEGY_VERSION,
    windowKey: `${ELEVEN_OVER_STRATEGY_VERSION}:${input.fixture.id}:innings-2:balls-66-72`,
    fixtureId: input.fixture.id,
    marketId: input.fixture.polymarketMarketSlug ?? 'missing-market',
    tokenId: input.fixture.homeTokenId ?? 'missing-token',
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
    conditionId: 'condition-1',
    tokenId: identity.tokenId,
    side: identity.side,
    orderStyle: 'limit',
    maxPrice: 0.41,
    size: 975.609756,
    expiryTime: new Date('2026-05-11T12:00:00.000Z'),
    context: { strategy: '11-over' },
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

  constructor(input?: { recipes?: TradingRecipeRecord[]; intents?: TradingIntentRecord[] }) {
    this.recipes = [...(input?.recipes ?? [])]
    this.intents = [...(input?.intents ?? [])]
  }

  async getTradingRecipe(recipeKey: string) {
    return this.recipes.find((recipe) => recipe.recipeKey === recipeKey) ?? null
  }

  async createTradeIntent(input: CreateTradeIntentInput): Promise<CreateTradeIntentResult> {
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
  test('creates one durable trade intent for a fresh eligible 11-over signal without submitting orders', async () => {
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
      strategyKey: 'eleven-over',
      recipeVersion: ELEVEN_OVER_STRATEGY_VERSION,
      fixtureId: 'fixture-1',
      marketId: 'mumbai-vs-chennai',
      tokenId: 'token-home',
      side: 'buy',
    })
    expect(repository.intents[0].context).toMatchObject({
      source: 'observer-live-model',
      sourceEvent: 'ball-state-runtime',
      favourite: {
        team: 'Mumbai Indians',
        side: 'home',
      },
    })
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

    expect(staleResult).toMatchObject({
      status: 'ignored',
      reason: 'SIGNAL_STALE',
    })
    expect(historicalResult).toMatchObject({
      status: 'ignored',
      reason: 'FIXTURE_NOT_LIVE',
    })
    expect(repository.intents).toHaveLength(0)
  })

  test('blocks replayed or duplicate polling cycles after the first durable intent is created', async () => {
    const input = buildObserverSignalInput()
    const repository = new InMemoryObserverTradeIntentRepository({
      recipes: [buildRecipeRecord(input)],
    })

    const first = await createObserverTradeIntent({
      ...input,
      repository,
    })
    const second = await createObserverTradeIntent({
      ...input,
      repository,
    })

    expect(first).toMatchObject({ status: 'created', reason: 'INTENT_CREATED' })
    expect(second).toMatchObject({ status: 'blocked', reason: 'INTENT_ALREADY_EXISTS' })
    expect(repository.intents).toHaveLength(1)
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
      recipeKey: 'recipe:eleven-over:2026-05-11-v1:2026-05-11-v1%3Afixture-1%3Ainnings-2%3Aballs-66-72:fixture-1:mumbai-vs-chennai:token-home:buy',
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
