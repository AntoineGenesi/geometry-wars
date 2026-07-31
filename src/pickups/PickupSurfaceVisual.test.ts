import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SurfaceFactory, type SurfaceType } from '../surfaces/SurfaceFactory';
import { MeshSurface } from '../surfaces/MeshSurface';
import type { Surface } from '../surfaces/Surface';
import { SurfaceVisibilityResolver } from '../rendering/SurfaceVisibilityResolver';
import {
  PICKUP_OCCLUDED_BODY_FLOOR,
  applyPickupSurfacePose,
  makeRightHandedPickupBasis,
  resolveAndApplyPickupVisibility,
} from './PickupSurfaceVisual';

interface Fixture {
  surface: Surface;
  meshSurface: MeshSurface;
}

const fixtures: Fixture[] = [];

function createFixture(type: SurfaceType): Fixture {
  const surface = SurfaceFactory.create(type);
  surface.mesh.updateMatrixWorld(true);
  const fixture = { surface, meshSurface: new MeshSurface(surface.mesh) };
  fixtures.push(fixture);
  return fixture;
}

function getPickupFrame(surface: Surface, u: number, v: number) {
  const point = surface.getPoint(u, v);
  return {
    position: point.position,
    normal: point.normal,
    tangent: point.tangentU,
    bitangent: point.tangentV,
  };
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.meshSurface.dispose();
    fixture.surface.dispose();
  }
});

describe('pickup right-handed surface pose', () => {
  it('replaces the legacy left-handed pickup column order', () => {
    const tangent = new THREE.Vector3(1, 0, 0);
    const normal = new THREE.Vector3(0, 1, 0);
    const surfaceBitangent = new THREE.Vector3().crossVectors(normal, tangent);
    const legacy = new THREE.Matrix4().makeBasis(tangent, normal, surfaceBitangent);
    const shared = new THREE.Matrix4();

    expect(legacy.determinant()).toBeLessThan(0);
    expect(makeRightHandedPickupBasis({ normal, tangent, bitangent: surfaceBitangent }, shared)).toBe(true);
    expect(shared.determinant()).toBeCloseTo(1, 6);
  });

  it.each(['cube', 'torus'] as const)(
    '%s keeps finite positive-determinant transforms through a spin cycle',
    (type) => {
      const { surface } = createFixture(type);
      const samples = [
        getPickupFrame(surface, 0.125, 0.5),
        getPickupFrame(surface, 0.375, 0.7),
        getPickupFrame(surface, 0.625, 0.3),
      ];

      for (const frame of samples) {
        for (const spinAngle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
          const mesh = new THREE.Group();
          expect(applyPickupSurfacePose(mesh, frame, { normalOffset: 0.4, spinAngle })).toBe(true);
          expect(mesh.matrix.elements.every(Number.isFinite)).toBe(true);
          expect(mesh.quaternion.toArray().every(Number.isFinite)).toBe(true);
          expect(mesh.matrix.determinant()).toBeCloseTo(1, 5);
          expect(mesh.position.distanceTo(frame.position)).toBeCloseTo(0.4, 5);
        }
      }
    },
  );

  it('recovers a finite right-handed basis from a degenerate tangent using bitangent', () => {
    const basis = new THREE.Matrix4();
    const valid = makeRightHandedPickupBasis({
      normal: new THREE.Vector3(0, 1, 0),
      tangent: new THREE.Vector3(0, 2, 0),
      bitangent: new THREE.Vector3(0, 0, 1),
    }, basis);

    expect(valid).toBe(true);
    expect(basis.elements.every(Number.isFinite)).toBe(true);
    expect(basis.determinant()).toBeCloseTo(1, 6);
  });
});

describe('pickup topology visibility policy', () => {
  it('uses the shared cube classifier, readable body floor, age, and arrow exemption', () => {
    const { surface, meshSurface } = createFixture('cube');
    const resolver = new SurfaceVisibilityResolver(meshSurface);
    const playerPosition = surface.getPoint(0.125, 0.5).position;
    const pickupPosition = surface.getPoint(0, 0.875).position;
    const pickupMesh = new THREE.Group();
    pickupMesh.position.copy(pickupPosition);
    pickupMesh.userData.ageFactor = 0.5;

    const bodyMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8 });
    bodyMaterial.userData.baseOpacity = 0.8;
    pickupMesh.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), bodyMaterial));

    const indicatorMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75 });
    const indicator = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), indicatorMaterial);
    indicator.name = 'spawn-indicator';
    pickupMesh.add(indicator);

    const result = resolveAndApplyPickupVisibility({
      resolver,
      playerWorldPosition: playerPosition,
      pickupWorldPosition: pickupPosition,
      pickupMesh,
    });

    expect(result.className).toBe('edge-blocked');
    expect(pickupMesh.userData.surfaceVisibility).toBe(result);
    expect(pickupMesh.userData.pickupBodyVisibility).toBe(PICKUP_OCCLUDED_BODY_FLOOR);
    expect(bodyMaterial.opacity).toBeCloseTo(0.8 * 0.5 * PICKUP_OCCLUDED_BODY_FLOOR);
    expect(indicatorMaterial.opacity).toBe(0.75);
  });

  it('keeps a curved direct pickup fully readable and honors opaque-hidden bodies', () => {
    const torus = createFixture('torus');
    const torusResolver = new SurfaceVisibilityResolver(torus.meshSurface);
    const playerPosition = torus.surface.getPoint(0.125, 0.5).position;
    const directPosition = torus.surface.getPoint(0.125, 0.7).position;
    const directMesh = new THREE.Group();
    directMesh.position.copy(directPosition);
    const directMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6 });
    directMesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.1), directMaterial));

    const direct = resolveAndApplyPickupVisibility({
      resolver: torusResolver,
      playerWorldPosition: playerPosition,
      pickupWorldPosition: directPosition,
      pickupMesh: directMesh,
    });
    expect(direct.className).toBe('direct');
    expect(directMaterial.opacity).toBeCloseTo(0.6);

    const cube = createFixture('cube');
    const cubeResolver = new SurfaceVisibilityResolver(cube.meshSurface);
    const cubePlayer = cube.surface.getPoint(0.125, 0.5).position;
    const hiddenPosition = cube.surface.getPoint(0.625, 0.5).position;
    const hiddenMesh = new THREE.Group();
    hiddenMesh.position.copy(hiddenPosition);
    const hiddenMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 });
    hiddenMesh.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.1), hiddenMaterial));

    const hidden = resolveAndApplyPickupVisibility({
      resolver: cubeResolver,
      playerWorldPosition: cubePlayer,
      pickupWorldPosition: hiddenPosition,
      pickupMesh: hiddenMesh,
      opaqueSurfaces: true,
    });
    expect(hidden.className).toBe('opaque-hidden');
    expect(hiddenMaterial.opacity).toBe(0);
  });
});
