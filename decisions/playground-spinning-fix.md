## 2026-02-11 - PlaygroundGame Camera Spinning Fix (3rd Attempt)

**Context:** The weapon playground and visual styles playground demos spin wildly when the user moves the mouse. This bug was "fixed" twice before (tasks #51 and #61) but regressed both times because the root cause was in PlaygroundGame.ts, which was either rebuilt from scratch or had its fix overwritten.

**Root Cause (TWO issues, both required):**

### Issue 1: Camera Up Vector
The camera sits along the surface normal looking down at the player. Setting `camera.up = normal` makes the up vector parallel to the look direction. This is a degenerate case for `camera.lookAt()` — when up is parallel to the view axis, the camera's roll is undefined and produces wild oscillations (spinning).

**Fix:** Use `walker.getTangentFrame().bitangent` for camera up. Bitangent is perpendicular to both the normal (look direction) and tangent, giving a stable camera orientation. This matches main.ts behavior.

**Locations in PlaygroundGame.ts that set camera.up (ALL must use bitangent):**
1. Constructor camera init (line ~200)
2. `setSurface()` camera snap (line ~330)
3. `renderUpdate()` camera lerp (line ~489)
4. `respawnPlayer()` camera snap (line ~595)

### Issue 2: Movement Method
The old `movePlayer()` used camera-relative axes: it projected camera right/forward onto the tangent plane to determine movement direction. This creates a feedback loop:
- Camera orientation determines movement direction
- Movement changes player position
- New position changes camera orientation
- Changed orientation changes movement direction next frame
- Result: oscillating/spiraling movement

**Fix:** Use `walker.moveFromInput()` which maps screen-space input directly to the walker's persistent tangent frame (tangent=right, bitangent=forward). No camera involvement in movement direction. This matches main.ts behavior.

### Why Previous Fixes Regressed

Previous fixes addressed symptoms (movement speed, ESC key handling) rather than the architectural mismatch between PlaygroundGame and main.ts. The core algorithms for movement + camera were wrong from the start, and partial fixes left the root causes intact.

This fix rewrites three methods to match main.ts exactly:
- `movePlayer()` → uses `walker.moveFromInput()`
- `orientPlayer()` → uses `walker.getTangentFrame()` for aim mapping
- `renderUpdate()` → uses `frame.bitangent` for camera up

**Options Considered:**
1. Patch the existing camera-relative movement to dampen oscillations — Rejected: treats symptoms, will regress
2. Match main.ts approach exactly with guard comments — Chosen: proven correct, resistant to regression
3. Factor out a shared CameraController class — Rejected: overengineering for the current scope

**Decision:** Option 2 — match main.ts exactly, add REGRESSION GUARD comments at every critical location

**Reasoning:** main.ts has been stable for months. The approach (walker tangent frame for movement + aim, bitangent for camera up) is mathematically correct and proven in production. Guard comments explain WHY each choice matters and what NOT to change.

**Reversibility:** Easy — revert the four edits to PlaygroundGame.ts. But doing so will reintroduce the spinning bug.

**Verification:**
- Level 1: TypeScript compiles clean (only pre-existing errors in PerformanceLogger.test.ts)
- Level 2: All 43 playground verification tests pass (previously 4 were failing)
- User testing required for Level 4 verification
