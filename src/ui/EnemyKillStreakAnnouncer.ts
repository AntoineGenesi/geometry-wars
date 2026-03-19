/**
 * EnemyKillStreakAnnouncer — SP enemy kill streak announcement overlay.
 *
 * Tracks consecutive enemy kills without dying. Shows Halo-style announcements
 * at milestone counts (1, 2, 3, 4, 5, 7, 10, 13, ...) with a Braille animation
 * background and tier-based colors/sounds.
 *
 * Completely separate from KillStreakAnnouncer (PvP multi-kills in a time window).
 * This class tracks enemy kills across the entire session until the player dies.
 *
 * API:
 *   recordKill()           — call on each enemy kill
 *   resetStreak()          — call on player death (silent, no animation)
 *   update(dt: number)     — call each frame
 *   get streakCount()      — current consecutive kill count
 *   dispose()              — remove DOM elements
 */

import { SoundEngine } from '../audio/SoundEngine';
import { BrailleAnimator } from './BrailleAnimator';
import type { BraillePattern } from './BrailleAnimator';
import {
  getStreakName,
  getStreakTier,
  STREAK_MILESTONES,
} from './killStreakNames';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Seconds announcement stays fully visible before fading. */
const VISIBLE_DURATION = 2.5;
/** Seconds to fade from full opacity to zero. */
const FADE_DURATION = 1.0;

/**
 * Map streak tier minStreak → Braille animation pattern.
 * Tiers are ordered ascending (1, 6, 11, 16, 21, 31, 51, 76, 101, 151).
 */
const TIER_PATTERNS: BraillePattern[] = [
  'breathing',      // tier 0 (minStreak 1)
  'wave',           // tier 1 (minStreak 6)
  'columns',        // tier 2 (minStreak 11)
  'orbit',          // tier 3 (minStreak 16)
  'vortex',         // tier 4 (minStreak 21)
  'spiral',         // tier 5 (minStreak 31)
  'fireworks',      // tier 6 (minStreak 51)
  'helix',          // tier 7 (minStreak 76)
  'ripple',         // tier 8 (minStreak 101)
  'static',         // tier 9 (minStreak 151)
];

// ---------------------------------------------------------------------------
// EnemyKillStreakAnnouncer
// ---------------------------------------------------------------------------

export class EnemyKillStreakAnnouncer {
  private readonly styleEl: HTMLStyleElement;
  private readonly container: HTMLDivElement;
  private readonly brailleEl: HTMLPreElement;
  private readonly nameEl: HTMLDivElement;
  private readonly countEl: HTMLDivElement;

  private readonly sound: SoundEngine;
  private brailleAnimator: BrailleAnimator;

  private _streakCount = 0;
  /** Time remaining on the current announcement. Negative = idle. */
  private timeRemaining = -1;

  constructor(sound: SoundEngine) {
    this.sound = sound;

    // ── Styles ──────────────────────────────────────────────────────────────
    this.styleEl = document.createElement('style');
    this.styleEl.id = 'enemy-kill-streak-announcer-style';
    this.styleEl.textContent = `
      #enemy-kill-streak-announcer {
        position: fixed;
        top: 30%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 610;
        pointer-events: none;
        text-align: center;
        display: none;
        user-select: none;
      }

      #enemy-kill-streak-announcer .eksa-braille {
        font-family: monospace;
        font-size: 14px;
        line-height: 1.1;
        color: rgba(255,255,255,0.25);
        margin-bottom: 6px;
        letter-spacing: 0;
        white-space: pre;
      }

      #enemy-kill-streak-announcer .eksa-name {
        font-size: 52px;
        font-weight: 900;
        font-family: 'Courier New', monospace;
        letter-spacing: 6px;
        text-transform: uppercase;
        /* color and text-shadow set dynamically per tier */
      }

      #enemy-kill-streak-announcer .eksa-count {
        font-size: 20px;
        font-weight: 600;
        font-family: 'Courier New', monospace;
        color: #ffffff;
        text-shadow: 0 0 8px #ffffff;
        letter-spacing: 4px;
        text-transform: uppercase;
        margin-top: 4px;
      }

      @keyframes eksa-pop-in {
        0%   { transform: scale(0.4); opacity: 0; }
        60%  { transform: scale(1.12); opacity: 1; }
        100% { transform: scale(1.0); opacity: 1; }
      }

      #enemy-kill-streak-announcer.eksa-active .eksa-name {
        animation: eksa-pop-in 0.35s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
      }
    `;
    document.head.appendChild(this.styleEl);

    // ── DOM ─────────────────────────────────────────────────────────────────
    this.container = document.createElement('div');
    this.container.id = 'enemy-kill-streak-announcer';

    this.brailleEl = document.createElement('pre');
    this.brailleEl.className = 'eksa-braille';

    this.nameEl = document.createElement('div');
    this.nameEl.className = 'eksa-name';

    this.countEl = document.createElement('div');
    this.countEl.className = 'eksa-count';

    this.container.appendChild(this.brailleEl);
    this.container.appendChild(this.nameEl);
    this.container.appendChild(this.countEl);
    document.body.appendChild(this.container);

    // ── Braille animator (starts stopped, started on each announce) ─────────
    this.brailleAnimator = new BrailleAnimator(this.brailleEl, {
      cols: 24,
      rows: 4,
      pattern: 'breathing',
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Current consecutive kill count (0 after reset). */
  get streakCount(): number {
    return this._streakCount;
  }

  /** Call on each enemy kill. Shows announcement at milestone counts. */
  recordKill(): void {
    this._streakCount++;
    if (STREAK_MILESTONES.includes(this._streakCount)) {
      this._announce(this._streakCount);
    }
  }

  /** Call on player death. Resets counter silently (no announcement). */
  resetStreak(): void {
    this._streakCount = 0;
    this._hide();
  }

  /** Advance fade-out timer. Call once per frame with delta time in seconds. */
  update(dt: number): void {
    if (this.timeRemaining < 0) return;

    this.timeRemaining -= dt;

    if (this.timeRemaining <= 0) {
      this._hide();
    } else if (this.timeRemaining < FADE_DURATION) {
      const opacity = this.timeRemaining / FADE_DURATION;
      this.container.style.opacity = String(opacity);
    }
  }

  /** Remove DOM elements and release animator resources. */
  dispose(): void {
    this.brailleAnimator.dispose();
    this.container.remove();
    this.styleEl.remove();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private _announce(count: number): void {
    const tier = getStreakTier(count);
    const tiers = this._getTierIndex(tier.minStreak);
    const pattern = TIER_PATTERNS[Math.min(tiers, TIER_PATTERNS.length - 1)];

    // Update text content
    this.nameEl.textContent = getStreakName(count);
    this.nameEl.style.color = tier.color;
    this.nameEl.style.textShadow = [
      `0 0 10px ${tier.glowColor}`,
      `0 0 25px ${tier.glowColor}`,
      `0 0 50px ${tier.glowColor}`,
    ].join(', ');

    this.countEl.textContent = `${count} KILL${count === 1 ? '' : 'S'} IN A ROW`;

    // Restart Braille animation with new pattern
    this.brailleAnimator.stop();
    this.brailleAnimator.setPattern(pattern);
    this.brailleAnimator.start();

    // Reset animation via class removal/re-add trick
    this.container.classList.remove('eksa-active');
    this.container.style.display = 'block';
    this.container.style.opacity = '1';
    this.container.style.transition = '';
    // Force reflow so animation restarts cleanly
    void this.container.offsetWidth;
    this.container.classList.add('eksa-active');

    this.timeRemaining = VISIBLE_DURATION + FADE_DURATION;

    // Play sound (pitch escalates with tier)
    this.sound.play('multiplierUp', { pitch: tier.pitch, volume: 0.8 });
  }

  private _hide(): void {
    this.container.style.display = 'none';
    this.container.classList.remove('eksa-active');
    this.brailleAnimator.stop();
    this.timeRemaining = -1;
  }

  /**
   * Returns the index of the tier whose minStreak matches the given value.
   * Used to pick a Braille pattern from TIER_PATTERNS.
   */
  private _getTierIndex(minStreak: number): number {
    const TIER_MIN_STREAKS = [1, 6, 11, 16, 21, 31, 51, 76, 101, 151];
    const idx = TIER_MIN_STREAKS.indexOf(minStreak);
    return idx >= 0 ? idx : 0;
  }
}
