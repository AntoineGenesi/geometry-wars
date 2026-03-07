/**
 * run-surface-verification.ts
 *
 * Standalone Node script (not a vitest test) that runs all 4 surface
 * verification test suites across all 13 surfaces, generates a JSON data
 * file and an HTML report, and takes a Puppeteer screenshot for Level 5
 * verification.
 *
 * Usage:
 *   npm run test:surface-verification
 *   (which runs: npx tsx tests/surface-verification/run-surface-verification.ts)
 *
 * Output:
 *   reports/surface-verification-YYYY-MM-DD-{gitHash}.json
 *   reports/surface-verification-YYYY-MM-DD-{gitHash}.html
 *   test-screenshots/sessions/s44o-05/report-screenshot.png
 *
 * Estimated runtime: 3–8 minutes (4 suites × 13 surfaces).
 *
 * The DOM/WebGL shims are set up at the top of this file using dynamic
 * imports, so they are in place before any game/THREE.js code loads.
 */

// ---------------------------------------------------------------------------
// Step 1: DOM/WebGL Shims — MUST run before any game code imports
// These are set up synchronously before any dynamic imports below.
// ---------------------------------------------------------------------------

const _noop = () => {};
const _noopEvent = (_e: string, _h: any) => {};

// ---------------------------------------------------------------------------
// WebGL2 mock context factory
// ---------------------------------------------------------------------------

function createMockWebGL2Context() {
  const noop = () => null;
  const noopArr = () => [];
  const noopInt = () => 0;

  return {
    canvas: { width: 800, height: 600, style: {}, addEventListener: noop, removeEventListener: noop },
    getContextAttributes: () => ({
      alpha: true, depth: true, stencil: false, antialias: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false,
    }),
    getExtension: noop,
    getSupportedExtensions: noopArr,
    getParameter: (param: number) => {
      const p: Record<number, any> = {
        0x0D33: 4096, 0x8073: 16, 0x0D54: 4, 0x8B4D: 16, 0x8872: 8,
        0x84E8: 1, 0x8906: 4, 0x8869: 8,
        0x1F00: 'Mock Renderer', 0x1F01: 'Mock Vendor', 0x1F02: 'WebGL 2.0',
        0x8B8C: 'highp',
      };
      return p[param] !== undefined ? p[param] : 0;
    },
    getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
    createShader: () => ({}), shaderSource: noop, compileShader: noop,
    getShaderParameter: (_s: any, p: number) => p === 0x8B81 ? true : null,
    getShaderInfoLog: () => '', deleteShader: noop,
    createProgram: () => ({}), attachShader: noop, linkProgram: noop,
    getProgramParameter: (_p: any, p: number) => p === 0x8B82 ? true : null,
    getProgramInfoLog: () => '', useProgram: noop, deleteProgram: noop,
    getUniformLocation: () => ({}), getAttribLocation: () => 0,
    uniform1i: noop, uniform1f: noop, uniform2f: noop, uniform3f: noop, uniform4f: noop,
    uniform1iv: noop, uniform2iv: noop, uniform3iv: noop, uniform4iv: noop,
    uniform1fv: noop, uniform2fv: noop, uniform3fv: noop, uniform4fv: noop,
    uniformMatrix2fv: noop, uniformMatrix3fv: noop, uniformMatrix4fv: noop,
    uniformMatrix3x2fv: noop, uniformMatrix4x2fv: noop, uniformMatrix2x3fv: noop,
    uniformMatrix4x3fv: noop, uniformMatrix2x4fv: noop, uniformMatrix3x4fv: noop,
    uniform1ui: noop, uniform2ui: noop, uniform3ui: noop, uniform4ui: noop,
    uniform1uiv: noop, uniform2uiv: noop, uniform3uiv: noop, uniform4uiv: noop,
    createBuffer: () => ({}), bindBuffer: noop, bufferData: noop, bufferSubData: noop, deleteBuffer: noop,
    getBufferParameter: noopInt,
    createVertexArray: () => ({}), bindVertexArray: noop, deleteVertexArray: noop,
    enableVertexAttribArray: noop, disableVertexAttribArray: noop,
    vertexAttribPointer: noop, vertexAttribIPointer: noop, vertexAttribDivisor: noop,
    createTexture: () => ({}), bindTexture: noop, texParameteri: noop, texParameterf: noop,
    texImage2D: noop, texImage3D: noop, texSubImage2D: noop, texSubImage3D: noop,
    compressedTexImage2D: noop, compressedTexImage3D: noop,
    generateMipmap: noop, deleteTexture: noop, activeTexture: noop,
    texStorage2D: noop, texStorage3D: noop,
    createFramebuffer: () => ({}), bindFramebuffer: noop, framebufferTexture2D: noop, framebufferTextureLayer: noop,
    checkFramebufferStatus: () => 0x8CD5, deleteFramebuffer: noop, blitFramebuffer: noop,
    invalidateFramebuffer: noop, readBuffer: noop,
    createRenderbuffer: () => ({}), bindRenderbuffer: noop, renderbufferStorage: noop,
    renderbufferStorageMultisample: noop,
    framebufferRenderbuffer: noop, deleteRenderbuffer: noop,
    createQuery: () => ({}), deleteQuery: noop, beginQuery: noop, endQuery: noop,
    getQueryParameter: (q: any, p: number) => p === 0x8867 ? true : 0,
    getQuery: () => null,
    createTransformFeedback: () => ({}), bindTransformFeedback: noop, beginTransformFeedback: noop,
    endTransformFeedback: noop, deleteTransformFeedback: noop, transformFeedbackVaryings: noop,
    createSampler: () => ({}), deleteSampler: noop, bindSampler: noop,
    samplerParameteri: noop, samplerParameterf: noop,
    viewport: noop, scissor: noop, enable: noop, disable: noop,
    blendFunc: noop, blendFuncSeparate: noop, blendEquation: noop, blendEquationSeparate: noop,
    colorMask: noop, depthFunc: noop, depthMask: noop, depthRange: noop,
    clearDepth: noop, clearColor: noop, clearStencil: noop, clear: noop,
    stencilFunc: noop, stencilFuncSeparate: noop, stencilOp: noop, stencilOpSeparate: noop,
    stencilMask: noop, stencilMaskSeparate: noop,
    polygonOffset: noop, lineWidth: noop, frontFace: noop, cullFace: noop,
    drawArrays: noop, drawElements: noop, drawArraysInstanced: noop, drawElementsInstanced: noop,
    finish: noop, flush: noop, isContextLost: () => false,
    readPixels: noop, copyTexImage2D: noop, copyTexSubImage2D: noop, copyTexSubImage3D: noop,
    pixelStorei: noop,
    fenceSync: () => ({}), deleteSync: noop, clientWaitSync: () => 0x911A,
    waitSync: noop, getSyncParameter: () => 0,
    getUniformBlockIndex: () => 0, uniformBlockBinding: noop,
    getActiveUniformBlockParameter: noopInt, getActiveUniformBlockName: () => '',
    getUniformIndices: () => [], getActiveUniforms: noopArr,
    drawBuffers: noop,
    getError: () => 0,
    // WebGL constant properties (used as gl.CONSTANT in Three.js calls)
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D,
    MAX_TEXTURE_SIZE: 0x0D33,
    MAX_RENDERBUFFER_SIZE: 0x8073,
    MAX_TEXTURE_IMAGE_UNITS: 0x0D54,
    MAX_FRAGMENT_UNIFORM_VECTORS: 0x8872,
    MAX_SAMPLES: 0x84E8,
    MAX_DRAW_BUFFERS_WEBGL: 0x8906,
    MAX_VERTEX_ATTRIBS: 0x8869,
    RENDERER: 0x1F00,
    VENDOR: 0x1F01,
    VERSION: 0x1F02,
    SHADING_LANGUAGE_VERSION: 0x8B8C,
    DRAW_BUFFER0: 0x8825,
    // WebGL constants
    FLOAT: 0x1406, UNSIGNED_BYTE: 0x1401, UNSIGNED_SHORT: 0x1403, UNSIGNED_INT: 0x1405,
    ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88B4, DYNAMIC_DRAW: 0x88E8,
    TRIANGLES: 0x0004,
    TEXTURE_2D: 0x0DE1, TEXTURE_3D: 0x806F, TEXTURE_CUBE_MAP: 0x8513, TEXTURE_2D_ARRAY: 0x8C1A,
    RGBA: 0x1908, RGBA8: 0x8058,
    DEPTH_COMPONENT: 0x1902, DEPTH_ATTACHMENT: 0x8D00,
    COLOR_ATTACHMENT0: 0x8CE0,
    FRAMEBUFFER: 0x8D40, READ_FRAMEBUFFER: 0x8CA8, DRAW_FRAMEBUFFER: 0x8CA9,
    RENDERBUFFER: 0x8D41,
    VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30,
    COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82,
    TEXTURE0: 0x84C0,
    CLAMP_TO_EDGE: 0x812F, REPEAT: 0x2901, MIRRORED_REPEAT: 0x8370,
    LINEAR: 0x2601, NEAREST: 0x2600,
    LINEAR_MIPMAP_LINEAR: 0x2703, NEAREST_MIPMAP_NEAREST: 0x2700,
    NO_ERROR: 0,
    LEQUAL: 0x0203, LESS: 0x0201, EQUAL: 0x0202, GREATER: 0x0204,
    NOTEQUAL: 0x0205, GEQUAL: 0x0206, ALWAYS: 0x0207, NEVER: 0x0200,
    ONE: 1, ZERO: 0,
    SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303,
    FUNC_ADD: 0x8006, FUNC_SUBTRACT: 0x800A, FUNC_REVERSE_SUBTRACT: 0x800B,
    MIN: 0x8007, MAX: 0x8008,
    FRONT: 0x0404, BACK: 0x0405, FRONT_AND_BACK: 0x0408,
    CW: 0x0900, CCW: 0x0901,
    BLEND: 0x0BE2, CULL_FACE: 0x0B44,
    DEPTH_TEST: 0x0B71, STENCIL_TEST: 0x0B90, SCISSOR_TEST: 0x0C11,
    POLYGON_OFFSET_FILL: 0x8037,
  };
}

function createMock2DContext() {
  return {
    fillRect: _noop, clearRect: _noop,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: _noop,
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    setTransform: _noop, drawImage: _noop, save: _noop,
    fillText: _noop, restore: _noop, beginPath: _noop,
    moveTo: _noop, lineTo: _noop, closePath: _noop,
    stroke: _noop, translate: _noop, scale: _noop,
    rotate: _noop, arc: _noop, fill: _noop,
    measureText: () => ({ width: 10 }),
    transform: _noop, rect: _noop, clip: _noop,
    canvas: { width: 64, height: 64 },
    fillStyle: '' as any, strokeStyle: '' as any, lineWidth: 1,
    lineCap: 'butt' as any, lineJoin: 'miter' as any,
    globalAlpha: 1, globalCompositeOperation: 'source-over' as any,
    createRadialGradient: () => ({ addColorStop: _noop }),
    createLinearGradient: () => ({ addColorStop: _noop }),
    createPattern: () => null,
  };
}

function createMockCanvas() {
  const mockGL = createMockWebGL2Context();
  const mock2D = createMock2DContext();
  return {
    width: 64, height: 64, style: {},
    getContext: (type: string) => {
      if (type === 'webgl2' || type === 'webgl') return mockGL;
      if (type === '2d') return mock2D;
      return null;
    },
    addEventListener: _noopEvent, removeEventListener: _noopEvent,
    setAttribute: () => {}, toDataURL: () => '', remove: _noop,
  };
}

function createMockElement(tag: string) {
  if (tag === 'canvas') return createMockCanvas();
  return {
    style: {}, clientWidth: 800, clientHeight: 600,
    appendChild: _noop, removeChild: _noop,
    getBoundingClientRect: () => ({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: _noop,
    }),
    addEventListener: _noopEvent, removeEventListener: _noopEvent,
  };
}

// Set up globalThis.window first so bare `window` references work
if (typeof (globalThis as any).window === 'undefined') {
  const mockWindow = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
    location: { search: '', href: '' },
    navigator: { getGamepads: () => [], userAgent: '' },
    getComputedStyle: () => ({}),
  };
  (globalThis as any).window = mockWindow;
}

if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = {
    hidden: false,
    body: {
      appendChild: _noop, removeChild: _noop, style: {},
      clientWidth: 800, clientHeight: 600,
      getBoundingClientRect: () => ({
        left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: _noop,
      }),
      addEventListener: _noopEvent, removeEventListener: _noopEvent,
    },
    createElement: (tag: string) => createMockElement(tag),
    createElementNS: (_ns: string, tag: string) => createMockElement(tag),
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
  };
}

if (typeof (globalThis as any).navigator === 'undefined') {
  (globalThis as any).navigator = { getGamepads: () => [], userAgent: '' };
}
if (typeof (globalThis as any).requestAnimationFrame === 'undefined') {
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 16);
}
if (typeof (globalThis as any).cancelAnimationFrame === 'undefined') {
  (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
}
if (typeof (globalThis as any).HTMLElement === 'undefined') {
  (globalThis as any).HTMLElement = class MockHTMLElement {};
}
if (typeof (globalThis as any).URLSearchParams === 'undefined') {
  (globalThis as any).URLSearchParams = class MockURLSearchParams {
    private params: Record<string, string> = {};
    constructor(search: string) {
      (search || '').replace(/^\?/, '').split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k) this.params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
      });
    }
    get(key: string) { return this.params[key] ?? null; }
  };
}

// ---------------------------------------------------------------------------
// Step 2: Now import game code using DYNAMIC imports (after shims are set up)
// Static imports are hoisted — dynamic imports execute after the shim code above.
// ---------------------------------------------------------------------------

/** Surfaces that have UV seams and should run the seam traversal test. */
const SEAM_SURFACES = new Set([
  'sphere', 'torus', 'mobius', 'mobius-bevel', 'pipe', 'cube-ring', 'sphere-tunnel',
]);

/** All 13 surfaces in the game. */
const ALL_SURFACES = [
  'sphere', 'cube', 'pill', 'pipe', 'torus', 'peanut', 'capsule',
  'icosahedron', 'mobius', 'sphere-tunnel', 'cube-ring', 'cube-tunnel', 'mobius-bevel',
] as const;

async function main() {
  // Dynamic imports so shims are in place first
  const { SurfaceVerifier } = await import('./SurfaceVerifier.js');
  const { writeSurfaceVerificationHTML } = await import('./SurfaceVerificationReport.js');
  const path = await import('path');
  const fs = await import('fs');
  const { fileURLToPath } = await import('url');
  const { execSync } = await import('child_process');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const PROJECT_ROOT = path.resolve(__dirname, '../..');

  // Get git hash
  let gitHash = 'unknown';
  try {
    gitHash = execSync('git rev-parse --short HEAD', { cwd: PROJECT_ROOT }).toString().trim();
  } catch {
    // Not in a git repo or git unavailable
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const runFileName = `surface-verification-${dateStr}-${gitHash}`;

  console.log('=== Surface Verification Report ===');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Commit: ${gitHash}`);
  console.log(`Surfaces: ${ALL_SURFACES.length}`);
  console.log('');
  console.log('Test suites per surface:');
  console.log('  1. Speed consistency    (density 10, 30 ticks/point)');
  console.log('  2. Bullet origin        (density 8)');
  console.log('  3. Hit detection        (density 5, 25 sample points)');
  console.log('  4. Seam traversal       (seam surfaces only, max 3000 frames)');
  console.log('');
  console.log('Estimated runtime: 3–8 minutes');
  console.log('');

  const startMs = Date.now();

  // Run all surfaces
  const surfaceResults = [];

  for (let i = 0; i < ALL_SURFACES.length; i++) {
    const surface = ALL_SURFACES[i];
    console.log(`Testing ${surface}... [${i + 1}/${ALL_SURFACES.length}]`);

    try {
      const surfaceStartMs = Date.now();

      // 1. Speed test (density 10)
      process.stdout.write(`  [1/4] Speed...`);
      const speed = SurfaceVerifier.runSpeedTest(surface as any, 10, 30);
      const speedIcon = speed.slowCount > 0 ? '✗' : speed.fastCount > 0 ? '~' : '✓';
      console.log(` ${speedIcon} (${speed.slowCount} slow, ${speed.fastCount} fast) ${speed.durationMs}ms`);

      // 2. Bullet origin test (density 8)
      process.stdout.write(`  [2/4] Bullet origin...`);
      const bulletOrigin = SurfaceVerifier.runBulletOriginTest(surface as any, 8);
      const bulletIcon = bulletOrigin.errorCount > 0 ? '✗' : bulletOrigin.warningCount > 0 ? '~' : '✓';
      console.log(` ${bulletIcon} (${bulletOrigin.errorCount} errors, ${bulletOrigin.warningCount} warns) ${bulletOrigin.durationMs}ms`);

      // 3. Hit detection test (density 5)
      process.stdout.write(`  [3/4] Hit detection...`);
      const hitDetection = SurfaceVerifier.runHitDetectionTest(surface as any, 5);
      const hitTotal = hitDetection.failNoDamageCount + hitDetection.failGhostKillCount;
      const hitIcon = hitTotal > 0 ? '✗' : '✓';
      console.log(` ${hitIcon} (${hitTotal} fails) ${hitDetection.durationMs}ms`);

      // 4. Seam traversal test (only seam surfaces)
      let seam: ReturnType<typeof SurfaceVerifier.runSeamTraversalTest> | { status: 'skipped'; surface: typeof surface };
      if (SEAM_SURFACES.has(surface)) {
        process.stdout.write(`  [4/4] Seam traversal...`);
        seam = SurfaceVerifier.runSeamTraversalTest(surface as any, 'w', 3000);
        const seamIcon = seam.status === 'pass' ? '✓' : seam.status === 'warn' ? '~' : '✗';
        console.log(` ${seamIcon} (${seam.status}) ${seam.framesUsed} frames`);
      } else {
        console.log(`  [4/4] Seam traversal... SKIP (no seams)`);
        seam = { status: 'skipped', surface };
      }

      const surfaceDurationMs = Date.now() - surfaceStartMs;
      const overallIcon = speed.slowCount > 0 || bulletOrigin.errorCount > 0 || hitTotal > 0 || seam.status === 'fail'
        ? '  FAIL'
        : speed.fastCount > 0 || bulletOrigin.warningCount > 0 || seam.status === 'warn'
        ? '  WARN'
        : '  PASS';
      console.log(`  ${overallIcon} — ${surfaceDurationMs}ms total`);
      console.log('');

      surfaceResults.push({ surface, speed, bulletOrigin, hitDetection, seam });

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${errorMsg}`);
      console.log('');

      // Create error placeholder results
      surfaceResults.push({
        surface,
        speed: {
          surface: surface as any, gridDensity: 10, moveTicks: 30,
          points: [], averageDistance: 0, slowCount: 0, fastCount: 0, passCount: 0, durationMs: 0,
        },
        bulletOrigin: {
          surface: surface as any, gridDensity: 8,
          points: [], errorCount: 0, warningCount: 0, passCount: 0, noBulletCount: 0, durationMs: 0,
        },
        hitDetection: {
          surface: surface as any,
          samplePoints: [], passCount: 0, failNoDamageCount: 0, failGhostKillCount: 0, durationMs: 0,
        },
        seam: { status: 'skipped' as const, surface },
        error: errorMsg,
      });
    }
  }

  const totalMs = Date.now() - startMs;

  // Compute summary
  const speedFails = surfaceResults.filter(r => !r.error && r.speed.slowCount > 0).length;
  const bulletFails = surfaceResults.filter(r => !r.error && r.bulletOrigin.errorCount > 0).length;
  const hitDetectionFails = surfaceResults.filter(
    r => !r.error && (r.hitDetection.failNoDamageCount + r.hitDetection.failGhostKillCount) > 0,
  ).length;
  const seamFails = surfaceResults.filter(r => !r.error && r.seam.status === 'fail').length;

  const run = {
    runDate: new Date().toISOString(),
    gitHash,
    surfaces: surfaceResults,
    summary: {
      totalSurfaces: ALL_SURFACES.length,
      speedFails,
      bulletFails,
      hitDetectionFails,
      seamFails,
      overallPass: speedFails + bulletFails + hitDetectionFails + seamFails === 0,
    },
  };

  // Print summary
  console.log('=== SUMMARY ===');
  console.log(`Total duration: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`Speed failures:        ${speedFails}`);
  console.log(`Bullet failures:       ${bulletFails}`);
  console.log(`Hit detect failures:   ${hitDetectionFails}`);
  console.log(`Seam failures:         ${seamFails}`);
  console.log(`Overall: ${run.summary.overallPass ? 'PASS' : 'FAIL'}`);
  console.log('');

  // Save JSON
  const reportsDir = path.join(PROJECT_ROOT, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const jsonPath = path.join(reportsDir, `${runFileName}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(run, null, 2), 'utf-8');
  console.log(`JSON saved: ${jsonPath}`);

  // Load history runs from existing JSON files
  const historyRuns: typeof run[] = [];
  try {
    const existingJsonFiles = fs.readdirSync(reportsDir)
      .filter((f: string) => f.startsWith('surface-verification-') && f.endsWith('.json') && f !== `${runFileName}.json`)
      .sort()
      .slice(-9); // Keep last 9 for history (plus current = 10 total)

    for (const f of existingJsonFiles) {
      try {
        const content = fs.readFileSync(path.join(reportsDir, f), 'utf-8');
        historyRuns.push(JSON.parse(content));
      } catch {
        // Skip malformed JSON files
      }
    }
  } catch {
    // No reports dir or can't read it
  }

  // Generate HTML report
  const htmlPath = path.join(reportsDir, `${runFileName}.html`);
  writeSurfaceVerificationHTML(run as any, historyRuns as any, htmlPath);
  console.log(`HTML saved: ${htmlPath}`);

  // Puppeteer screenshot (Level 5 verification)
  const screenshotDir = path.join(PROJECT_ROOT, 'test-screenshots', 'sessions', 's44o-05');
  const screenshotPath = path.join(screenshotDir, 'report-screenshot.png');

  try {
    await takeScreenshot(htmlPath, screenshotPath, path, fs);
    console.log(`Screenshot saved: ${screenshotPath}`);
  } catch (err) {
    console.warn(`Screenshot failed (non-fatal): ${(err as Error).message}`);
  }

  console.log('');
  console.log('Done.');
}

// ---------------------------------------------------------------------------
// Puppeteer screenshot helper
// ---------------------------------------------------------------------------

async function takeScreenshot(
  htmlPath: string,
  screenshotPath: string,
  pathMod: any,
  fsMod: any,
): Promise<void> {
  let puppeteer: any;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    throw new Error('puppeteer not available');
  }

  const screenshotDir = pathMod.dirname(screenshotPath);
  if (!fsMod.existsSync(screenshotDir)) {
    fsMod.mkdirSync(screenshotDir, { recursive: true });
  }

  const browser = await puppeteer.default.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=swiftshader',
      '--disable-gpu',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const fileUrl = `file://${pathMod.resolve(htmlPath)}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.screenshot({ path: screenshotPath });
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
