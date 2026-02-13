import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomMeshRegistry } from './CustomMeshRegistry';
import * as THREE from 'three';
import type { LoadedMesh } from '../loaders/MeshLoader';

// Mock the MeshLoader module
vi.mock('../loaders/MeshLoader', () => {
  const createMockLoadedMesh = (name: string, triangles: number): LoadedMesh => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(triangles * 3 * 3); // 3 vertices per triangle, 3 coords per vertex
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();

    return {
      mesh: new THREE.Mesh(geometry),
      originalSize: new THREE.Vector3(1, 1, 1),
      scaleFactor: 1,
      triangleCount: triangles,
      animations: [],
    };
  };

  return {
    loadMeshFromURL: vi.fn(async (url: string) => {
      // Extract triangle count from URL for testing
      const match = url.match(/(\d+)tris/);
      const triangles = match ? parseInt(match[1], 10) : 1000;
      return createMockLoadedMesh(url, triangles);
    }),
    loadMeshFromFile: vi.fn(async (file: File) => {
      // Extract triangle count from filename for testing
      const match = file.name.match(/(\d+)tris/);
      const triangles = match ? parseInt(match[1], 10) : 1000;
      return createMockLoadedMesh(file.name, triangles);
    }),
  };
});

describe('CustomMeshRegistry', () => {
  let testCounter = 0;

  beforeEach(() => {
    // Clear the registry before each test
    const registry = CustomMeshRegistry.getInstance();
    registry.clear();
    testCounter++;
  });

  describe('singleton pattern', () => {
    it('returns the same instance on multiple calls', () => {
      const registry1 = CustomMeshRegistry.getInstance();
      const registry2 = CustomMeshRegistry.getInstance();
      expect(registry1).toBe(registry2);
    });
  });

  describe('load', () => {
    it('loads a mesh from URL', async () => {
      const registry = CustomMeshRegistry.getInstance();
      const url = `https://example.com/model${testCounter}.obj`;
      const registered = await registry.load(url, 'Test Model');

      expect(registered).toBeDefined();
      expect(registered.name).toBe('Test Model');
      expect(registered.source).toBe(url);
      expect(registered.loadedMesh).toBeDefined();
      expect(registered.surface).toBeDefined();
      expect(registered.id).toBeDefined();
    });

    it('loads a mesh from File object', async () => {
      const registry = CustomMeshRegistry.getInstance();
      const file = new File(['mock content'], 'test-1000tris.glb', { type: 'model/gltf-binary' });
      const registered = await registry.load(file);

      expect(registered).toBeDefined();
      expect(registered.name).toBe('test-1000tris');
      expect(registered.source).toBe('test-1000tris.glb');
      expect(registered.loadedMesh.triangleCount).toBe(1000);
    });

    it('returns cached mesh if already loaded', async () => {
      const registry = CustomMeshRegistry.getInstance();
      const url = `https://example.com/cached${testCounter}.obj`;

      const first = await registry.load(url);
      const second = await registry.load(url);

      expect(first.id).toBe(second.id);
      expect(first.surface).toBe(second.surface); // Same instance
    });

    it('uses default name from filename if not provided', async () => {
      const registry = CustomMeshRegistry.getInstance();
      const url = `https://example.com/path/to/dragon${testCounter}.glb`;
      const registered = await registry.load(url);

      expect(registered.name).toBe(`dragon${testCounter}`);
    });

    it('strips file extension from name', async () => {
      const registry = CustomMeshRegistry.getInstance();
      const file = new File(['mock'], 'bunny.obj', { type: 'model/obj' });
      const registered = await registry.load(file);

      expect(registered.name).toBe('bunny');
    });
  });

  describe('get', () => {
    it('retrieves a mesh by ID', async () => {
      const registry = CustomMeshRegistry.getInstance();
      const url = `https://example.com/model${testCounter}.obj`;
      const registered = await registry.load(url);

      const retrieved = registry.get(registered.id);
      expect(retrieved).toBe(registered);
    });

    it('returns undefined for non-existent ID', () => {
      const registry = CustomMeshRegistry.getInstance();
      const retrieved = registry.get('non-existent-id');
      expect(retrieved).toBeUndefined();
    });

    it('updates lastUsed timestamp on get', async () => {
      const registry = CustomMeshRegistry.getInstance();
      const url = `https://example.com/model${testCounter}.obj`;
      const registered = await registry.load(url);

      const firstTime = registered.lastUsed;
      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));
      registry.get(registered.id);

      expect(registered.lastUsed).toBeGreaterThan(firstTime);
    });
  });

  describe('getAll', () => {
    it('returns empty array when no meshes loaded', () => {
      const registry = CustomMeshRegistry.getInstance();
      expect(registry.getAll()).toEqual([]);
    });

    it('returns all loaded meshes', async () => {
      const registry = CustomMeshRegistry.getInstance();
      await registry.load(`mesh-alpha-${testCounter}.obj`);
      await registry.load(`mesh-beta-${testCounter}.obj`);
      await registry.load(`mesh-gamma-${testCounter}.obj`);

      const all = registry.getAll();
      expect(all).toHaveLength(3);
    });

    it('sorts meshes by most recently used', async () => {
      const registry = CustomMeshRegistry.getInstance();
      const mesh1 = await registry.load(`mesh-one-${testCounter}.obj`, 'Mesh1');
      const mesh2 = await registry.load(`mesh-two-${testCounter}.obj`, 'Mesh2');
      const mesh3 = await registry.load(`mesh-three-${testCounter}.obj`, 'Mesh3');

      // Access mesh1 to make it most recently used
      await new Promise((resolve) => setTimeout(resolve, 10));
      registry.get(mesh1.id);

      const all = registry.getAll();
      expect(all[0].name).toBe('Mesh1'); // Most recent
      expect(all[1].name).toBe('Mesh3');
      expect(all[2].name).toBe('Mesh2');
    });
  });

  describe('remove', () => {
    it('removes a mesh and disposes it', async () => {
      const registry = CustomMeshRegistry.getInstance();
      const url = `https://example.com/model${testCounter}.obj`;
      const registered = await registry.load(url);

      // Spy on dispose method
      const disposeSpy = vi.spyOn(registered.surface, 'dispose');

      registry.remove(registered.id);

      expect(disposeSpy).toHaveBeenCalled();
      expect(registry.get(registered.id)).toBeUndefined();
    });

    it('does nothing if mesh does not exist', () => {
      const registry = CustomMeshRegistry.getInstance();
      // Should not throw
      registry.remove('non-existent-id');
    });
  });

  describe('clear', () => {
    it('removes all meshes and disposes them', async () => {
      const registry = CustomMeshRegistry.getInstance();
      const mesh1 = await registry.load(`https://example.com/model${testCounter}-1.obj`);
      const mesh2 = await registry.load(`https://example.com/model${testCounter}-2.obj`);

      const spy1 = vi.spyOn(mesh1.surface, 'dispose');
      const spy2 = vi.spyOn(mesh2.surface, 'dispose');

      registry.clear();

      expect(spy1).toHaveBeenCalled();
      expect(spy2).toHaveBeenCalled();
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest meshes when limit exceeded', async () => {
      const registry = CustomMeshRegistry.getInstance();

      // Load 15 meshes (limit is 10)
      const meshes = [];
      for (let i = 0; i < 15; i++) {
        // Put unique part at the START to avoid ID collisions
        const url = `${i}-mesh-lru-test-${testCounter}.obj`;
        const mesh = await registry.load(url, `Mesh${i}`);
        meshes.push(mesh);
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const remaining = registry.getAll();
      expect(remaining).toHaveLength(10);

      // The first 5 meshes should be evicted (oldest)
      for (let i = 0; i < 5; i++) {
        expect(registry.get(meshes[i].id)).toBeUndefined();
      }

      // The last 10 meshes should remain
      for (let i = 5; i < 15; i++) {
        expect(registry.get(meshes[i].id)).toBeDefined();
      }
    });

    it('does not evict recently accessed meshes', async () => {
      const registry = CustomMeshRegistry.getInstance();

      // Load 10 meshes
      const meshes = [];
      for (let i = 0; i < 10; i++) {
        const url = `${i}-mesh-lru2-test-${testCounter}.obj`;
        const mesh = await registry.load(url, `Mesh${i}`);
        meshes.push(mesh);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      // Access the first mesh to make it most recently used
      await new Promise((resolve) => setTimeout(resolve, 10));
      registry.get(meshes[0].id);

      // Load one more mesh (should evict mesh1, not mesh0)
      await new Promise((resolve) => setTimeout(resolve, 10));
      await registry.load(`new-mesh-lru2-test-${testCounter}.obj`, 'New Mesh');

      expect(registry.get(meshes[0].id)).toBeDefined(); // Not evicted (recently accessed)
      expect(registry.get(meshes[1].id)).toBeUndefined(); // Evicted (oldest)
    });
  });
});
