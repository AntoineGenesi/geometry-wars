/**
 * Visual regression test for split-screen coordinate system fix (S13)
 *
 * This test verifies that DOM elements (HUD, KillTally, etc.) are positioned correctly
 * in split-screen mode. Without the fix, HUD elements were positioned using WebGL
 * coordinates (y-up) instead of DOM coordinates (y-down), causing them to appear
 * upside-down and creating the "four-player split at the bottom" bug.
 *
 * REGRESSION GUARD: This test should FAIL if the coordinate conversion is removed.
 */

import { PlaywrightTestRunner } from '../utils/test-runner.mjs';

const runner = new PlaywrightTestRunner({
  headless: true,
  slowMo: 0,
  timeout: 30000,
});

/**
 * Helper to check if an element is positioned within expected bounds
 */
function isWithinBounds(actual, expected, tolerance = 50) {
  return Math.abs(actual - expected) <= tolerance;
}

/**
 * Test 2-player split-screen HUD positioning
 */
async function test2PlayerHUDPositioning(page) {
  console.log('[Test] 2-player split-screen HUD positioning...');

  // Navigate to 2-player split-screen mode
  const url = 'http://localhost:3001/?mode=multiplayer&surface=sphere&players=2';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });

  // Wait for game to initialize
  await page.waitForTimeout(2000);

  // Check that single-player HUD is hidden
  const singlePlayerHUD = await page.$('#ui-overlay');
  const isHidden = await singlePlayerHUD?.evaluate(el =>
    getComputedStyle(el).display === 'none'
  );
  if (!isHidden) {
    throw new Error('Single-player HUD (#ui-overlay) should be hidden in split-screen mode');
  }
  console.log('  ✓ Single-player HUD is hidden');

  // Get viewport size
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const viewportWidth = await page.evaluate(() => window.innerWidth);

  // Check Player 1 HUD position (left half, full height)
  const p1HUD = await page.$('.viewport-hud[data-player="0"]');
  if (!p1HUD) {
    throw new Error('Player 1 HUD not found');
  }
  const p1Rect = await p1HUD.boundingBox();

  // P1 should be at top-left (x=0, y=0 in DOM coords)
  if (!isWithinBounds(p1Rect.x, 0, 20)) {
    throw new Error(`Player 1 HUD x position incorrect: ${p1Rect.x} (expected ~0)`);
  }
  if (!isWithinBounds(p1Rect.y, 0, 20)) {
    throw new Error(`Player 1 HUD y position incorrect: ${p1Rect.y} (expected ~0, top of screen)`);
  }
  console.log(`  ✓ Player 1 HUD positioned correctly (x=${p1Rect.x}, y=${p1Rect.y})`);

  // Check Player 2 HUD position (right half, full height)
  const p2HUD = await page.$('.viewport-hud[data-player="1"]');
  if (!p2HUD) {
    throw new Error('Player 2 HUD not found');
  }
  const p2Rect = await p2HUD.boundingBox();

  // P2 should be at top-right (x=width/2, y=0 in DOM coords)
  const expectedP2X = viewportWidth / 2;
  if (!isWithinBounds(p2Rect.x, expectedP2X, 20)) {
    throw new Error(`Player 2 HUD x position incorrect: ${p2Rect.x} (expected ~${expectedP2X})`);
  }
  if (!isWithinBounds(p2Rect.y, 0, 20)) {
    throw new Error(`Player 2 HUD y position incorrect: ${p2Rect.y} (expected ~0, top of screen)`);
  }
  console.log(`  ✓ Player 2 HUD positioned correctly (x=${p2Rect.x}, y=${p2Rect.y})`);

  console.log('[Test] 2-player HUD positioning: PASS ✓');
}

/**
 * Test 4-player split-screen HUD positioning
 */
async function test4PlayerHUDPositioning(page) {
  console.log('[Test] 4-player split-screen HUD positioning...');

  // Navigate to 4-player split-screen mode
  const url = 'http://localhost:3001/?mode=multiplayer&surface=sphere&players=4';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });

  // Wait for game to initialize
  await page.waitForTimeout(2000);

  // Get viewport size
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const viewportWidth = await page.evaluate(() => window.innerWidth);

  const halfWidth = viewportWidth / 2;
  const halfHeight = viewportHeight / 2;

  // Check all 4 player HUD positions
  const positions = [
    { player: 0, expectedX: 0, expectedY: 0, label: 'top-left' },
    { player: 1, expectedX: halfWidth, expectedY: 0, label: 'top-right' },
    { player: 2, expectedX: 0, expectedY: halfHeight, label: 'bottom-left' },
    { player: 3, expectedX: halfWidth, expectedY: halfHeight, label: 'bottom-right' },
  ];

  for (const pos of positions) {
    const hud = await page.$(`.viewport-hud[data-player="${pos.player}"]`);
    if (!hud) {
      throw new Error(`Player ${pos.player + 1} HUD not found`);
    }
    const rect = await hud.boundingBox();

    // REGRESSION GUARD: Without the fix, these positions would be inverted
    // (top players would appear at bottom, bottom players at top)
    if (!isWithinBounds(rect.x, pos.expectedX, 20)) {
      throw new Error(`P${pos.player + 1} HUD x position incorrect: ${rect.x} (expected ~${pos.expectedX})`);
    }
    if (!isWithinBounds(rect.y, pos.expectedY, 20)) {
      throw new Error(`P${pos.player + 1} HUD y position incorrect: ${rect.y} (expected ~${pos.expectedY}). This is the coordinate inversion bug!`);
    }
    console.log(`  ✓ Player ${pos.player + 1} HUD (${pos.label}) positioned correctly (x=${rect.x}, y=${rect.y})`);
  }

  console.log('[Test] 4-player HUD positioning: PASS ✓');
}

/**
 * Test that no HUD elements appear "at the bottom" in 2-player mode
 * This was the user's specific complaint
 */
async function testNoFourPlayerSplitInTwoPlayerMode(page) {
  console.log('[Test] Verify no four-player split appears in 2-player mode...');

  // Navigate to 2-player mode
  const url = 'http://localhost:3001/?mode=multiplayer&surface=sphere&players=2';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Count viewport HUD elements - should be exactly 2
  const hudCount = await page.$$eval('.viewport-hud', elements => elements.length);
  if (hudCount !== 2) {
    throw new Error(`Expected 2 HUD elements in 2-player mode, found ${hudCount}`);
  }
  console.log(`  ✓ Exactly 2 HUD elements present (not 4)`);

  // Check that no HUD elements are positioned in the bottom half when they shouldn't be
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const bottomHalfY = viewportHeight / 2;

  const hudsInBottomHalf = await page.$$eval('.viewport-hud', (elements, bottomY) => {
    return elements.filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.y > bottomY;
    }).length;
  }, bottomHalfY);

  if (hudsInBottomHalf > 0) {
    throw new Error(`Found ${hudsInBottomHalf} HUD elements in bottom half of screen in 2-player mode (should be 0)`);
  }
  console.log(`  ✓ No HUD elements incorrectly positioned in bottom half`);

  console.log('[Test] No spurious four-player elements: PASS ✓');
}

// Run all tests
async function runAllTests() {
  await runner.runTest('2-player HUD positioning', test2PlayerHUDPositioning);
  await runner.runTest('4-player HUD positioning', test4PlayerHUDPositioning);
  await runner.runTest('No four-player split in 2-player mode', testNoFourPlayerSplitInTwoPlayerMode);
}

runAllTests()
  .then(() => {
    console.log('\n✓ All split-screen coordinate tests passed');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n✗ Split-screen coordinate tests failed:', err.message);
    process.exit(1);
  });
