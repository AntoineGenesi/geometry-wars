import fs from 'fs';
import path from 'path';

/**
 * Simple logger that writes to both console and a log file.
 * Ensures logs survive server crashes and terminal closes.
 */
class Logger {
  private logFile: fs.WriteStream;
  private logPath: string;

  constructor(logFilePath: string) {
    this.logPath = logFilePath;

    // Ensure logs directory exists
    const logsDir = path.dirname(logFilePath);
    fs.mkdirSync(logsDir, { recursive: true });

    // Create write stream in append mode (survives restarts)
    this.logFile = fs.createWriteStream(logFilePath, { flags: 'a' });

    // Handle write stream errors gracefully
    this.logFile.on('error', (err) => {
      console.error('[Logger] Write stream error:', err.message);
    });
  }

  /**
   * Log a message to both console and file.
   * Arguments are formatted the same way as console.log.
   */
  log(...args: unknown[]): void {
    // Format message the same way console.log would
    const message = args
      .map((arg) => {
        if (typeof arg === 'string') {
          return arg;
        }
        return JSON.stringify(arg);
      })
      .join(' ');

    // Write to console first (so user sees it immediately)
    console.log(...args);

    // Write to file with timestamp
    const timestamp = new Date().toISOString();
    this.logFile.write(`[${timestamp}] ${message}\n`);
  }

  /**
   * Log an error message to both console and file.
   * Arguments are formatted the same way as console.error.
   */
  error(...args: unknown[]): void {
    // Format message the same way console.error would
    const message = args
      .map((arg) => {
        if (typeof arg === 'string') {
          return arg;
        }
        return JSON.stringify(arg);
      })
      .join(' ');

    // Write to console first (so user sees it immediately)
    console.error(...args);

    // Write to file with timestamp
    const timestamp = new Date().toISOString();
    this.logFile.write(`[${timestamp}] ERROR: ${message}\n`);
  }

  /**
   * Get the path to the log file.
   */
  getLogPath(): string {
    return this.logPath;
  }

  /**
   * Flush any pending writes and close the log file.
   */
  close(): void {
    return new Promise<void>((resolve) => {
      this.logFile.end(() => resolve());
    }) as unknown as void;
  }
}

export default Logger;
