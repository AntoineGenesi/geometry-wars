/**
 * Procedural Sound Engine for Geometry Wars
 *
 * All sounds are synthesized via Web Audio API - no external audio files needed.
 * Matches the electronic/synth aesthetic of GW3D.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SoundType =
  | 'shoot'
  | 'enemyDeath'
  | 'playerDeath'
  | 'bomb'
  | 'geomPickup'
  | 'multiplierUp'
  | 'weaponPickup'
  | 'shieldHit'
  | 'spawn'
  | 'menuSelect'
  | 'menuHover';

interface SoundOptions {
  volume?: number;
  pitch?: number; // multiplier (1.0 = normal)
  pan?: number;   // -1 (left) to 1 (right)
}

// ---------------------------------------------------------------------------
// SoundEngine
// ---------------------------------------------------------------------------

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private _volume = 0.5;
  private _muted = false;
  private initialized = false;

  // Rate limiting for rapid sounds
  private lastPlayTime: Map<SoundType, number> = new Map();
  private minInterval: Map<SoundType, number> = new Map([
    ['shoot', 0.05],       // Max 20 shots/sec
    ['enemyDeath', 0.03],  // Rapid kills allowed
    ['geomPickup', 0.02],  // Very rapid pickups
  ]);

  /**
   * Initialize audio context. Must be called from a user gesture (click/keypress).
   */
  init(): void {
    if (this.initialized) return;

    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this._volume;
      this.masterGain.connect(this.ctx.destination);
      this.initialized = true;
    } catch (e) {
      console.warn('[SoundEngine] Web Audio not available:', e);
    }
  }

  /**
   * Resume audio context (needed after user interaction on some browsers).
   */
  resume(): void {
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Play a sound effect.
   */
  play(type: SoundType, options: SoundOptions = {}): void {
    if (!this.ctx || !this.masterGain || this._muted) return;

    // Rate limit
    const now = this.ctx.currentTime;
    const minInt = this.minInterval.get(type) ?? 0;
    const lastTime = this.lastPlayTime.get(type) ?? 0;
    if (now - lastTime < minInt) return;
    this.lastPlayTime.set(type, now);

    const vol = options.volume ?? 1.0;
    const pitch = options.pitch ?? 1.0;
    const pan = options.pan ?? 0;

    // Create output chain: source → gain → panner → master
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = vol;

    const panNode = this.ctx.createStereoPanner();
    panNode.pan.value = pan;

    gainNode.connect(panNode);
    panNode.connect(this.masterGain);

    switch (type) {
      case 'shoot':
        this.synthShoot(gainNode, pitch);
        break;
      case 'enemyDeath':
        this.synthEnemyDeath(gainNode, pitch);
        break;
      case 'playerDeath':
        this.synthPlayerDeath(gainNode);
        break;
      case 'bomb':
        this.synthBomb(gainNode);
        break;
      case 'geomPickup':
        this.synthGeomPickup(gainNode, pitch);
        break;
      case 'multiplierUp':
        this.synthMultiplierUp(gainNode);
        break;
      case 'weaponPickup':
        this.synthWeaponPickup(gainNode);
        break;
      case 'shieldHit':
        this.synthShieldHit(gainNode);
        break;
      case 'spawn':
        this.synthSpawn(gainNode);
        break;
      case 'menuSelect':
        this.synthMenuSelect(gainNode);
        break;
      case 'menuHover':
        this.synthMenuHover(gainNode);
        break;
    }
  }

  /** Get the AudioContext (for BackgroundMusic integration) */
  getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  get volume(): number { return this._volume; }

  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) {
      this.masterGain.gain.value = this._volume;
    }
  }

  get muted(): boolean { return this._muted; }

  set muted(m: boolean) {
    this._muted = m;
  }

  // -------------------------------------------------------------------------
  // Sound Synthesis
  // -------------------------------------------------------------------------

  /** Shoot: short bright zap */
  private synthShoot(dest: GainNode, pitch: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(220 * pitch, t + 0.06);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.15, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(env);
    env.connect(dest);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  /** Enemy death: descending noise burst */
  private synthEnemyDeath(dest: GainNode, pitch: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    // Noise burst via oscillator detuning
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.15);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.12, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    // Add some grit
    const distortion = ctx.createWaveShaper();
    distortion.curve = this.makeDistortionCurve(20);

    osc.connect(distortion);
    distortion.connect(env);
    env.connect(dest);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  /** Player death: dramatic descending sweep + noise */
  private synthPlayerDeath(dest: GainNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    // Low sweep
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(400, t);
    osc1.frequency.exponentialRampToValueAtTime(40, t + 0.8);

    const env1 = ctx.createGain();
    env1.gain.setValueAtTime(0.25, t);
    env1.gain.linearRampToValueAtTime(0.0, t + 0.8);

    osc1.connect(env1);
    env1.connect(dest);
    osc1.start(t);
    osc1.stop(t + 0.8);

    // High noise burst
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(1200, t);
    osc2.frequency.exponentialRampToValueAtTime(100, t + 0.5);

    const env2 = ctx.createGain();
    env2.gain.setValueAtTime(0.15, t);
    env2.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

    const distortion = ctx.createWaveShaper();
    distortion.curve = this.makeDistortionCurve(50);

    osc2.connect(distortion);
    distortion.connect(env2);
    env2.connect(dest);
    osc2.start(t);
    osc2.stop(t + 0.5);
  }

  /** Bomb: massive bass explosion + white noise sweep */
  private synthBomb(dest: GainNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    // Sub-bass thud
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(80, t);
    osc1.frequency.exponentialRampToValueAtTime(20, t + 0.6);

    const env1 = ctx.createGain();
    env1.gain.setValueAtTime(0.4, t);
    env1.gain.linearRampToValueAtTime(0.0, t + 0.6);

    osc1.connect(env1);
    env1.connect(dest);
    osc1.start(t);
    osc1.stop(t + 0.6);

    // Noise sweep (using detuned oscillator pair for pseudo-noise)
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(2000, t);
    osc2.frequency.exponentialRampToValueAtTime(50, t + 0.8);

    const osc3 = ctx.createOscillator();
    osc3.type = 'sawtooth';
    osc3.frequency.setValueAtTime(2007, t); // Slight detune for beating/noise
    osc3.frequency.exponentialRampToValueAtTime(53, t + 0.8);

    const env2 = ctx.createGain();
    env2.gain.setValueAtTime(0.15, t);
    env2.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

    const distortion = ctx.createWaveShaper();
    distortion.curve = this.makeDistortionCurve(80);

    osc2.connect(distortion);
    osc3.connect(distortion);
    distortion.connect(env2);
    env2.connect(dest);
    osc2.start(t);
    osc3.start(t);
    osc2.stop(t + 0.8);
    osc3.stop(t + 0.8);
  }

  /** Geom pickup: quick ascending blip */
  private synthGeomPickup(dest: GainNode, pitch: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(1600 * pitch, t + 0.04);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.1, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    osc.connect(env);
    env.connect(dest);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  /** Multiplier increase: ascending arpeggio */
  private synthMultiplierUp(dest: GainNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    const notes = [523, 659, 784]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0, t + i * 0.06);
      env.gain.linearRampToValueAtTime(0.1, t + i * 0.06 + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.1);

      osc.connect(env);
      env.connect(dest);
      osc.start(t + i * 0.06);
      osc.stop(t + i * 0.06 + 0.1);
    });
  }

  /** Weapon pickup: power-up sweep */
  private synthWeaponPickup(dest: GainNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.2);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.15, t);
    env.gain.linearRampToValueAtTime(0.2, t + 0.1);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

    osc.connect(env);
    env.connect(dest);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  /** Shield hit: metallic clang */
  private synthShieldHit(dest: GainNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1500, t);
    osc.frequency.exponentialRampToValueAtTime(500, t + 0.1);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.2, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(env);
    env.connect(dest);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  /** Enemy spawn: low rising tone */
  private synthSpawn(dest: GainNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(100, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.2);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0, t);
    env.gain.linearRampToValueAtTime(0.08, t + 0.05);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    osc.connect(env);
    env.connect(dest);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** Menu select: bright confirmation beep */
  private synthMenuSelect(dest: GainNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.setValueAtTime(880, t + 0.06);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.12, t);
    env.gain.setValueAtTime(0.12, t + 0.1);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(env);
    env.connect(dest);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  /** Menu hover: soft tick */
  private synthMenuHover(dest: GainNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1200;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.05, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.03);

    osc.connect(env);
    env.connect(dest);
    osc.start(t);
    osc.stop(t + 0.03);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Create distortion curve for waveshaper */
  private makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
    const samples = 256;
    const buffer = new ArrayBuffer(samples * 4);
    const curve = new Float32Array(buffer);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  dispose(): void {
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.masterGain = null;
    this.initialized = false;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: SoundEngine | null = null;

export function getSoundEngine(): SoundEngine {
  if (!_instance) {
    _instance = new SoundEngine();
  }
  return _instance;
}
