# Browser Performance Breakthroughs for WebGL/WebGPU Games

**Date:** 2026-02-09
**Context:** Geometry Wars 3D Dimensions clone using Three.js + TypeScript + Vite
**Current capacity:** ~100 enemies at 60fps (GPU-limited, ~20 draw calls per enemy)
**Target:** 10,000+ entities at 60fps

---

## Table of Contents

1. [WebGPU](#1-webgpu)
2. [OffscreenCanvas + Web Workers](#2-offscreencanvas--web-workers)
3. [WebAssembly (WASM)](#3-webassembly-wasm)
4. [HTTP Headers for Performance](#4-http-headers-for-performance)
5. [WebCodecs / WebTransport](#5-webcodecs--webtransport)
6. [Three.js Specific Optimizations](#6-threejs-specific-optimizations)
7. [GPU Compute via WebGL](#7-gpu-compute-via-webgl)
8. [Compression](#8-compression)
9. [Mobile-Specific](#9-mobile-specific)
10. [Desktop vs Mobile Analysis](#10-desktop-vs-mobile-analysis)
11. [Recommended Implementation Roadmap](#11-recommended-implementation-roadmap)
12. [Sources](#12-sources)

---

## 1. WebGPU

### Current Browser Support (February 2026)

As of November 2025, WebGPU ships by default in all major desktop browsers:

| Browser | Status | Platform Notes |
|---------|--------|----------------|
| Chrome 113+ | Stable | Windows (D3D12), macOS, ChromeOS |
| Edge 113+ | Stable | Same engine as Chrome |
| Firefox 141+ | Stable | Windows; macOS Tahoe 26 on ARM64 (FF 145+); Linux expected 2026 |
| Safari 26.0+ | Stable | macOS Tahoe 26, iOS 26, iPadOS 26, visionOS 26 |

**Global browser support: ~78%** (per caniuse.com, February 2026). This figure will rise as Firefox ships Linux support and older browser versions age out.

**Mobile support:**
- Chrome Android 121+: Stable on Android 12+ with Qualcomm/ARM GPUs
- Safari iOS 26+: Stable (requires iOS 26, released fall 2025)
- Firefox Android: Still behind a flag; Mozilla targeting 2026

### Performance vs WebGL

The performance gains are substantial and well-documented:

| Metric | WebGL | WebGPU | Improvement |
|--------|-------|--------|-------------|
| Draw calls per frame (complex scene) | 2,000+ | ~200 (with render bundles) | **~10x reduction** |
| CPU overhead per draw call | High (driver validation) | Low (pre-validated pipelines) | **3-10x lower** |
| Particle system (10K particles, CPU update) | ~30ms/frame | <2ms/frame (compute shader) | **~15x faster** |
| Particle system scale ceiling | ~100K | **1M+** at 60fps | **10x+ scale** |
| Multi-threaded command recording | Not possible | Supported | **New capability** |
| Compute shaders | Not available | Native support | **New capability** |

Key benchmark: Babylon.js Snapshot Rendering with WebGPU Render Bundles renders scenes approximately **10x faster** than equivalent WebGL. WebGPU 2.0 (early 2025) delivers 30% faster rendering and 25% lower memory usage compared to even native OpenGL.

### Three.js WebGPU Renderer

Since Three.js r171 (September 2025), the WebGPU renderer is production-ready:

```typescript
// Zero-config setup with automatic WebGL 2 fallback
import { WebGPURenderer } from 'three/webgpu';

const renderer = new WebGPURenderer();
await renderer.init(); // Mandatory - requests GPU adapter and device
```

The renderer automatically falls back to WebGL 2 on browsers without WebGPU support.

### Relevance to This Project

Current bottleneck: ~100 enemies = ~2,000 draw calls (20 per enemy). With WebGPU:
- **Instanced rendering**: All enemies of the same type rendered in 1 draw call
- **Compute shaders**: Enemy AI, movement, collision detection on GPU
- **Render bundles**: Pre-record static parts of the scene, replay at near-zero CPU cost

**Projected capacity with WebGPU:** 10,000-50,000 entities at 60fps (conservative estimate based on published benchmarks).

| Rating | Value |
|--------|-------|
| **Impact** | **Transformative** |
| **Effort** | High (renderer migration, shader rewrite) |
| **Browser Support** | ~78% desktop, ~60% mobile |
| **Recommended** | **Yes** - Primary upgrade path |

---

## 2. OffscreenCanvas + Web Workers

### Architecture Options

There are three viable architectures for distributing work across threads:

#### Option A: Render Loop on Worker (OffscreenCanvas)

Move the entire Three.js render loop to a Web Worker using `transferControlToOffscreen()`:

```typescript
// Main thread
const canvas = document.getElementById('game');
const offscreen = canvas.transferControlToOffscreen();
worker.postMessage({ canvas: offscreen }, [offscreen]);

// Worker thread
const renderer = new WebGLRenderer({ canvas: offscreen });
// Full render loop runs here, freeing main thread for input/UI
```

**Benefits:**
- Main thread stays responsive (input, UI, audio)
- Rendering immune to main thread garbage collection pauses
- Measurable improvement on low-end devices

**Limitations:**
- DOM APIs unavailable in worker (textures, fonts need workarounds)
- Three.js requires `canvas.style.width/height` shim (OffscreenCanvas lacks `style`)
- Some Three.js features (HTML overlays, CSS3DRenderer) require main thread

#### Option B: Physics/Game Logic on Worker

Keep rendering on main thread, offload computation:

```typescript
// Physics worker
const positions = new Float32Array(sharedBuffer); // SharedArrayBuffer
// Update 10,000 entity positions every 16ms
// Main thread reads positions directly - zero copy
```

#### Option C: Hybrid (Recommended)

- **Worker 1:** Physics + collision detection (SharedArrayBuffer for entity state)
- **Worker 2:** Enemy AI + pathfinding
- **Main thread:** Rendering + input + audio

### SharedArrayBuffer for Zero-Copy Data Sharing

SharedArrayBuffer eliminates the performance penalty of `postMessage` cloning:

| Method | 10K entities/frame | Latency |
|--------|-------------------|---------|
| postMessage (structured clone) | ~2-5ms overhead | Variable |
| Transferable (zero-copy, ownership transfer) | ~0.1ms | Low |
| SharedArrayBuffer (true shared memory) | **~0ms** | **Near-zero** |

For a game loop sending entity positions at 60fps, `postMessage` with 10K entities creates ~4MB/s of garbage. SharedArrayBuffer eliminates this entirely.

**Synchronization:** Use `Atomics.wait()` / `Atomics.notify()` for thread coordination. Use `Atomics.store()` / `Atomics.load()` for lock-free reads of entity state.

### Browser Support

**OffscreenCanvas:** 95% global support (Chrome 69+, Firefox 105+, Safari 17+, Edge 79+).

**SharedArrayBuffer:** Requires Cross-Origin Isolation headers (see Section 4). Supported in all modern browsers but gated behind security requirements.

### Relevance to This Project

The current game has geodesic face walking (MeshWalker), BVH collision detection, and enemy AI all running on the main thread. Moving physics to a worker would:
- Free ~8-12ms per frame for rendering
- Allow the render loop to maintain 60fps even during heavy computation frames
- Enable the physics to run at a higher tick rate (120Hz) independent of rendering

| Rating | Value |
|--------|-------|
| **Impact** | **High** |
| **Effort** | Medium (physics worker) to High (full OffscreenCanvas) |
| **Browser Support** | 95% (OffscreenCanvas), 93%+ (SharedArrayBuffer with headers) |
| **Recommended** | **Yes** - Physics worker is high-value, moderate effort |

---

## 3. WebAssembly (WASM)

### Performance Profile

WASM delivers near-native performance for compute-intensive operations:

| Workload | JS Performance | WASM Performance | WASM+SIMD Performance |
|----------|---------------|------------------|----------------------|
| Physics simulation | Baseline | **5-15x faster** | **10-20x faster** |
| Collision detection | Baseline | **5-20x faster** | **15-30x faster** |
| Spatial hashing (10K entities) | ~8ms | ~1.5ms | **~0.5ms** |
| Matrix operations (batch) | Baseline | 3-5x faster | **8-12x faster** |

Real-world case study: collision detection consuming 70% of frame time (2,500 calculations/entity/physics step) saw an **87% reduction in processing time** after WASM migration.

### Rapier Physics Engine (rapier.js)

Rapier is the leading Rust-based physics engine compiled to WASM for browser use:

- **2025 improvements:** 2-5x faster than the 2024 version (v0.24.0)
- **New BVH:** Dynamic BVH with automatic rebalancing and SIMD-accelerated tree traversals
- **SIMD packages:** `@dimforge/rapier3d-simd` for browsers with WASM SIMD support
- **3D physics:** Full rigid body dynamics, collision detection, raycasting, joint constraints

```typescript
import RAPIER from '@dimforge/rapier3d-simd';

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

// Create 10K colliders for entities
for (let i = 0; i < 10000; i++) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
  world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
}

// Step simulation: ~1-3ms for 10K bodies with SIMD
world.step();
```

### Custom WASM Modules (Rust + wasm-bindgen)

For game-specific logic not covered by Rapier:

```rust
// Spatial hash grid in Rust, compiled to WASM
#[wasm_bindgen]
pub struct SpatialGrid {
    cells: Vec<Vec<u32>>,
    cell_size: f32,
}

#[wasm_bindgen]
impl SpatialGrid {
    pub fn query_radius(&self, x: f32, y: f32, z: f32, r: f32) -> Vec<u32> {
        // SIMD-accelerated distance checks
        // Returns entity IDs within radius
    }
}
```

### WASM SIMD Support

**Global browser support: 94.52%** (per caniuse.com, February 2026).

All major browsers fully support 128-bit fixed-width SIMD:
- Chrome 91+, Firefox 89+, Safari 16.6+, Edge 91+
- Chrome Android and Firefox Android: full support

### Relevance to This Project

The game's performance bottlenecks that WASM would address:
1. **Collision detection** (bullet-enemy, player-enemy, entity-geom): Currently O(n^2) without spatial partitioning
2. **Geodesic face walking** (HalfEdgeMesh traversal): Pointer-chasing workload that WASM handles better than JS
3. **Enemy AI updates** (15+ enemy types with different behaviors): Batch-processable in WASM
4. **Spatial queries** (aura system proximity checks, chain lightning targeting): Perfect SIMD workload

| Rating | Value |
|--------|-------|
| **Impact** | **High** |
| **Effort** | High (Rust toolchain, WASM build pipeline, JS interop) |
| **Browser Support** | 94.5% (WASM SIMD), 97%+ (WASM baseline) |
| **Recommended** | **Yes** - For collision detection and physics; use Rapier first, custom WASM second |

---

## 4. HTTP Headers for Performance

### Cross-Origin Isolation

SharedArrayBuffer and high-resolution timers require Cross-Origin Isolation, which is enforced via HTTP headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These headers enable:
- **SharedArrayBuffer:** Required for zero-copy worker communication
- **High-resolution timers:** `performance.now()` at full precision (5 microsecond vs 100 microsecond)
- **`performance.measureUserAgentSpecificMemory()`:** Memory profiling
- **WASM threads:** `SharedArrayBuffer` is required for WASM multi-threading

### Implementation for Vite Dev Server

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

### Gotchas

1. **Third-party resources:** All cross-origin resources must include `Cross-Origin-Resource-Policy: cross-origin` or be loaded via `<link crossorigin>`. This affects CDN-hosted assets, Google Fonts, analytics scripts, etc.
2. **OAuth popups:** `COOP: same-origin` breaks `window.opener` communication used by OAuth flows. Use `COOP: same-origin-allow-popups` if OAuth is needed.
3. **GitHub Pages:** Cannot set custom headers. Workaround: use a Service Worker to inject headers (see `coi-serviceworker` library).
4. **COEP credentialless:** Chrome 96+ supports `COEP: credentialless` as a less restrictive alternative to `require-corp`, but other browsers have limited support.

### Relevance to This Project

These headers are a prerequisite for SharedArrayBuffer (Section 2) and WASM threads (Section 3). The game already runs Colyseus for multiplayer, so server header configuration is straightforward.

| Rating | Value |
|--------|-------|
| **Impact** | **Medium** (enabler for High-impact features) |
| **Effort** | **Low** (2-3 lines of config) |
| **Browser Support** | 93%+ |
| **Recommended** | **Yes** - Do this first; it unblocks SharedArrayBuffer and WASM threads |

---

## 5. WebCodecs / WebTransport

### WebTransport

WebTransport is a next-generation transport protocol built on HTTP/3 and QUIC (UDP-based), offering significant advantages over WebSockets for multiplayer gaming:

| Feature | WebSocket | WebTransport |
|---------|-----------|--------------|
| Protocol | TCP | QUIC (UDP-based) |
| Head-of-line blocking | Yes (single stream) | **No** (multiplexed streams) |
| Unreliable datagrams | Not possible | **Supported** (UDP-like) |
| Latency (average) | Baseline | **5-15ms lower** |
| Multiple streams | No | **Yes** (independent) |
| Connection migration | No | Yes (survives network changes) |

Real-world results: migrating real-time updates to WebTransport reduced average latency by **35%**. A game streaming system achieved end-to-end latency of 115ms.

**Key advantage for Geometry Wars multiplayer:** Unreliable datagrams are perfect for position updates (latest value matters, old ones are stale). Reliable streams handle score updates, game events.

### Colyseus WebTransport Support

Colyseus has WebTransport on its public roadmap with an experimental implementation using `@fails-components/webtransport`. However, it is **not battle-tested** and not recommended for production as of early 2026.

### WebCodecs

WebCodecs provides low-level access to video/audio codecs for encoding and decoding. Primary use case: game streaming and video chat, not directly relevant for a locally-rendered game. Could be relevant if implementing spectator mode with video streaming.

### Browser Support

- **WebTransport:** Chrome 97+, Edge 97+, Firefox 114+, Safari 26+ (~75% global)
- **WebCodecs:** Chrome 94+, Edge 94+, Firefox 130+, Safari 26+ (~78% global)

### Relevance to This Project

The game uses Colyseus with WebSockets. WebTransport would improve the network multiplayer mode, but Colyseus support is experimental. The biggest win would be for position synchronization where stale data should be dropped rather than queued.

| Rating | Value |
|--------|-------|
| **Impact** | **Medium** (multiplayer-only improvement) |
| **Effort** | Medium (Colyseus experimental support, server changes) |
| **Browser Support** | ~75% |
| **Recommended** | **No** - Wait for Colyseus to stabilize WebTransport support |

---

## 6. Three.js Specific Optimizations

### 6.1 InstancedMesh (Available Now - WebGL)

The single highest-impact optimization for the current codebase. Instead of 20 draw calls per enemy (100 enemies = 2,000 draw calls), use one InstancedMesh per enemy type:

```typescript
// Before: 100 enemies x 20 draw calls = 2,000 draw calls
enemies.forEach(e => scene.add(e.mesh)); // Each is a separate draw call

// After: 15 enemy types x 1 draw call = 15 draw calls
const wandererInstances = new InstancedMesh(wandererGeom, wandererMat, 1000);
const pinwheelInstances = new InstancedMesh(pinwheelGeom, pinwheelMat, 500);
// Update transforms per frame:
wandererInstances.setMatrixAt(i, matrix);
wandererInstances.instanceMatrix.needsUpdate = true;
```

**Expected improvement:** From ~2,000 draw calls to ~15-30 draw calls. This alone could push capacity from 100 to **2,000-5,000 enemies** on WebGL.

| Rating | Value |
|--------|-------|
| **Impact** | **Transformative** |
| **Effort** | **Medium** |
| **Browser Support** | 97%+ (WebGL 2) |
| **Recommended** | **Yes** - Do this first, biggest bang for buck |

### 6.2 BatchedMesh (Three.js r156+)

BatchedMesh extends beyond InstancedMesh by allowing different geometries to share a single draw call (as long as they share a material):

```typescript
const batchedMesh = new BatchedMesh(maxGeometryCount, maxVertexCount, maxIndexCount, material);

const geomId1 = batchedMesh.addGeometry(wandererGeometry);
const geomId2 = batchedMesh.addGeometry(pinwheelGeometry);

// Each instance can use a different geometry
const instanceId = batchedMesh.addInstance(geomId1);
batchedMesh.setMatrixAt(instanceId, matrix);
batchedMesh.setVisibleAt(instanceId, true); // Toggle visibility without recreating
```

**Use case:** All enemies share the same neon glow material but have different shapes. BatchedMesh could render ALL enemy types in a single draw call.

**Caveat:** Reports of CPU overhead with BatchedMesh in some scenarios. Profile before committing.

| Rating | Value |
|--------|-------|
| **Impact** | **High** |
| **Effort** | Medium |
| **Browser Support** | 97%+ (WebGL 2) |
| **Recommended** | **Yes** - After InstancedMesh, if per-type instancing isn't enough |

### 6.3 TSL (Three Shading Language)

TSL is Three.js's node-based material system that compiles to either WGSL (WebGPU) or GLSL (WebGL):

```typescript
import { color, positionLocal, sin, time, instanceIndex, float } from 'three/tsl';

// Cross-platform shader that works on both WebGL and WebGPU
const material = new MeshBasicNodeMaterial();
material.colorNode = color(0x00ffff).mul(sin(time.add(float(instanceIndex).mul(0.01))));
```

**Benefits for this project:**
- Write shaders once, run on both WebGL and WebGPU
- Node-based composition is more maintainable than raw GLSL/WGSL
- GPU-side entity glow, pulsing, color cycling without CPU involvement
- Foundation for future WebGPU compute shader integration

| Rating | Value |
|--------|-------|
| **Impact** | **Medium** (maintainability + future-proofing) |
| **Effort** | Medium (learning curve, shader migration) |
| **Browser Support** | 97%+ (compiles to GLSL for WebGL fallback) |
| **Recommended** | **Yes** - For new shaders; migrate existing gradually |

### 6.4 WebGPU Compute Shaders for Particle Systems

The current `ParticleSystem` uses GPU instancing with 5,000 particles. WebGPU compute shaders could push this to **1,000,000+**:

```typescript
import { instancedArray, compute, storage } from 'three/tsl';

// Create persistent GPU buffer for 1M particles
const particleBuffer = instancedArray(1000000, 'vec4');

// Compute shader: update all particles in parallel on GPU
const updateParticles = compute(() => {
  const particle = particleBuffer.element(instanceIndex);
  const pos = particle.xyz;
  const vel = /* physics calculation */;
  particleBuffer.element(instanceIndex).assign(pos.add(vel.mul(deltaTime)));
}, 1000000);

// Each frame: dispatch compute, then render
renderer.computeAsync(updateParticles);
renderer.renderAsync(scene, camera);
```

**Key insight:** `instancedArray` creates persistent GPU buffers that survive across frames, eliminating CPU-GPU data transfer that kills traditional particle system performance.

| Rating | Value |
|--------|-------|
| **Impact** | **Transformative** (for particles and effects) |
| **Effort** | High (WebGPU renderer required) |
| **Browser Support** | ~78% (WebGPU) |
| **Recommended** | **Yes** - After WebGPU migration |

---

## 7. GPU Compute via WebGL

For browsers without WebGPU, GPU-side computation is still possible through WebGL 2 techniques.

### 7.1 Transform Feedback (WebGL 2)

Transform feedback captures vertex shader output into buffers, enabling GPU-side entity updates without readback:

```glsl
// Vertex shader: update entity positions on GPU
#version 300 es
in vec3 position;
in vec3 velocity;
out vec3 outPosition; // Captured by transform feedback

uniform float deltaTime;

void main() {
  outPosition = position + velocity * deltaTime;
}
```

**Capabilities:**
- Update entity positions, velocities, lifetimes entirely on GPU
- No CPU readback needed if rendering from the output buffer
- ~100K entities at 60fps achievable

**Limitations:**
- Cannot do random access reads (no storage buffers)
- Limited to vertex shader operations
- Harder to debug than compute shaders
- Three.js has limited built-in support; requires raw WebGL calls

### 7.2 Ping-Pong Texture (GPGPU)

Store entity state as pixels in floating-point textures, process with fragment shaders:

```
Frame N:
  Read from Texture A (current state)
  Write to Texture B (next state) via fragment shader
Frame N+1:
  Read from Texture B
  Write to Texture A
  ... repeat
```

**Capabilities:**
- Full random access reads (texture sampling)
- Suitable for spatial queries (collision detection via texture lookup)
- Can encode arbitrary data (position, velocity, health, type) as RGBA float values
- Proven technique: 1M+ particle simulations exist using this approach

**Limitations:**
- Fragment shader cannot write to arbitrary locations (only its pixel)
- Debugging is painful (data is in textures)
- Encoding/decoding entity state to/from textures adds complexity

### Relevance to This Project

These techniques are the WebGL fallback for what WebGPU compute shaders do natively. For the particle system specifically, ping-pong textures could push capacity from 5,000 to 100,000+ without requiring WebGPU.

| Rating | Value |
|--------|-------|
| **Impact** | **High** (for particles), **Medium** (for entity updates) |
| **Effort** | High (raw WebGL, custom shaders, debugging difficulty) |
| **Browser Support** | 97%+ (WebGL 2) |
| **Recommended** | **Conditional** - Only if WebGPU adoption is too low for your audience |

---

## 8. Compression

### 8.1 Brotli / Gzip for Asset Delivery

| Algorithm | Compression Ratio | Compression Speed | Decompression Speed | Browser Support |
|-----------|------------------|-------------------|---------------------|-----------------|
| Gzip | Baseline | Fast | Fast | 99%+ |
| Brotli | **15-25% smaller** than Gzip | Slow (static OK) | Fast | 97%+ |
| Zstandard | Similar to Brotli | **Faster** than Brotli | Faster | Limited |

Brotli reduced page load times on 3G networks by up to **28%** compared to Gzip.

**Implementation with Vite:**

```typescript
// vite.config.ts
import compression from 'vite-plugin-compression2';

export default defineConfig({
  plugins: [
    compression({
      algorithm: 'brotliCompress',
      ext: '.br',
      threshold: 1024,
      compressionOptions: { level: 11 }, // Max compression for static assets
    }),
    compression({
      algorithm: 'gzip',
      ext: '.gz',
      threshold: 1024,
    }),
  ],
});
```

Serve both formats; let the browser choose via `Accept-Encoding`. Brotli for modern browsers, Gzip fallback for older ones.

### 8.2 Texture Compression (Basis Universal / KTX2)

KTX2 with Basis Universal provides GPU-compressed textures that decompress on the GPU, saving both download size and GPU memory:

| Format | Size vs PNG | GPU Memory | Quality | Browser Support |
|--------|------------|------------|---------|-----------------|
| PNG | Baseline | Uncompressed in VRAM | Lossless | 99%+ |
| JPEG | ~60% smaller | Uncompressed in VRAM | Lossy | 99%+ |
| KTX2/Basis | **75-85% smaller** | **Compressed in VRAM** | Near-lossless | 95%+ (via WASM transcoder) |

Three.js has built-in support:

```typescript
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

const ktx2Loader = new KTX2Loader()
  .setTranscoderPath('basis/')
  .detectSupport(renderer);

const texture = await ktx2Loader.loadAsync('surface.ktx2');
```

The KTX2Loader auto-detects the best GPU-compressed format for each device (BC7 on desktop, ASTC on mobile, ETC2 fallback).

### Relevance to This Project

The game is primarily procedural (geometry + shaders), not texture-heavy. Brotli compression has the most impact on JavaScript bundle size and the OBJ/GLB model files loaded by MeshLoader. KTX2 would matter if surface textures are added later.

| Rating | Value |
|--------|-------|
| **Impact** | **Low** (Brotli: moderate for initial load; KTX2: low for current project) |
| **Effort** | **Low** (Brotli: Vite plugin; KTX2: loader setup) |
| **Browser Support** | 97%+ (Brotli), 95%+ (KTX2 via WASM transcoder) |
| **Recommended** | **Yes for Brotli** (free performance); **No for KTX2** (no textures currently) |

---

## 9. Mobile-Specific

### 9.1 Touch Input Latency

Touch sampling rates vary dramatically across devices:
- Budget phones: 60-120Hz touch sampling
- Mid-range: 120-240Hz
- Gaming phones: 360-720Hz

**Optimization strategies:**
- Use `touchstart` / `touchmove` with `{ passive: true }` to avoid blocking the compositor
- Implement input prediction (extrapolate position between touch samples)
- Avoid `preventDefault()` on touch events when possible (adds ~100ms delay on older Android)
- Use `pointer` events for unified touch/mouse handling

### 9.2 Shader Precision

Mobile GPUs process `mediump` approximately **2x faster** than `highp`:

```glsl
// Explicit precision for mobile performance
precision mediump float; // 16-bit, range -2^14 to 2^14

// Use highp only where needed (world-space positions, depth)
// Use mediump for colors, UVs, normals, lighting
// Use lowp for boolean-like values, simple flags
```

**Three.js configuration:**

```typescript
const renderer = new WebGLRenderer({
  precision: 'mediump', // Default shader precision
  powerPreference: 'high-performance', // Request discrete GPU on laptops
});
```

**Caveat:** Some mobile GPUs don't support `highp` in fragment shaders at all. Use the `GL_FRAGMENT_PRECISION_HIGH` preprocessor check.

### 9.3 Adaptive Quality

Implement a dynamic quality system that responds to frame rate and device capabilities:

```typescript
class AdaptiveQuality {
  private targetFPS = 60;
  private qualityLevel = 1.0; // 0.0 to 1.0

  update(currentFPS: number) {
    if (currentFPS < this.targetFPS * 0.85) {
      this.qualityLevel = Math.max(0.25, this.qualityLevel - 0.05);
    } else if (currentFPS > this.targetFPS * 0.95) {
      this.qualityLevel = Math.min(1.0, this.qualityLevel + 0.01);
    }
    this.applyQuality();
  }

  private applyQuality() {
    // Resolution scaling (biggest impact)
    renderer.setPixelRatio(window.devicePixelRatio * this.qualityLevel);

    // Particle count scaling
    particleSystem.maxParticles = Math.floor(5000 * this.qualityLevel);

    // Bloom quality
    bloomPass.resolution.set(
      Math.floor(512 * this.qualityLevel),
      Math.floor(512 * this.qualityLevel)
    );

    // Enemy count cap
    enemySpawner.maxEnemies = Math.floor(MAX_ENEMIES * this.qualityLevel);
  }
}
```

### 9.4 Battery and Thermal Management

- **Frame rate limiting:** Target 30fps on battery to reduce GPU demand 50%
- **Resolution scaling:** Use `devicePixelRatio * 0.5` on mobile (most phones have 2-3x DPR, so rendering at 1-1.5x is still sharp)
- **Thermal throttling detection:** Monitor frame time variance; sudden increases indicate thermal throttling
- **Battery API:** `navigator.getBattery()` to detect low battery and auto-reduce quality

```typescript
const battery = await navigator.getBattery();
if (battery.level < 0.2 && !battery.charging) {
  adaptiveQuality.setMaxQuality(0.5); // Half quality on low battery
  targetFPS = 30;
}
```

### 9.5 Mobile WebGPU

With iOS 26 shipping WebGPU in Safari, mobile WebGPU is becoming viable:
- **iOS:** Safari 26+ on A12+ chips (iPhone XS and newer)
- **Android:** Chrome 121+ on Android 12+ with Qualcomm/ARM GPUs
- **Implication:** WebGPU compute shaders are available on flagship mobile devices from 2025+

| Rating | Value |
|--------|-------|
| **Impact** | **High** (adaptive quality), **Medium** (touch, precision, battery) |
| **Effort** | Medium (adaptive quality system), Low (precision/touch fixes) |
| **Browser Support** | N/A (applies to all mobile browsers) |
| **Recommended** | **Yes** - Adaptive quality is essential for mobile |

---

## 10. Desktop vs Mobile Analysis

### Desktop Performance Budget (Target: 10,000 entities at 60fps)

| Optimization | Entities Enabled | Effort | Priority |
|--------------|-----------------|--------|----------|
| Current baseline | ~100 | - | - |
| InstancedMesh (WebGL) | **2,000-5,000** | Medium | **P0** |
| + Physics Worker (SharedArrayBuffer) | **5,000-8,000** | Medium | **P1** |
| + WASM collision detection (Rapier) | **8,000-12,000** | High | **P2** |
| + WebGPU renderer + compute shaders | **20,000-50,000** | High | **P3** |

**Desktop recommendation:** InstancedMesh alone gets you to the 5K range. Adding a physics worker and WASM collision detection pushes past the 10K target. WebGPU is for going beyond 10K or adding richer effects.

### Mobile Performance Budget (Target: 1,000-3,000 entities at 30-60fps)

| Optimization | Entities Enabled | Effort | Priority |
|--------------|-----------------|--------|----------|
| Current baseline (mobile) | ~30-50 | - | - |
| InstancedMesh + mediump shaders | **500-1,500** | Medium | **P0** |
| + Adaptive quality (resolution scaling) | **1,000-2,000** | Medium | **P1** |
| + WASM collision (Rapier SIMD) | **1,500-3,000** | High | **P2** |
| + WebGPU (iOS 26+ / Android 12+) | **3,000-10,000** | High | **P3** |

**Mobile recommendation:** Lower the target to 1,000-3,000 entities. Focus on InstancedMesh + adaptive quality first. WASM collision detection provides the biggest mobile-specific gain because mobile CPUs are the primary bottleneck (not GPUs).

### Feature Support Matrix

| Feature | Desktop Chrome | Desktop Firefox | Desktop Safari | iOS Safari | Android Chrome |
|---------|---------------|-----------------|----------------|------------|----------------|
| WebGPU | Yes | Yes (Win/Mac) | Yes (macOS 26) | Yes (iOS 26) | Yes (Android 12+) |
| OffscreenCanvas | Yes | Yes | Yes (17+) | Yes (17+) | Yes |
| SharedArrayBuffer | Yes (with headers) | Yes (with headers) | Yes (with headers) | Yes (with headers) | Yes (with headers) |
| WASM SIMD | Yes | Yes | Yes (16.6+) | Yes (16.6+) | Yes |
| WebTransport | Yes | Yes | Yes (26+) | Yes (26+) | Yes |
| Transform Feedback | Yes | Yes | Yes | Yes | Yes |

---

## 11. Recommended Implementation Roadmap

### Phase 1: Quick Wins (1-2 weeks, WebGL-only, 97%+ browser support)

1. **InstancedMesh per enemy type** - Group all enemies of each type into one InstancedMesh. ~15 draw calls instead of ~2,000. Expected: **20-50x entity capacity increase**.
2. **Cross-Origin Isolation headers** - Add COOP/COEP headers to Vite config. Unblocks SharedArrayBuffer.
3. **Brotli compression** - Add `vite-plugin-compression2` for Brotli + Gzip build output.
4. **`renderer.info` monitoring** - Add draw call and triangle count to debug HUD.

### Phase 2: Worker Architecture (2-4 weeks, 95% browser support)

5. **Physics/collision worker** - Move collision detection (bullet-enemy, player-enemy, entity-geom) to a Web Worker with SharedArrayBuffer for entity state.
6. **Enemy AI worker** - Move enemy behavior updates (15 types) to a separate worker.
7. **Adaptive quality system** - Implement FPS-responsive quality scaling for mobile.

### Phase 3: WASM Integration (3-6 weeks, 94% browser support)

8. **Rapier.js for collision detection** - Replace custom collision detection with Rapier's SIMD-accelerated BVH. Use `@dimforge/rapier3d-simd`.
9. **WASM spatial hash grid** - Custom Rust module for aura proximity checks, chain lightning targeting, and other spatial queries.

### Phase 4: WebGPU Migration (4-8 weeks, ~78% browser support)

10. **WebGPU renderer** - Switch to `WebGPURenderer` with WebGL 2 fallback.
11. **TSL shaders** - Migrate custom shaders to TSL for cross-platform compatibility.
12. **Compute shader particles** - Replace GPU particle system with compute shader-based system (1M+ particles).
13. **Compute shader enemy updates** - Move enemy position updates to GPU compute.

### Phase 5: Network Optimization (future, when Colyseus stabilizes)

14. **WebTransport for multiplayer** - Replace WebSocket transport with WebTransport when Colyseus support matures.

---

## 12. Sources

### WebGPU
- [WebGPU browser support status](https://web.dev/blog/webgpu-supported-major-browsers)
- [WebGPU Can I Use](https://caniuse.com/webgpu)
- [WebGPU Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
- [WebGPU supported by all major browsers](https://videocardz.com/newz/webgpu-is-now-supported-by-all-major-browsers)
- [WebGPU critical mass announcement](https://www.webgpu.com/news/webgpu-hits-critical-mass-all-major-browsers-now-ship-it/)
- [WebGPU/WebGL performance comparison best practices](https://toji.dev/webgpu-best-practices/webgl-performance-comparison.html)
- [WebGPU performance benchmarks and real-world applications](https://www.mayhemcode.com/2025/12/gpu-acceleration-in-browsers-webgpu.html)
- [WebGPU vs WebGL performance comparison](https://fsjs.dev/webgpu-vs-webgl-performance-comparison/)
- [WebGPU 2.0 beating native OpenGL](https://markaicode.com/webgpu-2-chrome-2025-performance/)
- [WebGPU render bundle best practices](https://toji.dev/webgpu-best-practices/render-bundles.html)
- [WebGPU indirect draw best practices](https://toji.dev/webgpu-best-practices/indirect-draws.html)
- [WebGPU game physics: 1M particles](https://markaicode.com/webgpu-physics-simulation-1m-particles/)
- [WebGPU game development: 120 FPS](https://markaicode.com/webgpu-game-development-120fps/)
- [WebGPU in iOS 26](https://appdevelopermagazine.com/webgpu-in-ios-26/)
- [Safari 26 WebGPU announcement](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)

### Three.js
- [Three.js WebGPU renderer tutorial](https://sbcode.net/threejs/webgpu-renderer/)
- [100 Three.js tips for performance (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- [What changed in Three.js 2026](https://www.utsubo.com/blog/threejs-2026-what-changed)
- [BatchedMesh and WebGPU post-processing](https://tympanus.net/codrops/2024/10/30/interactive-3d-with-three-js-batchedmesh-and-webgpurenderer/)
- [TSL field guide](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)
- [Galaxy simulation with compute shaders](https://threejsroadmap.com/blog/galaxy-simulation-webgpu-compute-shaders)
- [GPGPU particles with TSL](https://wawasensei.dev/courses/react-three-fiber/lessons/tsl-gpgpu)
- [TSL: better shaders in Three.js](https://threejsroadmap.com/blog/tsl-a-better-way-to-write-shaders-in-threejs)
- [Draw calls: the silent killer](https://threejsroadmap.com/blog/draw-calls-the-silent-killer)
- [InstancedMesh documentation](https://threejs.org/docs/pages/InstancedMesh.html)
- [BatchedMesh documentation](https://threejs.org/docs/pages/BatchedMesh.html)
- [InstancedMesh vs BatchedMesh discussion](https://discourse.threejs.org/t/how-to-choose-between-instancedmesh-and-batchedmesh/81221)
- [BatchedMesh for high-performance rendering](https://waelyasmina.net/articles/batchedmesh-for-high-performance-rendering-in-three-js/)
- [Three.js instances tutorial](https://tympanus.net/codrops/2025/07/10/three-js-instances-rendering-multiple-objects-simultaneously/)
- [KTX2Loader documentation](https://threejs.org/docs/pages/KTX2Loader.html)

### OffscreenCanvas + Web Workers
- [OffscreenCanvas speed up with web workers](https://web.dev/articles/offscreen-canvas)
- [OffscreenCanvas MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- [Faster Three.js with OffscreenCanvas (Evil Martians)](https://evilmartians.com/chronicles/faster-webgl-three-js-3d-graphics-with-offscreencanvas-and-web-workers)
- [OffscreenCanvas Can I Use](https://caniuse.com/offscreencanvas)
- [Three.js OffscreenCanvas example](https://threejs.org/examples/webgl_worker_offscreencanvas.html)
- [SharedArrayBuffer and parallel computing](https://medium.com/@maximdevtool/web-workers-sharedarraybuffer-parallel-computing-for-heavy-algorithms-in-frontend-662391ae0558)
- [High-performance JS: Workers + SharedArrayBuffer](https://dev.to/rigalpatel001/high-performance-javascript-simplified-web-workers-sharedarraybuffer-and-atomics-3ig1)
- [SharedArrayBuffer MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
- [JS physics in a web worker](https://dev.to/jerzakm/running-js-physics-in-a-webworker-part-1-proof-of-concept-ibj)

### WASM
- [Rapier 2025 review and 2026 goals](https://dimforge.com/blog/2026/01/09/the-year-2025-in-dimforge/)
- [Rapier physics engine](https://rapier.rs/)
- [rapier.js GitHub](https://github.com/dimforge/rapier.js)
- [Rust + WASM performance: JS vs wasm-bindgen vs raw WASM with SIMD](https://dev.to/bence_rcz_fe471c168707c1/rust-webassembly-performance-javascript-vs-wasm-bindgen-vs-raw-wasm-with-simd-4pco)
- [WASM and high-performance web apps](https://dev.to/softwaredeveloperhub01/webassembly-high-performance-web-apps-the-future-of-blazing-fast-browser-experiences-4ino)
- [WebAssembly in 2025](https://futuretechstack.io/posts/webassembly-performance-2025/)
- [Rust + WASM 2025: WasmGC and SIMD](https://dev.to/dataformathub/rust-webassembly-2025-why-wasmgc-and-simd-change-everything-3ldh)
- [WASM SIMD Can I Use](https://caniuse.com/wasm-simd)
- [State of WebAssembly 2025-2026](https://platform.uno/blog/the-state-of-webassembly-2025-2026/)

### HTTP Headers
- [Cross-origin isolation with COOP and COEP](https://web.dev/articles/coop-coep)
- [Why you need cross-origin isolation](https://web.dev/articles/why-coop-coep)
- [Cross-origin isolation guide](https://web.dev/articles/cross-origin-isolation-guide)
- [COOP/COEP headers on static hosting](https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/)

### WebTransport / WebCodecs
- [Multiplayer sync with WebTransport 2025](https://markaicode.com/webtransport-multiplayer-games-2025/)
- [Beyond WebSockets: WebTransport 35% latency cut](https://www.vroble.com/2025/11/beyond-websockets-mastering.html)
- [Node.js WebTransport 2025 guide](https://www.videosdk.live/developer-hub/webtransport/nodejs-webtransport)
- [Colyseus WebTransport documentation](https://docs.colyseus.io/server/transport/webtransport)
- [Colyseus framework](https://colyseus.io/framework/)

### GPU Compute (WebGL)
- [GPU-accelerated particles with WebGL 2](https://gpfault.net/posts/webgl2-particles.txt.html)
- [WebGPU: from ping-pong WebGL to compute shader](https://medium.com/phishchiang/webgpu-from-ping-pong-webgl-to-compute-shader-%EF%B8%8F-1ab3d8a461e2)
- [Ping-pong technique for stateful rendering](https://olha-stefanishyna.medium.com/stateful-rendering-with-ping-pong-technique-6c6ef3f5091a)
- [Particle life simulation with WebGPU](https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html)

### Compression
- [Brotli vs Gzip comparison](https://onenine.com/gzip-vs-brotli-compression-comparison/)
- [Brotli vs Gzip: which is best for web performance](https://www.ioriver.io/blog/gzip-vs-brotli-compression-performance)
- [Brotli vs GZIP: what to choose in 2025](https://devdiggers.com/brotli-vs-gzip/)
- [HTTP compression: Gzip and Brotli](https://www.debugbear.com/blog/http-compression-gzip-brotli)
- [Brotli, Gzip, Zstd comparison on real web assets](https://medium.com/@jatin.dhall7385/from-fast-to-ultra-small-brotli-gzip-zstd-lz4-snappy-on-real-web-assets-part-1-the-209ca13347ed)
- [Choosing texture formats for WebGL and WebGPU](https://www.donmccurdy.com/2024/02/11/web-texture-formats/)
- [Basis Universal GitHub](https://github.com/BinomialLLC/basis_universal)
- [vite-plugin-compression GitHub](https://github.com/vbenjs/vite-plugin-compression)

### Mobile
- [WebGL in mobile development: challenges and solutions](https://blog.pixelfreestudio.com/webgl-in-mobile-development-challenges-and-solutions/)
- [Mobile gaming optimization 2025](https://exscape.com/mobile-gaming-optimization-2025-the-complete-performance-guide-for-android-and-ios/)
- [WebGL best practices (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
- [Use mediump precision in WebGL (Chrome)](https://developer.chrome.com/blog/use-mediump-precision-in-webgl-when-possible)
- [Shader precision issues](https://webglfundamentals.org/webgl/lessons/webgl-precision-issues.html)
