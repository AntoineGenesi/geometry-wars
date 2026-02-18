# Performance Benchmark Usage Guide

## Overview

The benchmark framework runs the game headlessly via Puppeteer with SwiftShader
(the same WebGL renderer used by all automated visual tests) and measures
real rendering performance at 200 entities.

**Key constraint:** SwiftShader runs at ~7 FPS headless. The benchmark collects
wall-clock data over enough time to produce statistically meaningful results
(typically 60–180 seconds per run).

---

## Quick Start

```bash
# Ensure node is in PATH
export PATH="/home/antoine/.nvm/versions/node/v20.19.5/bin:/usr/bin:/bin"

# Run the benchmark (uses existing dev server on :3000, or starts one on :3043)
node tests/perf/perf-benchmark.mjs
```

Output will be written to `tests/perf/results/baseline.json`.

---

## Before / After Optimization Workflow

This is the standard workflow for every performance optimization:

```bash
export PATH="/home/antoine/.nvm/versions/node/v20.19.5/bin:/usr/bin:/bin"

# 1. Capture baseline BEFORE your changes
node tests/perf/perf-benchmark.mjs --output tests/perf/results/before-my-opt.json

# 2. Implement your optimization in source code

# 3. Capture results AFTER your changes
node tests/perf/perf-benchmark.mjs --output tests/perf/results/after-my-opt.json

# 4. Compare and get a KEEP/REVERT verdict
node tests/perf/compare-results.mjs \
  tests/perf/results/before-my-opt.json \
  tests/perf/results/after-my-opt.json

# 5. Commit if KEEP; revert if REVERT
```

---

## Metrics Collected

| Metric | Source | Description |
|--------|--------|-------------|
| `avgFps` | `frameTimes` rolling average | Average FPS over measurement period |
| `minFps` | `frameTimes` min | Worst-case FPS (most important for gameplay feel) |
| `p95FrameTimeMs` | 95th percentile of frame times | 5% of frames are slower than this |
| `drawCalls` | `renderer.info.render.calls` | Three.js draw calls per frame |
| `triangles` | `renderer.info.render.triangles` | Triangle count per frame |
| `geometries` | `renderer.info.memory.geometries` | GPU geometry count |

---

## JSON Output Format

```json
{
  "timestamp": "2026-02-19T10:00:00.000Z",
  "entityCount": 200,
  "avgFps": 7.2,
  "minFps": 5.1,
  "p95FrameTimeMs": 185.3,
  "drawCalls": 18,
  "triangles": 148320,
  "geometries": 42,
  "maxFps": 8.8,
  "stdDev": 0.9,
  "frameCount": 42,
  "allTiers": [ ... ]
}
```

Note: FPS numbers will be low (~7) because SwiftShader is a software renderer.
The **relative change** between before/after is what matters, not the absolute value.

---

## Comparison Verdict Logic

`compare-results.mjs` applies this logic:

- **KEEP** — avg FPS improved >5% with no regressions
- **KEEP (marginal)** — some FPS gain but below 5% threshold, no regressions
- **NEUTRAL** — no significant change in either direction
- **REVERT** — avg FPS regressed >2%, OR any metric regressed significantly

---

## How It Works

1. The script loads `http://localhost:PORT/?mode=benchmark` in a headless browser
2. The game runs `src/benchmark.ts` (`runBenchmark()`) which tests entity tiers: `[50, 100, 200, 500, 1000]`
3. For each tier: 0.5s warmup → 2s measurement
4. Results are exposed on `window.__benchmarkResults` when done
5. The Puppeteer script extracts the 200-entity tier and writes JSON

---

## Dev Server

The benchmark script handles the dev server automatically:
- If port 3000 is in use → use it (typical during development)
- If port 3043 is in use → use it (worker's assigned port)
- Otherwise → starts a new server on port 3043, kills it when done

To start the dev server manually:
```bash
export PATH="/home/antoine/.nvm/versions/node/v20.19.5/bin:/usr/bin:/bin"
VITE_PORT=3043 npm run dev
```

---

## Results Directory

All benchmark results are stored in `tests/perf/results/`. The naming convention:

```
baseline.json              — initial baseline capture
before-<optimization>.json — before implementing an optimization
after-<optimization>.json  — after implementing an optimization
```

The `results/` directory is committed with a `.gitkeep` but actual JSON results
should be committed when they represent meaningful optimization milestones.

---

## Troubleshooting

**Benchmark times out (>4 minutes):**
- Check that the dev server is running and responding
- Verify Chrome is installed at `/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome`
- Try running `node tests/visual/play-game.mjs` first to confirm Puppeteer works

**Results vary significantly between runs (>10% difference):**
- This is expected with SwiftShader — always average multiple runs for definitive comparisons
- P95 frame time is more stable than average FPS for optimization decisions

**All FPS values are 0:**
- The benchmark may have failed silently — check for console errors in the output
- The game may not have initialized (WebGL context failure)
