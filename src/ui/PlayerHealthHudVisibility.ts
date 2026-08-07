export interface PlayerHealthHudVisibilityState {
  gameStarted: boolean;
  pvpEnabled: boolean;
}

export function shouldShowBottomPlayerHealthHud(state: PlayerHealthHudVisibilityState): boolean {
  return state.gameStarted && state.pvpEnabled;
}
