import { normalizeTeamName } from "../model-data/aliases.js"
import {
  SCOREBOARD_SIDE_STRATEGY_KEY,
  SCOREBOARD_SIDE_WINDOW_KEY,
  evaluateScoreboardSideStrategy,
  type ScoreboardSideSignalSide,
  type ScoreboardSideTokenSide,
} from "../ipl/scoreboard-side-strategy.js"
import { config } from "../config.js"
import {
  buildTradeRecipeKey,
  createTradeIntent,
  findTradeIntentByFixtureScope,
  getTradingRecipe,
  upsertTradingRecipe,
  type CreateTradeIntentInput,
  type CreateTradeIntentResult,
  type FixtureTradeIntentIdentity,
  type TradingIntentRecord,
  type TradingRecipeRecord,
  type TradingRecipeUpsertInput,
} from "./repository.js"
import { seedScoreboardSideTokenRecipes } from "./scoreboard-side-recipes.js"

const SCOREBOARD_SIDE_TRADE_SIDE = "buy" as const
const MAX_SIGNAL_AGE_MS = 30_000
const MAX_FIXTURE_AGE_MS = 45 * 60 * 1000
const SCOREBOARD_SIDE_NOMINAL_RECIPE_SIZE = 100
const SCOREBOARD_SIDE_RECIPE_EXPIRY_AFTER_START_MS = 6 * 60 * 60 * 1000
const SCOREBOARD_SIDE_MIN_RECIPE_EXPIRY_FROM_NOW_MS = 60 * 60 * 1000

type InningsStateStatus = "live" | "frozen" | "pending" | "unavailable"

export interface ObserverIntentFixtureSnapshot {
  id: string
  status: string
  isLive: boolean
  updatedAt: Date
  homeTeam: string
  awayTeam: string
  startTime: Date
  polymarketMarketSlug: string | null
  polymarketConditionId: string | null
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
  findTradeIntentByFixtureScope?(identity: FixtureTradeIntentIdentity): Promise<TradingIntentRecord | null>
  upsertTradingRecipe?(input: TradingRecipeUpsertInput): Promise<TradingRecipeRecord | null>
}

export type ObserverTradeIntentResult =
  | {
      status: "created"
      reason: "INTENT_CREATED"
      recipeKey: string
      intent: CreateTradeIntentResult["record"]
      evaluation: ReturnType<typeof evaluateScoreboardSideStrategy>
    }
  | {
      status: "blocked"
      reason: "INTENT_ALREADY_EXISTS"
      recipeKey: string
      intent: CreateTradeIntentResult["record"]
      evaluation: ReturnType<typeof evaluateScoreboardSideStrategy>
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
        | "SIDE_TOKEN_UNSUPPORTED"
        | "STRATEGY_WAIT"
        | "STRATEGY_PASSED"
        | "STRATEGY_SKIP"
      evaluation: ReturnType<typeof evaluateScoreboardSideStrategy>
      recipeKey?: string
      details?: Record<string, unknown>
    }

type ObserverIntentPersistenceFailureResult = {
  status: "ignored"
  reason: "INTENT_PERSISTENCE_FAILED"
  recipeKey: string
  evaluation: ReturnType<typeof evaluateScoreboardSideStrategy>
  details: {
    step: "findTradeIntentByFixtureScope" | "seedTradingRecipes" | "getTradingRecipe" | "createTradeIntent"
    error: string
  }
}

const defaultRepository: ObserverTradeIntentRepository = {
  getTradingRecipe,
  createTradeIntent,
  findTradeIntentByFixtureScope,
  upsertTradingRecipe,
}

type ScoreboardMarketSide =
  | {
      team: string
      side: "home" | "away"
      price: number | null
      tokenId: string | null
    }
  | {
      team: string | null
      side: null
      price: null
      tokenId: null
      reason: string
    }

type ScoreboardMarketSides = {
  chaser: ScoreboardMarketSide
  defender: ScoreboardMarketSide
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
  const target = second.targetRuns
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
  const secondInningsAvailable = second.innings === 2 && second.status !== "pending" && second.status !== "unavailable"
  const chasingTeam = second.battingTeam
  const defendingTeam = first.battingTeam ?? second.bowlingTeam
  const marketSides = buildScoreboardMarketSides(input, chasingTeam, defendingTeam)
  const fixtureFinished = second.status === "frozen" || isFinishedStatus(input.fixture.status) || runsNeeded === 0
  const warnings = collectDataQualityWarnings({
    fixture: input.fixture,
    first,
    second,
    target,
    secondBalls,
    marketSides,
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
  const evaluation = evaluateScoreboardSideStrategy({
    fixtureId: input.fixture.id,
    inningsNumber: second.innings,
    legalBallsCompleted: secondBalls,
    firstInningsScore: first.scoreRuns,
    firstInningsBalls: first.balls,
    firstInningsWickets: first.scoreWickets,
    chasingScore: second.scoreRuns,
    wicketsLost: second.scoreWickets,
    targetRuns: second.targetRuns,
    chaser: toScoreboardSideStrategyMarketSide(marketSides.chaser),
    defender: toScoreboardSideStrategyMarketSide(marketSides.defender),
    mode: config.trading.scoreboardSideStrategy.mode,
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
        blockers: evaluation.blockers,
        reasons: evaluation.reasons,
      },
    }
  }

  const marketId = input.fixture.polymarketMarketSlug
  const conditionId = input.fixture.polymarketConditionId
  const homeTokenId = input.fixture.homeTokenId
  const awayTokenId = input.fixture.awayTokenId
  const selectedMarketSide = evaluation.signalSide === null ? null : marketSides[evaluation.signalSide]
  const tokenId = selectedMarketSide?.tokenId ?? null

  if (!marketId || !conditionId || !homeTokenId || !awayTokenId || !tokenId) {
    return {
      status: "ignored",
      reason: marketId && conditionId ? "SIDE_TOKEN_UNSUPPORTED" : "RECIPE_IDENTITY_INCOMPLETE",
      evaluation,
      details: {
        marketId,
        conditionId,
        homeTokenId,
        awayTokenId,
        selectedSignalSide: evaluation.signalSide,
        selectedTokenSide: evaluation.tokenSide,
        selectedTeam: evaluation.team,
        selectedMarketSide,
      },
    }
  }

  const resolvedMarketId: string = marketId
  const resolvedConditionId: string = conditionId
  const resolvedHomeTokenId: string = homeTokenId
  const resolvedAwayTokenId: string = awayTokenId
  const resolvedTokenId: string = tokenId

  const identity = {
    strategyKey: SCOREBOARD_SIDE_STRATEGY_KEY,
    recipeVersion: evaluation.strategyVersion,
    windowKey: SCOREBOARD_SIDE_WINDOW_KEY,
    fixtureId: input.fixture.id,
    marketId: resolvedMarketId,
    tokenId: resolvedTokenId,
    side: SCOREBOARD_SIDE_TRADE_SIDE,
  } as const

  const recipeKey = buildTradeRecipeKey(identity)
  const existingIntent = await repository.findTradeIntentByFixtureScope?.(identity).catch((error: unknown) => {
    return buildPersistenceFailureResult(evaluation, recipeKey, "findTradeIntentByFixtureScope", error)
  })

  if (isPersistenceFailureResult(existingIntent)) {
    return existingIntent
  }

  if (existingIntent) {
    return {
      status: "blocked",
      reason: "INTENT_ALREADY_EXISTS",
      recipeKey,
      intent: existingIntent,
      evaluation,
    }
  }

  const seededRecipes = repository.upsertTradingRecipe
    ? await seedScoreboardSideTokenRecipes({
        fixtureId: input.fixture.id,
        marketId: resolvedMarketId,
        conditionId: resolvedConditionId,
        homeTeam: input.fixture.homeTeam,
        awayTeam: input.fixture.awayTeam,
        homeTokenId: resolvedHomeTokenId,
        awayTokenId: resolvedAwayTokenId,
        size: SCOREBOARD_SIDE_NOMINAL_RECIPE_SIZE,
        expiryTime: buildScoreboardSideRecipeExpiryTime(input.fixture.startTime, now),
        mode: config.trading.scoreboardSideStrategy.mode,
      }, {
        upsertTradingRecipe: (recipeInput) => repository.upsertTradingRecipe?.(recipeInput) ?? Promise.resolve(null),
      }).catch((error: unknown) => {
        return buildPersistenceFailureResult(evaluation, recipeKey, "seedTradingRecipes", error)
      })
    : null

  if (isPersistenceFailureResult(seededRecipes)) {
    return seededRecipes
  }

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
      scoreboardSideStrategy: {
        mode: config.trading.scoreboardSideStrategy.mode,
        priceCap: config.trading.scoreboardSideStrategy.priceCap,
        allocationFraction: config.trading.scoreboardSideStrategy.allocationFraction,
      },
      selectedSide: selectedMarketSide,
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

const buildScoreboardMarketSides = (
  input: ObserverIntentSignalInput,
  chasingTeam: string | null,
  defendingTeam: string | null,
): ScoreboardMarketSides => ({
  chaser: findMarketSideForTeam(input, chasingTeam),
  defender: findMarketSideForTeam(input, defendingTeam),
})

const findMarketSideForTeam = (
  input: ObserverIntentSignalInput,
  team: string | null,
): ScoreboardMarketSide => {
  if (!team) {
    return {
      team,
      side: null,
      price: null,
      tokenId: null,
      reason: "Scoreboard team is missing.",
    }
  }

  const normalizedTeam = normalizeSelection(team)
  const homeMatches = normalizedTeam !== "" && normalizedTeam === normalizeSelection(input.fixture.homeTeam)
  const awayMatches = normalizedTeam !== "" && normalizedTeam === normalizeSelection(input.fixture.awayTeam)

  if (homeMatches && awayMatches) {
    return {
      team,
      side: null,
      price: null,
      tokenId: null,
      reason: "Scoreboard team maps to both market teams.",
    }
  }

  if (homeMatches) {
    return {
      team,
      side: "home",
      price: input.home.marketProbability,
      tokenId: input.fixture.homeTokenId,
    }
  }

  if (awayMatches) {
    return {
      team,
      side: "away",
      price: input.away.marketProbability,
      tokenId: input.fixture.awayTokenId,
    }
  }

  return {
    team,
    side: null,
    price: null,
    tokenId: null,
    reason: "Scoreboard team does not map to the fixture home or away team.",
  }
}

const toScoreboardSideStrategyMarketSide = (side: ScoreboardMarketSide) => ({
  team: side.team,
  price: side.price,
  tokenSide: side.side satisfies ScoreboardSideTokenSide | null,
})

const collectDataQualityWarnings = (input: {
  fixture: ObserverIntentFixtureSnapshot
  first: ObserverIntentInningsState
  second: ObserverIntentInningsState
  target: number | null
  secondBalls: number | null
  marketSides: ScoreboardMarketSides
  fixtureFinished: boolean
  observedAt: Date
  now: Date
}) => {
  const warnings: string[] = []
  const secondInningsPending =
    input.second.innings !== 2 || input.second.status === "pending" || input.second.status === "unavailable"

  for (const [side, marketSide] of Object.entries(input.marketSides) as [ScoreboardSideSignalSide, ScoreboardMarketSide][]) {
    if (marketSide.side === null) {
      warnings.push(`Could not map ${side} team to a supported market token: ${marketSide.reason}`)
    } else if (marketSide.price === null) {
      warnings.push(`Missing market probability for ${side} team.`)
    } else if (marketSide.tokenId === null) {
      warnings.push(`Missing Polymarket token id for ${side} team.`)
    }
  }

  if (secondInningsPending) {
    warnings.push("First innings is still in progress; wait until the chase starts.")
  }

  if (!secondInningsPending && input.secondBalls === null) {
    warnings.push(`Ball count is missing, so the ${SCOREBOARD_SIDE_WINDOW_KEY} entry window is unclear.`)
  }

  if (!secondInningsPending && input.target === null) {
    warnings.push("Target is missing; this may indicate a reduced-over, DLS, or incomplete scoreboard state.")
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

const normalizeSelection = (value: string | null) =>
  normalizeTeamName(value ?? "").trim().toLowerCase().replace(/\s+/g, "_")

const isFinishedStatus = (status: string) => {
  const normalized = status.toLowerCase()
  const padded = ` ${normalized} `
  return (
    normalized.includes("complete")
    || normalized.includes("final")
    || normalized.includes("finished")
    || normalized.includes("ended")
    || normalized.includes("abandoned")
    || normalized.includes("no result")
    || normalized.includes("no-result")
    || normalized.includes("super over")
    || normalized.includes("super-over")
    || normalized.includes("tied")
    || padded.includes(" tie ")
  )
}

const buildScoreboardSideRecipeExpiryTime = (fixtureStartTime: Date, now: Date) =>
  new Date(Math.max(
    fixtureStartTime.getTime() + SCOREBOARD_SIDE_RECIPE_EXPIRY_AFTER_START_MS,
    now.getTime() + SCOREBOARD_SIDE_MIN_RECIPE_EXPIRY_FROM_NOW_MS,
  ))

const isPersistenceFailureResult = (value: unknown): value is ObserverIntentPersistenceFailureResult =>
  typeof value === "object"
  && value !== null
  && "status" in value
  && value.status === "ignored"
  && "reason" in value
  && value.reason === "INTENT_PERSISTENCE_FAILED"

const buildPersistenceFailureResult = (
  evaluation: ReturnType<typeof evaluateScoreboardSideStrategy>,
  recipeKey: string,
  step: "findTradeIntentByFixtureScope" | "seedTradingRecipes" | "getTradingRecipe" | "createTradeIntent",
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
