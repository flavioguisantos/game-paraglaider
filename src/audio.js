const VARIO_AUDIO_CONFIG = {
  liftThreshold: 0.15,
  minInterval: 0.18,
  maxInterval: 0.72,
  minFrequency: 720,
  maxFrequency: 1320,
  beepDuration: 0.075,
  volume: 0.055
};

export function createVarioAudio() {
  return new VarioAudio();
}

class VarioAudio {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.enabled = false;
    this.timeUntilNextBeep = 0;

    this.unlock = this.unlock.bind(this);
    window.addEventListener('pointerdown', this.unlock, { once: true });
    window.addEventListener('keydown', this.unlock, { once: true });
  }

  unlock() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    this.context = this.context || new AudioContextClass();
    this.masterGain = this.masterGain || this.context.createGain();
    this.masterGain.gain.value = VARIO_AUDIO_CONFIG.volume;
    this.masterGain.connect(this.context.destination);

    this.context.resume();
    this.enabled = true;
  }

  update(delta, verticalSpeed, landed) {
    if (!this.enabled || !this.context || landed || verticalSpeed <= VARIO_AUDIO_CONFIG.liftThreshold) {
      this.timeUntilNextBeep = 0;
      return;
    }

    this.timeUntilNextBeep -= delta;
    if (this.timeUntilNextBeep > 0) return;

    const liftFactor = clamp((verticalSpeed - VARIO_AUDIO_CONFIG.liftThreshold) / 4, 0, 1);
    const interval = lerp(VARIO_AUDIO_CONFIG.maxInterval, VARIO_AUDIO_CONFIG.minInterval, liftFactor);
    const frequency = lerp(VARIO_AUDIO_CONFIG.minFrequency, VARIO_AUDIO_CONFIG.maxFrequency, liftFactor);

    this.playBeep(frequency);
    this.timeUntilNextBeep = interval;
  }

  playBeep(frequency) {
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(1, now + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + VARIO_AUDIO_CONFIG.beepDuration);

    oscillator.connect(envelope);
    envelope.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + VARIO_AUDIO_CONFIG.beepDuration + 0.015);
  }
}

function lerp(start, end, alpha) {
  return start + (end - start) * alpha;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
