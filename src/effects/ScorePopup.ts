import * as THREE from 'three';

/**
 * Floating score popup - BF3-style: small, clean, quick.
 * World-space sprites that drift "up" in screen space and fade out.
 * Camera-aware: drift direction follows camera.up so popups always
 * float upward on screen regardless of surface orientation.
 */

interface Popup {
  mesh: THREE.Sprite;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
  baseScale: number;
}

export class ScorePopupManager {
  private popups: Popup[] = [];
  readonly root = new THREE.Group();
  private textureCache = new Map<string, THREE.Texture>();
  private camera: THREE.Camera | null = null;

  /**
   * Set the camera reference so popups can drift in screen-up direction.
   * Must be called before spawning popups.
   */
  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  /**
   * Spawn a floating score popup at the given world position.
   */
  spawn(position: THREE.Vector3, text: string, color: string = '#00ffff', scale = 1.8, lifetime = 1.0): void {
    const texture = this.getTexture(text, color);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 999;
    // Start fully opaque so popups are visible on first rendered frame
    // (update() runs before collision checks, so new popups have age=0 until next tick)
    material.opacity = 1.0;

    // Offset position slightly toward camera so it doesn't clip into the surface.
    // Use camera direction if available, otherwise fall back to world Y.
    const offsetDir = this.camera
      ? new THREE.Vector3().subVectors(this.camera.position, position).normalize()
      : new THREE.Vector3(0, 1, 0);
    sprite.position.copy(position).addScaledVector(offsetDir, 0.5);

    // Canvas aspect ratio is 256:64 = 4:1, so Y scale = X * 0.25
    sprite.scale.set(scale, scale * 0.25, 1);

    // Drift in screen-up direction (camera.up) so popups always float upward
    // on screen regardless of surface orientation.
    const driftDir = this.camera
      ? this.camera.up.clone().normalize()
      : new THREE.Vector3(0, 1, 0);
    const velocity = driftDir.multiplyScalar(2.0);

    const popup: Popup = {
      mesh: sprite,
      velocity,
      age: 0,
      lifetime,
      baseScale: scale,
    };

    this.popups.push(popup);
    this.root.add(sprite);
  }

  /**
   * Spawn a score popup with formatted number.
   */
  spawnScore(position: THREE.Vector3, score: number, multiplier = 1): void {
    const total = score * multiplier;
    const text = total >= 1000 ? `+${(total / 1000).toFixed(1)}k` : `+${total}`;

    // Color based on value
    let color = '#00ffff';
    if (total >= 500) color = '#ffff00';
    if (total >= 1000) color = '#ff8800';
    if (total >= 5000) color = '#ff00ff';

    // Scale range: 1.5 to 2.5 (visible at 15 units camera distance)
    const scale = 1.5 + Math.min(total / 5000, 1.0);
    this.spawn(position, text, color, scale);
  }

  /**
   * Spawn a floating damage number at an enemy position.
   * Small red text, short lifetime, slight random offset to avoid stacking.
   */
  spawnDamage(position: THREE.Vector3, damage: number): void {
    const text = damage >= 1 ? `-${Math.round(damage)}` : `-${damage.toFixed(1)}`;
    const offsetX = (Math.random() - 0.5) * 0.5;
    const offsetZ = (Math.random() - 0.5) * 0.5;
    const pos = position.clone().add(new THREE.Vector3(offsetX, 0, offsetZ));
    this.spawn(pos, text, '#ff4444', 1.3, 0.7);
  }

  /**
   * Spawn a multiplier change popup.
   */
  spawnMultiplier(position: THREE.Vector3, multiplier: number): void {
    this.spawn(position, `x${multiplier}`, '#00ff00', 2.0);
  }

  update(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const popup = this.popups[i];
      popup.age += dt;

      // Move in drift direction (screen-up)
      popup.mesh.position.addScaledVector(popup.velocity, dt);

      // Decelerate gently
      popup.velocity.multiplyScalar(0.97);

      // Fade: quick in, steady, quick out
      const progress = popup.age / popup.lifetime;
      let alpha: number;
      if (progress < 0.1) {
        alpha = progress / 0.1; // quick fade in
      } else if (progress < 0.6) {
        alpha = 1.0; // steady
      } else {
        alpha = 1 - (progress - 0.6) / 0.4; // fade out
      }
      (popup.mesh.material as THREE.SpriteMaterial).opacity = Math.max(0, alpha);

      // Slight scale-down over time for a clean feel
      const shrink = 1.0 - progress * 0.2;
      const s = popup.baseScale * shrink;
      popup.mesh.scale.set(s, s * 0.25, 1);

      // Remove when dead
      if (popup.age >= popup.lifetime) {
        this.root.remove(popup.mesh);
        (popup.mesh.material as THREE.SpriteMaterial).dispose();
        this.popups.splice(i, 1);
      }
    }
  }

  private getTexture(text: string, color: string): THREE.Texture {
    const key = `${text}_${color}`;
    const cached = this.textureCache.get(key);
    if (cached) return cached;

    // Higher resolution canvas for crisp text at larger sprite scale
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 40px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Glow pass
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 32);

    // Crisp second pass
    ctx.shadowBlur = 2;
    ctx.fillText(text, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    if (this.textureCache.size < 50) {
      this.textureCache.set(key, texture);
    }

    return texture;
  }

  dispose(): void {
    for (const popup of this.popups) {
      this.root.remove(popup.mesh);
      (popup.mesh.material as THREE.SpriteMaterial).dispose();
    }
    this.popups = [];
    for (const texture of this.textureCache.values()) {
      texture.dispose();
    }
    this.textureCache.clear();
  }
}
