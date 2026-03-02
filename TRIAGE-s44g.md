# Triage Report: S44g — Critical MP Issues + Feature Request

**Date:** 2026-03-03
**Processed by:** Triager (haiku)
**Total Tasks:** 6 (1 CRITICAL, 2 HIGH, 3 STANDARD)

---

## Summary

User voice dump revealed 6 new issues, mostly regressions from recent S44f merges. The server crash (s44g-01) is BLOCKING — game literally unplayable. Tasks s44g-03, s44g-04, s44g-06 are regressions from supposedly-fixed issues (s44f-01, s44f-03, s44f-08 didn't actually work).

---

## Task Breakdown

| Task | Priority | Complexity | Depends | Notes |
|------|----------|-----------|---------|-------|
| **s44g-01** | **CRITICAL** | QUICK | none | **BLOCKS ALL GAMEPLAY** — ReferenceError crash every game |
| **s44g-02** | High | STANDARD | s44g-01 | Feature: host controls lives + respawn modes |
| **s44g-03** | High | QUICK | s44g-01 | Regression: map buttons UI broken (s44f-01 failed) |
| **s44g-04** | High | STANDARD | s44g-01 | Regression: weapons glitched (s44f-03 failed) |
| **s44g-05** | High | STANDARD | s44g-01 | EPIC map spawn position off-surface |
| **s44g-06** | Medium | STANDARD | s44g-01 | Regression: bullet position lag (s44f-08 failed) |

---

## Execution Plan

### Wave 1: BLOCKER FIX (solo, high priority)
**Duration:** ~10 min
**Executor:** haiku worker (QUICK fix)

- **s44g-01: Server Crash** [QUICK, haiku]
  - Fix ReferenceError: move `owner` variable declaration before use
  - Unblock all MP gameplay
  - All other tasks depend on this

### Wave 2: Regressions + New Feature (parallel after Wave 1)
**Duration:** ~40-50 min total
**Executors:** 2-3 sonnet workers in parallel

After s44g-01 is fixed and verified, launch these in parallel:

- **s44g-03: Map Buttons** [QUICK, haiku]
  - Debug why s44f-01 fix didn't work
  - Apply correct CSS/styling
  - ~10 min

- **s44g-04: Weapons** [STANDARD, sonnet]
  - Debug why s44f-03 dual-fire fix didn't work
  - Check fire rate constants, independent timers, bullet type tracking
  - ~20 min

- **s44g-02: Lives System** [STANDARD, sonnet]
  - Host input for lives count
  - Implement two respawn modes
  - ~25 min

### Wave 3: Remaining Issues (after Wave 2)
**Duration:** ~30-40 min total

- **s44g-05: EPIC Spawn** [STANDARD, sonnet]
  - Apply mapSizeScaleFactor to spawn position
  - ~15 min

- **s44g-06: Bullet Lag** [STANDARD, sonnet]
  - Client-server sync: use most recent player position for bullet spawn
  - ~20 min

---

## Why Wave Structure

1. **Wave 1 solo:** s44g-01 is a true blocker. No other work can be tested/verified until the crash is fixed.
2. **Wave 2 parallel:** s44g-03 (UI) and s44g-04 (gameplay) don't conflict. Both depend on Wave 1 fix. s44g-02 is independent feature work.
3. **Wave 3 parallel:** s44g-05 and s44g-06 are independent gameplay tweaks that can run in parallel.

---

## Regression Analysis

Three "supposedly fixed" tasks are broken again:

| Original Task | Current Status | Root Cause Guess |
|---|---|---|
| s44f-01 (map buttons) | BROKEN | CSS not applied properly, or only applied to one variant |
| s44f-03 (weapons) | BROKEN | Independent timers still have issues, fire rates not synced, or bulletType tracking wrong |
| s44f-08 (bullet position) | PARTIALLY BROKEN | Network sync timing not resolved, client still using stale position |

**Recommendation:** After these fixes, add regression tests to prevent re-break in future merges.

---

## Context for Workers

Before starting:
- Read `PROJECT.md` for architecture
- The server crash MUST be fixed first (s44g-01)
- All fixes are MP-related (network/Colyseus code)
- User has been frustrated with multiple fix attempts on these issues
- **Verification level 5 required** (Puppeteer screenshot + describe what you see)

---

## File Locations

All task files in `/home/antoine/claude code experiments/Geometry Wars/tasks/s44g-*.md`

Key source files:
- Server: `server/rooms/GameRoom.ts` (crash location, weapon logic, spawn)
- Client: `src/network-main.ts` (bullet spawning, position sync)
- UI: `src/multiplayer-main.ts` (map buttons, lobby)
- Constants: `server/shared/GameConstants.ts` (fire rates, scalars)
