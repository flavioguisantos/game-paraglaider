import * as THREE from 'three';
import { applyFlightPhysics, POLAR_SPEEDS, updateAltitudeMetrics } from './physics.js?v=hot-b-1';
import { createParagliderModel, setParagliderLandedPose } from './paragliderModel.js?v=pilot-pose-5';
import { createFirstPersonRig, updateFirstPersonRig } from './firstPersonRig.js?v=8';
import { getCameraMode } from './camera.js?v=camera-modes-3';

const PLAYER_CONFIG = {
  launchX: 0,
  launchZ: 0,
  startAltitude: 24
};

const TOUCH_JOYSTICK_CONFIG = {
  deadzone: 0.12,
  knobTravelPx: 34
};

const VEHICLE_PROFILES = {
  paraglider: {
    id: 'paraglider',
    label: 'Parapente',
    flightModel: 'paraglider',
    startSpeedKmh: 8,
    trimSpeedKmh: POLAR_SPEEDS.trimSpeedKmh,
    minSpeedKmh: 26,
    maxSpeedKmh: POLAR_SPEEDS.maxSpeedKmh,
    maxTurnRate: 0.48,
    turnResponse: 1.55,
    visualBankScale: 0.85,
    visualPitch: 0.14,
    surgePitchScale: 0.035,
    surgeSmoothing: 4,
    cameraPreference: 'toggle',
    cameraProfile: {
      headOffset: new THREE.Vector3(0, 0.72, 0.1),
      lookDownPitch: 0.09,
      orientationSmoothing: 14,
      nearPlane: 0.06
    },
    createModel(canopyColor) {
      return createParagliderModel({
        canopyAssetUrl: '/image/nova-vortex.obj',
        colors: {
          canopy: canopyColor,
          stripe: 0x3157bd,
          trim: 0x17242f,
          helmet: 0xf2c94c
        }
      });
    },
    addFirstPersonRig(group) {
      const firstPersonRig = createFirstPersonRig();
      group.add(firstPersonRig);
      return firstPersonRig;
    }
  },
  drone: {
    id: 'drone',
    label: 'Drone FPV',
    flightModel: 'drone',
    startSpeedKmh: 0,
    trimSpeedKmh: 180,
    minSpeedKmh: 80,
    maxSpeedKmh: 700,
    maxTurnRate: 1.7,
    turnResponse: 4.8,
    maxPitchRate: 4.8,
    pitchResponse: 7.5,
    visualBankScale: 1.25,
    visualPitch: 1,
    surgePitchScale: 0,
    surgeSmoothing: 12,
    cameraPreference: 'first-person-only',
    cameraProfile: {
      headOffset: new THREE.Vector3(0, 0.13, -0.32),
      lookDownPitch: 0.015,
      orientationSmoothing: 42,
      nearPlane: 0.03
    },
    createModel(accentColor) {
      return createDroneModel(accentColor);
    },
    addFirstPersonRig() {
      return null;
    }
  }
};

export function getVehicleProfile(vehicleType = 'paraglider') {
  return VEHICLE_PROFILES[vehicleType] ?? VEHICLE_PROFILES.paraglider;
}

export class Player {
  constructor({
    terrain,
    canopyColor = 0xa8dff2,
    launchAltitudeMeters = PLAYER_CONFIG.startAltitude,
    launchHeadingRadians = 0,
    vehicleType = 'paraglider'
  }) {
    this.vehicleProfile = getVehicleProfile(vehicleType);
    this.vehicleType = this.vehicleProfile.id;
    this.vehicleLabel = this.vehicleProfile.label;
    this.terrain = terrain;
    this.group = this.vehicleProfile.createModel(canopyColor);
    this.group.rotation.order = this.vehicleType === 'drone' ? 'YXZ' : 'XYZ';
    // Rig da visao do piloto (selete + bracos com batoques): so aparece na
    // primeira pessoa, quando o boneco de terceira pessoa e ocultado.
    this.firstPersonRig = this.vehicleProfile.addFirstPersonRig(this.group);
    this.cameraPreference = this.vehicleProfile.cameraPreference;
    this.cameraProfile = this.vehicleProfile.cameraProfile;
    this.position = this.group.position;
    this.velocity = new THREE.Vector3();
    this.heading = launchHeadingRadians;
    this.turnRate = 0;
    this.pitchAngle = 0;
    this.pitchRate = 0;
    this.rollAngle = 0;
    // Decola em corrida: a velocidade sobe do passo de rampa ate o trim.
    this.speed = this.vehicleProfile.startSpeedKmh;
    this.targetSpeed = this.vehicleProfile.trimSpeedKmh;
    this.groundSpeedKmh = 0;
    this.windAdjustedSpeedKmh = this.vehicleProfile.trimSpeedKmh;
    this.windAngleDegrees = 0;
    this.windAngleStepDegrees = 0;
    this.verticalSpeed = 0;
    this.groundHeight = 0;
    this.groundClearance = 0;
    this.altitudeAboveSeaLevel = 0;
    this.distanceTravelled = 0;
    this.distanceFromStart = 0;
    this.landed = false;
    this.crashed = false;
    this.entangled = false;
    this.entanglementId = null;
    this.entanglementSpin = 0;
    this.landingPoseApplied = false;
    this.bankAngle = 0;
    // Reserva unica de flare para arredondar o pouso segurando os freios.
    this.flareCharge = 1;
    this.previousVerticalSpeed = 0;
    this.smoothedSurge = 0;
    this.input = createInputState();

    const startY = terrain.getHeightAt(PLAYER_CONFIG.launchX, PLAYER_CONFIG.launchZ) + launchAltitudeMeters;
    this.position.set(PLAYER_CONFIG.launchX, startY, PLAYER_CONFIG.launchZ);
    this.launchPosition = this.position.clone();
    this.group.rotation.y = this.heading;
    updateAltitudeMetrics(this, terrain);
  }

  update(delta, flightContext) {
    this.syncFirstPersonView(delta);
    if (this.landed || this.entangled) return;

    const turnInput = getTurnInput(this.input);
    const altitudeInput = getAltitudeInput(this.vehicleProfile, this.input);
    const speedInput = getSpeedInput(this.vehicleProfile, this.input);
    const pitchInput = getPitchInput(this.vehicleProfile, this.input);

    this.targetSpeed = getTargetSpeedKmh(this.vehicleProfile, speedInput);
    this.speed = THREE.MathUtils.lerp(this.speed, this.targetSpeed, 1 - Math.exp(-delta * 4));
    const targetTurnRate = turnInput * this.vehicleProfile.maxTurnRate;
    this.turnRate = THREE.MathUtils.lerp(
      this.turnRate,
      targetTurnRate,
      1 - Math.exp(-delta * this.vehicleProfile.turnResponse)
    );
    this.heading += this.turnRate * delta;

    if (this.vehicleProfile.flightModel === 'drone') {
      const targetPitchRate = pitchInput * this.vehicleProfile.maxPitchRate;
      this.pitchRate = THREE.MathUtils.lerp(
        this.pitchRate,
        targetPitchRate,
        1 - Math.exp(-delta * this.vehicleProfile.pitchResponse)
      );
      this.pitchAngle += this.pitchRate * delta;
      this.rollAngle = THREE.MathUtils.lerp(
        this.rollAngle,
        turnInput * 0.9,
        1 - Math.exp(-delta * 10)
      );
      this.group.rotation.set(this.pitchAngle, this.heading, this.rollAngle);
      this.group.updateMatrixWorld(true);
    }

    applyFlightPhysics(this, delta, flightContext);

    if (this.landed) {
      this.applyLandingPose();
      return;
    }

    // Surge (pendulo): variacao brusca do vario balanca a vela para
    // frente/tras, como ao entrar ou sair de uma termica.
    const verticalAcceleration = delta > 0
      ? (this.verticalSpeed - this.previousVerticalSpeed) / delta
      : 0;
    this.previousVerticalSpeed = this.verticalSpeed;
    this.smoothedSurge = THREE.MathUtils.lerp(
      this.smoothedSurge,
      THREE.MathUtils.clamp(verticalAcceleration * this.vehicleProfile.surgePitchScale, -0.18, 0.18),
      1 - Math.exp(-delta * this.vehicleProfile.surgeSmoothing)
    );

    this.group.rotation.y = this.heading;
    if (this.vehicleProfile.flightModel === 'drone') {
      this.group.rotation.set(this.pitchAngle, this.heading, this.rollAngle);
    } else {
      this.group.rotation.z = THREE.MathUtils.lerp(
        this.group.rotation.z,
        this.bankAngle * this.vehicleProfile.visualBankScale,
        1 - Math.exp(-delta * 3.6)
      );
      this.group.rotation.x = THREE.MathUtils.lerp(
        this.group.rotation.x,
        getVisualPitch(this.vehicleProfile, altitudeInput, this.smoothedSurge),
        1 - Math.exp(-delta * 5)
      );
    }
  }

  // Mostra o rig de primeira pessoa (e esconde o boneco externo) enquanto a
  // camera estiver na visao do piloto; pousado, volta sempre ao modo externo.
  syncFirstPersonView(delta) {
    const active = (this.cameraPreference === 'first-person-only' || getCameraMode() === 'first-person')
      && !this.landed
      && !this.entangled;
    if (this.firstPersonRig) this.firstPersonRig.visible = active;
    const pilot = this.group.userData.parts?.pilot;
    if (pilot) pilot.visible = !active;
    if (active && this.firstPersonRig) updateFirstPersonRig(this.firstPersonRig, this.input, delta);
  }

  getForwardVector() {
    if (this.vehicleProfile.flightModel === 'drone') {
      return new THREE.Vector3(0, 0, -1).applyQuaternion(this.group.quaternion).normalize();
    }

    return new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading)).normalize();
  }

  applyLandingPose() {
    if (this.landingPoseApplied) return;

    const groundHeight = getVisualGroundHeight(this.terrain, this.position.x, this.position.z);
    if (this.vehicleType === 'drone') {
      this.group.rotation.set(0, this.heading, 0);
      this.group.position.y = groundHeight + 0.82;
    } else {
      this.group.rotation.set(0, this.heading, 0);
      setParagliderLandedPose(this.group, { groundHeight });
    }
    this.landingPoseApplied = true;
  }
}

function getVisualGroundHeight(terrain, x, z) {
  return terrain.getRenderedHeightAt
    ? terrain.getRenderedHeightAt(x, z)
    : terrain.getHeightAt(x, z);
}

function getTurnInput(input) {
  return clampSignedUnit((Number(input.left) || 0) - (Number(input.right) || 0));
}

function getAltitudeInput(profile, input) {
  if (profile.flightModel === 'drone') {
    return clampSignedUnit((Number(input.descend) || 0) - (Number(input.ascend) || 0));
  }

  return getSignedSpeedAxis(input);
}

function getSpeedInput(profile, input) {
  if (profile.flightModel === 'drone') {
    return THREE.MathUtils.clamp(Number(input.boost) || 0, 0, 1);
  }

  return getSignedSpeedAxis(input);
}

function getPitchInput(profile, input) {
  if (profile.flightModel === 'drone') {
    const stickPitch = (Number(input.forward) || 0) - (Number(input.backward) || 0);
    const verticalPitch = (Number(input.descend) || 0) - (Number(input.ascend) || 0);
    return clampSignedUnit(stickPitch + verticalPitch);
  }

  return 0;
}

function getSignedSpeedAxis(input) {
  const positive = Math.max(Number(input.forward) || 0, Number(input.ascend) || 0);
  const negative = Math.max(Number(input.backward) || 0, Number(input.descend) || 0);
  return clampSignedUnit(positive - negative);
}

function clampSignedUnit(value) {
  return THREE.MathUtils.clamp(value, -1, 1);
}

function getVisualPitch(profile, altitudeInput, smoothedSurge) {
  if (profile.flightModel === 'drone') {
    return -altitudeInput * profile.visualPitch;
  }

  return -altitudeInput * profile.visualPitch + smoothedSurge;
}

// Cada veiculo interpreta o eixo de velocidade no proprio perfil.
function getTargetSpeedKmh(profile, speedInput) {
  if (profile.flightModel === 'drone') {
    if (speedInput > 0) {
      return THREE.MathUtils.lerp(0, profile.maxSpeedKmh, speedInput);
    }
    return 0;
  }

  if (speedInput > 0) {
    return THREE.MathUtils.lerp(profile.trimSpeedKmh, profile.maxSpeedKmh, speedInput);
  }
  if (speedInput < 0) {
    return THREE.MathUtils.lerp(profile.trimSpeedKmh, profile.minSpeedKmh, -speedInput);
  }
  return profile.trimSpeedKmh;
}

function createDroneModel(accentColor) {
  const group = new THREE.Group();
  group.name = 'DronePlayer';

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x151b22,
    metalness: 0.68,
    roughness: 0.34
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.16,
    metalness: 0.22,
    roughness: 0.48
  });
  const propMaterial = new THREE.MeshStandardMaterial({
    color: 0x7e93a8,
    metalness: 0.25,
    roughness: 0.66
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.52), frameMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const topPlate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.035, 0.28), accentMaterial);
  topPlate.position.y = 0.08;
  topPlate.castShadow = true;
  group.add(topPlate);

  const cameraPod = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.16), accentMaterial);
  cameraPod.position.set(0, 0.02, -0.22);
  cameraPod.castShadow = true;
  group.add(cameraPod);

  const armGeometry = new THREE.BoxGeometry(0.52, 0.04, 0.06);
  const armA = new THREE.Mesh(armGeometry, frameMaterial);
  armA.rotation.y = Math.PI / 4;
  armA.castShadow = true;
  group.add(armA);

  const armB = new THREE.Mesh(armGeometry, frameMaterial);
  armB.rotation.y = -Math.PI / 4;
  armB.castShadow = true;
  group.add(armB);

  const rotorOffsets = [
    [-0.24, 0.03, -0.24],
    [0.24, 0.03, -0.24],
    [-0.24, 0.03, 0.24],
    [0.24, 0.03, 0.24]
  ];

  for (const [x, y, z] of rotorOffsets) {
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 18), accentMaterial);
    rotor.position.set(x, y, z);
    rotor.castShadow = true;
    group.add(rotor);

    const prop = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.006, 0.024), propMaterial);
    prop.position.set(x, y + 0.02, z);
    prop.castShadow = true;
    group.add(prop);
  }

  return group;
}

function createInputState() {
  const state = {
    forward: 0,
    backward: 0,
    left: 0,
    right: 0,
    ascend: 0,
    descend: 0,
    boost: 0
  };

  const keyMap = new Map([
    ['KeyW', 'forward'],
    ['KeyS', 'backward'],
    ['ArrowUp', 'ascend'],
    ['ArrowDown', 'descend'],
    ['KeyA', 'left'],
    ['ArrowLeft', 'left'],
    ['KeyD', 'right'],
    ['ArrowRight', 'right'],
    ['Space', 'boost']
  ]);

  window.addEventListener('keydown', (event) => {
    const key = keyMap.get(event.code);
    if (!key) return;
    event.preventDefault();
    state[key] = 1;
  });

  window.addEventListener('keyup', (event) => {
    const key = keyMap.get(event.code);
    if (!key) return;
    event.preventDefault();
    state[key] = 0;
  });

  bindTouchControls(state);

  return state;
}

function bindTouchControls(state) {
  const buttons = [...document.querySelectorAll('[data-control]')];
  const validControls = new Set(Object.keys(state));
  const touchResetters = [];

  for (const button of buttons) {
    const control = button.dataset.control;
    if (!validControls.has(control)) continue;

    const setPressed = (pressed) => {
      state[control] = pressed ? 1 : 0;
      button.classList.toggle('is-active', pressed);
    };

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      setPressed(true);
    });

    button.addEventListener('pointerup', (event) => {
      event.preventDefault();
      setPressed(false);
    });

    button.addEventListener('pointercancel', () => setPressed(false));
    button.addEventListener('lostpointercapture', () => setPressed(false));
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    touchResetters.push(() => setPressed(false));
  }

  const joystick = document.querySelector('[data-touch-joystick]');
  const knob = document.querySelector('[data-touch-joystick-knob]');
  if (joystick && knob) {
    let activePointerId = null;

    const setStick = (x, y) => {
      const deadzone = TOUCH_JOYSTICK_CONFIG.deadzone;
      const signedX = Math.abs(x) < deadzone ? 0 : x;
      const signedY = Math.abs(y) < deadzone ? 0 : y;

      state.left = Math.max(0, -signedX);
      state.right = Math.max(0, signedX);
      state.ascend = Math.max(0, -signedY);
      state.descend = Math.max(0, signedY);

      knob.style.setProperty('--stick-x', `${(signedX * TOUCH_JOYSTICK_CONFIG.knobTravelPx).toFixed(2)}px`);
      knob.style.setProperty('--stick-y', `${(signedY * TOUCH_JOYSTICK_CONFIG.knobTravelPx).toFixed(2)}px`);
      joystick.classList.toggle('is-active', signedX !== 0 || signedY !== 0);
    };

    const resetStick = () => {
      activePointerId = null;
      setStick(0, 0);
    };

    const updateFromPointer = (event) => {
      const rect = joystick.getBoundingClientRect();
      const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.5);
      const centerX = rect.left + rect.width * 0.5;
      const centerY = rect.top + rect.height * 0.5;
      const offsetX = event.clientX - centerX;
      const offsetY = event.clientY - centerY;
      const distance = Math.hypot(offsetX, offsetY);
      const normalized = distance > radius ? radius / distance : 1;
      setStick(
        THREE.MathUtils.clamp((offsetX * normalized) / radius, -1, 1),
        THREE.MathUtils.clamp((offsetY * normalized) / radius, -1, 1)
      );
    };

    joystick.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      activePointerId = event.pointerId;
      joystick.setPointerCapture?.(event.pointerId);
      updateFromPointer(event);
    });

    joystick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== activePointerId) return;
      event.preventDefault();
      updateFromPointer(event);
    });

    joystick.addEventListener('pointerup', (event) => {
      if (event.pointerId !== activePointerId) return;
      event.preventDefault();
      resetStick();
    });

    joystick.addEventListener('pointercancel', resetStick);
    joystick.addEventListener('lostpointercapture', resetStick);
    joystick.addEventListener('contextmenu', (event) => event.preventDefault());
    touchResetters.push(resetStick);
  }

  window.addEventListener('blur', () => {
    for (const control of validControls) state[control] = 0;
    for (const resetTouchControl of touchResetters) resetTouchControl();
  });
}
