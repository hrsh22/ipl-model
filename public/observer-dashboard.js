const refreshButton = document.querySelector('#refresh-now');

const heroMetrics = document.querySelector('#hero-metrics');
const engineMetrics = document.querySelector('#engine-metrics');
const liveFixtures = document.querySelector('#live-fixtures');
const liveModel = document.querySelector('#live-model');
const ballShadow = document.querySelector('#ball-shadow');
const opportunities = document.querySelector('#opportunities');
const diagnostics = document.querySelector('#diagnostics');
const history = document.querySelector('#history');

const liveFixtureCount = document.querySelector('#live-fixture-count');
const liveModelCount = document.querySelector('#live-model-count');
const ballShadowStatus = document.querySelector('#ball-shadow-status');
const actionableCount = document.querySelector('#actionable-count');
const attentionCount = document.querySelector('#attention-count');
const historyCount = document.querySelector('#history-count');

const emptyTemplate = document.querySelector('#empty-state-template');

const REFRESH_INTERVAL_MS = 5000;

const formatPercent = (value) => `${(value * 100).toFixed(2)}%`;
const formatBps = (value) => `${value > 0 ? '+' : ''}${value} bps`;
const formatAge = (seconds) => (seconds === null ? '—' : `${seconds}s ago`);
const formatUsd = (value) => (value === null ? '—' : `$${Number(value).toFixed(2)}`);
const formatShares = (value) => (value === null ? '—' : `${Number(value).toFixed(0)} sh`);
const formatNullableNumber = (value, digits = 1) => (
  value === null || value === undefined ? '—' : Number(value).toFixed(digits)
);
const formatNullablePercent = (value) => (
  value === null || value === undefined ? '—' : formatPercent(Number(value))
);
const formatNullableBps = (value) => (
  value === null || value === undefined ? '—' : formatBps(Math.round(Number(value)))
);
const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');
const formatIngestionStatus = (refresh) => {
  const status = refresh?.ingestionStatus ?? 'idle';
  if (status === 'unconfigured') return 'source not configured';
  const cadence = refresh?.ingestionIntervalMs ? `${Math.round(refresh.ingestionIntervalMs / 1000)}s` : '—';
  const lastSuccess = refresh?.ingestionLastSuccessAt
    ? new Date(refresh.ingestionLastSuccessAt).toLocaleTimeString()
    : null;
  return lastSuccess ? `${status} · ${lastSuccess} · ${cadence}` : `${status} · ${cadence}`;
};
const formatIngestionSource = (source) => {
  if (!source) return 'not configured';
  if (source === 'saved-html-dir' || source.startsWith('saved-html-dir:')) return 'saved HTML dir';
  if (source === 'saved-html' || source.startsWith('saved-html:')) return 'saved HTML file';
  try {
    return new URL(source).hostname;
  } catch {
    return source;
  }
};
const formatCountdown = (seconds) => {
  if (seconds === null || seconds === undefined) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const describeReason = (reason, entry) => {
  const labels = {
    'fixture-not-loaded-in-memory': 'Fixture is not loaded into active observer memory yet',
    'missing-polymarket-mapping': entry.mode === 'upcoming'
      ? 'Polymarket market is not mapped yet for this upcoming fixture'
      : 'Polymarket market mapping is missing',
    'no-polymarket-ws-book': 'Polymarket websocket book is missing for this live fixture',
    'no-usable-reference-books': 'No usable Betfair-led reference market right now',
    'reference-market-not-ready-yet': 'Reference market not ready yet for this upcoming fixture',
  };

  return labels[reason] ?? reason.replaceAll('-', ' ');
};

const clearNode = (node) => {
  node.innerHTML = '';
};

const renderEmpty = (node, message) => {
  clearNode(node);
  const empty = emptyTemplate.content.firstElementChild.cloneNode(true);
  empty.textContent = message;
  node.appendChild(empty);
};

const metricCard = (label, value, className = '') => `
  <div class="metric ${className}">
    <div class="metric-label">${escapeHtml(label)}</div>
    <div class="metric-value">${escapeHtml(value)}</div>
  </div>
`;

const renderMetrics = (ready, metrics) => {
  heroMetrics.innerHTML = [
    metricCard('Ready', ready.ready ? 'YES' : 'NO', ready.ready ? 'edge-positive' : 'edge-negative'),
    metricCard('Live Fixtures', metrics.live_fixtures),
    metricCard('Actionable', metrics.opportunity_count_medium),
    metricCard('Attention', metrics.attention_fixture_count),
  ].join('');

  engineMetrics.innerHTML = [
    metricCard('Odds Event Age', formatAge(metrics.odds_last_event_age_seconds)),
    metricCard('Poly Event Age', formatAge(metrics.polymarket_last_event_age_seconds)),
    metricCard('Mapped Fixtures', metrics.mapped_fixtures),
    metricCard('Reference Blends', metrics.fixtures_with_reference_blend),
  ].join('');
};

const renderLiveFixtures = (fixtures) => {
  liveFixtureCount.textContent = String(fixtures.length);

  if (!fixtures.length) {
    renderEmpty(liveFixtures, 'No live IPL fixtures currently tracked.');
    return;
  }

  liveFixtures.innerHTML = fixtures.map(({ fixture, monitoring, summary }) => {
    const topSelection = summary?.selections?.[0];
    return `
      <article class="list-card">
        <div class="list-card-header">
          <div>
            <div class="detail-label">${escapeHtml(fixture.league)}</div>
            <h3>${escapeHtml(fixture.homeTeam)} vs ${escapeHtml(fixture.awayTeam)}</h3>
          </div>
          <span class="pill ${summary ? 'success' : 'warning'}">${escapeHtml(monitoring.mode)}</span>
        </div>
        <div class="detail-grid">
          <div class="detail-block"><span class="detail-label">Score</span><span class="detail-value">${escapeHtml(fixture.score ?? '—')}</span></div>
          <div class="detail-block"><span class="detail-label">Period</span><span class="detail-value">${escapeHtml(fixture.period ?? '—')}</span></div>
          <div class="detail-block"><span class="detail-label">Reference</span><span class="detail-value">${escapeHtml(summary?.referenceSource ?? '—')}</span></div>
          <div class="detail-block"><span class="detail-label">Confidence</span><span class="detail-value">${escapeHtml(summary?.referenceConfidence ?? '—')}</span></div>
          <div class="detail-block"><span class="detail-label">Top Selection</span><span class="detail-value">${escapeHtml(topSelection?.selection ?? '—')}</span></div>
          <div class="detail-block"><span class="detail-label">Net Edge</span><span class="detail-value ${topSelection?.feeAdjustedEdgeBps > 0 ? 'edge-positive' : 'edge-negative'}">${topSelection?.feeAdjustedEdgeBps !== null && topSelection?.feeAdjustedEdgeBps !== undefined ? formatBps(topSelection.feeAdjustedEdgeBps) : '—'}</span></div>
        </div>
      </article>
    `;
  }).join('');
};

const shadowAppliesToModel = (model, shadow) => Boolean(
  shadow?.available &&
  shadow.currentState?.fixtureId &&
  model?.fixture?.id === shadow.currentState.fixtureId &&
  model?.expectedState?.innings === shadow.currentState?.innings &&
  shadow.predictions?.expectedRunsNow !== null &&
  shadow.predictions?.expectedRunsNow !== undefined,
);

const applyShadowExpectedState = (state, shadow) => {
  if (!shadowAppliesToModel({ fixture: { id: shadow?.currentState?.fixtureId }, expectedState: state }, shadow)) {
    return state;
  }

  return {
    ...state,
    expectedRunsNow: shadow.predictions.expectedRunsNow,
    expectedWicketsNow: shadow.predictions.expectedWicketsNow,
    runsDelta: shadow.predictions.runsDelta,
    wicketsDelta: shadow.predictions.wicketsDelta,
    projectedScore: shadow.predictions.finalInningsRuns ?? state.projectedScore,
  };
};

const renderLiveModel = (models, shadow) => {
  liveModelCount.textContent = String(models.length);

  if (!models.length) {
    renderEmpty(liveModel, 'No live expected-state model views available yet.');
    return;
  }

  liveModel.innerHTML = models.map((model) => {
    const state = shadowAppliesToModel(model, shadow)
      ? applyShadowExpectedState(model.expectedState ?? {}, shadow)
      : model.expectedState ?? {};
    const expectedSource = shadowAppliesToModel(model, shadow) ? 'model' : 'heuristic';
    const fixture = model.fixture ?? {};
    const homeEdge = model.home?.edgeVsMarketBps;
    const awayEdge = model.away?.edgeVsMarketBps;
    const strongestSide = [
      { label: model.home?.team ?? fixture.homeTeam ?? 'Home', edge: homeEdge, probability: model.home?.fairProbability },
      { label: model.away?.team ?? fixture.awayTeam ?? 'Away', edge: awayEdge, probability: model.away?.fairProbability },
    ].filter((side) => side.edge !== null && side.edge !== undefined)
      .sort((left, right) => Math.abs(Number(right.edge)) - Math.abs(Number(left.edge)))[0];
    const runDelta = state.runsDelta;
    const wicketDelta = state.wicketsDelta;

    return `
      <article class="list-card model-card">
        <div class="list-card-header">
          <div>
            <div class="detail-label">${escapeHtml(model.modelVersion ?? 'live-model')} · ${escapeHtml(model.confidence ?? 'low')} confidence</div>
            <h3>${escapeHtml(fixture.homeTeam ?? 'Home')} vs ${escapeHtml(fixture.awayTeam ?? 'Away')}</h3>
            <div class="subdued">${escapeHtml(fixture.score ?? model.details?.score ?? 'Score unavailable')} · ${escapeHtml(fixture.period ?? model.details?.period ?? 'Period unavailable')}</div>
          </div>
          <span class="pill ${state.status === 'live' ? 'success' : 'warning'}">${state.innings ? `Inn ${state.innings}` : 'Model'}</span>
        </div>
        <div class="model-strip">
          <div class="model-scoreline">
            <span>${formatNullableNumber(state.scoreRuns, 0)}/${formatNullableNumber(state.scoreWickets, 0)}</span>
            <small>${formatNullableNumber(state.balls, 0)} balls</small>
          </div>
          <div class="model-projection">
            <span>${formatNullableNumber(state.projectedScore, 1)}</span>
            <small>Projected score</small>
          </div>
        </div>
        <div class="detail-grid model-grid">
          <div class="detail-block"><span class="detail-label">Expected Runs Now (${expectedSource})</span><span class="detail-value">${formatNullableNumber(state.expectedRunsNow, 1)}</span></div>
          <div class="detail-block"><span class="detail-label">Runs Delta</span><span class="detail-value ${Number(runDelta ?? 0) >= 0 ? 'edge-positive' : 'edge-negative'}">${formatNullableNumber(runDelta, 1)}</span></div>
          <div class="detail-block"><span class="detail-label">Expected Wkts Now (${expectedSource})</span><span class="detail-value">${formatNullableNumber(state.expectedWicketsNow, 2)}</span></div>
          <div class="detail-block"><span class="detail-label">Wkts Delta</span><span class="detail-value ${Number(wicketDelta ?? 0) <= 0 ? 'edge-positive' : 'edge-negative'}">${formatNullableNumber(wicketDelta, 2)}</span></div>
          <div class="detail-block"><span class="detail-label">Home Fair</span><span class="detail-value">${formatNullablePercent(model.home?.fairProbability)}</span></div>
          <div class="detail-block"><span class="detail-label">Away Fair</span><span class="detail-value">${formatNullablePercent(model.away?.fairProbability)}</span></div>
          <div class="detail-block"><span class="detail-label">Top Edge</span><span class="detail-value ${Number(strongestSide?.edge ?? 0) >= 0 ? 'edge-positive' : 'edge-negative'}">${strongestSide ? `${escapeHtml(strongestSide.label)}: ${escapeHtml(formatNullableBps(strongestSide.edge))}` : '—'}</span></div>
          <div class="detail-block"><span class="detail-label">Updated</span><span class="detail-value">${model.updatedAt ? new Date(model.updatedAt).toLocaleTimeString() : '—'}</span></div>
        </div>
      </article>
    `;
  }).join('');
};

const renderBallShadow = (shadow) => {
  ballShadowStatus.textContent = shadow?.available ? 'LIVE' : 'WAIT';
  ballShadowStatus.className = `pill ${shadow?.available ? 'success' : 'warning'}`;

  if (!shadow?.available) {
    renderEmpty(ballShadow, shadow?.reason ?? 'No experimental ball-by-ball shadow output available yet.');
    return;
  }

  const state = shadow.currentState ?? {};
  const predictions = shadow.predictions ?? {};
  const diagnostics = shadow.parity?.snapshotDiagnostics ?? {};
  const refresh = shadow.refresh ?? {};
  const coverage = diagnostics.snapshot_exact_coverage_balls !== undefined
    ? `${diagnostics.snapshot_exact_coverage_balls} balls`
    : '—';

  ballShadow.innerHTML = `
    <article class="list-card shadow-card">
      <div class="list-card-header">
        <div>
          <div class="detail-label">experimental shadow · ${escapeHtml(shadow.parity?.featureMode ?? 'feature mode pending')} · ingest ${escapeHtml(refresh.ingestionStatus ?? 'idle')}</div>
          <h3>${escapeHtml(state.battingTeam ?? 'Batting side')} projection</h3>
          <div class="subdued">${escapeHtml(shadow.outputDir ?? 'model/experiments/ball-state')} · auto-refresh ${escapeHtml(refresh.autoRefreshEnabled ? `${Math.round(refresh.autoRefreshIntervalMs / 1000)}s` : 'disabled')}</div>
        </div>
        <span class="pill ${refresh.status === 'failed' ? 'danger' : shadow.parity?.readyForInference ? 'success' : 'warning'}">${refresh.status ?? (shadow.parity?.readyForInference ? 'ready' : 'check')}</span>
      </div>
      <div class="model-strip">
        <div class="model-scoreline">
          <span>${formatNullableNumber(state.scoreRuns, 0)}/${formatNullableNumber(state.scoreWickets, 0)}</span>
          <small>${formatNullableNumber(state.balls, 0)} balls</small>
        </div>
        <div class="model-projection">
          <span>${formatNullableNumber(predictions.finalInningsRuns, 1)}</span>
          <small>Final runs</small>
        </div>
      </div>
      <div class="detail-grid model-grid">
        <div class="detail-block"><span class="detail-label">Model Expected Runs Now</span><span class="detail-value">${formatNullableNumber(predictions.expectedRunsNow, 1)}</span></div>
        <div class="detail-block"><span class="detail-label">Model Runs Delta</span><span class="detail-value ${Number(predictions.runsDelta ?? 0) >= 0 ? 'edge-positive' : 'edge-negative'}">${formatNullableNumber(predictions.runsDelta, 1)}</span></div>
        <div class="detail-block"><span class="detail-label">Model Expected Wkts Now</span><span class="detail-value">${formatNullableNumber(predictions.expectedWicketsNow, 2)}</span></div>
        <div class="detail-block"><span class="detail-label">Model Wkts Delta</span><span class="detail-value ${Number(predictions.wicketsDelta ?? 0) <= 0 ? 'edge-positive' : 'edge-negative'}">${formatNullableNumber(predictions.wicketsDelta, 2)}</span></div>
        <div class="detail-block"><span class="detail-label">Final wickets</span><span class="detail-value">${formatNullableNumber(predictions.finalInningsWickets, 2)}</span></div>
        <div class="detail-block"><span class="detail-label">Remaining runs</span><span class="detail-value">${formatNullableNumber(predictions.remainingInningsRuns, 1)}</span></div>
        <div class="detail-block"><span class="detail-label">Remaining wickets</span><span class="detail-value">${formatNullableNumber(predictions.remainingInningsWickets, 2)}</span></div>
        <div class="detail-block"><span class="detail-label">Chase success</span><span class="detail-value">${formatNullablePercent(predictions.chaseSuccessProbability)}</span></div>
        <div class="detail-block"><span class="detail-label">Coverage</span><span class="detail-value">${coverage}</span></div>
        <div class="detail-block"><span class="detail-label">Shadow Updated</span><span class="detail-value">${shadow.updatedAt ? new Date(shadow.updatedAt).toLocaleTimeString() : '—'}</span></div>
        <div class="detail-block"><span class="detail-label">Event Journal</span><span class="detail-value">${refresh.eventJournalUpdatedAt ? new Date(refresh.eventJournalUpdatedAt).toLocaleTimeString() : '—'}</span></div>
        <div class="detail-block"><span class="detail-label">Event Ingestion</span><span class="detail-value">${escapeHtml(formatIngestionStatus(refresh))}</span></div>
        <div class="detail-block"><span class="detail-label">Ingestion Source</span><span class="detail-value">${escapeHtml(formatIngestionSource(refresh.ingestionSource))}</span></div>
        <div class="detail-block"><span class="detail-label">Ingestion Error</span><span class="detail-value edge-negative">${escapeHtml(refresh.ingestionLastError ?? '—')}</span></div>
        <div class="detail-block"><span class="detail-label">Refresh Error</span><span class="detail-value edge-negative">${escapeHtml(refresh.lastError ?? '—')}</span></div>
      </div>
    </article>
  `;
};

const renderOpportunities = (payload) => {
  const actionable = payload.actionable ?? [];
  const provisional = payload.provisional ?? [];
  actionableCount.textContent = String(actionable.length);

  if (!actionable.length && !provisional.length) {
    renderEmpty(opportunities, 'No current opportunities pass the engine filters.');
    return;
  }

  const rows = [
    ...actionable.map((opportunity) => ({ ...opportunity, bucket: 'Actionable' })),
    ...provisional.map((opportunity) => ({ ...opportunity, bucket: 'Provisional' })),
  ];

  opportunities.innerHTML = rows.map((opportunity) => `
    <article class="list-card">
      <div class="list-card-header">
        <div>
          <div class="detail-label">${escapeHtml(opportunity.fixture)}</div>
          <h3>${escapeHtml(opportunity.selection.replaceAll('_', ' '))}</h3>
        </div>
        <span class="pill ${opportunity.bucket === 'Actionable' ? 'success' : 'warning'}">${opportunity.bucket}</span>
      </div>
      <div class="detail-grid">
        <div class="detail-block"><span class="detail-label">Betfair Fair</span><span class="detail-value">${formatPercent(opportunity.referenceProbability)}</span></div>
        <div class="detail-block"><span class="detail-label">Executable Ask</span><span class="detail-value">${formatPercent(opportunity.executableAsk)}</span></div>
        <div class="detail-block"><span class="detail-label">Fee Adj Ask</span><span class="detail-value">${formatPercent(opportunity.feeAdjustedAsk)}</span></div>
        <div class="detail-block"><span class="detail-label">Net Edge</span><span class="detail-value ${opportunity.feeAdjustedEdgeBps > 0 ? 'edge-positive' : 'edge-negative'}">${formatBps(opportunity.feeAdjustedEdgeBps)}</span></div>
        <div class="detail-block"><span class="detail-label">Ask Size</span><span class="detail-value">${formatShares(opportunity.executableAskSize)}</span></div>
        <div class="detail-block"><span class="detail-label">Notional</span><span class="detail-value">${formatUsd(opportunity.executableNotional)}</span></div>
        <div class="detail-block"><span class="detail-label">Confidence</span><span class="detail-value">${escapeHtml(opportunity.referenceConfidence)}</span></div>
        <div class="detail-block"><span class="detail-label">Persistence</span><span class="detail-value">${Math.round(opportunity.persistenceMs / 1000)}s</span></div>
      </div>
    </article>
  `).join('');
};

const renderDiagnostics = (payload) => {
  const attention = payload.fixturesNeedingAttention ?? [];
  attentionCount.textContent = String(payload.attentionFixtures ?? attention.length);

  if (!attention.length) {
    renderEmpty(diagnostics, 'No fixtures currently need operator attention.');
    return;
  }

  diagnostics.innerHTML = attention.map((entry) => `
    <article class="list-card">
      <div class="list-card-header">
        <div>
          <div class="detail-label">${escapeHtml(entry.mode.toUpperCase())}</div>
          <h3>${escapeHtml(entry.fixture)}</h3>
          <div class="subdued">Starts in ${formatCountdown(entry.startsInSeconds)}</div>
        </div>
      </div>
      <div class="reason-list">
        ${entry.reasons.map((reason) => `<span class="reason-chip">${escapeHtml(describeReason(reason, entry))}</span>`).join('')}
      </div>
    </article>
  `).join('');
};

const renderHistory = (entries) => {
  historyCount.textContent = String(entries.length);

  if (!entries.length) {
    renderEmpty(history, 'No live operator tape entries right now.');
    return;
  }

  history.innerHTML = entries.map((entry) => `
    <article class="list-card">
      <div class="detail-grid">
        <div class="detail-block"><span class="detail-label">Fixture</span><span class="detail-value">${escapeHtml(entry.fixture)}</span></div>
        <div class="detail-block"><span class="detail-label">Selection</span><span class="detail-value">${escapeHtml(entry.selection.replaceAll('_', ' '))}</span></div>
        <div class="detail-block"><span class="detail-label">Net Edge</span><span class="detail-value ${(entry.feeAdjustedEdgeBps ?? 0) > 0 ? 'edge-positive' : 'edge-negative'}">${entry.feeAdjustedEdgeBps !== null ? formatBps(entry.feeAdjustedEdgeBps) : '—'}</span></div>
        <div class="detail-block"><span class="detail-label">Confidence</span><span class="detail-value">${escapeHtml(entry.confidence)}</span></div>
        <div class="detail-block"><span class="detail-label">Score</span><span class="detail-value">${escapeHtml(entry.score ?? '—')}</span></div>
        <div class="detail-block"><span class="detail-label">Period</span><span class="detail-value">${escapeHtml(entry.period ?? '—')}</span></div>
      </div>
    </article>
  `).join('');
};

const fetchJson = async (path) => {
  const response = await fetch(path);
  if (response.status === 401) {
    throw new Error('Observer API is protected. Open the dashboard only when observer auth is disabled.');
  }
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
};

const loadDashboard = async () => {
  try {
    const [ready, metrics, live, liveModelPayload, ballShadowPayload, opportunityDiagnostics, diagnosticsPayload, historyPayload] = await Promise.all([
      fetchJson('/ready'),
      fetchJson('/observer/metrics'),
      fetchJson('/observer/fixtures/live'),
      fetchJson('/observer/live-model'),
      fetchJson('/observer/ball-state-shadow'),
      fetchJson('/observer/opportunities/diagnostics?minEdgeBps=1'),
      fetchJson('/observer/diagnostics'),
      fetchJson('/observer/tape/live'),
    ]);

    renderMetrics(ready, metrics);
    renderLiveFixtures(live);
    renderLiveModel(liveModelPayload, ballShadowPayload);
    renderBallShadow(ballShadowPayload);
    renderOpportunities(opportunityDiagnostics);
    renderDiagnostics(diagnosticsPayload);
    renderHistory(historyPayload.slice(0, 8));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown dashboard error';

    renderEmpty(liveFixtures, message);
    renderEmpty(liveModel, message);
    renderEmpty(ballShadow, message);
    renderEmpty(opportunities, message);
    renderEmpty(diagnostics, message);
    renderEmpty(history, message);
    heroMetrics.innerHTML = metricCard('Status', 'ERROR', 'edge-negative');
    engineMetrics.innerHTML = metricCard('Message', message, 'edge-negative');
  }
};

refreshButton?.addEventListener('click', () => {
  void loadDashboard();
});

void loadDashboard();
setInterval(() => {
  void loadDashboard();
}, REFRESH_INTERVAL_MS);
