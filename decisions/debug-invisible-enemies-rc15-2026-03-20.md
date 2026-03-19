## 2026-03-20 — RC15 Invisible Enemies Investigation (s44r31 session)

### Summary
User sees invisible enemies at wave 1 round 3 on torus KotH in their real Chrome (WebGPU). All automated headless tests pass. The bug is renderer/GPU-specific — game state is correct but pixels aren't drawn.

### What We Ruled Out

| Hypothesis | Test | Result |
|-----------|------|--------|
| ICB too low (0.15) | Raised MIN_ICB to 0.20, 0.25, 0.30, 0.50 | Still invisible at 0.50 |
| All dimming | ?noDim=true (forces visibility=1.0) | Still invisible |
| Stuck materializing (RC14) | Overlay shows stuck-mat=0 | Ruled out |
| Zero-scale matrix | Overlay shows zero-scale=0 | Ruled out |
| Not registered in InstancedMesh | NO-MESH count = 4 (non-instanceable types only) | Ruled out for instanceable enemies |
| highWaterMark desync | Fixed scan-from-top, CLIP counter = 0 | Ruled out |
| Depth test occlusion | Set depthTest:false | Inconclusive — first test was on frozen game. Second test session closed before results. NEEDS RETEST. |
| LOD batch handoff | All enemies in HIGH batch (MED=0, LOW=0) | Ruled out |
| SwiftShader vs real GPU | Headless SwiftShader passes, real WebGPU fails | Confirmed difference |

### What We Know For Certain
1. Game state is correct: ICB >= 0.25, matrix scale 1.0, stuck=0, zero-scale=0
2. Bug only appears in user's real Chrome (WebGPU, Chrome 146)
3. Headless Puppeteer (SwiftShader) never reproduces it
4. Bug happens IMMEDIATELY at round 3 of wave 1 (~20 enemies)
5. Near-player enemies are visible; the "invisible" ones may be far-side (behind torus)
6. Even at MIN_ICB 0.50 (RGB 128,128,128), user reports invisible enemies
7. `page.evaluate()` blocks Chrome main thread → FPS drops to 0 → must use `requestAnimationFrame` injection for Puppeteer tests

### Most Likely Root Cause (needs verification)
**Depth test occlusion:** Enemies behind the torus surface fail the depth test (depthTest defaults to true). The dimming system sets their ICB correctly but the GPU discards the fragments before they're drawn. The `depthTest:false` fix was tested during a frozen game (FPS:0 from blocking evaluate calls), so the result was inconclusive.

**Next step:** Re-test `depthTest:false` with:
1. Non-blocking Puppeteer (rAF injection, NOT synchronous evaluate)
2. Wait 30+ seconds for WebGPU init
3. Take screenshots AFTER game is confirmed running at >10 FPS
4. Compare screenshot enemy count vs API enemy count

### Alternative hypothesis
The user may be expecting ALL enemies to be visible at all times (including far-side ones behind the surface). On a torus, ~50% of enemies are behind the surface at any camera angle. If this is the intended design, we need either:
- `depthTest:false` so enemies render through the surface (with dimming for depth cue)
- Or a different rendering approach for far-side enemies (outlines, minimap markers, etc.)

### Chrome Debug Port Setup (WORKING)
Port forward: `netsh interface portproxy add v4tov4 listenport=9222 listenaddress=172.29.240.1 connectport=9222 connectaddress=127.0.0.1`
Firewall: `netsh advfirewall firewall add rule name="WSL2 Chrome Debug" dir=in action=allow protocol=TCP localport=9222 remoteip=172.29.240.0/20`
Connect: `puppeteer.connect({ browserWSEndpoint: 'ws://172.29.240.1:9222/devtools/browser/...' })`

### Debug Tools Added This Session
- `?godMode=true` — player invincible
- `?noDim=true` — disables all enemy dimming
- `?debugVisibility=true` — live overlay with per-batch counts, CLIP detection, NO-MESH count
- `VisibilityDebugOverlay.ts` — shows alive, invisible, stuck-mat, zero-scale, NO-MESH, per-batch reg/cnt/hwm
- `prove-visibility-or-find-bug.mjs` — 8-scenario automated test suite (headless only)
