import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { enhanceMaterialWithShaderEffect } from '../../rendering/EnemyShaderEffects';

/**
 * Boss enemy base class - large gemstone-themed enemies with multi-phase health.
 *
 * GW3D boss mechanics:
 * - 5 health phases (health bar depletes 5 times)
 * - Between phases: crystal shield (invulnerable) + enemy wave spawns
 * - Contact with boss = instant player death
 * - Each phase increases aggression
 * - Visible health bar at top of screen
 */

export type BossSection = 'sapphire' | 'ruby' | 'emerald' | 'topaz' | 'amethyst' | 'opal';

export interface BossConfig {
  section: BossSection;
  color: number;
  emissiveColor: number;
  size: number;
  phaseHP: number;          // HP per phase
  totalPhases: number;      // always 5
  baseSpeed: number;
  spawnTypes: string[];      // enemy types spawned during shield phase
  spawnCountPerPhase: number[];  // enemies per shield phase [phase1, phase2, ...]
}

const BOSS_CONFIGS: Record<BossSection, BossConfig> = {
  sapphire: {
    section: 'sapphire',
    color: 0x4488ff,
    emissiveColor: 0x2244aa,
    size: 1.2,
    phaseHP: 20,
    totalPhases: 5,
    baseSpeed: 0.02,
    spawnTypes: ['wanderer', 'grunt'],
    spawnCountPerPhase: [4, 6, 8, 10, 12],
  },
  ruby: {
    section: 'ruby',
    color: 0xff2244,
    emissiveColor: 0xaa1122,
    size: 1.3,
    phaseHP: 25,
    totalPhases: 5,
    baseSpeed: 0.022,
    spawnTypes: ['grunt', 'duck', 'mayfly'],
    spawnCountPerPhase: [5, 8, 10, 12, 15],
  },
  emerald: {
    section: 'emerald',
    color: 0x22ff44,
    emissiveColor: 0x11aa22,
    size: 1.3,
    phaseHP: 30,
    totalPhases: 5,
    baseSpeed: 0.024,
    spawnTypes: ['grunt', 'weaver', 'rocket'],
    spawnCountPerPhase: [6, 8, 12, 14, 18],
  },
  topaz: {
    section: 'topaz',
    color: 0xffcc00,
    emissiveColor: 0xaa8800,
    size: 1.4,
    phaseHP: 35,
    totalPhases: 5,
    baseSpeed: 0.026,
    spawnTypes: ['grunt', 'spinner', 'snake', 'rocket'],
    spawnCountPerPhase: [8, 10, 14, 18, 22],
  },
  amethyst: {
    section: 'amethyst',
    color: 0xaa44ff,
    emissiveColor: 0x6622aa,
    size: 1.4,
    phaseHP: 35,
    totalPhases: 5,
    baseSpeed: 0.025,
    spawnTypes: ['spinner', 'weaver', 'neutron'],
    spawnCountPerPhase: [6, 10, 14, 16, 20],
  },
  opal: {
    section: 'opal',
    color: 0xffffff,
    emissiveColor: 0xaabbcc,
    size: 1.5,
    phaseHP: 40,
    totalPhases: 5,
    baseSpeed: 0.028,
    spawnTypes: ['grunt', 'rocket', 'weaver', 'spinner', 'snake'],
    spawnCountPerPhase: [8, 12, 16, 20, 25],
  },
};

/** State of the boss fight */
enum BossPhaseState {
  /** Boss is vulnerable and fighting */
  Fighting,
  /** Crystal shield up, spawning enemies */
  ShieldPhase,
}

export class Boss extends BaseEnemy {
  readonly config: BossConfig;
  private currentPhase = 0;    // 0-4 (5 phases)
  private phaseHP: number;
  private phaseState = BossPhaseState.Fighting;
  private shieldTimer = 0;
  private readonly shieldDuration = 4.0; // seconds of invulnerability
  private shieldMesh: THREE.Mesh | null = null;
  private hasSpawnedThisShield = false;
  private pulsePhase = 0;
  private chaseAngle = 0;

  // Movement pattern
  private orbitAngle = Math.random() * Math.PI * 2;
  private orbitRadius = 0.15;

  /** Game registers: spawn enemies during shield phase */
  public static onShieldSpawn: ((types: string[], count: number, u: number, v: number) => void) | null = null;
  /** Game registers: show/update boss health bar */
  public static onHealthUpdate: ((currentHP: number, maxHP: number, phase: number, totalPhases: number) => void) | null = null;
  /** Game registers: boss entered new phase (for time extension, etc.) */
  public static onPhaseChange: ((phase: number) => void) | null = null;

  constructor(section: BossSection, surfaceU: number = 0.5, surfaceV: number = 0.5) {
    const cfg = BOSS_CONFIGS[section];
    // Total score = phaseHP * totalPhases * 10 (high value target)
    const totalScore = cfg.phaseHP * cfg.totalPhases * 10;
    super(surfaceU, surfaceV, cfg.phaseHP, totalScore, 5, cfg.baseSpeed, cfg.size);

    this.config = cfg;
    this.phaseHP = cfg.phaseHP;
    this.createBossMesh();
  }

  private createBossMesh(): void {
    const group = new THREE.Group();

    // Main body: dodecahedron (gem-like)
    const bodyGeo = new THREE.DodecahedronGeometry(this.config.size * 0.5, 1);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.config.color,
      emissive: this.config.emissiveColor,
      emissiveIntensity: 0.6,
      metalness: 0.7,
      roughness: 0.2,
      transparent: true,
      opacity: 0.9,
    });
    // Enhance body material with art-piece shader (iridescent color shifting + wave displacement)
    enhanceMaterialWithShaderEffect(bodyMat, 'artpiece', new THREE.Color(this.config.color));

    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.name = 'boss-body';
    group.add(body);

    // Inner core (smaller, brighter)
    const coreGeo = new THREE.IcosahedronGeometry(this.config.size * 0.25, 1);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: this.config.color,
      emissiveIntensity: 1.0,
      metalness: 1.0,
      roughness: 0,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.name = 'boss-core';
    group.add(core);

    // Crystal shield (initially hidden)
    const shieldGeo = new THREE.IcosahedronGeometry(this.config.size * 0.7, 2);
    const shieldMat = new THREE.MeshStandardMaterial({
      color: 0x88ccff,
      emissive: 0x4488ff,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0,
      wireframe: true,
    });
    this.shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
    this.shieldMesh.name = 'boss-shield';
    group.add(this.shieldMesh);

    this.mesh = group;
  }

  get phase(): number { return this.currentPhase; }
  get totalPhases(): number { return this.config.totalPhases; }
  get isShielded(): boolean { return this.phaseState === BossPhaseState.ShieldPhase; }
  get healthPercent(): number { return this.phaseHP / this.config.phaseHP; }

  takeDamage(amount: number): void {
    // Can't take damage during shield phase
    if (this.phaseState === BossPhaseState.ShieldPhase) return;

    this.phaseHP -= amount;

    // Flash on hit
    if (this.mesh) {
      const body = this.mesh.getObjectByName('boss-body') as THREE.Mesh | undefined;
      if (body) {
        const mat = body.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 2.0;
        setTimeout(() => { mat.emissiveIntensity = 0.6; }, 100);
      }
    }

    // Report health
    if (Boss.onHealthUpdate) {
      Boss.onHealthUpdate(Math.max(0, this.phaseHP), this.config.phaseHP, this.currentPhase, this.config.totalPhases);
    }

    if (this.phaseHP <= 0) {
      this.advancePhase();
    }
  }

  private advancePhase(): void {
    this.currentPhase++;

    if (this.currentPhase >= this.config.totalPhases) {
      // Boss defeated
      this.die();
      return;
    }

    // Enter shield phase
    this.phaseState = BossPhaseState.ShieldPhase;
    this.shieldTimer = 0;
    this.hasSpawnedThisShield = false;
    this.phaseHP = this.config.phaseHP;

    // Increase speed with each phase
    this.speed = this.config.baseSpeed * (1 + this.currentPhase * 0.15);

    // Show shield
    if (this.shieldMesh) {
      (this.shieldMesh.material as THREE.MeshStandardMaterial).opacity = 0.4;
    }

    if (Boss.onPhaseChange) {
      Boss.onPhaseChange(this.currentPhase);
    }
    if (Boss.onHealthUpdate) {
      Boss.onHealthUpdate(this.phaseHP, this.config.phaseHP, this.currentPhase, this.config.totalPhases);
    }
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    this.pulsePhase += dt;

    if (this.phaseState === BossPhaseState.ShieldPhase) {
      this.updateShieldPhase(dt, playerU, playerV);
    } else {
      this.updateFightPhase(dt, playerU, playerV);
    }

    // Visual updates
    this.updateVisuals(dt);
  }

  private updateShieldPhase(dt: number, playerU: number, playerV: number): void {
    this.shieldTimer += dt;

    // Spawn enemies once during shield
    if (!this.hasSpawnedThisShield && this.shieldTimer > 0.5) {
      this.hasSpawnedThisShield = true;
      const spawnCount = this.config.spawnCountPerPhase[Math.min(this.currentPhase, this.config.spawnCountPerPhase.length - 1)];
      if (Boss.onShieldSpawn) {
        Boss.onShieldSpawn(this.config.spawnTypes, spawnCount, this.surfacePosition.u, this.surfacePosition.v);
      }
    }

    // Orbit slowly during shield
    this.orbitAngle += dt * 0.5;
    const centerU = 0.5 + Math.cos(this.orbitAngle) * this.orbitRadius;
    const centerV = 0.5 + Math.sin(this.orbitAngle) * this.orbitRadius;
    this.surfacePosition = {
      u: Math.max(0.1, Math.min(0.9, centerU)),
      v: Math.max(0.1, Math.min(0.9, centerV)),
    };

    // Shield pulse
    if (this.shieldMesh) {
      const shieldScale = 1.0 + Math.sin(this.shieldTimer * 4) * 0.1;
      this.shieldMesh.scale.setScalar(shieldScale);
      this.shieldMesh.rotation.y += dt * 2;
    }

    // End shield phase
    if (this.shieldTimer >= this.shieldDuration) {
      this.phaseState = BossPhaseState.Fighting;
      if (this.shieldMesh) {
        (this.shieldMesh.material as THREE.MeshStandardMaterial).opacity = 0;
      }
    }
  }

  private updateFightPhase(dt: number, playerU: number, playerV: number): void {
    const deltaU = playerU - this.surfacePosition.u;
    const deltaV = playerV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    // Movement pattern depends on section + phase
    const aggression = 0.5 + this.currentPhase * 0.12; // more aggressive each phase

    switch (this.config.section) {
      case 'sapphire':
        // Simple chase with orbit
        this.moveChaseSpin(dt, deltaU, deltaV, distance, aggression);
        break;
      case 'ruby':
        // Charge then retreat pattern
        this.moveChargeRetreat(dt, deltaU, deltaV, distance, aggression);
        break;
      case 'emerald':
        // Sweeping arc movement
        this.moveSweepArc(dt, playerU, playerV, aggression);
        break;
      case 'topaz':
        // Aggressive direct chase
        this.moveDirectChase(dt, deltaU, deltaV, distance, aggression * 1.2);
        break;
      case 'amethyst':
        // Orbit then dive
        this.moveOrbitDive(dt, playerU, playerV, aggression);
        break;
      case 'opal':
        // Unpredictable teleport-like movement
        this.moveErratic(dt, playerU, playerV, aggression);
        break;
    }
  }

  // -- Movement patterns --

  private moveChaseSpin(dt: number, deltaU: number, deltaV: number, distance: number, aggression: number): void {
    if (distance > 0.05) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;
      this.surfacePosition = {
        u: this.surfacePosition.u + dirU * this.speed * aggression * dt,
        v: this.surfacePosition.v + dirV * this.speed * aggression * dt,
      };
    }
    // Slight orbit
    this.chaseAngle += dt * 1.5;
    this.surfacePosition = {
      u: this.surfacePosition.u + Math.cos(this.chaseAngle) * 0.002,
      v: this.surfacePosition.v + Math.sin(this.chaseAngle) * 0.002,
    };
  }

  private moveChargeRetreat(dt: number, deltaU: number, deltaV: number, distance: number, aggression: number): void {
    const cycleTime = 4.0 - this.currentPhase * 0.4; // faster cycles in later phases
    const cycle = (this.pulsePhase % cycleTime) / cycleTime;

    if (cycle < 0.6) {
      // Charge toward player
      if (distance > 0.05) {
        const chargeSpeed = this.speed * aggression * 2.0;
        this.surfacePosition = {
          u: this.surfacePosition.u + (deltaU / distance) * chargeSpeed * dt,
          v: this.surfacePosition.v + (deltaV / distance) * chargeSpeed * dt,
        };
      }
    } else {
      // Retreat to center
      const toCenterU = 0.5 - this.surfacePosition.u;
      const toCenterV = 0.5 - this.surfacePosition.v;
      const centerDist = Math.sqrt(toCenterU * toCenterU + toCenterV * toCenterV);
      if (centerDist > 0.05) {
        this.surfacePosition = {
          u: this.surfacePosition.u + (toCenterU / centerDist) * this.speed * dt,
          v: this.surfacePosition.v + (toCenterV / centerDist) * this.speed * dt,
        };
      }
    }
  }

  private moveSweepArc(dt: number, playerU: number, playerV: number, aggression: number): void {
    // Sweep in arc around player position
    this.orbitAngle += dt * (1.0 + aggression);
    const orbitDist = 0.2 - this.currentPhase * 0.02; // tightens each phase
    this.surfacePosition = {
      u: Math.max(0.05, Math.min(0.95, playerU + Math.cos(this.orbitAngle) * orbitDist)),
      v: Math.max(0.05, Math.min(0.95, playerV + Math.sin(this.orbitAngle) * orbitDist)),
    };
  }

  private moveDirectChase(dt: number, deltaU: number, deltaV: number, distance: number, aggression: number): void {
    if (distance > 0.03) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;
      this.surfacePosition = {
        u: Math.max(0.05, Math.min(0.95, this.surfacePosition.u + dirU * this.speed * aggression * dt)),
        v: Math.max(0.05, Math.min(0.95, this.surfacePosition.v + dirV * this.speed * aggression * dt)),
      };
    }
  }

  private moveOrbitDive(dt: number, playerU: number, playerV: number, aggression: number): void {
    const cycleTime = 5.0 - this.currentPhase * 0.5;
    const cycle = (this.pulsePhase % cycleTime) / cycleTime;

    if (cycle < 0.7) {
      // Orbit
      this.orbitAngle += dt * (0.8 + aggression * 0.5);
      const r = 0.25 - this.currentPhase * 0.02;
      this.surfacePosition = {
        u: Math.max(0.05, Math.min(0.95, playerU + Math.cos(this.orbitAngle) * r)),
        v: Math.max(0.05, Math.min(0.95, playerV + Math.sin(this.orbitAngle) * r)),
      };
    } else {
      // Dive toward player
      const du = playerU - this.surfacePosition.u;
      const dv = playerV - this.surfacePosition.v;
      const dist = Math.sqrt(du * du + dv * dv);
      if (dist > 0.03) {
        const diveSpeed = this.speed * aggression * 2.5;
        this.surfacePosition = {
          u: this.surfacePosition.u + (du / dist) * diveSpeed * dt,
          v: this.surfacePosition.v + (dv / dist) * diveSpeed * dt,
        };
      }
    }
  }

  private moveErratic(dt: number, playerU: number, playerV: number, aggression: number): void {
    // Unpredictable: random teleport-like jumps mixed with chase
    this.chaseAngle += dt * 3;
    const jitter = Math.sin(this.chaseAngle * 7) * 0.01 * aggression;

    const du = playerU - this.surfacePosition.u;
    const dv = playerV - this.surfacePosition.v;
    const dist = Math.sqrt(du * du + dv * dv);

    if (dist > 0.03) {
      this.surfacePosition = {
        u: Math.max(0.05, Math.min(0.95,
          this.surfacePosition.u + (du / dist) * this.speed * aggression * dt + jitter)),
        v: Math.max(0.05, Math.min(0.95,
          this.surfacePosition.v + (dv / dist) * this.speed * aggression * dt + jitter * 1.3)),
      };
    }
  }

  // -- Visuals --

  private updateVisuals(dt: number): void {
    if (!this.mesh) return;

    // Rotate body
    const body = this.mesh.getObjectByName('boss-body');
    if (body) {
      body.rotation.y += dt * 0.5;
      body.rotation.x += dt * 0.3;
    }

    // Core spins faster
    const core = this.mesh.getObjectByName('boss-core');
    if (core) {
      core.rotation.y -= dt * 2;
      core.rotation.z += dt * 1.5;
    }

    // Pulse scale based on phase state
    const baseScale = this.phaseState === BossPhaseState.ShieldPhase ? 1.1 : 1.0;
    const pulse = baseScale + Math.sin(this.pulsePhase * 2) * 0.05;
    this.mesh.scale.setScalar(pulse);
  }

  die(): void {
    if (!this.alive) return;

    // Override score to be high for final death
    this.scoreValue = this.config.phaseHP * this.config.totalPhases * 10;
    this.geomCount = 10; // lots of geoms

    // Clear health bar
    if (Boss.onHealthUpdate) {
      Boss.onHealthUpdate(0, 0, this.config.totalPhases, this.config.totalPhases);
    }

    super.die();
  }
}
