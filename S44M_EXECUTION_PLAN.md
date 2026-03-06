# S44m Autonomous Execution Plan

**Session:** s44m (2026-03-07, User going to sleep)
**Mode:** Autonomous execution — 12 detailed task files created, ready for orchestrator workers
**Git Checkpoint:** cefef701a1bf21673dec4fd9e06bf135b3ecf2d8 (06:28 AM, 2026-03-07)

---

## Overview

User submitted voice dump with 20+ distinct issues and requests. This plan:
1. Triaged into 12 concrete task files
2. Organized into 3 execution waves
3. Identified dependencies and parallelizable tasks
4. Sized EPIC tasks for planner decomposition
5. Ready for orchestrator worker execution

**User Context:**
- Frustrated with recurring regressions (peanut map, difficulty scaling, pickups)
- Demanded grid traversal testing framework (catch edge clipping bugs)
- Demanded intelligent analytics dashboard
- Wants final pass on multiple systems before testing
- Set to autonomous mode — expects everything to run while sleeping

---

## Wave 1: Critical Regressions (HIGH PRIORITY — Execute FIRST)

**Objective:** Fix issues directly blocking gameplay or violating core mechanics
**Parallelization:** All 6 tasks CAN run in parallel (no dependencies)
**Timeline:** 60-90 minutes total (workers in parallel)
**Model Tier:** Sonnet for all workers

### Task Breakdown

| Slug | Title | Complexity | Depends | Status |
|------|-------|-----------|---------|--------|
| s44m-01 | Entity Culling: Dim Instead of Hide | STANDARD | none | ready |
| s44m-02 | Pickup Brightness Regression (s44l-03 didn't work) | STANDARD | none | ready |
| s44m-03 | **CRITICAL** Peanut Map Broken in MP | COMPLEX | none | ready |
| s44m-04 | Pickup Rotation Axis Bug | STANDARD | none | ready |
| s44m-07 | Guardian Drones Not Activating | STANDARD | none | ready |
| s44m-08 | **CRITICAL** Difficulty Scaling Still Broken | COMPLEX | none | ready |

**Wave 1 Expected Outcomes:**
- Entity culling properly dims instead of hiding
- Pickups render at consistent brightness (no whitewash)
- Peanut map gameplay smooth (movement + bullets + hit detection)
- Pickup mesh rendering correct (no thin-line artifacts)
- Guardian drones activate, shoot, display damage numbers
- Difficulty scales aggressively to keep player challenged

**Wave 1 Quality Targets:**
- s44m-01, s44m-02, s44m-04, s44m-07: **Level 5** (Puppeteer screenshots)
- s44m-03, s44m-08: **Level 4** (Programmatic tests) — Level 5 requires extensive testing

---

## Wave 2: Features & Infrastructure (MEDIUM PRIORITY — After Wave 1)

**Objective:** Implement new features and build testing/analytics infrastructure
**Parallelization:** s44m-05 and s44m-06 are EPIC → planner decomposes, 4-5 workers each
**Timeline:** 120-180 minutes (planner + parallel workers)
**Model Tier:** Sonnet (workers), may escalate to Opus for s44m-03/s44m-08 sub-problems

### Task Breakdown

| Slug | Title | Complexity | Depends | Status |
|------|-------|-----------|---------|--------|
| s44m-05 | **EPIC** Grid Traversal Test Framework (all maps) | EPIC | Wave 1 | planner ready |
| s44m-06 | **EPIC** Analytics Dashboard (CPU + DDA + commits) | EPIC | Wave 1 | planner ready |
| s44m-09 | PvP Kill Feed + Damage Numbers | STANDARD | Wave 1 | ready |
| s44m-10 | PvP Portals Feature | STANDARD | Wave 1 | ready |

**EPIC Decomposition:**

**s44m-05 (Grid Traversal Framework):**
Planner decomposes into:
1. Test framework design (stuck detection, grid generation)
2. SP grid traversal implementation
3. MP grid traversal implementation
4. Visual report generator
5. Full execution + reporting

**s44m-06 (Analytics Dashboard):**
Planner decomposes into:
1. Architecture + UI framework
2. CPU profiling view
3. DDA analysis view
4. Commit correlation view
5. Report generator + documentation

**Wave 2 Expected Outcomes:**
- Comprehensive grid traversal report showing stuck positions on all 12 surfaces (both SP + MP)
- Interactive HTML analytics dashboard with CPU breakdown, DDA progression, commit-based filtering
- PvP gameplay: kill feed, damage numbers on player hits, double-kill indicators
- PvP tactical depth: teleportation portals on maps

**Wave 2 Quality Targets:**
- s44m-09, s44m-10: **Level 5** (Puppeteer screenshots)
- s44m-05: **Level 5** (Full report with grid visualization)
- s44m-06: **Level 5** (Dashboard interactive screenshots)

---

## Wave 3: Polish & Research (LOWER PRIORITY — After Waves 1-2)

**Objective:** Final localization audit and missing research documentation
**Parallelization:** Both tasks independent
**Timeline:** 40-60 minutes
**Model Tier:** Sonnet for both

### Task Breakdown

| Slug | Title | Complexity | Depends | Status |
|------|-------|-----------|---------|--------|
| s44m-11 | Localization Final Pass (all languages + Arabic) | STANDARD | Wave 1 | ready |
| s44m-12 | Performance & Telemetry Research Report | STANDARD | Wave 1 | ready |

**Wave 3 Expected Outcomes:**
- All UI text fully localized (no English leakage)
- Arabic RTL layout working correctly
- Comprehensive research report on telemetry data collection, analysis capabilities, optimization recommendations
- HTML-formatted, interactive, with code examples

**Wave 3 Quality Targets:**
- s44m-11: **Level 5** (Puppeteer screenshots of each language)
- s44m-12: **Level 5** (Beautiful HTML report, interactive charts)

---

## Execution Roadmap

### Phase 0: Planning (5 minutes)
- Confirm all 12 task files created ✓
- Identify EPIC tasks needing planner decomposition (s44m-05, s44m-06)
- Launch planning agents for EPICs

### Phase 1: Planner Execution (20 minutes)
- **Planner-05:** Decompose grid traversal into 5 sub-tasks
- **Planner-06:** Decompose analytics dashboard into 6 sub-tasks
- Output: Detailed sub-task specifications for workers

### Phase 2: Wave 1 Worker Launch (30 minutes setup + 60-90 min execution)
- Launch 6 orchestrator workers in parallel:
  - Worker-01: s44m-01 (entity culling dimming)
  - Worker-02: s44m-02 (pickup brightness)
  - Worker-03: s44m-03 (peanut map CRITICAL)
  - Worker-04: s44m-04 (pickup rotation)
  - Worker-07: s44m-07 (guardian drones)
  - Worker-08: s44m-08 (difficulty scaling CRITICAL)
- Monitor: `tmux ls` → check worker panes, poll for commits
- Auto-merge when workers commit + verify + complete

### Phase 3: Wave 2 Worker Launch (30 minutes setup + 120-180 min execution)
After Wave 1 workers complete:
- Launch planner workers for s44m-05 and s44m-06 sub-tasks
- Launch workers for s44m-09, s44m-10 in parallel
- Total: 8-10 parallel workers

### Phase 4: Wave 3 Worker Launch (20 minutes setup + 40-60 min execution)
After Wave 2 completes:
- Launch 2 workers for s44m-11 (localization) and s44m-12 (research report)
- Merge on completion

### Phase 5: Final Report & Cleanup (10 minutes)
- Merge all branches
- Run final test suite
- Generate execution summary
- Kill any stray servers
- Commit final state

**Total Timeline:** ~24-30 minutes active management + ~300 minutes worker execution (run parallel) = **4-5 hours for full execution**

---

## Known Regressions & Historical Context

### User-Reported Recurring Issues
1. **Peanut Map** — "This is STILL broken. How have you not fixed that?"
   - s44h-01, s44j-11, s44j-12 all attempted fixes
   - s44l-17 marked Pending but user says not fixed
   - Root causes: pole metric singularity, applyWorldRotation missing, coordinate mismatch MP vs SP
   - **s44m-03 must reach Level 4 minimum**

2. **Pickup Brightness** — "Absolutely shining, way too white"
   - s44l-03 attempted fix (AdditiveBlending → NormalBlending) didn't work
   - Suspected: bloom threshold, emission intensity, tone-mapping
   - **s44m-02 must find root cause**

3. **Difficulty Scaling** — "I should never get too powerful"
   - s44l-08, s44l-08a, s44l-08b were attempted but user says not working
   - Player reaches 1.4B+ score, drones trivialize game
   - **s44m-08 must verify DDA formula applies to enemy difficulty**

### Context from s44l (Previous Session)
- s44l-10: Entity culling implemented as HIDE (was wrong, should be DIM)
- s44l-03: Pickup brightness attempted fix failed
- s44l-22, s44l-23: File metadata restoration + doc cleanup completed
- s44l-05: Weapon mastery stacking fixed
- Overall: 23 tasks processed, multiple regressions discovered during user testing

---

## Task File Quick Reference

All 12 task files located in `tasks/s44m-*.md`:

**Critical Fixes:**
- `tasks/s44m-01-entity-culling-dim-instead-of-hide.md`
- `tasks/s44m-02-pickup-brightness-regression-fix.md`
- `tasks/s44m-03-peanut-map-pole-regression-critical.md`
- `tasks/s44m-04-pickup-rotation-axis-bug.md`
- `tasks/s44m-07-guardian-damage-numbers-missing.md`
- `tasks/s44m-08-difficulty-scaling-still-broken.md`

**Infrastructure & Features:**
- `tasks/s44m-05-grid-traversal-test-framework-epic.md` (EPIC)
- `tasks/s44m-06-analytics-dashboard-epic.md` (EPIC)
- `tasks/s44m-09-pvp-kill-feed-damage-numbers.md`
- `tasks/s44m-10-pvp-portals-feature.md`

**Polish & Docs:**
- `tasks/s44m-11-localization-final-pass.md`
- `tasks/s44m-12-performance-research-report.md`

---

## Success Criteria

**Wave 1 Success:** All 6 regressions fixed, user testing confirms gameplay smooth
**Wave 2 Success:** Grid framework finds stuck positions, analytics dashboard live
**Wave 3 Success:** No English text leaks, research report delivered
**Overall Success:** All 12 tasks merged, git clean, no stray servers

---

## Risk Mitigation

**Known Gotchas:**
1. **Peanut map (s44m-03):** Deep root cause, may require multiple fix attempts
2. **Difficulty scaling (s44m-08):** Touches core DDA system, extensive testing needed
3. **EPIC tasks (s44m-05, s44m-06):** Complex decomposition, ensure planner creates detailed sub-specs
4. **Colyseus/MP (s44m-03):** LAN code is fragile, read all `decisions/lan-*.md` first

**Preventive Actions:**
1. All workers must verify code is actually CALLED (trace from entry point)
2. All regressions require Level 4+ verification before marking done
3. Planners must output detailed sub-task specs, not vague decompositions
4. Main context will actively poll workers every 5 minutes (don't wait passively)

---

## Post-Execution Tasks

After all merges complete:
1. Kill any running servers: `ss -tlnp | grep -E '300[0-9]|2567'`
2. Check for zombie Vite processes: `ps aux | grep -i vite`
3. Run `npm test` to verify no new regressions
4. Update DISCOVERIES.md with any findings
5. Archive this execution plan to reports/
6. Commit final state with clear message listing all 12 tasks merged

---

**Status:** READY FOR AUTONOMOUS EXECUTION
**Next Action:** Launch orchestrator with planners for s44m-05, s44m-06, then Wave 1 workers
