# MP Hit Detection (All Maps Broken)

## Timeline
- **First reported:** 2026-02-23 — "the radius of the attack entity, like when I shoot one, I shoot next to it, and this doesn't actually hit it, but my bullet doesn't hit it, but yet the thing dies. Their hit detection is way too big" (source: archive/inbox/2026-02-23_0100.md)
- **Near-pole death:** 2026-02-28 — "Near the top, I'm dying when they're literally just getting into the radius of my effect, not even touching me. This is ridiculous." (source: archive/inbox/2026-02-28_0150.md)
- **Fix attempt 1:** commit `b1be1b3d` — "fix: MP hit detection — use exact player world pos for all surfaces (s44r8-02)" — improved significantly
- **Still broken (UV-dependent):** 2026-03-01 — "hit detection for bullets for enemies should be when it touches them, like, physically touches them. What you've got now is dumb — 15 bullets will go through an enemy, and then finally one won't." (source: archive/inbox/2026-03-01_0430.md)
- **Cube-specific:** 2026-03-09 — "Cube map hit detection f___ broken. I'm dying when enemies are multiples of my body away from me. They're like two times away from my body and then I die." (source: inbox/2026-03-09_0900.md)
- **All maps:** 2026-03-10 — "hit detection completely broken. Again, on every single map, including multiplayer and single-player." (source: inbox/2026-03-10_1200.md)
- **Cause identified:** s44r5 — "server sends sphere-approximation UVs → wrong tangent vectors on non-spherical surfaces. Fix: `surface.worldToSurface(mesh.position)` at 4 locations in network-main.ts"
- **Torus delay:** 2026-03-08 — "I shot a bullet and it went past these entities, and then literally like 5 seconds later a minus symbol came from them" — server-side collision check using stale UV, 5-second delay (source: inbox/2026-03-08_1200.md)
- **Status (March 2026):** STILL OPEN for MP — SP fixed; MP hit detection remains inconsistent

## Root Cause
MP uses server-authoritative collision using UV-based positions sent from server, which are sphere-approximation UVs for ALL surfaces. On non-spherical surfaces (torus, peanut, cube), the UV-mapped world position diverges significantly from the actual mesh position. This causes:
- Bullets to "miss" enemies visually but hit them by UV distance
- Player to "die" from enemies physically far away because UV distance is smaller than visual distance
- Per-surface inconsistency because UV distortion varies by surface shape

Root cause confirmed in `decisions/` and `MEMORY.md` (s44r5 entry): "Server sends sphere-approximation UVs for ALL surfaces. On non-spherical surfaces, `surface.getPoint(sphereUV)` gives wrong tangent vectors."

## What Worked
- Using `surface.worldToSurface(mesh.position)` for player world position at 4 locations in `network-main.ts`
- Server-trust model (client-reported positions used for collision instead of server-recalculated UV)

## What DIDN'T Work (dead ends)
- Reducing hit radius constants without fixing coordinate system
- Per-surface radius adjustments (band-aid approach)
- Christoffel symbols-based position tracking on server (mathematically correct but too slow)

## Regression Risk
- MP hit detection depends on client position trust — changing to server-authoritative UV positions will break it again
- Every time `network-main.ts` player position handling is modified, verify hit detection on torus and peanut (most sensitive surfaces)
- Peanut near-waist and near-pole: UV compression means world position and UV position diverge maximally there
