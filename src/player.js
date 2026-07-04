import * as THREE from 'three';
import { applyFlightPhysics, updateAltitudeMetrics } from './physics.js?v=wind-physics-1';
import { createParagliderModel, setParagliderLandedPose } from './paragliderModel.js';

const PLAYER_CONFIG = {
  launchX: 0,
  launchZ: 0,
  startAltitude: 24,
  baseSpeedKmh: 40,
  speedControlRange: 0.2,
  maxTurnRate: 0.72,
  turnResponse: 2.1,
  visualBank: 0.34,
  visualPitch: 0.14
};

export class Player {
  constructor({ terrain, canopyColor = 0xa8dff2 }) {
    this.terrain = terrain;
    this.group = createParagliderModel({
      canopyAssetUrl: '/image/nova-vortex.obj',
      colors: {
        canopy: canopyColor,
        stripe: 0x3157bd,
        trim: 0x17242f,
        helmet: 0xf2c94c
      }
    });
    this.position = this.group.position;
    this.velocity = new THREE.Vector3();
    this.heading = 0;
    this.turnRate = 0;
    this.speed = PLAYER_CONFIG.baseSpeedKmh;
    this.targetSpeed = PLAYER_CONFIG.baseSpeedKmh;
    this.groundSpeedKmh = 0;
    this.windAdjustedSpeedKmh = PLAYER_CONFIG.baseSpeedKmh;
    this.windAngleDegrees = 0;
    this.windAngleStepDegrees = 0;
    this.verticalSpeed = 0;
    this.groundHeight = 0;
    this.groundClearance = 0;
    this.altitudeAboveSeaLevel = 0;
    this.distanceTravelled = 0;
    this.distanceFromStart = 0;
    this.landed = false;
    this.entangled = false;
    this.entanglementId = null;
    this.entanglementSpin = 0;
    this.landingPoseApplied = false;
    this.input = createInputState();

    const startY = terrain.getHeightAt(PLAYER_CONFIG.launchX, PLAYER_CONFIG.launchZ) + PLAYER_CONFIG.startAltitude;
    this.position.set(PLAYER_CONFIG.launchX, startY, PLAYER_CONFIG.launchZ);
    this.launchPosition = this.position.clone();
    updateAltitudeMetrics(this, terrain);
  }

  update(delta, flightContext) {
    if (this.landed || this.entangled) return;

    const turnInput = Number(this.input.left) - Number(this.input.right);
    const speedInput = Number(this.input.forward) - Number(this.input.backward);

    this.targetSpeed = getTargetSpeedKmh(speedInput);
    this.speed = THREE.MathUtils.lerp(this.speed, this.targetSpeed, 1 - Math.exp(-delta * 4));
    const targetTurnRate = turnInput * PLAYER_CONFIG.maxTurnRate;
    this.turnRate = THREE.MathUtils.lerp(
      this.turnRate,
      targetTurnRate,
      1 - Math.exp(-delta * PLAYER_CONFIG.turnResponse)
    );
    this.heading += this.turnRate * delta;

    applyFlightPhysics(this, delta, flightContext);

    if (this.landed) {
      this.applyLandingPose();
      return;
    }

    this.group.rotation.y = this.heading;
    this.group.rotation.z = THREE.MathUtils.lerp(
      this.group.rotation.z,
      (this.turnRate / PLAYER_CONFIG.maxTurnRate) * PLAYER_CONFIG.visualBank,
      1 - Math.exp(-delta * 3.6)
    );
    this.group.rotation.x = THREE.MathUtils.lerp(
      this.group.rotation.x,
      -speedInput * PLAYER_CONFIG.visualPitch,
      1 - Math.exp(-delta * 5)
    );
  }

  getForwardVector() {
    return new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading)).normalize();
  }

  applyLandingPose() {
    if (this.landingPoseApplied) return;

    const groundHeight = this.terrain.getHeightAt(this.position.x, this.position.z);
    this.group.rotation.set(0, this.heading, 0);
    setParagliderLandedPose(this.group, { groundHeight });
    this.landingPoseApplied = true;
  }
}

function getMinSpeedKmh() {
  return PLAYER_CONFIG.baseSpeedKmh * (1 - PLAYER_CONFIG.speedControlRange);
}

function getMaxSpeedKmh() {
  return PLAYER_CONFIG.baseSpeedKmh * (1 + PLAYER_CONFIG.speedControlRange);
}

function getTargetSpeedKmh(speedInput) {
  return THREE.MathUtils.clamp(
    PLAYER_CONFIG.baseSpeedKmh * (1 + speedInput * PLAYER_CONFIG.speedControlRange),
    getMinSpeedKmh(),
    getMaxSpeedKmh()
  );
}

function createInputState() {
  const state = {
    forward: false,
    backward: false,
    left: false,
    right: false
  };

  const keyMap = new Map([
    ['KeyW', 'forward'],
    ['ArrowUp', 'forward'],
    ['KeyS', 'backward'],
    ['ArrowDown', 'backward'],
    ['KeyA', 'left'],
    ['ArrowLeft', 'left'],
    ['KeyD', 'right'],
    ['ArrowRight', 'right']
  ]);

  window.addEventListener('keydown', (event) => {
    const key = keyMap.get(event.code);
    if (!key) return;
    event.preventDefault();
    state[key] = true;
  });

  window.addEventListener('keyup', (event) => {
    const key = keyMap.get(event.code);
    if (!key) return;
    event.preventDefault();
    state[key] = false;
  });

  bindTouchControls(state);

  return state;
}

function bindTouchControls(state) {
  const buttons = [...document.querySelectorAll('[data-control]')];
  const validControls = new Set(Object.keys(state));

  for (const button of buttons) {
    const control = button.dataset.control;
    if (!validControls.has(control)) continue;

    const setPressed = (pressed) => {
      state[control] = pressed;
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
  }

  window.addEventListener('blur', () => {
    for (const control of validControls) state[control] = false;
    for (const button of buttons) button.classList.remove('is-active');
  });
}
