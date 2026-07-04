import * as THREE from 'three';

const FLIGHT_PHYSICS = {
  sinkRate: -2,
  windInfluence: 0.24,
  landingClearance: 0.75,
  collisionRadius: 18,
  collisionHeight: 12,
  entangledSinkRate: -6,
  entangledOrbitRadius: 5.5,
  entangledSpinRate: 3.8,
  entangledWindInfluence: 0.08
};

const tempWind = new THREE.Vector3();
const tempHorizontalVelocity = new THREE.Vector3();
const tempPairCenter = new THREE.Vector3();

export function applyFlightPhysics(entity, delta, { terrain, thermals, wind }) {
  if (entity.landed || entity.entangled) return;

  const forward = entity.getForwardVector();
  const worldUnitsPerMeter = terrain.worldUnitsPerMeter ?? 1;
  const forwardMetersPerSecond = kmhToMetersPerSecond(entity.speed);
  tempWind.copy(wind).multiplyScalar(FLIGHT_PHYSICS.windInfluence);
  tempHorizontalVelocity
    .copy(forward)
    .multiplyScalar(forwardMetersPerSecond)
    .add(tempWind);

  entity.velocity.set(
    tempHorizontalVelocity.x * worldUnitsPerMeter,
    0,
    tempHorizontalVelocity.z * worldUnitsPerMeter
  );

  entity.position.addScaledVector(entity.velocity, delta);
  entity.distanceTravelled += tempHorizontalVelocity.length() * delta;

  const lift = thermals.getLiftAt(entity.position);
  entity.verticalSpeed = FLIGHT_PHYSICS.sinkRate + lift;
  entity.position.y += entity.verticalSpeed * delta;

  const groundHeight = terrain.getHeightAt(entity.position.x, entity.position.z);
  const landingHeight = groundHeight + FLIGHT_PHYSICS.landingClearance;

  if (entity.position.y <= landingHeight) {
    entity.position.y = landingHeight;
    entity.velocity.set(0, 0, 0);
    entity.speed = 0;
    entity.targetSpeed = 0;
    entity.verticalSpeed = 0;
    entity.landed = true;
  }
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

export function createWindVector() {
  return new THREE.Vector3(3.2, 0, 1.1);
}

function kmhToMetersPerSecond(value) {
  return value / 3.6;
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
