const ROUND_DURATION_SECONDS = 180;

export function createRoundState(durationSeconds = ROUND_DURATION_SECONDS) {
  return {
    durationSeconds,
    elapsedSeconds: 0,
    ended: false,
    endReason: null
  };
}

export function updateRoundState(round, delta, player) {
  if (round.ended) return;

  round.elapsedSeconds = Math.min(round.elapsedSeconds + delta, round.durationSeconds);

  if (player.landed) {
    round.ended = true;
    round.endReason = 'landed';
    return;
  }

  if (round.elapsedSeconds >= round.durationSeconds) {
    round.ended = true;
    round.endReason = 'time';
  }
}

export function createHud(root) {
  root.innerHTML = `
    <div class="hud-title">Jogo Parapente 3D</div>
    <div class="hud-phase">Fase 7: polimento</div>
    <div class="hud-grid">
      <span>Tempo</span><strong data-hud="time">03:00</strong>
      <span>Altitude</span><strong data-hud="altitude">0 m</strong>
      <span>Solo</span><strong data-hud="groundClearance">0 m</strong>
      <span>Vario</span><strong data-hud="vario">0.0 m/s</strong>
      <span>Velocidade</span><strong data-hud="speed">0 m/s</strong>
      <span>Distancia</span><strong data-hud="distance">0 m</strong>
      <span>Status</span><strong data-hud="status">Voando</strong>
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
    distance: root.querySelector('[data-hud="distance"]'),
    status: root.querySelector('[data-hud="status"]'),
    rankingTitle: root.querySelector('[data-hud="rankingTitle"]'),
    ranking: root.querySelector('[data-hud="ranking"]')
  };
}

export function updateHud(elements, { player, bots = [], terrain, round }) {
  const remainingSeconds = Math.max(0, round.durationSeconds - round.elapsedSeconds);
  const groundHeight = terrain.getHeightAt(player.position.x, player.position.z);
  const groundClearance = Math.max(0, player.position.y - groundHeight);

  elements.time.textContent = formatTime(remainingSeconds);
  elements.altitude.textContent = `${Math.round(player.position.y)} m`;
  elements.groundClearance.textContent = `${Math.round(groundClearance)} m`;
  elements.vario.textContent = `${formatSigned(player.verticalSpeed, 1)} m/s`;
  elements.speed.textContent = `${Math.round(player.speed)} m/s`;
  elements.distance.textContent = `${Math.round(player.distanceTravelled)} m`;
  elements.status.textContent = getStatusText(round, player);
  elements.rankingTitle.textContent = round.ended ? 'Ranking final' : 'Ranking';
  elements.ranking.innerHTML = getRankingRows([
    { name: 'Voce', entity: player },
    ...bots.map((bot) => ({ name: bot.name, entity: bot }))
  ]).join('');
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
  if (round.endReason === 'time') return 'Tempo encerrado';
  if (round.endReason === 'landed' || player.landed) return 'Pousou';
  return 'Voando';
}

function getRankingRows(entries) {
  return [...entries]
    .sort(compareRankingEntries)
    .map(({ name, entity }) => {
      const state = entity.landed ? 'pousou' : 'voando';
      const altitude = Math.round(entity.position.y);
      const distance = Math.round(entity.distanceTravelled);
      return `<li><span>${name}</span><strong>${altitude} m / ${distance} m</strong><em>${state}</em></li>`;
    });
}

function compareRankingEntries(a, b) {
  if (a.entity.landed !== b.entity.landed) {
    return a.entity.landed ? 1 : -1;
  }

  const altitudeDelta = b.entity.position.y - a.entity.position.y;
  if (Math.abs(altitudeDelta) > 0.5) return altitudeDelta;

  return b.entity.distanceTravelled - a.entity.distanceTravelled;
}
