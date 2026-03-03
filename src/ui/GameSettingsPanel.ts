/**
 * GameSettingsPanel — reusable HTML overlay for host-configurable game settings.
 *
 * Provides sliders, toggles, and dropdowns for all GameSettings fields.
 * PvP section is conditionally rendered when mode is pvp/pvpve OR pvpEnabled is true.
 * Used in both the MP lobby and the MP pause menu (host only).
 *
 * Pure helper functions are exported separately for unit testing without DOM.
 */

import type {
  GameSettings, GameMode, GameSurface, PvpWinCondition,
  HealthBarVisibility, VisualQuality, StartingWeapon,
} from '../../server/shared/GameSettings';
import {
  DEFAULT_GAME_SETTINGS, VALID_MODES, VALID_SURFACES,
  VALID_STARTING_WEAPONS, PVP_MODES,
} from '../../server/shared/GameSettings';

// ---------------------------------------------------------------------------
// Pure helper functions (exported for unit testing)
// ---------------------------------------------------------------------------

/** Returns true when the PvP section should be visible. */
export function isPvpActive(settings: GameSettings): boolean {
  return settings.pvpEnabled || (PVP_MODES as readonly string[]).includes(settings.mode);
}

/** Human-readable label for the lives slider value. */
export function getLivesLabel(lives: number): string {
  if (lives === 1) return `1 (Hardcore)`;
  if (lives <= 2) return `${lives} (Hard)`;
  if (lives <= 3) return `${lives} (Normal)`;
  if (lives <= 5) return `${lives} (Easy)`;
  return `${lives} (Casual)`;
}

/** Human-readable label for the difficulty multiplier slider. */
export function getDifficultyLabel(multiplier: number): string {
  const x = multiplier.toFixed(2);
  if (multiplier <= 0.6) return `${x}x (Easy)`;
  if (multiplier <= 0.9) return `${x}x (Medium)`;
  if (multiplier <= 1.1) return `${x}x (Normal)`;
  if (multiplier <= 1.5) return `${x}x (Hard)`;
  return `${x}x (Insane)`;
}

/** Human-readable label for the spawn rate multiplier slider. */
export function getSpawnRateLabel(multiplier: number): string {
  const x = multiplier.toFixed(2);
  if (multiplier <= 0.4) return `${x}x (Very Slow)`;
  if (multiplier <= 0.7) return `${x}x (Slow)`;
  if (multiplier <= 1.1) return `${x}x (Normal)`;
  if (multiplier <= 1.8) return `${x}x (Fast)`;
  return `${x}x (Frenzy)`;
}

/** Human-readable label for the time limit slider. */
export function getTimeLimitLabel(seconds: number): string {
  if (seconds === 0) return 'Unlimited';
  if (seconds < 120) return `${seconds}s`;
  return `${Math.round(seconds / 60)} min`;
}

/** Human-readable label for boss frequency. */
export function getBossFreqLabel(value: number): string {
  if (value === 0) return '0.00 (Never)';
  if (value <= 0.25) return `${value.toFixed(2)} (Rare)`;
  if (value <= 0.6) return `${value.toFixed(2)} (Normal)`;
  if (value <= 0.85) return `${value.toFixed(2)} (Frequent)`;
  return `${value.toFixed(2)} (Always)`;
}

// ---------------------------------------------------------------------------
// Minimal DOM interface for testability
// ---------------------------------------------------------------------------

/** Minimal DOM subset used by the panel (allows mock injection in tests). */
export interface PanelDocument {
  createElement(tag: string): HTMLElement;
  getElementById(id: string): HTMLElement | null;
  body: HTMLElement;
}

// ---------------------------------------------------------------------------
// GameSettingsPanel
// ---------------------------------------------------------------------------

export interface GameSettingsPanelOptions {
  /** Callback fired whenever any setting changes. */
  onChange?: (settings: GameSettings) => void;
  /** If false the close button is hidden (e.g. embedded in another panel). */
  showCloseButton?: boolean;
  /** Optional document override for testing. */
  document?: PanelDocument;
}

/** Counter to ensure unique IDs when multiple instances are created. */
let instanceCounter = 0;

export class GameSettingsPanel {
  private readonly id: string;
  private readonly doc: PanelDocument;
  private settings: GameSettings;
  private onChange: ((s: GameSettings) => void) | null;
  private container: HTMLElement | null = null;
  private pvpSection: HTMLElement | null = null;
  private showCloseButton: boolean;

  // Track input elements to sync them when setSettings() is called externally.
  private inputMap = new Map<keyof GameSettings, HTMLElement>();

  constructor(options: GameSettingsPanelOptions = {}) {
    this.id = `gsp-${++instanceCounter}`;
    this.doc = options.document ?? (typeof window !== 'undefined' ? document : null as unknown as PanelDocument);
    this.settings = { ...DEFAULT_GAME_SETTINGS };
    this.onChange = options.onChange ?? null;
    this.showCloseButton = options.showCloseButton ?? true;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Mount the panel into the DOM. Subsequent calls are no-ops. */
  mount(): void {
    if (this.container) return;
    this.container = this.buildDOM();
    this.doc.body.appendChild(this.container);
    this.injectStyles();
    this.updatePvpVisibility();
  }

  show(): void {
    if (!this.container) this.mount();
    this.container!.classList.remove('gsp-hidden');
  }

  hide(): void {
    this.container?.classList.add('gsp-hidden');
  }

  /** Update all controls to reflect the provided settings object. */
  setSettings(s: GameSettings): void {
    this.settings = { ...s };
    this.syncAllInputs();
    this.updatePvpVisibility();
  }

  /** Return the current settings state. */
  getSettings(): GameSettings {
    return { ...this.settings };
  }

  /** True when the PvP section is currently visible. */
  isPvpSectionVisible(): boolean {
    return isPvpActive(this.settings);
  }

  destroy(): void {
    this.container?.remove();
    this.container = null;
    this.inputMap.clear();
  }

  // ---------------------------------------------------------------------------
  // DOM building
  // ---------------------------------------------------------------------------

  private buildDOM(): HTMLElement {
    const panel = this.el('div', `${this.id}`, 'gsp-panel gsp-hidden');

    const content = this.el('div', '', 'gsp-content');
    panel.appendChild(content);

    // Header
    const header = this.el('div', '', 'gsp-header');
    const title = this.el('span', '', 'gsp-title');
    title.textContent = 'GAME SETTINGS';
    header.appendChild(title);

    if (this.showCloseButton) {
      const closeBtn = this.el('button', '', 'gsp-close-btn');
      closeBtn.textContent = '✕ CLOSE';
      closeBtn.addEventListener('click', () => this.hide());
      header.appendChild(closeBtn);
    }
    content.appendChild(header);

    // Scrollable body
    const scroll = this.el('div', '', 'gsp-scroll');
    content.appendChild(scroll);

    scroll.appendChild(this.buildModeSection());
    scroll.appendChild(this.buildLivesSection());
    scroll.appendChild(this.buildDifficultySection());
    scroll.appendChild(this.buildEnemiesSection());
    scroll.appendChild(this.buildPickupsSection());
    scroll.appendChild(this.buildTimeSection());
    scroll.appendChild(this.buildHealthBarsSection());

    // PvP section (conditionally visible)
    const pvpSection = this.buildPvpSection();
    this.pvpSection = pvpSection;
    scroll.appendChild(pvpSection);

    // Reset button
    const footer = this.el('div', '', 'gsp-footer');
    const resetBtn = this.el('button', '', 'gsp-reset-btn');
    resetBtn.textContent = 'RESET TO DEFAULTS';
    resetBtn.addEventListener('click', () => this.resetToDefaults());
    footer.appendChild(resetBtn);
    scroll.appendChild(footer);

    return panel;
  }

  private buildModeSection(): HTMLElement {
    const section = this.section('GAME MODE');

    section.appendChild(this.buildButtonGroup<GameMode>(
      'mode', 'Mode',
      VALID_MODES as unknown as GameMode[],
      (v) => v.toUpperCase(),
    ));

    section.appendChild(this.buildButtonGroup<GameSurface>(
      'surface', 'Surface',
      VALID_SURFACES as unknown as GameSurface[],
      (v) => v.replace(/-/g, ' ').toUpperCase(),
    ));

    section.appendChild(this.buildButtonGroup<StartingWeapon>(
      'startingWeapon', 'Starting Weapon',
      VALID_STARTING_WEAPONS as unknown as StartingWeapon[],
      (v) => v.replace(/_/g, ' ').toUpperCase(),
    ));

    section.appendChild(this.buildButtonGroup<VisualQuality>(
      'visualQuality', 'Visual Quality',
      ['auto', 'high', 'medium', 'low'] as VisualQuality[],
      (v) => v.toUpperCase(),
    ));

    return section;
  }

  private buildLivesSection(): HTMLElement {
    const section = this.section('LIVES');
    section.appendChild(this.buildSlider('lives', 'Lives', 1, 9, 1, getLivesLabel));
    section.appendChild(this.buildToggle('infiniteLives', 'Infinite Lives'));
    return section;
  }

  private buildDifficultySection(): HTMLElement {
    const section = this.section('DIFFICULTY');
    section.appendChild(this.buildSlider('difficultyMultiplier', 'Difficulty', 0.5, 2.0, 0.05, getDifficultyLabel));
    section.appendChild(this.buildSlider('enemySpawnRateMultiplier', 'Spawn Rate', 0.25, 3.0, 0.05, getSpawnRateLabel));
    section.appendChild(this.buildSlider('bossFrequency', 'Boss Frequency', 0.0, 1.0, 0.05, getBossFreqLabel));
    return section;
  }

  private buildEnemiesSection(): HTMLElement {
    const section = this.section('ENEMIES & BULLETS');
    section.appendChild(this.buildSlider('enemyCountCap', 'Max Enemies', 10, 100, 5, (v) => String(v)));
    section.appendChild(this.buildSlider('bulletCountCap', 'Max Bullets', 50, 1000, 50, (v) => String(v)));
    return section;
  }

  private buildPickupsSection(): HTMLElement {
    const section = this.section('PICKUPS & HEALING');
    section.appendChild(this.buildSlider('healingFrequency', 'Healing Frequency (s)', 5, 120, 5, (v) => `${v}s`));
    section.appendChild(this.buildSlider('healingAmount', 'Healing Amount (HP)', 5, 100, 5, (v) => String(v)));
    section.appendChild(this.buildSlider('weaponSpawnFrequency', 'Weapon Pickup Rate', 0.1, 3.0, 0.1, (v) => `${v.toFixed(1)}x`));
    section.appendChild(this.buildSlider('buffSpawnFrequency', 'Buff Pickup Rate', 0.1, 3.0, 0.1, (v) => `${v.toFixed(1)}x`));
    return section;
  }

  private buildTimeSection(): HTMLElement {
    const section = this.section('TIME LIMIT');
    section.appendChild(this.buildSlider('timeLimit', 'Time Limit', 0, 3600, 60, getTimeLimitLabel));
    return section;
  }

  private buildHealthBarsSection(): HTMLElement {
    const section = this.section('HEALTH BARS');
    section.appendChild(this.buildButtonGroup<HealthBarVisibility>(
      'healthBarVisibility', 'Visibility',
      ['all', 'friendly', 'enemy', 'none'] as HealthBarVisibility[],
      (v) => v.toUpperCase(),
    ));
    return section;
  }

  private buildPvpSection(): HTMLElement {
    const section = this.section('PvP SETTINGS');
    section.appendChild(this.buildToggle('pvpEnabled', 'PvP Damage'));
    section.appendChild(this.buildToggle('friendlyFire', 'Friendly Fire'));
    section.appendChild(this.buildButtonGroup<PvpWinCondition>(
      'pvpWinCondition', 'Win Condition',
      ['kills', 'survival', 'score'] as PvpWinCondition[],
      (v) => v.toUpperCase(),
    ));
    return section;
  }

  // ---------------------------------------------------------------------------
  // Control builders
  // ---------------------------------------------------------------------------

  private buildSlider<K extends keyof GameSettings>(
    field: K,
    label: string,
    min: number,
    max: number,
    step: number,
    formatLabel: (v: number) => string,
  ): HTMLElement {
    const row = this.el('div', '', 'gsp-row');

    const labelEl = this.el('label', '', 'gsp-label');
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const controlWrap = this.el('div', '', 'gsp-control');

    const preview = this.el('span', '', 'gsp-preview');
    const currentVal = this.settings[field] as number;
    preview.textContent = formatLabel(currentVal);

    const input = this.el('input', '', 'gsp-slider') as HTMLInputElement;
    input.setAttribute('type', 'range');
    input.setAttribute('min', String(min));
    input.setAttribute('max', String(max));
    input.setAttribute('step', String(step));
    input.setAttribute('value', String(currentVal));

    input.addEventListener('input', () => {
      const v = parseFloat((input as HTMLInputElement).value);
      preview.textContent = formatLabel(v);
      this.applyChange(field, v as GameSettings[K]);
    });

    controlWrap.appendChild(input);
    controlWrap.appendChild(preview);
    row.appendChild(controlWrap);

    this.inputMap.set(field, input);
    return row;
  }

  private buildToggle<K extends keyof GameSettings>(
    field: K,
    label: string,
  ): HTMLElement {
    const row = this.el('div', '', 'gsp-row');

    const labelEl = this.el('label', '', 'gsp-label');
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const wrap = this.el('div', '', 'gsp-control');

    const toggle = this.el('button', '', 'gsp-toggle');
    const currentVal = Boolean(this.settings[field]);
    toggle.textContent = currentVal ? 'ON' : 'OFF';
    toggle.classList.add(currentVal ? 'gsp-toggle-on' : 'gsp-toggle-off');

    toggle.addEventListener('click', () => {
      const newVal = !(this.settings[field] as boolean);
      toggle.textContent = newVal ? 'ON' : 'OFF';
      toggle.classList.toggle('gsp-toggle-on', newVal);
      toggle.classList.toggle('gsp-toggle-off', !newVal);
      this.applyChange(field, newVal as GameSettings[K]);
    });

    wrap.appendChild(toggle);
    row.appendChild(wrap);

    this.inputMap.set(field, toggle);
    return row;
  }

  private buildButtonGroup<T extends string>(
    field: keyof GameSettings,
    label: string,
    options: T[],
    formatLabel: (v: T) => string,
  ): HTMLElement {
    const row = this.el('div', '', 'gsp-row gsp-row-buttons');

    const labelEl = this.el('label', '', 'gsp-label');
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const btnGroup = this.el('div', '', 'gsp-btn-group');
    const currentVal = String(this.settings[field]);

    for (const opt of options) {
      const btn = this.el('button', '', 'gsp-option-btn');
      btn.textContent = formatLabel(opt);
      if (opt === currentVal) btn.classList.add('gsp-option-active');

      btn.addEventListener('click', () => {
        // Deactivate all siblings
        const siblings = btnGroup.querySelectorAll('.gsp-option-btn');
        for (const s of Array.from(siblings)) {
          s.classList.remove('gsp-option-active');
        }
        btn.classList.add('gsp-option-active');
        this.applyChange(field, opt as unknown as GameSettings[typeof field]);
      });

      btnGroup.appendChild(btn);
    }

    row.appendChild(btnGroup);
    this.inputMap.set(field, btnGroup);
    return row;
  }

  // ---------------------------------------------------------------------------
  // State management
  // ---------------------------------------------------------------------------

  private applyChange<K extends keyof GameSettings>(field: K, value: GameSettings[K]): void {
    this.settings = { ...this.settings, [field]: value };

    // If mode changed and is now PvP, ensure pvpEnabled defaults to true for clarity
    if (field === 'mode' && (PVP_MODES as readonly string[]).includes(value as string)) {
      if (!this.settings.pvpEnabled) {
        this.settings = { ...this.settings, pvpEnabled: true };
        this.syncToggle('pvpEnabled', true);
      }
    }

    this.updatePvpVisibility();
    this.onChange?.(this.getSettings());
  }

  private resetToDefaults(): void {
    this.settings = { ...DEFAULT_GAME_SETTINGS };
    this.syncAllInputs();
    this.updatePvpVisibility();
    this.onChange?.(this.getSettings());
  }

  private updatePvpVisibility(): void {
    if (!this.pvpSection) return;
    const visible = isPvpActive(this.settings);
    this.pvpSection.classList.toggle('gsp-hidden', !visible);
  }

  private syncAllInputs(): void {
    for (const [field, el] of this.inputMap) {
      const value = this.settings[field];
      if (el.tagName === 'INPUT') {
        (el as HTMLInputElement).value = String(value);
        // Update preview text (sibling span)
        const preview = el.parentElement?.querySelector('.gsp-preview');
        if (preview) {
          // Re-compute preview from the formatter embedded in the input's data
          const min = parseFloat(el.getAttribute('min') ?? '0');
          const max = parseFloat(el.getAttribute('max') ?? '100');
          preview.textContent = formatSliderPreview(field, value as number, min, max);
        }
      } else if (el.tagName === 'BUTTON') {
        // Toggle button
        const boolVal = Boolean(value);
        el.textContent = boolVal ? 'ON' : 'OFF';
        el.classList.toggle('gsp-toggle-on', boolVal);
        el.classList.toggle('gsp-toggle-off', !boolVal);
      } else if (el.classList.contains('gsp-btn-group')) {
        // Button group — update active state
        const btns = el.querySelectorAll('.gsp-option-btn');
        for (const btn of Array.from(btns)) {
          const active = btn.textContent === formatOptionLabel(field, String(value));
          btn.classList.toggle('gsp-option-active', active);
        }
      }
    }
  }

  private syncToggle(field: keyof GameSettings, value: boolean): void {
    const el = this.inputMap.get(field);
    if (!el) return;
    el.textContent = value ? 'ON' : 'OFF';
    el.classList.toggle('gsp-toggle-on', value);
    el.classList.toggle('gsp-toggle-off', !value);
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  private el(tag: string, id: string, className: string): HTMLElement {
    const el = this.doc.createElement(tag);
    if (id) el.id = id;
    if (className) {
      for (const cls of className.split(' ')) {
        if (cls) el.classList.add(cls);
      }
    }
    return el;
  }

  private section(title: string): HTMLElement {
    const section = this.el('section', '', 'gsp-section');
    const h2 = this.el('h2', '', 'gsp-section-title');
    h2.textContent = title;
    section.appendChild(h2);
    return section;
  }

  private injectStyles(): void {
    // Only inject once per document
    const existingId = 'gsp-styles';
    if (this.doc.getElementById(existingId)) return;

    const style = this.doc.createElement('style');
    style.id = existingId;
    style.textContent = GSP_CSS;
    this.doc.body.appendChild(style);
  }
}

// ---------------------------------------------------------------------------
// Re-format helpers used by syncAllInputs (avoids closure capture)
// ---------------------------------------------------------------------------

function formatSliderPreview(field: keyof GameSettings, value: number, _min: number, _max: number): string {
  switch (field) {
    case 'lives':               return getLivesLabel(value);
    case 'difficultyMultiplier': return getDifficultyLabel(value);
    case 'enemySpawnRateMultiplier': return getSpawnRateLabel(value);
    case 'bossFrequency':       return getBossFreqLabel(value);
    case 'timeLimit':           return getTimeLimitLabel(value);
    case 'healingFrequency':    return `${value}s`;
    case 'healingAmount':       return String(value);
    case 'weaponSpawnFrequency': return `${value.toFixed(1)}x`;
    case 'buffSpawnFrequency':  return `${value.toFixed(1)}x`;
    case 'enemyCountCap':       return String(value);
    case 'bulletCountCap':      return String(value);
    default:                    return String(value);
  }
}

function formatOptionLabel(field: keyof GameSettings, rawValue: string): string {
  switch (field) {
    case 'mode':
    case 'pvpWinCondition':
    case 'healthBarVisibility':
    case 'visualQuality':       return rawValue.toUpperCase();
    case 'surface':             return rawValue.replace(/-/g, ' ').toUpperCase();
    case 'startingWeapon':      return rawValue.replace(/_/g, ' ').toUpperCase();
    default:                    return rawValue.toUpperCase();
  }
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const GSP_CSS = `
  .gsp-panel {
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: rgba(0, 0, 20, 0.90);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 20px 0;
    z-index: 4000;
    font-family: 'Segoe UI', Arial, sans-serif;
    backdrop-filter: blur(4px);
    box-sizing: border-box;
    overflow-y: auto;
  }
  .gsp-panel.gsp-hidden { display: none !important; }

  .gsp-content {
    background: rgba(8, 4, 24, 0.97);
    border: 1px solid rgba(0, 255, 255, 0.25);
    border-radius: 8px;
    width: 90%;
    max-width: 680px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 0 60px rgba(0, 0, 0, 0.8), 0 0 20px rgba(0, 255, 255, 0.05);
    overflow: hidden;
  }

  /* Header */
  .gsp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 22px;
    border-bottom: 1px solid rgba(0, 255, 255, 0.15);
    flex-shrink: 0;
  }
  .gsp-title {
    color: #00ffff;
    font-size: 20px;
    font-weight: bold;
    letter-spacing: 6px;
    text-shadow: 0 0 12px #00ffff;
  }
  .gsp-close-btn {
    background: none;
    border: 1px solid #884400;
    color: #ff8800;
    padding: 7px 18px;
    font-size: 12px;
    cursor: pointer;
    letter-spacing: 2px;
    transition: all 0.2s;
    font-family: inherit;
  }
  .gsp-close-btn:hover {
    background: rgba(120, 60, 0, 0.5);
    box-shadow: 0 0 12px #ff8800;
  }

  /* Scrollable body */
  .gsp-scroll {
    overflow-y: auto;
    flex: 1;
    padding: 10px 0 20px;
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 255, 255, 0.3) transparent;
  }
  .gsp-scroll::-webkit-scrollbar { width: 5px; }
  .gsp-scroll::-webkit-scrollbar-thumb { background: rgba(0, 255, 255, 0.3); border-radius: 3px; }

  /* Sections */
  .gsp-section {
    padding: 12px 22px 8px;
    border-bottom: 1px solid rgba(0, 255, 255, 0.07);
  }
  .gsp-section.gsp-hidden { display: none !important; }
  .gsp-section-title {
    color: #668899;
    font-size: 11px;
    letter-spacing: 4px;
    margin: 0 0 10px;
    text-transform: uppercase;
  }

  /* Rows */
  .gsp-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 38px;
    margin-bottom: 6px;
  }
  .gsp-row-buttons {
    flex-wrap: wrap;
    align-items: flex-start;
    min-height: auto;
  }
  .gsp-label {
    color: #aabbcc;
    font-size: 13px;
    letter-spacing: 1px;
    min-width: 160px;
    flex-shrink: 0;
  }
  .gsp-control {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
  }

  /* Sliders */
  .gsp-slider {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    height: 4px;
    background: rgba(0, 255, 255, 0.15);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
    min-width: 120px;
  }
  .gsp-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #00ffff;
    box-shadow: 0 0 8px #00ffff;
    cursor: pointer;
  }
  .gsp-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #00ffff;
    box-shadow: 0 0 8px #00ffff;
    cursor: pointer;
    border: none;
  }
  .gsp-preview {
    color: #00ff88;
    font-size: 12px;
    min-width: 120px;
    letter-spacing: 1px;
    text-shadow: 0 0 6px #00ff88;
  }

  /* Toggle buttons */
  .gsp-toggle {
    padding: 6px 20px;
    font-size: 12px;
    letter-spacing: 3px;
    cursor: pointer;
    font-family: inherit;
    border-radius: 3px;
    transition: all 0.15s;
    font-weight: bold;
  }
  .gsp-toggle-on {
    background: rgba(0, 255, 136, 0.15);
    border: 1px solid rgba(0, 255, 136, 0.5);
    color: #00ff88;
    box-shadow: 0 0 8px rgba(0, 255, 136, 0.2);
  }
  .gsp-toggle-off {
    background: rgba(80, 0, 0, 0.2);
    border: 1px solid rgba(180, 0, 0, 0.4);
    color: #cc4444;
  }

  /* Button groups */
  .gsp-btn-group {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    flex: 1;
  }
  .gsp-option-btn {
    padding: 5px 12px;
    font-size: 11px;
    letter-spacing: 1px;
    cursor: pointer;
    font-family: inherit;
    background: rgba(0, 40, 50, 0.4);
    border: 1px solid rgba(0, 255, 255, 0.15);
    color: #668899;
    border-radius: 3px;
    transition: all 0.15s;
  }
  .gsp-option-btn:hover {
    background: rgba(0, 255, 255, 0.08);
    color: #aadddd;
  }
  .gsp-option-btn.gsp-option-active {
    background: rgba(0, 255, 255, 0.15);
    border-color: rgba(0, 255, 255, 0.5);
    color: #00ffff;
    text-shadow: 0 0 6px #00ffff;
  }

  /* Footer */
  .gsp-footer {
    padding: 16px 22px;
    display: flex;
    justify-content: center;
  }
  .gsp-reset-btn {
    padding: 10px 30px;
    font-size: 12px;
    letter-spacing: 3px;
    cursor: pointer;
    font-family: inherit;
    background: rgba(80, 0, 80, 0.3);
    border: 1px solid rgba(200, 0, 200, 0.4);
    color: #cc88ff;
    border-radius: 3px;
    transition: all 0.2s;
    font-weight: bold;
  }
  .gsp-reset-btn:hover {
    background: rgba(160, 0, 160, 0.4);
    box-shadow: 0 0 15px rgba(200, 0, 200, 0.3);
    color: #ff88ff;
  }

  /* Responsive: stack label above control on narrow screens */
  @media (max-width: 500px) {
    .gsp-row { flex-direction: column; align-items: flex-start; gap: 6px; }
    .gsp-label { min-width: unset; }
    .gsp-control { width: 100%; }
    .gsp-btn-group { width: 100%; }
  }
`;
