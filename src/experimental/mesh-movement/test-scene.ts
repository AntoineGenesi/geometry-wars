/**
 * Test Scene for Mesh-Based Movement System
 *
 * Standalone test that creates a scene with multiple mesh shapes
 * and demonstrates the new movement system working on all of them.
 *
 * Access via: http://localhost:3000/mesh-test.html
 *
 * Tests:
 * 1. Player walks smoothly over poles (no singularity)
 * 2. Speed is constant everywhere on the surface
 * 3. Bullets follow the surface curvature
 * 4. Works on sphere, torus, and arbitrary meshes
 * 5. Far-side entities are faded (depth-based opacity)
 *
 * Custom mesh loading:
 * - URL param: ?shape=custom&url=/path/to/model.glb
 * - Drag and drop: Drop an .obj, .glb, or .gltf file onto the window
 * - Keys 1-5: Switch between built-in shapes
 */

import * as THREE from 'three';
import { MeshSurface } from './MeshSurface';
import { MeshWalker } from './MeshWalker';
import { MeshBulletPool } from './MeshBullet';
import { loadMeshFromURL, loadMeshFromFile, type LoadedMesh } from './MeshLoader';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PLAYER_SPEED = 3.0;  // world units per second - constant everywhere
const CAMERA_DISTANCE = 15;
const CAMERA_LERP = 0.1;   // smooth camera follow

// ---------------------------------------------------------------------------
// Available test shapes
// ---------------------------------------------------------------------------

type ShapeType = 'sphere' | 'torus' | 'cube' | 'knot' | 'pill' | 'custom';

function createShape(type: ShapeType): THREE.Mesh {
  let geometry: THREE.BufferGeometry;

  switch (type) {
    case 'sphere':
      geometry = new THREE.SphereGeometry(8, 64, 48);
      break;
    case 'torus':
      geometry = new THREE.TorusGeometry(6, 2.5, 32, 64);
      break;
    case 'cube':
      geometry = new THREE.BoxGeometry(10, 10, 10, 8, 8, 8);
      break;
    case 'knot':
      geometry = new THREE.TorusKnotGeometry(5, 1.5, 128, 32);
      break;
    case 'pill':
      geometry = new THREE.CylinderGeometry(5, 5, 12, 48, 8, false);
      break;
    default:
      geometry = new THREE.SphereGeometry(8, 64, 48);
  }

  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color: 0x110033,
    transparent: true,
    opacity: 0.15,
    side: THREE.FrontSide,
    depthWrite: true,
  });

  return new THREE.Mesh(geometry, material);
}

function createGrid(surfaceMesh: THREE.Mesh): THREE.LineSegments {
  const edges = new THREE.EdgesGeometry(surfaceMesh.geometry);
  const material = new THREE.LineBasicMaterial({
    color: 0x00cccc,
    transparent: true,
    opacity: 0.5,
  });
  return new THREE.LineSegments(edges, material);
}

function createPlayerMesh(): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.4);
  shape.lineTo(0.3, -0.3);
  shape.lineTo(0, -0.1);
  shape.lineTo(-0.3, -0.3);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

function createEnemyMesh(): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.3);
  shape.lineTo(0.2, 0);
  shape.lineTo(0, -0.3);
  shape.lineTo(-0.2, 0);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshBasicMaterial({
    color: 0xff44ff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1.0,
  });
  return new THREE.Mesh(geometry, material);
}

// ---------------------------------------------------------------------------
// Scene State (mutable, allows hot-swapping meshes)
// ---------------------------------------------------------------------------

interface SceneState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  surfaceMesh: THREE.Mesh;
  grid: THREE.LineSegments;
  meshSurface: MeshSurface;
  player: MeshWalker;
  playerMesh: THREE.Mesh;
  enemies: MeshWalker[];
  bulletPool: MeshBulletPool;
  shapeName: string;
  triangleCount: number;
}

function spawnEnemies(state: SceneState): void {
  // Remove old enemies
  for (const enemy of state.enemies) {
    if (enemy.mesh) state.scene.remove(enemy.mesh);
  }
  state.enemies.length = 0;

  const enemyPositions = [
    new THREE.Vector3(0, -10, 0),
    new THREE.Vector3(10, 0, 0),
    new THREE.Vector3(-10, 0, 0),
    new THREE.Vector3(0, 0, 10),
    new THREE.Vector3(0, 0, -10),
    new THREE.Vector3(5, 5, 5),
    new THREE.Vector3(-5, -5, -5),
  ];

  for (const pos of enemyPositions) {
    const enemyMesh = createEnemyMesh();
    state.scene.add(enemyMesh);

    const enemy = new MeshWalker(state.meshSurface, pos, 0.5);
    enemy.mesh = enemyMesh;
    enemy.alignToSurface();
    state.enemies.push(enemy);
  }
}

/**
 * Replace the current surface mesh with a new one.
 * Preserves the game loop - just swaps the geometry everything walks on.
 */
function replaceSurface(state: SceneState, newMesh: THREE.Mesh, name: string, triCount?: number): void {
  // Remove old surface and grid
  state.scene.remove(state.surfaceMesh);
  state.scene.remove(state.grid);

  // Dispose old BVH
  state.meshSurface.dispose();

  // Add new surface
  state.surfaceMesh = newMesh;
  state.scene.add(state.surfaceMesh);

  // Create new grid
  state.grid = createGrid(state.surfaceMesh);
  state.scene.add(state.grid);

  // Create new MeshSurface
  state.meshSurface = new MeshSurface(state.surfaceMesh);

  // Reset player onto new surface
  const startPos = new THREE.Vector3(0, 12, 0);
  const result = state.meshSurface.closestPointOnSurface(startPos);
  if (result) {
    state.player = new MeshWalker(state.meshSurface, result.point, PLAYER_SPEED);
  } else {
    state.player = new MeshWalker(state.meshSurface, startPos, PLAYER_SPEED);
  }
  state.player.mesh = state.playerMesh;
  state.player.alignToSurface();

  // Reset bullets
  state.bulletPool.setSurface(state.meshSurface);

  // Re-spawn enemies
  spawnEnemies(state);

  // Update metadata
  state.shapeName = name;
  state.triangleCount = triCount ?? (newMesh.geometry.index
    ? newMesh.geometry.index.count / 3
    : newMesh.geometry.attributes.position.count / 3);
}

// ---------------------------------------------------------------------------
// Test Scene
// ---------------------------------------------------------------------------

export function initTestScene(): void {
  const params = new URLSearchParams(window.location.search);
  const shapeType = (params.get('shape') || 'sphere') as ShapeType;
  const customURL = params.get('url') || null;

  // Setup renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000011);
  document.body.appendChild(renderer.domElement);

  // Setup scene and camera
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

  // Create initial surface (placeholder sphere, will be replaced if loading custom)
  const surfaceMesh = createShape(shapeType === 'custom' ? 'sphere' : shapeType);
  scene.add(surfaceMesh);

  const grid = createGrid(surfaceMesh);
  scene.add(grid);

  const meshSurface = new MeshSurface(surfaceMesh);

  // Create player
  const playerMesh = createPlayerMesh();
  scene.add(playerMesh);

  const startPos = new THREE.Vector3(0, 10, 0);
  const player = new MeshWalker(meshSurface, startPos, PLAYER_SPEED);
  player.mesh = playerMesh;
  player.alignToSurface();

  // Create bullet pool
  const bulletPool = new MeshBulletPool(100);
  bulletPool.setSurface(meshSurface);
  scene.add(bulletPool.root);

  // Build initial state
  const state: SceneState = {
    scene,
    camera,
    renderer,
    surfaceMesh,
    grid,
    meshSurface,
    player,
    playerMesh,
    enemies: [],
    bulletPool,
    shapeName: shapeType,
    triangleCount: 0,
  };

  spawnEnemies(state);

  // ---------------------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------------------

  const keys: Record<string, boolean> = {};
  const mousePos = { x: 0, y: 0 };
  let mouseDown = false;

  document.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
  document.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
  document.addEventListener('mousemove', (e) => {
    mousePos.x = (e.clientX / window.innerWidth) * 2 - 1;
    mousePos.y = (e.clientY / window.innerHeight) * 2 - 1;
  });
  document.addEventListener('mousedown', () => { mouseDown = true; });
  document.addEventListener('mouseup', () => { mouseDown = false; });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------

  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;top:10px;left:10px;color:#0ff;font:14px monospace;z-index:100;white-space:pre;';
  document.body.appendChild(hud);

  // Loading overlay
  const loadingOverlay = document.createElement('div');
  loadingOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,17,0.85);display:none;justify-content:center;align-items:center;z-index:200;color:#0ff;font:24px monospace;';
  loadingOverlay.textContent = 'Loading mesh...';
  document.body.appendChild(loadingOverlay);

  // Drop zone hint
  const dropHint = document.createElement('div');
  dropHint.style.cssText = 'position:fixed;bottom:10px;right:10px;color:#0ff;font:12px monospace;z-index:100;opacity:0.5;';
  dropHint.textContent = 'Drop .obj/.glb/.gltf to load custom mesh';
  document.body.appendChild(dropHint);

  // ---------------------------------------------------------------------------
  // Custom mesh loading helpers
  // ---------------------------------------------------------------------------

  function showLoading(msg: string): void {
    loadingOverlay.textContent = msg;
    loadingOverlay.style.display = 'flex';
  }

  function hideLoading(): void {
    loadingOverlay.style.display = 'none';
  }

  function applyLoadedMesh(loaded: LoadedMesh, name: string): void {
    replaceSurface(state, loaded.mesh, name, loaded.triangleCount);
    hideLoading();
  }

  function showError(msg: string): void {
    loadingOverlay.textContent = msg;
    setTimeout(hideLoading, 3000);
  }

  // ---------------------------------------------------------------------------
  // Drag-and-drop file loading
  // ---------------------------------------------------------------------------

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    loadingOverlay.textContent = 'Drop to load mesh';
    loadingOverlay.style.display = 'flex';
  });

  document.addEventListener('dragleave', () => {
    hideLoading();
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file) {
      hideLoading();
      return;
    }

    showLoading(`Loading ${file.name}...`);

    try {
      const loaded = await loadMeshFromFile(file);
      applyLoadedMesh(loaded, file.name);
    } catch (err) {
      showError(`Failed to load ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Load custom mesh from URL if specified
  // ---------------------------------------------------------------------------

  if (shapeType === 'custom' && customURL) {
    showLoading(`Loading ${customURL}...`);
    loadMeshFromURL(customURL)
      .then((loaded) => applyLoadedMesh(loaded, customURL))
      .catch((err) => showError(`Failed to load ${customURL}: ${err instanceof Error ? err.message : String(err)}`));
  }

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------

  let lastTime = performance.now();
  let shootCooldown = 0;
  const SHOOT_INTERVAL = 0.08;

  function update(now: number): void {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // Player input
    const inputX = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0);
    const inputY = (keys['s'] ? 1 : 0) - (keys['w'] ? 1 : 0);

    // Move player
    // Negate inputY: W=-1 should become +1 (screen up = bitangent direction)
    if (inputX !== 0 || inputY !== 0) {
      state.player.moveFromInput(inputX, -inputY, camera, dt);
    }

    // Aim direction
    const aimDir = state.player.getAimDirection(mousePos.x, mousePos.y, camera);
    state.player.faceDirection(aimDir);

    // Shooting
    shootCooldown -= dt;
    if (mouseDown && shootCooldown <= 0) {
      shootCooldown = SHOOT_INTERVAL;
      state.bulletPool.spawn(state.player.position.clone(), aimDir, state.player.normal);
    }

    // Update bullets
    state.bulletPool.update(dt);

    // Update enemies
    for (let i = 0; i < state.enemies.length; i++) {
      const enemy = state.enemies[i];
      const time = now / 1000;
      const driftX = Math.sin(time * 0.5 + i * 2.1) * 0.3;
      const driftY = Math.cos(time * 0.7 + i * 1.7) * 0.3;
      enemy.moveFromInput(driftX, driftY, camera, dt);

      const visibility = enemy.getVisibility(camera.position);
      const mat = (enemy.mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = visibility;
    }

    // Bullet-enemy collision
    state.bulletPool.forEachActive((bulletIdx, bulletPos) => {
      for (const enemy of state.enemies) {
        if (!enemy.mesh) continue;
        const dist = bulletPos.distanceTo(enemy.position);
        if (dist < 0.5) {
          state.bulletPool.kill(bulletIdx);
          const mat = (enemy.mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
          mat.color.set(0xffffff);
          setTimeout(() => { mat.color.set(0xff44ff); }, 100);
        }
      }
    });

    // Camera follows player
    const targetCamPos = state.player.position.clone()
      .addScaledVector(state.player.normal, CAMERA_DISTANCE);
    camera.position.lerp(targetCamPos, CAMERA_LERP);
    camera.lookAt(state.player.position);

    const frame = state.player.getTangentFrame();
    camera.up.copy(frame.bitangent);

    // Update HUD
    const p = state.player.position;
    const n = state.player.normal;
    hud.textContent = [
      `Shape: ${state.shapeName}`,
      `Tris: ${state.triangleCount}`,
      `Pos: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`,
      `Normal: ${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}`,
      `Face: ${state.player.faceIndex}`,
      `Bullets: ${state.bulletPool.activeCount}`,
      `WASD=move, Mouse=aim, Click=shoot`,
      `1-5=shapes, Drop file=custom mesh`,
    ].join('\n');

    renderer.render(scene, camera);
    requestAnimationFrame(update);
  }

  // Shape switching
  document.addEventListener('keydown', (e) => {
    const shapeMap: Record<string, ShapeType> = {
      '1': 'sphere',
      '2': 'torus',
      '3': 'cube',
      '4': 'knot',
      '5': 'pill',
    };
    if (shapeMap[e.key]) {
      const newMesh = createShape(shapeMap[e.key]);
      const triCount = newMesh.geometry.index
        ? newMesh.geometry.index.count / 3
        : newMesh.geometry.attributes.position.count / 3;
      replaceSurface(state, newMesh, shapeMap[e.key], triCount);
    }
  });

  requestAnimationFrame(update);
}
