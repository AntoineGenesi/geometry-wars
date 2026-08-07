import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MASTERY_THRESHOLDS, getMasteryThresholds } from '../../src/buffs/WeaponMasteryManager';
import { LEVEL_THRESHOLDS } from '../../src/shared/GameBalanceConstants';
import {
  MasteryStore,
  XP_PER_KILL,
  XP_THRESHOLDS,
  getMasteryXPEarnMultiplier,
  getMasteryXPScale,
} from '../../src/systems/MasteryStore';
import { UPGRADE_TREES, getTreeInvestmentCapacity } from '../../src/systems/UpgradeTreeData';
import { WeaponType } from '../../src/weapons/WeaponTypes';

const REPORT_DIR = resolve(process.cwd(), 'reports');
const KILLS_PER_GAME_SCENARIOS = [150, 300];
const MAX_GAMES = 300;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');

interface LevelTiming {
  level: number;
  game: number;
  kills: number;
  xp: number;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function levelForXP(xp: number): number {
  let level = 0;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i;
    else break;
  }
  return level;
}

function simulatePassiveMastery(killsPerGame: number, weapon: WeaponType): LevelTiming[] {
  const original = globalThis.localStorage;
  const memoryStorage = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
    };
  })();

  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
  });

  try {
    const store = MasteryStore.load();
    const timings: LevelTiming[] = [];
    let lastLevel = 0;
    for (let game = 1; game <= MAX_GAMES; game++) {
      store.awardGameXP(new Map([[weapon, killsPerGame]]));
      const xp = store.getXP(weapon);
      const level = levelForXP(xp);
      if (level > lastLevel) {
        timings.push({ level, game, kills: game * killsPerGame, xp: round(xp) });
        lastLevel = level;
      }
      if (level >= 5) break;
    }
    return timings;
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      value: original,
      configurable: true,
    });
  }
}

function main(): void {
  const variantArg = process.argv.find(arg => arg.startsWith('--variant='));
  const variant = variantArg?.split('=')[1] || 'current';
  const weapon = WeaponType.Standard;
  const tree = UPGRADE_TREES[weapon];
  const xpScale = getMasteryXPScale(weapon);
  const xpEarnMultiplier = getMasteryXPEarnMultiplier(weapon);
  const passive = Object.fromEntries(
    KILLS_PER_GAME_SCENARIOS.map(killsPerGame => [
      `${killsPerGame}_kills_per_game`,
      simulatePassiveMastery(killsPerGame, weapon),
    ]),
  );

  const report = {
    variant,
    generatedAt: new Date().toISOString(),
    codePath: [
      'src/main.ts awards post-game XP through MasteryStore.awardGameXP(killsByWeapon)',
      'src/main.ts awards in-match mastery buffs through WeaponMasteryManager.recordKill()',
      'src/main.ts/MatchUpgradeTracker activates permanent nodes when node killThreshold is crossed',
      'src/core/GameLoop.ts samples DDA player power from rawScore, multipliedScore, blasterDps, activeWeaponDps, companions, survival, streak, and totalKills',
    ],
    blaster: {
      weaponType: weapon,
      xpPerKillBase: XP_PER_KILL,
      xpScale: round(xpScale),
      xpEarnMultiplier: round(xpEarnMultiplier),
      effectiveXPPerKillFirstGame: round(XP_PER_KILL * xpScale * xpEarnMultiplier),
      xpThresholds: XP_THRESHOLDS,
      passiveLevelTiming: passive,
      playerLevelThresholds: LEVEL_THRESHOLDS,
      defaultMasteryBuffThresholds: MASTERY_THRESHOLDS,
      blasterMasteryBuffThresholds: getMasteryThresholds(weapon),
      treeInvestmentCapacity: getTreeInvestmentCapacity(tree),
      nodeCount: tree.nodes.length,
      nodeThresholds: tree.nodes
        .map(node => ({
          id: node.id,
          threshold: node.killThreshold,
          cost: node.cost ?? 1,
          branch: node.branch,
          parentId: node.parentId ?? null,
        }))
        .sort((a, b) => a.threshold - b.threshold || a.id.localeCompare(b.id)),
    },
    ddaStabilityCheck: {
      playerPowerModelInputsIncludePersistentMasteryXP: false,
      playerPowerModelInputsIncludeMasteryPointStoreTotals: false,
      playerPowerModelStableInputs: [
        'rawScore',
        'multipliedScore',
        'survivalSeconds',
        'streak',
        'totalKills',
        'blasterDps',
        'activeWeaponDps',
        'companionDps',
      ],
      note: 'DDA reacts to actual runtime damage/fire-rate/projectile output and stable score/kill fields, not directly to saved mastery XP or point totals.',
    },
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = resolve(REPORT_DIR, `weapon-mastery-blaster-pacing-${variant}-${RUN_ID}.json`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(jsonPath);
}

main();
