import * as THREE from 'three';

const CAMERA_CONFIG = {
  distance: 31,
  height: 15,
  lookAhead: 20,
  lookHeight: 5,
  followSmoothing: 3.8,
  lookSmoothing: 6.2,
  groundClearance: 18,
  landedMinDistance: 16,
  landedMaxDistance: 58,
  landedOrbitSpeed: 1.9,
  landedZoomSpeed: 24,
  standbyDistance: 1850,
  standbyHeight: 760,
  standbyLookHeight: 260,
  standbyGroundClearance: 420
};

// Visao do piloto (primeira pessoa): camera no capacete, herdando a
// orientacao do modelo (banco/pitch), com leve olhar para baixo.
const FIRST_PERSON_CONFIG = {
  headOffset: new THREE.Vector3(0, 0.72, 0.1),
  lookDownPitch: 0.07,
  orientationSmoothing: 14,
  // Near plane menor para nao cortar o casulo/linhas perto da cabeca;
  // restaurado no modo externo para preservar a precisao do depth buffer.
  nearPlane: 0.5
};
const THIRD_PERSON_NEAR_PLANE = 2;

let cameraMode = 'third-person';

export function getCameraMode() {
  return cameraMode;
}

export function toggleCameraMode() {
  cameraMode = cameraMode === 'third-person' ? 'first-person' : 'third-person';
  return cameraMode;
}

const desiredPosition = new THREE.Vector3();
const desiredLookAt = new THREE.Vector3();
const currentLookAt = new THREE.Vector3();
const standbyForward = new THREE.Vector3();
const firstPersonPosition = new THREE.Vector3();
const firstPersonQuaternion = new THREE.Quaternion();
const firstPersonPitchAdjust = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  -FIRST_PERSON_CONFIG.lookDownPitch
);
const landedCamera = {
  initialized: false,
  angle: 0,
  distance: 30
};

export function initializeThirdPersonCamera(camera, target, context = {}) {
  const forward = target.getForwardVector();
  desiredPosition
    .copy(target.position)
    .addScaledVector(forward, -CAMERA_CONFIG.distance)
    .add(new THREE.Vector3(0, CAMERA_CONFIG.height, 0));
  keepCameraAboveTerrain(desiredPosition, context.terrain, CAMERA_CONFIG.groundClearance);
  camera.position.copy(desiredPosition);
  currentLookAt.copy(target.position).addScaledVector(forward, CAMERA_CONFIG.lookAhead);
  currentLookAt.y += CAMERA_CONFIG.lookHeight;
  camera.lookAt(currentLookAt);
}

// Despacha para o modo de camera ativo (externa ou visao do piloto).
export function updateFlightCamera(camera, target, delta, context = {}) {
  if (target.landed) {
    setCameraNearPlane(camera, THIRD_PERSON_NEAR_PLANE);
    updateLandedCamera(camera, target, delta, context);
    return;
  }

  if (cameraMode === 'first-person') {
    updateFirstPersonCamera(camera, target, delta);
    return;
  }

  setCameraNearPlane(camera, THIRD_PERSON_NEAR_PLANE);
  updateThirdPersonCamera(camera, target, delta, context);
}

function updateFirstPersonCamera(camera, target, delta) {
  setCameraNearPlane(camera, FIRST_PERSON_CONFIG.nearPlane);
  landedCamera.initialized = false;

  // Posicao presa a cabeca (sem atraso, para nao enjoar) e orientacao do
  // proprio modelo: a visao inclina junto com a asa na curva e no pendulo.
  firstPersonPosition
    .copy(FIRST_PERSON_CONFIG.headOffset)
    .applyQuaternion(target.group.quaternion)
    .add(target.position);
  camera.position.copy(firstPersonPosition);

  firstPersonQuaternion.copy(target.group.quaternion).multiply(firstPersonPitchAdjust);
  camera.quaternion.slerp(
    firstPersonQuaternion,
    1 - Math.exp(-delta * FIRST_PERSON_CONFIG.orientationSmoothing)
  );

  // Mantem o lookAt suavizado coerente para a troca de volta ao modo externo.
  currentLookAt.copy(target.position);
}

export function updateThirdPersonCamera(camera, target, delta, context = {}) {
  if (target.landed) {
    updateLandedCamera(camera, target, delta, context);
    return;
  }

  landedCamera.initialized = false;
  const forward = target.getForwardVector();
  desiredPosition
    .copy(target.position)
    .addScaledVector(forward, -CAMERA_CONFIG.distance)
    .add(new THREE.Vector3(0, CAMERA_CONFIG.height, 0));
  keepCameraAboveTerrain(desiredPosition, context.terrain, CAMERA_CONFIG.groundClearance);
  desiredLookAt.copy(target.position).addScaledVector(forward, CAMERA_CONFIG.lookAhead);
  desiredLookAt.y += CAMERA_CONFIG.lookHeight;

  const followAlpha = 1 - Math.exp(-delta * CAMERA_CONFIG.followSmoothing);
  const lookAlpha = 1 - Math.exp(-delta * CAMERA_CONFIG.lookSmoothing);
  camera.position.lerp(desiredPosition, followAlpha);
  currentLookAt.lerp(desiredLookAt, lookAlpha);
  camera.lookAt(currentLookAt);
}

export function updateStandbyCamera(camera, terrain, delta, context = {}) {
  const groundHeight = terrain.getHeightAt(0, 0);
  const heading = context.headingRadians ?? 0;
  standbyForward.set(-Math.sin(heading), 0, -Math.cos(heading)).normalize();
  desiredLookAt
    .copy(standbyForward)
    .multiplyScalar(CAMERA_CONFIG.standbyDistance * 0.28);
  desiredLookAt.y = groundHeight + CAMERA_CONFIG.standbyLookHeight;
  desiredPosition
    .copy(standbyForward)
    .multiplyScalar(-CAMERA_CONFIG.standbyDistance)
    .add(new THREE.Vector3(0, groundHeight + CAMERA_CONFIG.standbyHeight, 0));
  keepCameraAboveTerrain(desiredPosition, terrain, CAMERA_CONFIG.standbyGroundClearance);

  const followAlpha = 1 - Math.exp(-delta * 2.4);
  const lookAlpha = 1 - Math.exp(-delta * 3.2);
  camera.position.lerp(desiredPosition, followAlpha);
  currentLookAt.lerp(desiredLookAt, lookAlpha);
  camera.lookAt(currentLookAt);
}

function updateLandedCamera(camera, target, delta, context) {
  if (!landedCamera.initialized) {
    const offset = camera.position.clone().sub(target.position);
    landedCamera.angle = Math.atan2(offset.x, offset.z);
    landedCamera.distance = THREE.MathUtils.clamp(
      Math.hypot(offset.x, offset.z),
      CAMERA_CONFIG.landedMinDistance,
      CAMERA_CONFIG.landedMaxDistance
    );
    landedCamera.initialized = true;
  }

  const input = target.input ?? {};
  const orbitInput = Number(input.right) - Number(input.left);
  const zoomInput = Number(input.backward) - Number(input.forward);
  landedCamera.angle += orbitInput * CAMERA_CONFIG.landedOrbitSpeed * delta;
  landedCamera.distance = THREE.MathUtils.clamp(
    landedCamera.distance + zoomInput * CAMERA_CONFIG.landedZoomSpeed * delta,
    CAMERA_CONFIG.landedMinDistance,
    CAMERA_CONFIG.landedMaxDistance
  );

  desiredLookAt.copy(target.position);
  desiredLookAt.y += 3.5;
  desiredPosition.set(
    target.position.x + Math.sin(landedCamera.angle) * landedCamera.distance,
    target.position.y + 12,
    target.position.z + Math.cos(landedCamera.angle) * landedCamera.distance
  );
  keepCameraAboveTerrain(desiredPosition, context.terrain, CAMERA_CONFIG.groundClearance);

  const followAlpha = 1 - Math.exp(-delta * 5);
  const lookAlpha = 1 - Math.exp(-delta * 8);
  camera.position.lerp(desiredPosition, followAlpha);
  currentLookAt.lerp(desiredLookAt, lookAlpha);
  camera.lookAt(currentLookAt);
}

function setCameraNearPlane(camera, nearPlane) {
  if (Math.abs(camera.near - nearPlane) < 0.001) return;
  camera.near = nearPlane;
  camera.updateProjectionMatrix();
}

function keepCameraAboveTerrain(position, terrain, clearance) {
  if (!terrain || typeof terrain.getHeightAt !== 'function') return;

  const groundHeight = terrain.getHeightAt(position.x, position.z);
  if (!Number.isFinite(groundHeight)) return;

  position.y = Math.max(position.y, groundHeight + clearance);
}
