/**
 * Visual Style Settings — Persist & Load
 *
 * Saves the user's chosen visual style preset index to localStorage.
 * The main game reads this on startup to apply the style.
 *
 * Supports both built-in presets (VISUAL_PRESETS) and custom styles
 * stored via VisualStyleEditor.
 */

import { VISUAL_PRESETS, type VisualPreset } from './VisualPlayground';
import { loadCustomStyles } from './VisualStyleEditor';

const STORAGE_KEY = 'gw3d-visual-style';

export interface SavedVisualStyle {
  presetIndex: number;
  presetName: string;
}

/** Build the combined preset list: built-in + custom styles. */
function getAllPresets(): VisualPreset[] {
  const customs = loadCustomStyles();
  return [...VISUAL_PRESETS, ...customs.map((c) => c.preset)];
}

/** Save the chosen visual style preset (index into the combined list). */
export function saveVisualStyle(presetIndex: number): void {
  const allPresets = getAllPresets();
  const preset = allPresets[presetIndex];
  if (!preset) return;
  const data: SavedVisualStyle = {
    presetIndex,
    presetName: preset.name,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage might be full or disabled
  }
}

/** Load the saved visual style. Returns null if nothing saved or preset invalid. */
export function loadVisualStyle(): VisualPreset | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data: SavedVisualStyle = JSON.parse(raw);
    const allPresets = getAllPresets();
    const preset = allPresets[data.presetIndex];
    // Validate the preset still exists and name matches (in case presets were reordered)
    if (preset && preset.name === data.presetName) return preset;
    // Fallback: search by name across all presets (built-in + custom)
    const byName = allPresets.find(p => p.name === data.presetName);
    return byName ?? null;
  } catch {
    return null;
  }
}

/** Get the index of the currently saved style in the combined list, or -1 if none. */
export function getActiveStyleIndex(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return -1;
    const data: SavedVisualStyle = JSON.parse(raw);
    const allPresets = getAllPresets();
    const preset = allPresets[data.presetIndex];
    if (preset && preset.name === data.presetName) return data.presetIndex;
    const idx = allPresets.findIndex(p => p.name === data.presetName);
    return idx;
  } catch {
    return -1;
  }
}

/** Get the name of the active style, or 'Default' if none saved. */
export function getActiveStyleName(): string {
  const preset = loadVisualStyle();
  return preset ? preset.name : 'Default';
}

/** Clear saved visual style (revert to default). */
export function clearVisualStyle(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Visual Mode (Pixelated vs Modern bloom resolution)
// ---------------------------------------------------------------------------

const VISUAL_MODE_KEY = 'gw3d-visual-mode';

/** Pixelated = half-res bloom (retro look). Modern = full-res bloom (crisp). */
export type VisualMode = 'pixelated' | 'modern';

/** Load the saved visual mode. Defaults to 'pixelated' (current behaviour). */
export function loadVisualMode(): VisualMode {
  try {
    const raw = localStorage.getItem(VISUAL_MODE_KEY);
    if (raw === 'modern' || raw === 'pixelated') return raw;
  } catch {
    // localStorage unavailable
  }
  return 'pixelated';
}

/** Persist the chosen visual mode. */
export function saveVisualMode(mode: VisualMode): void {
  try {
    localStorage.setItem(VISUAL_MODE_KEY, mode);
  } catch {
    // localStorage unavailable
  }
}
