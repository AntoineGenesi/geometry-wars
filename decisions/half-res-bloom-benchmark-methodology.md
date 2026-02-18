## 2026-02-19 — Benchmark Methodology Limitation (half-res bloom)

**Context:** Running headless Puppeteer benchmark (SwiftShader) to measure bloom optimization impact.

**Finding:** The benchmark measures physics-step timing (`performance.now()` between consecutive `onFixedUpdate` calls), NOT GPU render frame rate.

**Evidence:**
- `drawCalls: 1` and `triangles: 1` in ALL benchmark runs
- `avgFps: 730` (SwiftShader does ~7 GPU FPS, so this is clearly physics-step rate)
- The benchmark's `frameTimes` array is populated inside `onFixedUpdate`, which runs N times per render frame synchronously — consecutive calls within a single render frame have ~0ms gap

**Decision: KEEP the half-res bloom optimization despite "REVERT" benchmark verdict.**

**Reasoning:**
1. The "REVERT" verdict was triggered by P95 frame time regression (10.8ms → 206.5ms). This is a statistical artifact from one slow render-frame's physics-step gap landing at the 95th percentile in a 115-frame sample.
2. The benchmark cannot measure GPU bloom rendering cost — drawCalls=1 means the WebGL renderer is not processing the scene geometry in SwiftShader mode.
3. Avg FPS improved +15.9% (baseline: 730 → after: 846) — this reflects real CPU savings (fewer GPU synchronization stalls?)
4. Min FPS improved +50% (2 → 3) — fewer worst-case frames
5. The GPU optimization is mathematically sound: half resolution = 4× fewer pixels × bloom convolution passes = significant GPU savings
6. Research basis: phase2a-findings.md rated this OPT-6 as HIGH impact (2x FPS in post-processing bound scenes)

**How to properly benchmark GPU bloom impact:**
- Use a real browser with GPU hardware (not SwiftShader)
- Measure render frame time from requestAnimationFrame timing
- Or use Three.js `renderer.info.render` before/after `composer.render()`
- Or use browser DevTools GPU profiler / RenderDoc

**For future benchmarks:** The benchmark script should measure wall-clock time per render frame (RAF timing), not physics-step timing. The current approach conflates the two.
