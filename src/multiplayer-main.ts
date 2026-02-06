/**
 * Local Splitscreen Multiplayer Mode
 *
 * Two players share the same screen and surface:
 * - Player 1 (Cyan): WASD movement, mouse aim, left click shoot, space bomb
 * - Player 2 (Magenta): IJKL movement, chevron-tip aim (faces movement dir), O shoot, P bomb
 *
 * Both players use MeshWalker for mesh-based movement (no UV pole singularity).
 * Camera follows the midpoint between both players.
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
import type { LevelDefinition } from './core/LevelData';
import { ADVENTURE_LEVELS } from './core/LevelData';
import { MeshSurface } from './experimental/mesh-movement/MeshSurface';
import { MeshWalker } from './experimental/mesh-movement/MeshWalker';

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
  const totalScore = player1.score + player2.score;
  scoreEl.textContent = totalScore.toLocaleString();
  multiplierEl.textContent = `P1:x${player1.multiplier} P2:x${player2.multiplier}`;

  const totalLives = player1.lives + player2.lives;
  if (totalLives <= 5) {
    livesEl.textContent = '\u2665'.repeat(totalLives);
  } else {
    livesEl.textContent = `\u2665 x${totalLives}`;
  }

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
// Constants
// ---------------------------------------------------------------------------

const PLAYER_MOVE_SPEED = 3.0; // world units/sec (MeshWalker)
const CAMERA_DISTANCE = 20;    // farther back to see both players
const CAMERA_LERP = 0.08;     // smooth camera follow

// Player colors
const P1_COLOR = 0x00ffff; // Cyan
const P2_COLOR = 0xff00ff; // Magenta

// ---------------------------------------------------------------------------
// Surface transform helper (for enemies/geoms that still use UV)
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
// Main multiplayer game
// ---------------------------------------------------------------------------

function main(): void {
  const level: LevelDefinition = ADVENTURE_LEVELS[0];

  // -- Game engine --
  const game = new Game({
    bloom: { strength: 0.0, radius: 0.0, threshold: 1.0 },
    cameraDistance: CAMERA_DISTANCE,
    cameraSmoothing: 0.05,
  });
  game.disableBuiltInCameraUpdate = true; // We control the camera

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

  // Surface material: FrontSide only to avoid double-vision
  surface.mesh.material = new THREE.MeshBasicMaterial({
    color: 0x0a0020,
    transparent: true,
    opacity: 0.35,
    side: THREE.FrontSide,
    depthWrite: true,
  });

  // -- MeshSurface (BVH) --
  const meshSurface = new MeshSurface(surface.mesh);

  // -- Input --
  const input = new MultiplayerInputManager();

  // -- Shared systems --
  const getTransform = makeSurfaceTransformFn(surface);
  const bulletPool = new BulletPool();
  bulletPool.setMeshSurface(meshSurface);
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
  game.scene.add(player1.mesh);

  // -- Player 2 (Magenta, IJKL + chevron-tip aim) --
  const player2 = new Player(bulletPool);
  player2.respawn(0.5, 0.5);
  player2.lives = 3;
  player2.bombs = 3;
  // Recolor P2 to magenta
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

  scoreManager.setPlayer(player1);

  // -- MeshWalkers for both players --
  // P1 starts at "top" of shape, P2 offset to the side
  const p1Start = surface.getPoint(0.3, 0.5);
  const p2Start = surface.getPoint(0.7, 0.5);

  const walker1 = new MeshWalker(meshSurface, p1Start.position, PLAYER_MOVE_SPEED);
  const walker2 = new MeshWalker(meshSurface, p2Start.position, PLAYER_MOVE_SPEED);

  // Sync initial positions
  player1.mesh.position.copy(walker1.position);
  player2.mesh.position.copy(walker2.position);

  // P2's facing direction (chevron tip). Updated when P2 moves.
  let p2FaceDirection = new THREE.Vector3(0, 0, 1);

  // -- Enemy spawner --
  const enemySpawner = new EnemySpawner(game.scene, getTransform);

  // -- Wave system --
  let waveTimer = 3;
  let waveCount = 0;

  // -- Respawn timers --
  let p1RespawnTimer = 0;
  let p2RespawnTimer = 0;
  const RESPAWN_DELAY = 1.5;

  // -- Fixed update loop --
  game.onFixedUpdate = (dt: number) => {
    const p1Input = input.getPlayer1State();
    const p2Input = input.getPlayer2State();

    // -----------------------------------------------------------------------
    // Handle respawns
    // -----------------------------------------------------------------------

    if (!player1.alive && player1.lives > 0) {
      p1RespawnTimer += dt;
      if (p1RespawnTimer >= RESPAWN_DELAY) {
        p1RespawnTimer = 0;
        player1.respawn(0.3, 0.5);
        const respawnPt = surface.getPoint(0.3, 0.5);
        const projected = meshSurface.closestPointOnSurface(respawnPt.position);
        if (projected) {
          walker1.position.copy(projected.point);
          walker1.normal.copy(projected.normal);
          walker1.faceIndex = projected.faceIndex;
        }
        player1.mesh.position.copy(walker1.position);
      }
    }
    if (!player2.alive && player2.lives > 0) {
      p2RespawnTimer += dt;
      if (p2RespawnTimer >= RESPAWN_DELAY) {
        p2RespawnTimer = 0;
        player2.respawn(0.7, 0.5);
        const respawnPt = surface.getPoint(0.7, 0.5);
        const projected = meshSurface.closestPointOnSurface(respawnPt.position);
        if (projected) {
          walker2.position.copy(projected.point);
          walker2.normal.copy(projected.normal);
          walker2.faceIndex = projected.faceIndex;
        }
        player2.mesh.position.copy(walker2.position);
      }
    }

    // -----------------------------------------------------------------------
    // Player 1: MeshWalker + mouse aim
    // -----------------------------------------------------------------------

    if (player1.alive) {
      // Move on surface
      if (Math.abs(p1Input.moveX) > 0.01 || Math.abs(p1Input.moveY) > 0.01) {
        walker1.moveFromInput(p1Input.moveX, -p1Input.moveY, game.camera, dt);
      }
      player1.mesh.position.copy(walker1.position);

      // Bridge to UV
      const p1UV = surface.worldToSurface(walker1.position);
      player1.surfaceU = p1UV.u;
      player1.surfaceV = p1UV.v;

      // Mouse aim (screen-space -> surface tangent plane)
      const camRight = new THREE.Vector3();
      const camUp = new THREE.Vector3();
      game.camera.matrixWorld.extractBasis(camRight, camUp, new THREE.Vector3());

      const aimLen = Math.sqrt(p1Input.aimX * p1Input.aimX + p1Input.aimY * p1Input.aimY);
      let p1AimDir: THREE.Vector3;
      if (aimLen > 0.1) {
        const screenAim = camRight.clone().multiplyScalar(p1Input.aimX)
          .add(camUp.clone().multiplyScalar(-p1Input.aimY));
        const dot = screenAim.dot(walker1.normal);
        p1AimDir = screenAim.sub(walker1.normal.clone().multiplyScalar(dot)).normalize();
      } else {
        const dot = camUp.clone().negate().dot(walker1.normal);
        p1AimDir = camUp.clone().negate().sub(walker1.normal.clone().multiplyScalar(dot)).normalize();
      }

      // Orient P1 to face aim direction
      orientPlayerOnSurface(player1, walker1.normal, p1AimDir);

      // Store aim angle for bullets
      player1.aimAngle = Math.atan2(p1Input.aimX, -p1Input.aimY);
      player1.mesh.updateMatrixWorld(true);
      player1.update(dt, {
        moveX: p1Input.moveX,
        moveY: p1Input.moveY,
        aimX: p1Input.aimX,
        aimY: p1Input.aimY,
        shooting: p1Input.shooting,
        bomb: p1Input.bomb,
        boost: false,
      });
    }

    // -----------------------------------------------------------------------
    // Player 2: MeshWalker + chevron-tip aim (movement direction)
    // -----------------------------------------------------------------------

    if (player2.alive) {
      // Move on surface
      const p2Moving = Math.abs(p2Input.moveX) > 0.01 || Math.abs(p2Input.moveY) > 0.01;
      if (p2Moving) {
        const prevPos = walker2.position.clone();
        walker2.moveFromInput(p2Input.moveX, -p2Input.moveY, game.camera, dt);

        // Update facing direction from actual movement delta
        const moveDelta = walker2.position.clone().sub(prevPos);
        if (moveDelta.lengthSq() > 0.0001) {
          // Project onto surface tangent plane (remove normal component)
          const dot = moveDelta.dot(walker2.normal);
          const tangentDelta = moveDelta.sub(walker2.normal.clone().multiplyScalar(dot));
          if (tangentDelta.lengthSq() > 0.0001) {
            p2FaceDirection.copy(tangentDelta).normalize();
          }
        }
      }
      player2.mesh.position.copy(walker2.position);

      // Bridge to UV
      const p2UV = surface.worldToSurface(walker2.position);
      player2.surfaceU = p2UV.u;
      player2.surfaceV = p2UV.v;

      // P2 faces movement direction (chevron tip points where they're going)
      orientPlayerOnSurface(player2, walker2.normal, p2FaceDirection);

      // Compute aim angle from face direction relative to camera
      const camRight2 = new THREE.Vector3();
      const camUp2 = new THREE.Vector3();
      game.camera.matrixWorld.extractBasis(camRight2, camUp2, new THREE.Vector3());
      const faceAimX = p2FaceDirection.dot(camRight2);
      const faceAimY = -p2FaceDirection.dot(camUp2);
      player2.aimAngle = Math.atan2(faceAimX, -faceAimY);

      player2.mesh.updateMatrixWorld(true);
      player2.update(dt, {
        moveX: p2Input.moveX,
        moveY: p2Input.moveY,
        aimX: faceAimX,
        aimY: faceAimY,
        shooting: p2Input.shooting,
        bomb: p2Input.bomb,
        boost: false,
      });
    }

    // -----------------------------------------------------------------------
    // Camera: follow midpoint between both players
    // -----------------------------------------------------------------------

    const alivePlayers: MeshWalker[] = [];
    if (player1.alive) alivePlayers.push(walker1);
    if (player2.alive) alivePlayers.push(walker2);

    if (alivePlayers.length > 0) {
      // Camera target: midpoint between alive players
      const midPos = new THREE.Vector3();
      const midNormal = new THREE.Vector3();
      for (const w of alivePlayers) {
        midPos.add(w.position);
        midNormal.add(w.normal);
      }
      midPos.divideScalar(alivePlayers.length);
      midNormal.divideScalar(alivePlayers.length).normalize();

      // Adjust distance based on player separation
      let camDist = CAMERA_DISTANCE;
      if (alivePlayers.length === 2) {
        const separation = walker1.position.distanceTo(walker2.position);
        camDist = Math.max(CAMERA_DISTANCE, CAMERA_DISTANCE + separation * 0.5);
      }

      const targetCamPos = midPos.clone().addScaledVector(midNormal, camDist);
      game.camera.position.lerp(targetCamPos, CAMERA_LERP);
      game.camera.lookAt(midPos);

      // Camera up from midpoint surface tangent
      const midFrame = meshSurface.getTangentFrame(midNormal);
      game.camera.up.copy(midFrame.bitangent);
    }

    // -----------------------------------------------------------------------
    // Spawn enemy waves
    // -----------------------------------------------------------------------

    waveTimer -= dt;
    if (waveTimer <= 0) {
      waveTimer = 8;
      waveCount++;
      const enemyCount = Math.min(5 + waveCount * 2, 20);
      enemySpawner.spawnWave([
        { type: 'grunt' as any, count: Math.floor(enemyCount * 0.4) },
        { type: 'wanderer' as any, count: Math.floor(enemyCount * 0.3) },
        { type: 'mayfly' as any, count: Math.floor(enemyCount * 0.3) },
      ]);
    }

    // -----------------------------------------------------------------------
    // Update enemies (track closest alive player)
    // -----------------------------------------------------------------------

    let trackU = 0.5;
    let trackV = 0.5;
    if (player1.alive && player2.alive) {
      // Track the closest player for each enemy (simplified: use P1)
      trackU = player1.surfaceU;
      trackV = player1.surfaceV;
    } else if (player1.alive) {
      trackU = player1.surfaceU;
      trackV = player1.surfaceV;
    } else if (player2.alive) {
      trackU = player2.surfaceU;
      trackV = player2.surfaceV;
    }
    enemySpawner.update(dt, trackU, trackV);

    // -----------------------------------------------------------------------
    // Update systems
    // -----------------------------------------------------------------------

    bulletPool.update(dt);
    geomPool.update(dt, trackU, trackV, game.clock.totalTime);
    particles.update(dt);
    screenShake.update(dt);
    surface.updateGrid(dt);

    // -----------------------------------------------------------------------
    // Collisions
    // -----------------------------------------------------------------------

    const enemies = enemySpawner.getEnemies();

    // Bullet-enemy
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

            const { u, v } = surface.worldToSurface(enemy.position);
            for (let g = 0; g < enemy.geomCount; g++) {
              geomPool.spawn(u + (Math.random() - 0.5) * 0.03, v + (Math.random() - 0.5) * 0.03);
            }
          }
          break;
        }
      }
    });

    // Player-enemy (both players)
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

    // Geom pickups (both players)
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

    // Depth-based opacity for enemies
    const camPos = game.camera.position;
    const meshCenter = meshSurface.getCenter();
    for (const enemy of enemySpawner.getEnemies()) {
      if (!enemy.alive || !enemy.mesh) continue;
      const approxNormal = enemy.position.clone().sub(meshCenter).normalize();
      const visibility = meshSurface.getVisibility(enemy.position, approxNormal, camPos);
      enemy.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshBasicMaterial;
          if (mat.transparent !== undefined) {
            mat.transparent = true;
            mat.opacity = visibility;
          }
        }
      });
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

  // -- Start --
  game.start();

  console.log('[Local Multiplayer Mode]');
  console.log('Player 1 (Cyan): WASD + Mouse aim + Click to shoot + Space for bomb');
  console.log('Player 2 (Magenta): IJKL + Shoots from chevron tip + O to shoot + P for bomb');
}

// ---------------------------------------------------------------------------
// Helper: orient a player mesh on the surface facing a given direction
// ---------------------------------------------------------------------------

function orientPlayerOnSurface(
  player: Player,
  surfaceNormal: THREE.Vector3,
  faceDir: THREE.Vector3,
): void {
  const normal = surfaceNormal.clone().normalize();
  const forward = faceDir.clone();

  // Project forward onto tangent plane
  forward.sub(normal.clone().multiplyScalar(forward.dot(normal))).normalize();
  if (forward.lengthSq() < 0.001) return;

  const right = new THREE.Vector3().crossVectors(normal, forward).normalize();
  const correctedForward = new THREE.Vector3().crossVectors(right, normal).normalize();

  const rotMatrix = new THREE.Matrix4().makeBasis(right, normal, correctedForward);
  player.mesh.quaternion.setFromRotationMatrix(rotMatrix);
}

main();
