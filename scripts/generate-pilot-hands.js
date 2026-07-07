// Gera image/pilot-hands.glb a partir de image/obj_9_ARM2-1.stl (mao cartoon
// em grip semifechado): solda + decima a malha, reorienta para o espaco local
// do osso do punho do rig (origem no punho, +Y rumo aos dedos, dedos fechando
// para -Z, batoque ao longo de X), pinta cores por vertice (luva + friso
// vermelho no punho) e exporta Hand_R e Hand_L (espelhada). Rodar com:
//   node scripts/generate-pilot-hands.js
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const SOURCE_STL = path.join(process.cwd(), 'image', 'obj_9_ARM2-1.stl');
const OUTPUT_GLB = path.join(process.cwd(), 'image', 'pilot-hands.glb');

const CONFIG = {
  // Celula do clustering de decimacao, em unidades do STL (mm).
  clusterCell: 1.1,
  // Comprimento alvo da mao (punho -> ponta dos dedos) em metros do jogo.
  targetLength: 0.16,
  // Raio (a partir da junta do punho) do friso vermelho no cuff da luva (m).
  // Radial em vez de altura: a mao fica diagonal no proprio espaco, entao um
  // corte por Y pintaria a palma tambem.
  trimBandRadius: 0.042,
  colors: {
    glove: new THREE.Color(0x171c24),
    trim: new THREE.Color(0xb3372c)
  },
  // Base ortonormal (em coords do STL) que vira os eixos do frame alvo.
  // Ajustada visualmente: yAxis = eixo punho->dedos, xAxis = eixo do batoque,
  // zAxis = xAxis x yAxis (lado oposto ao fechamento dos dedos).
  basis: {
    yAxis: new THREE.Vector3(0, -1, 1).normalize(),
    xSeed: new THREE.Vector3(0, -1, 0)
  }
};

const soup = parseBinaryStl(fs.readFileSync(SOURCE_STL));
console.log(`STL: ${soup.length / 9} triangulos`);

const { positions, indices } = clusterDecimate(soup, CONFIG.clusterCell);
console.log(`Decimado: ${positions.length / 3} vertices, ${indices.length / 3} triangulos`);

// O STL original e a mao ESQUERDA; a direita e o espelho.
const geometry = buildOrientedGeometry(positions, indices);
const leftHand = makeHandMesh(geometry, 'Hand_L');
const rightHand = makeHandMesh(mirrorGeometry(geometry), 'Hand_R');

const scene = new THREE.Scene();
scene.name = 'PilotHands';
scene.add(rightHand, leftHand);
scene.updateMatrixWorld(true);

installFileReaderPolyfill();
new GLTFExporter().parse(
  scene,
  (result) => {
    fs.writeFileSync(OUTPUT_GLB, Buffer.from(result));
    console.log(`Gerado ${OUTPUT_GLB} (${(fs.statSync(OUTPUT_GLB).size / 1024).toFixed(1)} KiB)`);
  },
  (error) => {
    console.error('Falha ao exportar GLB', error);
    process.exitCode = 1;
  },
  { binary: true }
);

function parseBinaryStl(buffer) {
  const triCount = buffer.readUInt32LE(80);
  const positions = new Float32Array(triCount * 9);
  for (let t = 0; t < triCount; t += 1) {
    const base = 84 + t * 50 + 12;
    for (let c = 0; c < 9; c += 1) {
      positions[t * 9 + c] = buffer.readFloatLE(base + c * 4);
    }
  }
  return positions;
}

// Decimacao por clustering: agrupa vertices em celulas de grade, cada celula
// vira um vertice (media) e triangulos degenerados sao descartados.
function clusterDecimate(soup, cell) {
  const clusterOf = new Map();
  const sums = [];
  const counts = [];

  const clusterIndex = (x, y, z) => {
    const key = `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
    let index = clusterOf.get(key);
    if (index === undefined) {
      index = sums.length / 3;
      clusterOf.set(key, index);
      sums.push(0, 0, 0);
      counts.push(0);
    }
    sums[index * 3] += x;
    sums[index * 3 + 1] += y;
    sums[index * 3 + 2] += z;
    counts[index] += 1;
    return index;
  };

  const indices = [];
  for (let t = 0; t < soup.length; t += 9) {
    const a = clusterIndex(soup[t], soup[t + 1], soup[t + 2]);
    const b = clusterIndex(soup[t + 3], soup[t + 4], soup[t + 5]);
    const c = clusterIndex(soup[t + 6], soup[t + 7], soup[t + 8]);
    if (a !== b && b !== c && a !== c) indices.push(a, b, c);
  }

  const positions = new Float32Array(sums.length);
  for (let i = 0; i < counts.length; i += 1) {
    positions[i * 3] = sums[i * 3] / counts[i];
    positions[i * 3 + 1] = sums[i * 3 + 1] / counts[i];
    positions[i * 3 + 2] = sums[i * 3 + 2] / counts[i];
  }

  return { positions, indices };
}

function buildOrientedGeometry(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
  geometry.setIndex(indices);

  // Rotaciona os eixos do STL para o frame alvo do punho.
  const yAxis = CONFIG.basis.yAxis.clone();
  const xAxis = CONFIG.basis.xSeed
    .clone()
    .addScaledVector(yAxis, -CONFIG.basis.xSeed.dot(yAxis))
    .normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
  const rotation = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).invert();
  geometry.applyMatrix4(rotation);

  // Punho (base do cuff, menor Y) na origem, centrado em X/Z, escala p/ jogo.
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const scale = CONFIG.targetLength / (bounds.max.y - bounds.min.y);
  geometry.translate(
    -(bounds.min.x + bounds.max.x) / 2,
    -bounds.min.y,
    -(bounds.min.z + bounds.max.z) / 2
  );
  geometry.scale(scale, scale, scale);

  // Recentra X/Z pelo CUFF (vertices junto a base), nao pelo bbox da mao
  // inteira: os dedos curvados para -Z puxavam o centro do bbox e deixavam o
  // punho fora do eixo do antebraco quando preso ao osso do punho.
  const cuffCenter = ringCenter(geometry, 0.025);
  geometry.translate(-cuffCenter.x, 0, -cuffCenter.z);
  geometry.computeVertexNormals();

  // Cores por vertice: luva escura com friso vermelho junto ao punho.
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    const color = vertex.length() < CONFIG.trimBandRadius
      ? CONFIG.colors.trim
      : CONFIG.colors.glove;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return geometry;
}

// Media X/Z dos vertices com y abaixo do corte (anel do cuff, ja em escala
// do jogo): centro real da abertura do punho.
function ringCenter(geometry, maxY) {
  const position = geometry.getAttribute('position');
  const center = new THREE.Vector3();
  let count = 0;
  for (let i = 0; i < position.count; i += 1) {
    if (position.getY(i) > maxY) continue;
    center.x += position.getX(i);
    center.z += position.getZ(i);
    count += 1;
  }
  if (count > 0) center.divideScalar(count);
  return center;
}

// Espelha em X e inverte o winding dos triangulos para a mao esquerda.
function mirrorGeometry(geometry) {
  const mirrored = geometry.clone();
  mirrored.scale(-1, 1, 1);
  const index = mirrored.getIndex();
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    index.setX(t, index.getX(t + 2));
    index.setX(t + 2, a);
  }
  mirrored.computeVertexNormals();
  return mirrored;
}

function makeHandMesh(geometry, name) {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })
  );
  mesh.name = name;
  return mesh;
}

// GLTFExporter usa FileReader (API de browser) para montar o .glb.
function installFileReaderPolyfill() {
  if (typeof globalThis.FileReader !== 'undefined') return;
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
        this.onload?.({ target: this });
      });
    }
  };
}
