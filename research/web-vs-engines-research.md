# Browser-Based Game Development vs Unity & Godot: Comprehensive Research Report

**Date:** 2026-02-09
**Context:** Geometry Wars 3D Dimensions browser recreation using Three.js + TypeScript + Vite + Colyseus
**Current Project State:** ~110 source files, 1266 tests, 10K entity target, 10 surface types, 15 enemy types

---

## Executive Summary (TL;DR)

The browser-based approach using Three.js/TypeScript/Vite is **well-suited for this project** and offers distinct advantages that Unity and Godot cannot match for a multiplayer arcade game targeting wide audiences. The zero-install distribution model alone is a decisive advantage for casual/competitive multiplayer games. With WebGPU now shipping in all major browsers (Chrome, Firefox, Safari, Edge as of January 2026), the historical performance gap between browser games and native engines has narrowed dramatically --- WebGPU compute shaders can handle 1M+ particles at 60fps and offer 2-5x draw-call throughput over WebGL2.

**Key trade-offs:**
- **Browser wins:** Distribution (zero install), iteration speed (47ms HMR), testing infrastructure, multiplayer integration, open-source flexibility, cost
- **Engines win:** Complex 3D scenes with heavy geometry, visual editors, console deployment, built-in physics/animation, asset marketplace
- **For Geometry Wars specifically:** The browser approach is optimal. The game has stylized neon graphics (not photorealistic), arcade-scale entity counts (10K is achievable), and multiplayer is core --- all areas where the browser stack excels.

---

## 1. Performance Comparison

### 1.1 Rendering Pipeline

| Metric | Three.js WebGL2 | Three.js WebGPU | Unity Native | Unity WebGL Export | Godot Native | Godot Web Export |
|--------|-----------------|-----------------|--------------|-------------------|--------------|-----------------|
| Draw calls/frame (comfortable) | ~100-300 | ~500-1000+ | ~2000-5000 | ~100-300 | ~1000-3000 | ~100-300 |
| InstancedMesh/MultiMesh | Yes (1 draw call per type) | Yes + compute | GPU Instancing + DOTS | Limited | MultiMesh | Limited |
| Compute shaders | No (WebGL2) | Yes (WGSL) | Yes (HLSL) | No | Yes (GLSL) | No |
| Shader language | GLSL / TSL | WGSL / TSL | ShaderLab/HLSL | GLSL (transpiled) | Godot Shading Language | GLSL (transpiled) |

**Key insight:** WebGPU closes the gap significantly. Three.js r171+ with WebGPU provides up to 10x improvement in draw-call-heavy scenarios compared to WebGL2. The automatic WebGL2 fallback ensures universal compatibility.

Sources:
- [Three.js WebGL vs WebGPU comparison](https://discourse.threejs.org/t/the-new-webgl-vs-webgpu-performance-comparison-example/69097)
- [WebGPU performance benchmarks](https://www.mayhemcode.com/2025/12/gpu-acceleration-in-browsers-webgpu.html)

### 1.2 Entity Count Targets at 60fps (Mid-Range Hardware)

| Approach | Achievable Entity Count | Notes |
|----------|------------------------|-------|
| Three.js InstancedMesh (WebGL2) | ~5,000-10,000 | Single draw call per mesh type, JS-driven transforms |
| Three.js InstancedMesh (WebGPU) | ~50,000-100,000 | GPU-driven transforms via compute shaders |
| Three.js + ECS (bitECS/miniplex) | ~10,000-50,000 | SoA layout, cache-friendly iteration |
| Unity DOTS/ECS | ~100,000-500,000 | Burst compiler + Jobs system, native code |
| Unity (traditional MonoBehaviour) | ~5,000-10,000 | GC pressure similar to JS |
| Godot MultiMesh | ~10,000-50,000 | GPU instancing, GDScript overhead for logic |

**For Geometry Wars:** The 10K entity target is comfortably achievable with Three.js InstancedMesh on WebGL2. With WebGPU compute shaders, the ceiling rises to 50-100K, providing significant headroom for particle effects, bullet hell scenarios, and multiplayer scaling.

Sources:
- [Three.js InstancedMesh performance](https://vrmeup.com/devlog/devlog_10_threejs_instancedmesh_performance_optimizations.html)
- [Three.js performance tips (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips)

### 1.3 Particle System Performance

| Platform | CPU-driven particles | GPU-driven particles | Compute shader particles |
|----------|---------------------|---------------------|-------------------------|
| Three.js WebGL2 | ~5,000 @ 60fps | ~50,000 (vertex shader) | N/A |
| Three.js WebGPU | ~5,000 (same JS) | ~50,000 | **1,000,000+ @ 60fps** |
| Unity (Shuriken/VFX Graph) | ~10,000 | ~100,000+ | ~1,000,000+ |
| Godot (GPUParticles3D) | ~5,000 | ~50,000+ | Limited |

**WebGPU compute shaders are a game-changer:** A WebGL particle system updating 10,000 particles takes ~30ms/frame on CPU. The same system on WebGPU compute shaders handles 100,000 particles in under 2ms --- a 150x improvement. On high-end hardware, WebGPU can push ~37M simple particles at 60fps vs WebGL's ~2.7M ceiling.

The project's current GPU particle system (5,000 particles) is well within WebGL2 limits. Migration to WebGPU compute would unlock order-of-magnitude improvements for bloom-heavy visual effects.

Sources:
- [WebGPU particle benchmarks](https://markaicode.com/webgpu-physics-simulation-1m-particles/)
- [Galaxy simulation with WebGPU compute](https://threejsroadmap.com/blog/galaxy-simulation-webgpu-compute-shaders)

### 1.4 Physics Engines

| Engine | Performance (relative) | WASM Support | 2D/3D | Notes |
|--------|----------------------|--------------|-------|-------|
| Rapier.js (Rust/WASM) | ~90% of PhysX CPU | Yes (native) | Both | Near PhysX performance, 5-8x faster than nphysics |
| Unity PhysX | Baseline (CPU) | N/A | Both | Industry standard, GPU acceleration available |
| Godot Physics | ~60-70% of PhysX | N/A | Both | Improved in 4.x, Jolt integration available |
| cannon-es (JS) | ~30% of PhysX | No | 3D | Pure JS, GC pressure |
| Ammo.js (Bullet/WASM) | ~70% of PhysX | Yes | Both | Bullet physics compiled to WASM |

**For Geometry Wars:** The game uses surface-constrained movement (geodesic face walking), not full 3D physics. Rapier.js would be overkill. The current custom collision system (bullet-enemy, player-enemy, player-geom) is simpler and more performant for this specific use case.

Sources:
- [Rapier physics engine benchmarks](https://dimforge.com/blog/2020/08/25/announcing-the-rapier-physics-engine/)
- [Rapier.js GitHub](https://github.com/dimforge/rapier.js)

### 1.5 Memory Management

| Platform | GC Type | GC Pause (typical) | Mitigation Strategies |
|----------|---------|--------------------|-----------------------|
| JavaScript (V8) | Generational, incremental | 1-5ms (minor), 10-50ms (major) | Object pooling, TypedArrays, avoid allocations in hot paths |
| C# (Unity) | Boehm (old) / Incremental (new) | 2-10ms (incremental), 50-200ms (full) | Object pooling, structs, NativeContainers |
| GDScript (Godot) | Reference counting + cycle collector | <1ms (ref counting), variable (cycles) | Less problematic for simple games |
| Rust/WASM (Rapier, custom) | None (manual/ownership) | 0ms | Compile-time memory safety |

**Key insight:** JavaScript GC is actually competitive with Unity's C# GC for game workloads. Both require object pooling for high-frequency allocations. The project already uses object pooling (BulletPool, GeomPool), which is the correct approach. Target is <1ms GC time per frame.

**WASM escape hatch:** Performance-critical systems can be written in Rust and compiled to WASM, getting zero-GC performance while remaining in the browser. This is a unique advantage of the web platform --- you can surgically optimize hot paths without leaving the ecosystem.

Sources:
- [JavaScript GC and object pooling for games](https://dev.to/patrocinioluisf/maximizing-memory-management-object-pooling-in-games-6bg)
- [Game optimization guide 2025](https://generalistprogrammer.com/tutorials/game-optimization-complete-performance-guide-2025)

### 1.6 Threading / Parallelism

| Platform | Threading Model | Shared Memory | Practical Use |
|----------|----------------|---------------|---------------|
| Browser (JS) | Web Workers + SharedArrayBuffer | Yes (with COOP/COEP headers) | Physics, AI, asset loading off main thread |
| Browser (WASM) | pthreads via SharedArrayBuffer | Yes | True multithreading in Rust/C++ compiled to WASM |
| Unity | C# Jobs + Burst compiler | Native shared memory | Highly optimized parallel ECS processing |
| Godot | Thread class + Mutex | Native shared memory | Less ergonomic than Unity Jobs |

**Web Workers provide real parallelism** but with higher communication overhead than native threads. SharedArrayBuffer enables zero-copy data sharing between workers. For Geometry Wars, offloading enemy AI pathfinding or collision detection to a worker would free the main thread for rendering.

WebAssembly 3.0 introduces true multithreading support, allowing parallel code across multiple CPU cores --- physics, AI pathfinding, and asset loading can all run in separate threads.

Sources:
- [WASM threads and SharedArrayBuffer](https://web.dev/articles/webassembly-threads)
- [WebAssembly 3.0 multithreading](https://markaicode.com/webassembly-rust-multithreading-browser-games/)

---

## 2. Graphics Capabilities

### 2.1 Shader Programming

| Feature | Three.js (TSL/GLSL) | Unity (ShaderLab/HLSL) | Godot (Shading Language) |
|---------|---------------------|----------------------|-------------------------|
| Node-based authoring | TSL (JS nodes, r166+) | Shader Graph (visual) | Visual Shader Editor |
| Code shaders | GLSL (WebGL2) / WGSL (WebGPU) | HLSL / Cg | Custom GLSL-like language |
| Cross-renderer | TSL compiles to GLSL and WGSL | Automatic per platform | Automatic per renderer |
| Type safety | TSL has JS type checking | ShaderLab has compile errors | Limited |
| IDE support | Full (TypeScript + TSL) | Visual Studio integration | GDScript LSP |
| Debugging | JS stack traces (TSL) | Frame debugger | Limited |
| Compute shaders | Yes (WebGPU) | Yes | Yes (Vulkan renderer) |

**TSL is a significant innovation:** Three.js Shading Language lets you write shaders as composable JavaScript nodes with full IDE autocomplete and type checking. When something fails, you get JavaScript stack traces pointing to the exact line --- not cryptic GPU compilation errors. TSL automatically compiles to both GLSL (WebGL2) and WGSL (WebGPU).

Sources:
- [TSL shader system](https://threejsroadmap.com/blog/tsl-a-better-way-to-write-shaders-in-threejs)
- [Field guide to TSL and WebGPU](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)

### 2.2 Post-Processing

| Effect | Three.js EffectComposer | Unity Post Processing | Godot Post-Processing |
|--------|------------------------|----------------------|----------------------|
| Bloom | UnrealBloomPass (threshold, strength, radius) | Bloom (same params + dirt mask) | WorldEnvironment glow |
| HDR | HalfFloatType buffers | Native HDR pipeline | HDR in Vulkan renderer |
| Tone mapping | ACESFilmic, Reinhard, Linear, Cineon | Same + custom curves | Limited presets |
| SSAO | SSAOPass | SSAO (built-in, high quality) | SSAO (Vulkan) |
| Motion blur | Custom (community) | Built-in | Custom |
| Depth of field | BokehPass | Built-in (multiple quality levels) | Custom |
| Custom passes | Easy (write JS class) | Moderate (C# + shader) | Moderate (shader) |
| Performance | Good (pmndrs/postprocessing library merges passes) | Excellent (optimized C++) | Good |

**For Geometry Wars:** The neon bloom aesthetic is the signature visual. Three.js UnrealBloomPass with threshold=0.85, strength=1.0 achieves the desired look. The pmndrs/postprocessing library offers an optimized alternative that merges multiple effects into a single pass, reducing overhead.

Unity's post-processing is more feature-rich out of the box, but for the specific effects needed (bloom + HDR tone mapping), Three.js is fully capable.

Sources:
- [Three.js post-processing](https://pmndrs.github.io/postprocessing/public/docs/)
- [EffectComposer docs](https://threejs.org/docs/pages/EffectComposer.html)

### 2.3 Geometry Wars Visual Requirements vs Capabilities

| Requirement | Three.js Capability | Sufficient? |
|-------------|-------------------|-------------|
| Neon glow (bloom) | UnrealBloomPass | Yes |
| Grid deformation | Custom spring physics on BufferGeometry | Yes (implemented) |
| Particle explosions | GPU particles (5000+) | Yes (implemented) |
| Surface rendering | Custom ShaderMaterial, FrontSide | Yes (10 surfaces) |
| Depth-based opacity | Custom shader uniform | Yes (implemented) |
| Chain lightning effects | Procedural line geometry | Yes (implemented) |
| Screen shake | Camera offset | Yes (implemented) |
| HDR tone mapping | ACESFilmicToneMapping | Yes |

All visual requirements for Geometry Wars are met by the current Three.js stack. No engine-specific features are missing.

---

## 3. Distribution Advantages

### 3.1 The Zero-Install Advantage

This is the single biggest advantage of the browser approach and it cannot be overstated for a multiplayer arcade game.

| Distribution Model | Browser (Three.js) | Unity Native | Godot Native | Unity WebGL Export | Godot Web Export |
|-------------------|-------------------|-------------|-------------|-------------------|-----------------|
| Time to play | **< 3 seconds** | 5-30 min download + install | 5-30 min download + install | 10-60 sec load | 10-60 sec load |
| Install required | **No** | Yes | Yes | No | No |
| Update mechanism | **Instant (server-side)** | Launcher/store update | Launcher/store update | Instant | Instant |
| Sharing | **URL link** | Store link + install | Store link + install | URL link | URL link |
| Cross-platform | **All browsers** | Per-platform build | Per-platform build | Browsers (limited) | Browsers (limited) |
| Mobile access | **PWA installable** | App store required | App store required | Browser only | Browser only |
| Initial download size | **< 5 MB** (code + assets stream) | 50-500 MB | 20-200 MB | **50-200 MB** | **30-80 MB** |
| Store fees | **0%** | 30% (App Store/Play Store) | 30% (App Store/Play Store) | 0% | 0% |

**Critical point about engine web exports:** Unity WebGL exports produce builds of 50-200 MB with a hard 2GB memory limit. Loading times are long and the experience is degraded. One developer noted that "Unity WebGL becomes more broken with every single release." Godot's web export is better (30-80 MB) but still significantly larger than a purpose-built Three.js application.

**For multiplayer games, the URL-sharing model is transformative.** A player can send a friend a link and they're playing together in seconds. Compare this to "Download Unity, install the game, create an account, find my lobby..." --- the friction difference is enormous.

Sources:
- [Unity WebGL technical limitations](https://docs.unity3d.com/6000.2/Documentation/Manual/webgl-technical-overview.html)
- [Unity WebGL memory](https://docs.unity3d.com/6000.3/Documentation/Manual/webgl-memory.html)
- [Unity WebGL criticism](https://medium.com/@andreas.zeitler/unity-webgl-becomes-more-broken-with-every-single-release-03f06b34ce77)

### 3.2 Market Context

The browser games market is projected at **$8 billion in 2025**, growing at 3.4-10.8% CAGR depending on the source. The instant games market (zero-install browser/social games) is expected to reach **$7.58 billion by 2032** at 13.6% CAGR.

Successful browser game precedents:
- **Agar.io**: 60M players, 2B YouTube views, $62K/month revenue
- **Slither.io**: Billions of plays, ad-monetized
- **Krunker.io**: Full 3D FPS in WebGL, competitive scene, millions of monthly users
- **Hordes.io**: 3D MMORPG running entirely in the browser

These prove that browser distribution can reach massive scale without app stores.

Sources:
- [Browser games market report](https://www.thebusinessresearchcompany.com/report/browser-games-global-market-report)
- [Instant games market](https://www.coherentmarketinsights.com/industry-reports/instant-games-market)
- [Browser games comeback](https://js13kgames.com/p/comeback-browser-games.html)

### 3.3 Multiplayer Integration

| Feature | Browser (Colyseus/WebSocket) | Unity Networking | Godot Networking |
|---------|------------------------------|-----------------|-----------------|
| Protocol | WebSocket / WebTransport | UNET/Netcode/Photon | ENet/WebSocket |
| Server language | JavaScript/TypeScript (same as client) | C# (separate project) | GDScript/C++ |
| Deployment | Any Node.js host, Colyseus Cloud | Dedicated server or relay service | Dedicated server |
| Scaling | 10-10,000+ CCU (Colyseus + Redis) | Varies by solution | Manual |
| LAN play | WebSocket (no port forwarding needed within LAN) | Native sockets | Native sockets |
| Cross-play | Built-in (it's a URL) | Complex (per-platform networking) | Complex |
| Latency | ~1-5ms overhead vs raw TCP | ~0.5-2ms overhead | ~1-3ms overhead |

**Colyseus** scales from 10 to 10,000+ CCU using Redis for horizontal scaling, with uWebSockets.js transport performing 10x faster than Socket.IO. The server is written in the same TypeScript as the client, sharing types and validation logic.

**WebTransport** (HTTP/3 + QUIC) is the next evolution: unreliable datagrams for game state (like UDP), reliable streams for critical data, and multiplexing --- all without the head-of-line blocking issues of WebSocket/TCP. Google Stadia used WebTransport + WebCodecs for their cloud gaming platform.

Sources:
- [Colyseus scalability](https://docs.colyseus.io/deployment/scalability)
- [Colyseus uWebSockets transport](https://docs.colyseus.io/server/transport/uwebsockets)
- [WebTransport specification](https://www.w3.org/TR/webtransport/)

---

## 4. Development Speed

### 4.1 Iteration Speed

| Metric | Vite + Three.js | Unity | Godot |
|--------|----------------|-------|-------|
| Cold start | **< 500ms** | 15-60 sec (editor load) | 5-15 sec (editor load) |
| HMR / Hot reload | **~47ms** | 2-10 sec (domain reload) | 1-3 sec (scene reload) |
| Build time (dev) | **0 ms** (native ESM, no bundling) | 10-60 sec | 5-30 sec |
| Build time (prod) | 5-15 sec (Vite/Rollup) | 1-30 min (platform-dependent) | 30 sec - 5 min |
| Test execution | **< 2 sec** (vitest, 688 tests) | 10-60 sec (Unity Test Runner) | 5-30 sec (GdUnit) |

**Vite's HMR is 47ms** --- change a file, see the result in under 50 milliseconds. Unity's domain reload takes 2-10 seconds minimum. Over a full development day with hundreds of iterations, this compounds into hours of saved time.

Vite achieves this by serving native ES modules directly to the browser without bundling, then using WebSocket to push only the changed module. Unity must recompile C# assemblies and reload the application domain.

Sources:
- [Vite HMR performance](https://vite.dev/guide/api-hmr)
- [Vite vs Webpack speed comparison](https://dev.to/saswatapal/why-i-chose-vite-over-webpack-10x-faster-builds-instant-hmr-8fp)

### 4.2 Testing Infrastructure

| Capability | Vitest + Playwright | Unity Test Framework | Godot (GdUnit4/GUT) |
|------------|--------------------|--------------------|---------------------|
| Unit tests | Vitest (near-instant) | NUnit-based (slow startup) | GdUnit4/GUT |
| Integration tests | Vitest (mocking, DI) | Play Mode tests | Scene tests |
| E2E / Visual | Playwright (real browser) | None built-in | None built-in |
| Watch mode | Yes (file-level granularity) | Manual re-run | Manual re-run |
| CI integration | Trivial (Node.js) | Requires Unity license in CI | Headless mode |
| Coverage | c8/istanbul (built-in) | dotCover (paid) or OpenCover | Limited |
| Parallelism | Yes (worker threads) | Sequential | Sequential |
| Community adoption | Massive (JS ecosystem) | Low (game dev culture) | Very low |

**The web testing ecosystem is decades ahead of game engine testing.** The project currently runs 688 vitest tests in under 2 seconds, with Playwright for E2E visual verification. Unity and Godot testing frameworks are functional but significantly less mature, slower, and harder to integrate into CI/CD pipelines.

"In the game development world, unit tests are almost non-existent, with most tutorials and open-source projects ignoring them." This is a cultural problem in engine-based development that the web ecosystem avoids.

Sources:
- [Vitest comparisons](https://vitest.dev/guide/comparisons)
- [Testing frameworks comparison 2026](https://dev.to/agent-tools-dev/choosing-a-typescript-testing-framework-jest-vs-vitest-vs-playwright-vs-cypress-2026-7j9)

### 4.3 Package Ecosystem

| Aspect | npm (Three.js) | Unity Package Manager | Godot Asset Library |
|--------|---------------|----------------------|-------------------|
| Total packages | **3.5M+** | ~10,000 (Asset Store) | ~2,000 |
| Quality variance | High (use popular ones) | Curated (paid = higher quality) | Community-maintained |
| Versioning | Semantic versioning | Version-locked | Manual |
| Dependency management | Automatic (package.json) | Manual (some auto) | Manual |
| Cost | Mostly free / MIT | Many paid ($5-$200+) | Mostly free |
| Math libraries | gl-matrix, three/math | Built-in | Built-in |
| Audio | Tone.js, Howler.js | Built-in FMOD/Wwise | Built-in |
| Networking | Colyseus, Socket.IO, Peer.js | Photon, Mirror, Netcode | ENet bindings |

---

## 5. Specific Advantages of the Browser Approach

### 5.1 Advantages Unique to Browser Games

1. **Zero-install distribution**: Click a URL, start playing. No download, no install, no app store approval. Critical for multiplayer games where you want friends to join instantly.

2. **Instant updates**: Push a deployment, all players get the new version on next page load. No update prompts, no version fragmentation.

3. **Universal cross-platform**: Works on Windows, Mac, Linux, ChromeOS, Android, iOS (via PWA) from a single codebase with zero platform-specific code.

4. **Web services integration**: Auth (OAuth, social login), payments (Stripe, no 30% store cut), analytics, social sharing, deep linking --- all native to the web platform.

5. **SEO and discoverability**: Browser games can be indexed by search engines, linked from social media with Open Graph previews, and embedded in iframes on game portals.

6. **PWA capabilities**: Offline play via Service Workers, home screen installation, push notifications, background sync --- approaching native app functionality.

7. **Full-stack TypeScript**: Client, server (Colyseus), build tools (Vite), and tests (Vitest) all in one language. Shared types, shared validation, shared utility code.

8. **Open source everything**: Three.js (MIT), Vite (MIT), Vitest (MIT), Colyseus (MIT), TypeScript (Apache). No licensing fees, no runtime fees, no revenue sharing. Complete auditability.

9. **WASM escape hatch**: Performance-critical code can be written in Rust/C++ and compiled to WebAssembly, running at near-native speed within the browser. You're never fully locked into JavaScript performance limits.

10. **Developer tooling**: Chrome DevTools, VS Code, extensive linting/formatting ecosystem. The web development toolchain is the most mature in software engineering.

### 5.2 LAN Multiplayer Without Port Forwarding

For the planned "Open to LAN" feature, the browser approach has a subtle advantage: WebSocket connections within a LAN work without any port forwarding configuration because the Colyseus server runs on the host machine and other devices connect via the local IP. No NAT traversal complexity, no UPnP requirements. Players just enter a URL.

---

## 6. Where Engines Win

### 6.1 Unity Advantages

| Area | Why Unity Wins | Impact on Geometry Wars |
|------|---------------|------------------------|
| Complex 3D scenes | Occlusion culling, LOD, lightmapping, baked GI | **Low** --- stylized neon art, no complex scenes |
| Visual editor | Scene editor, Inspector, Prefab system | **Medium** --- level design is data-driven anyway |
| Physics | PhysX with GPU acceleration | **Low** --- game uses surface-constrained movement |
| Animation | Mecanim, Timeline, Cinemachine | **Low** --- simple procedural animations |
| Asset pipeline | FBX import, texture compression, audio processing | **Low** --- procedural geometry, synth audio |
| Console deployment | PS5, Xbox, Switch | **Medium** --- not a current requirement |
| VR/AR | XR Interaction Toolkit | **Low** --- not planned |
| Asset Store | 10,000+ assets, plugins, tools | **Low** --- custom everything |
| DOTS/ECS | 100K+ entities at 60fps | **Low** --- 10K target is achievable in browser |

### 6.2 Godot Advantages

| Area | Why Godot Wins | Impact on Geometry Wars |
|------|---------------|------------------------|
| Scene system | Node-based scene tree, intuitive composition | **Medium** --- useful but not critical |
| 2D dedicated renderer | Purpose-built 2D pipeline | **None** --- game is 3D |
| GDScript simplicity | Low learning curve, fast prototyping | **Low** --- TypeScript is comparable |
| Open source engine | Full engine source, modify anything | **Medium** --- but Three.js is also fully open |
| Lightweight | Small editor, fast startup | **Low** --- Vite is even lighter |
| Cost | Completely free, no strings | **None** --- Three.js is also free |

### 6.3 Honest Assessment: When to Choose an Engine

Choose Unity/Godot over browser when:
- Building a graphically complex 3D game (AAA visuals, large open worlds)
- Targeting consoles (PS5, Xbox, Switch)
- Need built-in animation systems (skeletal, blend trees, state machines)
- Require complex physics (ragdoll, cloth, fluid simulation)
- Your team is more comfortable with C#/GDScript than TypeScript
- You need a visual level editor (though web-based editors can be built)

**None of these apply to Geometry Wars.** The game has stylized neon vector graphics, surface-constrained movement (custom physics), procedural audio, and multiplayer as a core feature --- all areas where the browser approach matches or exceeds engine capabilities.

---

## 7. Performance Limits: Real-World Browser Game Benchmarks

### 7.1 Proven Browser Game Performance

| Game | Technology | Entity Scale | Visual Complexity | Players |
|------|-----------|-------------|-------------------|---------|
| Krunker.io | Custom WebGL | ~100 players + projectiles | Full 3D FPS with maps | Millions monthly |
| Hordes.io | Custom WebGL | Hundreds of entities | 3D MMORPG | Thousands concurrent |
| Agar.io | Canvas 2D | ~1000 cells | Simple circles | 60M total players |
| Slither.io | Canvas 2D | ~10,000 segments | Simple 2D | Billions of plays |
| Diep.io | Canvas 2D | Hundreds of entities + bullets | Simple 2D shapes | Millions of players |
| Zombs Royale | Pixi.js (WebGL) | ~100 players + thousands of objects | 2D battle royale | Millions of players |

### 7.2 WebGPU Performance Ceiling (2026)

| Workload | WebGL2 Limit | WebGPU Limit | Improvement |
|----------|-------------|-------------|-------------|
| Simple particles | ~2.7M @ 60fps | ~37M @ 60fps | **13.7x** |
| Complex particles (physics) | ~10K @ 60fps | ~1M @ 60fps | **100x** |
| Draw calls | ~300 comfortable | ~1000+ comfortable | **3-5x** |
| Compute (general) | N/A | GPU compute shaders | **New capability** |
| Instanced rendering | 100K instances | 500K+ instances | **5x** |

### 7.3 Geometry Wars Target Assessment

| System | Current Count | Target | Browser Feasible? | Headroom |
|--------|-------------|--------|-------------------|----------|
| Enemies (active) | 15 types | ~200 simultaneous | Yes (InstancedMesh) | 50x+ |
| Bullets (pool) | BulletPool | ~1000 active | Yes (InstancedMesh) | 10x+ |
| Particles | 5000 GPU | 10,000 | Yes (WebGL2), massive (WebGPU) | 2x (WebGL2), 200x (WebGPU) |
| Geoms | GeomPool | ~500 active | Yes | 20x+ |
| Grid vertices | Spring mesh | ~10,000 | Yes (BufferGeometry) | Comfortable |
| **Total entities** | -- | **~10,000** | **Yes** | **Comfortable on WebGL2** |

Sources:
- [WebGPU benchmarks and browser support](https://byteiota.com/webgpu-2026-70-browser-support-15x-performance-gains/)
- [Game optimization guide 2025](https://generalistprogrammer.com/tutorials/game-optimization-complete-performance-guide-2025)

---

## 8. Future Trajectory

### 8.1 WebGPU Adoption Timeline

| Milestone | Date | Status |
|-----------|------|--------|
| Chrome ships WebGPU | April 2023 | Done |
| Edge ships WebGPU | 2023 | Done |
| Three.js r171 (production WebGPU) | September 2025 | Done |
| Firefox 141 ships WebGPU (Windows) | Late 2025 | Done |
| Safari 26 ships WebGPU (macOS, iOS, visionOS) | Late 2025 | Done |
| **All major browsers support WebGPU** | **January 2026** | **Done** |
| Firefox Linux support | 2026 (expected) | In progress |
| ~70% global browser coverage | 2026 | Current |
| WebGPU 2.0 specification | 2026-2027 | In development |

**WebGPU is production-ready now.** The 15-year WebGL era has ended. Three.js r171+ provides seamless WebGPU rendering with automatic WebGL2 fallback. This means the project can adopt WebGPU features incrementally while maintaining universal compatibility.

Sources:
- [WebGPU all browsers support](https://web.dev/blog/webgpu-supported-major-browsers)
- [WebGPU implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)

### 8.2 WebAssembly Improvements

| Feature | Status (2026) | Impact |
|---------|--------------|--------|
| WASM SIMD | Shipped (all browsers) | 2-4x speedups for math-heavy code |
| WASM Threads | Shipped (SharedArrayBuffer) | True multithreading |
| WASM GC | Shipped (Chrome, Firefox) | Better integration with managed languages |
| WASM Exception Handling | Shipped | Proper try/catch in WASM |
| WASM Component Model | In development | Better module composition |
| WASM 3.0 | Specification phase | Full threading, improved performance |

### 8.3 Browser API Roadmap

| API | Purpose | Game Development Impact |
|-----|---------|----------------------|
| WebTransport | HTTP/3 + QUIC transport | Low-latency multiplayer with unreliable datagrams (UDP-like) |
| WebCodecs | Low-level video/audio encoding | Cloud gaming, replay systems |
| WebXR | VR/AR in browser | Browser-based VR games without app install |
| Web Audio API | Advanced audio processing | Already used (SoundEngine synth) |
| Gamepad API | Controller support | Already used (InputManager) |
| Screen Wake Lock | Prevent screen sleep during gameplay | Better mobile gaming experience |
| File System Access | Read/write local files | Save games, custom content |

### 8.4 Three.js Roadmap

Three.js in 2026 is defined by three shifts:
1. **WebGPU becoming production-ready** across all browsers
2. **TSL (Three.js Shading Language)** as the primary shader authoring approach
3. **AI-assisted development** lowering the barrier to entry

The library is expanding beyond websites into physical installations, AR experiences, and immersive environments --- all running on web technology.

Sources:
- [What changed in Three.js 2026](https://www.utsubo.com/blog/threejs-2026-what-changed)
- [WebGPU + WASM deep dive](https://faithforgelabs.com/blog_webgpu_wasm.php)

---

## 9. Pros/Cons Summary Table

### Browser (Three.js + TypeScript + Vite)

| Pros | Cons |
|------|------|
| Zero-install distribution (URL sharing) | No visual scene editor (code-driven) |
| 47ms HMR iteration speed | Manual asset pipeline |
| Full-stack TypeScript (client + server) | No built-in physics engine (use Rapier.js or custom) |
| 688 tests in < 2 sec (vitest) | GC pauses require object pooling discipline |
| WebGPU: 1M+ particles, compute shaders | WebGL2 fallback has lower ceiling |
| Colyseus multiplayer (same language) | No console deployment |
| 0% store fees, MIT licensed | Smaller game dev community (vs Unity) |
| PWA for mobile (no app store) | No built-in animation state machine |
| npm: 3.5M+ packages | Must build tooling yourself |
| WASM escape hatch for hot paths | Audio API less mature than FMOD/Wwise |
| Playwright E2E testing | No profiler as good as Unity's |

### Unity

| Pros | Cons |
|------|------|
| Most mature game engine ecosystem | WebGL export: 50-200MB, 2GB memory limit |
| Visual editor, scene graph, Inspector | 30% app store fees |
| DOTS/ECS: 100K+ entities | C# GC pauses (similar to JS) |
| Multi-platform (console, mobile, PC, VR) | Licensing concerns (runtime fee controversy) |
| Asset Store with 10K+ assets | 2-10 sec hot reload (vs 47ms) |
| Built-in physics (PhysX) | WebGL export "broken with every release" |
| Professional profiling tools | Closed source engine |
| Large developer community | Requires Unity license for CI testing |

### Godot

| Pros | Cons |
|------|------|
| Fully open source (MIT) | Smaller ecosystem than Unity |
| Lightweight editor | Web export: 30-80MB |
| Good 2D pipeline | 3D capabilities behind Unity |
| No licensing fees ever | C# web export not supported |
| Growing community rapidly | Asset library is small (~2,000) |
| GDScript is easy to learn | Testing culture is minimal |
| Scene-based architecture | Mobile browser performance issues |
| Web export improving | Documentation gaps for advanced features |

---

## 10. Conclusion and Recommendation

### For Geometry Wars 3D Dimensions Specifically

The browser-based approach using Three.js + TypeScript + Vite + Colyseus is **the optimal choice** for this project. Here's why:

1. **Distribution model matches the game type.** Geometry Wars is a fast-paced arcade game where you want friends to join instantly. "Click this link to play" beats "Download this 200MB installer" every time. For multiplayer, this is not a nice-to-have --- it's a competitive advantage.

2. **Visual requirements are met.** Neon bloom, grid deformation, particles, depth-based effects --- all implemented and working. The game doesn't need photorealistic rendering, complex lighting, or large open worlds.

3. **Performance targets are achievable.** 10K entities at 60fps is comfortable on WebGL2 with InstancedMesh and object pooling. WebGPU provides 10-100x headroom for future expansion.

4. **Multiplayer is a first-class citizen.** Colyseus running on the same TypeScript stack as the client, with WebSocket (and future WebTransport) for low-latency communication, is simpler and more maintainable than any engine networking solution.

5. **Development velocity is superior.** 47ms HMR, 688 tests in < 2 sec, full TypeScript type safety across client and server, npm ecosystem with 3.5M packages. The iteration speed advantage compounds over months of development.

6. **Future-proof.** WebGPU is now in all major browsers. The performance ceiling is rising rapidly. WASM provides an escape hatch for any computation that needs native speed.

### When to Reconsider

If the project scope changes to include:
- Console deployment (PS5/Xbox/Switch) --- then Unity becomes necessary
- Photorealistic 3D graphics --- then Unity or Unreal would be better
- Complex physics simulation (ragdoll, cloth, destruction) --- then a built-in physics engine helps
- VR as a primary platform --- then Unity XR Toolkit has more maturity (though WebXR exists)

None of these are in the current or planned scope.

### Strategic Recommendation

Continue with the browser approach. The decision is validated by:
- Market precedent (Krunker.io, Hordes.io, Agar.io proving browser games at scale)
- Technology trajectory (WebGPU closing the performance gap)
- Distribution advantage (zero-install for multiplayer is decisive)
- Development efficiency (fastest iteration cycle of any game development approach)
- Total cost of ownership (zero licensing fees, zero store fees)

---

## Sources

### WebGPU and Performance
- [Three.js WebGL vs WebGPU comparison](https://discourse.threejs.org/t/the-new-webgl-vs-webgpu-performance-comparison-example/69097)
- [WebGL vs WebGPU Explained - Three.js Roadmap](https://threejsroadmap.com/blog/webgl-vs-webgpu-explained)
- [WebGPU Performance Benchmarks](https://www.mayhemcode.com/2025/12/gpu-acceleration-in-browsers-webgpu.html)
- [WebGPU 2026: 70% Browser Support](https://byteiota.com/webgpu-2026-70-browser-support-15x-performance-gains/)
- [WebGPU all major browsers](https://web.dev/blog/webgpu-supported-major-browsers)
- [WebGPU Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
- [WebGPU + WASM Deep Dive](https://faithforgelabs.com/blog_webgpu_wasm.php)
- [What Changed in Three.js 2026](https://www.utsubo.com/blog/threejs-2026-what-changed)

### Three.js Specific
- [Three.js InstancedMesh Performance](https://vrmeup.com/devlog/devlog_10_threejs_instancedmesh_performance_optimizations.html)
- [100 Three.js Performance Tips (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- [TSL Shader System](https://threejsroadmap.com/blog/tsl-a-better-way-to-write-shaders-in-threejs)
- [Field Guide to TSL and WebGPU](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)
- [Galaxy Simulation with WebGPU Compute](https://threejsroadmap.com/blog/galaxy-simulation-webgpu-compute-shaders)
- [WebGPU 1M Particles](https://markaicode.com/webgpu-physics-simulation-1m-particles/)
- [Three.js Post-Processing](https://pmndrs.github.io/postprocessing/public/docs/)

### Unity Web Export
- [Unity Web Performance Considerations](https://docs.unity3d.com/6000.3/Documentation/Manual/webgl-performance.html)
- [Unity WebGL Technical Limitations](https://docs.unity3d.com/6000.2/Documentation/Manual/webgl-technical-overview.html)
- [Unity WebGL Memory](https://docs.unity3d.com/6000.3/Documentation/Manual/webgl-memory.html)
- [Unity WebGL Criticism](https://medium.com/@andreas.zeitler/unity-webgl-becomes-more-broken-with-every-single-release-03f06b34ce77)
- [Unity WebGL Performance Tips](https://friendzy.xyz/2025/09/17/unity-webgl-performance-tips/)

### Godot Web Export
- [Godot Browser Games 2025](https://playgama.com/blog/general/master-godot-build-immersive-browser-games-with-ease/)
- [Godot vs Unity 2026](https://rocketbrush.com/blog/godot-vs-unity)
- [Game Engine Showdown 2025](https://itch.io/blog/1067028/game-engine-showdown-2025-unity-vs-godot-vs-unreal-which-should-you-choose)

### Physics and Memory
- [Rapier Physics Engine](https://dimforge.com/blog/2020/08/25/announcing-the-rapier-physics-engine/)
- [Rapier.js GitHub](https://github.com/dimforge/rapier.js)
- [Object Pooling for Games](https://dev.to/patrocinioluisf/maximizing-memory-management-object-pooling-in-games-6bg)
- [Game Optimization Guide 2025](https://generalistprogrammer.com/tutorials/game-optimization-complete-performance-guide-2025)

### Threading and WASM
- [WASM Threads](https://web.dev/articles/webassembly-threads)
- [WebAssembly 3.0 Multithreading](https://markaicode.com/webassembly-rust-multithreading-browser-games/)

### Distribution and Market
- [Browser Games Market Report](https://www.thebusinessresearchcompany.com/report/browser-games-global-market-report)
- [Instant Games Market](https://www.coherentmarketinsights.com/industry-reports/instant-games-market)
- [Browser Games Comeback](https://js13kgames.com/p/comeback-browser-games.html)
- [PWAs in 2025](https://dev.to/arkhan/are-progressive-web-apps-still-worth-it-in-2025-a-practical-perspective-47g8)

### Multiplayer
- [Colyseus Scalability](https://docs.colyseus.io/deployment/scalability)
- [Colyseus uWebSockets](https://docs.colyseus.io/server/transport/uwebsockets)
- [WebTransport Specification](https://www.w3.org/TR/webtransport/)

### Development Speed and Testing
- [Vite HMR](https://vite.dev/guide/api-hmr)
- [Vitest Comparisons](https://vitest.dev/guide/comparisons)
- [Testing Frameworks 2026](https://dev.to/agent-tools-dev/choosing-a-typescript-testing-framework-jest-vs-vitest-vs-playwright-vs-cypress-2026-7j9)
