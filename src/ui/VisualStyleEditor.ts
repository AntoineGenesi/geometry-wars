/**
 * Visual Style Editor
 *
 * Overlay panel for customizing a visual preset's parameters with real-time preview.
 * Custom styles are persisted to localStorage under 'gw3d-custom-styles'.
 */

import type { VisualPreset } from './VisualPlayground';

const CUSTOM_STYLES_KEY = 'gw3d-custom-styles';
const DEPTH_CURVE_OPTIONS = ['steep', 'moderate', 'gentle', 'extreme', 'none'];

/** Valid editable fields on VisualPreset. */
const EDITABLE_FIELDS = new Set([
  'gridColor', 'surfaceColor', 'surfaceOpacity', 'gridOpacity',
  'wireframeOnly', 'bloomStrength', 'bloomRadius', 'bloomThreshold',
  'gridSegmentsU', 'gridSegmentsV', 'depthCurve',
]);

export interface CustomStyle {
  preset: VisualPreset;
  savedAt: string;
}

export function loadCustomStyles(): CustomStyle[] {
  try {
    const raw = localStorage.getItem(CUSTOM_STYLES_KEY);
    return raw ? (JSON.parse(raw) as CustomStyle[]) : [];
  } catch { return []; }
}

export function saveCustomStyles(styles: CustomStyle[]): void {
  try { localStorage.setItem(CUSTOM_STYLES_KEY, JSON.stringify(styles)); }
  catch { /* localStorage unavailable */ }
}

export function deleteCustomStyle(name: string): CustomStyle[] {
  const styles = loadCustomStyles().filter((s) => s.preset.name !== name);
  saveCustomStyles(styles);
  return styles;
}

export class VisualStyleEditor {
  private overlay: HTMLDivElement;
  private styleEl: HTMLStyleElement;
  private original: VisualPreset;
  private working: VisualPreset;
  private changeCb: ((p: VisualPreset) => void) | null = null;
  private closeCb: (() => void) | null = null;
  private saveCb: ((p: VisualPreset) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(preset: VisualPreset) {
    this.original = { ...preset };
    this.working = { ...preset };
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = EDITOR_CSS;
    document.head.appendChild(this.styleEl);
    this.overlay = document.createElement('div');
    this.overlay.className = 'vse-overlay';
    this.overlay.innerHTML = this.buildHTML();
    document.body.appendChild(this.overlay);
    this.attachEvents();
  }

  onChange(cb: (p: VisualPreset) => void): void { this.changeCb = cb; }
  onClose(cb: () => void): void { this.closeCb = cb; }
  onSave(cb: (p: VisualPreset) => void): void { this.saveCb = cb; }
  getPreset(): VisualPreset { return { ...this.working }; }

  dispose(): void {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.overlay.remove();
    this.styleEl.remove();
  }

  private buildHTML(): string {
    const p = this.working;
    const esc = escapeHtml;
    return `
      <div class="vse-panel">
        <div class="vse-header">
          <h2 class="vse-title">EDIT STYLE</h2>
          <span class="vse-preset-name">${esc(p.name)}</span>
          <button class="vse-close-btn">CLOSE</button>
        </div>
        <div class="vse-body">
          ${colorRow('gridColor', 'Grid Color', p.gridColor)}
          ${colorRow('surfaceColor', 'Surface Color', p.surfaceColor)}
          ${sliderRow('surfaceOpacity', 'Surface Opacity', p.surfaceOpacity, 0, 1, 0.01)}
          ${sliderRow('gridOpacity', 'Grid Opacity', p.gridOpacity, 0, 1, 0.01)}
          ${toggleRow('wireframeOnly', 'Wireframe Only', p.wireframeOnly)}
          ${sliderRow('bloomStrength', 'Bloom Strength', p.bloomStrength, 0, 3, 0.05)}
          ${sliderRow('bloomRadius', 'Bloom Radius', p.bloomRadius ?? 0.4, 0, 1.5, 0.05)}
          ${sliderRow('bloomThreshold', 'Bloom Threshold', p.bloomThreshold ?? 0.85, 0, 1, 0.01)}
          ${sliderRow('gridSegmentsU', 'Grid Segments U', p.gridSegmentsU, 4, 64, 1)}
          ${sliderRow('gridSegmentsV', 'Grid Segments V', p.gridSegmentsV, 4, 48, 1)}
          ${dropdownRow('depthCurve', 'Depth Curve', p.depthCurve, DEPTH_CURVE_OPTIONS)}
        </div>
        <div class="vse-footer">
          <button class="vse-btn vse-revert-btn">REVERT</button>
          <button class="vse-btn vse-save-btn">SAVE AS CUSTOM</button>
        </div>
      </div>`;
  }

  private attachEvents(): void {
    const ov = this.overlay;
    ov.querySelector('.vse-close-btn')?.addEventListener('click', () => {
      this.dispose();
      this.closeCb?.();
    });

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.dispose(); this.closeCb?.(); }
    };
    window.addEventListener('keydown', this.keyHandler, true);

    ov.querySelectorAll('.vse-slider').forEach((s) => {
      s.addEventListener('input', () => {
        const input = s as HTMLInputElement;
        const field = input.dataset.field ?? '';
        const val = parseFloat(input.value);
        this.setField(field, val);
        const valEl = ov.querySelector(`[data-value-for="${field}"]`);
        if (valEl) {
          const step = parseFloat(input.step);
          valEl.textContent = Number.isInteger(step) ? String(val) : val.toFixed(2);
        }
      });
    });

    ov.querySelectorAll('.vse-color-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const el = inp as HTMLInputElement;
        const field = el.dataset.field ?? '';
        const hex = el.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
          this.setField(field, parseInt(hex.slice(1), 16));
          const sw = el.closest('.vse-row')?.querySelector('.vse-color-swatch') as HTMLElement;
          if (sw) sw.style.background = hex;
        }
      });
    });

    ov.querySelectorAll('.vse-toggle').forEach((t) => {
      t.addEventListener('click', () => {
        const el = t as HTMLElement;
        this.setField(el.dataset.field ?? '', el.classList.toggle('on'));
      });
    });

    ov.querySelectorAll('.vse-select').forEach((s) => {
      s.addEventListener('change', () => {
        const el = s as HTMLSelectElement;
        this.setField(el.dataset.field ?? '', el.value);
      });
    });

    ov.querySelector('.vse-revert-btn')?.addEventListener('click', () => {
      this.working = { ...this.original };
      this.refreshUI();
      this.changeCb?.({ ...this.working });
    });

    ov.querySelector('.vse-save-btn')?.addEventListener('click', () => this.saveAsCustom());
  }

  private setField(field: string, value: number | boolean | string): void {
    if (!EDITABLE_FIELDS.has(field)) return;
    this.working = { ...this.working, [field]: value };
    this.changeCb?.({ ...this.working });
  }

  private getFieldValue(field: string): number | boolean | string | undefined {
    const p = this.working;
    if (field === 'bloomRadius') return p.bloomRadius ?? 0.4;
    if (field === 'bloomThreshold') return p.bloomThreshold ?? 0.85;
    return EDITABLE_FIELDS.has(field) ? (p as unknown as Record<string, unknown>)[field] as number | boolean | string : undefined;
  }

  private saveAsCustom(): void {
    const baseName = this.original.name;
    const customs = loadCustomStyles();
    let name = `${baseName} (Custom)`;
    let counter = 2;
    while (customs.some((c) => c.preset.name === name)) {
      name = `${baseName} (Custom ${counter++})`;
    }
    const customPreset: VisualPreset = { ...this.working, name, description: `Custom style based on ${baseName}` };
    customs.push({ preset: customPreset, savedAt: new Date().toISOString() });
    saveCustomStyles(customs);
    this.saveCb?.(customPreset);

    const btn = this.overlay.querySelector('.vse-save-btn') as HTMLElement;
    if (btn) {
      btn.textContent = 'SAVED!';
      btn.style.borderColor = '#44ff88';
      setTimeout(() => { btn.textContent = 'SAVE AS CUSTOM'; btn.style.borderColor = '#00aa66'; }, 1500);
    }
  }

  private refreshUI(): void {
    this.overlay.querySelectorAll('.vse-slider').forEach((s) => {
      const input = s as HTMLInputElement;
      const val = this.getFieldValue(input.dataset.field ?? '');
      if (typeof val === 'number') {
        input.value = String(val);
        const vEl = this.overlay.querySelector(`[data-value-for="${input.dataset.field}"]`);
        if (vEl) {
          const step = parseFloat(input.step);
          vEl.textContent = Number.isInteger(step) ? String(val) : val.toFixed(2);
        }
      }
    });
    this.overlay.querySelectorAll('.vse-color-input').forEach((inp) => {
      const el = inp as HTMLInputElement;
      const val = this.getFieldValue(el.dataset.field ?? '');
      if (typeof val === 'number') {
        const hex = '#' + val.toString(16).padStart(6, '0');
        el.value = hex;
        const sw = el.closest('.vse-row')?.querySelector('.vse-color-swatch') as HTMLElement;
        if (sw) sw.style.background = hex;
      }
    });
    this.overlay.querySelectorAll('.vse-toggle').forEach((t) => {
      const el = t as HTMLElement;
      const val = this.getFieldValue(el.dataset.field ?? '');
      if (typeof val === 'boolean') el.classList.toggle('on', val);
    });
    this.overlay.querySelectorAll('.vse-select').forEach((s) => {
      const el = s as HTMLSelectElement;
      const val = this.getFieldValue(el.dataset.field ?? '');
      if (typeof val === 'string') el.value = val;
    });
  }
}

// ---------------------------------------------------------------------------
// HTML row builders (pure functions, no instance needed)
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function colorRow(field: string, label: string, value: number): string {
  const hex = '#' + value.toString(16).padStart(6, '0');
  return `<div class="vse-row" data-field="${field}">
    <span class="vse-label">${label}</span>
    <div class="vse-color-group">
      <div class="vse-color-swatch" style="background:${hex}"></div>
      <input type="text" class="vse-color-input" value="${hex}" maxlength="7" data-field="${field}" />
    </div></div>`;
}

function sliderRow(field: string, label: string, value: number, min: number, max: number, step: number): string {
  const display = Number.isInteger(step) ? String(value) : value.toFixed(2);
  return `<div class="vse-row" data-field="${field}">
    <span class="vse-label">${label}</span>
    <input type="range" class="vse-slider" data-field="${field}" min="${min}" max="${max}" step="${step}" value="${value}" />
    <span class="vse-value" data-value-for="${field}">${display}</span></div>`;
}

function toggleRow(field: string, label: string, value: boolean): string {
  return `<div class="vse-row" data-field="${field}">
    <span class="vse-label">${label}</span>
    <div class="vse-toggle ${value ? 'on' : ''}" data-field="${field}"></div></div>`;
}

function dropdownRow(field: string, label: string, value: string, options: string[]): string {
  const opts = options.map((o) => `<option value="${o}" ${o === value ? 'selected' : ''}>${o.toUpperCase()}</option>`).join('');
  return `<div class="vse-row" data-field="${field}">
    <span class="vse-label">${label}</span>
    <select class="vse-select" data-field="${field}">${opts}</select></div>`;
}

// ---------------------------------------------------------------------------
// Styles (extracted as constant to keep class small)
// ---------------------------------------------------------------------------

const EDITOR_CSS = `
.vse-overlay {
  position:fixed; top:0; left:0; width:100%; height:100%;
  background:rgba(0,0,10,0.7); z-index:2500;
  display:flex; justify-content:center; align-items:center;
  font-family:'Segoe UI',monospace; backdrop-filter:blur(3px);
}
.vse-panel {
  background:rgba(8,4,24,0.95); border:1px solid rgba(0,255,255,0.25);
  border-radius:8px; max-width:480px; width:90%; max-height:85vh;
  display:flex; flex-direction:column; box-shadow:0 0 40px rgba(0,0,0,0.6);
}
.vse-header {
  display:flex; align-items:center; gap:12px; padding:14px 20px;
  border-bottom:1px solid rgba(0,255,255,0.1);
}
.vse-title { color:#00ffff; font-size:16px; letter-spacing:4px; margin:0; text-shadow:0 0 10px #00ffff; }
.vse-preset-name { color:#88aaaa; font-size:13px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.vse-close-btn {
  background:rgba(80,30,0,0.5); border:1px solid #884400; color:#ff8800;
  padding:6px 16px; font:bold 11px monospace; letter-spacing:2px; cursor:pointer; transition:all 0.2s; flex-shrink:0;
}
.vse-close-btn:hover { background:rgba(120,50,0,0.6); box-shadow:0 0 12px #ff8800; }
.vse-body { padding:16px 20px; overflow-y:auto; flex:1; }
.vse-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; gap:10px; }
.vse-label { color:#ccccff; font-size:12px; letter-spacing:1px; min-width:120px; flex-shrink:0; }
.vse-value { color:#00ffff; font-size:12px; font-family:monospace; min-width:50px; text-align:right; flex-shrink:0; }
.vse-slider {
  -webkit-appearance:none; appearance:none; flex:1; height:6px;
  background:rgba(0,100,100,0.3); border-radius:3px; outline:none; min-width:80px;
}
.vse-slider::-webkit-slider-thumb {
  -webkit-appearance:none; width:14px; height:14px; background:#00ffff;
  border-radius:50%; cursor:pointer; box-shadow:0 0 6px #00ffff;
}
.vse-color-group { display:flex; align-items:center; gap:8px; }
.vse-color-swatch { width:24px; height:24px; border:1px solid rgba(255,255,255,0.3); border-radius:3px; flex-shrink:0; }
.vse-color-input {
  background:rgba(0,40,40,0.6); border:1px solid #006666; color:#00ffff;
  padding:4px 8px; font:12px monospace; width:80px; outline:none;
}
.vse-color-input:focus { border-color:#00ffff; box-shadow:0 0 6px rgba(0,255,255,0.3); }
.vse-toggle {
  position:relative; width:40px; height:20px; background:rgba(80,40,40,0.5);
  border:1px solid #664444; border-radius:10px; cursor:pointer; transition:all 0.3s; flex-shrink:0;
}
.vse-toggle.on { background:rgba(0,100,80,0.5); border-color:#00ff88; }
.vse-toggle::after {
  content:''; position:absolute; top:2px; left:2px; width:14px; height:14px;
  background:#888; border-radius:50%; transition:all 0.3s;
}
.vse-toggle.on::after { left:22px; background:#00ff88; box-shadow:0 0 6px #00ff88; }
.vse-select {
  background:rgba(0,40,40,0.6); border:1px solid #006666; color:#00ffff;
  padding:4px 8px; font:12px monospace; cursor:pointer; outline:none;
}
.vse-select:focus { border-color:#00ffff; box-shadow:0 0 6px rgba(0,255,255,0.3); }
.vse-footer {
  display:flex; justify-content:space-between; padding:14px 20px;
  border-top:1px solid rgba(0,255,255,0.1); gap:12px;
}
.vse-btn { padding:8px 20px; font:bold 11px monospace; letter-spacing:2px; cursor:pointer; transition:all 0.2s; border-radius:2px; }
.vse-revert-btn { background:rgba(80,40,40,0.5); border:1px solid #886644; color:#ffaa66; }
.vse-revert-btn:hover { background:rgba(100,50,30,0.6); box-shadow:0 0 10px #ffaa66; }
.vse-save-btn { background:rgba(0,80,60,0.6); border:1px solid #00aa66; color:#00ff88; }
.vse-save-btn:hover { background:rgba(0,120,80,0.7); box-shadow:0 0 10px #00ff88; }
`;
