/**
 * EnemyKillStreakAnnouncer — tracks consecutive enemy kills and shows
 * an announcement overlay at each milestone.
 *
 * Intentionally separate from KillStreakAnnouncer (PvP multi-kills in 4s window).
 * This class tracks kills without dying — reset on player death via resetStreak().
 */

import { SoundEngine } from '../audio/SoundEngine';
import { BrailleAnimator, BraillePattern } from './BrailleAnimator';
import {
  getStreakName,
  getStreakTier,
  STREAK_MILESTONES,
  STREAK_TIERS,
} from './killStreakNames';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Seconds the announcement stays fully visible. */
const VISIBLE_DURATION = 2.5;
/** Seconds over which the announcement fades out. */
const FADE_DURATION = 1.0;

/** Milestone set for O(1) lookup. */
const MILESTONE_SET = new Set<number>(STREAK_MILESTONES);

/**
 * Placeholder tier-to-pattern mapping. One pattern per tier index (0–9).
 * Finalized in phase 5A — for now uses a progression of patterns.
 */
const TIER_PATTERNS: BraillePattern[] = [
  'orbit',      // tier 0: Casual         (1–5)
  'wave',       // tier 1: Military       (6–10)
  'ripple',     // tier 2: Professional   (11–15)
  'vortex',     // tier 3: Supernatural   (16–20)
  'spiral',     // tier 4: Godlike        (21–30)
  'fireworks',  // tier 5: Cosmic         (31–50)
  'helix',      // tier 6: Eldritch       (51–75)
  'rose',       // tier 7: Mythological   (76–100)
  'static',     // tier 8: Transcendent   (101–150)
  'binary',     // tier 9: Incomprehensible (151+)
];

// ---------------------------------------------------------------------------
// EnemyKillStreakAnnouncer
// ---------------------------------------------------------------------------

export class EnemyKillStreakAnnouncer {
  private readonly container: HTMLDivElement;
  private readonly styleEl: HTMLStyleElement;
  private readonly sound: SoundEngine;
  private readonly brailleEl: HTMLPreElement;
  private readonly animator: BrailleAnimator;

  private _streakCount = 0;

  /** Time remaining for the current announcement (seconds). Negative = idle. */
  private timeRemaining = -1;

  constructor(sound: SoundEngine) {
    this.sound = sound;

    // ── Style ──────────────────────────────────────────────────────────────
    this.styleEl = document.createElement('style') as HTMLStyleElement;
    this.styleEl.id = 'enemy-kill-streak-announcer-style';
    this.styleEl.textContent = `
      #enemy-kill-streak-announcer {
        position: fixed;
        top: 30%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 600;
        pointer-events: none;
        text-align: center;
        display: none;
      }

      #enemy-kill-streak-announcer .eksa-braille {
        display: block;
        font-family: monospace;
        font-size: 12px;
        line-height: 1.1;
        margin-bottom: 8px;
        white-space: pre;
        /* color set dynamically per tier */
      }

      #enemy-kill-streak-announcer .eksa-label {
        font-size: 52px;
        font-weight: 900;
        font-family: monospace;
        letter-spacing: 8px;
        text-transform: uppercase;
        /* color and text-shadow set dynamically per tier */
      }

      #enemy-kill-streak-announcer .eksa-subtitle {
        font-size: 20px;
        font-weight: 600;
        font-family: monospace;
        color: #ffffff;
        letter-spacing: 3px;
        text-transform: uppercase;
        margin-top: 6px;
        text-shadow: 0 0 8px #ffffff;
      }

      @keyframes eksa-pop-in {
        0%   { transform: scale(0.4); opacity: 0; }
        60%  { transform: scale(1.15); opacity: 1; }
        100% { transform: scale(1.0); opacity: 1; }
      }

      #enemy-kill-streak-announcer.eksa-active .eksa-label {
        animation: eksa-pop-in 0.35s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
      }
    `;
    document.head.appendChild(this.styleEl);

    // ── Container ──────────────────────────────────────────────────────────
    this.container = document.createElement('div') as HTMLDivElement;
    this.container.id = 'enemy-kill-streak-announcer';

    this.brailleEl = document.createElement('pre') as HTMLPreElement;
    this.brailleEl.className = 'eksa-braille';
    this.container.appendChild(this.brailleEl);

    const labelEl = document.createElement('div');
    labelEl.className = 'eksa-label';
    this.container.appendChild(labelEl);

    const subtitleEl = document.createElement('div');
    subtitleEl.className = 'eksa-subtitle';
    this.container.appendChild(subtitleEl);

    document.body.appendChild(this.container);

    // ── Animator ───────────────────────────────────────────────────────────
    this.animator = new BrailleAnimator(this.brailleEl, {
      cols: 24,
      rows: 4,
      pattern: 'orbit',
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Record an enemy kill. Increments streak counter and shows announcement
   * at milestone counts (as defined in STREAK_MILESTONES).
   */
  recordKill(): void {
    this._streakCount++;
    if (MILESTONE_SET.has(this._streakCount)) {
      this._showAnnouncement(this._streakCount);
    }
  }

  /**
   * Reset the streak counter to 0 without showing any announcement.
   * Call on player death.
   */
  resetStreak(): void {
    this._streakCount = 0;
  }

  /**
   * Advance the fade-out timer. Call once per frame.
   * @param dt Delta time in seconds.
   */
  update(dt: number): void {
    if (this.timeRemaining < 0) return;

    this.timeRemaining -= dt;

    if (this.timeRemaining <= 0) {
      // Fully expired
      this.container.style.display = 'none';
      this.container.classList.remove('eksa-active');
      this.timeRemaining = -1;
      this.animator.stop();
    } else if (this.timeRemaining < FADE_DURATION) {
      // In fade-out window
      const opacity = this.timeRemaining / FADE_DURATION;
      this.container.style.opacity = String(opacity);
    }
  }

  /** Current consecutive kill count. */
  get streakCount(): number {
    return this._streakCount;
  }

  /** Remove DOM elements and release resources. */
  dispose(): void {
    this.animator.dispose();
    this.container.remove();
    this.styleEl.remove();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private _showAnnouncement(count: number): void {
    const tier = getStreakTier(count);
    const name = getStreakName(count);
    const tierIndex = this._getTierIndex(count);

    const labelEl = this.container.querySelector<HTMLElement>('.eksa-label');
    const subtitleEl = this.container.querySelector<HTMLElement>('.eksa-subtitle');

    if (labelEl) {
      labelEl.textContent = name;
      labelEl.style.color = tier.color;
      labelEl.style.textShadow = [
        `0 0 10px ${tier.glowColor}`,
        `0 0 25px ${tier.glowColor}`,
        `0 0 50px ${tier.glowColor}`,
      ].join(', ');
    }

    this.brailleEl.style.color = tier.glowColor;

    if (subtitleEl) {
      subtitleEl.textContent = `${count} KILLS IN A ROW`;
    }

    // Update animator pattern and intensity for this tier
    this.animator.stop();
    this.animator.setPattern(TIER_PATTERNS[tierIndex] ?? 'orbit');
    this.animator.setIntensity(0.3 + tierIndex * 0.07);
    this.animator.start();

    // Reset animation: remove and re-add active class to restart keyframe
    this.container.classList.remove('eksa-active');
    this.container.style.display = 'block';
    this.container.style.opacity = '1';
    this.container.style.transition = '';
    // Force reflow so the animation restarts cleanly
    void this.container.offsetWidth;
    this.container.classList.add('eksa-active');

    this.timeRemaining = VISIBLE_DURATION + FADE_DURATION;

    this.sound.play('multiplierUp', { pitch: tier.pitch, volume: 0.8 });
  }

  /** Returns 0-based index of the tier for the given count. */
  private _getTierIndex(count: number): number {
    let idx = 0;
    for (let i = 0; i < STREAK_TIERS.length; i++) {
      if (count >= STREAK_TIERS[i].minStreak) idx = i;
    }
    return idx;
  }
}
