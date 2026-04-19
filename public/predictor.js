const fixtureList = document.querySelector('#fixture-list');
const fixtureSearch = document.querySelector('#fixture-search');
const fixtureCount = document.querySelector('#fixture-count');
const selectedFixture = document.querySelector('#selected-fixture');
const keyStatusSummary = document.querySelector('#key-status-summary');
const keyStatusNote = document.querySelector('#key-status-note');
const availabilitySummary = document.querySelector('#availability-summary');
const availabilityNotes = document.querySelector('#availability-notes');
const overrideSection = document.querySelector('.override-section');
const overrideHelper = document.querySelector('#override-helper');
const manualModePill = document.querySelector('#manual-mode-pill');
const probableXiPanel = document.querySelector('#probable-xi-panel');
const manualXiEyebrow = document.querySelector('#manual-xi-eyebrow');
const manualXiHeading = document.querySelector('#manual-xi-heading');
const manualXiHelper = document.querySelector('#manual-xi-helper');
const modeSelect = document.querySelector('#mode-select');
const tossWinnerField = document.querySelector('#toss-winner-field');
const tossDecisionField = document.querySelector('#toss-decision-field');
const tossWinnerSelect = document.querySelector('#toss-winner-select');
const tossDecisionSelect = document.querySelector('#toss-decision-select');
const refreshFixturesButton = document.querySelector('#refresh-fixtures');
const inputSourcePanel = document.querySelector('.input-source-panel');
const inputModeAutoButton = document.querySelector('#input-mode-auto');
const inputModeManualButton = document.querySelector('#input-mode-manual');
const inputModeMessage = document.querySelector('#input-mode-message');
const autoModeSummary = document.querySelector('#auto-mode-summary');
const runPredictionButton = document.querySelector('#run-prediction');
const predictionStatus = document.querySelector('#prediction-status');
const predictionSummary = document.querySelector('#prediction-summary');
const componentList = document.querySelector('#component-list');
const contextSummary = document.querySelector('#context-summary');
const team1Xi = document.querySelector('#team1-xi');
const team2Xi = document.querySelector('#team2-xi');
const marketSummary = document.querySelector('#market-summary');
const sportsbookList = document.querySelector('#sportsbook-list');
const rawResponse = document.querySelector('#raw-response');
const emptyTemplate = document.querySelector('#empty-state-template');
const actionFeedback = document.querySelector('#action-feedback');
const team1ProbableXiStrengthInput = document.querySelector('#team1-probable-xi-strength');
const team2ProbableXiStrengthInput = document.querySelector('#team2-probable-xi-strength');
const team1XiContinuityInput = document.querySelector('#team1-xi-continuity');
const team2XiContinuityInput = document.querySelector('#team2-xi-continuity');
const team1MissingKeyBatterInput = document.querySelector('#team1-missing-key-batter');
const team2MissingKeyBatterInput = document.querySelector('#team2-missing-key-batter');
const team1MissingKeyBowlerInput = document.querySelector('#team1-missing-key-bowler');
const team2MissingKeyBowlerInput = document.querySelector('#team2-missing-key-bowler');
const team1MissingOpenerInput = document.querySelector('#team1-missing-opener');
const team2MissingOpenerInput = document.querySelector('#team2-missing-opener');
const team1MissingDeathBowlerInput = document.querySelector('#team1-missing-death-bowler');
const team2MissingDeathBowlerInput = document.querySelector('#team2-missing-death-bowler');
const team1ProbableTitle = document.querySelector('#team1-probable-title');
const team2ProbableTitle = document.querySelector('#team2-probable-title');
const team1ProbableCount = document.querySelector('#team1-probable-count');
const team2ProbableCount = document.querySelector('#team2-probable-count');
const team1ProbableSelected = document.querySelector('#team1-probable-selected');
const team2ProbableSelected = document.querySelector('#team2-probable-selected');
const team1ProbableCandidates = document.querySelector('#team1-probable-candidates');
const team2ProbableCandidates = document.querySelector('#team2-probable-candidates');
const team1LoadSuggestedButton = document.querySelector('#team1-load-suggested');
const team2LoadSuggestedButton = document.querySelector('#team2-load-suggested');

let fixtures = [];
let selectedFixtureId = null;
let latestContext = null;
let inputMode = window.localStorage.getItem('predictor-input-mode') === 'manual' ? 'manual' : 'auto';
let inputModeTouched = false;
let autoInputAvailable = true;
let probableXiSelections = {
  team1: new Set(),
  team2: new Set(),
};
let probableXiDirty = {
  team1: false,
  team2: false,
};
let uiState = {
  fixturesLoading: false,
  contextLoading: false,
  predictionLoading: false,
};

const manualInputs = [
  team1ProbableXiStrengthInput,
  team2ProbableXiStrengthInput,
  team1XiContinuityInput,
  team2XiContinuityInput,
  team1MissingKeyBatterInput,
  team2MissingKeyBatterInput,
  team1MissingKeyBowlerInput,
  team2MissingKeyBowlerInput,
  team1MissingOpenerInput,
  team2MissingOpenerInput,
  team1MissingDeathBowlerInput,
  team2MissingDeathBowlerInput,
];

const clearNode = (node) => {
  if (!node) return;
  node.innerHTML = '';
};

const cloneEmptyState = (message) => {
  const empty = emptyTemplate.content.firstElementChild.cloneNode(true);
  empty.textContent = message;
  return empty;
};

const renderEmpty = (node, message) => {
  if (!node) return;
  clearNode(node);
  node.appendChild(cloneEmptyState(message));
};

const formatPercent = (value) => value === null || value === undefined ? '—' : `${(Number(value) * 100).toFixed(2)}%`;
const formatPrice = (value) => value === null || value === undefined ? '—' : `${Number(value).toFixed(2)}c`;
const formatNumber = (value) => value === null || value === undefined ? '—' : Number(value).toLocaleString();
const formatEdge = (value) => value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${(Number(value) * 100).toFixed(2)} pts`;
const formatShortDate = (value) => {
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) return String(value ?? 'Unknown time');
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(parsed));
};

const summarizeVenue = (fixture) => {
  const city = String(fixture?.city ?? '').trim();
  if (city) return city;
  const venue = String(fixture?.venue ?? '').trim();
  if (!venue) return 'Unknown venue';
  return venue.split(',')[0]?.trim() || venue;
};

const metricCard = (label, value, className = '') => `
  <div class="metric ${className}">
    <div class="metric-label">${label}</div>
    <div class="metric-value">${value}</div>
  </div>
`;

const noteCard = (message, emphasis = false) => `<div class="note-card ${emphasis ? 'emphasis-note' : ''}">${message}</div>`;

const setPredictionStatus = (label, tone = '') => {
  predictionStatus.textContent = label;
  predictionStatus.className = 'pill';
  if (tone) {
    predictionStatus.classList.add(tone);
  }
};

const setActionFeedback = (message, tone = 'subtle') => {
  actionFeedback.textContent = message;
  actionFeedback.className = `notice-banner ${tone}`;
};

const applyInputMode = ({ autoAvailable = autoInputAvailable } = {}) => {
  inputSourcePanel?.classList.toggle('manual-active', inputMode === 'manual');
  inputModeAutoButton?.classList.toggle('is-active', inputMode === 'auto');
  inputModeManualButton?.classList.toggle('is-active', inputMode === 'manual');
  inputModeAutoButton?.setAttribute('aria-pressed', String(inputMode === 'auto'));
  inputModeManualButton?.setAttribute('aria-pressed', String(inputMode === 'manual'));
  if (inputModeAutoButton) {
    inputModeAutoButton.disabled = !autoAvailable;
  }
};

const setInputMode = (nextMode) => {
  inputMode = nextMode === 'manual' ? 'manual' : 'auto';
  inputModeTouched = true;
  window.localStorage.setItem('predictor-input-mode', inputMode);
  applyInputMode({ autoAvailable: autoInputAvailable });
  renderProbableXiSelectors();
  updateInputControlAvailability();
  if (latestContext) {
    renderAvailability(latestContext);
  }
};

const updateInputControlAvailability = () => {
  const busy = uiState.fixturesLoading || uiState.contextLoading || uiState.predictionLoading;
  const manualTossInputsEnabled = inputMode === 'manual' && modeSelect.value === 'post_toss';

  tossWinnerField?.classList.toggle('hidden-field', modeSelect.value !== 'post_toss');
  tossDecisionField?.classList.toggle('hidden-field', modeSelect.value !== 'post_toss');

  if (refreshFixturesButton) refreshFixturesButton.disabled = busy;
  if (runPredictionButton) runPredictionButton.disabled = busy || !selectedFixtureId;
  if (fixtureSearch) fixtureSearch.disabled = uiState.fixturesLoading;
  if (modeSelect) modeSelect.disabled = busy;
  if (tossWinnerSelect) tossWinnerSelect.disabled = busy || !manualTossInputsEnabled;
  if (tossDecisionSelect) tossDecisionSelect.disabled = busy || !manualTossInputsEnabled;
  if (inputModeAutoButton) inputModeAutoButton.disabled = busy || !autoInputAvailable;
  if (inputModeManualButton) inputModeManualButton.disabled = busy;
};

const setUiBusyState = () => {
  updateInputControlAvailability();
};

const buildImpactContextCard = (xiContext, prefix) => {
  if (!xiContext) return '';

  const activeImpact = xiContext[`${prefix}_active_impact_players`] ?? [];
  const replacedPlayers = xiContext[`${prefix}_replaced_players`] ?? [];
  const substitutes = xiContext[`${prefix}_declared_substitutes`] ?? [];
  const eligibleSubs = xiContext[`${prefix}_eligible_impact_substitutes`] ?? [];
  const overseasConfirmed = xiContext[`${prefix}_overseas_in_confirmed_xi`];
  const overseasEffective = xiContext[`${prefix}_overseas_in_effective_xi`];
  const impactRuleOk = xiContext[`${prefix}_impact_rule_ok`];
  const activeImpactLabel = activeImpact.length ? activeImpact.join(', ') : 'Not used yet';
  const replacedLabel = replacedPlayers.length ? replacedPlayers.join(', ') : 'None';

  return `
    <article class="list-card">
      <div class="detail-grid">
        <div class="detail-block"><span class="detail-label">Declared substitutes</span><span class="detail-value">${substitutes.length}</span></div>
        <div class="detail-block"><span class="detail-label">Active impact player</span><span class="detail-value">${activeImpactLabel}</span></div>
        <div class="detail-block"><span class="detail-label">Replaced player</span><span class="detail-value">${replacedLabel}</span></div>
        <div class="detail-block"><span class="detail-label">Overseas cap</span><span class="detail-value ${impactRuleOk === false ? 'edge-negative' : 'edge-positive'}">${impactRuleOk === false ? 'Check needed' : 'Valid'}</span></div>
        <div class="detail-block"><span class="detail-label">Overseas in XI</span><span class="detail-value">${formatNumber(overseasConfirmed)}</span></div>
        <div class="detail-block"><span class="detail-label">Overseas effective</span><span class="detail-value">${formatNumber(overseasEffective)}</span></div>
      </div>
      ${eligibleSubs.length ? `<div class="detail-block"><span class="detail-label">Eligible impact options</span><span class="detail-value">${eligibleSubs.join(', ')}</span></div>` : ''}
    </article>
  `;
};

const parseFixtureDate = (fixture) => {
  const timestamp = Date.parse(String(fixture?.match_date ?? ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const isCompletedFixture = (fixture) => {
  if (fixture?.is_completed === true || fixture?.is_completed === 'true') {
    return true;
  }

  const status = String(fixture?.status ?? '').toLowerCase();
  if (['completed', 'complete', 'closed', 'final', 'ended', 'finished', 'result'].includes(status)) {
    return true;
  }

  const startedLongAgo = parseFixtureDate(fixture) < (Date.now() - (6 * 60 * 60 * 1000));
  return !fixture?.is_live && startedLongAgo;
};

const fixturePriority = (fixture) => {
  if (fixture?.is_live) return 0;
  if (isCompletedFixture(fixture)) return 2;
  return 1;
};

const sortFixtures = (items) => [...items].sort((left, right) => {
  const priorityGap = fixturePriority(left) - fixturePriority(right);
  if (priorityGap !== 0) return priorityGap;
  return parseFixtureDate(left) - parseFixtureDate(right);
});

const getDisplayFixtures = () => sortFixtures(fixtures);
const getSelectedFixture = () => fixtures.find((fixture) => fixture.fixture_id === selectedFixtureId) ?? null;

const formatFixtureStatus = (fixture) => {
  if (fixture?.is_live) return 'Live';
  if (isCompletedFixture(fixture)) return 'Completed';
  return String(fixture?.status ?? 'Scheduled');
};

const getNumericValue = (input) => {
  const raw = input?.value?.trim?.() ?? '';
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const isAutoInputAvailable = (payload) => {
  if (modeSelect.value === 'post_toss') {
    const automatic = payload?.automatic ?? {};
    return Boolean(automatic.official_toss && automatic.official_confirmed_xi);
  }
  return false;
};

const getAutoLockReason = (payload) => {
  const automatic = payload?.automatic ?? {};
  const fixture = getSelectedFixture();
  if (modeSelect.value === 'post_toss') {
    if (!automatic.official_toss && !automatic.official_confirmed_xi) {
      return 'Auto will unlock when official toss and confirmed XI data arrive. Until then, use Manual to enter the toss result and any lineup assumptions yourself.';
    }
    if (!automatic.official_toss) {
      return 'Auto will unlock when the official toss result arrives. Until then, use Manual to enter toss winner and toss decision yourself.';
    }
    if (!automatic.official_confirmed_xi) {
      return 'Auto will unlock when the confirmed XIs arrive. Until then, use Manual if you want to supply the post-toss context yourself.';
    }
  }
  if (automatic.official_toss && automatic.official_confirmed_xi) {
    return 'This match already has official toss and confirmed XI data. Switch to Post toss to let Auto use the live context.';
  }
  if (fixture?.is_live) {
    return 'This match is already live, but Auto only uses official live data in Post toss mode. Switch to Post toss to use the live context automatically.';
  }
  return 'Auto pre-toss is locked right now because the system does not automatically have toss, lineup, or team-news assumptions for this fixture yet. Use Manual to enter the assumptions you want the model to use.';
};

const syncInputModeWithAvailability = (payload) => {
  autoInputAvailable = isAutoInputAvailable(payload);
  if (!autoInputAvailable) {
    inputMode = 'manual';
  } else if (!inputModeTouched) {
    inputMode = 'auto';
  }
  window.localStorage.setItem('predictor-input-mode', inputMode);
  return autoInputAvailable;
};

const buildFeatureOverrides = () => {
  const entries = [
    ['team1_probableXiStrength', getNumericValue(team1ProbableXiStrengthInput)],
    ['team2_probableXiStrength', getNumericValue(team2ProbableXiStrengthInput)],
    ['team1_xiContinuityScore', getNumericValue(team1XiContinuityInput)],
    ['team2_xiContinuityScore', getNumericValue(team2XiContinuityInput)],
    ['team1_missingKeyBatterCount', getNumericValue(team1MissingKeyBatterInput)],
    ['team2_missingKeyBatterCount', getNumericValue(team2MissingKeyBatterInput)],
    ['team1_missingKeyBowlerCount', getNumericValue(team1MissingKeyBowlerInput)],
    ['team2_missingKeyBowlerCount', getNumericValue(team2MissingKeyBowlerInput)],
  ];

  const overrides = Object.fromEntries(entries.filter(([, value]) => value !== null));
  if (team1MissingOpenerInput.checked) overrides.team1_missingOpenerFlag = 1;
  if (team2MissingOpenerInput.checked) overrides.team2_missingOpenerFlag = 1;
  if (team1MissingDeathBowlerInput.checked) overrides.team1_missingDeathBowlerFlag = 1;
  if (team2MissingDeathBowlerInput.checked) overrides.team2_missingDeathBowlerFlag = 1;
  return overrides;
};

const resetManualFormState = () => {
  [
    team1ProbableXiStrengthInput,
    team2ProbableXiStrengthInput,
    team1XiContinuityInput,
    team2XiContinuityInput,
    team1MissingKeyBatterInput,
    team2MissingKeyBatterInput,
    team1MissingKeyBowlerInput,
    team2MissingKeyBowlerInput,
  ].forEach((input) => {
    input.value = '';
  });

  [
    team1MissingOpenerInput,
    team2MissingOpenerInput,
    team1MissingDeathBowlerInput,
    team2MissingDeathBowlerInput,
  ].forEach((input) => {
    input.checked = false;
  });

  tossWinnerSelect.value = '';
  tossDecisionSelect.value = '';
  probableXiSelections = { team1: new Set(), team2: new Set() };
  probableXiDirty = { team1: false, team2: false };
  inputModeTouched = false;
};

const clearPredictionOutputs = (message = 'Run a prediction to populate this panel.') => {
  renderEmpty(predictionSummary, message);
  renderEmpty(componentList, 'Component weights will show here.');
  renderEmpty(contextSummary, 'Team context will show here.');
  renderEmpty(team1Xi, 'Official or modeled XI will show here.');
  renderEmpty(team2Xi, 'Official or modeled XI will show here.');
  renderEmpty(marketSummary, 'Market overlays will show here.');
  renderEmpty(sportsbookList, 'Sportsbook and Polymarket detail will show here.');
};

const syncModeToFixture = ({ forceDefault = false } = {}) => {
  const fixture = getSelectedFixture();
  if (!fixture) return;

  if (forceDefault) {
    modeSelect.value = fixture.is_live ? 'post_toss' : 'pre_toss';
    return;
  }

  if (fixture.is_live && modeSelect.value !== 'post_toss') {
    modeSelect.value = 'post_toss';
  }
};

const updateTossWinnerOptions = () => {
  const fixture = getSelectedFixture();
  const previous = tossWinnerSelect.value;
  tossWinnerSelect.innerHTML = '<option value="">Use automatic source</option>';
  if (!fixture) return;
  [fixture.team1, fixture.team2].forEach((team) => {
    const option = document.createElement('option');
    option.value = team;
    option.textContent = team;
    tossWinnerSelect.appendChild(option);
  });
  if ([...tossWinnerSelect.options].some((option) => option.value === previous)) {
    tossWinnerSelect.value = previous;
  }
};

const setProbableXiSelectionsFromSuggestions = (payload, force = false) => {
  const suggestions = payload?.probable_xi_suggestions;
  if (!suggestions) return;

  if (force || !probableXiDirty.team1) {
    probableXiSelections.team1 = new Set(suggestions.team1?.suggested_xi ?? []);
    probableXiDirty.team1 = false;
  }

  if (force || !probableXiDirty.team2) {
    probableXiSelections.team2 = new Set(suggestions.team2?.suggested_xi ?? []);
    probableXiDirty.team2 = false;
  }
};

const renderSelectedProbableXi = (node, players) => {
  if (!players.length) {
    renderEmpty(node, 'No players selected yet.');
    return;
  }

  node.innerHTML = players.map((player) => `<div class="list-card">${player}</div>`).join('');
};

const groupCandidatesByRole = (candidates = []) => {
  const order = ['keeper_batter', 'batter', 'all_rounder', 'bowler', 'unknown'];
  const labels = {
    keeper_batter: 'Keepers',
    batter: 'Batters',
    all_rounder: 'All-rounders',
    bowler: 'Bowlers',
    unknown: 'Other',
  };

  return order
    .map((role) => ({
      role,
      label: labels[role],
      items: candidates.filter((candidate) => (candidate.role ?? 'unknown') === role),
    }))
    .filter((group) => group.items.length);
};

const renderCandidateChip = (candidate, teamKey, selected) => {
  const selectedClass = selected.has(candidate.name) ? 'active' : '';
  const badges = [
    candidate.suggested ? 'Suggested' : null,
    candidate.is_key_batter ? 'Key batter' : null,
    candidate.is_key_bowler ? 'Key bowler' : null,
    candidate.is_death_bowler ? 'Death overs' : null,
    candidate.is_opener ? 'Opener' : null,
  ].filter(Boolean).slice(0, 3);

  return `
    <button
      type="button"
      class="candidate-chip ${selectedClass}"
      data-team="${teamKey}"
      data-player="${encodeURIComponent(candidate.name)}"
    >
      <strong>${candidate.name}</strong>
      <span>${String(candidate.role ?? 'unknown').replaceAll('_', ' ')} · projected #${candidate.batting_order_estimate} · ${candidate.recent_appearances} recent</span>
      <span class="candidate-badges">${badges.map((badge) => `<em>${badge}</em>`).join('')}</span>
    </button>
  `;
};

const attachCandidateChipEvents = (container) => {
  container.querySelectorAll('.candidate-chip').forEach((button) => {
    button.addEventListener('click', () => {
      const player = decodeURIComponent(button.dataset.player ?? '');
      const team = button.dataset.team;
      if (!team || !player) return;

      const set = probableXiSelections[team];
      if (set.has(player)) {
        set.delete(player);
      } else {
        if (set.size >= 11) {
          setActionFeedback('You can only apply 11 probable XI players per side.', 'error');
          return;
        }
        set.add(player);
      }

      probableXiDirty[team] = true;
      renderProbableXiSelectors();
    });
  });
};

const renderProbableXiTeam = ({
  teamKey,
  teamName,
  suggestion,
  titleNode,
  countNode,
  selectedNode,
  candidatesNode,
}) => {
  titleNode.textContent = teamName || 'Suggested XI';
  const selected = probableXiSelections[teamKey] ?? new Set();
  countNode.textContent = `${selected.size} / 11`;
  countNode.className = `pill ${selected.size === 11 ? 'success' : ''}`.trim();
  renderSelectedProbableXi(selectedNode, Array.from(selected));

  if (!suggestion?.available) {
    renderEmpty(candidatesNode, 'No automatic XI candidates are available for this side yet.');
    return;
  }

  const grouped = groupCandidatesByRole(suggestion.candidate_pool ?? []);
  candidatesNode.innerHTML = grouped.map((group) => `
    <section class="candidate-role-group">
      <div class="candidate-role-header">
        <strong>${group.label}</strong>
        <span>${group.items.length} options</span>
      </div>
      <div class="candidate-role-list">
        ${group.items.map((candidate) => renderCandidateChip(candidate, teamKey, selected)).join('')}
      </div>
    </section>
  `).join('');

  attachCandidateChipEvents(candidatesNode);
};

const renderProbableXiSelectors = () => {
  const visible = inputMode === 'manual';
  probableXiPanel.classList.toggle('hidden-probable-xi', !visible);

  if (!visible) {
    return;
  }

  const isPostToss = modeSelect.value === 'post_toss';
  if (manualXiEyebrow) manualXiEyebrow.textContent = isPostToss ? 'Post-toss XI editor' : 'Pre-toss lineup builder';
  if (manualXiHeading) manualXiHeading.textContent = isPostToss ? 'Set the XI you want the post-toss model to use' : 'Set the XI you want the model to assume before the toss';
  if (manualXiHelper) manualXiHelper.textContent = isPostToss
    ? 'Selections you make here apply automatically in Manual mode. Use this to replace or correct the post-toss XI the model should use.'
    : 'Selections you make here apply automatically in Manual mode. Suggestions come from recent same-season squads and can be adjusted before you run the model.';

  const suggestions = latestContext?.probable_xi_suggestions;
  const fixture = getSelectedFixture();
  renderProbableXiTeam({
    teamKey: 'team1',
    teamName: fixture?.team1,
    suggestion: suggestions?.team1,
    titleNode: team1ProbableTitle,
    countNode: team1ProbableCount,
    selectedNode: team1ProbableSelected,
    candidatesNode: team1ProbableCandidates,
  });
  renderProbableXiTeam({
    teamKey: 'team2',
    teamName: fixture?.team2,
    suggestion: suggestions?.team2,
    titleNode: team2ProbableTitle,
    countNode: team2ProbableCount,
    selectedNode: team2ProbableSelected,
    candidatesNode: team2ProbableCandidates,
  });
};

const renderSelectedFixture = () => {
  const fixture = getSelectedFixture();
  if (!fixture) {
    selectedFixture.innerHTML = '<div class="subdued">Select a fixture to begin.</div>';
    return;
  }

  selectedFixture.innerHTML = `
    <div class="eyebrow">Current fixture</div>
    <h2>${fixture.team1} vs ${fixture.team2}</h2>
    <div class="detail-grid">
      <div class="detail-block"><span class="detail-label">Start time</span><span class="detail-value">${formatShortDate(fixture.match_date)}</span></div>
      <div class="detail-block"><span class="detail-label">Venue</span><span class="detail-value">${fixture.venue ?? 'Unknown venue'}</span></div>
      <div class="detail-block"><span class="detail-label">City</span><span class="detail-value">${fixture.city ?? 'Unknown city'}</span></div>
      <div class="detail-block"><span class="detail-label">Match state</span><span class="detail-value ${fixture.is_live ? 'edge-positive' : ''}">${formatFixtureStatus(fixture)}</span></div>
      <div class="detail-block"><span class="detail-label">Home context</span><span class="detail-value">${fixture.team1_home_context ?? 'Neutral'}</span></div>
      <div class="detail-block"><span class="detail-label">Fixture ID</span><span class="detail-value">${fixture.fixture_id}</span></div>
    </div>
  `;
};

const renderAvailability = (payload) => {
  latestContext = payload;
  setProbableXiSelectionsFromSuggestions(payload);
  const automatic = payload?.automatic ?? {};
  const automaticDetails = payload?.automatic_details ?? {};
  const autoAvailable = syncInputModeWithAvailability(payload);
  const fixture = getSelectedFixture();
  const officialPostTossReady = Boolean(automatic.official_toss && automatic.official_confirmed_xi);
  const noteItems = [
    ...(payload?.notes?.pre_toss ?? []),
    ...(payload?.notes?.post_toss ?? []),
  ];

  const keyCards = modeSelect.value === 'post_toss'
    ? [
        metricCard('Model context', automatic.fixture_shell && automatic.current_elo ? 'Ready' : 'Partial', automatic.fixture_shell && automatic.current_elo ? 'edge-positive' : 'edge-negative'),
        metricCard('Official toss', automatic.official_toss ? 'Live source' : 'Fallback needed', automatic.official_toss ? 'edge-positive' : 'edge-negative'),
        metricCard('Confirmed XIs', automatic.official_confirmed_xi ? 'Live source' : 'Manual path', automatic.official_confirmed_xi ? 'edge-positive' : 'edge-negative'),
        metricCard('Market overlays', automatic.sportsbook_overlay || automatic.polymarket_overlay ? 'Available' : 'Limited', automatic.sportsbook_overlay || automatic.polymarket_overlay ? 'edge-positive' : ''),
      ]
    : [
        metricCard('Model context', automatic.fixture_shell && automatic.current_elo ? 'Ready' : 'Partial', automatic.fixture_shell && automatic.current_elo ? 'edge-positive' : 'edge-negative'),
        metricCard('Form refresh', payload?.live_feature_refresh?.applied ? 'Updated' : 'Historical only', payload?.live_feature_refresh?.applied ? 'edge-positive' : ''),
        metricCard('Probable XI assist', payload?.probable_xi_suggestions?.team1?.available && payload?.probable_xi_suggestions?.team2?.available ? 'Guided' : 'Manual only', payload?.probable_xi_suggestions?.team1?.available && payload?.probable_xi_suggestions?.team2?.available ? 'edge-positive' : ''),
        metricCard('Market overlays', automatic.sportsbook_overlay || automatic.polymarket_overlay ? 'Available' : 'Limited', automatic.sportsbook_overlay || automatic.polymarket_overlay ? 'edge-positive' : ''),
      ];

  const keyMessage = modeSelect.value === 'post_toss'
    ? (autoAvailable
        ? (inputMode === 'auto'
            ? 'Official toss and confirmed XI data are live, so Auto can use the complete post-toss context immediately.'
            : 'Official post-toss data is live, but Manual lets you replace it with your own toss or lineup assumptions if needed.')
        : 'Official post-toss data is still incomplete, so Manual is open for you to enter toss outcome and any lineup assumptions yourself.')
    : (inputMode === 'manual'
        ? (officialPostTossReady
            ? 'This match already has official toss and confirmed XI data. You can stay in Manual pre-toss mode, but switching to Post toss will let Auto use the live context.'
            : 'Manual pre-toss mode is active. Add the lineup and role assumptions you trust more than the baseline.')
        : (officialPostTossReady
            ? 'This match already has official toss and confirmed XI data. Switch to Post toss to let Auto use the live context.'
            : 'Auto pre-toss is locked until the system has real automatic pre-toss inputs for this fixture. Use Manual to set the assumptions yourself.'));

  keyStatusSummary.innerHTML = keyCards.join('');
  keyStatusNote.innerHTML = noteCard(keyMessage, true);

  const autoSummaryCards = modeSelect.value === 'post_toss'
    ? [
        metricCard('Auto source', autoAvailable ? 'Ready' : 'Locked', autoAvailable ? 'edge-positive' : 'edge-negative'),
        metricCard('Official toss', automatic.official_toss ? 'Live feed' : 'Waiting', automatic.official_toss ? 'edge-positive' : 'edge-negative'),
        metricCard('Confirmed XIs', automatic.official_confirmed_xi ? 'Live feed' : 'Waiting', automatic.official_confirmed_xi ? 'edge-positive' : 'edge-negative'),
        metricCard('Run behavior', autoAvailable ? 'Uses official match context' : 'Manual entry required'),
      ]
    : [
        metricCard('Auto source', autoAvailable ? 'Ready' : 'Locked', autoAvailable ? 'edge-positive' : 'edge-negative'),
        metricCard('Baseline context', automatic.fixture_shell && automatic.current_elo ? 'Loaded' : 'Missing', automatic.fixture_shell && automatic.current_elo ? 'edge-positive' : 'edge-negative'),
        metricCard('Form refresh', payload?.live_feature_refresh?.applied ? 'Live refresh' : 'Historical', payload?.live_feature_refresh?.applied ? 'edge-positive' : ''),
        metricCard('Run behavior', autoAvailable ? 'Uses system baseline' : 'Manual entry required'),
      ];
  autoModeSummary.innerHTML = autoSummaryCards.join('');

  if (inputMode === 'manual') {
    if (!autoAvailable) {
      inputModeMessage.textContent = getAutoLockReason(payload);
      inputModeMessage.className = 'notice-banner warning';
    } else if (modeSelect.value === 'post_toss') {
      inputModeMessage.textContent = 'Manual is active. The predictor will use the toss, lineup, and role inputs you supply instead of relying purely on the automatic post-toss path.';
      inputModeMessage.className = 'notice-banner subtle';
    } else {
      inputModeMessage.textContent = officialPostTossReady
        ? 'Manual is active. This live match already has official toss and XI data, but your manual toss, lineup, and role assumptions will be used unless you switch to Post toss Auto.'
        : 'Manual is active. The predictor will use the lineup and role assumptions you supply instead of relying purely on the automatic baseline.';
      inputModeMessage.className = 'notice-banner subtle';
    }
  } else {
    inputModeMessage.textContent = modeSelect.value === 'post_toss'
      ? 'Auto is active. The predictor will use official toss and confirmed XI data from the live feeds.'
      : 'Auto is active. The predictor will use the system baseline, live form refresh, and available market context.';
    inputModeMessage.className = 'notice-banner success';
  }

  applyInputMode({ autoAvailable });

  availabilitySummary.innerHTML = [
    metricCard('Fixture shell', automatic.fixture_shell ? 'Loaded' : 'Missing', automatic.fixture_shell ? 'edge-positive' : 'edge-negative'),
    metricCard('Current Elo', automatic.current_elo ? 'Loaded' : 'Missing', automatic.current_elo ? 'edge-positive' : 'edge-negative'),
    metricCard('Form refresh', payload?.live_feature_refresh?.applied ? 'Applied' : 'Not applied', payload?.live_feature_refresh?.applied ? 'edge-positive' : ''),
    metricCard('Sportsbooks', automatic.sportsbook_overlay ? 'Loaded' : 'Missing', automatic.sportsbook_overlay ? 'edge-positive' : ''),
    metricCard('Polymarket', automatic.polymarket_overlay ? 'Loaded' : 'Missing', automatic.polymarket_overlay ? 'edge-positive' : ''),
    metricCard('Official toss', automatic.official_toss ? 'Loaded' : 'Missing', automatic.official_toss ? 'edge-positive' : ''),
    metricCard('Official XI', automatic.official_confirmed_xi ? 'Loaded' : 'Missing', automatic.official_confirmed_xi ? 'edge-positive' : ''),
  ].join('');

  const detailItems = Object.values(automaticDetails)
    .filter((entry) => entry && entry.message)
    .map((entry) => noteCard(entry.message));

  if (noteItems.length || detailItems.length) {
    availabilityNotes.innerHTML = [
      ...noteItems.map((note) => noteCard(note)),
      ...detailItems,
    ].join('');
  } else {
    renderEmpty(availabilityNotes, 'No extra availability notes for this fixture.');
  }

  const shouldHideOverrides = inputMode !== 'manual';
  overrideSection.classList.toggle('manual-hidden', shouldHideOverrides);
  overrideSection.classList.remove('hidden-overrides');
  manualModePill.className = `pill ${inputMode === 'manual' ? 'success' : ''}`.trim();
  manualModePill.textContent = inputMode === 'manual' ? 'Manual inputs active' : 'Manual mode';
  overrideHelper.textContent = payload?.manual_input_recommendation?.message || 'Leave manual fields blank unless you have stronger information than the automatic feeds.';

  if (inputMode === 'auto' && modeSelect.value === 'post_toss' && automatic.official_toss && automatic.official_confirmed_xi) {
    setActionFeedback('Auto is active. Official toss and confirmed XI data are live and being used for this post-toss read.', 'success');
  } else if (inputMode === 'auto' && modeSelect.value === 'pre_toss') {
    setActionFeedback(officialPostTossReady || fixture?.is_live
      ? 'This match already has live post-toss data. Switch to Post toss if you want Auto to use the official toss and XI context.'
      : 'Auto pre-toss is locked for this fixture. Switch to Manual to set toss, lineup, and role assumptions yourself.', 'warning');
  } else if (inputMode === 'manual' && modeSelect.value === 'pre_toss') {
    setActionFeedback(officialPostTossReady || fixture?.is_live
      ? 'Manual pre-toss mode is active, but this match already has live post-toss data. Stay here only if you want to override it yourself; otherwise switch to Post toss.'
      : 'Manual pre-toss mode is active. You can edit the XI and add role overrides if you trust them more than the baseline.', 'subtle');
  } else if (inputMode === 'manual' && autoAvailable) {
    setActionFeedback('Manual post-toss mode is active. The predictor will use the toss or lineup inputs you supply instead of the automatic path.', 'subtle');
  } else {
    setActionFeedback('Manual post-toss mode is active. Enter toss winner, toss decision, and any lineup assumptions you trust while Auto data is unavailable.', 'warning');
  }

  renderProbableXiSelectors();
  setUiBusyState();
};

const renderFixtures = () => {
  const query = fixtureSearch.value.trim().toLowerCase();
  const filtered = getDisplayFixtures().filter((fixture) => {
    if (!query) return true;
    return [fixture.team1, fixture.team2, fixture.venue, fixture.city]
      .some((value) => String(value).toLowerCase().includes(query));
  });

  fixtureCount.textContent = String(filtered.length);
  if (!filtered.length) {
    renderEmpty(fixtureList, 'No fixtures match your search.');
    return;
  }

  const activeFixtures = filtered.filter((fixture) => !isCompletedFixture(fixture));
  const completedFixtures = filtered.filter((fixture) => isCompletedFixture(fixture));
  const renderFixtureGroup = (title, items, extraClass = '') => items.length ? `
    <div class="fixture-group-label ${extraClass}">${title}</div>
    ${items.map((fixture) => `
      <article class="fixture-card ${isCompletedFixture(fixture) ? 'fixture-card-completed' : ''} ${fixture.fixture_id === selectedFixtureId ? 'active' : ''}" data-fixture-id="${fixture.fixture_id}">
        <div class="detail-label">${formatShortDate(fixture.match_date)}</div>
        <h3>${fixture.team1} vs ${fixture.team2}</h3>
        <div class="fixture-meta">
          <div class="detail-block"><span class="detail-label">Location</span><span class="detail-value">${summarizeVenue(fixture)}</span></div>
          <div class="detail-block"><span class="detail-label">State</span><span class="detail-value ${fixture.is_live ? 'edge-positive' : ''}">${formatFixtureStatus(fixture)}</span></div>
        </div>
      </article>
    `).join('')}
  ` : '';

  fixtureList.innerHTML = [
    renderFixtureGroup('Live / upcoming', activeFixtures),
    renderFixtureGroup('Completed / stale', completedFixtures, 'muted-group'),
  ].join('');

  fixtureList.querySelectorAll('.fixture-card').forEach((card) => {
    card.addEventListener('click', () => {
      const nextFixtureId = card.dataset.fixtureId;
      if (!nextFixtureId || nextFixtureId === selectedFixtureId) return;

      selectedFixtureId = nextFixtureId;
      resetManualFormState();
      latestContext = null;
      syncModeToFixture({ forceDefault: true });
      updateTossWinnerOptions();
      renderFixtures();
      renderSelectedFixture();
      renderProbableXiSelectors();
      clearPredictionOutputs('Run a prediction for the newly selected fixture.');
      rawResponse.textContent = 'Select or run a prediction to inspect the payload.';
      void fetchContext().catch((error) => {
        setPredictionStatus('Error', 'error');
        setActionFeedback(error instanceof Error ? error.message : 'Unknown context error', 'error');
      });
    });
  });
};

const fetchContext = async () => {
  const fixture = getSelectedFixture();
  if (!fixture) {
    renderEmpty(keyStatusSummary, 'Select a fixture to inspect readiness.');
    renderEmpty(keyStatusNote, '');
    renderEmpty(availabilitySummary, 'Select a fixture to inspect automatic data.');
    renderEmpty(availabilityNotes, '');
    return;
  }

  uiState.contextLoading = true;
  setUiBusyState();
  setActionFeedback('Loading the latest match context and data availability…', 'subtle');

  try {
    const response = await fetch('/predictor/api/context', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fixtureId: fixture.fixture_id,
        mode: modeSelect.value,
      }),
    });

    if (!response.ok) {
      throw new Error(`Context request failed: ${response.status}`);
    }

    const payload = await response.json();
    renderAvailability(payload);
  } finally {
    uiState.contextLoading = false;
    setUiBusyState();
  }
};

const fetchFixtures = async () => {
  uiState.fixturesLoading = true;
  setUiBusyState();
  setPredictionStatus('Loading');
  setActionFeedback('Refreshing fixture queue and selecting the best live context…', 'subtle');

  try {
    const response = await fetch('/predictor/api/fixtures');
    if (!response.ok) throw new Error(`Fixtures request failed: ${response.status}`);

    fixtures = await response.json();
    const displayFixtures = getDisplayFixtures();
    if ((!selectedFixtureId || !fixtures.some((fixture) => fixture.fixture_id === selectedFixtureId)) && displayFixtures.length) {
      selectedFixtureId = displayFixtures[0].fixture_id;
      resetManualFormState();
      syncModeToFixture({ forceDefault: true });
    }

    updateTossWinnerOptions();
    renderFixtures();
    renderSelectedFixture();
    await fetchContext();
    setPredictionStatus('Idle');
  } finally {
    uiState.fixturesLoading = false;
    setUiBusyState();
  }
};

const renderPrediction = (payload) => {
  setPredictionStatus(payload.mode === 'post_toss' ? 'Post toss' : 'Pre toss', 'success');

  predictionSummary.innerHTML = [
    metricCard('Model pick', payload.predicted_winner, 'edge-positive'),
    metricCard(payload.team1, formatPercent(payload.team1_win_probability)),
    metricCard(payload.team2, formatPercent(payload.team2_win_probability)),
    metricCard('Fair price · Team 1', formatPrice(payload.fair_price_team1_cents)),
    metricCard('Fair price · Team 2', formatPrice(payload.fair_price_team2_cents)),
    metricCard('Fixture state', payload.fixture_status),
  ].join('');

  componentList.innerHTML = (payload.components ?? []).map((component) => `
    <article class="list-card">
      <div class="detail-grid">
        <div class="detail-block"><span class="detail-label">Component</span><span class="detail-value">${component.component}</span></div>
        <div class="detail-block"><span class="detail-label">Weight</span><span class="detail-value">${formatPercent(component.weight)}</span></div>
        <div class="detail-block"><span class="detail-label">Probability</span><span class="detail-value">${formatPercent(component.probability)}</span></div>
      </div>
    </article>
  `).join('');

  contextSummary.innerHTML = [
    metricCard('Team 1 Elo', formatNumber(payload.elo_context?.team1_elo)),
    metricCard('Team 2 Elo', formatNumber(payload.elo_context?.team2_elo)),
    metricCard('Elo gap', formatNumber(payload.elo_context?.elo_gap)),
    metricCard('Elo expected · Team 1', formatPercent(payload.elo_context?.elo_expected_team1_win)),
    metricCard('Official post-toss path', payload.official_post_toss_applied ? 'Applied' : 'Not applied', payload.official_post_toss_applied ? 'edge-positive' : ''),
    metricCard('Manual probable XI', payload.manual_probable_xi_applied ? 'Applied' : 'Not applied', payload.manual_probable_xi_applied ? 'edge-positive' : ''),
  ].join('');

  const xiContext = payload.official_post_toss_context;
  if (xiContext?.team1_confirmed_xi?.length) {
    team1Xi.innerHTML = [
      buildImpactContextCard(xiContext, 'team1'),
      ...xiContext.team1_confirmed_xi.map((player) => `<div class="list-card">${player}</div>`),
    ].join('');
  } else {
    renderEmpty(team1Xi, 'No official XI is attached to this result.');
  }

  if (xiContext?.team2_confirmed_xi?.length) {
    team2Xi.innerHTML = [
      buildImpactContextCard(xiContext, 'team2'),
      ...xiContext.team2_confirmed_xi.map((player) => `<div class="list-card">${player}</div>`),
    ].join('');
  } else {
    renderEmpty(team2Xi, 'No official XI is attached to this result.');
  }

  const market = payload.market_overlay;
  const sportsbook = payload.sportsbook_overlay;
  marketSummary.innerHTML = [
    metricCard('Book consensus · Team 1', sportsbook ? formatPercent(sportsbook.consensus_team1_probability) : '—'),
    metricCard('Book edge · Team 1', sportsbook ? formatEdge(sportsbook.team1_edge_vs_consensus) : '—', sportsbook?.team1_edge_vs_consensus > 0 ? 'edge-positive' : 'edge-negative'),
    metricCard('Polymarket · Team 1', market ? formatPercent(market.team1_market_probability) : 'No market'),
    metricCard('Polymarket edge · Team 1', market ? formatEdge(market.team1_edge_vs_market) : 'No market', market?.team1_edge_vs_market > 0 ? 'edge-positive' : 'edge-negative'),
    metricCard('Liquidity', market ? formatNumber(market.liquidity) : 'Unavailable'),
    metricCard('Volume', market ? formatNumber(market.volume) : 'Unavailable'),
  ].join('');

  if (sportsbook?.books?.length) {
    sportsbookList.innerHTML = sportsbook.books.map((book) => `
      <article class="list-card">
        <div class="detail-grid">
          <div class="detail-block"><span class="detail-label">Sportsbook</span><span class="detail-value">${book.sportsbook}</span></div>
          <div class="detail-block"><span class="detail-label">${payload.team1}</span><span class="detail-value">${formatPercent(book.team1_probability)}</span></div>
          <div class="detail-block"><span class="detail-label">${payload.team2}</span><span class="detail-value">${formatPercent(book.team2_probability)}</span></div>
          <div class="detail-block"><span class="detail-label">Max stake · Team 1</span><span class="detail-value">${formatNumber(book.team1_max_stake)}</span></div>
          <div class="detail-block"><span class="detail-label">Max stake · Team 2</span><span class="detail-value">${formatNumber(book.team2_max_stake)}</span></div>
        </div>
      </article>
    `).join('');

    if (!market) {
      sportsbookList.insertAdjacentHTML('afterbegin', `
        <article class="list-card">
          <div class="detail-grid">
            <div class="detail-block"><span class="detail-label">Polymarket</span><span class="detail-value">No matching liquid market was found for this fixture.</span></div>
          </div>
        </article>
      `);
    }
  } else {
    renderEmpty(sportsbookList, market ? 'No sportsbook overlay is available.' : 'No sportsbook or Polymarket overlay is available.');
  }

  rawResponse.textContent = JSON.stringify(payload, null, 2);
  setActionFeedback(`Prediction ready. ${payload.predicted_winner} leads the model view while the market panels show the tradable comparison.`, 'success');
};

const runPrediction = async () => {
  const fixture = getSelectedFixture();
  if (!fixture) {
    setPredictionStatus('No fixture', 'error');
    setActionFeedback('Pick a fixture before running the model.', 'error');
    return;
  }

  uiState.predictionLoading = true;
  setUiBusyState();
  setPredictionStatus('Running');
  setActionFeedback('Running the model and refreshing overlays for the selected fixture…', 'subtle');
  clearPredictionOutputs('Calculating probabilities and overlays…');

  try {
    const body = {
      fixtureId: fixture.fixture_id,
      mode: modeSelect.value,
    };

    if (inputMode === 'manual' && modeSelect.value === 'post_toss' && tossWinnerSelect.value) body.tossWinner = tossWinnerSelect.value;
    if (inputMode === 'manual' && modeSelect.value === 'post_toss' && tossDecisionSelect.value) body.tossDecision = tossDecisionSelect.value;

    if (inputMode === 'manual' && modeSelect.value === 'post_toss' && !autoInputAvailable) {
      if (!tossWinnerSelect.value || !tossDecisionSelect.value) {
        throw new Error('Manual post-toss mode needs both toss winner and toss decision while automatic toss data is unavailable.');
      }
    }

    const featureOverrides = inputMode === 'manual' ? buildFeatureOverrides() : {};
    if (Object.keys(featureOverrides).length) {
      body.featureOverrides = featureOverrides;
    }

    if (inputMode === 'manual') {
      const team1Players = Array.from(probableXiSelections.team1 ?? []);
      const team2Players = Array.from(probableXiSelections.team2 ?? []);

      if (probableXiDirty.team1) {
        if (team1Players.length !== 11) {
          throw new Error('Team 1 manual XI must contain exactly 11 players before running the model.');
        }
        body.team1ProbableXi = team1Players;
      }

      if (probableXiDirty.team2) {
        if (team2Players.length !== 11) {
          throw new Error('Team 2 manual XI must contain exactly 11 players before running the model.');
        }
        body.team2ProbableXi = team2Players;
      }
    }

    const response = await fetch('/predictor/api/predict', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? `Prediction request failed: ${response.status}`);
    }

    renderPrediction(payload);
  } finally {
    uiState.predictionLoading = false;
    setUiBusyState();
  }
};

refreshFixturesButton?.addEventListener('click', () => {
  void fetchFixtures().catch((error) => {
    setPredictionStatus('Error', 'error');
    renderEmpty(fixtureList, error instanceof Error ? error.message : 'Unknown fixtures error');
    setActionFeedback(error instanceof Error ? error.message : 'Unknown fixtures error', 'error');
  });
});

runPredictionButton?.addEventListener('click', () => {
  void runPrediction().catch((error) => {
    setPredictionStatus('Error', 'error');
    const message = error instanceof Error ? error.message : 'Unknown prediction error';
    rawResponse.textContent = message;
    setActionFeedback(message, 'error');
    clearPredictionOutputs('Prediction failed. Check the error banner and retry.');
  });
});

fixtureSearch?.addEventListener('input', renderFixtures);

modeSelect?.addEventListener('change', () => {
  inputModeTouched = false;
  void fetchContext().catch((error) => {
    setPredictionStatus('Error', 'error');
    setActionFeedback(error instanceof Error ? error.message : 'Unknown context error', 'error');
  });
});

team1LoadSuggestedButton?.addEventListener('click', () => {
  probableXiSelections.team1 = new Set(latestContext?.probable_xi_suggestions?.team1?.suggested_xi ?? []);
  probableXiDirty.team1 = true;
  renderProbableXiSelectors();
  setActionFeedback('Loaded the suggested XI for Team 1. It will be applied automatically in Manual mode.', 'success');
});

team2LoadSuggestedButton?.addEventListener('click', () => {
  probableXiSelections.team2 = new Set(latestContext?.probable_xi_suggestions?.team2?.suggested_xi ?? []);
  probableXiDirty.team2 = true;
  renderProbableXiSelectors();
  setActionFeedback('Loaded the suggested XI for Team 2. It will be applied automatically in Manual mode.', 'success');
});

inputModeAutoButton?.addEventListener('click', () => {
  if (inputModeAutoButton.disabled) return;
  setInputMode('auto');
});

inputModeManualButton?.addEventListener('click', () => {
  setInputMode('manual');
});

manualInputs.forEach((input) => {
  input?.addEventListener('input', () => {
    if (actionFeedback.classList.contains('error')) return;
    if (inputMode !== 'manual') return;
    setActionFeedback('Manual context has changed. Run the model again to apply the new assumptions.', 'subtle');
  });
});

clearPredictionOutputs('Pick a fixture, review the context, then run the model.');
applyInputMode();
setActionFeedback('Pick a fixture to load context. Live matches switch to post-toss automatically.', 'subtle');

void fetchFixtures().catch((error) => {
  setPredictionStatus('Error', 'error');
  renderEmpty(fixtureList, error instanceof Error ? error.message : 'Unknown fixtures error');
  setActionFeedback(error instanceof Error ? error.message : 'Unknown fixtures error', 'error');
});
