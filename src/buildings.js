import * as THREE from 'three';

// Edificacao de referencia fixa numa coordenada especifica de uma rampa
// (ex.: rancho/sede no ponto de decolagem). Mesmo estilo visual das casas de
// urbanScenery.js (caixa + telhado extrudado de duas aguas), mas um pouco
// maior para ler como um marco, e posicionada por lat/long em vez de
// distribuida proceduralmente por chunk.
const BODY_WIDTH = 18;
const BODY_HEIGHT = 9.5;
const BODY_DEPTH = 15;
const ROOF_OVERHANG = 1.6;
const ROOF_HEIGHT = 5.6;

export function createLocationBuilding() {
  const group = new THREE.Group();
  group.name = 'LocationBuilding';
  group.visible = false;

  const bodyGeometry = new THREE.BoxGeometry(BODY_WIDTH, BODY_HEIGHT, BODY_DEPTH);
  bodyGeometry.translate(0, BODY_HEIGHT / 2, 0);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xd6c3b4,
    roughness: 0.85,
    metalness: 0
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  group.add(body);

  const halfWidth = BODY_WIDTH / 2 + ROOF_OVERHANG;
  const roofProfile = new THREE.Shape([
    new THREE.Vector2(-halfWidth, 0),
    new THREE.Vector2(halfWidth, 0),
    new THREE.Vector2(0, ROOF_HEIGHT)
  ]);
  const roofGeometry = new THREE.ExtrudeGeometry(roofProfile, {
    depth: BODY_DEPTH + ROOF_OVERHANG * 2,
    bevelEnabled: false
  });
  roofGeometry.translate(0, BODY_HEIGHT, -(BODY_DEPTH / 2 + ROOF_OVERHANG));
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: 0x7b5940,
    roughness: 0.9,
    metalness: 0
  });
  const roof = new THREE.Mesh(roofGeometry, roofMaterial);
  group.add(roof);

  return group;
}

// Afunda a base para nenhum canto flutuar em encosta (arvores usam 0.6 com
// base pontual; aqui um pouco menos porque ja usamos o minimo dos cantos).
const GROUND_SINK = 0.4;

export function updateLocationBuilding(building, location, terrain) {
  if (!building) return;

  const buildingConfig = location?.building;
  if (!buildingConfig) {
    building.visible = false;
    return;
  }

  const worldXZ = terrain.latLongToWorldXZ(buildingConfig.latitude, buildingConfig.longitude);
  if (!worldXZ) {
    building.visible = false;
    return;
  }

  const groundHeight = getFootprintGroundHeight(terrain, worldXZ.x, worldXZ.z);
  // Chunk ainda nao carregado: mantem oculto; esta funcao roda todo frame e
  // reposiciona sozinha quando o relevo real chegar (mesmo padrao das arvores).
  if (groundHeight === null) {
    building.visible = false;
    return;
  }

  building.position.set(worldXZ.x, groundHeight - GROUND_SINK, worldXZ.z);
  building.visible = true;
}

// Menor altura da malha renderizada sob o centro e os 4 cantos da base:
// usa getRenderedHeightAt (relevo visivel, como as arvores em vegetation.js)
// em vez de getHeightAt, que diverge metros da malha em encostas.
function getFootprintGroundHeight(terrain, x, z) {
  const fallbackHeight = terrain.config?.fallbackHeight;
  const halfWidth = BODY_WIDTH / 2;
  const halfDepth = BODY_DEPTH / 2;
  const corners = [
    [x, z],
    [x - halfWidth, z - halfDepth],
    [x + halfWidth, z - halfDepth],
    [x - halfWidth, z + halfDepth],
    [x + halfWidth, z + halfDepth]
  ];

  let minHeight = Infinity;
  for (const [cornerX, cornerZ] of corners) {
    const height = terrain.getRenderedHeightAt
      ? terrain.getRenderedHeightAt(cornerX, cornerZ)
      : terrain.getHeightAt(cornerX, cornerZ);
    if (height === fallbackHeight) return null;
    minHeight = Math.min(minHeight, height);
  }

  return minHeight;
}
