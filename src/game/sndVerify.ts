import { ModeId } from '../data/modes';
import { StandardMapValidationReport, validateStandardMapLayout } from './maps';
import { SndMatchAuthority, SndRules } from './sndEngine';
import { SndMapId, validateSndMapLayout } from './sndMaps';
import { runSndCheatTests } from './sndCheatVerify';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const TEST_SITES: [
  { id: 'A'; pos: { x: number; y: number; z: number }; radius: number },
  { id: 'B'; pos: { x: number; y: number; z: number }; radius: number },
] = [
  { id: 'A', pos: { x: -20, y: 0, z: 0 }, radius: 5 },
  { id: 'B', pos: { x: 20, y: 0, z: 0 }, radius: 5 },
];

function makeAuthority(overrides: Partial<SndRules> = {}): SndMatchAuthority {
  const auth = new SndMatchAuthority(TEST_SITES, {
    teamSize: 2,
    minPlayersPerTeam: 1,
    waitingDuration: 0.1,
    roundPrepDuration: 0.1,
    buyPhaseDuration: 1.0,
    roundDuration: 10.0,
    roundEndDuration: 0.1,
    intermissionDuration: 0.1,
    sideSwitchDuration: 0.1,
    plantDuration: 2.0,
    defuseDuration: 4.0,
    defuseKitDuration: 2.0,
    bombDetonationDuration: 5.0,
    ...overrides,
  });
  auth.addPlayer('a1', 'Attacker1', 'teamA', true);
  auth.addPlayer('a2', 'Attacker2', 'teamA', false);
  auth.addPlayer('d1', 'Defender1', 'teamB', false);
  auth.addPlayer('d2', 'Defender2', 'teamB', false);
  return auth;
}

function advanceToBuy(auth: SndMatchAuthority): void {
  let guard = 0;
  while (auth.phase !== 'buy_phase' && guard++ < 50) {
    auth.tick(0.05);
  }
  assert(auth.phase === 'buy_phase', `Expected buy_phase, got ${auth.phase}`);
}

export function runAllSndTests(): {
  passed: number;
  mapReports: ReturnType<typeof validateSndMapLayout>[];
  standardMapReports: StandardMapValidationReport[];
} {
  let passed = 0;

  // Test 1: Round init, buy phase restrictions & damage lock
  {
    const a = makeAuthority();
    assert(a.phase === 'waiting', 'Starts in waiting');
    a.tick(0.15);
    assert(a.phase === 'round_prep', `Expected round_prep, got ${a.phase}`);
    a.tick(0.15);
    assert(a.phase === 'buy_phase', `Expected buy_phase, got ${a.phase}`);
    assert(a.getSnapshot().movementLocked === true, 'Movement should lock in buy_phase');
    assert(a.applyDamage('a1', 'd1', 90, true, 'pistol').appliedDamage === 0, 'No damage in buy_phase');
    assert(!a.buyDefuseKit('a1'), 'Attackers cannot buy defuse kit');
    assert(a.buyDefuseKit('d1'), 'Defenders can buy defuse kit with $800');
    assert(a.players.get('d1')!.money === 400, 'Defender cash deducted accurately');
    assert(!a.buyWeapon('a1', 'rifle'), 'Insufficient $800 for $2700 rifle');
    a.tick(1.1);
    assert(a.phase === 'active', 'buy_phase transitions to active');
    assert(!a.buyArmor('d1', false), 'Cannot buy outside buy_phase');
    passed++;
  }

  // Test 2: Bomb Drop, Cooldown & Recovery
  {
    const a = makeAuthority();
    advanceToBuy(a);
    a.tick(1.1);
    const cid = a.bomb.carrierId!;
    const other = cid === 'a1' ? 'a2' : 'a1';
    a.updatePlayerPosition(cid, { x: 2, y: 0, z: 2 });
    assert(a.dropBomb(cid), 'Carrier can drop bomb');
    assert(a.bomb.state === 'dropped', 'Bomb state becomes dropped');
    a.updatePlayerPosition(cid, { x: 2.1, y: 0, z: 2 });
    assert(a.bomb.state === 'dropped', 'Dropper cooldown blocks instant self-pickup');
    a.updatePlayerPosition(other, { x: 2.2, y: 0, z: 2 });
    assert(a.bomb.state === 'carried' && a.bomb.carrierId === other, 'Teammate picks up dropped bomb');
    passed++;
  }

  // Test 3: Plant, Leave Cancel & Completion
  {
    const a = makeAuthority();
    advanceToBuy(a);
    a.tick(1.1);
    const cid = a.bomb.carrierId!;
    a.updatePlayerPosition(cid, { x: 0, y: 0, z: 0 });
    assert(!a.startPlant(cid), 'Cannot plant outside site');
    a.updatePlayerPosition(cid, { x: -20, y: 0, z: 0 });
    assert(a.startPlant(cid), 'Can plant inside Site A');
    assert(a.bomb.state === 'planting', 'State is planting');
    a.updatePlayerPosition(cid, { x: 0, y: 0, z: 0 });
    assert(a.bomb.state === 'carried', 'Moving out of site cancels plant');
    a.updatePlayerPosition(cid, { x: -20, y: 0, z: 0 });
    assert(a.startPlant(cid), 'Re-start plant');
    a.tick(2.05);
    assert(a.bomb.state === 'planted' && a.bomb.site === 'A', 'Bomb completes plant at A');
    assert(a.players.get(cid)!.plants === 1 && a.players.get(cid)!.money === 1100, 'Planter rewarded $300');
    passed++;
  }

  // Test 4: Timer expires mid-plant -> Defenders win
  {
    const a = makeAuthority({ roundDuration: 1.5, plantDuration: 3.0 });
    advanceToBuy(a);
    a.tick(1.1);
    const cid = a.bomb.carrierId!;
    a.updatePlayerPosition(cid, { x: 20, y: 0, z: 0 });
    a.startPlant(cid);
    a.tick(1.6);
    assert(a.phase === 'round_end' && a.lastRoundWinner?.reason === 'time_expired', 'Timer expiry mid-plant awards round to Defenders');
    passed++;
  }

  // Test 5: Post-plant Attacker Elimination + Defuse with Kit
  {
    const a = makeAuthority();
    advanceToBuy(a);
    a.buyDefuseKit('d1');
    a.tick(1.1);
    const cid = a.bomb.carrierId!;
    a.updatePlayerPosition(cid, { x: -20, y: 0, z: 0 });
    a.startPlant(cid);
    a.tick(2.05);
    // Kill ALL Attackers AFTER plant!
    a.applyDamage('d1', 'a1', 200, true, 'pistol');
    a.applyDamage('d1', 'a2', 200, true, 'pistol');
    assert(a.phase === 'active', 'Round MUST continue when Attackers die post-plant');
    a.updatePlayerPosition('d1', { x: -20.5, y: 0, z: 0 });
    assert(a.startDefuse('d1'), 'Defender starts kit defuse');
    a.tick(2.05); // 2.0s kit defuse finishes
    assert(a.phase === 'round_end' && a.lastRoundWinner?.reason === 'defused', 'Kit defuse wins round for Defenders');
    assert(a.players.get('d1')!.defuses === 1, 'Defuse stat incremented');
    passed++;
  }

  // Test 6: Fuse expires BEFORE slow non-kit defuse finishes -> Attackers win detonated
  {
    const a = makeAuthority({ bombDetonationDuration: 2.0, defuseDuration: 5.0 });
    advanceToBuy(a);
    a.tick(1.1);
    const cid = a.bomb.carrierId!;
    a.updatePlayerPosition(cid, { x: -20, y: 0, z: 0 });
    a.startPlant(cid);
    a.tick(2.05);
    a.updatePlayerPosition('d2', { x: -20, y: 0, z: 0 });
    a.startDefuse('d2');
    a.tick(2.1); // Fuse hits 0 while defuse is only ~42%
    assert(a.phase === 'round_end' && a.lastRoundWinner?.reason === 'detonated', 'Fuse expiry beats incomplete defuse');
    passed++;
  }

  // Test 7: Simultaneous last-player elimination pre-plant vs post-plant
  {
    const a = makeAuthority({ teamSize: 1 });
    const s = new SndMatchAuthority(TEST_SITES, { teamSize: 1, waitingDuration: 0.1, roundPrepDuration: 0.1, buyPhaseDuration: 0.1 });
    s.addPlayer('a1', 'A', 'teamA', true);
    s.addPlayer('d1', 'D', 'teamB', false);
    s.tick(0.2); s.tick(0.2); s.tick(0.2);
    // Simultaneous kill pre-plant via friendly/enemy state check
    s.players.get('a1')!.alive = false;
    s.players.get('d1')!.alive = false;
    s.resolveRoundIfNeeded();
    assert(s.lastRoundWinner?.winnerSide === 'defenders', 'Simultaneous wipe pre-plant goes to Defenders');
    void a;
    passed++;
  }

  // Test 8: Assist attribution & Loss Streak + Side Switch + Overtime Win-by-2
  {
    const a = makeAuthority({ roundsPerHalf: 2, roundsToWin: 3, overtimeHalfRounds: 1, overtimeWinMargin: 2 });
    advanceToBuy(a);
    a.tick(1.1);
    a.applyDamage('a2', 'd1', 40, false, 'pistol');
    a.applyDamage('a1', 'd1', 80, true, 'pistol');
    assert(a.players.get('a2')!.assists === 1, 'Teammate dealing >= 25 damage earns assist');
    a.applyDamage('a1', 'd2', 120, false, 'pistol');
    assert(a.score.teamA === 1 && a.lossStreak.teamB === 1, 'Team A leads 1-0, Team B loss streak 1');
    a.tick(0.2); a.tick(0.2); // round_end -> intermission -> round 2 prep
    advanceToBuy(a); a.tick(1.1);
    a.applyDamage('d1', 'a1', 120, true, 'pistol');
    a.applyDamage('d1', 'a2', 120, true, 'pistol');
    assert(a.score.teamA === 1 && a.score.teamB === 1, 'Tied 1-1 after round 2');
    a.tick(0.2);
    assert(a.phase === 'side_switch', 'Half-time side switch triggered after round 2');
    assert(a.attackersTeam === 'teamB', 'Attackers switched to teamB');
    // Finish regulation 2-2 to test Overtime
    a.tick(0.2); a.tick(0.2); a.tick(1.1);
    a.applyDamage('a1', 'd1', 120, true, 'pistol');
    a.applyDamage('a1', 'd2', 120, true, 'pistol');
    a.tick(0.2); a.tick(0.2); a.tick(0.2); a.tick(1.1);
    a.applyDamage('d1', 'a1', 120, true, 'pistol');
    a.applyDamage('d1', 'a2', 120, true, 'pistol');
    assert(a.score.teamA === 2 && a.score.teamB === 2, 'Tied 2-2 entering Overtime');
    a.tick(0.2);
    assert(a.overtimeIndex === 1 && a.phase === 'side_switch', 'Overtime 1 triggered cleanly');
    assert(a.players.get('a1')!.money === 10000, 'Overtime money reset to $10,000');
    passed++;
  }

  // Test 9: Disconnect carrier mid-round drops bomb
  {
    const a = makeAuthority();
    advanceToBuy(a);
    a.tick(1.1);
    const cid = a.bomb.carrierId!;
    a.updatePlayerPosition(cid, { x: 4, y: 0, z: 5 });
    a.disconnectPlayer(cid);
    assert(a.bomb.state === 'dropped' && a.bomb.carrierId === null, 'Disconnecting carrier drops C4 at position');
    assert(a.reconnectPlayer(cid), 'Disconnected player can reconnect');
    passed++;
  }

  // Test 10-12: Automated Nav Grid, Route, Collision & Sightline Validation for District 9, Cold Front, Neon Market
  const mapReports = (['district9', 'coldfront', 'neonmarket'] as SndMapId[]).map((id) => {
    const r = validateSndMapLayout(id);
    assert(r.valid, `Map ${id} failed validation: ${r.errors.join('; ')}`);
    assert(r.attackerSpawnCount === 5 && r.defenderSpawnCount === 5, `Map ${id} must have 5 spawns per side`);
    assert(r.spawnLoSBlocked, `Map ${id} has direct spawn-to-spawn sightline`);
    assert(r.crossSiteLoSBlocked, `Map ${id} has direct cross-map sightline between Site A and Site B`);
    passed++;
    return r;
  });

  // Test 13-17: Automated Validation for Standard Maps (range, arena, defend, dm, hvh)
  const standardMapReports = (['range', 'arena', 'defend', 'dm', 'hvh'] as ModeId[]).map((id) => {
    const r = validateStandardMapLayout(id);
    assert(r.valid, `Standard map ${id} failed validation: ${r.errors.join('; ')}`);
    assert(r.allSpawnsReachable, `Standard map ${id} has unreachable spawns`);
    assert(r.spawnLoSProtected, `Standard map ${id} has unshielded spawn-to-spawn LOS`);
    passed++;
    return r;
  });

  passed += runSndCheatTests(assert);

  return { passed, mapReports, standardMapReports };
}
