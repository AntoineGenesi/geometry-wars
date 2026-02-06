/**
 * Network Multiplayer Mode
 *
 * Connects to a Colyseus server for online multiplayer.
 * Each client renders the authoritative server state.
 * Uses MeshSurface for proper surface-normal camera and depth-based opacity.
 *
 * Usage: Open http://localhost:3000?mode=network
 * Server must be running: npm run server
 */

import * as THREE from 'three';
import { Game } from './core/Game';
import { SurfaceFactory, SurfaceType } from './surfaces/SurfaceFactory';
import { Surface, SurfacePoint } from './surfaces/Surface';
import { BulletPool } from './entities/Bullet';
import { GeomPool } from './entities/Geom';
import { ParticleSystem } from './effects/ParticleSystem';
import { TrailEffect } from './effects/TrailEffect';
import { InputManager } from './input/InputManager';
import { MeshSurface } from './experimental/mesh-movement/MeshSurface';
import {
  NetworkClient,
  NetworkPlayerState,
  NetworkEnemyState,
  NetworkBulletState,
  NetworkGeomState,
  NetworkGameState,
} from './network/NetworkClient';

// Get surface type from URL
function getSurfaceType(): SurfaceType {
  const params = new URLSearchParams(window.location.search);
  const surfaceParam = params.get('surface');
  const validTypes = SurfaceFactory.getAvailableTypes();
  if (surfaceParam && validTypes.includes(surfaceParam as SurfaceType)) {
    return surfaceParam as SurfaceType;
  }
  return 'sphere';
}

// Get server URL from URL params
function getServerUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('server') || 'ws://localhost:2567';
}

function main() {
  console.log('[NetworkMain] Starting network multiplayer mode...');

  // Create game with disabled bloom (causes white-out)
  const game = new Game({
    bloom: {
      strength: 1.0,
      radius: 0.4,
      threshold: 0.85,
    },
    cameraDistance: 20,
    cameraSmoothing: 0.05,
  });

  const scene = game.scene;
  const camera = game.camera;

  // Disable built-in orbit camera - we control camera manually
  game.disableBuiltInCameraUpdate = true;

  // Create surface
  const surfaceType = getSurfaceType();
  const surface = SurfaceFactory.create(surfaceType);
  scene.add(surface.group);

  // Create MeshSurface for camera tracking and depth-based opacity
  const meshSurface = new MeshSurface(surface.mesh);

  // Camera tracking state
  const CAMERA_DISTANCE = 20;
  const CAMERA_LERP = 0.06;

  // Create pools for rendering
  const bulletPool = new BulletPool();
  scene.add(bulletPool.root);

  const geomPool = new GeomPool();
  scene.add(geomPool.root);

  // Particle system
  const particles = new ParticleSystem(5000);
  scene.add(particles.root);

  // Player tracking - maps server player IDs to local THREE objects
  const playerMeshes = new Map<string, THREE.Group>();
  const playerTrails = new Map<string, TrailEffect>();

  // Enemy tracking
  const enemyMeshes = new Map<string, THREE.Mesh>();

  // Local input
  const input = new InputManager();

  // Network client
  const network = new NetworkClient(getServerUrl());

  // Track local player
  let localPlayerId = '';

  // UI elements
  const statusEl = document.createElement('div');
  statusEl.style.cssText =
    'position:fixed;top:10px;left:50%;transform:translateX(-50%);' +
    'color:#0ff;font:20px monospace;text-shadow:0 0 10px #0ff;z-index:100;';
  statusEl.textContent = 'Connecting...';
  document.body.appendChild(statusEl);

  const scoreEl = document.createElement('div');
  scoreEl.style.cssText =
    'position:fixed;top:10px;right:10px;color:#0f0;font:24px monospace;' +
    'text-shadow:0 0 10px #0f0;z-index:100;text-align:right;';
  document.body.appendChild(scoreEl);

  const playersEl = document.createElement('div');
  playersEl.style.cssText =
    'position:fixed;top:10px;left:10px;color:#ff0;font:16px monospace;' +
    'text-shadow:0 0 10px #ff0;z-index:100;';
  document.body.appendChild(playersEl);

  // Create start button
  const startBtn = document.createElement('button');
  startBtn.textContent = 'START GAME';
  startBtn.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'padding:20px 40px;font:bold 24px monospace;background:#0a0;color:#fff;' +
    'border:2px solid #0f0;cursor:pointer;z-index:100;display:none;';
  startBtn.onclick = () => {
    network.startGame();
    startBtn.style.display = 'none';
  };
  document.body.appendChild(startBtn);

  // Helper to create player mesh (chevron shape, world-space scale)
  function createPlayerMesh(color: number): THREE.Group {
    const group = new THREE.Group();

    // Ship body - chevron
    const bodyGeom = new THREE.ConeGeometry(0.3, 0.8, 4);
    const bodyMat = new THREE.MeshBasicMaterial({ color });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.rotation.x = Math.PI / 2;
    group.add(body);

    // Wings
    const wingGeom = new THREE.BoxGeometry(0.6, 0.06, 0.3);
    const wing = new THREE.Mesh(wingGeom, bodyMat);
    wing.position.z = -0.2;
    group.add(wing);

    return group;
  }

  // Helper to create enemy mesh
  function createEnemyMesh(type: string): THREE.Mesh {
    const colors: Record<string, number> = {
      grunt: 0x00ffff,
      arrow: 0xffff00,
      weaver: 0xff00ff,
      spinner: 0xff8000,
      snake: 0x00ff00,
      gate: 0xffffff,
      blackhole: 0x8000ff,
      repulsor: 0xff0080,
      mayfly: 0xffff80,
      proton: 0x00ffff,
      ufo: 0xffffff,
      mines: 0xff0000,
      mutator: 0x8080ff,
      bubbles: 0x00ff80,
      spawnlet: 0xff8080,
    };

    const color = colors[type] || 0xff0000;
    let geometry: THREE.BufferGeometry;

    switch (type) {
      case 'arrow':
        geometry = new THREE.ConeGeometry(0.25, 0.6, 3);
        break;
      case 'spinner':
        geometry = new THREE.TorusGeometry(0.2, 0.08, 8, 8);
        break;
      case 'blackhole':
        geometry = new THREE.SphereGeometry(0.4, 8, 8);
        break;
      default:
        geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    }

    const material = new THREE.MeshBasicMaterial({ color, transparent: true });
    return new THREE.Mesh(geometry, material);
  }

  // State change callback
  function onStateChange(state: NetworkGameState) {
    // Update players
    state.players.forEach((player: NetworkPlayerState, id: string) => {
      let mesh = playerMeshes.get(id);
      let trail = playerTrails.get(id);

      if (!mesh) {
        mesh = createPlayerMesh(player.color);
        scene.add(mesh);
        playerMeshes.set(id, mesh);

        trail = new TrailEffect(new THREE.Color(player.color), 50);
        scene.add(trail.root);
        playerTrails.set(id, trail);
      }

      // Position on surface (lift above surface)
      const surfacePoint: SurfacePoint = surface.getPoint(player.surfaceU, player.surfaceV);
      mesh.position.copy(surfacePoint.position);
      mesh.position.add(surfacePoint.normal.clone().multiplyScalar(0.15));

      // Orient on surface: align Y to normal, rotate by aimAngle
      const normal = surfacePoint.normal.clone().normalize();
      const forward = surfacePoint.tangentU.clone().normalize();
      const right = new THREE.Vector3().crossVectors(normal, forward).normalize();
      const correctedForward = new THREE.Vector3().crossVectors(right, normal).normalize();
      const rotMatrix = new THREE.Matrix4().makeBasis(right, normal, correctedForward);
      mesh.quaternion.setFromRotationMatrix(rotMatrix);
      mesh.rotateOnAxis(new THREE.Vector3(0, 1, 0), player.aimAngle);

      mesh.visible = player.alive;
      trail?.addPoint(mesh.position.clone());
    });

    // Remove disconnected players
    playerMeshes.forEach((mesh, id) => {
      if (!state.players.has(id)) {
        scene.remove(mesh);
        playerMeshes.delete(id);
        const trail = playerTrails.get(id);
        if (trail) {
          trail.dispose();
          playerTrails.delete(id);
        }
      }
    });

    // Update enemies
    const activeEnemyIds = new Set<string>();
    state.enemies.forEach((enemy: NetworkEnemyState) => {
      activeEnemyIds.add(enemy.id);

      let mesh = enemyMeshes.get(enemy.id);
      if (!mesh) {
        mesh = createEnemyMesh(enemy.type);
        scene.add(mesh);
        enemyMeshes.set(enemy.id, mesh);
      }

      const surfacePoint: SurfacePoint = surface.getPoint(enemy.surfaceU, enemy.surfaceV);
      mesh.position.copy(surfacePoint.position);
      mesh.position.add(surfacePoint.normal.clone().multiplyScalar(0.12));

      // Depth-based opacity: fade enemies on far side of surface
      const visibility = meshSurface.getVisibility(mesh.position, surfacePoint.normal, camera.position);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = visibility;
      mesh.visible = enemy.alive && visibility > 0.05;
    });

    // Remove dead enemies
    enemyMeshes.forEach((mesh, id) => {
      if (!activeEnemyIds.has(id)) {
        scene.remove(mesh);
        enemyMeshes.delete(id);
      }
    });

    // Sync bullets - clear and respawn from server state
    // Note: BulletPool doesn't have releaseAll, so we use clear()
    bulletPool.clear();
    state.bullets.forEach((bullet: NetworkBulletState) => {
      const surfacePoint: SurfacePoint = surface.getPoint(bullet.x, bullet.y);
      const dir = new THREE.Vector3(bullet.dirX, bullet.dirY, bullet.dirZ);
      bulletPool.spawn(
        surfacePoint.position.clone().add(surfacePoint.normal.clone().multiplyScalar(0.02)),
        dir,
        bullet.x,
        bullet.y,
        Math.atan2(bullet.dirY, bullet.dirX)
      );
    });

    // Sync geoms - clear and respawn from server state
    geomPool.clear();
    state.geoms.forEach((geom: NetworkGeomState) => {
      if (geom.active) {
        geomPool.spawn(geom.surfaceU, geom.surfaceV);
      }
    });

    // Update UI
    const localPlayer = state.players.get(localPlayerId);
    if (localPlayer) {
      scoreEl.innerHTML = `Score: ${localPlayer.score}<br>x${localPlayer.multiplier}<br>Lives: ${localPlayer.lives}<br>Bombs: ${localPlayer.bombs}`;
    }

    // Player list
    let playerList = '<b>Players:</b><br>';
    state.players.forEach((p: NetworkPlayerState) => {
      const you = p.id === localPlayerId ? ' (YOU)' : '';
      const status = p.alive ? '' : ' [DEAD]';
      playerList += `${p.name}${you}: ${p.score}${status}<br>`;
    });
    playersEl.innerHTML = playerList;

    // Game state
    if (state.gameStarted) {
      statusEl.textContent = `Wave ${state.waveNumber}`;
      startBtn.style.display = 'none';
    } else if (state.gameOver) {
      statusEl.textContent = 'GAME OVER';
      startBtn.style.display = 'block';
      startBtn.textContent = 'PLAY AGAIN';
    } else {
      statusEl.textContent = 'Waiting for players...';
      startBtn.style.display = 'block';
    }
  }

  // Connect to server
  network.connect({
    name: `Player ${Math.floor(Math.random() * 1000)}`,
    surfaceType,
  }).then(() => {
    localPlayerId = network.getLocalPlayerId();
    statusEl.textContent = 'Connected! Waiting for game start...';
    startBtn.style.display = 'block';

    network.setCallbacks({
      onStateChange,
      onGameOver: () => {
        statusEl.textContent = 'GAME OVER';
      },
      onError: (err) => {
        statusEl.textContent = `Error: ${err.message}`;
      },
    });
  }).catch((err) => {
    statusEl.textContent = 'Failed to connect to server!';
    console.error('[NetworkMain] Connection failed:', err);
  });

  // Wire up game loop callbacks
  game.onFixedUpdate = (dt: number) => {
    // Get input
    const inputState = input.getState();

    // Calculate aim angle from mouse position
    const mouseX = inputState.aimX;
    const mouseY = inputState.aimY;
    const aimAngle = Math.atan2(mouseY, mouseX);

    // Send input to server
    if (network.isConnected()) {
      network.sendInput({
        moveX: inputState.moveX,
        moveY: inputState.moveY,
        aimAngle,
        shooting: inputState.shooting,
        bomb: inputState.bomb,
      });
    }

    // Update particles
    particles.update(dt);

    // Update trails
    playerTrails.forEach((trail) => trail.update(dt));

    // Update geom pool (for magnetic pull animation)
    const localPlayer = playerMeshes.get(localPlayerId);
    if (localPlayer) {
      // Get local player's approximate UV for geom magnet effect
      const pt = surface.worldToSurface(localPlayer.position);
      geomPool.update(dt, pt.u, pt.v, game.clock.totalTime);
    }

    // Clear per-frame input
    input.endFrame();
  };

  game.onRender = () => {
    // Camera follows local player along surface normal
    const localMesh = playerMeshes.get(localPlayerId);
    if (localMesh) {
      // Get surface point for camera positioning (use worldToSurface → getPoint for normal)
      const uv = surface.worldToSurface(localMesh.position);
      const sp = surface.getPoint(uv.u, uv.v);

      const targetCamPos = sp.position.clone().add(
        sp.normal.clone().multiplyScalar(CAMERA_DISTANCE)
      );

      camera.position.lerp(targetCamPos, CAMERA_LERP);
      camera.lookAt(sp.position);
      camera.up.copy(sp.tangentV);
    }

    // Apply surface projection for geoms (bullets are synced from server)
    const getTransform = (u: number, v: number) => {
      const pt = surface.getPoint(u, v);
      return {
        position: pt.position,
        normal: pt.normal,
        tangent: pt.tangentU,
        bitangent: pt.tangentV,
      };
    };
    geomPool.applySurfaceProjection(getTransform);
  };

  // Start the game loop
  game.start();

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    network.disconnect();
    meshSurface.dispose();
  });
}

main();
