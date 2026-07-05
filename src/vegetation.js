import * as THREE from 'three';

// Vegetacao instanciada ao redor do jogador: arvores low-poly (copas) espalhadas
// deterministicamente por celula de grade, plantadas apenas em cotas de floresta
// sobre chunks de terreno ja carregados. O conjunto e reconstruido quando o
// jogador se afasta o suficiente do centro anterior.

const VEGETATION_CONFIG = {
  maxInstances: 2200,
  cellSize: 52,
  radius: 1500,
  rebuildDistance: 220,
  presenceThreshold: 0.62,
  maxForestHeight: 1480
};

const treeColors = [
  new THREE.Color(0x2c5230),
  new THREE.Color(0x33603a),
  new THREE.Color(0x3d6a33),
  new THREE.Color(0x28492b),
  new THREE.Color(0x4a7040)
];

export function createVegetation({ terrain }) {
  return new Vegetation(terrain);
}

class Vegetation {
  constructor(terrain) {
    this.terrain = terrain;
    this.lastCenter = null;
    this.group = new THREE.Group();
    this.group.name = 'InstancedVegetation';

    // Copa apoiada no topo do tronco. O plantio usa a altura da malha renderizada
    // (getRenderedHeightAt) e o tronco ainda desce ~8 m abaixo do solo como
    // garantia de contato em encostas ingremes.
    const canopyGeometry = new THREE.SphereGeometry(3.6, 6, 5);
    canopyGeometry.scale(1, 1.2, 1);
    canopyGeometry.translate(0, 5.4, 0);

    const trunkGeometry = new THREE.CylinderGeometry(0.32, 0.85, 14, 5);
    trunkGeometry.translate(0, -1, 0);

    this.canopyMesh = createInstancedPart(
      canopyGeometry,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 })
    );
    this.trunkMesh = createInstancedPart(
      trunkGeometry,
      new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.95, metalness: 0 })
    );
    this.group.add(this.canopyMesh, this.trunkMesh);
    this.dummy = new THREE.Object3D();
  }

  update(position) {
    if (!this.terrain.isReady) return;

    // Enquanto os chunks iniciais carregam, tenta replantar periodicamente.
    const now = performance.now();
    const needsRetry = this.canopyMesh.count === 0 && now >= (this.retryAt ?? 0);
    const moved = !this.lastCenter || this.lastCenter.distanceTo(position) >= VEGETATION_CONFIG.rebuildDistance;
    if (!moved && !needsRetry) return;

    this.retryAt = now + 2000;
    this.lastCenter = position.clone();
    this.rebuild(position);
  }

  rebuild(center) {
    const { cellSize, radius, presenceThreshold, maxForestHeight, maxInstances } = VEGETATION_CONFIG;
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

        // Usa a altura da malha renderizada para a arvore apoiar no relevo visivel.
        const groundHeight = this.terrain.getRenderedHeightAt
          ? this.terrain.getRenderedHeightAt(x, z)
          : this.terrain.getHeightAt(x, z);
        // fallbackHeight indica chunk ainda nao carregado; evita arvores flutuando.
        if (groundHeight === fallbackHeight || groundHeight > maxForestHeight) continue;

        const scale = 0.75 + hashCell(cellX, cellZ, 3) * 0.75;
        this.dummy.position.set(x, groundHeight, z);
        this.dummy.scale.set(scale, scale * (0.85 + hashCell(cellX, cellZ, 4) * 0.4), scale);
        this.dummy.rotation.y = hashCell(cellX, cellZ, 5) * Math.PI * 2;
        this.dummy.updateMatrix();
        this.canopyMesh.setMatrixAt(count, this.dummy.matrix);
        this.trunkMesh.setMatrixAt(count, this.dummy.matrix);
        this.canopyMesh.setColorAt(count, treeColors[Math.floor(hashCell(cellX, cellZ, 6) * treeColors.length)]);
        count += 1;
      }
    }

    for (const mesh of [this.canopyMesh, this.trunkMesh]) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
}

function createInstancedPart(geometry, material) {
  const mesh = new THREE.InstancedMesh(geometry, material, VEGETATION_CONFIG.maxInstances);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = 0;
  return mesh;
}

function hashCell(x, z, salt) {
  const value = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}
