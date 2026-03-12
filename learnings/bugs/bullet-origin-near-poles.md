# Bullets Don't Originate From Player Near Sphere Poles (MP)

## Timeline
- **First reported:** 2026-03-02 — "On the Peanut, my guy wasn't as far; the bullets were emanating from a position a little bit behind where my guy was" (source: inbox/2026-03-02_0830.md)
- **Torus-specific:** 2026-03-03 — "on the torus, when I'm on the outside surface, the entity that shoots, it was coming from next to where my guy spawns, right? That shadow entity, it's still not exactly where I am. The second I go on to the outside, complete half of the Taurus's surface, the bullets stop emanating from my guy" (source: inbox/2026-03-03_0900.md)
- **Peanut middle:** 2026-03-03 — "Peanut map is completely screwed up. When my guy goes over to Peanut and is on the little side or in the middle of it where the bullets are coming from a spot much further down, not where my guy is." (source: inbox/2026-03-03_0001.md)
- **Still broken near poles:** 2026-03-12 — "If you are near the pole on the sphere, the bullets do not originate from you, from the character." (source: inbox/2026-03-12_1649.md — listed in MEMORY.md)
- **Status (March 2026):** STILL OPEN (MEMORY.md: "MP: Bullets don't originate from player near sphere poles")

## Root Cause
Bullet spawn position in MP is calculated from the server-sent UV position mapped through `surface.getPoint(sphereUV)`. For spherical surfaces near poles, this UV→world conversion has high distortion — small UV moves map to large world moves. For non-spherical surfaces (torus inner ring, peanut waist), the sphere-approximation UV maps to entirely wrong world positions.

The result: bullet appears to spawn from a "shadow position" — the UV-mapped position — rather than the player's actual visual world position.

Fix direction: Use `surface.worldToSurface(mesh.position)` to get correct UV from actual mesh position, then fire bullet from actual mesh world position. This is the same fix needed for hit detection and pickup collection.

## What Worked
- Not yet fully fixed as of March 2026
- Partial improvement with worldToSurface approach for some surfaces

## Regression Risk
- All bullet spawn code in `network-main.ts` must use `mesh.position` (world space) not `serverUV` (UV space) for spawn origin
- Test: torus inner ring, peanut middle (waist), sphere poles — these are highest UV distortion regions
