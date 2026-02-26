import { describe, it, expect } from 'vitest';
import {
  UPGRADE_TREES,
  getAllNodes,
  getNodeById,
  getBranchNodes,
  getUpgradeTree,
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

  it('each weapon tree has exactly 6 nodes (3 per branch)', () => {
    for (const tree of Object.values(UPGRADE_TREES)) {
      expect(tree.nodes.length).toBe(6);
      const branchA = tree.nodes.filter(n => n.branch === 'a');
      const branchB = tree.nodes.filter(n => n.branch === 'b');
      expect(branchA.length).toBe(3);
      expect(branchB.length).toBe(3);
    }
  });

  it('total node count across all weapons is 60', () => {
    expect(getAllNodes().length).toBe(60);
  });

  it('every node id follows the pattern "${weaponType}_${branch}_${nodeIndex}"', () => {
    for (const node of getAllNodes()) {
      const expected = `${node.id.split('_').slice(0, -2).join('_')}_${node.branch}_${node.nodeIndex}`;
      // Reconstruct weapon type from id by removing _branch_index suffix
      const parts = node.id.split('_');
      const branch = parts[parts.length - 2];
      const idx = Number(parts[parts.length - 1]);
      expect(branch).toMatch(/^[ab]$/);
      expect(idx).toBeGreaterThanOrEqual(1);
      expect(idx).toBeLessThanOrEqual(3);
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

  it('kill thresholds for node index 2 are 25', () => {
    const nodes = getAllNodes().filter(n => n.nodeIndex === 2);
    for (const n of nodes) {
      expect(n.killThreshold).toBe(25);
    }
  });

  it('kill thresholds for node index 3 are 50', () => {
    const nodes = getAllNodes().filter(n => n.nodeIndex === 3);
    for (const n of nodes) {
      expect(n.killThreshold).toBe(50);
    }
  });

  it('every node has a non-empty description and effect', () => {
    for (const node of getAllNodes()) {
      expect(node.description.length).toBeGreaterThan(0);
      expect(node.effect.length).toBeGreaterThan(0);
    }
  });
});

describe('getUpgradeTree', () => {
  it('returns the correct tree for a weapon type', () => {
    const tree = getUpgradeTree(WeaponType.PlasmaMortar);
    expect(tree.weaponType).toBe(WeaponType.PlasmaMortar);
    expect(tree.nodes.length).toBe(6);
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
    expect(nodes.length).toBe(3);
    for (const n of nodes) {
      expect(n.branch).toBe('a');
    }
  });

  it('returns only branch-b nodes for a weapon', () => {
    const nodes = getBranchNodes(WeaponType.TeslaCoil, 'b');
    expect(nodes.length).toBe(3);
    for (const n of nodes) {
      expect(n.branch).toBe('b');
    }
  });

  it('branch nodes are ordered by nodeIndex', () => {
    const nodes = getBranchNodes(WeaponType.BlackHole, 'a');
    expect(nodes[0].nodeIndex).toBe(1);
    expect(nodes[1].nodeIndex).toBe(2);
    expect(nodes[2].nodeIndex).toBe(3);
  });
});

describe('plasma_mortar node ids', () => {
  it('generates correct ids with underscore weapon type', () => {
    const ids = UPGRADE_TREES[WeaponType.PlasmaMortar].nodes.map(n => n.id);
    expect(ids).toContain('plasma_mortar_a_1');
    expect(ids).toContain('plasma_mortar_a_2');
    expect(ids).toContain('plasma_mortar_a_3');
    expect(ids).toContain('plasma_mortar_b_1');
    expect(ids).toContain('plasma_mortar_b_2');
    expect(ids).toContain('plasma_mortar_b_3');
  });
});
