/**
 * Local Splitscreen Multiplayer Mode
 *
 * Two players share the same screen and surface:
 * - Player 1 (Cyan): WASD movement, mouse aim, left click shoot, space bomb
 * - Player 2 (Magenta): IJKL movement, shoots in movement direction, O shoot, P bomb
 */

import * as THREE from 'three';

import { Game } from './core/Game';
import { Surface, SurfacePoint } from './surfaces/Surface';
import { SurfaceFactory, SurfaceType } from './surfaces/SurfaceFactory';
import { MultiplayerInputManager } from './input/MultiplayerInput';
import { Player } from './entities/Player';
import { BulletPool } from './entities/Bullet';
import { GeomPool } from './entities/Geom';
import { EnemySpawner } from './entities/enemies/EnemySpawner';
import { BaseEnemy } from './entities/enemies/BaseEnemy';
import { ParticleSystem } from './effects/ParticleSystem';
import { ScreenShake } from './effects/ScreenShake';
import { ScoreManager } from './core/ScoreManager';
import type { WaveDefinition, LevelDefinition } from './core/LevelData';
import { ADVENTURE_LEVELS } from './core/LevelData';

// ---------------------------------------------------------------------------
// URL Parameters
// ---------------------------------------------------------------------------

function getSurfaceTypeFromURL(): SurfaceType {
  const params = new URLSearchParams(window.location.search);
  const surfaceParam = params.get('surface');
  const validTypes = SurfaceFactory.getAvailableTypes();
  if (surfaceParam && validTypes.includes(surfaceParam as SurfaceType)) {
    return surfaceParam as SurfaceType;
  }
  return 'sphere';
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const scoreEl = document.getElementById('score-display')!;
const multiplierEl = document.getElementById('multiplier-display')!;
const livesEl = document.getElementById('lives-display')!;
const bombsEl = document.getElementById('bombs-display')!;

function updateUI(player1: Player, player2: Player): void {
  // Combined score
  const totalScore = player1.score + player2.score;
  scoreEl.textContent = totalScore.toLocaleString();

  // Show both multipliers
  multiplierEl.textContent = `P1:x${player1.multiplier} P2:x${player2.multiplier}`;

  // Combined lives
  const totalLives = player1.lives + player2.lives;
  if (totalLives <= 5) {
    livesEl.textContent = '\u2665'.repeat(totalLives);
  } else {
    livesEl.textContent = `\u2665 x${totalLives}`;
  }

  // Combined bombs
  const totalBombs = player1.bombs + player2.bombs;
  if (totalBombs <= 5) {
    bombsEl.textContent = '\u25cf'.repeat(totalBombs);
  } else {
    bombsEl.textContent = `\u25cf x${totalBombs}`;
  }
}

// ---------------------------------------------------------------------------
// Enemy colors for death effects
// ---------------------------------------------------------------------------

const ENEMY_COLORS: Record<string, THREE.Color> = {
  wanderer: new THREE.Color(0xaa44ff),
  grunt: new THREE.Color(0x4444ff),
  duck: new THREE.Color(0xff44aa),
  mayfly: new THREE.Color(0xddddff),
  rocket: new THREE.Color(0xff8800),
  neutron: new THREE.Color(0xccff00),
  weaver: new THREE.Color(0x00ff44),
  spinner: new THREE.Color(0xff44ff),
  snake: new THREE.Color(0x4488ff),
  repulsor: new THREE.Color(0xff4400),
  gravity_well: new THREE.Color(0x4488ff),
};

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
// Constants
// ---------------------------------------------------------------------------

const PLAYER_MOVE_SPEED = 1.2;
const SPHERE_RADIUS = 8;

// Player colors
const P1_COLOR = 0x00ffff; // Cyan
const P2_COLOR = 0xff00ff; // Magenta

// ---------------------------------------------------------------------------
// Main multiplayer game
// ---------------------------------------------------------------------------

function main(): void {
  const level: LevelDefinition = ADVENTURE_LEVELS[0];

  // -- Game engine --
  const game = new Game({
    bloom: { strength: 0.0, radius: 0.0, threshold: 1.0 },
    cameraDistance: 25, // Farther back to see both players
    cameraSmoothing: 0.05,
  });

  // -- Lighting --
  const ambient = new THREE.AmbientLight(0x404080, 0.6);
  game.scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(5, 10, 5);
  game.scene.add(directional);
  const fillLight = new THREE.DirectionalLight(0x4488ff, 0.4);
  fillLight.position.set(-5, -5, -5);
  game.scene.add(fillLight);

  // -- Surface --
  const surfaceType = getSurfaceTypeFromURL();
  const surfaceConfig = {
    gridColor: 0x006666,
    surfaceColor: 0x0a0020,
    surfaceOpacity: 0.35,
    gridOpacity: 0.5,
    radius: level.surfaceScale,
    size: level.surfaceScale,
    majorRadius: level.surfaceScale * 0.8,
    minorRadius: level.surfaceScale * 0.3,
    gridSegmentsU: 24,
    gridSegmentsV: 18,
  };
  const surface = SurfaceFactory.create(surfaceType, surfaceConfig as any);
  game.scene.add(surface.group);

  // -- Input --
  const input = new MultiplayerInputManager();

  // -- Shared systems --
  const getTransform = makeSurfaceTransformFn(surface);
  const bulletPool = new BulletPool();
  game.scene.add(bulletPool.root);
  const geomPool = new GeomPool();
  game.scene.add(geomPool.root);
  const particles = new ParticleSystem(5000);
  game.scene.add(particles.root);
  const screenShake = new ScreenShake();
  const scoreManager = new ScoreManager();

  // -- Player 1 (Cyan, WASD + mouse) --
  const player1 = new Player(bulletPool);
  player1.respawn(0.5, 0.5);
  player1.lives = 3;
  player1.bombs = 3;
  // Change player 1 mesh color (it's built with cyan by default, so it's fine)
  game.scene.add(player1.mesh);

  // -- Player 2 (Magenta, IJKL + auto-aim) --
  const player2 = new Player(bulletPool);
  player2.respawn(0.5, 0.5);
  player2.lives = 3;
  player2.bombs = 3;
  // Change player 2 mesh color to magenta
  player2.mesh.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
      child.material = child.material.clone();
      child.material.color.setHex(P2_COLOR);
    }
    if (child instanceof THREE.LineSegments && child.material instanceof THREE.LineBasicMaterial) {
      child.material = child.material.clone();
      child.material.color.setHex(P2_COLOR);
    }
  });
  game.scene.add(player2.mesh);

  scoreManager.setPlayer(player1); // P1 is "primary" for scoring

  // -- Enemy spawner --
  const enemySpawner = new EnemySpawner(game.scene, getTransform);

  // -- Wave system (simplified) --
  let waveTimer = 3; // First wave after 3 seconds
  let waveCount = 0;

  // -- Respawn timers --
  let p1RespawnTimer = 0;
  let p2RespawnTimer = 0;
  const RESPAWN_DELAY = 1.5;

  // -- Fixed update loop --
  game.onFixedUpdate = (dt: number) => {
    const p1Input = input.getPlayer1State();
    const p2Input = input.getPlayer2State();

    // Handle respawns
    if (!player1.alive && player1.lives > 0) {
      p1RespawnTimer += dt;
      if (p1RespawnTimer >= RESPAWN_DELAY) {
        p1RespawnTimer = 0;
        player1.respawn(0.25, 0.5);
      }
    }
    if (!player2.alive && player2.lives > 0) {
      p2RespawnTimer += dt;
      if (p2RespawnTimer >= RESPAWN_DELAY) {
        p2RespawnTimer = 0;
        player2.respawn(0.75, 0.5);
      }
    }

    // Update players
    updatePlayer(player1, p1Input, dt, surface, game, 0.25); // P1 at left side
    updatePlayer(player2, p2Input, dt, surface, game, 0.75); // P2 at right side

    // Spawn waves periodically
    waveTimer -= dt;
    if (waveTimer <= 0) {
      waveTimer = 8; // 8 seconds between waves
      waveCount++;
      const enemyCount = Math.min(5 + waveCount * 2, 20);
      enemySpawner.spawnWave([
        { type: 'grunt' as any, count: Math.floor(enemyCount * 0.4) },
        { type: 'wanderer' as any, count: Math.floor(enemyCount * 0.3) },
        { type: 'mayfly' as any, count: Math.floor(enemyCount * 0.3) },
      ]);
    }

    // Update enemies - track the closest player
    const p1UV = surface.getPlayerVirtualUV();
    const p2UV = { u: (p1UV.u + 0.5) % 1, v: p1UV.v }; // P2 is offset
    // Use player1's position for enemy tracking (simplified)
    enemySpawner.update(dt, p1UV.u, p1UV.v);

    // Update bullets
    bulletPool.update(dt);

    // Update geoms
    geomPool.update(dt, p1UV.u, p1UV.v, game.clock.totalTime);

    // Update particles
    particles.update(dt);

    // Update screen shake
    screenShake.update(dt);

    // Collisions
    const enemies = enemySpawner.getEnemies();

    // Bullet-enemy collisions
    bulletPool.forEachActive((bulletIdx, bulletPos) => {
      for (const enemy of enemies) {
        if (!enemy.active || !enemy.alive) continue;
        const dist = bulletPos.distanceTo(enemy.position);
        if (dist < enemy.radius + 0.15) {
          bulletPool.kill(bulletIdx);
          enemy.takeDamage(1);
          particles.bulletImpact(bulletPos);
          surface.applyForce(bulletPos, 0.08, 0.3);

          if (!enemy.alive) {
            const color = ENEMY_COLORS[enemy.constructor.name.toLowerCase()] ?? new THREE.Color(0xffffff);
            particles.enemyDeath(enemy.position, color);
            scoreManager.awardKill(enemy.scoreValue, enemy.constructor.name.toLowerCase());
            screenShake.shake(0.15, 0.15);

            // Spawn geoms
            const { u, v } = surface.worldToSurface(enemy.position);
            for (let g = 0; g < enemy.geomCount; g++) {
              geomPool.spawn(u + (Math.random() - 0.5) * 0.03, v + (Math.random() - 0.5) * 0.03);
            }
          }
          break;
        }
      }
    });

    // Player-enemy collisions
    for (const player of [player1, player2]) {
      if (!player.canTakeDamage) continue;
      for (const enemy of enemies) {
        if (!enemy.active) continue;
        const dist = player.mesh.position.distanceTo(enemy.position);
        if (dist < player.mesh.scale.x * 0.3 + enemy.radius) {
          player.die();
          particles.playerDeath(player.mesh.position);
          screenShake.shake(0.5, 0.4);
          break;
        }
      }
    }

    // Geom pickups (both players can collect)
    for (const player of [player1, player2]) {
      if (!player.alive) continue;
      geomPool.forEachActive((index, _su, _sv, position) => {
        const dist = player.mesh.position.distanceTo(position);
        if (dist < 0.3) {
          geomPool.kill(index);
          scoreManager.collectGeom();
        }
      });
    }

    // Update grid
    surface.updateGrid(dt);

    // Clear input flags
    input.endFrame();
  };

  // -- Render callback --
  game.onRender = (_alpha: number) => {
    bulletPool.applySurfaceProjection(getTransform);
    geomPool.applySurfaceProjection(getTransform);

    if (screenShake.offset.lengthSq() > 0.0001) {
      game.camera.position.add(screenShake.offset);
    }

    updateUI(player1, player2);
  };

  // -- Player callbacks --
  for (const player of [player1, player2]) {
    player.onShoot = (origin: THREE.Vector3) => {
      surface.applyForce(origin, 0.1, 0.3);
    };

    player.onBomb = () => {
      const pos = player.mesh.position;
      surface.applyForce(pos, 0.5, 3.0);
      particles.bombExplosion(pos);
      screenShake.shake(0.3, 0.3);

      // Kill all enemies
      for (const enemy of enemySpawner.getEnemies()) {
        if (enemy.active) {
          const color = ENEMY_COLORS[enemy.constructor.name.toLowerCase()] ?? new THREE.Color(0xffffff);
          particles.enemyDeath(enemy.position, color);
          const { u, v } = surface.worldToSurface(enemy.position);
          for (let g = 0; g < enemy.geomCount; g++) {
            geomPool.spawn(u + (Math.random() - 0.5) * 0.03, v + (Math.random() - 0.5) * 0.03);
          }
          enemy.die();
        }
      }
    };

    player.onDeath = (position: THREE.Vector3) => {
      particles.playerDeath(position);
      screenShake.shake(0.5, 0.4);
    };
  }

  // -- Game over check --
  const checkGameOver = () => {
    if (player1.lives <= 0 && player2.lives <= 0) {
      // Both players dead - game over
      console.log('GAME OVER! Final Score:', player1.score + player2.score);
    }
  };

  // -- Start --
  game.start();

  console.log('[Multiplayer Mode]');
  console.log('Player 1 (Cyan): WASD + Mouse aim + Click to shoot + Space for bomb');
  console.log('Player 2 (Magenta): IJKL + Auto-aim + O to shoot + P for bomb');
}

// ---------------------------------------------------------------------------
// Helper: Update single player
// ---------------------------------------------------------------------------

function updatePlayer(
  player: Player,
  input: { moveX: number; moveY: number; aimX: number; aimY: number; shooting: boolean; bomb: boolean },
  dt: number,
  surface: Surface,
  game: Game,
  baseOffset: number, // 0.25 for P1, 0.75 for P2
): void {
  if (!player.alive) return;

  // Convert input to InputState format
  const inputState = {
    moveX: input.moveX,
    moveY: input.moveY,
    aimX: input.aimX,
    aimY: input.aimY,
    shooting: input.shooting,
    bomb: input.bomb,
    boost: false,
  };

  player.update(dt, inputState);

  // Rotate surface (shared rotation for both players)
  // Each player contributes half the rotation
  surface.rotateByInput(
    input.moveX * 0.5,
    input.moveY * 0.5,
    1.2 * dt
  );

  // Update virtual UV
  const virtualUV = surface.getPlayerVirtualUV();
  player.surfaceU = virtualUV.u;
  player.surfaceV = virtualUV.v;

  // Position player on sphere
  // Players are offset horizontally from each other
  const offsetAngle = (baseOffset - 0.5) * Math.PI * 0.3; // +/- 27 degrees
  const playerPos = new THREE.Vector3(
    Math.sin(offsetAngle) * 0.9,
    0.4,
    Math.cos(offsetAngle) * 0.9
  ).normalize().multiplyScalar(8);
  player.mesh.position.copy(playerPos);

  // Calculate orientation
  const playerNormal = player.mesh.position.clone().normalize();
  const cameraPos = game.camera.position.clone();
  const cameraForward = new THREE.Vector3(0, 0, 0).sub(cameraPos).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const cameraRight = new THREE.Vector3().crossVectors(cameraForward, worldUp).normalize();
  const cameraUp = new THREE.Vector3().crossVectors(cameraRight, cameraForward).normalize();

  const tangentU = cameraRight.clone()
    .sub(playerNormal.clone().multiplyScalar(cameraRight.dot(playerNormal)))
    .normalize();
  const tangentV = cameraUp.clone()
    .sub(playerNormal.clone().multiplyScalar(cameraUp.dot(playerNormal)))
    .normalize();

  const mat = new THREE.Matrix4().makeBasis(tangentU, playerNormal, tangentV);
  const surfaceQuat = new THREE.Quaternion().setFromRotationMatrix(mat);
  const aimQuat = new THREE.Quaternion().setFromAxisAngle(playerNormal, player.aimAngle);
  surfaceQuat.premultiply(aimQuat);
  player.mesh.quaternion.copy(surfaceQuat);
}

main();
