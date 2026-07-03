import * as THREE from 'three';
import { applyFlightPhysics } from './physics.js';
import { createParagliderModel, setParagliderLandedPose } from './paragliderModel.js';

const BOT_CONFIG = {
  baseSpeed: 16,
  turnRate: 0.85,
  visualBank: 0.42,
  startAltitude: 26
};

const BOT_STARTS = [
  { name: 'Bot Azul', color: 0x3f7cff, x: -18, z: 18, heading: -0.5 },
  { name: 'Bot Verde', color: 0x53d17a, x: 22, z: 12, heading: 0.4 }
];

export function createBots({ terrain }) {
  return BOT_STARTS.map((config) => new Bot({ ...config, terrain }));
}

export class Bot {
  constructor({ name, color, x, z, heading, terrain }) {
    this.name = name;
    this.terrain = terrain;
    this.group = createBotModel(color);
    this.position = this.group.position;
    this.velocity = new THREE.Vector3();
    this.heading = heading;
    this.speed = BOT_CONFIG.baseSpeed;
    this.targetSpeed = BOT_CONFIG.baseSpeed;
    this.verticalSpeed = 0;
    this.distanceTravelled = 0;
    this.landed = false;
    this.landingPoseApplied = false;

    this.position.set(x, terrain.getHeightAt(x, z) + BOT_CONFIG.startAltitude, z);
    this.group.rotation.y = this.heading;
  }

  update(delta, flightContext) {
    if (this.landed) return;

    const nearestThermal = flightContext.thermals.getNearestThermal(this.position);
    const desiredHeading = getHeadingTo(this.position, nearestThermal.position);
    const turnDelta = normalizeAngle(desiredHeading - this.heading);
    const turnInput = THREE.MathUtils.clamp(turnDelta * 1.8, -1, 1);

    this.heading += turnInput * BOT_CONFIG.turnRate * delta;
    this.speed = THREE.MathUtils.lerp(this.speed, this.targetSpeed, 1 - Math.exp(-delta * 2.5));

    applyFlightPhysics(this, delta, flightContext);

    if (this.landed) {
      this.applyLandingPose();
      return;
    }

    this.group.rotation.y = this.heading;
    this.group.rotation.z = THREE.MathUtils.lerp(
      this.group.rotation.z,
      turnInput * BOT_CONFIG.visualBank,
      1 - Math.exp(-delta * 6)
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

function createBotModel(color) {
  return createParagliderModel({
    canopyAssetUrl: '/image/nova-vortex.obj',
    colors: {
      canopy: color,
      stripe: 0xf2f7ff,
      trim: 0x17242f,
      helmet: 0xe8edf3
    }
  });
}

function getHeadingTo(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.atan2(-dx, -dz);
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
