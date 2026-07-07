import * as THREE from 'three';
import { applyFlightPhysics, POLAR_SPEEDS, updateAltitudeMetrics } from './physics.js?v=hot-b-1';
import { createParagliderModel, setParagliderLandedPose } from './paragliderModel.js?v=pilot-pose-5';
import { createFirstPersonRig, updateFirstPersonRig } from './firstPersonRig.js?v=8';
import { getCameraMode } from './camera.js?v=camera-modes-3';

const PLAYER_CONFIG = {
  launchX: 0,
  launchZ: 0,
  startAltitude: 24,
  // Faixa real de um EN-B: S = freios (ate ~26 km/h), W = barra (ate ~55 km/h).
  minSpeedKmh: 26,
  trimSpeedKmh: POLAR_SPEEDS.trimSpeedKmh,
  maxSpeedKmh: POLAR_SPEEDS.maxSpeedKmh,
  launchStartSpeedKmh: 8,
  // Vela EN-B hot: curva ainda eficiente para enroscar, mas sem giro arcade.
  maxTurnRate: 0.48,
  turnResponse: 1.55,
  // Visual: rolagem segue o bank real calculado pela fisica; pitch mistura
  // comando de velocidade com o surge (aceleracao vertical) da vela.
  visualBankScale: 0.85,
  visualPitch: 0.14,
  surgePitchScale: 0.035,
  surgeSmoothing: 4
};

export class Player {
  constructor({
    terrain,
    canopyColor = 0xa8dff2,
    launchAltitudeMeters = PLAYER_CONFIG.startAltitude,
    launchHeadingRadians = 0
  }) {
    this.terrain = terrain;
    this.group = createParagliderModel({
      canopyAssetUrl: '/image/nova-vortex.obj',
      colors: {
        canopy: canopyColor,
        stripe: 0x3157bd,
        trim: 0x17242f,
        helmet: 0xf2c94c
      }
    });
    // Rig da visao do piloto (selete + bracos com batoques): so aparece na
    // primeira pessoa, quando o boneco de terceira pessoa e ocultado.
    this.firstPersonRig = createFirstPersonRig();
    this.group.add(this.firstPersonRig);
    this.position = this.group.position;
    this.velocity = new THREE.Vector3();
    this.heading = launchHeadingRadians;
    this.turnRate = 0;
    // Decola em corrida: a velocidade sobe do passo de rampa ate o trim.
    this.speed = PLAYER_CONFIG.launchStartSpeedKmh;
    this.targetSpeed = PLAYER_CONFIG.trimSpeedKmh;
    this.groundSpeedKmh = 0;
    this.windAdjustedSpeedKmh = PLAYER_CONFIG.trimSpeedKmh;
    this.windAngleDegrees = 0;
    this.windAngleStepDegrees = 0;
    this.verticalSpeed = 0;
    this.groundHeight = 0;
    this.groundClearance = 0;
    this.altitudeAboveSeaLevel = 0;
    this.distanceTravelled = 0;
    this.distanceFromStart = 0;
    this.landed = false;
    this.crashed = false;
    this.entangled = false;
    this.entanglementId = null;
    this.entanglementSpin = 0;
    this.landingPoseApplied = false;
    this.bankAngle = 0;
    // Reserva unica de flare para arredondar o pouso segurando os freios.
    this.flareCharge = 1;
    this.previousVerticalSpeed = 0;
    this.smoothedSurge = 0;
    this.input = createInputState();

    const startY = terrain.getHeightAt(PLAYER_CONFIG.launchX, PLAYER_CONFIG.launchZ) + launchAltitudeMeters;
    this.position.set(PLAYER_CONFIG.launchX, startY, PLAYER_CONFIG.launchZ);
    this.launchPosition = this.position.clone();
    this.group.rotation.y = this.heading;
    updateAltitudeMetrics(this, terrain);
  }

  update(delta, flightContext) {
    this.syncFirstPersonView(delta);
    if (this.landed || this.entangled) return;

    const turnInput = Number(this.input.left) - Number(this.input.right);
    const speedInput = Number(this.input.forward) - Number(this.input.backward);

    this.targetSpeed = getTargetSpeedKmh(speedInput);
    this.speed = THREE.MathUtils.lerp(this.speed, this.targetSpeed, 1 - Math.exp(-delta * 4));
    const targetTurnRate = turnInput * PLAYER_CONFIG.maxTurnRate;
    this.turnRate = THREE.MathUtils.lerp(
      this.turnRate,
      targetTurnRate,
      1 - Math.exp(-delta * PLAYER_CONFIG.turnResponse)
    );
    this.heading += this.turnRate * delta;

    applyFlightPhysics(this, delta, flightContext);

    if (this.landed) {
      this.applyLandingPose();
      return;
    }

    // Surge (pendulo): variacao brusca do vario balanca a vela para
    // frente/tras, como ao entrar ou sair de uma termica.
    const verticalAcceleration = delta > 0
      ? (this.verticalSpeed - this.previousVerticalSpeed) / delta
      : 0;
    this.previousVerticalSpeed = this.verticalSpeed;
    this.smoothedSurge = THREE.MathUtils.lerp(
      this.smoothedSurge,
      THREE.MathUtils.clamp(verticalAcceleration * PLAYER_CONFIG.surgePitchScale, -0.16, 0.16),
      1 - Math.exp(-delta * PLAYER_CONFIG.surgeSmoothing)
    );

    this.group.rotation.y = this.heading;
    this.group.rotation.z = THREE.MathUtils.lerp(
      this.group.rotation.z,
      this.bankAngle * PLAYER_CONFIG.visualBankScale,
      1 - Math.exp(-delta * 3.6)
    );
    this.group.rotation.x = THREE.MathUtils.lerp(
      this.group.rotation.x,
      -speedInput * PLAYER_CONFIG.visualPitch + this.smoothedSurge,
      1 - Math.exp(-delta * 5)
    );
  }

  // Mostra o rig de primeira pessoa (e esconde o boneco externo) enquanto a
  // camera estiver na visao do piloto; pousado, volta sempre ao modo externo.
  syncFirstPersonView(delta) {
    const active = getCameraMode() === 'first-person' && !this.landed && !this.entangled;
    this.firstPersonRig.visible = active;
    const pilot = this.group.userData.parts?.pilot;
    if (pilot) pilot.visible = !active;
    if (active) updateFirstPersonRig(this.firstPersonRig, this.input, delta);
  }

  getForwardVector() {
    return new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading)).normalize();
  }

  applyLandingPose() {
    if (this.landingPoseApplied) return;

    const groundHeight = getVisualGroundHeight(this.terrain, this.position.x, this.position.z);
    this.group.rotation.set(0, this.heading, 0);
    setParagliderLandedPose(this.group, { groundHeight });
    this.landingPoseApplied = true;
  }
}

function getVisualGroundHeight(terrain, x, z) {
  return terrain.getRenderedHeightAt
    ? terrain.getRenderedHeightAt(x, z)
    : terrain.getHeightAt(x, z);
}

// W acelera rumo a barra cheia; S freia rumo a velocidade minima; solto = trim.
function getTargetSpeedKmh(speedInput) {
  if (speedInput > 0) {
    return THREE.MathUtils.lerp(PLAYER_CONFIG.trimSpeedKmh, PLAYER_CONFIG.maxSpeedKmh, speedInput);
  }
  if (speedInput < 0) {
    return THREE.MathUtils.lerp(PLAYER_CONFIG.trimSpeedKmh, PLAYER_CONFIG.minSpeedKmh, -speedInput);
  }
  return PLAYER_CONFIG.trimSpeedKmh;
}

function createInputState() {
  const state = {
    forward: false,
    backward: false,
    left: false,
    right: false
  };

  const keyMap = new Map([
    ['KeyW', 'forward'],
    ['ArrowUp', 'forward'],
    ['KeyS', 'backward'],
    ['ArrowDown', 'backward'],
    ['KeyA', 'left'],
    ['ArrowLeft', 'left'],
    ['KeyD', 'right'],
    ['ArrowRight', 'right']
  ]);

  window.addEventListener('keydown', (event) => {
    const key = keyMap.get(event.code);
    if (!key) return;
    event.preventDefault();
    state[key] = true;
  });

  window.addEventListener('keyup', (event) => {
    const key = keyMap.get(event.code);
    if (!key) return;
    event.preventDefault();
    state[key] = false;
  });

  bindTouchControls(state);

  return state;
}

function bindTouchControls(state) {
  const buttons = [...document.querySelectorAll('[data-control]')];
  const validControls = new Set(Object.keys(state));

  for (const button of buttons) {
    const control = button.dataset.control;
    if (!validControls.has(control)) continue;

    const setPressed = (pressed) => {
      state[control] = pressed;
      button.classList.toggle('is-active', pressed);
    };

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      setPressed(true);
    });

    button.addEventListener('pointerup', (event) => {
      event.preventDefault();
      setPressed(false);
    });

    button.addEventListener('pointercancel', () => setPressed(false));
    button.addEventListener('lostpointercapture', () => setPressed(false));
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  window.addEventListener('blur', () => {
    for (const control of validControls) state[control] = false;
    for (const button of buttons) button.classList.remove('is-active');
  });
}
