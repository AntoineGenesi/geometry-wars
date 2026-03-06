import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadGraphicsSettings,
  saveGraphicsSettings,
  loadAudioSettings,
  saveAudioSettings,
  getDefaultGraphics,
  getDefaultAudio,
  applyQualityPreset,
  type GraphicsSettings,
  type AudioSettings,
} from './SettingsMenu';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const store: Record<string, string> = {};

beforeEach(() => {
  // Clear store and mock localStorage
  for (const key of Object.keys(store)) delete store[key];

  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests: Graphics Settings
// ---------------------------------------------------------------------------

describe('GraphicsSettings', () => {
  describe('defaults', () => {
    it('returns default graphics when localStorage is empty', () => {
      const settings = loadGraphicsSettings();
      const defaults = getDefaultGraphics();
      expect(settings).toEqual(defaults);
    });

    it('default quality preset is high', () => {
      const settings = getDefaultGraphics();
      expect(settings.qualityPreset).toBe('high');
    });

    it('default bloom is enabled', () => {
      const settings = getDefaultGraphics();
      expect(settings.bloomEnabled).toBe(true);
    });

    it('default bloom strength is 1.0', () => {
      const settings = getDefaultGraphics();
      expect(settings.bloomStrength).toBe(1.0);
    });

    it('default particle count is 2000', () => {
      const settings = getDefaultGraphics();
      expect(settings.particleCount).toBe(2000);
    });

    it('default trail effects is true', () => {
      const settings = getDefaultGraphics();
      expect(settings.trailEffects).toBe(true);
    });

    it('default max enemies is 500', () => {
      const settings = getDefaultGraphics();
      expect(settings.maxEnemies).toBe(500);
    });

    it('default resolution scale is 1.0', () => {
      const settings = getDefaultGraphics();
      expect(settings.resolutionScale).toBe(1.0);
    });
  });

  describe('save and load', () => {
    it('saves and loads graphics settings via localStorage', () => {
      const custom: GraphicsSettings = {
        qualityPreset: 'custom',
        bloomEnabled: false,
        bloomStrength: 0.5,
        particleCount: 1000,
        trailEffects: false,
        maxEnemies: 250,
        resolutionScale: 0.75,
        surfaceOpaque: false,
        enable90DegreeHide: false,
      };

      saveGraphicsSettings(custom);
      const loaded = loadGraphicsSettings();

      expect(loaded).toEqual(custom);
    });

    it('uses correct localStorage key', () => {
      saveGraphicsSettings(getDefaultGraphics());
      expect(store['gw3d-graphics-settings']).toBeDefined();
    });

    it('handles corrupted localStorage gracefully', () => {
      store['gw3d-graphics-settings'] = 'not valid json {{{';
      const settings = loadGraphicsSettings();
      expect(settings).toEqual(getDefaultGraphics());
    });

    it('merges partial stored data with defaults', () => {
      store['gw3d-graphics-settings'] = JSON.stringify({ bloomEnabled: false });
      const settings = loadGraphicsSettings();
      expect(settings.bloomEnabled).toBe(false);
      expect(settings.qualityPreset).toBe('high'); // default
      expect(settings.particleCount).toBe(2000); // default
    });

    it('returns new object each call (no shared reference)', () => {
      saveGraphicsSettings(getDefaultGraphics());
      const a = loadGraphicsSettings();
      const b = loadGraphicsSettings();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });

    it('loaded object can be mutated without affecting stored data', () => {
      saveGraphicsSettings(getDefaultGraphics());
      const a = loadGraphicsSettings();
      a.maxEnemies = 9999;
      const b = loadGraphicsSettings();
      expect(b.maxEnemies).toBe(500); // unchanged
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Audio Settings
// ---------------------------------------------------------------------------

describe('AudioSettings', () => {
  describe('defaults', () => {
    it('returns default audio when localStorage is empty', () => {
      const settings = loadAudioSettings();
      const defaults = getDefaultAudio();
      expect(settings).toEqual(defaults);
    });

    it('default master volume is 70', () => {
      expect(getDefaultAudio().masterVolume).toBe(70);
    });

    it('default SFX volume is 80', () => {
      expect(getDefaultAudio().sfxVolume).toBe(80);
    });

    it('default music volume is 50', () => {
      expect(getDefaultAudio().musicVolume).toBe(50);
    });

    it('default music preset is electronic', () => {
      expect(getDefaultAudio().musicPreset).toBe('electronic');
    });
  });

  describe('save and load', () => {
    it('saves and loads audio settings via localStorage', () => {
      const custom: AudioSettings = {
        masterVolume: 30,
        sfxVolume: 50,
        musicVolume: 80,
        musicPreset: 'synthwave',
      };

      saveAudioSettings(custom);
      const loaded = loadAudioSettings();

      expect(loaded).toEqual(custom);
    });

    it('uses correct localStorage key', () => {
      saveAudioSettings(getDefaultAudio());
      expect(store['gw3d-audio-settings']).toBeDefined();
    });

    it('handles corrupted localStorage gracefully', () => {
      store['gw3d-audio-settings'] = '!!!invalid';
      const settings = loadAudioSettings();
      expect(settings).toEqual(getDefaultAudio());
    });

    it('merges partial stored data with defaults', () => {
      store['gw3d-audio-settings'] = JSON.stringify({ musicPreset: 'ambient' });
      const settings = loadAudioSettings();
      expect(settings.musicPreset).toBe('ambient');
      expect(settings.masterVolume).toBe(70); // default
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Quality Presets
// ---------------------------------------------------------------------------

describe('applyQualityPreset', () => {
  it('ultra preset has max settings', () => {
    const s = applyQualityPreset('ultra');
    expect(s.qualityPreset).toBe('ultra');
    expect(s.bloomEnabled).toBe(true);
    expect(s.bloomStrength).toBe(2.0);
    expect(s.particleCount).toBe(5000);
    expect(s.trailEffects).toBe(true);
    expect(s.maxEnemies).toBe(5000);
    expect(s.resolutionScale).toBe(1.0);
  });

  it('high preset has balanced settings', () => {
    const s = applyQualityPreset('high');
    expect(s.qualityPreset).toBe('high');
    expect(s.bloomEnabled).toBe(true);
    expect(s.bloomStrength).toBe(1.0);
    expect(s.particleCount).toBe(2000);
    expect(s.maxEnemies).toBe(500);
    expect(s.resolutionScale).toBe(1.0);
  });

  it('medium preset reduces effects', () => {
    const s = applyQualityPreset('medium');
    expect(s.qualityPreset).toBe('medium');
    expect(s.bloomEnabled).toBe(true);
    expect(s.bloomStrength).toBe(0.5);
    expect(s.particleCount).toBe(1000);
    expect(s.resolutionScale).toBe(0.75);
  });

  it('low preset disables bloom and trails', () => {
    const s = applyQualityPreset('low');
    expect(s.qualityPreset).toBe('low');
    expect(s.bloomEnabled).toBe(false);
    expect(s.trailEffects).toBe(false);
    expect(s.maxEnemies).toBe(100);
    expect(s.resolutionScale).toBe(0.5);
  });

  it('minimal preset has minimum settings', () => {
    const s = applyQualityPreset('minimal');
    expect(s.qualityPreset).toBe('minimal');
    expect(s.bloomEnabled).toBe(false);
    expect(s.bloomStrength).toBe(0);
    expect(s.particleCount).toBe(100);
    expect(s.trailEffects).toBe(false);
    expect(s.maxEnemies).toBe(50);
    expect(s.resolutionScale).toBe(0.25);
  });

  it('unknown preset returns custom with defaults', () => {
    const s = applyQualityPreset('nonexistent');
    expect(s.qualityPreset).toBe('custom');
  });

  it('preset hierarchy: ultra > high > medium > low > minimal for particles', () => {
    const u = applyQualityPreset('ultra');
    const h = applyQualityPreset('high');
    const m = applyQualityPreset('medium');
    const l = applyQualityPreset('low');
    const min = applyQualityPreset('minimal');
    expect(u.particleCount).toBeGreaterThan(h.particleCount);
    expect(h.particleCount).toBeGreaterThan(m.particleCount);
    expect(m.particleCount).toBeGreaterThan(l.particleCount);
    expect(l.particleCount).toBeGreaterThanOrEqual(min.particleCount);
  });

  it('preset hierarchy: ultra > high > medium > low > minimal for maxEnemies', () => {
    const u = applyQualityPreset('ultra');
    const h = applyQualityPreset('high');
    const m = applyQualityPreset('medium');
    const l = applyQualityPreset('low');
    const min = applyQualityPreset('minimal');
    expect(u.maxEnemies).toBeGreaterThan(h.maxEnemies);
    expect(h.maxEnemies).toBeGreaterThan(m.maxEnemies);
    expect(m.maxEnemies).toBeGreaterThan(l.maxEnemies);
    expect(l.maxEnemies).toBeGreaterThanOrEqual(min.maxEnemies);
  });

  it('preset hierarchy: ultra >= high > medium > low for resolutionScale', () => {
    const u = applyQualityPreset('ultra');
    const h = applyQualityPreset('high');
    const m = applyQualityPreset('medium');
    const l = applyQualityPreset('low');
    const min = applyQualityPreset('minimal');
    expect(u.resolutionScale).toBeGreaterThanOrEqual(h.resolutionScale);
    expect(h.resolutionScale).toBeGreaterThan(m.resolutionScale);
    expect(m.resolutionScale).toBeGreaterThan(l.resolutionScale);
    expect(l.resolutionScale).toBeGreaterThan(min.resolutionScale);
  });

  it('each preset returns a new object', () => {
    const a = applyQualityPreset('high');
    const b = applyQualityPreset('high');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Tests: Settings round-trip
// ---------------------------------------------------------------------------

describe('Settings round-trip', () => {
  it('graphics: save then load preserves all fields', () => {
    const original: GraphicsSettings = {
      qualityPreset: 'ultra',
      bloomEnabled: true,
      bloomStrength: 1.8,
      particleCount: 4000,
      trailEffects: true,
      maxEnemies: 3000,
      resolutionScale: 0.9,
      surfaceOpaque: false,
      enable90DegreeHide: false,
    };
    saveGraphicsSettings(original);
    expect(loadGraphicsSettings()).toEqual(original);
  });

  it('audio: save then load preserves all fields', () => {
    const original: AudioSettings = {
      masterVolume: 45,
      sfxVolume: 60,
      musicVolume: 90,
      musicPreset: 'minimal',
    };
    saveAudioSettings(original);
    expect(loadAudioSettings()).toEqual(original);
  });

  it('graphics and audio use separate keys', () => {
    saveGraphicsSettings(getDefaultGraphics());
    saveAudioSettings(getDefaultAudio());
    expect(Object.keys(store)).toContain('gw3d-graphics-settings');
    expect(Object.keys(store)).toContain('gw3d-audio-settings');
    expect(Object.keys(store)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('loading with localStorage throwing does not crash', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
      removeItem: () => {},
      clear: () => {},
      length: 0,
      key: () => null,
    });

    expect(() => loadGraphicsSettings()).not.toThrow();
    expect(() => loadAudioSettings()).not.toThrow();
    expect(loadGraphicsSettings()).toEqual(getDefaultGraphics());
    expect(loadAudioSettings()).toEqual(getDefaultAudio());
  });

  it('saving with localStorage throwing does not crash', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
      clear: () => {},
      length: 0,
      key: () => null,
    });

    expect(() => saveGraphicsSettings(getDefaultGraphics())).not.toThrow();
    expect(() => saveAudioSettings(getDefaultAudio())).not.toThrow();
  });

  it('getDefaultGraphics returns independent copies', () => {
    const a = getDefaultGraphics();
    const b = getDefaultGraphics();
    a.particleCount = 1;
    expect(b.particleCount).toBe(2000);
  });

  it('getDefaultAudio returns independent copies', () => {
    const a = getDefaultAudio();
    const b = getDefaultAudio();
    a.masterVolume = 1;
    expect(b.masterVolume).toBe(70);
  });
});
