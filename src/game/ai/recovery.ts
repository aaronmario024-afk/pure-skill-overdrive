import { BotMemory } from './memory';
import { NavGrid } from './navigation';
import { BotActionId, PathStatus, StuckClass, Vec3 } from './types';

export interface RecoveryCheckInput {
  now: number;
  pos: Vec3;
  expectedSpeed: number;
  action: BotActionId;
  destination: Vec3 | null;
  stopDistance: number;
  pathStatus: PathStatus;
  blockedByTeammate: boolean;
  blockedByObstacle: boolean;
}

export interface RecoveryResult {
  stuckClass: StuckClass;
  recoveryLevel: number;
  lastRecovery: string;
  forceRepath: boolean;
  requestNewDecision: boolean;
  tangentNudge: Vec3 | null;
}

export class StuckRecoverySystem {
  private samples: Array<{ x: number; z: number; time: number }> = [];
  private stuckSince = 0;
  private recoveryLevel = 0;
  private lastLevelAt = -100;
  private activeNudge: Vec3 | null = null;
  private nudgeUntil = 0;
  public stuckClass: StuckClass = 'none';
  public lastRecovery = 'none';

  public reset(): void {
    this.samples = [];
    this.stuckSince = 0;
    this.recoveryLevel = 0;
    this.lastLevelAt = -100;
    this.activeNudge = null;
    this.nudgeUntil = 0;
    this.stuckClass = 'none';
    this.lastRecovery = 'none';
  }

  public update(
    input: RecoveryCheckInput,
    nav: NavGrid,
    memory: BotMemory,
    botIdSeed: number,
  ): RecoveryResult {
    const { now, pos, expectedSpeed, destination, stopDistance, pathStatus } = input;

    if (now >= this.nudgeUntil) {
      this.activeNudge = null;
    }

    // Classify intentional stationary states accurately before assuming stuck
    if (!destination || expectedSpeed < 0.45) {
      this.stuckSince = 0;
      this.recoveryLevel = 0;
      this.stuckClass =
        input.action === 'defend_site' || input.action === 'defend_planted' || input.action === 'engage_threat'
          ? 'holding_position'
          : input.action === 'escort_carrier' || input.action === 'support_teammate'
            ? 'waiting_teammate'
            : 'stationary_intentional';
      return {
        stuckClass: this.stuckClass,
        recoveryLevel: 0,
        lastRecovery: this.lastRecovery,
        forceRepath: false,
        requestNewDecision: false,
        tangentNudge: null,
      };
    }

    const distToDest = Math.hypot(destination.x - pos.x, destination.z - pos.z);
    if (distToDest <= stopDistance + 0.5) {
      this.stuckSince = 0;
      this.recoveryLevel = 0;
      this.stuckClass = 'none';
      return {
        stuckClass: 'none',
        recoveryLevel: 0,
        lastRecovery: this.lastRecovery,
        forceRepath: false,
        requestNewDecision: false,
        tangentNudge: null,
      };
    }

    if (pathStatus === 'failed') {
      this.stuckClass = 'nav_failed';
      if (now - this.lastLevelAt > 0.9) {
        this.lastLevelAt = now;
        this.recoveryLevel = Math.min(3, this.recoveryLevel + 1);
        memory.recordFailedRoute(destination, now, 3.2, 12);
        this.lastRecovery = `L${this.recoveryLevel}: nav_failed -> blacklist & repick`;
        return {
          stuckClass: 'nav_failed',
          recoveryLevel: this.recoveryLevel,
          lastRecovery: this.lastRecovery,
          forceRepath: true,
          requestNewDecision: true,
          tangentNudge: this.activeNudge,
        };
      }
      return {
        stuckClass: 'nav_failed',
        recoveryLevel: this.recoveryLevel,
        lastRecovery: this.lastRecovery,
        forceRepath: false,
        requestNewDecision: false,
        tangentNudge: this.activeNudge,
      };
    }

    // Record progress samples at ~0.18s resolution
    const lastSample = this.samples[this.samples.length - 1];
    if (!lastSample || now - lastSample.time >= 0.18) {
      this.samples.push({ x: pos.x, z: pos.z, time: now });
      while (this.samples.length > 0 && now - this.samples[0].time > 0.95) {
        this.samples.shift();
      }
    }

    if (this.samples.length < 3) {
      this.stuckClass = 'none';
      return {
        stuckClass: 'none',
        recoveryLevel: this.recoveryLevel,
        lastRecovery: this.lastRecovery,
        forceRepath: false,
        requestNewDecision: false,
        tangentNudge: this.activeNudge,
      };
    }

    const oldest = this.samples[0];
    const elapsedWin = Math.max(0.2, now - oldest.time);
    const displacement = Math.hypot(pos.x - oldest.x, pos.z - oldest.z);
    const expectedDisp = expectedSpeed * elapsedWin;
    const isMakingProgress = displacement >= Math.max(0.45, expectedDisp * 0.25);

    if (isMakingProgress) {
      this.stuckSince = 0;
      this.recoveryLevel = 0;
      this.stuckClass = 'none';
      return {
        stuckClass: 'none',
        recoveryLevel: 0,
        lastRecovery: this.lastRecovery,
        forceRepath: false,
        requestNewDecision: false,
        tangentNudge: this.activeNudge,
      };
    }

    // Genuinely blocked while attempting to move
    if (this.stuckSince === 0) this.stuckSince = now;
    const stuckFor = now - this.stuckSince;
    this.stuckClass = input.blockedByTeammate ? 'blocked_teammate' : 'blocked_obstacle';

    let forceRepath = false;
    let requestNewDecision = false;

    if (stuckFor >= 0.7 && this.recoveryLevel < 1) {
      this.recoveryLevel = 1;
      this.lastLevelAt = now;
      this.activeNudge = this.computeWalkableTangent(pos, destination, nav, botIdSeed);
      this.nudgeUntil = now + 0.65;
      this.lastRecovery = `L1(${this.stuckClass}): lateral wall/mate slide`;
    } else if (stuckFor >= 1.5 && this.recoveryLevel < 2 && now - this.lastLevelAt >= 0.65) {
      this.recoveryLevel = 2;
      this.lastLevelAt = now;
      memory.recordFailedRoute({ x: pos.x, y: 0, z: pos.z }, now, 2.5, 10);
      this.activeNudge = this.computeWalkableTangent(pos, destination, nav, botIdSeed + 1);
      this.nudgeUntil = now + 0.7;
      forceRepath = true;
      this.lastRecovery = `L2(${this.stuckClass}): penalty zone & repath`;
    } else if (stuckFor >= 2.5 && this.recoveryLevel < 3 && now - this.lastLevelAt >= 0.8) {
      this.recoveryLevel = 3;
      this.lastLevelAt = now;
      memory.recordFailedRoute(destination, now, 3.2, 12);
      forceRepath = true;
      requestNewDecision = true;
      this.lastRecovery = `L3(${this.stuckClass}): abandon dest & pick alt route`;
    } else if (stuckFor >= 3.8 && now - this.lastLevelAt >= 1.1) {
      // L4: Controlled local step toward nearest guaranteed clear NavGrid center (max 1.15m, never global teleport)
      this.recoveryLevel = 4;
      this.lastLevelAt = now;
      const openCell = nav.findNearestWalkable(pos.x, pos.z, 3);
      if (openCell) {
        const dx = openCell.x - pos.x;
        const dz = openCell.z - pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.05 && d <= 2.2) {
          const step = Math.min(1.15, d);
          pos.x += (dx / d) * step;
          pos.z += (dz / d) * step;
          nav.resolvePositionCollision(pos, 0.48);
        }
      }
      this.stuckSince = now - 0.5;
      this.recoveryLevel = 1;
      forceRepath = true;
      requestNewDecision = true;
      this.lastRecovery = `L4(${this.stuckClass}): local open-cell unstick step`;
    }

    return {
      stuckClass: this.stuckClass,
      recoveryLevel: this.recoveryLevel,
      lastRecovery: this.lastRecovery,
      forceRepath,
      requestNewDecision,
      tangentNudge: this.activeNudge,
    };
  }

  private computeWalkableTangent(pos: Vec3, dest: Vec3, nav: NavGrid, seed: number): Vec3 {
    const dx = dest.x - pos.x;
    const dz = dest.z - pos.z;
    const len = Math.max(0.01, Math.hypot(dx, dz));
    const rx = -dz / len;
    const rz = dx / len;
    const firstSign = seed % 2 === 0 ? 1 : -1;

    const candidates: Array<[number, number]> = [
      [rx * firstSign, rz * firstSign],
      [-rx * firstSign, -rz * firstSign],
      [(-dx / len) * 0.5 + rx * firstSign * 0.86, (-dz / len) * 0.5 + rz * firstSign * 0.86],
      [-dx / len, -dz / len],
    ];

    for (const [cx, cz] of candidates) {
      if (nav.isWalkable(pos.x + cx * 1.1, pos.z + cz * 1.1)) {
        return { x: cx, y: 0, z: cz };
      }
    }
    return { x: rx * firstSign, y: 0, z: rz * firstSign };
  }
}
