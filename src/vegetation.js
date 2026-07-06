import * as THREE from 'three';
import { terrainValueNoise } from './terrain.js';

// Floresta instanciada em massa com impostors: cada arvore sao 3 quads (2
// verticais cruzados + 1 tampa horizontal, para a copa ter leitura tambem
// vista de cima, que e o angulo dominante em voo) com textura de canvas em
// atlas (metade esquerda = perfil, metade direita = topo da copa).
// A densidade segue o mesmo campo de ruido que pinta mata/clareira na cor do
// terreno (terrainValueNoise), entao as copas nascem exatamente sobre os
// pixels verdes de floresta e poupam os pastos.

const VEGETATION_CONFIG = {
  maxInstances: 24000,
  cellSize: 24,
  radius: 2400,
  rebuildDistance: 320,
  presenceThreshold: 0.22,
  maxForestHeight: 1480,
  // addTerrainColor abre clareiras a partir de patchNoise 0.62; margem para a
  // borda da mata nao invadir o pasto, esfarelada por hash de celula.
  forestPatchLimit: 0.64,
  patchNoiseScale: 0.004
};

const treeColors = [
  new THREE.Color(0x2d5130),
  new THREE.Color(0x35673b),
  new THREE.Color(0x427744),
  new THREE.Color(0x28492b),
  new THREE.Color(0x4d7142),
  new THREE.Color(0x6b804f)
];

export function createVegetation({ terrain }) {
  return new Vegetation(terrain);
}

class Vegetation {
  constructor(terrain) {
    this.terrain = terrain;
    this.lastCenter = null;
    this.lastVectorRevision = 0;
    this.retryAt = 0;
    this.group = new THREE.Group();
    this.group.name = 'InstancedVegetation';

    const material = new THREE.MeshStandardMaterial({
      map: createTreeTexture(),
      // alphaTest (em vez de blending) mantem depth write e permite sombra
      // recortada: o shadow map do three reaproveita map+alphaTest no depth pass.
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 0.95,
      metalness: 0
    });
    this.treeMesh = new THREE.InstancedMesh(
      createTreeGeometry(),
      material,
      VEGETATION_CONFIG.maxInstances
    );
    this.treeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.treeMesh.castShadow = true;
    this.treeMesh.receiveShadow = false;
    this.treeMesh.count = 0;
    this.group.add(this.treeMesh);
    this.dummy = new THREE.Object3D();
  }

  update(position) {
    if (!this.terrain.isReady) return;

    // Enquanto os chunks iniciais carregam, tenta replantar periodicamente.
    const now = performance.now();
    const needsRetry = this.treeMesh.count === 0 && now >= this.retryAt;
    const moved = !this.lastCenter
      || this.lastCenter.distanceTo(position) >= VEGETATION_CONFIG.rebuildDistance;
    // Vetores urbanos chegam depois do relevo; replanta para tirar arvores
    // que nasceram sobre ruas/casas antes da mascara existir.
    const vectorRevision = this.terrain.vectorRevision ?? 0;
    const vectorsChanged = vectorRevision !== this.lastVectorRevision;
    if (!moved && !needsRetry && !vectorsChanged) return;

    this.retryAt = now + 2000;
    this.lastCenter = position.clone();
    this.lastVectorRevision = vectorRevision;
    this.rebuild(position);
  }

  reset() {
    this.lastCenter = null;
    this.retryAt = 0;
    this.treeMesh.count = 0;
    this.treeMesh.instanceMatrix.needsUpdate = true;
  }

  rebuild(center) {
    const {
      cellSize, radius, presenceThreshold, maxForestHeight,
      maxInstances, forestPatchLimit, patchNoiseScale
    } = VEGETATION_CONFIG;
    const fallbackHeight = this.terrain.config?.fallbackHeight;
    const minCellX = Math.floor((center.x - radius) / cellSize);
    const maxCellX = Math.floor((center.x + radius) / cellSize);
    const minCellZ = Math.floor((center.z - radius) / cellSize);
    const maxCellZ = Math.floor((center.z + radius) / cellSize);
    const radiusSq = radius * radius;
    let count = 0;

    for (let cellZ = minCellZ; cellZ <= maxCellZ && count < maxInstances; cellZ += 1) {
      for (let cellX = minCellX; cellX <= maxCellX && count < maxInstances; cellX += 1) {
        const presence = hashCell(cellX, cellZ, 0);
        if (presence < presenceThreshold) continue;

        const x = (cellX + 0.15 + hashCell(cellX, cellZ, 1) * 0.7) * cellSize;
        const z = (cellZ + 0.15 + hashCell(cellX, cellZ, 2) * 0.7) * cellSize;
        const dx = x - center.x;
        const dz = z - center.z;
        if (dx * dx + dz * dz > radiusSq) continue;

        // Mata apenas fora das clareiras pintadas no terreno.
        const patch = terrainValueNoise(x * patchNoiseScale, z * patchNoiseScale);
        if (patch > forestPatchLimit - hashCell(cellX, cellZ, 7) * 0.08) continue;

        // Usa a altura da malha renderizada para a arvore apoiar no relevo visivel.
        const groundHeight = this.terrain.getRenderedHeightAt
          ? this.terrain.getRenderedHeightAt(x, z)
          : this.terrain.getHeightAt(x, z);
        // fallbackHeight indica chunk ainda nao carregado; evita arvores flutuando.
        if (groundHeight === fallbackHeight || groundHeight > maxForestHeight) continue;
        if (this.terrain.isSeaAt?.(x, z)) continue;
        if (this.terrain.isCoastalSandAt?.(x, z)) continue;
        // Nada de arvore sobre ruas, rodovias, ferrovias ou manchas de cidade.
        if (this.terrain.isUrbanBlockedAt?.(x, z)) continue;

        const scale = 0.7 + hashCell(cellX, cellZ, 3) * 0.8;
        this.dummy.position.set(x, groundHeight - 0.6, z);
        this.dummy.scale.set(scale, scale * (0.85 + hashCell(cellX, cellZ, 4) * 0.4), scale);
        this.dummy.rotation.y = hashCell(cellX, cellZ, 5) * Math.PI * 2;
        this.dummy.updateMatrix();
        this.treeMesh.setMatrixAt(count, this.dummy.matrix);
        this.treeMesh.setColorAt(
          count,
          treeColors[Math.floor(hashCell(cellX, cellZ, 6) * treeColors.length)]
        );
        count += 1;
      }
    }

    this.treeMesh.count = count;
    this.treeMesh.instanceMatrix.needsUpdate = true;
    if (this.treeMesh.instanceColor) this.treeMesh.instanceColor.needsUpdate = true;
    this.treeMesh.computeBoundingSphere();
  }
}

// 2 quads verticais cruzados (perfil) + 1 quad horizontal na altura da copa
// (topo), cada um mapeado na metade correspondente do atlas.
function createTreeGeometry() {
  const side = new THREE.PlaneGeometry(10.5, 14);
  side.translate(0, 7, 0);
  remapUv(side, 0, 0.5);
  const crossed = side.clone();
  crossed.rotateY(Math.PI / 2);
  const top = new THREE.PlaneGeometry(10, 10);
  top.rotateX(-Math.PI / 2);
  top.translate(0, 8.8, 0);
  remapUv(top, 0.5, 1);
  return mergeBufferGeometries([side, crossed, top]);
}

function remapUv(geometry, start, end) {
  const uv = geometry.attributes.uv;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setX(index, start + uv.getX(index) * (end - start));
  }
}

function mergeBufferGeometries(geometries) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let vertexOffset = 0;

  for (const geometry of geometries) {
    positions.push(...geometry.attributes.position.array);
    normals.push(...geometry.attributes.normal.array);
    uvs.push(...geometry.attributes.uv.array);
    for (const index of geometry.index.array) indices.push(index + vertexOffset);
    vertexOffset += geometry.attributes.position.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  return merged;
}

// Atlas 256x128 quase branco (o tom final vem do instanceColor): a esquerda o
// perfil (tronco + copa em blobs solidos, base mais escura), a direita o topo
// da copa em blobs irregulares. Circulos solidos, nao gradientes: com
// alphaTest, borda dura evita a silhueta "encolhida".
let treeTexture = null;

function createTreeTexture() {
  if (treeTexture || typeof document === 'undefined') return treeTexture;

  const width = 256;
  const height = 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const random = createSeededRandom(1337);

  // Perfil: tronco
  context.fillStyle = 'rgb(96, 74, 52)';
  context.fillRect(60, 78, 8, 50);

  // Perfil: copa (blobs mais escuros embaixo, claros em cima)
  for (let index = 0; index < 26; index += 1) {
    const t = index / 25;
    const angle = random() * Math.PI * 2;
    const spreadX = 34 * (1 - t * 0.45);
    const spreadY = 26;
    const x = 64 + Math.cos(angle) * spreadX * random();
    const y = 52 - (t - 0.5) * spreadY * 1.6 + (random() - 0.5) * 10;
    const radius = 9 + random() * 12;
    const shade = 168 + t * 70 + random() * 18;
    context.fillStyle = `rgb(${Math.round(shade * 0.97)}, ${Math.round(shade)}, ${Math.round(shade * 0.92)})`;
    context.beginPath();
    context.arc(x, Math.min(y, 86), radius, 0, Math.PI * 2);
    context.fill();
  }

  // Topo: blob irregular de copa
  for (let index = 0; index < 22; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = random() * 34;
    const x = 192 + Math.cos(angle) * distance;
    const y = 64 + Math.sin(angle) * distance;
    const radius = 10 + random() * 14;
    const shade = 176 + random() * 62;
    context.fillStyle = `rgb(${Math.round(shade * 0.97)}, ${Math.round(shade)}, ${Math.round(shade * 0.92)})`;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  treeTexture = new THREE.CanvasTexture(canvas);
  treeTexture.colorSpace = THREE.SRGBColorSpace;
  treeTexture.anisotropy = 4;
  treeTexture.userData.shared = true;
  return treeTexture;
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

function hashCell(x, z, salt) {
  const value = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}
