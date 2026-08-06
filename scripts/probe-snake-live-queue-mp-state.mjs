#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GameRoom } from '../server/rooms/GameRoom.ts';
import { EnemyState, GameState } from '../server/schema/GameState.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REPORT_DIR = resolve(ROOT, 'reports');
const runId = new Date().toISOString().replace(/[:.]/g, '-');

function makeEnemy(id, type, health, u, v) {
  const enemy = new EnemyState();
  enemy.id = id;
  enemy.type = type;
  enemy.health = health;
  enemy.maxHealth = health;
  enemy.surfaceU = u;
  enemy.surfaceV = v;
  enemy.alive = true;
  return enemy;
}

function summarize(room) {
  const enemies = Array.from(room.state.enemies);
  return {
    totalRows: enemies.length,
    queuedRows: enemies.filter((enemy) => enemy.queued).length,
    normalRows: enemies.filter((enemy) => !enemy.queued).length,
    aliveRows: enemies.filter((enemy) => enemy.alive).length,
    aiRows: room.enemyAI.size,
    typeCounts: enemies.reduce((acc, enemy) => {
      const key = `${enemy.queued ? 'queued' : 'normal'}:${enemy.type}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

function runScenario(queueLength, difficulty = 0) {
  const room = new GameRoom();
  room.state = new GameState();
  room.state.roomPhase = 'playing';
  room.state.gameMode = 'pvpve';
  room.state.pvpMode = 'pvpve';
  room.enemyAI = new Map();
  room.computeDifficultyLevel = () => difficulty;

  const head = makeEnemy(`snake-${queueLength}`, 'snake', 6, 0.5, 0.5);
  room.state.enemies.push(head);
  room.enemyAI.set(head.id, { currentSpeed: 0.02 });
  for (let i = 0; i < queueLength; i++) {
    const segment = room.makeSnakeSegmentState(head, i);
    segment.health = i % 3 === 0 ? 5 : 2;
    segment.maxHealth = Math.max(segment.maxHealth, segment.health);
    room.state.enemies.push(segment);
  }

  const before = summarize(room);
  const released = room.removeKilledEnemyAt(0);
  const after = summarize(room);
  const releasedRows = Array.from(room.state.enemies).map((enemy) => ({
    id: enemy.id,
    type: enemy.type,
    queued: enemy.queued,
    parentId: enemy.parentId,
    queueIndex: enemy.queueIndex,
    health: enemy.health,
    maxHealth: enemy.maxHealth,
    hasAI: room.enemyAI.has(enemy.id),
  }));

  return { queueLength, difficulty, before, released, after, releasedRows };
}

mkdirSync(REPORT_DIR, { recursive: true });

const representative = runScenario(14, 0);
const latePerf = runScenario(50, 11);
const lateTypes = new Set(latePerf.releasedRows.map((row) => row.type));

const report = {
  verdict:
    representative.released === 14
    && representative.after.queuedRows === 0
    && representative.after.normalRows === 14
    && representative.releasedRows.every((row) => row.type === 'grunt' && !row.queued && row.parentId === '' && row.queueIndex === -1 && row.hasAI)
    && representative.releasedRows.some((row) => row.health === 3)
    && representative.releasedRows.some((row) => row.health === 1)
    && latePerf.released === 50
    && latePerf.after.totalRows === 50
    && ['grunt', 'weaver', 'spinner', 'neutron'].every((type) => lateTypes.has(type))
    && latePerf.releasedRows.every((row) => !row.queued && row.parentId === '' && row.queueIndex === -1 && row.hasAI)
    ? 'PASS'
    : 'FAIL',
  representative,
  latePerf,
  performanceSample: {
    queueLength: 50,
    beforeRows: latePerf.before.totalRows,
    afterRows: latePerf.after.totalRows,
    runawayHiddenRows: latePerf.after.queuedRows,
    releasedTypes: [...lateTypes].sort(),
    note: 'Head row is removed; queued segment rows flip in place into normal enemies, so release does not duplicate rows. At high difficulty, queued snake bodies mix grunt/weaver/spinner/neutron.',
  },
};

const reportPath = resolve(REPORT_DIR, `snake-live-queue-mp-state-${runId}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, verdict: report.verdict, performanceSample: report.performanceSample }, null, 2));
if (report.verdict !== 'PASS') process.exit(1);
process.exit(0);
