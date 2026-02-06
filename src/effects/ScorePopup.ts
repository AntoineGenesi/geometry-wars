import * as THREE from 'three';

/**
 * Floating score popup that drifts upward and fades out.
 * Creates a 3D sprite/text that shows score values at enemy death positions.
 */

interface Popup {
  mesh: THREE.Sprite;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
}

export class ScorePopupManager {
  private popups: Popup[] = [];
  readonly root = new THREE.Group();
  private textureCache = new Map<string, THREE.Texture>();

  /**
   * Spawn a floating score popup at the given world position.
   */
  spawn(position: THREE.Vector3, text: string, color: string = '#00ffff', scale = 0.5): void {
    const texture = this.getTexture(text, color);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(scale, scale * 0.4, 1);

    // Drift upward (along surface normal approximation)
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.3,
      1.5,
      (Math.random() - 0.5) * 0.3,
    );

    const popup: Popup = {
      mesh: sprite,
      velocity,
      age: 0,
      lifetime: 1.0,
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

    const scale = 0.4 + Math.min(total / 2000, 0.6);
    this.spawn(position, text, color, scale);
  }

  /**
   * Spawn a multiplier change popup.
   */
  spawnMultiplier(position: THREE.Vector3, multiplier: number): void {
    this.spawn(position, `x${multiplier}`, '#00ff00', 0.6);
  }

  update(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const popup = this.popups[i];
      popup.age += dt;

      // Move
      popup.mesh.position.addScaledVector(popup.velocity, dt);

      // Decelerate
      popup.velocity.multiplyScalar(0.95);

      // Fade and scale
      const progress = popup.age / popup.lifetime;
      const alpha = 1 - progress * progress; // ease-out fade
      (popup.mesh.material as THREE.SpriteMaterial).opacity = Math.max(0, alpha);

      // Grow slightly then shrink
      const scaleMultiplier = progress < 0.3
        ? 1 + progress * 0.5
        : 1.15 - (progress - 0.3) * 0.3;
      const baseScale = popup.mesh.scale.x;
      popup.mesh.scale.setScalar(baseScale * scaleMultiplier / baseScale * popup.mesh.scale.x);

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

    // Create canvas texture
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    // Draw text
    ctx.clearRect(0, 0, 256, 128);
    ctx.font = 'bold 48px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 64);

    // Second pass for sharper text
    ctx.shadowBlur = 4;
    ctx.fillText(text, 128, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    // Cache moderately (don't cache too many unique strings)
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
