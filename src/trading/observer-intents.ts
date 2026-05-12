import { normalizeTeamName } from "../model-data/aliases.js"
import {
  evaluateElevenOverEntry,
  type FavouriteRole,
  type FavouriteSignal,
} from "../ipl/eleven-over-strategy.js"
import {
  buildTradeRecipeKey,
  createTradeIntent,
  getTradingRecipe,
  type CreateTradeIntentInput,
  type CreateTradeIntentResult,
  type TradingRecipeRecord,
} from "./repository.js"

const ELEVEN_OVER_STRATEGY_KEY = "eleven-over"
const ELEVEN_OVER_TRADE_SIDE = "buy" as const
const MAX_SIGNAL_AGE_MS = 30_000
const MAX_FIXTURE_AGE_MS = 45 * 60 * 1000

type InningsStateStatus = "live" | "frozen" | "pending" | "unavailable"

export interface ObserverIntentFixtureSnapshot {
  id: string
  status: string
  isLive: boolean
  updatedAt: Date
  homeTeam: string
  awayTeam: string
  polymarketMarketSlug: string | null
  homeTokenId: string | null
  awayTokenId: string | null
}

export interface ObserverIntentInningsState {
  innings: number | null
  battingTeam: string | null
  bowlingTeam: string | null
  scoreRuns: number | null
  scoreWickets: number | null
  balls: number | null
  targetRuns: number | null
  chaseSuccessProbability: number | null
  status: InningsStateStatus
}

export interface ObserverIntentMarketSide {
  team: string
  marketProbability: number | null
}

export interface ObserverIntentSignalInput {
  fixture: ObserverIntentFixtureSnapshot
  inningsStates: {
    activeInnings: number | null
    first: ObserverIntentInningsState
    second: ObserverIntentInningsState
  }
  home: ObserverIntentMarketSide
  away: ObserverIntentMarketSide
  sourceEvent: string
  confidence: string
  observedAt?: Date
  now?: () => Date
  repository?: ObserverTradeIntentRepository
}

export interface ObserverTradeIntentRepository {
  getTradingRecipe(recipeKey: string): Promise<TradingRecipeRecord | null>
  createTradeIntent(input: CreateTradeIntentInput): Promise<CreateTradeIntentResult>
}

export type ObserverTradeIntentResult =
  | {
      status: "created"
      reason: "INTENT_CREATED"
      recipeKey: string
      intent: CreateTradeIntentResult["record"]
      evaluation: ReturnType<typeof evaluateElevenOverEntry>
    }
  | {
      status: "blocked"
      reason: "INTENT_ALREADY_EXISTS"
      recipeKey: string
      intent: CreateTradeIntentResult["record"]
      evaluation: ReturnType<typeof evaluateElevenOverEntry>
    }
  | {
      status: "ignored"
      reason:
        | "SIGNAL_STALE"
        | "FIXTURE_STATE_STALE"
        | "FIXTURE_NOT_LIVE"
        | "SECOND_INNINGS_NOT_LIVE"
        | "RECIPE_IDENTITY_INCOMPLETE"
        | "RECIPE_MISSING"
        | "INTENT_PERSISTENCE_FAILED"
        | "STRATEGY_WAIT"
        | "STRATEGY_PASSED"
        | "STRATEGY_SKIP"
      evaluation: ReturnType<typeof evaluateElevenOverEntry>
      recipeKey?: string
      details?: Record<string, unknown>
    }

type ObserverIntentPersistenceFailureResult = {
  status: "ignored"
  reason: "INTENT_PERSISTENCE_FAILED"
  recipeKey: string
  evaluation: ReturnType<typeof evaluateElevenOverEntry>
  details: {
    step: "getTradingRecipe" | "createTradeIntent"
    error: string
  }
}

const defaultRepository: ObserverTradeIntentRepository = {
  getTradingRecipe,
  createTradeIntent,
}

type FavouriteResult =
  | {
      kind: "clear"
      team: string
      side: "home" | "away"
      price: number
      otherPrice: number
      lead: number
    }
  | {
      kind: "unclear"
      reason: string
    }

export const createObserverTradeIntent = async (
  input: ObserverIntentSignalInput,
): Promise<ObserverTradeIntentResult> => {
  const repository = input.repository ?? defaultRepository
  const now = input.now?.() ?? new Date()
  const observedAt = input.observedAt ?? now
  const inningsStates = input.inningsStates
  const first = inningsStates.first
  const second = inningsStates.second
  const secondBalls = second.balls
  const target = second.targetRuns ?? (first.scoreRuns === null ? null : first.scoreRuns + 1)
  const ballsLeft = secondBalls === null ? null : Math.max(120 - secondBalls, 0)
  const runsNeeded = target === null || second.scoreRuns === null ? null : Math.max(target - second.scoreRuns, 0)
  const oversFaced = secondBalls === null || secondBalls === 0 ? null : secondBalls / 6
  const oversLeft = ballsLeft === null ? null : ballsLeft / 6
  const currentRate = second.scoreRuns === null || oversFaced === null ? null : second.scoreRuns / oversFaced
  const requiredRate =
    runsNeeded === null || oversLeft === null
      ? null
      : oversLeft === 0
        ? runsNeeded === 0
          ? 0
          : null
        : runsNeeded / oversLeft
  const favourite = getFavourite(input.home, input.away)
  const secondInningsAvailable = second.innings === 2 && second.status !== "pending" && second.status !== "unavailable"
  const chasingTeam = second.battingTeam
  const defendingTeam = first.battingTeam ?? second.bowlingTeam
  const favouriteRole = favourite.kind === "clear" && secondInningsAvailable
    ? getFavouriteRole(favourite.team, chasingTeam, defendingTeam, second.bowlingTeam)
    : null
  const fixtureFinished = second.status === "frozen" || isFinishedStatus(input.fixture.status) || runsNeeded === 0
  const warnings = collectDataQualityWarnings({
    fixture: input.fixture,
    first,
    second,
    target,
    secondBalls,
    favourite,
    favouriteRole,
    fixtureFinished,
    observedAt,
    now,
  })
  const firstBalls = first.balls
  const firstInningsComplete =
    first.status === "frozen"
    || inningsStates.activeInnings === 2
    || second.status === "live"
    || second.status === "frozen"
  const targetMismatch =
    second.targetRuns !== null && first.scoreRuns !== null && second.targetRuns !== first.scoreRuns + 1
  const reducedOverRisk =
    firstInningsComplete
    && (targetMismatch || (firstBalls !== null && firstBalls < 120 && (first.scoreWickets === null || first.scoreWickets < 10)))
  const evaluation = evaluateElevenOverEntry({
    fixtureId: input.fixture.id,
    inningsNumber: 2,
    secondBalls,
    requiredRate,
    currentRate,
    wicketsLost: second.scoreWickets,
    favourite: toStrategyFavouriteSignal(favourite),
    favouriteRole,
    chaseSuccessProbability: second.chaseSuccessProbability,
    fixtureFinished,
    dataQualityWarnings: warnings,
    reducedOverRisk,
  })

  if (!input.fixture.isLive) {
    return { status: "ignored", reason: "FIXTURE_NOT_LIVE", evaluation }
  }

  if (!secondInningsAvailable) {
    return { status: "ignored", reason: "SECOND_INNINGS_NOT_LIVE", evaluation }
  }

  if (observedAt.getTime() < now.getTime() - MAX_SIGNAL_AGE_MS) {
    return { status: "ignored", reason: "SIGNAL_STALE", evaluation }
  }

  if (input.fixture.updatedAt.getTime() < now.getTime() - MAX_FIXTURE_AGE_MS) {
    return { status: "ignored", reason: "FIXTURE_STATE_STALE", evaluation }
  }

  if (evaluation.action === "wait") {
    return { status: "ignored", reason: "STRATEGY_WAIT", evaluation }
  }

  if (evaluation.action === "passed") {
    return { status: "ignored", reason: "STRATEGY_PASSED", evaluation }
  }

  if (evaluation.action !== "buy") {
    return {
      status: "ignored",
      reason: "STRATEGY_SKIP",
      evaluation,
      details: {
        warnings: evaluation.dataQualityWarnings,
        checkpoint: evaluation.checkpoint,
      },
    }
  }

  const marketId = input.fixture.polymarketMarketSlug
  const tokenId = favourite.kind === "clear"
    ? favourite.side === "home"
      ? input.fixture.homeTokenId
      : input.fixture.awayTokenId
    : null

  if (!marketId || !tokenId) {
    return { status: "ignored", reason: "RECIPE_IDENTITY_INCOMPLETE", evaluation }
  }

  const identity = {
    strategyKey: ELEVEN_OVER_STRATEGY_KEY,
    recipeVersion: evaluation.strategyVersion,
    windowKey: evaluation.windowKey,
    fixtureId: input.fixture.id,
    marketId,
    tokenId,
    side: ELEVEN_OVER_TRADE_SIDE,
  } as const

  const recipeKey = buildTradeRecipeKey(identity)
  const recipe = await repository.getTradingRecipe(recipeKey).catch((error: unknown) => {
    return buildPersistenceFailureResult(evaluation, recipeKey, "getTradingRecipe", error)
  })

  if (isPersistenceFailureResult(recipe)) {
    return recipe
  }

  if (!recipe) {
    return { status: "ignored", reason: "RECIPE_MISSING", recipeKey, evaluation }
  }

  const result = await repository.createTradeIntent({
    ...identity,
    recipeKey,
    conditionId: recipe.conditionId,
    context: {
      source: "observer-live-model",
      sourceEvent: input.sourceEvent,
      observedAt: observedAt.toISOString(),
      confidence: input.confidence,
      favourite: favourite.kind === "clear"
        ? {
            team: favourite.team,
            side: favourite.side,
            price: favourite.price,
            otherPrice: favourite.otherPrice,
            lead: favourite.lead,
          }
        : favourite,
      evaluation,
      innings: {
        activeInnings: inningsStates.activeInnings,
        first,
        second,
      },
      metrics: {
        target,
        runsNeeded,
        currentRate,
        requiredRate,
        wicketsLost: second.scoreWickets,
        chasingTeam,
        defendingTeam,
      },
    },
  }).catch((error: unknown) => {
    return buildPersistenceFailureResult(evaluation, recipeKey, "createTradeIntent", error)
  })

  if (isPersistenceFailureResult(result)) {
    return result
  }

  if (!result.created) {
    return {
      status: "blocked",
      reason: "INTENT_ALREADY_EXISTS",
      recipeKey,
      intent: result.record,
      evaluation,
    }
  }

  return {
    status: "created",
    reason: "INTENT_CREATED",
    recipeKey,
    intent: result.record,
    evaluation,
  }
}

const toStrategyFavouriteSignal = (favourite: FavouriteResult): FavouriteSignal =>
  favourite.kind === "clear"
    ? { kind: "clear", lead: favourite.lead }
    : { kind: "unclear", reason: favourite.reason }

const getFavourite = (
  home: ObserverIntentMarketSide,
  away: ObserverIntentMarketSide,
): FavouriteResult => {
  const homePrice = home.marketProbability
  const awayPrice = away.marketProbability

  if (homePrice === null || awayPrice === null) {
    return { kind: "unclear", reason: "Missing YES price for one or both teams." }
  }

  if (Math.abs(homePrice - awayPrice) < 0.005) {
    return { kind: "unclear", reason: "YES prices are tied or too close to call." }
  }

  return homePrice > awayPrice
    ? {
        kind: "clear",
        team: home.team,
        side: "home",
        price: homePrice,
        otherPrice: awayPrice,
        lead: homePrice - awayPrice,
      }
    : {
        kind: "clear",
        team: away.team,
        side: "away",
        price: awayPrice,
        otherPrice: homePrice,
        lead: awayPrice - homePrice,
      }
}

const getFavouriteRole = (
  favouriteTeam: string,
  chasingTeam: string | null,
  defendingTeam: string | null,
  bowlingTeam: string | null,
): FavouriteRole | null => {
  if (teamsComparable(favouriteTeam, chasingTeam)) {
    return "chasing"
  }

  if (teamsComparable(favouriteTeam, defendingTeam) || teamsComparable(favouriteTeam, bowlingTeam)) {
    return "defending"
  }

  return null
}

const collectDataQualityWarnings = (input: {
  fixture: ObserverIntentFixtureSnapshot
  first: ObserverIntentInningsState
  second: ObserverIntentInningsState
  target: number | null
  secondBalls: number | null
  favourite: FavouriteResult
  favouriteRole: FavouriteRole | null
  fixtureFinished: boolean
  observedAt: Date
  now: Date
}) => {
  const warnings: string[] = []
  const secondInningsPending =
    input.second.innings !== 2 || input.second.status === "pending" || input.second.status === "unavailable"

  if (input.favourite.kind === "unclear") {
    warnings.push(input.favourite.reason)
  }

  if (
    input.favourite.kind === "clear"
    && input.favouriteRole === null
    && input.second.status !== "pending"
    && input.second.status !== "unavailable"
  ) {
    warnings.push("Could not map the favourite to chasing or defending side.")
  }

  if (secondInningsPending) {
    warnings.push("First innings is still in progress; wait until the chase starts.")
  }

  if (!secondInningsPending && input.secondBalls === null) {
    warnings.push("Ball count is missing, so the 66-72 ball entry window is unclear.")
  }

  if (!secondInningsPending && input.target === null) {
    warnings.push("Target is missing, so required rate cannot be trusted.")
  }

  if (!secondInningsPending && input.second.scoreRuns === null) {
    warnings.push("Chasing score is missing.")
  }

  if (!secondInningsPending && input.second.scoreWickets === null) {
    warnings.push("Chasing wickets are missing.")
  }

  if (input.first.scoreRuns === null) {
    warnings.push("First-innings score is missing.")
  }

  if (input.fixtureFinished) {
    warnings.push("Match is already finished; the entry window is no longer live.")
  }

  if (!input.fixture.isLive) {
    warnings.push("Fixture is not currently live.")
  }

  if (input.observedAt.getTime() < input.now.getTime() - MAX_SIGNAL_AGE_MS) {
    warnings.push("Live model signal is stale.")
  }

  if (input.fixture.updatedAt.getTime() < input.now.getTime() - MAX_FIXTURE_AGE_MS) {
    warnings.push("Fixture state is stale.")
  }

  return warnings
}

const teamsComparable = (left: string | null, right: string | null) =>
  normalizeSelection(left) === normalizeSelection(right)

const normalizeSelection = (value: string | null) =>
  normalizeTeamName(value ?? "").trim().toLowerCase().replace(/\s+/g, "_")

const isFinishedStatus = (status: string) => {
  const normalized = status.toLowerCase()
  return (
    normalized.includes("complete")
    || normalized.includes("final")
    || normalized.includes("finished")
    || normalized.includes("ended")
  )
}

const isPersistenceFailureResult = (
  value: TradingRecipeRecord | CreateTradeIntentResult | ObserverTradeIntentResult | null,
): value is ObserverIntentPersistenceFailureResult =>
  typeof value === "object"
  && value !== null
  && "status" in value
  && value.status === "ignored"
  && "reason" in value
  && value.reason === "INTENT_PERSISTENCE_FAILED"

const buildPersistenceFailureResult = (
  evaluation: ReturnType<typeof evaluateElevenOverEntry>,
  recipeKey: string,
  step: "getTradingRecipe" | "createTradeIntent",
  error: unknown,
): ObserverIntentPersistenceFailureResult => ({
  status: "ignored",
  reason: "INTENT_PERSISTENCE_FAILED",
  recipeKey,
  evaluation,
  details: {
    step,
    error: toSafeObserverTradeIntentErrorMessage(error),
  },
})

const toSafeObserverTradeIntentErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /(authorization|bearer|private[_\s-]*key|api[_\s-]*key|secret|passphrase|postgres(?:ql)?:\/\/)/i.test(message)
    ? "redacted-sensitive-error"
    : message.slice(0, 300)
}
