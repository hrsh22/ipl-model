import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

export const Route = createFileRoute("/")({
  component: LiveModelDashboard,
})

type LiveModelSide = {
  team: string
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
}

type InningsExpectedState = ExpectedState & {
  status: "live" | "frozen" | "pending" | "unavailable"
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
  inningsStates?: InningsStates
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
  fixture: LiveModelFixture["fixture"]
  venueContext: VenueContext | null
  latestSnapshot: LiveModelSnapshot | null
  inningsSnapshots?: {
    first: LiveModelSnapshot | null
    second: LiveModelSnapshot | null
  }
  inningsStates?: InningsStates
  recentSignals: LiveModelSignal[]
  signalCount: number
}

type BallStateShadow = {
  status: "experimental"
  source: "ball-state-shadow"
  available: boolean
  reason?: string
  outputDir: string | null
  updatedAt: string | null
  currentState: {
    fixtureId: string | null
    innings: number | null
    battingTeam: string | null
    bowlingTeam: string | null
    scoreRuns: number | null
    scoreWickets: number | null
    balls: number | null
  }
  predictions: {
    expectedRunsNow: number | null
    expectedWicketsNow: number | null
    runsDelta: number | null
    wicketsDelta: number | null
    finalInningsRuns: number | null
    finalInningsWickets: number | null
    remainingInningsRuns: number | null
    remainingInningsWickets: number | null
    chaseSuccessProbability: number | null
  }
  parity: {
    readyForInference: boolean | null
    featureMode: string | null
    missingCoreFeatures: unknown[]
    missingEventTrajectoryFeatures: unknown[]
    snapshotDiagnostics: Record<string, unknown> | null
  }
  summary: {
    inputRows: number | null
    scoredEntries: number | null
    targetScores: number | null
    rejectedRows: number | null
    targetScoreCounts: Record<string, unknown> | null
    notes: unknown[]
  }
  refresh: {
    status: "idle" | "running" | "skipped" | "succeeded" | "failed"
    ingestionStatus: "idle" | "unconfigured" | "running" | "succeeded" | "failed"
    lastAttemptAt: string | null
    lastSuccessAt: string | null
    lastError: string | null
    ingestionLastAttemptAt: string | null
    ingestionLastSuccessAt: string | null
    ingestionLastError: string | null
    ingestionSource: string | null
    ingestionIntervalMs: number
    eventJournalUpdatedAt: string | null
    shadowUpdatedAt: string | null
    autoRefreshIntervalMs: number
    autoRefreshEnabled: boolean
    remoteFetchEnabled: boolean
  }
  notes: string[]
}

type DashboardData = {
  ready: Record<string, unknown>
  fixtures: LiveModelFixture[]
  signals: LiveModelSignal[]
  history: LiveModelHistoryEntry[]
  ballStateShadow: BallStateShadow
}

let lastStableDashboardData: DashboardData | null = null

function LiveModelDashboard() {
  const liveModelQuery = useQuery({
    queryKey: ["live-model-dashboard"],
    queryFn: loadLiveModelDashboard,
    refetchInterval: 5_000,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  })

  const ready = liveModelQuery.data?.ready ?? null
  const fixtures = liveModelQuery.data?.fixtures ?? []
  const signals = liveModelQuery.data?.signals ?? []
  const history = liveModelQuery.data?.history ?? []
  const ballStateShadow = liveModelQuery.data?.ballStateShadow ?? null
  const updatedAt = liveModelQuery.dataUpdatedAt ? new Date(liveModelQuery.dataUpdatedAt) : null
  const error = liveModelQuery.error instanceof Error ? liveModelQuery.error.message : null
  const isRefreshing = liveModelQuery.isFetching && liveModelQuery.data !== undefined

  const leadFixture = fixtures[0]
  const aggregateEdge = useMemo(() => {
    const edges = fixtures.flatMap((fixture) => [fixture.home.edgeVsMarketBps, fixture.away.edgeVsMarketBps])
    const valid = edges.filter((edge): edge is number => edge !== null)
    return valid.length === 0 ? null : valid.reduce((sum, edge) => sum + Math.abs(edge), 0) / valid.length
  }, [fixtures])

  return (
    <main className="shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Experimental observer · isolated from deployed predictor</p>
          <h1>Live expected-state moneyline desk</h1>
          <p className="hero-copy">
            Track expected runs, expected wickets, Betfair-led fair probability, and Polymarket moneyline disagreement without touching production model artifacts.
          </p>
        </div>
        <div className="status-card">
          <span className="status-dot" />
          <span>{ready?.ready === true ? "Observer ready" : "Observer warming"}</span>
          <strong>{updatedAt ? `Last refreshed ${updatedAt.toLocaleTimeString()}` : "waiting"}</strong>
          <small>{isRefreshing ? "refreshing" : "synced"}</small>
        </div>
      </section>

      {error ? <div className="error-strip">{error}</div> : null}

      <section className="metric-grid">
        <Metric label="Tracked live models" value={fixtures.length.toString()} />
        <Metric label="Avg absolute edge" value={aggregateEdge === null ? "—" : `${Math.round(aggregateEdge)} bps`} />
        <Metric label="Recent signals" value={signals.length.toString()} />
        <Metric label="Shadow final runs" value={formatShadowRuns(ballStateShadow?.predictions.finalInningsRuns ?? null)} />
      </section>

      <BallStateShadowPanel shadow={ballStateShadow} />

      <section className="content-grid">
        <div className="fixture-stack">
          <div className="section-heading">
            <span>Live model board</span>
            <strong>{fixtures.length} fixtures</strong>
          </div>
          {fixtures.length === 0 ? (
            <EmptyState />
          ) : (
            fixtures.map((fixture) => <FixtureCard key={fixture.fixture.id} fixture={fixture} />)
          )}

          <div className="section-heading history-heading">
            <span>Historical tracking</span>
            <strong>{history.length} matches</strong>
          </div>
          {history.length === 0 ? (
            <div className="empty-state">
              <strong>No persisted match history yet</strong>
              <p>Run `pnpm db:migrate` and keep the observer running during matches to collect snapshots.</p>
            </div>
          ) : (
            history.map((entry) => <HistoryCard entry={entry} key={entry.fixture.id} />)
          )}
        </div>

        <aside className="signal-rail">
          <div className="section-heading">
            <span>Signal tape</span>
            <strong>latest</strong>
          </div>
          <div className="terms-card">
            <strong>Terms</strong>
            <p><b>Expected now</b> uses the experimental ball-by-ball model when shadow scores are available, otherwise it falls back to heuristic par.</p>
            <p><b>Actual delta</b> shows runs above/below par and wickets above/below par.</p>
            <p><b>Fair probability</b> is the Betfair-led reference price, not the deployed predictor.</p>
            <p><b>PM</b> is Polymarket moneyline probability.</p>
          </div>
          {signals.length === 0 ? (
            <p className="muted">No live-model signals have crossed the experimental threshold yet.</p>
          ) : (
            signals.map((signal) => (
              <article className="signal-card" key={signal.id}>
                <div>
                  <span>{signal.selection}</span>
                  <strong>{formatProbability(signal.modelProbability)}</strong>
                </div>
                <p>{signal.reason}</p>
                <small>fair edge {signal.edgeVsPolymarketBps ?? 0} bps · {signal.confidence}</small>
              </article>
            ))
          )}
        </aside>
      </section>
    </main>
  )
}

async function loadLiveModelDashboard() {
  const [readyResponse, fixtureResponse, signalResponse, historyResponse, shadowResponse] = await Promise.all([
    fetch("/ready"),
    fetch("/observer/live-model"),
    fetch("/observer/live-model/signals?limit=8"),
    fetch("/observer/live-model/history?limit=12"),
    fetch("/observer/ball-state-shadow"),
  ])

  if (!readyResponse.ok || !fixtureResponse.ok || !signalResponse.ok || !historyResponse.ok || !shadowResponse.ok) {
    throw new Error("Live model API is not available yet")
  }

  const [ready, fixtures, signals, history, ballStateShadow] = await Promise.all([
    readyResponse.json() as Promise<Record<string, unknown>>,
    fixtureResponse.json() as Promise<LiveModelFixture[]>,
    signalResponse.json() as Promise<LiveModelSignal[]>,
    historyResponse.json() as Promise<LiveModelHistoryEntry[]>,
    shadowResponse.json() as Promise<BallStateShadow>,
  ])

  const dashboard = mergeWithStableDashboardData({
    ready,
    fixtures: applyShadowExpectedStateToFixtures(fixtures, ballStateShadow),
    signals,
    history,
    ballStateShadow,
  })

  lastStableDashboardData = dashboard
  return dashboard
}

function applyShadowExpectedStateToFixtures(fixtures: LiveModelFixture[], shadow: BallStateShadow): LiveModelFixture[] {
  if (!shadow.available || !shadow.currentState.fixtureId) {
    return fixtures
  }

  return fixtures.map((fixture) => {
    if (fixture.fixture.id !== shadow.currentState.fixtureId) {
      return fixture
    }

    const expectedState = applyShadowExpectedState(fixture.expectedState, shadow)
    const inningsStates = fixture.inningsStates
      ? {
          ...fixture.inningsStates,
          first: fixture.inningsStates.first.innings === shadow.currentState.innings
            ? applyShadowExpectedState(fixture.inningsStates.first, shadow)
            : fixture.inningsStates.first,
          second: fixture.inningsStates.second.innings === shadow.currentState.innings
            ? applyShadowExpectedState(fixture.inningsStates.second, shadow)
            : fixture.inningsStates.second,
        }
      : fixture.inningsStates

    return {
      ...fixture,
      expectedState,
      inningsStates,
    }
  })
}

function applyShadowExpectedState<T extends ExpectedState>(state: T, shadow: BallStateShadow): T {
  if (state.innings !== shadow.currentState.innings || shadow.predictions.expectedRunsNow === null) {
    return state
  }

  return {
    ...state,
    expectedRunsNow: shadow.predictions.expectedRunsNow,
    expectedWicketsNow: shadow.predictions.expectedWicketsNow,
    runsDelta: shadow.predictions.runsDelta,
    wicketsDelta: shadow.predictions.wicketsDelta,
    projectedScore: shadow.predictions.finalInningsRuns ?? state.projectedScore,
  }
}

function mergeWithStableDashboardData(next: DashboardData): DashboardData {
  const previous = lastStableDashboardData

  if (!previous) {
    return next
  }

  return {
    ...next,
    ballStateShadow: next.ballStateShadow,
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
  if (previous.innings !== null && next.innings !== null && previous.innings !== next.innings) {
    return next
  }

  return {
    innings: next.innings ?? previous.innings,
    battingTeam: next.battingTeam ?? previous.battingTeam,
    bowlingTeam: next.bowlingTeam ?? previous.bowlingTeam,
    scoreRuns: next.scoreRuns ?? previous.scoreRuns,
    scoreWickets: next.scoreWickets ?? previous.scoreWickets,
    overs: next.overs ?? previous.overs,
    expectedRunsNow: next.expectedRunsNow ?? previous.expectedRunsNow,
    expectedWicketsNow: next.expectedWicketsNow ?? previous.expectedWicketsNow,
    runsDelta: next.runsDelta ?? previous.runsDelta,
    wicketsDelta: next.wicketsDelta ?? previous.wicketsDelta,
    projectedScore: next.projectedScore ?? previous.projectedScore,
    expectedRunRate: next.expectedRunRate ?? previous.expectedRunRate,
  }
}

function mergeInningsStates(previous: InningsStates | undefined, next: InningsStates | undefined) {
  if (!previous) {
    return next
  }

  if (!next) {
    return previous
  }

  return {
    ...next,
    first: mergeInningsState(previous.first, next.first),
    second: mergeInningsState(previous.second, next.second),
  }
}

function mergeInningsState(previous: InningsExpectedState, next: InningsExpectedState): InningsExpectedState {
  if (next.status === "unavailable" || next.status === "pending") {
    return next
  }

  return {
    ...mergeExpectedState(previous, next),
    status: next.status,
  }
}

function BallStateShadowPanel({ shadow }: { shadow: BallStateShadow | null }) {
  if (!shadow || !shadow.available) {
    return (
      <section className="shadow-panel shadow-unavailable">
        <div>
          <span className="eyebrow">Experimental ball-by-ball model</span>
          <h2>Shadow scorer waiting for a live run</h2>
          <p>{shadow?.reason ?? "No ball-state shadow output has been exposed yet."}</p>
          {shadow?.refresh.ingestionLastError ? <p className="shadow-error">Ingestion: {shadow.refresh.ingestionLastError}</p> : null}
          {shadow?.refresh.lastError ? <p className="shadow-error">{shadow.refresh.lastError}</p> : null}
        </div>
      </section>
    )
  }

  const state = shadow.currentState
  const predictions = shadow.predictions
  const diagnostics = shadow.parity.snapshotDiagnostics
  const refresh = shadow.refresh
  const coverage = typeof diagnostics?.snapshot_exact_coverage_balls === "number"
    ? `${diagnostics.snapshot_exact_coverage_balls} balls covered`
    : "coverage unavailable"

  return (
    <section className="shadow-panel">
      <header className="shadow-header">
        <div>
          <span className="eyebrow">Experimental ball-by-ball shadow model</span>
          <h2>{state.battingTeam ?? "Batting side"} innings projection</h2>
          <p>
            Read-only output from <code>{shadow.outputDir}</code>. This is the no-paid ball-by-ball model, separate from the heuristic observer expected-state view.
          </p>
        </div>
        <div className="shadow-status">
          <strong>{refresh.status}</strong>
          <span>{shadow.parity.featureMode ?? "feature mode pending"} · ingest {refresh.ingestionStatus}</span>
        </div>
      </header>

      <div className="shadow-grid">
        <State label="Current score" value={formatShadowScore(state.scoreRuns, state.scoreWickets, state.balls)} tone="live" />
        <State label="Model expected now" value={formatScoreExpectation(predictions.expectedRunsNow, predictions.expectedWicketsNow)} tone="live" />
        <State label="Model actual delta" value={formatDelta(predictions.runsDelta, predictions.wicketsDelta)} />
        <State label="Projected final runs" value={formatShadowRuns(predictions.finalInningsRuns)} tone="live" />
        <State label="Projected final wickets" value={formatShadowWickets(predictions.finalInningsWickets)} />
        <State label="Remaining runs" value={formatShadowRuns(predictions.remainingInningsRuns)} />
        <State label="Remaining wickets" value={formatShadowWickets(predictions.remainingInningsWickets)} />
        <State label="Chase success" value={formatPercent(predictions.chaseSuccessProbability)} />
        <State label="Snapshot coverage" value={coverage} />
        <State label="Shadow updated" value={shadow.updatedAt ? new Date(shadow.updatedAt).toLocaleTimeString() : "—"} />
        <State label="Event journal" value={refresh.eventJournalUpdatedAt ? new Date(refresh.eventJournalUpdatedAt).toLocaleTimeString() : "—"} />
        <State label="Event ingestion" value={formatIngestionStatus(refresh)} />
        <State label="Ingestion source" value={formatIngestionSource(refresh.ingestionSource)} />
        <State label="Auto refresh" value={refresh.autoRefreshEnabled ? `${Math.round(refresh.autoRefreshIntervalMs / 1000)}s · ${refresh.status}` : "disabled"} />
      </div>
      {refresh.ingestionLastError ? <p className="shadow-error">Ingestion: {refresh.ingestionLastError}</p> : null}
      {refresh.lastError ? <p className="shadow-error">{refresh.lastError}</p> : null}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function FixtureCard({ fixture }: { fixture: LiveModelFixture }) {
  const state = fixture.expectedState
  const inningsStates = fixture.inningsStates ?? toFallbackInningsStates(state)
  return (
    <article className="fixture-card">
      <header>
        <div>
          <p>{fixture.fixture.venueName ?? "Venue pending"}</p>
          <h2>{fixture.fixture.homeTeam} <span>vs</span> {fixture.fixture.awayTeam}</h2>
        </div>
        <div className="score-pill">{fixture.fixture.score ?? "score pending"}</div>
      </header>

      <div className="innings-grid">
        <InningsPanel title="First innings" innings={inningsStates.first} />
        <InningsPanel title="Second innings" innings={inningsStates.second} />
      </div>

      <VenueContextPanel venueContext={fixture.venueContext} />

      <div className="side-row">
        <SideProbability side={fixture.home} />
        <SideProbability side={fixture.away} />
      </div>
    </article>
  )
}

function InningsPanel({ title, innings }: { title: string; innings: InningsExpectedState }) {
  const pendingCopy = innings.status === "pending"
    ? innings.innings === 2
      ? "Awaiting chase data"
      : "Awaiting innings data"
    : innings.status === "unavailable"
      ? "Not available yet"
      : null

  return (
    <section className={`innings-panel ${innings.status}`}>
      <header>
        <div>
          <span>{title}</span>
          <strong>{formatInningsStatus(innings.status)}</strong>
        </div>
        <small>{innings.battingTeam ?? "batting team unavailable"}</small>
      </header>
      {pendingCopy ? <p className="innings-pending">{pendingCopy}</p> : null}
      {pendingCopy ? null : (
        <div className="state-grid innings-state-grid">
          <State label="Actual score" value={formatActualScore(innings)} tone={innings.status === "live" ? "live" : "default"} />
          <State label="Expected now" value={formatScoreExpectation(innings.expectedRunsNow, innings.expectedWicketsNow)} />
          <State label="Actual delta" value={formatDelta(innings.runsDelta, innings.wicketsDelta)} />
          <State label="Projected innings" value={innings.projectedScore === null ? "—" : `${innings.projectedScore.toFixed(0)} runs`} />
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
  const hasStructuredHistory = Boolean(
    inningsSnapshots.first ||
      inningsSnapshots.second ||
      hasHistoricalInningsState(stateSnapshots?.first) ||
      hasHistoricalInningsState(stateSnapshots?.second),
  )
  return (
    <article className="history-card">
      <header>
        <div>
          <p>{entry.fixture.status} · {entry.fixture.venueName ?? "venue pending"}</p>
          <h3>{entry.fixture.homeTeam} <span>vs</span> {entry.fixture.awayTeam}</h3>
        </div>
        <div className="history-score">{entry.fixture.score ?? "score pending"}</div>
      </header>
      {hasStructuredHistory ? (
        <div className="innings-grid">
          <SnapshotInningsPanel title="First innings" snapshot={inningsSnapshots.first} fallbackState={stateSnapshots?.first} />
          <SnapshotInningsPanel title="Second innings" snapshot={inningsSnapshots.second} fallbackState={stateSnapshots?.second} />
        </div>
      ) : (
        <LegacySnapshotPanel snapshot={snapshot} />
      )}
      <div className="history-grid">
        <State label="Last tracked" value={snapshot ? new Date(snapshot.createdAt).toLocaleString() : "—"} />
        <State label="Signals" value={entry.signalCount.toString()} />
      </div>
      <VenueContextPanel venueContext={entry.venueContext} compact />
    </article>
  )
}

function LegacySnapshotPanel({ snapshot }: { snapshot: LiveModelSnapshot | null }) {
  if (!snapshot) {
    return null
  }

  return (
    <section className="innings-panel frozen legacy">
      <header>
        <div>
          <span>Legacy tracked state</span>
          <strong>{new Date(snapshot.createdAt).toLocaleString()}</strong>
        </div>
        <small>innings unavailable in older snapshot</small>
      </header>
      <div className="state-grid innings-state-grid">
        <State label="Actual score" value={formatSnapshotActualScore(snapshot)} />
        <State label="Expected now" value={formatScoreExpectation(snapshot.expectedRunsNow, snapshot.expectedWicketsNow)} />
        <State label="Actual delta" value={formatDelta(snapshot.runsDelta, snapshot.wicketsDelta)} />
        <State label="Projected innings" value={snapshot.projectedScore === null ? "—" : `${snapshot.projectedScore.toFixed(0)} runs`} />
      </div>
    </section>
  )
}

function SnapshotInningsPanel({
  title,
  snapshot,
  fallbackState,
}: {
  title: string
  snapshot: LiveModelSnapshot | null
  fallbackState?: InningsExpectedState
}) {
  if (!snapshot) {
    const historicalState = hasHistoricalInningsState(fallbackState) ? fallbackState : null

    if (historicalState) {
      return <InningsPanel title={title} innings={historicalState} />
    }

    return (
      <section className="innings-panel unavailable">
        <header>
          <div>
            <span>{title}</span>
            <strong>innings data unavailable</strong>
          </div>
        </header>
        <p className="innings-pending">Older snapshot format; innings-specific split was not persisted.</p>
      </section>
    )
  }

  return (
    <section className="innings-panel frozen">
      <header>
        <div>
          <span>{title}</span>
          <strong>{new Date(snapshot.createdAt).toLocaleString()}</strong>
        </div>
        <small>{snapshot.battingTeam ?? "batting team unavailable"}</small>
      </header>
      <div className="state-grid innings-state-grid">
        <State label="Actual score" value={formatSnapshotActualScore(snapshot)} />
        <State label="Expected now" value={formatScoreExpectation(snapshot.expectedRunsNow, snapshot.expectedWicketsNow)} />
        <State label="Actual delta" value={formatDelta(snapshot.runsDelta, snapshot.wicketsDelta)} />
        <State label="Projected innings" value={snapshot.projectedScore === null ? "—" : `${snapshot.projectedScore.toFixed(0)} runs`} />
      </div>
    </section>
  )
}

function hasHistoricalInningsState(state: InningsExpectedState | undefined): state is InningsExpectedState {
  if (!state || state.status === "pending" || state.status === "unavailable") {
    return false
  }

  return state.scoreRuns !== null ||
    state.scoreWickets !== null ||
    state.overs !== null ||
    state.expectedRunsNow !== null ||
    state.expectedWicketsNow !== null ||
    state.runsDelta !== null ||
    state.wicketsDelta !== null ||
    state.projectedScore !== null
}

function SideProbability({ side }: { side: LiveModelSide }) {
  return (
    <div className="side-card">
      <span>{side.team}</span>
      <strong>{formatProbability(side.fairProbability)}</strong>
      <small>Fair probability · PM {formatProbability(side.marketProbability)} · edge {side.edgeVsMarketBps ?? "—"} bps</small>
    </div>
  )
}

function VenueContextPanel({ venueContext, compact = false }: { venueContext: VenueContext | null; compact?: boolean }) {
  if (!venueContext) {
    return null
  }

  const seasons = venueContext.seasons.first && venueContext.seasons.last
    ? `${venueContext.seasons.first}-${venueContext.seasons.last}`
    : "all seasons"

  return (
    <div className={compact ? "venue-context compact" : "venue-context"}>
      <div>
        <span>Venue context</span>
        <strong>{venueContext.venue}</strong>
        <small>{venueContext.matchCount} completed IPL matches · {seasons} · historical averages</small>
      </div>
      <State label="Avg 1st inns" value={formatRuns(venueContext.avgFirstInningsScore)} />
      <State label="Avg 2nd inns" value={formatRuns(venueContext.avgSecondInningsScore)} />
      <State label="Avg defended score" value={formatRuns(venueContext.avgFirstInningsWinningScore)} />
      <State label="Avg successful chase" value={formatRuns(venueContext.avgChaseWinningScore)} />
      <State label="Bat first wins" value={formatPercent(venueContext.battingFirstWinPct)} />
      <State label="Chasing wins" value={formatPercent(venueContext.chasingWinPct)} tone="live" />
    </div>
  )
}

function State({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "live" }) {
  return (
    <div className={tone === "live" ? "state-card is-live" : "state-card"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="empty-state">
      <strong>No live fixture model yet</strong>
      <p>The board will populate when OpticOdds fixture state and Polymarket moneyline books are active.</p>
    </div>
  )
}

function toFallbackInningsStates(state: ExpectedState): InningsStates {
  const fallback = { ...state, status: state.innings === null ? "unavailable" : "live" } as InningsExpectedState
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
    status: "unavailable",
  })

  return {
    activeInnings: state.innings,
    first: state.innings === 1 ? fallback : blank(1),
    second: state.innings === 2 ? fallback : blank(2),
  }
}

function formatInningsStatus(status: InningsExpectedState["status"]) {
  switch (status) {
    case "live":
      return "live"
    case "frozen":
      return "final / frozen"
    case "pending":
      return "pending"
    default:
      return "not started"
  }
}

function formatProbability(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 1000) / 10}%`
}

function formatShadowRuns(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)} runs`
}

function formatShadowWickets(value: number | null) {
  return value === null ? "—" : `${value.toFixed(2)} wkts`
}

function formatShadowScore(runs: number | null, wickets: number | null, balls: number | null) {
  const score = runs === null && wickets === null ? "—" : `${runs ?? "—"}/${wickets ?? "—"}`
  return balls === null ? score : `${score} · ${Math.floor(balls / 6)}.${balls % 6} ov`
}

function formatIngestionStatus(refresh: BallStateShadow["refresh"]) {
  if (refresh.ingestionStatus === "unconfigured") {
    return "source not configured"
  }

  const lastSuccess = refresh.ingestionLastSuccessAt
    ? new Date(refresh.ingestionLastSuccessAt).toLocaleTimeString()
    : null
  const cadence = `${Math.round(refresh.ingestionIntervalMs / 1000)}s`
  return lastSuccess ? `${refresh.ingestionStatus} · ${lastSuccess} · ${cadence}` : `${refresh.ingestionStatus} · ${cadence}`
}

function formatIngestionSource(source: string | null) {
  if (!source) {
    return "not configured"
  }

  if (source === "saved-html-dir" || source.startsWith("saved-html-dir:")) {
    return "saved HTML dir"
  }

  if (source === "saved-html" || source.startsWith("saved-html:")) {
    return "saved HTML file"
  }

  try {
    return new URL(source).hostname
  } catch {
    return source
  }
}

function formatScoreExpectation(runs: number | null, wickets: number | null) {
  if (runs === null && wickets === null) return "—"
  return `${runs?.toFixed(0) ?? "—"}/${wickets?.toFixed(1) ?? "—"}`
}

function formatActualScore(state: ExpectedState) {
  if (state.scoreRuns === null && state.scoreWickets === null) return "—"
  const score = state.scoreWickets === null
    ? `${state.scoreRuns ?? "—"} runs · wickets unavailable`
    : `${state.scoreRuns ?? "—"}/${state.scoreWickets}`
  return state.overs === null ? score : `${score} in ${state.overs} ov`
}

function formatSnapshotActualScore(snapshot: LiveModelSnapshot | null) {
  if (!snapshot || (snapshot.scoreRuns === null && snapshot.scoreWickets === null)) return "—"
  const score = snapshot.scoreWickets === null
    ? `${snapshot.scoreRuns ?? "—"} runs · wickets unavailable`
    : `${snapshot.scoreRuns ?? "—"}/${snapshot.scoreWickets}`
  return snapshot.overs === null ? score : `${score} in ${snapshot.overs} ov`
}

function formatDelta(runs: number | null, wickets: number | null) {
  if (runs === null && wickets === null) return "—"
  const runText = runs === null ? "runs —" : `${runs > 0 ? "+" : ""}${runs.toFixed(1)}r`
  const wicketText = wickets === null ? "wickets unavailable" : `${wickets > 0 ? "+" : ""}${wickets.toFixed(1)}w`
  return `${runText} / ${wicketText}`
}

function formatRuns(value: number | null) {
  return value === null ? "—" : `${Math.round(value)} runs`
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 1000) / 10}%`
}
