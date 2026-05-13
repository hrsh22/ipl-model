import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useReducer, useState } from 'react'

export const Route = createFileRoute('/observer')({
  component: ObserverPage,
})

type LiveModelSide = {
  team: string
  winProbability: number | null
  fairProbability: number | null
  marketProbability: number | null
  referenceProbability: number | null
  edgeVsMarketBps: number | null
}

type VenueContext = {
  venue: string
  matchCount: number
  seasons: { first: number | null; last: number | null }
  avgFirstInningsScore: number | null
  avgSecondInningsScore: number | null
  avgFirstInningsWinningScore: number | null
  avgChaseWinningScore: number | null
  battingFirstWins: number
  chasingWins: number
  battingFirstWinPct: number | null
  chasingWinPct: number | null
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
  venueContext: VenueContext | null
  home: LiveModelSide
  away: LiveModelSide
}

type LiveModelSignal = {
  id: number
  fixtureId: string
  selection: string
  modelProbability: number
  polymarketProbability: number | null
  edgeVsPolymarketBps: number | null
  reason: string
  confidence: string
  createdAt: string
}

type LiveModelSnapshot = {
  id: number
  fixtureId: string
  innings: number | null
  battingTeam: string | null
  bowlingTeam: string | null
  scoreRuns: number | null
  scoreWickets: number | null
  overs: number | null
  balls: number | null
  expectedRunsNow: number | null
  expectedWicketsNow: number | null
  runsDelta: number | null
  wicketsDelta: number | null
  projectedScore: number | null
  homeModelProbability: number | null
  awayModelProbability: number | null
  homePolymarketProbability: number | null
  awayPolymarketProbability: number | null
  edgeHomeVsPolymarketBps: number | null
  edgeAwayVsPolymarketBps: number | null
  confidence: string
  createdAt: string
}

type LiveModelHistoryEntry = {
  fixture: LiveModelFixture['fixture']
  venueContext: VenueContext | null
  latestSnapshot: LiveModelSnapshot | null
  inningsSnapshots?: {
    first: LiveModelSnapshot | null
    second: LiveModelSnapshot | null
  } | undefined
  inningsStates?: InningsStates | undefined
  recentSignals: LiveModelSignal[]
  signalCount: number
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

type DashboardData = {
  tradingStatus: TradingStatusData | null
  ready: Record<string, unknown>
  fixtures: LiveModelFixture[]
  signals: LiveModelSignal[]
  history: LiveModelHistoryEntry[]
}

type ObserverState = {
  refresh: () => Promise<void>
  data: DashboardData | null
  error: string | null
  status: 'loading' | 'success' | 'error'
  updatedAt: string | null
  refreshing: boolean
}

type ObserverStateAction =
  | { type: 'refreshing'; initial: boolean }
  | { type: 'success'; data: DashboardData; refresh: () => Promise<void>; updatedAt: string }
  | { type: 'error'; message: string }

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

const SCOREBOARD_START_BALL = 66
const SCOREBOARD_END_BALL = 78
const DEFAULT_SCOREBOARD_PRICE_CAP = 0.9
const T20_MAX_LEGAL_BALLS = 120
const SETTLED_MARKET_LOW_PRICE = 0.01
const SETTLED_MARKET_HIGH_PRICE = 0.99
const TEAM_ALIAS_MAP: Record<string, string> = {
  CSK: 'Chennai Super Kings',
  DC: 'Delhi Capitals',
  'Delhi Daredevils': 'Delhi Capitals',
  GT: 'Gujarat Titans',
  'Kings XI Punjab': 'Punjab Kings',
  KKR: 'Kolkata Knight Riders',
  KXIP: 'Punjab Kings',
  LSG: 'Lucknow Super Giants',
  MI: 'Mumbai Indians',
  PBKS: 'Punjab Kings',
  RCB: 'Royal Challengers Bengaluru',
  'Rising Pune Supergiant': 'Rising Pune Supergiants',
  RR: 'Rajasthan Royals',
  'Royal Challengers Bangalore': 'Royal Challengers Bengaluru',
  SRH: 'Sunrisers Hyderabad',
}

let lastStableDashboardData: DashboardData | null = null

const initialObserverState: ObserverState = {
  data: null,
  error: null,
  status: 'loading',
  updatedAt: null,
  refreshing: false,
  refresh: async () => {},
}

function observerStateReducer(current: ObserverState, action: ObserverStateAction): ObserverState {
  switch (action.type) {
    case 'refreshing':
      return { ...current, refreshing: !action.initial }
    case 'success':
      return { data: action.data, error: null, status: 'success', updatedAt: action.updatedAt, refreshing: false, refresh: action.refresh }
    case 'error':
      return {
        ...current,
        error: action.message,
        status: current.data ? 'success' : 'error',
        refreshing: false,
      }
  }
}

function ObserverPage() {
  const state = useObserverDashboard()
  const data = state.data
  const fixtures = data?.fixtures ?? []
  const signals = data?.signals ?? []
  const history = data?.history ?? []
  const ready = data?.ready ?? null
  const scoreboardPriceCap = data?.tradingStatus?.activeStrategy.priceCap ?? DEFAULT_SCOREBOARD_PRICE_CAP
  const observerStatusLabel = ready?.ready === true
    ? ready.degraded === true
      ? 'Observer usable · official fixtures'
      : 'Observer ready'
    : state.status === 'loading'
      ? 'Loading observer'
      : 'Observer warming'
  const aggregateEdge = useMemo(() => {
    const edges = fixtures.flatMap((fixture) => [fixture.home.edgeVsMarketBps, fixture.away.edgeVsMarketBps])
    const valid = edges.filter((edge): edge is number => edge !== null)
    return valid.length === 0 ? null : valid.reduce((sum, edge) => sum + Math.abs(edge), 0) / valid.length
  }, [fixtures])

  return (
    <main className="observer-shell">
      <section className="observer-hero">
        <div>
          <p className="eyebrow">Live ball-by-ball observer · isolated from deployed predictor</p>
          <h1>Model-scored expected-state moneyline desk</h1>
          <p className="observer-copy">
            Track trained expected runs, expected wickets, projected score, Betfair-led fair probability, and Polymarket moneyline disagreement without touching production model artifacts.
          </p>
        </div>
        <div className="observer-status-card">
          <span className="observer-status-dot" />
          <span>{observerStatusLabel}</span>
          <strong>{state.updatedAt ? `Last ${state.updatedAt}` : 'waiting'}</strong>
          <small>{state.refreshing ? 'refreshing' : state.status}</small>
        </div>
      </section>

      {state.error ? <div className="observer-error-strip">{state.error}</div> : null}

      <section className="observer-metric-grid">
        <ObserverMetric label="Tracked live models" value={fixtures.length.toString()} />
        <ObserverMetric label="Avg absolute edge" value={aggregateEdge === null ? '—' : `${Math.round(aggregateEdge)} bps`} />
        <ObserverMetric label="Recent signals" value={signals.length.toString()} />
      </section>

      <section className="observer-content-grid">
        {data?.tradingStatus && <TradingSafetyPanel tradingStatus={data.tradingStatus} refresh={state.refresh} />}
        <div className="observer-fixture-stack">
          <SectionHeading label="Live model board" value={`${fixtures.length} fixtures`} />
          {fixtures.length === 0 ? <ObserverEmptyState /> : fixtures.map((fixture) => <FixtureCard key={fixture.fixture.id} fixture={fixture} priceCap={scoreboardPriceCap} />)}

          <SectionHeading label="Historical tracking" value={`${history.length} matches`} />
          {history.length === 0 ? (
            <div className="observer-empty-state">
              <strong>No persisted match history yet</strong>
              <p>Run migrations and keep the observer running during matches to collect snapshots.</p>
            </div>
          ) : (
            history.map((entry) => <HistoryCard entry={entry} key={entry.fixture.id} />)
          )}
        </div>

        <aside className="observer-signal-rail">
          <SectionHeading label="Signal tape" value="latest" />
          <div className="observer-terms-card">
            <strong>Terms</strong>
            <p><b>Expected now</b> is scored through the trained ball-by-ball model for the current live payload; unavailable model targets render as unavailable.</p>
            <p><b>Fair probability</b> is the Betfair-led reference price, not the deployed predictor.</p>
            <p><b>PM</b> is Polymarket moneyline probability.</p>
          </div>
          {signals.length === 0 ? (
            <p className="observer-muted">No live-model signals have crossed the runtime threshold yet.</p>
          ) : (
            signals.map((signal) => <SignalCard signal={signal} key={signal.id} />)
          )}
        </aside>
      </section>
    </main>
  )
}

function useObserverDashboard(): ObserverState {
  const [state, dispatch] = useReducer(observerStateReducer, initialObserverState)

  useEffect(() => {
    let cancelled = false
    let stopped = false
    let interval: number | null = null

    const load = async (initial: boolean) => {
      if (stopped) return
      dispatch({ type: 'refreshing', initial })
      try {
        const data = await loadObserverDashboard()
        if (cancelled) return
        dispatch({ type: 'success', data, updatedAt: formatEpochTime(Date.now()), refresh: async () => { await load(false) } })
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'Observer dashboard request failed.'
        if (isFatalObserverConfigurationError(message)) {
          stopped = true
          if (interval !== null) {
            window.clearInterval(interval)
          }
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
      window.clearInterval(interval)
    }
  }, [])

  return state
}

export async function loadObserverDashboard(): Promise<DashboardData> {
  const responses = await Promise.all([
    fetch('/api/observer/ready'),
    fetch('/api/observer/live-model'),
    fetch('/api/observer/live-model/signals?limit=8'),
    fetch('/api/observer/live-model/history?limit=12'),
    fetch('/api/observer/trading/status'),
  ])

  const coreResponses = responses.slice(0, 4)
  const failed = coreResponses.find((response) => !response.ok)
  if (failed) {
    throw new Error(await responseMessage(failed))
  }

  const [ready, fixtures, signals, history, tradingStatusResponse] = await Promise.all([
    responses[0].json() as Promise<Record<string, unknown>>,
    responses[1].json() as Promise<LiveModelFixture[]>,
    responses[2].json() as Promise<LiveModelSignal[]>,
    responses[3].json() as Promise<LiveModelHistoryEntry[]>,
    responses[4].ok ? (responses[4].json().catch(() => null)) as Promise<TradingStatusData | null> : Promise.resolve(null),
  ])

  const dashboard = mergeWithStableDashboardData({
    ready,
    fixtures,
    signals,
    history,
    tradingStatus: tradingStatusResponse,
  })
  lastStableDashboardData = dashboard
  return dashboard
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

function mergeWithStableDashboardData(next: DashboardData): DashboardData {
  const previous = lastStableDashboardData
  if (!previous) return next
  return {
    ...next,
    fixtures: next.fixtures.map((fixture) => {
      const previousFixture = previous.fixtures.find((candidate) => candidate.fixture.id === fixture.fixture.id)
      return previousFixture ? mergeFixture(previousFixture, fixture) : fixture
    }),
    history: next.history.map((entry) => {
      const previousEntry = previous.history.find((candidate) => candidate.fixture.id === entry.fixture.id)
      return previousEntry ? mergeHistoryEntry(previousEntry, entry) : entry
    }),
  }
}

function mergeFixture(previous: LiveModelFixture, next: LiveModelFixture): LiveModelFixture {
  const preserveBreakValues = isMidInningsBreak(next.inningsStates)
  return {
    ...next,
    expectedState: mergeExpectedState(previous.expectedState, next.expectedState, preserveBreakValues),
    inningsStates: mergeInningsStates(previous.inningsStates, next.inningsStates, preserveBreakValues),
    venueContext: next.venueContext ?? previous.venueContext,
    home: preserveBreakValues ? mergeLiveModelSide(previous.home, next.home) : next.home,
    away: preserveBreakValues ? mergeLiveModelSide(previous.away, next.away) : next.away,
  }
}

function mergeHistoryEntry(previous: LiveModelHistoryEntry, next: LiveModelHistoryEntry): LiveModelHistoryEntry {
  return {
    ...next,
    venueContext: next.venueContext ?? previous.venueContext,
    latestSnapshot: next.latestSnapshot ?? previous.latestSnapshot,
    inningsSnapshots: next.inningsSnapshots ?? previous.inningsSnapshots,
    inningsStates: mergeInningsStates(previous.inningsStates, next.inningsStates),
  }
}

function mergeExpectedState(previous: ExpectedState, next: ExpectedState, preserveNulls = false): ExpectedState {
  if (previous.innings !== null && next.innings !== null && previous.innings !== next.innings) return next
  return {
    innings: next.innings ?? previous.innings,
    battingTeam: next.battingTeam ?? previous.battingTeam,
    bowlingTeam: next.bowlingTeam ?? previous.bowlingTeam,
    scoreRuns: next.scoreRuns ?? previous.scoreRuns,
    scoreWickets: next.scoreWickets ?? previous.scoreWickets,
    overs: next.overs ?? previous.overs,
    balls: next.balls ?? previous.balls ?? null,
    targetRuns: next.targetRuns ?? previous.targetRuns ?? null,
    expectedRunsNow: preserveNulls ? next.expectedRunsNow ?? previous.expectedRunsNow : next.expectedRunsNow,
    expectedWicketsNow: preserveNulls ? next.expectedWicketsNow ?? previous.expectedWicketsNow : next.expectedWicketsNow,
    runsDelta: preserveNulls ? next.runsDelta ?? previous.runsDelta : next.runsDelta,
    wicketsDelta: preserveNulls ? next.wicketsDelta ?? previous.wicketsDelta : next.wicketsDelta,
    projectedScore: preserveNulls ? next.projectedScore ?? previous.projectedScore : next.projectedScore,
    expectedRunRate: preserveNulls ? next.expectedRunRate ?? previous.expectedRunRate : next.expectedRunRate,
    battingTeamWinProbability: preserveNulls ? next.battingTeamWinProbability ?? previous.battingTeamWinProbability : next.battingTeamWinProbability,
    chaseSuccessProbability: preserveNulls ? next.chaseSuccessProbability ?? previous.chaseSuccessProbability : next.chaseSuccessProbability,
  }
}

function mergeLiveModelSide(previous: LiveModelSide, next: LiveModelSide): LiveModelSide {
  return {
    ...next,
    winProbability: next.winProbability ?? previous.winProbability,
    fairProbability: next.fairProbability ?? previous.fairProbability,
    marketProbability: next.marketProbability ?? previous.marketProbability,
    referenceProbability: next.referenceProbability ?? previous.referenceProbability,
    edgeVsMarketBps: next.edgeVsMarketBps ?? previous.edgeVsMarketBps,
  }
}

function mergeInningsStates(previous: InningsStates | undefined, next: InningsStates | undefined, preserveNulls = false): InningsStates | undefined {
  if (!previous) return next
  if (!next) return previous
  return {
    ...next,
    first: mergeInningsState(previous.first, next.first, preserveNulls),
    second: mergeInningsState(previous.second, next.second, preserveNulls),
  }
}

function mergeInningsState(previous: InningsExpectedState, next: InningsExpectedState, preserveNulls = false): InningsExpectedState {
  if (next.status === 'unavailable' || next.status === 'pending') return next
  return { ...mergeExpectedState(previous, next, preserveNulls), status: next.status }
}

function isMidInningsBreak(states: InningsStates | undefined): boolean {
  if (!states) return false
  return isCompletedT20Innings(states.first) && !hasSecondInningsStarted(states.second)
}

function isCompletedT20Innings(state: InningsExpectedState): boolean {
  return (state.scoreWickets !== null && state.scoreWickets >= 10) || (state.overs !== null && state.overs >= 19.5)
}

function hasSecondInningsStarted(state: InningsExpectedState): boolean {
  return Boolean(
    (state.overs !== null && state.overs > 0) ||
    (state.scoreRuns !== null && state.scoreRuns > 0) ||
    (state.scoreWickets !== null && state.scoreWickets > 0) ||
    state.status === 'live',
  )
}

function ObserverMetric({ label, value }: { label: string; value: string }) {
  return (
    <article className="observer-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function FixtureCard({ fixture, priceCap }: { fixture: LiveModelFixture; priceCap: number }) {
  const inningsStates = fixture.inningsStates ?? toFallbackInningsStates(fixture.expectedState)
  const scoreboardAction = buildScoreboardAction(fixture, inningsStates, priceCap)
  return (
    <article className="observer-fixture-card">
      <header>
        <div>
          <p>{fixture.fixture.venueName ?? 'Venue pending'} · {fixture.fixture.status}</p>
          <h2>{fixture.fixture.homeTeam} <span>vs</span> {fixture.fixture.awayTeam}</h2>
        </div>
        <div className="observer-score-pill">{fixture.fixture.score ?? 'score pending'}</div>
      </header>
      <ScoreboardActionPanel action={scoreboardAction} />
      <div className="observer-innings-grid">
        <InningsPanel title="First innings" innings={inningsStates.first} />
        <InningsPanel title="Second innings" innings={inningsStates.second} />
      </div>
      <VenueContextPanel venueContext={fixture.venueContext} />
      <div className="observer-side-row">
        <SideProbability side={fixture.home} />
        <SideProbability side={fixture.away} />
      </div>
    </article>
  )
}

function ScoreboardActionPanel({ action }: { action: ScoreboardAction }) {
  const className = `observer-action-panel ${action.status}`
  return (
    <section className={className}>
      <div className="observer-action-command">
        <span>{action.status === 'buy' ? 'Scoreboard-side signal' : 'Scoreboard-side desk'}</span>
        <strong>{action.headline}</strong>
        <p>{action.subhead}</p>
      </div>
      <div className="observer-action-sizing">
        <span>Suggested bankroll</span>
        <strong>{action.stakeGuidance}</strong>
        <small>Display guidance only · no automatic trading change</small>
      </div>
      <div className="observer-action-grid">
        <State label="Window" value={`${formatBallWindow(action.stats.legalBalls)} / 11.0-13.0`} tone={action.status === 'buy' ? 'live' : 'default'} />
        <State label="Price / cap" value={`${formatPrice(action.price)} / ${formatPrice(action.priceCap)}`} tone={action.status === 'buy' ? 'live' : 'default'} />
        <State label="Strength" value={action.strength === null ? action.strengthLabel : `${action.strength} · ${action.strengthLabel}`} tone={action.status === 'buy' ? 'live' : 'default'} />
        <State label="Need / balls" value={formatNeed(action.stats.runsNeeded, action.stats.ballsLeft)} />
        <State label="CRR" value={formatRate(action.stats.crr)} />
        <State label="RRR" value={formatRate(action.stats.rrr)} />
        <State label="Wickets" value={action.stats.wicketsLost === null ? '—' : `${action.stats.wicketsLost} down`} />
        <State label="Target" value={action.stats.target === null ? '—' : action.stats.target.toString()} />
      </div>
      <div className="observer-action-notes">
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

function InningsPanel({ title, innings }: { title: string; innings: InningsExpectedState }) {
  const pendingCopy = innings.status === 'pending' ? (innings.innings === 2 ? 'Awaiting chase data' : 'Awaiting innings data') : innings.status === 'unavailable' ? 'Not available yet' : null
  return (
    <section className={`observer-innings-panel ${innings.status}`}>
      <header>
        <div>
          <span>{title}</span>
          <strong>{formatInningsStatus(innings.status)}</strong>
        </div>
        <small>{innings.battingTeam ?? 'batting team unavailable'}</small>
      </header>
      {pendingCopy ? <p className="observer-innings-pending">{pendingCopy}</p> : null}
      {pendingCopy ? null : (
        <div className="observer-state-grid observer-innings-state-grid">
          <State label="Actual score" value={formatActualScore(innings)} tone={innings.status === 'live' ? 'live' : 'default'} />
          <State label="Expected now" value={formatScoreExpectation(innings.expectedRunsNow, innings.expectedWicketsNow)} />
          <State label="Actual delta" value={formatDelta(innings.runsDelta, innings.wicketsDelta)} />
          <State label="Projected innings" value={innings.projectedScore === null ? '—' : `${innings.projectedScore.toFixed(0)} runs`} />
          {innings.innings === 1 ? <State label="Batting win" value={formatProbability(innings.battingTeamWinProbability)} tone="live" /> : null}
          {innings.innings === 2 ? <State label="Chase win" value={formatProbability(innings.chaseSuccessProbability)} tone="live" /> : null}
        </div>
      )}
    </section>
  )
}

function HistoryCard({ entry }: { entry: LiveModelHistoryEntry }) {
  const snapshot = entry.latestSnapshot
  const stateSnapshots = entry.inningsStates
  const inningsSnapshots = entry.inningsSnapshots ?? {
    first: snapshot?.innings === 1 ? snapshot : null,
    second: snapshot?.innings === 2 ? snapshot : null,
  }
  const hasStructuredHistory = Boolean(inningsSnapshots.first || inningsSnapshots.second || hasHistoricalInningsState(stateSnapshots?.first) || hasHistoricalInningsState(stateSnapshots?.second))
  return (
    <article className="observer-history-card">
      <header>
        <div>
          <p>{entry.fixture.status} · {entry.fixture.venueName ?? 'venue pending'}</p>
          <h3>{entry.fixture.homeTeam} <span>vs</span> {entry.fixture.awayTeam}</h3>
        </div>
        <div className="observer-history-score">{entry.fixture.score ?? 'score pending'}</div>
      </header>
      {hasStructuredHistory ? (
        <div className="observer-innings-grid">
          <SnapshotInningsPanel title="First innings" snapshot={inningsSnapshots.first} fallbackState={stateSnapshots?.first} />
          <SnapshotInningsPanel title="Second innings" snapshot={inningsSnapshots.second} fallbackState={stateSnapshots?.second} />
        </div>
      ) : snapshot ? (
        <LegacySnapshotPanel snapshot={snapshot} />
      ) : null}
      <div className="observer-history-grid">
        <State label="Last tracked" value={formatTimestamp(snapshot?.createdAt)} />
        <State label="Signals" value={entry.signalCount.toString()} />
      </div>
      <VenueContextPanel venueContext={entry.venueContext} compact />
    </article>
  )
}

function LegacySnapshotPanel({ snapshot }: { snapshot: LiveModelSnapshot }) {
  return (
    <section className="observer-innings-panel frozen legacy">
      <header>
        <div>
          <span>Legacy tracked state</span>
          <strong>{formatTimestamp(snapshot.createdAt)}</strong>
        </div>
        <small>innings unavailable in older snapshot</small>
      </header>
      <div className="observer-state-grid observer-innings-state-grid">
        <State label="Actual score" value={formatSnapshotActualScore(snapshot)} />
        <State label="Expected now" value={formatScoreExpectation(snapshot.expectedRunsNow, snapshot.expectedWicketsNow)} />
        <State label="Actual delta" value={formatDelta(snapshot.runsDelta, snapshot.wicketsDelta)} />
        <State label="Projected innings" value={snapshot.projectedScore === null ? '—' : `${snapshot.projectedScore.toFixed(0)} runs`} />
      </div>
    </section>
  )
}

function SnapshotInningsPanel({ title, snapshot, fallbackState }: { title: string; snapshot: LiveModelSnapshot | null; fallbackState?: InningsExpectedState | undefined }) {
  if (!snapshot) {
    const historicalState = hasHistoricalInningsState(fallbackState) ? fallbackState : null
    if (historicalState) return <InningsPanel title={title} innings={historicalState} />
    return (
      <section className="observer-innings-panel unavailable">
        <header>
          <div>
            <span>{title}</span>
            <strong>innings data unavailable</strong>
          </div>
        </header>
        <p className="observer-innings-pending">Older snapshot format; innings-specific split was not persisted.</p>
      </section>
    )
  }
  return (
    <section className="observer-innings-panel frozen">
      <header>
        <div>
          <span>{title}</span>
          <strong>{formatTimestamp(snapshot.createdAt)}</strong>
        </div>
        <small>{snapshot.battingTeam ?? 'batting team unavailable'}</small>
      </header>
      <div className="observer-state-grid observer-innings-state-grid">
        <State label="Actual score" value={formatSnapshotActualScore(snapshot)} />
        <State label="Expected now" value={formatScoreExpectation(snapshot.expectedRunsNow, snapshot.expectedWicketsNow)} />
        <State label="Actual delta" value={formatDelta(snapshot.runsDelta, snapshot.wicketsDelta)} />
        <State label="Projected innings" value={snapshot.projectedScore === null ? '—' : `${snapshot.projectedScore.toFixed(0)} runs`} />
      </div>
    </section>
  )
}

function hasHistoricalInningsState(state: InningsExpectedState | undefined): state is InningsExpectedState {
  if (!state || state.status === 'pending' || state.status === 'unavailable') return false
  return state.scoreRuns !== null || state.scoreWickets !== null || state.overs !== null || state.expectedRunsNow !== null || state.expectedWicketsNow !== null || state.runsDelta !== null || state.wicketsDelta !== null || state.projectedScore !== null
}

function SideProbability({ side }: { side: LiveModelSide }) {
  const primaryProbability = side.winProbability ?? side.fairProbability
  const label = side.winProbability === null ? 'Fair probability' : 'Model win probability'
  return (
    <div className="observer-side-card">
      <span>{side.team}</span>
      <strong>{formatProbability(primaryProbability)}</strong>
      <small>{label} · PM {formatProbability(side.marketProbability)} · edge {formatBps(side.edgeVsMarketBps)}</small>
    </div>
  )
}

function VenueContextPanel({ venueContext, compact = false }: { venueContext: VenueContext | null; compact?: boolean }) {
  if (!venueContext) return null
  const seasons = venueContext.seasons.first && venueContext.seasons.last ? `${venueContext.seasons.first}-${venueContext.seasons.last}` : 'all seasons'
  return (
    <div className={compact ? 'observer-venue-context compact' : 'observer-venue-context'}>
      <div>
        <span>Venue context</span>
        <strong>{venueContext.venue}</strong>
        <small>{venueContext.matchCount} completed IPL matches · {seasons}</small>
      </div>
      <State label="Avg 1st inns" value={formatRuns(venueContext.avgFirstInningsScore)} />
      <State label="Avg 2nd inns" value={formatRuns(venueContext.avgSecondInningsScore)} />
      <State label="Avg defended" value={formatRuns(venueContext.avgFirstInningsWinningScore)} />
      <State label="Avg chase" value={formatRuns(venueContext.avgChaseWinningScore)} />
      <State label="Bat first wins" value={formatProbability(venueContext.battingFirstWinPct)} />
      <State label="Chasing wins" value={formatProbability(venueContext.chasingWinPct)} tone="live" />
    </div>
  )
}

function State({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'live' }) {
  return (
    <div className={tone === 'live' ? 'observer-state-card is-live' : 'observer-state-card'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SignalCard({ signal }: { signal: LiveModelSignal }) {
  return (
    <article className="observer-signal-card">
      <div>
        <span>{signal.selection}</span>
        <strong>{formatProbability(signal.modelProbability)}</strong>
      </div>
      <p>{signal.reason}</p>
      <small>fair edge {signal.edgeVsPolymarketBps ?? 0} bps · {signal.confidence}</small>
    </article>
  )
}

function SectionHeading({ label, value }: { label: string; value: string }) {
  return (
    <div className="observer-section-heading">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ObserverEmptyState() {
  return (
    <div className="observer-empty-state">
      <strong>No live fixture model yet</strong>
      <p>The board will populate from official IPL fixtures; pricing appears when Polymarket books are active.</p>
    </div>
  )
}

function toFallbackInningsStates(state: ExpectedState): InningsStates {
  const fallback = { ...state, status: state.innings === null ? 'unavailable' : 'live' } as InningsExpectedState
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

export function buildScoreboardAction(fixture: LiveModelFixture, states: InningsStates, priceCap = DEFAULT_SCOREBOARD_PRICE_CAP): ScoreboardAction {
  const second = states.second
  const first = states.first
  const legalBalls = getLegalBalls(second)
  const scoreRuns = second.scoreRuns
  const wicketsLost = second.scoreWickets
  const target = second.targetRuns ?? (first.scoreRuns === null ? null : first.scoreRuns + 1)
  const runsNeeded = target !== null && scoreRuns !== null ? Math.max(0, target - scoreRuns) : null
  const ballsLeft = legalBalls === null ? null : Math.max(0, T20_MAX_LEGAL_BALLS - legalBalls)
  const crr = scoreRuns !== null && legalBalls !== null && legalBalls > 0 ? (scoreRuns * 6) / legalBalls : null
  const rrr = runsNeeded !== null && ballsLeft !== null && ballsLeft > 0 ? (runsNeeded * 6) / ballsLeft : null
  const chaser = second.battingTeam
  const defender = second.bowlingTeam
  const chaserPrice = getTeamPrice(fixture, chaser)
  const defenderPrice = getTeamPrice(fixture, defender)
  const stats = {
    legalBalls,
    overs: legalBalls === null ? '—' : formatLegalBalls(legalBalls),
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
      reasons: ['The market is at a terminal-looking extreme, so the observer should not turn a dead price into a BUY instruction.'],
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

  if (
    legalBalls === null ||
    scoreRuns === null ||
    wicketsLost === null ||
    target === null ||
    runsNeeded === null ||
    ballsLeft === null ||
    chaser === null ||
    defender === null
  ) {
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

  if (legalBalls < SCOREBOARD_START_BALL) {
    return makeScoreboardAction({
      status: 'wait',
      role: null,
      team: null,
      headline: 'WAIT — NOT 11.0 YET',
      subhead: `Start scanning at 11.0 overs. Current chase: ${formatLegalBalls(legalBalls)} overs.`,
      price: null,
      strength: null,
      reasons: ['Strategy only watches legal balls 66 through 78 in the chase.'],
      blockers: [`${SCOREBOARD_START_BALL - legalBalls} legal balls until the scan window opens.`],
      stats,
    }, priceCap)
  }

  if (legalBalls > SCOREBOARD_END_BALL) {
    return makeScoreboardAction({
      status: 'no-trade',
      role: null,
      team: null,
      headline: 'NO TRADE',
      subhead: `The 13.0-over scan window has closed at ${formatLegalBalls(legalBalls)} overs.`,
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
      reasons: [`Scoreboard-side entries require the supported side to be at or below the ${formatPrice(priceCap)} cap.`],
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
    const strength = calculateChasingStrength(crr, rrr, wicketsLost, chaserPrice, priceCap)
    const priceOk = chaserPrice <= priceCap
    return makeScoreboardAction({
      status: priceOk ? 'buy' : 'wait',
      role: 'chaser',
      team: chaser,
      headline: priceOk ? `BUY CHASER — ${chaser}` : `WAIT FOR CHASER PRICE — ${chaser}`,
      subhead: priceOk ? `Scoreboard supports the chase and price is inside the ${formatPrice(priceCap)} cap.` : 'Scoreboard supports the chase, but price is too expensive for this rule.',
      price: chaserPrice,
      strength,
      reasons: [
        `RRR ${formatRate(rrr)} is at or below 11.0.`,
        `${wicketsLost} wickets lost is within the ≤3 wicket gate.`,
        `CRR ${formatRate(crr)} is at or above RRR ${formatRate(rrr)}.`,
      ],
      blockers: priceOk ? [] : [`Chaser price ${formatPrice(chaserPrice)} is above the ${formatPrice(priceCap)} cap.`],
      stats,
    }, priceCap)
  }

  if (defendingScoreboardOk) {
    const strength = calculateDefendingStrength(crr, rrr, wicketsLost, defenderPrice, priceCap)
    const priceOk = defenderPrice <= priceCap
    return makeScoreboardAction({
      status: priceOk ? 'buy' : 'wait',
      role: 'defender',
      team: defender,
      headline: priceOk ? `BUY DEFENDER — ${defender}` : `WAIT FOR DEFENDER PRICE — ${defender}`,
      subhead: priceOk ? `Scoreboard says the chase is under pressure and defender price is inside the ${formatPrice(priceCap)} cap.` : 'Scoreboard supports the defender, but price is too expensive for this rule.',
      price: defenderPrice,
      strength,
      reasons: [
        `CRR ${formatRate(crr)} is below RRR ${formatRate(rrr)}.`,
        `RRR ${formatRate(rrr)} is at or above 12.0.`,
        `${wicketsLost} wickets lost with ${wicketsLost >= 5 ? 'five-plus wickets down' : 'RRR at least 13.0'} pressure confirmation.`,
      ],
      blockers: priceOk ? [] : [`Defender price ${formatPrice(defenderPrice)} is above the ${formatPrice(priceCap)} cap.`],
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
    strengthLabel: strengthLabel(input.strength),
    stakeGuidance: stakeGuidance(input.status, input.price, priceCap),
  }
}

function formatInningsStatus(status: InningsExpectedState['status']): string {
  switch (status) {
    case 'live': return 'live'
    case 'frozen': return 'final / frozen'
    case 'pending': return 'pending'
    case 'unavailable': return 'not started'
  }
}

function getLegalBalls(state: ExpectedState): number | null {
  if (state.balls !== null && state.balls !== undefined) return state.balls
  return state.overs === null ? null : oversToLegalBalls(state.overs)
}

function oversToLegalBalls(overs: number): number {
  const completedOvers = Math.floor(overs)
  const balls = Math.round((overs - completedOvers) * 10)
  return completedOvers * 6 + Math.max(0, Math.min(5, balls))
}

function getTeamPrice(fixture: LiveModelFixture, team: string | null): number | null {
  if (!team) return null
  const normalizedTeam = normalizeTeamName(team)
  const side = [fixture.home, fixture.away].find((candidate) => normalizeTeamName(candidate.team) === normalizedTeam)
  return side?.marketProbability ?? null
}

function normalizeTeamName(team: string): string {
  const cleaned = team.trim().replace(/\s+/g, ' ')
  const aliasTarget = TEAM_ALIAS_MAP[cleaned] ?? Object.entries(TEAM_ALIAS_MAP).find(([alias]) => alias.toLowerCase() === cleaned.toLowerCase())?.[1]
  return (aliasTarget ?? cleaned).toLowerCase().replace(/[^a-z0-9]+/g, '').trim()
}

function terminalChaseReason(state: {
  scoreRuns: number
  target: number
  runsNeeded: number
  wicketsLost: number
  legalBalls: number
  ballsLeft: number
}): string | null {
  if (state.scoreRuns >= state.target || state.runsNeeded <= 0) {
    return `Chase complete: target ${state.target} has already been reached.`
  }
  if (state.wicketsLost >= 10) {
    return 'Chase complete: batting side is all out.'
  }
  if (state.legalBalls >= T20_MAX_LEGAL_BALLS || state.ballsLeft <= 0) {
    return 'Chase complete: no legal balls remain.'
  }
  return null
}

function getReducedMatchReason(fixture: LiveModelFixture, states: InningsStates): string | null {
  const statusText = [fixture.fixture.status, fixture.fixture.period, fixture.fixture.score]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()
  const weatherAffectedTokens = ['reduced', 'shortened', 'rain', 'dls', 'd/l', 'duckworth', 'revised target', 'revised', 'abandoned', 'no result']
  const token = weatherAffectedTokens.find((candidate) => statusText.includes(candidate))
  if (token) {
    return `Reduced or weather-affected match detected from fixture text (${token}).`
  }

  const first = states.first
  const second = states.second
  const firstInningsComplete = first.status === 'frozen' || states.activeInnings === 2 || second.status === 'live' || second.status === 'frozen'
  const targetMismatch = second.targetRuns !== null && first.scoreRuns !== null && second.targetRuns !== first.scoreRuns + 1
  if (firstInningsComplete && targetMismatch) {
    return `Revised target detected: chase target ${second.targetRuns} does not match first innings ${first.scoreRuns} + 1.`
  }

  const firstBalls = first.balls ?? null
  const firstInningsShortByBalls = firstBalls !== null && firstBalls < T20_MAX_LEGAL_BALLS
  const firstInningsShortByOvers = firstBalls === null && first.overs !== null && first.overs < 19.5
  const firstInningsAllOut = first.scoreWickets !== null && first.scoreWickets >= 10
  if (firstInningsComplete && !firstInningsAllOut && (firstInningsShortByBalls || firstInningsShortByOvers)) {
    return 'First innings ended before the normal 20-over allocation without being all out.'
  }

  return null
}

function getSettledMarketReason(fixture: LiveModelFixture): string | null {
  const pricedSides = [fixture.home, fixture.away].filter((side): side is LiveModelSide & { marketProbability: number } => side.marketProbability !== null)
  const deadSide = pricedSides.find((side) => side.marketProbability <= SETTLED_MARKET_LOW_PRICE)
  if (deadSide) {
    return `Market appears settled or dead: ${deadSide.team} is priced at ${formatPrice(deadSide.marketProbability)}.`
  }

  const lockedSide = pricedSides.find((side) => side.marketProbability >= SETTLED_MARKET_HIGH_PRICE)
  if (lockedSide) {
    return `Market appears settled or locked: ${lockedSide.team} is priced at ${formatPrice(lockedSide.marketProbability)}.`
  }

  return null
}

function calculateChasingStrength(crr: number, rrr: number, wicketsLost: number, price: number, priceCap: number): number {
  const rateEdge = crr - rrr
  const wicketEdge = 3 - wicketsLost
  const rrrCushion = 11 - rrr
  const priceBonus = Math.max(0, priceCap - price) * 20
  return clamp(Math.round(50 + 7 * rateEdge + 6 * wicketEdge + 3 * rrrCushion + priceBonus), 0, 100)
}

function calculateDefendingStrength(crr: number, rrr: number, wicketsLost: number, price: number, priceCap: number): number {
  const rateEdge = rrr - crr
  const wicketEdge = wicketsLost - 4
  const rrrPressure = rrr - 12
  const priceBonus = Math.max(0, priceCap - price) * 20
  return clamp(Math.round(50 + 7 * rateEdge + 6 * wicketEdge + 3 * rrrPressure + priceBonus), 0, 100)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function strengthLabel(strength: number | null): string {
  if (strength === null) return 'Not scored'
  if (strength >= 85) return 'Very strong'
  if (strength >= 70) return 'Strong'
  if (strength >= 60) return 'Acceptable'
  return 'Weak'
}

function stakeGuidance(status: ScoreboardActionStatus, price: number | null, priceCap: number): string {
  if (status !== 'buy' || price === null) return '0% — do not enter'
  if (price <= 0.85) return '20-30% bankroll'
  if (price <= 0.9) return '15-20% bankroll'
  if (price <= priceCap) return '5-10% bankroll'
  return '0% — price above cap'
}

function formatBallWindow(legalBalls: number | null): string {
  return legalBalls === null ? '—' : `${formatLegalBalls(legalBalls)} ov`
}

function formatLegalBalls(legalBalls: number): string {
  return `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`
}

function formatRate(value: number | null): string {
  return value === null ? '—' : value.toFixed(2)
}

function formatPrice(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}¢`
}

function formatNeed(runsNeeded: number | null, ballsLeft: number | null): string {
  if (runsNeeded === null || ballsLeft === null) return '—'
  return `${runsNeeded} off ${ballsLeft}`
}

function formatProbability(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value * 1000) / 10}%`
}

function formatBps(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${value} bps`
}

function formatScoreExpectation(runs: number | null, wickets: number | null): string {
  if (runs === null && wickets === null) return '—'
  return `${runs?.toFixed(0) ?? '—'}/${wickets?.toFixed(1) ?? '—'}`
}

function formatActualScore(state: ExpectedState): string {
  if (state.scoreRuns === null && state.scoreWickets === null) return '—'
  const score = state.scoreWickets === null ? `${state.scoreRuns ?? '—'} runs · wickets unavailable` : `${state.scoreRuns ?? '—'}/${state.scoreWickets}`
  return state.overs === null ? score : `${score} in ${state.overs} ov`
}

function formatSnapshotActualScore(snapshot: LiveModelSnapshot): string {
  if (snapshot.scoreRuns === null && snapshot.scoreWickets === null) return '—'
  const score = snapshot.scoreWickets === null ? `${snapshot.scoreRuns ?? '—'} runs · wickets unavailable` : `${snapshot.scoreRuns ?? '—'}/${snapshot.scoreWickets}`
  return snapshot.overs === null ? score : `${score} in ${snapshot.overs} ov`
}

function formatDelta(runs: number | null, wickets: number | null): string {
  if (runs === null && wickets === null) return '—'
  const runText = runs === null ? 'runs —' : `${runs > 0 ? '+' : ''}${runs.toFixed(1)}r`
  const wicketText = wickets === null ? 'wickets unavailable' : `${wickets > 0 ? '+' : ''}${wickets.toFixed(1)}w`
  return `${runText} / ${wicketText}`
}

function formatRuns(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)} runs`
}

function formatEpochTime(timestampMs: number): string {
  const totalMinutes = Math.floor(timestampMs / 60_000)
  const hours = Math.floor(totalMinutes / 60) % 24
  const minutes = totalMinutes % 60
  return `${padTimePart(hours)}:${padTimePart(minutes)} UTC`
}

function padTimePart(value: number): string {
  return value.toString().padStart(2, '0')
}

function formatTimestamp(value: string | null | undefined, mode: 'dateTime' | 'time' = 'dateTime'): string {
  if (!value) return mode === 'time' ? 'Never' : '—'
  const trimmed = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(trimmed)
  if (!match) return trimmed
  const [, year, month, day, hour, minute] = match
  if (!year || !month || !day || !hour || !minute) return trimmed
  const suffix = trimmed.endsWith('Z') ? ' UTC' : ''
  return mode === 'time' ? `${hour}:${minute}${suffix}` : `${year}-${month}-${day} ${hour}:${minute}${suffix}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFatalObserverConfigurationError(message: string): boolean {
  return message.includes('IPL_TRADER_API_ORIGIN must be set')
}

export function TradingSafetyPanel({ tradingStatus, refresh }: { tradingStatus: TradingStatusData | null, refresh: () => void }) {
  const [error, setError] = useState<string | null>(null)

  if (!tradingStatus) {
    return <div className="observer-metric-card"><span>Trading Safety</span><strong>Loading…</strong></div>
  }

  const { mode, liveEligibility, runtimeFlag, recipeValidation, exposureSummary, reconciliationStatus, latestIntents, latestEvents } = tradingStatus

  const isLive = mode === 'live'
  const isBlocked = mode === 'blocked'

  return (
    <section className="trading-safety-panel">
      <div className="observer-section-heading">
        <span>Trading Safety Console</span>
        <strong>{mode.toUpperCase()}</strong>
      </div>
      
      {error && <div className="observer-error-strip">{error}</div>}

      <div className="observer-metric-grid trading-safety-metric-grid">
        <article className={`observer-metric-card ${isLive ? 'is-live' : ''}`}>
          <span>Trading Mode</span>
          <strong>{mode}</strong>
          <small>{isBlocked ? 'Blocked' : (isLive ? 'Active' : 'Dry Run')}</small>
        </article>
        
        <article className="observer-metric-card">
          <span>Env Gate / Creds</span>
          <strong>{liveEligibility.liveEnvGateEnabled ? 'OPEN' : 'CLOSED'}</strong>
          <small>Creds: {liveEligibility.polymarketCredentialsPresent.allPresent ? 'OK' : 'MISSING'}</small>
        </article>
        
        <article className="observer-metric-card">
          <span>Env Live Switch</span>
          <div className="trading-flag-control">
            <strong>{runtimeFlag.enabled ? 'ENABLED' : 'DISABLED'}</strong>
            <button onClick={() => { setError('Live mode is environment-controlled. Change TRADING_LIVE_ENABLED and restart the backend.') }} className="trading-toggle-button disabled">ENV ONLY</button>
          </div>
          <small>{liveEligibility.runtimeControlMode === 'environment-only' ? 'Change TRADING_LIVE_ENABLED and restart.' : 'Runtime control mode unknown.'}</small>
        </article>
        
        <article className="observer-metric-card">
          <span>Recipe & Caps</span>
          <strong>{recipeValidation.status.toUpperCase()}</strong>
          <small>Valid: {recipeValidation.status === 'valid' ? 'Yes' : 'No'}</small>
        </article>
        
        <article className="observer-metric-card">
          <span>Exposure / Risk</span>
          <strong>${exposureSummary?.totalOpenExposureUsd ?? 0} OPEN</strong>
          <small>Limit checks active</small>
        </article>
        
        <article className="observer-metric-card">
          <span>Reconciliation</span>
          <strong>{reconciliationStatus.present ? 'ACTIVE' : 'INACTIVE'}</strong>
          <small>{formatTimestamp(reconciliationStatus.lastReconciledAt, 'time')}</small>
        </article>
      </div>

      {liveEligibility.blockerReasons?.length > 0 && (
        <div className="trading-blockers">
          <strong>Blockers ({liveEligibility.blockerReasons.length}):</strong>
          <ul>
            {liveEligibility.blockerReasons.map((reason: string) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      )}
      
      <div className="trading-safety-details-grid">
        <div className="observer-history-card">
          <header>
            <div>
              <h3>Recent Intents</h3>
            </div>
            <div className="observer-history-score">{latestIntents?.length ?? 0} intents</div>
          </header>
          <div className="observer-state-grid">
              {latestIntents?.slice(0, 3).map((intent: TradingStatusData["latestIntents"][0]) => (
                <div key={intent.id} className="observer-state-card observer-state-card-full">
                    <span>{intent.intentKey}</span>
                    <strong>{intent.status}</strong>
                    <small>{intent.side} · {formatTimestamp(intent.createdAt, 'time')}</small>
                 </div>
              ))}
              {!latestIntents?.length && <p className="observer-muted observer-state-card-full">No intents</p>}
          </div>
        </div>
        
        <div className="observer-history-card">
          <header>
            <div>
              <h3>Recent Events</h3>
            </div>
            <div className="observer-history-score">{latestEvents?.length ?? 0} events</div>
          </header>
          <div className="observer-state-grid">
              {latestEvents?.slice(0, 3).map((ev: TradingStatusData["latestEvents"][0]) => (
                <div key={ev.id} className="observer-state-card observer-state-card-full">
                    <span>Intent #{ev.intentId}</span>
                    <strong>{ev.eventType}</strong>
                    <small>{formatTimestamp(ev.eventTime, 'time')}</small>
                 </div>
              ))}
              {!latestEvents?.length && <p className="observer-muted observer-state-card-full">No events</p>}
          </div>
        </div>
      </div>
    </section>
  )
}
