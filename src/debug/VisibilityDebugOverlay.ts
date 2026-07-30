/**
 * VisibilityDebugOverlay — live enemy visibility stats displayed on screen.
 *
 * Activated by URL param `?debugVisibility=true`.
 * Works in both SP (via GameContext / EnemySpawner) and MP (via EnemyInstanceManager + enemy map).
 *
 * Reads enemy data directly from real game objects — no TestHarnessAPI dependency.
 * Updates every 500ms (throttled) to avoid DOM overhead in the hot path.
 * Zero allocation during updates (pre-allocated Color/Matrix4/Vector3 reuse).
 */

import * as THREE from 'three';

/** Threshold below which an enemy is considered "invisible" (matches test harness). */
const ICB_INVISIBLE_THRESHOLD = 0.10;

/** Threshold above which an enemy is considered "still materializing" for too long. */
const STUCK_MATERIALIZING_MS = 1000;

/** How often the overlay refreshes (ms). */
const UPDATE_INTERVAL_MS = 500;

// Pre-allocated to avoid per-update heap allocation
const _color = new THREE.Color();
const _matrix = new THREE.Matrix4();
const _scale = new THREE.Vector3();

interface EnemySample {
  id: string;
  icb: number;
}

/**
 * Reads visibility data from an enemy using EnemyInstanceManager.
 * Returns ICB (instance color brightness) and matrix scale.
 * Mirrors the logic in TestHarnessAPI.getEnemies().
 */
function readEnemyICB(enemy: any, enemyInstanceManager: any): { icb: number; matScale: number } {
  const instanceIndex = enemy._instanceIndex as number | undefined;
  const instanceType = enemy._instanceType as string | undefined;

  if (instanceIndex === undefined || !instanceType || !enemyInstanceManager) {
    return { icb: -1, matScale: -1 }; // -1 = NOT REGISTERED in any InstancedMesh
  }

  const mgr = enemyInstanceManager as any;
  const isInLOD = mgr.enemyLODPlacement?.has(enemy);
  const lodLevel = isInLOD ? mgr.enemyLODPlacement.get(enemy) : undefined;

  if (isInLOD) {
    const lodBatch = lodLevel === 1 ? mgr.lodMediumBatch : mgr.lodLowBatch;
    const lodSlot = lodBatch?.enemyToIndex?.get(enemy);
    if (lodSlot !== undefined && lodBatch) {
      let icb = 1.0;
      if (lodBatch.instancedMesh?.instanceColor) {
        lodBatch.instancedMesh.getColorAt(lodSlot, _color);
        icb = (_color.r + _color.g + _color.b) / 3;
      }
      let matScale = 1.0;
      if (lodBatch.instancedMesh) {
        lodBatch.instancedMesh.getMatrixAt(lodSlot, _matrix);
        _scale.setFromMatrixScale(_matrix);
        matScale = Math.max(_scale.x, _scale.y, _scale.z);
      }
      return { icb, matScale };
    }
  } else {
    const batch = mgr.batches?.get(instanceType);
    if (batch) {
      let icb = 1.0;
      if (batch.instancedMesh?.instanceColor) {
        batch.instancedMesh.getColorAt(instanceIndex, _color);
        icb = (_color.r + _color.g + _color.b) / 3;
      }
      let matScale = 1.0;
      if (batch.instancedMesh) {
        batch.instancedMesh.getMatrixAt(instanceIndex, _matrix);
        _scale.setFromMatrixScale(_matrix);
        matScale = Math.max(_scale.x, _scale.y, _scale.z);
      }
      return { icb, matScale };
    }
  }

  return { icb: 1.0, matScale: 1.0 };
}

export class VisibilityDebugOverlay {
  private readonly el: HTMLDivElement;
  private _lastUpdate = 0;
  private _disposed = false;

  // Deps injected at construction time
  private readonly getEnemies: () => any[];
  private readonly enemyInstanceManager: any;
  private readonly getWaveNumber: () => number;

  constructor(options: {
    /** Returns the live enemy list (active + inactive). */
    getEnemies: () => any[];
    /** EnemyInstanceManager instance for ICB/matrix reads. */
    enemyInstanceManager: any;
    /** Returns the current wave number (0 = before first wave). */
    getWaveNumber: () => number;
  }) {
    this.getEnemies = options.getEnemies;
    this.enemyInstanceManager = options.enemyInstanceManager;
    this.getWaveNumber = options.getWaveNumber;

    // Create the overlay DOM element
    const el = document.createElement('div');
    el.id = 'visibility-debug-overlay';
    el.style.cssText = [
      'position:fixed',
      'top:10px',
      'right:10px',
      'background:rgba(0,0,0,0.75)',
      'color:#00ff88',
      'font-family:monospace',
      'font-size:11px',
      'line-height:1.5',
      'padding:6px 10px',
      'border-radius:4px',
      'border:1px solid rgba(0,255,136,0.3)',
      'pointer-events:none',
      'z-index:9999',
      'min-width:200px',
      'white-space:pre',
    ].join(';');
    document.body.appendChild(el);
    this.el = el;
  }

  /**
   * Call this every render frame (or from the HUD throttle block).
   * Internally throttled to UPDATE_INTERVAL_MS — safe to call every frame.
   */
  update(): void {
    if (this._disposed) return;
    const now = performance.now();
    if (now - this._lastUpdate < UPDATE_INTERVAL_MS) return;
    this._lastUpdate = now;
    this._refresh(now);
  }

  private _refresh(now: number): void {
    const enemies = this.getEnemies();
    const wave = this.getWaveNumber();

    let totalAlive = 0;
    let invisibleCount = 0;
    let stuckMaterializingCount = 0;
    let zeroScaleCount = 0;
    let unregisteredCount = 0;
    let minICB = 1.0;
    const invisibleSamples: EnemySample[] = [];

    for (const enemy of enemies) {
      if (!enemy.active || !enemy.alive) continue;
      totalAlive++;

      const isMaterializing: boolean = enemy.isMaterializing ?? false;
      const spawnTime: number = (enemy as any)._spawnTime ?? now;
      const aliveMs = now - spawnTime;

      const { icb, matScale } = readEnemyICB(enemy, this.enemyInstanceManager);

      // Enemy not registered in any InstancedMesh = WILL NOT RENDER
      if (icb < 0) {
        unregisteredCount++;
        continue;
      }

      if (icb < minICB) minICB = icb;

      // Count zero-scale matrix (enemy has no visible geometry regardless of ICB)
      if (matScale < 0.001) {
        // Only flag as zero-scale bug if NOT materializing (materializing = expected zero-scale)
        if (!isMaterializing) {
          zeroScaleCount++;
        }
      }

      // Count stuck-materializing: still in materializing state after threshold
      if (isMaterializing && aliveMs > STUCK_MATERIALIZING_MS) {
        stuckMaterializingCount++;
      }

      // Count invisible enemies: ICB below threshold AND not materializing
      if (!isMaterializing && icb < ICB_INVISIBLE_THRESHOLD) {
        invisibleCount++;
        if (invisibleSamples.length < 3) {
          const id: string = (enemy as any).__testId
            ?? (enemy as any).__id
            ?? `idx_${enemies.indexOf(enemy)}`;
          invisibleSamples.push({ id, icb });
        }
      }
    }

    // Determine color status
    let statusColor: string;
    let statusLabel: string;
    if (unregisteredCount > 0 || invisibleCount > 0 || zeroScaleCount > 0) {
      statusColor = '#ff3333';
      statusLabel = 'BUG';
    } else if (stuckMaterializingCount > 0 || (totalAlive > 0 && minICB < 0.25)) {
      statusColor = '#ffcc00';
      statusLabel = 'WARN';
    } else {
      statusColor = '#00ff88';
      statusLabel = 'OK';
    }

    // LOD batch diagnostics — how many enemies in each rendering batch
    const mgr = this.enemyInstanceManager as any;
    let lodInfo = '';
    let highCount = 0;
    let lodMedCount = 0;
    let lodLowCount = 0;
    let batchLines: string[] = [];
    let clippedCount = 0;
    if (mgr) {
      // Count enemies in LOD placement
      if (mgr.enemyLODPlacement) {
        for (const [, level] of mgr.enemyLODPlacement) {
          if (level === 1) lodMedCount++;
          else lodLowCount++;
        }
      }
      highCount = totalAlive - lodMedCount - lodLowCount;
      // Per-batch detail: registered vs mesh.count (if count < max registered index, enemies are CLIPPED)
      let totalRegistered = 0;
      let totalMeshCount = 0;
      if (mgr.batches) {
        for (const [typeName, batch] of mgr.batches) {
          const registered = batch.enemyToIndex?.size ?? 0;
          const meshCount = batch.instancedMesh?.count ?? 0;
          const hwm = batch.highWaterMark ?? -1;
          totalRegistered += registered;
          totalMeshCount += meshCount;
          // Check if any registered enemy has index >= meshCount (would be clipped/invisible)
          if (batch.enemyToIndex) {
            for (const [, idx] of batch.enemyToIndex) {
              if (idx >= meshCount) clippedCount++;
            }
          }
          if (registered > 0) {
            batchLines.push(`  ${typeName}: reg=${registered} cnt=${meshCount} hwm=${hwm}${meshCount <= hwm ? ' !!CLIPPED' : ''}`);
          }
        }
      }
      const lodMedMeshCount = mgr.lodMediumBatch?.instancedMesh?.count ?? 0;
      const lodLowMeshCount = mgr.lodLowBatch?.instancedMesh?.count ?? 0;
      lodInfo = `HIGH:${highCount} MED:${lodMedCount}/${lodMedMeshCount} LOW:${lodLowCount}/${lodLowMeshCount} CLIP:${clippedCount}`;
    }

    // Build display text
    const minICBStr = totalAlive > 0 ? minICB.toFixed(3) : 'n/a';
    let lines = [
      `[VIS DBG] ${statusLabel}  wave:${wave}`,
      `alive:${totalAlive}  invisible:${invisibleCount}`,
      `stuck-mat:${stuckMaterializingCount}  zero-scale:${zeroScaleCount}  NO-MESH:${unregisteredCount}`,
      `min ICB: ${minICBStr}`,
      lodInfo,
    ];

    if (clippedCount > 0) {
      lines.push(`!! ${clippedCount} CLIPPED (idx>=count) !!`);
    }
    if (batchLines.length > 0 && batchLines.length <= 8) {
      lines.push('─ batches ─');
      lines.push(...batchLines);
    }
    if (invisibleCount > 0 && invisibleSamples.length > 0) {
      lines.push('─ invisible enemies ─');
      for (const s of invisibleSamples) {
        lines.push(`  ${s.id}  ICB=${s.icb.toFixed(3)}`);
      }
    }

    // Update DOM
    this.el.style.color = statusColor;
    this.el.style.borderColor = statusColor.replace(')', ',0.4)').replace('rgb', 'rgba');
    this.el.textContent = lines.join('\n');
  }

  dispose(): void {
    this._disposed = true;
    if (this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
  }
}
