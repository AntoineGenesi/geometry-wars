import * as THREE from 'three';

/**
 * GeometryCache - Module-level shared geometry cache.
 *
 * Provides a single instance of each common geometry shape, shared across
 * all entities. Eliminates repeated allocation of identical geometries
 * (e.g. a new SphereGeometry(0.08, 8, 8) for every projectile fired).
 *
 * IMPORTANT: Do NOT call .dispose() on geometries retrieved from this cache
 * inside individual entity dispose() methods. Shared geometries are disposed
 * only when the entire game session ends via disposeAll().
 */

const _cache = new Map<string, THREE.BufferGeometry>();

/**
 * Get a cached geometry. Creates it once via the factory on first access.
 * @param key - Unique string key (encode all constructor parameters).
 * @param factory - Creates the geometry if not yet cached.
 */
export function getCachedGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = _cache.get(key);
  if (!geo) {
    geo = factory();
    _cache.set(key, geo);
  }
  return geo;
}

/**
 * Dispose all cached geometries. Call only on full game shutdown.
 */
export function disposeGeometryCache(): void {
  for (const geo of _cache.values()) {
    geo.dispose();
  }
  _cache.clear();
}

// ---------------------------------------------------------------------------
// Pre-defined helpers for the most common shared shapes
// ---------------------------------------------------------------------------

export const SharedGeometries = {
  /** Spread projectile: small sphere */
  spreadProjectile(): THREE.BufferGeometry {
    return getCachedGeometry('sphere_0.08_8_8', () => new THREE.SphereGeometry(0.08, 8, 8));
  },

  /** Homing projectile: cone — larger for distinct visibility, apex at +Z (rotated by mesh each frame) */
  homingProjectile(): THREE.BufferGeometry {
    const key = 'cone_0.15_0.5_6_rotX';
    return getCachedGeometry(key, () => {
      const geo = new THREE.ConeGeometry(0.15, 0.5, 6);
      geo.rotateX(Math.PI / 2);
      return geo;
    });
  },

  /** PlasmaMortar projectile: larger sphere */
  plasmaProjectile(): THREE.BufferGeometry {
    return getCachedGeometry('sphere_0.35_12_12', () => new THREE.SphereGeometry(0.35, 12, 12));
  },

  /** GravityGun projectile: torus */
  gravityProjectile(): THREE.BufferGeometry {
    return getCachedGeometry('torus_0.15_0.05_8_16', () => new THREE.TorusGeometry(0.15, 0.05, 8, 16));
  },

  /** Default projectile fallback: small box */
  defaultProjectile(): THREE.BufferGeometry {
    return getCachedGeometry('box_0.1_0.1_0.1', () => new THREE.BoxGeometry(0.1, 0.1, 0.1));
  },

  /** BlackHole weapon: medium sphere */
  blackholeSphere(): THREE.BufferGeometry {
    return getCachedGeometry('sphere_0.3_16_16', () => new THREE.SphereGeometry(0.3, 16, 16));
  },

  /** Tesla coil weapon: large sphere */
  teslaSphere(): THREE.BufferGeometry {
    return getCachedGeometry('sphere_3_16_16', () => new THREE.SphereGeometry(3, 16, 16));
  },

  /** WeaponPickup: outer wireframe octahedron */
  weaponPickupOuter(): THREE.BufferGeometry {
    return getCachedGeometry('octa_0.35', () => new THREE.OctahedronGeometry(0.35));
  },

  /** WeaponPickup: inner solid octahedron */
  weaponPickupInner(): THREE.BufferGeometry {
    return getCachedGeometry('octa_0.15', () => new THREE.OctahedronGeometry(0.15));
  },

  /** SuperStatePickup dot sphere */
  superPickupDot(): THREE.BufferGeometry {
    return getCachedGeometry('sphere_0.05_8_8', () => new THREE.SphereGeometry(0.05, 8, 8));
  },
} as const;
