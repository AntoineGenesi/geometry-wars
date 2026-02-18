/**
 * GameStateExporter — Exposes window._gameState and window._rendererState for programmatic testing.
 *
 * Activated when ?testMode=true in the URL.
 * Updated every fixed-update frame so Puppeteer tests can poll it.
 *
 * Usage (Puppeteer):
 *   const state = await page.evaluate(() => window._gameState);
 *   console.log(state.walker.position); // {x, y, z}
 *
 * Usage (pixel reads, requires preserveDrawingBuffer):
 *   const pixel = await page.evaluate(() => window._rendererState.getPixel(100, 200));
 */

import type { GameContext } from '../core/GameContext';

// ---------------------------------------------------------------------------
// Serializable types (JSON-safe, no THREE objects)
// ---------------------------------------------------------------------------

interface Vec3 { x: number; y: number; z: number }
interface Quat { x: number; y: number; z: number; w: number }

export interface GameStateSnapshot {
  player: {
    position: Vec3;
    velocity: { u: number; v: number };
    surfaceUV: { u: number; v: number };
    orientation: Quat;
    alive: boolean;
    lives: number;
    score: number;
  };
  walker: {
    position: Vec3;
    normal: Vec3;
    tangent: Vec3;
    bitangent: Vec3;
    faceIndex: number;
  };
  camera: {
    position: Vec3;
    quaternion: Quat;
  };
  game: {
    /** Increments once per fixed-update tick. Use to detect new frames. */
    frameCount: number;
    gameTime: number;
    deltaTime: number;
    isPaused: boolean;
    isGameOver: boolean;
    surface: string;
    enemyCount: number;
  };
}

export interface RendererState {
  /** Read a single pixel at canvas coordinates. Requires preserveDrawingBuffer. */
  getPixel(x: number, y: number): { r: number; g: number; b: number; a: number };
  /** Canvas dimensions in CSS pixels. */
  getCanvasDimensions(): { width: number; height: number };
  /** Capture the current frame as a PNG data URL. */
  captureFrame(): string;
  /** Find all pixels that match a given RGB color within tolerance. */
  getPixelsOfColor(r: number, g: number, b: number, tolerance: number): { x: number; y: number }[];
}

// ---------------------------------------------------------------------------
// GameStateExporter
// ---------------------------------------------------------------------------

export class GameStateExporter {
  private frameCount = 0;
  private ctx: GameContext;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.initRendererState();
  }

  /** Call this once per fixed-update tick (from game.onFixedUpdate) */
  update(): void {
    const { ctx } = this;
    const { playerWalker, player, game, surfaceType, enemySpawner, state } = ctx;

    const wp = playerWalker.position;
    const wn = playerWalker.normal;
    const wt = playerWalker.tangent;
    const wb = playerWalker.bitangent;
    const mp = player.mesh.position;
    const mq = player.mesh.quaternion;

    (window as any)._gameState = {
      player: {
        position:   { x: mp.x, y: mp.y, z: mp.z },
        velocity:   { u: player.velocityU, v: player.velocityV },
        surfaceUV:  { u: player.surfaceU,  v: player.surfaceV  },
        orientation:{ x: mq.x, y: mq.y, z: mq.z, w: mq.w },
        alive:      player.alive,
        lives:      player.lives,
        score:      player.score,
      },
      walker: {
        position:  { x: wp.x, y: wp.y, z: wp.z },
        normal:    { x: wn.x, y: wn.y, z: wn.z },
        tangent:   { x: wt.x, y: wt.y, z: wt.z },
        bitangent: { x: wb.x, y: wb.y, z: wb.z },
        faceIndex: playerWalker.faceIndex,
      },
      camera: {
        position:   { x: game.camera.position.x,   y: game.camera.position.y,   z: game.camera.position.z   },
        quaternion: { x: game.camera.quaternion.x, y: game.camera.quaternion.y, z: game.camera.quaternion.z, w: game.camera.quaternion.w },
      },
      game: {
        frameCount: ++this.frameCount,
        gameTime:   game.clock.totalTime,
        deltaTime:  game.clock.fixedDeltaTime,
        isPaused:   state.isPaused,
        isGameOver: state.isGameOver,
        surface:    String(surfaceType),
        enemyCount: enemySpawner.getActiveCount(),
      },
    } satisfies GameStateSnapshot;
  }

  // ---- Renderer state (pixel reads) ----------------------------------------

  private initRendererState(): void {
    const canvas = this.ctx.game.renderer.domElement;
    // GL context for readPixels – requires preserveDrawingBuffer (set via ?testMode=true)
    const gl = canvas.getContext('webgl2') as WebGLRenderingContext | null
             ?? canvas.getContext('webgl') as WebGLRenderingContext | null;

    const rendererState: RendererState = {
      getPixel(x: number, y: number) {
        if (!gl) return { r: 0, g: 0, b: 0, a: 0 };
        const px = new Uint8Array(4);
        // WebGL Y-axis is bottom-up; flip for canvas convention
        gl.readPixels(x, canvas.height - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return { r: px[0], g: px[1], b: px[2], a: px[3] };
      },

      getCanvasDimensions() {
        return { width: canvas.width, height: canvas.height };
      },

      captureFrame() {
        return canvas.toDataURL('image/png');
      },

      getPixelsOfColor(r: number, g: number, b: number, tolerance: number) {
        const result: { x: number; y: number }[] = [];
        if (!gl) return result;
        const w = canvas.width;
        const h = canvas.height;
        const data = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            const i = (py * w + px) * 4;
            if (
              Math.abs(data[i]     - r) <= tolerance &&
              Math.abs(data[i + 1] - g) <= tolerance &&
              Math.abs(data[i + 2] - b) <= tolerance
            ) {
              result.push({ x: px, y: h - py - 1 }); // flip back to canvas coords
            }
          }
        }
        return result;
      },
    };

    (window as any)._rendererState = rendererState;
  }
}
