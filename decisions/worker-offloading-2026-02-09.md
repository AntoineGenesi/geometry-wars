## 2026-02-09 - Web Worker Offloading for Physics & AI

**Context:** Main thread handles collision detection and enemy AI, limiting scalability beyond ~2000 entities at 60fps.

**Options Considered:**
1. Web Workers with postMessage (transfer arrays) - Pros: Simple / Cons: Copy overhead
2. Web Workers with SharedArrayBuffer - Pros: Zero-copy / Cons: Requires COOP/COEP headers
3. WASM collision detection - Pros: Very fast / Cons: High complexity, separate build toolchain

**Decision:** SharedArrayBuffer-based Web Workers with main-thread fallback

**Reasoning:**
- COOP/COEP headers already configured in vite.config.ts
- Zero-copy transfer eliminates serialization bottleneck for 10K+ entities
- Fallback mode means no breakage if Workers fail (SSR, test environments, etc.)
- Pure functions exported from worker files enable testing without Worker context
- Double-buffering allows writing next frame while current processes

**Architecture decisions:**
1. AI worker stores per-enemy state locally (momentum, direction timers) rather than transferring it each frame -- saves ~40 bytes/entity/frame
2. Collision worker reimplements SpatialHash instead of sharing code with main thread -- avoids dynamic import complexity in worker context
3. WorkerBridge provides both sync (fallback) and async (worker) APIs so Game.ts can choose based on profiling

**Reversibility:** Easy - WorkerBridge with `useWorkers: false` falls back to identical main-thread code paths
