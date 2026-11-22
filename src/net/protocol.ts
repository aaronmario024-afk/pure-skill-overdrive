export type MpMatchType = 'duel' | 'ffa' | 'coop';
export type MpMapMode = 'arena' | 'dm' | 'defend' | 'hvh' | 'range';

export interface MpLobbyRules {
  matchType: MpMatchType;
  mapMode: MpMapMode;
  botCount: number;
  durationSec: number;
  allowCheats: boolean;
  friendlyFire: boolean;
}

export interface MpLobbyMember {
  id: string;
  name: string;
  weaponId: string;
  skinId: string;
  ready: boolean;
  isHost: boolean;
  kills: number;
  deaths: number;
  headshots: number;
}

export interface MpChatItem {
  id: number;
  from: string;
  text: string;
  ts: number;
}

export interface MpLobbyState {
  code: string;
  hostId: string;
  inMatch: boolean;
  rules: MpLobbyRules;
  members: MpLobbyMember[];
  chat: MpChatItem[];
}

export interface MpMatchPlayerInit {
  id: string;
  name: string;
  weaponId: string;
  skinId: string;
  team: string;
  spawnIdx: number;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  headshots: number;
}

export interface MpMatchStartPayload {
  code: string;
  hostId: string;
  rules: MpLobbyRules;
  matchSeed: number;
  timeLeft: number;
  players: MpMatchPlayerInit[];
}

export interface MpVec3 {
  x: number;
  y: number;
  z: number;
}

export interface MpPeerState {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  weaponId: string;
  skinId: string;
  crouching: boolean;
  grounded: boolean;
  alive: boolean;
  hp: number;
  spinbot: boolean;
}

export interface MpPeerFire {
  id: string;
  from: MpVec3;
  to: MpVec3;
  weaponId: string;
  soundType: string;
  color: string;
  isMelee: boolean;
}

export interface MpScoreSummary {
  name: string;
  kills: number;
  deaths: number;
  headshots: number;
}

export interface MpDamageApplied {
  attackerId: string;
  targetId: string;
  damage: number;
  hp: number;
  isHead: boolean;
  weaponId: string;
  point?: MpVec3;
}

export interface MpPlayerKilled {
  attackerId: string;
  attackerName: string;
  targetId: string;
  targetName: string;
  weaponId: string;
  isHead: boolean;
  throughWall: boolean;
  point?: MpVec3;
  scores: Record<string, MpScoreSummary>;
}

export interface MpPlayerRespawn {
  targetId: string;
  spawnIdx: number;
  hp: number;
}

export interface MpBotSnapshot {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  bounty: 'normal' | 'green' | 'red' | 'gold' | 'rainbow' | 'admin';
  isCheaterBot: boolean;
  isAdmin: boolean;
  isDummy: boolean;
  spinVisual: boolean;
  onGround: boolean;
}

export interface MpGuestBotHit {
  attackerId: string;
  attackerName: string;
  botId: number;
  damage: number;
  isHead: boolean;
  weaponId: string;
  point?: MpVec3;
}

export interface MpBotKillEvent {
  killerId: string;
  killerName: string;
  botName: string;
  weaponId: string;
  isHead: boolean;
  scores: Record<string, MpScoreSummary>;
}

export interface MpMatchRanking {
  id: string;
  name: string;
  kills: number;
  deaths: number;
  headshots: number;
  isHost: boolean;
}

export interface MpMatchEndPayload {
  reason: string;
  rankings: MpMatchRanking[];
}

export interface MpPresenceEntry {
  online: boolean;
  inLobby: boolean;
  inMatch: boolean;
  lobbyCode: string | null;
  playerName: string;
}

export interface MpInviteNotice {
  fromName: string;
  code: string;
  matchType: MpMatchType;
  mapMode: MpMapMode;
}

export interface MpInfoResponse {
  port: number;
  lanUrls: string[];
  publicUrl?: string | null;
  isPublicHosted?: boolean;
  activeLobbies: number;
  connectedPlayers: number;
}
