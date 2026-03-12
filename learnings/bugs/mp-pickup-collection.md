# MP Pickup Collection Broken

## Timeline
- **First reported:** 2026-02-21 — "the special effects of weapons... in the multiplayer, I don't think I was actually able to use it" — indirect pickup issue (source: archive/inbox/2026-02-21_0100.md)
- **Explicit pickup complaint:** 2026-02-26 — "Pickups inconsistent — some picked up too early, others only when right on them. Torus still glitchy." (source: archive/inbox/2026-02-26_0900.md)
- **Radius too large (SP):** 2026-02-21 — "the radius for picking up like pickups and bonuses is like way too, it's so much larger than the character, like it makes no sense" (source: archive/inbox/2026-02-21_0100.md)
- **Fix for radius too large:** commit `0d4a0121` — "fix: SP-MP parity — bullet lifetime scaling + pickup radius unification (s44r8-06)"
- **Fix for pickup collection:** commit `4779d5b4` — "fix: MP pickup collection — use mesh.position+worldToSurface instead of lagging server UV (s44r9-04)" — PARTIAL
- **Still broken after fix:** 2026-03-01 — "the pickups, again, it's the same case with the pickups... I'm getting them when I'm not even that close. Like, it's like more than two of me away from them." (source: inbox/2026-03-01_0841.md)
- **Radius too small (overcorrected):** 2026-03-03 — "sometimes they're a bit difficult to get. I swear I'm going over it... my centre is perfectly over the centre of the pickup. It just needs to be a little bit more relaxed" (source: inbox/2026-03-03_0001.md)
- **Not visible:** 2026-03-12 — "MP: Pickups not visible" (MEMORY.md March 2026)
- **Status (March 2026):** STILL OPEN — pickups not visible in MP, collection radius inconsistent

## Root Cause
Two separate problems:
1. **Collection radius:** Server used UV-based position for pickup proximity check, which diverges from visual position on non-spherical surfaces. Player visually walks "through" a pickup but their UV position is still far from the pickup's UV position.
2. **Rendering:** MP pickups may not be rendering at all (green squares issue) — MP rendering path missing or broken for pickup visuals

## What Worked
- `worldToSurface(mesh.position)` instead of server UV for proximity check (s44r9-04) — improved but didn't fully solve
- Unifying pickup radius between SP and MP (s44r8-06)

## What DIDN'T Work (dead ends)
- Simply adjusting the pickup radius constant (doesn't address coordinate mismatch)
- Server-side UV proximity check (inherently wrong for non-spherical surfaces)

## Regression Risk
- Any time the pickup proximity check in `network-main.ts` is changed, verify on torus and peanut (worst UV distortion)
- MP rendering path for pickups is separate from SP; both need to be updated together
