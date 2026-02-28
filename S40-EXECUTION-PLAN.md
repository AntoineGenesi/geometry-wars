# Session 40 — Execution Plan: User Voice Triage + Task Decomposition

**Triaged by:** Haiku (S40 triager)
**Total Tasks Created:** 10 new (s40-06 through s40-15)
**Execution Date:** 2026-03-01
**Baseline:** S38d + S39 merged; critical issues: MP poles, hit detection, mobile regression

---

## Summary of Issues (from user voice)

1. **MP player stuck at poles** (CRITICAL) — can't cross pole boundaries
2. **Weapon mastery overhaul** (HIGH) — prerequisite enforcement + cross-branch skips + visual fixes
3. **MP damage too weak** (HIGH) — SP kills fast, MP kills slow
4. **Locale flag icons** (HIGH) — needs emoji/image instead of text
5. **Back button accessibility** (MEDIUM) — scrollable menus trap button
6. **MP hit detection broken** (CRITICAL) — bullets don't register despite visual hits
7. **Peanut movement slow** (HIGH) — surface-specific slowdown
8. **Pickup radius too large** (MEDIUM) — collecting from too far
9. **Mobile MP broken** (CRITICAL) — movement, resume button, scroll all broken
10. **Cube camera inverted** (MEDIUM) — face crossing flips controls

---

## Execution Waves

### Wave 0: CRITICAL BLOCKERS (Parallel, start immediately)
**Dependency:** These don't block each other; run all 4 in parallel
**Expected Duration:** 30-40 min each
**Workers:** 4 (max user preference)

1. **s40-06: MP Pole Crossing** [COMPLEX, Sonnet]
   - Trace server-side movement, identify pole-crossing failure
   - Compare SP MeshWalker.walk() with server UV stepping
   - Fix: switch server to FaceWalker or add pole-clamp logic
   - Test: verify pole crossing on multiple surfaces

2. **s40-08: MP Hit Detection** [COMPLEX, Sonnet]
   - Depends on s40-04 (geodesic bullets) being merged
   - Verify client geodesic path vs server UV collision check
   - Identify path mismatch and fix
   - Test: visual hit = damage registered

3. **s40-11: Mobile MP Regression** [COMPLEX, Sonnet]
   - Three issues: movement (spinning in place), resume button, scroll
   - Diagnose touch input mapping, button event handling, scroll CSS
   - Fix all three in parallel if same root cause, or separately
   - Test: movement direction correct, resume works, scroll works

4. **s40-07: MP Damage Scaling** [STANDARD, Sonnet]
   - Audit SP vs MP damage values
   - Identify scaling factors (difficulty, player count, buffs)
   - Align MP damage with SP baseline
   - Test: same TTK in both modes

**Wave 0 Success Criteria:**
- All 4 branches merged
- MP gameplay approaching parity with SP (movement, damage, hit detection, mobile playable)

---

### Wave 1: MP Gameplay Balance (Parallel, start after Wave 0 or concurrently with 1-2 Wave 0 workers)
**Dependency:** Relatively independent; s40-09 benefits from s40-06 being done
**Expected Duration:** 20-30 min each
**Workers:** 2-3 (overlap with Wave 0 tail)

1. **s40-09: Peanut Movement Speed** [STANDARD, Sonnet]
   - Compare peanut movement speed to sphere/torus
   - Identify speed scaling or coordinate system issue
   - Apply normalization factor if needed
   - Test: consistent movement across all surfaces

2. **s40-10: Pickup Radius** [QUICK, Haiku]
   - Find PICKUP_COLLECT_RADIUS constant
   - Reduce by 50% or test empirically
   - Verify pickup distance feels right

**Wave 1 Success Criteria:**
- MP gameplay feels balanced (not too slow, pickups at right distance)

---

### Wave 2: Features & UI (Parallel, can start any time, no blocking dependencies)
**Expected Duration:** 15-30 min each
**Workers:** 3-4

1. **s40-12: Weapon Mastery Overhaul** [COMPLEX, Sonnet]
   - Prerequisite enforcement: can't unlock tier N without tier N-1
   - Cross-branch skips: some nodes jump to deeper tier on other branch
   - Fix line rendering: lines through node centers (not offset)
   - Path visualization: faint lines (possible) vs glowing (activated)
   - Test: full progression with/without skips, visual correctness

2. **s40-13: Locale Flag Icons** [QUICK, Haiku]
   - Depends on s40-01 working (localization click handler)
   - Replace text buttons with flag emoji (🇬🇧, 🇷🇺, etc.)
   - Update StartMenu.ts and PauseMenu.ts
   - Style for mobile (tappable size)
   - Test: flag icons render, clicks cycle language

3. **s40-14: Back Button Accessibility** [QUICK, Haiku]
   - Move Back button outside scrollable container (QuickGameMenu, AdventureMenu)
   - Use CSS `position: sticky; top: 0` or restructure HTML
   - Test: Back button always visible, no scroll overlap

4. **s40-15: Cube Camera Controls** [COMPLEX, Sonnet]
   - Diagnose inversion on face crossing (cube has 6 faces)
   - Check camera frame (up/right) update on face crossing
   - Fix control mapping to stay intuitive across faces
   - Test: movement direction matches expectation on all faces + transitions

**Wave 2 Success Criteria:**
- Weapon mastery progression clear and engaging
- Locale switching user-friendly
- UI always accessible
- Cube controls intuitive

---

## Task Dependencies & Sequencing

```
Wave 0 (parallel):
  s40-06 ← s40-03 (aim must be working)
  s40-08 ← s40-04 (geodesic bullets must be merged first)
  s40-11 ← s40-01 (localization might be involved)
  s40-07 (independent)

Wave 1 (parallel, after Wave 0 starts or overlaps):
  s40-09 ← s40-06 (optional: understand pole movement to verify peanut issues)
  s40-10 (independent)

Wave 2 (parallel, any time):
  s40-12 (independent)
  s40-13 ← s40-01 (localization click handler must work)
  s40-14 (independent)
  s40-15 (independent)
```

---

## Execution Order (Respecting Dependencies & Parallelism)

| Phase | Wave | Parallel Workers | Duration | Notes |
|-------|------|------------------|----------|-------|
| **1** | Wave 0 | 4 (max) | 30-40 min | All critical blockers: s40-06, s40-07, s40-08, s40-11 |
| **2** | Wave 1 | 2-3 | 20-30 min | MP balance: s40-09, s40-10 (can overlap Wave 0 tail) |
| **3** | Wave 2 | 3-4 | 15-30 min | Features & UI: s40-12, s40-13, s40-14, s40-15 (can start anytime) |

**Total elapsed time:** ~90 min wall-clock (with overlaps)

---

## Task Complexity & Model Assignment

| Task | Complexity | Model | Reason |
|------|-----------|-------|--------|
| s40-06 (MP poles) | COMPLEX | Sonnet | Requires comparing two code paths, understanding surface math, careful testing |
| s40-07 (damage) | STANDARD | Sonnet | Audit + alignment, fairly straightforward |
| s40-08 (hit detection) | COMPLEX | Sonnet | Debugging path mismatch, may need visualization, careful verification |
| s40-09 (peanut speed) | STANDARD | Sonnet | Find constant, measure, adjust, test |
| s40-10 (pickup radius) | QUICK | Haiku | Find constant, adjust, done |
| s40-11 (mobile MP) | COMPLEX | Sonnet | Three separate issues, mobile-specific debugging |
| s40-12 (weapon mastery) | COMPLEX | Sonnet | UI/progression overhaul, multiple features, careful integration |
| s40-13 (flag icons) | QUICK | Haiku | Emoji swap, minimal styling |
| s40-14 (back button) | QUICK | Haiku | CSS restructuring or sticky positioning |
| s40-15 (cube camera) | COMPLEX | Sonnet | Requires understanding cube geometry, camera frame, control mapping |

---

## Verification & Testing Protocol

Each task MUST reach **Level 5 verification minimum** (Puppeteer screenshot + describe what you see):

- **s40-06:** Screenshot showing player crossing pole, telemetry showing playerStuck=false
- **s40-07:** Screenshot showing MP + SP side-by-side, same TTK measurement
- **s40-08:** Screenshot showing bullet visually hitting, telemetry showing damage applied
- **s40-09:** Screenshot showing movement speed meter, comparison peanut vs sphere
- **s40-10:** Screenshot showing pickup distance, player collecting from intended range
- **s40-11:** Screenshot showing mobile controls, resume button response, scroll in menu
- **s40-12:** Screenshot showing mastery tree, prerequisite blocking, cross-branch paths
- **s40-13:** Screenshot showing flag icons in pause menu + main menu
- **s40-14:** Screenshot showing back button visible during scroll
- **s40-15:** Screenshot showing cube face crossing with correct control direction

---

## Pre-Execution Checklist

- [ ] s40-04 (MP geodesic bullets) verified merged (required for s40-08)
- [ ] s40-03 (MP aim offset) verified merged (required for s40-06 confidence)
- [ ] s40-01 (localization) verified working (required for s40-11 and s40-13)
- [ ] Ports 3000-3010, 2567 are clear (check: `ss -tlnp | grep -E '300[0-9]|2567'`)
- [ ] Node v20.19.5 is in PATH
- [ ] Worktrees from previous session cleaned up (if any)

---

## Known Challenges & Mitigations

**Challenge:** s40-08 (hit detection) may require deep geometry debugging
**Mitigation:** Use Puppeteer visual tests to isolate the path mismatch; render both paths in debug mode if needed

**Challenge:** s40-12 (weapon mastery) is complex UI/progression work
**Mitigation:** Start with prerequisite enforcement (simplest), then add skips, then visuals

**Challenge:** s40-11 (mobile MP) has 3 separate issues; hard to debug
**Mitigation:** Reproduce all 3 on mobile emulation first, then fix in order of impact (movement > resume > scroll)

**Challenge:** s40-15 (cube camera) requires understanding cube topology
**Mitigation:** Map out all 6 faces and their adjacencies first; use simple test of moving across each edge

---

## Notes for Orchestrator

- **User preference:** Max 4-5 workers (planning for 4 in Wave 0, overlap to 6 with Wave 1 tail)
- **User expectation:** Direct execution, no planning delays — spawn workers immediately
- **Testing:** All tasks must reach Level 5 before marking done. Use Puppeteer for visual verification.
- **Commits:** Workers should commit to branches; orchestrator merges on completion
- **Context:** Keep main context clean — spawn workers, wait, merge, spawn next wave

---

