import { ENEMY_COMPENDIUM_ENTRIES, normalizeEnemyCompendiumType } from '../entities/enemies/EnemyCompendium';
import type { EnemyType } from '../entities/enemies/EnemySpawner';

export const ENEMY_DISCOVERY_STORAGE_KEY = 'gw_enemy_discoveries_v1';

export interface EnemyDiscoverySnapshot {
  seen: EnemyType[];
}

type DiscoveryListener = (type: EnemyType) => void;

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function parseSnapshot(raw: string | null): EnemyDiscoverySnapshot {
  if (!raw) return { seen: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<EnemyDiscoverySnapshot>;
    const seen = Array.isArray(parsed.seen)
      ? parsed.seen
        .map((value) => normalizeEnemyCompendiumType(String(value)))
        .filter((value): value is EnemyType => value !== null)
      : [];
    return { seen: Array.from(new Set(seen)) };
  } catch {
    return { seen: [] };
  }
}

export class EnemyDiscoveryStore {
  private seenTypes = new Set<EnemyType>();
  private readonly listeners = new Set<DiscoveryListener>();
  private storage: Storage | null;

  constructor(storage: Storage | null = getStorage()) {
    this.storage = storage;
    this.load();
  }

  load(): void {
    const snapshot = parseSnapshot(this.readRaw());
    this.seenTypes = new Set(snapshot.seen);
  }

  getSnapshot(): EnemyDiscoverySnapshot {
    return { seen: Array.from(this.seenTypes) };
  }

  getSeenTypes(): Set<EnemyType> {
    return new Set(this.seenTypes);
  }

  isSeen(type: string): boolean {
    const normalized = normalizeEnemyCompendiumType(type);
    return normalized ? this.seenTypes.has(normalized) : false;
  }

  markSeen(type: string): boolean {
    const normalized = normalizeEnemyCompendiumType(type);
    if (!normalized || this.seenTypes.has(normalized)) return false;

    this.seenTypes.add(normalized);
    this.persist();
    for (const listener of this.listeners) listener(normalized);
    return true;
  }

  markAllSeenForTests(): void {
    this.seenTypes = new Set(ENEMY_COMPENDIUM_ENTRIES.map((entry) => entry.type));
    this.persist();
  }

  clearForTests(): void {
    this.seenTypes.clear();
    this.persist();
  }

  subscribe(listener: DiscoveryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private readRaw(): string | null {
    if (!this.storage) return null;
    try {
      return this.storage.getItem(ENEMY_DISCOVERY_STORAGE_KEY);
    } catch {
      this.storage = null;
      return null;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(ENEMY_DISCOVERY_STORAGE_KEY, JSON.stringify(this.getSnapshot()));
    } catch {
      this.storage = null;
    }
  }
}

export const enemyDiscoveryStore = new EnemyDiscoveryStore();
