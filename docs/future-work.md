# Future Work

Items discovered during the task verification audit (2026-02-11). These are improvements and fixes that are not critical blockers but would meaningfully improve the project.

---

## High Priority

### 1. Fix FPS Counter (Task #73)
The FPS counter uses a 60-frame rolling average that masks sudden drops. At 0.5 real FPS, it reports ~10-20 FPS because old good frame times haven't been flushed yet.

**Fix options:**
- Reduce window to 10-15 frames (faster response but noisier)
- Show BOTH instantaneous FPS (1/frameDt) and rolling average
- Use exponential moving average with configurable alpha (e.g., 0.3 = responsive, 0.9 = smooth)
- When frame time exceeds 100ms (sub-10 FPS), switch to instantaneous display

**Files:** `src/core/PerformanceTracker.ts` (lines 91, 129-145)

### 2. Fix White Octagon Enemy Rendering (Task #55)
Some enemies render as white/grey octagon shapes instead of their proper colored models. This is the LOD LOW tier billboard quad being applied too aggressively or missing base colors.

**Investigation needed:**
- Check which enemy types are missing from `typeBaseColors` map in EnemyInstanceManager
- Check LOD distance thresholds -- may be too aggressive for smaller screens
- Check if the LOD LOW geometry (billboard quad) has proper material setup

**Files:** `src/rendering/EnemyInstanceManager.ts`, `src/rendering/LODManager.ts`

### 3. Reconcile Difficulty Scaling Values
The DifficultyScaling.ts file has been modified multiple times across tasks #47 and #72. The current values are HARDER than what task #72 intended (which was to make the game EASIER). The user needs to play-test and decide which difficulty curve feels right.

**Current state:** Tier 1-4 HP multipliers are 3/8/20/50x. Task #72 tried to set them to 2/4/10/25x but was overridden. PlayerLevel thresholds ARE at the easier values from #72.

**Decision needed:** Does the user prefer the current harder curve or the easier #72 curve?

**Files:** `src/core/DifficultyScaling.ts`

### 4. LAN Test Infrastructure Should Test User Flow
The current LAN tests (`tests/lan/run-lan-tests.mjs`) bypass the StartMenu and load `?mode=network` directly. The bugs the user reports (wrong map loading, can't host) happen in the StartMenu -> vite-plugin-lan -> Colyseus flow.

**Recommended approach:**
- Add Puppeteer tests that navigate through StartMenu -> LAN -> Host Game -> Enter Game
- Verify the surface type selected in the UI matches what's loaded in the game
- Test the complete hosting flow, not just the network layer

**Files:** `tests/lan/run-lan-tests.mjs`, `src/ui/StartMenu.ts`, `vite-plugin-lan.ts`

---

## Medium Priority

### 5. Fix TypeScript Errors in main.ts
Two type errors: accessing `.geometry` on `Object3D` instead of `Mesh` at lines 2464-2465. Simple fix: cast to `THREE.Mesh` or use type guard.

### 6. Split-Screen WebGPU Bloom
Currently, split-screen mode silently disables bloom when using WebGPU renderer. The TSL-based post-processing path for split-screen viewports needs to be implemented.

**Files:** `src/rendering/SplitScreenRenderer.ts`

### 7. Per-Instance Alpha Transparency for Enemies
The depth occlusion system modulates enemy brightness via color (RGB darkening) because InstancedMesh has no per-instance alpha. True transparency requires a custom InstancedBufferAttribute + onBeforeCompile shader injection. This would make far-side enemies properly semi-transparent instead of just darker.

**Files:** `src/rendering/EnemyInstanceManager.ts`, `src/rendering/DepthOpacity.ts`

### 8. Bullet Count Accuracy in Performance Graphs
The user reported "peak bullets doesn't really seem to be correct." The bullet count is sampled from `bulletPool.activeCount` at 500ms intervals. If bullets are short-lived (e.g., 100ms), the sampling may miss peaks between samples.

**Fix options:**
- Track max bullet count per sampling window (not just point-in-time)
- Reduce sampling interval for bullet peaks
- Add a high-water-mark counter that records the maximum between samples

### 9. Visual Effects Implementation
Task #63 produced excellent research (`research/visual-effects-research.md`) with 35+ effects analyzed. The top 5 recommended effects should be implemented:
1. Shockwave distortion (screen-space, 0.1-0.3ms)
2. Ribbon trails (replaces thin lines with proper width/taper)
3. Chromatic aberration + screen flash (zero extra draw calls)
4. Mesh deformation / grid warp (iconic Geometry Wars visual)
5. Spiral vortex for spawn points

---

## Low Priority

### 10. Server Registry Adoption
The server port management system (`scripts/server-registry.mjs`) is built and tested but relies on agents actually using it. Consider adding it to the dev server startup scripts automatically.

### 11. Rules Cleanup
Task #66 (rules audit) identified 4 contradictions, 7 missing rules, 5 outdated rules, and 8 duplicate rule groups. The P0 issues (hook event contradictions in MEMORY.md) should be fixed to prevent agents from getting confused.

### 12. Experimental Visual Styles (Task #31)
While visual styles are clickable and applicable (38 presets), the original task asking for more "crazy" experimental styles (CRT, wireframe neon, vaporwave, glitch, etc.) was never completed. These would add visual variety.

### 13. Performance Report After 10 Games
The PerformanceLogger has a 10-game counter but the actual research report generation tool was not built. After 10 games of accumulated data, a performance analysis report could be auto-generated.

### 14. Pre-Existing Test Failures
5 test failures exist in:
- `playground-verification.test.ts` (4 failures: bullet direction, enemy spawn position assertions)
- `simulation.test.ts` (1 failure: closestApproach distance assertion)

These should be investigated and either fixed or adjusted.
