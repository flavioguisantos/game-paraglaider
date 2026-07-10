import * as THREE from 'three';
import { createCloudBillboard, createCloudShadow } from './clouds.js';

const THERMAL_CONFIG = {
  topAltitudeAboveSeaLevel: 2200,
  // A sustentacao enfraquece gradualmente na faixa final da coluna,
  // chegando a topLiftMetersPerSecond no teto (nada de corte abrupto).
  liftFadeBandMeters: 650,
  topLiftMetersPerSecond: 2,
  driftScale: 1,
  particleCount: 26,
  particleRiseSpeed: 92,
  // Nucleo gaussiano: exp(-k * (d/R)^2). Com k=2.8 a borda do raio tem ~6%.
  gaussianFalloff: 2.8,
  // Anel de descendencia ao redor do nucleo: o ar que sobe no centro desce
  // na borda (fracao da forca, entre 1.0R e sinkRingOuterRatio*R).
  sinkRingOuterRatio: 1.65,
  sinkRingStrengthRatio: 0.3,
  // Perfil vertical: termica fraca e estreita perto do solo.
  lowLevelRampMeters: 150,
  lowLevelMinFactor: 0.25,
  // Ciclo de vida: nasce, sustenta e morre.
  lifetimeMinSeconds: 240,
  lifetimeMaxSeconds: 540,
  rampUpSeconds: 40,
  decaySeconds: 70,
  minStrengthMultiplier: 0.85,
  maxStrengthMultiplier: 1.15,
  hotStrengthMultiplierMin: 2.2,
  hotStrengthMultiplierMax: 3.4,
  maxStrengthMetersPerSecond: 10,
  minAheadThermals: 7,
  maxThermals: 15,
  spawnAheadMin: 550,
  spawnAheadMax: 2100,
  spawnLateralSpread: 720,
  aheadCheckDistance: 2400,
  behindPruneDistance: 900,
  minThermalSpacing: 340,
  dynamicRadiusMin: 125,
  dynamicRadiusMax: 190,
  dynamicStrengthMin: 1.8,
  dynamicStrengthMax: 3.2,
  dynamicHotChance: 0.18,
  cloudOpacity: 0.78,
  minTiltDegrees: 2.5,
  maxTiltDegrees: 10,
  maxTiltOffsetRatio: 0.22,
  cloudDiameterMultiplier: 2,
  labelWidth: 92,
  labelHeight: 34,
  labelGroundClearance: 18
};

const tempWindDirection = new THREE.Vector3();
const tempColumnAxis = new THREE.Vector3();
const tempColumnQuaternion = new THREE.Quaternion();
const tempParticleSide = new THREE.Vector3();
const tempParticleForward = new THREE.Vector3();

const THERMAL_SEEDS = [
  { x: -280, z: -220, radius: 125, strength: 2.6 },
  { x: 360, z: -430, radius: 145, strength: 2.2 },
  { x: 640, z: 380, radius: 170, strength: 3.0 },
  { x: -420, z: 520, radius: 135, strength: 2.4 }
];

const DEFAULT_SUN_DIRECTION = new THREE.Vector3(0, 1, 0);

export function createThermalField({ scene, terrain, sunDirection }) {
  const field = new ThermalField(terrain, sunDirection);
  scene.add(field.group);
  return field;
}

class ThermalField {
  constructor(terrain, sunDirection) {
    this.terrain = terrain;
    this.sunDirection = sunDirection?.clone().normalize() ?? DEFAULT_SUN_DIRECTION.clone();
    this.group = new THREE.Group();
    this.group.name = 'Thermals';
    this.enabled = true;
    this.assistVisualsVisible = true;
    this.topAltitude = THERMAL_CONFIG.topAltitudeAboveSeaLevel;
    const hotThermalIndex = Math.floor(Math.random() * THERMAL_SEEDS.length);
    this.nextThermalId = 1;
    this.thermals = THERMAL_SEEDS.map((seed, index) => createThermal(
      seed,
      this.nextThermalId++,
      terrain,
      index === hotThermalIndex,
      this.sunDirection,
      this.topAltitude
    ));

    for (const thermal of this.thermals) {
      // Termicas iniciais nascem em fases diferentes do ciclo para nao
      // morrerem todas juntas.
      thermal.age = Math.random() * thermal.lifetimeSeconds * 0.6;
      this.group.add(thermal.visual);
    }
  }

  setCeiling(topAltitudeAboveSeaLevel) {
    if (!Number.isFinite(topAltitudeAboveSeaLevel)) return;

    this.topAltitude = topAltitudeAboveSeaLevel;
    for (const thermal of this.thermals) {
      thermal.topAltitudeAboveSeaLevel = topAltitudeAboveSeaLevel;
    }
  }

  // Modo realista: esconde as ajudas visuais (coluna, anel, particulas e
  // rotulo de forca), mantendo apenas os sinais reais: nuvem, sombra e passaros.
  setAssistVisuals(visible) {
    this.assistVisualsVisible = Boolean(visible);
    for (const thermal of this.thermals) {
      applyAssistVisibility(thermal, this.assistVisualsVisible);
    }
  }

  update(delta, wind, referenceEntity = null) {
    this.group.visible = this.enabled;
    if (!this.enabled) return;

    if (referenceEntity) {
      this.ensureAheadThermals(referenceEntity);
      this.pruneDistantThermals(referenceEntity);
    }

    const halfSize = this.terrain.size / 2;
    const worldUnitsPerMeter = this.terrain.worldUnitsPerMeter ?? 1;

    for (let index = this.thermals.length - 1; index >= 0; index -= 1) {
      const thermal = this.thermals[index];
      thermal.age += delta;
      thermal.cycleFactor = getThermalCycleFactor(thermal);

      if (thermal.age >= thermal.lifetimeSeconds) {
        if (referenceEntity) {
          // Termica morreu: remove; ensureAheadThermals repõe adiante.
          this.removeThermal(index);
          continue;
        }
        // Sem rodada em andamento, recicla no lugar com nova forca e ciclo.
        recycleThermal(thermal);
      }

      thermal.position.x += wind.x * worldUnitsPerMeter * THERMAL_CONFIG.driftScale * delta;
      thermal.position.z += wind.z * worldUnitsPerMeter * THERMAL_CONFIG.driftScale * delta;

      if (halfSize > 0) {
        if (thermal.position.x > halfSize) thermal.position.x = -halfSize;
        if (thermal.position.x < -halfSize) thermal.position.x = halfSize;
        if (thermal.position.z > halfSize) thermal.position.z = -halfSize;
        if (thermal.position.z < -halfSize) thermal.position.z = halfSize;
      }

      const groundHeight = this.terrain.getHeightAt(thermal.position.x, thermal.position.z);
      updateThermalVerticalLayout(thermal, groundHeight, wind, this.sunDirection, this.terrain);
      applyCycleOpacity(thermal);

      animateParticles(thermal, delta);
      animateBirds(thermal, delta);
    }
  }

  ensureAheadThermals(referenceEntity) {
    const forward = referenceEntity.getForwardVector();
    const aheadCount = this.countAheadThermals(referenceEntity.position, forward);
    const missingThermals = Math.max(0, THERMAL_CONFIG.minAheadThermals - aheadCount);

    for (let index = 0; index < missingThermals && this.thermals.length < THERMAL_CONFIG.maxThermals; index += 1) {
      this.spawnThermalAhead(referenceEntity.position, forward);
    }
  }

  countAheadThermals(position, forward) {
    let count = 0;

    for (const thermal of this.thermals) {
      const dx = thermal.position.x - position.x;
      const dz = thermal.position.z - position.z;
      const aheadDistance = dx * forward.x + dz * forward.z;
      if (aheadDistance <= 0 || aheadDistance > THERMAL_CONFIG.aheadCheckDistance) continue;

      const lateralDistance = Math.abs(dx * -forward.z + dz * forward.x);
      if (lateralDistance <= THERMAL_CONFIG.spawnLateralSpread) count += 1;
    }

    return count;
  }

  spawnThermalAhead(position, forward) {
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const aheadDistance = THREE.MathUtils.randFloat(THERMAL_CONFIG.spawnAheadMin, THERMAL_CONFIG.spawnAheadMax);
    const lateralDistance = THREE.MathUtils.randFloatSpread(THERMAL_CONFIG.spawnLateralSpread * 2);
    const spawnPosition = new THREE.Vector3()
      .copy(position)
      .addScaledVector(forward, aheadDistance)
      .addScaledVector(right, lateralDistance);

    if (!this.hasEnoughSpacing(spawnPosition)) return;

    const seed = {
      x: spawnPosition.x,
      z: spawnPosition.z,
      radius: THREE.MathUtils.randFloat(THERMAL_CONFIG.dynamicRadiusMin, THERMAL_CONFIG.dynamicRadiusMax),
      strength: THREE.MathUtils.randFloat(THERMAL_CONFIG.dynamicStrengthMin, THERMAL_CONFIG.dynamicStrengthMax)
    };
    const isHotThermal = Math.random() < THERMAL_CONFIG.dynamicHotChance;
    const thermal = createThermal(
      seed,
      this.nextThermalId++,
      this.terrain,
      isHotThermal,
      this.sunDirection,
      this.topAltitude
    );
    applyAssistVisibility(thermal, this.assistVisualsVisible);

    this.thermals.push(thermal);
    this.group.add(thermal.visual);
  }

  hasEnoughSpacing(position) {
    for (const thermal of this.thermals) {
      const distance = Math.hypot(position.x - thermal.position.x, position.z - thermal.position.z);
      if (distance < THERMAL_CONFIG.minThermalSpacing) return false;
    }

    return true;
  }

  pruneDistantThermals(referenceEntity) {
    if (this.thermals.length <= THERMAL_CONFIG.minAheadThermals) return;

    const forward = referenceEntity.getForwardVector();

    for (let index = this.thermals.length - 1; index >= 0; index -= 1) {
      if (this.thermals.length <= THERMAL_CONFIG.minAheadThermals) return;

      const thermal = this.thermals[index];
      const dx = thermal.position.x - referenceEntity.position.x;
      const dz = thermal.position.z - referenceEntity.position.z;
      const aheadDistance = dx * forward.x + dz * forward.z;

      if (aheadDistance < -THERMAL_CONFIG.behindPruneDistance) {
        this.removeThermal(index);
      }
    }
  }

  removeThermal(index) {
    const [thermal] = this.thermals.splice(index, 1);
    if (!thermal) return;

    this.group.remove(thermal.visual);
    disposeObject3D(thermal.visual);
  }

  getLiftAt(position) {
    if (!this.enabled) return 0;

    let lift = 0;

    for (const thermal of this.thermals) {
      if (position.y >= thermal.topAltitudeAboveSeaLevel) continue;

      const distance = Math.hypot(position.x - thermal.position.x, position.z - thermal.position.z);
      const radiusRatio = distance / thermal.radius;
      if (radiusRatio >= THERMAL_CONFIG.sinkRingOuterRatio) continue;

      const effectiveStrength = thermal.strength
        * (thermal.cycleFactor ?? 1)
        * getVerticalLiftFactor(thermal, position.y)
        * getLowLevelFactor(thermal, position.y);

      if (radiusRatio < 1) {
        // Nucleo gaussiano: forte no centro, ~6% na borda do raio.
        lift += effectiveStrength * Math.exp(-THERMAL_CONFIG.gaussianFalloff * radiusRatio * radiusRatio);
      } else {
        // Anel de descendencia: o ar que sobe no nucleo desce ao redor.
        const ringProgress = (radiusRatio - 1) / (THERMAL_CONFIG.sinkRingOuterRatio - 1);
        lift -= effectiveStrength
          * THERMAL_CONFIG.sinkRingStrengthRatio
          * Math.sin(ringProgress * Math.PI);
      }
    }

    return lift;
  }

  getInteractionAt(position) {
    if (!this.enabled) return null;

    let bestInteraction = null;
    let bestLift = -Infinity;

    for (const thermal of this.thermals) {
      const interaction = getThermalInteraction(thermal, position);
      if (!interaction) continue;

      if (interaction.lift > bestLift) {
        bestLift = interaction.lift;
        bestInteraction = interaction;
      }
    }

    return bestInteraction;
  }

  getNearestThermal(position) {
    if (!this.enabled || this.thermals.length === 0) return null;

    let nearest = this.thermals[0];
    let nearestDistance = Infinity;

    for (const thermal of this.thermals) {
      const distance = Math.hypot(position.x - thermal.position.x, position.z - thermal.position.z);
      if (distance < nearestDistance) {
        nearest = thermal;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.group.visible = this.enabled;
  }
}

function createThermal(
  seed,
  id,
  terrain,
  isHotThermal,
  sunDirection = DEFAULT_SUN_DIRECTION,
  topAltitudeAboveSeaLevel = THERMAL_CONFIG.topAltitudeAboveSeaLevel
) {
  const position = new THREE.Vector3(seed.x, 0, seed.z);
  const visual = new THREE.Group();
  visual.name = `Thermal_${id}`;
  const strengthMultiplier = isHotThermal
    ? THREE.MathUtils.randFloat(THERMAL_CONFIG.hotStrengthMultiplierMin, THERMAL_CONFIG.hotStrengthMultiplierMax)
    : THREE.MathUtils.randFloat(THERMAL_CONFIG.minStrengthMultiplier, THERMAL_CONFIG.maxStrengthMultiplier);
  const strength = Math.min(
    THERMAL_CONFIG.maxStrengthMetersPerSecond,
    seed.strength * strengthMultiplier
  );

  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(seed.radius, seed.radius * 0.72, 1, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff3d2,
      transparent: true,
      opacity: 0.055,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  visual.add(column);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(seed.radius, 2.4, 8, 48),
    new THREE.MeshBasicMaterial({
      color: 0xfff0a8,
      transparent: true,
      opacity: 0.24,
      depthWrite: false
    })
  );
  ring.rotation.x = Math.PI / 2;
  visual.add(ring);

  const birds = createThermalBirds(seed.radius);
  visual.add(birds);

  const cloud = createCloud(seed.radius);
  visual.add(cloud);

  const cloudShadow = createCloudShadow({
    width: seed.radius * THERMAL_CONFIG.cloudDiameterMultiplier * 1.55,
    opacity: 0.34
  });
  visual.add(cloudShadow);

  const label = createThermalLabel(strength);
  visual.add(label);

  const particles = [];
  const particleMaterial = new THREE.MeshBasicMaterial({
    color: 0xfdf7ea,
    transparent: true,
    opacity: 0.3,
    depthWrite: false
  });

  for (let i = 0; i < THERMAL_CONFIG.particleCount; i += 1) {
    const particle = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 6), particleMaterial);
    const angle = (i / THERMAL_CONFIG.particleCount) * Math.PI * 2;
    const radius = seed.radius * (0.2 + ((i * 7) % 10) / 16);
    particle.userData.baseAngle = angle;
    particle.userData.radius = radius;
    particle.userData.heightOffset = 0;
    particles.push(particle);
    visual.add(particle);
  }

  const groundHeight = terrain.getHeightAt(position.x, position.z);
  const thermal = {
    id,
    position,
    radius: seed.radius,
    strength,
    baseStrength: seed.strength,
    strengthMultiplier,
    isHotThermal,
    topAltitudeAboveSeaLevel,
    age: 0,
    lifetimeSeconds: THREE.MathUtils.randFloat(
      THERMAL_CONFIG.lifetimeMinSeconds,
      THERMAL_CONFIG.lifetimeMaxSeconds
    ),
    cycleFactor: 0,
    columnHeight: 0,
    tiltOffset: new THREE.Vector3(),
    birdTime: Math.random() * 10,
    visual,
    column,
    ring,
    cloud,
    cloudShadow,
    label,
    birds,
    particles
  };
  visual.userData.tiltOffset = thermal.tiltOffset;

  updateThermalVerticalLayout(thermal, groundHeight, new THREE.Vector3(), sunDirection, terrain);

  for (let i = 0; i < particles.length; i += 1) {
    const particle = particles[i];
    particle.userData.heightOffset = (i / particles.length) * thermal.columnHeight;
    positionThermalParticle(particle, thermal.columnHeight);
  }

  return thermal;
}

function getThermalInteraction(thermal, position) {
  if (position.y >= thermal.topAltitudeAboveSeaLevel) return null;

  const distance = Math.hypot(position.x - thermal.position.x, position.z - thermal.position.z);
  const radiusRatio = distance / thermal.radius;
  if (radiusRatio >= THERMAL_CONFIG.sinkRingOuterRatio) return null;

  const effectiveStrength = thermal.strength
    * (thermal.cycleFactor ?? 1)
    * getVerticalLiftFactor(thermal, position.y)
    * getLowLevelFactor(thermal, position.y);
  let lift = 0;

  if (radiusRatio < 1) {
    lift = effectiveStrength * Math.exp(-THERMAL_CONFIG.gaussianFalloff * radiusRatio * radiusRatio);
  } else {
    const ringProgress = (radiusRatio - 1) / (THERMAL_CONFIG.sinkRingOuterRatio - 1);
    lift = -effectiveStrength
      * THERMAL_CONFIG.sinkRingStrengthRatio
      * Math.sin(ringProgress * Math.PI);
  }

  return {
    thermal,
    lift,
    radiusRatio,
    riskMultiplier: getThermalRiskMultiplier(thermal),
    isRisky: thermal.isHotThermal || thermal.strength >= 4
  };
}

function getThermalRiskMultiplier(thermal) {
  if (thermal.isHotThermal || thermal.strength >= 4) return 2;
  if (thermal.strength >= 3.2) return 1.5;
  return 1;
}

function createThermalLabel(strength) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  const label = `+${strength.toFixed(1)} m/s`;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(16, 31, 42, 0.72)';
  drawRoundRect(context, 10, 14, 236, 68, 18);
  context.fill();
  context.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  context.lineWidth = 4;
  context.stroke();
  context.fillStyle = '#fff0a8';
  context.font = '700 38px Arial, Helvetica, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = 'ThermalLiftLabel';
  sprite.scale.set(THERMAL_CONFIG.labelWidth, THERMAL_CONFIG.labelHeight, 1);
  return sprite;
}

function drawRoundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function createCloud(radius) {
  const cloud = createCloudBillboard({
    width: radius * THERMAL_CONFIG.cloudDiameterMultiplier * 1.5,
    variant: Math.floor(Math.random() * 4),
    opacity: THERMAL_CONFIG.cloudOpacity
  });
  cloud.name = 'ThermalTopCloud';
  return cloud;
}

function updateThermalVerticalLayout(thermal, groundHeight, wind, sunDirection = DEFAULT_SUN_DIRECTION, terrain = null) {
  const columnHeight = Math.max(0, thermal.topAltitudeAboveSeaLevel - groundHeight);
  thermal.columnHeight = columnHeight;
  thermal.visual.visible = columnHeight > 0;
  if (columnHeight <= 0) return;

  const windSpeed = Math.hypot(wind.x, wind.z);
  const tiltDegrees = THREE.MathUtils.mapLinear(
    THREE.MathUtils.clamp(windSpeed * 3.6, 10, 50),
    10,
    50,
    THERMAL_CONFIG.minTiltDegrees,
    THERMAL_CONFIG.maxTiltDegrees
  );
  const tiltOffset = Math.min(
    Math.tan(THREE.MathUtils.degToRad(tiltDegrees)) * columnHeight,
    columnHeight * THERMAL_CONFIG.maxTiltOffsetRatio
  );

  tempWindDirection.set(wind.x, 0, wind.z);
  if (tempWindDirection.lengthSq() > 0.0001) {
    tempWindDirection.normalize().multiplyScalar(tiltOffset);
  } else {
    tempWindDirection.set(0, 0, 0);
  }

  thermal.visual.position.set(thermal.position.x, groundHeight, thermal.position.z);
  thermal.tiltOffset.copy(tempWindDirection);
  tempColumnAxis.set(thermal.tiltOffset.x, columnHeight, thermal.tiltOffset.z);
  const columnLength = tempColumnAxis.length();

  thermal.column.scale.y = columnLength;
  thermal.column.position.set(thermal.tiltOffset.x / 2, columnHeight / 2, thermal.tiltOffset.z / 2);
  tempColumnQuaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    tempColumnAxis.normalize()
  );
  thermal.column.quaternion.copy(tempColumnQuaternion);
  thermal.ring.position.set(0, 0.5, 0);
  thermal.label.position.set(0, THERMAL_CONFIG.labelGroundClearance, thermal.radius * 0.92);
  thermal.cloud.position.set(thermal.tiltOffset.x, columnHeight, thermal.tiltOffset.z);
  updateCloudShadow(thermal, groundHeight, sunDirection, terrain);
}

function updateCloudShadow(thermal, groundHeight, sunDirection, terrain) {
  const shadow = thermal.cloudShadow;
  if (!shadow) return;

  if (sunDirection.y <= 0.05) {
    shadow.visible = false;
    return;
  }

  // Projeta a base da nuvem ao longo do raio de sol ate o chao.
  const rayLength = thermal.columnHeight / sunDirection.y;
  const localX = thermal.tiltOffset.x - sunDirection.x * rayLength;
  const localZ = thermal.tiltOffset.z - sunDirection.z * rayLength;
  const shadowGroundHeight = terrain
    ? terrain.getRenderedHeightAt?.(thermal.position.x + localX, thermal.position.z + localZ)
      ?? terrain.getHeightAt(thermal.position.x + localX, thermal.position.z + localZ)
    : groundHeight;

  shadow.visible = true;
  shadow.rotation.z = Math.atan2(-sunDirection.z, -sunDirection.x);
  shadow.position.set(localX, shadowGroundHeight - groundHeight + 3.5, localZ);
}

// Ciclo de vida: rampa ao nascer, plena no meio, decaimento antes de morrer.
function getThermalCycleFactor(thermal) {
  const rampUp = THREE.MathUtils.clamp(thermal.age / THERMAL_CONFIG.rampUpSeconds, 0, 1);
  const remaining = thermal.lifetimeSeconds - thermal.age;
  const decay = THREE.MathUtils.clamp(remaining / THERMAL_CONFIG.decaySeconds, 0, 1);
  return Math.min(rampUp, decay);
}

function recycleThermal(thermal) {
  thermal.age = 0;
  thermal.lifetimeSeconds = THREE.MathUtils.randFloat(
    THERMAL_CONFIG.lifetimeMinSeconds,
    THERMAL_CONFIG.lifetimeMaxSeconds
  );
  thermal.strengthMultiplier = thermal.isHotThermal
    ? THREE.MathUtils.randFloat(THERMAL_CONFIG.hotStrengthMultiplierMin, THERMAL_CONFIG.hotStrengthMultiplierMax)
    : THREE.MathUtils.randFloat(THERMAL_CONFIG.minStrengthMultiplier, THERMAL_CONFIG.maxStrengthMultiplier);
  thermal.strength = Math.min(
    THERMAL_CONFIG.maxStrengthMetersPerSecond,
    thermal.baseStrength * thermal.strengthMultiplier
  );
  thermal.cycleFactor = 0;
}

// Perto do solo a termica ainda esta se organizando: sobe fraca e turbulenta.
function getLowLevelFactor(thermal, altitude) {
  const groundHeight = thermal.visual.position.y;
  const heightAboveGround = altitude - groundHeight;
  const ramp = THREE.MathUtils.clamp(heightAboveGround / THERMAL_CONFIG.lowLevelRampMeters, 0, 1);
  return THREE.MathUtils.lerp(THERMAL_CONFIG.lowLevelMinFactor, 1, ramp);
}

// A nuvem cumulus e os visuais acompanham a fase da termica: nasce timida,
// encorpa no auge e dissolve quando o ciclo termina.
function applyCycleOpacity(thermal) {
  const cycle = THREE.MathUtils.clamp(thermal.cycleFactor ?? 1, 0, 1);

  setFadedOpacity(thermal.column.material, 0.055, cycle);
  setFadedOpacity(thermal.ring.material, 0.24, cycle);
  if (thermal.particles.length > 0) {
    setFadedOpacity(thermal.particles[0].material, 0.3, cycle);
  }
  setFadedOpacity(thermal.label.material, 1, cycle);
  if (thermal.cloudShadow) {
    setFadedOpacity(thermal.cloudShadow.material, 0.34, cycle);
  }
  thermal.cloud.traverse((child) => {
    if (!child.isSprite) return;
    if (child.userData.baseOpacity === undefined) {
      child.userData.baseOpacity = child.material.opacity;
    }
    child.material.opacity = child.userData.baseOpacity * (0.25 + 0.75 * cycle);
  });
}

function setFadedOpacity(material, baseOpacity, cycle) {
  if (!material) return;
  material.opacity = baseOpacity * cycle;
}

function applyAssistVisibility(thermal, visible) {
  thermal.column.visible = visible;
  thermal.ring.visible = visible;
  thermal.label.visible = visible;
  for (const particle of thermal.particles) {
    particle.visible = visible;
  }
}

function getVerticalLiftFactor(thermal, altitude) {
  const fadeStart = thermal.topAltitudeAboveSeaLevel - THERMAL_CONFIG.liftFadeBandMeters;
  if (altitude <= fadeStart) return 1;

  const fadeProgress = THREE.MathUtils.clamp(
    (altitude - fadeStart) / THERMAL_CONFIG.liftFadeBandMeters,
    0,
    1
  );
  const topFactor = Math.min(1, THERMAL_CONFIG.topLiftMetersPerSecond / thermal.strength);
  return THREE.MathUtils.lerp(1, topFactor, fadeProgress);
}

function createThermalBirds(radius) {
  const group = new THREE.Group();
  group.name = 'ThermalBirds';
  const material = new THREE.MeshBasicMaterial({ color: 0x2d2f33, side: THREE.DoubleSide });
  const count = 3 + Math.floor(Math.random() * 3);

  for (let index = 0; index < count; index += 1) {
    const bird = createBird(material);
    bird.userData.orbitRadius = radius * (0.28 + Math.random() * 0.45);
    bird.userData.angle = Math.random() * Math.PI * 2;
    bird.userData.orbitSpeed = 0.32 + Math.random() * 0.26;
    bird.userData.heightRatio = 0.3 + Math.random() * 0.45;
    bird.userData.flapPhase = Math.random() * Math.PI * 2;
    bird.userData.flapSpeed = 4.5 + Math.random() * 2.5;
    group.add(bird);
  }

  return group;
}

function createBird(material) {
  const bird = new THREE.Group();
  const wingGeometry = new THREE.BufferGeometry();
  wingGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0.35,
    1.35, 0.1, 0.55,
    1.35, 0.1, -0.4,
    0, 0, 0.35,
    1.35, 0.1, -0.4,
    0, 0, -0.55
  ], 3));
  wingGeometry.computeVertexNormals();

  const rightWing = new THREE.Mesh(wingGeometry, material);
  const leftWing = new THREE.Mesh(wingGeometry, material);
  leftWing.scale.x = -1;
  bird.add(rightWing, leftWing);
  bird.userData.wings = { leftWing, rightWing };
  return bird;
}

function animateBirds(thermal, delta) {
  if (thermal.columnHeight <= 0 || !thermal.birds) return;

  thermal.birdTime += delta;

  for (const bird of thermal.birds.children) {
    bird.userData.angle += delta * bird.userData.orbitSpeed;
    const height = thermal.columnHeight * bird.userData.heightRatio;
    const drift = bird.userData.heightRatio;
    bird.position.set(
      Math.cos(bird.userData.angle) * bird.userData.orbitRadius + thermal.tiltOffset.x * drift,
      height,
      Math.sin(bird.userData.angle) * bird.userData.orbitRadius + thermal.tiltOffset.z * drift
    );
    bird.rotation.y = -bird.userData.angle;

    // Planar com batidas de asa ocasionais, como urubus em termica.
    const flapCycle = Math.sin(thermal.birdTime * 0.6 + bird.userData.flapPhase);
    const flapStrength = THREE.MathUtils.clamp((flapCycle - 0.55) / 0.45, 0, 1);
    const flap = Math.sin(thermal.birdTime * bird.userData.flapSpeed + bird.userData.flapPhase) * 0.5 * flapStrength;
    bird.userData.wings.rightWing.rotation.z = flap + 0.08;
    bird.userData.wings.leftWing.rotation.z = -flap - 0.08;
  }
}

function animateParticles(thermal, delta) {
  if (thermal.columnHeight <= 0) return;

  for (const particle of thermal.particles) {
    particle.userData.heightOffset = (particle.userData.heightOffset + delta * THERMAL_CONFIG.particleRiseSpeed) % thermal.columnHeight;
    particle.userData.baseAngle += delta * 0.85;

    positionThermalParticle(particle, thermal.columnHeight);
  }
}

function positionThermalParticle(particle, columnHeight) {
  const progress = particle.userData.heightOffset / columnHeight;
  tempParticleForward.copy(particle.parent.userData.tiltOffset ?? tempWindDirection).multiplyScalar(progress);
  tempParticleSide.set(
    Math.cos(particle.userData.baseAngle) * particle.userData.radius,
    0,
    Math.sin(particle.userData.baseAngle) * particle.userData.radius
  );

  particle.position.set(
    tempParticleSide.x + tempParticleForward.x,
    particle.userData.heightOffset,
    tempParticleSide.z + tempParticleForward.z
  );
}

function disposeObject3D(object) {
  const disposedGeometries = new Set();
  const disposedMaterials = new Set();

  object.traverse((child) => {
    if (child.geometry && !disposedGeometries.has(child.geometry)) {
      child.geometry.dispose();
      disposedGeometries.add(child.geometry);
    }

    if (!child.material) return;

    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        if (!disposedMaterials.has(material)) {
          disposeMaterialTextures(material);
          material.dispose();
          disposedMaterials.add(material);
        }
      }
    } else if (!disposedMaterials.has(child.material)) {
      disposeMaterialTextures(child.material);
      child.material.dispose();
      disposedMaterials.add(child.material);
    }
  });
}

function disposeMaterialTextures(material) {
  for (const value of Object.values(material)) {
    if (value?.isTexture && !value.userData.shared) value.dispose();
  }
}
