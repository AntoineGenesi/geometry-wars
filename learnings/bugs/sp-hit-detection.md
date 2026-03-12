# SP Hit Detection (Player Death Radius)

## Timeline
- **First reported:** 2026-02-12 — "the game crashes near the start... when my bullets are within a certain radius of an enemy" (source: archive/inbox/2026-02-12_0730.md) — early crashing issue
- **Specific hit detection complaint:** 2026-02-18 — "the cube map has glitches everywhere, like bullets getting caught in vertices on the edges" (source: archive/inbox/2026-02-18_0900.md)
- **Player death radius too large:** 2026-02-21 — "the radius for picking up like pickups and bonuses is like way too... makes no sense" (source: archive/inbox/2026-02-21_0100.md)
- **Still too large (Mobius/different maps):** 2026-02-28 — "Near the top, I'm dying when they're literally just getting into the radius of my effect, not even touching me" (source: archive/inbox/2026-02-28_0150.md)
- **Fix attempt 1:** commit `377a89de` — "gate hit detection OR fallback to Mobius-only + reduce playerRadius (s44r12-01)" — Mobius gate gating added; playerRadius reduced
- **Verified fixed on all 13 surfaces:** commit `9b145174` — "verify: hit detection fix via scenario harness on all 13 surfaces (s44r12-01-verify)"
- **Regression (s44r10→s44r12):** 2026-03-12 — "hit detection on the sphere is way too early still. For the bullets, it's good; for the player, I'm still dying" (source: inbox/2026-03-12_1649.md) — FIXED by s44r12-01
- **Status (March 2026):** FIXED in SP via s44r12-01 and scenario harness verification

## Root Cause
Player death radius (`playerRadius`) was too large, causing death when enemies were visually 1-2 body widths away. Additionally, on Mobius surface the OR-fallback calculation was using an incorrect path that inflated the effective radius near the UV seam.

Two separate issues:
1. The raw `playerRadius` constant was too large (reduced in s44r12-01)
2. Mobius-specific: hit detection used the wrong branch — an OR condition that should only activate on Mobius was activating on other surfaces via EnemySpawner UV wrapping bug (s44r10-02)

## What Worked
- Reduce `playerRadius` in `CollisionSystem.ts`
- Gate the Mobius OR-path to only apply when `surface.type === 'mobius'`
- EnemySpawner fallback UV: use `UV + 0.5` for wrapping surfaces so enemies don't spawn at UV=0 which maps to poles (s44r10-02)
- Verification via scenario harness on all 13 surfaces

## What DIDN'T Work (dead ends)
- Increasing the dimming threshold instead of fixing the radius (masked symptoms)
- Individual surface special-casing without the Mobius gate

## Regression Risk
- If `playerRadius` is increased again for gameplay tuning, death radius will feel wrong again
- Mobius gate: if CollisionSystem.ts OR-logic is changed, Mobius UV seam may cause false deaths
- See: `src/collision/CollisionSystem.ts` — REGRESSION GUARD markers
- Scenario harness `hit_detection` test must pass on all 13 surfaces before merge
