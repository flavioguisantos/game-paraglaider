import * as THREE from 'three';

const SCORING_CONFIG = {
  distancePointsPerMeter: 1.1,
  speedBonusPerKmhPerSecond: 0.08,
  thermalLiftPointsPerSecond: 8,
  feedbackThresholdPoints: 1000,
  feedbackMinIntervalSeconds: 1.25,
  feedbackDurationSeconds: 2.1,
  waypointRadiusMeters: 85,
  waypointBonusPoints: 900,
  waypointTimeBonusPoints: 260,
  maxComboMultiplier: 5,
  comboStep: 1,
  route: [
    { name: 'TP1', x: -420, z: -1350 },
    { name: 'TP2', x: 760, z: -2750 },
    { name: 'GOL', x: -260, z: -4050 }
  ]
};

export function createScoringState({ scene, terrain }) {
  const markers = createWaypointMarkers();
  if (scene) scene.add(markers);

  return {
    route: SCORING_CONFIG.route.map((waypoint) => ({ ...waypoint })),
    markers,
    terrain,
    elapsedSeconds: 0
  };
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
  entity.previousScoringPosition.copy(entity.position);

  const averageSpeedBonus = Math.max(0, (entity.groundSpeedKmh ?? 0) - 26)
    * SCORING_CONFIG.speedBonusPerKmhPerSecond
    * delta;
  const distancePoints = horizontalDistanceMeters
    * SCORING_CONFIG.distancePointsPerMeter
    * (entity.thermalCombo ?? 1);

  addScore(entity, distancePoints, 'distance');
  addScore(entity, averageSpeedBonus, 'speed');
  updateThermalComboAndRiskScore(entity, delta, thermals);
  updateWaypointScore(entity, state, terrain);
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
  const distanceMeters = Math.hypot(
    entity.position.x - waypoint.x,
    entity.position.z - waypoint.z
  ) / worldUnitsPerMeter;

  if (distanceMeters > SCORING_CONFIG.waypointRadiusMeters) return;

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
    label: waypoint.name,
    detail: entity.routeFinished ? 'Rota completa' : 'Checkpoint'
  });
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

function createScoreFeedback(entity, state, { points, label, detail }) {
  if (!Number.isFinite(points) || points <= 0) return;

  entity.scoreFeedbackSequence = (entity.scoreFeedbackSequence ?? 0) + 1;
  entity.lastScoreFeedbackAt = state.elapsedSeconds;
  entity.scoreFeedback = {
    id: entity.scoreFeedbackSequence,
    points: Math.round(points),
    label,
    detail,
    createdAtSeconds: state.elapsedSeconds,
    durationSeconds: SCORING_CONFIG.feedbackDurationSeconds
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

function createWaypointMarkers() {
  const group = new THREE.Group();
  group.name = 'ScoringWaypoints';

  for (let index = 0; index < SCORING_CONFIG.route.length; index += 1) {
    const waypoint = SCORING_CONFIG.route[index];
    const marker = new THREE.Group();
    marker.name = `Waypoint_${waypoint.name}`;
    marker.userData.waypointIndex = index;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(SCORING_CONFIG.waypointRadiusMeters, 3.5, 8, 72),
      new THREE.MeshBasicMaterial({
        color: index === SCORING_CONFIG.route.length - 1 ? 0x59d98c : 0xffd166,
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
