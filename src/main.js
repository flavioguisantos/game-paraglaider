import * as THREE from 'three';
import { createCloudBillboard } from './clouds.js';
import { createAdventureMusic, createScoreAudio, createVarioAudio, unlockGameAudio } from './audio.js';
import { createBots } from './bot.js?v=hot-b-4';
import { initializeThirdPersonCamera, setCameraMode, toggleCameraMode, updateFlightCamera, updateStandbyCamera } from './camera.js?v=camera-modes-7';
import { configureWind, createWindVector, detectParagliderCollisions, detectVegetationCollisions, updateEntangledParagliders, updateWind } from './physics.js?v=hot-b-1';
import { createHud, createRoundState, updateHud, updateRoundState } from './hud.js?v=hud-instrument-5';
import { findFlightLocation, getFlightLocations, setFlightLocations } from './flightLocations.js';
import {
  ensureGuestPlayerIdentity,
  fetchGameRuntimeConfig,
  fetchLaunches,
  fetchLaunchSession,
  fetchMatchCount,
  joinLaunchSession,
  leaveLaunchSession,
  postPlayerResult,
  readStoredPilotDisplayName,
  registerStartedMatch
} from './gameApi.js';
import { createGameRealtimeClient } from './gameRealtimeClient.js';
import { createOrographicLift } from './orographicLift.js';
import { getVehicleProfile, Player } from './player.js?v=fp-cam-6';
import { createRadioVoiceClient } from './radioVoiceClient.js';
import { createInitialRadioState, RADIO_CHANNEL_STATUS, RADIO_CLIENT_STATUS, reduceRadioState } from './radioState.js';
import { RemotePlayer } from './remotePlayer.js';
import { createCelebration, createFlightStats, updateFlightStats } from './celebration.js';
import { createScoringState, initializeScoringForEntities, updateScoring } from './scoring.js';
import { createTerrain } from './terrain.js?v=terrain-realism-4';
import { createThermalField } from './thermal.js?v=realism-1';
import { createThermalAssistant, updateThermalAssistant } from './thermalAssistant.js?v=2';
import { createVegetation } from './vegetation.js?v=tree-collision-1';
import { createLocationBuilding, updateLocationBuilding } from './buildings.js?v=2';

const canvas = document.querySelector('#game');
const startButton = document.querySelector('#start-flight');
const restartButton = document.querySelector('#restart-game');
const totalMatchesElements = [...document.querySelectorAll('[data-total-matches]')];
const launchPresenceElements = [...document.querySelectorAll('[data-launch-presence]')];
const launchStatusElements = [...document.querySelectorAll('[data-launch-status]')];
const launchOptionsRoot = document.querySelector('[data-launch-options]');
const pilotNameInput = document.querySelector('#pilot-name');
const colorInputs = [...document.querySelectorAll('input[name="canopy-color"]')];
const vehicleInputs = [...document.querySelectorAll('input[name="vehicle-type"]')];
const touchRadioRoot = document.querySelector('[data-touch-radio]');
const touchRadioKnob = document.querySelector('[data-touch-radio-knob]');
const touchRadioLabel = document.querySelector('[data-touch-radio-label]');
let touchRadioPointerId = null;
const scene = new THREE.Scene();
const SKY_BLUE = 0x77bdf0;
scene.background = new THREE.Color(SKY_BLUE);
// Perspectiva aerea: nevoa exponencial azulada — o haze cresce suavemente com a
// distancia (como na atmosfera real) ate encobrir o anel de relevo distante
// (~55 km), que substituiu as silhuetas 2D de montanha. Com 0.000029, a 3 km a
// perda e <1%; a 52 km restam ~10% de contraste.
scene.fog = new THREE.FogExp2(0xc9e2f6, 0.000029);

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
renderer.setClearColor(SKY_BLUE, 1);
setAppHeight();

const ambientLight = new THREE.HemisphereLight(0xdfefff, 0x40563a, 1.15);
scene.add(ambientLight);

// Direcao fixa do sol; a posicao da luz acompanha o jogador para manter o frustum de sombra util.
const SUN_DIRECTION = new THREE.Vector3(-220, 520, -180).normalize();
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
  sunVisual.position.copy(SUN_DIRECTION).multiplyScalar(76000).add(referencePosition);
}

const sky = createAtmosphericSky();
scene.add(sky);
const sunVisual = createSunVisual();
scene.add(sunVisual);
applySkyEnvironment();

function createAtmosphericSky() {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x63b5f2) },
        horizonColor: { value: new THREE.Color(0xe6f7ff) },
        lowerColor: { value: new THREE.Color(0xb8ddf4) },
        sunDirection: { value: SUN_DIRECTION.clone() }
      },
      vertexShader: `
        varying vec3 vSkyDirection;

        void main() {
          vSkyDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 lowerColor;
        uniform vec3 sunDirection;
        varying vec3 vSkyDirection;

        void main() {
          float height = clamp(vSkyDirection.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 skyColor = mix(lowerColor, horizonColor, smoothstep(0.0, 0.46, height));
          skyColor = mix(skyColor, topColor, smoothstep(0.38, 1.0, height));

          float sunAmount = max(dot(normalize(vSkyDirection), normalize(sunDirection)), 0.0);
          float sunHalo = pow(sunAmount, 24.0) * 0.34 + pow(sunAmount, 160.0) * 0.42;
          skyColor = mix(skyColor, vec3(1.0, 0.93, 0.64), clamp(sunHalo, 0.0, 0.65));

          gl_FragColor = vec4(skyColor, 1.0);
        }
      `
    })
  );
  sky.name = 'AtmosphericSky';
  // Mantem a cupula do ceu dentro do far plane da camera (90000).
  sky.scale.setScalar(80000);
  sky.renderOrder = -100;
  return sky;
}

function createSunVisual() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const center = size / 2;
  const glow = context.createRadialGradient(center, center, 0, center, center, center);
  glow.addColorStop(0, 'rgba(255, 255, 245, 1)');
  glow.addColorStop(0.16, 'rgba(255, 244, 184, 0.98)');
  glow.addColorStop(0.34, 'rgba(255, 218, 92, 0.48)');
  glow.addColorStop(1, 'rgba(255, 218, 92, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    depthTest: false
  }));
  sprite.name = 'SunVisual';
  sprite.scale.set(3600, 3600, 1);
  sprite.renderOrder = -1;
  sprite.position.copy(SUN_DIRECTION).multiplyScalar(76000);
  return sprite;
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
const celebration = createCelebration();
const varioAudio = createVarioAudio();
const scoreAudio = createScoreAudio();
const adventureMusic = createAdventureMusic({ trackUrl: '/assets/audio/adventure-track.mp3' });

const clock = new THREE.Clock();
const standbyPosition = new THREE.Vector3(0, 0, 0);
const radioVoiceClient = createRadioVoiceClient({
  onDebugEvent(type, details = {}) {
    recordRadioDebugEvent(type, details);
  },
  onError(error) {
    console.warn('Falha no cliente de radio por voz.', error);
    recordRadioDebugEvent('voice_client_error', {
      message: error?.message ?? String(error)
    });
  }
});
const realtimeClient = createGameRealtimeClient({
  onSessionMessage: handleRealtimeSessionMessage,
  onOpen() {
    updateRadioState({ type: 'socket_connected' });
  },
  onClose() {
    radioVoiceClient.stopBroadcast();
    radioVoiceClient.stopListening();
    adventureMusic.setDuckFactor(1);
    updateRadioState({ type: 'socket_disconnected' });
  },
  onError(error) {
    console.warn('Falha no canal realtime do jogo.', error);
  }
});
const appState = {
  started: false,
  player: null,
  bots: [],
  flyers: [],
  round: null,
  scoring: null,
  thermalAssistant: null,
  flightStats: null,
  golCelebrated: false,
  lastScoreFeedbackAudioId: null,
  starting: false,
  // Modo realista: esconde colunas/rotulos de termica, marcadores de lift e
  // setas de vento; a fisica continua identica.
  assistVisuals: true,
  selectedLocation: getSelectedFlightLocation(),
  selectedVehicleType: getSelectedVehicleType(),
  totalMatches: null,
  launchCatalogLoaded: false,
  launchSession: null,
  launchPresenceCount: 0,
  launchStatusLabel: 'Offline',
  guestIdentity: null,
  remotePlayers: new Map(),
  remoteRanking: [],
  radioEnabled: false,
  radio: createInitialRadioState(),
  lastRealtimeStateAtMs: 0,
  lastRealtimeResultSent: false
};
// Hook de inspecao/testes (ex.: teleportar o piloto em testes automatizados).
window.__appState = appState;
window.__radioDebug = window.__radioDebug ?? { events: [], counts: {} };

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
startButton.disabled = true;
startButton.addEventListener('click', startFlight);
restartButton?.addEventListener('click', restartGame);
window.addEventListener('beforeunload', () => {
  void disconnectRealtimeAndSession();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    endRadioTransmission('visibility_hidden');
  }
});
window.addEventListener('offline', () => {
  endRadioTransmission('network_offline');
});
setupLayerPanel();
setupCameraToggle();
setupVehicleSelection();
setupRadioControls();
void initializeGameFront();

function restartGame() {
  void disconnectRealtimeAndSession();
  window.location.reload();
}

async function initializeGameFront() {
  try {
    if (pilotNameInput) pilotNameInput.value = readStoredPilotDisplayName();

    await Promise.all([
      loadRuntimeConfig(),
      loadMatchCount(),
      loadLaunchCatalog()
    ]);
    await refreshSelectedLaunchSession();
  } finally {
    startButton.disabled = false;
  }
}

async function loadLaunchCatalog() {
  try {
    const launches = await fetchLaunches();
    setFlightLocations(launches);
    renderLaunchOptions(getFlightLocations());
    appState.selectedLocation = getSelectedFlightLocation();
    appState.launchCatalogLoaded = true;
    applySelectedFlightLocation();
  } catch (error) {
    console.warn('Nao foi possivel carregar o catalogo de rampas da API; usando fallback local.', error);
    renderLaunchOptions(getFlightLocations());
    appState.selectedLocation = getSelectedFlightLocation();
  }
}

async function loadRuntimeConfig() {
  try {
    const runtimeConfig = await fetchGameRuntimeConfig();
    appState.radioEnabled = Boolean(runtimeConfig.radioEnabled);
    if (Array.isArray(runtimeConfig.iceServers) && runtimeConfig.iceServers.length) {
      window.__GAME_WEBRTC_ICE_SERVERS = runtimeConfig.iceServers;
    }
  } catch (error) {
    console.warn('Nao foi possivel carregar a configuracao runtime do jogo.', error);
    appState.radioEnabled = false;
  }
}

function renderLaunchOptions(locations) {
  if (!launchOptionsRoot) return;

  launchOptionsRoot.innerHTML = '';
  const selectedId = appState.selectedLocation?.id ?? locations[0]?.id;

  for (const location of locations) {
    const label = document.createElement('label');
    label.className = 'location-option';
    label.innerHTML = `
      <input type="radio" name="flight-location" value="${location.id}">
      <strong>${location.name}</strong>
      <span>${location.region}</span>
    `;
    const input = label.querySelector('input');
    input.checked = location.id === selectedId;
    input.addEventListener('change', () => {
      if (!input.checked || appState.started) return;
      appState.selectedLocation = getSelectedFlightLocation();
      applySelectedFlightLocation();
      void refreshSelectedLaunchSession();
    });
    launchOptionsRoot.append(label);
  }
}

async function refreshSelectedLaunchSession() {
  const location = getSelectedFlightLocation();
  if (!location?.launchId && !location?.id) return;

  try {
    const bundle = await fetchLaunchSession(location.launchId ?? location.id);
    applyLaunchSessionBundle(bundle);
  } catch (error) {
    console.warn('Nao foi possivel carregar a sessao ativa da rampa.', error);
    applyLaunchSessionBundle(null);
  }
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
  const displayName = getValidatedPilotDisplayName();
  if (!displayName) return;

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
  try {
    appState.guestIdentity = await ensureGuestPlayerIdentity({
      displayName,
      preferredVehicleType: selectedVehicleType
    });
  } catch (error) {
    console.warn('Nao foi possivel emitir a identidade guest do jogador.', error);
    appState.starting = false;
    startButton.disabled = false;
    return;
  }
  const joinedSession = await ensureSelectedLaunchSession({
    vehicleType: selectedVehicleType,
    canopyColor: `#${selectedColor.toString(16).padStart(6, '0')}`
  });
  if (joinedSession?.session) {
    applyLaunchSessionBundle(joinedSession);
  }
  applySelectedFlightLocation();
  const selectedVehicleProfile = getVehicleProfile(selectedVehicleType);
  setCameraMode(selectedVehicleProfile.cameraPreference === 'first-person-only' ? 'first-person' : 'third-person');
  updateVehicleSelectionUi();
  appState.player = new Player({
    terrain,
    canopyColor: selectedColor,
    launchAltitudeMeters: selectedLocation.launchAltitudeMeters,
    launchHeadingRadians: selectedLocation.launchHeadingRadians,
    vehicleType: selectedVehicleType,
    displayName: appState.guestIdentity.displayName
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
  appState.scoring = await createScoringState({
    scene,
    terrain,
    routeDefinition: appState.launchSession?.route ?? null
  });
  initializeScoringForEntities(appState.flyers);
  appState.lastScoreFeedbackAudioId = null;
  appState.round = createRoundState();
  appState.round.totalMatches = appState.totalMatches;
  appState.round.remoteRanking = appState.remoteRanking;
  appState.thermalAssistant = createThermalAssistant();
  appState.flightStats = createFlightStats();
  appState.golCelebrated = false;
  appState.lastRealtimeResultSent = false;
  celebration.hide();
  clearRemotePlayers();
  appState.started = true;
  void updateGlobalMatchCounterOnStart();
  connectSelectedLaunchRealtime({
    vehicleType: selectedVehicleType,
    canopyColor: `#${selectedColor.toString(16).padStart(6, '0')}`
  });
  document.body.classList.add('is-flying');
  document.body.classList.remove('round-ended');
  adventureMusic.start();
  clock.start();
  appState.starting = false;
  startButton.disabled = false;
}

function getSelectedFlightLocation() {
  const selectedLocationId = getLocationInputs().find((input) => input.checked)?.value;
  return findFlightLocation(selectedLocationId);
}

function getSelectedVehicleType() {
  return vehicleInputs.find((input) => input.checked)?.value ?? 'paraglider';
}

function getValidatedPilotDisplayName() {
  if (!pilotNameInput) return 'Piloto';
  pilotNameInput.value = pilotNameInput.value.replace(/\s+/g, ' ').trim().slice(0, 24);
  if (pilotNameInput.value) return pilotNameInput.value;
  pilotNameInput.reportValidity();
  pilotNameInput.focus();
  return '';
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
  configureWind(wind, buildWindConfig(location, appState.launchSession));
  thermals.setEnabled(resolveThermalsEnabled(location, appState.launchSession));
  thermals.setCeiling(appState.launchSession?.thermals?.cloudBaseMeters ?? location.cloudBaseMeters ?? 2200);
  thermals.applySessionThermals(appState.launchSession?.thermals ?? null);
  orographicLift.configure(location.orographicLift);
  orographicLift.setAssistVisuals(appState.assistVisuals);
}

function getLocationInputs() {
  return [...document.querySelectorAll('input[name="flight-location"]')];
}

function applyLaunchSessionBundle(bundle) {
  appState.launchSession = bundle?.session ?? null;
  appState.launchPresenceCount = Number(bundle?.session?.playerCount ?? 0);
  appState.launchStatusLabel = getLaunchStatusLabel(bundle?.session?.status);
  appState.remoteRanking = bundle?.session?.ranking ?? [];
  syncRadioSession(bundle?.session ?? null);
  updateLaunchSessionUi();
}

function updateLaunchSessionUi() {
  const presence = `${appState.launchPresenceCount}`;
  for (const element of launchPresenceElements) {
    element.textContent = presence;
  }
  for (const element of launchStatusElements) {
    element.textContent = appState.launchStatusLabel;
  }
}

function getLaunchStatusLabel(status) {
  switch (status) {
    case 'active':
      return 'Sessao ativa';
    case 'waiting':
      return 'Aguardando';
    case 'paused':
      return 'Pausada';
    case 'ended':
      return 'Encerrada';
    default:
      return 'Offline';
  }
}

async function loadMatchCount() {
  try {
    const counter = await fetchMatchCount();
    setGlobalMatchCount(counter.totalMatches);
  } catch (error) {
    console.warn('Nao foi possivel carregar o contador global de partidas.', error);
    setGlobalMatchCount(null);
  }
}

async function updateGlobalMatchCounterOnStart() {
  try {
    const counter = await registerStartedMatch();
    setGlobalMatchCount(counter.totalMatches);
  } catch (error) {
    console.warn('Nao foi possivel registrar a partida iniciada.', error);
  }
}

function setGlobalMatchCount(totalMatches) {
  appState.totalMatches = Number.isFinite(totalMatches) ? totalMatches : null;
  if (appState.round) {
    appState.round.totalMatches = appState.totalMatches;
  }

  const label = formatGlobalMatchCount(appState.totalMatches);
  for (const element of totalMatchesElements) {
    element.textContent = label;
  }
}

function formatGlobalMatchCount(totalMatches) {
  if (!Number.isFinite(totalMatches)) return '--';
  return Math.round(totalMatches).toLocaleString('pt-BR');
}

async function ensureSelectedLaunchSession({ vehicleType, canopyColor }) {
  const launchId = appState.selectedLocation?.launchId ?? appState.selectedLocation?.id;
  if (!launchId || !appState.guestIdentity) return null;

  try {
    return await joinLaunchSession(launchId, appState.guestIdentity, {
      displayName: appState.guestIdentity.displayName,
      vehicleType,
      canopyColor,
      status: 'connected'
    });
  } catch (error) {
    console.warn('Nao foi possivel entrar na sessao da rampa.', error);
    return null;
  }
}

function connectSelectedLaunchRealtime({ vehicleType, canopyColor }) {
  const launchId = appState.selectedLocation?.launchId ?? appState.selectedLocation?.id;
  if (!launchId || !appState.guestIdentity) return;

  try {
    radioVoiceClient.setIdentity(appState.guestIdentity);
    radioVoiceClient.setLaunchId(launchId);
    updateRadioState({
      type: 'session_joined',
      launchId,
      playerId: appState.guestIdentity.playerId
    });
    realtimeClient.connect({
      launchId,
      playerIdentity: appState.guestIdentity,
      player: {
        displayName: appState.guestIdentity.displayName,
        vehicleType,
        canopyColor,
        status: 'connected'
      }
    });
  } catch (error) {
    console.warn('Nao foi possivel conectar o canal realtime da rampa.', error);
  }
}

async function disconnectRealtimeAndSession() {
  endRadioTransmission('session_left');
  const launchId = appState.selectedLocation?.launchId ?? appState.selectedLocation?.id;
  if (launchId && appState.guestIdentity) {
    try {
      await leaveLaunchSession(launchId, appState.guestIdentity);
    } catch {}
  }
  realtimeClient.disconnect({ notifyLeave: false });
  radioVoiceClient.dispose();
  updateRadioState({ type: 'session_left' });
}

function handleRealtimeSessionMessage(message) {
  if (!message) return;

  if (message.type?.startsWith('radio_')) {
    handleRadioRealtimeMessage(message);
  }

  if (!message.session) return;
  applyLaunchSessionBundle({ session: message.session });
  if (appState.round) {
    appState.round.remoteRanking = message.session.ranking ?? [];
  }
  syncRemotePlayers(message.session.players ?? []);
}

function syncRemotePlayers(players) {
  const seen = new Set();

  for (const player of players) {
    if (!player?.playerId || player.playerId === appState.guestIdentity?.playerId) continue;
    if (player.status === 'disconnected') continue;
    seen.add(player.playerId);
    let remotePlayer = appState.remotePlayers.get(player.playerId);
    if (!remotePlayer) {
      remotePlayer = new RemotePlayer({
        playerId: player.playerId,
        displayName: player.displayName,
        vehicleType: player.vehicleType,
        canopyColor: player.canopyColor,
        terrain
      });
      appState.remotePlayers.set(player.playerId, remotePlayer);
      scene.add(remotePlayer.group);
    }
    remotePlayer.updateFromSnapshot(player);
  }

  for (const [playerId, remotePlayer] of appState.remotePlayers.entries()) {
    if (seen.has(playerId)) continue;
    remotePlayer.dispose();
    appState.remotePlayers.delete(playerId);
  }
}

function clearRemotePlayers() {
  for (const remotePlayer of appState.remotePlayers.values()) {
    remotePlayer.dispose();
  }
  appState.remotePlayers.clear();
}

function maybeSendRealtimePlayerState(nowMs) {
  if (!appState.started || !appState.player || !appState.guestIdentity) return;
  if (nowMs - appState.lastRealtimeStateAtMs < 50) return;

  appState.lastRealtimeStateAtMs = nowMs;
  realtimeClient.sendPlayerState(buildRealtimePlayerState());
}

function updateRadioState(event) {
  appState.radio = reduceRadioState(appState.radio, event);
  recordRadioDebugEvent(event.type, {
    channelStatus: appState.radio.channelStatus,
    clientStatus: appState.radio.clientStatus,
    speakerPlayerId: appState.radio.speakerPlayerId,
    errorCode: appState.radio.errorCode
  });
}

function syncRadioSession(session) {
  updateRadioState({
    type: 'session_radio_state',
    radio: session?.radio ?? null
  });

  const isRemoteSpeaker = session?.radio?.status === 'occupied'
    && session?.radio?.speakerPlayerId
    && session.radio.speakerPlayerId !== appState.guestIdentity?.playerId;
  if (isRemoteSpeaker) {
    if (radioVoiceClient.getListeningSpeakerPlayerId() !== session.radio.speakerPlayerId) {
      void startListeningToRemoteSpeaker(session.radio.speakerPlayerId, 'session_sync');
    }
  } else {
    radioVoiceClient.stopListening();
  }
  applyRadioAudioMix(session?.radio?.status === 'occupied');
}

function setupRadioControls() {
  const button = hud.radioButton;
  if (button) {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!appState.started) return;
      try {
        button.setPointerCapture?.(event.pointerId);
      } catch {}
      void beginRadioTransmission();
    });

    const release = () => endRadioTransmission('button_release');
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  if (touchRadioRoot) {
    touchRadioRoot.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!canUseTouchRadioButton()) return;
      touchRadioPointerId = event.pointerId;
      try {
        touchRadioRoot.setPointerCapture?.(event.pointerId);
      } catch {}
      void beginRadioTransmission();
    });

    const releaseTouchRadio = (event) => {
      if (event?.pointerId != null && event.pointerId !== touchRadioPointerId) return;
      resetTouchRadioInteraction();
      endRadioTransmission('button_release');
    };

    touchRadioRoot.addEventListener('pointerup', releaseTouchRadio);
    touchRadioRoot.addEventListener('pointercancel', releaseTouchRadio);
    touchRadioRoot.addEventListener('lostpointercapture', releaseTouchRadio);
    touchRadioRoot.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'KeyR' || event.repeat) return;
    if (!appState.started) return;
    void beginRadioTransmission();
  });

  window.addEventListener('keyup', (event) => {
    if (event.code !== 'KeyR') return;
    endRadioTransmission('button_release');
  });

  updateTouchRadioControlState(getRadioHudState());
}

async function beginRadioTransmission() {
  if (!appState.radioEnabled || !appState.started || !appState.guestIdentity) return;

  try {
    await radioVoiceClient.prepareMicrophone();
    updateRadioState({ type: 'mic_ready' });
  } catch (error) {
    console.warn('Nao foi possivel acessar o microfone.', error);
    updateRadioState({
      type: 'mic_denied',
      detail: error?.message ?? 'Falha ao acessar o microfone.'
    });
    return;
  }

  const previousStatus = appState.radio.channelStatus;
  updateRadioState({ type: 'press_to_talk_start' });
  if (previousStatus !== 'requesting' && appState.radio.channelStatus === 'requesting') {
    realtimeClient.sendRadioRequestTalk();
  }
}

function endRadioTransmission(reason = 'button_release') {
  resetTouchRadioInteraction();
  const wasSpeaker = appState.radio.speakerPlayerId === appState.guestIdentity?.playerId;
  const wasRequesting = appState.radio.channelStatus === 'requesting';
  updateRadioState({ type: 'press_to_talk_end' });

  if (wasSpeaker) {
    radioVoiceClient.stopBroadcast();
    radioVoiceClient.stopListening();
    realtimeClient.sendRadioReleaseTalk(reason);
    applyRadioAudioMix(false);
  } else if (wasRequesting) {
    applyRadioAudioMix(false);
  }
}

function canUseTouchRadioButton() {
  const radioHudState = getRadioHudState();
  return Boolean(radioHudState?.buttonEnabled && appState.started);
}

function resetTouchRadioInteraction() {
  touchRadioPointerId = null;
}

function updateTouchRadioControlState(radioHudState) {
  if (!touchRadioRoot) return;

  const isDisabled = !radioHudState?.buttonEnabled;
  const isOccupied = appState.radio.channelStatus === RADIO_CHANNEL_STATUS.OCCUPIED;
  const isActive = appState.radio.isPressingTalk || appState.radio.clientStatus === RADIO_CLIENT_STATUS.TRANSMITTING;

  touchRadioRoot.classList.toggle('is-disabled', isDisabled);
  touchRadioRoot.classList.toggle('is-occupied', isOccupied);
  touchRadioRoot.classList.toggle('is-active', isActive);
  if (touchRadioKnob) {
    touchRadioKnob.hidden = false;
  }
  if (touchRadioLabel) {
    touchRadioLabel.textContent = getTouchRadioLabel(radioHudState);
  }
}

function getTouchRadioLabel(radioHudState) {
  if (!appState.radioEnabled) return 'Off';
  if (appState.radio.clientStatus === RADIO_CLIENT_STATUS.MIC_BLOCKED) return 'Mic';
  if (appState.radio.channelStatus === RADIO_CHANNEL_STATUS.REQUESTING) return 'Abrindo';
  if (appState.radio.clientStatus === RADIO_CLIENT_STATUS.TRANSMITTING) return 'Falando';
  if (appState.radio.channelStatus === RADIO_CHANNEL_STATUS.OCCUPIED) return 'Ouvindo';
  return radioHudState?.buttonEnabled ? 'Falar' : 'Radio';
}

async function handleRadioRealtimeMessage(message) {
  recordRadioDebugEvent(`signal_${message.type}`, {
    sourcePlayerId: message.sourcePlayerId ?? null,
    targetPlayerId: message.targetPlayerId ?? null,
    speakerPlayerId: message.speakerPlayerId ?? null
  });
  switch (message.type) {
    case 'radio_talk_granted':
      updateRadioState({
        type: 'radio_granted',
        speakerPlayerId: message.speakerPlayerId,
        expiresAt: message.expiresAt
      });
      if (message.speakerPlayerId === appState.guestIdentity?.playerId) {
        await startLocalRadioBroadcast(message.session?.players ?? []);
      } else {
        await startListeningToRemoteSpeaker(message.speakerPlayerId, 'talk_granted');
      }
      return;
    case 'radio_talk_denied':
      updateRadioState({
        type: 'radio_busy',
        speakerPlayerId: message.speakerPlayerId,
        expiresAt: message.expiresAt
      });
      return;
    case 'radio_talk_released':
      radioVoiceClient.stopBroadcast();
      radioVoiceClient.stopListening();
      updateRadioState({
        type: 'radio_released',
        reason: message.reason
      });
      applyRadioAudioMix(false);
      return;
    case 'radio_force_stop':
      radioVoiceClient.stopBroadcast();
      radioVoiceClient.stopListening();
      updateRadioState({
        type: 'radio_force_stop',
        reason: message.reason,
        detail: message.detail
      });
      applyRadioAudioMix(false);
      return;
    case 'radio_offer':
    case 'radio_answer':
    case 'radio_ice_candidate':
      try {
        await radioVoiceClient.handleSignal(message, buildRadioSignaling());
      } catch (error) {
        console.warn('Falha ao processar sinalizacao de radio.', error);
      }
  }
}

async function startLocalRadioBroadcast(players) {
  const listenerPlayerIds = await resolveRadioListenerPlayerIdsWithRetry(players);
  recordRadioDebugEvent('broadcast_targets_resolved', {
    listeners: listenerPlayerIds.length,
    listenerPlayerIds
  });

  try {
    await radioVoiceClient.startBroadcast(listenerPlayerIds, buildRadioSignaling());
    applyRadioAudioMix(true);
  } catch (error) {
    console.warn('Falha ao iniciar a transmissao de radio.', error);
    updateRadioState({
      type: 'radio_error',
      code: 'broadcast_failed',
      detail: error?.message ?? 'Falha ao iniciar a transmissao.'
    });
    endRadioTransmission('mic_error');
  }
}

async function startListeningToRemoteSpeaker(speakerPlayerId, source) {
  if (!speakerPlayerId || speakerPlayerId === appState.guestIdentity?.playerId) return;
  if (radioVoiceClient.getListeningSpeakerPlayerId() === speakerPlayerId) return;

  recordRadioDebugEvent('listen_remote_speaker_requested', {
    speakerPlayerId,
    source
  });

  try {
    await radioVoiceClient.startListeningToSpeaker(speakerPlayerId, buildRadioSignaling());
    applyRadioAudioMix(true);
  } catch (error) {
    console.warn('Falha ao iniciar a escuta do radio.', error);
    updateRadioState({
      type: 'radio_error',
      code: 'listen_failed',
      detail: error?.message ?? 'Falha ao iniciar a escuta do radio.'
    });
  }
}

function buildRadioSignaling() {
  return {
    sendAnswer(targetPlayerId, sdp) {
      realtimeClient.sendRadioAnswer(targetPlayerId, sdp);
    },
    sendIceCandidate(targetPlayerId, candidate) {
      realtimeClient.sendRadioIceCandidate(targetPlayerId, candidate);
    },
    sendOffer(targetPlayerId, sdp) {
      realtimeClient.sendRadioOffer(targetPlayerId, sdp);
    }
  };
}

function resolveRadioListenerPlayerIds(players) {
  const listenerIds = new Set();
  const addPlayerId = (playerId) => {
    if (!playerId || playerId === appState.guestIdentity?.playerId) return;
    listenerIds.add(playerId);
  };

  for (const player of players ?? []) {
    if (!player || player.status === 'disconnected') continue;
    addPlayerId(player.playerId);
  }

  for (const player of appState.launchSession?.players ?? []) {
    if (!player || player.status === 'disconnected') continue;
    addPlayerId(player.playerId);
  }

  for (const playerId of appState.remotePlayers.keys()) {
    addPlayerId(playerId);
  }

  for (const player of appState.remoteRanking ?? []) {
    if (!player || player.status === 'disconnected') continue;
    addPlayerId(player.playerId);
  }

  return [...listenerIds];
}

async function resolveRadioListenerPlayerIdsWithRetry(players) {
  const attempts = [];

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const listenerPlayerIds = resolveRadioListenerPlayerIds(players);
    attempts.push({
      attempt: attempt + 1,
      listeners: listenerPlayerIds.length,
      sessionPlayers: summarizeRadioPlayers(appState.launchSession?.players),
      remotePlayers: [...appState.remotePlayers.keys()],
      rankingPlayers: summarizeRadioPlayers(appState.remoteRanking)
    });

    if (listenerPlayerIds.length > 0) {
      recordRadioDebugEvent('broadcast_targets_retry', {
        attempts,
        resolvedOnAttempt: attempt + 1
      });
      return listenerPlayerIds;
    }

    realtimeClient.requestSnapshot();
    await waitForRadioPresenceRefresh(180);
  }

  recordRadioDebugEvent('broadcast_targets_retry', {
    attempts,
    resolvedOnAttempt: null
  });
  return [];
}

function waitForRadioPresenceRefresh(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function summarizeRadioPlayers(players) {
  return (players ?? []).map((player) => ({
    playerId: player?.playerId ?? null,
    displayName: player?.displayName ?? null,
    status: player?.status ?? null
  }));
}

function getRadioHudState() {
  const radio = appState.radio;
  const sessionRadio = appState.launchSession?.radio ?? null;
  const speakerName = resolveRadioSpeakerName(sessionRadio?.speakerPlayerId);
  const isConnected = radio.clientStatus !== RADIO_CLIENT_STATUS.DISCONNECTED;
  const isRemoteSpeaker = sessionRadio?.status === 'occupied'
    && sessionRadio?.speakerPlayerId
    && sessionRadio.speakerPlayerId !== appState.guestIdentity?.playerId;
  const remainingText = getRadioRemainingTimeText(sessionRadio?.expiresAt);

  let hudLabel = 'Radio offline';
  let buttonText = 'Conectando';
  let buttonEnabled = false;

  if (!appState.radioEnabled) {
    hudLabel = 'Radio desativado';
    buttonText = 'Indisponivel';
    buttonEnabled = false;
  } else if (radio.clientStatus === RADIO_CLIENT_STATUS.MIC_BLOCKED) {
    hudLabel = 'Microfone bloqueado';
    buttonText = 'Tentar microfone';
    buttonEnabled = appState.started;
  } else if (!isConnected) {
    hudLabel = 'Radio offline';
    buttonText = 'Conectando';
  } else if (radio.channelStatus === 'requesting') {
    hudLabel = 'Solicitando canal';
    buttonText = 'Solicitando...';
    buttonEnabled = true;
  } else if (radio.clientStatus === RADIO_CLIENT_STATUS.TRANSMITTING) {
    hudLabel = 'Transmitindo';
    buttonText = 'Falando...';
    buttonEnabled = true;
  } else if (isRemoteSpeaker) {
    hudLabel = 'Ouvindo radio';
    buttonText = 'Radio ocupado';
    buttonEnabled = false;
  } else {
    hudLabel = radio.isMicArmed ? 'Radio livre' : 'Radio pronto';
    buttonText = 'Segure para falar';
    buttonEnabled = appState.started;
  }

  return {
    buttonEnabled,
    buttonText,
    channelStatus: sessionRadio?.status ?? radio.channelStatus,
    clientStatus: radio.clientStatus,
    hudLabel,
    remainingText,
    speakerName
  };
}

function resolveRadioSpeakerName(playerId) {
  if (!playerId) return '--';
  if (playerId === appState.guestIdentity?.playerId) return 'Voce';
  const player = appState.launchSession?.players?.find((entry) => entry.playerId === playerId);
  return player?.displayName ?? 'Piloto';
}

function getRadioRemainingTimeText(expiresAt) {
  const endMs = Date.parse(expiresAt ?? '');
  if (!Number.isFinite(endMs)) return '';
  const remainingSeconds = Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
  if (remainingSeconds <= 0) return '';
  return `${remainingSeconds}s`;
}

function applyRadioAudioMix(radioActive) {
  const varioDuck = radioActive ? 0.34 : 1;
  const scoreDuck = radioActive ? 0.45 : 1;
  if (radioActive) {
    adventureMusic.pauseForRadio();
  } else {
    adventureMusic.resumeAfterRadio();
    adventureMusic.setDuckFactor(1);
  }
  varioAudio.setDuckFactor(varioDuck);
  scoreAudio.setDuckFactor(scoreDuck);
}

function recordRadioDebugEvent(type, details = {}) {
  const debug = window.__radioDebug ?? {
    events: [],
    counts: {}
  };
  debug.counts[type] = (debug.counts[type] ?? 0) + 1;
  debug.last = {
    type,
    ...details,
    time: Math.round(performance.now())
  };
  debug.events.push(debug.last);
  debug.events = debug.events.slice(-32);
  window.__radioDebug = debug;
  updateRadioDebugOverlay(debug);
}

function updateRadioDebugOverlay(debug) {
  if (!new URLSearchParams(window.location.search).has('radioDebug')) return;

  let overlay = document.querySelector('[data-radio-debug]');
  if (!overlay) {
    overlay = document.createElement('pre');
    overlay.dataset.radioDebug = 'true';
    overlay.style.cssText = [
      'position:fixed',
      'left:8px',
      'right:8px',
      'bottom:8px',
      'z-index:31',
      'max-height:34vh',
      'overflow:auto',
      'margin:0',
      'padding:8px',
      'color:#f7fbff',
      'background:rgba(9,15,22,0.84)',
      'font:11px/1.3 monospace',
      'white-space:pre-wrap',
      'pointer-events:auto',
      '-webkit-user-select:text',
      'user-select:text'
    ].join(';');
    document.body.appendChild(overlay);
  }

  overlay.textContent = JSON.stringify({
    radioEnabled: appState.radioEnabled,
    state: appState.radio,
    launchId: appState.selectedLocation?.launchId ?? appState.selectedLocation?.id ?? null,
    sessionRadio: appState.launchSession?.radio ?? null,
    sessionPlayers: summarizeRadioPlayers(appState.launchSession?.players),
    remotePlayers: [...appState.remotePlayers.keys()],
    remoteRanking: summarizeRadioPlayers(appState.remoteRanking),
    ...debug
  }, null, 2);
}

function buildRealtimePlayerState() {
  const player = appState.player;
  return {
    displayName: appState.guestIdentity?.displayName,
    vehicleType: player.vehicleType,
    canopyColor: getSelectedCanopyColorHex(),
    status: player.landed ? (player.crashed ? 'crashed' : 'landed') : 'flying',
    headingRadians: player.heading,
    turnRate: player.turnRate,
    bankAngle: player.bankAngle,
    position: {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z
    },
    metrics: {
      altitudeAboveSeaLevel: player.altitudeAboveSeaLevel,
      groundClearance: player.groundClearance,
      speedKmh: player.groundSpeedKmh ?? player.speed,
      verticalSpeed: player.verticalSpeed,
      distanceFromStart: player.distanceFromStart,
      score: player.score ?? 0,
      combo: player.thermalCombo ?? 1,
      nextWaypointIndex: player.nextWaypointIndex ?? 0,
      completedWaypoints: player.completedWaypoints ?? 0
    }
  };
}

function maybeSendRealtimeResult(round) {
  if (!appState.started || !appState.player || !round?.ended || appState.lastRealtimeResultSent || !appState.guestIdentity) return;

  appState.lastRealtimeResultSent = true;
  const stats = appState.flightStats ?? createFlightStats();
  void postPlayerResult(
    appState.selectedLocation?.launchId ?? appState.selectedLocation?.id,
    appState.guestIdentity,
    appState.player.crashed ? 'crashed' : 'landed',
    {
      finalScore: appState.player.score ?? 0,
      flightTimeSeconds: round.elapsedSeconds,
      maxAltitudeMeters: stats.maxAltitudeMeters,
      maxGroundSpeedKmh: stats.maxGroundSpeedKmh,
      maxClimbMetersPerSecond: stats.maxClimbMetersPerSecond,
      bestThermalCombo: appState.player.bestThermalCombo ?? 1,
      completedWaypoints: appState.player.completedWaypoints ?? 0,
      finishedAt: new Date().toISOString()
    }
  ).catch((error) => {
    console.warn('Nao foi possivel publicar o resultado da rodada.', error);
  });
  realtimeClient.sendPlayerResult(appState.player.crashed ? 'crashed' : 'landed', {
    finalScore: appState.player.score ?? 0,
    flightTimeSeconds: round.elapsedSeconds,
    maxAltitudeMeters: stats.maxAltitudeMeters,
    maxGroundSpeedKmh: stats.maxGroundSpeedKmh,
    maxClimbMetersPerSecond: stats.maxClimbMetersPerSecond,
    bestThermalCombo: appState.player.bestThermalCombo ?? 1,
    completedWaypoints: appState.player.completedWaypoints ?? 0,
    finishedAt: new Date().toISOString()
  });
}

function getSelectedCanopyColorHex() {
  const selectedColor = colorInputs.find((input) => input.checked)?.value ?? '0xa8dff2';
  return `#${selectedColor.replace(/^0x/i, '').padStart(6, '0')}`;
}

function resolveThermalsEnabled(location, session) {
  if (typeof session?.thermals?.enabled === 'boolean') return session.thermals.enabled;
  return location.liftMode !== 'orographic';
}

function buildWindConfig(location, session) {
  const sessionWind = session?.wind ?? {};
  return {
    directionRadians: sessionWind.baseDirectionRadians ?? sessionWind.directionRadians ?? location.wind?.directionRadians,
    directionVariationDegrees: sessionWind.directionVariationDegrees ?? location.wind?.directionVariationDegrees,
    baseSpeedKmh: sessionWind.baseSpeedKmh,
    speedVariationKmh: sessionWind.speedVariationKmh,
    gustSpeedKmh: sessionWind.gustSpeedKmh,
    cycleDurationSeconds: sessionWind.cycleDurationSeconds,
    gustDurationSeconds: sessionWind.gustDurationSeconds,
    phaseOffsetSeconds: getSessionWindPhaseOffsetSeconds(session)
  };
}

function getSessionWindPhaseOffsetSeconds(session) {
  const startedAtMs = Date.parse(session?.startedAt ?? '');
  if (Number.isFinite(startedAtMs)) {
    return Math.max(0, (Date.now() - startedAtMs) / 1000);
  }

  const seed = session?.wind?.seed ?? session?.worldSeed ?? '';
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash % 600);
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
    touchLabelUp.textContent = vehicleType === 'drone' ? 'Sobe' : 'Acelera';
  }
  if (touchLabelDown) {
    touchLabelDown.textContent = vehicleType === 'drone' ? 'Desce' : 'Freia';
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
  const nowMs = performance.now();
  const referencePosition = appState.player?.position ?? standbyPosition;
  terrain.update(referencePosition, delta);
  vegetation.update(referencePosition);
  updateLocationBuilding(locationBuilding, appState.selectedLocation, terrain);
  updateSunLight(referencePosition);
  updateWind(wind, delta);
  updateWindMarkers(windMarkers, wind, referencePosition, terrain);

  if (!appState.started) {
    for (const remotePlayer of appState.remotePlayers.values()) {
      remotePlayer.update(delta);
    }
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
  for (const remotePlayer of appState.remotePlayers.values()) {
    remotePlayer.update(delta);
  }

  updateFlightStats(appState.flightStats, player);
  maybeCelebrateGol(player, round);
  updateRoundState(round, delta, player);
  maybeSendRealtimePlayerState(nowMs);
  maybeSendRealtimeResult(round);
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
  const radioHudState = getRadioHudState();
  updateHud(hud, {
    player,
    bots,
    terrain,
    round,
    wind,
    scoring: appState.scoring,
    thermalAssistant: appState.thermalAssistant,
    radio: radioHudState
  });
  updateTouchRadioControlState(radioHudState);
  updateFlightCamera(camera, player, delta, { terrain });

  renderer.render(scene, camera);
});

// Ao cruzar o GOL, abre a comemoracao uma unica vez por rodada com os dados
// consolidados do voo; o jogo continua rodando atras do overlay.
function maybeCelebrateGol(player, round) {
  if (appState.golCelebrated || !player.routeFinished || player.crashed) return;

  appState.golCelebrated = true;
  const stats = appState.flightStats ?? createFlightStats();
  celebration.show({
    locationName: appState.selectedLocation?.name ?? 'Local de voo',
    score: player.score ?? 0,
    elapsedSeconds: round.elapsedSeconds,
    distanceFromStartMeters: Number.isFinite(player.distanceFromStart)
      ? player.distanceFromStart
      : player.distanceTravelled,
    maxAltitudeMeters: stats.maxAltitudeMeters,
    maxClimbMetersPerSecond: stats.maxClimbMetersPerSecond,
    maxGroundSpeedKmh: stats.maxGroundSpeedKmh,
    bestThermalCombo: player.bestThermalCombo ?? 1,
    completedWaypoints: player.completedWaypoints ?? 0,
    completedAt: new Date()
  });
}

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
