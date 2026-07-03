import * as THREE from 'three';

const FLIGHT_PHYSICS = {
  sinkRate: -1.05,
  windInfluence: 0.24,
  landingClearance: 0.75
};

const tempWind = new THREE.Vector3();

export function applyFlightPhysics(entity, delta, { terrain, thermals, wind }) {
  if (entity.landed) return;

  const forward = entity.getForwardVector();
  tempWind.copy(wind).multiplyScalar(FLIGHT_PHYSICS.windInfluence);

  entity.velocity.set(
    forward.x * entity.speed + tempWind.x,
    0,
    forward.z * entity.speed + tempWind.z
  );

  entity.position.addScaledVector(entity.velocity, delta);
  entity.distanceTravelled += entity.velocity.length() * delta;

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

export function createWindVector() {
  return new THREE.Vector3(1.25, 0, 0.45);
}
