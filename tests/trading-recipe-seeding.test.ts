import { describe, expect, test } from 'vitest'

import {
  SCOREBOARD_SIDE_STRATEGY_KEY,
  SCOREBOARD_SIDE_WINDOW_KEY,
} from '../src/ipl/scoreboard-side-strategy.js'
import {
  SCOREBOARD_SIDE_RECIPE_SOURCE_PLAN,
  buildScoreboardSideRecipeInputs,
  seedScoreboardSideTokenRecipes,
  type ScoreboardSideRecipeSeedRepository,
  type ScoreboardSideTokenRecipeSeedInput,
} from '../src/trading/scoreboard-side-recipes.js'
import type { TradingRecipeRecord, TradingRecipeUpsertInput } from '../src/trading/repository.js'

const FIXED_NOW = new Date('2026-05-11T10:12:00.000Z')
const EXPIRY_TIME = new Date('2026-05-11T12:00:00.000Z')

const buildSeedInput = (
  overrides: Partial<ScoreboardSideTokenRecipeSeedInput> = {},
): ScoreboardSideTokenRecipeSeedInput => ({
  fixtureId: 'fixture-scoreboard-side-001',
  marketId: 'market-001',
  conditionId: 'condition-001',
  homeTeam: 'Mumbai Indians',
  awayTeam: 'Chennai Super Kings',
  homeTokenId: 'token-home-001',
  awayTokenId: 'token-away-001',
  size: 20,
  expiryTime: EXPIRY_TIME,
  ...overrides,
})

class InMemoryRecipeSeedRepository implements ScoreboardSideRecipeSeedRepository {
  records = new Map<string, TradingRecipeRecord>()
  upsertCalls: TradingRecipeUpsertInput[] = []

  async upsertTradingRecipe(input: TradingRecipeUpsertInput) {
    this.upsertCalls.push(input)
    const existing = this.records.get(input.recipeKey ?? '')
    const createdAt = existing?.createdAt ?? FIXED_NOW
    const record: TradingRecipeRecord = {
      recipeKey: input.recipeKey ?? '',
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
      createdAt,
      updatedAt: existing ? new Date(FIXED_NOW.getTime() + this.upsertCalls.length) : FIXED_NOW,
    }
    this.records.set(record.recipeKey, record)
    return record
  }
}

describe('scoreboard-side recipe seeding', () => {
  test('builds exactly two default value90 BUY recipes for home and away tokens', () => {
    const recipes = buildScoreboardSideRecipeInputs(buildSeedInput())

    expect(recipes).toHaveLength(2)
    expect(recipes.map((recipe) => recipe.tokenId)).toEqual(['token-home-001', 'token-away-001'])
    expect(recipes.map((recipe) => recipe.side)).toEqual(['buy', 'buy'])
    expect(recipes.map((recipe) => recipe.recipeKey)).toEqual([
      'recipe:scoreboard-side-11-13:v1-value90:balls-66-78:fixture-scoreboard-side-001:market-001:token-home-001:buy',
      'recipe:scoreboard-side-11-13:v1-value90:balls-66-78:fixture-scoreboard-side-001:market-001:token-away-001:buy',
    ])

    for (const recipe of recipes) {
      expect(recipe).toMatchObject({
        strategyKey: SCOREBOARD_SIDE_STRATEGY_KEY,
        recipeVersion: 'v1-value90',
        windowKey: SCOREBOARD_SIDE_WINDOW_KEY,
        fixtureId: 'fixture-scoreboard-side-001',
        marketId: 'market-001',
        conditionId: 'condition-001',
        orderStyle: 'limit',
        maxPrice: 0.9,
        size: 20,
        expiryTime: EXPIRY_TIME,
      })
      expect(recipe.context).toMatchObject({
        strategyMode: 'value90',
        priceCap: 0.9,
        allocationFraction: 0.2,
        sourcePlanDoc: SCOREBOARD_SIDE_RECIPE_SOURCE_PLAN,
      })
    }
    expect(recipes[0]?.context).toMatchObject({ tokenSide: 'home', tokenTeam: 'Mumbai Indians' })
    expect(recipes[1]?.context).toMatchObject({ tokenSide: 'away', tokenTeam: 'Chennai Super Kings' })
  })

  test('rerunning the default seed is idempotent and updates the same two recipe identities', async () => {
    const repository = new InMemoryRecipeSeedRepository()
    const input = buildSeedInput()

    const first = await seedScoreboardSideTokenRecipes(input, repository)
    const second = await seedScoreboardSideTokenRecipes({ ...input, size: 25 }, repository)

    expect(first.recipes).toHaveLength(2)
    expect(second.recipes).toHaveLength(2)
    expect(repository.records.size).toBe(2)
    expect(repository.upsertCalls).toHaveLength(4)
    expect(second.recipes.map((recipe) => recipe.recipeKey)).toEqual(first.recipes.map((recipe) => recipe.recipeKey))
    expect([...repository.records.values()].map((recipe) => recipe.size)).toEqual([25, 25])
    expect(second).toMatchObject({ mode: 'value90', recipeVersion: 'v1-value90' })
  })

  test('seeds volume95 only when explicitly requested', async () => {
    const defaultRecipes = buildScoreboardSideRecipeInputs(buildSeedInput())
    const volumeRecipes = buildScoreboardSideRecipeInputs(buildSeedInput({ mode: 'volume95' }))
    const repository = new InMemoryRecipeSeedRepository()

    const seeded = await seedScoreboardSideTokenRecipes(buildSeedInput({ mode: 'volume95' }), repository)

    expect(defaultRecipes.map((recipe) => recipe.recipeVersion)).toEqual(['v1-value90', 'v1-value90'])
    expect(volumeRecipes.map((recipe) => recipe.recipeVersion)).toEqual(['v1-volume95', 'v1-volume95'])
    expect(volumeRecipes.map((recipe) => recipe.maxPrice)).toEqual([0.95, 0.95])
    expect(volumeRecipes.map((recipe) => recipe.context)).toEqual([
      expect.objectContaining({ strategyMode: 'volume95', priceCap: 0.95, allocationFraction: 0.1 }),
      expect.objectContaining({ strategyMode: 'volume95', priceCap: 0.95, allocationFraction: 0.1 }),
    ])
    expect(seeded).toMatchObject({ mode: 'volume95', recipeVersion: 'v1-volume95' })
    expect(repository.records.size).toBe(2)
  })
})
