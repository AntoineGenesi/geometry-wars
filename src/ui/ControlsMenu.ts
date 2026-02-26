/**
 * Controls configuration menu overlay.
 *
 * Shows all players' key bindings in a grid.
 * Click a slot to rebind, press a key to assign.
 * Conflict detection warns if the same key is used by multiple players.
 * Accessible from StartMenu and PauseMenu.
 */

import type { ConfigurableInput, PlayerBindings } from '../input/ConfigurableInput';
import { t } from '../i18n';

const PLAYER_COLORS = ['#00ffff', '#ff00ff', '#00ff00', '#ffaa00'];
const ACTION_LABELS: Array<{ key: keyof PlayerBindings; label: string }> = [
  { key: 'up', label: 'UP' },
  { key: 'down', label: 'DOWN' },
  { key: 'left', label: 'LEFT' },
  { key: 'right', label: 'RIGHT' },
  { key: 'shoot', label: 'SHOOT' },
  { key: 'bomb', label: 'BOMB' },
];

function displayKey(key: string): string {
  if (key === ' ') return 'SPACE';
  if (key === 'MouseLeft') return 'L-CLICK';
  if (key === 'ArrowUp') return 'UP';
  if (key === 'ArrowDown') return 'DOWN';
  if (key === 'ArrowLeft') return 'LEFT';
  if (key === 'ArrowRight') return 'RIGHT';
  if (key === 'Enter') return 'ENTER';
  if (key === 'Shift') return 'SHIFT';
  return key.toUpperCase();
}

export class ControlsMenu {
  private container: HTMLDivElement;
  private input: ConfigurableInput | null = null;
  private onCloseCallback: (() => void) | null = null;

  // Rebind state
  private rebindPlayer = -1;
  private rebindAction = '';
  private rebindHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'controls-menu';
    this.container.classList.add('hidden');
    this.applyStyles();
    document.body.appendChild(this.container);
  }

  private applyStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      #controls-menu {
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        background: rgba(0, 0, 20, 0.92);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 3000;
        font-family: 'Segoe UI', Arial, sans-serif;
        backdrop-filter: blur(5px);
      }
      #controls-menu.hidden { display: none; }

      #controls-menu .controls-content {
        text-align: center;
        padding: 30px;
        max-width: 700px;
        width: 100%;
      }
      #controls-menu h1 {
        color: #ffff00;
        font-size: 36px;
        letter-spacing: 6px;
        margin-bottom: 30px;
        text-shadow: 0 0 10px #ffff00;
      }
      #controls-menu .bindings-grid {
        display: grid;
        gap: 4px;
        margin-bottom: 20px;
      }
      #controls-menu .grid-header {
        color: #888;
        font-size: 12px;
        letter-spacing: 2px;
        padding: 6px 4px;
        text-align: center;
      }
      #controls-menu .key-slot {
        background: rgba(40, 40, 80, 0.6);
        border: 1px solid #444488;
        color: #ccccff;
        padding: 8px 4px;
        font-size: 13px;
        cursor: pointer;
        text-align: center;
        transition: all 0.15s;
        letter-spacing: 1px;
      }
      #controls-menu .key-slot:hover {
        background: rgba(60, 60, 120, 0.8);
        border-color: #8888ff;
      }
      #controls-menu .key-slot.listening {
        background: rgba(100, 100, 0, 0.6);
        border-color: #ffff00;
        color: #ffff00;
        animation: pulse 0.8s infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      #controls-menu .key-slot.conflict {
        border-color: #ff4444;
        color: #ff8888;
      }
      #controls-menu .conflict-warning {
        color: #ff6644;
        font-size: 12px;
        margin: 10px 0;
        min-height: 18px;
      }
      #controls-menu .controls-buttons {
        display: flex;
        gap: 15px;
        justify-content: center;
        margin-top: 20px;
      }
      #controls-menu .ctrl-btn {
        background: linear-gradient(180deg, #333366 0%, #222244 100%);
        border: 2px solid #6666aa;
        color: #ffffff;
        padding: 12px 30px;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        letter-spacing: 2px;
        transition: all 0.2s;
      }
      #controls-menu .ctrl-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 0 15px #8888ff;
      }
      #controls-menu .ctrl-btn.primary {
        background: linear-gradient(180deg, #00aa00 0%, #006600 100%);
        border-color: #00ff00;
      }
      #controls-menu .ctrl-btn.primary:hover {
        box-shadow: 0 0 15px #00ff00;
      }
    `;
    document.head.appendChild(style);
  }

  setInput(input: ConfigurableInput): void {
    this.input = input;
  }

  show(): void {
    this.rebuildContent();
    this.container.classList.remove('hidden');
  }

  hide(): void {
    this.cancelRebind();
    this.container.classList.add('hidden');
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  private rebuildContent(): void {
    if (!this.input) return;
    const pc = this.input.getPlayerCount();
    const cols = pc + 1; // action label + one column per player

    let html = `<div class="controls-content"><h1>${t('controls.title')}</h1>`;
    html += `<div class="bindings-grid" style="grid-template-columns: 80px repeat(${pc}, 1fr);">`;

    // Header row
    html += `<div class="grid-header">${t('controls.action')}</div>`;
    for (let p = 0; p < pc; p++) {
      html += `<div class="grid-header" style="color:${PLAYER_COLORS[p]}">P${p + 1}</div>`;
    }

    // Aim mode row
    html += `<div class="grid-header">${t('controls.aim')}</div>`;
    for (let p = 0; p < pc; p++) {
      const b = this.input.getBindings(p);
      html += `<div class="grid-header" style="color:${PLAYER_COLORS[p]}">${b.aimMode === 'mouse' ? t('controls.mouse') : t('controls.auto')}</div>`;
    }

    // Key binding rows
    for (const action of ACTION_LABELS) {
      html += `<div class="grid-header">${t('controls.actions.' + action.key)}</div>`;
      for (let p = 0; p < pc; p++) {
        const b = this.input.getBindings(p);
        const keyVal = b[action.key] as string;
        const isListening = this.rebindPlayer === p && this.rebindAction === action.key;
        html += `<div class="key-slot${isListening ? ' listening' : ''}"
                      data-player="${p}" data-action="${action.key}">
                   ${isListening ? t('controls.pressKey') : displayKey(keyVal)}
                 </div>`;
      }
    }
    html += '</div>';

    // Conflicts
    const conflicts = this.input.getConflicts();
    html += `<div class="conflict-warning">${conflicts.length > 0 ? t('controls.conflicts', { list: conflicts.join(', ') }) : ''}</div>`;

    // Buttons
    html += '<div class="controls-buttons">';
    html += `<button class="ctrl-btn" data-action="reset">${t('controls.resetDefaults')}</button>`;
    html += `<button class="ctrl-btn primary" data-action="done">${t('controls.done')}</button>`;
    html += '</div></div>';

    this.container.innerHTML = html;

    // Attach click handlers
    this.container.querySelectorAll('.key-slot').forEach(el => {
      el.addEventListener('click', () => {
        const p = parseInt((el as HTMLElement).dataset.player ?? '0', 10);
        const a = (el as HTMLElement).dataset.action ?? '';
        this.startRebind(p, a);
      });
    });

    this.container.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
      this.input?.resetDefaults();
      this.rebuildContent();
    });

    this.container.querySelector('[data-action="done"]')?.addEventListener('click', () => {
      this.hide();
      this.onCloseCallback?.();
    });
  }

  private startRebind(playerIndex: number, action: string): void {
    this.cancelRebind();
    this.rebindPlayer = playerIndex;
    this.rebindAction = action;
    this.rebuildContent();

    this.rebindHandler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        this.cancelRebind();
        this.rebuildContent();
        return;
      }

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.applyRebind(key);
    };
    // Use capture to intercept before game input
    window.addEventListener('keydown', this.rebindHandler, true);
  }

  private applyRebind(key: string): void {
    if (!this.input || this.rebindPlayer < 0) return;
    const bindings = this.input.getBindings(this.rebindPlayer);
    (bindings as any)[this.rebindAction] = key;
    this.input.setBindings(this.rebindPlayer, bindings);
    this.cancelRebind();
    this.rebuildContent();
  }

  private cancelRebind(): void {
    if (this.rebindHandler) {
      window.removeEventListener('keydown', this.rebindHandler, true);
      this.rebindHandler = null;
    }
    this.rebindPlayer = -1;
    this.rebindAction = '';
  }

  dispose(): void {
    this.cancelRebind();
    this.container.remove();
  }
}
