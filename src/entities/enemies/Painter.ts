import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildSquare3D } from '../../utils/GeometryBuilder';

/**
 * Painter enemy - leaves a trail of hazard zones on the surface.
 * Wanders randomly, painting the surface behind it.
 * Player must avoid painted zones or take damage.
 * In GW3D, painters change the grid color where they walk.
 */
export class Painter extends BaseEnemy {
  private angle: number;
  private turnTimer = 0;
  private readonly turnInterval = 2.0; // seconds between direction changes
  /** UV positions this painter has visited (for hazard zones) */
  public readonly trail: Array<{ u: number; v: number; age: number }> = [];
  private readonly maxTrailLength = 40;
  private readonly trailSpacing = 0.02;
  private lastTrailU: number;
  private lastTrailV: number;

  /** Visual trail markers on the surface */
  public readonly trailRoot = new THREE.Group();
  private trailMeshes: THREE.Mesh[] = [];
  private static trailGeometry: THREE.BufferGeometry | null = null;
  private static trailMaterial: THREE.MeshStandardMaterial | null = null;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    // health=3, score=75, geoms=1, speed=0.035, radius=0.3
    super(surfaceU, surfaceV, 3, 75, 1, 0.035, 0.3);
    this.angle = Math.random() * Math.PI * 2;
    this.lastTrailU = surfaceU;
    this.lastTrailV = surfaceV;
    this.createMesh();
    // Register trailRoot so generic cleanup code (network-main.ts) removes it from scene.
    this.auxiliaryObjects.push(this.trailRoot);

    // Shared geometry/material for trail markers (small flat diamond)
    if (!Painter.trailGeometry) {
      Painter.trailGeometry = new THREE.OctahedronGeometry(0.08, 0);
      Painter.trailGeometry.scale(1, 0.3, 1); // flatten
    }
    if (!Painter.trailMaterial) {
      Painter.trailMaterial = new THREE.MeshStandardMaterial({
        color: 0xff44aa,
        emissive: 0xff44aa,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.7,
      });
    }
  }

  private createMesh(): void {
    // Flat square shape in magenta-pink
    this.mesh = buildSquare3D(0.28, 0xff44aa, 0.19, 0.02);
  }

  updateBehavior(dt: number, _playerU: number, _playerV: number): void {
    // Random wandering with periodic direction changes
    this.turnTimer += dt;
    if (this.turnTimer >= this.turnInterval) {
      this.turnTimer = 0;
      this.angle += (Math.random() - 0.5) * Math.PI; // turn up to 90 degrees
    }

    // Gentle drift with smooth turning
    const du = Math.cos(this.angle) * this.speed * dt;
    const dv = Math.sin(this.angle) * this.speed * dt;

    const newU = this.surfacePosition.u + du;
    const newV = this.surfacePosition.v + dv;

    // Bounce off edges
    if (newU < 0.02 || newU > 0.98) this.angle = Math.PI - this.angle;
    if (newV < 0.02 || newV > 0.98) this.angle = -this.angle;

    this.surfacePosition = {
      u: Math.max(0.01, Math.min(0.99, newU)),
      v: Math.max(0.01, Math.min(0.99, newV)),
    };

    // Leave trail
    const distFromLast = Math.sqrt(
      (this.surfacePosition.u - this.lastTrailU) ** 2 +
      (this.surfacePosition.v - this.lastTrailV) ** 2
    );
    if (distFromLast >= this.trailSpacing) {
      this.trail.push({ u: this.surfacePosition.u, v: this.surfacePosition.v, age: 0 });
      this.lastTrailU = this.surfacePosition.u;
      this.lastTrailV = this.surfacePosition.v;

      // Add visual trail marker
      const marker = new THREE.Mesh(Painter.trailGeometry!, Painter.trailMaterial!);
      this.trailRoot.add(marker);
      this.trailMeshes.push(marker);

      // Trim old trail points + remove oldest visual marker
      if (this.trail.length > this.maxTrailLength) {
        this.trail.shift();
        const oldMarker = this.trailMeshes.shift();
        if (oldMarker) {
          this.trailRoot.remove(oldMarker);
        }
      }
    }

    // Age trail points
    for (const point of this.trail) {
      point.age += dt;
    }

    // Rotate mesh
    if (this.mesh) {
      this.mesh.rotation.y += 1.5 * dt;
    }
  }

  applySurfaceTransform(getTransform: (u: number, v: number) => {
    position: THREE.Vector3;
    normal: THREE.Vector3;
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3
  }): void {
    super.applySurfaceTransform(getTransform);

    // Position trail markers on surface
    for (let i = 0; i < this.trail.length && i < this.trailMeshes.length; i++) {
      const point = this.trail[i];
      const marker = this.trailMeshes[i];
      const t = getTransform(point.u, point.v);
      marker.position.copy(t.position).addScaledVector(t.normal, 0.03);
      marker.lookAt(marker.position.clone().add(t.normal));
      // Fade older markers
      const fadeFactor = Math.max(0.3, 1 - point.age * 0.05);
      marker.scale.setScalar(fadeFactor);
    }
  }

  /** Check if a UV position is on the painted trail */
  isOnTrail(u: number, v: number, threshold = 0.025): boolean {
    for (const point of this.trail) {
      const du = u - point.u;
      const dv = v - point.v;
      if (du * du + dv * dv < threshold * threshold) return true;
    }
    return false;
  }

  computeMovementDirection(dt: number, _playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    // Random wandering with periodic direction changes
    this.turnTimer += dt;
    if (this.turnTimer >= this.turnInterval) {
      this.turnTimer = 0;
      this.angle += (Math.random() - 0.5) * Math.PI; // turn up to 90 degrees
    }

    // Rotate mesh
    if (this.mesh) {
      this.mesh.rotation.y += 1.5 * dt;
    }

    // Age trail points
    for (const point of this.trail) {
      point.age += dt;
    }

    // Get tangent frame for surface-aligned movement
    const frame = this.walker.getTangentFrame();

    // Convert angle to surface-aligned direction
    const tangentDir = frame.tangent.clone().multiplyScalar(Math.cos(this.angle));
    const bitangentDir = frame.bitangent.clone().multiplyScalar(Math.sin(this.angle));

    const moveDir = tangentDir.add(bitangentDir).normalize();

    // Leave trail (use walker position)
    const currentPos = this.walker.position;
    const distFromLast = Math.sqrt(
      (currentPos.x - this.lastTrailU) ** 2 +
      (currentPos.z - this.lastTrailV) ** 2
    );

    if (distFromLast >= this.trailSpacing) {
      // Store world position as trail point (we'll convert to UV later if needed)
      if (this.surfaceRef) {
        const currentUV = this.surfaceRef.worldToSurface(this.walker.position);
        this.trail.push({ u: currentUV.u, v: currentUV.v, age: 0 });
        this.lastTrailU = currentPos.x;
        this.lastTrailV = currentPos.z;

        // Add visual trail marker
        const marker = new THREE.Mesh(Painter.trailGeometry!, Painter.trailMaterial!);
        this.trailRoot.add(marker);
        this.trailMeshes.push(marker);

        // Trim old trail points + remove oldest visual marker
        if (this.trail.length > this.maxTrailLength) {
          this.trail.shift();
          const oldMarker = this.trailMeshes.shift();
          if (oldMarker) {
            this.trailRoot.remove(oldMarker);
          }
        }
      }
    }

    // TODO: Boundary checking would require knowing surface edges in world space
    // For now, let the walker handle surface constraints

    return moveDir.multiplyScalar(this.speed * this.walkerSpeedScale);
  }
}
