// Assistente de centralizacao em termica: guia o piloto ate o centro (ponto
// de maior subida). Dois modos, seguindo o toggle de ajudas visuais do jogo:
// - Ajuda (padrao): aponta o nucleo real da termica mais proxima em que o
//   piloto esta (via thermals.getInteractionAt), com distancia exata.
// - Realista: estima o centro apenas pelos dados do vario, como instrumentos
//   reais — centroide do trajeto recente ponderado pela taxa de subida.
// O anel de setores por rumo (visual do HUD) e alimentado nos dois modos.
export const THERMAL_ASSISTANT_SECTOR_COUNT = 16;

const SECTOR_ANGLE_RADIANS = (Math.PI * 2) / THERMAL_ASSISTANT_SECTOR_COUNT;
// Meia-vida curta: o anel reflete a ultima volta, nao todo o voo.
const SECTOR_DECAY_HALF_LIFE_SECONDS = 9;
const MIN_SECTOR_WEIGHT_SECONDS = 0.15;
const CLIMB_THRESHOLD_MS = 0.1;

// Modo realista: amostras do trajeto (posicao XZ + subida medida).
const SAMPLE_INTERVAL_SECONDS = 0.3;
const SAMPLE_WINDOW_SECONDS = 25;
const MAX_SAMPLES = Math.ceil(SAMPLE_WINDOW_SECONDS / SAMPLE_INTERVAL_SECONDS);
const SAMPLE_DECAY_HALF_LIFE_SECONDS = 12;
// Cobertura minima de subida acumulada antes de confiar na estimativa (~1 volta).
const MIN_CLIMB_WEIGHT_SECONDS = 3;

export function createThermalAssistant() {
  return {
    liftSum: new Array(THERMAL_ASSISTANT_SECTOR_COUNT).fill(0),
    weight: new Array(THERMAL_ASSISTANT_SECTOR_COUNT).fill(0),
    samples: [],
    sampleTimer: 0,
    elapsedSeconds: 0,
    active: false,
    relativeBearingDegrees: 0,
    distanceMeters: 0,
    strength: 0
  };
}

export function updateThermalAssistant(assistant, delta, player, { thermals, useRealCore } = {}) {
  assistant.elapsedSeconds += delta;
  updateSectors(assistant, delta, player);

  if (player.landed) {
    assistant.active = false;
    return;
  }

  if (useRealCore && thermals) {
    updateFromRealCore(assistant, player, thermals);
    return;
  }

  updateFromEstimate(assistant, delta, player);
}

// Modo ajuda: nucleo real da termica em que o piloto esta agora.
function updateFromRealCore(assistant, player, thermals) {
  const interaction = thermals.getInteractionAt?.(player.position);
  const thermal = interaction?.thermal;

  if (!thermal) {
    assistant.active = false;
    return;
  }

  setCoreTarget(
    assistant,
    player,
    thermal.position.x,
    thermal.position.z,
    thermal.strength * (thermal.cycleFactor ?? 1)
  );
}

// Modo realista: centroide das posicoes recentes ponderado pela subida medida.
// Sem subida recente suficiente, o instrumento fica inativo (sem dados).
function updateFromEstimate(assistant, delta, player) {
  assistant.sampleTimer += delta;
  if (assistant.sampleTimer >= SAMPLE_INTERVAL_SECONDS) {
    assistant.sampleTimer = 0;
    assistant.samples.push({
      x: player.position.x,
      z: player.position.z,
      lift: player.verticalSpeed ?? 0,
      atSeconds: assistant.elapsedSeconds
    });
    if (assistant.samples.length > MAX_SAMPLES) assistant.samples.shift();
  }

  let weightTotal = 0;
  let centroidX = 0;
  let centroidZ = 0;
  let bestLift = 0;

  for (const sample of assistant.samples) {
    if (sample.lift <= CLIMB_THRESHOLD_MS) continue;

    const age = assistant.elapsedSeconds - sample.atSeconds;
    if (age > SAMPLE_WINDOW_SECONDS) continue;

    // Peso = subida x recencia: amostras fortes e frescas mandam no centroide.
    const weight = sample.lift * Math.pow(0.5, age / SAMPLE_DECAY_HALF_LIFE_SECONDS)
      * SAMPLE_INTERVAL_SECONDS;
    weightTotal += weight;
    centroidX += sample.x * weight;
    centroidZ += sample.z * weight;
    bestLift = Math.max(bestLift, sample.lift);
  }

  if (weightTotal < MIN_CLIMB_WEIGHT_SECONDS * CLIMB_THRESHOLD_MS
    || weightTotal === 0
    || getClimbCoverageSeconds(assistant) < MIN_CLIMB_WEIGHT_SECONDS) {
    assistant.active = false;
    return;
  }

  setCoreTarget(assistant, player, centroidX / weightTotal, centroidZ / weightTotal, bestLift);
}

function getClimbCoverageSeconds(assistant) {
  let coverage = 0;
  for (const sample of assistant.samples) {
    const age = assistant.elapsedSeconds - sample.atSeconds;
    if (age <= SAMPLE_WINDOW_SECONDS && sample.lift > CLIMB_THRESHOLD_MS) {
      coverage += SAMPLE_INTERVAL_SECONDS;
    }
  }
  return coverage;
}

function setCoreTarget(assistant, player, coreX, coreZ, strength) {
  const dx = coreX - player.position.x;
  const dz = coreZ - player.position.z;
  const distance = Math.hypot(dx, dz);

  // Rumo mundial ate o centro na mesma convencao do heading interno
  // (0 = -Z, positivo vira a esquerda), depois relativo ao rumo atual —
  // pronto para `transform: rotate()` como a seta de vento do HUD.
  const bearingToCore = Math.atan2(-dx, -dz);
  const relativeRadians = normalizeSignedAngle((player.heading ?? 0) - bearingToCore);

  assistant.active = true;
  assistant.relativeBearingDegrees = relativeRadians * (180 / Math.PI);
  assistant.distanceMeters = distance;
  assistant.strength = strength;
}

// Anel de setores: subida media por rumo da ultima volta (visual do HUD).
function updateSectors(assistant, delta, player) {
  const decay = Math.pow(0.5, delta / SECTOR_DECAY_HALF_LIFE_SECONDS);
  for (let index = 0; index < THERMAL_ASSISTANT_SECTOR_COUNT; index += 1) {
    assistant.liftSum[index] *= decay;
    assistant.weight[index] *= decay;
  }

  const heading = normalizeAngle(player.heading ?? 0);
  const sectorIndex = Math.floor(heading / SECTOR_ANGLE_RADIANS) % THERMAL_ASSISTANT_SECTOR_COUNT;
  assistant.liftSum[sectorIndex] += (player.verticalSpeed ?? 0) * delta;
  assistant.weight[sectorIndex] += delta;
}

export function getThermalAssistantSectors(assistant, player) {
  const heading = normalizeAngle(player.heading ?? 0);
  const sectors = [];

  for (let index = 0; index < THERMAL_ASSISTANT_SECTOR_COUNT; index += 1) {
    const hasData = assistant.weight[index] >= MIN_SECTOR_WEIGHT_SECONDS;
    const average = hasData ? assistant.liftSum[index] / assistant.weight[index] : 0;
    const sectorCenter = (index + 0.5) * SECTOR_ANGLE_RADIANS;
    const relativeRadians = normalizeSignedAngle(heading - sectorCenter);

    sectors.push({
      relativeBearingDegrees: relativeRadians * (180 / Math.PI),
      average,
      hasData
    });
  }

  return sectors;
}

function normalizeAngle(radians) {
  const twoPi = Math.PI * 2;
  return ((radians % twoPi) + twoPi) % twoPi;
}

function normalizeSignedAngle(radians) {
  const twoPi = Math.PI * 2;
  return radians - twoPi * Math.round(radians / twoPi);
}
