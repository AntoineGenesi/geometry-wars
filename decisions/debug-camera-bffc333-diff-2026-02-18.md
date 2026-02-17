# Camera + Movement: bffc333 (WORKING) vs HEAD (BROKEN) — Full Diff Analysis

**Date:** 2026-02-18
**Context:** User confirmed bffc333 worked. 15+ iterations since then have all been reported broken. Deep diff reveals 5 specific regressions.

## The bffc333 Camera Code (WORKING)

From main.ts lines 1668-1693 (monolith, before extraction):

```javascript
const CAMERA_LERP_FACTOR = 0.12;

let camOffset = playerNormal.clone().multiplyScalar(cameraDistance);
let camUp = frame.bitangent.clone();

const targetCamPos = playerWalker.position.clone().add(camOffset);
game.camera.position.lerp(targetCamPos, CAMERA_LERP_FACTOR);   // POSITION LERPED at 0.12
game.camera.lookAt(playerWalker.position);                       // lookAt FIRST
game.camera.up.lerp(camUp, CAMERA_LERP_FACTOR).normalize();    // UP LERPED AFTER lookAt, same factor
```

Key properties:
1. **BOTH position and up use `.lerp()` with the SAME factor (0.12)**
2. **`lookAt()` called BEFORE `camera.up.lerp()`**
3. No targetUp, no upHint, no sign-flip protection, no velocity damping
4. Simple, symmetric, predictable

## The bffc333 Movement Code (WORKING)

```javascript
// MeshWalker.moveFromInput — tangent-frame DIRECT, no camera involvement
moveFromInput(inputX, inputY, _camera, dt) {
    const moveDir = new THREE.Vector3()
      .addScaledVector(this._tangent, inputX)
      .addScaledVector(this._bitangent, inputY);
    return this.move(moveDir, dt);
}
```

Key: `_camera` parameter IGNORED. Input maps directly to tangent/bitangent. No feedback loop.

## 5 Regressions Found

### 1. Camera position: lerp(0.12) → instant .copy()
- **Commits:** `a4cc762`, `ebeef2a`
- **Impact:** Without position smoothing, every per-frame normal change jolts the camera

### 2. lookAt/up ORDER IS REVERSED
- **bffc333:** `lookAt()` FIRST, then `up.lerp()`
- **HEAD:** `up.lerp()` FIRST, then `lookAt()`
- **Commit:** `458078c` claims to "restore bffc333 order" but gets it BACKWARDS
- **Impact:** In Three.js, lookAt() uses camera.up to orient. Order matters.

### 3. Up-vector lerp factor 0.35 instead of 0.12
- **Commit:** `4776839` (latest)
- **Impact:** 3x faster convergence = tangent frame jitter 3x more visible

### 4. Camera-relative movement with upHint feedback loop
- **Commits:** `2902314` (camera-relative), `66230ff` (upHint)
- **bffc333:** input → tangent frame directly, camera irrelevant
- **HEAD:** input → camera axes (via upHint from targetUp) → projected onto surface
- **Circular dependency:** tangent frame → camera targetUp → upHint → movement → tangent frame
- **Impact:** Any oscillation amplifies through the loop

### 5. upHint/targetUp system
- **Does NOT exist in bffc333**
- **In HEAD:** CameraController.targetUp derived from walker bitangent, fed back as upHint
- **Impact:** Tight coupling between camera and movement that didn't exist before

## The Fix

Restore bffc333 camera behavior while keeping beneficial changes:

1. **Camera position:** `.lerp(target, 0.12)` instead of `.copy()`
2. **Camera up:** `.lerp(camUp, 0.12).normalize()` instead of `.lerp(camUp, 0.35)`
3. **Order:** `lookAt()` BEFORE `up.lerp()` (swap current order)
4. **Remove upHint from moveFromInput call** — pass undefined, let it use getWorldQuaternion
5. **Keep:** seam linking, Gram-Schmidt, sign-flip protection, vertex detection, aim caching

## Changes to KEEP (beneficial)

- HalfEdgeMesh._linkSeamEdges() — fixes cube false boundaries
- Dual Gram-Schmidt tangent frame — fixes oscillation at 45° angles
- Tangent sign-flip protection — prevents 180° frame flips
- Face normal consistency check — prevents inverted normals
- FaceWalker vertex detection tolerance 0.001 — better corner handling
- Aim direction caching — prevents aim flicker
- Pre-allocated vectors — performance
