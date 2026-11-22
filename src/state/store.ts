import { ART_STYLES, ArtStyleId, BALANCE, prestigeCostCents } from '../data/balance';
import { BOT_FARM_RIGS, CHEATS, CheatCategoryId, CheatNodeDef, getCheatDef } from '../data/cheats';
import { getMode, ModeId } from '../data/modes';
import { CASES, CaseDef, getCase, migrateSkinId, RARITY_META, RARITY_ORDER, SkinRarity, SKINS, WeaponSkin } from '../data/skins';
import { getWeaponDef, WEAPONS } from '../data/weapons';
import { BotDifficultyId } from '../game/ai/types';
import {
  detectMatchingPreset,
  GraphicsPresetId,
  GraphicsSettings,
  mergeGraphicsSettings,
  resolveGraphicsPreset,
} from '../game/graphicsSettings';
import { SndMapId } from '../game/sndMaps';
import { AudioOutputMode, sfx } from '../audio/sfx';

export type { BotDifficultyId };

export interface SndLobbyConfig {
  mapId: SndMapId;
  roundsPerHalf: number;
  teamSize: number;
  overtimeEnabled: boolean;
  friendlyFire: boolean;
  buyPhaseDuration: number;
  roundDuration: number;
  startingSide: 'attackers' | 'defenders' | 'random';
}

export interface CheatSaveState {
  owned: boolean;
  enabled: boolean;
  boughtNodes: string[];
  tunes: Record<string, string>;
}

export interface FriendEntry {
  name: string;
  addedAt: number;
}

export interface CrosshairConfig {
  color: string;
  length: number;
  thickness: number;
  gap: number;
  dot: boolean;
  outline: boolean;
  dynamic: boolean;
}

export interface SettingsData {
  sensitivity: number;
  fov: number;
  masterVol: number;
  weaponsVol: number;
  movementVol: number;
  environmentVol: number;
  sfxVol: number;
  objectivesVol: number;
  uiVol: number;
  voiceVol: number;
  musicVol: number;
  audioOutputMode: AudioOutputMode;
  artStyle: ArtStyleId;
  enemyOutlines: boolean;
  outlineColor: string;
  botDifficulty: BotDifficultyId;
  aiDebugOverlay: boolean;
  graphics: GraphicsSettings;
  crosshair: CrosshairConfig;
}

export interface MatchPayLine {
  label: string;
  amount: number;
  color: string;
}

export interface MatchResult {
  modeId: ModeId;
  reason: 'timeup' | 'disconnect' | 'banned' | 'kicked' | 'held' | 'lost' | 'snd_win' | 'snd_loss';
  duration: number;
  kills: number;
  deaths: number;
  headshots: number;
  maxStreak: number;
  place: number;
  players: number;
  won: boolean;
  creditsEarned: number;
  bankPay: number;
  winBonus: number;
  roundBonus: number;
  roundsHeld: number;
  roundsLost: number;
  adminsKilled: number;
  casesDropped: string[];
  breakdown: MatchPayLine[];
  peakHeat: number;
}

export interface SaveData {
  version: number;
  savedAt: number;
  playerName: string;
  friends: FriendEntry[];
  credits: number;
  lifetimeEarned: number;
  runEarned: number;
  totalKills: number;
  totalDeaths: number;
  totalHeadshots: number;
  matchesPlayed: number;
  selectedMode: ModeId;
  unlockedModes: ModeId[];
  ownedWeapons: string[];
  equippedPrimary: string;
  ownedSkins: string[];
  equippedSkins: Record<string, string>;
  caseStock: Record<string, number>;
  casesOpened: number;
  casesSinceLegendary: number;
  recentDrops: string[];
  cheats: Record<string, CheatSaveState>;
  botFarmRigs: Record<string, number>;
  botFarmEarned: number;
  prestigeLevel: number;
  totalBans: number;
  trustFactor: number; // 0..100
  lastMatch: MatchResult | null;
  devInfinite: boolean;
  sndConfig: SndLobbyConfig;
  settings: SettingsData;
}

export interface ActiveCheatMods {
  // Hitbox
  hitboxOn: boolean;
  headScale: number;
  headBalloon: boolean;
  headBoxColor: string;
  headDamageMult: number;
  fullBodyHead: boolean;
  headshotPayMult: number;
  headStreakStep: number;
  headStreakCap: number;

  // No Recoil
  recoilMult: number;
  spreadMult: number;
  longshotPayMult: number;

  // Wallhack
  wallhackOn: boolean;
  espBoxes: boolean;
  chams: boolean;
  greenChance: number;
  redChance: number;
  goldChance: number;
  rainbowOn: boolean;
  wallbangTier: 0 | 1 | 2 | 3; // 0=none, 1=thin, 2=crate, 3=all
  wallbangMaxWalls: number;
  wallbangDamage: number;
  wallbangPayMult: number;

  // Bunnyhop
  bhopOn: boolean;
  bhopTopSpeed: number;
  bhopAirStrafe: boolean;
  bhopMoonhop: boolean;
  bhopPayPerHop: number;
  bhopChainCap: number;
  bhopDodge: number;

  // Speedhack
  speedMult: number;
  killDash: boolean;
  killBlink: boolean;
  sprintDodge: number;
  momentumPay: boolean;

  // Bypass / Anti-Cheat
  heatMult: number;
  voteKickBlocker: boolean;
  hwidSpoofCharges: number;
  adminJammer: boolean;

  // Triggerbot
  triggerOn: boolean;
  triggerDelay: number;
  triggerRapidTap: number;
  triggerHeadOnly: boolean;
  triggerAutoReload: boolean;
  triggerCleanPay: number;
  triggerXray: boolean;

  // Ammo + Piggy Bank
  magMult: number;
  infiniteAmmo: boolean;
  piggyOn: boolean;
  piggyHitMult: number;
  piggyGold: boolean;
  piggyInterest: number;
  piggyStorm: boolean;

  // Aimbot + Volley
  aimbotOn: boolean;
  aimbotFovDeg: number;
  aimbotSnap: number; // 0..1 lerp rate
  aimbotRing: boolean;
  aimbotBountyPrio: boolean;
  aimbotWallLock: boolean;
  volleyCount: number; // 0=off, 3, or 99=all
  volleyCooldown: number;

  // Spinbot
  spinbotOn: boolean;
  spinbotDodge: number;
  spinbotAuto360: boolean;
  spinbotResolver: boolean;

  // Backtrack
  backtrackOn: boolean;
  backtrackWindow: number;
  backtrackFreezePeek: boolean;
  backtrackChronoBlast: boolean;

  // Rage
  damageMult: number;
  oneTapHead: boolean;
  explodeOnKill: boolean;
  blastRadius: number;
  blastDamageMult: number;
  fireRateMult: number;
  forceAuto: boolean;

  // Heat per blatant kill
  baseHeatPerKill: number;
}

export interface CaseDropResult {
  caseId: string;
  skin: WeaponSkin;
  duplicate: boolean;
  refund: number;
}

const STORAGE_PREFIX = 'pureskill_overdrive_slot_';
const ACTIVE_SLOT_KEY = 'pureskill_overdrive_active_slot';

export function createDefaultSave(): SaveData {
  const cheats: Record<string, CheatSaveState> = {};
  for (const c of CHEATS) {
    const tunes: Record<string, string> = {};
    for (const t of c.tunes) tunes[t.id] = t.defaultValue;
    cheats[c.id] = { owned: false, enabled: true, boughtNodes: [], tunes };
  }
  return {
    version: 1,
    savedAt: Date.now(),
    playerName: `Player_${1000 + Math.floor(Math.random() * 9000)}`,
    friends: [],
    credits: BALANCE.startingCredits,
    lifetimeEarned: 0,
    runEarned: 0,
    totalKills: 0,
    totalDeaths: 0,
    totalHeadshots: 0,
    matchesPlayed: 0,
    selectedMode: 'arena',
    unlockedModes: ['range', 'arena', 'snd'],
    ownedWeapons: ['pistol', 'knife'],
    equippedPrimary: 'pistol',
    ownedSkins: [],
    equippedSkins: {},
    caseStock: { basic: 1, neon: 0, overdrive: 0 }, // 1 free welcome crate!
    casesOpened: 0,
    casesSinceLegendary: 0,
    recentDrops: [],
    cheats,
    botFarmRigs: {},
    botFarmEarned: 0,
    prestigeLevel: 0,
    totalBans: 0,
    trustFactor: 100,
    lastMatch: null,
    devInfinite: false,
    sndConfig: {
      mapId: 'district9',
      roundsPerHalf: 12,
      teamSize: 5,
      overtimeEnabled: true,
      friendlyFire: false,
      buyPhaseDuration: 10,
      roundDuration: 95,
      startingSide: 'attackers',
    },
    settings: {
      sensitivity: 0.0022,
      fov: 82,
      masterVol: 0.65,
      weaponsVol: 0.90,
      movementVol: 0.85,
      environmentVol: 0.80,
      sfxVol: 0.85,
      objectivesVol: 0.90,
      uiVol: 0.8,
      voiceVol: 0.85,
      musicVol: 0.65,
      audioOutputMode: 'headphones',
      artStyle: 'clean',
      enemyOutlines: true,
      outlineColor: '#ff3b3b',
      botDifficulty: 'normal',
      aiDebugOverlay: false,
      graphics: resolveGraphicsPreset('high'),
      crosshair: {
        color: '#4ade80',
        length: 7,
        thickness: 2,
        gap: 4,
        dot: true,
        outline: true,
        dynamic: true,
      },
    },
  };
}

class GameStore {
  public slot = 0;
  public data: SaveData;
  private listeners = new Set<() => void>();
  private lastFarmTick = performance.now();

  private getStorage(): Storage | null {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  }

  constructor() {
    const savedSlot = Number(this.getStorage()?.getItem(ACTIVE_SLOT_KEY) || '0');
    this.slot = Number.isFinite(savedSlot) ? Math.max(0, Math.min(2, savedSlot)) : 0;
    this.data = this.loadSlot(this.slot);
    this.syncAudio();
  }

  public subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  public notify(): void {
    this.data.savedAt = Date.now();
    this.save();
    for (const fn of this.listeners) fn();
  }

  public loadSlot(slot: number): SaveData {
    this.slot = slot;
    this.getStorage()?.setItem(ACTIVE_SLOT_KEY, String(slot));
    try {
      const raw = this.getStorage()?.getItem(`${STORAGE_PREFIX}${slot}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SaveData>;
        const def = createDefaultSave();
        const merged: SaveData = {
          ...def,
          ...parsed,
          playerName:
            typeof parsed.playerName === 'string' && parsed.playerName.trim().length >= 2
              ? parsed.playerName.trim().slice(0, 18)
              : def.playerName,
          friends: Array.isArray(parsed.friends)
            ? parsed.friends.filter((f): f is FriendEntry => Boolean(f && typeof f.name === 'string' && f.name.trim()))
            : [],
          ownedSkins: Array.from(new Set((parsed.ownedSkins ?? []).map(migrateSkinId))),
          equippedSkins: Object.fromEntries(
            Object.entries(parsed.equippedSkins ?? {}).map(([w, s]) => [w, migrateSkinId(s)]),
          ),
          recentDrops: (parsed.recentDrops ?? []).map(migrateSkinId),
          unlockedModes: Array.from(new Set([...(parsed.unlockedModes ?? def.unlockedModes), 'snd'])),
          sndConfig: { ...def.sndConfig, ...(parsed.sndConfig ?? {}) },
          settings: {
            ...def.settings,
            ...(parsed.settings ?? {}),
            graphics: mergeGraphicsSettings(parsed.settings?.graphics),
            crosshair: { ...def.settings.crosshair, ...(parsed.settings?.crosshair ?? {}) },
          },
          caseStock: { ...def.caseStock, ...(parsed.caseStock ?? {}) },
          cheats: { ...def.cheats },
        };
        if (parsed.cheats) {
          for (const c of CHEATS) {
            if (parsed.cheats[c.id]) {
              merged.cheats[c.id] = {
                ...def.cheats[c.id],
                ...parsed.cheats[c.id],
                tunes: { ...def.cheats[c.id].tunes, ...(parsed.cheats[c.id].tunes ?? {}) },
              };
            }
          }
        }
        // Offline Bot-Farm catchup (up to 4 hours)
        const elapsedSec = Math.min(4 * 3600, Math.max(0, (Date.now() - (merged.savedAt || Date.now())) / 1000));
        this.data = merged;
        const rate = this.getBotFarmRatePerSec();
        if (rate > 0 && elapsedSec > 3) {
          const offlineGain = Math.round(rate * elapsedSec * 0.5);
          if (offlineGain > 0) {
            this.data.credits += offlineGain;
            this.data.lifetimeEarned += offlineGain;
            this.data.runEarned += offlineGain;
            this.data.botFarmEarned += offlineGain;
          }
        }
        this.syncAudio();
        return this.data;
      }
    } catch {
      // ignore corrupted slot
    }
    this.data = createDefaultSave();
    this.syncAudio();
    return this.data;
  }

  public save(): void {
    try {
      this.getStorage()?.setItem(`${STORAGE_PREFIX}${this.slot}`, JSON.stringify(this.data));
    } catch {
      // ignore quota error
    }
  }

  public getSlotSummary(slot: number): { exists: boolean; credits: number; kills: number; prestige: number } {
    try {
      const raw = this.getStorage()?.getItem(`${STORAGE_PREFIX}${slot}`);
      if (!raw) return { exists: false, credits: 0, kills: 0, prestige: 0 };
      const d = JSON.parse(raw) as SaveData;
      return { exists: true, credits: d.credits || 0, kills: d.totalKills || 0, prestige: d.prestigeLevel || 0 };
    } catch {
      return { exists: false, credits: 0, kills: 0, prestige: 0 };
    }
  }

  public resetCurrentSlot(): void {
    this.data = createDefaultSave();
    this.syncAudio();
    this.notify();
  }

  public syncAudio(): void {
    sfx.applySettings({
      masterVol: this.data.settings.masterVol,
      weaponsVol: this.data.settings.weaponsVol,
      movementVol: this.data.settings.movementVol,
      environmentVol: this.data.settings.environmentVol,
      sfxVol: this.data.settings.sfxVol,
      objectivesVol: this.data.settings.objectivesVol,
      uiVol: this.data.settings.uiVol,
      voiceVol: this.data.settings.voiceVol,
      musicVol: this.data.settings.musicVol,
      audioOutputMode: this.data.settings.audioOutputMode,
    });
  }

  // Economy
  public getPrestigeMultiplier(): number {
    return 1 + this.data.prestigeLevel * BALANCE.prestigeBonusPerLevel;
  }

  public canAfford(cost: number): boolean {
    return this.data.devInfinite || this.data.credits >= cost;
  }

  public spend(cost: number): boolean {
    if (!this.canAfford(cost)) {
      sfx.playUi('deny');
      return false;
    }
    if (!this.data.devInfinite) {
      this.data.credits = Math.max(0, this.data.credits - cost);
    }
    sfx.playUi('buy');
    this.notify();
    return true;
  }

  public addCredits(cents: number, silent = false): void {
    const val = Math.max(0, Math.round(cents));
    if (val <= 0) return;
    this.data.credits += val;
    this.data.lifetimeEarned += val;
    this.data.runEarned += val;
    if (!silent) this.notify();
  }

  // Cheats
  public ownsCheat(id: CheatCategoryId): boolean {
    return !!this.data.cheats[id]?.owned;
  }

  public isCheatEnabled(id: CheatCategoryId): boolean {
    const st = this.data.cheats[id];
    return !!st?.owned && !!st?.enabled;
  }

  public hasNode(cheatId: CheatCategoryId, nodeId: string): boolean {
    return !!this.data.cheats[cheatId]?.boughtNodes.includes(nodeId);
  }

  public isNodeUnlocked(node: CheatNodeDef): boolean {
    if (!this.ownsCheat(node.cheatId)) return false;
    if (node.requires) {
      if (node.requires.includes(':')) {
        const [cid, nid] = node.requires.split(':') as [CheatCategoryId, string];
        if (!this.hasNode(cid, nid)) return false;
      } else if (!this.hasNode(node.cheatId, node.requires)) {
        return false;
      }
    }
    if (node.synergyWith) {
      if (node.synergyWith.includes(':')) {
        const [cid, nid] = node.synergyWith.split(':') as [CheatCategoryId, string];
        if (!this.hasNode(cid, nid)) return false;
      } else if (!this.ownsCheat(node.synergyWith as CheatCategoryId)) {
        return false;
      }
    }
    return true;
  }

  public buyCheatLicense(id: CheatCategoryId): boolean {
    if (this.ownsCheat(id)) return false;
    const def = getCheatDef(id);
    if (!this.spend(def.licenseCost)) return false;
    this.data.cheats[id].owned = true;
    this.data.cheats[id].enabled = true;
    this.notify();
    return true;
  }

  public buyCheatNode(cheatId: CheatCategoryId, nodeId: string): boolean {
    const def = getCheatDef(cheatId);
    const node = def.nodes.find((n) => n.id === nodeId);
    if (!node || this.hasNode(cheatId, nodeId) || !this.isNodeUnlocked(node)) return false;
    if (!this.spend(node.cost)) return false;
    this.data.cheats[cheatId].boughtNodes.push(nodeId);
    this.notify();
    return true;
  }

  public setCheatEnabled(id: CheatCategoryId, enabled: boolean): void {
    if (!this.ownsCheat(id)) return;
    this.data.cheats[id].enabled = enabled;
    sfx.playUi('click');
    this.notify();
  }

  public setCheatTune(id: CheatCategoryId, tuneId: string, val: string): void {
    if (!this.data.cheats[id]) return;
    this.data.cheats[id].tunes[tuneId] = val;
    sfx.playUi('click');
    this.notify();
  }

  public applyLoaderPreset(preset: 'off' | 'legit' | 'rage'): void {
    const legitSet = new Set<CheatCategoryId>(['hitbox', 'norecoil', 'wallhack', 'bypass', 'bunnyhop']);
    for (const c of CHEATS) {
      const st = this.data.cheats[c.id];
      if (!st?.owned) continue;
      if (preset === 'off') st.enabled = false;
      else if (preset === 'rage') st.enabled = true;
      else {
        st.enabled = legitSet.has(c.id);
        if (c.id === 'aimbot') {
          st.enabled = true;
          st.tunes.mode = 'legit';
        }
      }
    }
    sfx.playUi('click');
    this.notify();
  }

  public computeActiveMods(): ActiveCheatMods {
    const on = (id: CheatCategoryId) => this.isCheatEnabled(id);
    const has = (id: CheatCategoryId, n: string) => on(id) && this.hasNode(id, n);
    const tune = (id: CheatCategoryId, t: string, fallback: string) => this.data.cheats[id]?.tunes[t] ?? fallback;

    // Hitbox
    const hitboxOn = on('hitbox');
    const headScale = !hitboxOn ? 1.0 : has('hitbox', 'headsize2') ? 2.8 : has('hitbox', 'headsize') ? 2.1 : 1.6;
    const headStreakCap = !hitboxOn
      ? 1
      : has('hitbox', 'streakcap3')
        ? 12
        : has('hitbox', 'streakcap2')
          ? 6
          : has('hitbox', 'streakcap')
            ? 3
            : 2;

    // Wallhack
    const wallhackOn = on('wallhack');
    const wallbangTier: 0 | 1 | 2 | 3 = !wallhackOn
      ? 0
      : has('wallhack', 'allwalls')
        ? 3
        : has('wallhack', 'thickwalls')
          ? 2
          : has('wallhack', 'wallbang')
            ? 1
            : 0;

    // Aimbot
    const aimbotOn = on('aimbot');
    const aimbotMode = tune('aimbot', 'mode', 'legit');
    const aimbotFovDeg = !aimbotOn ? 0 : has('aimbot', 'fullscreen') ? 180 : has('aimbot', 'fov') ? 42 : 18;
    const aimbotSnap = !aimbotOn ? 0 : aimbotMode === 'rage' || has('aimbot', 'snap') ? 1.0 : 0.22;

    // Heat calculation
    let baseHeat = 0;
    for (const c of CHEATS) {
      if (on(c.id) && c.heatPerKill > 0) baseHeat += c.heatPerKill;
    }
    const heatMult = has('bypass', 'smooth') ? 0.35 : on('bypass') ? 0.65 : 1.0;

    return {
      hitboxOn,
      headScale,
      headBalloon: hitboxOn && tune('hitbox', 'look', 'box') === 'balloon',
      headBoxColor: tune('hitbox', 'color', '#ef4444'),
      headDamageMult: has('hitbox', 'headdmg') ? 1.35 : 1.0,
      fullBodyHead: has('hitbox', 'fullbody'),
      headshotPayMult: has('hitbox', 'hsbonus') ? 1.5 : 1.0,
      headStreakStep: !hitboxOn ? 0 : has('hitbox', 'streakstep') ? 0.25 : 0.15,
      headStreakCap,

      recoilMult: has('norecoil', 'recoil') ? 0.0 : on('norecoil') ? 0.45 : 1.0,
      spreadMult: has('norecoil', 'nospread') ? 0.0 : on('norecoil') ? 0.55 : 1.0,
      longshotPayMult: has('norecoil', 'longshot') ? 2.5 : 1.0,

      wallhackOn,
      espBoxes: wallhackOn && tune('wallhack', 'boxes', '1') === '1',
      chams: wallhackOn && tune('wallhack', 'chams', '1') === '1',
      greenChance: !wallhackOn ? 0 : has('wallhack', 'greenrate') ? 0.38 : 0.18,
      redChance: !wallhackOn ? 0 : has('wallhack', 'redrate') ? 0.24 : 0.08,
      goldChance: !wallhackOn ? 0 : has('wallhack', 'goldrate') ? 0.15 : has('wallhack', 'gold') ? 0.05 : 0,
      rainbowOn: has('wallhack', 'rainbow'),
      wallbangTier,
      wallbangMaxWalls: wallbangTier === 3 ? 3 : wallbangTier >= 1 ? 1 : 0,
      wallbangDamage: has('wallhack', 'damage') ? 1.0 : 0.6,
      wallbangPayMult: has('wallhack', 'wallpay') ? 2.5 : 1.0,

      bhopOn: on('bunnyhop'),
      bhopTopSpeed: has('bunnyhop', 'moonhop') ? 3.2 : has('bunnyhop', 'topspeed') ? 2.4 : 1.6,
      bhopAirStrafe: has('bunnyhop', 'airstrafe'),
      bhopMoonhop: has('bunnyhop', 'moonhop'),
      bhopPayPerHop: has('bunnyhop', 'hoppay') ? 0.25 : 0,
      bhopChainCap: has('bunnyhop', 'chaincap') ? 12 : 5,
      bhopDodge: has('bunnyhop', 'dodge') ? 0.5 : 0,

      speedMult: has('speedhack', 'speed') ? 1.65 : on('speedhack') ? 1.2 : 1.0,
      killDash: has('speedhack', 'killdash'),
      killBlink: has('speedhack', 'blink'),
      sprintDodge: has('speedhack', 'dodge') ? 0.45 : 0,
      momentumPay: has('speedhack', 'momentum'),

      heatMult,
      voteKickBlocker: has('bypass', 'votekick'),
      hwidSpoofCharges: has('bypass', 'hwid') ? 2 : 0,
      adminJammer: has('bypass', 'jammer'),

      triggerOn: on('triggerbot'),
      triggerDelay: has('triggerbot', 'reaction') ? 0.015 : 0.12,
      triggerRapidTap: has('triggerbot', 'rapidtap') ? 1.35 : 1.0,
      triggerHeadOnly: on('triggerbot') && tune('triggerbot', 'headwait', '0') === '1',
      triggerAutoReload: has('triggerbot', 'autoreload'),
      triggerCleanPay: has('triggerbot', 'clean') ? 2.0 : 1.0,
      triggerXray: has('triggerbot', 'xray') && wallbangTier > 0,

      magMult: has('ammo', 'magazine') ? 3.0 : on('ammo') ? 1.5 : 1.0,
      infiniteAmmo: has('ammo', 'infinite'),
      piggyOn: has('ammo', 'piggy'),
      piggyHitMult: has('ammo', 'hit') ? 3.0 : 1.0,
      piggyGold: has('ammo', 'gold'),
      piggyInterest: has('ammo', 'compound') ? 0.25 : has('ammo', 'interest') ? 0.1 : 0,
      piggyStorm: has('ammo', 'storm'),

      aimbotOn,
      aimbotFovDeg,
      aimbotSnap,
      aimbotRing: aimbotOn && tune('aimbot', 'ring', '1') === '1',
      aimbotBountyPrio: has('aimbot', 'lock'),
      aimbotWallLock: has('aimbot', 'walllock') && wallbangTier > 0,
      volleyCount: has('aimbot', 'volleyall') ? 99 : has('aimbot', 'volley') ? 3 : 0,
      volleyCooldown: has('aimbot', 'volleyrate') ? 3.5 : 8.0,

      spinbotOn: on('spinbot'),
      spinbotDodge: has('spinbot', 'jitter') ? 0.8 : on('spinbot') ? 0.5 : 0,
      spinbotAuto360: has('spinbot', 'autospin'),
      spinbotResolver: has('spinbot', 'deflect'),

      backtrackOn: on('backtrack'),
      backtrackWindow: has('backtrack', 'window') ? 1.6 : 0.8,
      backtrackFreezePeek: has('backtrack', 'freeze'),
      backtrackChronoBlast: has('backtrack', 'chronoblast') && has('rage', 'explode'),

      damageMult: has('rage', 'damage') ? 3.0 : on('rage') ? 1.5 : 1.0,
      oneTapHead: has('rage', 'onetap'),
      explodeOnKill: has('rage', 'explode'),
      blastRadius: has('rage', 'blastRadius') ? 15 : 7.5,
      blastDamageMult: has('rage', 'blastRadius') ? 1.6 : 0.9,
      fireRateMult: has('rage', 'fireRate') ? 2.8 : has('rage', 'rapid') ? 1.7 : 1.0,
      forceAuto: has('rage', 'auto'),

      baseHeatPerKill: baseHeat,
    };
  }

  public computeCleanMods(): ActiveCheatMods {
    return {
      hitboxOn: false,
      headScale: 1.0,
      headBalloon: false,
      headBoxColor: '#ef4444',
      headDamageMult: 1.0,
      fullBodyHead: false,
      headshotPayMult: 1.0,
      headStreakStep: 0,
      headStreakCap: 1,
      recoilMult: 1.0,
      spreadMult: 1.0,
      longshotPayMult: 1.0,
      wallhackOn: false,
      espBoxes: false,
      chams: false,
      greenChance: 0,
      redChance: 0,
      goldChance: 0,
      rainbowOn: false,
      wallbangTier: 0,
      wallbangMaxWalls: 0,
      wallbangDamage: 0.6,
      wallbangPayMult: 1.0,
      bhopOn: false,
      bhopTopSpeed: 1.0,
      bhopAirStrafe: false,
      bhopMoonhop: false,
      bhopPayPerHop: 0,
      bhopChainCap: 0,
      bhopDodge: 0,
      speedMult: 1.0,
      killDash: false,
      killBlink: false,
      sprintDodge: 0,
      momentumPay: false,
      heatMult: 1.0,
      voteKickBlocker: false,
      hwidSpoofCharges: 0,
      adminJammer: false,
      triggerOn: false,
      triggerDelay: 0.12,
      triggerRapidTap: 1.0,
      triggerHeadOnly: false,
      triggerAutoReload: false,
      triggerCleanPay: 1.0,
      triggerXray: false,
      magMult: 1.0,
      infiniteAmmo: false,
      piggyOn: false,
      piggyHitMult: 1.0,
      piggyGold: false,
      piggyInterest: 0,
      piggyStorm: false,
      aimbotOn: false,
      aimbotFovDeg: 0,
      aimbotSnap: 0,
      aimbotRing: false,
      aimbotBountyPrio: false,
      aimbotWallLock: false,
      volleyCount: 0,
      volleyCooldown: 8.0,
      spinbotOn: false,
      spinbotDodge: 0,
      spinbotAuto360: false,
      spinbotResolver: false,
      backtrackOn: false,
      backtrackWindow: 0,
      backtrackFreezePeek: false,
      backtrackChronoBlast: false,
      damageMult: 1.0,
      oneTapHead: false,
      explodeOnKill: false,
      blastRadius: 7.5,
      blastDamageMult: 0.9,
      fireRateMult: 1.0,
      forceAuto: false,
      baseHeatPerKill: 0,
    };
  }

  public setPlayerName(raw: string): void {
    const cleaned = raw.replace(/[^\w\s.\-äöüÄÖÜß]/g, '').trim().slice(0, 18);
    if (cleaned.length < 2) return;
    this.data.playerName = cleaned;
    this.notify();
  }

  public addFriend(raw: string): boolean {
    const cleaned = raw.replace(/[^\w\s.\-äöüÄÖÜß]/g, '').trim().slice(0, 18);
    if (cleaned.length < 2) return false;
    if (cleaned.toLowerCase() === this.data.playerName.toLowerCase()) return false;
    if (this.data.friends.some((f) => f.name.toLowerCase() === cleaned.toLowerCase())) return false;
    this.data.friends.push({ name: cleaned, addedAt: Date.now() });
    this.notify();
    return true;
  }

  public removeFriend(name: string): void {
    const target = name.trim().toLowerCase();
    this.data.friends = this.data.friends.filter((f) => f.name.toLowerCase() !== target);
    this.notify();
  }

  // Weapons & Modes
  public buyWeapon(id: string): boolean {
    if (this.data.ownedWeapons.includes(id)) return false;
    const def = getWeaponDef(id);
    if (!this.spend(def.cost)) return false;
    this.data.ownedWeapons.push(id);
    if (!def.isSidearm && !def.isMelee) this.data.equippedPrimary = id;
    this.notify();
    return true;
  }

  public equipWeapon(id: string): void {
    if (!this.data.ownedWeapons.includes(id)) return;
    const def = getWeaponDef(id);
    if (!def.isSidearm && !def.isMelee) {
      this.data.equippedPrimary = id;
      sfx.playUi('click');
      this.notify();
    }
  }

  public equipSkin(weaponId: string, skinId: string | null): void {
    const canonical = skinId ? migrateSkinId(skinId) : null;
    if (canonical && !this.data.ownedSkins.includes(canonical)) return;
    if (!canonical) delete this.data.equippedSkins[weaponId];
    else this.data.equippedSkins[weaponId] = canonical;
    sfx.playUi('click');
    this.notify();
  }

  public equipSkinAllWeapons(skinId: string | null): void {
    const canonical = skinId ? migrateSkinId(skinId) : null;
    if (canonical && !this.data.ownedSkins.includes(canonical)) return;
    for (const w of WEAPONS) {
      if (!canonical) delete this.data.equippedSkins[w.id];
      else this.data.equippedSkins[w.id] = canonical;
    }
    sfx.playUi('buy');
    this.notify();
  }

  public unlockAllSkins(): void {
    this.data.ownedSkins = SKINS.map((s) => s.id);
    sfx.playUi('cash');
    this.notify();
  }

  public buyMode(id: ModeId): boolean {
    if (this.data.unlockedModes.includes(id)) return false;
    const def = getMode(id);
    if (!this.spend(def.cost)) return false;
    this.data.unlockedModes.push(id);
    this.data.selectedMode = id;
    this.notify();
    return true;
  }

  public selectMode(id: ModeId): void {
    if (!this.data.unlockedModes.includes(id)) return;
    this.data.selectedMode = id;
    sfx.playUi('click');
    this.notify();
  }

  // Cases
  public rollCaseDrop(): CaseDef {
    const total = CASES.reduce((s, c) => s + c.dropWeight, 0);
    let r = Math.random() * total;
    for (const c of CASES) {
      r -= c.dropWeight;
      if (r <= 0) return c;
    }
    return CASES[0];
  }

  public addCaseToStock(caseId: string, count = 1): void {
    this.data.caseStock[caseId] = (this.data.caseStock[caseId] || 0) + count;
  }

  public buyCase(caseId: string): boolean {
    const def = getCase(caseId);
    if (!this.spend(def.buyPrice)) return false;
    this.addCaseToStock(caseId, 1);
    this.notify();
    return true;
  }

  public sellCase(caseId: string): boolean {
    if ((this.data.caseStock[caseId] || 0) <= 0) return false;
    const def = getCase(caseId);
    this.data.caseStock[caseId] -= 1;
    this.addCredits(def.sellPrice, true);
    sfx.playUi('cash');
    this.notify();
    return true;
  }

  public drawSkinFromCase(caseId: string): WeaponSkin {
    const def = getCase(caseId);
    let rarity: SkinRarity = 'common';
    if (this.data.casesSinceLegendary + 1 >= BALANCE.legendaryPity) {
      rarity = 'legendary';
    } else {
      const luckBoost = 1 + this.data.prestigeLevel * 0.15;
      const weights = def.odds.map((o, i) => (i >= 3 ? o * luckBoost : o));
      const sum = weights.reduce((a, b) => a + b, 0);
      let roll = Math.random() * sum;
      for (let i = 0; i < RARITY_ORDER.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
          rarity = RARITY_ORDER[i];
          break;
        }
      }
    }
    const pool = SKINS.filter((s) => s.rarity === rarity);
    return pool[Math.floor(Math.random() * pool.length)] ?? SKINS[0];
  }

  public openCase(caseId: string): CaseDropResult | null {
    if ((this.data.caseStock[caseId] || 0) <= 0) return null;
    this.data.caseStock[caseId] -= 1;
    const skin = this.drawSkinFromCase(caseId);
    this.data.casesOpened += 1;
    if (skin.rarity === 'legendary') this.data.casesSinceLegendary = 0;
    else this.data.casesSinceLegendary += 1;

    const duplicate = this.data.ownedSkins.includes(skin.id);
    let refund = 0;
    if (duplicate) {
      refund = Math.round(RARITY_META[skin.rarity].refund * this.getPrestigeMultiplier());
      this.addCredits(refund, true);
    } else {
      this.data.ownedSkins.push(skin.id);
    }
    this.data.recentDrops.unshift(skin.id);
    if (this.data.recentDrops.length > 16) this.data.recentDrops.pop();
    this.notify();
    return { caseId, skin, duplicate, refund };
  }

  // Idle Bot-Farm
  public getRigCost(rigId: string): number {
    const def = BOT_FARM_RIGS.find((r) => r.id === rigId)!;
    const owned = this.data.botFarmRigs[rigId] || 0;
    return Math.round(def.baseCost * Math.pow(def.costMult, owned));
  }

  public buyBotFarmRig(rigId: string): boolean {
    const cost = this.getRigCost(rigId);
    if (!this.spend(cost)) return false;
    this.data.botFarmRigs[rigId] = (this.data.botFarmRigs[rigId] || 0) + 1;
    this.notify();
    return true;
  }

  public getBotFarmRatePerSec(): number {
    let total = 0;
    for (const rig of BOT_FARM_RIGS) {
      const count = this.data.botFarmRigs[rig.id] || 0;
      total += count * rig.centsPerSec;
    }
    return total * this.getPrestigeMultiplier();
  }

  public tickBotFarm(): number {
    const now = performance.now();
    const dt = Math.min(2, (now - this.lastFarmTick) / 1000);
    this.lastFarmTick = now;
    const rate = this.getBotFarmRatePerSec();
    if (rate <= 0 || dt <= 0) return 0;
    const gain = rate * dt;
    this.data.credits += gain;
    this.data.lifetimeEarned += gain;
    this.data.runEarned += gain;
    this.data.botFarmEarned += gain;
    return gain;
  }

  // Prestige ("Buy Fresh Clean Account")
  public canPrestige(): boolean {
    return this.data.runEarned >= prestigeCostCents(this.data.prestigeLevel);
  }

  public doPrestige(): boolean {
    if (!this.canPrestige()) {
      sfx.playUi('deny');
      return false;
    }
    const keptSkins = [...this.data.ownedSkins];
    const keptEquippedSkins = { ...this.data.equippedSkins };
    const keptSettings = {
      ...this.data.settings,
      graphics: { ...this.data.settings.graphics },
      crosshair: { ...this.data.settings.crosshair },
    };
    const nextPrestige = this.data.prestigeLevel + 1;
    const keptLifetime = this.data.lifetimeEarned;
    const keptKills = this.data.totalKills;
    const keptDeaths = this.data.totalDeaths;
    const keptHeadshots = this.data.totalHeadshots;
    const keptMatches = this.data.matchesPlayed;
    const keptBans = this.data.totalBans;
    const keptCasesOpened = this.data.casesOpened;
    const keptPity = this.data.casesSinceLegendary;

    const fresh = createDefaultSave();
    fresh.prestigeLevel = nextPrestige;
    fresh.playerName = this.data.playerName;
    fresh.friends = [...this.data.friends];
    fresh.ownedSkins = keptSkins;
    fresh.equippedSkins = keptEquippedSkins;
    fresh.settings = keptSettings;
    fresh.lifetimeEarned = keptLifetime;
    fresh.totalKills = keptKills;
    fresh.totalDeaths = keptDeaths;
    fresh.totalHeadshots = keptHeadshots;
    fresh.matchesPlayed = keptMatches;
    fresh.totalBans = keptBans;
    fresh.casesOpened = keptCasesOpened;
    fresh.casesSinceLegendary = keptPity;
    fresh.trustFactor = 100;
    fresh.caseStock = { basic: 1, neon: 1, overdrive: nextPrestige >= 2 ? 1 : 0 };

    this.data = fresh;
    sfx.playCaseReveal('legendary');
    this.notify();
    return true;
  }

  public completeMatch(result: MatchResult): void {
    this.data.lastMatch = result;
    this.data.matchesPlayed += 1;
    this.data.totalKills += result.kills;
    this.data.totalDeaths += result.deaths;
    this.data.totalHeadshots += result.headshots;
    this.addCredits(result.creditsEarned, true);
    for (const cid of result.casesDropped) {
      this.addCaseToStock(cid, 1);
    }
    if (result.reason === 'banned') {
      this.data.totalBans += 1;
      this.data.trustFactor = Math.max(5, this.data.trustFactor - 30);
    } else if (result.reason === 'kicked') {
      this.data.trustFactor = Math.max(5, this.data.trustFactor - 12);
    } else if (result.peakHeat > 70) {
      this.data.trustFactor = Math.max(10, this.data.trustFactor - 6);
    } else {
      this.data.trustFactor = Math.min(100, this.data.trustFactor + 4);
    }
    this.notify();
  }

  public cycleArtStyle(): ArtStyleId {
    const idx = ART_STYLES.findIndex((s) => s.id === this.data.settings.artStyle);
    const next = ART_STYLES[(idx + 1) % ART_STYLES.length].id;
    this.data.settings.artStyle = next;
    sfx.playUi('click');
    this.notify();
    return next;
  }

  public applyGraphicsPreset(preset: Exclude<GraphicsPresetId, 'custom'>): GraphicsSettings {
    const prev = this.data.settings.graphics;
    const resolved = resolveGraphicsPreset(preset, prev.showPerfHud, prev.fpsCap);
    this.data.settings.graphics = resolved;
    sfx.playUi('click');
    this.notify();
    return resolved;
  }

  public updateGraphicsSetting<K extends keyof GraphicsSettings>(key: K, value: GraphicsSettings[K]): void {
    const g = { ...this.data.settings.graphics, [key]: value };
    g.preset = detectMatchingPreset(g);
    this.data.settings.graphics = g;
    this.notify();
  }
}

export const store = new GameStore();
export { WEAPONS };
