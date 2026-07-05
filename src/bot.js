import * as THREE from 'three';
import { applyFlightPhysics, updateAltitudeMetrics } from './physics.js?v=wind-physics-1';
import { createParagliderModel, setParagliderLandedPose } from './paragliderModel.js';

const BOT_CONFIG = {
  baseSpeedKmh: 40,
  maxTurnRate: 0.58,
  turnResponse: 1.8,
  visualBank: 0.3,
  startAltitude: 26
};

const BOT_STARTS = [
  { name: 'Bot Azul', color: 0x3f7cff, x: -180, z: 180, heading: -0.5 },
  { name: 'Bot Verde', color: 0x53d17a, x: 220, z: 120, heading: 0.4 },
  { name: 'Bot Vermelho', color: 0xff5a5f, x: -340, z: -120, heading: -0.25 },
  { name: 'Bot Amarelo', color: 0xffd166, x: 360, z: -180, heading: 0.28 }
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
    this.turnRate = 0;
    this.speed = BOT_CONFIG.baseSpeedKmh;
    this.targetSpeed = BOT_CONFIG.baseSpeedKmh;
    this.groundSpeedKmh = 0;
    this.windAdjustedSpeedKmh = BOT_CONFIG.baseSpeedKmh;
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

    this.position.set(x, terrain.getHeightAt(x, z) + BOT_CONFIG.startAltitude, z);
    this.launchPosition = this.position.clone();
    updateAltitudeMetrics(this, terrain);
    this.group.rotation.y = this.heading;
  }

  update(delta, flightContext) {
    if (this.landed || this.entangled) return;

    const nearestThermal = flightContext.thermals.getNearestThermal(this.position);
    const desiredHeading = nearestThermal
      ? getHeadingTo(this.position, nearestThermal.position)
      : this.heading;
    const turnDelta = normalizeAngle(desiredHeading - this.heading);
    const targetTurnRate = THREE.MathUtils.clamp(turnDelta * 0.9, -BOT_CONFIG.maxTurnRate, BOT_CONFIG.maxTurnRate);

    this.turnRate = THREE.MathUtils.lerp(
      this.turnRate,
      targetTurnRate,
      1 - Math.exp(-delta * BOT_CONFIG.turnResponse)
    );
    this.heading += this.turnRate * delta;
    this.speed = THREE.MathUtils.lerp(this.speed, this.targetSpeed, 1 - Math.exp(-delta * 2.5));

    applyFlightPhysics(this, delta, flightContext);

    if (this.landed) {
      this.applyLandingPose();
      return;
    }

    this.group.rotation.y = this.heading;
    this.group.rotation.z = THREE.MathUtils.lerp(
      this.group.rotation.z,
      (this.turnRate / BOT_CONFIG.maxTurnRate) * BOT_CONFIG.visualBank,
      1 - Math.exp(-delta * 3)
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
