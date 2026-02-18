/**
 * Split-screen renderer for local co-op.
 *
 * Manages viewport layout and sequential rendering for 2-4 players.
 * Supports optional bloom via a two-phase approach:
 *   Phase 1: Render all viewports to an intermediate WebGLRenderTarget
 *   Phase 2: Apply UnrealBloomPass over the entire framebuffer
 * This gives all viewports the neon glow look with a single bloom pass.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { TexturePass } from 'three/addons/postprocessing/TexturePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export interface ViewportRect {
  /** Normalized 0-1 coordinates */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bloom configuration for split-screen. */
export interface SplitBloomConfig {
  strength: number;
  radius: number;
  threshold: number;
}

/** Callback invoked just before each viewport renders. */
export type PreRenderCallback = (playerIndex: number, camera: THREE.PerspectiveCamera) => void;

const LAYOUTS: Record<2 | 3 | 4, ViewportRect[]> = {
  2: [
    { x: 0, y: 0, w: 0.5, h: 1 },     // P1 left
    { x: 0.5, y: 0, w: 0.5, h: 1 },    // P2 right
  ],
  3: [
    { x: 0, y: 0.5, w: 0.5, h: 0.5 },    // P1 top-left
    { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },  // P2 top-right
    { x: 0.25, y: 0, w: 0.5, h: 0.5 },   // P3 bottom-center
  ],
  4: [
    { x: 0, y: 0.5, w: 0.5, h: 0.5 },    // P1 top-left
    { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },  // P2 top-right
    { x: 0, y: 0, w: 0.5, h: 0.5 },      // P3 bottom-left
    { x: 0.5, y: 0, w: 0.5, h: 0.5 },    // P4 bottom-right
  ],
};

/** Divider line color between viewports. */
const DIVIDER_COLOR = new THREE.Color(0x222244);

/** Vignette shader for split-screen (same as Game.ts single-player). */
const VIGNETTE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 1.0 },
    darkness: { value: 0.6 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - vec2(0.5)) * vec2(offset);
      float vignette = 1.0 - dot(uv, uv);
      texel.rgb *= mix(1.0 - darkness, 1.0, vignette);
      gl_FragColor = texel;
    }
  `,
};

export class SplitScreenRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly isWebGPU: boolean;
  private cameras: THREE.PerspectiveCamera[] = [];
  private layout: ViewportRect[] = LAYOUTS[2];
  private width = 1;
  private height = 1;

  // Bloom pipeline (optional, WebGL2 only)
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private composer: EffectComposer | null = null;

  /** Optional callback invoked before rendering each viewport. */
  preRender: PreRenderCallback | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, isWebGPU = false) {
    this.renderer = renderer;
    this.scene = scene;
    this.isWebGPU = isWebGPU;
    this.width = renderer.domElement.clientWidth;
    this.height = renderer.domElement.clientHeight;
  }

  /**
   * Enable bloom post-processing for split-screen.
   * Renders all viewports to an intermediate render target,
   * then applies bloom + vignette over the entire screen.
   *
   * NOTE: This uses WebGL-specific EffectComposer/WebGLRenderTarget.
   * When the renderer is WebGPU, bloom is skipped (direct render used instead).
   * WebGPU split-screen bloom requires TSL-based PostProcessing, which is a
   * future enhancement.
   */
  enableBloom(config: SplitBloomConfig): void {
    if (this.isWebGPU) {
      console.log('[SplitScreen] WebGPU active — split-screen bloom not yet supported, using direct render');
      return;
    }

    const w = Math.max(1, this.width);
    const h = Math.max(1, this.height);

    this.renderTarget = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    });

    this.composer = new EffectComposer(this.renderer);

    // TexturePass reads from the intermediate render target
    const texturePass = new TexturePass(this.renderTarget.texture);
    this.composer.addPass(texturePass);

    // Bloom pass
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      config.strength,
      config.radius,
      config.threshold,
    );
    this.composer.addPass(bloomPass);

    // Vignette pass (subtle, less than single-player since viewports are smaller)
    this.composer.addPass(new ShaderPass(VIGNETTE_SHADER));

    // Output pass
    this.composer.addPass(new OutputPass());
  }

  setLayout(playerCount: 2 | 3 | 4): void {
    this.layout = LAYOUTS[playerCount];
  }

  setCamera(index: number, camera: THREE.PerspectiveCamera): void {
    this.cameras[index] = camera;
  }

  /** Get the viewport rect (in normalized 0-1 coords) for a player index. */
  getViewport(index: number): ViewportRect {
    return this.layout[index] ?? { x: 0, y: 0, w: 1, h: 1 };
  }

  /** Get pixel-space viewport rect for a player. */
  getPixelViewport(index: number): { x: number; y: number; w: number; h: number } {
    const vp = this.getViewport(index);
    return {
      x: Math.floor(vp.x * this.width),
      y: Math.floor(vp.y * this.height),
      w: Math.floor(vp.w * this.width),
      h: Math.floor(vp.h * this.height),
    };
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    // Keep the underlying renderer canvas in sync with the split-screen dimensions.
    // (Game.ts resize handler is disabled via disableBuiltInResize=true in
    //  multiplayer-main.ts, so SplitScreenRenderer is the sole owner of canvas size.)
    this.renderer.setSize(w, h);
    // Update camera aspects
    for (let i = 0; i < this.cameras.length; i++) {
      const cam = this.cameras[i];
      if (!cam) continue;
      const vp = this.layout[i];
      if (!vp) continue;
      cam.aspect = (vp.w * w) / (vp.h * h);
      cam.updateProjectionMatrix();
    }
    // Resize bloom pipeline
    if (this.renderTarget) {
      this.renderTarget.setSize(w, h);
    }
    if (this.composer) {
      this.composer.setSize(w, h);
    }
  }

  render(): void {
    const r = this.renderer;

    if (this.renderTarget && this.composer) {
      this.renderWithBloom(r);
    } else {
      this.renderDirect(r);
    }
  }

  /** Render with bloom: all viewports → render target → bloom → screen. */
  private renderWithBloom(r: THREE.WebGLRenderer): void {
    // Phase 1: Render all viewports to intermediate render target
    const prevAutoClear = r.autoClear;
    r.setRenderTarget(this.renderTarget);
    r.setScissorTest(true);

    // Clear full RT (divider gaps)
    r.setClearColor(DIVIDER_COLOR, 1);
    r.setViewport(0, 0, this.width, this.height);
    r.setScissor(0, 0, this.width, this.height);
    r.clear();

    // Render each viewport to the render target
    for (let i = 0; i < this.layout.length; i++) {
      const cam = this.cameras[i];
      if (!cam) continue;

      const vp = this.layout[i];
      const px = Math.floor(vp.x * this.width);
      const py = Math.floor(vp.y * this.height);
      const pw = Math.floor(vp.w * this.width);
      const ph = Math.floor(vp.h * this.height);

      const inset = this.layout.length > 1 ? 1 : 0;
      r.setViewport(px + inset, py + inset, pw - inset * 2, ph - inset * 2);
      r.setScissor(px + inset, py + inset, pw - inset * 2, ph - inset * 2);

      this.preRender?.(i, cam);
      r.render(this.scene, cam);
    }

    r.setScissorTest(false);
    r.setRenderTarget(null);
    r.autoClear = prevAutoClear;

    // Phase 2: Apply bloom + vignette over entire screen.
    // CRITICAL: Reset viewport to full screen before the compositor runs.
    // After the per-viewport loop, the viewport is still set to the LAST player's
    // viewport (e.g. x=640, w=640 for P2 in a 2-player split). If not reset,
    // the EffectComposer's final OutputPass renders only to that partial viewport,
    // leaving the other half of the screen stuck at the clear color.
    r.setViewport(0, 0, this.width, this.height);

    // Phase 2: Apply bloom + vignette over entire screen
    this.composer!.render();
  }

  /** Render without bloom: direct to screen (original fallback). */
  private renderDirect(r: THREE.WebGLRenderer): void {
    r.setScissorTest(true);

    r.setClearColor(DIVIDER_COLOR, 1);
    r.setViewport(0, 0, this.width, this.height);
    r.setScissor(0, 0, this.width, this.height);
    r.clear();

    for (let i = 0; i < this.layout.length; i++) {
      const cam = this.cameras[i];
      if (!cam) continue;

      const vp = this.layout[i];
      const px = Math.floor(vp.x * this.width);
      const py = Math.floor(vp.y * this.height);
      const pw = Math.floor(vp.w * this.width);
      const ph = Math.floor(vp.h * this.height);

      const inset = this.layout.length > 1 ? 1 : 0;
      r.setViewport(px + inset, py + inset, pw - inset * 2, ph - inset * 2);
      r.setScissor(px + inset, py + inset, pw - inset * 2, ph - inset * 2);

      this.preRender?.(i, cam);
      r.render(this.scene, cam);
    }

    r.setScissorTest(false);
  }

  dispose(): void {
    this.cameras = [];
    this.preRender = null;
    if (this.renderTarget) {
      this.renderTarget.dispose();
      this.renderTarget = null;
    }
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
  }
}
