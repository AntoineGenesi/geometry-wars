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

/** Numeric upgrade effects shared by the SP WeaponManager and MP authority. */
export function getUpgradeDamageMultiplier(
  weaponType: WeaponType | string,
  active: ReadonlySet<string>,
): number {
  let bonus = 0;
  switch (weaponType) {
    case WeaponType.Standard:
      if (active.has('standard_a_1')) bonus += 0.20;
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
    if (active.has('standard_b_1')) bonus += 0.15;
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
  else if (active.has('standard_al_5')) { fanExtraBolts = 4; fanAngle = Math.PI / 7.2; }
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
  const extraPellets =
    (active.has('spread_a_1') ? 1 : 0) +
    (active.has('spread_a_2') ? 1 : 0) +
    (active.has('spread_a_3') ? 1 : 0) +
    (active.has('spread_al_4') ? 4 : 0) +
    (active.has('spread_al_5') ? 5 : 0);

  let spreadAngle = Math.PI / 6;
  if (active.has('spread_br_4') || active.has('spread_br_5')) spreadAngle = Math.PI / 36;
  else if (active.has('spread_b_3')) spreadAngle = Math.PI / 8;
  else if (active.has('spread_b_2')) spreadAngle = Math.PI / 5;
  else if (active.has('spread_b_1')) spreadAngle = Math.PI / 7.5;

  return { bulletCount: 5 + extraPellets, spreadAngle };
}
