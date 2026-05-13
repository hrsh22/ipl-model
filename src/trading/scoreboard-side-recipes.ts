import {
  SCOREBOARD_SIDE_STRATEGY_KEY,
  SCOREBOARD_SIDE_WINDOW_KEY,
  getScoreboardSideStrategySettings,
  type ScoreboardSideStrategyMode,
  type ScoreboardSideTokenSide,
} from "../ipl/scoreboard-side-strategy.js"
import {
  buildTradeRecipeKey,
  upsertTradingRecipe,
  type TradingRecipeRecord,
  type TradingRecipeUpsertInput,
} from "./repository.js"

export const SCOREBOARD_SIDE_RECIPE_SOURCE_PLAN = ".sisyphus/plans/scoreboard-side-trader-strategy.md"

export interface ScoreboardSideTokenRecipeSeedInput {
  fixtureId: string
  marketId: string
  conditionId: string
  homeTeam: string
  awayTeam: string
  homeTokenId: string
  awayTokenId: string
  size: number
  expiryTime: Date
  mode?: ScoreboardSideStrategyMode
}

export interface ScoreboardSideRecipeSeedRepository {
  upsertTradingRecipe: (input: TradingRecipeUpsertInput) => Promise<TradingRecipeRecord | null>
}

export interface ScoreboardSideRecipeSeedResult {
  mode: ScoreboardSideStrategyMode
  recipeVersion: `v1-${ScoreboardSideStrategyMode}`
  recipes: TradingRecipeRecord[]
}

const defaultRepository: ScoreboardSideRecipeSeedRepository = {
  upsertTradingRecipe,
}

const buildScoreboardSideRecipeContext = (
  input: ScoreboardSideTokenRecipeSeedInput,
  tokenSide: ScoreboardSideTokenSide,
  tokenTeam: string,
  settings: ReturnType<typeof getScoreboardSideStrategySettings>,
) => ({
  strategyMode: settings.mode,
  priceCap: settings.priceCap,
  allocationFraction: settings.allocationFraction,
  sourcePlanDoc: SCOREBOARD_SIDE_RECIPE_SOURCE_PLAN,
  tokenSide,
  tokenTeam,
  fixtureId: input.fixtureId,
  marketId: input.marketId,
})

const buildScoreboardSideTokenRecipeInput = (
  input: ScoreboardSideTokenRecipeSeedInput,
  tokenSide: ScoreboardSideTokenSide,
  tokenId: string,
  tokenTeam: string,
): TradingRecipeUpsertInput => {
  const settings = getScoreboardSideStrategySettings(input.mode)
  const identity = {
    strategyKey: SCOREBOARD_SIDE_STRATEGY_KEY,
    recipeVersion: settings.strategyVersion,
    windowKey: SCOREBOARD_SIDE_WINDOW_KEY,
    fixtureId: input.fixtureId,
    marketId: input.marketId,
    tokenId,
    side: "buy" as const,
  }

  return {
    ...identity,
    recipeKey: buildTradeRecipeKey(identity),
    conditionId: input.conditionId,
    orderStyle: "limit",
    maxPrice: settings.priceCap,
    size: input.size,
    expiryTime: input.expiryTime,
    context: buildScoreboardSideRecipeContext(input, tokenSide, tokenTeam, settings),
  }
}

export const buildScoreboardSideRecipeInputs = (
  input: ScoreboardSideTokenRecipeSeedInput,
): [TradingRecipeUpsertInput, TradingRecipeUpsertInput] => [
  buildScoreboardSideTokenRecipeInput(input, "home", input.homeTokenId, input.homeTeam),
  buildScoreboardSideTokenRecipeInput(input, "away", input.awayTokenId, input.awayTeam),
]

export const seedScoreboardSideTokenRecipes = async (
  input: ScoreboardSideTokenRecipeSeedInput,
  repository: ScoreboardSideRecipeSeedRepository = defaultRepository,
): Promise<ScoreboardSideRecipeSeedResult> => {
  const settings = getScoreboardSideStrategySettings(input.mode)
  const upsertInputs = buildScoreboardSideRecipeInputs(input)
  const recipes = await Promise.all(
    upsertInputs.map((recipeInput) => repository.upsertTradingRecipe(recipeInput)),
  )

  return {
    mode: settings.mode,
    recipeVersion: settings.strategyVersion,
    recipes: recipes.filter((recipe): recipe is TradingRecipeRecord => recipe !== null),
  }
}
