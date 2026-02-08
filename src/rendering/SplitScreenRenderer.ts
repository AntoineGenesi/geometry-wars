/**
 * Split-screen renderer for local co-op.
 *
 * Manages viewport layout and sequential rendering for 2-4 players.
 * Skips EffectComposer (bloom) in favour of direct renderer.render()
 * with per-viewport scissor/viewport clipping. Emissive materials
 * still provide the neon glow look.
 */

import * as THREE from 'three';

export interface ViewportRect {
  /** Normalized 0-1 coordinates */
  x: number;
  y: number;
  w: number;
  h: number;
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

export class SplitScreenRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private cameras: THREE.PerspectiveCamera[] = [];
  private layout: ViewportRect[] = LAYOUTS[2];
  private width = 1;
  private height = 1;

  /** Optional callback invoked before rendering each viewport. */
  preRender: PreRenderCallback | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.width = renderer.domElement.clientWidth;
    this.height = renderer.domElement.clientHeight;
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
    // Update camera aspects
    for (let i = 0; i < this.cameras.length; i++) {
      const cam = this.cameras[i];
      if (!cam) continue;
      const vp = this.layout[i];
      if (!vp) continue;
      cam.aspect = (vp.w * w) / (vp.h * h);
      cam.updateProjectionMatrix();
    }
  }

  render(): void {
    const r = this.renderer;
    r.setScissorTest(true);

    // Clear full screen first (for divider gaps)
    r.setClearColor(DIVIDER_COLOR, 1);
    r.setViewport(0, 0, this.width, this.height);
    r.setScissor(0, 0, this.width, this.height);
    r.clear();

    // Render each viewport
    for (let i = 0; i < this.layout.length; i++) {
      const cam = this.cameras[i];
      if (!cam) continue;

      const vp = this.layout[i];
      const px = Math.floor(vp.x * this.width);
      const py = Math.floor(vp.y * this.height);
      const pw = Math.floor(vp.w * this.width);
      const ph = Math.floor(vp.h * this.height);

      // Inset by 1px for divider line between viewports
      const inset = this.layout.length > 1 ? 1 : 0;
      r.setViewport(px + inset, py + inset, pw - inset * 2, ph - inset * 2);
      r.setScissor(px + inset, py + inset, pw - inset * 2, ph - inset * 2);

      // Pre-render callback (e.g. set depth-based opacity per viewport)
      this.preRender?.(i, cam);

      r.render(this.scene, cam);
    }

    r.setScissorTest(false);
  }

  dispose(): void {
    this.cameras = [];
    this.preRender = null;
  }
}
