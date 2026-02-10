// ---------------------------------------------------------------------------
// DDA Settings
//
// Persistence for the Dynamic Difficulty toggle (on/off).
// Stored in localStorage.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'gw3d-dda-settings';

export interface DDASettingsData {
  /** Whether DDA is enabled (default: true). */
  enabled: boolean;
}

const DEFAULT_SETTINGS: DDASettingsData = {
  enabled: true,
};

/** Load DDA settings from localStorage. */
export function loadDDASettings(): DDASettingsData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // corrupted or unavailable
  }
  return { ...DEFAULT_SETTINGS };
}

/** Save DDA settings to localStorage. */
export function saveDDASettings(settings: DDASettingsData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable
  }
}
