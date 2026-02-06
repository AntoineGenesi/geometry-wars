import * as THREE from 'three';

export enum SuperType {
  Homing = 'homing',
  Miner = 'miner',
  BlackHole = 'blackhole',
  Turret = 'turret',
  Clone = 'clone',
  Detonator = 'detonator',
}

export interface SuperConfig {
  type: SuperType;
  level: number; // 0-3
  duration: number; // seconds active
}

export abstract class SuperAbility {
  type: SuperType;
  level: number;
  active: boolean;
  timeRemaining: number;
  protected duration: number;

  // Visual feedback callbacks
  onMissileSpawn?: (origin: THREE.Vector3, target: THREE.Vector3) => void;
  onMinePlace?: (position: THREE.Vector3) => void;
  onExplosion?: (position: THREE.Vector3, radius: number) => void;

  constructor(config: SuperConfig) {
    this.type = config.type;
    this.level = config.level;
    this.duration = config.duration;
    this.active = false;
    this.timeRemaining = 0;
  }

  activate(playerU: number, playerV: number): void {
    this.active = true;
    this.timeRemaining = this.duration;
  }

  abstract update(dt: number, playerU: number, playerV: number, enemies: any[]): void;

  deactivate(): void {
    this.active = false;
    this.timeRemaining = 0;
  }
}

// Homing Missiles Super
interface HomingMissile {
  surfaceU: number;
  surfaceV: number;
  targetEnemy: any | null;
  speed: number;
  lifetime: number;
}

export class HomingSuper extends SuperAbility {
  private missiles: HomingMissile[] = [];
  private readonly missileSpeed = 1.5;
  private readonly missileLifetime = 5.0;

  constructor(config: SuperConfig) {
    super(config);
  }

  activate(playerU: number, playerV: number): void {
    super.activate(playerU, playerV);

    // Spawn 10-20 missiles based on level
    const missileCount = 10 + this.level * 3;

    for (let i = 0; i < missileCount; i++) {
      this.missiles.push({
        surfaceU: playerU,
        surfaceV: playerV,
        targetEnemy: null,
        speed: this.missileSpeed,
        lifetime: this.missileLifetime,
      });
    }
  }

  update(dt: number, playerU: number, playerV: number, enemies: any[]): void {
    if (!this.active) return;

    this.timeRemaining -= dt;
    if (this.timeRemaining <= 0) {
      this.deactivate();
      return;
    }

    // Update each missile
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const missile = this.missiles[i];
      missile.lifetime -= dt;

      if (missile.lifetime <= 0) {
        this.missiles.splice(i, 1);
        continue;
      }

      // Find nearest enemy if no target or target is dead
      if (!missile.targetEnemy || !enemies.includes(missile.targetEnemy)) {
        missile.targetEnemy = this.findNearestEnemy(missile.surfaceU, missile.surfaceV, enemies);
      }

      // Move toward target
      if (missile.targetEnemy) {
        const targetU = missile.targetEnemy.surfaceU ?? missile.targetEnemy.u ?? 0;
        const targetV = missile.targetEnemy.surfaceV ?? missile.targetEnemy.v ?? 0;

        const deltaU = targetU - missile.surfaceU;
        const deltaV = targetV - missile.surfaceV;
        const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

        if (distance > 0.01) {
          missile.surfaceU += (deltaU / distance) * missile.speed * dt;
          missile.surfaceV += (deltaV / distance) * missile.speed * dt;
        }

        // Check collision
        if (distance < 0.1) {
          if (this.onExplosion) {
            // Approximate world position for visual feedback
            this.onExplosion(new THREE.Vector3(), 0.2);
          }
          this.missiles.splice(i, 1);
        }
      }
    }
  }

  private findNearestEnemy(u: number, v: number, enemies: any[]): any | null {
    let nearest: any | null = null;
    let minDist = Infinity;

    for (const enemy of enemies) {
      const enemyU = enemy.surfaceU ?? enemy.u ?? 0;
      const enemyV = enemy.surfaceV ?? enemy.v ?? 0;
      const deltaU = enemyU - u;
      const deltaV = enemyV - v;
      const dist = deltaU * deltaU + deltaV * deltaV;

      if (dist < minDist) {
        minDist = dist;
        nearest = enemy;
      }
    }

    return nearest;
  }

  deactivate(): void {
    super.deactivate();
    this.missiles = [];
  }
}

// Miner Super
interface Mine {
  surfaceU: number;
  surfaceV: number;
  armed: boolean;
}

export class MinerSuper extends SuperAbility {
  private mines: Mine[] = [];
  private dropTimer = 0;
  private readonly dropInterval = 0.5;
  private readonly detonationRadius = 0.3;

  constructor(config: SuperConfig) {
    super({ ...config, duration: 8 });
  }

  activate(playerU: number, playerV: number): void {
    super.activate(playerU, playerV);
    this.mines = [];
    this.dropTimer = 0;
  }

  update(dt: number, playerU: number, playerV: number, enemies: any[]): void {
    if (!this.active) return;

    this.timeRemaining -= dt;
    if (this.timeRemaining <= 0) {
      this.deactivate();
      return;
    }

    // Drop mines periodically
    this.dropTimer += dt;
    if (this.dropTimer >= this.dropInterval) {
      this.dropTimer = 0;
      const mine: Mine = {
        surfaceU: playerU,
        surfaceV: playerV,
        armed: true,
      };
      this.mines.push(mine);

      if (this.onMinePlace) {
        this.onMinePlace(new THREE.Vector3());
      }
    }

    // Check mine detonations
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const mine = this.mines[i];
      if (!mine.armed) continue;

      for (const enemy of enemies) {
        const enemyU = enemy.surfaceU ?? enemy.u ?? 0;
        const enemyV = enemy.surfaceV ?? enemy.v ?? 0;
        const deltaU = enemyU - mine.surfaceU;
        const deltaV = enemyV - mine.surfaceV;
        const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

        if (distance < this.detonationRadius) {
          if (this.onExplosion) {
            this.onExplosion(new THREE.Vector3(), 0.5);
          }
          this.mines.splice(i, 1);
          break;
        }
      }
    }
  }

  deactivate(): void {
    super.deactivate();
    this.mines = [];
  }
}

// Black Hole Super
export class BlackHoleSuper extends SuperAbility {
  private centerU = 0;
  private centerV = 0;
  private readonly pullRadius = 2.0;
  private readonly killRadius = 0.2;
  private readonly pullStrength = 1.5;

  constructor(config: SuperConfig) {
    super({ ...config, duration: 5 });
  }

  activate(playerU: number, playerV: number): void {
    super.activate(playerU, playerV);
    this.centerU = playerU;
    this.centerV = playerV;
  }

  update(dt: number, playerU: number, playerV: number, enemies: any[]): void {
    if (!this.active) return;

    this.timeRemaining -= dt;
    if (this.timeRemaining <= 0) {
      this.deactivate();
      return;
    }

    // Pull and destroy enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
      const enemy = enemies[i];
      const enemyU = enemy.surfaceU ?? enemy.u ?? 0;
      const enemyV = enemy.surfaceV ?? enemy.v ?? 0;
      const deltaU = this.centerU - enemyU;
      const deltaV = this.centerV - enemyV;
      const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

      if (distance < this.pullRadius) {
        // Pull enemy toward center
        if (distance > this.killRadius) {
          const pullAmount = this.pullStrength * dt / Math.max(distance, 0.1);
          enemy.surfaceU = (enemy.surfaceU ?? enemy.u ?? 0) + deltaU * pullAmount;
          enemy.surfaceV = (enemy.surfaceV ?? enemy.v ?? 0) + deltaV * pullAmount;
        } else {
          // Destroy enemy
          if (this.onExplosion) {
            this.onExplosion(new THREE.Vector3(), 0.3);
          }
        }
      }
    }
  }
}

// Turret Super
export class TurretSuper extends SuperAbility {
  private turretU = 0;
  private turretV = 0;
  private fireTimer = 0;
  private readonly fireRate = 3; // shots per second
  private rotationAngle = 0;

  constructor(config: SuperConfig) {
    super({ ...config, duration: 8 });
  }

  activate(playerU: number, playerV: number): void {
    super.activate(playerU, playerV);
    this.turretU = playerU;
    this.turretV = playerV;
    this.fireTimer = 0;
    this.rotationAngle = 0;
  }

  update(dt: number, playerU: number, playerV: number, enemies: any[]): void {
    if (!this.active) return;

    this.timeRemaining -= dt;
    if (this.timeRemaining <= 0) {
      this.deactivate();
      return;
    }

    // Rotate
    this.rotationAngle += dt * Math.PI; // 180 degrees per second

    // Fire periodically
    this.fireTimer += dt;
    if (this.fireTimer >= 1 / this.fireRate) {
      this.fireTimer = 0;

      // Fire in current rotation direction
      const targetU = this.turretU + Math.cos(this.rotationAngle) * 0.5;
      const targetV = this.turretV + Math.sin(this.rotationAngle) * 0.5;

      if (this.onMissileSpawn) {
        this.onMissileSpawn(new THREE.Vector3(), new THREE.Vector3());
      }
    }
  }
}

// Clone Super
export class CloneSuper extends SuperAbility {
  cloneActive = false;
  cloneU = 0;
  cloneV = 0;

  constructor(config: SuperConfig) {
    super({ ...config, duration: 10 });
  }

  activate(playerU: number, playerV: number): void {
    super.activate(playerU, playerV);
    this.cloneActive = true;
    this.cloneU = playerU;
    this.cloneV = playerV;
  }

  update(dt: number, playerU: number, playerV: number, enemies: any[]): void {
    if (!this.active) return;

    this.timeRemaining -= dt;
    if (this.timeRemaining <= 0) {
      this.deactivate();
      return;
    }

    // Clone mirrors player movement
    this.cloneU = playerU + 0.5; // Offset slightly
    this.cloneV = playerV;
  }

  deactivate(): void {
    super.deactivate();
    this.cloneActive = false;
  }
}

// Detonator Super
export class DetonatorSuper extends SuperAbility {
  private explosionTimer = 0;
  private readonly explosionInterval = 0.5;
  private readonly finalExplosionRadius = 2.0;
  private readonly smallExplosionRadius = 0.5;

  constructor(config: SuperConfig) {
    super({ ...config, duration: 6 });
  }

  update(dt: number, playerU: number, playerV: number, enemies: any[]): void {
    if (!this.active) return;

    this.timeRemaining -= dt;
    this.explosionTimer += dt;

    // Small periodic explosions
    if (this.explosionTimer >= this.explosionInterval) {
      this.explosionTimer = 0;
      if (this.onExplosion) {
        this.onExplosion(new THREE.Vector3(), this.smallExplosionRadius);
      }
    }

    // Final explosion
    if (this.timeRemaining <= 0) {
      if (this.onExplosion) {
        this.onExplosion(new THREE.Vector3(), this.finalExplosionRadius);
      }
      this.deactivate();
      return;
    }

    // Home toward nearest enemy
    const nearest = this.findNearestEnemy(playerU, playerV, enemies);
    if (nearest) {
      // Movement would be handled by player controller
    }
  }

  private findNearestEnemy(u: number, v: number, enemies: any[]): any | null {
    let nearest: any | null = null;
    let minDist = Infinity;

    for (const enemy of enemies) {
      const enemyU = enemy.surfaceU ?? enemy.u ?? 0;
      const enemyV = enemy.surfaceV ?? enemy.v ?? 0;
      const deltaU = enemyU - u;
      const deltaV = enemyV - v;
      const dist = deltaU * deltaU + deltaV * deltaV;

      if (dist < minDist) {
        minDist = dist;
        nearest = enemy;
      }
    }

    return nearest;
  }
}
