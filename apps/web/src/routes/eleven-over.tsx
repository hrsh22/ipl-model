import { createFileRoute } from '@tanstack/react-router'
import type { CSSProperties } from 'react'
import { useEffect, useMemo, useReducer, useState } from 'react'

export const Route = createFileRoute('/eleven-over')({
  component: ElevenOverStrategyPage,
})

type TeamSide = 'home' | 'away'
type FavouriteRole = 'chasing' | 'defending'
type StrategyAction = 'buy' | 'skip' | 'wait' | 'passed'
type CheckpointState = 'before' | 'entry' | 'after' | 'unknown'
type StateTone = 'default' | 'live' | 'pressure'

const ENTRY_WINDOW_START_BALLS = 66
const ENTRY_WINDOW_END_BALLS = 73
const SCOREBOARD_SIDE_WINDOW_END_BALLS = 78
const DEFAULT_SCOREBOARD_PRICE_CAP = 0.9
const T20_MAX_LEGAL_BALLS = 120
const SETTLED_MARKET_LOW_PRICE = 0.01
const SETTLED_MARKET_HIGH_PRICE = 0.99
const IPL_TIME_ZONE = 'Asia/Kolkata'
const localDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IPL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const TEAM_NAME_ALIASES: Record<string, string> = {
  csk: 'chennaisuperkings',
  chennai: 'chennaisuperkings',
  dc: 'delhicapitals',
  delhi: 'delhicapitals',
  gt: 'gujarattitans',
  gujarat: 'gujarattitans',
  kkr: 'kolkataknightriders',
  kolkata: 'kolkataknightriders',
  lsg: 'lucknowsupergiants',
  lucknow: 'lucknowsupergiants',
  mi: 'mumbaiindians',
  mumbai: 'mumbaiindians',
  pbks: 'punjabkings',
  pun: 'punjabkings',
  punjab: 'punjabkings',
  kingsxipunjab: 'punjabkings',
  rcb: 'royalchallengersbengaluru',
  bangalore: 'royalchallengersbengaluru',
  bengaluru: 'royalchallengersbengaluru',
  royalchallengersbangalore: 'royalchallengersbengaluru',
  rr: 'rajasthanroyals',
  rajasthan: 'rajasthanroyals',
  srh: 'sunrisershyderabad',
  sun: 'sunrisershyderabad',
  sunrisers: 'sunrisershyderabad',
  hyderabad: 'sunrisershyderabad',
}

type LiveModelSide = {
  team: string
  winProbability: number | null
  fairProbability: number | null
  marketProbability: number | null
  referenceProbability: number | null
  edgeVsMarketBps: number | null
}

type LiveModelSelection = {
  selection: string
  fairProbability: number | null
  marketProbability: number | null
  referenceProbability: number | null
  executableAsk: number | null
  executableBid: number | null
  edgeVsMarketBps: number | null
  edgeVsExecutableAskBps: number | null
  feeAdjustedEdgeBps: number | null
}

type ExpectedState = {
  innings: number | null
  battingTeam: string | null
  bowlingTeam: string | null
  scoreRuns: number | null
  scoreWickets: number | null
  overs: number | null
  balls?: number | null
  targetRuns?: number | null
  expectedRunsNow: number | null
  expectedWicketsNow: number | null
  runsDelta: number | null
  wicketsDelta: number | null
  projectedScore: number | null
  expectedRunRate: number | null
  battingTeamWinProbability: number | null
  chaseSuccessProbability: number | null
}

type InningsExpectedState = ExpectedState & {
  status: 'live' | 'frozen' | 'pending' | 'unavailable'
}

type InningsStates = {
  activeInnings: number | null
  first: InningsExpectedState
  second: InningsExpectedState
}

type LiveModelFixture = {
  fixture: {
    id: string
    homeTeam: string
    awayTeam: string
    venueName: string | null
    status: string
    isLive: boolean
    score: string | null
    period: string | null
    updatedAt: string
  }
  modelVersion: string
  confidence: string
  expectedState: ExpectedState
  inningsStates?: InningsStates | undefined
  home: LiveModelSide
  away: LiveModelSide
  selections?: LiveModelSelection[] | undefined
  updatedAt?: string | undefined
}

type ObserverFixture = {
  id: string
  opticOddsGameId: string | null
  sport: string
  league: string
  homeTeam: string
  awayTeam: string
  homeTeamId: string | null
  awayTeamId: string | null
  startTime: string
  status: string
  isLive: boolean
  venueName: string | null
  venueLocation: string | null
  polymarketEventSlug: string | null
  polymarketMarketSlug: string | null
  polymarketConditionId: string | null
  homeTokenId: string | null
  awayTokenId: string | null
  market?: {
    eventSlug?: string | null
    marketSlug?: string | null
    conditionId?: string | null
    homeTokenId?: string | null
    awayTokenId?: string | null
  } | null
  lastScore: string | null
  lastPeriod: string | null
  createdAt: string
  updatedAt: string
}

type PredictorFixture = {
  fixture_id: string
  team1: string
  team2: string
  match_date?: string | null
  venue?: string | null
  city?: string | null
  status?: string | null
  is_live?: boolean | string | null
  is_completed?: boolean | string | null
  team1_home_context?: string | null
}

type DefaultMarket = {
  url: string
  title: string
  slug: string
  status: 'live' | 'upcoming'
  matchDate: string
}

type TradingStatusData = {
  status: 'ok'
  generatedAt: string
  mode: 'live' | 'dry-run' | 'blocked'
  liveReady: boolean
  liveEligibility: {
    mode: 'live' | 'dry-run' | 'blocked'
    liveReady: boolean
    liveEnvGateEnabled: boolean
    runtimeEnvGateEnabled: boolean
    runtimeControlMode: string
    polymarketCredentialsPresent: {
      privateKey: boolean
      builderCode: boolean
      allPresent: boolean
    }
    blockerReasons: string[]
    blockerDetails?: { code: string; errors: string[] }[]
  }
  runtimeFlag: {
    flagKey: string
    enabled: boolean
    present: boolean
    reason: string | null
    updatedBy: string | null
    details: Record<string, unknown> | null
    createdAt: string | null
    updatedAt: string | null
  }
  recipeValidation: {
    status: 'valid' | 'invalid' | 'missing'
    recipeKey?: string | null
    errors?: string[]
    [key: string]: unknown
  }
  latestIntents: { id: number; intentKey: string; status: string; side: string; createdAt: string; [key: string]: unknown }[]
  latestEvents: { id: number; intentId: number; eventType: string; eventTime: string; [key: string]: unknown }[]
  activeStrategy: {
    strategyKey: string
    mode: string
    priceCap: number
    allocationFraction: number
  }
  exposureSummary: {
    ledgerEntryCount: number
    daySubmittedNotionalUsd: number
    dayPendingOrdersUsd: number
    totalOpenExposureUsd: number
    totalFilledExposureUsd: number
    byFixture: {
      fixtureId: string
      openExposureUsd: number
      filledExposureUsd: number
      pendingOrdersUsd: number
    }[]
  }
  reconciliationStatus: {
    checkpointKey: string
    present: boolean
    lastCursorPresent: boolean
    lastReconciledAt: string | null
    details: Record<string, unknown> | null
    updatedAt: string | null
  }
}

type ScoreboardActionStatus = 'buy' | 'wait' | 'no-trade' | 'unavailable'

type ScoreboardActionRole = 'chaser' | 'defender'

type ScoreboardAction = {
  status: ScoreboardActionStatus
  role: ScoreboardActionRole | null
  team: string | null
  headline: string
  subhead: string
  price: number | null
  priceCap: number
  strength: number | null
  strengthLabel: string
  stakeGuidance: string
  reasons: string[]
  blockers: string[]
  stats: {
    legalBalls: number | null
    overs: string
    crr: number | null
    rrr: number | null
    runsNeeded: number | null
    ballsLeft: number | null
    wicketsLost: number | null
    target: number | null
  }
}

type StrategyDashboardData = {
  ready: Record<string, unknown>
  fixtures: LiveModelFixture[]
  observerFixtures: ObserverFixture[]
  scheduleFixtures: PredictorFixture[]
  defaultMarket: DefaultMarket | null
  tradingStatus: TradingStatusData | null
}

type StrategyState = {
  data: StrategyDashboardData | null
  error: string | null
  status: 'loading' | 'success' | 'error'
  updatedAt: Date | null
  refreshing: boolean
}

type StrategyStateAction =
  | { type: 'refresh-start'; initial: boolean }
  | { type: 'success'; data: StrategyDashboardData; updatedAt: Date }
  | { type: 'error'; message: string }

const initialStrategyState: StrategyState = {
  data: null,
  error: null,
  status: 'loading',
  updatedAt: null,
  refreshing: false,
}

type FavouriteResult =
  | {
      kind: 'clear'
      side: TeamSide
      team: string
      price: number
      otherPrice: number
      lead: number
    }
  | {
      kind: 'unclear'
      reason: string
    }

type StrategyMetrics = {
  checkpoint: CheckpointState
  secondBalls: number | null
  ballsToCheckpoint: number | null
  ballsLeft: number | null
  target: number | null
  runsNeeded: number | null
  currentRate: number | null
  requiredRate: number | null
  wicketsLost: number | null
  chasingTeam: string | null
  defendingTeam: string | null
  chaseComfortScore: number
  defensivePressureScore: number
}

type StrategyCondition = {
  label: string
  passed: boolean
  value: string
  note: string
}

type StrategyEvaluation = {
  fixture: LiveModelFixture
  inningsStates: InningsStates
  action: StrategyAction
  actionLabel: string
  headline: string
  statusCopy: string
  favourite: FavouriteResult
  favouriteRole: FavouriteRole | null
  metrics: StrategyMetrics
  strengthScore: number
  strengthLabel: string
  suggestedStake: string
  conditions: StrategyCondition[]
  reasons: string[]
  isRuleQualified: boolean
  hasChaseState: boolean
  scoreBreakdown: string[]
  dataQualityWarnings: string[]
  scoreboardAction: ScoreboardAction
}

function ElevenOverStrategyPage() {
  const state = useStrategyDashboard()
  const fixtures = state.data?.fixtures ?? []
  const ready = state.data?.ready ?? null
  const tradingStatus = state.data?.tradingStatus ?? null
  const scoreboardPriceCap = tradingStatus?.activeStrategy.priceCap ?? DEFAULT_SCOREBOARD_PRICE_CAP
  const evaluations = useMemo(
    () => fixtures.map((fixture) => buildStrategyEvaluation(fixture, scoreboardPriceCap)).sort(compareEvaluations),
    [fixtures, scoreboardPriceCap],
  )
  const nextFixture = useMemo(
    () => findNextScheduleFixture(state.data?.scheduleFixtures ?? [], state.data?.defaultMarket ?? null),
    [state.data?.scheduleFixtures, state.data?.defaultMarket],
  )
  const liveFixture = useMemo(
    () => fixtures.find((fixture) => fixture.fixture.isLive) ?? null,
    [fixtures],
  )
  const mappedObserverFixture = useMemo(
    () => nextFixture ? findMappedObserverFixture(nextFixture, state.data?.observerFixtures ?? [], state.data?.defaultMarket ?? null) : null,
    [nextFixture, state.data?.observerFixtures, state.data?.defaultMarket],
  )
  const buyCount = evaluations.filter((evaluation) => evaluation.action === 'buy').length
  const watchCount = evaluations.filter((evaluation) => evaluation.action === 'wait' && evaluation.strengthScore >= 55).length
  const checkpointSkips = evaluations.filter((evaluation) => evaluation.action === 'skip').length
  const strengthEvaluations = evaluations.filter((evaluation) => evaluation.hasChaseState)
  const averageStrength = strengthEvaluations.length === 0
    ? null
    : Math.round(strengthEvaluations.reduce((sum, evaluation) => sum + evaluation.strengthScore, 0) / strengthEvaluations.length)
  const aggregateEdge = useMemo(() => {
    const edges = fixtures.flatMap((fixture) => [fixture.home.edgeVsMarketBps, fixture.away.edgeVsMarketBps])
    const valid = edges.filter((edge): edge is number => edge !== null)
    return valid.length === 0 ? null : valid.reduce((sum, edge) => sum + Math.abs(edge), 0) / valid.length
  }, [fixtures])
  const observerStatusLabel = ready?.ready === true
    ? ready.degraded === true
      ? 'Observer usable · official fixtures'
      : 'Observer ready'
    : state.status === 'loading'
      ? 'Loading observer'
      : 'Observer warming'

  return (
    <main className="strategy-shell">
      <section className="strategy-hero">
        <div>
          <p className="eyebrow">State-aligned 11-over favourite strategy</p>
          <h1>Buy only when the chase state agrees.</h1>
          <p className="strategy-copy">
            A checkpoint desk for the one-shot entry window after 11 completed overs and before 73 completed balls of the chase. It grades the live favourite, chase comfort, defensive pressure, and data quality before showing a buy, wait, skip, or missed-window call.
          </p>
        </div>
        <div className="strategy-status-card">
          <span className="strategy-status-dot" />
          <span>{observerStatusLabel}</span>
          <strong>{state.updatedAt ? `Last ${state.updatedAt.toLocaleTimeString()}` : 'waiting'}</strong>
          <small>{state.refreshing ? 'refreshing' : state.status}</small>
        </div>
      </section>

      {state.error ? <div className="strategy-error-strip">{state.error}</div> : null}

      <section className="strategy-metric-grid">
        <StrategyMetric label="Qualifying now" value={buyCount.toString()} tone={buyCount > 0 ? 'buy' : 'default'} />
        <StrategyMetric label="Pre-11 watch" value={watchCount.toString()} />
        <StrategyMetric label="Checkpoint skips" value={checkpointSkips.toString()} tone={checkpointSkips > 0 ? 'skip' : 'default'} />
        <StrategyMetric label={liveFixture ? 'Live match' : 'Next match'} value={liveFixture ? 'live now' : nextFixture?.match_date ? formatTimeUntilStart(nextFixture.match_date) : '—'} tone={liveFixture ? 'buy' : 'default'} />
        <StrategyMetric label="Avg absolute edge" value={aggregateEdge === null ? '—' : `${Math.round(aggregateEdge)} bps`} />
      </section>

      <NextMatchPanel fixture={nextFixture} liveFixture={liveFixture} observerFixture={mappedObserverFixture} defaultMarket={state.data?.defaultMarket ?? null} liveCount={evaluations.length} averageStrength={averageStrength} />

      <TradingSafetyPanel tradingStatus={tradingStatus} />

      <section className="strategy-layout">
        <div className="strategy-card-stack">
          <SectionHeading label="Live strategy board" value={`${evaluations.length} fixtures`} />
          {evaluations.length === 0 ? <StrategyEmptyState /> : evaluations.map((evaluation) => <StrategyCard evaluation={evaluation} key={evaluation.fixture.fixture.id} />)}
        </div>

        <aside className="strategy-rule-rail">
          <SectionHeading label="Rule card" value="one entry" />
          <div className="strategy-rule-card">
            <strong>Entry timing</strong>
            <p>Enter only after 11 completed overs and before 73 completed balls of the second innings. In completed-ball terms, the window is 66-72 balls; after that it is a missed window.</p>
          </div>
          <div className="strategy-rule-card">
            <strong>Chasing favourite</strong>
            <p>Buy only when RRR ≤ 10, wickets lost ≤ 3, and CRR ≥ RRR. Clean signals get a higher strength score when RRR is under 9 and wickets are 0-2.</p>
          </div>
          <div className="strategy-rule-card">
            <strong>Defending favourite</strong>
            <p>Buy only when the chase is damaged: either 4+ wickets down, or RRR ≥ 12 while the chaser is below the rate.</p>
          </div>
          <div className="strategy-rule-card warning">
            <strong>Main avoid</strong>
            <p>Do not buy a defending favourite against a healthy chase. That means wickets in hand with the chaser scoring at or above the required rate.</p>
          </div>
          <div className="strategy-rule-card stake">
            <strong>Stake guide</strong>
            <p>Base qualifying signal: 15-20% bankroll. Very clean signal: up to 30%. Unclear scoreboard or missing odds: 0% and skip.</p>
          </div>
        </aside>
      </section>
    </main>
  )
}

function useStrategyDashboard(): StrategyState {
  const [state, dispatch] = useReducer(strategyStateReducer, initialStrategyState)

  useEffect(() => {
    let cancelled = false
    let stopped = false
    let interval: number | null = null

    const load = async (initial: boolean) => {
      if (stopped) return
      dispatch({ type: 'refresh-start', initial })
      try {
        const data = await loadStrategyDashboard()
        if (cancelled) return
        dispatch({ type: 'success', data, updatedAt: new Date() })
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : '11-over strategy dashboard request failed.'
        if (isFatalObserverConfigurationError(message)) {
          stopped = true
          if (interval !== null) window.clearInterval(interval)
        }
        dispatch({ type: 'error', message })
      }
    }

    void load(true)
    interval = window.setInterval(() => {
      void load(false)
    }, 5_000)

    return () => {
      cancelled = true
      if (interval !== null) window.clearInterval(interval)
    }
  }, [])

  return state
}

function strategyStateReducer(state: StrategyState, action: StrategyStateAction): StrategyState {
  switch (action.type) {
    case 'refresh-start':
      return { ...state, refreshing: !action.initial }
    case 'success':
      return { data: action.data, error: null, status: 'success', updatedAt: action.updatedAt, refreshing: false }
    case 'error':
      return { ...state, error: action.message, status: state.data ? 'success' : 'error', refreshing: false }
  }
}

export async function loadStrategyDashboard(): Promise<StrategyDashboardData> {
  const responses = await Promise.all([
    fetch('/api/observer/ready'),
    fetch('/api/observer/live-model'),
    fetch('/api/observer/fixtures'),
    fetch('/api/predictor/fixtures'),
  ])

  const failed = responses.find((response) => !response.ok)
  if (failed) {
    throw new Error(await responseMessage(failed))
  }

  const [ready, fixtures, observerFixtures, scheduleFixtures, defaultMarket, tradingStatus] = await Promise.all([
    responses[0].json() as Promise<Record<string, unknown>>,
    responses[1].json() as Promise<LiveModelFixture[]>,
    responses[2].json() as Promise<ObserverFixture[]>,
    responses[3].json() as Promise<PredictorFixture[]>,
    fetchOptionalJson<DefaultMarket>('/api/scanner/default-market'),
    fetchOptionalJson<TradingStatusData>('/api/observer/trading/status'),
  ])

  return { ready, fixtures, observerFixtures, scheduleFixtures, defaultMarket, tradingStatus }
}

async function fetchOptionalJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url)
  if (!response.ok) {
    return null
  }
  return await response.json() as T
}

function findNextScheduleFixture(fixtures: PredictorFixture[], defaultMarket: DefaultMarket | null): PredictorFixture | null {
  const now = Date.now()
  const candidates: Array<{ fixture: PredictorFixture; startMs: number }> = []
  for (const fixture of fixtures) {
    if (isCompletedPredictorFixture(fixture)) {
      continue
    }
    const startMs = new Date(String(fixture.match_date ?? '')).getTime()
    if (Number.isFinite(startMs) && (isLivePredictorFixture(fixture) || startMs >= now - 15 * 60 * 1000)) {
      candidates.push({ fixture, startMs })
    }
  }
  candidates.sort((left, right) => {
    const liveDiff = Number(isLivePredictorFixture(right.fixture)) - Number(isLivePredictorFixture(left.fixture))
    if (liveDiff !== 0) return liveDiff
    return left.startMs - right.startMs
  })

  if (defaultMarket !== null) {
    const marketDateCandidate = candidates.find((candidate) => localDateKey(new Date(candidate.startMs)) === defaultMarket.matchDate)
    if (marketDateCandidate !== undefined) {
      return marketDateCandidate.fixture
    }
  }

  return candidates[0]?.fixture ?? null
}

function findMappedObserverFixture(fixture: PredictorFixture, observerFixtures: ObserverFixture[], defaultMarket: DefaultMarket | null): ObserverFixture | null {
  const openFixtures = observerFixtures.filter((observerFixture) => !isFinishedStatus(observerFixture.status))
  const fixtureDate = fixture.match_date ? localDateKey(new Date(fixture.match_date)) : null
  const slugMatch = defaultMarket === null
    ? undefined
    : openFixtures.find((observerFixture) => {
        const observerStartMs = new Date(observerFixture.startTime).getTime()
        const sameFixtureDate = fixtureDate !== null && Number.isFinite(observerStartMs) && localDateKey(new Date(observerStartMs)) === fixtureDate
        return sameFixtureDate && (getObserverMarketSlug(observerFixture) === defaultMarket.slug || getObserverEventSlug(observerFixture) === defaultMarket.slug)
      })
  if (slugMatch !== undefined) {
    return slugMatch
  }

  const matches: Array<{ observerFixture: ObserverFixture; startMs: number }> = []
  for (const observerFixture of openFixtures) {
    if (!teamsMatchFixture(fixture, observerFixture)) {
      continue
    }
    const startMs = new Date(observerFixture.startTime).getTime()
    if (Number.isFinite(startMs)) {
      matches.push({ observerFixture, startMs })
    }
  }

  if (fixtureDate !== null) {
    const sameDate = matches.find((candidate) => localDateKey(new Date(candidate.startMs)) === fixtureDate)
    if (sameDate !== undefined) {
      return sameDate.observerFixture
    }
  }

  if (matches[0]?.observerFixture !== undefined) {
    return matches[0].observerFixture
  }

  const sameDateMatches: ObserverFixture[] = []
  if (fixtureDate !== null) {
    for (const observerFixture of openFixtures) {
      const startMs = new Date(observerFixture.startTime).getTime()
      if (Number.isFinite(startMs) && localDateKey(new Date(startMs)) === fixtureDate) {
        sameDateMatches.push(observerFixture)
      }
    }
  }
  return sameDateMatches.length === 1 ? sameDateMatches[0] ?? null : null
}

function teamsMatchFixture(fixture: PredictorFixture, observerFixture: ObserverFixture): boolean {
  const team1MatchesHome = sameTeam(fixture.team1, observerFixture.homeTeam) && sameTeam(fixture.team2, observerFixture.awayTeam)
  const team1MatchesAway = sameTeam(fixture.team1, observerFixture.awayTeam) && sameTeam(fixture.team2, observerFixture.homeTeam)
  return team1MatchesHome || team1MatchesAway
}

function buildStrategyEvaluation(fixture: LiveModelFixture, priceCap = DEFAULT_SCOREBOARD_PRICE_CAP): StrategyEvaluation {
  const inningsStates = fixture.inningsStates ?? toFallbackInningsStates(fixture.expectedState)
  const first = inningsStates.first
  const second = inningsStates.second
  const secondBalls = getBalls(second)
  const ballsToCheckpoint = secondBalls === null ? null : Math.max(ENTRY_WINDOW_START_BALLS - secondBalls, 0)
  const ballsLeft = secondBalls === null ? null : Math.max(120 - secondBalls, 0)
  const checkpoint = checkpointState(secondBalls)
  const target = second.targetRuns ?? (first.scoreRuns === null ? null : first.scoreRuns + 1)
  const runsNeeded = target === null || second.scoreRuns === null ? null : Math.max(target - second.scoreRuns, 0)
  const oversFaced = secondBalls === null || secondBalls === 0 ? null : secondBalls / 6
  const oversLeft = ballsLeft === null ? null : ballsLeft / 6
  const currentRate = second.scoreRuns === null || oversFaced === null ? null : second.scoreRuns / oversFaced
  const requiredRate = runsNeeded === null || oversLeft === null
    ? null
    : oversLeft === 0
      ? runsNeeded === 0 ? 0 : null
      : runsNeeded / oversLeft
  const chasingTeam = second.battingTeam
  const defendingTeam = first.battingTeam ?? second.bowlingTeam
  const wicketsLost = second.scoreWickets
  const favourite = getFavourite(fixture)
  const secondInningsAvailable = second.innings === 2 && second.status !== 'pending' && second.status !== 'unavailable'
  const favouriteRole = favourite.kind === 'clear' && secondInningsAvailable ? getFavouriteRole(favourite.team, chasingTeam, defendingTeam, second.bowlingTeam) : null
  const metrics: StrategyMetrics = {
    checkpoint,
    secondBalls,
    ballsToCheckpoint,
    ballsLeft,
    target,
    runsNeeded,
    currentRate,
    requiredRate,
    wicketsLost,
    chasingTeam,
    defendingTeam,
    chaseComfortScore: scoreChaseComfort(requiredRate, currentRate, wicketsLost),
    defensivePressureScore: scoreDefensivePressure(requiredRate, currentRate, wicketsLost),
  }
  const fixtureFinished = second.status === 'frozen' || isFinishedStatus(fixture.fixture.status) || runsNeeded === 0
  const dataQualityWarnings = collectDataQualityWarnings(fixture, first, second, target, secondBalls, favourite, favouriteRole, fixtureFinished)
  const isFinishedEarly = secondBalls !== null && secondBalls < ENTRY_WINDOW_START_BALLS && fixtureFinished
  const firstBalls = getBalls(first)
  const firstInningsComplete = first.status === 'frozen' || inningsStates.activeInnings === 2 || second.status === 'live' || second.status === 'frozen'
  const targetMismatch = second.targetRuns !== undefined && second.targetRuns !== null && first.scoreRuns !== null && second.targetRuns !== first.scoreRuns + 1
  const reducedOverRisk = firstInningsComplete && (targetMismatch || (firstBalls !== null && firstBalls < 120 && (first.scoreWickets === null || first.scoreWickets < 10)))
  const conditions = secondInningsAvailable
    ? buildConditions(favouriteRole, requiredRate, currentRate, wicketsLost)
    : [
        condition('Second innings', false, 'pending', 'Wait until the chase starts'),
        condition('Entry window', false, 'not open', 'Needs 66-72 completed balls of the chase'),
      ]
  const isRuleQualified = dataQualityWarnings.length === 0 && !reducedOverRisk && favouriteRole !== null && ruleQualifies(favouriteRole, requiredRate, currentRate, wicketsLost)
  const strengthScore = calculateStrengthScore({
    favourite,
    favouriteRole,
    requiredRate,
    currentRate,
    wicketsLost,
    chaseSuccessProbability: second.chaseSuccessProbability,
    isRuleQualified,
    hasDataWarnings: dataQualityWarnings.length > 0 || reducedOverRisk,
    checkpoint,
  })
  const action = chooseAction(checkpoint, isRuleQualified, isFinishedEarly, dataQualityWarnings.length > 0 || reducedOverRisk)
  const warnings = reducedOverRisk
    ? [...dataQualityWarnings, 'Reduced-over or DLS-style first innings risk; skip unless balls-left math is recalculated.']
    : dataQualityWarnings

  return {
    fixture,
    inningsStates,
    action,
    actionLabel: actionLabel(action),
    headline: buildHeadline(action, favourite, favouriteRole, strengthScore),
    statusCopy: buildStatusCopy(action, checkpoint, metrics, isRuleQualified, warnings),
    favourite,
    favouriteRole,
    metrics,
    strengthScore,
    strengthLabel: strengthLabel(strengthScore, isRuleQualified),
    suggestedStake: suggestedStake(action, strengthScore),
    conditions,
    reasons: buildReasons(action, favouriteRole, isRuleQualified, conditions, warnings, checkpoint),
    isRuleQualified,
    hasChaseState: secondInningsAvailable,
    scoreBreakdown: buildStrengthScoreBreakdown({
      favourite,
      favouriteRole,
      requiredRate,
      currentRate,
      wicketsLost,
      chaseSuccessProbability: second.chaseSuccessProbability,
      isRuleQualified,
      hasDataWarnings: warnings.length > 0,
      checkpoint,
      score: strengthScore,
      hasChaseState: secondInningsAvailable,
    }),
    dataQualityWarnings: warnings,
    scoreboardAction: buildScoreboardAction(fixture, inningsStates, priceCap),
  }
}

function getFavourite(fixture: LiveModelFixture): FavouriteResult {
  const homePrice = getSideMarketPrice(fixture, 'home')
  const awayPrice = getSideMarketPrice(fixture, 'away')
  if (homePrice === null || awayPrice === null) {
    return { kind: 'unclear', reason: 'Missing YES price for one or both teams.' }
  }
  if (Math.abs(homePrice - awayPrice) < 0.005) {
    return { kind: 'unclear', reason: 'YES prices are tied or too close to call.' }
  }
  return homePrice > awayPrice
    ? { kind: 'clear', side: 'home', team: fixture.fixture.homeTeam, price: homePrice, otherPrice: awayPrice, lead: homePrice - awayPrice }
    : { kind: 'clear', side: 'away', team: fixture.fixture.awayTeam, price: awayPrice, otherPrice: homePrice, lead: awayPrice - homePrice }
}

function getSideMarketPrice(fixture: LiveModelFixture, side: TeamSide): number | null {
  const sideView = side === 'home' ? fixture.home : fixture.away
  if (sideView.marketProbability !== null) return sideView.marketProbability
  const team = side === 'home' ? fixture.fixture.homeTeam : fixture.fixture.awayTeam
  const selection = fixture.selections?.find((candidate) => sameTeam(candidate.selection, team))
  return selection?.marketProbability ?? null
}

function getFavouriteRole(favouriteTeam: string, chasingTeam: string | null, defendingTeam: string | null, bowlingTeam: string | null): FavouriteRole | null {
  if (chasingTeam !== null && sameTeam(favouriteTeam, chasingTeam)) return 'chasing'
  if (defendingTeam !== null && sameTeam(favouriteTeam, defendingTeam)) return 'defending'
  if (bowlingTeam !== null && sameTeam(favouriteTeam, bowlingTeam)) return 'defending'
  return null
}

function collectDataQualityWarnings(
  fixture: LiveModelFixture,
  first: InningsExpectedState,
  second: InningsExpectedState,
  target: number | null,
  secondBalls: number | null,
  favourite: FavouriteResult,
  favouriteRole: FavouriteRole | null,
  fixtureFinished: boolean,
) {
  const warnings: string[] = []
  const secondInningsPending = second.innings !== 2 || second.status === 'pending' || second.status === 'unavailable'
  if (favourite.kind === 'unclear') warnings.push(favourite.reason)
  if (favourite.kind === 'clear' && favouriteRole === null && second.status !== 'pending' && second.status !== 'unavailable') warnings.push('Could not map the favourite to chasing or defending side.')
  if (secondInningsPending) warnings.push('First innings is still in progress; wait until the chase starts.')
  if (!secondInningsPending && secondBalls === null) warnings.push('Ball count is missing, so the 66-72 ball entry window is unclear.')
  if (!secondInningsPending && target === null) warnings.push('Target is missing, so required rate cannot be trusted.')
  if (!secondInningsPending && second.scoreRuns === null) warnings.push('Chasing score is missing.')
  if (!secondInningsPending && second.scoreWickets === null) warnings.push('Chasing wickets are missing.')
  if (first.scoreRuns === null) warnings.push('First-innings score is missing.')
  if (fixtureFinished) warnings.push('Match is already finished; the entry window is no longer live.')
  if (!fixture.fixture.isLive) warnings.push('Fixture is not currently live.')
  return warnings
}

function buildConditions(role: FavouriteRole | null, requiredRate: number | null, currentRate: number | null, wicketsLost: number | null): StrategyCondition[] {
  if (role === 'chasing') {
    return [
      condition('Required rate', requiredRate !== null && requiredRate <= 10, formatRate(requiredRate), 'Needs RRR ≤ 10'),
      condition('Wickets lost', wicketsLost !== null && wicketsLost <= 3, formatWickets(wicketsLost), 'Needs ≤ 3 down'),
      condition('Run-rate alignment', currentRate !== null && requiredRate !== null && currentRate >= requiredRate, `${formatRate(currentRate)} vs ${formatRate(requiredRate)}`, 'CRR must be ≥ RRR'),
    ]
  }
  if (role === 'defending') {
    return [
      condition('Wicket damage', wicketsLost !== null && wicketsLost >= 4, formatWickets(wicketsLost), 'Buy if chaser is 4+ down'),
      condition('Rate pressure', requiredRate !== null && currentRate !== null && requiredRate >= 12 && currentRate < requiredRate, `${formatRate(requiredRate)} RRR · ${formatRate(currentRate)} CRR`, 'Or RRR ≥ 12 and CRR below RRR'),
    ]
  }
  return [
    condition('Live favourite', false, 'unclear', 'Need a clear higher YES price'),
    condition('Role mapping', false, 'unclear', 'Need favourite to map to chasing or defending team'),
  ]
}

function condition(label: string, passed: boolean, value: string, note: string): StrategyCondition {
  return { label, passed, value, note }
}

function ruleQualifies(role: FavouriteRole, requiredRate: number | null, currentRate: number | null, wicketsLost: number | null): boolean {
  if (requiredRate === null || currentRate === null || wicketsLost === null) return false
  if (role === 'chasing') {
    return requiredRate <= 10 && wicketsLost <= 3 && currentRate >= requiredRate
  }
  return wicketsLost >= 4 || (requiredRate >= 12 && currentRate < requiredRate)
}

function chooseAction(checkpoint: CheckpointState, isRuleQualified: boolean, isFinishedEarly: boolean, hasWarnings: boolean): StrategyAction {
  if (isFinishedEarly) return 'skip'
  if (checkpoint === 'before' || checkpoint === 'unknown') return 'wait'
  if (checkpoint === 'after') return 'passed'
  if (hasWarnings) return 'skip'
  return isRuleQualified ? 'buy' : 'skip'
}

function calculateStrengthScore(input: {
  favourite: FavouriteResult
  favouriteRole: FavouriteRole | null
  requiredRate: number | null
  currentRate: number | null
  wicketsLost: number | null
  chaseSuccessProbability: number | null
  isRuleQualified: boolean
  hasDataWarnings: boolean
  checkpoint: CheckpointState
}): number {
  if (input.favourite.kind === 'unclear' || input.favouriteRole === null) return 0
  if (input.requiredRate === null || input.currentRate === null || input.wicketsLost === null) return 12

  const marketBonus = clamp(input.favourite.lead * 65, 0, 14)
  const modelBonus = input.chaseSuccessProbability === null
    ? 0
    : input.favouriteRole === 'chasing'
      ? clamp((input.chaseSuccessProbability - 0.5) * 42, -12, 12)
      : clamp((0.5 - input.chaseSuccessProbability) * 42, -12, 12)
  const raw = input.favouriteRole === 'chasing'
    ? 48
      + clamp((10 - input.requiredRate) * 7, -28, 26)
      + clamp((3 - input.wicketsLost) * 8, -28, 22)
      + clamp((input.currentRate - input.requiredRate) * 6, -30, 26)
      + marketBonus
      + modelBonus
    : 44
      + clamp((input.wicketsLost - 3) * 9, -26, 30)
      + clamp((input.requiredRate - 12) * 6, -24, 22)
      + clamp((input.requiredRate - input.currentRate) * 5, -30, 26)
      + marketBonus
      + modelBonus
  let score = clamp(Math.round(raw), 0, 100)
  if (!input.isRuleQualified && input.checkpoint === 'entry') score = Math.min(score, 64)
  if (input.hasDataWarnings) score = Math.min(score, 34)
  return score
}

function buildStrengthScoreBreakdown(input: {
  favourite: FavouriteResult
  favouriteRole: FavouriteRole | null
  requiredRate: number | null
  currentRate: number | null
  wicketsLost: number | null
  chaseSuccessProbability: number | null
  isRuleQualified: boolean
  hasDataWarnings: boolean
  checkpoint: CheckpointState
  score: number
  hasChaseState: boolean
}): string[] {
  if (!input.hasChaseState) {
    return ['Score waits for the second innings because target, required rate, current rate, wickets, and favourite role are not known yet.']
  }
  if (input.favourite.kind === 'unclear') {
    return ['Score is 0 because there is no clear live favourite.']
  }
  if (input.favouriteRole === null) {
    return ['Score is 0 because the favourite cannot be mapped to chasing or defending.']
  }
  if (input.requiredRate === null || input.currentRate === null || input.wicketsLost === null) {
    return ['Score is 12 because chase metrics are still incomplete.']
  }

  const marketBonus = clamp(input.favourite.lead * 65, 0, 14)
  const modelBonus = input.chaseSuccessProbability === null
    ? 0
    : input.favouriteRole === 'chasing'
      ? clamp((input.chaseSuccessProbability - 0.5) * 42, -12, 12)
      : clamp((0.5 - input.chaseSuccessProbability) * 42, -12, 12)
  const roleBase = input.favouriteRole === 'chasing' ? 48 : 44
  const roleParts = input.favouriteRole === 'chasing'
    ? [
        `RRR comfort ${formatScoreDelta(clamp((10 - input.requiredRate) * 7, -28, 26))} because RRR is ${formatRate(input.requiredRate)}.`,
        `Wicket comfort ${formatScoreDelta(clamp((3 - input.wicketsLost) * 8, -28, 22))} because the chaser is ${formatWickets(input.wicketsLost)}.`,
        `Rate alignment ${formatScoreDelta(clamp((input.currentRate - input.requiredRate) * 6, -30, 26))} because CRR is ${formatRate(input.currentRate)}.`,
      ]
    : [
        `Wicket damage ${formatScoreDelta(clamp((input.wicketsLost - 3) * 9, -26, 30))} because the chaser is ${formatWickets(input.wicketsLost)}.`,
        `Required-rate pressure ${formatScoreDelta(clamp((input.requiredRate - 12) * 6, -24, 22))} because RRR is ${formatRate(input.requiredRate)}.`,
        `Rate pressure ${formatScoreDelta(clamp((input.requiredRate - input.currentRate) * 5, -30, 26))} because CRR is ${formatRate(input.currentRate)}.`,
      ]
  const capCopy = !input.isRuleQualified && input.checkpoint === 'entry'
    ? ' Non-qualifying entry-window states are capped at 64.'
    : input.hasDataWarnings
      ? ' Data warnings cap the score at 34.'
      : ''

  return [
    `Base ${roleBase} for a mapped ${input.favouriteRole} favourite.`,
    ...roleParts,
    `Market lead bonus ${formatScoreDelta(marketBonus)} from a ${(input.favourite.lead * 100).toFixed(1)} percentage-point YES lead.`,
    `Model bonus ${formatScoreDelta(modelBonus)}${input.chaseSuccessProbability === null ? ' because no chase-success probability is available.' : ` from chase-success probability ${formatProbability(input.chaseSuccessProbability)}.`}`,
    `Final strategy score: ${input.score}/100.${capCopy}`,
  ]
}

function scoreChaseComfort(requiredRate: number | null, currentRate: number | null, wicketsLost: number | null): number {
  if (requiredRate === null || currentRate === null || wicketsLost === null) return 0
  return clamp(Math.round(48 + (10 - requiredRate) * 7 + (3 - wicketsLost) * 8 + (currentRate - requiredRate) * 6), 0, 100)
}

function scoreDefensivePressure(requiredRate: number | null, currentRate: number | null, wicketsLost: number | null): number {
  if (requiredRate === null || currentRate === null || wicketsLost === null) return 0
  return clamp(Math.round(44 + (wicketsLost - 3) * 9 + (requiredRate - 12) * 6 + (requiredRate - currentRate) * 5), 0, 100)
}

export function buildScoreboardAction(fixture: LiveModelFixture, states: InningsStates, priceCap = DEFAULT_SCOREBOARD_PRICE_CAP): ScoreboardAction {
  const second = states.second
  const first = states.first
  const legalBalls = getBalls(second)
  const scoreRuns = second.scoreRuns
  const wicketsLost = second.scoreWickets
  const target = second.targetRuns ?? (first.scoreRuns === null ? null : first.scoreRuns + 1)
  const runsNeeded = target !== null && scoreRuns !== null ? Math.max(0, target - scoreRuns) : null
  const ballsLeft = legalBalls === null ? null : Math.max(0, T20_MAX_LEGAL_BALLS - legalBalls)
  const crr = scoreRuns !== null && legalBalls !== null && legalBalls > 0 ? (scoreRuns * 6) / legalBalls : null
  const rrr = runsNeeded !== null && ballsLeft !== null && ballsLeft > 0 ? (runsNeeded * 6) / ballsLeft : null
  const chaser = second.battingTeam
  const defender = second.bowlingTeam
  const chaserPrice = getScoreboardTeamPrice(fixture, chaser)
  const defenderPrice = getScoreboardTeamPrice(fixture, defender)
  const stats = {
    legalBalls,
    overs: legalBalls === null ? '—' : formatOversFromBalls(legalBalls),
    crr,
    rrr,
    runsNeeded,
    ballsLeft,
    wicketsLost,
    target,
  }

  const reducedMatchReason = getReducedMatchReason(fixture, states)
  if (reducedMatchReason) {
    return makeScoreboardAction({
      status: 'no-trade',
      role: null,
      team: null,
      headline: 'NO TRADE',
      subhead: reducedMatchReason,
      price: null,
      strength: null,
      reasons: ['Scoreboard-side entries are disabled when rain, DLS, revised targets, or shortened innings can change the normal 20-over chase geometry.'],
      blockers: ['Reduced or weather-affected match. Do not enter from this strategy card.'],
      stats,
    }, priceCap)
  }

  const settledMarketReason = getSettledMarketReason(fixture)
  if (settledMarketReason) {
    return makeScoreboardAction({
      status: 'no-trade',
      role: null,
      team: null,
      headline: 'NO TRADE',
      subhead: settledMarketReason,
      price: null,
      strength: null,
      reasons: ['The market is at a terminal-looking extreme, so this tab will not turn a dead price into a BUY instruction.'],
      blockers: ['Market appears settled or effectively closed.'],
      stats,
    }, priceCap)
  }

  const dataBlockers = [
    legalBalls === null ? 'Need legal balls completed in the chase.' : null,
    scoreRuns === null ? 'Need chasing score.' : null,
    wicketsLost === null ? 'Need wickets lost.' : null,
    target === null ? 'Need first-innings target.' : null,
    chaser === null ? 'Need chasing team.' : null,
    defender === null ? 'Need defending team.' : null,
  ].filter((blocker): blocker is string => blocker !== null)

  if (dataBlockers.length > 0) {
    return makeScoreboardAction({
      status: 'unavailable',
      role: null,
      team: null,
      headline: 'DATA NEEDED',
      subhead: 'Cannot produce a trading instruction until score, target, wickets, and teams are available.',
      price: null,
      strength: null,
      reasons: ['Rule waits for the 11.0-13.0 chase window with complete live scoreboard context.'],
      blockers: dataBlockers,
      stats,
    }, priceCap)
  }

  if (legalBalls === null || scoreRuns === null || wicketsLost === null || target === null || runsNeeded === null || ballsLeft === null || chaser === null || defender === null) {
    return makeScoreboardAction({
      status: 'unavailable',
      role: null,
      team: null,
      headline: 'DATA NEEDED',
      subhead: 'Cannot safely narrow the live scoreboard fields for the strategy card yet.',
      price: null,
      strength: null,
      reasons: ['Waiting for complete chase rate, wicket, team, and price fields.'],
      blockers: ['Live payload is missing one or more required scoreboard-side fields.'],
      stats,
    }, priceCap)
  }

  const terminalReason = terminalChaseReason({ scoreRuns, target, runsNeeded, wicketsLost, legalBalls, ballsLeft })
  if (terminalReason) {
    return makeScoreboardAction({
      status: 'no-trade',
      role: null,
      team: null,
      headline: 'NO TRADE',
      subhead: terminalReason,
      price: null,
      strength: null,
      reasons: ['The chase is already terminal, so this display-only strategy card must not create a fresh entry instruction.'],
      blockers: ['Terminal chase state. Hold existing positions only; do not enter from this rule.'],
      stats,
    }, priceCap)
  }

  if (legalBalls < ENTRY_WINDOW_START_BALLS) {
    return makeScoreboardAction({
      status: 'wait',
      role: null,
      team: null,
      headline: 'WAIT — NOT 11.0 YET',
      subhead: `Start scanning at 11.0 overs. Current chase: ${formatOversFromBalls(legalBalls)} overs.`,
      price: null,
      strength: null,
      reasons: ['Strategy only watches legal balls 66 through 78 in the chase.'],
      blockers: [`${ENTRY_WINDOW_START_BALLS - legalBalls} legal balls until the scan window opens.`],
      stats,
    }, priceCap)
  }

  if (legalBalls > SCOREBOARD_SIDE_WINDOW_END_BALLS) {
    return makeScoreboardAction({
      status: 'no-trade',
      role: null,
      team: null,
      headline: 'NO TRADE',
      subhead: `The 13.0-over scan window has closed at ${formatOversFromBalls(legalBalls)} overs.`,
      price: null,
      strength: null,
      reasons: ['No first usable scoreboard-side entry is shown after 13.0 overs.'],
      blockers: ['Window closed. Do not chase a late entry from this strategy card.'],
      stats,
    }, priceCap)
  }

  if (crr === null || rrr === null) {
    return makeScoreboardAction({
      status: 'unavailable',
      role: null,
      team: null,
      headline: 'RATE DATA NEEDED',
      subhead: 'Cannot calculate CRR and RRR for the active scan window yet.',
      price: null,
      strength: null,
      reasons: ['Scoreboard-side rules require both current run rate and required run rate.'],
      blockers: ['Live payload is missing enough ball context to calculate rates.'],
      stats,
    }, priceCap)
  }

  const priceBlockers = [
    chaserPrice === null ? 'Need chaser Polymarket price.' : null,
    defenderPrice === null ? 'Need defender Polymarket price.' : null,
  ].filter((blocker): blocker is string => blocker !== null)

  if (priceBlockers.length > 0 || chaserPrice === null || defenderPrice === null) {
    return makeScoreboardAction({
      status: 'unavailable',
      role: null,
      team: null,
      headline: 'PRICE DATA NEEDED',
      subhead: 'Inside the 11.0-13.0 scan window, but PM prices are required before showing BUY or WAIT FOR PRICE.',
      price: null,
      strength: null,
      reasons: [`Scoreboard-side entries require the supported side to be at or below the ${formatScoreboardPrice(priceCap)} cap.`],
      blockers: priceBlockers,
      stats,
    }, priceCap)
  }

  const chasingRateOk = rrr <= 11
  const chasingWicketsOk = wicketsLost <= 3
  const chasingCrrOk = crr >= rrr
  const defendingCrrOk = crr < rrr
  const defendingRrrOk = rrr >= 12
  const defendingWicketsOk = wicketsLost >= 4
  const defendingPressureOk = wicketsLost >= 5 || rrr >= 13
  const chasingScoreboardOk = chasingRateOk && chasingWicketsOk && chasingCrrOk
  const defendingScoreboardOk = defendingCrrOk && defendingRrrOk && defendingWicketsOk && defendingPressureOk

  if (chasingScoreboardOk) {
    const strength = calculateScoreboardChasingStrength(crr, rrr, wicketsLost, chaserPrice, priceCap)
    const priceOk = chaserPrice <= priceCap
    return makeScoreboardAction({
      status: priceOk ? 'buy' : 'wait',
      role: 'chaser',
      team: chaser,
      headline: priceOk ? `BUY CHASER — ${chaser}` : `WAIT FOR CHASER PRICE — ${chaser}`,
      subhead: priceOk ? `Scoreboard supports the chase and price is inside the ${formatScoreboardPrice(priceCap)} cap.` : 'Scoreboard supports the chase, but price is too expensive for this rule.',
      price: chaserPrice,
      strength,
      reasons: [`RRR ${formatRate(rrr)} is at or below 11.0.`, `${wicketsLost} wickets lost is within the ≤3 wicket gate.`, `CRR ${formatRate(crr)} is at or above RRR ${formatRate(rrr)}.`],
      blockers: priceOk ? [] : [`Chaser price ${formatScoreboardPrice(chaserPrice)} is above the ${formatScoreboardPrice(priceCap)} cap.`],
      stats,
    }, priceCap)
  }

  if (defendingScoreboardOk) {
    const strength = calculateScoreboardDefendingStrength(crr, rrr, wicketsLost, defenderPrice, priceCap)
    const priceOk = defenderPrice <= priceCap
    return makeScoreboardAction({
      status: priceOk ? 'buy' : 'wait',
      role: 'defender',
      team: defender,
      headline: priceOk ? `BUY DEFENDER — ${defender}` : `WAIT FOR DEFENDER PRICE — ${defender}`,
      subhead: priceOk ? `Scoreboard says the chase is under pressure and defender price is inside the ${formatScoreboardPrice(priceCap)} cap.` : 'Scoreboard supports the defender, but price is too expensive for this rule.',
      price: defenderPrice,
      strength,
      reasons: [`CRR ${formatRate(crr)} is below RRR ${formatRate(rrr)}.`, `RRR ${formatRate(rrr)} is at or above 12.0.`, `${wicketsLost} wickets lost with ${wicketsLost >= 5 ? 'five-plus wickets down' : 'RRR at least 13.0'} pressure confirmation.`],
      blockers: priceOk ? [] : [`Defender price ${formatScoreboardPrice(defenderPrice)} is above the ${formatScoreboardPrice(priceCap)} cap.`],
      stats,
    }, priceCap)
  }

  return makeScoreboardAction({
    status: 'wait',
    role: null,
    team: null,
    headline: 'DON’T BUY YET',
    subhead: 'Inside the scan window, but neither scoreboard-side entry rule is complete.',
    price: null,
    strength: null,
    reasons: ['Continue watching each legal ball and odds update until 13.0 overs.'],
    blockers: [
      chasingRateOk ? null : `Chaser gate blocked: RRR ${formatRate(rrr)} must be ≤ 11.0.`,
      chasingWicketsOk ? null : `Chaser gate blocked: wickets ${wicketsLost} must be ≤ 3.`,
      chasingCrrOk ? null : `Chaser gate blocked: CRR ${formatRate(crr)} must be ≥ RRR ${formatRate(rrr)}.`,
      defendingCrrOk ? null : `Defender gate blocked: CRR ${formatRate(crr)} must be below RRR ${formatRate(rrr)}.`,
      defendingRrrOk ? null : `Defender gate blocked: RRR ${formatRate(rrr)} must be ≥ 12.0.`,
      defendingWicketsOk ? null : `Defender gate blocked: wickets ${wicketsLost} must be ≥ 4.`,
      defendingPressureOk ? null : 'Defender gate blocked: need 5+ wickets down or RRR ≥ 13.0.',
    ].filter((blocker): blocker is string => blocker !== null),
    stats,
  }, priceCap)
}

function makeScoreboardAction(input: Omit<ScoreboardAction, 'priceCap' | 'strengthLabel' | 'stakeGuidance'>, priceCap = DEFAULT_SCOREBOARD_PRICE_CAP): ScoreboardAction {
  return {
    ...input,
    priceCap,
    strengthLabel: scoreboardStrengthLabel(input.strength),
    stakeGuidance: scoreboardStakeGuidance(input.status, input.price, priceCap),
  }
}

function getScoreboardTeamPrice(fixture: LiveModelFixture, team: string | null): number | null {
  if (!team) return null
  const side = [fixture.home, fixture.away].find((candidate) => sameTeam(candidate.team, team))
  return side?.marketProbability ?? null
}

function terminalChaseReason(state: { scoreRuns: number; target: number; runsNeeded: number; wicketsLost: number; legalBalls: number; ballsLeft: number }): string | null {
  if (state.scoreRuns >= state.target || state.runsNeeded <= 0) return `Chase complete: target ${state.target} has already been reached.`
  if (state.wicketsLost >= 10) return 'Chase complete: batting side is all out.'
  if (state.legalBalls >= T20_MAX_LEGAL_BALLS || state.ballsLeft <= 0) return 'Chase complete: no legal balls remain.'
  return null
}

function getReducedMatchReason(fixture: LiveModelFixture, states: InningsStates): string | null {
  const statusText = [fixture.fixture.status, fixture.fixture.period, fixture.fixture.score].filter((value): value is string => Boolean(value)).join(' ').toLowerCase()
  const token = ['reduced', 'shortened', 'rain', 'dls', 'd/l', 'duckworth', 'revised target', 'revised', 'abandoned', 'no result'].find((candidate) => statusText.includes(candidate))
  if (token) return `Reduced or weather-affected match detected from fixture text (${token}).`

  const first = states.first
  const second = states.second
  const firstInningsComplete = first.status === 'frozen' || states.activeInnings === 2 || second.status === 'live' || second.status === 'frozen'
  if (firstInningsComplete && second.targetRuns !== null && first.scoreRuns !== null && second.targetRuns !== first.scoreRuns + 1) {
    return `Revised target detected: chase target ${second.targetRuns} does not match first innings ${first.scoreRuns} + 1.`
  }

  const firstBalls = getBalls(first)
  const firstInningsShort = firstBalls !== null ? firstBalls < T20_MAX_LEGAL_BALLS : first.overs !== null && first.overs < 19.5
  const firstInningsAllOut = first.scoreWickets !== null && first.scoreWickets >= 10
  return firstInningsComplete && !firstInningsAllOut && firstInningsShort ? 'First innings ended before the normal 20-over allocation without being all out.' : null
}

function getSettledMarketReason(fixture: LiveModelFixture): string | null {
  const pricedSides = [fixture.home, fixture.away].filter((side): side is LiveModelSide & { marketProbability: number } => side.marketProbability !== null)
  const deadSide = pricedSides.find((side) => side.marketProbability <= SETTLED_MARKET_LOW_PRICE)
  if (deadSide) return `Market appears settled or dead: ${deadSide.team} is priced at ${formatScoreboardPrice(deadSide.marketProbability)}.`
  const lockedSide = pricedSides.find((side) => side.marketProbability >= SETTLED_MARKET_HIGH_PRICE)
  return lockedSide ? `Market appears settled or locked: ${lockedSide.team} is priced at ${formatScoreboardPrice(lockedSide.marketProbability)}.` : null
}

function calculateScoreboardChasingStrength(crr: number, rrr: number, wicketsLost: number, price: number, priceCap: number): number {
  return clamp(Math.round(50 + 7 * (crr - rrr) + 6 * (3 - wicketsLost) + 3 * (11 - rrr) + Math.max(0, priceCap - price) * 20), 0, 100)
}

function calculateScoreboardDefendingStrength(crr: number, rrr: number, wicketsLost: number, price: number, priceCap: number): number {
  return clamp(Math.round(50 + 7 * (rrr - crr) + 6 * (wicketsLost - 4) + 3 * (rrr - 12) + Math.max(0, priceCap - price) * 20), 0, 100)
}

function scoreboardStrengthLabel(strength: number | null): string {
  if (strength === null) return 'Not scored'
  if (strength >= 85) return 'Very strong'
  if (strength >= 70) return 'Strong'
  if (strength >= 60) return 'Acceptable'
  return 'Weak'
}

function scoreboardStakeGuidance(status: ScoreboardActionStatus, price: number | null, priceCap: number): string {
  if (status !== 'buy' || price === null) return '0% — do not enter'
  if (price <= 0.85) return '20-30% bankroll'
  if (price <= 0.9) return '15-20% bankroll'
  if (price <= priceCap) return '5-10% bankroll'
  return '0% — price above cap'
}

function formatScoreboardPrice(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}¢`
}

function formatScoreboardNeed(runsNeeded: number | null, ballsLeft: number | null): string {
  return runsNeeded === null || ballsLeft === null ? '—' : `${runsNeeded} off ${ballsLeft}`
}

function StrategyCard({ evaluation }: { evaluation: StrategyEvaluation }) {
  const fixture = evaluation.fixture.fixture
  const homeMarketPrice = getSideMarketPrice(evaluation.fixture, 'home')
  const awayMarketPrice = getSideMarketPrice(evaluation.fixture, 'away')
  const favouriteCopy = evaluation.favourite.kind === 'clear'
    ? `Polymarket favourite · ${evaluation.favourite.team} ${formatYesPrice(evaluation.favourite.price)}`
    : evaluation.favourite.reason
  const waitingForChase = !evaluation.hasChaseState
  return (
    <article className={`strategy-card ${evaluation.action}`}>
      <header className="strategy-card-header">
        <div>
          <p>{fixture.venueName ?? 'Venue pending'} · {fixture.status}</p>
          <h2>{fixture.homeTeam} <span>vs</span> {fixture.awayTeam}</h2>
        </div>
        <div className={`strategy-action-pill ${evaluation.action}`}>{evaluation.actionLabel}</div>
      </header>

      <section className="strategy-decision-panel">
        <div>
          <p className="strategy-overline">{favouriteCopy}</p>
          <h3>{evaluation.headline}</h3>
          <p>{evaluation.statusCopy}</p>
        </div>
        <StrengthDial score={evaluation.strengthScore} label={evaluation.strengthLabel} />
      </section>

      <ScoreboardActionPanel action={evaluation.scoreboardAction} />

      <div className="strategy-state-grid">
        <State label="Checkpoint" value={waitingForChase ? 'pending chase' : formatCheckpoint(evaluation.metrics)} tone={evaluation.metrics.checkpoint === 'entry' ? 'live' : 'default'} />
        <State label="Chase score" value={waitingForChase ? 'not started' : formatActualScore(evaluation.inningsStates.second)} />
        <State label="Runs needed" value={waitingForChase ? 'after target' : formatRunsNeeded(evaluation.metrics.runsNeeded, evaluation.metrics.ballsLeft)} />
        <State label="Required rate" value={waitingForChase ? 'after target' : formatRate(evaluation.metrics.requiredRate)} tone={evaluation.metrics.requiredRate !== null && evaluation.metrics.requiredRate >= 12 ? 'pressure' : 'default'} />
        <State label="Current rate" value={waitingForChase ? 'not started' : formatRate(evaluation.metrics.currentRate)} />
        <State label="Wickets lost" value={waitingForChase ? 'not started' : formatWickets(evaluation.metrics.wicketsLost)} tone={evaluation.metrics.wicketsLost !== null && evaluation.metrics.wicketsLost >= 4 ? 'pressure' : 'default'} />
        <State label={`${fixture.homeTeam} Polymarket YES`} value={formatYesPrice(homeMarketPrice)} tone={homeMarketPrice === null ? 'pressure' : 'live'} />
        <State label={`${fixture.awayTeam} Polymarket YES`} value={formatYesPrice(awayMarketPrice)} tone={awayMarketPrice === null ? 'pressure' : 'live'} />
        <State label="Favourite role" value={waitingForChase ? 'after chase starts' : formatFavouriteRole(evaluation.favouriteRole)} />
        <State label="Stake guide" value={waitingForChase ? '0% until chase' : evaluation.suggestedStake} tone={evaluation.action === 'buy' ? 'live' : 'default'} />
      </div>

      <div className="strategy-alignment-grid">
        <AlignmentMeter label="Chase comfort" value={waitingForChase ? null : evaluation.metrics.chaseComfortScore} />
        <AlignmentMeter label="Defensive pressure" value={waitingForChase ? null : evaluation.metrics.defensivePressureScore} />
      </div>

      <div className="strategy-reason-list">
        <strong>Score logic</strong>
        {evaluation.scoreBreakdown.map((item) => <p key={item}>{item}</p>)}
      </div>

      <div className="strategy-condition-grid">
        {evaluation.conditions.map((strategyCondition) => (
          <div className={strategyCondition.passed ? 'strategy-condition pass' : 'strategy-condition fail'} key={strategyCondition.label}>
            <span>{strategyCondition.label}</span>
            <strong>{strategyCondition.value}</strong>
            <small>{strategyCondition.note}</small>
          </div>
        ))}
      </div>

      <div className="strategy-side-row">
        <SidePrice side={evaluation.fixture.home} team={fixture.homeTeam} marketPrice={homeMarketPrice} />
        <SidePrice side={evaluation.fixture.away} team={fixture.awayTeam} marketPrice={awayMarketPrice} />
      </div>

      <div className="strategy-reason-list">
        {evaluation.reasons.map((reason) => <p key={reason}>{reason}</p>)}
      </div>
    </article>
  )
}

function ScoreboardActionPanel({ action }: { action: ScoreboardAction }) {
  const className = `strategy-scoreboard-action ${action.status}`
  return (
    <section className={className}>
      <div className="strategy-scoreboard-command">
        <span>{action.status === 'buy' ? 'Scoreboard-side signal' : 'Scoreboard-side desk'}</span>
        <strong>{action.headline}</strong>
        <p>{action.subhead}</p>
      </div>
      <div className="strategy-scoreboard-sizing">
        <span>Suggested bankroll</span>
        <strong>{action.stakeGuidance}</strong>
        <small>11th-over tab guidance · env-only live controls</small>
      </div>
      <div className="strategy-state-grid strategy-scoreboard-grid">
        <State label="Window" value={`${action.stats.legalBalls === null ? '—' : `${formatOversFromBalls(action.stats.legalBalls)} ov`} / 11.0-13.0`} tone={action.status === 'buy' ? 'live' : 'default'} />
        <State label="Price / cap" value={`${formatScoreboardPrice(action.price)} / ${formatScoreboardPrice(action.priceCap)}`} tone={action.status === 'buy' ? 'live' : 'default'} />
        <State label="Strength" value={action.strength === null ? action.strengthLabel : `${action.strength} · ${action.strengthLabel}`} tone={action.status === 'buy' ? 'live' : 'default'} />
        <State label="Need / balls" value={formatScoreboardNeed(action.stats.runsNeeded, action.stats.ballsLeft)} />
        <State label="CRR" value={formatRate(action.stats.crr)} />
        <State label="RRR" value={formatRate(action.stats.rrr)} />
        <State label="Wickets" value={action.stats.wicketsLost === null ? '—' : `${action.stats.wicketsLost} down`} />
        <State label="Target" value={action.stats.target === null ? '—' : action.stats.target.toString()} />
      </div>
      <div className="strategy-scoreboard-notes">
        <div>
          <span>Why</span>
          <ul>{action.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
        <div>
          <span>Blockers</span>
          <ul>{action.blockers.length === 0 ? <li>None: rule gate is clear.</li> : action.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
        </div>
      </div>
    </section>
  )
}

function TradingSafetyPanel({ tradingStatus }: { tradingStatus: TradingStatusData | null }) {
  const [error, setError] = useState<string | null>(null)

  if (!tradingStatus) {
    return (
      <section className="strategy-trading-panel">
        <SectionHeading label="Trading safety console" value="unavailable" />
        <p className="strategy-muted-copy">Trading status is unavailable; the strategy board still shows live model state.</p>
      </section>
    )
  }

  const { mode, liveEligibility, runtimeFlag, recipeValidation, exposureSummary, reconciliationStatus, latestIntents, latestEvents } = tradingStatus
  const isLive = mode === 'live'
  const isBlocked = mode === 'blocked'
  const tradeSetupPending = isLive && recipeValidation.status === 'missing'
  const tradeSetupLabel = recipeValidation.status === 'valid'
    ? 'READY'
    : recipeValidation.status === 'invalid'
      ? 'CHECK SETUP'
      : 'WAITING'

  return (
    <section className="strategy-trading-panel">
      <SectionHeading label="Trading safety console" value={mode.toUpperCase()} />
      {error ? <div className="strategy-error-strip">{error}</div> : null}
      <div className="strategy-metric-grid strategy-trading-metric-grid">
        <StrategyMetric label="Trading mode" value={mode} tone={isLive ? 'buy' : isBlocked ? 'skip' : 'default'} />
        <StrategyMetric label="Env gate" value={liveEligibility.liveEnvGateEnabled ? 'OPEN' : 'CLOSED'} tone={liveEligibility.liveEnvGateEnabled ? 'buy' : 'skip'} />
        <article className="strategy-metric-card">
          <span>Env live switch</span>
          <strong>{runtimeFlag.enabled ? 'ENABLED' : 'DISABLED'}</strong>
          <button onClick={() => setError('Live mode is environment-controlled. Change TRADING_LIVE_ENABLED and restart the backend.')} className="trading-toggle-button disabled">ENV ONLY</button>
        </article>
        <StrategyMetric label="Trade setup" value={tradeSetupLabel} tone={recipeValidation.status === 'valid' ? 'buy' : 'default'} />
        <StrategyMetric label="Open exposure" value={`$${exposureSummary?.totalOpenExposureUsd ?? 0}`} />
        <StrategyMetric label="Reconciliation" value={reconciliationStatus.present ? 'ACTIVE' : 'INACTIVE'} tone={reconciliationStatus.present ? 'buy' : 'default'} />
      </div>

      {liveEligibility.blockerReasons.length > 0 ? (
        <div className="trading-blockers">
          <strong>Blockers ({liveEligibility.blockerReasons.length})</strong>
          <ul>
            {(liveEligibility.blockerDetails ?? liveEligibility.blockerReasons.map((reason) => ({ code: reason, errors: [] }))).map((reason) => (
              <li key={reason.code}>
                {reason.code}
                {reason.errors.length > 0 ? <small>: {reason.errors.join('; ')}</small> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tradeSetupPending ? (
        <div className="strategy-recipe-pending-card">
          <strong>Live trading is armed. No trade can trigger in the first innings.</strong>
          <p>This tab is for an 11th-over chase entry. While the first innings or first over is happening, it should only watch. It can create a trade setup only in the second innings, after 11 completed overs of the chase.</p>
          <p>Orders stay at zero until the chase reaches balls 66-78, the score/target/wickets are fresh, Polymarket tokens are mapped, price is inside the cap, and the rule says BUY.</p>
        </div>
      ) : null}

      <div className="strategy-trading-details-grid">
        <div className="strategy-rule-card">
          <strong>Planned trades</strong>
          {latestIntents.length === 0 ? <p>None yet. Waiting for a qualifying second-innings 11-over BUY signal.</p> : latestIntents.slice(0, 3).map((intent) => <p key={intent.id}>{intent.status} · {intent.side} · {formatTradingTimestamp(intent.createdAt)}</p>)}
        </div>
        <div className="strategy-rule-card">
          <strong>Order activity</strong>
          {latestEvents.length === 0 ? <p>None yet. No order has been submitted because no qualifying trade exists.</p> : latestEvents.slice(0, 3).map((event) => <p key={event.id}>Intent #{event.intentId} · {event.eventType} · {formatTradingTimestamp(event.eventTime)}</p>)}
        </div>
      </div>
    </section>
  )
}

function NextMatchPanel({
  fixture,
  liveFixture,
  observerFixture,
  defaultMarket,
  liveCount,
  averageStrength,
}: {
  fixture: PredictorFixture | null
  liveFixture: LiveModelFixture | null
  observerFixture: ObserverFixture | null
  defaultMarket: DefaultMarket | null
  liveCount: number
  averageStrength: number | null
}) {
  if (liveFixture) {
    return (
      <section className="strategy-next-panel">
        <div className="strategy-next-main">
          <p className="strategy-overline">Live monitored match · in play</p>
          <h2>{liveFixture.fixture.homeTeam} <span>vs</span> {liveFixture.fixture.awayTeam}</h2>
          <p>{liveFixture.fixture.venueName ?? 'Venue pending'} · {liveFixture.fixture.status}</p>
        </div>
        <div className="strategy-next-grid">
          <State label="Score" value={liveFixture.fixture.score ?? 'score pending'} tone="live" />
          <State label="Period" value={liveFixture.fixture.period ?? 'live'} tone="live" />
          <State label="Live strategy cards" value={liveCount.toString()} />
          <State label="Avg strategy score" value={averageStrength === null ? 'pending chase' : `${averageStrength}/100`} />
          <State label="Next action" value="watch live chase" />
        </div>
        <div className="strategy-next-brief">
          <p>The match is already live, so this panel is using the observer live-model feed instead of the predictor schedule countdown.</p>
          <p>Entry window: 66-72 completed balls for the 11-over favourite rule; the scoreboard-side panel tracks 66-78 completed balls.</p>
        </div>
      </section>
    )
  }

  if (!fixture) {
    return (
      <section className="strategy-next-panel strategy-next-empty">
        <div>
          <p className="strategy-overline">Next monitored match</p>
          <h2>No upcoming IPL fixture loaded yet</h2>
          <p>Once the predictor schedule or Polymarket IPL market has a live/upcoming match, this panel will show the next match, mapping readiness, and when to start watching for the 66-72 ball window.</p>
        </div>
        <State label="Live strategy cards" value={liveCount.toString()} />
      </section>
    )
  }

  const observerMarketSlug = observerFixture ? getObserverMarketSlug(observerFixture) : null
  const observerEventSlug = observerFixture ? getObserverEventSlug(observerFixture) : null
  const mappingReady = Boolean(observerMarketSlug && observerFixture && getObserverHomeTokenId(observerFixture) && getObserverAwayTokenId(observerFixture))
  const marketLinked = Boolean(defaultMarket?.slug && observerFixture && (observerMarketSlug === defaultMarket.slug || observerEventSlug === defaultMarket.slug || observerMarketSlug))
  const mapLabel = mappingReady ? 'tokens ready' : marketLinked ? 'event linked' : 'pending'
  const mapTone: StateTone = mappingReady || marketLinked ? 'live' : 'pressure'
  const startTime = fixture.match_date ?? ''
  const startsIn = formatTimeUntilStart(startTime)
  const venue = summarizePredictorVenue(fixture)
  const marketCopy = defaultMarket === null ? 'No current Polymarket default' : `${defaultMarket.title} · ${defaultMarket.status}`
  return (
    <section className="strategy-next-panel">
      <div className="strategy-next-main">
        <p className="strategy-overline">Next monitored match · {startsIn}</p>
        <h2>{fixture.team1} <span>vs</span> {fixture.team2}</h2>
        <p>{venue}</p>
      </div>
      <div className="strategy-next-grid">
        <State label="Start time" value={formatDateTime(startTime)} tone="live" />
        <State label="Fixture status" value={formatPredictorFixtureStatus(fixture)} />
        <State label="Schedule source" value="predictor" tone="live" />
        <State label="Polymarket map" value={mapLabel} tone={mapTone} />
        <State label="Live strategy cards" value={liveCount.toString()} />
        <State label="Avg strategy score" value={averageStrength === null ? 'pending chase' : `${averageStrength}/100`} />
        <State label="Next action" value="wait for chase" />
      </div>
      <div className="strategy-next-brief">
        <p>{marketCopy}{defaultMarket?.url ? ` · ${defaultMarket.url}` : ''}</p>
        <p>Pre-match checklist: confirm mapping, keep the observer running, and wait for the chase. No signal can qualify until the second innings reaches 66 completed balls.</p>
        <p>Entry window: 66-72 completed balls. If the match is reduced-over, revised-target, missing odds, or the favourite is unclear, the dashboard will skip.</p>
      </div>
    </section>
  )
}

function StrengthDial({ score, label }: { score: number; label: string }) {
  const dialStyle: CSSProperties = {
    background: `radial-gradient(circle at center, #101712 0 53%, transparent 54%), conic-gradient(var(--accent) ${score}%, rgba(245, 241, 223, 0.12) 0)`,
  }
  return (
    <div className="strategy-strength-dial" style={dialStyle}>
      <span>Strategy score</span>
      <strong>{score}</strong>
      <small>{label}</small>
    </div>
  )
}

function AlignmentMeter({ label, value }: { label: string; value: number | null }) {
  const displayValue = value === null ? 'pending' : `${value}/100`
  const width = value === null ? 0 : value
  return (
    <div className="strategy-alignment-meter">
      <div>
        <span>{label}</span>
        <strong>{displayValue}</strong>
      </div>
      <div className="strategy-meter-track" aria-hidden="true">
        <span style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function SidePrice({ side, team, marketPrice }: { side: LiveModelSide; team: string; marketPrice: number | null }) {
  return (
    <div className="strategy-side-card">
      <span>{team}</span>
      <strong>{formatYesPrice(marketPrice)}</strong>
      <small>Polymarket YES · model {formatProbability(side.winProbability)} · fair {formatProbability(side.fairProbability)} · edge {formatBps(side.edgeVsMarketBps)}</small>
    </div>
  )
}

function StrategyMetric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'buy' | 'skip' }) {
  return (
    <article className={`strategy-metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function State({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'live' | 'pressure' }) {
  return (
    <div className={`strategy-state-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SectionHeading({ label, value }: { label: string; value: string }) {
  return (
    <div className="strategy-section-heading">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function StrategyEmptyState() {
  return (
    <div className="strategy-empty-state">
      <strong>No live fixture model yet</strong>
      <p>The 11-over board will populate from `/api/observer/live-model` once an IPL chase is tracked with Polymarket YES prices.</p>
    </div>
  )
}

function toFallbackInningsStates(state: ExpectedState): InningsStates {
  const fallback: InningsExpectedState = { ...state, status: state.innings === null ? 'unavailable' : 'live' }
  const blank = (innings: 1 | 2): InningsExpectedState => ({
    innings,
    battingTeam: null,
    bowlingTeam: null,
    scoreRuns: null,
    scoreWickets: null,
    overs: null,
    balls: null,
    targetRuns: null,
    expectedRunsNow: null,
    expectedWicketsNow: null,
    runsDelta: null,
    wicketsDelta: null,
    projectedScore: null,
    expectedRunRate: null,
    battingTeamWinProbability: null,
    chaseSuccessProbability: null,
    status: 'unavailable',
  })
  return { activeInnings: state.innings, first: state.innings === 1 ? fallback : blank(1), second: state.innings === 2 ? fallback : blank(2) }
}

function getBalls(state: ExpectedState): number | null {
  if (state.balls !== undefined && state.balls !== null) return state.balls
  return oversToBalls(state.overs)
}

function oversToBalls(overs: number | null): number | null {
  if (overs === null) return null
  const wholeOvers = Math.trunc(overs)
  const ballPart = Math.round((overs - wholeOvers) * 10)
  if (ballPart >= 6) return (wholeOvers + 1) * 6
  return wholeOvers * 6 + ballPart
}

function checkpointState(balls: number | null): CheckpointState {
  if (balls === null) return 'unknown'
  if (balls < ENTRY_WINDOW_START_BALLS) return 'before'
  if (balls < ENTRY_WINDOW_END_BALLS) return 'entry'
  return 'after'
}

function actionLabel(action: StrategyAction): string {
  switch (action) {
    case 'buy': return 'BUY'
    case 'skip': return 'SKIP'
    case 'wait': return 'WAIT'
    case 'passed': return 'WINDOW PASSED'
  }
}

function buildHeadline(action: StrategyAction, favourite: FavouriteResult, role: FavouriteRole | null, strengthScore: number): string {
  if (favourite.kind === 'unclear') return 'No clear live favourite.'
  const roleCopy = role === 'chasing' ? 'chasing favourite' : role === 'defending' ? 'defending favourite' : 'unmapped favourite'
  if (action === 'buy') return `${favourite.team} is a state-aligned ${roleCopy}.`
  if (action === 'wait') return strengthScore >= 70 ? `${favourite.team} is trending, but entry is not open yet.` : `No entry before the 11-over window.`
  if (action === 'passed') return `Do not re-enter after the entry window closes.`
  return `${favourite.team} is favourite, but the scoreboard does not fully agree.`
}

function buildStatusCopy(action: StrategyAction, checkpoint: CheckpointState, metrics: StrategyMetrics, isRuleQualified: boolean, warnings: string[]): string {
  const firstWarning = warnings.at(0)
  if (firstWarning !== undefined && action === 'skip') return firstWarning
  if (action === 'buy') return 'The favourite passes the rule inside the 66-72 completed-ball entry window. Stake from the guide and hold to settlement unless a separately tested exit rule is active.'
  if (action === 'wait') {
    if (checkpoint === 'before') return `${metrics.ballsToCheckpoint ?? '—'} balls until the only entry window. Treat strength as a watch signal only.`
    return 'Waiting for a clear 2nd-innings ball count and live YES prices.'
  }
  if (action === 'passed') return isRuleQualified ? 'The current state would qualify, but the strategy only allows entry before 73 completed balls.' : 'The entry window has passed, and the current state is not actionable.'
  return 'No trade: the rule is designed to skip when favourite price and scoreboard state diverge.'
}

function buildReasons(
  action: StrategyAction,
  role: FavouriteRole | null,
  isRuleQualified: boolean,
  conditions: StrategyCondition[],
  warnings: string[],
  checkpoint: CheckpointState,
): string[] {
  if (warnings.length > 0) return warnings
  if (action === 'wait') return ['No trade before 11 completed overs.', 'The strength score is only a pre-window trend read until the chase reaches 66 completed balls.']
  if (action === 'passed') return ['Entry window has passed.', 'This strategy forbids entries once the chase reaches 73 completed balls or later.']
  if (action === 'buy' && role === 'chasing') return ['Chasing favourite is comfortable: rate is manageable, wickets are in hand, and CRR is at or above RRR.', 'Suggested stake comes from signal cleanliness, not favourite price alone.']
  if (action === 'buy' && role === 'defending') return ['Defending favourite is backed by real chase damage.', 'The board is avoiding the trap of buying a defender against a healthy, fast chase.']
  if (!isRuleQualified && checkpoint === 'entry') {
    const failed: string[] = []
    for (const conditionItem of conditions) {
      if (!conditionItem.passed) {
        failed.push(`${conditionItem.label}: ${conditionItem.value}`)
      }
    }
    return failed.length > 0 ? failed : ['The scoreboard contradicts the favourite.']
  }
  return ['No qualifying 11-over trade.']
}

function strengthLabel(score: number, qualified: boolean): string {
  if (qualified && score >= 85) return 'Very clean'
  if (qualified && score >= 70) return 'Qualified'
  if (score >= 70) return 'Strong trend'
  if (score >= 55) return 'Watch'
  if (score >= 35) return 'Mixed'
  return 'Weak / unclear'
}

function suggestedStake(action: StrategyAction, score: number): string {
  if (action !== 'buy') return '0%'
  if (score >= 85) return '25-30%'
  return '15-20%'
}

function formatCheckpoint(metrics: StrategyMetrics): string {
  if (metrics.secondBalls === null) return 'unknown'
  if (metrics.checkpoint === 'before') return `${formatOversFromBalls(metrics.secondBalls)} · ${metrics.ballsToCheckpoint} balls to 11`
  if (metrics.checkpoint === 'entry') return `${formatOversFromBalls(metrics.secondBalls)} · entry open`
  return `${formatOversFromBalls(metrics.secondBalls)} · passed`
}

function formatActualScore(state: ExpectedState): string {
  if (state.scoreRuns === null && state.scoreWickets === null) return '—'
  const score = state.scoreWickets === null ? `${state.scoreRuns ?? '—'} runs` : `${state.scoreRuns ?? '—'}/${state.scoreWickets}`
  const balls = getBalls(state)
  return balls === null ? score : `${score} in ${formatOversFromBalls(balls)}`
}

function formatRunsNeeded(runsNeeded: number | null, ballsLeft: number | null): string {
  if (runsNeeded === null) return '—'
  if (ballsLeft === null) return `${runsNeeded} runs`
  return `${runsNeeded} off ${ballsLeft}`
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function formatPredictorFixtureStatus(fixture: PredictorFixture): string {
  if (isLivePredictorFixture(fixture)) return 'Live'
  if (isCompletedPredictorFixture(fixture)) return 'Completed'
  return fixture.status?.trim() || 'Scheduled'
}

function summarizePredictorVenue(fixture: PredictorFixture): string {
  const venue = fixture.venue?.trim()
  const city = fixture.city?.trim()
  if (venue && city) return `${venue} · ${city}`
  return venue || city || 'Venue pending'
}

function formatTimeUntilStart(value: string): string {
  const startMs = new Date(value).getTime()
  if (!Number.isFinite(startMs)) return '—'
  const diffMs = startMs - Date.now()
  if (diffMs <= 0) return 'starting soon'
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours === 0 ? `${days}d` : `${days}d ${remainingHours}h`
}

function formatOversFromBalls(balls: number): string {
  const overs = Math.floor(balls / 6)
  const ballsPart = balls % 6
  return `${overs}.${ballsPart}`
}

function formatRate(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)} RPO`
}

function formatWickets(value: number | null): string {
  return value === null ? '—' : `${value} down`
}

function formatYesPrice(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}c`
}

function formatProbability(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value * 1000) / 10}%`
}

function formatBps(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${value} bps`
}

function formatScoreDelta(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${rounded > 0 ? '+' : ''}${rounded}`
}

function formatTradingTimestamp(value: string | null | undefined): string {
  if (!value) return 'Never'
  const trimmed = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(trimmed)
  if (!match) return trimmed
  const [, , , , hour, minute] = match
  return hour && minute ? `${hour}:${minute}${trimmed.endsWith('Z') ? ' UTC' : ''}` : trimmed
}

function formatFavouriteRole(role: FavouriteRole | null): string {
  if (role === 'chasing') return 'Chasing'
  if (role === 'defending') return 'Defending'
  return '—'
}

function compareEvaluations(a: StrategyEvaluation, b: StrategyEvaluation): number {
  const actionRank: Record<StrategyAction, number> = { buy: 0, wait: 1, skip: 2, passed: 3 }
  const actionDiff = actionRank[a.action] - actionRank[b.action]
  if (actionDiff !== 0) return actionDiff
  return b.strengthScore - a.strengthScore
}

function sameTeam(left: string, right: string): boolean {
  return normalizeTeam(left) === normalizeTeam(right)
}

function getObserverEventSlug(fixture: ObserverFixture): string | null {
  return fixture.polymarketEventSlug ?? fixture.market?.eventSlug ?? null
}

function getObserverMarketSlug(fixture: ObserverFixture): string | null {
  return fixture.polymarketMarketSlug ?? fixture.market?.marketSlug ?? null
}

function getObserverHomeTokenId(fixture: ObserverFixture): string | null {
  return fixture.homeTokenId ?? fixture.market?.homeTokenId ?? null
}

function getObserverAwayTokenId(fixture: ObserverFixture): string | null {
  return fixture.awayTokenId ?? fixture.market?.awayTokenId ?? null
}

function isLivePredictorFixture(fixture: PredictorFixture): boolean {
  return fixture.is_live === true || fixture.is_live === 'true'
}

function isCompletedPredictorFixture(fixture: PredictorFixture): boolean {
  if (fixture.is_completed === true || fixture.is_completed === 'true') {
    return true
  }
  const status = String(fixture.status ?? '').toLowerCase()
  return isFinishedStatus(status)
}

function localDateKey(date: Date): string {
  const parts = localDateFormatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : ''
}

function normalizeTeam(team: string): string {
  const normalized = team.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return TEAM_NAME_ALIASES[normalized] ?? normalized
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

async function responseMessage(response: Response): Promise<string> {
  const payload = await parseJsonResponse(response)
  if (isRecord(payload) && typeof payload.error === 'string') {
    return payload.error
  }
  return `Observer API is unavailable (${response.status}).`
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return await response.json()
  }
  return { error: await response.text() }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFatalObserverConfigurationError(message: string): boolean {
  return message.includes('IPL_TRADER_API_ORIGIN must be set')
}

function isFinishedStatus(status: string): boolean {
  const normalized = status.toLowerCase()
  return normalized.includes('complete') || normalized.includes('final') || normalized.includes('finished') || normalized.includes('ended')
}
