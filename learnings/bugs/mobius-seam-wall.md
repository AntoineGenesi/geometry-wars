# Mobius Strip Seam Wall (Movement Blocked)

## Timeline
- **First reported:** 2026-02-19 — "Mobius strip screws you up at the 'end' — camera glitch, sends you back the way you came. Unplayable." (source: archive/inbox/2026-02-19_0100.md)
- **Persistent:** 2026-03-01 — "Still on the Mobius map if I keep going around the strip eventually I hit the end, this UV line. This random section just does not let me cover it, go past it." (source: inbox/2026-03-01_0841.md)
- **Escalated frustration:** 2026-03-09 — "Still on the Mobius map if I keep going around the strip eventually I hit the end, this UV line. This random section just does not let me cover it, go past it. It's completely broken." (source: inbox/2026-03-09_0900.md)
- **Partially fixed:** 2026-03-10 — "Mobius movement works well and it's all looking good there. That map looks actually pretty perfect." (source: inbox/2026-03-10_0900.md)
- **Bullets cross seam correctly:** 2026-03-10 — "on mobius the bullets cross the seam correctly." (source: inbox/2026-03-10_0900.md)
- **Status (March 2026):** FIXED for SP movement. Hit detection still inconsistent on Mobius (hit detection OR fallback fix in s44r12-01).

## Root Cause
The Mobius strip's UV seam (where u=0 and u=1 meet, but with a half-twist) created an impassable "wall" for the mesh walker. The mesh walker tried to cross the seam by continuing UV coordinates, but the UV discontinuity (from the twist) caused a large jump in the computed world position. The player would hit the seam and be reflected back.

Fix: The mesh walker needed to handle the Mobius seam as a special case — when detecting the UV seam approach, instead of reflecting, it should apply the half-twist transformation and continue on the other side.

Hit detection: the OR-fallback path in CollisionSystem.ts was also affected by the seam (s44r12-01 fix gated OR to Mobius-only).

## What Worked
- Special seam handling in mesh walker for Mobius topology
- Gating the hit detection OR-fallback to Mobius-only (s44r12-01)

## What DIDN'T Work
- Standard UV continuation (produces position jump at seam)
- Clamping UV at seam (blocks player movement)

## Regression Risk
- Mobius seam logic is unique to Mobius topology; do not apply similar logic to other surfaces
- If mesh walker is refactored, preserve the Mobius seam special case
- Hit detection: the OR-fallback in CollisionSystem.ts MUST be gated to Mobius only — see REGRESSION GUARD
