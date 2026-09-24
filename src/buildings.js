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

export function createFlightSiteMarkers() {
  const group = new THREE.Group();
  group.name = 'FlightSiteMarkers';

  const launch = new THREE.Group();
  launch.name = 'LaunchSiteMarker';
  const launchRing = new THREE.Mesh(
    new THREE.TorusGeometry(32, 1.8, 6, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.72, depthWrite: false })
  );
  launchRing.rotation.x = Math.PI / 2;
  launchRing.position.y = 1.5;
  launch.add(launchRing);
  addSiteFlag(launch, -24, 0xffd166);
  addSiteFlag(launch, 24, 0x4ecdc4);
  group.add(launch);

  const landing = new THREE.Group();
  landing.name = 'LandingZoneMarker';
  landing.visible = false;
  const landingRing = new THREE.Mesh(
    new THREE.TorusGeometry(28, 2.2, 6, 48),
    new THREE.MeshBasicMaterial({ color: 0x63e6a5, transparent: true, opacity: 0.82, depthWrite: false })
  );
  landingRing.rotation.x = Math.PI / 2;
  landingRing.position.y = 1.5;
  landing.add(landingRing);
  addSiteFlag(landing, -20, 0x63e6a5);
  addSiteFlag(landing, 20, 0x63e6a5);
  group.add(landing);

  return group;
}

export function updateFlightSiteMarkers(markers, location, terrain) {
  if (!markers || !terrain) return;

  const launchHeight = getSiteGroundHeight(terrain, 0, 0);
  const launch = markers.getObjectByName('LaunchSiteMarker');
  launch.visible = launchHeight !== null;
  if (launchHeight !== null) {
    launch.position.set(0, launchHeight, 0);
    launch.rotation.y = location?.launchHeadingRadians ?? 0;
  }

  const landing = markers.getObjectByName('LandingZoneMarker');
  const landingConfig = location?.landingZone;
  if (!landingConfig || !Number.isFinite(Number(landingConfig.latitude))
      || !Number.isFinite(Number(landingConfig.longitude))) {
    landing.visible = false;
    return;
  }

  const worldXZ = terrain.latLongToWorldXZ(landingConfig.latitude, landingConfig.longitude);
  const groundHeight = worldXZ ? getSiteGroundHeight(terrain, worldXZ.x, worldXZ.z) : null;
  if (!worldXZ || groundHeight === null) {
    landing.visible = false;
    return;
  }

  landing.position.set(worldXZ.x, groundHeight, worldXZ.z);
  landing.visible = true;
}

function getSiteGroundHeight(terrain, x, z) {
  const height = terrain.getRenderedHeightAt
    ? terrain.getRenderedHeightAt(x, z)
    : terrain.getHeightAt(x, z);
  return height === terrain.config?.fallbackHeight || !Number.isFinite(height) ? null : height;
}

function addSiteFlag(group, x, color) {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.65, 14, 6),
    new THREE.MeshStandardMaterial({ color: 0x3d4146, roughness: 0.85 })
  );
  pole.position.set(x, 7, 0);
  group.add(pole);

  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(7, 3.5, 0.35),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
  );
  flag.position.set(x + 3.8, 11.6, 0);
  group.add(flag);
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
