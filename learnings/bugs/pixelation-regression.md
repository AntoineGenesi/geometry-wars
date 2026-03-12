# Pixelation Regression / Pixel Ratio Calibration

## Timeline
- **Feature requested:** 2026-02-19 — "Pixelated vs modern aesthetic toggle" — wants choice in settings (source: archive/inbox/2026-02-19_0900.md)
- **Toggle broken on WebGPU:** commit `dec8993b` — "Fix pixelated mode toggle on WebGPU — pixel ratio adjustment (s44r9-03)"
- **Too pixelated (overcorrected):** 2026-03-12 — "The pixelated version needs to be more pixelated. It's not as pixelated as it used to be." AND later "the pixelated graphics, they're too pixelated. Now it's way too pixelated. You do midway between where you were and what you're at now." (source: inbox/2026-03-12_1649.md)
- **Fix attempt 1:** commit `bebdf8c5` — "fix: pixelated mode more intense — 0.5→0.25 pixel ratio (s44r10-04)" — went TOO pixelated
- **Fix attempt 2:** commit `c4768c97` — "fix: pixelation intensity midway 0.25→0.375 (s44r12-04)"
- **Status (March 2026):** FIXED at 0.375 pixel ratio (midway between 0.25 too-pixelated and 0.5 not-pixelated-enough)

## Root Cause
The pixelated aesthetic is controlled by the device pixel ratio — lower ratio = more pixelated. The value was adjusted between 0.5 (subtle pixelation), 0.25 (very blocky), and the user-preferred 0.375 (moderate pixelation). The WebGPU path required separate handling because it uses a different renderer initialization.

## What Worked
- Pixel ratio 0.375 — user confirmed as acceptable midpoint

## What DIDN'T Work
- 0.5 — too subtle, not "pixelated enough"
- 0.25 — too blocky/pixelated

## Regression Risk
- Pixel ratio should not be changed without user sign-off
- WebGPU and WebGL paths both need the same ratio adjustment
- Current value: 0.375 (in `src/core/GameLoop.ts` or similar renderer config)
