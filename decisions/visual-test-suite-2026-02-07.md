## 2026-02-07 - Comprehensive Visual Test Suite

### Context
User requested upgrading the visual test suite to be much more comprehensive, catching bugs like bullets not emanating from player, bullets not travelling in expected direction across surfaces and bevels, plus many more domains.

### Approach: Two-Layer Testing

**Layer 1: Vitest Programmatic Tests (408 tests)** `src/test/visual-integration.test.ts`
- Headless, no browser needed, fast (5 seconds)
- Tests spatial/visual invariants using real Three.js objects + BVH
- All 11 surface types tested across 12 domains

**Layer 2: Playwright E2E Tests** `tests/visual-e2e.spec.ts`
- Browser-based with Chromium + SwiftShader for WebGL
- Tests actual rendered output, UI elements, input handling, screenshots
- Requires dev server (auto-started by playwright config on port 3001)

### Decision: Vitest over Playwright as primary

Chose Vitest integration tests as the backbone because:
- Fast (5s vs 30s+ for browser tests)
- Reliable (no WebGL driver issues, no flakiness)
- Can test precise spatial relationships (bullet position, surface distance, normal alignment)
- Catches the exact class of bugs user described (bullet origin, direction, surface following)

Playwright tests are supplementary for:
- Actual rendering verification (canvas has content, not white-out)
- UI element presence (score, lives, bombs visible)
- Input handling (keyboard, mouse don't crash)
- Screenshot regression (per-surface screenshots)

### 12 Test Domains (Vitest)

1. **Bullet Origin & Direction** - Spawn position matches player, direction tangent to surface
2. **Bullet Bevel Traversal** - Bullets survive crossing bevels, stay on surface
3. **Camera Following** - Normal offset, player centering in NDC, up vector stability
4. **Enemy Positioning** - On surface, tangent frame orthonormal, offset by radius
5. **Surface Mesh Quality** - No NaN, unit normals, degenerate triangle count, winding
6. **Bevel Continuity** - C0 continuous positions, smooth normals, no walk-stuck
7. **Depth-Based Opacity** - Front-facing visible, back-facing faded
8. **Collision Geometry** - Hit detection distance, player collision radius
9. **Player-Surface Sync** - Walker position matches mesh, UV bridge valid
10. **Grid Deformation** - Grid mesh exists, applyForce/updateGrid don't throw
11. **Multi-Bullet Scenarios** - Spread diverges, rapid fire doesn't stack
12. **World-To-Surface** - UV in [0,1] range, getPoint produces finite positions

### Results
- 688 total tests (280 existing + 408 new visual integration)
- All passing
- Runs in ~7 seconds total

### Reversibility
Easy - delete `src/test/visual-integration.test.ts` and `tests/visual-e2e.spec.ts`
