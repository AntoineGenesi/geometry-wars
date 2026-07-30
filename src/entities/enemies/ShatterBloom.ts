import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildDiamond3D, buildTriangle3D } from '../../utils/GeometryBuilder';
import { useBasicEnemyMaterials } from './EnemyMaterialUtils';

export type ShatterBloomDeathCallback = (u: number, v: number, count: number) => void;

const _bloomDir = new THREE.Vector3();

export class ShatterBloom extends BaseEnemy {
  static onBloomDeath: ShatterBloomDeathCallback | null = null;

  private pulse = 0;
  private shardRoots: THREE.Group[] = [];

  constructor(surfaceU: number, surfaceV: number) {
    super(surfaceU, surfaceV, 9, 160, 6, 0.022, 0.42);
    this.baseTypeName = 'shatter_bloom';
    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();
    const core = buildDiamond3D(0.16, 0xff5df7, 0.18, 0.02);
    useBasicEnemyMaterials(core, 0xff5df7);
    group.add(core);

    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const shard = buildTriangle3D(0.15, 0xff77cc, 0.12, 0.018);
      useBasicEnemyMaterials(shard, i % 2 === 0 ? 0xff77cc : 0x9d7cff);
      shard.position.set(Math.cos(angle) * 0.2, Math.sin(angle) * 0.2, 0.03);
      shard.rotation.z = angle - Math.PI / 2;
      shard.rotation.x = Math.PI / 2;
      this.shardRoots.push(shard);
      group.add(shard);
    }

    this.mesh = group;
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    const du = playerU - this.surfacePosition.u;
    const dv = playerV - this.surfacePosition.v;
    const dist = Math.sqrt(du * du + dv * dv);
    if (dist > 0.001) {
      this.surfacePosition.u += (du / dist) * this.speed * dt;
      this.surfacePosition.v += (dv / dist) * this.speed * dt;
    }
    this.surfacePosition.u = ((this.surfacePosition.u % 1) + 1) % 1;
    this.surfacePosition.v = Math.max(0.001, Math.min(0.999, this.surfacePosition.v));
    this.animate(dt);
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;
    _bloomDir.copy(playerWorldPos).sub(this.walker.position);
    const dist = _bloomDir.length();
    if (dist < 0.001) return null;
    this.animate(dt);
    return _bloomDir.normalize().multiplyScalar(this.speed * this.walkerSpeedScale);
  }

  die(): void {
    if (!this.alive) return;
    ShatterBloom.onBloomDeath?.(this.surfacePosition.u, this.surfacePosition.v, 3);
    super.die();
  }

  private animate(dt: number): void {
    this.pulse += dt;
    const bloom = 1 + Math.sin(this.pulse * 2.4) * 0.12;
    if (this.mesh) {
      this.mesh.rotation.z += 0.35 * dt;
      this.mesh.scale.setScalar(bloom);
    }
    for (let i = 0; i < this.shardRoots.length; i++) {
      const shard = this.shardRoots[i];
      const outward = 1 + Math.sin(this.pulse * 3 + i) * 0.18;
      shard.scale.setScalar(outward);
    }
  }
}

