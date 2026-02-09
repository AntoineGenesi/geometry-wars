/**
 * Composable behaviors for SurfaceAgent.
 *
 * Each behavior implements a single movement pattern (idle, move-to, follow,
 * orbit, patrol). Behaviors are stateful and zero-GC: all temp vectors are
 * module-level pre-allocated constants.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export enum BehaviorStatus {
  Active = 0,
  Complete = 1,
}

/**
 * Minimal agent interface that behaviors can drive.
 * Implemented by SurfaceAgent; kept as an interface so behaviors are testable
 * without circular imports.
 */
export interface AgentHandle {
  moveToward(target: THREE.Vector3, dt: number): number;
  projectOffset(
    center: THREE.Vector3,
    tangent: THREE.Vector3,
    bitangent: THREE.Vector3,
    cosA: number,
    sinA: number,
    radius: number,
  ): void;
  readonly position: THREE.Vector3;
  speed: number;
}

export interface AgentBehavior {
  readonly type: string;
  update(agent: AgentHandle, dt: number): BehaviorStatus;
}

// ---------------------------------------------------------------------------
// Module-level temp vectors (CRITICAL: zero GC per frame)
// ---------------------------------------------------------------------------

const _tempDir = new THREE.Vector3();

// ---------------------------------------------------------------------------
// 1. IdleBehavior
// ---------------------------------------------------------------------------

export class IdleBehavior implements AgentBehavior {
  readonly type = 'idle' as const;

  update(_agent: AgentHandle, _dt: number): BehaviorStatus {
    return BehaviorStatus.Active;
  }
}

// ---------------------------------------------------------------------------
// 2. MoveToTargetBehavior
// ---------------------------------------------------------------------------

export class MoveToTargetBehavior implements AgentBehavior {
  readonly type = 'moveToTarget' as const;

  readonly target: THREE.Vector3;
  readonly arrivalThreshold: number;

  constructor(target: THREE.Vector3, arrivalThreshold = 0.1) {
    this.target = target;
    this.arrivalThreshold = arrivalThreshold;
  }

  update(agent: AgentHandle, dt: number): BehaviorStatus {
    const remaining = agent.moveToward(this.target, dt);
    return remaining < this.arrivalThreshold
      ? BehaviorStatus.Complete
      : BehaviorStatus.Active;
  }
}

// ---------------------------------------------------------------------------
// 3. FollowTargetBehavior
// ---------------------------------------------------------------------------

export class FollowTargetBehavior implements AgentBehavior {
  readonly type = 'followTarget' as const;

  /** Mutable reference - caller updates externally each frame. */
  readonly targetRef: THREE.Vector3;
  readonly desiredDistance: number;
  readonly deadzone: number;

  constructor(targetRef: THREE.Vector3, desiredDistance = 0, deadzone = 0.1) {
    this.targetRef = targetRef;
    this.desiredDistance = desiredDistance;
    this.deadzone = deadzone;
  }

  update(agent: AgentHandle, dt: number): BehaviorStatus {
    _tempDir.copy(this.targetRef).sub(agent.position);
    const dist = _tempDir.length();

    if (dist > this.desiredDistance + this.deadzone) {
      agent.moveToward(this.targetRef, dt);
    }

    return BehaviorStatus.Active;
  }
}

// ---------------------------------------------------------------------------
// 4. OrbitBehavior
// ---------------------------------------------------------------------------

export class OrbitBehavior implements AgentBehavior {
  readonly type = 'orbit' as const;

  /** Mutable center reference - caller copies playerWorldPos into it each frame. */
  readonly center: THREE.Vector3;
  radius: number;
  angularSpeed: number;
  angle: number;

  /** Orbit plane vectors - caller sets via setFrame() each frame. */
  private tangent = new THREE.Vector3(1, 0, 0);
  private bitangent = new THREE.Vector3(0, 0, 1);

  constructor(
    centerRef: THREE.Vector3,
    radius: number,
    angularSpeed: number,
    startAngle = 0,
  ) {
    this.center = centerRef;
    this.radius = radius;
    this.angularSpeed = angularSpeed;
    this.angle = startAngle;
  }

  /**
   * Set the orbit plane vectors. Call each frame before agent.update().
   * These are stored as references (not cloned) for zero allocation.
   */
  setFrame(tangent: THREE.Vector3, bitangent: THREE.Vector3): void {
    this.tangent.copy(tangent);
    this.bitangent.copy(bitangent);
  }

  update(agent: AgentHandle, dt: number): BehaviorStatus {
    this.angle += this.angularSpeed * dt;

    const cosA = Math.cos(this.angle);
    const sinA = Math.sin(this.angle);

    agent.projectOffset(
      this.center,
      this.tangent,
      this.bitangent,
      cosA,
      sinA,
      this.radius,
    );

    return BehaviorStatus.Active;
  }
}

// ---------------------------------------------------------------------------
// 5. PatrolBehavior
// ---------------------------------------------------------------------------

export class PatrolBehavior implements AgentBehavior {
  readonly type = 'patrol' as const;

  readonly waypoints: THREE.Vector3[];
  readonly loop: boolean;
  readonly arrivalThreshold: number;

  currentIndex = 0;

  constructor(
    waypoints: THREE.Vector3[],
    loop = true,
    arrivalThreshold = 0.3,
  ) {
    this.waypoints = waypoints;
    this.loop = loop;
    this.arrivalThreshold = arrivalThreshold;
  }

  update(agent: AgentHandle, dt: number): BehaviorStatus {
    if (this.waypoints.length === 0) return BehaviorStatus.Complete;

    const target = this.waypoints[this.currentIndex];
    const remaining = agent.moveToward(target, dt);

    if (remaining < this.arrivalThreshold) {
      this.currentIndex++;

      if (this.currentIndex >= this.waypoints.length) {
        if (this.loop) {
          this.currentIndex = 0;
        } else {
          this.currentIndex = this.waypoints.length - 1;
          return BehaviorStatus.Complete;
        }
      }
    }

    return BehaviorStatus.Active;
  }
}
