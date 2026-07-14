import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const SCORING_CONFIG = {
  distancePointsPerMeter: 1.1,
  speedBonusPerKmhPerSecond: 0.08,
  thermalLiftPointsPerSecond: 8,
  feedbackThresholdPoints: 5000,
  feedbackMinIntervalSeconds: 1.25,
  feedbackDurationSeconds: 2.1,
  waypointRadiusMeters: 100,
  // Meia envergadura da asa: encostar a ponta na borda do cilindro ja valida
  // o TP/GOL, sem precisar levar o piloto ate o centro.
  waypointWingMarginMeters: 6,
  waypointBonusPoints: 900,
  waypointTimeBonusPoints: 260,
  maxComboMultiplier: 5,
  comboStep: 1,
  // Percurso sorteado a cada partida: numero de TPs e distancia entre eles
  // variam para o jogador nao decorar sempre o mesmo trajeto.
  routeMinWaypoints: 4,
  routeMaxWaypoints: 10,
  routeMinLegMeters: 5000,
  routeMaxLegMeters: 10000,
  routeCandidateAttempts: 18,
  waypointSeaClearanceMeters: 140
};

export async function createScoringState({ scene, terrain, routeDefinition = null }) {
  const route = hasAuthoritativeRoute(routeDefinition)
    ? normalizeAuthoritativeRoute(routeDefinition, terrain)
    : await generateRoute(terrain);
  const markers = createWaypointMarkers(route);
  const routeLine = createRouteLine();
  if (scene) {
    scene.add(markers);
    scene.add(routeLine);
  }

  return {
    route,
    markers,
    routeLine,
    terrain,
    elapsedSeconds: 0
  };
}

// Sorteia um percurso novo a partir do ponto de decolagem (origem): cada TP
// fica de 5 a 10 km do anterior, em uma direcao aleatoria. O ultimo ponto e
// sempre o GOL. O total de TPs (incluindo o GOL) varia entre 4 e 10.
async function generateRoute(terrain) {
  const worldUnitsPerMeter = terrain?.worldUnitsPerMeter ?? 1;
  const waypointCount = THREE.MathUtils.randInt(
    SCORING_CONFIG.routeMinWaypoints,
    SCORING_CONFIG.routeMaxWaypoints
  );

  const route = [];
  let originX = 0;
  let originZ = 0;

  for (let index = 0; index < waypointCount; index += 1) {
    const candidate = await findWaypointCandidate({
      terrain,
      originX,
      originZ,
      worldUnitsPerMeter
    });
    originX = candidate.x;
    originZ = candidate.z;
    const isLast = index === waypointCount - 1;
    route.push({
      name: isLast ? 'GOL' : `TP${index + 1}`,
      x: originX,
      z: originZ
    });
  }

  return route;
}

async function findWaypointCandidate({ terrain, originX, originZ, worldUnitsPerMeter }) {
  const attempts = SCORING_CONFIG.routeCandidateAttempts;
  let fallbackCandidate = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const legMeters = THREE.MathUtils.lerp(
      SCORING_CONFIG.routeMinLegMeters,
      SCORING_CONFIG.routeMaxLegMeters,
      Math.random()
    );
    const angle = Math.random() * Math.PI * 2;
    const legWorldUnits = legMeters * worldUnitsPerMeter;
    const candidate = {
      x: originX + Math.cos(angle) * legWorldUnits,
      z: originZ + Math.sin(angle) * legWorldUnits
    };

    if (!terrain || typeof terrain.isSeaAt !== 'function' || typeof terrain.ensureHeightAt !== 'function') {
      return candidate;
    }

    fallbackCandidate ??= candidate;
    if (await isWaypointPlacementValid(candidate, terrain, worldUnitsPerMeter)) {
      return candidate;
    }
  }

  return fallbackCandidate ?? { x: originX, z: originZ };
}

async function isWaypointPlacementValid(candidate, terrain, worldUnitsPerMeter) {
  const loaded = await terrain.ensureHeightAt(candidate.x, candidate.z, 1200);
  if (!loaded) return true;

  const radiusWorldUnits = SCORING_CONFIG.waypointSeaClearanceMeters * worldUnitsPerMeter;
  const samplePoints = [
    { x: candidate.x, z: candidate.z },
    { x: candidate.x + radiusWorldUnits, z: candidate.z },
    { x: candidate.x - radiusWorldUnits, z: candidate.z },
    { x: candidate.x, z: candidate.z + radiusWorldUnits },
    { x: candidate.x, z: candidate.z - radiusWorldUnits },
    { x: candidate.x + radiusWorldUnits * 0.7, z: candidate.z + radiusWorldUnits * 0.7 },
    { x: candidate.x + radiusWorldUnits * 0.7, z: candidate.z - radiusWorldUnits * 0.7 },
    { x: candidate.x - radiusWorldUnits * 0.7, z: candidate.z + radiusWorldUnits * 0.7 },
    { x: candidate.x - radiusWorldUnits * 0.7, z: candidate.z - radiusWorldUnits * 0.7 }
  ];

  for (const point of samplePoints) {
    if (terrain.isSeaAt(point.x, point.z)) {
      return false;
    }
  }

  return true;
}

export function initializeScoringForEntities(entities) {
  for (const entity of entities) {
    entity.score = 0;
    entity.scoreBreakdown = {
      distance: 0,
      speed: 0,
      thermals: 0,
      waypoints: 0
    };
    entity.thermalCombo = 1;
    entity.bestThermalCombo = 1;
    entity.activeThermalId = null;
    entity.nextWaypointIndex = 0;
    entity.completedWaypoints = 0;
    entity.previousScoringPosition = entity.position.clone();
    entity.routeFinished = false;
    entity.lastScoringEvent = '';
    entity.scoreFeedback = null;
    entity.scoreFeedbackAccumulator = 0;
    entity.scoreFeedbackSequence = 0;
    entity.lastScoreFeedbackAt = -Infinity;
  }
}

export function updateScoring(state, delta, entities, { thermals, terrain }) {
  if (!state) return;

  state.elapsedSeconds += delta;
  updateWaypointMarkers(state, terrain);

  for (const entity of entities) {
    updateEntityScoring(entity, delta, state, { thermals, terrain });
  }

  // A guia visual da rota (linha e marcadores restantes) segue o progresso do
  // jogador; os bots pontuam na mesma sequencia, mas sem interferir no visual.
  const player = entities.find((entity) => entity.isPlayer) ?? entities[0];
  if (player) updateRouteGuidance(state, player, terrain);
}

// Linha discreta do parapente ate o proximo waypoint obrigatorio. Os TPs ja
// concluidos pelo jogador somem; ao fechar a rota, a guia inteira desaparece.
function updateRouteGuidance(state, player, terrain) {
  for (const marker of state.markers?.children ?? []) {
    marker.visible = marker.userData.waypointIndex >= (player.nextWaypointIndex ?? 0);
  }

  const line = state.routeLine;
  if (!line) return;

  const waypoint = state.route[player.nextWaypointIndex ?? 0];
  if (!waypoint || player.routeFinished || player.landed || player.crashed) {
    line.visible = false;
    return;
  }

  const groundHeight = terrain.getHeightAt(waypoint.x, waypoint.z);
  // Parte um pouco abaixo do piloto para nao atravessar a tela em primeira pessoa.
  line.geometry.setPositions([
    player.position.x, player.position.y - 6, player.position.z,
    waypoint.x, groundHeight + 18, waypoint.z
  ]);
  line.computeLineDistances();
  line.visible = true;
}

function createRouteLine() {
  const geometry = new LineGeometry();
  geometry.setPositions(new Array(6).fill(0));

  // Line2/LineMaterial (fat line) usada porque LineBasicMaterial ignora
  // linewidth no WebGL e a guia ficava fina/apagada demais para ser notada.
  // Magenta contrasta bem tanto com o ceu quanto com o terreno verde/marrom.
  const material = new LineMaterial({
    color: 0xff2f8f,
    linewidth: 5,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    // Sempre visivel (mesmo com relevo no caminho): e uma guia, nao um objeto do mundo.
    depthTest: false,
    worldUnits: false,
    dashed: false
  });
  material.resolution.set(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', () => {
    material.resolution.set(window.innerWidth, window.innerHeight);
  });

  const line = new Line2(geometry, material);
  line.name = 'RouteGuidanceLine';
  line.renderOrder = 999;
  line.frustumCulled = false;
  line.visible = false;
  return line;
}

function updateEntityScoring(entity, delta, state, { thermals, terrain }) {
  if (!entity.scoreBreakdown || !entity.previousScoringPosition) return;

  if (entity.landed || entity.crashed) {
    entity.thermalCombo = 1;
    entity.activeThermalId = null;
    entity.previousScoringPosition.copy(entity.position);
    return;
  }

  const worldUnitsPerMeter = terrain.worldUnitsPerMeter ?? 1;
  const horizontalDistanceMeters = Math.hypot(
    entity.position.x - entity.previousScoringPosition.x,
    entity.position.z - entity.previousScoringPosition.z
  ) / worldUnitsPerMeter;

  const averageSpeedBonus = Math.max(0, (entity.groundSpeedKmh ?? 0) - 26)
    * SCORING_CONFIG.speedBonusPerKmhPerSecond
    * delta;
  const distancePoints = horizontalDistanceMeters
    * SCORING_CONFIG.distancePointsPerMeter
    * (entity.thermalCombo ?? 1);

  addScore(entity, distancePoints, 'distance');
  addScore(entity, averageSpeedBonus, 'speed');
  updateThermalComboAndRiskScore(entity, delta, thermals);
  // Waypoint testa o trajeto do frame (previousScoringPosition -> position),
  // entao a posicao anterior so pode ser atualizada depois dele.
  updateWaypointScore(entity, state, terrain);
  entity.previousScoringPosition.copy(entity.position);
  maybeCreateScoreFeedback(entity, state);
}

function updateThermalComboAndRiskScore(entity, delta, thermals) {
  const interaction = thermals?.getInteractionAt(entity.position);

  if (!interaction?.thermal || interaction.lift <= 0.2 || interaction.radiusRatio >= 1) {
    entity.activeThermalId = null;
    return;
  }

  const thermalId = interaction.thermal.id;
  if (entity.activeThermalId !== thermalId) {
    entity.activeThermalId = thermalId;
    entity.thermalCombo = Math.min(
      SCORING_CONFIG.maxComboMultiplier,
      (entity.thermalCombo ?? 1) + SCORING_CONFIG.comboStep
    );
    entity.bestThermalCombo = Math.max(entity.bestThermalCombo ?? 1, entity.thermalCombo);
    entity.lastScoringEvent = `Combo ${entity.thermalCombo}x`;
  }

  const liftPoints = Math.max(0, interaction.lift)
    * SCORING_CONFIG.thermalLiftPointsPerSecond
    * interaction.riskMultiplier
    * (entity.thermalCombo ?? 1)
    * delta;
  addScore(entity, liftPoints, 'thermals');
}

function updateWaypointScore(entity, state, terrain) {
  if (entity.routeFinished) return;

  const waypoint = state.route[entity.nextWaypointIndex];
  if (!waypoint) {
    entity.routeFinished = true;
    return;
  }

  const worldUnitsPerMeter = terrain.worldUnitsPerMeter ?? 1;
  // Distancia do centro do cilindro ao trajeto percorrido neste frame, para
  // uma passada rapida de raspao na borda nao escapar entre dois frames.
  const distanceMeters = distanceToSegment2D(
    waypoint.x, waypoint.z,
    entity.previousScoringPosition.x, entity.previousScoringPosition.z,
    entity.position.x, entity.position.z
  ) / worldUnitsPerMeter;

  // Tocar a borda com a asa conta: raio do cilindro + meia envergadura.
  const touchRadiusMeters = SCORING_CONFIG.waypointRadiusMeters
    + SCORING_CONFIG.waypointWingMarginMeters;
  const waypointTouchRadiusMeters = (waypoint.radiusMeters ?? SCORING_CONFIG.waypointRadiusMeters)
    + SCORING_CONFIG.waypointWingMarginMeters;
  if (distanceMeters > waypointTouchRadiusMeters) return;

  const timeBonus = Math.max(0, SCORING_CONFIG.waypointTimeBonusPoints - state.elapsedSeconds * 0.35);
  const comboMultiplier = Math.max(1, entity.thermalCombo ?? 1);
  const waypointPoints = (SCORING_CONFIG.waypointBonusPoints + timeBonus) * comboMultiplier;
  addScore(entity, waypointPoints, 'waypoints');

  entity.completedWaypoints += 1;
  entity.nextWaypointIndex += 1;
  entity.routeFinished = entity.nextWaypointIndex >= state.route.length;
  entity.scoreFeedbackAccumulator = 0;
  entity.lastScoringEvent = `${waypoint.name} +${Math.round(waypointPoints)} pts`;
  createScoreFeedback(entity, state, {
    points: waypointPoints,
    label: entity.routeFinished ? 'GOL' : `${waypoint.name} concluido`,
    detail: entity.routeFinished
      ? 'Etapa concluida com sucesso!'
      : `Proximo: ${state.route[entity.nextWaypointIndex].name}`,
    // O informe do GOL merece ficar mais tempo na tela.
    durationSeconds: entity.routeFinished ? 5 : undefined
  });
}

function distanceToSegment2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return Math.hypot(px - ax, pz - az);
  const t = THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / lengthSq, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function addScore(entity, points, bucket) {
  if (!Number.isFinite(points) || points <= 0) return;

  entity.score += points;
  entity.scoreBreakdown[bucket] += points;
  if (bucket !== 'speed') {
    entity.scoreFeedbackAccumulator = (entity.scoreFeedbackAccumulator ?? 0) + points;
  }
}

function maybeCreateScoreFeedback(entity, state) {
  const pendingPoints = entity.scoreFeedbackAccumulator ?? 0;
  if (pendingPoints < SCORING_CONFIG.feedbackThresholdPoints) return;
  if (state.elapsedSeconds - (entity.lastScoreFeedbackAt ?? -Infinity) < SCORING_CONFIG.feedbackMinIntervalSeconds) {
    return;
  }

  entity.scoreFeedbackAccumulator = 0;
  createScoreFeedback(entity, state, {
    points: pendingPoints,
    label: 'Pontuacao',
    detail: getFeedbackDetail(entity)
  });
}

function createScoreFeedback(entity, state, { points, label, detail, durationSeconds }) {
  if (!Number.isFinite(points) || points <= 0) return;

  entity.scoreFeedbackSequence = (entity.scoreFeedbackSequence ?? 0) + 1;
  entity.lastScoreFeedbackAt = state.elapsedSeconds;
  entity.scoreFeedback = {
    id: entity.scoreFeedbackSequence,
    points: Math.round(points),
    label,
    detail,
    createdAtSeconds: state.elapsedSeconds,
    durationSeconds: durationSeconds ?? SCORING_CONFIG.feedbackDurationSeconds
  };
  entity.lastScoringEvent = `${label} +${Math.round(points)} pts`;
}

function getFeedbackDetail(entity) {
  if ((entity.thermalCombo ?? 1) > 1 && entity.verticalSpeed > 0.2) {
    return `Combo ${entity.thermalCombo}x`;
  }
  if (entity.verticalSpeed > 0.4) return 'Subida';
  return 'Voo XC';
}

function createWaypointMarkers(route) {
  const group = new THREE.Group();
  group.name = 'ScoringWaypoints';

  for (let index = 0; index < route.length; index += 1) {
    const waypoint = route[index];
    const marker = new THREE.Group();
    marker.name = `Waypoint_${waypoint.name}`;
    marker.userData.waypointIndex = index;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(waypoint.radiusMeters ?? SCORING_CONFIG.waypointRadiusMeters, 3.5, 8, 72),
      new THREE.MeshBasicMaterial({
        color: index === route.length - 1 ? 0x59d98c : 0xffd166,
        transparent: true,
        opacity: 0.65,
        depthWrite: false
      })
    );
    ring.rotation.x = Math.PI / 2;
    marker.add(ring);

    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 5, 130, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xf7fbff,
        transparent: true,
        opacity: 0.22,
        depthWrite: false
      })
    );
    beacon.position.y = 65;
    marker.add(beacon);

    const label = createWaypointLabel(waypoint.name);
    label.position.set(0, 155, 0);
    marker.add(label);

    marker.position.set(waypoint.x, 0, waypoint.z);
    group.add(marker);
  }

  return group;
}

function createWaypointLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 80;
  const context = canvas.getContext('2d');

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(12, 20, 28, 0.78)';
  context.fillRect(20, 14, 152, 52);
  context.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  context.lineWidth = 3;
  context.strokeRect(20, 14, 152, 52);
  context.fillStyle = '#f7fbff';
  context.font = '700 30px Arial, Helvetica, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false
  }));
  sprite.scale.set(64, 27, 1);
  return sprite;
}

function updateWaypointMarkers(state, terrain) {
  if (!state.markers) return;

  for (const marker of state.markers.children) {
    const waypoint = state.route[marker.userData.waypointIndex];
    const groundHeight = terrain.getHeightAt(waypoint.x, waypoint.z);
    marker.position.set(waypoint.x, groundHeight + 18, waypoint.z);
  }
}

function hasAuthoritativeRoute(routeDefinition) {
  return Array.isArray(routeDefinition?.waypoints) && routeDefinition.waypoints.length > 0;
}

function normalizeAuthoritativeRoute(routeDefinition, terrain) {
  const worldUnitsPerMeter = terrain?.worldUnitsPerMeter ?? 1;
  return routeDefinition.waypoints.map((waypoint, index) => ({
    name: waypoint.label ?? waypoint.name ?? (index === routeDefinition.waypoints.length - 1 ? 'GOL' : `TP${index + 1}`),
    x: Number(waypoint.x ?? 0) * worldUnitsPerMeter,
    z: Number(waypoint.z ?? 0) * worldUnitsPerMeter,
    radiusMeters: Number(waypoint.radiusMeters ?? SCORING_CONFIG.waypointRadiusMeters)
  }));
}
