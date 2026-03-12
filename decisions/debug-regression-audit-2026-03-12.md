# Regression Audit — SP Gold Standard Breakdown
## Date: 2026-03-12 | Task: s44r12-05

---

## Executive Summary

**The best baseline is the current HEAD** — not a rollback. The current version has the most fixes applied. The ONE remaining root cause of SP feeling broken is a single OR condition added in `src/core/CollisionSystem.ts` by commit `78ba30b0 (s44r6-04, March 10)`.

**The workers for s44r12-01 should go directly to CollisionSystem.ts line 357 and line 165 and remove the OR fallback, or gate it to Mobius-only.**

---

## Voice Dump Timeline (Chronological)

| Date | Session | SP Status | Key Quotes |
|------|---------|-----------|------------|
| 2026-03-01 | s44o-ish | ✅ SP working | "in single player, I can literally just walk around" |
| 2026-03-02 | v12 tag | ✅ SP mostly OK | "hit detection on bullets is a lot better" (MP focus) |
| 2026-03-09 09:00 | s44r3 | ✅ SP OK | Complaints are MP-specific: cube, pill, Mobius |
| 2026-03-09 19:15 | s44r5 start | ✅ **SP GOLD STANDARD** | "you've got the single-player to work really well" |
| 2026-03-10 10:30 | s44r6b | ✅ SP OK (approx) | Focus on PvPvE/cube camera/MP issues |
| 2026-03-10 18:52 | s44r6c | ⚠️ SP "fine" (hedged) | "single player works fine; I mean I can't even guarantee but it does" |
| 2026-03-11 06:45 | post-s44r7 | ❌ **SP BROKEN** | "you have f___ up the single-player as well!" — first SP complaint |
| 2026-03-11 10:30 | s44r10 start | ❌ SP broken | "how did you f___ up my single player" — hit detection + cube-ring |
| 2026-03-12 10:30 | s44r10 | ❌ SP still broken | s44r9 fixes ALL failed user testing |
| 2026-03-12 16:49 | s44r12 | ❌ SP still broken | "hit detection's completely f___ up" |

**The regression window is between March 9 19:15 and March 11 06:45.**

During that window, sessions s44r5, s44r6, s44r6b, s44r6c ran.

---

## Regression 1: SP Hit Detection (CRITICAL — still broken today)

### What the user reports
Player dies when enemies are "a body-width away" from them. Dies before visual contact.

### Root cause commit
`78ba30b0 (s44r6-04, March 10 ~02:03 +11:00)`

**Title:** "Mobius collision + Tesla damage — on-surface fallback for non-orientable surfaces"

**What it changed in CollisionSystem.ts:**
```typescript
// BEFORE s44r6-04:
if (distSq < hitRadiusSq) {

// AFTER s44r6-04 (still present today):
const onSurfaceDistSq = player.mesh.position.distanceToSquared(enemy.position);
if (distSq < hitRadiusSq || onSurfaceDistSq < baseHitRadiusSq) {
```

**Why this breaks SP on ALL surfaces:**
- `player.mesh.position` = player's visual position, elevated off the surface by `playerRadius * normal`
- `enemy.position` = enemy's ON-SURFACE position (NOT elevated)
- The distance `player.mesh.position → enemy.position` is shorter than `player.mesh.position → enemy.mesh.position` because the player is elevated but the enemy reference is not
- On ALL orientable surfaces (sphere, torus, pill, etc.), this comparison fires false positives: the enemy doesn't visually touch the player, but the surface-point-to-visual-point distance is within the threshold

**Location in current code:** `src/core/CollisionSystem.ts` lines 357 and 165

### Status
**STILL PRESENT IN HEAD** — was never reverted or fixed

### Fix recommendation for s44r12-01
**Option A (targeted):** Gate the OR fallback on `isMobius` only:
```typescript
const isMobius = surface?.topologyType === 'mobius'; // or similar check
if (distSq < hitRadiusSq || (isMobius && onSurfaceDistSq < baseHitRadiusSq)) {
```

**Option B (correct math):** Replace `enemy.position` with `enemy.mesh.position` in the fallback — then both checks use the same elevated visual positions:
```typescript
// This is equivalent to distSq check with different threshold, which is already covered
// Actually just remove the OR fallback entirely for orientable surfaces
```

**Option C (revert):** `git revert 78ba30b0 --no-commit` and manually re-apply only the Tesla damage fix (different function, no collateral damage).

**Recommendation: Option A** — keep Mobius fix, remove the false-positive-causing fallback for all other surfaces.

### Verification
After fix: player should only die when enemy mesh visually overlaps player mesh. Puppeteer test: spawn player on sphere, spawn enemy 2 player-widths away, verify no death event.

---

## Regression 2: SP Enemy Dimming (FIXED in s44r11-01)

### What the user reported
"Enemies on opposite side are just bright. They're the same brightness whether they're near me or on the other side."

### Root cause chain
1. **Broke by `d684e5a6 (s44m-01, March 7)`** — culling code added `batch.opacityAttribute.setX()` directly in the loop, but NEVER called `batch.opacityAttribute.needsUpdate = true`. GPU never received updated values. All enemies appeared at default opacity 1.0.

2. **Worsened by `e6c2c947 (s44r8-04, March 11)`** — removed `gl_FragColor.rgb *= op` from shader, leaving only `gl_FragColor.a *= op`. With premultiplied alpha (Three.js default), this made enemies appear at 100% brightness regardless of opacity value.

3. **Wrong fix `86b45c54 (s44r9-01, March 11)`** — restored `rgb *= op` but opacityAttribute.needsUpdate still missing.

4. **Wrong fix `8e70283a (s44r10-01, March 12)`** — added instanceColor dimming, but instanceColor only modulates DIFFUSE, not emissive. MeshStandardMaterial with emissiveIntensity=2.0 dominated visual output.

5. **ROOT CAUSE FIXED `317dc49a (s44r11-01, March 12)`:**
   - Switched to `MeshBasicMaterial` (unlit, output = color × instanceColor)
   - Added `batch.opacityAttribute.needsUpdate = true` in finalization loop
   - Fixed bullet depth curve: exponent 3.0 → 0.5, fadeStartThreshold 0.05 → -0.8

### Status
**FIXED in current HEAD** (s44r11-01)

### Remaining issues for s44r12-03
User in s44r12 dump says: "bullets are bright and it takes a little bit [before going dim]". This is a **timing/initialization issue**, not the root cause. Newly spawned bullets start at full brightness and only dim on the NEXT culling cycle. Fix:
- Initialize bullet opacity at spawn based on current depth visibility
- OR: run culling pass before first render

---

## Regression 3: SP Bullet Dimming (FIXED in s44r11-01)

### What the user reported
"All my bullets are dimmed" — bullets near player were always very dim.

### Root cause
`64ce0f60 (s44r7-05, March 11 07:13)` added `BULLET_DEPTH_CURVE` with:
- `fadeStartThreshold=0.05`: dot(bulletNormal, cameraDir) < 0.05 → apply dimming
- `exponent=3.0`: aggressive falloff
- All bullets near player have dot product ~0 (tangential to surface), so `0.0 < 0.05` was TRUE, making ALL bullets dim to ~8%

### Status
**FIXED in current HEAD** by s44r11-01 (exponent 0.5, threshold -0.8 = bullets only dim when clearly behind surface).

---

## Regression 4: Cube-ring Movement Broken (FIXED)

### Root cause
`computeVertexNormals()` on cube-ring geometry produces incorrect normals (averaging across sharp edges). These normals are used for the movement tangent frame → random/wrong directions.

### Fix
`2426005c (s44r10-03, March 12)` — replaced computeVertexNormals with analytical face normals.

### Status
**FIXED in current HEAD**.

---

## Regression 5: Pixelation Intensity (FIXED)

- s44r10-04: 0.5→0.25 (too pixelated → too subtle)
- s44r12-04: 0.25→0.375 (midway)

### Status
**FIXED in current HEAD**.

---

## Best Baseline: Recommendation

### DO NOT ROLL BACK

Rolling back to pre-s44r7 or pre-s44r10 would undo:
- s44r11-01: dimming root cause fix (MeshBasicMaterial)
- s44r10-03: cube-ring movement fix
- s44r10-02: EnemySpawner UV wrapping fix
- s44r9-01: shader premultiplied alpha fix
- s44r8-01: inverted bullet dimming fix

### The correct path: fix forward from HEAD

**The "best version" is HEAD + fix for CollisionSystem OR fallback.**

Only one commit broke SP in a way that hasn't been fixed:
- `78ba30b0 (s44r6-04)` → CollisionSystem OR fallback → **fix this NOW**

Everything else is fixed (or being fixed by s44r12-03 for dimming edge cases).

### Best commit for reference (pre-s44r6-04, SP working perfectly):
`2d24e832 (2026-03-10 00:38+11:00)` — session s44r5 wrap-up, all s44r5 fixes merged, SP gold standard. The CollisionSystem at this point had NO OR fallback.

```bash
# To see CollisionSystem before the regression:
git show 2d24e832:src/core/CollisionSystem.ts | grep -n "hitRadiusSq"
```

---

## Action Items for Other Workers

### s44r12-01 (Hit Detection — CRITICAL)
**File:** `src/core/CollisionSystem.ts`
**Lines:** 357 (player-enemy) and 165 (bullet-enemy)
**Action:** Remove or gate the OR fallback on Mobius-only

The smoking gun:
```typescript
// LINE 357 — player-enemy collision:
const onSurfaceDistSq = player.mesh.position.distanceToSquared(enemy.position);
if (distSq < hitRadiusSq || onSurfaceDistSq < baseHitRadiusSq) {  // ← REMOVE the OR

// LINE 165 — bullet-enemy collision (same pattern):
const onSurfaceDistSq = bulletPos.distanceToSquared(enemy.position);
const onSurfaceHitRadiusSq = enemy.radius * enemy.radius;
if (distSq < hitRadiusSq || onSurfaceDistSq < onSurfaceHitRadiusSq) {  // ← REMOVE the OR
```

**Why safe to remove:** The original mesh-position check `distSq < hitRadiusSq` was working correctly before s44r6-04 for ALL surfaces. The OR fallback was added for Mobius specifically but fires on all surfaces.

### s44r12-03 (Dimming — root cause fixed, polish needed)
Main fix is done (s44r11-01). Remaining issues are initialization-order: newly spawned entities appear at full brightness for 1 frame. Investigate:
1. `EnemyInstanceManager.addEnemy()` — does it set initial opacity based on current depth?
2. `updateInstances()` — is culling run before or after the matrix update?
3. Is `opacityAttribute.needsUpdate = true` set in BOTH the type-batch loop AND the LOD-batch finalization?

### s44r12-02 (Performance)
Performance lag started appearing around s44r10-12 (visual test harness, scenario tests). Suspects:
1. `GameTelemetryExporter.ts` — check if ?debug=true is active in normal play URL
2. `src/rendering/EnemyInstanceManager.ts` — after MeshBasicMaterial switch, are shader `onBeforeCompile` hooks running per-frame?
3. Any extra per-frame calculation loops added in s44r7-09 (surface verification framework telemetry) running in production

---

## Summary Table

| Regression | Introduced By | Session | Date | Status | Fix |
|-----------|--------------|---------|------|--------|-----|
| SP hit detection (player deaths) | 78ba30b0 | s44r6-04 | Mar 10 | ❌ STILL BROKEN | CollisionSystem.ts:357,165 — remove OR fallback |
| SP enemy not dimming | d684e5a6 | s44m-01 | Mar 7 | ✅ Fixed (s44r11-01) | MeshBasicMaterial + needsUpdate |
| SP bullets always dim | 64ce0f60 | s44r7-05 | Mar 11 | ✅ Fixed (s44r11-01) | BULLET_DEPTH_CURVE exponent 3.0→0.5 |
| Cube-ring movement | unknown | before s44r10 | Mar 11 | ✅ Fixed (s44r10-03) | Analytical normals |
| Pixelation intensity | bebdf8c5 | s44r10-04 | Mar 12 | ✅ Fixed (s44r12-04) | 0.375 ratio |
