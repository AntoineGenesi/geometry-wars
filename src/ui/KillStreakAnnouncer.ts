/**
 * KillStreakAnnouncer — PvP kill streak announcement overlay.
 *
 * Displays centered on-screen announcements when a player achieves a kill
 * streak in PvP/PvPvE mode. Announcements appear for 2 seconds then fade
 * over 1 second (3s total lifetime). All players see the same announcement
 * since the server broadcasts pvp_kill events to everyone.
 *
 * Streak thresholds:
 *   2  → Double Kill
 *   3  → Triple Kill
 *   4  → Overkill
 *   5  → Killtacular
 *   6+ → Legendary
 */

import { SoundEngine } from '../audio/SoundEngine';

// ---------------------------------------------------------------------------
// Streak configuration
// ---------------------------------------------------------------------------

interface StreakTier {
  label: string;
  /** CSS color (hex or keyword) for the announcement text. */
  color: string;
  /** Outer glow color for neon effect. */
  glowColor: string;
  /** Sound pitch multiplier relative to baseline. */
  pitch: number;
}

/** Map from minimum streak count to tier definition. */
const STREAK_TIERS: Array<{ minStreak: number } & StreakTier> = [
  { minStreak: 6, label: 'LEGENDARY',    color: '#ff44ff', glowColor: '#ff00ff', pitch: 1.8 },
  { minStreak: 5, label: 'KILLTACULAR',  color: '#ff8800', glowColor: '#ff6600', pitch: 1.6 },
  { minStreak: 4, label: 'OVERKILL',     color: '#ff4444', glowColor: '#ff0000', pitch: 1.4 },
  { minStreak: 3, label: 'TRIPLE KILL',  color: '#44ddff', glowColor: '#00aaff', pitch: 1.2 },
  { minStreak: 2, label: 'DOUBLE KILL',  color: '#44ff88', glowColor: '#00ff44', pitch: 1.0 },
];

/** Seconds the announcement stays fully visible. */
const VISIBLE_DURATION = 2.0;
/** Seconds over which the announcement fades to invisible. */
const FADE_DURATION = 1.0;

// ---------------------------------------------------------------------------
// KillStreakAnnouncer
// ---------------------------------------------------------------------------

export class KillStreakAnnouncer {
  private readonly container: HTMLDivElement;
  private readonly styleEl: HTMLStyleElement;
  private readonly sound: SoundEngine;

  /** Time remaining for the current announcement (seconds). Negative = idle. */
  private timeRemaining = -1;

  constructor(sound: SoundEngine) {
    this.sound = sound;

    this.styleEl = document.createElement('style');
    this.styleEl.id = 'kill-streak-announcer-style';
    this.styleEl.textContent = `
      #kill-streak-announcer {
        position: fixed;
        top: 30%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 600;
        pointer-events: none;
        text-align: center;
        font-family: 'Segoe UI', Arial, sans-serif;
        display: none;
      }

      #kill-streak-announcer .ksa-killer {
        font-size: 20px;
        font-weight: 600;
        color: #ffffff;
        text-shadow: 0 0 8px #ffffff;
        letter-spacing: 3px;
        text-transform: uppercase;
        margin-bottom: 6px;
      }

      #kill-streak-announcer .ksa-label {
        font-size: 52px;
        font-weight: 900;
        letter-spacing: 8px;
        text-transform: uppercase;
        /* color and text-shadow set dynamically per tier */
      }

      @keyframes ksa-pop-in {
        0%   { transform: scale(0.4); opacity: 0; }
        60%  { transform: scale(1.15); opacity: 1; }
        100% { transform: scale(1.0); opacity: 1; }
      }

      #kill-streak-announcer.ksa-active .ksa-label {
        animation: ksa-pop-in 0.35s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
      }
    `;
    document.head.appendChild(this.styleEl);

    this.container = document.createElement('div');
    this.container.id = 'kill-streak-announcer';
    this.container.innerHTML = `
      <div class="ksa-killer"></div>
      <div class="ksa-label"></div>
    `;
    document.body.appendChild(this.container);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Show an announcement for the given kill streak.
   * If streakCount < 2 no announcement is shown (single kill = no streak).
   *
   * @param killerName  Display name of the killer (e.g. "Player 1").
   * @param streakCount Number of consecutive kills in this streak.
   */
  announce(killerName: string, streakCount: number): void {
    const tier = this.getTier(streakCount);
    if (!tier) return; // No announcement for single kills

    const killerEl = this.container.querySelector<HTMLElement>('.ksa-killer')!;
    const labelEl = this.container.querySelector<HTMLElement>('.ksa-label')!;

    killerEl.textContent = killerName;
    labelEl.textContent = tier.label;
    labelEl.style.color = tier.color;
    labelEl.style.textShadow = [
      `0 0 10px ${tier.glowColor}`,
      `0 0 25px ${tier.glowColor}`,
      `0 0 50px ${tier.glowColor}`,
    ].join(', ');

    // Reset animation: remove and re-add active class to restart keyframe
    this.container.classList.remove('ksa-active');
    this.container.style.display = 'block';
    this.container.style.opacity = '1';
    this.container.style.transition = '';
    // Force reflow so the animation restarts cleanly
    void this.container.offsetWidth;
    this.container.classList.add('ksa-active');

    this.timeRemaining = VISIBLE_DURATION + FADE_DURATION;

    this.sound.play('multiplierUp', { pitch: tier.pitch, volume: 0.7 });
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
      this.container.classList.remove('ksa-active');
      this.timeRemaining = -1;
    } else if (this.timeRemaining < FADE_DURATION) {
      // In fade-out window: set opacity proportional to remaining fade time
      const opacity = this.timeRemaining / FADE_DURATION;
      this.container.style.opacity = String(opacity);
    }
  }

  /** Remove DOM elements and style tags. */
  dispose(): void {
    this.container.remove();
    this.styleEl.remove();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Return the streak tier for the given count, or null if below minimum.
   */
  private getTier(streakCount: number): StreakTier | null {
    for (const tier of STREAK_TIERS) {
      if (streakCount >= tier.minStreak) {
        return tier;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exported helper — maps a streak count to its announcement label.
// Used in unit tests to verify threshold logic without a DOM.
// ---------------------------------------------------------------------------

export function streakLabel(streakCount: number): string | null {
  for (const tier of STREAK_TIERS) {
    if (streakCount >= tier.minStreak) {
      return tier.label;
    }
  }
  return null;
}
