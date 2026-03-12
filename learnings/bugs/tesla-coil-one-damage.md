# Tesla Coil Only Damages Once (Should Be Continuous)

## Timeline
- **First reported:** 2026-03-03 — "the Tesla coil is activated and it should be killing the enemies that are inside it, and it's even not killing them or it's killing them but not showing the damage numbers" (source: inbox/2026-03-03_0900.md)
- **Clarified:** 2026-03-09 — "Tesla coil should follow around your body... it should be like this: it stays around you. But then, there can be an upgrade where it actually both stays around you and it leaves a sphere behind." (source: inbox/2026-03-09_0900.md — actually 2026-03-02_0910.md)
- **MP-specific:** 2026-03-12 — "the Tesla coil is just one ultra dense sphere that only hurts the enemies once when they're in it. They should be getting hurt immediately as they're in it, like as the Tesla coil is existing; it hurts them, but for some reason enemies walk into it on the multiplayer now and they just die a little bit at the start and then they don't take more damage" (source: inbox/2026-03-12_1649.md)
- **Fixed:** commit `1b63a787` — "fix: tesla coil continuous damage + MP bullet color parity (s44r12-07)"
- **Status (March 2026):** FIXED

## Root Cause
Tesla coil in MP was applying damage once on collision enter but not continuously while enemies remained inside the AoE radius. SP implementation used a tick-based damage system; MP implementation used a single collision event. Fix: convert MP tesla coil to tick-based continuous damage, matching SP behavior.

## What Worked
- Tick-based continuous damage (matching SP tesla coil implementation)

## Regression Risk
- If tesla coil AoE logic is changed in SP, verify MP receives the same change
- Continuous damage weapons must use the tick system, not collision events
