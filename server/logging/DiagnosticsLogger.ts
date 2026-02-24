import fs from 'fs';
import path from 'path';

type LogEntry = Record<string, unknown>;

/**
 * Structured diagnostics logger for the Geometry Wars multiplayer server.
 *
 * Writes JSONL entries (one JSON object per line) to daily log files in
 * organized subdirectories:
 *   logs/connections/YYYY-MM-DD.jsonl  — player join/leave/connect events
 *   logs/performance/YYYY-MM-DD.jsonl  — per-game player stats (kills, deaths, score)
 *   logs/errors/YYYY-MM-DD.jsonl       — server errors and unexpected failures
 *
 * Non-blocking: all writes use fs.appendFile (async, fire-and-forget).
 * Logs rotate daily by date in filename. No PII — IPs are logged as-is
 * (LAN-only game, no public servers).
 */
export class DiagnosticsLogger {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    for (const sub of ['connections', 'performance', 'errors']) {
      try {
        fs.mkdirSync(path.join(baseDir, sub), { recursive: true });
      } catch {
        // Already exists or permission error — handled gracefully
      }
    }
  }

  /** Log a connection event (join, leave, upgrade, disconnect). */
  logConnection(entry: LogEntry): void {
    this.append('connections', entry);
  }

  /** Log a player performance event (game result, kills, deaths, score). */
  logPerformance(entry: LogEntry): void {
    this.append('performance', entry);
  }

  /** Log a server error. */
  logError(entry: LogEntry): void {
    this.append('errors', entry);
  }

  private append(subdir: string, entry: LogEntry): void {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filepath = path.join(this.baseDir, subdir, `${date}.jsonl`);
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n';
    // Non-blocking: fire-and-forget
    fs.appendFile(filepath, line, (_err) => { /* suppress write errors */ });
  }
}

export default DiagnosticsLogger;
