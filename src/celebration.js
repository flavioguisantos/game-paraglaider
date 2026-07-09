// Comemoracao de GOL: overlay com confete, card com os principais dados do voo
// e exportacao de imagem (1080x1350, formato 4:5 de redes sociais) para
// compartilhar ou baixar. Nao altera fisica nem regras de voo.

const CONFETTI_COLORS = ['#ffd166', '#59d98c', '#ff6b66', '#6cc4ff', '#f7fbff', '#ff2f8f'];
const CONFETTI_COUNT = 190;
const CONFETTI_DURATION_SECONDS = 9;
const SHARE_CANVAS_WIDTH = 1080;
const SHARE_CANVAS_HEIGHT = 1350;

export function createFlightStats() {
  return {
    maxAltitudeMeters: -Infinity,
    maxClimbMetersPerSecond: 0,
    maxGroundSpeedKmh: 0
  };
}

export function updateFlightStats(stats, player) {
  if (!stats || !player || player.landed || player.crashed) return;

  if (Number.isFinite(player.altitudeAboveSeaLevel)) {
    stats.maxAltitudeMeters = Math.max(stats.maxAltitudeMeters, player.altitudeAboveSeaLevel);
  }
  if (Number.isFinite(player.verticalSpeed)) {
    stats.maxClimbMetersPerSecond = Math.max(stats.maxClimbMetersPerSecond, player.verticalSpeed);
  }
  if (Number.isFinite(player.groundSpeedKmh)) {
    stats.maxGroundSpeedKmh = Math.max(stats.maxGroundSpeedKmh, player.groundSpeedKmh);
  }
}

export function createCelebration() {
  const overlay = document.createElement('div');
  overlay.className = 'celebration';
  overlay.hidden = true;
  overlay.innerHTML = `
    <canvas class="celebration-confetti"></canvas>
    <div class="celebration-card" role="dialog" aria-label="Rota concluida">
      <div class="celebration-heading">
        <span class="celebration-kicker">Rota completa</span>
        <strong class="celebration-title">GOL!</strong>
        <em class="celebration-location" data-celebration="location"></em>
      </div>
      <div class="celebration-score">
        <span>Pontuacao</span>
        <strong data-celebration="score">0</strong>
      </div>
      <div class="celebration-stats" data-celebration="stats"></div>
      <div class="celebration-actions">
        <button type="button" class="celebration-share" data-celebration="share">Compartilhar</button>
        <button type="button" class="celebration-download" data-celebration="download">Baixar imagem</button>
        <button type="button" class="celebration-close" data-celebration="close">Continuar voando</button>
      </div>
      <div class="celebration-feedback" data-celebration="feedback" aria-live="polite"></div>
    </div>
  `;
  document.body.append(overlay);

  const confettiCanvas = overlay.querySelector('.celebration-confetti');
  const elements = {
    location: overlay.querySelector('[data-celebration="location"]'),
    score: overlay.querySelector('[data-celebration="score"]'),
    stats: overlay.querySelector('[data-celebration="stats"]'),
    share: overlay.querySelector('[data-celebration="share"]'),
    download: overlay.querySelector('[data-celebration="download"]'),
    close: overlay.querySelector('[data-celebration="close"]'),
    feedback: overlay.querySelector('[data-celebration="feedback"]')
  };

  const state = {
    visible: false,
    flightData: null,
    confetti: null,
    animationHandle: 0,
    lastFrameAt: 0
  };

  elements.close.addEventListener('click', () => hide());
  elements.share.addEventListener('click', async () => {
    if (!state.flightData) return;
    elements.feedback.textContent = '';
    try {
      const shared = await shareFlightCard(state.flightData);
      elements.feedback.textContent = shared
        ? 'Compartilhado!'
        : 'Compartilhamento indisponivel; imagem baixada.';
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn('Falha ao compartilhar o card de voo.', error);
        elements.feedback.textContent = 'Nao foi possivel compartilhar.';
      }
    }
  });
  elements.download.addEventListener('click', async () => {
    if (!state.flightData) return;
    elements.feedback.textContent = '';
    try {
      await downloadFlightCard(state.flightData);
      elements.feedback.textContent = 'Imagem salva.';
    } catch (error) {
      console.warn('Falha ao gerar a imagem do card de voo.', error);
      elements.feedback.textContent = 'Nao foi possivel gerar a imagem.';
    }
  });

  function show(flightData) {
    state.flightData = flightData;
    state.visible = true;
    elements.feedback.textContent = '';
    elements.location.textContent = flightData.locationName;
    elements.score.textContent = formatScore(flightData.score);
    elements.stats.innerHTML = buildStatEntries(flightData)
      .map(({ label, value }) => `<div><span>${label}</span><strong>${value}</strong></div>`)
      .join('');
    overlay.hidden = false;
    startConfetti();
  }

  function hide() {
    state.visible = false;
    overlay.hidden = true;
    stopConfetti();
  }

  function startConfetti() {
    stopConfetti();
    const width = window.innerWidth;
    const height = window.innerHeight;
    confettiCanvas.width = width;
    confettiCanvas.height = height;
    state.confetti = {
      particles: createConfettiParticles(width, height),
      elapsedSeconds: 0,
      width,
      height
    };
    state.lastFrameAt = performance.now();
    state.animationHandle = requestAnimationFrame(stepConfetti);
  }

  function stopConfetti() {
    if (state.animationHandle) cancelAnimationFrame(state.animationHandle);
    state.animationHandle = 0;
    state.confetti = null;
    confettiCanvas.getContext('2d')?.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }

  function stepConfetti(now) {
    const confetti = state.confetti;
    if (!confetti || !state.visible) return;

    const delta = Math.min((now - state.lastFrameAt) / 1000, 0.05);
    state.lastFrameAt = now;
    confetti.elapsedSeconds += delta;

    const context = confettiCanvas.getContext('2d');
    context.clearRect(0, 0, confetti.width, confetti.height);

    // Fade global no fim do ciclo para o confete sumir sem corte seco.
    const fade = confetti.elapsedSeconds > CONFETTI_DURATION_SECONDS - 1.5
      ? Math.max(0, (CONFETTI_DURATION_SECONDS - confetti.elapsedSeconds) / 1.5)
      : 1;

    for (const particle of confetti.particles) {
      particle.velocityY += 320 * delta;
      particle.x += particle.velocityX * delta + Math.sin(confetti.elapsedSeconds * particle.wobble) * 40 * delta;
      particle.y += particle.velocityY * delta;
      particle.rotation += particle.spin * delta;

      if (particle.y > confetti.height + 30 && confetti.elapsedSeconds < CONFETTI_DURATION_SECONDS - 2) {
        particle.y = -20;
        particle.velocityY = 40 + Math.random() * 120;
      }

      context.save();
      context.globalAlpha = fade;
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.fillStyle = particle.color;
      context.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
      context.restore();
    }

    if (confetti.elapsedSeconds < CONFETTI_DURATION_SECONDS) {
      state.animationHandle = requestAnimationFrame(stepConfetti);
    } else {
      stopConfetti();
    }
  }

  return {
    show,
    hide,
    get visible() {
      return state.visible;
    }
  };
}

function createConfettiParticles(width, height) {
  const particles = [];
  for (let index = 0; index < CONFETTI_COUNT; index += 1) {
    particles.push({
      x: Math.random() * width,
      y: -Math.random() * height * 0.6,
      velocityX: (Math.random() - 0.5) * 160,
      velocityY: 40 + Math.random() * 220,
      size: 8 + Math.random() * 10,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 10,
      wobble: 1 + Math.random() * 3,
      color: CONFETTI_COLORS[index % CONFETTI_COLORS.length]
    });
  }
  return particles;
}

function buildStatEntries(flightData) {
  return [
    { label: 'Tempo de voo', value: formatTime(flightData.elapsedSeconds) },
    { label: 'Distancia', value: formatDistance(flightData.distanceFromStartMeters) },
    { label: 'Altitude max.', value: `${formatMeters(flightData.maxAltitudeMeters)} m` },
    { label: 'Subida max.', value: `+${(flightData.maxClimbMetersPerSecond ?? 0).toFixed(1)} m/s` },
    { label: 'Vel. max. solo', value: `${Math.round(flightData.maxGroundSpeedKmh ?? 0)} km/h` },
    { label: 'Combo max.', value: `${flightData.bestThermalCombo ?? 1}x` },
    { label: 'Waypoints', value: `${flightData.completedWaypoints ?? 0} TP` },
    { label: 'Data', value: formatDate(flightData.completedAt) }
  ];
}

async function shareFlightCard(flightData) {
  const blob = await renderShareImageBlob(flightData);
  const file = new File([blob], buildShareFileName(flightData), { type: 'image/png' });
  const shareData = {
    files: [file],
    title: 'GOL! Rota completa - Jogo Parapente 3D',
    text: buildShareText(flightData)
  };

  if (navigator.canShare?.(shareData) && navigator.share) {
    await navigator.share(shareData);
    return true;
  }

  triggerBlobDownload(blob, file.name);
  return false;
}

async function downloadFlightCard(flightData) {
  const blob = await renderShareImageBlob(flightData);
  triggerBlobDownload(blob, buildShareFileName(flightData));
}

function buildShareFileName(flightData) {
  const datePart = (flightData.completedAt ?? new Date()).toISOString().slice(0, 10);
  return `gol-parapente-${datePart}.png`;
}

function buildShareText(flightData) {
  return [
    `GOL! Completei a rota em ${formatTime(flightData.elapsedSeconds)} voando em ${flightData.locationName}.`,
    `${formatScore(flightData.score)} pts | ${formatDistance(flightData.distanceFromStartMeters)} | altitude max. ${formatMeters(flightData.maxAltitudeMeters)} m.`
  ].join(' ');
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Card 1080x1350 desenhado em canvas: mesmo visual de instrumento do HUD,
// com confete estatico, pontuacao em destaque e grade dos dados do voo.
async function renderShareImageBlob(flightData) {
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_CANVAS_WIDTH;
  canvas.height = SHARE_CANVAS_HEIGHT;
  const context = canvas.getContext('2d');

  const background = context.createLinearGradient(0, 0, SHARE_CANVAS_WIDTH, SHARE_CANVAS_HEIGHT);
  background.addColorStop(0, '#101f2a');
  background.addColorStop(0.55, '#16303f');
  background.addColorStop(1, '#283832');
  context.fillStyle = background;
  context.fillRect(0, 0, SHARE_CANVAS_WIDTH, SHARE_CANVAS_HEIGHT);

  drawStaticConfetti(context);

  context.textAlign = 'center';
  context.fillStyle = '#9fb4c8';
  context.font = '700 34px Arial, Helvetica, sans-serif';
  context.fillText('R O T A   C O M P L E T A', SHARE_CANVAS_WIDTH / 2, 150);

  context.fillStyle = '#ffd166';
  context.font = '900 190px Arial, Helvetica, sans-serif';
  context.fillText('GOL!', SHARE_CANVAS_WIDTH / 2, 330);

  context.fillStyle = '#f7fbff';
  context.font = '700 44px Arial, Helvetica, sans-serif';
  context.fillText(flightData.locationName, SHARE_CANVAS_WIDTH / 2, 410);

  context.fillStyle = '#9fb4c8';
  context.font = '400 32px Arial, Helvetica, sans-serif';
  context.fillText(formatDate(flightData.completedAt), SHARE_CANVAS_WIDTH / 2, 458);

  context.fillStyle = '#9fb4c8';
  context.font = '700 30px Arial, Helvetica, sans-serif';
  context.fillText('PONTUACAO', SHARE_CANVAS_WIDTH / 2, 560);
  context.fillStyle = '#59d98c';
  context.font = '900 120px Arial, Helvetica, sans-serif';
  context.fillText(`${formatScore(flightData.score)} pts`, SHARE_CANVAS_WIDTH / 2, 672);

  const stats = buildStatEntries(flightData).slice(0, 6);
  const columns = 2;
  const cellWidth = 430;
  const cellHeight = 150;
  const gridLeft = (SHARE_CANVAS_WIDTH - (cellWidth * columns + 40)) / 2;
  const gridTop = 730;

  for (let index = 0; index < stats.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = gridLeft + column * (cellWidth + 40);
    const y = gridTop + row * (cellHeight + 26);

    context.fillStyle = 'rgba(247, 251, 255, 0.07)';
    drawRoundedRect(context, x, y, cellWidth, cellHeight, 18);
    context.fill();
    context.strokeStyle = 'rgba(247, 251, 255, 0.18)';
    context.lineWidth = 2;
    drawRoundedRect(context, x, y, cellWidth, cellHeight, 18);
    context.stroke();

    context.fillStyle = '#9fb4c8';
    context.font = '700 26px Arial, Helvetica, sans-serif';
    context.fillText(stats[index].label.toUpperCase(), x + cellWidth / 2, y + 52);
    context.fillStyle = '#f7fbff';
    context.font = '800 48px Arial, Helvetica, sans-serif';
    context.fillText(stats[index].value, x + cellWidth / 2, y + 112);
  }

  context.fillStyle = '#9fb4c8';
  context.font = '700 30px Arial, Helvetica, sans-serif';
  context.fillText('JOGO PARAPENTE 3D', SHARE_CANVAS_WIDTH / 2, SHARE_CANVAS_HEIGHT - 48);

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas nao gerou o blob da imagem.'));
    }, 'image/png');
  });
}

function drawStaticConfetti(context) {
  // Determinismo: o mesmo card gera sempre o mesmo confete de fundo.
  let seed = 42;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  for (let index = 0; index < 90; index += 1) {
    const x = random() * SHARE_CANVAS_WIDTH;
    const y = random() * SHARE_CANVAS_HEIGHT;
    const size = 10 + random() * 16;
    context.save();
    context.globalAlpha = 0.16 + random() * 0.2;
    context.translate(x, y);
    context.rotate(random() * Math.PI * 2);
    context.fillStyle = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
    context.fillRect(-size / 2, -size / 4, size, size / 2);
    context.restore();
  }
}

function drawRoundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function formatScore(score) {
  return Math.round(score ?? 0).toLocaleString('pt-BR');
}

function formatMeters(meters) {
  return Math.round(Number.isFinite(meters) ? meters : 0).toLocaleString('pt-BR');
}

function formatDistance(meters) {
  const value = Number.isFinite(meters) ? meters : 0;
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`;
  return `${Math.round(value)} m`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function formatDate(date) {
  return (date ?? new Date()).toLocaleDateString('pt-BR');
}
