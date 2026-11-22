import * as THREE from 'three';
import { WEAPONS, getWeaponDef } from '../data/weapons';
import { WallObstacle } from '../game/maps';
import { WeaponAnimator, WeaponAnimContext } from '../game/weaponAnimator';
import { createWeaponRig } from '../game/weaponModels';
import {
  AcousticZone,
  computeDistanceAcoustics,
  generateAcousticIRPCM,
  probeAcousticEnvironment,
} from './acoustics';
import {
  RELOAD_ATLAS_ANCHOR_SRC_SEC,
  ReferenceShotPCM,
  SHELL_ATLAS_ANCHOR_SRC_SEC,
  SHELL_CASING_CLIP_COUNT,
  VariationSelector,
  WeaponMechEvent,
  WeaponSoundId,
  allocF32,
  deriveGunshotFromReferencePCM,
  deriveShellCasingFromAtlasPCM,
  deriveWeaponMechFromAtlasPCM,
  findReloadAtlasAnchorSec,
  findShellAtlasAnchorSec,
  isReloadAtlasMechEvent,
  measureBufferStats,
  mulberry32,
  processDirectWeaponSamplePCM,
  synthesizeGunshotPCM,
  synthesizeWeaponMechPCM,
} from './weaponSamples';

export interface WeaponDspMetrics {
  weaponId: WeaponSoundId;
  durationMs: number;
  peak: number;
  rmsDb: number;
  centroidHz: number;
  attackRmsDb: number;
  bodyRmsDb: number;
  mechRmsDb: number;
}

export interface AudioVerifyResult {
  passed: boolean;
  totalChecks: number;
  passedChecks: number;
  details: string[];
  metrics: WeaponDspMetrics[];
}

function defaultAnimCtx(overrides: Partial<WeaponAnimContext> = {}): WeaponAnimContext {
  return {
    horizSpeed: 0,
    forwardInput: 0,
    strafeInput: 0,
    grounded: true,
    velY: 0,
    crouching: false,
    reloading: false,
    reloadProgress: 0,
    reloadDuration: 2.0,
    scoped: false,
    ammo: 30,
    maxAmmo: 30,
    spinbot: false,
    fireInterval: 0.1,
    ...overrides,
  };
}

function sumLayers(a: Float32Array, b: Float32Array, c: Float32Array): Float32Array {
  const len = Math.max(a.length, b.length, c.length);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = (i < a.length ? a[i] : 0) + (i < b.length ? b[i] : 0) + (i < c.length ? c[i] : 0);
  }
  return out;
}

function waveformDiffRms(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / n);
}

/**
 * Measures max narrowband bin power / total spectrum power using a Hann-windowed 2048-pt FFT
 * centered over the active energy region. Pure sine blips/chimes exceed 0.25-0.70;
 * broadband physical mechanical foley stays well below 0.14.
 */
function measurePeakSpectralConcentration(buf: Float32Array): number {
  const N = 2048;
  let peakIdx = 0;
  let peakAbs = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > peakAbs) {
      peakAbs = a;
      peakIdx = i;
    }
  }
  const start = Math.max(0, Math.min(Math.max(0, buf.length - N), peakIdx - Math.floor(N * 0.25)));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const sIdx = start + i;
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    re[i] = (sIdx < buf.length ? buf[sIdx] : 0) * w;
  }

  // Iterative radix-2 Cooley-Tukey FFT
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenR = Math.cos(ang);
    const wlenI = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let wR = 1;
      let wI = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uR = re[i + j];
        const uI = im[i + j];
        const vR = re[i + j + half] * wR - im[i + j + half] * wI;
        const vI = re[i + j + half] * wI + im[i + j + half] * wR;
        re[i + j] = uR + vR;
        im[i + j] = uI + vI;
        re[i + j + half] = uR - vR;
        im[i + j + half] = uI - vI;
        const nR = wR * wlenR - wI * wlenI;
        wI = wR * wlenI + wI * wlenR;
        wR = nR;
      }
    }
  }

  let totalPower = 0;
  let maxBinPower = 0;
  for (let k = 1; k < N / 2; k++) {
    const p = re[k] * re[k] + im[k] * im[k];
    totalPower += p;
    if (p > maxBinPower) maxBinPower = p;
  }
  return totalPower > 1e-12 ? maxBinPower / totalPower : 1;
}

export function runAudioVerification(): AudioVerifyResult {
  if (typeof globalThis.document === 'undefined') {
    const noopCtx = new Proxy(
      {
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
        putImageData: () => {},
      },
      {
        get(target, prop) {
          if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
          return () => {};
        },
      },
    );
    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => ({
        width: 64,
        height: 64,
        getContext: () => noopCtx,
      }),
    };
  }

  const details: string[] = [];
  const metrics: WeaponDspMetrics[] = [];
  let totalChecks = 0;
  let passedChecks = 0;

  const check = (name: string, cond: boolean, info = '') => {
    totalChecks++;
    if (cond) {
      passedChecks++;
      details.push(`PASS: ${name}${info ? ` (${info})` : ''}`);
    } else {
      details.push(`FAIL: ${name}${info ? ` (${info})` : ''}`);
    }
  };

  // 1. All 8 weapons x 4 gunshot variations: non-clipping, finite, coherent layers & variation uniqueness
  const allWeaponIds: WeaponSoundId[] = ['pistol', 'smg', 'shotgun', 'ssg', 'rifle', 'm4', 'sniper', 'knife'];
  let allGunshotsValid = true;
  let maxPeakObserved = 0;
  let variationsDistinct = true;
  const statsByWeapon = new Map<WeaponSoundId, WeaponDspMetrics>();

  for (const wid of allWeaponIds) {
    const mixes: Float32Array[] = [];
    let firstStats: WeaponDspMetrics | null = null;
    for (let v = 0; v < 4; v++) {
      const pcm = synthesizeGunshotPCM(wid, v, 44100);
      const sum = sumLayers(pcm.attack, pcm.body, pcm.mech);
      const st = measureBufferStats(sum, pcm.sampleRate);
      const atkSt = measureBufferStats(pcm.attack, pcm.sampleRate);
      const bodySt = measureBufferStats(pcm.body, pcm.sampleRate);
      const mechSt = measureBufferStats(pcm.mech, pcm.sampleRate);

      let finite = true;
      for (let i = 0; i < sum.length; i++) {
        if (!Number.isFinite(sum[i])) {
          finite = false;
          break;
        }
      }
      maxPeakObserved = Math.max(maxPeakObserved, st.peak);
      if (!finite || st.peak > 0.985 || atkSt.rms <= 0.005 || bodySt.rms <= 0.005) {
        allGunshotsValid = false;
      }
      if (wid !== 'knife' && mechSt.rms <= 0.005) {
        allGunshotsValid = false;
      }
      mixes.push(sum);
      if (v === 0) {
        firstStats = {
          weaponId: wid,
          durationMs: Math.round(st.durationSec * 1000),
          peak: st.peak,
          rmsDb: st.rmsDb,
          centroidHz: Math.round(st.centroidHz),
          attackRmsDb: atkSt.rmsDb,
          bodyRmsDb: bodySt.rmsDb,
          mechRmsDb: mechSt.rmsDb,
        };
      }
    }

    for (let i = 0; i < mixes.length; i++) {
      for (let j = i + 1; j < mixes.length; j++) {
        if (waveformDiffRms(mixes[i], mixes[j]) < 0.01) {
          variationsDistinct = false;
        }
      }
    }
    if (firstStats) {
      metrics.push(firstStats);
      statsByWeapon.set(wid, firstStats);
    }
  }

  check(
    'All 8 weapons x 4 gunshot variations are finite, zero-clipping (<=0.985), and distinct across takes',
    allGunshotsValid && variationsDistinct,
    `maxPeak=${maxPeakObserved.toFixed(3)}, allValid=${allGunshotsValid}, distinct=${variationsDistinct}`,
  );

  // 2. Spectral & Loudness Weapon Identity Verification
  const sniperSt = statsByWeapon.get('sniper')!;
  const rifleSt = statsByWeapon.get('rifle')!;
  const m4St = statsByWeapon.get('m4')!;
  const smgSt = statsByWeapon.get('smg')!;
  const shotgunSt = statsByWeapon.get('shotgun')!;

  check(
    'Weapon class spectral & temporal separation (AWP/Shotgun deeper & longer, M4 brighter than AK, suppressed SMG quieter body)',
    sniperSt.durationMs > m4St.durationMs &&
      shotgunSt.durationMs > rifleSt.durationMs &&
      m4St.centroidHz > rifleSt.centroidHz &&
      smgSt.bodyRmsDb < rifleSt.bodyRmsDb &&
      sniperSt.centroidHz < m4St.centroidHz,
    `AK_c=${rifleSt.centroidHz}Hz/${rifleSt.durationMs}ms, M4_c=${m4St.centroidHz}Hz/${m4St.durationMs}ms, AWP_c=${sniperSt.centroidHz}Hz/${sniperSt.durationMs}ms, SMG_body=${smgSt.bodyRmsDb.toFixed(1)}dB`,
  );

  // 3. Anti-Repetition VariationSelector over 500 draws
  {
    const sel = new VariationSelector();
    let zeroRepeats = true;
    let last = -1;
    for (let i = 0; i < 500; i++) {
      const idx = sel.next('test_shot', 4, i * 37 + 13);
      if (idx === last || idx < 0 || idx >= 4) {
        zeroRepeats = false;
        break;
      }
      last = idx;
    }
    check('VariationSelector guarantees zero immediate sample repeats over 500 draws', zeroRepeats);
  }

  // 4. Reload & Mechanical Foley Class Distinction & Zero Clipping
  {
    const rifleMag = synthesizeWeaponMechPCM('mag_in', 'rifle', 0);
    const m4Mag = synthesizeWeaponMechPCM('mag_in', 'm4', 0);
    const pistolMag = synthesizeWeaponMechPCM('mag_in', 'pistol', 0);
    const shellIns = synthesizeWeaponMechPCM('shell_insert', 'shotgun', 0);
    const magSlap = synthesizeWeaponMechPCM('mag_slap', 'm4', 0);
    const holster = synthesizeWeaponMechPCM('holster', 'sniper', 0);

    const diffRifleM4 = waveformDiffRms(rifleMag, m4Mag);
    const diffRiflePistol = waveformDiffRms(rifleMag, pistolMag);
    const stats = [rifleMag, m4Mag, pistolMag, shellIns, magSlap, holster].map((b) =>
      measureBufferStats(b, 44100),
    );
    const noMechClip = stats.every((s) => s.peak <= 0.96 && s.rms > 0.02);

    check(
      'Reload & mechanical foley waveforms are distinct per weapon class and clip-free',
      noMechClip && diffRifleM4 > 0.04 && diffRiflePistol > 0.04,
      `diffRifleM4=${diffRifleM4.toFixed(3)}, diffRiflePistol=${diffRiflePistol.toFixed(3)}`,
    );

    // 4b. Anti-blip broadband spectral spread, finite/non-clipping & variation uniqueness across all 12 reload events
    const reloadEvents: WeaponMechEvent[] = [
      'mag_release',
      'mag_out',
      'mag_in',
      'mag_slap',
      'bolt_pull',
      'bolt_release',
      'bolt_lift',
      'bolt_lock',
      'shell_insert',
      'pump_back',
      'pump_fwd',
      'reload_end',
    ];
    const mechClasses: WeaponSoundId[] = ['rifle', 'm4', 'pistol', 'shotgun', 'sniper', 'smg'];
    let maxTonality = 0;
    let worstEvent = '';
    let minMechRms = 1;
    let maxMechPeak = 0;
    let minTakeDiff = 1;
    let allFinite = true;

    for (const wid of mechClasses) {
      for (const ev of reloadEvents) {
        const takes = [0, 1, 2].map((v) => synthesizeWeaponMechPCM(ev, wid, v, 44100));
        for (const buf of takes) {
          for (let i = 0; i < buf.length; i++) {
            if (!Number.isFinite(buf[i])) {
              allFinite = false;
              break;
            }
          }
          const st = measureBufferStats(buf, 44100);
          maxMechPeak = Math.max(maxMechPeak, st.peak);
          minMechRms = Math.min(minMechRms, st.rms);
          const ratio = measurePeakSpectralConcentration(buf);
          if (ratio > maxTonality) {
            maxTonality = ratio;
            worstEvent = `${wid}:${ev}`;
          }
        }
        const td01 = waveformDiffRms(takes[0], takes[1]);
        const td12 = waveformDiffRms(takes[1], takes[2]);
        minTakeDiff = Math.min(minTakeDiff, td01, td12);
      }
    }

    check(
      'All 12 reload & mechanical foley events are broadband anti-blip (maxBinRatio < 0.14), audible, and take-distinct',
      allFinite && maxMechPeak <= 0.92 && minMechRms >= 0.025 && maxTonality < 0.14 && minTakeDiff > 0.02,
      `maxBinRatio=${maxTonality.toFixed(3)}@${worstEvent}, peak=${maxMechPeak.toFixed(3)}, minRms=${minMechRms.toFixed(3)}, minTakeDiff=${minTakeDiff.toFixed(3)}`,
    );
  }

  // 5. 5-Zone Convolution Impulse Responses
  {
    const zones: AcousticZone[] = ['small_room', 'corridor', 'large_interior', 'outdoor_urban', 'outdoor_open'];
    let allIrOk = true;
    const irStats: Record<string, { durMs: number; rms: number }> = {};
    for (const z of zones) {
      const [l, r] = generateAcousticIRPCM(z, 44100);
      const sl = measureBufferStats(l, 44100);
      const sr = measureBufferStats(r, 44100);
      const lrDiff = waveformDiffRms(l, r);
      if (sl.peak > 0.9 || sr.peak > 0.9 || lrDiff < 0.005 || sl.rms <= 0.002) {
        allIrOk = false;
      }
      irStats[z] = { durMs: Math.round(sl.durationSec * 1000), rms: sl.rms };
    }
    check(
      'All 5 acoustic zone IRs are stereo-decorrelated, peak-safe, and have distinct decay lengths',
      allIrOk && irStats.small_room.durMs < irStats.large_interior.durMs && irStats.corridor.durMs < irStats.outdoor_open.durMs,
      `smallRoom=${irStats.small_room.durMs}ms, corridor=${irStats.corridor.durMs}ms, largeInt=${irStats.large_interior.durMs}ms`,
    );
  }

  // 6. Geometric Environment Probing
  {
    const mkWall = (minX: number, maxX: number, minZ: number, maxZ: number): WallObstacle => ({
      mesh: new THREE.Mesh(),
      box: new THREE.Box3(new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(maxX, 4, maxZ)),
      wallType: 'solid',
    });
    const smallRoomWalls = [
      mkWall(-3, 3, -3.5, -2.5),
      mkWall(-3, 3, 2.5, 3.5),
      mkWall(-3.5, -2.5, -3, 3),
      mkWall(2.5, 3.5, -3, 3),
    ];
    const corridorWalls = [
      mkWall(-2.5, -1.5, -18, 18),
      mkWall(1.5, 2.5, -18, 18),
    ];
    const openEnv = probeAcousticEnvironment({ x: 0, y: 1.6, z: 0 }, [], { theme: 'snow' });
    const smallEnv = probeAcousticEnvironment({ x: 0, y: 1.6, z: 0 }, smallRoomWalls);
    const corrEnv = probeAcousticEnvironment({ x: 0, y: 1.6, z: 0 }, corridorWalls);
    check(
      'probeAcousticEnvironment classifies small_room, corridor, and outdoor_open accurately',
      smallEnv.zone === 'small_room' && corrEnv.zone === 'corridor' && openEnv.zone === 'outdoor_open' && openEnv.surface === 'snow',
      `small=${smallEnv.zone}, corr=${corrEnv.zone}, open=${openEnv.zone}(${openEnv.surface})`,
    );
  }

  // 7. Distance Attenuation, Smooth Tail Fade & Wall Occlusion Curve
  {
    const d2 = computeDistanceAcoustics(2, [], 'outdoor_urban');
    const d18 = computeDistanceAcoustics(18, [], 'outdoor_urban');
    const d48 = computeDistanceAcoustics(48, [], 'outdoor_urban');
    const d72 = computeDistanceAcoustics(72, [], 'outdoor_urban');
    const d82 = computeDistanceAcoustics(82, [], 'outdoor_urban');
    const thin1 = computeDistanceAcoustics(18, ['thin'], 'outdoor_urban');
    const solid1 = computeDistanceAcoustics(18, ['solid'], 'outdoor_urban');
    const solid2 = computeDistanceAcoustics(18, ['solid', 'solid'], 'outdoor_urban');

    const monotonicDist = d2.gain > d18.gain && d18.gain > d48.gain && d48.gain > d72.gain && d72.gain > 0 && d82.gain === 0;
    const monotonicLpf = d2.lowpassHz > d18.lowpassHz && d18.lowpassHz > d48.lowpassHz && d48.lowpassHz > d72.lowpassHz;
    const occlusionOk =
      d18.gain > thin1.gain &&
      thin1.gain > solid1.gain &&
      solid1.gain > solid2.gain &&
      d18.lowpassHz > thin1.lowpassHz &&
      thin1.lowpassHz > solid1.lowpassHz &&
      solid1.lowpassHz > solid2.lowpassHz &&
      solid1.reverbSend > d18.reverbSend;

    check(
      'Distance rolloff is monotonic up to 80m (no 42m hard cut) and wall occlusion lowers gain + cutoff accurately',
      monotonicDist && monotonicLpf && occlusionOk,
      `d18=${d18.gain.toFixed(2)}@${Math.round(d18.lowpassHz)}Hz, thin1=${thin1.gain.toFixed(2)}@${Math.round(thin1.lowpassHz)}Hz, solid1=${solid1.gain.toFixed(2)}@${Math.round(solid1.lowpassHz)}Hz`,
    );
  }

  // 8. WeaponAnimator Per-Weapon Reload Timelines & Foley Cancellation on Interrupt
  {
    const m4Def = getWeaponDef('m4');
    const m4Rig = createWeaponRig(m4Def);
    const sniperDef = getWeaponDef('sniper');
    const sniperRig = createWeaponRig(sniperDef);

    const m4Events: WeaponMechEvent[] = [];
    const snEvents: WeaponMechEvent[] = [];
    let cancels = 0;

    const anim = new WeaponAnimator();
    anim.setCallbacks({
      onMechSound: (ev, wid) => (wid === 'sniper' ? snEvents : m4Events).push(ev),
      onCancelFoley: () => cancels++,
    });

    anim.onEquip(m4Def, m4Rig);
    anim.onReloadStart();
    for (let i = 1; i <= 60; i++) {
      anim.update(1 / 60, defaultAnimCtx({ reloading: true, reloadProgress: i / 60 }));
    }
    const m4Ok =
      m4Events.includes('mag_release') &&
      m4Events.includes('mag_out') &&
      m4Events.includes('mag_in') &&
      m4Events.includes('mag_slap') &&
      m4Events.includes('bolt_release') &&
      m4Events.includes('reload_end');

    // Equip sniper mid-cycle and run sniper reload -> verify holster + sniper bolt sequence + cancelFoley
    anim.onEquip(sniperDef, sniperRig);
    const cancelsAfterEquip = cancels;
    const holsterFired = m4Events.includes('holster');

    anim.onReloadStart();
    for (let i = 1; i <= 60; i++) {
      anim.update(1 / 60, defaultAnimCtx({ reloading: true, reloadProgress: i / 60 }));
    }
    const snOk =
      snEvents.includes('mag_release') &&
      snEvents.includes('bolt_lift') &&
      snEvents.includes('bolt_pull') &&
      snEvents.includes('bolt_lock') &&
      snEvents.includes('reload_end');

    // Cancel mid-reload
    anim.onReloadStart();
    anim.update(1 / 60, defaultAnimCtx({ reloading: true, reloadProgress: 0.3 }));
    anim.cancelReload(true, 0);

    check(
      'WeaponAnimator executes bespoke reload timelines (M4 slap, AWP cam-lift/lock, holster) and fires onCancelFoley on interrupts',
      m4Ok && snOk && holsterFired && cancelsAfterEquip >= 1 && cancels >= 3,
      `m4=[${m4Events.join(',')}], sn=[${snEvents.join(',')}], cancels=${cancels}`,
    );

    m4Rig.dispose();
    sniperRig.dispose();
  }

  // 10. Real-Reference Hybrid Gunshot Derivation (AAC Priming Trim, Stereo Separation & Caliber Identity)
  {
    const sr = 48000;
    const totalLen = Math.floor(sr * 1.25);
    const padSamples = Math.floor(sr * 0.025); // Simulated 25ms AAC priming silence prefix
    const refL = allocF32(totalLen);
    const refR = allocF32(totalLen);
    const prng = mulberry32(98765);

    // Construct realistic pistol-like synthetic test reference after 25ms padding:
    // sharp crack + dense low-frequency air pressure wavefront + stereo outdoor slapback tail
    for (let i = padSamples; i < totalLen; i++) {
      const t = (i - padSamples) / sr;
      const crack = t < 0.008 ? Math.sin(t * 2 * Math.PI * 2600) * Math.exp(-t / 0.0025) * 0.45 : 0;
      const blast = Math.exp(-t / 0.028) * Math.sin(t * 2 * Math.PI * 62) * 0.65;
      const bark = Math.exp(-t / 0.14) * (prng() * 2 - 1) * 0.25;
      const tailL = Math.exp(-t / 0.34) * (prng() * 2 - 1) * 0.16;
      const tailR = Math.exp(-t / 0.34) * (prng() * 2 - 1) * 0.16;
      refL[i] = Math.max(-0.95, Math.min(0.95, crack + blast + bark + tailL));
      refR[i] = Math.max(-0.95, Math.min(0.95, crack * 0.92 + blast + bark + tailR));
    }
    const testRef: ReferenceShotPCM = { left: refL, right: refR, sampleRate: sr };

    const firearms: Exclude<WeaponSoundId, 'knife'>[] = [
      'pistol',
      'smg',
      'shotgun',
      'ssg',
      'rifle',
      'm4',
      'sniper',
    ];
    let allValid = true;
    let trimEarlyPeak = true;
    let maxDerivedPeak = 0;
    let minStereoDiff = 1;
    let minTakeDiff = 1;
    const derivedStats = new Map<WeaponSoundId, { durMs: number; centroidHz: number; bodyRmsDb: number }>();

    for (const wid of firearms) {
      const mixes: Float32Array[] = [];
      for (let v = 0; v < 4; v++) {
        const d = deriveGunshotFromReferencePCM(testRef, wid, v, 44100);
        const mixL = sumLayers(d.attackL, d.bodyL, d.mech);
        const mixR = sumLayers(d.attackR, d.bodyR, d.mech);
        const stL = measureBufferStats(mixL, d.sampleRate);
        const stR = measureBufferStats(mixR, d.sampleRate);
        const stBody = measureBufferStats(d.bodyL, d.sampleRate);

        let finite = true;
        for (let i = 0; i < mixL.length; i++) {
          if (!Number.isFinite(mixL[i]) || !Number.isFinite(mixR[i])) {
            finite = false;
            break;
          }
        }
        if (wid === 'pistol' && v === 0) {
          let atkMax = 0;
          let earlyMax = 0;
          const earlySamples = Math.min(d.attackL.length, Math.floor(d.sampleRate * 0.008));
          for (let i = 0; i < d.attackL.length; i++) {
            const a = Math.abs(d.attackL[i]);
            if (a > atkMax) atkMax = a;
            if (i < earlySamples && a > earlyMax) earlyMax = a;
          }
          if (atkMax <= 0 || earlyMax < atkMax * 0.25) {
            trimEarlyPeak = false;
          }
        }
        maxDerivedPeak = Math.max(maxDerivedPeak, stL.peak, stR.peak);
        minStereoDiff = Math.min(minStereoDiff, waveformDiffRms(mixL, mixR));
        if (!finite || stL.peak > 0.96 || stR.peak > 0.96) {
          allValid = false;
        }
        mixes.push(mixL);
        if (v === 0) {
          derivedStats.set(wid, {
            durMs: Math.round(stL.durationSec * 1000),
            centroidHz: Math.round(stL.centroidHz),
            bodyRmsDb: stBody.rmsDb,
          });
        }
      }
      for (let i = 0; i < mixes.length; i++) {
        for (let j = i + 1; j < mixes.length; j++) {
          minTakeDiff = Math.min(minTakeDiff, waveformDiffRms(mixes[i], mixes[j]));
        }
      }
    }

    const rSniper = derivedStats.get('sniper')!;
    const rM4 = derivedStats.get('m4')!;
    const rRifle = derivedStats.get('rifle')!;
    const rShotgun = derivedStats.get('shotgun')!;
    const rSmg = derivedStats.get('smg')!;
    const sepOk =
      rSniper.durMs > rM4.durMs &&
      rShotgun.durMs > rRifle.durMs &&
      rM4.centroidHz > rRifle.centroidHz &&
      rSmg.bodyRmsDb < rRifle.bodyRmsDb &&
      rSniper.centroidHz < rM4.centroidHz;

    check(
      'Real-reference stereo derivation trims priming padding, preserves stereo width & unique takes, and maintains weapon class separation',
      allValid && trimEarlyPeak && sepOk && minStereoDiff > 0.015 && minTakeDiff > 0.015,
      `peak=${maxDerivedPeak.toFixed(3)}, stereoDiff=${minStereoDiff.toFixed(3)}, takeDiff=${minTakeDiff.toFixed(3)}, AK_c=${rRifle.centroidHz}Hz, M4_c=${rM4.centroidHz}Hz, AWP_c=${rSniper.centroidHz}Hz`,
    );
  }

  // 11. Direct Per-Weapon Sample Processing across all 8 weapons (including knife & mono-source decorrelation)
  {
    const sr = 48000;
    const totalLen = Math.floor(sr * 1.15);
    const padSamples = Math.floor(sr * 0.025);
    const stL = allocF32(totalLen);
    const stR = allocF32(totalLen);
    const monoBuf = allocF32(totalLen);
    const prng = mulberry32(54321);

    for (let i = padSamples; i < totalLen; i++) {
      const t = (i - padSamples) / sr;
      const crack = t < 0.01 ? Math.sin(t * 2 * Math.PI * 2200) * Math.exp(-t / 0.003) * 0.45 : 0;
      const body = Math.exp(-t / 0.16) * (prng() * 2 - 1) * 0.34;
      const sub = Math.exp(-t / 0.035) * Math.sin(t * 2 * Math.PI * 80) * 0.52;
      const m = Math.max(-0.92, Math.min(0.92, crack + body + sub));
      monoBuf[i] = m;
      stL[i] = m;
      stR[i] = Math.max(-0.92, Math.min(0.92, crack * 0.9 + body * 0.94 + sub));
    }

    const stereoRef: ReferenceShotPCM = { left: stL, right: stR, sampleRate: sr };
    const monoRef: ReferenceShotPCM = { left: monoBuf, right: monoBuf, sampleRate: sr };

    let allFinite = true;
    let maxDirectPeak = 0;
    let earlyTrimOk = true;
    let minTakeDiff = 1;
    let minMonoStereoDiff = 1;
    let knifeOk = true;
    let pitchPreservedOk = true;

    const rifleCentroids: number[] = [];
    const sniperCentroids: number[] = [];

    for (const wid of allWeaponIds) {
      const mixes: Float32Array[] = [];
      for (let v = 0; v < 4; v++) {
        const d = processDirectWeaponSamplePCM(stereoRef, wid, v, 44100);
        const mixL = sumLayers(d.attackL, d.bodyL, d.mech);
        const mixR = sumLayers(d.attackR, d.bodyR, d.mech);
        const sL = measureBufferStats(mixL, d.sampleRate);
        const sR = measureBufferStats(mixR, d.sampleRate);

        for (let i = 0; i < mixL.length; i++) {
          if (!Number.isFinite(mixL[i]) || !Number.isFinite(mixR[i])) {
            allFinite = false;
            break;
          }
        }
        maxDirectPeak = Math.max(maxDirectPeak, sL.peak, sR.peak);
        if (sL.peak > 0.96 || sR.peak > 0.96) allFinite = false;

        if ((wid === 'rifle' || wid === 'pistol') && v === 0) {
          let fullMax = 0;
          let earlyMax = 0;
          const earlySamples = Math.min(mixL.length, Math.floor(d.sampleRate * 0.01));
          for (let i = 0; i < mixL.length; i++) {
            const a = Math.abs(mixL[i]);
            if (a > fullMax) fullMax = a;
            if (i < earlySamples && a > earlyMax) earlyMax = a;
          }
          if (fullMax <= 0 || earlyMax < fullMax * 0.25) earlyTrimOk = false;
        }

        if (wid === 'knife') {
          const atkS = measureBufferStats(d.attackL, d.sampleRate);
          const bodyS = measureBufferStats(d.bodyL, d.sampleRate);
          const mechS = measureBufferStats(d.mech, d.sampleRate);
          if (atkS.rms <= 0.01 || bodyS.rms <= 0.01 || mechS.rms !== 0) knifeOk = false;
        }

        if (wid === 'rifle' && v === 0) rifleCentroids.push(sL.centroidHz);
        if (wid === 'sniper' && v === 0) sniperCentroids.push(sL.centroidHz);

        const dm = processDirectWeaponSamplePCM(monoRef, wid, v, 44100);
        const mMixL = sumLayers(dm.attackL, dm.bodyL, dm.mech);
        const mMixR = sumLayers(dm.attackR, dm.bodyR, dm.mech);
        minMonoStereoDiff = Math.min(minMonoStereoDiff, waveformDiffRms(mMixL, mMixR));

        mixes.push(mixL);
      }
      for (let i = 0; i < mixes.length; i++) {
        for (let j = i + 1; j < mixes.length; j++) {
          minTakeDiff = Math.min(minTakeDiff, waveformDiffRms(mixes[i], mixes[j]));
        }
      }
    }

    if (rifleCentroids.length && sniperCentroids.length) {
      const ratio = sniperCentroids[0] / Math.max(1, rifleCentroids[0]);
      if (ratio < 0.72 || ratio > 1.35) pitchPreservedOk = false;
    }

    check(
      'Direct per-weapon sample processor trims priming padding, preserves natural pitch & stereo width across all 8 weapons (incl. knife), and varies takes without clipping',
      allFinite && earlyTrimOk && knifeOk && pitchPreservedOk && minMonoStereoDiff > 0.01 && minTakeDiff > 0.012,
      `maxPeak=${maxDirectPeak.toFixed(3)}, monoToStereo=${minMonoStereoDiff.toFixed(3)}, takeDiff=${minTakeDiff.toFixed(3)}, rifleC=${Math.round(rifleCentroids[0] ?? 0)}Hz, sniperC=${Math.round(sniperCentroids[0] ?? 0)}Hz`,
    );
  }

  // 12. Reload Foley Atlas Slicing: per-weapon differentiation, anchor invariance, stereo widening & clip safety
  {
    const sr = 48000;
    const offsetSec = 0.600;
    const totalLen = Math.floor(sr * 15.0);
    const atlasMono = allocF32(totalLen);
    const prng = mulberry32(20261122);

    const synthWindows: Array<[number, number, number]> = [
      [0.7775, 0.998, 2900],
      [1.052, 1.205, 3400],
      [1.415, 1.608, 2600],
      [1.622, 1.818, 3800],
      [2.142, 2.538, 3100],
      [3.772, 3.898, 2200],
      [4.192, 4.700, 1950],
      [4.715, 5.172, 2400],
      [5.265, 5.695, 2050],
      [6.750, 6.900, 4100],
      [7.075, 7.260, 4600],
      [7.270, 7.520, 3600],
      [7.590, 7.820, 4300],
      [8.700, 8.960, 2750],
      [9.360, 9.620, 3300],
      [9.702, 10.168, 3950],
      [11.122, 11.340, 3500],
      [11.412, 11.810, 2950],
      [11.922, 12.095, 3700],
      [13.000, 13.605, 2350],
      [14.090, 14.368, 2650],
      [14.640, 14.695, 3150],
    ];
    for (const [sSrc, eSrc, toneHz] of synthWindows) {
      const i0 = Math.max(0, Math.floor((sSrc - offsetSec) * sr));
      const i1 = Math.min(totalLen, Math.floor((eSrc - offsetSec) * sr));
      for (let i = i0; i < i1; i++) {
        const t = (i - i0) / sr;
        const env = Math.exp(-t / Math.max(0.025, (eSrc - sSrc) * 0.45));
        const sig = (Math.sin(2 * Math.PI * toneHz * t) * 0.35 + (prng() * 2 - 1) * 0.65) * env * 0.65;
        atlasMono[i] = Math.max(-0.92, Math.min(0.92, atlasMono[i] + sig));
      }
    }

    const shiftSamples = Math.floor(sr * 0.022);
    const atlasShifted = allocF32(totalLen);
    atlasShifted.set(atlasMono.subarray(0, totalLen - shiftSamples), shiftSamples);

    const testAtlas: ReferenceShotPCM = { left: atlasMono, right: atlasMono, sampleRate: sr };
    const shiftedAtlas: ReferenceShotPCM = { left: atlasShifted, right: atlasShifted, sampleRate: sr };
    const anchorA = findReloadAtlasAnchorSec(testAtlas);
    const anchorB = findReloadAtlasAnchorSec(shiftedAtlas);

    const reloadWeapons: Exclude<WeaponSoundId, 'knife'>[] = [
      'pistol',
      'smg',
      'shotgun',
      'ssg',
      'rifle',
      'm4',
      'sniper',
    ];
    const weaponEvents: Record<Exclude<WeaponSoundId, 'knife'>, WeaponMechEvent[]> = {
      pistol: ['mag_release', 'mag_out', 'mag_in', 'bolt_release', 'reload_end'],
      smg: ['mag_release', 'mag_out', 'mag_in', 'bolt_pull', 'bolt_release', 'reload_end'],
      m4: ['mag_release', 'mag_out', 'mag_in', 'mag_slap', 'bolt_release', 'reload_end'],
      rifle: ['mag_release', 'mag_out', 'mag_in', 'bolt_pull', 'bolt_release', 'reload_end'],
      ssg: ['mag_release', 'mag_out', 'mag_in', 'bolt_lift', 'bolt_pull', 'bolt_lock', 'reload_end'],
      sniper: ['mag_release', 'mag_out', 'mag_in', 'bolt_lift', 'bolt_pull', 'bolt_lock', 'reload_end'],
      shotgun: ['shell_insert', 'pump_back', 'pump_fwd', 'equip_rack', 'reload_end'],
    };

    let allValid = true;
    let maxPeak = 0;
    let minRms = 1;
    let minStereoDiff = 1;
    let minTakeDiff = 1;
    let maxAnchorDriftDiff = 0;

    const repByWeapon = new Map<string, Float32Array>();
    for (const wid of reloadWeapons) {
      for (const ev of weaponEvents[wid]) {
        const takesL: Float32Array[] = [];
        for (let v = 0; v < 3; v++) {
          const out = deriveWeaponMechFromAtlasPCM(testAtlas, ev, wid, v, 44100, anchorA);
          const sL = measureBufferStats(out.left, out.sampleRate);
          const sR = measureBufferStats(out.right, out.sampleRate);
          for (let i = 0; i < out.left.length; i++) {
            if (!Number.isFinite(out.left[i]) || !Number.isFinite(out.right[i])) {
              allValid = false;
              break;
            }
          }
          maxPeak = Math.max(maxPeak, sL.peak, sR.peak);
          minRms = Math.min(minRms, sL.rms, sR.rms);
          minStereoDiff = Math.min(minStereoDiff, waveformDiffRms(out.left, out.right));
          if (sL.peak > 0.90 || sR.peak > 0.90 || sL.rms < 0.02) allValid = false;
          takesL.push(out.left);

          if (v === 0 && (ev === 'mag_out' || ev === 'pump_back')) {
            const outShifted = deriveWeaponMechFromAtlasPCM(shiftedAtlas, ev, wid, v, 44100, anchorB);
            maxAnchorDriftDiff = Math.max(maxAnchorDriftDiff, waveformDiffRms(out.left, outShifted.left));
            if (ev === 'mag_out' || wid === 'shotgun') repByWeapon.set(wid, out.left);
          }
        }
        minTakeDiff = Math.min(
          minTakeDiff,
          waveformDiffRms(takesL[0], takesL[1]),
          waveformDiffRms(takesL[1], takesL[2]),
        );
      }
    }

    let minWeaponDiff = 1;
    for (let i = 0; i < reloadWeapons.length; i++) {
      for (let j = i + 1; j < reloadWeapons.length; j++) {
        const a = repByWeapon.get(reloadWeapons[i]);
        const b = repByWeapon.get(reloadWeapons[j]);
        if (!a || !b) {
          allValid = false;
        } else {
          minWeaponDiff = Math.min(minWeaponDiff, waveformDiffRms(a, b));
        }
      }
    }

    const predicateOk =
      !isReloadAtlasMechEvent('holster') &&
      !isReloadAtlasMechEvent('equip_rustle') &&
      !isReloadAtlasMechEvent('knife_draw') &&
      !isReloadAtlasMechEvent('knife_spin') &&
      isReloadAtlasMechEvent('mag_in') &&
      RELOAD_ATLAS_ANCHOR_SRC_SEC > 0.7;

    check(
      'Reload foley atlas produces distinct weapon reload signatures across all 7 firearms, invariant to +22ms priming offset, stereo-widened & clip-free',
      allValid &&
        predicateOk &&
        minStereoDiff > 0.01 &&
        minTakeDiff > 0.012 &&
        minWeaponDiff > 0.04 &&
        maxAnchorDriftDiff < 0.03 &&
        Math.abs(anchorB - anchorA - 0.022) < 0.002,
      `maxPeak=${maxPeak.toFixed(3)}, minRms=${minRms.toFixed(3)}, stDiff=${minStereoDiff.toFixed(3)}, takeDiff=${minTakeDiff.toFixed(3)}, minWpnDiff=${minWeaponDiff.toFixed(3)}, shiftDrift=${maxAnchorDriftDiff.toFixed(4)}`,
    );
  }

  // 13. Bullet Shell Casing Ground-Hit Atlas across 12 clips + shotgun adaptation & priming invariance
  {
    const sr = 48000;
    const offsetSec = 0.250;
    const totalLen = Math.floor(sr * 15.0);
    const left = allocF32(totalLen);
    const right = allocF32(totalLen);
    const prng = mulberry32(951075);

    const clipWindows: Array<[number, number, number]> = [
      [0.3964, 0.820, 6200],
      [1.280, 1.730, 5600],
      [2.340, 2.810, 7400],
      [3.410, 3.810, 5200],
      [4.580, 4.900, 4800],
      [5.530, 5.950, 6800],
      [6.990, 7.450, 4900],
      [8.240, 8.810, 6500],
      [9.710, 10.200, 7100],
      [11.130, 11.760, 5800],
      [12.760, 13.170, 5400],
      [14.130, 14.730, 7700],
    ];

    for (let c = 0; c < clipWindows.length; c++) {
      const [sSrc, eSrc, baseHz] = clipWindows[c];
      const i0 = Math.max(0, Math.floor((sSrc - offsetSec) * sr));
      const i1 = Math.min(totalLen, Math.floor((eSrc - offsetSec) * sr));
      const bounces = [0, 0.085 + (c % 3) * 0.018, 0.175 + (c % 4) * 0.022, 0.26];
      for (let bi = 0; bi < bounces.length; bi++) {
        const bStart = i0 + Math.floor(bounces[bi] * sr);
        const amp = 0.35 * Math.pow(0.65, bi);
        const durS = Math.floor(0.065 * sr);
        for (let k = 0; k < durS && bStart + k < i1; k++) {
          const t = k / sr;
          const env = Math.exp(-t / 0.018);
          const ping =
            Math.sin(2 * Math.PI * baseHz * t) * 0.45 +
            Math.sin(2 * Math.PI * (baseHz * 1.43) * t) * 0.35 +
            (prng() * 2 - 1) * 0.35;
          const pingR =
            Math.sin(2 * Math.PI * (baseHz * 1.015) * t + 0.6) * 0.45 +
            Math.sin(2 * Math.PI * (baseHz * 1.41) * t + 0.9) * 0.35 +
            (prng() * 2 - 1) * 0.35;
          left[bStart + k] = Math.max(-0.9, Math.min(0.9, left[bStart + k] + ping * env * amp));
          right[bStart + k] = Math.max(-0.9, Math.min(0.9, right[bStart + k] + pingR * env * amp));
        }
      }
    }

    const shiftSamples = Math.floor(sr * 0.022);
    const shiftedL = allocF32(totalLen);
    const shiftedR = allocF32(totalLen);
    shiftedL.set(left.subarray(0, totalLen - shiftSamples), shiftSamples);
    shiftedR.set(right.subarray(0, totalLen - shiftSamples), shiftSamples);

    const atlas: ReferenceShotPCM = { left, right, sampleRate: sr };
    const shiftedAtlas: ReferenceShotPCM = { left: shiftedL, right: shiftedR, sampleRate: sr };
    const anchorA = findShellAtlasAnchorSec(atlas);
    const anchorB = findShellAtlasAnchorSec(shiftedAtlas);

    let allValid = true;
    let maxPeak = 0;
    let minRms = 1;
    let minStereoDiff = 1;
    let maxShiftDiff = 0;
    let brassCentSum = 0;
    let sgCentSum = 0;
    const brassClips: Float32Array[] = [];

    for (let idx = 0; idx < SHELL_CASING_CLIP_COUNT; idx++) {
      const br = deriveShellCasingFromAtlasPCM(atlas, idx, false, 44100, anchorA);
      const sg = deriveShellCasingFromAtlasPCM(atlas, idx, true, 44100, anchorA);
      const sh = deriveShellCasingFromAtlasPCM(shiftedAtlas, idx, false, 44100, anchorB);

      for (const s of [br, sg]) {
        const stL = measureBufferStats(s.left, s.sampleRate);
        const stR = measureBufferStats(s.right, s.sampleRate);
        for (let i = 0; i < s.left.length; i++) {
          if (!Number.isFinite(s.left[i]) || !Number.isFinite(s.right[i])) {
            allValid = false;
            break;
          }
        }
        maxPeak = Math.max(maxPeak, stL.peak, stR.peak);
        minRms = Math.min(minRms, stL.rms, stR.rms);
        minStereoDiff = Math.min(minStereoDiff, waveformDiffRms(s.left, s.right));
        if (stL.peak > 0.72 || stR.peak > 0.72 || stL.rms < 0.025) allValid = false;
      }

      brassCentSum += measureBufferStats(br.left, br.sampleRate).centroidHz;
      sgCentSum += measureBufferStats(sg.left, sg.sampleRate).centroidHz;
      maxShiftDiff = Math.max(maxShiftDiff, waveformDiffRms(br.left, sh.left));
      brassClips.push(br.left);
    }

    let minClipDiff = 1;
    for (let i = 0; i < brassClips.length; i++) {
      for (let j = i + 1; j < brassClips.length; j++) {
        minClipDiff = Math.min(minClipDiff, waveformDiffRms(brassClips[i], brassClips[j]));
      }
    }

    const avgBrassC = brassCentSum / SHELL_CASING_CLIP_COUNT;
    const avgSgC = sgCentSum / SHELL_CASING_CLIP_COUNT;

    check(
      'Shell casing atlas produces 12 distinct stereo ground-hit clips, warmer shotgun hull variants, and is invariant to +22ms priming offset',
      allValid &&
        SHELL_ATLAS_ANCHOR_SRC_SEC > 0.35 &&
        minStereoDiff > 0.005 &&
        minClipDiff > 0.015 &&
        avgSgC < avgBrassC * 0.75 &&
        maxShiftDiff < 0.02 &&
        Math.abs(anchorB - anchorA - 0.022) < 0.002,
      `maxPeak=${maxPeak.toFixed(3)}, minRms=${minRms.toFixed(3)}, stDiff=${minStereoDiff.toFixed(3)}, clipDiff=${minClipDiff.toFixed(3)}, brassC=${Math.round(avgBrassC)}Hz, sgC=${Math.round(avgSgC)}Hz, shiftDrift=${maxShiftDiff.toFixed(4)}`,
    );
  }

  return {
    passed: passedChecks === totalChecks,
    totalChecks,
    passedChecks,
    details,
    metrics,
  };
}
