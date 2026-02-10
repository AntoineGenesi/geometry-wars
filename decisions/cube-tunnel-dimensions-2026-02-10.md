# Cube Tunnel Surface Dimensions Adjustment

**Date:** 2026-02-10

**Issue:** User requested multiple times for:
- BIGGER hole in the middle (more open playable space)
- SMALLER/THINNER walls and edges
- BIGGER overall rectangle dimensions

## Changes Made

**File:** `src/surfaces/CubeWithTunnelSurface.ts`

### Constructor Defaults (lines 56-60)
```typescript
// OLD:
const size = config?.size ?? 50
const wallThickness = config?.wallThickness ?? 3.0

// NEW:
const size = config?.size ?? 100
const wallThickness = config?.wallThickness ?? 1.0
```

### getInitData Fallback (lines 87-90)
```typescript
// OLD:
size: 50, wallThickness: 3.0, bevelRadius: 6.0, gridSegments: 16

// NEW:
size: 100, wallThickness: 1.0, bevelRadius: 12.0, gridSegments: 16
```

## Dimensions Analysis

### Old Configuration
- **Outer size:** 50 units
- **Wall thickness:** 3.0 units
- **Inner hole:** ~44 units (50 - 2×3)
- **Playable width per face:** ~50 - 2×3 = 44 units (walls consume 3 units on each side)

### New Configuration
- **Outer size:** 100 units (2× bigger)
- **Wall thickness:** 1.0 units (3× thinner)
- **Inner hole:** ~98 units (100 - 2×1, much more open)
- **Playable width per face:** ~100 - 2×1 = 98 units (walls consume only 1 unit on each side)

**Result:** The hole in the middle is roughly 4-5× more open, walls are much thinner, and overall playable area is significantly larger.

## Verification

- ✅ TypeScript compilation: No errors
- ✅ File changes applied correctly
- ✅ Bevel radius auto-adjusted: `size * 0.12` = 12.0 (was 6.0)

## Reversibility

Easy - simply revert the two numeric constants:
- Constructor `size`: 100 → 50
- Constructor `wallThickness`: 1.0 → 3.0
- getInitData `size`: 100 → 50
- getInitData `wallThickness`: 1.0 → 3.0
- getInitData `bevelRadius`: 12.0 → 6.0
