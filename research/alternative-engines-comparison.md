# Browser 3D Game Engine Comparison for Geometry Wars 3D

**Date:** 2026-02-12
**Purpose:** Comprehensive evaluation of browser-capable 3D engines as alternatives to the current Three.js setup
**Context:** Geometry Wars-style arcade shooter — neon glow, 10K+ entities, mobile+desktop, multiplayer, arbitrary mesh surfaces

---

## Quick Comparison Matrix

| Feature | Three.js (current) | Babylon.js | PlayCanvas | Godot Web | Cocos Creator | Wonderland | Unity WebGL | Unreal (Pixel Stream) |
|---|---|---|---|---|---|---|---|---|
| **Bundle Size (gzip)** | ~168 KB | ~1.4 MB (full) / ~500 KB (tree-shaken) | ~300 KB | ~5 MB (Brotli) / ~40 MB (raw WASM) | ~200-400 KB (JS runtime) | ~150 KB (WASM) | 10-50+ MB | N/A (server-rendered) |
| **WebGPU Support** | Production (r171+) | Production (v5.0+, WGSL in v8.0) | Production | No (WebGL 2 only) | Yes | WebGL 2 only | No | N/A |
| **Built-in Physics** | No (use Rapier/Cannon) | Yes (Havok, free MIT) | Yes (ammo.js) | Yes (Godot Physics/Jolt) | Yes (Bullet/box2d) | Yes (PhysX WASM) | Yes (PhysX) | Yes (Chaos) |
| **Built-in NavMesh** | No (use recast-navigation-js) | Yes (Recast V2 plugin) | No (community) | Yes (built-in) | Yes (built-in) | No | Yes (built-in) | Yes (built-in) |
| **Networking** | No (use Colyseus) | No (use Colyseus) | No (use Colyseus/socket.io) | Yes (built-in ENet) | No (use socket.io) | No | Yes (Netcode) | Yes (built-in) |
| **10K+ Entities** | Yes (InstancedMesh) | Yes (SPS, thin instances) | Yes (instancing) | Questionable in browser | Yes (instancing) | Yes (WASM ECS) | Poor in browser | Yes (server-side) |
| **Glow/Bloom** | Good (UnrealBloomPass) | Excellent (GlowLayer + BloomEffect) | Good (built-in pipeline) | Good (WorldEnvironment) | Good (built-in pipeline) | Limited | Excellent | Excellent |
| **Mobile Browser** | Good | Good | Excellent (optimized) | BROKEN on iOS | Good | Good (WebXR focus) | Poor (heavy) | Poor (latency) |
| **Claude Code Friendly** | Excellent | Excellent | Good (code-only mode) | Poor (GDScript/editor) | Poor (editor-dependent) | Medium | Poor (C#/editor) | Poor (C++/editor) |
| **GitHub Stars** | 110K+ | 25K | 9.7K | 95K+ (but not web-focused) | 8K | 1K | N/A | N/A |
| **NPM Weekly DL** | ~4.3M | ~13K | ~3.3K | N/A | N/A | N/A | N/A | N/A |
| **Surface Walking** | Custom (current UV system) | Raycasting + NavMesh | Raycasting + physics | Physics + navmesh | Physics + navmesh | Physics | Physics + navmesh | Physics + navmesh |
| **License** | MIT | Apache 2.0 | MIT | MIT | MIT (engine 4.0+) | Proprietary (free tier) | Proprietary ($$$) | Proprietary ($$$) |

**Recommendation:** Stay with Three.js. Babylon.js is the only credible alternative but the migration cost is not justified.

---

## 1. Three.js (Current Engine)

### Current State in Geometry Wars 3D
- Custom UV-based surface system for walking on arbitrary 3D meshes (sphere, torus, Mobius strip, etc.)
- EffectComposer + UnrealBloomPass for neon glow
- InstancedMesh for 10K+ enemy/bullet rendering (1 draw call per type)
- WebGPU with WebGL2 fallback (implemented Feb 2026)
- ~170 source files, 1270+ tests, mature codebase

### Three.js Ecosystem Health (2026)
- **110,718 GitHub stars** — largest web 3D library by far
- **~4.3 million weekly NPM downloads** — 300x more than Babylon.js or PlayCanvas
- **14+ years** of continuous development (since 2010)
- **r182** latest version (Feb 2026)
- **No corporate dependency** — community-driven (mrdoob + contributors)
- **WebGPU production-ready** since r171 (Sep 2025): `import { WebGPURenderer } from 'three/webgpu'`
- Full WebGPU browser support achieved Jan 2026 (Firefox 147 was last holdout)

Sources: [Three.js GitHub](https://github.com/mrdoob/three.js), [NPM](https://www.npmjs.com/package/three), [What Changed in Three.js 2026](https://www.utsubo.com/blog/threejs-2026-what-changed)

### What Would Need to Change (if staying with Three.js)

**Option A: Keep current UV surface system**
- Pros: Already working, 12 surfaces implemented, 1270+ tests
- Cons: Complex math, hard to add new surfaces, UV discontinuities near seams
- Verdict: The "devil you know" — it works despite complexity

**Option B: Replace UV system with NavMesh-based surface walking**
- Use `recast-navigation-js` (WebAssembly port of Recast Navigation)
- Generate navmesh from any GLB/OBJ mesh at load time
- Player walks on navmesh faces, projected onto mesh surface
- Pros: Industry-standard approach, works with ANY mesh without custom math
- Cons: 3-6 week migration, navmesh doesn't wrap around surfaces the same way (designed for floors, not spheres)
- Critical issue: Recast navmeshes are designed for "floor-based" navigation. Walking on a sphere or Mobius strip isn't a standard navmesh use case.

**Option C: Replace UV system with physics-based surface walking**
- Use Rapier.js (already in project) for convex hull collision
- Player has a physics body that slides along mesh surface via gravity + constraints
- Pros: More physically realistic, handles arbitrary geometry
- Cons: Hard to get the "arcade feel" right, physics jitter on curved surfaces
- Critical issue: Geometry Wars needs precise, deterministic movement — physics adds unpredictability

Sources: [recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js), [@recast-navigation/three](https://www.npmjs.com/package/@recast-navigation/three)

### Three.js + React Three Fiber (R3F)

**Would R3F help this project?**

R3F is a React renderer for Three.js that enables declarative 3D scene construction. It has grown significantly:
- 28K+ GitHub stars
- Pairs with React 19 (fiber@9)
- Rich ecosystem: `drei` (helpers), `rapier` (physics), `postprocessing`
- "Vibe coding" with AI works well with R3F's declarative API

**For Geometry Wars specifically: NO.**
- R3F adds React's reconciler overhead — bad for 10K+ entities at 60fps
- The game is imperative by nature (game loop, direct matrix updates, InstancedMesh manipulation)
- React's scheduling helps with UI, not with frame-budget-critical game loops
- Would require rewriting ~170 source files
- R3F shines for interactive 3D websites, product configurators, data visualization — not arcade shooters

**Where R3F would help:** If we ever build a level editor, settings UI, or lobby system, R3F + drei would be excellent for those non-performance-critical parts.

Sources: [React Three Fiber GitHub](https://github.com/pmndrs/react-three-fiber), [R3F vs Three.js 2026](https://graffersid.com/react-three-fiber-vs-three-js/)

---

## 2. Babylon.js

### Overview
Babylon.js is the most feature-complete browser 3D engine, backed by Microsoft. Version 8.0 (March 2025) is the current major release. It positions itself as a "game engine in the browser" with batteries included.

### Surface Walking
- **Built-in character controller** (Havok-powered, added in v8.0) — handles character-centered games with a few lines of code
- **Navigation Mesh V2** — built on `recast-navigation-js`, generates navmesh from any mesh, supports crowd agents with avoidance
- **Raycasting** — mature raycasting system for projecting onto arbitrary meshes
- **Limitation:** Same fundamental problem as Three.js for sphere/Mobius walking — navmesh is designed for floors. Custom math would still be needed for Geometry Wars' surface types.

### Physics
- **Havok Physics** (free, MIT license) — WebAssembly, 20x faster than ammo.js
- Benchmark: 3000 physics entities at 60fps in single thread
- Character controller built on Havok — collisions, slopes, steps all handled
- **This is a genuine advantage over Three.js** where physics must be assembled from separate libraries

### Networking
- No built-in networking — same situation as Three.js
- Colyseus integrates cleanly (official Babylon.js tutorial exists)
- Would reuse existing Colyseus server code

### Mobile Performance
- Good WebGL 2 performance on modern phones
- WebGPU now universal (iOS 26+, Firefox 147+)
- Particle systems and post-processing have mobile-friendly fallbacks
- Community reports good performance on mid-range Android devices

### Glow/Neon Effects
- **GlowLayer**: Emissive-based glow, per-object control, configurable blur kernel and intensity
- **BloomEffect**: Post-processing bloom in DefaultRenderingPipeline
- **Node Render Graph** (v8.0): Full control over render pipeline — could create custom multi-pass neon effects
- **Quality: Excellent** — arguably better built-in glow support than Three.js (which requires EffectComposer assembly)

### Entity Count (10K+)
- **Thin Instances**: Like Three.js InstancedMesh but with less overhead — direct buffer manipulation
- **Solid Particle System (SPS)**: Manages tens of thousands of particles with per-particle control, single draw call
- **GPU Particles**: Compute-shader-based particle system for WebGPU
- Comparable to Three.js for high entity counts

### Bundle Size
- **Full library: ~1.4 MB** (minified)
- **Tree-shaken: ~500 KB - 1 MB** (depends on features used)
- **With ES6 deep imports: ~300-500 KB** possible but requires careful import management
- **Comparison:** 3-8x larger than Three.js (~168 KB) — significant for mobile "instant play"
- Community reports: Even with aggressive tree-shaking, Babylon.js bundles often end up 2-5 MB with Vite/Webpack

### Learning Curve
- Steeper initial setup but less assembly required
- Excellent documentation (playground, docs, forum)
- TypeScript-first (like our project)
- More "opinionated" — less flexibility but faster development for standard use cases

### Community
- **25,069 GitHub stars**
- **~13K weekly NPM downloads** (tiny compared to Three.js)
- Active forum with responsive core team (Microsoft employees)
- Microsoft backing is a double-edged sword: stable funding but corporate dependency risk

### Claude Code Compatibility
- **Excellent** — TypeScript, well-documented API, lots of training data
- Similar to Three.js in terms of AI code generation quality
- Slightly less online content to learn from (smaller community)

### Notable Games/Projects
- Minecraft Classic (web version, though now sunset)
- Frame VR (social VR platform)
- Various itch.io games: Maiu Online, Primal Olympics, VoxelSrv
- Strong in enterprise/visualization (car configurators, architectural viz)
- **Weak in commercial game production** compared to native engines

### Migration Cost Assessment
- **Estimated effort: 4-8 weeks** for full migration
- Every Three.js API call would need rewriting (different scene graph API)
- InstancedMesh -> Thin Instances (conceptually similar but different API)
- EffectComposer -> DefaultRenderingPipeline (different post-processing model)
- Custom surface UV system would need complete rewrite regardless
- **Risk: High** — current codebase is battle-tested with 1270+ tests

Sources: [Babylon.js Official](https://www.babylonjs.com/), [Babylon.js 8.0](https://babylonjs.medium.com/introducing-babylon-js-8-0-77644b31e2f9), [Havok Plugin](https://doc.babylonjs.com/features/featuresDeepDive/physics/havokPlugin), [Nav Plugin V2](https://forum.babylonjs.com/t/navigation-plugin-v2-is-here/60751), [GlowLayer Docs](https://doc.babylonjs.com/features/featuresDeepDive/mesh/glowLayer), [Bundle Size Discussion](https://forum.babylonjs.com/t/babylon-bundle-size/48068)

---

## 3. PlayCanvas

### Overview
PlayCanvas is a web-first 3D engine with a cloud-based collaborative editor (like Figma for 3D). Backed by Snap Inc. The engine is open-source (MIT); the editor is proprietary (cloud SaaS). Can be used code-only via NPM.

### Surface Walking
- Standard physics-based character controllers
- No built-in navmesh (community solutions available)
- Raycasting available for mesh surface projection
- **Same limitation as others** for arbitrary surface walking (spheres, Mobius strips)

### Physics
- Built-in ammo.js integration (Bullet physics via WASM)
- Less performant than Babylon.js Havok but adequate
- No Havok integration

### Networking
- No built-in authoritative networking
- **Official Colyseus tutorial exists** on PlayCanvas developer site
- Has been used for multiplayer games (Mini Royale: Nations, Robostorm, Fields of Fury)

### Mobile Performance
- **This is PlayCanvas's strongest selling point** — optimized for mobile from the ground up
- Shuffle Cats Mini: 60fps on low-end mobile devices
- Script concatenation, minification, deferred loading built-in
- Runs well on iPhone 6 and Chromebooks (per official claims)
- Clustered lighting for efficient dynamic lights

### Glow/Neon Effects
- Built-in post-processing pipeline with bloom
- Less flexibility than Babylon.js Node Render Graph
- Adequate for neon effects but not as refined as Three.js UnrealBloomPass

### Entity Count (10K+)
- Hardware instancing supported
- Less documentation on extreme entity counts compared to Three.js/Babylon.js
- Likely adequate but less proven at 10K+ scale

### Bundle Size
- **~300 KB** (engine runtime, gzipped)
- Reasonable — between Three.js (168 KB) and Babylon.js (1.4 MB)
- Cloud editor builds are optimized automatically

### Learning Curve
- **With editor:** Low barrier, visual drag-and-drop
- **Code-only:** Medium — good TypeScript support, NPM package available, but fewer code-only tutorials
- Documentation focuses on editor workflow; standalone engine docs are thinner

### Community
- **9,725 GitHub stars**
- **~3,319 weekly NPM downloads** (very small)
- Smaller community than Three.js or Babylon.js
- Snap backing provides stability but narrower focus

### Claude Code Compatibility
- **Good in code-only mode** — TypeScript, NPM, standard module system
- **Poor with editor** — the cloud editor is a GUI tool, not text-based
- Less training data available compared to Three.js
- Fewer online examples and tutorials for code-only approach

### Notable Games
- **Mini Royale: Nations** — browser FPS + social strategy (most impressive PlayCanvas game)
- **Robostorm** — multiplayer robot battles (<7 MB, desktop only)
- **Fields of Fury** — WW2 FPS capture-the-flag
- **Tanx** — multiplayer tank game
- **Swooop** — casual flying game
- Stronger game portfolio than Babylon.js

### Migration Cost Assessment
- **Estimated effort: 6-10 weeks** — less mature code-only workflow means more friction
- Entity component system is different from Three.js scene graph
- Post-processing pipeline differences
- Smaller community = less help when stuck
- **Risk: High** — less proven for our specific use case (arcade shooter on arbitrary surfaces)

Sources: [PlayCanvas Engine GitHub](https://github.com/playcanvas/engine), [PlayCanvas Games](https://playcanvas.com/industries/games), [PlayCanvas + Colyseus](https://developer.playcanvas.com/tutorials/real-time-multiplayer-colyseus/), [Standalone Engine Docs](https://developer.playcanvas.com/user-manual/engine/standalone/)

---

## 4. Godot Web Export

### Overview
Godot is a popular open-source game engine (95K+ GitHub stars) with a mature editor, GDScript language, and optional C# support. Web export compiles to WebAssembly + WebGL 2.

### Surface Walking
- Built-in CharacterBody3D with physics-based movement
- Built-in NavigationServer3D with navmesh generation
- Godot's physics system handles arbitrary mesh collision well
- **Best built-in surface walking of any option** — but only in native, not optimized for web

### Physics
- Godot Physics (built-in) or Jolt Physics (plugin, faster)
- Good for character controllers, collisions, raycasting
- All runs in WASM when exported to web

### Networking
- Built-in multiplayer API (ENet-based, with high-level multiplayer nodes)
- `@rpc` annotation for remote procedure calls
- **But:** Web export networking has limitations (WebSocket transport required, not raw UDP)

### Mobile Performance
- **CRITICAL ISSUE: iOS Safari is BROKEN**
  - Games fail to load on iPhone browsers (indefinite loading wheel)
  - Audio causes crashes/reloads on iOS Chrome and Safari after 1-3 minutes (Godot 4.5 dev5)
  - SharedArrayBuffer and WebGL 2.0 upstream bugs on Apple devices
  - Android works but with noticeable performance degradation vs native
- Godot recommends native iOS export instead of web
- **This is a dealbreaker** for "pull out your phone, scan QR code, play instantly"

### Glow/Neon Effects
- WorldEnvironment node with glow/bloom settings
- Good quality — Godot's rendering pipeline is mature
- Less control than Three.js/Babylon.js for custom post-processing in web export

### Entity Count (10K+)
- MultiMeshInstance3D for instanced rendering (equivalent to InstancedMesh)
- Performance in web export is significantly worse than native Godot
- Users report stuttering and lower FPS in browser vs desktop builds
- **Questionable at 10K+ in browser**

### Bundle Size
- **~5 MB compressed (Brotli)**, ~40 MB uncompressed WASM
- **This is enormous** compared to Three.js (168 KB) or PlayCanvas (300 KB)
- First-time load could take 5-15 seconds on mobile connections
- Violates "instant play" requirement

### Learning Curve
- GDScript is easy to learn (Python-like) but not TypeScript
- C# support exists but web export with C# has additional issues
- Visual editor is excellent for game development — but requires downloading Godot editor
- Not text-editor-friendly for AI-assisted development

### Claude Code Compatibility
- **Poor**
  - GDScript is less common in training data than TypeScript/JavaScript
  - Editor-dependent workflow (scene files, resource files, .tscn format)
  - C# mode is more Claude-friendly but has worse web export support
  - Cannot easily work in "just open VS Code and write code" mode

### Notable Web Games
- Limited notable web-exported Godot games
- Most successful Godot games are native (desktop/mobile apps)
- Web export is treated as secondary platform by community

### Migration Cost Assessment
- **Estimated effort: 12-20 weeks** — complete engine change, new language, new paradigm
- Would need to learn GDScript or use C# (web export limitations)
- All existing TypeScript code thrown away
- All 1270+ tests thrown away
- **Risk: Very High** — iOS broken, bundle size huge, web is second-class citizen

Sources: [Godot Web Export Docs](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html), [iOS Crash Issue](https://github.com/godotengine/godot/issues/107390), [Web Export Progress](https://godotengine.org/article/progress-report-web-export-in-4-3/)

---

## 5. Other Engines

### Wonderland Engine
- **Focus:** WebXR (VR/AR in browser), not traditional games
- **Performance:** Excellent — WASM ECS architecture, 10-100x more objects than typical Three.js
- **Bundle size:** ~150 KB (very small)
- **Surface walking:** Basic physics, no navmesh
- **Glow/bloom:** Limited post-processing
- **Community:** ~1K GitHub stars, very small niche community
- **Claude Code:** Medium — TypeScript support, but proprietary editor workflow
- **Verdict:** Interesting tech but wrong focus. Built for VR headsets, not arcade shooters. Would require significant custom work for our use case. Editor is proprietary (free tier available).

Sources: [Wonderland Engine](https://wonderlandengine.com/)

### Cocos Creator (v4.0, now fully open source)
- **History:** Dominant in Asian mobile/web game market (WeChat mini-games, etc.)
- **Open source:** COCOS 4 went fully MIT open-source in January 2026
- **Web performance:** Pure JavaScript runtime for web, designed for mobile
- **WebGPU:** Supported
- **Physics:** Built-in Bullet physics
- **Bundle size:** ~200-400 KB JS runtime (competitive)
- **Surface walking:** Physics-based, navmesh via built-in system
- **Glow/bloom:** Built-in post-processing pipeline
- **Community:** ~8K GitHub stars, massive in China, small in Western markets
- **Claude Code:** **Poor** — editor-dependent workflow (PinK IDE), most documentation/community in Chinese, TypeScript support but the editor is the primary development path
- **Notable games:** Many WeChat mini-games, several H5 games in Asian markets
- **Verdict:** Viable engine technically, but ecosystem barrier is very high. Documentation is China-focused. Community help in English is limited. Editor-dependent workflow doesn't suit Claude Code.

Sources: [Cocos Creator](https://www.cocos.com/en/creator), [COCOS 4 Open Source](https://itsfoss.com/news/cocos-4-game-engine/), [Cocos Engine GitHub](https://github.com/cocos/cocos-engine)

### PixiJS (v8)
- 2D renderer only (no 3D support)
- **Disqualified** — Geometry Wars 3D requires actual 3D surfaces

### Phaser
- 2D game framework (uses PixiJS or Canvas)
- **Disqualified** — no 3D support

---

## 6. Unity WebGL & Unreal Pixel Streaming

### Unity WebGL Export
- **Bundle size: 10-50+ MB** (even with aggressive optimization)
  - Code stripping, texture compression (Crunch), audio compression (Vorbis)
  - Still enormous compared to native web engines
- **Performance:** CPU-side WebGL dispatch is slow; avoid large draw call counts
- **Mobile:** Very poor — heavy WASM, memory pressure, long load times
- **Physics:** Full PhysX (overkill for 2D-on-3D arcade game)
- **NavMesh:** Excellent built-in NavMesh system
- **Glow/bloom:** Excellent post-processing stack
- **Claude Code compatibility:** **Poor**
  - C# language (less web-focused AI training data)
  - Unity Editor required (GUI-based, not text-based workflow)
  - Proprietary license (Runtime Fee controversy in 2023, now adjusted)
  - Build iteration: change code -> build WebGL -> wait 5-10 minutes -> test
- **Notable web games:** Some itch.io games, educational tools
- **Verdict:** **Hard no.** Bundle size violates "instant play." Mobile performance is poor. Build iteration is brutal. Editor dependency makes Claude Code development impractical. The license situation adds risk.

Sources: [Unity Web Performance](https://docs.unity3d.com/Manual/webgl-performance.html), [Unity Web Build](https://docs.unity3d.com/Manual/webgl-building.html), [Unity WebGL Tips](https://friendzy.xyz/2025/09/17/unity-webgl-performance-tips/)

### Unreal Engine (Pixel Streaming)
- **Not a true web export** — renders on server, streams video via WebRTC
- Unreal dropped direct WebGL export years ago
- **Pixel Streaming requires:**
  - Powerful GPU server for each concurrent session
  - WebRTC signaling server
  - Low-latency network connection
  - Cost: $0.50-5.00/hour per concurrent user (GPU server rental)
- **Latency:** 30-100ms additional input latency (unacceptable for arcade shooter)
- **Mobile:** Works as video stream but input latency kills gameplay
- **Claude Code compatibility:** **Very Poor** — C++, Blueprints, massive editor
- **Verdict:** **Absolute no.** Server-rendered streaming is antithetical to "pull out your phone and play." Latency, cost, and infrastructure requirements are disqualifying.

Sources: [Pixel Streaming Docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/pixel-streaming-in-unreal-engine), [Pixel Streaming vs WebGL](https://vagon.io/blog/pixel-streaming-vs-webgl-vs-webgpu-the-best-solution-for-unreal-engine-web-deployment)

---

## Detailed Analysis: The Surface Walking Problem

This is the core technical challenge for Geometry Wars 3D. No engine solves it out of the box.

### What We Need
Players walk on the surface of arbitrary 3D meshes: spheres, cubes, tori, Mobius strips, pills, tunnels, peanuts, etc. The player must:
1. Stay on the surface at all times
2. Move smoothly in any direction
3. Have correct orientation (feet on surface, head away)
4. Aim independently of movement direction
5. Handle topology changes (wrapping on torus, twist on Mobius)

### How Each Engine Handles This

| Approach | Engine Support | Pros | Cons | Geometry Wars Fit |
|---|---|---|---|---|
| **UV-based (current)** | Custom (Three.js) | Precise, deterministic, fast | Complex math, seam discontinuities, hard to add surfaces | Already working |
| **NavMesh** | Babylon.js (V2), Godot, Unity | Industry standard, works with any mesh | Designed for floors, not spheres; wrapping topology unsupported | Poor for curved/wrapping surfaces |
| **Physics constraint** | All engines | Works with any geometry | Jittery on curves, non-deterministic, hard to tune | Poor for arcade feel |
| **Raycasting + projection** | All engines | Simple concept, works with any mesh | Expensive per-frame, edge cases at surface boundaries | Medium — simpler than UV but less precise |
| **Tangent-frame walking** | Custom (any engine) | Handles curvature well, topologically correct | Custom math regardless of engine | Good — this is what we already do |

**Key insight:** The surface walking problem is custom regardless of engine. Babylon.js's NavMesh V2 won't help for sphere/Mobius/torus walking. The math is in our custom code, not in Three.js's API. Switching engines doesn't solve this problem.

---

## Cost-Benefit Analysis

### Migration Cost (estimated person-weeks)

| Target Engine | Code Rewrite | Test Rewrite | Learning Curve | Surface System | Total |
|---|---|---|---|---|---|
| Babylon.js | 4-6 weeks | 2-3 weeks | 1 week | 1-2 weeks (port existing) | **8-12 weeks** |
| PlayCanvas | 5-8 weeks | 2-3 weeks | 2 weeks | 1-2 weeks (port existing) | **10-15 weeks** |
| Godot | 8-12 weeks | 4-6 weeks | 3 weeks | 2-3 weeks (port + new lang) | **17-24 weeks** |
| Unity | 8-12 weeks | 4-6 weeks | 2 weeks | 2-3 weeks (port + C#) | **16-23 weeks** |

### What We'd Gain

| Engine | Gains | Losses |
|---|---|---|
| **Babylon.js** | Havok physics, built-in glow, NavMesh V2, character controller | 1270+ tests, battle-tested codebase, smaller bundle, 300x larger community |
| **PlayCanvas** | Mobile optimization, collaborative editor | Community size, control over rendering pipeline, code-only documentation |
| **Godot** | Full game engine features, visual editor | iOS support, bundle size, TypeScript, web as first-class platform |

### What We'd Lose (from any migration)
1. **1270+ tests** — all unit and integration tests must be rewritten
2. **12 working surfaces** — surface system must be ported to new engine's API
3. **Battle-tested code** — 8+ sessions of bug fixes, regression guards, performance tuning
4. **Development velocity** — months of ramp-up on new engine
5. **Community support** — Three.js has 300x more users finding and fixing bugs

---

## Recommendation

### Stay with Three.js. Here's why:

1. **The surface walking problem is engine-agnostic.** Our hardest technical challenge (walking on spheres, Mobius strips, tori) requires custom math regardless of engine. Babylon.js's NavMesh won't help here. We'd port the same code to a different API.

2. **Bundle size matters for "instant play."** Three.js at 168 KB gzipped is 8x smaller than Babylon.js. For the "scan QR code and play" experience on mobile, every KB counts. Godot's 5 MB WASM is disqualifying.

3. **Ecosystem dominance is real.** 4.3M weekly downloads means more bugs found and fixed, more Stack Overflow answers, more tutorial content, better AI code generation. When we hit a weird InstancedMesh edge case at 3 AM, Three.js community has the answer.

4. **WebGPU is production-ready in Three.js.** The performance gap between Three.js and Babylon.js has narrowed with WebGPU. Both support native WGSL shaders. The "Babylon.js is faster for complex scenes" argument is less compelling in 2026.

5. **Migration cost is not justified.** 8-12 weeks minimum for Babylon.js migration, with significant regression risk, for marginal gains in areas (physics, glow) that we've already solved.

### What to improve in the current Three.js setup:

1. **Surface system simplification** — Consider replacing UV-based math with tangent-frame walking + raycasting for simpler surfaces. Keep UV for topologically complex surfaces (Mobius, Klein bottle).

2. **Leverage WebGPU compute shaders** — For particle systems, spatial hashing, and enemy AI pathfinding. Three.js r171+ supports compute shaders via `WebGPURenderer`.

3. **Consider recast-navigation-js** for enemy pathfinding (not player movement). Enemies finding paths on surface meshes would benefit from navmesh, even if the player uses the existing UV system.

4. **Post-processing upgrade** — Three.js's `postprocessing` library (by vanruesc) offers higher quality bloom than the built-in UnrealBloomPass. Worth evaluating.

### The only scenario where migration makes sense:

If the project pivots to a flat-ground game (like traditional Geometry Wars 2D, but rendered in 3D), then Babylon.js would be compelling: Havok character controller + NavMesh V2 + built-in glow would save significant development time. But as long as we're walking on spheres and Mobius strips, the engine choice is irrelevant to our hardest problem.

---

## Sources

### General Comparisons
- [Three.js vs Babylon.js vs PlayCanvas | Comparison Guide 2026](https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison)
- [What Changed in Three.js 2026](https://www.utsubo.com/blog/threejs-2026-what-changed)
- [Top Browser Game Engines (Feb 2026)](https://www.dragonflydb.io/game-dev/engines/browser)
- [Three.js vs Babylon.js (LogRocket)](https://blog.logrocket.com/three-js-vs-babylon-js/)
- [BabylonJS vs ThreeJS: Easiest to Learn 2026](https://vocal.media/01/babylon-js-vs-three-js-the-easiest-to-learn-in-2026)

### Three.js
- [Three.js GitHub](https://github.com/mrdoob/three.js) — 110K+ stars
- [React Three Fiber](https://github.com/pmndrs/react-three-fiber) — 28K+ stars
- [recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js) — navmesh for Three.js
- [three-pathfinding](https://github.com/donmccurdy/three-pathfinding) — pathfinding on navmesh
- [100 Three.js Performance Tips (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips)

### Babylon.js
- [Babylon.js Official](https://www.babylonjs.com/)
- [Babylon.js 8.0 Announcement](https://babylonjs.medium.com/introducing-babylon-js-8-0-77644b31e2f9)
- [Havok Physics Plugin](https://doc.babylonjs.com/features/featuresDeepDive/physics/havokPlugin)
- [Navigation Plugin V2](https://forum.babylonjs.com/t/navigation-plugin-v2-is-here/60751)
- [GlowLayer Documentation](https://doc.babylonjs.com/features/featuresDeepDive/mesh/glowLayer)
- [WebGPU Status](https://doc.babylonjs.com/setup/support/webGPU/webGPUStatus)
- [Creating Thousands of Animated Entities](https://babylonjs.medium.com/creating-thousands-of-animated-entities-in-babylon-js-ce3c439bdacf)

### PlayCanvas
- [PlayCanvas Engine GitHub](https://github.com/playcanvas/engine) — 9.7K stars
- [PlayCanvas Games](https://playcanvas.com/industries/games)
- [PlayCanvas + Colyseus Tutorial](https://developer.playcanvas.com/tutorials/real-time-multiplayer-colyseus/)
- [Standalone Engine Docs](https://developer.playcanvas.com/user-manual/engine/standalone/)

### Godot
- [Godot Web Export Docs](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- [Web Export Progress (4.3)](https://godotengine.org/article/progress-report-web-export-in-4-3/)
- [iOS Audio Crash Issue #107390](https://github.com/godotengine/godot/issues/107390)

### Other
- [Wonderland Engine](https://wonderlandengine.com/)
- [Cocos Creator](https://www.cocos.com/en/creator)
- [COCOS 4 Open Source Announcement](https://itsfoss.com/news/cocos-4-game-engine/)
- [Unity Web Performance](https://docs.unity3d.com/Manual/webgl-performance.html)
- [Unreal Pixel Streaming](https://dev.epicgames.com/documentation/en-us/unreal-engine/pixel-streaming-in-unreal-engine)
- [WebGPU 2026 Browser Support](https://byteiota.com/webgpu-2026-70-browser-support-15x-performance-gains/)
