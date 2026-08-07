import { describe, expect, it } from 'vitest';
import { EnemyDiscoveryStore, ENEMY_DISCOVERY_STORAGE_KEY } from './EnemyDiscoveryStore';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error('blocked');
  }

  override setItem(): void {
    throw new Error('blocked');
  }
}

describe('EnemyDiscoveryStore', () => {
  it('persists seen enemy types and reloads normalized values', () => {
    const storage = new MemoryStorage();
    const store = new EnemyDiscoveryStore(storage);

    expect(store.markSeen('blackhole')).toBe(true);
    expect(store.markSeen('gravity_well')).toBe(false);

    const reloaded = new EnemyDiscoveryStore(storage);
    expect(reloaded.isSeen('gravity_well')).toBe(true);
    expect(JSON.parse(storage.getItem(ENEMY_DISCOVERY_STORAGE_KEY) ?? '{}')).toEqual({
      seen: ['gravity_well'],
    });
  });

  it('falls back to empty state when stored JSON is corrupt', () => {
    const storage = new MemoryStorage();
    storage.setItem(ENEMY_DISCOVERY_STORAGE_KEY, '{bad json');
    const store = new EnemyDiscoveryStore(storage);
    expect(store.getSnapshot()).toEqual({ seen: [] });
    expect(store.markSeen('grunt')).toBe(true);
  });

  it('continues in memory when storage is unavailable', () => {
    const store = new EnemyDiscoveryStore(new ThrowingStorage());
    expect(store.getSnapshot()).toEqual({ seen: [] });
    expect(store.markSeen('rocket')).toBe(true);
    expect(store.isSeen('rocket')).toBe(true);
  });

  it('notifies subscribers only for first discoveries', () => {
    const store = new EnemyDiscoveryStore(new MemoryStorage());
    const events: string[] = [];
    store.subscribe((type) => events.push(type));
    store.markSeen('grunt');
    store.markSeen('grunt');
    expect(events).toEqual(['grunt']);
  });
});
