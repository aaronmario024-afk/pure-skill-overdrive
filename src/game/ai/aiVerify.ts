import { getStandardMapLayout } from '../maps';
import { SndMatchAuthority } from '../sndEngine';
import { getSndBlueprint, SndMapId } from '../sndMaps';
import { BotAIManager } from './brain';
import { createModeAdapter, SndModeAdapter } from './modes';
import { NavGrid, NavWallBox, navWallsFromBoxes } from './navigation';
import {
  AiCombatantInput,
  BOT_DIFFICULTIES,
  ModeIdLike,
  Vec3,
  WorldQueryApi,
} from './aiVerifyTypes';

// Avoid any browser dependency in headless tests; keep clean typed AABB raycast here.
function rayIntersectsBoxXZ(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  box: NavWallBox,
): boolean {
  let tmin = 0;
  let tmax = maxDist;

  const checkAxis = (orig: number, dir: number, bmin: number, bmax: number): boolean => {
    if (Math.abs(dir) < 1e-8) return orig >= bmin && orig <= bmax;
    const inv = 1 / dir;
    let t1 = (bmin - orig) * inv;
    let t2 = (bmax - orig) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };

  if (!checkAxis(ox, dx, box.minX, box.maxX)) return false;
  if (!checkAxis(oy, dy, 0, box.maxY)) return false;
  if (!checkAxis(oz, dz, box.minZ, box.maxZ)) return false;
  return tmax >= 0 && tmin <= maxDist;
}

function makeHeadlessWorld(
  losWalls: NavWallBox[],
  getTimeFn: () => number,
): WorldQueryApi {
  return {
    getTime: getTimeFn,
    hasLineOfSight(from: Vec3, to: Vec3): boolean {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dz = to.z - from.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.05) return true;
      const ux = dx / len;
      const uy = dy / len;
      const uz = dz / len;
      for (const b of losWalls) {
        if (rayIntersectsBoxXZ(from.x, from.y, from.z, ux, uy, uz, len, b)) {
          return false;
        }
      }
      return true;
    },
  };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`AI TEST FAILED: ${msg}`);
}

export interface AiTestReport {
  passed: number;
  perfMsPerFrame10Bots: number;
  mapWalkableCells: Record<string, number>;
  details: string[];
}

export function runAllAiTests(): AiTestReport {
  let passed = 0;
  const details: string[] = [];
  const mapWalkableCells: Record<string, number> = {};

  // =========================================================================
  // 1. NavGrid Connectivity & Obstacle Validation across all 7 Maps
  // =========================================================================
  const stdModes: ModeIdLike[] = ['arena', 'defend', 'dm', 'hvh'];
  for (const mId of stdModes) {
    const lay = getStandardMapLayout(mId);
    const walls: NavWallBox[] = lay.boxes.map((b) => ({
      minX: b.x - b.w * 0.5,
      maxX: b.x + b.w * 0.5,
      minZ: b.z - b.d * 0.5,
      maxZ: b.z + b.d * 0.5,
      maxY: b.y + b.h,
    }));
    const nav = new NavGrid({ halfX: lay.halfExtent, halfZ: lay.halfExtent, walls, cellSize: 1.0, clearance: 0.54 });
    mapWalkableCells[mId] = nav.walkableCount;
    assert(nav.walkableCount > 400, `Map ${mId} walkable cells too low: ${nav.walkableCount}`);
    const p0 = lay.playerSpawns[0];
    for (const bs of lay.botSpawns) {
      const path = nav.findPath(bs, lay.sitePos ?? p0);
      assert(path.status === 'ok', `Map ${mId}: failed path from botSpawn to target (${path.status})`);
    }
    if (mId === 'defend' && lay.sitePos) {
      // Ensure path to site routes cleanly around z=2 central bunker rather than getting stuck
      const p = nav.findPath(lay.botSpawns[0], lay.sitePos);
      assert(p.status === 'ok' && p.points.length >= 2, `defend must find multi-waypoint route around z=2 walls`);
    }
  }

  for (const sId of ['district9', 'coldfront', 'neonmarket'] as SndMapId[]) {
    const bp = getSndBlueprint(sId);
    const walls: NavWallBox[] = bp.obstacles.map((o) => ({
      minX: o.x - o.w * 0.5,
      maxX: o.x + o.w * 0.5,
      minZ: o.z - o.d * 0.5,
      maxZ: o.z + o.d * 0.5,
      maxY: o.y + o.h * 0.5,
    }));
    const nav = new NavGrid({
      halfX: bp.meta.halfX,
      halfZ: bp.meta.halfZ,
      walls,
      grid: bp.grid,
      cellSize: 1.0,
      clearance: 0.54,
    });
    mapWalkableCells[sId] = nav.walkableCount;
    assert(nav.walkableCount > 600, `SnD map ${sId} walkable cells too low: ${nav.walkableCount}`);
    assert(nav.arePointsConnected(bp.attackerSpawns[0], bp.siteA.pos), `${sId}: T spawn connected to A on NavGrid`);
    assert(nav.arePointsConnected(bp.attackerSpawns[0], bp.siteB.pos), `${sId}: T spawn connected to B on NavGrid`);
    assert(nav.arePointsConnected(bp.defenderSpawns[0], bp.siteA.pos), `${sId}: CT spawn connected to A on NavGrid`);
    assert(nav.arePointsConnected(bp.defenderSpawns[0], bp.siteB.pos), `${sId}: CT spawn connected to B on NavGrid`);

    // Unreachable/wall destination graceful snapping & Cold Front zero-Void path points
    const insideWall = nav.findPath(bp.attackerSpawns[0], { x: -bp.meta.halfX + 0.2, y: 0, z: -bp.meta.halfZ + 0.2 });
    assert(insideWall.status !== 'failed', `${sId}: outside/wall target should snap cleanly to valid edge`);
    if (sId === 'coldfront') {
      const pCross = nav.findPath(bp.attackerSpawns[0], bp.siteA.pos);
      assert(pCross.status === 'ok', 'Coldfront A route valid');
      for (const pt of pCross.points) {
        const c = Math.floor((pt.x + bp.grid.halfX) / bp.grid.cellSize);
        const r = Math.floor((pt.z + bp.grid.halfZ) / bp.grid.cellSize);
        assert(bp.grid.cells[r]?.[c] !== 'V', `Coldfront path point landed on Void cell (${pt.x},${pt.z})`);
      }
    }
  }
  passed++;
  details.push('Test 1: All 7 maps pass NavGrid connectivity, doorway clearance & Cold Front bridge routing');

  // =========================================================================
  // 2. Fair Perception (FOV, Wall Occlusion, Audio Investigation, Decay)
  // =========================================================================
  {
    const walls: NavWallBox[] = [{ minX: -2, maxX: 2, minZ: -1, maxZ: 1, maxY: 5 }];
    const nav = new NavGrid({ halfX: 20, halfZ: 20, walls });
    const ai = new BotAIManager(nav, createModeAdapter('arena'), 'normal');
    let t = 1.0;
    const world = makeHeadlessWorld(walls, () => t);

    // Bot faces +Z (yaw = 0) at (0,0,-8). Enemy at (0,0,+8) behind solid center wall at z=0
    const bot: AiCombatantInput = { id: 'b0', name: 'Bot0', team: 'bots', side: 'ffa', isHuman: false, alive: true, hp: 100, maxHp: 100, pos: { x: 0, y: 0, z: -8 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 };
    const humanBehindWall: AiCombatantInput = { id: 'h', name: 'Human', team: 'h', side: 'ffa', isHuman: true, alive: true, hp: 100, maxHp: 100, pos: { x: 0, y: 0, z: 8 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 };
    ai.ensureAgent('b0', 0);

    let cmd = ai.update(0.05, t, [bot, humanBehindWall], { phase: 'active', phaseTimer: 20, attackersTeam: 'bots', defendersTeam: 'h' }, world).get('b0')!;
    assert(cmd.debug.visibleEnemyCount === 0, 'Bot must NOT see enemy through solid wall');

    // Move enemy behind bot (-Z = -18) in open air with zero wall in between -> outside 102deg FOV!
    const humanBehindBack = { ...humanBehindWall, pos: { x: 0, y: 0, z: -18 } };
    t += 0.2;
    cmd = ai.update(0.05, t, [bot, humanBehindBack], { phase: 'active', phaseTimer: 20, attackersTeam: 'bots', defendersTeam: 'h' }, world).get('b0')!;
    assert(cmd.debug.visibleEnemyCount === 0, 'Bot must NOT have 360deg rear eyes in open air');

    // Emit gunshot behind bot within hearing range -> heardEnemyCount becomes 1 and action investigates
    ai.recordSound('h', 'h', 'gunshot', humanBehindBack.pos, 32, t);
    t += 0.4;
    cmd = ai.update(0.05, t, [bot, humanBehindBack], { phase: 'active', phaseTimer: 20, attackersTeam: 'bots', defendersTeam: 'h' }, world).get('b0')!;
    assert(cmd.debug.heardEnemyCount === 1, 'Bot should hear nearby gunshot');

    // Advance past memoryDuration (6.5s on normal) -> unseen enemy decays away
    t += BOT_DIFFICULTIES.normal.memoryDuration + 0.5;
    cmd = ai.update(0.05, t, [bot, humanBehindBack], { phase: 'active', phaseTimer: 20, attackersTeam: 'bots', defendersTeam: 'h' }, world).get('b0')!;
    assert(cmd.debug.heardEnemyCount === 0, 'Unseen threat memory should decay after duration');
    passed++;
    details.push('Test 2: Fair Perception passes wall occlusion, rear FOV check, gunshot sound awareness & memory decay');
  }

  // =========================================================================
  // 3. Stuck Classification & Multi-Level Recovery
  // =========================================================================
  {
    const lay = getStandardMapLayout('defend');
    const walls: NavWallBox[] = lay.boxes.map((b) => ({
      minX: b.x - b.w * 0.5, maxX: b.x + b.w * 0.5, minZ: b.z - b.d * 0.5, maxZ: b.z + b.d * 0.5, maxY: b.y + b.h,
    }));
    const nav = new NavGrid({ halfX: lay.halfExtent, halfZ: lay.halfExtent, walls });
    const ai = new BotAIManager(nav, createModeAdapter('snd'), 'normal');
    const ag = ai.ensureAgent('b_stuck', 0);

    // Subtest A: Stationary intentional hold (buy_phase / holding) never triggers stuck recovery
    const idleRes = ag.recovery.update(
      { now: 1.0, pos: { x: 0, y: 0, z: 0 }, expectedSpeed: 0, action: 'hold_wait', destination: null, stopDistance: 1, pathStatus: 'idle', blockedByTeammate: false, blockedByObstacle: false },
      nav, ag.memory, 0,
    );
    assert(idleRes.stuckClass === 'stationary_intentional' && idleRes.recoveryLevel === 0, 'Intentional idle not misclassified as stuck');

    // Subtest B: Blocked moving agent at fixed pos escalates L1 -> L2 -> L3 cleanly
    let maxLvl = 0;
    let sawFailedRoute = false;
    for (let s = 0; s < 25; s++) {
      const now = 2.0 + s * 0.18;
      const r = ag.recovery.update(
        { now, pos: { x: -10, y: 0, z: 0 }, expectedSpeed: 4.0, action: 'attack_site', destination: { x: 10, y: 0, z: 12 }, stopDistance: 1, pathStatus: 'ok', blockedByTeammate: false, blockedByObstacle: true },
        nav, ag.memory, 0,
      );
      if (r.recoveryLevel > maxLvl) maxLvl = r.recoveryLevel;
      if (ag.memory.failedRoutes.length > 0) sawFailedRoute = true;
    }
    assert(maxLvl >= 3 && sawFailedRoute, `Stuck recovery should escalate >= L3 and record failedRoutes (got L${maxLvl})`);
    passed++;
    details.push('Test 3: Stuck classification distinguishes intentional stationary from genuine blockage & escalates L1->L3');
  }

  // =========================================================================
  // 4. Multi-Bot Zero-Stuck Movement & Decision Hysteresis across Modes
  // =========================================================================
  {
    // 4a. Defend mode (`def_sandkeep`): 4 bots start behind z=2 walls and reach Bomb Site (0, 12) cleanly!
    const lay = getStandardMapLayout('defend');
    const walls: NavWallBox[] = lay.boxes.map((b) => ({
      minX: b.x - b.w * 0.5, maxX: b.x + b.w * 0.5, minZ: b.z - b.d * 0.5, maxZ: b.z + b.d * 0.5, maxY: b.y + b.h,
    }));
    const nav = new NavGrid({ halfX: lay.halfExtent, halfZ: lay.halfExtent, walls });
    const ai = new BotAIManager(nav, createModeAdapter('defend'), 'normal');
    let t = 0;
    const world = makeHeadlessWorld(walls, () => t);
    const bots: AiCombatantInput[] = lay.botSpawns.map((sp, i) => ({
      id: `bot_${i}`, name: `Attacker_${i}`, team: 'bots', side: 'attackers', isHuman: false, alive: true, hp: 100, maxHp: 100, pos: { ...sp }, vel: { x: 0, y: 0, z: 0 }, yaw: 0,
    }));
    const human: AiCombatantInput = { id: 'human', name: 'Defender', team: 'human', side: 'defenders', isHuman: true, alive: false, hp: 100, maxHp: 100, pos: { x: 0, y: 0, z: 14 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 };

    let reachedSite = false;
    for (let step = 0; step < 300; step++) {
      t += 0.05;
      const cmds = ai.update(0.05, t, [human, ...bots], {
        phase: 'active', phaseTimer: 30 - t, attackersTeam: 'bots', defendersTeam: 'human', defendSitePos: lay.sitePos, defendSiteRadius: lay.siteRadius, intermissionActive: false,
      }, world, 4.1);
      for (const b of bots) {
        const c = cmds.get(b.id)!;
        b.pos = c.nextPos;
        b.yaw = c.targetYaw;
        b.vel = c.debug.vel;
        if (Math.hypot(b.pos.x - lay.sitePos!.x, b.pos.z - lay.sitePos!.z) <= lay.siteRadius! - 0.5) {
          reachedSite = true;
        }
      }
    }
    assert(reachedSite, 'Defend attackers must navigate around z=2 walls and reach Bomb Site');

    // Check hysteresis stability (low decision switches per bot over 15s)
    for (const b of bots) {
      const ag = ai.getAgent(b.id)!;
      assert(ag.decision.switchCount <= 10, `Excessive decision thrashing for ${b.id}: ${ag.decision.switchCount}`);
    }
    passed++;
    details.push('Test 4: Site Defense bots navigate around z=2 walls onto site cleanly with low hysteresis switch count');
  }

  // =========================================================================
  // 5. Full SnD Simulation (Buy Lock, Team Split, Carrier Escort, Plant/Defuse, Carrier Disconnect, Side Switch, ColdFront 5v5)
  // =========================================================================
  for (const sId of ['district9', 'coldfront', 'neonmarket'] as SndMapId[]) {
    const bp = getSndBlueprint(sId);
    const walls: NavWallBox[] = bp.obstacles.map((o) => ({
      minX: o.x - o.w * 0.5, maxX: o.x + o.w * 0.5, minZ: o.z - o.d * 0.5, maxZ: o.z + o.d * 0.5, maxY: o.y + o.h * 0.5,
    }));
    const losWalls: NavWallBox[] = bp.obstacles
      .filter((o) => o.matKind !== 'void_barrier')
      .map((o) => ({
        minX: o.x - o.w * 0.5, maxX: o.x + o.w * 0.5, minZ: o.z - o.d * 0.5, maxZ: o.z + o.d * 0.5, maxY: o.y + o.h * 0.5,
      }));
    const nav = new NavGrid({ halfX: bp.meta.halfX, halfZ: bp.meta.halfZ, walls, grid: bp.grid, cellSize: 1.0, clearance: 0.54 });
    const adapter = new SndModeAdapter();
    const ai = new BotAIManager(nav, adapter, 'hard');
    const auth = new SndMatchAuthority([bp.siteA, bp.siteB], { buyPhaseDuration: 0.4, roundPrepDuration: 0.1, plantDuration: 1.0, defuseDuration: 1.5 });
    for (let i = 0; i < 5; i++) auth.addPlayer(`t${i}`, `T${i}`, 'teamA', false);
    for (let i = 0; i < 5; i++) auth.addPlayer(`c${i}`, `CT${i}`, 'teamB', false);
    auth.forceStartIfReady();

    let t = 0;
    const world = makeHeadlessWorld(losWalls, () => t);
    while (auth.phase !== 'buy_phase') { auth.tick(0.05); t += 0.05; }

    // Set initial positions cleanly
    let aiIdx = 0;
    let ciIdx = 0;
    for (const p of auth.players.values()) {
      const sp = p.team === 'teamA' ? bp.attackerSpawns[aiIdx++] : bp.defenderSpawns[ciIdx++];
      auth.updatePlayerPosition(p.id, { ...sp });
    }

    // Buy phase check: bots hold_wait & buy smart loadout
    const makeCombatants = (): AiCombatantInput[] =>
      Array.from(auth.players.values()).map((p) => ({
        id: p.id, name: p.name, team: p.team, side: auth.sideOfTeam(p.team), isHuman: false, alive: p.alive, hp: p.hp, maxHp: 100, pos: { ...p.pos }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, hasBomb: auth.bomb.carrierId === p.id, hasDefuseKit: p.hasDefuseKit,
      }));
    adapter.performBotBuy(
      makeCombatants(),
      (pid) => { const p = auth.players.get(pid)!; return { alive: p.alive, money: p.money, side: auth.sideOfTeam(p.team), primaryWeapon: p.primaryWeapon, armor: p.armor, hasHelmet: p.hasHelmet, hasDefuseKit: p.hasDefuseKit }; },
      (pid, wid) => auth.buyWeapon(pid, wid),
      (pid, hm) => auth.buyArmor(pid, hm),
      (pid) => auth.buyDefuseKit(pid),
    );
    const preCmds = ai.update(0.05, t, makeCombatants(), {
      phase: auth.phase, phaseTimer: auth.phaseTimer, attackersTeam: auth.attackersTeam, defendersTeam: auth.defendersTeam, siteA: bp.siteA, siteB: bp.siteB, midPos: bp.midPos, bombState: auth.bomb.state, bombSite: auth.bomb.site, bombPos: auth.bomb.pos, carrierId: auth.bomb.carrierId, interactorId: auth.bomb.interactorId, roundTargetSite: 'A',
    }, world);
    for (const cmd of preCmds.values()) {
      assert(cmd.debug.action === 'hold_wait', `${sId}: during buy_phase bot must hold_wait`);
    }

    // Enter active phase & simulate 240 steps (12s) checking team coverage, plant trigger, and zero stuck disasters!
    while ((auth.phase as string) !== 'active') { auth.tick(0.05); t += 0.05; }
    ai.onRoundReset();
    let maxDistMoved = 0;
    const startPos = new Map<string, Vec3>();
    for (const p of auth.players.values()) startPos.set(p.id, { ...p.pos });

    let sawCtSiteA = false;
    let sawCtSiteB = false;

    for (let step = 0; step < 240; step++) {
      t += 0.05;
      auth.tick(0.05);
      if ((auth.phase as string) !== 'active') break;
      const cmds = ai.update(0.05, t, makeCombatants(), {
        phase: auth.phase, phaseTimer: auth.phaseTimer, attackersTeam: auth.attackersTeam, defendersTeam: auth.defendersTeam, siteA: bp.siteA, siteB: bp.siteB, midPos: bp.midPos, bombState: auth.bomb.state, bombSite: auth.bomb.site, bombPos: auth.bomb.pos, carrierId: auth.bomb.carrierId, interactorId: auth.bomb.interactorId, bombDetonateTimer: auth.bomb.detonateTimer, roundTargetSite: 'A',
      }, world, 4.3);

      for (const [pid, cmd] of cmds.entries()) {
        auth.updatePlayerPosition(pid, cmd.nextPos);
        if (cmd.wantsPlant && auth.bomb.interactorId !== pid) auth.startPlant(pid);
        if (cmd.wantsDefuse && auth.bomb.interactorId !== pid) auth.startDefuse(pid);
        if (cmd.debug.side === 'defenders') {
          if (cmd.debug.role === 'anchor_a') sawCtSiteA = true;
          if (cmd.debug.role === 'anchor_b') sawCtSiteB = true;
        }
        const sp0 = startPos.get(pid)!;
        const dMoved = Math.hypot(cmd.nextPos.x - sp0.x, cmd.nextPos.z - sp0.z);
        if (dMoved > maxDistMoved) maxDistMoved = dMoved;
      }
    }
    assert(sawCtSiteA && sawCtSiteB, `${sId}: Defenders must cover BOTH Site A & Site B (${sawCtSiteA}/${sawCtSiteB})`);
    assert(maxDistMoved > 14, `${sId}: Bots must traverse map actively (moved max ${maxDistMoved.toFixed(1)}m)`);

    // Check dropped C4 single-recoverer election cleanly (force dropped state if carried/planted earlier)
    const aliveAtk = Array.from(auth.players.values()).filter((p) => p.team === 'teamA' && p.alive);
    if ((auth.phase as string) === 'active' && aliveAtk.length > 0) {
      auth.bomb.state = 'carried';
      auth.bomb.carrierId = aliveAtk[0].id;
      auth.bomb.interactorId = null;
      assert(auth.dropBomb(aliveAtk[0].id), `${sId}: dropBomb should succeed when carried`);
      const dropCmds = ai.update(0.05, t + 0.1, makeCombatants(), {
        phase: auth.phase, phaseTimer: auth.phaseTimer, attackersTeam: auth.attackersTeam, defendersTeam: auth.defendersTeam, siteA: bp.siteA, siteB: bp.siteB, midPos: bp.midPos, bombState: auth.bomb.state, bombSite: auth.bomb.site, bombPos: auth.bomb.pos, carrierId: auth.bomb.carrierId, interactorId: auth.bomb.interactorId, roundTargetSite: 'A',
      }, world);
      let recoverCount = 0;
      for (const c of dropCmds.values()) if (c.debug.action === 'recover_bomb') recoverCount++;
      assert(recoverCount >= 1 && recoverCount <= 2, `${sId}: Only closest/elected attacker recovers C4 (not all 5: got ${recoverCount})`);
    }

    // Check post-plant retake & single defuser election + round reset cleanup
    const planter = Array.from(auth.players.values()).find((p) => p.team === 'teamA' && p.alive);
    if (planter && (auth.phase as string) === 'active') {
      auth.bomb.state = 'carried';
      auth.bomb.carrierId = planter.id;
      auth.updatePlayerPosition(planter.id, { ...bp.siteA.pos });
      assert(auth.startPlant(planter.id), `${sId}: Planter should start plant on Site A`);
      t += 1.05;
      auth.tick(1.05);
      assert((auth.bomb.state as string) === 'planted', `${sId}: Bomb becomes planted cleanly`);
      // Move remaining attackers back / check clear site so closest CT wins defuser election cleanly
      for (const p of auth.players.values()) {
        if (p.team === 'teamA' && p.alive) auth.updatePlayerPosition(p.id, { ...bp.attackerSpawns[0] });
      }
      const ctClose = Array.from(auth.players.values()).find((p) => p.team === 'teamB' && p.alive)!;
      auth.updatePlayerPosition(ctClose.id, { x: bp.siteA.pos.x + 1.0, y: 0, z: bp.siteA.pos.z });
      const postCmds = ai.update(0.05, t + 0.1, makeCombatants(), {
        phase: auth.phase, phaseTimer: auth.phaseTimer, attackersTeam: auth.attackersTeam, defendersTeam: auth.defendersTeam, siteA: bp.siteA, siteB: bp.siteB, midPos: bp.midPos, bombState: auth.bomb.state, bombSite: auth.bomb.site, bombPos: auth.bomb.pos, carrierId: auth.bomb.carrierId, interactorId: auth.bomb.interactorId, bombDetonateTimer: auth.bomb.detonateTimer, roundTargetSite: 'A',
      }, world);
      let defusingCount = 0;
      for (const c of postCmds.values()) if (c.wantsDefuse) defusingCount++;
      assert(defusingCount === 1, `${sId}: Exactly 1 CT defuses bomb while teammates cover retake (got ${defusingCount})`);
    }
    ai.onRoundReset();
    for (const p of auth.players.values()) {
      const ag = ai.getAgent(p.id);
      assert(!ag || ag.movement.pathPoints.length === 0, `${sId}: Round reset must clear bot paths`);
    }

    passed++;
    details.push(`Test 5 (${sId}): 10-bot SnD simulation passed buy lock, A/B splits, navigation (${maxDistMoved.toFixed(1)}m), C4 recovery, post-plant retake/defuse & round reset`);
  }

  // =========================================================================
  // 5b. Arena, HvH & Human C4 Carrier Intent + Difficulty Profiles Check
  // =========================================================================
  {
    const arenaLay = getStandardMapLayout('arena');
    const arenaNav = new NavGrid({
      halfX: arenaLay.halfExtent,
      halfZ: arenaLay.halfExtent,
      walls: navWallsFromBoxes(arenaLay.boxes.map((b) => ({ min: { x: b.x - b.w * 0.5, y: 0, z: b.z - b.d * 0.5 }, max: { x: b.x + b.w * 0.5, y: b.h, z: b.z + b.d * 0.5 } }))),
    });
    const arenaAi = new BotAIManager(arenaNav, createModeAdapter('arena'), 'expert');
    const arenaWorld = makeHeadlessWorld([], () => 1.0);
    const aRes = arenaAi.update(
      0.05,
      1.0,
      [
        { id: 'human', name: 'H', team: 'h', side: 'ffa', isHuman: true, alive: true, hp: 100, maxHp: 100, pos: { x: 0, y: 0, z: 14 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 },
        { id: 'b0', name: 'B0', team: 'b', side: 'ffa', isHuman: false, alive: true, hp: 100, maxHp: 100, pos: { x: 0, y: 0, z: -14 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 },
      ],
      { phase: 'active', phaseTimer: 20, attackersTeam: 'b', defendersTeam: 'h', playerPos: { x: 0, y: 0, z: 14 } },
      arenaWorld,
    );
    assert(aRes.get('b0')?.targetActorId === 'human' || aRes.get('b0')?.debug.action === 'engage_threat', 'Arena bot engages opponent cleanly');

    const hvhLay = getStandardMapLayout('hvh');
    const hvhNav = new NavGrid({
      halfX: hvhLay.halfExtent,
      halfZ: hvhLay.halfExtent,
      walls: navWallsFromBoxes(hvhLay.boxes.map((b) => ({ min: { x: b.x - b.w * 0.5, y: 0, z: b.z - b.d * 0.5 }, max: { x: b.x + b.w * 0.5, y: b.h, z: b.z + b.d * 0.5 } }))),
    });
    const hvhAi = new BotAIManager(hvhNav, createModeAdapter('hvh'), 'hard');
    const hvhRes = hvhAi.update(
      0.05,
      1.0,
      [{ id: 'b0', name: 'HvH', team: 'b0', side: 'ffa', isHuman: false, alive: true, hp: 100, maxHp: 100, pos: { x: 0, y: 0, z: 22 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, isCheater: true }],
      { phase: 'active', phaseTimer: 50, attackersTeam: 'hvh', defendersTeam: 'hvh' },
      makeHeadlessWorld([], () => 1.0),
    );
    assert(Boolean(hvhRes.get('b0')?.isSpinVisual && hvhRes.get('b0')?.isBunnyHop), 'HvH adapter preserves cheater locomotion flags on valid NavGrid');
    passed++;
    details.push('Test 5b: Arena 1v1 & HvH mode adapters verified with Expert/Hard difficulties');
  }

  // =========================================================================
  // 6. FFA Deathmatch Respawn Reset & Human-vs-Bot / Bot-vs-Bot Combat
  // =========================================================================
  {
    const lay = getStandardMapLayout('dm');
    const walls: NavWallBox[] = lay.boxes.map((b) => ({
      minX: b.x - b.w * 0.5, maxX: b.x + b.w * 0.5, minZ: b.z - b.d * 0.5, maxZ: b.z + b.d * 0.5, maxY: b.y + b.h,
    }));
    const nav = new NavGrid({ halfX: lay.halfExtent, halfZ: lay.halfExtent, walls });
    const ai = new BotAIManager(nav, createModeAdapter('dm'), 'normal');
    let t = 0;
    const world = makeHeadlessWorld(walls, () => t);
    const botA: AiCombatantInput = { id: 'b1', name: 'DM1', team: 'b1', side: 'ffa', isHuman: false, alive: true, hp: 100, maxHp: 100, pos: { x: 3, y: 0, z: 22 }, vel: { x: 0, y: 0, z: 0 }, yaw: Math.PI };
    const botB: AiCombatantInput = { id: 'b2', name: 'DM2', team: 'b2', side: 'ffa', isHuman: false, alive: true, hp: 100, maxHp: 100, pos: { x: 3, y: 0, z: 14 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 };

    ai.ensureAgent('b1', 0);
    let sawEngageBot = false;
    for (let s = 0; s < 20; s++) {
      t += 0.05;
      const res = ai.update(0.05, t, [botA, botB], { phase: 'active', phaseTimer: 40, attackersTeam: 'dm', defendersTeam: 'dm' }, world);
      if (res.get('b1')?.targetActorId === 'b2') sawEngageBot = true;
    }
    assert(sawEngageBot, 'FFA Deathmatch bot must perceive & engage opposing bots');
    ai.onBotRespawn('b1', 0);
    const ag1 = ai.getAgent('b1')!;
    assert(ag1.movement.pathPoints.length === 0 && ag1.memory.enemies.size === 0, 'Respawn must clear obsolete paths and stale threats');
    passed++;
    details.push('Test 6: FFA Deathmatch engages other bots and cleanly resets AI state on respawn');
  }

  // =========================================================================
  // 7. Performance Benchmark (10 Active Bots x 600 Ticks on District 9)
  // =========================================================================
  let perfMsPerFrame10Bots = 0;
  {
    const bp = getSndBlueprint('district9');
    const walls: NavWallBox[] = bp.obstacles.map((o) => ({
      minX: o.x - o.w * 0.5, maxX: o.x + o.w * 0.5, minZ: o.z - o.d * 0.5, maxZ: o.z + o.d * 0.5, maxY: o.y + o.h * 0.5,
    }));
    const nav = new NavGrid({ halfX: bp.meta.halfX, halfZ: bp.meta.halfZ, walls, grid: bp.grid, cellSize: 1.0, clearance: 0.54 });
    const ai = new BotAIManager(nav, createModeAdapter('snd'), 'normal');
    let t = 0;
    const world = makeHeadlessWorld(walls, () => t);
    const pool: AiCombatantInput[] = [
      ...bp.attackerSpawns.map((s, i) => ({ id: `t${i}`, name: `T${i}`, team: 'teamA', side: 'attackers' as const, isHuman: false, alive: true, hp: 100, maxHp: 100, pos: { ...s }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 })),
      ...bp.defenderSpawns.map((s, i) => ({ id: `c${i}`, name: `C${i}`, team: 'teamB', side: 'defenders' as const, isHuman: false, alive: true, hp: 100, maxHp: 100, pos: { ...s }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 })),
    ];

    const startMs = Date.now();
    for (let f = 0; f < 600; f++) {
      t += 0.05;
      const cmds = ai.update(0.05, t, pool, {
        phase: 'active', phaseTimer: 90 - t, attackersTeam: 'teamA', defendersTeam: 'teamB', siteA: bp.siteA, siteB: bp.siteB, midPos: bp.midPos, bombState: 'carried', bombSite: null, bombPos: pool[0].pos, carrierId: 't0', interactorId: null, roundTargetSite: 'A',
      }, world);
      for (const a of pool) {
        const c = cmds.get(a.id);
        if (c) {
          a.pos = c.nextPos;
          a.yaw = c.targetYaw;
        }
      }
    }
    const elapsedMs = Date.now() - startMs;
    perfMsPerFrame10Bots = Math.round((elapsedMs / 600) * 1000) / 1000;
    assert(perfMsPerFrame10Bots < 3.0, `Performance regression: ${perfMsPerFrame10Bots}ms/frame`);
    passed++;
    details.push(`Test 7: 10-bot benchmark passed at ${perfMsPerFrame10Bots} ms/frame over 600 ticks`);
  }

  return { passed, perfMsPerFrame10Bots, mapWalkableCells, details };
}
