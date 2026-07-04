import * as THREE from 'three';
import { createAdventureMusic, createVarioAudio } from './audio.js';
import { createBots } from './bot.js';
import { initializeThirdPersonCamera, updateThirdPersonCamera } from './camera.js';
import { createWindVector, detectParagliderCollisions, updateEntangledParagliders } from './physics.js';
import { createHud, createRoundState, updateHud, updateRoundState } from './hud.js';
import { Player } from './player.js';
import { createTerrain } from './terrain.js';
import { createThermalField } from './thermal.js';

const canvas = document.querySelector('#game');
const startButton = document.querySelector('#start-flight');
const colorInputs = [...document.querySelectorAll('input[name="canopy-color"]')];
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc7e8);
scene.fog = new THREE.Fog(0x8fc7e8, 3000, 28000);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 90000);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(getRendererPixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
setAppHeight();

const ambientLight = new THREE.HemisphereLight(0xdfefff, 0x40563a, 1.85);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff8e8, 2.85);
sunLight.position.set(-220, 520, 180);
scene.add(sunLight);

const terrain = createTerrain();
scene.add(terrain.mesh);

const wind = createWindVector();
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
  setAppHeight();
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(getRendererPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', handleResize);
window.visualViewport?.addEventListener('resize', handleResize);
startButton.addEventListener('click', startFlight);

function startFlight() {
  if (appState.started) return;

  const selectedColor = Number.parseInt(
    colorInputs.find((input) => input.checked)?.value ?? '0xa8dff2',
    16
  );

  appState.player = new Player({ terrain, canopyColor: selectedColor });
  scene.add(appState.player.group);
  initializeThirdPersonCamera(camera, appState.player);

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

  if (!appState.started) {
    thermals.update(delta, wind);
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
  updateHud(hud, { player, bots, terrain, round });
  updateThirdPersonCamera(camera, player, delta);

  renderer.render(scene, camera);
});

function getRendererPixelRatio() {
  const isCompactScreen = window.matchMedia('(max-width: 760px)').matches;
  const maxPixelRatio = isCompactScreen ? 1.35 : 2;
  return Math.min(window.devicePixelRatio || 1, maxPixelRatio);
}

function setAppHeight() {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${height}px`);
}
