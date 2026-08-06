import { WeaponType } from '../weapons/WeaponTypes';

export interface StandardUpgradePattern {
  fanExtraBolts: number;
  fanAngle: number;
  branchBExtraBolts: number;
  branchBConeAngle: number;
}

export interface SpreadUpgradePattern {
  bulletCount: number;
  spreadAngle: number;
}

export type MpUpgradeNodeSupportStatus = 'server_authoritative' | 'client_safe' | 'unsupported';

export interface MpUpgradeNodeSupport {
  status: MpUpgradeNodeSupportStatus;
  reason: string;
}

const STANDARD_SERVER_PROJECTILE_PATTERN: MpUpgradeNodeSupport = {
  status: 'server_authoritative',
  reason: 'GameRoom.tryShoot() applies this Standard projectile pattern from server active-node state.',
};
const SPREAD_SERVER_PROJECTILE_PATTERN: MpUpgradeNodeSupport = {
  status: 'server_authoritative',
  reason: 'GameRoom.tryShoot() applies this Spread projectile/damage pattern from server active-node state.',
};
const UNSUPPORTED_STANDARD: MpUpgradeNodeSupport = {
  status: 'unsupported',
  reason: 'Standard mastery node is retained, but its MP runtime mechanic is not server-authoritative yet.',
};
const UNSUPPORTED_SPREAD: MpUpgradeNodeSupport = {
  status: 'unsupported',
  reason: 'Spread mastery node is retained, but its MP runtime mechanic is not server-authoritative yet.',
};
const UNSUPPORTED_WEAPON: MpUpgradeNodeSupport = {
  status: 'unsupported',
  reason: 'This retained weapon mastery node has no MP server-authoritative activation support yet.',
};
const UNSUPPORTED_BLACK_HOLE_MASTERY: MpUpgradeNodeSupport = {
  status: 'unsupported',
  reason: 'Black Hole MP weapon baseline is supported, but mastery-node modifiers are deferred until server authority is proven.',
};

export const MP_UPGRADE_NODE_SUPPORT: Record<string, MpUpgradeNodeSupport> = {
  standard_a_1: STANDARD_SERVER_PROJECTILE_PATTERN,
  standard_a_2: STANDARD_SERVER_PROJECTILE_PATTERN,
  standard_a_3: STANDARD_SERVER_PROJECTILE_PATTERN,
  standard_a_4: STANDARD_SERVER_PROJECTILE_PATTERN,
  standard_al_5: STANDARD_SERVER_PROJECTILE_PATTERN,
  standard_al_6: STANDARD_SERVER_PROJECTILE_PATTERN,
  standard_ar_5: UNSUPPORTED_STANDARD,
  standard_ar_6: UNSUPPORTED_STANDARD,
  standard_b_1: STANDARD_SERVER_PROJECTILE_PATTERN,
  standard_b_2: STANDARD_SERVER_PROJECTILE_PATTERN,
  standard_b_3: STANDARD_SERVER_PROJECTILE_PATTERN,
  standard_b_4: {
    status: 'unsupported',
    reason: 'Standard heavy bolt remains MP-unsupported until its full retained contract is server-authoritative.',
  },
  standard_bl_5: UNSUPPORTED_STANDARD,
  standard_bl_7: UNSUPPORTED_STANDARD,
  standard_bl_10: UNSUPPORTED_STANDARD,
  standard_br_5: UNSUPPORTED_STANDARD,
  standard_br_7: UNSUPPORTED_STANDARD,
  standard_br_10: UNSUPPORTED_STANDARD,

  spread_a_1: SPREAD_SERVER_PROJECTILE_PATTERN,
  spread_a_2: SPREAD_SERVER_PROJECTILE_PATTERN,
  spread_a_3: SPREAD_SERVER_PROJECTILE_PATTERN,
  spread_al_4: SPREAD_SERVER_PROJECTILE_PATTERN,
  spread_al_5: SPREAD_SERVER_PROJECTILE_PATTERN,
  spread_ar_4: UNSUPPORTED_SPREAD,
  spread_ar_5: UNSUPPORTED_SPREAD,
  spread_b_1: SPREAD_SERVER_PROJECTILE_PATTERN,
  spread_b_2: SPREAD_SERVER_PROJECTILE_PATTERN,
  spread_b_3: UNSUPPORTED_SPREAD,
  spread_bl_4: UNSUPPORTED_SPREAD,
  spread_bl_5: UNSUPPORTED_SPREAD,
  spread_br_4: UNSUPPORTED_SPREAD,
  spread_br_5: UNSUPPORTED_SPREAD,

  piercing_a_1: UNSUPPORTED_WEAPON,
  piercing_a_2: UNSUPPORTED_WEAPON,
  piercing_a_3: UNSUPPORTED_WEAPON,
  piercing_al_4: UNSUPPORTED_WEAPON,
  piercing_al_5: UNSUPPORTED_WEAPON,
  piercing_ar_4: UNSUPPORTED_WEAPON,
  piercing_ar_5: UNSUPPORTED_WEAPON,
  piercing_b_1: UNSUPPORTED_WEAPON,
  piercing_b_2: UNSUPPORTED_WEAPON,
  piercing_b_3: UNSUPPORTED_WEAPON,
  piercing_bl_4: UNSUPPORTED_WEAPON,
  piercing_bl_5: UNSUPPORTED_WEAPON,
  piercing_br_4: UNSUPPORTED_WEAPON,
  piercing_br_5: UNSUPPORTED_WEAPON,

  chain_lightning_a_1: UNSUPPORTED_WEAPON,
  chain_lightning_a_2: UNSUPPORTED_WEAPON,
  chain_lightning_a_3: UNSUPPORTED_WEAPON,
  chain_lightning_a_4: UNSUPPORTED_WEAPON,
  chain_lightning_a_5: UNSUPPORTED_WEAPON,
  chain_lightning_b_1: UNSUPPORTED_WEAPON,
  chain_lightning_b_2: UNSUPPORTED_WEAPON,
  chain_lightning_b_3: UNSUPPORTED_WEAPON,
  chain_lightning_b_4: UNSUPPORTED_WEAPON,
  chain_lightning_b_5: UNSUPPORTED_WEAPON,

  homing_a_1: UNSUPPORTED_WEAPON,
  homing_a_2: UNSUPPORTED_WEAPON,
  homing_a_3: UNSUPPORTED_WEAPON,
  homing_a_4: UNSUPPORTED_WEAPON,
  homing_a_5: UNSUPPORTED_WEAPON,
  homing_b_1: UNSUPPORTED_WEAPON,
  homing_b_2: UNSUPPORTED_WEAPON,
  homing_b_3: UNSUPPORTED_WEAPON,
  homing_b_4: UNSUPPORTED_WEAPON,
  homing_b_5: UNSUPPORTED_WEAPON,

  plasma_mortar_a_1: UNSUPPORTED_WEAPON,
  plasma_mortar_a_2: UNSUPPORTED_WEAPON,
  plasma_mortar_a_3: UNSUPPORTED_WEAPON,
  plasma_mortar_a_4: UNSUPPORTED_WEAPON,
  plasma_mortar_a_5: UNSUPPORTED_WEAPON,
  plasma_mortar_b_1: UNSUPPORTED_WEAPON,
  plasma_mortar_b_2: UNSUPPORTED_WEAPON,
  plasma_mortar_b_3: UNSUPPORTED_WEAPON,
  plasma_mortar_b_4: UNSUPPORTED_WEAPON,
  plasma_mortar_b_5: UNSUPPORTED_WEAPON,

  gravity_gun_a_1: UNSUPPORTED_WEAPON,
  gravity_gun_a_2: UNSUPPORTED_WEAPON,
  gravity_gun_a_3: UNSUPPORTED_WEAPON,
  gravity_gun_a_4: UNSUPPORTED_WEAPON,
  gravity_gun_a_5: UNSUPPORTED_WEAPON,
  gravity_gun_b_1: UNSUPPORTED_WEAPON,
  gravity_gun_b_2: UNSUPPORTED_WEAPON,
  gravity_gun_b_3: UNSUPPORTED_WEAPON,
  gravity_gun_b_4: UNSUPPORTED_WEAPON,
  gravity_gun_b_5: UNSUPPORTED_WEAPON,

  laser_beam_a_1: UNSUPPORTED_WEAPON,
  laser_beam_a_2: UNSUPPORTED_WEAPON,
  laser_beam_a_3: UNSUPPORTED_WEAPON,
  laser_beam_a_4: UNSUPPORTED_WEAPON,
  laser_beam_a_5: UNSUPPORTED_WEAPON,
  laser_beam_b_1: UNSUPPORTED_WEAPON,
  laser_beam_b_2: UNSUPPORTED_WEAPON,
  laser_beam_b_3: UNSUPPORTED_WEAPON,
  laser_beam_b_4: UNSUPPORTED_WEAPON,
  laser_beam_b_5: UNSUPPORTED_WEAPON,

  black_hole_a_1: UNSUPPORTED_BLACK_HOLE_MASTERY,
  black_hole_a_2: UNSUPPORTED_BLACK_HOLE_MASTERY,
  black_hole_a_3: UNSUPPORTED_BLACK_HOLE_MASTERY,
  black_hole_al_4: UNSUPPORTED_BLACK_HOLE_MASTERY,
  black_hole_al_5: UNSUPPORTED_BLACK_HOLE_MASTERY,
  black_hole_ar_4: UNSUPPORTED_BLACK_HOLE_MASTERY,
  black_hole_ar_5: UNSUPPORTED_BLACK_HOLE_MASTERY,
  black_hole_b_1: UNSUPPORTED_BLACK_HOLE_MASTERY,
  black_hole_b_2: UNSUPPORTED_BLACK_HOLE_MASTERY,
  black_hole_b_3: UNSUPPORTED_BLACK_HOLE_MASTERY,
  black_hole_bl_4: UNSUPPORTED_BLACK_HOLE_MASTERY,
  black_hole_bl_5: UNSUPPORTED_BLACK_HOLE_MASTERY,
  black_hole_br_4: UNSUPPORTED_BLACK_HOLE_MASTERY,
  black_hole_br_5: UNSUPPORTED_BLACK_HOLE_MASTERY,

  tesla_coil_a_1: UNSUPPORTED_WEAPON,
  tesla_coil_a_2: UNSUPPORTED_WEAPON,
  tesla_coil_a_3: UNSUPPORTED_WEAPON,
  tesla_coil_a_4: UNSUPPORTED_WEAPON,
  tesla_coil_a_5: UNSUPPORTED_WEAPON,
  tesla_coil_b_1: UNSUPPORTED_WEAPON,
  tesla_coil_b_2: UNSUPPORTED_WEAPON,
  tesla_coil_b_3: UNSUPPORTED_WEAPON,
  tesla_coil_b_4: UNSUPPORTED_WEAPON,
  tesla_coil_b_5: UNSUPPORTED_WEAPON,
};

export const MP_SUPPORTED_UPGRADE_NODE_IDS = new Set(
  Object.entries(MP_UPGRADE_NODE_SUPPORT)
    .filter(([, support]) => support.status !== 'unsupported')
    .map(([nodeId]) => nodeId),
);

export function getMpUpgradeNodeSupport(nodeId: string): MpUpgradeNodeSupport {
  return MP_UPGRADE_NODE_SUPPORT[nodeId] ?? {
    status: 'unsupported',
    reason: 'Unknown, removed, or stale upgrade node id is not supported in MP.',
  };
}

export function isMpUpgradeNodeSupported(nodeId: string): boolean {
  return getMpUpgradeNodeSupport(nodeId).status !== 'unsupported';
}

export function filterMpSupportedUpgradeNodeIds(nodeIds: readonly string[]): string[] {
  return nodeIds.filter(isMpUpgradeNodeSupported);
}

/** Numeric upgrade effects shared by the SP WeaponManager and MP authority. */
export function getUpgradeDamageMultiplier(
  weaponType: WeaponType | string,
  active: ReadonlySet<string>,
): number {
  let bonus = 0;
  switch (weaponType) {
    case WeaponType.Standard:
      if (active.has('standard_a_2')) bonus += 0.40;
      if (active.has('standard_a_3')) bonus += 0.60;
      if (active.has('standard_b_4')) bonus += 0.40;
      if (active.has('standard_al_10')) bonus += 0.50;
      else if (active.has('standard_al_9')) bonus += 0.30;
      if (active.has('standard_br_5')) bonus += 0.60;
      if (active.has('standard_br_7')) bonus += 0.40;
      if (active.has('standard_br_8')) bonus += 0.30;
      if (active.has('standard_br_10')) bonus += 0.50;
      break;
    case WeaponType.Spread:
      if (active.has('spread_al_5')) bonus += 0.15;
      if (active.has('spread_b_2')) bonus += 0.10;
      if (active.has('spread_b_3')) bonus += 0.20;
      if (active.has('spread_bl_5')) bonus += 0.50;
      if (active.has('spread_br_4')) bonus += 0.50;
      if (active.has('spread_br_5')) bonus += 0.30;
      break;
    case WeaponType.ChainLightning:
      if (active.has('chain_lightning_b_1')) bonus += 0.25;
      if (active.has('chain_lightning_b_2')) bonus += 0.50;
      if (active.has('chain_lightning_b_3')) bonus += 0.80;
      if (active.has('chain_lightning_b_5')) bonus += 0.30;
      break;
    case WeaponType.PlasmaMortar:
      if (active.has('plasma_mortar_b_1')) bonus += 0.25;
      if (active.has('plasma_mortar_b_2')) bonus += 0.50;
      if (active.has('plasma_mortar_b_3')) bonus += 0.80;
      if (active.has('plasma_mortar_b_4')) bonus += 0.30;
      if (active.has('plasma_mortar_b_5')) bonus += 0.50;
      break;
    case WeaponType.LaserBeam:
      if (active.has('laser_beam_a_1')) bonus += 0.25;
      if (active.has('laser_beam_a_2')) bonus += 0.50;
      if (active.has('laser_beam_a_3')) bonus += 1.00;
      if (active.has('laser_beam_a_4')) bonus += 1.50;
      if (active.has('laser_beam_a_5')) bonus += 2.00;
      break;
    case WeaponType.TeslaCoil:
      if (active.has('tesla_coil_b_1')) bonus += 0.25;
      if (active.has('tesla_coil_b_2')) bonus += 0.50;
      if (active.has('tesla_coil_b_3')) bonus += 0.80;
      if (active.has('tesla_coil_b_4')) bonus += 1.00;
      if (active.has('tesla_coil_b_5')) bonus += 1.50;
      break;
    default:
      break;
  }
  return 1 + bonus;
}

export function getUpgradeFireRateMultiplier(
  weaponType: WeaponType | string,
  active: ReadonlySet<string>,
): number {
  let bonus = 0;
  if (weaponType === WeaponType.Standard) {
    if (active.has('standard_b_2')) bonus += 0.30;
    if (active.has('standard_b_3')) bonus += 0.50;
    if (active.has('standard_a_4')) bonus += 0.30;
    if (active.has('standard_ar_5')) bonus += 0.50;
    if (active.has('standard_ar_6')) bonus += 0.30;
    if (active.has('standard_ar_7')) bonus += 0.40;
    if (active.has('standard_ar_9')) bonus += 0.80;
    if (active.has('standard_ar_10')) bonus += 0.80;
  } else if (weaponType === WeaponType.Piercing) {
    if (active.has('piercing_b_1')) bonus += 0.20;
    if (active.has('piercing_b_2')) bonus += 0.40;
    if (active.has('piercing_b_3')) bonus += 0.60;
    if (active.has('piercing_bl_5')) bonus += 0.70;
  }
  return 1 + bonus;
}

export function getStandardUpgradePattern(active: ReadonlySet<string>): StandardUpgradePattern {
  let fanExtraBolts = 0;
  let fanAngle = 0;
  if (active.has('standard_al_6')) { fanExtraBolts = 8; fanAngle = Math.PI * 55 / 180; }
  else if (active.has('standard_al_5')) { fanExtraBolts = 4; fanAngle = Math.PI * 35 / 180; }
  else if (active.has('standard_a_4')) { fanExtraBolts = 4; fanAngle = Math.PI / 7.2; }
  else if (active.has('standard_a_3')) { fanExtraBolts = 3; fanAngle = Math.PI / 12; }
  else if (active.has('standard_a_2')) { fanExtraBolts = 2; fanAngle = Math.PI / 18; }
  else if (active.has('standard_a_1')) { fanExtraBolts = 1; fanAngle = Math.PI / 36; }

  let branchBExtraBolts = 0;
  let branchBConeAngle = 0;
  if (active.has('standard_b_3')) { branchBExtraBolts = 3; branchBConeAngle = Math.PI / 36; }
  else if (active.has('standard_b_2')) { branchBExtraBolts = 2; branchBConeAngle = Math.PI / 45; }
  else if (active.has('standard_b_1')) { branchBExtraBolts = 1; branchBConeAngle = Math.PI / 60; }

  return { fanExtraBolts, fanAngle, branchBExtraBolts, branchBConeAngle };
}

export function getSpreadUpgradePattern(active: ReadonlySet<string>): SpreadUpgradePattern {
  const bulletCount = active.has('spread_al_5') ? 10
    : active.has('spread_al_4') ? 9
    : 5
      + (active.has('spread_a_1') ? 1 : 0)
      + (active.has('spread_a_2') ? 1 : 0)
      + (active.has('spread_a_3') ? 1 : 0);

  let spreadAngle = Math.PI / 6;
  if (active.has('spread_br_4') || active.has('spread_br_5')) spreadAngle = Math.PI / 36;
  else if (active.has('spread_b_3')) spreadAngle = Math.PI / 8;
  else if (active.has('spread_b_2')) spreadAngle = Math.PI / 5;
  else if (active.has('spread_b_1')) spreadAngle = Math.PI / 7.5;

  return { bulletCount, spreadAngle };
}
