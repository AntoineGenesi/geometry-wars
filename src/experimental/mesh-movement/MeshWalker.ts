/**
 * MeshWalker - An entity that walks on any mesh surface.
 *
 * Replaces the UV-based player/enemy movement system.
 * Key properties:
 * - Speed is in world units per second (constant everywhere)
 * - No UV coordinates, no shape-specific code
 * - Works on sphere, torus, cube, cup, statue, anything
 * - No pole singularities or speed distortions
 */

import * as THREE from 'three';
import { MeshSurface, SurfaceQueryResult, TangentFrame } from './MeshSurface';

export interface WalkerState {
  /** Current position on the mesh surface (world space) */
  position: THREE.Vector3;
  /** Surface normal at current position */
  normal: THREE.Vector3;
  /** Tangent frame at current position */
  tangentFrame: TangentFrame;
  /** Current face index on the mesh */
  faceIndex: number;
}

export class MeshWalker {
  readonly surface: MeshSurface;

  /** Current state on the surface */
  position: THREE.Vector3;
  normal: THREE.Vector3;
  faceIndex: number;

  /** Movement speed in world units per second */
  speed: number;

  /** Visual mesh for this entity */
  mesh: THREE.Object3D | null = null;

  constructor(surface: MeshSurface, startPos: THREE.Vector3, speed: number) {
    this.surface = surface;
    this.speed = speed;

    // Project starting position onto surface
    const result = surface.closestPointOnSurface(startPos);
    if (result) {
      this.position = result.point.clone();
      this.normal = result.normal.clone();
      this.faceIndex = result.faceIndex;
    } else {
      this.position = startPos.clone();
      this.normal = new THREE.Vector3(0, 1, 0);
      this.faceIndex = 0;
    }
  }

  /**
   * Get the current tangent frame at the walker's position.
   */
  getTangentFrame(): TangentFrame {
    return this.surface.getTangentFrame(this.normal);
  }

  /**
   * Move the walker on the surface.
   *
   * @param moveDir - Desired movement direction in WORLD SPACE
   * @param dt - Delta time in seconds
   * @returns The new surface query result, or null if movement failed
   */
  move(moveDir: THREE.Vector3, dt: number): SurfaceQueryResult | null {
    const distance = this.speed * dt;

    const result = this.surface.moveOnSurface(
      this.position,
      this.normal,
      moveDir,
      distance,
    );

    if (result) {
      this.position.copy(result.point);
      this.normal.copy(result.normal);
      this.faceIndex = result.faceIndex;

      // Update visual mesh position and orientation
      if (this.mesh) {
        this.mesh.position.copy(result.point);
        this.alignToSurface();
      }
    }

    return result;
  }

  /**
   * Move using screen-space input (WASD-style).
   * Converts screen input to world-space movement relative to camera.
   *
   * @param inputX - Horizontal input (-1 to 1, A/D or left/right stick)
   * @param inputY - Vertical input (-1 to 1, W/S or up/down stick)
   * @param camera - The camera (used to determine "forward" and "right")
   * @param dt - Delta time
   */
  moveFromInput(
    inputX: number,
    inputY: number,
    camera: THREE.Camera,
    dt: number,
  ): SurfaceQueryResult | null {
    if (Math.abs(inputX) < 0.01 && Math.abs(inputY) < 0.01) return null;

    // Get camera right and up vectors
    const camRight = new THREE.Vector3();
    const camUp = new THREE.Vector3();
    camera.matrixWorld.extractBasis(camRight, camUp, new THREE.Vector3());

    // Build world-space movement direction from screen input
    const moveDir = new THREE.Vector3()
      .addScaledVector(camRight, inputX)
      .addScaledVector(camUp, -inputY); // Negate Y: W (inputY=-1) should go "up" on screen = camera's up

    return this.move(moveDir, dt);
  }

  /**
   * Compute aim direction from screen-space input.
   * Projects the aim direction onto the surface tangent plane.
   *
   * @param aimX - Horizontal aim (-1 to 1, mouse delta or right stick)
   * @param aimY - Vertical aim (-1 to 1, mouse delta or right stick)
   * @param camera - The camera
   * @returns World-space aim direction on the surface tangent plane
   */
  getAimDirection(
    aimX: number,
    aimY: number,
    camera: THREE.Camera,
  ): THREE.Vector3 {
    const aimLen = Math.sqrt(aimX * aimX + aimY * aimY);
    if (aimLen < 0.01) {
      // Default: aim in camera's forward direction projected onto surface
      const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const dot = camForward.dot(this.normal);
      return camForward.sub(this.normal.clone().multiplyScalar(dot)).normalize();
    }

    // Get camera basis
    const camRight = new THREE.Vector3();
    const camUp = new THREE.Vector3();
    camera.matrixWorld.extractBasis(camRight, camUp, new THREE.Vector3());

    // Build screen-space aim vector
    const screenAim = new THREE.Vector3()
      .addScaledVector(camRight, aimX)
      .addScaledVector(camUp, -aimY);

    // Project onto surface tangent plane (remove normal component)
    const dot = screenAim.dot(this.normal);
    screenAim.sub(this.normal.clone().multiplyScalar(dot));

    const len = screenAim.length();
    if (len < 0.0001) {
      return new THREE.Vector3(0, 0, 1); // fallback
    }

    return screenAim.normalize();
  }

  /**
   * Align the visual mesh to the surface normal.
   * The mesh "stands up" on the surface with its Y axis along the normal.
   */
  alignToSurface(): void {
    if (!this.mesh) return;

    const frame = this.getTangentFrame();
    const rotMatrix = new THREE.Matrix4().makeBasis(
      frame.tangent,
      frame.normal,
      frame.bitangent,
    );
    this.mesh.quaternion.setFromRotationMatrix(rotMatrix);
  }

  /**
   * Orient the visual mesh to face a given direction on the surface.
   * Used for player facing aim direction.
   */
  faceDirection(direction: THREE.Vector3): void {
    if (!this.mesh) return;

    const normal = this.normal.clone().normalize();
    const forward = direction.clone();

    // Ensure forward is on the tangent plane
    forward.sub(normal.clone().multiplyScalar(forward.dot(normal))).normalize();
    if (forward.lengthSq() < 0.001) return;

    const right = new THREE.Vector3().crossVectors(normal, forward).normalize();
    const correctedForward = new THREE.Vector3().crossVectors(right, normal).normalize();

    const rotMatrix = new THREE.Matrix4().makeBasis(right, normal, correctedForward);
    this.mesh.quaternion.setFromRotationMatrix(rotMatrix);
  }

  /**
   * Get visibility (0-1) relative to camera.
   * Used for depth-based opacity of far-side entities.
   */
  getVisibility(cameraPos: THREE.Vector3): number {
    return this.surface.getVisibility(this.position, this.normal, cameraPos);
  }

  /**
   * Get the state for serialization or debugging.
   */
  getState(): WalkerState {
    return {
      position: this.position.clone(),
      normal: this.normal.clone(),
      tangentFrame: this.getTangentFrame(),
      faceIndex: this.faceIndex,
    };
  }
}
