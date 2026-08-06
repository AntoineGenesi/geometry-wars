import { describe, it, expect } from 'vitest';
import {
  UPGRADE_TREES,
  getAllNodes,
  getNodeById,
  getBranchNodes,
  getUpgradeTree,
  getNodeMaxPoints,
  getNodeInvestmentCapacity,
  getTreeInvestmentCapacity,
  getInvestmentCapacityByWeapon,
  getExcludedBy,
  isExcluded,
  type UpgradeNode,
} from './UpgradeTreeData';
import { WeaponType } from '../weapons/WeaponTypes';

describe('UPGRADE_TREES', () => {
  it('has entries for all 10 weapon types', () => {
    const weaponTypes = Object.values(WeaponType);
    expect(weaponTypes.length).toBe(10);
    for (const wt of weaponTypes) {
      expect(UPGRADE_TREES[wt]).toBeDefined();
    }
  });

  it('Standard has 4-endpoint branching tree with explicit endpoint labels', () => {
    const tree = UPGRADE_TREES[WeaponType.Standard];
    const branchA = tree.nodes.filter(n => n.branch === 'a');
    const branchB = tree.nodes.filter(n => n.branch === 'b');
    expect(branchA.length).toBeGreaterThan(0);
    expect(branchB.length).toBeGreaterThan(0);
    const branchAL = tree.nodes.filter(n => n.branch === 'al');
    const branchAR = tree.nodes.filter(n => n.branch === 'ar');
    const branchBL = tree.nodes.filter(n => n.branch === 'bl');
    const branchBR = tree.nodes.filter(n => n.branch === 'br');
    expect(branchAL.length).toBeGreaterThan(0);
    expect(branchAR.length).toBeGreaterThan(0);
    expect(branchBL.length).toBeGreaterThan(0);
    expect(branchBR.length).toBeGreaterThan(0);
  });

  it('Standard has 4 sub-branch names for 4-endpoint display', () => {
    const tree = UPGRADE_TREES[WeaponType.Standard];
    expect(tree.branchALName).toBeTruthy();
    expect(tree.branchARName).toBeTruthy();
    expect(tree.branchBLName).toBeTruthy();
    expect(tree.branchBRName).toBeTruthy();
  });

  it('Standard has explicit svgHeight for branching layout', () => {
    expect(UPGRADE_TREES[WeaponType.Standard].svgHeight).toBe(390);
  });

  it('Standard sub-branch nodes connect via parentId', () => {
    const tree = UPGRADE_TREES[WeaponType.Standard];
    // Sub-branch root nodes should have parentId pointing to trunk split node
    const al5 = tree.nodes.find(n => n.id === 'standard_al_5');
    const ar5 = tree.nodes.find(n => n.id === 'standard_ar_5');
    const bl5 = tree.nodes.find(n => n.id === 'standard_bl_5');
    const br5 = tree.nodes.find(n => n.id === 'standard_br_5');
    expect(al5?.parentId).toBe('standard_a_4');
    expect(ar5?.parentId).toBe('standard_a_4');
    expect(bl5?.parentId).toBe('standard_b_4');
    expect(br5?.parentId).toBe('standard_b_4');
  });

  it('Standard premium sub-branch nodes (AR, BR) cost 2 points', () => {
    const ar5 = getNodeById('standard_ar_5');
    const br5 = getNodeById('standard_br_5');
    expect(ar5?.cost).toBe(2);
    expect(br5?.cost).toBe(2);
  });

  it('Standard regular sub-branch nodes (AL, BL) cost 1 point (default)', () => {
    const al5 = getNodeById('standard_al_5');
    const bl5 = getNodeById('standard_bl_5');
    // cost is undefined (default 1) for regular nodes
    expect(al5?.cost).toBeUndefined();
    expect(bl5?.cost).toBeUndefined();
  });

  it('Standard has explicit x/y positions on all nodes', () => {
    const tree = UPGRADE_TREES[WeaponType.Standard];
    for (const n of tree.nodes) {
      expect(n.x).toBeDefined();
      expect(n.y).toBeDefined();
    }
  });

  it('Homing has two non-empty branches without pinning filler count', () => {
    const tree = UPGRADE_TREES[WeaponType.Homing];
    const branchA = tree.nodes.filter(n => n.branch === 'a');
    const branchB = tree.nodes.filter(n => n.branch === 'b');
    expect(branchA.length).toBeGreaterThan(0);
    expect(branchB.length).toBeGreaterThan(0);
  });

  it('weapons without extended branches have non-empty A/B branches', () => {
    const fiveLevelWeapons = [
      WeaponType.ChainLightning,
      WeaponType.PlasmaMortar,
      WeaponType.GravityGun,
      WeaponType.LaserBeam,
      WeaponType.TeslaCoil,
    ];
    for (const wt of fiveLevelWeapons) {
      const tree = UPGRADE_TREES[wt];
      const branchA = tree.nodes.filter(n => n.branch === 'a');
      const branchB = tree.nodes.filter(n => n.branch === 'b');
      expect(branchA.length).toBeGreaterThan(0);
      expect(branchB.length).toBeGreaterThan(0);
    }
  });

  it('Spread, Piercing, BlackHole have 4-endpoint branching metadata', () => {
    const branchingWeapons = [WeaponType.Spread, WeaponType.Piercing, WeaponType.BlackHole];
    for (const wt of branchingWeapons) {
      const tree = UPGRADE_TREES[wt];
      expect(tree.nodes.filter(n => n.branch === 'a').length).toBeGreaterThan(0);
      expect(tree.nodes.filter(n => n.branch === 'b').length).toBeGreaterThan(0);
      expect(tree.nodes.filter(n => n.branch === 'al').length).toBeGreaterThan(0);
      expect(tree.nodes.filter(n => n.branch === 'ar').length).toBeGreaterThan(0);
      expect(tree.nodes.filter(n => n.branch === 'bl').length).toBeGreaterThan(0);
      expect(tree.nodes.filter(n => n.branch === 'br').length).toBeGreaterThan(0);
      expect(tree.branchALName).toBeTruthy();
      expect(tree.branchARName).toBeTruthy();
      expect(tree.branchBLName).toBeTruthy();
      expect(tree.branchBRName).toBeTruthy();
      // All nodes have explicit x/y positions
      for (const n of tree.nodes) {
        expect(n.x).toBeDefined();
        expect(n.y).toBeDefined();
      }
    }
  });

  it('does not require a fixed total node count', () => {
    expect(getAllNodes().length).toBeGreaterThan(Object.values(WeaponType).length);
  });

  it('every node id follows the pattern "${weaponType}_${branch}_${nodeIndex}"', () => {
    for (const n of getAllNodes()) {
      // branch may be a, b, al, ar, bl, br
      const parts = n.id.split('_');
      const idx = Number(parts[parts.length - 1]);
      const branch = parts[parts.length - 2];
      expect(branch).toMatch(/^(a|b|al|ar|bl|br)$/);
      expect(idx).toBeGreaterThanOrEqual(1);
      expect(idx).toBeLessThanOrEqual(10);
      expect(n.branch).toBe(branch);
      expect(n.nodeIndex).toBe(idx);
    }
  });

  it('all node IDs are globally unique', () => {
    const ids = getAllNodes().map(n => n.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('kill thresholds for node index 1 are 10 (for all main-branch root nodes)', () => {
    // Filter to just the main branch trunk nodes at nodeIndex=1
    const nodes = getAllNodes().filter(n => n.nodeIndex === 1);
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(n.killThreshold).toBe(10);
    }
  });

  it('kill thresholds for node index 5 are 120', () => {
    // Standard sub-branch nodes at nodeIndex=5 (al_5, ar_5, bl_5, br_5) + other weapons' a_5/b_5
    const nodes = getAllNodes().filter(n => n.nodeIndex === 5);
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(n.killThreshold).toBe(120);
    }
  });

  it('kill thresholds for node index 10 are 650', () => {
    const nodes = getAllNodes().filter(n => n.nodeIndex === 10);
    expect(nodes.length).toBeGreaterThan(0); // Standard (al,ar,bl,br _10) + Homing (a_10, b_10)
    for (const n of nodes) {
      expect(n.killThreshold).toBe(650);
    }
  });

  it('every node has a non-empty description and effect', () => {
    for (const n of getAllNodes()) {
      expect(n.description.length).toBeGreaterThan(0);
      expect(n.effect.length).toBeGreaterThan(0);
    }
  });

  it('each weapon tree has non-empty branchAName and branchBName', () => {
    for (const tree of Object.values(UPGRADE_TREES)) {
      expect(tree.branchAName.length).toBeGreaterThan(0);
      expect(tree.branchBName.length).toBeGreaterThan(0);
    }
  });

  it('computes investment capacity from retained nodes instead of fixed node counts', () => {
    const standard = UPGRADE_TREES[WeaponType.Standard];
    const blackHoleA1 = getNodeById('black_hole_a_1')!;
    const standardAr5 = getNodeById('standard_ar_5')!;

    expect(getNodeInvestmentCapacity(blackHoleA1)).toBe(3);
    expect(getNodeInvestmentCapacity(standardAr5)).toBe(2);
    expect(getTreeInvestmentCapacity(standard)).toBeGreaterThan(standard.nodes.length);

    const capacities = getInvestmentCapacityByWeapon();
    expect(capacities[WeaponType.Standard]).toBe(getTreeInvestmentCapacity(standard));
    for (const weaponType of Object.values(WeaponType)) {
      expect(capacities[weaponType]).toBeGreaterThan(0);
    }
  });
});

describe('getUpgradeTree', () => {
  it('returns the correct tree for a weapon type', () => {
    const tree = getUpgradeTree(WeaponType.PlasmaMortar);
    expect(tree.weaponType).toBe(WeaponType.PlasmaMortar);
    expect(tree.nodes.length).toBeGreaterThan(0);
  });
});

describe('getNodeById', () => {
  it('returns the correct node by id', () => {
    const n = getNodeById('plasma_mortar_a_1');
    expect(n).toBeDefined();
    expect(n!.id).toBe('plasma_mortar_a_1');
    expect(n!.branch).toBe('a');
    expect(n!.nodeIndex).toBe(1);
    expect(n!.killThreshold).toBe(10);
  });

  it('returns the correct sub-branch node by id (Standard al_5)', () => {
    const n = getNodeById('standard_al_5');
    expect(n).toBeDefined();
    expect(n!.branch).toBe('al');
    expect(n!.nodeIndex).toBe(5);
    expect(n!.parentId).toBe('standard_a_4');
  });

  it('returns undefined for unknown id', () => {
    expect(getNodeById('unknown_weapon_a_1')).toBeUndefined();
  });
});

describe('getBranchNodes', () => {
  it('returns only branch-a trunk nodes for Standard', () => {
    const nodes = getBranchNodes(WeaponType.Standard, 'a');
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(n.branch).toBe('a');
    }
  });

  it('returns only branch-al sub-branch nodes for Standard', () => {
    const nodes = getBranchNodes(WeaponType.Standard, 'al');
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(n.branch).toBe('al');
    }
  });

  it('returns only branch-b nodes for TeslaCoil', () => {
    const nodes = getBranchNodes(WeaponType.TeslaCoil, 'b');
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(n.branch).toBe('b');
    }
  });

  it('BlackHole branch-a trunk nodes are in node-index order', () => {
    const nodes = getBranchNodes(WeaponType.BlackHole, 'a');
    expect(nodes.length).toBeGreaterThan(0);
    const indexes = nodes.map(n => n.nodeIndex);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });
});

describe('plasma_mortar node ids', () => {
  it('generates correct ids with underscore weapon type', () => {
    const ids = UPGRADE_TREES[WeaponType.PlasmaMortar].nodes.map(n => n.id);
    expect(ids).toContain('plasma_mortar_a_1');
    expect(ids).toContain('plasma_mortar_a_2');
    expect(ids).toContain('plasma_mortar_a_3');
    expect(ids).toContain('plasma_mortar_a_4');
    expect(ids).toContain('plasma_mortar_a_5');
    expect(ids).toContain('plasma_mortar_b_1');
    expect(ids).toContain('plasma_mortar_b_2');
    expect(ids).toContain('plasma_mortar_b_3');
    expect(ids).toContain('plasma_mortar_b_4');
    expect(ids).toContain('plasma_mortar_b_5');
  });
});

describe('multi-level nodes (maxPoints > 1)', () => {
  it('BlackHole a_1 has maxPoints: 3', () => {
    const n = getNodeById('black_hole_a_1');
    expect(n).toBeDefined();
    expect(getNodeMaxPoints(n!)).toBe(3);
  });

  it('BlackHole b_1 has maxPoints: 3', () => {
    const n = getNodeById('black_hole_b_1');
    expect(n).toBeDefined();
    expect(getNodeMaxPoints(n!)).toBe(3);
  });

  it('Homing a_1 has maxPoints: 2', () => {
    const n = getNodeById('homing_a_1');
    expect(n).toBeDefined();
    expect(getNodeMaxPoints(n!)).toBe(2);
  });

  it('Homing b_1 has maxPoints: 2', () => {
    const n = getNodeById('homing_b_1');
    expect(n).toBeDefined();
    expect(getNodeMaxPoints(n!)).toBe(2);
  });

  it('standard nodes (no maxPoints) default to 1 via getNodeMaxPoints', () => {
    const n = getNodeById('standard_a_2');
    expect(n).toBeDefined();
    expect(getNodeMaxPoints(n!)).toBe(1);
  });

  it('getNodeMaxPoints returns 1 for nodes without maxPoints field', () => {
    const syntheticNode: UpgradeNode = {
      id: 'test',
      branch: 'a',
      nodeIndex: 1,
      description: 'test',
      killThreshold: 10,
      effect: 'test',
    };
    expect(getNodeMaxPoints(syntheticNode)).toBe(1);
  });
});

describe('Standard 4-endpoint node ids', () => {
  it('has trunk nodes a_1 through a_4 and b_1 through b_4', () => {
    const ids = UPGRADE_TREES[WeaponType.Standard].nodes.map(n => n.id);
    for (let i = 1; i <= 4; i++) {
      expect(ids).toContain(`standard_a_${i}`);
      expect(ids).toContain(`standard_b_${i}`);
    }
  });

  it('has sub-branch nodes al_5..al_10 and ar_5..ar_10', () => {
    const ids = UPGRADE_TREES[WeaponType.Standard].nodes.map(n => n.id);
    for (let i = 5; i <= 10; i++) {
      expect(ids).toContain(`standard_al_${i}`);
      expect(ids).toContain(`standard_ar_${i}`);
      expect(ids).toContain(`standard_bl_${i}`);
      expect(ids).toContain(`standard_br_${i}`);
    }
  });

  it('has 4 distinct endpoints at level 10', () => {
    const endpoints = UPGRADE_TREES[WeaponType.Standard].nodes.filter(n => n.nodeIndex === 10);
    expect(endpoints.length).toBe(4);
    const branches = endpoints.map(n => n.branch).sort();
    expect(branches).toEqual(['al', 'ar', 'bl', 'br']);
  });
});

describe('Homing 10-level branch node ids', () => {
  it('has nodes a_1 through a_10 and b_1 through b_10', () => {
    const ids = UPGRADE_TREES[WeaponType.Homing].nodes.map(n => n.id);
    for (let i = 1; i <= 10; i++) {
      expect(ids).toContain(`homing_a_${i}`);
      expect(ids).toContain(`homing_b_${i}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Exclusion system tests
// ---------------------------------------------------------------------------

/** Minimal PointLookup stub — maps node id → points (default 0). */
function makePointStore(unlocked: Record<string, number> = {}) {
  return { getNodePoints: (id: string) => unlocked[id] ?? 0 };
}

describe('Standard exclusionPairs data', () => {
  it('Standard tree has no arbitrary exclusionPairs', () => {
    const tree = UPGRADE_TREES[WeaponType.Standard];
    expect(tree.exclusionPairs ?? []).toEqual([]);
  });

  it('Standard Scatter and Rapid Fire roots are intentionally combinable', () => {
    const tree = UPGRADE_TREES[WeaponType.Standard];

    expect(isExcluded('standard_ar_5', tree, makePointStore({ 'standard_al_5': 1 }))).toBe(false);
    expect(isExcluded('standard_al_5', tree, makePointStore({ 'standard_ar_5': 1 }))).toBe(false);
    expect(getExcludedBy('standard_ar_5', tree, makePointStore({ 'standard_al_5': 1 }))).toEqual([]);
  });

  it('Standard Seeking and Devastation roots are intentionally combinable', () => {
    const tree = UPGRADE_TREES[WeaponType.Standard];

    expect(isExcluded('standard_br_5', tree, makePointStore({ 'standard_bl_5': 1 }))).toBe(false);
    expect(isExcluded('standard_bl_5', tree, makePointStore({ 'standard_br_5': 1 }))).toBe(false);
    expect(getExcludedBy('standard_br_5', tree, makePointStore({ 'standard_bl_5': 1 }))).toEqual([]);
  });

  it('Standard Ring shot and Machine gun are intentionally combinable', () => {
    const tree = UPGRADE_TREES[WeaponType.Standard];

    expect(isExcluded('standard_al_7', tree, makePointStore({ 'standard_ar_7': 1 }))).toBe(false);
    expect(isExcluded('standard_ar_7', tree, makePointStore({ 'standard_al_7': 1 }))).toBe(false);
    expect(getExcludedBy('standard_ar_7', tree, makePointStore({ 'standard_al_7': 1 }))).toEqual([]);
  });
});

describe('Black Hole exclusionPairs data', () => {
  it('Black Hole tree contains only the proven Multi Void vs Giant Void root conflict', () => {
    const tree = UPGRADE_TREES[WeaponType.BlackHole];
    expect(tree.exclusionPairs).toEqual([
      ['black_hole_al_4', 'black_hole_ar_4'],
    ]);
  });

  it('Black Hole AL root excludes AR root bidirectionally', () => {
    const tree = UPGRADE_TREES[WeaponType.BlackHole];

    expect(isExcluded('black_hole_ar_4', tree, makePointStore({ 'black_hole_al_4': 1 }))).toBe(true);
    expect(isExcluded('black_hole_al_4', tree, makePointStore({ 'black_hole_ar_4': 1 }))).toBe(true);
    expect(getExcludedBy('black_hole_ar_4', tree, makePointStore({ 'black_hole_al_4': 1 }))).toEqual([
      'black_hole_al_4',
    ]);
    expect(getExcludedBy('black_hole_al_4', tree, makePointStore({ 'black_hole_ar_4': 1 }))).toEqual([
      'black_hole_ar_4',
    ]);
  });
});

describe('intentional synergy relationships', () => {
  it('Standard trunk A/B synergy candidate remains combinable', () => {
    const tree = UPGRADE_TREES[WeaponType.Standard];

    expect(isExcluded('standard_b_3', tree, makePointStore({ 'standard_a_3': 1 }))).toBe(false);
    expect(isExcluded('standard_a_3', tree, makePointStore({ 'standard_b_3': 1 }))).toBe(false);
    expect(getExcludedBy('standard_b_3', tree, makePointStore({ 'standard_a_3': 1 }))).toEqual([]);
  });
});

describe('isExcluded', () => {
  const tree = UPGRADE_TREES[WeaponType.Standard];

  it('returns false when no nodes are unlocked', () => {
    const ps = makePointStore();
    expect(isExcluded('standard_ar_5', tree, ps)).toBe(false);
    expect(isExcluded('standard_al_5', tree, ps)).toBe(false);
  });

  it('returns false for AR sub-branch root when AL root is unlocked', () => {
    const ps = makePointStore({ 'standard_al_5': 1 });
    expect(isExcluded('standard_ar_5', tree, ps)).toBe(false);
  });

  it('returns false for AL sub-branch root when AR root is unlocked', () => {
    const ps = makePointStore({ 'standard_ar_5': 1 });
    expect(isExcluded('standard_al_5', tree, ps)).toBe(false);
  });

  it('returns false for BR sub-branch root when BL root is unlocked', () => {
    const ps = makePointStore({ 'standard_bl_5': 1 });
    expect(isExcluded('standard_br_5', tree, ps)).toBe(false);
  });

  it('returns false for BL sub-branch root when BR root is unlocked', () => {
    const ps = makePointStore({ 'standard_br_5': 1 });
    expect(isExcluded('standard_bl_5', tree, ps)).toBe(false);
  });

  it('returns false for a node not involved in any exclusion pair', () => {
    const ps = makePointStore({ 'standard_al_5': 1 });
    // a_1 is a trunk node, not in any exclusion pair
    expect(isExcluded('standard_a_1', tree, ps)).toBe(false);
  });

  it('returns false when the other side of a pair has 0 points', () => {
    const ps = makePointStore({ 'standard_al_5': 0 });
    expect(isExcluded('standard_ar_5', tree, ps)).toBe(false);
  });

  it('does not exclude al_7 when ar_7 is unlocked', () => {
    const ps = makePointStore({ 'standard_ar_7': 1 });
    expect(isExcluded('standard_al_7', tree, ps)).toBe(false);
  });

  it('handles per-node excludes field on synthetic nodes', () => {
    const syntheticTree = {
      ...tree,
      nodes: [
        ...tree.nodes,
        {
          id: 'standard_x_99',
          branch: 'a' as const,
          nodeIndex: 9,
          description: 'test',
          killThreshold: 480,
          effect: 'test',
          excludes: ['standard_a_1'],
        },
      ],
      exclusionPairs: undefined,
    };
    const ps = makePointStore({ 'standard_x_99': 1 });
    expect(isExcluded('standard_a_1', syntheticTree, ps)).toBe(true);
    expect(isExcluded('standard_a_2', syntheticTree, ps)).toBe(false);
  });
});

describe('getExcludedBy', () => {
  const tree = UPGRADE_TREES[WeaponType.Standard];

  it('returns empty array when no nodes are unlocked', () => {
    const ps = makePointStore();
    expect(getExcludedBy('standard_ar_5', tree, ps)).toEqual([]);
  });

  it('returns no unlocked AL source for the AR root', () => {
    const ps = makePointStore({ 'standard_al_5': 1 });
    expect(getExcludedBy('standard_ar_5', tree, ps)).toEqual([]);
  });

  it('returns no unlocked AR source for the AL root', () => {
    const ps = makePointStore({ 'standard_ar_5': 1 });
    expect(getExcludedBy('standard_al_5', tree, ps)).toEqual([]);
  });

  it('returns no sources for formerly excluded Standard depth pairs', () => {
    const ps = makePointStore({ 'standard_al_5': 1, 'standard_al_7': 1 });
    const result = getExcludedBy('standard_ar_7', tree, ps);
    expect(result).toEqual([]);
  });

  it('returns empty array for a node not in any exclusion pair', () => {
    const ps = makePointStore({ 'standard_al_5': 1 });
    expect(getExcludedBy('standard_a_1', tree, ps)).toEqual([]);
  });
});
