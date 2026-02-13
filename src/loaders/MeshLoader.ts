/**
 * MeshLoader - Loads arbitrary 3D models (OBJ, GLB/GLTF) and extracts a single
 * walkable mesh suitable for the MeshSurface system.
 *
 * Handles:
 * - OBJ files (via OBJLoader)
 * - GLB/GLTF files (via GLTFLoader)
 * - Multi-mesh models (merges into single geometry)
 * - File objects (for drag-and-drop loading)
 * - URL strings (for remote/local loading)
 *
 * The output is always a single THREE.Mesh with merged geometry,
 * ready to pass to `new MeshSurface(mesh)`.
 */

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface LoadedMesh {
  /** The merged, walkable mesh */
  mesh: THREE.Mesh;
  /** Original bounding box dimensions */
  originalSize: THREE.Vector3;
  /** Scale factor applied to normalize size */
  scaleFactor: number;
  /** Number of triangles in the final geometry */
  triangleCount: number;
}

export type MeshFileType = 'obj' | 'glb' | 'gltf';

/**
 * Detect file type from URL or filename.
 */
function detectFileType(filename: string): MeshFileType | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.obj')) return 'obj';
  if (lower.endsWith('.glb')) return 'glb';
  if (lower.endsWith('.gltf')) return 'gltf';
  return null;
}

/**
 * Extract all mesh geometries from a Three.js object hierarchy.
 * Applies each mesh's world transform to the geometry so the merged
 * result is in a single coordinate space.
 */
function extractGeometries(root: THREE.Object3D): THREE.BufferGeometry[] {
  const geometries: THREE.BufferGeometry[] = [];

  root.updateMatrixWorld(true);

  root.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geo = child.geometry.clone();

      // Apply the mesh's world transform to the geometry
      geo.applyMatrix4(child.matrixWorld);

      // Ensure we have position attribute
      if (geo.attributes.position) {
        geometries.push(geo);
      }
    }
  });

  return geometries;
}

/**
 * Merge multiple geometries into a single geometry.
 * Strips all attributes except position and normal (index is rebuilt).
 */
function mergeAndClean(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geometries.length === 0) {
    throw new Error('No mesh geometry found in loaded model. The file may be empty or contain only lights/cameras (not geometry).');
  }

  if (geometries.length === 1) {
    const geo = geometries[0];
    geo.computeVertexNormals();
    return geo;
  }

  // Strip to position-only before merge to avoid attribute mismatch
  const stripped = geometries.map((geo) => {
    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', geo.attributes.position);

    // Copy index if present
    if (geo.index) {
      newGeo.setIndex(geo.index);
    }

    return newGeo;
  });

  const merged = mergeGeometries(stripped, false);
  if (!merged) {
    throw new Error('Failed to merge geometries. This usually indicates a corrupted model file. Try re-exporting from Blender or another 3D tool.');
  }

  merged.computeVertexNormals();
  return merged;
}

/**
 * Normalize a mesh to fit within a target radius, centered at origin.
 * Returns the scale factor applied.
 */
function normalizeSize(geometry: THREE.BufferGeometry, targetRadius: number): { scaleFactor: number; originalSize: THREE.Vector3 } {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;

  const size = new THREE.Vector3();
  box.getSize(size);
  const originalSize = size.clone();

  // Center the geometry
  const center = new THREE.Vector3();
  box.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);

  // Scale to fit target radius
  const maxDim = Math.max(size.x, size.y, size.z);
  const scaleFactor = (targetRadius * 2) / maxDim;
  geometry.scale(scaleFactor, scaleFactor, scaleFactor);

  return { scaleFactor, originalSize };
}

/**
 * Load a mesh from a URL string.
 *
 * @param url - URL to the model file (.obj, .glb, .gltf)
 * @param targetRadius - Desired radius to normalize the model to (default: 8)
 * @returns The loaded and processed mesh
 */
export async function loadMeshFromURL(url: string, targetRadius: number = 8): Promise<LoadedMesh> {
  const fileType = detectFileType(url);
  if (!fileType) {
    throw new Error(`Unsupported file type: ${url}. Use .obj, .glb, or .gltf`);
  }

  let root: THREE.Object3D;

  if (fileType === 'obj') {
    const loader = new OBJLoader();
    root = await loader.loadAsync(url);
  } else {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    root = gltf.scene;
  }

  return processLoadedObject(root, targetRadius);
}

/**
 * Load a mesh from a File object (e.g., from drag-and-drop or file input).
 *
 * @param file - The File object
 * @param targetRadius - Desired radius to normalize the model to (default: 8)
 * @returns The loaded and processed mesh
 */
export async function loadMeshFromFile(file: File, targetRadius: number = 8): Promise<LoadedMesh> {
  const fileType = detectFileType(file.name);
  if (!fileType) {
    throw new Error(`Unsupported file type: ${file.name}. Use .obj, .glb, or .gltf`);
  }

  if (fileType === 'obj') {
    const text = await file.text();
    const loader = new OBJLoader();
    const root = loader.parse(text);
    return processLoadedObject(root, targetRadius);
  } else {
    // GLB/GLTF: create an object URL and load from it
    const arrayBuffer = await file.arrayBuffer();
    const loader = new GLTFLoader();

    return new Promise<LoadedMesh>((resolve, reject) => {
      loader.parse(
        arrayBuffer,
        '',
        (gltf) => {
          try {
            resolve(processLoadedObject(gltf.scene, targetRadius));
          } catch (err) {
            reject(err);
          }
        },
        (error) => reject(error),
      );
    });
  }
}

/**
 * Process a loaded Three.js object into a single walkable mesh.
 */
function processLoadedObject(root: THREE.Object3D, targetRadius: number): LoadedMesh {
  // Extract all mesh geometries
  const geometries = extractGeometries(root);

  if (geometries.length === 0) {
    throw new Error('No mesh geometry found in loaded model. Ensure the file contains visible geometry (not hidden or empty layers).');
  }

  // Merge into single geometry
  const mergedGeo = mergeAndClean(geometries);

  // Normalize size
  const { scaleFactor, originalSize } = normalizeSize(mergedGeo, targetRadius);

  // Count triangles
  const triangleCount = mergedGeo.index
    ? mergedGeo.index.count / 3
    : (mergedGeo.attributes.position.count / 3);

  // Create the walkable mesh with a semi-transparent material (same as predefined shapes)
  const material = new THREE.MeshBasicMaterial({
    color: 0x110033,
    transparent: true,
    opacity: 0.15,
    side: THREE.FrontSide,
    depthWrite: true,
  });

  const mesh = new THREE.Mesh(mergedGeo, material);

  return {
    mesh,
    originalSize,
    scaleFactor,
    triangleCount,
  };
}
