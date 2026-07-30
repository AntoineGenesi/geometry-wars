import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildChevron3D, buildTriangle3D } from '../../utils/GeometryBuilder';
import { useBasicEnemyMaterials } from './EnemyMaterialUtils';

const _uvDir = { u: 1, v: 0 };
const _worldDir = new THREE.Vector3();

export class PrismLancer extends BaseEnemy {
  private phase: 'strafe' | 'charge' | 'recover' = 'strafe';
  private phaseTimer = 0;
  private strafeSign = Math.random() < 0.5 ? -1 : 1;
  private chargeDirU = 1;
  private chargeDirV = 0;
  private spin = 0;

  constructor(surfaceU: number, surfaceV: number) {
    super(surfaceU, surfaceV, 3, 90, 3, 0.065, 0.28);
    this.baseTypeName = 'prism_lancer';
    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();
    const outer = buildChevron3D(0.48, 0.22, 0x00e5ff, 0.2, 0.026);
    const inner = buildChevron3D(0.32, 0.15, 0x7cfffb, 0.14, 0.018);
    const core = buildTriangle3D(0.14, 0xffffff, 0.16, 0.014);

    outer.rotation.x = Math.PI / 2;
    inner.rotation.x = Math.PI / 2;
    inner.position.z = 0.025;
    core.rotation.x = Math.PI / 2;
    core.position.z = 0.065;

    group.add(outer, inner, core);
    useBasicEnemyMaterials(group, 0x00e5ff);
    this.mesh = group;
  }

  private updatePhase(dt: number, playerU: number, playerV: number): void {
    this.phaseTimer += dt;

    if (this.phase === 'strafe') {
      const du = playerU - this.surfacePosition.u;
      const dv = playerV - this.surfacePosition.v;
      const dist = Math.sqrt(du * du + dv * dv);
      if (dist > 0.001) {
        this.chargeDirU = du / dist;
        this.chargeDirV = dv / dist;
      }
      if (this.phaseTimer >= 0.85) {
        this.phase = 'charge';
        this.phaseTimer = 0;
      }
    } else if (this.phase === 'charge' && this.phaseTimer >= 0.8) {
      this.phase = 'recover';
      this.phaseTimer = 0;
    } else if (this.phase === 'recover' && this.phaseTimer >= 0.55) {
      this.phase = 'strafe';
      this.phaseTimer = 0;
      this.strafeSign *= -1;
    }
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    this.updatePhase(dt, playerU, playerV);

    if (this.phase === 'strafe') {
      _uvDir.u = -this.chargeDirV * this.strafeSign;
      _uvDir.v = this.chargeDirU * this.strafeSign;
      this.surfacePosition.u += _uvDir.u * 0.045 * dt;
      this.surfacePosition.v += _uvDir.v * 0.045 * dt;
    } else if (this.phase === 'charge') {
      this.surfacePosition.u += this.chargeDirU * 0.16 * dt;
      this.surfacePosition.v += this.chargeDirV * 0.16 * dt;
    } else {
      this.surfacePosition.u += this.chargeDirU * 0.02 * dt;
      this.surfacePosition.v += this.chargeDirV * 0.02 * dt;
    }

    this.surfacePosition.u = ((this.surfacePosition.u % 1) + 1) % 1;
    this.surfacePosition.v = Math.max(0.001, Math.min(0.999, this.surfacePosition.v));

    this.spin += (this.phase === 'charge' ? 8 : 3) * dt;
    if (this.mesh) {
      this.mesh.rotation.z = Math.atan2(this.chargeDirV, this.chargeDirU) - Math.PI / 2;
      this.mesh.rotation.y = Math.sin(this.spin) * 0.25;
      this.mesh.scale.setScalar(this.phase === 'charge' ? 1.12 : 1);
    }
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    const toPlayer = playerWorldPos.clone().sub(this.walker.position);
    const dist = toPlayer.length();
    const frame = this.walker.getTangentFrame();
    if (dist > 0.001 && this.phase === 'strafe') {
      toPlayer.normalize();
      this.chargeDirU = toPlayer.dot(frame.tangent);
      this.chargeDirV = toPlayer.dot(frame.bitangent);
      const uvLen = Math.sqrt(this.chargeDirU * this.chargeDirU + this.chargeDirV * this.chargeDirV) || 1;
      this.chargeDirU /= uvLen;
      this.chargeDirV /= uvLen;
    }

    this.updatePhase(dt, this.playerU, this.playerV);

    _worldDir.set(0, 0, 0);
    if (this.phase === 'strafe') {
      _worldDir
        .addScaledVector(frame.tangent, -this.chargeDirV * this.strafeSign)
        .addScaledVector(frame.bitangent, this.chargeDirU * this.strafeSign)
        .normalize()
        .multiplyScalar(0.045 * this.walkerSpeedScale);
    } else if (this.phase === 'charge') {
      _worldDir
        .addScaledVector(frame.tangent, this.chargeDirU)
        .addScaledVector(frame.bitangent, this.chargeDirV)
        .normalize()
        .multiplyScalar(0.16 * this.walkerSpeedScale);
    } else {
      _worldDir
        .addScaledVector(frame.tangent, this.chargeDirU)
        .addScaledVector(frame.bitangent, this.chargeDirV)
        .normalize()
        .multiplyScalar(0.02 * this.walkerSpeedScale);
    }

    this.spin += (this.phase === 'charge' ? 8 : 3) * dt;
    if (this.mesh) {
      this.mesh.rotation.z = Math.atan2(this.chargeDirV, this.chargeDirU) - Math.PI / 2;
      this.mesh.rotation.y = Math.sin(this.spin) * 0.25;
      this.mesh.scale.setScalar(this.phase === 'charge' ? 1.12 : 1);
    }
    return _worldDir;
  }
}
