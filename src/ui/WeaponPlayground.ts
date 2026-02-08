/**
 * Interactive weapon demo/playground that runs inside the WeaponWiki modal.
 *
 * Self-contained Three.js scene with its own renderer, camera, a mini sphere
 * surface, a player chevron, target enemies, and weapon visuals. Auto-fires
 * the selected weapon so the user can watch each weapon type in action.
 */

import * as THREE from 'three';
import { WeaponType, WEAPON_CONFIGS } from '../weapons/WeaponTypes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPHERE_RADIUS = 3;
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 300;
const ENEMY_COUNT = 8;
const ENEMY_SIZE = 0.15;
const ENEMY_SPEED = 0.3; // radians per second toward player
const ENEMY_RESPAWN_DELAY = 2.0;
const CAMERA_DISTANCE = 7.5;
const PLAYER_ORBIT_SPEED = 0.25; // radians per second

// Temp vectors to avoid GC
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Mini enemy data
// ---------------------------------------------------------------------------

interface PlaygroundEnemy {
  mesh: THREE.Mesh;
  theta: number;      // azimuthal angle on sphere
  phi: number;        // polar angle on sphere
  alive: boolean;
  health: number;
  maxHealth: number;
  respawnTimer: number;
}

// ---------------------------------------------------------------------------
// Mini projectile data
// ---------------------------------------------------------------------------

interface MiniProjectile {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  speed: number;
  age: number;
  maxAge: number;
  type: WeaponType;
  /** For homing: target enemy index */
  targetIdx: number;
  /** For piercing: set of enemy indices already hit */
  hitSet: Set<number>;
}

// ---------------------------------------------------------------------------
// Damage popup data
// ---------------------------------------------------------------------------

interface DamagePopup {
  element: HTMLDivElement;
  age: number;
}

// ---------------------------------------------------------------------------
// WeaponPlayground
// ---------------------------------------------------------------------------

export class WeaponPlayground {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;

  private playerGroup: THREE.Group;
  private playerTheta = 0;
  private playerPhi = Math.PI / 2;
  private aimTheta = 0; // where the player aims (rotates around sphere)

  private enemies: PlaygroundEnemy[] = [];
  private projectiles: MiniProjectile[] = [];
  private popups: DamagePopup[] = [];

  private activeWeapon: WeaponType = WeaponType.Standard;
  private fireCooldown = 0;

  // Stats
  private dps = 0;
  private kills = 0;
  private elapsed = 0;
  private damageAccum = 0; // damage dealt in the last second
  private dpsTimer = 0;

  // Active effects (laser beam, tesla field, black hole)
  private activeEffectMeshes: THREE.Object3D[] = [];
  private activeEffectTimers: number[] = [];

  // DOM
  private statsOverlay: HTMLDivElement;
  private popupContainer: HTMLDivElement;

  // Loop
  private rafId = 0;
  private lastTime = 0;
  private disposed = false;

  // Materials (reused)
  private enemyMat: THREE.MeshBasicMaterial;
  private enemyDeadMat: THREE.MeshBasicMaterial;

  constructor(container: HTMLElement) {
    this.container = container;

    // -- Renderer --
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.margin = '0 auto';
    this.renderer.domElement.style.borderRadius = '4px';
    this.renderer.domElement.style.border = '1px solid rgba(255,255,255,0.1)';
    container.appendChild(this.renderer.domElement);

    // -- Scene --
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050510);

    // -- Camera --
    this.camera = new THREE.PerspectiveCamera(50, CANVAS_WIDTH / CANVAS_HEIGHT, 0.1, 100);
    this.camera.position.set(0, 3, CAMERA_DISTANCE);
    this.camera.lookAt(0, 0, 0);

    // -- Sphere surface (wireframe) --
    const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 24, 16);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0x112244,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });
    const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
    this.scene.add(sphereMesh);

    // -- Player chevron --
    this.playerGroup = this.buildMiniChevron(0x00ffff, 0.2);
    this.scene.add(this.playerGroup);

    // -- Enemy materials --
    this.enemyMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
    this.enemyDeadMat = new THREE.MeshBasicMaterial({
      color: 0x331111,
      transparent: true,
      opacity: 0.3,
    });

    // -- Spawn enemies --
    for (let i = 0; i < ENEMY_COUNT; i++) {
      this.spawnEnemy(i);
    }

    // -- Stats overlay --
    this.statsOverlay = document.createElement('div');
    this.statsOverlay.style.cssText =
      'display:flex;justify-content:space-between;padding:6px 12px;color:#88aacc;' +
      'font-size:11px;font-family:monospace;letter-spacing:1px;';
    this.statsOverlay.innerHTML =
      '<span id="pg-dps">DPS: 0</span><span id="pg-kills">KILLS: 0</span><span id="pg-time">0.0s</span>';
    container.appendChild(this.statsOverlay);

    // -- Popup container (overlaid on canvas) --
    this.popupContainer = document.createElement('div');
    this.popupContainer.style.cssText =
      'position:relative;width:0;height:0;pointer-events:none;overflow:visible;';
    container.style.position = 'relative';
    container.appendChild(this.popupContainer);

    // -- Start loop --
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  setWeapon(weaponType: string): void {
    const wt = weaponType as WeaponType;
    if (!WEAPON_CONFIGS[wt]) return;
    if (wt === this.activeWeapon) return;

    this.activeWeapon = wt;
    this.fireCooldown = 0;

    // Reset stats
    this.dps = 0;
    this.kills = 0;
    this.elapsed = 0;
    this.damageAccum = 0;
    this.dpsTimer = 0;

    // Clear active projectiles and effects
    this.clearProjectiles();
    this.clearEffects();

    // Reset enemies
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      e.alive = true;
      e.health = e.maxHealth;
      e.respawnTimer = 0;
      e.mesh.material = this.enemyMat;
      this.randomizeSpherePos(e, i);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    this.clearProjectiles();
    this.clearEffects();

    // Dispose popups
    for (const p of this.popups) {
      p.element.remove();
    }
    this.popups = [];

    // Dispose Three.js
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.statsOverlay.remove();
    this.popupContainer.remove();
  }

  // -----------------------------------------------------------------------
  // Loop
  // -----------------------------------------------------------------------

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);

    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    if (dt <= 0) return;

    this.elapsed += dt;
    this.dpsTimer += dt;

    // DPS calculation (1-second rolling window)
    if (this.dpsTimer >= 1.0) {
      this.dps = Math.round(this.damageAccum / this.dpsTimer);
      this.damageAccum = 0;
      this.dpsTimer = 0;
    }

    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.autoFire(dt);
    this.updateProjectiles(dt);
    this.updateEffects(dt);
    this.updatePopups(dt);
    this.updateCamera();
    this.updateStats();

    this.renderer.render(this.scene, this.camera);
  };

  // -----------------------------------------------------------------------
  // Player
  // -----------------------------------------------------------------------

  private updatePlayer(dt: number): void {
    // Auto-rotate around the sphere
    this.playerTheta += PLAYER_ORBIT_SPEED * dt;

    // Aim outward (ahead of movement)
    this.aimTheta = this.playerTheta + Math.PI / 4;

    const pos = this.spherePos(this.playerTheta, this.playerPhi);
    this.playerGroup.position.copy(pos);

    // Orient: up = surface normal, forward = tangent direction
    const normal = pos.clone().normalize();
    const tangent = new THREE.Vector3(-Math.sin(this.playerTheta), 0, Math.cos(this.playerTheta));
    const target = pos.clone().add(tangent);
    this.playerGroup.lookAt(target);
    this.playerGroup.up.copy(normal);
  }

  // -----------------------------------------------------------------------
  // Enemies
  // -----------------------------------------------------------------------

  private spawnEnemy(index: number): void {
    const geo = new THREE.BoxGeometry(ENEMY_SIZE * 2, ENEMY_SIZE * 2, ENEMY_SIZE * 2);
    const mesh = new THREE.Mesh(geo, this.enemyMat);
    this.scene.add(mesh);

    const e: PlaygroundEnemy = {
      mesh,
      theta: 0,
      phi: 0,
      alive: true,
      health: this.getEnemyHealth(),
      maxHealth: this.getEnemyHealth(),
      respawnTimer: 0,
    };
    this.randomizeSpherePos(e, index);

    if (index < this.enemies.length) {
      this.enemies[index] = e;
    } else {
      this.enemies.push(e);
    }
  }

  private getEnemyHealth(): number {
    const cfg = WEAPON_CONFIGS[this.activeWeapon];
    // Scale enemy health so they survive a few hits for most weapons
    return Math.max(1, cfg.damage * 3);
  }

  private randomizeSpherePos(e: PlaygroundEnemy, _index: number): void {
    // Distribute enemies roughly opposite the player
    e.theta = this.playerTheta + Math.PI + (Math.random() - 0.5) * Math.PI;
    e.phi = Math.PI / 2 + (Math.random() - 0.5) * 1.2;
    const pos = this.spherePos(e.theta, e.phi);
    e.mesh.position.copy(pos);
  }

  private updateEnemies(dt: number): void {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];

      if (!e.alive) {
        e.respawnTimer -= dt;
        if (e.respawnTimer <= 0) {
          e.alive = true;
          e.health = this.getEnemyHealth();
          e.maxHealth = e.health;
          e.mesh.material = this.enemyMat;
          this.randomizeSpherePos(e, i);
          e.mesh.visible = true;
        }
        continue;
      }

      // Drift toward player
      const dTheta = this.playerTheta - e.theta;
      const dPhi = this.playerPhi - e.phi;
      const dist = Math.sqrt(dTheta * dTheta + dPhi * dPhi);
      if (dist > 0.01) {
        e.theta += (dTheta / dist) * ENEMY_SPEED * dt;
        e.phi += (dPhi / dist) * ENEMY_SPEED * dt;
      }

      const pos = this.spherePos(e.theta, e.phi);
      e.mesh.position.copy(pos);

      // Rotate for visual flair
      e.mesh.rotation.x += dt * 2;
      e.mesh.rotation.y += dt * 1.5;
    }
  }

  private damageEnemy(index: number, damage: number): void {
    const e = this.enemies[index];
    if (!e || !e.alive) return;

    e.health -= damage;
    this.damageAccum += damage;

    // Spawn damage popup
    this.spawnPopup(e.mesh.position, damage);

    if (e.health <= 0) {
      e.alive = false;
      e.mesh.visible = false;
      e.respawnTimer = ENEMY_RESPAWN_DELAY;
      this.kills++;
    }
  }

  // -----------------------------------------------------------------------
  // Auto-fire
  // -----------------------------------------------------------------------

  private autoFire(dt: number): void {
    this.fireCooldown -= dt;
    if (this.fireCooldown > 0) return;

    const cfg = WEAPON_CONFIGS[this.activeWeapon];
    this.fireCooldown = 1 / cfg.fireRate;

    const playerPos = this.playerGroup.position.clone();
    const aimDir = this.getAimDirection();

    switch (this.activeWeapon) {
      case WeaponType.Standard:
        this.fireProjectile(playerPos, aimDir, cfg, 0x88ffff, 0.04);
        break;

      case WeaponType.Spread:
        this.fireSpread(playerPos, aimDir, cfg);
        break;

      case WeaponType.Piercing:
        this.firePiercing(playerPos, aimDir, cfg);
        break;

      case WeaponType.ChainLightning:
        this.fireChainLightning(playerPos, cfg);
        break;

      case WeaponType.Homing:
        this.fireHoming(playerPos, aimDir, cfg);
        break;

      case WeaponType.PlasmaMortar:
        this.fireProjectile(playerPos, aimDir, cfg, 0x44ff44, 0.18);
        break;

      case WeaponType.GravityGun:
        this.fireGravityGun(playerPos, aimDir, cfg);
        break;

      case WeaponType.LaserBeam:
        this.fireLaserBeam(playerPos, aimDir, cfg);
        break;

      case WeaponType.BlackHole:
        this.fireBlackHole(playerPos, aimDir, cfg);
        break;

      case WeaponType.TeslaCoil:
        this.fireTeslaCoil(playerPos, cfg);
        break;
    }
  }

  private getAimDirection(): THREE.Vector3 {
    // Aim along the sphere tangent at the aim angle
    const dir = new THREE.Vector3(
      -Math.sin(this.aimTheta) * Math.sin(this.playerPhi),
      Math.cos(this.playerPhi),
      Math.cos(this.aimTheta) * Math.sin(this.playerPhi),
    );
    // Project tangent to sphere at player position
    const normal = this.playerGroup.position.clone().normalize();
    dir.sub(normal.clone().multiplyScalar(dir.dot(normal)));
    const len = dir.length();
    if (len > 0.001) dir.multiplyScalar(1 / len);
    return dir;
  }

  // -----------------------------------------------------------------------
  // Weapon-specific firing
  // -----------------------------------------------------------------------

  private fireProjectile(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    cfg: typeof WEAPON_CONFIGS[WeaponType],
    color: number,
    size: number,
    maxAge?: number,
  ): MiniProjectile {
    const geo = new THREE.SphereGeometry(size, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    this.scene.add(mesh);

    const proj: MiniProjectile = {
      mesh,
      position: origin.clone(),
      direction: direction.clone().normalize(),
      speed: cfg.projectileSpeed > 0 ? cfg.projectileSpeed * 4 : 6,
      age: 0,
      maxAge: maxAge ?? 3,
      type: this.activeWeapon,
      targetIdx: -1,
      hitSet: new Set(),
    };
    this.projectiles.push(proj);
    return proj;
  }

  private fireSpread(origin: THREE.Vector3, direction: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    const normal = origin.clone().normalize();
    const spreadAngle = Math.PI / 6;
    for (let i = 0; i < 5; i++) {
      const angle = (i - 2) * (spreadAngle / 4);
      const dir = direction.clone().applyAxisAngle(normal, angle);
      this.fireProjectile(origin, dir, cfg, 0x44ffff, 0.04);
    }
  }

  private firePiercing(origin: THREE.Vector3, direction: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    // Instant beam: draw a line and damage everything in path
    const beamLength = SPHERE_RADIUS * 3;
    const points: THREE.Vector3[] = [];
    let pos = origin.clone();
    let dir = direction.clone().normalize();

    for (let i = 0; i <= 20; i++) {
      points.push(pos.clone());
      pos.add(dir.clone().multiplyScalar(beamLength / 20));
      // Project onto sphere
      pos.normalize().multiplyScalar(SPHERE_RADIUS);
      // Re-tangentize
      const n = pos.clone().normalize();
      dir.sub(n.clone().multiplyScalar(dir.dot(n)));
      const l = dir.length();
      if (l > 0.001) dir.multiplyScalar(1 / l);
    }

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.activeEffectMeshes.push(line);
    this.activeEffectTimers.push(0.25);

    // Damage enemies along the beam
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive) continue;
      for (let s = 0; s < points.length - 1; s++) {
        const d = this.distToSegment(e.mesh.position, points[s], points[s + 1]);
        if (d < 0.4) {
          this.damageEnemy(i, cfg.damage);
          break;
        }
      }
    }
  }

  private fireChainLightning(origin: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    // Find alive enemies sorted by distance
    const alive = this.enemies
      .map((e, i) => ({ e, i, dist: e.mesh.position.distanceTo(origin) }))
      .filter(x => x.e.alive)
      .sort((a, b) => a.dist - b.dist);

    if (alive.length === 0) return;

    const chainCount = Math.min(6, alive.length);
    let prevPos = origin.clone();
    let dmgMult = 1.0;

    for (let c = 0; c < chainCount; c++) {
      const target = alive[c];
      const points = this.generateLightningPoints(prevPos, target.e.mesh.position, 8);
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const color = c === 0 ? 0xaaffff : 0x8844ff;
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
      const line = new THREE.Line(geo, mat);
      this.scene.add(line);
      this.activeEffectMeshes.push(line);
      this.activeEffectTimers.push(0.3);

      this.damageEnemy(target.i, cfg.damage * dmgMult);
      prevPos = target.e.mesh.position.clone();
      dmgMult *= 0.75;
    }
  }

  private fireHoming(origin: THREE.Vector3, direction: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    const proj = this.fireProjectile(origin, direction, cfg, 0xff4444, 0.06, 5);
    // Find nearest alive enemy
    let minDist = Infinity;
    let targetIdx = -1;
    for (let i = 0; i < this.enemies.length; i++) {
      if (!this.enemies[i].alive) continue;
      const d = this.enemies[i].mesh.position.distanceTo(origin);
      if (d < minDist) { minDist = d; targetIdx = i; }
    }
    proj.targetIdx = targetIdx;
    proj.type = WeaponType.Homing;
  }

  private fireGravityGun(origin: THREE.Vector3, direction: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    // Purple beam pulling enemies inward
    const endPos = origin.clone().add(direction.clone().multiplyScalar(SPHERE_RADIUS * 1.5));
    endPos.normalize().multiplyScalar(SPHERE_RADIUS);

    const geo = new THREE.BufferGeometry().setFromPoints([origin, endPos]);
    const mat = new THREE.LineBasicMaterial({ color: 0x8844ff, transparent: true, opacity: 0.7, linewidth: 2 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.activeEffectMeshes.push(line);
    this.activeEffectTimers.push(0.5);

    // Pull and damage nearby enemies
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive) continue;
      const d = e.mesh.position.distanceTo(endPos);
      if (d < 2.0) {
        this.damageEnemy(i, cfg.damage);
        // Pull toward beam end
        const pull = endPos.clone().sub(e.mesh.position).normalize().multiplyScalar(0.3);
        e.mesh.position.add(pull);
        e.mesh.position.normalize().multiplyScalar(SPHERE_RADIUS);
        // Update angular coords
        e.theta = Math.atan2(e.mesh.position.x, e.mesh.position.z);
        e.phi = Math.acos(Math.max(-1, Math.min(1, e.mesh.position.y / SPHERE_RADIUS)));
      }
    }
  }

  private fireLaserBeam(origin: THREE.Vector3, direction: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    // Sustained red beam along sphere surface
    const beamLength = SPHERE_RADIUS * 2.5;
    const points: THREE.Vector3[] = [];
    let pos = origin.clone();
    let dir = direction.clone().normalize();

    for (let i = 0; i <= 16; i++) {
      points.push(pos.clone());
      pos.add(dir.clone().multiplyScalar(beamLength / 16));
      pos.normalize().multiplyScalar(SPHERE_RADIUS);
      const n = pos.clone().normalize();
      dir.sub(n.clone().multiplyScalar(dir.dot(n)));
      const l = dir.length();
      if (l > 0.001) dir.multiplyScalar(1 / l);
    }

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.activeEffectMeshes.push(line);
    this.activeEffectTimers.push(0.12);

    // Damage enemies along the beam
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive) continue;
      for (let s = 0; s < points.length - 1; s++) {
        if (this.distToSegment(e.mesh.position, points[s], points[s + 1]) < 0.35) {
          this.damageEnemy(i, cfg.damage * 0.5);
          break;
        }
      }
    }
  }

  private fireBlackHole(origin: THREE.Vector3, direction: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    const targetPos = origin.clone().add(direction.clone().multiplyScalar(SPHERE_RADIUS * 0.8));
    targetPos.normalize().multiplyScalar(SPHERE_RADIUS);

    const geo = new THREE.SphereGeometry(0.25, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0x220044, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(targetPos);
    this.scene.add(mesh);
    this.activeEffectMeshes.push(mesh);
    this.activeEffectTimers.push(2.0);

    // Ring around black hole
    const ringGeo = new THREE.TorusGeometry(0.4, 0.03, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x6600aa, transparent: true, opacity: 0.6 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(targetPos);
    ring.lookAt(0, 0, 0);
    this.scene.add(ring);
    this.activeEffectMeshes.push(ring);
    this.activeEffectTimers.push(2.0);

    // Instant kill nearby enemies
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive) continue;
      const d = e.mesh.position.distanceTo(targetPos);
      if (d < 1.5) {
        this.damageEnemy(i, cfg.damage);
      }
    }
  }

  private fireTeslaCoil(origin: THREE.Vector3, cfg: typeof WEAPON_CONFIGS[WeaponType]): void {
    // Electric field around player
    const geo = new THREE.SphereGeometry(1.5, 10, 10);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x88aaff,
      wireframe: true,
      transparent: true,
      opacity: 0.25,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.activeEffectMeshes.push(mesh);
    this.activeEffectTimers.push(0.15);

    // Damage nearby enemies
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive) continue;
      const d = e.mesh.position.distanceTo(origin);
      if (d < 2.0) {
        this.damageEnemy(i, cfg.damage * 0.5);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Projectile update
  // -----------------------------------------------------------------------

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.removeProjectile(i);
        continue;
      }

      // Homing: steer toward target
      if (p.type === WeaponType.Homing && p.targetIdx >= 0) {
        const target = this.enemies[p.targetIdx];
        if (target && target.alive) {
          const toTarget = target.mesh.position.clone().sub(p.position).normalize();
          p.direction.lerp(toTarget, 4.0 * dt).normalize();
        } else {
          // Re-target nearest
          let minDist = Infinity;
          for (let j = 0; j < this.enemies.length; j++) {
            if (!this.enemies[j].alive) continue;
            const d = this.enemies[j].mesh.position.distanceTo(p.position);
            if (d < minDist) { minDist = d; p.targetIdx = j; }
          }
        }
      }

      // Move
      p.position.add(p.direction.clone().multiplyScalar(p.speed * dt));
      // Project onto sphere
      p.position.normalize().multiplyScalar(SPHERE_RADIUS);
      // Re-tangentize direction
      const n = p.position.clone().normalize();
      const dot = p.direction.dot(n);
      p.direction.sub(n.clone().multiplyScalar(dot));
      const dirLen = p.direction.length();
      if (dirLen > 0.001) p.direction.multiplyScalar(1 / dirLen);

      p.mesh.position.copy(p.position);

      // Collision with enemies
      const isPiercing = p.type === WeaponType.Piercing;
      for (let j = 0; j < this.enemies.length; j++) {
        const e = this.enemies[j];
        if (!e.alive) continue;
        if (isPiercing && p.hitSet.has(j)) continue;

        const d = e.mesh.position.distanceTo(p.position);
        if (d < 0.3) {
          const cfg = WEAPON_CONFIGS[this.activeWeapon];
          this.damageEnemy(j, cfg.damage);
          if (isPiercing) {
            p.hitSet.add(j);
          } else {
            this.removeProjectile(i);
            break;
          }
        }
      }
    }
  }

  private removeProjectile(index: number): void {
    const p = this.projectiles[index];
    this.scene.remove(p.mesh);
    if (p.mesh instanceof THREE.Mesh) {
      p.mesh.geometry.dispose();
    }
    this.projectiles.splice(index, 1);
  }

  private clearProjectiles(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.removeProjectile(i);
    }
  }

  // -----------------------------------------------------------------------
  // Effect update (beams, fields, etc.)
  // -----------------------------------------------------------------------

  private updateEffects(dt: number): void {
    for (let i = this.activeEffectTimers.length - 1; i >= 0; i--) {
      this.activeEffectTimers[i] -= dt;
      if (this.activeEffectTimers[i] <= 0) {
        const mesh = this.activeEffectMeshes[i];
        this.scene.remove(mesh);
        if (mesh instanceof THREE.Mesh) {
          mesh.geometry.dispose();
        } else if (mesh instanceof THREE.Line) {
          mesh.geometry.dispose();
        }
        this.activeEffectMeshes.splice(i, 1);
        this.activeEffectTimers.splice(i, 1);
      } else {
        // Fade out
        const mesh = this.activeEffectMeshes[i];
        if (mesh instanceof THREE.Mesh || mesh instanceof THREE.Line) {
          const mat = (mesh as THREE.Mesh).material;
          if (mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.LineBasicMaterial) {
            const progress = 1 - this.activeEffectTimers[i] / 0.5;
            if (progress > 0.5) {
              mat.opacity = Math.max(0, mat.opacity - dt * 2);
            }
          }
        }
      }
    }
  }

  private clearEffects(): void {
    for (let i = this.activeEffectMeshes.length - 1; i >= 0; i--) {
      const mesh = this.activeEffectMeshes[i];
      this.scene.remove(mesh);
      if (mesh instanceof THREE.Mesh) {
        mesh.geometry.dispose();
      } else if (mesh instanceof THREE.Line) {
        mesh.geometry.dispose();
      }
    }
    this.activeEffectMeshes = [];
    this.activeEffectTimers = [];
  }

  // -----------------------------------------------------------------------
  // Camera
  // -----------------------------------------------------------------------

  private updateCamera(): void {
    // Orbit slightly behind and above the player
    const camTheta = this.playerTheta - Math.PI / 8;
    const camPhi = Math.PI / 2 - 0.4;
    const cx = CAMERA_DISTANCE * Math.sin(camPhi) * Math.sin(camTheta);
    const cy = CAMERA_DISTANCE * Math.cos(camPhi);
    const cz = CAMERA_DISTANCE * Math.sin(camPhi) * Math.cos(camTheta);
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.playerGroup.position);
  }

  // -----------------------------------------------------------------------
  // Damage popups
  // -----------------------------------------------------------------------

  private spawnPopup(worldPos: THREE.Vector3, damage: number): void {
    // Project world position to screen coordinates
    _v1.copy(worldPos);
    _v1.project(this.camera);
    const screenX = ((_v1.x + 1) / 2) * CANVAS_WIDTH;
    const screenY = ((1 - _v1.y) / 2) * CANVAS_HEIGHT;

    // If behind camera, skip
    if (_v1.z > 1) return;

    const el = document.createElement('div');
    el.textContent = damage >= 1 ? Math.round(damage).toString() : damage.toFixed(1);
    el.style.cssText =
      `position:absolute;color:#ffff44;font-size:12px;font-weight:bold;font-family:monospace;` +
      `pointer-events:none;text-shadow:0 0 4px #ff8800;white-space:nowrap;z-index:10;` +
      `left:${screenX}px;top:${screenY - CANVAS_HEIGHT - 40}px;transition:all 0.6s ease-out;opacity:1;`;
    this.popupContainer.appendChild(el);

    // Animate up + fade
    requestAnimationFrame(() => {
      el.style.transform = 'translateY(-20px)';
      el.style.opacity = '0';
    });

    this.popups.push({ element: el, age: 0 });
  }

  private updatePopups(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      this.popups[i].age += dt;
      if (this.popups[i].age > 0.7) {
        this.popups[i].element.remove();
        this.popups.splice(i, 1);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Stats overlay
  // -----------------------------------------------------------------------

  private updateStats(): void {
    const dpsEl = this.statsOverlay.querySelector('#pg-dps');
    const killsEl = this.statsOverlay.querySelector('#pg-kills');
    const timeEl = this.statsOverlay.querySelector('#pg-time');
    if (dpsEl) dpsEl.textContent = `DPS: ${this.dps}`;
    if (killsEl) killsEl.textContent = `KILLS: ${this.kills}`;
    if (timeEl) timeEl.textContent = `${this.elapsed.toFixed(1)}s`;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private spherePos(theta: number, phi: number): THREE.Vector3 {
    return new THREE.Vector3(
      SPHERE_RADIUS * Math.sin(phi) * Math.sin(theta),
      SPHERE_RADIUS * Math.cos(phi),
      SPHERE_RADIUS * Math.sin(phi) * Math.cos(theta),
    );
  }

  private buildMiniChevron(color: number, scale: number): THREE.Group {
    const group = new THREE.Group();
    // Simple triangle-based chevron using MeshBasicMaterial
    const shape = new THREE.Shape();
    shape.moveTo(0, scale);           // nose
    shape.lineTo(-scale * 0.6, -scale * 0.5);
    shape.lineTo(0, -scale * 0.2);    // notch
    shape.lineTo(scale * 0.6, -scale * 0.5);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: scale * 0.3, bevelEnabled: false });
    // Rotate so forward is +Z
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, scale * 0.15);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    // Wireframe outline for neon look
    const wireGeo = new THREE.EdgesGeometry(geo);
    const wireMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
    const wireframe = new THREE.LineSegments(wireGeo, wireMat);
    group.add(wireframe);

    return group;
  }

  private generateLightningPoints(start: THREE.Vector3, end: THREE.Vector3, segments: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = [start.clone()];
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const p = start.clone().lerp(end, t);
      // Add random offset perpendicular to the line
      const jitter = 0.08;
      p.x += (Math.random() - 0.5) * jitter;
      p.y += (Math.random() - 0.5) * jitter;
      p.z += (Math.random() - 0.5) * jitter;
      // Project back onto sphere
      p.normalize().multiplyScalar(SPHERE_RADIUS);
      points.push(p);
    }
    points.push(end.clone());
    return points;
  }

  private distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
    _v1.subVectors(b, a);
    _v2.subVectors(p, a);
    const abLenSq = _v1.lengthSq();
    if (abLenSq < 0.000001) return _v2.length();
    const t = Math.max(0, Math.min(1, _v2.dot(_v1) / abLenSq));
    _v3.copy(a).addScaledVector(_v1, t);
    return p.distanceTo(_v3);
  }
}
