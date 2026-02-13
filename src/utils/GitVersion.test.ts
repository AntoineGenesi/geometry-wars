/**
 * Tests for GitVersion utility.
 */

import { describe, it, expect } from 'vitest';
import { formatGitVersion, type GitVersionInfo } from './GitVersion';

describe('GitVersion', () => {
  // Note: getGitVersion() relies on browser window.location or build-time injected globals.
  // Testing it requires either jsdom or mocking global state, which adds complexity.
  // For now, we test the pure functions (formatGitVersion) that don't depend on globals.

  describe('formatGitVersion', () => {
    it('should format clean version correctly', () => {
      const info: GitVersionInfo = {
        commit: '5fd7a8124a4e8a5ad57ac1c614954ac7d7aa305e',
        commitShort: '5fd7a81',
        branch: 'main',
        dirty: false,
      };

      const formatted = formatGitVersion(info);

      expect(formatted).toBe('5fd7a81 (main)');
    });

    it('should include dirty flag in format', () => {
      const info: GitVersionInfo = {
        commit: '5fd7a8124a4e8a5ad57ac1c614954ac7d7aa305e',
        commitShort: '5fd7a81',
        branch: 'feature/perf',
        dirty: true,
      };

      const formatted = formatGitVersion(info);

      expect(formatted).toBe('5fd7a81-dirty (feature/perf)');
    });

    it('should use default git version when no info provided', () => {
      const formatted = formatGitVersion();

      expect(formatted).toMatch(/unknown/);
    });
  });
});
