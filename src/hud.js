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
    round.endReason = 'landed';
  }
}

export function createHud(root) {
  root.innerHTML = `
    <div class="hud-title">Jogo Parapente 3D</div>
    <div class="hud-phase">Fase 7: polimento</div>
    <div class="hud-grid">
      <div class="flight-metric"><span>Tempo</span><strong data-hud="time">00:00</strong></div>
      <div class="flight-metric"><span>Solo</span><strong data-hud="groundClearance">0 m</strong></div>
      <div class="flight-metric"><span>Vario</span><strong data-hud="vario">0.0 m/s</strong></div>
      <div class="flight-metric"><span>Vel.</span><strong data-hud="speed">0 km/h</strong></div>
      <div class="flight-metric flight-metric--secondary"><span>Vento</span><strong class="wind-readout"><span data-hud="windArrow">↑</span><span data-hud="wind">0 km/h</span></strong></div>
      <div class="flight-metric flight-metric--secondary"><span>Nivel mar</span><strong data-hud="altitude">0 m</strong></div>
      <div class="flight-metric flight-metric--secondary"><span>Dist.</span><strong data-hud="distance">0 m</strong></div>
      <div class="flight-metric flight-metric--secondary"><span>Status</span><strong data-hud="status">Voando</strong></div>
    </div>
    <div class="hud-ranking">
      <div class="hud-ranking-title" data-hud="rankingTitle">Ranking</div>
      <ol data-hud="ranking"></ol>
    </div>
  `;

  return {
    time: root.querySelector('[data-hud="time"]'),
    altitude: root.querySelector('[data-hud="altitude"]'),
    groundClearance: root.querySelector('[data-hud="groundClearance"]'),
    vario: root.querySelector('[data-hud="vario"]'),
    speed: root.querySelector('[data-hud="speed"]'),
    wind: root.querySelector('[data-hud="wind"]'),
    windArrow: root.querySelector('[data-hud="windArrow"]'),
    distance: root.querySelector('[data-hud="distance"]'),
    status: root.querySelector('[data-hud="status"]'),
    rankingTitle: root.querySelector('[data-hud="rankingTitle"]'),
    ranking: root.querySelector('[data-hud="ranking"]')
  };
}

export function updateHud(elements, { player, bots = [], terrain, round, wind }) {
  const playerAltitude = getAltitudeMetrics(player, terrain);

  elements.time.textContent = formatTime(round.elapsedSeconds);
  elements.altitude.textContent = `${Math.round(playerAltitude.seaLevel)} m`;
  elements.groundClearance.textContent = `${Math.round(playerAltitude.groundClearance)} m`;
  elements.vario.textContent = `${formatSigned(player.verticalSpeed, 1)} m/s`;
  elements.speed.textContent = `${Math.round(player.groundSpeedKmh ?? player.speed)} km/h`;
  elements.wind.textContent = `${Math.round(wind?.speedKmh ?? 0)} km/h`;
  elements.windArrow.style.transform = `rotate(${Math.round(wind?.directionDegrees ?? 0)}deg)`;
  elements.distance.textContent = formatDistance(getStraightLineDistance(player));
  elements.status.textContent = getStatusText(round, player);
  elements.rankingTitle.textContent = round.ended ? 'Ranking final' : 'Ranking';
  elements.ranking.innerHTML = getRankingRows([
    { name: 'Voce', entity: player },
    ...bots.map((bot) => ({ name: bot.name, entity: bot }))
  ], terrain).join('');
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
  if (round.endReason === 'landed' || player.landed) return 'Pousou';
  if (player.entangled) return 'Enroscado';
  return 'Voando';
}

function getRankingRows(entries, terrain) {
  return [...entries]
    .sort((a, b) => compareRankingEntries(a, b, terrain))
    .map(({ name, entity }) => {
      const state = entity.landed ? 'pousou' : 'voando';
      const status = entity.entangled ? 'enroscado' : state;
      const altitude = getAltitudeMetrics(entity, terrain);
      return `<li><span>${name}</span><strong>${Math.round(altitude.groundClearance)} m solo / ${Math.round(altitude.seaLevel)} m mar / ${formatDistance(getStraightLineDistance(entity))}</strong><em>${status}</em></li>`;
    });
}

function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function compareRankingEntries(a, b, terrain) {
  if (a.entity.landed !== b.entity.landed) {
    return a.entity.landed ? 1 : -1;
  }

  const altitudeDelta = getAltitudeMetrics(b.entity, terrain).groundClearance
    - getAltitudeMetrics(a.entity, terrain).groundClearance;
  if (Math.abs(altitudeDelta) > 0.5) return altitudeDelta;

  return getStraightLineDistance(b.entity) - getStraightLineDistance(a.entity);
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
