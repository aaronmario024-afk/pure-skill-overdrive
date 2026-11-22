import { BotMemory } from './memory';
import {
  BotActionId,
  BotDifficultyConfig,
  BOT_PROFILES,
  BotProfileId,
  ScoredAction,
  Vec3,
} from './types';

export interface ActiveDecision {
  action: BotActionId;
  utility: number;
  destination: Vec3 | null;
  lookTarget: Vec3 | null;
  stopDistance: number;
  startedAt: number;
  minHoldUntil: number;
  reason: string;
}

const DEFAULT_DECISION: ActiveDecision = {
  action: 'hold_wait',
  utility: 0,
  destination: null,
  lookTarget: null,
  stopDistance: 1.0,
  startedAt: 0,
  minHoldUntil: 0,
  reason: 'init',
};

export class UtilityDecisionEngine {
  public current: ActiveDecision = { ...DEFAULT_DECISION };
  public lastDecisionAt = -100;
  public switchCount = 0;

  public reset(): void {
    this.current = { ...DEFAULT_DECISION };
    this.lastDecisionAt = -100;
  }

  public evaluate(
    now: number,
    candidates: ScoredAction[],
    profileId: BotProfileId,
    diff: BotDifficultyConfig,
    memory: BotMemory,
    agentSeed: number,
    forceReeval: boolean,
  ): ActiveDecision {
    if (candidates.length === 0) {
      this.current = {
        action: 'hold_wait',
        utility: 0.1,
        destination: null,
        lookTarget: null,
        stopDistance: 1.0,
        startedAt: now,
        minHoldUntil: now + 0.5,
        reason: 'no candidates',
      };
      return this.current;
    }

    const prof = BOT_PROFILES[profileId];

    // Update lookTarget / destination freshness even between full re-evaluations
    const matchingCur = candidates.find((c) => c.action === this.current.action);
    const curInvalidated = !matchingCur;
    const anyUrgentSwitch = candidates.some(
      (c) => c.urgent && c.action !== this.current.action && c.utility > this.current.utility + 0.15,
    );

    const dueForEval =
      forceReeval ||
      curInvalidated ||
      anyUrgentSwitch ||
      memory.urgentInterrupt ||
      now - this.lastDecisionAt >= diff.decisionInterval;

    if (!dueForEval && matchingCur) {
      this.current.lookTarget = matchingCur.lookTarget;
      // Keep moving destination updated smoothly when tracking mobile targets without thrashing action state
      if (matchingCur.destination && (matchingCur.action === 'engage_threat' || matchingCur.action === 'recover_bomb' || matchingCur.action === 'escort_carrier')) {
        this.current.destination = matchingCur.destination;
      }
      return this.current;
    }

    this.lastDecisionAt = now;
    memory.urgentInterrupt = false;

    const scoreWithProfile = (cand: ScoredAction): number => {
      let mult = 1.0;
      if (
        cand.action === 'engage_threat' ||
        cand.action === 'investigate_sound' ||
        cand.action === 'rush_site'
      ) {
        mult = prof.aggression;
      } else if (
        cand.action === 'retreat_cover' ||
        cand.action === 'defend_site' ||
        cand.action === 'defend_planted'
      ) {
        mult = prof.caution;
      } else if (
        cand.action === 'plant_bomb' ||
        cand.action === 'defuse_bomb' ||
        cand.action === 'attack_site' ||
        cand.action === 'recover_bomb' ||
        cand.action === 'retake_site'
      ) {
        mult = prof.objectiveBias;
      } else if (cand.action === 'escort_carrier' || cand.action === 'support_teammate') {
        mult = prof.teamCohesion;
      }

      // Deterministic pseudo-noise scaled by difficulty & seed so decisions don't flicker randomly every frame
      const bucket = Math.floor(now * 2) + agentSeed * 31;
      const pseudo = (Math.sin(bucket * 12.9898 + cand.action.length * 78.233) * 0.5 + 0.5) - 0.5;
      let score = cand.utility * mult + pseudo * diff.decisionNoise;

      // Hysteresis: bias strongly toward maintaining current valid action unless eclipsed cleanly
      if (cand.action === this.current.action && !curInvalidated) {
        score += 0.16;
      }

      // Discourage picking destinations very recently walked in loops unless urgent objective
      if (cand.destination && !cand.urgent && (cand.action === 'patrol_route' || cand.action === 'rotate_site')) {
        const visits = memory.getRecentlyVisitedCount(cand.destination, now, 8);
        score -= visits * 0.12;
      }

      return score;
    };

    let best = candidates[0];
    let bestScore = -1e9;
    for (const c of candidates) {
      const s = scoreWithProfile(c);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }

    // Enforce minimum state hold duration unless action became invalid or urgent emergency overrides
    const inMinHold = now < this.current.minHoldUntil && !curInvalidated && !best.urgent;
    if (inMinHold && best.action !== this.current.action && matchingCur) {
      this.current.lookTarget = matchingCur.lookTarget;
      return this.current;
    }

    if (best.action !== this.current.action) {
      this.switchCount++;
      this.current = {
        action: best.action,
        utility: bestScore,
        destination: best.destination ? { ...best.destination } : null,
        lookTarget: best.lookTarget ? { ...best.lookTarget } : null,
        stopDistance: best.stopDistance,
        startedAt: now,
        minHoldUntil: now + (best.urgent ? 0.55 : 1.35),
        reason: best.reason,
      };
    } else {
      this.current.utility = bestScore;
      this.current.lookTarget = best.lookTarget ? { ...best.lookTarget } : null;
      this.current.stopDistance = best.stopDistance;
      if (best.destination) this.current.destination = { ...best.destination };
      this.current.reason = best.reason;
    }

    return this.current;
  }
}
