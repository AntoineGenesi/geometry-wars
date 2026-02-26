# Session 36 — Execution Plan: S35 Re-Reports (19 Tasks)

## Situation

User reported 27 tasks in massive voice dump. Investigation revealed:
- **24 tasks from S35** were marked "Done" but are still broken
- User is re-reporting the same bugs (e.g., "peanut geodesic MP still broken")
- This indicates S35 fixes did NOT actually work

## Key Insight: Root Cause Analysis

Several bugs have been "fixed" multiple times without success:
1. **MP Lives:** Fixed in S34, re-investigated in S35, still broken
   - Task history: s34-mp-lives-per-player → s34b-mp-lives-still-shared → s35-mp-lives-investigation-continued
   - S35 says "Done" but user is re-reporting

2. **Peanut Geodesic MP:** User said "you've had it fixed before"
   - This suggests code was working, then broke (regression)
   - Fix likely exists in git history

3. **Multiple surface bugs:** Cube dimming, torus arrow, sphere pole skip
   - All marked "Done" in S35 but user seeing issues

## Strategy: Why Re-Reports Work Better Than "Done" Tasks

Instead of re-opening S35 tasks, we create NEW S36 task files:
- Preserve history (link back to S35 original)
- Force fresh investigation (don't assume S35 was correct)
- Capture user's current report (exact wording)
- Avoid hidden assumptions from previous attempts

## Execution Waves

### Pre-Requisite: Wait for S36 Phases 2+3 to Complete

Current status: 2 active workers
- `gw-worker-s36-phase2-gameplay-effects` — Wire upgrade nodes
- `gw-worker-s36-phase3-constellation-ui` — Constellation UI

**Wait for:** Both workers complete, merged to master.

**Why:** Main context bandwidth is limited. Let EPIC workers finish naturally. Once merged, main context has capacity for re-report wave.

---

## Wave 1: CRITICAL (Sequential) — Must Fix First

These block other work:

### 1a. MP Lives (CRITICAL — Being "Fixed" 3 Times)
**Task:** s36-mp-lives-still-shared-re-report
**Complexity:** COMPLEX
**Model:** Sonnet
**Duration:** 30-45 min
**Special:** Read ALL previous attempts (s34, s34b, s35) before writing code. Document why they failed.

**Execution:**
1. Launch orchestrator worker
2. Worker reads 3 previous task files + code
3. Identify why previous fixes didn't work
4. Fix root cause (likely multiple places, or wrong place)
5. Test: 3-player session, verify per-player lives work

**Acceptance:** Each player has 3 independent lives, death of one doesn't affect others.

### 1b. Peanut Geodesic MP (CRITICAL — Regression)
**Task:** s36-peanut-geodesic-mp-still-broken-re-report
**Complexity:** COMPLEX
**Model:** Sonnet
**Duration:** 30-45 min
**Special:** Find git commit that fixed it (prior to S35). Understand what broke it. May be simple revert.

**Execution:**
1. Launch orchestrator worker
2. Worker checks git history for peanut fixes
3. Understand what was working
4. Identify what broke it (compare SP vs MP code paths)
5. Re-apply fix or refactor as needed
6. Test: MP peanut, verify geodesic works

**Acceptance:** MP peanut bullets and movement work same as SP.

### 1c. Cube Dimming Glitch (CRITICAL — Visual)
**Task:** s36-cube-dimming-glitch-re-report
**Complexity:** STANDARD
**Model:** Sonnet
**Duration:** 20-30 min

**Execution:**
1. Launch orchestrator worker
2. Find dimming code (grep "dimming", "opposite", "brightness")
3. Check if face detection is jittery (oscillating between faces)
4. Fix: stabilize face detection or cache dimming decision
5. Test: rotate camera on cube, observe 10-15 sec for flicker

**Acceptance:** No flickering, stable dim/bright on opposite sides.

---

## Wave 2: HIGH (Parallel After Wave 1 Merged) — Surface Geometry

Once Wave 1 merges, launch 4 workers in parallel:

### 2a. Cube Top/Bottom Wrapping Paper
**Task:** s36-cube-top-bottom-wrapping-paper-re-report
**Complexity:** STANDARD | **Model:** Sonnet | **Duration:** 20-30 min

### 2b. Pickup Inconsistent Radius
**Task:** s36-pickup-inconsistent-radius-re-report
**Complexity:** STANDARD | **Model:** Sonnet | **Duration:** 20-30 min
**Note:** Critical for gameplay — don't let this linger

### 2c. Torus Arrow Rendering
**Task:** s36-torus-arrow-rendering-re-report
**Complexity:** STANDARD | **Model:** Sonnet | **Duration:** 15-25 min
**Note:** Apply fix to all 12 maps once understood

### 2d. Plane Hit Detection + Inverted Controls
**Task:** s36-plane-hit-detection-inverted-controls-re-report
**Complexity:** STANDARD | **Model:** Sonnet | **Duration:** 25-35 min
**Note:** Plane is critical but niche — may not be used much. Prioritize if user emphasizes.

---

## Wave 3: HIGH (Parallel After Wave 2 Merged) — Gameplay

### 3a. KotH Zone Positioning
**Task:** s36-koth-zone-positioning-re-report
**Complexity:** STANDARD | **Model:** Sonnet | **Duration:** 15-25 min

### 3b. MP Movement Control Loss
**Task:** s36-mp-movement-control-loss-re-report
**Complexity:** COMPLEX | **Model:** Sonnet | **Duration:** 30-45 min
**Note:** Input routing bug — complex to debug

### 3c. Sphere Pole Skip
**Task:** s36-sphere-pole-skip-re-report
**Complexity:** STANDARD | **Model:** Sonnet | **Duration:** 20-30 min

### 3d. MP Enemy AI Strategies
**Task:** s36-mp-enemy-ai-strategies-re-report
**Complexity:** COMPLEX | **Model:** Sonnet | **Duration:** 30-45 min
**Note:** May involve porting code from SP to server

### 3e. Peanut Movement Speed Variation
**Task:** s36-peanut-movement-speed-variation-re-report
**Complexity:** STANDARD | **Model:** Sonnet | **Duration:** 15-25 min

---

## Wave 4: HIGH (Parallel After Wave 3 Merged) — Multiplayer/UI

### 4a. Mobile UI Fixes Batch
**Task:** s36-mobile-ui-fixes-batch-re-report
**Complexity:** STANDARD | **Model:** Sonnet | **Duration:** 20-30 min

### 4b. MP Host Detection
**Task:** s36-mp-host-detection-re-report
**Complexity:** STANDARD | **Model:** Sonnet | **Duration:** 15-25 min

### 4c. MP Damage Numbers
**Task:** s36-mp-damage-numbers-re-report
**Complexity:** QUICK | **Model:** Haiku | **Duration:** 10-15 min

### 4d. Cube MP Camera 180°
**Task:** s36-cube-mp-camera-180-re-report
**Complexity:** STANDARD | **Model:** Sonnet | **Duration:** 20-30 min

---

## Wave 5: STANDARD (Parallel) — Features

### 5a. Snake Entity Variants
**Task:** s36-snake-entity-variants-missing-re-report
**Complexity:** COMPLEX | **Model:** Sonnet | **Duration:** 30-45 min
**Note:** Variants supposedly implemented but not visible. Debug spawn logic.

---

## Wave 6: QUICK (Parallel) — Easy Wins

### 6a. Kill Counter
**Task:** s36-kill-counter-fix-re-report
**Complexity:** QUICK | **Model:** Haiku | **Duration:** 10-15 min

### 6b. Weapon/Boost UI Position
**Task:** s36-weapon-boost-ui-position-re-report
**Complexity:** QUICK | **Model:** Haiku | **Duration:** 10-15 min

### 6c. Bloom Spawn Glitch
**Task:** s36-bloom-spawn-glitch-re-report
**Complexity:** QUICK | **Model:** Haiku | **Duration:** 10-15 min

### 6d. Server Auto-Shutdown
**Task:** s36-server-auto-shutdown-re-report
**Complexity:** QUICK | **Model:** Haiku | **Duration:** 10-15 min

---

## Wave 7: LOW (Optional) — Informational

### 7a. Torus Light Trails (Cosmetic)
**Task:** s36-torus-light-trails-cosmetic-re-report
**Complexity:** RESEARCH | **Model:** Haiku | **Duration:** 10-15 min

---

## Estimated Timeline

| Phase | Duration | Output |
|-------|----------|--------|
| S36 Phases 2+3 Complete | Current workers | Merge weapon mastery |
| Wave 1 (Sequential) | 60-90 min | 3 critical fixes |
| Wave 2 (4 parallel) | 30-45 min | 4 surface fixes |
| Wave 3 (5 parallel) | 40-50 min | 5 gameplay fixes |
| Wave 4 (4 parallel) | 35-50 min | 4 MP/UI fixes |
| Wave 5 (1 worker) | 30-45 min | 1 feature fix |
| Wave 6 (4 parallel) | 15-25 min | 4 quick wins |
| **Total** | **4-5 hours** | **19 fixes total** |

---

## Critical Rules

1. **Don't trust "Done" from S35** — Verify each fix works before marking complete
2. **Document why prior fixes failed** — If re-fixing a task, read the previous attempt
3. **Use git history** — Peanut geodesic was fixed before; check what changed
4. **Prioritize MP bugs** — 6 of 19 are MP-specific; these are customer-facing
5. **Test visually** — "Fixed" often means "code compiles". Use Puppeteer/manual testing.

---

## Checkpoint Markers

- **After Wave 1:** User should see MP lives and peanut MP working
- **After Wave 2:** Surface geometry issues resolved (cube, torus)
- **After Wave 3:** Gameplay stabilized (KotH, enemy AI)
- **After Wave 4:** Multiplayer polished (host detection, damage numbers)
- **After Wave 5+6:** All fixes complete, ready for user testing

---

## Next Steps (Main Coordinator)

1. Wait for S36 phases 2+3 workers to complete naturally
2. Merge their branches
3. Launch Wave 1 (sequential): 2 sonnet workers on critical MP bugs
4. Poll workers every 3-5 min
5. Merge Wave 1 → Launch Wave 2
6. Continue waves sequentially (or parallel where independent)
7. After all 19 tasks: prepare for user testing

