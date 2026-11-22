import { CHEATS } from '../data/cheats';
import { computeWeaponSpreadDeg, getWeaponDef } from '../data/weapons';
import { store } from '../state/store';
import {
  canSndPierceWall,
  computeSndBotHitChance,
  computeSndFireInterval,
  computeSndKillPayout,
  computeSndMagSize,
  computeSndMovementParams,
  computeSndPiggyDeposit,
  computeSndShotDamage,
  rollSndEnemyBounty,
} from './sndCheatHelpers';
import { SndMatchAuthority, DEFAULT_SND_RULES } from './sndEngine';
import { getSndBlueprint } from './sndMaps';

/**
 * Verifies that all 12 purchasable cheats, their upgrade nodes, cross-cheat synergies,
 * payout modifiers, and SnD authority safety invariants operate properly in SnD.
 */
export function runSndCheatTests(assertFn: (cond: boolean, msg: string) => void): number {
  let passed = 0;

  const savedCheats = JSON.parse(JSON.stringify(store.data.cheats));
  const savedCredits = store.data.credits;

  try {
    // Baseline: disable/clear all cheats
    store.data.cheats = JSON.parse(JSON.stringify(savedCheats));
    for (const id of Object.keys(store.data.cheats)) {
      store.data.cheats[id].owned = false;
      store.data.cheats[id].enabled = false;
      store.data.cheats[id].boughtNodes = [];
    }
    const baseMods = store.computeActiveMods();
    const rifleDef = getWeaponDef('rifle');
    const pistolDef = getWeaponDef('pistol');

    // Sanity baseline check
    assertFn(!baseMods.bhopOn && !baseMods.triggerOn && !baseMods.aimbotOn, 'Baseline mods must be off');
    assertFn(computeSndMagSize(rifleDef, baseMods) === rifleDef.magazineSize, 'Baseline mag size unchanged');
    assertFn(!canSndPierceWall('thin', baseMods), 'Baseline cannot wallbang thin walls');
    passed++;

    // Buy all 12 cheat licenses first, then multi-pass nodes until fixed point
    // (cross-cheat synergy nodes such as backtrack:chronoblast require rage:explode)
    assertFn(CHEATS.length === 12, `Expected 12 cheat categories, got ${CHEATS.length}`);
    store.data.credits = 9_999_999_999;
    for (const cheat of CHEATS) {
      const licOk = store.buyCheatLicense(cheat.id);
      assertFn(licOk, `Failed to buy cheat license: ${cheat.id}`);
      store.data.cheats[cheat.id].enabled = true;
    }
    let boughtAny = true;
    while (boughtAny) {
      boughtAny = false;
      for (const cheat of CHEATS) {
        for (const node of cheat.nodes) {
          if (!store.hasNode(cheat.id, node.id) && store.buyCheatNode(cheat.id, node.id)) {
            boughtAny = true;
          }
        }
      }
    }
    for (const cheat of CHEATS) {
      for (const node of cheat.nodes) {
        assertFn(store.hasNode(cheat.id, node.id), `Failed to buy cheat node ${cheat.id}/${node.id}`);
      }
    }
    const maxMods = store.computeActiveMods();
    passed++;

    // 1. Hitbox + Full-Body Head + Streak Damage & Friendly Guard
    assertFn(maxMods.hitboxOn && maxMods.headScale > 1.0, 'Hitbox cheat must enlarge headScale');
    assertFn(maxMods.headDamageMult > 1.0, 'Hitbox upgrade must boost headDamageMult');
    assertFn(maxMods.fullBodyHead === true, 'Hitbox upgrade must enable fullBodyHead');
    const bodyWithHitbox = computeSndShotDamage({
      def: rifleDef,
      mods: maxMods,
      isHead: false,
      throughWall: false,
      isEnemyFriendly: false,
      isEnemyAdmin: false,
      isEnemyCheater: false,
      targetHp: 100,
    });
    assertFn(bodyWithHitbox.finalHeadshot, 'fullBodyHead must convert body shot against enemy into headshot');
    assertFn(bodyWithHitbox.damage > rifleDef.damage * 2, 'Hitbox + Rage damage must scale headshot hit');
    const friendlyHit = computeSndShotDamage({
      def: rifleDef,
      mods: maxMods,
      isHead: false,
      throughWall: false,
      isEnemyFriendly: true,
      isEnemyAdmin: false,
      isEnemyCheater: false,
      targetHp: 100,
    });
    assertFn(!friendlyHit.finalHeadshot && friendlyHit.damage === rifleDef.damage, 'Friendly hits must ignore cheat buffs');
    passed++;

    // 2. No Recoil / Spread + Longshot Pay
    assertFn(maxMods.spreadMult < 0.2, 'NoRecoil cheat must drastically reduce spreadMult');
    const baseSpread = computeWeaponSpreadDeg({
      def: rifleDef,
      horizSpeed: 6,
      maxMoveSpeed: 6,
      grounded: true,
      crouching: false,
      scoped: false,
      shotBloom: 1.5,
      spreadMult: baseMods.spreadMult,
    });
    const cheatSpread = computeWeaponSpreadDeg({
      def: rifleDef,
      horizSpeed: 6,
      maxMoveSpeed: 6,
      grounded: true,
      crouching: false,
      scoped: false,
      shotBloom: 1.5,
      spreadMult: maxMods.spreadMult,
    });
    assertFn(cheatSpread.totalDeg < baseSpread.totalDeg, 'NoRecoil must reduce running spread in SnD');
    passed++;

    // 3. Wallhack / ESP / 3-Tier Wallbang / Bounty Roll
    assertFn(maxMods.wallhackOn === true, 'Wallhack must enable wallhackOn');
    assertFn(maxMods.wallbangTier >= 3, 'Maxed Wallhack must reach wallbang tier 3');
    assertFn(canSndPierceWall('thin', maxMods), 'Wallhack tier 3 pierces thin walls');
    assertFn(canSndPierceWall('crate', maxMods), 'Wallhack tier 3 pierces crate walls');
    assertFn(canSndPierceWall('solid', maxMods), 'Wallhack tier 3 pierces solid walls');
    assertFn(rollSndEnemyBounty(maxMods, () => 0.01) !== 'normal', 'Wallhack bounty upgrade rolls high-tier bounty');
    passed++;

    // 4. Bunnyhop + Speedhack Movement, Dodge, Blink/Dash
    const baseMove = computeSndMovementParams(rifleDef, baseMods, false, 0, false);
    const cheatMove = computeSndMovementParams(rifleDef, maxMods, false, 3, true);
    assertFn(maxMods.bhopOn && maxMods.speedMult > 1.0 && maxMods.killDash && maxMods.killBlink, 'Bhop & Speedhack active');
    assertFn(cheatMove.baseSpeed > baseMove.baseSpeed * 1.4, 'Bhop + Speedhack + Dash must increase SnD speed');
    assertFn(cheatMove.jumpHeight > baseMove.jumpHeight, 'Moonhop must boost SnD jumpHeight');
    assertFn(cheatMove.fovBoost > 0, 'Bhop chain must produce speed FOV boost');
    const baseBotAcc = computeSndBotHitChance(0.5, baseMods, 0, 0);
    const evadedBotAcc = computeSndBotHitChance(0.5, maxMods, cheatMove.baseSpeed, 3);
    assertFn(evadedBotAcc < baseBotAcc, 'Spinbot/Bhop/Sprint dodge must reduce incoming bot hit probability');
    passed++;

    // 5. Bypass (Heat Reduction, Vote-Kick Blocker, HWID Spoof, Admin Jammer)
    assertFn(maxMods.heatMult < 1.0, 'Bypass must reduce Heat gain');
    assertFn(maxMods.voteKickBlocker === true, 'Bypass must enable voteKickBlocker');
    assertFn(maxMods.hwidSpoofCharges >= 1, 'Bypass must provide HWID spoof charges');
    assertFn(maxMods.adminJammer === true, 'Bypass must enable Admin Jammer');
    passed++;

    // 6. Triggerbot (Auto Fire + Rapid Tap + X-Ray Synergy + Auto Reload)
    assertFn(maxMods.triggerOn && maxMods.triggerXray && maxMods.triggerAutoReload, 'Triggerbot & X-Ray active');
    const baseTrigInterval = computeSndFireInterval(pistolDef, baseMods, true);
    const rapidTrigInterval = computeSndFireInterval(pistolDef, maxMods, true);
    assertFn(rapidTrigInterval < baseTrigInterval, 'Triggerbot RapidTap + Rage must speed up trigger fire interval');
    passed++;

    // 7. Ammo + Infinite Ammo + Piggy Bank (Hit, Gold Bullet, Storm)
    assertFn(maxMods.infiniteAmmo === true, 'Maxed Ammo enables infiniteAmmo');
    assertFn(computeSndMagSize(rifleDef, maxMods) > rifleDef.magazineSize, 'Ammo magMult enlarges SnD mag size');
    const piggyPay = computeSndPiggyDeposit(maxMods, true, true, 3.2, 1.0);
    assertFn(piggyPay > 0, 'Piggy Bank must generate credits on hits / gold bullets / storm fire');
    passed++;

    // 8. Aimbot + FOV + Snap + Ring + Bounty Prio + Wall-Lock + Volley
    assertFn(
      maxMods.aimbotOn &&
        maxMods.aimbotFovDeg > 0 &&
        maxMods.aimbotSnap > 0 &&
        maxMods.aimbotRing &&
        maxMods.aimbotBountyPrio &&
        maxMods.aimbotWallLock &&
        maxMods.volleyCount >= 3,
      'All Aimbot nodes and Wall-Lock / Volley upgrades must be active',
    );
    passed++;

    // 9. Spinbot + Auto-360 + Resolver + Dodge
    assertFn(
      maxMods.spinbotOn && maxMods.spinbotDodge > 0 && maxMods.spinbotAuto360 && maxMods.spinbotResolver,
      'All Spinbot modes and Resolver must be active',
    );
    const vsCheaterNoResolver = computeSndShotDamage({
      def: pistolDef,
      mods: { ...baseMods, spinbotResolver: false },
      isHead: false,
      throughWall: false,
      isEnemyFriendly: false,
      isEnemyAdmin: true,
      isEnemyCheater: true,
      targetHp: 100,
    });
    const vsCheaterResolver = computeSndShotDamage({
      def: pistolDef,
      mods: { ...baseMods, spinbotResolver: true },
      isHead: false,
      throughWall: false,
      isEnemyFriendly: false,
      isEnemyAdmin: true,
      isEnemyCheater: true,
      targetHp: 100,
    });
    assertFn(vsCheaterResolver.damage > vsCheaterNoResolver.damage, 'Spinbot Resolver must double damage vs Admin/cheater bots');
    passed++;

    // 10. Backtrack + Freeze-Peek + Chrono-Blast
    assertFn(
      maxMods.backtrackOn && maxMods.backtrackWindow > 0 && maxMods.backtrackFreezePeek && maxMods.backtrackChronoBlast,
      'Backtrack window, Freeze-Peek, and Chrono-Blast synergy must be active',
    );
    passed++;

    // 11. Rage (Damage Mult, One-Tap Head, Explode On Kill, Force Auto, Fire Rate Mult)
    assertFn(
      maxMods.damageMult > 1 && maxMods.oneTapHead && maxMods.explodeOnKill && maxMods.forceAuto && maxMods.fireRateMult > 1,
      'All Rage upgrades must be active',
    );
    const oneTapRes = computeSndShotDamage({
      def: pistolDef,
      mods: maxMods,
      isHead: true,
      throughWall: false,
      isEnemyFriendly: false,
      isEnemyAdmin: false,
      isEnemyCheater: false,
      targetHp: 100,
    });
    assertFn(oneTapRes.damage >= 300, 'Rage One-Tap Head must deal overwhelming fatal headshot damage');
    passed++;

    // 12. Kill Payout Parity (Bounty + Admin Jammer + HS + Streak + Wallbang + Backtrack + Longshot + Bhop + Blink + Clean)
    const maxPayout = computeSndKillPayout({
      def: rifleDef,
      mods: maxMods,
      prestigeMult: 1.0,
      bounty: 'gold',
      isAdmin: true,
      isHead: true,
      headStreak: 3,
      throughWall: true,
      isBacktrack: true,
      scoped: false,
      scopedElapsed: 0,
      grounded: false,
      turnedRecently: 360,
      distance: 45,
      hopChain: 3,
      missesSinceKill: 0,
      multiKill: 2,
      blinkBonusActive: true,
      isLastBullet: true,
      isRevenge: true,
    });
    const minPayout = computeSndKillPayout({
      def: rifleDef,
      mods: baseMods,
      prestigeMult: 1.0,
      bounty: 'normal',
      isAdmin: false,
      isHead: false,
      headStreak: 0,
      throughWall: false,
      isBacktrack: false,
      scoped: false,
      scopedElapsed: 0,
      grounded: true,
      turnedRecently: 0,
      distance: 10,
      hopChain: 0,
      missesSinceKill: 2,
      multiKill: 1,
      blinkBonusActive: false,
      isLastBullet: false,
      isRevenge: false,
    });
    assertFn(maxPayout.totalCents > minPayout.totalCents * 4, 'Combined cheat payout multipliers must scale SnD kill rewards');
    assertFn(maxPayout.tags.includes('BACKTRACK +150%') && maxPayout.tags.includes('WALLBANG'), 'Payout breakdown tags must populate');
    passed++;

    // 13. SndMatchAuthority: Rage One-Tap kills full-armor+helmet enemy & Friendly Fire guard holds
    const bp = getSndBlueprint('district9');
    const auth = new SndMatchAuthority(
      [bp.siteA, bp.siteB],
      { ...DEFAULT_SND_RULES, buyPhaseDuration: 0.01, waitingDuration: 0.01 },
      'teamA',
    );
    const pHuman = auth.addPlayer('human', 'You', 'teamA', true);
    const pAlly = auth.addPlayer('ally1', 'Ally', 'teamA', false);
    const pEnemy = auth.addPlayer('enemy1', 'Enemy', 'teamB', false);
    auth.forceStartIfReady();
    for (let i = 0; i < 60 && auth.phase !== 'active'; i++) {
      auth.tick(0.2);
    }
    assertFn(auth.phase === 'active', `Expected active phase for SnD damage check, got ${auth.phase}`);
    pEnemy.armor = 50;
    pEnemy.hasHelmet = true;
    const dmgRes = auth.applyDamage(pHuman.id, pEnemy.id, oneTapRes.damage, true, 'pistol');
    assertFn(dmgRes.killed && !pEnemy.alive, 'Rage One-Tap headshot must execute armored+helmeted SnD enemy cleanly');
    const allyBefore = pAlly.hp;
    const ffRes = auth.applyDamage(pHuman.id, pAlly.id, 100, true, 'rifle');
    assertFn(!ffRes.killed && pAlly.hp === allyBefore, 'SnD authority must block friendly fire from any cheat shot');
    passed++;
  } finally {
    store.data.cheats = savedCheats;
    store.data.credits = savedCredits;
  }

  return passed;
}
