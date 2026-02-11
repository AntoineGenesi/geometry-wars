import { WavesMode } from './IGameMode';
import { KingMode } from './KingMode';
import { SniperMode } from './SniperMode';
import { RainbowMode } from './RainbowMode';
import { ClaustrophobiaMode } from './ClaustrophobiaMode';
import type { IGameMode } from './IGameMode';

export type { IGameMode, GameModeContext, ModeHUDData } from './IGameMode';
export { WavesMode } from './IGameMode';
export { KingMode } from './KingMode';
export { SniperMode } from './SniperMode';
export { RainbowMode } from './RainbowMode';
export { ClaustrophobiaMode } from './ClaustrophobiaMode';

/**
 * Available game mode types.
 */
export type QuickGameModeType = 'waves' | 'king' | 'sniper' | 'rainbow' | 'claustrophobia';

/**
 * Mode registry with metadata for UI.
 */
export const QUICK_GAME_MODES: Array<{
  type: QuickGameModeType;
  name: string;
  description: string;
  icon: string;
}> = [
  {
    type: 'waves',
    name: 'Waves',
    description: 'Standard endless waves. Survive as long as possible.',
    icon: '〰️',
  },
  {
    type: 'king',
    name: 'King',
    description: 'Dominate the safe zone for bonus points. Zone moves every 15s.',
    icon: '👑',
  },
  {
    type: 'sniper',
    name: 'Sniper',
    description: 'Limited ammo. Precision kills drop ammo. No bombs allowed.',
    icon: '🎯',
  },
  {
    type: 'rainbow',
    name: 'Rainbow',
    description: 'Match enemy colors for 3x score. Wrong color = 0.5x.',
    icon: '🌈',
  },
  {
    type: 'claustrophobia',
    name: 'Claustrophobia',
    description: 'Play area shrinks over time. Stay inside or die!',
    icon: '🔴',
  },
];

/**
 * Factory function to create mode instances.
 */
export function createGameMode(type: QuickGameModeType): IGameMode {
  switch (type) {
    case 'waves':
      return new WavesMode();
    case 'king':
      return new KingMode();
    case 'sniper':
      return new SniperMode();
    case 'rainbow':
      return new RainbowMode();
    case 'claustrophobia':
      return new ClaustrophobiaMode();
    default:
      console.warn(`[createGameMode] Unknown mode: ${type}, defaulting to Waves`);
      return new WavesMode();
  }
}
