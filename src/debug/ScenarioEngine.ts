/**
 * ScenarioEngine — Timeline-based scenario runner for automated game testing.
 *
 * Lives in the game process (not Puppeteer). Exposes window.__SCENARIO_ENGINE.
 * Consumed by TestHarnessAPI.runScenario() and the Puppeteer scenario-runner.mjs.
 *
 * Scenarios define steps with frame/time triggers, actions, and assertions.
 * Each step is executed when the game clock reaches the specified trigger.
 */

import type { TestHarnessAPI } from './TestHarnessAPI';
import type { StateRecorder } from './StateRecorder';

// ---------------------------------------------------------------------------
// Scenario type definitions (JSON-serializable for Puppeteer → page.evaluate)
// ---------------------------------------------------------------------------

export type ActionType =
  | { type: 'spawnEnemy'; enemyType: string; u: number; v: number; id?: string }
  | { type: 'moveEnemy'; id: string; targetU: number; targetV: number; speed: number }
  | { type: 'clearEnemies' }
  | { type: 'setPlayerPos'; u: number; v: number }
  | { type: 'fireWeapon' }
  | { type: 'equipWeapon'; weapon: string }
  | { type: 'spawnPickup'; pickupType: string; u: number; v: number }
  | { type: 'pressKey'; key: string; duration?: number }
  | { type: 'wait'; frames?: number; seconds?: number }
  | { type: 'screenshot'; label: string }
  | { type: 'checkpoint'; label: string }
  | { type: 'observe'; duration: number }
  | { type: 'custom'; fn: string };

export type AssertionType =
  | { type: 'playerAlive' }
  | { type: 'playerDead' }
  | { type: 'enemyCount'; op: '=' | '>' | '<' | '>=' | '<='; value: number }
  | { type: 'enemyAt'; id: string; u: number; v: number; tolerance: number }
  | { type: 'playerAt'; u: number; v: number; tolerance: number }
  | { type: 'bulletCount'; op: string; value: number }
  | { type: 'pickupCount'; op: string; value: number }
  | { type: 'scoreAbove'; value: number }
  | { type: 'fpsAbove'; value: number }
  | { type: 'noDeathsSince'; label: string }
  | { type: 'deathOccurred' }
  | { type: 'damageOccurred'; source?: string }
  | { type: 'weaponIs'; weapon: string }
  | { type: 'custom'; fn: string };

export interface ScenarioStep {
  /** Frame number OR seconds (prefix with 't:') when this step executes. Omit to run in order. */
  at?: number | string;
  action: ActionType;
  assert?: AssertionType;
  label?: string;
}

export interface ScenarioSetup {
  surface?: string;
  mode?: string;
  weapon?: string;
  playerPos?: [number, number];
  enemies?: Array<{ type: string; u: number; v: number }>;
  pickups?: Array<{ type: string; u: number; v: number }>;
}

export interface Scenario {
  name: string;
  description: string;
  setup?: ScenarioSetup;
  steps: ScenarioStep[];
  teardown?: ActionType[];
}

export interface StepResult {
  stepIndex: number;
  label: string;
  frame: number;
  time: number;
  actionExecuted: boolean;
  assertionPassed: boolean | null;
  assertionError?: string;
}

export interface ScenarioResult {
  scenarioName: string;
  passed: boolean;
  totalSteps: number;
  stepResults: StepResult[];
  startFrame: number;
  endFrame: number;
  startTime: number;
  endTime: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// ScenarioEngine
// ---------------------------------------------------------------------------

export class ScenarioEngine {
  private api: TestHarnessAPI;
  private recorder: StateRecorder;

  // Registered custom functions (name → function body string or actual function)
  private readonly customFns = new Map<string, (api: TestHarnessAPI) => boolean | void>();

  // Checkpoint frame map (label → frame when checkpoint was placed)
  private readonly checkpoints = new Map<string, number>();

  // Currently running scenario state
  private running = false;
  private currentScenario: Scenario | null = null;
  private currentStepIndex = 0;
  private stepResults: StepResult[] = [];
  private scenarioStartFrame = 0;
  private scenarioStartTime = 0;

  // Pending wait state
  private waitUntilFrame: number | null = null;
  private waitUntilTime: number | null = null;

  // Pending key press state
  private pendingKeyReleases: Array<{ key: string; releaseAtTime: number }> = [];

  // Resolve callback for async runScenario
  private resolveScenario: ((result: ScenarioResult) => void) | null = null;

  // Map of spawned enemy IDs (named by scenario → actual TestHarnessAPI ID)
  private readonly spawnedEnemyIds = new Map<string, string>();

  constructor(api: TestHarnessAPI, recorder: StateRecorder) {
    this.api = api;
    this.recorder = recorder;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Register a custom function by name (for 'custom' actions/assertions). */
  registerCustomFn(name: string, fn: (api: TestHarnessAPI) => boolean | void): void {
    this.customFns.set(name, fn);
  }

  /** Run a scenario. Returns a promise that resolves with the result. */
  runScenario(scenario: Scenario): Promise<ScenarioResult> {
    return new Promise((resolve) => {
      if (this.running) {
        resolve({
          scenarioName: scenario.name, passed: false, totalSteps: 0, stepResults: [],
          startFrame: 0, endFrame: 0, startTime: 0, endTime: 0,
          summary: 'Engine busy — another scenario is running',
        });
        return;
      }

      const state = this.api.getGameState();
      this.currentScenario = scenario;
      this.currentStepIndex = 0;
      this.stepResults = [];
      this.spawnedEnemyIds.clear();
      this.checkpoints.clear();
      this.running = true;
      this.waitUntilFrame = null;
      this.waitUntilTime = null;
      this.pendingKeyReleases = [];
      this.scenarioStartFrame = state.frame;
      this.scenarioStartTime = state.gameTime;
      this.resolveScenario = resolve;

      // Apply setup
      if (scenario.setup) {
        const { setup } = scenario;
        if (setup.weapon) this.api.equipWeapon(setup.weapon);
        if (setup.playerPos) this.api.setPlayerPosition(setup.playerPos[0], setup.playerPos[1]);
        if (setup.enemies) {
          this.api.clearEnemies();
          for (const e of setup.enemies) {
            this.api.spawnEnemy(e.type, e.u, e.v);
          }
        }
      }
    });
  }

  /** Called every game frame from TestHarnessAPI.update(). Drives scenario execution. */
  tick(frame: number, time: number): void {
    if (!this.running || !this.currentScenario) return;

    // Handle pending key releases
    this.pendingKeyReleases = this.pendingKeyReleases.filter(kr => {
      if (time >= kr.releaseAtTime) {
        document.dispatchEvent(new KeyboardEvent('keyup', { key: kr.key, bubbles: true }));
        return false;
      }
      return true;
    });

    // Handle wait
    if (this.waitUntilFrame !== null && frame < this.waitUntilFrame) return;
    if (this.waitUntilTime !== null && time < this.waitUntilTime) return;
    this.waitUntilFrame = null;
    this.waitUntilTime = null;

    const scenario = this.currentScenario;

    // Check if all steps done
    if (this.currentStepIndex >= scenario.steps.length) {
      this._finishScenario(frame, time);
      return;
    }

    const step = scenario.steps[this.currentStepIndex];

    // Check timing trigger
    if (!this._shouldExecuteStep(step, frame, time)) return;

    // Execute
    this._executeStep(step, frame, time);
    this.currentStepIndex++;

    // If this step is a 'wait' action, set the wait state and return
    const action = step.action;
    if (action.type === 'wait') {
      if (action.frames) this.waitUntilFrame = frame + action.frames;
      else if (action.seconds) this.waitUntilTime = time + action.seconds;
    }
  }

  /** Whether a scenario is currently running. */
  get isRunning(): boolean { return this.running; }

  // -------------------------------------------------------------------------
  // Internal execution
  // -------------------------------------------------------------------------

  private _shouldExecuteStep(step: ScenarioStep, frame: number, time: number): boolean {
    if (step.at === undefined) return true; // execute immediately (ordered)
    if (typeof step.at === 'number') return frame >= (this.scenarioStartFrame + step.at);
    if (typeof step.at === 'string') {
      if (step.at.startsWith('t:')) {
        const t = parseFloat(step.at.slice(2));
        return time >= (this.scenarioStartTime + t);
      }
    }
    return true;
  }

  private _executeStep(step: ScenarioStep, frame: number, time: number): void {
    const result: StepResult = {
      stepIndex: this.currentStepIndex,
      label: step.label ?? `step_${this.currentStepIndex}`,
      frame, time,
      actionExecuted: false,
      assertionPassed: null,
    };

    // Execute action
    try {
      this._executeAction(step.action, frame, time);
      result.actionExecuted = true;
    } catch (e) {
      result.actionExecuted = false;
      result.assertionError = `Action failed: ${e}`;
    }

    // Check assertion (after action)
    if (step.assert) {
      try {
        const passed = this._checkAssertion(step.assert, frame);
        result.assertionPassed = passed;
        if (!passed) result.assertionError = `Assertion failed: ${JSON.stringify(step.assert)}`;
      } catch (e) {
        result.assertionPassed = false;
        result.assertionError = `Assertion threw: ${e}`;
      }
    }

    this.stepResults.push(result);
  }

  private _executeAction(action: ActionType, frame: number, time: number): void {
    switch (action.type) {
      case 'spawnEnemy': {
        const id = this.api.spawnEnemy(action.enemyType, action.u, action.v);
        if (action.id) this.spawnedEnemyIds.set(action.id, id);
        break;
      }
      case 'moveEnemy': {
        const realId = this.spawnedEnemyIds.get(action.id) ?? action.id;
        this.api.moveEnemyTo(realId, action.targetU, action.targetV, action.speed);
        break;
      }
      case 'clearEnemies':
        this.api.clearEnemies();
        break;
      case 'setPlayerPos':
        this.api.setPlayerPosition(action.u, action.v);
        break;
      case 'fireWeapon':
        this.api.fireWeapon();
        break;
      case 'equipWeapon':
        this.api.equipWeapon(action.weapon);
        break;
      case 'spawnPickup':
        this.api.spawnPickup(action.pickupType, action.u, action.v);
        break;
      case 'pressKey': {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: action.key, bubbles: true }));
        const duration = action.duration ?? 0;
        if (duration > 0) {
          this.pendingKeyReleases.push({ key: action.key, releaseAtTime: time + duration });
        }
        break;
      }
      case 'screenshot':
        // Signals Puppeteer via window — Puppeteer polls __SCENARIO_ENGINE.pendingScreenshot
        (window as any).__PENDING_SCREENSHOT = { label: action.label, frame, time };
        break;
      case 'checkpoint':
        this.checkpoints.set(action.label, frame);
        break;
      case 'observe':
        // passive — just set a wait
        this.waitUntilTime = time + action.duration;
        break;
      case 'wait':
        // Handled in tick() after _executeStep returns
        break;
      case 'custom': {
        const fn = this.customFns.get(action.fn);
        if (fn) fn(this.api);
        break;
      }
    }
  }

  private _checkAssertion(assertion: AssertionType, _frame: number): boolean {
    const state = this.api.getGameState();

    switch (assertion.type) {
      case 'playerAlive':
        return !state.isGameOver && state.lives > 0;
      case 'playerDead':
        return state.lives === 0 || state.isGameOver;
      case 'enemyCount':
        return this._compare(state.enemies, assertion.op, assertion.value);
      case 'bulletCount':
        return this._compare(state.bullets, assertion.op as '=' | '>' | '<' | '>=' | '<=', assertion.value);
      case 'pickupCount':
        return this._compare(state.pickups, assertion.op as '=' | '>' | '<' | '>=' | '<=', assertion.value);
      case 'scoreAbove':
        return state.score > assertion.value;
      case 'fpsAbove': {
        const history = this.recorder.getHistory();
        if (history.length === 0) return true;
        const recent = history[history.length - 1];
        return recent.fps > assertion.value;
      }
      case 'weaponIs':
        return state.currentWeapon === assertion.weapon;
      case 'playerAt': {
        const pPos = this.api.getPlayerPosition();
        const du = Math.abs(pPos.u - assertion.u);
        const dv = Math.abs(pPos.v - assertion.v);
        return Math.sqrt(du * du + dv * dv) <= assertion.tolerance;
      }
      case 'enemyAt': {
        const realId = this.spawnedEnemyIds.get(assertion.id) ?? assertion.id;
        const ePos = this.api.getEnemyPosition(realId);
        if (!ePos) return false;
        const du = Math.abs(ePos.u - assertion.u);
        const dv = Math.abs(ePos.v - assertion.v);
        return Math.sqrt(du * du + dv * dv) <= assertion.tolerance;
      }
      case 'noDeathsSince': {
        const checkpointFrame = this.checkpoints.get(assertion.label) ?? this.scenarioStartFrame;
        const deaths = this.recorder.getEvents('death', checkpointFrame);
        return deaths.length === 0;
      }
      case 'deathOccurred': {
        const deaths = this.recorder.getEvents('death', this.scenarioStartFrame);
        return deaths.length > 0;
      }
      case 'damageOccurred': {
        const deaths = this.api.getRecentDeaths();
        const damages = this.api.getRecentDamageEvents();
        if (assertion.source) {
          return damages.some(d => d.source === assertion.source);
        }
        return damages.length > 0 || deaths.length > 0;
      }
      case 'custom': {
        const fn = this.customFns.get(assertion.fn);
        if (!fn) return false;
        const result = fn(this.api);
        return result === true || result === undefined;
      }
      default:
        return false;
    }
  }

  private _compare(actual: number, op: string, expected: number): boolean {
    switch (op) {
      case '=': return actual === expected;
      case '>': return actual > expected;
      case '<': return actual < expected;
      case '>=': return actual >= expected;
      case '<=': return actual <= expected;
      default: return false;
    }
  }

  private _finishScenario(frame: number, time: number): void {
    if (!this.currentScenario || !this.resolveScenario) return;

    const scenario = this.currentScenario;

    // Run teardown actions
    if (scenario.teardown) {
      for (const action of scenario.teardown) {
        try { this._executeAction(action, frame, time); } catch { /* ignore teardown errors */ }
      }
    }

    const allPassed = this.stepResults.every(r =>
      r.actionExecuted && (r.assertionPassed === null || r.assertionPassed)
    );
    const failedSteps = this.stepResults.filter(r => !r.actionExecuted || r.assertionPassed === false);

    const result: ScenarioResult = {
      scenarioName: scenario.name,
      passed: allPassed,
      totalSteps: this.stepResults.length,
      stepResults: [...this.stepResults],
      startFrame: this.scenarioStartFrame,
      endFrame: frame,
      startTime: this.scenarioStartTime,
      endTime: time,
      summary: allPassed
        ? `PASS — all ${this.stepResults.length} steps completed`
        : `FAIL — ${failedSteps.length} step(s) failed: ${failedSteps.map(s => s.label).join(', ')}`,
    };

    this.running = false;
    this.currentScenario = null;
    this.resolveScenario(result);
    this.resolveScenario = null;

    // Expose result on window
    (window as any).__LAST_SCENARIO_RESULT = result;
  }
}
