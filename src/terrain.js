import * as THREE from 'three';

const DEFAULT_OPTIONS = {
  size: 240,
  segments: 96,
  maxHeight: 18,
  seed: 42
};

export function createTerrain(options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const geometry = new THREE.PlaneGeometry(config.size, config.size, config.segments, config.segments);
  geometry.rotateX(-Math.PI / 2);

  const heights = [];
  const positions = geometry.attributes.position;

  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const height = getProceduralHeight(x, z, config);
    positions.setY(i, height);
    heights.push(height);
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x4f8a4b,
    roughness: 0.92,
    metalness: 0,
    flatShading: false
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ProceduralTerrain';

  return {
    mesh,
    size: config.size,
    segments: config.segments,
    getHeightAt: (x, z) => getHeightFromGrid(x, z, heights, config)
  };
}

function getHeightFromGrid(x, z, heights, config) {
  const halfSize = config.size / 2;
  const normalizedX = THREE.MathUtils.clamp((x + halfSize) / config.size, 0, 1);
  const normalizedZ = THREE.MathUtils.clamp((z + halfSize) / config.size, 0, 1);
  const gridX = normalizedX * config.segments;
  const gridZ = normalizedZ * config.segments;
  const x0 = Math.floor(gridX);
  const z0 = Math.floor(gridZ);
  const x1 = Math.min(x0 + 1, config.segments);
  const z1 = Math.min(z0 + 1, config.segments);
  const tx = gridX - x0;
  const tz = gridZ - z0;

  const h00 = heights[getHeightIndex(x0, z0, config.segments)];
  const h10 = heights[getHeightIndex(x1, z0, config.segments)];
  const h01 = heights[getHeightIndex(x0, z1, config.segments)];
  const h11 = heights[getHeightIndex(x1, z1, config.segments)];
  const hx0 = THREE.MathUtils.lerp(h00, h10, tx);
  const hx1 = THREE.MathUtils.lerp(h01, h11, tx);

  return THREE.MathUtils.lerp(hx0, hx1, tz);
}

function getHeightIndex(x, z, segments) {
  return z * (segments + 1) + x;
}

function getProceduralHeight(x, z, config) {
  const broadHills = fractalNoise(x * 0.018, z * 0.018, config.seed, 4);
  const smallVariation = fractalNoise(x * 0.055 + 100, z * 0.055 - 100, config.seed + 17, 3);
  const distanceFromCenter = Math.hypot(x, z) / (config.size * 0.5);
  const edgeLift = THREE.MathUtils.smoothstep(distanceFromCenter, 0.12, 1.0);
  const valley = Math.exp(-(x * x + z * z) / 5200) * 3.5;

  return broadHills * config.maxHeight + smallVariation * 4 + edgeLift * 5 - valley;
}

function fractalNoise(x, z, seed, octaves) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let amplitudeTotal = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    value += smoothNoise(x * frequency, z * frequency, seed + octave * 31) * amplitude;
    amplitudeTotal += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / amplitudeTotal;
}

function smoothNoise(x, z, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const z1 = z0 + 1;
  const tx = smootherStep(x - x0);
  const tz = smootherStep(z - z0);

  const n00 = valueNoise(x0, z0, seed);
  const n10 = valueNoise(x1, z0, seed);
  const n01 = valueNoise(x0, z1, seed);
  const n11 = valueNoise(x1, z1, seed);
  const nx0 = THREE.MathUtils.lerp(n00, n10, tx);
  const nx1 = THREE.MathUtils.lerp(n01, n11, tx);

  return THREE.MathUtils.lerp(nx0, nx1, tz);
}

function smootherStep(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function valueNoise(x, z, seed) {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453123;
  return (n - Math.floor(n)) * 2 - 1;
}

