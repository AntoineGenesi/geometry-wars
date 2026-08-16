# Player–enemy contact proof

`?testMode=true` exposes `window.__TEST_API` from the real single-player game.
It is intended for browser tests, not a mock simulation.

## Contact evidence

`getRecentDamageEvents()` now records each `CollisionSystem.checkPlayerEnemyCollisions`
event as an `enemy-contact` record. It includes the enemy test ID, both positions,
the measured centre distance, and the exact collision threshold. Use
`clearEvents()` before a controlled case. For a sequence of independent cases,
call `preparePlayerContactProof()` before each one; it resets only the test-mode
player invulnerability/lives state so an earlier controlled hit cannot mask the
next collision check.

## Holding an enemy for a visual collision check

Use `moveEnemyTo(id, u, v, 0)`. The harness holds the enemy after the real game
loop, teleports its walker, then reapplies `BaseEnemy.applySurfaceTransform`.
That final step is important: it keeps the same normal-based visual elevation as
production, so a held enemy does not produce a false surface-level collision result.

## Reproducible browser proof

Run:

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome \
  node tests/visual/orbiter-contact-live-proof.mjs
```

The test starts the real single-player loop on Sphere, verifies the tightened
Orbiter boundary, and smoke-tests direct overlap contact for the other standard
enemy types. It writes a timestamped JSON report and screenshot to `reports/`.

## Collision decision record

Multiplayer `GameRoom` collision is server-authoritative and must not be copied
into single-player. Single-player uses visual mesh positions with a
curved-surface elevation compensation, then requires the enemy to enter the
player core. This was live-checked on `flat-arena`, `sphere`, and `pill`:
the prior premature Orbiter boundary is safe while near-centre overlap remains
contactable. Keep the Mobius-only fallback intact when changing this policy.
