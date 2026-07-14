import { THERMAL_ASSISTANT_SECTOR_COUNT, getThermalAssistantSectors } from './thermalAssistant.js?v=2';

export function createRoundState() {
  return {
    elapsedSeconds: 0,
    ended: false,
    endReason: null,
    totalMatches: null,
    remoteRanking: []
  };
}

export function updateRoundState(round, delta, player) {
  if (round.ended) return;

  round.elapsedSeconds += delta;

  if (player.landed) {
    round.ended = true;
    round.endReason = player.crashed ? 'crashed' : 'landed';
  }
}

// Fita de bussola: pixels por grau de rumo (define quanto do horizonte cabe).
const COMPASS_PX_PER_DEGREE = 1.6;
const COMPASS_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const THERMAL_RING_RADIUS_PX = 30;

export function createHud(root) {
  root.innerHTML = `
    <div class="hud-instrument">
      <div class="instr-top"><span data-hud="time">00:00</span><span data-hud="status">Voando</span></div>
      <div class="instr-alts">
        <div class="instr-cell instr-cell--altitude"><span>ALTITUDE</span><strong data-hud="altitude">0</strong><em>m nivel do mar</em></div>
        <div class="instr-cell instr-cell--clearance"><span>SOLO</span><strong data-hud="groundClearance">0</strong><em>m</em></div>
      </div>
      <div class="instr-vario">
        <div class="vario-bar"><div class="vario-fill" data-hud="varioFill"></div></div>
        <div class="vario-value" data-hud="varioBox"><strong data-hud="vario">0.0</strong><em>M/S</em></div>
      </div>
      <div class="instr-row">
        <div class="instr-cell instr-cell--speed"><span>VEL</span><strong data-hud="speed">0</strong><em>km/h solo</em></div>
        <div class="instr-cell instr-cell--glide"><span>PLANEIO</span><strong data-hud="glide">--</strong><em>:1</em></div>
        <div class="instr-cell instr-cell--wind"><span>VENTO</span><strong class="wind-readout"><span data-hud="windArrow">&#8593;</span><span data-hud="wind">0</span></strong><em>km/h</em></div>
      </div>
      <div class="instr-compass">
        <div class="compass-tape" data-hud="compassTape"></div>
        <div class="compass-marker"></div>
      </div>
      <div class="instr-distance"><span>DIST. DECOLAGEM</span><strong data-hud="distance">0 m</strong></div>
      <div class="instr-score">
        <div class="instr-score-card instr-score-card--score"><span>PONTOS</span><strong data-hud="score">0</strong></div>
        <div class="instr-score-card instr-score-card--combo"><span>COMBO</span><strong data-hud="combo">1x</strong></div>
        <div class="instr-score-card instr-score-card--waypoint"><span>ROTA</span><strong data-hud="waypoint">TP1</strong></div>
      </div>
      <div class="instr-meta"><span>PARTIDAS</span><strong data-hud="totalMatches">--</strong></div>
      <div class="hud-radio" data-hud="radioRoot">
        <div class="hud-radio-head">
          <span data-hud="radioLabel">Radio livre</span>
          <strong data-hud="radioSpeaker">--</strong>
        </div>
        <button class="hud-radio-button" type="button" data-hud="radioButton">Segure para falar</button>
      </div>
      <div class="instr-event" data-hud="scoreEvent"></div>
    </div>
    <div class="hud-thermal-card" data-hud="thermalAssistant">
      <div class="hud-thermal-title">Assistente termico</div>
      <div class="instr-thermal">
        <div class="thermal-ring" data-hud="thermalRing">
          <div class="thermal-arrow" data-hud="thermalArrow">&#8593;</div>
          <div class="thermal-core"></div>
        </div>
        <div class="thermal-label" data-hud="thermalLabel">Centralize</div>
      </div>
    </div>
    <div class="hud-ranking">
      <div class="hud-ranking-title" data-hud="rankingTitle">Ranking</div>
      <ol data-hud="ranking"></ol>
    </div>
    <div class="score-pop" data-hud="scorePop" aria-live="polite">
      <span data-hud="scorePopLabel">Pontuacao</span>
      <strong data-hud="scorePopPoints">+0 pts</strong>
      <em data-hud="scorePopDetail">Voo XC</em>
    </div>
  `;

  const compassTape = root.querySelector('[data-hud="compassTape"]');
  buildCompassTape(compassTape);

  const thermalRing = root.querySelector('[data-hud="thermalRing"]');
  const thermalSectors = buildThermalRing(thermalRing);

  return {
    time: root.querySelector('[data-hud="time"]'),
    altitude: root.querySelector('[data-hud="altitude"]'),
    groundClearance: root.querySelector('[data-hud="groundClearance"]'),
    vario: root.querySelector('[data-hud="vario"]'),
    varioBox: root.querySelector('[data-hud="varioBox"]'),
    varioFill: root.querySelector('[data-hud="varioFill"]'),
    speed: root.querySelector('[data-hud="speed"]'),
    glide: root.querySelector('[data-hud="glide"]'),
    wind: root.querySelector('[data-hud="wind"]'),
    windArrow: root.querySelector('[data-hud="windArrow"]'),
    compassTape,
    distance: root.querySelector('[data-hud="distance"]'),
    score: root.querySelector('[data-hud="score"]'),
    combo: root.querySelector('[data-hud="combo"]'),
    waypoint: root.querySelector('[data-hud="waypoint"]'),
    totalMatches: root.querySelector('[data-hud="totalMatches"]'),
    radioRoot: root.querySelector('[data-hud="radioRoot"]'),
    radioLabel: root.querySelector('[data-hud="radioLabel"]'),
    radioSpeaker: root.querySelector('[data-hud="radioSpeaker"]'),
    radioButton: root.querySelector('[data-hud="radioButton"]'),
    scoreEvent: root.querySelector('[data-hud="scoreEvent"]'),
    scorePop: root.querySelector('[data-hud="scorePop"]'),
    scorePopLabel: root.querySelector('[data-hud="scorePopLabel"]'),
    scorePopPoints: root.querySelector('[data-hud="scorePopPoints"]'),
    scorePopDetail: root.querySelector('[data-hud="scorePopDetail"]'),
    status: root.querySelector('[data-hud="status"]'),
    rankingTitle: root.querySelector('[data-hud="rankingTitle"]'),
    ranking: root.querySelector('[data-hud="ranking"]'),
    thermalAssistant: root.querySelector('[data-hud="thermalAssistant"]'),
    thermalArrow: root.querySelector('[data-hud="thermalArrow"]'),
    thermalLabel: root.querySelector('[data-hud="thermalLabel"]'),
    thermalSectors
  };
}

// Anel do assistente de termica: um marcador por setor de rumo, posicionado
// radialmente e depois colorido/rotacionado a cada frame conforme os dados
// acumulados em thermalAssistant.js (mesma tecnica da fita de bussola acima).
function buildThermalRing(container) {
  const sectors = [];

  for (let index = 0; index < THERMAL_ASSISTANT_SECTOR_COUNT; index += 1) {
    const tick = document.createElement('div');
    tick.className = 'thermal-sector';
    container.append(tick);
    sectors.push(tick);
  }

  return sectors;
}

// Constroi tres voltas completas de fita (-360 a 720 graus) para que qualquer
// rumo centrado tenha vizinhos dos dois lados sem costura visivel.
function buildCompassTape(container) {
  for (let degrees = -360; degrees <= 720; degrees += 15) {
    const normalized = ((degrees % 360) + 360) % 360;
    const isMajor = normalized % 45 === 0;

    const tick = document.createElement('div');
    tick.className = isMajor ? 'compass-tick compass-tick--major' : 'compass-tick';
    tick.style.left = `${degrees * COMPASS_PX_PER_DEGREE}px`;
    container.append(tick);

    if (isMajor) {
      const label = document.createElement('div');
      label.className = 'compass-label';
      label.textContent = COMPASS_LABELS[normalized / 45];
      label.style.left = `${degrees * COMPASS_PX_PER_DEGREE}px`;
      container.append(label);
    }
  }
}

export function updateHud(elements, { player, bots = [], terrain, round, wind, scoring, thermalAssistant, radio }) {
  const playerAltitude = getAltitudeMetrics(player, terrain);
  const bearingDegrees = getBearingDegrees(player.heading ?? 0);

  elements.time.textContent = formatTime(round.elapsedSeconds);
  elements.altitude.textContent = Math.round(playerAltitude.seaLevel).toLocaleString('pt-BR');
  elements.groundClearance.textContent = Math.round(playerAltitude.groundClearance).toLocaleString('pt-BR');
  elements.vario.textContent = formatSigned(player.verticalSpeed, 1);
  updateVarioVisuals(elements, player.verticalSpeed);
  if (thermalAssistant) updateThermalAssistantVisuals(elements, thermalAssistant, player);
  elements.speed.textContent = `${Math.round(player.groundSpeedKmh ?? player.speed)}`;
  elements.glide.textContent = getGlideRatioText(player);
  elements.wind.textContent = `${Math.round(wind?.speedKmh ?? 0)}`;
  // Seta relativa ao rumo (calculada pela fisica): para cima = vento de
  // cauda, para baixo = de frente, lados = deriva lateral.
  const relativeWindDegrees = player.windAngleDegrees ?? 0;
  elements.windArrow.style.transform = `rotate(${Math.round(relativeWindDegrees)}deg)`;
  elements.compassTape.style.transform = `translateX(${-bearingDegrees * COMPASS_PX_PER_DEGREE}px)`;
  elements.distance.textContent = formatDistance(getStraightLineDistance(player));
  elements.score.textContent = formatScore(player.score ?? 0);
  elements.combo.textContent = `${player.thermalCombo ?? 1}x`;
  elements.waypoint.textContent = getWaypointText(player, scoring, terrain);
  elements.totalMatches.textContent = formatMatchCount(round.totalMatches);
  updateRadioHud(elements, radio);
  elements.scoreEvent.textContent = player.lastScoringEvent ?? '';
  updateScorePop(elements, player, scoring);
  elements.status.textContent = getStatusText(round, player);
  elements.rankingTitle.textContent = round.remoteRanking?.length
    ? 'Rampa online'
    : (round.ended ? 'Ranking final' : 'Ranking');
  elements.ranking.innerHTML = round.remoteRanking?.length
    ? getNetworkRankingRows(round.remoteRanking).join('')
    : getRankingRows([
      { name: 'Voce', entity: player },
      ...bots.map((bot) => ({ name: bot.name, entity: bot }))
    ], terrain).join('');
}

function updateRadioHud(elements, radio) {
  const label = radio?.hudLabel ?? 'Radio indisponivel';
  const speaker = radio?.speakerName ?? '--';
  const remaining = radio?.remainingText ?? '';
  elements.radioLabel.textContent = label;
  elements.radioSpeaker.textContent = remaining ? `${speaker} · ${remaining}` : speaker;
  elements.radioRoot.classList.toggle('is-occupied', radio?.channelStatus === 'occupied');
  elements.radioRoot.classList.toggle('is-transmitting', radio?.clientStatus === 'transmitting');
  elements.radioButton.disabled = !radio?.buttonEnabled;
  elements.radioButton.textContent = radio?.buttonText ?? 'Segure para falar';
}

function updateScorePop(elements, player, scoring) {
  const feedback = player.scoreFeedback;
  const elapsedSeconds = scoring?.elapsedSeconds ?? 0;
  const isVisible = feedback
    && elapsedSeconds - feedback.createdAtSeconds <= feedback.durationSeconds;

  elements.scorePop.classList.toggle('is-visible', Boolean(isVisible));
  if (!isVisible) return;

  elements.scorePopLabel.textContent = feedback.label;
  elements.scorePopPoints.textContent = `+${formatScore(feedback.points)} pts`;
  elements.scorePopDetail.textContent = feedback.detail ?? '';
}

// Rumo bussola a partir do heading interno (0 = -Z = norte; positivo vira a esquerda).
function getBearingDegrees(headingRadians) {
  const degrees = -headingRadians * (180 / Math.PI);
  return ((degrees % 360) + 360) % 360;
}

function updateVarioVisuals(elements, verticalSpeed) {
  const clamped = Math.max(-4, Math.min(4, verticalSpeed));
  const heightPercent = (Math.abs(clamped) / 4) * 50;
  const fill = elements.varioFill.style;

  if (clamped >= 0) {
    fill.top = 'auto';
    fill.bottom = '50%';
    fill.backgroundColor = '#59d98c';
  } else {
    fill.top = '50%';
    fill.bottom = 'auto';
    fill.backgroundColor = '#ff6b66';
  }
  fill.height = `${heightPercent}%`;

  elements.varioBox.classList.toggle('is-climb', verticalSpeed > 0.1);
  // Afundamento normal de planeio (~-1 m/s) fica neutro; so alerta em sink forte.
  elements.varioBox.classList.toggle('is-sink', verticalSpeed < -2);
}

// Assistente de centralizacao: seta aponta o centro da termica (real ou
// estimado pelo vario, conforme o modo) e o rotulo mostra forca e distancia.
const THERMAL_CENTERED_DISTANCE_METERS = 10;

function updateThermalAssistantVisuals(elements, thermalAssistant, player) {
  const isUsable = thermalAssistant.active;

  elements.thermalAssistant.classList.toggle('is-active', isUsable);

  const sectors = getThermalAssistantSectors(thermalAssistant, player);
  for (let index = 0; index < THERMAL_ASSISTANT_SECTOR_COUNT; index += 1) {
    const sector = sectors[index];
    const tick = elements.thermalSectors[index];

    tick.style.transform = `rotate(${sector.relativeBearingDegrees}deg) translate(-50%, -${THERMAL_RING_RADIUS_PX}px)`;
    tick.style.opacity = sector.hasData ? getThermalSectorOpacity(sector.average) : 0.12;
    tick.style.backgroundColor = sector.average >= 0 ? '#59d98c' : '#ff6b66';
  }

  if (!isUsable) {
    elements.thermalArrow.style.transform = 'rotate(0deg)';
    elements.thermalArrow.style.opacity = 0.3;
    elements.thermalLabel.textContent = 'Centralize';
    return;
  }

  const distance = thermalAssistant.distanceMeters;
  const strengthText = `${formatSigned(thermalAssistant.strength, 1)} m/s`;
  elements.thermalArrow.style.transform = `rotate(${thermalAssistant.relativeBearingDegrees}deg)`;

  if (distance < THERMAL_CENTERED_DISTANCE_METERS) {
    // No nucleo: some a seta para o piloto so manter a curva.
    elements.thermalArrow.style.opacity = 0;
    elements.thermalLabel.textContent = `No centro · ${strengthText}`;
  } else {
    elements.thermalArrow.style.opacity = 1;
    elements.thermalLabel.textContent = `${strengthText} · ${Math.round(distance)} m`;
  }
}

function getThermalSectorOpacity(averageLift) {
  const clamped = Math.max(-1, Math.min(2, averageLift));
  return 0.25 + (Math.abs(clamped) / 2) * 0.75;
}

// Razao de planeio instantanea sobre o solo (velocidade horizontal / descida).
function getGlideRatioText(player) {
  if (player.landed) return '--';

  const groundSpeedMs = (player.groundSpeedKmh ?? 0) / 3.6;
  if (player.verticalSpeed >= -0.05) return '∞';

  const ratio = groundSpeedMs / -player.verticalSpeed;
  return Math.min(ratio, 99).toFixed(1);
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatSigned(value, digits) {
  const formatted = value.toFixed(digits);
  return value > 0 ? `+${formatted}` : formatted;
}

function getStatusText(round, player) {
  if (player.crashed || round.endReason === 'crashed') return 'Colidiu';
  if (round.endReason === 'landed' || player.landed) return 'Pousou';
  if (player.entangled) return 'Enroscado';
  return 'Voando';
}

function getRankingRows(entries, terrain) {
  return [...entries]
    .sort((a, b) => compareRankingEntries(a, b, terrain))
    .map(({ name, entity }) => {
      const state = entity.landed ? (entity.crashed ? 'colidiu' : 'pousou') : 'voando';
      const status = entity.entangled ? 'enroscado' : state;
      const altitude = getAltitudeMetrics(entity, terrain);
      const waypointText = entity.routeFinished
        ? 'rota completa'
        : `${entity.completedWaypoints ?? 0} TP`;
      return `<li><span>${name}</span><strong>${formatScore(entity.score ?? 0)} pts / ${formatDistance(getStraightLineDistance(entity))} / ${Math.round(altitude.groundClearance)} m solo</strong><em>${status} / combo ${entity.thermalCombo ?? 1}x / ${waypointText}</em></li>`;
    });
}

function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function compareRankingEntries(a, b, terrain) {
  const scoreDelta = (b.entity.score ?? 0) - (a.entity.score ?? 0);
  if (Math.abs(scoreDelta) > 0.5) return scoreDelta;

  if (a.entity.landed !== b.entity.landed) {
    return a.entity.landed ? 1 : -1;
  }

  const altitudeDelta = getAltitudeMetrics(b.entity, terrain).groundClearance
    - getAltitudeMetrics(a.entity, terrain).groundClearance;
  if (Math.abs(altitudeDelta) > 0.5) return altitudeDelta;

  return getStraightLineDistance(b.entity) - getStraightLineDistance(a.entity);
}

function formatScore(score) {
  return Math.round(score).toLocaleString('pt-BR');
}

function formatMatchCount(totalMatches) {
  if (!Number.isFinite(totalMatches)) return '--';
  return Math.round(totalMatches).toLocaleString('pt-BR');
}

function getNetworkRankingRows(entries) {
  return entries.map((entry) => {
    const distance = formatDistance(entry.distanceFromStart ?? 0);
    const altitude = Math.round(entry.groundClearance ?? 0);
    return `<li><span>${entry.displayName ?? entry.playerId}</span><strong>${formatScore(entry.score ?? 0)} pts / ${distance} / ${altitude} m solo</strong><em>${entry.status ?? 'conectado'} / combo ${entry.combo ?? 1}x / ${entry.completedWaypoints ?? 0} TP</em></li>`;
  });
}

// Rota no painel: nome do proximo TP + distancia em linha reta ate ele.
function getWaypointText(player, scoring, terrain) {
  if (player.routeFinished) return 'Completa';

  const waypoint = scoring?.route?.[player.nextWaypointIndex ?? 0];
  if (!waypoint) return '--';

  const worldUnitsPerMeter = terrain?.worldUnitsPerMeter ?? 1;
  const distanceMeters = Math.hypot(
    waypoint.x - player.position.x,
    waypoint.z - player.position.z
  ) / worldUnitsPerMeter;

  return `${waypoint.name} · ${formatShortDistance(distanceMeters)}`;
}

// Formato curto para caber na celula do painel (uma casa decimal em km).
function formatShortDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function getStraightLineDistance(entity) {
  return Number.isFinite(entity.distanceFromStart)
    ? entity.distanceFromStart
    : entity.distanceTravelled;
}

function getAltitudeMetrics(entity, terrain) {
  const seaLevel = Number.isFinite(entity.altitudeAboveSeaLevel)
    ? entity.altitudeAboveSeaLevel
    : entity.position.y;
  const groundHeight = Number.isFinite(entity.groundHeight)
    ? entity.groundHeight
    : terrain.getHeightAt(entity.position.x, entity.position.z);
  const groundClearance = Number.isFinite(entity.groundClearance)
    ? entity.groundClearance
    : Math.max(0, seaLevel - groundHeight);

  return { seaLevel, groundHeight, groundClearance };
}
