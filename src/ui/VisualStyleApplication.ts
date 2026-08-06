import type { Game } from '../core/Game';
import type { Surface } from '../surfaces/Surface';
import type { VisualPreset } from './VisualPlayground';
import type { VisualMode } from './VisualStyleSettings';

export function getAdjustedBloomStrength(baseStrength: number, visualMode: VisualMode): number {
  if (visualMode === 'pixelated') return Math.max(0, baseStrength * 0.4);
  if (visualMode === 'desktop-defender') return Math.max(0, baseStrength * 0.25);
  return baseStrength;
}

export interface ApplyVisualPresetOptions {
  game: Game;
  surface: Surface | null;
  preset: VisualPreset;
  visualMode: VisualMode;
  effectiveSurfaceOpacity: number;
  onGridOpacityApplied?: (opacity: number) => void;
}

export function applyVisualPresetToLiveGame(options: ApplyVisualPresetOptions): void {
  const { game, surface, preset, visualMode, effectiveSurfaceOpacity, onGridOpacityApplied } = options;
  const adjustedStrength = getAdjustedBloomStrength(preset.bloomStrength, visualMode);
  game.setBloomSettings(adjustedStrength, preset.bloomThreshold ?? 0.85);
  if (game.bloomPass && preset.bloomRadius !== undefined) {
    game.bloomPass.radius = preset.bloomRadius;
  }
  if (!surface) return;
  surface.setSurfaceOpacity(effectiveSurfaceOpacity);
  surface.setSurfaceColor(preset.surfaceColor);
  surface.setGridStyle({ color: preset.gridColor, opacity: preset.gridOpacity });
  onGridOpacityApplied?.(preset.gridOpacity);
  surface.mesh.visible = !preset.wireframeOnly || effectiveSurfaceOpacity > 0;
}
