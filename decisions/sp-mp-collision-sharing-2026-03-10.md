## 2026-03-10 — CollisionSystem Sharing Between SP and MP

**Context:** The SP/MP analysis report recommended importing CollisionSystem.ts in network-main.ts to deduplicate ~300 lines of inline collision code.

**Options Considered:**
1. **Import CollisionSystem directly** — Pass SP CollisionSystem instance to network-main.ts
   - Pros: Maximum code sharing, single collision implementation
   - Cons: Architecturally incompatible. SP CollisionSystem does direct damage (enemy.takeDamage), spawns particles, manages score. MP network-main.ts sends messages to the server (network.sendBulletHit). Entirely different response to a collision hit.
2. **Create adapter pattern** — Abstract collision detection from collision response
   - Pros: Would allow shared detection with different responses
   - Cons: High effort, over-engineering for current needs. The actual collision detection code in network-main.ts is only ~50 lines (not ~300 as the report estimated). The rest is response handling specific to each context.
3. **Keep separate (chosen)** — Document the architecture difference, focus on shared constants
   - Pros: Minimal risk, no behavior change, addresses the real duplication (constants)
   - Cons: Still two collision implementations

**Decision:** Keep separate collision implementations. The "300 lines of deduplication" claim was overstated — the actual distance-check collision detection is ~50 lines in network-main.ts. The remaining code is collision RESPONSE (damage application, particle effects, score management in SP; network message sending in MP), which is fundamentally different.

**What WAS shared:** Collision thresholds (hit radii) are now consistent because both SP and MP use the same constants from GameBalanceConstants.ts. This addresses the actual parity risk.

**Reasoning:** The analysis report conflated collision DETECTION (geometric distance checks) with collision RESPONSE (what happens after a hit). SP and MP need different responses. Forcing them through the same CollisionSystem class would require either:
- An adapter pattern with callbacks (over-engineered for 50 lines)
- Major refactoring of both SP and MP collision handling

Neither is worth the risk for a refactor task.

**Reversibility:** Easy — if future requirements justify it, the adapter pattern can be added incrementally.
