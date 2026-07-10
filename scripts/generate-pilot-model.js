// Gera image/pilot-pod.glb a partir de image/piloto.glb (piloto com selete,
// conectores e batoques, gerado no Tripo3D): decima a malha de ~1,5M para
// dezenas de milhares de triangulos via clustering de vertices, preservando
// as UVs (cada cluster herda a UV de um vertice representante) e reembalando
// a textura JPEG original. Rodar com:
//   node scripts/generate-pilot-model.js
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';

const SOURCE_GLB = path.join(process.cwd(), 'image', 'piloto.glb');
const OUTPUT_GLB = path.join(process.cwd(), 'image', 'pilot-pod.glb');

const CONFIG = {
  // Celula do clustering em unidades do modelo (o piloto tem ~1.0 de
  // comprimento). Menor = mais detalhe e mais triangulos.
  clusterCell: 0.012
};

// --- Leitura do GLB de origem -------------------------------------------

const glb = fs.readFileSync(SOURCE_GLB);
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('pilot.glb nao e um GLB valido');
const jsonLength = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
const binStart = 20 + jsonLength + 8;
const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLength));

function readAccessor(index, ArrayType, components) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return new ArrayType(
    bin.buffer,
    bin.byteOffset + offset,
    accessor.count * components
  );
}

const primitive = json.meshes[0].primitives[0];
const indices = readAccessor(primitive.indices, Uint32Array, 1);
const positions = readAccessor(primitive.attributes.POSITION, Float32Array, 3);
const uvs = readAccessor(primitive.attributes.TEXCOORD_0, Float32Array, 2);
const imageView = json.bufferViews[json.images[0].bufferView];
const imageBytes = bin.subarray(imageView.byteOffset, imageView.byteOffset + imageView.byteLength);
console.log(`Origem: ${positions.length / 3} vertices, ${indices.length / 3} triangulos`);

// --- Decimacao por clustering ---------------------------------------------

const cell = CONFIG.clusterCell;
const clusterOfVertex = new Int32Array(positions.length / 3).fill(-1);
const clusterByKey = new Map();
// Por cluster: soma de posicoes (para centroide) e UV do representante.
const clusterData = [];

for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
  const x = positions[vertex * 3];
  const y = positions[vertex * 3 + 1];
  const z = positions[vertex * 3 + 2];
  const key = `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;

  let cluster = clusterByKey.get(key);
  if (cluster === undefined) {
    cluster = clusterData.length;
    clusterByKey.set(key, cluster);
    clusterData.push({
      x: 0, y: 0, z: 0, count: 0,
      u: uvs[vertex * 2],
      v: uvs[vertex * 2 + 1]
    });
  }
  const data = clusterData[cluster];
  data.x += x;
  data.y += y;
  data.z += z;
  data.count += 1;
  clusterOfVertex[vertex] = cluster;
}

const newPositions = new Float32Array(clusterData.length * 3);
const newUvs = new Float32Array(clusterData.length * 2);
for (let cluster = 0; cluster < clusterData.length; cluster += 1) {
  const data = clusterData[cluster];
  newPositions[cluster * 3] = data.x / data.count;
  newPositions[cluster * 3 + 1] = data.y / data.count;
  newPositions[cluster * 3 + 2] = data.z / data.count;
  newUvs[cluster * 2] = data.u;
  newUvs[cluster * 2 + 1] = data.v;
}

// Triangulos remapeados, sem degenerados nem duplicados.
const seenTriangles = new Set();
const newIndices = [];
for (let triangle = 0; triangle < indices.length; triangle += 3) {
  const a = clusterOfVertex[indices[triangle]];
  const b = clusterOfVertex[indices[triangle + 1]];
  const c = clusterOfVertex[indices[triangle + 2]];
  if (a === b || b === c || a === c) continue;

  // Chave independente da rotacao ciclica, preservando a orientacao.
  const low = Math.min(a, b, c);
  const key = low === a ? `${a},${b},${c}` : low === b ? `${b},${c},${a}` : `${c},${a},${b}`;
  if (seenTriangles.has(key)) continue;
  seenTriangles.add(key);
  newIndices.push(a, b, c);
}
console.log(`Decimado: ${clusterData.length} vertices, ${newIndices.length / 3} triangulos`);

// Normais suaves recalculadas sobre a malha decimada.
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
geometry.setIndex(newIndices);
geometry.computeVertexNormals();
const newNormals = geometry.getAttribute('normal').array;

// --- Escrita do GLB de saida -----------------------------------------------

function align4(length) {
  return (length + 3) & ~3;
}

const indexArray = new Uint32Array(newIndices);
const chunks = [
  Buffer.from(indexArray.buffer),
  Buffer.from(newPositions.buffer),
  Buffer.from(newNormals.buffer, newNormals.byteOffset, newNormals.byteLength),
  Buffer.from(newUvs.buffer),
  Buffer.from(imageBytes)
];

const bufferViews = [];
let cursor = 0;
for (const chunk of chunks) {
  bufferViews.push({ buffer: 0, byteOffset: cursor, byteLength: chunk.length });
  cursor = align4(cursor + chunk.length);
}

const positionBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let vertex = 0; vertex < newPositions.length; vertex += 3) {
  for (let axis = 0; axis < 3; axis += 1) {
    positionBounds.min[axis] = Math.min(positionBounds.min[axis], newPositions[vertex + axis]);
    positionBounds.max[axis] = Math.max(positionBounds.max[axis], newPositions[vertex + axis]);
  }
}

const outputJson = {
  asset: { version: '2.0', generator: 'jogo-parapente generate-pilot-model' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'PilotPod', mesh: 0 }],
  meshes: [{
    name: 'PilotPod',
    primitives: [{
      attributes: { POSITION: 1, NORMAL: 2, TEXCOORD_0: 3 },
      indices: 0,
      material: 0
    }]
  }],
  materials: [{
    name: 'PilotPod',
    pbrMetallicRoughness: {
      baseColorTexture: { index: 0 },
      metallicFactor: 0,
      roughnessFactor: 0.9
    }
  }],
  textures: [{ source: 0, sampler: 0 }],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  images: [{ mimeType: 'image/jpeg', bufferView: 4 }],
  accessors: [
    { bufferView: 0, componentType: 5125, count: indexArray.length, type: 'SCALAR' },
    {
      bufferView: 1, componentType: 5126, count: newPositions.length / 3, type: 'VEC3',
      min: positionBounds.min, max: positionBounds.max
    },
    { bufferView: 2, componentType: 5126, count: newNormals.length / 3, type: 'VEC3' },
    { bufferView: 3, componentType: 5126, count: newUvs.length / 2, type: 'VEC2' }
  ],
  bufferViews,
  buffers: [{ byteLength: cursor }]
};

const binBody = Buffer.alloc(cursor);
for (let index = 0; index < chunks.length; index += 1) {
  chunks[index].copy(binBody, bufferViews[index].byteOffset);
}

let jsonBody = Buffer.from(JSON.stringify(outputJson));
if (jsonBody.length % 4) jsonBody = Buffer.concat([jsonBody, Buffer.alloc(4 - (jsonBody.length % 4), 0x20)]);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBody.length + 8 + binBody.length, 8);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonBody.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);

const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binBody.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);

fs.writeFileSync(OUTPUT_GLB, Buffer.concat([header, jsonHeader, jsonBody, binHeader, binBody]));
console.log(`Gerado ${OUTPUT_GLB} (${(fs.statSync(OUTPUT_GLB).size / 1024).toFixed(1)} KiB)`);
