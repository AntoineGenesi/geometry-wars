/**
 * Performance data exporter with git version tagging.
 *
 * Exports performance and game-state data to the server for disk persistence.
 * Automatically includes git commit metadata for version tracking.
 */

import { PerformanceLogger } from '../core/PerformanceLogger';
import { DDALogger } from '../difficulty/DDALogger';
import { getGitVersion, type GitVersionInfo } from './GitVersion';

export interface ExportResult {
  success: boolean;
  results?: {
    performance?: { filepath: string };
    gameState?: { filepath: string };
  };
  error?: string;
}

/**
 * Export performance and DDA logs to the server.
 *
 * @param serverUrl - Base URL of the game server (e.g., 'http://localhost:2567')
 * @param includePerformance - Whether to export PerformanceLogger data
 * @param includeDDA - Whether to export DDALogger data
 * @returns Promise<ExportResult>
 */
export async function exportLogsToServer(
  serverUrl: string,
  includePerformance = true,
  includeDDA = true,
): Promise<ExportResult> {
  try {
    const gitInfo = getGitVersion();

    // Prepare payload
    const payload: {
      performanceData?: { sessions: unknown[]; metadata?: Record<string, unknown> };
      ddaData?: { sessions: unknown[]; metadata?: Record<string, unknown> };
      gitCommit?: GitVersionInfo;
    } = {};

    if (includePerformance) {
      const rawData = PerformanceLogger.exportAllAsJSON();
      const sessions = JSON.parse(rawData);
      payload.performanceData = {
        sessions,
        metadata: {
          exportedAt: new Date().toISOString(),
          sessionCount: sessions.length,
        },
      };
    }

    if (includeDDA) {
      const rawData = DDALogger.exportAll();
      const sessions = JSON.parse(rawData);
      payload.ddaData = {
        sessions,
        metadata: {
          exportedAt: new Date().toISOString(),
          sessionCount: sessions.length,
        },
      };
    }

    payload.gitCommit = gitInfo;

    // Send to server
    const response = await fetch(`${serverUrl}/api/export-perf-logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[PerformanceExporter] Failed to export logs:', message);
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Download logs as JSON files to the user's Downloads folder.
 * Fallback for when server export is unavailable.
 *
 * @param includePerformance - Whether to download PerformanceLogger data
 * @param includeDDA - Whether to download DDALogger data
 */
export function downloadLogsAsFiles(
  includePerformance = true,
  includeDDA = true,
): void {
  const gitInfo = getGitVersion();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const commitSuffix = gitInfo.commitShort !== 'unknown' ? `-${gitInfo.commitShort}` : '';
  const dirtySuffix = gitInfo.dirty ? '-dirty' : '';

  if (includePerformance) {
    const rawData = PerformanceLogger.exportAllAsJSON();
    const sessions = JSON.parse(rawData);
    const data = {
      metadata: {
        timestamp: new Date().toISOString(),
        gitCommit: gitInfo.commit,
        gitCommitShort: gitInfo.commitShort,
        gitBranch: gitInfo.branch,
        dirty: gitInfo.dirty,
        sessionCount: sessions.length,
      },
      sessions,
    };

    downloadJSON(
      data,
      `performance-${timestamp}${commitSuffix}${dirtySuffix}.json`,
    );
  }

  if (includeDDA) {
    const rawData = DDALogger.exportAll();
    const sessions = JSON.parse(rawData);
    const data = {
      metadata: {
        timestamp: new Date().toISOString(),
        gitCommit: gitInfo.commit,
        gitCommitShort: gitInfo.commitShort,
        gitBranch: gitInfo.branch,
        dirty: gitInfo.dirty,
        sessionCount: sessions.length,
      },
      sessions,
    };

    downloadJSON(
      data,
      `game-state-${timestamp}${commitSuffix}${dirtySuffix}.json`,
    );
  }
}

/**
 * Helper: trigger browser download of JSON data.
 */
function downloadJSON(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
