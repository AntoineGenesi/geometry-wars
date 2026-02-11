/**
 * Effect Dictionary
 *
 * Persistent mapping of effect IDs to human-readable descriptions.
 * Survives effect implementation changes — allows historical analytics
 * to correlate "effect 42" with "Hot Hands level 3 aura" even after
 * the code changes.
 *
 * Auto-registers new effects as they're created. Stores to localStorage
 * for cross-session persistence.
 *
 * Zero per-frame allocations.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EffectDescriptor {
  /** Unique effect ID (auto-incremented). */
  id: number;
  /** Effect type (particle, explosion, aura, laser, etc.). */
  type: string;
  /** Human-readable name (e.g., "Hot Hands Aura L3"). */
  name: string;
  /** Source system (BuffManager, WeaponManager, ParticleSystem, etc.). */
  source: string;
  /** First seen timestamp (ISO string). */
  firstSeen: string;
  /** Additional metadata (optional). */
  metadata?: Record<string, any>;
}

/** Serialized dictionary for localStorage. */
interface SerializedDictionary {
  effects: EffectDescriptor[];
  nextId: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'gw_effect_dictionary';

// ---------------------------------------------------------------------------
// EffectDictionary (Singleton)
// ---------------------------------------------------------------------------

export class EffectDictionary {
  private static instance: EffectDictionary | null = null;

  private effects: Map<number, EffectDescriptor> = new Map();
  private nameToId: Map<string, number> = new Map(); // Fast lookup by name
  private nextId = 0;

  // Dirty flag for batched localStorage writes
  private dirty = false;
  private saveTimer: number | null = null;
  private static readonly SAVE_DELAY_MS = 2000; // Batch writes every 2s

  private constructor() {
    this.load();
  }

  static getInstance(): EffectDictionary {
    if (!EffectDictionary.instance) {
      EffectDictionary.instance = new EffectDictionary();
    }
    return EffectDictionary.instance;
  }

  // -------------------------------------------------------------------------
  // Registration API
  // -------------------------------------------------------------------------

  /**
   * Register or retrieve an effect ID by name.
   * If the effect already exists, returns its ID.
   * If new, auto-assigns an ID and registers it.
   *
   * @param type Effect type (particle, explosion, aura, laser, etc.)
   * @param name Human-readable name (should be unique per effect variant)
   * @param source Source system (BuffManager, WeaponManager, etc.)
   * @param metadata Optional additional data
   * @returns Effect ID (stable across sessions)
   */
  register(type: string, name: string, source: string, metadata?: Record<string, any>): number {
    // Check if already registered
    const existing = this.nameToId.get(name);
    if (existing !== undefined) {
      return existing;
    }

    // Allocate new ID
    const id = this.nextId++;
    const descriptor: EffectDescriptor = {
      id,
      type,
      name,
      source,
      firstSeen: new Date().toISOString(),
      metadata,
    };

    this.effects.set(id, descriptor);
    this.nameToId.set(name, id);
    this.dirty = true;
    this.scheduleSave();

    return id;
  }

  /**
   * Get effect descriptor by ID.
   */
  get(id: number): EffectDescriptor | null {
    return this.effects.get(id) ?? null;
  }

  /**
   * Get effect ID by name (returns null if not registered).
   */
  getIdByName(name: string): number | null {
    return this.nameToId.get(name) ?? null;
  }

  /**
   * Get all registered effects.
   */
  getAll(): ReadonlyMap<number, EffectDescriptor> {
    return this.effects;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /**
   * Save dictionary to localStorage (batched, non-blocking).
   */
  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = (typeof window !== 'undefined' ? window.setTimeout : setTimeout)(() => {
      this.save();
    }, EffectDictionary.SAVE_DELAY_MS) as any;
  }

  private save(): void {
    if (!this.dirty) return;

    try {
      const serialized: SerializedDictionary = {
        effects: Array.from(this.effects.values()),
        nextId: this.nextId,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
      this.dirty = false;
      this.saveTimer = null;
    } catch {
      // localStorage full or unavailable — ignore
    }
  }

  /**
   * Load dictionary from localStorage.
   */
  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const serialized: SerializedDictionary = JSON.parse(raw);
      this.nextId = serialized.nextId;

      for (const descriptor of serialized.effects) {
        this.effects.set(descriptor.id, descriptor);
        this.nameToId.set(descriptor.name, descriptor.id);
      }
    } catch {
      // Corrupt data — start fresh
      this.effects.clear();
      this.nameToId.clear();
      this.nextId = 0;
    }
  }

  /**
   * Force immediate save (call on session end).
   */
  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save();
  }

  /**
   * Export dictionary as JSON string (for external analysis).
   */
  static exportAsJSON(): string {
    const instance = EffectDictionary.getInstance();
    const serialized: SerializedDictionary = {
      effects: Array.from(instance.effects.values()),
      nextId: instance.nextId,
    };
    return JSON.stringify(serialized, null, 2);
  }

  /**
   * Clear all entries (for testing or reset).
   */
  static clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
    const instance = EffectDictionary.instance;
    if (instance) {
      instance.effects.clear();
      instance.nameToId.clear();
      instance.nextId = 0;
      instance.dirty = false;
      if (instance.saveTimer !== null) {
        clearTimeout(instance.saveTimer);
        instance.saveTimer = null;
      }
    }
    // Force singleton reset for testing
    EffectDictionary.instance = null;
  }
}
