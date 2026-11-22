import * as THREE from 'three';
import { WeaponSkin } from '../data/skins';
import { WeaponDef } from '../data/weapons';
import { applyCamoShader, getCamoMaterialSpec, getCamoTextureSet } from './camoTextures';

export type WeaponSurfaceKind =
  | 'parkerized_steel'
  | 'brushed_gunmetal'
  | 'polymer_matte'
  | 'walnut_wood'
  | 'machined_aluminum'
  | 'carbon_weave'
  | 'stippled_rubber'
  | 'tactical_fabric'
  | 'leather_glove';

export interface WeaponSurfaceMaps {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

export interface WeaponMaterialPalette {
  body: THREE.MeshPhysicalMaterial;
  accent: THREE.MeshStandardMaterial;
  camoFurniture: THREE.Material;
  camoWood: THREE.Material;
  camoMag: THREE.Material;
  camoBlade: THREE.Material;
  darkSteel: THREE.MeshStandardMaterial;
  brushedSteel: THREE.MeshStandardMaterial;
  polymer: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  aluminum: THREE.MeshStandardMaterial;
  carbon: THREE.MeshStandardMaterial;
  opticGlass: THREE.MeshPhysicalMaterial;
  tritium: THREE.MeshBasicMaterial;
  brass: THREE.MeshStandardMaterial;
  redShell: THREE.MeshStandardMaterial;
  dispose: () => void;
}

export interface ArmMaterialSet {
  sleeve: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
  knuckle: THREE.MeshStandardMaterial;
}

const surfaceCache = new Map<string, WeaponSurfaceMaps>();
const studioEnvCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();
let cachedArmMats: ArmMaterialSet | null = null;

function seededRand(seed: number): () => number {
  let s = seed | 0 || 4242;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : n | 0;
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
      const a = grid[y0 * g + x0];
      const b = grid[y0 * g + x1];
      const c = grid[y1 * g + x0];
      const d = grid[y1 * g + x1];
      const top = a + (b - a) * sx;
      const bot = c + (d - c) * sx;
      out[y * size + x] = top + (bot - top) * sy;
    }
  }
  return out;
}

export function heightToNormalCanvas(height: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  const at = (x: number, y: number) => {
    const wx = (x + size) % size;
    const wy = (y + size) % size;
    return height[wy * size + wx];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = at(x - 1, y - 1);
      const t = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const l = at(x - 1, y);
      const r = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const b = at(x, y + 1);
      const br = at(x + 1, y + 1);

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

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

export function createWeaponSurfaceMaps(kind: WeaponSurfaceKind, repeatX = 1, repeatY = 1): WeaponSurfaceMaps {
  const cacheKey = `${kind}|${repeatX}|${repeatY}`;
  const cached = surfaceCache.get(cacheKey);
  if (cached) return cached;

  const isHero =
    kind === 'parkerized_steel' ||
    kind === 'brushed_gunmetal' ||
    kind === 'polymer_matte' ||
    kind === 'walnut_wood' ||
    kind === 'machined_aluminum' ||
    kind === 'carbon_weave';
  const size = isHero ? 512 : 256;

  const seed = kind.split('').reduce((acc, ch, i) => acc + ch.charCodeAt(0) * (i + 7), 137);
  const nLow = makeTileableNoise(size, seed * 3, Math.round(size / 6));
  const nMid = makeTileableNoise(size, seed * 7, Math.round(size / 24));
  const nFine = makeTileableNoise(size, seed * 13, 3);
  const rand = seededRand(seed * 19);

  const colorCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  colorCanvas.width = roughCanvas.width = size;
  colorCanvas.height = roughCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;
  const cImg = cCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const height = new Float32Array(size * size);

  let normalStrength = 2.4;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const fbm = nLow[idx] * 0.45 + nMid[idx] * 0.35 + nFine[idx] * 0.2;

      // Neutral light grey albedo (~215-242) so Three.js color multiplication stays accurate
      let rC = 226;
      let gC = 226;
      let bC = 226;
      let rough = 128;
      let h = fbm * 0.4;

      if (kind === 'parkerized_steel') {
        const bead = (nFine[idx] - 0.5) * 24;
        const oilPatch = (nLow[idx] - 0.5) * 42;
        rC = 222 + bead * 0.6 - oilPatch * 0.25;
        gC = 223 + bead * 0.6 - oilPatch * 0.22;
        bC = 226 + bead * 0.6 - oilPatch * 0.15;
        h = 0.5 + (nFine[idx] - 0.5) * 0.28 + (nMid[idx] - 0.5) * 0.16;
        rough = 132 + (nLow[idx] - 0.5) * 46 + (nFine[idx] - 0.5) * 24;
        normalStrength = 2.0;
      } else if (kind === 'brushed_gunmetal') {
        const streak = (nMid[y * size + ((x >> 3) % size)] - 0.5) * 28;
        const grain = (nFine[y * size + ((x >> 4) % size)] - 0.5) * 18;
        rC = 228 + streak * 0.5 + grain * 0.4;
        gC = 229 + streak * 0.5 + grain * 0.4;
        bC = 232 + streak * 0.5 + grain * 0.4;
        h = 0.5 + streak / 90 + grain / 110;
        rough = 74 + (fbm - 0.5) * 34 - Math.abs(streak) * 0.4;
        normalStrength = 2.2;
      } else if (kind === 'polymer_matte') {
        const pebble = nFine[idx];
        const oilRub = nLow[idx];
        rC = 222 + (pebble - 0.5) * 18 - (oilRub > 0.62 ? 12 : 0);
        gC = rC;
        bC = rC + 2;
        h = 0.5 + (pebble - 0.5) * 0.35 + (nMid[idx] - 0.5) * 0.12;
        rough = 198 + (pebble - 0.5) * 22 - (oilRub > 0.6 ? 24 : 0);
        normalStrength = 2.6;
      } else if (kind === 'stippled_rubber') {
        const gx = ((x + y) / size) * 42;
        const gy = ((x - y + size * 2) / size) * 42;
        const fx = gx - Math.floor(gx);
        const fy = gy - Math.floor(gy);
        const pyr = Math.min(fx, 1 - fx, fy, 1 - fy) * 4;
        rC = 200 + pyr * 28 + (nFine[idx] - 0.5) * 10;
        gC = rC;
        bC = rC;
        h = pyr * 0.85 + (nFine[idx] - 0.5) * 0.12;
        rough = 224 - pyr * 18 + (nMid[idx] - 0.5) * 16;
        normalStrength = 4.2;
      } else if (kind === 'walnut_wood') {
        const warp = Math.sin((y / size) * Math.PI * 14 + nLow[idx] * 6.5) * 0.5 + 0.5;
        const fineGrain = Math.sin(x * 0.42 + nMid[idx] * 5.0) * 10;
        const pore = nFine[idx] < 0.14 ? -28 : 0;
        const lum = 206 + warp * 34 + fineGrain * 0.6 + pore;
        rC = lum + 12;
        gC = lum - 6;
        bC = lum - 22;
        h = 0.45 + warp * 0.32 + (pore < 0 ? -0.18 : 0);
        rough = 148 + (1 - warp) * 42 + (nLow[idx] - 0.5) * 26;
        normalStrength = 2.8;
      } else if (kind === 'machined_aluminum') {
        const pass = Math.sin((y / size) * Math.PI * 64) * 8;
        const swirl = (nMid[idx] - 0.5) * 14;
        rC = 230 + pass * 0.6 + swirl;
        gC = 232 + pass * 0.6 + swirl;
        bC = 235 + pass * 0.6 + swirl;
        h = 0.5 + pass / 55 + swirl / 90;
        rough = 92 + (fbm - 0.5) * 28;
        normalStrength = 1.9;
      } else if (kind === 'carbon_weave') {
        const cx = Math.floor(x / 8);
        const cy = Math.floor(y / 8);
        const phase = (cx + cy) % 4;
        const isWarp = phase < 2;
        const fiber = isWarp ? Math.sin((x % 8) * (Math.PI / 8)) : Math.sin((y % 8) * (Math.PI / 8));
        rC = 192 + fiber * 46;
        gC = 194 + fiber * 46;
        bC = 198 + fiber * 46;
        h = 0.35 + fiber * 0.45;
        rough = isWarp ? 82 + (1 - fiber) * 38 : 126 + (1 - fiber) * 38;
        normalStrength = 3.2;
      } else if (kind === 'tactical_fabric') {
        const grid = x % 12 < 2 || y % 12 < 2 ? 1 : 0;
        const thread = ((x >> 1) + (y >> 1)) % 2 === 0 ? 8 : -8;
        rC = 208 + thread + grid * 16;
        gC = rC + 2;
        bC = rC + 5;
        h = 0.5 + grid * 0.25 + thread / 45;
        rough = 218 + (fbm - 0.5) * 24;
        normalStrength = 2.8;
      } else if (kind === 'leather_glove') {
        const cell = nFine[idx] > 0.55 ? 0.15 : -0.1;
        rC = 205 + (nMid[idx] - 0.5) * 24 + cell * 18;
        gC = rC - 2;
        bC = rC - 4;
        h = 0.5 + cell + (nMid[idx] - 0.5) * 0.22;
        rough = 185 + (nLow[idx] - 0.5) * 40;
        normalStrength = 3.0;
      }

      height[idx] = h;
      const p = idx * 4;
      cImg.data[p] = clampByte(rC);
      cImg.data[p + 1] = clampByte(gC);
      cImg.data[p + 2] = clampByte(bC);
      cImg.data[p + 3] = 255;

      const rv = clampByte(rough);
      rImg.data[p] = rImg.data[p + 1] = rImg.data[p + 2] = rv;
      rImg.data[p + 3] = 255;
    }
  }

  cCtx.putImageData(cImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  // Subtle edge wear, micro-scratches & stamped manufacturing marks on metal heroes
  if (kind === 'parkerized_steel' || kind === 'brushed_gunmetal' || kind === 'machined_aluminum') {
    cCtx.strokeStyle = 'rgba(255,255,255,0.12)';
    rCtx.strokeStyle = 'rgb(65,65,65)';
    for (let i = 0; i < 22; i++) {
      const sx = rand() * size;
      const sy = rand() * size;
      const ang = (rand() - 0.5) * 0.45;
      const len = 14 + rand() * 44;
      cCtx.lineWidth = 0.8 + rand() * 0.9;
      rCtx.lineWidth = cCtx.lineWidth;
      cCtx.beginPath();
      cCtx.moveTo(sx, sy);
      cCtx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
      cCtx.stroke();
      rCtx.beginPath();
      rCtx.moveTo(sx, sy);
      rCtx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
      rCtx.stroke();
    }

    // Faint oil/handling smudge patch on roughness map
    for (let i = 0; i < 4; i++) {
      const fx = 90 + rand() * (size - 180);
      const fy = 90 + rand() * (size - 180);
      const fg = rCtx.createRadialGradient(fx, fy, 4, fx, fy, 42);
      fg.addColorStop(0, 'rgba(72,72,72,0.38)');
      fg.addColorStop(1, 'rgba(130,130,130,0)');
      rCtx.fillStyle = fg;
      rCtx.beginPath();
      rCtx.arc(fx, fy, 42, 0, Math.PI * 2);
      rCtx.fill();
    }
  }

  if (kind === 'parkerized_steel') {
    cCtx.fillStyle = 'rgba(30,35,44,0.32)';
    cCtx.font = 'bold 13px monospace';
    cCtx.fillText('MIL-SPEC // SN 04-8912', 28, size - 26);
    cCtx.strokeStyle = 'rgba(30,35,44,0.28)';
    cCtx.lineWidth = 1.5;
    cCtx.strokeRect(24, size - 44, 190, 26);
  }

  const normalCanvas = heightToNormalCanvas(height, size, normalStrength);

  const toTex = (canvas: HTMLCanvasElement, isColor: boolean) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = 4;
    tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return tex;
  };

  const result: WeaponSurfaceMaps = {
    map: toTex(colorCanvas, true),
    normalMap: toTex(normalCanvas, false),
    roughnessMap: toTex(roughCanvas, false),
  };
  surfaceCache.set(cacheKey, result);
  return result;
}

export function createWeaponMaterialPalette(def: WeaponDef, skin?: WeaponSkin): WeaponMaterialPalette {
  const parkerized = createWeaponSurfaceMaps('parkerized_steel', 1, 1);
  const brushed = createWeaponSurfaceMaps('brushed_gunmetal', 1, 1);
  const polyMaps = createWeaponSurfaceMaps('polymer_matte', 1, 1);
  const rubberMaps = createWeaponSurfaceMaps('stippled_rubber', 2, 2);
  const woodMaps = createWeaponSurfaceMaps('walnut_wood', 1, 1);
  const aluMaps = createWeaponSurfaceMaps('machined_aluminum', 1, 1);
  const carbonMaps = createWeaponSurfaceMaps('carbon_weave', 2, 2);

  const bodyMaps = def.isMelee || (skin?.metallic ?? 0) >= 0.7 ? brushed : parkerized;
  const bodyColor = skin?.bodyColor ?? def.color;
  const accentColor = skin?.accentColor ?? def.accentColor;
  const metal = skin?.metallic ?? (def.isMelee ? 0.9 : def.id === 'sniper' || def.id === 'ssg' ? 0.56 : 0.64);
  const isSovereignOrMetal = (skin?.metallic ?? 0) >= 0.85;

  let body: THREE.MeshPhysicalMaterial;
  if (skin) {
    const camoMaps = getCamoTextureSet(skin.pattern);
    const spec = getCamoMaterialSpec(skin.pattern);
    body = new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      map: camoMaps.map,
      normalMap: camoMaps.normalMap,
      normalScale: new THREE.Vector2(spec.normalScale, spec.normalScale),
      roughnessMap: camoMaps.roughnessMap,
      roughness: spec.roughness,
      metalness: spec.metalness,
      clearcoat: spec.clearcoat,
      clearcoatRoughness: spec.clearcoatRoughness,
      envMapIntensity: spec.envMapIntensity,
    });
    applyCamoShader(body, skin.pattern);
  } else {
    body = new THREE.MeshPhysicalMaterial({
      color: bodyColor,
      map: bodyMaps.map,
      normalMap: bodyMaps.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: bodyMaps.roughnessMap,
      roughness: Math.max(0.22, 0.74 - metal * 0.42),
      metalness: metal,
      clearcoat: isSovereignOrMetal ? 0.45 : 0.12,
      clearcoatRoughness: 0.28,
      envMapIntensity: 1.15,
    });
  }

  const accent = new THREE.MeshStandardMaterial({
    color: accentColor,
    map: aluMaps.map,
    normalMap: aluMaps.normalMap,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughnessMap: aluMaps.roughnessMap,
    roughness: 0.36,
    metalness: 0.72,
    emissive: skin?.emissiveColor ? new THREE.Color(skin.emissiveColor) : new THREE.Color(0x000000),
    emissiveIntensity: skin?.emissiveColor ? 0.18 : 0,
    envMapIntensity: 1.1,
  });

  const darkSteel = new THREE.MeshStandardMaterial({
    color: '#1f2530',
    map: parkerized.map,
    normalMap: parkerized.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughnessMap: parkerized.roughnessMap,
    roughness: 0.48,
    metalness: 0.82,
    envMapIntensity: 1.1,
  });

  const brushedSteel = new THREE.MeshStandardMaterial({
    color: def.isMelee ? '#cfd8e3' : '#9aa4b2',
    map: brushed.map,
    normalMap: brushed.normalMap,
    normalScale: new THREE.Vector2(0.38, 0.38),
    roughnessMap: brushed.roughnessMap,
    roughness: 0.28,
    metalness: 0.92,
    envMapIntensity: 1.25,
  });

  const polymer = new THREE.MeshStandardMaterial({
    color: '#1b2028',
    map: polyMaps.map,
    normalMap: polyMaps.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughnessMap: polyMaps.roughnessMap,
    roughness: 0.8,
    metalness: 0.06,
  });

  const rubber = new THREE.MeshStandardMaterial({
    color: '#13171e',
    map: rubberMaps.map,
    normalMap: rubberMaps.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: rubberMaps.roughnessMap,
    roughness: 0.92,
    metalness: 0.02,
  });

  const wood = new THREE.MeshStandardMaterial({
    color: '#8a5029',
    map: woodMaps.map,
    normalMap: woodMaps.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: woodMaps.roughnessMap,
    roughness: 0.62,
    metalness: 0.04,
  });

  const aluminum = new THREE.MeshStandardMaterial({
    color: '#3c4450',
    map: aluMaps.map,
    normalMap: aluMaps.normalMap,
    normalScale: new THREE.Vector2(0.42, 0.42),
    roughnessMap: aluMaps.roughnessMap,
    roughness: 0.35,
    metalness: 0.82,
    envMapIntensity: 1.15,
  });

  const carbon = new THREE.MeshStandardMaterial({
    color: '#222730',
    map: carbonMaps.map,
    normalMap: carbonMaps.normalMap,
    normalScale: new THREE.Vector2(0.65, 0.65),
    roughnessMap: carbonMaps.roughnessMap,
    roughness: 0.44,
    metalness: 0.28,
  });

  const opticGlass = new THREE.MeshPhysicalMaterial({
    color: '#081b26',
    roughness: 0.05,
    metalness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    emissive: '#0c4a6e',
    emissiveIntensity: 0.15,
    envMapIntensity: 1.4,
  });

  const tritium = new THREE.MeshBasicMaterial({ color: '#4ade80' });

  const brass = new THREE.MeshStandardMaterial({
    color: '#d4a64a',
    roughness: 0.22,
    metalness: 0.92,
    envMapIntensity: 1.25,
  });

  const redShell = new THREE.MeshStandardMaterial({
    color: '#991b1b',
    normalMap: polyMaps.normalMap,
    normalScale: new THREE.Vector2(0.3, 0.3),
    roughnessMap: polyMaps.roughnessMap,
    roughness: 0.45,
    metalness: 0.05,
  });

  const camoFurniture: THREE.Material = skin ? body : polymer;
  const camoWood: THREE.Material = skin ? body : wood;
  const camoMag: THREE.Material = skin ? body : darkSteel;
  const camoBlade: THREE.Material = skin ? body : brushedSteel;

  const uniqueMats = Array.from(
    new Set<THREE.Material>([
      body,
      accent,
      darkSteel,
      brushedSteel,
      polymer,
      rubber,
      wood,
      aluminum,
      carbon,
      opticGlass,
      tritium,
      brass,
      redShell,
    ]),
  );

  return {
    body,
    accent,
    camoFurniture,
    camoWood,
    camoMag,
    camoBlade,
    darkSteel,
    brushedSteel,
    polymer,
    rubber,
    wood,
    aluminum,
    carbon,
    opticGlass,
    tritium,
    brass,
    redShell,
    dispose: () => {
      for (const m of uniqueMats) m.dispose();
    },
  };
}

export function createArmMaterials(): ArmMaterialSet {
  if (cachedArmMats) return cachedArmMats;

  const fab = createWeaponSurfaceMaps('tactical_fabric', 2, 2);
  const lea = createWeaponSurfaceMaps('leather_glove', 1, 1);
  const carb = createWeaponSurfaceMaps('carbon_weave', 2, 2);

  cachedArmMats = {
    sleeve: new THREE.MeshStandardMaterial({
      color: '#1e2530',
      map: fab.map,
      normalMap: fab.normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughnessMap: fab.roughnessMap,
      roughness: 0.86,
      metalness: 0.04,
    }),
    glove: new THREE.MeshStandardMaterial({
      color: '#14171d',
      map: lea.map,
      normalMap: lea.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughnessMap: lea.roughnessMap,
      roughness: 0.72,
      metalness: 0.08,
    }),
    knuckle: new THREE.MeshStandardMaterial({
      color: '#252a34',
      map: carb.map,
      normalMap: carb.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: carb.roughnessMap,
      roughness: 0.42,
      metalness: 0.35,
    }),
  };
  return cachedArmMats;
}

export function createStudioEnvironmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const existing = studioEnvCache.get(renderer);
  if (existing) return existing;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color('#0d121a');

  const addSoftbox = (w: number, h: number, color: string, pos: [number, number, number]) => {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    panel.position.set(pos[0], pos[1], pos[2]);
    panel.lookAt(0, 0, 0);
    envScene.add(panel);
  };

  addSoftbox(18, 12, '#ffffff', [0, 10, 2]);
  addSoftbox(10, 8, '#fff1d6', [8, 5, 7]);
  addSoftbox(10, 8, '#7dd3fc', [-9, 3, -6]);
  addSoftbox(20, 20, '#1e293b', [0, -10, 0]);

  const rt = pmrem.fromScene(envScene, 0.035);
  pmrem.dispose();
  envScene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  });

  studioEnvCache.set(renderer, rt.texture);
  return rt.texture;
}
