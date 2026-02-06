import * as THREE from 'three';

interface TrailPoint {
  position: THREE.Vector3;
  age: number;
}

export class TrailEffect {
  readonly root: THREE.Group;

  private line: THREE.Line;
  private geometry: THREE.BufferGeometry;
  private material: THREE.LineBasicMaterial;

  private points: TrailPoint[];
  private maxPoints: number;
  private positions: Float32Array;
  private colors: Float32Array;

  private baseColor: THREE.Color;
  private fadeTime: number;

  constructor(color: THREE.Color, maxPoints: number = 50) {
    this.root = new THREE.Group();
    this.maxPoints = maxPoints;
    this.points = [];
    this.baseColor = color.clone();
    this.fadeTime = 0.5; // Seconds to fade out

    // Create buffers
    this.positions = new Float32Array(maxPoints * 3);
    this.colors = new Float32Array(maxPoints * 3);

    // Create geometry
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    // Create material with vertex colors
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });

    // Create line
    this.line = new THREE.Line(this.geometry, this.material);
    this.root.add(this.line);
  }

  addPoint(position: THREE.Vector3): void {
    // Add new point at the front
    this.points.unshift({
      position: position.clone(),
      age: 0,
    });

    // Remove oldest point if over limit
    if (this.points.length > this.maxPoints) {
      this.points.pop();
    }

    this.updateGeometry();
  }

  update(dt: number): void {
    let needsUpdate = false;

    // Age all points
    for (let i = this.points.length - 1; i >= 0; i--) {
      this.points[i].age += dt;

      // Remove points that are too old
      if (this.points[i].age > this.fadeTime) {
        this.points.splice(i, 1);
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      this.updateGeometry();
    } else if (this.points.length > 0) {
      // Update colors for fading
      this.updateColors();
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
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

    // Update draw range
    this.geometry.setDrawRange(0, pointCount);
    this.geometry.attributes.position.needsUpdate = true;

    this.updateColors();
  }

  private updateColors(): void {
    const pointCount = this.points.length;

    for (let i = 0; i < pointCount; i++) {
      const point = this.points[i];
      const ageRatio = point.age / this.fadeTime;
      const alpha = 1.0 - Math.min(ageRatio, 1.0);

      // Fade from head to tail
      const positionRatio = i / Math.max(pointCount - 1, 1);
      const combinedAlpha = alpha * (1.0 - positionRatio * 0.7);

      const baseIndex = i * 3;
      this.colors[baseIndex] = this.baseColor.r * combinedAlpha;
      this.colors[baseIndex + 1] = this.baseColor.g * combinedAlpha;
      this.colors[baseIndex + 2] = this.baseColor.b * combinedAlpha;
    }

    // Clear unused colors
    for (let i = pointCount; i < this.maxPoints; i++) {
      const baseIndex = i * 3;
      this.colors[baseIndex] = 0;
      this.colors[baseIndex + 1] = 0;
      this.colors[baseIndex + 2] = 0;
    }

    this.geometry.attributes.color.needsUpdate = true;
  }
}
