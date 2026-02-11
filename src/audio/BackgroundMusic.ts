/**
 * Procedural Background Music for Geometry Wars
 *
 * Generates music using Web Audio API with multiple preset styles.
 * The intensity scales with gameplay (enemy count, score multiplier).
 *
 * Presets:
 *   - Electronic: Pulsing 128bpm beat (original)
 *   - Ambient: Slow evolving pads, gentle arpeggios, no percussion
 *   - Synthwave: Retro 80s synth pads, driving ~100bpm rhythm
 *   - Minimal: Sparse clicks, deep sub-bass, subtle melodic fragments
 */

export type MusicPreset = 'electronic' | 'ambient' | 'synthwave' | 'minimal';

const STORAGE_KEY = 'gw3d-music-preset';
const ALL_PRESETS: MusicPreset[] = ['electronic', 'ambient', 'synthwave', 'minimal'];

export class BackgroundMusic {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private playing = false;
  private _volume = 0.3;
  private intensity = 0.5;
  private currentPreset: MusicPreset;

  // Active audio nodes that need cleanup
  private activeOscillators: OscillatorNode[] = [];
  private activeGains: GainNode[] = [];
  private activeIntervals: ReturnType<typeof setInterval>[] = [];
  private activeTimeouts: ReturnType<typeof setTimeout>[] = [];
  private activeFilters: BiquadFilterNode[] = [];
  private activeDelays: DelayNode[] = [];

  // Preset-specific state references for intensity updates
  private padGain: GainNode | null = null;
  private bassGain: GainNode | null = null;

  constructor() {
    this.currentPreset = this.loadPreset();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start background music.
   * @param audioCtx The shared AudioContext
   * @param destinationOverride Optional node to route through (e.g. compressor/limiter).
   *   If not provided, routes directly to ctx.destination.
   */
  start(audioCtx: AudioContext, destinationOverride?: AudioNode): void {
    if (this.playing) return;
    this.ctx = audioCtx;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this._volume;
    this.masterGain.connect(destinationOverride ?? this.ctx.destination);

    this.startPreset(this.currentPreset);
    this.playing = true;
  }

  stop(): void {
    if (!this.playing) return;
    this.cleanupActiveNodes();
    this.masterGain?.disconnect();
    this.masterGain = null;
    this.padGain = null;
    this.bassGain = null;
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

  /** Get current preset name */
  get preset(): MusicPreset { return this.currentPreset; }

  /** Get all available preset names */
  getPresets(): MusicPreset[] {
    return [...ALL_PRESETS];
  }

  /** Get display name for a preset */
  getPresetDisplayName(preset?: MusicPreset): string {
    const p = preset ?? this.currentPreset;
    const names: Record<MusicPreset, string> = {
      electronic: 'Electronic',
      ambient: 'Ambient',
      synthwave: 'Synthwave',
      minimal: 'Minimal',
    };
    return names[p];
  }

  /** Switch to a specific preset */
  setPreset(name: MusicPreset): void {
    if (!ALL_PRESETS.includes(name)) return;
    this.currentPreset = name;
    this.savePreset(name);

    if (this.playing && this.ctx && this.masterGain) {
      this.cleanupActiveNodes();
      this.padGain = null;
      this.bassGain = null;
      this.startPreset(name);
    }
  }

  /** Cycle to the next preset and return its name */
  cyclePreset(): MusicPreset {
    const idx = ALL_PRESETS.indexOf(this.currentPreset);
    const next = ALL_PRESETS[(idx + 1) % ALL_PRESETS.length];
    this.setPreset(next);
    return next;
  }

  // ---------------------------------------------------------------------------
  // Preset routing
  // ---------------------------------------------------------------------------

  private startPreset(name: MusicPreset): void {
    switch (name) {
      case 'electronic':
        this.startElectronic();
        break;
      case 'ambient':
        this.startAmbient();
        break;
      case 'synthwave':
        this.startSynthwave();
        break;
      case 'minimal':
        this.startMinimal();
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  private cleanupActiveNodes(): void {
    for (const osc of this.activeOscillators) {
      try { osc.stop(); } catch (_) { /* already stopped */ }
    }
    this.activeOscillators = [];

    for (const interval of this.activeIntervals) {
      clearInterval(interval);
    }
    this.activeIntervals = [];

    for (const timeout of this.activeTimeouts) {
      clearTimeout(timeout);
    }
    this.activeTimeouts = [];

    for (const gain of this.activeGains) {
      try { gain.disconnect(); } catch (_) { /* ok */ }
    }
    this.activeGains = [];

    for (const filter of this.activeFilters) {
      try { filter.disconnect(); } catch (_) { /* ok */ }
    }
    this.activeFilters = [];

    for (const delay of this.activeDelays) {
      try { delay.disconnect(); } catch (_) { /* ok */ }
    }
    this.activeDelays = [];
  }

  // ---------------------------------------------------------------------------
  // Helpers: node creation with auto-tracking
  // ---------------------------------------------------------------------------

  private createOsc(type: OscillatorType, freq: number): OscillatorNode {
    const osc = this.ctx!.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    this.activeOscillators.push(osc);
    return osc;
  }

  private createGain(value: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = value;
    this.activeGains.push(g);
    return g;
  }

  private createFilter(type: BiquadFilterType, freq: number, q?: number): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    this.activeFilters.push(f);
    return f;
  }

  private createDelay(time: number, maxDelay?: number): DelayNode {
    const d = this.ctx!.createDelay(maxDelay ?? 5);
    d.delayTime.value = time;
    this.activeDelays.push(d);
    return d;
  }

  private addInterval(fn: () => void, ms: number): void {
    this.activeIntervals.push(setInterval(fn, ms));
  }

  private addTimeout(fn: () => void, ms: number): void {
    this.activeTimeouts.push(setTimeout(fn, ms));
  }

  // ---------------------------------------------------------------------------
  // PRESET 1: Electronic (original 128bpm beat)
  // ---------------------------------------------------------------------------

  private startElectronic(): void {
    if (!this.ctx || !this.masterGain) return;

    const bpm = 128;
    const beatTime = 60 / bpm;

    // --- Bassline ---
    const bassNotes = [55, 55, 65.4, 55]; // A1, A1, C2, A1
    let bassIndex = 0;

    const bassOsc = this.createOsc('sawtooth', bassNotes[0]);
    const bassFilter = this.createFilter('lowpass', 200, 5);
    this.bassGain = this.createGain(0.15);

    bassOsc.connect(bassFilter);
    bassFilter.connect(this.bassGain);
    this.bassGain.connect(this.masterGain);
    bassOsc.start();

    this.addInterval(() => {
      if (!this.ctx) return;
      bassIndex = (bassIndex + 1) % bassNotes.length;
      bassOsc.frequency.setValueAtTime(bassNotes[bassIndex], this.ctx.currentTime);
    }, beatTime * 2 * 1000);

    // --- Pad ---
    const padOsc1 = this.createOsc('sine', 220); // A3
    const padOsc2 = this.createOsc('sine', 330); // E4
    this.padGain = this.createGain(0.04);

    padOsc1.connect(this.padGain);
    padOsc2.connect(this.padGain);
    this.padGain.connect(this.masterGain);
    padOsc1.start();
    padOsc2.start();

    // --- Kick drum ---
    this.addInterval(() => {
      this.playElectronicKick(beatTime);
    }, beatTime * 1000);
  }

  private playElectronicKick(beatTime: number): void {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;

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
      const hatDelay = beatTime / 2;
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

  // ---------------------------------------------------------------------------
  // PRESET 2: Ambient (slow pads, gentle arpeggios, no percussion)
  //   Brian Eno meets Tycho - dreamy, spacey, flow-state
  //   Key: A minor pentatonic. Long envelopes, delay-based reverb.
  // ---------------------------------------------------------------------------

  private startAmbient(): void {
    if (!this.ctx || !this.masterGain) return;

    // A minor pentatonic frequencies across octaves
    // A2=110, C3=130.81, D3=146.83, E3=164.81, G3=196
    // A3=220, C4=261.63, D4=293.66, E4=329.63, G4=392
    const padNotes = [110, 130.81, 164.81, 196, 220];
    const arpNotes = [220, 261.63, 329.63, 392, 523.25, 392, 329.63, 261.63];

    // --- Drone pad layer (two detuned saws through heavy lowpass + delay) ---
    const droneGain = this.createGain(0.0);
    this.padGain = droneGain;
    droneGain.connect(this.masterGain);

    // Slow fade in
    droneGain.gain.linearRampToValueAtTime(0.06, this.ctx.currentTime + 3);

    const drone1 = this.createOsc('sawtooth', padNotes[0]);
    const drone2 = this.createOsc('sawtooth', padNotes[0] * 1.003); // slight detune for warmth
    const drone3 = this.createOsc('sine', padNotes[0] * 2); // octave harmonic

    const droneFilter = this.createFilter('lowpass', 400, 1);
    // LFO on filter cutoff for slow movement
    const filterLfo = this.createOsc('sine', 0.05); // one cycle every 20 seconds
    const filterLfoGain = this.createGain(200);
    filterLfo.connect(filterLfoGain);
    filterLfoGain.connect(droneFilter.frequency);
    filterLfo.start();

    drone1.connect(droneFilter);
    drone2.connect(droneFilter);
    drone3.connect(droneFilter);
    droneFilter.connect(droneGain);

    drone1.start();
    drone2.start();
    drone3.start();

    // Slowly evolve the drone chord - cycle through pad notes every 12 seconds
    let padIdx = 0;
    this.addInterval(() => {
      if (!this.ctx) return;
      padIdx = (padIdx + 1) % padNotes.length;
      const t = this.ctx.currentTime;
      const baseFreq = padNotes[padIdx];
      drone1.frequency.exponentialRampToValueAtTime(baseFreq, t + 4);
      drone2.frequency.exponentialRampToValueAtTime(baseFreq * 1.003, t + 4);
      drone3.frequency.exponentialRampToValueAtTime(baseFreq * 2, t + 4);
    }, 12000);

    // --- Delay-based reverb (feedback delay network) ---
    const reverbSend = this.createGain(0.3);
    droneGain.connect(reverbSend);

    const delay1 = this.createDelay(0.37);
    const delay2 = this.createDelay(0.53);
    const fb1 = this.createGain(0.4);
    const fb2 = this.createGain(0.35);
    const reverbFilter = this.createFilter('lowpass', 2000, 0.5);

    reverbSend.connect(delay1);
    delay1.connect(fb1);
    fb1.connect(reverbFilter);
    reverbFilter.connect(delay2);
    delay2.connect(fb2);
    fb2.connect(delay1); // feedback loop
    delay1.connect(this.masterGain);
    delay2.connect(this.masterGain);

    // --- Gentle arpeggio (triangle wave, slow, through delay) ---
    let arpIdx = 0;
    const arpGain = this.createGain(0.0);
    this.bassGain = arpGain; // reuse for intensity
    arpGain.connect(this.masterGain);
    // Also send arp to reverb
    const arpReverbSend = this.createGain(0.5);
    arpGain.connect(arpReverbSend);
    arpReverbSend.connect(delay1);

    // Play one arp note every 1.5 seconds
    this.addInterval(() => {
      if (!this.ctx || !this.masterGain) return;
      const t = this.ctx.currentTime;
      const freq = arpNotes[arpIdx % arpNotes.length];
      arpIdx++;

      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const env = this.ctx.createGain();
      // Soft attack, long release
      env.gain.setValueAtTime(0.0, t);
      env.gain.linearRampToValueAtTime(0.06 + this.intensity * 0.03, t + 0.3);
      env.gain.exponentialRampToValueAtTime(0.001, t + 2.5);

      osc.connect(env);
      env.connect(arpGain);
      osc.start(t);
      osc.stop(t + 2.5);
    }, 1500);

    // --- High shimmer layer (very quiet sine harmonics) ---
    const shimmer1 = this.createOsc('sine', 1318.5); // E6
    const shimmer2 = this.createOsc('sine', 1568);   // G6
    const shimmerGain = this.createGain(0.008);
    const shimmerFilter = this.createFilter('bandpass', 1400, 2);

    // Tremolo LFO on shimmer
    const shimmerLfo = this.createOsc('sine', 0.15);
    const shimmerLfoGain = this.createGain(0.006);
    shimmerLfo.connect(shimmerLfoGain);
    shimmerLfoGain.connect(shimmerGain.gain);
    shimmerLfo.start();

    shimmer1.connect(shimmerFilter);
    shimmer2.connect(shimmerFilter);
    shimmerFilter.connect(shimmerGain);
    shimmerGain.connect(this.masterGain);
    shimmer1.start();
    shimmer2.start();
  }

  // ---------------------------------------------------------------------------
  // PRESET 3: Synthwave (retro 80s, ~100bpm, saw pads + driving bass)
  //   Kavinsky/Perturbator but calmer. Key: D minor.
  //   Detuned saw pads, steady kick/snare, arpeggiated bass.
  // ---------------------------------------------------------------------------

  private startSynthwave(): void {
    if (!this.ctx || !this.masterGain) return;

    const bpm = 100;
    const beatTime = 60 / bpm;
    const t0 = this.ctx.currentTime;

    // D minor: D E F A Bb
    // D2=73.42, A2=110, D3=146.83, F3=174.61, A3=220, D4=293.66

    // --- Saw pad chord (Dm7) with chorus: D3 + F3 + A3 + C4 ---
    const chordFreqs = [146.83, 174.61, 220, 261.63];
    this.padGain = this.createGain(0.0);
    this.padGain.connect(this.masterGain);
    // Slow fade in
    this.padGain.gain.linearRampToValueAtTime(0.05, t0 + 2);

    const padFilter = this.createFilter('lowpass', 800, 2);
    // LFO sweep on filter for movement
    const padLfo = this.createOsc('sine', 0.08); // slow sweep
    const padLfoGain = this.createGain(400);
    padLfo.connect(padLfoGain);
    padLfoGain.connect(padFilter.frequency);
    padLfo.start();

    padFilter.connect(this.padGain);

    for (const freq of chordFreqs) {
      // Two detuned saws per voice for chorus effect
      const osc1 = this.createOsc('sawtooth', freq);
      const osc2 = this.createOsc('sawtooth', freq * 1.005);
      osc1.connect(padFilter);
      osc2.connect(padFilter);
      osc1.start();
      osc2.start();
    }

    // Chord progression: Dm7 -> Bbmaj7 -> Gm7 -> Am7 (cycle every 16 beats)
    const chordProgressions = [
      [146.83, 174.61, 220, 261.63],    // Dm7:  D F A C
      [116.54, 146.83, 174.61, 220],    // Bbmaj7: Bb D F A
      [98, 116.54, 146.83, 174.61],     // Gm7:  G Bb D F
      [110, 130.81, 164.81, 196],       // Am7:  A C E G
    ];
    let chordIdx = 0;

    this.addInterval(() => {
      if (!this.ctx) return;
      chordIdx = (chordIdx + 1) % chordProgressions.length;
      const chord = chordProgressions[chordIdx];
      const ct = this.ctx.currentTime;
      // Smoothly glide the existing oscillators to new chord
      let oscIdx = 0;
      for (const osc of this.activeOscillators) {
        if (osc.type === 'sawtooth' && oscIdx < chord.length * 2) {
          const noteIdx = Math.floor(oscIdx / 2);
          const isDetuned = oscIdx % 2 === 1;
          const targetFreq = chord[noteIdx] * (isDetuned ? 1.005 : 1);
          osc.frequency.exponentialRampToValueAtTime(targetFreq, ct + 2);
          oscIdx++;
        }
      }
    }, beatTime * 16 * 1000);

    // --- Driving bass (square through lowpass, arpeggiated) ---
    const bassNotes = [73.42, 73.42, 110, 73.42, 87.31, 87.31, 110, 87.31]; // D2, D2, A2, D2, F2...
    let bassIdx = 0;

    this.bassGain = this.createGain(0.12);
    this.bassGain.connect(this.masterGain);

    const bassFilter = this.createFilter('lowpass', 300, 4);
    bassFilter.connect(this.bassGain);

    // Play bass notes on each beat
    this.addInterval(() => {
      if (!this.ctx || !this.masterGain) return;
      const t = this.ctx.currentTime;
      const freq = bassNotes[bassIdx % bassNotes.length];
      bassIdx++;

      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.2, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + beatTime * 0.8);

      osc.connect(env);
      env.connect(bassFilter);
      osc.start(t);
      osc.stop(t + beatTime * 0.8);
    }, beatTime * 1000);

    // --- Kick drum (softer than electronic, more boom) ---
    this.addInterval(() => {
      if (!this.ctx || !this.masterGain) return;
      const t = this.ctx.currentTime;

      const kick = this.ctx.createOscillator();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(100, t);
      kick.frequency.exponentialRampToValueAtTime(35, t + 0.15);

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.12 + this.intensity * 0.06, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

      kick.connect(env);
      env.connect(this.masterGain);
      kick.start(t);
      kick.stop(t + 0.2);
    }, beatTime * 1000);

    // --- Snare on beats 2 and 4 (noise burst) ---
    let snareCount = 0;
    this.addInterval(() => {
      snareCount++;
      if (snareCount % 2 !== 0) return; // only on beats 2, 4
      if (!this.ctx || !this.masterGain) return;
      const t = this.ctx.currentTime;

      // Noise-like snare using detuned oscillators
      const s1 = this.ctx.createOscillator();
      s1.type = 'sawtooth';
      s1.frequency.value = 200;
      const s2 = this.ctx.createOscillator();
      s2.type = 'sawtooth';
      s2.frequency.value = 207;

      const snareEnv = this.ctx.createGain();
      snareEnv.gain.setValueAtTime(0.06 + this.intensity * 0.04, t);
      snareEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

      const hpf = this.ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = 2000;

      s1.connect(hpf);
      s2.connect(hpf);
      hpf.connect(snareEnv);
      snareEnv.connect(this.masterGain);
      s1.start(t);
      s2.start(t);
      s1.stop(t + 0.1);
      s2.stop(t + 0.1);
    }, beatTime * 1000);

    // --- Delay (slapback echo for that 80s feel) ---
    const delaySend = this.createGain(0.15);
    this.padGain.connect(delaySend);

    const slapDelay = this.createDelay(beatTime * 0.75);
    const slapFb = this.createGain(0.25);
    const slapFilter = this.createFilter('lowpass', 3000, 0.5);

    delaySend.connect(slapDelay);
    slapDelay.connect(slapFb);
    slapFb.connect(slapFilter);
    slapFilter.connect(slapDelay); // feedback
    slapDelay.connect(this.masterGain);

    // --- Lead melody (sparse, triangle, pentatonic) ---
    // Plays a note every 4 beats
    const leadNotes = [293.66, 349.23, 440, 523.25, 440, 349.23, 293.66, 261.63];
    // D4, F4, A4, C5, A4, F4, D4, C4
    let leadIdx = 0;

    const leadGain = this.createGain(0.0);
    leadGain.connect(this.masterGain);
    leadGain.connect(delaySend); // send to delay

    this.addInterval(() => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const freq = leadNotes[leadIdx % leadNotes.length];
      leadIdx++;

      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const vibrato = this.ctx.createOscillator();
      vibrato.type = 'sine';
      vibrato.frequency.value = 5;
      const vibratoGain = this.ctx.createGain();
      vibratoGain.gain.value = 3;
      vibrato.connect(vibratoGain);
      vibratoGain.connect(osc.frequency);
      vibrato.start(t);
      vibrato.stop(t + beatTime * 3);

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0, t);
      env.gain.linearRampToValueAtTime(0.07 + this.intensity * 0.03, t + 0.15);
      env.gain.setValueAtTime(0.06, t + beatTime * 1);
      env.gain.exponentialRampToValueAtTime(0.001, t + beatTime * 3);

      osc.connect(env);
      env.connect(leadGain);
      osc.start(t);
      osc.stop(t + beatTime * 3);
    }, beatTime * 4 * 1000);
  }

  // ---------------------------------------------------------------------------
  // PRESET 4: Minimal (sparse clicks, deep sub, subtle melody)
  //   Nils Frahm meets Jon Hopkins. Key: C minor pentatonic.
  //   Sparse, meditative, hypnotic. ~85bpm implied.
  // ---------------------------------------------------------------------------

  private startMinimal(): void {
    if (!this.ctx || !this.masterGain) return;

    const bpm = 85;
    const beatTime = 60 / bpm;
    const t0 = this.ctx.currentTime;

    // C minor pentatonic: C Eb F G Bb
    // C2=65.41, Eb2=77.78, G2=98, C3=130.81, Eb3=155.56, G3=196, Bb3=233.08, C4=261.63

    // --- Deep sub-bass (sine, very low, slow movement) ---
    const subOsc = this.createOsc('sine', 65.41); // C2
    this.bassGain = this.createGain(0.0);
    this.bassGain.connect(this.masterGain);
    // Slow swell
    this.bassGain.gain.linearRampToValueAtTime(0.15, t0 + 4);

    const subFilter = this.createFilter('lowpass', 120, 2);
    subOsc.connect(subFilter);
    subFilter.connect(this.bassGain);
    subOsc.start();

    // Sub bass note cycle (very slow)
    const subNotes = [65.41, 65.41, 77.78, 65.41, 98, 65.41]; // C2, C2, Eb2, C2, G2, C2
    let subIdx = 0;
    this.addInterval(() => {
      if (!this.ctx) return;
      subIdx = (subIdx + 1) % subNotes.length;
      subOsc.frequency.exponentialRampToValueAtTime(subNotes[subIdx], this.ctx.currentTime + 3);
    }, beatTime * 8 * 1000);

    // --- Sparse clicks (soft impulse, rhythmic but irregular) ---
    // Pattern: click on beats 1, skip, skip, soft on 4, skip, click on 6, skip, skip (8-beat pattern)
    const clickPattern = [1.0, 0, 0, 0.4, 0, 0.7, 0, 0];
    let clickIdx = 0;

    this.addInterval(() => {
      const vol = clickPattern[clickIdx % clickPattern.length];
      clickIdx++;
      if (vol === 0 || !this.ctx || !this.masterGain) return;

      const t = this.ctx.currentTime;

      // Click = very short triangle burst
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 2500;

      const env = this.ctx.createGain();
      const clickVol = 0.04 * vol * (0.7 + this.intensity * 0.3);
      env.gain.setValueAtTime(clickVol, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.02);

      const hpf = this.ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = 1500;

      osc.connect(hpf);
      hpf.connect(env);
      env.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.02);
    }, beatTime * 1000);

    // --- Subtle melodic fragments (sine, long decay, through delay) ---
    // Plays a note every 3-5 seconds semi-randomly
    const melodyNotes = [261.63, 311.13, 392, 523.25, 466.16, 392, 311.13, 261.63];
    // C4, Eb4, G4, C5, Bb4, G4, Eb4, C4
    let melIdx = 0;
    const melGain = this.createGain(0.0);
    this.padGain = melGain;
    melGain.connect(this.masterGain);
    melGain.gain.linearRampToValueAtTime(1.0, t0 + 2);

    // Delay reverb for melody
    const melDelay1 = this.createDelay(0.43);
    const melDelay2 = this.createDelay(0.71);
    const melFb1 = this.createGain(0.35);
    const melFb2 = this.createGain(0.25);
    const melRevFilter = this.createFilter('lowpass', 2500, 0.7);

    melGain.connect(melDelay1);
    melDelay1.connect(melFb1);
    melFb1.connect(melRevFilter);
    melRevFilter.connect(melDelay2);
    melDelay2.connect(melFb2);
    melFb2.connect(melDelay1); // feedback loop
    melDelay1.connect(this.masterGain);
    melDelay2.connect(this.masterGain);

    // Staggered melody playback
    const playMelodyNote = () => {
      if (!this.ctx || !this.masterGain) return;
      const t = this.ctx.currentTime;
      const freq = melodyNotes[melIdx % melodyNotes.length];
      melIdx++;

      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0, t);
      env.gain.linearRampToValueAtTime(0.05 + this.intensity * 0.02, t + 0.5);
      env.gain.exponentialRampToValueAtTime(0.001, t + 3.0);

      osc.connect(env);
      env.connect(melGain);
      osc.start(t);
      osc.stop(t + 3.0);

      // Schedule next note with slight variation (3-5 seconds)
      const nextDelay = 3000 + Math.floor(melIdx * 773 % 2000); // deterministic pseudo-random
      this.addTimeout(playMelodyNote, nextDelay);
    };

    // Start melody after 3 seconds
    this.addTimeout(playMelodyNote, 3000);

    // --- Pad texture (very quiet, filtered noise-like layer) ---
    // Two detuned sines with slow beating
    const tex1 = this.createOsc('sine', 196);    // G3
    const tex2 = this.createOsc('sine', 196.5);  // G3 + slight detune for slow beating
    const tex3 = this.createOsc('sine', 130.81);  // C3
    const tex4 = this.createOsc('sine', 131.2);   // C3 + detune

    const texGain = this.createGain(0.015);
    const texFilter = this.createFilter('bandpass', 180, 3);

    // Slow volume LFO
    const texLfo = this.createOsc('sine', 0.07);
    const texLfoGain = this.createGain(0.01);
    texLfo.connect(texLfoGain);
    texLfoGain.connect(texGain.gain);
    texLfo.start();

    tex1.connect(texFilter);
    tex2.connect(texFilter);
    tex3.connect(texFilter);
    tex4.connect(texFilter);
    texFilter.connect(texGain);
    texGain.connect(this.masterGain);

    tex1.start();
    tex2.start();
    tex3.start();
    tex4.start();
  }

  // ---------------------------------------------------------------------------
  // Intensity scaling (affects all presets generically)
  // ---------------------------------------------------------------------------

  private updateIntensity(): void {
    if (this.padGain) {
      // Scale pad/melody volume with intensity
      const baseVal = this.padGain.gain.value;
      if (baseVal > 0.001) {
        // Gentle scaling - don't overwhelm
        const target = this.currentPreset === 'ambient'
          ? 0.04 + this.intensity * 0.04
          : this.currentPreset === 'minimal'
            ? 0.8 + this.intensity * 0.4
            : 0.02 + this.intensity * 0.05;
        this.padGain.gain.value = target;
      }
    }
    if (this.bassGain) {
      const target = this.currentPreset === 'ambient'
        ? 0.8 + this.intensity * 0.4
        : this.currentPreset === 'minimal'
          ? 0.1 + this.intensity * 0.1
          : this.currentPreset === 'synthwave'
            ? 0.08 + this.intensity * 0.08
            : 0.1 + this.intensity * 0.1;
      this.bassGain.gain.value = target;
    }
  }

  // ---------------------------------------------------------------------------
  // localStorage
  // ---------------------------------------------------------------------------

  private loadPreset(): MusicPreset {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && ALL_PRESETS.includes(stored as MusicPreset)) {
        return stored as MusicPreset;
      }
    } catch (_) {
      // localStorage not available
    }
    return 'electronic';
  }

  private savePreset(preset: MusicPreset): void {
    try {
      localStorage.setItem(STORAGE_KEY, preset);
    } catch (_) {
      // localStorage not available
    }
  }
}
