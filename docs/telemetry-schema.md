# Telemetry Schema

Geometry Wars 3D collects session telemetry for performance regression detection and DDA balance analysis. All data is correlated with the git commit hash to answer "when did X break or change?"

## Storage

| Location | Format | Purpose | In .gitignore? |
|----------|--------|---------|----------------|
| `logs/performance/` | JSON | PerformanceLogger sessions (FPS, entities, DDA) | Yes |
| `logs/game-state/` | JSON | DDALogger sessions (DDA assistance levels, events) | Yes |
| `reports/` | HTML | Generated aggregate reports | No (committed) |

Session files are named `<timestamp>-<commit-short>[−dirty].json`.

## PerformanceLogger Sessions (`logs/performance/`)

Each file contains:
```json
{
  "metadata": {
    "timestamp": "ISO string",
    "gitCommit": "full 40-char hash",
    "gitCommitShort": "7-char hash",
    "gitBranch": "branch name",
    "dirty": false
  },
  "sessions": [ StoredSession, ... ]
}
```

### `StoredSession`

```typescript
{
  timestamp: string,      // ISO session start time
  mapType: string,        // surface type (sphere, torus, cube, ...)
  duration: number,       // session duration in seconds
  dataPoints: SerializedDataPoint[],
  spikes?: FrameSpikeEvent[],
  summary?: SessionSummary
}
```

### `SerializedDataPoint` (compact keys for storage efficiency)

| Key | Type | Description |
|-----|------|-------------|
| `t` | number | Time since session start (seconds) |
| `f` | number | FPS |
| `e` | number | Enemy count |
| `b` | number | Bullet count |
| `et` | `[string, number][]` | Enemy type breakdown (type → count) |
| `dc` | number | Renderer draw calls |
| `tr` | number | Renderer triangles |
| `mm` | number | GPU memory estimate (MB) |
| `lh` | number | LOD high-detail enemy count |
| `lm` | number | LOD medium-detail enemy count |
| `ll` | number | LOD low-detail enemy count |
| `dd` | number | **DDA assistance level** (0–3 float, 0=no help, 3=max help) |
| `dt` | number? | **Difficulty tier** (0–4+ continuous float, wave difficulty level) |
| `pl` | number? | **Player power level** (kill-based progression level, integer) |
| `ql` | string | Quality level (ULTRA/HIGH/MEDIUM/LOW/MINIMAL) |
| `s` | number? | Score |
| `k` | number? | Total kills |
| `d` | number? | Total deaths |
| `aw` | string? | Active weapon type |
| `ab` | string? | Active buffs ("type:stacks,type:stacks") |
| `ks` | number? | Kills this sample window (for kill rate) |
| `ae` | number? | Active particle effects |
| `ve` | number? | Visible enemies (frustum) |
| `vb` | number? | Visible bullets (frustum) |
| `ax` | number? | Active explosions |

### Key DDA/Difficulty Fields

- **`dd` (ddaLevel 0–3)**: DDA *assistance* level — how much the system is helping the player. 0 = no assistance, 3 = maximum help (enemy type substitution, speed boost). This is per-player.
- **`dt` (difficultyTier 0–4+)**: Wave *difficulty tier* — how hard the waves are getting. Controlled by `WaveScheduler.currentDifficultyLevel`. Values > 4 are "super tiers" (continuous scaling beyond Nightmare). Correlates to enemy stats and spawn composition.
- **`pl` (playerPowerLevel)**: Player progression level based on kill count. Affects fire rate, move speed, and bullet speed via perks.

### `SessionSummary`

| Field | Description |
|-------|-------------|
| `avgFps` | Average FPS for the session |
| `minFps` | Minimum FPS |
| `maxFps` | Maximum FPS |
| `peakEnemies` | Peak simultaneous enemy count |
| `peakBullets` | Peak bullet count |
| `peakDrawCalls` | Peak renderer draw calls |
| `totalSpikes` | Count of frames > 33ms |
| `finalScore` | Score at session end |
| `totalKills` | Total enemy kills |
| `totalDeaths` | Total player deaths |
| `peakDifficultyTier` | Highest difficulty tier reached |
| `finalPlayerPowerLevel` | Player level at session end |

## DDALogger Sessions (`logs/game-state/`)

Each file contains DDA-specific samples at 5-second intervals:
```json
{
  "metadata": { ... },
  "sessions": [ DDASessionLog, ... ]
}
```

### `DDASessionLog`

```typescript
{
  startedAt: string,
  surface: string,
  playerCount: number,
  ddaEnabled: boolean,
  samples: DDASample[],     // every 5 seconds
  events: DDAEvent[],       // kills, deaths, level changes
  summary: DDASessionSummary
}
```

### `DDASample` (per 5 seconds)

```typescript
{
  t: number,               // seconds since session start
  players: [{
    score: number,         // composite performance score (0–1)
    level: number,         // DDA level (0–3)
    speed: number,         // speed multiplier (1.0–1.2)
    kr: number,            // kill rate (kills/min)
    dr: number,            // death rate (deaths/min)
    sr: number,            // score rate (score/min)
    kills: number,         // total kills
    deaths: number,        // total deaths
    buffs?: string[],      // ["type:stacks", ...]
    weapon?: string        // current weapon type
  }]
}
```

## Analysis

To generate an HTML report from collected telemetry:
```bash
node scripts/analyze-telemetry.mjs
# Options:
#   --since YYYY-MM-DD   Filter by date
#   --commit abc1234     Filter by commit prefix
#   --output path.html   Custom output path
```

Reports are written to `reports/telemetry-<timestamp>.html` and are committed to the repo (unlike raw session logs).

## Session Export Flow

```
Game plays → PerformanceLogger/DDALogger collect data in-memory
           → On session end (death / level complete / menu exit)
           → saveSession() → localStorage (browser)
           → exportLogsToServer() → POST /api/export-perf-logs
           → Server writes to logs/performance/ and logs/game-state/
           → Filenames include commit hash for correlation
```
