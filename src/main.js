import * as THREE from 'three';
import { createAdventureMusic, createVarioAudio, unlockGameAudio } from './audio.js';
import { createBots } from './bot.js?v=wind-physics-1';
import { initializeThirdPersonCamera, updateStandbyCamera, updateThirdPersonCamera } from './camera.js';
import { createWindVector, detectParagliderCollisions, updateEntangledParagliders, updateWind } from './physics.js?v=wind-physics-1';
import { createHud, createRoundState, updateHud, updateRoundState } from './hud.js?v=wind-physics-1';
import { Player } from './player.js?v=wind-physics-1';
import { createTerrain } from './terrain.js?v=terrain-rgb-binary-5';
import { createThermalField } from './thermal.js?v=thermal-drift-1';

const canvas = document.querySelector('#game');
const startButton = document.querySelector('#start-flight');
const colorInputs = [...document.querySelectorAll('input[name="canopy-color"]')];
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc7e8);
scene.fog = new THREE.Fog(0x8fc7e8, 3000, 28000);

const viewport = getViewportSize();
const camera = new THREE.PerspectiveCamera(getCameraFov(viewport), viewport.width / viewport.height, 0.1, 90000);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(getRendererPixelRatio());
renderer.setSize(viewport.width, viewport.height);
setAppHeight();

const ambientLight = new THREE.HemisphereLight(0xdfefff, 0x40563a, 1.85);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff8e8, 2.85);
sunLight.position.set(-220, 520, 180);
scene.add(sunLight);

const terrain = createTerrain();
scene.add(terrain.mesh);
scene.add(createHorizonClouds());

const wind = createWindVector();
const windMarkers = createWindMarkers();
scene.add(windMarkers);
const thermals = createThermalField({ scene, terrain });
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
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.72,
    depthWrite: false
  });
  const geometry = new THREE.SphereGeometry(1, 16, 10);
  const cloudConfigs = [
    { angle: -72, distance: 9800, altitude: 2750, scale: 1.1 },
    { angle: -38, distance: 12500, altitude: 3100, scale: 1.4 },
    { angle: -8, distance: 10800, altitude: 2550, scale: 1.0 },
    { angle: 29, distance: 13200, altitude: 2950, scale: 1.55 },
    { angle: 63, distance: 11200, altitude: 2650, scale: 1.2 },
    { angle: 101, distance: 14500, altitude: 3300, scale: 1.65 }
  ];

  for (const config of cloudConfigs) {
    const angle = THREE.MathUtils.degToRad(config.angle);
    const cloud = createCloudCluster(geometry, material, 360 * config.scale);
    cloud.position.set(
      Math.sin(angle) * config.distance,
      config.altitude,
      -Math.cos(angle) * config.distance
    );
    cloud.rotation.y = angle;
    group.add(cloud);
  }

  return group;
}

function createCloudCluster(geometry, material, radius) {
  const cloud = new THREE.Group();
  const puffs = [
    { x: 0, z: 0, sx: 1.0, sy: 0.22, sz: 0.36 },
    { x: -0.56, z: 0.03, sx: 0.58, sy: 0.18, sz: 0.3 },
    { x: 0.58, z: -0.02, sx: 0.66, sy: 0.2, sz: 0.32 },
    { x: 0.08, z: 0.28, sx: 0.5, sy: 0.16, sz: 0.26 },
    { x: -0.12, z: -0.34, sx: 0.7, sy: 0.17, sz: 0.28 }
  ];

  for (const puff of puffs) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(puff.x * radius, 0, puff.z * radius);
    mesh.scale.set(puff.sx * radius, puff.sy * radius, puff.sz * radius);
    cloud.add(mesh);
  }

  return cloud;
}

function createWindMarkers() {
  const group = new THREE.Group();
  group.name = 'WindDirectionMarkers';
  group.visible = false;
  const material = new THREE.MeshBasicMaterial({
    color: 0xd8fbff,
    transparent: true,
    opacity: 0.68,
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
  marker.scale.setScalar(1.15);
  return marker;
}

function updateWindMarkers(markers, wind, referencePosition, terrain) {
  markers.visible = Boolean(referencePosition);

  for (const marker of markers.children) {
    const offset = marker.userData.offset;
    const x = referencePosition.x + offset.x;
    const z = referencePosition.z + offset.z;
    marker.position.set(x, terrain.getHeightAt(x, z) + 95, z);
    marker.rotation.y = wind.directionRadians;
  }
}
