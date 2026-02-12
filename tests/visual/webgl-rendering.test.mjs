#!/usr/bin/env node
/**
 * WebGL Rendering Regression Test
 *
 * Verifies that WebGL rendering works in headless Chrome with SwiftShader.
 * This test should PASS with the correct Puppeteer configuration and FAIL without it.
 *
 * Run: node tests/visual/webgl-rendering.test.mjs
 */
import puppeteer from 'puppeteer';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function testWebGLRendering() {
  console.log('Testing WebGL rendering in headless Chrome...');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=640,360',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });

  let passed = false;
  let error = null;

  try {
    // Load the game
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(3000);

    // Check 1: WebGL context exists
    const webglInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { error: 'No canvas found' };

      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return { error: 'No WebGL context' };

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown',
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown',
      };
    });

    if (webglInfo.error) {
      throw new Error(webglInfo.error);
    }

    // Check 2: SwiftShader is being used
    if (!webglInfo.renderer.includes('SwiftShader')) {
      throw new Error(`Expected SwiftShader renderer, got: ${webglInfo.renderer}`);
    }

    // Check 3: Screenshot is not blank
    const screenshot = await page.screenshot({ encoding: 'binary' });
    if (screenshot.length < 10000) {
      throw new Error('Screenshot is too small (likely blank)');
    }

    // Simple pixel variance check
    let variance = 0;
    for (let i = 0; i < Math.min(10000, screenshot.length - 1); i += 100) {
      variance += Math.abs(screenshot[i] - screenshot[i + 1]);
    }

    if (variance < 100) {
      throw new Error('Screenshot appears to be blank (no pixel variance)');
    }

    passed = true;
    console.log('  ✓ WebGL context exists');
    console.log(`  ✓ Renderer: ${webglInfo.renderer}`);
    console.log('  ✓ Screenshot contains content');

  } catch (err) {
    error = err.message;
    console.error(`  ✗ ${error}`);
  } finally {
    await browser.close();
  }

  return { passed, error };
}

// Main
(async () => {
  console.log('WebGL Rendering Regression Test');
  console.log(`Base URL: ${BASE_URL}\n`);

  const result = await testWebGLRendering();

  console.log('\n' + (result.passed ? '✓ PASS' : '✗ FAIL'));

  if (!result.passed) {
    console.log(`\nError: ${result.error}`);
    console.log('\nThis test verifies that Puppeteer can render WebGL in headless mode.');
    console.log('If it fails, check:');
    console.log('  1. Dev server is running at ' + BASE_URL);
    console.log('  2. Chrome is installed at ' + CHROME_PATH);
    console.log('  3. SwiftShader flags are correct');
    process.exit(1);
  }

  process.exit(0);
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
