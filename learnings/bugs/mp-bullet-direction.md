# MP Bullet Direction / Geodesic Path Bug

## Timeline
- **First reported:** 2026-02-21 — "it still doesn't feel like a geodesic greater circle, you know what I mean? It still feels like it's curving, it's weird" (source: archive/inbox/2026-02-21_0430.md)
- **Escalated:** 2026-02-27 — "The bullets in the multiplayer on the sphere were following the UV coordinates. How are you meant to fix this for the peanut and anything if you haven't fixed it for the sphere?" (source: archive/inbox/2026-02-27_1600.md)
- **More surfaces:** 2026-02-27 — "bullets on the torus were NOT Greater Circle / geodesic path, they were FOLLOWING THE UV Coordinates, and you would shoot a bullet across the donut, and it would do a quarter turn before then decelerating and then going the opposite way back to me" (source: archive/inbox/2026-02-27_2100.md)
- **Fix attempt 1:** commit around s38d-07b — parallel transport approach — FAILED according to user 2026-02-28
- **Regression introduced:** 2026-03-01 — "you've ruined the bullets. The bullets used to be in greater circle, and now they're not" (source: archive/inbox/2026-03-01_0300.md)
- **Acknowledged fixed:** 2026-03-01 — "thank god the bullets are fixed. The bullets are fixed, and that is good." (source: archive/inbox/2026-03-01_0400.md) — commit `ccc3c231` sphere-tunnel chord distance fix
- **New regression:** 2026-03-02 — "my gun wasn't shooting in the direction of my mouse. It was off by like 130 degrees." (source: inbox/2026-03-02_0445.md)
- **Torus-specific:** 2026-03-03 — "bullets are coming from a spot much further down, not where my guy is. As I move up, it comes back to me until the bullets are coming from me when I'm near the top or bottom pole" (source: inbox/2026-03-03_0001.md)
- **Peanut-specific:** 2026-03-03 — "Peanut map is completely screwed up. When my guy goes over to Peanut and is on the little side or in the middle of it where the bullets are coming from a spot much further down, not where my guy is" (source: inbox/2026-03-03_0430.md)
- **Fix:** commit `13d6c018` — "fix: bullet depth dimming inverted — use player normal instead of normalize(pos) (s44r8-01)"
- **Fix:** commit `ccc3c231` — "fix: sphere-tunnel hit detection — chord distance replaces great-circle (s44r7-04)"
- **Last status:** March 2026 SP bullets FIXED, MP bullets directional issues partially resolved but bullet origin offset still reported on torus/peanut

## Root Cause
Two separate bugs:

**1. Geodesic path (great-circle):** MP server was sending sphere-approximation UV coordinates for ALL surfaces, which caused bullets to follow UV-space coordinates (warped lines) instead of geodesic surface paths. Single-player used mesh surface `worldToSurface` for proper geodesic motion.

**2. Bullet origin offset:** Bullet spawn position used UV-based coordinate that diverges from actual player world position near poles and on non-spherical surfaces. On torus inner surface, bullets spawned from the "shadow" UV position, not the player's mesh position. Fix: `surface.worldToSurface(mesh.position)` for the 4 relevant locations in `network-main.ts`.

## What Worked
- Switching bullet direction from UV-space to surface tangent frame (player normal direction)
- Using `worldToSurface(mesh.position)` instead of server-sent UV for spawn position
- Chord-distance collision detection for sphere-tunnel (s44r7-04)

## What DIDN'T Work (dead ends)
- Christoffel symbols approach — mathematically correct but produced UV-curved paths
- Parallel transport approach (s38d-07b) — failed user test
- Per-surface special-casing without fixing the root coordinate system mismatch

## Regression Risk
- If `network-main.ts` bullet spawn code is changed, the `worldToSurface` call chain can be lost
- 4 specific locations in `network-main.ts` need `worldToSurface` — see s44r5 root cause doc
- SP works correctly; whenever MP code is modified, verify bullet direction matches SP on ALL surfaces
