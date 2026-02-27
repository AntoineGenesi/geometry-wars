import { describe, it, expect } from 'vitest';
import {
  UPGRADE_TREES,
  getAllNodes,
  getNodeById,
  getBranchNodes,
  getUpgradeTree,
  getNodeMaxPoints,
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

  it('Standard has 10-level branches (20 nodes per weapon)', () => {
    const tree = UPGRADE_TREES[WeaponType.Standard];
    expect(tree.nodes.length).toBe(20);
    const branchA = tree.nodes.filter(n => n.branch === 'a');
    const branchB = tree.nodes.filter(n => n.branch === 'b');
    expect(branchA.length).toBe(10);
    expect(branchB.length).toBe(10);
  });

  it('Homing has 10-level branches (20 nodes per weapon)', () => {
    const tree = UPGRADE_TREES[WeaponType.Homing];
    expect(tree.nodes.length).toBe(20);
    const branchA = tree.nodes.filter(n => n.branch === 'a');
    const branchB = tree.nodes.filter(n => n.branch === 'b');
    expect(branchA.length).toBe(10);
    expect(branchB.length).toBe(10);
  });

  it('weapons without 10-level branches have exactly 10 nodes (5 per branch)', () => {
    const fiveLevelWeapons = [
      WeaponType.Spread,
      WeaponType.Piercing,
      WeaponType.ChainLightning,
      WeaponType.PlasmaMortar,
      WeaponType.GravityGun,
      WeaponType.LaserBeam,
      WeaponType.BlackHole,
      WeaponType.TeslaCoil,
    ];
    for (const wt of fiveLevelWeapons) {
      const tree = UPGRADE_TREES[wt];
      expect(tree.nodes.length).toBe(10);
      const branchA = tree.nodes.filter(n => n.branch === 'a');
      const branchB = tree.nodes.filter(n => n.branch === 'b');
      expect(branchA.length).toBe(5);
      expect(branchB.length).toBe(5);
    }
  });

  it('total node count accounts for extended branches (120 total)', () => {
    // Standard (20) + Homing (20) + 8 weapons × 10 = 120
    expect(getAllNodes().length).toBe(120);
  });

  it('every node id follows the pattern "${weaponType}_${branch}_${nodeIndex}"', () => {
    for (const node of getAllNodes()) {
      const parts = node.id.split('_');
      const branch = parts[parts.length - 2];
      const idx = Number(parts[parts.length - 1]);
      expect(branch).toMatch(/^[ab]$/);
      expect(idx).toBeGreaterThanOrEqual(1);
      expect(idx).toBeLessThanOrEqual(10);
      expect(node.branch).toBe(branch);
      expect(node.nodeIndex).toBe(idx);
    }
  });

  it('all node IDs are globally unique', () => {
    const ids = getAllNodes().map(n => n.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('kill thresholds for node index 1 are 10', () => {
    const nodes = getAllNodes().filter(n => n.nodeIndex === 1);
    for (const n of nodes) {
      expect(n.killThreshold).toBe(10);
    }
  });

  it('kill thresholds for node index 5 are 120', () => {
    const nodes = getAllNodes().filter(n => n.nodeIndex === 5);
    for (const n of nodes) {
      expect(n.killThreshold).toBe(120);
    }
  });

  it('kill thresholds for node index 10 are 650 (extended branches only)', () => {
    const nodes = getAllNodes().filter(n => n.nodeIndex === 10);
    expect(nodes.length).toBeGreaterThan(0); // Standard and Homing have level 10
    for (const n of nodes) {
      expect(n.killThreshold).toBe(650);
    }
  });

  it('every node has a non-empty description and effect', () => {
    for (const node of getAllNodes()) {
      expect(node.description.length).toBeGreaterThan(0);
      expect(node.effect.length).toBeGreaterThan(0);
    }
  });

  it('each weapon tree has non-empty branchAName and branchBName', () => {
    for (const tree of Object.values(UPGRADE_TREES)) {
      expect(tree.branchAName.length).toBeGreaterThan(0);
      expect(tree.branchBName.length).toBeGreaterThan(0);
    }
  });
});

describe('getUpgradeTree', () => {
  it('returns the correct tree for a weapon type', () => {
    const tree = getUpgradeTree(WeaponType.PlasmaMortar);
    expect(tree.weaponType).toBe(WeaponType.PlasmaMortar);
    expect(tree.nodes.length).toBe(10);
  });
});

describe('getNodeById', () => {
  it('returns the correct node by id', () => {
    const node = getNodeById('plasma_mortar_a_1');
    expect(node).toBeDefined();
    expect(node!.id).toBe('plasma_mortar_a_1');
    expect(node!.branch).toBe('a');
    expect(node!.nodeIndex).toBe(1);
    expect(node!.killThreshold).toBe(10);
  });

  it('returns undefined for unknown id', () => {
    expect(getNodeById('unknown_weapon_a_1')).toBeUndefined();
  });
});

describe('getBranchNodes', () => {
  it('returns only branch-a nodes for a weapon', () => {
    const nodes = getBranchNodes(WeaponType.Standard, 'a');
    expect(nodes.length).toBe(10); // Standard has 10-level branches
    for (const n of nodes) {
      expect(n.branch).toBe('a');
    }
  });

  it('returns only branch-b nodes for a weapon', () => {
    const nodes = getBranchNodes(WeaponType.TeslaCoil, 'b');
    expect(nodes.length).toBe(5);
    for (const n of nodes) {
      expect(n.branch).toBe('b');
    }
  });

  it('branch nodes are ordered by nodeIndex', () => {
    const nodes = getBranchNodes(WeaponType.BlackHole, 'a');
    expect(nodes[0].nodeIndex).toBe(1);
    expect(nodes[1].nodeIndex).toBe(2);
    expect(nodes[2].nodeIndex).toBe(3);
    expect(nodes[3].nodeIndex).toBe(4);
    expect(nodes[4].nodeIndex).toBe(5);
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
    const node = getNodeById('black_hole_a_1');
    expect(node).toBeDefined();
    expect(getNodeMaxPoints(node!)).toBe(3);
  });

  it('BlackHole b_1 has maxPoints: 3', () => {
    const node = getNodeById('black_hole_b_1');
    expect(node).toBeDefined();
    expect(getNodeMaxPoints(node!)).toBe(3);
  });

  it('standard nodes (no maxPoints) default to 1 via getNodeMaxPoints', () => {
    const node = getNodeById('standard_a_2');
    expect(node).toBeDefined();
    expect(getNodeMaxPoints(node!)).toBe(1);
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

describe('Standard 10-level branch node ids', () => {
  it('has nodes a_1 through a_10', () => {
    const ids = UPGRADE_TREES[WeaponType.Standard].nodes.map(n => n.id);
    for (let i = 1; i <= 10; i++) {
      expect(ids).toContain(`standard_a_${i}`);
      expect(ids).toContain(`standard_b_${i}`);
    }
  });
});

describe('Homing 10-level branch node ids', () => {
  it('has nodes a_1 through a_10', () => {
    const ids = UPGRADE_TREES[WeaponType.Homing].nodes.map(n => n.id);
    for (let i = 1; i <= 10; i++) {
      expect(ids).toContain(`homing_a_${i}`);
      expect(ids).toContain(`homing_b_${i}`);
    }
  });
});
