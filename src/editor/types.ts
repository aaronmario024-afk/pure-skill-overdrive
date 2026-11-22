import { ModeId } from '../data/modes';
import { WallType } from '../game/maps';
import { PBRSurfaceKind } from '../game/textures';

export const CUSTOM_MAP_FORMAT_VERSION = 1;
export const CUSTOM_MAP_PACKAGE_VERSION = 1;

export type EnvironmentPresetId =
  | 'urban'
  | 'industrial'
  | 'military'
  | 'desert'
  | 'snow'
  | 'forest'
  | 'night_city'
  | 'modern'
  | 'empty_sandbox'
  | 'empty';

export type GroundTypeId =
  | 'asphalt'
  | 'concrete'
  | 'sidewalk'
  | 'pavement'
  | 'stone'
  | 'industrial'
  | 'metal_platform'
  | 'dirt'
  | 'sand'
  | 'snow'
  | 'grass'
  | 'none';

export type LightingPresetId =
  | 'daylight'
  | 'sunset'
  | 'night'
  | 'overcast'
  | 'industrial_interior'
  | 'cold';

export type ObjectCategory =
  | 'environment'
  | 'buildings'
  | 'geometry'
  | 'props'
  | 'lighting'
  | 'spawns'
  | 'objectives'
  | 'zones';

export type GameplayRole =
  | 'spawn_attacker'
  | 'spawn_defender'
  | 'spawn_ffa'
  | 'spawn_team_zone'
  | 'site_a'
  | 'site_b'
  | 'capture_point'
  | 'hardpoint'
  | 'map_boundary'
  | 'spectator_boundary'
  | 'interaction_zone';

export type MaterialCategory =
  | 'Concrete'
  | 'Asphalt'
  | 'Metal'
  | 'Wood'
  | 'Glass'
  | 'Plastic'
  | 'Fabric'
  | 'Stone'
  | 'Dirt'
  | 'Snow';

export interface MaterialOverride {
  kind: PBRSurfaceKind;
  color: string;
  roughness: number;
  metalness: number;
  normalScale: number;
  emissive: string;
  emissiveIntensity: number;
  textureScaleX: number;
  textureScaleY: number;
  opacity?: number;
}

export interface MaterialPreset {
  id: string;
  name: string;
  category: MaterialCategory;
  material: MaterialOverride;
  isCustom?: boolean;
}

export interface LightProperties {
  lightType: 'directional' | 'point' | 'spot' | 'area';
  color: string;
  intensity: number;
  range: number;
  angleDeg: number;
  penumbra: number;
  castShadow: boolean;
  decay: number;
}

export interface GameplayProperties {
  role: GameplayRole;
  team?: 'attackers' | 'defenders' | 'teamA' | 'teamB' | 'ffa';
  site?: 'A' | 'B';
  radius?: number;
  height?: number;
  label?: string;
  modeFilter?: ModeId[];
}

export interface CollisionSettings {
  enabled: boolean;
  wallType: WallType;
  walkableTop: boolean;
  isTrigger?: boolean;
}

export interface MapObject {
  id: string;
  name: string;
  category: ObjectCategory;
  assetId: string;
  groupId?: string;
  prefabId?: string;
  position: [number, number, number];
  /** Euler rotation in degrees [rx, ry, rz] */
  rotation: [number, number, number];
  scale: [number, number, number];
  material?: MaterialOverride;
  collision: CollisionSettings;
  visible: boolean;
  locked: boolean;
  isStatic: boolean;
  lightProps?: LightProperties;
  gameplayProps?: GameplayProperties;
}

export interface MapGroup {
  id: string;
  name: string;
  collapsed: boolean;
  visible: boolean;
  locked: boolean;
}

export interface TerrainData {
  enabled: boolean;
  cols: number;
  rows: number;
  cellSize: number;
  width: number;
  depth: number;
  heights: number[];
  baseMaterial: MaterialOverride;
}

export interface LightingConfig {
  preset: LightingPresetId;
  skyColor: string;
  fogColor: string;
  fogDensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sunColor: string;
  sunIntensity: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  sunCastShadow: boolean;
  ambientColor: string;
  ambientIntensity: number;
}

export interface MapBoundaries {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
  encloseWalls: boolean;
  spectatorMargin: number;
}

export interface NavigationConfig {
  cellSize: number;
  agentRadius: number;
  maxStepHeight: number;
  maxSlopeDeg: number;
  autoRegenerate: boolean;
  lastBuiltAt?: string;
  walkableCells?: number;
  blockedCells?: number;
  componentCount?: number;
  dirty?: boolean;
}

export type PrefabItemTemplate = Omit<MapObject, 'id' | 'groupId'>;

export interface PrefabDef {
  id: string;
  name: string;
  description: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  items: PrefabItemTemplate[];
}

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  code: string;
  category: 'collision' | 'boundary' | 'gameplay' | 'navigation' | 'asset' | 'lighting';
  message: string;
  objectId?: string;
  focusPos?: [number, number, number];
}

export interface ValidationSummary {
  valid: boolean;
  errors: number;
  warnings: number;
  infos: number;
  lastValidatedAt?: string;
}

export type MapStatus = 'draft' | 'valid' | 'warnings' | 'errors';

export interface CustomMapThumbnails {
  previewDataUrl?: string;
  topdownDataUrl?: string;
  updatedAt?: string;
}

export interface CustomMapMetadata {
  formatVersion: number;
  id: string;
  name: string;
  description: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  dimensions: { width: number; depth: number; maxHeight: number };
  environmentPreset: EnvironmentPresetId;
  groundType: GroundTypeId;
  supportedModes: ModeId[];
  primaryMode: ModeId;
  status: MapStatus;
  objectCount: number;
  hasThumbnail: boolean;
  hasTopdown: boolean;
  validationErrors: number;
  validationWarnings: number;
  hasAutosave?: boolean;
  autosaveAt?: string;
  recoveredFromBackup?: boolean;
}

export interface CustomMapDocument {
  formatVersion: number;
  id: string;
  name: string;
  description: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  dimensions: { width: number; depth: number; maxHeight: number };
  environmentPreset: EnvironmentPresetId;
  groundType: GroundTypeId;
  supportedModes: ModeId[];
  primaryMode: ModeId;
  status: MapStatus;
  terrain: TerrainData;
  lighting: LightingConfig;
  boundaries: MapBoundaries;
  navigation: NavigationConfig;
  groups: MapGroup[];
  objects: MapObject[];
  thumbnails: CustomMapThumbnails;
  validationSummary: ValidationSummary;
  checksum?: string;
}

export interface CustomMapPackage {
  packageType: 'pure-skill-custom-map';
  packageVersion: number;
  exportedAt: string;
  checksum: string;
  map: CustomMapDocument;
  prefabs: PrefabDef[];
  materialPresets: MaterialPreset[];
}

export interface CustomMapLaunchConfig {
  document: CustomMapDocument;
  modeId: ModeId;
  botCount?: number;
  duration?: number;
  teamSize?: number;
  roundsPerHalf?: number;
  isTestPlay?: boolean;
}

export interface EditorCameraState {
  position: [number, number, number];
  target: [number, number, number];
  viewMode: 'perspective' | 'topdown';
}

export interface EditorHistoryEntrySnapshot {
  label: string;
  timestamp: number;
  stateJson: string;
}

export interface EditorTestSnapshot {
  document: CustomMapDocument;
  dirty: boolean;
  selectedIds: string[];
  cameraState: EditorCameraState;
  historyEntries: EditorHistoryEntrySnapshot[];
  historyIndex: number;
}

export interface EditorLibraryData {
  prefabs: PrefabDef[];
  materialPresets: MaterialPreset[];
}

export interface NewMapOptions {
  name: string;
  description: string;
  width: number;
  depth: number;
  maxHeight?: number;
  environmentPreset: EnvironmentPresetId;
  groundType: GroundTypeId;
  lightingPreset: LightingPresetId;
  supportedModes: ModeId[];
  primaryMode?: ModeId;
  author?: string;
}
