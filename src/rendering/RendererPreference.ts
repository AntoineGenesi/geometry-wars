export type RendererPreference = 'webgpu' | 'webgl2';

export const RENDERER_PREFERENCE_STORAGE_KEY = 'gw3d-renderer-preference';

export function normalizeRendererPreference(value: string | null | undefined): RendererPreference | null {
  const normalized = value?.toLowerCase();
  if (normalized === 'webgpu') return 'webgpu';
  if (normalized === 'webgl' || normalized === 'webgl2') return 'webgl2';
  return null;
}

function getUrlRendererPreference(): RendererPreference | null {
  if (typeof window === 'undefined') return null;
  return normalizeRendererPreference(new URLSearchParams(window.location.search).get('renderer'));
}

export function getPersistedRendererPreference(): RendererPreference | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return normalizeRendererPreference(localStorage.getItem(RENDERER_PREFERENCE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function getRequestedRendererPreference(): RendererPreference | null {
  return getUrlRendererPreference() ?? getPersistedRendererPreference();
}

export function persistRendererPreference(preference: RendererPreference | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (preference) {
      localStorage.setItem(RENDERER_PREFERENCE_STORAGE_KEY, preference);
    } else {
      localStorage.removeItem(RENDERER_PREFERENCE_STORAGE_KEY);
    }
  } catch {
    // localStorage can be unavailable in private or restricted browser contexts.
  }
}
