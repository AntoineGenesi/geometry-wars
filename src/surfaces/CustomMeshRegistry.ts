/**
 * CustomMeshRegistry - Singleton registry for managing multiple loaded custom meshes.
 *
 * Features:
 * - Tracks all loaded meshes with metadata (name, source, triangle count)
 * - Caches loaded meshes to avoid redundant loading
 * - LRU (Least Recently Used) eviction when memory limit exceeded
 * - Proper disposal of evicted meshes to prevent memory leaks
 *
 * Usage:
 *   const registry = CustomMeshRegistry.getInstance();
 *   const registered = await registry.load(file, 'My Model');
 *   const surface = registered.surface;
 *   // ... use surface in game ...
 *   registry.remove(registered.id); // Manually remove when done
 */

import { loadMeshFromURL, loadMeshFromFile, type LoadedMesh } from '../loaders/MeshLoader';
import { LoadedMeshSurface } from './LoadedMeshSurface';

export interface RegisteredMesh {
  /** Unique ID (hash of source URL/filename) */
  id: string;
  /** Display name */
  name: string;
  /** Original URL or filename */
  source: string;
  /** The loaded mesh data */
  loadedMesh: LoadedMesh;
  /** The surface wrapper (ready to use in game) */
  surface: LoadedMeshSurface;
  /** Timestamp of last use (for LRU eviction) */
  lastUsed: number;
}

export class CustomMeshRegistry {
  private static instance: CustomMeshRegistry;
  private meshes: Map<string, RegisteredMesh> = new Map();

  /** Maximum number of meshes to keep in memory */
  private readonly maxCount: number = 10;

  private constructor() {}

  /**
   * Get the singleton instance.
   */
  static getInstance(): CustomMeshRegistry {
    if (!this.instance) {
      this.instance = new CustomMeshRegistry();
    }
    return this.instance;
  }

  /**
   * Load a mesh from a URL or File.
   * If the mesh is already loaded (matching ID), returns the cached version.
   * Otherwise loads it, registers it, and evicts oldest meshes if limit exceeded.
   *
   * @param source - URL string or File object
   * @param name - Optional display name (defaults to filename)
   * @param targetRadius - Optional target radius for normalization (default: 8)
   * @returns The registered mesh entry
   */
  async load(
    source: string | File,
    name?: string,
    targetRadius: number = 8
  ): Promise<RegisteredMesh> {
    const id = this.computeId(source);

    // Return cached if already loaded
    if (this.meshes.has(id)) {
      const existing = this.meshes.get(id)!;
      existing.lastUsed = Date.now();
      return existing;
    }

    // Load new mesh
    const loadedMesh =
      typeof source === 'string'
        ? await loadMeshFromURL(source, targetRadius)
        : await loadMeshFromFile(source, targetRadius);

    const surface = new LoadedMeshSurface(loadedMesh);

    const registered: RegisteredMesh = {
      id,
      name: name || this.extractName(source),
      source: typeof source === 'string' ? source : source.name,
      loadedMesh,
      surface,
      lastUsed: Date.now(),
    };

    this.meshes.set(id, registered);

    // LRU eviction if too many loaded
    this.evictOldest(this.maxCount);

    return registered;
  }

  /**
   * Get a registered mesh by ID.
   * Updates the lastUsed timestamp.
   */
  get(id: string): RegisteredMesh | undefined {
    const mesh = this.meshes.get(id);
    if (mesh) {
      mesh.lastUsed = Date.now();
    }
    return mesh;
  }

  /**
   * Get all registered meshes (sorted by most recently used).
   */
  getAll(): RegisteredMesh[] {
    return Array.from(this.meshes.values()).sort((a, b) => b.lastUsed - a.lastUsed);
  }

  /**
   * Remove a mesh from the registry and dispose it.
   */
  remove(id: string): void {
    const mesh = this.meshes.get(id);
    if (mesh) {
      mesh.surface.dispose();
      this.meshes.delete(id);
    }
  }

  /**
   * Remove all meshes from the registry and dispose them.
   */
  clear(): void {
    for (const mesh of this.meshes.values()) {
      mesh.surface.dispose();
    }
    this.meshes.clear();
  }

  /**
   * Evict the oldest meshes if the count exceeds maxCount.
   * Uses LRU (Least Recently Used) strategy.
   */
  private evictOldest(maxCount: number): void {
    if (this.meshes.size <= maxCount) return;

    // Sort by lastUsed (oldest first)
    const sorted = Array.from(this.meshes.values()).sort((a, b) => a.lastUsed - b.lastUsed);

    const toEvict = sorted.slice(0, this.meshes.size - maxCount);
    toEvict.forEach((m) => this.remove(m.id));
  }

  /**
   * Compute a unique ID for a source (URL or File).
   * Uses base64 encoding of the source string.
   */
  private computeId(source: string | File): string {
    const str = typeof source === 'string' ? source : source.name;
    // Simple hash for ID generation using btoa (base64 encode)
    // Remove non-alphanumeric characters and limit length
    try {
      return btoa(str).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
    } catch {
      // Fallback for non-ASCII characters
      return str.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
    }
  }

  /**
   * Extract a display name from a source (URL or File).
   * Strips file extension and path.
   */
  private extractName(source: string | File): string {
    const filename = typeof source === 'string' ? source.split('/').pop()! : source.name;
    return filename.replace(/\.(obj|glb|gltf)$/i, '');
  }
}
