import * as THREE from 'three';
import { createVarioAudio } from './audio.js';
import { createBots } from './bot.js';
import { initializeThirdPersonCamera, updateThirdPersonCamera } from './camera.js';
import { createWindVector, detectParagliderCollisions, updateEntangledParagliders } from './physics.js';
import { createHud, createRoundState, updateHud, updateRoundState } from './hud.js';
import { Player } from './player.js';
import { createTerrain } from './terrain.js';
import { createThermalField } from './thermal.js';

const canvas = document.querySelector('#game');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc7e8);
scene.fog = new THREE.Fog(0x8fc7e8, 3000, 28000);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 90000);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const ambientLight = new THREE.HemisphereLight(0xdfefff, 0x40563a, 1.85);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff8e8, 2.85);
sunLight.position.set(-220, 520, 180);
scene.add(sunLight);

const terrain = createTerrain();
scene.add(terrain.mesh);

const player = new Player({ terrain });
scene.add(player.group);
initializeThirdPersonCamera(camera, player);
const bots = createBots({ terrain });
const flyers = [player, ...bots];

for (const bot of bots) {
  scene.add(bot.group);
}

const wind = createWindVector();
const thermals = createThermalField({ scene, terrain });
const hud = createHud(document.querySelector('#hud'));
const round = createRoundState();
const varioAudio = createVarioAudio();

const clock = new THREE.Clock();

function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', handleResize);

renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 0.05);
  terrain.update(player.position);
  thermals.update(delta, wind);

  if (!round.ended) {
    player.update(delta, { terrain, thermals, wind });

    for (const bot of bots) {
      bot.update(delta, { terrain, thermals, wind });
    }

    detectParagliderCollisions(flyers);
  }

  updateEntangledParagliders(flyers, delta, { terrain, wind });

  updateRoundState(round, delta, player);
  varioAudio.update(delta, player.verticalSpeed, player.landed || round.ended);
  updateHud(hud, { player, bots, terrain, round });
  updateThirdPersonCamera(camera, player, delta);

  renderer.render(scene, camera);
});
