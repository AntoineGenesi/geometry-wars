import * as THREE from 'three';
import type { BlackHoleState } from '../shared/BlackHoleModel';

const MAX_TRAILS = 12;
const _axisZ = new THREE.Vector3(0, 0, 1);

export class BlackHoleVisual {
  readonly root = new THREE.Group();
  readonly core: THREE.Mesh;
  readonly boundary: THREE.Mesh;
  readonly accretionInner: THREE.Mesh;
  readonly accretionOuter: THREE.Mesh;
  readonly collapseFlash: THREE.Mesh;
  readonly shockwave: THREE.Mesh;
  readonly trails: THREE.LineSegments;

  private readonly trailPositions = new Float32Array(MAX_TRAILS * 2 * 3);
  private readonly center: THREE.Vector3;
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];

  constructor(center: THREE.Vector3, surfaceNormal: THREE.Vector3) {
    this.center = center.clone();
    const ringRotation = new THREE.Quaternion().setFromUnitVectors(_axisZ, surfaceNormal.clone().normalize());

    this.core = this.makeMesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x050008, transparent: true, opacity: 0.98, depthWrite: false }),
    );
    this.core.position.copy(center);

    this.accretionInner = this.makeRing(0.055, 0xcc44ff, 0.9, ringRotation);
    this.accretionOuter = this.makeRing(0.035, 0x44ddff, 0.72, ringRotation);
    this.boundary = this.makeRing(0.018, 0xcc88ff, 0.5, ringRotation);

    this.collapseFlash = this.makeMesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.collapseFlash.position.copy(center);

    this.shockwave = this.makeRing(0.045, 0xffffff, 0, ringRotation);

    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    trailGeometry.setDrawRange(0, 0);
    const trailMaterial = new THREE.LineBasicMaterial({
      color: 0xcc66ff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.ownedGeometries.push(trailGeometry);
    this.ownedMaterials.push(trailMaterial);
    this.trails = new THREE.LineSegments(trailGeometry, trailMaterial);
    this.trails.frustumCulled = false;
    this.root.add(this.trails);

    this.root.name = 'black-hole-visual';
    this.root.renderOrder = 30;
  }

  update(state: BlackHoleState, elapsed: number, affectedPositions: readonly THREE.Vector3[]): void {
    const formationScale = state.phase === 'formation' ? 0.35 + state.phaseProgress * 0.65 : 1;
    const contraction = state.phase === 'collapse' ? 1 - state.phaseProgress * 0.45 : 1;
    const pulse = 1 + Math.sin(elapsed * 11) * 0.08;
    this.core.scale.setScalar(Math.max(0.08, 0.72 * formationScale * contraction * pulse));

    this.accretionInner.scale.setScalar(Math.max(0.1, state.radius * 0.42));
    this.accretionOuter.scale.setScalar(Math.max(0.1, state.radius * 0.68));
    this.boundary.scale.setScalar(Math.max(0.1, state.radius));
    this.accretionInner.rotation.z = elapsed * 2.8;
    this.accretionOuter.rotation.z = -elapsed * 1.9;
    this.boundary.rotation.z = elapsed * 0.35;

    const collapseProgress = state.phase === 'collapse' ? state.phaseProgress : 0;
    const flashMaterial = this.collapseFlash.material as THREE.MeshBasicMaterial;
    flashMaterial.opacity = collapseProgress > 0 ? Math.sin(collapseProgress * Math.PI) * 0.7 : 0;
    this.collapseFlash.scale.setScalar(0.7 + collapseProgress * 1.8);
    const shockwaveMaterial = this.shockwave.material as THREE.MeshBasicMaterial;
    shockwaveMaterial.opacity = collapseProgress > 0 ? (1 - collapseProgress) * 0.8 : 0;
    this.shockwave.scale.setScalar(Math.max(0.1, state.radius * (0.4 + collapseProgress * 1.8)));

    const trailCount = Math.min(MAX_TRAILS, affectedPositions.length);
    for (let i = 0; i < trailCount; i++) {
      const source = affectedPositions[i];
      const offset = i * 6;
      this.trailPositions[offset] = source.x;
      this.trailPositions[offset + 1] = source.y;
      this.trailPositions[offset + 2] = source.z;
      this.trailPositions[offset + 3] = source.x + (this.center.x - source.x) * 0.72;
      this.trailPositions[offset + 4] = source.y + (this.center.y - source.y) * 0.72;
      this.trailPositions[offset + 5] = source.z + (this.center.z - source.z) * 0.72;
    }
    const positionAttribute = this.trails.geometry.getAttribute('position') as THREE.BufferAttribute;
    positionAttribute.needsUpdate = true;
    this.trails.geometry.setDrawRange(0, trailCount * 2);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const geometry of this.ownedGeometries) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    this.root.clear();
  }

  private makeRing(
    thickness: number,
    color: number,
    opacity: number,
    rotation: THREE.Quaternion,
  ): THREE.Mesh {
    const mesh = this.makeMesh(
      new THREE.TorusGeometry(1, thickness, 8, 64),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
    );
    mesh.position.copy(this.center);
    mesh.quaternion.copy(rotation);
    return mesh;
  }

  private makeMesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    this.ownedGeometries.push(geometry);
    this.ownedMaterials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 31;
    this.root.add(mesh);
    return mesh;
  }
}
