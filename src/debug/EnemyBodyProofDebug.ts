import * as THREE from 'three';
import type { BaseEnemy } from '../entities/enemies/BaseEnemy';
import type { EnemyInstanceManager } from '../rendering/EnemyInstanceManager';

export interface EnemyBodyProofEntry {
  id: string;
  enemy: BaseEnemy;
}

export interface EnemyBodyProofDebugOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  enemyInstanceManager: EnemyInstanceManager;
  getEnemies: () => EnemyBodyProofEntry[];
  surfaceRoot?: THREE.Object3D | null;
  getSurfaceRoot?: () => THREE.Object3D | null;
  getPlayerRoot?: () => THREE.Object3D | null;
}

export interface EnemyBodyProofDebugAPI {
  getEnemyRenderSamples: () => Record<string, unknown>[];
  getEnemyInstanceDebug: () => Record<string, unknown>;
  setVisualProofIsolation: (
    enabled: boolean,
    includeSurface?: boolean,
    includeAuxiliary?: boolean,
  ) => Record<string, unknown>;
}

export function createEnemyBodyProofDebug(options: EnemyBodyProofDebugOptions): EnemyBodyProofDebugAPI {
  const visualProofHidden: Array<{ object: THREE.Object3D; visible: boolean }> = [];

  const collectEnemyVisualObjects = (includeAuxiliary: boolean = true) => {
    const allowed = new Set<THREE.Object3D>();
    const mgr = options.enemyInstanceManager as any;
    const batches = mgr.batches as Map<string, any> | undefined;
    batches?.forEach((batch) => {
      if (batch?.instancedMesh) allowed.add(batch.instancedMesh);
    });
    if (mgr.lodMediumBatch?.instancedMesh) allowed.add(mgr.lodMediumBatch.instancedMesh);
    if (mgr.lodLowBatch?.instancedMesh) allowed.add(mgr.lodLowBatch.instancedMesh);

    for (const { enemy } of options.getEnemies()) {
      if (enemy.mesh && !enemy.isInstanced) allowed.add(enemy.mesh);
      if (includeAuxiliary) {
        for (const aux of enemy.auxiliaryObjects) allowed.add(aux);
      }
    }
    return allowed;
  };

  const getEnemyRenderSamples = () => {
    const projection = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    const renderPos = new THREE.Vector3();
    const renderScale = new THREE.Vector3();
    const color = new THREE.Color();
    const size = new THREE.Vector2();
    options.camera.updateMatrixWorld();
    options.renderer.getSize(size);
    const viewportWidth = Math.max(1, window.innerWidth || size.x || 1);
    const viewportHeight = Math.max(1, window.innerHeight || size.y || 1);
    const mgr = options.enemyInstanceManager as any;
    const samples: Record<string, unknown>[] = [];

    for (const { id, enemy } of options.getEnemies()) {
      if (!enemy.active || !enemy.alive) continue;
      const logicalPos = enemy.mesh ? enemy.mesh.position : enemy.position;
      renderPos.copy(logicalPos);
      renderScale.setScalar(1);
      let opacity = 1.0;
      let colorBrightness = 1.0;
      let renderBatch = enemy.isInstanced ? 'unknown-instanced' : 'mesh';
      let slot: number | null = null;
      let drawCount: number | null = null;
      let batchVisible: boolean | null = null;
      let matrixFound = false;
      let lodLevel = 'HIGH';
      let geometryType: string | null = null;
      let depthTest: boolean | null = null;
      let depthWrite: boolean | null = null;
      let renderOrder: number | null = null;

      const instanceIndex = (enemy as any)._instanceIndex as number | undefined;
      const instanceType = (enemy as any)._instanceType as string | undefined;
      if (instanceIndex !== undefined && instanceType) {
        const lodPlacement = mgr.enemyLODPlacement?.get(enemy);
        const lodBatch = lodPlacement === 1 ? mgr.lodMediumBatch
          : lodPlacement === 2 ? mgr.lodLowBatch
            : null;
        const lodSlot = lodBatch?.enemyToIndex?.get(enemy);
        const batch = lodBatch && lodSlot !== undefined
          ? lodBatch
          : mgr.batches?.get(instanceType);
        slot = lodBatch && lodSlot !== undefined ? lodSlot : instanceIndex;
        renderBatch = lodBatch && lodSlot !== undefined
          ? (lodPlacement === 1 ? 'lod-medium' : 'lod-low')
          : instanceType;
        lodLevel = lodBatch && lodSlot !== undefined
          ? (lodPlacement === 1 ? 'MEDIUM' : 'LOW')
          : 'HIGH';
        drawCount = batch?.instancedMesh?.count ?? null;
        batchVisible = batch?.instancedMesh?.visible ?? null;
        geometryType = batch?.geometry?.type ?? null;
        depthTest = batch?.material?.depthTest ?? null;
        depthWrite = batch?.material?.depthWrite ?? null;
        renderOrder = batch?.instancedMesh?.renderOrder ?? null;
        if (batch?.opacityAttribute && slot !== null) opacity = batch.opacityAttribute.getX(slot);
        if (batch?.instancedMesh?.instanceColor && slot !== null) {
          batch.instancedMesh.getColorAt(slot, color);
          colorBrightness = (color.r + color.g + color.b) / 3;
        }
        if (batch?.instancedMesh && slot !== null) {
          batch.instancedMesh.getMatrixAt(slot, matrix);
          renderPos.setFromMatrixPosition(matrix);
          renderScale.setFromMatrixScale(matrix);
          matrixFound = true;
        }
      } else if (enemy.mesh) {
        enemy.mesh.updateWorldMatrix(false, false);
        renderPos.setFromMatrixPosition(enemy.mesh.matrixWorld);
        renderScale.setFromMatrixScale(enemy.mesh.matrixWorld);
        batchVisible = enemy.mesh.visible;
        matrixFound = true;
        geometryType = enemy.mesh.type;
      }

      projection.copy(renderPos).project(options.camera);
      samples.push({
        id,
        type: enemy.baseTypeName || enemy.constructor.name,
        u: enemy.surfacePosition.u,
        v: enemy.surfacePosition.v,
        isAlive: enemy.alive,
        isMaterializing: enemy.isMaterializing,
        renderBatch,
        slot,
        drawCount,
        batchVisible,
        matrixFound,
        lodLevel,
        geometryType,
        depthTest,
        depthWrite,
        renderOrder,
        opacity,
        colorBrightness,
        instanceMatrixScale: Math.max(renderScale.x, renderScale.y, renderScale.z),
        instanceMatrixScaleXYZ: { x: renderScale.x, y: renderScale.y, z: renderScale.z },
        surfaceVisibility: (enemy as any).__surfaceVisibility ?? null,
        worldPos: { x: logicalPos.x, y: logicalPos.y, z: logicalPos.z },
        renderWorldPos: { x: renderPos.x, y: renderPos.y, z: renderPos.z },
        screen: {
          x: (projection.x * 0.5 + 0.5) * viewportWidth,
          y: (-projection.y * 0.5 + 0.5) * viewportHeight,
          ndcZ: projection.z,
          inView: projection.x >= -1 && projection.x <= 1
            && projection.y >= -1 && projection.y <= 1
            && projection.z >= -1 && projection.z <= 1,
        },
      });
    }

    return samples;
  };

  const getEnemyInstanceDebug = () => {
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    const summarizeBatch = (name: string, batch: any) => {
      if (!batch?.instancedMesh) return null;
      const samples: Record<string, unknown>[] = [];
      const indexToEnemy = batch.indexToEnemy || [];
      for (let i = 0; i < indexToEnemy.length && samples.length < 8; i++) {
        const enemy = indexToEnemy[i];
        if (!enemy) continue;
        batch.instancedMesh.getMatrixAt(i, matrix);
        matrix.decompose(pos, quat, scale);
        let colorBrightness = null;
        if (batch.instancedMesh.instanceColor) {
          batch.instancedMesh.getColorAt(i, color);
          colorBrightness = (color.r + color.g + color.b) / 3;
        }
        samples.push({
          index: i,
          type: enemy.baseTypeName || enemy.constructor?.name || name,
          alive: enemy.alive,
          materializing: enemy.isMaterializing,
          positionLen: pos.length(),
          scale: { x: scale.x, y: scale.y, z: scale.z },
          scaleMin: Math.min(scale.x, scale.y, scale.z),
          colorBrightness,
        });
      }
      return {
        name,
        visible: batch.instancedMesh.visible,
        renderOrder: batch.instancedMesh.renderOrder,
        count: batch.instancedMesh.count,
        highWaterMark: batch.highWaterMark,
        registered: batch.enemyToIndex?.size ?? null,
        activeCount: batch.activeCount ?? null,
        geometryType: batch.geometry?.type ?? null,
        depthTest: batch.material?.depthTest ?? null,
        depthWrite: batch.material?.depthWrite ?? null,
        samples,
      };
    };

    const mgr = options.enemyInstanceManager as any;
    const batches: Record<string, unknown>[] = [];
    (mgr.batches as Map<string, any> | undefined)?.forEach((batch, name) => {
      const summary = summarizeBatch(name, batch);
      if (summary) batches.push(summary);
    });
    const lodMedium = summarizeBatch('lod-medium', mgr.lodMediumBatch);
    const lodLow = summarizeBatch('lod-low', mgr.lodLowBatch);
    return {
      enemyCount: options.getEnemies().length,
      batches,
      lodBatches: [lodMedium, lodLow].filter(Boolean),
    };
  };

  const setVisualProofIsolation = (
    enabled: boolean,
    includeSurface: boolean = true,
    includeAuxiliary: boolean = true,
  ) => {
    if (!enabled) {
      while (visualProofHidden.length > 0) {
        const entry = visualProofHidden.pop()!;
        entry.object.visible = entry.visible;
      }
      return { enabled: false, hidden: 0, enemyInstanceDebug: getEnemyInstanceDebug() };
    }

    if (visualProofHidden.length > 0) {
      return { enabled: true, hidden: visualProofHidden.length, enemyInstanceDebug: getEnemyInstanceDebug() };
    }

    const allowedEnemies = collectEnemyVisualObjects(includeAuxiliary);
    const allowedRoots = new Set<THREE.Object3D>();
    if (includeSurface) {
      const surfaceRoot = options.getSurfaceRoot?.() ?? options.surfaceRoot;
      if (surfaceRoot) allowedRoots.add(surfaceRoot);
      const playerRoot = options.getPlayerRoot?.();
      if (playerRoot) allowedRoots.add(playerRoot);
    }
    allowedEnemies.forEach((object) => allowedRoots.add(object));

    for (const child of options.scene.children) {
      const isLight = child instanceof THREE.Light;
      if (isLight || allowedRoots.has(child)) continue;
      visualProofHidden.push({ object: child, visible: child.visible });
      child.visible = false;
    }

    return {
      enabled: true,
      includeSurface,
      includeAuxiliary,
      hidden: visualProofHidden.length,
      enemyInstanceDebug: getEnemyInstanceDebug(),
    };
  };

  return {
    getEnemyRenderSamples,
    getEnemyInstanceDebug,
    setVisualProofIsolation,
  };
}
