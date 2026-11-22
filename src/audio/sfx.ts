import { SkinRarity, WeaponSkin } from '../data/skins';
import { WallType } from '../game/maps';
import {
  AcousticEnvState,
  AcousticZone,
  computeDistanceAcoustics,
  generateAcousticIRPCM,
} from './acoustics';
import {
  deriveGunshotFromReferencePCM,
  deriveShellCasingFromAtlasPCM,
  deriveWeaponMechFromAtlasPCM,
  findReloadAtlasAnchorSec,
  findShellAtlasAnchorSec,
  isReloadAtlasMechEvent,
  processDirectWeaponSamplePCM,
  ReferenceShotPCM,
  SHELL_CASING_CLIP_COUNT,
  synthesizeGunshotPCM,
  synthesizeWeaponMechPCM,
  VariationSelector,
  WeaponMechEvent,
  WeaponSoundId,
} from './weaponSamples';

export type { AcousticEnvState, AcousticZone, WeaponMechEvent, WeaponSoundId };

export type SndAudioEvent =
  | 'round_start'
  | 'buy_tick'
  | 'plant_beep'
  | 'bomb_planted'
  | 'bomb_beep'
  | 'defuse_start'
  | 'bomb_defused'
  | 'bomb_detonate'
  | 'round_win'
  | 'round_loss'
  | 'side_switch'
  | 'match_win'
  | 'match_loss'
  | 'bomb_pickup';

export type AudioOutputMode = 'headphones' | 'speakers' | 'night';

export interface AudioMixerSettings {
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
}

interface ActiveVoice {
  id: number;
  priority: number;
  channel: string;
  stopAt: number;
  stop: (immediate?: boolean) => void;
}

interface CachedShotAudioBuffers {
  attack: AudioBuffer;
  body: AudioBuffer;
  mech: AudioBuffer;
}

const ACOUSTIC_ZONES: AcousticZone[] = [
  'small_room',
  'corridor',
  'large_interior',
  'outdoor_urban',
  'outdoor_open',
];

const WEAPON_AUDIO_URLS: Record<WeaponSoundId, string> = {
  pistol: '/audio/pistol_ref.m4a',
  smg: '/audio/smg_ref.m4a',
  shotgun: '/audio/shotgun_ref.m4a',
  ssg: '/audio/ssg_ref.m4a',
  rifle: '/audio/rifle_ref.m4a',
  sniper: '/audio/sniper_ref.m4a',
  m4: '/audio/m4_ref.m4a',
  knife: '/audio/knife_ref.m4a',
};

const ALL_WEAPON_SOUND_IDS = Object.keys(WEAPON_AUDIO_URLS) as WeaponSoundId[];

const RELOAD_ATLAS_URL = '/audio/reload_foley_atlas.m4a';
const SHELL_ATLAS_URL = '/audio/shell_casings_atlas.m4a';

class SfxEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterHighpass: BiquadFilterNode | null = null;
  private masterBus: DynamicsCompressorNode | null = null;

  // 8-Bus Audio Hierarchy
  private weaponsBus: GainNode | null = null;
  private movementBus: GainNode | null = null;
  private environmentBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private objectivesBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  // 5-Zone Convolution Reverb Bank
  private reverbZones: Partial<Record<AcousticZone, { convolver: ConvolverNode; returnGain: GainNode }>> = {};
  private currentEnv: AcousticEnvState = {
    zone: 'outdoor_urban',
    enclosure: 0.3,
    wallProximity: 0.2,
    earlyGain: 0.34,
    reverbSend: 0.32,
    surface: 'concrete',
  };

  // Cached Procedural / Reference-Derived PCM -> Web AudioBuffers & Noise Beds
  private weaponRefRaw = new Map<WeaponSoundId, ArrayBuffer>();
  private weaponRefPCM = new Map<WeaponSoundId, ReferenceShotPCM>();
  private weaponDecodeStarted = new Set<WeaponSoundId>();
  private reloadAtlasRaw: ArrayBuffer | null = null;
  private reloadAtlasPCM: ReferenceShotPCM | null = null;
  private reloadAtlasAnchorSec: number | undefined = undefined;
  private reloadAtlasDecodeStarted = false;
  private shellAtlasRaw: ArrayBuffer | null = null;
  private shellAtlasPCM: ReferenceShotPCM | null = null;
  private shellAtlasAnchorSec: number | undefined = undefined;
  private shellAtlasDecodeStarted = false;
  private refFetchStarted = false;
  private shotBufferCache = new Map<string, CachedShotAudioBuffers>();
  private mechBufferCache = new Map<string, AudioBuffer>();
  private shellBufferCache = new Map<string, AudioBuffer>();
  private whiteNoiseBuf: AudioBuffer | null = null;
  private pinkNoiseBuf: AudioBuffer | null = null;
  private variations = new VariationSelector();

  // Voice Pooling & Priority Eviction
  private activeVoices: ActiveVoice[] = [];
  private nextVoiceId = 1;
  private readonly maxConcurrentVoices = 32;
  private readonly maxWeaponVoices = 12;
  private previewTimers: number[] = [];

  // Public Mixer Controls (backward-compatible fields + full category buses)
  public master = 0.65;
  public weapons = 0.90;
  public movement = 0.85;
  public environment = 0.80;
  public sfx = 0.85;
  public objectives = 0.90;
  public ui = 0.80;
  public voice = 0.85;
  public music = 0.65;
  public outputMode: AudioOutputMode = 'headphones';

  constructor() {
    this.preloadReferenceAudio();
  }

  private preloadReferenceAudio(): void {
    if (this.refFetchStarted || typeof window === 'undefined' || typeof fetch !== 'function') return;
    this.refFetchStarted = true;
    for (const wid of ALL_WEAPON_SOUND_IDS) {
      fetch(WEAPON_AUDIO_URLS[wid])
        .then((res) => (res.ok ? res.arrayBuffer() : null))
        .then((ab) => {
          if (!ab) return;
          this.weaponRefRaw.set(wid, ab);
          if (this.ctx && !this.weaponRefPCM.has(wid) && !this.weaponDecodeStarted.has(wid)) {
            this.decodeWeaponReference(wid, this.ctx);
          }
        })
        .catch(() => {
          // Fallback derivation / procedural synthesis stays active if asset fetch fails
        });
    }
    fetch(RELOAD_ATLAS_URL)
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((ab) => {
        if (!ab) return;
        this.reloadAtlasRaw = ab;
        if (this.ctx && !this.reloadAtlasPCM && !this.reloadAtlasDecodeStarted) {
          this.decodeReloadAtlas(this.ctx);
        }
      })
      .catch(() => {
        // Fallback procedural reload foley stays active if atlas fetch fails
      });
    fetch(SHELL_ATLAS_URL)
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((ab) => {
        if (!ab) return;
        this.shellAtlasRaw = ab;
        if (this.ctx && !this.shellAtlasPCM && !this.shellAtlasDecodeStarted) {
          this.decodeShellAtlas(this.ctx);
        }
      })
      .catch(() => {
        // Fallback procedural shell casing clink stays active if atlas fetch fails
      });
  }

  private decodePendingReferences(ctx: AudioContext): void {
    for (const wid of this.weaponRefRaw.keys()) {
      if (!this.weaponRefPCM.has(wid) && !this.weaponDecodeStarted.has(wid)) {
        this.decodeWeaponReference(wid, ctx);
      }
    }
    if (this.reloadAtlasRaw && !this.reloadAtlasPCM && !this.reloadAtlasDecodeStarted) {
      this.decodeReloadAtlas(ctx);
    }
    if (this.shellAtlasRaw && !this.shellAtlasPCM && !this.shellAtlasDecodeStarted) {
      this.decodeShellAtlas(ctx);
    }
  }

  private decodeShellAtlas(ctx: AudioContext): void {
    if (!this.shellAtlasRaw || this.shellAtlasDecodeStarted || this.shellAtlasPCM) return;
    this.shellAtlasDecodeStarted = true;
    ctx
      .decodeAudioData(this.shellAtlasRaw.slice(0))
      .then((decoded) => {
        const left = new Float32Array(decoded.getChannelData(0));
        const right =
          decoded.numberOfChannels > 1
            ? new Float32Array(decoded.getChannelData(1))
            : new Float32Array(left);
        this.shellAtlasPCM = { left, right, sampleRate: decoded.sampleRate };
        this.shellAtlasAnchorSec = findShellAtlasAnchorSec(this.shellAtlasPCM);
        this.shellBufferCache.clear();
      })
      .catch(() => {
        // Fallback procedural shell casing clink stays active if atlas decode fails
      });
  }

  private decodeReloadAtlas(ctx: AudioContext): void {
    if (!this.reloadAtlasRaw || this.reloadAtlasDecodeStarted || this.reloadAtlasPCM) return;
    this.reloadAtlasDecodeStarted = true;
    ctx
      .decodeAudioData(this.reloadAtlasRaw.slice(0))
      .then((decoded) => {
        const left = new Float32Array(decoded.getChannelData(0));
        const right =
          decoded.numberOfChannels > 1
            ? new Float32Array(decoded.getChannelData(1))
            : new Float32Array(left);
        this.reloadAtlasPCM = { left, right, sampleRate: decoded.sampleRate };
        this.reloadAtlasAnchorSec = findReloadAtlasAnchorSec(this.reloadAtlasPCM);
        this.mechBufferCache.clear();
      })
      .catch(() => {
        // Fallback procedural reload foley stays active if atlas decode fails
      });
  }

  private decodeWeaponReference(wid: WeaponSoundId, ctx: AudioContext): void {
    const raw = this.weaponRefRaw.get(wid);
    if (!raw || this.weaponDecodeStarted.has(wid) || this.weaponRefPCM.has(wid)) return;
    this.weaponDecodeStarted.add(wid);
    ctx
      .decodeAudioData(raw.slice(0))
      .then((decoded) => {
        const left = new Float32Array(decoded.getChannelData(0));
        const right =
          decoded.numberOfChannels > 1
            ? new Float32Array(decoded.getChannelData(1))
            : new Float32Array(left);
        this.weaponRefPCM.set(wid, { left, right, sampleRate: decoded.sampleRate });
        for (const key of Array.from(this.shotBufferCache.keys())) {
          if (key.includes(`_${wid}_`) || (wid === 'pistol' && key.startsWith('proc_') && !key.includes('_knife_'))) {
            this.shotBufferCache.delete(key);
          }
        }
      })
      .catch(() => {
        // Fallback derivation / procedural synthesis stays active if decode fails
      });
  }

  public applySettings(s: Partial<AudioMixerSettings>): void {
    if (s.masterVol !== undefined) this.master = s.masterVol;
    if (s.weaponsVol !== undefined) this.weapons = s.weaponsVol;
    if (s.movementVol !== undefined) this.movement = s.movementVol;
    if (s.environmentVol !== undefined) this.environment = s.environmentVol;
    if (s.sfxVol !== undefined) this.sfx = s.sfxVol;
    if (s.objectivesVol !== undefined) this.objectives = s.objectivesVol;
    if (s.uiVol !== undefined) this.ui = s.uiVol;
    if (s.voiceVol !== undefined) this.voice = s.voiceVol;
    if (s.musicVol !== undefined) this.music = s.musicVol;
    if (s.audioOutputMode !== undefined) this.outputMode = s.audioOutputMode;
    this.syncBusGains();
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      if (typeof window === 'undefined') return null;
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    const ctx = this.ctx;

    if (!this.masterBus) {
      const mGain = ctx.createGain();
      const mHp = ctx.createBiquadFilter();
      mHp.type = 'highpass';
      mHp.frequency.value = 32;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.knee.value = 12;
      comp.ratio.value = 5.5;
      comp.attack.value = 0.002;
      comp.release.value = 0.14;

      mGain.connect(mHp).connect(comp).connect(ctx.destination);
      this.masterGain = mGain;
      this.masterHighpass = mHp;
      this.masterBus = comp;

      const makeBus = () => {
        const g = ctx.createGain();
        g.connect(mGain);
        return g;
      };
      this.weaponsBus = makeBus();
      this.movementBus = makeBus();
      this.environmentBus = makeBus();
      this.effectsBus = makeBus();
      this.objectivesBus = makeBus();
      this.uiBus = makeBus();
      this.voiceBus = makeBus();
      this.musicBus = makeBus();

      // Build 5 decorrelated stereo room/outdoor convolution reverbs into environmentBus
      for (const zone of ACOUSTIC_ZONES) {
        const [irL, irR] = generateAcousticIRPCM(zone, ctx.sampleRate);
        const irBuf = ctx.createBuffer(2, irL.length, ctx.sampleRate);
        irBuf.copyToChannel(irL, 0);
        irBuf.copyToChannel(irR, 1);
        const conv = ctx.createConvolver();
        conv.normalize = false;
        conv.buffer = irBuf;
        const ret = ctx.createGain();
        ret.gain.value = zone === this.currentEnv.zone ? 0.34 : 0.0001;
        conv.connect(ret).connect(this.environmentBus);
        this.reverbZones[zone] = { convolver: conv, returnGain: ret };
      }

      this.syncBusGains();
    }

    if (!this.whiteNoiseBuf) {
      const len = Math.floor(ctx.sampleRate * 1.2);
      const wBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const wData = wBuf.getChannelData(0);
      for (let i = 0; i < len; i++) wData[i] = Math.random() * 2 - 1;
      this.whiteNoiseBuf = wBuf;

      const pBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const pData = pBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        pData[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.14));
        b6 = white * 0.115926;
      }
      this.pinkNoiseBuf = pBuf;
    }

    if (!this.refFetchStarted) {
      this.preloadReferenceAudio();
    }
    this.decodePendingReferences(ctx);

    return ctx;
  }

  private syncBusGains(): void {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain || !this.masterBus) return;
    const now = ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(Math.max(0.0001, this.master), now, 0.02);
    this.weaponsBus?.gain.setTargetAtTime(Math.max(0.0001, this.weapons), now, 0.02);
    this.movementBus?.gain.setTargetAtTime(Math.max(0.0001, this.movement), now, 0.02);
    this.environmentBus?.gain.setTargetAtTime(Math.max(0.0001, this.environment), now, 0.02);
    this.effectsBus?.gain.setTargetAtTime(Math.max(0.0001, this.sfx), now, 0.02);
    this.objectivesBus?.gain.setTargetAtTime(Math.max(0.0001, this.objectives), now, 0.02);
    this.uiBus?.gain.setTargetAtTime(Math.max(0.0001, this.ui), now, 0.02);
    this.voiceBus?.gain.setTargetAtTime(Math.max(0.0001, this.voice), now, 0.02);
    this.musicBus?.gain.setTargetAtTime(Math.max(0.0001, this.music), now, 0.02);

    if (this.outputMode === 'night') {
      this.masterBus.threshold.setTargetAtTime(-18, now, 0.03);
      this.masterBus.ratio.setTargetAtTime(8, now, 0.03);
    } else if (this.outputMode === 'speakers') {
      this.masterBus.threshold.setTargetAtTime(-9, now, 0.03);
      this.masterBus.ratio.setTargetAtTime(4.5, now, 0.03);
    } else {
      this.masterBus.threshold.setTargetAtTime(-11, now, 0.03);
      this.masterBus.ratio.setTargetAtTime(5.5, now, 0.03);
    }
  }

  private toAudioBuffer(ctx: AudioContext, pcm: Float32Array<ArrayBuffer>): AudioBuffer {
    const buf = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
    buf.copyToChannel(pcm, 0);
    return buf;
  }

  private toStereoAudioBuffer(
    ctx: AudioContext,
    left: Float32Array<ArrayBuffer>,
    right: Float32Array<ArrayBuffer>,
    sampleRate: number,
  ): AudioBuffer {
    const buf = ctx.createBuffer(2, left.length, sampleRate);
    buf.copyToChannel(left, 0);
    buf.copyToChannel(right, 1);
    return buf;
  }

  private getShotBuffers(type: WeaponSoundId, variationIdx: number, ctx: AudioContext): CachedShotAudioBuffers {
    const ownRef = this.weaponRefPCM.get(type);
    const pistolRef = !ownRef && type !== 'knife' ? this.weaponRefPCM.get('pistol') : undefined;
    const modeTag = ownRef ? 'direct' : pistolRef ? 'ref' : 'proc';
    const key = `${modeTag}_${type}_${variationIdx}`;
    const existing = this.shotBufferCache.get(key);
    if (existing) return existing;

    let cached: CachedShotAudioBuffers;
    if (ownRef) {
      const pcm = processDirectWeaponSamplePCM(ownRef, type, variationIdx, ctx.sampleRate);
      cached = {
        attack: this.toStereoAudioBuffer(ctx, pcm.attackL, pcm.attackR, pcm.sampleRate),
        body: this.toStereoAudioBuffer(ctx, pcm.bodyL, pcm.bodyR, pcm.sampleRate),
        mech: this.toAudioBuffer(ctx, pcm.mech),
      };
    } else if (pistolRef) {
      const pcm = deriveGunshotFromReferencePCM(pistolRef, type, variationIdx, ctx.sampleRate);
      cached = {
        attack: this.toStereoAudioBuffer(ctx, pcm.attackL, pcm.attackR, pcm.sampleRate),
        body: this.toStereoAudioBuffer(ctx, pcm.bodyL, pcm.bodyR, pcm.sampleRate),
        mech: this.toAudioBuffer(ctx, pcm.mech),
      };
    } else {
      const pcm = synthesizeGunshotPCM(type, variationIdx, ctx.sampleRate);
      cached = {
        attack: this.toAudioBuffer(ctx, pcm.attack),
        body: this.toAudioBuffer(ctx, pcm.body),
        mech: this.toAudioBuffer(ctx, pcm.mech),
      };
    }
    this.shotBufferCache.set(key, cached);
    return cached;
  }

  private getMechBuffer(event: WeaponMechEvent, weaponId: string, variationIdx: number, ctx: AudioContext): AudioBuffer {
    const useAtlas = Boolean(this.reloadAtlasPCM && weaponId !== 'knife' && isReloadAtlasMechEvent(event));
    const key = `${useAtlas ? 'atlas' : 'proc'}_${event}_${weaponId}_${variationIdx}`;
    const existing = this.mechBufferCache.get(key);
    if (existing) return existing;

    let ab: AudioBuffer;
    if (useAtlas) {
      const stereo = deriveWeaponMechFromAtlasPCM(
        this.reloadAtlasPCM!,
        event,
        weaponId,
        variationIdx,
        ctx.sampleRate,
        this.reloadAtlasAnchorSec,
      );
      ab = this.toStereoAudioBuffer(ctx, stereo.left, stereo.right, stereo.sampleRate);
    } else {
      const pcm = synthesizeWeaponMechPCM(event, weaponId, variationIdx, ctx.sampleRate);
      ab = this.toAudioBuffer(ctx, pcm);
    }
    this.mechBufferCache.set(key, ab);
    return ab;
  }

  private getShellCasingBuffer(isShotgun: boolean, variationIdx: number, ctx: AudioContext): AudioBuffer | null {
    if (!this.shellAtlasPCM) return null;
    const key = `${isShotgun ? 'sg' : 'br'}_${variationIdx}`;
    const existing = this.shellBufferCache.get(key);
    if (existing) return existing;
    const stereo = deriveShellCasingFromAtlasPCM(
      this.shellAtlasPCM,
      variationIdx,
      isShotgun,
      ctx.sampleRate,
      this.shellAtlasAnchorSec,
    );
    const ab = this.toStereoAudioBuffer(ctx, stereo.left, stereo.right, stereo.sampleRate);
    this.shellBufferCache.set(key, ab);
    return ab;
  }

  private registerVoice(
    priority: number,
    channel: string,
    durationSec: number,
    stopFn: (immediate?: boolean) => void,
  ): number {
    const now = this.ctx?.currentTime ?? 0;
    this.activeVoices = this.activeVoices.filter((v) => v.stopAt > now);

    const isWeaponCh = channel.includes('weapon');
    if (isWeaponCh) {
      let weaponCount = 0;
      for (const v of this.activeVoices) if (v.channel.includes('weapon')) weaponCount++;
      while (weaponCount >= this.maxWeaponVoices) {
        let evictIdx = -1;
        let lowestPrio = Infinity;
        for (let i = 0; i < this.activeVoices.length; i++) {
          const v = this.activeVoices[i];
          if (v.channel.includes('weapon') && v.priority < lowestPrio) {
            lowestPrio = v.priority;
            evictIdx = i;
          }
        }
        if (evictIdx < 0) break;
        const [evicted] = this.activeVoices.splice(evictIdx, 1);
        evicted.stop(true);
        weaponCount--;
      }
    }

    while (this.activeVoices.length >= this.maxConcurrentVoices) {
      let evictIdx = 0;
      let lowestPrio = Infinity;
      for (let i = 0; i < this.activeVoices.length; i++) {
        if (this.activeVoices[i].priority < lowestPrio) {
          lowestPrio = this.activeVoices[i].priority;
          evictIdx = i;
        }
      }
      const [evicted] = this.activeVoices.splice(evictIdx, 1);
      evicted.stop(true);
    }

    const id = this.nextVoiceId++;
    this.activeVoices.push({
      id,
      priority,
      channel,
      stopAt: now + durationSec,
      stop: stopFn,
    });
    return id;
  }

  public cancelWeaponFoley(channel = 'player_weapon'): void {
    const remaining: ActiveVoice[] = [];
    for (const v of this.activeVoices) {
      if (v.channel === channel) {
        v.stop(false);
      } else {
        remaining.push(v);
      }
    }
    this.activeVoices = remaining;
  }

  private clearPreviewTimers(): void {
    for (const tid of this.previewTimers) window.clearTimeout(tid);
    this.previewTimers.length = 0;
  }

  private duckEnvironment(reductionDb = -1.8, holdSec = 0.095): void {
    const ctx = this.ctx;
    if (!ctx || !this.environmentBus) return;
    const now = ctx.currentTime;
    const base = Math.max(0.0001, this.environment);
    const ducked = Math.max(0.0001, base * Math.pow(10, reductionDb / 20));
    this.environmentBus.gain.cancelScheduledValues(now);
    this.environmentBus.gain.setTargetAtTime(ducked, now, 0.006);
    this.environmentBus.gain.setTargetAtTime(base, now + holdSec, 0.09);
  }

  private getBus(cat: 'weapons' | 'movement' | 'environment' | 'effects' | 'objectives' | 'ui' | 'voice' | 'music'): AudioNode {
    const ctx = this.ctx!;
    const fallback = this.masterGain ?? ctx.destination;
    switch (cat) {
      case 'weapons': return this.weaponsBus ?? fallback;
      case 'movement': return this.movementBus ?? fallback;
      case 'environment': return this.environmentBus ?? fallback;
      case 'effects': return this.effectsBus ?? fallback;
      case 'objectives': return this.objectivesBus ?? fallback;
      case 'ui': return this.uiBus ?? fallback;
      case 'voice': return this.voiceBus ?? fallback;
      case 'music': return this.musicBus ?? fallback;
    }
  }

  private routeToBus(
    node: AudioNode,
    cat: 'weapons' | 'movement' | 'environment' | 'effects' | 'objectives' | 'ui' | 'voice' | 'music',
    reverbSend = 0,
    pan = 0,
    zoneOverride?: AcousticZone,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const bus = this.getBus(cat);
    let tail: AudioNode = node;

    if (Math.abs(pan) > 0.01 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-0.92, Math.min(0.92, pan)), ctx.currentTime);
      tail.connect(panner);
      tail = panner;
    }

    tail.connect(bus);

    const z = zoneOverride ?? this.currentEnv.zone;
    const revEntry = this.reverbZones[z];
    if (reverbSend > 0.005 && revEntry) {
      const send = ctx.createGain();
      send.gain.value = reverbSend;
      tail.connect(send).connect(revEntry.convolver);
    }
  }

  private noiseBuffer(ctx: AudioContext, seconds = 0.4): AudioBuffer {
    if (this.whiteNoiseBuf && seconds <= 1.2) return this.whiteNoiseBuf;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  public updateListener(
    pos: { x: number; y: number; z: number },
    forward: { x: number; y: number; z: number },
    up: { x: number; y: number; z: number },
  ): void {
    const ctx = this.ctx;
    if (!ctx || !ctx.listener) return;
    const l = ctx.listener as unknown as Record<string, AudioParam | ((...args: number[]) => void)>;
    const now = ctx.currentTime;
    if ('positionX' in l && typeof (l.positionX as AudioParam).setValueAtTime === 'function') {
      (l.positionX as AudioParam).setTargetAtTime(pos.x, now, 0.01);
      (l.positionY as AudioParam).setTargetAtTime(pos.y, now, 0.01);
      (l.positionZ as AudioParam).setTargetAtTime(pos.z, now, 0.01);
      (l.forwardX as AudioParam).setTargetAtTime(forward.x, now, 0.01);
      (l.forwardY as AudioParam).setTargetAtTime(forward.y, now, 0.01);
      (l.forwardZ as AudioParam).setTargetAtTime(forward.z, now, 0.01);
      (l.upX as AudioParam).setTargetAtTime(up.x, now, 0.01);
      (l.upY as AudioParam).setTargetAtTime(up.y, now, 0.01);
      (l.upZ as AudioParam).setTargetAtTime(up.z, now, 0.01);
    } else if (typeof (ctx.listener as unknown as { setPosition?: (...n: number[]) => void }).setPosition === 'function') {
      const legacy = ctx.listener as unknown as {
        setPosition: (x: number, y: number, z: number) => void;
        setOrientation: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
      };
      legacy.setPosition(pos.x, pos.y, pos.z);
      legacy.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  public setAcousticEnvironment(env: AcousticEnvState): void {
    const changed = env.zone !== this.currentEnv.zone;
    this.currentEnv = env;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const z of ACOUSTIC_ZONES) {
      const entry = this.reverbZones[z];
      if (!entry) continue;
      const target = z === env.zone ? 0.28 + env.reverbSend * 0.42 : 0.0001;
      entry.returnGain.gain.setTargetAtTime(target, now, changed ? 0.08 : 0.14);
    }
  }

  public playShot(type: WeaponSoundId, envOverride?: AcousticEnvState): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const env = envOverride ?? this.currentEnv;

    const varIdx = this.variations.next(`shot_${type}`, 4);
    const bufs = this.getShotBuffers(type, varIdx, ctx);

    const hasRealAudio = this.weaponRefPCM.has(type) || (type !== 'knife' && this.weaponRefPCM.has('pistol'));
    const rateVar = hasRealAudio ? 0.986 + Math.random() * 0.028 : 0.978 + Math.random() * 0.044;
    const gainVar = 0.94 + Math.random() * 0.12;
    const revMult =
      type === 'sniper' ? 1.15 :
      type === 'shotgun' ? 1.05 :
      type === 'rifle' || type === 'ssg' ? 0.92 :
      type === 'smg' ? 0.25 :
      type === 'knife' ? 0.15 : 0.72;
    const revScale = hasRealAudio ? 0.52 : 1.0;
    const revSend = Math.min(0.68, env.reverbSend * revMult * revScale);

    const mixGain = ctx.createGain();
    mixGain.gain.setValueAtTime(gainVar, now);
    this.routeToBus(mixGain, 'weapons', 0);

    // Send only attack + body (not mechanical action) to room convolver for natural tails
    const wetGain = ctx.createGain();
    wetGain.gain.setValueAtTime(gainVar * revSend, now);
    const revTarget = this.reverbZones[env.zone];
    if (revTarget) wetGain.connect(revTarget.convolver);

    const sources: AudioBufferSourceNode[] = [];
    const playLayer = (buf: AudioBuffer, layerGain: number, sendWet: boolean) => {
      if (layerGain <= 0.01) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.setValueAtTime(rateVar, now);
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(layerGain, now);
      src.connect(lg).connect(mixGain);
      if (sendWet) lg.connect(wetGain);
      src.start(now);
      sources.push(src);
    };

    playLayer(bufs.attack, 1.0, true);
    playLayer(bufs.body, 1.0, true);
    if (type !== 'knife') playLayer(bufs.mech, 0.95, false);

    if (type !== 'knife') {
      this.duckEnvironment(type === 'sniper' || type === 'shotgun' ? -2.4 : -1.6, 0.09);
    }

    const maxDur = Math.max(bufs.attack.duration, bufs.body.duration, bufs.mech.duration);
    this.registerVoice(100, 'player_shot', maxDur + 0.05, (immediate) => {
      const t = ctx.currentTime;
      mixGain.gain.cancelScheduledValues(t);
      if (immediate) {
        mixGain.gain.setValueAtTime(0.0001, t);
        sources.forEach((s) => { try { s.stop(t); } catch { /* ignore */ } });
      } else {
        mixGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
        sources.forEach((s) => { try { s.stop(t + 0.024); } catch { /* ignore */ } });
      }
    });
  }

  public playSpatialShot(
    type: WeaponSoundId,
    sourcePos: { x: number; y: number; z: number },
    distance: number,
    occludingWalls: WallType[],
    zone: AcousticZone,
    stereoPan: number,
    isAdmin = false,
    deterministicSeed?: number,
  ): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const ac = computeDistanceAcoustics(distance, occludingWalls, zone);
    if (distance >= 80 || ac.gain < 0.004) return;

    const now = ctx.currentTime;
    const varIdx = this.variations.next(`bot_shot_${type}`, 4, deterministicSeed);
    const bufs = this.getShotBuffers(type, varIdx, ctx);

    const rate = (isAdmin ? 0.82 : 1.0) * (0.97 + Math.random() * 0.06);
    const masterAmp = ac.gain * (isAdmin ? 1.18 : 0.86);

    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(ac.lowpassHz, now);
    lpf.Q.value = ac.occluded ? 0.65 : 0.72;

    const outGain = ctx.createGain();
    outGain.gain.setValueAtTime(Math.max(0.0001, masterAmp), now);

    // Spatial node selection: 3D HRTF for Headphones, clean stereo panner for Speakers
    if (this.outputMode === 'headphones' && typeof ctx.createPanner === 'function') {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'linear';
      panner.refDistance = 1;
      panner.maxDistance = 200;
      panner.rolloffFactor = 0; // We apply exact physical + occlusion attenuation via computeDistanceAcoustics
      panner.positionX?.setValueAtTime(sourcePos.x, now);
      panner.positionY?.setValueAtTime(sourcePos.y + 1.35, now);
      panner.positionZ?.setValueAtTime(sourcePos.z, now);
      outGain.connect(lpf).connect(panner).connect(this.getBus('weapons'));
    } else if (typeof ctx.createStereoPanner === 'function') {
      const sp = ctx.createStereoPanner();
      sp.pan.setValueAtTime(Math.max(-0.92, Math.min(0.92, stereoPan)), now);
      outGain.connect(lpf).connect(sp).connect(this.getBus('weapons'));
    } else {
      outGain.connect(lpf).connect(this.getBus('weapons'));
    }

    const revEntry = this.reverbZones[zone];
    if (revEntry && ac.reverbSend > 0.01) {
      const wet = ctx.createGain();
      wet.gain.setValueAtTime(masterAmp * ac.reverbSend * 0.62, now);
      lpf.connect(wet).connect(revEntry.convolver);
    }

    const attackW = ac.nearWeight * 0.95 + ac.midWeight * 0.42;
    const bodyW = 0.42 + ac.midWeight * 0.42 + ac.farWeight * 0.68;
    const mechW = distance < 16 ? ac.nearWeight * 0.72 : 0;

    const sources: AudioBufferSourceNode[] = [];
    const spawn = (buf: AudioBuffer, weight: number) => {
      if (weight <= 0.01) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.setValueAtTime(rate, now);
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(weight, now);
      src.connect(lg).connect(outGain);
      src.start(now);
      sources.push(src);
    };

    spawn(bufs.attack, attackW);
    spawn(bufs.body, bodyW);
    if (mechW > 0.02) spawn(bufs.mech, mechW);

    const priority = Math.round(80 - distance * 0.8 + (isAdmin ? 20 : 0));
    this.registerVoice(priority, 'bot_weapon', Math.max(bufs.body.duration, 0.25) + 0.05, (immediate) => {
      const t = ctx.currentTime;
      outGain.gain.cancelScheduledValues(t);
      if (immediate) {
        outGain.gain.setValueAtTime(0.0001, t);
        sources.forEach((s) => { try { s.stop(t); } catch { /* ignore */ } });
      } else {
        outGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
        sources.forEach((s) => { try { s.stop(t + 0.024); } catch { /* ignore */ } });
      }
    });
  }

  public playBotShot(distance: number, isAdmin = false, stereoPan = 0): void {
    this.playSpatialShot(
      isAdmin ? 'sniper' : 'rifle',
      { x: stereoPan * Math.max(2, distance), y: 0, z: 0 },
      distance,
      [],
      this.currentEnv.zone,
      stereoPan,
      isAdmin,
    );
  }

  public playHit(headshot: boolean): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = headshot ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(headshot ? 1480 : 620, now);
    osc.frequency.exponentialRampToValueAtTime(headshot ? 2350 : 320, now + (headshot ? 0.08 : 0.045));
    const g = ctx.createGain();
    g.gain.setValueAtTime(headshot ? 0.35 : 0.24, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + (headshot ? 0.11 : 0.055));
    osc.connect(g);
    this.routeToBus(g, 'effects', 0);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  public playKill(streak: number, chime: WeaponSkin['killChime'] = 'default'): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const semi = Math.min(streak, 12);
    const pitch = Math.pow(2, semi / 12);

    const wave: OscillatorType =
      chime === 'chiptune' ? 'square' :
      chime === 'zap' ? 'sawtooth' :
      chime === 'plasma' ? 'sine' : 'triangle';

    const base =
      chime === 'abyss' ? 240 :
      chime === 'koto' ? 493.88 :
      chime === 'crystal' ? 880 :
      chime === 'plasma' ? 660 : 523.25;

    const notes = chime === 'chiptune' ? [1, 1.25, 1.5] : chime === 'koto' ? [1, 1.189, 1.5] : [1, 1.5];
    notes.forEach((mult, i) => {
      const t = now + i * 0.045;
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.frequency.setValueAtTime(base * mult * pitch, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.24, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);
      osc.connect(g);
      this.routeToBus(g, 'effects', 0.06);
      osc.start(t);
      osc.stop(t + 0.17);
    });
  }

  public playReload(): void {
    this.playWeaponMech('mag_out', 'rifle');
  }

  public playWeaponMech(event: WeaponMechEvent, weaponId = 'rifle', channel = 'player_weapon'): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const varIdx = this.variations.next(`mech_${event}_${weaponId}`, 3);
    const ab = this.getMechBuffer(event, weaponId, varIdx, ctx);

    const src = ctx.createBufferSource();
    src.buffer = ab;
    src.playbackRate.setValueAtTime(0.982 + Math.random() * 0.036, now);

    const softHandling =
      event === 'reload_end' || event === 'holster' || event === 'equip_rustle' || event === 'inspect_whoosh';
    const lightTick = event === 'mag_release' || event === 'scope_click' || event === 'dry_fire';
    const mediumMech =
      event === 'mag_out' ||
      event === 'shell_insert' ||
      event === 'bolt_lift' ||
      event === 'press_check' ||
      event === 'knife_draw' ||
      event === 'knife_spin';
    const volScale = softHandling ? 0.50 : lightTick ? 0.68 : mediumMech ? 0.78 : 0.86;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volScale, now);
    src.connect(g);
    this.routeToBus(g, 'weapons', Math.min(0.10, this.currentEnv.earlyGain * 0.18));
    src.start(now);

    this.registerVoice(72, channel, ab.duration + 0.03, (immediate) => {
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
      if (immediate) {
        g.gain.setValueAtTime(0.0001, t);
        try { src.stop(t); } catch { /* ignore */ }
      } else {
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
        try { src.stop(t + 0.022); } catch { /* ignore */ }
      }
    });
  }

  public playSpatialWeaponMech(
    event: WeaponMechEvent,
    weaponId: string,
    distance: number,
    occludingWalls: WallType[],
    stereoPan: number,
  ): void {
    const ctx = this.ensure();
    if (!ctx || distance > 26) return;
    const ac = computeDistanceAcoustics(distance, occludingWalls, this.currentEnv.zone);
    if (ac.gain < 0.02) return;

    const now = ctx.currentTime;
    const varIdx = this.variations.next(`rmech_${event}_${weaponId}`, 3);
    const ab = this.getMechBuffer(event, weaponId, varIdx, ctx);

    const src = ctx.createBufferSource();
    src.buffer = ab;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(ac.lowpassHz, now);

    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, ac.gain * 0.52), now);
    src.connect(lpf).connect(g);
    this.routeToBus(g, 'weapons', ac.reverbSend * 0.22, stereoPan);
    src.start(now);
  }

  public playReloadPreview(weaponId: string): void {
    this.clearPreviewTimers();
    this.cancelWeaponFoley('preview_weapon');
    const timeline: Array<[number, WeaponMechEvent]> =
      weaponId === 'shotgun'
        ? [[0, 'equip_rustle'], [380, 'shell_insert'], [760, 'shell_insert'], [1140, 'shell_insert'], [1420, 'pump_back'], [1660, 'pump_fwd'], [1800, 'reload_end']]
        : weaponId === 'm4'
          ? [[0, 'mag_release'], [140, 'mag_out'], [500, 'equip_rustle'], [800, 'mag_in'], [960, 'mag_slap'], [1120, 'bolt_release'], [1280, 'reload_end']]
          : weaponId === 'smg'
            ? [[0, 'mag_release'], [150, 'mag_out'], [520, 'equip_rustle'], [860, 'mag_in'], [1040, 'bolt_pull'], [1220, 'bolt_release'], [1340, 'reload_end']]
            : weaponId === 'ssg'
              ? [[0, 'mag_release'], [200, 'mag_out'], [760, 'equip_rustle'], [1240, 'mag_in'], [1500, 'bolt_lift'], [1660, 'bolt_pull'], [1840, 'bolt_lock'], [1980, 'reload_end']]
              : weaponId === 'sniper'
                ? [[0, 'mag_release'], [220, 'mag_out'], [860, 'equip_rustle'], [1400, 'mag_in'], [1680, 'bolt_lift'], [1860, 'bolt_pull'], [2060, 'bolt_lock'], [2220, 'reload_end']]
                : weaponId === 'pistol'
                  ? [[0, 'mag_release'], [150, 'mag_out'], [480, 'equip_rustle'], [740, 'mag_in'], [960, 'bolt_release'], [1140, 'reload_end']]
                  : weaponId === 'knife'
                    ? [[0, 'knife_draw'], [320, 'knife_spin'], [720, 'inspect_whoosh']]
                    : [[0, 'mag_release'], [170, 'mag_out'], [600, 'equip_rustle'], [980, 'mag_in'], [1200, 'bolt_pull'], [1400, 'bolt_release'], [1540, 'reload_end']];

    for (const [ms, ev] of timeline) {
      if (ms === 0) {
        this.playWeaponMech(ev, weaponId, 'preview_weapon');
      } else {
        const tid = window.setTimeout(() => this.playWeaponMech(ev, weaponId, 'preview_weapon'), ms);
        this.previewTimers.push(tid);
      }
    }
  }

  public playCasingClink(
    isShotgun: boolean,
    bounceIndex = 1,
    surface: 'concrete' | 'metal' | 'snow' = 'concrete',
    stereoPan = 0,
  ): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (this.shellAtlasPCM) {
      if (bounceIndex > 1) return;
      const varIdx = this.variations.next(isShotgun ? 'shell_sg' : 'shell_brass', SHELL_CASING_CLIP_COUNT);
      const ab = this.getShellCasingBuffer(isShotgun, varIdx, ctx);
      if (ab) {
        const rateMult = surface === 'metal' ? 1.08 : surface === 'snow' ? 0.94 : 1.0;
        const surfGain = surface === 'metal' ? 0.66 : surface === 'snow' ? 0.24 : 0.56;
        const lpfHz = surface === 'metal' ? 18000 : surface === 'snow' ? 2400 : 16500;
        const revSend = surface === 'metal' ? 0.11 : surface === 'snow' ? 0.02 : 0.07;

        const src = ctx.createBufferSource();
        src.buffer = ab;
        src.playbackRate.setValueAtTime(rateMult * (0.98 + Math.random() * 0.04), now);

        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.setValueAtTime(lpfHz, now);
        lpf.Q.value = 0.72;

        const g = ctx.createGain();
        g.gain.setValueAtTime(surfGain * (0.92 + Math.random() * 0.16), now);
        src.connect(lpf).connect(g);
        this.routeToBus(g, 'weapons', revSend, stereoPan);
        src.start(now);

        this.registerVoice(32, 'shell_casing', ab.duration + 0.03, (immediate) => {
          const t = ctx.currentTime;
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
          if (immediate) {
            g.gain.setValueAtTime(0.0001, t);
            try { src.stop(t); } catch { /* ignore */ }
          } else {
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
            try { src.stop(t + 0.024); } catch { /* ignore */ }
          }
        });
        return;
      }
    }

    const jitter = 0.92 + Math.random() * 0.16;
    const bounceDecay = bounceIndex <= 1 ? 1.0 : bounceIndex === 2 ? 0.56 : 0.28;
    const surfGain = surface === 'snow' ? 0.36 : surface === 'metal' ? 1.24 : 1.0;
    const surfRing = surface === 'metal' ? 1.35 : surface === 'snow' ? 0.45 : 1.0;
    const weight = bounceDecay * surfGain;

    if (isShotgun) {
      const src = ctx.createBufferSource();
      src.buffer = this.pinkNoiseBuf ?? this.noiseBuffer(ctx, 0.06);
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.setValueAtTime((surface === 'metal' ? 920 : 640) * jitter, now);
      filt.Q.value = 2.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.085 * weight, now);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 0.048 * surfRing);
      src.connect(filt).connect(g);
      this.routeToBus(g, 'weapons', 0.06, stereoPan);
      src.start(now, Math.random() * 0.4);
      src.stop(now + 0.06);

      [3450, 5100].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * jitter, now);
        const bg = ctx.createGain();
        bg.gain.setValueAtTime((idx === 0 ? 0.036 : 0.022) * weight, now);
        bg.gain.exponentialRampToValueAtTime(0.0008, now + 0.04 * surfRing);
        osc.connect(bg);
        this.routeToBus(bg, 'weapons', 0.04, stereoPan);
        osc.start(now);
        osc.stop(now + 0.05);
      });
      return;
    }

    const imp = ctx.createBufferSource();
    imp.buffer = this.whiteNoiseBuf ?? this.noiseBuffer(ctx, 0.02);
    const impFilt = ctx.createBiquadFilter();
    impFilt.type = 'highpass';
    impFilt.frequency.setValueAtTime(4800, now);
    const impG = ctx.createGain();
    impG.gain.setValueAtTime(0.055 * weight, now);
    impG.gain.exponentialRampToValueAtTime(0.0008, now + 0.008);
    imp.connect(impFilt).connect(impG);
    this.routeToBus(impG, 'weapons', 0.04, stereoPan);
    imp.start(now, Math.random() * 0.4);
    imp.stop(now + 0.015);

    const modes = surface === 'metal' ? [4120, 5680, 7450, 9620] : [3820, 5290, 6940, 9180];
    const amps = [0.065, 0.046, 0.028, 0.016];
    const dur = 0.088 * surfRing;
    modes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * jitter, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(amps[idx] * weight, now);
      g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
      osc.connect(g);
      this.routeToBus(g, 'weapons', 0.06, stereoPan);
      osc.start(now);
      osc.stop(now + dur + 0.01);
    });
  }

  public playExplosion(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.pinkNoiseBuf ?? this.noiseBuffer(ctx, 0.65);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(620, now);
    filt.frequency.exponentialRampToValueAtTime(42, now + 0.56);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.62, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.60);
    src.connect(filt).connect(g);
    this.routeToBus(g, 'effects', 0.45);
    src.start(now);
    src.stop(now + 0.62);
  }

  public playBlink(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(1400, now + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.24, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.14);
    osc.connect(g);
    this.routeToBus(g, 'effects', 0.08);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playHurt(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.14);
    osc.connect(g);
    this.routeToBus(g, 'effects', 0.04);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playFootstep(
    surface: 'concrete' | 'metal' | 'snow' = 'concrete',
    speedRatio = 1.0,
    parity = 0,
  ): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const stepPitch = (parity % 2 === 0 ? 0.96 : 1.04) * (0.96 + Math.random() * 0.08);
    const intensity = Math.max(0.18, Math.min(1.15, speedRatio));

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const baseLow = surface === 'metal' ? 135 : surface === 'snow' ? 92 : 112;
    osc.frequency.setValueAtTime(baseLow * stepPitch, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.055);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.095 * intensity, now);
    og.gain.exponentialRampToValueAtTime(0.0008, now + 0.062);
    osc.connect(og);
    this.routeToBus(og, 'movement', Math.min(0.14, this.currentEnv.earlyGain * 0.25));
    osc.start(now);
    osc.stop(now + 0.068);

    const dur = surface === 'snow' ? 0.085 : 0.055;
    const src = ctx.createBufferSource();
    src.buffer = this.pinkNoiseBuf ?? this.noiseBuffer(ctx, dur + 0.015);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    const centerFreq = surface === 'metal' ? 2150 : surface === 'snow' ? 1580 : 1180;
    filt.frequency.setValueAtTime(centerFreq * stepPitch, now);
    filt.Q.value = surface === 'metal' ? 3.2 : surface === 'snow' ? 1.4 : 1.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime((surface === 'snow' ? 0.072 : 0.088) * intensity, now);
    ng.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    src.connect(filt).connect(ng);
    this.routeToBus(ng, 'movement', 0.06);
    src.start(now, Math.random() * 0.4);
    src.stop(now + dur + 0.015);
  }

  public playJump(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(165, now + 0.075);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.105, now);
    og.gain.exponentialRampToValueAtTime(0.0008, now + 0.085);
    osc.connect(og);
    this.routeToBus(og, 'movement', 0.04);
    osc.start(now);
    osc.stop(now + 0.09);

    const src = ctx.createBufferSource();
    src.buffer = this.pinkNoiseBuf ?? this.noiseBuffer(ctx, 0.08);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(780, now);
    filt.Q.value = 1.5;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.065, now);
    ng.gain.exponentialRampToValueAtTime(0.0008, now + 0.075);
    src.connect(filt).connect(ng);
    this.routeToBus(ng, 'movement', 0.04);
    src.start(now, Math.random() * 0.4);
    src.stop(now + 0.085);
  }

  public playLand(impactSpeed = 5.5): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const weight = Math.max(0.25, Math.min(1.25, impactSpeed / 7.5));

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(128, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.11);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.18 * weight, now);
    og.gain.exponentialRampToValueAtTime(0.0008, now + 0.12);
    osc.connect(og);
    this.routeToBus(og, 'movement', 0.08);
    osc.start(now);
    osc.stop(now + 0.13);

    const src = ctx.createBufferSource();
    src.buffer = this.pinkNoiseBuf ?? this.noiseBuffer(ctx, 0.11);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(980, now);
    filt.frequency.exponentialRampToValueAtTime(240, now + 0.1);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.14 * weight, now);
    ng.gain.exponentialRampToValueAtTime(0.0008, now + 0.105);
    src.connect(filt).connect(ng);
    this.routeToBus(ng, 'movement', 0.08);
    src.start(now, Math.random() * 0.4);
    src.stop(now + 0.115);
  }

  public playBodyThud(impactSpeed = 4.0, stereoPan = 0): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const weight = Math.max(0.25, Math.min(1.2, impactSpeed / 5.5));

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.22 * weight, now);
    og.gain.exponentialRampToValueAtTime(0.0008, now + 0.13);
    osc.connect(og);
    this.routeToBus(og, 'movement', 0.12, stereoPan);
    osc.start(now);
    osc.stop(now + 0.14);

    const src = ctx.createBufferSource();
    src.buffer = this.pinkNoiseBuf ?? this.noiseBuffer(ctx, 0.12);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(620, now);
    filt.Q.value = 1.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.11 * weight, now);
    ng.gain.exponentialRampToValueAtTime(0.0008, now + 0.105);
    src.connect(filt).connect(ng);
    this.routeToBus(ng, 'movement', 0.08, stereoPan);
    src.start(now, Math.random() * 0.4);
    src.stop(now + 0.12);
  }

  public playVoteBallot(yes: boolean): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = yes ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(yes ? 880 : 260, now);
    osc.frequency.exponentialRampToValueAtTime(yes ? 1040 : 190, now + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.09);
    osc.connect(g);
    this.routeToBus(g, 'voice', 0);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  public playAdminAlarm(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.22;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(640, t);
      osc.frequency.linearRampToValueAtTime(980, t + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.20, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.19);
      osc.connect(g);
      this.routeToBus(g, 'voice', 0.06);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  }

  public playUi(kind: 'click' | 'buy' | 'deny' | 'open' | 'tick' | 'cash' | 'message'): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const tone = (f1: number, f2: number, dur: number, type: OscillatorType, vol: number, delay = 0) => {
      const t = now + delay;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f1, t);
      osc.frequency.exponentialRampToValueAtTime(f2, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      osc.connect(g);
      this.routeToBus(g, 'ui', 0);
      osc.start(t);
      osc.stop(t + dur + 0.01);
    };

    switch (kind) {
      case 'click':
        tone(780, 520, 0.035, 'square', 0.1);
        break;
      case 'open':
        tone(420, 740, 0.07, 'triangle', 0.14);
        break;
      case 'deny':
        tone(190, 110, 0.14, 'sawtooth', 0.18);
        break;
      case 'tick':
        tone(1100, 900, 0.025, 'triangle', 0.11);
        break;
      case 'message':
        tone(660, 880, 0.06, 'sine', 0.12);
        break;
      case 'buy':
        tone(523.25, 659.25, 0.09, 'triangle', 0.22, 0);
        tone(783.99, 1046.5, 0.16, 'triangle', 0.24, 0.07);
        break;
      case 'cash':
        tone(987.77, 1318.5, 0.12, 'sine', 0.24, 0);
        tone(1567.98, 2093, 0.2, 'sine', 0.2, 0.06);
        break;
    }
  }

  public playCaseReveal(rarity: SkinRarity): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const chords: Record<SkinRarity, number[]> = {
      common: [330, 392],
      uncommon: [392, 493.88, 587.33],
      rare: [440, 554.37, 659.25, 880],
      epic: [523.25, 659.25, 783.99, 1046.5],
      legendary: [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98],
    };
    const notes = chords[rarity];
    notes.forEach((f, idx) => {
      const t = now + idx * 0.06;
      const osc = ctx.createOscillator();
      osc.type = rarity === 'legendary' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(f, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(rarity === 'legendary' ? 0.22 : 0.18, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.45);
      osc.connect(g);
      this.routeToBus(g, 'ui', 0.08);
      osc.start(t);
      osc.stop(t + 0.48);
    });
  }

  public playSndEvent(event: SndAudioEvent, intensity = 1): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const note = (f1: number, f2: number, dur: number, type: OscillatorType, vol: number, delay = 0) => {
      const t = now + delay;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f1, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(25, f2), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol * intensity, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      osc.connect(g);
      this.routeToBus(g, 'objectives', 0.06);
      osc.start(t);
      osc.stop(t + dur + 0.01);
    };

    switch (event) {
      case 'round_start':
        note(392, 392, 0.12, 'triangle', 0.16, 0);
        note(523.25, 587.33, 0.22, 'triangle', 0.2, 0.1);
        break;
      case 'buy_tick':
        note(980, 920, 0.04, 'sine', 0.08, 0);
        break;
      case 'plant_beep':
        note(1760, 1760, 0.05, 'square', 0.09, 0);
        break;
      case 'bomb_planted':
        note(880, 880, 0.08, 'sine', 0.2, 0);
        note(1318.5, 1318.5, 0.18, 'sine', 0.22, 0.1);
        break;
      case 'bomb_beep':
        note(2480, 2420, 0.055, 'sine', 0.11, 0);
        break;
      case 'defuse_start':
        note(640, 420, 0.07, 'triangle', 0.14, 0);
        note(920, 1180, 0.07, 'sine', 0.12, 0.06);
        break;
      case 'bomb_defused':
        note(523.25, 523.25, 0.1, 'triangle', 0.2, 0);
        note(659.25, 659.25, 0.12, 'triangle', 0.2, 0.09);
        note(1046.5, 1046.5, 0.28, 'sine', 0.24, 0.18);
        break;
      case 'bomb_detonate':
        this.playExplosion();
        note(95, 24, 0.75, 'sawtooth', 0.42, 0);
        break;
      case 'round_win':
        note(523.25, 523.25, 0.12, 'triangle', 0.2, 0);
        note(659.25, 659.25, 0.12, 'triangle', 0.2, 0.11);
        note(783.99, 783.99, 0.26, 'triangle', 0.22, 0.22);
        break;
      case 'round_loss':
        note(349.23, 329.63, 0.18, 'sawtooth', 0.15, 0);
        note(261.63, 220, 0.3, 'sawtooth', 0.15, 0.16);
        break;
      case 'side_switch':
        note(440, 659.25, 0.14, 'triangle', 0.2, 0);
        note(659.25, 880, 0.22, 'triangle', 0.2, 0.12);
        break;
      case 'match_win':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => note(f, f, 0.26, 'triangle', 0.24, idx * 0.09));
        break;
      case 'match_loss':
        [392, 349.23, 311.13, 261.63].forEach((f, idx) => note(f, f * 0.96, 0.24, 'sawtooth', 0.17, idx * 0.12));
        break;
      case 'bomb_pickup':
        note(620, 940, 0.08, 'triangle', 0.15, 0);
        break;
    }
  }
}

export const sfx = new SfxEngine();
