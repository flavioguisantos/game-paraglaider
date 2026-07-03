import * as THREE from 'three';
import { createVarioAudio } from './audio.js';
import { createBots } from './bot.js';
import { initializeThirdPersonCamera, updateThirdPersonCamera } from './camera.js';
import { createWindVector } from './physics.js';
import { createHud, createRoundState, updateHud, updateRoundState } from './hud.js';
import { Player } from './player.js';
import { createTerrain } from './terrain.js';
import { createThermalField } from './thermal.js';

const canvas = document.querySelector('#game');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc7e8);
scene.fog = new THREE.Fog(0x8fc7e8, 90, 260);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const ambientLight = new THREE.HemisphereLight(0xdff5ff, 0x4f6b42, 2.2);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 2.4);
sunLight.position.set(30, 60, 20);
scene.add(sunLight);

const terrain = createTerrain();
scene.add(terrain.mesh);

const grid = new THREE.GridHelper(terrain.size, 24, 0xffffff, 0x2f5d35);
grid.material.opacity = 0.25;
grid.material.transparent = true;
grid.position.y = 0.08;
scene.add(grid);

const player = new Player({ terrain });
scene.add(player.group);
initializeThirdPersonCamera(camera, player);
const bots = createBots({ terrain });

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
  thermals.update(delta, wind);

  if (!round.ended) {
    player.update(delta, { terrain, thermals, wind });

    for (const bot of bots) {
      bot.update(delta, { terrain, thermals, wind });
    }
  }

  updateRoundState(round, delta, player);
  varioAudio.update(delta, player.verticalSpeed, player.landed || round.ended);
  updateHud(hud, { player, bots, terrain, round });
  updateThirdPersonCamera(camera, player, delta);

  renderer.render(scene, camera);
});
