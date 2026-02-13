/**
 * Git version metadata utilities for tagging performance logs.
 *
 * Captures git commit info at module load time to ensure it's available
 * for export operations throughout the session.
 */

export interface GitVersionInfo {
  /** Full commit hash (40 chars). */
  commit: string;
  /** Short commit hash (7 chars). */
  commitShort: string;
  /** Current branch name. */
  branch: string;
  /** Whether there are uncommitted changes. */
  dirty: boolean;
}

/**
 * Get git version info from the build-time injected global.
 * Falls back to unknown values if not available.
 */
export function getGitVersion(): GitVersionInfo {
  // In production builds, Vite can inject these via define plugin
  // In dev mode, we'll try to fetch from server or use defaults

  // @ts-ignore - injected by build system
  const injected = typeof __GIT_VERSION__ !== 'undefined' ? __GIT_VERSION__ : null;

  if (injected) {
    return injected as GitVersionInfo;
  }

  // Development fallback - try to get from URL params (for testing)
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const commit = params.get('git_commit');
    const branch = params.get('git_branch');

    if (commit) {
      return {
        commit,
        commitShort: commit.slice(0, 7),
        branch: branch || 'unknown',
        dirty: params.get('git_dirty') === 'true',
      };
    }
  }

  // Final fallback
  return {
    commit: 'unknown',
    commitShort: 'unknown',
    branch: 'unknown',
    dirty: false,
  };
}

/**
 * Format git version as a short string for display.
 * Example: "5fd7a81 (main)" or "5fd7a81-dirty (feature/perf)"
 */
export function formatGitVersion(info: GitVersionInfo = getGitVersion()): string {
  const dirtyFlag = info.dirty ? '-dirty' : '';
  return `${info.commitShort}${dirtyFlag} (${info.branch})`;
}
