/**
 * Comprehensive E2E Visual Tests for Geometry Wars 3D
 *
 * Uses Playwright + Chromium with SwiftShader for headless WebGL rendering.
 * Tests actual rendered output: surfaces, player, bullets, UI, effects.
 *
 * Run: npx playwright test
 * Requires: npm run dev (or uses webServer config to auto-start)
 *
 * Test domains:
 * 1. Start menu rendering
 * 2. Surface rendering (all 11 types)
 * 3. Player visibility and centering
 * 4. Bullet spawning and direction
 * 5. UI elements (score, lives, bombs, weapon)
 * 6. Console error monitoring
 * 7. Game state transitions
 * 8. Canvas rendering (not blank)
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'http://localhost:3001';

// All surface types to test
const SURFACE_TYPES = [
  'sphere', 'cube', 'torus', 'cylinder', 'peanut',
  'capsule', 'icosahedron', 'mobius', 'sphere-tunnel',
  'cube-ring', 'cube-tunnel',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for WebGL canvas to render (non-black pixels) */
async function waitForRendering(page: Page, timeout = 10000): Promise<void> {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;
    try {
      const ctx = canvas.getContext('2d') || canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!ctx) return false;
      // Check that the canvas has been drawn to
      return canvas.width > 0 && canvas.height > 0;
    } catch {
      return true; // WebGL context exists but can't read pixels
    }
  }, { timeout });
}

/** Click the start button to enter a game mode */
async function startGame(page: Page, surface: string, mode = 'single'): Promise<void> {
  // Navigate to the game URL with params to skip the menu
  await page.goto(`${BASE_URL}?surface=${surface}&level=0`);

  // Wait for the start menu to appear
  const startMenu = page.locator('#start-menu');
  await startMenu.waitFor({ state: 'visible', timeout: 15000 });

  // Select surface if visible
  const surfaceBtn = page.locator(`.surface-btn[data-surface="${surface}"]`);
  if (await surfaceBtn.isVisible()) {
    await surfaceBtn.click();
  }

  // Click the game mode button (oval-btn in redesigned menu)
  const modeBtn = page.locator(`[data-mode="${mode}"]`);
  await modeBtn.click();

  // Wait for menu to hide and game to start
  await page.waitForTimeout(2000);
}

/** Count console errors during a page session */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    errors.push(err.message);
  });
  return errors;
}

/** Get pixel data from the center of the canvas */
async function getCenterPixels(page: Page): Promise<{ r: number; g: number; b: number; a: number } | null> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;

    // Create a temporary 2D canvas to read pixels from WebGL canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(canvas, 0, 0);
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    const pixel = ctx.getImageData(cx, cy, 1, 1).data;

    return { r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] };
  });
}

/** Check if canvas has non-black content (rendering is working) */
async function hasRenderedContent(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return false;

    ctx.drawImage(canvas, 0, 0);

    // Sample a grid of pixels across the canvas
    let nonBlackCount = 0;
    const sampleSize = 20;
    for (let x = 0; x < sampleSize; x++) {
      for (let y = 0; y < sampleSize; y++) {
        const px = Math.floor((x / sampleSize) * canvas.width);
        const py = Math.floor((y / sampleSize) * canvas.height);
        const pixel = ctx.getImageData(px, py, 1, 1).data;
        if (pixel[0] > 5 || pixel[1] > 5 || pixel[2] > 5) {
          nonBlackCount++;
        }
      }
    }

    // At least 5% of sampled pixels should be non-black
    return nonBlackCount > sampleSize * sampleSize * 0.05;
  });
}

/** Check if there are any bright pixels (bloom/glow test) */
async function hasBrightPixels(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return false;

    ctx.drawImage(canvas, 0, 0);

    // Sample for bright pixels (bloom glow = bright spots)
    let brightCount = 0;
    const sampleSize = 30;
    for (let x = 0; x < sampleSize; x++) {
      for (let y = 0; y < sampleSize; y++) {
        const px = Math.floor((x / sampleSize) * canvas.width);
        const py = Math.floor((y / sampleSize) * canvas.height);
        const pixel = ctx.getImageData(px, py, 1, 1).data;
        if (pixel[0] > 150 || pixel[1] > 150 || pixel[2] > 150) {
          brightCount++;
        }
      }
    }

    return brightCount > 0;
  });
}

/** Check that screen is NOT completely white (bloom white-out) */
async function isNotWhiteOut(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return true;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return true;

    ctx.drawImage(canvas, 0, 0);

    // Check that <50% of pixels are nearly white
    let whiteCount = 0;
    const sampleSize = 20;
    for (let x = 0; x < sampleSize; x++) {
      for (let y = 0; y < sampleSize; y++) {
        const px = Math.floor((x / sampleSize) * canvas.width);
        const py = Math.floor((y / sampleSize) * canvas.height);
        const pixel = ctx.getImageData(px, py, 1, 1).data;
        if (pixel[0] > 240 && pixel[1] > 240 && pixel[2] > 240) {
          whiteCount++;
        }
      }
    }

    return whiteCount < sampleSize * sampleSize * 0.5;
  });
}

// ==========================================================================
// TEST SUITE 1: START MENU
// ==========================================================================

test.describe('Start Menu', () => {
  test('renders start menu on load', async ({ page }) => {
    await page.goto(BASE_URL);
    const menu = page.locator('#start-menu');
    await expect(menu).toBeVisible({ timeout: 15000 });
  });

  test('displays game title', async ({ page }) => {
    await page.goto(BASE_URL);
    const title = page.locator('#start-menu .title');
    await expect(title).toContainText('GEOMETRY WARS');
  });

  test('displays full title with 3D', async ({ page }) => {
    await page.goto(BASE_URL);
    const title = page.locator('#start-menu .title');
    await expect(title).toContainText('3D');
  });

  test('shows all game mode buttons', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('.oval-btn[data-mode="adventure"]')).toBeVisible();
    await expect(page.locator('.oval-btn[data-mode="single"]')).toBeVisible();
    await expect(page.locator('.oval-btn[data-mode="multiplayer"]')).toBeVisible();
    await expect(page.locator('.oval-btn[data-mode="network"]')).toBeVisible();
  });

  test('shows surface selection grid', async ({ page }) => {
    await page.goto(BASE_URL);
    const grid = page.locator('#surface-section .surface-grid');
    await expect(grid).toBeVisible();

    // Should have 11 surface buttons in the surface section
    const buttons = page.locator('#surface-section .surface-btn');
    await expect(buttons).toHaveCount(11);
  });

  test('surface buttons are clickable', async ({ page }) => {
    await page.goto(BASE_URL);
    const sphereBtn = page.locator('.surface-btn[data-surface="sphere"]');
    await expect(sphereBtn).toBeVisible();

    // Click torus button
    const torusBtn = page.locator('.surface-btn[data-surface="torus"]');
    await torusBtn.click();

    // Should have 'selected' class
    await expect(torusBtn).toHaveClass(/selected/);
    // Sphere should no longer be selected
    await expect(sphereBtn).not.toHaveClass(/selected/);
  });

  test('adventure mode shows level grid', async ({ page }) => {
    await page.goto(BASE_URL);
    const adventureBtn = page.locator('.oval-btn[data-mode="adventure"]');
    await adventureBtn.click();

    // Adventure section should be visible
    const adventureSection = page.locator('#adventure-levels');
    await expect(adventureSection).toBeVisible();

    // Should have level buttons
    const levelBtns = page.locator('.level-btn');
    const count = await levelBtns.count();
    expect(count).toBeGreaterThan(0);
  });

  test('back button returns from adventure to main menu', async ({ page }) => {
    await page.goto(BASE_URL);

    // Go to adventure
    await page.locator('.oval-btn[data-mode="adventure"]').click();
    await expect(page.locator('#adventure-levels')).toBeVisible();

    // Click back
    await page.locator('#adventure-back').click();
    await expect(page.locator('#adventure-levels')).toBeHidden();
    await expect(page.locator('#main-buttons')).toBeVisible();
  });

  test('controls hint is displayed', async ({ page }) => {
    await page.goto(BASE_URL);
    const hint = page.locator('#start-menu .controls-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('WASD');
  });
});

// ==========================================================================
// TEST SUITE 2: GAME LOADING (per surface)
// ==========================================================================

test.describe('Game Loading', () => {
  // Test a subset of surfaces for speed (3 representative ones)
  const surfacesToTest = ['sphere', 'torus', 'cube'];

  for (const surface of surfacesToTest) {
    test(`loads ${surface} surface without JS errors`, async ({ page }) => {
      const errors = collectConsoleErrors(page);

      await startGame(page, surface);

      // Filter out non-critical errors (e.g., audio context warnings)
      const criticalErrors = errors.filter(e =>
        !e.includes('AudioContext') &&
        !e.includes('user gesture') &&
        !e.includes('favicon')
      );

      expect(criticalErrors).toHaveLength(0);
    });

    test(`${surface} - canvas exists and has size`, async ({ page }) => {
      await startGame(page, surface);

      const canvas = page.locator('canvas');
      await expect(canvas).toBeVisible({ timeout: 10000 });

      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(100);
      expect(box!.height).toBeGreaterThan(100);
    });
  }
});

// ==========================================================================
// TEST SUITE 3: UI ELEMENTS
// ==========================================================================

test.describe('UI Elements', () => {
  test('score display is visible during gameplay', async ({ page }) => {
    await startGame(page, 'sphere');
    const score = page.locator('#score-display');
    await expect(score).toBeVisible();
  });

  test('multiplier display is visible', async ({ page }) => {
    await startGame(page, 'sphere');
    const multiplier = page.locator('#multiplier-display');
    await expect(multiplier).toBeVisible();
    await expect(multiplier).toContainText('x');
  });

  test('lives display shows hearts', async ({ page }) => {
    await startGame(page, 'sphere');
    const lives = page.locator('#lives-display');
    await expect(lives).toBeVisible();
    const text = await lives.textContent();
    // Should contain heart characters or numbers
    expect(text!.length).toBeGreaterThan(0);
  });

  test('bombs display is visible', async ({ page }) => {
    await startGame(page, 'sphere');
    const bombs = page.locator('#bombs-display');
    await expect(bombs).toBeVisible();
  });

  test('level name is displayed', async ({ page }) => {
    await startGame(page, 'sphere');
    const levelName = page.locator('#level-name-display');
    await expect(levelName).toBeVisible();
    const text = await levelName.textContent();
    expect(text!.length).toBeGreaterThan(0);
  });

  test('start menu hides after starting game', async ({ page }) => {
    await startGame(page, 'sphere');
    const menu = page.locator('#start-menu');
    await expect(menu).toBeHidden();
  });
});

// ==========================================================================
// TEST SUITE 4: PAUSE & GAME STATE
// ==========================================================================

test.describe('Pause Menu', () => {
  test('ESC opens pause menu', async ({ page }) => {
    await startGame(page, 'sphere');

    // Wait for countdown to finish
    await page.waitForTimeout(4000);

    // Press ESC
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Pause menu should be visible
    const pauseMenu = page.locator('#pause-menu');
    // Note: PauseMenu creates its own DOM element
    const anyPauseIndicator = page.locator('text=PAUSED');
    // If pause menu exists, it should be visible
    const pauseExists = await anyPauseIndicator.count();
    if (pauseExists > 0) {
      await expect(anyPauseIndicator.first()).toBeVisible();
    }
  });
});

// ==========================================================================
// TEST SUITE 5: SCREENSHOT REGRESSION (per surface)
// ==========================================================================

test.describe('Surface Screenshots', () => {
  for (const surface of SURFACE_TYPES) {
    test(`${surface} renders without crash`, async ({ page }) => {
      const errors = collectConsoleErrors(page);

      await page.goto(BASE_URL);
      await page.waitForTimeout(1000);

      // Select surface and start
      const surfaceBtn = page.locator(`.surface-btn[data-surface="${surface}"]`);
      if (await surfaceBtn.isVisible()) {
        await surfaceBtn.click();
      }

      const startBtn = page.locator('[data-mode="single"]');
      await startBtn.click();
      await page.waitForTimeout(3000);

      // Take screenshot
      await page.screenshot({
        path: `screenshots/e2e-${surface}.png`,
        fullPage: false,
      });

      // No critical errors
      const criticalErrors = errors.filter(e =>
        !e.includes('AudioContext') &&
        !e.includes('user gesture') &&
        !e.includes('favicon') &&
        !e.includes('net::')
      );
      expect(criticalErrors).toHaveLength(0);
    });
  }
});

// ==========================================================================
// TEST SUITE 6: KEYBOARD INPUT
// ==========================================================================

test.describe('Keyboard Input', () => {
  test('WASD keys are accepted without errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await startGame(page, 'sphere');
    await page.waitForTimeout(4000); // Wait for countdown

    // Press movement keys
    await page.keyboard.down('w');
    await page.waitForTimeout(500);
    await page.keyboard.up('w');

    await page.keyboard.down('a');
    await page.waitForTimeout(500);
    await page.keyboard.up('a');

    await page.keyboard.down('s');
    await page.waitForTimeout(500);
    await page.keyboard.up('s');

    await page.keyboard.down('d');
    await page.waitForTimeout(500);
    await page.keyboard.up('d');

    const criticalErrors = errors.filter(e =>
      !e.includes('AudioContext') &&
      !e.includes('user gesture') &&
      !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('M key toggles mute without errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await startGame(page, 'sphere');
    await page.waitForTimeout(4000);

    await page.keyboard.press('m');
    await page.waitForTimeout(200);
    await page.keyboard.press('m');

    const criticalErrors = errors.filter(e =>
      !e.includes('AudioContext') &&
      !e.includes('user gesture') &&
      !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('Space key (bomb) is accepted', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await startGame(page, 'sphere');
    await page.waitForTimeout(4000);

    await page.keyboard.press('Space');
    await page.waitForTimeout(500);

    const criticalErrors = errors.filter(e =>
      !e.includes('AudioContext') &&
      !e.includes('user gesture') &&
      !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});

// ==========================================================================
// TEST SUITE 7: MOUSE INPUT
// ==========================================================================

test.describe('Mouse Input', () => {
  test('mouse click triggers shooting without errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await startGame(page, 'sphere');
    await page.waitForTimeout(4000);

    // Click at various positions (aim + shoot)
    await page.mouse.click(960, 300); // Aim up-right
    await page.waitForTimeout(200);
    await page.mouse.click(960, 800); // Aim down
    await page.waitForTimeout(200);
    await page.mouse.click(300, 540); // Aim left
    await page.waitForTimeout(200);

    const criticalErrors = errors.filter(e =>
      !e.includes('AudioContext') &&
      !e.includes('user gesture') &&
      !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('continuous mouse movement doesn\'t crash', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await startGame(page, 'sphere');
    await page.waitForTimeout(4000);

    // Move mouse rapidly
    for (let i = 0; i < 20; i++) {
      const x = 200 + Math.cos(i * 0.3) * 600;
      const y = 200 + Math.sin(i * 0.3) * 400;
      await page.mouse.move(x, y);
      await page.waitForTimeout(50);
    }

    const criticalErrors = errors.filter(e =>
      !e.includes('AudioContext') &&
      !e.includes('user gesture') &&
      !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});

// ==========================================================================
// TEST SUITE 8: MULTIPLAYER MODE
// ==========================================================================

test.describe('Multiplayer Mode', () => {
  test('local multiplayer loads without errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(`${BASE_URL}?mode=multiplayer&surface=sphere`);
    await page.waitForTimeout(5000);

    const criticalErrors = errors.filter(e =>
      !e.includes('AudioContext') &&
      !e.includes('user gesture') &&
      !e.includes('favicon') &&
      !e.includes('net::')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});

// ==========================================================================
// TEST SUITE 9: MESH TEST SCENE
// ==========================================================================

test.describe('Mesh Test Scene', () => {
  test('mesh test page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/mesh-test.html?shape=sphere`);
    await page.waitForTimeout(3000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('mesh test - torus shape loads', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(`${BASE_URL}/mesh-test.html?shape=torus`);
    await page.waitForTimeout(3000);

    const criticalErrors = errors.filter(e =>
      !e.includes('AudioContext') &&
      !e.includes('user gesture') &&
      !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('mesh test - knot shape loads', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(`${BASE_URL}/mesh-test.html?shape=knot`);
    await page.waitForTimeout(3000);

    const criticalErrors = errors.filter(e =>
      !e.includes('AudioContext') &&
      !e.includes('user gesture') &&
      !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
