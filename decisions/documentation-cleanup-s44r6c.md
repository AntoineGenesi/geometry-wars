# Documentation Cleanup — s44r6c-06

**Date:** 2026-03-10
**Task:** s44r6c-06-documentation-cleanup-thorough
**Worker:** sonnet

## Summary

Full documentation cleanup: dated all undated files, fixed stale code references, verified code references against current codebase, confirmed report archiving is complete.

---

## Research Files — Date Added

All dates sourced from `git log --format="%ai" -1 -- <file>` (first commit date = research creation date).

| File | Date Added |
|------|-----------|
| research/boss-research.md | 2026-02-08 |
| research/gw3d-game-details.md | 2026-02-08 |
| research/gw3d-visual-design.md | 2026-02-09 |
| research/rts-pivot-analysis.md | 2026-02-11 |
| research/surface-movement-approaches.md | 2026-02-06 |
| research/release-strategy.md | 2026-02-11 |
| research/market-research/ad-monetization.md | 2026-02-11 |
| research/market-research/competitors.md | 2026-02-10 |
| research/market-research/console-porting.md | 2026-02-10 |
| research/market-research/distribution.md | 2026-02-10 |
| research/market-research/international.md | 2026-02-10 |
| research/market-research/marketing.md | 2026-02-10 |
| research/market-research/revenue-projections.md | 2026-02-10 |

**Already dated (no changes needed):** 41 files (markets/ subdirectory, and most research/ files already had **Date:** headers).

---

## Docs Files — Date Added

| File | Date Added |
|------|-----------|
| docs/CUSTOM_MAPS.md | 2026-02-25 |
| docs/DEV_CUSTOM_MESHES.md | 2026-02-13 |
| docs/FAILED-EXPERIMENTS.md | 2026-03-10 |
| docs/INDEX.md | 2026-03-10 |
| docs/ISSUES-AND-SOLUTIONS.md | 2026-02-11 |
| docs/LAN-TROUBLESHOOTING.md | 2026-02-28 |
| docs/MP-ARCHITECTURE.md | 2026-03-01 |
| docs/README.md | 2026-03-01 |
| docs/analytics-guide.md | 2026-02-25 |
| docs/performance-graphs-integration.md | 2026-02-25 |
| docs/telemetry-schema.md | 2026-02-19 |
| docs/testing/frame-by-frame-diagnostics.md | 2026-02-13 |

**Already dated (no changes needed):** 6 files (ARCHITECTURE.md, HUMAN_TEST.md, MULTIPLAYER.md, mp-architecture-audit.md, future-work.md, ANALYTICS_GUIDE.md).

---

## Code Reference Fixes

### research/surface-movement-approaches.md

**Issue:** Section labeled "UV-Based Surface Parameterization (CURRENT)" — outdated. The project migrated to MeshWalker.

**Fix:**
- Header status: Added "Historical research — describes early UV-based approach. The project has since migrated to BVH mesh-walking (MeshWalker)."
- Changed section label from `(CURRENT)` to `(HISTORICAL — superseded by MeshWalker)`
- Recommendation section: Added historical note explaining the migration happened after this research was written

### research/surface-traversal-alternatives.md

**Issue:** Header said "Current approach: UV-based parametric surfaces + three-mesh-bvh" — still describes the 2026-02-07 approach.

**Fix:** Updated header to distinguish "approach at time of writing" from "current approach (2026-03-10) = MeshWalker"

### docs/ISSUES-AND-SOLUTIONS.md

**Issue:** Referenced `src/experimental/mesh-movement/MeshSurface.ts` and `src/experimental/mesh-movement/MeshWalker.ts` — these files have been moved.

**Verified:** `src/experimental/mesh-movement/` only contains test files. Actual files are at:
- `src/surfaces/MeshSurface.ts`
- `src/movement/MeshWalker.ts`

**Fix:** Updated file paths + added note explaining the move.

---

## RTS Pivot Analysis — Code Reference Audit

**research/rts-pivot-analysis.md** references these codebase components:

| Referenced | Current Status |
|-----------|---------------|
| `behaviors.ts` | ✅ EXISTS at `src/agents/behaviors.ts` |
| `SurfaceAgent` | ✅ EXISTS at `src/agents/SurfaceAgent.ts` |
| `FollowTargetBehavior` | ✅ EXISTS in behaviors.ts |
| `OrbitBehavior` | ✅ EXISTS in behaviors.ts |
| `PatrolBehavior` | ✅ EXISTS in behaviors.ts |
| `MoveToTargetBehavior` | ✅ EXISTS in behaviors.ts |
| `IdleBehavior` | ✅ EXISTS in behaviors.ts |
| `EnemySpawner` | ✅ EXISTS (verified via grep) |
| `MeshWalker` | ✅ EXISTS at `src/movement/MeshWalker.ts` |
| `SpatialHash` | ✅ EXISTS (found in source) |

**Added to file header:** Code reference status note confirming all references are valid as of 2026-03-10.

---

## Reports Archiving

**Status: Already complete before this task.**

- `reports/2026-02/` — All February reports already archived here (6 files)
- `reports/2026-03/` — All March reports already here (17 files)
- Root `reports/` — Only contains 2026-03-10 dated files (already properly named)

No archiving action needed.

---

## What Was NOT Changed

- **PROJECT.md / CLAUDE.md:** Not modified — these are actively maintained living documents, not research files. They're accurate to current session state.
- **Research content:** Not rewritten. Only dates and stale labels added/fixed per user instructions ("I'm not asking for research to be redone").
- **Market research (research/markets/):** Already had `**Researched:** 2026-02-10` headers — no changes needed.
- **docs/ARCHITECTURE.md:** Already has "STALE — Last updated 2026-02-11" notice.
- **docs/MULTIPLAYER.md:** Already has "NOTE — Last updated 2026-02-23" notice about splitscreen removal.
- **docs/future-work.md:** Already has "STALE — Created 2026-02-11" notice.
