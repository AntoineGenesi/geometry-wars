import { StackBuffType, BuffDefinition, BUFF_DEFINITIONS } from './BuffManager';

// ---------------------------------------------------------------------------
// BuffHUD - Compact icon bar showing active buffs with stack counts
// ---------------------------------------------------------------------------

const ICON_SIZE = 28; // px
const ICON_GAP = 4;   // px between icons
const GLOW_DURATION = 600; // ms

export class BuffHUD {
  private container: HTMLDivElement;
  private iconElements: Map<StackBuffType, HTMLDivElement> = new Map();
  private glowTimers: Map<StackBuffType, number> = new Map();
  private compactMode = false;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'buff-hud';
    this.container.style.cssText = `
      position: fixed;
      top: 50px;
      right: 30px;
      display: flex;
      flex-direction: column;
      gap: ${ICON_GAP}px;
      pointer-events: none;
      z-index: 150;
      font-family: 'Segoe UI', Arial, sans-serif;
    `;
    document.body.appendChild(this.container);

    // Add styles for glow animation
    if (!document.getElementById('buff-hud-styles')) {
      const style = document.createElement('style');
      style.id = 'buff-hud-styles';
      style.textContent = `
        @keyframes buffGlow {
          0% { box-shadow: 0 0 4px currentColor; transform: scale(1.0); }
          50% { box-shadow: 0 0 14px currentColor; transform: scale(1.15); }
          100% { box-shadow: 0 0 4px currentColor; transform: scale(1.0); }
        }
        .buff-icon-glow {
          animation: buffGlow 0.6s ease-out;
        }
      `;
      document.head.appendChild(style);
    }
  }

  /**
   * Update the HUD to reflect current buff state.
   * Call each frame (or when buffs change).
   */
  update(activeBuffs: Array<{ type: StackBuffType; stacks: number; def: BuffDefinition }>): void {
    // Track which types are still active
    const activeTypes = new Set<StackBuffType>();

    for (const buff of activeBuffs) {
      activeTypes.add(buff.type);
      let iconEl = this.iconElements.get(buff.type);

      if (!iconEl) {
        // Create new icon element
        iconEl = this.createIconElement(buff.def);
        this.iconElements.set(buff.type, iconEl);
        this.container.appendChild(iconEl);
      }

      // Update stack count
      const countEl = iconEl.querySelector('.buff-count') as HTMLSpanElement;
      if (countEl) {
        countEl.textContent = `x${buff.stacks}`;
      }

      // Update tooltip text
      const tooltipEl = iconEl.querySelector('.buff-tooltip') as HTMLDivElement;
      if (tooltipEl) {
        tooltipEl.textContent = `${buff.def.name} x${buff.stacks}: ${buff.def.formatValue(buff.stacks)}`;
      }
    }

    // Remove icons for buffs no longer active
    for (const [type, el] of this.iconElements.entries()) {
      if (!activeTypes.has(type)) {
        this.container.removeChild(el);
        this.iconElements.delete(type);
      }
    }
  }

  /**
   * Trigger glow animation on a specific buff icon (called on new stack gain).
   */
  highlightBuff(type: StackBuffType): void {
    const el = this.iconElements.get(type);
    if (!el) return;

    // Remove and re-add class to restart animation
    el.classList.remove('buff-icon-glow');
    // Force reflow
    void el.offsetWidth;
    el.classList.add('buff-icon-glow');

    // Clear glow class after animation completes
    const existingTimer = this.glowTimers.get(type);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      el.classList.remove('buff-icon-glow');
      this.glowTimers.delete(type);
    }, GLOW_DURATION);
    this.glowTimers.set(type, timer);
  }

  /**
   * Enable compact (icon-only) mode for mobile — hides stack count and tooltip text.
   */
  setCompactMode(compact: boolean): void {
    this.compactMode = compact;
    // Re-render existing icons with new mode
    for (const el of this.iconElements.values()) {
      const countEl = el.querySelector('.buff-count') as HTMLSpanElement | null;
      const tooltipEl = el.querySelector('.buff-tooltip') as HTMLDivElement | null;
      if (countEl) countEl.style.display = compact ? 'none' : '';
      if (tooltipEl) tooltipEl.style.display = compact ? 'none' : '';
    }
  }

  /**
   * Set position for splitscreen support.
   */
  setPosition(right: number, top: number): void {
    this.container.style.right = `${right}px`;
    this.container.style.top = `${top}px`;
  }

  dispose(): void {
    for (const timer of this.glowTimers.values()) {
      clearTimeout(timer);
    }
    this.glowTimers.clear();
    this.iconElements.clear();
    this.container.remove();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private createIconElement(def: BuffDefinition): HTMLDivElement {
    const hex = '#' + def.iconColor.toString(16).padStart(6, '0');
    const borderHex = '#' + def.borderColor.toString(16).padStart(6, '0');

    const el = document.createElement('div');
    el.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      color: ${hex};
    `;

    // Icon square
    const iconSquare = document.createElement('div');
    iconSquare.style.cssText = `
      width: ${ICON_SIZE}px;
      height: ${ICON_SIZE}px;
      border: 1px solid ${borderHex};
      border-radius: 3px;
      background: rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: bold;
      color: ${hex};
      text-shadow: 0 0 4px ${hex};
      letter-spacing: 0.5px;
      position: relative;
    `;
    iconSquare.textContent = def.shortName;
    el.appendChild(iconSquare);

    // Stack count
    const countSpan = document.createElement('span');
    countSpan.className = 'buff-count';
    countSpan.style.cssText = `
      font-size: 12px;
      font-weight: bold;
      color: ${hex};
      text-shadow: 0 0 6px ${hex};
      min-width: 24px;
    `;
    countSpan.textContent = 'x1';
    if (this.compactMode) countSpan.style.display = 'none';
    el.appendChild(countSpan);

    // Tooltip (hidden, shown on hover via CSS if needed - currently always visible as compact text)
    const tooltip = document.createElement('div');
    tooltip.className = 'buff-tooltip';
    tooltip.style.cssText = `
      font-size: 9px;
      color: rgba(255,255,255,0.5);
      max-width: 120px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    `;
    tooltip.textContent = def.description;
    if (this.compactMode) tooltip.style.display = 'none';
    el.appendChild(tooltip);

    return el;
  }
}
