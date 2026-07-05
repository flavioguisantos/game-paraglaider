import * as THREE from 'three';

const FLIGHT_PHYSICS = {
  sinkRate: -2,
  windAngleStepDegrees: 10,
  landingClearance: 0.75,
  collisionRadius: 18,
  collisionHeight: 12,
  entangledSinkRate: -1,
  entangledOrbitRadius: 5.5,
  entangledSpinRate: 3.8,
  entangledWindInfluence: 0.08
};

const tempWind = new THREE.Vector3();
const tempForward = new THREE.Vector3();
const tempRight = new THREE.Vector3();
const tempHorizontalVelocity = new THREE.Vector3();
const tempPairCenter = new THREE.Vector3();

// Teto realista para voo de parapente: acima de ~30 km/h nao se decola.
// Tambem evita bots a favor do vento com velocidade real muito acima do padrao.
const WIND_CONFIG = {
  minSpeedKmh: 8,
  maxSpeedKmh: 30,
  initialDirectionRadians: Math.atan2(3.2, 1.1),
  directionVariationDegrees: 42,
  directionChangeRate: 0.08,
  speedCycleRate: 0.11,
  gustCycleRate: 0.37
};

export function createWindState(options = {}) {
  const wind = new THREE.Vector3();
  wind.elapsedSeconds = 0;
  wind.speedKmh = 0;
  wind.baseDirectionRadians = options.directionRadians ?? WIND_CONFIG.initialDirectionRadians;
  wind.directionVariationRadians = THREE.MathUtils.degToRad(
    options.directionVariationDegrees ?? WIND_CONFIG.directionVariationDegrees
  );
  wind.directionRadians = wind.baseDirectionRadians;
  wind.directionDegrees = 0;
  updateWindVector(wind, 0);
  return wind;
}

export function configureWind(wind, options = {}) {
  if (!wind) return;

  wind.elapsedSeconds = 0;
  wind.baseDirectionRadians = options.directionRadians ?? WIND_CONFIG.initialDirectionRadians;
  wind.directionVariationRadians = THREE.MathUtils.degToRad(
    options.directionVariationDegrees ?? WIND_CONFIG.directionVariationDegrees
  );
  updateWindVector(wind, 0);
}

export function updateWind(wind, delta) {
  wind.elapsedSeconds += delta;
  updateWindVector(wind, wind.elapsedSeconds);
}

export function applyFlightPhysics(entity, delta, { terrain, thermals, orographicLift, wind }) {
  if (entity.landed || entity.entangled) return;

  const forward = entity.getForwardVector();
  const windRelativeVelocity = getSteppedWindRelativeVelocity(forward, wind);
  const worldUnitsPerMeter = terrain.worldUnitsPerMeter ?? 1;
  const forwardMetersPerSecond = kmhToMetersPerSecond(entity.speed);

  tempHorizontalVelocity
    .copy(forward)
    .multiplyScalar(forwardMetersPerSecond)
    .add(windRelativeVelocity);

  entity.velocity.set(
    tempHorizontalVelocity.x * worldUnitsPerMeter,
    0,
    tempHorizontalVelocity.z * worldUnitsPerMeter
  );

  entity.position.addScaledVector(entity.velocity, delta);
  entity.distanceTravelled += tempHorizontalVelocity.length() * delta;
  updateDistanceFromStart(entity, terrain);
  entity.groundSpeedKmh = metersPerSecondToKmh(tempHorizontalVelocity.length());
  entity.windAngleDegrees = windRelativeVelocity.angleDegrees;
  entity.windAngleStepDegrees = windRelativeVelocity.steppedAngleDegrees;
  entity.windAdjustedSpeedKmh = entity.speed + metersPerSecondToKmh(windRelativeVelocity.headwindComponent);

  const thermalLift = thermals?.getLiftAt(entity.position) ?? 0;
  const ridgeLift = orographicLift?.getLiftAt(entity.position, { terrain, wind }) ?? 0;
  const lift = thermalLift + ridgeLift;
  entity.verticalSpeed = FLIGHT_PHYSICS.sinkRate + lift;
  entity.position.y += entity.verticalSpeed * delta;

  const groundHeight = terrain.getHeightAt(entity.position.x, entity.position.z);
  const landingHeight = groundHeight + FLIGHT_PHYSICS.landingClearance;

  if (entity.position.y <= landingHeight) {
    entity.position.y = landingHeight;
    entity.velocity.set(0, 0, 0);
    entity.speed = 0;
    entity.targetSpeed = 0;
    entity.groundSpeedKmh = 0;
    entity.windAdjustedSpeedKmh = 0;
    entity.verticalSpeed = 0;
    entity.landed = true;
  }

  updateAltitudeMetrics(entity, terrain);
}

export function updateAltitudeMetrics(entity, terrain) {
  const groundHeight = terrain.getHeightAt(entity.position.x, entity.position.z);
  entity.groundHeight = groundHeight;
  entity.altitudeAboveSeaLevel = entity.position.y;
  entity.groundClearance = Math.max(0, entity.position.y - groundHeight);
}

export function updateDistanceFromStart(entity, terrain) {
  const worldUnitsPerMeter = terrain.worldUnitsPerMeter ?? 1;
  const start = entity.launchPosition ?? entity.startPosition;
  if (!start) {
    entity.distanceFromStart = entity.distanceTravelled ?? 0;
    return;
  }

  entity.distanceFromStart = Math.hypot(
    entity.position.x - start.x,
    entity.position.z - start.z
  ) / worldUnitsPerMeter;
}

export function detectParagliderCollisions(entities) {
  for (let aIndex = 0; aIndex < entities.length; aIndex += 1) {
    const first = entities[aIndex];
    if (!canCollide(first)) continue;

    for (let bIndex = aIndex + 1; bIndex < entities.length; bIndex += 1) {
      const second = entities[bIndex];
      if (!canCollide(second)) continue;

      const horizontalDistance = Math.hypot(
        first.position.x - second.position.x,
        first.position.z - second.position.z
      );
      const verticalDistance = Math.abs(first.position.y - second.position.y);

      if (
        horizontalDistance <= FLIGHT_PHYSICS.collisionRadius &&
        verticalDistance <= FLIGHT_PHYSICS.collisionHeight
      ) {
        entangleParagliders(first, second);
      }
    }
  }
}

export function updateEntangledParagliders(entities, delta, { terrain, wind }) {
  const pairs = new Map();

  for (const entity of entities) {
    if (!entity.entangled || entity.landed || !entity.entanglementId) continue;
    if (!pairs.has(entity.entanglementId)) pairs.set(entity.entanglementId, []);
    pairs.get(entity.entanglementId).push(entity);
  }

  for (const pair of pairs.values()) {
    if (pair.length < 2) continue;

    tempPairCenter.set(0, 0, 0);
    for (const entity of pair) tempPairCenter.add(entity.position);
    tempPairCenter.multiplyScalar(1 / pair.length);

    tempWind.copy(wind).multiplyScalar(FLIGHT_PHYSICS.entangledWindInfluence * delta);
    tempPairCenter.x += tempWind.x;
    tempPairCenter.z += tempWind.z;
    tempPairCenter.y += FLIGHT_PHYSICS.entangledSinkRate * delta;

    let hasLanded = false;
    for (const entity of pair) {
      const groundHeight = terrain.getHeightAt(entity.position.x, entity.position.z);
      if (tempPairCenter.y <= groundHeight + FLIGHT_PHYSICS.landingClearance) {
        hasLanded = true;
        break;
      }
    }

    for (let index = 0; index < pair.length; index += 1) {
      const entity = pair[index];
      const angle = entity.entanglementSpin + index * Math.PI;
      const x = tempPairCenter.x + Math.cos(angle) * FLIGHT_PHYSICS.entangledOrbitRadius;
      const z = tempPairCenter.z + Math.sin(angle) * FLIGHT_PHYSICS.entangledOrbitRadius;
      const groundHeight = terrain.getHeightAt(x, z);

      entity.entanglementSpin += FLIGHT_PHYSICS.entangledSpinRate * delta;
      entity.verticalSpeed = hasLanded ? 0 : FLIGHT_PHYSICS.entangledSinkRate;
      entity.velocity.set(0, entity.verticalSpeed, 0);
      entity.speed = 0;
      entity.targetSpeed = 0;
      entity.position.set(
        x,
        hasLanded ? groundHeight + FLIGHT_PHYSICS.landingClearance : tempPairCenter.y,
        z
      );
      updateAltitudeMetrics(entity, terrain);

      entity.group.rotation.y = angle;
      entity.group.rotation.x = Math.sin(entity.entanglementSpin * 1.7) * 0.65;
      entity.group.rotation.z = Math.cos(entity.entanglementSpin * 1.3) * 0.85;

      if (hasLanded) {
        entity.landed = true;
        entity.entangled = false;
        entity.entanglementId = null;
        if (typeof entity.applyLandingPose === 'function') entity.applyLandingPose();
      }
    }
  }
}

export function createWindVector(options = {}) {
  return createWindState(options);
}

function kmhToMetersPerSecond(value) {
  return value / 3.6;
}

function metersPerSecondToKmh(value) {
  return value * 3.6;
}

function updateWindVector(wind, elapsedSeconds) {
  const speedWave = (Math.sin(elapsedSeconds * WIND_CONFIG.speedCycleRate) + 1) / 2;
  const gustWave = (Math.sin(elapsedSeconds * WIND_CONFIG.gustCycleRate + 1.7) + 1) / 2;
  const mixedWave = speedWave * 0.72 + gustWave * 0.28;
  const speedKmh = THREE.MathUtils.lerp(WIND_CONFIG.minSpeedKmh, WIND_CONFIG.maxSpeedKmh, mixedWave);
  const directionRadians = (wind.baseDirectionRadians ?? WIND_CONFIG.initialDirectionRadians)
    + Math.sin(elapsedSeconds * WIND_CONFIG.directionChangeRate)
      * (wind.directionVariationRadians ?? THREE.MathUtils.degToRad(WIND_CONFIG.directionVariationDegrees));
  const speedMetersPerSecond = kmhToMetersPerSecond(speedKmh);

  wind.set(
    -Math.sin(directionRadians) * speedMetersPerSecond,
    0,
    -Math.cos(directionRadians) * speedMetersPerSecond
  );
  wind.speedKmh = speedKmh;
  wind.directionRadians = directionRadians;
  wind.directionDegrees = normalizeDegrees(THREE.MathUtils.radToDeg(directionRadians));
}

function getSteppedWindRelativeVelocity(forward, wind) {
  tempForward.copy(forward).normalize();
  tempRight.set(-tempForward.z, 0, tempForward.x);

  const windSpeed = wind.length();
  if (windSpeed <= 0.0001) {
    tempWind.set(0, 0, 0);
    tempWind.angleDegrees = 0;
    tempWind.steppedAngleDegrees = 0;
    tempWind.headwindComponent = 0;
    return tempWind;
  }

  const windDirection = tempWind.copy(wind).normalize();
  const signedAngle = Math.atan2(
    windDirection.dot(tempRight),
    windDirection.dot(tempForward)
  );
  const angleDegrees = THREE.MathUtils.radToDeg(signedAngle);
  const steppedAngleDegrees = Math.round(angleDegrees / FLIGHT_PHYSICS.windAngleStepDegrees)
    * FLIGHT_PHYSICS.windAngleStepDegrees;
  const steppedAngleRadians = THREE.MathUtils.degToRad(steppedAngleDegrees);
  const headwindComponent = windSpeed * Math.cos(steppedAngleRadians);
  const crosswindComponent = windSpeed * Math.sin(steppedAngleRadians);

  tempWind
    .copy(tempForward)
    .multiplyScalar(headwindComponent)
    .addScaledVector(tempRight, crosswindComponent);
  tempWind.angleDegrees = normalizeSignedDegrees(angleDegrees);
  tempWind.steppedAngleDegrees = normalizeSignedDegrees(steppedAngleDegrees);
  tempWind.headwindComponent = headwindComponent;
  return tempWind;
}

function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function normalizeSignedDegrees(degrees) {
  const normalized = ((degrees + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function canCollide(entity) {
  return entity && !entity.landed && !entity.entangled;
}

function entangleParagliders(first, second) {
  const id = `entangled-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  first.entangled = true;
  second.entangled = true;
  first.entanglementId = id;
  second.entanglementId = id;
  first.entanglementSpin = 0;
  second.entanglementSpin = Math.PI;
  first.verticalSpeed = FLIGHT_PHYSICS.entangledSinkRate;
  second.verticalSpeed = FLIGHT_PHYSICS.entangledSinkRate;
  first.speed = 0;
  second.speed = 0;
  first.targetSpeed = 0;
  second.targetSpeed = 0;
}
