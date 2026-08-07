import { ENEMY_COMPENDIUM, normalizeEnemyCompendiumType } from '../entities/enemies/EnemyCompendium';
import type { EnemyType } from '../entities/enemies/EnemySpawner';
import { createEnemyModelPreviewElement } from './EnemyModelPreview';

const STYLE_ID = 'enemy-discovery-toast-styles';
const DISPLAY_MS = 3200;

export class EnemyDiscoveryToast {
  private container: HTMLDivElement;
  private readonly queue: EnemyType[] = [];
  private readonly queuedTypes = new Set<EnemyType>();
  private readonly shownTypes = new Set<EnemyType>();
  private activeType: EnemyType | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'enemy-discovery-toast';
    this.container.setAttribute('aria-live', 'polite');
    this.applyStyles();
    document.body.appendChild(this.container);
  }

  enqueue(type: string): boolean {
    const normalized = normalizeEnemyCompendiumType(type);
    if (!normalized) return false;
    if (this.activeType === normalized || this.queuedTypes.has(normalized) || this.shownTypes.has(normalized)) {
      return false;
    }

    this.queue.push(normalized);
    this.queuedTypes.add(normalized);
    if (!this.activeType) this.showNext();
    return true;
  }

  getQueueLengthForTests(): number {
    return this.queue.length + (this.activeType ? 1 : 0);
  }

  dispose(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.container.remove();
  }

  private showNext(): void {
    const next = this.queue.shift();
    if (!next) {
      this.activeType = null;
      this.container.replaceChildren();
      this.container.classList.remove('visible');
      return;
    }

    this.queuedTypes.delete(next);
    this.activeType = next;
    this.shownTypes.add(next);
    this.render(next);

    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.activeType = null;
      this.container.classList.remove('visible');
      this.hideTimer = setTimeout(() => this.showNext(), 220);
    }, DISPLAY_MS);
  }

  private render(type: EnemyType): void {
    const entry = ENEMY_COMPENDIUM[type];
    this.container.replaceChildren();

    const toast = document.createElement('div');
    toast.className = 'edt-card';
    toast.dataset.enemyDiscoveryToast = type;

    const preview = document.createElement('div');
    preview.className = 'edt-preview';
    preview.appendChild(createEnemyModelPreviewElement(entry.previewType, entry.displayName, '#66f0ff'));

    const text = document.createElement('div');
    text.className = 'edt-text';
    const kicker = document.createElement('div');
    kicker.className = 'edt-kicker';
    kicker.textContent = 'NEW ENEMY TYPE';
    const name = document.createElement('div');
    name.className = 'edt-name';
    name.textContent = entry.displayName;
    text.append(kicker, name);

    toast.append(preview, text);
    this.container.appendChild(toast);
    this.container.classList.add('visible');
  }

  private applyStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #enemy-discovery-toast {
        position: fixed;
        right: max(18px, env(safe-area-inset-right));
        bottom: max(18px, env(safe-area-inset-bottom));
        z-index: 2200;
        pointer-events: none;
        opacity: 0;
        transform: translateY(16px);
        transition: opacity 0.18s ease, transform 0.18s ease;
        font-family: 'Segoe UI', Arial, sans-serif;
      }

      #enemy-discovery-toast.visible {
        opacity: 1;
        transform: translateY(0);
      }

      #enemy-discovery-toast .edt-card {
        width: min(340px, calc(100vw - 28px));
        min-height: 92px;
        display: grid;
        grid-template-columns: 76px minmax(0, 1fr);
        gap: 12px;
        align-items: center;
        padding: 10px 14px 10px 10px;
        box-sizing: border-box;
        background: rgba(3, 7, 18, 0.94);
        border: 1px solid rgba(90, 210, 255, 0.5);
        border-radius: 6px;
        box-shadow: 0 16px 34px rgba(0, 0, 0, 0.5), 0 0 22px rgba(0, 220, 255, 0.18);
      }

      #enemy-discovery-toast .edt-preview {
        width: 76px;
        height: 76px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      #enemy-discovery-toast .ap-enemy-preview,
      #enemy-discovery-toast .ap-enemy-preview-img {
        width: 64px;
        height: 64px;
      }

      #enemy-discovery-toast .ap-enemy-preview {
        position: relative;
      }

      #enemy-discovery-toast .ap-enemy-preview-img {
        position: absolute;
        inset: 0;
        object-fit: contain;
        opacity: 0;
      }

      #enemy-discovery-toast .ap-enemy-preview-frame {
        animation: edtPreviewFrame 2.4s steps(1) infinite;
      }

      #enemy-discovery-toast .ap-enemy-preview-fallback {
        width: 38px;
        height: 38px;
        margin: 13px;
        border: 2px solid #66f0ff;
        transform: rotate(45deg);
      }

      #enemy-discovery-toast .edt-text {
        min-width: 0;
      }

      #enemy-discovery-toast .edt-kicker {
        color: #66f0ff;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 2px;
      }

      #enemy-discovery-toast .edt-name {
        margin-top: 5px;
        color: #fff;
        font-size: 18px;
        font-weight: 800;
        line-height: 1.15;
        overflow-wrap: anywhere;
      }

      @keyframes edtPreviewFrame {
        0%, 12.49% { opacity: 1; }
        12.5%, 100% { opacity: 0; }
      }

      @media (max-width: 520px) {
        #enemy-discovery-toast {
          right: max(10px, env(safe-area-inset-right));
          bottom: max(10px, env(safe-area-inset-bottom));
        }

        #enemy-discovery-toast .edt-card {
          width: min(300px, calc(100vw - 20px));
          grid-template-columns: 60px minmax(0, 1fr);
          min-height: 78px;
          gap: 8px;
          padding: 8px 10px 8px 8px;
        }

        #enemy-discovery-toast .edt-preview {
          width: 60px;
          height: 60px;
        }

        #enemy-discovery-toast .ap-enemy-preview,
        #enemy-discovery-toast .ap-enemy-preview-img {
          width: 52px;
          height: 52px;
        }

        #enemy-discovery-toast .edt-name {
          font-size: 16px;
        }
      }
    `;
    document.head.appendChild(style);
  }
}
