import * as THREE from 'three';

const THERMAL_CONFIG = {
  columnHeight: 650,
  driftScale: 0.16,
  particleCount: 26,
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
  minThermalSpacing: 260,
  dynamicRadiusMin: 90,
  dynamicRadiusMax: 145,
  dynamicStrengthMin: 3.1,
  dynamicStrengthMax: 4.3,
  dynamicHotChance: 0.18
};

const THERMAL_SEEDS = [
  { x: -280, z: -220, radius: 95, strength: 3.7 },
  { x: 360, z: -430, radius: 115, strength: 3.3 },
  { x: 640, z: 380, radius: 135, strength: 4.1 },
  { x: -420, z: 520, radius: 105, strength: 3.5 }
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
      thermal.visual.position.set(
        thermal.position.x,
        groundHeight + THERMAL_CONFIG.columnHeight / 2,
        thermal.position.z
      );

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
    new THREE.CylinderGeometry(seed.radius, seed.radius * 0.72, THERMAL_CONFIG.columnHeight, 24, 1, true),
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
  ring.position.y = -THERMAL_CONFIG.columnHeight / 2 + 0.5;
  visual.add(ring);

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
    particle.userData.heightOffset = (i / THERMAL_CONFIG.particleCount) * THERMAL_CONFIG.columnHeight;
    particle.position.set(Math.cos(angle) * radius, particle.userData.heightOffset - THERMAL_CONFIG.columnHeight / 2, Math.sin(angle) * radius);
    particles.push(particle);
    visual.add(particle);
  }

  const groundHeight = terrain.getHeightAt(position.x, position.z);
  visual.position.set(position.x, groundHeight + THERMAL_CONFIG.columnHeight / 2, position.z);

  return {
    position,
    radius: seed.radius,
    strength,
    baseStrength: seed.strength,
    strengthMultiplier,
    isHotThermal,
    visual,
    particles
  };
}

function animateParticles(thermal, delta) {
  for (const particle of thermal.particles) {
    particle.userData.heightOffset = (particle.userData.heightOffset + delta * 28) % THERMAL_CONFIG.columnHeight;
    particle.userData.baseAngle += delta * 0.85;

    particle.position.set(
      Math.cos(particle.userData.baseAngle) * particle.userData.radius,
      particle.userData.heightOffset - THERMAL_CONFIG.columnHeight / 2,
      Math.sin(particle.userData.baseAngle) * particle.userData.radius
    );
  }
}

function disposeObject3D(object) {
  const disposedMaterials = new Set();

  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (!child.material) return;

    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        if (!disposedMaterials.has(material)) {
          material.dispose();
          disposedMaterials.add(material);
        }
      }
    } else if (!disposedMaterials.has(child.material)) {
      child.material.dispose();
      disposedMaterials.add(child.material);
    }
  });
}
