export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type BotDifficultyId = 'easy' | 'normal' | 'hard' | 'expert';

export interface BotDifficultyConfig {
  id: BotDifficultyId;
  label: string;
  decisionInterval: number;
  sightRange: number;
  fovDeg: number;
  hearingMult: number;
  reactionTime: number;
  fireIntervalMult: number;
  aimErrorDeg: number;
  turnRateRadSec: number;
  memoryDuration: number;
  coordinationStrength: number;
  decisionNoise: number;
  moveSpeedMult: number;
}

export const BOT_DIFFICULTIES: Record<BotDifficultyId, BotDifficultyConfig> = {
  easy: {
    id: 'easy',
    label: 'Easy (Rekrut)',
    decisionInterval: 0.45,
    sightRange: 30,
    fovDeg: 88,
    hearingMult: 0.65,
    reactionTime: 0.62,
    fireIntervalMult: 1.35,
    aimErrorDeg: 6.2,
    turnRateRadSec: 6.5,
    memoryDuration: 4.5,
    coordinationStrength: 0.55,
    decisionNoise: 0.08,
    moveSpeedMult: 0.92,
  },
  normal: {
    id: 'normal',
    label: 'Normal (Standard)',
    decisionInterval: 0.3,
    sightRange: 36,
    fovDeg: 102,
    hearingMult: 0.9,
    reactionTime: 0.42,
    fireIntervalMult: 1.05,
    aimErrorDeg: 3.6,
    turnRateRadSec: 9.0,
    memoryDuration: 6.5,
    coordinationStrength: 0.85,
    decisionNoise: 0.04,
    moveSpeedMult: 1.0,
  },
  hard: {
    id: 'hard',
    label: 'Hard (Vorgerückt)',
    decisionInterval: 0.22,
    sightRange: 40,
    fovDeg: 112,
    hearingMult: 1.15,
    reactionTime: 0.3,
    fireIntervalMult: 0.88,
    aimErrorDeg: 2.1,
    turnRateRadSec: 12.0,
    memoryDuration: 8.0,
    coordinationStrength: 1.0,
    decisionNoise: 0.02,
    moveSpeedMult: 1.04,
  },
  expert: {
    id: 'expert',
    label: 'Expert (Taktisch)',
    decisionInterval: 0.16,
    sightRange: 44,
    fovDeg: 122,
    hearingMult: 1.3,
    reactionTime: 0.22,
    fireIntervalMult: 0.78,
    aimErrorDeg: 1.2,
    turnRateRadSec: 15.0,
    memoryDuration: 9.5,
    coordinationStrength: 1.1,
    decisionNoise: 0.01,
    moveSpeedMult: 1.08,
  },
};

export type BotProfileId = 'balanced' | 'aggressive' | 'defensive' | 'supportive' | 'adaptive';

export interface BotProfileConfig {
  id: BotProfileId;
  label: string;
  aggression: number; // pushes, flanks, engages
  caution: number; // holds angles, retreats low HP
  objectiveBias: number; // site play, bomb/defuse focus
  teamCohesion: number; // stays near mates / escorts
  speedMult: number;
  flankPreference: number;
}

export const BOT_PROFILES: Record<BotProfileId, BotProfileConfig> = {
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    aggression: 1.0,
    caution: 1.0,
    objectiveBias: 1.0,
    teamCohesion: 1.0,
    speedMult: 1.0,
    flankPreference: 1.0,
  },
  aggressive: {
    id: 'aggressive',
    label: 'Aggressive',
    aggression: 1.28,
    caution: 0.72,
    objectiveBias: 0.96,
    teamCohesion: 0.82,
    speedMult: 1.06,
    flankPreference: 1.22,
  },
  defensive: {
    id: 'defensive',
    label: 'Defensive',
    aggression: 0.76,
    caution: 1.32,
    objectiveBias: 1.05,
    teamCohesion: 1.1,
    speedMult: 0.95,
    flankPreference: 0.85,
  },
  supportive: {
    id: 'supportive',
    label: 'Supportive',
    aggression: 0.88,
    caution: 1.05,
    objectiveBias: 1.2,
    teamCohesion: 1.35,
    speedMult: 0.98,
    flankPreference: 0.92,
  },
  adaptive: {
    id: 'adaptive',
    label: 'Adaptive',
    aggression: 1.05,
    caution: 1.05,
    objectiveBias: 1.12,
    teamCohesion: 1.12,
    speedMult: 1.02,
    flankPreference: 1.12,
  },
};

export type BotActionId =
  | 'hold_wait'
  | 'patrol_route'
  | 'engage_threat'
  | 'investigate_sound'
  | 'retreat_cover'
  | 'attack_site'
  | 'plant_bomb'
  | 'escort_carrier'
  | 'recover_bomb'
  | 'defend_planted'
  | 'defend_site'
  | 'rotate_site'
  | 'retake_site'
  | 'defuse_bomb'
  | 'support_teammate'
  | 'rush_site';

export type BotRole =
  | 'entry'
  | 'carrier'
  | 'escort'
  | 'lurk'
  | 'anchor_a'
  | 'anchor_b'
  | 'rotator_mid'
  | 'defuser'
  | 'planter'
  | 'roamer'
  | 'duelist'
  | 'hunter';

export type StuckClass =
  | 'none'
  | 'stationary_intentional'
  | 'waiting_teammate'
  | 'holding_position'
  | 'blocked_obstacle'
  | 'blocked_teammate'
  | 'nav_failed'
  | 'invalid_destination';

export type PathStatus = 'idle' | 'ok' | 'partial' | 'failed' | 'arrived';

export interface SoundEvent {
  id: string;
  sourceId: string;
  team: string;
  kind: 'gunshot' | 'footstep' | 'bomb_plant' | 'bomb_defuse' | 'bomb_beep';
  pos: Vec3;
  radius: number;
  time: number;
}

export interface ObjectiveInfo {
  id: string;
  kind: 'site_a' | 'site_b' | 'bomb_dropped' | 'bomb_planted' | 'defend_site' | 'ffa_arena' | 'duel_target';
  pos: Vec3;
  radius: number;
  active: boolean;
  contested: boolean;
  requiresInteraction: boolean;
  progress: number;
  site?: 'A' | 'B';
}

export interface PerceivedThreat {
  actorId: string;
  pos: Vec3;
  eyePos: Vec3;
  vel: Vec3;
  distance: number;
  lastSeenAt: number;
  visible: boolean;
  fromSound: boolean;
  confidence: number;
  isHuman: boolean;
}

export interface WorldQueryApi {
  hasLineOfSight(from: Vec3, to: Vec3): boolean;
  getTime(): number;
}

export interface ScoredAction {
  action: BotActionId;
  utility: number;
  destination: Vec3 | null;
  lookTarget: Vec3 | null;
  stopDistance: number;
  urgent?: boolean;
  reason: string;
}

export interface BotDebugSnapshot {
  id: string;
  name: string;
  team: string;
  side: string;
  profile: BotProfileId;
  difficulty: BotDifficultyId;
  role: BotRole;
  action: BotActionId;
  priority: number;
  objectiveId: string;
  destination: Vec3 | null;
  pathPoints: Vec3[];
  pathIndex: number;
  pathStatus: PathStatus;
  pos: Vec3;
  vel: Vec3;
  speed: number;
  stuckClass: StuckClass;
  recoveryLevel: number;
  lastRecovery: string;
  lastTransitionReason: string;
  visibleEnemyCount: number;
  heardEnemyCount: number;
  hp: number;
  alive: boolean;
}

export interface BotStepCommand {
  nextPos: Vec3;
  targetYaw: number;
  turnRateRadSec: number;
  shouldFire: boolean;
  aimPoint: Vec3 | null;
  targetActorId: string | null;
  wantsPlant: boolean;
  wantsDefuse: boolean;
  isSpinVisual: boolean;
  isBunnyHop: boolean;
  debug: BotDebugSnapshot;
}

export interface AiCombatantInput {
  id: string;
  name: string;
  team: string;
  side: 'attackers' | 'defenders' | 'ffa';
  isHuman: boolean;
  alive: boolean;
  hp: number;
  maxHp: number;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  hasBomb?: boolean;
  hasDefuseKit?: boolean;
  weaponRange?: number;
  fireInterval?: number;
  damage?: number;
  isAdmin?: boolean;
  isCheater?: boolean;
  isRainbow?: boolean;
  freezeUntil?: number;
}
