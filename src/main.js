import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createCloudBillboard } from './clouds.js';
import { createAdventureMusic, createScoreAudio, createVarioAudio, unlockGameAudio } from './audio.js';
import { createBots } from './bot.js?v=hot-b-1';
import { initializeThirdPersonCamera, setCameraMode, toggleCameraMode, updateFlightCamera, updateStandbyCamera } from './camera.js?v=camera-modes-3';
import { configureWind, createWindVector, detectParagliderCollisions, detectVegetationCollisions, updateEntangledParagliders, updateWind } from './physics.js?v=hot-b-1';
import { createHud, createRoundState, updateHud, updateRoundState } from './hud.js?v=hud-instrument-4';
import { findFlightLocation } from './flightLocations.js';
import { createOrographicLift } from './orographicLift.js';
import { getVehicleProfile, Player } from './player.js?v=hot-b-1';
import { createScoringState, initializeScoringForEntities, updateScoring } from './scoring.js';
import { createTerrain } from './terrain.js?v=terrain-realism-4';
import { createThermalField } from './thermal.js?v=realism-1';
import { createThermalAssistant, updateThermalAssistant } from './thermalAssistant.js?v=2';
import { createVegetation } from './vegetation.js?v=tree-collision-1';
import { createLocationBuilding, updateLocationBuilding } from './buildings.js?v=2';

const canvas = document.querySelector('#game');
const startButton = document.querySelector('#start-flight');
const restartButton = document.querySelector('#restart-game');
const colorInputs = [...document.querySelectorAll('input[name="canopy-color"]')];
const locationInputs = [...document.querySelectorAll('input[name="flight-location"]')];
const vehicleInputs = [...document.querySelectorAll('input[name="vehicle-type"]')];
const scene = new THREE.Scene();
// Perspectiva aerea: nevoa exponencial azulada — o haze cresce suavemente com a
// distancia (como na atmosfera real) ate encobrir o anel de relevo distante
// (~55 km), que substituiu as silhuetas 2D de montanha. Com 0.000029, a 3 km a
// perda e <1%; a 52 km restam ~10% de contraste.
scene.fog = new THREE.FogExp2(0xdceaf5, 0.000029);

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
const locationBuilding = createLocationBuilding();
scene.add(locationBuilding);
scene.add(createHorizonClouds());

const wind = createWindVector();
const windMarkers = createWindMarkers();
scene.add(windMarkers);
const thermals = createThermalField({ scene, terrain, sunDirection: SUN_DIRECTION });
const orographicLift = createOrographicLift();
scene.add(orographicLift.group);
const hud = createHud(document.querySelector('#hud'));
const varioAudio = createVarioAudio();
const scoreAudio = createScoreAudio();
const adventureMusic = createAdventureMusic({ trackUrl: '/assets/audio/adventure-track.mp3' });

const clock = new THREE.Clock();
const standbyPosition = new THREE.Vector3(0, 0, 0);
const appState = {
  started: false,
  player: null,
  bots: [],
  flyers: [],
  round: null,
  scoring: null,
  thermalAssistant: null,
  lastScoreFeedbackAudioId: null,
  starting: false,
  // Modo realista: esconde colunas/rotulos de termica, marcadores de lift e
  // setas de vento; a fisica continua identica.
  assistVisuals: true,
  selectedLocation: getSelectedFlightLocation(),
  selectedVehicleType: getSelectedVehicleType()
};
// Hook de inspecao/testes (ex.: teleportar o piloto em testes automatizados).
window.__appState = appState;

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
  updateVehicleSelectionUi();
}

window.addEventListener('resize', handleResize);
window.visualViewport?.addEventListener('resize', handleResize);
startButton.addEventListener('click', startFlight);
restartButton?.addEventListener('click', restartGame);
for (const input of locationInputs) {
  input.addEventListener('change', () => {
    if (input.checked && !appState.started) {
      applySelectedFlightLocation();
    }
  });
}
setupLayerPanel();
setupCameraToggle();
setupVehicleSelection();

function restartGame() {
  window.location.reload();
}

// Alternancia de camera estilo jogo de corrida: externa <-> visao do piloto.
function setupCameraToggle() {
  const button = document.querySelector('#camera-toggle');

  const applyToggle = () => {
    if (!appState.started) return;
    if (appState.player?.cameraPreference === 'first-person-only') return;
    const mode = toggleCameraMode();
    if (button) {
      button.classList.toggle('is-first-person', mode === 'first-person');
      button.title = mode === 'first-person'
        ? 'Camera: visao do piloto (C alterna)'
        : 'Camera: externa (C alterna)';
    }
  };

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'KeyC' || event.repeat) return;
    applyToggle();
  });

  button?.addEventListener('click', (event) => {
    event.preventDefault();
    applyToggle();
    button.blur();
  });
}

function setupVehicleSelection() {
  for (const input of vehicleInputs) {
    input.addEventListener('change', () => {
      if (!input.checked || appState.started) return;
      appState.selectedVehicleType = input.value;
      updateVehicleSelectionUi();
    });
  }

  updateVehicleSelectionUi();
}

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

  const realisticLabel = document.createElement('label');
  const realisticInput = document.createElement('input');
  realisticInput.type = 'checkbox';
  realisticInput.checked = false;
  realisticInput.addEventListener('change', () => {
    appState.assistVisuals = !realisticInput.checked;
    thermals.setAssistVisuals(appState.assistVisuals);
    orographicLift.setAssistVisuals(appState.assistVisuals);
  });
  realisticLabel.append(realisticInput, document.createTextNode('Modo realista (sem ajudas)'));
  panel.append(realisticLabel);
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
  const selectedVehicleType = getSelectedVehicleType();
  appState.selectedVehicleType = selectedVehicleType;
  const selectedVehicleProfile = getVehicleProfile(selectedVehicleType);
  setCameraMode(selectedVehicleProfile.cameraPreference === 'first-person-only' ? 'first-person' : 'third-person');
  updateVehicleSelectionUi();
  appState.player = new Player({
    terrain,
    canopyColor: selectedColor,
    launchAltitudeMeters: selectedLocation.launchAltitudeMeters,
    launchHeadingRadians: selectedLocation.launchHeadingRadians,
    vehicleType: selectedVehicleType
  });
  // A guia de rota (linha ate o TP e marcadores) acompanha apenas o jogador.
  appState.player.isPlayer = true;
  scene.add(appState.player.group);
  initializeThirdPersonCamera(camera, appState.player, { terrain });

  appState.bots = createBots({ terrain });
  for (const bot of appState.bots) {
    scene.add(bot.group);
  }

  appState.flyers = [appState.player, ...appState.bots];
  appState.scoring = await createScoringState({ scene, terrain });
  initializeScoringForEntities(appState.flyers);
  appState.lastScoreFeedbackAudioId = null;
  appState.round = createRoundState();
  appState.thermalAssistant = createThermalAssistant();
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

function getSelectedVehicleType() {
  return vehicleInputs.find((input) => input.checked)?.value ?? 'paraglider';
}

function applySelectedFlightLocation() {
  const location = getSelectedFlightLocation();
  appState.selectedLocation = location;
  terrain.setCenterCoordinates({
    latitude: location.latitude,
    longitude: location.longitude
  });
  terrain.setSeaEnabled(Boolean(location.hasSea));
  vegetation.reset();
  configureWind(wind, location.wind);
  thermals.setEnabled(location.liftMode !== 'orographic');
  thermals.setCeiling(location.cloudBaseMeters ?? 2200);
  orographicLift.configure(location.orographicLift);
  orographicLift.setAssistVisuals(appState.assistVisuals);
}

function updateVehicleSelectionUi() {
  const vehicleType = appState.player?.vehicleType ?? appState.selectedVehicleType ?? getSelectedVehicleType();
  const vehicleProfile = getVehicleProfile(vehicleType);
  const colorTitle = document.querySelector('[data-start-field="color-title"]');
  const colorOptions = document.querySelector('.color-options');
  const cameraToggle = document.querySelector('#camera-toggle');
  const boostButton = document.querySelector('[data-control="boost"]');
  const touchLabelUp = document.querySelector('[data-touch-label="up"]');
  const touchLabelDown = document.querySelector('[data-touch-label="down"]');
  const shouldHideDroneCameraToggle = vehicleType === 'drone';

  if (colorTitle) {
    colorTitle.textContent = vehicleType === 'drone' ? 'Cor do drone' : 'Cor do parapente';
  }
  if (colorOptions) {
    colorOptions.setAttribute('aria-label', vehicleType === 'drone' ? 'Cor do drone' : 'Cor do parapente');
  }
  document.body.classList.toggle('mobile-paraglider', vehicleType === 'paraglider' && isMobileViewport());
  if (cameraToggle) {
    const firstPersonOnly = vehicleProfile.cameraPreference === 'first-person-only';
    cameraToggle.disabled = firstPersonOnly;
    cameraToggle.hidden = shouldHideDroneCameraToggle;
    cameraToggle.title = firstPersonOnly
      ? 'Drone com camera fixa em primeira pessoa'
      : 'Camera: externa (C alterna)';
    cameraToggle.setAttribute(
      'aria-label',
      firstPersonOnly ? 'Drone com camera fixa em primeira pessoa' : 'Alternar camera externa/visao do piloto'
    );
  }
  if (touchLabelUp) {
    touchLabelUp.textContent = 'Sobe';
  }
  if (touchLabelDown) {
    touchLabelDown.textContent = 'Desce';
  }
  if (boostButton) {
    boostButton.hidden = vehicleType !== 'drone';
    boostButton.setAttribute('aria-label', 'Boost de velocidade');
    boostButton.title = vehicleType === 'drone'
      ? 'Boost de velocidade (Espaco)'
      : 'Reservado ao drone';
    boostButton.textContent = vehicleType === 'drone' ? 'SPD' : '⏭';
  }
}

renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 0.05);
  const referencePosition = appState.player?.position ?? standbyPosition;
  terrain.update(referencePosition, delta);
  vegetation.update(referencePosition);
  updateLocationBuilding(locationBuilding, appState.selectedLocation, terrain);
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

  if (!round.ended || round.endReason === 'landed' || round.endReason === 'crashed') {
    for (const bot of bots) {
      bot.update(delta, { terrain, thermals, orographicLift, wind });
    }

    detectParagliderCollisions(flyers);
    detectVegetationCollisions(flyers, vegetation, terrain);
  }

  updateEntangledParagliders(flyers, delta, { terrain, wind });
  if (!round.ended) {
    updateScoring(appState.scoring, delta, flyers, { thermals, terrain });
  }

  updateRoundState(round, delta, player);
  document.body.classList.toggle('round-ended', round.ended);
  if (round.ended) adventureMusic.stop();
  playScoreFeedbackAudio(player);
  varioAudio.update(delta, player.verticalSpeed, player.landed || round.ended);
  updateThermalAssistant(appState.thermalAssistant, delta, player, {
    thermals,
    // Segue o toggle "Modo realista": com ajudas aponta o nucleo real;
    // sem ajudas estima o centro so pelos dados do vario.
    useRealCore: appState.assistVisuals
  });
  updateHud(hud, {
    player,
    bots,
    terrain,
    round,
    wind,
    scoring: appState.scoring,
    thermalAssistant: appState.thermalAssistant
  });
  updateFlightCamera(camera, player, delta, { terrain });

  renderer.render(scene, camera);
});

function playScoreFeedbackAudio(player) {
  const feedback = player.scoreFeedback;
  if (!feedback || feedback.id === appState.lastScoreFeedbackAudioId) return;

  appState.lastScoreFeedbackAudioId = feedback.id;
  scoreAudio.play();
}

function getRendererPixelRatio() {
  const { width } = getViewportSize();
  const isCompactScreen = width <= 760;
  const maxPixelRatio = isCompactScreen ? 1.35 : 2;
  return Math.min(window.devicePixelRatio || 1, maxPixelRatio);
}

function isMobileViewport() {
  return getViewportSize().width <= 640;
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
    { angle: -82, distance: 20400, altitude: 2750, scale: 2.2 },
    { angle: -50, distance: 24800, altitude: 3120, scale: 2.6 },
    { angle: -15, distance: 21600, altitude: 2580, scale: 2.0 },
    { angle: 20, distance: 26400, altitude: 3010, scale: 3.0 },
    { angle: 58, distance: 22800, altitude: 2710, scale: 2.35 },
    { angle: 96, distance: 28000, altitude: 3320, scale: 3.2 }
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
  markers.visible = Boolean(referencePosition) && appState.assistVisuals;
  if (!markers.visible) return;

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
