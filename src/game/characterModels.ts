import * as THREE from 'three';
import { createWeaponSurfaceMaps, heightToNormalCanvas } from './weaponMaterials';

export type OperatorVariantId = 0 | 1 | 2 | 3;

export interface ProfileRing {
  /** Normalized vertical coordinate from 0 (bottom) to 1 (top) */
  t: number;
  /** Half-width along X axis */
  rx: number;
  /** Half-depth along Z axis */
  rz: number;
  /** Center X offset */
  ox?: number;
  /** Center Z offset (+Z is forward) */
  oz?: number;
  /** Garment wrinkle amplitude */
  foldAmp?: number;
  /** Garment wrinkle frequency around circumference */
  foldFreq?: number;
}

export interface CharacterMaterialPalette {
  skin: THREE.MeshStandardMaterial;
  balaclava: THREE.MeshStandardMaterial;
  eyeWhite: THREE.MeshStandardMaterial;
  eyeIris: THREE.MeshStandardMaterial;
  rigCordura: THREE.MeshStandardMaterial;
  pantsFabric: THREE.MeshStandardMaterial;
  bootLeather: THREE.MeshStandardMaterial;
  rubberMatte: THREE.MeshStandardMaterial;
  helmetShell: THREE.MeshStandardMaterial;
  gunmetal: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  nvgLens: THREE.MeshStandardMaterial;
}

let cachedPalette: CharacterMaterialPalette | null = null;
const geoCache = new Map<string, THREE.BufferGeometry>();

function getCachedGeo(key: string, builder: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = builder();
    geoCache.set(key, g);
  }
  return g;
}

/**
 * Lofts a closed, smooth-shaded 3D anatomical or garment mesh from elliptical profile rings
 * with rounded hemispherical end-caps and natural fabric wrinkle micro-relief.
 */
export function createLoftedProfileGeometry(
  height: number,
  yTop: number,
  rings: ProfileRing[],
  radialSegs = 16,
  subdivPerSpan = 2,
  capEnds = true,
): THREE.BufferGeometry {
  // Expand intermediate rings with smooth cubic Hermite / cosine interpolation
  const denseRings: ProfileRing[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    const steps = Math.max(1, subdivPerSpan);
    for (let s = 0; s < steps; s++) {
      const u = s / steps;
      const sm = u * u * (3 - 2 * u);
      denseRings.push({
        t: a.t + (b.t - a.t) * u,
        rx: a.rx + (b.rx - a.rx) * sm,
        rz: a.rz + (b.rz - a.rz) * sm,
        ox: (a.ox ?? 0) + ((b.ox ?? 0) - (a.ox ?? 0)) * sm,
        oz: (a.oz ?? 0) + ((b.oz ?? 0) - (a.oz ?? 0)) * sm,
        foldAmp: (a.foldAmp ?? 0) + ((b.foldAmp ?? 0) - (a.foldAmp ?? 0)) * sm,
        foldFreq: Math.round((a.foldFreq ?? 0) + ((b.foldFreq ?? 0) - (a.foldFreq ?? 0)) * sm),
      });
    }
  }
  denseRings.push(rings[rings.length - 1]);

  const allRings: ProfileRing[] = [];
  if (capEnds) {
    const bot = denseRings[0];
    allRings.push(
      { t: Math.max(0, bot.t - 0.025), rx: bot.rx * 0.18, rz: bot.rz * 0.18, ox: bot.ox, oz: bot.oz },
      { t: Math.max(0, bot.t - 0.008), rx: bot.rx * 0.68, rz: bot.rz * 0.68, ox: bot.ox, oz: bot.oz },
    );
  }
  allRings.push(...denseRings);
  if (capEnds) {
    const top = denseRings[denseRings.length - 1];
    allRings.push(
      { t: Math.min(1, top.t + 0.008), rx: top.rx * 0.68, rz: top.rz * 0.68, ox: top.ox, oz: top.oz },
      { t: Math.min(1, top.t + 0.025), rx: top.rx * 0.18, rz: top.rz * 0.18, ox: top.ox, oz: top.oz },
    );
  }

  const numRings = allRings.length;
  const ringStride = radialSegs + 1;
  const positions = new Float32Array(numRings * ringStride * 3);
  const uvs = new Float32Array(numRings * ringStride * 2);
  const indices: number[] = [];

  const yBottom = yTop - height;

  for (let r = 0; r < numRings; r++) {
    const ring = allRings[r];
    const y = yBottom + ring.t * height;
    const ox = ring.ox ?? 0;
    const oz = ring.oz ?? 0;
    const foldAmp = ring.foldAmp ?? 0;
    const foldFreq = ring.foldFreq ?? 0;

    for (let s = 0; s <= radialSegs; s++) {
      const u = s / radialSegs;
      const theta = u * Math.PI * 2;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);

      // Diagonal fabric fold wave
      const wrinkle =
        foldAmp > 0 && foldFreq > 0
          ? Math.sin(theta * foldFreq + ring.t * Math.PI * 5.0) * foldAmp +
            Math.cos(theta * (foldFreq + 2) - ring.t * Math.PI * 7.0) * (foldAmp * 0.45)
          : 0;

      const rx = Math.max(0.004, ring.rx + wrinkle);
      const rz = Math.max(0.004, ring.rz + wrinkle);

      const vx = ox + sinT * rx;
      const vz = oz + cosT * rz;

      const vIdx = r * ringStride + s;
      positions[vIdx * 3] = vx;
      positions[vIdx * 3 + 1] = y;
      positions[vIdx * 3 + 2] = vz;

      uvs[vIdx * 2] = u;
      uvs[vIdx * 2 + 1] = ring.t;
    }
  }

  for (let r = 0; r < numRings - 1; r++) {
    for (let s = 0; s < radialSegs; s++) {
      const a = r * ringStride + s;
      const b = a + 1;
      const c = (r + 1) * ringStride + s;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates an anatomical human head mesh with sculpted jawline, chin, cheekbones,
 * supraorbital brow ridge, eye sockets, nose bridge, and cranial dome.
 */
export function getAnatomicalHeadGeometry(): THREE.BufferGeometry {
  return getCachedGeo('anatomical_head_v2', () => {
    const geo = new THREE.SphereGeometry(0.155, 24, 20);
    const pos = geo.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);

      // Normalize to unit sphere coordinates
      const r = Math.hypot(x, y, z) || 1;
      const nx = x / r;
      const ny = y / r;
      const nz = z / r;

      // Vertical cranial proportion: taller skull, tapered lower jaw
      y *= 1.12;
      z *= 1.06;

      // Taper temples and lower cheek/jawline
      if (ny < 0.1) {
        const jawT = Math.max(0, Math.min(1, (0.1 - ny) / 1.1));
        // Narrow jaw width X, pull chin slightly forward (+Z)
        x *= 1.0 - jawT * 0.28;
        if (nz > 0) {
          z *= 1.0 - jawT * 0.08;
          // Defined chin protrusion at bottom front
          const chinMask = Math.max(0, 1 - Math.hypot(nx * 2.2, ny + 0.72) * 2.1);
          z += chinMask * 0.018;
        } else {
          // Occipital base curves inward toward neck at rear (-Z)
          z *= 1.0 - jawT * 0.35;
        }
      }

      // Supraorbital brow ridge (+Z, ny ~ 0.18..0.34)
      if (nz > 0.35) {
        const browMask = Math.exp(-Math.pow((ny - 0.24) * 7.5, 2)) * Math.exp(-Math.pow(nx * 1.6, 2));
        z += browMask * 0.014;

        // Recessed orbital eye sockets (nx ~ +-0.36, ny ~ 0.08)
        const eyeDistL = Math.hypot((nx - 0.34) * 2.4, (ny - 0.09) * 3.6);
        const eyeDistR = Math.hypot((nx + 0.34) * 2.4, (ny - 0.09) * 3.6);
        const eyeSocket = Math.max(0, 1 - Math.min(eyeDistL, eyeDistR));
        z -= eyeSocket * 0.016;

        // 3D Nose bridge & tip (nx ~ 0, ny ~ -0.18..+0.15)
        if (ny > -0.24 && ny < 0.20) {
          const noseX = Math.exp(-Math.pow(nx * 7.2, 2));
          const noseProfile = Math.max(0, 1 - Math.abs(ny + 0.04) * 4.5);
          const tipBoost = Math.exp(-Math.pow((ny + 0.12) * 11, 2));
          z += noseX * (noseProfile * 0.022 + tipBoost * 0.014);
        }

        // Zygomatic cheekbones
        const cheekL = Math.exp(-Math.pow((nx - 0.52) * 3.5, 2) - Math.pow((ny + 0.12) * 4.2, 2));
        const cheekR = Math.exp(-Math.pow((nx + 0.52) * 3.5, 2) - Math.pow((ny + 0.12) * 4.2, 2));
        x += Math.sign(x) * (cheekL + cheekR) * 0.009;
        z += (cheekL + cheekR) * 0.008;

        // Mouth / philtrum ridge
        const mouthMask = Math.exp(-Math.pow((ny + 0.42) * 9.0, 2)) * Math.exp(-Math.pow(nx * 3.2, 2));
        z += mouthMask * 0.008;
      }

      pos.setXYZ(i, x, y, z);
    }

    geo.computeVertexNormals();
    return geo;
  });
}

/**
 * Generates a high-cut FAST / Ops-Core ballistic helmet dome with curved ear cutouts
 * and flared rear occiput skirt.
 */
export function getBallisticHelmetGeometry(): THREE.BufferGeometry {
  return getCachedGeo('ballistic_helmet_v2', () => {
    const geo = new THREE.SphereGeometry(0.182, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.64);
    const pos = geo.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);

      const r = Math.hypot(x, y, z) || 1;
      const nx = x / r;
      const nz = z / r;

      // Slightly elongate front-to-back like a modern tactical FAST helmet
      z *= 1.08;
      x *= 0.98;

      // High-cut ear arch cutout on left & right sides (|nx| > 0.65, nz ~ -0.15..+0.35)
      const sideArch =
        Math.max(0, (Math.abs(nx) - 0.55) / 0.45) *
        Math.exp(-Math.pow((nz - 0.05) * 2.6, 2));
      if (y < 0.06) {
        y += sideArch * 0.062;
      }

      // Brow rim flare at front (+Z) and lower rear nape shield (-Z)
      if (nz < -0.35 && y < 0.04) {
        y -= (-nz - 0.35) * 0.055;
      }

      pos.setXYZ(i, x, y, z);
    }

    geo.computeVertexNormals();
    return geo;
  });
}

/**
 * Generates a wrap-around panoramic ballistic visor / tactical goggles lens.
 */
export function getPanoramicVisorGeometry(): THREE.BufferGeometry {
  return getCachedGeo('panoramic_visor_v2', () => {
    // Curved cylindrical shell wrapping across the front of the face (+Z)
    const geo = new THREE.CylinderGeometry(
      0.158,
      0.154,
      0.082,
      20,
      4,
      true,
      -Math.PI * 0.34,
      Math.PI * 0.68,
    );
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      let y = pos.getY(i);
      const z = pos.getZ(i);
      // Nasal bridge notch at bottom center (x ~ 0, y < 0)
      if (y < 0) {
        const nasalNotch = Math.exp(-Math.pow(x * 16, 2));
        y += nasalNotch * 0.022;
      }
      pos.setXYZ(i, x, y, z - 0.012);
    }
    geo.computeVertexNormals();
    return geo;
  });
}

export function getSculptedTorsoGeometry(): THREE.BufferGeometry {
  return getCachedGeo('sculpted_torso_v2', () =>
    createLoftedProfileGeometry(
      0.72,
      0.64,
      [
        { t: 0.0, rx: 0.215, rz: 0.145, oz: 0.0, foldAmp: 0.005, foldFreq: 8 },
        { t: 0.18, rx: 0.225, rz: 0.155, oz: 0.004, foldAmp: 0.006, foldFreq: 7 },
        { t: 0.45, rx: 0.255, rz: 0.172, oz: 0.008, foldAmp: 0.004, foldFreq: 6 },
        { t: 0.76, rx: 0.285, rz: 0.178, oz: 0.006, foldAmp: 0.004, foldFreq: 6 },
        { t: 0.92, rx: 0.245, rz: 0.148, oz: -0.004, foldAmp: 0.003, foldFreq: 5 },
        { t: 1.0, rx: 0.115, rz: 0.105, oz: -0.006 },
      ],
      20,
      3,
    ),
  );
}

export function getSculptedPelvisGeometry(): THREE.BufferGeometry {
  return getCachedGeo('sculpted_pelvis_v2', () =>
    createLoftedProfileGeometry(
      0.22,
      0.08,
      [
        { t: 0.0, rx: 0.21, rz: 0.135, oz: -0.01 },
        { t: 0.45, rx: 0.245, rz: 0.158, oz: -0.016, foldAmp: 0.004, foldFreq: 6 },
        { t: 0.85, rx: 0.235, rz: 0.152, oz: -0.008, foldAmp: 0.003, foldFreq: 6 },
        { t: 1.0, rx: 0.22, rz: 0.145, oz: 0.0 },
      ],
      18,
      2,
    ),
  );
}

export function getSculptedThighGeometry(): THREE.BufferGeometry {
  return getCachedGeo('sculpted_thigh_v2', () =>
    createLoftedProfileGeometry(
      0.36,
      0.02,
      [
        { t: 0.0, rx: 0.082, rz: 0.088, oz: 0.004, foldAmp: 0.005, foldFreq: 6 },
        { t: 0.35, rx: 0.096, rz: 0.104, oz: 0.006, foldAmp: 0.0045, foldFreq: 5 },
        { t: 0.72, rx: 0.108, rz: 0.116, oz: -0.004, foldAmp: 0.0035, foldFreq: 5 },
        { t: 1.0, rx: 0.104, rz: 0.112, oz: -0.006 },
      ],
      16,
      2,
    ),
  );
}

export function getSculptedCalfGeometry(): THREE.BufferGeometry {
  return getCachedGeo('sculpted_calf_v2', () =>
    createLoftedProfileGeometry(
      0.30,
      0.01,
      [
        { t: 0.0, rx: 0.064, rz: 0.068, oz: 0.0, foldAmp: 0.0045, foldFreq: 6 },
        { t: 0.25, rx: 0.072, rz: 0.078, oz: -0.004, foldAmp: 0.004, foldFreq: 6 },
        { t: 0.62, rx: 0.086, rz: 0.095, oz: -0.012, foldAmp: 0.003, foldFreq: 5 },
        { t: 0.88, rx: 0.082, rz: 0.086, oz: -0.004 },
        { t: 1.0, rx: 0.078, rz: 0.082, oz: 0.0 },
      ],
      16,
      2,
    ),
  );
}

export function getSculptedUpperArmGeometry(): THREE.BufferGeometry {
  return getCachedGeo('sculpted_upper_arm_v2', () =>
    createLoftedProfileGeometry(
      0.26,
      0.02,
      [
        { t: 0.0, rx: 0.058, rz: 0.062, foldAmp: 0.004, foldFreq: 6 },
        { t: 0.45, rx: 0.068, rz: 0.074, foldAmp: 0.0035, foldFreq: 5 },
        { t: 0.82, rx: 0.076, rz: 0.082, foldAmp: 0.0025, foldFreq: 4 },
        { t: 1.0, rx: 0.072, rz: 0.076 },
      ],
      14,
      2,
    ),
  );
}

export function getSculptedForearmGeometry(): THREE.BufferGeometry {
  return getCachedGeo('sculpted_forearm_v2', () =>
    createLoftedProfileGeometry(
      0.24,
      0.01,
      [
        { t: 0.0, rx: 0.044, rz: 0.048, foldAmp: 0.0035, foldFreq: 6 },
        { t: 0.35, rx: 0.052, rz: 0.056, foldAmp: 0.003, foldFreq: 5 },
        { t: 0.72, rx: 0.062, rz: 0.066, foldAmp: 0.003, foldFreq: 5 },
        { t: 1.0, rx: 0.058, rz: 0.062 },
      ],
      14,
      2,
    ),
  );
}

/**
 * Generates a realistic PBR material palette for characters (skin with subsurface warmth,
 * ripstop uniform fabric, Cordura 1000D tactical rig, leather boots, matte rubber, ballistic helmet).
 */
export function getCharacterMaterialPalette(): CharacterMaterialPalette {
  if (cachedPalette) return cachedPalette;

  // Procedural skin texture with pore micro-relief and warm cheek/nose variation
  const skinSize = 128;
  const skinCanvas = document.createElement('canvas');
  const skinRoughCanvas = document.createElement('canvas');
  skinCanvas.width = skinRoughCanvas.width = skinSize;
  skinCanvas.height = skinRoughCanvas.height = skinSize;
  const sCtx = skinCanvas.getContext('2d')!;
  const rCtx = skinRoughCanvas.getContext('2d')!;
  const sImg = sCtx.createImageData(skinSize, skinSize);
  const rImg = rCtx.createImageData(skinSize, skinSize);
  const skinHeight = new Float32Array(skinSize * skinSize);

  for (let y = 0; y < skinSize; y++) {
    const v = y / skinSize;
    for (let x = 0; x < skinSize; x++) {
      const u = x / skinSize;
      const idx = y * skinSize + x;
      const pore = Math.sin(x * 1.9) * Math.cos(y * 1.9) * 0.5 + ((Math.sin(x * 12.7 + y * 31.1) * 43758.5) % 1) * 0.5;
      skinHeight[idx] = 0.5 + pore * 0.18;

      // Subtle subsurface reddish warmth across mid-face
      const warmth = Math.exp(-Math.pow((v - 0.52) * 3.2, 2));
      const p = idx * 4;
      sImg.data[p] = Math.min(255, Math.round(224 + warmth * 12 + pore * 6));
      sImg.data[p + 1] = Math.min(255, Math.round(174 - warmth * 4 + pore * 5));
      sImg.data[p + 2] = Math.min(255, Math.round(138 - warmth * 6 + pore * 4));
      sImg.data[p + 3] = 255;

      const rv = Math.round(138 + pore * 22 - warmth * 14);
      rImg.data[p] = rImg.data[p + 1] = rImg.data[p + 2] = rv;
      rImg.data[p + 3] = 255;
    }
  }
  sCtx.putImageData(sImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);
  const skinMap = new THREE.CanvasTexture(skinCanvas);
  skinMap.colorSpace = THREE.SRGBColorSpace;
  const skinRoughMap = new THREE.CanvasTexture(skinRoughCanvas);
  const skinNormalMap = new THREE.CanvasTexture(heightToNormalCanvas(skinHeight, skinSize, 1.6));

  const fabricSurf = createWeaponSurfaceMaps('tactical_fabric', 3, 3);
  const leatherSurf = createWeaponSurfaceMaps('leather_glove', 2, 2);
  const rubberSurf = createWeaponSurfaceMaps('stippled_rubber', 2, 2);
  const polymerSurf = createWeaponSurfaceMaps('polymer_matte', 2, 2);
  const gunmetalSurf = createWeaponSurfaceMaps('parkerized_steel', 2, 2);

  cachedPalette = {
    skin: new THREE.MeshStandardMaterial({
      map: skinMap,
      normalMap: skinNormalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: skinRoughMap,
      roughness: 0.54,
      metalness: 0.02,
    }),
    balaclava: new THREE.MeshStandardMaterial({
      color: '#1e2430',
      map: fabricSurf.map,
      normalMap: fabricSurf.normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughnessMap: fabricSurf.roughnessMap,
      roughness: 0.86,
      metalness: 0.04,
    }),
    eyeWhite: new THREE.MeshStandardMaterial({
      color: '#f1f5f9',
      roughness: 0.18,
      metalness: 0.05,
    }),
    eyeIris: new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.08,
      metalness: 0.25,
    }),
    rigCordura: new THREE.MeshStandardMaterial({
      color: '#1c222d',
      map: fabricSurf.map,
      normalMap: fabricSurf.normalMap,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughnessMap: fabricSurf.roughnessMap,
      roughness: 0.74,
      metalness: 0.14,
    }),
    pantsFabric: new THREE.MeshStandardMaterial({
      color: '#1e293b',
      map: fabricSurf.map,
      normalMap: fabricSurf.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: fabricSurf.roughnessMap,
      roughness: 0.82,
      metalness: 0.06,
    }),
    bootLeather: new THREE.MeshStandardMaterial({
      color: '#141820',
      map: leatherSurf.map,
      normalMap: leatherSurf.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: leatherSurf.roughnessMap,
      roughness: 0.58,
      metalness: 0.12,
    }),
    rubberMatte: new THREE.MeshStandardMaterial({
      color: '#0b0e14',
      map: rubberSurf.map,
      normalMap: rubberSurf.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughnessMap: rubberSurf.roughnessMap,
      roughness: 0.88,
      metalness: 0.05,
    }),
    helmetShell: new THREE.MeshStandardMaterial({
      color: '#253042',
      map: polymerSurf.map,
      normalMap: polymerSurf.normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughnessMap: polymerSurf.roughnessMap,
      roughness: 0.50,
      metalness: 0.24,
    }),
    gunmetal: new THREE.MeshStandardMaterial({
      color: '#334155',
      map: gunmetalSurf.map,
      normalMap: gunmetalSurf.normalMap,
      roughnessMap: gunmetalSurf.roughnessMap,
      roughness: 0.36,
      metalness: 0.82,
    }),
    brass: new THREE.MeshStandardMaterial({
      color: '#ca8a04',
      roughness: 0.32,
      metalness: 0.85,
    }),
    nvgLens: new THREE.MeshStandardMaterial({
      color: '#022c22',
      emissive: new THREE.Color('#10b981'),
      emissiveIntensity: 0.55,
      roughness: 0.1,
      metalness: 0.9,
    }),
  };

  return cachedPalette;
}

/**
 * Builds a multi-part sculpted tactical combat boot with lugged rubber outsole,
 * contoured leather ankle shaft, rounded toe cap, and speed-hook laces.
 */
export function buildSculptedCombatBoot(
  palette: CharacterMaterialPalette,
  lod0Details: THREE.Object3D[],
): THREE.Group {
  const boot = new THREE.Group();

  // 1. Lugged rubber outsole + heel block
  const soleGeo = getCachedGeo('boot_sole', () => new THREE.CylinderGeometry(0.068, 0.072, 0.032, 14));
  const sole = new THREE.Mesh(soleGeo, palette.rubberMatte);
  sole.scale.set(1.0, 1.0, 1.85);
  sole.position.set(0, -0.078, 0.035);
  sole.castShadow = true;
  boot.add(sole);

  // 2. Contoured leather foot upper & rounded toe box
  const vampGeo = getCachedGeo('boot_vamp', () => new THREE.SphereGeometry(0.066, 14, 10));
  const vamp = new THREE.Mesh(vampGeo, palette.bootLeather);
  vamp.scale.set(0.98, 0.72, 1.78);
  vamp.position.set(0, -0.052, 0.038);
  vamp.castShadow = true;
  boot.add(vamp);

  // 3. Rubber toe bumper cap
  const toeCapGeo = getCachedGeo('boot_toecap', () => new THREE.SphereGeometry(0.056, 12, 8));
  const toeCap = new THREE.Mesh(toeCapGeo, palette.rubberMatte);
  toeCap.scale.set(1.04, 0.65, 0.95);
  toeCap.position.set(0, -0.056, 0.112);
  boot.add(toeCap);

  // 4. Sculpted ankle collar shaft
  const shaftGeo = getCachedGeo('boot_shaft', () =>
    createLoftedProfileGeometry(
      0.095,
      0.015,
      [
        { t: 0.0, rx: 0.062, rz: 0.072, oz: 0.005 },
        { t: 0.5, rx: 0.058, rz: 0.066, oz: 0.002, foldAmp: 0.0025, foldFreq: 6 },
        { t: 1.0, rx: 0.062, rz: 0.068, oz: 0.0 },
      ],
      12,
      1,
    ),
  );
  const shaft = new THREE.Mesh(shaftGeo, palette.bootLeather);
  shaft.castShadow = true;
  boot.add(shaft);

  // 5. Close-range LOD0 boot laces & ankle strap buckle
  const laceGroup = new THREE.Group();
  const laceBarGeo = getCachedGeo('boot_lace_bar', () => new THREE.CylinderGeometry(0.006, 0.006, 0.072, 6));
  for (let i = 0; i < 3; i++) {
    const lace = new THREE.Mesh(laceBarGeo, palette.rubberMatte);
    lace.rotation.z = Math.PI / 2;
    lace.position.set(0, -0.035 + i * 0.018, 0.088 - i * 0.012);
    laceGroup.add(lace);
  }
  boot.add(laceGroup);
  lod0Details.push(laceGroup);

  return boot;
}

/**
 * Builds an articulated 3D tactical gloved hand with contoured palm, carbon knuckle plate,
 * 4 separated multi-segment curled fingers, and an opposing thumb.
 */
export function buildSculptedGlovedHand(
  side: -1 | 1,
  palette: CharacterMaterialPalette,
  lod0Details: THREE.Object3D[],
): THREE.Group {
  const hand = new THREE.Group();

  // 1. Rounded gloved palm & wrist cuff
  const palmGeo = getCachedGeo('hand_palm', () => new THREE.SphereGeometry(0.044, 12, 10));
  const palm = new THREE.Mesh(palmGeo, palette.bootLeather);
  palm.scale.set(0.88, 0.62, 1.18);
  palm.castShadow = true;
  hand.add(palm);

  // 2. Molded carbon-fiber dorsal knuckle armor
  const knuckleGeo = getCachedGeo('hand_knuckle', () => new THREE.CylinderGeometry(0.012, 0.012, 0.064, 8));
  const knuckle = new THREE.Mesh(knuckleGeo, palette.rubberMatte);
  knuckle.rotation.z = Math.PI / 2;
  knuckle.position.set(0, 0.022, 0.025);
  hand.add(knuckle);

  // 3. Four separated articulated fingers (LOD0 individual fingers + base grip silhouette)
  const fingerProxGeo = getCachedGeo('finger_prox', () => new THREE.CapsuleGeometry(0.0085, 0.024, 4, 8));
  const fingerDistGeo = getCachedGeo('finger_dist', () => new THREE.CapsuleGeometry(0.0075, 0.020, 4, 8));

  const fingersGroup = new THREE.Group();
  const fingerOffsets = [-0.022, -0.007, 0.008, 0.022];
  const fingerLengths = [0.96, 1.04, 1.0, 0.86];

  for (let f = 0; f < 4; f++) {
    const fx = fingerOffsets[f] * -side;
    const fl = fingerLengths[f];
    const isTriggerFinger = f === 0 && side === 1;

    const prox = new THREE.Mesh(fingerProxGeo, palette.bootLeather);
    prox.scale.setScalar(fl);
    prox.position.set(fx, -0.004, 0.046);
    prox.rotation.x = isTriggerFinger ? 1.15 : 1.48;
    fingersGroup.add(prox);

    const dist = new THREE.Mesh(fingerDistGeo, palette.rubberMatte);
    dist.scale.setScalar(fl);
    dist.position.set(fx, -0.022, isTriggerFinger ? 0.068 : 0.052);
    dist.rotation.x = isTriggerFinger ? 1.55 : 2.35;
    fingersGroup.add(dist);
    lod0Details.push(dist);
  }
  hand.add(fingersGroup);

  // 4. Opposing articulated thumb
  const thumbGeo = getCachedGeo('hand_thumb', () => new THREE.CapsuleGeometry(0.0095, 0.028, 4, 8));
  const thumb = new THREE.Mesh(thumbGeo, palette.bootLeather);
  thumb.position.set(side * 0.032, 0.008, 0.026);
  thumb.rotation.set(1.1, -side * 0.55, side * 0.35);
  hand.add(thumb);

  return hand;
}

/**
 * Builds curved hardshell knee or elbow armor pad with dual elastic retention straps.
 */
export function buildCurvedJointPad(
  radius: number,
  height: number,
  palette: CharacterMaterialPalette,
  lod0Details: THREE.Object3D[],
): THREE.Group {
  const g = new THREE.Group();
  const shellGeo = getCachedGeo(`joint_pad_${radius}_${height}`, () =>
    new THREE.CylinderGeometry(
      radius,
      radius * 0.94,
      height,
      12,
      2,
      false,
      -Math.PI * 0.32,
      Math.PI * 0.64,
    ),
  );
  const shell = new THREE.Mesh(shellGeo, palette.rubberMatte);
  shell.position.set(0, 0, 0.015);
  shell.castShadow = true;
  g.add(shell);

  // Dual elastic wrap-around retention straps
  const strapGeo = getCachedGeo(`joint_strap_${radius}`, () =>
    new THREE.TorusGeometry(radius * 0.96, 0.009, 6, 16),
  );
  for (const sy of [-height * 0.34, height * 0.34]) {
    const strap = new THREE.Mesh(strapGeo, palette.rigCordura);
    strap.rotation.x = Math.PI / 2;
    strap.position.set(0, sy, -0.005);
    g.add(strap);
    lod0Details.push(strap);
  }
  return g;
}

/**
 * Builds the contoured tactical plate carrier vest, MOLLE webbing, magazine pouches,
 * shoulder straps, radio + PTT, assault pack, and variant-specific armor attachments.
 */
export function buildSculptedPlateCarrierAndGear(
  variant: OperatorVariantId,
  palette: CharacterMaterialPalette,
  bodyMat: THREE.MeshStandardMaterial,
  lod0Details: THREE.Object3D[],
  lod1Details: THREE.Object3D[],
): {
  carrierGroup: THREE.Group;
  primaryCarrierMesh: THREE.Mesh;
  antennaMesh: THREE.Mesh;
} {
  const carrierGroup = new THREE.Group();

  // 1. Sculpted ballistic plate carrier shell wrapping the chest and upper back
  const carrierGeo = getCachedGeo('plate_carrier_v2', () =>
    createLoftedProfileGeometry(
      0.45,
      0.52,
      [
        { t: 0.0, rx: 0.228, rz: 0.168, oz: 0.008, foldAmp: 0.003, foldFreq: 8 },
        { t: 0.35, rx: 0.252, rz: 0.188, oz: 0.012, foldAmp: 0.004, foldFreq: 8 },
        { t: 0.72, rx: 0.238, rz: 0.184, oz: 0.010, foldAmp: 0.003, foldFreq: 6 },
        { t: 1.0, rx: 0.175, rz: 0.156, oz: 0.004 },
      ],
      18,
      2,
    ),
  );
  const primaryCarrierMesh = new THREE.Mesh(carrierGeo, palette.rigCordura);
  primaryCarrierMesh.castShadow = true;
  primaryCarrierMesh.receiveShadow = true;
  carrierGroup.add(primaryCarrierMesh);

  // 2. Padded shoulder straps bridging front and back plate bags
  const strapGeo = getCachedGeo('carrier_shoulder_strap', () =>
    new THREE.TorusGeometry(0.145, 0.028, 8, 16, Math.PI * 0.92),
  );
  for (const sx of [-0.155, 0.155]) {
    const strap = new THREE.Mesh(strapGeo, palette.rigCordura);
    strap.rotation.y = Math.PI / 2;
    strap.rotation.x = -0.15;
    strap.position.set(sx, 0.46, -0.005);
    strap.castShadow = true;
    carrierGroup.add(strap);
  }

  // 3. Tactical shirt collar / neck gaiter ring
  const collarGeo = getCachedGeo('tactical_collar', () =>
    new THREE.TorusGeometry(0.102, 0.024, 8, 18),
  );
  const collar = new THREE.Mesh(collarGeo, variant === 3 ? palette.rigCordura : bodyMat);
  collar.rotation.x = Math.PI / 2 + 0.08;
  collar.position.set(0, 0.59, -0.006);
  carrierGroup.add(collar);

  // Variant 3 (Heavy Vanguard): High armored ballistic gorget collar guard
  if (variant === 3) {
    const gorgetGeo = getCachedGeo('heavy_gorget', () =>
      new THREE.CylinderGeometry(0.145, 0.165, 0.095, 16, 1, true, -Math.PI * 0.65, Math.PI * 1.3),
    );
    const gorget = new THREE.Mesh(gorgetGeo, palette.rigCordura);
    gorget.position.set(0, 0.61, 0.01);
    carrierGroup.add(gorget);
  }

  // Variant 0 & 3: Contoured shoulder pauldrons
  if (variant === 0 || variant === 3) {
    const pauldronGeo = getCachedGeo('shoulder_pauldron', () =>
      new THREE.SphereGeometry(0.105, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.52),
    );
    for (const sx of [-0.305, 0.305]) {
      const pauldron = new THREE.Mesh(pauldronGeo, palette.rigCordura);
      pauldron.scale.set(0.85, 1.15, 1.05);
      pauldron.rotation.z = sx < 0 ? 0.68 : -0.68;
      pauldron.position.set(sx, 0.48, 0.01);
      pauldron.castShadow = true;
      carrierGroup.add(pauldron);
      lod1Details.push(pauldron);
    }
  }

  // 4. Three sculpted rifle magazine pouches with polymer mag pulls on front chest
  const pouchGeo = getCachedGeo('mag_pouch_body', () => new THREE.CapsuleGeometry(0.036, 0.085, 6, 10));
  const magTopGeo = getCachedGeo('mag_pouch_top', () => new THREE.CylinderGeometry(0.028, 0.030, 0.045, 8));
  for (const mx of [-0.115, 0, 0.115]) {
    const pouch = new THREE.Mesh(pouchGeo, palette.bootLeather);
    pouch.scale.set(1.0, 1.0, 0.68);
    pouch.position.set(mx, 0.22, 0.188 - Math.abs(mx) * 0.12);
    pouch.rotation.y = -mx * 0.75;
    pouch.castShadow = true;
    carrierGroup.add(pouch);
    lod1Details.push(pouch);

    const magTop = new THREE.Mesh(magTopGeo, palette.gunmetal);
    magTop.scale.set(1.0, 1.0, 0.58);
    magTop.position.set(mx, 0.295, 0.188 - Math.abs(mx) * 0.12);
    magTop.rotation.y = -mx * 0.75;
    carrierGroup.add(magTop);
    lod0Details.push(magTop);
  }

  // 5. Chest radio transceiver, PTT button & tourniquet pouch
  const radioGeo = getCachedGeo('chest_radio', () => new THREE.CapsuleGeometry(0.032, 0.075, 4, 10));
  const radio = new THREE.Mesh(radioGeo, palette.gunmetal);
  radio.scale.set(1.0, 1.0, 0.65);
  radio.position.set(-0.18, 0.41, 0.165);
  radio.rotation.z = 0.12;
  carrierGroup.add(radio);
  lod1Details.push(radio);

  const tourniquetGeo = getCachedGeo('chest_tq', () => new THREE.CapsuleGeometry(0.022, 0.065, 4, 8));
  const tq = new THREE.Mesh(tourniquetGeo, palette.rubberMatte);
  tq.position.set(0.185, 0.39, 0.162);
  tq.rotation.z = -0.18;
  carrierGroup.add(tq);
  lod0Details.push(tq);

  // 6. Sculpted dorsal assault pack + whip antenna
  const packGeo = getCachedGeo('assault_pack_v2', () =>
    createLoftedProfileGeometry(
      0.38,
      0.52,
      [
        { t: 0.0, rx: 0.145, rz: 0.068, oz: -0.21 },
        { t: 0.35, rx: 0.168, rz: 0.088, oz: -0.22, foldAmp: 0.004, foldFreq: 6 },
        { t: 0.78, rx: 0.155, rz: 0.082, oz: -0.215, foldAmp: 0.003, foldFreq: 6 },
        { t: 1.0, rx: 0.115, rz: 0.055, oz: -0.195 },
      ],
      14,
      2,
    ),
  );
  const backpack = new THREE.Mesh(packGeo, palette.rigCordura);
  backpack.castShadow = true;
  carrierGroup.add(backpack);
  lod1Details.push(backpack);

  const antennaGeo = getCachedGeo('whip_antenna', () => new THREE.CylinderGeometry(0.006, 0.011, 0.36, 8));
  const antennaMesh = new THREE.Mesh(antennaGeo, palette.gunmetal);
  antennaMesh.position.set(-0.135, 0.64, -0.22);
  carrierGroup.add(antennaMesh);
  lod0Details.push(antennaMesh);

  return { carrierGroup, primaryCarrierMesh, antennaMesh };
}

/**
 * Builds the tactical MOLLE battle belt, metal Cobra buckle, side dump pouches,
 * and right-thigh drop-leg pistol holster.
 */
export function buildSculptedBattleBeltAndHolster(
  pelvisGroup: THREE.Group,
  hipR: THREE.Group,
  palette: CharacterMaterialPalette,
  lod0Details: THREE.Object3D[],
  lod1Details: THREE.Object3D[],
): void {
  // 1. Contoured battle belt torus around waist
  const beltGeo = getCachedGeo('battle_belt_torus', () =>
    new THREE.CylinderGeometry(0.238, 0.244, 0.085, 18),
  );
  const belt = new THREE.Mesh(beltGeo, palette.rigCordura);
  belt.scale.set(1.0, 1.0, 0.68);
  belt.position.set(0, 0.045, -0.005);
  belt.castShadow = true;
  pelvisGroup.add(belt);

  // Brass/steel tactical Cobra belt buckle at front center
  const buckleGeo = getCachedGeo('belt_buckle', () => new THREE.CylinderGeometry(0.024, 0.024, 0.055, 8));
  const buckle = new THREE.Mesh(buckleGeo, palette.brass);
  buckle.rotation.z = Math.PI / 2;
  buckle.position.set(0, 0.045, 0.162);
  pelvisGroup.add(buckle);
  lod0Details.push(buckle);

  // Left & rear hip utility / dump pouches
  const hipPouchGeo = getCachedGeo('hip_utility_pouch', () => new THREE.CapsuleGeometry(0.042, 0.065, 6, 10));
  for (const [px, pz, ry] of [
    [-0.235, 0.02, Math.PI * 0.45],
    [0.235, -0.02, -Math.PI * 0.45],
    [0.0, -0.168, 0],
  ] as const) {
    const pouch = new THREE.Mesh(hipPouchGeo, palette.bootLeather);
    pouch.scale.set(0.85, 1.0, 0.72);
    pouch.position.set(px, 0.025, pz);
    pouch.rotation.y = ry;
    pelvisGroup.add(pouch);
    lod1Details.push(pouch);
  }

  // Right-thigh Kydex drop-leg pistol holster + retention leg strap
  const holsterGeo = getCachedGeo('drop_leg_holster', () => new THREE.CapsuleGeometry(0.036, 0.11, 6, 10));
  const holster = new THREE.Mesh(holsterGeo, palette.rubberMatte);
  holster.scale.set(0.72, 1.0, 1.05);
  holster.position.set(0.105, -0.145, 0.015);
  holster.rotation.x = -0.12;
  hipR.add(holster);
  lod1Details.push(holster);

  const legStrapGeo = getCachedGeo('holster_leg_strap', () => new THREE.TorusGeometry(0.102, 0.010, 6, 16));
  const legStrap = new THREE.Mesh(legStrapGeo, palette.rigCordura);
  legStrap.rotation.x = Math.PI / 2;
  legStrap.position.set(0, -0.15, 0);
  hipR.add(legStrap);
  lod0Details.push(legStrap);
}

/**
 * Builds the complete sculpted head, neck, facial features (ears, eyes, eyebrows, balaclava mask),
 * high-cut FAST ballistic helmet, comms headset, panoramic visor, and variant headgear.
 */
export function buildSculptedHeadAssembly(
  variant: OperatorVariantId,
  palette: CharacterMaterialPalette,
  helmetMat: THREE.MeshStandardMaterial,
  visorMat: THREE.MeshStandardMaterial,
  lod0Details: THREE.Object3D[],
  lod1Details: THREE.Object3D[],
): {
  headMesh: THREE.Mesh;
  helmetMesh: THREE.Mesh;
  visorMesh: THREE.Mesh;
  extraHeadVisuals: THREE.Object3D[];
} {
  const extraHeadVisuals: THREE.Object3D[] = [];

  // 1. Sculpted anatomical head mesh (clickable headshot collider + smooth facial topology)
  const headGeo = getAnatomicalHeadGeometry();
  const headMesh = new THREE.Mesh(headGeo, palette.skin);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;

  // 2. Sculpted anatomical neck cylinder connecting head cleanly down into collar
  const neckGeo = getCachedGeo('sculpted_neck_v2', () =>
    createLoftedProfileGeometry(
      0.13,
      -0.09,
      [
        { t: 0.0, rx: 0.072, rz: 0.076, oz: -0.012 },
        { t: 0.5, rx: 0.064, rz: 0.068, oz: -0.008 },
        { t: 1.0, rx: 0.068, rz: 0.072, oz: -0.005 },
      ],
      14,
      1,
    ),
  );
  const neck = new THREE.Mesh(neckGeo, palette.skin);
  neck.castShadow = true;
  headMesh.add(neck);
  extraHeadVisuals.push(neck);

  // 3. Fitted lower-face tactical half-balaclava / respirator mask covering jaw & mouth
  const maskGeo = getCachedGeo('balaclava_mask_v2', () => {
    const g = new THREE.SphereGeometry(0.159, 18, 12, 0, Math.PI * 2, Math.PI * 0.46, Math.PI * 0.54);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      y *= 1.12;
      x *= 0.86;
      if (z > 0) {
        const noseTip = Math.exp(-Math.pow(x * 16, 2)) * Math.max(0, 1 - Math.abs(y + 0.02) * 14);
        z += noseTip * 0.022;
      }
      pos.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  });
  const mask = new THREE.Mesh(maskGeo, palette.balaclava);
  headMesh.add(mask);
  extraHeadVisuals.push(mask);

  // 4. 3D Sculpted external ears, eyeballs, irises & eyebrows (LOD0 close-up facial realism)
  const facialGroup = new THREE.Group();
  const earGeo = getCachedGeo('human_ear', () => new THREE.SphereGeometry(0.028, 10, 8));
  const eyeBallGeo = getCachedGeo('human_eyeball', () => new THREE.SphereGeometry(0.019, 10, 8));
  const irisGeo = getCachedGeo('human_iris', () => new THREE.SphereGeometry(0.010, 8, 6));
  const browGeo = getCachedGeo('human_brow', () => new THREE.CapsuleGeometry(0.006, 0.032, 4, 6));

  for (const sgn of [-1, 1]) {
    // External ear
    const ear = new THREE.Mesh(earGeo, palette.skin);
    ear.scale.set(0.45, 1.25, 0.78);
    ear.position.set(sgn * 0.148, 0.005, -0.012);
    ear.rotation.y = sgn * 0.22;
    facialGroup.add(ear);

    // Eyeball + dark iris
    const eye = new THREE.Mesh(eyeBallGeo, palette.eyeWhite);
    eye.position.set(sgn * 0.052, 0.022, 0.135);
    facialGroup.add(eye);

    const iris = new THREE.Mesh(irisGeo, palette.eyeIris);
    iris.position.set(sgn * 0.052, 0.022, 0.147);
    facialGroup.add(iris);

    // Sculpted eyebrow ridge
    const brow = new THREE.Mesh(browGeo, palette.balaclava);
    brow.rotation.z = Math.PI / 2 - sgn * 0.12;
    brow.position.set(sgn * 0.054, 0.048, 0.148);
    facialGroup.add(brow);
  }
  headMesh.add(facialGroup);
  lod0Details.push(facialGroup);
  extraHeadVisuals.push(facialGroup);

  // 5. High-Cut FAST Ballistic Helmet Dome + ARC Side Rails + NVG Shroud + Comms Headset
  const helmetGeo = getBallisticHelmetGeometry();
  const helmetMesh = new THREE.Mesh(helmetGeo, helmetMat);
  helmetMesh.position.set(0, 0.025, -0.005);
  helmetMesh.castShadow = true;
  helmetMesh.receiveShadow = true;

  // Front CNC aluminum NVG mount shroud
  const shroudGeo = getCachedGeo('nvg_shroud', () => new THREE.CylinderGeometry(0.032, 0.038, 0.052, 6));
  const nvgShroud = new THREE.Mesh(shroudGeo, palette.gunmetal);
  nvgShroud.scale.set(1.0, 1.0, 0.35);
  nvgShroud.position.set(0, 0.105, 0.184);
  nvgShroud.rotation.x = -0.26;
  helmetMesh.add(nvgShroud);

  // Side ARC tactical rails + Peltor Comms Ear-Cups + Boom Microphone
  const railGeo = getCachedGeo('helmet_arc_rail', () => new THREE.CapsuleGeometry(0.012, 0.095, 4, 8));
  const earCupGeo = getCachedGeo('comms_earcup', () => new THREE.SphereGeometry(0.048, 12, 10));
  for (const sgn of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, palette.rigCordura);
    rail.rotation.x = Math.PI / 2 - 0.18;
    rail.position.set(sgn * 0.172, 0.045, 0.015);
    helmetMesh.add(rail);
    lod1Details.push(rail);

    const earCup = new THREE.Mesh(earCupGeo, palette.rigCordura);
    earCup.scale.set(0.46, 1.15, 0.88);
    earCup.position.set(sgn * 0.162, -0.022, -0.012);
    helmetMesh.add(earCup);
  }

  // Rear helmet counterweight battery pack
  const batteryGeo = getCachedGeo('helmet_battery', () => new THREE.CapsuleGeometry(0.024, 0.068, 4, 8));
  const battery = new THREE.Mesh(batteryGeo, palette.rigCordura);
  battery.rotation.z = Math.PI / 2;
  battery.position.set(0, 0.025, -0.188);
  helmetMesh.add(battery);
  lod1Details.push(battery);

  // Variant 1 (Recon Spec-Ops): Quad-Tube Panoramic Night Vision Goggles (GPNVG-18) tilted up on brow
  if (variant === 1) {
    const nvgGroup = new THREE.Group();
    nvgGroup.position.set(0, 0.115, 0.215);
    nvgGroup.rotation.x = -0.35;
    const bridgeGeo = getCachedGeo('nvg_bridge', () => new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8));
    const bridge = new THREE.Mesh(bridgeGeo, palette.gunmetal);
    bridge.rotation.z = Math.PI / 2;
    nvgGroup.add(bridge);

    const tubeGeo = getCachedGeo('nvg_tube', () => new THREE.CylinderGeometry(0.016, 0.018, 0.068, 10));
    const lensGeo = getCachedGeo('nvg_lens_cap', () => new THREE.CircleGeometry(0.015, 10));
    for (const tx of [-0.056, -0.020, 0.020, 0.056]) {
      const tube = new THREE.Mesh(tubeGeo, palette.rubberMatte);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(tx, -0.018, 0.025);
      nvgGroup.add(tube);

      const lens = new THREE.Mesh(lensGeo, palette.nvgLens);
      lens.position.set(tx, -0.018, 0.060);
      nvgGroup.add(lens);
    }
    helmetMesh.add(nvgGroup);
    lod1Details.push(nvgGroup);
  }

  // Variant 3 (Heavy Vanguard): Armored ballistic mandible jaw shield
  if (variant === 3) {
    const mandibleGeo = getCachedGeo('helmet_mandible', () =>
      new THREE.CylinderGeometry(0.166, 0.148, 0.078, 16, 1, true, -Math.PI * 0.42, Math.PI * 0.84),
    );
    const mandible = new THREE.Mesh(mandibleGeo, helmetMat);
    mandible.position.set(0, -0.088, 0.015);
    helmetMesh.add(mandible);
    lod1Details.push(mandible);
  }

  // 6. Panoramic wrap-around ballistic visor / goggles with rubberized seal frame
  const visorGeo = getPanoramicVisorGeometry();
  const visorMesh = new THREE.Mesh(visorGeo, visorMat);
  visorMesh.position.set(0, 0.022, 0.018);

  const frameGeo = getCachedGeo('visor_frame_rim', () =>
    new THREE.TorusGeometry(0.155, 0.010, 6, 18, Math.PI * 0.68),
  );
  const topRim = new THREE.Mesh(frameGeo, palette.rubberMatte);
  topRim.rotation.x = Math.PI / 2;
  topRim.rotation.z = Math.PI * 0.16;
  topRim.position.set(0, 0.038, -0.012);
  visorMesh.add(topRim);
  lod0Details.push(topRim);

  return { headMesh, helmetMesh, visorMesh, extraHeadVisuals };
}
