const refreshButton = document.querySelector('#refresh-now');

const heroMetrics = document.querySelector('#hero-metrics');
const engineMetrics = document.querySelector('#engine-metrics');
const liveFixtures = document.querySelector('#live-fixtures');
const opportunities = document.querySelector('#opportunities');
const diagnostics = document.querySelector('#diagnostics');
const history = document.querySelector('#history');

const liveFixtureCount = document.querySelector('#live-fixture-count');
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
    <div class="metric-label">${label}</div>
    <div class="metric-value">${value}</div>
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
            <div class="detail-label">${fixture.league}</div>
            <h3>${fixture.homeTeam} vs ${fixture.awayTeam}</h3>
          </div>
          <span class="pill ${summary ? 'success' : 'warning'}">${monitoring.mode}</span>
        </div>
        <div class="detail-grid">
          <div class="detail-block"><span class="detail-label">Score</span><span class="detail-value">${fixture.score ?? '—'}</span></div>
          <div class="detail-block"><span class="detail-label">Period</span><span class="detail-value">${fixture.period ?? '—'}</span></div>
          <div class="detail-block"><span class="detail-label">Reference</span><span class="detail-value">${summary?.referenceSource ?? '—'}</span></div>
          <div class="detail-block"><span class="detail-label">Confidence</span><span class="detail-value">${summary?.referenceConfidence ?? '—'}</span></div>
          <div class="detail-block"><span class="detail-label">Top Selection</span><span class="detail-value">${topSelection?.selection ?? '—'}</span></div>
          <div class="detail-block"><span class="detail-label">Net Edge</span><span class="detail-value ${topSelection?.feeAdjustedEdgeBps > 0 ? 'edge-positive' : 'edge-negative'}">${topSelection?.feeAdjustedEdgeBps !== null && topSelection?.feeAdjustedEdgeBps !== undefined ? formatBps(topSelection.feeAdjustedEdgeBps) : '—'}</span></div>
        </div>
      </article>
    `;
  }).join('');
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
          <div class="detail-label">${opportunity.fixture}</div>
          <h3>${opportunity.selection.replaceAll('_', ' ')}</h3>
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
        <div class="detail-block"><span class="detail-label">Confidence</span><span class="detail-value">${opportunity.referenceConfidence}</span></div>
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
          <div class="detail-label">${entry.mode.toUpperCase()}</div>
          <h3>${entry.fixture}</h3>
          <div class="subdued">Starts in ${formatCountdown(entry.startsInSeconds)}</div>
        </div>
      </div>
      <div class="reason-list">
        ${entry.reasons.map((reason) => `<span class="reason-chip">${describeReason(reason, entry)}</span>`).join('')}
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
        <div class="detail-block"><span class="detail-label">Fixture</span><span class="detail-value">${entry.fixture}</span></div>
        <div class="detail-block"><span class="detail-label">Selection</span><span class="detail-value">${entry.selection.replaceAll('_', ' ')}</span></div>
        <div class="detail-block"><span class="detail-label">Net Edge</span><span class="detail-value ${(entry.feeAdjustedEdgeBps ?? 0) > 0 ? 'edge-positive' : 'edge-negative'}">${entry.feeAdjustedEdgeBps !== null ? formatBps(entry.feeAdjustedEdgeBps) : '—'}</span></div>
        <div class="detail-block"><span class="detail-label">Confidence</span><span class="detail-value">${entry.confidence}</span></div>
        <div class="detail-block"><span class="detail-label">Score</span><span class="detail-value">${entry.score ?? '—'}</span></div>
        <div class="detail-block"><span class="detail-label">Period</span><span class="detail-value">${entry.period ?? '—'}</span></div>
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
    const [ready, metrics, live, opportunityDiagnostics, diagnosticsPayload, historyPayload] = await Promise.all([
      fetchJson('/ready'),
      fetchJson('/observer/metrics'),
      fetchJson('/observer/fixtures/live'),
      fetchJson('/observer/opportunities/diagnostics?minEdgeBps=1'),
      fetchJson('/observer/diagnostics'),
      fetchJson('/observer/tape/live'),
    ]);

    renderMetrics(ready, metrics);
    renderLiveFixtures(live);
    renderOpportunities(opportunityDiagnostics);
    renderDiagnostics(diagnosticsPayload);
    renderHistory(historyPayload.slice(0, 8));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown dashboard error';

    renderEmpty(liveFixtures, message);
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
