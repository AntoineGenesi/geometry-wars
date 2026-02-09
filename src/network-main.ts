/**
 * Network Multiplayer Mode
 *
 * Connects to a Colyseus server for online multiplayer.
 * Each client renders the authoritative server state.
 * Uses MeshSurface for proper surface-normal camera and depth-based opacity.
 *
 * IMPORTANT: Surface type is determined by the SERVER, not the URL parameter.
 * The client connects first, reads the server's surfaceType from the room state,
 * and only then creates the local surface to match. This ensures host and all
 * clients always play on the same map.
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
  NetworkWeaponPickupState,
  NetworkGameState,
} from './network/NetworkClient';
import { AllyGlowManager } from './effects/AllyGlow';

// Get surface type from URL (used as fallback only if server state unavailable)
function getUrlSurfaceType(): SurfaceType {
  const params = new URLSearchParams(window.location.search);
  const surfaceParam = params.get('surface');
  const validTypes = SurfaceFactory.getAvailableTypes();
  if (surfaceParam && validTypes.includes(surfaceParam as SurfaceType)) {
    return surfaceParam as SurfaceType;
  }
  return 'sphere';
}

// Validate a string is a known surface type
function isValidSurfaceType(s: string): s is SurfaceType {
  return SurfaceFactory.getAvailableTypes().includes(s as SurfaceType);
}

// Get server URL from URL params
function getServerUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('server') || `ws://${window.location.hostname}:2567`;
}

function main() {
  console.log('[NetworkMain] Starting network multiplayer mode...');

  // Create game with bloom enabled (threshold=0.85 prevents white-out)
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

  // -----------------------------------------------------------------------
  // Surface is created AFTER connecting to the server, using the server's
  // authoritative surfaceType. This prevents the "wrong map" bug where the
  // client would use the URL parameter (which defaults to 'sphere') instead
  // of the host's selected map.
  // -----------------------------------------------------------------------
  let surface: Surface | null = null;
  let meshSurface: MeshSurface | null = null;
  let surfaceReady = false;

  function initSurface(serverSurfaceType: string): void {
    if (surfaceReady) return; // Already initialized

    const surfaceType: SurfaceType = isValidSurfaceType(serverSurfaceType)
      ? serverSurfaceType
      : getUrlSurfaceType(); // Fallback to URL param if server sends invalid type

    console.log(`[NetworkMain] Creating surface from SERVER state: "${surfaceType}" (server sent: "${serverSurfaceType}")`);

    surface = SurfaceFactory.create(surfaceType);
    scene.add(surface.group);

    meshSurface = new MeshSurface(surface.mesh);
    surfaceReady = true;
  }

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

  // Bullet tracking: server bullet ID -> pool index (for incremental sync)
  const bulletIdToIndex = new Map<string, number>();

  // Geom tracking: server geom ID -> pool index (for incremental sync)
  const geomIdToIndex = new Map<string, number>();

  // Weapon pickup tracking
  const weaponPickupMeshes = new Map<string, THREE.Mesh>();

  // Ally glow manager for remote player indicators (visible through surfaces)
  const allyGlowManager = new AllyGlowManager(scene);

  // Weapon pickup colors
  const WEAPON_COLORS: Record<string, number> = {
    spread: 0x00ffff,
    piercing: 0xffffff,
    homing: 0xff4444,
    chain_lightning: 0x8844ff,
    plasma_mortar: 0x44ff00,
    gravity_gun: 0x880088,
    laser_beam: 0xff0000,
    black_hole: 0x220044,
    tesla_coil: 0x44aaff,
  };

  // Local input
  const input = new InputManager();

  // Network client
  const network = new NetworkClient(getServerUrl());

  // Track local player
  let localPlayerId = '';

  // Input throttle: send at 30Hz max, and only when input changes
  // (increased from 20Hz to reduce perceived input lag)
  const INPUT_SEND_INTERVAL = 0.033; // ~33ms = 30Hz
  let lastInputSendTime = 0;
  let lastSentInput: { moveX: number; moveY: number; aimAngle: number; shooting: boolean; bomb: boolean } | null = null;

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

  const weaponEl = document.createElement('div');
  weaponEl.style.cssText =
    'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);' +
    'color:#ff0;font:16px monospace;text-shadow:0 0 8px #ff0;z-index:100;';
  document.body.appendChild(weaponEl);

  // Create start button
  const startBtn = document.createElement('button');
  startBtn.textContent = 'START GAME';
  startBtn.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'padding:20px 40px;font:bold 24px monospace;background:#0a0;color:#fff;' +
    'border:2px solid #0f0;cursor:pointer;z-index:100;display:none;';
  startBtn.onclick = () => {
    if (network.isConnected()) {
      network.startGame();
      startBtn.style.display = 'none';
      statusEl.textContent = 'Starting...';
    } else {
      statusEl.textContent = 'Not connected to server!';
      statusEl.style.color = '#f44';
    }
  };
  document.body.appendChild(startBtn);

  // Back to menu button (shown on connection failure)
  const backBtn = document.createElement('button');
  backBtn.textContent = 'BACK TO MENU';
  backBtn.style.cssText =
    'position:fixed;top:60%;left:50%;transform:translate(-50%,-50%);' +
    'padding:15px 30px;font:bold 18px monospace;background:#a00;color:#fff;' +
    'border:2px solid #f44;cursor:pointer;z-index:100;display:none;';
  backBtn.onclick = () => {
    window.location.href = window.location.pathname;
  };
  document.body.appendChild(backBtn);

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
    // On first state change, initialize the surface from the server's authoritative type
    if (!surfaceReady) {
      initSurface(state.surfaceType);
    }

    // Skip rendering if surface not ready (shouldn't happen, but guard)
    if (!surface || !meshSurface) return;

    // Bind to local const so TypeScript narrows the type (non-null) for the rest of this function
    const surf = surface;
    const mSurf = meshSurface;

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

        // Add ally glow for remote players (not the local player)
        if (id !== localPlayerId) {
          allyGlowManager.addGlow(id, player.color, 0.9);
        }
      }

      // Position on surface (lift above surface)
      const surfacePoint: SurfacePoint = surf.getPoint(player.surfaceU, player.surfaceV);
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

      // Sync ally glow position for remote players
      if (id !== localPlayerId && player.alive) {
        allyGlowManager.setPosition(id, mesh.position);
      }
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
        allyGlowManager.removeGlow(id);
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

      const surfacePoint: SurfacePoint = surf.getPoint(enemy.surfaceU, enemy.surfaceV);
      mesh.position.copy(surfacePoint.position);
      mesh.position.add(surfacePoint.normal.clone().multiplyScalar(0.12));

      // Depth-based opacity: fade enemies on far side of surface
      const visibility = mSurf.getVisibility(mesh.position, surfacePoint.normal, camera.position);
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

    // Sync bullets incrementally: update existing, create new, remove stale
    const activeBulletIds = new Set<string>();
    const trackedBulletIndices = new Set(bulletIdToIndex.values());

    state.bullets.forEach((bullet: NetworkBulletState) => {
      activeBulletIds.add(bullet.id);
      const existingIdx = bulletIdToIndex.get(bullet.id);

      if (existingIdx !== undefined) {
        // Update existing bullet position with interpolation
        const surfacePoint: SurfacePoint = surf.getPoint(bullet.x, bullet.y);
        const targetPos = surfacePoint.position.clone().add(
          surfacePoint.normal.clone().multiplyScalar(0.02)
        );
        const line = (bulletPool as unknown as { lines: THREE.Line[] }).lines[existingIdx];
        if (line && line.visible) {
          line.position.lerp(targetPos, 0.4);
        }
      } else {
        // New bullet: spawn in pool and track
        const surfacePoint: SurfacePoint = surf.getPoint(bullet.x, bullet.y);
        const dir = new THREE.Vector3(bullet.dirX, bullet.dirY, bullet.dirZ);
        bulletPool.spawn(
          surfacePoint.position.clone().add(surfacePoint.normal.clone().multiplyScalar(0.02)),
          dir,
          bullet.x,
          bullet.y,
          Math.atan2(bullet.dirY, bullet.dirX)
        );
        // Find the newly spawned index (active but not yet tracked)
        bulletPool.forEachActive((idx) => {
          if (!trackedBulletIndices.has(idx)) {
            bulletIdToIndex.set(bullet.id, idx);
            trackedBulletIndices.add(idx);
          }
        });
      }
    });
    // Remove bullets no longer in server state
    bulletIdToIndex.forEach((idx, id) => {
      if (!activeBulletIds.has(id)) {
        bulletPool.kill(idx);
        bulletIdToIndex.delete(id);
      }
    });

    // Sync geoms incrementally: update existing, create new, remove stale
    const activeGeomIds = new Set<string>();
    const trackedGeomIndices = new Set(geomIdToIndex.values());

    state.geoms.forEach((geom: NetworkGeomState) => {
      if (!geom.active) return;
      activeGeomIds.add(geom.id);

      if (geomIdToIndex.has(geom.id)) {
        // Existing geom - update UV coordinates so projection uses fresh positions
        const idx = geomIdToIndex.get(geom.id)!;
        const geomData = (geomPool as unknown as { geoms: { surfaceU: number; surfaceV: number }[] }).geoms[idx];
        if (geomData) {
          geomData.surfaceU = geom.surfaceU;
          geomData.surfaceV = geom.surfaceV;
        }
      } else {
        // New geom: spawn and track
        geomPool.spawn(geom.surfaceU, geom.surfaceV);
        // Find the newly spawned index (active but not yet tracked)
        geomPool.forEachActive((idx) => {
          if (!trackedGeomIndices.has(idx)) {
            geomIdToIndex.set(geom.id, idx);
            trackedGeomIndices.add(idx);
          }
        });
      }
    });
    // Remove geoms no longer in server state
    geomIdToIndex.forEach((idx, id) => {
      if (!activeGeomIds.has(id)) {
        geomPool.kill(idx);
        geomIdToIndex.delete(id);
      }
    });

    // Sync weapon pickups
    const activePickupIds = new Set<string>();
    state.weaponPickups.forEach((pickup: NetworkWeaponPickupState) => {
      if (!pickup.active) return;
      activePickupIds.add(pickup.id);

      let mesh = weaponPickupMeshes.get(pickup.id);
      if (!mesh) {
        const color = WEAPON_COLORS[pickup.weaponType] ?? 0xffffff;
        const geo = new THREE.OctahedronGeometry(0.2, 0);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
        mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);
        weaponPickupMeshes.set(pickup.id, mesh);
      }

      const sp: SurfacePoint = surf.getPoint(pickup.surfaceU, pickup.surfaceV);
      mesh.position.copy(sp.position);
      mesh.position.add(sp.normal.clone().multiplyScalar(0.3));
      mesh.rotation.y = Date.now() * 0.003;
      mesh.rotation.x = Date.now() * 0.002;

      // Fade when old
      if (pickup.age > 15) {
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - (pickup.age - 15) / 5);
      }
    });

    // Remove collected/expired weapon pickups
    weaponPickupMeshes.forEach((mesh, id) => {
      if (!activePickupIds.has(id)) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        weaponPickupMeshes.delete(id);
      }
    });

    // Update UI
    const localPlayer = state.players.get(localPlayerId);
    if (localPlayer) {
      scoreEl.innerHTML = `Score: ${localPlayer.score}<br>x${localPlayer.multiplier}<br>Lives: ${localPlayer.lives}<br>Bombs: ${localPlayer.bombs}`;

      // Weapon display
      const wName = localPlayer.weaponType.replace(/_/g, ' ').toUpperCase();
      const ammoStr = localPlayer.weaponAmmo < 0 ? '' : ` [${localPlayer.weaponAmmo}]`;
      weaponEl.textContent = wName === 'STANDARD' ? '' : `${wName}${ammoStr}`;
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
  // NOTE: We pass the URL surface type as a hint for room creation (if this
  // client is the first to join = host). The actual surface used for rendering
  // comes from the server state, not from this parameter.
  const urlSurfaceType = getUrlSurfaceType();
  network.connect({
    name: `Player ${Math.floor(Math.random() * 1000)}`,
    surfaceType: urlSurfaceType,
  }).then(() => {
    localPlayerId = network.getLocalPlayerId();

    // Read the server's authoritative surface type and initialize immediately
    const serverSurface = network.getServerSurfaceType();
    console.log(`[NetworkMain] Connected. Server surface: "${serverSurface}", URL surface: "${urlSurfaceType}"`);
    if (serverSurface && serverSurface !== urlSurfaceType) {
      console.log(`[NetworkMain] NOTE: Server surface differs from URL! Using server's: "${serverSurface}"`);
    }
    initSurface(serverSurface);

    statusEl.textContent = 'Connected! Waiting for game start...';
    startBtn.style.display = 'block';

    network.setCallbacks({
      onStateChange,
      onGameStart: () => {
        console.log('[NetworkMain] Game started!');
        statusEl.textContent = 'Game starting...';
        startBtn.style.display = 'none';
      },
      onGameOver: () => {
        statusEl.textContent = 'GAME OVER';
      },
      onError: (err) => {
        statusEl.textContent = `Error: ${err.message}`;
      },
    });
  }).catch((err) => {
    statusEl.textContent = 'Failed to connect to server!';
    statusEl.style.color = '#f44';
    backBtn.style.display = 'block';
    console.error('[NetworkMain] Connection failed:', err);
  });

  // Wire up game loop callbacks
  game.onFixedUpdate = (dt: number) => {
    // Skip if surface not ready yet (still connecting)
    if (!surfaceReady || !surface) return;

    // Get input
    const inputState = input.getState();

    // Calculate aim angle from mouse position.
    // Negate aimY because screen Y-axis points down, but the math convention
    // for atan2 expects Y-up. The resulting angle is used on the server where
    // sin(angle) > 0 means +V direction (which moves UP on screen because
    // camera.up = tangentV = d/dV direction).
    const mouseX = inputState.aimX;
    const mouseY = inputState.aimY;
    const aimAngle = Math.atan2(-mouseY, mouseX);

    // Throttle input and only send when changed
    lastInputSendTime += dt;
    if (network.isConnected() && lastInputSendTime >= INPUT_SEND_INTERVAL) {
      // MOVEMENT FIX: Negate moveY before sending to server.
      //
      // The InputManager convention is: W = moveY -1, S = moveY +1
      // (i.e., W is "up" = negative in screen-space Y).
      //
      // On the server: surfaceV += moveY * speed
      //   - Increasing V moves in the +tangentV direction
      //   - The camera's up vector = tangentV
      //   - So increasing V = moving UP on screen
      //
      // Without negation: W sends moveY=-1, server decreases V, player moves
      // DOWN on screen. That's inverted!
      //
      // With negation: W sends moveY=+1, server increases V, player moves
      // UP on screen. Correct!
      const currentInput = {
        moveX: inputState.moveX,
        moveY: -inputState.moveY,
        aimAngle,
        shooting: inputState.shooting,
        bomb: inputState.bomb,
      };

      // Send if input changed or interval elapsed
      const changed = !lastSentInput
        || currentInput.moveX !== lastSentInput.moveX
        || currentInput.moveY !== lastSentInput.moveY
        || Math.abs(currentInput.aimAngle - lastSentInput.aimAngle) > 0.02
        || currentInput.shooting !== lastSentInput.shooting
        || currentInput.bomb !== lastSentInput.bomb;

      if (changed) {
        network.sendInput(currentInput);
        lastSentInput = { ...currentInput };
        lastInputSendTime = 0;
      }
    }

    // Update particles
    particles.update(dt);

    // Update ally glow pulse animation
    allyGlowManager.update(dt);

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
    // Skip if surface not ready yet
    if (!surfaceReady || !surface) return;

    // Camera follows local player along surface normal
    const localMesh = playerMeshes.get(localPlayerId);
    if (localMesh) {
      // Get surface point for camera positioning (use worldToSurface -> getPoint for normal)
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
    const surfaceRef = surface;
    const getTransform = (u: number, v: number) => {
      const pt = surfaceRef.getPoint(u, v);
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
    allyGlowManager.dispose();
    meshSurface?.dispose();
  });
}

main();
