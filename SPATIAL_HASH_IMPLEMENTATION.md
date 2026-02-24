# Spatial Server-Side Hashing — Implementation Notes

**Branch:** `task/s28c-spatial-server-hash-worktree-test`
**Date:** 2026-02-24
**Status:** Complete — compiles, server starts, all tests pass

---

## What Was Implemented

### 1. float32 Schema Optimization (`server/schema/GameState.ts`)

Changed UV position and floating-point fields from `'number'` (64-bit float, 8 bytes)
to `'float32'` (32-bit float, 4 bytes):

| Schema | Fields Changed |
|--------|---------------|
| PlayerState | surfaceU, surfaceV, aimAngle |
| BulletState | x, y, z, dirX, dirY, dirZ, age |
| EnemyState | surfaceU, surfaceV |
| GeomState | surfaceU, surfaceV |
| WeaponPickupState | surfaceU, surfaceV, age |
| GameState | gameTime, votingCountdown |

**Estimated bandwidth savings:** ~15-20% per patch.
UV coordinates (0-1 range) and angles (0-2π) need far less than 64-bit precision.
float32 gives ~7 decimal digits of precision — more than enough for 0.012 UV collision threshold.

### 2. InterestManager Integration (`server/rooms/GameRoom.ts`)

Integrated the existing `InterestManager` (Option C: visibility messages).

**How it works:**
- Server runs InterestManager each tick at 10 Hz (every 6th tick at 60 Hz)
- For each client, computes which entities are within their AOI (0.3 UV units)
- Sends a `'visibility'` message to each client with visible entity ID sets
- Existing Colyseus schema state sync is **unchanged** (no breaking changes)
- Clients that don't handle `'visibility'` messages silently ignore them

**Message format:**
```
'visibility': {
  e: string[],  // visible enemy IDs
  b: string[],  // visible bullet IDs
  g: string[],  // visible geom IDs
  p: string[],  // visible pickup IDs
  savings: number,  // estimated bandwidth savings % (for debugging)
}
```

**Server log output (every 30 seconds):**
```
[InterestManager] savings=72%, total_entities=150, avg_synced=42
```

---

## Bandwidth Savings Estimate

With 90 enemies, 80 bullets, AOI radius = 0.3 UV:
- float32 schema alone: ~15-20% savings per patch
- If client uses visibility to skip rendering: ~30% client CPU savings
- Full Option B (custom message entity sync, not implemented): ~65-72% bandwidth savings

---

## Test Results

- `server/rooms/GameRoom.test.ts`: **93/93 tests pass**
- `server/systems/InterestManager.test.ts`: **54/54 tests pass**
- Server starts and listens on port 2567 without errors

---

## What Was NOT Implemented

- **Full Option B** (remove entities from schema, send custom messages instead) — 5-8 days effort
- **patchRate change** (16ms → 50ms) — deliberately skipped; existing comment explains 16ms is needed to avoid entity stutter on LAN
- **Client-side visibility filtering** — client code unchanged; client can ignore or use the `'visibility'` messages

---

## To Use in Main Branch

If this is ready to merge:
1. Cherry-pick or merge `task/s28c-spatial-server-hash-worktree-test` to main
2. Update `src/network-main.ts` to handle `'visibility'` messages if client-side filtering is desired
3. No schema migration needed (float32 is wire-compatible change, client gets correct values)

---

## Files Changed

- `server/schema/GameState.ts` — float32 schema fields
- `server/rooms/GameRoom.ts` — InterestManager integration (+119 lines)
