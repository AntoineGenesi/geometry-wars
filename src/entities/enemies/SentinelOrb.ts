import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildCircle3D, buildDiamond3D, buildSquare3D } from '../../utils/GeometryBuilder';
import { useBasicEnemyMaterials } from './EnemyMaterialUtils';

export class SentinelOrb extends BaseEnemy {
  private orbitAngle = Math.random() * Math.PI * 2;
  private orbitDirection = Math.random() < 0.5 ? -1 : 1;
  private orbitRadius = 0.24;
  private spin = 0;

  constructor(surfaceU: number, surfaceV: number) {
    super(surfaceU, surfaceV, 4, 110, 4, 0.045, 0.32);
    this.baseTypeName = 'sentinel_orb';
    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();
    const ring = buildCircle3D(0.24, 12, 0xffd34d, 0.18, 0.018);
    const square = buildSquare3D(0.18, 0xfff2a0, 0.26, 0.018);
    const diamond = buildDiamond3D(0.2, 0xff8a2a, 0.22, 0.018);

    square.rotation.x = Math.PI / 2;
    diamond.rotation.y = Math.PI / 2;
    ring.rotation.z = Math.PI / 4;

    group.add(ring, square, diamond);
    useBasicEnemyMaterials(group, 0xffd34d);
    this.mesh = group;
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    this.orbitAngle += this.orbitDirection * 1.35 * dt;
    this.orbitRadius = 0.22 + Math.sin(this.orbitAngle * 0.7) * 0.035;

    const targetU = playerU + Math.cos(this.orbitAngle) * this.orbitRadius;
    const targetV = playerV + Math.sin(this.orbitAngle) * this.orbitRadius;
    const du = targetU - this.surfacePosition.u;
    const dv = targetV - this.surfacePosition.v;
    const dist = Math.sqrt(du * du + dv * dv);

    if (dist > 0.001) {
      const chase = Math.min(1, 4.2 * dt);
      this.surfacePosition.u += du * chase;
      this.surfacePosition.v += dv * chase;
    }

    this.surfacePosition.u = ((this.surfacePosition.u % 1) + 1) % 1;
    this.surfacePosition.v = Math.max(0.001, Math.min(0.999, this.surfacePosition.v));
    this.animate(dt);
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    this.orbitAngle += this.orbitDirection * 1.35 * dt;
    const worldOrbitRadius = 6.5 + Math.sin(this.orbitAngle * 0.7) * 1.0;

    const frame = this.walker.getTangentFrame();
    const target = playerWorldPos.clone()
      .addScaledVector(frame.tangent, Math.cos(this.orbitAngle) * worldOrbitRadius)
      .addScaledVector(frame.bitangent, Math.sin(this.orbitAngle) * worldOrbitRadius);
    const dir = target.sub(this.walker.position);
    const dist = dir.length();
    if (dist < 0.001) return null;

    this.animate(dt);
    return dir.normalize().multiplyScalar(Math.min(dist * 4.2, this.speed * this.walkerSpeedScale));
  }

  private animate(dt: number): void {
    this.spin += dt;
    if (!this.mesh) return;
    this.mesh.rotation.x = this.spin * 1.2;
    this.mesh.rotation.y = -this.spin * 1.7;
    this.mesh.rotation.z = this.spin * 0.8;
  }
}
