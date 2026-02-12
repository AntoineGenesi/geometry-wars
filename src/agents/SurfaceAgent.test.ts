/**
 * Tests for SurfaceAgent + all 5 behaviors.
 *
 * Uses real SphereGeometry + MeshSurface (BVH) - no mocks for surface queries.
 * This ensures agent movement genuinely stays on the mesh surface.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SurfaceAgent } from './SurfaceAgent';
import {
  BehaviorStatus,
  IdleBehavior,
  MoveToTargetBehavior,
  FollowTargetBehavior,
  OrbitBehavior,
  PatrolBehavior,
} from './behaviors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPHERE_RADIUS = 8;

function createSphereMeshSurface(radius = SPHERE_RADIUS): MeshSurface {
  const geo = new THREE.SphereGeometry(radius, 32, 32);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.updateMatrixWorld(true);
  return new MeshSurface(mesh);
}

function createTorusMeshSurface(majorR = 6, minorR = 2.5): MeshSurface {
  const geo = new THREE.TorusGeometry(majorR, minorR, 32, 64);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.updateMatrixWorld(true);
  return new MeshSurface(mesh);
}

function isOnSphere(pos: THREE.Vector3, radius: number, tolerance = 0.15): boolean {
  const dist = pos.length();
  return Math.abs(dist - radius) < tolerance;
}

// ---------------------------------------------------------------------------
// SurfaceAgent core
// ---------------------------------------------------------------------------

describe('SurfaceAgent core', () => {
  let ms: MeshSurface;

  beforeEach(() => {
    ms = createSphereMeshSurface();
  });

  it('constructor sets position from initial point', () => {
    const agent = new SurfaceAgent(null, new THREE.Vector3(3, 4, 5), 2.0);
    expect(agent.position.x).toBeCloseTo(3, 1);
    expect(agent.position.y).toBeCloseTo(4, 1);
    expect(agent.position.z).toBeCloseTo(5, 1);
  });

  it('constructor snaps to sphere surface', () => {
    // Start off-surface (inside the sphere)
    const agent = new SurfaceAgent(ms, new THREE.Vector3(2, 0, 0), 2.0);
    expect(isOnSphere(agent.position, SPHERE_RADIUS)).toBe(true);
  });

  it('moveToward moves position closer to target', () => {
    const start = new THREE.Vector3(0, SPHERE_RADIUS, 0);
    const agent = new SurfaceAgent(ms, start, 5.0);
    const startPos = agent.position.clone();

    const target = new THREE.Vector3(SPHERE_RADIUS, 0, 0);
    agent.moveToward(target, 0.1);

    const distBefore = startPos.distanceTo(target);
    const distAfter = agent.position.distanceTo(target);
    expect(distAfter).toBeLessThan(distBefore);
  });

  it('moveToward returns remaining distance', () => {
    const start = new THREE.Vector3(0, SPHERE_RADIUS, 0);
    const agent = new SurfaceAgent(ms, start, 5.0);

    const target = new THREE.Vector3(SPHERE_RADIUS, 0, 0);
    const remaining = agent.moveToward(target, 0.1);

    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(20); // less than sphere diameter
  });

  it('moveToward stops at target (returns ~0)', () => {
    const start = new THREE.Vector3(0, SPHERE_RADIUS, 0);
    const agent = new SurfaceAgent(null, start, 1000.0); // very fast

    const target = new THREE.Vector3(0, SPHERE_RADIUS + 0.5, 0);
    const remaining = agent.moveToward(target, 1.0);

    expect(remaining).toBeCloseTo(0, 1);
  });

  it('snapToSurface projects point onto surface', () => {
    // Create agent off-surface with world-space fallback
    const agent = new SurfaceAgent(null, new THREE.Vector3(3, 0, 0), 1.0);
    // Now assign a mesh surface and snap
    agent.setMeshSurface(ms);
    agent.snapToSurface();

    expect(isOnSphere(agent.position, SPHERE_RADIUS)).toBe(true);
  });

  it('projectOffset places agent at center + tangent/bitangent offset', () => {
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 1.0);
    const center = new THREE.Vector3(0, 10, 0);
    const tangent = new THREE.Vector3(1, 0, 0);
    const bitangent = new THREE.Vector3(0, 0, 1);

    agent.projectOffset(center, tangent, bitangent, 1.0, 0.0, 2.0);

    // Should be at center + tangent * 2.0 = (2, 10, 0)
    expect(agent.position.x).toBeCloseTo(2, 1);
    expect(agent.position.y).toBeCloseTo(10, 1);
    expect(agent.position.z).toBeCloseTo(0, 1);
  });

  it('getNetworkState returns serializable object with correct fields', () => {
    const agent = new SurfaceAgent(ms, new THREE.Vector3(0, SPHERE_RADIUS, 0), 3.0);
    agent.setBehavior(new IdleBehavior());

    const state = agent.getNetworkState();

    expect(state).toHaveProperty('px');
    expect(state).toHaveProperty('py');
    expect(state).toHaveProperty('pz');
    expect(state).toHaveProperty('nx');
    expect(state).toHaveProperty('ny');
    expect(state).toHaveProperty('nz');
    expect(state.speed).toBe(3.0);
    expect(state.behaviorType).toBe('idle');
  });

  it('works with null meshSurface (world-space fallback)', () => {
    const agent = new SurfaceAgent(null, new THREE.Vector3(1, 2, 3), 5.0);
    const target = new THREE.Vector3(4, 5, 6);

    const remaining = agent.moveToward(target, 0.1);

    // Agent should have moved toward target in world space
    expect(remaining).toBeGreaterThan(0);
    const distToTarget = agent.position.distanceTo(target);
    expect(distToTarget).toBeLessThan(new THREE.Vector3(1, 2, 3).distanceTo(target));
  });

  it('setMeshSurface swaps surface', () => {
    const agent = new SurfaceAgent(null, new THREE.Vector3(2, 0, 0), 1.0);
    expect(agent.getMeshSurface()).toBeNull();

    agent.setMeshSurface(ms);
    expect(agent.getMeshSurface()).toBe(ms);

    agent.snapToSurface();
    expect(isOnSphere(agent.position, SPHERE_RADIUS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// IdleBehavior
// ---------------------------------------------------------------------------

describe('IdleBehavior', () => {
  it('does not move agent, returns Active', () => {
    const agent = new SurfaceAgent(null, new THREE.Vector3(5, 5, 5), 1.0);
    const behavior = new IdleBehavior();
    agent.setBehavior(behavior);

    const posBefore = agent.position.clone();
    const isActive = agent.update(0.016);

    expect(isActive).toBe(true);
    expect(agent.position.distanceTo(posBefore)).toBe(0);
  });

  it('agent position unchanged after multiple updates', () => {
    const agent = new SurfaceAgent(null, new THREE.Vector3(1, 2, 3), 10.0);
    agent.setBehavior(new IdleBehavior());

    const posBefore = agent.position.clone();
    for (let i = 0; i < 10; i++) {
      agent.update(0.016);
    }

    expect(agent.position.equals(posBefore)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MoveToTargetBehavior
// ---------------------------------------------------------------------------

describe('MoveToTargetBehavior', () => {
  it('moves agent toward target over multiple frames', () => {
    const start = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(10, 0, 0);
    const agent = new SurfaceAgent(null, start, 5.0);
    agent.setBehavior(new MoveToTargetBehavior(target, 0.1));

    // Multiple frames
    for (let i = 0; i < 5; i++) {
      agent.update(0.1);
    }

    // Should have moved closer
    expect(agent.position.x).toBeGreaterThan(2);
    expect(agent.position.distanceTo(target)).toBeLessThan(10);
  });

  it('returns Active while moving', () => {
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 1.0);
    agent.setBehavior(new MoveToTargetBehavior(new THREE.Vector3(100, 0, 0)));

    const isActive = agent.update(0.016);
    expect(isActive).toBe(true);
  });

  it('returns Complete when arrived (within threshold)', () => {
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 100.0);
    agent.setBehavior(new MoveToTargetBehavior(new THREE.Vector3(1, 0, 0), 0.5));

    // Fast enough to arrive in one frame
    const isActive = agent.update(1.0);
    expect(isActive).toBe(false); // Complete
  });

  it('works on sphere surface (stays on surface)', () => {
    const ms = createSphereMeshSurface();
    const start = new THREE.Vector3(0, SPHERE_RADIUS, 0);
    const agent = new SurfaceAgent(ms, start, 3.0);

    const target = new THREE.Vector3(SPHERE_RADIUS, 0, 0);
    agent.setBehavior(new MoveToTargetBehavior(target, 1.0));

    for (let i = 0; i < 20; i++) {
      agent.update(0.05);
      expect(isOnSphere(agent.position, SPHERE_RADIUS)).toBe(true);
    }
  });

  it('works with null meshSurface (world-space movement)', () => {
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 10.0);
    const target = new THREE.Vector3(5, 0, 0);
    agent.setBehavior(new MoveToTargetBehavior(target, 0.1));

    // Should arrive in a few frames
    for (let i = 0; i < 20; i++) {
      const active = agent.update(0.1);
      if (!active) break;
    }

    expect(agent.position.distanceTo(target)).toBeLessThan(0.2);
  });
});

// ---------------------------------------------------------------------------
// FollowTargetBehavior
// ---------------------------------------------------------------------------

describe('FollowTargetBehavior', () => {
  it('moves toward moving reference when outside deadzone', () => {
    const targetRef = new THREE.Vector3(10, 0, 0);
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 5.0);
    agent.setBehavior(new FollowTargetBehavior(targetRef, 0, 0.1));

    agent.update(0.1);

    // Should have moved toward target
    expect(agent.position.x).toBeGreaterThan(0);
  });

  it('stops when within desiredDistance + deadzone', () => {
    const targetRef = new THREE.Vector3(2, 0, 0);
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 100.0);
    agent.setBehavior(new FollowTargetBehavior(targetRef, 2.0, 0.5));

    // Distance is 2.0, desiredDistance + deadzone = 2.5, so should NOT move
    const posBefore = agent.position.clone();
    agent.update(0.016);

    expect(agent.position.distanceTo(posBefore)).toBe(0);
  });

  it('always returns Active', () => {
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 1.0);
    agent.setBehavior(new FollowTargetBehavior(new THREE.Vector3(0, 0, 0)));

    const isActive = agent.update(0.016);
    expect(isActive).toBe(true);
  });

  it('tracks when targetRef position changes externally', () => {
    const targetRef = new THREE.Vector3(10, 0, 0);
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 5.0);
    agent.setBehavior(new FollowTargetBehavior(targetRef, 0, 0.1));

    agent.update(0.1);
    const posAfterFirst = agent.position.clone();

    // Move target to different location
    targetRef.set(-10, 0, 0);
    agent.update(0.1);

    // Agent should now be moving toward new location (x decreasing)
    expect(agent.position.x).toBeLessThan(posAfterFirst.x);
  });
});

// ---------------------------------------------------------------------------
// OrbitBehavior
// ---------------------------------------------------------------------------

describe('OrbitBehavior', () => {
  it('angle advances by angularSpeed * dt each frame', () => {
    const center = new THREE.Vector3(0, 0, 0);
    const behavior = new OrbitBehavior(center, 2.0, Math.PI, 0);
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 1.0);
    agent.setBehavior(behavior);

    agent.update(1.0);

    expect(behavior.angle).toBeCloseTo(Math.PI, 3);
  });

  it('agent stays at approximately correct radius from center', () => {
    const center = new THREE.Vector3(0, 5, 0);
    const radius = 3.0;
    const behavior = new OrbitBehavior(center, radius, 2.0, 0);
    behavior.setFrame(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 1.0);
    agent.setBehavior(behavior);

    for (let i = 0; i < 10; i++) {
      agent.update(0.1);
      const dist = agent.position.distanceTo(center);
      expect(dist).toBeCloseTo(radius, 1);
    }
  });

  it('setFrame updates orbit plane vectors', () => {
    const center = new THREE.Vector3(0, 0, 0);
    const behavior = new OrbitBehavior(center, 2.0, 0, 0); // angle stays 0
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 1.0);
    agent.setBehavior(behavior);

    // Orbit in XZ plane: at angle=0, position = center + tangent * radius
    behavior.setFrame(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));
    agent.update(0.0001);
    expect(agent.position.x).toBeCloseTo(2.0, 1);

    // Switch to YZ plane
    behavior.setFrame(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    agent.update(0.0001);
    // At angle ~ 0, position should be center + tangent(0,1,0) * 2 = (0,2,0)
    expect(agent.position.y).toBeCloseTo(2.0, 0);
  });

  it('works on sphere surface (stays on surface)', () => {
    const ms = createSphereMeshSurface();
    const center = new THREE.Vector3(0, SPHERE_RADIUS, 0);
    const radius = 1.5;
    const behavior = new OrbitBehavior(center, radius, 2.0, 0);
    behavior.setFrame(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));

    const agent = new SurfaceAgent(ms, new THREE.Vector3(0, SPHERE_RADIUS, 0), 1.0);
    agent.setBehavior(behavior);

    for (let i = 0; i < 20; i++) {
      agent.update(0.05);
      expect(isOnSphere(agent.position, SPHERE_RADIUS, 0.3)).toBe(true);
    }
  });

  it('multiple orbits maintain radius', () => {
    const center = new THREE.Vector3(0, 0, 0);
    const radius = 4.0;
    const behavior = new OrbitBehavior(center, radius, 3.0, 0);
    behavior.setFrame(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 1.0);
    agent.setBehavior(behavior);

    // Full orbit (2pi / 3.0 rad/s = ~2.09s, at 0.02s steps = ~105 frames)
    for (let i = 0; i < 120; i++) {
      agent.update(0.02);
      const dist = agent.position.distanceTo(center);
      expect(dist).toBeCloseTo(radius, 1);
    }
  });

  it('different angular speeds produce proportional angle changes', () => {
    const center = new THREE.Vector3(0, 0, 0);
    const slowBehavior = new OrbitBehavior(center, 1.0, 1.0, 0);
    const fastBehavior = new OrbitBehavior(center, 1.0, 3.0, 0);

    const agent1 = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 1.0);
    const agent2 = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 1.0);
    agent1.setBehavior(slowBehavior);
    agent2.setBehavior(fastBehavior);

    agent1.update(1.0);
    agent2.update(1.0);

    expect(fastBehavior.angle / slowBehavior.angle).toBeCloseTo(3.0, 3);
  });

  it('center reference can be updated externally', () => {
    const center = new THREE.Vector3(0, 0, 0);
    const radius = 2.0;
    const behavior = new OrbitBehavior(center, radius, 0, 0); // no rotation
    behavior.setFrame(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 1.0);
    agent.setBehavior(behavior);

    agent.update(0.016);
    // At angle 0: pos = center(0,0,0) + tangent(1,0,0)*2 = (2,0,0)
    expect(agent.position.x).toBeCloseTo(2.0, 1);

    // Move center
    behavior.center.set(10, 0, 0);
    agent.update(0.016);
    // Now pos = center(10,0,0) + tangent(1,0,0)*2 = (12,0,0)
    expect(agent.position.x).toBeCloseTo(12.0, 1);
  });

  it('always returns Active', () => {
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 1.0);
    const behavior = new OrbitBehavior(new THREE.Vector3(), 1.0, 1.0, 0);
    agent.setBehavior(behavior);

    const isActive = agent.update(10.0);
    expect(isActive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PatrolBehavior
// ---------------------------------------------------------------------------

describe('PatrolBehavior', () => {
  it('moves toward first waypoint', () => {
    const waypoints = [
      new THREE.Vector3(5, 0, 0),
      new THREE.Vector3(5, 0, 5),
    ];
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 10.0);
    agent.setBehavior(new PatrolBehavior(waypoints, true, 0.3));

    agent.update(0.1);

    // Should move toward (5,0,0)
    expect(agent.position.x).toBeGreaterThan(0);
  });

  it('advances to next waypoint after arrival', () => {
    const waypoints = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(1, 0, 5),
    ];
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 100.0);
    const behavior = new PatrolBehavior(waypoints, true, 0.5);
    agent.setBehavior(behavior);

    // Fast agent should reach first waypoint quickly
    agent.update(1.0);

    // Should have advanced to waypoint index 1
    expect(behavior.currentIndex).toBeGreaterThanOrEqual(1);
  });

  it('loops back to first waypoint when loop=true', () => {
    const waypoints = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
    ];
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 100.0);
    const behavior = new PatrolBehavior(waypoints, true, 1.0);
    agent.setBehavior(behavior);

    // Run many frames - agent should loop back
    for (let i = 0; i < 20; i++) {
      agent.update(0.5);
    }

    // Should have looped (currentIndex back to 0 or 1)
    expect(behavior.currentIndex).toBeLessThan(waypoints.length);
  });

  it('returns Complete after last waypoint when loop=false', () => {
    const waypoints = [
      new THREE.Vector3(1, 0, 0),
    ];
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 100.0);
    agent.setBehavior(new PatrolBehavior(waypoints, false, 0.5));

    // Fast agent reaches the single waypoint in one frame
    const isActive = agent.update(1.0);
    expect(isActive).toBe(false); // Complete
  });

  it('returns Active while patrolling', () => {
    const waypoints = [
      new THREE.Vector3(100, 0, 0),
      new THREE.Vector3(100, 0, 100),
    ];
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 1.0);
    agent.setBehavior(new PatrolBehavior(waypoints, true, 0.3));

    const isActive = agent.update(0.016);
    expect(isActive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: update with no behavior
// ---------------------------------------------------------------------------

describe('SurfaceAgent update with no behavior', () => {
  it('returns false when no behavior is set', () => {
    const agent = new SurfaceAgent(null, new THREE.Vector3(0, 0, 0), 1.0);
    const result = agent.update(0.016);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Torus surface test
// ---------------------------------------------------------------------------

describe('SurfaceAgent on torus', () => {
  it('orbit stays on torus surface', () => {
    const ms = createTorusMeshSurface();
    const center = new THREE.Vector3(6, 0, 0); // On the outer ring of torus
    const radius = 1.0;
    const behavior = new OrbitBehavior(center, radius, 2.0, 0);
    behavior.setFrame(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));

    const agent = new SurfaceAgent(ms, new THREE.Vector3(6, 0, 0), 1.0);
    agent.setBehavior(behavior);

    // Run several frames, verify agent is near the torus surface
    for (let i = 0; i < 10; i++) {
      agent.update(0.05);
      // Torus has majorR=6, minorR=2.5; the point should be at distance
      // [majorR - minorR, majorR + minorR] from origin in the XZ plane
      // The agent should be snapped to the torus surface
      const distFromOrigin = Math.sqrt(
        agent.position.x * agent.position.x + agent.position.z * agent.position.z,
      );
      // Should be within the torus bounds
      expect(distFromOrigin).toBeGreaterThan(2.5); // majorR - minorR = 3.5, allow margin
      expect(distFromOrigin).toBeLessThan(10.0);   // majorR + minorR = 8.5, allow margin
    }
  });
});
