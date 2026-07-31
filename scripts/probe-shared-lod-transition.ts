import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { BaseEnemy } from '../src/entities/enemies/BaseEnemy';
import { EnemyInstanceManager } from '../src/rendering/EnemyInstanceManager';
import { LODLevel } from '../src/rendering/LODManager';

class ProbeGrunt extends BaseEnemy {
  constructor(u = 0.5, v = 0.5) {
    super(u, v, 2, 10, 2, 0.2, 0.3);
    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();
    const bodyGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.2, 5, 1);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x4444ff,
      emissive: new THREE.Color(0x4444ff),
      emissiveIntensity: 0.4,
      metalness: 0.3,
      roughness: 0.4,
    });
    group.add(new THREE.Mesh(bodyGeometry, bodyMaterial));
    this.mesh = group;
  }

  updateBehavior(_dt: number, _playerU: number, _playerV: number): void {
    // Deterministic probe enemy; movement is driven by explicit mesh transforms.
  }
}

Object.defineProperty(ProbeGrunt, 'name', { value: 'Grunt' });

type ProbeBatch = {
  enemyToIndex: Map<BaseEnemy, number>;
  indexToEnemy: Array<BaseEnemy | null>;
  usedCount: number;
  highWaterMark: number;
  instancedMesh: THREE.InstancedMesh;
  opacityAttribute: THREE.InstancedBufferAttribute;
  minBrightness: Float32Array;
};

type BatchSnapshot = {
  registered: boolean;
  slot: number | null;
  reverseMatches: boolean | null;
  usedCount: number;
  highWaterMark: number;
  drawCount: number;
  scale: [number, number, number] | null;
  opacity: number | null;
  minBrightness: number | null;
  color: [number, number, number] | null;
};

type StepSnapshot = {
  placement: string | null;
  medium: BatchSnapshot;
  low: BatchSnapshot;
  lodStats: { mediumCount: number; lowCount: number };
  inLODBatch: boolean;
  managed: boolean;
};

const matrix = new THREE.Matrix4();
const scale = new THREE.Vector3();
const color = new THREE.Color();

function getBatch(manager: EnemyInstanceManager, key: 'lodMediumBatch' | 'lodLowBatch'): ProbeBatch {
  const batch = (manager as any)[key] as ProbeBatch | null;
  if (!batch) throw new Error(`${key} was not created`);
  return batch;
}

function batchSnapshot(
  batch: ProbeBatch,
  enemy: BaseEnemy,
  retiredSlot: number | null = null,
): BatchSnapshot {
  const mappedSlot = batch.enemyToIndex.get(enemy);
  const slot = mappedSlot ?? retiredSlot;
  const registered = mappedSlot !== undefined;
  if (slot === undefined || slot === null) {
    return {
      registered,
      slot: null,
      reverseMatches: null,
      usedCount: batch.usedCount,
      highWaterMark: batch.highWaterMark,
      drawCount: batch.instancedMesh.count,
      scale: null,
      opacity: null,
      minBrightness: null,
      color: null,
    };
  }

  batch.instancedMesh.getMatrixAt(slot, matrix);
  scale.setFromMatrixScale(matrix);
  batch.instancedMesh.getColorAt(slot, color);
  return {
    registered,
    slot,
    reverseMatches: batch.indexToEnemy[slot] === enemy,
    usedCount: batch.usedCount,
    highWaterMark: batch.highWaterMark,
    drawCount: batch.instancedMesh.count,
    scale: [scale.x, scale.y, scale.z],
    opacity: batch.opacityAttribute.getX(slot),
    minBrightness: batch.minBrightness[slot],
    color: [color.r, color.g, color.b],
  };
}

function snapshot(
  manager: EnemyInstanceManager,
  enemy: BaseEnemy,
  retired: { mediumSlot?: number; lowSlot?: number } = {},
): StepSnapshot {
  const placement = (manager as any).enemyLODPlacement.get(enemy) as LODLevel | undefined;
  return {
    placement: placement === undefined ? null : LODLevel[placement],
    medium: batchSnapshot(getBatch(manager, 'lodMediumBatch'), enemy, retired.mediumSlot ?? null),
    low: batchSnapshot(getBatch(manager, 'lodLowBatch'), enemy, retired.lowSlot ?? null),
    lodStats: manager.getLODStats(),
    inLODBatch: manager.isInLODBatch(enemy),
    managed: manager.isManaged(enemy),
  };
}

function setup(): {
  manager: EnemyInstanceManager;
  camera: THREE.PerspectiveCamera;
  enemy: ProbeGrunt;
  lodAssignments: Map<BaseEnemy, LODLevel>;
} {
  const scene = new THREE.Scene();
  const manager = new EnemyInstanceManager(scene, 50);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, 15);
  camera.updateMatrixWorld(true);
  const enemy = new ProbeGrunt();
  manager.register(enemy);
  enemy.mesh!.position.set(1, 0, 0);
  enemy.mesh!.updateMatrixWorld(true);
  return { manager, camera, enemy, lodAssignments: new Map<BaseEnemy, LODLevel>() };
}

function applyLOD(
  manager: EnemyInstanceManager,
  camera: THREE.PerspectiveCamera,
  enemy: ProbeGrunt,
  lodAssignments: Map<BaseEnemy, LODLevel>,
  lodLevel: LODLevel,
  x: number,
): void {
  lodAssignments.set(enemy, lodLevel);
  enemy.mesh!.position.set(x, 0, 0);
  enemy.mesh!.updateMatrixWorld(true);
  manager.updateInstancesWithLOD([enemy], lodAssignments, camera);
  if (lodLevel !== LODLevel.HIGH) {
    manager.setLODInstanceVisibility(enemy, 0.6, 0.2);
  }
  manager.ensureMinimumVisibility();
  manager.flushColors();
}

function isZeroScale(snapshot: BatchSnapshot): boolean {
  return !!snapshot.scale && snapshot.scale.every(value => Math.abs(value) < 1e-8);
}

function isRetired(snapshot: BatchSnapshot): boolean {
  return snapshot.registered === false
    && snapshot.reverseMatches === false
    && snapshot.usedCount === 0
    && snapshot.highWaterMark === -1
    && snapshot.drawCount === 0
    && isZeroScale(snapshot)
    && snapshot.opacity === 0
    && snapshot.minBrightness === 0
    && !!snapshot.color
    && snapshot.color.every(value => Math.abs(value) < 1e-8);
}

function exactlyOneOwner(step: StepSnapshot, owner: 'medium' | 'low'): boolean {
  const owned = step[owner];
  const other = owner === 'medium' ? step.low : step.medium;
  return step.placement === owner.toUpperCase()
    && step.inLODBatch
    && step.managed
    && owned.registered
    && owned.reverseMatches === true
    && owned.usedCount === 1
    && other.registered === false
    && other.usedCount === 0;
}

function runProbe(): {
  pass: boolean;
  failures: string[];
  sequences: Record<string, Record<string, StepSnapshot>>;
} {
  const failures: string[] = [];
  const sequences: Record<string, Record<string, StepSnapshot>> = {};

  {
    const { manager, camera, enemy, lodAssignments } = setup();
    applyLOD(manager, camera, enemy, lodAssignments, LODLevel.MEDIUM, 1);
    const mediumSlot = getBatch(manager, 'lodMediumBatch').enemyToIndex.get(enemy)!;
    const afterMedium = snapshot(manager, enemy);

    applyLOD(manager, camera, enemy, lodAssignments, LODLevel.LOW, 2);
    const lowSlot = getBatch(manager, 'lodLowBatch').enemyToIndex.get(enemy)!;
    const afterLow = snapshot(manager, enemy, { mediumSlot });

    applyLOD(manager, camera, enemy, lodAssignments, LODLevel.HIGH, 3);
    const afterHigh = snapshot(manager, enemy, { mediumSlot, lowSlot });

    sequences.mediumLowHigh = { afterMedium, afterLow, afterHigh };
    if (!exactlyOneOwner(afterMedium, 'medium')) failures.push('MEDIUM start did not have exactly one owner');
    if (!exactlyOneOwner(afterLow, 'low')) failures.push('MEDIUM -> LOW did not have exactly one owner');
    if (!isRetired(afterLow.medium)) failures.push('MEDIUM slot was not retired after MEDIUM -> LOW');
    if (afterHigh.inLODBatch || afterHigh.lodStats.mediumCount !== 0 || afterHigh.lodStats.lowCount !== 0) {
      failures.push('HIGH transition left a shared LOD placement');
    }
    if (!isRetired(afterHigh.low)) failures.push('LOW slot was not retired after LOW -> HIGH');
  }

  {
    const { manager, camera, enemy, lodAssignments } = setup();
    applyLOD(manager, camera, enemy, lodAssignments, LODLevel.LOW, 1);
    const lowSlot = getBatch(manager, 'lodLowBatch').enemyToIndex.get(enemy)!;
    const afterLowStart = snapshot(manager, enemy);

    applyLOD(manager, camera, enemy, lodAssignments, LODLevel.MEDIUM, 2);
    const mediumSlot = getBatch(manager, 'lodMediumBatch').enemyToIndex.get(enemy)!;
    const afterMedium = snapshot(manager, enemy, { lowSlot });

    manager.unregister(enemy);
    manager.ensureMinimumVisibility();
    manager.flushColors();
    const afterUnregister = snapshot(manager, enemy, { mediumSlot, lowSlot });

    sequences.lowMediumUnregister = { afterLowStart, afterMedium, afterUnregister };
    if (!exactlyOneOwner(afterLowStart, 'low')) failures.push('LOW start did not have exactly one owner');
    if (!exactlyOneOwner(afterMedium, 'medium')) failures.push('LOW -> MEDIUM did not have exactly one owner');
    if (!isRetired(afterMedium.low)) failures.push('LOW slot was not retired after LOW -> MEDIUM');
    if (afterUnregister.managed || afterUnregister.inLODBatch) {
      failures.push('unregister left manager or LOD placement state');
    }
    if (!isRetired(afterUnregister.medium)) failures.push('MEDIUM slot was not retired after unregister');
    if (afterUnregister.lodStats.mediumCount !== 0 || afterUnregister.lodStats.lowCount !== 0) {
      failures.push('unregister did not return LOD counts to zero');
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    sequences,
  };
}

const result = {
  generatedAt: new Date().toISOString(),
  command: 'npx tsx scripts/probe-shared-lod-transition.ts',
  scope: 'deterministic shared EnemyInstanceManager LOD transition probe',
  livePathBoundary: 'No browser/server was started for this review-fix proof under the WARN resource guard. The probe exercises EnemyInstanceManager.updateInstancesWithLOD(), ensureMinimumVisibility(), flushColors(), and unregister(), which are the shared rendering-manager calls used by src/main.ts and src/network-main.ts.',
  ...runProbe(),
};

const reportsDir = path.resolve('reports/sp-entity-performance');
await mkdir(reportsDir, { recursive: true });
const outputPath = path.join(
  reportsDir,
  `shared-lod-transition-review-fix-${result.generatedAt.replace(/[:.]/g, '-')}.json`,
);
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(outputPath);

if (!result.pass) {
  console.error(result.failures.join('\n'));
  process.exit(1);
}
