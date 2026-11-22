import { NavPenaltyZone } from './navigation';
import { BotRole, PerceivedThreat, Vec3 } from './types';

interface VisitedCellEntry {
  key: number;
  x: number;
  z: number;
  time: number;
}

interface FailedRouteEntry extends NavPenaltyZone {
  expiresAt: number;
  key: string;
}

export class BotMemory {
  public previousDestination: Vec3 | null = null;
  public assignedRole: BotRole = 'roamer';
  public currentTaskTag = '';
  public lastObjectiveVersion = -1;

  public visitedTrail: VisitedCellEntry[] = [];
  public failedRoutes: FailedRouteEntry[] = [];
  public blacklistedTargets = new Map<string, number>();

  public enemies = new Map<string, PerceivedThreat>();
  public teammates = new Map<string, { pos: Vec3; time: number }>();

  public lastDamagedAt = -100;
  public lastDamageFrom: Vec3 | null = null;
  public urgentInterrupt = false;

  public resetForRespawn(): void {
    this.previousDestination = null;
    this.currentTaskTag = '';
    this.lastObjectiveVersion = -1;
    this.visitedTrail = [];
    this.failedRoutes = [];
    this.blacklistedTargets.clear();
    this.enemies.clear();
    this.lastDamagedAt = -100;
    this.lastDamageFrom = null;
    this.urgentInterrupt = true;
  }

  public resetForRound(): void {
    this.resetForRespawn();
    this.teammates.clear();
    this.assignedRole = 'roamer';
  }

  public recordDamage(fromPos: Vec3, now: number): void {
    this.lastDamagedAt = now;
    this.lastDamageFrom = { ...fromPos };
    this.urgentInterrupt = true;
  }

  public recordVisit(pos: Vec3, now: number): void {
    const gx = Math.round(pos.x / 3);
    const gz = Math.round(pos.z / 3);
    const key = gx * 1000 + gz;
    const last = this.visitedTrail[this.visitedTrail.length - 1];
    if (last && last.key === key) {
      last.time = now;
      return;
    }
    this.visitedTrail.push({ key, x: pos.x, z: pos.z, time: now });
    if (this.visitedTrail.length > 18) this.visitedTrail.shift();
  }

  public getRecentlyVisitedCount(pos: Vec3, now: number, windowSec = 9): number {
    let hits = 0;
    for (const v of this.visitedTrail) {
      if (now - v.time > windowSec) continue;
      if (Math.hypot(v.x - pos.x, v.z - pos.z) <= 3.8) hits++;
    }
    return hits;
  }

  public recordFailedRoute(pos: Vec3, now: number, radius = 2.8, ttl = 14): void {
    const key = `${Math.round(pos.x / 2)}_${Math.round(pos.z / 2)}`;
    const existing = this.failedRoutes.find((f) => f.key === key);
    if (existing) {
      existing.expiresAt = now + ttl;
      existing.cost = Math.min(20, existing.cost + 4);
      return;
    }
    this.failedRoutes.push({
      x: pos.x,
      z: pos.z,
      radius,
      cost: 8,
      expiresAt: now + ttl,
      key,
    });
    if (this.failedRoutes.length > 10) this.failedRoutes.shift();
  }

  public getActivePenaltyZones(now: number): NavPenaltyZone[] {
    this.failedRoutes = this.failedRoutes.filter((f) => f.expiresAt > now);
    return this.failedRoutes;
  }

  public blacklistTarget(key: string, until: number): void {
    this.blacklistedTargets.set(key, until);
  }

  public isBlacklisted(key: string, now: number): boolean {
    const until = this.blacklistedTargets.get(key);
    if (!until) return false;
    if (now >= until) {
      this.blacklistedTargets.delete(key);
      return false;
    }
    return true;
  }

  public upsertThreat(t: PerceivedThreat): void {
    const prev = this.enemies.get(t.actorId);
    if (prev && !t.visible && prev.visible && t.lastSeenAt - prev.lastSeenAt < 1.0) {
      // Preserve sharper visual lock over noisy sound update within 1s
      return;
    }
    this.enemies.set(t.actorId, t);
  }

  public decay(now: number, memoryDuration: number, aliveIds: Set<string>): void {
    for (const [id, th] of this.enemies.entries()) {
      if (!aliveIds.has(id)) {
        this.enemies.delete(id);
        continue;
      }
      const age = now - th.lastSeenAt;
      if (age > memoryDuration) {
        this.enemies.delete(id);
      } else {
        th.confidence = Math.max(0.05, 1 - age / Math.max(0.5, memoryDuration));
      }
    }
  }

  public getBestThreat(): PerceivedThreat | null {
    let best: PerceivedThreat | null = null;
    let bestScore = -1e9;
    for (const th of this.enemies.values()) {
      const score = (th.visible ? 1000 : 0) + th.confidence * 250 - th.distance * 4;
      if (score > bestScore) {
        bestScore = score;
        best = th;
      }
    }
    return best;
  }

  public getVisibleThreats(): PerceivedThreat[] {
    const list: PerceivedThreat[] = [];
    for (const th of this.enemies.values()) {
      if (th.visible) list.push(th);
    }
    return list.sort((a, b) => a.distance - b.distance);
  }
}
