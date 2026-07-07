import * as THREE from 'three';

const FLIGHT_PHYSICS = {
  landingClearance: 0.75,
  collisionRadius: 18,
  collisionHeight: 12,
  entangledSinkRate: -1,
  entangledOrbitRadius: 5.5,
  entangledSpinRate: 3.8,
  entangledWindInfluence: 0.08,
  // Pouso: acima destes limites no toque, o piloto "colide" (pouso duro).
  crashVerticalSpeed: -3,
  crashAirspeedKmh: 48,
  // Flare: freiar perto do chao converte energia em reducao de afundamento.
  flareHeightMeters: 7,
  flareLiftMetersPerSecond: 1.6,
  flareDurationSeconds: 1.4
};

const GRAVITY = 9.81;
const TURN_SINK_LOAD_EXPONENT = 1.25;

// Curva polar de um parapente classe EN-B:
// - freios fundos (~25 km/h): afunda ~1.45 m/s
// - trim (~38 km/h): afunda ~1.05 m/s (planeio ~10:1)
// - barra cheia (~55 km/h): afunda ~2.3 m/s (planeio ~6.6:1)
// Interpolada por parabola que passa pelos tres pontos.
const POLAR = {
  minSpeedKmh: 25,
  trimSpeedKmh: 38,
  maxSpeedKmh: 55,
  sinkAtMin: -1.45,
  sinkAtTrim: -1.05,
  sinkAtMax: -2.3
};

const polarCoefficients = computePolarCoefficients();

function computePolarCoefficients() {
  const x1 = POLAR.minSpeedKmh;
  const x2 = POLAR.trimSpeedKmh;
  const x3 = POLAR.maxSpeedKmh;
  const y1 = POLAR.sinkAtMin;
  const y2 = POLAR.sinkAtTrim;
  const y3 = POLAR.sinkAtMax;
  const a = ((y3 - y1) / ((x3 - x1) * (x3 - x2))) - ((y2 - y1) / ((x2 - x1) * (x3 - x2)));
  const b = (y2 - y1) / (x2 - x1) - a * (x1 + x2);
  const c = y1 - a * x1 * x1 - b * x1;
  return { a, b, c };
}

export function getPolarSinkRate(speedKmh) {
  const speed = THREE.MathUtils.clamp(speedKmh, POLAR.minSpeedKmh, POLAR.maxSpeedKmh);
  const { a, b, c } = polarCoefficients;
  return a * speed * speed + b * speed + c;
}

export const POLAR_SPEEDS = {
  minSpeedKmh: POLAR.minSpeedKmh,
  trimSpeedKmh: POLAR.trimSpeedKmh,
  maxSpeedKmh: POLAR.maxSpeedKmh
};

const tempWind = new THREE.Vector3();
const tempForward = new THREE.Vector3();
const tempRight = new THREE.Vector3();
const tempHorizontalVelocity = new THREE.Vector3();
const tempPairCenter = new THREE.Vector3();

// Teto realista para voo de parapente: acima de ~30 km/h nao se decola.
// O vento reportado e o de altitude; perto do solo ele e reduzido pelo
// gradiente (atrito com o terreno) em getWindGradientFactor.
const WIND_CONFIG = {
  minSpeedKmh: 8,
  maxSpeedKmh: 28,
  initialDirectionRadians: Math.atan2(3.2, 1.1),
  directionVariationDegrees: 42,
  // Frequencias incomensuraveis somadas geram variacao aperiodica (pseudo-ruido):
  // uma onda lenta de massa de ar + rajadas curtas por cima.
  slowCycleRates: [0.031, 0.0117],
  gustCycleRates: [0.23, 0.61],
  gustFraction: 0.3,
  directionChangeRates: [0.05, 0.017],
  // Gradiente de vento: fracao do vento de altitude que resta junto ao solo
  // e altura (m acima do relevo) em que o vento atinge forca total.
  groundWindFraction: 0.5,
  fullWindHeightMeters: 220
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
  // Gradiente de vento: perto do relevo o vento e mais fraco que em altitude.
  const windGradientFactor = getWindGradientFactor(entity.groundClearance ?? 0);
  const windRelativeVelocity = getWindRelativeVelocity(forward, wind, windGradientFactor);
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
  entity.windAngleStepDegrees = windRelativeVelocity.angleDegrees;
  entity.windAdjustedSpeedKmh = entity.speed + metersPerSecondToKmh(windRelativeVelocity.headwindComponent);

  // Afundamento pela curva polar, agravado pelo fator de carga na curva:
  // inclinar para girar custa altitude (n = 1/cos(bank), sink ~ n^1.5).
  const bankAngle = Math.atan(
    ((entity.turnRate ?? 0) * Math.max(forwardMetersPerSecond, 4)) / GRAVITY
  );
  entity.bankAngle = bankAngle;
  const loadFactor = 1 / Math.max(Math.cos(bankAngle), 0.4);
  const polarSink = getPolarSinkRate(entity.speed) * Math.pow(loadFactor, TURN_SINK_LOAD_EXPONENT);

  const thermalLift = thermals?.getLiftAt(entity.position) ?? 0;
  const ridgeLift = orographicLift?.getLiftAt(entity.position, { terrain, wind }) ?? 0;
  entity.verticalSpeed = polarSink + thermalLift + ridgeLift;
  applyFlare(entity, delta);
  entity.position.y += entity.verticalSpeed * delta;

  const groundHeight = terrain.getHeightAt(entity.position.x, entity.position.z);
  const landingHeight = groundHeight + FLIGHT_PHYSICS.landingClearance;

  if (entity.position.y <= landingHeight) {
    const crashed = entity.verticalSpeed <= FLIGHT_PHYSICS.crashVerticalSpeed
      || entity.speed >= FLIGHT_PHYSICS.crashAirspeedKmh;
    entity.position.y = landingHeight;
    entity.velocity.set(0, 0, 0);
    entity.speed = 0;
    entity.targetSpeed = 0;
    entity.groundSpeedKmh = 0;
    entity.windAdjustedSpeedKmh = 0;
    entity.verticalSpeed = 0;
    entity.landed = true;
    entity.crashed = crashed;
  }

  updateAltitudeMetrics(entity, terrain);
}

// Segurar os freios (tecla S) perto do chao arredonda o pouso: consome uma
// reserva unica de energia (flareCharge) que amortece o afundamento.
function applyFlare(entity, delta) {
  if (!entity.input?.backward) return;
  if ((entity.groundClearance ?? Infinity) > FLIGHT_PHYSICS.flareHeightMeters) return;
  if (!(entity.flareCharge > 0)) return;

  entity.verticalSpeed += FLIGHT_PHYSICS.flareLiftMetersPerSecond * Math.min(1, entity.flareCharge);
  entity.flareCharge = Math.max(0, entity.flareCharge - delta / FLIGHT_PHYSICS.flareDurationSeconds);
}

function getWindGradientFactor(groundClearanceMeters) {
  const heightRatio = THREE.MathUtils.clamp(
    groundClearanceMeters / WIND_CONFIG.fullWindHeightMeters,
    0,
    1
  );
  // Perfil suave (raiz quadrada) lembra o gradiente logaritmico real.
  return THREE.MathUtils.lerp(WIND_CONFIG.groundWindFraction, 1, Math.sqrt(heightRatio));
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

export function detectVegetationCollisions(entities, vegetation, terrain) {
  if (!vegetation || typeof vegetation.getCollisionAt !== 'function') return;

  for (const entity of entities) {
    if (!canCollide(entity)) continue;

    const tree = vegetation.getCollisionAt(entity.position);
    if (!tree) continue;

    const groundHeight = terrain.getRenderedHeightAt
      ? terrain.getRenderedHeightAt(entity.position.x, entity.position.z)
      : terrain.getHeightAt(entity.position.x, entity.position.z);

    entity.position.y = groundHeight + FLIGHT_PHYSICS.landingClearance;
    entity.velocity.set(0, 0, 0);
    entity.speed = 0;
    entity.targetSpeed = 0;
    entity.groundSpeedKmh = 0;
    entity.windAdjustedSpeedKmh = 0;
    entity.verticalSpeed = 0;
    entity.landed = true;
    entity.crashed = true;
    entity.collisionSource = 'tree';
    updateAltitudeMetrics(entity, terrain);
    if (typeof entity.applyLandingPose === 'function') entity.applyLandingPose();
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
        // Cair enroscado apos colisao em voo conta como acidente.
        entity.crashed = true;
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
  // Massa de ar lenta + rajadas curtas; frequencias incomensuraveis evitam
  // que o padrao se repita de forma perceptivel.
  const [slowA, slowB] = WIND_CONFIG.slowCycleRates;
  const [gustA, gustB] = WIND_CONFIG.gustCycleRates;
  const slowWave = (Math.sin(elapsedSeconds * slowA) * 0.6
    + Math.sin(elapsedSeconds * slowB + 2.1) * 0.4 + 1) / 2;
  const gustWave = (Math.sin(elapsedSeconds * gustA + 1.7) * 0.6
    + Math.sin(elapsedSeconds * gustB + 0.4) * 0.4 + 1) / 2;
  const mixedWave = slowWave * (1 - WIND_CONFIG.gustFraction) + gustWave * WIND_CONFIG.gustFraction;
  const speedKmh = THREE.MathUtils.lerp(WIND_CONFIG.minSpeedKmh, WIND_CONFIG.maxSpeedKmh, mixedWave);
  const [directionA, directionB] = WIND_CONFIG.directionChangeRates;
  const directionWave = Math.sin(elapsedSeconds * directionA) * 0.7
    + Math.sin(elapsedSeconds * directionB + 1.3) * 0.3;
  const directionRadians = (wind.baseDirectionRadians ?? WIND_CONFIG.initialDirectionRadians)
    + directionWave
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

function getWindRelativeVelocity(forward, wind, gradientFactor = 1) {
  tempForward.copy(forward).normalize();
  tempRight.set(-tempForward.z, 0, tempForward.x);

  const windSpeed = wind.length() * gradientFactor;
  if (windSpeed <= 0.0001) {
    tempWind.set(0, 0, 0);
    tempWind.angleDegrees = 0;
    tempWind.headwindComponent = 0;
    return tempWind;
  }

  const windDirection = tempWind.copy(wind).normalize();
  const signedAngle = Math.atan2(
    windDirection.dot(tempRight),
    windDirection.dot(tempForward)
  );
  const angleDegrees = THREE.MathUtils.radToDeg(signedAngle);
  const headwindComponent = windSpeed * Math.cos(signedAngle);
  const crosswindComponent = windSpeed * Math.sin(signedAngle);

  tempWind
    .copy(tempForward)
    .multiplyScalar(headwindComponent)
    .addScaledVector(tempRight, crosswindComponent);
  tempWind.angleDegrees = normalizeSignedDegrees(angleDegrees);
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
