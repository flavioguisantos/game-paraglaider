import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createCloudBillboard } from './clouds.js';
import { createAdventureMusic, createVarioAudio, unlockGameAudio } from './audio.js';
import { createBots } from './bot.js?v=wind-physics-1';
import { initializeThirdPersonCamera, updateStandbyCamera, updateThirdPersonCamera } from './camera.js';
import { createWindVector, detectParagliderCollisions, updateEntangledParagliders, updateWind } from './physics.js?v=wind-physics-1';
import { createHud, createRoundState, updateHud, updateRoundState } from './hud.js?v=wind-physics-1';
import { Player } from './player.js?v=wind-physics-1';
import { createTerrain } from './terrain.js?v=vector-realism-1';
import { createThermalField } from './thermal.js?v=thermal-drift-1';
import { createVegetation } from './vegetation.js';

const canvas = document.querySelector('#game');
const startButton = document.querySelector('#start-flight');
const colorInputs = [...document.querySelectorAll('input[name="canopy-color"]')];
const scene = new THREE.Scene();
// Perspectiva aerea: nevoa azulada/dessaturada aproximando a cor do horizonte do ceu fisico.
scene.fog = new THREE.Fog(0xc3d9e8, 3500, 26000);

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
  uniforms.turbidity.value = 5.5;
  uniforms.rayleigh.value = 1.9;
  uniforms.mieCoefficient.value = 0.0045;
  uniforms.mieDirectionalG.value = 0.8;
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
scene.add(createHorizonClouds());

const wind = createWindVector();
const windMarkers = createWindMarkers();
scene.add(windMarkers);
const thermals = createThermalField({ scene, terrain, sunDirection: SUN_DIRECTION });
const hud = createHud(document.querySelector('#hud'));
const varioAudio = createVarioAudio();
const adventureMusic = createAdventureMusic();

const clock = new THREE.Clock();
const standbyPosition = new THREE.Vector3(0, 0, 0);
const appState = {
  started: false,
  player: null,
  bots: [],
  flyers: [],
  round: null
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

function startFlight() {
  if (appState.started) return;

  varioAudio.unlock();
  unlockGameAudio();

  const selectedColor = Number.parseInt(
    colorInputs.find((input) => input.checked)?.value ?? '0xa8dff2',
    16
  );

  appState.player = new Player({ terrain, canopyColor: selectedColor });
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
}

renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 0.05);
  const referencePosition = appState.player?.position ?? standbyPosition;
  terrain.update(referencePosition);
  vegetation.update(referencePosition);
  updateSunLight(referencePosition);
  updateWind(wind, delta);
  updateWindMarkers(windMarkers, wind, referencePosition, terrain);

  if (!appState.started) {
    thermals.update(delta, wind);
    updateStandbyCamera(camera, terrain, delta);
    renderer.render(scene, camera);
    return;
  }

  const { player, bots, flyers, round } = appState;
  thermals.update(delta, wind, player);

  if (!round.ended) {
    player.update(delta, { terrain, thermals, wind });
  }

  if (!round.ended || round.endReason === 'landed') {
    for (const bot of bots) {
      bot.update(delta, { terrain, thermals, wind });
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

function createHorizonClouds() {
  const group = new THREE.Group();
  group.name = 'HorizonClouds';
  const cloudConfigs = [
    { angle: -72, distance: 9800, altitude: 2750, scale: 1.1 },
    { angle: -38, distance: 12500, altitude: 3100, scale: 1.4 },
    { angle: -8, distance: 10800, altitude: 2550, scale: 1.0 },
    { angle: 29, distance: 13200, altitude: 2950, scale: 1.55 },
    { angle: 63, distance: 11200, altitude: 2650, scale: 1.2 },
    { angle: 101, distance: 14500, altitude: 3300, scale: 1.65 }
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
