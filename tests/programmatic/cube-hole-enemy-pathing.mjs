#!/usr/bin/env node
/**
 * Targeted cube-hole enemy pathing scenario.
 *
 * Runs the real browser SP path through BrowserTestHarness, then injects a
 * controlled player/enemy placement via the debug API and records pursuit
 * progress over time.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { BrowserTestHarness } from './BrowserTestHarness.mjs';

function parseArgs(argv) {
  const args = {
    surface: 'cube-tunnel',
    seconds: 20,
    seed: 20260731,
    report: 'reports/cube-hole-pathing-cube-tunnel-2026-07-31.json',
    enemyType: 'grunt',
  };

  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, rawValue = 'true'] = arg.slice(2).split('=');
    if (key === 'seconds') args.seconds = Number(rawValue);
    else if (key === 'seed') args.seed = Number(rawValue);
    else if (key in args) args[key] = rawValue;
  }

  return args;
}

function distance3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function uvDistance(a, b, wrapsV) {
  let du = Math.abs(a.u - b.u);
  let dv = Math.abs(a.v - b.v);
  if (du > 0.5) du = 1 - du;
  if (wrapsV && dv > 0.5) dv = 1 - dv;
  return Math.sqrt(du * du + dv * dv);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function summarize(samples) {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const firstById = new Map(first.enemies.map((enemy) => [enemy.id, enemy]));
  const progress = [];

  for (const finalEnemy of last.enemies) {
    const initialEnemy = firstById.get(finalEnemy.id);
    if (!initialEnemy) continue;
    progress.push({
      id: finalEnemy.id,
      type: finalEnemy.type,
      initialWorldDistance: initialEnemy.worldDistanceToPlayer,
      finalWorldDistance: finalEnemy.worldDistanceToPlayer,
      worldDistanceDelta: initialEnemy.worldDistanceToPlayer - finalEnemy.worldDistanceToPlayer,
      initialUvDistance: initialEnemy.uvDistanceToPlayer,
      finalUvDistance: finalEnemy.uvDistanceToPlayer,
      uvDistanceDelta: initialEnemy.uvDistanceToPlayer - finalEnemy.uvDistanceToPlayer,
      worldDisplacement: distance3D(initialEnemy.worldPosition, finalEnemy.worldPosition),
      walkerDisplacement: initialEnemy.walkerPosition && finalEnemy.walkerPosition
        ? distance3D(initialEnemy.walkerPosition, finalEnemy.walkerPosition)
        : null,
    });
  }

  const finalDistances = last.enemies.map((enemy) => enemy.worldDistanceToPlayer);
  const movedCount = progress.filter((enemy) => enemy.worldDisplacement > 0.25).length;
  const improvedCount = progress.filter((enemy) => enemy.worldDistanceDelta > 0.25).length;
  const regressedCount = progress.filter((enemy) => enemy.worldDistanceDelta < -0.25).length;

  return {
    initialCluster: first.cluster,
    finalCluster: last.cluster,
    movedCount,
    improvedCount,
    regressedCount,
    enemyCount: last.enemies.length,
    medianFinalWorldDistance: median(finalDistances),
    allMadeProgress: improvedCount === progress.length && progress.length > 0,
    anyStalled: movedCount < progress.length,
    progress,
  };
}

async function configureScenario(page, surface, enemyType) {
  return page.evaluate(({ surface, enemyType }) => {
    const api = window.__gameDebug;
    if (!api) throw new Error('GameDebugAPI unavailable');

    const gameSurface = api.surface;
    const enemySpawner = api.enemySpawner;
    const player = api.player;
    const playerWalker = api.playerWalker;

    enemySpawner.clear();

    const cubeTunnelOuter = gameSurface.outerWallFrac ? gameSurface.outerWallFrac * 0.5 : 0.0;
    const cubeTunnelInner = gameSurface.outerWallFrac && gameSurface.lipFrac
      ? gameSurface.outerWallFrac + gameSurface.lipFrac + gameSurface.outerWallFrac * 0.5
      : 0.5;

    const placementsBySurface = {
      'cube-tunnel': {
        player: { u: 0.125, v: cubeTunnelInner },
        enemies: [
          { u: 0.125, v: cubeTunnelOuter },
          { u: 0.135, v: cubeTunnelOuter },
          { u: 0.115, v: cubeTunnelOuter },
          { u: 0.125, v: gameSurface.outerWallFrac ?? 0.25 },
        ],
        description: 'player on inner wall; enemies on same-U outer wall/lip path',
      },
      'cube-ring': {
        player: { u: 0.125, v: 0.5 },
        enemies: [
          { u: 0.125, v: 0.0 },
          { u: 0.135, v: 0.0 },
          { u: 0.115, v: 0.0 },
          { u: 0.125, v: 0.25 },
        ],
        description: 'player on inner ring face; enemies on outer/top cross-section controls',
      },
      cube: {
        player: { u: 0.5, v: 0.5 },
        enemies: [
          { u: 0.1, v: 0.5 },
          { u: 0.9, v: 0.5 },
          { u: 0.5, v: 0.1 },
          { u: 0.5, v: 0.9 },
        ],
        description: 'plain cube around centered player control',
      },
    };

    const placement = placementsBySurface[surface];
    if (!placement) throw new Error(`No placement for surface ${surface}`);

    const playerPoint = gameSurface.getPoint(placement.player.u, placement.player.v);
    const projected = playerWalker.surface.closestPointOnSurface(playerPoint.position);
    if (!projected) throw new Error('Could not project player point to mesh surface');
    playerWalker.teleportTo(projected.point, projected.faceIndex, projected.normal);
    player.mesh.position.copy(playerWalker.position);
    player.surfaceU = placement.player.u;
    player.surfaceV = placement.player.v;
    player.alive = true;
    player.canBeTracked = true;
    player.infiniteLives = true;
    player.health = 999999;
    player.maxHealth = Math.max(player.maxHealth ?? 100, 999999);
    window.__GOD_MODE = true;

    const enemies = placement.enemies.map((pos, index) => {
      const enemy = enemySpawner.spawn(enemyType, pos.u, pos.v, 0, true);
      enemy.__pathingScenarioId = `${enemyType}-${index}`;
      enemy.__pathingScenarioSpawn = { u: pos.u, v: pos.v };
      enemy.isMaterializing = false;
      return enemy.__pathingScenarioId;
    });

    return {
      surface,
      description: placement.description,
      player: placement.player,
      enemies,
      surfaceInternals: {
        wrapsU: gameSurface.wrapsU,
        wrapsV: gameSurface.wrapsV,
        outerWallFrac: gameSurface.outerWallFrac ?? null,
        lipFrac: gameSurface.lipFrac ?? null,
      },
    };
  }, { surface, enemyType });
}

async function sampleScenario(page, elapsedSec, surfaceId) {
  return page.evaluate(({ elapsedSec, surfaceId }) => {
    const api = window.__gameDebug;
    const gameSurface = api.surface;
    const player = api.player;
    const inverseRot = gameSurface.worldRotation.clone().invert();

    function vec(v) {
      return { x: v.x, y: v.y, z: v.z };
    }

    function classifyRegion(v) {
      if (surfaceId === 'cube-tunnel' && gameSurface.outerWallFrac && gameSurface.lipFrac) {
        const wrapped = ((v % 1) + 1) % 1;
        const owf = gameSurface.outerWallFrac;
        const lf = gameSurface.lipFrac;
        if (wrapped < owf) return 'outerWall';
        if (wrapped < owf + lf) return 'topLip';
        if (wrapped < 2 * owf + lf) return 'innerWall';
        return 'bottomLip';
      }
      if (surfaceId === 'cube-ring') {
        const wrapped = ((v % 1) + 1) % 1;
        if (wrapped < 0.125 || wrapped >= 0.875) return 'outerFace';
        if (wrapped < 0.375) return 'topFace';
        if (wrapped < 0.625) return 'innerFace';
        return 'bottomFace';
      }
      return 'n/a';
    }

    const playerWorld = player.mesh.position;
    const playerUV = { u: player.surfaceU, v: player.surfaceV };
    const enemies = api.enemySpawner.getEnemies()
      .filter((enemy) => enemy.__pathingScenarioId && enemy.active)
      .map((enemy) => {
        const worldPosition = enemy.position;
        const walkerPosition = enemy.walker ? enemy.walker.position : null;
        const localWalker = walkerPosition ? walkerPosition.clone().applyQuaternion(inverseRot) : null;
        const walkerUV = localWalker ? gameSurface.worldToSurface(localWalker) : null;
        const surfaceUV = { u: enemy.surfacePosition.u, v: enemy.surfacePosition.v };
        const worldDistanceToPlayer = worldPosition.distanceTo(playerWorld);
        let du = Math.abs(surfaceUV.u - playerUV.u);
        let dv = Math.abs(surfaceUV.v - playerUV.v);
        if (gameSurface.wrapsU && du > 0.5) du = 1 - du;
        if (gameSurface.wrapsV && dv > 0.5) dv = 1 - dv;

        return {
          id: enemy.__pathingScenarioId,
          type: enemy.constructor.name.toLowerCase(),
          spawnUV: enemy.__pathingScenarioSpawn,
          surfaceUV,
          walkerUV,
          region: classifyRegion(surfaceUV.v),
          worldPosition: vec(worldPosition),
          walkerPosition: walkerPosition ? vec(walkerPosition) : null,
          worldDistanceToPlayer,
          uvDistanceToPlayer: Math.sqrt(du * du + dv * dv),
          faceIndex: enemy.walker ? enemy.walker.faceIndex : null,
        };
      });

    const centroid = enemies.reduce((acc, enemy) => {
      acc.x += enemy.worldPosition.x;
      acc.y += enemy.worldPosition.y;
      acc.z += enemy.worldPosition.z;
      return acc;
    }, { x: 0, y: 0, z: 0 });
    if (enemies.length > 0) {
      centroid.x /= enemies.length;
      centroid.y /= enemies.length;
      centroid.z /= enemies.length;
    }
    const radiusValues = enemies.map((enemy) => {
      const dx = enemy.worldPosition.x - centroid.x;
      const dy = enemy.worldPosition.y - centroid.y;
      const dz = enemy.worldPosition.z - centroid.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    });
    const clusterRadius = radiusValues.length > 0 ? Math.max(...radiusValues) : 0;
    const centroidDistanceToPlayer = playerWorld.distanceTo({
      x: centroid.x,
      y: centroid.y,
      z: centroid.z,
      isVector3: true,
    });

    return {
      elapsedSec,
      surface: surfaceId,
      player: {
        surfaceUV: playerUV,
        region: classifyRegion(playerUV.v),
        worldPosition: vec(playerWorld),
      },
      enemies,
      cluster: {
        centroid,
        clusterRadius,
        centroidDistanceToPlayer,
        medianWorldDistanceToPlayer: (() => {
          const distances = enemies.map((enemy) => enemy.worldDistanceToPlayer).sort((a, b) => a - b);
          if (distances.length === 0) return 0;
          const mid = Math.floor(distances.length / 2);
          return distances.length % 2 === 0 ? (distances[mid - 1] + distances[mid]) / 2 : distances[mid];
        })(),
      },
    };
  }, { elapsedSec, surfaceId });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const harness = new BrowserTestHarness({
    surface: args.surface,
    seed: args.seed,
    headless: true,
  });

  const reportPath = resolve(process.cwd(), args.report);
  mkdirSync(dirname(reportPath), { recursive: true });

  const samples = [];
  let screenshotPath = null;
  let setup = null;

  try {
    await harness.start();
    await harness.startGame();
    setup = await configureScenario(harness.page, args.surface, args.enemyType);
    samples.push(await sampleScenario(harness.page, 0, args.surface));

    const sampleIntervalSec = 0.5;
    const steps = Math.ceil(args.seconds / sampleIntervalSec);
    for (let i = 1; i <= steps; i++) {
      await harness.fastForward(sampleIntervalSec);
      samples.push(await sampleScenario(harness.page, Math.min(i * sampleIntervalSec, args.seconds), args.surface));
    }

    screenshotPath = await harness.screenshot(`cube-hole-pathing-${args.surface}`);
  } finally {
    await harness.stop();
  }

  const summary = summarize(samples);
  const report = {
    generatedAt: new Date().toISOString(),
    command: process.argv.join(' '),
    surface: args.surface,
    seed: args.seed,
    seconds: args.seconds,
    enemyType: args.enemyType,
    userWordingMapping: {
      likelyUserMap: 'cube with hole',
      mappedSurface: 'cube-tunnel',
      adjacentControls: ['cube-ring', 'cube'],
    },
    setup,
    summary,
    samples,
    screenshotPath,
  };

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Report: ${reportPath}`);
  console.log(`Surface: ${args.surface}`);
  console.log(`Enemies: ${summary.enemyCount}`);
  console.log(`Moved: ${summary.movedCount}/${summary.enemyCount}`);
  console.log(`Improved world distance: ${summary.improvedCount}/${summary.enemyCount}`);
  console.log(`Regressed world distance: ${summary.regressedCount}/${summary.enemyCount}`);
  console.log(`Any stalled: ${summary.anyStalled}`);
  console.log(`Screenshot: ${screenshotPath}`);

  if (summary.enemyCount === 0 || summary.anyStalled || summary.improvedCount < summary.enemyCount) {
    process.exitCode = 2;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
