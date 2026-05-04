import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

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
  expectedRunsNow: number | null
  expectedWicketsNow: number | null
  runsDelta: number | null
  wicketsDelta: number | null
  projectedScore: number | null
  expectedRunRate: number | null
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

type DashboardData = {
  ready: Record<string, unknown>
  fixtures: LiveModelFixture[]
  signals: LiveModelSignal[]
  history: LiveModelHistoryEntry[]
}

type ObserverState = {
  data: DashboardData | null
  error: string | null
  status: 'loading' | 'success' | 'error'
  updatedAt: Date | null
  refreshing: boolean
}

let lastStableDashboardData: DashboardData | null = null

function ObserverPage() {
  const state = useObserverDashboard()
  const data = state.data
  const fixtures = data?.fixtures ?? []
  const signals = data?.signals ?? []
  const history = data?.history ?? []
  const ready = data?.ready ?? null
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
          <strong>{state.updatedAt ? `Last ${state.updatedAt.toLocaleTimeString()}` : 'waiting'}</strong>
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
        <div className="observer-fixture-stack">
          <SectionHeading label="Live model board" value={`${fixtures.length} fixtures`} />
          {fixtures.length === 0 ? <ObserverEmptyState /> : fixtures.map((fixture) => <FixtureCard key={fixture.fixture.id} fixture={fixture} />)}

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
            <p><b>Expected now</b> is scored through the trained ball-by-ball model for the current live payload; unavailable model targets render as —.</p>
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
  const [state, setState] = useState<ObserverState>({
    data: null,
    error: null,
    status: 'loading',
    updatedAt: null,
    refreshing: false,
  })

  useEffect(() => {
    let cancelled = false
    let stopped = false
    let interval: number | null = null

    const load = async (initial: boolean) => {
      if (stopped) return
      setState((current) => ({ ...current, refreshing: !initial }))
      try {
        const data = await loadObserverDashboard()
        if (cancelled) return
        setState({ data, error: null, status: 'success', updatedAt: new Date(), refreshing: false })
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'Observer dashboard request failed.'
        if (isFatalObserverConfigurationError(message)) {
          stopped = true
          if (interval !== null) {
            window.clearInterval(interval)
          }
        }
        setState((current) => ({
          ...current,
          error: message,
          status: current.data ? 'success' : 'error',
          refreshing: false,
        }))
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

async function loadObserverDashboard(): Promise<DashboardData> {
  const responses = await Promise.all([
    fetch('/api/observer/ready'),
    fetch('/api/observer/live-model'),
    fetch('/api/observer/live-model/signals?limit=8'),
    fetch('/api/observer/live-model/history?limit=12'),
  ])

  const failed = responses.find((response) => !response.ok)
  if (failed) {
    throw new Error(await responseMessage(failed))
  }

  const [ready, fixtures, signals, history] = await Promise.all([
    responses[0].json() as Promise<Record<string, unknown>>,
    responses[1].json() as Promise<LiveModelFixture[]>,
    responses[2].json() as Promise<LiveModelSignal[]>,
    responses[3].json() as Promise<LiveModelHistoryEntry[]>,
  ])

  const dashboard = mergeWithStableDashboardData({
    ready,
    fixtures,
    signals,
    history,
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
  return {
    ...next,
    expectedState: mergeExpectedState(previous.expectedState, next.expectedState),
    inningsStates: mergeInningsStates(previous.inningsStates, next.inningsStates),
    venueContext: next.venueContext ?? previous.venueContext,
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

function mergeExpectedState(previous: ExpectedState, next: ExpectedState): ExpectedState {
  if (previous.innings !== null && next.innings !== null && previous.innings !== next.innings) return next
  return {
    innings: next.innings ?? previous.innings,
    battingTeam: next.battingTeam ?? previous.battingTeam,
    bowlingTeam: next.bowlingTeam ?? previous.bowlingTeam,
    scoreRuns: next.scoreRuns ?? previous.scoreRuns,
    scoreWickets: next.scoreWickets ?? previous.scoreWickets,
    overs: next.overs ?? previous.overs,
    expectedRunsNow: next.expectedRunsNow,
    expectedWicketsNow: next.expectedWicketsNow,
    runsDelta: next.runsDelta,
    wicketsDelta: next.wicketsDelta,
    projectedScore: next.projectedScore,
    expectedRunRate: next.expectedRunRate,
    chaseSuccessProbability: next.chaseSuccessProbability,
  }
}

function mergeInningsStates(previous: InningsStates | undefined, next: InningsStates | undefined): InningsStates | undefined {
  if (!previous) return next
  if (!next) return previous
  return {
    ...next,
    first: mergeInningsState(previous.first, next.first),
    second: mergeInningsState(previous.second, next.second),
  }
}

function mergeInningsState(previous: InningsExpectedState, next: InningsExpectedState): InningsExpectedState {
  if (next.status === 'unavailable' || next.status === 'pending') return next
  return { ...mergeExpectedState(previous, next), status: next.status }
}

function ObserverMetric({ label, value }: { label: string; value: string }) {
  return (
    <article className="observer-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function FixtureCard({ fixture }: { fixture: LiveModelFixture }) {
  const inningsStates = fixture.inningsStates ?? toFallbackInningsStates(fixture.expectedState)
  return (
    <article className="observer-fixture-card">
      <header>
        <div>
          <p>{fixture.fixture.venueName ?? 'Venue pending'} · {fixture.fixture.status}</p>
          <h2>{fixture.fixture.homeTeam} <span>vs</span> {fixture.fixture.awayTeam}</h2>
        </div>
        <div className="observer-score-pill">{fixture.fixture.score ?? 'score pending'}</div>
      </header>
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
        <State label="Last tracked" value={snapshot ? new Date(snapshot.createdAt).toLocaleString() : '—'} />
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
          <strong>{new Date(snapshot.createdAt).toLocaleString()}</strong>
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
          <strong>{new Date(snapshot.createdAt).toLocaleString()}</strong>
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
      <small>{label} · fair {formatProbability(side.fairProbability)} · PM {formatProbability(side.marketProbability)} · edge {formatBps(side.edgeVsMarketBps)}</small>
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
    expectedRunsNow: null,
    expectedWicketsNow: null,
    runsDelta: null,
    wicketsDelta: null,
    projectedScore: null,
    expectedRunRate: null,
    chaseSuccessProbability: null,
    status: 'unavailable',
  })
  return { activeInnings: state.innings, first: state.innings === 1 ? fallback : blank(1), second: state.innings === 2 ? fallback : blank(2) }
}

function formatInningsStatus(status: InningsExpectedState['status']): string {
  switch (status) {
    case 'live': return 'live'
    case 'frozen': return 'final / frozen'
    case 'pending': return 'pending'
    case 'unavailable': return 'not started'
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFatalObserverConfigurationError(message: string): boolean {
  return message.includes('IPL_TRADER_API_ORIGIN must be set')
}
