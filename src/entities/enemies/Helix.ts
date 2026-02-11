import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildPrismFrame } from '../../utils/GeometryBuilder';

// Pre-allocated temp vectors for zero GC in update loop
const _helixDir = new THREE.Vector3();

/** Number of segments per spiral arm */
const SEGMENTS_PER_ARM = 8;
/** Total arms (double helix) */
const ARM_COUNT = 2;

/**
 * Helix Enemy
 *
 * Two intertwined spiral arms made of small tube-frame segments, like a DNA
 * double helix. Rotates continuously and corkscrews through space toward the
 * player. Fast but fragile (low health). The rotation speed increases as it
 * gets closer to the player.
 *
 * Color: cyan-electric blue (0x00ccff)
 */
export class Helix extends BaseEnemy {
  /** References to individual helix segment groups for animation */
  private armSegments: THREE.Group[][] = [[], []];
  /** Base Y positions for each segment along the helix axis */
  private segmentBaseY: number[] = [];
  /** Helix rotation timer (continuous spin) */
  private helixAngle: number = 0;
  /** Forward movement phase for corkscrew wobble */
  private corkscrewPhase: number = 0;
  /** Facing angle toward player */
  private facingAngle: number = 0;

  constructor(surfaceU: number, surfaceV: number) {
    // Low health (2), high score (40), few geoms (2), fast, smaller radius
    super(surfaceU, surfaceV, 2, 40, 2, 0.07, 0.3);
    this.baseTypeName = 'helix';

    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();
    const color = 0x00ccff; // cyan-electric blue
    const segmentHeight = 0.06;
    const helixRadius = 0.08;
    const helixPitch = 0.05; // vertical spacing between segments
    const tubeRadius = 0.014;

    for (let arm = 0; arm < ARM_COUNT; arm++) {
      const armPhaseOffset = arm * Math.PI; // 180 degrees apart

      for (let i = 0; i < SEGMENTS_PER_ARM; i++) {
        const t = i / SEGMENTS_PER_ARM;
        const angle = t * Math.PI * 2 + armPhaseOffset;
        const y = (i - SEGMENTS_PER_ARM / 2) * helixPitch;
        const x = Math.cos(angle) * helixRadius;
        const z = Math.sin(angle) * helixRadius;

        // Small diamond-like segment at each helix point
        const halfH = segmentHeight * 0.5;
        const halfW = 0.025;
        const edges: Array<[THREE.Vector3, THREE.Vector3]> = [
          [new THREE.Vector3(-halfW, -halfH, 0), new THREE.Vector3(0, halfH, 0)],
          [new THREE.Vector3(0, halfH, 0), new THREE.Vector3(halfW, -halfH, 0)],
          [new THREE.Vector3(halfW, -halfH, 0), new THREE.Vector3(-halfW, -halfH, 0)],
          // Small depth struts
          [new THREE.Vector3(-halfW, -halfH, 0), new THREE.Vector3(0, 0, halfW)],
          [new THREE.Vector3(halfW, -halfH, 0), new THREE.Vector3(0, 0, halfW)],
          [new THREE.Vector3(0, halfH, 0), new THREE.Vector3(0, 0, halfW)],
        ];

        const segmentGroup = buildPrismFrame(edges, color, tubeRadius);
        segmentGroup.position.set(x, y, z);

        // Tilt segment to follow helix curve
        segmentGroup.rotation.y = angle;

        this.armSegments[arm].push(segmentGroup);
        group.add(segmentGroup);

        if (arm === 0) {
          this.segmentBaseY.push(y);
        }
      }
    }

    // Add connecting rungs between the two arms (like DNA base pairs)
    for (let i = 0; i < SEGMENTS_PER_ARM; i += 2) {
      const seg0 = this.armSegments[0][i];
      const seg1 = this.armSegments[1][i];
      if (seg0 && seg1) {
        const rungEdges: Array<[THREE.Vector3, THREE.Vector3]> = [
          [seg0.position.clone(), seg1.position.clone()],
        ];
        const rung = buildPrismFrame(rungEdges, 0x0088aa, tubeRadius * 0.7, false);
        group.add(rung);
      }
    }

    this.mesh = group;
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Chase the player
    const deltaU = playerU - this.surfacePosition.u;
    const deltaV = playerV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.001) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;

      // Corkscrew perpendicular wobble (oscillates left/right of chase direction)
      this.corkscrewPhase += 4.0 * dt;
      const perpU = -dirV;
      const perpV = dirU;
      const wobbleStrength = 0.3;
      const wobble = Math.sin(this.corkscrewPhase) * wobbleStrength;

      this.surfacePosition.u += (dirU + perpU * wobble) * this.speed * dt;
      this.surfacePosition.v += (dirV + perpV * wobble) * this.speed * dt;

      // Clamp to surface
      this.surfacePosition.u = Math.max(0, Math.min(1, this.surfacePosition.u));
      this.surfacePosition.v = Math.max(0, Math.min(1, this.surfacePosition.v));

      // Face toward player
      this.facingAngle = Math.atan2(deltaV, deltaU);
    }

    // Continuous helix rotation (faster when close to player)
    const rotSpeed = 3.0 + Math.max(0, 1.0 - distance) * 3.0;
    this.helixAngle += rotSpeed * dt;

    // Animate spiral segments: rotate around the central axis
    if (this.mesh) {
      // Orient the entire helix toward the player
      this.mesh.rotation.z = this.facingAngle;

      // Spin the helix around its long axis
      for (let arm = 0; arm < ARM_COUNT; arm++) {
        const armPhaseOffset = arm * Math.PI;
        for (let i = 0; i < this.armSegments[arm].length; i++) {
          const seg = this.armSegments[arm][i];
          const t = i / SEGMENTS_PER_ARM;
          const angle = t * Math.PI * 2 + armPhaseOffset + this.helixAngle;
          const helixRadius = 0.08;

          seg.position.x = Math.cos(angle) * helixRadius;
          seg.position.z = Math.sin(angle) * helixRadius;
          seg.rotation.y = angle;

          // Subtle scale pulse along the helix
          const pulse = 1.0 + Math.sin(this.helixAngle * 2 + i * 0.5) * 0.15;
          seg.scale.setScalar(pulse);
        }
      }
    }
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    // Chase the player
    const delta = playerWorldPos.clone().sub(this.walker.position);
    const distance = delta.length();

    if (distance < 0.001) return null;

    delta.normalize();

    // Corkscrew perpendicular wobble (oscillates left/right of chase direction)
    this.corkscrewPhase += 4.0 * dt;

    // Get tangent frame to define perpendicular direction in the surface
    const frame = this.walker.getTangentFrame();

    // Calculate perpendicular direction in the tangent plane
    // Cross product of delta and normal gives perpendicular direction
    const perpWorld = new THREE.Vector3().crossVectors(delta, frame.normal).normalize();

    const wobbleStrength = 0.3;
    const wobble = Math.sin(this.corkscrewPhase) * wobbleStrength;

    // Combine chase direction with perpendicular wobble
    const dir = delta.clone().addScaledVector(perpWorld, wobble);
    dir.normalize();

    // Face toward player
    this.facingAngle = Math.atan2(delta.y, delta.x);

    // Continuous helix rotation (faster when close to player)
    const rotSpeed = 3.0 + Math.max(0, 1.0 - distance) * 3.0;
    this.helixAngle += rotSpeed * dt;

    // Animate spiral segments: rotate around the central axis
    if (this.mesh) {
      // Orient the entire helix toward the player
      this.mesh.rotation.z = this.facingAngle;

      // Spin the helix around its long axis
      for (let arm = 0; arm < ARM_COUNT; arm++) {
        const armPhaseOffset = arm * Math.PI;
        for (let i = 0; i < this.armSegments[arm].length; i++) {
          const seg = this.armSegments[arm][i];
          const t = i / SEGMENTS_PER_ARM;
          const angle = t * Math.PI * 2 + armPhaseOffset + this.helixAngle;
          const helixRadius = 0.08;

          seg.position.x = Math.cos(angle) * helixRadius;
          seg.position.z = Math.sin(angle) * helixRadius;
          seg.rotation.y = angle;

          // Subtle scale pulse along the helix
          const pulse = 1.0 + Math.sin(this.helixAngle * 2 + i * 0.5) * 0.15;
          seg.scale.setScalar(pulse);
        }
      }
    }

    return dir.multiplyScalar(this.speed * this.walkerSpeedScale);
  }
}
