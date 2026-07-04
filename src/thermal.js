import * as THREE from 'three';

const THERMAL_CONFIG = {
  topAltitudeAboveSeaLevel: 2000,
  driftScale: 1,
  particleCount: 26,
  particleRiseSpeed: 92,
  liftFalloffExponent: 1.7,
  minStrengthMultiplier: 0.85,
  maxStrengthMultiplier: 1.15,
  hotStrengthMultiplierMin: 1.35,
  hotStrengthMultiplierMax: 1.65,
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
  dynamicStrengthMin: 3.1,
  dynamicStrengthMax: 4.3,
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
  { x: -280, z: -220, radius: 125, strength: 3.7 },
  { x: 360, z: -430, radius: 145, strength: 3.3 },
  { x: 640, z: 380, radius: 170, strength: 4.1 },
  { x: -420, z: 520, radius: 135, strength: 3.5 }
];

export function createThermalField({ scene, terrain }) {
  const field = new ThermalField(terrain);
  scene.add(field.group);
  return field;
}

class ThermalField {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'Thermals';
    const hotThermalIndex = Math.floor(Math.random() * THERMAL_SEEDS.length);
    this.nextThermalId = 1;
    this.thermals = THERMAL_SEEDS.map((seed, index) => createThermal(
      seed,
      this.nextThermalId++,
      terrain,
      index === hotThermalIndex
    ));

    for (const thermal of this.thermals) {
      this.group.add(thermal.visual);
    }
  }

  update(delta, wind, referenceEntity = null) {
    if (referenceEntity) {
      this.ensureAheadThermals(referenceEntity);
      this.pruneDistantThermals(referenceEntity);
    }

    const halfSize = this.terrain.size / 2;
    const worldUnitsPerMeter = this.terrain.worldUnitsPerMeter ?? 1;

    for (const thermal of this.thermals) {
      thermal.position.x += wind.x * worldUnitsPerMeter * THERMAL_CONFIG.driftScale * delta;
      thermal.position.z += wind.z * worldUnitsPerMeter * THERMAL_CONFIG.driftScale * delta;

      if (halfSize > 0) {
        if (thermal.position.x > halfSize) thermal.position.x = -halfSize;
        if (thermal.position.x < -halfSize) thermal.position.x = halfSize;
        if (thermal.position.z > halfSize) thermal.position.z = -halfSize;
        if (thermal.position.z < -halfSize) thermal.position.z = halfSize;
      }

      const groundHeight = this.terrain.getHeightAt(thermal.position.x, thermal.position.z);
      updateThermalVerticalLayout(thermal, groundHeight, wind);

      animateParticles(thermal, delta);
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
    const thermal = createThermal(seed, this.nextThermalId++, this.terrain, isHotThermal);

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
    let lift = 0;

    for (const thermal of this.thermals) {
      if (position.y >= thermal.topAltitudeAboveSeaLevel) continue;

      const distance = Math.hypot(position.x - thermal.position.x, position.z - thermal.position.z);
      if (distance >= thermal.radius) continue;

      const centerInfluence = 1 - distance / thermal.radius;
      lift += thermal.strength * Math.pow(centerInfluence, THERMAL_CONFIG.liftFalloffExponent);
    }

    return lift;
  }

  getNearestThermal(position) {
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
}

function createThermal(seed, id, terrain, isHotThermal) {
  const position = new THREE.Vector3(seed.x, 0, seed.z);
  const visual = new THREE.Group();
  visual.name = `Thermal_${id}`;
  const strengthMultiplier = isHotThermal
    ? THREE.MathUtils.randFloat(THERMAL_CONFIG.hotStrengthMultiplierMin, THERMAL_CONFIG.hotStrengthMultiplierMax)
    : THREE.MathUtils.randFloat(THERMAL_CONFIG.minStrengthMultiplier, THERMAL_CONFIG.maxStrengthMultiplier);
  const strength = seed.strength * strengthMultiplier;

  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(seed.radius, seed.radius * 0.72, 1, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  visual.add(column);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(seed.radius, 3.2, 8, 48),
    new THREE.MeshBasicMaterial({
      color: 0xfff0a8,
      transparent: true,
      opacity: 0.5,
      depthWrite: false
    })
  );
  ring.rotation.x = Math.PI / 2;
  visual.add(ring);

  const cloud = createCloud(seed.radius);
  visual.add(cloud);

  const label = createThermalLabel(strength);
  visual.add(label);

  const particles = [];
  const particleMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.58,
    depthWrite: false
  });

  for (let i = 0; i < THERMAL_CONFIG.particleCount; i += 1) {
    const particle = new THREE.Mesh(new THREE.SphereGeometry(3.8, 8, 6), particleMaterial);
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
    position,
    radius: seed.radius,
    strength,
    baseStrength: seed.strength,
    strengthMultiplier,
    isHotThermal,
    topAltitudeAboveSeaLevel: THERMAL_CONFIG.topAltitudeAboveSeaLevel,
    columnHeight: 0,
    tiltOffset: new THREE.Vector3(),
    visual,
    column,
    ring,
    cloud,
    label,
    particles
  };
  visual.userData.tiltOffset = thermal.tiltOffset;

  updateThermalVerticalLayout(thermal, groundHeight, new THREE.Vector3());

  for (let i = 0; i < particles.length; i += 1) {
    const particle = particles[i];
    particle.userData.heightOffset = (i / particles.length) * thermal.columnHeight;
    positionThermalParticle(particle, thermal.columnHeight);
  }

  return thermal;
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
  const cloud = new THREE.Group();
  cloud.name = 'ThermalTopCloud';

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: THERMAL_CONFIG.cloudOpacity,
    depthWrite: false
  });
  const geometry = new THREE.SphereGeometry(1, 18, 12);
  const cloudRadius = radius * THERMAL_CONFIG.cloudDiameterMultiplier;
  const puffs = [
    { x: -0.04, z: 0.02, y: 0.02, sx: 0.62, sy: 0.22, sz: 0.36 },
    { x: -0.44, z: 0.02, y: -0.02, sx: 0.34, sy: 0.16, sz: 0.26 },
    { x: 0.42, z: -0.04, y: 0.01, sx: 0.38, sy: 0.18, sz: 0.28 },
    { x: 0.02, z: 0.28, y: -0.03, sx: 0.3, sy: 0.14, sz: 0.24 },
    { x: -0.12, z: -0.32, y: 0.03, sx: 0.42, sy: 0.17, sz: 0.24 },
    { x: 0.68, z: 0.12, y: -0.04, sx: 0.23, sy: 0.13, sz: 0.2 },
    { x: -0.72, z: -0.12, y: 0.01, sx: 0.26, sy: 0.12, sz: 0.19 },
    { x: 0.2, z: -0.5, y: -0.01, sx: 0.27, sy: 0.13, sz: 0.18 },
    { x: -0.26, z: 0.48, y: 0.02, sx: 0.24, sy: 0.12, sz: 0.2 }
  ];

  for (const puff of puffs) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(puff.x * cloudRadius, puff.y * cloudRadius, puff.z * cloudRadius);
    mesh.scale.set(puff.sx * cloudRadius, puff.sy * cloudRadius, puff.sz * cloudRadius);
    cloud.add(mesh);
  }

  return cloud;
}

function updateThermalVerticalLayout(thermal, groundHeight, wind) {
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
    if (value?.isTexture) value.dispose();
  }
}
