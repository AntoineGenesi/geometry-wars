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

/** Default grid opacity on mobile (35% vs the desktop default of 10%). */
export const MOBILE_GRID_DEFAULT_BRIGHTNESS = 0.35;

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
