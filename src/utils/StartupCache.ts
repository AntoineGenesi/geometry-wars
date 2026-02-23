/**
 * Client-side localStorage caching for startup data with hash-based invalidation.
 *
 * Reduces bandwidth and join time for returning players in LAN multiplayer.
 * The server computes a hash of its startup config; the client checks its local
 * cache against this hash and skips downloading config if it already has it.
 *
 * Also caches DDA performance baseline across sessions so returning players
 * get adaptive difficulty right away instead of after a warmup period.
 */

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const HASH_KEY = 'gw_startup_cache_hash';
const DATA_KEY = 'gw_startup_cache';
const TIMESTAMP_KEY = 'gw_startup_cache_timestamp';

/** Maximum cache age in milliseconds (24 hours). */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Weapon config entry (mirrors GameRoom.ts WEAPON_CONFIGS) */
export interface WeaponConfigEntry {
  ammo: number;
  damageMultiplier: number;
}

/** DDA performance baseline cached across sessions. */
export interface DDABaselineData {
  /** Normalized performance score (0-1, higher = better). */
  performanceScore: number;
  /** Kill rate EMA from last session (kills/min). */
  killRate: number;
  /** Death rate EMA from last session (deaths/min). */
  deathRate: number;
  /** Score rate EMA from last session (score/min). */
  scoreRate: number;
  /** Timestamp (ms) when this baseline was captured. */
  capturedAt: number;
}

/** Startup configuration data served by the game server. */
export interface StartupConfigData {
  /** Weapon configs: type name → { ammo, damageMultiplier }. */
  weaponConfigs: Record<string, WeaponConfigEntry>;
  /** Server version string (build hash / git commit). */
  serverVersion: string;
  /** DDA performance baseline from the player's last session (optional). */
  ddaBaseline?: DDABaselineData;
}

// ---------------------------------------------------------------------------
// Hash utility
// ---------------------------------------------------------------------------

/**
 * Compute a djb2-style hash from a string.
 * Not cryptographic — fast and sufficient for cache invalidation.
 */
export function computeSimpleHash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    // djb2: h = h * 33 + c, with unsigned 32-bit truncation
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Compute a hash from an arbitrary data object (JSON-serialized).
 * Key order in objects must be deterministic for the hash to be stable.
 */
export function computeObjectHash(data: unknown): string {
  return computeSimpleHash(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Cache read/write
// ---------------------------------------------------------------------------

/**
 * Return the cached startup config hash, or null if not present.
 */
export function getStartupCacheHash(): string | null {
  try {
    return localStorage.getItem(HASH_KEY);
  } catch {
    return null;
  }
}

/**
 * Return true if the cached startup data is fresh:
 *   - the cached hash matches `serverHash`, AND
 *   - the cache was written within MAX_AGE_MS, AND
 *   - the cache payload is present.
 */
export function isStartupCacheFresh(serverHash: string): boolean {
  try {
    const cachedHash = localStorage.getItem(HASH_KEY);
    if (!cachedHash || cachedHash !== serverHash) return false;

    const ts = Number(localStorage.getItem(TIMESTAMP_KEY) ?? '0');
    if (Date.now() - ts > MAX_AGE_MS) return false;

    return localStorage.getItem(DATA_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Return the cached startup config data, or null if not present / parse error.
 */
export function getStartupCache(): StartupConfigData | null {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StartupConfigData;
  } catch {
    return null;
  }
}

/**
 * Write startup config data and its hash to localStorage.
 */
export function setStartupCache(hash: string, data: StartupConfigData): void {
  try {
    localStorage.setItem(HASH_KEY, hash);
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
    localStorage.setItem(TIMESTAMP_KEY, String(Date.now()));
  } catch {
    // localStorage full or unavailable — fail silently
  }
}

/**
 * Update only the DDA baseline within the existing cache entry.
 * Does not invalidate the hash — DDA baseline is session-personal data,
 * not server config data.
 */
export function setDDABaseline(baseline: DDABaselineData): void {
  try {
    const cache = getStartupCache();
    if (!cache) return;

    const updated: StartupConfigData = { ...cache, ddaBaseline: baseline };
    localStorage.setItem(DATA_KEY, JSON.stringify(updated));
  } catch {
    // localStorage unavailable
  }
}

/**
 * Return the cached DDA performance baseline, or null if none.
 */
export function getDDABaseline(): DDABaselineData | null {
  const cache = getStartupCache();
  return cache?.ddaBaseline ?? null;
}

/**
 * Clear all startup cache keys from localStorage.
 */
export function clearStartupCache(): void {
  try {
    localStorage.removeItem(HASH_KEY);
    localStorage.removeItem(DATA_KEY);
    localStorage.removeItem(TIMESTAMP_KEY);
  } catch {
    // ignore
  }
}
