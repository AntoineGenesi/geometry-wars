/**
 * Performance benchmark mode.
 * Accessible via ?mode=benchmark
 *
 * Spawns increasing numbers of enemies on a sphere while the player
 * moves and shoots continuously, measuring FPS at each tier.
 *
 * Results are logged to the console and displayed on-screen.
 */

import * as THREE from 'three';
import { Game } from './core/Game';
import { Surface, SurfacePoint } from './surfaces/Surface';
import { SurfaceFactory } from './surfaces/SurfaceFactory';
import { Player } from './entities/Player';
import { BulletPool } from './entities/Bullet';
import { GeomPool } from './entities/Geom';
import { EnemySpawner } from './entities/enemies/EnemySpawner';
import { BaseEnemy } from './entities/enemies/BaseEnemy';
import { ParticleSystem } from './effects/ParticleSystem';
import { ScreenShake } from './effects/ScreenShake';
import { MeshSurface } from './experimental/mesh-movement/MeshSurface';
import { MeshWalker } from './experimental/mesh-movement/MeshWalker';
import { SpatialHash } from './core/SpatialHash';

// ---------------------------------------------------------------------------
// Benchmark configuration
// ---------------------------------------------------------------------------

// Detect headless mode (SwiftShader is very slow, use shorter measurements)
const isHeadless = /HeadlessChrome|SwiftShader/i.test(navigator.userAgent) ||
  !!(navigator as any).webdriver;
const ENTITY_TIERS = isHeadless
  ? [50, 100, 200, 500, 1000]
  : [50, 100, 200, 300, 500, 750, 1000, 2000, 5000, 10000];
const WARMUP_SECONDS = isHeadless ? 0.5 : 1;
const MEASURE_SECONDS = isHeadless ? 2 : 4;
const PLAYER_MOVE_SPEED = 3.0;

/**
 * For high entity tiers (2000+), spawning all enemies in a single frame causes
 * a massive spike. Instead we spawn in batches of SPAWN_BATCH_SIZE per frame,
 * and the warmup phase absorbs the spawning cost before measurement begins.
 */
const SPAWN_BATCH_SIZE = 500;

/**
 * Extra warmup time for large tiers. At 10K entities with batch spawning of 500/frame,
 * it takes ~20 frames just to spawn them all. We add extra warmup proportional to count.
 */
function warmupForTier(tierCount: number): number {
  const baseWarmup = isHeadless ? 0.5 : 1;
  if (tierCount <= 1000) return baseWarmup;
  // Add ~1s extra warmup per 2000 entities above 1000 to absorb spawn cost
  const extraEntities = tierCount - 1000;
  const extraWarmup = Math.ceil(extraEntities / 2000) * 1.0;
  return baseWarmup + extraWarmup;
}

interface BenchmarkResult {
  entityCount: number;
  avgFps: number;
  minFps: number;
  maxFps: number;
  stdDev: number;
  frameCount: number;
}

// ---------------------------------------------------------------------------
// Surface transform helper
// ---------------------------------------------------------------------------

function makeSurfaceTransformFn(surface: Surface) {
  return (u: number, v: number): {
    position: THREE.Vector3;
    normal: THREE.Vector3;
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3;
  } => {
    const pt: SurfacePoint = surface.getPoint(u, v);
    return {
      position: pt.position,
      normal: pt.normal,
      tangent: pt.tangentU,
      bitangent: pt.tangentV,
    };
  };
}

// ---------------------------------------------------------------------------
// Benchmark entry point
// ---------------------------------------------------------------------------

export function runBenchmark(): void {
  // Create overlay for results display
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    z-index: 10000; background: rgba(0,0,0,0.85); color: #0f0;
    font-family: monospace; font-size: 14px; padding: 20px;
    overflow-y: auto; white-space: pre;
  `;
  overlay.textContent = 'GEOMETRY WARS PERFORMANCE BENCHMARK\n' +
    '====================================\n\n' +
    'Initializing...\n';
  document.body.appendChild(overlay);

  function log(msg: string): void {
    overlay.textContent += msg + '\n';
    overlay.scrollTop = overlay.scrollHeight;
  }

  // Setup game engine (no bloom for consistent benchmark)
  const game = new Game({
    bloom: { strength: 0.7, radius: 0.5, threshold: 0.6 },
    cameraDistance: 20,
    cameraSmoothing: 0.05,
  });
  game.disableBuiltInCameraUpdate = true;

  // Lighting
  const ambient = new THREE.AmbientLight(0x404080, 0.6);
  game.scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(5, 10, 5);
  game.scene.add(directional);

  // Surface (sphere, radius 10)
  const surface = SurfaceFactory.create('sphere', {
    radius: 10,
    gridColor: 0x1e1e8b,
    surfaceColor: 0x0a0a2a,
    surfaceOpacity: 0.3,
    gridOpacity: 0.35,
    gridSegmentsU: 24,
    gridSegmentsV: 18,
  } as any);
  game.scene.add(surface.group);
  surface.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surface.mesh);

  // Transform
  const getTransform = makeSurfaceTransformFn(surface);

  // Player + walker
  const bulletPool = new BulletPool();
  game.scene.add(bulletPool.root);
  bulletPool.setMeshSurface(meshSurface);

  const geomPool = new GeomPool();
  game.scene.add(geomPool.root);

  const player = new Player(bulletPool);
  player.respawn(0.5, 0.5);
  player.lives = 999;
  player.bombs = 0;
  game.scene.add(player.mesh);

  const initialPoint = surface.getPoint(0.5, 0.5);
  const playerWalker = new MeshWalker(meshSurface, initialPoint.position, PLAYER_MOVE_SPEED);
  player.mesh.position.copy(playerWalker.position);

  // Enemy spawner
  const enemySpawner = new EnemySpawner(game.scene, getTransform);

  // Particles — sized for highest tier (10K entities produce a lot of impacts)
  const maxTier = ENTITY_TIERS[ENTITY_TIERS.length - 1];
  const particleCapacity = maxTier >= 5000 ? 20000 : maxTier >= 2000 ? 10000 : 5000;
  const particles = new ParticleSystem(particleCapacity);
  game.scene.add(particles.root);

  // Screen shake
  const screenShake = new ScreenShake();

  // Spatial hash for collision
  const spatialHash = new SpatialHash<BaseEnemy>(2.5);

  // Suppress enemy death to prevent game loop side effects
  BaseEnemy.onDeath = () => {};

  // Camera — pull back further for high entity counts
  const cameraDistance = maxTier >= 5000 ? 25 : 15;

  // ---------------------------------------------------------------------------
  // Frame timing
  // ---------------------------------------------------------------------------

  const frameTimes: number[] = [];
  let lastFrameTime = performance.now();
  let benchmarkPhase: 'warmup' | 'measure' | 'done' = 'warmup';
  let phaseTimer = 0;
  let currentTierIndex = 0;
  let targetEnemyCount = ENTITY_TIERS[0];
  const results: BenchmarkResult[] = [];

  // Auto movement state
  let moveAngle = 0;
  let shootTimer = 0;

  log(`Tiers: ${ENTITY_TIERS.join(', ')} enemies`);
  log(`Base warmup: ${WARMUP_SECONDS}s (dynamic for high tiers), Measure: ${MEASURE_SECONDS}s per tier`);
  log(`Batch spawn size: ${SPAWN_BATCH_SIZE} per frame (for tiers > 1000)`);
  log('');

  function spawnEnemiesTo(target: number): void {
    const current = enemySpawner.getEnemies().length;
    const need = target - current;
    if (need <= 0) return;

    // For large counts, spawn in batches to avoid a single-frame spike.
    // The warmup phase will absorb the cost of multi-frame spawning.
    const batchSize = target > 1000 ? SPAWN_BATCH_SIZE : need;
    const toSpawn = Math.min(need, batchSize);

    const batchTypes = ['grunt', 'wanderer', 'duck', 'weaver'];
    for (let i = 0; i < toSpawn; i++) {
      const type = batchTypes[i % batchTypes.length];
      const u = 0.05 + Math.random() * 0.9;
      const v = 0.05 + Math.random() * 0.9;
      enemySpawner.spawn(type as any, u, v);
    }
  }

  function finishTier(): void {
    if (frameTimes.length === 0) {
      results.push({
        entityCount: targetEnemyCount,
        avgFps: 0, minFps: 0, maxFps: 0, stdDev: 0, frameCount: 0,
      });
    } else {
      const fps = frameTimes.map(t => t > 0 ? 1000 / t : 0);
      const avgFps = fps.reduce((a, b) => a + b, 0) / fps.length;
      const minFps = Math.min(...fps);
      const maxFps = Math.max(...fps);
      const variance = fps.reduce((sum, f) => sum + (f - avgFps) ** 2, 0) / fps.length;
      const stdDev = Math.sqrt(variance);

      results.push({
        entityCount: targetEnemyCount,
        avgFps: Math.round(avgFps * 10) / 10,
        minFps: Math.round(minFps * 10) / 10,
        maxFps: Math.round(maxFps * 10) / 10,
        stdDev: Math.round(stdDev * 10) / 10,
        frameCount: frameTimes.length,
      });
    }

    const r = results[results.length - 1];
    log(`  ${r.entityCount} enemies: avg=${r.avgFps} fps, min=${r.minFps}, max=${r.maxFps}, stddev=${r.stdDev}, frames=${r.frameCount}`);
  }

  function printFinalResults(): void {
    log('\n===== FINAL RESULTS =====\n');
    log('| Entity Count | Avg FPS | Min FPS | Max FPS | Std Dev | Frames |');
    log('|-------------|---------|---------|---------|---------|--------|');
    for (const r of results) {
      const ec = String(r.entityCount).padStart(11);
      const af = String(r.avgFps).padStart(7);
      const mf = String(r.minFps).padStart(7);
      const xf = String(r.maxFps).padStart(7);
      const sd = String(r.stdDev).padStart(7);
      const fc = String(r.frameCount).padStart(6);
      log(`|${ec} |${af} |${mf} |${xf} |${sd} |${fc} |`);
    }
    log('');

    // Also output as JSON for easy parsing
    log('JSON results:');
    log(JSON.stringify(results, null, 2));

    // Put results on window for Puppeteer to read
    (window as any).__benchmarkResults = results;
    (window as any).__benchmarkDone = true;
  }

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------

  game.onFixedUpdate = (dt: number) => {
    if (benchmarkPhase === 'done') return;

    phaseTimer += dt;

    // Spawn enemies to target
    spawnEnemiesTo(targetEnemyCount);

    // Auto-move player in a circle
    moveAngle += dt * 0.8;
    const mx = Math.cos(moveAngle);
    const my = Math.sin(moveAngle);
    if (Math.abs(mx) > 0.01 || Math.abs(my) > 0.01) {
      playerWalker.moveFromInput(mx, my, game.camera, dt);
    }
    player.mesh.position.copy(playerWalker.position);
    const playerUV = surface.worldToSurface(playerWalker.position);
    player.surfaceU = playerUV.u;
    player.surfaceV = playerUV.v;

    // Auto-shoot in movement direction
    shootTimer += dt;
    if (shootTimer > 0.08) { // ~12.5 shots/sec
      shootTimer = 0;
      const frame = playerWalker.getTangentFrame();
      const shootDir = new THREE.Vector3()
        .addScaledVector(frame.tangent, mx)
        .addScaledVector(frame.bitangent, my)
        .normalize();
      if (shootDir.lengthSq() > 0.01) {
        bulletPool.spawn(
          playerWalker.position, shootDir,
          playerUV.u, playerUV.v,
          Math.atan2(mx, my),
        );
      }
    }

    // Update enemies
    enemySpawner.update(dt, player.surfaceU, player.surfaceV);

    // Update bullets
    bulletPool.update(dt);

    // Update geoms
    geomPool.update(dt, player.surfaceU, player.surfaceV, 0);

    // Collision with spatial hash
    const enemies = enemySpawner.getEnemies();
    spatialHash.clear();
    for (const enemy of enemies) {
      if (!enemy.active || !enemy.alive) continue;
      spatialHash.insert(enemy.position.x, enemy.position.y, enemy.position.z, enemy);
    }

    bulletPool.forEachActive((bulletIdx, bulletPos) => {
      const nearby = spatialHash.getNearby(bulletPos.x, bulletPos.y, bulletPos.z);
      for (let n = 0; n < nearby.length; n++) {
        const enemy = nearby[n];
        if (!enemy.active || !enemy.alive) continue;
        const hitRadiusSq = (enemy.radius + 0.15) ** 2;
        const distSq = bulletPos.distanceToSquared(enemy.position);
        if (distSq < hitRadiusSq) {
          bulletPool.kill(bulletIdx);
          enemy.takeDamage(1);
          if (!enemy.alive) {
            particles.bulletImpact(bulletPos);
            const { u, v } = surface.worldToSurface(enemy.position);
            for (let g = 0; g < enemy.geomCount; g++) {
              geomPool.spawn(u, v);
            }
          }
          break;
        }
      }
    });

    // Update particles
    particles.update(dt);

    // Update grid
    surface.updateGrid(dt);

    // Camera follows player
    const playerNormal = playerWalker.normal;
    const camOffset = playerNormal.clone().multiplyScalar(cameraDistance);
    const targetCamPos = playerWalker.position.clone().add(camOffset);
    game.camera.position.lerp(targetCamPos, 0.12);
    game.camera.lookAt(playerWalker.position);
    const frame = playerWalker.getTangentFrame();
    game.camera.up.lerp(frame.bitangent, 0.12).normalize();

    // Phase transitions
    const currentWarmup = warmupForTier(targetEnemyCount);
    const allSpawned = enemySpawner.getEnemies().length >= targetEnemyCount;
    if (benchmarkPhase === 'warmup' && phaseTimer >= currentWarmup && allSpawned) {
      benchmarkPhase = 'measure';
      phaseTimer = 0;
      frameTimes.length = 0;
      lastFrameTime = performance.now();
      const actualCount = enemySpawner.getEnemies().length;
      log(`\nMeasuring tier ${currentTierIndex + 1}/${ENTITY_TIERS.length}: ${actualCount} enemies (target: ${targetEnemyCount})...`);
    }

    if (benchmarkPhase === 'measure') {
      // Record frame time
      const now = performance.now();
      const frameTime = now - lastFrameTime;
      lastFrameTime = now;
      if (frameTime > 0 && frameTime < 500) { // filter out extreme outliers
        frameTimes.push(frameTime);
      }

      if (phaseTimer >= MEASURE_SECONDS) {
        finishTier();

        currentTierIndex++;
        if (currentTierIndex >= ENTITY_TIERS.length) {
          benchmarkPhase = 'done';
          printFinalResults();
          game.stop();
          return;
        }

        // Next tier
        targetEnemyCount = ENTITY_TIERS[currentTierIndex];
        benchmarkPhase = 'warmup';
        phaseTimer = 0;
        frameTimes.length = 0;
      }
    }
  };

  // Render callback (depth opacity for enemies)
  const _tempApproxNormal = new THREE.Vector3();
  game.onRender = () => {
    bulletPool.applySurfaceProjection(getTransform);
    geomPool.applySurfaceProjection(getTransform);

    // Apply depth-based opacity
    const meshCenter = meshSurface.getCenter();
    const camPos = game.camera.position;
    for (const enemy of enemySpawner.getEnemies()) {
      if (!enemy.alive || !enemy.mesh) continue;
      _tempApproxNormal.copy(enemy.position).sub(meshCenter).normalize();
      const visibility = meshSurface.getVisibility(enemy.position, _tempApproxNormal, camPos);
      if (enemy.cachedMaterials) {
        for (const mat of enemy.cachedMaterials) {
          (mat as any).transparent = true;
          (mat as any).opacity = visibility;
        }
      }
    }
  };

  log('Starting benchmark...\n');
  game.start();
}
