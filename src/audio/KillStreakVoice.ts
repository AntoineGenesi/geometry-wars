/**
 * KillStreakVoice — plays pre-recorded voice announcements for kill streaks.
 *
 * Loads MP3 clips from public/sounds/kill-streaks/ and plays them through
 * the Web Audio API, routed through the SoundEngine's audio graph for
 * consistent volume/compression.
 *
 * Debouncing: only one voice clip plays at a time. If a new streak fires
 * while a clip is playing, the old clip is stopped and the new one starts.
 */

import { SoundEngine } from './SoundEngine';

// ---------------------------------------------------------------------------
// Clip mapping — streak count to filename (without extension)
// ---------------------------------------------------------------------------

/** Multi-kill clips: rapid consecutive kills within a time window. */
const MULTI_KILL_CLIPS: ReadonlyArray<{ minCount: number; clip: string }> = [
  { minCount: 10, clip: 'invincible' },
  { minCount: 9,  clip: 'untouchable' },
  { minCount: 8,  clip: 'rampage' },
  { minCount: 7,  clip: 'running-riot' },
  { minCount: 6,  clip: 'killing-frenzy' },
  { minCount: 5,  clip: 'killtacular' },
  { minCount: 4,  clip: 'overkill' },
  { minCount: 3,  clip: 'triple-kill' },
  { minCount: 2,  clip: 'double-kill' },
];

/** Special clips for non-multi-kill events. */
const SPECIAL_CLIPS = {
  killingSpree: 'killing-spree',
  killjoy: 'killjoy',
  legendary: 'legendary',
} as const;

/** All clip filenames that need preloading. */
const ALL_CLIPS = [
  ...MULTI_KILL_CLIPS.map(t => t.clip),
  ...Object.values(SPECIAL_CLIPS),
];

const SOUNDS_PATH = 'sounds/kill-streaks';

// ---------------------------------------------------------------------------
// KillStreakVoice
// ---------------------------------------------------------------------------

export class KillStreakVoice {
  private readonly sound: SoundEngine;
  private readonly buffers = new Map<string, AudioBuffer>();
  private currentSource: AudioBufferSourceNode | null = null;
  private volume = 0.8;
  private loaded = false;

  constructor(sound: SoundEngine) {
    this.sound = sound;
  }

  /**
   * Preload all voice clips into AudioBuffers.
   * Call after SoundEngine.init() so the AudioContext is available.
   * Non-blocking — clips that fail to load are silently skipped.
   */
  async preload(): Promise<void> {
    const ctx = this.sound.getAudioContext();
    if (!ctx) return;

    const loadPromises = ALL_CLIPS.map(async (clip) => {
      try {
        const response = await fetch(`${SOUNDS_PATH}/${clip}.mp3`);
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        this.buffers.set(clip, audioBuffer);
      } catch {
        // Silently skip — game works without voice clips
      }
    });

    await Promise.all(loadPromises);
    this.loaded = this.buffers.size > 0;
  }

  /**
   * Play the appropriate voice clip for a multi-kill count.
   * Stops any currently playing clip first (no stacking).
   */
  playMultiKill(count: number): void {
    for (const tier of MULTI_KILL_CLIPS) {
      if (count >= tier.minCount) {
        this.playClip(tier.clip);
        return;
      }
    }
  }

  /**
   * Play the "Killing Spree" clip (5+ kills without dying).
   */
  playKillingSpree(): void {
    this.playClip(SPECIAL_CLIPS.killingSpree);
  }

  /**
   * Play the "Killjoy" clip (ending an enemy's killing spree).
   */
  playKilljoy(): void {
    this.playClip(SPECIAL_CLIPS.killjoy);
  }

  /**
   * Play the "Legendary" clip (6+ multi-kill in KillStreakAnnouncer).
   */
  playLegendary(): void {
    this.playClip(SPECIAL_CLIPS.legendary);
  }

  /** Set voice volume (0-1). */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
  }

  /** Whether any clips were successfully loaded. */
  isLoaded(): boolean {
    return this.loaded;
  }

  /** Stop any currently playing clip and release resources. */
  dispose(): void {
    this.stopCurrent();
    this.buffers.clear();
    this.loaded = false;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private playClip(clipName: string): void {
    const ctx = this.sound.getAudioContext();
    const compressor = this.sound.getCompressor();
    if (!ctx || !compressor) return;

    const buffer = this.buffers.get(clipName);
    if (!buffer) return;

    // Stop previous clip to prevent stacking
    this.stopCurrent();

    // Create playback chain: source -> gain -> compressor -> master
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    gainNode.gain.value = this.volume;

    source.connect(gainNode);
    gainNode.connect(compressor);

    source.onended = () => {
      if (this.currentSource === source) {
        this.currentSource = null;
      }
      try { gainNode.disconnect(); } catch { /* already disconnected */ }
    };

    this.currentSource = source;
    source.start();
  }

  private stopCurrent(): void {
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch { /* already stopped */ }
      this.currentSource = null;
    }
  }
}
