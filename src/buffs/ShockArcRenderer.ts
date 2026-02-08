import * as THREE from 'three';
import type { ShockArc } from './BuffManager';

// ---------------------------------------------------------------------------
// ShockArcRenderer - Draws lightning arcs for Shock Aura buff
// ---------------------------------------------------------------------------

const MAX_ARCS = 32;
const ARC_COLOR = new THREE.Color(0x8844ff);
const ARC_SEGMENTS = 6; // jagged segments per arc

export class ShockArcRenderer {
  readonly root: THREE.Group;
  private lines: THREE.Line[] = [];
  private materials: THREE.LineBasicMaterial[] = [];
  private activeCount = 0;

  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'ShockArcs';

    // Pre-allocate line objects
    for (let i = 0; i < MAX_ARCS; i++) {
      const points: THREE.Vector3[] = [];
      for (let s = 0; s <= ARC_SEGMENTS; s++) {
        points.push(new THREE.Vector3());
      }

      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: ARC_COLOR,
        transparent: true,
        opacity: 0.8,
        linewidth: 1,
      });

      const line = new THREE.Line(geom, mat);
      line.visible = false;
      line.frustumCulled = false;
      this.root.add(line);
      this.lines.push(line);
      this.materials.push(mat);
    }
  }

  /**
   * Update the visual arcs based on current shock arc data.
   * Call each frame.
   */
  update(arcs: ShockArc[]): void {
    // Hide all first
    for (let i = 0; i < this.activeCount; i++) {
      this.lines[i].visible = false;
    }

    this.activeCount = Math.min(arcs.length, MAX_ARCS);

    for (let i = 0; i < this.activeCount; i++) {
      const arc = arcs[i];
      const line = this.lines[i];
      const mat = this.materials[i];

      // Fade out based on age
      const t = arc.age / arc.maxAge;
      mat.opacity = 0.8 * (1 - t);

      // Generate jagged lightning path
      const positions = line.geometry.attributes.position as THREE.BufferAttribute;
      const from = arc.from;
      const to = arc.to;
      const jitter = 0.08; // lateral jitter amount

      for (let s = 0; s <= ARC_SEGMENTS; s++) {
        const frac = s / ARC_SEGMENTS;
        const x = from.x + (to.x - from.x) * frac;
        const y = from.y + (to.y - from.y) * frac;
        const z = from.z + (to.z - from.z) * frac;

        // Add random jitter (except at endpoints)
        const j = (s > 0 && s < ARC_SEGMENTS) ? jitter : 0;
        positions.setXYZ(
          s,
          x + (Math.random() - 0.5) * j,
          y + (Math.random() - 0.5) * j,
          z + (Math.random() - 0.5) * j,
        );
      }

      positions.needsUpdate = true;
      line.visible = true;
    }
  }

  dispose(): void {
    for (const line of this.lines) {
      line.geometry.dispose();
    }
    for (const mat of this.materials) {
      mat.dispose();
    }
  }
}
