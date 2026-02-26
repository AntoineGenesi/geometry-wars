import { WeaponType, WEAPON_CONFIGS } from '../weapons/WeaponTypes';
import { getNodeById } from '../systems/UpgradeTreeData';

// ---------------------------------------------------------------------------
// UpgradeNotification
// Brief HUD notification shown when a weapon upgrade node activates mid-match
// or when the player earns a mastery point.
// ---------------------------------------------------------------------------

export class UpgradeNotification {
  private container: HTMLDivElement;
  private hideTimeout: number | null = null;
  private fadeTimeout: number | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'upgrade-notification';
    this.container.style.cssText = `
      position: fixed;
      top: 12%;
      left: 50%;
      transform: translateX(-50%);
      z-index: 500;
      pointer-events: none;
      text-align: center;
      font-family: 'Segoe UI', Arial, sans-serif;
      display: none;
    `;
    document.body.appendChild(this.container);
  }

  /**
   * Show a notification for a newly-activated upgrade node.
   * Displays weapon name + node description for 3 seconds then fades out.
   */
  show(nodeId: string, weaponType: WeaponType): void {
    const upgradeNode = getNodeById(nodeId);
    if (!upgradeNode) return;

    const config = WEAPON_CONFIGS[weaponType];
    const colorHex = '#' + config.color.toString(16).padStart(6, '0');

    this.container.innerHTML = `
      <div style="
        font-size: 16px;
        font-weight: bold;
        color: ${colorHex};
        text-shadow: 0 0 10px ${colorHex};
        letter-spacing: 3px;
        text-transform: uppercase;
      ">⚡ ${config.name} UPGRADE UNLOCKED</div>
      <div style="
        font-size: 13px;
        color: #88ff88;
        text-shadow: 0 0 6px #44ff44;
        margin-top: 4px;
        letter-spacing: 1px;
      ">${upgradeNode.description}</div>
    `;

    this._show(3000);
  }

  /**
   * Show a brief "MASTERY POINT EARNED" notification for 2 seconds.
   */
  showMasteryPointEarned(): void {
    this.container.innerHTML = `
      <div style="
        font-size: 18px;
        font-weight: bold;
        color: #ffd700;
        text-shadow: 0 0 12px #ffd700, 0 0 24px #ff8800;
        letter-spacing: 4px;
      ">MASTERY POINT EARNED</div>
      <div style="
        font-size: 12px;
        color: #ffcc44;
        margin-top: 4px;
        letter-spacing: 2px;
      ">Open Pause Menu → Weapon Mastery to spend</div>
    `;

    this._show(2000);
  }

  dispose(): void {
    if (this.hideTimeout !== null) clearTimeout(this.hideTimeout);
    if (this.fadeTimeout !== null) clearTimeout(this.fadeTimeout);
    this.container.remove();
  }

  private _show(durationMs: number): void {
    // Cancel any in-progress hide
    if (this.hideTimeout !== null) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    if (this.fadeTimeout !== null) {
      clearTimeout(this.fadeTimeout);
      this.fadeTimeout = null;
    }

    this.container.style.display = 'block';
    this.container.style.opacity = '1';
    this.container.style.transition = '';

    this.hideTimeout = window.setTimeout(() => {
      this.container.style.transition = 'opacity 0.5s';
      this.container.style.opacity = '0';
      this.fadeTimeout = window.setTimeout(() => {
        this.container.style.display = 'none';
        this.container.style.opacity = '1';
        this.container.style.transition = '';
      }, 500);
    }, durationMs);
  }
}
