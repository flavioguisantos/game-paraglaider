const VARIO_AUDIO_CONFIG = {
  liftThreshold: 0.08,
  minInterval: 0.12,
  maxInterval: 0.44,
  minFrequency: 820,
  maxFrequency: 1760,
  beepDuration: 0.18,
  attackTime: 0.018,
  decayTime: 0.045,
  sustainLevel: 0.72,
  releaseTime: 0.065,
  volume: 0.078,
  harmonicGain: 0.24,
  harmonicRatio: 1.5
};

const MUSIC_CONFIG = {
  volume: 0.072,
  tempo: 148,
  lookAheadSeconds: 0.1,
  scheduleAheadSeconds: 0.8,
  melody: [0, 4, 7, 11, 14, 11, 9, 7, 5, 7, 9, 12, 14, 12, 10, 7],
  bass: [0, 0, 5, 5, 3, 3, 2, 2],
  chords: [
    [0, 4, 7],
    [5, 9, 12],
    [7, 11, 14],
    [3, 7, 10]
  ]
};

const SCORE_AUDIO_CONFIG = {
  volume: 0.14,
  notes: [67, 71, 74, 79, 74, 79],
  offsets: [0, 0.08, 0.16, 0.29, 0.43, 0.54],
  durations: [0.11, 0.1, 0.13, 0.15, 0.12, 0.28]
};

export function createVarioAudio() {
  return new VarioAudio();
}

export function createAdventureMusic(options = {}) {
  return new AdventureMusic(options);
}

export function createScoreAudio() {
  return new ScoreAudio();
}

export function unlockGameAudio() {
  const context = getSharedAudioContext();
  if (!context) {
    recordAudioDebug('unlockFailed', { reason: 'AudioContext indisponivel' });
    return null;
  }

  const resumeResult = context.resume();
  if (resumeResult?.then) {
    resumeResult
      .then(() => recordAudioDebug('resumeResolved', { state: context.state }))
      .catch((error) => recordAudioDebug('resumeRejected', { message: getErrorMessage(error) }));
  }
  primeAudioOutput(context);
  recordAudioDebug('unlockRequested', { state: context.state });
  return context;
}

let sharedAudioContext = null;
let audioPrimed = false;

class VarioAudio {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.masterConnected = false;
    this.enabled = false;
    this.timeUntilNextBeep = 0;

    this.unlock = this.unlock.bind(this);
    window.addEventListener('pointerdown', this.unlock, { once: true });
    window.addEventListener('keydown', this.unlock, { once: true });
  }

  unlock() {
    this.context = this.context || unlockGameAudio();
    if (!this.context) return;
    this.masterGain = this.masterGain || this.context.createGain();
    this.masterGain.gain.value = VARIO_AUDIO_CONFIG.volume;
    if (!this.masterConnected) {
      this.masterGain.connect(this.context.destination);
      this.masterConnected = true;
    }

    this.enabled = true;
    recordAudioDebug('varioUnlocked', { state: this.context.state });
  }

  update(delta, verticalSpeed, landed) {
    if (!this.enabled || !this.context || landed || verticalSpeed <= VARIO_AUDIO_CONFIG.liftThreshold) {
      this.timeUntilNextBeep = 0;
      if (verticalSpeed > VARIO_AUDIO_CONFIG.liftThreshold) {
        recordAudioDebugThrottled('varioBlocked', {
          enabled: this.enabled,
          hasContext: Boolean(this.context),
          state: this.context?.state ?? null,
          landed,
          verticalSpeed: Number(verticalSpeed.toFixed(2))
        });
      }
      return;
    }

    this.timeUntilNextBeep -= delta;
    if (this.timeUntilNextBeep > 0) return;

    const liftFactor = clamp((verticalSpeed - VARIO_AUDIO_CONFIG.liftThreshold) / 5, 0, 1);
    const interval = lerp(VARIO_AUDIO_CONFIG.maxInterval, VARIO_AUDIO_CONFIG.minInterval, liftFactor);
    const frequency = lerp(VARIO_AUDIO_CONFIG.minFrequency, VARIO_AUDIO_CONFIG.maxFrequency, liftFactor);

    this.playBeep(frequency, liftFactor);
    recordAudioDebugThrottled('varioBeep', {
      state: this.context.state,
      verticalSpeed: Number(verticalSpeed.toFixed(2)),
      frequency: Math.round(frequency)
    }, 300);
    this.timeUntilNextBeep = interval;
  }

  playBeep(frequency, liftFactor) {
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const harmonic = this.context.createOscillator();
    const envelope = this.context.createGain();
    const harmonicEnvelope = this.context.createGain();

    oscillator.type = 'sine';
    harmonic.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    harmonic.frequency.setValueAtTime(frequency * VARIO_AUDIO_CONFIG.harmonicRatio, now);

    const attackEnd = now + VARIO_AUDIO_CONFIG.attackTime;
    const decayEnd = attackEnd + VARIO_AUDIO_CONFIG.decayTime;
    const releaseStart = now + VARIO_AUDIO_CONFIG.beepDuration;
    const stopTime = releaseStart + VARIO_AUDIO_CONFIG.releaseTime;

    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(1, attackEnd);
    envelope.gain.exponentialRampToValueAtTime(VARIO_AUDIO_CONFIG.sustainLevel, decayEnd);
    envelope.gain.setValueAtTime(VARIO_AUDIO_CONFIG.sustainLevel, releaseStart);
    envelope.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    harmonicEnvelope.gain.setValueAtTime(0.0001, now);
    harmonicEnvelope.gain.exponentialRampToValueAtTime(
      VARIO_AUDIO_CONFIG.harmonicGain * liftFactor,
      attackEnd
    );
    harmonicEnvelope.gain.setValueAtTime(
      VARIO_AUDIO_CONFIG.harmonicGain * liftFactor,
      releaseStart
    );
    harmonicEnvelope.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    oscillator.connect(envelope);
    harmonic.connect(harmonicEnvelope);
    envelope.connect(this.masterGain);
    harmonicEnvelope.connect(this.masterGain);
    oscillator.start(now);
    harmonic.start(now + 0.004);
    oscillator.stop(stopTime + 0.01);
    harmonic.stop(stopTime + 0.012);
  }
}

class ScoreAudio {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.masterConnected = false;
  }

  play() {
    this.context = this.context || unlockGameAudio();
    if (!this.context) return;

    this.masterGain = this.masterGain || this.context.createGain();
    this.masterGain.gain.setValueAtTime(SCORE_AUDIO_CONFIG.volume, this.context.currentTime);
    if (!this.masterConnected) {
      this.masterGain.connect(this.context.destination);
      this.masterConnected = true;
    }

    const startTime = this.context.currentTime + 0.015;
    for (let index = 0; index < SCORE_AUDIO_CONFIG.notes.length; index += 1) {
      this.playNote({
        note: SCORE_AUDIO_CONFIG.notes[index],
        startTime: startTime + SCORE_AUDIO_CONFIG.offsets[index],
        duration: SCORE_AUDIO_CONFIG.durations[index],
        gain: index === SCORE_AUDIO_CONFIG.notes.length - 1 ? 0.9 : 0.62
      });
    }

    recordAudioDebug('scoreFanfare', { state: this.context.state });
  }

  playNote({ note, startTime, duration, gain }) {
    const oscillator = this.context.createOscillator();
    const harmonic = this.context.createOscillator();
    const envelope = this.context.createGain();
    const harmonicEnvelope = this.context.createGain();
    const releaseStart = startTime + duration;
    const stopTime = releaseStart + 0.1;
    const frequency = noteToFrequency(note);

    oscillator.type = 'triangle';
    harmonic.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startTime);
    harmonic.frequency.setValueAtTime(frequency * 2, startTime);

    envelope.gain.setValueAtTime(0.0001, startTime);
    envelope.gain.exponentialRampToValueAtTime(gain, startTime + 0.018);
    envelope.gain.exponentialRampToValueAtTime(gain * 0.38, releaseStart);
    envelope.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    harmonicEnvelope.gain.setValueAtTime(0.0001, startTime);
    harmonicEnvelope.gain.exponentialRampToValueAtTime(gain * 0.18, startTime + 0.02);
    harmonicEnvelope.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    oscillator.connect(envelope);
    harmonic.connect(harmonicEnvelope);
    envelope.connect(this.masterGain);
    harmonicEnvelope.connect(this.masterGain);
    oscillator.start(startTime);
    harmonic.start(startTime + 0.004);
    oscillator.stop(stopTime + 0.02);
    harmonic.stop(stopTime + 0.02);
  }
}

class AdventureMusic {
  constructor(options = {}) {
    this.context = null;
    this.masterGain = null;
    this.delay = null;
    this.delayGain = null;
    this.masterConnected = false;
    this.enabled = false;
    this.nextNoteTime = 0;
    this.step = 0;
    this.timerId = null;
    this.trackUrl = options.trackUrl ?? null;
    this.externalAudio = null;
    this.externalAudioSource = null;
  }

  start() {
    if (this.enabled) return;

    this.context = this.context || unlockGameAudio();
      if (!this.context) {
      recordAudioDebug('musicStartFailed', { reason: 'AudioContext indisponivel' });
      return;
    }
    this.masterGain = this.masterGain || this.context.createGain();
    this.masterGain.gain.setValueAtTime(MUSIC_CONFIG.volume, this.context.currentTime);

    if (this.trackUrl && this.canPlayExternalTrack()) {
      this.startExternalTrack();
      return;
    }

    this.delay = this.delay || this.context.createDelay();
    this.delayGain = this.delayGain || this.context.createGain();
    this.delay.delayTime.value = 0.18;
    this.delayGain.gain.value = 0.16;
    if (!this.masterConnected) {
      this.masterGain.connect(this.context.destination);
      this.masterGain.connect(this.delay);
      this.delay.connect(this.delayGain);
      this.delayGain.connect(this.context.destination);
      this.masterConnected = true;
    }

    this.enabled = true;
    this.nextNoteTime = this.context.currentTime + 0.05;
    this.step = 0;
    this.timerId = window.setInterval(() => this.schedule(), MUSIC_CONFIG.lookAheadSeconds * 1000);
    this.schedule();
    recordAudioDebug('musicStarted', { state: this.context.state, currentTime: Number(this.context.currentTime.toFixed(3)), track: 'procedural' });
  }

  stop() {
    if (!this.enabled) return;

    this.enabled = false;
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.externalAudio) {
      this.externalAudio.pause();
      this.externalAudio.currentTime = 0;
      this.externalAudio.volume = 0;
    }
    recordAudioDebug('musicStopped', { state: this.context?.state ?? null, track: this.trackUrl ? 'external' : 'procedural' });
  }

  canPlayExternalTrack() {
    return Boolean(this.trackUrl) && typeof window !== 'undefined' && typeof Audio !== 'undefined';
  }

  startExternalTrack() {
    if (!this.externalAudio) {
      this.externalAudio = new Audio(this.trackUrl);
      this.externalAudio.loop = true;
      this.externalAudio.preload = 'auto';
      this.externalAudio.volume = 0.8;
      this.externalAudio.crossOrigin = 'anonymous';
      this.externalAudioSource = this.context.createMediaElementSource(this.externalAudio);
      this.externalAudioSource.connect(this.masterGain);
      this.masterGain.connect(this.context.destination);
      this.masterConnected = true;
    }

    this.externalAudio.currentTime = 0;
    this.enabled = true;
    const startPlayback = () => {
      const playPromise = this.externalAudio.play();
      if (playPromise?.then) {
        playPromise
          .then(() => {
            this.externalAudio.volume = 0.8;
            recordAudioDebug('musicStarted', { state: this.context.state, currentTime: Number(this.context.currentTime.toFixed(3)), track: this.trackUrl });
          })
          .catch((error) => {
            recordAudioDebug('musicStartFailed', { reason: getErrorMessage(error), track: this.trackUrl });
            this.enabled = false;
            this.startProceduralFallback();
          });
      }
    };

    if (this.context.state === 'suspended') {
      this.context.resume().then(() => startPlayback()).catch(() => startPlayback());
    } else {
      startPlayback();
    }
  }

  startProceduralFallback() {
    if (this.masterConnected && this.externalAudioSource) {
      this.externalAudioSource.disconnect();
      this.externalAudioSource = null;
      this.externalAudio = null;
    }

    this.delay = this.delay || this.context.createDelay();
    this.delayGain = this.delayGain || this.context.createGain();
    this.delay.delayTime.value = 0.18;
    this.delayGain.gain.value = 0.16;
    if (!this.masterConnected) {
      this.masterGain.connect(this.context.destination);
      this.masterGain.connect(this.delay);
      this.delay.connect(this.delayGain);
      this.delayGain.connect(this.context.destination);
      this.masterConnected = true;
    }

    this.enabled = true;
    this.nextNoteTime = this.context.currentTime + 0.05;
    this.step = 0;
    this.timerId = window.setInterval(() => this.schedule(), MUSIC_CONFIG.lookAheadSeconds * 1000);
    this.schedule();
    recordAudioDebug('musicFallback', { track: this.trackUrl });
  }

  schedule() {
    if (!this.enabled || !this.context) return;

    const secondsPerBeat = 60 / MUSIC_CONFIG.tempo;
    const sixteenth = secondsPerBeat / 2;

    while (this.nextNoteTime < this.context.currentTime + MUSIC_CONFIG.scheduleAheadSeconds) {
      const measureStep = this.step % MUSIC_CONFIG.melody.length;

      this.playTone({
        frequency: noteToFrequency(60 + MUSIC_CONFIG.melody[measureStep]),
        startTime: this.nextNoteTime,
        duration: sixteenth * 0.95,
        type: measureStep % 3 === 0 ? 'triangle' : measureStep % 3 === 1 ? 'sawtooth' : 'sine',
        gain: measureStep % 2 === 0 ? 0.31 : 0.22
      });

      if (measureStep % 4 === 0) {
        const bassIndex = Math.floor(this.step / 4) % MUSIC_CONFIG.bass.length;
        const chord = MUSIC_CONFIG.chords[Math.floor(this.step / 4) % MUSIC_CONFIG.chords.length];
        this.playTone({
          frequency: noteToFrequency(36 + MUSIC_CONFIG.bass[bassIndex]),
          startTime: this.nextNoteTime,
          duration: secondsPerBeat * 1.12,
          type: 'sine',
          gain: 0.78
        });

        for (const note of chord) {
          this.playTone({
            frequency: noteToFrequency(48 + note),
            startTime: this.nextNoteTime,
            duration: sixteenth * 1.6,
            type: 'triangle',
            gain: 0.13
          });
        }
      }

      if (measureStep % 4 === 1 || measureStep % 4 === 3) {
        this.playNoise(this.nextNoteTime, 0.028);
      }

      this.nextNoteTime += sixteenth;
      this.step += 1;
    }
  }

  playTone({ frequency, startTime, duration, type, gain }) {
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    const releaseTime = startTime + duration;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    envelope.gain.setValueAtTime(0.0001, startTime);
    envelope.gain.exponentialRampToValueAtTime(gain, startTime + 0.025);
    envelope.gain.exponentialRampToValueAtTime(gain * 0.46, releaseTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, releaseTime + 0.12);

    oscillator.connect(envelope);
    envelope.connect(this.masterGain);
    oscillator.start(startTime);
    oscillator.stop(releaseTime + 0.16);
  }

  playNoise(startTime, duration) {
    const sampleRate = this.context.sampleRate;
    const buffer = this.context.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
    const data = buffer.getChannelData(0);

    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
    }

    const source = this.context.createBufferSource();
    const envelope = this.context.createGain();
    source.buffer = buffer;
    envelope.gain.setValueAtTime(0.12, startTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    source.connect(envelope);
    envelope.connect(this.masterGain);
    source.start(startTime);
    source.stop(startTime + duration);
  }
}

function lerp(start, end, alpha) {
  return start + (end - start) * alpha;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function noteToFrequency(note) {
  return 440 * (2 ** ((note - 69) / 12));
}

function getSharedAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextClass();
    recordAudioDebug('contextCreated', {
      state: sharedAudioContext.state,
      sampleRate: sharedAudioContext.sampleRate,
      userAgent: navigator.userAgent
    });
    sharedAudioContext.addEventListener?.('statechange', () => {
      recordAudioDebug('statechange', { state: sharedAudioContext.state });
    });
  }
  return sharedAudioContext;
}

function primeAudioOutput(context) {
  if (audioPrimed) return;

  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.setValueAtTime(220, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.05);
  audioPrimed = true;
  recordAudioDebug('primed', { state: context.state });
}

function recordAudioDebug(type, details = {}) {
  if (typeof window === 'undefined') return;

  const debug = window.__audioDebug ?? {
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
  debug.events = debug.events.slice(-24);
  window.__audioDebug = debug;
  updateAudioDebugOverlay(debug);
}

function recordAudioDebugThrottled(type, details = {}, intervalMs = 1000) {
  if (typeof window === 'undefined') return;
  const now = performance.now();
  const key = `__audioDebugLast_${type}`;
  if (window[key] && now - window[key] < intervalMs) return;
  window[key] = now;
  recordAudioDebug(type, details);
}

function updateAudioDebugOverlay(debug) {
  if (typeof document === 'undefined') return;
  if (!new URLSearchParams(window.location.search).has('audioDebug')) return;

  let overlay = document.querySelector('[data-audio-debug]');
  if (!overlay) {
    overlay = document.createElement('pre');
    overlay.dataset.audioDebug = 'true';
    overlay.style.cssText = [
      'position:fixed',
      'left:8px',
      'right:8px',
      'bottom:8px',
      'z-index:30',
      'max-height:38vh',
      'overflow:auto',
      'margin:0',
      'padding:8px',
      'color:#f7fbff',
      'background:rgba(0,0,0,0.76)',
      'font:11px/1.3 monospace',
      'white-space:pre-wrap',
      'pointer-events:none',
      '-webkit-user-select:none',
      'user-select:none'
    ].join(';');
    document.body.appendChild(overlay);
  }

  overlay.textContent = JSON.stringify({
    support: {
      AudioContext: Boolean(window.AudioContext),
      webkitAudioContext: Boolean(window.webkitAudioContext)
    },
    context: sharedAudioContext ? {
      state: sharedAudioContext.state,
      sampleRate: sharedAudioContext.sampleRate,
      currentTime: Number(sharedAudioContext.currentTime.toFixed(3))
    } : null,
    ...debug
  }, null, 2);
}

function getErrorMessage(error) {
  return error?.message ?? String(error);
}
