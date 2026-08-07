import {
  ENEMY_COMPENDIUM_ENTRIES,
  maskEnemyDescription,
  type EnemyCompendiumEntry,
} from '../entities/enemies/EnemyCompendium';
import { createEnemyModelPreviewElement, createLockedEnemyPreviewElement } from './EnemyModelPreview';
import { enemyDiscoveryStore, type EnemyDiscoveryStore } from './EnemyDiscoveryStore';

const STYLE_ID = 'enemy-compendium-screen-styles';

export class EnemyCompendiumScreen {
  private container: HTMLDivElement;
  private onCloseCallback: (() => void) | null = null;
  private escHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(private readonly store: EnemyDiscoveryStore = enemyDiscoveryStore) {
    this.container = document.createElement('div');
    this.container.id = 'enemy-compendium-screen';
    this.container.className = 'hidden';
    this.container.setAttribute('role', 'dialog');
    this.container.setAttribute('aria-modal', 'true');
    this.container.setAttribute('aria-labelledby', 'enemy-compendium-title');
    this.applyStyles();
    document.body.appendChild(this.container);
    this.attachGlobalListeners();
  }

  show(): void {
    this.render();
    this.container.classList.remove('hidden');
  }

  hide(): void {
    this.container.classList.add('hidden');
    this.onCloseCallback?.();
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  dispose(): void {
    if (this.escHandler) {
      document.removeEventListener('keydown', this.escHandler, true);
      this.escHandler = null;
    }
    this.container.remove();
  }

  private render(): void {
    const seen = this.store.getSeenTypes();
    this.container.replaceChildren();

    const panel = document.createElement('div');
    panel.className = 'ecs-panel';

    const header = document.createElement('div');
    header.className = 'ecs-header';

    const titleBlock = document.createElement('div');
    const title = document.createElement('h1');
    title.id = 'enemy-compendium-title';
    title.textContent = 'ENEMY TYPES';
    const subtitle = document.createElement('div');
    subtitle.className = 'ecs-subtitle';
    subtitle.textContent = `${seen.size}/${ENEMY_COMPENDIUM_ENTRIES.length} discovered`;
    titleBlock.append(title, subtitle);

    const close = document.createElement('button');
    close.className = 'ecs-close';
    close.type = 'button';
    close.textContent = 'CLOSE';
    close.addEventListener('click', () => this.hide());

    header.append(titleBlock, close);

    const grid = document.createElement('div');
    grid.className = 'ecs-grid';
    grid.dataset.enemyCompendiumGrid = 'true';

    for (const entry of ENEMY_COMPENDIUM_ENTRIES) {
      grid.appendChild(this.createEntry(entry, seen.has(entry.type)));
    }

    panel.append(header, grid);
    this.container.appendChild(panel);
  }

  private createEntry(entry: EnemyCompendiumEntry, isSeen: boolean): HTMLElement {
    const card = document.createElement('article');
    card.className = `ecs-entry${isSeen ? ' seen' : ' locked'}`;
    card.dataset.enemyType = entry.type;
    card.dataset.discoveryState = isSeen ? 'seen' : 'locked';

    const previewWrap = document.createElement('div');
    previewWrap.className = 'ecs-preview-wrap';
    previewWrap.appendChild(
      isSeen
        ? createEnemyModelPreviewElement(entry.previewType, entry.displayName, '#66f0ff')
        : createLockedEnemyPreviewElement(entry.lockedName),
    );

    const text = document.createElement('div');
    text.className = 'ecs-entry-text';

    const name = document.createElement('h2');
    name.textContent = isSeen ? entry.displayName : entry.lockedName;

    const desc = document.createElement('p');
    desc.className = 'ecs-description';
    desc.textContent = isSeen
      ? entry.attackDescription
      : maskEnemyDescription(entry.attackDescription);

    text.append(name, desc);
    card.append(previewWrap, text);
    return card;
  }

  private attachGlobalListeners(): void {
    this.escHandler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || this.container.classList.contains('hidden')) return;
      event.stopPropagation();
      this.hide();
    };
    document.addEventListener('keydown', this.escHandler, true);
  }

  private applyStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #enemy-compendium-screen {
        position: fixed;
        inset: 0;
        z-index: 2600;
        display: flex;
        justify-content: center;
        align-items: stretch;
        padding: max(20px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
        box-sizing: border-box;
        background: rgba(0, 0, 16, 0.9);
        color: #e8fbff;
        font-family: 'Segoe UI', Arial, sans-serif;
      }

      #enemy-compendium-screen.hidden {
        display: none;
      }

      #enemy-compendium-screen .ecs-panel {
        width: min(1120px, 100%);
        min-height: 0;
        display: flex;
        flex-direction: column;
        background: rgba(5, 8, 22, 0.96);
        border: 1px solid rgba(120, 180, 220, 0.35);
        border-top: 2px solid rgba(0, 220, 255, 0.6);
        border-radius: 6px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.65);
        overflow: hidden;
      }

      #enemy-compendium-screen .ecs-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 18px 20px;
        border-bottom: 1px solid rgba(100, 150, 190, 0.25);
      }

      #enemy-compendium-screen h1 {
        margin: 0;
        font-size: 24px;
        letter-spacing: 4px;
        color: #66f0ff;
      }

      #enemy-compendium-screen .ecs-subtitle {
        margin-top: 4px;
        color: #88a8b6;
        font-size: 12px;
        letter-spacing: 2px;
        text-transform: uppercase;
      }

      #enemy-compendium-screen .ecs-close {
        flex: 0 0 auto;
        min-height: 42px;
        padding: 10px 18px;
        background: rgba(20, 28, 55, 0.95);
        border: 1px solid rgba(130, 165, 220, 0.55);
        border-radius: 3px;
        color: #dcecff;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 2px;
        cursor: pointer;
      }

      #enemy-compendium-screen .ecs-grid {
        min-height: 0;
        overflow-y: auto;
        padding: 18px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 12px;
      }

      #enemy-compendium-screen .ecs-entry {
        min-width: 0;
        min-height: 118px;
        display: grid;
        grid-template-columns: 84px minmax(0, 1fr);
        gap: 12px;
        align-items: center;
        padding: 12px;
        border: 1px solid rgba(95, 140, 180, 0.26);
        border-radius: 6px;
        background: rgba(8, 14, 32, 0.88);
      }

      #enemy-compendium-screen .ecs-entry.locked {
        border-color: rgba(80, 85, 105, 0.28);
        background: rgba(4, 6, 13, 0.92);
      }

      #enemy-compendium-screen .ecs-preview-wrap {
        width: 84px;
        height: 84px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      #enemy-compendium-screen .ap-enemy-preview,
      #enemy-compendium-screen .ap-enemy-preview-img {
        width: 72px;
        height: 72px;
      }

      #enemy-compendium-screen .ap-enemy-preview {
        position: relative;
        flex: 0 0 auto;
      }

      #enemy-compendium-screen .ap-enemy-preview-img {
        position: absolute;
        inset: 0;
        object-fit: contain;
        opacity: 0;
      }

      #enemy-compendium-screen .ap-enemy-preview-frame {
        animation: ecsPreviewFrame 2.4s steps(1) infinite;
      }

      #enemy-compendium-screen .ap-enemy-preview-fallback {
        width: 42px;
        height: 42px;
        margin: 15px;
        border: 2px solid #66f0ff;
        transform: rotate(45deg);
      }

      #enemy-compendium-screen .ap-enemy-preview-question {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #000;
        border: 1px solid rgba(255, 255, 255, 0.18);
        color: #111;
        -webkit-text-stroke: 2px #2a2a2a;
        font-size: 54px;
        font-weight: 900;
        line-height: 1;
        animation: ecsLockedSpin 2.8s linear infinite;
      }

      #enemy-compendium-screen .ecs-entry-text {
        min-width: 0;
      }

      #enemy-compendium-screen h2 {
        margin: 0 0 8px;
        color: #ffffff;
        font-size: 16px;
        letter-spacing: 1px;
      }

      #enemy-compendium-screen .locked h2 {
        color: #73788a;
      }

      #enemy-compendium-screen .ecs-description {
        margin: 0;
        color: #a9c4d0;
        font-size: 12px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      #enemy-compendium-screen .locked .ecs-description {
        color: #555b6c;
        font-family: Consolas, 'Courier New', monospace;
        letter-spacing: 1px;
      }

      @keyframes ecsPreviewFrame {
        0%, 12.49% { opacity: 1; }
        12.5%, 100% { opacity: 0; }
      }

      @keyframes ecsLockedSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      @media (max-width: 700px) {
        #enemy-compendium-screen {
          padding: max(10px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
        }

        #enemy-compendium-screen .ecs-header {
          padding: 14px;
        }

        #enemy-compendium-screen h1 {
          font-size: 20px;
          letter-spacing: 2px;
        }

        #enemy-compendium-screen .ecs-grid {
          grid-template-columns: 1fr;
          padding: 10px;
          gap: 10px;
        }

        #enemy-compendium-screen .ecs-entry {
          grid-template-columns: 68px minmax(0, 1fr);
          min-height: 102px;
          padding: 10px;
        }

        #enemy-compendium-screen .ecs-preview-wrap {
          width: 68px;
          height: 68px;
        }

        #enemy-compendium-screen .ap-enemy-preview,
        #enemy-compendium-screen .ap-enemy-preview-img {
          width: 58px;
          height: 58px;
        }

        #enemy-compendium-screen .ap-enemy-preview-question {
          width: 54px;
          height: 54px;
          font-size: 44px;
        }
      }
    `;
    document.head.appendChild(style);
  }
}
