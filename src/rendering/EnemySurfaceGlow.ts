import * as THREE from 'three';
import type { BaseEnemy } from '../entities/enemies/BaseEnemy';

/**
 * EnemySurfaceGlow - Renders a subtle glow disc under each enemy on the surface
 * to improve visibility of dark enemies against dark surfaces. Uses a single
 * InstancedMesh with additive blending for all glows, giving a soft neon effect
 * without adding draw calls (1 draw call for all enemy glows combined).
 *
 * Each glow is a flat circular disc positioned at the enemy's world position,
 * oriented to face the surface normal, with a radial gradient falloff for softness.
 * Color matches the enemy type, scale is proportional to enemy danger level.
 */

/** Max enemy count (matches EnemySpawner MAX_ENEMY_COUNT) */
const MAX_GLOW_INSTANCES = 500;

/** Pre-allocated module-level temps for zero-GC updates */
const _tmpVec = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpMatrix = new THREE.Matrix4();
const _tmpScale = new THREE.Vector3();
const _zeroScale = new THREE.Vector3(0, 0, 0);
const _upVector = new THREE.Vector3(0, 1, 0);

/**
 * Map from enemy instance index to glow instance index.
 * Reused to avoid GC on Map creation.
 */
const _enemyToGlowIndex = new Map<BaseEnemy, number>();

export class EnemySurfaceGlow {
  private scene: THREE.Scene;
  private instancedMesh: THREE.InstancedMesh;
  private material: THREE.MeshBasicMaterial;
  private geometry: THREE.CircleGeometry;

  /** Per-instance opacity attribute for fade effects */
  private opacityAttribute: THREE.InstancedBufferAttribute;

  /** Slot allocation tracking */
  private indexToEnemy: (BaseEnemy | null)[] = new Array(MAX_GLOW_INSTANCES).fill(null);
  private nextFreeIndex: number = 0;

  /** Intensity multiplier (user-adjustable setting, 0-1) */
  private intensity: number = 0.6;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Geometry: flat circle with 16 segments for smooth radial falloff
    this.geometry = new THREE.CircleGeometry(1, 16);

    // Material: additive blending for neon glow effect
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff, // Base white - actual color from instanceColor
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });

    // Inject radial gradient falloff via shader
    // This makes the glow fade smoothly from center to edge (distance 0→1, opacity 1→0)
    this.material.onBeforeCompile = (shader) => {
      // Add per-instance opacity attribute
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        'attribute float instanceOpacity;\nvarying float vInstanceOpacity;\nvarying vec2 vUv;\nvoid main() {\n  vInstanceOpacity = instanceOpacity;\n  vUv = uv;',
      );

      // Radial gradient falloff: distance from center = 0→1, apply smoothstep for soft edge
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        'varying float vInstanceOpacity;\nvarying vec2 vUv;\nvoid main() {',
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
  // Radial distance from center (uv is 0.5,0.5 at center for CircleGeometry)
  float dist = distance(vUv, vec2(0.5, 0.5)) * 2.0; // normalize to 0-1 range
  float radialFalloff = smoothstep(1.0, 0.0, dist); // soft edge
  gl_FragColor.a *= radialFalloff * vInstanceOpacity;`,
      );
    };

    // Create InstancedMesh
    this.instancedMesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      MAX_GLOW_INSTANCES,
    );
    this.instancedMesh.count = 0;
    this.instancedMesh.frustumCulled = false; // Enemies on curved surfaces, bbox culling unreliable
    this.instancedMesh.name = 'enemy-surface-glows';

    // Initialize all instances to zero-scale (hidden)
    for (let i = 0; i < MAX_GLOW_INSTANCES; i++) {
      _tmpMatrix.compose(_tmpVec.set(0, 0, 0), _tmpQuat.identity(), _zeroScale);
      this.instancedMesh.setMatrixAt(i, _tmpMatrix);
      this.instancedMesh.setColorAt(i, new THREE.Color(0xffffff));
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }

    // Per-instance opacity attribute (read by shader)
    const opacityArray = new Float32Array(MAX_GLOW_INSTANCES);
    opacityArray.fill(1.0);
    this.opacityAttribute = new THREE.InstancedBufferAttribute(opacityArray, 1);
    this.instancedMesh.geometry.setAttribute('instanceOpacity', this.opacityAttribute);

    this.scene.add(this.instancedMesh);
  }

  /**
   * Update all glow instances from enemy positions.
   * Call once per frame after enemy positions are updated.
   */
  update(enemies: BaseEnemy[]): void {
    _enemyToGlowIndex.clear();

    // Reset all slots to zero-scale (will be re-shown for active enemies)
    for (let i = 0; i < MAX_GLOW_INSTANCES; i++) {
      _tmpMatrix.compose(_tmpVec.set(0, 0, 0), _tmpQuat.identity(), _zeroScale);
      this.instancedMesh.setMatrixAt(i, _tmpMatrix);
    }

    let activeGlowCount = 0;

    for (const enemy of enemies) {
      if (!enemy.active || !enemy.alive || !enemy.mesh) continue;

      // Skip materializing enemies (spawn warning in progress)
      if (enemy.isMaterializing) continue;

      // Allocate or reuse a glow slot
      const glowIndex = this.allocateSlot(enemy);
      if (glowIndex < 0) continue; // No free slots

      _enemyToGlowIndex.set(enemy, glowIndex);

      // Position: enemy's world position
      enemy.mesh.updateWorldMatrix(false, false);
      _tmpVec.setFromMatrixPosition(enemy.mesh.matrixWorld);

      // Orientation: extract normal from enemy's up direction (enemy.mesh.up points along surface normal)
      // We want the glow disc to lie flat on the surface, so we orient it to face the normal
      const normal = enemy.mesh.up.clone().normalize();
      _tmpMatrix.lookAt(_tmpVec, _tmpVec.clone().add(normal), _upVector);
      _tmpQuat.setFromRotationMatrix(_tmpMatrix);

      // Scale: proportional to enemy size/danger
      // Boss enemies are bigger, so their glow should be bigger too
      const baseScale = enemy.radius * 1.8; // slightly larger than enemy for subtle halo effect
      const dangerMultiplier = enemy.maxHealth > 100 ? 1.5 : 1.0; // bosses/titans get bigger glow
      const scale = baseScale * dangerMultiplier;
      _tmpScale.set(scale, scale, scale);

      // Position slightly above the surface to avoid z-fighting
      _tmpVec.addScaledVector(normal, 0.02);

      _tmpMatrix.compose(_tmpVec, _tmpQuat, _tmpScale);
      this.instancedMesh.setMatrixAt(glowIndex, _tmpMatrix);

      // Color: match enemy type color (from mesh material emissive or color)
      const enemyColor = this.extractEnemyColor(enemy);
      this.instancedMesh.setColorAt(glowIndex, enemyColor);

      // Opacity: apply intensity setting
      this.opacityAttribute.setX(glowIndex, this.intensity);

      activeGlowCount++;
    }

    // Finalize
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
    this.opacityAttribute.needsUpdate = true;
    this.instancedMesh.count = Math.min(MAX_GLOW_INSTANCES, activeGlowCount);
  }

  /**
   * Set glow intensity (0-1). User-adjustable setting.
   */
  setIntensity(intensity: number): void {
    this.intensity = Math.max(0, Math.min(1, intensity));
  }

  /**
   * Get current intensity setting.
   */
  getIntensity(): number {
    return this.intensity;
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    this.scene.remove(this.instancedMesh);
    this.geometry.dispose();
    this.material.dispose();
    this.instancedMesh.dispose();
    _enemyToGlowIndex.clear();
  }

  // ---- Private helpers ----

  /**
   * Allocate a free slot for an enemy.
   */
  private allocateSlot(enemy: BaseEnemy): number {
    // Try to reuse existing slot for this enemy
    const existing = _enemyToGlowIndex.get(enemy);
    if (existing !== undefined && this.indexToEnemy[existing] === enemy) {
      return existing;
    }

    // Find a free slot
    for (let i = this.nextFreeIndex; i < MAX_GLOW_INSTANCES; i++) {
      if (this.indexToEnemy[i] === null || !this.indexToEnemy[i]!.active) {
        this.indexToEnemy[i] = enemy;
        this.nextFreeIndex = i + 1;
        return i;
      }
    }

    // Wrap around
    for (let i = 0; i < this.nextFreeIndex; i++) {
      if (this.indexToEnemy[i] === null || !this.indexToEnemy[i]!.active) {
        this.indexToEnemy[i] = enemy;
        this.nextFreeIndex = i + 1;
        return i;
      }
    }

    return -1; // All slots full
  }

  /**
   * Extract enemy color from its mesh material.
   * Prefers emissive color (bright neon) over base color.
   */
  private extractEnemyColor(enemy: BaseEnemy): THREE.Color {
    if (!enemy.mesh) return new THREE.Color(0xffffff);

    // Try to extract color from the first mesh child
    let color = new THREE.Color(0xffffff);
    enemy.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.emissive && mat.emissive.getHex() !== 0x000000) {
          color = mat.emissive.clone();
          return; // Found emissive color, use it
        } else if (mat.color) {
          color = mat.color.clone();
        }
      }
    });

    return color;
  }
}
