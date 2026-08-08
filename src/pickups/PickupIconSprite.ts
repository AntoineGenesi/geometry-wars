import * as THREE from 'three';
import { WeaponType } from '../weapons/WeaponTypes';
import { StackBuffType, BuffCategory } from '../buffs/BuffManager';

/**
 * Canvas-based icon sprites for pickup visual delineation.
 *
 * Weapon pickups: white icon on subtle diamond background (category = diamond = weapon)
 * Buff pickups:   colored icon on subtle circle background (category = circle = buff)
 * Utility pickups: health/shield/companion/super each get a category glyph.
 *
 * Sprites use NormalBlending to prevent whiteout/overbloom when bloom is active.
 * They face the camera (THREE.Sprite) so they're readable from any angle.
 */

const ICON_SIZE = 96;
const HALF = ICON_SIZE / 2;

// ---------------------------------------------------------------------------
// Public factory functions
// ---------------------------------------------------------------------------

/** Create an icon sprite for a weapon pickup. White icon, uses weapon color for glow bg. */
export function createWeaponIconSprite(type: WeaponType, color: THREE.Color): THREE.Sprite {
  if (typeof document === 'undefined') return createBlankIconSprite(0.9);

  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;

  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);

  // Subtle diamond background (= weapon category hint)
  ctx.save();
  ctx.translate(HALF, HALF);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
  ctx.fillRect(-28, -28, 56, 56);
  ctx.restore();

  // Outer glow ring
  const glow = ctx.createRadialGradient(HALF, HALF, 6, HALF, HALF, 44);
  glow.addColorStop(0, `rgba(${r},${g},${b},0.35)`);
  glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);

  // White icon
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  drawWeaponIcon(ctx, type);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: true,
  });
  mat.userData.baseOpacity = 0.9;

  const sprite = new THREE.Sprite(mat);
  sprite.name = 'pickup-icon';
  sprite.scale.setScalar(0.5);
  return sprite;
}

/** Create an icon sprite for a buff pickup. Uses buff color for both icon and bg tint. */
export function createBuffIconSprite(
  type: StackBuffType,
  color: THREE.Color,
  category: BuffCategory,
): THREE.Sprite {
  return createIconSprite(color, 0.9, (ctx, r, g, b) => {
    drawCircleBackground(ctx, r, g, b, 32, 0.2);
    drawRadialGlow(ctx, r, g, b, 0.4);
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawBuffIcon(ctx, type, category);
  });
}

export function createLegacyBuffIconSprite(type: string, color: THREE.Color): THREE.Sprite {
  return createIconSprite(color, 0.9, (ctx, r, g, b) => {
    drawCircleBackground(ctx, r, g, b, 32, 0.2);
    drawRadialGlow(ctx, r, g, b, 0.35);
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawLegacyBuffIcon(ctx, type);
  });
}

export function createSuperPickupIconSprite(type: string, color: THREE.Color): THREE.Sprite {
  return createIconSprite(color, 0.95, (ctx, r, g, b) => {
    drawHexBackground(ctx, r, g, b, 34, 0.22);
    drawRadialGlow(ctx, r, g, b, 0.45);
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawSuperIcon(ctx, type);
  });
}

export function createCompanionIconSprite(type: string, color: THREE.Color): THREE.Sprite {
  return createIconSprite(color, 0.95, (ctx, r, g, b) => {
    drawCircleBackground(ctx, r, g, b, 34, 0.18);
    drawRadialGlow(ctx, r, g, b, 0.4);
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawCompanionIcon(ctx, type);
  });
}

export function createHealthIconSprite(color: THREE.Color): THREE.Sprite {
  return createIconSprite(color, 0.95, (ctx, r, g, b) => {
    drawCircleBackground(ctx, r, g, b, 34, 0.22);
    drawRadialGlow(ctx, r, g, b, 0.45);
    ctx.fillStyle = '#ffffff';
    drawHealthIcon(ctx);
  });
}

export function createShieldIconSprite(color: THREE.Color): THREE.Sprite {
  return createIconSprite(color, 0.95, (ctx, r, g, b) => {
    drawShieldBackground(ctx, r, g, b);
    drawRadialGlow(ctx, r, g, b, 0.42);
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawShieldIcon(ctx);
  });
}

function createIconSprite(
  color: THREE.Color,
  opacity: number,
  draw: (ctx: CanvasRenderingContext2D, r: number, g: number, b: number) => void,
): THREE.Sprite {
  if (typeof document === 'undefined') return createBlankIconSprite(opacity);

  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;

  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);

  draw(ctx, r, g, b);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: true,
  });
  mat.userData.baseOpacity = opacity;

  const sprite = new THREE.Sprite(mat);
  sprite.name = 'pickup-icon';
  sprite.scale.setScalar(0.5);
  return sprite;
}

function createBlankIconSprite(opacity: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: new THREE.Texture(),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: true,
  });
  mat.userData.baseOpacity = opacity;
  const sprite = new THREE.Sprite(mat);
  sprite.name = 'pickup-icon';
  sprite.scale.setScalar(0.5);
  return sprite;
}

function drawRadialGlow(
  ctx: CanvasRenderingContext2D,
  r: number,
  g: number,
  b: number,
  alpha: number,
): void {
  const glow = ctx.createRadialGradient(HALF, HALF, 8, HALF, HALF, 44);
  glow.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
  glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
}

function drawCircleBackground(
  ctx: CanvasRenderingContext2D,
  r: number,
  g: number,
  b: number,
  radius: number,
  alpha: number,
): void {
  ctx.beginPath();
  ctx.arc(HALF, HALF, radius, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
  ctx.fill();
}

function drawHexBackground(
  ctx: CanvasRenderingContext2D,
  r: number,
  g: number,
  b: number,
  radius: number,
  alpha: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 6 + (i / 6) * Math.PI * 2;
    const x = HALF + Math.cos(angle) * radius;
    const y = HALF + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
  ctx.fill();
}

function drawShieldBackground(
  ctx: CanvasRenderingContext2D,
  r: number,
  g: number,
  b: number,
): void {
  ctx.beginPath();
  ctx.moveTo(HALF, HALF - 36);
  ctx.lineTo(HALF + 28, HALF - 18);
  ctx.lineTo(HALF + 24, HALF + 12);
  ctx.quadraticCurveTo(HALF + 12, HALF + 32, HALF, HALF + 38);
  ctx.quadraticCurveTo(HALF - 12, HALF + 32, HALF - 24, HALF + 12);
  ctx.lineTo(HALF - 28, HALF - 18);
  ctx.closePath();
  ctx.fillStyle = `rgba(${r},${g},${b},0.22)`;
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Weapon icon drawing
// ---------------------------------------------------------------------------

function drawWeaponIcon(ctx: CanvasRenderingContext2D, type: WeaponType): void {
  const cx = HALF;
  const cy = HALF;

  switch (type) {
    case WeaponType.Spread: {
      // Fan of 5 rays spreading upward — recognizable shotgun pattern
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = -2; i <= 2; i++) {
        const angle = -Math.PI / 2 + (i * 22 * Math.PI) / 180;
        ctx.moveTo(cx, cy + 8);
        ctx.lineTo(cx + Math.cos(angle) * 30, cy + Math.sin(angle) * 30);
      }
      ctx.stroke();
      // Dot at base
      ctx.beginPath();
      ctx.arc(cx, cy + 8, 3.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case WeaponType.Piercing: {
      // Long arrow piercing through a ring — "punch through" visual
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(cx - 32, cy);
      ctx.lineTo(cx + 32, cy);
      ctx.stroke();
      // Arrowhead
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + 32, cy);
      ctx.lineTo(cx + 20, cy - 9);
      ctx.moveTo(cx + 32, cy);
      ctx.lineTo(cx + 20, cy + 9);
      ctx.stroke();
      // Ring in the middle (enemy being pierced)
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }

    case WeaponType.ChainLightning: {
      // Bold zigzag lightning bolt
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy - 30);
      ctx.lineTo(cx + 8, cy - 8);
      ctx.lineTo(cx - 4, cy + 2);
      ctx.lineTo(cx + 12, cy + 30);
      ctx.stroke();
      // Arc chain hint (small arc connecting to second bolt)
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(cx + 18, cy, 12, -Math.PI * 0.8, Math.PI * 0.1);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }

    case WeaponType.Homing: {
      // Crosshair target — "lock on" symbol
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.stroke();
      // 4 outer crosshair lines
      ctx.beginPath();
      ctx.moveTo(cx - 32, cy); ctx.lineTo(cx - 20, cy); // left
      ctx.moveTo(cx + 20, cy); ctx.lineTo(cx + 32, cy); // right
      ctx.moveTo(cx, cy - 32); ctx.lineTo(cx, cy - 20); // top
      ctx.moveTo(cx, cy + 20); ctx.lineTo(cx, cy + 32); // bottom
      ctx.stroke();
      // Center dot
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case WeaponType.PlasmaMortar: {
      // Explosion starburst — AoE visual
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const inner = (i % 2 === 0) ? 10 : 8;
        const outer = (i % 2 === 0) ? 30 : 22;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case WeaponType.GravityGun: {
      // 4 arrows pointing inward — "pull" gravity symbol
      ctx.lineWidth = 2.5;
      const pullDirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (const [dx, dy] of pullDirs) {
        const sx = cx + dx * 28;
        const sy = cy + dy * 28;
        const ex = cx + dx * 12;
        const ey = cy + dy * 12;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        // Arrowhead pointing inward
        const px = -dy; // perpendicular x
        const py = dx;  // perpendicular y
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + dx * 8 + px * 5, ey + dy * 8 + py * 5);
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + dx * 8 - px * 5, ey + dy * 8 - py * 5);
        ctx.stroke();
      }
      // Center circle
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case WeaponType.LaserBeam: {
      // Bold beam with diffuse outer lines — "sustained laser" visual
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(cx - 32, cy);
      ctx.lineTo(cx + 32, cy);
      ctx.stroke();
      // Softer outer beams
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(cx - 28, cy - 8);
      ctx.lineTo(cx + 28, cy - 8);
      ctx.moveTo(cx - 28, cy + 8);
      ctx.lineTo(cx + 28, cy + 8);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }

    case WeaponType.BlackHole: {
      // Inward spiral — vortex symbol
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let t = 0; t <= Math.PI * 3.2; t += 0.12) {
        const rSpiral = 30 * (1 - t / (Math.PI * 3.8));
        const x = cx + Math.cos(-t) * rSpiral;
        const y = cy + Math.sin(-t) * rSpiral;
        if (t < 0.01) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Dark center (draw bright ring to suggest darkness)
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }

    case WeaponType.TeslaCoil: {
      // Double parallel lightning bolts — "electric field" visual
      ctx.lineWidth = 2.5;
      // Left bolt
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy - 28);
      ctx.lineTo(cx - 4, cy - 6);
      ctx.lineTo(cx - 12, cy + 4);
      ctx.lineTo(cx - 2, cy + 28);
      ctx.stroke();
      // Right bolt
      ctx.beginPath();
      ctx.moveTo(cx + 14, cy - 28);
      ctx.lineTo(cx + 4, cy - 6);
      ctx.lineTo(cx + 12, cy + 4);
      ctx.lineTo(cx + 2, cy + 28);
      ctx.stroke();
      // Connecting arc (coil effect)
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(cx, cy - 10, 10, 0, Math.PI);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }

    default: {
      // Fallback: ✕ cross
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 20, cy - 20); ctx.lineTo(cx + 20, cy + 20);
      ctx.moveTo(cx + 20, cy - 20); ctx.lineTo(cx - 20, cy + 20);
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
// Buff icon drawing
// ---------------------------------------------------------------------------

function drawBuffIcon(
  ctx: CanvasRenderingContext2D,
  type: StackBuffType,
  _category: BuffCategory,
): void {
  const cx = HALF;
  const cy = HALF;

  switch (type) {
    case StackBuffType.HotHands: {
      // Flame — fire/damage visual
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 28);
      ctx.bezierCurveTo(cx - 20, cy + 10, cx - 18, cy - 8, cx - 2, cy - 4);
      ctx.bezierCurveTo(cx - 10, cy - 14, cx - 8, cy - 28, cx + 2, cy - 22);
      ctx.bezierCurveTo(cx + 6, cy - 14, cx + 4, cy - 6, cx + 8, cy - 10);
      ctx.bezierCurveTo(cx + 18, cy - 2, cx + 18, cy + 14, cx, cy + 28);
      ctx.fill();
      break;
    }

    case StackBuffType.TriggerHappy: {
      // Three stacked rightward arrows — "rapid fire" visual
      ctx.lineWidth = 2.5;
      for (let i = -1; i <= 1; i++) {
        const yOff = i * 12;
        ctx.beginPath();
        ctx.moveTo(cx - 24, cy + yOff);
        ctx.lineTo(cx + 12, cy + yOff);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + 12, cy + yOff - 9);
        ctx.lineTo(cx + 26, cy + yOff);
        ctx.lineTo(cx + 12, cy + yOff + 9);
        ctx.stroke();
      }
      break;
    }

    case StackBuffType.Afterburner: {
      // Speed chevrons >>> — movement/speed boost visual
      ctx.lineWidth = 3;
      const offsets = [-14, 0, 14];
      for (const xOff of offsets) {
        ctx.beginPath();
        ctx.moveTo(cx + xOff - 8, cy - 22);
        ctx.lineTo(cx + xOff + 8, cy);
        ctx.lineTo(cx + xOff - 8, cy + 22);
        ctx.stroke();
      }
      break;
    }

    case StackBuffType.Magnetism: {
      // Horseshoe magnet U-shape with poles
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx, cy + 4, 16, Math.PI, 0); // U arch
      ctx.stroke();
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cx - 16, cy + 4);
      ctx.lineTo(cx - 16, cy + 26);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + 16, cy + 4);
      ctx.lineTo(cx + 16, cy + 26);
      ctx.stroke();
      // Field lines above (attraction visual)
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(cx, cy - 8, 22, -Math.PI * 0.85, -Math.PI * 0.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy - 16, 30, -Math.PI * 0.75, -Math.PI * 0.25);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }

    case StackBuffType.ToughTimes: {
      // Shield outline with cross — defense/tank visual
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 28); // top center
      ctx.lineTo(cx + 22, cy - 14); // top right
      ctx.lineTo(cx + 22, cy + 6);  // right side
      ctx.bezierCurveTo(cx + 22, cy + 20, cx + 10, cy + 28, cx, cy + 32); // bottom right
      ctx.bezierCurveTo(cx - 10, cy + 28, cx - 22, cy + 20, cx - 22, cy + 6); // bottom left
      ctx.lineTo(cx - 22, cy - 14); // left side
      ctx.closePath();
      ctx.stroke();
      // Cross inside shield
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 14);
      ctx.moveTo(cx - 10, cy + 2); ctx.lineTo(cx + 10, cy + 2);
      ctx.stroke();
      break;
    }

    case StackBuffType.ShockAura: {
      // Pulsing electric ring with outward sparks
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.stroke();
      // 4 lightning sparks radiating outward
      const sparkAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
      ctx.lineWidth = 2;
      for (const angle of sparkAngles) {
        const sx = cx + Math.cos(angle) * 20;
        const sy = cy + Math.sin(angle) * 20;
        const ex = cx + Math.cos(angle) * 32;
        const ey = cy + Math.sin(angle) * 32;
        // Zigzag spark
        const perp = angle + Math.PI / 2;
        const mx = (sx + ex) / 2 + Math.cos(perp) * 5;
        const my = (sy + ey) / 2 + Math.sin(perp) * 5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(mx, my);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      break;
    }

    case StackBuffType.IncendiaryRounds: {
      // Bullet + flame — burning projectile visual
      ctx.lineWidth = 2;
      // Bullet body (rectangle + rounded tip)
      ctx.beginPath();
      ctx.rect(cx - 24, cy - 8, 18, 16);
      ctx.stroke();
      // Bullet tip (pointed)
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy - 8);
      ctx.lineTo(cx + 4, cy);
      ctx.lineTo(cx - 6, cy + 8);
      ctx.stroke();
      // Flame on the right
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + 10, cy + 14);
      ctx.bezierCurveTo(cx + 4, cy + 4, cx + 16, cy - 2, cx + 10, cy - 14);
      ctx.bezierCurveTo(cx + 14, cy - 6, cx + 22, cy, cx + 16, cy + 8);
      ctx.bezierCurveTo(cx + 20, cy + 4, cx + 22, cy + 10, cx + 10, cy + 14);
      ctx.fill();
      break;
    }

    case StackBuffType.Volatile: {
      // Large explosion burst — unstable/explosive visual
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2;
        const inner = (i % 2 === 0) ? 8 : 6;
        const outer = (i % 2 === 0) ? 30 : 20;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
        ctx.stroke();
      }
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    // Weapon mastery buffs — use the weapon's visual identity
    case StackBuffType.MasteryBlaster:
    case StackBuffType.MasterySpread:
    case StackBuffType.MasteryPiercing:
    case StackBuffType.MasteryChainLightning:
    case StackBuffType.MasteryHoming:
    case StackBuffType.MasteryPlasmaMortar:
    case StackBuffType.MasteryGravityGun:
    case StackBuffType.MasteryLaserBeam:
    case StackBuffType.MasteryBlackHole:
    case StackBuffType.MasteryTeslaCoil: {
      // Star shape — "mastery/achievement" visual
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? 28 : 12;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }

    default: {
      // Category fallback: simple circle
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawLegacyBuffIcon(ctx: CanvasRenderingContext2D, type: string): void {
  const cx = HALF;
  const cy = HALF;
  switch (type) {
    case 'extended_range': {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 28, cy);
      ctx.lineTo(cx + 24, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + 24, cy);
      ctx.lineTo(cx + 12, cy - 10);
      ctx.moveTo(cx + 24, cy);
      ctx.lineTo(cx + 12, cy + 10);
      ctx.stroke();
      break;
    }
    case 'rapid_fire': {
      ctx.lineWidth = 2.5;
      for (let i = -1; i <= 1; i++) {
        const y = cy + i * 12;
        ctx.beginPath();
        ctx.moveTo(cx - 24, y);
        ctx.lineTo(cx + 18, y);
        ctx.stroke();
      }
      break;
    }
    case 'duration_plus': {
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, 24, -Math.PI / 2, Math.PI * 1.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + 5, cy - 26);
      ctx.lineTo(cx, cy - 14);
      ctx.lineTo(cx - 9, cy - 24);
      ctx.stroke();
      break;
    }
    default: {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawSuperIcon(ctx: CanvasRenderingContext2D, type: string): void {
  const cx = HALF;
  const cy = HALF;
  const normalized = type.toLowerCase();
  if (normalized.includes('bomb')) {
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy + 3, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 8, cy - 12);
    ctx.quadraticCurveTo(cx + 18, cy - 26, cx + 30, cy - 20);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const inner = 3;
      const outer = i % 2 === 0 ? 10 : 7;
      const x = cx + 31 + Math.cos(angle) * (i === 0 ? inner : outer);
      const y = cy - 23 + Math.sin(angle) * (i === 0 ? inner : outer);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (normalized.includes('multiplier')) {
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy - 20);
    ctx.lineTo(cx + 20, cy + 20);
    ctx.moveTo(cx + 20, cy - 20);
    ctx.lineTo(cx - 20, cy + 20);
    ctx.stroke();
    return;
  }

  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const radius = i % 2 === 0 ? 30 : 13;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawCompanionIcon(ctx: CanvasRenderingContext2D, type: string): void {
  const cx = HALF;
  const cy = HALF;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 28, 12, Math.PI / 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy, 28, 12, -Math.PI / 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fill();

  if (type === 'hunter') {
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 30);
    ctx.lineTo(cx + 9, cy - 14);
    ctx.lineTo(cx - 9, cy - 14);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'protector') {
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy);
    ctx.lineTo(cx - 18, cy);
    ctx.moveTo(cx + 18, cy);
    ctx.lineTo(cx + 30, cy);
    ctx.stroke();
  }
}

function drawHealthIcon(ctx: CanvasRenderingContext2D): void {
  const cx = HALF;
  const cy = HALF;
  ctx.fillRect(cx - 7, cy - 28, 14, 56);
  ctx.fillRect(cx - 28, cy - 7, 56, 14);
}

function drawShieldIcon(ctx: CanvasRenderingContext2D): void {
  const cx = HALF;
  const cy = HALF;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 30);
  ctx.lineTo(cx + 22, cy - 16);
  ctx.lineTo(cx + 19, cy + 8);
  ctx.quadraticCurveTo(cx + 10, cy + 24, cx, cy + 30);
  ctx.quadraticCurveTo(cx - 10, cy + 24, cx - 19, cy + 8);
  ctx.lineTo(cx - 22, cy - 16);
  ctx.closePath();
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 16);
  ctx.lineTo(cx, cy + 18);
  ctx.stroke();
}
