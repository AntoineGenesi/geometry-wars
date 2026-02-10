## 2026-02-10 - Collision Detection O(n^2) Optimization

**Context:** The collision worker (`collision.worker.ts`) was the primary performance bottleneck. At 2K entities on a sphere, the `runCollisionDetection` function took 49ms per frame (well above the 16ms budget for 60fps). Root cause was a combination of oversized cells (2.5 in a thin sphere shell) causing ~400 neighbors per query, and a `Set<number>` for pair deduplication creating heavy GC pressure.

**Options Considered:**
1. **Replace Set with bitfield only** - Pros: Simple change / Cons: Doesn't fix the root cause (too many neighbors per cell)
2. **Adaptive cell size only** - Pros: Reduces neighbors / Cons: Still has Set GC pressure
3. **Full rewrite: adaptive cells + flat hash table + bitfield** - Pros: Addresses all three bottlenecks / Cons: More complex change
4. **Surface-aware UV partitioning** - Pros: Theoretically optimal / Cons: Would require changes to entity data pipeline, not compatible with current 3D position-based interface

**Decision:** Option 3 -- full rewrite with all three optimizations combined.

**Implementation Details:**
- Adaptive cell size computed from bounding box extent and surface area estimate: `cellSize = max(sqrt(8 * surfaceArea / count), 2 * maxRadius)`
- Flat hash table via counting sort into Int32Array (3-pass: count, prefix sum, scatter)
- Uint32Array bitfield for O(1) pair dedup, cleared per entity
- Pre-allocated typed arrays with grow-only strategy (reused across frames)
- Cell coordinate caching to avoid recomputation
- Hash collision filtering: verify entity's actual cell matches target neighbor cell

**Results:**
- 2K entities: 49.4ms -> 5.0ms (9.9x faster)
- 5K entities: 343ms -> 11.8ms (29x faster)
- 10K entities: 129ms -> 10.7ms (12x faster)
- 20K entities: 231ms -> 7.2ms (32x faster)
- All 69 collision detection tests pass

**Reasoning:** The combined approach was necessary because each optimization targets a different aspect of the problem. Adaptive cell size reduces the number of neighbors from ~400 to ~50 (dominant factor). The flat hash table eliminates Map/Array GC. The bitfield eliminates Set GC. Together they achieve 10-30x speedup.

**Reversibility:** Easy - revert `collision.worker.ts` to previous version. The function signature and behavior are identical.

---

## 2026-02-10 - Port Optimizations from collision.worker.ts into SpatialHash.ts

**Context:** The audit found that the optimized `runCollisionDetection()` in `collision.worker.ts` (adaptive cell size, flat hash table, bitfield dedup -- 29x faster at 5K entities) was NEVER CALLED by the actual game. The game uses `SpatialHash` from `src/core/SpatialHash.ts` with fixed 2.5 cell size and Map-based storage. The optimized code sat unused in the worker.

**Options Considered:**
1. **Option A: Port optimizations into SpatialHash.ts** - Pros: Same API, all consumers benefit, lowest risk / Cons: No bitfield dedup (SpatialHash stores generic T, not indices)
2. **Option B: Wire WorkerBridge collision into main.ts** - Pros: Uses existing optimized code directly / Cons: Async worker communication, different API, entity serialization overhead, complex integration

**Decision:** Option A -- port adaptive cell size + flat hash table into SpatialHash.ts with a dual-path approach.

**Implementation Details:**
- Dual-path architecture: entities <= 512 use simple Map-based path (original behavior), entities > 512 use optimized flat hash table + adaptive cell sizing
- Adaptive cell size computed from bounding box extent + estimated surface area (same algorithm as collision.worker.ts)
- Flat hash table via counting sort: 3-phase (count per bucket -> prefix sum -> scatter)
- Lazy build: flat table constructed on first getNearby() after inserts
- All typed arrays grow-only (reused across frames after warmup)
- Cell coordinate caching + hash collision filtering (verify entity's actual cell matches)
- Map-based path preserved for low counts where build overhead dominates

**Results (SpatialHash Stress Test, 1000 queries):**
| Entities | BEFORE nearby | AFTER nearby | BEFORE query | AFTER query | Speedup |
|----------|--------------|-------------|-------------|------------|---------|
| 1,000    | 81.6         | 68.9        | 1.40ms      | 1.30ms     | 1.1x    |
| 5,000    | 400.9        | 41.1        | 2.18ms      | 1.23ms     | 1.8x    |
| 10,000   | 823.2        | 29.5        | 6.05ms      | 1.24ms     | 4.9x    |
| 50,000   | 4,007.3      | 13.7        | 19.56ms     | 2.25ms     | 8.7x    |
| 100,000  | 7,745.3      | 10.0        | 35.35ms     | 16.06ms    | 2.2x    |

**Files Changed:**
- `src/core/SpatialHash.ts` - Complete rewrite with dual-path architecture
- `src/test/performance-benchmark.test.ts` - Added adaptive cell size verification tests

**Reasoning:** Option A was chosen because it gives all SpatialHash consumers (main.ts collision, enemy separation, CollisionBridge fallback) the optimization automatically with zero API changes. The dual-path approach ensures no regression at low counts. The bitfield dedup from collision.worker.ts was not ported because SpatialHash's getNearby() API returns entities (not collision pairs), so duplicate-pair elimination is not applicable.

**Reversibility:** Easy - revert SpatialHash.ts to the original 79-line implementation. The API is identical.
