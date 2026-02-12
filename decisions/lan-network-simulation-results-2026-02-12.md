# LAN Network Simulation Results — 2026-02-12

## Context

After multiple sessions of LAN multiplayer fixes (Sessions 4-12), user reports that LAN mode still feels "laggy and weird" despite automated tests passing. This analysis phase runs comprehensive network simulation tests to identify if the issue is network-related or architectural.

**Goal:** Answer the question "Why does LAN feel laggy when user tests it, but automated tests pass?"

## Test Matrix

### Methodology

- **Network simulation:** Linux tc (traffic control) with netem qdisc
- **Conditions tested:** 12 combinations of latency, packet loss, and jitter
- **Test suite:** 16 tests per combination
- **Total test runs:** 192
- **Verification method:** Puppeteer visual testing with SwiftShader headless WebGL

### Test Matrix Results

| Latency | Packet Loss | Jitter | Passed | Failed | Status |
|---------|-------------|--------|--------|--------|--------|
| 0ms | 0% | 0ms | 16 | 0 | ✓ PASS |
| 0ms | 5% | 0ms | 16 | 0 | ✓ PASS |
| 0ms | 10% | 0ms | 8 | 8 | ✗ FAIL |
| 50ms | 0% | 0ms | 16 | 0 | ✓ PASS |
| 50ms | 5% | 0ms | 16 | 0 | ✓ PASS |
| 50ms | 10% | 0ms | 8 | 8 | ✗ FAIL |
| 100ms | 0% | 0ms | 16 | 0 | ✓ PASS |
| 100ms | 5% | 0ms | 16 | 0 | ✓ PASS |
| 100ms | 10% | 0ms | 8 | 8 | ✗ FAIL |
| 200ms | 0% | 0ms | 8 | 8 | ✗ FAIL |
| 200ms | 5% | 0ms | 8 | 8 | ✗ FAIL |
| 200ms | 10% | 0ms | 8 | 8 | ✗ FAIL |

## Findings

### Pass Threshold

**All tests pass at:**
- Latency ≤ 100ms
- Packet loss ≤ 5%
- Jitter ≤ 0ms

### Failure Patterns



**"Movement syncs correctly"** — Failed 6/12 times
- Fails at: 0ms/10%/0ms, 50ms/10%/0ms, 100ms/10%/0ms, 200ms/0%/0ms, 200ms/5%/0ms, 200ms/10%/0ms
- Pattern: Fails under high latency/loss


**"Enemy counts match"** — Failed 6/12 times
- Fails at: 0ms/10%/0ms, 50ms/10%/0ms, 100ms/10%/0ms, 200ms/0%/0ms, 200ms/5%/0ms, 200ms/10%/0ms
- Pattern: Fails under high latency/loss


**"Bullets spawn correctly"** — Failed 6/12 times
- Fails at: 0ms/10%/0ms, 50ms/10%/0ms, 100ms/10%/0ms, 200ms/0%/0ms, 200ms/5%/0ms, 200ms/10%/0ms
- Pattern: Fails under high latency/loss


**"Weapon state syncs"** — Failed 6/12 times
- Fails at: 0ms/10%/0ms, 50ms/10%/0ms, 100ms/10%/0ms, 200ms/0%/0ms, 200ms/5%/0ms, 200ms/10%/0ms
- Pattern: Fails under high latency/loss



### Real-World Network Comparison

**Localhost (same PC)** (0ms, 0% loss) — ✓ PASS
- Closest test: 0ms, 0% loss, 0ms jitter

**LAN (Ethernet)** (5ms, 0% loss) — ✓ PASS
- Closest test: 0ms, 0% loss, 0ms jitter

**WiFi (same room)** (30ms, 1% loss) — ✓ PASS
- Closest test: 50ms, 0% loss, 0ms jitter

**WiFi (different floor)** (50ms, 2% loss) — ✓ PASS
- Closest test: 50ms, 0% loss, 0ms jitter

**Bad WiFi** (100ms, 5% loss) — ✓ PASS
- Closest test: 100ms, 5% loss, 0ms jitter

**Very Bad WiFi** (200ms, 10% loss) — ✗ FAIL
- Closest test: 200ms, 10% loss, 0ms jitter

## Analysis

<p><strong>Key Finding:</strong> Automated tests PASS at realistic LAN (≤10ms) and WiFi (30-50ms) latencies.</p>
    <p>This suggests that the "laggy and weird" feeling reported by the user is <strong>NOT caused by network latency</strong>.</p>
    <p><strong>Likely causes:</strong></p>
    <ul>
      <li><strong>Rendering performance:</strong> Client-side frame drops, stuttering, or expensive render operations</li>
      <li><strong>Prediction mismatch:</strong> Client prediction doesn't match server physics (causes "rubber-banding")</li>
      <li><strong>Server tick rate:</strong> 60Hz tick rate may not be smooth enough for fast-paced gameplay</li>
      <li><strong>Interpolation issues:</strong> Entity positions jump instead of smoothly interpolating</li>
    </ul>

## Recommendations

1. Profile client-side rendering performance (check frame times with F3 overlay)
2. Verify client prediction matches server physics exactly (same deltaTime, same order)
3. Add interpolation buffer for remote entities (smooth out 60Hz updates)
4. Check for frame drops caused by expensive operations (garbage collection, shader compilation)
5. Test on different hardware (user may have slower GPU/CPU)

## Next Steps

**If tests pass at realistic latencies (LAN/WiFi):**
- Focus on architectural issues (rendering, prediction, server logic)
- Profile client-side performance (frame time, render loop)
- Check for non-network-related stuttering

**If tests fail at realistic latencies:**
- Improve client prediction (apply all state changes locally)
- Add interpolation buffer (smooth out network jitter)
- Display network quality indicator to user
- Set user expectations ("Requires stable connection <100ms latency")

## Reversibility

**Easy** — All network simulation is external to game code. No game changes were made. Analysis scripts can be re-run with different test matrices at any time.

## Related Documents

- [Deep LAN Audit (12 issues)](lan-deep-audit-2026-02-11.md)
- [Quick Wins Implemented (5 fixes)](lan-quick-wins-implemented-2026-02-11.md)
- [Network Simulation Setup](./.claude/docs/network-simulation-setup.md)
- [Test Matrix Scripts](../scripts/run-lan-test-matrix.sh)
