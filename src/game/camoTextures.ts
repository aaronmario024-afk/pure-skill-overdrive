import * as THREE from 'three';
import { CamoPatternId } from '../data/skins';

export const CAMO_TIME_UNIFORM = { value: 0 };

export function updateCamoClock(timeSec: number): void {
  CAMO_TIME_UNIFORM.value = timeSec;
}

export interface CamoTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

export interface CamoMaterialSpec {
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  normalScale: number;
  envMapIntensity: number;
  shaderAnimated: boolean;
}

const camoTexCache = new Map<CamoPatternId, CamoTextureSet>();
const camoTexChannel1Cache = new Map<CamoPatternId, CamoTextureSet>();

function seededRand(seed: number): () => number {
  let s = seed | 0 || 7919;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : n | 0;
}

function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
}

function makeTileableNoise(size: number, seed: number, cellPx: number): Float32Array {
  const rand = seededRand(seed);
  const g = Math.max(4, Math.ceil(size / cellPx));
  const grid = new Float32Array(g * g);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();

  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const gy = (y / size) * g;
    const y0 = Math.floor(gy) % g;
    const y1 = (y0 + 1) % g;
    const fy = gy - Math.floor(gy);
    const sy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * g;
      const x0 = Math.floor(gx) % g;
      const x1 = (x0 + 1) % g;
      const fx = gx - Math.floor(gx);
      const sx = fx * fx * (3 - 2 * fx);
      const top = grid[y0 * g + x0] + (grid[y0 * g + x1] - grid[y0 * g + x0]) * sx;
      const bot = grid[y1 * g + x0] + (grid[y1 * g + x1] - grid[y1 * g + x0]) * sx;
      out[y * size + x] = top + (bot - top) * sy;
    }
  }
  return out;
}

interface VoronoiData {
  distEdge: Float32Array;
  cellId: Uint16Array;
  tiltX: Float32Array;
  tiltY: Float32Array;
}

function makeTileableVoronoi(size: number, gridCells: number, seed: number): VoronoiData {
  const rand = seededRand(seed);
  const total = gridCells * gridCells;
  const px = new Float32Array(total);
  const py = new Float32Array(total);
  const tiltX = new Float32Array(total);
  const tiltY = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    px[i] = 0.15 + rand() * 0.7;
    py[i] = 0.15 + rand() * 0.7;
    tiltX[i] = (rand() - 0.5) * 2.0;
    tiltY[i] = (rand() - 0.5) * 2.0;
  }

  const distEdge = new Float32Array(size * size);
  const cellId = new Uint16Array(size * size);

  for (let y = 0; y < size; y++) {
    const gy = (y / size) * gridCells;
    const cy = Math.floor(gy);
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * gridCells;
      const cx = Math.floor(gx);
      let d1 = 99;
      let d2 = 99;
      let bestId = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = (cx + ox + gridCells) % gridCells;
          const ny = (cy + oy + gridCells) % gridCells;
          const id = ny * gridCells + nx;
          const fx = cx + ox + px[id];
          const fy = cy + oy + py[id];
          const d = Math.hypot(fx - gx, fy - gy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            bestId = id;
          } else if (d < d2) {
            d2 = d;
          }
        }
      }
      const idx = y * size + x;
      distEdge[idx] = d2 - d1;
      cellId[idx] = bestId;
    }
  }
  return { distEdge, cellId, tiltX, tiltY };
}

function buildNormalFromHeight(height: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1.0;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const p = (y * size + x) * 4;
      img.data[p] = clampByte((nx * 0.5 + 0.5) * 255);
      img.data[p + 1] = clampByte((ny * 0.5 + 0.5) * 255);
      img.data[p + 2] = clampByte((nz * 0.5 + 0.5) * 255);
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function getCamoMaterialSpec(pattern: CamoPatternId): CamoMaterialSpec {
  switch (pattern) {
    case 'gold':
      return { metalness: 0.94, roughness: 0.24, clearcoat: 0.45, clearcoatRoughness: 0.14, normalScale: 0.72, envMapIntensity: 1.4, shaderAnimated: true };
    case 'diamond':
      return { metalness: 0.92, roughness: 0.18, clearcoat: 0.95, clearcoatRoughness: 0.05, normalScale: 1.0, envMapIntensity: 1.6, shaderAnimated: true };
    case 'platinum':
      return { metalness: 0.96, roughness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.12, normalScale: 0.45, envMapIntensity: 1.45, shaderAnimated: false };
    case 'damascus':
      return { metalness: 0.86, roughness: 0.28, clearcoat: 0.38, clearcoatRoughness: 0.18, normalScale: 0.6, envMapIntensity: 1.3, shaderAnimated: false };
    case 'obsidian':
      return { metalness: 0.35, roughness: 0.18, clearcoat: 0.9, clearcoatRoughness: 0.08, normalScale: 0.95, envMapIntensity: 1.45, shaderAnimated: false };
    case 'bloodthirsty':
      return { metalness: 0.08, roughness: 0.75, clearcoat: 0.35, clearcoatRoughness: 0.12, normalScale: 0.55, envMapIntensity: 1.0, shaderAnimated: false };
    case 'nuketown':
      return { metalness: 0.32, roughness: 0.5, clearcoat: 0.22, clearcoatRoughness: 0.3, normalScale: 0.65, envMapIntensity: 1.05, shaderAnimated: false };
    case 'red_tiger':
    case 'tiger_stripe':
      return { metalness: 0.4, roughness: 0.44, clearcoat: 0.18, clearcoatRoughness: 0.28, normalScale: 0.5, envMapIntensity: 1.1, shaderAnimated: false };
    case 'crimson_circuit':
      return { metalness: 0.48, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.2, normalScale: 0.7, envMapIntensity: 1.15, shaderAnimated: false };
    case 'snake_skin':
      return { metalness: 0.12, roughness: 0.58, clearcoat: 0.22, clearcoatRoughness: 0.32, normalScale: 0.9, envMapIntensity: 0.95, shaderAnimated: false };
    case 'ghillie':
      return { metalness: 0.04, roughness: 0.9, clearcoat: 0.0, clearcoatRoughness: 0.8, normalScale: 0.85, envMapIntensity: 0.75, shaderAnimated: false };
    case 'polyatomic':
    case 'ice':
      return { metalness: 0.74, roughness: 0.22, clearcoat: 0.85, clearcoatRoughness: 0.08, normalScale: 0.9, envMapIntensity: 1.35, shaderAnimated: true };
    case 'radiant':
      return { metalness: 0.84, roughness: 0.2, clearcoat: 0.85, clearcoatRoughness: 0.08, normalScale: 0.4, envMapIntensity: 1.4, shaderAnimated: true };
    default:
      // interstellar, dark_matter, dark_aether, atomic, virus
      return { metalness: 0.68, roughness: 0.26, clearcoat: 0.72, clearcoatRoughness: 0.12, normalScale: 0.65, envMapIntensity: 1.25, shaderAnimated: true };
  }
}

export function getCamoTextureSet(pattern: CamoPatternId): CamoTextureSet {
  const existing = camoTexCache.get(pattern);
  if (existing) return existing;

  const size = 512;
  const seed = pattern.split('').reduce((a, c, i) => a + c.charCodeAt(0) * (i + 11), 307);
  const nLow = makeTileableNoise(size, seed * 3, 72);
  const nMid = makeTileableNoise(size, seed * 7, 22);
  const nFine = makeTileableNoise(size, seed * 13, 4);
  const rand = seededRand(seed * 23);

  const needsVoronoi = pattern === 'obsidian' || pattern === 'polyatomic' || pattern === 'ice';
  const vor = needsVoronoi ? makeTileableVoronoi(size, pattern === 'obsidian' ? 12 : 9, seed * 17) : null;

  const cCanvas = document.createElement('canvas');
  const rCanvas = document.createElement('canvas');
  cCanvas.width = rCanvas.width = size;
  cCanvas.height = rCanvas.height = size;
  const cCtx = cCanvas.getContext('2d')!;
  const rCtx = rCanvas.getContext('2d')!;
  const cImg = cCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const height = new Float32Array(size * size);

  let normalStrength = 2.6;

  for (let y = 0; y < size; y++) {
    const ny = y / size;
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const idx = y * size + x;
      const fbm = nLow[idx] * 0.5 + nMid[idx] * 0.34 + nFine[idx] * 0.16;

      let rgb: [number, number, number] = [200, 200, 200];
      let h = fbm * 0.5;
      let rough = 128;

      if (pattern === 'gold') {
        // Forged 24K liquid-etched gold contours over dark recesses
        const warp = Math.sin((nx * 6 + ny * 3 + fbm * 2.2) * Math.PI * 2);
        const ridge = Math.abs(warp);
        const groove = ridge < 0.2 ? 1 - ridge / 0.2 : 0;
        const goldBright: [number, number, number] = [242, 198, 72];
        const goldDeep: [number, number, number] = [165, 118, 22];
        const crevice: [number, number, number] = [28, 22, 14];
        rgb = lerpRgb(goldDeep, goldBright, fbm);
        rgb = lerpRgb(rgb, crevice, groove * 0.92);
        h = 0.72 - groove * 0.65 + (nFine[idx] - 0.5) * 0.08;
        rough = groove > 0.2 ? 185 : 42 + (1 - fbm) * 38;
        normalStrength = 3.2;
      } else if (pattern === 'diamond') {
        // Staggered rows of 8-facet diamond studs on brushed platinum backing
        const cell = 24;
        const row = Math.floor(y / cell);
        const gx = ((x + (row % 2 === 1 ? cell * 0.5 : 0)) % cell) / cell - 0.5;
        const gy = (y % cell) / cell - 0.5;
        const md = Math.abs(gx) + Math.abs(gy);
        const cd = Math.max(Math.abs(gx), Math.abs(gy));
        const bevel = Math.min(1, Math.max(md * 1.15, cd * 1.45));
        if (bevel < 0.58) {
          const table = bevel < 0.22;
          const sparkleTint = ((x * 7 + y * 13) % 5) * 8;
          rgb = table ? [246, 249, 255] : [206 + sparkleTint, 214 + sparkleTint, 226];
          h = 0.92 - bevel * 0.9;
          rough = table ? 14 : 26;
        } else {
          rgb = [68, 74, 86];
          h = 0.14 + (nFine[idx] - 0.5) * 0.08;
          rough = 155;
        }
        normalStrength = 4.6;
      } else if (pattern === 'platinum') {
        const wave = Math.sin((nx * 4 - ny * 2 + fbm * 1.8) * Math.PI * 2) * 0.5 + 0.5;
        const brush = (nMid[y * size + ((x >> 3) % size)] - 0.5) * 26;
        rgb = lerpRgb([165, 174, 188], [238, 243, 250], wave * 0.7 + fbm * 0.3);
        rgb = [rgb[0] + brush, rgb[1] + brush, rgb[2] + brush];
        h = 0.5 + wave * 0.15 + brush / 110;
        rough = 36 + (1 - wave) * 34;
        normalStrength = 1.9;
      } else if (pattern === 'damascus') {
        // Layered cobalt/indigo steel contours with crisp crimson-orange topographic ribbons
        const u = nx * 5 + nLow[idx] * 2.4 + nMid[idx] * 0.7;
        const v = ny * 5 + nLow[((y + 180) % size) * size + ((x + 90) % size)] * 2.4;
        const band = Math.sin((u + v * 0.8) * Math.PI * 2.2) * 0.5 + 0.5;
        const bandFine = Math.sin((u * 2.1 - v * 1.7) * Math.PI * 4.5) * 0.5 + 0.5;
        if (bandFine > 0.87) {
          rgb = lerpRgb([210, 46, 36], [250, 128, 48], (bandFine - 0.87) / 0.13);
        } else {
          rgb = lerpRgb([14, 34, 88], [56, 146, 240], Math.pow(band, 0.85));
        }
        h = 0.4 + bandFine * 0.35 + band * 0.18;
        rough = bandFine > 0.87 ? 52 : 68 + (1 - band) * 44;
        normalStrength = 2.9;
      } else if (pattern === 'obsidian' && vor) {
        const cid = vor.cellId[idx];
        const edge = Math.min(1, vor.distEdge[idx] / 0.08);
        const slope = ((nx - 0.5) * vor.tiltX[cid] + (ny - 0.5) * vor.tiltY[cid]) * 0.4;
        const shade = 18 + (vor.tiltX[cid] * 0.5 + 0.5) * 26;
        rgb = [shade, shade + 2, shade + 7];
        h = 0.45 + slope + edge * 0.3;
        rough = edge < 0.15 ? 95 : 24 + (nFine[idx] * 26);
        normalStrength = 4.4;
      } else if (pattern === 'red_tiger' || pattern === 'tiger_stripe') {
        const diag = nx * 4.2 + ny * 3.1 + (nLow[idx] - 0.5) * 1.1 + (nMid[idx] - 0.5) * 0.32;
        const s = Math.sin(diag * Math.PI * 2);
        const edgeWear = (nFine[idx] - 0.5) * 22;
        if (pattern === 'red_tiger') {
          rgb = s > 0.14 ? lerpRgb([135, 16, 18], [228, 38, 42], nMid[idx]) : [19, 21, 26];
        } else {
          rgb = s > 0.2 ? lerpRgb([155, 114, 42], [222, 182, 92], nMid[idx]) : s > -0.1 ? [86, 70, 44] : [18, 20, 24];
        }
        rgb = [rgb[0] + edgeWear, rgb[1] + edgeWear, rgb[2] + edgeWear];
        h = 0.5 + (s > 0.14 ? 0.12 : -0.1) + (nFine[idx] - 0.5) * 0.15;
        rough = s > 0.14 ? 95 : 138;
        normalStrength = 2.0;
      } else if (pattern === 'nuketown') {
        const slant = nx * 2.0 - ny * 1.4 + (nLow[idx] - 0.5) * 0.12;
        const bandPos = slant - Math.floor(slant);
        const chip = fbm > 0.74;
        if (chip) {
          rgb = [44, 48, 56]; // chipped paint steel
          h = 0.24;
          rough = 105;
        } else {
          if (bandPos < 0.46) rgb = [24, 178, 198]; // Retro turquoise
          else if (bandPos < 0.53) rgb = [242, 232, 208]; // Cream pinstripe
          else if (bandPos < 0.93) rgb = [218, 72, 36]; // Atomic orange
          else rgb = [242, 232, 208];
          const grime = (nMid[idx] - 0.5) * 24;
          rgb = [rgb[0] + grime, rgb[1] + grime, rgb[2] + grime];
          h = 0.62 + (nFine[idx] - 0.5) * 0.12;
          rough = 132 + (nMid[idx] - 0.5) * 35;
        }
        normalStrength = 2.7;
      } else if (pattern === 'crimson_circuit') {
        const weave = ((x >> 2) + (y >> 2)) % 2 === 0 ? 8 : -8;
        const trace = Math.abs(Math.sin((nx * 6 + ny * 3 + nLow[idx] * 0.9) * Math.PI * 2));
        const isLine = trace < 0.095 || Math.abs(Math.sin((nx * 3 - ny * 6) * Math.PI * 2)) < 0.075;
        if (isLine) {
          rgb = [228, 32, 48];
          h = 0.78;
          rough = 62;
        } else {
          rgb = [24 + weave, 26 + weave, 32 + weave];
          h = 0.42 + weave / 60;
          rough = 152;
        }
        normalStrength = 2.8;
      } else if (pattern === 'bloodthirsty') {
        const splat = fbm * 0.55 + Math.sin(nx * 19 + nLow[idx] * 5) * 0.22 + Math.cos(ny * 17 + nMid[idx] * 4) * 0.23;
        const isBlood = splat > 0.68 || (nMid[idx] > 0.72 && nFine[idx] > 0.6);
        if (isBlood) {
          const depth = Math.min(1, Math.max(0, (splat - 0.64) * 3));
          rgb = lerpRgb([165, 18, 22], [95, 8, 12], depth);
          h = 0.72;
          rough = 26; // Glossy wet crimson over matte chalk!
        } else {
          rgb = lerpRgb([204, 212, 222], [234, 240, 246], nMid[idx]);
          h = 0.46 + (nFine[idx] - 0.5) * 0.12;
          rough = 198;
        }
        normalStrength = 2.4;
      } else if (pattern === 'snake_skin') {
        const colW = 28;
        const rowH = 18;
        const row = Math.floor(y / rowH);
        const sx = ((x + (row % 2 === 1 ? colW * 0.5 : 0)) % colW) / colW - 0.5;
        const sy = (y % rowH) / rowH - 0.5;
        const d = Math.abs(sx) * 1.15 + Math.abs(sy) * 1.15;
        if (d < 0.68) {
          const dome = 1 - d / 0.68;
          const checker = (Math.floor((x + y) / colW) % 2) * 0.25;
          rgb = lerpRgb([96, 86, 66], [198, 180, 142], dome * 0.75 + checker);
          h = 0.35 + Math.pow(dome, 0.7) * 0.6;
          rough = 128 + (1 - dome) * 60;
        } else {
          rgb = [28, 25, 21];
          h = 0.1;
          rough = 210;
        }
        normalStrength = 4.2;
      } else if (pattern === 'ghillie') {
        const fiber = Math.sin(x * 0.38 + y * 0.22 + nMid[idx] * 6) * 0.5 + 0.5;
        const olive: [number, number, number] = [66, 82, 42];
        const khaki: [number, number, number] = [132, 124, 78];
        const bark: [number, number, number] = [44, 38, 28];
        rgb = fiber > 0.58 ? lerpRgb(olive, khaki, (fiber - 0.58) / 0.42) : lerpRgb(bark, olive, fiber / 0.58);
        h = fiber * 0.65 + nFine[idx] * 0.35;
        rough = 225 + (nFine[idx] - 0.5) * 24;
        normalStrength = 3.5;
      } else if ((pattern === 'polyatomic' || pattern === 'ice') && vor) {
        // Faceted crystalline normals + base map for GPU shader enhancement
        const cid = vor.cellId[idx];
        const edge = Math.min(1, vor.distEdge[idx] / 0.075);
        const slope = ((nx - 0.5) * vor.tiltX[cid] + (ny - 0.5) * vor.tiltY[cid]) * 0.32;
        rgb = pattern === 'ice' ? [125, 195, 240] : [135, 95, 225];
        h = 0.45 + slope + edge * 0.28;
        rough = edge < 0.16 ? 78 : 28;
        normalStrength = 3.8;
      } else {
        // Animated cosmic/plasma/virus camos: smooth metallic dark-neutral substrate + subtle micro-relief
        rgb = [195, 195, 210];
        h = 0.5 + (nMid[idx] - 0.5) * 0.22 + (nFine[idx] - 0.5) * 0.1;
        rough = pattern === 'radiant' ? 48 : 68 + (fbm - 0.5) * 40;
        normalStrength = 2.0;
      }

      const p = idx * 4;
      cImg.data[p] = clampByte(rgb[0]);
      cImg.data[p + 1] = clampByte(rgb[1]);
      cImg.data[p + 2] = clampByte(rgb[2]);
      cImg.data[p + 3] = 255;

      const rv = clampByte(rough);
      rImg.data[p] = rImg.data[p + 1] = rImg.data[p + 2] = rv;
      rImg.data[p + 3] = 255;
      height[idx] = h;
    }
  }

  cCtx.putImageData(cImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  // Additional fine organic vector wisps on Bloodthirsty & Ghillie
  if (pattern === 'bloodthirsty') {
    for (let i = 0; i < 42; i++) {
      const bx = rand() * size;
      const by = rand() * size;
      const rad = 3 + rand() * 14;
      cCtx.fillStyle = rand() > 0.4 ? 'rgba(135,12,16,0.88)' : 'rgba(185,24,28,0.78)';
      rCtx.fillStyle = 'rgb(22,22,22)';
      cCtx.beginPath();
      cCtx.arc(bx, by, rad, 0, Math.PI * 2);
      cCtx.fill();
      rCtx.beginPath();
      rCtx.arc(bx, by, rad, 0, Math.PI * 2);
      rCtx.fill();
    }
  } else if (pattern === 'ghillie') {
    for (let i = 0; i < 160; i++) {
      const x1 = rand() * size;
      const y1 = rand() * size;
      const ang = rand() * Math.PI * 2;
      const len = 18 + rand() * 34;
      cCtx.strokeStyle = rand() > 0.5 ? 'rgba(130,126,74,0.62)' : 'rgba(54,68,34,0.7)';
      cCtx.lineWidth = 1.6 + rand() * 2.2;
      cCtx.beginPath();
      cCtx.moveTo(x1, y1);
      cCtx.lineTo(x1 + Math.cos(ang) * len, y1 + Math.sin(ang) * len);
      cCtx.stroke();
    }
  }

  const nCanvas = buildNormalFromHeight(height, size, normalStrength);

  const toTex = (canvas: HTMLCanvasElement, isColor: boolean) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return tex;
  };

  const set: CamoTextureSet = {
    map: toTex(cCanvas, true),
    normalMap: toTex(nCanvas, false),
    roughnessMap: toTex(rCanvas, false),
  };
  camoTexCache.set(pattern, set);
  return set;
}

/**
 * Returns a cached camo texture set configured to sample UV channel 0 (`uv`) or channel 1 (`uv1`).
 * Channel 1 enables seamless triplanar camos on external GLB weapons via `uv1` while preserving
 * the model's baked atlas `aoMap`, `normalMap`, and `emissiveMap` on channel 0 (`uv`).
 */
export function getCamoTextureSetForChannel(pattern: CamoPatternId, channel: 0 | 1): CamoTextureSet {
  const base = getCamoTextureSet(pattern);
  if (channel === 0) return base;

  const cached = camoTexChannel1Cache.get(pattern);
  if (cached) return cached;

  const cloneForUv1 = (src: THREE.CanvasTexture): THREE.CanvasTexture => {
    const tex = src.clone();
    tex.wrapS = src.wrapS;
    tex.wrapT = src.wrapT;
    tex.anisotropy = src.anisotropy;
    tex.colorSpace = src.colorSpace;
    tex.channel = 1;
    tex.needsUpdate = true;
    return tex;
  };

  const set: CamoTextureSet = {
    map: cloneForUv1(base.map),
    normalMap: cloneForUv1(base.normalMap),
    roughnessMap: cloneForUv1(base.roughnessMap),
  };
  camoTexChannel1Cache.set(pattern, set);
  return set;
}

const GLSL_NOISE_LIB = `
uniform float uCamoTime;

float cm_hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

vec2 cm_hash22(vec2 p) {
  vec3 a = fract(p.xyx * vec3(123.34, 234.34, 345.65));
  a += dot(a, a + 34.45);
  return fract(vec2(a.x * a.y, a.y * a.z));
}

float cm_noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = cm_hash21(i);
  float b = cm_hash21(i + vec2(1.0, 0.0));
  float c = cm_hash21(i + vec2(0.0, 1.0));
  float d = cm_hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float cm_fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * cm_noise(p);
    p = p * 2.04 + vec2(13.1, 7.7);
    amp *= 0.5;
  }
  return v;
}

vec3 cm_voronoi(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float md = 8.0;
  float sd = 8.0;
  float cellRand = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = cm_hash22(n + g);
      vec2 r = g + 0.15 + 0.7 * o - f;
      float d = dot(r, r);
      if (d < md) {
        sd = md;
        md = d;
        cellRand = cm_hash21(n + g);
      } else if (d < sd) {
        sd = d;
      }
    }
  }
  return vec3(sqrt(md), sqrt(sd) - sqrt(md), cellRand);
}
`;

function getPatternShaderBody(pattern: CamoPatternId): string {
  switch (pattern) {
    case 'interstellar':
      return `
        vec2 uv = vMapUv * 2.6;
        float t = uCamoTime * 0.22;
        float n1 = cm_fbm(uv * 1.4 + vec2(t, -t * 0.6));
        float n2 = cm_fbm(uv * 2.3 + vec2(-t * 0.8 + n1 * 1.5, t * 0.5));
        float ribbon = smoothstep(0.32, 0.78, n2);
        vec3 deepVoid = vec3(0.012, 0.014, 0.045);
        vec3 violet = vec3(0.24, 0.05, 0.56);
        vec3 cyan = vec3(0.03, 0.42, 0.72);
        vec3 pink = vec3(0.55, 0.08, 0.45);
        vec3 neb = mix(deepVoid, mix(violet, cyan, smoothstep(0.25, 0.75, n1)), ribbon);
        neb = mix(neb, pink, smoothstep(0.62, 0.92, n2 * n1 * 1.8) * 0.75);
        // Drifting twinkling starfield across two depth layers
        vec2 g1 = fract(vMapUv * 18.0 + vec2(t * 0.15, 0.0)) - 0.5;
        vec2 id1 = floor(vMapUv * 18.0 + vec2(t * 0.15, 0.0));
        float r1 = cm_hash21(id1);
        float star1 = step(0.84, r1) * smoothstep(0.24, 0.02, length(g1)) * (0.45 + 0.55 * sin(uCamoTime * 4.5 + r1 * 40.0));
        vec2 g2 = fract(vMapUv * 32.0 - vec2(t * 0.08, t * 0.06)) - 0.5;
        vec2 id2 = floor(vMapUv * 32.0 - vec2(t * 0.08, t * 0.06));
        float r2 = cm_hash21(id2);
        float star2 = step(0.88, r2) * smoothstep(0.22, 0.02, length(g2)) * (0.5 + 0.5 * cos(uCamoTime * 5.2 + r2 * 25.0));
        vec3 stars = vec3(0.55, 0.85, 1.0) * star1 * 1.3 + vec3(1.0) * star2 * 1.5;
        diffuseColor.rgb = neb;
        cm_glow = neb * 0.48 + stars;
      `;
    case 'dark_matter':
      return `
        vec2 uv = vMapUv * 3.0;
        float t = uCamoTime * 0.35;
        float q = cm_fbm(uv + vec2(t * 0.4, -t * 0.3));
        float w = cm_fbm(uv * 1.8 + q * 2.2 + vec2(-t * 0.5, t * 0.25));
        // Crackling inverted plasma veins
        float vein = 1.0 - abs(cm_fbm(uv * 2.5 + vec2(w * 2.1, -q * 1.6)) - 0.5) * 2.0;
        float arc = pow(clamp(vein, 0.0, 1.0), 4.2);
        float surge = smoothstep(0.45, 0.9, w) * 0.45;
        vec3 baseVoid = vec3(0.015, 0.008, 0.032);
        vec3 purpleArc = vec3(0.42, 0.04, 0.88);
        vec3 hotCore = vec3(0.95, 0.38, 1.0);
        vec3 glowCol = mix(purpleArc, hotCore, smoothstep(0.55, 0.95, arc));
        diffuseColor.rgb = baseVoid + purpleArc * surge * 0.4 + glowCol * arc;
        cm_glow = purpleArc * surge * 0.28 + glowCol * arc * 1.45;
      `;
    case 'dark_aether':
      return `
        vec2 uv = vMapUv * 2.8;
        float t = uCamoTime * 0.3;
        float n1 = cm_fbm(uv + vec2(t * 0.45, sin(t) * 0.25));
        float n2 = cm_fbm(uv * 1.9 + vec2(n1 * 2.4 - t * 0.35, -n1 * 1.4 + t * 0.2));
        float swirl = smoothstep(0.28, 0.82, n2);
        float core = pow(smoothstep(0.55, 0.92, n2), 2.5);
        vec3 aetherDark = vec3(0.025, 0.008, 0.055);
        vec3 aetherMid = vec3(0.38, 0.05, 0.76);
        vec3 aetherBright = vec3(0.82, 0.34, 1.0);
        vec3 col = mix(aetherDark, aetherMid, swirl);
        col = mix(col, aetherBright, core);
        diffuseColor.rgb = col;
        cm_glow = aetherMid * swirl * 0.55 + aetherBright * core * 0.95;
      `;
    case 'radiant':
      return `
        vec2 uv = vMapUv * 2.2;
        float t = uCamoTime * 0.48;
        float flow = cm_fbm(uv * 1.5 + vec2(t * 0.4, -t * 0.25));
        float phase = (uv.x * 1.6 - uv.y * 1.1) + flow * 3.4 + t * 0.85;
        vec3 prism = 0.5 + 0.5 * cos(phase + vec3(0.0, 2.094, 4.188));
        vec3 deep = vec3(0.04, 0.03, 0.08);
        vec3 vibrant = pow(prism, vec3(1.55));
        vec3 col = mix(deep, vibrant, 0.38 + 0.55 * flow);
        diffuseColor.rgb = col;
        cm_glow = vibrant * (0.28 + 0.32 * smoothstep(0.45, 0.9, flow));
      `;
    case 'polyatomic':
      return `
        vec3 vr = cm_voronoi(vMapUv * 9.0);
        float pulse = 0.5 + 0.5 * sin(uCamoTime * 2.4 + vr.z * 16.0);
        float edge = 1.0 - smoothstep(0.02, 0.14, vr.y);
        vec3 shardDark = vec3(0.04, 0.015, 0.11);
        vec3 shardMid = vec3(0.28, 0.05, 0.65);
        vec3 shardBright = vec3(0.68, 0.24, 0.98);
        vec3 facetCol = mix(shardDark, shardMid, 0.35 + 0.65 * pulse * vr.z);
        facetCol = mix(facetCol, shardBright, edge * 0.85);
        diffuseColor.rgb = facetCol;
        cm_glow = mix(shardMid * pulse * 0.35, shardBright * 1.15, edge);
      `;
    case 'atomic':
      return `
        vec2 uv = vMapUv * 3.2;
        float t = uCamoTime * 0.42;
        float q = cm_fbm(uv + vec2(-t * 0.3, t * 0.45));
        float boil = cm_fbm(uv * 2.2 + vec2(q * 2.0, -t * 0.6));
        float hot = smoothstep(0.45, 0.86, boil);
        vec3 darkPlate = vec3(0.02, 0.04, 0.02);
        vec3 acidGreen = vec3(0.08, 0.58, 0.04);
        vec3 toxicLime = vec3(0.48, 0.96, 0.08);
        vec3 col = mix(darkPlate, acidGreen, smoothstep(0.28, 0.65, boil));
        col = mix(col, toxicLime, pow(hot, 2.2));
        diffuseColor.rgb = col;
        cm_glow = acidGreen * hot * 0.55 + toxicLime * pow(hot, 2.5) * 1.05;
      `;
    case 'virus':
      return `
        vec2 uv = vMapUv * 4.5;
        float wave = 0.5 + 0.5 * sin(vMapUv.x * 8.0 - uCamoTime * 3.4 + cm_noise(uv) * 2.5);
        float c1 = 1.0 - abs(cm_fbm(uv * 2.2 + vec2(uCamoTime * 0.12, 0.0)) - 0.5) * 2.0;
        float fracture = pow(clamp(c1, 0.0, 1.0), 5.0);
        vec3 stealth = vec3(0.022, 0.026, 0.024);
        vec3 matrixGreen = vec3(0.12, 0.88, 0.24);
        float active = fracture * (0.45 + 0.75 * wave);
        diffuseColor.rgb = stealth + matrixGreen * active * 0.9;
        cm_glow = matrixGreen * active * 1.25;
      `;
    case 'ice':
      return `
        vec3 vr = cm_voronoi(vMapUv * 7.5);
        float frostEdge = 1.0 - smoothstep(0.02, 0.16, vr.y);
        float caustic = smoothstep(0.52, 0.88, cm_fbm(vMapUv * 5.0 + vec2(uCamoTime * 0.25, -uCamoTime * 0.18)));
        vec3 deepIce = vec3(0.015, 0.11, 0.28);
        vec3 glacierBlue = vec3(0.06, 0.42, 0.78);
        vec3 frostWhite = vec3(0.75, 0.92, 1.0);
        vec3 col = mix(deepIce, glacierBlue, vr.z * 0.7 + caustic * 0.35);
        col = mix(col, frostWhite, frostEdge * 0.8 + caustic * 0.25);
        diffuseColor.rgb = col;
        cm_glow = mix(glacierBlue * caustic * 0.35, frostWhite * 0.55, frostEdge * 0.6);
      `;
    case 'diamond':
      return `
        vec2 cid = floor(vMapUv * 36.0);
        float rnd = cm_hash21(cid);
        float tw = pow(max(0.0, sin(uCamoTime * 5.4 + rnd * 42.0)), 16.0);
        float isGlint = step(0.83, rnd) * tw * step(0.45, diffuseColor.r);
        vec3 glintCol = mix(vec3(0.85, 0.96, 1.0), vec3(1.0, 0.92, 0.75), fract(rnd * 9.3));
        cm_glow = glintCol * isGlint * 1.15;
      `;
    case 'gold':
      return `
        float sweep = pow(max(0.0, sin(vMapUv.x * 7.0 - vMapUv.y * 4.0 - uCamoTime * 1.8)), 10.0);
        float isGoldPlate = smoothstep(0.15, 0.45, diffuseColor.r);
        cm_glow = vec3(0.95, 0.76, 0.22) * sweep * isGoldPlate * 0.42;
      `;
    default:
      return '';
  }
}

export function applyCamoShader(mat: THREE.MeshPhysicalMaterial, pattern: CamoPatternId): void {
  const spec = getCamoMaterialSpec(pattern);
  if (!spec.shaderAnimated) return;

  const snippet = getPatternShaderBody(pattern);
  if (!snippet) return;

  mat.customProgramCacheKey = () => `cod_camo_${pattern}_v1`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCamoTime = CAMO_TIME_UNIFORM;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE_LIB}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>\nvec3 cm_glow = vec3(0.0);\n{\n${snippet}\n}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += cm_glow;`,
      );
  };
}
