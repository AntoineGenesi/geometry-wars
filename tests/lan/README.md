# LAN Multiplayer E2E Test Suite

Automated LAN multiplayer testing for Geometry Wars 3D. Spins up a Colyseus server and 2 headless browser clients, connects them, and verifies gameplay programmatically.

## How to Run

```bash
npm run test:lan
```

Or directly:

```bash
node tests/lan/run-lan-tests.mjs
```

## Prerequisites

- Node 20+ (via nvm)
- Puppeteer Chrome at `~/.cache/puppeteer/chrome/`
- No existing processes on ports 3000-3006 or 2567 (the test suite kills stale processes automatically)

## What It Tests

| Scenario | Test | What It Verifies |
|----------|------|------------------|
| 1a | Both clients connect | `isConnected() === true` on both pages |
| 1b | Both see 2 players | `getPlayerCount() === 2` on both pages |
| 1c | Valid player IDs | Both have non-empty, different session IDs |
| 2a | Host starts game | Click START GAME, status changes to "Wave X" |
| 2b | Movement works | WASD changes player position (UV coordinates) |
| 2c | Join client stable | Second client stays connected during host movement |
| 3a | Enemies spawn | `getEnemyCount() > 0` after waiting |
| 3b | Valid enemy positions | Enemy UV coordinates in valid range |
| 3c | Enemy count sync | Both clients see similar enemy counts |
| 4 | Surface sync | Both clients report same surface type |
| 5a | 10s stability | 10+ seconds of gameplay without disconnection |
| 5b | No critical errors | No JavaScript errors in console |
| 5c | Players stable | Both clients still see 2 players after extended play |

## Architecture

### Debug Hook (Unintrusive)

The game exposes a read-only `window.__gameDebug` API when `?debug=true` is in the URL. This is the ONLY modification to game code -- a small block at the end of `src/network-main.ts` that provides:

- `getPlayerPosition()` -- local player UV coordinates
- `getEnemyCount()` -- number of tracked enemies
- `getEnemies()` -- array of enemy data (id, type, u, v, hp)
- `getBulletCount()` -- number of tracked bullets
- `getScore()` -- local player score
- `isConnected()` -- WebSocket connection status
- `getPlayerCount()` -- number of connected players
- `getLocalPlayerId()` -- session ID
- `getSurfaceType()` -- current surface type
- `isGameStarted()` -- whether game is running
- `getWaveText()` -- status text content

No behavior changes. No if-statements in game logic. Only active with `?debug=true`.

### Test Harness

The test runner (`tests/lan/run-lan-tests.mjs`):

1. Kills stale processes on required ports
2. Starts Colyseus server (port 2567)
3. Starts Vite dev server if not running (port 3000)
4. Opens 2 Puppeteer browser instances with SwiftShader WebGL
5. Navigates both to `?mode=network&surface=sphere&debug=true&testMode=true`
6. Runs tests sequentially, reading state via `page.evaluate()`
7. Takes screenshots at key moments
8. Cleans up all processes
9. Writes results to `test-results/lan/lan-test-results.json`

### URL Parameters

Both clients connect with:
- `mode=network` -- loads network-main.ts (bypasses start menu)
- `surface=sphere` -- surface type
- `server=ws://localhost:2567` -- Colyseus server URL
- `debug=true` -- enables `__gameDebug` API
- `testMode=true` -- enables `preserveDrawingBuffer` for canvas screenshots

## Screenshots

Screenshots are saved to `test-screenshots/lan/`:
- `lan-01-host-loaded-host.png` -- host page after loading
- `lan-02-both-connected-*.png` -- both pages after connecting
- `lan-03-game-started-*.png` -- both pages after game starts
- `lan-04-enemies-spawned-*.png` -- both pages with enemies
- `lan-05-final-*.png` -- final state
- `lan-FAIL-*-*.png` -- failure screenshots

## Adding New Scenarios

Add a test using the `test()` function:

```javascript
test('My new scenario', async ({ hostPage, joinPage }) => {
  // Read game state
  const data = await getDebug(hostPage, 'getEnemyCount');

  // Assert
  expect(data).toBeGreaterThan(0);
});
```

Available helpers:
- `getDebug(page, method)` -- call a `__gameDebug` method
- `waitForDebug(page, method, timeout)` -- poll until truthy
- `waitForCondition(fn, timeout)` -- poll until fn returns true
- `expect(value)` -- assertion chain
- `sleep(ms)` -- wait
- `takeScreenshots(hostPage, joinPage, label)` -- save screenshots

## Troubleshooting

**Tests fail to connect**: Check that no other process is using ports 2567 or 3000. Run `ss -tlnp | grep -E '2567|3000'`.

**Debug API not available**: The `__gameDebug` object is only created when `?debug=true` is in the URL AND `network-main.ts` successfully loads. Check browser console for import errors.

**SwiftShader slow**: SwiftShader renders at ~2-5 FPS. Timeouts are generous but may need adjustment on slower machines.

**Server auto-shutdown**: The test launches the server with `SHUTDOWN_TIMEOUT=0` to disable auto-shutdown during tests.
