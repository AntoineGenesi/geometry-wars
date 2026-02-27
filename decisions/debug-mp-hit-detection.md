# Debug: MP Hit Detection — S38b Investigation Log

## Context

User reported: "Enemies entering the pickup radius effect zone are causing life loss. On sphere near top, dying when enemies just get into the radius of my effect, not even touching me."

S38a attempted to fix this by adding map-size scaling to UV thresholds. S38a failed because it did not reduce the base threshold value.

---

## Iteration 1 (S38a, commit 94da371) — Map Scaling Added

**What was tried:** Added `getMapScaleFactor(mapSize)` and divided thresholds by it.
- `ENEMY_HIT_RADIUS = 0.04 / scaleFactor`
- `PICKUP_RADIUS = 0.04 / scaleFactor` (was 0.06)

**User feedback:** "Still hitting me when they're literally just getting into the radius of my effect, not even touching me."

**Why it failed:** For medium map (scaleFactor=1.0), the threshold is unchanged: 0.04 UV.
The map scaling only helps large/huge maps. Medium sphere was still broken.

**Root cause not addressed:** 0.04 UV on sphere R=10 ≈ **1.26 world units** in V direction.
Player radius ~0.15 + enemy radius ~0.30 = 0.45 world units. The threshold was **3× too large**.

**Dead ends ruled out:**
- Map scaling IS correct (larger maps need smaller UV thresholds)
- The issue is not wrap-around (uvDistWrapped handles that correctly)
- The issue is not invincibility (it was working)

---

## Iteration 2 (S38b, commit pending) — World-Space Collision for Sphere

**Root cause:** UV Euclidean distance is fundamentally broken for sphere because the UV
metric is non-uniform. The azimuthal (U) metric shrinks to zero at the poles, while the
polar (V) metric stays constant at π×R per UV unit. This creates wildly asymmetric hitboxes.

**Specific example on sphere R=10 medium:**
- `0.04 UV` in V direction → `0.04 × π × 10 = 1.26 world units`
- `0.04 UV` in U at equator → `0.04 × 2π × 10 = 2.51 world units` (6× too large!)
- `0.04 UV` in U at pole (V=0.05) → `0.04 × 62.83 × 0.156 = 0.39 world units` (OK but asymmetric)

**Visual context:** The weapon pickup's glow sprite is 1.5 world units radius. The enemy collision
at 1.26 world units means enemies kill the player when inside the pickup's glow zone. The user
says "pickup radius effect zone" = the pickup visual glow radius.

**Fix:** For sphere-like surfaces (sphere, sphere-tunnel, capsule, icosahedron), use
great-circle arc distance formula:
```typescript
function sphereGreatCircleDist(u1, v1, u2, v2, R) {
  const phi1 = v1 * π, phi2 = v2 * π;
  const theta1 = u1 * 2π, theta2 = u2 * 2π;
  const dot = sin(phi1)*cos(theta1)*sin(phi2)*cos(theta2)
            + sin(phi1)*sin(theta1)*sin(phi2)*sin(theta2)
            + cos(phi1)*cos(phi2);
  return R * acos(clamp(dot, -1, 1));
}
```

**World-space thresholds (sphere-like):**
- `ENEMY_HIT_WORLD = 0.5` (player 0.15 + enemy 0.30 + margin 0.05)
- `PICKUP_WORLD = 0.6` (matches client-side PICKUP_WORLD_RADIUS constant)
- `GEOM_WORLD = 0.7`

**UV thresholds (non-sphere surfaces, unchanged approach):**
- `ENEMY_HIT_RADIUS = 0.02 / scaleFactor` (was 0.04 — halved)
- `PICKUP_RADIUS = 0.02 / scaleFactor`
- `GEOM_RADIUS = 0.025 / scaleFactor`
- `BULLET_HIT_RADIUS = 0.015 / scaleFactor` (unchanged — anti-tunneling calibrated)

**Why world-space threshold doesn't need to scale with map:**
Player and enemy visual sizes are fixed world-space constants regardless of map scale.
The sphere radius changes (R = 10 × scaleFactor), but the great-circle formula uses this R
directly when computing the actual arc distance. A 0.5-world-unit threshold is correct on
any map size because the entities (player 0.15, enemy 0.30) don't scale.

**Test coverage:** `src/test/mp-hit-detection-sphere.test.ts`
- Verifies great-circle function accuracy
- Verifies old UV code gives false positives (regression test for the bug)
- Verifies enemies at 1.5 world units (pickup glow) do NOT trigger hit
- Verifies enemies at 0.4 world units DO trigger hit
- Verifies near-pole correctness

**Key architecture learning:** SP game uses world-space 3D Euclidean distance for collision
(see CollisionSystem.ts, GameInstance.ts). Server LAN game used UV distance, which is
fundamentally less accurate. For sphere surfaces, world-space is the only correct approach.
