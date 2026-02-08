import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SurfaceFactory, SurfaceType } from '../surfaces/SurfaceFactory';
import { Surface } from '../surfaces/Surface';

/**
 * Animated 3D background for the start menu.
 *
 * Renders a randomly chosen surface rotating slowly with neon-glow entities
 * orbiting along great-circle paths on its surface. Each entity leaves a
 * subtle trail. The canvas sits behind the DOM menu overlay (z-index 999).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrbitingEntity {
  /** The glowing sphere mesh */
  mesh: THREE.Mesh;
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
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTITY_COLORS = [
  0x00ffff, // cyan
  0xff00ff, // magenta
  0x00ff00, // green
  0xffaa00, // orange
  0xffff00, // yellow
];

const ENTITY_COUNT = 18;
const TRAIL_MAX_POINTS = 40;
const TRAIL_FADE_TIME = 0.6;
const SURFACE_ROTATE_SPEED = 0.1; // rad/s around Y
const ENTITY_SPHERE_RADIUS = 0.15;

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
  private entities: OrbitingEntity[] = [];
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

    // -- Camera --
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 200);
    this.camera.position.set(0, 12, 22);
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

    // -- Spawn orbiting entities --
    this.spawnEntities();

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
    window.removeEventListener('resize', this.onResize);

    // Dispose entity resources
    for (const entity of this.entities) {
      entity.mesh.geometry.dispose();
      (entity.mesh.material as THREE.Material).dispose();
      entity.trailGeometry.dispose();
      (entity.trailLine.material as THREE.Material).dispose();
    }
    this.entities = [];

    // Dispose surface
    this.surface.dispose();

    // Dispose post-processing and renderer
    this.composer.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // -----------------------------------------------------------------------
  // Private: surface creation
  // -----------------------------------------------------------------------

  private createSurface(type: SurfaceType): Surface {
    const scale = 8;
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
      bevelRadius: 0.6,
      gridSegmentsU: 20,
      gridSegmentsV: 16,
    };
    return SurfaceFactory.create(type, config as any);
  }

  // -----------------------------------------------------------------------
  // Private: entity spawning
  // -----------------------------------------------------------------------

  private spawnEntities(): void {
    for (let i = 0; i < ENTITY_COUNT; i++) {
      const colorHex = ENTITY_COLORS[i % ENTITY_COLORS.length];
      const color = new THREE.Color(colorHex);

      // Glowing sphere
      const geometry = new THREE.SphereGeometry(ENTITY_SPHERE_RADIUS, 8, 8);
      const material = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.9,
      });
      const mesh = new THREE.Mesh(geometry, material);
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
      // Each entity travels along a "great circle"-like UV path with a unique tilt
      const baseSpeed = 0.03 + Math.random() * 0.04;
      const angle = Math.random() * Math.PI * 2;
      const speedU = baseSpeed * Math.cos(angle);
      const speedV = baseSpeed * Math.sin(angle);

      this.entities.push({
        mesh,
        u,
        v,
        speedU,
        speedV,
        trail: [],
        trailLine,
        trailGeometry,
        color,
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

    // Update entities
    for (const entity of this.entities) {
      this.updateEntity(entity, dt);
    }

    // Render
    this.composer.render();
  };

  // -----------------------------------------------------------------------
  // Private: entity update
  // -----------------------------------------------------------------------

  private updateEntity(entity: OrbitingEntity, dt: number): void {
    // Move in UV space
    entity.u += entity.speedU * dt;
    entity.v += entity.speedV * dt;

    // Wrap UV coordinates
    entity.u = ((entity.u % 1) + 1) % 1;
    entity.v = ((entity.v % 1) + 1) % 1;

    // Project onto surface to get world position
    const surfacePoint = this.surface.getPoint(entity.u, entity.v);
    const worldPos = surfacePoint.position.clone();

    // Apply surface group rotation so entity stays on the rotating surface
    worldPos.applyMatrix4(this.surfaceGroup.matrixWorld);

    // Offset slightly above surface along normal (so entity sits on top)
    const worldNormal = surfacePoint.normal.clone()
      .applyQuaternion(this.surfaceGroup.quaternion)
      .normalize();
    worldPos.addScaledVector(worldNormal, ENTITY_SPHERE_RADIUS * 1.5);

    entity.mesh.position.copy(worldPos);

    // Update trail
    entity.trail.unshift(worldPos.clone());
    if (entity.trail.length > TRAIL_MAX_POINTS) {
      entity.trail.pop();
    }

    this.updateTrailGeometry(entity);
  }

  private updateTrailGeometry(entity: OrbitingEntity): void {
    const trailCount = entity.trail.length;
    const posAttr = entity.trailGeometry.attributes.position as THREE.BufferAttribute;
    const colorAttr = entity.trailGeometry.attributes.color as THREE.BufferAttribute;

    for (let i = 0; i < trailCount; i++) {
      const p = entity.trail[i];
      posAttr.setXYZ(i, p.x, p.y, p.z);

      // Fade color from head to tail
      const t = i / Math.max(trailCount - 1, 1);
      const alpha = 1.0 - t;
      colorAttr.setXYZ(
        i,
        entity.color.r * alpha * 0.8,
        entity.color.g * alpha * 0.8,
        entity.color.b * alpha * 0.8,
      );
    }

    // Zero out unused slots
    for (let i = trailCount; i < TRAIL_MAX_POINTS; i++) {
      posAttr.setXYZ(i, 0, 0, 0);
      colorAttr.setXYZ(i, 0, 0, 0);
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    entity.trailGeometry.setDrawRange(0, trailCount);
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
