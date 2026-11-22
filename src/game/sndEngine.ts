export type TeamId = 'teamA' | 'teamB';
export type TeamSide = 'attackers' | 'defenders';

export type SndPhase =
  | 'waiting'
  | 'round_prep'
  | 'buy_phase'
  | 'active'
  | 'round_end'
  | 'intermission'
  | 'side_switch'
  | 'match_end';

export type BombState =
  | 'not_carried'
  | 'carried'
  | 'dropped'
  | 'planting'
  | 'planted'
  | 'defusing'
  | 'defused'
  | 'detonated';

export type SndWinReason =
  | 'detonated'
  | 'defused'
  | 'attackers_eliminated'
  | 'defenders_eliminated'
  | 'time_expired';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface SiteZone {
  id: 'A' | 'B';
  pos: Vec3Like;
  radius: number;
}

export interface SndEconomyConfig {
  startMoney: number;
  overtimeMoney: number;
  maxMoney: number;
  winElim: number;
  winObjective: number;
  lossBase: number;
  lossStep: number;
  maxLossStreak: number;
  plantBonus: number;
  plantLossBonus: number;
  defuseBonus: number;
  armorCost: number;
  helmetCost: number;
  defuseKitCost: number;
  weaponCosts: Record<string, number>;
  killRewards: Record<string, number>;
}

export interface SndRules {
  teamSize: number;
  minPlayersPerTeam: number;
  roundsPerHalf: number;
  roundsToWin: number;
  overtimeEnabled: boolean;
  overtimeHalfRounds: number;
  overtimeWinMargin: number;
  waitingDuration: number;
  roundPrepDuration: number;
  buyPhaseDuration: number;
  allowPrepMove: boolean;
  roundDuration: number;
  roundEndDuration: number;
  intermissionDuration: number;
  sideSwitchDuration: number;
  plantDuration: number;
  defuseDuration: number;
  defuseKitDuration: number;
  bombDetonationDuration: number;
  interactRadius: number;
  bombPickupRadius: number;
  friendlyFire: boolean;
  allowBombDrop: boolean;
  spectateEnemiesAllowed: boolean;
  economy: SndEconomyConfig;
}

export const DEFAULT_SND_RULES: SndRules = {
  teamSize: 5,
  minPlayersPerTeam: 1,
  roundsPerHalf: 12,
  roundsToWin: 13,
  overtimeEnabled: true,
  overtimeHalfRounds: 3,
  overtimeWinMargin: 2,
  waitingDuration: 0.6,
  roundPrepDuration: 1.5,
  buyPhaseDuration: 10,
  allowPrepMove: false,
  roundDuration: 95,
  roundEndDuration: 3.6,
  intermissionDuration: 1.4,
  sideSwitchDuration: 2.8,
  plantDuration: 3.2,
  defuseDuration: 5.0,
  defuseKitDuration: 3.5,
  bombDetonationDuration: 35,
  interactRadius: 3.2,
  bombPickupRadius: 1.9,
  friendlyFire: false,
  allowBombDrop: true,
  spectateEnemiesAllowed: false,
  economy: {
    startMoney: 800,
    overtimeMoney: 10000,
    maxMoney: 16000,
    winElim: 3250,
    winObjective: 3500,
    lossBase: 1400,
    lossStep: 500,
    maxLossStreak: 4,
    plantBonus: 300,
    plantLossBonus: 800,
    defuseBonus: 300,
    armorCost: 650,
    helmetCost: 1000,
    defuseKitCost: 400,
    weaponCosts: {
      pistol: 0,
      smg: 1250,
      shotgun: 1500,
      ssg: 1850,
      rifle: 2700,
      m4: 3100,
      sniper: 4750,
    },
    killRewards: {
      knife: 1500,
      shotgun: 900,
      smg: 600,
      pistol: 300,
      rifle: 300,
      m4: 300,
      ssg: 300,
      sniper: 100,
    },
  },
};

export interface SndPlayerState {
  id: string;
  name: string;
  team: TeamId;
  isHuman: boolean;
  connected: boolean;
  alive: boolean;
  hp: number;
  armor: number;
  hasHelmet: boolean;
  hasDefuseKit: boolean;
  money: number;
  primaryWeapon: string | null;
  secondaryWeapon: string;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  plants: number;
  defuses: number;
  damageDealt: number;
  score: number;
  ping: number;
  pos: Vec3Like;
  damageContributors: Record<string, number>;
}

export interface SndBombInfo {
  state: BombState;
  site: 'A' | 'B' | null;
  carrierId: string | null;
  interactorId: string | null;
  pos: Vec3Like;
  progress: number; // 0..1 plant/defuse
  detonateTimer: number;
  detonateDuration: number;
}

export interface SndRoundSummary {
  round: number;
  winnerSide: TeamSide;
  winnerTeam: TeamId;
  reason: SndWinReason;
  bombPlanted: boolean;
  overtimeIndex: number;
}

export type SndEvent =
  | { type: 'phase_changed'; phase: SndPhase; round: number }
  | { type: 'round_started'; round: number; attackersTeam: TeamId }
  | { type: 'bomb_picked_up'; playerId: string }
  | { type: 'bomb_dropped'; playerId: string; pos: Vec3Like }
  | { type: 'plant_started'; playerId: string; site: 'A' | 'B' }
  | { type: 'plant_cancelled'; playerId: string }
  | { type: 'bomb_planted'; playerId: string; site: 'A' | 'B'; pos: Vec3Like }
  | { type: 'defuse_started'; playerId: string; withKit: boolean }
  | { type: 'defuse_cancelled'; playerId: string }
  | { type: 'bomb_defused'; playerId: string; site: 'A' | 'B' }
  | { type: 'bomb_detonated'; site: 'A' | 'B' }
  | { type: 'player_eliminated'; attackerId: string; victimId: string; assistId: string | null; weaponId: string; headshot: boolean }
  | { type: 'purchase_made'; playerId: string; item: string; cost: number }
  | { type: 'side_switched'; attackersTeam: TeamId }
  | { type: 'overtime_started'; overtimeIndex: number }
  | { type: 'round_ended'; summary: SndRoundSummary }
  | { type: 'match_ended'; winnerTeam: TeamId | null; scoreA: number; scoreB: number };

export interface SndMatchSnapshot {
  phase: SndPhase;
  phaseTimer: number;
  roundNumber: number;
  overtimeIndex: number;
  attackersTeam: TeamId;
  defendersTeam: TeamId;
  score: { teamA: number; teamB: number };
  lossStreak: { teamA: number; teamB: number };
  aliveCount: { attackers: number; defenders: number };
  bomb: SndBombInfo;
  lastRoundWinner: SndRoundSummary | null;
  winnerTeam: TeamId | null;
  movementLocked: boolean;
  canDamage: boolean;
  canBuy: boolean;
}

function distXZ(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export class SndMatchAuthority {
  public readonly rules: SndRules;
  public readonly sites: [SiteZone, SiteZone];
  public players = new Map<string, SndPlayerState>();

  public phase: SndPhase = 'waiting';
  public phaseTimer = 0;
  public roundNumber = 0;
  public overtimeIndex = 0;
  private otStartRound = 0;
  private otSwitchedThisSet = false;
  public halfSwitched = false;

  public attackersTeam: TeamId;
  public score: Record<TeamId, number> = { teamA: 0, teamB: 0 };
  public lossStreak: Record<TeamId, number> = { teamA: 0, teamB: 0 };
  public winnerTeam: TeamId | null = null;
  public lastRoundWinner: SndRoundSummary | null = null;
  public roundHistory: SndRoundSummary[] = [];

  public bomb: SndBombInfo = {
    state: 'not_carried',
    site: null,
    carrierId: null,
    interactorId: null,
    pos: { x: 0, y: 0, z: 0 },
    progress: 0,
    detonateTimer: 0,
    detonateDuration: 35,
  };
  private bombPlantedThisRound = false;
  private dropCooldowns = new Map<string, number>();

  public eventQueue: SndEvent[] = [];

  constructor(
    sites: [SiteZone, SiteZone],
    rules: Partial<SndRules> = {},
    initialAttackers: TeamId = 'teamA',
  ) {
    this.sites = sites;
    this.rules = {
      ...DEFAULT_SND_RULES,
      ...rules,
      economy: {
        ...DEFAULT_SND_RULES.economy,
        ...(rules.economy ?? {}),
        weaponCosts: {
          ...DEFAULT_SND_RULES.economy.weaponCosts,
          ...(rules.economy?.weaponCosts ?? {}),
        },
        killRewards: {
          ...DEFAULT_SND_RULES.economy.killRewards,
          ...(rules.economy?.killRewards ?? {}),
        },
      },
    };
    this.attackersTeam = initialAttackers;
    this.phaseTimer = this.rules.waitingDuration;
    this.bomb.detonateDuration = this.rules.bombDetonationDuration;
  }

  public get defendersTeam(): TeamId {
    return this.attackersTeam === 'teamA' ? 'teamB' : 'teamA';
  }

  public sideOfTeam(team: TeamId): TeamSide {
    return team === this.attackersTeam ? 'attackers' : 'defenders';
  }

  public sideOfPlayer(playerId: string): TeamSide | null {
    const p = this.players.get(playerId);
    return p ? this.sideOfTeam(p.team) : null;
  }

  public drainEvents(): SndEvent[] {
    if (this.eventQueue.length === 0) return [];
    const copy = this.eventQueue;
    this.eventQueue = [];
    return copy;
  }

  private emit(ev: SndEvent): void {
    this.eventQueue.push(ev);
  }

  private transitionPhase(next: SndPhase, timer: number): void {
    this.phase = next;
    this.phaseTimer = timer;
    this.emit({ type: 'phase_changed', phase: next, round: this.roundNumber });
  }

  // === Player & Team Management ===
  public addPlayer(id: string, name: string, preferredTeam?: TeamId, isHuman = false, ping = 12): SndPlayerState {
    const countA = this.getTeamPlayers('teamA').length;
    const countB = this.getTeamPlayers('teamB').length;
    let team: TeamId = preferredTeam ?? (countA <= countB ? 'teamA' : 'teamB');

    // Enforce team size & anti-stacking balance for bots/late additions
    if (this.getTeamPlayers(team).length >= this.rules.teamSize) {
      team = team === 'teamA' ? 'teamB' : 'teamA';
    }

    const p: SndPlayerState = {
      id,
      name,
      team,
      isHuman,
      connected: true,
      alive: this.phase === 'waiting' || this.phase === 'round_prep' || this.phase === 'buy_phase',
      hp: 100,
      armor: 0,
      hasHelmet: false,
      hasDefuseKit: false,
      money: this.overtimeIndex > 0 ? this.rules.economy.overtimeMoney : this.rules.economy.startMoney,
      primaryWeapon: null,
      secondaryWeapon: 'pistol',
      kills: 0,
      deaths: 0,
      assists: 0,
      headshots: 0,
      plants: 0,
      defuses: 0,
      damageDealt: 0,
      score: 0,
      ping,
      pos: { x: 0, y: 0, z: 0 },
      damageContributors: {},
    };
    this.players.set(id, p);
    return p;
  }

  public switchPlayerTeam(playerId: string, targetTeam: TeamId): boolean {
    const p = this.players.get(playerId);
    if (!p || p.team === targetTeam) return false;
    if (this.phase !== 'waiting' && this.phase !== 'round_prep') return false;
    const targetCount = this.getTeamPlayers(targetTeam).filter((x) => x.connected).length;
    const currentCount = this.getTeamPlayers(p.team).filter((x) => x.connected).length;
    if (targetCount >= this.rules.teamSize || targetCount > currentCount) return false;

    p.team = targetTeam;
    p.hasDefuseKit = false;
    return true;
  }

  public disconnectPlayer(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p || !p.connected) return;
    p.connected = false;
    if (this.phase === 'active' && p.alive) {
      this.handlePlayerInactiveInRound(p);
      this.resolveRoundIfNeeded();
    } else {
      p.alive = false;
    }
  }

  public reconnectPlayer(playerId: string): boolean {
    const p = this.players.get(playerId);
    if (!p) return false;
    p.connected = true;
    return true;
  }

  public getTeamPlayers(team: TeamId): SndPlayerState[] {
    return Array.from(this.players.values()).filter((p) => p.team === team);
  }

  public getSidePlayers(side: TeamSide): SndPlayerState[] {
    return this.getTeamPlayers(side === 'attackers' ? this.attackersTeam : this.defendersTeam);
  }

  private handlePlayerInactiveInRound(p: SndPlayerState): void {
    p.alive = false;
    if (this.bomb.carrierId === p.id && (this.bomb.state === 'carried' || this.bomb.state === 'planting')) {
      this.bomb.state = 'dropped';
      this.bomb.carrierId = null;
      this.bomb.interactorId = null;
      this.bomb.progress = 0;
      this.bomb.pos = { ...p.pos };
      this.emit({ type: 'bomb_dropped', playerId: p.id, pos: { ...p.pos } });
    } else if (this.bomb.interactorId === p.id) {
      if (this.bomb.state === 'planting') {
        this.bomb.state = 'dropped';
        this.bomb.carrierId = null;
        this.bomb.interactorId = null;
        this.bomb.progress = 0;
        this.bomb.pos = { ...p.pos };
        this.emit({ type: 'plant_cancelled', playerId: p.id });
        this.emit({ type: 'bomb_dropped', playerId: p.id, pos: { ...p.pos } });
      } else if (this.bomb.state === 'defusing') {
        this.bomb.state = 'planted';
        this.bomb.interactorId = null;
        this.bomb.progress = 0;
        this.emit({ type: 'defuse_cancelled', playerId: p.id });
      }
    }
  }

  // === Round Lifecycle Transitions ===
  public forceStartIfReady(): boolean {
    if (this.phase !== 'waiting') return false;
    const atk = this.getSidePlayers('attackers').filter((p) => p.connected).length;
    const def = this.getSidePlayers('defenders').filter((p) => p.connected).length;
    if (atk < this.rules.minPlayersPerTeam || def < this.rules.minPlayersPerTeam) return false;
    this.beginNextRound();
    return true;
  }

  private beginNextRound(): void {
    this.roundNumber += 1;
    this.bombPlantedThisRound = false;
    this.dropCooldowns.clear();

    for (const p of this.players.values()) {
      p.alive = p.connected;
      p.hp = 100;
      p.damageContributors = {};
      if (!p.alive) {
        p.primaryWeapon = null;
        p.armor = 0;
        p.hasHelmet = false;
        p.hasDefuseKit = false;
      }
      if (this.sideOfTeam(p.team) === 'attackers') {
        p.hasDefuseKit = false;
      }
    }

    // Assign bomb to random living connected attacker
    const livingAtk = this.getSidePlayers('attackers').filter((p) => p.alive);
    const carrier = livingAtk[Math.floor(Math.random() * livingAtk.length)] ?? null;
    this.bomb = {
      state: carrier ? 'carried' : 'not_carried',
      site: null,
      carrierId: carrier ? carrier.id : null,
      interactorId: null,
      pos: carrier ? { ...carrier.pos } : { x: 0, y: 0, z: 0 },
      progress: 0,
      detonateTimer: 0,
      detonateDuration: this.rules.bombDetonationDuration,
    };

    this.transitionPhase('round_prep', this.rules.roundPrepDuration);
    this.emit({ type: 'round_started', round: this.roundNumber, attackersTeam: this.attackersTeam });
  }

  public skipBuyPhase(): void {
    if (this.phase === 'buy_phase' && this.phaseTimer > 0.05) {
      this.phaseTimer = 0.05;
    }
  }

  // === Authoritative Economy Purchases ===
  public buyWeapon(playerId: string, weaponId: string): boolean {
    if (this.phase !== 'buy_phase') return false;
    const p = this.players.get(playerId);
    if (!p || !p.alive || !p.connected) return false;
    const cost = this.rules.economy.weaponCosts[weaponId];
    if (cost === undefined) return false;
    if (weaponId === 'pistol') {
      p.secondaryWeapon = 'pistol';
      return true;
    }
    if (p.primaryWeapon === weaponId) return false;
    if (p.money < cost) return false;

    p.money -= cost;
    p.primaryWeapon = weaponId;
    this.emit({ type: 'purchase_made', playerId, item: weaponId, cost });
    return true;
  }

  public buyArmor(playerId: string, withHelmet: boolean): boolean {
    if (this.phase !== 'buy_phase') return false;
    const p = this.players.get(playerId);
    if (!p || !p.alive || !p.connected) return false;
    const fullCost = withHelmet ? this.rules.economy.helmetCost : this.rules.economy.armorCost;
    const needed = p.armor >= 100 && (!withHelmet || p.hasHelmet);
    if (needed) return false;
    const actualCost = p.armor >= 100 && withHelmet && !p.hasHelmet
      ? Math.max(0, this.rules.economy.helmetCost - this.rules.economy.armorCost)
      : fullCost;
    if (p.money < actualCost) return false;

    p.money -= actualCost;
    p.armor = 100;
    if (withHelmet) p.hasHelmet = true;
    this.emit({ type: 'purchase_made', playerId, item: withHelmet ? 'helmet' : 'armor', cost: actualCost });
    return true;
  }

  public buyDefuseKit(playerId: string): boolean {
    if (this.phase !== 'buy_phase') return false;
    const p = this.players.get(playerId);
    if (!p || !p.alive || !p.connected || p.hasDefuseKit) return false;
    if (this.sideOfTeam(p.team) !== 'defenders') return false;
    const cost = this.rules.economy.defuseKitCost;
    if (p.money < cost) return false;

    p.money -= cost;
    p.hasDefuseKit = true;
    this.emit({ type: 'purchase_made', playerId, item: 'defuse_kit', cost });
    return true;
  }

  // === Authoritative Objective Interactions ===
  public updatePlayerPosition(playerId: string, pos: Vec3Like): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.pos = { ...pos };
    if (!p.alive || this.phase !== 'active') return;

    if (this.bomb.carrierId === playerId && this.bomb.state === 'carried') {
      this.bomb.pos = { ...pos };
    }

    // Cancel plant if planter leaves site radius
    if (this.bomb.state === 'planting' && this.bomb.interactorId === playerId) {
      const site = this.sites.find((s) => s.id === this.bomb.site);
      if (!site || distXZ(pos, site.pos) > Math.max(site.radius, this.rules.interactRadius)) {
        this.cancelPlant(playerId);
      }
    }

    // Cancel defuse if defuser walks out of reach
    if (this.bomb.state === 'defusing' && this.bomb.interactorId === playerId) {
      if (distXZ(pos, this.bomb.pos) > this.rules.interactRadius + 0.35) {
        this.cancelDefuse(playerId);
      }
    }

    // Auto-recover dropped bomb if living Attacker passes nearby
    if (
      this.bomb.state === 'dropped' &&
      this.sideOfTeam(p.team) === 'attackers' &&
      (this.dropCooldowns.get(playerId) ?? 0) <= 0 &&
      distXZ(pos, this.bomb.pos) <= this.rules.bombPickupRadius
    ) {
      this.bomb.state = 'carried';
      this.bomb.carrierId = playerId;
      this.bomb.pos = { ...pos };
      this.emit({ type: 'bomb_picked_up', playerId });
    }
  }

  public dropBomb(playerId: string): boolean {
    if (!this.rules.allowBombDrop || this.phase !== 'active') return false;
    const p = this.players.get(playerId);
    if (!p || !p.alive || this.bomb.state !== 'carried' || this.bomb.carrierId !== playerId) return false;
    this.bomb.state = 'dropped';
    this.bomb.carrierId = null;
    this.bomb.pos = { ...p.pos };
    this.dropCooldowns.set(playerId, 1.3);
    this.emit({ type: 'bomb_dropped', playerId, pos: { ...p.pos } });
    return true;
  }

  public getSiteAtPosition(pos: Vec3Like): SiteZone | null {
    for (const s of this.sites) {
      if (distXZ(pos, s.pos) <= s.radius) return s;
    }
    return null;
  }

  public startPlant(playerId: string): boolean {
    if (this.phase !== 'active') return false;
    const p = this.players.get(playerId);
    if (!p || !p.alive || !p.connected || this.sideOfTeam(p.team) !== 'attackers') return false;
    if (this.bomb.state !== 'carried' || this.bomb.carrierId !== playerId) return false;
    const site = this.getSiteAtPosition(p.pos);
    if (!site) return false;

    this.bomb.state = 'planting';
    this.bomb.site = site.id;
    this.bomb.interactorId = playerId;
    this.bomb.progress = 0;
    this.bomb.pos = { ...p.pos };
    this.emit({ type: 'plant_started', playerId, site: site.id });
    return true;
  }

  public cancelPlant(playerId: string): boolean {
    if (this.bomb.state !== 'planting' || this.bomb.interactorId !== playerId) return false;
    this.bomb.state = 'carried';
    this.bomb.site = null;
    this.bomb.interactorId = null;
    this.bomb.progress = 0;
    this.emit({ type: 'plant_cancelled', playerId });
    return true;
  }

  public startDefuse(playerId: string): boolean {
    if (this.phase !== 'active') return false;
    const p = this.players.get(playerId);
    if (!p || !p.alive || !p.connected || this.sideOfTeam(p.team) !== 'defenders') return false;
    if (this.bomb.state !== 'planted' || this.bomb.interactorId !== null) return false;
    if (distXZ(p.pos, this.bomb.pos) > this.rules.interactRadius) return false;

    this.bomb.state = 'defusing';
    this.bomb.interactorId = playerId;
    this.bomb.progress = 0;
    this.emit({ type: 'defuse_started', playerId, withKit: p.hasDefuseKit });
    return true;
  }

  public cancelDefuse(playerId: string): boolean {
    if (this.bomb.state !== 'defusing' || this.bomb.interactorId !== playerId) return false;
    this.bomb.state = 'planted';
    this.bomb.interactorId = null;
    this.bomb.progress = 0;
    this.emit({ type: 'defuse_cancelled', playerId });
    return true;
  }

  // === Authoritative Combat & Elimination ===
  public applyDamage(
    attackerId: string,
    victimId: string,
    rawDamage: number,
    isHeadshot: boolean,
    weaponId: string,
  ): { appliedDamage: number; killed: boolean } {
    if (this.phase !== 'active') return { appliedDamage: 0, killed: false };
    const atk = this.players.get(attackerId);
    const vic = this.players.get(victimId);
    if (!atk || !vic || !vic.alive || !vic.connected) return { appliedDamage: 0, killed: false };

    const sameTeam = atk.team === vic.team;
    if (sameTeam && attackerId !== victimId && !this.rules.friendlyFire) {
      return { appliedDamage: 0, killed: false };
    }

    let dmg = Math.max(1, rawDamage);
    if (vic.armor > 0) {
      if (isHeadshot && vic.hasHelmet) {
        const absorbed = Math.min(vic.armor, dmg * 0.2);
        vic.armor = Math.max(0, vic.armor - absorbed);
        dmg *= 0.8;
      } else if (!isHeadshot) {
        const absorbed = Math.min(vic.armor, dmg * 0.25);
        vic.armor = Math.max(0, vic.armor - absorbed);
        dmg *= 0.75;
      }
    }

    const appliedDamage = Math.min(vic.hp, Math.round(dmg));
    vic.hp = Math.max(0, vic.hp - dmg);

    if (!sameTeam) {
      atk.damageDealt += appliedDamage;
      vic.damageContributors[attackerId] = (vic.damageContributors[attackerId] ?? 0) + appliedDamage;
    }

    if (vic.hp > 0) return { appliedDamage, killed: false };

    // Victim eliminated!
    vic.hp = 0;
    vic.deaths += 1;
    vic.primaryWeapon = null;
    vic.armor = 0;
    vic.hasHelmet = false;
    vic.hasDefuseKit = false;

    let assistId: string | null = null;
    if (!sameTeam) {
      atk.kills += 1;
      atk.score += 2;
      if (isHeadshot) atk.headshots += 1;
      const killPay = this.rules.economy.killRewards[weaponId] ?? 300;
      atk.money = Math.min(this.rules.economy.maxMoney, atk.money + killPay);

      // Award highest-damage eligible teammate assist (>= 25 dmg)
      let bestAssistDmg = 24;
      for (const [cid, cdmg] of Object.entries(vic.damageContributors)) {
        if (cid !== attackerId && cdmg > bestAssistDmg) {
          const cand = this.players.get(cid);
          if (cand && cand.team === atk.team) {
            bestAssistDmg = cdmg;
            assistId = cid;
          }
        }
      }
      if (assistId) {
        const assister = this.players.get(assistId)!;
        assister.assists += 1;
        assister.score += 1;
      }
    } else if (attackerId !== victimId) {
      atk.score = Math.max(0, atk.score - 2);
    }

    this.handlePlayerInactiveInRound(vic);
    this.emit({
      type: 'player_eliminated',
      attackerId,
      victimId,
      assistId,
      weaponId,
      headshot: isHeadshot,
    });
    this.resolveRoundIfNeeded();
    return { appliedDamage, killed: true };
  }

  public getLivingSideCount(side: TeamSide): number {
    return this.getSidePlayers(side).filter((p) => p.alive && p.connected).length;
  }

  public resolveRoundIfNeeded(): boolean {
    if (this.phase !== 'active') return false;
    const atkAlive = this.getLivingSideCount('attackers');
    const defAlive = this.getLivingSideCount('defenders');
    const planted = this.bomb.state === 'planted' || this.bomb.state === 'defusing';

    if (atkAlive === 0 && defAlive === 0) {
      if (planted) this.endRound('attackers', 'defenders_eliminated');
      else this.endRound('defenders', 'attackers_eliminated');
      return true;
    }
    if (defAlive === 0) {
      this.endRound('attackers', 'defenders_eliminated');
      return true;
    }
    if (atkAlive === 0 && !planted) {
      this.endRound('defenders', 'attackers_eliminated');
      return true;
    }
    return false;
  }

  private endRound(winnerSide: TeamSide, reason: SndWinReason): void {
    if (this.phase !== 'active') return;
    const winnerTeam = winnerSide === 'attackers' ? this.attackersTeam : this.defendersTeam;
    const loserTeam = winnerTeam === 'teamA' ? 'teamB' : 'teamA';

    this.score[winnerTeam] += 1;
    this.lossStreak[winnerTeam] = 0;
    this.lossStreak[loserTeam] = Math.min(this.rules.economy.maxLossStreak, this.lossStreak[loserTeam] + 1);

    const winPay =
      reason === 'detonated' || reason === 'defused'
        ? this.rules.economy.winObjective
        : this.rules.economy.winElim;
    const lossPay =
      this.rules.economy.lossBase +
      Math.max(0, this.lossStreak[loserTeam] - 1) * this.rules.economy.lossStep;
    const plantBonusToLoserAtk =
      this.bombPlantedThisRound && this.sideOfTeam(loserTeam) === 'attackers'
        ? this.rules.economy.plantLossBonus
        : 0;

    for (const p of this.players.values()) {
      if (p.team === winnerTeam) {
        p.money = Math.min(this.rules.economy.maxMoney, p.money + winPay);
      } else {
        // CS rule: living Defenders who saved after time_expired? Still get regular loss or no save penalty here to keep flow fast
        p.money = Math.min(this.rules.economy.maxMoney, p.money + lossPay + plantBonusToLoserAtk);
      }
    }

    const summary: SndRoundSummary = {
      round: this.roundNumber,
      winnerSide,
      winnerTeam,
      reason,
      bombPlanted: this.bombPlantedThisRound,
      overtimeIndex: this.overtimeIndex,
    };
    this.lastRoundWinner = summary;
    this.roundHistory.push(summary);
    this.transitionPhase('round_end', this.rules.roundEndDuration);
    this.emit({ type: 'round_ended', summary });
  }

  // === Tick Loop ===
  public tick(dt: number): void {
    for (const [pid, rem] of this.dropCooldowns.entries()) {
      const next = rem - dt;
      if (next <= 0) this.dropCooldowns.delete(pid);
      else this.dropCooldowns.set(pid, next);
    }

    if (this.phase === 'waiting') {
      const atk = this.getSidePlayers('attackers').filter((p) => p.connected).length;
      const def = this.getSidePlayers('defenders').filter((p) => p.connected).length;
      if (atk >= this.rules.minPlayersPerTeam && def >= this.rules.minPlayersPerTeam) {
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          this.beginNextRound();
        }
      }
      return;
    }

    if (this.phase === 'round_prep') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.transitionPhase('buy_phase', this.rules.buyPhaseDuration);
      }
      return;
    }

    if (this.phase === 'buy_phase') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.transitionPhase('active', this.rules.roundDuration);
      }
      return;
    }

    if (this.phase === 'active') {
      // 1. Bomb fuse check BEFORE defuse completion on identical tick
      if (this.bomb.state === 'planted' || this.bomb.state === 'defusing') {
        this.bomb.detonateTimer -= dt;
        if (this.bomb.detonateTimer <= 0) {
          this.bomb.detonateTimer = 0;
          this.bomb.state = 'detonated';
          const site = this.bomb.site ?? 'A';
          this.bomb.interactorId = null;
          this.emit({ type: 'bomb_detonated', site });
          this.endRound('attackers', 'detonated');
          return;
        }
      }

      // 2. Defusal completion
      if (this.bomb.state === 'defusing' && this.bomb.interactorId) {
        const defuser = this.players.get(this.bomb.interactorId);
        if (!defuser || !defuser.alive || !defuser.connected) {
          this.bomb.state = 'planted';
          this.bomb.interactorId = null;
          this.bomb.progress = 0;
        } else {
          const dur = defuser.hasDefuseKit ? this.rules.defuseKitDuration : this.rules.defuseDuration;
          this.bomb.progress = Math.min(1, this.bomb.progress + dt / Math.max(0.1, dur));
          if (this.bomb.progress >= 1) {
            const site = this.bomb.site ?? 'A';
            const did = defuser.id;
            this.bomb.state = 'defused';
            this.bomb.interactorId = null;
            defuser.defuses += 1;
            defuser.score += 3;
            defuser.money = Math.min(this.rules.economy.maxMoney, defuser.money + this.rules.economy.defuseBonus);
            this.emit({ type: 'bomb_defused', playerId: did, site });
            this.endRound('defenders', 'defused');
            return;
          }
        }
      }

      // 3. Plant completion
      if (this.bomb.state === 'planting' && this.bomb.interactorId) {
        const planter = this.players.get(this.bomb.interactorId);
        if (!planter || !planter.alive || !planter.connected) {
          this.bomb.state = 'dropped';
          this.bomb.carrierId = null;
          this.bomb.interactorId = null;
          this.bomb.progress = 0;
        } else {
          this.bomb.progress = Math.min(1, this.bomb.progress + dt / Math.max(0.1, this.rules.plantDuration));
          if (this.bomb.progress >= 1) {
            const site = this.bomb.site ?? 'A';
            this.bomb.state = 'planted';
            this.bomb.carrierId = null;
            this.bomb.interactorId = null;
            this.bomb.progress = 1;
            this.bomb.detonateTimer = this.rules.bombDetonationDuration;
            this.bomb.pos = { ...planter.pos };
            this.bombPlantedThisRound = true;
            planter.plants += 1;
            planter.score += 2;
            planter.money = Math.min(this.rules.economy.maxMoney, planter.money + this.rules.economy.plantBonus);
            this.emit({ type: 'bomb_planted', playerId: planter.id, site, pos: { ...this.bomb.pos } });
          }
        }
      }

      // 4. Round clock check (ignored once bomb is planted)
      if (!this.bombPlantedThisRound) {
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          this.phaseTimer = 0;
          if (this.bomb.state === 'planting' && this.bomb.interactorId) {
            this.emit({ type: 'plant_cancelled', playerId: this.bomb.interactorId });
          }
          this.endRound('defenders', 'time_expired');
          return;
        }
      }
      return;
    }

    if (this.phase === 'round_end') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.evaluateMatchProgression();
      }
      return;
    }

    if (this.phase === 'side_switch' || this.phase === 'intermission') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.beginNextRound();
      }
      return;
    }
  }

  private performSideSwitch(resetEconomyAmount: number): void {
    this.attackersTeam = this.attackersTeam === 'teamA' ? 'teamB' : 'teamA';
    this.lossStreak = { teamA: 0, teamB: 0 };
    for (const p of this.players.values()) {
      p.money = resetEconomyAmount;
      p.primaryWeapon = null;
      p.secondaryWeapon = 'pistol';
      p.armor = 0;
      p.hasHelmet = false;
      p.hasDefuseKit = false;
    }
    this.emit({ type: 'side_switched', attackersTeam: this.attackersTeam });
  }

  private evaluateMatchProgression(): void {
    const a = this.score.teamA;
    const b = this.score.teamB;
    const regHalf = this.rules.roundsPerHalf;

    if (this.overtimeIndex === 0) {
      if (a >= this.rules.roundsToWin || b >= this.rules.roundsToWin) {
        if (a !== b) {
          this.winnerTeam = a > b ? 'teamA' : 'teamB';
          this.transitionPhase('match_end', 0);
          this.emit({ type: 'match_ended', winnerTeam: this.winnerTeam, scoreA: a, scoreB: b });
          return;
        }
      }
      if (a === regHalf && b === regHalf) {
        if (!this.rules.overtimeEnabled) {
          this.winnerTeam = null;
          this.transitionPhase('match_end', 0);
          this.emit({ type: 'match_ended', winnerTeam: null, scoreA: a, scoreB: b });
          return;
        }
        // Enter Overtime 1!
        this.overtimeIndex = 1;
        this.otStartRound = this.roundNumber;
        this.otSwitchedThisSet = false;
        this.performSideSwitch(this.rules.economy.overtimeMoney);
        this.emit({ type: 'overtime_started', overtimeIndex: 1 });
        this.transitionPhase('side_switch', this.rules.sideSwitchDuration);
        return;
      }
      if (!this.halfSwitched && this.roundNumber === regHalf) {
        this.halfSwitched = true;
        this.performSideSwitch(this.rules.economy.startMoney);
        this.transitionPhase('side_switch', this.rules.sideSwitchDuration);
        return;
      }
      this.transitionPhase('intermission', this.rules.intermissionDuration);
      return;
    }

    // Overtime evaluation (MR{overtimeHalfRounds} sets)
    const roundsInOtSet = this.roundNumber - this.otStartRound;
    const otSetCap = this.rules.overtimeHalfRounds * 2;
    const otNeedScore = regHalf + (this.overtimeIndex - 1) * this.rules.overtimeHalfRounds + this.rules.overtimeHalfRounds + 1;
    const leadDiff = Math.abs(a - b);

    if ((a >= otNeedScore || b >= otNeedScore) && leadDiff >= this.rules.overtimeWinMargin) {
      this.winnerTeam = a > b ? 'teamA' : 'teamB';
      this.transitionPhase('match_end', 0);
      this.emit({ type: 'match_ended', winnerTeam: this.winnerTeam, scoreA: a, scoreB: b });
      return;
    }

    if (roundsInOtSet >= otSetCap) {
      // Still tied / insufficient margin -> next Overtime!
      this.overtimeIndex += 1;
      this.otStartRound = this.roundNumber;
      this.otSwitchedThisSet = false;
      this.performSideSwitch(this.rules.economy.overtimeMoney);
      this.emit({ type: 'overtime_started', overtimeIndex: this.overtimeIndex });
      this.transitionPhase('side_switch', this.rules.sideSwitchDuration);
      return;
    }

    if (!this.otSwitchedThisSet && roundsInOtSet === this.rules.overtimeHalfRounds) {
      this.otSwitchedThisSet = true;
      this.performSideSwitch(this.rules.economy.overtimeMoney);
      this.transitionPhase('side_switch', this.rules.sideSwitchDuration);
      return;
    }

    this.transitionPhase('intermission', this.rules.intermissionDuration);
  }

  public getSnapshot(): SndMatchSnapshot {
    return {
      phase: this.phase,
      phaseTimer: this.phaseTimer,
      roundNumber: this.roundNumber,
      overtimeIndex: this.overtimeIndex,
      attackersTeam: this.attackersTeam,
      defendersTeam: this.defendersTeam,
      score: { ...this.score },
      lossStreak: { ...this.lossStreak },
      aliveCount: {
        attackers: this.getLivingSideCount('attackers'),
        defenders: this.getLivingSideCount('defenders'),
      },
      bomb: { ...this.bomb, pos: { ...this.bomb.pos } },
      lastRoundWinner: this.lastRoundWinner,
      winnerTeam: this.winnerTeam,
      movementLocked: (this.phase === 'round_prep' || this.phase === 'buy_phase') && !this.rules.allowPrepMove,
      canDamage: this.phase === 'active',
      canBuy: this.phase === 'buy_phase',
    };
  }
}
