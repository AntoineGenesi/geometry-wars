export interface HUDVisibilitySettings {
  minimap: boolean;
  killLog: boolean;
  totalKillCounter: boolean;
  enemyStreakAnnouncements: boolean;
}

const HUD_VISIBILITY_STORAGE_KEY = 'gw3d-hud-visibility-settings';

export const DEFAULT_HUD_VISIBILITY_SETTINGS: HUDVisibilitySettings = {
  minimap: true,
  killLog: true,
  totalKillCounter: true,
  enemyStreakAnnouncements: true,
};

export function getDefaultHUDVisibilitySettings(): HUDVisibilitySettings {
  return { ...DEFAULT_HUD_VISIBILITY_SETTINGS };
}

export function loadHUDVisibilitySettings(): HUDVisibilitySettings {
  try {
    const raw = localStorage.getItem(HUD_VISIBILITY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<HUDVisibilitySettings>;
      return normalizeHUDVisibilitySettings(parsed);
    }
  } catch {
    // corrupted or unavailable
  }
  return getDefaultHUDVisibilitySettings();
}

export function saveHUDVisibilitySettings(settings: HUDVisibilitySettings): void {
  try {
    localStorage.setItem(
      HUD_VISIBILITY_STORAGE_KEY,
      JSON.stringify(normalizeHUDVisibilitySettings(settings)),
    );
  } catch {
    // localStorage unavailable
  }
}

export function normalizeHUDVisibilitySettings(settings: Partial<HUDVisibilitySettings>): HUDVisibilitySettings {
  return {
    minimap: settings.minimap ?? DEFAULT_HUD_VISIBILITY_SETTINGS.minimap,
    killLog: settings.killLog ?? DEFAULT_HUD_VISIBILITY_SETTINGS.killLog,
    totalKillCounter: settings.totalKillCounter ?? DEFAULT_HUD_VISIBILITY_SETTINGS.totalKillCounter,
    enemyStreakAnnouncements:
      settings.enemyStreakAnnouncements ?? DEFAULT_HUD_VISIBILITY_SETTINGS.enemyStreakAnnouncements,
  };
}
