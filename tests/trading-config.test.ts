import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  assessTradingLiveReadiness,
  validateTradingRecipe,
  type ValidatedTradingRecipe,
  type TradingRecipeInput,
} from '../src/trading/config.js'

const REQUIRED_BASE_ENV = {
  PORT: '8080',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://localhost:5432/ipl_trader_test',
} as const
const VALID_PRIVATE_KEY = `0x${'1'.repeat(64)}`
const VALID_BUILDER_CODE = `0x${'2'.repeat(64)}`

const TRADING_ENV_KEYS = [
  'TRADING_LIVE_ENABLED',
  'POLYMARKET_PRIVATE_KEY',
  'POLY_BUILDER_CODE',
  'SCOREBOARD_SIDE_STRATEGY_MODE',
] as const

const buildValidRecipeInput = (): TradingRecipeInput => ({
  marketId: 'market-id',
  conditionId: 'condition-id',
  tokenId: 'token-id',
  side: 'buy',
  orderStyle: 'limit',
  maxPrice: 0.41,
  expiryEpochMs: 1_800_000_000_000,
})

const loadFreshConfig = async (overrides: Partial<NodeJS.ProcessEnv> = {}) => {
  vi.resetModules()

  const nextEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...REQUIRED_BASE_ENV,
  }

  for (const key of TRADING_ENV_KEYS) {
    nextEnv[key] = ''
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete nextEnv[key]
    } else {
      nextEnv[key] = value
    }
  }

  process.env = nextEnv

  return import('../src/config.js')
}

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe('trading config env defaults', () => {
  test('defaults trading to dry-run when trading env vars are unset', async () => {
    const { config } = await loadFreshConfig()

    expect(config.trading).toEqual({
      liveEnabled: false,
      polymarketCredentials: {
        privateKeyPresent: false,
        builderCodePresent: false,
        allPresent: false,
      },
      staleWindows: {
        matchStateMaxAgeMs: 30000,
        bookMaxAgeMs: 15000,
      },
      dailyBoundaryTimezone: 'Asia/Kolkata',
      executor: {
        enabled: true,
        intervalMs: 5000,
        leaseMs: 30000,
        workerId: 'polymarket-runtime-executor',
      },
      polymarketClob: {
        host: 'https://clob.polymarket.com',
        chainId: 137,
      },
      scoreboardSideStrategy: {
        mode: 'value90',
        strategyVersion: 'v1-value90',
        priceCap: 0.9,
        allocationFraction: 0.2,
      },
    })
  })

  test('defaults blank scoreboard-side strategy mode to value90 settings', async () => {
    const { config } = await loadFreshConfig({ SCOREBOARD_SIDE_STRATEGY_MODE: '   ' })

    expect(config.trading.scoreboardSideStrategy).toEqual({
      mode: 'value90',
      strategyVersion: 'v1-value90',
      priceCap: 0.9,
      allocationFraction: 0.2,
    })
  })

  test('accepts explicit value90 scoreboard-side strategy mode', async () => {
    const { config } = await loadFreshConfig({ SCOREBOARD_SIDE_STRATEGY_MODE: 'value90' })

    expect(config.trading.scoreboardSideStrategy).toEqual({
      mode: 'value90',
      strategyVersion: 'v1-value90',
      priceCap: 0.9,
      allocationFraction: 0.2,
    })
  })

  test('accepts explicit volume95 scoreboard-side strategy mode', async () => {
    const { config } = await loadFreshConfig({ SCOREBOARD_SIDE_STRATEGY_MODE: 'volume95' })

    expect(config.trading.scoreboardSideStrategy).toEqual({
      mode: 'volume95',
      strategyVersion: 'v1-volume95',
      priceCap: 0.95,
      allocationFraction: 0.1,
    })
  })

  test('rejects invalid scoreboard-side strategy mode', async () => {
    await expect(loadFreshConfig({ SCOREBOARD_SIDE_STRATEGY_MODE: 'aggressive' })).rejects.toThrow(
      'SCOREBOARD_SIDE_STRATEGY_MODE must be one of: value90, volume95',
    )
  })

  test('requires only the private key and builder code for live credential readiness', async () => {
    const { config } = await loadFreshConfig({
      POLYMARKET_PRIVATE_KEY: VALID_PRIVATE_KEY,
      POLY_BUILDER_CODE: VALID_BUILDER_CODE,
    })

    expect(config.trading.polymarketCredentials).toMatchObject({
      privateKeyPresent: true,
      builderCodePresent: true,
      allPresent: true,
    })
  })

  test('fails credential readiness closed when the builder code is missing', async () => {
    const { config } = await loadFreshConfig({
      POLYMARKET_PRIVATE_KEY: VALID_PRIVATE_KEY,
    })

    expect(config.trading.polymarketCredentials).toMatchObject({
      privateKeyPresent: true,
      builderCodePresent: false,
      allPresent: false,
    })
  })

})

describe('trading recipe validation', () => {
  test.each([
    ['marketId', { marketId: '' }, 'marketId is required'],
    ['conditionId', { conditionId: '' }, 'conditionId is required'],
    ['tokenId', { tokenId: '' }, 'tokenId is required'],
    ['side', { side: null }, 'side is required'],
    ['orderStyle', { orderStyle: null }, 'orderStyle is required'],
    ['maxPrice', { maxPrice: null }, 'maxPrice is required'],
    ['expiryEpochMs', { expiryEpochMs: null }, 'expiryEpochMs is required'],
  ])('rejects missing %s before live submission', (_fieldName, override, expectedError) => {
    const recipe = validateTradingRecipe({
      ...buildValidRecipeInput(),
      ...override,
    })

    expect(recipe.ok).toBe(false)
    if (!recipe.ok) {
      expect(recipe.errors).toContain(expectedError)
    }
  })

  test('keeps recipe validation separate from live balance sizing', () => {
    const recipe = validateTradingRecipe(buildValidRecipeInput())

    expect(recipe.ok).toBe(true)
    if (recipe.ok) {
      expect(recipe.value).not.toHaveProperty('notionalUsd')
      expect(recipe.value).not.toHaveProperty('size')
    }
  })
})

describe('trading live readiness', () => {
  test.each([
    [
      'env gate is disabled',
      {
        liveTradingEnabled: false,
        credentialsPresent: true,
      },
      'ENV_LIVE_GATE_DISABLED',
    ],
    [
      'credentials are missing',
      {
        liveTradingEnabled: true,
        credentialsPresent: false,
      },
      'POLYMARKET_CREDENTIALS_MISSING',
    ],
  ])('refuses live mode when %s', (_label, readinessOverride, expectedCode) => {
    const recipe = validateTradingRecipe(buildValidRecipeInput())
    expect(recipe.ok).toBe(true)

    const readiness = assessTradingLiveReadiness({
      liveTradingEnabled: readinessOverride.liveTradingEnabled ?? true,
      credentialsPresent: readinessOverride.credentialsPresent ?? true,
      recipe,
    })

    expect(readiness.liveReady).toBe(false)
    expect(readiness.mode).toBe('dry-run')
    expect(readiness.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: expectedCode })]),
    )
  })

  test('refuses live mode when the recipe is invalid', () => {
    const recipe = validateTradingRecipe({
      ...buildValidRecipeInput(),
      marketId: '',
    })

    const readiness = assessTradingLiveReadiness({
      liveTradingEnabled: true,
      credentialsPresent: true,
      recipe,
    })

    expect(readiness.liveReady).toBe(false)
    expect(readiness.mode).toBe('dry-run')
    expect(readiness.reasons).toEqual([
      {
          code: 'RECIPE_INVALID',
          errors: ['marketId is required'],
        },
    ])
  })

  test('returns the validated recipe value when live mode is ready from an ok validation result', () => {
    const recipe = validateTradingRecipe(buildValidRecipeInput())

    expect(recipe.ok).toBe(true)

    const readiness = assessTradingLiveReadiness({
      liveTradingEnabled: true,
      credentialsPresent: true,
      recipe,
    })

    expect(readiness.liveReady).toBe(true)
    expect(readiness).toEqual({
      liveReady: true,
      mode: 'live',
      recipe: recipe.ok ? recipe.value : undefined,
      reasons: [],
    })

    if (readiness.liveReady) {
      expect(readiness.recipe).toHaveProperty('marketId', 'market-id')
      expect(readiness.recipe).not.toHaveProperty('ok')
      expect(readiness.recipe).not.toHaveProperty('value')
    }
  })

  test('accepts a raw validated recipe when live mode is ready', () => {
    const recipeResult = validateTradingRecipe(buildValidRecipeInput())

    expect(recipeResult.ok).toBe(true)

    if (!recipeResult.ok) {
      throw new Error('Expected a validated trading recipe test fixture')
    }

    const validatedRecipe: ValidatedTradingRecipe = recipeResult.value

    const readiness = assessTradingLiveReadiness({
      liveTradingEnabled: true,
      credentialsPresent: true,
      recipe: validatedRecipe,
    })

    expect(readiness.liveReady).toBe(true)
    expect(readiness).toEqual({
      liveReady: true,
      mode: 'live',
      recipe: validatedRecipe,
      reasons: [],
    })
  })
})
