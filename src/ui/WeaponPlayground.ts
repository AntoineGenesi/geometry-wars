/**
 * Interactive weapon demo/playground that runs inside the WeaponWiki modal.
 *
 * Self-contained Three.js scene with its own renderer, camera, a mini sphere
 * surface, a player chevron, real enemy types from the game, and weapon visuals.
 * Mouse-aimed firing with player death/respawn, lives, and game-over state.
 *
 * DESIGN: Matches actual game conditions exactly:
 * - Real enemy types from src/entities/enemies/
 * - Fire rates match WEAPON_CONFIGS + Player FIRE_RATE gating
 * - Fixed top-down camera (does NOT rotate with player)
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPHERE_RADIUS = 3;
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 300;
const ENEMY_COUNT = 8;
const ENEMY_RESPAWN_DELAY = 2.0;
const CAMERA_DISTANCE = 8;
const PLAYER_MOVE_SPEED = 1.2; // radians per second for WASD movement
const MIN_DT = 1 / 120;
const MAX_DT = 1 / 30;
const PLAYER_DEATH_RADIUS = 0.3;
const PLAYER_RESPAWN_DELAY = 1.5;
const STARTING_LIVES = 3;
const DEATH_FLASH_DURATION = 0.4;
const TESLA_ARC_RANGE = 2.0;
const TESLA_ARC_PERSIST = 0.7; // seconds arcs stay visible
const TESLA_ARC_COUNT = 4; // arcs spawned per fire event

// Match the real game's Player FIRE_RATE (src/entities/Player.ts: FIRE_RATE = 10)
// This is the base player fire interval, which gates weapon fire rates
const PLAYER_BASE_FIRE_RATE = 10; // shots per second
const PLAYER_FIRE_INTERVAL = 1 / PLAYER_BASE_FIRE_RATE; // 0.1 seconds

// Enemy types available in the playground (mix of basic + mid-tier)
type PlaygroundEnemyType = 'grunt' | 'wanderer' | 'duck' | 'weaver' | 'spinner' | 'rocket';
const ENEMY_TYPES: PlaygroundEnemyType[] = ['grunt', 'wanderer', 'duck', 'weaver', 'spinner', 'rocket'];

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
// Sphere surface transform for real enemies
// Maps UV (0-1, 0-1) to a position/normal/tangent/bitangent on the sphere.
// This mirrors how the real game's SurfaceFactory works for sphere surfaces.
// ---------------------------------------------------------------------------

function makeSphereTransform(radius: number) {
  return (u: number, v: number): {
    position: THREE.Vector3;
    normal: THREE.Vector3;
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3;
  } => {
    const theta = u * Math.PI * 2; // azimuthal angle (0 to 2*PI)
    const phi = v * Math.PI;       // polar angle (0 to PI)

    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    const position = new THREE.Vector3(
      radius * sinPhi * sinTheta,
      radius * cosPhi,
      radius * sinPhi * cosTheta,
    );

    const normal = position.clone().normalize();

    // Tangent in U direction (d/dtheta)
    const tangent = new THREE.Vector3(
      sinPhi * cosTheta,
      0,
      -sinPhi * sinTheta,
    ).normalize();

    // Bitangent in V direction (d/dphi)
    const bitangent = new THREE.Vector3(
      cosPhi * sinTheta,
      -sinPhi,
      cosPhi * cosTheta,
    ).normalize();

    return { position, normal, tangent, bitangent };
  };
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
  private playerTheta = 0;
  private playerPhi = Math.PI / 2;
  private aimTheta = 0; // where the player aims (rotates around sphere)
  private aimPhi = Math.PI / 2; // polar aim component for mouse aiming

  private enemies: PlaygroundEnemyEntry[] = [];
  private projectiles: MiniProjectile[] = [];
  private popups: DamagePopup[] = [];

  private activeWeapon: WeaponType = WeaponType.Standard;
  private fireCooldown = 0;

  // Mouse state
  private mouseX = CANVAS_WIDTH / 2;
  private mouseY = CANVAS_HEIGHT / 2;
  private mouseDown = false;
  private mouseOnSphere = false; // whether the mouse ray intersects the sphere

  // Sphere mesh for raycasting
  private sphereMesh!: THREE.Mesh;

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

  // Sphere UV transform for real enemies
  private readonly sphereTransform: ReturnType<typeof makeSphereTransform>;

  constructor(container: HTMLElement) {
    this.container = container;
    this.sphereTransform = makeSphereTransform(SPHERE_RADIUS);

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

    // -- Camera: FIXED top-down view, does NOT rotate with player --
    this.camera = new THREE.PerspectiveCamera(50, CANVAS_WIDTH / CANVAS_HEIGHT, 0.1, 100);
    this.camera.position.set(0, CAMERA_DISTANCE * 0.6, CAMERA_DISTANCE * 0.8);
    this.camera.lookAt(0, 0, 0);

    // -- Solid sphere surface (opaque fill for visibility at small scale) --
    const solidGeo = new THREE.SphereGeometry(SPHERE_RADIUS * 0.995, 32, 24);
    const solidMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a2a,
      transparent: true,
      opacity: 0.95,
      roughness: 0.8,
      metalness: 0.1,
    });
    const solidSphere = new THREE.Mesh(solidGeo, solidMat);
    this.scene.add(solidSphere);

    // -- Wireframe grid overlay --
    const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 24, 16);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0x2a2aaa,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    });
    this.sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
    this.scene.add(this.sphereMesh);

    // Invisible solid sphere for raycasting
    const raycastGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 32, 24);
    const raycastMat = new THREE.MeshBasicMaterial({ visible: false });
    const raycastSphere = new THREE.Mesh(raycastGeo, raycastMat);
    raycastSphere.name = 'raycastSphere';
    this.scene.add(raycastSphere);

    // -- Player chevron --
    this.playerGroup = this.buildMiniChevron(0x00ffff, 0.2);
    this.scene.add(this.playerGroup);

    // -- Spawn real enemies --
    for (let i = 0; i < ENEMY_COUNT; i++) {
      this.spawnRealEnemy(i);
    }

    // -- Stats overlay (includes lives) --
    this.statsOverlay = document.createElement('div');
    this.statsOverlay.style.cssText =
      'display:flex;justify-content:space-between;padding:6px 12px;color:#88aacc;' +
      'font-size:11px;font-family:monospace;letter-spacing:1px;';
    this.statsOverlay.innerHTML =
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

    this.renderer.render(this.scene, this.camera);
  };

  // -----------------------------------------------------------------------
  // Mouse aim: raycast from screen to sphere surface
  // -----------------------------------------------------------------------

  private updateMouseAim(): void {
    // Convert mouse position to NDC (-1 to 1)
    _mouseNDC.x = (this.mouseX / CANVAS_WIDTH) * 2 - 1;
    _mouseNDC.y = -(this.mouseY / CANVAS_HEIGHT) * 2 + 1;

    _raycaster.setFromCamera(_mouseNDC, this.camera);

    // Raycast against the invisible sphere
    const raycastSphere = this.scene.getObjectByName('raycastSphere');
    if (!raycastSphere) return;

    const intersects = _raycaster.intersectObject(raycastSphere);
    if (intersects.length > 0) {
      this.mouseOnSphere = true;
      const hitPoint = intersects[0].point;

      // Compute theta/phi from hit point
      this.aimTheta = Math.atan2(hitPoint.x, hitPoint.z);
      this.aimPhi = Math.acos(Math.max(-1, Math.min(1, hitPoint.y / SPHERE_RADIUS)));
    } else {
      // Mouse is off the sphere -- project ray onto sphere plane for a reasonable aim
      this.mouseOnSphere = false;
      // Use a fallback: project ray direction onto the sphere surface nearest the player
      const rayDir = _raycaster.ray.direction.clone();
      const rayOrigin = _raycaster.ray.origin.clone();
      // Find closest point on ray to sphere center
      const toCenter = new THREE.Vector3().sub(rayOrigin);
      const tClosest = Math.max(0, toCenter.dot(rayDir));
      const closest = rayOrigin.clone().add(rayDir.clone().multiplyScalar(tClosest));
      closest.normalize().multiplyScalar(SPHERE_RADIUS);
      this.aimTheta = Math.atan2(closest.x, closest.z);
      this.aimPhi = Math.acos(Math.max(-1, Math.min(1, closest.y / SPHERE_RADIUS)));
    }
  }

  // -----------------------------------------------------------------------
  // Player
  // -----------------------------------------------------------------------

  private updatePlayer(dt: number): void {
    if (!this.playerAlive) return;

    // WASD movement on the sphere
    let dTheta = 0;
    let dPhi = 0;
    if (this.keysDown.has('a')) dTheta -= 1;
    if (this.keysDown.has('d')) dTheta += 1;
    if (this.keysDown.has('w')) dPhi -= 1;
    if (this.keysDown.has('s')) dPhi += 1;

    // Normalize diagonal to avoid faster movement
    const moveLen = Math.sqrt(dTheta * dTheta + dPhi * dPhi);
    if (moveLen > 1) {
      dTheta /= moveLen;
      dPhi /= moveLen;
    }

    this.playerTheta += dTheta * PLAYER_MOVE_SPEED * dt;
    this.playerPhi += dPhi * PLAYER_MOVE_SPEED * dt;

    // Clamp phi to avoid poles (keep between ~15 and ~165 degrees)
    this.playerPhi = Math.max(0.25, Math.min(Math.PI - 0.25, this.playerPhi));

    const pos = this.spherePos(this.playerTheta, this.playerPhi);
    this.playerGroup.position.copy(pos);

    // Orient: up = surface normal, forward = aim direction on sphere surface
    const normal = pos.clone().normalize();

    // Compute aim point on sphere surface and derive tangent toward it
    const aimWorldPos = this.spherePos(this.aimTheta, this.aimPhi);
    const toAim = aimWorldPos.clone().sub(pos);

    // Project toAim onto the tangent plane (remove normal component)
    const normalComp = toAim.dot(normal);
    toAim.sub(normal.clone().multiplyScalar(normalComp));
    const aimLen = toAim.length();

    if (aimLen > 0.001) {
      toAim.multiplyScalar(1 / aimLen);
      const target = pos.clone().add(toAim);
      this.playerGroup.up.copy(normal);
      this.playerGroup.lookAt(target);
    } else {
      // Fallback: aim along theta tangent
      const tangent = new THREE.Vector3(-Math.sin(this.playerTheta), 0, Math.cos(this.playerTheta));
      const target = pos.clone().add(tangent);
      this.playerGroup.up.copy(normal);
      this.playerGroup.lookAt(target);
    }
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
    // Expanding ring of particles
    const ringCount = 12;
    for (let i = 0; i < ringCount; i++) {
      const angle = (i / ringCount) * Math.PI * 2;
      const normal = pos.clone().normalize();
      // Build a tangent-plane direction
      const tangentA = new THREE.Vector3(-Math.sin(this.playerTheta), 0, Math.cos(this.playerTheta)).normalize();
      const tangentB = new THREE.Vector3().crossVectors(normal, tangentA).normalize();
      const dir = tangentA.clone().multiplyScalar(Math.cos(angle)).add(tangentB.clone().multiplyScalar(Math.sin(angle)));

      const geo = new THREE.SphereGeometry(0.04, 4, 4);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 1.0,
      });
      const particle = new THREE.Mesh(geo, mat);
      particle.position.copy(pos);
      // Store velocity in userData
      particle.userData = { dir: dir.clone(), speed: 3.0, age: 0 };
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
        // Particles fly outward on sphere surface
        p.position.add(ud.dir.clone().multiplyScalar(ud.speed * dt));
        p.position.normalize().multiplyScalar(SPHERE_RADIUS);
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

    // Move player to a safe location (away from all enemies)
    let bestTheta = this.playerTheta + Math.PI;
    let bestPhi = Math.PI / 2;
    let bestMinDist = 0;

    // Try a few random positions and pick the one farthest from all enemies
    for (let attempt = 0; attempt < 12; attempt++) {
      const tryTheta = Math.random() * Math.PI * 2;
      const tryPhi = 0.4 + Math.random() * (Math.PI - 0.8);
      const tryPos = this.spherePos(tryTheta, tryPhi);

      let minDist = Infinity;
      for (const entry of this.enemies) {
        if (!entry.enemy.alive) continue;
        const d = tryPos.distanceTo(entry.enemy.position);
        if (d < minDist) minDist = d;
      }

      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestTheta = tryTheta;
        bestPhi = tryPhi;
      }
    }

    this.playerTheta = bestTheta;
    this.playerPhi = bestPhi;

    const pos = this.spherePos(this.playerTheta, this.playerPhi);
    this.playerGroup.position.copy(pos);

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

    // Reset position
    this.playerTheta = 0;
    this.playerPhi = Math.PI / 2;

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

    // Convert player theta/phi to UV for spawn distance check
    const playerU = ((this.playerTheta / (Math.PI * 2)) % 1 + 1) % 1;
    const playerV = this.playerPhi / Math.PI;

    // Find a position away from the player
    let u: number, v: number;
    for (let attempt = 0; attempt < 20; attempt++) {
      u = Math.random();
      v = 0.15 + Math.random() * 0.7; // avoid poles
      const du = Math.abs(u - playerU);
      const dv = Math.abs(v - playerV);
      if (Math.sqrt(du * du + dv * dv) > 0.25) break;
    }
    u = u!;
    v = v!;

    const enemy = this.createRealEnemy(type, u, v);

    // Apply surface transform to position the enemy on the sphere
    enemy.applySurfaceTransform(this.sphereTransform);

    // Add enemy mesh to scene
    if (enemy.mesh) {
      this.scene.add(enemy.mesh);
      // Scale down enemies for mini sphere (real enemies are sized for radius ~10 sphere)
      const scaleFactor = SPHERE_RADIUS / 10;
      enemy.mesh.scale.setScalar(scaleFactor);
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
    const u = ((this.playerTheta / (Math.PI * 2)) % 1 + 1) % 1;
    const v = this.playerPhi / Math.PI;
    return { u, v };
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
          let v = 0.15 + Math.random() * 0.7;
          for (let attempt = 0; attempt < 20; attempt++) {
            u = Math.random();
            v = 0.15 + Math.random() * 0.7;
            const du = Math.abs(u - playerUV.u);
            const dv = Math.abs(v - playerUV.v);
            if (Math.sqrt(du * du + dv * dv) > 0.25) break;
          }

          const newEnemy = this.createRealEnemy(newType, u, v);
          newEnemy.applySurfaceTransform(this.sphereTransform);
          if (newEnemy.mesh) {
            this.scene.add(newEnemy.mesh);
            const scaleFactor = SPHERE_RADIUS / 10;
            newEnemy.mesh.scale.setScalar(scaleFactor);
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

      // Re-apply surface transform to move mesh to correct sphere position
      entry.enemy.applySurfaceTransform(this.sphereTransform);

      // Keep scale correct (in case the enemy reset it)
      if (entry.enemy.mesh) {
        const scaleFactor = SPHERE_RADIUS / 10;
        const currentScale = entry.enemy.mesh.scale.x;
        if (Math.abs(currentScale - scaleFactor) > 0.01) {
          entry.enemy.mesh.scale.setScalar(scaleFactor);
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
    // Compute direction from player to the aim point on the sphere surface
    const playerPos = this.playerGroup.position;
    const aimWorldPos = this.spherePos(this.aimTheta, this.aimPhi);

    const dir = aimWorldPos.clone().sub(playerPos);

    // Project onto tangent plane (remove normal component)
    const normal = playerPos.clone().normalize();
    const normalComp = dir.dot(normal);
    dir.sub(normal.clone().multiplyScalar(normalComp));

    const len = dir.length();
    if (len > 0.001) {
      dir.multiplyScalar(1 / len);
    } else {
      // Fallback: aim along theta tangent
      dir.set(-Math.sin(this.aimTheta) * Math.sin(this.playerPhi), Math.cos(this.playerPhi), Math.cos(this.aimTheta) * Math.sin(this.playerPhi));
      dir.sub(normal.clone().multiplyScalar(dir.dot(normal)));
      const fallbackLen = dir.length();
      if (fallbackLen > 0.001) dir.multiplyScalar(1 / fallbackLen);
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
      speed: cfg.projectileSpeed > 0 ? cfg.projectileSpeed * 4 : 6,
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
    const normal = origin.clone().normalize();
    const spreadAngle = Math.PI / 6;
    for (let i = 0; i < 5; i++) {
      const angle = (i - 2) * (spreadAngle / 4);
      const dir = direction.clone().applyAxisAngle(normal, angle);
      this.fireProjectile(origin, dir, cfg, 0x44ffff, 0.04);
    }
  }

  private firePiercing(origin: THREE.Vector3, direction: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    // Instant beam: draw a line and damage everything in path
    const beamLength = SPHERE_RADIUS * 3;
    const points: THREE.Vector3[] = [];
    let pos = origin.clone();
    let dir = direction.clone().normalize();

    for (let i = 0; i <= 20; i++) {
      points.push(pos.clone());
      pos.add(dir.clone().multiplyScalar(beamLength / 20));
      // Project onto sphere
      pos.normalize().multiplyScalar(SPHERE_RADIUS);
      // Re-tangentize
      const n = pos.clone().normalize();
      dir.sub(n.clone().multiplyScalar(dir.dot(n)));
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
    const endPos = origin.clone().add(direction.clone().multiplyScalar(SPHERE_RADIUS * 1.5));
    endPos.normalize().multiplyScalar(SPHERE_RADIUS);

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
    // Sustained red beam along sphere surface
    const beamLength = SPHERE_RADIUS * 2.5;
    const points: THREE.Vector3[] = [];
    let pos = origin.clone();
    let dir = direction.clone().normalize();

    for (let i = 0; i <= 16; i++) {
      points.push(pos.clone());
      pos.add(dir.clone().multiplyScalar(beamLength / 16));
      pos.normalize().multiplyScalar(SPHERE_RADIUS);
      const n = pos.clone().normalize();
      dir.sub(n.clone().multiplyScalar(dir.dot(n)));
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
    const targetPos = origin.clone().add(direction.clone().multiplyScalar(SPHERE_RADIUS * 0.8));
    targetPos.normalize().multiplyScalar(SPHERE_RADIUS);

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

      // Also spawn some random ambient arcs between nearby points on the sphere
      // near the player for visual flair
      for (let a = 0; a < 2; a++) {
        const normal = origin.clone().normalize();
        const tangentA = new THREE.Vector3(-Math.sin(this.playerTheta), 0, Math.cos(this.playerTheta)).normalize();
        const tangentB = new THREE.Vector3().crossVectors(normal, tangentA).normalize();

        const angle1 = Math.random() * Math.PI * 2;
        const angle2 = Math.random() * Math.PI * 2;
        const radius1 = 0.3 + Math.random() * 0.8;
        const radius2 = 0.3 + Math.random() * 0.8;

        const p1 = origin.clone()
          .add(tangentA.clone().multiplyScalar(Math.cos(angle1) * radius1))
          .add(tangentB.clone().multiplyScalar(Math.sin(angle1) * radius1));
        p1.normalize().multiplyScalar(SPHERE_RADIUS);

        const p2 = origin.clone()
          .add(tangentA.clone().multiplyScalar(Math.cos(angle2) * radius2))
          .add(tangentB.clone().multiplyScalar(Math.sin(angle2) * radius2));
        p2.normalize().multiplyScalar(SPHERE_RADIUS);

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
      // Project onto sphere
      p.position.normalize().multiplyScalar(SPHERE_RADIUS);
      // Re-tangentize direction
      const n = p.position.clone().normalize();
      const dot = p.direction.dot(n);
      p.direction.sub(n.clone().multiplyScalar(dot));
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
        if (d < 0.3) {
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
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private spherePos(theta: number, phi: number): THREE.Vector3 {
    return new THREE.Vector3(
      SPHERE_RADIUS * Math.sin(phi) * Math.sin(theta),
      SPHERE_RADIUS * Math.cos(phi),
      SPHERE_RADIUS * Math.sin(phi) * Math.cos(theta),
    );
  }

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
      // Project back onto sphere
      p.normalize().multiplyScalar(SPHERE_RADIUS);
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
