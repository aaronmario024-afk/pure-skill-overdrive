import { BALANCE, BOUNTY_COLORS, BOUNTY_PAY, BountyTier } from '../data/balance';
import { WeaponDef } from '../data/weapons';
import { ActiveCheatMods } from '../state/store';
import { WallType } from './maps';

export interface SndMovementParams {
  bhopMult: number;
  baseSpeed: number;
  jumpHeight: number;
  airControl: number;
  fovBoost: number;
  maxMoveSpeed: number;
}

export interface SndShotDamageInput {
  def: WeaponDef;
  mods: ActiveCheatMods;
  isHead: boolean;
  throughWall: boolean;
  isEnemyFriendly: boolean;
  isEnemyAdmin: boolean;
  isEnemyCheater: boolean;
  targetHp: number;
}

export interface SndKillPayoutInput {
  def: WeaponDef;
  mods: ActiveCheatMods;
  prestigeMult: number;
  bounty: BountyTier;
  isAdmin: boolean;
  isHead: boolean;
  headStreak: number;
  throughWall: boolean;
  isBacktrack: boolean;
  scoped: boolean;
  scopedElapsed: number;
  grounded: boolean;
  turnedRecently: number;
  distance: number;
  hopChain: number;
  missesSinceKill: number;
  multiKill: number;
  blinkBonusActive: boolean;
  isLastBullet: boolean;
  isRevenge: boolean;
}

export interface SndKillPayoutResult {
  totalCents: number;
  lines: { label: string; amount: number; color: string }[];
  tags: string[];
}

/** Returns weapon clip capacity scaled by active Ammo cheat upgrades. */
export function computeSndMagSize(def: WeaponDef, mods: ActiveCheatMods): number {
  if (def.isMelee) return 1;
  return Math.max(1, Math.round(def.magazineSize * mods.magMult));
}

/** Computes live SnD movement speed, jump height, air control and FOV speed boost from active cheats. */
export function computeSndMovementParams(
  def: WeaponDef,
  mods: ActiveCheatMods,
  crouching: boolean,
  hopChain: number,
  dashActive: boolean,
): SndMovementParams {
  const dashMult = dashActive ? 2.0 : 1.0;
  const bhopMult = mods.bhopOn
    ? Math.min(mods.bhopTopSpeed, 1 + hopChain * (mods.bhopMoonhop ? 0.28 : 0.16))
    : 1.0;
  const maxMoveSpeed = BALANCE.walkSpeed * def.moveSpeed * mods.speedMult;
  const baseSpeed = maxMoveSpeed * dashMult * bhopMult * (crouching ? BALANCE.crouchSpeed : 1);
  const jumpHeight = BALANCE.jumpHeight * (mods.bhopMoonhop ? 1.8 : 1.0);
  const airControl = mods.bhopAirStrafe ? 10 : 3.2;
  const fovBoost = (bhopMult - 1) * 7;
  return { bhopMult, baseSpeed, jumpHeight, airControl, fovBoost, maxMoveSpeed };
}

/** Checks whether a wall barrier of `wallType` can be penetrated at the active wallbang tier. */
export function canSndPierceWall(wallType: WallType, mods: ActiveCheatMods): boolean {
  if (mods.wallbangTier === 0) return false;
  if (mods.wallbangTier === 1) return wallType === 'thin';
  if (mods.wallbangTier === 2) return wallType === 'thin' || wallType === 'crate';
  return true;
}

/** Returns effective shot interval factoring Rage RPM upgrades and Triggerbot Rapid-Tap Overclock. */
export function computeSndFireInterval(def: WeaponDef, mods: ActiveCheatMods, fromTrigger: boolean): number {
  const rpmBoost = mods.fireRateMult * (fromTrigger ? mods.triggerRapidTap : 1);
  return def.fireInterval / Math.max(0.1, rpmBoost);
}

/** Computes per-hit SnD shot damage across Hitbox, Wallbang, Spinbot Resolver and Rage One-Tap upgrades. */
export function computeSndShotDamage(params: SndShotDamageInput): { finalHeadshot: boolean; damage: number } {
  const { def, mods, isHead, throughWall, isEnemyFriendly, isEnemyAdmin, isEnemyCheater, targetHp } = params;
  const finalHeadshot = isHead || (!isEnemyFriendly && mods.fullBodyHead);
  let dmg = def.damage * (isEnemyFriendly ? 1 : mods.damageMult);
  if (finalHeadshot) {
    dmg *= def.headshotMultiplier * (isEnemyFriendly ? 1 : mods.headDamageMult);
  }
  if (throughWall) {
    dmg *= mods.wallbangDamage;
  }
  if (!isEnemyFriendly && (isEnemyCheater || isEnemyAdmin) && mods.spinbotResolver) {
    dmg *= 2.0;
  }
  if (!isEnemyFriendly && finalHeadshot && mods.oneTapHead && !isEnemyAdmin) {
    // Exceed 0.8x helmet armor reduction so helmeted SnD bots reliably die in 1 headshot
    dmg = Math.max(dmg, targetHp * 2 + 120);
  }
  return { finalHeadshot, damage: dmg };
}

/** Applies Speedhack Sprint Evasion, Bunnyhop Speed Dodge, and Spinbot Anti-Aim evasion to bot hit probability. */
export function computeSndBotHitChance(
  baseHitProb: number,
  mods: ActiveCheatMods,
  humanHorizSpeed: number,
  hopChain: number,
): number {
  let hitChance = baseHitProb;
  if (mods.sprintDodge > 0 && humanHorizSpeed > 5) hitChance *= 1 - mods.sprintDodge;
  if (mods.bhopDodge > 0 && hopChain >= 2) hitChance *= 1 - mods.bhopDodge;
  if (mods.spinbotDodge > 0) hitChance *= 1 - mods.spinbotDodge;
  return Math.max(0, hitChance);
}

/** Rolls SnD enemy bounty tier when Wallhack + ESP is active. */
export function rollSndEnemyBounty(mods: ActiveCheatMods, rng: () => number = Math.random): BountyTier {
  if (!mods.wallhackOn) return 'normal';
  if (mods.rainbowOn && rng() < 0.06) return 'rainbow';
  const r = rng();
  if (r < mods.goldChance) return 'gold';
  if (r < mods.goldChance + mods.redChance) return 'red';
  if (r < mods.goldChance + mods.redChance + mods.greenChance) return 'green';
  return 'normal';
}

/** Computes Piggy Bank deposit in cents for each fired weapon shot in SnD. */
export function computeSndPiggyDeposit(
  mods: ActiveCheatMods,
  anyHit: boolean,
  isGoldBullet: boolean,
  fireHoldTime: number,
  prestigeMult: number,
): number {
  if (!mods.piggyOn) return 0;
  const baseDeposit = BALANCE.creditsPerKill * 2.5 * 0.15 * prestigeMult;
  const hitM = anyHit ? mods.piggyHitMult : 1;
  const goldM = isGoldBullet ? 10 : 1;
  const stormM = mods.piggyStorm && fireHoldTime >= 3 ? 2 : 1;
  return baseDeposit * hitM * goldM * stormM;
}

/** Computes full SnD desktop kill payout and itemized breakdown across all cheats and style bonuses. */
export function computeSndKillPayout(params: SndKillPayoutInput): SndKillPayoutResult {
  const {
    def,
    mods,
    prestigeMult,
    bounty,
    isAdmin,
    isHead,
    headStreak,
    throughWall,
    isBacktrack,
    scoped,
    scopedElapsed,
    grounded,
    turnedRecently,
    distance,
    hopChain,
    missesSinceKill,
    multiKill,
    blinkBonusActive,
    isLastBullet,
    isRevenge,
  } = params;

  const lines: { label: string; amount: number; color: string }[] = [];
  const tags: string[] = [];
  const addLine = (label: string, amount: number, color: string) => {
    lines.push({ label, amount, color });
  };

  let total = BALANCE.creditsPerKill * 2.5 * def.killPay * prestigeMult;
  addLine('SnD Kills + Waffe', total, '#4ade80');

  let bountyMult = BOUNTY_PAY[bounty];
  if (isAdmin && mods.adminJammer) bountyMult *= 2;
  if (bountyMult > 1) {
    const add = total * (bountyMult - 1);
    total += add;
    addLine('Bounties', add, BOUNTY_COLORS[bounty]);
    tags.push(`${isAdmin ? 'ADMIN' : bounty.toUpperCase()} ${bountyMult}x`);
  }

  if (isHead) {
    const hsAdd = total * BALANCE.headshotBonus * mods.headshotPayMult;
    total += hsAdd;
    addLine('Headshots', hsAdd, '#facc15');
    tags.push('HEADSHOT');

    if (mods.headStreakStep > 0 && headStreak > 1) {
      const streakMult = Math.min(mods.headStreakCap, 1 + (headStreak - 1) * mods.headStreakStep);
      const sAdd = total * (streakMult - 1);
      total += sAdd;
      addLine('HS-Streak', sAdd, '#fb923c');
      tags.push(`STREAK x${streakMult.toFixed(2)}`);
    }
  }

  if (throughWall) {
    const wbMult = mods.wallbangPayMult > 1 ? mods.wallbangPayMult : 1.35;
    const wAdd = total * (wbMult - 1);
    total += wAdd;
    addLine('Wallbang', wAdd, '#4ade80');
    tags.push('WALLBANG');
  }

  if (isBacktrack) {
    const btAdd = total * BALANCE.backtrackBonus;
    total += btAdd;
    addLine('Backtrack', btAdd, '#22d3ee');
    tags.push('BACKTRACK +150%');
  }

  if (def.scope && !scoped) {
    const add = total * BALANCE.noscopeBonus;
    total += add;
    addLine('Noscope', add, '#a855f7');
    tags.push('NOSCOPE');
  } else if (def.scope && scoped && scopedElapsed < 0.45) {
    const add = total * BALANCE.quickscopeBonus;
    total += add;
    addLine('Quickscope', add, '#c084fc');
    tags.push('QUICKSCOPE');
  }

  if (!grounded) {
    const add = total * BALANCE.jumpshotBonus;
    total += add;
    addLine('Jumpshot', add, '#38bdf8');
    tags.push('JUMPSHOT');
  }

  if (mods.spinbotAuto360 || turnedRecently >= 260) {
    const add = total * BALANCE.spinBonus;
    total += add;
    addLine('360 Spin', add, '#e879f9');
    tags.push('360°');
  }

  if (mods.longshotPayMult > 1 && distance >= 20) {
    const add = total * (mods.longshotPayMult - 1);
    total += add;
    addLine('Longshot', add, '#38bdf8');
    tags.push(`LONGSHOT ${Math.round(distance)}m`);
  }

  if (mods.bhopPayPerHop > 0 && hopChain > 0) {
    const add = total * (hopChain * mods.bhopPayPerHop);
    total += add;
    addLine('Hop-Chain', add, '#2dd4bf');
    tags.push(`BHOP x${hopChain}`);
  }

  if (mods.triggerCleanPay > 1 && missesSinceKill === 0) {
    const add = total * (mods.triggerCleanPay - 1);
    total += add;
    addLine('Clean Kills', add, '#fb923c');
    tags.push('CLEAN');
  }

  if (mods.momentumPay && multiKill >= 2) {
    const mMult = Math.min(2.5, 1 + (multiKill - 1) * 0.45);
    const add = total * (mMult - 1);
    total += add;
    addLine('Multi-Kill', add, '#fbbf24');
    tags.push(`MULTI x${multiKill}`);
  }

  if (blinkBonusActive) {
    const add = total * BALANCE.blinkBonus;
    total += add;
    addLine('Kill Blink', add, '#fbbf24');
    tags.push('BLINK +100%');
  }

  if (isLastBullet) {
    const add = total * BALANCE.lastBulletBonus;
    total += add;
    addLine('Last Bullet', add, '#f472b6');
    tags.push('LAST BULLET');
  }

  if (isRevenge) {
    const add = total * BALANCE.revengeBonus;
    total += add;
    addLine('Revenge', add, '#f43f5e');
    tags.push('REVENGE');
  }

  return { totalCents: Math.round(total), lines, tags };
}
