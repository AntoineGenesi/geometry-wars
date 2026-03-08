/**
 * Regression test: s44r2-08 — MP pickup rendering invisible/black
 *
 * Root cause: the dimming loop in network-main.ts had no active guard on
 * WeaponPickup / BuffPickupNew entries. When a pickup's client-side age
 * exceeded maxAge, WeaponPickup.update() set active=false and stopped
 * updating ageFactor. The dimming loop still ran on the inactive pickup,
 * applying mat.opacity = baseOpacity * ageFactor * dimFactor where
 * ageFactor ≈ 0 (set just before expiry) → invisible mesh. The spawn
 * indicator sprite was exempt from dimming, so only the arrow remained
 * visible — appearing as "black/invisible pickup with arrow indicator".
 *
 * Fix: guard inactive pickups in the dimming loop and hide their meshes.
 * This test verifies the guard logic using minimal fake pickup objects.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

// Minimal fake pickup shape matching WeaponPickup / BuffPickupNew public API
interface FakePickup {
  active: boolean;
  surfaceU: number;
  surfaceV: number;
  mesh: THREE.Group & { userData: { ageFactor?: number } };
}

function makeFakePickup(active: boolean, ageFactor: number): FakePickup {
  const mat = new THREE.MeshBasicMaterial({ color: 0x44ffff, transparent: true, opacity: 0.8 });
  mat.userData.baseOpacity = 0.8;
  const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const mesh = new THREE.Mesh(geo, mat);

  const group = new THREE.Group() as THREE.Group & { userData: { ageFactor?: number } };
  group.userData.ageFactor = ageFactor;
  group.add(mesh);

  return { active, surfaceU: 0.5, surfaceV: 0.5, mesh: group };
}

/** Mirrors the FIXED dimming guard from network-main.ts */
function applyDimmingWithGuard(pickup: FakePickup, dimFactor: number): void {
  if (!pickup.active) {
    pickup.mesh.visible = false;
    return;
  }
  const ageFactor = (pickup.mesh.userData.ageFactor as number) ?? 1.0;
  pickup.mesh.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = child.material as THREE.MeshBasicMaterial;
      if ('opacity' in mat) {
        if (mat.userData.baseOpacity === undefined) mat.userData.baseOpacity = mat.opacity;
        mat.opacity = (mat.userData.baseOpacity as number) * ageFactor * dimFactor;
      }
    }
  });
}

describe('pickup rendering — invisible/black regression (s44r2-08)', () => {
  it('active pickup keeps positive opacity after worst-case dimming', () => {
    const pickup = makeFakePickup(true, 1.0);
    applyDimmingWithGuard(pickup, 0.35); // PICKUP_MIN_SCALE

    let checkedMesh = false;
    pickup.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshBasicMaterial;
        expect(mat.opacity).toBeGreaterThan(0); // 0.8 * 1.0 * 0.35 = 0.28
        checkedMesh = true;
      }
    });
    expect(checkedMesh).toBe(true);
    expect(pickup.mesh.visible).not.toBe(false);
  });

  it('active pickup with low ageFactor still follows normal dimming path (no visibility hide)', () => {
    // ageFactor = 0.05 (near end-of-life but still active — server delay scenario)
    const pickup = makeFakePickup(true, 0.05);
    applyDimmingWithGuard(pickup, 1.0);

    // mesh.visible should not be forced false — only inactive pickups get that
    expect(pickup.mesh.visible).not.toBe(false);
  });

  it('inactive pickup (active=false) has mesh hidden by dimming guard — was the bug', () => {
    // This is the EXACT scenario that caused the black pickup:
    // - Pickup aged past maxAge → WeaponPickup.update() set active=false, ageFactor≈0
    // - Dimming loop ran on the inactive pickup without the guard
    // - opacity = baseOpacity * 0.02 * dimFactor ≈ 0 → invisible mesh
    // - Spawn indicator still visible → user saw arrow but no pickup body
    const pickup = makeFakePickup(false, 0.02); // ageFactor near 0 (just expired)

    // Before the fix: mesh.visible stays true; after: it must be false
    pickup.mesh.visible = true;
    applyDimmingWithGuard(pickup, 1.0);

    expect(pickup.mesh.visible).toBe(false);
  });

  it('inactive pickup opacity is NOT set to near-zero (guard returns early)', () => {
    const pickup = makeFakePickup(false, 0.02);
    pickup.mesh.visible = true;

    applyDimmingWithGuard(pickup, 0.35);

    // Guard returned before modifying opacity — original baseOpacity preserved
    pickup.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshBasicMaterial;
        // Guard returns early, so mat.opacity is unchanged (still 0.8 from setup)
        expect(mat.opacity).toBe(0.8);
      }
    });
  });

  it('dimming loop processes active pickups while skipping inactive ones in a mixed array', () => {
    const active1 = makeFakePickup(true, 1.0);
    const expired = makeFakePickup(false, 0.02);
    const active2 = makeFakePickup(true, 1.0);

    const pickups = [active1, expired, active2];
    pickups.forEach((p) => applyDimmingWithGuard(p, 0.5));

    // Active pickups: opacity modified
    let activeOpacity1 = 0;
    active1.mesh.traverse((c) => {
      if (c instanceof THREE.Mesh) activeOpacity1 = (c.material as THREE.MeshBasicMaterial).opacity;
    });
    expect(activeOpacity1).toBeCloseTo(0.4); // 0.8 * 1.0 * 0.5

    // Expired pickup: mesh hidden
    expect(expired.mesh.visible).toBe(false);

    // Active2: also dimmed
    let activeOpacity2 = 0;
    active2.mesh.traverse((c) => {
      if (c instanceof THREE.Mesh) activeOpacity2 = (c.material as THREE.MeshBasicMaterial).opacity;
    });
    expect(activeOpacity2).toBeCloseTo(0.4);
  });
});
