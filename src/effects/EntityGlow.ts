import * as THREE from 'three';

/**
 * Adds a subtle glow halo around entities.
 * Uses sprite-based rendering with additive blending for a soft glow effect.
 */

// Create a soft circular gradient texture for the glow
function createGlowTexture(size: number = 64): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Create radial gradient from center
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );

  // Soft falloff from center to edge
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
  gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.4)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Shared glow texture (created lazily)
let sharedGlowTexture: THREE.Texture | null = null;

function getGlowTexture(): THREE.Texture {
  if (!sharedGlowTexture) {
    sharedGlowTexture = createGlowTexture(64);
  }
  return sharedGlowTexture;
}

/**
 * A glow halo that can be attached to any object.
 */
export class EntityGlow {
  readonly sprite: THREE.Sprite;
  private readonly material: THREE.SpriteMaterial;
  private baseColor: THREE.Color;
  private baseOpacity: number;
  private pulsePhase: number = 0;
  private pulseSpeed: number;
  private pulseAmount: number;

  constructor(
    color: THREE.Color | number = 0x00ffff,
    size: number = 0.5,
    opacity: number = 0.3,
    pulseSpeed: number = 2,
    pulseAmount: number = 0.15
  ) {
    this.baseColor = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
    this.baseOpacity = opacity;
    this.pulseSpeed = pulseSpeed;
    this.pulseAmount = pulseAmount;

    this.material = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: this.baseColor,
      transparent: true,
      opacity: opacity,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });

    this.sprite = new THREE.Sprite(this.material);
    this.sprite.scale.setScalar(size);
  }

  /**
   * Update the glow (pulsing effect).
   */
  update(dt: number): void {
    this.pulsePhase += dt * this.pulseSpeed * Math.PI * 2;

    // Subtle pulse
    const pulse = Math.sin(this.pulsePhase) * this.pulseAmount;
    this.material.opacity = this.baseOpacity + pulse;
  }

  /**
   * Set the glow color.
   */
  setColor(color: THREE.Color | number): void {
    this.baseColor = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
    this.material.color = this.baseColor;
  }

  /**
   * Set the glow size.
   */
  setSize(size: number): void {
    this.sprite.scale.setScalar(size);
  }

  /**
   * Set base opacity.
   */
  setOpacity(opacity: number): void {
    this.baseOpacity = opacity;
    this.material.opacity = opacity;
  }

  /**
   * Attach to a parent object.
   */
  attachTo(parent: THREE.Object3D): void {
    parent.add(this.sprite);
  }

  /**
   * Detach from parent.
   */
  detach(): void {
    if (this.sprite.parent) {
      this.sprite.parent.remove(this.sprite);
    }
  }

  /**
   * Dispose resources.
   */
  dispose(): void {
    this.material.dispose();
    // Note: Don't dispose shared texture
  }
}

/**
 * Manager for entity glows - handles batch updates and creation.
 */
export class EntityGlowManager {
  private glows: Map<THREE.Object3D, EntityGlow> = new Map();

  /**
   * Add a glow to an object.
   */
  addGlow(
    target: THREE.Object3D,
    color: THREE.Color | number = 0x00ffff,
    size: number = 0.5,
    opacity: number = 0.3
  ): EntityGlow {
    // Remove existing glow if any
    this.removeGlow(target);

    const glow = new EntityGlow(color, size, opacity);
    glow.attachTo(target);
    this.glows.set(target, glow);
    return glow;
  }

  /**
   * Remove glow from an object.
   */
  removeGlow(target: THREE.Object3D): void {
    const glow = this.glows.get(target);
    if (glow) {
      glow.detach();
      glow.dispose();
      this.glows.delete(target);
    }
  }

  /**
   * Get glow for an object.
   */
  getGlow(target: THREE.Object3D): EntityGlow | undefined {
    return this.glows.get(target);
  }

  /**
   * Update all glows.
   */
  update(dt: number): void {
    this.glows.forEach((glow) => {
      glow.update(dt);
    });
  }

  /**
   * Clear all glows.
   */
  clear(): void {
    this.glows.forEach((glow) => {
      glow.detach();
      glow.dispose();
    });
    this.glows.clear();
  }

  /**
   * Dispose manager.
   */
  dispose(): void {
    this.clear();
  }
}

/**
 * Pre-configured glow presets for different entity types.
 */
export const GlowPresets = {
  player: {
    color: 0x00ffff,
    size: 0.8,
    opacity: 0.25,
    pulseSpeed: 1.5,
    pulseAmount: 0.1,
  },
  enemy: {
    color: 0xff0000,
    size: 0.5,
    opacity: 0.2,
    pulseSpeed: 2,
    pulseAmount: 0.1,
  },
  geom: {
    color: 0x00ff66,
    size: 0.3,
    opacity: 0.4,
    pulseSpeed: 3,
    pulseAmount: 0.2,
  },
  bullet: {
    color: 0xffff00,
    size: 0.2,
    opacity: 0.5,
    pulseSpeed: 0,
    pulseAmount: 0,
  },
};
