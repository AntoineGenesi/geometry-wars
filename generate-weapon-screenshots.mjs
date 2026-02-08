/**
 * Generate weapon screenshot images for the WeaponWiki modal.
 *
 * For each weapon type, this script:
 * 1. Launches headless Chromium with SwiftShader (software WebGL)
 * 2. Navigates to the game on sphere surface
 * 3. Starts gameplay, equips the weapon via console injection
 * 4. Fires the weapon while enemies are nearby
 * 5. Captures a screenshot to public/weapon-screenshots/{slug}.png
 *
 * If headless capture fails (SwiftShader too slow, no dev server, etc.),
 * it generates styled SVG placeholder images to public/weapon-screenshots/{slug}.svg.
 * The WeaponWiki modal tries .png first, falls back to .svg, then shows text placeholder.
 *
 * Usage:
 *   # Make sure the dev server is running (npm run dev)
 *   node generate-weapon-screenshots.mjs
 */

import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, 'public/weapon-screenshots');

/** Weapon type enum values (mirrors WeaponTypes.ts) */
const WEAPONS = [
  { type: 'standard', slug: 'standard', name: 'Blaster', color: '#ffff44' },
  { type: 'spread', slug: 'spread', name: 'Spread Shot', color: '#44ffff' },
  { type: 'piercing', slug: 'piercing', name: 'Piercing Beam', color: '#ffffff' },
  { type: 'chain_lightning', slug: 'chain-lightning', name: 'Chain Lightning', color: '#aaffff' },
  { type: 'homing', slug: 'homing', name: 'Homing Missiles', color: '#ff4444' },
  { type: 'plasma_mortar', slug: 'plasma-mortar', name: 'Plasma Mortar', color: '#44ff44' },
  { type: 'gravity_gun', slug: 'gravity-gun', name: 'Gravity Gun', color: '#8844ff' },
  { type: 'laser_beam', slug: 'laser-beam', name: 'Laser Beam', color: '#ff0000' },
  { type: 'black_hole', slug: 'black-hole', name: 'Black Hole', color: '#6622aa' },
  { type: 'tesla_coil', slug: 'tesla-coil', name: 'Tesla Coil', color: '#88aaff' },
];

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Try to detect which port the Vite dev server is running on.
 */
async function findDevServerPort() {
  for (const port of [3000, 3001, 3002]) {
    try {
      const resp = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) return port;
    } catch {
      // Try next port
    }
  }
  return null;
}

/**
 * Generate a styled SVG placeholder image for a weapon.
 * Looks like a stylized weapon-themed graphic with the game's neon aesthetic.
 */
function generatePlaceholder(weapon) {
  const { name, color } = weapon;
  // Use unique IDs per weapon to avoid SVG ID collisions if multiple are on a page
  const uid = name.replace(/\s+/g, '').toLowerCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <radialGradient id="bg-${uid}" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#0a0a1e"/>
      <stop offset="100%" stop-color="#000008"/>
    </radialGradient>
    <filter id="glow-${uid}">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="640" height="360" fill="url(#bg-${uid})"/>
  <!-- Grid lines for depth -->
  <g opacity="0.08" stroke="${color}" stroke-width="0.5">
    <line x1="0" y1="60" x2="640" y2="60"/>
    <line x1="0" y1="120" x2="640" y2="120"/>
    <line x1="0" y1="180" x2="640" y2="180"/>
    <line x1="0" y1="240" x2="640" y2="240"/>
    <line x1="0" y1="300" x2="640" y2="300"/>
    <line x1="128" y1="0" x2="128" y2="360"/>
    <line x1="256" y1="0" x2="256" y2="360"/>
    <line x1="384" y1="0" x2="384" y2="360"/>
    <line x1="512" y1="0" x2="512" y2="360"/>
  </g>
  <!-- Central weapon effect rings -->
  <circle cx="320" cy="150" r="70" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.2" filter="url(#glow-${uid})"/>
  <circle cx="320" cy="150" r="45" fill="none" stroke="${color}" stroke-width="1" opacity="0.3" filter="url(#glow-${uid})"/>
  <circle cx="320" cy="150" r="20" fill="${color}" opacity="0.1" filter="url(#glow-${uid})"/>
  <circle cx="320" cy="150" r="5" fill="${color}" opacity="0.9" filter="url(#glow-${uid})"/>
  <!-- Projectile traces -->
  <line x1="325" y1="150" x2="440" y2="110" stroke="${color}" stroke-width="2" opacity="0.6" filter="url(#glow-${uid})"/>
  <line x1="325" y1="150" x2="430" y2="155" stroke="${color}" stroke-width="1.5" opacity="0.4" filter="url(#glow-${uid})"/>
  <line x1="325" y1="150" x2="420" y2="195" stroke="${color}" stroke-width="2" opacity="0.5" filter="url(#glow-${uid})"/>
  <!-- Enemy dots -->
  <circle cx="450" cy="105" r="8" fill="none" stroke="#aa44ff" stroke-width="1.5" opacity="0.6"/>
  <circle cx="445" cy="155" r="6" fill="none" stroke="#4444ff" stroke-width="1.5" opacity="0.5"/>
  <circle cx="430" cy="200" r="7" fill="none" stroke="#ff44aa" stroke-width="1.5" opacity="0.5"/>
  <!-- Player chevron -->
  <polygon points="310,140 325,150 310,160" fill="${color}" opacity="0.8" filter="url(#glow-${uid})"/>
  <!-- Title -->
  <text x="320" y="272" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
        font-size="26" font-weight="bold" fill="${color}" letter-spacing="4"
        filter="url(#glow-${uid})">${name.toUpperCase()}</text>
  <text x="320" y="298" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
        font-size="11" fill="#444466" letter-spacing="3">IN-GAME PREVIEW</text>
  <!-- Border -->
  <rect x="1" y="1" width="638" height="358" fill="none" stroke="${color}" stroke-width="1" opacity="0.15"/>
</svg>`;
  return svg;
}

/**
 * Generate SVG placeholders for all weapons.
 */
function generateAllPlaceholders() {
  for (const weapon of WEAPONS) {
    const svg = generatePlaceholder(weapon);
    const outPath = resolve(OUTPUT_DIR, `${weapon.slug}.svg`);
    writeFileSync(outPath, svg, 'utf-8');
    console.log(`  Placeholder: ${weapon.name} -> ${weapon.slug}.svg`);
  }
}

async function captureScreenshots() {
  const port = await findDevServerPort();

  if (!port) {
    console.log('No dev server found on ports 3000-3002.');
    console.log('Generating SVG placeholder images...\n');
    generateAllPlaceholders();
    console.log('\nPlaceholders saved. The modal will display these SVG images.');
    return;
  }

  console.log(`Dev server found on port ${port}`);
  let browser;
  let pngGenerated = 0;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--enable-webgl',
        '--use-gl=swiftshader',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu-sandbox',
        '--window-size=1280,720',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Collect console errors for debugging
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // Navigate once and reuse the page
    console.log('Loading game (this may take a while with SwiftShader)...');
    await page.goto(`http://localhost:${port}/?surface=sphere`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    // Give WebGL/Three.js time to initialize
    await new Promise(r => setTimeout(r, 5000));

    // Try to start the game
    await page.mouse.click(640, 360);
    await new Promise(r => setTimeout(r, 500));
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 500));
    await page.keyboard.press('Space');
    await new Promise(r => setTimeout(r, 500));
    await page.mouse.click(640, 360);
    await new Promise(r => setTimeout(r, 3000));

    for (const weapon of WEAPONS) {
      console.log(`\nCapturing: ${weapon.name} (${weapon.type})...`);
      errors.length = 0;

      try {
        // Equip the weapon via console injection
        await page.evaluate((weaponType) => {
          const event = new CustomEvent('debug-equip-weapon', {
            detail: { weaponType, ammo: 999 },
          });
          window.dispatchEvent(event);
          const win = window;
          if (win.__weaponManager) {
            win.__weaponManager.equipWeapon(weaponType, 999);
          }
        }, weapon.type);

        await new Promise(r => setTimeout(r, 300));

        // Fire weapon in several directions
        for (let i = 0; i < 5; i++) {
          const x = 640 + Math.cos(i * 0.8) * 200;
          const y = 360 + Math.sin(i * 0.8) * 150;
          await page.mouse.click(x, y);
          await new Promise(r => setTimeout(r, 80));
        }

        // Wait for visual effects
        await new Promise(r => setTimeout(r, 600));

        // Take screenshot
        const outPath = resolve(OUTPUT_DIR, `${weapon.slug}.png`);
        await page.screenshot({ path: outPath });
        console.log(`  Saved PNG: ${weapon.slug}.png`);
        pngGenerated++;

        if (errors.length > 0) {
          console.log(`  Warnings: ${errors.length} errors (first: ${errors[0].slice(0, 80)})`);
        }
      } catch (err) {
        console.log(`  PNG capture failed: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('Browser/navigation error:', err.message);
  } finally {
    if (browser) await browser.close();
  }

  // Always generate SVG placeholders as fallback
  console.log('\nGenerating SVG placeholders (fallback)...');
  generateAllPlaceholders();

  console.log(`\nSummary: ${pngGenerated}/10 PNG screenshots captured, 10 SVG placeholders generated.`);
}

captureScreenshots().then(() => {
  console.log('Done! Files in public/weapon-screenshots/');
}).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
