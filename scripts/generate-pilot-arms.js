// Gera image/pilot-arms.glb: bracos do piloto (manga + luva ate o punho) em
// malha unica com skinning, para a visao em primeira pessoa. As maos vem de
// um GLB separado (pilot-hands.glb, mao cartoon rigida presa ao osso do
// punho). Rodar com:
//   node scripts/generate-pilot-arms.js
//
// Pose de bind: braco esticado ao longo de +Y a partir do ombro (origem de
// cada braco), cotovelo em y=0.33, punho em y=0.67. Ossos por braco:
// Shoulder -> Elbow -> Wrist. O jogo dobra cotovelo/punho via IK.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const ARM = {
  upperLength: 0.33,
  forearmLength: 0.34,
  radialSegments: 14
};
const WRIST_Y = ARM.upperLength + ARM.forearmLength;

const COLORS = {
  suit: new THREE.Color(0x2a3440),
  trim: new THREE.Color(0xb3372c),
  glove: new THREE.Color(0x171c24)
};

const scene = new THREE.Scene();
scene.name = 'PilotArms';
scene.add(buildArm(1));
scene.add(buildArm(-1));
scene.updateMatrixWorld(true);

const exporter = new GLTFExporter();
installFileReaderPolyfill();
exporter.parse(
  scene,
  (result) => {
    const outputPath = path.join(process.cwd(), 'image', 'pilot-arms.glb');
    fs.writeFileSync(outputPath, Buffer.from(result));
    console.log(`Gerado ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(1)} KiB)`);
  },
  (error) => {
    console.error('Falha ao exportar GLB', error);
    process.exitCode = 1;
  },
  { binary: true }
);

function buildArm(side) {
  const prefix = side > 0 ? 'R' : 'L';
  const bones = [];
  const boneIndexByName = new Map();

  const addBone = (name, parent, position, quaternion = null) => {
    const bone = new THREE.Bone();
    bone.name = `${prefix}_${name}`;
    bone.position.copy(position);
    if (quaternion) bone.quaternion.copy(quaternion);
    if (parent) parent.add(bone);
    boneIndexByName.set(name, bones.length);
    bones.push(bone);
    return bone;
  };

  const shoulder = addBone('Shoulder', null, new THREE.Vector3(0, 0, 0));
  const elbow = addBone('Elbow', shoulder, new THREE.Vector3(0, ARM.upperLength, 0));
  const wrist = addBone('Wrist', elbow, new THREE.Vector3(0, ARM.forearmLength, 0));

  const builder = { positions: [], colors: [], skinIndices: [], skinWeights: [], indices: [] };
  const skinAt = makeArmSkinFunction(boneIndexByName);

  buildArmTube(builder, side, skinAt);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(builder.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(builder.colors, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(builder.skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(builder.skinWeights, 4));
  geometry.setIndex(builder.indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = `Arm_${prefix}`;

  const rig = new THREE.Group();
  rig.name = `ArmRig_${prefix}`;
  rig.add(mesh);
  mesh.add(shoulder);
  rig.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  return rig;
}

// Pesos ao longo do braco: mistura suave nas juntas para o cotovelo e o punho
// dobrarem sem vinco. Retorna [[indiceOsso, peso], [indiceOsso, peso]].
function makeArmSkinFunction(boneIndexByName) {
  const shoulderIndex = boneIndexByName.get('Shoulder');
  const elbowIndex = boneIndexByName.get('Elbow');
  const wristIndex = boneIndexByName.get('Wrist');

  return (y) => {
    if (y < ARM.upperLength - 0.05) return [[shoulderIndex, 1], [elbowIndex, 0]];
    if (y < ARM.upperLength + 0.05) {
      const t = smoothstep((y - (ARM.upperLength - 0.05)) / 0.1);
      return [[shoulderIndex, 1 - t], [elbowIndex, t]];
    }
    if (y < WRIST_Y - 0.04) return [[elbowIndex, 1], [wristIndex, 0]];
    if (y < WRIST_Y + 0.02) {
      const t = smoothstep((y - (WRIST_Y - 0.04)) / 0.06);
      return [[elbowIndex, 1 - t], [wristIndex, t]];
    }
    return [[wristIndex, 1], [elbowIndex, 0]];
  };
}

// Tubo continuo do ombro ate o punho: manga do macacao e inicio da luva com
// friso vermelho. A mao (GLB separado) cobre o coto alem do punho.
function buildArmTube(builder, side, skinAt) {
  const rings = [
    { y: 0, rx: 0.06, rz: 0.058, color: COLORS.suit },
    { y: 0.12, rx: 0.056, rz: 0.054, color: COLORS.suit },
    { y: 0.27, rx: 0.051, rz: 0.05, color: COLORS.suit },
    { y: ARM.upperLength, rx: 0.05, rz: 0.049, color: COLORS.suit },
    { y: 0.4, rx: 0.049, rz: 0.048, color: COLORS.suit },
    { y: 0.52, rx: 0.047, rz: 0.046, color: COLORS.suit },
    { y: 0.612, rx: 0.044, rz: 0.043, color: COLORS.suit },
    { y: 0.616, rx: 0.047, rz: 0.046, color: COLORS.trim },
    { y: 0.638, rx: 0.047, rz: 0.046, color: COLORS.trim },
    { y: 0.642, rx: 0.04, rz: 0.038, color: COLORS.glove },
    // Coto avanca alem do punho para dentro do cuff da mao cartoon,
    // fechando a emenda quando o punho gira.
    { y: WRIST_Y, rx: 0.038, rz: 0.036, color: COLORS.glove },
    { y: WRIST_Y + 0.02, rx: 0.034, rz: 0.032, color: COLORS.glove }
  ];

  let previousRing = null;
  for (const ring of rings) {
    const ringStart = addRing(builder, {
      center: new THREE.Vector3(0, ring.y, 0),
      axisU: new THREE.Vector3(side * ring.rx, 0, 0),
      axisV: new THREE.Vector3(0, 0, ring.rz),
      segments: ARM.radialSegments,
      color: ring.color,
      skin: skinAt(ring.y)
    });
    if (previousRing !== null) stitchRings(builder, previousRing, ringStart, ARM.radialSegments);
    previousRing = ringStart;
  }

  capRing(builder, previousRing, ARM.radialSegments, {
    center: new THREE.Vector3(0, WRIST_Y + 0.03, 0),
    color: COLORS.glove,
    skin: skinAt(WRIST_Y + 0.03)
  });
  capRing(builder, 0, ARM.radialSegments, {
    center: new THREE.Vector3(0, -0.01, 0),
    color: COLORS.suit,
    skin: skinAt(0),
    flip: true
  });
}

function addRing(builder, { center, axisU, axisV, segments, color, skin }) {
  const start = builder.positions.length / 3;
  for (let s = 0; s < segments; s += 1) {
    const angle = (s / segments) * Math.PI * 2;
    builder.positions.push(
      center.x + Math.cos(angle) * axisU.x + Math.sin(angle) * axisV.x,
      center.y + Math.cos(angle) * axisU.y + Math.sin(angle) * axisV.y,
      center.z + Math.cos(angle) * axisU.z + Math.sin(angle) * axisV.z
    );
    pushVertexAttributes(builder, color, skin);
  }
  return start;
}

function stitchRings(builder, ringA, ringB, segments) {
  for (let s = 0; s < segments; s += 1) {
    const next = (s + 1) % segments;
    builder.indices.push(ringA + s, ringB + s, ringA + next);
    builder.indices.push(ringA + next, ringB + s, ringB + next);
  }
}

function capRing(builder, ring, segments, { center, color, skin, flip = false }) {
  const centerIndex = builder.positions.length / 3;
  builder.positions.push(center.x, center.y, center.z);
  pushVertexAttributes(builder, color, skin);
  for (let s = 0; s < segments; s += 1) {
    const next = (s + 1) % segments;
    if (flip) builder.indices.push(centerIndex, ring + next, ring + s);
    else builder.indices.push(centerIndex, ring + s, ring + next);
  }
}

function pushVertexAttributes(builder, color, skin) {
  builder.colors.push(color.r, color.g, color.b);
  const [[boneA, weightA], [boneB, weightB]] = skin;
  const total = weightA + weightB || 1;
  builder.skinIndices.push(boneA, boneB, 0, 0);
  builder.skinWeights.push(weightA / total, weightB / total, 0, 0);
}

function smoothstep(t) {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
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
