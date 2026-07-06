export function createRoundState() {
  return {
    elapsedSeconds: 0,
    ended: false,
    endReason: null
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

export function createHud(root) {
  root.innerHTML = `
    <div class="hud-instrument">
      <div class="instr-top"><span data-hud="time">00:00</span><span data-hud="status">Voando</span></div>
      <div class="instr-alts">
        <div class="instr-cell"><span>ALTITUDE</span><strong data-hud="altitude">0</strong><em>m nivel do mar</em></div>
        <div class="instr-cell"><span>SOLO</span><strong data-hud="groundClearance">0</strong><em>m</em></div>
      </div>
      <div class="instr-vario">
        <div class="vario-bar"><div class="vario-fill" data-hud="varioFill"></div></div>
        <div class="vario-value" data-hud="varioBox"><strong data-hud="vario">0.0</strong><em>M/S</em></div>
      </div>
      <div class="instr-row">
        <div class="instr-cell"><span>VEL</span><strong data-hud="speed">0</strong><em>km/h solo</em></div>
        <div class="instr-cell"><span>PLANEIO</span><strong data-hud="glide">--</strong><em>:1</em></div>
        <div class="instr-cell"><span>VENTO</span><strong class="wind-readout"><span data-hud="windArrow">&#8593;</span><span data-hud="wind">0</span></strong><em>km/h</em></div>
      </div>
      <div class="instr-compass">
        <div class="compass-tape" data-hud="compassTape"></div>
        <div class="compass-marker"></div>
      </div>
      <div class="instr-distance"><span>DIST. DECOLAGEM</span><strong data-hud="distance">0 m</strong></div>
      <div class="instr-score">
        <div><span>PONTOS</span><strong data-hud="score">0</strong></div>
        <div><span>COMBO</span><strong data-hud="combo">1x</strong></div>
        <div><span>ROTA</span><strong data-hud="waypoint">TP1</strong></div>
      </div>
      <div class="instr-event" data-hud="scoreEvent"></div>
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
    scoreEvent: root.querySelector('[data-hud="scoreEvent"]'),
    scorePop: root.querySelector('[data-hud="scorePop"]'),
    scorePopLabel: root.querySelector('[data-hud="scorePopLabel"]'),
    scorePopPoints: root.querySelector('[data-hud="scorePopPoints"]'),
    scorePopDetail: root.querySelector('[data-hud="scorePopDetail"]'),
    status: root.querySelector('[data-hud="status"]'),
    rankingTitle: root.querySelector('[data-hud="rankingTitle"]'),
    ranking: root.querySelector('[data-hud="ranking"]')
  };
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

export function updateHud(elements, { player, bots = [], terrain, round, wind, scoring }) {
  const playerAltitude = getAltitudeMetrics(player, terrain);
  const bearingDegrees = getBearingDegrees(player.heading ?? 0);

  elements.time.textContent = formatTime(round.elapsedSeconds);
  elements.altitude.textContent = Math.round(playerAltitude.seaLevel).toLocaleString('pt-BR');
  elements.groundClearance.textContent = Math.round(playerAltitude.groundClearance).toLocaleString('pt-BR');
  elements.vario.textContent = formatSigned(player.verticalSpeed, 1);
  updateVarioVisuals(elements, player.verticalSpeed);
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
  elements.waypoint.textContent = getWaypointText(player, scoring);
  elements.scoreEvent.textContent = player.lastScoringEvent ?? '';
  updateScorePop(elements, player, scoring);
  elements.status.textContent = getStatusText(round, player);
  elements.rankingTitle.textContent = round.ended ? 'Ranking final' : 'Ranking';
  elements.ranking.innerHTML = getRankingRows([
    { name: 'Voce', entity: player },
    ...bots.map((bot) => ({ name: bot.name, entity: bot }))
  ], terrain).join('');
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

function getWaypointText(player, scoring) {
  if (player.routeFinished) return 'GOL';

  const waypoint = scoring?.route?.[player.nextWaypointIndex ?? 0];
  return waypoint?.name ?? '--';
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
