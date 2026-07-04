import * as THREE from 'three';

const THERMAL_CONFIG = {
  columnHeight: 650,
  driftScale: 0.16,
  particleCount: 26,
  liftFalloffExponent: 1.7,
  minStrengthMultiplier: 0.85,
  maxStrengthMultiplier: 1.15,
  hotStrengthMultiplierMin: 1.35,
  hotStrengthMultiplierMax: 1.65
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
    this.thermals = THERMAL_SEEDS.map((seed, index) => createThermal(seed, index, terrain, hotThermalIndex));

    for (const thermal of this.thermals) {
      this.group.add(thermal.visual);
    }
  }

  update(delta, wind) {
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

function createThermal(seed, index, terrain, hotThermalIndex) {
  const position = new THREE.Vector3(seed.x, 0, seed.z);
  const visual = new THREE.Group();
  visual.name = `Thermal_${index + 1}`;
  const strengthMultiplier = index === hotThermalIndex
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
    isHotThermal: index === hotThermalIndex,
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
