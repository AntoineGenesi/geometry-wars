## 2026-02-09 - Rapier WASM Collision System

**Context:** Implementing WASM-based collision detection using Rapier3D to handle high entity counts (10K+) as an alternative to the JS SpatialHash.

**Options Considered:**
1. Rapier narrow phase events (drainCollisionEvents) - Pros: efficient change detection / Cons: unreliable for sensors with kinematic bodies, events don't fire for initially-overlapping sensors
2. Rapier intersectionPairsWith (per-collider narrow phase query) - Pros: simple API / Cons: doesn't report pairs for newly-added sensors until narrow phase catches up
3. Rapier intersectionsWithShape (direct broadphase query per entity) - Pros: 100% reliable, respects collision groups / Cons: slightly more overhead per query

**Decision:** Used `intersectionsWithShape` for collision detection. Removed event-based API (`getCollisionEvents`) since sensor intersection events don't reliably fire for kinematic bodies.

**Reasoning:** Reliability trumps micro-optimization. The `intersectionsWithShape` approach works correctly in all cases (new entities, position updates, removals) and respects collision groups via the filterGroups parameter. The per-category query (`getCollisionsForCategory`) reduces unnecessary work.

**Performance Finding:** SpatialHash is faster than Rapier at all tested entity counts (1K-10K). This is because:
- JS SpatialHash has zero WASM boundary crossing cost
- Rapier's `world.step()` has fixed overhead even with zero gravity
- `intersectionsWithShape` has per-call overhead
- SpatialHash's simple insert+query pattern is very cache-friendly

**When Rapier becomes valuable:**
- Built-in collision group filtering (no manual bitmask checks)
- Shape-accurate intersection (future non-spherical colliders)
- Compound queries via broadphase
- Consistent API for both collision detection and spatial queries

**Reversibility:** Easy - SpatialHash is still the primary collision system. Rapier is an opt-in alternative via CollisionBridge.
