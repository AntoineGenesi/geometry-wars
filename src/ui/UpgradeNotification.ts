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
    this.ensureStyles();
    this.container = document.createElement('div');
    this.container.id = 'upgrade-notification';
    this.container.style.cssText = `
      position: fixed;
      bottom: 11%;
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
      <div class="upgrade-notification-title" style="color: ${colorHex}; text-shadow: 0 0 10px ${colorHex};">⚡ ${config.name} UPGRADE UNLOCKED</div>
      <div class="upgrade-notification-body">${upgradeNode.description}</div>
    `;

    this._show(3000);
  }

  /**
   * Show a brief "MASTERY POINT EARNED" notification for 2 seconds.
   */
  showMasteryPointEarned(): void {
    this.container.innerHTML = `
      <div class="upgrade-notification-title mastery-point">MASTERY POINT EARNED</div>
      <div class="upgrade-notification-body mastery-point-help">Open Pause Menu → Weapon Mastery to spend</div>
    `;

    this._show(2000);
  }

  dispose(): void {
    if (this.hideTimeout !== null) clearTimeout(this.hideTimeout);
    if (this.fadeTimeout !== null) clearTimeout(this.fadeTimeout);
    this.container.remove();
  }

  private ensureStyles(): void {
    if (document.getElementById('upgrade-notification-style')) return;
    const styleEl = document.createElement('style');
    styleEl.id = 'upgrade-notification-style';
    styleEl.textContent = `
      #upgrade-notification .upgrade-notification-title {
        font-size: 16px;
        font-weight: bold;
        letter-spacing: 3px;
        text-transform: uppercase;
      }

      #upgrade-notification .upgrade-notification-body {
        margin-top: 4px;
        color: #88ff88;
        font-size: 13px;
        letter-spacing: 1px;
        text-shadow: 0 0 6px #44ff44;
      }

      #upgrade-notification .mastery-point {
        color: #ffd700;
        font-size: 18px;
        letter-spacing: 4px;
        text-shadow: 0 0 12px #ffd700, 0 0 24px #ff8800;
      }

      #upgrade-notification .mastery-point-help {
        color: #ffcc44;
        font-size: 12px;
        letter-spacing: 2px;
        text-shadow: none;
      }

      @media (pointer: coarse), (max-width: 640px) {
        #upgrade-notification {
          top: max(10px, env(safe-area-inset-top)) !important;
          bottom: auto !important;
          left: max(10px, env(safe-area-inset-left)) !important;
          width: min(230px, calc(100vw - 20px));
          transform: none !important;
          text-align: left !important;
          opacity: 0.88;
        }

        #upgrade-notification .upgrade-notification-title {
          font-size: 10px;
          line-height: 1.15;
          letter-spacing: 1px;
          text-shadow: none !important;
        }

        #upgrade-notification .upgrade-notification-body {
          margin-top: 2px;
          font-size: 9px;
          line-height: 1.2;
          letter-spacing: 0;
          color: rgba(210, 255, 210, 0.72);
          text-shadow: none;
        }
      }
    `;
    document.head.appendChild(styleEl);
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
