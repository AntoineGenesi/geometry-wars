/**
 * Procedural Background Music for Geometry Wars
 *
 * Generates a pulsing electronic beat using Web Audio API.
 * The intensity scales with gameplay (enemy count, score multiplier).
 */

export class BackgroundMusic {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bassOsc: OscillatorNode | null = null;
  private bassGain: GainNode | null = null;
  private padOsc1: OscillatorNode | null = null;
  private padOsc2: OscillatorNode | null = null;
  private padGain: GainNode | null = null;
  private kickInterval: ReturnType<typeof setInterval> | null = null;
  private playing = false;
  private _volume = 0.3;
  private intensity = 0.5; // 0-1, scales with gameplay

  // Musical parameters
  private bpm = 128;
  private beatTime: number;
  private readonly bassNotes = [55, 55, 65.4, 55]; // A1, A1, C2, A1
  private bassIndex = 0;

  constructor() {
    this.beatTime = 60 / this.bpm;
  }

  start(audioCtx: AudioContext): void {
    if (this.playing) return;
    this.ctx = audioCtx;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this._volume;
    this.masterGain.connect(this.ctx.destination);

    this.startBassline();
    this.startPad();
    this.startKick();

    this.playing = true;
  }

  stop(): void {
    if (!this.playing) return;

    this.bassOsc?.stop();
    this.bassOsc = null;
    this.padOsc1?.stop();
    this.padOsc1 = null;
    this.padOsc2?.stop();
    this.padOsc2 = null;

    if (this.kickInterval) {
      clearInterval(this.kickInterval);
      this.kickInterval = null;
    }

    this.masterGain?.disconnect();
    this.masterGain = null;
    this.playing = false;
  }

  /** Set intensity 0-1 based on gameplay (more enemies = more intense) */
  setIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, value));
    this.updateIntensity();
  }

  get volume(): number { return this._volume; }

  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) {
      this.masterGain.gain.value = this._volume;
    }
  }

  get isPlaying(): boolean { return this.playing; }

  // -------------------------------------------------------------------------
  // Components
  // -------------------------------------------------------------------------

  private startBassline(): void {
    if (!this.ctx || !this.masterGain) return;

    this.bassOsc = this.ctx.createOscillator();
    this.bassOsc.type = 'sawtooth';
    this.bassOsc.frequency.value = this.bassNotes[0];

    // Low-pass filter for warmth
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;
    filter.Q.value = 5;

    this.bassGain = this.ctx.createGain();
    this.bassGain.gain.value = 0.15;

    this.bassOsc.connect(filter);
    filter.connect(this.bassGain);
    this.bassGain.connect(this.masterGain);

    this.bassOsc.start();

    // Cycle bass notes
    this.scheduleBassNotes();
  }

  private scheduleBassNotes(): void {
    const cycleNote = () => {
      if (!this.bassOsc || !this.ctx) return;
      this.bassIndex = (this.bassIndex + 1) % this.bassNotes.length;
      this.bassOsc.frequency.setValueAtTime(this.bassNotes[this.bassIndex], this.ctx.currentTime);
    };

    // Change note every 2 beats
    setInterval(cycleNote, this.beatTime * 2 * 1000);
  }

  private startPad(): void {
    if (!this.ctx || !this.masterGain) return;

    // Two detuned oscillators for a wide pad sound
    this.padOsc1 = this.ctx.createOscillator();
    this.padOsc1.type = 'sine';
    this.padOsc1.frequency.value = 220; // A3

    this.padOsc2 = this.ctx.createOscillator();
    this.padOsc2.type = 'sine';
    this.padOsc2.frequency.value = 330; // E4 (perfect fifth)

    this.padGain = this.ctx.createGain();
    this.padGain.gain.value = 0.04;

    this.padOsc1.connect(this.padGain);
    this.padOsc2.connect(this.padGain);
    this.padGain.connect(this.masterGain);

    this.padOsc1.start();
    this.padOsc2.start();
  }

  private startKick(): void {
    // Kick drum every beat
    this.kickInterval = setInterval(() => {
      this.playKick();
    }, this.beatTime * 1000);
  }

  private playKick(): void {
    if (!this.ctx || !this.masterGain) return;

    const t = this.ctx.currentTime;

    // Sine wave with fast pitch drop = kick drum
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.1);

    const env = this.ctx.createGain();
    const kickVol = 0.15 + this.intensity * 0.1;
    env.gain.setValueAtTime(kickVol, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(env);
    env.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.15);

    // Hi-hat on offbeats at higher intensity
    if (this.intensity > 0.4) {
      const hatDelay = this.beatTime / 2;
      const hatOsc = this.ctx.createOscillator();
      hatOsc.type = 'square';
      hatOsc.frequency.value = 8000;

      const hatEnv = this.ctx.createGain();
      const hatVol = 0.02 + (this.intensity - 0.4) * 0.05;
      hatEnv.gain.setValueAtTime(0.0, t + hatDelay);
      hatEnv.gain.linearRampToValueAtTime(hatVol, t + hatDelay + 0.005);
      hatEnv.gain.exponentialRampToValueAtTime(0.001, t + hatDelay + 0.03);

      const hatFilter = this.ctx.createBiquadFilter();
      hatFilter.type = 'highpass';
      hatFilter.frequency.value = 7000;

      hatOsc.connect(hatFilter);
      hatFilter.connect(hatEnv);
      hatEnv.connect(this.masterGain);
      hatOsc.start(t + hatDelay);
      hatOsc.stop(t + hatDelay + 0.03);
    }
  }

  private updateIntensity(): void {
    // Scale pad volume with intensity
    if (this.padGain) {
      this.padGain.gain.value = 0.02 + this.intensity * 0.05;
    }
    // Scale bass volume
    if (this.bassGain) {
      this.bassGain.gain.value = 0.1 + this.intensity * 0.1;
    }
  }
}
