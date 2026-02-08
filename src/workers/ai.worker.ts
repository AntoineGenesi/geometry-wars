/**
 * Web Worker for enemy AI computation.
 *
 * Receives enemy data (positions, types, speeds, surface coords) and player
 * positions via SharedArrayBuffer. Computes movement deltas (du, dv) for each
 * enemy based on type-specific AI behavior. Writes results back to shared
 * output buffer.
 *
 * AI behaviors are simplified versions of the full enemy classes -- enough to
 * compute movement vectors without Three.js or DOM dependencies.
 *
 * Exported as pure functions for main-thread fallback and testing.
 */

import {
  EnemyType,
  AI_OUTPUT_STRIDE,
  type EntityBufferLayout,
  type AIOutputLayout,
  getEntityViews,
  getAIOutputViews,
} from './shared-buffers';

// ---------------------------------------------------------------------------
// Per-enemy AI state (worker-local, persists across frames)
// ---------------------------------------------------------------------------

interface EnemyAIState {
  momentumU: number;
  momentumV: number;
  directionU: number;
  directionV: number;
  directionChangeTimer: number;
  nextDirectionChange: number;
  currentSpeed: number;
  phase: number;
  phaseTimer: number;
}

const enemyStates: Map<number, EnemyAIState> = new Map();

function getOrCreateState(index: number): EnemyAIState {
  let state = enemyStates.get(index);
  if (!state) {
    const angle = Math.random() * Math.PI * 2;
    state = {
      momentumU: 0,
      momentumV: 0,
      directionU: Math.cos(angle),
      directionV: Math.sin(angle),
      directionChangeTimer: 0,
      nextDirectionChange: 1 + Math.random(),
      currentSpeed: 0.02,
      phase: 0,
      phaseTimer: 0,
    };
    enemyStates.set(index, state);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Type-specific AI functions (pure math, no Three.js)
// ---------------------------------------------------------------------------

function aiGrunt(
  su: number, sv: number, pu: number, pv: number, speed: number, dt: number, state: EnemyAIState,
): { du: number; dv: number } {
  // Accelerating chase toward player
  state.currentSpeed = Math.min(0.06, state.currentSpeed + 0.002 * dt);
  const deltaU = pu - su;
  const deltaV = pv - sv;
  const dist = Math.sqrt(deltaU * deltaU + deltaV * deltaV);
  if (dist < 0.001) return { du: 0, dv: 0 };
  const dirU = deltaU / dist;
  const dirV = deltaV / dist;
  return { du: dirU * state.currentSpeed * dt, dv: dirV * state.currentSpeed * dt };
}

function aiWeaver(
  su: number, sv: number, pu: number, pv: number, speed: number, dt: number, state: EnemyAIState,
): { du: number; dv: number } {
  const friction = 0.92;
  const acceleration = 0.3;
  const deltaU = pu - su;
  const deltaV = pv - sv;
  const dist = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

  if (dist > 0.01) {
    state.momentumU += (deltaU / dist) * acceleration * dt;
    state.momentumV += (deltaV / dist) * acceleration * dt;
  }

  state.momentumU *= friction;
  state.momentumV *= friction;

  // Limit speed
  const currentSpeed = Math.sqrt(state.momentumU * state.momentumU + state.momentumV * state.momentumV);
  if (currentSpeed > speed) {
    const scale = speed / currentSpeed;
    state.momentumU *= scale;
    state.momentumV *= scale;
  }

  return { du: state.momentumU * dt, dv: state.momentumV * dt };
}

function aiWanderer(
  su: number, sv: number, _pu: number, _pv: number, speed: number, dt: number, state: EnemyAIState,
): { du: number; dv: number } {
  state.directionChangeTimer += dt;
  if (state.directionChangeTimer >= state.nextDirectionChange) {
    const angle = Math.random() * Math.PI * 2;
    state.directionU = Math.cos(angle);
    state.directionV = Math.sin(angle);
    state.directionChangeTimer = 0;
    state.nextDirectionChange = 1 + Math.random();
  }

  let du = state.directionU * speed * dt;
  let dv = state.directionV * speed * dt;

  // Bounce off boundaries
  const newU = su + du;
  const newV = sv + dv;
  if (newU <= 0 || newU >= 1) {
    state.directionU *= -1;
    du = state.directionU * speed * dt;
  }
  if (newV <= 0 || newV >= 1) {
    state.directionV *= -1;
    dv = state.directionV * speed * dt;
  }

  return { du, dv };
}

function aiSpinner(
  su: number, sv: number, pu: number, pv: number, speed: number, dt: number, _state: EnemyAIState,
): { du: number; dv: number } {
  // Chase player with wobble
  const wobbleU = (Math.random() - 0.5) * 0.15;
  const wobbleV = (Math.random() - 0.5) * 0.15;
  const targetU = pu + wobbleU;
  const targetV = pv + wobbleV;
  const deltaU = targetU - su;
  const deltaV = targetV - sv;
  const dist = Math.sqrt(deltaU * deltaU + deltaV * deltaV);
  if (dist < 0.01) return { du: 0, dv: 0 };
  return { du: (deltaU / dist) * speed * dt, dv: (deltaV / dist) * speed * dt };
}

function aiSnake(
  su: number, sv: number, pu: number, pv: number, speed: number, dt: number, state: EnemyAIState,
): { du: number; dv: number } {
  state.phaseTimer += 2 * dt; // sineFrequency = 2
  const deltaU = pu - su;
  const deltaV = pv - sv;
  const dist = Math.sqrt(deltaU * deltaU + deltaV * deltaV);
  if (dist < 0.01) return { du: 0, dv: 0 };
  const dirU = deltaU / dist;
  const dirV = deltaV / dist;
  const perpU = -dirV;
  const perpV = dirU;
  const sineOffset = Math.sin(state.phaseTimer) * 0.4;
  return {
    du: (dirU + perpU * sineOffset) * speed * dt,
    dv: (dirV + perpV * sineOffset) * speed * dt,
  };
}

function aiRocket(
  su: number, sv: number, _pu: number, _pv: number, speed: number, dt: number, state: EnemyAIState,
): { du: number; dv: number } {
  let du = state.directionU * speed * dt;
  let dv = state.directionV * speed * dt;

  const newU = su + du;
  const newV = sv + dv;
  if (newU <= 0 || newU >= 1) {
    state.directionU = newU <= 0 ? Math.abs(state.directionU) : -Math.abs(state.directionU);
    du = state.directionU * speed * dt;
  }
  if (newV <= 0 || newV >= 1) {
    state.directionV = newV <= 0 ? Math.abs(state.directionV) : -Math.abs(state.directionV);
    dv = state.directionV * speed * dt;
  }

  return { du, dv };
}

function aiRepulsor(
  su: number, sv: number, pu: number, pv: number, speed: number, dt: number, state: EnemyAIState,
): { du: number; dv: number } {
  // 3-phase: Lock -> Charge -> Recovery
  state.phaseTimer += dt;

  switch (state.phase) {
    case 0: { // Lock
      if (state.phaseTimer >= 1.5) {
        state.directionU = pu; // Store charge target
        state.directionV = pv;
        state.phase = 1;
        state.phaseTimer = 0;
      }
      return { du: 0, dv: 0 };
    }
    case 1: { // Charge
      const deltaU = state.directionU - su;
      const deltaV = state.directionV - sv;
      const dist = Math.sqrt(deltaU * deltaU + deltaV * deltaV);
      if (dist < 0.1) {
        state.phase = 2;
        state.phaseTimer = 0;
        return { du: 0, dv: 0 };
      }
      const chargeSpeed = 0.1875;
      return { du: (deltaU / dist) * chargeSpeed * dt, dv: (deltaV / dist) * chargeSpeed * dt };
    }
    case 2: { // Recovery
      if (state.phaseTimer >= 2) {
        state.phase = 0;
        state.phaseTimer = 0;
      }
      return { du: 0, dv: 0 };
    }
    default:
      return { du: 0, dv: 0 };
  }
}

function aiGravityWell(
  _su: number, _sv: number, _pu: number, _pv: number, speed: number, dt: number, _state: EnemyAIState,
): { du: number; dv: number } {
  // Slow drift
  const driftAngle = Date.now() * 0.0001;
  return {
    du: Math.cos(driftAngle) * speed * dt,
    dv: Math.sin(driftAngle) * speed * dt,
  };
}

function aiDefault(
  su: number, sv: number, pu: number, pv: number, speed: number, dt: number, _state: EnemyAIState,
): { du: number; dv: number } {
  // Default chase toward player
  const deltaU = pu - su;
  const deltaV = pv - sv;
  const dist = Math.sqrt(deltaU * deltaU + deltaV * deltaV);
  if (dist < 0.001) return { du: 0, dv: 0 };
  return { du: (deltaU / dist) * speed * dt, dv: (deltaV / dist) * speed * dt };
}

// ---------------------------------------------------------------------------
// AI dispatch table
// ---------------------------------------------------------------------------

type AIFunction = (
  su: number, sv: number, pu: number, pv: number, speed: number, dt: number, state: EnemyAIState,
) => { du: number; dv: number };

const AI_FUNCTIONS: Record<number, AIFunction> = {
  [EnemyType.Grunt]: aiGrunt,
  [EnemyType.TitanGrunt]: aiGrunt,
  [EnemyType.Weaver]: aiWeaver,
  [EnemyType.TitanWeaver]: aiWeaver,
  [EnemyType.Wanderer]: aiWanderer,
  [EnemyType.GiantWanderer]: aiWanderer,
  [EnemyType.Spinner]: aiSpinner,
  [EnemyType.TitanSpinner]: aiSpinner,
  [EnemyType.SpinnerSpawn]: aiSpinner,
  [EnemyType.Snake]: aiSnake,
  [EnemyType.GiantSnake]: aiSnake,
  [EnemyType.Rocket]: aiRocket,
  [EnemyType.GiantRocket]: aiRocket,
  [EnemyType.Repulsor]: aiRepulsor,
  [EnemyType.GravityWell]: aiGravityWell,
};

// ---------------------------------------------------------------------------
// Pure AI computation function (usable in worker or main thread)
// ---------------------------------------------------------------------------

export interface AIInput {
  surfaceU: Float32Array;
  surfaceV: Float32Array;
  types: Uint8Array;
  speeds: Float32Array;
  count: number;
  playerU: number;
  playerV: number;
  dt: number;
}

export interface AIOutput {
  deltas: Float32Array;
  ready: Int32Array;
}

/**
 * Compute AI movement deltas for all enemies. Pure function.
 * Writes du/dv directly into output.deltas, sets output.ready to 1.
 */
export function runAIComputation(input: AIInput, output: AIOutput): void {
  const { surfaceU, surfaceV, types, speeds, count, playerU, playerV, dt } = input;

  for (let i = 0; i < count; i++) {
    const type = types[i];
    const aiFn = AI_FUNCTIONS[type] ?? aiDefault;
    const state = getOrCreateState(i);

    const { du, dv } = aiFn(surfaceU[i], surfaceV[i], playerU, playerV, speeds[i], dt, state);

    const offset = i * AI_OUTPUT_STRIDE;
    output.deltas[offset] = du;
    output.deltas[offset + 1] = dv;
  }

  Atomics.store(output.ready, 0, 1);
}

/**
 * Reset AI state (call when entities are respawned/removed).
 */
export function resetAIState(): void {
  enemyStates.clear();
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

export interface AIWorkerMessage {
  type: 'run';
  entityBuffer: EntityBufferLayout;
  aiOutput: AIOutputLayout;
  playerU: number;
  playerV: number;
  dt: number;
}

export interface AIWorkerResponse {
  type: 'done';
}

// Only attach listener in Worker context
if (typeof self !== 'undefined' && typeof (self as any).WorkerGlobalScope !== 'undefined') {
  self.onmessage = (e: MessageEvent<AIWorkerMessage>) => {
    if (e.data.type === 'run') {
      const views = getEntityViews(e.data.entityBuffer);
      const aiViews = getAIOutputViews(e.data.aiOutput);

      runAIComputation(
        {
          surfaceU: views.surfaceU,
          surfaceV: views.surfaceV,
          types: views.types,
          speeds: views.speeds,
          count: e.data.entityBuffer.count,
          playerU: e.data.playerU,
          playerV: e.data.playerV,
          dt: e.data.dt,
        },
        {
          deltas: aiViews.deltas,
          ready: aiViews.ready,
        },
      );

      (self as any).postMessage({ type: 'done' } satisfies AIWorkerResponse);
    }
  };
}
