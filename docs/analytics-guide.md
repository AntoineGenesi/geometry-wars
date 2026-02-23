# GW3D Analytics Guide

How to collect, query, and analyze DDA difficulty + performance data for beta testing.

## Where the Data Lives

| Store | Key / Path | What | Max |
|-------|-----------|------|-----|
| Browser localStorage | `gw_perf_log` | FPS, entities, DDA, position (500ms samples) | 500 sessions |
| Browser localStorage | `gw3d_dda_sessions` | DDA level, kill rate, events | 10 sessions |
| File: `logs/performance/*.json` | — | Exported perf sessions with git hash | unlimited |
| File: `logs/game-state/*.json` | — | Exported DDA sessions with git hash | unlimited |

Data is **never auto-deleted** from localStorage. Sessions accumulate automatically during normal gameplay.

## Getting Data

### During Play (browser)
Open `analytics.html` (served from Vite or opened directly) while the game is running.
The dashboard auto-refreshes every 5 seconds and reads directly from `localStorage`.

### Exporting to Files (for git tracking + CLI analysis)
1. Run the game + server: `npm run dev` + `npm run server`
2. Play a session until game over or level complete — data auto-exports via `/api/export-perf-logs`
3. Or: press **F3** in-game → click **EXPORT** to trigger manual export
4. Files appear in `logs/performance/` and `logs/game-state/` named with timestamp + git commit hash

### From the browser console
```js
// Get all perf sessions
JSON.parse(localStorage.getItem('gw_perf_log'))

// Get DDA sessions
JSON.parse(localStorage.getItem('gw3d_dda_sessions'))

// Export all as JSON string
localStorage.getItem('gw_perf_log')
```

## Data Schema

### Performance Session (`gw_perf_log`)
```json
{
  "timestamp": "2026-02-24T11:00:00.000Z",
  "mapType": "sphere",
  "duration": 180.5,
  "dataPoints": [
    {
      "t":  5.0,     "f":  59.3,   "e": 12,    "b": 20,
      "dd": 1.5,     "dt": 1.2,    "pl": 3,    "ql": "HIGH",
      "s":  1500,    "k":  8,      "d": 0,     "aw": "Standard",
      "ab": "hot_hands:1",         "ks": 2,    "ae": 4,
      "pu": 0.423,   "pv": 0.611,  "pf": 27,
      "px": 3.14,    "py": -2.71,  "pz": 1.0,
      "ps": false
    }
  ],
  "summary": {
    "avgFps": 55.2, "minFps": 34.1, "maxFps": 62.0,
    "peakEnemies": 45, "peakDifficultyTier": 4.5,
    "finalScore": 48200, "totalKills": 132, "totalDeaths": 2,
    "finalPlayerPowerLevel": 8
  }
}
```

**Short key → Full name:**
| Key | Field |
|-----|-------|
| `t` | time (seconds) |
| `f` | fps |
| `e` | enemyCount |
| `b` | bulletCount |
| `dd` | ddaLevel (0–3, 0=hardest) |
| `dt` | difficultyTier (0–4.5+) |
| `pl` | playerPowerLevel |
| `s/k/d` | score/kills/deaths |
| `aw/ab` | activeWeapon / activeBuffs |
| `pu/pv/pf` | playerSurfaceU/V/FaceIndex |
| `px/py/pz` | playerWorldX/Y/Z |
| `ps` | playerStuck (true if UV+face unchanged >2s) |

### DDA Session (`gw3d_dda_sessions`)
```json
{
  "startedAt": "2026-02-24T11:00:00.000Z",
  "surface": "sphere",
  "playerCount": 1,
  "ddaEnabled": true,
  "samples": [
    { "t": 5.0, "players": [{ "score": 0.52, "level": 1.5, "speed": 1.15, "kr": 8.4, "dr": 1.2, "sr": 420, "kills": 7, "deaths": 1 }] }
  ],
  "events": [
    { "t": 12.5, "type": "level_change", "player": 0, "data": 2.0 },
    { "t": 14.1, "type": "kill", "player": 0, "data": "Spinner" }
  ]
}
```

## CLI Analysis Scripts

### All 5 queries at once (DDA + FPS + correlation + progression + stuck detection)
```bash
node scripts/analyze-dda-performance.mjs
# → reports/dda-analysis-<timestamp>.html

# Limit to last 3 sessions
node scripts/analyze-dda-performance.mjs --last 3

# Filter by commit
node scripts/analyze-dda-performance.mjs --query dda
node scripts/analyze-dda-performance.mjs --query stuck
```

### Combined telemetry report (perf + DDA + charts, by commit)
```bash
node scripts/analyze-telemetry.mjs
# → reports/telemetry-<timestamp>.html

# Since a date
node scripts/analyze-telemetry.mjs --since 2026-02-20

# For a specific commit
node scripts/analyze-telemetry.mjs --commit e394886
```

### Quick jq queries on exported files
```bash
# Average FPS across all sessions
jq '[.sessions[].summary.avgFps] | add/length' logs/performance/*.json

# Sessions with min FPS below 30 (frame drops)
jq '.sessions[] | select(.summary.minFps < 30) | {ts: .timestamp, map: .mapType, minFps: .summary.minFps}' logs/performance/*.json

# DDA level changes per session (shows how often DDA kicks in)
jq '.sessions[].events | map(select(.type == "level_change")) | length' logs/game-state/*.json

# Stuck events (playerStuck = true)
jq '.sessions[] | {ts: .timestamp, map: .mapType, stuckPoints: [.dataPoints[] | select(.ps == true) | .t]}' logs/performance/*.json

# Difficulty escalation: avg diff tier in last 60s of each session
jq '.sessions[] | {map: .mapType, lateDiff: [.dataPoints[] | select(.t > (.duration - 60)) | .dt // 0] | add/length}' logs/performance/*.json

# Kill rate by DDA level (higher DDA = more assistance = should see higher kill rate for struggling players)
jq '[.sessions[].dataPoints[] | {dda: (.dd | floor), ks: (.ks // 0)}] | group_by(.dda) | map({dda: .[0].dda, avgKps: (map(.ks) | add/length)})' logs/performance/*.json

# Identify sessions where player got stuck
jq '.sessions[] | select(.dataPoints | map(.ps == true) | any) | {ts: .timestamp, map: .mapType, stuckTimes: [.dataPoints[] | select(.ps == true) | .t]}' logs/performance/*.json
```

## Example Analysis Queries (Node.js)

Reusable functions for custom analysis:

```js
// Load data
const sessions = JSON.parse(fs.readFileSync('logs/performance/latest.json')).sessions;

// Q: What FPS range do players get at each difficulty level?
const tiers = {};
for (const s of sessions) {
  for (const p of s.dataPoints) {
    const tier = Math.floor(p.dt ?? 0);
    if (!tiers[tier]) tiers[tier] = [];
    tiers[tier].push(p.f ?? 0);
  }
}
for (const [tier, fpsList] of Object.entries(tiers).sort()) {
  const avg = fpsList.reduce((a, b) => a + b, 0) / fpsList.length;
  console.log(`Tier ${tier}: avg FPS = ${avg.toFixed(1)}`);
}

// Q: Show DDA progression for last 10 games
const last10 = sessions.slice(-10);
for (const s of last10) {
  const pts = s.dataPoints;
  const startDDA = pts[0]?.dd ?? 0;
  const endDDA = pts[pts.length - 1]?.dd ?? 0;
  console.log(`${s.timestamp.slice(0,16)} ${s.mapType}: DDA ${startDDA} → ${endDDA}`);
}

// Q: Identify sessions where player got stuck
const stuckSessions = sessions.filter(s =>
  s.dataPoints.some(p => p.ps === true)
);
for (const s of stuckSessions) {
  const stuckPts = s.dataPoints.filter(p => p.ps);
  console.log(`Stuck in ${s.mapType} at t=${stuckPts[0].t}s UV=(${stuckPts[0].pu},${stuckPts[0].pv}) face#${stuckPts[0].pf}`);
}

// Q: Correlate difficulty spike with FPS drop
for (const s of sessions) {
  const pts = s.dataPoints;
  const highDiff = pts.filter(p => (p.dt ?? 0) > 3);
  const lowFpsAtHighDiff = highDiff.filter(p => (p.f ?? 60) < 40);
  const pct = highDiff.length ? (lowFpsAtHighDiff.length / highDiff.length * 100).toFixed(0) : 0;
  console.log(`${s.mapType}: ${pct}% of high-difficulty samples have FPS < 40`);
}
```

## Beta Testing Workflow

When running beta sessions:

1. **Before session:** Check git commit (`git log --oneline -1`)
2. **During play:** `analytics.html` open in separate tab — watch for stuck events / FPS dips
3. **After session:** Export triggered automatically on game over. Check `logs/performance/` for the new file.
4. **End of day:** `node scripts/analyze-dda-performance.mjs` → open HTML report
5. **Compare across days:** `node scripts/analyze-telemetry.mjs --since YYYY-MM-DD`

### What to look for:
- **DDA trend positive** (level rising) → players struggling → increase DDA strength or reduce enemy count
- **FPS P5 < 30** → performance problem under load → profile with `analyze-profiling-trends.mjs`
- **Stuck events** → mesh collision bug → check UV position + face index in stuck report
- **Kill rate plateau** → players may be over-powered or enemies too easy at that tier
- **FPS/diff correlation < -0.6** → high difficulty is hurting FPS → optimize enemy logic

## Adding New Metrics

To add a new metric to telemetry:
1. Add field to `PerformanceDataPoint` interface in `src/core/PerformanceLogger.ts`
2. Add compact key to `SerializedDataPoint` (use 2-3 char key)
3. Update `serializePoint()` and `exportAllAsCSV()` in the same file
4. Update `expandPoints()` in `scripts/analyze-dda-performance.mjs` to read the new key
5. Add column to the report in `buildReport()`
