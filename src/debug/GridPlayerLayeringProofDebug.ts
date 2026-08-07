import * as THREE from 'three';
import type { Surface } from '../surfaces/Surface';

const MP_PLAYER_GRID_OCCLUDER_NAME = 'mp-player-grid-occluder';

export type GridPlayerLayeringIsolationMode = 'restore' | 'background' | 'player' | 'grid' | 'layered';

export interface GridPlayerLayeringProofDebugOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  getSurface: () => Surface | null;
  getPlayerRoot: () => THREE.Object3D | null;
  getSurfaceType: () => string;
  getVisualMode: () => string;
}

export interface GridPlayerLayeringProofDebugAPI {
  getGridPlayerLayeringState: () => Record<string, unknown>;
  setGridPlayerLayeringIsolation: (mode: GridPlayerLayeringIsolationMode) => Record<string, unknown>;
}

export function createGridPlayerLayeringProofDebug(
  options: GridPlayerLayeringProofDebugOptions,
): GridPlayerLayeringProofDebugAPI {
  const savedSceneVisibility: Array<{ object: THREE.Object3D; visible: boolean }> = [];
  let savedSurfaceMeshVisible: boolean | null = null;
  let savedGridVisible: boolean | null = null;
  let savedPlayerVisible: boolean | null = null;
  let activeMode: GridPlayerLayeringIsolationMode | null = null;

  const projectWorldPoint = (point: THREE.Vector3) => {
    const size = new THREE.Vector2();
    options.renderer.getSize(size);
    options.camera.updateMatrixWorld(true);
    const projected = point.clone().project(options.camera);
    return {
      x: (projected.x * 0.5 + 0.5) * Math.max(1, window.innerWidth || size.x),
      y: (-projected.y * 0.5 + 0.5) * Math.max(1, window.innerHeight || size.y),
      ndcZ: projected.z,
      inView: Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1
        && projected.z >= -1 && projected.z <= 1,
    };
  };

  const getPlayerMaterialState = (playerRoot: THREE.Object3D | null) => {
    const materials = new Set<THREE.Material>();
    playerRoot?.traverse((child) => {
      if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.LineSegments)) return;
      const material = (child as THREE.Mesh | THREE.LineSegments).material;
      const list = Array.isArray(material) ? material : [material];
      list.filter(Boolean).forEach((entry) => materials.add(entry));
    });
    for (const object of options.scene.children) {
      if (object.name !== MP_PLAYER_GRID_OCCLUDER_NAME || !(object instanceof THREE.Sprite)) continue;
      materials.add(object.material);
    }
    const values = [...materials];
    return {
      count: values.length,
      allDepthTest: values.length > 0 && values.every((material) => material.depthTest),
      allDepthWrite: values.length > 0 && values.every((material) => material.depthWrite),
      transparentCount: values.filter((material) => material.transparent).length,
    };
  };

  const getPlayerCenter = (playerRoot: THREE.Object3D | null) => {
    if (!playerRoot) return null;
    playerRoot.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(playerRoot);
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) {
      const position = new THREE.Vector3();
      playerRoot.getWorldPosition(position);
      return position;
    }
    return box.getCenter(new THREE.Vector3());
  };

  const getGridPlayerLayeringState = () => {
    const surface = options.getSurface();
    const playerRoot = options.getPlayerRoot();
    const gridMaterial = surface?.gridMesh.material as THREE.Material | undefined;
    const playerCenter = getPlayerCenter(playerRoot);
    const rendererSize = new THREE.Vector2();
    options.renderer.getSize(rendererSize);
    return {
      ok: Boolean(surface && playerRoot),
      activeIsolationMode: activeMode,
      visualMode: options.getVisualMode(),
      surfaceType: options.getSurfaceType(),
      renderer: {
        width: rendererSize.x,
        height: rendererSize.y,
        pixelRatio: options.renderer.getPixelRatio(),
      },
      surface: surface ? {
        meshVisible: surface.mesh.visible,
        meshRenderOrder: surface.mesh.renderOrder,
        meshDepthWrite: (surface.mesh.material as THREE.Material | undefined)?.depthWrite ?? null,
        gridVisible: surface.gridMesh.visible,
        gridRenderOrder: surface.gridMesh.renderOrder,
        gridDepthTest: gridMaterial?.depthTest ?? null,
        gridDepthWrite: gridMaterial?.depthWrite ?? null,
        gridTransparent: gridMaterial?.transparent ?? null,
        gridOpacity: gridMaterial?.opacity ?? null,
      } : null,
      player: {
        visible: playerRoot?.visible ?? null,
        occluderCount: options.scene.children.filter((object) => object.name === MP_PLAYER_GRID_OCCLUDER_NAME).length,
        materialState: getPlayerMaterialState(playerRoot),
        centerWorld: playerCenter?.toArray() ?? null,
        centerScreen: playerCenter ? projectWorldPoint(playerCenter) : null,
      },
    };
  };

  const restore = () => {
    while (savedSceneVisibility.length > 0) {
      const entry = savedSceneVisibility.pop()!;
      entry.object.visible = entry.visible;
    }
    const surface = options.getSurface();
    const playerRoot = options.getPlayerRoot();
    if (surface && savedSurfaceMeshVisible !== null) surface.mesh.visible = savedSurfaceMeshVisible;
    if (surface && savedGridVisible !== null) surface.gridMesh.visible = savedGridVisible;
    if (playerRoot && savedPlayerVisible !== null) playerRoot.visible = savedPlayerVisible;
    savedSurfaceMeshVisible = null;
    savedGridVisible = null;
    savedPlayerVisible = null;
    activeMode = null;
    options.renderer.render(options.scene, options.camera);
    return getGridPlayerLayeringState();
  };

  const setGridPlayerLayeringIsolation = (mode: GridPlayerLayeringIsolationMode) => {
    const surface = options.getSurface();
    const playerRoot = options.getPlayerRoot();
    if (!surface || !playerRoot) {
      return { ...getGridPlayerLayeringState(), ok: false, reason: 'surface or player unavailable' };
    }
    if (mode === 'restore') return restore();

    if (activeMode === null) {
      for (const object of options.scene.children) {
        savedSceneVisibility.push({ object, visible: object.visible });
      }
      playerRoot.traverse((object) => {
        if (object !== playerRoot) savedSceneVisibility.push({ object, visible: object.visible });
      });
      savedSurfaceMeshVisible = surface.mesh.visible;
      savedGridVisible = surface.gridMesh.visible;
      savedPlayerVisible = playerRoot.visible;
    }

    const allowedRoots = new Set<THREE.Object3D>([surface.group, playerRoot]);
    for (const object of options.scene.children) {
      object.visible = object instanceof THREE.Light
        || allowedRoots.has(object)
        || object.name === MP_PLAYER_GRID_OCCLUDER_NAME;
    }

    // Isolate the exact reported relation: surface grid line fragments versus player body pixels.
    surface.group.visible = true;
    surface.mesh.visible = false;
    surface.gridMesh.visible = mode === 'grid' || mode === 'layered';
    const showPlayer = mode === 'player' || mode === 'layered';
    playerRoot.visible = showPlayer;
    playerRoot.traverse((object) => {
      object.visible = showPlayer;
    });
    for (const object of options.scene.children) {
      if (object.name === MP_PLAYER_GRID_OCCLUDER_NAME) object.visible = showPlayer;
    }
    activeMode = mode;
    options.renderer.render(options.scene, options.camera);
    return getGridPlayerLayeringState();
  };

  return {
    getGridPlayerLayeringState,
    setGridPlayerLayeringIsolation,
  };
}
