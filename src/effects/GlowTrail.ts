import * as THREE from 'three';

/**
 * Enhanced trail effect with glow layers.
 * Creates a multi-layered trail that gives the appearance of a glowing path.
 * Used for fast-moving entities like the player and certain enemies.
 */

interface TrailPoint {
  position: THREE.Vector3;
  age: number;
}

export class GlowTrail {
  readonly root: THREE.Group;

  // Core trail line
  private coreLine: THREE.Line;
  private coreGeometry: THREE.BufferGeometry;
  private coreMaterial: THREE.LineBasicMaterial;

  // Glow layers (wider, more transparent lines)
  private glowLines: THREE.Line[] = [];
  private glowGeometries: THREE.BufferGeometry[] = [];
  private glowMaterials: THREE.LineBasicMaterial[] = [];

  private points: TrailPoint[] = [];
  private maxPoints: number;
  private positions: Float32Array;
  private coreColors: Float32Array;

  private baseColor: THREE.Color;
  private glowColor: THREE.Color;
  private fadeTime: number;

  // Speed tracking for dynamic trail intensity
  private lastPosition: THREE.Vector3 | null = null;
  private currentSpeed = 0;
  private readonly speedThreshold = 0.5; // Minimum speed for full glow

  // Pre-allocated buffers for glow layer color updates (avoids 3 Float32Array allocs per frame)
  private dimmedColorBuffers: Float32Array[] = [];

  // Number of glow layers
  private static readonly GLOW_LAYERS = 3;

  constructor(
    color: THREE.Color,
    maxPoints: number = 60,
    fadeTime: number = 0.4
  ) {
    this.root = new THREE.Group();
    this.maxPoints = maxPoints;
    this.baseColor = color.clone();
    // Brighter glow color
    this.glowColor = color.clone().multiplyScalar(1.5);
    this.fadeTime = fadeTime;

    // Create buffers
    this.positions = new Float32Array(maxPoints * 3);
    this.coreColors = new Float32Array(maxPoints * 3);

    // Create core geometry
    this.coreGeometry = new THREE.BufferGeometry();
    this.coreGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions.slice(), 3)
    );
    this.coreGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.coreColors.slice(), 3)
    );

    // Core material - bright, thin line
    this.coreMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });

    this.coreLine = new THREE.Line(this.coreGeometry, this.coreMaterial);
    this.root.add(this.coreLine);

    // Create glow layers (progressively wider and more transparent)
    for (let i = 0; i < GlowTrail.GLOW_LAYERS; i++) {
      const glowGeom = new THREE.BufferGeometry();
      glowGeom.setAttribute(
        'position',
        new THREE.BufferAttribute(this.positions.slice(), 3)
      );
      glowGeom.setAttribute(
        'color',
        new THREE.BufferAttribute(this.coreColors.slice(), 3)
      );

      // Each layer is more transparent and uses additive blending
      const layerOpacity = 0.3 - i * 0.08;
      const glowMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: layerOpacity,
        blending: THREE.NormalBlending,
        depthWrite: false,
      });

      const glowLine = new THREE.Line(glowGeom, glowMat);
      // Glow layers share the same world-space positions as the core line.
      // Do NOT scale from world origin — on curved surfaces (torus, etc.) scaling from origin
      // shifts glow layers away from the player proportionally to their world-space distance
      // from the origin, making trails appear at "extremities" of the surface.
      // The glow effect is achieved through layered opacity/brightness alone.

      this.glowGeometries.push(glowGeom);
      this.glowMaterials.push(glowMat);
      this.glowLines.push(glowLine);
      this.root.add(glowLine);
    }

    // Pre-allocate dimmed color buffers (one per glow layer)
    for (let i = 0; i < GlowTrail.GLOW_LAYERS; i++) {
      this.dimmedColorBuffers.push(new Float32Array(maxPoints * 3));
    }
  }

  // Pool of recycled TrailPoint objects to avoid per-frame Vector3 allocations.
  // With 120+ fast enemies, the old code allocated 240+ Vector3s per frame.
  private _pointPool: TrailPoint[] = [];

  /**
   * Add a new point to the trail.
   * NOTE: The position is copied, not stored by reference.
   */
  addPoint(position: THREE.Vector3): void {
    // Calculate speed for dynamic intensity
    if (this.lastPosition) {
      this.currentSpeed = position.distanceTo(this.lastPosition);
    }
    if (!this.lastPosition) {
      this.lastPosition = position.clone();
    } else {
      this.lastPosition.copy(position);
    }

    // Reuse pooled point or create new one
    let point = this._pointPool.pop();
    if (point) {
      point.position.copy(position);
      point.age = 0;
    } else {
      point = { position: position.clone(), age: 0 };
    }

    // Add new point at the front
    this.points.unshift(point);

    // Recycle oldest point if over limit
    if (this.points.length > this.maxPoints) {
      const removed = this.points.pop()!;
      this._pointPool.push(removed);
    }

    this.updateGeometry();
  }

  /**
   * Update the trail (age points, remove old ones).
   */
  update(dt: number): void {
    let needsUpdate = false;

    // Age all points
    for (let i = this.points.length - 1; i >= 0; i--) {
      this.points[i].age += dt;

      // Remove points that are too old — recycle into pool
      if (this.points[i].age > this.fadeTime) {
        this._pointPool.push(this.points[i]);
        this.points.splice(i, 1);
        needsUpdate = true;
      }
    }

    // Decay speed over time
    this.currentSpeed *= 0.95;

    if (needsUpdate) {
      this.updateGeometry();
    } else if (this.points.length > 0) {
      this.updateColors();
    }
  }

  /**
   * Set the trail color.
   */
  setColor(color: THREE.Color): void {
    this.baseColor = color.clone();
    this.glowColor = color.clone().multiplyScalar(1.5);
    this.updateColors();
  }

  /**
   * Clear all trail points.
   */
  clear(): void {
    this.points = [];
    this.updateGeometry();
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.coreGeometry.dispose();
    this.coreMaterial.dispose();
    this.glowGeometries.forEach((g) => g.dispose());
    this.glowMaterials.forEach((m) => m.dispose());
  }

  private updateGeometry(): void {
    const pointCount = this.points.length;

    // Update positions
    for (let i = 0; i < pointCount; i++) {
      const point = this.points[i];
      const baseIndex = i * 3;
      this.positions[baseIndex] = point.position.x;
      this.positions[baseIndex + 1] = point.position.y;
      this.positions[baseIndex + 2] = point.position.z;
    }

    // Clear unused positions
    for (let i = pointCount; i < this.maxPoints; i++) {
      const baseIndex = i * 3;
      this.positions[baseIndex] = 0;
      this.positions[baseIndex + 1] = 0;
      this.positions[baseIndex + 2] = 0;
    }

    // Update core geometry
    const corePositions = this.coreGeometry.attributes.position as THREE.BufferAttribute;
    corePositions.array.set(this.positions);
    corePositions.needsUpdate = true;
    this.coreGeometry.setDrawRange(0, pointCount);

    // Update glow geometries
    for (const glowGeom of this.glowGeometries) {
      const glowPositions = glowGeom.attributes.position as THREE.BufferAttribute;
      glowPositions.array.set(this.positions);
      glowPositions.needsUpdate = true;
      glowGeom.setDrawRange(0, pointCount);
    }

    this.updateColors();
  }

  private updateColors(): void {
    const pointCount = this.points.length;
    const speedFactor = Math.min(this.currentSpeed / this.speedThreshold, 1);

    for (let i = 0; i < pointCount; i++) {
      const point = this.points[i];
      const ageRatio = point.age / this.fadeTime;
      const alpha = 1.0 - Math.min(ageRatio, 1.0);

      // Fade from head to tail
      const positionRatio = i / Math.max(pointCount - 1, 1);
      const combinedAlpha = alpha * (1.0 - positionRatio * 0.8);

      // Intensity based on speed
      const intensity = 0.5 + speedFactor * 0.5;

      const baseIndex = i * 3;
      // Use glow color for brighter appearance
      this.coreColors[baseIndex] = this.glowColor.r * combinedAlpha * intensity;
      this.coreColors[baseIndex + 1] = this.glowColor.g * combinedAlpha * intensity;
      this.coreColors[baseIndex + 2] = this.glowColor.b * combinedAlpha * intensity;
    }

    // Clear unused colors
    for (let i = pointCount; i < this.maxPoints; i++) {
      const baseIndex = i * 3;
      this.coreColors[baseIndex] = 0;
      this.coreColors[baseIndex + 1] = 0;
      this.coreColors[baseIndex + 2] = 0;
    }

    // Update core colors
    const coreColorAttr = this.coreGeometry.attributes.color as THREE.BufferAttribute;
    coreColorAttr.array.set(this.coreColors);
    coreColorAttr.needsUpdate = true;

    // Update glow layer colors (slightly dimmer) - uses pre-allocated buffers
    for (let layer = 0; layer < this.glowGeometries.length; layer++) {
      const glowColorAttr = this.glowGeometries[layer].attributes.color as THREE.BufferAttribute;
      const dimFactor = 0.7 - layer * 0.15;
      const dimmedColors = this.dimmedColorBuffers[layer];
      for (let i = 0; i < this.coreColors.length; i++) {
        dimmedColors[i] = this.coreColors[i] * dimFactor;
      }
      glowColorAttr.array.set(dimmedColors);
      glowColorAttr.needsUpdate = true;
    }
  }
}
