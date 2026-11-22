import { ModeId } from '../data/modes';
import {
  CUSTOM_MAP_FORMAT_VERSION,
  CustomMapDocument,
  EnvironmentPresetId,
  GroundTypeId,
  LightingConfig,
  LightingPresetId,
  MapObject,
  MaterialOverride,
  MaterialPreset,
  NewMapOptions,
  ObjectCategory,
} from './types';

export function deepClone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val)) as T;
}

export function slugifyMapId(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return cleaned || `custom_map_${Date.now().toString(36)}`;
}

let seqCounter = 1;
export function createUniqueId(prefix = 'obj'): string {
  seqCounter = (seqCounter + 1) % 100000;
  return `${prefix}_${Date.now().toString(36)}_${seqCounter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export const LIGHTING_PRESETS: Record<LightingPresetId, { label: string; config: LightingConfig }> = {
  daylight: {
    label: 'Daylight',
    config: {
      preset: 'daylight',
      skyColor: '#4da6e8',
      fogColor: '#9fd0f2',
      fogDensity: 0.006,
      hemiSky: '#f8fafc',
      hemiGround: '#334155',
      hemiIntensity: 0.85,
      sunColor: '#fff5df',
      sunIntensity: 1.35,
      sunAzimuthDeg: 38,
      sunElevationDeg: 54,
      sunCastShadow: true,
      ambientColor: '#dbeafe',
      ambientIntensity: 0.22,
    },
  },
  sunset: {
    label: 'Sunset',
    config: {
      preset: 'sunset',
      skyColor: '#ea7b4f',
      fogColor: '#f4a261',
      fogDensity: 0.009,
      hemiSky: '#fed7aa',
      hemiGround: '#292524',
      hemiIntensity: 0.68,
      sunColor: '#ffb703',
      sunIntensity: 1.25,
      sunAzimuthDeg: 72,
      sunElevationDeg: 18,
      sunCastShadow: true,
      ambientColor: '#fca5a5',
      ambientIntensity: 0.25,
    },
  },
  night: {
    label: 'Night',
    config: {
      preset: 'night',
      skyColor: '#070b18',
      fogColor: '#0f172a',
      fogDensity: 0.015,
      hemiSky: '#3b82f6',
      hemiGround: '#090d16',
      hemiIntensity: 0.42,
      sunColor: '#93c5fd',
      sunIntensity: 0.62,
      sunAzimuthDeg: -35,
      sunElevationDeg: 42,
      sunCastShadow: true,
      ambientColor: '#1e293b',
      ambientIntensity: 0.3,
    },
  },
  overcast: {
    label: 'Overcast',
    config: {
      preset: 'overcast',
      skyColor: '#7b8fa3',
      fogColor: '#94a3b8',
      fogDensity: 0.011,
      hemiSky: '#cbd5e1',
      hemiGround: '#334155',
      hemiIntensity: 0.95,
      sunColor: '#e2e8f0',
      sunIntensity: 0.65,
      sunAzimuthDeg: 25,
      sunElevationDeg: 62,
      sunCastShadow: true,
      ambientColor: '#cbd5e1',
      ambientIntensity: 0.34,
    },
  },
  industrial_interior: {
    label: 'Industrial Interior',
    config: {
      preset: 'industrial_interior',
      skyColor: '#181c22',
      fogColor: '#1f2937',
      fogDensity: 0.014,
      hemiSky: '#94a3b8',
      hemiGround: '#111827',
      hemiIntensity: 0.55,
      sunColor: '#fde68a',
      sunIntensity: 0.85,
      sunAzimuthDeg: 12,
      sunElevationDeg: 76,
      sunCastShadow: true,
      ambientColor: '#475569',
      ambientIntensity: 0.32,
    },
  },
  cold: {
    label: 'Cold Environment',
    config: {
      preset: 'cold',
      skyColor: '#88b9dc',
      fogColor: '#bae6fd',
      fogDensity: 0.01,
      hemiSky: '#e0f2fe',
      hemiGround: '#1e3a5f',
      hemiIntensity: 0.9,
      sunColor: '#e0f2fe',
      sunIntensity: 1.15,
      sunAzimuthDeg: 48,
      sunElevationDeg: 38,
      sunCastShadow: true,
      ambientColor: '#bae6fd',
      ambientIntensity: 0.28,
    },
  },
};

export const GROUND_MATERIAL_PRESETS: Record<GroundTypeId, { label: string; material: MaterialOverride }> = {
  asphalt: {
    label: 'Asphalt',
    material: { kind: 'asphalt', color: '#2b303a', roughness: 0.88, metalness: 0.05, normalScale: 0.9, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 16, textureScaleY: 16 },
  },
  concrete: {
    label: 'Concrete',
    material: { kind: 'concrete', color: '#64748b', roughness: 0.84, metalness: 0.05, normalScale: 0.85, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 14, textureScaleY: 14 },
  },
  sidewalk: {
    label: 'Sidewalk',
    material: { kind: 'stone', color: '#8f98a3', roughness: 0.82, metalness: 0.04, normalScale: 0.8, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 18, textureScaleY: 18 },
  },
  pavement: {
    label: 'Pavement',
    material: { kind: 'tile', color: '#586370', roughness: 0.78, metalness: 0.06, normalScale: 0.85, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 16, textureScaleY: 16 },
  },
  stone: {
    label: 'Stone',
    material: { kind: 'stone', color: '#78716c', roughness: 0.9, metalness: 0.04, normalScale: 1.0, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 14, textureScaleY: 14 },
  },
  industrial: {
    label: 'Industrial Floor',
    material: { kind: 'concrete', color: '#3b424d', roughness: 0.74, metalness: 0.2, normalScale: 0.8, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 16, textureScaleY: 16 },
  },
  metal_platform: {
    label: 'Metal Platform',
    material: { kind: 'painted_metal', color: '#475569', roughness: 0.48, metalness: 0.68, normalScale: 0.75, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 14, textureScaleY: 14 },
  },
  dirt: {
    label: 'Dirt',
    material: { kind: 'dirt', color: '#6f553e', roughness: 0.94, metalness: 0.02, normalScale: 0.95, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 16, textureScaleY: 16 },
  },
  sand: {
    label: 'Sand',
    material: { kind: 'sandstone', color: '#d4b483', roughness: 0.92, metalness: 0.02, normalScale: 0.9, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 16, textureScaleY: 16 },
  },
  snow: {
    label: 'Snow',
    material: { kind: 'snow', color: '#dce8f5', roughness: 0.86, metalness: 0.04, normalScale: 0.7, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 16, textureScaleY: 16 },
  },
  grass: {
    label: 'Forest Floor / Grass',
    material: { kind: 'dirt', color: '#3d5a3b', roughness: 0.94, metalness: 0.02, normalScale: 0.9, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 18, textureScaleY: 18 },
  },
  none: {
    label: 'None (Void / Custom)',
    material: { kind: 'cyber', color: '#111827', roughness: 0.85, metalness: 0.1, normalScale: 0.5, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 8, textureScaleY: 8 },
  },
};

export const DEFAULT_MATERIAL_LIBRARY: MaterialPreset[] = [
  { id: 'mat_concrete_gray', name: 'Tactical Concrete', category: 'Concrete', material: { kind: 'concrete', color: '#64748b', roughness: 0.84, metalness: 0.06, normalScale: 0.85, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 } },
  { id: 'mat_concrete_light', name: 'Clean Architectural Concrete', category: 'Concrete', material: { kind: 'concrete', color: '#cbd5e1', roughness: 0.78, metalness: 0.04, normalScale: 0.75, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 } },
  { id: 'mat_concrete_dark', name: 'Bunker Reinforced Concrete', category: 'Concrete', material: { kind: 'concrete', color: '#334155', roughness: 0.88, metalness: 0.08, normalScale: 0.95, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 } },
  { id: 'mat_asphalt_road', name: 'Street Asphalt', category: 'Asphalt', material: { kind: 'asphalt', color: '#262b34', roughness: 0.9, metalness: 0.04, normalScale: 0.9, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 4, textureScaleY: 4 } },
  { id: 'mat_asphalt_wet', name: 'Night Wet Asphalt', category: 'Asphalt', material: { kind: 'asphalt', color: '#1b2029', roughness: 0.42, metalness: 0.14, normalScale: 0.8, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 4, textureScaleY: 4 } },
  { id: 'mat_metal_steel', name: 'Structural Steel', category: 'Metal', material: { kind: 'gunmetal', color: '#475569', roughness: 0.42, metalness: 0.82, normalScale: 0.7, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 } },
  { id: 'mat_metal_red', name: 'Painted Industrial Red', category: 'Metal', material: { kind: 'painted_metal', color: '#991b1b', roughness: 0.52, metalness: 0.45, normalScale: 0.75, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 } },
  { id: 'mat_metal_blue', name: 'Shipping Container Blue', category: 'Metal', material: { kind: 'painted_metal', color: '#1d4ed8', roughness: 0.54, metalness: 0.42, normalScale: 0.8, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 } },
  { id: 'mat_metal_neon', name: 'Cyber Neon Trim', category: 'Metal', material: { kind: 'cyber', color: '#1e1b4b', roughness: 0.35, metalness: 0.65, normalScale: 0.8, emissive: '#22d3ee', emissiveIntensity: 0.75, textureScaleX: 2, textureScaleY: 2 } },
  { id: 'mat_wood_plywood', name: 'Plywood Sheet', category: 'Wood', material: { kind: 'plywood', color: '#b78953', roughness: 0.82, metalness: 0.02, normalScale: 0.8, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 } },
  { id: 'mat_wood_crate', name: 'Cargo Crate Timber', category: 'Wood', material: { kind: 'crate', color: '#9a5b25', roughness: 0.84, metalness: 0.03, normalScale: 0.9, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 1, textureScaleY: 1 } },
  { id: 'mat_glass_clear', name: 'Tempered Window Glass', category: 'Glass', material: { kind: 'glass', color: '#93c5fd', roughness: 0.1, metalness: 0.15, normalScale: 0.25, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 1, textureScaleY: 1, opacity: 0.38 } },
  { id: 'mat_plastic_matte', name: 'Molded Safety Plastic', category: 'Plastic', material: { kind: 'rubber', color: '#ea580c', roughness: 0.58, metalness: 0.04, normalScale: 0.4, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 } },
  { id: 'mat_plastic_tactical', name: 'Polymer Case Black', category: 'Plastic', material: { kind: 'rubber', color: '#1e293b', roughness: 0.52, metalness: 0.08, normalScale: 0.45, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 } },
  { id: 'mat_fabric_tarp', name: 'Canvas Tarp Olive', category: 'Fabric', material: { kind: 'fabric', color: '#4d5e3b', roughness: 0.9, metalness: 0.02, normalScale: 0.75, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 3, textureScaleY: 3 } },
  { id: 'mat_fabric_kevlar', name: 'Ballistic Weave', category: 'Fabric', material: { kind: 'kevlar', color: '#334155', roughness: 0.85, metalness: 0.05, normalScale: 0.85, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 3, textureScaleY: 3 } },
  { id: 'mat_stone_brick', name: 'Masonry Brick', category: 'Stone', material: { kind: 'brick', color: '#8f4738', roughness: 0.86, metalness: 0.03, normalScale: 1.0, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 } },
  { id: 'mat_stone_sand', name: 'Desert Sandstone', category: 'Stone', material: { kind: 'sandstone', color: '#c8a572', roughness: 0.88, metalness: 0.02, normalScale: 0.95, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 } },
  { id: 'mat_stone_granite', name: 'Natural Granite', category: 'Stone', material: { kind: 'stone', color: '#6b7280', roughness: 0.9, metalness: 0.04, normalScale: 0.95, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 } },
  { id: 'mat_dirt_packed', name: 'Packed Earth', category: 'Dirt', material: { kind: 'dirt', color: '#6b4f39', roughness: 0.95, metalness: 0.02, normalScale: 0.9, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 3, textureScaleY: 3 } },
  { id: 'mat_snow_packed', name: 'Packed Alpine Snow', category: 'Snow', material: { kind: 'snow', color: '#e2edf8', roughness: 0.84, metalness: 0.04, normalScale: 0.65, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 3, textureScaleY: 3 } },
  { id: 'mat_snow_ice', name: 'Glacial Ice', category: 'Snow', material: { kind: 'ice', color: '#bae6fd', roughness: 0.25, metalness: 0.14, normalScale: 0.6, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 } },
];

export interface EnvironmentPresetInfo {
  id: EnvironmentPresetId;
  label: string;
  description: string;
  defaultGround: GroundTypeId;
  defaultLighting: LightingPresetId;
  accent: string;
}

export const ENVIRONMENT_PRESETS: EnvironmentPresetInfo[] = [
  { id: 'urban', label: 'Urban', description: 'City courtyard with sidewalks, storefronts, crates & vehicles.', defaultGround: 'asphalt', defaultLighting: 'daylight', accent: '#38bdf8' },
  { id: 'industrial', label: 'Industrial', description: 'Factory yard with shipping containers, pipes & catwalks.', defaultGround: 'industrial', defaultLighting: 'industrial_interior', accent: '#f59e0b' },
  { id: 'military', label: 'Military', description: 'Fortified compound with bunkers, sandbag barriers & watch platform.', defaultGround: 'concrete', defaultLighting: 'overcast', accent: '#84cc16' },
  { id: 'desert', label: 'Desert', description: 'Sandstone ruins, elevated arches & sun-baked dunes.', defaultGround: 'sand', defaultLighting: 'sunset', accent: '#eab308' },
  { id: 'snow', label: 'Snow', description: 'Alpine outpost with snowdrifts, glacial cover & cold air.', defaultGround: 'snow', defaultLighting: 'cold', accent: '#7dd3fc' },
  { id: 'forest', label: 'Forest', description: 'Woodland clearing with pines, boulders & terrain elevation.', defaultGround: 'grass', defaultLighting: 'daylight', accent: '#22c55e' },
  { id: 'night_city', label: 'Night City', description: 'Neon-lit night streetscape with spotlights & wet asphalt.', defaultGround: 'asphalt', defaultLighting: 'night', accent: '#c084fc' },
  { id: 'modern', label: 'Modern Architecture', description: 'Minimalist glass, concrete slabs & clean gallery sightlines.', defaultGround: 'pavement', defaultLighting: 'daylight', accent: '#e2e8f0' },
  { id: 'empty_sandbox', label: 'Empty Sandbox', description: 'Clean flat arena with ready starter spawn points for fast prototyping.', defaultGround: 'concrete', defaultLighting: 'daylight', accent: '#94a3b8' },
  { id: 'empty', label: 'Completely Empty', description: 'Blank canvas with zero objects so you can construct everything from scratch.', defaultGround: 'concrete', defaultLighting: 'daylight', accent: '#64748b' },
];

function makeObj(partial: Partial<MapObject> & Pick<MapObject, 'name' | 'category' | 'assetId' | 'position'>): MapObject {
  return {
    id: createUniqueId('obj'),
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    collision: { enabled: true, wallType: 'solid', walkableTop: false },
    visible: true,
    locked: false,
    isStatic: true,
    ...partial,
  };
}

function buildStarterGameplay(
  objects: MapObject[],
  supportedModes: ModeId[],
  halfX: number,
  halfZ: number,
  terrainHeights: number[],
  cols: number,
  rows: number,
  cellSize: number,
): void {
  const sampleH = (wx: number, wz: number): number => {
    const gx = Math.max(0, Math.min(cols - 1, Math.round((wx + (cols - 1) * cellSize * 0.5) / cellSize)));
    const gz = Math.max(0, Math.min(rows - 1, Math.round((wz + (rows - 1) * cellSize * 0.5) / cellSize)));
    return terrainHeights[gz * cols + gx] ?? 0;
  };
  const spawnZ = Math.max(8, halfZ - 6);
  const siteX = Math.max(6, Math.min(halfX * 0.45, 16));

  if (supportedModes.includes('snd')) {
    for (let i = -1; i <= 1; i++) {
      const ax = i * 3;
      const az = spawnZ;
      objects.push(
        makeObj({
          name: `Attacker Spawn ${i + 2}`,
          category: 'spawns',
          assetId: 'gp_spawn_attacker',
          position: [ax, sampleH(ax, az), az],
          rotation: [0, 180, 0],
          collision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
          gameplayProps: { role: 'spawn_attacker', team: 'attackers', label: `T Spawn ${i + 2}` },
        }),
      );
      const dx = i * 3;
      const dz = -spawnZ;
      objects.push(
        makeObj({
          name: `Defender Spawn ${i + 2}`,
          category: 'spawns',
          assetId: 'gp_spawn_defender',
          position: [dx, sampleH(dx, dz), dz],
          rotation: [0, 0, 0],
          collision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
          gameplayProps: { role: 'spawn_defender', team: 'defenders', label: `CT Spawn ${i + 2}` },
        }),
      );
    }
    objects.push(
      makeObj({
        name: 'Bomb Site A',
        category: 'objectives',
        assetId: 'gp_site_a',
        position: [-siteX, sampleH(-siteX, -3), -3],
        collision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
        gameplayProps: { role: 'site_a', site: 'A', radius: 4.5, label: 'SITE A' },
      }),
      makeObj({
        name: 'Bomb Site B',
        category: 'objectives',
        assetId: 'gp_site_b',
        position: [siteX, sampleH(siteX, -3), -3],
        collision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
        gameplayProps: { role: 'site_b', site: 'B', radius: 4.5, label: 'SITE B' },
      }),
    );
  } else {
    objects.push(
      makeObj({
        name: 'Player Spawn 1',
        category: 'spawns',
        assetId: 'gp_spawn_attacker',
        position: [0, sampleH(0, spawnZ), spawnZ],
        rotation: [0, 180, 0],
        collision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
        gameplayProps: { role: 'spawn_attacker', team: 'attackers', label: 'Player Spawn 1' },
      }),
      makeObj({
        name: 'Bot / Enemy Spawn 1',
        category: 'spawns',
        assetId: 'gp_spawn_defender',
        position: [-6, sampleH(-6, -spawnZ), -spawnZ],
        collision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
        gameplayProps: { role: 'spawn_defender', team: 'defenders', label: 'Enemy Spawn 1' },
      }),
      makeObj({
        name: 'Bot / Enemy Spawn 2',
        category: 'spawns',
        assetId: 'gp_spawn_defender',
        position: [6, sampleH(6, -spawnZ), -spawnZ],
        collision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
        gameplayProps: { role: 'spawn_defender', team: 'defenders', label: 'Enemy Spawn 2' },
      }),
      makeObj({
        name: 'FFA Spawn Mid-W',
        category: 'spawns',
        assetId: 'gp_spawn_ffa',
        position: [-siteX, sampleH(-siteX, 0), 0],
        collision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
        gameplayProps: { role: 'spawn_ffa', team: 'ffa', label: 'FFA W' },
      }),
      makeObj({
        name: 'FFA Spawn Mid-E',
        category: 'spawns',
        assetId: 'gp_spawn_ffa',
        position: [siteX, sampleH(siteX, 0), 0],
        collision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
        gameplayProps: { role: 'spawn_ffa', team: 'ffa', label: 'FFA E' },
      }),
    );
    if (supportedModes.includes('defend')) {
      objects.push(
        makeObj({
          name: 'Defense Objective Site A',
          category: 'objectives',
          assetId: 'gp_site_a',
          position: [0, sampleH(0, 2), 2],
          collision: { enabled: false, wallType: 'solid', walkableTop: false, isTrigger: true },
          gameplayProps: { role: 'site_a', site: 'A', radius: 5, label: 'DEFEND SITE A' },
        }),
      );
    }
  }
}

function buildPresetContent(
  preset: EnvironmentPresetId,
  width: number,
  depth: number,
  heights: number[],
  cols: number,
  rows: number,
  cellSize: number,
): MapObject[] {
  const objects: MapObject[] = [];
  const halfX = width * 0.5;
  const halfZ = depth * 0.5;
  const wallH = 3.5;

  const addCenterDivider = (mat?: MaterialOverride) => {
    objects.push(
      makeObj({
        name: 'Mid Sightline Structure',
        category: 'buildings',
        assetId: 'mod_wall',
        position: [0, 0, 0],
        scale: [2.2, 1.0, 1.4],
        material: mat,
      }),
      makeObj({
        name: 'West Cover Block',
        category: 'geometry',
        assetId: 'prim_crate',
        position: [-Math.min(10, halfX * 0.35), 0, 5],
        scale: [1.5, 1.4, 1.5],
        collision: { enabled: true, wallType: 'crate', walkableTop: true },
      }),
      makeObj({
        name: 'East Cover Block',
        category: 'geometry',
        assetId: 'prim_crate',
        position: [Math.min(10, halfX * 0.35), 0, -5],
        scale: [1.5, 1.4, 1.5],
        collision: { enabled: true, wallType: 'crate', walkableTop: true },
      }),
    );
  };

  if (preset === 'empty' || preset === 'empty_sandbox') {
    if (preset === 'empty_sandbox') {
      objects.push(
        makeObj({
          name: 'Center Practice Block',
          category: 'geometry',
          assetId: 'prim_cube',
          position: [0, 0, 0],
          scale: [2.4, 1.8, 2.4],
          collision: { enabled: true, wallType: 'crate', walkableTop: true },
        }),
      );
    }
    return objects;
  }

  if (preset === 'urban' || preset === 'modern') {
    const wallMat: MaterialOverride = preset === 'modern'
      ? { kind: 'concrete', color: '#e2e8f0', roughness: 0.65, metalness: 0.08, normalScale: 0.7, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 }
      : { kind: 'brick', color: '#8f4738', roughness: 0.85, metalness: 0.04, normalScale: 0.95, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 };
    // Modular guardhouse in mid-west
    objects.push(
      makeObj({ name: 'Mid Building Floor', category: 'buildings', assetId: 'mod_floor', position: [-6, 0, 0], scale: [1.5, 1, 1.5], collision: { enabled: true, wallType: 'solid', walkableTop: true } }),
      makeObj({ name: 'Mid Building Doorway', category: 'buildings', assetId: 'mod_wall_doorway', position: [-3, 0, 0], rotation: [0, 90, 0], scale: [1.5, 1, 1], material: wallMat }),
      makeObj({ name: 'Mid Building North Wall', category: 'buildings', assetId: 'mod_wall_window', position: [-6, 0, -3], scale: [1.5, 1, 1], material: wallMat }),
      makeObj({ name: 'Mid Building South Wall', category: 'buildings', assetId: 'mod_wall', position: [-6, 0, 3], scale: [1.5, 1, 1], material: wallMat }),
      makeObj({ name: 'Mid Building West Wall', category: 'buildings', assetId: 'mod_wall_window', position: [-9, 0, 0], rotation: [0, 90, 0], scale: [1.5, 1, 1], material: wallMat }),
      makeObj({ name: 'Mid Building Roof', category: 'buildings', assetId: 'mod_roof_flat', position: [-6, wallH, 0], scale: [1.5, 1, 1.5], collision: { enabled: true, wallType: 'solid', walkableTop: true } }),
      makeObj({ name: 'Street Barrier SE', category: 'props', assetId: 'urb_barrier', position: [7, 0, 6], rotation: [0, 20, 0] }),
      makeObj({ name: 'Street Barrier NE', category: 'props', assetId: 'urb_barrier', position: [8, 0, -6], rotation: [0, -25, 0] }),
      makeObj({ name: 'Parked Van', category: 'props', assetId: 'urb_vehicle', position: [9, 0, 0], rotation: [0, 90, 0] }),
      makeObj({ name: 'Street Lamp A', category: 'props', assetId: 'urb_lamp', position: [3, 0, 10] }),
    );
    return objects;
  }

  if (preset === 'industrial') {
    objects.push(
      makeObj({ name: 'Cargo Container A', category: 'props', assetId: 'ind_container', position: [-5, 0, 2], material: { kind: 'painted_metal', color: '#1d4ed8', roughness: 0.55, metalness: 0.45, normalScale: 0.85, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 1 } }),
      makeObj({ name: 'Cargo Container B', category: 'props', assetId: 'ind_container', position: [6, 0, -2], rotation: [0, 90, 0], material: { kind: 'painted_metal', color: '#b45309', roughness: 0.55, metalness: 0.45, normalScale: 0.85, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 1 } }),
      makeObj({ name: 'Steel Catwalk', category: 'buildings', assetId: 'gnd_metal_platform', position: [0, 2.0, -7], scale: [3.0, 1, 1.2], collision: { enabled: true, wallType: 'solid', walkableTop: true } }),
      makeObj({ name: 'Catwalk Stairs', category: 'buildings', assetId: 'mod_stairs', position: [5.2, 0, -7], rotation: [0, -90, 0], scale: [1.0, 0.85, 1.2], collision: { enabled: true, wallType: 'solid', walkableTop: true } }),
      makeObj({ name: 'Power Generator', category: 'props', assetId: 'ind_generator', position: [-9, 0, -8] }),
      makeObj({ name: 'Pipe Run', category: 'props', assetId: 'ind_pipes', position: [10, 0, 7] }),
      makeObj({ name: 'Overhead Hangar Light', category: 'lighting', assetId: 'light_point', position: [0, 7.5, 0], collision: { enabled: false, wallType: 'solid', walkableTop: false }, lightProps: { lightType: 'point', color: '#fde68a', intensity: 14, range: 28, angleDeg: 45, penumbra: 0.4, castShadow: false, decay: 1.5 } }),
    );
    return objects;
  }

  if (preset === 'military') {
    const milMat: MaterialOverride = { kind: 'concrete', color: '#4d5d4e', roughness: 0.86, metalness: 0.1, normalScale: 0.9, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 };
    addCenterDivider(milMat);
    objects.push(
      makeObj({ name: 'Bunker Wall West', category: 'buildings', assetId: 'mod_wall_half', position: [-6, 0, -8], scale: [2.2, 1, 1.2], material: milMat }),
      makeObj({ name: 'Bunker Wall East', category: 'buildings', assetId: 'mod_wall_half', position: [6, 0, 8], scale: [2.2, 1, 1.2], material: milMat }),
      makeObj({ name: 'Elevated Watch Platform', category: 'buildings', assetId: 'mod_platform', position: [0, 1.8, -10], scale: [2.2, 1, 1.5], collision: { enabled: true, wallType: 'solid', walkableTop: true } }),
      makeObj({ name: 'Watch Ramp', category: 'geometry', assetId: 'prim_ramp', position: [5, 0, -10], rotation: [0, 90, 0], scale: [1.5, 0.9, 2.2], collision: { enabled: true, wallType: 'solid', walkableTop: true } }),
    );
    return objects;
  }

  if (preset === 'desert') {
    const sandMat: MaterialOverride = { kind: 'sandstone', color: '#c8a572', roughness: 0.9, metalness: 0.02, normalScale: 0.95, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 };
    addCenterDivider(sandMat);
    objects.push(
      makeObj({ name: 'Sandstone Pillar A', category: 'buildings', assetId: 'mod_pillar', position: [-8, 0, -4], material: sandMat }),
      makeObj({ name: 'Sandstone Pillar B', category: 'buildings', assetId: 'mod_pillar', position: [8, 0, 4], material: sandMat }),
      makeObj({ name: 'Desert Boulder 1', category: 'environment', assetId: 'env_rock', position: [-11, 0, 8], scale: [1.4, 1.2, 1.3], material: sandMat }),
      makeObj({ name: 'Desert Boulder 2', category: 'environment', assetId: 'env_rock', position: [11, 0, -8], scale: [1.5, 1.1, 1.4], material: sandMat }),
    );
    return objects;
  }

  if (preset === 'snow') {
    const iceMat: MaterialOverride = { kind: 'ice', color: '#93c5fd', roughness: 0.25, metalness: 0.14, normalScale: 0.7, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 };
    addCenterDivider(iceMat);
    objects.push(
      makeObj({ name: 'Snowy Pine 1', category: 'environment', assetId: 'env_pine', position: [-halfX + 6, 0, -halfZ + 8] }),
      makeObj({ name: 'Snowy Pine 2', category: 'environment', assetId: 'env_pine', position: [halfX - 6, 0, halfZ - 8] }),
      makeObj({ name: 'Ice Container', category: 'props', assetId: 'ind_container', position: [-7, 0, 4], material: { kind: 'painted_metal', color: '#334155', roughness: 0.52, metalness: 0.45, normalScale: 0.8, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 1 } }),
    );
    return objects;
  }

  if (preset === 'forest') {
    // Gentle rolling hills on terrain edges while keeping center playable
    const center = (cols - 1) * 0.5;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dx = (c - center) * cellSize;
        const dz = (r - center) * cellSize;
        const dist = Math.hypot(dx, dz);
        if (dist > Math.min(halfX, halfZ) * 0.65) {
          heights[r * cols + c] = Number((Math.sin(c * 0.4) * Math.cos(r * 0.4) * 1.4 + 1.2).toFixed(3));
        }
      }
    }
    addCenterDivider({ kind: 'crate', color: '#7c5334', roughness: 0.85, metalness: 0.04, normalScale: 0.9, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 2, textureScaleY: 2 });
    const treeCoords: [number, number][] = [[-12, -10], [12, -10], [-14, 4], [14, 6], [-8, 12], [9, 11]];
    treeCoords.forEach(([tx, tz], i) => {
      objects.push(makeObj({ name: `Forest Pine ${i + 1}`, category: 'environment', assetId: i % 2 === 0 ? 'env_pine' : 'env_tree', position: [tx, 0, tz] }));
    });
    objects.push(
      makeObj({ name: 'Mossy Boulder 1', category: 'environment', assetId: 'env_rock', position: [-6, 0, -5], scale: [1.3, 1.1, 1.3] }),
      makeObj({ name: 'Mossy Boulder 2', category: 'environment', assetId: 'env_rock', position: [6, 0, 5], scale: [1.4, 1.0, 1.2] }),
    );
    return objects;
  }

  // night_city
  const cyberMat: MaterialOverride = { kind: 'cyber', color: '#1e1b4b', roughness: 0.36, metalness: 0.58, normalScale: 0.85, emissive: '#22d3ee', emissiveIntensity: 0.45, textureScaleX: 2, textureScaleY: 2 };
  addCenterDivider(cyberMat);
  objects.push(
    makeObj({ name: 'Neon Street Lamp N', category: 'props', assetId: 'urb_lamp', position: [-6, 0, -9] }),
    makeObj({ name: 'Neon Street Lamp S', category: 'props', assetId: 'urb_lamp', position: [6, 0, 9] }),
    makeObj({ name: 'Cyan Spotlight', category: 'lighting', assetId: 'light_point', position: [-6, 6, -4], collision: { enabled: false, wallType: 'solid', walkableTop: false }, lightProps: { lightType: 'point', color: '#22d3ee', intensity: 16, range: 26, angleDeg: 45, penumbra: 0.5, castShadow: false, decay: 1.5 } }),
    makeObj({ name: 'Magenta Spotlight', category: 'lighting', assetId: 'light_point', position: [6, 6, 4], collision: { enabled: false, wallType: 'solid', walkableTop: false }, lightProps: { lightType: 'point', color: '#f43f5e', intensity: 16, range: 26, angleDeg: 45, penumbra: 0.5, castShadow: false, decay: 1.5 } }),
  );
  return objects;
}

export function createNewCustomMapDocument(opts: NewMapOptions): CustomMapDocument {
  const now = new Date().toISOString();
  const width = Math.max(24, Math.min(200, Math.round(opts.width)));
  const depth = Math.max(24, Math.min(200, Math.round(opts.depth)));
  const maxHeight = Math.max(8, Math.min(60, Math.round(opts.maxHeight ?? 14)));
  const halfX = width * 0.5;
  const halfZ = depth * 0.5;

  const cellSize = 2;
  const cols = Math.max(4, Math.round(width / cellSize) + 1);
  const rows = Math.max(4, Math.round(depth / cellSize) + 1);
  const heights = new Array<number>(cols * rows).fill(0);

  const groundPreset = GROUND_MATERIAL_PRESETS[opts.groundType] ?? GROUND_MATERIAL_PRESETS.concrete;
  const lightingPreset = LIGHTING_PRESETS[opts.lightingPreset] ?? LIGHTING_PRESETS.daylight;
  const supportedModes: ModeId[] = opts.supportedModes.length > 0 ? [...opts.supportedModes] : ['dm', 'arena'];
  const primaryMode = opts.primaryMode && supportedModes.includes(opts.primaryMode) ? opts.primaryMode : supportedModes[0];

  const objects = buildPresetContent(opts.environmentPreset, width, depth, heights, cols, rows, cellSize);
  if (opts.environmentPreset !== 'empty') {
    buildStarterGameplay(objects, supportedModes, halfX, halfZ, heights, cols, rows, cellSize);
  }

  const baseId = slugifyMapId(opts.name);
  const id = `${baseId}_${Date.now().toString(36).slice(-4)}`;

  return {
    formatVersion: CUSTOM_MAP_FORMAT_VERSION,
    id,
    name: opts.name.trim() || 'Untitled Custom Map',
    description: opts.description.trim() || 'Custom FPS arena built with the In-Game Map Editor.',
    author: opts.author?.trim() || 'Player',
    createdAt: now,
    updatedAt: now,
    dimensions: { width, depth, maxHeight },
    environmentPreset: opts.environmentPreset,
    groundType: opts.groundType,
    supportedModes,
    primaryMode,
    status: opts.environmentPreset === 'empty' ? 'draft' : 'valid',
    terrain: {
      enabled: opts.groundType !== 'none',
      cols,
      rows,
      cellSize,
      width,
      depth,
      heights,
      baseMaterial: deepClone(groundPreset.material),
    },
    lighting: deepClone(lightingPreset.config),
    boundaries: {
      minX: -halfX,
      maxX: halfX,
      minZ: -halfZ,
      maxZ: halfZ,
      maxY: maxHeight,
      encloseWalls: opts.environmentPreset !== 'empty',
      spectatorMargin: 6,
    },
    navigation: {
      cellSize: 1.0,
      agentRadius: 0.54,
      maxStepHeight: 0.6,
      maxSlopeDeg: 45,
      autoRegenerate: true,
      dirty: true,
    },
    groups: [
      { id: 'grp_architecture', name: 'Buildings & Structure', collapsed: false, visible: true, locked: false },
      { id: 'grp_props', name: 'Props & Cover', collapsed: false, visible: true, locked: false },
    ],
    objects,
    thumbnails: {},
    validationSummary: {
      valid: opts.environmentPreset !== 'empty',
      errors: opts.environmentPreset === 'empty' ? 1 : 0,
      warnings: 0,
      infos: 0,
    },
  };
}
