import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/predictor')({
  component: PredictorPage,
})

type PredictorMode = 'pre_toss' | 'post_toss'
type InputMode = 'auto' | 'manual'

type Fixture = {
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

type ContextPayload = {
  automatic?: Record<string, boolean | undefined>
  automatic_details?: Record<string, { message?: string | undefined } | undefined>
  live_feature_refresh?: { applied?: boolean | undefined } | undefined
  manual_input_recommendation?: { message?: string | undefined } | undefined
  probable_xi_suggestions?: {
    team1?: TeamSuggestion | undefined
    team2?: TeamSuggestion | undefined
  } | undefined
  notes?: {
    pre_toss?: string[] | undefined
    post_toss?: string[] | undefined
  } | undefined
}

type TeamSuggestion = {
  available?: boolean | undefined
  suggested_xi?: string[] | undefined
  candidate_pool?: PlayerCandidate[] | undefined
}

type PlayerCandidate = {
  name: string
  role?: string | undefined
  batting_order_estimate?: number | undefined
  recent_appearances?: number | undefined
  suggested?: boolean | undefined
  is_key_batter?: boolean | undefined
  is_key_bowler?: boolean | undefined
  is_death_bowler?: boolean | undefined
  is_opener?: boolean | undefined
}

type PredictionPayload = {
  mode?: PredictorMode
  predicted_winner?: string
  team1?: string
  team2?: string
  team1_win_probability?: number
  team2_win_probability?: number
  fair_price_team1_cents?: number
  fair_price_team2_cents?: number
  fixture_status?: string
  components?: Array<{ component?: string; weight?: number; probability?: number }>
  elo_context?: {
    team1_elo?: number
    team2_elo?: number
    elo_gap?: number
    elo_expected_team1_win?: number
  }
  official_post_toss_applied?: boolean
  probable_xi_applied?: boolean
  probable_xi_source?: string
  manual_probable_xi_applied?: boolean
  official_post_toss_context?: {
    team1_confirmed_xi?: string[]
    team2_confirmed_xi?: string[]
  }
  market_overlay?: {
    team1_market_probability?: number
    team1_edge_vs_market?: number
    liquidity?: number
    volume?: number
  } | null
  sportsbook_overlay?: {
    consensus_team1_probability?: number
    team1_edge_vs_consensus?: number
    books?: Array<{
      sportsbook?: string
      team1_probability?: number
      team2_probability?: number
      team1_max_stake?: number
      team2_max_stake?: number
    }>
  } | null
}

type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }

type ManualState = {
  tossWinner: string
  tossDecision: string
  team1Players: string[]
  team2Players: string[]
  featureOverrides: FeatureOverrideState
}

type FeatureOverrideState = {
  team1_probableXiStrength: string
  team2_probableXiStrength: string
  team1_xiContinuityScore: string
  team2_xiContinuityScore: string
  team1_missingKeyBatterCount: string
  team2_missingKeyBatterCount: string
  team1_missingKeyBowlerCount: string
  team2_missingKeyBowlerCount: string
  team1_missingOpenerFlag: boolean
  team2_missingOpenerFlag: boolean
  team1_missingDeathBowlerFlag: boolean
  team2_missingDeathBowlerFlag: boolean
}

const shortDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const emptyFeatureOverrides = (): FeatureOverrideState => ({
  team1_probableXiStrength: '',
  team2_probableXiStrength: '',
  team1_xiContinuityScore: '',
  team2_xiContinuityScore: '',
  team1_missingKeyBatterCount: '',
  team2_missingKeyBatterCount: '',
  team1_missingKeyBowlerCount: '',
  team2_missingKeyBowlerCount: '',
  team1_missingOpenerFlag: false,
  team2_missingOpenerFlag: false,
  team1_missingDeathBowlerFlag: false,
  team2_missingDeathBowlerFlag: false,
})

const emptyManualState = (): ManualState => ({
  tossWinner: '',
  tossDecision: '',
  team1Players: [],
  team2Players: [],
  featureOverrides: emptyFeatureOverrides(),
})

export function PredictorPage() {
  const [fixturesState, setFixturesState] = useState<AsyncState<Fixture[]>>({ status: 'idle' })
  const [contextState, setContextState] = useState<AsyncState<ContextPayload>>({ status: 'idle' })
  const [predictionState, setPredictionState] = useState<AsyncState<PredictionPayload>>({ status: 'idle' })
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<PredictorMode>('pre_toss')
  const [inputMode, setInputMode] = useState<InputMode>('auto')
  const [manual, setManual] = useState<ManualState>(() => emptyManualState())

  const fixtures = fixturesState.status === 'success' ? fixturesState.data : []
  const selectedFixture = fixtures.find((fixture) => fixture.fixture_id === selectedFixtureId) ?? null
  const context = contextState.status === 'success' ? contextState.data : null
  const prediction = predictionState.status === 'success' ? predictionState.data : null

  const filteredFixtures = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return sortFixtures(fixtures).filter((fixture) => {
      if (!normalized) {
        return true
      }
      return [fixture.team1, fixture.team2, fixture.venue, fixture.city].some((value) => String(value ?? '').toLowerCase().includes(normalized))
    })
  }, [fixtures, query])

  useEffect(() => {
    void loadFixtures()
  }, [])

  useEffect(() => {
    if (!selectedFixture) {
      return
    }
    setMode(Boolean(selectedFixture.is_live) ? 'post_toss' : 'pre_toss')
    setManual(emptyManualState())
    setPredictionState({ status: 'idle' })
  }, [selectedFixture?.fixture_id])

  useEffect(() => {
    if (!selectedFixture) {
      setContextState({ status: 'idle' })
      return
    }
    void loadContext(selectedFixture.fixture_id, mode)
  }, [selectedFixture?.fixture_id, mode])

  async function loadFixtures() {
    setFixturesState({ status: 'loading' })
    try {
      const data = await fetchJson<Fixture[]>('/api/predictor/fixtures')
      setFixturesState({ status: 'success', data })
      setSelectedFixtureId((current) => current ?? sortFixtures(data)[0]?.fixture_id ?? null)
    } catch (error) {
      setFixturesState({ status: 'error', message: messageForError(error) })
    }
  }

  async function loadContext(fixtureId: string, nextMode: PredictorMode) {
    setContextState({ status: 'loading' })
    try {
      const data = await fetchJson<ContextPayload>('/api/predictor/context', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fixtureId, mode: nextMode }),
      })
      setContextState({ status: 'success', data })
      const autoReady = isAutoInputAvailable(data, nextMode)
      setInputMode(autoReady ? 'auto' : 'manual')
      setManual((current) => ({
        ...current,
        team1Players: current.team1Players.length ? current.team1Players : data.probable_xi_suggestions?.team1?.suggested_xi ?? [],
        team2Players: current.team2Players.length ? current.team2Players : data.probable_xi_suggestions?.team2?.suggested_xi ?? [],
      }))
    } catch (error) {
      setContextState({ status: 'error', message: messageForError(error) })
      setInputMode('manual')
    }
  }

  async function runPrediction() {
    if (!selectedFixture) {
      return
    }

    setPredictionState({ status: 'loading' })
    try {
      const body: Record<string, unknown> = {
        fixtureId: selectedFixture.fixture_id,
        mode,
      }
      if (inputMode === 'manual') {
        if (mode === 'post_toss') {
          if (manual.tossWinner) {
            body.tossWinner = manual.tossWinner
          }
          if (manual.tossDecision) {
            body.tossDecision = manual.tossDecision
          }
        }
        const featureOverrides = buildFeatureOverrides(manual.featureOverrides)
        if (Object.keys(featureOverrides).length) {
          body.featureOverrides = featureOverrides
        }
      }

      const team1Players = inputMode === 'auto'
        ? context?.probable_xi_suggestions?.team1?.suggested_xi ?? []
        : manual.team1Players
      const team2Players = inputMode === 'auto'
        ? context?.probable_xi_suggestions?.team2?.suggested_xi ?? []
        : manual.team2Players

      if (inputMode === 'manual' && team1Players.length > 0 && team1Players.length !== 11) {
        throw new Error('Team 1 manual XI must contain exactly 11 players before running the model.')
      }
      if (inputMode === 'manual' && team2Players.length > 0 && team2Players.length !== 11) {
        throw new Error('Team 2 manual XI must contain exactly 11 players before running the model.')
      }
      if (team1Players.length === 11) {
        body.team1ProbableXi = team1Players
      }
      if (team2Players.length === 11) {
        body.team2ProbableXi = team2Players
      }
      if (team1Players.length === 11 || team2Players.length === 11) {
        body.probableXiSource = inputMode === 'manual' ? 'manual' : 'suggested'
      }

      const data = await fetchJson<PredictionPayload>('/api/predictor/predict', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      setPredictionState({ status: 'success', data })
    } catch (error) {
      setPredictionState({ status: 'error', message: messageForError(error) })
    }
  }

  return (
    <main className="shell predictor-shell">
      <header className="topbar panel">
        <div className="topbar-copy">
          <p className="eyebrow">IPL prediction workspace</p>
          <h1>Match Edge Console</h1>
          <p className="subdued">Run the production model from the new TanStack Start app while preserving the existing backend predictor APIs.</p>
        </div>
        <div className="topbar-controls">
          <button type="button" onClick={() => void loadFixtures()} disabled={fixturesState.status === 'loading'}>Refresh fixtures</button>
        </div>
      </header>

      <section className="page-grid">
        <aside className="panel sidebar-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Fixture queue</p>
              <h2>Select a match</h2>
            </div>
            <span className="pill">{filteredFixtures.length}</span>
          </div>
          <input className="search" type="search" placeholder="Search team, venue, or city" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="stacked-list fixture-list">
            {fixturesState.status === 'loading' ? <EmptyState message="Loading fixtures…" /> : null}
            {fixturesState.status === 'error' ? <EmptyState message={fixturesState.message} tone="error" /> : null}
            {fixturesState.status === 'success' && filteredFixtures.length === 0 ? <EmptyState message="No fixtures match your search." /> : null}
            {filteredFixtures.map((fixture) => (
              <button
                className={`fixture-card ${fixture.fixture_id === selectedFixtureId ? 'active' : ''} ${isCompletedFixture(fixture) ? 'fixture-card-completed' : ''}`}
                type="button"
                key={fixture.fixture_id}
                onClick={() => setSelectedFixtureId(fixture.fixture_id)}
              >
                <span className="detail-label">{formatShortDate(fixture.match_date)}</span>
                <strong>{fixture.team1} vs {fixture.team2}</strong>
                <span>{summarizeVenue(fixture)} · {formatFixtureStatus(fixture)}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="main-column">
          <article className="panel form-panel command-panel">
            <div className="panel-header command-header">
              <div>
                <p className="eyebrow">Match briefing</p>
                <h2>{selectedFixture ? `${selectedFixture.team1} vs ${selectedFixture.team2}` : 'Select a fixture'}</h2>
              </div>
              <span className={`pill ${predictionState.status === 'success' ? 'success' : ''}`}>{predictionStatus(predictionState.status)}</span>
            </div>

            {selectedFixture ? (
              <div className="selected-fixture detail-grid">
                <Detail label="Start time" value={formatShortDate(selectedFixture.match_date)} />
                <Detail label="Venue" value={selectedFixture.venue ?? 'Unknown venue'} />
                <Detail label="City" value={selectedFixture.city ?? 'Unknown city'} />
                <Detail label="State" value={formatFixtureStatus(selectedFixture)} highlight={Boolean(selectedFixture.is_live)} />
                <Detail label="Home context" value={selectedFixture.team1_home_context ?? 'Neutral'} />
                <Detail label="Fixture ID" value={selectedFixture.fixture_id} />
              </div>
            ) : <EmptyState message="Pick a fixture to load context." />}

            <div className="form-grid">
              <label className="field">
                <span>Prediction mode</span>
                <select value={mode} onChange={(event) => setMode(event.target.value as PredictorMode)} disabled={!selectedFixture}>
                  <option value="pre_toss">Pre toss</option>
                  <option value="post_toss">Post toss</option>
                </select>
              </label>
              <label className="field">
                <span>Input source</span>
                <select value={inputMode} onChange={(event) => setInputMode(event.target.value as InputMode)} disabled={!selectedFixture}>
                  <option value="auto">Auto</option>
                  <option value="manual">Manual</option>
                </select>
              </label>
            </div>

            <ContextPanel state={contextState} mode={mode} />
            {inputMode === 'manual' && selectedFixture ? (
              <ManualPanel fixture={selectedFixture} context={context} manual={manual} setManual={setManual} mode={mode} />
            ) : null}
            <button className="primary run-button" type="button" onClick={() => void runPrediction()} disabled={!selectedFixture || predictionState.status === 'loading'}>
              {predictionState.status === 'loading' ? 'Running model…' : 'Run prediction'}
            </button>
          </article>

          <PredictionPanel state={predictionState} prediction={prediction} />
        </section>
      </section>
    </main>
  )
}

function ContextPanel({ state, mode }: { state: AsyncState<ContextPayload>; mode: PredictorMode }) {
  if (state.status === 'idle') {
    return <EmptyState message="Context will load after you select a fixture." />
  }
  if (state.status === 'loading') {
    return <EmptyState message="Loading context and availability…" />
  }
  if (state.status === 'error') {
    return <EmptyState message={state.message} tone="error" />
  }

  const automatic = state.data.automatic ?? {}
  const notes = [...(state.data.notes?.pre_toss ?? []), ...(state.data.notes?.post_toss ?? [])]
  const autoReady = isAutoInputAvailable(state.data, mode)

  return (
    <section className="briefing-panel">
      <div className="panel-header compact-header">
        <div>
          <p className="eyebrow">Critical data state</p>
          <h3>{autoReady ? 'Automatic path is ready' : 'Manual assumptions may be needed'}</h3>
        </div>
      </div>
      <div className="summary-grid summary-grid-tight">
        <MetricCard label="Fixture shell" value={automatic.fixture_shell ? 'Loaded' : 'Missing'} positive={automatic.fixture_shell} />
        <MetricCard label="Current Elo" value={automatic.current_elo ? 'Loaded' : 'Missing'} positive={automatic.current_elo} />
        <MetricCard label="Form refresh" value={state.data.live_feature_refresh?.applied ? 'Applied' : 'Historical'} positive={state.data.live_feature_refresh?.applied} />
        <MetricCard label="Sportsbooks" value={automatic.sportsbook_overlay ? 'Loaded' : 'Missing'} positive={automatic.sportsbook_overlay} />
        <MetricCard label="Polymarket" value={automatic.polymarket_overlay ? 'Loaded' : 'Missing'} positive={automatic.polymarket_overlay} />
        <MetricCard label="Official toss" value={automatic.official_toss ? 'Loaded' : 'Missing'} positive={automatic.official_toss} />
        <MetricCard label="Official XI" value={automatic.official_confirmed_xi ? 'Loaded' : 'Missing'} positive={automatic.official_confirmed_xi} />
      </div>
      <div className="stacked-list compact">
        {(notes.length ? notes : [state.data.manual_input_recommendation?.message ?? 'No extra availability notes for this fixture.']).map((note) => (
          <div className="notice-banner subtle" key={note}>{note}</div>
        ))}
      </div>
    </section>
  )
}

function ManualPanel({ fixture, context, manual, setManual, mode }: { fixture: Fixture; context: ContextPayload | null; manual: ManualState; setManual: (next: ManualState | ((current: ManualState) => ManualState)) => void; mode: PredictorMode }) {
  const team1Suggestion = context?.probable_xi_suggestions?.team1
  const team2Suggestion = context?.probable_xi_suggestions?.team2
  return (
    <section className="override-section">
      <div className="panel-header compact-header">
        <div>
          <p className="eyebrow">Manual context</p>
          <h3>Override only what you trust more than the feeds</h3>
        </div>
        <span className="pill success">Manual inputs active</span>
      </div>
      {mode === 'post_toss' ? (
        <div className="form-grid">
          <label className="field">
            <span>Toss winner</span>
            <select value={manual.tossWinner} onChange={(event) => setManual((current) => ({ ...current, tossWinner: event.target.value }))}>
              <option value="">Use automatic source</option>
              <option value={fixture.team1}>{fixture.team1}</option>
              <option value={fixture.team2}>{fixture.team2}</option>
            </select>
          </label>
          <label className="field">
            <span>Toss decision</span>
            <select value={manual.tossDecision} onChange={(event) => setManual((current) => ({ ...current, tossDecision: event.target.value }))}>
              <option value="">Use automatic source</option>
              <option value="bat">Bat first</option>
              <option value="field">Field first</option>
            </select>
          </label>
        </div>
      ) : null}
      <div className="probable-xi-grid">
        <ProbableXiPicker
          title={fixture.team1}
          suggestion={team1Suggestion}
          selected={manual.team1Players}
          onChange={(players) => setManual((current) => ({ ...current, team1Players: players }))}
        />
        <ProbableXiPicker
          title={fixture.team2}
          suggestion={team2Suggestion}
          selected={manual.team2Players}
          onChange={(players) => setManual((current) => ({ ...current, team2Players: players }))}
        />
      </div>
      <FeatureOverridePanel
        team1={fixture.team1}
        team2={fixture.team2}
        value={manual.featureOverrides}
        onChange={(featureOverrides) => setManual((current) => ({ ...current, featureOverrides }))}
      />
    </section>
  )
}

function FeatureOverridePanel({ team1, team2, value, onChange }: { team1: string; team2: string; value: FeatureOverrideState; onChange: (next: FeatureOverrideState) => void }) {
  const setText = (key: keyof FeatureOverrideState, nextValue: string) => {
    onChange({ ...value, [key]: nextValue })
  }
  const setFlag = (key: keyof FeatureOverrideState, nextValue: boolean) => {
    onChange({ ...value, [key]: nextValue })
  }

  return (
    <section className="briefing-panel">
      <div className="panel-header compact-header">
        <div>
          <p className="eyebrow">Feature overrides</p>
          <h3>Use only when your manual read is stronger than the feed</h3>
        </div>
      </div>
      <div className="form-grid">
        <NumericOverride label={`${team1} XI strength`} value={value.team1_probableXiStrength} onChange={(nextValue) => setText('team1_probableXiStrength', nextValue)} />
        <NumericOverride label={`${team2} XI strength`} value={value.team2_probableXiStrength} onChange={(nextValue) => setText('team2_probableXiStrength', nextValue)} />
        <NumericOverride label={`${team1} XI continuity`} value={value.team1_xiContinuityScore} onChange={(nextValue) => setText('team1_xiContinuityScore', nextValue)} />
        <NumericOverride label={`${team2} XI continuity`} value={value.team2_xiContinuityScore} onChange={(nextValue) => setText('team2_xiContinuityScore', nextValue)} />
        <NumericOverride label={`${team1} missing key batters`} value={value.team1_missingKeyBatterCount} onChange={(nextValue) => setText('team1_missingKeyBatterCount', nextValue)} />
        <NumericOverride label={`${team2} missing key batters`} value={value.team2_missingKeyBatterCount} onChange={(nextValue) => setText('team2_missingKeyBatterCount', nextValue)} />
        <NumericOverride label={`${team1} missing key bowlers`} value={value.team1_missingKeyBowlerCount} onChange={(nextValue) => setText('team1_missingKeyBowlerCount', nextValue)} />
        <NumericOverride label={`${team2} missing key bowlers`} value={value.team2_missingKeyBowlerCount} onChange={(nextValue) => setText('team2_missingKeyBowlerCount', nextValue)} />
      </div>
      <div className="form-grid">
        <FlagOverride label={`${team1} missing opener`} checked={value.team1_missingOpenerFlag} onChange={(nextValue) => setFlag('team1_missingOpenerFlag', nextValue)} />
        <FlagOverride label={`${team2} missing opener`} checked={value.team2_missingOpenerFlag} onChange={(nextValue) => setFlag('team2_missingOpenerFlag', nextValue)} />
        <FlagOverride label={`${team1} missing death bowler`} checked={value.team1_missingDeathBowlerFlag} onChange={(nextValue) => setFlag('team1_missingDeathBowlerFlag', nextValue)} />
        <FlagOverride label={`${team2} missing death bowler`} checked={value.team2_missingDeathBowlerFlag} onChange={(nextValue) => setFlag('team2_missingDeathBowlerFlag', nextValue)} />
      </div>
    </section>
  )
}

function NumericOverride({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" step="0.01" value={value} placeholder="Auto" onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function FlagOverride({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="field checkbox-field">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

function ProbableXiPicker({ title, suggestion, selected, onChange }: { title: string; suggestion?: TeamSuggestion | undefined; selected: string[]; onChange: (players: string[]) => void }) {
  const candidates = suggestion?.candidate_pool ?? []
  const selectedSet = new Set(selected)
  return (
    <article className="probable-team-panel">
      <div className="panel-header compact-header">
        <div>
          <p className="eyebrow">Probable XI</p>
          <h3>{title}</h3>
        </div>
        <span className={`pill ${selected.length === 11 ? 'success' : ''}`}>{selected.length} / 11</span>
      </div>
      <button type="button" onClick={() => onChange((suggestion?.suggested_xi ?? []).slice(0, 11))} disabled={!suggestion?.suggested_xi?.length}>Load suggested XI</button>
      <div className="candidate-chip-grid">
        {candidates.length ? candidates.map((candidate) => {
          const active = selectedSet.has(candidate.name)
          return (
            <button
              type="button"
              className={`candidate-chip ${active ? 'active' : ''}`}
              key={candidate.name}
              onClick={() => {
                if (active) {
                  onChange(selected.filter((player) => player !== candidate.name))
                  return
                }
                if (selected.length < 11) {
                  onChange([...selected, candidate.name])
                }
              }}
            >
              <strong>{candidate.name}</strong>
              <span>{String(candidate.role ?? 'unknown').replaceAll('_', ' ')} · #{candidate.batting_order_estimate ?? '—'} · {candidate.recent_appearances ?? 0} recent</span>
            </button>
          )
        }) : <EmptyState message="No automatic XI candidates are available for this side yet." />}
      </div>
    </article>
  )
}

function PredictionPanel({ state, prediction }: { state: AsyncState<PredictionPayload>; prediction: PredictionPayload | null }) {
  return (
    <section className="result-grid">
      <article className="panel result-panel wide-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Model output</p>
            <h2>Prediction result</h2>
          </div>
        </div>
        {state.status === 'idle' ? <EmptyState message="Run a prediction to populate this panel." /> : null}
        {state.status === 'loading' ? <EmptyState message="Calculating model probabilities and overlays…" /> : null}
        {state.status === 'error' ? <EmptyState message={state.message} tone="error" /> : null}
        {prediction ? (
          <>
            <div className="summary-grid">
              <MetricCard label="Model pick" value={prediction.predicted_winner ?? '—'} positive />
              <MetricCard label={prediction.team1 ?? 'Team 1'} value={formatPercent(prediction.team1_win_probability)} />
              <MetricCard label={prediction.team2 ?? 'Team 2'} value={formatPercent(prediction.team2_win_probability)} />
              <MetricCard label="Fair price · Team 1" value={formatPrice(prediction.fair_price_team1_cents)} />
              <MetricCard label="Fair price · Team 2" value={formatPrice(prediction.fair_price_team2_cents)} />
              <MetricCard label="Fixture state" value={prediction.fixture_status ?? '—'} />
            </div>
            <div className="detail-columns">
              <ResultList title="Component weights" items={(prediction.components ?? []).map((component) => `${component.component ?? 'Component'} · ${formatPercent(component.probability)} · weight ${formatPercent(component.weight)}`)} />
              <ResultList title="Confirmed / modeled XI" items={[...(prediction.official_post_toss_context?.team1_confirmed_xi ?? []), ...(prediction.official_post_toss_context?.team2_confirmed_xi ?? [])].slice(0, 24)} />
              <ResultList title="Sportsbook detail" items={(prediction.sportsbook_overlay?.books ?? []).map((book) => `${book.sportsbook ?? 'Book'} · ${formatPercent(book.team1_probability)} / ${formatPercent(book.team2_probability)} · max ${formatNumber(book.team1_max_stake)}`)} />
            </div>
          </>
        ) : null}
      </article>
      <article className="panel result-panel wide-panel">
        <div className="panel-header"><h2>Raw response</h2></div>
        <pre className="raw-response">{prediction ? JSON.stringify(prediction, null, 2) : 'Select a fixture and run a prediction.'}</pre>
      </article>
    </section>
  )
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3>{title}</h3>
      <div className="stacked-list compact">
        {items.length ? items.map((item) => <div className="list-card" key={item}>{item}</div>) : <EmptyState message="No data returned." />}
      </div>
    </div>
  )
}

function Detail({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="detail-block">
      <span className="detail-label">{label}</span>
      <span className={`detail-value ${highlight ? 'edge-positive' : ''}`}>{value}</span>
    </div>
  )
}

function MetricCard({ label, value, positive = false }: { label: string; value: string; positive?: boolean | undefined }) {
  return (
    <div className={`metric ${positive ? 'edge-positive' : ''}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  )
}

function EmptyState({ message, tone }: { message: string; tone?: 'error' }) {
  return <div className={`empty-state ${tone === 'error' ? 'edge-negative' : ''}`}>{message}</div>
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : `Request failed: ${response.status}`
    throw new Error(message)
  }
  return payload as T
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return await response.json()
  }
  return { error: await response.text() }
}

function isAutoInputAvailable(payload: ContextPayload, mode: PredictorMode): boolean {
  const automatic = payload.automatic ?? {}
  return mode === 'post_toss' ? Boolean(automatic.official_toss) : Boolean(automatic.fixture_shell && automatic.current_elo)
}

function buildFeatureOverrides(value: FeatureOverrideState): Record<string, number> {
  const overrides: Record<string, number> = {}
  const numericEntries: Array<[keyof FeatureOverrideState, string]> = [
    ['team1_probableXiStrength', value.team1_probableXiStrength],
    ['team2_probableXiStrength', value.team2_probableXiStrength],
    ['team1_xiContinuityScore', value.team1_xiContinuityScore],
    ['team2_xiContinuityScore', value.team2_xiContinuityScore],
    ['team1_missingKeyBatterCount', value.team1_missingKeyBatterCount],
    ['team2_missingKeyBatterCount', value.team2_missingKeyBatterCount],
    ['team1_missingKeyBowlerCount', value.team1_missingKeyBowlerCount],
    ['team2_missingKeyBowlerCount', value.team2_missingKeyBowlerCount],
  ]

  for (const [key, rawValue] of numericEntries) {
    const trimmed = rawValue.trim()
    if (!trimmed) {
      continue
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      throw new Error(`${key} must be numeric.`)
    }
    overrides[key] = parsed
  }

  if (value.team1_missingOpenerFlag) overrides.team1_missingOpenerFlag = 1
  if (value.team2_missingOpenerFlag) overrides.team2_missingOpenerFlag = 1
  if (value.team1_missingDeathBowlerFlag) overrides.team1_missingDeathBowlerFlag = 1
  if (value.team2_missingDeathBowlerFlag) overrides.team2_missingDeathBowlerFlag = 1
  return overrides
}

function sortFixtures(fixtures: Fixture[]): Fixture[] {
  return [...fixtures].sort((left, right) => {
    const leftCompleted = isCompletedFixture(left)
    const rightCompleted = isCompletedFixture(right)
    if (leftCompleted !== rightCompleted) {
      return leftCompleted ? 1 : -1
    }
    if (Boolean(left.is_live) !== Boolean(right.is_live)) {
      return left.is_live ? -1 : 1
    }
    return String(left.match_date ?? '').localeCompare(String(right.match_date ?? ''))
  })
}

function isCompletedFixture(fixture: Fixture): boolean {
  if (fixture.is_completed === true || fixture.is_completed === 'true') {
    return true
  }
  const status = String(fixture.status ?? '').toLowerCase()
  return status.includes('complete') || status.includes('finished')
}

function formatFixtureStatus(fixture: Fixture): string {
  if (fixture.is_live === true || fixture.is_live === 'true') {
    return 'Live'
  }
  if (isCompletedFixture(fixture)) {
    return 'Completed'
  }
  return String(fixture.status ?? 'Scheduled')
}

function summarizeVenue(fixture: Fixture): string {
  const city = String(fixture.city ?? '').trim()
  if (city) {
    return city
  }
  const venue = String(fixture.venue ?? '').trim()
  return venue ? venue.split(',')[0]?.trim() ?? venue : 'Unknown venue'
}

function formatShortDate(value: unknown): string {
  const parsed = Date.parse(String(value ?? ''))
  if (!Number.isFinite(parsed)) {
    return String(value ?? 'Unknown time')
  }
  return shortDateFormatter.format(new Date(parsed))
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? '—' : `${(Number(value) * 100).toFixed(2)}%`
}

function formatPrice(value: number | undefined): string {
  return value === undefined ? '—' : `${Number(value).toFixed(2)}c`
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? '—' : Number(value).toLocaleString()
}

function predictionStatus(status: AsyncState<PredictionPayload>['status']): string {
  switch (status) {
    case 'loading':
      return 'Running'
    case 'success':
      return 'Ready'
    case 'error':
      return 'Error'
    case 'idle':
      return 'Idle'
  }
}

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected request failure.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
