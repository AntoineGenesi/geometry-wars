/**
 * Settings menu overlay with 4 tabs:
 *   - GPU Info: hardware detection, feature support, benchmark
 *   - Graphics: quality presets, bloom, particles, trails, resolution
 *   - Performance: live FPS, draw calls, entity count, memory
 *   - Audio: master/SFX/music volume, music preset
 *
 * Accessible from StartMenu and PauseMenu.
 * Settings persist to localStorage.
 */

import type { GPUCapabilityReport } from '../rendering/GPUCapabilities';
import { detectGPUCapabilities } from '../rendering/GPUCapabilities';
import type { RendererBackend } from '../rendering/RendererFactory';
import { QualityLevel, QUALITY_LEVELS } from '../rendering/AdaptiveQuality';
import type { MusicPreset } from '../audio/BackgroundMusic';
import type { BenchmarkResult } from './GPUBenchmark';
import { loadDDASettings, saveDDASettings, type DDASettingsData } from '../difficulty/DDASettings';
import { getActiveStyleName, getActiveStyleIndex, clearVisualStyle, saveVisualStyle } from './VisualStyleSettings';
import { VISUAL_PRESETS } from './VisualPlayground';
import { loadCustomStyles } from './VisualStyleEditor';
import { isMobile } from '../core/MobileDetector';

// ---------------------------------------------------------------------------
// Exported settings interfaces
// ---------------------------------------------------------------------------

export interface GraphicsSettings {
  qualityPreset: 'ultra' | 'high' | 'medium' | 'low' | 'minimal' | 'custom';
  bloomEnabled: boolean;
  bloomStrength: number;
  particleCount: number;
  trailEffects: boolean;
  maxEnemies: number;
  resolutionScale: number;
}

export interface AudioSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  musicPreset: MusicPreset;
}

export interface DebugSettings {
  showDebugStatistics: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const GRAPHICS_STORAGE_KEY = 'gw3d-graphics-settings';
const AUDIO_STORAGE_KEY = 'gw3d-audio-settings';
const DEBUG_STORAGE_KEY = 'gw3d-debug-settings';

const DEFAULT_GRAPHICS: GraphicsSettings = {
  qualityPreset: 'high',
  bloomEnabled: true,
  bloomStrength: 1.0,
  particleCount: 2000,
  trailEffects: true,
  maxEnemies: 500,
  resolutionScale: 1.0,
};

const DEFAULT_AUDIO: AudioSettings = {
  masterVolume: 70,
  sfxVolume: 80,
  musicVolume: 50,
  musicPreset: 'electronic',
};

const DEFAULT_DEBUG: DebugSettings = {
  showDebugStatistics: !isMobile() && process.env.NODE_ENV !== 'production',
};

/** Quality preset values (maps preset name to concrete graphics values). */
const QUALITY_PRESET_VALUES: Record<string, Omit<GraphicsSettings, 'qualityPreset'>> = {
  ultra: {
    bloomEnabled: true,
    bloomStrength: 2.0,
    particleCount: 5000,
    trailEffects: true,
    maxEnemies: 5000,
    resolutionScale: 1.0,
  },
  high: {
    bloomEnabled: true,
    bloomStrength: 1.0,
    particleCount: 2000,
    trailEffects: true,
    maxEnemies: 500,
    resolutionScale: 1.0,
  },
  medium: {
    bloomEnabled: true,
    bloomStrength: 0.5,
    particleCount: 1000,
    trailEffects: true,
    maxEnemies: 200,
    resolutionScale: 0.75,
  },
  low: {
    bloomEnabled: false,
    bloomStrength: 0,
    particleCount: 500,
    trailEffects: false,
    maxEnemies: 100,
    resolutionScale: 0.5,
  },
  minimal: {
    bloomEnabled: false,
    bloomStrength: 0,
    particleCount: 100,
    trailEffects: false,
    maxEnemies: 50,
    resolutionScale: 0.25,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function loadGraphicsSettings(): GraphicsSettings {
  try {
    const raw = localStorage.getItem(GRAPHICS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_GRAPHICS, ...parsed };
    }
  } catch {
    // corrupted or unavailable
  }
  return { ...DEFAULT_GRAPHICS };
}

export function saveGraphicsSettings(settings: GraphicsSettings): void {
  try {
    localStorage.setItem(GRAPHICS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable
  }
}

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_AUDIO, ...parsed };
    }
  } catch {
    // corrupted or unavailable
  }
  return { ...DEFAULT_AUDIO };
}

export function saveAudioSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable
  }
}

export function loadDebugSettings(): DebugSettings {
  try {
    const raw = localStorage.getItem(DEBUG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_DEBUG, ...parsed };
    }
  } catch {
    // corrupted or unavailable
  }
  return { ...DEFAULT_DEBUG };
}

export function saveDebugSettings(settings: DebugSettings): void {
  try {
    localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable
  }
}

export function getDefaultGraphics(): GraphicsSettings {
  return { ...DEFAULT_GRAPHICS };
}

export function getDefaultAudio(): AudioSettings {
  return { ...DEFAULT_AUDIO };
}

export function getDefaultDebug(): DebugSettings {
  return { ...DEFAULT_DEBUG };
}

export function applyQualityPreset(preset: string): GraphicsSettings {
  const values = QUALITY_PRESET_VALUES[preset];
  if (!values) return { ...DEFAULT_GRAPHICS, qualityPreset: 'custom' };
  return {
    qualityPreset: preset as GraphicsSettings['qualityPreset'],
    ...values,
  };
}

// ---------------------------------------------------------------------------
// SettingsMenu class
// ---------------------------------------------------------------------------

type TabName = 'gpu' | 'graphics' | 'performance' | 'audio' | 'gameplay';

export class SettingsMenu {
  // Static renderer info -- set once, available to all instances
  private static globalRendererBackend: RendererBackend = 'webgl2';
  private static globalRendererIsWebGPU = false;
  /** Cached GPU report -- detected once, shared across all SettingsMenu instances. */
  private static cachedGPUReport: GPUCapabilityReport | null = null;
  /** Global visual style change callback -- set once, called by ANY SettingsMenu instance. */
  private static globalVisualStyleChangeCallback: ((preset: import('./VisualPlayground').VisualPreset | null) => void) | null = null;
  /** Global debug settings change callback -- set once, called by ANY SettingsMenu instance. */
  private static globalDebugChangeCallback: ((settings: DebugSettings) => void) | null = null;

  private container: HTMLDivElement;
  private styleElement: HTMLStyleElement | null = null;
  private onCloseCallback: (() => void) | null = null;
  private onGraphicsChangeCallback: ((settings: GraphicsSettings) => void) | null = null;
  private onAudioChangeCallback: ((settings: AudioSettings) => void) | null = null;
  private onDebugChangeCallback: ((settings: DebugSettings) => void) | null = null;
  private onDDAChangeCallback: ((enabled: boolean) => void) | null = null;
  private onVisualStyleChangeCallback: ((preset: import('./VisualPlayground').VisualPreset | null) => void) | null = null;

  private activeTab: TabName = 'gpu';
  private graphicsSettings: GraphicsSettings;
  private audioSettings: AudioSettings;
  private debugSettings: DebugSettings;

  // External data injected before show()
  private gpuReport: GPUCapabilityReport | null = null;
  private rendererBackend: RendererBackend = SettingsMenu.globalRendererBackend;
  private rendererIsWebGPU = SettingsMenu.globalRendererIsWebGPU;
  private benchmarkResult: BenchmarkResult | null = null;
  private benchmarkRunning = false;

  // Performance tab live update
  private perfInterval: ReturnType<typeof setInterval> | null = null;
  private perfDataProvider: (() => { fps: number; drawCalls: number; entityCount: number; memoryMB: number }) | null = null;
  private adaptiveQualityEnabled = true;
  private ddaSettings: DDASettingsData;

  constructor() {
    this.graphicsSettings = loadGraphicsSettings();
    this.audioSettings = loadAudioSettings();
    this.debugSettings = loadDebugSettings();
    this.ddaSettings = loadDDASettings();

    this.container = document.createElement('div');
    this.container.id = 'settings-menu';
    this.container.classList.add('hidden');
    this.applyStyles();
    document.body.appendChild(this.container);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Set GPU capability report (from detectGPUCapabilities). */
  setGPUReport(report: GPUCapabilityReport): void {
    this.gpuReport = report;
    SettingsMenu.cachedGPUReport = report;
  }

  /** Set the active renderer backend info (from RendererFactory).
   *  Also stored globally so future SettingsMenu instances pick it up. */
  setRendererInfo(backend: RendererBackend, isWebGPU: boolean): void {
    this.rendererBackend = backend;
    this.rendererIsWebGPU = isWebGPU;
    SettingsMenu.globalRendererBackend = backend;
    SettingsMenu.globalRendererIsWebGPU = isWebGPU;
  }

  /** Static setter for renderer info -- call once during game initialization.
   *  All future SettingsMenu instances will automatically use these values. */
  static setGlobalRendererInfo(backend: RendererBackend, isWebGPU: boolean): void {
    SettingsMenu.globalRendererBackend = backend;
    SettingsMenu.globalRendererIsWebGPU = isWebGPU;
  }

  /** Static setter for visual style change callback -- called by ANY SettingsMenu instance
   *  when the user selects a visual style. Set once during game initialization. */
  static setGlobalVisualStyleChangeCallback(callback: (preset: import('./VisualPlayground').VisualPreset | null) => void): void {
    SettingsMenu.globalVisualStyleChangeCallback = callback;
  }

  /** Static setter for debug settings change callback -- called by ANY SettingsMenu instance
   *  when the user toggles debug settings. Set once during game initialization. */
  static setGlobalDebugChangeCallback(callback: (settings: DebugSettings) => void): void {
    SettingsMenu.globalDebugChangeCallback = callback;
  }

  /** Set a function that returns live perf data each tick. */
  setPerfDataProvider(provider: () => { fps: number; drawCalls: number; entityCount: number; memoryMB: number }): void {
    this.perfDataProvider = provider;
  }

  /** Set initial adaptive quality state. */
  setAdaptiveQualityEnabled(enabled: boolean): void {
    this.adaptiveQualityEnabled = enabled;
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  onGraphicsChange(callback: (settings: GraphicsSettings) => void): void {
    this.onGraphicsChangeCallback = callback;
  }

  onAudioChange(callback: (settings: AudioSettings) => void): void {
    this.onAudioChangeCallback = callback;
  }

  onDebugChange(callback: (settings: DebugSettings) => void): void {
    this.onDebugChangeCallback = callback;
  }

  /** Register callback for DDA toggle changes. */
  onDDAChange(callback: (enabled: boolean) => void): void {
    this.onDDAChangeCallback = callback;
  }

  /** Register callback for visual style changes. Receives the selected preset, or null if reset to default. */
  onVisualStyleChange(callback: (preset: import('./VisualPlayground').VisualPreset | null) => void): void {
    this.onVisualStyleChangeCallback = callback;
  }

  show(): void {
    // Auto-detect GPU capabilities if not yet set
    if (!this.gpuReport && SettingsMenu.cachedGPUReport) {
      this.gpuReport = SettingsMenu.cachedGPUReport;
    }
    if (!this.gpuReport) {
      // Show immediately with placeholder, then update when detection completes
      this.rebuildContent();
      this.container.classList.remove('hidden');
      this.startPerfUpdates();
      detectGPUCapabilities().then(report => {
        this.gpuReport = report;
        SettingsMenu.cachedGPUReport = report;
        // Refresh if still on GPU tab
        if (this.activeTab === 'gpu') {
          this.rebuildContent();
        }
      });
      return;
    }
    this.rebuildContent();
    this.container.classList.remove('hidden');
    this.startPerfUpdates();
  }

  hide(): void {
    this.stopPerfUpdates();
    this.container.classList.add('hidden');
  }

  dispose(): void {
    this.stopPerfUpdates();
    this.container.remove();
    if (this.styleElement) {
      this.styleElement.remove();
    }
  }

  getGraphicsSettings(): GraphicsSettings {
    return { ...this.graphicsSettings };
  }

  getAudioSettings(): AudioSettings {
    return { ...this.audioSettings };
  }

  getDebugSettings(): DebugSettings {
    return { ...this.debugSettings };
  }

  // -----------------------------------------------------------------------
  // Styles
  // -----------------------------------------------------------------------

  private applyStyles(): void {
    const style = document.createElement('style');
    this.styleElement = style;
    style.textContent = `
      #settings-menu {
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
      #settings-menu.hidden { display: none; }

      #settings-menu .settings-content {
        background: rgba(8, 4, 24, 0.95);
        border: 1px solid rgba(0, 255, 255, 0.2);
        border-radius: 8px;
        padding: 0;
        max-width: 700px;
        width: 90%;
        max-height: 85vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        box-shadow: 0 0 40px rgba(0, 0, 0, 0.6);
      }

      /* Title bar */
      #settings-menu .settings-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 24px;
        border-bottom: 1px solid rgba(0, 255, 255, 0.1);
      }
      #settings-menu .settings-header h1 {
        color: #00ffff;
        font-size: 24px;
        letter-spacing: 6px;
        margin: 0;
        text-shadow: 0 0 10px #00ffff;
      }
      #settings-menu .close-btn {
        background: none;
        border: 1px solid #884400;
        color: #ff8800;
        padding: 8px 20px;
        font-size: 13px;
        cursor: pointer;
        letter-spacing: 2px;
        transition: all 0.2s;
      }
      #settings-menu .close-btn:hover {
        background: rgba(120, 60, 0, 0.5);
        box-shadow: 0 0 15px #ff8800;
      }

      /* Tabs */
      #settings-menu .tabs {
        display: flex;
        border-bottom: 1px solid rgba(0, 255, 255, 0.1);
      }
      #settings-menu .tab-btn {
        flex: 1;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        color: #668888;
        padding: 12px 16px;
        font-size: 13px;
        font-weight: bold;
        letter-spacing: 2px;
        cursor: pointer;
        transition: all 0.2s;
      }
      #settings-menu .tab-btn:hover {
        color: #88cccc;
        background: rgba(0, 255, 255, 0.03);
      }
      #settings-menu .tab-btn.active {
        color: #00ffff;
        border-bottom-color: #00ffff;
        background: rgba(0, 255, 255, 0.05);
      }

      /* Tab content area */
      #settings-menu .tab-content {
        padding: 24px;
        overflow-y: auto;
        flex: 1;
        min-height: 300px;
        max-height: 55vh;
      }

      /* Section groups */
      #settings-menu .setting-group {
        margin-bottom: 18px;
      }
      #settings-menu .setting-group label {
        display: block;
        color: #88aaaa;
        font-size: 12px;
        letter-spacing: 2px;
        margin-bottom: 6px;
      }
      #settings-menu .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      #settings-menu .setting-label {
        color: #ccccff;
        font-size: 14px;
        letter-spacing: 1px;
      }
      #settings-menu .setting-value {
        color: #00ffff;
        font-size: 13px;
        font-family: monospace;
        min-width: 60px;
        text-align: right;
      }
      #settings-menu .setting-hint {
        color: #888899;
        font-size: 12px;
        margin: -8px 0 8px 0;
        padding-left: 0;
      }

      /* Info rows (GPU tab) */
      #settings-menu .info-row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      }
      #settings-menu .info-label {
        color: #888899;
        font-size: 13px;
      }
      #settings-menu .info-value {
        color: #ccccff;
        font-size: 13px;
        font-family: monospace;
      }
      #settings-menu .info-value.good { color: #44ff88; }
      #settings-menu .info-value.warn { color: #ffaa44; }
      #settings-menu .info-value.bad { color: #ff4444; }

      /* Selects */
      #settings-menu select {
        background: rgba(0, 40, 40, 0.6);
        border: 1px solid #006666;
        color: #00ffff;
        padding: 8px 12px;
        font: 13px 'Segoe UI', Arial, sans-serif;
        cursor: pointer;
        outline: none;
        min-width: 140px;
      }
      #settings-menu select:focus {
        border-color: #00ffff;
        box-shadow: 0 0 8px rgba(0, 255, 255, 0.3);
      }

      /* Sliders */
      #settings-menu input[type="range"] {
        -webkit-appearance: none;
        appearance: none;
        width: 200px;
        height: 6px;
        background: rgba(0, 100, 100, 0.3);
        border-radius: 3px;
        outline: none;
      }
      #settings-menu input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        background: #00ffff;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 0 6px #00ffff;
      }

      /* Toggle switches */
      #settings-menu .toggle {
        position: relative;
        width: 48px;
        height: 24px;
        background: rgba(80, 40, 40, 0.5);
        border: 1px solid #664444;
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.3s;
      }
      #settings-menu .toggle.on {
        background: rgba(0, 100, 80, 0.5);
        border-color: #00ff88;
      }
      #settings-menu .toggle::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        background: #888;
        border-radius: 50%;
        transition: all 0.3s;
      }
      #settings-menu .toggle.on::after {
        left: 26px;
        background: #00ff88;
        box-shadow: 0 0 6px #00ff88;
      }

      /* Buttons */
      #settings-menu .action-btn {
        background: linear-gradient(180deg, #336644 0%, #224422 100%);
        border: 2px solid #44ff66;
        color: #ffffff;
        padding: 10px 24px;
        font-size: 13px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 2px;
      }
      #settings-menu .action-btn:hover {
        transform: scale(1.03);
        box-shadow: 0 0 15px #44ff66;
      }
      #settings-menu .action-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }

      /* Benchmark results */
      #settings-menu .benchmark-results {
        margin-top: 12px;
        padding: 12px;
        background: rgba(0, 40, 40, 0.3);
        border: 1px solid rgba(0, 255, 255, 0.1);
        border-radius: 4px;
      }
      #settings-menu .benchmark-tier {
        font-size: 18px;
        font-weight: bold;
        margin-bottom: 8px;
      }
      #settings-menu .benchmark-tier.high { color: #44ff88; }
      #settings-menu .benchmark-tier.medium { color: #ffaa44; }
      #settings-menu .benchmark-tier.low { color: #ff8844; }
      #settings-menu .benchmark-tier.minimal { color: #ff4444; }

      #settings-menu .benchmark-bar {
        height: 4px;
        background: rgba(0, 255, 255, 0.15);
        border-radius: 2px;
        margin: 4px 0;
        overflow: hidden;
      }
      #settings-menu .benchmark-bar-fill {
        height: 100%;
        border-radius: 2px;
        transition: width 0.3s;
      }

      /* Performance monitor */
      #settings-menu .perf-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      #settings-menu .perf-card {
        background: rgba(0, 40, 40, 0.3);
        border: 1px solid rgba(0, 255, 255, 0.1);
        border-radius: 4px;
        padding: 16px;
        text-align: center;
      }
      #settings-menu .perf-value {
        font-size: 28px;
        font-weight: bold;
        color: #00ffff;
        font-family: monospace;
      }
      #settings-menu .perf-label {
        font-size: 11px;
        color: #668888;
        letter-spacing: 2px;
        margin-top: 4px;
      }

      /* Section heading */
      #settings-menu .section-heading {
        color: #ff88ff;
        font-size: 12px;
        letter-spacing: 3px;
        margin: 18px 0 10px;
        padding-bottom: 4px;
        border-bottom: 1px solid rgba(255, 136, 255, 0.15);
      }
      #settings-menu .section-heading:first-child {
        margin-top: 0;
      }

      /* Visual style list */
      #settings-menu .style-list {
        max-height: 250px;
        overflow-y: auto;
        border: 1px solid rgba(0, 255, 255, 0.1);
        border-radius: 4px;
        margin-bottom: 8px;
      }
      #settings-menu .style-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        cursor: pointer;
        transition: all 0.15s;
        border-bottom: 1px solid rgba(255, 255, 255, 0.03);
        user-select: none;
        -webkit-user-select: none;
      }
      #settings-menu .style-item:last-child {
        border-bottom: none;
      }
      #settings-menu .style-item:hover {
        background: rgba(0, 255, 255, 0.08);
      }
      #settings-menu .style-item:active {
        background: rgba(0, 255, 255, 0.15);
        transform: scale(0.98);
      }
      #settings-menu .style-item-active {
        background: rgba(0, 255, 160, 0.1);
        border-left: 3px solid #00ffa0;
      }
      #settings-menu .style-item-name {
        color: #ccccff;
        font-size: 13px;
        letter-spacing: 1px;
      }
      #settings-menu .style-item-active .style-item-name {
        color: #00ffa0;
        font-weight: bold;
      }
      #settings-menu .style-item-badge {
        color: #00ff88;
        font-size: 10px;
        font-weight: bold;
        letter-spacing: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  // -----------------------------------------------------------------------
  // Content building
  // -----------------------------------------------------------------------

  private rebuildContent(): void {
    this.container.innerHTML = `
      <div class="settings-content">
        <div class="settings-header">
          <h1>SETTINGS</h1>
          <button class="close-btn" data-action="close">DONE</button>
        </div>
        <div class="tabs">
          <button class="tab-btn${this.activeTab === 'gpu' ? ' active' : ''}" data-tab="gpu">GPU INFO</button>
          <button class="tab-btn${this.activeTab === 'graphics' ? ' active' : ''}" data-tab="graphics">GRAPHICS</button>
          <button class="tab-btn${this.activeTab === 'performance' ? ' active' : ''}" data-tab="performance">PERFORMANCE</button>
          <button class="tab-btn${this.activeTab === 'audio' ? ' active' : ''}" data-tab="audio">AUDIO</button>
          <button class="tab-btn${this.activeTab === 'gameplay' ? ' active' : ''}" data-tab="gameplay">GAMEPLAY</button>
        </div>
        <div class="tab-content" id="settings-tab-content">
          ${this.renderActiveTab()}
        </div>
      </div>
    `;
    this.attachEventListeners();
  }

  private renderActiveTab(): string {
    switch (this.activeTab) {
      case 'gpu': return this.renderGPUTab();
      case 'graphics': return this.renderGraphicsTab();
      case 'performance': return this.renderPerformanceTab();
      case 'audio': return this.renderAudioTab();
      case 'gameplay': return this.renderGameplayTab();
    }
  }

  // ---- GPU Info Tab ----

  private renderGPUTab(): string {
    const r = this.gpuReport;
    const renderer = r?.renderer ?? 'Detecting...';
    const vendor = r?.vendor ?? 'Detecting...';
    const tier = r?.tier ?? 'unknown';
    const tierClass = tier === 'high' ? 'good' : tier === 'medium' ? 'warn' : 'bad';

    // Detect if renderer string is masked/generic
    const isRendererMasked = !r || renderer === 'unknown' || renderer === 'Detecting...' ||
      renderer.toLowerCase() === 'webkit webgl' ||
      renderer.toLowerCase().includes('(unknown)');

    let benchmarkHTML = '';
    if (this.benchmarkResult) {
      const br = this.benchmarkResult;
      const tierCls = br.gpuTier;
      benchmarkHTML = `
        <div class="benchmark-results">
          <div class="benchmark-tier ${tierCls}">Benchmark Tier: ${br.gpuTier.toUpperCase()}</div>
          <div class="info-row">
            <span class="info-label">Max @ 60fps (instanced)</span>
            <span class="info-value good">${br.maxAt60fps} entities</span>
          </div>
          <div class="info-row">
            <span class="info-label">Max @ 30fps (instanced)</span>
            <span class="info-value warn">${br.maxAt30fps} entities</span>
          </div>
          ${br.scores.map(s => {
            const pct = Math.min(100, (s.avgFps / 60) * 100);
            const color = s.avgFps >= 60 ? '#44ff88' : s.avgFps >= 30 ? '#ffaa44' : '#ff4444';
            return `
              <div class="info-row">
                <span class="info-label">${s.entityCount} entities</span>
                <span class="info-value" style="color:${color}">${s.avgFps} fps</span>
              </div>
              <div class="benchmark-bar">
                <div class="benchmark-bar-fill" style="width:${pct}%;background:${color}"></div>
              </div>
            `;
          }).join('')}
          <div style="color:#668888;font-size:11px;margin-top:8px;line-height:1.4;">
            Uses InstancedMesh rendering (1 draw call per entity type), matching real gameplay performance.
          </div>
        </div>
      `;
    }

    const benchBtnLabel = this.benchmarkRunning ? 'RUNNING...' : 'RUN GPU BENCHMARK';

    const activeRendererLabel = this.rendererIsWebGPU ? 'WebGPU' : 'WebGL2';
    const activeRendererClass = this.rendererIsWebGPU ? 'good' : '';
    const webgpuHint = r?.webgpu && !this.rendererIsWebGPU
      ? ' (add ?renderer=webgpu to URL to enable)'
      : '';

    // WebGPU adapter info row (only if we have it)
    const adapterRow = r?.webgpuAdapter
      ? `<div class="info-row">
           <span class="info-label">WebGPU Adapter</span>
           <span class="info-value good">${this.escapeHtml(r.webgpuAdapter)}</span>
         </div>`
      : '';

    // Privacy notice when renderer is masked
    const privacyNote = isRendererMasked
      ? `<div style="color:#886644;font-size:11px;margin-top:4px;line-height:1.4;">
           Chrome restricts GPU hardware details for privacy.
           ${r?.webgpuAdapter ? 'WebGPU adapter info shown above provides hardware details.' : 'Enable WebGPU flags for better hardware detection.'}
         </div>`
      : '';

    return `
      <div class="section-heading">RENDERER</div>
      <div class="info-row">
        <span class="info-label">Active Renderer</span>
        <span class="info-value ${activeRendererClass}">${activeRendererLabel}</span>
      </div>

      <div class="section-heading">HARDWARE</div>
      <div class="info-row">
        <span class="info-label">GPU Renderer</span>
        <span class="info-value">${this.escapeHtml(renderer)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">GPU Vendor</span>
        <span class="info-value">${this.escapeHtml(vendor)}</span>
      </div>
      ${adapterRow}
      ${privacyNote}
      <div class="info-row">
        <span class="info-label">Detected Tier</span>
        <span class="info-value ${tierClass}">${tier.toUpperCase()}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Max Texture Size</span>
        <span class="info-value">${r?.maxTextureSize ?? 'N/A'}</span>
      </div>

      <div class="section-heading">FEATURES</div>
      <div class="info-row">
        <span class="info-label">WebGPU</span>
        <span class="info-value ${r?.webgpu ? 'good' : ''}">${r?.webgpu ? 'Available' : 'Not available'}${webgpuHint}</span>
      </div>
      <div class="info-row">
        <span class="info-label">WebGL2</span>
        <span class="info-value ${r?.webgl2 ? 'good' : ''}">${r?.webgl2 ? 'Available' : 'Not available'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">SharedArrayBuffer</span>
        <span class="info-value ${r?.sharedArrayBuffer ? 'good' : ''}">${r?.sharedArrayBuffer ? 'Available' : 'Not available'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">CPU Cores</span>
        <span class="info-value">${r?.hardwareConcurrency ?? 'N/A'}</span>
      </div>

      <div class="section-heading">BENCHMARK</div>
      <button class="action-btn" id="run-benchmark" ${this.benchmarkRunning ? 'disabled' : ''}>
        ${benchBtnLabel}
      </button>
      <div id="benchmark-progress"></div>
      ${benchmarkHTML}

      <div style="margin-top:18px;padding-top:14px;border-top:1px solid rgba(0,255,255,0.08);">
        <button class="action-btn" id="run-full-benchmark" style="background:linear-gradient(180deg,#443366 0%,#2a1a44 100%);border-color:#aa66ff;">
          RUN FULL GAME BENCHMARK
        </button>
        <div style="color:#668888;font-size:11px;margin-top:8px;line-height:1.4;">
          Tests real gameplay performance with moving enemies, bullets, and collisions.
          Creates a full game session and measures FPS across increasing entity counts.
        </div>
      </div>
    `;
  }

  // ---- Graphics Tab ----

  private renderGraphicsTab(): string {
    const g = this.graphicsSettings;
    const presets = ['ultra', 'high', 'medium', 'low', 'minimal', 'custom'];
    const activeStyle = getActiveStyleName();

    // Build combined preset list (built-in + custom)
    const customs = loadCustomStyles();
    const allPresets = [...VISUAL_PRESETS, ...customs.map(c => c.preset)];
    const activeIdx = getActiveStyleIndex();

    const styleItems = allPresets.map((p, i) => {
      const isActive = i === activeIdx;
      return `<div class="style-item${isActive ? ' style-item-active' : ''}" data-style-index="${i}">
        <span class="style-item-name">${this.escapeHtml(p.name)}</span>
        <span class="style-item-badge">${isActive ? 'ACTIVE' : ''}</span>
      </div>`;
    }).join('');

    return `
      <div class="section-heading">VISUAL STYLE</div>
      <div class="style-list" id="visual-style-list">${styleItems}</div>
      <div style="color:#557777;font-size:11px;margin-bottom:8px;line-height:1.4;">
        Click a style to select it. Bloom changes apply immediately; surface colors apply on next game start.
      </div>
      ${activeStyle !== 'Default' ? '<button class="action-btn" id="reset-visual-style" style="padding:6px 14px;font-size:11px;margin-bottom:12px;">RESET TO DEFAULT</button>' : ''}

      <div class="section-heading">QUALITY PRESET</div>
      <div class="setting-row">
        <span class="setting-label">Preset</span>
        <select id="quality-preset">
          ${presets.map(p => `<option value="${p}" ${g.qualityPreset === p ? 'selected' : ''}>${p.toUpperCase()}</option>`).join('')}
        </select>
      </div>

      <div class="section-heading">VISUAL EFFECTS</div>
      <div class="setting-row">
        <span class="setting-label">Bloom</span>
        <div class="toggle ${g.bloomEnabled ? 'on' : ''}" id="toggle-bloom" data-setting="bloomEnabled"></div>
      </div>
      <div class="setting-row">
        <span class="setting-label">Bloom Strength</span>
        <input type="range" id="bloom-strength" min="0" max="2" step="0.1" value="${g.bloomStrength}" />
        <span class="setting-value" id="bloom-strength-val">${g.bloomStrength.toFixed(1)}</span>
      </div>
      <div class="setting-hint">
        <small>Good starting values — Modern: 1.0 | Pixelated: 0.4</small>
      </div>
      <div class="setting-row">
        <span class="setting-label">Particles</span>
        <input type="range" id="particle-count" min="100" max="5000" step="100" value="${g.particleCount}" />
        <span class="setting-value" id="particle-count-val">${g.particleCount}</span>
      </div>
      <div class="setting-row">
        <span class="setting-label">Trail Effects</span>
        <div class="toggle ${g.trailEffects ? 'on' : ''}" id="toggle-trails" data-setting="trailEffects"></div>
      </div>

      <div class="section-heading">LIMITS</div>
      <div class="setting-row">
        <span class="setting-label">Max Enemies</span>
        <input type="range" id="max-enemies" min="50" max="5000" step="50" value="${g.maxEnemies}" />
        <span class="setting-value" id="max-enemies-val">${g.maxEnemies}</span>
      </div>
      <div class="setting-row">
        <span class="setting-label">Resolution Scale</span>
        <input type="range" id="resolution-scale" min="0.25" max="1" step="0.05" value="${g.resolutionScale}" />
        <span class="setting-value" id="resolution-scale-val">${(g.resolutionScale * 100).toFixed(0)}%</span>
      </div>
    `;
  }

  // ---- Performance Tab ----

  private renderPerformanceTab(): string {
    return `
      <div class="section-heading">LIVE STATS</div>
      <div class="perf-grid">
        <div class="perf-card">
          <div class="perf-value" id="perf-fps">--</div>
          <div class="perf-label">FPS</div>
        </div>
        <div class="perf-card">
          <div class="perf-value" id="perf-draw-calls">--</div>
          <div class="perf-label">DRAW CALLS</div>
        </div>
        <div class="perf-card">
          <div class="perf-value" id="perf-entities">--</div>
          <div class="perf-label">ENTITIES</div>
        </div>
        <div class="perf-card">
          <div class="perf-value" id="perf-memory">--</div>
          <div class="perf-label">MEMORY (MB)</div>
        </div>
      </div>

      <div class="section-heading">ADAPTIVE QUALITY</div>
      <div class="setting-row">
        <span class="setting-label">Auto-adjust quality</span>
        <div class="toggle ${this.adaptiveQualityEnabled ? 'on' : ''}" id="toggle-adaptive" data-setting="adaptiveQuality"></div>
      </div>

      <div class="section-heading">DEBUG</div>
      <div class="setting-row">
        <span class="setting-label">Debug Statistics</span>
        <div class="toggle ${this.debugSettings.showDebugStatistics ? 'on' : ''}" id="toggle-debug-stats" data-setting="showDebugStatistics"></div>
      </div>
      <div style="color:#668888;font-size:12px;margin-top:4px;line-height:1.5;">
        Shows FPS, entity count, and performance overlay. Keyboard shortcut: F3.
      </div>
    `;
  }

  // ---- Audio Tab ----

  private renderAudioTab(): string {
    const a = this.audioSettings;
    const presets: MusicPreset[] = ['electronic', 'ambient', 'synthwave', 'minimal'];
    const presetNames: Record<MusicPreset, string> = {
      electronic: 'Electronic',
      ambient: 'Ambient',
      synthwave: 'Synthwave',
      minimal: 'Minimal',
    };

    return `
      <div class="section-heading">VOLUME</div>
      <div class="setting-row">
        <span class="setting-label">Master</span>
        <input type="range" id="master-volume" min="0" max="100" step="1" value="${a.masterVolume}" />
        <span class="setting-value" id="master-volume-val">${a.masterVolume}%</span>
      </div>
      <div class="setting-row">
        <span class="setting-label">SFX</span>
        <input type="range" id="sfx-volume" min="0" max="100" step="1" value="${a.sfxVolume}" />
        <span class="setting-value" id="sfx-volume-val">${a.sfxVolume}%</span>
      </div>
      <div class="setting-row">
        <span class="setting-label">Music</span>
        <input type="range" id="music-volume" min="0" max="100" step="1" value="${a.musicVolume}" />
        <span class="setting-value" id="music-volume-val">${a.musicVolume}%</span>
      </div>

      <div class="section-heading">MUSIC STYLE</div>
      <div class="setting-row">
        <span class="setting-label">Preset</span>
        <select id="music-preset">
          ${presets.map(p => `<option value="${p}" ${a.musicPreset === p ? 'selected' : ''}>${presetNames[p]}</option>`).join('')}
        </select>
      </div>
    `;
  }

  // ---- Gameplay Tab ----

  private renderGameplayTab(): string {
    return `
      <div class="section-heading">DIFFICULTY</div>
      <div class="setting-row">
        <span class="setting-label">Dynamic Difficulty</span>
        <div class="toggle ${this.ddaSettings.enabled ? 'on' : ''}" id="toggle-dda" data-setting="ddaEnabled"></div>
      </div>
      <div style="color:#668888;font-size:12px;margin-top:4px;line-height:1.5;">
        Subtly adjusts enemy composition for struggling players.<br>
        Disabled automatically on Nightmare difficulty.
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Event listeners
  // -----------------------------------------------------------------------

  private attachEventListeners(): void {
    // Close button
    const closeBtn = this.container.querySelector('[data-action="close"]');
    closeBtn?.addEventListener('click', () => {
      this.hide();
      this.onCloseCallback?.();
    });

    // Tab switching
    const tabBtns = this.container.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = (btn as HTMLElement).dataset.tab as TabName;
        this.rebuildContent();
        if (this.activeTab === 'performance') this.startPerfUpdates();
      });
    });

    // Tab-specific listeners
    switch (this.activeTab) {
      case 'gpu':
        this.attachGPUListeners();
        break;
      case 'graphics':
        this.attachGraphicsListeners();
        break;
      case 'performance':
        this.attachPerformanceListeners();
        break;
      case 'audio':
        this.attachAudioListeners();
        break;
      case 'gameplay':
        this.attachGameplayListeners();
        break;
    }
  }

  private attachGPUListeners(): void {
    const benchBtn = this.container.querySelector('#run-benchmark') as HTMLButtonElement | null;
    benchBtn?.addEventListener('click', () => {
      this.runBenchmark();
    });

    const fullBenchBtn = this.container.querySelector('#run-full-benchmark') as HTMLButtonElement | null;
    fullBenchBtn?.addEventListener('click', () => {
      this.launchFullBenchmark();
    });
  }

  private attachGraphicsListeners(): void {
    // Visual style items - click to apply
    const styleItems = this.container.querySelectorAll('.style-item');
    styleItems.forEach(item => {
      (item as HTMLElement).addEventListener('click', () => {
        const idx = parseInt((item as HTMLElement).dataset.styleIndex ?? '0', 10);
        saveVisualStyle(idx);
        // Notify callbacks with the selected preset
        const customs = loadCustomStyles();
        const allPresets = [...VISUAL_PRESETS, ...customs.map(c => c.preset)];
        const selectedPreset = allPresets[idx] ?? null;
        this.onVisualStyleChangeCallback?.(selectedPreset);
        SettingsMenu.globalVisualStyleChangeCallback?.(selectedPreset);
        this.rebuildContent();
      });
    });

    // Reset visual style button
    const resetStyleBtn = this.container.querySelector('#reset-visual-style') as HTMLButtonElement | null;
    resetStyleBtn?.addEventListener('click', () => {
      clearVisualStyle();
      this.onVisualStyleChangeCallback?.(null);
      SettingsMenu.globalVisualStyleChangeCallback?.(null);
      this.rebuildContent();
    });

    // Quality preset dropdown
    const presetSelect = this.container.querySelector('#quality-preset') as HTMLSelectElement | null;
    presetSelect?.addEventListener('change', () => {
      const preset = presetSelect.value;
      if (preset !== 'custom') {
        this.graphicsSettings = applyQualityPreset(preset);
        saveGraphicsSettings(this.graphicsSettings);
        this.onGraphicsChangeCallback?.(this.getGraphicsSettings());
        this.rebuildContent();
      }
    });

    // Bloom toggle
    this.attachToggle('toggle-bloom', (on) => {
      this.graphicsSettings = { ...this.graphicsSettings, bloomEnabled: on, qualityPreset: 'custom' };
      this.saveAndNotifyGraphics();
    });

    // Trail toggle
    this.attachToggle('toggle-trails', (on) => {
      this.graphicsSettings = { ...this.graphicsSettings, trailEffects: on, qualityPreset: 'custom' };
      this.saveAndNotifyGraphics();
    });

    // Bloom strength slider
    this.attachSlider('bloom-strength', 'bloom-strength-val', (val) => {
      this.graphicsSettings = { ...this.graphicsSettings, bloomStrength: val, qualityPreset: 'custom' };
      this.saveAndNotifyGraphics();
      return val.toFixed(1);
    });

    // Particle count slider
    this.attachSlider('particle-count', 'particle-count-val', (val) => {
      this.graphicsSettings = { ...this.graphicsSettings, particleCount: val, qualityPreset: 'custom' };
      this.saveAndNotifyGraphics();
      return String(val);
    });

    // Max enemies slider
    this.attachSlider('max-enemies', 'max-enemies-val', (val) => {
      this.graphicsSettings = { ...this.graphicsSettings, maxEnemies: val, qualityPreset: 'custom' };
      this.saveAndNotifyGraphics();
      return String(val);
    });

    // Resolution scale slider
    this.attachSlider('resolution-scale', 'resolution-scale-val', (val) => {
      this.graphicsSettings = { ...this.graphicsSettings, resolutionScale: val, qualityPreset: 'custom' };
      this.saveAndNotifyGraphics();
      return `${(val * 100).toFixed(0)}%`;
    });
  }

  private attachPerformanceListeners(): void {
    this.attachToggle('toggle-adaptive', (on) => {
      this.adaptiveQualityEnabled = on;
    });

    this.attachToggle('toggle-debug-stats', (on) => {
      this.debugSettings = { ...this.debugSettings, showDebugStatistics: on };
      saveDebugSettings(this.debugSettings);
      const debugSettings = this.getDebugSettings();
      this.onDebugChangeCallback?.(debugSettings);
      SettingsMenu.globalDebugChangeCallback?.(debugSettings);
    });
  }

  private attachGameplayListeners(): void {
    this.attachToggle('toggle-dda', (on) => {
      this.ddaSettings = { ...this.ddaSettings, enabled: on };
      saveDDASettings(this.ddaSettings);
      this.onDDAChangeCallback?.(on);
    });
  }

  private attachAudioListeners(): void {
    // Master volume
    this.attachSlider('master-volume', 'master-volume-val', (val) => {
      this.audioSettings = { ...this.audioSettings, masterVolume: val };
      this.saveAndNotifyAudio();
      return `${val}%`;
    });

    // SFX volume
    this.attachSlider('sfx-volume', 'sfx-volume-val', (val) => {
      this.audioSettings = { ...this.audioSettings, sfxVolume: val };
      this.saveAndNotifyAudio();
      return `${val}%`;
    });

    // Music volume
    this.attachSlider('music-volume', 'music-volume-val', (val) => {
      this.audioSettings = { ...this.audioSettings, musicVolume: val };
      this.saveAndNotifyAudio();
      return `${val}%`;
    });

    // Music preset
    const presetSelect = this.container.querySelector('#music-preset') as HTMLSelectElement | null;
    presetSelect?.addEventListener('change', () => {
      this.audioSettings = { ...this.audioSettings, musicPreset: presetSelect.value as MusicPreset };
      this.saveAndNotifyAudio();
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private attachToggle(id: string, onChange: (on: boolean) => void): void {
    const el = this.container.querySelector(`#${id}`);
    el?.addEventListener('click', () => {
      const isOn = el.classList.toggle('on');
      onChange(isOn);
    });
  }

  private attachSlider(
    sliderId: string,
    valueId: string,
    onChange: (val: number) => string
  ): void {
    const slider = this.container.querySelector(`#${sliderId}`) as HTMLInputElement | null;
    const valueEl = this.container.querySelector(`#${valueId}`);
    slider?.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      const display = onChange(val);
      if (valueEl) valueEl.textContent = display;
    });
  }

  private saveAndNotifyGraphics(): void {
    saveGraphicsSettings(this.graphicsSettings);
    this.onGraphicsChangeCallback?.(this.getGraphicsSettings());
  }

  private saveAndNotifyAudio(): void {
    saveAudioSettings(this.audioSettings);
    this.onAudioChangeCallback?.(this.getAudioSettings());
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // -----------------------------------------------------------------------
  // Benchmark
  // -----------------------------------------------------------------------

  private async runBenchmark(): Promise<void> {
    if (this.benchmarkRunning) return;
    this.benchmarkRunning = true;
    this.rebuildContent();

    const progressEl = this.container.querySelector('#benchmark-progress');

    try {
      const { runGPUBenchmark } = await import('./GPUBenchmark');
      this.benchmarkResult = await runGPUBenchmark((current, total, entities, fps) => {
        if (progressEl) {
          const pct = Math.round(((current + 1) / total) * 100);
          progressEl.innerHTML = `
            <div style="color:#88aaaa;font-size:12px;margin-top:8px;">
              Testing ${entities} entities... ${fps} fps (${pct}%)
            </div>
          `;
        }
      });
    } catch (err) {
      if (progressEl) {
        progressEl.innerHTML = `<div style="color:#ff4444;font-size:12px;margin-top:8px;">Benchmark failed: ${String(err)}</div>`;
      }
    }

    this.benchmarkRunning = false;
    this.rebuildContent();
  }

  private async launchFullBenchmark(): Promise<void> {
    // Hide settings menu before launching -- the benchmark creates its own overlay
    this.hide();
    this.onCloseCallback?.();

    try {
      const { runBenchmark } = await import('../benchmark');
      runBenchmark();
    } catch (err) {
      // If import fails, re-show settings and report error
      this.show();
      const content = this.container.querySelector('#settings-tab-content');
      if (content) {
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:#ff4444;font-size:12px;margin-top:12px;';
        errDiv.textContent = `Full benchmark failed to launch: ${String(err)}`;
        content.appendChild(errDiv);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Performance live updates
  // -----------------------------------------------------------------------

  private startPerfUpdates(): void {
    this.stopPerfUpdates();
    if (this.activeTab !== 'performance') return;

    this.perfInterval = setInterval(() => {
      if (!this.perfDataProvider) return;
      const data = this.perfDataProvider();
      this.updatePerfDisplay(data);
    }, 500);
  }

  private stopPerfUpdates(): void {
    if (this.perfInterval !== null) {
      clearInterval(this.perfInterval);
      this.perfInterval = null;
    }
  }

  private updatePerfDisplay(data: { fps: number; drawCalls: number; entityCount: number; memoryMB: number }): void {
    const fpsEl = this.container.querySelector('#perf-fps');
    const drawEl = this.container.querySelector('#perf-draw-calls');
    const entityEl = this.container.querySelector('#perf-entities');
    const memEl = this.container.querySelector('#perf-memory');

    if (fpsEl) {
      fpsEl.textContent = String(Math.round(data.fps));
      (fpsEl as HTMLElement).style.color = data.fps >= 55 ? '#44ff88' : data.fps >= 30 ? '#ffaa44' : '#ff4444';
    }
    if (drawEl) drawEl.textContent = String(data.drawCalls);
    if (entityEl) entityEl.textContent = String(data.entityCount);
    if (memEl) memEl.textContent = data.memoryMB.toFixed(1);
  }
}
