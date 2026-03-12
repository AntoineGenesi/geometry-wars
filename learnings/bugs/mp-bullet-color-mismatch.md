# MP Bullet Color Different From SP

## Timeline
- **First reported:** 2026-03-12 — "I don't know why my bullets are different colours on the multiplayer when they are in single player, but they are." (source: inbox/2026-03-12_1649.md)
- **Fixed:** commit `1b63a787` — "fix: tesla coil continuous damage + MP bullet color parity (s44r12-07)"
- **Status (March 2026):** FIXED

## Root Cause
MP bullet rendering used default/fallback color instead of the weapon-specific color constants. SP and MP had separate bullet creation code paths; when weapon color was set in SP path it wasn't applied in MP path.

## What Worked
- Applying `GameBalanceConstants` weapon color values to MP bullet rendering path

## What DIDN'T Work
- N/A — fixed on first proper attempt once identified

## Regression Risk
- If new weapons are added, ensure weapon color is defined in shared constants (`GameBalanceConstants.ts`) and applied in BOTH SP and MP bullet creation code paths
