import * as THREE from 'three';
import type { BaseEnemy } from '../entities/enemies/BaseEnemy';
import type { EnemyInstanceManager } from '../rendering/EnemyInstanceManager';
import type { LODManager } from '../rendering/LODManager';

export interface EnemyBodyProofEntry {
  id: string;
  enemy: BaseEnemy;
}

export interface EnemyBodyProofDebugOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  enemyInstanceManager: EnemyInstanceManager;
  lodManager?: LODManager;
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
  forceLowLOD: () => Record<string, unknown>;
  sampleEnemyRenderAfterCameraOffset: (
    x?: number,
    y?: number,
    z?: number,
  ) => Record<string, unknown>;
  runAlignedPlayerLayeringProof: () => Record<string, unknown>;
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
    const renderQuaternion = new THREE.Quaternion();
    const enemyQuaternion = new THREE.Quaternion();
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
          matrix.decompose(renderPos, renderQuaternion, renderScale);
          matrixFound = true;
        }
      } else if (enemy.mesh) {
        enemy.mesh.updateWorldMatrix(false, false);
        enemy.mesh.matrixWorld.decompose(renderPos, renderQuaternion, renderScale);
        batchVisible = enemy.mesh.visible;
        matrixFound = true;
        geometryType = enemy.mesh.type;
        const materials = new Set<THREE.Material>();
        enemy.mesh.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
          childMaterials.filter(Boolean).forEach((material) => materials.add(material));
        });
        if (materials.size > 0) {
          const values = [...materials];
          opacity = Math.min(...values.map((material) => material.opacity));
          depthTest = values.every((material) => material.depthTest);
          depthWrite = values.every((material) => material.depthWrite);
          renderOrder = enemy.mesh.renderOrder;
          const brightness = values.map((material) => {
            const meshMaterial = material as THREE.MeshStandardMaterial;
            const source = meshMaterial.emissive ?? meshMaterial.color;
            return source ? (source.r + source.g + source.b) / 3 : 1;
          });
          colorBrightness = brightness.reduce((sum, value) => sum + value, 0) / brightness.length;
        }
      }

      enemy.mesh?.updateWorldMatrix(false, false);
      if (enemy.mesh) enemy.mesh.matrixWorld.decompose(new THREE.Vector3(), enemyQuaternion, new THREE.Vector3());
      const orientationDotToEnemy = matrixFound
        ? Math.abs(renderQuaternion.dot(enemyQuaternion))
        : null;

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
        instanceQuaternion: {
          x: renderQuaternion.x,
          y: renderQuaternion.y,
          z: renderQuaternion.z,
          w: renderQuaternion.w,
        },
        enemyWorldQuaternion: {
          x: enemyQuaternion.x,
          y: enemyQuaternion.y,
          z: enemyQuaternion.z,
          w: enemyQuaternion.w,
        },
        orientationDotToEnemy,
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

  const forceLowLOD = () => {
    if (!options.lodManager) return { ok: false, reason: 'LODManager unavailable' };
    options.lodManager.setConfig({ highDistance: -1, mediumDistance: -1, hysteresis: 0 });
    return { ok: true, forcedLevel: 'LOW' };
  };

  const sampleEnemyRenderAfterCameraOffset = (x = 2, y = 1, z = 0) => {
    if (!options.lodManager) return { ok: false, reason: 'LODManager unavailable' };
    const enemies = options.getEnemies().map(({ enemy }) => enemy);
    const originalPosition = options.camera.position.clone();
    const cameraBefore = originalPosition.toArray();
    const before = getEnemyRenderSamples();

    options.camera.position.add(new THREE.Vector3(x, y, z));
    options.camera.updateMatrixWorld(true);
    const assignments = options.lodManager.update(options.camera, enemies);
    options.enemyInstanceManager.updateInstancesWithLOD(enemies, assignments, options.camera);
    options.renderer.render(options.scene, options.camera);
    const during = getEnemyRenderSamples();
    const cameraDuring = options.camera.position.toArray();

    options.camera.position.copy(originalPosition);
    options.camera.updateMatrixWorld(true);
    const restoredAssignments = options.lodManager.update(options.camera, enemies);
    options.enemyInstanceManager.updateInstancesWithLOD(enemies, restoredAssignments, options.camera);
    options.renderer.render(options.scene, options.camera);

    return { ok: true, cameraBefore, cameraDuring, before, during };
  };

  const runAlignedPlayerLayeringProof = () => {
    const playerRoot = options.getPlayerRoot?.();
    if (!playerRoot) return { ok: false, reason: 'player root unavailable' };

    const mgr = options.enemyInstanceManager as any;
    const blocked = options.getEnemies().find(({ enemy }) => {
      const className = (enemy as any).__surfaceVisibility?.className;
      return enemy.active && enemy.alive && enemy.isInstanced
        && (className === 'edge-blocked' || className === 'long-path');
    });
    if (!blocked) return { ok: false, reason: 'no blocked instanced enemy available' };

    const enemy = blocked.enemy;
    const instanceType = (enemy as any)._instanceType as string | undefined;
    const highIndex = (enemy as any)._instanceIndex as number | undefined;
    const lodPlacement = mgr.enemyLODPlacement?.get(enemy);
    const lodBatch = lodPlacement === 1 ? mgr.lodMediumBatch
      : lodPlacement === 2 ? mgr.lodLowBatch
        : null;
    const lodIndex = lodBatch?.enemyToIndex?.get(enemy);
    const batch = lodBatch && lodIndex !== undefined ? lodBatch : mgr.batches?.get(instanceType);
    const selectedIndex = lodBatch && lodIndex !== undefined ? lodIndex : highIndex;
    if (!batch?.instancedMesh || selectedIndex === undefined) {
      return { ok: false, reason: 'blocked enemy batch unavailable', enemyId: blocked.id };
    }

    const canvas = options.renderer.domElement;
    const width = canvas.width;
    const height = canvas.height;
    const sceneVisibility = options.scene.children.map((object) => ({ object, visible: object.visible }));
    const playerVisible = playerRoot.visible;
    const batchVisible = batch.instancedMesh.visible;
    const batchCount = batch.instancedMesh.count;
    const savedMatrices: THREE.Matrix4[] = [];
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < batchCount; i++) {
      batch.instancedMesh.getMatrixAt(i, matrix);
      savedMatrices.push(matrix.clone());
    }

    const selectedMatrix = savedMatrices[selectedIndex]?.clone();
    if (!selectedMatrix) return { ok: false, reason: 'blocked enemy matrix unavailable', enemyId: blocked.id };
    const selectedPosition = new THREE.Vector3();
    const selectedQuaternion = new THREE.Quaternion();
    const selectedScale = new THREE.Vector3();
    selectedMatrix.decompose(selectedPosition, selectedQuaternion, selectedScale);

    const cameraPosition = new THREE.Vector3();
    const playerPosition = new THREE.Vector3();
    options.camera.getWorldPosition(cameraPosition);
    playerRoot.getWorldPosition(playerPosition);
    let alignedPlayerMesh: THREE.Mesh | null = null;
    let alignedPlayerRadius = -1;
    playerRoot.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.visible) return;
      child.geometry.computeBoundingSphere();
      const radius = child.geometry.boundingSphere?.radius ?? 0;
      if (radius > alignedPlayerRadius) {
        alignedPlayerMesh = child;
        alignedPlayerRadius = radius;
      }
    });
    if (alignedPlayerMesh) {
      const mesh = alignedPlayerMesh as THREE.Mesh;
      const localCenter = mesh.geometry.boundingSphere?.center.clone() ?? new THREE.Vector3();
      mesh.localToWorld(localCenter);
      playerPosition.copy(localCenter);
    }
    const cameraToPlayer = playerPosition.clone().sub(cameraPosition).normalize();
    const alignedPosition = playerPosition.clone().addScaledVector(cameraToPlayer, 2);
    const alignedMatrix = new THREE.Matrix4().compose(alignedPosition, selectedQuaternion, selectedScale);
    const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

    const playerProjection = playerPosition.clone().project(options.camera);
    const centerX = Math.round((playerProjection.x * 0.5 + 0.5) * width);
    const centerY = Math.round((-playerProjection.y * 0.5 + 0.5) * height);
    const cropSize = 96;
    const cropX = Math.max(0, Math.min(width - cropSize, centerX - cropSize / 2));
    const cropY = Math.max(0, Math.min(height - cropSize, centerY - cropSize / 2));

    const capture = () => {
      options.renderer.render(options.scene, options.camera);
      const copy = document.createElement('canvas');
      copy.width = width;
      copy.height = height;
      const context = copy.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(canvas, 0, 0);
      return {
        pixels: context.getImageData(cropX, cropY, cropSize, cropSize).data,
        dataUrl: copy.toDataURL('image/png'),
      };
    };

    const playerMaterials = new Set<THREE.Material>();
    playerRoot.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.filter(Boolean).forEach((material) => playerMaterials.add(material));
    });

    const showSelected = (visible: boolean) => {
      for (let i = 0; i < batchCount; i++) batch.instancedMesh.setMatrixAt(i, hiddenMatrix);
      if (visible) batch.instancedMesh.setMatrixAt(selectedIndex, alignedMatrix);
      batch.instancedMesh.instanceMatrix.needsUpdate = true;
    };

    try {
      for (const entry of sceneVisibility) {
        const containsPlayer = entry.object === playerRoot || entry.object.getObjectById(playerRoot.id) !== undefined;
        entry.object.visible = entry.object instanceof THREE.Light
          || entry.object === batch.instancedMesh
          || containsPlayer;
      }
      batch.instancedMesh.visible = true;

      playerRoot.visible = false;
      showSelected(false);
      const background = capture();

      playerRoot.visible = true;
      const baseline = capture();

      playerRoot.visible = false;
      showSelected(true);
      const enemyOnly = capture();

      playerRoot.visible = true;
      const layered = capture();

      let playerPixels = 0;
      let overlapPixels = 0;
      let preservedPixels = 0;
      let playerPresentPixels = 0;
      let playerDominantPixels = 0;
      let maxLayerDelta = 0;
      for (let i = 0; i < baseline.pixels.length; i += 4) {
        const playerDelta = Math.max(
          Math.abs(baseline.pixels[i] - background.pixels[i]),
          Math.abs(baseline.pixels[i + 1] - background.pixels[i + 1]),
          Math.abs(baseline.pixels[i + 2] - background.pixels[i + 2]),
        );
        if (playerDelta <= 12) continue;
        playerPixels++;
        const enemyDelta = Math.max(
          Math.abs(enemyOnly.pixels[i] - background.pixels[i]),
          Math.abs(enemyOnly.pixels[i + 1] - background.pixels[i + 1]),
          Math.abs(enemyOnly.pixels[i + 2] - background.pixels[i + 2]),
        );
        if (enemyDelta <= 12) continue;
        overlapPixels++;
        const layerDelta = Math.max(
          Math.abs(layered.pixels[i] - baseline.pixels[i]),
          Math.abs(layered.pixels[i + 1] - baseline.pixels[i + 1]),
          Math.abs(layered.pixels[i + 2] - baseline.pixels[i + 2]),
        );
        maxLayerDelta = Math.max(maxLayerDelta, layerDelta);
        if (layerDelta <= 3) preservedPixels++;
        const playerStrength = Math.hypot(
          baseline.pixels[i] - background.pixels[i],
          baseline.pixels[i + 1] - background.pixels[i + 1],
          baseline.pixels[i + 2] - background.pixels[i + 2],
        );
        const layeredToEnemy = Math.hypot(
          layered.pixels[i] - enemyOnly.pixels[i],
          layered.pixels[i + 1] - enemyOnly.pixels[i + 1],
          layered.pixels[i + 2] - enemyOnly.pixels[i + 2],
        );
        const layeredToBaseline = Math.hypot(
          layered.pixels[i] - baseline.pixels[i],
          layered.pixels[i + 1] - baseline.pixels[i + 1],
          layered.pixels[i + 2] - baseline.pixels[i + 2],
        );
        if (layeredToEnemy >= Math.max(6, playerStrength * 0.5)) playerPresentPixels++;
        if (layeredToBaseline <= layeredToEnemy) playerDominantPixels++;
      }
      const preservedRatio = overlapPixels > 0 ? preservedPixels / overlapPixels : 0;
      const playerPresentRatio = overlapPixels > 0 ? playerPresentPixels / overlapPixels : 0;
      const playerDominantRatio = overlapPixels > 0 ? playerDominantPixels / overlapPixels : 0;
      return {
        ok: playerPixels >= 8
          && overlapPixels >= 8
          && preservedPixels >= 8
          && playerPresentPixels >= 20
          && playerDominantPixels >= 20,
        enemyId: blocked.id,
        enemyType: enemy.baseTypeName || enemy.constructor.name,
        alignedPlayerMesh: alignedPlayerMesh?.name || alignedPlayerMesh?.type || null,
        alignedPlayerRadius,
        visibilityClass: (enemy as any).__surfaceVisibility?.className ?? null,
        resolverVisibility: (enemy as any).__surfaceVisibility?.visibility ?? null,
        playerMaterialCount: playerMaterials.size,
        playerDepthTest: [...playerMaterials].every((material) => material.depthTest),
        playerDepthWrite: [...playerMaterials].every((material) => material.depthWrite),
        playerPixels,
        overlapPixels,
        preservedPixels,
        preservedRatio,
        playerPresentPixels,
        playerPresentRatio,
        playerDominantPixels,
        playerDominantRatio,
        maxLayerDelta,
        crop: { x: cropX, y: cropY, width: cropSize, height: cropSize },
        backgroundDataUrl: background.dataUrl,
        baselineDataUrl: baseline.dataUrl,
        enemyOnlyDataUrl: enemyOnly.dataUrl,
        layeredDataUrl: layered.dataUrl,
      };
    } finally {
      for (let i = 0; i < savedMatrices.length; i++) {
        batch.instancedMesh.setMatrixAt(i, savedMatrices[i]);
      }
      batch.instancedMesh.instanceMatrix.needsUpdate = true;
      batch.instancedMesh.count = batchCount;
      batch.instancedMesh.visible = batchVisible;
      playerRoot.visible = playerVisible;
      for (const entry of sceneVisibility) entry.object.visible = entry.visible;
      options.renderer.render(options.scene, options.camera);
    }
  };

  return {
    getEnemyRenderSamples,
    getEnemyInstanceDebug,
    setVisualProofIsolation,
    forceLowLOD,
    sampleEnemyRenderAfterCameraOffset,
    runAlignedPlayerLayeringProof,
  };
}
