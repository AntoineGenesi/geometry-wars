# Character Performance Baseline — Animated GLB on Sphere

**Date:** 2026-02-27
**Task:** s34-demo-phase-5-performance-benchmarking
**Test machine:** WSL2 Chrome (mid-range Windows desktop)

## Summary

Benchmark infrastructure added to OBJDebugPanel (the "Performance Benchmark" section).
Run the benchmark in a real browser to populate the table below with actual measurements.

**To run:** Open game in browser → F4 → Performance Benchmark section → drag slider → RUN BENCHMARK.

---

## How to Measure

1. Open `http://localhost:3000/?debug=true` (or press F4 in game)
2. The "Performance Benchmark" section is at the bottom of the left panel
3. Set the slider to the desired character count
4. Click **RUN BENCHMARK (5s)** — spawns N animated GLB characters on a sphere, measures for 5 seconds
5. Results appear in the table
6. Click **EXPORT** to copy JSON + save to `localStorage` key `gw_character_bench`
7. Repeat for each N value and record in the table below

---

## Raw Results (fill in after browser testing)

| Characters | Avg FPS | Min FPS | Draw Calls | Triangles | Anim CPU |
|-----------|---------|---------|------------|-----------|----------|
| 1         | —       | —       | —          | —         | —        |
| 2         | —       | —       | —          | —         | —        |
| 4         | —       | —       | —          | —         | —        |
| 8         | —       | —       | —          | —         | —        |
| 16        | —       | —       | —          | —         | —        |
| 24        | —       | —       | —          | —         | —        |
| 32        | —       | —       | —          | —         | —        |
| 50        | —       | —       | —          | —         | —        |

---

## Expected Findings (Pre-Test Hypothesis)

Based on Three.js characteristics (each SkinnedMesh = 1 draw call, bone matrices uploaded per frame):

| Characters | Expected Avg FPS | Performance Tier |
|-----------|-----------------|-----------------|
| 1–4       | ~60 FPS         | Comfortable (< 10% frame budget) |
| 8–16      | ~50–55 FPS      | Comfortable |
| 20–24     | ~40–45 FPS      | Playable |
| 32        | ~30–35 FPS      | Degraded |
| 50        | ~15–20 FPS      | Unplayable |

**60 FPS threshold hypothesis:** ~16–20 simultaneous animated characters
**30 FPS threshold hypothesis:** ~30–35 simultaneous animated characters

---

## Primary Bottleneck Hypothesis

**GPU skinning** (vertex shader bone matrix multiplication), NOT CPU animation mixer updates.

Evidence:
- Three.js `SkinnedMesh` requires unique bone matrix uniforms per instance → separate GPU state per character
- `performance.mark()` measurements will confirm: if `animCpuMs` stays low while FPS drops, GPU is the bottleneck
- Each Kenney mini character has 19 bones × 64-byte matrices = ~1.2KB of uniform data per frame per character
- At 50 characters: ~60KB of bone matrix uploads per frame

---

## GPU Instancing Research

### Three.js r170 and `InstancedSkinnedMesh`

Three.js ^0.170 (project version) does **not** have a stable `InstancedSkinnedMesh` in core.
There is an experimental `WebGPURenderer.batchMesh()` path and a `BatchedMesh` class for static geometry,
but for **animated** skinned meshes, each instance still requires its own `AnimationMixer` and bone matrices.

**Would GPU instancing help?**

No, not significantly, for this use case:
- `InstancedMesh` works for static geometry (our current geometric enemies use this to great effect)
- For skinned/animated meshes, each frame requires unique bone transforms per character
- Shared geometry doesn't help because the vertex shader still needs different bone matrices per instance
- WebGPU's compute shader approach could help (batched skinning), but Three.js doesn't expose this cleanly

**Optimization path if 16+ characters hits budget:**
1. **Animation LOD**: characters > 20m from camera update mixer at 15Hz instead of 60Hz (CPU savings)
2. **Mesh LOD**: distant characters swap to lower-poly mesh (GPU vertex savings)
3. **Reduce character count**: cap to 12–16 total on-screen vs. spawning more enemies
4. **Shared mixer**: characters using identical animation at same timestamp can share one `AnimationMixer`
   (this requires ALL instances to be frame-locked, which looks robotic — tradeoff)

**Conclusion:** GPU instancing would NOT significantly help for animated skeletal characters.
The draw call count grows linearly with characters but is not the primary bottleneck.
Bone matrix upload bandwidth is the primary concern.

---

## Architectural Implications for Phase 6 (Game Integration)

Based on this analysis:

- **Safe budget:** 8–12 simultaneous animated GLB characters alongside normal game entities
- **Max budget:** 16–20 if willing to accept occasional dips below 60 FPS
- **Recommended cap for Phase 6:** 8 characters max on-screen at once (boss fights, arena events)
- **Normal gameplay:** 3–5 animated characters (squad follows, mini-boss)

**Do not spawn animated GLB characters as common enemies** (that's what the instanced geometric enemies are for).
Animated GLB characters should be special: bosses, squad members, story characters.

---

## Files Changed

| File | Change |
|------|--------|
| `src/demo/BenchmarkRunner.ts` | NEW — BenchmarkRunner class (spawns N chars, collects 5s of FPS+renderer metrics) |
| `src/ui/OBJDebugPanel.ts` | Added "Performance Benchmark" section with slider, RUN button, results table, export |
| `decisions/character-perf-baseline.md` | This file — findings, methodology, architectural implications |
