/**
 * Mobile Grid Configuration
 *
 * Controls the surface grid line density and brightness on mobile devices.
 * On mobile, grid lines are 4× denser and the default brightness is higher
 * to compensate for small screens viewed in variable lighting conditions.
 *
 * Settings persist to localStorage so the user's slider choice survives
 * page reloads.
 */

const STORAGE_KEY = 'gw3d-mobile-grid-brightness';

/** Grid line count multiplier applied on mobile vs desktop. */
export const MOBILE_GRID_SEGMENTS_MULTIPLIER = 4;

/**
 * Maximum mobile grid segments (U-axis).
 * Caps the 4× multiplier so high-density presets don't produce absurdly
 * dense geometry on mobile.
 */
export const MOBILE_GRID_MAX_SEGMENTS_U = 96;

/**
 * Maximum mobile grid segments (V-axis).
 */
export const MOBILE_GRID_MAX_SEGMENTS_V = 72;

/** Default grid opacity on mobile (higher than desktop, but kept below enemy glow). */
export const MOBILE_GRID_DEFAULT_BRIGHTNESS = 0.24;

export const MOBILE_GRID_BRIGHTNESS_MIN = 0.05;
export const MOBILE_GRID_BRIGHTNESS_MAX = 0.80;

/**
 * Load the user's mobile grid brightness setting from localStorage.
 * Returns `MOBILE_GRID_DEFAULT_BRIGHTNESS` if nothing is saved.
 */
export function loadMobileGridBrightness(): number {
  try {
    if (typeof localStorage === 'undefined') return MOBILE_GRID_DEFAULT_BRIGHTNESS;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const val = parseFloat(raw);
      if (!isNaN(val)) {
        return Math.max(
          MOBILE_GRID_BRIGHTNESS_MIN,
          Math.min(MOBILE_GRID_BRIGHTNESS_MAX, val),
        );
      }
    }
  } catch {
    // localStorage blocked or full
  }
  return MOBILE_GRID_DEFAULT_BRIGHTNESS;
}

/**
 * Persist the user's mobile grid brightness setting.
 */
export function saveMobileGridBrightness(value: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // localStorage blocked or full
  }
}

// ---------------------------------------------------------------------------
// Universal grid brightness (desktop + mobile)
// ---------------------------------------------------------------------------

const GRID_BRIGHTNESS_KEY = 'gw3d-grid-brightness';

/** Default grid opacity on desktop: readable, but quieter than enemies and bullets. */
export const DESKTOP_GRID_DEFAULT_BRIGHTNESS = 0.08;

/**
 * Load the user's grid brightness setting from localStorage.
 * Falls back to platform-appropriate default if nothing is saved.
 * On mobile, also reads the old 'gw3d-mobile-grid-brightness' key for backward compat.
 */
export function loadGridBrightness(isMobileDevice: boolean): number {
  try {
    if (typeof localStorage === 'undefined') {
      return isMobileDevice ? MOBILE_GRID_DEFAULT_BRIGHTNESS : DESKTOP_GRID_DEFAULT_BRIGHTNESS;
    }
    // New universal key takes precedence
    const raw = localStorage.getItem(GRID_BRIGHTNESS_KEY);
    if (raw !== null) {
      const val = parseFloat(raw);
      if (!isNaN(val)) return Math.max(0, Math.min(1, val));
    }
    // Backward compat: if mobile and old key exists, migrate it
    if (isMobileDevice) {
      const oldRaw = localStorage.getItem(STORAGE_KEY);
      if (oldRaw !== null) {
        const val = parseFloat(oldRaw);
        if (!isNaN(val)) return Math.max(MOBILE_GRID_BRIGHTNESS_MIN, Math.min(MOBILE_GRID_BRIGHTNESS_MAX, val));
      }
    }
  } catch {
    // localStorage blocked or full
  }
  return isMobileDevice ? MOBILE_GRID_DEFAULT_BRIGHTNESS : DESKTOP_GRID_DEFAULT_BRIGHTNESS;
}

/**
 * Persist the universal grid brightness setting.
 */
export function saveGridBrightness(value: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(GRID_BRIGHTNESS_KEY, String(value));
  } catch {
    // localStorage blocked or full
  }
}

// ---------------------------------------------------------------------------
// Grid density presets
// ---------------------------------------------------------------------------

export type GridDensityPreset = 'low' | 'medium' | 'high';

/**
 * Desktop grid segment counts per density preset.
 * On mobile, these are further multiplied by MOBILE_GRID_SEGMENTS_MULTIPLIER (4×).
 */
export const GRID_DENSITY_PRESETS: Record<GridDensityPreset, { segmentsU: number; segmentsV: number }> = {
  low:    { segmentsU: 12, segmentsV: 9  },
  medium: { segmentsU: 24, segmentsV: 18 },  // default — matches existing hardcoded values
  high:   { segmentsU: 48, segmentsV: 36 },
};

const GRID_DENSITY_KEY = 'gw3d-grid-density';

/**
 * Load the user's grid density preset from localStorage.
 * Returns 'medium' if nothing is saved (matches current default behavior).
 */
export function loadGridDensity(): GridDensityPreset {
  try {
    if (typeof localStorage === 'undefined') return 'medium';
    const raw = localStorage.getItem(GRID_DENSITY_KEY);
    if (raw === 'low' || raw === 'medium' || raw === 'high') return raw;
  } catch {
    // localStorage blocked or full
  }
  return 'medium';
}

/**
 * Persist the user's grid density preset.
 */
export function saveGridDensity(preset: GridDensityPreset): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(GRID_DENSITY_KEY, preset);
  } catch {
    // localStorage blocked or full
  }
}
