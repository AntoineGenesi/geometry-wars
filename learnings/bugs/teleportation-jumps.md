# Teleportation Jumps (Random Player Teleportation)

## Timeline
- **First reported:** 2026-02-26 — "random teleportation in LAN — player randomly teleported to different location during gameplay" (source: archive/inbox/2026-02-26_0900.md)
- **Pole inversion (related):** 2026-03-01 — "If the player goes to the weird pole at the top of a sphere or peanut or whatever, we kind of get stuck there, and then we might twist around a bit...and then we just start moving again, but instead, our camera has been inverted" (source: archive/inbox/2026-03-01_0400.md)
- **Sphere pole jumps:** 2026-03-01 — "When I go exactly over the surface of a sphere, like in the multiplayer, like when I go over the pole of a sphere, it literally is opening up into VR. It's like then the control is switching, so my up and down is still fine, but then my left and right are still inverted." (source: inbox/2026-03-01_0841.md)
- **Peanut pole:** 2026-03-01 — "on the peanut map or whatnot... the poles still, like, do some weird stuff. A player can't, if they're going up, then their coordinate system is restricted by the UV. They actually can't go to the side of the pole to cross over." (source: inbox/2026-03-01_0841.md)
- **Sphere-tunnel morphing:** 2026-03-03 — "sphere-with-tunnel map — player morphing through surface, going into tunnel through surface instead of staying on it" (source: inbox/2026-03-03_0430.md)
- **Sphere-tunnel teleport in single player:** 2026-03-10 — "on mobile, on iPhone...when I get to the actual poles, the north or south pole, when you get very close to the pole, it then will skip you over and you'll skip over the axis" (source: inbox/2026-03-10_0900.md) — earlier report
- **Confirmed ongoing stress test bugs:** MEMORY.md March 2026 — "STRESS: teleportation jumps on sphere, cube, cube-ring, peanut, mobius-bevel"
- **Last status:** STILL OPEN (listed in known current bugs in MEMORY.md)

## Root Cause
UV-coordinate singularities at poles cause the player's position to snap discontinuously when crossing the pole axis. The UV parameterization maps the pole to a single UV point (u=anything, v=0 or v=1), creating a singular region where movement along the surface is impossible to represent. When the player crosses the pole, the UV coordinate wraps around, causing a large discontinuous jump in UV space even when world-space movement is smooth.

Separate issue: sphere-tunnel players can "morph through" the surface because the surface boundary check doesn't correctly detect transitions between the outer sphere and inner tunnel geometry.

## What Worked
- SP mesh walker handles poles smoothly (works in single player already)
- Peanut movement improved in s44r5+

## What DIDN'T Work (dead ends)
- Clamping UV at poles — prevents crossing but locks player
- Standard UV-based movement system inherently fails at poles

## Regression Risk
- This is fundamentally a UV parameterization problem; any UV-based movement system will have pole issues
- MP is more vulnerable because server uses UV-based positions; SP uses mesh walker which handles poles correctly
- Fix direction: use `surface.worldToSurface(mesh.position)` mesh-based movement for MP (same as SP)
- Test coverage: scenario harness traversal test should traverse pole region and verify no coordinate jump
