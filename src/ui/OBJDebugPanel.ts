/**
 * OBJDebugPanel — Debug-only UI for testing OBJ/GLTF model loading.
 *
 * Features:
 *  - Walking character demo (3 animated low-poly characters, auto-launched on open)
 *  - Per-character selection (Robot, Alien, Warrior)
 *  - File upload (.obj, .gltf, .glb)
 *  - Preset model URLs (local low-poly OBJ files)
 *  - Animation playback controls
 *  - Live performance metrics (FPS, triangles, memory)
 *
 * Only instantiated when ?debug=true is in the URL OR when F4 is pressed.
 */

import * as THREE from 'three';
import { OBJModelManager } from '../rendering/OBJModelManager';
import { WalkingDemo, type CharacterIndex } from './WalkingDemo';

// ---------------------------------------------------------------------------
// Preset models (local files — no CORS, always work)
// ---------------------------------------------------------------------------

interface PresetModel {
  name: string;
  url: string;
  format: 'obj' | 'gltf' | 'glb';
  description: string;
}

const PRESET_MODELS: PresetModel[] = [
  {
    name: 'Low-Poly Bunny',
    url: '/meshes/bunny.obj',
    format: 'obj',
    description: '500 faces — smooth low-poly rabbit',
  },
  {
    name: 'Cup (Ultra Low-Poly)',
    url: '/meshes/cup.obj',
    format: 'obj',
    description: '28 faces — ultra minimal cup shape',
  },
  {
    name: 'Torus Knot',
    url: '/meshes/knot.obj',
    format: 'obj',
    description: '8K faces — twisting knot shape',
  },
];

// ---------------------------------------------------------------------------
// OBJDebugPanel
// ---------------------------------------------------------------------------

export class OBJDebugPanel {
  private container: HTMLDivElement;
  private styleEl: HTMLStyleElement;
  private manager: OBJModelManager | null = null;
  private scene: THREE.Scene | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private animFrameId: number | null = null;
  private clock = new THREE.Clock();
  private previewRenderer: THREE.WebGLRenderer | null = null;
  private previewScene: THREE.Scene | null = null;
  private previewCamera: THREE.PerspectiveCamera | null = null;
  private previewModel: THREE.Object3D | null = null;
  private statusEl: HTMLParagraphElement | null = null;
  private perfEl: HTMLDivElement | null = null;
  private animListEl: HTMLSelectElement | null = null;
  private walkingDemo: WalkingDemo | null = null;
  private elapsedTime = 0;

  constructor() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = OBJDebugPanel.CSS;
    document.head.appendChild(this.styleEl);

    this.container = document.createElement('div');
    this.container.id = 'obj-debug-panel';
    this.container.className = 'hidden';
    this.container.innerHTML = this.buildHTML();
    document.body.appendChild(this.container);

    this.bindEvents();
  }

  // -------------------------------------------------------------------------
  // HTML
  // -------------------------------------------------------------------------

  private buildHTML(): string {
    const presets = PRESET_MODELS.map(
      (p, i) => `<option value="${i}">${p.name} — ${p.description}</option>`,
    ).join('');

    return `
      <div class="obj-panel-inner">
        <div class="obj-panel-header">
          <h2>MODEL DEMO</h2>
          <button id="obj-panel-close" class="obj-close-btn">✕</button>
        </div>

        <div class="obj-panel-body">

          <!-- Left: controls -->
          <div class="obj-controls">

            <section class="obj-section">
              <h3>Walking Characters</h3>
              <p class="obj-demo-desc">3 animated low-poly characters — click to isolate</p>
              <div class="obj-char-row">
                <button id="obj-char-all" class="obj-btn obj-btn-demo obj-char-active">ALL 3</button>
                <button id="obj-char-0" class="obj-btn obj-btn-robot">🤖 ROBOT</button>
                <button id="obj-char-1" class="obj-btn obj-btn-alien">👽 ALIEN</button>
                <button id="obj-char-2" class="obj-btn obj-btn-warrior">⚔ WARRIOR</button>
              </div>
            </section>

            <section class="obj-section">
              <h3>Load Model</h3>
              <div class="obj-row">
                <label class="obj-label">From File</label>
                <input type="file" id="obj-file-input" accept=".obj,.gltf,.glb" />
              </div>
              <div class="obj-row">
                <label class="obj-label">Preset</label>
                <select id="obj-preset-select">
                  <option value="">— select —</option>
                  ${presets}
                </select>
                <button id="obj-load-preset-btn" class="obj-btn">Load</button>
              </div>
              <div class="obj-row">
                <label class="obj-label">URL</label>
                <input type="text" id="obj-url-input" placeholder="https://... (.obj / .gltf / .glb)" />
                <button id="obj-load-url-btn" class="obj-btn">Load</button>
              </div>
            </section>

            <section class="obj-section" id="obj-model-info" style="display:none">
              <h3>Model Info</h3>
              <div id="obj-info-table" class="obj-info-table"></div>
            </section>

            <section class="obj-section" id="obj-anim-section" style="display:none">
              <h3>Animations</h3>
              <div class="obj-row">
                <select id="obj-anim-select">
                  <option value="">— select animation —</option>
                </select>
              </div>
              <div class="obj-row">
                <button id="obj-play-btn" class="obj-btn">▶ Play</button>
                <button id="obj-stop-btn" class="obj-btn">■ Stop</button>
              </div>
            </section>

            <section class="obj-section">
              <h3>Status</h3>
              <p id="obj-status" class="obj-status-text obj-status-ok">✓ Walking demo active — Robot · Alien · Warrior</p>
            </section>

            <section class="obj-section">
              <h3>Performance</h3>
              <div id="obj-perf" class="obj-perf-grid">
                <span class="obj-perf-label">FPS</span><span id="obj-fps">—</span>
                <span class="obj-perf-label">Frame time</span><span id="obj-ft">—</span>
                <span class="obj-perf-label">Geometries</span><span id="obj-geo">—</span>
                <span class="obj-perf-label">Textures</span><span id="obj-tex">—</span>
              </div>
            </section>

            <section class="obj-section">
              <h3>Notes</h3>
              <div class="obj-notes">
                <p>• OBJ: static geometry only (no animations)</p>
                <p>• GLTF/GLB: supports embedded animations</p>
                <p>• Mixamo exports as GLB — works directly</p>
                <p>• Cross-origin URLs require CORS headers</p>
              </div>
            </section>
          </div>

          <!-- Right: 3D preview canvas -->
          <div class="obj-preview-area">
            <h3>3D PREVIEW — GAME MAP</h3>
            <canvas id="obj-preview-canvas" width="420" height="380"></canvas>
            <p class="obj-preview-hint">Mouse: orbit (left-drag) | scroll: zoom</p>
          </div>

        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // Preview renderer setup
  // -------------------------------------------------------------------------

  private setupPreview(): void {
    const canvas = this.container.querySelector('#obj-preview-canvas') as HTMLCanvasElement;
    if (!canvas || this.previewRenderer) return;

    this.previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.previewRenderer.setSize(420, 380);
    this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.previewRenderer.setClearColor(0x020810);

    this.previewScene = new THREE.Scene();

    // Lighting: ambient + two directional lights for dramatic low-poly shading
    this.previewScene.add(new THREE.AmbientLight(0x223344, 0.8));
    const keyLight = new THREE.DirectionalLight(0xaaccff, 1.4);
    keyLight.position.set(3, 8, 4);
    this.previewScene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffcc88, 0.5);
    fillLight.position.set(-5, 2, -3);
    this.previewScene.add(fillLight);

    this.previewCamera = new THREE.PerspectiveCamera(50, 420 / 380, 0.01, 1000);
    this.previewCamera.position.set(0, 2, 5);
    this.previewCamera.lookAt(0, 0, 0);

    // Orbit controls via mouse events
    this.attachOrbitControls(canvas);

    this.manager = new OBJModelManager(this.previewRenderer, this.previewScene);

    this.startRenderLoop();

    // Auto-launch walking demo so user immediately sees animated characters
    this.activateWalkingDemo();
  }

  // Simple orbit controls (no extra dependency needed)
  private orbitState = {
    dragging: false,
    lastX: 0,
    lastY: 0,
    theta: Math.PI / 5,
    phi: Math.PI / 3.5,
    radius: 6,
  };

  private attachOrbitControls(canvas: HTMLCanvasElement): void {
    const s = this.orbitState;
    canvas.addEventListener('mousedown', (e) => {
      s.dragging = true;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!s.dragging) return;
      const dx = e.clientX - s.lastX;
      const dy = e.clientY - s.lastY;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.theta += dx * 0.005;
      s.phi = Math.max(0.1, Math.min(Math.PI - 0.1, s.phi + dy * 0.005));
      this.updateOrbit();
    });
    window.addEventListener('mouseup', () => { s.dragging = false; });
    canvas.addEventListener('wheel', (e) => {
      s.radius = Math.max(0.5, Math.min(20, s.radius + e.deltaY * 0.01));
      this.updateOrbit();
    });
  }

  private updateOrbit(): void {
    const s = this.orbitState;
    const x = s.radius * Math.sin(s.phi) * Math.sin(s.theta);
    const y = s.radius * Math.cos(s.phi);
    const z = s.radius * Math.sin(s.phi) * Math.cos(s.theta);
    this.previewCamera?.position.set(x, y, z);
    this.previewCamera?.lookAt(0, 0, 0);
  }

  private startRenderLoop(): void {
    const loop = () => {
      if (!this.previewRenderer || !this.previewScene || !this.previewCamera) return;
      this.animFrameId = requestAnimationFrame(loop);
      const dt = this.clock.getDelta();
      this.elapsedTime += dt;
      this.manager?.update(dt);
      this.walkingDemo?.update(this.elapsedTime);
      this.previewRenderer.render(this.previewScene, this.previewCamera);
      this.updatePerfDisplay();
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private stopRenderLoop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  // -------------------------------------------------------------------------
  // Walking demo activation
  // -------------------------------------------------------------------------

  private activateWalkingDemo(showCharIndex?: CharacterIndex): void {
    if (!this.previewScene) return;

    // Clear any loaded OBJ/GLB model
    if (this.previewModel) {
      this.previewScene.remove(this.previewModel);
      this.previewModel = null;
    }
    this.manager?.removeFromScene();

    // Create walking demo if not already running
    if (!this.walkingDemo) {
      this.elapsedTime = 0;
      this.walkingDemo = new WalkingDemo(this.previewScene);
    }

    // Apply character filter
    if (showCharIndex !== undefined) {
      this.walkingDemo.showOnly(showCharIndex);
      const names = ['Robot', 'Alien', 'Warrior'];
      const colors = ['#4488ff', '#44ff88', '#ff8844'];
      this.setStatus(`✓ ${names[showCharIndex]} — low-poly walking character`, 'ok', colors[showCharIndex]);
      this.updateCharButtons(showCharIndex);
    } else {
      this.walkingDemo.showAll();
      this.setStatus('✓ Walking demo active — Robot · Alien · Warrior', 'ok', '#00ffaa');
      this.updateCharButtons(-1);
    }

    // Reset camera to overview
    this.orbitState.radius = 6;
    this.orbitState.theta = Math.PI / 5;
    this.orbitState.phi = Math.PI / 3.5;
    this.updateOrbit();

    // Show demo stats
    const infoSection = this.container.querySelector('#obj-model-info') as HTMLElement;
    const tableEl = this.container.querySelector('#obj-info-table') as HTMLElement;
    if (infoSection && tableEl) {
      const rows = showCharIndex !== undefined
        ? [
          ['Character', ['Robot (blue)', 'Alien (green)', 'Warrior (orange)'][showCharIndex]],
          ['Polygons', ['~50 tris', '~60 tris', '~70 tris'][showCharIndex]],
          ['Animation', 'Sinusoidal walk cycle'],
          ['Vertex count', 'Procedural (no GLB)'],
        ]
        : [
          ['Characters', '3 (Robot · Alien · Warrior)'],
          ['Total polys', '~180 tris combined'],
          ['Animation', 'Sinusoidal walk cycle'],
          ['Frame cost', '<0.1ms (procedural)'],
        ];
      tableEl.innerHTML = rows.map(([k, v]) =>
        `<span class="obj-info-key">${k}</span><span class="obj-info-val">${v}</span>`,
      ).join('');
      infoSection.style.display = '';
    }

    // Hide animation controls (auto-playing, no manual clips)
    const animSection = this.container.querySelector('#obj-anim-section') as HTMLElement;
    if (animSection) animSection.style.display = 'none';
  }

  private updateCharButtons(activeIndex: number): void {
    const allBtn = this.container.querySelector('#obj-char-all') as HTMLButtonElement;
    const c0 = this.container.querySelector('#obj-char-0') as HTMLButtonElement;
    const c1 = this.container.querySelector('#obj-char-1') as HTMLButtonElement;
    const c2 = this.container.querySelector('#obj-char-2') as HTMLButtonElement;
    if (!allBtn || !c0 || !c1 || !c2) return;
    allBtn.classList.toggle('obj-char-active', activeIndex === -1);
    c0.classList.toggle('obj-char-active', activeIndex === 0);
    c1.classList.toggle('obj-char-active', activeIndex === 1);
    c2.classList.toggle('obj-char-active', activeIndex === 2);
  }

  // -------------------------------------------------------------------------
  // Model loading
  // -------------------------------------------------------------------------

  private async loadModel(source: File | string): Promise<void> {
    if (!this.manager) return;

    // Clear walking demo when loading a static model
    if (this.walkingDemo) {
      this.walkingDemo.dispose();
      this.walkingDemo = null;
    }

    this.updateCharButtons(-2);
    this.setStatus('Loading...', 'loading');

    try {
      let result;
      if (source instanceof File) {
        result = await this.manager.loadFromFile(source);
      } else {
        result = await this.manager.loadFromURL(source);
      }

      // Place in preview scene
      if (this.previewScene) {
        if (this.previewModel) {
          this.previewScene.remove(this.previewModel);
          this.previewModel = null;
        }
        this.previewModel = this.manager.applyToScene(new THREE.Vector3(0, 0, 0), 1);
      }

      this.showModelInfo(result);
      this.showAnimations(result.animations.map((a) => a.name));
      this.setStatus(
        `✓ Loaded ${result.format.toUpperCase()} — ${result.vertexCount.toLocaleString()} verts, ` +
        `${result.triangleCount.toLocaleString()} tris — in ${Math.round(result.loadTimeMs)}ms`,
        'ok',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus(`✗ Error: ${msg}`, 'error');
    }
  }

  private showModelInfo(result: { format: string; vertexCount: number; triangleCount: number; loadTimeMs: number; animations: THREE.AnimationClip[] }): void {
    const infoSection = this.container.querySelector('#obj-model-info') as HTMLElement;
    const tableEl = this.container.querySelector('#obj-info-table') as HTMLElement;
    if (!infoSection || !tableEl) return;

    const rows = [
      ['Format', result.format.toUpperCase()],
      ['Vertices', result.vertexCount.toLocaleString()],
      ['Triangles', result.triangleCount.toLocaleString()],
      ['Animations', result.animations.length.toString()],
      ['Load time', `${Math.round(result.loadTimeMs)}ms`],
    ];

    tableEl.innerHTML = rows.map(([k, v]) => `
      <span class="obj-info-key">${k}</span><span class="obj-info-val">${v}</span>
    `).join('');
    infoSection.style.display = '';
  }

  private showAnimations(names: string[]): void {
    const section = this.container.querySelector('#obj-anim-section') as HTMLElement;
    const select = this.container.querySelector('#obj-anim-select') as HTMLSelectElement;
    if (!section || !select) return;

    if (names.length === 0) {
      section.style.display = 'none';
      return;
    }

    select.innerHTML = `<option value="">— select animation —</option>` +
      names.map((n, i) => `<option value="${i}">${n || `Clip ${i}`}</option>`).join('');
    section.style.display = '';
  }

  private setStatus(msg: string, type: 'loading' | 'ok' | 'error' | 'idle' = 'idle', color?: string): void {
    const el = this.container.querySelector('#obj-status') as HTMLElement;
    if (!el) return;
    el.textContent = msg;
    el.className = `obj-status-text obj-status-${type}`;
    if (color) el.style.color = color;
    else el.style.color = '';
  }

  private updatePerfDisplay(): void {
    const perf = this.manager?.getCurrentPerf();
    if (!perf) return;
    const fps = this.container.querySelector('#obj-fps');
    const ft = this.container.querySelector('#obj-ft');
    const geo = this.container.querySelector('#obj-geo');
    const tex = this.container.querySelector('#obj-tex');
    if (fps) fps.textContent = String(perf.fps);
    if (ft) ft.textContent = `${perf.frameTimeMs}ms`;
    if (geo) geo.textContent = String(perf.memoryGeometries);
    if (tex) tex.textContent = String(perf.memoryTextures);
  }

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------

  private bindEvents(): void {
    const closeBtn = this.container.querySelector('#obj-panel-close');
    closeBtn?.addEventListener('click', () => this.hide());

    // Character selection buttons
    const allBtn = this.container.querySelector('#obj-char-all');
    allBtn?.addEventListener('click', () => this.activateWalkingDemo());

    const charBtns: Array<[string, CharacterIndex]> = [
      ['#obj-char-0', 0],
      ['#obj-char-1', 1],
      ['#obj-char-2', 2],
    ];
    for (const [selector, idx] of charBtns) {
      this.container.querySelector(selector)?.addEventListener('click', () => {
        this.activateWalkingDemo(idx);
      });
    }

    const fileInput = this.container.querySelector('#obj-file-input') as HTMLInputElement;
    fileInput?.addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) await this.loadModel(f);
      fileInput.value = '';
    });

    const loadUrlBtn = this.container.querySelector('#obj-load-url-btn');
    loadUrlBtn?.addEventListener('click', async () => {
      const input = this.container.querySelector('#obj-url-input') as HTMLInputElement;
      const url = input?.value.trim();
      if (url) await this.loadModel(url);
    });

    const loadPresetBtn = this.container.querySelector('#obj-load-preset-btn');
    loadPresetBtn?.addEventListener('click', async () => {
      const select = this.container.querySelector('#obj-preset-select') as HTMLSelectElement;
      const idx = parseInt(select?.value ?? '', 10);
      if (!isNaN(idx) && PRESET_MODELS[idx]) {
        await this.loadModel(PRESET_MODELS[idx].url);
      }
    });

    const playBtn = this.container.querySelector('#obj-play-btn');
    playBtn?.addEventListener('click', () => {
      const select = this.container.querySelector('#obj-anim-select') as HTMLSelectElement;
      const val = select?.value;
      if (val !== '' && val !== undefined) {
        this.manager?.playAnimation(parseInt(val, 10));
      }
    });

    const stopBtn = this.container.querySelector('#obj-stop-btn');
    stopBtn?.addEventListener('click', () => {
      this.manager?.stopAnimation();
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  show(): void {
    this.container.classList.remove('hidden');
    this.setupPreview();
  }

  hide(): void {
    this.container.classList.add('hidden');
    this.stopRenderLoop();
  }

  isVisible(): boolean {
    return !this.container.classList.contains('hidden');
  }

  dispose(): void {
    this.stopRenderLoop();
    this.walkingDemo?.dispose();
    this.walkingDemo = null;
    this.manager?.dispose();
    this.previewRenderer?.dispose();
    this.container.remove();
    this.styleEl.remove();
  }

  // -------------------------------------------------------------------------
  // CSS
  // -------------------------------------------------------------------------

  private static readonly CSS = `
    #obj-debug-panel {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.88);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Segoe UI', Arial, sans-serif;
    }
    #obj-debug-panel.hidden { display: none !important; }

    .obj-panel-inner {
      background: rgba(3, 5, 18, 0.98);
      border: 1px solid rgba(0, 255, 200, 0.3);
      border-radius: 8px;
      width: min(92vw, 960px);
      max-height: 90vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 0 40px rgba(0, 200, 255, 0.12), 0 0 80px rgba(0, 100, 200, 0.08);
    }

    .obj-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 24px;
      border-bottom: 1px solid rgba(0, 255, 200, 0.12);
      background: rgba(0, 30, 50, 0.5);
    }
    .obj-panel-header h2 {
      margin: 0;
      color: #00ffcc;
      font-size: 16px;
      letter-spacing: 4px;
      text-shadow: 0 0 10px rgba(0, 255, 200, 0.4);
    }
    .obj-close-btn {
      background: none;
      border: 1px solid #ff4444;
      color: #ff4444;
      width: 32px;
      height: 32px;
      cursor: pointer;
      font-size: 16px;
      border-radius: 4px;
      transition: all 0.2s;
    }
    .obj-close-btn:hover { background: #ff4444; color: #fff; }

    .obj-panel-body {
      display: flex;
      gap: 0;
      overflow: hidden;
      flex: 1;
    }

    .obj-controls {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
      border-right: 1px solid rgba(0, 255, 200, 0.08);
    }

    .obj-section {
      margin-bottom: 20px;
    }
    .obj-section h3 {
      color: #00ffcc;
      font-size: 10px;
      letter-spacing: 3px;
      margin: 0 0 8px;
      text-transform: uppercase;
      opacity: 0.7;
    }

    .obj-char-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .obj-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .obj-label {
      color: #88aaaa;
      font-size: 11px;
      letter-spacing: 1px;
      min-width: 60px;
    }

    #obj-debug-panel input[type="file"],
    #obj-debug-panel input[type="text"],
    #obj-debug-panel select {
      background: rgba(0, 20, 30, 0.8);
      border: 1px solid #005555;
      color: #00ffcc;
      padding: 5px 8px;
      font: 12px monospace;
      flex: 1;
      min-width: 0;
    }
    #obj-debug-panel input[type="text"]:focus,
    #obj-debug-panel select:focus {
      border-color: #00ffcc;
      outline: none;
    }

    .obj-btn {
      background: rgba(0, 60, 60, 0.5);
      border: 1px solid #008888;
      color: #00cccc;
      padding: 5px 12px;
      font-size: 11px;
      cursor: pointer;
      letter-spacing: 1px;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .obj-btn:hover {
      background: rgba(0, 100, 100, 0.6);
      border-color: #00ffcc;
      color: #00ffcc;
    }
    .obj-char-active {
      background: rgba(0, 120, 100, 0.6) !important;
      border-color: #00ffaa !important;
      color: #00ffaa !important;
      box-shadow: 0 0 8px rgba(0, 255, 160, 0.3);
    }

    .obj-btn-demo {
      background: rgba(0, 80, 60, 0.5);
      border-color: #00ff88;
      color: #00ff88;
    }
    .obj-btn-robot {
      background: rgba(0, 30, 80, 0.5);
      border-color: #4488ff;
      color: #88aaff;
    }
    .obj-btn-alien {
      background: rgba(0, 60, 30, 0.5);
      border-color: #44ff88;
      color: #88ffaa;
    }
    .obj-btn-warrior {
      background: rgba(80, 40, 0, 0.5);
      border-color: #ff8844;
      color: #ffaa66;
    }

    .obj-status-text {
      margin: 0;
      font: 11px monospace;
      padding: 6px 8px;
      border-radius: 3px;
      background: rgba(0, 0, 0, 0.3);
    }
    .obj-status-loading { color: #ffcc44; }
    .obj-status-ok { color: #44ff88; }
    .obj-status-error { color: #ff4444; }
    .obj-status-idle { color: #668888; }

    .obj-info-table {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 3px 12px;
      font: 11px monospace;
    }
    .obj-info-key { color: #668888; }
    .obj-info-val { color: #00cccc; }

    .obj-perf-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 3px 12px;
      font: 11px monospace;
    }
    .obj-perf-label { color: #668888; }
    .obj-perf-grid span:not(.obj-perf-label) { color: #44ff88; }

    .obj-notes p {
      margin: 2px 0;
      font: 10px monospace;
      color: #446666;
    }

    .obj-demo-desc {
      margin: 0 0 8px;
      font: 10px monospace;
      color: #559977;
    }

    .obj-preview-area {
      width: 440px;
      flex-shrink: 0;
      padding: 16px;
      display: flex;
      flex-direction: column;
    }
    .obj-preview-area h3 {
      color: #00ffcc;
      font-size: 10px;
      letter-spacing: 3px;
      margin: 0 0 8px;
      opacity: 0.7;
    }
    #obj-preview-canvas {
      border: 1px solid rgba(0, 255, 200, 0.15);
      display: block;
      background: #020810;
      border-radius: 3px;
    }
    .obj-preview-hint {
      margin: 5px 0 0;
      font: 10px monospace;
      color: #334455;
      text-align: center;
    }
  `;
}
