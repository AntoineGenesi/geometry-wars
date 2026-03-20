# RC18 Investigation — Invisible Enemies Despite All Rendering Fixes

## Date: 2026-03-21

## Summary
Enemies are STILL invisible on user's Chrome (WebGPU) on torus SP, despite:
- depthTest:false (RC15)
- DoubleSide materials (RC17)
- MIN_ICB raised to 0.35
- SURFACE_DIM_OPACITY raised to 0.40
- s44r33-01 effectiveFloor cap reverted
- ?noDim=true (forces visibility=1.0) — STILL INVISIBLE

## Critical Finding: noDim=true doesn't help
With `?noDim=true`, the RenderLoop sets `visibility = 1.0` for every enemy. But enemies are STILL invisible. This PROVES the dimming system is NOT the cause. The problem is upstream.

## Root Cause Hypothesis: Phase 1 Hemisphere Culling in updateInstancesWithLOD

`EnemyInstanceManager.updateInstancesWithLOD()` (lines 460-489) runs BEFORE the RenderLoop visibility pass. It calls `getEntityVisibilityState()` which checks dot product of (enemy pos - player pos) against player normal.

If `dot < 0` → `EntityVisibilityState.HIDDEN` → two behaviors:
- `hide90DegreeEntities=true` → ZERO SCALE (completely invisible, bypasses ALL rendering)
- `hide90DegreeEntities=false` → dimmed to 0.3× color

This runs in `updateInstancesWithLOD`, NOT in the RenderLoop. `?noDim=true` only affects the RenderLoop visibility float. Phase 1 culling is independent.

**Even with `hide90DegreeEntities=false` (default):** far-side enemies get 0.3× color multiplier. Combined with a dark base color, this could be imperceptible.

## Key Code Paths

### Phase 1 (EnemyInstanceManager.ts lines 460-489)
```
getEntityVisibilityState() → dot < 0 → HIDDEN
  → hide90DegreeEntities=true: zero-scale matrix (invisible)
  → hide90DegreeEntities=false: 0.3× RGB color (very dim)
```

### Phase 2 (RenderLoop.ts lines 186-380)
```
UV dimming + depth occlusion → visibility float
?noDim=true → visibility = 1.0
setInstanceVisibility(enemy, visibility) → scales RGB by visibility
MIN_ICB floor → raises RGB if too dark
```

Phase 1 color dimming (0.3×) is applied DIRECTLY to the instanceColor in `updateInstancesWithLOD`. Then Phase 2 scales it further. The 0.3× multiplier happens BEFORE MIN_ICB is checked, and MIN_ICB only rescales if `visibility > 0` — but Phase 1 doesn't set visibility to 0, it modifies the color directly.

Wait — actually Phase 1 sets color to `baseColor * 0.3` via `setColorAt`. Then Phase 2's `setInstanceVisibility` reads the color, multiplies by visibility, and applies MIN_ICB. So the flow is:

1. Phase 1: `instanceColor = baseColor * 0.3` (for HIDDEN enemies)
2. Phase 2: `instanceColor = instanceColor * visibility` (from RenderLoop)
3. MIN_ICB: if avg(r,g,b) < 0.35, scale up

With noDim=true, visibility=1.0, so step 2 doesn't change anything. Step 1 sets color to 0.3×baseColor. Step 3 should catch this and raise it to MIN_ICB=0.35.

But... is `ensureMinimumVisibility()` actually being called? And does it catch Phase 1's color modifications?

## NEXT STEPS (for autonomous worker)

1. **Check if Phase 1 is zeroing scale**: Even with `hide90DegreeEntities=false`, check if there's another code path that zeros the scale for HIDDEN enemies.

2. **Check `isMaterializing`**: Line 454 — materializing enemies get zero-scaled unconditionally. If `isMaterializing` never clears (the RC14 bug), enemies stay invisible.

3. **Add console.log to register()**: Log how many enemies successfully register vs fail. If `allocateSlot` returns -1, the enemy never gets a slot and is invisible.

4. **Check if enemy.mesh exists**: Line 450 — `if (!enemy.mesh) continue`. If mesh is null, the enemy is skipped entirely.

5. **Nuclear option**: Temporarily disable Phase 1 culling entirely (comment out lines 460-489) and see if ALL enemies become visible. This would confirm Phase 1 as the cause.

## What Worked vs What Didn't

### Worked (v17.0 confirmed by user for SP):
- depthTest:false on InstancedMesh materials
- DoubleSide on InstancedMesh materials
- frustumCulled=false on InstancedMesh

### Didn't help:
- Raising MIN_ICB (0.15→0.35)
- Raising SURFACE_DIM_OPACITY (0.25→0.40)
- effectiveFloor cap (made it worse, reverted)
- ?noDim=true (proves dimming isn't the cause)

### Untested:
- Disabling Phase 1 culling
- Checking isMaterializing stuck state
- Checking if register() fails silently
- WebGL2 fallback (does the bug happen on WebGL2?)

## User Context
- Bug appears on user's desktop Chrome (WebGPU, Chrome 146)
- Does NOT appear on friend's laptop and phone
- Visible in SP torus
- User can see enemy trail/glow effects but not the InstancedMesh body
- User confirmed v17.0 worked for SP (tag on commit 91ab1046)
