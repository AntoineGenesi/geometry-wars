# Frame-by-Frame Diagnostic Testing Methodology

**Purpose:** Diagnose movement bugs WITHOUT visual testing by capturing detailed per-frame gameplay data programmatically.

**Status:** ✅ PROVEN - Successfully identified s15 player movement bug (90° orientation flipping every frame)

---

## Why This Approach

**Problem:** Visual testing (Puppeteer/screenshots) requires:
- Working WebGL renderer (often fails in headless mode)
- Human interpretation of visuals
- Slow iteration (start server, launch browser, take screenshots, interpret)

**Solution:** Hook directly into game simulation via `PlaygroundTestHarness`:
- No rendering required (headless game simulation)
- Captures exact numerical data (positions, quaternions, vectors)
- Fast iteration (runs in vitest, ~3 seconds for 120-frame test)
- Automated analysis (jitter detection, orientation stability, etc.)

---

## What This Captures

### Per-Frame Data
- **Position:** Player world coordinates (x, y, z)
- **Orientation:** Quaternion + Euler angles (radians)
- **Tangent Frame:** Surface-relative coordinate system (tangent, bitangent, normal)
- **Input State:** moveX, moveY, aimX, aimY
- **Deltas:** Frame-to-frame position/orientation changes

### Automated Analysis
- **Total distance moved:** Detect if player gets stuck
- **Average speed:** Compare expected vs actual
- **Max orientation delta:** Find discrete snaps/jumps
- **Large rotation percentage:** Detect orientation instability
- **Jitter detection:** Position oscillation back-and-forth
- **Stuck frame count:** Frames with < 0.001 movement

---

## How to Use

### 1. Create a Diagnostic Test

```typescript
import { PlaygroundTestHarness } from './PlaygroundTestHarness';

it('diagnose forward movement', () => {
  const harness = new PlaygroundTestHarness('sphere');
  harness.tick(10); // Let game settle

  const frames: FrameData[] = [];

  // Capture initial state
  frames.push(captureFrameData(harness, 0, 0));

  // Simulate movement
  harness.pressKey('w');
  for (let i = 1; i <= 120; i++) {
    harness.tick(1);
    frames.push(captureFrameData(harness, i, i / 60));
  }
  harness.releaseKey('w');

  // Analyze and save
  const report = analyzeFrames(frames);
  writeFileSync('diagnostic-report.json', JSON.stringify(report, null, 2));
});
```

### 2. Run the Test

```bash
npm test -- --run src/test/frame-by-frame-diagnostic.test.ts
```

### 3. Analyze the Output

Reports saved to: `test-data/diagnostics/s15-{direction}-movement-{timestamp}.json`

Console output shows immediate analysis:
```
📊 Diagnostic report saved: test-data/diagnostics/s15-forward-movement-1770911080765.json
📈 Analysis:
   Total distance: 1.9272
   Avg speed: 0.9636
   Max orientation delta: 90.23°
   Avg orientation delta: 89.27°  <-- SMOKING GUN!
   Large jumps (>90°): 36/121 (29.8%)
   Stuck frames: 1
   Jitter detected: true  <-- CONFIRMS BUG
   Orientation stability: moderate
```

### 4. Deep Dive in JSON

```bash
cat test-data/diagnostics/s15-forward-movement-*.json | jq '.frames[0:10] | .[] | {frame, position, eulerAngles, deltas}'
```

---

## Case Study: S15 Player Movement Bug

### Symptom (User Report)
- Forward/backward causes jitter and 90° snaps
- Left/right works fine
- "Square fashion" movement

### Diagnostic Results

| Direction | Max Δ | Avg Δ | >90° Jumps | Jitter | Status |
|-----------|-------|-------|------------|--------|--------|
| Forward   | 90.23° | 89.27° | 30% | Yes | **BROKEN** |
| Backward  | 90.24° | N/A | 46% | N/A | **BROKEN** |
| Left      | 5.00° | N/A | 0% | No | ✅ Works |

### Root Cause (from data)
Frame-by-frame analysis revealed:
- Orientation changes by ~π/2 radians (90°) EVERY frame during forward/backward
- Alternates between two orientations (flip-flop pattern)
- Left/right movement shows smooth <5° rotations

**Conclusion:** Bug is in forward/backward orientation calculation, NOT left/right or movement system.

---

## Advanced: More Comprehensive Diagnostics

Beyond frame-by-frame, you can also capture:

### Sub-Frame Sampling
Multiple captures per game tick:
```typescript
harness.tick(1);
// Capture at t=0.0, t=0.5, t=1.0
```

### Vector Calculus Verification
Verify cross products are correct:
```typescript
const right = new THREE.Vector3().crossVectors(aimDirection, normal);
const forward = new THREE.Vector3().crossVectors(normal, right);
// Check: right ⊥ normal, forward ⊥ right, right × forward = normal (within epsilon)
```

### State Machine Tracking
Track internal state changes:
```typescript
{
  isUVBased: harness.pg._isUVBasedSurface(),
  walkerPosition: harness.pg._walker.position,
  meshPosition: harness.pg.player.mesh.position,
  // Track if position sources diverge
}
```

### Input Event Timing
Timestamp input changes:
```typescript
{
  inputChangeTimestamp: Date.now(),
  inputDelta: currentInput - previousInput,
  responseLatency: firstPositionChange - inputChangeTimestamp
}
```

### Matrix Decomposition
Verify rotation matrices:
```typescript
const orientMat = new THREE.Matrix4();
orientMat.extractRotation(player.mesh.matrixWorld);
// Decompose and verify orthonormality, handedness
```

---

## Implementation Reference

Full implementation: `src/test/frame-by-frame-diagnostic.test.ts`

Key functions:
- `captureFrameData()` - Captures single frame snapshot
- `analyzeFrames()` - Computes aggregate statistics
- `DiagnosticReport` interface - Standardized output format

---

## When to Use This

✅ **Use frame-by-frame diagnostics when:**
- Movement feels glitchy but you can't see why visually
- Puppeteer/WebGL fails in headless mode
- You need exact numerical proof of bug behavior
- Comparing behavior across different surfaces/modes
- Building regression tests with specific thresholds

❌ **Don't use this when:**
- Bug is purely visual (shader artifacts, rendering glitches)
- You need to see UI elements (menus, HUD)
- Bug requires human judgment of "feels right"

For visual bugs, use Puppeteer visual tests instead.

---

## Future Enhancements

Ideas for making this even more comprehensive:

1. **Replay System:** Record input sequence, replay deterministically
2. **Differential Analysis:** Compare two versions side-by-side
3. **Regression Thresholds:** Auto-fail if metrics exceed historical baselines
4. **Heatmap Generation:** Visualize problem areas on surface UV space
5. **Call Stack Tracing:** Instrument code to track function call order
6. **Memory Profiling:** Track allocations per frame (detect leaks)
7. **Performance Counters:** FPS, frame time, update/render split

---

## Commit This Documentation

```bash
git add docs/testing/frame-by-frame-diagnostics.md
git add src/test/frame-by-frame-diagnostic.test.ts
git add test-data/diagnostics/*.json
git commit -m "docs: add frame-by-frame diagnostic testing methodology"
```

This becomes permanent project knowledge for all future workers.
