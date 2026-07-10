import * as THREE from 'three';

// Nuvens billboard com textura desenhada em canvas: bordas suaves, base achatada
// e leve sombreamento inferior. Texturas sao cacheadas por variante e compartilhadas,
// por isso ficam marcadas com userData.shared para nao serem descartadas junto
// com o material de uma nuvem individual.

const TEXTURE_VARIANTS = 4;
const TEXTURE_ASPECT = 0.5;
const textureCache = new Map();

export function createCloudBillboard({ width = 700, variant = 0, opacity = 0.9 } = {}) {
  const group = new THREE.Group();
  group.name = 'CloudBillboard';

  const layers = [
    { scale: 1, x: 0, y: 0, opacity: 1 },
    { scale: 0.6, x: -0.33, y: 0.08, opacity: 0.82 },
    { scale: 0.52, x: 0.35, y: 0.05, opacity: 0.78 }
  ];

  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    const texture = getCloudTexture((variant + index) % TEXTURE_VARIANTS);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: opacity * layer.opacity,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(width * layer.scale, width * layer.scale * TEXTURE_ASPECT, 1);
    sprite.position.set(layer.x * width, layer.y * width * TEXTURE_ASPECT, 0);
    group.add(sprite);
  }

  return group;
}

let cloudShadowTexture = null;

export function createCloudShadow({ width = 700, opacity = 0.24 } = {}) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: getCloudShadowTexture(),
      color: 0x0d1822,
      transparent: true,
      opacity,
      depthWrite: false
    })
  );
  mesh.name = 'CloudShadow';
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(width, width * 0.68, 1);
  return mesh;
}

function getCloudShadowTexture() {
  if (cloudShadowTexture) return cloudShadowTexture;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const random = createSeededRandom(509);

  for (let index = 0; index < 18; index += 1) {
    const t = index / 17;
    const envelope = Math.sin(t * Math.PI);
    const x = size * (0.14 + t * 0.72) + (random() - 0.5) * size * 0.1;
    const y = size * (0.5 + (random() - 0.5) * 0.18);
    const radiusX = size * (0.07 + envelope * 0.11) * (0.75 + random() * 0.5);
    const radiusY = radiusX * (0.58 + random() * 0.2);
    const gradient = context.createRadialGradient(x, y, 0, x, y, Math.max(radiusX, radiusY));
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.78)');
    gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.32)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.save();
    context.translate(x, y);
    context.scale(1, radiusY / radiusX);
    context.translate(-x, -y);
    context.fillStyle = gradient;
    context.fillRect(x - radiusX, y - radiusX, radiusX * 2, radiusX * 2);
    context.restore();
  }

  context.globalCompositeOperation = 'destination-in';
  const fade = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.52);
  fade.addColorStop(0, 'rgba(255, 255, 255, 1)');
  fade.addColorStop(0.7, 'rgba(255, 255, 255, 0.82)');
  fade.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = fade;
  context.fillRect(0, 0, size, size);
  context.globalCompositeOperation = 'source-over';

  cloudShadowTexture = new THREE.CanvasTexture(canvas);
  cloudShadowTexture.userData.shared = true;
  return cloudShadowTexture;
}

function getCloudTexture(variant) {
  if (!textureCache.has(variant)) {
    textureCache.set(variant, createCloudTexture(variant));
  }
  return textureCache.get(variant);
}

function createCloudTexture(variant) {
  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const random = createSeededRandom(97 + variant * 977);

  const baseline = height * 0.66;
  const puffCount = 16;

  for (let index = 0; index < puffCount; index += 1) {
    const t = index / (puffCount - 1);
    const envelope = Math.sin(t * Math.PI);
    const x = width * (0.1 + 0.8 * t) + (random() - 0.5) * 26;
    const radius = (14 + envelope * 56) * (0.7 + random() * 0.6);
    const y = baseline - envelope * height * 0.22 * (0.55 + random() * 0.9);

    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  // Sombreamento sutil na base para dar volume e leitura de cumulus.
  context.globalCompositeOperation = 'source-atop';
  const shading = context.createLinearGradient(0, height * 0.3, 0, baseline + 18);
  shading.addColorStop(0, 'rgba(255, 255, 255, 0)');
  shading.addColorStop(1, 'rgba(148, 164, 182, 0.42)');
  context.fillStyle = shading;
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.shared = true;
  return texture;
}

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
