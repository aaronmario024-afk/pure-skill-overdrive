import { WeaponDef } from '../data/weapons';

export type WeaponSoundId = WeaponDef['soundType'];

export type WeaponMechEvent =
  | 'holster'
  | 'equip_rustle'
  | 'equip_rack'
  | 'mag_release'
  | 'mag_out'
  | 'mag_in'
  | 'mag_slap'
  | 'bolt_pull'
  | 'bolt_release'
  | 'pump_back'
  | 'pump_fwd'
  | 'bolt_lift'
  | 'bolt_lock'
  | 'reload_end'
  | 'dry_fire'
  | 'inspect_whoosh'
  | 'scope_click'
  | 'knife_draw'
  | 'shell_insert'
  | 'press_check'
  | 'knife_spin';

export interface ShotLayerPCM {
  attack: Float32Array<ArrayBuffer>;
  body: Float32Array<ArrayBuffer>;
  mech: Float32Array<ArrayBuffer>;
  sampleRate: number;
}

export interface ReferenceShotPCM {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

export interface StereoShotLayerPCM {
  attackL: Float32Array<ArrayBuffer>;
  attackR: Float32Array<ArrayBuffer>;
  bodyL: Float32Array<ArrayBuffer>;
  bodyR: Float32Array<ArrayBuffer>;
  mech: Float32Array<ArrayBuffer>;
  sampleRate: number;
}

export interface BufferStats {
  peak: number;
  rms: number;
  rmsDb: number;
  centroidHz: number;
  durationSec: number;
}

export class VariationSelector {
  private lastIdx = new Map<string, number>();

  public next(key: string, count: number, deterministicSeed?: number): number {
    if (count <= 1) return 0;
    const prev = this.lastIdx.get(key) ?? -1;
    let pick: number;
    if (deterministicSeed !== undefined) {
      const s = Math.abs(Math.imul(deterministicSeed | 0, 2654435761)) >>> 0;
      pick = s % count;
      if (pick === prev) pick = (pick + 1 + (s % (count - 1))) % count;
    } else {
      pick = Math.floor(Math.random() * count);
      if (pick === prev) {
        pick = (pick + 1 + Math.floor(Math.random() * (count - 1))) % count;
      }
    }
    this.lastIdx.set(key, pick);
    return pick;
  }

  public reset(): void {
    this.lastIdx.clear();
  }
}

export function allocF32(len: number): Float32Array<ArrayBuffer> {
  return new Float32Array(new ArrayBuffer(len * 4));
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function softClip(x: number, drive: number): number {
  if (drive <= 0.01) return x;
  const d = drive;
  return Math.tanh(x * d + 0.08 * x * x) / Math.tanh(d);
}

class OfflineBiquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    type: 'lowpass' | 'highpass' | 'bandpass' | 'peaking',
    freqHz: number,
    q: number,
    sampleRate: number,
    gainDb = 0,
  ) {
    const f = Math.max(20, Math.min(sampleRate * 0.45, freqHz));
    const w0 = (2 * Math.PI * f) / sampleRate;
    const cosW = Math.cos(w0);
    const sinW = Math.sin(w0);
    const alpha = sinW / (2 * Math.max(0.1, q));
    let a0 = 1;

    if (type === 'lowpass') {
      this.b0 = (1 - cosW) * 0.5;
      this.b1 = 1 - cosW;
      this.b2 = (1 - cosW) * 0.5;
      a0 = 1 + alpha;
      this.a1 = -2 * cosW;
      this.a2 = 1 - alpha;
    } else if (type === 'highpass') {
      this.b0 = (1 + cosW) * 0.5;
      this.b1 = -(1 + cosW);
      this.b2 = (1 + cosW) * 0.5;
      a0 = 1 + alpha;
      this.a1 = -2 * cosW;
      this.a2 = 1 - alpha;
    } else if (type === 'bandpass') {
      this.b0 = alpha;
      this.b1 = 0;
      this.b2 = -alpha;
      a0 = 1 + alpha;
      this.a1 = -2 * cosW;
      this.a2 = 1 - alpha;
    } else {
      const A = Math.pow(10, gainDb / 40);
      this.b0 = 1 + alpha * A;
      this.b1 = -2 * cosW;
      this.b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      this.a1 = -2 * cosW;
      this.a2 = 1 - alpha / A;
    }

    const invA0 = 1 / a0;
    this.b0 *= invA0;
    this.b1 *= invA0;
    this.b2 *= invA0;
    this.a1 *= invA0;
    this.a2 *= invA0;
  }

  public process(buf: Float32Array): void {
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i];
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1;
      this.x1 = x;
      this.y2 = this.y1;
      this.y1 = y;
      buf[i] = y;
    }
  }
}

function makeNoiseBuf(len: number, sampleRate: number, pinkness: number, rng: () => number): Float32Array<ArrayBuffer> {
  const out = allocF32(len);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.16;
    b6 = w * 0.115926;
    out[i] = w * (1 - pinkness) + pink * pinkness;
  }
  void sampleRate;
  return out;
}

function addFilteredNoiseSweep(
  dst: Float32Array,
  sampleRate: number,
  startSec: number,
  durSec: number,
  fStart: number,
  fEnd: number,
  q: number,
  amp: number,
  pinkness: number,
  rng: () => number,
): void {
  const startIdx = Math.max(0, Math.floor(startSec * sampleRate));
  const count = Math.min(dst.length - startIdx, Math.floor(durSec * sampleRate));
  if (count <= 8) return;

  // Time-varying 2-pole SVF bandpass sweep
  let low = 0;
  let band = 0;
  let b0 = 0, b1 = 0, b2 = 0;
  const damp = 1 / Math.max(0.6, q);
  const fadeSamples = Math.min(Math.floor(count * 0.3), Math.floor(sampleRate * 0.008));

  for (let i = 0; i < count; i++) {
    const u = i / count;
    const fc = fStart * Math.pow(fEnd / Math.max(40, fStart), u);
    const f = 2 * Math.sin(Math.PI * Math.min(fc, sampleRate * 0.42) / sampleRate);
    const w = rng() * 2 - 1;
    b0 = 0.997 * b0 + w * 0.055;
    b1 = 0.985 * b1 + w * 0.095;
    b2 = 0.950 * b2 + w * 0.175;
    const src = w * (1 - pinkness) + (b0 + b1 + b2) * 0.36 * pinkness;

    low += f * band;
    const high = src - low - damp * band;
    band += f * high;

    let env = Math.sin(Math.min(1, u * 4.5) * (Math.PI * 0.5)) * Math.exp(-u * 2.8);
    if (i < fadeSamples) env *= 0.5 * (1 - Math.cos((Math.PI * i) / fadeSamples));
    const rem = count - 1 - i;
    if (rem < fadeSamples) env *= 0.5 * (1 - Math.cos((Math.PI * rem) / fadeSamples));
    dst[startIdx + i] += Math.max(-1.5, Math.min(1.5, band)) * amp * env;
  }
}

function addModalCluster(
  dst: Float32Array,
  sampleRate: number,
  startSec: number,
  modesHz: number[],
  decaySec: number,
  amp: number,
  rng: () => number,
  attackMs = 0.6,
): void {
  const startIdx = Math.max(0, Math.floor(startSec * sampleRate));
  const durSec = Math.min((dst.length - startIdx) / sampleRate, decaySec * 4.5);
  const count = Math.floor(durSec * sampleRate);
  if (count <= 4 || modesHz.length === 0) return;

  const atkSamples = Math.max(1, Math.floor((attackMs / 1000) * sampleRate));
  const phases = modesHz.map(() => rng() * Math.PI * 2);
  const omegas = modesHz.map((f) => (2 * Math.PI * f) / sampleRate);
  const perModeAmp = amp / Math.sqrt(modesHz.length);

  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t / Math.max(0.002, decaySec)) * (i < atkSamples ? i / atkSamples : 1);
    let s = 0;
    for (let m = 0; m < modesHz.length; m++) {
      // Slight faster decay for upper modes
      const mAtten = 1 / (1 + m * 0.28);
      s += Math.sin(phases[m] + omegas[m] * i) * mAtten;
    }
    dst[startIdx + i] += s * perModeAmp * env;
  }
}

function addNWaveCrack(
  dst: Float32Array,
  sampleRate: number,
  startSec: number,
  halfWidthSec: number,
  amp: number,
): void {
  const startIdx = Math.max(0, Math.floor(startSec * sampleRate));
  const totalSec = halfWidthSec * 2.8;
  const count = Math.min(dst.length - startIdx, Math.floor(totalSec * sampleRate));
  const guard = Math.max(3, Math.floor(sampleRate * 0.00018));
  for (let i = 0; i < count; i++) {
    const u = i / Math.max(1, halfWidthSec * sampleRate);
    // Asymmetric supersonic N-wave pulse (sharp positive compression -> negative rarefaction tail)
    let val = u <= 1.0 ? 1 - u : (u - 1) > 0.9 ? Math.max(0, -(1 - (u - 1) * 0.5)) * 0.55 : -(1 - (u - 1) * 0.5);
    val *= Math.exp(-u * 0.85);
    if (i < guard) val *= i / guard;
    dst[startIdx + i] += val * amp;
  }
}

function addPitchDropOsc(
  dst: Float32Array,
  sampleRate: number,
  startSec: number,
  fStart: number,
  fEnd: number,
  durSec: number,
  amp: number,
  waveform: 'sine' | 'triangle' = 'sine',
): void {
  const startIdx = Math.max(0, Math.floor(startSec * sampleRate));
  const count = Math.min(dst.length - startIdx, Math.floor(durSec * sampleRate));
  if (count <= 4) return;
  const atk = Math.max(2, Math.floor(sampleRate * 0.0012));
  let phase = 0;
  for (let i = 0; i < count; i++) {
    const u = i / count;
    const freq = fStart * Math.pow(fEnd / Math.max(18, fStart), Math.pow(u, 0.72));
    phase += (2 * Math.PI * freq) / sampleRate;
    const raw =
      waveform === 'sine'
        ? Math.sin(phase)
        : (2 / Math.PI) * Math.asin(Math.sin(phase));
    const env = (i < atk ? i / atk : 1) * Math.pow(1 - u, 1.35);
    dst[startIdx + i] += raw * amp * env;
  }
}

function applyEdges(buf: Float32Array, sampleRate: number, fadeInMs: number, fadeOutMs: number): void {
  const fIn = Math.min(Math.floor(buf.length * 0.25), Math.floor((fadeInMs / 1000) * sampleRate));
  const fOut = Math.min(Math.floor(buf.length * 0.35), Math.floor((fadeOutMs / 1000) * sampleRate));
  for (let i = 0; i < fIn; i++) {
    buf[i] *= 0.5 * (1 - Math.cos((Math.PI * i) / fIn));
  }
  for (let i = 0; i < fOut; i++) {
    const idx = buf.length - 1 - i;
    buf[idx] *= 0.5 * (1 - Math.cos((Math.PI * i) / fOut));
  }
}

function normalizeBuffer(buf: Float32Array<ArrayBuffer>, targetRms: number, peakCeiling = 0.92): void {
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const s = buf[i];
    sumSq += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  if (sumSq < 1e-12 || peak < 1e-7) return;
  const curRms = Math.sqrt(sumSq / buf.length);
  const scale = targetRms / curRms;
  let postPeak = peak * scale;
  if (postPeak <= peakCeiling) {
    for (let i = 0; i < buf.length; i++) buf[i] *= scale;
  } else {
    // Soft-limit excess peaks smoothly without crushing RMS character
    const safeScale = Math.min(scale, (peakCeiling * 1.45) / peak);
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i] * safeScale;
      buf[i] = Math.tanh(x / peakCeiling) * peakCeiling;
    }
  }
}

export function measureBufferStats(buf: Float32Array, sampleRate: number): BufferStats {
  let sumSq = 0;
  let peak = 0;
  let diffSq = 0;
  let prev = 0;
  for (let i = 0; i < buf.length; i++) {
    const s = buf[i];
    sumSq += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
    if (i > 0) {
      const d = s - prev;
      diffSq += d * d;
    }
    prev = s;
  }
  const rms = buf.length > 0 ? Math.sqrt(sumSq / buf.length) : 0;
  const rmsDb = rms > 1e-7 ? 20 * Math.log10(rms) : -120;
  // Accurate time-domain spectral centroid estimator: fc = (sr / (2 * PI)) * sqrt(E[dx^2] / E[x^2])
  const centroidHz =
    sumSq > 1e-12 ? (sampleRate / (2 * Math.PI)) * Math.sqrt(diffSq / sumSq) : 0;
  return {
    peak,
    rms,
    rmsDb,
    centroidHz,
    durationSec: buf.length / sampleRate,
  };
}

export function synthesizeGunshotPCM(
  weapon: WeaponSoundId,
  variationIndex: number,
  sampleRate = 44100,
): ShotLayerPCM {
  const v = variationIndex & 3;
  const hashId =
    weapon.split('').reduce((acc, ch, i) => acc + ch.charCodeAt(0) * (i + 17), 0) * 97 + v * 131071;
  const rng = mulberry32(hashId + 4219);
  const pitchVar = 0.978 + v * 0.015 + (rng() - 0.5) * 0.012;

  if (weapon === 'knife') {
    const len = Math.floor(sampleRate * 0.17);
    const attack = allocF32(len);
    const body = allocF32(len);
    const mech = allocF32(Math.floor(sampleRate * 0.04));
    addFilteredNoiseSweep(attack, sampleRate, 0.001, 0.145, 2200 * pitchVar, 480, 1.5, 0.72, 0.35, rng);
    addModalCluster(body, sampleRate, 0.006, [3400 * pitchVar, 5200 * pitchVar, 7800], 0.022, 0.18, rng, 1.2);
    addFilteredNoiseSweep(body, sampleRate, 0.01, 0.13, 1450 * pitchVar, 360, 1.2, 0.5, 0.6, rng);
    applyEdges(attack, sampleRate, 1.0, 10);
    applyEdges(body, sampleRate, 1.0, 10);
    normalizeBuffer(attack, 0.075, 0.55);
    normalizeBuffer(body, 0.055, 0.45);
    return { attack, body, mech, sampleRate };
  }

  interface GunRecipe {
    durSec: number;
    nWaveMs: number;
    nWaveAmp: number;
    crackHpHz: number;
    crackPeakHz: number;
    crackDecaySec: number;
    crackRms: number;
    formant1Hz: number;
    formant2Hz: number;
    roarEndHz: number;
    bodyDecaySec: number;
    subStartHz: number;
    subEndHz: number;
    subDurSec: number;
    subAmp: number;
    bodyRms: number;
    mechDelaySec: number;
    mechModes: number[];
    mechDecaySec: number;
    mechRms: number;
    drive: number;
    springModes?: number[];
    suppressed?: boolean;
  }

  const RECIPES: Record<Exclude<WeaponSoundId, 'knife'>, GunRecipe> = {
    pistol: {
      durSec: 0.28,
      nWaveMs: 1.9, nWaveAmp: 0.94,
      crackHpHz: 1450, crackPeakHz: 2650, crackDecaySec: 0.024, crackRms: 0.145,
      formant1Hz: 340, formant2Hz: 1180, roarEndHz: 160, bodyDecaySec: 0.17,
      subStartHz: 180, subEndHz: 46, subDurSec: 0.12, subAmp: 0.76,
      bodyRms: 0.165,
      mechDelaySec: 0.016, mechModes: [2450, 3920, 5820], mechDecaySec: 0.014, mechRms: 0.048,
      drive: 2.3,
    },
    smg: {
      durSec: 0.17,
      nWaveMs: 1.1, nWaveAmp: 0.42,
      crackHpHz: 2800, crackPeakHz: 4200, crackDecaySec: 0.015, crackRms: 0.082,
      formant1Hz: 265, formant2Hz: 3200, roarEndHz: 185, bodyDecaySec: 0.08,
      subStartHz: 165, subEndHz: 58, subDurSec: 0.06, subAmp: 0.36,
      bodyRms: 0.064,
      mechDelaySec: 0.011, mechModes: [2820, 4420, 6240], mechDecaySec: 0.016, mechRms: 0.064,
      drive: 1.5,
      suppressed: true,
    },
    shotgun: {
      durSec: 0.52,
      nWaveMs: 4.5, nWaveAmp: 1.12,
      crackHpHz: 950, crackPeakHz: 1850, crackDecaySec: 0.036, crackRms: 0.168,
      formant1Hz: 220, formant2Hz: 780, roarEndHz: 75, bodyDecaySec: 0.36,
      subStartHz: 120, subEndHz: 26, subDurSec: 0.27, subAmp: 0.94,
      bodyRms: 0.21,
      mechDelaySec: 0.024, mechModes: [410, 1180, 2150], mechDecaySec: 0.024, mechRms: 0.044,
      drive: 2.7,
    },
    ssg: {
      durSec: 0.44,
      nWaveMs: 2.6, nWaveAmp: 1.0,
      crackHpHz: 1750, crackPeakHz: 3400, crackDecaySec: 0.028, crackRms: 0.165,
      formant1Hz: 480, formant2Hz: 1650, roarEndHz: 115, bodyDecaySec: 0.27,
      subStartHz: 138, subEndHz: 32, subDurSec: 0.21, subAmp: 0.78,
      bodyRms: 0.17,
      mechDelaySec: 0.022, mechModes: [1650, 2900, 4300], mechDecaySec: 0.018, mechRms: 0.044,
      drive: 2.4,
    },
    rifle: {
      durSec: 0.34,
      nWaveMs: 2.8, nWaveAmp: 1.02,
      crackHpHz: 1250, crackPeakHz: 2150, crackDecaySec: 0.026, crackRms: 0.155,
      formant1Hz: 310, formant2Hz: 980, roarEndHz: 115, bodyDecaySec: 0.22,
      subStartHz: 158, subEndHz: 38, subDurSec: 0.15, subAmp: 0.82,
      bodyRms: 0.185,
      mechDelaySec: 0.020, mechModes: [690, 1820, 3360, 5120], mechDecaySec: 0.020, mechRms: 0.056,
      drive: 2.6,
    },
    m4: {
      durSec: 0.28,
      nWaveMs: 1.7, nWaveAmp: 0.96,
      crackHpHz: 2050, crackPeakHz: 3550, crackDecaySec: 0.020, crackRms: 0.165,
      formant1Hz: 860, formant2Hz: 2350, roarEndHz: 175, bodyDecaySec: 0.16,
      subStartHz: 182, subEndHz: 48, subDurSec: 0.11, subAmp: 0.56,
      bodyRms: 0.148,
      mechDelaySec: 0.015, mechModes: [2320, 4150, 5950], mechDecaySec: 0.015, mechRms: 0.048,
      drive: 2.2,
      springModes: [295, 860],
    },
    sniper: {
      durSec: 0.68,
      nWaveMs: 3.6, nWaveAmp: 1.18,
      crackHpHz: 1450, crackPeakHz: 2950, crackDecaySec: 0.038, crackRms: 0.195,
      formant1Hz: 210, formant2Hz: 890, roarEndHz: 62, bodyDecaySec: 0.48,
      subStartHz: 105, subEndHz: 23, subDurSec: 0.34, subAmp: 0.96,
      bodyRms: 0.225,
      mechDelaySec: 0.026, mechModes: [145, 390, 1380, 2750], mechDecaySec: 0.026, mechRms: 0.046,
      drive: 2.8,
    },
  };

  const r = RECIPES[weapon];
  const atkLen = Math.floor(sampleRate * 0.085);
  const bodyLen = Math.floor(sampleRate * r.durSec);
  const mechLen = Math.floor(sampleRate * 0.14);

  const attack = allocF32(atkLen);
  const body = allocF32(bodyLen);
  const mech = allocF32(mechLen);

  // Layer 1: Attack (N-wave compression pulse + high-SPL supersonic crack noise)
  addNWaveCrack(attack, sampleRate, 0.0005, (r.nWaveMs / 1000) * pitchVar, r.nWaveAmp);
  const crackNoise = makeNoiseBuf(atkLen, sampleRate, r.suppressed ? 0.25 : 0.08, rng);
  new OfflineBiquad('highpass', r.crackHpHz * pitchVar, 0.8, sampleRate).process(crackNoise);
  new OfflineBiquad('peaking', r.crackPeakHz * pitchVar, 1.6, sampleRate, r.suppressed ? 5 : 8).process(crackNoise);
  for (let i = 0; i < atkLen; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t / r.crackDecaySec);
    attack[i] = softClip(attack[i] + crackNoise[i] * env * 0.95, r.drive);
  }
  applyEdges(attack, sampleRate, 0.15, 10);
  normalizeBuffer(attack, r.crackRms, 0.46);

  // Layer 2: Chamber blast body (dual formant pink/white roar + sub-bass pressure drop)
  const rawRoar = makeNoiseBuf(bodyLen, sampleRate, 0.62, rng);
  const roarA = allocF32(bodyLen);
  const roarB = allocF32(bodyLen);
  roarA.set(rawRoar);
  roarB.set(rawRoar);
  new OfflineBiquad('bandpass', r.formant1Hz * pitchVar, 1.35, sampleRate).process(roarA);
  new OfflineBiquad('bandpass', r.formant2Hz * pitchVar, 1.5, sampleRate).process(roarB);
  for (let i = 0; i < bodyLen; i++) {
    const t = i / sampleRate;
    const envSlow = Math.exp(-t / r.bodyDecaySec);
    const envFast = Math.exp(-t / (r.bodyDecaySec * 0.36));
    body[i] += softClip(roarA[i] * envSlow * 1.45 + roarB[i] * envFast * (r.suppressed ? 1.1 : 1.05), r.drive * 0.82);
  }
  addFilteredNoiseSweep(
    body,
    sampleRate,
    0.002,
    r.bodyDecaySec * 1.3,
    r.formant2Hz * 0.85 * pitchVar,
    r.roarEndHz,
    0.9,
    r.suppressed ? 0.25 : 0.72,
    0.65,
    rng,
  );
  addPitchDropOsc(body, sampleRate, 0.001, r.subStartHz * pitchVar, r.subEndHz, r.subDurSec, r.subAmp, r.suppressed ? 'sine' : 'triangle');
  if (r.suppressed) {
    // Subdued baffle turbulence tail for Wasp MP-9
    addFilteredNoiseSweep(body, sampleRate, 0.004, 0.078, 7600 * pitchVar, 2800, 1.1, 0.42, 0.1, rng);
  }
  applyEdges(body, sampleRate, 0.4, 14);
  normalizeBuffer(body, r.bodyRms, 0.46);

  // Layer 3: Broadband Mechanical Bolt / Slide / Action Cycle
  const mProf = getMechMaterialProfile(weapon);
  addMetalClack(
    mech,
    sampleRate,
    r.mechDelaySec,
    mProf.metalHz * pitchVar,
    mProf.bodyHz * pitchVar,
    mProf.combMs,
    Math.min(0.4, mProf.combFb),
    10,
    2,
    0.85,
    rng,
  );
  addBodyImpact(
    mech,
    sampleRate,
    r.mechDelaySec + 0.002,
    0.045,
    mProf.bodyHz * pitchVar,
    1.2,
    2400,
    0.65,
    1.5,
    rng,
  );
  if (r.springModes) {
    // M4 buffer-tube spring noise-zip texture
    addStickSlipFriction(
      mech,
      sampleRate,
      0.02,
      0.065,
      [520 * pitchVar, 1650 * pitchVar],
      2800,
      260,
      0.34,
      rng,
      true,
    );
  }
  applyEdges(mech, sampleRate, 0.4, 8);
  normalizeBuffer(mech, r.mechRms, 0.28);

  return { attack, body, mech, sampleRate };
}

interface MechMaterialProfile {
  bodyHz: number;
  metalHz: number;
  combMs: number;
  combFb: number;
  gritDensity: number;
}

function getMechMaterialProfile(weaponId: string): MechMaterialProfile {
  switch (weaponId) {
    case 'rifle':
      // Stamped steel AK: deeper receiver cavity, crisp steel-on-steel rail clack
      return { bodyHz: 310, metalHz: 2650, combMs: 1.15, combFb: 0.42, gritDensity: 190 };
    case 'm4':
      // Anodized aluminum AR-15: brighter hollow upper/lower cavity, snappy steel latch
      return { bodyHz: 440, metalHz: 3550, combMs: 0.85, combFb: 0.38, gritDensity: 230 };
    case 'pistol':
      // Compact steel slide on polymer frame: higher cavity, rapid dry crisp click
      return { bodyHz: 520, metalHz: 4100, combMs: 0.72, combFb: 0.34, gritDensity: 260 };
    case 'smg':
      // Polymer-housed compact SMG: matte plastic thump, shorter damped metallic bite
      return { bodyHz: 390, metalHz: 3150, combMs: 0.92, combFb: 0.28, gritDensity: 210 };
    case 'shotgun':
      // Heavy tubular steel receiver: low cavernous boom & coarse twin action bars
      return { bodyHz: 230, metalHz: 2350, combMs: 1.35, combFb: 0.44, gritDensity: 155 };
    case 'sniper':
    case 'ssg':
      // Precision bolt-action chassis: solid steel mass & deliberate mechanical lugs
      return { bodyHz: 250, metalHz: 2500, combMs: 1.25, combFb: 0.44, gritDensity: 165 };
    default:
      return { bodyHz: 380, metalHz: 3400, combMs: 0.88, combFb: 0.36, gritDensity: 200 };
  }
}

function addBodyImpact(
  dst: Float32Array,
  sampleRate: number,
  startSec: number,
  durSec: number,
  bodyHz: number,
  bodyQ: number,
  cutHz: number,
  amp: number,
  drive: number,
  rng: () => number,
): void {
  const startIdx = Math.max(0, Math.floor(startSec * sampleRate));
  const count = Math.min(dst.length - startIdx, Math.floor(durSec * sampleRate));
  if (count <= 8) return;

  // Broadband percussive body impact (wide peaking chassis punch rather than narrow ringing bandpass)
  const tmp = makeNoiseBuf(count, sampleRate, 0.18, rng);
  const atkSec = 0.00035 + rng() * 0.00065;
  const atkSamples = Math.max(8, Math.floor(atkSec * sampleRate));
  const tau = Math.max(0.004, durSec * 0.20);

  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const atk = i < atkSamples ? Math.pow(i / atkSamples, 0.65) : 1;
    const dec = Math.exp(-t / tau);
    tmp[i] *= atk * dec;
  }

  new OfflineBiquad('highpass', 100, 0.72, sampleRate).process(tmp);
  new OfflineBiquad('peaking', bodyHz, Math.max(0.55, bodyQ * 0.45), sampleRate, 2.8).process(tmp);
  new OfflineBiquad('lowpass', Math.max(2400, cutHz), 0.7, sampleRate).process(tmp);

  const fadeOut = Math.min(Math.floor(count * 0.25), Math.floor(sampleRate * 0.004));
  for (let i = 0; i < count; i++) {
    const outFade = i > count - fadeOut ? (count - 1 - i) / Math.max(1, fadeOut) : 1;
    dst[startIdx + i] += softClip(tmp[i] * 1.65, drive) * amp * outFade;
  }
}

function addMetalClack(
  dst: Float32Array,
  sampleRate: number,
  startSec: number,
  centerHz: number,
  bodyHz: number,
  combDelayMs: number,
  combFeedback: number,
  ringMs: number,
  bounces: number,
  amp: number,
  rng: () => number,
): void {
  const startIdx = Math.max(0, Math.floor(startSec * sampleRate));
  const totalSec = Math.max(0.028, ringMs / 1000 + bounces * 0.011 + 0.014);
  const count = Math.min(dst.length - startIdx, Math.floor(totalSec * sampleRate));
  if (count <= 16) return;

  const impTrain = allocF32(count);
  const bounceWeights = [0.52, 0.24, 0.11];
  const bounceGapsMs = [0, 1.9 + rng() * 2.1, 4.6 + rng() * 3.8, 8.2 + rng() * 4.5];
  const totalImpulses = 1 + Math.max(0, Math.min(3, bounces));

  for (let b = 0; b < totalImpulses; b++) {
    const bStart = Math.floor(((b === 0 ? 0 : bounceGapsMs[b]) / 1000) * sampleRate);
    const bAmp = b === 0 ? 1.0 : bounceWeights[b - 1];
    const pulseLen = Math.max(12, Math.floor((0.00045 + rng() * 0.00095) * sampleRate));
    for (let k = 0; k < pulseLen && bStart + k < count; k++) {
      const u = k / pulseLen;
      const env = Math.sin(u * Math.PI);
      impTrain[bStart + k] += (rng() * 2 - 1) * env * bAmp;
    }
  }

  // Branch A: Crisp broadband mechanical snap (no sinusoidal ringing) + high-frequency steel edge
  const snapBranch = allocF32(count);
  const edgeBranch = allocF32(count);
  snapBranch.set(impTrain);
  edgeBranch.set(impTrain);
  new OfflineBiquad('highpass', Math.max(1200, centerHz * 0.55), 0.8, sampleRate).process(snapBranch);
  new OfflineBiquad('bandpass', centerHz, 1.45, sampleRate).process(snapBranch);
  new OfflineBiquad('highpass', 4200, 0.7, sampleRate).process(edgeBranch);

  // Branch B: Tightly damped structural comb (-8 to -12 dB below contact snap)
  const delayLen = Math.max(4, Math.round((combDelayMs / 1000) * sampleRate));
  const fb = Math.min(0.48, Math.max(0.05, combFeedback));
  const delayLine = allocF32(delayLen);
  const combBranch = allocF32(count);
  let writePtr = 0;
  let lpState = 0;
  const ringTau = Math.max(0.004, (Math.min(16, ringMs) / 1000) * 0.65);

  for (let i = 0; i < count; i++) {
    const x = impTrain[i];
    const delayed = delayLine[writePtr];
    lpState = 0.55 * lpState + 0.45 * delayed;
    const y = x + fb * lpState;
    delayLine[writePtr] = Math.max(-2, Math.min(2, y));
    writePtr = (writePtr + 1) % delayLen;
    combBranch[i] = y * Math.exp(-(i / sampleRate) / ringTau);
  }
  new OfflineBiquad('bandpass', bodyHz, 1.3, sampleRate).process(combBranch);

  const fadeOut = Math.min(Math.floor(count * 0.25), Math.floor(sampleRate * 0.004));
  for (let i = 0; i < count; i++) {
    const outFade = i > count - fadeOut ? (count - 1 - i) / Math.max(1, fadeOut) : 1;
    const snap = softClip(snapBranch[i] * 2.1 + edgeBranch[i] * 0.75, 1.8);
    const body = combBranch[i] * 0.34;
    dst[startIdx + i] += (snap + body) * amp * outFade;
  }
}

function addStickSlipFriction(
  dst: Float32Array,
  sampleRate: number,
  startSec: number,
  durSec: number,
  formantsHz: [number, number],
  gritHz: number,
  grainDensity: number,
  amp: number,
  rng: () => number,
  springZip = false,
): void {
  const startIdx = Math.max(0, Math.floor(startSec * sampleRate));
  const count = Math.min(dst.length - startIdx, Math.floor(durSec * sampleRate));
  if (count <= 16) return;

  // Build stochastic stick-slip micro-asperity modulation envelope along the slide stroke
  const exc = makeNoiseBuf(count, sampleRate, 0.38, rng);
  const microMod = allocF32(count);
  microMod.fill(0.45);
  const grainCount = Math.max(6, Math.floor(durSec * grainDensity));
  for (let g = 0; g < grainCount; g++) {
    const gPos = Math.floor(rng() * Math.max(1, count - 32));
    const gLen = Math.floor((0.0007 + rng() * 0.0015) * sampleRate);
    const gGain = 0.65 + rng() * 1.45;
    for (let k = 0; k < gLen && gPos + k < count; k++) {
      const u = k / gLen;
      microMod[gPos + k] += Math.sin(u * Math.PI) * gGain;
    }
  }
  for (let i = 0; i < count; i++) {
    exc[i] *= microMod[i];
  }

  // Parallel fixed stationary chassis cavity resonators (zero filter sweep!)
  const f1 = allocF32(count);
  const f2 = allocF32(count);
  const grit = allocF32(count);
  f1.set(exc);
  f2.set(exc);
  grit.set(exc);

  new OfflineBiquad('bandpass', formantsHz[0], 1.15, sampleRate).process(f1);
  new OfflineBiquad('bandpass', formantsHz[1], 1.45, sampleRate).process(f2);
  new OfflineBiquad('highpass', gritHz, 0.75, sampleRate).process(grit);

  let zip: Float32Array<ArrayBuffer> | null = null;
  if (springZip) {
    zip = makeNoiseBuf(count, sampleRate, 0.12, rng);
    const zipMod = allocF32(count);
    zipMod.fill(0.22);
    const coilTicks = Math.max(5, Math.floor(durSec * 360));
    for (let c = 0; c < coilTicks; c++) {
      const cPos = Math.floor(rng() * Math.max(1, count - 24));
      const cLen = Math.floor((0.0005 + rng() * 0.0012) * sampleRate);
      const cGain = 0.5 + rng() * 0.9;
      for (let k = 0; k < cLen && cPos + k < count; k++) {
        zipMod[cPos + k] += Math.sin((k / cLen) * Math.PI) * cGain;
      }
    }
    for (let i = 0; i < count; i++) {
      zip[i] *= zipMod[i];
    }
    new OfflineBiquad('highpass', 4200, 0.85, sampleRate).process(zip);
    new OfflineBiquad('lowpass', 7500, 0.85, sampleRate).process(zip);
  }

  const atkSamples = Math.min(Math.floor(count * 0.25), Math.floor(sampleRate * 0.012));
  const relSamples = Math.min(Math.floor(count * 0.3), Math.floor(sampleRate * 0.016));
  for (let i = 0; i < count; i++) {
    const u = i / count;
    let velEnv = 0.7 + 0.3 * Math.sin(u * Math.PI);
    if (i < atkSamples) velEnv *= i / Math.max(1, atkSamples);
    const rem = count - 1 - i;
    if (rem < relSamples) velEnv *= rem / Math.max(1, relSamples);
    const combined = f1[i] * 0.72 + f2[i] * 0.56 + grit[i] * 0.24 + (zip ? zip[i] * 0.24 : 0);
    dst[startIdx + i] += combined * velEnv * amp;
  }
}

function addClothGripFoley(
  dst: Float32Array,
  sampleRate: number,
  startSec: number,
  durSec: number,
  amp: number,
  rng: () => number,
): void {
  const startIdx = Math.max(0, Math.floor(startSec * sampleRate));
  const count = Math.min(dst.length - startIdx, Math.floor(durSec * sampleRate));
  if (count <= 16) return;

  const base = makeNoiseBuf(count, sampleRate, 0.52, rng);
  const warm = allocF32(count);
  const rub = allocF32(count);
  warm.set(base);
  rub.set(base);

  new OfflineBiquad('bandpass', 640, 0.62, sampleRate).process(warm);
  new OfflineBiquad('bandpass', 2850, 0.72, sampleRate).process(rub);

  const phase = rng() * Math.PI * 2;
  const edge = Math.min(Math.floor(count * 0.25), Math.floor(sampleRate * 0.012));
  for (let i = 0; i < count; i++) {
    const u = i / count;
    let env = Math.sin(u * Math.PI) * (0.65 + 0.35 * Math.sin(u * 2.4 * Math.PI + phase));
    if (i < edge) env *= i / Math.max(1, edge);
    const rem = count - 1 - i;
    if (rem < edge) env *= rem / Math.max(1, edge);
    dst[startIdx + i] += (warm[i] * 0.85 + rub[i] * 0.58) * env * amp;
  }
}

function addHollowTubeClick(
  dst: Float32Array,
  sampleRate: number,
  startSec: number,
  scale: number,
  amp: number,
  rng: () => number,
): void {
  // Dry plastic shell hull sliding into magazine tube
  addStickSlipFriction(
    dst,
    sampleRate,
    startSec,
    0.036,
    [1050 * scale, 3100 * scale],
    2200,
    240,
    amp * 0.65,
    rng,
    false,
  );
  // Hollow steel magazine tube resonance thunk
  addBodyImpact(dst, sampleRate, startSec + 0.022, 0.048, 240 * scale, 1.4, 1100, amp * 0.85, 1.3, rng);
  // Crisp spring-steel shell latch capture click
  addMetalClack(dst, sampleRate, startSec + 0.034, 4200 * scale, 980 * scale, 0.9, 0.34, 6, 2, amp, rng);
}

type EQStage = ['lowpass' | 'highpass' | 'bandpass' | 'peaking', number, number, number?];

function findReferenceOnset(left: Float32Array, right: Float32Array, sampleRate: number): number {
  const len = Math.min(left.length, right.length);
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const a = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (a > peak) peak = a;
  }
  if (peak < 1e-6) return 0;
  const thresh = peak * 0.035;
  let first = 0;
  for (let i = 0; i < len; i++) {
    if (Math.max(Math.abs(left[i]), Math.abs(right[i])) >= thresh) {
      first = i;
      break;
    }
  }
  return Math.max(0, first - Math.floor(sampleRate * 0.0015));
}

function resampleWindowLinear(
  src: Float32Array,
  srcRate: number,
  dstRate: number,
  rateRatio: number,
  srcStartIdx: number,
  outLen: number,
): Float32Array<ArrayBuffer> {
  const out = allocF32(outLen);
  const step = (srcRate / Math.max(8000, dstRate)) * Math.max(0.25, rateRatio);
  const maxIdx = src.length - 1;
  if (maxIdx < 1) return out;

  let pos = Math.max(0, srcStartIdx);
  for (let i = 0; i < outLen; i++) {
    const i0 = Math.floor(pos);
    if (i0 >= maxIdx) break;
    const frac = pos - i0;
    out[i] = src[i0] * (1 - frac) + src[i0 + 1] * frac;
    pos += step;
  }
  return out;
}

function processStereoEQ(
  left: Float32Array<ArrayBuffer>,
  right: Float32Array<ArrayBuffer>,
  sampleRate: number,
  stages: EQStage[],
): void {
  for (const [type, freq, q, gainDb] of stages) {
    new OfflineBiquad(type, freq, q, sampleRate, gainDb ?? 0).process(left);
    new OfflineBiquad(type, freq, q, sampleRate, gainDb ?? 0).process(right);
  }
}

function normalizeStereoPair(
  left: Float32Array<ArrayBuffer>,
  right: Float32Array<ArrayBuffer>,
  targetRms: number,
  peakCeiling: number,
): void {
  const len = Math.min(left.length, right.length);
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const l = left[i];
    const r = right[i];
    sumSq += 0.5 * (l * l + r * r);
    const a = Math.max(Math.abs(l), Math.abs(r));
    if (a > peak) peak = a;
  }
  if (sumSq < 1e-12 || peak < 1e-7) return;
  const curRms = Math.sqrt(sumSq / Math.max(1, len));
  const scale = targetRms / curRms;
  if (peak * scale <= peakCeiling) {
    for (let i = 0; i < len; i++) {
      left[i] *= scale;
      right[i] *= scale;
    }
  } else {
    const safeScale = Math.min(scale, (peakCeiling * 1.45) / peak);
    for (let i = 0; i < len; i++) {
      left[i] = Math.tanh((left[i] * safeScale) / peakCeiling) * peakCeiling;
      right[i] = Math.tanh((right[i] * safeScale) / peakCeiling) * peakCeiling;
    }
  }
}

export function deriveGunshotFromReferencePCM(
  ref: ReferenceShotPCM,
  weapon: WeaponSoundId,
  variationIndex: number,
  targetSampleRate = 44100,
): StereoShotLayerPCM {
  const v = variationIndex & 3;
  if (weapon === 'knife') {
    const mono = synthesizeGunshotPCM('knife', v, targetSampleRate);
    const attackR = allocF32(mono.attack.length);
    const bodyR = allocF32(mono.body.length);
    attackR.set(mono.attack);
    bodyR.set(mono.body);
    return {
      attackL: mono.attack,
      attackR,
      bodyL: mono.body,
      bodyR,
      mech: mono.mech,
      sampleRate: targetSampleRate,
    };
  }

  interface RefWeaponProfile {
    transientRate: number;
    bodyRate: number;
    durSec: number;
    hpHz: number;
    lowPeak: [number, number, number];
    barkPeak: [number, number, number];
    crackPeak: [number, number, number];
    lpHz: number;
    drive: number;
    atkRms: number;
    bodyRms: number;
    mechDelaySec: number;
    mechRms: number;
  }

  const PROFILES: Record<Exclude<WeaponSoundId, 'knife'>, RefWeaponProfile> = {
    pistol: {
      transientRate: 1.0,
      bodyRate: 1.0,
      durSec: 0.44,
      hpHz: 35,
      lowPeak: [95, 1.0, 1.5],
      barkPeak: [1150, 1.1, 2.0],
      crackPeak: [3200, 1.2, 2.0],
      lpHz: 15000,
      drive: 1.25,
      atkRms: 0.21,
      bodyRms: 0.20,
      mechDelaySec: 0.016,
      mechRms: 0.048,
    },
    m4: {
      transientRate: 1.32,
      bodyRate: 1.18,
      durSec: 0.38,
      hpHz: 78,
      lowPeak: [140, 1.1, 1.5],
      barkPeak: [1250, 1.1, 3.5],
      crackPeak: [3400, 1.3, 5.5],
      lpHz: 16500,
      drive: 1.65,
      atkRms: 0.22,
      bodyRms: 0.19,
      mechDelaySec: 0.014,
      mechRms: 0.050,
    },
    rifle: {
      transientRate: 0.88,
      bodyRate: 0.84,
      durSec: 0.50,
      hpHz: 42,
      lowPeak: [125, 1.0, 4.5],
      barkPeak: [680, 1.1, 4.5],
      crackPeak: [2800, 1.2, 2.5],
      lpHz: 13500,
      drive: 2.05,
      atkRms: 0.22,
      bodyRms: 0.22,
      mechDelaySec: 0.018,
      mechRms: 0.054,
    },
    smg: {
      transientRate: 1.48,
      bodyRate: 1.42,
      durSec: 0.18,
      hpHz: 170,
      lowPeak: [190, 0.9, -6.0],
      barkPeak: [1400, 1.0, -3.5],
      crackPeak: [3600, 1.1, 2.5],
      lpHz: 4800,
      drive: 1.25,
      atkRms: 0.11,
      bodyRms: 0.085,
      mechDelaySec: 0.009,
      mechRms: 0.072,
    },
    shotgun: {
      transientRate: 0.68,
      bodyRate: 0.64,
      durSec: 0.74,
      hpHz: 30,
      lowPeak: [72, 0.9, 5.5],
      barkPeak: [380, 1.0, 4.0],
      crackPeak: [2200, 1.1, 2.0],
      lpHz: 11500,
      drive: 2.35,
      atkRms: 0.24,
      bodyRms: 0.24,
      mechDelaySec: 0.022,
      mechRms: 0.046,
    },
    ssg: {
      transientRate: 0.95,
      bodyRate: 0.78,
      durSec: 0.66,
      hpHz: 40,
      lowPeak: [115, 1.0, 4.0],
      barkPeak: [950, 1.1, 3.0],
      crackPeak: [3600, 1.3, 5.5],
      lpHz: 16000,
      drive: 1.95,
      atkRms: 0.23,
      bodyRms: 0.21,
      mechDelaySec: 0.020,
      mechRms: 0.046,
    },
    sniper: {
      transientRate: 0.62,
      bodyRate: 0.54,
      durSec: 1.08,
      hpHz: 28,
      lowPeak: [62, 0.9, 6.0],
      barkPeak: [240, 1.0, 4.5],
      crackPeak: [2600, 1.2, 3.5],
      lpHz: 12500,
      drive: 2.45,
      atkRms: 0.25,
      bodyRms: 0.25,
      mechDelaySec: 0.026,
      mechRms: 0.048,
    },
  };

  const cfg = PROFILES[weapon];
  const seed =
    weapon.split('').reduce((acc, ch, i) => acc + ch.charCodeAt(0) * (i + 23), 0) * 131 + v * 104729 + 7919;
  const rng = mulberry32(seed);

  const pitchJitter = 1 + (v - 1.5) * 0.012 + (rng() - 0.5) * 0.016;
  const eqTiltDb = (rng() - 0.5) * 2.2;
  const onset = findReferenceOnset(ref.left, ref.right, ref.sampleRate);
  const stereoSign = rng() < 0.5 ? 1 : -1;
  const stereoOffsetSamples = stereoSign * Math.max(6, Math.round((0.00018 + rng() * 0.00017) * ref.sampleRate));

  const atkLen = Math.floor(targetSampleRate * 0.042);
  const bodyLen = Math.floor(targetSampleRate * cfg.durSec);
  const mechLen = Math.floor(targetSampleRate * 0.14);

  const attackL = resampleWindowLinear(ref.left, ref.sampleRate, targetSampleRate, cfg.transientRate * pitchJitter, onset, atkLen);
  const attackR = resampleWindowLinear(
    ref.right,
    ref.sampleRate,
    targetSampleRate,
    cfg.transientRate * pitchJitter,
    Math.max(0, onset + stereoOffsetSamples),
    atkLen,
  );
  const bodyL = resampleWindowLinear(ref.left, ref.sampleRate, targetSampleRate, cfg.bodyRate * pitchJitter, onset, bodyLen);
  const bodyR = resampleWindowLinear(
    ref.right,
    ref.sampleRate,
    targetSampleRate,
    cfg.bodyRate * pitchJitter,
    Math.max(0, onset + stereoOffsetSamples),
    bodyLen,
  );

  // Weapon-specific physical signatures & acoustic layering
  if (weapon === 'shotgun') {
    // 5.5ms stereo-swapped secondary blast wave + short wad/pellet scatter crackle
    const echoDelay = Math.floor(0.0055 * ref.sampleRate);
    const secL = resampleWindowLinear(ref.right, ref.sampleRate, targetSampleRate, cfg.bodyRate * 0.94 * pitchJitter, onset, bodyLen);
    const secR = resampleWindowLinear(ref.left, ref.sampleRate, targetSampleRate, cfg.bodyRate * 0.94 * pitchJitter, onset + echoDelay, bodyLen);
    const dOut = Math.floor(0.0055 * targetSampleRate);
    for (let i = dOut; i < bodyLen; i++) {
      bodyL[i] += secL[i - dOut] * 0.36;
      bodyR[i] += secR[i - dOut] * 0.36;
    }
    addStickSlipFriction(attackL, targetSampleRate, 0.004, 0.026, [2200, 5600], 3200, 380, 0.24, rng, false);
    addStickSlipFriction(attackR, targetSampleRate, 0.004, 0.026, [2400, 6100], 3200, 380, 0.24, rng, false);
  } else if (weapon === 'smg') {
    // Tight suppressed baffle gas hiss tail in body channels
    addStickSlipFriction(bodyL, targetSampleRate, 0.006, 0.042, [2100, 4400], 3600, 280, 0.28, rng, false);
    addStickSlipFriction(bodyR, targetSampleRate, 0.006, 0.042, [2250, 4600], 3600, 280, 0.28, rng, false);
  } else if (weapon === 'ssg') {
    addNWaveCrack(attackL, targetSampleRate, 0.0005, 0.0014, 0.42);
    addNWaveCrack(attackR, targetSampleRate, 0.0007, 0.0014, 0.42);
  } else if (weapon === 'sniper') {
    // Layer high-velocity supersonic muzzle whip crack (1.12x rate, HPF 1400 Hz) atop .338 sub blast
    const whipLen = Math.min(atkLen, Math.floor(targetSampleRate * 0.028));
    const whipL = resampleWindowLinear(ref.left, ref.sampleRate, targetSampleRate, 1.12 * pitchJitter, onset, whipLen);
    const whipR = resampleWindowLinear(ref.right, ref.sampleRate, targetSampleRate, 1.12 * pitchJitter, Math.max(0, onset + stereoOffsetSamples), whipLen);
    processStereoEQ(whipL, whipR, targetSampleRate, [['highpass', 1400, 0.8]]);
    for (let i = 0; i < whipLen; i++) {
      const taper = i > whipLen * 0.65 ? (whipLen - 1 - i) / Math.max(1, whipLen * 0.35) : 1;
      attackL[i] += whipL[i] * 0.45 * taper;
      attackR[i] += whipR[i] * 0.45 * taper;
    }
    addNWaveCrack(attackL, targetSampleRate, 0.0005, 0.0016, 0.34);
    addNWaveCrack(attackR, targetSampleRate, 0.0007, 0.0016, 0.34);
  }

  // Unity-gain complementary cosine crossfade (14-38ms) between attack and body:
  // attack: 1.0 across 0..14ms, fades down 14..38ms, 0 past 38ms (0.3ms fade-in guard)
  const crossStart = Math.floor(targetSampleRate * 0.014);
  const crossEnd = Math.floor(targetSampleRate * 0.038);
  const crossSpan = Math.max(1, crossEnd - crossStart);
  const atkFadeIn = Math.max(4, Math.floor(targetSampleRate * 0.0003));
  for (let i = 0; i < atkLen; i++) {
    let g = i < atkFadeIn ? i / atkFadeIn : 1;
    if (i >= crossEnd) {
      g = 0;
    } else if (i > crossStart) {
      const u = (i - crossStart) / crossSpan;
      g *= 0.5 * (1 + Math.cos(u * Math.PI));
    }
    attackL[i] *= g;
    attackR[i] *= g;
  }

  // body: 0 before 14ms, fades up 14..38ms, 1.0 until 80%, smooth tail fade 80..100%
  const tailStart = Math.floor(bodyLen * 0.80);
  for (let i = 0; i < bodyLen; i++) {
    let g = 1;
    if (i < crossStart) {
      g = 0;
    } else if (i < crossEnd) {
      const u = (i - crossStart) / crossSpan;
      g = 0.5 * (1 - Math.cos(u * Math.PI));
    } else if (i > tailStart) {
      const u = (i - tailStart) / Math.max(1, bodyLen - tailStart);
      g = Math.cos(u * Math.PI * 0.5);
    }
    bodyL[i] *= g;
    bodyR[i] *= g;
  }

  // Apply independent stereo EQ per weapon profile (with opposite subtle L/R tilt for stereo richness)
  const stages: EQStage[] = [
    ['highpass', cfg.hpHz, 0.72],
    ['peaking', cfg.lowPeak[0], cfg.lowPeak[1], cfg.lowPeak[2]],
    ['peaking', cfg.barkPeak[0], cfg.barkPeak[1], cfg.barkPeak[2] + eqTiltDb * 0.45],
    ['peaking', cfg.crackPeak[0], cfg.crackPeak[1], cfg.crackPeak[2] + eqTiltDb],
    ['lowpass', cfg.lpHz, 0.72],
  ];
  processStereoEQ(attackL, attackR, targetSampleRate, stages);
  processStereoEQ(bodyL, bodyR, targetSampleRate, stages);

  if (cfg.drive > 1.3) {
    for (let i = 0; i < atkLen; i++) {
      attackL[i] = softClip(attackL[i] * 1.15, cfg.drive);
      attackR[i] = softClip(attackR[i] * 1.15, cfg.drive);
    }
    for (let i = 0; i < bodyLen; i++) {
      bodyL[i] = softClip(bodyL[i] * 1.08, cfg.drive * 0.78);
      bodyR[i] = softClip(bodyR[i] * 1.08, cfg.drive * 0.78);
    }
  }

  normalizeStereoPair(attackL, attackR, cfg.atkRms, 0.56);
  normalizeStereoPair(bodyL, bodyR, cfg.bodyRms, 0.54);

  // Layer 3: Broadband Mechanical Action Cycle (zero tonal chimes)
  const mech = allocF32(mechLen);
  const mProf = getMechMaterialProfile(weapon);
  addMetalClack(
    mech,
    targetSampleRate,
    cfg.mechDelaySec,
    mProf.metalHz * pitchJitter,
    mProf.bodyHz * pitchJitter,
    mProf.combMs,
    Math.min(0.4, mProf.combFb),
    10,
    2,
    0.88,
    rng,
  );
  addBodyImpact(
    mech,
    targetSampleRate,
    cfg.mechDelaySec + 0.002,
    0.045,
    mProf.bodyHz * pitchJitter,
    1.2,
    2400,
    0.65,
    1.5,
    rng,
  );
  if (weapon === 'm4') {
    addStickSlipFriction(mech, targetSampleRate, 0.02, 0.065, [520 * pitchJitter, 1650 * pitchJitter], 2800, 260, 0.34, rng, true);
  }
  applyEdges(mech, targetSampleRate, 0.4, 8);
  normalizeBuffer(mech, cfg.mechRms, 0.22);

  return { attackL, attackR, bodyL, bodyR, mech, sampleRate: targetSampleRate };
}

export function processDirectWeaponSamplePCM(
  ref: ReferenceShotPCM,
  weapon: WeaponSoundId,
  variationIndex: number,
  targetSampleRate = 44100,
): StereoShotLayerPCM {
  const v = variationIndex & 3;
  if (ref.left.length < 256 || ref.sampleRate < 8000) {
    const mono = synthesizeGunshotPCM(weapon, v, targetSampleRate);
    const attackR = allocF32(mono.attack.length);
    const bodyR = allocF32(mono.body.length);
    attackR.set(mono.attack);
    bodyR.set(mono.body);
    return {
      attackL: mono.attack,
      attackR,
      bodyL: mono.body,
      bodyR,
      mech: mono.mech,
      sampleRate: targetSampleRate,
    };
  }

  interface DirectWeaponProfile {
    maxDurSec: number;
    minDurSec: number;
    hpHz: number;
    targetRms: number;
    peakCeiling: number;
    fadeInMs: number;
    crossStartSec: number;
    crossEndSec: number;
    mechDelaySec: number;
    mechRms: number;
  }

  const PROFILES: Record<WeaponSoundId, DirectWeaponProfile> = {
    pistol:  { maxDurSec: 0.78, minDurSec: 0.30, hpHz: 42, targetRms: 0.16,  peakCeiling: 0.82, fadeInMs: 0.4, crossStartSec: 0.014, crossEndSec: 0.038, mechDelaySec: 0.016, mechRms: 0.024 },
    smg:     { maxDurSec: 0.24, minDurSec: 0.14, hpHz: 58, targetRms: 0.16,  peakCeiling: 0.80, fadeInMs: 2.0, crossStartSec: 0.012, crossEndSec: 0.034, mechDelaySec: 0.010, mechRms: 0.024 },
    m4:      { maxDurSec: 0.38, minDurSec: 0.20, hpHz: 52, targetRms: 0.175, peakCeiling: 0.83, fadeInMs: 0.4, crossStartSec: 0.014, crossEndSec: 0.038, mechDelaySec: 0.014, mechRms: 0.026 },
    rifle:   { maxDurSec: 0.64, minDurSec: 0.32, hpHz: 42, targetRms: 0.175, peakCeiling: 0.84, fadeInMs: 0.4, crossStartSec: 0.014, crossEndSec: 0.038, mechDelaySec: 0.018, mechRms: 0.028 },
    ssg:     { maxDurSec: 0.74, minDurSec: 0.36, hpHz: 40, targetRms: 0.175, peakCeiling: 0.84, fadeInMs: 0.4, crossStartSec: 0.014, crossEndSec: 0.038, mechDelaySec: 0.020, mechRms: 0.024 },
    shotgun: { maxDurSec: 0.96, minDurSec: 0.48, hpHz: 32, targetRms: 0.19,  peakCeiling: 0.84, fadeInMs: 0.6, crossStartSec: 0.016, crossEndSec: 0.042, mechDelaySec: 0.022, mechRms: 0.024 },
    sniper:  { maxDurSec: 1.24, minDurSec: 0.60, hpHz: 30, targetRms: 0.17,  peakCeiling: 0.84, fadeInMs: 0.4, crossStartSec: 0.016, crossEndSec: 0.042, mechDelaySec: 0.026, mechRms: 0.024 },
    knife:   { maxDurSec: 0.48, minDurSec: 0.22, hpHz: 95, targetRms: 0.135, peakCeiling: 0.78, fadeInMs: 2.0, crossStartSec: 0.020, crossEndSec: 0.048, mechDelaySec: 0.0,   mechRms: 0 },
  };

  const cfg = PROFILES[weapon];
  const seed =
    weapon.split('').reduce((acc, ch, i) => acc + ch.charCodeAt(0) * (i + 31), 0) * 137 + v * 104729 + 3571;
  const rng = mulberry32(seed);

  // Subtle +/-2% micro-rate jitter so authentic timbre/pitch stays intact while rapid takes never phase-lock
  const rate = 1 + (v - 1.5) * 0.0085 + (rng() - 0.5) * 0.012;
  const eqTiltDb = (rng() - 0.5) * 1.6;
  const onset = findReferenceOnset(ref.left, ref.right, ref.sampleRate);
  const stereoSign = (v & 1) === 0 ? 1 : -1;
  const stereoOffsetSamples = stereoSign * Math.max(5, Math.round((0.00014 + rng() * 0.00014) * ref.sampleRate));
  const leftStart = stereoOffsetSamples < 0 && onset < -stereoOffsetSamples ? onset - stereoOffsetSamples : onset;
  const rightStart = Math.max(0, onset + stereoOffsetSamples);

  const availSec = Math.max(0.08, (ref.left.length - onset) / (ref.sampleRate * rate));
  const durSec = Math.min(cfg.maxDurSec, Math.max(cfg.minDurSec, availSec));
  const fullLen = Math.max(Math.floor(targetSampleRate * 0.08), Math.floor(targetSampleRate * durSec));

  const fullL = resampleWindowLinear(ref.left, ref.sampleRate, targetSampleRate, rate, leftStart, fullLen);
  const fullR = resampleWindowLinear(ref.right, ref.sampleRate, targetSampleRate, rate, rightStart, fullLen);

  // Clean DC / sub-sonic filter + subtle presence nuance + opposite-channel stereo air tilt
  processStereoEQ(fullL, fullR, targetSampleRate, [
    ['highpass', cfg.hpHz, 0.72],
    ['peaking', 2400, 0.9, eqTiltDb],
  ]);
  new OfflineBiquad('peaking', 2900, 1.0, targetSampleRate, 1.1 * stereoSign).process(fullL);
  new OfflineBiquad('peaking', 2900, 1.0, targetSampleRate, -1.1 * stereoSign).process(fullR);

  // Smooth fade-in and half-cosine tail fade-out on coherent stereo pair
  const fadeInSamples = Math.max(4, Math.floor((cfg.fadeInMs / 1000) * targetSampleRate));
  const fadeInEnd = Math.min(fadeInSamples, fullLen);
  for (let i = 0; i < fadeInEnd; i++) {
    const g = i / fadeInSamples;
    fullL[i] *= g;
    fullR[i] *= g;
  }
  const tailStart = Math.floor(fullLen * 0.86);
  const tailSpan = Math.max(1, fullLen - tailStart);
  for (let i = tailStart; i < fullLen; i++) {
    const u = (i - tailStart) / tailSpan;
    const g = Math.cos(u * Math.PI * 0.5);
    fullL[i] *= g;
    fullR[i] *= g;
  }

  // Normalize full stereo pair BEFORE splitting so attack+body preserve natural recorded dynamics
  normalizeStereoPair(fullL, fullR, cfg.targetRms, cfg.peakCeiling);

  // Exact unity-gain complementary cosine split between attack and body
  const crossStart = Math.floor(targetSampleRate * cfg.crossStartSec);
  const crossEnd = Math.floor(targetSampleRate * cfg.crossEndSec);
  const crossSpan = Math.max(1, crossEnd - crossStart);
  const atkLen = Math.min(fullLen, crossEnd + Math.floor(targetSampleRate * 0.004));

  const attackL = allocF32(atkLen);
  const attackR = allocF32(atkLen);
  const bodyL = allocF32(fullLen);
  const bodyR = allocF32(fullLen);

  for (let i = 0; i < fullLen; i++) {
    let wAtk = 0;
    if (i <= crossStart) {
      wAtk = 1;
    } else if (i < crossEnd) {
      const u = (i - crossStart) / crossSpan;
      wAtk = 0.5 * (1 + Math.cos(u * Math.PI));
    }
    if (i < atkLen) {
      attackL[i] = fullL[i] * wAtk;
      attackR[i] = fullR[i] * wAtk;
    }
    const wBody = 1 - wAtk;
    bodyL[i] = fullL[i] * wBody;
    bodyR[i] = fullR[i] * wBody;
  }

  // Layer 3: Subtle mechanical action accent for firearms, silent for knife
  if (weapon === 'knife') {
    return {
      attackL,
      attackR,
      bodyL,
      bodyR,
      mech: allocF32(Math.floor(targetSampleRate * 0.02)),
      sampleRate: targetSampleRate,
    };
  }

  const mechLen = Math.floor(targetSampleRate * 0.12);
  const mech = allocF32(mechLen);
  const mProf = getMechMaterialProfile(weapon);
  addMetalClack(
    mech,
    targetSampleRate,
    cfg.mechDelaySec,
    mProf.metalHz * rate,
    mProf.bodyHz * rate,
    mProf.combMs,
    Math.min(0.4, mProf.combFb),
    8,
    2,
    0.85,
    rng,
  );
  addBodyImpact(
    mech,
    targetSampleRate,
    cfg.mechDelaySec + 0.002,
    0.04,
    mProf.bodyHz * rate,
    1.2,
    2400,
    0.6,
    1.5,
    rng,
  );
  applyEdges(mech, targetSampleRate, 0.4, 8);
  normalizeBuffer(mech, cfg.mechRms, 0.10);

  return { attackL, attackR, bodyL, bodyR, mech, sampleRate: targetSampleRate };
}

export function synthesizeWeaponMechPCM(
  event: WeaponMechEvent,
  weaponId: string,
  variationIndex: number,
  sampleRate = 44100,
): Float32Array<ArrayBuffer> {
  const v = variationIndex % 3;
  const seed =
    (event.length * 131 + weaponId.length * 53 + v * 9973) +
    event.split('').reduce((a, c, idx) => a + c.charCodeAt(0) * (idx + 7), 0) +
    weaponId.split('').reduce((a, c, idx) => a + c.charCodeAt(0) * (idx + 11), 0);
  const rng = mulberry32(seed);

  const prof = getMechMaterialProfile(weaponId);
  const scale = (0.96 + v * 0.035 + (rng() - 0.5) * 0.02);

  const durMap: Partial<Record<WeaponMechEvent, number>> = {
    holster: 0.18,
    equip_rustle: 0.20,
    equip_rack: 0.23,
    mag_release: 0.11,
    mag_out: 0.25,
    mag_in: 0.28,
    mag_slap: 0.15,
    bolt_pull: 0.24,
    bolt_release: 0.21,
    pump_back: 0.21,
    pump_fwd: 0.21,
    bolt_lift: 0.16,
    bolt_lock: 0.20,
    reload_end: 0.18,
    dry_fire: 0.085,
    inspect_whoosh: 0.19,
    scope_click: 0.075,
    knife_draw: 0.20,
    shell_insert: 0.17,
    press_check: 0.18,
    knife_spin: 0.20,
  };
  const dur = durMap[event] ?? 0.18;
  const buf = allocF32(Math.floor(sampleRate * dur));

  const mHz = prof.metalHz * scale;
  const bHz = prof.bodyHz * scale;

  switch (event) {
    case 'holster':
      addClothGripFoley(buf, sampleRate, 0.004, 0.15, 0.85, rng);
      addBodyImpact(buf, sampleRate, 0.055, 0.07, bHz * 0.85, 1.1, 950, 0.32, 1.1, rng);
      break;
    case 'equip_rustle':
      addClothGripFoley(buf, sampleRate, 0.004, 0.17, 0.92, rng);
      addBodyImpact(buf, sampleRate, 0.042, 0.055, bHz, 1.2, 1100, 0.22, 1.1, rng);
      break;
    case 'inspect_whoosh':
      addClothGripFoley(buf, sampleRate, 0.005, 0.165, 0.95, rng);
      break;
    case 'reload_end':
      addClothGripFoley(buf, sampleRate, 0.004, 0.145, 0.85, rng);
      addBodyImpact(buf, sampleRate, 0.038, 0.065, bHz * 0.9, 1.15, 1050, 0.34, 1.1, rng);
      break;
    case 'mag_release':
      addClothGripFoley(buf, sampleRate, 0.001, 0.032, 0.42, rng);
      addMetalClack(buf, sampleRate, 0.018, mHz * 1.18, bHz * 1.9, prof.combMs * 0.72, Math.min(0.32, prof.combFb), 5, 2, 0.95, rng);
      addBodyImpact(buf, sampleRate, 0.02, 0.03, bHz * 1.35, 1.3, 1800, 0.28, 1.2, rng);
      break;
    case 'mag_out':
      addMetalClack(buf, sampleRate, 0.002, mHz * 1.1, bHz * 1.8, prof.combMs * 0.85, Math.min(0.34, prof.combFb), 6, 1, 0.58, rng);
      addStickSlipFriction(
        buf,
        sampleRate,
        0.014,
        0.116,
        [bHz * 2.1, mHz * 0.72],
        1950,
        prof.gritDensity,
        0.92,
        rng,
        false,
      );
      addBodyImpact(buf, sampleRate, 0.136, 0.055, bHz * 1.05, 1.4, 1550, 0.45, 1.2, rng);
      addClothGripFoley(buf, sampleRate, 0.15, 0.09, 0.62, rng);
      break;
    case 'mag_in':
      addMetalClack(buf, sampleRate, 0.004, mHz * 0.95, bHz * 1.5, prof.combMs * 0.8, 0.25, 5, 1, 0.38, rng);
      addStickSlipFriction(
        buf,
        sampleRate,
        0.032,
        0.068,
        [bHz * 2.0, mHz * 0.68],
        1800,
        prof.gritDensity * 1.1,
        0.85,
        rng,
        false,
      );
      addBodyImpact(buf, sampleRate, 0.106, 0.08, bHz * 0.62, 1.55, 1250, 1.1, 1.7, rng);
      addMetalClack(buf, sampleRate, 0.120, mHz, bHz * 2.2, prof.combMs, prof.combFb, 9, 3, 1.05, rng);
      addClothGripFoley(buf, sampleRate, 0.155, 0.08, 0.48, rng);
      break;
    case 'mag_slap':
      addBodyImpact(buf, sampleRate, 0.002, 0.068, 165 * scale, 1.1, 1400, 0.88, 1.55, rng);
      addBodyImpact(buf, sampleRate, 0.003, 0.048, 580 * scale, 0.95, 3600, 0.85, 1.4, rng);
      addClothGripFoley(buf, sampleRate, 0.002, 0.055, 0.85, rng);
      addMetalClack(buf, sampleRate, 0.014, mHz * 0.82, bHz * 1.7, prof.combMs * 0.95, 0.32, 6, 2, 0.46, rng);
      break;
    case 'equip_rack':
    case 'bolt_pull':
      addMetalClack(buf, sampleRate, 0.004, mHz * 0.92, bHz * 1.6, prof.combMs * 0.8, 0.24, 5, 1, 0.32, rng);
      addStickSlipFriction(
        buf,
        sampleRate,
        0.018,
        0.127,
        [bHz * 2.4, mHz * 0.78],
        2150,
        prof.gritDensity * 1.2,
        0.95,
        rng,
        true,
      );
      addBodyImpact(buf, sampleRate, 0.15, 0.068, bHz * 0.88, 1.5, 1450, 0.85, 1.5, rng);
      addMetalClack(buf, sampleRate, 0.152, mHz * 1.04, bHz * 2.3, prof.combMs, prof.combFb, 10, 2, 1.05, rng);
      break;
    case 'bolt_release':
      addMetalClack(buf, sampleRate, 0.002, mHz * 1.22, bHz * 1.9, prof.combMs * 0.72, 0.28, 5, 1, 0.42, rng);
      addStickSlipFriction(
        buf,
        sampleRate,
        0.016,
        0.028,
        [bHz * 2.6, mHz * 0.88],
        2450,
        prof.gritDensity * 1.4,
        0.78,
        rng,
        true,
      );
      addBodyImpact(buf, sampleRate, 0.046, 0.085, bHz * 0.72, 1.6, 1380, 1.15, 1.85, rng);
      addMetalClack(buf, sampleRate, 0.046, mHz * 1.06, bHz * 2.4, prof.combMs, prof.combFb, 11, 3, 1.12, rng);
      addStickSlipFriction(
        buf,
        sampleRate,
        0.068,
        0.055,
        [bHz * 1.9, mHz * 0.75],
        3200,
        140,
        0.24,
        rng,
        true,
      );
      break;
    case 'bolt_lock':
      addStickSlipFriction(
        buf,
        sampleRate,
        0.004,
        0.06,
        [bHz * 2.2, mHz * 0.76],
        2050,
        prof.gritDensity * 1.15,
        0.82,
        rng,
        false,
      );
      addBodyImpact(buf, sampleRate, 0.07, 0.082, bHz * 0.75, 1.6, 1320, 1.08, 1.75, rng);
      addMetalClack(buf, sampleRate, 0.076, mHz * 0.96, bHz * 2.1, prof.combMs, prof.combFb, 10, 2, 0.95, rng);
      addMetalClack(buf, sampleRate, 0.092, mHz * 1.12, bHz * 2.4, prof.combMs * 0.85, 0.36, 8, 2, 0.78, rng);
      break;
    case 'bolt_lift':
      addClothGripFoley(buf, sampleRate, 0.002, 0.028, 0.35, rng);
      addStickSlipFriction(
        buf,
        sampleRate,
        0.014,
        0.052,
        [bHz * 2.3, mHz * 0.82],
        2200,
        prof.gritDensity * 1.2,
        0.82,
        rng,
        false,
      );
      addBodyImpact(buf, sampleRate, 0.068, 0.058, bHz * 0.95, 1.45, 1350, 0.72, 1.5, rng);
      addMetalClack(buf, sampleRate, 0.070, mHz * 1.05, bHz * 2.2, prof.combMs, prof.combFb, 8, 2, 0.98, rng);
      break;
    case 'pump_back':
      addMetalClack(buf, sampleRate, 0.002, mHz * 0.95, bHz * 1.7, prof.combMs, 0.28, 6, 1, 0.42, rng);
      addStickSlipFriction(
        buf,
        sampleRate,
        0.014,
        0.106,
        [bHz * 2.4, mHz * 0.82],
        1750,
        prof.gritDensity * 1.35,
        1.02,
        rng,
        false,
      );
      addBodyImpact(buf, sampleRate, 0.124, 0.065, bHz * 0.85, 1.5, 1300, 0.85, 1.6, rng);
      addMetalClack(buf, sampleRate, 0.124, mHz * 1.02, bHz * 2.2, prof.combMs, prof.combFb, 9, 2, 0.98, rng);
      break;
    case 'pump_fwd':
      addStickSlipFriction(
        buf,
        sampleRate,
        0.002,
        0.09,
        [bHz * 2.5, mHz * 0.86],
        1950,
        prof.gritDensity * 1.35,
        0.96,
        rng,
        false,
      );
      addBodyImpact(buf, sampleRate, 0.096, 0.088, bHz * 0.72, 1.65, 1250, 1.16, 1.85, rng);
      addMetalClack(buf, sampleRate, 0.096, mHz * 1.08, bHz * 2.3, prof.combMs, prof.combFb, 11, 3, 1.12, rng);
      break;
    case 'shell_insert':
      addClothGripFoley(buf, sampleRate, 0.002, 0.03, 0.55, rng);
      addHollowTubeClick(buf, sampleRate, 0.028, scale, 1.0, rng);
      break;
    case 'press_check':
      addClothGripFoley(buf, sampleRate, 0.002, 0.04, 0.4, rng);
      addStickSlipFriction(
        buf,
        sampleRate,
        0.012,
        0.048,
        [bHz * 2.4, mHz * 0.88],
        2350,
        prof.gritDensity,
        0.78,
        rng,
        true,
      );
      addMetalClack(buf, sampleRate, 0.056, mHz * 1.1, bHz * 2.1, prof.combMs * 0.85, 0.35, 7, 2, 0.85, rng);
      addStickSlipFriction(
        buf,
        sampleRate,
        0.088,
        0.036,
        [bHz * 2.2, mHz * 0.84],
        2350,
        prof.gritDensity,
        0.65,
        rng,
        false,
      );
      addMetalClack(buf, sampleRate, 0.122, mHz * 0.96, bHz * 1.9, prof.combMs * 0.85, 0.34, 6, 2, 0.75, rng);
      break;
    case 'dry_fire':
      addMetalClack(buf, sampleRate, 0.002, mHz * 1.38, bHz * 2.4, prof.combMs * 0.68, 0.32, 6, 2, 1.05, rng);
      addBodyImpact(buf, sampleRate, 0.003, 0.028, bHz * 1.6, 1.4, 2400, 0.38, 1.4, rng);
      break;
    case 'scope_click':
      addMetalClack(buf, sampleRate, 0.002, 3900 * scale, 1450 * scale, 0.65, 0.28, 5, 2, 0.95, rng);
      break;
    case 'knife_draw':
      addClothGripFoley(buf, sampleRate, 0.002, 0.08, 0.75, rng);
      addStickSlipFriction(
        buf,
        sampleRate,
        0.012,
        0.13,
        [1850 * scale, 4100 * scale],
        3400,
        240,
        0.95,
        rng,
        false,
      );
      addMetalClack(buf, sampleRate, 0.028, 4900 * scale, 1650 * scale, 0.62, 0.34, 8, 1, 0.58, rng);
      break;
    case 'knife_spin':
      addClothGripFoley(buf, sampleRate, 0.002, 0.15, 0.85, rng);
      addStickSlipFriction(
        buf,
        sampleRate,
        0.024,
        0.11,
        [1650 * scale, 3550 * scale],
        2900,
        180,
        0.72,
        rng,
        false,
      );
      addMetalClack(buf, sampleRate, 0.088, 4600 * scale, 1550 * scale, 0.65, 0.3, 6, 2, 0.52, rng);
      break;
  }

  applyEdges(buf, sampleRate, 1.5, 8);
  const softHandling =
    event === 'holster' || event === 'equip_rustle' || event === 'inspect_whoosh' || event === 'reload_end';
  const lightTick = event === 'mag_release' || event === 'dry_fire' || event === 'scope_click';
  const mediumMech =
    event === 'mag_out' ||
    event === 'shell_insert' ||
    event === 'bolt_lift' ||
    event === 'press_check' ||
    event === 'knife_draw' ||
    event === 'knife_spin';

  const targetRms = softHandling ? 0.046 : lightTick ? 0.058 : mediumMech ? 0.082 : 0.115;
  const peakCeiling = softHandling ? 0.42 : lightTick ? 0.62 : mediumMech ? 0.72 : 0.84;
  normalizeBuffer(buf, targetRms, peakCeiling);
  return buf;
}

export interface StereoMechPCM {
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
  sampleRate: number;
}

export const RELOAD_ATLAS_ANCHOR_SRC_SEC = 0.7775;

const RELOAD_ATLAS_EVENTS = new Set<WeaponMechEvent>([
  'mag_release',
  'mag_out',
  'mag_in',
  'mag_slap',
  'bolt_lift',
  'bolt_pull',
  'bolt_release',
  'bolt_lock',
  'pump_back',
  'pump_fwd',
  'shell_insert',
  'reload_end',
  'equip_rack',
  'dry_fire',
  'press_check',
]);

export function isReloadAtlasMechEvent(event: WeaponMechEvent): boolean {
  return RELOAD_ATLAS_EVENTS.has(event);
}

export function findReloadAtlasAnchorSec(atlas: ReferenceShotPCM): number {
  const limit = Math.min(atlas.left.length, atlas.right.length, Math.floor(atlas.sampleRate * 0.45));
  for (let i = 0; i < limit; i++) {
    if (Math.max(Math.abs(atlas.left[i]), Math.abs(atlas.right[i])) >= 0.04) {
      return i / atlas.sampleRate;
    }
  }
  return 0.1775;
}

type SliceWindow = readonly [number, number];

interface ReloadAtlasWeaponProfile {
  baseRate: number;
  hpHz: number;
  bodyPeak: [number, number, number];
  metalPeak: [number, number, number];
  lpHz: number;
  slices: Partial<Record<WeaponMechEvent, SliceWindow>>;
  shellInsertSlices?: readonly SliceWindow[];
}

const RELOAD_ATLAS_PROFILES: Record<string, ReloadAtlasWeaponProfile> = {
  pistol: {
    baseRate: 1.12,
    hpHz: 110,
    bodyPeak: [780, 1.0, -1.5],
    metalPeak: [3800, 1.1, 2.2],
    lpHz: 15500,
    slices: {
      mag_release: [7.075, 7.125],
      mag_out: [6.750, 6.900],
      mag_in: [7.270, 7.520],
      mag_slap: [6.750, 6.845],
      bolt_lift: [7.075, 7.125],
      bolt_pull: [6.750, 6.900],
      bolt_release: [7.590, 7.820],
      bolt_lock: [7.590, 7.770],
      equip_rack: [7.590, 7.820],
      press_check: [7.590, 7.820],
      dry_fire: [7.075, 7.125],
      reload_end: [7.170, 7.260],
    },
  },
  smg: {
    baseRate: 1.07,
    hpHz: 95,
    bodyPeak: [620, 1.0, 0.5],
    metalPeak: [3200, 1.1, 2.5],
    lpHz: 15000,
    slices: {
      mag_release: [11.268, 11.340],
      mag_out: [11.122, 11.222],
      mag_in: [11.412, 11.610],
      mag_slap: [11.922, 12.095],
      bolt_lift: [11.268, 11.340],
      bolt_pull: [11.622, 11.810],
      bolt_release: [11.922, 12.095],
      bolt_lock: [11.922, 12.095],
      equip_rack: [11.922, 12.095],
      press_check: [11.622, 11.810],
      dry_fire: [11.268, 11.340],
      reload_end: [11.220, 11.270],
    },
  },
  m4: {
    baseRate: 1.03,
    hpHz: 85,
    bodyPeak: [540, 1.0, -1.0],
    metalPeak: [2850, 1.1, 2.2],
    lpHz: 16000,
    slices: {
      mag_release: [9.702, 9.758],
      mag_out: [8.700, 8.960],
      mag_in: [9.360, 9.620],
      mag_slap: [9.790, 10.000],
      bolt_lift: [9.702, 9.758],
      bolt_pull: [9.790, 10.000],
      bolt_release: [10.002, 10.168],
      bolt_lock: [10.002, 10.168],
      equip_rack: [10.002, 10.168],
      press_check: [9.790, 10.000],
      dry_fire: [9.702, 9.758],
      reload_end: [14.640, 14.695],
    },
  },
  rifle: {
    baseRate: 0.95,
    hpHz: 68,
    bodyPeak: [950, 1.0, 3.0],
    metalPeak: [2400, 1.1, 1.6],
    lpHz: 14000,
    slices: {
      mag_release: [1.052, 1.125],
      mag_out: [0.765, 0.998],
      mag_in: [1.415, 1.608],
      mag_slap: [1.125, 1.205],
      bolt_lift: [1.052, 1.125],
      bolt_pull: [1.622, 1.818],
      bolt_release: [2.312, 2.538],
      bolt_lock: [2.312, 2.538],
      equip_rack: [2.312, 2.538],
      press_check: [1.622, 1.818],
      dry_fire: [1.125, 1.205],
      reload_end: [2.142, 2.190],
    },
  },
  ssg: {
    baseRate: 0.92,
    hpHz: 65,
    bodyPeak: [520, 1.0, 2.0],
    metalPeak: [2150, 1.1, 2.2],
    lpHz: 14500,
    slices: {
      mag_release: [13.352, 13.402],
      mag_out: [13.000, 13.170],
      mag_in: [11.412, 11.610],
      mag_slap: [14.640, 14.695],
      bolt_lift: [13.550, 13.605],
      bolt_pull: [14.090, 14.222],
      bolt_release: [14.222, 14.368],
      bolt_lock: [14.222, 14.368],
      equip_rack: [14.090, 14.368],
      press_check: [14.090, 14.222],
      dry_fire: [13.352, 13.402],
      reload_end: [14.640, 14.695],
    },
  },
  sniper: {
    baseRate: 0.83,
    hpHz: 50,
    bodyPeak: [380, 1.0, 4.0],
    metalPeak: [1650, 1.1, 2.0],
    lpHz: 12800,
    slices: {
      mag_release: [3.772, 3.898],
      mag_out: [4.192, 4.528],
      mag_in: [4.715, 5.088],
      mag_slap: [4.915, 5.088],
      bolt_lift: [4.612, 4.700],
      bolt_pull: [5.265, 5.472],
      bolt_release: [5.472, 5.695],
      bolt_lock: [5.472, 5.695],
      equip_rack: [5.265, 5.695],
      press_check: [5.265, 5.472],
      dry_fire: [3.772, 3.898],
      reload_end: [5.102, 5.172],
    },
  },
  shotgun: {
    baseRate: 0.86,
    hpHz: 55,
    bodyPeak: [480, 1.0, 3.5],
    metalPeak: [1850, 1.0, 1.5],
    lpHz: 13000,
    shellInsertSlices: [
      [1.052, 1.205],
      [3.772, 3.898],
      [13.000, 13.170],
    ],
    slices: {
      pump_back: [4.192, 4.528],
      pump_fwd: [5.265, 5.472],
      equip_rack: [4.915, 5.088],
      press_check: [4.192, 4.528],
      dry_fire: [1.125, 1.205],
      reload_end: [5.102, 5.172],
      mag_release: [3.772, 3.898],
      mag_out: [4.192, 4.528],
      mag_in: [4.915, 5.088],
      mag_slap: [1.125, 1.205],
      bolt_lift: [3.772, 3.898],
      bolt_pull: [4.192, 4.528],
      bolt_release: [5.265, 5.472],
      bolt_lock: [5.265, 5.472],
    },
  },
};

function promoteMonoMechToStereo(
  event: WeaponMechEvent,
  weaponId: string,
  variationIndex: number,
  targetSampleRate: number,
): StereoMechPCM {
  const mono = synthesizeWeaponMechPCM(event, weaponId, variationIndex, targetSampleRate);
  const right = allocF32(mono.length);
  right.set(mono);
  return { left: mono, right, sampleRate: targetSampleRate };
}

export function deriveWeaponMechFromAtlasPCM(
  atlas: ReferenceShotPCM,
  event: WeaponMechEvent,
  weaponId: string,
  variationIndex: number,
  targetSampleRate = 44100,
  precomputedAnchorSec?: number,
): StereoMechPCM {
  const v = ((variationIndex % 3) + 3) % 3;
  if (!isReloadAtlasMechEvent(event) || atlas.left.length < 4096 || atlas.sampleRate < 8000 || weaponId === 'knife') {
    return promoteMonoMechToStereo(event, weaponId, variationIndex, targetSampleRate);
  }

  const prof = RELOAD_ATLAS_PROFILES[weaponId] ?? RELOAD_ATLAS_PROFILES.rifle;
  const slice =
    event === 'shell_insert' && prof.shellInsertSlices?.length
      ? prof.shellInsertSlices[v % prof.shellInsertSlices.length]
      : prof.slices[event];
  if (!slice) {
    return promoteMonoMechToStereo(event, weaponId, variationIndex, targetSampleRate);
  }

  const anchorSec = precomputedAnchorSec ?? findReloadAtlasAnchorSec(atlas);
  const maxAtlasSec = Math.min(atlas.left.length, atlas.right.length) / atlas.sampleRate;
  const startSec = Math.max(0, slice[0] - RELOAD_ATLAS_ANCHOR_SRC_SEC + anchorSec);
  const endSec = Math.min(maxAtlasSec, slice[1] - RELOAD_ATLAS_ANCHOR_SRC_SEC + anchorSec);
  if (endSec - startSec < 0.025) {
    return promoteMonoMechToStereo(event, weaponId, variationIndex, targetSampleRate);
  }

  const seed =
    (event.length * 151 + weaponId.length * 61 + v * 10007) +
    event.split('').reduce((a, c, idx) => a + c.charCodeAt(0) * (idx + 13), 0) +
    weaponId.split('').reduce((a, c, idx) => a + c.charCodeAt(0) * (idx + 17), 0);
  const rng = mulberry32(seed);

  const rate = prof.baseRate * (1 + (v - 1) * 0.022 + (rng() - 0.5) * 0.018);
  const eqTiltDb = (rng() - 0.5) * 2.2;
  const srcStartIdx = Math.floor(startSec * atlas.sampleRate);
  const outLen = Math.max(
    Math.floor(targetSampleRate * 0.035),
    Math.floor(((endSec - startSec) / rate) * targetSampleRate),
  );

  const stereoSign = v === 1 ? -1 : 1;
  const stereoOffsetSamples = stereoSign * Math.max(6, Math.round((0.00018 + rng() * 0.00014) * atlas.sampleRate));
  const leftStart = stereoOffsetSamples < 0 && srcStartIdx < -stereoOffsetSamples ? srcStartIdx - stereoOffsetSamples : srcStartIdx;
  const rightStart = Math.max(0, srcStartIdx + stereoOffsetSamples);

  const left = resampleWindowLinear(atlas.left, atlas.sampleRate, targetSampleRate, rate, leftStart, outLen);
  const right = resampleWindowLinear(atlas.right, atlas.sampleRate, targetSampleRate, rate, rightStart, outLen);

  processStereoEQ(left, right, targetSampleRate, [
    ['highpass', prof.hpHz, 0.72],
    ['peaking', prof.bodyPeak[0], prof.bodyPeak[1], prof.bodyPeak[2]],
    ['peaking', prof.metalPeak[0], prof.metalPeak[1], prof.metalPeak[2] + eqTiltDb],
    ['lowpass', prof.lpHz, 0.72],
  ]);
  new OfflineBiquad('peaking', 3100, 1.0, targetSampleRate, 1.3 * stereoSign).process(left);
  new OfflineBiquad('peaking', 3100, 1.0, targetSampleRate, -1.3 * stereoSign).process(right);

  const durMs = (outLen / targetSampleRate) * 1000;
  const fadeInSamples = Math.max(3, Math.floor((Math.min(1.8, durMs * 0.08) / 1000) * targetSampleRate));
  const fadeOutSamples = Math.max(8, Math.floor((Math.min(12.0, durMs * 0.25) / 1000) * targetSampleRate));
  for (let i = 0; i < Math.min(fadeInSamples, outLen); i++) {
    const g = i / fadeInSamples;
    left[i] *= g;
    right[i] *= g;
  }
  const fadeOutStart = Math.max(0, outLen - fadeOutSamples);
  for (let i = fadeOutStart; i < outLen; i++) {
    const u = (i - fadeOutStart) / Math.max(1, outLen - fadeOutStart);
    const g = Math.cos(u * Math.PI * 0.5);
    left[i] *= g;
    right[i] *= g;
  }

  const softHandling = event === 'reload_end';
  const lightTick = event === 'mag_release' || event === 'dry_fire';
  const mediumMech =
    event === 'mag_out' || event === 'shell_insert' || event === 'bolt_lift' || event === 'press_check';

  const targetRms = softHandling ? 0.055 : lightTick ? 0.075 : mediumMech ? 0.105 : 0.132;
  const peakCeiling = softHandling ? 0.44 : lightTick ? 0.64 : mediumMech ? 0.74 : 0.84;
  normalizeStereoPair(left, right, targetRms, peakCeiling);

  return { left, right, sampleRate: targetSampleRate };
}

export const SHELL_ATLAS_ANCHOR_SRC_SEC = 0.3964;
export const SHELL_CASING_CLIP_COUNT = 12;

export function findShellAtlasAnchorSec(atlas: ReferenceShotPCM): number {
  const limit = Math.min(atlas.left.length, atlas.right.length, Math.floor(atlas.sampleRate * 0.35));
  for (let i = 0; i < limit; i++) {
    if (Math.max(Math.abs(atlas.left[i]), Math.abs(atlas.right[i])) >= 0.03) {
      return i / atlas.sampleRate;
    }
  }
  return 0.1464;
}

const SHELL_ATLAS_CLIPS: readonly SliceWindow[] = [
  [0.388, 0.830],
  [1.275, 1.740],
  [2.335, 2.820],
  [3.405, 3.820],
  [4.575, 4.910],
  [5.525, 5.960],
  [6.985, 7.460],
  [8.235, 8.820],
  [9.705, 10.210],
  [11.125, 11.770],
  [12.755, 13.180],
  [14.125, 14.740],
];

export function deriveShellCasingFromAtlasPCM(
  atlas: ReferenceShotPCM,
  variationIndex: number,
  isShotgun: boolean,
  targetSampleRate = 44100,
  precomputedAnchorSec?: number,
): StereoMechPCM {
  const idx = ((variationIndex % SHELL_CASING_CLIP_COUNT) + SHELL_CASING_CLIP_COUNT) % SHELL_CASING_CLIP_COUNT;
  const anchorSec = precomputedAnchorSec ?? findShellAtlasAnchorSec(atlas);
  const availFrames = Math.min(atlas.left.length, atlas.right.length);
  const maxAtlasSec = availFrames / Math.max(1, atlas.sampleRate);
  const [srcStart, srcEnd] = SHELL_ATLAS_CLIPS[idx];
  const startSec = Math.max(0, srcStart - SHELL_ATLAS_ANCHOR_SRC_SEC + anchorSec);
  const endSec = Math.min(maxAtlasSec, srcEnd - SHELL_ATLAS_ANCHOR_SRC_SEC + anchorSec);

  if (atlas.left.length < 4096 || atlas.sampleRate < 8000 || endSec - startSec < 0.04) {
    const empty = allocF32(Math.floor(targetSampleRate * 0.08));
    return { left: empty, right: allocF32(empty.length), sampleRate: targetSampleRate };
  }

  const rawStartIdx = Math.floor(startSec * atlas.sampleRate);
  const rawEndIdx = Math.min(availFrames, Math.floor(endSec * atlas.sampleRate));

  // Snap past any local leading silence (< 4% of slice peak, up to 85ms window) keeping 1ms pre-roll
  let slicePeak = 0;
  for (let i = rawStartIdx; i < rawEndIdx; i++) {
    const a = Math.max(Math.abs(atlas.left[i]), Math.abs(atlas.right[i]));
    if (a > slicePeak) slicePeak = a;
  }
  let snappedStartIdx = rawStartIdx;
  if (slicePeak > 1e-5) {
    const thresh = slicePeak * 0.04;
    const scanEnd = Math.min(rawEndIdx, rawStartIdx + Math.floor(atlas.sampleRate * 0.085));
    for (let i = rawStartIdx; i < scanEnd; i++) {
      if (Math.max(Math.abs(atlas.left[i]), Math.abs(atlas.right[i])) >= thresh) {
        snappedStartIdx = Math.max(rawStartIdx, i - Math.floor(atlas.sampleRate * 0.001));
        break;
      }
    }
  }

  const rng = mulberry32(idx * 7919 + (isShotgun ? 3571 : 101));
  const rate = isShotgun ? 0.68 + (rng() - 0.5) * 0.06 : 0.96 + (rng() - 0.5) * 0.10;
  const availSrcSamples = Math.max(64, rawEndIdx - snappedStartIdx);
  const outLen = Math.max(
    Math.floor(targetSampleRate * 0.06),
    Math.floor((availSrcSamples / (atlas.sampleRate * rate)) * targetSampleRate),
  );

  const left = resampleWindowLinear(atlas.left, atlas.sampleRate, targetSampleRate, rate, snappedStartIdx, outLen);
  const right = resampleWindowLinear(atlas.right, atlas.sampleRate, targetSampleRate, rate, snappedStartIdx, outLen);

  if (isShotgun) {
    processStereoEQ(left, right, targetSampleRate, [
      ['highpass', 120, 0.72],
      ['peaking', 620, 1.0, 5.0],
      ['lowpass', 4000, 0.72],
    ]);
  } else {
    processStereoEQ(left, right, targetSampleRate, [
      ['highpass', 220, 0.72],
      ['peaking', 5200, 0.9, (rng() - 0.5) * 1.8],
    ]);
  }

  const fadeInSamples = Math.max(4, Math.floor(0.001 * targetSampleRate));
  const fadeOutSamples = Math.max(12, Math.floor(0.018 * targetSampleRate));
  for (let i = 0; i < Math.min(fadeInSamples, outLen); i++) {
    const g = i / fadeInSamples;
    left[i] *= g;
    right[i] *= g;
  }
  const fadeOutStart = Math.max(0, outLen - fadeOutSamples);
  for (let i = fadeOutStart; i < outLen; i++) {
    const u = (i - fadeOutStart) / Math.max(1, outLen - fadeOutStart);
    const g = Math.cos(u * Math.PI * 0.5);
    left[i] *= g;
    right[i] *= g;
  }

  normalizeStereoPair(left, right, isShotgun ? 0.082 : 0.085, isShotgun ? 0.58 : 0.62);
  return { left, right, sampleRate: targetSampleRate };
}
