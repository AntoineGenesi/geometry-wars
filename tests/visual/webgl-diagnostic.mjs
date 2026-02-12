#!/usr/bin/env node
/**
 * WebGL Rendering Diagnostic Test
 *
 * Tests various Puppeteer launch flag combinations to find one that renders WebGL.
 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/diagnostic');
const BASE_URL = 'http://localhost:3014';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Test configurations to try
const configs = [
  {
    name: 'Current (SwiftShader)',
    args: [
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=640,360',
    ]
  },
  {
    name: 'SwiftShader + Ignore GPU Blocklist',
    args: [
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=640,360',
    ]
  },
  {
    name: 'SwiftShader + Disable GPU',
    args: [
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=640,360',
    ]
  },
  {
    name: 'ANGLE Desktop GL',
    args: [
      '--enable-webgl',
      '--use-gl=desktop',
      '--use-angle=gl',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=640,360',
    ]
  },
  {
    name: 'EGL + SwiftShader',
    args: [
      '--enable-webgl',
      '--use-gl=egl',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=640,360',
    ]
  },
];

async function analyzeScreenshot(buffer) {
  // Simple pixel analysis
  let blackPixels = 0;
  let whitePixels = 0;
  let coloredPixels = 0;
  const samples = 1000;

  for (let i = 0; i < samples; i++) {
    const idx = Math.floor((i / samples) * buffer.length);
    const val = buffer[idx];

    if (val < 10) blackPixels++;
    else if (val > 245) whitePixels++;
    else coloredPixels++;
  }

  return {
    blackPercent: (blackPixels / samples) * 100,
    whitePercent: (whitePixels / samples) * 100,
    coloredPercent: (coloredPixels / samples) * 100,
  };
}

async function testConfig(config) {
  console.log(`\n  Testing: ${config.name}`);
  console.log(`  Args: ${config.args.join(' ')}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: config.args,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });

  try {
    // Load the game
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(3000);

    // Check WebGL context
    const webglInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { error: 'No canvas found' };

      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return { error: 'No WebGL context' };

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown',
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown',
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      };
    });

    console.log(`    WebGL Info:`);
    console.log(`      Renderer: ${webglInfo.renderer || webglInfo.error}`);
    console.log(`      Vendor: ${webglInfo.vendor || ''}`);
    console.log(`      Version: ${webglInfo.version || ''}`);

    // Take screenshot
    const safeName = config.name.replace(/[^a-zA-Z0-9]/g, '-');
    const screenshotPath = `${SCREENSHOT_DIR}/${safeName}.png`;
    const buffer = await page.screenshot({ encoding: 'binary' });
    writeFileSync(screenshotPath, buffer);

    // Analyze screenshot
    const analysis = analyzeScreenshot(buffer);
    console.log(`    Screenshot Analysis:`);
    console.log(`      Black: ${analysis.blackPercent.toFixed(1)}%`);
    console.log(`      White: ${analysis.whitePercent.toFixed(1)}%`);
    console.log(`      Colored: ${analysis.coloredPercent.toFixed(1)}%`);
    console.log(`      Saved: ${screenshotPath}`);

    // Check canvas content via JS
    const canvasContent = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { error: 'No canvas' };

      try {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        let nonZero = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 0 || data[i+1] > 0 || data[i+2] > 0) {
            nonZero++;
          }
        }

        return {
          width: canvas.width,
          height: canvas.height,
          nonZeroPixels: nonZero,
          totalPixels: canvas.width * canvas.height,
          percent: ((nonZero / (canvas.width * canvas.height)) * 100).toFixed(2),
        };
      } catch (e) {
        return { error: e.message };
      }
    });

    if (canvasContent.error) {
      console.log(`    Canvas Content: ${canvasContent.error}`);
    } else {
      console.log(`    Canvas Content: ${canvasContent.nonZeroPixels}/${canvasContent.totalPixels} non-zero pixels (${canvasContent.percent}%)`);
    }

    // Verdict
    const hasColor = analysis.coloredPercent > 10 || (canvasContent.percent && parseFloat(canvasContent.percent) > 10);
    const isBlank = analysis.blackPercent > 80 || analysis.whitePercent > 80;

    if (hasColor && !isBlank) {
      console.log(`    ✓ PASS: Screenshot contains rendered content`);
      return { config, success: true, webglInfo, analysis, canvasContent };
    } else {
      console.log(`    ✗ FAIL: Screenshot is blank or lacks rendered content`);
      return { config, success: false, webglInfo, analysis, canvasContent };
    }

  } catch (error) {
    console.log(`    ERROR: ${error.message}`);
    return { config, success: false, error: error.message };
  } finally {
    await browser.close();
  }
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log('='.repeat(70));
  console.log('  WebGL Rendering Diagnostic Test');
  console.log('  Testing multiple Puppeteer configurations');
  console.log('='.repeat(70));
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Chrome: ${CHROME_PATH}`);
  console.log(`  Screenshots: ${SCREENSHOT_DIR}/`);

  // Check dev server
  try {
    const resp = await fetch(BASE_URL, { signal: AbortSignal.timeout(3000) });
    console.log(`  Dev server: OK (status ${resp.status})`);
  } catch {
    console.error(`\n  ERROR: Dev server not running at ${BASE_URL}`);
    console.error(`  Start it with: VITE_PORT=3014 npm run dev`);
    process.exit(1);
  }

  const results = [];

  for (const config of configs) {
    const result = await testConfig(config);
    results.push(result);
    await sleep(1000); // Small delay between tests
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('  SUMMARY');
  console.log('='.repeat(70));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  if (successful.length > 0) {
    console.log(`\n  ✓ Working configurations (${successful.length}):`);
    successful.forEach(r => {
      console.log(`    - ${r.config.name}`);
    });
  }

  if (failed.length > 0) {
    console.log(`\n  ✗ Failed configurations (${failed.length}):`);
    failed.forEach(r => {
      console.log(`    - ${r.config.name}`);
    });
  }

  // Write results JSON
  const resultsPath = `${SCREENSHOT_DIR}/diagnostic-results.json`;
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\n  Results saved: ${resultsPath}`);
  console.log(`  Screenshots saved: ${SCREENSHOT_DIR}/`);
  console.log('');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
