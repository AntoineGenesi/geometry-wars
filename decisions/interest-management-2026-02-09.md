## 2026-02-09 - Interest Management System for Network Multiplayer

**Context:** Network multiplayer syncs all entities to all clients every tick. With 50+ enemies, bullets, geoms, and pickups, bandwidth grows linearly with player count and entity count. Need per-client filtering to scale beyond 4 players or enable higher entity counts.

**Options Considered:**
1. **Colyseus `@filterChildren` decorator** - Native per-property filtering. Pros: Built-in, minimal overhead. Cons: Requires schema v2 decorators which conflict with the `declare` + `defineTypes` pattern used in GameState.ts (ES2022 class fields workaround). Would need schema refactor.
2. **Application-level interest management** - Server-side system that computes per-client sync sets, integrated into tick loop. Filter results available via `shouldSyncEntity()` for future `@filterChildren` adoption. Pros: Works with existing schema, no decorator changes needed, easily testable. Cons: Currently advisory only (actual Colyseus patch filtering requires schema decorator changes).
3. **Spatial hash grid** - Divide UV space into cells, only sync cells near player. Pros: O(1) lookup. Cons: More complex, UV wrapping makes cell boundaries tricky.

**Decision:** Option 2 - Application-level interest management with PriorityQueue.

**Reasoning:**
- Works immediately with the existing `declare` + `defineTypes` schema pattern
- PriorityQueue adds throttling (close=every tick, medium=every 3rd, far=every 6th) for additional bandwidth savings
- UV-distance calculation handles wrapping per surface type (sphere wraps U, torus wraps both, cube wraps neither)
- `shouldSyncEntity()` method is ready for future `@filterChildren` integration
- 54 tests validate correctness including wrapping edge cases

**Estimated bandwidth savings:** ~91% reduction (from 4.7 MB/s to 417 KB/s for 1000 entities, 4 players at 60Hz)

**Reversibility:** Easy - Remove InterestManager import and calls from GameRoom.ts. Delete server/systems/ directory. The system is purely additive with no changes to GameState schema.
