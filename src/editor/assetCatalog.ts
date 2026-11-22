import * as THREE from 'three';
import { createPBRSurface } from '../game/textures';
import {
  CollisionSettings,
  GameplayProperties,
  LightProperties,
  MapObject,
  MaterialOverride,
  ObjectCategory,
  PrefabDef,
} from './types';

export interface LocalColliderBox {
  center: [number, number, number];
  size: [number, number, number];
  walkableTop?: boolean;
}

export interface AssetDefinition {
  id: string;
  name: string;
  browserCategory: 'Geometry' | 'Architecture' | 'Ground' | 'Environment' | 'Industrial' | 'Urban' | 'Interior' | 'Lighting' | 'Gameplay';
  objectCategory: ObjectCategory;
  description: string;
  defaultScale: [number, number, number];
  defaultCollision: CollisionSettings;
  defaultMaterial: MaterialOverride;
  defaultLight?: LightProperties;
  defaultGameplay?: GameplayProperties;
  /** Bounds size at scale [1,1,1] with bottom at y=0 */
  boundsSize: [number, number, number];
  localColliders: LocalColliderBox[];
  isRamp?: boolean;
  isStairs?: boolean;
  tags: string[];
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
const basicMatCache = new Map<string, THREE.MeshBasicMaterial>();

function matKey(m: MaterialOverride): string {
  return `${m.kind}|${m.color}|${m.roughness.toFixed(2)}|${m.metalness.toFixed(2)}|${m.normalScale.toFixed(2)}|${m.emissive}|${m.emissiveIntensity.toFixed(2)}|${m.textureScaleX}|${m.textureScaleY}|${m.opacity ?? 1}`;
}

export function getCachedStandardMaterial(override: MaterialOverride): THREE.MeshStandardMaterial {
  const key = matKey(override);
  const existing = matCache.get(key);
  if (existing) return existing;

  const isTransparent = override.opacity !== undefined && override.opacity < 0.99;
  const opts: THREE.MeshStandardMaterialParameters = {
    color: override.color,
    roughness: override.roughness,
    metalness: override.metalness,
    emissive: new THREE.Color(override.emissive || '#000000'),
    emissiveIntensity: override.emissiveIntensity || 0,
    transparent: isTransparent,
    opacity: override.opacity ?? 1,
  };

  if (typeof document !== 'undefined') {
    const pbr = createPBRSurface(
      override.kind,
      '#ffffff',
      Math.max(1, override.textureScaleX || 1),
      Math.max(1, override.textureScaleY || 1),
    );
    opts.map = pbr.map;
    opts.normalMap = pbr.normalMap;
    opts.normalScale = new THREE.Vector2(override.normalScale, override.normalScale);
    opts.bumpMap = pbr.bumpMap;
    opts.bumpScale = 0.03;
    opts.roughnessMap = pbr.roughnessMap;
  }

  const mat = new THREE.MeshStandardMaterial(opts);
  matCache.set(key, mat);
  return mat;
}

function getBasicMat(color: string, opacity = 0.85): THREE.MeshBasicMaterial {
  const k = `${color}_${opacity}`;
  let m = basicMatCache.get(k);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    });
    basicMatCache.set(k, m);
  }
  return m;
}

const DEF_CONCRETE: MaterialOverride = { kind: 'concrete', color: '#64748b', roughness: 0.84, metalness: 0.06, normalScale: 0.85, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 };
const DEF_WALL_SOLID: MaterialOverride = { kind: 'concrete', color: '#475569', roughness: 0.82, metalness: 0.08, normalScale: 0.9, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 };
const DEF_WOOD_CRATE: MaterialOverride = { kind: 'crate', color: '#a16227', roughness: 0.84, metalness: 0.03, normalScale: 0.9, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 1, textureScaleY: 1 };
const DEF_PLYWOOD: MaterialOverride = { kind: 'plywood', color: '#b78953', roughness: 0.82, metalness: 0.02, normalScale: 0.8, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 };
const DEF_METAL: MaterialOverride = { kind: 'gunmetal', color: '#475569', roughness: 0.42, metalness: 0.82, normalScale: 0.7, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 };
const DEF_PAINTED_BLUE: MaterialOverride = { kind: 'painted_metal', color: '#1d4ed8', roughness: 0.52, metalness: 0.45, normalScale: 0.8, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 1 };
const DEF_ASPHALT: MaterialOverride = { kind: 'asphalt', color: '#2b303a', roughness: 0.9, metalness: 0.04, normalScale: 0.9, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 3, textureScaleY: 3 };
const DEF_STONE: MaterialOverride = { kind: 'stone', color: '#78716c', roughness: 0.88, metalness: 0.04, normalScale: 0.95, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 };
const DEF_GLASS: MaterialOverride = { kind: 'glass', color: '#93c5fd', roughness: 0.1, metalness: 0.15, normalScale: 0.25, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 1, textureScaleY: 1, opacity: 0.38 };

function boxDef(
  id: string,
  name: string,
  browserCategory: AssetDefinition['browserCategory'],
  objectCategory: ObjectCategory,
  size: [number, number, number],
  material: MaterialOverride,
  opts?: Partial<AssetDefinition>,
): AssetDefinition {
  const [w, h, d] = size;
  return {
    id,
    name,
    browserCategory,
    objectCategory,
    description: opts?.description || `${name} (${w}x${h}x${d}m)`,
    defaultScale: [1, 1, 1],
    defaultCollision: opts?.defaultCollision || { enabled: true, wallType: 'solid', walkableTop: h <= 1.5 },
    defaultMaterial: material,
    boundsSize: size,
    localColliders: opts?.localColliders || [{ center: [0, h * 0.5, 0], size: [w, h, d], walkableTop: (opts?.defaultCollision?.walkableTop ?? (h <= 1.5)) }],
    tags: opts?.tags || [name.toLowerCase(), browserCategory.toLowerCase()],
    ...opts,
  };
}

export const ASSET_CATALOG: AssetDefinition[] = [
  // ================= GEOMETRY PRIMITIVES =================
  boxDef('prim_cube', 'Cube', 'Geometry', 'geometry', [2, 2, 2], DEF_CONCRETE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('prim_cuboid', 'Cuboid', 'Geometry', 'geometry', [4, 2, 2], DEF_CONCRETE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('prim_crate', 'Supply Crate', 'Geometry', 'geometry', [1.8, 1.8, 1.8], DEF_WOOD_CRATE, { defaultCollision: { enabled: true, wallType: 'crate', walkableTop: true }, tags: ['crate', 'cover', 'wood'] }),
  boxDef('prim_sphere', 'Sphere', 'Geometry', 'geometry', [2, 2, 2], DEF_CONCRETE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false } }),
  boxDef('prim_cylinder', 'Cylinder Pillar', 'Geometry', 'geometry', [1.6, 3.0, 1.6], DEF_CONCRETE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('prim_cone', 'Cone', 'Geometry', 'geometry', [2, 2.5, 2], DEF_CONCRETE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false } }),
  boxDef('prim_plane', 'Thin Panel (Wallbang)', 'Geometry', 'geometry', [3.6, 2.8, 0.28], DEF_PLYWOOD, { defaultCollision: { enabled: true, wallType: 'thin', walkableTop: false }, tags: ['wallbang', 'plywood', 'thin'] }),
  boxDef('prim_stairs', 'Stair Block', 'Geometry', 'geometry', [2.4, 2.0, 4.0], DEF_CONCRETE, { isStairs: true, defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true }, tags: ['stairs', 'climb'] }),
  boxDef('prim_ramp', 'Sloped Ramp', 'Geometry', 'geometry', [2.6, 2.0, 4.5], DEF_CONCRETE, { isRamp: true, defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true }, tags: ['ramp', 'slope'] }),

  // ================= MODULAR ARCHITECTURE =================
  boxDef('mod_wall', 'Modular Wall (4m)', 'Architecture', 'buildings', [4.0, 3.5, 0.4], DEF_WALL_SOLID, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false } }),
  boxDef('mod_wall_half', 'Half Barrier Wall', 'Architecture', 'buildings', [4.0, 1.35, 0.4], DEF_WALL_SOLID, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false } }),
  boxDef('mod_wall_window', 'Window Wall', 'Architecture', 'buildings', [4.0, 3.5, 0.4], DEF_WALL_SOLID, {
    description: 'Wall with open window frame (4x3.5x0.4m)',
    defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false },
    localColliders: [
      { center: [0, 0.6, 0], size: [4.0, 1.2, 0.4], walkableTop: false },
      { center: [0, 3.05, 0], size: [4.0, 0.9, 0.4], walkableTop: false },
      { center: [-1.45, 1.9, 0], size: [1.1, 1.4, 0.4], walkableTop: false },
      { center: [1.45, 1.9, 0], size: [1.1, 1.4, 0.4], walkableTop: false },
    ],
  }),
  boxDef('mod_wall_doorway', 'Doorway Wall', 'Architecture', 'buildings', [4.0, 3.5, 0.4], DEF_WALL_SOLID, {
    description: 'Walkable open doorway arch (1.8m wide opening)',
    defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false },
    localColliders: [
      { center: [-1.45, 1.75, 0], size: [1.1, 3.5, 0.4], walkableTop: false },
      { center: [1.45, 1.75, 0], size: [1.1, 3.5, 0.4], walkableTop: false },
      { center: [0, 3.05, 0], size: [1.8, 0.9, 0.4], walkableTop: false },
    ],
  }),
  boxDef('mod_floor', 'Floor Section (4x4m)', 'Architecture', 'buildings', [4.0, 0.28, 4.0], DEF_CONCRETE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('mod_ceiling', 'Ceiling Slab (4x4m)', 'Architecture', 'buildings', [4.0, 0.28, 4.0], DEF_CONCRETE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('mod_corner_pillar', 'Corner Column', 'Architecture', 'buildings', [0.6, 3.5, 0.6], DEF_METAL, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false } }),
  boxDef('mod_pillar', 'Architectural Pillar', 'Architecture', 'buildings', [0.85, 3.8, 0.85], DEF_STONE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false } }),
  boxDef('mod_door', 'Door Panel', 'Architecture', 'buildings', [1.5, 2.5, 0.14], DEF_PLYWOOD, { defaultCollision: { enabled: true, wallType: 'thin', walkableTop: false } }),
  boxDef('mod_window_frame', 'Glass Window Pane', 'Architecture', 'buildings', [1.8, 1.4, 0.12], DEF_GLASS, { defaultCollision: { enabled: true, wallType: 'thin', walkableTop: false } }),
  boxDef('mod_roof_flat', 'Flat Roof Section', 'Architecture', 'buildings', [4.2, 0.36, 4.2], DEF_WALL_SOLID, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('mod_roof_pitched', 'Pitched Roof Section', 'Architecture', 'buildings', [4.4, 1.8, 4.4], DEF_STONE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false } }),
  boxDef('mod_stairs', 'Building Staircase', 'Architecture', 'buildings', [2.4, 3.5, 4.8], DEF_CONCRETE, { isStairs: true, defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('mod_railing', 'Safety Railing', 'Architecture', 'buildings', [4.0, 1.1, 0.18], DEF_METAL, { defaultCollision: { enabled: true, wallType: 'thin', walkableTop: false } }),
  boxDef('mod_platform', 'Elevated Platform', 'Architecture', 'buildings', [4.5, 0.45, 4.5], DEF_METAL, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('mod_trim', 'Cornice / Trim Beam', 'Architecture', 'buildings', [4.0, 0.35, 0.45], DEF_STONE, { defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false } }),

  // ================= GROUND MODULES =================
  boxDef('gnd_asphalt', 'Asphalt Road Slab', 'Ground', 'geometry', [6, 0.18, 6], DEF_ASPHALT, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('gnd_concrete', 'Concrete Pad', 'Ground', 'geometry', [6, 0.2, 6], DEF_CONCRETE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('gnd_sidewalk', 'Sidewalk Section', 'Ground', 'geometry', [4, 0.22, 6], { ...DEF_STONE, color: '#94a3b8' }, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('gnd_pavement', 'Tiled Pavement', 'Ground', 'geometry', [4, 0.16, 4], { kind: 'tile', color: '#64748b', roughness: 0.78, metalness: 0.05, normalScale: 0.85, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 3, textureScaleY: 3 }, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('gnd_stone', 'Cobblestone Pad', 'Ground', 'geometry', [4, 0.2, 4], DEF_STONE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('gnd_industrial', 'Industrial Grating', 'Ground', 'geometry', [4, 0.2, 4], { ...DEF_METAL, color: '#3b424d' }, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('gnd_metal_platform', 'Metal Catwalk Deck', 'Ground', 'geometry', [3, 0.25, 6], DEF_METAL, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('gnd_steps', 'Wide Street Steps', 'Ground', 'geometry', [4.0, 1.0, 2.4], DEF_STONE, { isStairs: true, defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('gnd_curb', 'Chamfered Street Curb', 'Ground', 'geometry', [4.0, 0.24, 0.4], { ...DEF_STONE, color: '#9ca3af' }, { defaultCollision: { enabled: false, wallType: 'solid', walkableTop: true } }),
  boxDef('gnd_drainage', 'Drainage Grate Channel', 'Ground', 'geometry', [4.0, 0.12, 0.7], DEF_METAL, { defaultCollision: { enabled: false, wallType: 'solid', walkableTop: true } }),

  // ================= ENVIRONMENT =================
  boxDef('env_pine', 'Alpine Pine Tree', 'Environment', 'environment', [2.2, 6.2, 2.2], { kind: 'dirt', color: '#1e4d2b', roughness: 0.9, metalness: 0.02, normalScale: 0.7, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 1, textureScaleY: 1 }, {
    defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false },
    localColliders: [{ center: [0, 1.8, 0], size: [0.6, 3.6, 0.6], walkableTop: false }],
  }),
  boxDef('env_tree', 'Oak Broadleaf Tree', 'Environment', 'environment', [3.2, 5.8, 3.2], { kind: 'dirt', color: '#2f6b33', roughness: 0.9, metalness: 0.02, normalScale: 0.7, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 1, textureScaleY: 1 }, {
    defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false },
    localColliders: [{ center: [0, 1.8, 0], size: [0.65, 3.6, 0.65], walkableTop: false }],
  }),
  boxDef('env_rock', 'Boulder Rock', 'Environment', 'environment', [2.4, 1.7, 2.2], DEF_STONE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('env_shrub', 'Dense Hedge / Plant', 'Environment', 'environment', [1.8, 1.1, 1.4], { kind: 'dirt', color: '#2d5a2e', roughness: 0.95, metalness: 0.01, normalScale: 0.6, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 1, textureScaleY: 1 }, { defaultCollision: { enabled: false, wallType: 'thin', walkableTop: false } }),
  boxDef('env_planter', 'Concrete Planter Box', 'Environment', 'environment', [2.6, 0.9, 1.4], DEF_CONCRETE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('env_bollard', 'Steel Street Bollard', 'Environment', 'environment', [0.35, 1.0, 0.35], { ...DEF_METAL, color: '#facc15' }, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false } }),

  // ================= INDUSTRIAL =================
  boxDef('ind_container', 'Shipping Container (20ft)', 'Industrial', 'props', [6.0, 2.7, 2.5], DEF_PAINTED_BLUE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true }, tags: ['container', 'cargo', 'metal'] }),
  boxDef('ind_pipes', 'Industrial Pipe Rack', 'Industrial', 'props', [4.5, 2.2, 0.9], DEF_METAL, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false } }),
  boxDef('ind_generator', 'Power Generator', 'Industrial', 'props', [2.8, 1.9, 1.5], { ...DEF_PAINTED_BLUE, color: '#b45309' }, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('ind_elec_box', 'Electrical Switchboard', 'Industrial', 'props', [1.2, 2.0, 0.6], DEF_METAL, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false } }),
  boxDef('ind_vent', 'HVAC Ventilation Unit', 'Industrial', 'props', [2.2, 1.4, 1.6], { ...DEF_METAL, color: '#94a3b8' }, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('ind_catwalk', 'Metal Catwalk Bridge', 'Industrial', 'props', [2.2, 0.4, 5.0], DEF_METAL, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),

  // ================= URBAN =================
  boxDef('urb_vehicle', 'Utility Van', 'Urban', 'props', [2.1, 2.0, 4.6], { ...DEF_PAINTED_BLUE, color: '#e2e8f0' }, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false }, tags: ['car', 'van', 'vehicle'] }),
  boxDef('urb_bench', 'Park / Street Bench', 'Urban', 'props', [2.0, 0.9, 0.7], DEF_PLYWOOD, { defaultCollision: { enabled: true, wallType: 'thin', walkableTop: true } }),
  boxDef('urb_sign', 'Street / Tactical Sign', 'Urban', 'props', [0.9, 2.6, 0.25], DEF_METAL, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false } }),
  boxDef('urb_barrier', 'Jersey Concrete Barrier', 'Urban', 'props', [2.8, 1.05, 0.7], DEF_CONCRETE, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),
  boxDef('urb_lamp', 'Street Lamp Post', 'Urban', 'props', [0.7, 5.2, 1.2], DEF_METAL, {
    defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false },
    localColliders: [{ center: [0, 2.4, 0], size: [0.35, 4.8, 0.35], walkableTop: false }],
  }),
  boxDef('urb_dumpster', 'Steel Dumpster', 'Urban', 'props', [2.2, 1.4, 1.5], { ...DEF_PAINTED_BLUE, color: '#166534' }, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),

  // ================= INTERIOR =================
  boxDef('int_table', 'Wooden Table', 'Interior', 'props', [2.0, 0.85, 1.1], DEF_PLYWOOD, { defaultCollision: { enabled: true, wallType: 'thin', walkableTop: true } }),
  boxDef('int_chair', 'Office Chair', 'Interior', 'props', [0.65, 1.05, 0.65], { ...DEF_METAL, color: '#1e293b' }, { defaultCollision: { enabled: false, wallType: 'thin', walkableTop: false } }),
  boxDef('int_shelf', 'Storage Rack Shelf', 'Interior', 'props', [2.2, 2.4, 0.75], DEF_METAL, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false } }),
  boxDef('int_server_rack', 'Server Rack Cabinet', 'Interior', 'props', [1.0, 2.3, 1.0], { ...DEF_METAL, color: '#0f172a', emissive: '#22d3ee', emissiveIntensity: 0.35 }, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: false } }),
  boxDef('int_desk', 'Terminal / Command Desk', 'Interior', 'props', [2.2, 1.1, 1.0], DEF_METAL, { defaultCollision: { enabled: true, wallType: 'solid', walkableTop: true } }),

  // ================= LIGHTING =================
  {
    id: 'light_point',
    name: 'Point Light',
    browserCategory: 'Lighting',
    objectCategory: 'lighting',
    description: 'Omnidirectional light emitter.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false },
    defaultMaterial: DEF_METAL,
    defaultLight: { lightType: 'point', color: '#fff3c4', intensity: 14, range: 24, angleDeg: 45, penumbra: 0.4, castShadow: false, decay: 1.5 },
    boundsSize: [0.8, 0.8, 0.8],
    localColliders: [],
    tags: ['light', 'point', 'lamp'],
  },
  {
    id: 'light_spot',
    name: 'Spotlight',
    browserCategory: 'Lighting',
    objectCategory: 'lighting',
    description: 'Focused cone spotlight for hallways and key areas.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false },
    defaultMaterial: DEF_METAL,
    defaultLight: { lightType: 'spot', color: '#fde68a', intensity: 22, range: 32, angleDeg: 42, penumbra: 0.45, castShadow: false, decay: 1.4 },
    boundsSize: [0.9, 0.9, 0.9],
    localColliders: [],
    tags: ['light', 'spot', 'cone'],
  },
  {
    id: 'light_directional',
    name: 'Directional Light',
    browserCategory: 'Lighting',
    objectCategory: 'lighting',
    description: 'Secondary directional fill or moonlight.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false },
    defaultMaterial: DEF_METAL,
    defaultLight: { lightType: 'directional', color: '#93c5fd', intensity: 0.65, range: 60, angleDeg: 45, penumbra: 0.5, castShadow: false, decay: 1 },
    boundsSize: [1.0, 1.0, 1.0],
    localColliders: [],
    tags: ['light', 'directional', 'sun'],
  },
  {
    id: 'light_area',
    name: 'Area Fill Light',
    browserCategory: 'Lighting',
    objectCategory: 'lighting',
    description: 'Soft wide fill light for large interiors.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false },
    defaultMaterial: DEF_METAL,
    defaultLight: { lightType: 'area', color: '#e0f2fe', intensity: 12, range: 26, angleDeg: 80, penumbra: 0.7, castShadow: false, decay: 1.2 },
    boundsSize: [1.4, 0.4, 1.4],
    localColliders: [],
    tags: ['light', 'area', 'fill'],
  },

  // ================= GAMEPLAY =================
  {
    id: 'gp_spawn_attacker',
    name: 'Attacker / Player Spawn',
    browserCategory: 'Gameplay',
    objectCategory: 'spawns',
    description: 'Attacker (S&D) or Player spawn point.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
    defaultMaterial: { ...DEF_METAL, color: '#ef4444', emissive: '#ef4444', emissiveIntensity: 0.6 },
    defaultGameplay: { role: 'spawn_attacker', team: 'attackers', label: 'Attacker Spawn' },
    boundsSize: [1.0, 1.9, 1.0],
    localColliders: [],
    tags: ['spawn', 'attacker', 'player'],
  },
  {
    id: 'gp_spawn_defender',
    name: 'Defender / Bot Spawn',
    browserCategory: 'Gameplay',
    objectCategory: 'spawns',
    description: 'Defender (S&D) or Enemy/Bot spawn point.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
    defaultMaterial: { ...DEF_METAL, color: '#38bdf8', emissive: '#38bdf8', emissiveIntensity: 0.6 },
    defaultGameplay: { role: 'spawn_defender', team: 'defenders', label: 'Defender Spawn' },
    boundsSize: [1.0, 1.9, 1.0],
    localColliders: [],
    tags: ['spawn', 'defender', 'bot'],
  },
  {
    id: 'gp_spawn_team_zone',
    name: 'Team Spawn Zone',
    browserCategory: 'Gameplay',
    objectCategory: 'spawns',
    description: 'Area spawn zone for a team.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
    defaultMaterial: { ...DEF_METAL, color: '#818cf8', emissive: '#6366f1', emissiveIntensity: 0.4 },
    defaultGameplay: { role: 'spawn_team_zone', team: 'teamA', radius: 4, label: 'Team Spawn Zone' },
    boundsSize: [4, 0.5, 4],
    localColliders: [],
    tags: ['spawn', 'zone', 'team'],
  },
  {
    id: 'gp_spawn_ffa',
    name: 'FFA Spawn Point',
    browserCategory: 'Gameplay',
    objectCategory: 'spawns',
    description: 'Free-for-All / Deathmatch spawn point.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
    defaultMaterial: { ...DEF_METAL, color: '#22c55e', emissive: '#22c55e', emissiveIntensity: 0.6 },
    defaultGameplay: { role: 'spawn_ffa', team: 'ffa', label: 'FFA Spawn' },
    boundsSize: [1.0, 1.9, 1.0],
    localColliders: [],
    tags: ['spawn', 'ffa', 'dm'],
  },
  {
    id: 'gp_site_a',
    name: 'Objective Site A',
    browserCategory: 'Gameplay',
    objectCategory: 'objectives',
    description: 'Bombsite A / Primary Defense Objective with plant radius.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
    defaultMaterial: { ...DEF_METAL, color: '#facc15', emissive: '#facc15', emissiveIntensity: 0.7 },
    defaultGameplay: { role: 'site_a', site: 'A', radius: 4.5, label: 'SITE A' },
    boundsSize: [9, 0.5, 9],
    localColliders: [],
    tags: ['site a', 'bomb', 'objective', 'snd', 'defend'],
  },
  {
    id: 'gp_site_b',
    name: 'Objective Site B',
    browserCategory: 'Gameplay',
    objectCategory: 'objectives',
    description: 'Bombsite B for Search & Destroy.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
    defaultMaterial: { ...DEF_METAL, color: '#f97316', emissive: '#f97316', emissiveIntensity: 0.7 },
    defaultGameplay: { role: 'site_b', site: 'B', radius: 4.5, label: 'SITE B' },
    boundsSize: [9, 0.5, 9],
    localColliders: [],
    tags: ['site b', 'bomb', 'objective', 'snd'],
  },
  {
    id: 'gp_capture_point',
    name: 'Capture Point',
    browserCategory: 'Gameplay',
    objectCategory: 'objectives',
    description: 'Capture / Control objective zone.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
    defaultMaterial: { ...DEF_METAL, color: '#06b6d4', emissive: '#06b6d4', emissiveIntensity: 0.6 },
    defaultGameplay: { role: 'capture_point', radius: 5, label: 'CAPTURE' },
    boundsSize: [10, 0.5, 10],
    localColliders: [],
    tags: ['capture', 'objective'],
  },
  {
    id: 'gp_hardpoint',
    name: 'Hardpoint Zone',
    browserCategory: 'Gameplay',
    objectCategory: 'objectives',
    description: 'Hardpoint control zone.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
    defaultMaterial: { ...DEF_METAL, color: '#a855f7', emissive: '#a855f7', emissiveIntensity: 0.6 },
    defaultGameplay: { role: 'hardpoint', radius: 5, label: 'HARDPOINT' },
    boundsSize: [10, 0.5, 10],
    localColliders: [],
    tags: ['hardpoint', 'objective'],
  },
  {
    id: 'gp_boundary',
    name: 'Map Boundary Marker',
    browserCategory: 'Gameplay',
    objectCategory: 'zones',
    description: 'Custom playable boundary volume.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
    defaultMaterial: { ...DEF_METAL, color: '#f43f5e', emissive: '#f43f5e', emissiveIntensity: 0.4 },
    defaultGameplay: { role: 'map_boundary', radius: 6, height: 8, label: 'BOUNDARY' },
    boundsSize: [6, 4, 6],
    localColliders: [],
    tags: ['boundary', 'zone'],
  },
  {
    id: 'gp_spectator_boundary',
    name: 'Spectator Boundary',
    browserCategory: 'Gameplay',
    objectCategory: 'zones',
    description: 'Marks allowed free-cam spectator limit.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
    defaultMaterial: { ...DEF_METAL, color: '#94a3b8', emissive: '#64748b', emissiveIntensity: 0.3 },
    defaultGameplay: { role: 'spectator_boundary', radius: 8, height: 12, label: 'SPEC ZONE' },
    boundsSize: [8, 6, 8],
    localColliders: [],
    tags: ['spectator', 'boundary'],
  },
  {
    id: 'gp_interaction_zone',
    name: 'Interaction Zone',
    browserCategory: 'Gameplay',
    objectCategory: 'zones',
    description: 'Validates plant / interact / buy trigger zone.',
    defaultScale: [1, 1, 1],
    defaultCollision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
    defaultMaterial: { ...DEF_METAL, color: '#10b981', emissive: '#10b981', emissiveIntensity: 0.5 },
    defaultGameplay: { role: 'interaction_zone', radius: 4, height: 3, label: 'INTERACT' },
    boundsSize: [8, 3, 8],
    localColliders: [],
    tags: ['interaction', 'zone', 'trigger'],
  },
];

const ASSET_MAP = new Map<string, AssetDefinition>(ASSET_CATALOG.map((a) => [a.id, a]));

export const KNOWN_ASSET_IDS: string[] = ASSET_CATALOG.map((a) => a.id);

export function getAssetDefinition(assetId: string): AssetDefinition | undefined {
  return ASSET_MAP.get(assetId);
}

function addPart(
  parent: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  wallType?: string,
  collidable = true,
  castShadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  if (collidable) {
    m.userData = { isWall: true, wallType: wallType || 'solid' };
  }
  parent.add(m);
  return m;
}

function createWedgeGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  // Slope ascends along -Z (front z=+d/2 at y=0 up to back z=-d/2 at y=h)
  const hw = w * 0.5;
  const hd = d * 0.5;
  const positions = new Float32Array([
    // Bottom face
    -hw, 0, -hd,  hw, 0, -hd,  hw, 0, hd,
    -hw, 0, -hd,  hw, 0, hd,  -hw, 0, hd,
    // Back vertical face (z = -hd)
    -hw, 0, -hd, -hw, h, -hd,  hw, h, -hd,
    -hw, 0, -hd,  hw, h, -hd,  hw, 0, -hd,
    // Top sloped face
    -hw, h, -hd, -hw, 0, hd,   hw, 0, hd,
    -hw, h, -hd,  hw, 0, hd,   hw, h, -hd,
    // Left side triangle
    -hw, 0, -hd, -hw, 0, hd,  -hw, h, -hd,
    // Right side triangle
     hw, 0, -hd,  hw, h, -hd,  hw, 0, hd,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  // Planar UVs so PBR normal/diffuse maps tile nicely
  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let i = 0; i < positions.length / 3; i++) {
    uvs[i * 2] = positions[i * 3] / Math.max(1, w) + 0.5;
    uvs[i * 2 + 1] = positions[i * 3 + 2] / Math.max(1, d) + 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geo;
}

function createPitchedRoofGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const hw = w * 0.5;
  const hd = d * 0.5;
  const positions = new Float32Array([
    // Left slope
    -hw, 0, -hd, -hw, 0, hd, 0, h, hd,
    -hw, 0, -hd, 0, h, hd, 0, h, -hd,
    // Right slope
    hw, 0, hd, hw, 0, -hd, 0, h, -hd,
    hw, 0, hd, 0, h, -hd, 0, h, hd,
    // Front gable
    -hw, 0, hd, hw, 0, hd, 0, h, hd,
    // Back gable
    hw, 0, -hd, -hw, 0, -hd, 0, h, -hd,
    // Bottom
    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd,
    -hw, 0, -hd, hw, 0, hd, -hw, 0, hd,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

export function buildAssetMesh(obj: MapObject, forEditor: boolean): THREE.Group {
  const def = getAssetDefinition(obj.assetId);
  const group = new THREE.Group();
  group.name = obj.name;
  group.position.set(obj.position[0], obj.position[1], obj.position[2]);
  group.rotation.set(
    THREE.MathUtils.degToRad(obj.rotation[0]),
    THREE.MathUtils.degToRad(obj.rotation[1]),
    THREE.MathUtils.degToRad(obj.rotation[2]),
  );
  group.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
  group.visible = obj.visible;

  const matSpec = obj.material || def?.defaultMaterial || DEF_CONCRETE;
  const mainMat = getCachedStandardMaterial(matSpec);
  const darkMetal = getCachedStandardMaterial({ ...DEF_METAL, color: '#1e293b' });
  const glassMat = getCachedStandardMaterial(DEF_GLASS);
  const wallType = obj.collision?.wallType || def?.defaultCollision.wallType || 'solid';
  const colEnabled = obj.collision?.enabled ?? true;
  const id = obj.assetId;

  if (!def) {
    // Unknown asset fallback indicator
    addPart(group, new THREE.BoxGeometry(1, 1, 1), getBasicMat('#ef4444', 0.8), 0, 0.5, 0, wallType, false, false);
  } else if (id === 'prim_sphere') {
    addPart(group, new THREE.SphereGeometry(1, 20, 16), mainMat, 0, 1, 0, wallType, colEnabled);
  } else if (id === 'prim_cylinder' || id === 'mod_pillar') {
    const [w, h] = def.boundsSize;
    addPart(group, new THREE.CylinderGeometry(w * 0.45, w * 0.5, h, 16), mainMat, 0, h * 0.5, 0, wallType, colEnabled);
  } else if (id === 'prim_cone') {
    addPart(group, new THREE.ConeGeometry(1, 2.5, 16), mainMat, 0, 1.25, 0, wallType, colEnabled);
  } else if (id === 'prim_ramp') {
    const [w, h, d] = def.boundsSize;
    addPart(group, createWedgeGeometry(w, h, d), mainMat, 0, 0, 0, wallType, colEnabled);
  } else if (id === 'prim_stairs' || id === 'mod_stairs' || id === 'gnd_steps') {
    const [w, h, d] = def.boundsSize;
    const steps = id === 'gnd_steps' ? 4 : 8;
    const stepH = h / steps;
    const stepD = d / steps;
    for (let i = 0; i < steps; i++) {
      const sh = stepH * (i + 1);
      const sz = d * 0.5 - stepD * (i + 0.5);
      addPart(group, new THREE.BoxGeometry(w, sh, stepD + 0.02), mainMat, 0, sh * 0.5, sz, wallType, colEnabled);
    }
  } else if (id === 'mod_wall_doorway') {
    addPart(group, new THREE.BoxGeometry(1.1, 3.5, 0.4), mainMat, -1.45, 1.75, 0, wallType, colEnabled);
    addPart(group, new THREE.BoxGeometry(1.1, 3.5, 0.4), mainMat, 1.45, 1.75, 0, wallType, colEnabled);
    addPart(group, new THREE.BoxGeometry(1.8, 0.9, 0.4), mainMat, 0, 3.05, 0, wallType, colEnabled);
    addPart(group, new THREE.BoxGeometry(0.1, 2.6, 0.46), darkMetal, -0.88, 1.3, 0, wallType, false, false);
    addPart(group, new THREE.BoxGeometry(0.1, 2.6, 0.46), darkMetal, 0.88, 1.3, 0, wallType, false, false);
  } else if (id === 'mod_wall_window') {
    addPart(group, new THREE.BoxGeometry(4.0, 1.2, 0.4), mainMat, 0, 0.6, 0, wallType, colEnabled);
    addPart(group, new THREE.BoxGeometry(4.0, 0.9, 0.4), mainMat, 0, 3.05, 0, wallType, colEnabled);
    addPart(group, new THREE.BoxGeometry(1.1, 1.4, 0.4), mainMat, -1.45, 1.9, 0, wallType, colEnabled);
    addPart(group, new THREE.BoxGeometry(1.1, 1.4, 0.4), mainMat, 1.45, 1.9, 0, wallType, colEnabled);
    addPart(group, new THREE.BoxGeometry(1.8, 1.4, 0.08), glassMat, 0, 1.9, 0, wallType, false, false);
  } else if (id === 'mod_roof_pitched') {
    const [w, h, d] = def.boundsSize;
    addPart(group, createPitchedRoofGeometry(w, h, d), mainMat, 0, 0, 0, wallType, colEnabled);
  } else if (id === 'mod_railing') {
    addPart(group, new THREE.BoxGeometry(4.0, 0.08, 0.08), mainMat, 0, 1.05, 0, wallType, colEnabled);
    addPart(group, new THREE.BoxGeometry(4.0, 0.06, 0.06), mainMat, 0, 0.55, 0, wallType, colEnabled);
    for (const px of [-1.9, -0.95, 0, 0.95, 1.9]) {
      addPart(group, new THREE.BoxGeometry(0.08, 1.08, 0.08), mainMat, px, 0.54, 0, wallType, false);
    }
  } else if (id === 'env_pine') {
    const trunkMat = getCachedStandardMaterial({ ...DEF_WOOD_CRATE, color: '#5c3a21' });
    addPart(group, new THREE.CylinderGeometry(0.18, 0.28, 2.2, 10), trunkMat, 0, 1.1, 0, wallType, colEnabled);
    addPart(group, new THREE.ConeGeometry(1.3, 2.3, 10), mainMat, 0, 3.0, 0, wallType, false);
    addPart(group, new THREE.ConeGeometry(0.95, 1.9, 10), mainMat, 0, 4.3, 0, wallType, false);
    addPart(group, new THREE.ConeGeometry(0.6, 1.5, 10), mainMat, 0, 5.4, 0, wallType, false);
  } else if (id === 'env_tree') {
    const trunkMat = getCachedStandardMaterial({ ...DEF_WOOD_CRATE, color: '#5c3a21' });
    addPart(group, new THREE.CylinderGeometry(0.22, 0.34, 2.7, 10), trunkMat, 0, 1.35, 0, wallType, colEnabled);
    addPart(group, new THREE.DodecahedronGeometry(1.5, 1), mainMat, 0, 3.9, 0, wallType, false);
    addPart(group, new THREE.DodecahedronGeometry(1.05, 1), mainMat, 0.65, 4.5, 0.4, wallType, false);
  } else if (id === 'env_rock') {
    addPart(group, new THREE.DodecahedronGeometry(1.05, 0), mainMat, 0, 0.82, 0, wallType, colEnabled);
  } else if (id === 'env_shrub') {
    addPart(group, new THREE.DodecahedronGeometry(0.65, 1), mainMat, 0, 0.55, 0, wallType, colEnabled);
    addPart(group, new THREE.DodecahedronGeometry(0.48, 1), mainMat, 0.5, 0.42, 0.2, wallType, false);
  } else if (id === 'ind_container') {
    addPart(group, new THREE.BoxGeometry(6.0, 2.7, 2.5), mainMat, 0, 1.35, 0, wallType, colEnabled);
    for (let x = -2.4; x <= 2.4; x += 0.6) {
      addPart(group, new THREE.BoxGeometry(0.12, 2.5, 2.56), mainMat, x, 1.35, 0, wallType, false);
    }
  } else if (id === 'ind_pipes') {
    addPart(group, new THREE.CylinderGeometry(0.22, 0.22, 4.5, 12), mainMat, 0, 1.5, -0.2, wallType, colEnabled);
    group.children[group.children.length - 1].rotation.z = Math.PI * 0.5;
    addPart(group, new THREE.CylinderGeometry(0.16, 0.16, 4.5, 12), mainMat, 0, 1.0, 0.2, wallType, colEnabled);
    group.children[group.children.length - 1].rotation.z = Math.PI * 0.5;
    addPart(group, new THREE.BoxGeometry(0.3, 2.0, 0.8), darkMetal, -1.8, 1.0, 0, wallType, false);
    addPart(group, new THREE.BoxGeometry(0.3, 2.0, 0.8), darkMetal, 1.8, 1.0, 0, wallType, false);
  } else if (id === 'urb_vehicle') {
    const tireMat = getCachedStandardMaterial({ ...DEF_METAL, color: '#0f172a', roughness: 0.9, metalness: 0.1 });
    addPart(group, new THREE.BoxGeometry(2.05, 1.25, 4.5), mainMat, 0, 0.92, 0, wallType, colEnabled);
    addPart(group, new THREE.BoxGeometry(1.9, 0.65, 2.3), mainMat, 0, 1.75, -0.45, wallType, colEnabled);
    addPart(group, new THREE.BoxGeometry(1.85, 0.52, 0.1), glassMat, 0, 1.75, 0.72, wallType, false);
    for (const [wx, wz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
      const wheel = addPart(group, new THREE.CylinderGeometry(0.38, 0.38, 0.26, 12), tireMat, wx, 0.38, wz, wallType, false);
      wheel.rotation.z = Math.PI * 0.5;
    }
  } else if (id === 'urb_lamp') {
    addPart(group, new THREE.CylinderGeometry(0.12, 0.16, 5.0, 10), mainMat, 0, 2.5, 0, wallType, colEnabled);
    addPart(group, new THREE.BoxGeometry(0.24, 0.2, 1.1), mainMat, 0, 5.0, 0.45, wallType, false);
    const bulbMat = getCachedStandardMaterial({ ...DEF_METAL, color: '#fef08a', emissive: '#fef08a', emissiveIntensity: 1.4 });
    addPart(group, new THREE.BoxGeometry(0.32, 0.1, 0.55), bulbMat, 0, 4.86, 0.82, wallType, false, false);
  } else if (id === 'int_table' || id === 'int_desk') {
    const [w, h, d] = def.boundsSize;
    addPart(group, new THREE.BoxGeometry(w, 0.1, d), mainMat, 0, h - 0.05, 0, wallType, colEnabled);
    for (const [lx, lz] of [[-w * 0.42, -d * 0.4], [w * 0.42, -d * 0.4], [-w * 0.42, d * 0.4], [w * 0.42, d * 0.4]]) {
      addPart(group, new THREE.BoxGeometry(0.1, h - 0.1, 0.1), darkMetal, lx, (h - 0.1) * 0.5, lz, wallType, false);
    }
  } else if (def.objectCategory === 'lighting') {
    const lp = obj.lightProps || def.defaultLight!;
    if (forEditor) {
      const bulb = addPart(group, new THREE.SphereGeometry(0.28, 12, 12), getBasicMat(lp.color, 0.95), 0, 0, 0, undefined, false, false);
      bulb.userData.isEditorOnly = true;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.46, 20), getBasicMat(lp.color, 0.65));
      ring.rotation.x = -Math.PI * 0.5;
      group.add(ring);
      if (lp.lightType === 'spot' || lp.lightType === 'directional') {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.75, 12, 1, true), getBasicMat(lp.color, 0.35));
        cone.rotation.x = Math.PI * 0.5;
        cone.position.z = 0.55;
        group.add(cone);
      }
    }
    // Note: actual THREE.Light instances are created during viewport lighting sync or runtime build
  } else if (def.objectCategory === 'spawns' || def.objectCategory === 'objectives' || def.objectCategory === 'zones') {
    const gp = obj.gameplayProps || def.defaultGameplay!;
    const color =
      gp.role === 'spawn_attacker' ? '#ef4444' :
      gp.role === 'spawn_defender' ? '#38bdf8' :
      gp.role === 'spawn_ffa' ? '#22c55e' :
      gp.role === 'site_a' ? '#facc15' :
      gp.role === 'site_b' ? '#f97316' :
      gp.role === 'capture_point' ? '#06b6d4' :
      gp.role === 'hardpoint' ? '#a855f7' :
      gp.role === 'interaction_zone' ? '#10b981' : '#f43f5e';
    if (forEditor) {
      const isSpawn = gp.role.startsWith('spawn');
      if (isSpawn) {
        const radius = gp.radius || 0.7;
        addPart(group, new THREE.CylinderGeometry(radius, radius, 0.08, 18), getBasicMat(color, 0.55), 0, 0.04, 0, undefined, false, false);
        addPart(group, new THREE.CylinderGeometry(0.26, 0.3, 1.5, 12), getBasicMat(color, 0.45), 0, 0.8, 0, undefined, false, false);
        addPart(group, new THREE.ConeGeometry(0.22, 0.5, 8), getBasicMat('#ffffff', 0.9), 0, 1.15, 0.45, undefined, false, false);
        group.children[group.children.length - 1].rotation.x = Math.PI * 0.5;
      } else {
        const rad = gp.radius || 4.5;
        const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.4, rad - 0.3), rad, 36), getBasicMat(color, 0.78));
        ring.rotation.x = -Math.PI * 0.5;
        ring.position.y = 0.05;
        group.add(ring);
        addPart(group, new THREE.CylinderGeometry(0.25, 0.25, 1.2, 12), getBasicMat(color, 0.85), 0, 0.6, 0, undefined, false, false);
      }
    }
  } else {
    // Standard box-based geometry / wall / container / crate / floor / ground
    const [w, h, d] = def.boundsSize;
    addPart(group, new THREE.BoxGeometry(w, h, d), mainMat, 0, h * 0.5, 0, wallType, colEnabled);
  }

  group.traverse((child) => {
    child.userData.mapObjectId = obj.id;
  });
  return group;
}

export function buildPrefabPreviewGroup(prefab: PrefabDef, forEditor = true): THREE.Group {
  const root = new THREE.Group();
  root.name = prefab.name;
  for (let i = 0; i < prefab.items.length; i++) {
    const item = prefab.items[i];
    const tmpObj: MapObject = {
      ...item,
      id: `preview_${prefab.id}_${i}`,
    };
    root.add(buildAssetMesh(tmpObj, forEditor));
  }
  return root;
}
