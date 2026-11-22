import { TeamCoordinator, SndCoordinatorInput } from './coordinator';
import { BotMemory } from './memory';
import { NavGrid } from './navigation';
import { ObjectiveManager } from './objectives';
import {
  AiCombatantInput,
  BotProfileId,
  ObjectiveInfo,
  PerceivedThreat,
  ScoredAction,
  Vec3,
} from './types';

export interface ModeContext {
  now: number;
  allActors: AiCombatantInput[];
  nav: NavGrid;
  objectives: ObjectiveManager;
  coordinator: TeamCoordinator;
  anchors: Vec3[];
}

export interface AgentEvaluationInput {
  self: AiCombatantInput;
  profile: BotProfileId;
  memory: BotMemory;
  visibleEnemies: PerceivedThreat[];
  visibleTeammates: AiCombatantInput[];
  bestThreat: PerceivedThreat | null;
}

export interface ModeRoundPhaseState {
  phase: string;
  phaseTimer: number;
  attackersTeam: string;
  defendersTeam: string;
  siteA?: { pos: Vec3; radius: number };
  siteB?: { pos: Vec3; radius: number };
  midPos?: Vec3;
  bombState?: string;
  bombSite?: 'A' | 'B' | null;
  bombPos?: Vec3;
  carrierId?: string | null;
  interactorId?: string | null;
  bombDetonateTimer?: number;
  roundTargetSite?: 'A' | 'B';
  defendSitePos?: Vec3;
  defendSiteRadius?: number;
  intermissionActive?: boolean;
  playerPos?: Vec3;
}

export interface IGameModeAIAdapter {
  readonly modeId: string;
  readonly isFfa: boolean;
  prepareFrame(ctx: ModeContext, state: ModeRoundPhaseState): void;
  evaluateActions(ctx: ModeContext, state: ModeRoundPhaseState, agent: AgentEvaluationInput): ScoredAction[];
}

function pickPatrolAnchor(
  selfPos: Vec3,
  anchors: Vec3[],
  memory: BotMemory,
  now: number,
  seed: number,
): Vec3 {
  if (anchors.length === 0) return { x: 0, y: 0, z: 0 };
  let best = anchors[seed % anchors.length];
  let bestScore = -1e9;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const key = `pat_${Math.round(a.x)}_${Math.round(a.z)}`;
    if (memory.isBlacklisted(key, now)) continue;
    const dist = Math.hypot(a.x - selfPos.x, a.z - selfPos.z);
    if (dist < 4.5) continue;
    const visitedPen = memory.getRecentlyVisitedCount(a, now, 10) * 14;
    const idealDistScore = 25 - Math.abs(dist - 18) * 0.7;
    const score = idealDistScore - visitedPen + ((i + seed) % 5) * 1.1;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

// ============================================================================
// 1. SEARCH & DESTROY ADAPTER (5v5 Tactical Bomb Defusal)
// ============================================================================
export class SndModeAdapter implements IGameModeAIAdapter {
  public readonly modeId = 'snd';
  public readonly isFfa = false;

  public prepareFrame(ctx: ModeContext, st: ModeRoundPhaseState): void {
    const siteA = st.siteA ?? { pos: { x: -16, y: 0, z: -12 }, radius: 5 };
    const siteB = st.siteB ?? { pos: { x: 16, y: 0, z: 12 }, radius: 5 };
    const midPos = st.midPos ?? { x: 0, y: 0, z: 0 };
    const bombPos = st.bombPos ?? { x: 0, y: 0, z: 0 };
    const bState = st.bombState ?? 'carried';

    const objs: ObjectiveInfo[] = [
      {
        id: 'site_A',
        kind: 'site_a',
        pos: siteA.pos,
        radius: siteA.radius,
        active: bState !== 'planted' && bState !== 'defusing',
        contested: st.bombSite === 'A' && (bState === 'planting' || bState === 'planted'),
        requiresInteraction: bState === 'carried',
        progress: 0,
        site: 'A',
      },
      {
        id: 'site_B',
        kind: 'site_b',
        pos: siteB.pos,
        radius: siteB.radius,
        active: bState !== 'planted' && bState !== 'defusing',
        contested: st.bombSite === 'B' && (bState === 'planting' || bState === 'planted'),
        requiresInteraction: bState === 'carried',
        progress: 0,
        site: 'B',
      },
    ];
    if (bState === 'dropped') {
      objs.push({
        id: 'c4_dropped',
        kind: 'bomb_dropped',
        pos: bombPos,
        radius: 2.0,
        active: true,
        contested: true,
        requiresInteraction: true,
        progress: 0,
      });
    }
    if (bState === 'planted' || bState === 'defusing') {
      objs.push({
        id: 'c4_planted',
        kind: 'bomb_planted',
        pos: bombPos,
        radius: 3.0,
        active: true,
        contested: true,
        requiresInteraction: true,
        progress: 0,
        site: st.bombSite ?? undefined,
      });
    }
    ctx.objectives.update(objs);

    const coordIn: SndCoordinatorInput = {
      phase: st.phase,
      attackersTeam: st.attackersTeam,
      defendersTeam: st.defendersTeam,
      siteA,
      siteB,
      midPos,
      bombState: bState,
      bombSite: st.bombSite ?? null,
      bombPos,
      carrierId: st.carrierId ?? null,
      interactorId: st.interactorId ?? null,
      roundTargetSite: st.roundTargetSite ?? 'A',
    };
    ctx.coordinator.updateSndPlans(ctx.now, ctx.allActors, coordIn, ctx.nav);
  }

  public evaluateActions(ctx: ModeContext, st: ModeRoundPhaseState, agent: AgentEvaluationInput): ScoredAction[] {
    const { self, visibleEnemies, bestThreat, memory } = agent;
    // Freeze immediately whenever round isn't live active!
    if (st.phase !== 'active') {
      return [
        {
          action: 'hold_wait',
          utility: 10.0,
          destination: null,
          lookTarget: null,
          stopDistance: 0,
          urgent: true,
          reason: `Phase=${st.phase} (movement/combat paused)`,
        },
      ];
    }

    const siteA = st.siteA ?? { pos: { x: -16, y: 0, z: -12 }, radius: 5 };
    const siteB = st.siteB ?? { pos: { x: 16, y: 0, z: 12 }, radius: 5 };
    const midPos = st.midPos ?? { x: 0, y: 0, z: 0 };
    const bombPos = st.bombPos ?? { x: 0, y: 0, z: 0 };
    const bState = st.bombState ?? 'carried';
    const plan = ctx.coordinator.getPlan(self.team);
    const role = plan?.roleByActor.get(self.id) ?? 'roamer';
    memory.assignedRole = role;

    const actions: ScoredAction[] = [];
    const primaryVis = visibleEnemies[0] ?? null;
    const isInteracting = st.interactorId === self.id;
    const myDistToBomb = Math.hypot(self.pos.x - bombPos.x, self.pos.z - bombPos.z);

    // If actively planting or defusing right now, evaluate whether to stick vs fight!
    if (isInteracting) {
      const mustStick =
        bState === 'defusing' && (st.bombDetonateTimer ?? 35) <= 6.2 ||
        (bState === 'planting' && st.phaseTimer <= 6.5);
      if (!primaryVis || primaryVis.distance > 11 || mustStick) {
        actions.push({
          action: bState === 'planting' ? 'plant_bomb' : 'defuse_bomb',
          utility: 2.8,
          destination: self.pos,
          lookTarget: primaryVis ? primaryVis.pos : null,
          stopDistance: 99,
          urgent: true,
          reason: bState === 'planting' ? 'Planting C4 on site' : 'Sticking C4 defuse',
        });
        return actions;
      }
    }

    if (self.side === 'attackers') {
      const execSite = plan?.executeSite === 'B' ? siteB : siteA;
      const distToSite = Math.hypot(self.pos.x - execSite.pos.x, self.pos.z - execSite.pos.z);

      // 1. Carrier: reach site and plant C4
      if (st.carrierId === self.id && bState === 'carried') {
        const onAnySite =
          Math.hypot(self.pos.x - siteA.pos.x, self.pos.z - siteA.pos.z) <= siteA.radius - 0.6 ||
          Math.hypot(self.pos.x - siteB.pos.x, self.pos.z - siteB.pos.z) <= siteB.radius - 0.6;
        if (onAnySite && (!primaryVis || primaryVis.distance > 11 || st.phaseTimer < 14)) {
          actions.push({
            action: 'plant_bomb',
            utility: 2.35,
            destination: self.pos,
            lookTarget: primaryVis ? primaryVis.pos : null,
            stopDistance: 99,
            urgent: true,
            reason: 'C4 carrier on clear site -> plant',
          });
        } else {
          actions.push({
            action: 'attack_site',
            utility: st.phaseTimer < 25 ? 1.75 : 1.18,
            destination: execSite.pos,
            lookTarget: primaryVis ? primaryVis.pos : null,
            stopDistance: 1.8,
            reason: `Carrier moving to Site ${plan?.executeSite ?? 'A'} (${Math.round(distToSite)}m)`,
          });
        }
      }

      // 2. Dropped Bomb Recovery (strictly 1 elected recoverer; teammates hold/push lanes)
      if (bState === 'dropped') {
        const isRecoverer = plan?.recovererId === self.id;
        if (isRecoverer) {
          actions.push({
            action: 'recover_bomb',
            utility: 1.98,
            destination: bombPos,
            lookTarget: primaryVis ? primaryVis.pos : null,
            stopDistance: 0.9,
            urgent: true,
            reason: 'Assigned to recover dropped C4',
          });
        }
      }

      // 3. Pre-plant attacker teamwork
      if (bState === 'carried' || bState === 'dropped') {
        const anchor = plan?.anchorByActor.get(self.id) ?? execSite.pos;
        const carrier = st.carrierId ? ctx.allActors.find((a) => a.id === st.carrierId && a.alive) : null;
        if (role === 'escort' && carrier && st.carrierId !== self.id) {
          const dCarrier = Math.hypot(carrier.pos.x - self.pos.x, carrier.pos.z - self.pos.z);
          if (dCarrier > 6.5) {
            actions.push({
              action: 'escort_carrier',
              utility: 1.08,
              destination: carrier.pos,
              lookTarget: primaryVis ? primaryVis.pos : null,
              stopDistance: 3.4,
              reason: `Escorting C4 carrier (${carrier.name})`,
            });
          }
        }
        actions.push({
          action: 'attack_site',
          utility: role === 'lurk' ? 0.92 : 1.05,
          destination: anchor,
          lookTarget: primaryVis ? primaryVis.pos : null,
          stopDistance: 2.0,
          reason: `${role} pushing toward ${role === 'lurk' ? 'Mid' : `Site ${plan?.executeSite ?? 'A'}`}`,
        });
      }

      // 4. Post-plant defense around C4!
      if (bState === 'planted' || bState === 'defusing') {
        const postAnchor = plan?.anchorByActor.get(self.id) ?? bombPos;
        const someoneDefusing = bState === 'defusing';
        actions.push({
          action: 'defend_planted',
          utility: someoneDefusing ? 1.5 : 1.25,
          destination: someoneDefusing ? bombPos : postAnchor,
          lookTarget: someoneDefusing ? bombPos : primaryVis ? primaryVis.pos : bombPos,
          stopDistance: someoneDefusing ? 4.2 : 1.5,
          urgent: someoneDefusing,
          reason: someoneDefusing ? 'Stop C4 defuser!' : 'Post-plant C4 guard',
        });
      }
    } else {
      // DEFENDERS (CT)
      const myAnchor = plan?.anchorByActor.get(self.id) ?? (role === 'anchor_b' ? siteB.pos : role === 'rotator_mid' ? midPos : siteA.pos);

      if (bState === 'planted' || bState === 'defusing') {
        // Urgent Retake + Single Defuser!
        const amDefuser = plan?.defuserId === self.id;
        if (amDefuser && myDistToBomb <= 2.9 && (!primaryVis || (st.bombDetonateTimer ?? 35) <= 6.5)) {
          actions.push({
            action: 'defuse_bomb',
            utility: 2.6,
            destination: bombPos,
            lookTarget: bombPos,
            stopDistance: 99,
            urgent: true,
            reason: 'Defusing planted C4!',
          });
        } else if (amDefuser) {
          actions.push({
            action: 'retake_site',
            utility: 1.85,
            destination: bombPos,
            lookTarget: primaryVis ? primaryVis.pos : bombPos,
            stopDistance: 1.6,
            urgent: true,
            reason: 'Designated defuser rotating to C4',
          });
        } else {
          actions.push({
            action: 'retake_site',
            utility: 1.38,
            destination: plan?.anchorByActor.get(self.id) ?? bombPos,
            lookTarget: primaryVis ? primaryVis.pos : bombPos,
            stopDistance: 3.0,
            urgent: true,
            reason: `Covering Site ${st.bombSite ?? ''} retake`,
          });
        }
      } else {
        // Pre-plant: hold assigned site anchor OR rotate if sound/enemy confirms push on other site
        const anchorDist = Math.hypot(myAnchor.x - self.pos.x, myAnchor.z - self.pos.z);
        actions.push({
          action: 'defend_site',
          utility: anchorDist > 3.0 ? 1.12 : 1.02,
          destination: anchorDist > 2.2 ? myAnchor : null,
          lookTarget: primaryVis
            ? primaryVis.pos
            : bestThreat
              ? bestThreat.pos
              : midPos,
          stopDistance: 1.8,
          reason: `Holding ${role} position`,
        });

        // If rotator_mid hears gunfire or threat near A or B, rotate!
        if (role === 'rotator_mid' && bestThreat && !primaryVis) {
          const dA = Math.hypot(bestThreat.pos.x - siteA.pos.x, bestThreat.pos.z - siteA.pos.z);
          const dB = Math.hypot(bestThreat.pos.x - siteB.pos.x, bestThreat.pos.z - siteB.pos.z);
          if (Math.min(dA, dB) < 18) {
            actions.push({
              action: 'rotate_site',
              utility: 1.18,
              destination: dA < dB ? siteA.pos : siteB.pos,
              lookTarget: bestThreat.pos,
              stopDistance: 3.5,
              reason: `Mid rotating toward ${dA < dB ? 'Site A' : 'Site B'} contact`,
            });
          }
        }
      }
    }

    // Combat Engagement & Sound Investigation
    if (primaryVis) {
      const engageUtil =
        primaryVis.distance < 12
          ? 1.75
          : primaryVis.distance < 22
            ? 1.32
            : 1.05;
      actions.push({
        action: 'engage_threat',
        utility: engageUtil,
        destination:
          primaryVis.distance > 18
            ? primaryVis.pos
            : primaryVis.distance < 5.5
              ? null
              : self.pos,
        lookTarget: primaryVis.pos,
        stopDistance: primaryVis.distance < 16 ? 99 : 11,
        urgent: primaryVis.distance < 10,
        reason: `Engaging ${primaryVis.actorId} at ${Math.round(primaryVis.distance)}m`,
      });
    } else if (bestThreat && bestThreat.confidence > 0.35 && bState !== 'planted') {
      actions.push({
        action: 'investigate_sound',
        utility: role === 'anchor_a' || role === 'anchor_b' ? 0.82 : 1.04,
        destination: bestThreat.pos,
        lookTarget: bestThreat.pos,
        stopDistance: 3.0,
        reason: bestThreat.fromSound ? 'Investigating gunfire sound' : 'Checking last known enemy pos',
      });
    }

    if (self.hp < 32 && primaryVis && ctx.now - memory.lastDamagedAt < 1.2) {
      const awayX = self.pos.x - (primaryVis.pos.x - self.pos.x);
      const awayZ = self.pos.z - (primaryVis.pos.z - self.pos.z);
      const safe = ctx.nav.findNearestWalkable(awayX, awayZ, 6);
      if (safe) {
        actions.push({
          action: 'retreat_cover',
          utility: 1.35,
          destination: safe,
          lookTarget: primaryVis.pos,
          stopDistance: 1.2,
          reason: 'Low HP tactical fallback',
        });
      }
    }

    return actions;
  }

  public performBotBuy(
    actors: AiCombatantInput[],
    canBuyFn: (playerId: string) => {
      alive: boolean;
      money: number;
      side: 'attackers' | 'defenders';
      primaryWeapon: string | null;
      armor: number;
      hasHelmet: boolean;
      hasDefuseKit: boolean;
    } | null,
    buyWeapon: (pid: string, wid: string) => boolean,
    buyArmor: (pid: string, helmet: boolean) => boolean,
    buyKit: (pid: string) => boolean,
  ): void {
    let kitsBought = 0;
    for (const a of actors) {
      const p = canBuyFn(a.id);
      if (!p || !p.alive) continue;
      if (p.hasDefuseKit) kitsBought++;
    }

    for (const a of actors) {
      const p = canBuyFn(a.id);
      if (!p || !p.alive) continue;

      if (!p.primaryWeapon) {
        if (p.money >= 4850 && a.id.endsWith('3')) {
          buyWeapon(a.id, 'sniper');
        } else if (p.money >= 3250) {
          buyWeapon(a.id, p.side === 'defenders' ? 'm4' : 'rifle');
        } else if (p.money >= 2700) {
          buyWeapon(a.id, 'rifle');
        } else if (p.money >= 1850) {
          buyWeapon(a.id, 'ssg');
        } else if (p.money >= 1500) {
          buyWeapon(a.id, 'shotgun');
        } else if (p.money >= 1250) {
          buyWeapon(a.id, 'smg');
        }
      }

      if (p.armor < 80) {
        if (!buyArmor(a.id, true)) buyArmor(a.id, false);
      }

      if (p.side === 'defenders' && !p.hasDefuseKit && kitsBought < 3) {
        if (buyKit(a.id)) kitsBought++;
      }
    }
  }
}

// ============================================================================
// 2. SITE DEFENSE ADAPTER (defend on def_sandkeep)
// ============================================================================
export class SiteDefenseModeAdapter implements IGameModeAIAdapter {
  public readonly modeId = 'defend';
  public readonly isFfa = false;

  public prepareFrame(ctx: ModeContext, st: ModeRoundPhaseState): void {
    const site = st.defendSitePos ?? { x: 0, y: 0, z: 12 };
    const rad = st.defendSiteRadius ?? 5.2;
    ctx.objectives.update([
      {
        id: 'defend_target_site',
        kind: 'defend_site',
        pos: site,
        radius: rad,
        active: !st.intermissionActive,
        contested: true,
        requiresInteraction: true,
        progress: 0,
      },
    ]);
    ctx.coordinator.updateDefendPlan(ctx.now, ctx.allActors, site, ctx.nav);
  }

  public evaluateActions(ctx: ModeContext, st: ModeRoundPhaseState, agent: AgentEvaluationInput): ScoredAction[] {
    if (st.intermissionActive) {
      return [
        {
          action: 'hold_wait',
          utility: 10.0,
          destination: null,
          lookTarget: null,
          stopDistance: 0,
          urgent: true,
          reason: 'Round intermission pause',
        },
      ];
    }

    const { self, visibleEnemies, bestThreat, memory } = agent;
    const site = st.defendSitePos ?? { x: 0, y: 0, z: 12 };
    const rad = st.defendSiteRadius ?? 5.2;
    const plan = ctx.coordinator.getPlan('attackers');
    const role = plan?.roleByActor.get(self.id) ?? 'planter';
    memory.assignedRole = role;
    const anchor = plan?.anchorByActor.get(self.id) ?? site;

    const actions: ScoredAction[] = [];
    const vis = visibleEnemies[0] ?? null;
    const distSite = Math.hypot(self.pos.x - site.x, self.pos.z - site.z);

    if (distSite <= rad * 0.72) {
      actions.push({
        action: 'plant_bomb',
        utility: 2.0,
        destination: null,
        lookTarget: vis ? vis.pos : st.playerPos ?? site,
        stopDistance: 99,
        urgent: true,
        reason: 'Holding inside Site zone to complete plant',
      });
    } else {
      const dest = role === 'lurk' && distSite > 14 ? anchor : site;
      actions.push({
        action: 'rush_site',
        utility: role === 'planter' ? 1.45 : 1.15,
        destination: dest,
        lookTarget: vis ? vis.pos : null,
        stopDistance: 1.6,
        reason: `${role} navigating around bunkers toward Bomb Site`,
      });
    }

    if (vis) {
      actions.push({
        action: 'engage_threat',
        utility: vis.distance < 13 ? 1.55 : 1.1,
        destination: distSite <= rad + 1.5 ? null : site,
        lookTarget: vis.pos,
        stopDistance: distSite <= rad + 1.5 ? 99 : 2.0,
        reason: `Fighting defender while advancing (${Math.round(vis.distance)}m)`,
      });
    } else if (bestThreat) {
      actions.push({
        action: 'investigate_sound',
        utility: 0.92,
        destination: bestThreat.pos,
        lookTarget: bestThreat.pos,
        stopDistance: 3.0,
        reason: 'Checking defender position/sound',
      });
    }

    return actions;
  }
}

// ============================================================================
// 3. FREE-FOR-ALL DEATHMATCH ADAPTER (dm on dm_icefoundry)
// ============================================================================
export class DeathmatchFfaAdapter implements IGameModeAIAdapter {
  public readonly modeId = 'dm';
  public readonly isFfa = true;

  public prepareFrame(ctx: ModeContext): void {
    ctx.objectives.update([
      {
        id: 'ffa_arena',
        kind: 'ffa_arena',
        pos: { x: 0, y: 0, z: 0 },
        radius: 26,
        active: true,
        contested: false,
        requiresInteraction: false,
        progress: 0,
      },
    ]);
  }

  public evaluateActions(ctx: ModeContext, _st: ModeRoundPhaseState, agent: AgentEvaluationInput): ScoredAction[] {
    const { self, visibleEnemies, bestThreat, memory } = agent;
    memory.assignedRole = 'hunter';
    const actions: ScoredAction[] = [];
    const vis = visibleEnemies[0] ?? null;

    if (vis) {
      actions.push({
        action: 'engage_threat',
        utility: 1.85,
        destination: vis.distance > 14 ? vis.pos : vis.distance < 5 ? null : self.pos,
        lookTarget: vis.pos,
        stopDistance: vis.distance > 14 ? 8 : 99,
        urgent: vis.distance < 11,
        reason: `FFA duel vs ${vis.actorId} (${Math.round(vis.distance)}m)`,
      });
    } else if (bestThreat && bestThreat.confidence > 0.3) {
      actions.push({
        action: 'investigate_sound',
        utility: 1.32,
        destination: bestThreat.pos,
        lookTarget: bestThreat.pos,
        stopDistance: 2.5,
        reason: bestThreat.fromSound ? 'Hunting FFA gunshot sound' : 'Pursuing last seen enemy',
      });
    }

    const seed = self.id.charCodeAt(self.id.length - 1) || 1;
    const patrolPt = pickPatrolAnchor(self.pos, ctx.anchors, memory, ctx.now, seed);
    actions.push({
      action: 'patrol_route',
      utility: 0.9,
      destination: patrolPt,
      lookTarget: null,
      stopDistance: 2.0,
      reason: 'Roam & sweep map lanes for targets',
    });

    if (self.hp < 28 && vis && ctx.now - memory.lastDamagedAt < 1.2) {
      const safe = ctx.nav.findNearestWalkable(
        self.pos.x - (vis.pos.x - self.pos.x),
        self.pos.z - (vis.pos.z - self.pos.z),
        6,
      );
      if (safe) {
        actions.push({
          action: 'retreat_cover',
          utility: 1.4,
          destination: safe,
          lookTarget: vis.pos,
          stopDistance: 1.2,
          reason: 'Disengaging behind Icefoundry cover',
        });
      }
    }

    return actions;
  }
}

// ============================================================================
// 4. 1v1 ARENA DUEL ADAPTER (arena on aim_dockyard)
// ============================================================================
export class ArenaDuelAdapter implements IGameModeAIAdapter {
  public readonly modeId = 'arena';
  public readonly isFfa = true;

  public prepareFrame(ctx: ModeContext, st: ModeRoundPhaseState): void {
    ctx.objectives.update([
      {
        id: 'arena_duel',
        kind: 'duel_target',
        pos: st.playerPos ?? { x: 0, y: 0, z: 0 },
        radius: 16,
        active: true,
        contested: true,
        requiresInteraction: false,
        progress: 0,
      },
    ]);
  }

  public evaluateActions(ctx: ModeContext, _st: ModeRoundPhaseState, agent: AgentEvaluationInput): ScoredAction[] {
    const { self, visibleEnemies, bestThreat, memory } = agent;
    memory.assignedRole = 'duelist';
    const actions: ScoredAction[] = [];
    const vis = visibleEnemies[0] ?? null;

    if (vis) {
      actions.push({
        action: 'engage_threat',
        utility: 1.9,
        destination: vis.distance > 12 ? vis.pos : null,
        lookTarget: vis.pos,
        stopDistance: vis.distance > 12 ? 7 : 99,
        urgent: true,
        reason: `1v1 duel engagement (${Math.round(vis.distance)}m)`,
      });
    } else if (bestThreat) {
      actions.push({
        action: 'investigate_sound',
        utility: 1.35,
        destination: bestThreat.pos,
        lookTarget: bestThreat.pos,
        stopDistance: 3.0,
        reason: 'Peeking last known / heard opponent angle',
      });
    }

    const seed = Math.floor(ctx.now * 0.25) + (self.id.charCodeAt(self.id.length - 1) || 1);
    const pt = pickPatrolAnchor(self.pos, ctx.anchors, memory, ctx.now, seed);
    actions.push({
      action: 'patrol_route',
      utility: 0.95,
      destination: pt,
      lookTarget: bestThreat ? bestThreat.pos : null,
      stopDistance: 1.8,
      reason: 'Rotating dockyard peek lane',
    });

    return actions;
  }
}

// ============================================================================
// 5. HACK VS HACK ADAPTER (hvh on hvh_cybergrid + Admin / Rainbow)
// ============================================================================
export class HvhModeAdapter implements IGameModeAIAdapter {
  public readonly modeId = 'hvh';
  public readonly isFfa = true;

  public prepareFrame(ctx: ModeContext): void {
    ctx.objectives.update([
      {
        id: 'hvh_arena',
        kind: 'ffa_arena',
        pos: { x: 0, y: 0, z: 0 },
        radius: 26,
        active: true,
        contested: false,
        requiresInteraction: false,
        progress: 0,
      },
    ]);
  }

  public evaluateActions(ctx: ModeContext, st: ModeRoundPhaseState, agent: AgentEvaluationInput): ScoredAction[] {
    const { self, visibleEnemies, bestThreat, memory } = agent;
    memory.assignedRole = 'hunter';
    const actions: ScoredAction[] = [];
    const vis = visibleEnemies[0] ?? null;

    // Special Bot Cases inside Cybergrid / Standard Modes: Admin Boss hunts human via NavGrid; Rainbow flees!
    if (self.isAdmin && st.playerPos) {
      actions.push({
        action: 'engage_threat',
        utility: 2.6,
        destination: st.playerPos,
        lookTarget: st.playerPos,
        stopDistance: 2.2,
        urgent: true,
        reason: 'ADMIN_BANHAMMER enforcing NavGrid pursuit',
      });
      return actions;
    }

    if (self.isRainbow) {
      const seed = Math.floor(ctx.now * 0.5) + self.id.charCodeAt(0);
      const fleeAnchor = pickPatrolAnchor(self.pos, ctx.anchors, memory, ctx.now, seed);
      actions.push({
        action: 'patrol_route',
        utility: 2.4,
        destination: fleeAnchor,
        lookTarget: null,
        stopDistance: 2.0,
        urgent: true,
        reason: 'Rainbow runner high-speed NavGrid evade',
      });
      return actions;
    }

    if (vis) {
      actions.push({
        action: 'engage_threat',
        utility: 1.9,
        destination: vis.distance > 11 ? vis.pos : null,
        lookTarget: vis.pos,
        stopDistance: vis.distance > 11 ? 8 : 99,
        urgent: true,
        reason: `HvH rage duel (${Math.round(vis.distance)}m)`,
      });
    } else if (bestThreat) {
      actions.push({
        action: 'investigate_sound',
        utility: 1.4,
        destination: bestThreat.pos,
        lookTarget: bestThreat.pos,
        stopDistance: 2.8,
        reason: 'Aggressive push to sound / last contact',
      });
    }

    const pt = pickPatrolAnchor(self.pos, ctx.anchors, memory, ctx.now, self.id.charCodeAt(0) + Math.floor(ctx.now * 0.2));
    actions.push({
      action: 'patrol_route',
      utility: 0.95,
      destination: pt,
      lookTarget: null,
      stopDistance: 2.0,
      reason: 'Cybergrid bhop lane sweep',
    });

    return actions;
  }
}

export function createModeAdapter(modeId: string): IGameModeAIAdapter {
  switch (modeId) {
    case 'snd':
      return new SndModeAdapter();
    case 'defend':
      return new SiteDefenseModeAdapter();
    case 'dm':
      return new DeathmatchFfaAdapter();
    case 'arena':
      return new ArenaDuelAdapter();
    case 'hvh':
    default:
      return new HvhModeAdapter();
  }
}
