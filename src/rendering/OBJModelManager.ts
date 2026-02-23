/**
 * OBJModelManager — Debug-only OBJ/GLTF model loading and animation system.
 *
 * Supports:
 *  - OBJ files (static geometry, no animations)
 *  - GLTF/GLB files (geometry + animations via THREE.AnimationMixer)
 *
 * Usage:
 *  const mgr = new OBJModelManager(renderer, scene);
 *  const result = await mgr.loadFromFile(file);
 *  mgr.applyToScene();
 *  mgr.update(deltaTime);
 *
 * This is a DEBUG/R&D module — not production-optimised.
 */

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelFormat = 'obj' | 'gltf' | 'glb' | 'unknown';

export interface LoadedModel {
  format: ModelFormat;
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  vertexCount: number;
  triangleCount: number;
  boundingBox: THREE.Box3;
  loadTimeMs: number;
}

export interface PerformanceSnapshot {
  fps: number;
  frameTimeMs: number;
  memoryGeometries: number;
  memoryTextures: number;
  vertexCount: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// OBJModelManager
// ---------------------------------------------------------------------------

export class OBJModelManager {
  private model: LoadedModel | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private sceneRef: THREE.Scene;
  private modelRoot: THREE.Object3D | null = null;

  // Performance tracking
  private lastFrameTime = 0;
  private frameCount = 0;
  private fpsAccum = 0;
  private currentFps = 0;
  private readonly perfHistory: PerformanceSnapshot[] = [];
  private readonly renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;
    this.sceneRef = scene;
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /** Load from a File object (user file picker). */
  async loadFromFile(file: File): Promise<LoadedModel> {
    const format = this.detectFormat(file.name);
    const url = URL.createObjectURL(file);
    try {
      return await this.loadFromURL(url, format, file.name);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Load from a URL (must allow CORS for cross-origin). */
  async loadFromURL(url: string, format?: ModelFormat, fileName?: string): Promise<LoadedModel> {
    const detectedFormat = format ?? this.detectFormat(url);
    const t0 = performance.now();

    let object: THREE.Object3D;
    let animations: THREE.AnimationClip[] = [];

    if (detectedFormat === 'obj') {
      object = await this.loadOBJ(url);
    } else if (detectedFormat === 'gltf' || detectedFormat === 'glb') {
      const result = await this.loadGLTF(url);
      object = result.scene;
      animations = result.animations;
    } else {
      throw new Error(`Unsupported format: ${fileName ?? url}. Use .obj, .gltf, or .glb`);
    }

    const loadTimeMs = performance.now() - t0;
    const { vertexCount, triangleCount } = this.countGeometry(object);
    const boundingBox = new THREE.Box3().setFromObject(object);

    this.model = {
      format: detectedFormat,
      object,
      animations,
      vertexCount,
      triangleCount,
      boundingBox,
      loadTimeMs,
    };

    return this.model;
  }

  private loadOBJ(url: string): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      const loader = new OBJLoader();
      loader.load(url, resolve, undefined, reject);
    });
  }

  private loadGLTF(url: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
        undefined,
        reject,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Scene integration
  // -------------------------------------------------------------------------

  /** Add the loaded model to the scene, removing any previous one. */
  applyToScene(position = new THREE.Vector3(0, 0, 0), scale = 1): THREE.Object3D {
    this.removeFromScene();
    if (!this.model) throw new Error('No model loaded');

    const obj = this.model.object.clone();

    // Normalise scale so the model fits in a 2-unit bounding box
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const normScale = maxDim > 0 ? (2 / maxDim) * scale : scale;
    obj.scale.setScalar(normScale);

    // Centre at origin
    box.setFromObject(obj);
    const centre = box.getCenter(new THREE.Vector3());
    obj.position.sub(centre).add(position);

    this.sceneRef.add(obj);
    this.modelRoot = obj;

    // Setup AnimationMixer if GLTF has animations
    if (this.model.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(obj);
    }

    return obj;
  }

  removeFromScene(): void {
    if (this.modelRoot) {
      this.sceneRef.remove(this.modelRoot);
      this.modelRoot = null;
    }
    this.mixer = null;
    this.currentAction = null;
  }

  // -------------------------------------------------------------------------
  // Animation
  // -------------------------------------------------------------------------

  getAnimationNames(): string[] {
    return this.model?.animations.map((a) => a.name) ?? [];
  }

  playAnimation(nameOrIndex: string | number): void {
    if (!this.mixer || !this.model || this.model.animations.length === 0) return;

    const clip =
      typeof nameOrIndex === 'number'
        ? this.model.animations[nameOrIndex]
        : THREE.AnimationClip.findByName(this.model.animations, nameOrIndex);

    if (!clip) return;

    this.currentAction?.stop();
    this.currentAction = this.mixer.clipAction(clip);
    this.currentAction.reset().play();
  }

  stopAnimation(): void {
    this.currentAction?.stop();
    this.currentAction = null;
  }

  /** Call this each frame with the delta time in seconds. */
  update(deltaSeconds: number): void {
    this.mixer?.update(deltaSeconds);
    this.trackPerformance();
  }

  // -------------------------------------------------------------------------
  // Geometry replacement helpers
  // -------------------------------------------------------------------------

  /**
   * Return the first BufferGeometry found inside the loaded model.
   * Use this to swap a game entity's geometry.
   */
  extractGeometry(): THREE.BufferGeometry | null {
    if (!this.model) return null;
    let geo: THREE.BufferGeometry | null = null;
    this.model.object.traverse((child) => {
      if (!geo && child instanceof THREE.Mesh) {
        geo = child.geometry;
      }
    });
    return geo;
  }

  /**
   * Clone the model and return it. Useful for attaching to a game entity.
   * Caller is responsible for adding to scene / cleanup.
   */
  cloneModel(): THREE.Object3D | null {
    if (!this.model) return null;
    return this.model.object.clone(true);
  }

  // -------------------------------------------------------------------------
  // Performance tracking
  // -------------------------------------------------------------------------

  private trackPerformance(): void {
    const now = performance.now();
    const frameTimeMs = now - this.lastFrameTime;
    this.lastFrameTime = now;
    this.frameCount++;
    this.fpsAccum += frameTimeMs > 0 ? 1000 / frameTimeMs : 60;

    // Average over 10 frames
    if (this.frameCount % 10 === 0) {
      this.currentFps = this.fpsAccum / 10;
      this.fpsAccum = 0;

      const info = this.renderer.info;
      const snap: PerformanceSnapshot = {
        fps: Math.round(this.currentFps),
        frameTimeMs: Math.round(frameTimeMs * 10) / 10,
        memoryGeometries: info.memory.geometries,
        memoryTextures: info.memory.textures,
        vertexCount: this.model?.vertexCount ?? 0,
        timestamp: now,
      };
      this.perfHistory.push(snap);
      // Keep last 60 snapshots
      if (this.perfHistory.length > 60) this.perfHistory.shift();
    }
  }

  getCurrentPerf(): PerformanceSnapshot | null {
    return this.perfHistory[this.perfHistory.length - 1] ?? null;
  }

  getPerfHistory(): readonly PerformanceSnapshot[] {
    return this.perfHistory;
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  getModel(): LoadedModel | null {
    return this.model;
  }

  private detectFormat(nameOrUrl: string): ModelFormat {
    const lower = nameOrUrl.toLowerCase();
    if (lower.endsWith('.obj')) return 'obj';
    if (lower.endsWith('.glb')) return 'glb';
    if (lower.endsWith('.gltf')) return 'gltf';
    return 'unknown';
  }

  private countGeometry(obj: THREE.Object3D): { vertexCount: number; triangleCount: number } {
    let vertices = 0;
    let triangles = 0;
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geo = child.geometry;
        vertices += geo.attributes.position?.count ?? 0;
        if (geo.index) {
          triangles += geo.index.count / 3;
        } else {
          triangles += (geo.attributes.position?.count ?? 0) / 3;
        }
      }
    });
    return { vertexCount: Math.round(vertices), triangleCount: Math.round(triangles) };
  }

  dispose(): void {
    this.removeFromScene();
    this.model = null;
  }
}
