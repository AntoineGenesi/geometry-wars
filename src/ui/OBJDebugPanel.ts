/**
 * OBJDebugPanel — Debug-only UI for testing OBJ/GLTF model loading.
 *
 * Features:
 *  - File upload (.obj, .gltf, .glb)
 *  - Preset model URLs (Mixamo / simple OBJ)
 *  - Animation playback controls
 *  - Live performance metrics (FPS, triangles, memory)
 *  - Apply model to player or enemy geometry (visual replace)
 *
 * Only instantiated when ?debug=true is in the URL.
 */

import * as THREE from 'three';
import { OBJModelManager } from '../rendering/OBJModelManager';

// ---------------------------------------------------------------------------
// Preset models (CORS-friendly, no auth required)
// ---------------------------------------------------------------------------

interface PresetModel {
  name: string;
  url: string;
  format: 'obj' | 'gltf' | 'glb';
  description: string;
}

const PRESET_MODELS: PresetModel[] = [
  {
    name: 'Cube (OBJ)',
    url: 'data:text/plain;base64,' + btoa(`# Simple OBJ cube
v  1.0  1.0 -1.0
v  1.0 -1.0 -1.0
v  1.0  1.0  1.0
v  1.0 -1.0  1.0
v -1.0  1.0 -1.0
v -1.0 -1.0 -1.0
v -1.0  1.0  1.0
v -1.0 -1.0  1.0
f 1 5 7 3
f 4 3 7 8
f 8 7 5 6
f 6 2 4 8
f 2 1 3 4
f 6 5 1 2
`),
    format: 'obj',
    description: 'Simple 8-vertex cube — fastest possible OBJ test',
  },
  {
    name: 'Stanford Bunny (OBJ, small)',
    url: 'https://raw.githubusercontent.com/alecjacobson/common-3d-test-models/master/data/stanford-bunny.obj',
    format: 'obj',
    description: 'Classic test mesh ~70k triangles — tests polygon load',
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
          <h2>OBJ / GLTF Debug Loader</h2>
          <button id="obj-panel-close" class="obj-close-btn">✕</button>
        </div>

        <div class="obj-panel-body">

          <!-- Left: controls -->
          <div class="obj-controls">

            <section class="obj-section">
              <h3>Load Model</h3>
              <div class="obj-row">
                <label class="obj-label">From File</label>
                <input type="file" id="obj-file-input" accept=".obj,.gltf,.glb" />
              </div>
              <div class="obj-row">
                <label class="obj-label">Preset Models</label>
                <select id="obj-preset-select">
                  <option value="">— select preset —</option>
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

            <section class="obj-section">
              <h3>Status</h3>
              <p id="obj-status" class="obj-status-text">No model loaded</p>
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
                <p>• Data URIs always work (use preset cube)</p>
              </div>
            </section>
          </div>

          <!-- Right: 3D preview canvas -->
          <div class="obj-preview-area">
            <h3>3D Preview</h3>
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
    this.previewRenderer.setClearColor(0x080418);

    this.previewScene = new THREE.Scene();
    this.previewScene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 10, 5);
    this.previewScene.add(dirLight);

    // Grid for spatial reference
    const grid = new THREE.GridHelper(4, 10, 0x003333, 0x002222);
    this.previewScene.add(grid);

    this.previewCamera = new THREE.PerspectiveCamera(50, 420 / 380, 0.01, 1000);
    this.previewCamera.position.set(0, 2, 5);
    this.previewCamera.lookAt(0, 0, 0);

    // Orbit controls via mouse events
    this.attachOrbitControls(canvas);

    this.manager = new OBJModelManager(this.previewRenderer, this.previewScene);

    this.startRenderLoop();
  }

  // Simple orbit controls (no extra dependency needed)
  private orbitState = {
    dragging: false,
    lastX: 0,
    lastY: 0,
    theta: Math.PI / 4,
    phi: Math.PI / 3,
    radius: 5,
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
      this.manager?.update(dt);
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
  // Model loading
  // -------------------------------------------------------------------------

  private async loadModel(source: File | string): Promise<void> {
    if (!this.manager) return;

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
        // Remove old
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

  private setStatus(msg: string, type: 'loading' | 'ok' | 'error' | 'idle' = 'idle'): void {
    const el = this.container.querySelector('#obj-status') as HTMLElement;
    if (!el) return;
    el.textContent = msg;
    el.className = `obj-status-text obj-status-${type}`;
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
      background: rgba(0, 0, 0, 0.85);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Segoe UI', Arial, sans-serif;
    }
    #obj-debug-panel.hidden { display: none !important; }

    .obj-panel-inner {
      background: rgba(5, 3, 20, 0.97);
      border: 1px solid rgba(0, 255, 255, 0.3);
      border-radius: 8px;
      width: min(92vw, 960px);
      max-height: 90vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 0 40px rgba(0, 200, 255, 0.15);
    }

    .obj-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      border-bottom: 1px solid rgba(0, 255, 255, 0.1);
      background: rgba(0, 40, 60, 0.4);
    }
    .obj-panel-header h2 {
      margin: 0;
      color: #00ffff;
      font-size: 18px;
      letter-spacing: 3px;
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
      border-right: 1px solid rgba(0, 255, 255, 0.1);
    }

    .obj-section {
      margin-bottom: 20px;
    }
    .obj-section h3 {
      color: #88ffff;
      font-size: 12px;
      letter-spacing: 3px;
      margin: 0 0 10px;
      text-transform: uppercase;
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
      min-width: 80px;
    }

    #obj-debug-panel input[type="file"],
    #obj-debug-panel input[type="text"],
    #obj-debug-panel select {
      background: rgba(0, 30, 40, 0.8);
      border: 1px solid #006666;
      color: #00ffff;
      padding: 6px 10px;
      font: 12px monospace;
      flex: 1;
      min-width: 0;
    }
    #obj-debug-panel input[type="text"]:focus,
    #obj-debug-panel select:focus {
      border-color: #00ffff;
      outline: none;
    }

    .obj-btn {
      background: rgba(0, 80, 80, 0.5);
      border: 1px solid #00aaaa;
      color: #00ffff;
      padding: 6px 16px;
      font-size: 12px;
      cursor: pointer;
      letter-spacing: 1px;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .obj-btn:hover {
      background: rgba(0, 140, 140, 0.6);
      border-color: #00ffff;
      box-shadow: 0 0 10px rgba(0, 255, 255, 0.3);
    }

    .obj-status-text {
      margin: 0;
      font: 12px monospace;
      padding: 8px 10px;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.3);
    }
    .obj-status-loading { color: #ffcc44; }
    .obj-status-ok { color: #44ff88; }
    .obj-status-error { color: #ff4444; }
    .obj-status-idle { color: #668888; }

    .obj-info-table {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 16px;
      font: 12px monospace;
    }
    .obj-info-key { color: #88aaaa; }
    .obj-info-val { color: #00ffff; }

    .obj-perf-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 16px;
      font: 12px monospace;
    }
    .obj-perf-label { color: #88aaaa; }
    .obj-perf-grid span:not(.obj-perf-label) { color: #44ff88; }

    .obj-notes p {
      margin: 3px 0;
      font: 11px monospace;
      color: #557777;
    }

    .obj-preview-area {
      width: 440px;
      flex-shrink: 0;
      padding: 16px;
      display: flex;
      flex-direction: column;
    }
    .obj-preview-area h3 {
      color: #88ffff;
      font-size: 12px;
      letter-spacing: 3px;
      margin: 0 0 10px;
    }
    #obj-preview-canvas {
      border: 1px solid rgba(0, 255, 255, 0.15);
      display: block;
      background: #080418;
    }
    .obj-preview-hint {
      margin: 6px 0 0;
      font: 10px monospace;
      color: #446666;
      text-align: center;
    }
  `;
}
