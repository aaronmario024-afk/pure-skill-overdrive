import * as THREE from 'three';
import { ModeId } from '../data/modes';
import {
  getTextureAnisotropy,
  getTextureResolution,
  TextureQuality,
} from './graphicsSettings';

export type PBRSurfaceKind =
  | 'concrete'
  | 'asphalt'
  | 'sandstone'
  | 'ice'
  | 'cyber'
  | 'plywood'
  | 'crate'
  | 'gunmetal'
  | 'kevlar'
  | 'snow'
  | 'brick'
  | 'painted_metal'
  | 'stone'
  | 'plaster'
  | 'tile'
  | 'dirt'
  | 'rubber'
  | 'fabric'
  | 'glass';

export interface PBRSurfaceMaps {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

const pbrCache = new Map<string, PBRSurfaceMaps>();
let currentTexQuality: TextureQuality = 'high';
let maxAnisotropyCap = 8;

export function getTextureQuality(): TextureQuality {
  return currentTexQuality;
}

export function setTextureQuality(tier: TextureQuality, renderer?: THREE.WebGLRenderer): void {
  if (renderer) {
    maxAnisotropyCap = renderer.capabilities.getMaxAnisotropy();
  }
  if (currentTexQuality === tier) return;
  currentTexQuality = tier;
  // Clear cached surfaces so the next build regenerates at the requested resolution & anisotropy
  clearTextureCache();
}

export function clearTextureCache(): void {
  for (const surf of pbrCache.values()) {
    surf.map.dispose();
    surf.bumpMap.dispose();
    surf.roughnessMap.dispose();
    surf.normalMap.dispose();
  }
  pbrCache.clear();
}

function hash2d(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function tileableNoise(x: number, y: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y0 = ((yi % period) + period) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2d(x0, y0);
  const b = hash2d(x1, y0);
  const c = hash2d(x0, y1);
  const d = hash2d(x1, y1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbmTileable(u: number, v: number, octaves = 4, baseFreq = 6): number {
  let sum = 0;
  let amp = 0.5;
  let freq = baseFreq;
  for (let i = 0; i < octaves; i++) {
    sum += tileableNoise(u * freq, v * freq, freq) * amp;
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
}

function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

function buildNormalFromHeight(
  heightField: Float32Array,
  size: number,
  strength: number,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const sample = (x: number, y: number): number => {
    const wx = ((x % size) + size) % size;
    const wy = ((y % size) + size) % size;
    return heightField[wy * size + wx];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 3x3 Sobel operator for crisp bevels and micro-relief
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const dz = 1.0;
      const invLen = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);

      const idx = (y * size + x) * 4;
      data[idx] = clampByte((-dx * invLen * 0.5 + 0.5) * 255);
      data[idx + 1] = clampByte((-dy * invLen * 0.5 + 0.5) * 255);
      data[idx + 2] = clampByte((dz * invLen * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createPBRSurface(
  kind: PBRSurfaceKind,
  baseColor: string,
  repeatX = 1,
  repeatY = 1,
): PBRSurfaceMaps {
  const tier = currentTexQuality;
  const key = `${tier}:${kind}:${baseColor}:${repeatX}x${repeatY}`;
  const existing = pbrCache.get(key);
  if (existing) return existing;

  // Higher detail on primary architectural surfaces while staying fast
  const targetRes = getTextureResolution(tier);
  const size = targetRes >= 768 ? 512 : targetRes >= 512 ? 384 : 256;
  const anisotropy = Math.min(maxAnisotropyCap, getTextureAnisotropy(tier));

  const colorCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  colorCanvas.width = bumpCanvas.width = roughCanvas.width = size;
  colorCanvas.height = bumpCanvas.height = roughCanvas.height = size;

  const cCtx = colorCanvas.getContext('2d')!;
  const bCtx = bumpCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;

  const cImg = cCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const heightField = new Float32Array(size * size);

  const [br, bg, bb] = hexToRgb(baseColor);

  for (let py = 0; py < size; py++) {
    const v = py / size;
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const idx = (py * size + px) * 4;
      const fine = hash2d(px, py) - 0.5;
      const fbm = fbmTileable(u, v, 4, 6);
      const fbmDetail = fbmTileable(u, v, 3, 18);

      let delta = 0;
      let height = 128;
      let rough = 200;
      let tr = br;
      let tg = bg;
      let tb = bb;

      if (kind === 'concrete' || kind === 'stone') {
        const coarse = fbmTileable(u, v, 4, 4);
        delta = (fbm - 0.5) * 32 + (fbmDetail - 0.5) * 14 + fine * 9;
        height = 128 + (fbm - 0.5) * 60 + (fbmDetail - 0.5) * 28 + fine * 16;
        rough = kind === 'stone' ? 205 + (fbm - 0.5) * 40 : 196 + (fbm - 0.5) * 48;

        // Expansion joint seams + weathered crevice darkening
        const seamDistX = Math.min(Math.abs(u - 0.5), Math.min(u, 1 - u));
        const seamDistY = Math.min(Math.abs(v - 0.5), Math.min(v, 1 - v));
        if (seamDistX < 0.008 || seamDistY < 0.008) {
          delta -= 24;
          height -= 48;
          rough = 240;
        } else if (seamDistX < 0.022 || seamDistY < 0.022) {
          delta -= 7;
          height -= 10;
        }
        // Subtle formwork tie holes
        const tieDist = Math.hypot(((u * 2) % 1) - 0.5, ((v * 2) % 1) - 0.5);
        if (tieDist < 0.032) {
          delta -= 18;
          height -= 36;
        }
        // Damp stain patches
        if (coarse < 0.34) {
          delta -= 10;
          rough -= 22;
        }
      } else if (kind === 'asphalt' || kind === 'dirt') {
        const speck = hash2d(px * 1.7, py * 1.7);
        const macro = fbmTileable(u, v, 4, 5);
        delta = (macro - 0.5) * 26 + (speck - 0.5) * 28;
        height = 124 + (macro - 0.5) * 52 + (speck > 0.87 ? 38 : speck < 0.14 ? -28 : fine * 20);
        rough = kind === 'dirt' ? 236 - (macro - 0.5) * 20 : 212 - (macro - 0.5) * 34;
        if (kind === 'asphalt' && fbm < 0.31) {
          // Subtle tyre wear / oil sheen pockets
          rough = 135;
          delta -= 8;
        }
      } else if (kind === 'sandstone' || kind === 'plaster') {
        const strata = Math.sin(v * Math.PI * 12 + fbm * 4.5) * 0.5;
        delta = strata * 16 + (fbm - 0.5) * 24 + fine * 8;
        height = 128 + strata * 26 + (fbm - 0.5) * 42 + (fbmDetail - 0.5) * 20;
        rough = kind === 'plaster' ? 214 + (fbm - 0.5) * 26 : 222 + (fbm - 0.5) * 30;
        if (kind === 'sandstone') {
          const joint = Math.abs(((v * 4) % 1) - 0.5) > 0.485;
          if (joint) {
            delta -= 18;
            height -= 34;
          }
        }
      } else if (kind === 'brick') {
        const rows = 8;
        const cols = 4;
        const row = Math.floor(v * rows);
        const offset = (row % 2) * 0.5;
        const cu = (u * cols + offset) % 1;
        const cv = (v * rows) % 1;
        const mortar = cu < 0.055 || cu > 0.945 || cv < 0.095 || cv > 0.905;
        const brickTint = hash2d(Math.floor(u * cols + offset), row);
        if (mortar) {
          tr = Math.max(25, br * 0.68);
          tg = Math.max(25, bg * 0.68);
          tb = Math.max(25, bb * 0.68);
          delta = (fbm - 0.5) * 14 + fine * 10;
          height = 82 + fine * 14;
          rough = 244;
        } else {
          // Slight bevel darkening near brick edge
          const edge = Math.min(Math.min(cu - 0.055, 0.945 - cu), Math.min(cv - 0.095, 0.905 - cv));
          const bevel = edge < 0.04 ? (edge / 0.04) * 18 - 18 : 0;
          delta = (brickTint - 0.5) * 32 + (fbm - 0.5) * 20 + bevel + fine * 8;
          height = 148 + (brickTint - 0.5) * 22 + (fbm - 0.5) * 26 + bevel;
          rough = 200 + (brickTint - 0.5) * 26;
        }
      } else if (kind === 'tile') {
        const g = 6;
        const cu = (u * g) % 1;
        const cv = (v * g) % 1;
        const grout = cu < 0.045 || cv < 0.045;
        const tileVar = hash2d(Math.floor(u * g), Math.floor(v * g));
        if (grout) {
          delta = -30 + fine * 8;
          height = 92;
          rough = 235;
        } else {
          delta = (tileVar - 0.5) * 18 + (fbmDetail - 0.5) * 10;
          height = 142 + fine * 6;
          rough = 108 + (fbm - 0.5) * 34;
        }
      } else if (kind === 'plywood' || kind === 'crate') {
        const grain = Math.sin(u * 46 + Math.sin(v * 7) * 2.4 + fbm * 3) * 0.5;
        delta = grain * 18 + (fbm - 0.5) * 18 + fine * 6;
        height = 128 + grain * 24 + (fbm - 0.5) * 24;
        rough = 178 + (fbm - 0.5) * 34;
        if (kind === 'crate') {
          const border = u < 0.085 || u > 0.915 || v < 0.085 || v > 0.915;
          const diag = Math.abs(u - v) < 0.055;
          const slatGap = Math.abs(((v * 4) % 1) - 0.5) > 0.475;
          if (border || diag) {
            delta -= 14;
            height += 26;
            rough = 192;
          } else if (slatGap) {
            delta -= 24;
            height -= 36;
          }
          // Corner bolt heads
          const bx = Math.min(u, 1 - u);
          const by = Math.min(v, 1 - v);
          if (Math.hypot(bx - 0.045, by - 0.045) < 0.015) {
            tr = 75;
            tg = 82;
            tb = 92;
            height += 28;
            rough = 95;
          }
        }
      } else if (kind === 'ice' || kind === 'glass') {
        const crack = Math.abs(Math.sin((u * 3 + v * 2 + fbm) * Math.PI * 3));
        const glint = crack < 0.065 ? 28 : 0;
        delta = (fbm - 0.5) * 18 + glint;
        height = 128 + (fbm - 0.5) * 20 - (crack < 0.065 ? 24 : 0);
        rough = kind === 'glass' ? 28 + fbm * 24 : 52 + fbm * 72 + (crack < 0.065 ? 60 : 0);
      } else if (kind === 'snow') {
        const sparkle = hash2d(px * 2.3, py * 3.1) > 0.975 ? 24 : 0;
        const drift = Math.sin(u * Math.PI * 2 + v * Math.PI * 2 + fbm * 3) * 0.5;
        delta = (fbm - 0.5) * 20 + drift * 12 + sparkle;
        height = 128 + (fbm - 0.5) * 46 + drift * 34;
        rough = 192 + (fbm - 0.5) * 44 - (sparkle > 0 ? 70 : 0);
      } else if (kind === 'cyber') {
        const gx = Math.min((u * 6) % 1, 1 - ((u * 6) % 1));
        const gy = Math.min((v * 6) % 1, 1 - ((v * 6) % 1));
        const line = gx < 0.025 || gy < 0.025;
        if (line) {
          tr = Math.min(255, br + 20);
          tg = Math.min(255, bg + 55);
          tb = Math.min(255, bb + 75);
          height = 104;
          rough = 72;
        } else {
          delta = (fbm - 0.5) * 14 + fine * 4;
          height = 136 + (fbm - 0.5) * 14;
          rough = 104 + (fbm - 0.5) * 32;
        }
      } else if (kind === 'gunmetal' || kind === 'painted_metal') {
        const brush = tileableNoise(u * 4, v * 96, 96);
        const panelSeam = u < 0.018 || u > 0.982 || v < 0.018 || v > 0.982;
        delta = (brush - 0.5) * 16 + (fbm - 0.5) * 12 + (panelSeam ? -22 : 0);
        height = 128 + (brush - 0.5) * 24 + (panelSeam ? -34 : 0);
        rough =
          kind === 'painted_metal'
            ? 112 + (fbm - 0.5) * 46 + (brush - 0.5) * 22
            : 84 + (brush - 0.5) * 36 + (fbm - 0.5) * 24;
        // Edge wear along seams for realistic metallic highlight
        if (kind === 'painted_metal' && !panelSeam && (u < 0.032 || u > 0.968 || v < 0.032 || v > 0.968)) {
          delta += 16;
          rough = 68;
        }
      } else if (kind === 'kevlar' || kind === 'fabric') {
        const freq = kind === 'kevlar' ? 28 : 40;
        const wx = Math.floor(u * freq);
        const wy = Math.floor(v * freq);
        const weave = (wx + wy) % 2 === 0 ? 1 : -1;
        delta = weave * 11 + (fbm - 0.5) * 16 + fine * 5;
        height = 128 + weave * 22;
        rough = kind === 'kevlar' ? 204 - weave * 16 : 226 - weave * 12;
      } else if (kind === 'rubber') {
        const grip = Math.sin(u * Math.PI * 36) * Math.sin(v * Math.PI * 36);
        delta = grip * 8 + fine * 6;
        height = 128 + grip * 26;
        rough = 210 + (fbm - 0.5) * 20;
      }

      const bVal = clampByte(height);
      heightField[py * size + px] = height / 255;

      cImg.data[idx] = clampByte(tr + delta);
      cImg.data[idx + 1] = clampByte(tg + delta);
      cImg.data[idx + 2] = clampByte(tb + delta);
      cImg.data[idx + 3] = 255;

      bImg.data[idx] = bVal;
      bImg.data[idx + 1] = bVal;
      bImg.data[idx + 2] = bVal;
      bImg.data[idx + 3] = 255;

      const rVal = clampByte(rough);
      rImg.data[idx] = rVal;
      rImg.data[idx + 1] = rVal;
      rImg.data[idx + 2] = rVal;
      rImg.data[idx + 3] = 255;
    }
  }

  cCtx.putImageData(cImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const map = new THREE.CanvasTexture(colorCanvas);
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  const normalStrength =
    kind === 'glass' || kind === 'ice'
      ? 1.1
      : kind === 'brick' || kind === 'crate' || kind === 'concrete' || kind === 'stone'
        ? 3.2
        : 2.2;
  const normalMap = buildNormalFromHeight(heightField, size, normalStrength);

  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, bumpMap, roughnessMap, normalMap]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = anisotropy;
  }

  const out: PBRSurfaceMaps = { map, bumpMap, roughnessMap, normalMap };
  pbrCache.set(key, out);
  return out;
}

function paintSkyCanvas(
  c: HTMLCanvasElement,
  stops: { zenith: string; upper: string; horizon: string; ground: string },
  sunU: number,
  sunV: number,
  sunGlow: string,
  cloudAlpha: number,
  stars: boolean,
): void {
  const ctx = c.getContext('2d')!;
  const w = c.width;
  const h = c.height;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, stops.zenith);
  grad.addColorStop(0.32, stops.upper);
  grad.addColorStop(0.56, stops.horizon);
  grad.addColorStop(0.75, stops.ground);
  grad.addColorStop(1.0, stops.ground);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Atmospheric sun / moon scattering halo
  const sx = w * sunU;
  const sy = h * sunV;
  const halo = ctx.createRadialGradient(sx, sy, 6, sx, sy, w * 0.28);
  halo.addColorStop(0, sunGlow);
  halo.addColorStop(0.35, sunGlow.replace(/[\d.]+\)$/, '0.28)'));
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);

  if (stars) {
    for (let i = 0; i < 240; i++) {
      const rx = hash2d(i, 7) * w;
      const ry = hash2d(i, 19) * h * 0.44;
      const alpha = 0.25 + hash2d(i, 41) * 0.65;
      const rad = hash2d(i, 61) > 0.85 ? 1.6 : 0.95;
      ctx.fillStyle = `rgba(226,232,240,${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(rx, ry, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (cloudAlpha > 0.01) {
    for (let i = 0; i < 42; i++) {
      const cx = hash2d(i, 11) * w;
      const cy = h * (0.20 + hash2d(i, 23) * 0.25);
      const rx = 55 + hash2d(i, 37) * 145;
      const ry = 12 + hash2d(i, 53) * 28;
      const cg = ctx.createRadialGradient(cx, cy, ry * 0.2, cx, cy, rx);
      cg.addColorStop(0, `rgba(255,255,255,${cloudAlpha.toFixed(2)})`);
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function createSkyDome(modeId: ModeId): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;

  if (modeId === 'defend') {
    paintSkyCanvas(
      c,
      { zenith: '#0e3a6e', upper: '#2d72b3', horizon: '#f3cf98', ground: '#8c6943' },
      0.72, 0.34, 'rgba(255,244,214,0.85)', 0.22, false,
    );
  } else if (modeId === 'hvh') {
    paintSkyCanvas(
      c,
      { zenith: '#060312', upper: '#180d36', horizon: '#5a1874', ground: '#0b0a18' },
      0.24, 0.30, 'rgba(244,63,94,0.65)', 0.06, true,
    );
  } else if (modeId === 'dm') {
    paintSkyCanvas(
      c,
      { zenith: '#0c2340', upper: '#2c5b8c', horizon: '#cbd9e8', ground: '#4a5568' },
      0.66, 0.36, 'rgba(224,242,254,0.75)', 0.30, false,
    );
  } else {
    paintSkyCanvas(
      c,
      { zenith: '#0c1f3c', upper: '#244d7e', horizon: '#93c5fd', ground: '#1e293b' },
      0.74, 0.32, 'rgba(255,250,235,0.78)', 0.22, false,
    );
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.SphereGeometry(210, 32, 20),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
}

export function createEnvironmentMap(renderer: THREE.WebGLRenderer, modeId: ModeId): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();

  const colors =
    modeId === 'hvh'
      ? { top: 0x3b0764, rimA: 0xe11d48, rimB: 0x06b6d4, bot: 0x090910 }
      : modeId === 'defend'
        ? { top: 0xfff3d6, rimA: 0xfdba74, rimB: 0x38bdf8, bot: 0x6d5234 }
        : modeId === 'dm'
          ? { top: 0xe0f2fe, rimA: 0x93c5fd, rimB: 0xcbd5e1, bot: 0x334155 }
          : { top: 0xeaf4ff, rimA: 0xfde68a, rimB: 0x60a5fa, bot: 0x1e293b };

  envScene.add(new THREE.HemisphereLight(colors.top, colors.bot, 1.8));
  const keyPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshBasicMaterial({ color: colors.top, side: THREE.DoubleSide }),
  );
  keyPanel.position.set(10, 12, 8);
  keyPanel.lookAt(0, 0, 0);
  envScene.add(keyPanel);

  const rimPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 8),
    new THREE.MeshBasicMaterial({ color: colors.rimA, side: THREE.DoubleSide }),
  );
  rimPanel.position.set(-12, 5, -9);
  rimPanel.lookAt(0, 0, 0);
  envScene.add(rimPanel);

  const fillPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 8),
    new THREE.MeshBasicMaterial({ color: colors.rimB, side: THREE.DoubleSide }),
  );
  fillPanel.position.set(9, 4, -10);
  fillPanel.lookAt(0, 0, 0);
  envScene.add(fillPanel);

  const rt = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  keyPanel.geometry.dispose();
  (keyPanel.material as THREE.Material).dispose();
  rimPanel.geometry.dispose();
  (rimPanel.material as THREE.Material).dispose();
  fillPanel.geometry.dispose();
  (fillPanel.material as THREE.Material).dispose();
  return rt.texture;
}

export function createSndSkyDome(theme: 'urban' | 'snow' | 'night'): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;

  if (theme === 'urban') {
    paintSkyCanvas(
      c,
      { zenith: '#1c4276', upper: '#5b8ec4', horizon: '#f3d4aa', ground: '#78624b' },
      0.75, 0.34, 'rgba(255,236,196,0.9)', 0.24, false,
    );
  } else if (theme === 'snow') {
    paintSkyCanvas(
      c,
      { zenith: '#0f2747', upper: '#2d5c8f', horizon: '#c8def2', ground: '#475569' },
      0.64, 0.38, 'rgba(224,242,254,0.8)', 0.32, false,
    );
  } else {
    paintSkyCanvas(
      c,
      { zenith: '#030510', upper: '#0c1633', horizon: '#2e1650', ground: '#0a0f1c' },
      0.22, 0.28, 'rgba(56,189,248,0.45)', 0.08, true,
    );
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.SphereGeometry(210, 32, 20),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
}

export function createSndEnvironmentMap(
  renderer: THREE.WebGLRenderer,
  theme: 'urban' | 'snow' | 'night',
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();

  const palette =
    theme === 'urban'
      ? { sky: 0xffeed6, ground: 0x6b5a47, panelA: 0xfff5e4, panelB: 0x7dd3fc, panelC: 0xfdba74 }
      : theme === 'snow'
        ? { sky: 0xdbeafe, ground: 0x475569, panelA: 0xf8fafc, panelB: 0x93c5fd, panelC: 0xcbd5e1 }
        : { sky: 0x1e1b4b, ground: 0x090d16, panelA: 0x38bdf8, panelB: 0xe879f9, panelC: 0x4f46e5 };

  envScene.add(new THREE.HemisphereLight(palette.sky, palette.ground, 1.8));
  const specs: [number, number, number, number][] = [
    [10, 12, 8, palette.panelA],
    [-11, 5, -9, palette.panelB],
    [11, 4, -10, palette.panelC],
  ];
  const disposables: THREE.Mesh[] = [];
  for (const [x, y, z, col] of specs) {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 10),
      new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }),
    );
    p.position.set(x, y, z);
    p.lookAt(0, 0, 0);
    envScene.add(p);
    disposables.push(p);
  }

  const rt = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  for (const m of disposables) {
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  return rt.texture;
}
