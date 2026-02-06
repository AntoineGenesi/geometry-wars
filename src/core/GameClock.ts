import type { Game } from './Game';

/**
 * Fixed-timestep game clock using the accumulator pattern.
 *
 * Physics runs at a constant 60 Hz regardless of display refresh rate.
 * The interpolation alpha allows rendering to produce smooth frames
 * between physics ticks.
 */
export class GameClock {
  /** Seconds per physics tick (1/60). */
  readonly fixedDeltaTime: number = 1 / 60;

  /** Maximum frame time clamp to prevent spiral of death (250 ms). */
  private readonly maxFrameTime: number = 0.25;

  /** Accumulated time waiting to be consumed by physics steps. */
  private accumulator: number = 0;

  /** Timestamp of the previous frame (seconds, from performance.now). */
  private previousTime: number = 0;

  /**
   * Interpolation factor in [0, 1] representing how far we are between
   * the last physics tick and the next one.  Used by the renderer to
   * interpolate visual positions for smoother display.
   */
  alpha: number = 0;

  /** Total elapsed game time in seconds (only advances while unpaused). */
  totalTime: number = 0;

  /** Reference to the owning game instance. */
  private readonly game: Game;

  /** Whether the clock has been started at least once. */
  private started: boolean = false;

  constructor(game: Game) {
    this.game = game;
  }

  /**
   * Reset the clock.  Call this when (re)starting the game loop so the
   * first frame does not produce a huge delta.
   */
  reset(): void {
    this.previousTime = performance.now() / 1000;
    this.accumulator = 0;
    this.alpha = 0;
    this.totalTime = 0;
    this.started = true;
  }

  /**
   * Called once per requestAnimationFrame.  Advances the accumulator by
   * the real elapsed wall-clock time (clamped), then runs as many
   * fixed-timestep physics updates as needed.
   *
   * @param currentTimeMs - The timestamp provided by requestAnimationFrame
   *                        (milliseconds since page load).
   * @returns The number of physics steps that were executed this frame.
   */
  tick(currentTimeMs: number): number {
    if (!this.started) {
      this.reset();
    }

    const currentTime = currentTimeMs / 1000;
    let frameTime = currentTime - this.previousTime;
    this.previousTime = currentTime;

    // Clamp to avoid spiral of death when the tab was backgrounded.
    if (frameTime > this.maxFrameTime) {
      frameTime = this.maxFrameTime;
    }

    this.accumulator += frameTime;

    let steps = 0;

    while (this.accumulator >= this.fixedDeltaTime) {
      this.game.fixedUpdate(this.fixedDeltaTime);
      this.accumulator -= this.fixedDeltaTime;
      this.totalTime += this.fixedDeltaTime;
      steps++;
    }

    // Alpha represents how far into the next tick we are -- useful for
    // interpolating positions in the render pass.
    this.alpha = this.accumulator / this.fixedDeltaTime;

    return steps;
  }
}
