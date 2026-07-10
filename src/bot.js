import * as THREE from 'three';
import { applyFlightPhysics, updateAltitudeMetrics } from './physics.js?v=hot-b-1';
import { createParagliderModel, setParagliderLandedPose } from './paragliderModel.js?v=pilot-pose-8';

const BOT_CONFIG = {
  // Como pilotos reais: mais devagar circulando (minimo afundamento),
  // mais rapido nas transicoes entre termicas.
  climbSpeedKmh: 34,
  glideSpeedKmh: 42,
  maxTurnRate: 0.44,
  turnResponse: 1.45,
  startAltitude: 26,
  // Orbita de subida dentro da termica (fracao do raio do nucleo).
  orbitRadiusRatio: 0.45,
  orbitCorrectionGain: 0.02,
  // Sai da termica um pouco antes do teto ou quando ela esta morrendo.
  ceilingMarginMeters: 120,
  dyingCycleFactor: 0.3,
  climbEnterRadiusRatio: 0.95
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
    this.speed = BOT_CONFIG.glideSpeedKmh;
    this.targetSpeed = BOT_CONFIG.glideSpeedKmh;
    this.groundSpeedKmh = 0;
    this.windAdjustedSpeedKmh = BOT_CONFIG.glideSpeedKmh;
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
    this.state = 'glide';
    this.currentThermal = null;
    // Sentido de giro proprio: metade circula para cada lado.
    this.orbitDirection = Math.random() < 0.5 ? 1 : -1;

    this.position.set(x, terrain.getHeightAt(x, z) + BOT_CONFIG.startAltitude, z);
    this.launchPosition = this.position.clone();
    updateAltitudeMetrics(this, terrain);
    this.group.rotation.y = this.heading;
  }

  update(delta, flightContext) {
    if (this.landed || this.entangled) return;

    const desiredHeading = this.updateStrategy(flightContext);
    const turnDelta = normalizeAngle(desiredHeading - this.heading);
    const targetTurnRate = THREE.MathUtils.clamp(turnDelta * 0.65, -BOT_CONFIG.maxTurnRate, BOT_CONFIG.maxTurnRate);

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
      this.bankAngle * 0.85,
      1 - Math.exp(-delta * 3)
    );
  }

  // Maquina de estados: transitar ate a termica escolhida, circular subindo
  // ate perto do teto e seguir para a proxima.
  updateStrategy({ thermals }) {
    if (!this.isThermalUsable(this.currentThermal)) {
      this.currentThermal = this.pickThermal(thermals);
      this.state = 'glide';
    }

    const thermal = this.currentThermal;
    if (!thermal) {
      this.targetSpeed = BOT_CONFIG.glideSpeedKmh;
      return this.heading;
    }

    const dx = this.position.x - thermal.position.x;
    const dz = this.position.z - thermal.position.z;
    const distance = Math.hypot(dx, dz);

    if (this.state === 'glide' && distance <= thermal.radius * BOT_CONFIG.climbEnterRadiusRatio) {
      this.state = 'climb';
    }

    if (this.state === 'climb') {
      const nearCeiling = this.position.y >= thermal.topAltitudeAboveSeaLevel - BOT_CONFIG.ceilingMarginMeters;
      if (nearCeiling || distance > thermal.radius * 1.6) {
        this.currentThermal = null;
        this.state = 'glide';
        this.targetSpeed = BOT_CONFIG.glideSpeedKmh;
        return this.heading;
      }

      this.targetSpeed = BOT_CONFIG.climbSpeedKmh;
      return this.getOrbitHeading(dx, dz, distance, thermal);
    }

    this.targetSpeed = BOT_CONFIG.glideSpeedKmh;
    return getHeadingTo(this.position, thermal.position);
  }

  isThermalUsable(thermal) {
    if (!thermal) return false;
    if ((thermal.cycleFactor ?? 1) < BOT_CONFIG.dyingCycleFactor && thermal.age > thermal.lifetimeSeconds * 0.5) {
      return false;
    }
    return this.position.y < thermal.topAltitudeAboveSeaLevel - BOT_CONFIG.ceilingMarginMeters;
  }

  pickThermal(thermals) {
    if (!thermals?.enabled || !Array.isArray(thermals.thermals)) return null;

    let best = null;
    let bestDistance = Infinity;

    for (const thermal of thermals.thermals) {
      if (!this.isThermalUsable(thermal)) continue;

      const distance = Math.hypot(
        this.position.x - thermal.position.x,
        this.position.z - thermal.position.z
      );
      if (distance < bestDistance) {
        best = thermal;
        bestDistance = distance;
      }
    }

    return best;
  }

  // Circular no nucleo: rumo tangente a orbita com correcao radial suave
  // para manter o raio ideal de subida.
  getOrbitHeading(dx, dz, distance, thermal) {
    const orbitRadius = thermal.radius * BOT_CONFIG.orbitRadiusRatio;
    const safeDistance = Math.max(distance, 0.001);
    const radialX = dx / safeDistance;
    const radialZ = dz / safeDistance;
    const tangentX = -radialZ * this.orbitDirection;
    const tangentZ = radialX * this.orbitDirection;
    const radialCorrection = THREE.MathUtils.clamp(
      (distance - orbitRadius) * BOT_CONFIG.orbitCorrectionGain,
      -0.9,
      0.9
    );

    const directionX = tangentX - radialX * radialCorrection;
    const directionZ = tangentZ - radialZ * radialCorrection;
    return Math.atan2(-directionX, -directionZ);
  }

  getForwardVector() {
    return new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading)).normalize();
  }

  applyLandingPose() {
    if (this.landingPoseApplied) return;

    const groundHeight = getVisualGroundHeight(this.terrain, this.position.x, this.position.z);
    this.group.rotation.set(0, this.heading, 0);
    setParagliderLandedPose(this.group, { groundHeight });
    this.landingPoseApplied = true;
  }
}

function getVisualGroundHeight(terrain, x, z) {
  return terrain.getRenderedHeightAt
    ? terrain.getRenderedHeightAt(x, z)
    : terrain.getHeightAt(x, z);
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
