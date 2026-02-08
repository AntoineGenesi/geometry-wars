import * as THREE from 'three';

/**
 * A glowing halo/ring that renders around allied players.
 * Visible through surfaces (depthTest: false, high renderOrder).
 * Color matches the player's assigned color.
 * Subtle pulsing animation (scale oscillates +/-10%).
 */

// Shared ring texture (created lazily)
let sharedRingTexture: THREE.Texture | null = null;

function createRingTexture(size: number = 128): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = size / 2;
  const innerRadius = size * 0.3;

  // Draw a soft ring gradient
  const gradient = ctx.createRadialGradient(cx, cy, innerRadius, cx, cy, outerRadius);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.6)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 1.0)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.6)');
  gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function getRingTexture(): THREE.Texture {
  if (!sharedRingTexture) {
    sharedRingTexture = createRingTexture(128);
  }
  return sharedRingTexture;
}

export class AllyGlow {
  readonly sprite: THREE.Sprite;
  private readonly material: THREE.SpriteMaterial;
  private baseScale: number;
  private pulsePhase: number = 0;
  private readonly pulseSpeed: number;
  private readonly pulseAmount: number;

  /**
   * @param color   - Player color (hex)
   * @param size    - Base diameter of the glow ring (~1.5x player radius)
   * @param opacity - Base opacity (keep subtle)
   */
  constructor(
    color: number = 0x00ffff,
    size: number = 0.9,
    opacity: number = 0.35,
    pulseSpeed: number = 1.2,
    pulseAmount: number = 0.10,
  ) {
    this.baseScale = size;
    this.pulseSpeed = pulseSpeed;
    this.pulseAmount = pulseAmount;

    this.material = new THREE.SpriteMaterial({
      map: getRingTexture(),
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      blending: THREE.NormalBlending, // NormalBlending to avoid white-out with bloom
      depthTest: false,              // Visible through surfaces
      depthWrite: false,
    });

    this.sprite = new THREE.Sprite(this.material);
    this.sprite.scale.setScalar(size);
    this.sprite.renderOrder = 999; // Render on top of everything
  }

  /**
   * Update the pulsing animation.
   */
  update(dt: number): void {
    this.pulsePhase += dt * this.pulseSpeed * Math.PI * 2;
    const pulse = 1 + Math.sin(this.pulsePhase) * this.pulseAmount;
    this.sprite.scale.setScalar(this.baseScale * pulse);
  }

  /**
   * Set the glow color.
   */
  setColor(color: number): void {
    this.material.color.setHex(color);
  }

  /**
   * Set the glow size.
   */
  setSize(size: number): void {
    this.baseScale = size;
    this.sprite.scale.setScalar(size);
  }

  /**
   * Sync the glow position to a world position.
   * Call each frame after the target entity has been positioned.
   */
  setPosition(position: THREE.Vector3): void {
    this.sprite.position.copy(position);
  }

  /**
   * Attach as a child of an Object3D (follows automatically).
   */
  attachTo(parent: THREE.Object3D): void {
    parent.add(this.sprite);
  }

  /**
   * Add directly to a scene (must call setPosition manually each frame).
   */
  addToScene(scene: THREE.Object3D): void {
    scene.add(this.sprite);
  }

  /**
   * Remove from parent/scene.
   */
  detach(): void {
    if (this.sprite.parent) {
      this.sprite.parent.remove(this.sprite);
    }
  }

  /**
   * Dispose GPU resources.
   */
  dispose(): void {
    this.material.dispose();
    // Don't dispose the shared ring texture
  }
}

/**
 * Manages AllyGlow instances for all non-local players.
 */
export class AllyGlowManager {
  private glows: Map<string | number, AllyGlow> = new Map();
  private scene: THREE.Object3D;

  constructor(scene: THREE.Object3D) {
    this.scene = scene;
  }

  /**
   * Add a glow for a player identified by key (player index or network ID).
   */
  addGlow(key: string | number, color: number, size: number = 0.9): AllyGlow {
    // Remove existing if any
    this.removeGlow(key);

    const glow = new AllyGlow(color, size, 0.35);
    glow.addToScene(this.scene);
    this.glows.set(key, glow);
    return glow;
  }

  /**
   * Remove a specific glow.
   */
  removeGlow(key: string | number): void {
    const glow = this.glows.get(key);
    if (glow) {
      glow.detach();
      glow.dispose();
      this.glows.delete(key);
    }
  }

  /**
   * Get a glow by key.
   */
  getGlow(key: string | number): AllyGlow | undefined {
    return this.glows.get(key);
  }

  /**
   * Update all glows (pulsing animation).
   */
  update(dt: number): void {
    this.glows.forEach((glow) => {
      glow.update(dt);
    });
  }

  /**
   * Update a specific glow's position.
   */
  setPosition(key: string | number, position: THREE.Vector3): void {
    const glow = this.glows.get(key);
    if (glow) {
      glow.setPosition(position);
    }
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
   * Dispose manager and all glows.
   */
  dispose(): void {
    this.clear();
  }
}
