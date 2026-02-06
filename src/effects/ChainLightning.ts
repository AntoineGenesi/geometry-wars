import * as THREE from 'three';

/**
 * Visual chain lightning effect that arcs between enemies
 * Creates electric bolt visuals with branching segments
 */

interface LightningBolt {
  line: THREE.Line;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  age: number;
  maxAge: number;
  intensity: number;
}

interface ChainTarget {
  position: THREE.Vector3;
  damageMultiplier: number;
  index: number;
}

// Colors for lightning
const MAIN_BOLT_COLOR = new THREE.Color(0xaaffff); // Bright cyan-white
const CHAIN_BOLT_COLOR = new THREE.Color(0x8844ff); // Purple-blue
const GLOW_COLOR = new THREE.Color(0x4488ff); // Blue glow

export class ChainLightningEffect {
  readonly root: THREE.Group;
  private bolts: LightningBolt[] = [];
  private glowSprites: THREE.Sprite[] = [];
  private readonly maxBolts = 50;

  // Materials
  private readonly mainMaterial: THREE.LineBasicMaterial;
  private readonly chainMaterial: THREE.LineBasicMaterial;
  private readonly glowMaterial: THREE.SpriteMaterial;

  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'ChainLightning';

    // Main bolt material (first hit)
    this.mainMaterial = new THREE.LineBasicMaterial({
      color: MAIN_BOLT_COLOR,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      linewidth: 3,
    });

    // Chain bolt material (subsequent hits)
    this.chainMaterial = new THREE.LineBasicMaterial({
      color: CHAIN_BOLT_COLOR,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      linewidth: 2,
    });

    // Glow sprite material
    const glowTexture = this.createGlowTexture();
    this.glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: GLOW_COLOR,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  /**
   * Fire chain lightning from origin, chaining through targets
   * @param origin - Starting position
   * @param targets - Ordered list of targets with damage multipliers
   * @param onHit - Callback for each target hit (position, damage multiplier)
   */
  fire(
    origin: THREE.Vector3,
    targets: ChainTarget[],
    onHit?: (position: THREE.Vector3, damageMultiplier: number, targetIndex: number) => void,
  ): void {
    if (targets.length === 0) return;

    let lastPos = origin.clone();

    targets.forEach((target, i) => {
      const isMain = i === 0;
      const bolt = this.createBolt(
        lastPos,
        target.position,
        isMain,
        isMain ? 1.0 : 0.7 - i * 0.1,
      );

      // Add glow at hit point
      this.addGlow(target.position, isMain ? 1.0 : 0.6);

      // Trigger hit callback
      onHit?.(target.position.clone(), target.damageMultiplier, target.index);

      lastPos = target.position.clone();
    });
  }

  /**
   * Find chain targets from a starting enemy position
   * @param startPos - Position of first hit enemy
   * @param enemies - Array of {position, index} for all enemies
   * @param maxChains - Maximum number of chains (default 5)
   * @param maxRange - Maximum chain distance (default 3)
   * @returns Ordered array of targets
   */
  static findChainTargets(
    startPos: THREE.Vector3,
    enemies: { position: THREE.Vector3; index: number }[],
    maxChains: number = 5,
    maxRange: number = 3,
  ): ChainTarget[] {
    const targets: ChainTarget[] = [];
    const usedIndices = new Set<number>();
    let currentPos = startPos.clone();
    let damageMultiplier = 1.0;

    for (let chain = 0; chain < maxChains; chain++) {
      // Find nearest enemy within range that hasn't been hit
      let nearestDist = maxRange;
      let nearestEnemy: { position: THREE.Vector3; index: number } | null = null;

      for (const enemy of enemies) {
        if (usedIndices.has(enemy.index)) continue;

        const dist = currentPos.distanceTo(enemy.position);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestEnemy = enemy;
        }
      }

      if (!nearestEnemy) break;

      usedIndices.add(nearestEnemy.index);
      targets.push({
        position: nearestEnemy.position.clone(),
        damageMultiplier,
        index: nearestEnemy.index,
      });

      currentPos = nearestEnemy.position.clone();
      damageMultiplier *= 0.75; // 75% damage on each chain
    }

    return targets;
  }

  /**
   * Update all active bolts
   */
  update(dt: number): void {
    // Update bolts
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      bolt.age += dt;

      if (bolt.age >= bolt.maxAge) {
        // Remove expired bolt
        this.root.remove(bolt.line);
        bolt.line.geometry.dispose();
        this.bolts.splice(i, 1);
      } else {
        // Animate bolt (flicker and fade)
        const progress = bolt.age / bolt.maxAge;
        const flicker = 0.8 + Math.random() * 0.4;
        const fade = 1 - progress;

        const mat = bolt.line.material as THREE.LineBasicMaterial;
        mat.opacity = bolt.intensity * fade * flicker;

        // Update bolt geometry with jitter
        this.updateBoltGeometry(bolt);
      }
    }

    // Update glow sprites
    for (let i = this.glowSprites.length - 1; i >= 0; i--) {
      const sprite = this.glowSprites[i];
      const userData = sprite.userData as { age: number; maxAge: number };
      userData.age += dt;

      if (userData.age >= userData.maxAge) {
        this.root.remove(sprite);
        this.glowSprites.splice(i, 1);
      } else {
        const progress = userData.age / userData.maxAge;
        sprite.material.opacity = 0.6 * (1 - progress);
        sprite.scale.setScalar(0.5 + progress * 0.5);
      }
    }
  }

  /**
   * Create a lightning bolt between two points
   */
  private createBolt(
    start: THREE.Vector3,
    end: THREE.Vector3,
    isMain: boolean,
    intensity: number,
  ): LightningBolt {
    const geometry = this.createBoltGeometry(start, end);
    const material = isMain
      ? this.mainMaterial.clone()
      : this.chainMaterial.clone();

    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;

    const bolt: LightningBolt = {
      line,
      startPos: start.clone(),
      endPos: end.clone(),
      age: 0,
      maxAge: 0.3 + Math.random() * 0.1,
      intensity,
    };

    this.bolts.push(bolt);
    this.root.add(line);

    // Limit total bolts
    while (this.bolts.length > this.maxBolts) {
      const oldest = this.bolts.shift()!;
      this.root.remove(oldest.line);
      oldest.line.geometry.dispose();
    }

    return bolt;
  }

  /**
   * Create jagged lightning geometry
   */
  private createBoltGeometry(start: THREE.Vector3, end: THREE.Vector3): THREE.BufferGeometry {
    const points: THREE.Vector3[] = [];
    const segments = 8;
    const jitterAmount = 0.15;

    const direction = end.clone().sub(start);
    const length = direction.length();
    direction.normalize();

    // Get perpendicular vectors for jitter
    const up = new THREE.Vector3(0, 1, 0);
    let perp1 = new THREE.Vector3().crossVectors(direction, up);
    if (perp1.lengthSq() < 0.01) {
      perp1.set(1, 0, 0).crossVectors(direction, perp1);
    }
    perp1.normalize();
    const perp2 = new THREE.Vector3().crossVectors(direction, perp1).normalize();

    points.push(start.clone());

    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const pos = start.clone().add(direction.clone().multiplyScalar(length * t));

      // Add random jitter perpendicular to direction
      const jitter1 = (Math.random() - 0.5) * jitterAmount;
      const jitter2 = (Math.random() - 0.5) * jitterAmount;
      pos.add(perp1.clone().multiplyScalar(jitter1));
      pos.add(perp2.clone().multiplyScalar(jitter2));

      points.push(pos);
    }

    points.push(end.clone());

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return geometry;
  }

  /**
   * Update bolt geometry with new jitter
   */
  private updateBoltGeometry(bolt: LightningBolt): void {
    const newGeom = this.createBoltGeometry(bolt.startPos, bolt.endPos);
    bolt.line.geometry.dispose();
    bolt.line.geometry = newGeom;
  }

  /**
   * Add glow sprite at position
   */
  private addGlow(position: THREE.Vector3, intensity: number): void {
    const sprite = new THREE.Sprite(this.glowMaterial.clone());
    sprite.position.copy(position);
    sprite.scale.setScalar(0.5 * intensity);
    sprite.userData = { age: 0, maxAge: 0.4 };

    this.glowSprites.push(sprite);
    this.root.add(sprite);
  }

  /**
   * Create radial glow texture
   */
  private createGlowTexture(): THREE.CanvasTexture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    );
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(136, 170, 255, 0.8)');
    gradient.addColorStop(0.5, 'rgba(68, 136, 255, 0.4)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    return new THREE.CanvasTexture(canvas);
  }

  /**
   * Clear all effects
   */
  clear(): void {
    for (const bolt of this.bolts) {
      this.root.remove(bolt.line);
      bolt.line.geometry.dispose();
    }
    this.bolts = [];

    for (const sprite of this.glowSprites) {
      this.root.remove(sprite);
    }
    this.glowSprites = [];
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.clear();
    this.mainMaterial.dispose();
    this.chainMaterial.dispose();
    this.glowMaterial.dispose();
    this.glowMaterial.map?.dispose();
  }
}
