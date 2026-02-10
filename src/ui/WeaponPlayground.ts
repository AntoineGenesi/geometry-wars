/**
 * Interactive weapon demo/playground that runs inside the WeaponWiki modal.
 *
 * Self-contained Three.js scene with its own renderer, camera, a randomly
 * chosen surface from the game, a player chevron, real enemy types, and
 * weapon visuals. Mouse-aimed firing with player death/respawn, lives, and
 * game-over state.
 *
 * DESIGN: Matches actual game conditions exactly:
 * - Real surface types from src/surfaces/ (randomly selected)
 * - Real enemy types from src/entities/enemies/
 * - Fire rates match WEAPON_CONFIGS + Player FIRE_RATE gating
 * - Camera follows player with smooth lerp
 * - Enemy death particle effects (same ParticleSystem as main game)
 * - Opaque surface for clear visibility at small scale
 */

import * as THREE from 'three';
import { WeaponType, WEAPON_CONFIGS } from '../weapons/WeaponTypes';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';
import { Grunt } from '../entities/enemies/Grunt';
import { Wanderer } from '../entities/enemies/Wanderer';
import { Duck } from '../entities/enemies/Duck';
import { Weaver } from '../entities/enemies/Weaver';
import { Spinner } from '../entities/enemies/Spinner';
import { Rocket } from '../entities/enemies/Rocket';
import { ParticleSystem } from '../effects/ParticleSystem';
import { SurfaceFactory, SurfaceType } from '../surfaces/SurfaceFactory';
import { Surface, SurfacePoint } from '../surfaces/Surface';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Target bounding radius for the playground surface (all surfaces scaled to fit) */
const TARGET_RADIUS = 3;
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 300;
const ENEMY_COUNT = 8;
const ENEMY_RESPAWN_DELAY = 2.0;
const CAMERA_DISTANCE = 8;
const PLAYER_MOVE_SPEED = 0.4; // UV units per second for WASD movement
const MIN_DT = 1 / 120;
const MAX_DT = 1 / 30;
const PLAYER_RESPAWN_DELAY = 1.5;
const STARTING_LIVES = 3;
const DEATH_FLASH_DURATION = 0.4;
const TESLA_ARC_RANGE = 2.0;
const TESLA_ARC_PERSIST = 0.7; // seconds arcs stay visible
const TESLA_ARC_COUNT = 4; // arcs spawned per fire event

// Scale factor for enemy meshes & radii in the playground.
// Enemies are designed for a radius-10 sphere; the playground scales surfaces
// to TARGET_RADIUS. We want enemies clearly visible — NOT proportionally
// scaled to 0.3. A factor of 0.8 keeps them slightly smaller than their raw
// mesh size but large enough to see easily.
const ENEMY_SCALE = 0.8;

// Player death radius — must match the visual player chevron size (0.2) scaled
// to be proportional on the playground surface.
const PLAYER_DEATH_RADIUS = 0.15;

// Projectile hit radius — how close a projectile must be to an enemy to hit it.
// Must be proportional to the enemy visual size.
const PROJECTILE_HIT_RADIUS = 0.25;

// Match the real game's Player FIRE_RATE (src/entities/Player.ts: FIRE_RATE = 10)
// This is the base player fire interval, which gates weapon fire rates
const PLAYER_BASE_FIRE_RATE = 10; // shots per second
const PLAYER_FIRE_INTERVAL = 1 / PLAYER_BASE_FIRE_RATE; // 0.1 seconds

// Enemy types available in the playground (mix of basic + mid-tier)
type PlaygroundEnemyType = 'grunt' | 'wanderer' | 'duck' | 'weaver' | 'spinner' | 'rocket';
const ENEMY_TYPES: PlaygroundEnemyType[] = ['grunt', 'wanderer', 'duck', 'weaver', 'spinner', 'rocket'];

// Enemy color map for death particle effects (matches mesh material colors)
const ENEMY_COLORS: Record<PlaygroundEnemyType, number> = {
  grunt: 0x4444ff,
  wanderer: 0xaa44ff,
  duck: 0xff44aa,
  weaver: 0x00ff44,
  spinner: 0xff44ff,
  rocket: 0xff8800,
};

// Temp vectors to avoid GC
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _mouseNDC = new THREE.Vector2();

// ---------------------------------------------------------------------------
// Real enemy wrapper (tracks respawn state alongside the real BaseEnemy)
// ---------------------------------------------------------------------------

interface PlaygroundEnemyEntry {
  enemy: BaseEnemy;
  type: PlaygroundEnemyType;
  respawnTimer: number;
}

// ---------------------------------------------------------------------------
// Mini projectile data
// ---------------------------------------------------------------------------

interface MiniProjectile {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  speed: number;
  age: number;
  maxAge: number;
  type: WeaponType;
  /** For homing: target enemy index */
  targetIdx: number;
  /** For piercing: set of enemy indices already hit */
  hitSet: Set<number>;
}

// ---------------------------------------------------------------------------
// Damage popup data
// ---------------------------------------------------------------------------

interface DamagePopup {
  element: HTMLDivElement;
  age: number;
}

// ---------------------------------------------------------------------------
// Tesla arc data
// ---------------------------------------------------------------------------

interface TeslaArc {
  line: THREE.Line;
  age: number;
  maxAge: number;
  initialOpacity: number;
}

// ---------------------------------------------------------------------------
// Surface transform builder for real enemies.
// Takes a Surface instance and a uniform scale factor, returns a function
// that maps UV (0-1, 0-1) -> position/normal/tangent/bitangent at scaled size.
// ---------------------------------------------------------------------------

function makeSurfaceTransform(surface: Surface, scale: number) {
  return (u: number, v: number): {
    position: THREE.Vector3;
    normal: THREE.Vector3;
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3;
  } => {
    const pt: SurfacePoint = surface.getPoint(u, v);

    return {
      position: pt.position.clone().multiplyScalar(scale),
      normal: pt.normal.clone(),
      tangent: pt.tangentU.clone(),
      bitangent: pt.tangentV.clone(),
    };
  };
}

/**
 * Compute the bounding sphere radius of a Surface's mesh geometry.
 * Used to determine the uniform scale factor to fit the surface to TARGET_RADIUS.
 */
function computeSurfaceBoundingRadius(surface: Surface): number {
  surface.mesh.geometry.computeBoundingSphere();
  const bs = surface.mesh.geometry.boundingSphere;
  return bs ? bs.radius : 10;
}

// ---------------------------------------------------------------------------
// WeaponPlayground
// ---------------------------------------------------------------------------

export class WeaponPlayground {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;

  private playerGroup: THREE.Group;
  /** Player position in UV coordinates on the surface */
  private playerU = 0.25;
  private playerV = 0.5;
  /** Aim position in UV coordinates on the surface */
  private aimU = 0.25;
  private aimV = 0.5;

  private enemies: PlaygroundEnemyEntry[] = [];
  private projectiles: MiniProjectile[] = [];
  private popups: DamagePopup[] = [];

  private activeWeapon: WeaponType = WeaponType.Standard;
  private fireCooldown = 0;

  // Mouse state
  private mouseX = CANVAS_WIDTH / 2;
  private mouseY = CANVAS_HEIGHT / 2;
  private mouseDown = false;
  private mouseOnSurface = false; // whether the mouse ray intersects the surface

  // Surface state
  private surface!: Surface;
  private surfaceType!: SurfaceType;
  private surfaceScale = 1; // uniform scale to fit surface to TARGET_RADIUS
  private surfaceGroup!: THREE.Group; // scaled group containing surface meshes
  private surfaceTransformFn!: ReturnType<typeof makeSurfaceTransform>;

  // Player death/respawn state
  private playerAlive = true;
  private respawnTimer = 0;
  private deathFlashTimer = 0;
  private lives = STARTING_LIVES;
  private gameOver = false;
  private deathEffects: THREE.Object3D[] = [];

  // Stats
  private dps = 0;
  private kills = 0;
  private elapsed = 0;
  private damageAccum = 0; // damage dealt in the last second
  private dpsTimer = 0;

  // Active effects (laser beam, tesla field, black hole)
  private activeEffectMeshes: THREE.Object3D[] = [];
  private activeEffectTimers: number[] = [];

  // Tesla arcs (persistent)
  private teslaArcs: TeslaArc[] = [];

  // DOM
  private statsOverlay: HTMLDivElement;
  private popupContainer: HTMLDivElement;
  private hintOverlay: HTMLDivElement;

  // Loop
  private rafId = 0;
  private lastTime = 0;
  private disposed = false;

  // Focus & pause state
  private focused = false;
  private paused = false;

  // Input state (self-contained, no external InputManager needed)
  private readonly keysDown: Set<string> = new Set();

  // Bound handlers (stored for cleanup)
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onCanvasClick: (e: MouseEvent) => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onMouseUp: (e: MouseEvent) => void;

  // Particle system for death effects
  private particleSystem: ParticleSystem;

  constructor(container: HTMLElement) {
    this.container = container;

    // -- Pick a random surface type --
    this.initSurface();

    // -- Renderer --
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.margin = '0 auto';
    this.renderer.domElement.style.borderRadius = '4px';
    this.renderer.domElement.style.border = '1px solid rgba(255,255,255,0.1)';
    container.appendChild(this.renderer.domElement);

    // -- Scene --
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050510);

    // -- Lighting (needed for real enemies which use MeshStandardMaterial) --
    const ambient = new THREE.AmbientLight(0x404080, 0.8);
    this.scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 5);
    this.scene.add(directional);
    const fillLight = new THREE.DirectionalLight(0x4488ff, 0.4);
    fillLight.position.set(-5, -5, -5);
    this.scene.add(fillLight);

    // -- Camera: follows player position with smooth lerp --
    this.camera = new THREE.PerspectiveCamera(50, CANVAS_WIDTH / CANVAS_HEIGHT, 0.1, 100);
    this.camera.position.set(0, CAMERA_DISTANCE * 0.6, CAMERA_DISTANCE * 0.8);
    this.camera.lookAt(0, 0, 0);

    // -- Add the real surface (scaled to fit playground) --
    this.addSurfaceToScene();

    // -- Player chevron --
    this.playerGroup = this.buildMiniChevron(0x00ffff, 0.2);
    this.scene.add(this.playerGroup);

    // -- Particle system for enemy death effects --
    this.particleSystem = new ParticleSystem(2000);
    this.scene.add(this.particleSystem.root);

    // -- Spawn real enemies --
    for (let i = 0; i < ENEMY_COUNT; i++) {
      this.spawnRealEnemy(i);
    }

    // -- Surface name label --
    const surfaceLabel = this.surfaceType.toUpperCase().replace('-', ' ');

    // -- Stats overlay (includes lives + surface name) --
    this.statsOverlay = document.createElement('div');
    this.statsOverlay.style.cssText =
      'display:flex;justify-content:space-between;padding:6px 12px;color:#88aacc;' +
      'font-size:11px;font-family:monospace;letter-spacing:1px;';
    this.statsOverlay.innerHTML =
      `<span id="pg-surface" style="color:#00ffcc;text-transform:uppercase;">${surfaceLabel}</span>` +
      `<span id="pg-lives">LIVES: ${STARTING_LIVES}</span>` +
      '<span id="pg-dps">DPS: 0</span><span id="pg-kills">KILLS: 0</span><span id="pg-time">0.0s</span>';
    container.appendChild(this.statsOverlay);

    // -- Popup container (overlaid on canvas) --
    this.popupContainer = document.createElement('div');
    this.popupContainer.style.cssText =
      'position:relative;width:0;height:0;pointer-events:none;overflow:visible;';
    container.style.position = 'relative';
    container.appendChild(this.popupContainer);

    // -- Hint overlay (click to play / ESC to pause) --
    this.hintOverlay = document.createElement('div');
    this.hintOverlay.style.cssText =
      'position:absolute;top:0;left:50%;transform:translateX(-50%);' +
      `width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;` +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'background:rgba(5,5,16,0.7);border-radius:4px;cursor:pointer;z-index:10;';
    this.hintOverlay.innerHTML =
      '<div style="color:#00ffff;font-family:monospace;font-size:16px;letter-spacing:2px;' +
      'text-shadow:0 0 10px #00ffff,0 0 20px #0088aa;margin-bottom:8px;">CLICK TO PLAY</div>' +
      '<div style="color:#88aacc;font-family:monospace;font-size:11px;letter-spacing:1px;">' +
      'WASD: Move | Mouse: Aim | Click: Shoot | ESC: Pause</div>';
    container.appendChild(this.hintOverlay);

    // -- Input handlers --
    this.onKeyDown = (e: KeyboardEvent) => {
      if (!this.focused || this.disposed) return;
      const key = e.key.toLowerCase();
      this.keysDown.add(key);

      // ESC toggles pause
      if (key === 'escape') {
        this.paused = !this.paused;
        if (this.paused) {
          this.showOverlay('PAUSED', 'Press ESC to resume or click outside to exit');
        } else {
          this.hintOverlay.style.display = 'none';
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Prevent default for WASD so page does not scroll
      if (['w', 'a', 's', 'd'].includes(key)) {
        e.preventDefault();
      }
    };

    this.onKeyUp = (e: KeyboardEvent) => {
      this.keysDown.delete(e.key.toLowerCase());
    };

    this.onMouseMove = (e: MouseEvent) => {
      if (!this.focused || this.disposed) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
    };

    this.onMouseDown = (e: MouseEvent) => {
      if (!this.focused || this.disposed) return;
      if (e.button === 0) {
        this.mouseDown = true;
      }
    };

    this.onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        this.mouseDown = false;
      }
    };

    this.onCanvasClick = (e: MouseEvent) => {
      if (this.disposed) return;

      // Handle game over restart
      if (this.gameOver) {
        this.restartGame();
        this.hintOverlay.style.display = 'none';
        this.lastTime = performance.now();
        return;
      }

      if (this.paused) {
        // Resume from pause
        this.paused = false;
        this.hintOverlay.style.display = 'none';
        this.lastTime = performance.now(); // reset dt to avoid jump
        return;
      }
      if (!this.focused) {
        this.focused = true;
        this.hintOverlay.style.display = 'none';
        this.lastTime = performance.now(); // reset dt to avoid jump
        // Capture initial mouse position
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
      }
    };

    // Clicking outside the canvas area releases focus
    const onDocumentClick = (e: MouseEvent) => {
      if (this.disposed) return;
      if (!container.contains(e.target as Node)) {
        if (this.focused && !this.paused) {
          this.releaseFocus();
        }
      }
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mouseup', this.onMouseUp);
    this.renderer.domElement.addEventListener('mousemove', this.onMouseMove);
    this.renderer.domElement.addEventListener('mousedown', this.onMouseDown);
    container.addEventListener('click', this.onCanvasClick);
    document.addEventListener('click', onDocumentClick);

    // Store document click handler for cleanup
    (this as any)._onDocumentClick = onDocumentClick;

    // -- Start loop --
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  private showOverlay(title: string, subtitle: string): void {
    this.hintOverlay.innerHTML =
      `<div style="color:#00ffff;font-family:monospace;font-size:16px;letter-spacing:2px;` +
      `text-shadow:0 0 10px #00ffff,0 0 20px #0088aa;margin-bottom:8px;">${title}</div>` +
      `<div style="color:#88aacc;font-family:monospace;font-size:11px;letter-spacing:1px;">${subtitle}</div>`;
    this.hintOverlay.style.display = 'flex';
  }

  private releaseFocus(): void {
    this.focused = false;
    this.mouseDown = false;
    this.keysDown.clear();
    this.showOverlay('CLICK TO PLAY', 'WASD: Move | Mouse: Aim | Click: Shoot | ESC: Pause');
  }

  // -----------------------------------------------------------------------
  // Surface initialization
  // -----------------------------------------------------------------------

  /** Pick a random surface type and create the Surface + transform function. */
  private initSurface(): void {
    const types = SurfaceFactory.getAvailableTypes();
    this.surfaceType = types[Math.floor(Math.random() * types.length)];
    this.surface = SurfaceFactory.create(this.surfaceType);

    // Compute bounding radius and derive scale
    const boundingRadius = computeSurfaceBoundingRadius(this.surface);
    this.surfaceScale = TARGET_RADIUS / boundingRadius;

    // Build the transform function for enemies
    this.surfaceTransformFn = makeSurfaceTransform(this.surface, this.surfaceScale);
  }

  /** Add the surface mesh + grid to the scene inside a scaled group. */
  private addSurfaceToScene(): void {
    this.surfaceGroup = new THREE.Group();
    this.surfaceGroup.scale.setScalar(this.surfaceScale);

    // Override surface materials for playground visibility
    if (this.surface.mesh.material instanceof THREE.Material) {
      this.surface.mesh.material.dispose();
    }
    this.surface.mesh.material = new THREE.MeshStandardMaterial({
      color: 0x0a0a2a,
      transparent: true,
      opacity: 0.95,
      roughness: 0.8,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    // Override grid material for consistent playground look
    if (this.surface.gridMesh.material instanceof THREE.Material) {
      this.surface.gridMesh.material.dispose();
    }
    this.surface.gridMesh.material = new THREE.LineBasicMaterial({
      color: 0x2a2aaa,
      transparent: true,
      opacity: 0.5,
    });

    this.surfaceGroup.add(this.surface.mesh);
    this.surfaceGroup.add(this.surface.gridMesh);
    this.scene.add(this.surfaceGroup);
  }

  /**
   * Get the world-space position for a UV coordinate on the surface,
   * accounting for the playground's uniform scaling.
   */
  private getScaledPoint(u: number, v: number): SurfacePoint {
    const pt = this.surface.getPoint(u, v);
    return {
      position: pt.position.multiplyScalar(this.surfaceScale),
      normal: pt.normal,
      tangentU: pt.tangentU,
      tangentV: pt.tangentV,
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  setWeapon(weaponType: string): void {
    const wt = weaponType as WeaponType;
    if (!WEAPON_CONFIGS[wt]) return;
    if (wt === this.activeWeapon) return;

    this.activeWeapon = wt;
    this.fireCooldown = 0;

    // Reset stats
    this.dps = 0;
    this.kills = 0;
    this.elapsed = 0;
    this.damageAccum = 0;
    this.dpsTimer = 0;

    // Reset lives and player state
    this.lives = STARTING_LIVES;
    this.playerAlive = true;
    this.respawnTimer = 0;
    this.deathFlashTimer = 0;
    this.gameOver = false;
    this.playerGroup.visible = true;
    this.hintOverlay.style.display = this.focused ? 'none' : 'flex';

    // Clear active projectiles and effects
    this.clearProjectiles();
    this.clearEffects();
    this.clearTeslaArcs();
    this.clearDeathEffects();

    // Remove old enemies and spawn fresh ones
    this.clearEnemies();
    for (let i = 0; i < ENEMY_COUNT; i++) {
      this.spawnRealEnemy(i);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    // Remove event listeners
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove);
    this.renderer.domElement.removeEventListener('mousedown', this.onMouseDown);
    this.container.removeEventListener('click', this.onCanvasClick);
    const docClickHandler = (this as any)._onDocumentClick;
    if (docClickHandler) {
      document.removeEventListener('click', docClickHandler);
    }

    this.clearProjectiles();
    this.clearEffects();
    this.clearTeslaArcs();
    this.clearDeathEffects();
    this.clearEnemies();

    // Dispose popups
    for (const p of this.popups) {
      p.element.remove();
    }
    this.popups = [];

    // Dispose particle system
    this.particleSystem.dispose();

    // Dispose surface
    this.surface.dispose();

    // Dispose Three.js
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.statsOverlay.remove();
    this.popupContainer.remove();
    this.hintOverlay.remove();
  }

  // -----------------------------------------------------------------------
  // Loop
  // -----------------------------------------------------------------------

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);

    // Clamp dt: floor at MIN_DT, cap at MAX_DT to avoid physics explosions
    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.max(MIN_DT, Math.min(rawDt, MAX_DT));

    // If not focused or paused, still render but do not simulate
    if (!this.focused || this.paused || this.gameOver) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.elapsed += dt;
    this.dpsTimer += dt;

    // DPS calculation (1-second rolling window)
    if (this.dpsTimer >= 1.0) {
      this.dps = Math.round(this.damageAccum / this.dpsTimer);
      this.damageAccum = 0;
      this.dpsTimer = 0;
    }

    this.updateMouseAim();
    this.updatePlayer(dt);
    this.updateCamera(dt);
    this.updateEnemies(dt);
    this.updatePlayerCollisions();
    this.updateDeathState(dt);
    if (this.playerAlive) {
      this.handleFiring(dt);
    }
    this.updateProjectiles(dt);
    this.updateEffects(dt);
    this.updateTeslaArcs(dt);
    this.updatePopups(dt);
    this.updateStats();
    this.particleSystem.update(dt);

    this.renderer.render(this.scene, this.camera);
  };

  // -----------------------------------------------------------------------
  // Mouse aim: raycast from screen to surface
  // -----------------------------------------------------------------------

  private updateMouseAim(): void {
    // Convert mouse position to NDC (-1 to 1)
    _mouseNDC.x = (this.mouseX / CANVAS_WIDTH) * 2 - 1;
    _mouseNDC.y = -(this.mouseY / CANVAS_HEIGHT) * 2 + 1;

    _raycaster.setFromCamera(_mouseNDC, this.camera);

    // Raycast against the scaled surface mesh
    const intersects = _raycaster.intersectObject(this.surfaceGroup, true);
    if (intersects.length > 0) {
      this.mouseOnSurface = true;
      // Hit point is in world space; unscale to get local surface coords
      const hitLocal = intersects[0].point.clone().multiplyScalar(1 / this.surfaceScale);
      const uv = this.surface.worldToSurface(hitLocal);
      this.aimU = uv.u;
      this.aimV = uv.v;
    } else {
      // Mouse is off the surface -- keep previous aim direction
      this.mouseOnSurface = false;
    }
  }

  // -----------------------------------------------------------------------
  // Player
  // -----------------------------------------------------------------------

  private updatePlayer(dt: number): void {
    if (!this.playerAlive) return;

    // WASD movement: screen-space input mapped to surface UV via camera orientation.
    // Without this mapping, WASD would move in raw UV directions which don't align
    // with the screen axes — causing controls to feel inverted or rotated depending
    // on camera position relative to the surface.
    let screenX = 0; // screen right (+) / left (-)
    let screenY = 0; // screen up (+) / down (-)
    if (this.keysDown.has('a')) screenX -= 1;
    if (this.keysDown.has('d')) screenX += 1;
    if (this.keysDown.has('w')) screenY += 1;
    if (this.keysDown.has('s')) screenY -= 1;

    // Normalize diagonal to avoid faster movement
    const moveLen = Math.sqrt(screenX * screenX + screenY * screenY);
    if (moveLen > 1) {
      screenX /= moveLen;
      screenY /= moveLen;
    }

    // Convert screen-space direction to UV-space using camera and surface tangent frame.
    // Camera right = +screenX, camera up = +screenY. We project these onto the surface
    // tangent plane, then decompose into tangentU (du) and tangentV (dv) components.
    const pt = this.getScaledPoint(this.playerU, this.playerV);
    const normal = pt.normal;
    const tangentU = pt.tangentU;
    const tangentV = pt.tangentV;

    // Get camera right and up vectors
    _v1.set(1, 0, 0).applyQuaternion(this.camera.quaternion); // camera right
    _v2.set(0, 1, 0).applyQuaternion(this.camera.quaternion); // camera up

    // Project camera right onto tangent plane (remove normal component)
    const rDotN = _v1.dot(normal);
    _v1.addScaledVector(normal, -rDotN);
    const rLen = _v1.length();
    if (rLen > 0.001) _v1.multiplyScalar(1 / rLen);

    // Project camera up onto tangent plane
    const uDotN = _v2.dot(normal);
    _v2.addScaledVector(normal, -uDotN);
    const uLen = _v2.length();
    if (uLen > 0.001) _v2.multiplyScalar(1 / uLen);

    // Decompose projected camera-right into tangentU/tangentV
    const rightU = _v1.dot(tangentU);
    const rightV = _v1.dot(tangentV);

    // Decompose projected camera-up into tangentU/tangentV
    const upU = _v2.dot(tangentU);
    const upV = _v2.dot(tangentV);

    // Map screen input to UV deltas
    const du = screenX * rightU + screenY * upU;
    const dv = screenX * rightV + screenY * upV;

    const speed = PLAYER_MOVE_SPEED * dt;
    const newUV = this.surface.moveOnSurface(this.playerU, this.playerV, du * speed, dv * speed);
    this.playerU = newUV.u;
    this.playerV = newUV.v;

    const pt = this.getScaledPoint(this.playerU, this.playerV);
    this.playerGroup.position.copy(pt.position);

    // Orient: up = surface normal, forward = aim direction on surface
    const aimPt = this.getScaledPoint(this.aimU, this.aimV);
    const toAim = aimPt.position.clone().sub(pt.position);

    // Project toAim onto the tangent plane (remove normal component)
    const normalComp = toAim.dot(pt.normal);
    toAim.sub(pt.normal.clone().multiplyScalar(normalComp));
    const aimLen = toAim.length();

    if (aimLen > 0.001) {
      toAim.multiplyScalar(1 / aimLen);
      const target = pt.position.clone().add(toAim);
      this.playerGroup.up.copy(pt.normal);
      this.playerGroup.lookAt(target);
    } else {
      // Fallback: aim along tangentU
      const target = pt.position.clone().add(pt.tangentU);
      this.playerGroup.up.copy(pt.normal);
      this.playerGroup.lookAt(target);
    }
  }

  // -----------------------------------------------------------------------
  // Camera follow: smoothly track the player position
  // -----------------------------------------------------------------------

  private updateCamera(dt: number): void {
    // Compute desired camera position: offset from player position along the
    // surface normal, keeping the same relative distance as the initial setup.
    const playerPos = this.playerGroup.position;
    const pt = this.getScaledPoint(this.playerU, this.playerV);

    // Camera sits above the player along the surface normal at CAMERA_DISTANCE
    const desiredPos = playerPos.clone().add(pt.normal.clone().multiplyScalar(CAMERA_DISTANCE));

    // Smooth lerp toward desired position (higher factor = snappier tracking)
    const lerpFactor = 1 - Math.exp(-5 * dt);
    this.camera.position.lerp(desiredPos, lerpFactor);

    // Always look at the player
    this.camera.lookAt(playerPos);
  }

  // -----------------------------------------------------------------------
  // Player collision detection (enemy touches player -> death)
  // -----------------------------------------------------------------------

  private updatePlayerCollisions(): void {
    if (!this.playerAlive) return;

    for (let i = 0; i < this.enemies.length; i++) {
      const entry = this.enemies[i];
      if (!entry.enemy.alive) continue;

      const dist = entry.enemy.position.distanceTo(this.playerGroup.position);
      if (dist < PLAYER_DEATH_RADIUS + entry.enemy.radius) {
        this.killPlayer();
        return;
      }
    }
  }

  private killPlayer(): void {
    this.playerAlive = false;
    this.lives--;
    this.deathFlashTimer = DEATH_FLASH_DURATION;
    this.playerGroup.visible = false;
    this.mouseDown = false;

    // Spawn death explosion effect
    this.spawnDeathExplosion(this.playerGroup.position);

    if (this.lives <= 0) {
      this.gameOver = true;
      this.showOverlay(
        'GAME OVER',
        `Kills: ${this.kills} | Time: ${this.elapsed.toFixed(1)}s<br>` +
        '<span style="margin-top:8px;display:inline-block;">Click to restart</span>',
      );
    } else {
      this.respawnTimer = PLAYER_RESPAWN_DELAY;
    }
  }

  private spawnDeathExplosion(pos: THREE.Vector3): void {
    // Use surface tangents at player position for explosion directions
    const pt = this.getScaledPoint(this.playerU, this.playerV);
    const normal = pt.normal;
    const tangentA = pt.tangentU;
    const tangentB = pt.tangentV;

    // Expanding ring of particles
    const ringCount = 12;
    for (let i = 0; i < ringCount; i++) {
      const angle = (i / ringCount) * Math.PI * 2;
      const dir = tangentA.clone().multiplyScalar(Math.cos(angle)).add(tangentB.clone().multiplyScalar(Math.sin(angle)));

      const geo = new THREE.SphereGeometry(0.04, 4, 4);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 1.0,
      });
      const particle = new THREE.Mesh(geo, mat);
      particle.position.copy(pos);
      // Store velocity in userData along with surface normal for re-projection
      particle.userData = { dir: dir.clone(), speed: 3.0, age: 0, normal: normal.clone() };
      this.scene.add(particle);
      this.deathEffects.push(particle);
    }

    // Central flash
    const flashGeo = new THREE.SphereGeometry(0.5, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(pos);
    flash.userData = { dir: new THREE.Vector3(), speed: 0, age: 0, isFlash: true };
    this.scene.add(flash);
    this.deathEffects.push(flash);
  }

  private updateDeathState(dt: number): void {
    // Update death explosion particles
    for (let i = this.deathEffects.length - 1; i >= 0; i--) {
      const p = this.deathEffects[i] as THREE.Mesh;
      const ud = p.userData;
      ud.age += dt;

      if (ud.isFlash) {
        // Flash expands and fades
        const scale = 1 + ud.age * 4;
        p.scale.set(scale, scale, scale);
        const mat = p.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, 0.9 - ud.age * 2.5);
      } else {
        // Particles fly outward along the surface tangent plane
        p.position.add(ud.dir.clone().multiplyScalar(ud.speed * dt));
        ud.speed *= 0.95; // decelerate
        const mat = p.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, 1.0 - ud.age * 2.0);
      }

      if (ud.age > 0.6) {
        this.scene.remove(p);
        p.geometry.dispose();
        this.deathEffects.splice(i, 1);
      }
    }

    // Death flash timer (screen tint effect via background color flicker)
    if (this.deathFlashTimer > 0) {
      this.deathFlashTimer -= dt;
      const flashIntensity = this.deathFlashTimer / DEATH_FLASH_DURATION;
      const r = Math.floor(5 + flashIntensity * 60);
      const g = Math.floor(5 + flashIntensity * 30);
      const b = Math.floor(16 + flashIntensity * 20);
      (this.scene.background as THREE.Color).setRGB(r / 255, g / 255, b / 255);
      if (this.deathFlashTimer <= 0) {
        (this.scene.background as THREE.Color).setHex(0x050510);
      }
    }

    // Handle respawn countdown
    if (!this.playerAlive && !this.gameOver) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.respawnPlayer();
      }
    }
  }

  private respawnPlayer(): void {
    this.playerAlive = true;
    this.playerGroup.visible = true;

    // Move player to a safe location (away from all enemies) using UV coordinates
    let bestU = (this.playerU + 0.5) % 1;
    let bestV = 0.5;
    let bestMinDist = 0;

    // Try a few random positions and pick the one farthest from all enemies
    for (let attempt = 0; attempt < 12; attempt++) {
      const tryU = Math.random();
      const tryV = 0.1 + Math.random() * 0.8;
      const tryPt = this.getScaledPoint(tryU, tryV);

      let minDist = Infinity;
      for (const entry of this.enemies) {
        if (!entry.enemy.alive) continue;
        const d = tryPt.position.distanceTo(entry.enemy.position);
        if (d < minDist) minDist = d;
      }

      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestU = tryU;
        bestV = tryV;
      }
    }

    this.playerU = bestU;
    this.playerV = bestV;

    const pt = this.getScaledPoint(this.playerU, this.playerV);
    this.playerGroup.position.copy(pt.position);

    // Brief invincibility flash handled visually with a blink
    this.deathFlashTimer = 0;
  }

  private restartGame(): void {
    this.lives = STARTING_LIVES;
    this.playerAlive = true;
    this.gameOver = false;
    this.respawnTimer = 0;
    this.deathFlashTimer = 0;
    this.playerGroup.visible = true;
    this.mouseDown = false;

    // Reset UV position
    this.playerU = 0.25;
    this.playerV = 0.5;

    // Reset stats
    this.dps = 0;
    this.kills = 0;
    this.elapsed = 0;
    this.damageAccum = 0;
    this.dpsTimer = 0;
    this.fireCooldown = 0;

    // Clear everything
    this.clearProjectiles();
    this.clearEffects();
    this.clearTeslaArcs();
    this.clearDeathEffects();

    // Remove old enemies and spawn fresh ones
    this.clearEnemies();
    for (let i = 0; i < ENEMY_COUNT; i++) {
      this.spawnRealEnemy(i);
    }

    (this.scene.background as THREE.Color).setHex(0x050510);
  }

  private clearDeathEffects(): void {
    for (let i = this.deathEffects.length - 1; i >= 0; i--) {
      const p = this.deathEffects[i] as THREE.Mesh;
      this.scene.remove(p);
      p.geometry.dispose();
    }
    this.deathEffects = [];
  }

  // -----------------------------------------------------------------------
  // Real enemies (imported from src/entities/enemies/)
  // -----------------------------------------------------------------------

  /** Create a real enemy instance based on type and UV position. */
  private createRealEnemy(type: PlaygroundEnemyType, u: number, v: number): BaseEnemy {
    switch (type) {
      case 'grunt': return new Grunt(u, v);
      case 'wanderer': return new Wanderer(u, v);
      case 'duck': return new Duck(u, v);
      case 'weaver': return new Weaver(u, v);
      case 'spinner': return new Spinner(u, v);
      case 'rocket': return new Rocket(u, v);
      default: return new Grunt(u, v);
    }
  }

  /** Spawn a real enemy at a random position away from the player. */
  private spawnRealEnemy(index: number): void {
    const type = ENEMY_TYPES[index % ENEMY_TYPES.length];

    // Find a position away from the player in UV space
    let u: number, v: number;
    for (let attempt = 0; attempt < 20; attempt++) {
      u = Math.random();
      v = 0.1 + Math.random() * 0.8;
      const du = Math.abs(u - this.playerU);
      const dv = Math.abs(v - this.playerV);
      if (Math.sqrt(du * du + dv * dv) > 0.25) break;
    }
    u = u!;
    v = v!;

    const enemy = this.createRealEnemy(type, u, v);

    // Scale the enemy's collision radius to match the visual mesh scale.
    enemy.radius *= ENEMY_SCALE;

    // Apply surface transform to position the enemy on the surface
    enemy.applySurfaceTransform(this.surfaceTransformFn);

    // Add enemy mesh to scene
    if (enemy.mesh) {
      this.scene.add(enemy.mesh);
      enemy.mesh.scale.setScalar(ENEMY_SCALE);
    }

    const entry: PlaygroundEnemyEntry = {
      enemy,
      type,
      respawnTimer: 0,
    };

    if (index < this.enemies.length) {
      this.enemies[index] = entry;
    } else {
      this.enemies.push(entry);
    }
  }

  /** Remove all enemies from the scene and clear the list. */
  private clearEnemies(): void {
    for (const entry of this.enemies) {
      if (entry.enemy.mesh) {
        this.scene.remove(entry.enemy.mesh);
      }
      entry.enemy.destroy();
    }
    this.enemies = [];
  }

  /** Get player UV position for enemy AI targeting. */
  private getPlayerUV(): { u: number; v: number } {
    return { u: this.playerU, v: this.playerV };
  }

  private updateEnemies(dt: number): void {
    const playerUV = this.getPlayerUV();

    for (let i = 0; i < this.enemies.length; i++) {
      const entry = this.enemies[i];

      if (!entry.enemy.alive) {
        entry.respawnTimer -= dt;
        if (entry.respawnTimer <= 0) {
          // Respawn: remove old mesh, create new enemy
          if (entry.enemy.mesh) {
            this.scene.remove(entry.enemy.mesh);
          }
          entry.enemy.destroy();

          // Pick a random type for variety
          const newType = ENEMY_TYPES[Math.floor(Math.random() * ENEMY_TYPES.length)];

          // Find position away from player
          let u = Math.random();
          let v = 0.1 + Math.random() * 0.8;
          for (let attempt = 0; attempt < 20; attempt++) {
            u = Math.random();
            v = 0.1 + Math.random() * 0.8;
            const du = Math.abs(u - playerUV.u);
            const dv = Math.abs(v - playerUV.v);
            if (Math.sqrt(du * du + dv * dv) > 0.25) break;
          }

          const newEnemy = this.createRealEnemy(newType, u, v);
          newEnemy.radius *= ENEMY_SCALE;
          newEnemy.applySurfaceTransform(this.surfaceTransformFn);
          if (newEnemy.mesh) {
            this.scene.add(newEnemy.mesh);
            newEnemy.mesh.scale.setScalar(ENEMY_SCALE);
          }

          entry.enemy = newEnemy;
          entry.type = newType;
          entry.respawnTimer = 0;
        }
        continue;
      }

      // Update enemy AI using real behavior (pass player UV position)
      if (this.playerAlive) {
        entry.enemy.setPlayerPosition(playerUV.u, playerUV.v);
      }
      entry.enemy.update(dt);

      // Re-apply surface transform to move mesh to correct surface position
      entry.enemy.applySurfaceTransform(this.surfaceTransformFn);

      // Keep scale correct (in case the enemy reset it)
      if (entry.enemy.mesh) {
        const currentScale = entry.enemy.mesh.scale.x;
        if (Math.abs(currentScale - ENEMY_SCALE) > 0.01) {
          entry.enemy.mesh.scale.setScalar(ENEMY_SCALE);
        }
      }
    }
  }

  private damageEnemy(index: number, damage: number): void {
    const entry = this.enemies[index];
    if (!entry || !entry.enemy.alive) return;

    entry.enemy.takeDamage(damage);
    this.damageAccum += damage;

    // Spawn damage popup
    this.spawnPopup(entry.enemy.position, damage);

    if (!entry.enemy.alive) {
      // Enemy died via takeDamage -> die()
      // Spawn death particle effects (same as main game) before hiding mesh
      const enemyColor = new THREE.Color(ENEMY_COLORS[entry.type] ?? 0xff4444);
      this.particleSystem.enemyDeath(entry.enemy.position.clone(), enemyColor);

      if (entry.enemy.mesh) {
        entry.enemy.mesh.visible = false;
      }
      entry.respawnTimer = ENEMY_RESPAWN_DELAY;
      this.kills++;
    }
  }

  // -----------------------------------------------------------------------
  // Firing (mouse-controlled)
  // Uses the same dual-gating as the real game:
  // effective cooldown = max(1/weaponFireRate, 1/playerBaseFireRate)
  // This ensures fire rates exactly match the actual game.
  // -----------------------------------------------------------------------

  private handleFiring(dt: number): void {
    this.fireCooldown -= dt;

    // Only fire when mouse is held down
    if (!this.mouseDown) return;
    if (this.fireCooldown > 0) return;

    const cfg = WEAPON_CONFIGS[this.activeWeapon];

    // Dual-gating: weapon fire rate AND player base fire rate (matches real game)
    // In the real game, Player.update fires at FIRE_RATE=10/sec, and WeaponManager.canFire
    // checks its own 1/cfg.fireRate cooldown. The effective rate is the slower of the two.
    const weaponInterval = 1 / cfg.fireRate;
    this.fireCooldown = Math.max(weaponInterval, PLAYER_FIRE_INTERVAL);

    const playerPos = this.playerGroup.position.clone();
    const aimDir = this.getAimDirection();

    switch (this.activeWeapon) {
      case WeaponType.Standard:
        this.fireProjectile(playerPos, aimDir, cfg, 0x88ffff, 0.04);
        break;

      case WeaponType.Spread:
        this.fireSpread(playerPos, aimDir, cfg);
        break;

      case WeaponType.Piercing:
        this.firePiercing(playerPos, aimDir, cfg);
        break;

      case WeaponType.ChainLightning:
        this.fireChainLightning(playerPos, cfg);
        break;

      case WeaponType.Homing:
        this.fireHoming(playerPos, aimDir, cfg);
        break;

      case WeaponType.PlasmaMortar:
        this.fireProjectile(playerPos, aimDir, cfg, 0x44ff44, 0.18);
        break;

      case WeaponType.GravityGun:
        this.fireGravityGun(playerPos, aimDir, cfg);
        break;

      case WeaponType.LaserBeam:
        this.fireLaserBeam(playerPos, aimDir, cfg);
        break;

      case WeaponType.BlackHole:
        this.fireBlackHole(playerPos, aimDir, cfg);
        break;

      case WeaponType.TeslaCoil:
        this.fireTeslaCoil(playerPos, cfg);
        break;
    }
  }

  private getAimDirection(): THREE.Vector3 {
    // Compute direction from player to the aim point on the surface
    const playerPt = this.getScaledPoint(this.playerU, this.playerV);
    const aimPt = this.getScaledPoint(this.aimU, this.aimV);

    const dir = aimPt.position.clone().sub(playerPt.position);

    // Project onto tangent plane (remove normal component)
    const normalComp = dir.dot(playerPt.normal);
    dir.sub(playerPt.normal.clone().multiplyScalar(normalComp));

    const len = dir.length();
    if (len > 0.001) {
      dir.multiplyScalar(1 / len);
    } else {
      // Fallback: aim along tangentU
      return playerPt.tangentU.clone();
    }
    return dir;
  }

  // -----------------------------------------------------------------------
  // Weapon-specific firing
  // -----------------------------------------------------------------------

  private fireProjectile(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    cfg: typeof WEAPON_CONFIGS[WeaponType],
    color: number,
    size: number,
    maxAge?: number,
  ): MiniProjectile {
    const geo = new THREE.SphereGeometry(size, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    this.scene.add(mesh);

    const proj: MiniProjectile = {
      mesh,
      position: origin.clone(),
      direction: direction.clone().normalize(),
      speed: cfg.projectileSpeed > 0 ? cfg.projectileSpeed : 6,
      age: 0,
      maxAge: maxAge ?? 3,
      type: this.activeWeapon,
      targetIdx: -1,
      hitSet: new Set(),
    };
    this.projectiles.push(proj);
    return proj;
  }

  private fireSpread(origin: THREE.Vector3, direction: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    const playerPt = this.getScaledPoint(this.playerU, this.playerV);
    const normal = playerPt.normal;
    const spreadAngle = Math.PI / 6;
    for (let i = 0; i < 5; i++) {
      const angle = (i - 2) * (spreadAngle / 4);
      const dir = direction.clone().applyAxisAngle(normal, angle);
      this.fireProjectile(origin, dir, cfg, 0x44ffff, 0.04);
    }
  }

  private firePiercing(origin: THREE.Vector3, direction: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    // Instant beam: draw a line and damage everything in path
    const beamLength = TARGET_RADIUS * 3;
    const points: THREE.Vector3[] = [];
    let pos = origin.clone();
    let dir = direction.clone().normalize();

    for (let i = 0; i <= 20; i++) {
      points.push(pos.clone());
      pos.add(dir.clone().multiplyScalar(beamLength / 20));
      // Re-project onto surface via worldToSurface -> getPoint
      const localPos = pos.clone().multiplyScalar(1 / this.surfaceScale);
      const uv = this.surface.worldToSurface(localPos);
      const projPt = this.getScaledPoint(uv.u, uv.v);
      pos.copy(projPt.position);
      // Re-tangentize
      dir.sub(projPt.normal.clone().multiplyScalar(dir.dot(projPt.normal)));
      const l = dir.length();
      if (l > 0.001) dir.multiplyScalar(1 / l);
    }

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.activeEffectMeshes.push(line);
    this.activeEffectTimers.push(0.25);

    // Damage enemies along the beam
    for (let i = 0; i < this.enemies.length; i++) {
      const entry = this.enemies[i];
      if (!entry.enemy.alive) continue;
      for (let s = 0; s < points.length - 1; s++) {
        const d = this.distToSegment(entry.enemy.position, points[s], points[s + 1]);
        if (d < 0.4) {
          this.damageEnemy(i, cfg.damage);
          break;
        }
      }
    }
  }

  private fireChainLightning(origin: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    // Find alive enemies sorted by distance
    const alive = this.enemies
      .map((entry, i) => ({ entry, i, dist: entry.enemy.position.distanceTo(origin) }))
      .filter(x => x.entry.enemy.alive)
      .sort((a, b) => a.dist - b.dist);

    if (alive.length === 0) return;

    const chainCount = Math.min(6, alive.length);
    let prevPos = origin.clone();
    let dmgMult = 1.0;

    for (let c = 0; c < chainCount; c++) {
      const target = alive[c];
      const points = this.generateLightningPoints(prevPos, target.entry.enemy.position, 8);
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const color = c === 0 ? 0xaaffff : 0x8844ff;
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
      const line = new THREE.Line(geo, mat);
      this.scene.add(line);
      this.activeEffectMeshes.push(line);
      this.activeEffectTimers.push(0.3);

      this.damageEnemy(target.i, cfg.damage * dmgMult);
      prevPos = target.entry.enemy.position.clone();
      dmgMult *= 0.75;
    }
  }

  private fireHoming(origin: THREE.Vector3, direction: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    const proj = this.fireProjectile(origin, direction, cfg, 0xff4444, 0.06, 5);
    // Find nearest alive enemy
    let minDist = Infinity;
    let targetIdx = -1;
    for (let i = 0; i < this.enemies.length; i++) {
      if (!this.enemies[i].enemy.alive) continue;
      const d = this.enemies[i].enemy.position.distanceTo(origin);
      if (d < minDist) { minDist = d; targetIdx = i; }
    }
    proj.targetIdx = targetIdx;
    proj.type = WeaponType.Homing;
  }

  private fireGravityGun(origin: THREE.Vector3, direction: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    // Purple beam pulling enemies inward
    const endPos = origin.clone().add(direction.clone().multiplyScalar(TARGET_RADIUS * 1.5));
    // Re-project onto surface
    const localEnd = endPos.clone().multiplyScalar(1 / this.surfaceScale);
    const endUV = this.surface.worldToSurface(localEnd);
    const endPt = this.getScaledPoint(endUV.u, endUV.v);
    endPos.copy(endPt.position);

    const geo = new THREE.BufferGeometry().setFromPoints([origin, endPos]);
    const mat = new THREE.LineBasicMaterial({ color: 0x8844ff, transparent: true, opacity: 0.7, linewidth: 2 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.activeEffectMeshes.push(line);
    this.activeEffectTimers.push(0.5);

    // Pull and damage nearby enemies
    for (let i = 0; i < this.enemies.length; i++) {
      const entry = this.enemies[i];
      if (!entry.enemy.alive) continue;
      const d = entry.enemy.position.distanceTo(endPos);
      if (d < 2.0) {
        this.damageEnemy(i, cfg.damage);
        // Pull toward beam end by shifting UV position
        const enemyPos = entry.enemy.position;
        const pull = endPos.clone().sub(enemyPos).normalize().multiplyScalar(0.02);
        // Convert pull to UV delta
        entry.enemy.surfacePosition.u += pull.x * 0.1;
        entry.enemy.surfacePosition.v += pull.z * 0.1;
        entry.enemy.surfacePosition.u = Math.max(0, Math.min(1, entry.enemy.surfacePosition.u));
        entry.enemy.surfacePosition.v = Math.max(0, Math.min(1, entry.enemy.surfacePosition.v));
      }
    }
  }

  private fireLaserBeam(origin: THREE.Vector3, direction: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    // Sustained red beam along surface
    const beamLength = TARGET_RADIUS * 2.5;
    const points: THREE.Vector3[] = [];
    let pos = origin.clone();
    let dir = direction.clone().normalize();

    for (let i = 0; i <= 16; i++) {
      points.push(pos.clone());
      pos.add(dir.clone().multiplyScalar(beamLength / 16));
      // Re-project onto surface
      const localPos = pos.clone().multiplyScalar(1 / this.surfaceScale);
      const uv = this.surface.worldToSurface(localPos);
      const projPt = this.getScaledPoint(uv.u, uv.v);
      pos.copy(projPt.position);
      dir.sub(projPt.normal.clone().multiplyScalar(dir.dot(projPt.normal)));
      const l = dir.length();
      if (l > 0.001) dir.multiplyScalar(1 / l);
    }

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.activeEffectMeshes.push(line);
    this.activeEffectTimers.push(0.12);

    // Damage enemies along the beam
    for (let i = 0; i < this.enemies.length; i++) {
      const entry = this.enemies[i];
      if (!entry.enemy.alive) continue;
      for (let s = 0; s < points.length - 1; s++) {
        if (this.distToSegment(entry.enemy.position, points[s], points[s + 1]) < 0.35) {
          this.damageEnemy(i, cfg.damage * 0.5);
          break;
        }
      }
    }
  }

  private fireBlackHole(origin: THREE.Vector3, direction: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    const targetPos = origin.clone().add(direction.clone().multiplyScalar(TARGET_RADIUS * 0.8));
    // Re-project onto surface
    const localTarget = targetPos.clone().multiplyScalar(1 / this.surfaceScale);
    const targetUV = this.surface.worldToSurface(localTarget);
    const targetPt = this.getScaledPoint(targetUV.u, targetUV.v);
    targetPos.copy(targetPt.position);

    const geo = new THREE.SphereGeometry(0.25, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0x220044, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(targetPos);
    this.scene.add(mesh);
    this.activeEffectMeshes.push(mesh);
    this.activeEffectTimers.push(2.0);

    // Ring around black hole
    const ringGeo = new THREE.TorusGeometry(0.4, 0.03, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x6600aa, transparent: true, opacity: 0.6 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(targetPos);
    ring.lookAt(0, 0, 0);
    this.scene.add(ring);
    this.activeEffectMeshes.push(ring);
    this.activeEffectTimers.push(2.0);

    // Instant kill nearby enemies
    for (let i = 0; i < this.enemies.length; i++) {
      const entry = this.enemies[i];
      if (!entry.enemy.alive) continue;
      const d = entry.enemy.position.distanceTo(targetPos);
      if (d < 1.5) {
        this.damageEnemy(i, cfg.damage);
      }
    }
  }

  private fireTeslaCoil(origin: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    // Find nearby alive enemies within tesla range
    const nearbyEnemies: { index: number; pos: THREE.Vector3 }[] = [];
    for (let i = 0; i < this.enemies.length; i++) {
      const entry = this.enemies[i];
      if (!entry.enemy.alive) continue;
      const d = entry.enemy.position.distanceTo(origin);
      if (d < TESLA_ARC_RANGE) {
        nearbyEnemies.push({ index: i, pos: entry.enemy.position.clone() });
      }
    }

    // Spawn persistent electric arcs from player to nearby enemies
    if (nearbyEnemies.length > 0) {
      for (let a = 0; a < TESLA_ARC_COUNT; a++) {
        // Pick a random nearby enemy to arc toward
        const target = nearbyEnemies[Math.floor(Math.random() * nearbyEnemies.length)];
        const arcPoints = this.generateLightningPoints(origin, target.pos, 10 + Math.floor(Math.random() * 6));
        const geo = new THREE.BufferGeometry().setFromPoints(arcPoints);

        // Vary arc colors between cyan, white, and blue-purple
        const arcColors = [0x88ccff, 0xaaffff, 0x6688ff, 0xccddff, 0x4466ee];
        const color = arcColors[Math.floor(Math.random() * arcColors.length)];
        const opacity = 0.5 + Math.random() * 0.4;

        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);

        const arcLife = TESLA_ARC_PERSIST * (0.6 + Math.random() * 0.8);
        this.teslaArcs.push({
          line,
          age: 0,
          maxAge: arcLife,
          initialOpacity: opacity,
        });
      }

      // Also spawn some random ambient arcs between nearby points on the surface
      // near the player for visual flair
      const playerPt = this.getScaledPoint(this.playerU, this.playerV);
      for (let a = 0; a < 2; a++) {
        const tangentA = playerPt.tangentU;
        const tangentB = playerPt.tangentV;

        const angle1 = Math.random() * Math.PI * 2;
        const angle2 = Math.random() * Math.PI * 2;
        const radius1 = 0.3 + Math.random() * 0.8;
        const radius2 = 0.3 + Math.random() * 0.8;

        const p1 = origin.clone()
          .add(tangentA.clone().multiplyScalar(Math.cos(angle1) * radius1))
          .add(tangentB.clone().multiplyScalar(Math.sin(angle1) * radius1));

        const p2 = origin.clone()
          .add(tangentA.clone().multiplyScalar(Math.cos(angle2) * radius2))
          .add(tangentB.clone().multiplyScalar(Math.sin(angle2) * radius2));

        const arcPoints = this.generateLightningPoints(p1, p2, 5 + Math.floor(Math.random() * 4));
        const geo = new THREE.BufferGeometry().setFromPoints(arcPoints);
        const opacity = 0.2 + Math.random() * 0.3;
        const mat = new THREE.LineBasicMaterial({ color: 0x4466aa, transparent: true, opacity });
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);

        this.teslaArcs.push({
          line,
          age: 0,
          maxAge: TESLA_ARC_PERSIST * (0.3 + Math.random() * 0.5),
          initialOpacity: opacity,
        });
      }
    }

    // Damage nearby enemies
    for (const target of nearbyEnemies) {
      this.damageEnemy(target.index, cfg.damage * 0.5);
    }
  }

  // -----------------------------------------------------------------------
  // Tesla arc update (persistent arcs that fade over time)
  // -----------------------------------------------------------------------

  private updateTeslaArcs(dt: number): void {
    for (let i = this.teslaArcs.length - 1; i >= 0; i--) {
      const arc = this.teslaArcs[i];
      arc.age += dt;

      if (arc.age >= arc.maxAge) {
        this.scene.remove(arc.line);
        arc.line.geometry.dispose();
        (arc.line.material as THREE.LineBasicMaterial).dispose();
        this.teslaArcs.splice(i, 1);
        continue;
      }

      // Fade out over the arc's lifetime
      const progress = arc.age / arc.maxAge;
      const mat = arc.line.material as THREE.LineBasicMaterial;
      mat.opacity = arc.initialOpacity * (1 - progress * progress); // quadratic fade
    }
  }

  private clearTeslaArcs(): void {
    for (let i = this.teslaArcs.length - 1; i >= 0; i--) {
      const arc = this.teslaArcs[i];
      this.scene.remove(arc.line);
      arc.line.geometry.dispose();
      (arc.line.material as THREE.LineBasicMaterial).dispose();
    }
    this.teslaArcs = [];
  }

  // -----------------------------------------------------------------------
  // Projectile update
  // -----------------------------------------------------------------------

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.removeProjectile(i);
        continue;
      }

      // Homing: steer toward target
      if (p.type === WeaponType.Homing && p.targetIdx >= 0) {
        const target = this.enemies[p.targetIdx];
        if (target && target.enemy.alive) {
          const toTarget = target.enemy.position.clone().sub(p.position).normalize();
          p.direction.lerp(toTarget, 4.0 * dt).normalize();
        } else {
          // Re-target nearest
          let minDist = Infinity;
          for (let j = 0; j < this.enemies.length; j++) {
            if (!this.enemies[j].enemy.alive) continue;
            const d = this.enemies[j].enemy.position.distanceTo(p.position);
            if (d < minDist) { minDist = d; p.targetIdx = j; }
          }
        }
      }

      // Move
      p.position.add(p.direction.clone().multiplyScalar(p.speed * dt));
      // Re-project onto surface via worldToSurface -> getPoint
      const localPos = p.position.clone().multiplyScalar(1 / this.surfaceScale);
      const projUV = this.surface.worldToSurface(localPos);
      const projPt = this.getScaledPoint(projUV.u, projUV.v);
      p.position.copy(projPt.position);
      // Re-tangentize direction using surface normal
      const dot = p.direction.dot(projPt.normal);
      p.direction.sub(projPt.normal.clone().multiplyScalar(dot));
      const dirLen = p.direction.length();
      if (dirLen > 0.001) p.direction.multiplyScalar(1 / dirLen);

      p.mesh.position.copy(p.position);

      // Collision with enemies
      const isPiercing = p.type === WeaponType.Piercing;
      for (let j = 0; j < this.enemies.length; j++) {
        const entry = this.enemies[j];
        if (!entry.enemy.alive) continue;
        if (isPiercing && p.hitSet.has(j)) continue;

        const d = entry.enemy.position.distanceTo(p.position);
        if (d < PROJECTILE_HIT_RADIUS) {
          const cfg = WEAPON_CONFIGS[this.activeWeapon];
          this.damageEnemy(j, cfg.damage);
          if (isPiercing) {
            p.hitSet.add(j);
          } else {
            this.removeProjectile(i);
            break;
          }
        }
      }
    }
  }

  private removeProjectile(index: number): void {
    const p = this.projectiles[index];
    this.scene.remove(p.mesh);
    if (p.mesh instanceof THREE.Mesh) {
      p.mesh.geometry.dispose();
    }
    this.projectiles.splice(index, 1);
  }

  private clearProjectiles(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.removeProjectile(i);
    }
  }

  // -----------------------------------------------------------------------
  // Effect update (beams, fields, etc.)
  // -----------------------------------------------------------------------

  private updateEffects(dt: number): void {
    for (let i = this.activeEffectTimers.length - 1; i >= 0; i--) {
      this.activeEffectTimers[i] -= dt;
      if (this.activeEffectTimers[i] <= 0) {
        const mesh = this.activeEffectMeshes[i];
        this.scene.remove(mesh);
        if (mesh instanceof THREE.Mesh) {
          mesh.geometry.dispose();
        } else if (mesh instanceof THREE.Line) {
          mesh.geometry.dispose();
        }
        this.activeEffectMeshes.splice(i, 1);
        this.activeEffectTimers.splice(i, 1);
      } else {
        // Fade out
        const mesh = this.activeEffectMeshes[i];
        if (mesh instanceof THREE.Mesh || mesh instanceof THREE.Line) {
          const mat = (mesh as THREE.Mesh).material;
          if (mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.LineBasicMaterial) {
            const progress = 1 - this.activeEffectTimers[i] / 0.5;
            if (progress > 0.5) {
              mat.opacity = Math.max(0, mat.opacity - dt * 2);
            }
          }
        }
      }
    }
  }

  private clearEffects(): void {
    for (let i = this.activeEffectMeshes.length - 1; i >= 0; i--) {
      const mesh = this.activeEffectMeshes[i];
      this.scene.remove(mesh);
      if (mesh instanceof THREE.Mesh) {
        mesh.geometry.dispose();
      } else if (mesh instanceof THREE.Line) {
        mesh.geometry.dispose();
      }
    }
    this.activeEffectMeshes = [];
    this.activeEffectTimers = [];
  }

  // -----------------------------------------------------------------------
  // Damage popups
  // -----------------------------------------------------------------------

  private spawnPopup(worldPos: THREE.Vector3, damage: number): void {
    // Project world position to screen coordinates
    _v1.copy(worldPos);
    _v1.project(this.camera);
    const screenX = ((_v1.x + 1) / 2) * CANVAS_WIDTH;
    const screenY = ((1 - _v1.y) / 2) * CANVAS_HEIGHT;

    // If behind camera, skip
    if (_v1.z > 1) return;

    const el = document.createElement('div');
    el.textContent = damage >= 1 ? Math.round(damage).toString() : damage.toFixed(1);
    el.style.cssText =
      `position:absolute;color:#ffff44;font-size:12px;font-weight:bold;font-family:monospace;` +
      `pointer-events:none;text-shadow:0 0 4px #ff8800;white-space:nowrap;z-index:10;` +
      `left:${screenX}px;top:${screenY - CANVAS_HEIGHT - 40}px;transition:all 0.6s ease-out;opacity:1;`;
    this.popupContainer.appendChild(el);

    // Animate up + fade
    requestAnimationFrame(() => {
      el.style.transform = 'translateY(-20px)';
      el.style.opacity = '0';
    });

    this.popups.push({ element: el, age: 0 });
  }

  private updatePopups(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      this.popups[i].age += dt;
      if (this.popups[i].age > 0.7) {
        this.popups[i].element.remove();
        this.popups.splice(i, 1);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Stats overlay
  // -----------------------------------------------------------------------

  private updateStats(): void {
    const livesEl = this.statsOverlay.querySelector('#pg-lives');
    const dpsEl = this.statsOverlay.querySelector('#pg-dps');
    const killsEl = this.statsOverlay.querySelector('#pg-kills');
    const timeEl = this.statsOverlay.querySelector('#pg-time');
    if (livesEl) livesEl.textContent = `LIVES: ${this.lives}`;
    if (dpsEl) dpsEl.textContent = `DPS: ${this.dps}`;
    if (killsEl) killsEl.textContent = `KILLS: ${this.kills}`;
    if (timeEl) timeEl.textContent = `${this.elapsed.toFixed(1)}s`;
    // Surface name is set once in constructor, no need to update
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildMiniChevron(color: number, scale: number): THREE.Group {
    const group = new THREE.Group();
    // Simple triangle-based chevron using MeshBasicMaterial
    const shape = new THREE.Shape();
    shape.moveTo(0, scale);           // nose
    shape.lineTo(-scale * 0.6, -scale * 0.5);
    shape.lineTo(0, -scale * 0.2);    // notch
    shape.lineTo(scale * 0.6, -scale * 0.5);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: scale * 0.3, bevelEnabled: false });
    // Rotate so forward is +Z
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, scale * 0.15);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    // Wireframe outline for neon look
    const wireGeo = new THREE.EdgesGeometry(geo);
    const wireMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
    const wireframe = new THREE.LineSegments(wireGeo, wireMat);
    group.add(wireframe);

    return group;
  }

  private generateLightningPoints(start: THREE.Vector3, end: THREE.Vector3, segments: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = [start.clone()];
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const p = start.clone().lerp(end, t);
      // Add random offset perpendicular to the line
      const jitter = 0.08;
      p.x += (Math.random() - 0.5) * jitter;
      p.y += (Math.random() - 0.5) * jitter;
      p.z += (Math.random() - 0.5) * jitter;
      points.push(p);
    }
    points.push(end.clone());
    return points;
  }

  private distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
    _v1.subVectors(b, a);
    _v2.subVectors(p, a);
    const abLenSq = _v1.lengthSq();
    if (abLenSq < 0.000001) return _v2.length();
    const t = Math.max(0, Math.min(1, _v2.dot(_v1) / abLenSq));
    _v3.copy(a).addScaledVector(_v1, t);
    return p.distanceTo(_v3);
  }
}
