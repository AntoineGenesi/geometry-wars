import { Player } from '../entities/Player';
import { WeaponManager } from '../weapons/WeaponManager';
import { WeaponType, WEAPON_CONFIGS } from '../weapons/WeaponTypes';

/**
 * UIHelpers
 *
 * Static utility functions for HUD updates and screen effects.
 * Previously embedded in main.ts (lines 112-191).
 */
export class UIHelpers {
  // DOM element references (cached once)
  private static scoreEl = document.getElementById('score-display')!;
  private static multiplierEl = document.getElementById('multiplier-display')!;
  private static livesEl = document.getElementById('lives-display')!;
  private static bombsEl = document.getElementById('bombs-display')!;
  private static weaponEl = document.getElementById('weapon-display')!;
  private static timerEl = document.getElementById('timer-display')!;
  private static levelNameEl = document.getElementById('level-name-display')!;
  private static countdownEl = document.getElementById('countdown-overlay')!;
  private static flashEl = document.getElementById('screen-flash')!;
  private static playerLevelEl = document.getElementById('player-level-display')!;
  private static comboEl = document.getElementById('combo-display')!;
  private static boostEl = document.getElementById('boost-display')!;

  /**
   * Activate death cam visual effect: grayscale + darkening on the game canvas.
   * Fades in over 0.3s. Call on player death.
   */
  static showDeathCamEffect(): void {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    (canvas as HTMLElement).style.transition = 'filter 0.3s ease';
    (canvas as HTMLElement).style.filter = 'grayscale(0.7) brightness(0.55)';
  }

  /**
   * Deactivate death cam visual effect: restore normal color on the game canvas.
   * Fades out over 0.5s. Call on player respawn.
   */
  static hideDeathCamEffect(): void {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    (canvas as HTMLElement).style.transition = 'filter 0.5s ease';
    (canvas as HTMLElement).style.filter = '';
  }

  /**
   * Flash the screen with a color for visual impact
   */
  static screenFlash(color: string, duration = 150): void {
    if (!this.flashEl) return;
    this.flashEl.style.background = color;
    this.flashEl.classList.add('active');
    setTimeout(() => {
      this.flashEl.classList.remove('active');
    }, duration);
  }

  /**
   * Update core HUD elements (score, lives, bombs, multiplier, weapon)
   */
  static updateUI(player: Player, weaponManager?: WeaponManager): void {
    this.scoreEl.textContent = player.score.toLocaleString();
    this.multiplierEl.textContent = `x${player.multiplier}`;

    // Multiplier color scales with value
    const m = player.multiplier;
    if (m >= 100) {
      this.multiplierEl.style.color = '#ff00ff';
      this.multiplierEl.style.textShadow = '0 0 12px #ff00ff';
    } else if (m >= 50) {
      this.multiplierEl.style.color = '#ff8800';
      this.multiplierEl.style.textShadow = '0 0 10px #ff8800';
    } else if (m >= 20) {
      this.multiplierEl.style.color = '#ffff00';
      this.multiplierEl.style.textShadow = '0 0 8px #ffff00';
    } else if (m >= 5) {
      this.multiplierEl.style.color = '#00ff88';
      this.multiplierEl.style.textShadow = '0 0 8px #00ff88';
    } else {
      this.multiplierEl.style.color = '#0f0';
      this.multiplierEl.style.textShadow = '0 0 8px #0f0';
    }

    // Show hearts up to 5, then show number
    const lives = Math.max(0, player.lives);
    if (lives <= 5) {
      this.livesEl.textContent = '\u2665'.repeat(lives);
    } else {
      this.livesEl.textContent = `\u2665 x${lives}`;
    }

    // Show bombs up to 5, then show number
    const bombs = Math.max(0, player.bombs);
    if (bombs <= 5) {
      this.bombsEl.textContent = '\u25cf'.repeat(bombs);
    } else {
      this.bombsEl.textContent = `\u25cf x${bombs}`;
    }

    // Show current weapon + ammo
    if (weaponManager) {
      const weapon = weaponManager.getCurrentWeapon();
      const config = WEAPON_CONFIGS[weapon];
      const ammo = weaponManager.getCurrentAmmo();
      if (weapon === WeaponType.Standard) {
        this.weaponEl.textContent = '';
      } else {
        this.weaponEl.textContent = `${config.name} [${ammo}]`;
        this.weaponEl.style.color = `#${config.color.toString(16).padStart(6, '0')}`;
        this.weaponEl.style.textShadow = `0 0 8px #${config.color.toString(16).padStart(6, '0')}`;
      }
    }
  }

  /**
   * Update timer display (timed levels or endless elapsed time)
   */
  static updateTimerDisplay(timeRemaining: number, isTimedLevel: boolean): void {
    if (isTimedLevel) {
      const secs = Math.ceil(Math.max(0, timeRemaining));
      const mins = Math.floor(secs / 60);
      const remainingSecs = secs % 60;
      this.timerEl.textContent = `${mins}:${String(remainingSecs).padStart(2, '0')}`;
      this.timerEl.classList.toggle('urgent', secs <= 10);
    } else {
      const elapsed = Math.floor(timeRemaining);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      this.timerEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
    }
  }

  /**
   * Update countdown overlay (3... 2... 1... GO!)
   */
  static updateCountdownOverlay(countdownValue: number, isVisible: boolean): void {
    if (isVisible) {
      const countVal = Math.ceil(countdownValue);
      this.countdownEl.textContent = countVal > 0 ? String(countVal) : 'GO!';
      this.countdownEl.classList.add('visible');
    } else {
      this.countdownEl.textContent = 'GO!';
      this.countdownEl.classList.remove('visible');
    }
  }

  /**
   * Update player level display
   */
  static updatePlayerLevelDisplay(level: number, perkName: string, auraColor: number, killsToNext: number): void {
    if (level > 0) {
      const hexColor = auraColor.toString(16).padStart(6, '0');
      this.playerLevelEl.textContent = `LV${level} ${perkName}`;
      this.playerLevelEl.style.color = `#${hexColor}`;
      this.playerLevelEl.style.textShadow = `0 0 8px #${hexColor}`;
    } else {
      this.playerLevelEl.textContent = killsToNext > 0 ? `${killsToNext} kills to LV1` : '';
    }
  }

  /**
   * Update combo display
   */
  static updateComboDisplay(combo: number): void {
    if (combo >= 3) {
      this.comboEl.textContent = `${combo} COMBO`;
      // Color scales with combo level
      if (combo >= 20) {
        this.comboEl.style.color = '#ff00ff';
        this.comboEl.style.textShadow = '0 0 12px #ff00ff';
      } else if (combo >= 10) {
        this.comboEl.style.color = '#ff4400';
        this.comboEl.style.textShadow = '0 0 10px #ff4400';
      } else {
        this.comboEl.style.color = '#ff8800';
        this.comboEl.style.textShadow = '0 0 8px #ff8800';
      }
      // Pop animation
      this.comboEl.style.transform = 'scale(1.3)';
      setTimeout(() => { this.comboEl.style.transform = 'scale(1)'; }, 100);
    } else {
      this.comboEl.textContent = '';
    }
  }

  /**
   * Update boost cooldown indicator
   * @param boostActive - true during active boost burst
   * @param boostCooldown - seconds remaining on cooldown (0 = ready)
   */
  static updateBoostDisplay(boostActive: boolean, boostCooldown: number): void {
    if (!this.boostEl) return;
    this.boostEl.classList.remove('active', 'cooldown');
    if (boostActive) {
      this.boostEl.textContent = '⚡ BOOST';
      this.boostEl.classList.add('active');
    } else if (boostCooldown > 0) {
      this.boostEl.textContent = `⚡ ${boostCooldown.toFixed(1)}s`;
      this.boostEl.classList.add('cooldown');
    } else {
      this.boostEl.textContent = '⚡ BOOST';
    }
  }

  /**
   * Set level name in HUD
   */
  static setLevelName(name: string): void {
    this.levelNameEl.textContent = name;
  }

  /**
   * Get DOM elements (for external systems that need direct access)
   */
  static getDOMElements() {
    return {
      scoreEl: this.scoreEl,
      multiplierEl: this.multiplierEl,
      livesEl: this.livesEl,
      bombsEl: this.bombsEl,
      weaponEl: this.weaponEl,
      timerEl: this.timerEl,
      levelNameEl: this.levelNameEl,
      countdownEl: this.countdownEl,
      flashEl: this.flashEl,
      playerLevelEl: this.playerLevelEl,
      comboEl: this.comboEl,
    };
  }
}
