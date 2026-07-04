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
  volume: 0.058,
  tempo: 132,
  lookAheadSeconds: 0.09,
  scheduleAheadSeconds: 0.75,
  melody: [0, 4, 7, 12, 10, 7, 5, 7, 3, 7, 10, 15, 12, 10, 7, 5],
  bass: [0, 0, 7, 7, 5, 5, 3, 3],
  chords: [
    [0, 4, 7],
    [7, 10, 14],
    [5, 9, 12],
    [3, 7, 10]
  ]
};

export function createVarioAudio() {
  return new VarioAudio();
}

export function createAdventureMusic() {
  return new AdventureMusic();
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

    const liftFactor = clamp((verticalSpeed - VARIO_AUDIO_CONFIG.liftThreshold) / 5, 0, 1);
    const interval = lerp(VARIO_AUDIO_CONFIG.maxInterval, VARIO_AUDIO_CONFIG.minInterval, liftFactor);
    const frequency = lerp(VARIO_AUDIO_CONFIG.minFrequency, VARIO_AUDIO_CONFIG.maxFrequency, liftFactor);

    this.playBeep(frequency, liftFactor);
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

class AdventureMusic {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.delay = null;
    this.delayGain = null;
    this.enabled = false;
    this.nextNoteTime = 0;
    this.step = 0;
    this.timerId = null;
  }

  start() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || this.enabled) return;

    this.context = this.context || new AudioContextClass();
    this.masterGain = this.masterGain || this.context.createGain();
    this.delay = this.delay || this.context.createDelay();
    this.delayGain = this.delayGain || this.context.createGain();

    this.masterGain.gain.value = MUSIC_CONFIG.volume;
    this.delay.delayTime.value = 0.22;
    this.delayGain.gain.value = 0.14;
    this.masterGain.connect(this.context.destination);
    this.masterGain.connect(this.delay);
    this.delay.connect(this.delayGain);
    this.delayGain.connect(this.context.destination);

    this.context.resume();
    this.enabled = true;
    this.nextNoteTime = this.context.currentTime + 0.05;
    this.step = 0;
    this.timerId = window.setInterval(() => this.schedule(), MUSIC_CONFIG.lookAheadSeconds * 1000);
    this.schedule();
  }

  stop() {
    if (!this.enabled) return;

    this.enabled = false;
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
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
        duration: sixteenth * 0.92,
        type: measureStep % 2 === 0 ? 'triangle' : 'sine',
        gain: measureStep % 2 === 0 ? 0.34 : 0.24
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
            duration: sixteenth * 1.55,
            type: 'triangle',
            gain: 0.12
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
