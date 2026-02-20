import * as THREE from 'three';

// Pre-allocated for zero-allocation orientation in update()
// RingGeometry lies in XY plane with +Z as its face normal.
const _ringZAxis = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LevelPerk {
  name: string;
  description: string;
  /** Cumulative damage multiplier at this level */
  damageMultiplier: number;
  /** Cumulative fire rate multiplier */
  fireRateMultiplier: number;
  /** Cumulative move speed multiplier */
  moveSpeedMultiplier: number;
  /** Cumulative bullet speed multiplier */
  bulletSpeedMultiplier: number;
  /** Extra bombs granted on level-up */
  bonusBombs: number;
  /** Aura ring radius (0 = no ring) */
  auraRadius: number;
  /** Aura color */
  auraColor: number;
}

// ---------------------------------------------------------------------------
// Level definitions
// ---------------------------------------------------------------------------

const LEVELS: LevelPerk[] = [
  // Level 0 (starting)
  { name: 'Rookie', description: '', damageMultiplier: 1.0, fireRateMultiplier: 1.0, moveSpeedMultiplier: 1.0, bulletSpeedMultiplier: 1.0, bonusBombs: 0, auraRadius: 0, auraColor: 0x222244 },
  // Level 1: 10 kills (was 15 — faster first level-up for immediate power fantasy)
  { name: 'Sharpshooter', description: '+15% damage', damageMultiplier: 1.15, fireRateMultiplier: 1.0, moveSpeedMultiplier: 1.0, bulletSpeedMultiplier: 1.0, bonusBombs: 0, auraRadius: 1.5, auraColor: 0x2244aa },
  // Level 2: 25 kills (was 40)
  { name: 'Gunslinger', description: '+15% fire rate', damageMultiplier: 1.15, fireRateMultiplier: 1.15, moveSpeedMultiplier: 1.0, bulletSpeedMultiplier: 1.0, bonusBombs: 1, auraRadius: 2.0, auraColor: 0x2266cc },
  // Level 3: 50 kills (was 75)
  { name: 'Blitz', description: '+15% move speed', damageMultiplier: 1.15, fireRateMultiplier: 1.15, moveSpeedMultiplier: 1.15, bulletSpeedMultiplier: 1.0, bonusBombs: 0, auraRadius: 2.5, auraColor: 0x0088ff },
  // Level 4: 80 kills (was 120)
  { name: 'Marksman', description: '+20% bullet speed', damageMultiplier: 1.15, fireRateMultiplier: 1.15, moveSpeedMultiplier: 1.15, bulletSpeedMultiplier: 1.2, bonusBombs: 1, auraRadius: 3.0, auraColor: 0x00aaff },
  // Level 5: 120 kills (was 180)
  { name: 'Destroyer', description: '+30% damage', damageMultiplier: 1.45, fireRateMultiplier: 1.15, moveSpeedMultiplier: 1.15, bulletSpeedMultiplier: 1.2, bonusBombs: 0, auraRadius: 3.5, auraColor: 0x00ccff },
  // Level 6: 175 kills (was 250)
  { name: 'Fury', description: '+25% fire rate', damageMultiplier: 1.45, fireRateMultiplier: 1.4, moveSpeedMultiplier: 1.15, bulletSpeedMultiplier: 1.2, bonusBombs: 1, auraRadius: 4.0, auraColor: 0x44ddff },
  // Level 7: 250 kills (was 350)
  { name: 'Juggernaut', description: '+15% move speed', damageMultiplier: 1.45, fireRateMultiplier: 1.4, moveSpeedMultiplier: 1.3, bulletSpeedMultiplier: 1.2, bonusBombs: 0, auraRadius: 4.5, auraColor: 0x88eeff },
  // Level 8: 350 kills (was 500)
  { name: 'Annihilator', description: '+35% damage', damageMultiplier: 1.8, fireRateMultiplier: 1.4, moveSpeedMultiplier: 1.3, bulletSpeedMultiplier: 1.3, bonusBombs: 1, auraRadius: 5.0, auraColor: 0xaaffff },
  // Level 9: 500 kills (was 750)
  { name: 'Apex', description: 'ALL +15%', damageMultiplier: 2.0, fireRateMultiplier: 1.55, moveSpeedMultiplier: 1.45, bulletSpeedMultiplier: 1.45, bonusBombs: 2, auraRadius: 6.0, auraColor: 0xffffff },
];

// Kill thresholds lowered across the board so player levels up faster.
// This creates the saw-tooth pattern: level up → dominate → difficulty catches up → level up again.
const LEVEL_THRESHOLDS = [0, 10, 25, 50, 80, 120, 175, 250, 350, 500];

// ---------------------------------------------------------------------------
// PlayerLevel
// ---------------------------------------------------------------------------

export class PlayerLevel {
  private kills = 0;
  private currentLevel = 0;

  /** Visual aura ring mesh */
  readonly auraRing: THREE.Mesh;
  private readonly auraMaterial: THREE.MeshBasicMaterial;
  private readonly auraGeometry: THREE.RingGeometry;
  private pulseTime = 0;

  /** Callback when player levels up */
  onLevelUp: ((level: number, perk: LevelPerk) => void) | null = null;

  constructor() {
    this.auraGeometry = new THREE.RingGeometry(0.85, 1.0, 48);
    this.auraMaterial = new THREE.MeshBasicMaterial({
      color: LEVELS[0].auraColor,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.auraRing = new THREE.Mesh(this.auraGeometry, this.auraMaterial);
    this.auraRing.renderOrder = 100;
  }

  /**
   * Record a kill and check for level-up.
   */
  addKill(): void {
    this.kills++;
    const newLevel = this.computeLevel();
    if (newLevel > this.currentLevel) {
      this.currentLevel = newLevel;
      const perk = LEVELS[this.currentLevel];
      this.updateAuraVisual();
      this.onLevelUp?.(this.currentLevel, perk);
    }
  }

  /**
   * Get current level (0-9).
   */
  get level(): number {
    return this.currentLevel;
  }

  /**
   * Get total kills.
   */
  get totalKills(): number {
    return this.kills;
  }

  /**
   * Get kills needed for next level (0 if max level).
   */
  get killsToNextLevel(): number {
    if (this.currentLevel >= LEVELS.length - 1) return 0;
    return LEVEL_THRESHOLDS[this.currentLevel + 1] - this.kills;
  }

  /**
   * Get the current level's perk data.
   */
  get perk(): LevelPerk {
    return LEVELS[this.currentLevel];
  }

  /**
   * Get the cumulative damage multiplier from leveling.
   */
  get damageMultiplier(): number {
    return LEVELS[this.currentLevel].damageMultiplier;
  }

  /**
   * Get the cumulative fire rate multiplier.
   */
  get fireRateMultiplier(): number {
    return LEVELS[this.currentLevel].fireRateMultiplier;
  }

  /**
   * Get the cumulative move speed multiplier.
   */
  get moveSpeedMultiplier(): number {
    return LEVELS[this.currentLevel].moveSpeedMultiplier;
  }

  /**
   * Get the cumulative bullet speed multiplier.
   */
  get bulletSpeedMultiplier(): number {
    return LEVELS[this.currentLevel].bulletSpeedMultiplier;
  }

  /**
   * Update aura ring position and pulse animation. Call each frame.
   */
  update(dt: number, position: THREE.Vector3, normal: THREE.Vector3): void {
    this.pulseTime += dt;

    if (this.currentLevel === 0) {
      this.auraRing.visible = false;
      return;
    }

    this.auraRing.visible = true;
    const perk = LEVELS[this.currentLevel];

    // Position on surface
    this.auraRing.position.copy(position).addScaledVector(normal, 0.06);
    // Orient ring to lie flat on the surface (face perpendicular to surface normal).
    // setFromUnitVectors is robust for all normal directions, including (0,1,0)
    // which breaks lookAt() (degenerate when look-direction == world-up).
    // This fixes the ring appearing incorrect at the top of the torus tube in LAN mode.
    this.auraRing.quaternion.setFromUnitVectors(_ringZAxis, normal);

    // Pulse animation
    const pulse = 1.0 + Math.sin(this.pulseTime * 1.8) * 0.05;
    this.auraRing.scale.setScalar(perk.auraRadius * pulse);

    // Breathing opacity
    this.auraMaterial.opacity = 0.12 + Math.sin(this.pulseTime * 1.2) * 0.05;
  }

  /**
   * Reset to level 0.
   */
  reset(): void {
    this.kills = 0;
    this.currentLevel = 0;
    this.updateAuraVisual();
  }

  dispose(): void {
    this.auraGeometry.dispose();
    this.auraMaterial.dispose();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private computeLevel(): number {
    let level = 0;
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (this.kills >= LEVEL_THRESHOLDS[i]) {
        level = i;
        break;
      }
    }
    return level;
  }

  private updateAuraVisual(): void {
    const perk = LEVELS[this.currentLevel];
    this.auraMaterial.color.setHex(perk.auraColor);
    if (perk.auraRadius <= 0) {
      this.auraRing.visible = false;
    }
  }
}

// ---------------------------------------------------------------------------
// LevelUpNotification (DOM-based floating text)
// ---------------------------------------------------------------------------

export class LevelUpNotification {
  private container: HTMLDivElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'level-up-notification';
    this.container.style.cssText = `
      position: fixed;
      top: 35%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 500;
      pointer-events: none;
      text-align: center;
      font-family: 'Segoe UI', Arial, sans-serif;
      display: none;
    `;
    document.body.appendChild(this.container);
  }

  show(level: number, perk: LevelPerk): void {
    this.container.innerHTML = `
      <div style="
        font-size: 48px;
        font-weight: bold;
        color: #${perk.auraColor.toString(16).padStart(6, '0')};
        text-shadow: 0 0 15px #${perk.auraColor.toString(16).padStart(6, '0')},
                     0 0 30px #${perk.auraColor.toString(16).padStart(6, '0')};
        letter-spacing: 6px;
        animation: levelUpPulse 0.5s ease-out;
      ">LEVEL ${level}</div>
      <div style="
        font-size: 24px;
        color: #ffffff;
        text-shadow: 0 0 8px #ffffff;
        margin-top: 8px;
        letter-spacing: 3px;
      ">${perk.name}</div>
      <div style="
        font-size: 16px;
        color: #aaaacc;
        margin-top: 4px;
        letter-spacing: 2px;
      ">${perk.description}</div>
    `;

    // Add animation keyframes if not present
    if (!document.getElementById('level-up-keyframes')) {
      const style = document.createElement('style');
      style.id = 'level-up-keyframes';
      style.textContent = `
        @keyframes levelUpPulse {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1.0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    this.container.style.display = 'block';

    // Fade out after 2 seconds
    setTimeout(() => {
      this.container.style.transition = 'opacity 0.5s';
      this.container.style.opacity = '0';
      setTimeout(() => {
        this.container.style.display = 'none';
        this.container.style.opacity = '1';
        this.container.style.transition = '';
      }, 500);
    }, 2000);
  }

  dispose(): void {
    this.container.remove();
  }
}
