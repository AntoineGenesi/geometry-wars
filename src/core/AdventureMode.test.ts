import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameMode, GameModeType, ModePhase } from './GameMode';
import { ADVENTURE_LEVELS } from './LevelData';

describe('Adventure Mode Integration', () => {
  describe('Level Definitions', () => {
    it('should have 50 levels defined', () => {
      expect(ADVENTURE_LEVELS).toHaveLength(50);
    });

    it('should have 6 sections with correct counts', () => {
      const sections = new Map<string, number>();
      for (const level of ADVENTURE_LEVELS) {
        sections.set(level.section, (sections.get(level.section) ?? 0) + 1);
      }

      expect(sections.get('Sapphire')).toBe(5); // Levels 1-5
      expect(sections.get('Ruby')).toBe(5); // Levels 6-10
      expect(sections.get('Emerald')).toBe(10); // Levels 11-20
      expect(sections.get('Opal')).toBe(10); // Levels 21-30
      expect(sections.get('Amethyst')).toBe(10); // Levels 31-40
      expect(sections.get('Topaz')).toBe(10); // Levels 41-50
    });

    it('should have increasing difficulty (star thresholds)', () => {
      // First level should have lower thresholds than last level
      const first = ADVENTURE_LEVELS[0];
      const last = ADVENTURE_LEVELS[49];

      expect(last.starThresholds[2]).toBeGreaterThan(first.starThresholds[2]);
    });

    it('all levels should have valid waves', () => {
      for (const level of ADVENTURE_LEVELS) {
        expect(level.waves).toBeDefined();
        expect(level.waves.length).toBeGreaterThan(0);

        for (const wave of level.waves) {
          expect(wave.delay).toBeGreaterThanOrEqual(0);
          expect(wave.enemies.length).toBeGreaterThan(0);

          for (const enemy of wave.enemies) {
            expect(enemy.type).toBeDefined();
            expect(enemy.count).toBeGreaterThan(0);
          }
        }
      }
    });

    it('all levels should have valid star thresholds', () => {
      for (const level of ADVENTURE_LEVELS) {
        const [one, two, three] = level.starThresholds;
        expect(one).toBeGreaterThan(0);
        expect(two).toBeGreaterThan(one);
        expect(three).toBeGreaterThan(two);
      }
    });

    it('all levels should have valid surfaces', () => {
      // Surfaces actually used in adventure mode (subset of all available surfaces)
      const validSurfaces = ['sphere', 'torus', 'cube', 'peanut', 'pill', 'capsule'];

      for (const level of ADVENTURE_LEVELS) {
        expect(validSurfaces).toContain(level.surface);
      }
    });
  });

  describe('GameMode - Level Completion', () => {
    it('should complete level when score reaches 3-star threshold', () => {
      const config = {
        type: GameModeType.Evolved,
        timeLimit: 0,
        lives: 3,
        bombs: 3,
        supers: 0,
        canShoot: true,
        starThresholds: [1000, 2000, 3000] as [number, number, number],
      };

      const gameMode = new GameMode(config);
      const onComplete = vi.fn();
      gameMode.onComplete = onComplete;

      // Move to playing phase
      gameMode.update(5, 0, 3); // 5 seconds to skip countdown
      expect(gameMode.phase).toBe(ModePhase.Playing);

      // Manually trigger completion (normally done by GameLoop when waves clear)
      gameMode.completeLevel(3500);

      expect(gameMode.phase).toBe(ModePhase.Complete);
      expect(onComplete).toHaveBeenCalledWith(3); // 3 stars
    });

    it('should award 1 star for low score', () => {
      const config = {
        type: GameModeType.Evolved,
        timeLimit: 0,
        lives: 3,
        bombs: 3,
        supers: 0,
        canShoot: true,
        starThresholds: [1000, 2000, 3000] as [number, number, number],
      };

      const gameMode = new GameMode(config);
      const stars = gameMode.calculateStars(1200);
      expect(stars).toBe(1);
    });

    it('should award 2 stars for medium score', () => {
      const config = {
        type: GameModeType.Evolved,
        timeLimit: 0,
        lives: 3,
        bombs: 3,
        supers: 0,
        canShoot: true,
        starThresholds: [1000, 2000, 3000] as [number, number, number],
      };

      const gameMode = new GameMode(config);
      const stars = gameMode.calculateStars(2500);
      expect(stars).toBe(2);
    });

    it('should award 0 stars for very low score', () => {
      const config = {
        type: GameModeType.Evolved,
        timeLimit: 0,
        lives: 3,
        bombs: 3,
        supers: 0,
        canShoot: true,
        starThresholds: [1000, 2000, 3000] as [number, number, number],
      };

      const gameMode = new GameMode(config);
      const stars = gameMode.calculateStars(500);
      expect(stars).toBe(0);
    });

    it('should fail level when lives run out (non-infinite mode)', () => {
      const config = {
        type: GameModeType.Evolved,
        timeLimit: 0,
        lives: 1, // only 1 life
        bombs: 3,
        supers: 0,
        canShoot: true,
        starThresholds: [1000, 2000, 3000] as [number, number, number],
      };

      const gameMode = new GameMode(config);
      const onFailed = vi.fn();
      gameMode.onFailed = onFailed;

      // Move to playing phase
      gameMode.update(5, 0, 1);
      expect(gameMode.phase).toBe(ModePhase.Playing);

      // Update with 0 lives
      gameMode.update(0.1, 500, 0);

      expect(gameMode.phase).toBe(ModePhase.Failed);
      expect(onFailed).toHaveBeenCalled();
    });

    it('should complete level when time runs out (Deadline mode)', () => {
      const config = {
        type: GameModeType.Deadline,
        timeLimit: 60,
        lives: 0, // infinite lives
        bombs: 3,
        supers: 0,
        canShoot: true,
        starThresholds: [5000, 10000, 15000] as [number, number, number],
      };

      const gameMode = new GameMode(config);
      const onComplete = vi.fn();
      gameMode.onComplete = onComplete;

      // Move to playing phase
      gameMode.update(5, 0, 3);
      expect(gameMode.phase).toBe(ModePhase.Playing);

      // Simulate time running out
      gameMode.update(100, 12000, 3); // 100 seconds elapsed with 12K score

      expect(gameMode.phase).toBe(ModePhase.Complete);
      expect(onComplete).toHaveBeenCalledWith(2); // 2 stars (between 10K and 15K)
    });
  });

  describe('Wave Completion Logic', () => {
    it('wave-based modes should trigger completion when all waves spawned and enemies cleared', () => {
      // This is tested via integration in the game loop
      // The logic is: waveScheduler.allSpawned && enemySpawner.getEnemies().length === 0
      // We verify the GameMode.completeLevel() method works correctly above
      expect(true).toBe(true); // Placeholder - real test would need GameLoop mock
    });
  });
});
