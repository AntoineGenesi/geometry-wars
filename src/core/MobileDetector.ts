/**
 * Mobile detection utility.
 *
 * Detects mobile mode via:
 * 1. `?mobile=true` URL parameter (explicit, e.g. from QR code)
 * 2. Touch capability + small screen heuristic
 * 3. Manual override via settings toggle
 *
 * The detection result is cached after the first call and remains
 * constant for the lifetime of the page (avoids mid-game changes).
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'gw3d-mobile-override';

/** Cached detection result. Null means not yet computed. */
let cachedResult: boolean | null = null;

/** Manual override from settings. null = auto-detect. */
let manualOverride: boolean | null = null;

// ---------------------------------------------------------------------------
// Detection logic
// ---------------------------------------------------------------------------

/**
 * Detect whether the current device/session should use mobile mode.
 *
 * Priority:
 * 1. Manual override (set via `setMobileOverride`)
 * 2. `?mobile=true` URL parameter
 * 3. Auto-detect via touch + screen size heuristics
 */
function detect(): boolean {
  // 1. Manual override from settings (persisted to localStorage)
  const stored = loadOverride();
  if (stored !== null) {
    return stored;
  }

  // 2. URL parameter (e.g. scanned QR code)
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mobile') === 'true') return true;
    if (params.get('mobile') === 'false') return false;
  }

  // 3. Auto-detect: touch-capable AND small screen
  if (typeof navigator !== 'undefined' && typeof window !== 'undefined') {
    const hasTouch = navigator.maxTouchPoints > 0;
    const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 900;
    const mobileUA = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );
    // Must have touch AND (small screen OR mobile UA)
    if (hasTouch && (smallScreen || mobileUA)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Override persistence
// ---------------------------------------------------------------------------

function loadOverride(): boolean | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function saveOverride(value: boolean | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (value === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, String(value));
    }
  } catch {
    // Storage full or blocked -- ignore
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if the game should run in mobile-optimized mode.
 * Result is cached after first call.
 */
export function isMobile(): boolean {
  if (manualOverride !== null) return manualOverride;
  if (cachedResult === null) {
    cachedResult = detect();
  }
  return cachedResult;
}

/**
 * Force mobile mode on or off. Pass null to revert to auto-detection.
 * Persists to localStorage so it survives page reloads.
 */
export function setMobileOverride(value: boolean | null): void {
  manualOverride = value;
  cachedResult = null; // invalidate cache
  saveOverride(value);
}

/**
 * Get the current override setting (null = auto-detect).
 */
export function getMobileOverride(): boolean | null {
  return manualOverride ?? loadOverride();
}

/**
 * Reset all mobile detection state (for testing).
 */
export function resetMobileDetection(): void {
  cachedResult = null;
  manualOverride = null;
}
