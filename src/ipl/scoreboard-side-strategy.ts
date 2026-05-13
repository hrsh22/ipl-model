export const SCOREBOARD_SIDE_STRATEGY_KEY = "scoreboard-side-11-13"
export const SCOREBOARD_SIDE_WINDOW_KEY = "balls-66-78"
export const SCOREBOARD_SIDE_START_BALL = 66
export const SCOREBOARD_SIDE_END_BALL = 78

export const SCOREBOARD_SIDE_STRATEGY_MODES = {
  value90: {
    key: "value90",
    maxPrice: 0.9,
    allocationFraction: 0.2,
  },
  volume95: {
    key: "volume95",
    maxPrice: 0.95,
    allocationFraction: 0.1,
  },
} as const

export type ScoreboardSideStrategyMode = keyof typeof SCOREBOARD_SIDE_STRATEGY_MODES
export type ScoreboardSideSignalSide = "chaser" | "defender"
export type ScoreboardSideAction = "buy" | "wait" | "passed" | "blocked"
export type ScoreboardSideTokenSide = "home" | "away"
export type ScoreboardSideStrengthLabel = "weak" | "acceptable" | "strong" | "very-strong"

export type ScoreboardSideBlocker =
  | "MISSING_BALLS"
  | "BEFORE_WINDOW"
  | "AFTER_WINDOW"
  | "NON_SECOND_INNINGS"
  | "TARGET_REACHED"
  | "MISSING_TARGET"
  | "ALL_OUT_OR_NO_BALLS_LEFT"
  | "FIXTURE_FINISHED"
  | "REDUCED_OVER_RISK"
  | "TARGET_MISMATCH"
  | "DATA_INTEGRITY_WARNING"
  | "MISSING_TEAM_OR_PRICE"
  | "MISSING_SCOREBOARD_DATA"
  | "SETTLED_MARKET"

export type ScoreboardSideReason =
  | "CHASER_BUY_GATE_PASSED"
  | "DEFENDER_BUY_GATE_PASSED"
  | "ENTRY_GATES_NOT_MET"
  | "PRICE_ABOVE_CAP"
  | ScoreboardSideBlocker

export interface ScoreboardSideMarketSideInput {
  team: string | null
  price: number | null
  tokenSide?: ScoreboardSideTokenSide | null
}

export interface ScoreboardSideStrategyInput {
  fixtureId?: string
  inningsNumber: number | null
  legalBallsCompleted: number | null
  firstInningsScore: number | null
  firstInningsBalls?: number | null
  firstInningsWickets?: number | null
  chasingScore: number | null
  wicketsLost: number | null
  targetRuns?: number | null
  chaser: ScoreboardSideMarketSideInput
  defender: ScoreboardSideMarketSideInput
  mode?: ScoreboardSideStrategyMode
  fixtureFinished?: boolean
  reducedOverRisk?: boolean
  dataQualityWarnings?: readonly string[]
}

export interface ScoreboardSideStrategySettings {
  mode: ScoreboardSideStrategyMode
  strategyVersion: `v1-${ScoreboardSideStrategyMode}`
  priceCap: number
  allocationFraction: number
}

export interface ScoreboardSideStrategyMetrics {
  legalBallsCompleted: number
  oversElapsed: number
  ballsLeft: number
  target: number
  runsNeeded: number
  currentRunRate: number
  requiredRunRate: number
  wicketsLost: number
}

export interface ScoreboardSideGateDiagnostics {
  chaser: {
    rrrAtMostEleven: boolean
    wicketsAtMostThree: boolean
    currentRateAtLeastRequiredRate: boolean
    priceAtOrBelowCap: boolean
  }
  defender: {
    currentRateBelowRequiredRate: boolean
    rrrAtLeastTwelve: boolean
    wicketsAtLeastFour: boolean
    pressureConfirmed: boolean
    priceAtOrBelowCap: boolean
  }
}

export interface ScoreboardSideStrategyResult {
  strategyKey: typeof SCOREBOARD_SIDE_STRATEGY_KEY
  strategyVersion: `v1-${ScoreboardSideStrategyMode}`
  windowKey: typeof SCOREBOARD_SIDE_WINDOW_KEY
  action: ScoreboardSideAction
  signalSide: ScoreboardSideSignalSide | null
  tokenSide: ScoreboardSideTokenSide | null
  team: string | null
  price: number | null
  strength: number | null
  strengthLabel: ScoreboardSideStrengthLabel | null
  allocationFraction: number
  priceCap: number
  mode: ScoreboardSideStrategyMode
  metrics: ScoreboardSideStrategyMetrics | null
  gates: ScoreboardSideGateDiagnostics | null
  blockers: ScoreboardSideBlocker[]
  reasons: ScoreboardSideReason[]
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum)

const strengthLabelFor = (strength: number): ScoreboardSideStrengthLabel => {
  if (strength >= 85) {
    return "very-strong"
  }

  if (strength >= 70) {
    return "strong"
  }

  if (strength >= 60) {
    return "acceptable"
  }

  return "weak"
}

const hasDataIntegrityWarning = (warnings: readonly string[]) => warnings.some((warning) => {
  const normalized = warning.toLowerCase()
  return normalized.includes("tie")
    || normalized.includes("super-over")
    || normalized.includes("super over")
    || normalized.includes("reduced-data")
    || normalized.includes("data integrity")
    || normalized.includes("data-integrity")
})

const buildResult = (
  settings: ScoreboardSideStrategySettings,
  action: ScoreboardSideAction,
  input: Pick<ScoreboardSideStrategyResult, "signalSide" | "tokenSide" | "team" | "price" | "strength" | "strengthLabel" | "metrics" | "gates" | "blockers" | "reasons">,
): ScoreboardSideStrategyResult => ({
  strategyKey: SCOREBOARD_SIDE_STRATEGY_KEY,
  strategyVersion: settings.strategyVersion,
  windowKey: SCOREBOARD_SIDE_WINDOW_KEY,
  action,
  signalSide: input.signalSide,
  tokenSide: input.tokenSide,
  team: input.team,
  price: input.price,
  strength: input.strength,
  strengthLabel: input.strengthLabel,
  allocationFraction: settings.allocationFraction,
  priceCap: settings.priceCap,
  mode: settings.mode,
  metrics: input.metrics,
  gates: input.gates,
  blockers: input.blockers,
  reasons: input.reasons,
})

const calculateChaserStrength = (metrics: ScoreboardSideStrategyMetrics, price: number) => {
  const rateEdge = metrics.currentRunRate - metrics.requiredRunRate
  const wicketEdge = 3 - metrics.wicketsLost
  const rrrCushion = 11 - metrics.requiredRunRate
  const priceBonus = Math.max(0, 0.95 - price) * 20

  return clamp(50 + (7 * rateEdge) + (6 * wicketEdge) + (3 * rrrCushion) + priceBonus, 0, 100)
}

const calculateDefenderStrength = (metrics: ScoreboardSideStrategyMetrics, price: number) => {
  const rateEdge = metrics.requiredRunRate - metrics.currentRunRate
  const wicketEdge = metrics.wicketsLost - 4
  const rrrPressure = metrics.requiredRunRate - 12
  const priceBonus = Math.max(0, 0.95 - price) * 20

  return clamp(50 + (7 * rateEdge) + (6 * wicketEdge) + (3 * rrrPressure) + priceBonus, 0, 100)
}

export const getScoreboardSideStrategySettings = (
  mode: ScoreboardSideStrategyMode = "value90",
): ScoreboardSideStrategySettings => {
  const settings = SCOREBOARD_SIDE_STRATEGY_MODES[mode]

  return {
    mode,
    strategyVersion: `v1-${mode}`,
    priceCap: settings.maxPrice,
    allocationFraction: settings.allocationFraction,
  }
}

const addBlocker = (blockers: ScoreboardSideBlocker[], blocker: ScoreboardSideBlocker) => {
  if (!blockers.includes(blocker)) {
    blockers.push(blocker)
  }
}

const isSettledMarketPrice = (price: number) => price <= 0.01 || price >= 0.99

export const evaluateScoreboardSideStrategy = (input: ScoreboardSideStrategyInput): ScoreboardSideStrategyResult => {
  const settings = getScoreboardSideStrategySettings(input.mode)
  const blockers: ScoreboardSideBlocker[] = []
  const warnings = input.dataQualityWarnings ?? []

  if (input.fixtureFinished) {
    addBlocker(blockers, "FIXTURE_FINISHED")
  }

  if (input.inningsNumber !== 2) {
    addBlocker(blockers, "NON_SECOND_INNINGS")
  }

  if (
    input.reducedOverRisk
    || (input.firstInningsBalls !== null
      && input.firstInningsBalls !== undefined
      && input.firstInningsBalls < 120
      && (input.firstInningsWickets === null || input.firstInningsWickets === undefined || input.firstInningsWickets < 10))
  ) {
    addBlocker(blockers, "REDUCED_OVER_RISK")
  }

  if (hasDataIntegrityWarning(warnings)) {
    addBlocker(blockers, "DATA_INTEGRITY_WARNING")
  }

  if (input.legalBallsCompleted === null) {
    addBlocker(blockers, "MISSING_BALLS")
  } else {
    if (input.legalBallsCompleted < SCOREBOARD_SIDE_START_BALL) {
      addBlocker(blockers, "BEFORE_WINDOW")
    }

    if (input.legalBallsCompleted > SCOREBOARD_SIDE_END_BALL) {
      addBlocker(blockers, "AFTER_WINDOW")
    }
  }

  if (input.firstInningsScore === null || input.chasingScore === null || input.wicketsLost === null) {
    addBlocker(blockers, "MISSING_SCOREBOARD_DATA")
  }

  if (input.targetRuns === null || input.targetRuns === undefined) {
    addBlocker(blockers, "MISSING_TARGET")
  }

  if (
    input.chaser.team === null
    || input.defender.team === null
    || input.chaser.price === null
    || input.defender.price === null
  ) {
    addBlocker(blockers, "MISSING_TEAM_OR_PRICE")
  }

  if (
    (input.chaser.price !== null && isSettledMarketPrice(input.chaser.price))
    || (input.defender.price !== null && isSettledMarketPrice(input.defender.price))
  ) {
    addBlocker(blockers, "SETTLED_MARKET")
  }

  if (input.targetRuns !== null && input.targetRuns !== undefined && input.firstInningsScore !== null) {
    const expectedTarget = input.firstInningsScore + 1
    if (input.targetRuns !== expectedTarget) {
      addBlocker(blockers, "TARGET_MISMATCH")
    }
  }

  let metrics: ScoreboardSideStrategyMetrics | null = null

  if (
    input.legalBallsCompleted !== null
    && input.firstInningsScore !== null
    && input.chasingScore !== null
    && input.wicketsLost !== null
    && input.targetRuns !== null
    && input.targetRuns !== undefined
  ) {
    const legalBallsCompleted = input.legalBallsCompleted
    const chasingScore = input.chasingScore
    const wicketsLost = input.wicketsLost
    const target = input.targetRuns
    const ballsLeft = 120 - legalBallsCompleted
    const runsNeeded = target - chasingScore

    if (runsNeeded <= 0) {
      addBlocker(blockers, "TARGET_REACHED")
    }

    if (wicketsLost >= 10 || ballsLeft <= 0) {
      addBlocker(blockers, "ALL_OUT_OR_NO_BALLS_LEFT")
    }

    if (legalBallsCompleted > 0 && ballsLeft > 0) {
      const oversElapsed = legalBallsCompleted / 6
      metrics = {
        legalBallsCompleted,
        oversElapsed,
        ballsLeft,
        target,
        runsNeeded,
        currentRunRate: chasingScore / oversElapsed,
        requiredRunRate: (runsNeeded * 6) / ballsLeft,
        wicketsLost,
      }
    }
  }

  if (blockers.length > 0) {
    const action: ScoreboardSideAction = blockers.includes("BEFORE_WINDOW") ? "wait" : blockers.includes("AFTER_WINDOW") ? "passed" : "blocked"
    return buildResult(settings, action, {
      signalSide: null,
      tokenSide: null,
      team: null,
      price: null,
      strength: null,
      strengthLabel: null,
      metrics,
      gates: null,
      blockers,
      reasons: blockers,
    })
  }

  if (metrics === null || input.chaser.price === null || input.defender.price === null) {
    const blocker: ScoreboardSideBlocker = metrics === null ? "MISSING_SCOREBOARD_DATA" : "MISSING_TEAM_OR_PRICE"
    return buildResult(settings, "blocked", {
      signalSide: null,
      tokenSide: null,
      team: null,
      price: null,
      strength: null,
      strengthLabel: null,
      metrics,
      gates: null,
      blockers: [blocker],
      reasons: [blocker],
    })
  }

  const gates: ScoreboardSideGateDiagnostics = {
    chaser: {
      rrrAtMostEleven: metrics.requiredRunRate <= 11,
      wicketsAtMostThree: metrics.wicketsLost <= 3,
      currentRateAtLeastRequiredRate: metrics.currentRunRate >= metrics.requiredRunRate,
      priceAtOrBelowCap: input.chaser.price <= settings.priceCap,
    },
    defender: {
      currentRateBelowRequiredRate: metrics.currentRunRate < metrics.requiredRunRate,
      rrrAtLeastTwelve: metrics.requiredRunRate >= 12,
      wicketsAtLeastFour: metrics.wicketsLost >= 4,
      pressureConfirmed: metrics.wicketsLost >= 5 || metrics.requiredRunRate >= 13,
      priceAtOrBelowCap: input.defender.price <= settings.priceCap,
    },
  }

  const chaserGatePassed = Object.values(gates.chaser).every(Boolean)
  if (chaserGatePassed) {
    const strength = calculateChaserStrength(metrics, input.chaser.price)
    return buildResult(settings, "buy", {
      signalSide: "chaser",
      tokenSide: input.chaser.tokenSide ?? null,
      team: input.chaser.team,
      price: input.chaser.price,
      strength,
      strengthLabel: strengthLabelFor(strength),
      metrics,
      gates,
      blockers: [],
      reasons: ["CHASER_BUY_GATE_PASSED"],
    })
  }

  const defenderGatePassed = Object.values(gates.defender).every(Boolean)
  if (defenderGatePassed) {
    const strength = calculateDefenderStrength(metrics, input.defender.price)
    return buildResult(settings, "buy", {
      signalSide: "defender",
      tokenSide: input.defender.tokenSide ?? null,
      team: input.defender.team,
      price: input.defender.price,
      strength,
      strengthLabel: strengthLabelFor(strength),
      metrics,
      gates,
      blockers: [],
      reasons: ["DEFENDER_BUY_GATE_PASSED"],
    })
  }

  const priceAboveCap = (
    gates.chaser.rrrAtMostEleven
    && gates.chaser.wicketsAtMostThree
    && gates.chaser.currentRateAtLeastRequiredRate
    && !gates.chaser.priceAtOrBelowCap
  ) || (
    gates.defender.currentRateBelowRequiredRate
    && gates.defender.rrrAtLeastTwelve
    && gates.defender.wicketsAtLeastFour
    && gates.defender.pressureConfirmed
    && !gates.defender.priceAtOrBelowCap
  )

  return buildResult(settings, "wait", {
    signalSide: null,
    tokenSide: null,
    team: null,
    price: null,
    strength: null,
    strengthLabel: null,
    metrics,
    gates,
    blockers: [],
    reasons: [priceAboveCap ? "PRICE_ABOVE_CAP" : "ENTRY_GATES_NOT_MET"],
  })
}
