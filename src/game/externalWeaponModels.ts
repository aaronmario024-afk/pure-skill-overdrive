import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CamoPatternId, WeaponSkin } from '../data/skins';
import { applyCamoShader, getCamoMaterialSpec, getCamoTextureSetForChannel } from './camoTextures';

export const EXTERNAL_WEAPON_GLB: Partial<Record<string, string>> = {
  pistol: '/models/pistol_glock17.glb',
  smg: '/models/smg_mp9.glb',
  shotgun: '/models/shotgun_benellim4.glb',
  ssg: '/models/ssg_cheytac.glb',
  rifle: '/models/rifle_ak47.glb',
  sniper: '/models/sniper_awp.glb',
  m4: '/models/m4_m4a1.glb',
  knife: '/models/knife_tactical.glb',
};

export interface ExternalWeaponClone {
  frame?: THREE.Object3D;
  slide?: THREE.Object3D;
  magazine?: THREE.Object3D;
  trigger?: THREE.Object3D;
  chargingHandle?: THREE.Object3D;
  blade?: THREE.Object3D;
  dispose: () => void;
}

type PartRole = 'frame' | 'slide' | 'magazine' | 'trigger' | 'chargingHandle' | 'blade';

const SCULPTURAL_CAMOS = new Set<CamoPatternId>([
  'diamond',
  'obsidian',
  'polyatomic',
  'ice',
  'snake_skin',
  'gold',
  'damascus',
]);

const cachedScenes = new Map<string, Promise<THREE.Group | null>>();

/**
 * Computes seamless object-space triplanar coordinates on UV channel 1 (`uv1`)
 * while preserving the GLB model's original baked atlas UVs on channel 0 (`uv`).
 */
export function ensureTriplanarUv1(geo: THREE.BufferGeometry, scale: number): void {
  if (geo.getAttribute('uv1')) return;
  const pos = geo.getAttribute('position');
  if (!pos) return;
  let norm = geo.getAttribute('normal');
  if (!norm) {
    geo.computeVertexNormals();
    norm = geo.getAttribute('normal');
  }

  const uv1 = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const ax = norm ? Math.abs(norm.getX(i)) : 1;
    const ay = norm ? Math.abs(norm.getY(i)) : 0;
    const az = norm ? Math.abs(norm.getZ(i)) : 0;

    if (ax >= ay && ax >= az) {
      uv1[i * 2] = -vz * scale;
      uv1[i * 2 + 1] = vy * scale;
    } else if (ay >= ax && ay >= az) {
      uv1[i * 2] = -vz * scale;
      uv1[i * 2 + 1] = vx * scale;
    } else {
      uv1[i * 2] = vx * scale;
      uv1[i * 2 + 1] = vy * scale;
    }
  }
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
}

function loadExternalScene(weaponId: string): Promise<THREE.Group | null> {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }
  const url = EXTERNAL_WEAPON_GLB[weaponId];
  if (!url) {
    return Promise.resolve(null);
  }
  let pending = cachedScenes.get(weaponId);
  if (!pending) {
    const loader = new GLTFLoader();
    const uvScale = weaponId === 'pistol' || weaponId === 'knife' ? 6.2 : 4.2;
    pending = loader
      .loadAsync(url)
      .then((gltf) => {
        gltf.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh && mesh.geometry) {
            ensureTriplanarUv1(mesh.geometry, uvScale);
          }
        });
        return gltf.scene;
      })
      .catch((err) => {
        console.warn(`[externalWeaponModels] Failed to load ${url}:`, err);
        return null;
      });
    cachedScenes.set(weaponId, pending);
  }
  return pending;
}

/** Preloads selected external GLB weapon assets once in the browser so first equip swaps smoothly. */
export function preloadExternalWeaponModels(weaponIds: string[] = ['pistol']): void {
  if (typeof window === 'undefined') return;
  for (const weaponId of weaponIds) {
    if (EXTERNAL_WEAPON_GLB[weaponId]) {
      void loadExternalScene(weaponId);
    }
  }
}

function buildCamoMaterialForPart(
  origStd: THREE.MeshStandardMaterial,
  role: PartRole,
  skin: WeaponSkin,
): THREE.MeshPhysicalMaterial {
  const camoMaps = getCamoTextureSetForChannel(skin.pattern, 1);
  const spec = getCamoMaterialSpec(skin.pattern);
  const useCamoNormal = SCULPTURAL_CAMOS.has(skin.pattern) || !origStd.normalMap;

  const hasBakedEmissive = Boolean(origStd.emissiveMap);
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    map: camoMaps.map,
    normalMap: useCamoNormal ? camoMaps.normalMap : origStd.normalMap,
    normalScale: new THREE.Vector2(
      useCamoNormal ? spec.normalScale : Math.max(0.75, spec.normalScale),
      useCamoNormal ? spec.normalScale : Math.max(0.75, spec.normalScale),
    ),
    roughnessMap: camoMaps.roughnessMap,
    roughness: spec.roughness,
    metalness: spec.metalness,
    clearcoat: spec.clearcoat,
    clearcoatRoughness: spec.clearcoatRoughness,
    aoMap: origStd.aoMap ?? null,
    aoMapIntensity: origStd.aoMap ? 0.85 : 0,
    emissive: hasBakedEmissive ? new THREE.Color('#ffffff') : new THREE.Color(0x000000),
    emissiveMap: origStd.emissiveMap ?? null,
    emissiveIntensity: 1.0,
    envMapIntensity: role === 'blade' ? Math.max(spec.envMapIntensity, 1.75) : spec.envMapIntensity,
    side: origStd.side,
  });

  applyCamoShader(mat, skin.pattern);
  return mat;
}

function clonePartNode(
  src: THREE.Object3D,
  clonedMats: THREE.Material[],
  weaponId: string,
  role: PartRole,
  skin?: WeaponSkin,
): THREE.Object3D {
  const clone = src.clone(true);
  const isContrastHardware =
    role === 'trigger' ||
    role === 'chargingHandle' ||
    (role === 'slide' && (weaponId === 'rifle' || weaponId === 'shotgun' || weaponId === 'sniper'));

  clone.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;

    const srcMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const nextMats = srcMats.map((rawMat) => {
      if (!rawMat) return rawMat;
      const isSecondaryMat = /12gauge|bulet|camo|scope|matchsaverz/i.test(rawMat.name);
      const isStd = (rawMat as THREE.MeshStandardMaterial).isMeshStandardMaterial;

      if (skin && isStd && !isSecondaryMat && !isContrastHardware) {
        const camoMat = buildCamoMaterialForPart(rawMat as THREE.MeshStandardMaterial, role, skin);
        clonedMats.push(camoMat);
        return camoMat;
      }

      const mat = rawMat.clone();
      clonedMats.push(mat);
      if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        (mat as THREE.MeshStandardMaterial).envMapIntensity = role === 'blade' ? 1.85 : 1.15;
      }
      return mat;
    });

    mesh.material = Array.isArray(mesh.material) ? nextMats : nextMats[0];
  });
  return clone;
}

/**
 * Clones the cached external GLB parts for a weapon with per-instance material styling.
 * Shared geometries, baked GLB textures, and shared camo textures remain cached across equips.
 */
export async function buildExternalWeaponParts(
  weaponId: string,
  skin?: WeaponSkin,
): Promise<ExternalWeaponClone | null> {
  const scene = await loadExternalScene(weaponId);
  if (!scene) return null;

  const frameSrc = scene.getObjectByName('Frame');
  const slideSrc = scene.getObjectByName('Slide');
  const magazineSrc = scene.getObjectByName('Magazine');
  const triggerSrc = scene.getObjectByName('Trigger');
  const chSrc = scene.getObjectByName('ChargingHandle');
  const bladeSrc = scene.getObjectByName('Blade');

  if (!frameSrc && !slideSrc && !magazineSrc && !triggerSrc && !chSrc && !bladeSrc) {
    console.warn(`[externalWeaponModels] No recognized nodes in ${weaponId} GLB`);
    return null;
  }

  const clonedMats: THREE.Material[] = [];

  return {
    frame: frameSrc ? clonePartNode(frameSrc, clonedMats, weaponId, 'frame', skin) : undefined,
    slide: slideSrc ? clonePartNode(slideSrc, clonedMats, weaponId, 'slide', skin) : undefined,
    magazine: magazineSrc ? clonePartNode(magazineSrc, clonedMats, weaponId, 'magazine', skin) : undefined,
    trigger: triggerSrc ? clonePartNode(triggerSrc, clonedMats, weaponId, 'trigger', skin) : undefined,
    chargingHandle: chSrc ? clonePartNode(chSrc, clonedMats, weaponId, 'chargingHandle', skin) : undefined,
    blade: bladeSrc ? clonePartNode(bladeSrc, clonedMats, weaponId, 'blade', skin) : undefined,
    dispose: () => {
      for (const m of clonedMats) m.dispose();
    },
  };
}
