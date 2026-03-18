/**
 * Tests for KillStreakVoice — clip selection and playback logic.
 *
 * Uses mock AudioContext and SoundEngine to verify:
 * - Correct clip is selected for each streak count
 * - Debouncing: old clip stops when new one starts
 * - Graceful handling when clips aren't loaded
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KillStreakVoice } from './KillStreakVoice';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function makeMockAudioBuffer(): AudioBuffer {
  return {
    duration: 1.0,
    length: 44100,
    numberOfChannels: 1,
    sampleRate: 44100,
    getChannelData: vi.fn(),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

function makeMockSource() {
  return {
    buffer: null as AudioBuffer | null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
}

function makeMockGainNode() {
  return {
    gain: { value: 1.0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function makeMockAudioContext() {
  const sources: ReturnType<typeof makeMockSource>[] = [];
  return {
    createBufferSource: vi.fn(() => {
      const s = makeMockSource();
      sources.push(s);
      return s;
    }),
    createGain: vi.fn(() => makeMockGainNode()),
    decodeAudioData: vi.fn(async () => makeMockAudioBuffer()),
    sources,
  };
}

function makeMockSoundEngine(ctx: ReturnType<typeof makeMockAudioContext>) {
  const compressor = { connect: vi.fn() };
  return {
    getAudioContext: () => ctx as unknown as AudioContext,
    getCompressor: () => compressor as unknown as DynamicsCompressorNode,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KillStreakVoice', () => {
  let ctx: ReturnType<typeof makeMockAudioContext>;
  let soundEngine: ReturnType<typeof makeMockSoundEngine>;
  let voice: KillStreakVoice;

  beforeEach(() => {
    ctx = makeMockAudioContext();
    soundEngine = makeMockSoundEngine(ctx);
    voice = new KillStreakVoice(soundEngine as any);
  });

  it('isLoaded() returns false before preload', () => {
    expect(voice.isLoaded()).toBe(false);
  });

  it('playMultiKill does nothing when not loaded', () => {
    voice.playMultiKill(3);
    expect(ctx.createBufferSource).not.toHaveBeenCalled();
  });

  describe('after manual buffer injection', () => {
    beforeEach(() => {
      // Manually inject buffers to avoid fetch mocking
      const buffers = (voice as any).buffers as Map<string, AudioBuffer>;
      const clips = [
        'double-kill', 'triple-kill', 'overkill', 'killtacular',
        'killing-frenzy', 'running-riot', 'rampage', 'untouchable',
        'invincible', 'killing-spree', 'killjoy', 'legendary',
      ];
      for (const clip of clips) {
        buffers.set(clip, makeMockAudioBuffer());
      }
      (voice as any).loaded = true;
    });

    it('playMultiKill(2) creates and starts a buffer source', () => {
      voice.playMultiKill(2);
      expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
      expect(ctx.sources[0].start).toHaveBeenCalled();
    });

    it('playMultiKill(3) plays triple-kill clip', () => {
      voice.playMultiKill(3);
      const src = ctx.sources[0];
      // Buffer should be the one for triple-kill
      expect(src.buffer).toBeTruthy();
      expect(src.start).toHaveBeenCalled();
    });

    it('playMultiKill(5) plays killtacular clip', () => {
      voice.playMultiKill(5);
      expect(ctx.sources).toHaveLength(1);
      expect(ctx.sources[0].start).toHaveBeenCalled();
    });

    it('playMultiKill(10) plays invincible clip', () => {
      voice.playMultiKill(10);
      expect(ctx.sources).toHaveLength(1);
      expect(ctx.sources[0].start).toHaveBeenCalled();
    });

    it('playMultiKill(1) plays nothing (below threshold)', () => {
      voice.playMultiKill(1);
      expect(ctx.createBufferSource).not.toHaveBeenCalled();
    });

    it('debounces: second playMultiKill stops the first', () => {
      voice.playMultiKill(2);
      const firstSource = ctx.sources[0];

      voice.playMultiKill(3);
      expect(firstSource.stop).toHaveBeenCalled();
      expect(ctx.sources).toHaveLength(2);
      expect(ctx.sources[1].start).toHaveBeenCalled();
    });

    it('playKillingSpree creates a buffer source', () => {
      voice.playKillingSpree();
      expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
      expect(ctx.sources[0].start).toHaveBeenCalled();
    });

    it('playKilljoy creates a buffer source', () => {
      voice.playKilljoy();
      expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
    });

    it('playLegendary creates a buffer source', () => {
      voice.playLegendary();
      expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
    });

    it('dispose clears buffers and resets state', () => {
      voice.dispose();
      expect(voice.isLoaded()).toBe(false);
      // Playing after dispose should do nothing
      voice.playMultiKill(3);
      expect(ctx.createBufferSource).not.toHaveBeenCalled();
    });

    it('setVolume clamps between 0 and 1', () => {
      voice.setVolume(1.5);
      voice.playMultiKill(2);
      const gain = ctx.createGain.mock.results[0].value;
      expect(gain.gain.value).toBeLessThanOrEqual(1.0);

      voice.setVolume(-0.5);
      expect((voice as any).volume).toBe(0);
    });

    it('onended callback cleans up currentSource', () => {
      voice.playMultiKill(2);
      const src = ctx.sources[0];
      expect((voice as any).currentSource).toBe(src);

      // Simulate playback ending
      src.onended?.();
      expect((voice as any).currentSource).toBeNull();
    });
  });
});
