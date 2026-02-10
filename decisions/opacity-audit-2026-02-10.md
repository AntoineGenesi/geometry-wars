## 2026-02-10 - Depth Opacity Not Working: Root Cause Audit

**Context:** User reported that depth-based opacity had "no visible effect" despite multiple claims of being "fixed." Objects on the far side of surfaces were fully visible -- you could see through everything perfectly.

**Root Cause (TWO critical issues found):**

### Issue 1: Instanced enemies used color darkening instead of real transparency

The `EnemyInstanceManager.setInstanceVisibility()` method attempted to simulate opacity by multiplying the base color by a visibility factor (`_tempColor.copy(baseColor).multiplyScalar(visibility)`). This only darkens the RGB color but does NOT produce alpha transparency. Three.js `InstancedMesh.instanceColor` is RGB only (itemSize: 3) -- there is no alpha channel.

Against the near-black background (0x050510), darkening an emissive enemy color from e.g. orange to dark-brown is barely perceptible. The user would never notice a color shift from `rgb(255,100,0)` to `rgb(15,6,0)` because both look like glowing dots on a dark background. Real transparency (alpha blending) is fundamentally different from color darkening.

**Since the vast majority of enemies are instanced** (Grunt, Duck, Mayfly, Rocket, Neutron, Weaver, Wanderer, SpinnerSpawn, Spinner, Virus, Lurker, Orbiter, Splitter), this meant ~95% of enemies had NO visible opacity effect at all.

### Issue 2: Geoms had NO depth opacity applied

The `GeomPool` never had any depth-based opacity logic. Geoms only had age-based fading (fade out before despawn). Far-side geoms were fully bright green regardless of camera angle.

### What Was NOT Wrong

The `computeDepthVisibility()` function in `DepthOpacity.ts` was correct. The `meshSurface.getVisibility()` call was correct. The render loop in `main.ts` lines 1912-1964 was correctly computing visibility values and calling `setInstanceVisibility()`. The math was fine -- the problem was that `setInstanceVisibility()` produced zero visual effect for instanced enemies.

Non-instanced enemies (Boss, Gate, GravityWell) DID have correct opacity because lines 1946-1963 set `mat.opacity` directly on their materials.

**Fix Applied:**

1. **Per-instance opacity attribute**: Added a custom `instanceOpacity` InstancedBufferAttribute (float, itemSize 1) to each InstancedMesh batch.

2. **Shader injection via onBeforeCompile**: The MeshStandardMaterial's shader is patched at compile time to:
   - Vertex shader: declare `attribute float instanceOpacity` and pass it as `varying float vInstanceOpacity`
   - Fragment shader: multiply `gl_FragColor.a *= vInstanceOpacity` after dithering

3. **setInstanceVisibility() writes to opacity attribute**: Instead of darkening colors, it now writes directly to the `opacityAttribute` buffer.

4. **depthWrite: false**: Added to the instanced material so transparent objects don't occlude things behind them.

5. **Geom depth opacity**: Added `applyDepthOpacity()` method to `GeomPool` that computes visibility per active geom and scales material opacity accordingly. Called from `main.ts` render loop after surface projection.

**Files Changed:**
- `src/rendering/EnemyInstanceManager.ts` - Per-instance opacity attribute + shader injection
- `src/entities/Geom.ts` - New `applyDepthOpacity()` method + import of DepthOpacity
- `src/main.ts` - Call `geomPool.applyDepthOpacity()` in render loop

**Options Considered:**
1. Keep color darkening but make it more aggressive (multiply by visibility^3) -- rejected because color darkening fundamentally cannot produce transparency against a dark background
2. Use a custom ShaderMaterial entirely -- rejected as too invasive, would lose MeshStandardMaterial features
3. **Use onBeforeCompile + InstancedBufferAttribute** -- chosen because it's minimally invasive, preserves all existing material properties, and produces real alpha transparency

**Reversibility:** Easy - revert the three files

**Key Lesson:** Three.js InstancedMesh `instanceColor` is RGB-only (no alpha). To achieve per-instance transparency, you MUST use a custom attribute + shader injection. Color darkening is NOT a substitute for alpha blending, especially against dark backgrounds.
