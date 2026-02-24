# Performance Graphs Integration Guide

## Overview

This document explains how to integrate the new performance logging and graphing system into the game. The system provides:

1. **Enhanced Debug Overlay (F4)** - Shows enemy type breakdown at min/max FPS moments
2. **Interactive Performance Graphs** - Plotly-style charts accessible from pause menu
3. **Per-game session logging** - Stores performance data in localStorage
4. **10-game counter** - Triggers notification for research report generation

## Files Created

- `src/core/PerformanceLogger.ts` - Ring buffer data collection + localStorage persistence
- `src/ui/PerformanceGraphs.ts` - Canvas-based interactive charting (no external deps)

## Files Modified

- `src/core/PerformanceTracker.ts` - Added enemy type tracking to PerfMoment snapshots
- `src/ui/DebugOverlay.ts` - Enemy type tooltip on entity count hover
- `src/ui/PauseMenu.ts` - Added "Performance Graphs" button + modal

## Integration Steps

### 1. Add PerformanceLogger to main.ts

After the PerformanceTracker initialization (around line 679):

```typescript
import { PerformanceLogger } from './core/PerformanceLogger';

// Existing code:
const perfTracker = new PerformanceTracker(surfaceType);
const debugOverlay = new DebugOverlay(perfTracker);

// ADD THIS:
const perfLogger = new PerformanceLogger(surfaceType);
```

### 2. Update game loop to track enemy types

In the game loop (around line 2009), replace:

```typescript
// OLD:
perfTracker.setEntityCount(enemySpawner.getActiveCount());
perfTracker.setBulletCount(bulletPool.activeCount);
perfTracker.recordFrame(frameDt);
```

With:

```typescript
// NEW:
const enemyCount = enemySpawner.getActiveCount();
const bulletCount = bulletPool.activeCount;

// Count enemy types
const enemyTypes = new Map<EnemyType, number>();
for (const enemy of enemySpawner.getEnemies()) {
  const typeName = enemy.constructor.name.toLowerCase() as EnemyType;
  enemyTypes.set(typeName, (enemyTypes.get(typeName) || 0) + 1);
}

// Update trackers
perfTracker.setEntityCount(enemyCount);
perfTracker.setBulletCount(bulletCount);
perfTracker.setEnemyTypes(enemyTypes);
perfTracker.recordFrame(frameDt);

// Update logger
perfLogger.setFrameData(perfTracker.fps, enemyCount, bulletCount);
perfLogger.setEnemyTypes(enemyTypes);
perfLogger.recordFrame(frameDt);
```

### 3. Pass PerformanceLogger to PauseMenu

When creating the PauseMenu (around line 565):

```typescript
// ADD THIS after pauseMenu creation:
pauseMenu.setPerformanceLogger(perfLogger);
```

### 4. Save session on game end

In `perfTracker.saveSession()` calls (lines 814, 1362), also add:

```typescript
perfTracker.saveSession();
const shouldShowReport = perfLogger.saveSession();
if (shouldShowReport) {
  console.log('10 games completed! Performance report data available.');
  // TODO: Show in-game notification
}
```

## Usage

### For Players

1. **F4** - Toggle debug overlay
   - Click "TOP 10" to expand detailed performance moments
   - Hover over entity counts to see enemy type breakdown

2. **ESC** - Pause game
   - Click "PERFORMANCE GRAPHS" button
   - Interactive charts:
     - **FPS tab** - FPS over time with min/max markers
     - **Enemies tab** - Enemy count over time
     - **Bullets tab** - Bullet count over time
     - **Enemy Types tab** - Stacked area chart of enemy type distribution
   - Mouse wheel to zoom, drag to pan, hover for tooltips

3. **10-game counter** - After 10 completed games, a notification appears suggesting performance analysis

### For Developers

```typescript
// Access stored session data
const logger = new PerformanceLogger('sphere');
const sessions = logger.loadAllSessions();

// Analyze performance trends
for (const session of sessions) {
  console.log(`Map: ${session.mapType}, Duration: ${session.duration}s`);
  console.log(`Data points: ${session.dataPoints.length}`);
  // ... analyze session.dataPoints for correlations
}

// Clear data
PerformanceLogger.clearAllSessions();

// Reset game counter
PerformanceLogger.resetGameCounter();
```

## Performance Characteristics

- **Zero-GC ring buffer** - Pre-allocated 3600-element array (30 min @ 500ms sampling)
- **localStorage persistence** - Keeps last 10 game sessions
- **Canvas-based rendering** - No external charting library dependencies
- **Interactive graphs** - Zoom/pan without re-rendering entire dataset

## Future Enhancements

1. **Research report generation** - Aggregate analysis after 10 games
2. **Export to CSV** - Download performance data for external analysis
3. **Real-time correlation metrics** - "FPS drops most correlated with X enemy type"
4. **Performance recommendations** - "Consider reducing bloom strength on this GPU tier"

## Troubleshooting

### No data in graphs
- Ensure `perfLogger.recordFrame()` is called in the game loop
- Check that `setFrameData()` and `setEnemyTypes()` are called before `recordFrame()`

### localStorage full
- The system auto-trims to 10 most recent sessions
- Call `PerformanceLogger.clearAllSessions()` to manually clear

### Graph performance issues
- Canvas rendering is optimized for 3600 data points (30 min)
- If graphs lag, reduce RING_BUFFER_SIZE in PerformanceLogger.ts
