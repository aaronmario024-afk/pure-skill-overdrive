import { TeamCoordinator } from './coordinator';
import { UtilityDecisionEngine } from './decision';
import { BotMemory } from './memory';
import { IGameModeAIAdapter, ModeContext, ModeRoundPhaseState } from './modes';
import { BotMovementController } from './movement';
import { NavGrid } from './navigation';
import { ObjectiveManager } from './objectives';
import { BotPerceptionSystem, SoundBus } from './perception';
import { StuckRecoverySystem } from './recovery';
import {
  AiCombatantInput,
  BOT_DIFFICULTIES,
  BOT_PROFILES,
  BotDebugSnapshot,
  BotDifficultyId,
  BotProfileId,
  BotStepCommand,
  Vec3,
  WorldQueryApi,
} from './types';

const PROFILE_ROTATION: BotProfileId[] = [
  'balanced',
  'aggressive',
  'defensive',
  'supportive',
  'adaptive',
];

export class BotAgent {
  public readonly id: string;
  public profile: BotProfileId;
  public readonly seed: number;
  public readonly memory = new BotMemory();
  public readonly decision = new UtilityDecisionEngine();
  public readonly movement = new BotMovementController();
  public readonly recovery = new StuckRecoverySystem();

  private firstSeenThreatAt = 0;
  private trackedThreatId: string | null = null;
  private nextFireAllowedAt = 0;
  private lastBurstCount = 0;
  private latestSnapshot: BotDebugSnapshot | null = null;

  constructor(id: string, seed: number, profile?: BotProfileId) {
    this.id = id;
    this.seed = seed;
    this.profile = profile ?? PROFILE_ROTATION[seed % PROFILE_ROTATION.length];
  }

  public resetForRespawn(yaw: number): void {
    this.memory.resetForRespawn();
    this.decision.reset();
    this.movement.reset(yaw);
    this.recovery.reset();
    this.firstSeenThreatAt = 0;
    this.trackedThreatId = null;
    this.nextFireAllowedAt = 0;
    this.lastBurstCount = 0;
  }

  public resetForRound(yaw: number): void {
    this.memory.resetForRound();
    this.decision.reset();
    this.movement.reset(yaw);
    this.recovery.reset();
    this.firstSeenThreatAt = 0;
    this.trackedThreatId = null;
    this.nextFireAllowedAt = 0;
    this.lastBurstCount = 0;
  }

  public getDebugSnapshot(): BotDebugSnapshot | null {
    return this.latestSnapshot;
  }

  public step(
    dt: number,
    now: number,
    self: AiCombatantInput,
    ctx: ModeContext,
    phaseState: ModeRoundPhaseState,
    adapter: IGameModeAIAdapter,
    perception: BotPerceptionSystem,
    world: WorldQueryApi,
    soundBus: SoundBus,
    difficultyId: BotDifficultyId,
    baseWalkSpeed: number,
    staggerSlot: boolean,
  ): BotStepCommand {
    const diff = BOT_DIFFICULTIES[difficultyId] ?? BOT_DIFFICULTIES.normal;
    const prof = BOT_PROFILES[this.profile];

    // 1. Perception (fair FOV + LOS + sound + decaying memory)
    const { visibleEnemies } = perception.update(
      self,
      ctx.allActors,
      adapter.isFfa,
      now,
      diff,
      world,
      soundBus,
      this.memory,
    );
    this.memory.recordVisit(self.pos, now);

    // 2. Objective version check (force reeval on phase/bomb/site changes)
    const objChanged = this.memory.lastObjectiveVersion !== ctx.objectives.version;
    if (objChanged) {
      this.memory.lastObjectiveVersion = ctx.objectives.version;
      this.memory.urgentInterrupt = true;
    }

    const bestThreat = this.memory.getBestThreat();
    const candidates = adapter.evaluateActions(ctx, phaseState, {
      self,
      profile: this.profile,
      memory: this.memory,
      visibleEnemies,
      visibleTeammates: [],
      bestThreat,
    });

    // 3. Decision (staggered or immediate when interrupted / due)
    const dec = this.decision.evaluate(
      now,
      candidates,
      this.profile,
      diff,
      this.memory,
      this.seed,
      staggerSlot || objChanged,
    );

    const prevDest = this.memory.previousDestination;
    if (dec.destination) this.memory.previousDestination = { ...dec.destination };
    const destChangedFromPrev =
      Boolean(prevDest && dec.destination) &&
      Math.hypot(dec.destination!.x - prevDest!.x, dec.destination!.z - prevDest!.z) > 2.0;

    // 4. Desired speed & combat engagement state
    const activeThreat = visibleEnemies[0] ?? null;
    const speedBonus = self.isAdmin ? 1.45 : self.isRainbow ? 1.85 : self.isCheater ? 1.38 : 1.0;
    const combatSlow = activeThreat && dec.action === 'engage_threat' ? 0.72 : 1.0;
    const desiredSpeed =
      dec.action === 'hold_wait' || dec.action === 'plant_bomb' || dec.action === 'defuse_bomb'
        ? 0
        : baseWalkSpeed * diff.moveSpeedMult * prof.speedMult * speedBonus * combatSlow;

    // 5. Recovery state check from previous movement vs current destination
    const isFrozenByCheat = Boolean(self.freezeUntil && now < self.freezeUntil);
    const recOut = isFrozenByCheat
      ? {
          stuckClass: 'stationary_intentional' as const,
          recoveryLevel: 0,
          lastRecovery: this.recovery.lastRecovery,
          forceRepath: false,
          requestNewDecision: false,
          tangentNudge: null,
        }
      : this.recovery.update(
          {
            now,
            pos: self.pos,
            expectedSpeed: desiredSpeed,
            action: dec.action,
            destination: dec.destination,
            stopDistance: dec.stopDistance,
            pathStatus: this.movement.pathStatus,
            blockedByTeammate: false,
            blockedByObstacle: false,
          },
          ctx.nav,
          this.memory,
          this.seed,
        );

    if (recOut.forceRepath || destChangedFromPrev) {
      this.movement.requestRepathNow();
    }
    if (recOut.requestNewDecision && dec.destination) {
      this.memory.blacklistTarget(
        `pat_${Math.round(dec.destination.x)}_${Math.round(dec.destination.z)}`,
        now + 8,
      );
      this.memory.urgentInterrupt = true;
    }

    // 6. Execute movement + collision + avoidance
    const stepPos = { ...self.pos };
    const moveOut = isFrozenByCheat
      ? {
          nextPos: stepPos,
          targetYaw: self.yaw,
          actualSpeed: 0,
          expectedSpeed: 0,
          pathStatus: this.movement.pathStatus,
          blockedByTeammate: false,
          blockedByObstacle: false,
        }
      : this.movement.step(dt, now, self, ctx.allActors, ctx.nav, this.memory, {
          destination: dec.destination,
          lookTarget: dec.lookTarget,
          stopDistance: dec.stopDistance,
          desiredSpeed: isFrozenByCheat ? 0 : desiredSpeed,
          allowCombatStrafe: Boolean(activeThreat) && dec.action === 'engage_threat' && !self.isAdmin,
          strafeThreatPos: activeThreat ? activeThreat.pos : null,
          forceRepath: recOut.forceRepath,
          tangentNudge: recOut.tangentNudge,
        });

    // Update final blockage hint for next recovery window
    if (!isFrozenByCheat && (moveOut.blockedByTeammate || moveOut.blockedByObstacle)) {
      this.recovery.update(
        {
          now,
          pos: moveOut.nextPos,
          expectedSpeed: moveOut.expectedSpeed,
          action: dec.action,
          destination: dec.destination,
          stopDistance: dec.stopDistance,
          pathStatus: moveOut.pathStatus,
          blockedByTeammate: moveOut.blockedByTeammate,
          blockedByObstacle: moveOut.blockedByObstacle,
        },
        ctx.nav,
        this.memory,
        this.seed,
      );
    }

    // 7. Firing & Aim decision (honest sight + reaction delay + burst spread)
    let shouldFire = false;
    let aimPoint: Vec3 | null = null;
    let targetActorId: string | null = null;
    const isStickingInteract = dec.action === 'plant_bomb' || dec.action === 'defuse_bomb';

    if (
      activeThreat &&
      !self.isRainbow &&
      !isFrozenByCheat &&
      !isStickingInteract &&
      phaseState.phase === 'active'
    ) {
      if (this.trackedThreatId !== activeThreat.actorId) {
        this.trackedThreatId = activeThreat.actorId;
        this.firstSeenThreatAt = now;
      }
      const reactTime = self.isCheater ? 0.16 : self.isAdmin ? 0.2 : diff.reactionTime;
      if (now - this.firstSeenThreatAt >= reactTime && now >= this.nextFireAllowedAt) {
        const baseInterval = self.fireInterval ?? 0.45;
        const interval = (self.isCheater ? baseInterval * 0.72 : baseInterval) * diff.fireIntervalMult;
        this.lastBurstCount = (this.lastBurstCount + 1) % 4;
        const burstPause = this.lastBurstCount === 0 ? 0.18 : 0;
        this.nextFireAllowedAt = now + interval * (0.85 + Math.random() * 0.3) + burstPause;
        shouldFire = true;
        targetActorId = activeThreat.actorId;
        aimPoint = { ...activeThreat.eyePos };
      }
    } else {
      this.trackedThreatId = null;
      this.firstSeenThreatAt = 0;
    }

    const turnRate = self.isCheater ? 22 : self.isAdmin ? 16 : diff.turnRateRadSec;
    const primaryObj = ctx.objectives.getPrimaryActive();

    const debug: BotDebugSnapshot = {
      id: self.id,
      name: self.name,
      team: self.team,
      side: self.side,
      profile: this.profile,
      difficulty: difficultyId,
      role: this.memory.assignedRole,
      action: dec.action,
      priority: Math.round(dec.utility * 100) / 100,
      objectiveId: primaryObj ? primaryObj.id : 'none',
      destination: dec.destination ? { ...dec.destination } : null,
      pathPoints: this.movement.pathPoints.map((p) => ({ ...p })),
      pathIndex: this.movement.pathIdx,
      pathStatus: moveOut.pathStatus,
      pos: { ...moveOut.nextPos },
      vel: { x: this.movement.velX, y: 0, z: this.movement.velZ },
      speed: Math.round(moveOut.actualSpeed * 100) / 100,
      stuckClass: recOut.stuckClass,
      recoveryLevel: recOut.recoveryLevel,
      lastRecovery: recOut.lastRecovery,
      lastTransitionReason: dec.reason,
      visibleEnemyCount: visibleEnemies.length,
      heardEnemyCount: Array.from(this.memory.enemies.values()).filter((e) => !e.visible).length,
      hp: self.hp,
      alive: self.alive,
    };
    this.latestSnapshot = debug;

    return {
      nextPos: moveOut.nextPos,
      targetYaw: moveOut.targetYaw,
      turnRateRadSec: turnRate,
      shouldFire,
      aimPoint,
      targetActorId,
      wantsPlant: dec.action === 'plant_bomb',
      wantsDefuse: dec.action === 'defuse_bomb',
      isSpinVisual: Boolean(self.isCheater),
      isBunnyHop: Boolean(self.isCheater),
      debug,
    };
  }
}

export class BotAIManager {
  public readonly nav: NavGrid;
  public readonly adapter: IGameModeAIAdapter;
  public readonly objectives = new ObjectiveManager();
  public readonly coordinator = new TeamCoordinator();
  public readonly perception = new BotPerceptionSystem();
  public readonly soundBus = new SoundBus();
  public readonly anchors: Vec3[];

  public difficulty: BotDifficultyId;
  private agents = new Map<string, BotAgent>();
  private tickIndex = 0;

  constructor(
    nav: NavGrid,
    adapter: IGameModeAIAdapter,
    difficulty: BotDifficultyId = 'normal',
  ) {
    this.nav = nav;
    this.adapter = adapter;
    this.difficulty = difficulty;
    this.anchors = nav.sampleTacticalAnchors(26);
  }

  public ensureAgent(id: string, seed: number, profile?: BotProfileId): BotAgent {
    let ag = this.agents.get(id);
    if (!ag) {
      ag = new BotAgent(id, seed, profile);
      this.agents.set(id, ag);
    }
    return ag;
  }

  public getAgent(id: string): BotAgent | undefined {
    return this.agents.get(id);
  }

  public getAllDebugSnapshots(): BotDebugSnapshot[] {
    const out: BotDebugSnapshot[] = [];
    for (const ag of this.agents.values()) {
      const snap = ag.getDebugSnapshot();
      if (snap) out.push(snap);
    }
    return out;
  }

  public recordSound(
    sourceId: string,
    team: string,
    kind: 'gunshot' | 'footstep' | 'bomb_plant' | 'bomb_defuse' | 'bomb_beep',
    pos: Vec3,
    radius: number,
    time: number,
  ): void {
    this.soundBus.emit({ sourceId, team, kind, pos: { ...pos }, radius, time });
  }

  public onBotDamaged(botId: string, fromPos: Vec3, now: number): void {
    this.agents.get(botId)?.memory.recordDamage(fromPos, now);
  }

  public onBotRespawn(botId: string, yaw = 0): void {
    this.agents.get(botId)?.resetForRespawn(yaw);
  }

  public onRoundReset(yawByBot?: Map<string, number>): void {
    this.coordinator.reset();
    this.soundBus.clear();
    for (const [id, ag] of this.agents.entries()) {
      ag.resetForRound(yawByBot?.get(id) ?? 0);
    }
  }

  public update(
    dt: number,
    now: number,
    combatants: AiCombatantInput[],
    phaseState: ModeRoundPhaseState,
    world: WorldQueryApi,
    baseWalkSpeed = 4.1,
  ): Map<string, BotStepCommand> {
    this.tickIndex++;
    const ctx: ModeContext = {
      now,
      allActors: combatants,
      nav: this.nav,
      objectives: this.objectives,
      coordinator: this.coordinator,
      anchors: this.anchors,
    };

    this.adapter.prepareFrame(ctx, phaseState);

    const commands = new Map<string, BotStepCommand>();
    let idx = 0;
    for (const c of combatants) {
      if (c.isHuman) continue;
      const ag = this.ensureAgent(c.id, idx);
      if (!c.alive) {
        idx++;
        continue;
      }
      // Staggered periodic slot so max 1/3 bots force full utility re-eval per frame unless interrupted
      const staggerSlot = (this.tickIndex + idx) % 3 === 0;
      const cmd = ag.step(
        dt,
        now,
        c,
        ctx,
        phaseState,
        this.adapter,
        this.perception,
        world,
        this.soundBus,
        this.difficulty,
        baseWalkSpeed,
        staggerSlot,
      );
      commands.set(c.id, cmd);
      idx++;
    }
    return commands;
  }
}
