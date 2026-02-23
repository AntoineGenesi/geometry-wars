import * as THREE from 'three';

interface ParticleConfig {
  position: THREE.Vector3;
  count: number;
  color: THREE.Color;
  speed: number;
  lifetime: number;
  size: number;
  spread?: number;
  direction?: THREE.Vector3;
  gravity?: number;
}

interface Particle {
  active: boolean;
  life: number;
  maxLife: number;
  velocity: THREE.Vector3;
  gravity: number;
}

// Fragment shapes for shatter effect
enum FragmentShape {
  Triangle = 0,
  Square = 1,
  Diamond = 2,
}

interface ShatterFragment {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  rotationVelocity: THREE.Vector3;
  life: number;
  maxLife: number;
  active: boolean;
  baseScale: number;
}

// ---------------------------------------------------------------------------
// Pre-allocated temp vectors for zero-allocation emit() hot path
// ---------------------------------------------------------------------------
const _spreadDir = new THREE.Vector3();
const _perp1 = new THREE.Vector3();
const _perp2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3(1, 0, 0);
const _defaultDir = new THREE.Vector3(0, 1, 0);

// Pre-allocated reusable colors for effect methods (avoid per-call allocations)
const _white = new THREE.Color(1.0, 1.0, 1.0);
const _dimColor = new THREE.Color();
const _tempColor = new THREE.Color();

export class ParticleSystem {
  readonly root: THREE.Points;
  private particles: Particle[];
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;

  private maxParticles: number;
  private nextParticleIndex: number;

  // High-water mark: tracks the highest active particle index to avoid iterating all 10K slots.
  // At high scores with 400+ enemies + mortars, this can save iterating thousands of dead slots.
  private _highWaterMark: number = 0;

  // Shatter fragment system
  private fragmentContainer: THREE.Group;
  private fragments: ShatterFragment[] = [];
  private fragmentGeometries: THREE.BufferGeometry[] = [];
  private maxFragments: number = 200; // Reduced from 400 — cuts draw calls in half

  // Per-frame emission budget to prevent cascade overload
  private _emittedThisFrame: number = 0;
  private _fragmentsThisFrame: number = 0;
  private _maxEmitPerFrame: number = 200; // Hard cap: 200 particles per frame
  private _maxFragmentsPerFrame: number = 40; // Hard cap: 40 fragments per frame

  // Dynamic scaling based on entity count (1.0 = full budget, 0.3 = minimum)
  private _entityScaleFactor: number = 1.0;

  // Active effect count (updated during update() — zero extra iteration)
  private _activeParticleCount: number = 0;
  private _activeFragmentCount: number = 0;

  constructor(maxParticles: number = 10000) {
    this.maxParticles = maxParticles;
    this.nextParticleIndex = 0;

    // Initialize particle data
    this.particles = [];
    for (let i = 0; i < maxParticles; i++) {
      this.particles.push({
        active: false,
        life: 0,
        maxLife: 1,
        velocity: new THREE.Vector3(),
        gravity: 0,
      });
    }

    // Create buffers
    this.positions = new Float32Array(maxParticles * 3);
    this.colors = new Float32Array(maxParticles * 3);
    this.sizes = new Float32Array(maxParticles);

    // Create geometry
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    // Create shader material — additive blending for see-through energy look
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        // In pixelated mode (half-res bloom), additive stacking makes clusters
        // blindingly bright. colorScale lets us reduce brightness to 0.5 in
        // pixelated mode to prevent particles from obscuring the player.
        colorScale: { value: 1.0 },
      },
      precision: 'mediump', // Mobile: 10-20% GPU perf gain; desktop: no change
      vertexShader: `
        attribute float size;
        attribute vec3 color;

        varying vec3 vColor;
        varying float vLife;

        void main() {
          vColor = color;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = size * (300.0 / -mvPosition.z);
        }
      `,
      fragmentShader: `
        uniform float colorScale;
        varying vec3 vColor;

        void main() {
          // Create circular point sprite
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);

          // Soft edge falloff — low peak alpha so overlapping particles stay see-through
          float alpha = 0.3 * colorScale * (1.0 - smoothstep(0.15, 0.5, dist));

          if (alpha < 0.01) discard;

          gl_FragColor = vec4(vColor * alpha, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.root = new THREE.Points(this.geometry, this.material);
    this.root.frustumCulled = false;

    // Initialize fragment container and geometries
    this.fragmentContainer = new THREE.Group();
    this.root.add(this.fragmentContainer);

    // Create reusable fragment geometries
    this.fragmentGeometries = [
      this.createTriangleGeometry(),
      this.createSquareGeometry(),
      this.createDiamondGeometry(),
    ];

    // Pre-create fragment pool — additive blending for see-through energy look
    for (let i = 0; i < this.maxFragments; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.fragmentGeometries[0], material);
      mesh.visible = false;
      this.fragmentContainer.add(mesh);

      this.fragments.push({
        mesh,
        velocity: new THREE.Vector3(),
        rotationVelocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        active: false,
        baseScale: 1,
      });
    }
  }

  /** Total active particles + fragments (updated each update() call). Zero cost to read. */
  get activeEffectCount(): number {
    return this._activeParticleCount + this._activeFragmentCount;
  }

  /** Set per-frame particle emission budget (tied to quality level). */
  setEmitBudget(maxParticlesPerFrame: number, maxFragmentsPerFrame: number): void {
    this._maxEmitPerFrame = maxParticlesPerFrame;
    this._maxFragmentsPerFrame = maxFragmentsPerFrame;
  }

  /**
   * Set dynamic scaling factor based on entity count.
   * Reduces particle emission when many entities are on screen.
   * Factor should be in range [0.3, 1.0]:
   *   1.0 = full budget (normal conditions)
   *   0.5 = half budget (moderate entity count)
   *   0.3 = minimum budget (heavy entity count)
   */
  setEntityScaleFactor(factor: number): void {
    this._entityScaleFactor = Math.max(0.3, Math.min(1.0, factor));
  }

  /**
   * Reduce particle brightness in pixelated mode.
   *
   * In pixelated mode the bloom pass runs at half resolution, so bloom spots
   * are physically larger on screen. Additive blending already stacks particle
   * brightness; combined with enlarged half-res bloom the cluster around the
   * player can become a solid white patch that obscures the ship.
   *
   * Setting colorScale=0.5 halves per-particle brightness — dense clusters stay
   * visually interesting without overrunning the player silhouette.
   * Fragment (shatter) opacity is reduced by the same ratio.
   */
  setPixelatedMode(isPixelated: boolean): void {
    const colorScale = isPixelated ? 0.5 : 1.0;
    this.material.uniforms.colorScale.value = colorScale;

    // Also reduce opacity on pre-pooled fragment meshes
    const fragmentOpacity = isPixelated ? 0.2 : 0.4;
    for (const fragment of this.fragments) {
      (fragment.mesh.material as THREE.MeshBasicMaterial).opacity = fragmentOpacity;
    }
  }

  private createTriangleGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      0, 0.1, 0,
      -0.087, -0.05, 0,
      0.087, -0.05, 0,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  private createSquareGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const size = 0.07;
    const vertices = new Float32Array([
      -size, -size, 0,
      size, -size, 0,
      size, size, 0,
      -size, -size, 0,
      size, size, 0,
      -size, size, 0,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  private createDiamondGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const size = 0.1;
    const vertices = new Float32Array([
      0, size, 0,
      -size * 0.6, 0, 0,
      0, -size, 0,
      0, size, 0,
      0, -size, 0,
      size * 0.6, 0, 0,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  emit(config: ParticleConfig): void {
    const {
      position,
      count,
      color,
      speed,
      lifetime,
      size,
      spread = Math.PI * 2,
      gravity = 0,
    } = config;
    const direction = config.direction ?? _defaultDir;

    // Budget enforcement: apply dynamic scaling then clamp to remaining frame budget
    const scaledBudget = Math.floor(this._maxEmitPerFrame * this._entityScaleFactor);
    const budgetRemaining = scaledBudget - this._emittedThisFrame;
    if (budgetRemaining <= 0) return;
    const effectiveCount = Math.min(count, budgetRemaining);

    // Compute perpendicular axes ONCE outside the loop (zero allocation)
    _perp1.set(0, 0, 0);
    if (Math.abs(direction.y) < 0.9) {
      _perp1.crossVectors(direction, _up);
    } else {
      _perp1.crossVectors(direction, _right);
    }
    _perp1.normalize();

    _perp2.crossVectors(direction, _perp1);
    _perp2.normalize();

    for (let i = 0; i < effectiveCount; i++) {
      const index = this.getNextParticleIndex();
      if (index === -1) break; // No available particles

      // Track high water mark for efficient update() iteration
      if (index >= this._highWaterMark) {
        this._highWaterMark = index + 1;
      }

      const particle = this.particles[index];
      particle.active = true;
      particle.life = lifetime;
      particle.maxLife = lifetime;
      particle.gravity = gravity;

      // Set position
      const baseIndex = index * 3;
      this.positions[baseIndex] = position.x;
      this.positions[baseIndex + 1] = position.y;
      this.positions[baseIndex + 2] = position.z;

      // Set color
      this.colors[baseIndex] = color.r;
      this.colors[baseIndex + 1] = color.g;
      this.colors[baseIndex + 2] = color.b;

      // Set size
      this.sizes[index] = size;

      // Set velocity with spread — zero allocations using module-level temps
      const theta = Math.random() * spread - spread / 2;
      const phi = Math.random() * Math.PI * 2;

      _spreadDir.copy(direction);
      _spreadDir.addScaledVector(_perp1, Math.sin(theta) * Math.cos(phi));
      _spreadDir.addScaledVector(_perp2, Math.sin(theta) * Math.sin(phi));
      _spreadDir.normalize();

      const particleSpeed = speed * (0.8 + Math.random() * 0.4);
      particle.velocity.copy(_spreadDir).multiplyScalar(particleSpeed);
    }

    this._emittedThisFrame += effectiveCount;

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
  }

  /**
   * Create a dramatic shattering effect with geometric fragments
   * @param position World position of the shatter
   * @param color Color of the fragments
   * @param fragmentCount Number of fragments to spawn
   * @param scale Size multiplier for fragments (default 1.0)
   * @param speed Speed multiplier for outward velocity (default 1.0)
   */
  shatterEffect(
    position: THREE.Vector3,
    color: THREE.Color,
    fragmentCount: number,
    scale: number = 1.0,
    speed: number = 1.0,
  ): void {
    // Budget enforcement: apply dynamic scaling then clamp to remaining frame budget
    const scaledBudget = Math.floor(this._maxFragmentsPerFrame * this._entityScaleFactor);
    const budgetRemaining = scaledBudget - this._fragmentsThisFrame;
    if (budgetRemaining <= 0) return;
    const effectiveCount = Math.min(fragmentCount, budgetRemaining);

    for (let i = 0; i < effectiveCount; i++) {
      const fragment = this.getNextFragment();
      if (!fragment) break;

      // Pick random shape
      const shapeIndex = Math.floor(Math.random() * 3) as FragmentShape;
      fragment.mesh.geometry = this.fragmentGeometries[shapeIndex];

      // Set color with slight variation for visual interest
      const mat = fragment.mesh.material as THREE.MeshBasicMaterial;
      const colorVariation = 0.8 + Math.random() * 0.4;
      mat.color.copy(color).multiplyScalar(colorVariation);
      mat.opacity = 0.4;

      // Position at shatter origin
      fragment.mesh.position.copy(position);

      // Random scale variation
      const fragmentScale = scale * (0.5 + Math.random() * 1.0);
      fragment.baseScale = fragmentScale;
      fragment.mesh.scale.setScalar(fragmentScale);

      // Random outward velocity in all directions (spherical distribution)
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const baseSpeed = (2 + Math.random() * 4) * speed;

      fragment.velocity.set(
        Math.sin(phi) * Math.cos(theta) * baseSpeed,
        Math.sin(phi) * Math.sin(theta) * baseSpeed,
        Math.cos(phi) * baseSpeed,
      );

      // Random rotation velocity (tumbling as fragments fly)
      fragment.rotationVelocity.set(
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
      );

      // Lifetime with variation
      fragment.maxLife = 0.5 + Math.random() * 0.5;
      fragment.life = fragment.maxLife;
      fragment.active = true;
      fragment.mesh.visible = true;

      // Random initial rotation
      fragment.mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      );
    }

    this._fragmentsThisFrame += effectiveCount;
  }

  private getNextFragment(): ShatterFragment | null {
    for (const fragment of this.fragments) {
      if (!fragment.active) {
        return fragment;
      }
    }
    return null;
  }

  enemyDeath(position: THREE.Vector3, color: THREE.Color): void {
    // Geometric fragment shatter — visible but not screen-filling
    const fragmentCount = 12 + Math.floor(Math.random() * 6); // Reduced from 18-28 to 12-18
    this.shatterEffect(position, color, fragmentCount, 0.7, 1.4);

    // Sparse sparkle burst — fast-fading so you can see through it
    _dimColor.copy(color).multiplyScalar(0.6); // Re-use pre-allocated color
    this.emit({
      position,
      count: 12, // Reduced from 16
      color: _dimColor,
      speed: 6,
      lifetime: 0.3,
      size: 1.0,
      spread: Math.PI * 2,
      gravity: -2,
    });

    // Tiny bright core flash — quick pop
    this.emit({
      position,
      count: 3, // Reduced from 4
      color: _white,
      speed: 3,
      lifetime: 0.08,
      size: 1.8,
      spread: Math.PI * 2,
      gravity: 0,
    });
  }

  bulletImpact(position: THREE.Vector3): void {
    _tempColor.setHex(0x88ffff);
    this.emit({
      position,
      count: 8, // Reduced from 15
      color: _tempColor,
      speed: 4,
      lifetime: 0.25,
      size: 1.5,
      spread: Math.PI * 2,
      gravity: 0,
    });
  }

  bombExplosion(position: THREE.Vector3): void {
    // White shockwave burst — reduced count/size for additive transparency
    this.emit({
      position,
      count: 24, // Reduced from 40
      color: _white,
      speed: 12,
      lifetime: 0.35,
      size: 2,
      spread: Math.PI * 2,
      gravity: 0,
    });
    // Secondary cyan ring — fast expanding, short-lived
    _tempColor.setHex(0x44ffff);
    this.emit({
      position,
      count: 16, // Reduced from 24
      color: _tempColor,
      speed: 8,
      lifetime: 0.4,
      size: 1.5,
      spread: Math.PI * 2,
      gravity: 0,
    });
  }

  /**
   * Homing missile explosion — compact electronic burst, not a cloud.
   * Fast-fading small sparks that don't obstruct the view.
   */
  homingExplosion(position: THREE.Vector3): void {
    // Small shatter: a handful of fast-moving tiny fragments
    _tempColor.setHex(0xff6644);
    this.shatterEffect(position, _tempColor, 6, 0.4, 2.0); // Reduced from 8

    // Sparse outward sparks — red-orange electronic feel
    _tempColor.setHex(0xff4422);
    this.emit({
      position,
      count: 8, // Reduced from 12
      color: _tempColor,
      speed: 6,
      lifetime: 0.2,
      size: 1.2,
      spread: Math.PI * 2,
      gravity: 0,
    });

    // Tiny white core flash
    _tempColor.set(1.0, 0.8, 0.6);
    this.emit({
      position,
      count: 3, // Reduced from 4
      color: _tempColor,
      speed: 2,
      lifetime: 0.1,
      size: 1.5,
      spread: Math.PI * 2,
      gravity: 0,
    });
  }

  /**
   * Plasma mortar explosion — fast-expanding neon ring.
   * Lightweight: single ring of sparks + tiny core flash.
   * No fragments (AoE kills already spawn their own death effects).
   */
  mortarExplosion(position: THREE.Vector3): void {
    // Single expanding ring of green neon sparks
    _tempColor.setHex(0x44ff44);
    this.emit({
      position,
      count: 16, // Reduced from 24
      color: _tempColor,
      speed: 10,
      lifetime: 0.25, // Shorter lifetime — fast pop, not lingering cloud
      size: 1.2,
      spread: Math.PI * 2,
      gravity: 0,
    });

    // Tiny bright core flash
    _tempColor.set(0.9, 1.0, 0.8);
    this.emit({
      position,
      count: 4, // Reduced from 6
      color: _tempColor,
      speed: 3,
      lifetime: 0.1,
      size: 1.8,
      spread: Math.PI * 2,
      gravity: 0,
    });
    // NOTE: No fragments here — the AoE enemy deaths already produce
    // their own shatter effects. Adding fragments to the explosion
    // itself doubled the visual noise and draw calls for no benefit.
  }

  /**
   * Lightweight death effect for enemies killed by AoE weapons
   * (homing splash, mortar splash). Much less visual than a full enemyDeath
   * so that clusters of AoE kills don't flood the screen.
   */
  aoeDeath(position: THREE.Vector3, color: THREE.Color): void {
    // Minimal sparks — just enough to show something died
    this.shatterEffect(position, color, 6, 0.5, 1.0); // Reduced from 12

    _dimColor.copy(color).multiplyScalar(0.7); // Re-use pre-allocated color
    this.emit({
      position,
      count: 6, // Reduced from 10
      color: _dimColor,
      speed: 4,
      lifetime: 0.25,
      size: 0.8,
      spread: Math.PI * 2,
      gravity: -1,
    });
  }

  playerDeath(position: THREE.Vector3): void {
    // GW3D: player death is ~10x enemy death — dramatic but still budgeted
    _tempColor.setHex(0x00ddff);
    this.shatterEffect(position, _tempColor, 60, 1.5, 2.0); // Reduced from 80

    _tempColor.setHex(0x66ffff);
    this.shatterEffect(position, _tempColor, 30, 0.8, 2.5); // Reduced from 50

    _tempColor.set(1.0, 0.95, 0.7);
    this.emit({
      position,
      count: 80, // Reduced from 120
      color: _tempColor,
      speed: 8,
      lifetime: 1.5,
      size: 2.5,
      spread: Math.PI * 2,
      gravity: -3,
    });

    _tempColor.set(0.4, 0.9, 1.0);
    this.emit({
      position,
      count: 40, // Reduced from 60
      color: _tempColor,
      speed: 6,
      lifetime: 1.2,
      size: 2.0,
      spread: Math.PI * 2,
      gravity: -2,
    });

    this.emit({
      position,
      count: 20, // Reduced from 30
      color: _white,
      speed: 10,
      lifetime: 0.3,
      size: 4,
      spread: Math.PI * 2,
      gravity: 0,
    });
  }

  geomCollect(position: THREE.Vector3): void {
    _tempColor.setHex(0x00ff44);
    this.emit({
      position,
      count: 3,
      color: _tempColor,
      speed: 1.5,
      lifetime: 0.15,
      size: 1.5,
      spread: Math.PI * 2,
      gravity: 0,
    });
  }

  update(dt: number): void {
    // Reset per-frame emission budget
    this._emittedThisFrame = 0;
    this._fragmentsThisFrame = 0;

    let needsUpdate = false;
    let activeParticles = 0;
    let newHighWater = 0;

    // Update point particles — only iterate up to high water mark (not all maxParticles).
    // At high scores with 400+ enemies + mortars, this avoids iterating thousands of dead slots.
    const limit = this._highWaterMark;
    for (let i = 0; i < limit; i++) {
      const particle = this.particles[i];
      if (!particle.active) continue;

      // Update life
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        this.sizes[i] = 0;
        needsUpdate = true;
        continue;
      }
      activeParticles++;
      newHighWater = i + 1;

      // Update position
      const baseIndex = i * 3;
      this.positions[baseIndex] += particle.velocity.x * dt;
      this.positions[baseIndex + 1] += particle.velocity.y * dt;
      this.positions[baseIndex + 2] += particle.velocity.z * dt;

      // Apply gravity (pull toward surface at y=0)
      if (particle.gravity !== 0) {
        particle.velocity.y += particle.gravity * dt;
      }

      // Apply drag
      particle.velocity.multiplyScalar(0.98);

      // Fade based on life ratio
      const lifeRatio = particle.life / particle.maxLife;
      const fadeStart = 0.3;
      let alpha = 1.0;
      if (lifeRatio < fadeStart) {
        alpha = lifeRatio / fadeStart;
      }

      // Update color alpha by scaling color brightness
      const colorIndex = baseIndex;
      const originalR = this.colors[colorIndex];
      const originalG = this.colors[colorIndex + 1];
      const originalB = this.colors[colorIndex + 2];

      // Store base color on first frame (hacky but works for this use case)
      // In practice, we just fade the existing color
      this.colors[colorIndex] = originalR * (0.3 + 0.7 * alpha);
      this.colors[colorIndex + 1] = originalG * (0.3 + 0.7 * alpha);
      this.colors[colorIndex + 2] = originalB * (0.3 + 0.7 * alpha);

      needsUpdate = true;
    }

    this._highWaterMark = newHighWater;
    this._activeParticleCount = activeParticles;

    if (needsUpdate) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.color.needsUpdate = true;
      this.geometry.attributes.size.needsUpdate = true;
    }

    // Update shatter fragments (also updates _activeFragmentCount)
    this.updateFragments(dt);
  }

  private updateFragments(dt: number): void {
    let activeFragments = 0;
    for (const fragment of this.fragments) {
      if (!fragment.active) continue;

      // Update life
      fragment.life -= dt;
      if (fragment.life <= 0) {
        fragment.active = false;
        fragment.mesh.visible = false;
        continue;
      }
      activeFragments++;

      // Update position (use addScaledVector instead of clone().multiplyScalar())
      fragment.mesh.position.addScaledVector(fragment.velocity, dt);

      // Update rotation (tumbling effect)
      fragment.mesh.rotation.x += fragment.rotationVelocity.x * dt;
      fragment.mesh.rotation.y += fragment.rotationVelocity.y * dt;
      fragment.mesh.rotation.z += fragment.rotationVelocity.z * dt;

      // Apply drag to velocity
      fragment.velocity.multiplyScalar(0.96);

      // Fade out based on life
      const lifeRatio = fragment.life / fragment.maxLife;
      const mat = fragment.mesh.material as THREE.MeshBasicMaterial;

      // Fade starts at 40% life remaining
      if (lifeRatio < 0.4) {
        mat.opacity = lifeRatio / 0.4;
      }

      // Scale down slightly as fragment fades (use stored baseScale)
      const scaleMultiplier = 0.5 + 0.5 * lifeRatio;
      fragment.mesh.scale.setScalar(fragment.baseScale * scaleMultiplier);
    }
    this._activeFragmentCount = activeFragments;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();

    // Dispose fragment geometries and materials
    for (const geom of this.fragmentGeometries) {
      geom.dispose();
    }
    for (const fragment of this.fragments) {
      (fragment.mesh.material as THREE.MeshBasicMaterial).dispose();
    }
  }

  private getNextParticleIndex(): number {
    // Find next inactive particle
    const startIndex = this.nextParticleIndex;

    for (let i = 0; i < this.maxParticles; i++) {
      const index = (startIndex + i) % this.maxParticles;
      if (!this.particles[index].active) {
        this.nextParticleIndex = (index + 1) % this.maxParticles;
        return index;
      }
    }

    return -1; // No available particles
  }
}
