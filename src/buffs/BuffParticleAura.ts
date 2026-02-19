/**
 * BuffParticleAura --- 3D volumetric particle auras for active buffs.
 *
 * Adds floating, rising, swirling particles ON TOP of the existing flat
 * BuffAuraRenderer ring. Three visual styles:
 *
 *   1. Floating Embers   - Small glowing dots drift upward, fade at peak
 *   2. Lava Lamp         - Larger blobby particles rise/fall organically
 *   3. Energy Vortex     - Particles spiral upward in a helix
 *
 * Performance:
 *   - Max 50 particles per active aura (3 active = 150 total worst case)
 *   - All arrays pre-allocated, zero per-frame heap allocations
 *   - Single THREE.Points draw call per aura style
 *   - Lightweight billboard shader (soft glow circles)
 */

import * as THREE from 'three';
import { StackBuffType } from './BuffManager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max particles per single aura instance. */
const MAX_PARTICLES_PER_AURA = 50;

/** Maximum simultaneous aura particle systems (matches BuffAuraRenderer). */
const MAX_AURAS = 3;

/** Total particle pool size. */
const TOTAL_PARTICLES = MAX_PARTICLES_PER_AURA * MAX_AURAS;

/** Aura ring radius — particles spawn within this ring. */
const AURA_RADIUS = 1.2;

/** Maximum height particles rise above the surface. */
const MAX_HEIGHT = 1.8;

/**
 * Maximum alpha reduction applied to particles when enemies are inside the aura zone.
 * 0.75 = up to 75% reduction (particles drop to 25% of normal alpha).
 */
const PARTICLE_MAX_DIM = 0.75;

// ---------------------------------------------------------------------------
// Pre-allocated temp vectors (module-level, zero allocation in update)
// ---------------------------------------------------------------------------

const _tempVec = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _bitangent = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _worldRight = new THREE.Vector3(1, 0, 0);

// ---------------------------------------------------------------------------
// Aura style enum
// ---------------------------------------------------------------------------

export enum AuraStyle {
  FloatingEmbers = 0,
  LavaLamp = 1,
  EnergyVortex = 2,
}

// ---------------------------------------------------------------------------
// Buff-to-style + color mapping
// ---------------------------------------------------------------------------

interface BuffAuraConfig {
  style: AuraStyle;
  color: THREE.Color;
  /** Secondary color for variation. */
  colorAlt: THREE.Color;
}

const BUFF_AURA_CONFIGS: Record<StackBuffType, BuffAuraConfig> = {
  [StackBuffType.HotHands]: {
    style: AuraStyle.FloatingEmbers,
    color: new THREE.Color(0xff4400),
    colorAlt: new THREE.Color(0xffaa00),
  },
  [StackBuffType.TriggerHappy]: {
    style: AuraStyle.EnergyVortex,
    color: new THREE.Color(0xff8800),
    colorAlt: new THREE.Color(0xffff88),
  },
  [StackBuffType.Afterburner]: {
    style: AuraStyle.EnergyVortex,
    color: new THREE.Color(0x44ff44),
    colorAlt: new THREE.Color(0xaaffaa),
  },
  [StackBuffType.Magnetism]: {
    style: AuraStyle.LavaLamp,
    color: new THREE.Color(0xffff00),
    colorAlt: new THREE.Color(0xffdd44),
  },
  [StackBuffType.ToughTimes]: {
    style: AuraStyle.LavaLamp,
    color: new THREE.Color(0x4488ff),
    colorAlt: new THREE.Color(0x88bbff),
  },
  [StackBuffType.ShockAura]: {
    style: AuraStyle.EnergyVortex,
    color: new THREE.Color(0xaa44ff),
    colorAlt: new THREE.Color(0xddaaff),
  },
  [StackBuffType.IncendiaryRounds]: {
    style: AuraStyle.FloatingEmbers,
    color: new THREE.Color(0xff6600),
    colorAlt: new THREE.Color(0xffcc44),
  },
  [StackBuffType.Volatile]: {
    style: AuraStyle.FloatingEmbers,
    color: new THREE.Color(0xff2244),
    colorAlt: new THREE.Color(0xff88aa),
  },
};

// ---------------------------------------------------------------------------
// Particle data (pre-allocated, flat arrays)
// ---------------------------------------------------------------------------

interface ParticlePool {
  /** Positions in LOCAL space (relative to player). XYZ interleaved. */
  localPos: Float32Array;
  /** Velocity components. XYZ interleaved. */
  velocity: Float32Array;
  /** Current age of each particle (seconds). */
  age: Float32Array;
  /** Maximum lifetime of each particle (seconds). */
  maxAge: Float32Array;
  /** Random phase offset (used for organic motion). */
  phase: Float32Array;
  /** Random angular position on the ring (radians). */
  theta: Float32Array;
  /** Whether each slot is alive. */
  alive: Uint8Array;
  /** Number currently alive. */
  activeCount: number;
}

function createParticlePool(count: number): ParticlePool {
  return {
    localPos: new Float32Array(count * 3),
    velocity: new Float32Array(count * 3),
    age: new Float32Array(count),
    maxAge: new Float32Array(count),
    phase: new Float32Array(count),
    theta: new Float32Array(count),
    alive: new Uint8Array(count),
    activeCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Vertex + Fragment shaders
// ---------------------------------------------------------------------------

const PARTICLE_VERTEX_SHADER = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vAlpha = aAlpha;
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    // Size attenuation
    gl_PointSize = aSize * (250.0 / -mvPosition.z);
    // Clamp to prevent giant particles when camera is close
    gl_PointSize = clamp(gl_PointSize, 1.0, 64.0);
  }
`;

const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);

    // Soft glowing circle with bright core
    float coreBright = smoothstep(0.25, 0.0, dist) * 0.6;
    float outerGlow = smoothstep(0.5, 0.1, dist) * 0.3;
    float alpha = (coreBright + outerGlow) * vAlpha;

    if (alpha < 0.005) discard;

    gl_FragColor = vec4(vColor * alpha, alpha);
  }
`;

// ---------------------------------------------------------------------------
// BuffParticleAura class
// ---------------------------------------------------------------------------

export class BuffParticleAura {
  readonly root: THREE.Group;

  /** GPU-side points mesh. Single draw call for all particles. */
  private readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  // Flat GPU buffers
  private readonly gpuPositions: Float32Array;
  private readonly gpuColors: Float32Array;
  private readonly gpuSizes: Float32Array;
  private readonly gpuAlphas: Float32Array;

  // CPU-side particle pools, one per possible simultaneous aura
  private readonly pools: ParticlePool[] = [];

  // Tracking which buffs are currently active in which pool slot
  private readonly activeSlots: Array<{
    buffType: StackBuffType | null;
    config: BuffAuraConfig | null;
  }> = [];

  // Spawn rate control
  private readonly spawnTimers: Float32Array;

  // Total elapsed time
  private totalTime = 0;

  /**
   * Dimming factor applied to particle alpha when enemies are inside the aura zone.
   * 0 = no dimming, 1 = maximum dimming (PARTICLE_MAX_DIM alpha reduction).
   * Updated each frame by main.ts based on nearest enemy distance.
   */
  private dimmingFactor = 0;

  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'BuffParticleAuras';

    // Pre-allocate pools
    for (let i = 0; i < MAX_AURAS; i++) {
      this.pools.push(createParticlePool(MAX_PARTICLES_PER_AURA));
      this.activeSlots.push({ buffType: null, config: null });
    }
    this.spawnTimers = new Float32Array(MAX_AURAS);

    // GPU buffers (interleaved across all pool slots)
    this.gpuPositions = new Float32Array(TOTAL_PARTICLES * 3);
    this.gpuColors = new Float32Array(TOTAL_PARTICLES * 3);
    this.gpuSizes = new Float32Array(TOTAL_PARTICLES);
    this.gpuAlphas = new Float32Array(TOTAL_PARTICLES);

    // Build geometry
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.gpuPositions, 3),
    );
    this.geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.gpuColors, 3),
    );
    this.geometry.setAttribute(
      'aSize',
      new THREE.BufferAttribute(this.gpuSizes, 1),
    );
    this.geometry.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(this.gpuAlphas, 1),
    );

    // Material
    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX_SHADER,
      fragmentShader: PARTICLE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      precision: 'mediump', // Mobile: 10-20% GPU perf gain; desktop: no change
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 95; // Above aura rings (90-92) but below UI
    this.root.add(this.points);
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  /**
   * Update all particle auras.
   * @param dt - Frame delta time (seconds)
   * @param totalTime - Total elapsed game time (seconds)
   * @param playerPos - Player world position
   * @param surfaceNormal - Surface normal at player position
   * @param activeBuffs - Currently active buffs
   */
  update(
    dt: number,
    totalTime: number,
    playerPos: THREE.Vector3,
    surfaceNormal: THREE.Vector3,
    activeBuffs: Array<{ type: StackBuffType; stacks: number }>,
  ): void {
    this.totalTime = totalTime;

    // Build tangent frame from surface normal (for local-to-world transform)
    this.buildTangentFrame(surfaceNormal);

    // Assign buff types to pool slots (max 3)
    this.assignSlots(activeBuffs);

    // Update each active pool
    for (let s = 0; s < MAX_AURAS; s++) {
      const slot = this.activeSlots[s];
      const pool = this.pools[s];

      if (slot.buffType === null || slot.config === null) {
        // Deactivate all particles in this pool and zero GPU buffers
        this.deactivatePool(pool);
        this.zeroGPUSlot(s);
        continue;
      }

      const buffEntry = activeBuffs.find(b => b.type === slot.buffType);
      const stacks = buffEntry ? buffEntry.stacks : 1;

      // Spawn new particles
      this.spawnParticles(s, pool, slot.config, stacks, dt);

      // Simulate existing particles
      this.simulateParticles(pool, slot.config.style, dt);

      // Write to GPU buffers (world space)
      this.writeToGPU(s, pool, slot.config, playerPos, surfaceNormal);
    }

    // Mark GPU buffers dirty
    this.geometry.attributes.position.needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  /**
   * Set particle dimming intensity based on enemy proximity.
   * @param factor - 0 = no dimming, 1 = maximum dimming (PARTICLE_MAX_DIM alpha reduction)
   * Call this each frame from the game loop before update().
   */
  setDimmingFactor(factor: number): void {
    this.dimmingFactor = Math.max(0, Math.min(1, factor));
  }

  // -------------------------------------------------------------------------
  // Slot assignment
  // -------------------------------------------------------------------------

  private assignSlots(
    activeBuffs: Array<{ type: StackBuffType; stacks: number }>,
  ): void {
    // Take up to MAX_AURAS buffs (matching BuffAuraRenderer priority)
    const displayedBuffs = activeBuffs.slice(0, MAX_AURAS);

    for (let i = 0; i < MAX_AURAS; i++) {
      if (i < displayedBuffs.length) {
        const buff = displayedBuffs[i];
        if (this.activeSlots[i].buffType !== buff.type) {
          // Slot changed -- kill existing particles, reset spawn timer
          this.deactivatePool(this.pools[i]);
          this.spawnTimers[i] = 0;
        }
        this.activeSlots[i].buffType = buff.type;
        this.activeSlots[i].config = BUFF_AURA_CONFIGS[buff.type];
      } else {
        this.activeSlots[i].buffType = null;
        this.activeSlots[i].config = null;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tangent frame
  // -------------------------------------------------------------------------

  private buildTangentFrame(surfaceNormal: THREE.Vector3): void {
    // Choose a reference vector not parallel to the normal
    if (Math.abs(surfaceNormal.dot(_worldUp)) < 0.9) {
      _tangent.crossVectors(surfaceNormal, _worldUp).normalize();
    } else {
      _tangent.crossVectors(surfaceNormal, _worldRight).normalize();
    }
    _bitangent.crossVectors(surfaceNormal, _tangent).normalize();
  }

  // -------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------

  private spawnParticles(
    slotIndex: number,
    pool: ParticlePool,
    config: BuffAuraConfig,
    stacks: number,
    dt: number,
  ): void {
    // Spawn rate: 8-16 particles/sec depending on stacks
    const spawnRate = 8 + Math.min(stacks, 5) * 1.6;
    this.spawnTimers[slotIndex] += dt * spawnRate;

    while (this.spawnTimers[slotIndex] >= 1.0) {
      this.spawnTimers[slotIndex] -= 1.0;

      // Find a dead slot
      let spawnIdx = -1;
      for (let i = 0; i < MAX_PARTICLES_PER_AURA; i++) {
        if (pool.alive[i] === 0) {
          spawnIdx = i;
          break;
        }
      }
      if (spawnIdx === -1) break; // Pool full

      const i3 = spawnIdx * 3;

      // Random angle on the ring
      const theta = Math.random() * Math.PI * 2;
      pool.theta[spawnIdx] = theta;

      // Random radius within the ring area
      const r = (0.3 + Math.random() * 0.7) * AURA_RADIUS;

      // Initial local position (on the ring plane, slight offset up)
      pool.localPos[i3 + 0] = Math.cos(theta) * r; // tangent direction
      pool.localPos[i3 + 1] = 0.05 + Math.random() * 0.1; // height above surface
      pool.localPos[i3 + 2] = Math.sin(theta) * r; // bitangent direction

      // Random phase for organic motion
      pool.phase[spawnIdx] = Math.random() * Math.PI * 2;

      // Style-specific initialization
      switch (config.style) {
        case AuraStyle.FloatingEmbers: {
          // Drift upward gently
          pool.velocity[i3 + 0] = (Math.random() - 0.5) * 0.1;
          pool.velocity[i3 + 1] = 0.3 + Math.random() * 0.5; // upward
          pool.velocity[i3 + 2] = (Math.random() - 0.5) * 0.1;
          pool.maxAge[spawnIdx] = 1.0 + Math.random() * 1.5;
          break;
        }
        case AuraStyle.LavaLamp: {
          // Very slow rise with slight wobble
          pool.velocity[i3 + 0] = (Math.random() - 0.5) * 0.05;
          pool.velocity[i3 + 1] = 0.15 + Math.random() * 0.25;
          pool.velocity[i3 + 2] = (Math.random() - 0.5) * 0.05;
          pool.maxAge[spawnIdx] = 2.0 + Math.random() * 2.0;
          break;
        }
        case AuraStyle.EnergyVortex: {
          // No initial radial velocity -- helix motion added in simulate
          pool.velocity[i3 + 0] = 0;
          pool.velocity[i3 + 1] = 0.5 + Math.random() * 0.4; // upward spiral
          pool.velocity[i3 + 2] = 0;
          pool.maxAge[spawnIdx] = 1.2 + Math.random() * 1.0;
          break;
        }
      }

      pool.age[spawnIdx] = 0;
      pool.alive[spawnIdx] = 1;
      pool.activeCount++;
    }
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  private simulateParticles(
    pool: ParticlePool,
    style: AuraStyle,
    dt: number,
  ): void {
    let activeCount = 0;

    for (let i = 0; i < MAX_PARTICLES_PER_AURA; i++) {
      if (pool.alive[i] === 0) continue;

      pool.age[i] += dt;
      if (pool.age[i] >= pool.maxAge[i]) {
        pool.alive[i] = 0;
        continue;
      }

      activeCount++;
      const i3 = i * 3;
      const t = pool.age[i];
      const phase = pool.phase[i];

      switch (style) {
        case AuraStyle.FloatingEmbers: {
          // Simple upward drift with gentle lateral wobble
          pool.localPos[i3 + 0] += pool.velocity[i3 + 0] * dt;
          pool.localPos[i3 + 1] += pool.velocity[i3 + 1] * dt;
          pool.localPos[i3 + 2] += pool.velocity[i3 + 2] * dt;

          // Gentle horizontal drift (wind-like)
          pool.localPos[i3 + 0] += Math.sin(t * 2.0 + phase) * 0.15 * dt;
          pool.localPos[i3 + 2] += Math.cos(t * 1.7 + phase * 1.3) * 0.12 * dt;

          // Slow down vertical as it rises (air resistance feel)
          pool.velocity[i3 + 1] *= (1.0 - 0.3 * dt);
          break;
        }

        case AuraStyle.LavaLamp: {
          // Organic bobbing: rise, slow, bob, rise again
          const lifeT = pool.age[i] / pool.maxAge[i];

          // Primary rise
          pool.localPos[i3 + 1] += pool.velocity[i3 + 1] * dt;

          // Sinusoidal vertical modulation (bobbing)
          const bob = Math.sin(t * 1.5 + phase) * 0.08;
          pool.localPos[i3 + 1] += bob * dt;

          // Lateral organic wobble (lava lamp sway)
          const swayX = Math.sin(t * 0.8 + phase * 2.1) * 0.25;
          const swayZ = Math.cos(t * 0.6 + phase * 1.7) * 0.20;
          pool.localPos[i3 + 0] += swayX * dt;
          pool.localPos[i3 + 2] += swayZ * dt;

          // Slow vertical velocity over time (settle at top)
          pool.velocity[i3 + 1] *= (1.0 - 0.15 * dt);

          // At late life, gently drift back down
          if (lifeT > 0.7) {
            pool.velocity[i3 + 1] -= 0.1 * dt;
          }
          break;
        }

        case AuraStyle.EnergyVortex: {
          // Helix: particle spirals around the center while rising
          const theta0 = pool.theta[i];
          const angularSpeed = 3.0 + phase * 1.0; // rad/s
          const currentAngle = theta0 + t * angularSpeed;

          // Radius contracts as particle rises (funnel shape)
          const lifeRatio = pool.age[i] / pool.maxAge[i];
          const r = AURA_RADIUS * (1.0 - lifeRatio * 0.6);

          pool.localPos[i3 + 0] = Math.cos(currentAngle) * r;
          pool.localPos[i3 + 2] = Math.sin(currentAngle) * r;

          // Vertical rise
          pool.localPos[i3 + 1] += pool.velocity[i3 + 1] * dt;

          // Slight acceleration upward at top
          pool.velocity[i3 + 1] += 0.05 * dt;
          break;
        }
      }

      // Clamp height
      if (pool.localPos[i3 + 1] > MAX_HEIGHT) {
        pool.localPos[i3 + 1] = MAX_HEIGHT;
      }
      if (pool.localPos[i3 + 1] < 0) {
        pool.localPos[i3 + 1] = 0;
      }
    }

    pool.activeCount = activeCount;
  }

  // -------------------------------------------------------------------------
  // GPU write (local -> world transform)
  // -------------------------------------------------------------------------

  private writeToGPU(
    slotIndex: number,
    pool: ParticlePool,
    config: BuffAuraConfig,
    playerPos: THREE.Vector3,
    surfaceNormal: THREE.Vector3,
  ): void {
    const baseIdx = slotIndex * MAX_PARTICLES_PER_AURA;

    for (let i = 0; i < MAX_PARTICLES_PER_AURA; i++) {
      const gpuIdx = baseIdx + i;
      const g3 = gpuIdx * 3;
      const i3 = i * 3;

      if (pool.alive[i] === 0) {
        // Hide dead particles (zero size)
        this.gpuSizes[gpuIdx] = 0;
        this.gpuAlphas[gpuIdx] = 0;
        continue;
      }

      // Transform local position to world space:
      // worldPos = playerPos + localX * tangent + localY * normal + localZ * bitangent
      const lx = pool.localPos[i3 + 0];
      const ly = pool.localPos[i3 + 1];
      const lz = pool.localPos[i3 + 2];

      this.gpuPositions[g3 + 0] =
        playerPos.x + lx * _tangent.x + ly * surfaceNormal.x + lz * _bitangent.x;
      this.gpuPositions[g3 + 1] =
        playerPos.y + lx * _tangent.y + ly * surfaceNormal.y + lz * _bitangent.y;
      this.gpuPositions[g3 + 2] =
        playerPos.z + lx * _tangent.z + ly * surfaceNormal.z + lz * _bitangent.z;

      // Age-based alpha fade
      const lifeRatio = pool.age[i] / pool.maxAge[i];
      let alpha: number;
      if (lifeRatio < 0.1) {
        // Fade in
        alpha = lifeRatio / 0.1;
      } else if (lifeRatio > 0.7) {
        // Fade out
        alpha = (1.0 - lifeRatio) / 0.3;
      } else {
        alpha = 1.0;
      }
      this.gpuAlphas[gpuIdx] = alpha * 0.8 * (1.0 - this.dimmingFactor * PARTICLE_MAX_DIM);

      // Color: lerp between primary and alt based on height
      const heightRatio = ly / MAX_HEIGHT;
      const cr = config.color.r + (config.colorAlt.r - config.color.r) * heightRatio;
      const cg = config.color.g + (config.colorAlt.g - config.color.g) * heightRatio;
      const cb = config.color.b + (config.colorAlt.b - config.color.b) * heightRatio;
      this.gpuColors[g3 + 0] = cr;
      this.gpuColors[g3 + 1] = cg;
      this.gpuColors[g3 + 2] = cb;

      // Size: style-dependent
      switch (config.style) {
        case AuraStyle.FloatingEmbers:
          this.gpuSizes[gpuIdx] = 1.5 + Math.sin(pool.phase[i] + pool.age[i] * 3.0) * 0.5;
          break;
        case AuraStyle.LavaLamp:
          // Larger blobby particles, pulse in size
          this.gpuSizes[gpuIdx] = 3.0 + Math.sin(pool.phase[i] + pool.age[i] * 1.2) * 1.0;
          break;
        case AuraStyle.EnergyVortex:
          // Small fast particles, shrink toward top
          this.gpuSizes[gpuIdx] = 1.2 * (1.0 - heightRatio * 0.5);
          break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private deactivatePool(pool: ParticlePool): void {
    pool.alive.fill(0);
    pool.activeCount = 0;
  }

  /** Zero the GPU size/alpha arrays for a given slot so dead particles are invisible. */
  private zeroGPUSlot(slotIndex: number): void {
    const baseIdx = slotIndex * MAX_PARTICLES_PER_AURA;
    for (let i = 0; i < MAX_PARTICLES_PER_AURA; i++) {
      this.gpuSizes[baseIdx + i] = 0;
      this.gpuAlphas[baseIdx + i] = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
