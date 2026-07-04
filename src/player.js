import * as THREE from 'three';
import { applyFlightPhysics } from './physics.js';
import { createParagliderModel, setParagliderLandedPose } from './paragliderModel.js';

const PLAYER_CONFIG = {
  launchX: 0,
  launchZ: 0,
  startAltitude: 24,
  baseSpeedKmh: 40,
  minSpeedKmh: 28,
  maxSpeedKmh: 55,
  accelerationKmh: 18,
  turnRate: 1.68,
  visualBank: 0.5,
  visualPitch: 0.14
};

export class Player {
  constructor({ terrain }) {
    this.terrain = terrain;
    this.group = createParagliderModel({
      canopyAssetUrl: '/image/nova-vortex.obj',
      colors: {
        canopy: 0xa8dff2,
        stripe: 0x3157bd,
        trim: 0x17242f,
        helmet: 0xf2c94c
      }
    });
    this.position = this.group.position;
    this.velocity = new THREE.Vector3();
    this.heading = 0;
    this.speed = PLAYER_CONFIG.baseSpeedKmh;
    this.targetSpeed = PLAYER_CONFIG.baseSpeedKmh;
    this.verticalSpeed = 0;
    this.distanceTravelled = 0;
    this.landed = false;
    this.entangled = false;
    this.entanglementId = null;
    this.entanglementSpin = 0;
    this.landingPoseApplied = false;
    this.input = createInputState();

    const startY = terrain.getHeightAt(PLAYER_CONFIG.launchX, PLAYER_CONFIG.launchZ) + PLAYER_CONFIG.startAltitude;
    this.position.set(PLAYER_CONFIG.launchX, startY, PLAYER_CONFIG.launchZ);
  }

  update(delta, flightContext) {
    if (this.landed || this.entangled) return;

    const turnInput = Number(this.input.left) - Number(this.input.right);
    const speedInput = Number(this.input.forward) - Number(this.input.backward);

    this.targetSpeed = THREE.MathUtils.clamp(
      this.targetSpeed + speedInput * PLAYER_CONFIG.accelerationKmh * delta,
      PLAYER_CONFIG.minSpeedKmh,
      PLAYER_CONFIG.maxSpeedKmh
    );
    this.speed = THREE.MathUtils.lerp(this.speed, this.targetSpeed, 1 - Math.exp(-delta * 4));
    this.heading += turnInput * PLAYER_CONFIG.turnRate * delta;

    applyFlightPhysics(this, delta, flightContext);

    if (this.landed) {
      this.applyLandingPose();
      return;
    }

    this.group.rotation.y = this.heading;
    this.group.rotation.z = THREE.MathUtils.lerp(
      this.group.rotation.z,
      turnInput * PLAYER_CONFIG.visualBank,
      1 - Math.exp(-delta * 8)
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

  return state;
}
