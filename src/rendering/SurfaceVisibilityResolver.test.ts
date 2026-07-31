import { afterEach, describe, expect, it } from 'vitest';
import { SurfaceFactory, type SurfaceType } from '../surfaces/SurfaceFactory';
import { MeshSurface } from '../surfaces/MeshSurface';
import type { Surface } from '../surfaces/Surface';
import {
  SURFACE_VISIBILITY_EDGE_BLOCKED,
  SURFACE_VISIBILITY_IMPORTANT_FLOOR,
  SURFACE_VISIBILITY_LONG_PATH,
  SurfaceVisibilityResolver,
} from './SurfaceVisibilityResolver';

const REQUIRED_SURFACES = ['cube', 'cube-ring', 'cube-tunnel', 'torus'] as const;

interface Fixture {
  surface: Surface;
  meshSurface: MeshSurface;
  resolver: SurfaceVisibilityResolver;
}

const fixtures: Fixture[] = [];

function createFixture(type: SurfaceType): Fixture {
  const surface = SurfaceFactory.create(type);
  surface.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surface.mesh);
  const fixture = {
    surface,
    meshSurface,
    resolver: new SurfaceVisibilityResolver(meshSurface),
  };
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.meshSurface.dispose();
    fixture.surface.dispose();
  }
});

describe('SurfaceVisibilityResolver real surface topology', () => {
  it.each(REQUIRED_SURFACES)('%s keeps same-region enemies direct', (type) => {
    const { surface, resolver } = createFixture(type);
    const player = surface.getPoint(0.125, 0.5).position;
    const nearby = surface.getPoint(0.125, 0.7).position;

    const result = resolver.resolve({
      playerWorldPosition: player,
      entityWorldPosition: nearby,
    });

    expect(result.className).toBe('direct');
    expect(result.visibility).toBe(1);
    expect(result.topologyDistance).toBeGreaterThan(0);
    expect(result.topologyDistanceRatio).toBeLessThan(0.52);
  });

  it.each(REQUIRED_SURFACES)('%s makes opposite topology paths nearly invisible', (type) => {
    const { surface, resolver } = createFixture(type);
    const player = surface.getPoint(0.125, 0.5).position;
    const opposite = surface.getPoint(0.625, 0.5).position;

    const result = resolver.resolve({
      playerWorldPosition: player,
      entityWorldPosition: opposite,
    });

    expect(result.className).toBe('long-path');
    expect(result.visibility).toBe(SURFACE_VISIBILITY_LONG_PATH);
    expect(result.topologyDistanceRatio).toBeGreaterThanOrEqual(0.52);
  });

  it.each([
    ['cube', 0, 0.875],
    ['cube-ring', 0, 0],
  ] as const)('%s detects hard-edge-blocked regions without a map policy branch', (type, u, v) => {
    const { surface, resolver } = createFixture(type);
    const result = resolver.resolve({
      playerWorldPosition: surface.getPoint(0.125, 0.5).position,
      entityWorldPosition: surface.getPoint(u, v).position,
    });

    expect(result.className).toBe('edge-blocked');
    expect(result.visibility).toBe(SURFACE_VISIBILITY_EDGE_BLOCKED);
    expect(result.hardEdgeCrossings).toBeGreaterThan(0);
  });

  it.each(['cube-tunnel', 'torus'] as const)(
    '%s distinguishes a smooth long path from a hard-edge crossing',
    (type) => {
      const { surface, resolver } = createFixture(type);
      const result = resolver.resolve({
        playerWorldPosition: surface.getPoint(0.125, 0.5).position,
        entityWorldPosition: surface.getPoint(0.625, 0.5).position,
      });

      expect(result.className).toBe('long-path');
      expect(result.hardEdgeCrossings).toBe(0);
      expect(result.topologyDistance).toBeGreaterThan(0);
    },
  );
});

describe('SurfaceVisibilityResolver policy', () => {
  it('preserves the documented important-enemy floor on a long path', () => {
    const { surface, resolver } = createFixture('cube');
    const result = resolver.resolve({
      playerWorldPosition: surface.getPoint(0.125, 0.5).position,
      entityWorldPosition: surface.getPoint(0.625, 0.5).position,
      important: true,
    });

    expect(result.className).toBe('important-occluded');
    expect(result.visibility).toBe(SURFACE_VISIBILITY_IMPORTANT_FLOOR);
  });

  it('explicitly classifies blocked enemies as opaque-hidden', () => {
    const { surface, resolver } = createFixture('cube-ring');
    const result = resolver.resolve({
      playerWorldPosition: surface.getPoint(0.125, 0.5).position,
      entityWorldPosition: surface.getPoint(0, 0).position,
      opaqueSurfaces: true,
    });

    expect(result.className).toBe('opaque-hidden');
    expect(result.visibility).toBe(0);
    expect(result.minColorBrightness).toBe(0);
  });
});

describe('SurfaceVisibilityResolver bounded hot path', () => {
  it('builds one field and performs table lookups for 150 enemies', () => {
    const { surface, resolver } = createFixture('cube-tunnel');
    const playerPosition = surface.getPoint(0.125, 0.5).position;
    const entityPosition = surface.getPoint(0.625, 0.5).position;
    const playerFaceIndex = resolver.locateFace(playerPosition);
    const entityFaceIndex = resolver.locateFace(entityPosition);

    for (let i = 0; i < 150; i++) {
      resolver.resolve({
        playerWorldPosition: playerPosition,
        playerFaceIndex,
        entityWorldPosition: entityPosition,
        entityFaceIndex,
      });
    }

    const stats = resolver.getStats();
    expect(stats.fieldBuilds).toBe(1);
    expect(stats.fieldCacheHits).toBe(149);
    expect(stats.resolveCount).toBe(150);
    expect(stats.maxFieldBuildMs).toBeLessThan(100);
  });

  it('caches MP entity face queries until meaningful movement', () => {
    const { surface, resolver } = createFixture('torus');
    const playerPosition = surface.getPoint(0.125, 0.5).position;
    const entityPosition = surface.getPoint(0.25, 0.5).position;
    const playerFaceIndex = resolver.locateFace(playerPosition);
    const entityKey = {};

    for (let i = 0; i < 10; i++) {
      resolver.resolve({
        playerWorldPosition: playerPosition,
        playerFaceIndex,
        entityWorldPosition: entityPosition,
        entityKey,
      });
    }

    // One explicit player query plus one cached entity query.
    expect(resolver.getStats().faceQueries).toBe(2);
  });
});
