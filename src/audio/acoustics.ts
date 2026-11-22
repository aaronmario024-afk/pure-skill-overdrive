import { WallObstacle, WallType } from '../game/maps';
import { SndMapGrid } from '../game/sndMaps';
import { allocF32, mulberry32 } from './weaponSamples';

export type AcousticZone =
  | 'small_room'
  | 'corridor'
  | 'large_interior'
  | 'outdoor_urban'
  | 'outdoor_open';

export interface AcousticEnvState {
  zone: AcousticZone;
  enclosure: number;
  wallProximity: number;
  earlyGain: number;
  reverbSend: number;
  surface: 'concrete' | 'metal' | 'snow';
}

export interface DistanceAcousticParams {
  gain: number;
  lowpassHz: number;
  nearWeight: number;
  midWeight: number;
  farWeight: number;
  reverbSend: number;
  occluded: boolean;
}

interface ZoneIRSpec {
  durationSec: number;
  decayRate: number;
  lpfHz: number;
  tailGain: number;
  taps: Array<{ ms: number; ampL: number; ampR: number }>;
  seed: number;
}

const ZONE_IR_SPECS: Record<AcousticZone, ZoneIRSpec> = {
  small_room: {
    durationSec: 0.40,
    decayRate: 9.2,
    lpfHz: 2450,
    tailGain: 0.24,
    seed: 101,
    taps: [
      { ms: 7, ampL: 0.54, ampR: 0.38 },
      { ms: 13, ampL: 0.35, ampR: 0.50 },
      { ms: 21, ampL: 0.30, ampR: 0.24 },
      { ms: 31, ampL: 0.18, ampR: 0.22 },
    ],
  },
  corridor: {
    durationSec: 0.72,
    decayRate: 5.4,
    lpfHz: 3800,
    tailGain: 0.26,
    seed: 202,
    taps: [
      { ms: 11, ampL: 0.52, ampR: 0.34 },
      { ms: 24, ampL: 0.32, ampR: 0.48 },
      { ms: 39, ampL: 0.34, ampR: 0.28 },
      { ms: 58, ampL: 0.22, ampR: 0.27 },
      { ms: 82, ampL: 0.15, ampR: 0.14 },
    ],
  },
  large_interior: {
    durationSec: 1.28,
    decayRate: 2.9,
    lpfHz: 1950,
    tailGain: 0.31,
    seed: 303,
    taps: [
      { ms: 26, ampL: 0.44, ampR: 0.32 },
      { ms: 48, ampL: 0.30, ampR: 0.42 },
      { ms: 76, ampL: 0.26, ampR: 0.24 },
      { ms: 118, ampL: 0.18, ampR: 0.20 },
    ],
  },
  outdoor_urban: {
    durationSec: 0.96,
    decayRate: 4.1,
    lpfHz: 1480,
    tailGain: 0.21,
    seed: 404,
    taps: [
      { ms: 29, ampL: 0.42, ampR: 0.31 },
      { ms: 64, ampL: 0.24, ampR: 0.34 },
      { ms: 114, ampL: 0.14, ampR: 0.12 },
    ],
  },
  outdoor_open: {
    durationSec: 1.38,
    decayRate: 2.5,
    lpfHz: 950,
    tailGain: 0.14,
    seed: 505,
    taps: [
      { ms: 88, ampL: 0.24, ampR: 0.16 },
      { ms: 165, ampL: 0.13, ampR: 0.18 },
    ],
  },
};

export function generateAcousticIRPCM(
  zone: AcousticZone,
  sampleRate = 44100,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const spec = ZONE_IR_SPECS[zone];
  const len = Math.floor(sampleRate * spec.durationSec);
  const left = allocF32(len);
  const right = allocF32(len);
  const rng = mulberry32(spec.seed);

  // One-pole air absorption filter state calibrated to zone cutoff
  const rc = 1 / (2 * Math.PI * spec.lpfHz);
  const dt = 1 / sampleRate;
  const lpAlpha = dt / (rc + dt);

  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * spec.decayRate);
    // Smooth 3ms initial tail ramp so early taps stay distinct
    const onset = i < sampleRate * 0.003 ? i / (sampleRate * 0.003) : 1;
    const rawL = (rng() * 2 - 1) * env * spec.tailGain * onset;
    const rawR = (rng() * 2 - 1) * env * spec.tailGain * onset;
    lpL += lpAlpha * (rawL - lpL);
    lpR += lpAlpha * (rawR - lpR);
    left[i] = lpL;
    right[i] = lpR;
  }

  for (const tap of spec.taps) {
    const idx = Math.floor((tap.ms / 1000) * sampleRate);
    if (idx < len - 6) {
      left[idx] += tap.ampL;
      left[idx + 1] += tap.ampL * 0.52;
      left[idx + 2] -= tap.ampL * 0.22;
      right[idx] += tap.ampR;
      right[idx + 1] += tap.ampR * 0.52;
      right[idx + 2] -= tap.ampR * 0.22;
    }
  }

  // Smooth fade-out tail (20ms) and peak cap at 0.85
  const fade = Math.floor(sampleRate * 0.02);
  let maxAbs = 0;
  for (let i = 0; i < len; i++) {
    if (i >= len - fade) {
      const w = (len - 1 - i) / fade;
      left[i] *= w;
      right[i] *= w;
    }
    maxAbs = Math.max(maxAbs, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (maxAbs > 0.85) {
    const sc = 0.85 / maxAbs;
    for (let i = 0; i < len; i++) {
      left[i] *= sc;
      right[i] *= sc;
    }
  }

  return [left, right];
}

export function probeAcousticEnvironment(
  pos: { x: number; y: number; z: number },
  walls: WallObstacle[],
  opts?: { sndGrid?: SndMapGrid; theme?: string },
): AcousticEnvState {
  const maxProbe = 16;
  let distPosX = maxProbe;
  let distNegX = maxProbe;
  let distPosZ = maxProbe;
  let distNegZ = maxProbe;

  for (const w of walls) {
    // Only full/head-height walls reflect substantial gunshot acoustics
    if (w.box.max.y < 2.2) continue;

    // Intersect with X rays inside Z slab
    if (pos.z >= w.box.min.z - 0.5 && pos.z <= w.box.max.z + 0.5) {
      if (w.box.min.x >= pos.x) {
        const d = w.box.min.x - pos.x;
        if (d < distPosX) distPosX = d;
      }
      if (w.box.max.x <= pos.x) {
        const d = pos.x - w.box.max.x;
        if (d < distNegX) distNegX = d;
      }
    }

    // Intersect with Z rays inside X slab
    if (pos.x >= w.box.min.x - 0.5 && pos.x <= w.box.max.x + 0.5) {
      if (w.box.min.z >= pos.z) {
        const d = w.box.min.z - pos.z;
        if (d < distPosZ) distPosZ = d;
      }
      if (w.box.max.z <= pos.z) {
        const d = pos.z - w.box.max.z;
        if (d < distNegZ) distNegZ = d;
      }
    }
  }

  let isIndoorCell = false;
  if (opts?.sndGrid) {
    const g = opts.sndGrid;
    const col = Math.floor((pos.x + g.halfX) / g.cellSize);
    const row = Math.floor((pos.z + g.halfZ) / g.cellSize);
    if (row >= 0 && row < g.rows && col >= 0 && col < g.cols) {
      const ch = g.cells[row][col];
      isIndoorCell = ch === 'I' || ch === 'G';
    }
  }

  const spanX = distPosX + distNegX;
  const spanZ = distPosZ + distNegZ;
  const minSpan = Math.min(spanX, spanZ);
  const maxSpan = Math.max(spanX, spanZ);
  const minWallDist = Math.min(distPosX, distNegX, distPosZ, distNegZ);

  let enclosedSides = 0;
  if (distPosX < 9) enclosedSides++;
  if (distNegX < 9) enclosedSides++;
  if (distPosZ < 9) enclosedSides++;
  if (distNegZ < 9) enclosedSides++;

  let zone: AcousticZone;
  const isSnowOutdoor = opts?.theme === 'snow';
  if (isIndoorCell) {
    if (maxSpan <= 11.5 && minSpan <= 8.5) {
      zone = 'small_room';
    } else if (minSpan <= 7.5 && maxSpan / Math.max(1, minSpan) >= 1.8) {
      zone = 'corridor';
    } else {
      zone = 'large_interior';
    }
  } else if (minSpan <= 6.2 && maxSpan / Math.max(1, minSpan) >= 1.75) {
    zone = 'corridor';
  } else if (enclosedSides >= 4 && maxSpan <= 11.0) {
    zone = 'small_room';
  } else if (isSnowOutdoor && enclosedSides <= 1 && minSpan >= 11) {
    zone = 'outdoor_open';
  } else if (enclosedSides >= 2 || minWallDist < 10.5) {
    zone = 'outdoor_urban';
  } else {
    zone = 'outdoor_open';
  }

  const wallProximity = Math.max(0, Math.min(1, 1 - minWallDist / 12));
  const enclosure = isIndoorCell
    ? Math.max(0.65, Math.min(1, enclosedSides * 0.2 + 0.3))
    : Math.min(0.75, enclosedSides * 0.18 + wallProximity * 0.25);

  const zoneReverbMap: Record<AcousticZone, { early: number; rev: number }> = {
    small_room: { early: 0.48, rev: 0.42 },
    corridor: { early: 0.56, rev: 0.50 },
    large_interior: { early: 0.44, rev: 0.58 },
    outdoor_urban: { early: 0.34, rev: 0.32 },
    outdoor_open: { early: 0.18, rev: 0.18 },
  };
  const zr = zoneReverbMap[zone];

  const surface: AcousticEnvState['surface'] =
    isSnowOutdoor && !isIndoorCell
      ? 'snow'
      : opts?.theme === 'range' || opts?.theme === 'hvh'
        ? 'metal'
        : 'concrete';

  return {
    zone,
    enclosure,
    wallProximity,
    earlyGain: zr.early,
    reverbSend: zr.rev,
    surface,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

export function computeDistanceAcoustics(
  distanceM: number,
  occludingWalls: WallType[],
  zone: AcousticZone,
): DistanceAcousticParams {
  const d = Math.max(0, distanceM);
  if (d >= 80) {
    return {
      gain: 0,
      lowpassHz: 420,
      nearWeight: 0,
      midWeight: 0,
      farWeight: 1,
      reverbSend: 0,
      occluded: occludingWalls.length > 0,
    };
  }

  // Smooth inverse-distance rolloff with cosine tail fade from 64m -> 80m
  const refDist = 3.5;
  const rolloff = 1.15;
  const invDist = d <= refDist ? 1.0 : refDist / (refDist + rolloff * (d - refDist));
  const farFade = d > 64 ? 0.5 * (1 + Math.cos((Math.PI * (d - 64)) / 16)) : 1.0;

  // Air absorption lowpass: 18,000 Hz near -> 2,600 Hz far
  let lowpassHz = 2600 + 15400 * Math.exp(-d / 28);
  let wallAtten = 1.0;

  for (const wt of occludingWalls) {
    if (wt === 'solid') {
      lowpassHz *= 0.34;
      wallAtten *= 0.49; // -6.2 dB
    } else {
      lowpassHz *= 0.58;
      wallAtten *= 0.72; // -2.8 dB
    }
  }
  lowpassHz = clamp(lowpassHz, 420, 18500);

  const gain = clamp(invDist * farFade * wallAtten, 0, 1);

  // Smooth 3-band distance crossfade (Near <18m, Mid 8..42m, Far >18m)
  const nearWeight = clamp(1 - (d - 4) / 16, 0, 1);
  const farWeight = clamp((d - 16) / 36, 0, 1);
  const midWeight = clamp(1 - Math.abs(d - 22) / 24, 0.2, 1);

  const occluded = occludingWalls.length > 0;
  const baseRev =
    zone === 'large_interior'
      ? 0.55
      : zone === 'corridor'
        ? 0.48
        : zone === 'small_room'
          ? 0.38
          : zone === 'outdoor_urban'
            ? 0.32
            : 0.18;
  // Distant and occluded shots diffract more indirect room/urban energy relative to direct dry sound
  const reverbSend = clamp(baseRev + farWeight * 0.22 + (occluded ? 0.16 : 0), 0.1, 0.78);

  return {
    gain,
    lowpassHz,
    nearWeight,
    midWeight,
    farWeight,
    reverbSend,
    occluded,
  };
}
