export enum SuperStateType {
  QuadFire = 'quad_fire',
  SplitFire = 'split_fire',
  ReverseFire = 'reverse_fire',
  Missile = 'missile',
  Magnet = 'magnet',
  TrailBomb = 'trail_bomb',
  Shield = 'shield',
}

export interface SuperStateEffect {
  type: SuperStateType;
  duration: number; // default 12 seconds
  timeRemaining: number;
}

export interface FireModifiers {
  extraBullets: number;    // from QuadFire/SplitFire
  spreadAngle: number;     // from SplitFire
  reversefire: boolean;    // from ReverseFire
  homingMissiles: boolean; // from Missile
  magnetRange: number;     // from Magnet (0 = no boost)
  trailBombs: boolean;     // from TrailBomb
  isShielded: boolean;     // from Shield
}

export class SuperStateManager {
  private activeStates: SuperStateEffect[] = [];
  private readonly defaultDuration = 12;

  activate(type: SuperStateType): void {
    // Check if already active
    const existing = this.activeStates.find(s => s.type === type);
    if (existing) {
      // Refresh duration
      existing.timeRemaining = this.defaultDuration;
    } else {
      // Add new state
      this.activeStates.push({
        type,
        duration: this.defaultDuration,
        timeRemaining: this.defaultDuration,
      });
    }
  }

  update(dt: number): void {
    // Update all active states
    for (let i = this.activeStates.length - 1; i >= 0; i--) {
      const state = this.activeStates[i];
      state.timeRemaining -= dt;

      if (state.timeRemaining <= 0) {
        this.activeStates.splice(i, 1);
      }
    }
  }

  isActive(type: SuperStateType): boolean {
    return this.activeStates.some(s => s.type === type);
  }

  getActiveStates(): ReadonlyArray<SuperStateEffect> {
    return this.activeStates;
  }

  getFireModifiers(): FireModifiers {
    const modifiers: FireModifiers = {
      extraBullets: 0,
      spreadAngle: 0,
      reversefire: false,
      homingMissiles: false,
      magnetRange: 0,
      trailBombs: false,
      isShielded: false,
    };

    for (const state of this.activeStates) {
      switch (state.type) {
        case SuperStateType.QuadFire:
          modifiers.extraBullets += 3; // 4 total bullets
          break;

        case SuperStateType.SplitFire:
          modifiers.extraBullets += 2; // 3 total bullets
          modifiers.spreadAngle = Math.PI / 6; // 30 degree spread
          break;

        case SuperStateType.ReverseFire:
          modifiers.reversefire = true;
          break;

        case SuperStateType.Missile:
          modifiers.homingMissiles = true;
          break;

        case SuperStateType.Magnet:
          modifiers.magnetRange = 1.5; // Pull range in surface units
          break;

        case SuperStateType.TrailBomb:
          modifiers.trailBombs = true;
          break;

        case SuperStateType.Shield:
          modifiers.isShielded = true;
          break;
      }
    }

    return modifiers;
  }

  clear(): void {
    this.activeStates = [];
  }
}
