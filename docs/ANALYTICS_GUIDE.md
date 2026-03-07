# Analytics Dashboard — Usage Guide

The analytics dashboard (`reports/analytics-dashboard.html`) is a standalone HTML file that visualizes game performance, CPU profiling, DDA difficulty tuning, and commit regression data.

## Opening the Dashboard

Open `reports/analytics-dashboard.html` directly in any browser. No server required.

```bash
# From the project root:
xdg-open reports/analytics-dashboard.html   # Linux
open reports/analytics-dashboard.html        # macOS
# Or just double-click the file in Windows Explorer
```

## Importing Data

The dashboard supports two data sources:

### 1. localStorage (automatic)

When the game runs in a browser, it automatically saves performance and DDA data to `localStorage`:
- `gw_perf_log` — FPS, enemy count, player stats (sampled every 500ms)
- `gw3d_dda_sessions` — DDA difficulty levels, kills, events

When you open the dashboard in the **same browser** where you played the game, the data loads automatically. Click **Reload localStorage** to refresh after a new session.

### 2. File Import (drag and drop)

For cross-session analysis and commit comparison, import exported JSON files:

1. Export log files from the game (`F4` in-game, or automatic on game over)
2. Files appear in `logs/profiling/`, `logs/game-state/`, `logs/performance/`
3. Drag any `.json` files from these folders onto the **Import Log Files** drop zone in the Overview tab
4. Or click the drop zone to browse files

Each exported file contains a `gitCommitShort` hash in its metadata, enabling cross-commit comparison.

The dashboard auto-loads synthetic demo data via the **Load Synthetic Data** button to explore all features without real game data.

## What Each Tab Shows

### Overview Tab

- **Data source status** — which data sources are active (green = loaded)
- **Key metrics** — session count, average FPS, worst 1% FPS, DDA sessions, kills/deaths
- **FPS Stability Score** — percentage of samples above 30fps (green >90%, yellow >70%, red below)
- **Player Power Efficiency** — kill rate relative to player power level; shows % of sessions where player dominated the DDA system
- **Map FPS Breakdown** — average FPS per map type, sorted best to worst
- **CPU Hotspot Alerts** — any profiling scopes averaging over 5ms (danger if >10ms)
- **Recent Sessions Summary** — last 5 sessions with map, FPS, kills, deaths, score
- **FPS Over Time** chart — all sessions sorted chronologically
- **Import zone** — drag-drop JSON log files here

### CPU Profiling Tab

Requires imported profiling files (`logs/profiling/*.json`).

- **Frame Budget gauge** — average frame CPU time vs 16.67ms (60fps) target
- **Top 10 CPU Scopes** — horizontal bar chart sorted by average ms/frame
- **Detail Table** — all scopes with percentages and bar visualization
- **CPU Timeline** — stacked area chart showing how scope costs change over a session
- **Cross-Commit CPU Comparison** — grouped bar chart comparing scope costs across different git commits (visible when 2+ commits loaded)

### Gameplay & DDA Tab

- **Summary KPIs** — avg deaths/session, avg peak kill streak, avg DDA level, overpowered session count
- **Overpowered Alert** — shown when player power exceeds DDA difficulty in >50% of sessions
- **DDA Session selector** — pick a specific DDA session to analyze
- **Player Progression Timeline** — cumulative kills vs DDA level over time; red markers = deaths, stars = buff pickups
- **Power vs Difficulty Scatter** — each dot is a 500ms sample; points below the diagonal = player dominating
- **Kill Rate per 5-Minute Bucket** — bars = kills, line = power level; shows if DDA is keeping up
- **Kill Rate vs DDA Level** — average kill rate at each DDA assistance level
- **DDA Assistance Breakdown** — pie chart showing time spent at each DDA level
- **Buff Effectiveness** — kill rate delta when each buff type is active
- **Weapon Time/Kills charts** — time distribution and kills per weapon type
- **Game Events Table** — chronological list of kill/death/level-change events

### Commit Compare Tab

Requires imported profiling and performance files with git metadata.

- **Commit Performance Summary** — table of all loaded commits with FPS, frame time, top CPU consumer; REGRESSION badge if >10% slower than previous commit
- **FPS Trend by Date** — daily average FPS chart; red bars = regression days (>10% drop vs prior day)
- **Commit-over-Commit CPU Delta** — select two commits to compare all CPU scopes side by side; shows regression/improvement percentages and alerts
- **Gameplay Delta by Commit** — compares FPS, kill rate, death rate, session duration, DDA level between two commits
- **Export Snapshot** — downloads a static HTML snapshot with all charts frozen as images

## Using Filters

The global filter bar (below the tabs) applies to ALL tabs simultaneously:

- **Time Range** — filter by last 24h, 7 days, 30 days, or custom date range
- **Commit** — filter to sessions from a specific git commit (populated when imported files have commit metadata)
- **Map** — filter to sessions on a specific map type

When you change any filter, all visible charts re-render immediately.

## Tips

- **Load Synthetic Data** is the fastest way to see all dashboard features without playing the game
- The **Export Snapshot** button in the Commit Compare tab saves a static HTML file with all charts — useful for sharing with teammates
- Profiling files from different git commits enable the cross-commit CPU comparison in both the CPU tab and Commit Compare tab
- If localStorage is full, older sessions are automatically dropped (max 500 perf sessions, 10 DDA sessions)
