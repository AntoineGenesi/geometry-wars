export type BlackHolePhase = 'formation' | 'sustain' | 'collapse' | 'expired';

export interface BlackHoleConfig {
  duration: number;
  formationDuration: number;
  collapseDuration: number;
  maxRadius: number;
  captureLimit: number;
  maxPullSpeed: number;
  spiralRatio: number;
  damagePerSecond: number;
  damageCadence: number;
  collapseRadius: number;
  collapseDamage: number;
  isEternalCollapse: boolean;
}

export interface BlackHoleState {
  phase: BlackHolePhase;
  phaseProgress: number;
  radius: number;
  pullScale: number;
}

export interface BlackHoleModelInput {
  activeNodes?: ReadonlySet<string>;
  masteryLevel5?: boolean;
}

export const BLACK_HOLE_BASE_DURATION = 3;
export const BLACK_HOLE_FORMATION_DURATION = 0.25;
export const BLACK_HOLE_COLLAPSE_DURATION = 0.5;
export const BLACK_HOLE_BASE_RADIUS = 5;
export const BLACK_HOLE_BASE_CAPTURE_LIMIT = 8;
export const BLACK_HOLE_MASS_CAPTURE_LIMIT = 12;
export const BLACK_HOLE_DAMAGE_CADENCE = 0.25;

function has(nodes: ReadonlySet<string>, id: string): boolean {
  return nodes.has(id);
}

export function createBlackHoleConfig(input: BlackHoleModelInput = {}): BlackHoleConfig {
  const nodes = input.activeNodes ?? new Set<string>();
  const masteryLevel5 = input.masteryLevel5 === true;
  const durationBonus =
    (has(nodes, 'black_hole_a_1') ? 0.30 : 0) +
    (has(nodes, 'black_hole_a_2') ? 0.60 : 0) +
    (has(nodes, 'black_hole_a_3') ? 1.00 : 0) +
    (has(nodes, 'black_hole_al_5') ? 1.50 : 0) +
    (has(nodes, 'black_hole_ar_4') ? 2.00 : 0);
  const pullBonus =
    (has(nodes, 'black_hole_b_1') ? 0.30 : 0) +
    (has(nodes, 'black_hole_b_2') ? 0.60 : 0) +
    (has(nodes, 'black_hole_b_3') ? 1.00 : 0) +
    (has(nodes, 'black_hole_br_5') ? 1.50 : 0);
  const giantVoidScale = has(nodes, 'black_hole_ar_4') || has(nodes, 'black_hole_ar_5') ? 1.4 : 1;
  const isEternalCollapse = has(nodes, 'black_hole_ar_5');
  const baseDuration = masteryLevel5 ? 4.5 : BLACK_HOLE_BASE_DURATION;
  const radius = BLACK_HOLE_BASE_RADIUS * (1 + pullBonus) * giantVoidScale;

  return {
    duration: isEternalCollapse ? 999 : baseDuration * (1 + durationBonus),
    formationDuration: BLACK_HOLE_FORMATION_DURATION,
    collapseDuration: BLACK_HOLE_COLLAPSE_DURATION,
    maxRadius: radius,
    captureLimit: has(nodes, 'black_hole_bl_4') || has(nodes, 'black_hole_bl_5')
      ? BLACK_HOLE_MASS_CAPTURE_LIMIT
      : BLACK_HOLE_BASE_CAPTURE_LIMIT,
    maxPullSpeed: 3.5 * (masteryLevel5 ? 1.3 : 1),
    spiralRatio: 0.22,
    damagePerSecond: has(nodes, 'black_hole_br_5')
      ? 10
      : has(nodes, 'black_hole_br_4')
        ? 5
        : 2,
    damageCadence: BLACK_HOLE_DAMAGE_CADENCE,
    collapseRadius: radius * 0.55,
    collapseDamage: masteryLevel5 || isEternalCollapse ? 20 : 8,
    isEternalCollapse,
  };
}

export function getBlackHoleState(
  elapsed: number,
  config: BlackHoleConfig,
  duration = config.duration,
): BlackHoleState {
  if (elapsed >= duration) {
    return { phase: 'expired', phaseProgress: 1, radius: 0, pullScale: 0 };
  }

  if (elapsed < config.formationDuration) {
    const progress = Math.max(0, elapsed / config.formationDuration);
    const eased = 1 - Math.pow(1 - progress, 3);
    return {
      phase: 'formation',
      phaseProgress: progress,
      radius: config.maxRadius * eased,
      pullScale: progress,
    };
  }

  const collapseStart = Math.max(config.formationDuration, duration - config.collapseDuration);
  if (elapsed >= collapseStart) {
    const progress = Math.min(1, (elapsed - collapseStart) / Math.max(0.001, duration - collapseStart));
    return {
      phase: 'collapse',
      phaseProgress: progress,
      radius: config.maxRadius * (1 - 0.65 * progress),
      pullScale: 1 - progress,
    };
  }

  return { phase: 'sustain', phaseProgress: 1, radius: config.maxRadius, pullScale: 1 };
}

export function getBlackHolePullSpeed(distance: number, radius: number, maxPullSpeed: number): number {
  if (radius <= 0 || distance >= radius) return 0;
  const normalizedDistance = Math.max(0, Math.min(1, distance / radius));
  const falloff = 0.25 + 0.75 * Math.pow(1 - normalizedDistance, 1.5);
  return maxPullSpeed * falloff;
}

export function getBlackHoleDamageTickCount(
  previousElapsed: number,
  elapsed: number,
  config: BlackHoleConfig,
  duration = config.duration,
): number {
  const damageStart = config.formationDuration;
  const damageEnd = Math.max(damageStart, duration - config.collapseDuration);
  const previous = Math.max(damageStart, Math.min(previousElapsed, damageEnd));
  const current = Math.max(damageStart, Math.min(elapsed, damageEnd));
  return Math.max(
    0,
    Math.floor((current - damageStart + 1e-9) / config.damageCadence)
      - Math.floor((previous - damageStart + 1e-9) / config.damageCadence),
  );
}

