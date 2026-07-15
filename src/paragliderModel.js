import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const DEFAULT_COLORS = {
  canopy: 0x9ed8f0,
  stripe: 0x3156b8,
  trim: 0x18222d,
  pilot: 0x1f2933,
  helmet: 0xf2c94c
};

const CANOPY_SHAPE = {
  span: 12.4,
  chord: 3.25,
  cells: 24,
  spanSegments: 72,
  chordSegments: 8
};

const ASSET_CANOPY_CONFIG = {
  targetSpan: 12.4,
  verticalOffset: 7.6,
  depthOffset: -0.15,
  pitchUpRadians: 0
};

const INITIAL_LINE_CONFIG = {
  lineTopLift: 1.62,
  edgeDropScale: 3.58
};

const BRAKE_LINE_TIP_BLEND = 0.5;

const PROCEDURAL_CANOPY_LINE_CENTER_Y = 3.66;
const PROCEDURAL_CANOPY_LOADING_Y = (
  ASSET_CANOPY_CONFIG.verticalOffset
  + INITIAL_LINE_CONFIG.lineTopLift
  - PROCEDURAL_CANOPY_LINE_CENTER_Y
);

const LANDED_POSE_CONFIG = {
  groundOffset: -0.08,
  canopyDepthOffset: 2.35,
  canopyFlattenScale: 0.08
};

const OBJ_TO_GAME_AXIS_MATRIX = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(1, 0, 0)
);

const objCanopyCache = new Map();
const unavailableObjUrls = new Set();

// Piloto 3D com selete, conectores e batoques. O asset preferencial agora e o
// experimento rigado `image/pilot-rigged.glb`, com ossos para cabeca e bracos,
// e o `pilot-pod.glb` permanece como fallback visual caso o GLB novo falhe.
// No GLB o piloto olha para +Z; o jogo voa para -Z, dai o rotationY de meia-volta.
const PILOT_POD_CONFIG = {
  assetUrl: '/image/pilot-rigged.glb',
  fallbackAssetUrl: '/image/pilot-pod.glb',
  scale: 1.5,
  rotationY: Math.PI,
  flightPosition: new THREE.Vector3(0, 0.15, 0.1),
  // Pousado: casulo inclinado ate o chao, piloto "sentado" ao lado da asa.
  standingRotationX: -1.05,
  standingPosition: new THREE.Vector3(0, 0.62, 0),
  // Pontos de conexao no espaco LOCAL do GLB (lado +X; o outro e espelhado):
  // topo da fita da selete (loop do tirante) e punho fechado do piloto, onde
  // o jogo adiciona o batoque (o asset vem com as maos vazias).
  harnessAttachLocal: new THREE.Vector3(0.14, 0.272, 0.012),
  toggleAttachLocal: new THREE.Vector3(0.21, 0.115, -0.04),
  fistLocal: new THREE.Vector3(0.21, 0.095, -0.04)
};

const PILOT_BONE_NAMES = [
  'head',
  'upper_arm.L',
  'forearm.L',
  'hand.L',
  'upper_arm.R',
  'forearm.R',
  'hand.R'
];

const PILOT_RIG_POSE_CONFIG = {
  response: 10,
  lookResponse: 6,
  leftRest: {
    upperArm: new THREE.Euler(0, 0, 0),
    forearm: new THREE.Euler(0, 0, 0),
    hand: new THREE.Euler(0, 0, 0)
  },
  leftPulled: {
    upperArm: new THREE.Euler(0.16, -0.08, -0.32),
    forearm: new THREE.Euler(0.3, -0.14, -0.4),
    hand: new THREE.Euler(0.1, 0, -0.14)
  },
  rightRest: {
    upperArm: new THREE.Euler(0, 0, 0),
    forearm: new THREE.Euler(0, 0, 0),
    hand: new THREE.Euler(0, 0, 0)
  },
  rightPulled: {
    upperArm: new THREE.Euler(0.16, 0.08, 0.32),
    forearm: new THREE.Euler(0.3, 0.14, 0.4),
    hand: new THREE.Euler(0.1, 0, 0.14)
  },
  headTurnScale: 0.2,
  headPitchWhenBraking: -0.08
};

let pilotPodTemplatePromise = null;
let pilotPodUnavailable = false;
const pilotGlbWorldPosition = new THREE.Vector3();
const pilotGlbLocalPosition = new THREE.Vector3();
const pilotBrakeAnchor = new THREE.Vector3();
const pilotBrakeLook = new THREE.Vector3();

export function createParagliderModel(options = {}) {
  const config = {
    scale: 1,
    colors: { ...DEFAULT_COLORS, ...options.colors }
  };
  const group = new THREE.Group();
  group.scale.setScalar(config.scale);
  group.userData.pose = 'flight';

  const canopyGroup = new THREE.Group();
  canopyGroup.name = 'Canopy';

  const proceduralCanopy = createProceduralCanopy(config.colors);
  canopyGroup.add(proceduralCanopy);
  group.add(canopyGroup);

  const suspensionLines = createSuspensionLines();
  suspensionLines.name = 'SuspensionLines';
  group.add(suspensionLines);

  const pilot = createPilot(config.colors);
  pilot.name = 'Pilot';
  group.add(pilot);
  group.userData.parts = { canopyGroup, suspensionLines, pilot };
  enableShadowCasting(group);

  if (options.canopyAssetUrl) {
    proceduralCanopy.visible = false;
    suspensionLines.visible = false;
    loadObjCanopy({
      url: options.canopyAssetUrl,
      canopyGroup,
      suspensionLines,
      fallback: proceduralCanopy,
      colors: config.colors
    });
  }

  return group;
}

function createProceduralCanopy(colors) {
  const group = new THREE.Group();
  group.name = 'ProceduralCanopy';
  group.position.y = PROCEDURAL_CANOPY_LOADING_Y;

  const canopy = createCanopy(colors.canopy, 0, 0.06);
  canopy.position.y = 1.7;
  group.add(canopy);

  const stripe = createCanopy(colors.stripe, -0.35, 0.065, {
    chordStart: 0.45,
    chordEnd: 0.7,
    spanScale: 0.82
  });
  stripe.position.y = 1.72;
  group.add(stripe);

  const trim = createCanopy(colors.trim, -0.46, 0.07, {
    chordStart: 0.72,
    chordEnd: 0.82,
    spanScale: 0.9
  });
  trim.position.y = 1.73;
  group.add(trim);

  group.add(createArcBand(colors.stripe, -0.2, 0.08, 0.86));
  group.add(createArcBand(colors.trim, 0.28, 0.045, 0.94));
  group.add(createLeadingEdge(colors.canopy, colors.trim));
  group.add(createCellRidges());
  group.add(createRibLines());

  return group;
}

function loadObjCanopy({ url, canopyGroup, suspensionLines, fallback, colors }) {
  if (isBrowserOffline()) {
    markObjUnavailable(url, 'offline');
    fallback.visible = true;
    suspensionLines.visible = true;
    canopyGroup.userData.usesObj = false;
    return;
  }

  getObjCanopyTemplate(url)
    .then((template) => {
      const object = template.clone(true);
      const material = new THREE.MeshStandardMaterial({
        color: colors.canopy,
        roughness: 0.68,
        metalness: 0,
        side: THREE.DoubleSide
      });

      object.name = 'ObjCanopy';
      object.traverse((child) => {
        if (!child.isMesh) return;
        child.material = material;
      });
      enableShadowCasting(object);

      canopyGroup.remove(fallback);
      canopyGroup.add(object);
      connectSuspensionLinesToCanopySurface(suspensionLines, object, canopyGroup);
      suspensionLines.visible = true;
      canopyGroup.userData.assetUrl = url;
      canopyGroup.userData.usesObj = true;
    })
    .catch((error) => {
      markObjUnavailable(url, error);
      fallback.visible = true;
      suspensionLines.visible = true;
      canopyGroup.userData.usesObj = false;
    });
}

function getObjCanopyTemplate(url) {
  if (!objCanopyCache.has(url)) {
    const loader = new OBJLoader();
    objCanopyCache.set(
      url,
      loader.loadAsync(url).then((object) => prepareObjCanopyTemplate(object))
    );
  }

  return objCanopyCache.get(url);
}

function prepareObjCanopyTemplate(object) {
  object.name = 'ObjCanopyTemplate';
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry = child.geometry.clone();
    child.geometry.applyMatrix4(OBJ_TO_GAME_AXIS_MATRIX);
    child.geometry.computeVertexNormals();
  });

  const bounds = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);

  object.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry.translate(-center.x, -center.y, -center.z);
  });

  object.scale.setScalar(ASSET_CANOPY_CONFIG.targetSpan / size.x);
  object.rotation.x = ASSET_CANOPY_CONFIG.pitchUpRadians;
  object.position.set(0, ASSET_CANOPY_CONFIG.verticalOffset, ASSET_CANOPY_CONFIG.depthOffset);

  return object;
}

function enableShadowCasting(object) {
  object.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
}

function isBrowserOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function markObjUnavailable(url, reason) {
  if (unavailableObjUrls.has(url)) return;
  unavailableObjUrls.add(url);

  if (reason === 'offline') {
    console.info(`Vela OBJ nao carregada porque o navegador esta offline; usando vela procedural: ${url}`);
    return;
  }

  console.warn(`Nao foi possivel carregar a vela OBJ; usando vela procedural: ${url}`, reason);
}

function connectSuspensionLinesToCanopySurface(suspensionLines, canopyObject, canopyGroup) {
  const surfacePoints = getCanopySurfacePoints(canopyObject, canopyGroup);
  if (surfacePoints.length === 0) return;

  for (const line of suspensionLines.userData.canopyLines ?? []) {
    const target = line.userData.anchorTarget;
    const harnessPoint = line.userData.harnessPoint;
    if (!target || !harnessPoint) continue;

    const anchorPoint = findLowerCanopySurfacePoint(surfacePoints, target);
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints([anchorPoint, harnessPoint]);
  }

  suspensionLines.userData.connectedToCanopySurface = true;
}

function getCanopySurfacePoints(canopyObject, canopyGroup) {
  canopyGroup.updateMatrixWorld(true);
  canopyObject.updateMatrixWorld(true);

  const surfacePoints = [];
  const toCanopyGroupLocal = new THREE.Matrix4().copy(canopyGroup.matrixWorld).invert();
  const vertex = new THREE.Vector3();
  const transform = new THREE.Matrix4();

  canopyObject.traverse((child) => {
    if (!child.isMesh) return;

    transform.multiplyMatrices(toCanopyGroupLocal, child.matrixWorld);
    const position = child.geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(transform);
      surfacePoints.push(vertex.clone());
    }
  });

  return surfacePoints;
}

function findLowerCanopySurfacePoint(surfacePoints, target) {
  let bestPoint = surfacePoints[0];
  let bestScore = Infinity;
  let searchRadius = 0.08;
  let candidates = [];

  while (candidates.length < 6 && searchRadius <= 0.9) {
    const radiusSq = searchRadius * searchRadius;
    candidates = surfacePoints.filter((point) => {
      const dx = point.x - target.x;
      const dz = point.z - target.z;
      return dx * dx + dz * dz <= radiusSq;
    });
    searchRadius += 0.08;
  }

  if (candidates.length > 0) {
    return candidates.reduce((lowest, point) => (point.y < lowest.y ? point : lowest)).clone();
  }

  for (const point of surfacePoints) {
    const dx = point.x - target.x;
    const dz = point.z - target.z;
    const score = dx * dx + dz * dz;
    if (score < bestScore) {
      bestScore = score;
      bestPoint = point;
    }
  }

  return bestPoint.clone();
}

export function setParagliderFlightPose(model) {
  const parts = model.userData.parts;
  if (!parts || model.userData.pose === 'flight') return;

  parts.canopyGroup.position.set(0, 0, 0);
  parts.canopyGroup.rotation.set(0, 0, 0);
  parts.canopyGroup.scale.set(1, 1, 1);
  parts.suspensionLines.visible = true;
  setPilotFlightPose(parts.pilot);
  model.userData.pose = 'flight';
}

export function setParagliderLandedPose(model, options = {}) {
  const parts = model.userData.parts;
  if (!parts || model.userData.pose === 'landed') return;

  if (Number.isFinite(options.groundHeight)) {
    model.position.y = options.groundHeight + LANDED_POSE_CONFIG.groundOffset;
  }

  parts.canopyGroup.position.set(
    0,
    0.16 - ASSET_CANOPY_CONFIG.verticalOffset * LANDED_POSE_CONFIG.canopyFlattenScale,
    LANDED_POSE_CONFIG.canopyDepthOffset
  );
  parts.canopyGroup.rotation.set(0.04, 0, 0);
  parts.canopyGroup.scale.set(1, LANDED_POSE_CONFIG.canopyFlattenScale, 1);
  parts.suspensionLines.visible = false;
  setPilotStandingPose(parts.pilot);
  model.userData.pose = 'landed';
}

export function updateParagliderBrakePose(model, controls = {}, delta = 1 / 60) {
  const pilot = model.userData.parts?.pilot;
  if (!pilot || pilot.userData.poseName !== 'flight') return;

  const leftInput = THREE.MathUtils.clamp(Number(controls.left) || 0, 0, 1);
  const rightInput = THREE.MathUtils.clamp(Number(controls.right) || 0, 0, 1);
  const symmetricBrake = THREE.MathUtils.clamp(Number(controls.symmetricBrake) || 0, 0, 1);
  const leftTarget = Math.max(leftInput, symmetricBrake);
  const rightTarget = Math.max(rightInput, symmetricBrake);
  const response = 1 - Math.exp(-delta * PILOT_RIG_POSE_CONFIG.response);
  const lookResponse = 1 - Math.exp(-delta * PILOT_RIG_POSE_CONFIG.lookResponse);

  if (!pilot.userData.brakeState) {
    pilot.userData.brakeState = { left: 0, right: 0, look: 0 };
  }
  const brakeState = pilot.userData.brakeState;
  brakeState.left += (leftTarget - brakeState.left) * response;
  brakeState.right += (rightTarget - brakeState.right) * response;
  const lookTarget = THREE.MathUtils.clamp(leftTarget - rightTarget, -1, 1);
  brakeState.look += (lookTarget - brakeState.look) * lookResponse;

  if (pilot.userData.rigBones) {
    applyPilotRigBrakePose(pilot, brakeState);
    updatePilotRigBrakeLines(pilot);
    return;
  }

  const parts = pilot.userData.parts;
  if (!parts) return;
  parts.leftArm.rotation.set(
    THREE.MathUtils.lerp(-0.32, -0.16, brakeState.left),
    0,
    THREE.MathUtils.lerp(-0.5, -0.82, brakeState.left)
  );
  parts.rightArm.rotation.set(
    THREE.MathUtils.lerp(-0.32, -0.16, brakeState.right),
    0,
    THREE.MathUtils.lerp(0.5, 0.82, brakeState.right)
  );
  parts.helmet.position.x = brakeState.look * 0.035;
}

function createCanopy(color, zOffset = 0, liftOffset = 0, options = {}) {
  const span = CANOPY_SHAPE.span;
  const chord = CANOPY_SHAPE.chord;
  const spanSegments = CANOPY_SHAPE.spanSegments;
  const chordSegments = CANOPY_SHAPE.chordSegments;
  const chordStart = options.chordStart ?? 0;
  const chordEnd = options.chordEnd ?? 1;
  const spanScale = options.spanScale ?? 1;
  const halfSpan = (span * spanScale) / 2;
  const vertices = [];
  const indices = [];

  for (let ix = 0; ix <= spanSegments; ix += 1) {
    const spanT = ix / spanSegments;
    const x = THREE.MathUtils.lerp(-halfSpan, halfSpan, spanT);
    const normalizedX = Math.abs(x) / halfSpan;
    const edgeDrop = Math.pow(normalizedX, 2.35) * 1.55;
    const cellPhase = (spanT * CANOPY_SHAPE.cells) % 1;
    const cellRidge = Math.sin(cellPhase * Math.PI);

    for (let iz = 0; iz <= chordSegments; iz += 1) {
      const chordT = THREE.MathUtils.lerp(chordStart, chordEnd, iz / chordSegments);
      const z = THREE.MathUtils.lerp(-chord / 2, chord / 2, chordT) + zOffset;
      const arch = 1.92 - edgeDrop;
      const camber = Math.sin(chordT * Math.PI) * 0.48;
      const leadingInflation = Math.exp(-Math.pow((chordT - 0.08) / 0.16, 2)) * 0.22;
      const cellInflation = cellRidge * 0.16 * Math.sin(chordT * Math.PI);
      const sweptTip = Math.pow(normalizedX, 2) * 0.76;
      vertices.push(x, arch + camber + leadingInflation + cellInflation + liftOffset, z + sweptTip);
    }
  }

  const row = chordSegments + 1;
  for (let ix = 0; ix < spanSegments; ix += 1) {
    for (let iz = 0; iz < chordSegments; iz += 1) {
      const a = ix * row + iz;
      const b = (ix + 1) * row + iz;
      const c = (ix + 1) * row + iz + 1;
      const d = ix * row + iz + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.72,
      metalness: 0,
      side: THREE.DoubleSide
    })
  );
}

function createArcBand(color, z, radius, spanScale) {
  const halfSpan = (CANOPY_SHAPE.span / 2) * spanScale;
  const points = [];

  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const x = THREE.MathUtils.lerp(-halfSpan, halfSpan, t);
    const edgeDrop = Math.pow(Math.abs(x) / halfSpan, 2.35) * 1.22;
    const sweptTip = Math.pow(Math.abs(x) / halfSpan, 2) * 0.64;
    points.push(new THREE.Vector3(x, 3.72 - edgeDrop, z + sweptTip));
  }

  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 32, radius, 8, false),
    new THREE.MeshStandardMaterial({ color, roughness: 0.62 })
  );
}

function createLeadingEdge(canopyColor, trimColor) {
  const group = new THREE.Group();
  const halfSpan = CANOPY_SHAPE.span / 2;
  const segmentWidth = CANOPY_SHAPE.span / CANOPY_SHAPE.cells;
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: canopyColor, roughness: 0.64 });
  const capMaterial = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.7 });

  for (let i = 0; i < CANOPY_SHAPE.cells; i += 1) {
    const cellCenterT = (i + 0.5) / CANOPY_SHAPE.cells;
    const x = THREE.MathUtils.lerp(-halfSpan, halfSpan, cellCenterT);
    const normalizedX = Math.abs(x) / halfSpan;
    const edgeDrop = Math.pow(normalizedX, 2.35) * 1.52;
    const sweptTip = Math.pow(normalizedX, 2) * 0.72;
    const geometry = new THREE.CapsuleGeometry(0.16, segmentWidth * 0.58, 5, 8);
    const cell = new THREE.Mesh(geometry, i % 6 === 0 ? capMaterial : edgeMaterial);
    cell.rotation.z = Math.PI / 2;
    cell.position.set(x, 3.64 - edgeDrop, -1.42 + sweptTip);
    group.add(cell);
  }

  return group;
}

function createCellRidges() {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: 0xf4fbff,
    transparent: true,
    opacity: 0.62
  });
  const halfSpan = CANOPY_SHAPE.span / 2;

  for (let i = 1; i < CANOPY_SHAPE.cells; i += 1) {
    const t = i / CANOPY_SHAPE.cells;
    const x = THREE.MathUtils.lerp(-halfSpan, halfSpan, t);
    const normalizedX = Math.abs(x) / halfSpan;
    const edgeDrop = Math.pow(normalizedX, 2.35) * 1.45;
    const sweptTip = Math.pow(normalizedX, 2) * 0.72;
    const points = [
      new THREE.Vector3(x, 3.55 - edgeDrop, -1.38 + sweptTip),
      new THREE.Vector3(x, 3.85 - edgeDrop, -0.45 + sweptTip),
      new THREE.Vector3(x, 3.66 - edgeDrop, 1.05 + sweptTip)
    ];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
  }

  return group;
}

function createRibLines() {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: 0xe8f7ff,
    transparent: true,
    opacity: 0.32
  });

  for (let i = -6; i <= 6; i += 1) {
    const x = i * 0.85;
    const normalizedX = Math.abs(x) / (CANOPY_SHAPE.span / 2);
    const edgeDrop = Math.pow(normalizedX, 2.35) * 1.35;
    const sweptTip = Math.pow(normalizedX, 2) * 0.66;
    const points = [
      new THREE.Vector3(x, 3.48 - edgeDrop, -1.32 + sweptTip),
      new THREE.Vector3(x, 3.78 - edgeDrop, 1.05 + sweptTip)
    ];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
  }

  return group;
}

function createSuspensionLines() {
  const group = new THREE.Group();
  group.userData.canopyLines = [];
  const lineMaterials = [
    new THREE.LineBasicMaterial({ color: 0xf2f2d8, transparent: true, opacity: 0.55 }),
    new THREE.LineBasicMaterial({ color: 0xe06c75, transparent: true, opacity: 0.46 }),
    new THREE.LineBasicMaterial({ color: 0x6aa9ff, transparent: true, opacity: 0.46 })
  ];
  const riserMaterial = new THREE.LineBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 1
  });
  const harnessPoints = [
    new THREE.Vector3(-0.52, 0.26, -0.08),
    new THREE.Vector3(0.52, 0.26, -0.08)
  ];
  const lineRows = [
    { z: -1.46, yOffset: -0.08, spread: 1, tipLift: 0.85 },
    { z: -0.68, yOffset: 0.04, spread: 0.98, tipLift: 0.1 },
    { z: 0.16, yOffset: 0.08, spread: 0.95, tipLift: 0.02 },
    { z: 1.08, yOffset: -0.1, spread: 0.9, tipLift: 0.78 }
  ];
  const halfSpan = ASSET_CANOPY_CONFIG.targetSpan / 2;
  const stations = [0.65, 1.45, 2.25, 3.05, 3.85, 4.65, 5.35, 6.02];
  const getCanopyAnchorY = (normalizedX, row = {}) => (
    ASSET_CANOPY_CONFIG.verticalOffset
    + INITIAL_LINE_CONFIG.lineTopLift
    + (row.yOffset ?? 0)
    - Math.pow(normalizedX, 2.05) * INITIAL_LINE_CONFIG.edgeDropScale
    + Math.pow(normalizedX, 2) * (row.tipLift ?? 0)
  );

  for (const side of [-1, 1]) {
    const targetHarness = side < 0 ? harnessPoints[0] : harnessPoints[1];

    for (const station of stations) {
      const normalizedX = station / halfSpan;
      const sweptTip = Math.pow(normalizedX, 2) * 0.34;

      for (let rowIndex = 0; rowIndex < lineRows.length; rowIndex += 1) {
        const row = lineRows[rowIndex];
        const anchorPoint = new THREE.Vector3(
          side * station * row.spread,
          getCanopyAnchorY(normalizedX, row),
          ASSET_CANOPY_CONFIG.depthOffset + row.z + sweptTip
        );
        group.add(createCanopySuspensionLine({
          anchorPoint,
          targetHarness,
          material: lineMaterials[rowIndex % lineMaterials.length],
          lineGroup: group
        }));
      }
    }
  }

  const centerY = getCanopyAnchorY(0.42 / halfSpan, { yOffset: 0.02, tipLift: 0.2 });
  group.add(createCanopySuspensionLine({
    anchorPoint: new THREE.Vector3(-0.42, centerY, ASSET_CANOPY_CONFIG.depthOffset - 0.18),
    targetHarness: harnessPoints[0],
    material: lineMaterials[0],
    lineGroup: group
  }));
  group.add(createCanopySuspensionLine({
    anchorPoint: new THREE.Vector3(0.42, centerY, ASSET_CANOPY_CONFIG.depthOffset - 0.18),
    targetHarness: harnessPoints[1],
    material: lineMaterials[0],
    lineGroup: group
  }));

  const riserLines = [
    new THREE.Line(new THREE.BufferGeometry().setFromPoints([harnessPoints[0], new THREE.Vector3(-0.18, -0.05, -0.1)]), riserMaterial),
    new THREE.Line(new THREE.BufferGeometry().setFromPoints([harnessPoints[1], new THREE.Vector3(0.18, -0.05, -0.1)]), riserMaterial)
  ];
  group.add(...riserLines);
  group.userData.riserLines = riserLines;

  // Linhas de comando (freio): do bordo de fuga ate a mao do piloto. Com o
  // piloto GLB, o endpoint e movido para a barra do batoque que ele segura.
  const brakeMaterial = new THREE.LineBasicMaterial({ color: 0xd8342a, transparent: true, opacity: 0.85 });
  const brakeRow = lineRows[lineRows.length - 1];
  for (const side of [-1, 1]) {
    const station = 3.05;
    const baseAnchorX = station * brakeRow.spread;
    const anchorX = THREE.MathUtils.lerp(baseAnchorX, halfSpan, BRAKE_LINE_TIP_BLEND);
    const normalizedX = anchorX / halfSpan;
    const brakeLine = createCanopySuspensionLine({
      anchorPoint: new THREE.Vector3(
        side * anchorX,
        getCanopyAnchorY(normalizedX, brakeRow),
        ASSET_CANOPY_CONFIG.depthOffset + brakeRow.z + Math.pow(normalizedX, 2) * 0.34
      ),
      targetHarness: new THREE.Vector3(side * 0.42, 0.62, 0.2),
      material: brakeMaterial,
      lineGroup: group
    });
    brakeLine.userData.isBrakeLine = true;
    group.add(brakeLine);
  }

  return group;
}

function createCanopySuspensionLine({ anchorPoint, targetHarness, material, lineGroup }) {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([anchorPoint, targetHarness]),
    material
  );
  line.userData.anchorTarget = anchorPoint.clone();
  line.userData.harnessPoint = targetHarness.clone();
  lineGroup.userData.canopyLines.push(line);
  return line;
}

function createPilot(colors) {
  const group = new THREE.Group();
  const podMaterial = new THREE.MeshStandardMaterial({ color: colors.pilot, roughness: 0.72 });
  const suitMaterial = new THREE.MeshStandardMaterial({ color: 0x2a3440, roughness: 0.8 });
  const strapMaterial = new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.85 });

  // Casulo (pod harness): capsula alongada, afilada atras, deitada em voo.
  const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.15, 6, 12), podMaterial);
  pod.scale.set(0.82, 1, 0.72);
  group.add(pod);

  // Tronco do piloto emergindo do casulo, levemente reclinado.
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.42, 6, 10), suitMaterial);
  group.add(torso);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 12, 8),
    new THREE.MeshStandardMaterial({ color: colors.helmet, roughness: 0.45 })
  );
  group.add(helmet);

  // Bracos erguidos em direcao aos tirantes.
  const armGeometry = new THREE.CylinderGeometry(0.05, 0.055, 0.66, 6);
  const leftArm = new THREE.Mesh(armGeometry, suitMaterial);
  const rightArm = new THREE.Mesh(armGeometry, suitMaterial);
  group.add(leftArm, rightArm);

  const harness = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.07, 0.4), strapMaterial);
  group.add(harness);

  group.userData.parts = { pod, torso, helmet, leftArm, rightArm, harness };
  setPilotFlightPose(group);
  loadPilotPod(group);
  return group;
}

// Troca o piloto procedural pelo GLB assim que carregar; sem rede ou sem o
// asset, o procedural continua. O template e compartilhado (jogador + bots
// clonam a mesma geometria/material).
function loadPilotPod(pilot) {
  if (pilotPodUnavailable) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  if (!pilotPodTemplatePromise) {
    const loader = new GLTFLoader();
    pilotPodTemplatePromise = loader.loadAsync(PILOT_POD_CONFIG.assetUrl)
      .catch((primaryError) => loader.loadAsync(PILOT_POD_CONFIG.fallbackAssetUrl)
        .catch((fallbackError) => {
          throw new Error(
            `falha ao carregar ${PILOT_POD_CONFIG.assetUrl} e fallback ${PILOT_POD_CONFIG.fallbackAssetUrl}: ${primaryError}; ${fallbackError}`
          );
        }));
  }

  pilotPodTemplatePromise
    .then((gltf) => {
      const template = gltf.scene;
      if (!template) throw new Error('scene do piloto GLB nao encontrada');

      const pod = SkeletonUtils.clone(template);
      pod.name = 'PilotPodAsset';
      pod.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        if (child.material?.color) child.material.color.multiplyScalar(0.9);
        child.material.side = THREE.DoubleSide;
        child.frustumCulled = false;
      });
      addPilotPodToggles(pod);
      pilot.add(pod);
      pilot.userData.glbPilot = pod;
      pilot.userData.rigBones = getPilotRigBones(pod);

      for (const mesh of Object.values(pilot.userData.parts ?? {})) {
        mesh.visible = false;
      }

      // Reaplica a pose vigente ja com o GLB no lugar.
      if (pilot.userData.poseName === 'standing') {
        setPilotStandingPose(pilot);
      } else {
        setPilotFlightPose(pilot);
      }

      attachLinesToPilotPod(pilot);
    })
    .catch((error) => {
      if (!pilotPodUnavailable) {
        pilotPodUnavailable = true;
        console.warn(`Nao foi possivel carregar o piloto GLB; usando piloto procedural: ${PILOT_POD_CONFIG.assetUrl}`, error);
      }
    });
}

// Batoques (asset vem com as maos vazias): barra vermelha em cada punho, no
// espaco local do GLB, para a linha de comando ter onde chegar.
function addPilotPodToggles(pod) {
  const rigBones = getPilotRigBones(pod);
  if (rigBones) {
    pod.userData.toggleAnchors = createPilotRigToggleAnchors(rigBones);
    return;
  }

  const toggleMaterial = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.82 });
  const toggleGeometry = new THREE.CylinderGeometry(0.0072, 0.0072, 0.066, 10);
  toggleGeometry.rotateZ(Math.PI / 2);

  for (const side of [-1, 1]) {
    const toggle = new THREE.Mesh(toggleGeometry, toggleMaterial);
    toggle.castShadow = true;
    toggle.position.set(
      side * PILOT_POD_CONFIG.fistLocal.x,
      PILOT_POD_CONFIG.fistLocal.y,
      PILOT_POD_CONFIG.fistLocal.z
    );
    pod.add(toggle);
  }
}

// Converte um ponto local do GLB (lado dado pelo sinal) para o espaco do
// modelo na pose de voo (escala + meia-volta em Y + offset do casulo).
function pilotPodAttachPoint(local, side) {
  return new THREE.Vector3(
    side * Math.abs(local.x) * PILOT_POD_CONFIG.scale,
    local.y * PILOT_POD_CONFIG.scale + PILOT_POD_CONFIG.flightPosition.y,
    -local.z * PILOT_POD_CONFIG.scale + PILOT_POD_CONFIG.flightPosition.z
  );
}

// Reconecta as linhas ao piloto GLB: linhas de sustentacao no topo da fita da
// selete, linhas de comando no batoque do punho. Os tirantes falsos do piloto
// procedural somem (a fita do GLB ja faz esse papel).
function attachLinesToPilotPod(pilot) {
  const suspensionLines = pilot.parent?.userData?.parts?.suspensionLines;
  if (!suspensionLines) return;

  for (const line of suspensionLines.userData.canopyLines ?? []) {
    const side = line.userData.harnessPoint.x < 0 ? -1 : 1;
    const endPoint = line.userData.isBrakeLine
      ? getPilotBrakeAttachPoint(pilot, side)
      : pilotPodAttachPoint(PILOT_POD_CONFIG.harnessAttachLocal, side);

    // Preserva a ancora atual na vela (vertice 0), que pode ja ter sido
    // ajustada pelo snap a superficie do OBJ.
    const anchor = new THREE.Vector3().fromBufferAttribute(line.geometry.getAttribute('position'), 0);
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints([anchor, endPoint]);
    line.userData.harnessPoint = endPoint.clone();
  }

  for (const riser of suspensionLines.userData.riserLines ?? []) {
    riser.visible = false;
  }
}

function setPilotFlightPose(pilot) {
  const parts = pilot.userData.parts;
  if (!parts) return;

  pilot.userData.poseName = 'flight';
  pilot.position.set(0, 0, 0);
  pilot.rotation.set(0, 0, 0);

  const glbPilot = pilot.userData.glbPilot;
  if (glbPilot) {
    glbPilot.scale.setScalar(PILOT_POD_CONFIG.scale);
    glbPilot.rotation.set(0, PILOT_POD_CONFIG.rotationY, 0);
    glbPilot.position.copy(PILOT_POD_CONFIG.flightPosition);
    resetPilotRigBones(pilot);
    updatePilotRigBrakeLines(pilot);
    return;
  }

  // Pod harness real: pes/casulo apontando para frente (-Z, direcao de voo),
  // levemente erguidos, com o piloto reclinado e a cabeca atras/acima.
  parts.pod.visible = true;
  parts.pod.rotation.set(-(Math.PI / 2 - 0.18), 0, 0);
  parts.pod.position.set(0, -0.12, -0.28);

  parts.torso.rotation.set(0.42, 0, 0);
  parts.torso.position.set(0, 0.22, 0.32);

  parts.helmet.position.set(0, 0.52, 0.5);

  // Bracos erguidos para tras/acima, segurando os freios junto aos tirantes.
  parts.leftArm.rotation.set(-0.32, 0, -0.5);
  parts.leftArm.position.set(-0.36, 0.42, 0.24);
  parts.rightArm.rotation.set(-0.32, 0, 0.5);
  parts.rightArm.position.set(0.36, 0.42, 0.24);

  parts.harness.rotation.set(0, 0, 0);
  parts.harness.position.set(0, 0.28, 0);
}

function setPilotStandingPose(pilot) {
  const parts = pilot.userData.parts;
  if (!parts) return;

  pilot.userData.poseName = 'standing';
  pilot.position.set(2.8, 0.95, 1.25);
  pilot.rotation.set(0, -0.35, 0);

  const glbPilot = pilot.userData.glbPilot;
  if (glbPilot) {
    glbPilot.scale.setScalar(PILOT_POD_CONFIG.scale);
    glbPilot.rotation.set(PILOT_POD_CONFIG.standingRotationX, PILOT_POD_CONFIG.rotationY, 0);
    glbPilot.position.copy(PILOT_POD_CONFIG.standingPosition);
    resetPilotRigBones(pilot);
    return;
  }

  // Em pe, o casulo fica recolhido atras das pernas.
  parts.pod.visible = false;

  parts.torso.rotation.set(0, 0, 0);
  parts.torso.position.set(0, 0.3, 0);

  parts.helmet.position.set(0, 0.78, -0.02);

  parts.leftArm.rotation.set(0, 0, 0.15);
  parts.leftArm.position.set(-0.28, 0.24, 0);
  parts.rightArm.rotation.set(0, 0, -0.15);
  parts.rightArm.position.set(0.28, 0.24, 0);

  parts.harness.rotation.set(0.2, 0, 0);
  parts.harness.position.set(0, 0.12, 0.14);
}

function getPilotRigBones(pod) {
  const bones = {};
  for (const boneName of PILOT_BONE_NAMES) {
    const bone = pod.getObjectByName(boneName);
    if (!bone) return null;
    bone.rotation.order = 'XYZ';
    bones[boneName] = bone;
  }
  return bones;
}

function createPilotRigToggleAnchors(rigBones) {
  const anchors = {};
  for (const side of ['L', 'R']) {
    const anchor = new THREE.Object3D();
    anchor.name = `ToggleAnchor_${side}`;
    anchor.position.set(side === 'L' ? -0.03 : 0.03, 0.06, 0.03);
    rigBones[`hand.${side}`].add(anchor);
    anchors[side] = anchor;
  }
  return anchors;
}

function getPilotBrakeAttachPoint(pilot, side) {
  const anchors = pilot.userData.glbPilot?.userData?.toggleAnchors;
  const anchor = anchors?.[side < 0 ? 'L' : 'R'];
  if (!anchor) return pilotPodAttachPoint(PILOT_POD_CONFIG.toggleAttachLocal, side);

  anchor.updateWorldMatrix(true, false);
  anchor.getWorldPosition(pilotGlbWorldPosition);
  pilotBrakeAnchor.copy(pilotGlbWorldPosition);
  pilot.parent.worldToLocal(pilotBrakeAnchor);
  return pilotBrakeAnchor.clone();
}

function applyPilotRigBrakePose(pilot, brakeState) {
  const rigBones = pilot.userData.rigBones;
  if (!rigBones) return;

  applyInterpolatedBonePose(rigBones['upper_arm.L'], PILOT_RIG_POSE_CONFIG.leftRest.upperArm, PILOT_RIG_POSE_CONFIG.leftPulled.upperArm, brakeState.left);
  applyInterpolatedBonePose(rigBones['forearm.L'], PILOT_RIG_POSE_CONFIG.leftRest.forearm, PILOT_RIG_POSE_CONFIG.leftPulled.forearm, brakeState.left);
  applyInterpolatedBonePose(rigBones['hand.L'], PILOT_RIG_POSE_CONFIG.leftRest.hand, PILOT_RIG_POSE_CONFIG.leftPulled.hand, brakeState.left);
  applyInterpolatedBonePose(rigBones['upper_arm.R'], PILOT_RIG_POSE_CONFIG.rightRest.upperArm, PILOT_RIG_POSE_CONFIG.rightPulled.upperArm, brakeState.right);
  applyInterpolatedBonePose(rigBones['forearm.R'], PILOT_RIG_POSE_CONFIG.rightRest.forearm, PILOT_RIG_POSE_CONFIG.rightPulled.forearm, brakeState.right);
  applyInterpolatedBonePose(rigBones['hand.R'], PILOT_RIG_POSE_CONFIG.rightRest.hand, PILOT_RIG_POSE_CONFIG.rightPulled.hand, brakeState.right);

  pilotBrakeLook.set(
    PILOT_RIG_POSE_CONFIG.headPitchWhenBraking * Math.max(brakeState.left, brakeState.right),
    0,
    brakeState.look * PILOT_RIG_POSE_CONFIG.headTurnScale
  );
  rigBones.head.rotation.set(pilotBrakeLook.x, pilotBrakeLook.y, pilotBrakeLook.z);
}

function resetPilotRigBones(pilot) {
  const rigBones = pilot.userData.rigBones;
  if (!rigBones) return;

  for (const boneName of PILOT_BONE_NAMES) {
    rigBones[boneName].rotation.set(0, 0, 0);
  }
  if (!pilot.userData.brakeState) {
    pilot.userData.brakeState = { left: 0, right: 0, look: 0 };
    return;
  }
  pilot.userData.brakeState.left = 0;
  pilot.userData.brakeState.right = 0;
  pilot.userData.brakeState.look = 0;
}

function updatePilotRigBrakeLines(pilot) {
  const suspensionLines = pilot.parent?.userData?.parts?.suspensionLines;
  if (!suspensionLines) return;

  for (const line of suspensionLines.userData.canopyLines ?? []) {
    if (!line.userData.isBrakeLine) continue;

    const side = line.userData.harnessPoint.x < 0 ? -1 : 1;
    const anchor = new THREE.Vector3().fromBufferAttribute(line.geometry.getAttribute('position'), 0);
    const endPoint = getPilotBrakeAttachPoint(pilot, side);
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints([anchor, endPoint]);
    line.userData.harnessPoint = endPoint.clone();
  }
}

function applyInterpolatedBonePose(bone, restEuler, pulledEuler, alpha) {
  bone.rotation.set(
    THREE.MathUtils.lerp(restEuler.x, pulledEuler.x, alpha),
    THREE.MathUtils.lerp(restEuler.y, pulledEuler.y, alpha),
    THREE.MathUtils.lerp(restEuler.z, pulledEuler.z, alpha)
  );
}
