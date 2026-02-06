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

  // Shatter fragment system
  private fragmentContainer: THREE.Group;
  private fragments: ShatterFragment[] = [];
  private fragmentGeometries: THREE.BufferGeometry[] = [];
  private maxFragments: number = 200;

  constructor(maxParticles: number = 5000) {
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

    // Create shader material
    this.material = new THREE.ShaderMaterial({
      uniforms: {},
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
        varying vec3 vColor;

        void main() {
          // Create circular point sprite
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);

          // Soft edge falloff
          float alpha = 1.0 - smoothstep(0.3, 0.5, dist);

          if (alpha < 0.01) discard;

          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });

    this.root = new THREE.Points(this.geometry, this.material);

    // Initialize fragment container and geometries
    this.fragmentContainer = new THREE.Group();
    this.root.add(this.fragmentContainer);

    // Create reusable fragment geometries
    this.fragmentGeometries = [
      this.createTriangleGeometry(),
      this.createSquareGeometry(),
      this.createDiamondGeometry(),
    ];

    // Pre-create fragment pool
    for (let i = 0; i < this.maxFragments; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide,
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
      direction = new THREE.Vector3(0, 1, 0),
      gravity = 0,
    } = config;

    for (let i = 0; i < count; i++) {
      const index = this.getNextParticleIndex();
      if (index === -1) break; // No available particles

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

      // Set velocity with spread
      const theta = Math.random() * spread - spread / 2;
      const phi = Math.random() * Math.PI * 2;

      const spreadDir = new THREE.Vector3();
      spreadDir.copy(direction);

      // Apply spherical spread
      const perpendicular1 = new THREE.Vector3();
      if (Math.abs(direction.y) < 0.9) {
        perpendicular1.crossVectors(direction, new THREE.Vector3(0, 1, 0));
      } else {
        perpendicular1.crossVectors(direction, new THREE.Vector3(1, 0, 0));
      }
      perpendicular1.normalize();

      const perpendicular2 = new THREE.Vector3();
      perpendicular2.crossVectors(direction, perpendicular1);
      perpendicular2.normalize();

      spreadDir.addScaledVector(perpendicular1, Math.sin(theta) * Math.cos(phi));
      spreadDir.addScaledVector(perpendicular2, Math.sin(theta) * Math.sin(phi));
      spreadDir.normalize();

      const particleSpeed = speed * (0.8 + Math.random() * 0.4);
      particle.velocity.copy(spreadDir).multiplyScalar(particleSpeed);
    }

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
    for (let i = 0; i < fragmentCount; i++) {
      const fragment = this.getNextFragment();
      if (!fragment) break;

      // Pick random shape
      const shapeIndex = Math.floor(Math.random() * 3) as FragmentShape;
      fragment.mesh.geometry = this.fragmentGeometries[shapeIndex];

      // Set color with slight variation for visual interest
      const mat = fragment.mesh.material as THREE.MeshBasicMaterial;
      const colorVariation = 0.8 + Math.random() * 0.4;
      mat.color.copy(color).multiplyScalar(colorVariation);
      mat.opacity = 1;

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
    // Main shatter effect with geometric fragments
    const fragmentCount = 12 + Math.floor(Math.random() * 8);
    this.shatterEffect(position, color, fragmentCount, 1.0, 1.0);

    // Also emit some small sparkle particles for extra flair
    const dimColor = color.clone().multiplyScalar(0.7);
    this.emit({
      position,
      count: 8,
      color: dimColor,
      speed: 3,
      lifetime: 0.4,
      size: 1.5,
      spread: Math.PI * 2,
      gravity: -2,
    });
  }

  bulletImpact(position: THREE.Vector3): void {
    this.emit({
      position,
      count: 3,
      color: new THREE.Color(0.7, 0.6, 0.3),
      speed: 3,
      lifetime: 0.2,
      size: 1.5,
      spread: Math.PI * 2,
      gravity: 0,
    });
  }

  bombExplosion(position: THREE.Vector3): void {
    this.emit({
      position,
      count: 80,
      color: new THREE.Color(0.7, 0.4, 0.2),
      speed: 8,
      lifetime: 0.8,
      size: 3,
      spread: Math.PI * 2,
      gravity: -5,
    });
  }

  playerDeath(position: THREE.Vector3): void {
    // Dramatic player death - cyan colored shatter
    const playerColor = new THREE.Color(0x00ddff);

    // Large, dramatic shatter with many fragments
    this.shatterEffect(position, playerColor, 35, 1.5, 1.5);

    // Secondary ring of fragments slightly delayed appearance effect
    // Using a brighter cyan for the inner burst
    const brightCyan = new THREE.Color(0x66ffff);
    this.shatterEffect(position, brightCyan, 20, 0.8, 2.0);

    // Additional sparkle particles
    this.emit({
      position,
      count: 40,
      color: new THREE.Color(0.4, 0.9, 1.0),
      speed: 6,
      lifetime: 1.0,
      size: 2.5,
      spread: Math.PI * 2,
      gravity: -4,
    });

    // White flash particles in center
    this.emit({
      position,
      count: 15,
      color: new THREE.Color(1.0, 1.0, 1.0),
      speed: 8,
      lifetime: 0.3,
      size: 4,
      spread: Math.PI * 2,
      gravity: 0,
    });
  }

  geomCollect(position: THREE.Vector3): void {
    // Green sparkle burst when collecting a geom
    const geomColor = new THREE.Color(0x00ff66);

    // Main sparkle burst
    this.emit({
      position,
      count: 8,
      color: geomColor,
      speed: 4,
      lifetime: 0.3,
      size: 2.5,
      spread: Math.PI * 2,
      gravity: 2, // Float upward slightly
    });

    // Inner bright flash
    this.emit({
      position,
      count: 4,
      color: new THREE.Color(0xaaffaa),
      speed: 2,
      lifetime: 0.2,
      size: 3,
      spread: Math.PI * 2,
      gravity: 0,
    });
  }

  update(dt: number): void {
    let needsUpdate = false;

    // Update point particles
    for (let i = 0; i < this.maxParticles; i++) {
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

    if (needsUpdate) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.color.needsUpdate = true;
      this.geometry.attributes.size.needsUpdate = true;
    }

    // Update shatter fragments
    this.updateFragments(dt);
  }

  private updateFragments(dt: number): void {
    for (const fragment of this.fragments) {
      if (!fragment.active) continue;

      // Update life
      fragment.life -= dt;
      if (fragment.life <= 0) {
        fragment.active = false;
        fragment.mesh.visible = false;
        continue;
      }

      // Update position
      fragment.mesh.position.add(
        fragment.velocity.clone().multiplyScalar(dt),
      );

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
