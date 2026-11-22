import { BotMemory } from './memory';
import { NavGrid } from './navigation';
import { AiCombatantInput, PathStatus, Vec3 } from './types';

export interface MoveRequest {
  destination: Vec3 | null;
  lookTarget: Vec3 | null;
  stopDistance: number;
  desiredSpeed: number;
  allowCombatStrafe: boolean;
  strafeThreatPos: Vec3 | null;
  forceRepath: boolean;
  tangentNudge: Vec3 | null;
}

export interface MoveStepOutput {
  nextPos: Vec3;
  targetYaw: number;
  actualSpeed: number;
  expectedSpeed: number;
  pathStatus: PathStatus;
  blockedByTeammate: boolean;
  blockedByObstacle: boolean;
}

export class BotMovementController {
  public pathPoints: Vec3[] = [];
  public pathIdx = 0;
  public pathStatus: PathStatus = 'idle';
  public currentDestination: Vec3 | null = null;
  public velX = 0;
  public velZ = 0;
  public lastRepathAt = -100;
  private smoothedYaw = 0;
  private hasYawInit = false;

  public reset(initialYaw = 0): void {
    this.pathPoints = [];
    this.pathIdx = 0;
    this.pathStatus = 'idle';
    this.currentDestination = null;
    this.velX = 0;
    this.velZ = 0;
    this.lastRepathAt = -100;
    this.smoothedYaw = initialYaw;
    this.hasYawInit = true;
  }

  public requestRepathNow(): void {
    this.lastRepathAt = -100;
    this.pathPoints = [];
    this.pathIdx = 0;
  }

  public step(
    dt: number,
    now: number,
    self: AiCombatantInput,
    allActors: AiCombatantInput[],
    nav: NavGrid,
    memory: BotMemory,
    req: MoveRequest,
  ): MoveStepOutput {
    if (!this.hasYawInit) {
      this.smoothedYaw = self.yaw;
      this.hasYawInit = true;
    }

    let expectedSpeed = 0;
    let wishDirX = 0;
    let wishDirZ = 0;

    if (!req.destination) {
      this.pathPoints = [];
      this.pathIdx = 0;
      this.pathStatus = 'idle';
      this.currentDestination = null;
    } else {
      const distToGoal = Math.hypot(req.destination.x - self.pos.x, req.destination.z - self.pos.z);

      if (distToGoal <= Math.max(0.45, req.stopDistance)) {
        this.pathStatus = 'arrived';
        this.currentDestination = { ...req.destination };
        this.pathPoints = [];
        this.pathIdx = 0;
      } else {
        const destChanged =
          !this.currentDestination ||
          Math.hypot(
            req.destination.x - this.currentDestination.x,
            req.destination.z - this.currentDestination.z,
          ) > 1.75;
        const needNewPath =
          req.forceRepath ||
          destChanged ||
          this.pathStatus === 'idle' ||
          this.pathStatus === 'arrived' ||
          (this.pathIdx >= this.pathPoints.length && now - this.lastRepathAt > 0.6) ||
          (now - this.lastRepathAt >= 2.4 && !nav.hasWalkableLine(self.pos, this.pathPoints[this.pathIdx] ?? req.destination, 0.2));

        if (needNewPath) {
          this.lastRepathAt = now;
          const res = nav.findPath(self.pos, req.destination, {
            penaltyZones: memory.getActivePenaltyZones(now),
            allowPartial: true,
          });
          this.pathStatus = res.status;
          this.pathPoints = res.points;
          this.pathIdx = 0;
          this.currentDestination = { ...res.goal };
        }

        // Advance waypoints smoothly without backward oscillation
        while (this.pathIdx < this.pathPoints.length) {
          const wp = this.pathPoints[this.pathIdx];
          const wpDist = Math.hypot(wp.x - self.pos.x, wp.z - self.pos.z);
          if (wpDist < 0.95) {
            this.pathIdx++;
            continue;
          }
          if (
            this.pathIdx + 1 < this.pathPoints.length &&
            nav.hasWalkableLine(self.pos, this.pathPoints[this.pathIdx + 1], 0.28)
          ) {
            this.pathIdx++;
            continue;
          }
          break;
        }

        const activeWp = this.pathPoints[this.pathIdx] ?? (this.pathStatus === 'failed' ? null : req.destination);
        if (activeWp) {
          const dx = activeWp.x - self.pos.x;
          const dz = activeWp.z - self.pos.z;
          const len = Math.hypot(dx, dz);
          if (len > 0.08) {
            wishDirX = dx / len;
            wishDirZ = dz / len;
            // Ease speed slightly when approaching final stopping point
            const remFinal = distToGoal - req.stopDistance;
            const arriveFactor = remFinal < 1.2 ? Math.max(0.35, remFinal / 1.2) : 1.0;
            expectedSpeed = req.desiredSpeed * arriveFactor;
          }
        }
      }
    }

    // Combat micro-strafing when actively shooting a visible threat (only onto verified walkable space!)
    if (req.allowCombatStrafe && req.strafeThreatPos && expectedSpeed < 2.2) {
      const tx = req.strafeThreatPos.x - self.pos.x;
      const tz = req.strafeThreatPos.z - self.pos.z;
      const td = Math.hypot(tx, tz);
      if (td > 2.2) {
        const seedPhase = (self.id.charCodeAt(0) || 1) * 1.37;
        const sign = Math.sin(now * 1.9 + seedPhase) >= 0 ? 1 : -1;
        const sx = (-tz / td) * sign;
        const sz = (tx / td) * sign;
        const probeX = self.pos.x + sx * 1.25;
        const probeZ = self.pos.z + sz * 1.25;
        if (nav.isWalkable(probeX, probeZ)) {
          wishDirX = wishDirX * 0.35 + sx * 0.85;
          wishDirZ = wishDirZ * 0.35 + sz * 0.85;
          const wl = Math.hypot(wishDirX, wishDirZ);
          if (wl > 1e-3) {
            wishDirX /= wl;
            wishDirZ /= wl;
          }
          expectedSpeed = Math.max(expectedSpeed, req.desiredSpeed * 0.58);
        }
      }
    }

    // Recovery lateral nudge override
    if (req.tangentNudge && (Math.abs(req.tangentNudge.x) > 0.05 || Math.abs(req.tangentNudge.z) > 0.05)) {
      wishDirX = wishDirX * 0.3 + req.tangentNudge.x * 0.9;
      wishDirZ = wishDirZ * 0.3 + req.tangentNudge.z * 0.9;
      const nl = Math.hypot(wishDirX, wishDirZ);
      if (nl > 1e-3) {
        wishDirX /= nl;
        wishDirZ /= nl;
      }
      expectedSpeed = Math.max(expectedSpeed, req.desiredSpeed * 0.85);
    }

    // Neighbor separation & doorway yielding (prevents stacking & doorway deadlocks)
    let blockedByTeammate = false;
    let sepX = 0;
    let sepZ = 0;
    for (const other of allActors) {
      if (!other.alive || other.id === self.id) continue;
      const ox = self.pos.x - other.pos.x;
      const oz = self.pos.z - other.pos.z;
      const dist = Math.hypot(ox, oz);
      const minSep = 1.28;
      if (dist < minSep && dist > 1e-4) {
        const weight = ((minSep - dist) / minSep) * 1.6;
        sepX += (ox / dist) * weight;
        sepZ += (oz / dist) * weight;

        // Deterministic side-yield if heading roughly toward another moving bot in narrow path
        const toOtherDot = -(ox * wishDirX + oz * wishDirZ) / dist;
        if (toOtherDot > 0.45 && dist < 1.15) {
          blockedByTeammate = true;
          const yieldSign = self.id < other.id ? 1 : -1;
          sepX += (-oz / dist) * yieldSign * 0.95;
          sepZ += (ox / dist) * yieldSign * 0.95;
        }
      }
    }

    if (expectedSpeed > 0.1 || Math.hypot(sepX, sepZ) > 0.25) {
      const steerX = wishDirX * expectedSpeed + sepX * 2.2;
      const steerZ = wishDirZ * expectedSpeed + sepZ * 2.2;
      const steerLen = Math.hypot(steerX, steerZ);
      const cap = Math.max(expectedSpeed, 1.8);
      const targetVx = steerLen > cap ? (steerX / steerLen) * cap : steerX;
      const targetVz = steerLen > cap ? (steerZ / steerLen) * cap : steerZ;

      const accel = 16;
      const blend = Math.min(1, dt * accel);
      this.velX += (targetVx - this.velX) * blend;
      this.velZ += (targetVz - this.velZ) * blend;
    } else {
      const decel = Math.min(1, dt * 20);
      this.velX += (0 - this.velX) * decel;
      this.velZ += (0 - this.velZ) * decel;
    }

    const candPos: Vec3 = {
      x: self.pos.x + this.velX * dt,
      y: self.pos.y,
      z: self.pos.z + this.velZ * dt,
    };

    const preColX = candPos.x;
    const preColZ = candPos.z;
    nav.resolvePositionCollision(candPos, 0.48);

    const colPush = Math.hypot(candPos.x - preColX, candPos.z - preColZ);
    const blockedByObstacle = expectedSpeed > 0.8 && colPush > 0.015;

    // Gentle wall slide damp so momentum doesn't press infinitely straight into wall normal
    if (blockedByObstacle) {
      const wn = nav.getNearestWallNormal(candPos, 0.72);
      if (wn) {
        const intoWall = this.velX * wn.x + this.velZ * wn.z;
        if (intoWall < 0) {
          this.velX -= wn.x * intoWall * 1.05;
          this.velZ -= wn.z * intoWall * 1.05;
        }
      }
    }

    const actualSpeed = dt > 1e-4 ? Math.hypot(candPos.x - self.pos.x, candPos.z - self.pos.z) / dt : 0;

    // Select natural look target: explicit threat/point > distant waypoint ahead > smooth current yaw
    let targetYaw = this.smoothedYaw;
    if (req.lookTarget) {
      const ldx = req.lookTarget.x - candPos.x;
      const ldz = req.lookTarget.z - candPos.z;
      if (Math.hypot(ldx, ldz) > 0.15) {
        targetYaw = Math.atan2(ldx, ldz);
      }
    } else {
      const lookWp =
        this.pathPoints[Math.min(this.pathIdx + 1, Math.max(0, this.pathPoints.length - 1))] ??
        this.pathPoints[this.pathIdx] ??
        req.destination;
      if (lookWp && expectedSpeed > 0.4) {
        const wdx = lookWp.x - candPos.x;
        const wdz = lookWp.z - candPos.z;
        if (Math.hypot(wdx, wdz) > 0.35) {
          targetYaw = Math.atan2(wdx, wdz);
        }
      }
    }
    this.smoothedYaw = targetYaw;

    return {
      nextPos: candPos,
      targetYaw,
      actualSpeed,
      expectedSpeed,
      pathStatus: this.pathStatus,
      blockedByTeammate,
      blockedByObstacle,
    };
  }
}
