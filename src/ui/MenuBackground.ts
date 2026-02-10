import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SurfaceFactory, SurfaceType } from '../surfaces/SurfaceFactory';
import { Surface } from '../surfaces/Surface';
import {
  buildDiamond3D,
  buildPinwheel3D,
  buildOctahedron3D,
  buildArrow3D,
  buildTriangle3D,
  buildSquare3D,
  buildPolygon3D,
  buildCircle3D,
} from '../utils/GeometryBuilder';

/**
 * Animated 3D background for the start menu.
 *
 * Renders a randomly chosen surface rotating slowly with REAL enemy meshes
 * orbiting along UV paths on its surface. Each entity leaves a subtle trail.
 * The canvas sits behind the DOM menu overlay (z-index 999).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MenuEnemy {
  /** The enemy mesh group */
  mesh: THREE.Group;
  /** Enemy type name (for reference) */
  type: string;
  /** UV position on the surface (0-1 range) */
  u: number;
  v: number;
  /** Speed in UV-space per second along the u axis */
  speedU: number;
  /** Speed in UV-space per second along the v axis */
  speedV: number;
  /** Trail points (world-space positions, newest first) */
  trail: THREE.Vector3[];
  /** Trail line mesh */
  trailLine: THREE.Line;
  /** Trail buffer geometry */
  trailGeometry: THREE.BufferGeometry;
  /** The entity color */
  color: THREE.Color;
  /** Spin speed (radians/sec) */
  spinSpeed: number;
  /** Current spin angle */
  spinAngle: number;
}

// ---------------------------------------------------------------------------
// Enemy visual definitions -- maps each enemy type to a builder + color
// ---------------------------------------------------------------------------

interface EnemyVisualDef {
  type: string;
  color: number;
  build: () => THREE.Group;
  spinSpeed: number;
}

const ENEMY_VISUAL_DEFS: EnemyVisualDef[] = [
  {
    type: 'grunt',
    color: 0x4444ff,
    build: () => buildDiamond3D(0.25, 0x4444ff, 0.15, 0.025),
    spinSpeed: 0,
  },
  {
    type: 'wanderer',
    color: 0xaa44ff,
    build: () => buildPinwheel3D(0.3, 0xaa44ff, 0.1, 0.02),
    spinSpeed: 3,
  },
  {
    type: 'weaver',
    color: 0x00ff44,
    build: () => buildDiamond3D(0.3, 0x00ff44, 0.15, 0.025),
    spinSpeed: 0.5,
  },
  {
    type: 'spinner',
    color: 0xff44ff,
    build: () => buildOctahedron3D(0.3, 0xff44ff, 0.025),
    spinSpeed: 4,
  },
  {
    type: 'rocket',
    color: 0xff8800,
    build: () => buildArrow3D(0.3, 0xff8800, 0.12, 0.025),
    spinSpeed: 0,
  },
  {
    type: 'mayfly',
    color: 0xaaff00,
    build: () => buildTriangle3D(0.15, 0xaaff00, 0.08, 0.018),
    spinSpeed: 1.5,
  },
  {
    type: 'duck',
    color: 0xff44aa,
    build: () => buildSquare3D(0.22, 0xff44aa, 0.12, 0.025),
    spinSpeed: 0.3,
  },
  {
    type: 'neutron',
    color: 0x44dddd,
    build: () => buildPolygon3D(7, 0.25, 0x44dddd, 0.12, 0.025),
    spinSpeed: 5,
  },
  {
    type: 'snake',
    color: 0x4488ff,
    build: () => buildCircle3D(0.2, 16, 0x4488ff, 0.06, 0.015),
    spinSpeed: 0,
  },
  {
    type: 'virus',
    color: 0x00cc00,
    build: () => buildOctahedron3D(0.25, 0x00cc00, 0.02),
    spinSpeed: 2,
  },
  {
    type: 'gravityWell',
    color: 0x4488ff,
    build: () => {
      const group = new THREE.Group();
      const rings = [0.35, 0.25, 0.15];
      for (const radius of rings) {
        const ring = buildCircle3D(radius, 24, 0x4488ff, 0.04, 0.012);
        group.add(ring);
      }
      return group;
    },
    spinSpeed: 1,
  },
  {
    type: 'spawner',
    color: 0xff2222,
    build: () => buildSquare3D(0.4, 0xff2222, 0.08, 0.015),
    spinSpeed: 0.8,
  },
  {
    type: 'painter',
    color: 0xffaa00,
    build: () => buildSquare3D(0.25, 0xffaa00, 0.12, 0.025),
    spinSpeed: 0.4,
  },
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENEMY_COUNT = 14;
const TRAIL_MAX_POINTS = 40;
const SURFACE_ROTATE_SPEED = 0.1; // rad/s around Y
const ENTITY_OFFSET = 0.2; // offset above surface along normal

// ---------------------------------------------------------------------------
// MenuBackground
// ---------------------------------------------------------------------------

export class MenuBackground {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private canvas: HTMLCanvasElement;

  private surface: Surface;
  private enemies: MenuEnemy[] = [];
  private surfaceGroup: THREE.Group;

  private rafId = 0;
  private running = false;
  private lastTime = 0;

  constructor() {
    // -- Renderer with its own canvas --
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'default',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.canvas = this.renderer.domElement;
    this.canvas.style.position = 'fixed';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.zIndex = '999';
    this.canvas.style.pointerEvents = 'none';
    document.body.appendChild(this.canvas);

    // -- Scene --
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050510);

    // -- Camera -- centered on the surface with slight elevation
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 200);
    this.camera.position.set(0, 10, 24);
    this.camera.lookAt(0, 0, 0);

    // -- Lighting (subtle ambient + directional for shape definition) --
    const ambient = new THREE.AmbientLight(0x303060, 0.4);
    this.scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0x4466aa, 0.5);
    dirLight.position.set(5, 8, 5);
    this.scene.add(dirLight);

    // -- Post-processing (bloom for neon glow) --
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.8,  // strength
      0.4,  // radius
      0.6,  // threshold
    );
    this.composer.addPass(bloomPass);
    this.composer.addPass(new OutputPass());

    // -- Pick a random surface --
    const types = SurfaceFactory.getAvailableTypes();
    const randomType = types[Math.floor(Math.random() * types.length)];
    this.surface = this.createSurface(randomType);

    this.surfaceGroup = this.surface.group;
    this.scene.add(this.surfaceGroup);

    // -- Spawn enemy entities using real game meshes --
    this.spawnEnemies();

    // -- Handle window resize --
    window.addEventListener('resize', this.onResize);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Start the animation loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  /** Pause the animation loop. */
  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /** Clean up all GPU resources and remove the canvas from the DOM. */
  dispose(): void {
    this.stop();

    // Remove canvas FIRST so it stops blocking even if cleanup throws
    this.canvas.remove();

    window.removeEventListener('resize', this.onResize);

    // Dispose entity resources
    for (const enemy of this.enemies) {
      this.disposeGroup(enemy.mesh);
      enemy.trailGeometry.dispose();
      (enemy.trailLine.material as THREE.Material).dispose();
    }
    this.enemies = [];

    // Dispose surface
    this.surface.dispose();

    // Dispose post-processing and renderer
    this.composer.dispose();
    this.renderer.dispose();
  }

  // -----------------------------------------------------------------------
  // Private: surface creation
  // -----------------------------------------------------------------------

  private createSurface(type: SurfaceType): Surface {
    const scale = 10;
    const config = {
      gridColor: 0x1e1e8b,
      surfaceColor: 0x0a0a2a,
      surfaceOpacity: 0.25,
      gridOpacity: 0.3,
      radius: scale,
      size: scale,
      height: scale * 2,
      majorRadius: scale * 0.8,
      minorRadius: scale * 0.3,
      cylinderRadius: scale * 0.4,
      sphereRadius: scale * 0.6,
      subdivisions: 2,
      width: scale,
      tunnelRadius: scale * 0.3,
      bevelRadius: 0.8,
      gridSegmentsU: 20,
      gridSegmentsV: 16,
    };
    return SurfaceFactory.create(type, config as any);
  }

  // -----------------------------------------------------------------------
  // Private: enemy spawning with real game meshes
  // -----------------------------------------------------------------------

  private spawnEnemies(): void {
    for (let i = 0; i < ENEMY_COUNT; i++) {
      const def = ENEMY_VISUAL_DEFS[i % ENEMY_VISUAL_DEFS.length];
      const color = new THREE.Color(def.color);

      // Build the actual enemy mesh using GeometryBuilder functions
      const mesh = def.build();
      this.scene.add(mesh);

      // Trail
      const trailPositions = new Float32Array(TRAIL_MAX_POINTS * 3);
      const trailColors = new Float32Array(TRAIL_MAX_POINTS * 3);
      const trailGeometry = new THREE.BufferGeometry();
      trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
      trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
      trailGeometry.setDrawRange(0, 0);

      const trailMaterial = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
      const trailLine = new THREE.Line(trailGeometry, trailMaterial);
      this.scene.add(trailLine);

      // Random starting UV and orbit parameters
      const u = Math.random();
      const v = Math.random();
      const baseSpeed = 0.03 + Math.random() * 0.04;
      const angle = Math.random() * Math.PI * 2;
      const speedU = baseSpeed * Math.cos(angle);
      const speedV = baseSpeed * Math.sin(angle);

      this.enemies.push({
        mesh,
        type: def.type,
        u,
        v,
        speedU,
        speedV,
        trail: [],
        trailLine,
        trailGeometry,
        color,
        spinSpeed: def.spinSpeed,
        spinAngle: Math.random() * Math.PI * 2,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Private: animation loop
  // -----------------------------------------------------------------------

  private loop = (timestamp: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime = timestamp;

    // Slowly rotate the surface
    this.surfaceGroup.rotation.y += SURFACE_ROTATE_SPEED * dt;

    // Update enemies
    for (const enemy of this.enemies) {
      this.updateEnemy(enemy, dt);
    }

    // Render
    this.composer.render();
  };

  // -----------------------------------------------------------------------
  // Private: enemy update
  // -----------------------------------------------------------------------

  private updateEnemy(enemy: MenuEnemy, dt: number): void {
    // Move in UV space
    enemy.u += enemy.speedU * dt;
    enemy.v += enemy.speedV * dt;

    // Wrap UV coordinates
    enemy.u = ((enemy.u % 1) + 1) % 1;
    enemy.v = ((enemy.v % 1) + 1) % 1;

    // Project onto surface to get world position
    const surfacePoint = this.surface.getPoint(enemy.u, enemy.v);
    const worldPos = surfacePoint.position.clone();

    // Apply surface group rotation so entity stays on the rotating surface
    worldPos.applyMatrix4(this.surfaceGroup.matrixWorld);

    // Offset slightly above surface along normal (so enemy sits on top)
    const worldNormal = surfacePoint.normal.clone()
      .applyQuaternion(this.surfaceGroup.quaternion)
      .normalize();
    worldPos.addScaledVector(worldNormal, ENTITY_OFFSET);

    enemy.mesh.position.copy(worldPos);

    // Orient mesh to surface normal
    const lookTarget = worldPos.clone().add(worldNormal);
    enemy.mesh.lookAt(lookTarget);

    // Apply spin rotation around the surface normal (local Z after lookAt)
    enemy.spinAngle += enemy.spinSpeed * dt;
    enemy.mesh.rotateZ(enemy.spinAngle * dt);

    // Update trail
    enemy.trail.unshift(worldPos.clone());
    if (enemy.trail.length > TRAIL_MAX_POINTS) {
      enemy.trail.pop();
    }

    this.updateTrailGeometry(enemy);
  }

  private updateTrailGeometry(enemy: MenuEnemy): void {
    const trailCount = enemy.trail.length;
    const posAttr = enemy.trailGeometry.attributes.position as THREE.BufferAttribute;
    const colorAttr = enemy.trailGeometry.attributes.color as THREE.BufferAttribute;

    for (let i = 0; i < trailCount; i++) {
      const p = enemy.trail[i];
      posAttr.setXYZ(i, p.x, p.y, p.z);

      // Fade color from head to tail
      const t = i / Math.max(trailCount - 1, 1);
      const alpha = 1.0 - t;
      colorAttr.setXYZ(
        i,
        enemy.color.r * alpha * 0.8,
        enemy.color.g * alpha * 0.8,
        enemy.color.b * alpha * 0.8,
      );
    }

    // Zero out unused slots
    for (let i = trailCount; i < TRAIL_MAX_POINTS; i++) {
      posAttr.setXYZ(i, 0, 0, 0);
      colorAttr.setXYZ(i, 0, 0, 0);
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    enemy.trailGeometry.setDrawRange(0, trailCount);
  }

  // -----------------------------------------------------------------------
  // Private: cleanup helpers
  // -----------------------------------------------------------------------

  private disposeGroup(group: THREE.Group | THREE.Object3D): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else if (child.material) {
          child.material.dispose();
        }
      }
    });
  }

  // -----------------------------------------------------------------------
  // Private: resize
  // -----------------------------------------------------------------------

  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  };
}
