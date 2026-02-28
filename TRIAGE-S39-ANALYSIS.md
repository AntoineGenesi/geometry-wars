# Session 39 Triage Analysis — Critical Discovery: Code-Path Mismatches

**Date:** 2026-02-28
**Triager:** haiku (Claude Code triager agent)
**Status:** Triage complete, awaiting execution

---

## Voice Transcript Summary

User reports:
1. **Bullets curving at poles** — Still broken despite S38d-07b "fix"
2. **Aim inverted in MP** — Still broken despite S38d-08 "fix"
3. **LAN laptop cannot connect** — Still broken despite S38b-S38d repeated fixes
4. **Lobby QR layout overlapping** — Text overlaps QR code, needs repositioning

All four issues: supposedly fixed in S38d, but NOT working when user tests.

---

## Critical Discoveries

### 1. Bullets Curving — CODE-PATH MISMATCH

**What S38d-07b did:**
- Modified `src/surfaces/geodesic/FaceWalker.ts` (single-player only)
- Fixed vertex fan parallel transport for pole traversal
- Commit: ed46760

**Where bullets actually move in LAN MP:**
- Server-side: `server/rooms/GameRoom.ts` lines 1020-1109
- Uses **analytical Christoffel-symbol-based transport**, NOT FaceWalker
- Different code path entirely

**Verdict:** Fix never reached the MP code path user is testing. The server's Christoffel implementation (lines 1062-1081 for sphere) may have the same pole-curving issue as FaceWalker had, but uses a different mechanism.

**What to do:** Investigate server-side Christoffel transport. The fix principle (proper parallel transport) likely applies, but implementation differs.

### 2. Aim Inverted — FIX IN PLACE BUT USER SAYS STILL BROKEN

**What S38d-08 did:**
- Changed network-main.ts:3121 from `atan2(-mouseY, mouseX)` to `atan2(mouseY, mouseX)`
- Removed negation on mouseY
- Added regression tests in `src/test/mp-aim-direction.test.ts`
- Commit: 5b38a31

**Current code state:** Fix IS present at network-main.ts:3131.

**But user says:** Aim is STILL inverted.

**Possible causes:**
1. Browser cache (user's browser has old JS)
2. Build issue (fix is committed but not compiled into the served code)
3. Another negation/inversion downstream (aimAngle computed correctly, but inverted again before use)
4. Server doesn't receive or use aimAngle correctly

**What to do:** Trace aimAngle through the entire client-server chain. Verify it's computed, sent, received, and used correctly. Run regression tests to confirm formula is correct.

### 3. Laptop LAN Broken — ENVIRONMENTAL, NOT CODE

**History:**
- S38b, S38c, S38d all attempted code-level fixes
- All failed
- S38d-01 concluded: code-level causes are exhausted

**Key asymmetry:**
- Phone connects fine (QR code join works)
- Laptop cannot connect (LAN menu join fails)
- Same WiFi network

**This indicates:** Environmental difference, not code issue.

**Likely causes:**
1. Windows Firewall per-app rules (node.exe has rules, but only for specific profiles or networks)
2. WiFi adapter power settings on laptop
3. Network profile setting (Public vs Private)
4. IPv6 vs IPv4 preference
5. Network discovery (mDNS) differences

**What to do:** Run non-code diagnostics. Check firewall, network profile, DNS, IP preferences. No code changes needed.

### 4. Lobby QR Layout — SIMPLE UI FIX

**What S38d-03 did:**
- Added QR code to LAN lobby UI
- Code is working, QR generates and displays

**Current problem:**
- Text overlaps QR code
- Layout wastes whitespace
- Horizontal scrolling needed

**What to do:** Reposition using flexbox. Text on left (flex-grow: 1), QR on right (flex-grow: 0). No code logic changes.

---

## Task Decomposition

### Wave 0: Critical Blockers (Parallel, 3 tasks)

| Task | Complexity | Model | Why |
|------|-----------|-------|-----|
| s39-01: Bullets (Server Path) | STANDARD | sonnet | Investigate Christoffel transport at poles. May need similar fix as FaceWalker. |
| s39-02: Aim (Verify & Fix) | STANDARD | sonnet | Trace aimAngle through client-server. Verify fix is complete. Debug if still broken. |
| s39-03: Laptop LAN (Diagnostics) | COMPLEX | sonnet | Run environmental diagnostics. No code changes. Determine Windows/network issue. |

**Reasoning:**
- All three are blocking (user cannot play without fixing bullets, aim, and LAN)
- Can run in parallel (no dependencies)
- Different investigation paths (graphics math, client-server data flow, system diagnostics)

### Wave 1: UI Fix (After Wave 0 or parallel)

| Task | Complexity | Model | Why |
|------|-----------|-------|-----|
| s39-04: Lobby QR Layout | QUICK | haiku | Simple CSS/layout fix. Can run anytime. Low priority but quick win. |

**Reasoning:**
- Not blocking gameplay
- Quick fix (estimated 10 min)
- Can run after Wave 0 or in parallel if resources available
- Low-priority improvement (cosmetic)

---

## Key Insights for Workers

### For s39-01 (Bullets Server Path)
- Read the S38d-07 investigation log to understand what FaceWalker fix was
- Apply same principle to server's Christoffel transport
- Root cause is likely: `sinPhi` clamping to 0.01/0.1 at poles loses precision
- Solution may be: better handling of pole singularities or higher-order terms

### For s39-02 (Aim Verify & Fix)
- First verify the fix is present (check commit ed46760)
- Run regression tests to confirm formula is correct
- If tests pass but user says still broken: trace through network transmission
- Check server-side GameRoom.ts to see how it receives and uses aimAngle
- If server receives correctly but still broken: look for downstream inversion

### For s39-03 (Laptop LAN Diagnostics)
- This is NON-CODE work
- Run diagnostic commands (netstat, firewall rules, network profile)
- Test direct IP connection (not hostname)
- Identify if issue is firewall, network profile, WiFi adapter, or DNS
- Provide user with a step-by-step fix guide (not code changes, but Windows settings)

### For s39-04 (Lobby QR)
- Simple flexbox layout fix
- Text container on left (flex: 1)
- QR container on right (flex: 0 0 auto)
- No logic changes, only styling

---

## Execution Order

**Recommended waves:**

```
Wave 0: Parallel
├── s39-01 (Bullets) — Worker 1 (sonnet)
├── s39-02 (Aim) — Worker 2 (sonnet)
├── s39-03 (Laptop LAN) — Worker 3 (sonnet)
└── (estimated time: 30-60 min each)

Wave 1: After Wave 0 or if resources available
└── s39-04 (QR Layout) — Worker 4 (haiku)
    (estimated time: 10 min)
```

**Total estimated time:** 60-90 min for Wave 0, 10 min for Wave 1.

---

## Files Created

- `/tasks/s39-01-bullets-curving-at-poles-mp-server-path.md`
- `/tasks/s39-02-mp-aim-inverted-verify-and-fix.md`
- `/tasks/s39-03-laptop-lan-connection-environmental-diagnostics.md`
- `/tasks/s39-04-lobby-qr-layout-fix-text-overlap.md`
- `TODO.md` — updated with Session 39 section

---

## Root Cause Summary

| Issue | S38d Attempted Fix | Why It Didn't Work | S39 Approach |
|-------|------------------|-------------------|-------------|
| Bullets curving | FaceWalker parallel transport | MP uses Christoffel, not FaceWalker | Investigate server Christoffel implementation |
| Aim inverted | Removed negation in atan2 | Fix in code, but either not served or downstream inversion | Trace full client-server chain |
| Laptop LAN | Multiple code changes | Code not the problem; environment is | Run Windows/network diagnostics |
| QR layout | Added QR to UI | No layout consideration | CSS flexbox reposition |

---

## Next Steps

1. Read tasks/s39-*.md for detailed context
2. Launch workers (or use orchestrator with --parallel flag)
3. Track progress in TODO.md
4. Merge branches as tasks complete
5. Verify fixes with user before marking "done"

**Remember:** User previously caught us claiming "fixed" without verification. Reach Level 5 (Puppeteer screenshot + describe what you see) before marking bullets or aim as complete.
