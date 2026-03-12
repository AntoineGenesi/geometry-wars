# MP Upgrades Showing as Green Squares

## Timeline
- **First reported:** 2026-03-12 — "my upgrades in the multiplayer are just showing up as green squares now" (source: inbox/2026-03-12_1649.md)
- **Status (March 2026):** STILL OPEN (listed in MEMORY.md known current bugs)

## Root Cause (Hypothesized)
MP rendering path for weapon/upgrade icons uses a fallback placeholder (green square) instead of the actual weapon icon textures. Likely the icon texture atlas is not being loaded or referenced correctly in the MP rendering code path.

The SP rendering path loads weapon icons correctly; MP either doesn't initialize the icon system or uses a different texture reference that resolves to a default green square placeholder.

## What Worked
- Not yet fixed as of March 2026

## Regression Risk
- Verify when fixing: check that icon textures are loaded in MP initialization, not only in SP game loop setup
- Use `GameBalanceConstants.ts` for weapon icon references to ensure SP and MP use the same source
