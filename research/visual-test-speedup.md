# Visual Test Speed-Up Research

**Date:** 2026-02-10
**Platform:** WSL2 on Windows 10 22H2 (Build 19045), NVIDIA RTX 2080 Ti
**Current runtime:** ~5 minutes for 23 visual tests
**Target:** Under 2 minutes, ideally under 1

---

## 1. GPU Availability Assessment

### Hardware Present
- **Host GPU:** NVIDIA GeForce RTX 2080 Ti (driver 27.21.14.5751)
- **`/dev/dxg`:** Present (DirectX GPU device exposed to WSL2)
- **`/dev/dri/`:** NOT present (no DRI render nodes)
- **Mesa d3d12_dri.so:** Installed at `/usr/lib/x86_64-linux-gnu/dri/d3d12_dri.so`
- **Vulkan libraries:** `libvulkan.so.1.2.131` + lavapipe (`libvulkan_lvp.so`)

### WSLg / GPU Passthrough Status
- **WSLg:** NOT active. `/mnt/wslg` does not exist. `$DISPLAY` and `$WAYLAND_DISPLAY` are unset.
- **nvidia-smi:** Fails ("couldn't communicate with NVIDIA driver")
- **Kernel:** 5.10.16.3-microsoft-standard-WSL2 (old; WSLg GPU support needs ~5.15+)
- **OS:** Ubuntu 20.04.6 LTS (Focal) -- older than typical WSLg setups
- **Windows Version:** 10.0.19045 = **Windows 10** 22H2 (NOT Windows 11 despite user belief). WSLg with full GPU support requires Windows 11 or a much newer WSL kernel.
- **systemd:** Present (v245) but not fully configured for GPU device mounting

### Chrome GPU Backend Test Results

| Configuration | Result |
|---|---|
| `--use-gl=swiftshader --use-angle=swiftshader` | **Works.** Renderer: SwiftShader Device (Subzero) |
| `--use-gl=angle --use-angle=gl` (Mesa OpenGL) | **No WebGL.** Renderer: NONE |
| `--use-angle=vulkan --enable-features=Vulkan` | **Hangs/timeout.** Navigation never completes |
| `--use-gl=egl --ignore-gpu-blocklist` | **Fails.** "Requested GL implementation not found" |

### Verdict: GPU Acceleration NOT Available

GPU acceleration is not possible on this WSL2 instance for these reasons:
1. **Windows 10** (not Windows 11) -- limited WSLg GPU support
2. **Old WSL kernel** (5.10 vs needed 5.15+) -- no GPU-PV integration
3. **No /dev/dri** -- no render nodes for Mesa/Vulkan to use
4. **No WSLg** -- no compositor to bridge GPU calls
5. **nvidia-smi broken** -- NVIDIA GPU driver not loaded in WSL2

**To enable GPU, the user would need to:**
1. Upgrade to Windows 11 (or latest Windows 10 Insider)
2. Run `wsl --update` to get kernel 5.15+
3. Ensure WSLg is installed and `/dev/dri/renderD128` appears
4. Possibly install newer Mesa (23.x+) with d3d12 backend fixes

This is a significant system change and outside the scope of a quick fix.

---

## 2. Measured Performance Data

### Game FPS at Different Resolutions (SwiftShader)

| Resolution | FPS | Relative Speed |
|---|---|---|
| 1280x720 (current) | 11.2 | 1x (baseline) |
| 640x360 | 30.8 | **2.75x faster** |
| 320x240 | 26.7 | 2.4x faster |

Key insight: **Halving the resolution nearly triples FPS.** The 320x240 result being slower than 640x360 likely reflects that at some point the bottleneck shifts from fill-rate to JS overhead/draw calls.

### Heavy Fragment Shader Benchmark (SwiftShader)

| Resolution | FPS |
|---|---|
| 1280x720 | 58.3 |
| 640x360 | 225.3 |
| 320x180 | 246.7 |

Pure fragment shading scales almost linearly with pixel count reduction.

### Browser Launch/Page Overhead

| Approach | Time for 2 page loads |
|---|---|
| Sequential (2 separate browsers) | 13.3s |
| Parallel (2 pages, 1 browser) | 7.5s |

Parallel pages in a single browser save ~44% on overhead.

---

## 3. Time Budget Analysis (Current)

Total sleep time in test code: **45,830ms (~46 seconds)**

The `startGameOnSurface()` function is called **19 times** and costs **9,500ms each**:
- `sleep(3000)` -- wait for page load
- `sleep(1500)` -- wait for click to register
- `sleep(5000)` -- wait for countdown + first render

That's 19 x 9,500 = **180,500ms = 3 minutes** just from `startGameOnSurface`.

Additional sleep time from test bodies: ~45 seconds.

Total estimated wall time: ~5 minutes (matches observed).

---

## 4. Recommended Speed-Up Strategies

### Strategy A: Reduce Resolution (EASY, ~2x speedup)

Change viewport from 1280x720 to 640x360 in the test launcher.

```javascript
// In LAUNCH_ARGS, change:
'--window-size=640,360',

// In createPage, change:
await page.setViewport({ width: 640, height: 360 });
```

**Impact:** Game runs at ~31 FPS instead of ~11 FPS. Sleep times can be reduced proportionally since frames render faster. The canvas reader grid-sampling approach works identically at lower resolution.

**Risk:** Screenshot comparisons would be at lower resolution. For pixel-level regression testing this matters; for functional testing (is something rendering? did the menu appear?) it does not.

**Estimated improvement:** 5 min -> ~3 min

### Strategy B: Reduce Sleep Times (EASY, ~2x speedup)

Most sleeps are over-generous. At 640x360 with ~30 FPS, the game renders a frame every ~33ms.

Proposed reductions:
- `startGameOnSurface`: 3000 -> 2000 (page load), 1500 -> 800 (click), 5000 -> 3000 (countdown)
- Total per call: 9500 -> 5800ms (saves ~3.7s x 19 = **70s**)
- Reduce `sleep(8000)` waits for enemies to `sleep(5000)`
- Reduce `sleep(1000)` UI waits to `sleep(500)`

**Impact:** Cuts ~70-90 seconds from total runtime.

**Risk:** Tests may become flaky if the system is under heavy load. Add retry logic as fallback.

**Estimated improvement (combined with A):** 5 min -> ~1.5-2 min

### Strategy C: Page Reuse (MEDIUM, ~1.5x speedup)

Currently, each test opens a fresh page and navigates from scratch. Tests within the same suite could **reuse the same page** if they don't require a clean state.

For example, the "Start Menu" suite has 6 tests that each do `page.goto(BASE_URL)` + `sleep(3000)`. With page reuse, you load once and test 6 things.

Similarly, the "Surface Variety" suite loads 6 different surfaces sequentially. These could be parallelized across pages.

**Implementation:**
- Group tests by page requirement
- Share browser instance across all suites
- Only create new pages when the test needs a different URL/state

**Estimated improvement (combined with A+B):** 5 min -> ~1-1.5 min

### Strategy D: Parallel Test Execution (MEDIUM, ~2x additional speedup)

Run independent test suites in parallel across multiple browser pages.

Test suites that are independent:
- Start Menu (does not need game running)
- Surface Variety (6 surfaces, can test 2-3 in parallel)
- Game Loading vs Player Movement (can run on separate pages)

Using `puppeteer-cluster` or a simple Promise.all approach:

```javascript
// Run 3 test groups in parallel
await Promise.all([
  runSuiteGroup(['Start Menu', 'Audio Toggle', 'Debug Overlay'], browser),
  runSuiteGroup(['Surface Variety (sphere, cube, torus)'], browser),
  runSuiteGroup(['Surface Variety (pill, peanut, icosahedron)'], browser),
]);
```

**Risk:** CPU contention (SwiftShader is CPU-bound). With 2-3 parallel pages, each gets ~1/3 CPU time, so individual page FPS drops. Net gain depends on CPU core count. On a typical 8+ core system, 3 parallel pages should still be faster than sequential.

**Estimated improvement (combined with A+B+C):** 5 min -> ~45-60 seconds

### Strategy E: Disable Post-Processing in Test Mode (EASY, ~1.3x speedup)

Add a `?noBloom=true` URL parameter that skips the UnrealBloomPass. The bloom pass doubles the rendering cost (it renders the scene to a framebuffer, then applies multiple blur passes).

```typescript
// In Game constructor:
if (!new URLSearchParams(window.location.search).has('noBloom')) {
  this.bloomPass = new UnrealBloomPass(...);
  this.composer.addPass(this.bloomPass);
}
```

Then in tests:
```javascript
await page.goto(`${BASE_URL}?surface=${surface}&noBloom=true`);
```

**Risk:** Tests won't cover bloom rendering. Add one dedicated bloom test that runs with bloom on.

**Estimated improvement:** ~20-30% faster rendering per frame.

### Strategy F: Run Tests on Windows Side (HARD, ~5-10x speedup)

Chrome is installed at `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe` on Windows. Running tests there would give full RTX 2080 Ti GPU acceleration.

**Challenges:**
- Node.js not on Windows PATH (would need to install or use npm on Windows)
- Tests need to access the Vite dev server (works fine via localhost)
- Puppeteer needs a Windows-compatible Chrome path
- Would need a PowerShell/cmd launcher script
- File paths need Windows-style conversion

**This would be the nuclear option** -- GPU rendering at 60+ FPS would make all sleep times negligible. But it requires Windows-side Node.js setup.

**Estimated improvement:** 5 min -> ~30-45 seconds

### Strategy G: Skip Visual Tests for Non-Visual Changes (PROCESS, 0-100% savings)

Add a `--quick` flag that only runs critical visual tests (Start Menu renders, one surface loads, no crash). Full visual suite runs only before releases or on visual-change commits.

Quick suite: 4-5 tests = ~30 seconds.
Full suite: all 23 tests.

---

## 5. Recommended Implementation Plan

### Phase 1: Quick Wins (15 min to implement, 5 min -> ~2 min)
1. **Reduce resolution to 640x360** in `LAUNCH_ARGS` and `createPage`
2. **Reduce sleep times** in `startGameOnSurface` (9500 -> 5800)
3. **Add `--disable-frame-rate-limit --disable-gpu-vsync`** to Chrome args

### Phase 2: Architecture (1 hour, 2 min -> ~1 min)
4. **Reuse pages** within suites instead of creating fresh ones
5. **Parallel execution** of independent suites (2-3 parallel pages)
6. **Add `?noBloom=true`** parameter support and use in tests

### Phase 3: Optional (if needed)
7. **Windows-side test runner** for full GPU acceleration
8. **Quick mode** (`--quick`) for CI/development iteration

---

## 6. Summary

| Question | Answer |
|---|---|
| Is GPU available on this WSL2? | **No.** Windows 10 + old kernel + no WSLg |
| Can Chrome use GPU headless? | **No.** Only SwiftShader works |
| Best speedup strategy? | **Resolution reduction + sleep reduction + parallelization** |
| Estimated time reduction? | **5 min -> ~1 min** (Phase 1+2 combined) |
| Steps to implement? | See Phase 1-3 above |

The most impactful single change is reducing viewport resolution from 1280x720 to 640x360, which alone nearly triples game FPS and allows proportionally shorter sleep times.
