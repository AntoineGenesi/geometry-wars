/**
 * Playable visual style demo for the Visual Playground.
 *
 * When a user clicks a visual style thumbnail, this class creates a full-screen
 * playable mini-game with that visual style applied. The player can move with WASD,
 * aim with mouse, and shoot with click — exactly like the WeaponPlayground.
 *
 * The visual preset controls: grid color, surface color/opacity, bloom settings,
 * Sektori tile-glow shader, and depth opacity curves.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SurfaceFactory, SurfaceType } from '../surfaces/SurfaceFactory';
import { Surface, SurfacePoint } from '../surfaces/Surface';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';
import { Grunt } from '../entities/enemies/Grunt';
import { Wanderer } from '../entities/enemies/Wanderer';
import { Duck } from '../entities/enemies/Duck';
import { Weaver } from '../entities/enemies/Weaver';
import { Spinner } from '../entities/enemies/Spinner';
import { Rocket } from '../entities/enemies/Rocket';
import { ParticleSystem } from '../effects/ParticleSystem';
import {
  createSektoriGridMaterial,
  updateSektoriUniforms,
  SektoriTrailManager,
} from '../rendering/SektoriGridMaterial';
import type { VisualPreset } from './VisualPlayground';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEMO_WIDTH = 800;
const DEMO_HEIGHT = 600;
const TARGET_RADIUS = 3.5;
const CAMERA_DISTANCE = 8;
const ENEMY_COUNT = 8;
const ENEMY_RESPAWN_DELAY = 2.0;
const PLAYER_MOVE_SPEED = 0.04;
const MIN_DT = 1 / 120;
const MAX_DT = 1 / 30;
const PLAYER_RESPAWN_DELAY = 1.5;
const STARTING_LIVES = 3;
const DEATH_FLASH_DURATION = 0.4;
const ENEMY_SCALE = 0.8;
const PLAYER_DEATH_RADIUS = 0.15;
const PROJECTILE_HIT_RADIUS = 0.25;
const FIRE_RATE = 10;
const FIRE_INTERVAL = 1 / FIRE_RATE;
const PROJECTILE_SPEED = 6;
const PROJECTILE_DAMAGE = 10;
const PROJECTILE_MAX_AGE = 3;

type DemoEnemyType = 'grunt' | 'wanderer' | 'duck' | 'weaver' | 'spinner' | 'rocket';
const ENEMY_TYPES: DemoEnemyType[] = ['grunt', 'wanderer', 'duck', 'weaver', 'spinner', 'rocket'];
const ENEMY_COLORS: Record<DemoEnemyType, number> = {
  grunt: 0x4444ff,
  wanderer: 0xaa44ff,
  duck: 0xff44aa,
  weaver: 0x00ff44,
  spinner: 0xff44ff,
  rocket: 0xff8800,
};

// Pre-allocated temp vectors
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _mouseNDC = new THREE.Vector2();

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface DemoEnemyEntry {
  enemy: BaseEnemy;
  type: DemoEnemyType;
  respawnTimer: number;
}

interface DemoProjectile {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  speed: number;
  age: number;
}

// ---------------------------------------------------------------------------
// Surface transform helper (same pattern as WeaponPlayground)
// ---------------------------------------------------------------------------

function makeSurfaceTransform(surface: Surface, scale: number) {
  return (u: number, v: number) => {
    const pt: SurfacePoint = surface.getPoint(u, v);
    return {
      position: pt.position.clone().multiplyScalar(scale),
      normal: pt.normal.clone(),
      tangent: pt.tangentU.clone(),
      bitangent: pt.tangentV.clone(),
    };
  };
}

// ---------------------------------------------------------------------------
// VisualPlaygroundDemo
// ---------------------------------------------------------------------------

export class VisualPlaygroundDemo {
  private overlay: HTMLDivElement;
  private demoCanvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;

  private surface!: Surface;
  private surfaceScale = 1;
  private surfaceGroup!: THREE.Group;
  private surfaceTransformFn!: ReturnType<typeof makeSurfaceTransform>;

  private playerGroup!: THREE.Group;
  private playerU = 0.25;
  private playerV = 0.5;
  private aimU = 0.25;
  private aimV = 0.5;

  private enemies: DemoEnemyEntry[] = [];
  private projectiles: DemoProjectile[] = [];
  private deathEffects: THREE.Object3D[] = [];
  private particleSystem: ParticleSystem;

  private playerAlive = true;
  private respawnTimer = 0;
  private deathFlashTimer = 0;
  private lives = STARTING_LIVES;
  private gameOver = false;
  private kills = 0;
  private elapsed = 0;
  private fireCooldown = 0;

  private mouseX = DEMO_WIDTH / 2;
  private mouseY = DEMO_HEIGHT / 2;
  private mouseDown = false;
  private focused = false;
  private paused = false;

  private readonly keysDown: Set<string> = new Set();
  private rafId = 0;
  private lastTime = 0;
  private disposed = false;
  private elapsedTime = 0;

  private closeCallback: (() => void) | null = null;
  private preset: VisualPreset;
  private surfaceType: SurfaceType;

  // Sektori state
  private sektoriMaterial: THREE.ShaderMaterial | null = null;
  private sektoriTrail: SektoriTrailManager | null = null;

  // Stats overlay
  private statsOverlay: HTMLDivElement;
  private hintOverlay: HTMLDivElement;

  // Bound handlers
  private readonly onKeyDownHandler: (e: KeyboardEvent) => void;
  private readonly onKeyUpHandler: (e: KeyboardEvent) => void;
  private readonly onMouseMoveHandler: (e: MouseEvent) => void;
  private readonly onMouseDownHandler: (e: MouseEvent) => void;
  private readonly onMouseUpHandler: (e: MouseEvent) => void;
  private readonly onCanvasClickHandler: (e: MouseEvent) => void;
  private readonly onDocumentClickHandler: (e: MouseEvent) => void;

  // Background color (stored for flash reset)
  private bgColor: THREE.Color;

  constructor(preset: VisualPreset, surfaceType: SurfaceType) {
    this.preset = preset;
    this.surfaceType = surfaceType;

    // Background color based on preset
    this.bgColor = new THREE.Color(preset.surfaceColor || 0x050510);
    // Darken it a bit for background
    this.bgColor.multiplyScalar(0.5);
    if (this.bgColor.r < 0.02 && this.bgColor.g < 0.02 && this.bgColor.b < 0.06) {
      this.bgColor.setHex(0x050510);
    }

    // -- Create overlay --
    this.overlay = document.createElement('div');
    this.overlay.className = 'vp-demo-overlay';
    this.overlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(5,2,15,0.98);z-index:2100;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:12px;font-family:"Segoe UI",monospace;';

    // -- Title bar --
    const titleBar = document.createElement('div');
    titleBar.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;' +
      `width:${DEMO_WIDTH}px;`;

    const title = document.createElement('div');
    title.style.cssText =
      'color:#00ffff;font:bold 18px monospace;letter-spacing:3px;' +
      'text-shadow:0 0 10px #00ffff;';
    title.textContent = preset.name;

    const backBtn = document.createElement('button');
    backBtn.style.cssText =
      'background:rgba(80,30,0,0.5);border:1px solid #884400;' +
      'color:#ff8800;padding:8px 24px;font:bold 13px monospace;' +
      'letter-spacing:2px;cursor:pointer;transition:all 0.2s;';
    backBtn.textContent = 'BACK';
    backBtn.addEventListener('mouseenter', () => {
      backBtn.style.background = 'rgba(120,50,0,0.6)';
      backBtn.style.boxShadow = '0 0 12px #ff8800';
    });
    backBtn.addEventListener('mouseleave', () => {
      backBtn.style.background = 'rgba(80,30,0,0.5)';
      backBtn.style.boxShadow = 'none';
    });
    backBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });

    titleBar.appendChild(title);
    titleBar.appendChild(backBtn);
    this.overlay.appendChild(titleBar);

    // -- Canvas --
    this.demoCanvas = document.createElement('canvas');
    this.demoCanvas.width = DEMO_WIDTH;
    this.demoCanvas.height = DEMO_HEIGHT;
    this.demoCanvas.style.cssText =
      'display:block;border:1px solid rgba(0,255,255,0.2);border-radius:4px;cursor:crosshair;';
    this.overlay.appendChild(this.demoCanvas);

    // -- Renderer --
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.demoCanvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(DEMO_WIDTH, DEMO_HEIGHT);

    // -- Scene --
    this.scene = new THREE.Scene();
    this.scene.background = this.bgColor.clone();

    // -- Lighting --
    const ambient = new THREE.AmbientLight(0x404080, 0.8);
    this.scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.7);
    directional.position.set(5, 10, 5);
    this.scene.add(directional);

    // -- Camera --
    this.camera = new THREE.PerspectiveCamera(50, DEMO_WIDTH / DEMO_HEIGHT, 0.1, 100);
    this.camera.position.set(0, CAMERA_DISTANCE * 0.6, CAMERA_DISTANCE * 0.8);
    this.camera.lookAt(0, 0, 0);

    // -- Surface --
    this.initSurface();
    this.addSurfaceToScene();

    // -- Post-processing (bloom from preset) --
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (preset.bloomStrength > 0) {
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(DEMO_WIDTH, DEMO_HEIGHT),
        preset.bloomStrength,
        preset.bloomRadius ?? 0.4,
        preset.bloomThreshold ?? 0.85,
      );
      this.composer.addPass(bloom);
    }
    this.composer.addPass(new OutputPass());

    // -- Player --
    const playerColor = this.getPlayerColor();
    this.playerGroup = this.buildMiniChevron(playerColor, 0.2);
    this.scene.add(this.playerGroup);

    // -- Particle system --
    this.particleSystem = new ParticleSystem(2000);
    this.scene.add(this.particleSystem.root);

    // -- Enemies --
    for (let i = 0; i < ENEMY_COUNT; i++) {
      this.spawnEnemy(i);
    }

    // -- Stats overlay --
    this.statsOverlay = document.createElement('div');
    this.statsOverlay.style.cssText =
      `display:flex;justify-content:space-between;width:${DEMO_WIDTH}px;` +
      'padding:6px 12px;color:#88aacc;font:11px monospace;letter-spacing:1px;';
    this.statsOverlay.innerHTML =
      `<span style="color:#00ffcc;text-transform:uppercase;">${surfaceType} | ${preset.name}</span>` +
      '<span id="vpd-lives">LIVES: 3</span>' +
      '<span id="vpd-kills">KILLS: 0</span>' +
      '<span id="vpd-time">0.0s</span>';
    this.overlay.appendChild(this.statsOverlay);

    // -- Description --
    const desc = document.createElement('div');
    desc.style.cssText =
      `color:#668888;font:12px monospace;text-align:center;max-width:${DEMO_WIDTH}px;letter-spacing:1px;`;
    desc.textContent = preset.description;
    this.overlay.appendChild(desc);

    // -- Hint overlay (click to play) --
    this.hintOverlay = document.createElement('div');
    this.hintOverlay.style.cssText =
      `position:absolute;width:${DEMO_WIDTH}px;height:${DEMO_HEIGHT}px;` +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'background:rgba(5,5,16,0.7);border-radius:4px;cursor:pointer;z-index:10;' +
      'pointer-events:auto;';
    this.hintOverlay.innerHTML =
      '<div style="color:#00ffff;font:16px monospace;letter-spacing:2px;' +
      'text-shadow:0 0 10px #00ffff,0 0 20px #0088aa;margin-bottom:8px;">CLICK TO PLAY</div>' +
      '<div style="color:#88aacc;font:11px monospace;letter-spacing:1px;">' +
      'WASD: Move | Mouse: Aim | Click: Shoot | ESC: Pause</div>';

    // Position relative to canvas
    const canvasContainer = document.createElement('div');
    canvasContainer.style.cssText = 'position:relative;display:inline-block;';

    // Re-parent canvas into container
    this.overlay.removeChild(this.demoCanvas);
    canvasContainer.appendChild(this.demoCanvas);
    canvasContainer.appendChild(this.hintOverlay);
    // Insert after title bar
    this.overlay.insertBefore(canvasContainer, this.statsOverlay);

    // -- Input handlers --
    this.onKeyDownHandler = (e: KeyboardEvent) => {
      if (!this.focused || this.disposed) return;
      const key = e.key.toLowerCase();
      this.keysDown.add(key);

      if (key === 'escape') {
        if (this.paused) {
          this.paused = false;
          this.hintOverlay.style.display = 'none';
        } else {
          // Treat ESC as "go back" when not paused
          this.close();
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (['w', 'a', 's', 'd'].includes(key)) {
        e.preventDefault();
      }
    };

    this.onKeyUpHandler = (e: KeyboardEvent) => {
      this.keysDown.delete(e.key.toLowerCase());
    };

    this.onMouseMoveHandler = (e: MouseEvent) => {
      if (!this.focused || this.disposed) return;
      const rect = this.demoCanvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
    };

    this.onMouseDownHandler = (e: MouseEvent) => {
      if (!this.focused || this.disposed) return;
      if (e.button === 0) this.mouseDown = true;
    };

    this.onMouseUpHandler = (e: MouseEvent) => {
      if (e.button === 0) this.mouseDown = false;
    };

    this.onCanvasClickHandler = (e: MouseEvent) => {
      if (this.disposed) return;

      if (this.gameOver) {
        this.restartGame();
        this.hintOverlay.style.display = 'none';
        this.lastTime = performance.now();
        return;
      }

      if (this.paused) {
        this.paused = false;
        this.hintOverlay.style.display = 'none';
        this.lastTime = performance.now();
        return;
      }

      if (!this.focused) {
        this.focused = true;
        this.hintOverlay.style.display = 'none';
        this.lastTime = performance.now();
        const rect = this.demoCanvas.getBoundingClientRect();
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
      }
    };

    this.onDocumentClickHandler = (e: MouseEvent) => {
      if (this.disposed) return;
      if (!this.overlay.contains(e.target as Node)) return;
      // If clicking outside the canvas area, release focus
      if (!canvasContainer.contains(e.target as Node) && this.focused && !this.paused) {
        this.releaseFocus();
      }
    };

    window.addEventListener('keydown', this.onKeyDownHandler);
    window.addEventListener('keyup', this.onKeyUpHandler);
    window.addEventListener('mouseup', this.onMouseUpHandler);
    this.demoCanvas.addEventListener('mousemove', this.onMouseMoveHandler);
    this.demoCanvas.addEventListener('mousedown', this.onMouseDownHandler);
    canvasContainer.addEventListener('click', this.onCanvasClickHandler);
    document.addEventListener('click', this.onDocumentClickHandler);

    document.body.appendChild(this.overlay);

    // Start loop
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  // -----------------------------------------------------------------------
  // Player color: derive a complementary/readable color from grid color
  // -----------------------------------------------------------------------

  private getPlayerColor(): number {
    // Use cyan by default, but if grid is cyan-ish, use white
    const gc = new THREE.Color(this.preset.gridColor);
    const playerCyan = new THREE.Color(0x00ffff);
    // If grid color is too similar to cyan, use white
    if (gc.r < 0.3 && gc.g > 0.7 && gc.b > 0.7) {
      return 0xffffff;
    }
    // If grid is green-ish, use cyan
    if (gc.g > 0.7 && gc.r < 0.3 && gc.b < 0.5) {
      return 0x00ffff;
    }
    return playerCyan.getHex();
  }

  // -----------------------------------------------------------------------
  // Surface
  // -----------------------------------------------------------------------

  private initSurface(): void {
    this.surface = SurfaceFactory.create(this.surfaceType, {
      gridColor: this.preset.gridColor,
      surfaceColor: this.preset.surfaceColor,
      surfaceOpacity: this.preset.wireframeOnly ? 0.0 : this.preset.surfaceOpacity,
      gridOpacity: this.preset.gridOpacity,
      gridSegmentsU: this.preset.gridSegmentsU,
      gridSegmentsV: this.preset.gridSegmentsV,
    } as any);

    this.surface.mesh.geometry.computeBoundingSphere();
    const bs = this.surface.mesh.geometry.boundingSphere;
    const radius = bs ? bs.radius : 5;
    this.surfaceScale = TARGET_RADIUS / radius;

    this.surfaceTransformFn = makeSurfaceTransform(this.surface, this.surfaceScale);
  }

  private addSurfaceToScene(): void {
    this.surfaceGroup = new THREE.Group();
    this.surfaceGroup.scale.setScalar(this.surfaceScale);

    // Apply preset surface material
    if (this.surface.mesh.material instanceof THREE.Material) {
      this.surface.mesh.material.dispose();
    }

    if (this.preset.wireframeOnly) {
      // Hide the solid surface
      this.surface.mesh.visible = false;
    } else {
      this.surface.mesh.material = new THREE.MeshStandardMaterial({
        color: this.preset.surfaceColor,
        transparent: true,
        opacity: this.preset.surfaceOpacity,
        roughness: 0.8,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
    }

    // Apply preset grid material (or Sektori shader)
    if (this.preset.sektoriConfig) {
      this.sektoriMaterial = createSektoriGridMaterial(this.preset.sektoriConfig);
      this.sektoriTrail = new SektoriTrailManager(this.preset.sektoriConfig);
      if (this.surface.gridMesh.material instanceof THREE.Material) {
        this.surface.gridMesh.material.dispose();
      }
      this.surface.gridMesh.material = this.sektoriMaterial;
    } else {
      if (this.surface.gridMesh.material instanceof THREE.Material) {
        this.surface.gridMesh.material.dispose();
      }
      this.surface.gridMesh.material = new THREE.LineBasicMaterial({
        color: this.preset.gridColor,
        transparent: true,
        opacity: this.preset.gridOpacity,
      });
    }

    this.surfaceGroup.add(this.surface.mesh);
    this.surfaceGroup.add(this.surface.gridMesh);
    this.scene.add(this.surfaceGroup);
  }

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
  // Game loop
  // -----------------------------------------------------------------------

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);

    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.max(MIN_DT, Math.min(rawDt, MAX_DT));

    // Track time for Sektori shader
    this.elapsedTime += dt;

    if (!this.focused || this.paused || this.gameOver) {
      // Still update Sektori glow even when not playing
      if (this.sektoriMaterial && this.sektoriTrail) {
        this.updateSektoriGlow();
      }
      this.composer.render();
      return;
    }

    this.elapsed += dt;

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
    this.updateStats();
    this.particleSystem.update(dt);

    // Update Sektori glow based on player position
    if (this.sektoriMaterial && this.sektoriTrail) {
      this.updateSektoriGlow();
    }

    this.composer.render();
  };

  // -----------------------------------------------------------------------
  // Sektori glow update (uses real player position)
  // -----------------------------------------------------------------------

  private updateSektoriGlow(): void {
    const pt = this.surface.getPoint(this.playerU, this.playerV);
    const playerWorldPos = pt.position.clone().multiplyScalar(this.surfaceScale);

    updateSektoriUniforms(this.sektoriMaterial!, playerWorldPos, this.elapsedTime);
    this.sektoriTrail!.recordPosition(playerWorldPos);
    this.sektoriTrail!.updateMaterial(this.sektoriMaterial!);
  }

  // -----------------------------------------------------------------------
  // Mouse aim
  // -----------------------------------------------------------------------

  private updateMouseAim(): void {
    _mouseNDC.x = (this.mouseX / DEMO_WIDTH) * 2 - 1;
    _mouseNDC.y = -(this.mouseY / DEMO_HEIGHT) * 2 + 1;

    _raycaster.setFromCamera(_mouseNDC, this.camera);
    const intersects = _raycaster.intersectObject(this.surfaceGroup, true);
    if (intersects.length > 0) {
      const hitLocal = intersects[0].point.clone().multiplyScalar(1 / this.surfaceScale);
      const uv = this.surface.worldToSurface(hitLocal);
      this.aimU = uv.u;
      this.aimV = uv.v;
    }
  }

  // -----------------------------------------------------------------------
  // Player movement
  // -----------------------------------------------------------------------

  private updatePlayer(dt: number): void {
    if (!this.playerAlive) return;

    let du = 0;
    let dv = 0;
    if (this.keysDown.has('a')) du -= 1;
    if (this.keysDown.has('d')) du += 1;
    if (this.keysDown.has('w')) dv -= 1;
    if (this.keysDown.has('s')) dv += 1;

    const moveLen = Math.sqrt(du * du + dv * dv);
    if (moveLen > 1) {
      du /= moveLen;
      dv /= moveLen;
    }

    const speed = PLAYER_MOVE_SPEED * dt;
    const newUV = this.surface.moveOnSurface(this.playerU, this.playerV, du * speed, dv * speed);
    this.playerU = newUV.u;
    this.playerV = newUV.v;

    const pt = this.getScaledPoint(this.playerU, this.playerV);
    this.playerGroup.position.copy(pt.position);

    // Orient toward aim
    const aimPt = this.getScaledPoint(this.aimU, this.aimV);
    const toAim = aimPt.position.clone().sub(pt.position);
    const normalComp = toAim.dot(pt.normal);
    toAim.sub(pt.normal.clone().multiplyScalar(normalComp));
    const aimLen = toAim.length();

    if (aimLen > 0.001) {
      toAim.multiplyScalar(1 / aimLen);
      const target = pt.position.clone().add(toAim);
      this.playerGroup.up.copy(pt.normal);
      this.playerGroup.lookAt(target);
    } else {
      const target = pt.position.clone().add(pt.tangentU);
      this.playerGroup.up.copy(pt.normal);
      this.playerGroup.lookAt(target);
    }
  }

  // -----------------------------------------------------------------------
  // Camera
  // -----------------------------------------------------------------------

  private updateCamera(dt: number): void {
    const playerPos = this.playerGroup.position;
    const pt = this.getScaledPoint(this.playerU, this.playerV);
    const desiredPos = playerPos.clone().add(pt.normal.clone().multiplyScalar(CAMERA_DISTANCE));
    const lerpFactor = 1 - Math.exp(-5 * dt);
    this.camera.position.lerp(desiredPos, lerpFactor);
    this.camera.lookAt(playerPos);
  }

  // -----------------------------------------------------------------------
  // Player collisions
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
    const pt = this.getScaledPoint(this.playerU, this.playerV);
    const tangentA = pt.tangentU;
    const tangentB = pt.tangentV;

    const ringCount = 12;
    for (let i = 0; i < ringCount; i++) {
      const angle = (i / ringCount) * Math.PI * 2;
      const dir = tangentA.clone().multiplyScalar(Math.cos(angle))
        .add(tangentB.clone().multiplyScalar(Math.sin(angle)));

      const geo = new THREE.SphereGeometry(0.04, 4, 4);
      const mat = new THREE.MeshBasicMaterial({
        color: this.getPlayerColor(),
        transparent: true,
        opacity: 1.0,
      });
      const particle = new THREE.Mesh(geo, mat);
      particle.position.copy(pos);
      particle.userData = { dir: dir.clone(), speed: 3.0, age: 0 };
      this.scene.add(particle);
      this.deathEffects.push(particle);
    }
  }

  private updateDeathState(dt: number): void {
    // Update death particles
    for (let i = this.deathEffects.length - 1; i >= 0; i--) {
      const p = this.deathEffects[i] as THREE.Mesh;
      const ud = p.userData;
      ud.age += dt;
      p.position.add(ud.dir.clone().multiplyScalar(ud.speed * dt));
      ud.speed *= 0.95;
      const mat = p.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 1.0 - ud.age * 2.0);

      if (ud.age > 0.6) {
        this.scene.remove(p);
        p.geometry.dispose();
        this.deathEffects.splice(i, 1);
      }
    }

    // Death flash
    if (this.deathFlashTimer > 0) {
      this.deathFlashTimer -= dt;
      const flashIntensity = this.deathFlashTimer / DEATH_FLASH_DURATION;
      const bg = this.scene.background as THREE.Color;
      const r = this.bgColor.r + flashIntensity * 0.25;
      const g = this.bgColor.g + flashIntensity * 0.12;
      const b = this.bgColor.b + flashIntensity * 0.08;
      bg.setRGB(r, g, b);
      if (this.deathFlashTimer <= 0) {
        bg.copy(this.bgColor);
      }
    }

    // Respawn countdown
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

    let bestU = (this.playerU + 0.5) % 1;
    let bestV = 0.5;
    let bestMinDist = 0;

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
  }

  private restartGame(): void {
    this.lives = STARTING_LIVES;
    this.playerAlive = true;
    this.gameOver = false;
    this.respawnTimer = 0;
    this.deathFlashTimer = 0;
    this.playerGroup.visible = true;
    this.mouseDown = false;
    this.playerU = 0.25;
    this.playerV = 0.5;
    this.kills = 0;
    this.elapsed = 0;
    this.fireCooldown = 0;

    this.clearProjectiles();
    this.clearDeathEffects();
    this.clearEnemies();
    for (let i = 0; i < ENEMY_COUNT; i++) {
      this.spawnEnemy(i);
    }

    (this.scene.background as THREE.Color).copy(this.bgColor);
  }

  // -----------------------------------------------------------------------
  // Enemies
  // -----------------------------------------------------------------------

  private createEnemy(type: DemoEnemyType, u: number, v: number): BaseEnemy {
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

  private spawnEnemy(index: number): void {
    const type = ENEMY_TYPES[index % ENEMY_TYPES.length];
    let u = Math.random();
    let v = 0.1 + Math.random() * 0.8;

    for (let attempt = 0; attempt < 20; attempt++) {
      u = Math.random();
      v = 0.1 + Math.random() * 0.8;
      const du = Math.abs(u - this.playerU);
      const dv = Math.abs(v - this.playerV);
      if (Math.sqrt(du * du + dv * dv) > 0.25) break;
    }

    const enemy = this.createEnemy(type, u, v);
    enemy.radius *= ENEMY_SCALE;
    enemy.applySurfaceTransform(this.surfaceTransformFn);

    if (enemy.mesh) {
      this.scene.add(enemy.mesh);
      enemy.mesh.scale.setScalar(ENEMY_SCALE);
    }

    const entry: DemoEnemyEntry = { enemy, type, respawnTimer: 0 };

    if (index < this.enemies.length) {
      this.enemies[index] = entry;
    } else {
      this.enemies.push(entry);
    }
  }

  private clearEnemies(): void {
    for (const entry of this.enemies) {
      if (entry.enemy.mesh) this.scene.remove(entry.enemy.mesh);
      entry.enemy.destroy();
    }
    this.enemies = [];
  }

  private updateEnemies(dt: number): void {
    const playerUV = { u: this.playerU, v: this.playerV };

    for (let i = 0; i < this.enemies.length; i++) {
      const entry = this.enemies[i];

      if (!entry.enemy.alive) {
        entry.respawnTimer -= dt;
        if (entry.respawnTimer <= 0) {
          if (entry.enemy.mesh) this.scene.remove(entry.enemy.mesh);
          entry.enemy.destroy();

          const newType = ENEMY_TYPES[Math.floor(Math.random() * ENEMY_TYPES.length)];
          let u = Math.random();
          let v = 0.1 + Math.random() * 0.8;
          for (let attempt = 0; attempt < 20; attempt++) {
            u = Math.random();
            v = 0.1 + Math.random() * 0.8;
            const du = Math.abs(u - playerUV.u);
            const dv = Math.abs(v - playerUV.v);
            if (Math.sqrt(du * du + dv * dv) > 0.25) break;
          }

          const newEnemy = this.createEnemy(newType, u, v);
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

      if (this.playerAlive) {
        entry.enemy.setPlayerPosition(playerUV.u, playerUV.v);
      }
      entry.enemy.update(dt);
      entry.enemy.applySurfaceTransform(this.surfaceTransformFn);

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

    if (!entry.enemy.alive) {
      const enemyColor = new THREE.Color(ENEMY_COLORS[entry.type] ?? 0xff4444);
      this.particleSystem.enemyDeath(entry.enemy.position.clone(), enemyColor);

      if (entry.enemy.mesh) entry.enemy.mesh.visible = false;
      entry.respawnTimer = ENEMY_RESPAWN_DELAY;
      this.kills++;
    }
  }

  // -----------------------------------------------------------------------
  // Firing (standard weapon only)
  // -----------------------------------------------------------------------

  private handleFiring(dt: number): void {
    this.fireCooldown -= dt;
    if (!this.mouseDown) return;
    if (this.fireCooldown > 0) return;

    this.fireCooldown = FIRE_INTERVAL;

    const playerPos = this.playerGroup.position.clone();
    const aimDir = this.getAimDirection();

    // Fire a single projectile
    const geo = new THREE.SphereGeometry(0.04, 6, 6);
    // Projectile color matches grid color for visual consistency
    const projColor = this.preset.gridColor;
    const mat = new THREE.MeshBasicMaterial({ color: projColor });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(playerPos);
    this.scene.add(mesh);

    this.projectiles.push({
      mesh,
      position: playerPos.clone(),
      direction: aimDir.clone().normalize(),
      speed: PROJECTILE_SPEED,
      age: 0,
    });
  }

  private getAimDirection(): THREE.Vector3 {
    const playerPt = this.getScaledPoint(this.playerU, this.playerV);
    const aimPt = this.getScaledPoint(this.aimU, this.aimV);

    const dir = aimPt.position.clone().sub(playerPt.position);
    const normalComp = dir.dot(playerPt.normal);
    dir.sub(playerPt.normal.clone().multiplyScalar(normalComp));

    const len = dir.length();
    if (len > 0.001) {
      dir.multiplyScalar(1 / len);
    } else {
      return playerPt.tangentU.clone();
    }
    return dir;
  }

  // -----------------------------------------------------------------------
  // Projectile update
  // -----------------------------------------------------------------------

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.age >= PROJECTILE_MAX_AGE) {
        this.removeProjectile(i);
        continue;
      }

      // Move
      p.position.add(p.direction.clone().multiplyScalar(p.speed * dt));
      // Re-project onto surface
      const localPos = p.position.clone().multiplyScalar(1 / this.surfaceScale);
      const projUV = this.surface.worldToSurface(localPos);
      const projPt = this.getScaledPoint(projUV.u, projUV.v);
      p.position.copy(projPt.position);
      // Re-tangentize direction
      const dot = p.direction.dot(projPt.normal);
      p.direction.sub(projPt.normal.clone().multiplyScalar(dot));
      const dirLen = p.direction.length();
      if (dirLen > 0.001) p.direction.multiplyScalar(1 / dirLen);

      p.mesh.position.copy(p.position);

      // Collision with enemies
      for (let j = 0; j < this.enemies.length; j++) {
        const entry = this.enemies[j];
        if (!entry.enemy.alive) continue;
        const d = entry.enemy.position.distanceTo(p.position);
        if (d < PROJECTILE_HIT_RADIUS) {
          this.damageEnemy(j, PROJECTILE_DAMAGE);
          this.removeProjectile(i);
          break;
        }
      }
    }
  }

  private removeProjectile(index: number): void {
    const p = this.projectiles[index];
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    this.projectiles.splice(index, 1);
  }

  private clearProjectiles(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.removeProjectile(i);
    }
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
  // Stats
  // -----------------------------------------------------------------------

  private updateStats(): void {
    const livesEl = this.statsOverlay.querySelector('#vpd-lives');
    const killsEl = this.statsOverlay.querySelector('#vpd-kills');
    const timeEl = this.statsOverlay.querySelector('#vpd-time');
    if (livesEl) livesEl.textContent = `LIVES: ${this.lives}`;
    if (killsEl) killsEl.textContent = `KILLS: ${this.kills}`;
    if (timeEl) timeEl.textContent = `${this.elapsed.toFixed(1)}s`;
  }

  // -----------------------------------------------------------------------
  // UI helpers
  // -----------------------------------------------------------------------

  private showOverlay(titleText: string, subtitle: string): void {
    this.hintOverlay.innerHTML =
      `<div style="color:#00ffff;font:16px monospace;letter-spacing:2px;` +
      `text-shadow:0 0 10px #00ffff,0 0 20px #0088aa;margin-bottom:8px;">${titleText}</div>` +
      `<div style="color:#88aacc;font:11px monospace;letter-spacing:1px;">${subtitle}</div>`;
    this.hintOverlay.style.display = 'flex';
  }

  private releaseFocus(): void {
    this.focused = false;
    this.mouseDown = false;
    this.keysDown.clear();
    this.showOverlay('CLICK TO PLAY', 'WASD: Move | Mouse: Aim | Click: Shoot | ESC: Back');
  }

  private buildMiniChevron(color: number, scale: number): THREE.Group {
    const group = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, scale);
    shape.lineTo(-scale * 0.6, -scale * 0.5);
    shape.lineTo(0, -scale * 0.2);
    shape.lineTo(scale * 0.6, -scale * 0.5);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: scale * 0.3, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, scale * 0.15);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    const wireGeo = new THREE.EdgesGeometry(geo);
    const wireMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
    const wireframe = new THREE.LineSegments(wireGeo, wireMat);
    group.add(wireframe);

    return group;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  close(): void {
    this.dispose();
    this.closeCallback?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    // Remove event listeners
    window.removeEventListener('keydown', this.onKeyDownHandler);
    window.removeEventListener('keyup', this.onKeyUpHandler);
    window.removeEventListener('mouseup', this.onMouseUpHandler);
    this.demoCanvas.removeEventListener('mousemove', this.onMouseMoveHandler);
    this.demoCanvas.removeEventListener('mousedown', this.onMouseDownHandler);
    document.removeEventListener('click', this.onDocumentClickHandler);

    this.clearProjectiles();
    this.clearDeathEffects();
    this.clearEnemies();

    this.particleSystem.dispose();
    this.surface.dispose();
    if (this.sektoriMaterial) this.sektoriMaterial.dispose();

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    this.composer.dispose();
    this.renderer.dispose();
    this.overlay.remove();
  }
}
