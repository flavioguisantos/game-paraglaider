import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createCloudBillboard } from './clouds.js';
import { createAdventureMusic, createVarioAudio, unlockGameAudio } from './audio.js';
import { createBots } from './bot.js?v=wind-physics-1';
import { initializeThirdPersonCamera, updateStandbyCamera, updateThirdPersonCamera } from './camera.js';
import { configureWind, createWindVector, detectParagliderCollisions, updateEntangledParagliders, updateWind } from './physics.js?v=wind-physics-1';
import { createHud, createRoundState, updateHud, updateRoundState } from './hud.js?v=wind-physics-1';
import { findFlightLocation } from './flightLocations.js';
import { createOrographicLift } from './orographicLift.js';
import { Player } from './player.js?v=wind-physics-1';
import { createTerrain } from './terrain.js?v=vector-realism-1';
import { createThermalField } from './thermal.js?v=thermal-drift-1';
import { createVegetation } from './vegetation.js';

const canvas = document.querySelector('#game');
const startButton = document.querySelector('#start-flight');
const colorInputs = [...document.querySelectorAll('input[name="canopy-color"]')];
const locationInputs = [...document.querySelectorAll('input[name="flight-location"]')];
const scene = new THREE.Scene();
// Perspectiva aerea: nevoa azulada e mais longa para reforcar a profundidade do horizonte.
scene.fog = new THREE.Fog(0xdceaf5, 2600, 32000);

const viewport = getViewportSize();
// near=2: com far=90000, near menor destroi a precisao do depth buffer a distancia
// (a ~2 km a resolucao cai para metros e overlays finos sobre o relevo somem).
const camera = new THREE.PerspectiveCamera(getCameraFov(viewport), viewport.width / viewport.height, 2, 90000);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(getRendererPixelRatio());
renderer.setSize(viewport.width, viewport.height);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setAppHeight();

const ambientLight = new THREE.HemisphereLight(0xdfefff, 0x40563a, 1.15);
scene.add(ambientLight);

// Direcao fixa do sol; a posicao da luz acompanha o jogador para manter o frustum de sombra util.
const SUN_DIRECTION = new THREE.Vector3(-220, 520, 180).normalize();
const SUN_DISTANCE = 2600;
const SHADOW_FRUSTUM_RADIUS = 950;
const sunLight = new THREE.DirectionalLight(0xfff8e8, 3.1);
sunLight.position.copy(SUN_DIRECTION).multiplyScalar(SUN_DISTANCE);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 200;
sunLight.shadow.camera.far = SUN_DISTANCE + 2600;
sunLight.shadow.camera.left = -SHADOW_FRUSTUM_RADIUS;
sunLight.shadow.camera.right = SHADOW_FRUSTUM_RADIUS;
sunLight.shadow.camera.top = SHADOW_FRUSTUM_RADIUS;
sunLight.shadow.camera.bottom = -SHADOW_FRUSTUM_RADIUS;
sunLight.shadow.bias = -0.0002;
sunLight.shadow.normalBias = 3;
scene.add(sunLight);
scene.add(sunLight.target);

function updateSunLight(referencePosition) {
  sunLight.target.position.copy(referencePosition);
  sunLight.position.copy(SUN_DIRECTION).multiplyScalar(SUN_DISTANCE).add(referencePosition);
  sky.position.set(referencePosition.x, 0, referencePosition.z);
}

const sky = createAtmosphericSky();
scene.add(sky);
applySkyEnvironment();

function createAtmosphericSky() {
  const sky = new Sky();
  sky.name = 'AtmosphericSky';
  // Mantem a cupula do ceu dentro do far plane da camera (90000).
  sky.scale.setScalar(80000);

  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 3.4;
  uniforms.rayleigh.value = 3.2;
  uniforms.mieCoefficient.value = 0.0031;
  uniforms.mieDirectionalG.value = 0.82;
  uniforms.sunPosition.value.copy(SUN_DIRECTION);
  return sky;
}

function applySkyEnvironment() {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const environmentScene = new THREE.Scene();
  const environmentSky = createAtmosphericSky();
  environmentSky.scale.setScalar(1000);
  environmentScene.add(environmentSky);

  const environment = pmremGenerator.fromScene(environmentScene, 0.02);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.45;
  pmremGenerator.dispose();
}

const terrain = createTerrain();
scene.add(terrain.mesh);
const vegetation = createVegetation({ terrain });
scene.add(vegetation.group);
scene.add(createDistantMountains());
scene.add(createHorizonClouds());

const wind = createWindVector();
const windMarkers = createWindMarkers();
scene.add(windMarkers);
const thermals = createThermalField({ scene, terrain, sunDirection: SUN_DIRECTION });
const orographicLift = createOrographicLift();
scene.add(orographicLift.group);
const hud = createHud(document.querySelector('#hud'));
const varioAudio = createVarioAudio();
const adventureMusic = createAdventureMusic({ trackUrl: '/assets/audio/adventure-track.mp3' });

const clock = new THREE.Clock();
const standbyPosition = new THREE.Vector3(0, 0, 0);
const appState = {
  started: false,
  player: null,
  bots: [],
  flyers: [],
  round: null,
  starting: false,
  selectedLocation: getSelectedFlightLocation()
};

camera.position.set(0, 1760, 2250);
camera.lookAt(0, 1320, 0);

function handleResize() {
  const viewport = getViewportSize();
  setAppHeight();
  camera.aspect = viewport.width / viewport.height;
  camera.fov = getCameraFov(viewport);
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(getRendererPixelRatio());
  renderer.setSize(viewport.width, viewport.height);
}

window.addEventListener('resize', handleResize);
window.visualViewport?.addEventListener('resize', handleResize);
startButton.addEventListener('click', startFlight);
for (const input of locationInputs) {
  input.addEventListener('change', () => {
    if (input.checked && !appState.started) {
      applySelectedFlightLocation();
    }
  });
}
setupLayerPanel();

// Painel de teste: liga/desliga cada camada vetorial do mapa.
function setupLayerPanel() {
  const panel = document.querySelector('#layer-panel');
  if (!panel) return;

  const toggles = [
    { label: 'Rodovias', layers: ['roadbig_line'] },
    { label: 'Estradas medias', layers: ['roadmedium_line'] },
    { label: 'Estradas de terra', layers: ['roadsmall_line'] },
    { label: 'Ferrovias', layers: ['railway_line'] },
    { label: 'Rios', layers: ['water_line'] },
    { label: 'Lagos e represas', layers: ['water_area'] },
    { label: 'Areas urbanas', layers: ['city_area'] },
    { label: 'Nomes de cidades', layers: ['city_point', 'town_point', 'suburb_point', 'village_point'] }
  ];

  for (const toggle of toggles) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.addEventListener('change', () => {
      for (const layerName of toggle.layers) {
        terrain.setLayerVisibility(layerName, input.checked);
      }
    });
    label.append(input, document.createTextNode(toggle.label));
    panel.append(label);
  }
}

async function startFlight() {
  if (appState.started || appState.starting) return;

  appState.starting = true;
  startButton.disabled = true;
  applySelectedFlightLocation();
  let hasLaunchHeight = false;
  try {
    hasLaunchHeight = await terrain.ensureHeightAt(0, 0);
  } catch (error) {
    console.warn('Nao foi possivel aguardar a altura real de decolagem.', error);
  }
  if (!hasLaunchHeight) {
    console.warn('Altura real de decolagem indisponivel; usando fallback do terreno.');
  }
  varioAudio.unlock();
  unlockGameAudio();

  const selectedColor = Number.parseInt(
    colorInputs.find((input) => input.checked)?.value ?? '0xa8dff2',
    16
  );

  const selectedLocation = getSelectedFlightLocation();
  appState.player = new Player({
    terrain,
    canopyColor: selectedColor,
    launchAltitudeMeters: selectedLocation.launchAltitudeMeters,
    launchHeadingRadians: selectedLocation.launchHeadingRadians
  });
  scene.add(appState.player.group);
  initializeThirdPersonCamera(camera, appState.player, { terrain });

  appState.bots = createBots({ terrain });
  for (const bot of appState.bots) {
    scene.add(bot.group);
  }

  appState.flyers = [appState.player, ...appState.bots];
  appState.round = createRoundState();
  appState.started = true;
  document.body.classList.add('is-flying');
  document.body.classList.remove('round-ended');
  adventureMusic.start();
  clock.start();
  appState.starting = false;
  startButton.disabled = false;
}

function getSelectedFlightLocation() {
  const selectedLocationId = locationInputs.find((input) => input.checked)?.value;
  return findFlightLocation(selectedLocationId);
}

function applySelectedFlightLocation() {
  const location = getSelectedFlightLocation();
  appState.selectedLocation = location;
  terrain.setCenterCoordinates({
    latitude: location.latitude,
    longitude: location.longitude
  });
  vegetation.reset();
  configureWind(wind, location.wind);
  thermals.setEnabled(location.liftMode !== 'orographic');
  orographicLift.configure(location.orographicLift);
}

renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 0.05);
  const referencePosition = appState.player?.position ?? standbyPosition;
  terrain.update(referencePosition, delta);
  vegetation.update(referencePosition);
  updateSunLight(referencePosition);
  updateWind(wind, delta);
  updateWindMarkers(windMarkers, wind, referencePosition, terrain);

  if (!appState.started) {
    thermals.update(delta, wind);
    orographicLift.update(delta, { referencePosition, terrain, wind });
    updateStandbyCamera(camera, terrain, delta, {
      headingRadians: appState.selectedLocation?.standbyHeadingRadians
        ?? appState.selectedLocation?.launchHeadingRadians
    });
    renderer.render(scene, camera);
    return;
  }

  const { player, bots, flyers, round } = appState;
  thermals.update(delta, wind, player);
  orographicLift.update(delta, { referencePosition: player.position, terrain, wind });

  if (!round.ended) {
    player.update(delta, { terrain, thermals, orographicLift, wind });
  }

  if (!round.ended || round.endReason === 'landed') {
    for (const bot of bots) {
      bot.update(delta, { terrain, thermals, orographicLift, wind });
    }

    detectParagliderCollisions(flyers);
  }

  updateEntangledParagliders(flyers, delta, { terrain, wind });

  updateRoundState(round, delta, player);
  document.body.classList.toggle('round-ended', round.ended);
  if (round.ended) adventureMusic.stop();
  varioAudio.update(delta, player.verticalSpeed, player.landed || round.ended);
  updateHud(hud, { player, bots, terrain, round, wind });
  updateThirdPersonCamera(camera, player, delta, { terrain });

  renderer.render(scene, camera);
});

function getRendererPixelRatio() {
  const { width } = getViewportSize();
  const isCompactScreen = width <= 760;
  const maxPixelRatio = isCompactScreen ? 1.35 : 2;
  return Math.min(window.devicePixelRatio || 1, maxPixelRatio);
}

function setAppHeight() {
  const { height } = getViewportSize();
  document.documentElement.style.setProperty('--app-height', `${height}px`);
}

function getViewportSize() {
  return {
    width: Math.round(window.visualViewport?.width ?? window.innerWidth),
    height: Math.round(window.visualViewport?.height ?? window.innerHeight)
  };
}

function getCameraFov({ width, height }) {
  const baseVerticalFov = 60;
  const desktopAspect = 16 / 9;
  const aspect = width / height;
  if (aspect >= desktopAspect) return baseVerticalFov;

  const baseVerticalFovRadians = THREE.MathUtils.degToRad(baseVerticalFov);
  const desktopHorizontalFov = 2 * Math.atan(Math.tan(baseVerticalFovRadians / 2) * desktopAspect);
  const adjustedVerticalFov = 2 * Math.atan(Math.tan(desktopHorizontalFov / 2) / aspect);
  return THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(adjustedVerticalFov), baseVerticalFov, 82);
}

function createDistantMountains() {
  const group = new THREE.Group();
  group.name = 'DistantMountains';
  const texture = createMountainSilhouetteTexture();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const ridges = [
    { x: -18000, y: 900, z: 15500, width: 27000, height: 7000, opacity: 0.92 },
    { x: 15000, y: 1150, z: 16700, width: 24000, height: 7800, opacity: 0.84 },
    { x: -5000, y: 700, z: 18200, width: 32000, height: 6200, opacity: 0.78 }
  ];

  for (const ridge of ridges) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material.clone());
    mesh.material.opacity = ridge.opacity;
    mesh.position.set(ridge.x, ridge.y, ridge.z);
    mesh.scale.set(ridge.width, ridge.height, 1);
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  return group;
}

function createMountainSilhouetteTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const context = canvas.getContext('2d');

  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, 'rgba(242, 248, 255, 0)');
  gradient.addColorStop(1, 'rgba(103, 113, 128, 0.95)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, canvas.height);

  context.fillStyle = 'rgba(53, 61, 74, 0.96)';
  context.beginPath();
  context.moveTo(0, canvas.height);
  context.lineTo(90, canvas.height * 0.66);
  context.lineTo(180, canvas.height * 0.78);
  context.lineTo(280, canvas.height * 0.5);
  context.lineTo(410, canvas.height * 0.72);
  context.lineTo(560, canvas.height * 0.42);
  context.lineTo(700, canvas.height * 0.58);
  context.lineTo(820, canvas.height * 0.34);
  context.lineTo(940, canvas.height * 0.6);
  context.lineTo(size, canvas.height);
  context.closePath();
  context.fill();

  context.fillStyle = 'rgba(71, 80, 92, 0.9)';
  context.beginPath();
  context.moveTo(150, canvas.height);
  context.lineTo(280, canvas.height * 0.64);
  context.lineTo(380, canvas.height * 0.74);
  context.lineTo(520, canvas.height * 0.5);
  context.lineTo(660, canvas.height * 0.74);
  context.lineTo(840, canvas.height * 0.58);
  context.lineTo(size, canvas.height);
  context.closePath();
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createHorizonClouds() {
  const group = new THREE.Group();
  group.name = 'HorizonClouds';
  const cloudConfigs = [
    { angle: -82, distance: 10400, altitude: 2750, scale: 1.25 },
    { angle: -50, distance: 12800, altitude: 3120, scale: 1.45 },
    { angle: -15, distance: 11100, altitude: 2580, scale: 1.1 },
    { angle: 20, distance: 13600, altitude: 3010, scale: 1.65 },
    { angle: 58, distance: 11600, altitude: 2710, scale: 1.3 },
    { angle: 96, distance: 14800, altitude: 3320, scale: 1.8 }
  ];

  for (let index = 0; index < cloudConfigs.length; index += 1) {
    const config = cloudConfigs[index];
    const angle = THREE.MathUtils.degToRad(config.angle);
    const cloud = createCloudBillboard({
      width: 1750 * config.scale,
      variant: index,
      opacity: 0.9
    });
    cloud.position.set(
      Math.sin(angle) * config.distance,
      config.altitude,
      -Math.cos(angle) * config.distance
    );
    group.add(cloud);
  }

  return group;
}

function createWindMarkers() {
  const group = new THREE.Group();
  group.name = 'WindDirectionMarkers';
  group.visible = false;
  const material = new THREE.MeshBasicMaterial({
    color: 0xf4fbff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false
  });
  const positions = [
    [-260, -320],
    [0, -360],
    [260, -320],
    [-360, 0],
    [360, 0],
    [-260, 320],
    [0, 360],
    [260, 320]
  ];

  for (const [x, z] of positions) {
    const marker = createWindMarker(material);
    marker.userData.offset = new THREE.Vector3(x, 0, z);
    group.add(marker);
  }

  return group;
}

function createWindMarker(material) {
  const marker = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(2.8, 2.8, 42, 8),
    material
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -12;
  marker.add(shaft);

  const head = new THREE.Mesh(
    new THREE.ConeGeometry(10, 24, 12),
    material
  );
  head.rotation.x = -Math.PI / 2;
  head.position.z = -42;
  marker.add(head);
  marker.scale.setScalar(0.85);
  return marker;
}

function updateWindMarkers(markers, wind, referencePosition, terrain) {
  markers.visible = Boolean(referencePosition);

  for (const marker of markers.children) {
    const offset = marker.userData.offset;
    const x = referencePosition.x + offset.x;
    const z = referencePosition.z + offset.z;
    // Acompanha a altitude do jogador (ex.: subindo na termica), sem afundar no relevo.
    // Fica abaixo da linha do olhar para contrastar com o terreno, nao com o ceu.
    const y = Math.max(terrain.getHeightAt(x, z) + 60, referencePosition.y - 45);
    marker.position.set(x, y, z);
    marker.rotation.y = wind.directionRadians;
  }
}
