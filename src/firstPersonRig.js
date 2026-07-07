import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Rig exclusivo da visao do piloto: parte frontal da selete (casulo/cockpit),
// bracos com luvas e batoques. So fica visivel no modo primeira pessoa; o
// boneco de terceira pessoa e ocultado enquanto isso.
//
// Sistema de coordenadas: local do grupo do jogador (frente = -Z), com a
// camera presa em (0, 0.72, 0.1). Tudo aqui foi posicionado em relacao a ela.
const ARM_CONFIG = {
  shoulderOffset: new THREE.Vector3(0.26, 0.42, 0.08),
  upperArmLength: 0.2,
  forearmLength: 0.2,
  upperArmRadius: 0.05,
  forearmRadius: 0.042,
  // Maos em cima, junto aos tirantes (batoque solto), e recuadas em direcao
  // ao piloto quando o freio e acionado. Isso comunica puxada do batoque sem
  // transformar o comando em uma descida vertical do braco.
  // Alvo e o PUNHO: a palma/dedos do modelo skinned se estendem ~0.11 alem,
  // rumo a roldana, entao o punho fica mais baixo que a mao visivel.
  restHandTarget: new THREE.Vector3(0.27, 0.66, -0.2),
  pulledHandTarget: new THREE.Vector3(0.24, 0.58, -0.06),
  // Roldana do freio no topo do tirante traseiro: origem da linha do batoque.
  brakePulley: new THREE.Vector3(0.38, 1.85, -0.12),
  karabiner: new THREE.Vector3(0.26, 0.46, 0.04),
  elbowPole: new THREE.Vector3(1, -0.55, 0.2),
  pullResponse: 12,
  flarePull: 0.85
};

const SKINNED_ARM_BIND_LENGTH = 0.67;
const SKINNED_ARM_SCALE = (
  ARM_CONFIG.upperArmLength + ARM_CONFIG.forearmLength
) / SKINNED_ARM_BIND_LENGTH;

const GRIP_CONFIG = {
  // Batoque dentro do grip, no espaco LOCAL DA MAO cartoon (antes do pitch),
  // definido para a MAO DIREITA (x espelhado por lado). O x/z compensa o
  // recentramento da origem pelo cuff no gerador das maos.
  toggleOffset: new THREE.Vector3(0.022, 0.09, -0.061),
  // Correcao de pitch da mao no punho: o STL vem com a mao "estendida para
  // tras"; este giro em X realinha o punho cerrado com o eixo do antebraco,
  // mantendo uma leve inclinacao para cima para a pegada parecer natural.
  handPitch: -0.12,
  // Giro da mao "para dentro" em torno do eixo do antebraco (por lado:
  // positivo vira os nos dos dedos rumo ao centro do corpo).
  handTwist: 0.785,
  // Recuo para o cuff da mao envolver o coto da manga (sem emenda).
  handSink: -0.036
};

const WRIST_SOCKET_CONFIG = {
  radius: 0.044,
  length: 0.105,
  offsetY: -0.018
};

const ARMS_ASSET_URL = '/image/pilot-arms.glb';
const HANDS_ASSET_URL = '/image/pilot-hands.glb';
// Topo do batoque no espaco da mao do fallback low-poly (escala 0.85).
const FALLBACK_BAR_OFFSET = new THREE.Vector3(0, -0.095, 0);

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);

let armsTemplatePromise = null;
let armsAssetUnavailable = false;

export function createFirstPersonRig() {
  const group = new THREE.Group();
  group.name = 'FirstPersonRig';
  group.visible = false;

  const materials = createMaterials();
  group.add(createHarnessFront(materials));

  const arms = [-1, 1].map((side) => createArm(side, materials, group));
  group.userData = { arms, time: 0 };

  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });

  loadSkinnedArms(group, materials);

  return group;
}

// Troca as capsulas low-poly pelos bracos skinned + maos cartoon dos GLBs
// assim que carregarem; sem rede (ou sem os assets), o fallback procedural
// continua. Bracos e maos sao tratados como uma unidade: se qualquer um
// falhar, nada e trocado (braco sem mao ficaria decepado).
function loadSkinnedArms(rigGroup, materials) {
  if (armsAssetUnavailable) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  if (!armsTemplatePromise) {
    const loader = new GLTFLoader();
    armsTemplatePromise = Promise.all([
      loader.loadAsync(ARMS_ASSET_URL),
      loader.loadAsync(HANDS_ASSET_URL)
    ]);
  }

  armsTemplatePromise
    .then(([armsGltf, handsGltf]) => {
      for (const arm of rigGroup.userData.arms) {
        attachSkinnedArm(arm, armsGltf.scene, handsGltf.scene, rigGroup, materials);
      }
    })
    .catch((error) => {
      if (!armsAssetUnavailable) {
        armsAssetUnavailable = true;
        console.warn(`Nao foi possivel carregar bracos/maos GLB; usando bracos procedurais: ${ARMS_ASSET_URL} + ${HANDS_ASSET_URL}`, error);
      }
    });
}

function attachSkinnedArm(arm, armsScene, handsScene, rigGroup, materials) {
  const prefix = arm.side < 0 ? 'L' : 'R';
  const template = armsScene.getObjectByName(`ArmRig_${prefix}`);
  const handTemplate = handsScene.getObjectByName(`Hand_${prefix}`);
  if (!template || !handTemplate) return;

  const container = SkeletonUtils.clone(template);
  container.position.copy(arm.shoulder);
  container.scale.setScalar(SKINNED_ARM_SCALE);
  container.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    // Bounding box da pose de bind nao acompanha os ossos; sem isso o mesh
    // some quando a caixa sai do frustum.
    child.frustumCulled = false;
  });
  rigGroup.add(container);

  // Mao cartoon rigida presa ao osso do punho (origem dela = junta do punho).
  const wristBone = container.getObjectByName(`${prefix}_Wrist`);
  if (!wristBone) return;

  const wristSocket = new THREE.Mesh(
    new THREE.CylinderGeometry(
      WRIST_SOCKET_CONFIG.radius * 0.92,
      WRIST_SOCKET_CONFIG.radius,
      WRIST_SOCKET_CONFIG.length,
      12
    ),
    materials.glove
  );
  wristSocket.name = `${prefix}_WristSocket`;
  wristSocket.position.y = WRIST_SOCKET_CONFIG.offsetY;
  wristSocket.castShadow = true;
  wristBone.add(wristSocket);

  const hand = handTemplate.clone();
  hand.castShadow = true;
  hand.frustumCulled = false;
  hand.scale.setScalar(1 / SKINNED_ARM_SCALE);
  // Ordem YXZ: primeiro o pitch (corrige a pose do STL), depois o twist
  // "para dentro" em torno do eixo do antebraco (Y local do punho).
  const twist = arm.side * GRIP_CONFIG.handTwist;
  hand.position.y = GRIP_CONFIG.handSink / SKINNED_ARM_SCALE;
  hand.rotation.set(GRIP_CONFIG.handPitch, twist, 0, 'YXZ');
  wristBone.add(hand);

  // Batoque proprio do modo skinned (o do fallback vive dentro da mao antiga).
  const toggle = new THREE.Group();
  // Barra longa o bastante para aparecer nas laterais do punho cartoon.
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.17, 10), materials.toggle);
  bar.rotation.z = Math.PI / 2;
  bar.castShadow = true;
  toggle.add(bar);
  rigGroup.add(toggle);

  arm.skinned = {
    container,
    shoulderBone: container.getObjectByName(`${prefix}_Shoulder`),
    elbowBone: container.getObjectByName(`${prefix}_Elbow`),
    wristBone,
    toggle,
    // Batoque acompanha o pitch/twist/recuo da mao no espaco do punho.
    toggleTwist: new THREE.Quaternion().setFromAxisAngle(UP, twist),
    barOffset: new THREE.Vector3(
      arm.side * GRIP_CONFIG.toggleOffset.x,
      GRIP_CONFIG.toggleOffset.y,
      GRIP_CONFIG.toggleOffset.z
    )
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), GRIP_CONFIG.handPitch)
      .applyAxisAngle(UP, twist)
      .add(new THREE.Vector3(0, GRIP_CONFIG.handSink, 0))
  };

  // Esconde o fallback low-poly deste braco.
  for (const mesh of [arm.upper, arm.fore, arm.shoulderBall, arm.elbowBall, arm.hand]) {
    mesh.visible = false;
  }
}

export function updateFirstPersonRig(rig, input, delta) {
  const data = rig.userData;
  if (!data?.arms) return;
  data.time += delta;

  // Freio simetrico (S) puxa os dois batoques; curva puxa so o lado dela.
  const flarePull = Math.max(Number(input.backward) || 0, Number(input.descend) || 0) * ARM_CONFIG.flarePull;
  const pullAlpha = 1 - Math.exp(-delta * ARM_CONFIG.pullResponse);

  for (const arm of data.arms) {
    const turnPull = Math.max(0, Number(arm.side < 0 ? input.left : input.right) || 0);
    const targetPull = Math.max(turnPull, flarePull);
    arm.pull += (targetPull - arm.pull) * pullAlpha;
    solveArm(arm, data.time);
  }
}

function createMaterials() {
  return {
    pod: new THREE.MeshStandardMaterial({ color: 0x1f2933, roughness: 0.72 }),
    suit: new THREE.MeshStandardMaterial({ color: 0x2a3440, roughness: 0.8 }),
    strap: new THREE.MeshStandardMaterial({ color: 0x161e28, roughness: 0.85 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.92 }),
    gloveTrim: new THREE.MeshStandardMaterial({ color: 0xb3372c, roughness: 0.7 }),
    toggle: new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.82 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.35, metalness: 0.7 }),
    screen: new THREE.MeshStandardMaterial({
      color: 0x0c1410,
      roughness: 0.3,
      emissive: 0x2f6b45,
      emissiveIntensity: 0.55
    })
  };
}

// Parte da selete que aparece ao olhar para baixo: peito, casulo com as
// pernas dentro, deck de cockpit com instrumento e tirantes subindo.
function createHarnessFront(materials) {
  const group = new THREE.Group();
  group.name = 'HarnessFront';

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.2), materials.suit);
  chest.position.set(0, 0.34, 0.06);
  group.add(chest);

  const chestStrap = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.055, 0.03), materials.strap);
  chestStrap.position.set(0, 0.42, -0.05);
  group.add(chestStrap);

  const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 6, 12), materials.pod);
  pod.scale.set(0.85, 1, 0.75);
  pod.rotation.x = -(Math.PI / 2 - 0.22);
  pod.position.set(0, 0.02, -0.85);
  group.add(pod);

  const thighGeometry = new THREE.CapsuleGeometry(0.1, 0.35, 5, 8);
  for (const side of [-1, 1]) {
    const thigh = new THREE.Mesh(thighGeometry, materials.suit);
    thigh.rotation.x = -(Math.PI / 2 - 0.35);
    thigh.position.set(side * 0.11, 0.14, -0.45);
    group.add(thigh);
  }

  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.045, 0.42), materials.pod);
  deck.rotation.x = 0.35;
  deck.position.set(0, 0.27, -0.68);
  group.add(deck);

  const instrument = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.15), materials.strap);
  instrument.rotation.x = 0.35;
  instrument.position.set(0, 0.31, -0.6);
  group.add(instrument);

  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.1), materials.screen);
  screen.rotation.x = 0.35;
  screen.position.set(0, 0.332, -0.596);
  group.add(screen);

  const karabinerGeometry = new THREE.TorusGeometry(0.035, 0.009, 8, 14);
  for (const side of [-1, 1]) {
    const karabiner = new THREE.Mesh(karabinerGeometry, materials.metal);
    karabiner.rotation.y = Math.PI / 2;
    karabiner.position.set(
      side * ARM_CONFIG.karabiner.x,
      ARM_CONFIG.karabiner.y,
      ARM_CONFIG.karabiner.z
    );
    group.add(karabiner);

    const anchor = new THREE.Vector3(
      side * ARM_CONFIG.karabiner.x,
      ARM_CONFIG.karabiner.y + 0.03,
      ARM_CONFIG.karabiner.z
    );
    group.add(createRiserStrap(anchor, new THREE.Vector3(side * 0.36, 2.1, -0.3), materials.strap));
    group.add(createRiserStrap(anchor, new THREE.Vector3(side * 0.42, 2.05, 0.1), materials.strap));

    const pulley = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.006, 6, 10), materials.metal);
    pulley.position.set(
      side * ARM_CONFIG.brakePulley.x,
      ARM_CONFIG.brakePulley.y,
      ARM_CONFIG.brakePulley.z
    );
    group.add(pulley);
  }

  return group;
}

function createRiserStrap(from, to, material) {
  const length = from.distanceTo(to);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.045, length, 0.012), material);
  placeAlongSegment(strap, from, to);
  return strap;
}

function createArm(side, materials, rigGroup) {
  const upperCapsule = new THREE.CapsuleGeometry(
    ARM_CONFIG.upperArmRadius,
    ARM_CONFIG.upperArmLength - ARM_CONFIG.upperArmRadius * 2,
    5,
    10
  );
  const foreCapsule = new THREE.CapsuleGeometry(
    ARM_CONFIG.forearmRadius,
    ARM_CONFIG.forearmLength - ARM_CONFIG.forearmRadius * 2,
    5,
    10
  );

  const upper = new THREE.Mesh(upperCapsule, materials.suit);
  const fore = new THREE.Mesh(foreCapsule, materials.suit);
  const shoulderBall = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), materials.suit);
  const elbowBall = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), materials.suit);

  const shoulder = new THREE.Vector3(
    side * ARM_CONFIG.shoulderOffset.x,
    ARM_CONFIG.shoulderOffset.y,
    ARM_CONFIG.shoulderOffset.z
  );
  shoulderBall.position.copy(shoulder);

  const hand = createGlovedHand(side, materials);

  // Linha do freio: da roldana no tirante ate o topo do batoque na mao.
  const brakePositions = new THREE.BufferAttribute(new Float32Array(6), 3);
  const brakeGeometry = new THREE.BufferGeometry();
  brakeGeometry.setAttribute('position', brakePositions);
  const brakeLine = new THREE.Line(
    brakeGeometry,
    new THREE.LineBasicMaterial({ color: 0xd8342a, transparent: true, opacity: 0.9 })
  );
  brakeLine.frustumCulled = false;

  rigGroup.add(upper, fore, shoulderBall, elbowBall, hand, brakeLine);

  return {
    side,
    shoulder,
    pulley: new THREE.Vector3(
      side * ARM_CONFIG.brakePulley.x,
      ARM_CONFIG.brakePulley.y,
      ARM_CONFIG.brakePulley.z
    ),
    upper,
    fore,
    shoulderBall,
    elbowBall,
    hand,
    brakePositions,
    skinned: null,
    pull: 0
  };
}

// Mao enluvada agarrando o batoque: punho na origem, batoque (barra no eixo X)
// logo abaixo, dedos como arcos de torus fechados em volta da barra.
function createGlovedHand(side, materials) {
  const hand = new THREE.Group();
  hand.name = side < 0 ? 'LeftHand' : 'RightHand';
  // Perto da camera a mao em escala 1 parece gigante; reduz um pouco.
  hand.scale.setScalar(0.85);

  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.058, 0.07, 10), materials.glove);
  cuff.position.y = -0.005;
  hand.add(cuff);

  const cuffTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.059, 0.06, 0.02, 10), materials.gloveTrim);
  cuffTrim.position.y = -0.032;
  hand.add(cuffTrim);

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.075, 0.06), materials.glove);
  palm.position.set(0, -0.055, 0.004);
  hand.add(palm);

  const knucklePad = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.05, 0.016), materials.gloveTrim);
  knucklePad.position.set(0, -0.06, -0.036);
  hand.add(knucklePad);

  const toggle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.13, 10), materials.toggle);
  toggle.rotation.z = Math.PI / 2;
  toggle.position.y = -0.115;
  hand.add(toggle);

  // Dedos: quatro arcos envolvendo a barra do batoque, com folga virada
  // para a palma (em cima).
  const fingerGeometry = new THREE.TorusGeometry(0.032, 0.0115, 7, 12, 4.6);
  fingerGeometry.rotateY(Math.PI / 2);
  for (const offset of [-0.039, -0.013, 0.013, 0.039]) {
    const finger = new THREE.Mesh(fingerGeometry, materials.glove);
    finger.position.set(offset, -0.115, 0);
    finger.rotation.x = 2.4;
    hand.add(finger);
  }

  // Polegar do lado de dentro (voltado para o corpo), fechando por baixo.
  const thumbGeometry = new THREE.TorusGeometry(0.028, 0.011, 7, 10, 3.6);
  thumbGeometry.rotateY(Math.PI / 2);
  const thumb = new THREE.Mesh(thumbGeometry, materials.glove);
  thumb.position.set(-side * 0.062, -0.108, 0.008);
  thumb.rotation.x = -0.9;
  hand.add(thumb);

  return hand;
}

const scratchHand = new THREE.Vector3();
const scratchAxis = new THREE.Vector3();
const scratchPole = new THREE.Vector3();
const scratchElbow = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
const scratchBarTop = new THREE.Vector3();
const scratchMid = new THREE.Vector3();
const scratchX = new THREE.Vector3();
const scratchZ = new THREE.Vector3();
const scratchBasis = new THREE.Matrix4();
const scratchHandQuat = new THREE.Quaternion();
const scratchBoneQuat = new THREE.Quaternion();
const scratchInverseQuat = new THREE.Quaternion();

// IK analitico de dois ossos: dado ombro e alvo da mao, acha o cotovelo no
// plano definido pelo polo (para fora/abaixo do corpo) e posiciona as capsulas.
function solveArm(arm, time) {
  const upperLength = ARM_CONFIG.upperArmLength;
  const forearmLength = ARM_CONFIG.forearmLength;

  // Alvo do punho interpola entre repouso e batoque puxado, com um leve
  // balanco respiratorio para os bracos nao parecerem congelados.
  const sway = arm.side * Math.sin(time * 1.5 + arm.side) * 0.008;
  scratchHand.set(
    arm.side * THREE.MathUtils.lerp(ARM_CONFIG.restHandTarget.x, ARM_CONFIG.pulledHandTarget.x, arm.pull),
    THREE.MathUtils.lerp(ARM_CONFIG.restHandTarget.y, ARM_CONFIG.pulledHandTarget.y, arm.pull)
      + Math.sin(time * 1.7 + arm.side * 2.1) * 0.01,
    THREE.MathUtils.lerp(ARM_CONFIG.restHandTarget.z, ARM_CONFIG.pulledHandTarget.z, arm.pull) + sway
  );

  scratchAxis.copy(scratchHand).sub(arm.shoulder);
  let reach = scratchAxis.length();
  const maxReach = upperLength + forearmLength - 0.015;
  if (reach > maxReach) {
    scratchAxis.multiplyScalar(maxReach / reach);
    scratchHand.copy(arm.shoulder).add(scratchAxis);
    reach = maxReach;
  }
  scratchAxis.divideScalar(reach);

  const alongAxis = (upperLength * upperLength - forearmLength * forearmLength + reach * reach) / (2 * reach);
  const bendRadius = Math.sqrt(Math.max(upperLength * upperLength - alongAxis * alongAxis, 0.0001));

  scratchPole.set(arm.side * ARM_CONFIG.elbowPole.x, ARM_CONFIG.elbowPole.y, ARM_CONFIG.elbowPole.z);
  scratchPole.addScaledVector(scratchAxis, -scratchPole.dot(scratchAxis)).normalize();
  scratchElbow.copy(arm.shoulder).addScaledVector(scratchAxis, alongAxis).addScaledVector(scratchPole, bendRadius);

  // Mao alinhada ao antebraco (punho reto, sem dobrar rumo a roldana): eixo Y
  // continua a direcao cotovelo->punho; X fica horizontal (eixo do batoque)
  // e o fechamento dos dedos acontece para -Z (para frente).
  scratchDir.copy(scratchHand).sub(scratchElbow).normalize();
  scratchX.crossVectors(FORWARD, scratchDir).normalize();
  scratchZ.crossVectors(scratchX, scratchDir);
  scratchBasis.makeBasis(scratchX, scratchDir, scratchZ);
  scratchHandQuat.setFromRotationMatrix(scratchBasis);

  if (arm.skinned) {
    driveSkinnedArm(arm, scratchElbow, scratchHand, scratchHandQuat);
  } else {
    placeAlongSegment(arm.upper, arm.shoulder, scratchElbow);
    placeAlongSegment(arm.fore, scratchElbow, scratchHand);
    arm.elbowBall.position.copy(scratchElbow);
    arm.hand.position.copy(scratchHand);
    arm.hand.quaternion.copy(scratchHandQuat);
  }

  const barTopOffset = arm.skinned ? arm.skinned.barOffset : FALLBACK_BAR_OFFSET;
  scratchBarTop.copy(barTopOffset).applyQuaternion(scratchHandQuat).add(scratchHand);
  if (arm.skinned) {
    arm.skinned.toggle.position.copy(scratchBarTop);
    arm.skinned.toggle.quaternion.copy(scratchHandQuat).multiply(arm.skinned.toggleTwist);
  }
  arm.brakePositions.setXYZ(0, arm.pulley.x, arm.pulley.y, arm.pulley.z);
  arm.brakePositions.setXYZ(1, scratchBarTop.x, scratchBarTop.y, scratchBarTop.z);
  arm.brakePositions.needsUpdate = true;
}

// FK dos ossos a partir da solucao do IK: ombro aponta para o cotovelo,
// cotovelo para o punho e o punho assume a orientacao da mao (que carrega a
// mao cartoon rigida com o grip ja fechado no batoque).
function driveSkinnedArm(arm, elbow, hand, handQuat) {
  const { shoulderBone, elbowBone, wristBone } = arm.skinned;

  scratchDir.copy(elbow).sub(arm.shoulder).normalize();
  shoulderBone.quaternion.setFromUnitVectors(UP, scratchDir);

  scratchDir.copy(hand).sub(elbow).normalize();
  scratchBoneQuat.setFromUnitVectors(UP, scratchDir);
  scratchInverseQuat.copy(shoulderBone.quaternion).invert();
  elbowBone.quaternion.copy(scratchInverseQuat).multiply(scratchBoneQuat);

  scratchInverseQuat.copy(scratchBoneQuat).invert();
  wristBone.quaternion.copy(scratchInverseQuat).multiply(handQuat);
}

// Centraliza um mesh alongado no eixo Y entre dois pontos e o orienta.
function placeAlongSegment(mesh, from, to) {
  scratchMid.copy(from).add(to).multiplyScalar(0.5);
  mesh.position.copy(scratchMid);
  scratchDir.copy(to).sub(from).normalize();
  mesh.quaternion.setFromUnitVectors(UP, scratchDir);
}
