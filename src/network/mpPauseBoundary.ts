export type RoomPhaseName = 'lobby' | 'voting' | 'playing' | string;

export interface MatchBoundaryPauseClearPlan {
  isPaused: false;
  lastAuthoritativePaused: false;
  pausedByName: '';
  isInLookMode: false;
  localMenuOpen: false;
  lastPauseRevision: number;
  touchGamePaused: boolean;
}

/**
 * Shared match-boundary pause cleanup policy for the MP browser client.
 * The live entrypoint owns DOM/game side effects; this pure helper keeps the
 * revision and touch-routing rules deterministic and unit-testable.
 */
export function planMatchBoundaryPauseUiClear(
  currentRoomPhase: RoomPhaseName,
  lastPauseRevision: number,
  authoritativePauseRevision?: number,
): MatchBoundaryPauseClearPlan {
  return {
    isPaused: false,
    lastAuthoritativePaused: false,
    pausedByName: '',
    isInLookMode: false,
    localMenuOpen: false,
    lastPauseRevision: authoritativePauseRevision === undefined
      ? lastPauseRevision
      : Math.max(lastPauseRevision, authoritativePauseRevision),
    touchGamePaused: currentRoomPhase !== 'playing',
  };
}
