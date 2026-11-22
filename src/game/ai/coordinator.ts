import { NavGrid } from './navigation';
import { AiCombatantInput, BotRole, Vec3 } from './types';

export interface SndCoordinatorInput {
  phase: string;
  attackersTeam: string;
  defendersTeam: string;
  siteA: { pos: Vec3; radius: number };
  siteB: { pos: Vec3; radius: number };
  midPos: Vec3;
  bombState: string;
  bombSite: 'A' | 'B' | null;
  bombPos: Vec3;
  carrierId: string | null;
  interactorId: string | null;
  roundTargetSite: 'A' | 'B';
}

export interface TeamPlan {
  team: string;
  executeSite: 'A' | 'B';
  roleByActor: Map<string, BotRole>;
  anchorByActor: Map<string, Vec3>;
  recovererId: string | null;
  defuserId: string | null;
}

export class TeamCoordinator {
  private plans = new Map<string, TeamPlan>();
  private lastPlanAt = -100;
  private lastKey = '';

  public reset(): void {
    this.plans.clear();
    this.lastPlanAt = -100;
    this.lastKey = '';
  }

  public updateSndPlans(
    now: number,
    actors: AiCombatantInput[],
    snd: SndCoordinatorInput,
    nav: NavGrid,
  ): void {
    const aliveIds = actors.filter((a) => a.alive).map((a) => `${a.id}:${a.hasDefuseKit ? 1 : 0}`).join(',');
    const key = `${snd.phase}|${snd.bombState}|${snd.bombSite}|${snd.carrierId}|${snd.roundTargetSite}|${aliveIds}`;
    if (key === this.lastKey && now - this.lastPlanAt < 1.0) return;
    this.lastKey = key;
    this.lastPlanAt = now;

    this.buildSndTeamPlan(snd.attackersTeam, 'attackers', actors, snd, nav);
    this.buildSndTeamPlan(snd.defendersTeam, 'defenders', actors, snd, nav);
  }

  private buildSndTeamPlan(
    team: string,
    side: 'attackers' | 'defenders',
    actors: AiCombatantInput[],
    snd: SndCoordinatorInput,
    nav: NavGrid,
  ): void {
    const members = actors.filter((a) => a.team === team && a.alive);
    const roleByActor = new Map<string, BotRole>();
    const anchorByActor = new Map<string, Vec3>();

    let executeSite: 'A' | 'B' = snd.bombSite ?? snd.roundTargetSite;
    // Follow human carrier site commit if human carries C4 and pushes toward A or B!
    if (side === 'attackers' && snd.carrierId) {
      const carrier = members.find((m) => m.id === snd.carrierId);
      if (carrier && carrier.isHuman) {
        const dA = Math.hypot(carrier.pos.x - snd.siteA.pos.x, carrier.pos.z - snd.siteA.pos.z);
        const dB = Math.hypot(carrier.pos.x - snd.siteB.pos.x, carrier.pos.z - snd.siteB.pos.z);
        if (Math.min(dA, dB) < 28 && Math.abs(dA - dB) > 5) {
          executeSite = dA < dB ? 'A' : 'B';
        }
      }
    }

    let recovererId: string | null = null;
    let defuserId: string | null = null;

    if (side === 'attackers') {
      if (snd.bombState === 'dropped') {
        let bestD = Infinity;
        for (const m of members) {
          if (m.isHuman) continue;
          const d = Math.hypot(m.pos.x - snd.bombPos.x, m.pos.z - snd.bombPos.z);
          if (d < bestD) {
            bestD = d;
            recovererId = m.id;
          }
        }
      }

      const siteObj = executeSite === 'A' ? snd.siteA : snd.siteB;
      const spreadOffsets = this.computeRingAnchors(
        snd.bombState === 'planted' || snd.bombState === 'defusing' ? snd.bombPos : siteObj.pos,
        snd.bombState === 'planted' ? 6.8 : 4.2,
        Math.max(5, members.length),
        nav,
      );

      let slot = 0;
      for (const m of members) {
        if (m.id === snd.carrierId) {
          roleByActor.set(m.id, 'carrier');
          anchorByActor.set(m.id, { ...siteObj.pos });
        } else if (m.id === recovererId) {
          roleByActor.set(m.id, 'carrier');
          anchorByActor.set(m.id, { ...snd.bombPos });
        } else if (slot === 0) {
          roleByActor.set(m.id, 'entry');
          anchorByActor.set(m.id, spreadOffsets[slot % spreadOffsets.length]);
          slot++;
        } else if (slot === 1 && members.length >= 4 && snd.bombState === 'carried') {
          roleByActor.set(m.id, 'lurk');
          anchorByActor.set(m.id, nav.findNearestWalkable(snd.midPos.x, snd.midPos.z) ?? { ...snd.midPos });
          slot++;
        } else {
          roleByActor.set(m.id, 'escort');
          anchorByActor.set(m.id, spreadOffsets[slot % spreadOffsets.length]);
          slot++;
        }
      }
    } else {
      // Defenders: elect 1 defuser if bomb planted, assign distinct anchors on Site A, Site B, Mid
      if (snd.bombState === 'planted' || snd.bombState === 'defusing') {
        if (snd.interactorId && members.some((m) => m.id === snd.interactorId)) {
          defuserId = snd.interactorId;
        } else {
          let bestScore = Infinity;
          for (const m of members) {
            if (m.isHuman) continue;
            const d = Math.hypot(m.pos.x - snd.bombPos.x, m.pos.z - snd.bombPos.z);
            const kitBonus = m.hasDefuseKit ? (d <= 6.5 ? 12 : 3.5) : 0;
            const score = d - kitBonus;
            if (score < bestScore) {
              bestScore = score;
              defuserId = m.id;
            }
          }
        }
      }

      const anchorsA = this.computeRingAnchors(snd.siteA.pos, 3.6, 3, nav);
      const anchorsB = this.computeRingAnchors(snd.siteB.pos, 3.6, 3, nav);
      const anchorMid = nav.findNearestWalkable(snd.midPos.x, snd.midPos.z) ?? { ...snd.midPos };
      const bombSiteCenter = snd.bombSite === 'A' ? snd.siteA.pos : snd.siteB.pos;
      const retakeAnchors = this.computeRingAnchors(bombSiteCenter, 5.2, 5, nav);

      let aCnt = 0;
      let bCnt = 0;
      let midAssigned = false;
      let rIdx = 0;
      for (const m of members) {
        if (snd.bombState === 'planted' || snd.bombState === 'defusing') {
          if (m.id === defuserId) {
            roleByActor.set(m.id, 'defuser');
            anchorByActor.set(m.id, { ...snd.bombPos });
          } else {
            roleByActor.set(m.id, 'entry');
            anchorByActor.set(m.id, retakeAnchors[rIdx++ % retakeAnchors.length]);
          }
          continue;
        }

        // Balanced Site Coverage: ensure >=1 A and >=1 B, 1 Mid rotator, then fill alternating anchors
        if (aCnt === 0) {
          roleByActor.set(m.id, 'anchor_a');
          anchorByActor.set(m.id, anchorsA[aCnt % anchorsA.length]);
          aCnt++;
        } else if (bCnt === 0) {
          roleByActor.set(m.id, 'anchor_b');
          anchorByActor.set(m.id, anchorsB[bCnt % anchorsB.length]);
          bCnt++;
        } else if (!midAssigned && members.length >= 4) {
          midAssigned = true;
          roleByActor.set(m.id, 'rotator_mid');
          anchorByActor.set(m.id, anchorMid);
        } else if (aCnt <= bCnt) {
          roleByActor.set(m.id, 'anchor_a');
          anchorByActor.set(m.id, anchorsA[aCnt % anchorsA.length]);
          aCnt++;
        } else {
          roleByActor.set(m.id, 'anchor_b');
          anchorByActor.set(m.id, anchorsB[bCnt % anchorsB.length]);
          bCnt++;
        }
      }
    }

    this.plans.set(team, {
      team,
      executeSite,
      roleByActor,
      anchorByActor,
      recovererId,
      defuserId,
    });
  }

  public updateDefendPlan(
    now: number,
    actors: AiCombatantInput[],
    sitePos: Vec3,
    nav: NavGrid,
  ): void {
    const aliveIds = actors.filter((a) => a.alive).map((a) => a.id).join(',');
    const key = `defend|${aliveIds}`;
    if (key === this.lastKey && now - this.lastPlanAt < 1.5) return;
    this.lastKey = key;
    this.lastPlanAt = now;

    const attackers = actors.filter((a) => a.alive && !a.isHuman);
    const roleByActor = new Map<string, BotRole>();
    const anchorByActor = new Map<string, Vec3>();
    const ring = this.computeRingAnchors(sitePos, 2.8, Math.max(4, attackers.length), nav);

    // Closest or index 0 becomes planter; others split left/right/mid flank anchors
    attackers.forEach((m, idx) => {
      if (idx === 0) {
        roleByActor.set(m.id, 'planter');
        anchorByActor.set(m.id, { ...sitePos });
      } else {
        roleByActor.set(m.id, idx % 2 === 1 ? 'entry' : 'lurk');
        anchorByActor.set(m.id, ring[idx % ring.length]);
      }
    });

    this.plans.set('attackers', {
      team: 'attackers',
      executeSite: 'A',
      roleByActor,
      anchorByActor,
      recovererId: null,
      defuserId: null,
    });
  }

  public getPlan(team: string): TeamPlan | null {
    return this.plans.get(team) ?? null;
  }

  public computeRingAnchors(center: Vec3, radius: number, count: number, nav: NavGrid): Vec3[] {
    const out: Vec3[] = [];
    for (let i = 0; i < count; i++) {
      const ang = (i / Math.max(1, count)) * Math.PI * 2 + 0.35;
      const wx = center.x + Math.cos(ang) * radius;
      const wz = center.z + Math.sin(ang) * radius;
      const snap = nav.findNearestWalkable(wx, wz, 5) ?? nav.findNearestWalkable(center.x, center.z, 5);
      if (snap) out.push(snap);
    }
    if (out.length === 0) out.push({ ...center });
    return out;
  }
}
