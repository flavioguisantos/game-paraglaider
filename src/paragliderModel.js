import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

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

const LANDED_POSE_CONFIG = {
  groundOffset: 0.05,
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
      canopyGroup.userData.assetUrl = url;
      canopyGroup.userData.usesObj = true;
    })
    .catch((error) => {
      markObjUnavailable(url, error);
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
  const lineTopLift = 1.62;
  const edgeDropScale = 3.58;
  const getCanopyAnchorY = (normalizedX, row = {}) => (
    ASSET_CANOPY_CONFIG.verticalOffset
    + lineTopLift
    + (row.yOffset ?? 0)
    - Math.pow(normalizedX, 2.05) * edgeDropScale
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

  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([harnessPoints[0], new THREE.Vector3(-0.18, -0.05, -0.1)]), riserMaterial));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([harnessPoints[1], new THREE.Vector3(0.18, -0.05, -0.1)]), riserMaterial));

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
  return group;
}

function setPilotFlightPose(pilot) {
  const parts = pilot.userData.parts;
  if (!parts) return;

  pilot.position.set(0, 0, 0);
  pilot.rotation.set(0, 0, 0);

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

  pilot.position.set(2.8, 0.95, 1.25);
  pilot.rotation.set(0, -0.35, 0);

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
