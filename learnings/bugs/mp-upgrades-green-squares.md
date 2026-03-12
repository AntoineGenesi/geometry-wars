# MP Upgrades Showing as Green Squares

## Timeline
- **First reported:** 2026-03-12 — "my upgrades in the multiplayer are just showing up as green squares now" (source: inbox/2026-03-12_1649.md)
- **Fixed:** 2026-03-13 (s44r13-13) — SP-MP parity fix in network-main.ts

## Root Cause (CONFIRMED — not what original dossier said)

**Original hypothesis was WRONG:** "MP doesn't load icon texture atlas" — NO texture atlas exists anywhere. ALL weapon/buff icons are Canvas-based (document.createElement('canvas') + 2D context drawing). No PNG/SVG files loaded for weapon icons.

**Actual root cause:** SP-MP parity gap in WeaponHUD weapon inventory:
- **SP (RenderLoop.ts:409):** `weaponHUD.update(ctx.weaponManager.getInventory(), ...)` — passes ALL collected weapons
- **MP (network-main.ts, before fix):** Only `[Standard, activeWeapon]` passed — just 1-2 squares visible

When PlasmaMortar (weapon color = 0x44ff44 = bright green) was the active weapon, MP HUD showed ONLY that one green 20×20px square. User saw "a green square" instead of the full row of weapon icons showing all weapons with their varied colors.

## What Was Fixed (s44r13-13)

**File changed:** `src/network-main.ts`

Added `localCollectedWeapons: Map<WeaponType, number>` that:
1. Initializes with `[Standard, -1]` (Standard always present)
2. Adds each new weapon type when first seen in server state (on active weapon change)
3. Updates ammo count for the active weapon each frame
4. Resets on round start (same as SP death/round-reset behavior)
5. Passes full map to `weaponHUD.update()` on every frame

Also added `weaponHUD.showPickupNotification()` when a new weapon is collected (SP parity).

## Icon Architecture (for future reference)

ALL weapon/buff icons are Canvas-based — no external file loading:
- **WeaponHUD:** HTML divs with `background-color` = weapon color + letter symbol (e.g., 'M' for PlasmaMortar)
- **BuffHUD:** HTML divs with `background: rgba(r,g,b,0.15)` + buff shortName text
- **PickupIconSprite.ts:** THREE.CanvasTexture drawn via Canvas 2D API (octahedra/hexagonal 3D pickups)
- **WeaponMasteryScreen:** SVG + CSS circular nodes (border-radius: 50%), NOT squares

## Verification

Level 1 (TypeScript compiles). Level 6 (user testing) needed to confirm visual improvement.

## Key Colors That Are Green By Design

These are NOT bugs — they are intentional green colors:
- PlasmaMortar weapon: `0x44ff44` → green WeaponHUD square + green 3D octahedron
- Afterburner buff (AFT): `iconColor: 0x44ff44` → green BuffHUD square
- Mastery:Mortar buff (M:M): `iconColor: 0x44ff44` → green BuffHUD square
- BuffPickupNew "uncommon" rarity ring: `0x44ff44` → green wireframe ring
