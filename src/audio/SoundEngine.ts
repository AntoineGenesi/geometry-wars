/**
 * Procedural Sound Engine for Geometry Wars
 *
 * All sounds are synthesized via Web Audio API - no external audio files needed.
 * Matches the electronic/synth aesthetic of GW3D.
 *
 * Throttling system:
 * - Per-type max concurrent instances (e.g., max 3 simultaneous "shoot" sounds)
 * - Global max concurrent sounds (16 total)
 * - Rate limiting with minimum intervals per type
 * - Active sound tracking with automatic expiry
 * - Cached distortion curves (zero allocation in hot paths)
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

// Pre-computed duration of each sound type (seconds).
// Used to track when active sounds expire without callbacks.
const SOUND_DURATIONS: Record<SoundType, number> = {
  shoot: 0.08,
  enemyDeath: 0.15,
  playerDeath: 0.8,
  bomb: 0.8,
  geomPickup: 0.06,
  multiplierUp: 0.22,   // 3 notes * 0.06 offset + 0.1 duration
  weaponPickup: 0.3,
  shieldHit: 0.15,
  spawn: 0.2,
  menuSelect: 0.15,
  menuHover: 0.03,
};

// ---------------------------------------------------------------------------
// SoundEngine
// ---------------------------------------------------------------------------

/** Global max concurrent audio voices across all types */
const GLOBAL_MAX_VOICES = 16;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private _volume = 0.5;
  private _muted = false;
  private initialized = false;

  // Rate limiting: minimum seconds between triggers of same type
  private lastPlayTime: Map<SoundType, number> = new Map();
  private readonly minInterval: Map<SoundType, number> = new Map([
    ['shoot', 0.05],        // Max 20/sec
    ['enemyDeath', 0.04],   // Max 25/sec (tightened from 0.03)
    ['geomPickup', 0.03],   // Max ~33/sec
    ['bomb', 0.15],         // Max ~6/sec (bombs overlap badly)
    ['shieldHit', 0.08],    // Max ~12/sec
    ['spawn', 0.1],         // Max 10/sec
    ['multiplierUp', 0.2],  // Max 5/sec (long sound)
    ['weaponPickup', 0.3],  // Max ~3/sec (one at a time feel)
    ['playerDeath', 0.5],   // Max 2/sec
    ['menuSelect', 0.1],    // Max 10/sec
    ['menuHover', 0.05],    // Max 20/sec
  ]);

  // Per-type max concurrent instances
  private readonly maxPerType: Map<SoundType, number> = new Map([
    ['shoot', 3],
    ['enemyDeath', 4],
    ['playerDeath', 1],
    ['bomb', 2],
    ['geomPickup', 3],
    ['multiplierUp', 1],
    ['weaponPickup', 1],
    ['shieldHit', 2],
    ['spawn', 2],
    ['menuSelect', 1],
    ['menuHover', 1],
  ]);

  // Active sound tracking: per-type arrays of expiry times.
  // Pre-allocated arrays to avoid allocation in play().
  // Each entry is the AudioContext.currentTime when the sound ends.
  private readonly activeExpiry: Map<SoundType, number[]> = new Map();

  // Global active voice count (sum of all per-type active sounds)
  private globalActiveCount = 0;

  // Cached distortion curves (keyed by amount) — avoids Float32Array allocation per play
  private readonly distortionCache: Map<number, Float32Array<ArrayBuffer>> = new Map();

  constructor() {
    // Pre-allocate expiry arrays for all types
    const allTypes: SoundType[] = [
      'shoot', 'enemyDeath', 'playerDeath', 'bomb', 'geomPickup',
      'multiplierUp', 'weaponPickup', 'shieldHit', 'spawn',
      'menuSelect', 'menuHover',
    ];
    for (const type of allTypes) {
      const maxSlots = this.maxPerType.get(type) ?? 2;
      this.activeExpiry.set(type, new Array<number>(maxSlots).fill(0));
    }
  }

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
   * Play a sound effect. Returns false if the sound was throttled/skipped.
   */
  play(type: SoundType, options: SoundOptions = {}): boolean {
    if (!this.ctx || !this.masterGain || this._muted) return false;

    const now = this.ctx.currentTime;

    // 1) Rate limit: minimum interval between triggers of the same type
    const minInt = this.minInterval.get(type) ?? 0;
    const lastTime = this.lastPlayTime.get(type) ?? 0;
    if (now - lastTime < minInt) return false;

    // 2) Per-type concurrent limit: count active (non-expired) instances
    const expiry = this.activeExpiry.get(type);
    if (expiry) {
      // Compact: count still-active, find an expired slot
      let activeCount = 0;
      let freeSlot = -1;
      for (let i = 0; i < expiry.length; i++) {
        if (expiry[i] > now) {
          activeCount++;
        } else if (freeSlot === -1) {
          freeSlot = i;
        }
      }

      const maxConcurrent = this.maxPerType.get(type) ?? 2;
      if (activeCount >= maxConcurrent) return false;

      // 3) Global concurrent limit
      // Recount global active (lazy: sum all types' active)
      this.recomputeGlobalCount(now);
      if (this.globalActiveCount >= GLOBAL_MAX_VOICES) return false;

      // Claim a slot
      const duration = SOUND_DURATIONS[type];
      if (freeSlot !== -1) {
        expiry[freeSlot] = now + duration;
      }
      // If no free slot found (shouldn't happen since activeCount < max), skip tracking
      this.globalActiveCount++;
    }

    // Record play time for rate limiting
    this.lastPlayTime.set(type, now);

    const vol = options.volume ?? 1.0;
    const pitch = options.pitch ?? 1.0;
    const pan = options.pan ?? 0;

    // Create output chain: source -> gain -> panner -> master
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

    return true;
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

  /** Get current number of active audio voices (for debug overlay) */
  get activeVoiceCount(): number {
    if (!this.ctx) return 0;
    this.recomputeGlobalCount(this.ctx.currentTime);
    return this.globalActiveCount;
  }

  // -------------------------------------------------------------------------
  // Active voice tracking
  // -------------------------------------------------------------------------

  /** Recompute globalActiveCount by scanning all per-type expiry arrays */
  private recomputeGlobalCount(now: number): void {
    let total = 0;
    for (const expiry of this.activeExpiry.values()) {
      for (let i = 0; i < expiry.length; i++) {
        if (expiry[i] > now) {
          total++;
        }
      }
    }
    this.globalActiveCount = total;
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

    // Add some grit (cached distortion curve)
    const distortion = ctx.createWaveShaper();
    distortion.curve = this.getCachedDistortionCurve(20);

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
    distortion.curve = this.getCachedDistortionCurve(50);

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
    distortion.curve = this.getCachedDistortionCurve(80);

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

  /** Get a cached distortion curve, creating it on first use */
  private getCachedDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
    let curve = this.distortionCache.get(amount);
    if (!curve) {
      curve = this.makeDistortionCurve(amount);
      this.distortionCache.set(amount, curve);
    }
    return curve;
  }

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
    this.globalActiveCount = 0;
    this.distortionCache.clear();
    for (const expiry of this.activeExpiry.values()) {
      expiry.fill(0);
    }
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
