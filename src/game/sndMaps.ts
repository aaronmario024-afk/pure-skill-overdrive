import * as THREE from 'three';
import { SiteZone, Vec3Like } from './sndEngine';
import { createPBRSurface, PBRSurfaceKind } from './textures';
import { WallObstacle, WallType } from './maps';
import { buildSndEnvDetails } from './envDetails';
import { QualityTier } from './graphicsSettings';

export type SndMapId = 'district9' | 'coldfront' | 'neonmarket';

export type GridCellKind = '#' | '.' | 'I' | 'G' | 'V' | 'A' | 'B';

export interface SndMapGrid {
  cols: number;
  rows: number;
  cellSize: number;
  halfX: number;
  halfZ: number;
  /** Row-major ASCII strings (`rows` lines, each `cols` chars wide). */
  cells: string[];
}

export interface SndCalloutZone {
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface SndMapMeta {
  id: SndMapId;
  name: string;
  tagline: string;
  description: string;
  sizeLabel: 'Small' | 'Medium' | 'Large';
  theme: 'urban' | 'snow' | 'night';
  accent: string;
  skyColor: string;
  fogColor: string;
  fogDensity: number;
  floorKind: PBRSurfaceKind;
  floorColor: string;
  wallKind: PBRSurfaceKind;
  wallColor: string;
  crateColor: string;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  halfX: number;
  halfZ: number;
}

export interface ObstacleBoxSpec {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  wallType: WallType;
  matKind?:
  | 'solid'
  | 'brick'
  | 'thin'
  | 'crate'
  | 'steel'
  | 'teal_container'
  | 'red_container'
  | 'snow_bunker'
  | 'dark_stall'
  | 'bridge_rail'
  | 'void_barrier';
  trims?: boolean;
}

export interface FloorRectSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  kind: 'ground' | 'indoor' | 'bridge';
}

export interface PropSpec {
  kind: 'fountain' | 'pillar' | 'heli_pad' | 'truck' | 'arch_sign' | 'lantern' | 'cryo_tank' | 'radar_dome';
  x: number;
  z: number;
  w?: number;
  d?: number;
  color?: string;
}

export interface SndWaypoint {
  id: string;
  pos: Vec3Like;
  neighbors: string[];
  tag?: 'ct' | 't' | 'a' | 'b' | 'mid';
}

export interface SndMapBlueprint {
  meta: SndMapMeta;
  grid: SndMapGrid;
  hasVoids: boolean;
  obstacles: ObstacleBoxSpec[];
  floors: FloorRectSpec[];
  ceilings: FloorRectSpec[];
  props: PropSpec[];
  callouts: SndCalloutZone[];
  attackerSpawns: Vec3Like[];
  defenderSpawns: Vec3Like[];
  siteA: SiteZone;
  siteB: SiteZone;
  midPos: Vec3Like;
  waypoints: SndWaypoint[];
}

export interface BuiltSndMap {
  meta: SndMapMeta;
  grid: SndMapGrid;
  callouts: SndCalloutZone[];
  midPos: Vec3Like;
  group: THREE.Group;
  walls: WallObstacle[];
  wallMeshes: THREE.Object3D[];
  halfX: number;
  halfZ: number;
  attackerSpawns: THREE.Vector3[];
  defenderSpawns: THREE.Vector3[];
  siteA: SiteZone;
  siteB: SiteZone;
  waypoints: SndWaypoint[];
  siteARing: THREE.Mesh;
  siteBRing: THREE.Mesh;
  sampleGroundHeight?: (x: number, z: number, currentY?: number) => number;
  customLighting?: unknown;
  animate: (elapsedSec: number, dt?: number) => void;
  dispose: () => void;
}

export interface MapValidationReport {
  mapId: SndMapId;
  valid: boolean;
  errors: string[];
  attackerSpawnCount: number;
  defenderSpawnCount: number;
  aSiteReachableFromT: boolean;
  bSiteReachableFromT: boolean;
  aSiteReachableFromCT: boolean;
  bSiteReachableFromCT: boolean;
  siteRotateConnected: boolean;
  waypointsConnected: boolean;
  spawnLoSBlocked: boolean;
  crossSiteLoSBlocked: boolean;
  obstacleCount: number;
  floorCount: number;
  ceilingCount: number;
  tToADistM: number;
  ctToADistM: number;
  tToBDistM: number;
  ctToBDistM: number;
}

export const SND_MAP_LIST: SndMapMeta[] = [
  {
    id: 'district9',
    name: 'District 9',
    tagline: 'Urban / Medium · Mid Courtyard, Market & Garden Splits',
    description:
      'Sunlit European stone plaza (East Attacker / West Defender) with wide Mid fountain courtyard, indoor Market & A Garden splits, A Rafters and B Boathouse.',
    sizeLabel: 'Medium',
    theme: 'urban',
    accent: '#eab308',
    skyColor: '#9ec5e6',
    fogColor: '#b7cde0',
    fogDensity: 0.0042,
    floorKind: 'asphalt',
    floorColor: '#696662',
    wallKind: 'concrete',
    wallColor: '#c9bca6',
    crateColor: '#a16207',
    sunColor: '#fff5e0',
    sunIntensity: 2.3,
    hemiSky: '#cfe7ff',
    hemiGround: '#5d5345',
    hemiIntensity: 0.92,
    halfX: 41.6,
    halfZ: 39.0,
  },
  {
    id: 'coldfront',
    name: 'Cold Front',
    tagline: 'Snow / Large · Deep Abyss Chasms & Tactical Skybridges',
    description:
      'Suspended alpine research fortress (South Attacker / North Defender) carved above deep glacial gorges with skybridges, A Tower, Mid Ruin and B Cliff.',
    sizeLabel: 'Large',
    theme: 'snow',
    accent: '#38bdf8',
    skyColor: '#13263d',
    fogColor: '#1c3552',
    fogDensity: 0.0085,
    floorKind: 'snow',
    floorColor: '#c9d7e6',
    wallKind: 'concrete',
    wallColor: '#526375',
    crateColor: '#94a3b8',
    sunColor: '#e0f2fe',
    sunIntensity: 1.95,
    hemiSky: '#93c5fd',
    hemiGround: '#1e293b',
    hemiIntensity: 0.85,
    halfX: 39.75,
    halfZ: 45.05,
  },
  {
    id: 'neonmarket',
    name: 'Neon Market',
    tagline: 'Night / Small · Dual Links, Mid Fountain & Flanking Alleys',
    description:
      'Tight moonlit neon shrine district (North Attacker / South Defender) with central Mid Fountain, dual A/B Link connectors, A Garden, Mid Window and B Trophy.',
    sizeLabel: 'Small',
    theme: 'night',
    accent: '#e879f9',
    skyColor: '#0c0d1f',
    fogColor: '#131630',
    fogDensity: 0.0095,
    floorKind: 'asphalt',
    floorColor: '#25293d',
    wallKind: 'cyber',
    wallColor: '#363b54',
    crateColor: '#0e7490',
    sunColor: '#a5b4fc',
    sunIntensity: 1.35,
    hemiSky: '#4338ca',
    hemiGround: '#1e1b2e',
    hemiIntensity: 0.78,
    halfX: 34.3,
    halfZ: 36.75,
  },
];

export function getSndMapMeta(id: SndMapId): SndMapMeta {
  return SND_MAP_LIST.find((m) => m.id === id) ?? SND_MAP_LIST[0];
}

// =========================================================================
// GRID MAP COMPILER (ASCII Blueprint -> Merged 3D Architecture + Callouts)
// =========================================================================

interface GridWaypointSpec {
  id: string;
  col: number;
  row: number;
  neighbors: string[];
  tag?: 'ct' | 't' | 'a' | 'b' | 'mid';
}

interface GridCoverSpec {
  col: number;
  row: number;
  wCells: number;
  dCells: number;
  h: number;
  wallType?: WallType;
  matKind?: ObstacleBoxSpec['matKind'];
}

interface GridCalloutSpec {
  name: string;
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

interface GridPropSpec {
  kind: PropSpec['kind'];
  col: number;
  row: number;
  wCells?: number;
  dCells?: number;
  color?: string;
}

interface GridMapSource {
  id: SndMapId;
  cellSize: number;
  rows: string[];
  hasVoids: boolean;
  attackerSpawns: Array<[number, number]>;
  defenderSpawns: Array<[number, number]>;
  midCell: [number, number];
  siteARadius: number;
  siteBRadius: number;
  covers: GridCoverSpec[];
  waypoints: GridWaypointSpec[];
  callouts: GridCalloutSpec[];
  props: GridPropSpec[];
}

function hash2d(c: number, r: number): number {
  const n = Math.sin(c * 127.1 + r * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Greedily merge cells matching `predicate` into axis-aligned cell rectangles. */
function mergeGridRects(
  rows: string[],
  cols: number,
  predicate: (ch: string, c: number, r: number) => boolean,
): Array<{ c0: number; r0: number; c1: number; r1: number }> {
  const numRows = rows.length;
  const visited: boolean[][] = Array.from({ length: numRows }, () => new Array<boolean>(cols).fill(false));
  const rects: Array<{ c0: number; r0: number; c1: number; r1: number }> = [];

  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < cols; c++) {
      if (visited[r][c] || !predicate(rows[r][c], c, r)) continue;
      let maxW = 1;
      while (c + maxW < cols && !visited[r][c + maxW] && predicate(rows[r][c + maxW], c + maxW, r)) {
        maxW++;
      }
      let maxH = 1;
      outer: while (r + maxH < numRows) {
        for (let cc = c; cc < c + maxW; cc++) {
          if (visited[r + maxH][cc] || !predicate(rows[r + maxH][cc], cc, r + maxH)) {
            break outer;
          }
        }
        maxH++;
      }
      for (let rr = r; rr < r + maxH; rr++) {
        for (let cc = c; cc < c + maxW; cc++) {
          visited[rr][cc] = true;
        }
      }
      rects.push({ c0: c, r0: r, c1: c + maxW - 1, r1: r + maxH - 1 });
    }
  }
  return rects;
}

function isWalkableCell(ch: string): boolean {
  return ch !== '#' && ch !== 'V';
}

function compileGridMap(src: GridMapSource): SndMapBlueprint {
  const meta = { ...getSndMapMeta(src.id) };
  const numRows = src.rows.length;
  const cols = src.rows[0].length;
  const cs = src.cellSize;
  const halfX = (cols * cs) / 2;
  const halfZ = (numRows * cs) / 2;
  meta.halfX = halfX;
  meta.halfZ = halfZ;

  // Validate uniform row widths cleanly
  const normalizedRows = src.rows.map((r) =>
    r.length === cols ? r : r.padEnd(cols, '#').slice(0, cols),
  );

  const cellX = (col: number): number => -halfX + (col + 0.5) * cs;
  const cellZ = (row: number): number => -halfZ + (row + 0.5) * cs;
  const rectCenterW = (c0: number, c1: number): number => (cellX(c0) + cellX(c1)) * 0.5;
  const rectCenterD = (r0: number, r1: number): number => (cellZ(r0) + cellZ(r1)) * 0.5;

  const obstacles: ObstacleBoxSpec[] = [];

  // 1. Merge solid building walls '#'
  const wallRects = mergeGridRects(normalizedRows, cols, (ch) => ch === '#');
  for (const rect of wallRects) {
    const isOuter = rect.c0 === 0 || rect.r0 === 0 || rect.c1 === cols - 1 || rect.r1 === numRows - 1;
    const seed = hash2d(rect.c0, rect.r0);
    const h = isOuter
      ? 6.4
      : meta.theme === 'urban'
        ? 4.8 + Math.round(seed * 2) * 0.9
        : meta.theme === 'night'
          ? 5.0 + Math.round(seed * 2) * 0.85
          : 4.5 + Math.round(seed * 2) * 0.8;
    const w = (rect.c1 - rect.c0 + 1) * cs;
    const d = (rect.r1 - rect.r0 + 1) * cs;
    obstacles.push({
      x: rectCenterW(rect.c0, rect.c1),
      y: h * 0.5,
      z: rectCenterD(rect.r0, rect.r1),
      w,
      h,
      d,
      wallType: 'solid',
      matKind:
        meta.theme === 'urban'
          ? seed > 0.65
            ? 'brick'
            : 'solid'
          : meta.theme === 'snow'
            ? 'snow_bunker'
            : 'dark_stall',
      trims: w > 2.2 || d > 2.2,
    });
  }

  // 2. For chasm maps: create perimeter barriers on 'V' cells touching walkable cells
  //    (blocks walking into the void without blocking bullets/LOS across the canyon!)
  if (src.hasVoids) {
    const voidEdgeRects = mergeGridRects(normalizedRows, cols, (ch, c, r) => {
      if (ch !== 'V') return false;
      const adj =
        (c > 0 && isWalkableCell(normalizedRows[r][c - 1])) ||
        (c + 1 < cols && isWalkableCell(normalizedRows[r][c + 1])) ||
        (r > 0 && isWalkableCell(normalizedRows[r - 1][c])) ||
        (r + 1 < numRows && isWalkableCell(normalizedRows[r + 1][c]));
      return adj;
    });
    for (const rect of voidEdgeRects) {
      const w = (rect.c1 - rect.c0 + 1) * cs;
      const d = (rect.r1 - rect.r0 + 1) * cs;
      obstacles.push({
        x: rectCenterW(rect.c0, rect.c1),
        y: 1.2,
        z: rectCenterD(rect.r0, rect.r1),
        w,
        h: 2.4,
        d,
        wallType: 'solid',
        matKind: 'void_barrier',
        trims: false,
      });
    }
  }

  // 3. Tactical cover boxes / crates / containers placed inside rooms & sites
  for (const cov of src.covers) {
    const cx = -halfX + (cov.col + cov.wCells * 0.5) * cs;
    const cz = -halfZ + (cov.row + cov.dCells * 0.5) * cs;
    obstacles.push({
      x: cx,
      y: cov.h * 0.5,
      z: cz,
      w: cov.wCells * cs,
      h: cov.h,
      d: cov.dCells * cs,
      wallType: cov.wallType ?? 'crate',
      matKind:
        cov.matKind ??
        (meta.theme === 'snow' ? 'steel' : meta.theme === 'night' ? 'teal_container' : 'crate'),
      trims: cov.h >= 1.9,
    });
  }

  // 4. Merged floors & interior ceilings
  const floors: FloorRectSpec[] = [];
  const ceilings: FloorRectSpec[] = [];
  if (src.hasVoids) {
    const groundRects = mergeGridRects(
      normalizedRows,
      cols,
      (ch) => ch === '.' || ch === 'I' || ch === 'A' || ch === 'B',
    );
    for (const rect of groundRects) {
      floors.push({
        x: rectCenterW(rect.c0, rect.c1),
        z: rectCenterD(rect.r0, rect.r1),
        w: (rect.c1 - rect.c0 + 1) * cs,
        d: (rect.r1 - rect.r0 + 1) * cs,
        kind: 'ground',
      });
    }
    const bridgeRects = mergeGridRects(normalizedRows, cols, (ch) => ch === 'G');
    for (const rect of bridgeRects) {
      floors.push({
        x: rectCenterW(rect.c0, rect.c1),
        z: rectCenterD(rect.r0, rect.r1),
        w: (rect.c1 - rect.c0 + 1) * cs,
        d: (rect.r1 - rect.r0 + 1) * cs,
        kind: 'bridge',
      });
    }
  } else {
    floors.push({
      x: 0,
      z: 0,
      w: cols * cs,
      d: numRows * cs,
      kind: 'ground',
    });
  }

  const indoorRects = mergeGridRects(normalizedRows, cols, (ch) => ch === 'I');
  for (const rect of indoorRects) {
    ceilings.push({
      x: rectCenterW(rect.c0, rect.c1),
      z: rectCenterD(rect.r0, rect.r1),
      w: (rect.c1 - rect.c0 + 1) * cs,
      d: (rect.r1 - rect.r0 + 1) * cs,
      kind: 'indoor',
    });
  }

  // 5. Compute Site A and Site B centers from painted 'A' and 'B' cells
  const computeSiteCenter = (letter: 'A' | 'B'): Vec3Like => {
    let sx = 0;
    let sz = 0;
    let count = 0;
    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < cols; c++) {
        if (normalizedRows[r][c] === letter) {
          sx += cellX(c);
          sz += cellZ(r);
          count++;
        }
      }
    }
    if (count === 0) return { x: 0, y: 0, z: 0 };
    return { x: sx / count, y: 0, z: sz / count };
  };

  const siteACenter = computeSiteCenter('A');
  const siteBCenter = computeSiteCenter('B');

  const waypoints: SndWaypoint[] = src.waypoints.map((w) => ({
    id: w.id,
    pos: { x: cellX(w.col), y: 0, z: cellZ(w.row) },
    neighbors: w.neighbors,
    tag: w.tag,
  }));

  const callouts: SndCalloutZone[] = src.callouts.map((co) => ({
    name: co.name,
    minX: -halfX + co.c0 * cs,
    maxX: -halfX + (co.c1 + 1) * cs,
    minZ: -halfZ + co.r0 * cs,
    maxZ: -halfZ + (co.r1 + 1) * cs,
  }));

  const props: PropSpec[] = src.props.map((p) => ({
    kind: p.kind,
    x: cellX(p.col),
    z: cellZ(p.row),
    w: (p.wCells ?? 1) * cs,
    d: (p.dCells ?? 1) * cs,
    color: p.color,
  }));

  return {
    meta,
    grid: {
      cols,
      rows: numRows,
      cellSize: cs,
      halfX,
      halfZ,
      cells: normalizedRows,
    },
    hasVoids: src.hasVoids,
    obstacles,
    floors,
    ceilings,
    props,
    callouts,
    attackerSpawns: src.attackerSpawns.map(([c, r]) => ({ x: cellX(c), y: 0, z: cellZ(r) })),
    defenderSpawns: src.defenderSpawns.map(([c, r]) => ({ x: cellX(c), y: 0, z: cellZ(r) })),
    siteA: { id: 'A', pos: siteACenter, radius: src.siteARadius },
    siteB: { id: 'B', pos: siteBCenter, radius: src.siteBRadius },
    midPos: { x: cellX(src.midCell[0]), y: 0, z: cellZ(src.midCell[1]) },
    waypoints,
  };
}

// =========================================================================
// MAP 1: DISTRICT 9 (Ascent Reference — West CT, East T, NW Site A, SW Site B)
// =========================================================================
const DISTRICT9_SOURCE: GridMapSource = {
  id: 'district9',
  cellSize: 2.6,
  hasVoids: false,
  // 32 cols x 30 rows
  rows: [
    '################################', // 00
    '#######......##..###############', // 01  Back A + North Pocket
    '#######..AAAA.#..###############', // 02  A Site
    '#######..AAAA....###############', // 03  A Site + A Main Entry
    '#######..AAAA....###############', // 04  A Site + A Main Hall
    '####.....AAAA............#######', // 05  Rafters Loop + A Main Long Hall
    '####.###.##..####........#######', // 06  CT West Lane + Garden Entry + Hall
    '####.###..IIII.##....#...#######', // 07  A Garden (I) + Top Mid + A Lobby
    '####.###..IIII.......#...#######', // 08  A Garden (I) + Catwalk + A Lobby
    '###......##II####....#...#######', // 09  CT->A Split + Top Mid + A Lobby
    '###..######..####....#...#######', // 10  CT Lane + Catwalk + Top Mid + A Lobby
    '###..###........#....#...#######', // 11  Mid Link + Mid Top + A Lobby
    '#.....##..............#..#######', // 12  CT Spawn + Open Mid Courtyard + A Lobby
    '#.....................#..#######', // 13  CT Spawn -> Mid Open + Mid Fountain
    '#....................#.....#####', // 14  CT Spawn -> Mid + T-Mid Entry + T Spawn
    '#.....###..II........#.....#####', // 15  Market (I) + Mid Courtyard + T Spawn
    '####..##...II.......##......####', // 16  B CT Lane + Market (I) + T Spawn
    '####.......II....#...#......####', // 17  B CT <-> Market link + T Spawn
    '####.......II...##...#......####', // 18  B CT <-> Market + B Lobby Upper + T Spawn
    '####..#####..#####..........####', // 19  Market->B Door + T->B Lobby Hall
    '####..##.........#..........####', // 20  B Site Upper + B Lobby
    '####......BBBBBB.#.....#########', // 21  B CT Entrance -> B Site + B Main North
    '########..BBBBBB.##....#########', // 22  B Site + B Main Loop
    '########..BBBBBB......##########', // 23  B Site + B Main Entrance
    '########..BBBBBB.#....##########', // 24  B Site + B Main South
    '########..BBBBBB.#....##########', // 25  B Site + B Main U-bend
    '########..IIII...###############', // 26  Boathouse (I) south of B Site
    '########..IIII...###############', // 27  Boathouse (I)
    '################################', // 28
    '################################', // 29
  ],
  attackerSpawns: [
    [26, 15],
    [27, 16],
    [25, 17],
    [26, 18],
    [24, 16],
  ],
  defenderSpawns: [
    [2, 12],
    [2, 13],
    [2, 14],
    [3, 13],
    [3, 14],
  ],
  midCell: [17, 13],
  siteARadius: 5.4,
  siteBRadius: 5.6,
  covers: [
    // A Site generator & dice crates (never blocking entry lanes)
    { col: 10.1, row: 2.3, wCells: 0.9, dCells: 0.8, h: 2.0, matKind: 'steel' },
    { col: 11.4, row: 4.3, wCells: 0.7, dCells: 0.7, h: 1.35, matKind: 'crate' },
    // Mid Courtyard masonry archway bulkhead blocking direct CT Spawn <-> T Mid and Site A <-> Site B sightlines
    { col: 11.2, row: 13.2, wCells: 1.55, dCells: 1.15, h: 2.9, wallType: 'solid', matKind: 'brick' },
    // Mid Courtyard low crate cover
    { col: 14.3, row: 14.2, wCells: 0.8, dCells: 0.7, h: 1.25, matKind: 'crate' },
    // B Site central lane bunker & double crate (kept off Site B center for clean planting)
    { col: 10.3, row: 21.6, wCells: 0.85, dCells: 0.72, h: 1.85, matKind: 'brick' },
    { col: 14.5, row: 21.1, wCells: 0.65, dCells: 0.65, h: 1.25, matKind: 'crate' },
    // A Main wide room boxes
    { col: 18.8, row: 5.6, wCells: 0.75, dCells: 0.75, h: 1.35, matKind: 'teal_container' },
  ],
  props: [
    { kind: 'fountain', col: 18.0, row: 11.8, wCells: 1.0, dCells: 1.0 },
    { kind: 'pillar', col: 23.2, row: 15.2, wCells: 0.65, dCells: 0.65 },
    { kind: 'pillar', col: 4.6, row: 12.2, wCells: 0.6, dCells: 0.6 },
  ],
  callouts: [
    { name: 'DEFENDER SPAWN', c0: 1, r0: 11, c1: 5, r1: 15 },
    { name: 'ATTACKER SPAWN', c0: 22, r0: 14, c1: 28, r1: 19 },
    { name: 'A SITE', c0: 7, r0: 1, c1: 13, r1: 5 },
    { name: 'A GARDEN', c0: 10, r0: 6, c1: 13, r1: 9 },
    { name: 'A MAIN', c0: 14, r0: 3, c1: 24, r1: 7 },
    { name: 'A LOBBY', c0: 22, r0: 7, c1: 25, r1: 13 },
    { name: 'CATWALK', c0: 14, r0: 8, c1: 20, r1: 10 },
    { name: 'MID COURTYARD', c0: 7, r0: 11, c1: 20, r1: 15 },
    { name: 'MID MARKET', c0: 10, r0: 15, c1: 13, r1: 19 },
    { name: 'B SITE', c0: 9, r0: 20, c1: 16, r1: 25 },
    { name: 'BOATHOUSE', c0: 9, r0: 26, c1: 14, r1: 27 },
    { name: 'B MAIN', c0: 16, r0: 21, c1: 22, r1: 25 },
    { name: 'B LOBBY', c0: 18, r0: 18, c1: 27, r1: 20 },
  ],
  waypoints: [
    { id: 'ct_spawn', col: 3, row: 13, tag: 'ct', neighbors: ['ct_mid', 'ct_north', 'ct_south'] },
    { id: 'ct_north', col: 4, row: 9, tag: 'ct', neighbors: ['ct_spawn', 'a_rafters', 'a_garden'] },
    { id: 'a_rafters', col: 6, row: 5, tag: 'a', neighbors: ['ct_north', 'a_site'] },
    { id: 'a_site', col: 11, row: 3, tag: 'a', neighbors: ['a_rafters', 'a_garden', 'a_main_in'] },
    { id: 'a_garden', col: 12, row: 8, tag: 'a', neighbors: ['ct_north', 'a_site', 'catwalk'] },
    { id: 'catwalk', col: 15, row: 8, tag: 'mid', neighbors: ['a_garden', 'top_mid'] },
    { id: 'a_main_in', col: 16, row: 5, tag: 'a', neighbors: ['a_site', 'a_main_hall'] },
    { id: 'a_main_hall', col: 23, row: 6, tag: 'a', neighbors: ['a_main_in', 'a_lobby', 'top_mid'] },
    { id: 'a_lobby', col: 23, row: 11, tag: 't', neighbors: ['a_main_hall', 't_spawn'] },
    { id: 'top_mid', col: 18, row: 9, tag: 'mid', neighbors: ['catwalk', 'a_main_hall', 'mid_center'] },
    { id: 'ct_mid', col: 8, row: 13, tag: 'mid', neighbors: ['ct_spawn', 'mid_center', 'market'] },
    { id: 'mid_center', col: 16, row: 13, tag: 'mid', neighbors: ['ct_mid', 'top_mid', 't_mid', 'market'] },
    { id: 't_mid', col: 20, row: 13, tag: 'mid', neighbors: ['mid_center', 't_spawn'] },
    { id: 't_spawn', col: 25, row: 16, tag: 't', neighbors: ['a_lobby', 't_mid', 'b_lobby'] },
    { id: 'ct_south', col: 5, row: 19, tag: 'ct', neighbors: ['ct_spawn', 'market', 'b_ct'] },
    { id: 'market', col: 12, row: 17, tag: 'b', neighbors: ['ct_mid', 'mid_center', 'ct_south', 'b_site'] },
    { id: 'b_ct', col: 7, row: 21, tag: 'b', neighbors: ['ct_south', 'b_site'] },
    { id: 'b_site', col: 11, row: 23, tag: 'b', neighbors: ['b_ct', 'market', 'b_main_in'] },
    { id: 'b_lobby', col: 21, row: 19, tag: 't', neighbors: ['t_spawn', 'b_main_turn'] },
    { id: 'b_main_turn', col: 20, row: 23, tag: 'b', neighbors: ['b_lobby', 'b_main_in'] },
    { id: 'b_main_in', col: 17, row: 23, tag: 'b', neighbors: ['b_main_turn', 'b_site'] },
  ],
};

// =========================================================================
// MAP 2: NEON MARKET (Split / Night Shrine — North T, South CT, West A, East B)
// =========================================================================
const NEONMARKET_SOURCE: GridMapSource = {
  id: 'neonmarket',
  cellSize: 2.45,
  hasVoids: false,
  // 28 cols x 30 rows
  rows: [
    '############################', // 00
    '###########......###########', // 01  Attacker Side Spawn
    '###########......###########', // 02
    '###########......###########', // 03
    '#######..............#######', // 04  T Lobby Split
    '#####....########.....######', // 05  A Lobby / B Lobby Upper (Extended bulkhead shields T Spawn)
    '#####..##########.....######', // 06
    '#####....###.....#....######', // 07  A Lobby -> Mid Top | B Lobby
    '#####.##.###.....#....######', // 08
    '#####.##.###..........######', // 09  Mid Tiles -> Mid Fountain
    '#####.##.###.....#....######', // 10  A Main | Mid Fountain | B Main
    '###......###.....#.......###', // 11  A Main Ramps | B Main Bend
    '###..###.###.....####....###', // 12  A Ramps | Mid Fountain | B Main
    '##..AAA#.II......####....###', // 13  A Site | Mid Bend (I) | Mid Bottom
    '##.AAAA..II..##..###.....###', // 14  A Site | A Main Entry | B Site Entry
    '##.AAAA######II......BBBB###', // 15  A Site | B Link (I) -> B Site
    '##.AAAA#.III.II.###..BBBB###', // 16  A Link (I) | Mid Bottom | B Site
    '##....##.III....###.IIBBB###', // 17  A Garden | A Link (I) | B Trophy (I) / B Site
    '##.....#.III.II.###.IIBBBB##', // 18  A Garden -> A Link | Mid Window | B Trophy / B Drop
    '##..####.#######II#.II.II###', // 19  A Cave West | Mid Window (I) | B Tower (I)
    '##..II.....###..II..II..####', // 20  A Art (I) | Mid Window (I) | B Gym
    '##..II..II.###..II......####', // 21  A Art (I) -> A Hall (I) | B Trophy->Gym
    '####....II......II......####', // 22  A Hall (I) -> Mid Spine | B Gym
    '#######..III....II...#######', // 23  A Hall -> Defender Spawn <- B Gym
    '###########.......##########', // 24  CT Junction
    '###########......###########', // 25  Defender Side Spawn
    '###########......###########', // 26
    '###########......###########', // 27
    '############################', // 28
    '############################', // 29
  ],
  attackerSpawns: [
    [12, 1],
    [15, 1],
    [13, 2],
    [14, 2],
    [13, 3],
  ],
  defenderSpawns: [
    [12, 26],
    [15, 26],
    [13, 25],
    [14, 25],
    [13, 27],
  ],
  midCell: [14, 11],
  siteARadius: 4.9,
  siteBRadius: 5.0,
  covers: [
    // A Site neon screen & flower planter crate (kept off Site A center)
    { col: 3.0, row: 15.2, wCells: 0.6, dCells: 0.78, h: 1.85, matKind: 'dark_stall' },
    // B Site double crate & tower corner box (kept off Site B center)
    { col: 23.8, row: 15.1, wCells: 0.75, dCells: 0.72, h: 1.55, matKind: 'teal_container' },
    // Mid Bottom lane tactical box
    { col: 14.8, row: 15.8, wCells: 0.7, dCells: 0.65, h: 1.25, matKind: 'crate' },
    // South CT Shrine Torii Screen Wall shielding Defender Spawn from Mid Window sightlines
    { col: 15.2, row: 23.8, wCells: 0.95, dCells: 0.55, h: 2.8, wallType: 'solid', matKind: 'dark_stall' },
  ],
  props: [
    { kind: 'fountain', col: 12.6, row: 11.8, wCells: 0.95, dCells: 0.95, color: '#a855f7' },
    { kind: 'pillar', col: 7.5, row: 5.2, wCells: 0.6, dCells: 0.6 },
    { kind: 'lantern', col: 13.5, row: 4.0 },
    { kind: 'lantern', col: 14.0, row: 24.5 },
  ],
  callouts: [
    { name: 'ATTACKER SPAWN', c0: 11, r0: 1, c1: 16, r1: 4 },
    { name: 'A LOBBY', c0: 5, r0: 4, c1: 8, r1: 8 },
    { name: 'A MAIN', c0: 3, r0: 9, c1: 7, r1: 12 },
    { name: 'A SITE', c0: 2, r0: 13, c1: 6, r1: 16 },
    { name: 'A GARDEN', c0: 2, r0: 17, c1: 7, r1: 19 },
    { name: 'A CAVE', c0: 2, r0: 19, c1: 4, r1: 21 },
    { name: 'A ART', c0: 4, r0: 20, c1: 7, r1: 22 },
    { name: 'A HALL', c0: 8, r0: 21, c1: 11, r1: 23 },
    { name: 'MID TOP', c0: 12, r0: 7, c1: 16, r1: 9 },
    { name: 'MID TILES', c0: 17, r0: 8, c1: 20, r1: 9 },
    { name: 'MID FOUNTAIN', c0: 12, r0: 10, c1: 16, r1: 13 },
    { name: 'MID BEND', c0: 9, r0: 13, c1: 10, r1: 14 },
    { name: 'A LINK', c0: 9, r0: 16, c1: 11, r1: 18 },
    { name: 'MID BOTTOM', c0: 12, r0: 14, c1: 16, r1: 16 },
    { name: 'MID WINDOW', c0: 15, r0: 18, c1: 17, r1: 23 },
    { name: 'B LOBBY', c0: 16, r0: 5, c1: 21, r1: 10 },
    { name: 'B MAIN', c0: 18, r0: 10, c1: 24, r1: 14 },
    { name: 'B SITE', c0: 20, r0: 15, c1: 25, r1: 18 },
    { name: 'B LINK', c0: 13, r0: 15, c1: 19, r1: 16 },
    { name: 'B TROPHY', c0: 17, r0: 17, c1: 21, r1: 21 },
    { name: 'B TOWER', c0: 21, r0: 19, c1: 24, r1: 19 },
    { name: 'B GYM', c0: 18, r0: 20, c1: 23, r1: 23 },
    { name: 'DEFENDER SPAWN', c0: 11, r0: 24, c1: 16, r1: 27 },
  ],
  waypoints: [
    { id: 't_spawn', col: 13, row: 2, tag: 't', neighbors: ['a_lobby', 'b_lobby'] },
    { id: 'a_lobby', col: 6, row: 6, tag: 't', neighbors: ['t_spawn', 'a_main', 'mid_top'] },
    { id: 'a_main', col: 5, row: 11, tag: 'a', neighbors: ['a_lobby', 'a_site'] },
    { id: 'a_site', col: 5, row: 14, tag: 'a', neighbors: ['a_main', 'a_garden'] },
    { id: 'a_garden', col: 4, row: 18, tag: 'a', neighbors: ['a_site', 'a_link', 'a_cave'] },
    { id: 'a_cave', col: 3, row: 21, tag: 'a', neighbors: ['a_garden', 'a_art'] },
    { id: 'a_art', col: 6, row: 21, tag: 'a', neighbors: ['a_cave', 'a_hall'] },
    { id: 'a_hall', col: 10, row: 22, tag: 'ct', neighbors: ['a_art', 'mid_win_bot', 'ct_spawn'] },
    { id: 'b_lobby', col: 19, row: 7, tag: 't', neighbors: ['t_spawn', 'mid_tiles', 'b_main'] },
    { id: 'mid_tiles', col: 18, row: 9, tag: 'mid', neighbors: ['b_lobby', 'mid_top', 'mid_fountain'] },
    { id: 'mid_top', col: 14, row: 8, tag: 'mid', neighbors: ['a_lobby', 'mid_tiles', 'mid_fountain'] },
    { id: 'mid_fountain', col: 14, row: 11, tag: 'mid', neighbors: ['mid_top', 'mid_tiles', 'mid_bend', 'mid_bottom'] },
    { id: 'mid_bend', col: 9, row: 14, tag: 'mid', neighbors: ['mid_fountain', 'a_link'] },
    { id: 'a_link', col: 10, row: 17, tag: 'a', neighbors: ['mid_bend', 'a_garden', 'mid_bottom'] },
    { id: 'mid_bottom', col: 14, row: 15, tag: 'mid', neighbors: ['mid_fountain', 'a_link', 'b_link', 'mid_win'] },
    { id: 'mid_win', col: 16, row: 19, tag: 'mid', neighbors: ['mid_bottom', 'mid_win_bot'] },
    { id: 'mid_win_bot', col: 16, row: 22, tag: 'ct', neighbors: ['mid_win', 'a_hall', 'b_gym', 'ct_spawn'] },
    { id: 'b_main', col: 22, row: 12, tag: 'b', neighbors: ['b_lobby', 'b_site'] },
    { id: 'b_site', col: 21, row: 16, tag: 'b', neighbors: ['b_main', 'b_link', 'b_trophy'] },
    { id: 'b_link', col: 18, row: 15, tag: 'b', neighbors: ['mid_bottom', 'b_site', 'b_trophy'] },
    { id: 'b_trophy', col: 20, row: 18, tag: 'b', neighbors: ['b_site', 'b_link', 'b_gym'] },
    { id: 'b_gym', col: 21, row: 22, tag: 'ct', neighbors: ['b_trophy', 'mid_win_bot', 'ct_spawn'] },
    { id: 'ct_spawn', col: 13, row: 26, tag: 'ct', neighbors: ['mid_win_bot', 'a_hall', 'b_gym'] },
  ],
};

// =========================================================================
// MAP 3: COLD FRONT (Alpine Research Fortress & Glacial Abyss Skybridges)
// =========================================================================
const COLDFRONT_SOURCE: GridMapSource = {
  id: 'coldfront',
  cellSize: 2.65,
  hasVoids: true,
  // 30 cols x 34 rows (V = Chasm Void, G = Skybridge over Void, # = Glacial Cliff / Armored Bunker, I = Indoor Research Facility)
  rows: [
    'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVV', // 00 (30)
    'VVVVVVVVVV..........VVVVVVVVVV', // 01 (30) Defender Side Spawn (North Helipad Plateau)
    'VVVVVVVV..............VVVVVVVV', // 02 (30) Defender Plateau
    'VVV.......................VVVV', // 03 (30) A Alley (3..10) | CT Split | East Rim (19..25)
    'VV...VV.GGG.######...VVVV..VVV', // 04 (30) West Rafters (2..4) | A Pit (5..6) | Rope-Bridge (7..9) | CT Gate (10..11) | CT Helipad Blast Wall (12..17) | East Gate (18..20) | East Rim (25..26)
    'VV...VV.GGG.......#######..VVV', // 05 (30) West Rafters (2..4) | A Pit (5..6) | Rope-Bridge (7..9) | Mid Truck North (10..17) | B Servers North Wall (18..24) | East Rim (25..26)
    'VV...##IIII#......#IIIIII#..VV', // 06 (30) A Rafters (2..4) | A Tower (7..10) | Mid Truck (12..17) | B Servers (19..24) | East Rim (26..27)
    'V....##IIII#.......IIIIII#.GGV', // 07 (30) A Rafters (1..4) | A Tower (7..10) | Mid Truck->B Servers Door (12..18) | B Servers (19..24) | B Abyss Bridge (27..28)
    'V....##IIII#......#...###..GGV', // 08 (30) A Rafters (1..4) | A Tower (7..10) | Mid Truck (12..17) | B Servers South Exit (19..21) | B Abyss Bridge (27..28)
    'V....##IIII#......##..#....GGV', // 09 (30) A Rafters (1..4) | A Tower (7..10) | Mid Truck (12..17) | B Cliff North (20..21) | B Abyss Bridge (27..28)
    'V.AAAA....##......##..##..BBBV', // 10 (30) A Site (2..5) | A Tower Hall (6..9) | Mid Truck South (12..17) | B Cliff Corridor (20..21) | B Site North (26..28)
    'V.AAAA....###.IIII##...BBBBBBV', // 11 (30) A Site (2..5) | A Tower Hall (6..9) | Mid Cryo-Door (14..17) | B Cliff (20..22) | B Site (23..28)
    'V.AAAA....##..IIII.....BBBBBBV', // 12 (30) A Site (2..5) | A Tower (6..9) | Mid Cryo-Door (14..17) <-> B Cliff (18..22) <-> B Site (23..28)
    'V.AAAA........IIII.###.BBBBBBV', // 13 (30) A Site (2..5) <-> A Tower Bot (6..9) <-> Mid Top (10..13) <-> Mid Door (14..17) | B Site (23..28)
    'V....#####....#IIIIII#...##..V', // 14 (30) A Site->A Main (1..4) | Solid West Cliff Bulkhead (5..9) | Mid Top (10..13) | Mid Stairs (15..20) | B Site South Gate (22..24, 27..28)
    'V.II.##VV#....##..IIII...##..V', // 15 (30) A Main Lab (1..4) | West Bulkhead (5..6) | Chasm (7..8) | Cliff (9) | Mid Ruin West (10..13) | Central Cryo-Monolith (14..15) | Mid Stairs (18..21) | B Main (22..28)
    'V.II.##VV#....##....##.......V', // 16 (30) A Main Lab (1..4) | West Bulkhead (5..6) | Chasm (7..8) | Cliff (9) | Mid Ruin West (10..13) | Central Cryo-Monolith (14..15) | Mid Ruin East (16..19) | East Wall (20..21) | B Main (22..28)
    'V.II.##VV#..........VV.......V', // 17 (30) A Main Lab (1..4) | West Bulkhead (5..6) | Chasm (7..8) | Cliff (9) | Mid Ruin Courtyard (10..19) | East Chasm (20..21) | B Main (22..28)
    'V.II.##VV#........GGGGGG.....V', // 18 (30) A Main Lab (1..4) | West Bulkhead (5..6) | Chasm (7..8) | Cliff (9) | Mid Ruin (10..17) -> Mid-B Skybridge (18..23) -> B Main (24..28)
    'V.II.##VV##.........##.......V', // 19 (30) A Main South (1..4) | West Bulkhead (5..6) | Chasm (7..8) | Cliff (9..10) | Mid Ruin South (11..19) | East Canyon Wall (20..21) | B Main (22..28)
    'V.....VVVVV....##...###......V', // 20 (30) A Lobby (1..5) | West Chasm (6..10) | Mid Bottom West (11..14) | Mid Blast Bulkhead (15..16) | Mid Bottom East (17..19) | East Canyon Wall (20..22) | B Main South (23..28)
    'VV....GGGGGG........###......V', // 21 (30) A Lobby (2..5) -> Breakable Skybridge (6..11) -> Mid Bottom (12..19) | East Canyon Wall (20..22) | B Main->Lobby (23..28)
    'VV....GGGGGG........###......V', // 22 (30) A Lobby (2..5) -> Breakable Skybridge (6..11) -> Mid Bottom (12..19) | East Canyon Wall (20..22) | B Lobby North (23..28)
    'VV....VVVVVV#..##...###......V', // 23 (30) A Lobby South (2..5) | SW Chasm (6..11) | Mid Spine West (13..14) | Spine Pillar (15..16) | Mid Spine East (17..19) | East Canyon Wall (20..22) | B Lobby (23..28)
    'VV...#######...##...###.##...V', // 24 (30) SW Rim (2..4) | Solid SW Glacier Cliff (5..11) | Center Spine (12..14, 17..19) | East Canyon Wall (20..22) | B Lobby (23, 26..28)
    'VV...#######....##..###......V', // 25 (30) SW Rim (2..4) | Solid SW Glacier Cliff (5..11) | Center Spine (12..15, 18..19) | East Canyon Wall (20..22) | B Lobby South (23..28)
    'VVV.....####.#####..###.....VV', // 26 (30) SW Rim Gate (3..7) | SW Cliff (8..11) | West Spine Gate (12) | Attacker Icebreaker Shield Wall (13..17) | East Spine Gate (18..19) | SE Cliff (20..22) | B Lobby Gate (23..27)
    'VVVV.........#####.........VVV', // 27 (30) Attacker West Split (4..12) | Attacker Icebreaker Shield Wall (13..17) | Attacker East Split (18..26)
    'VVVVV.....................VVVV', // 28 (30) Attacker Spawn Courtyard (5..25)
    'VVVVVVV.................VVVVVV', // 29 (30) Attacker Side Spawn (7..23)
    'VVVVVVVVV.............VVVVVVVV', // 30 (30) Attacker Side Spawn (9..21)
    'VVVVVVVVVVV.........VVVVVVVVVV', // 31 (30)
    'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVV', // 32 (30)
    'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVV', // 33 (30)
  ],
  attackerSpawns: [
    [13, 29],
    [15, 29],
    [17, 29],
    [14, 30],
    [16, 30],
  ],
  defenderSpawns: [
    [12, 1],
    [15, 1],
    [17, 1],
    [13, 2],
    [16, 2],
  ],
  midCell: [12, 17],
  siteARadius: 5.2,
  siteBRadius: 5.4,
  covers: [
    // A Site tactical snow bunker & industrial cryo crate (kept off Site A center 3.5, 11.5)
    { col: 5.2, row: 10.5, wCells: 0.65, dCells: 0.75, h: 1.75, matKind: 'snow_bunker' },
    { col: 2.1, row: 13.1, wCells: 0.65, dCells: 0.65, h: 1.45, matKind: 'steel' },
    // A Rafters overlook shield
    { col: 1.8, row: 7.2, wCells: 0.65, dCells: 0.55, h: 1.3, matKind: 'steel' },
    // A Lobby cargo container breaking long West lane sightline
    { col: 2.1, row: 22.8, wCells: 0.7, dCells: 0.85, h: 1.9, matKind: 'red_container' },
    // Mid Truck blast barrier staggering North-Mid sightline
    { col: 16.1, row: 9.1, wCells: 0.8, dCells: 0.55, h: 1.55, matKind: 'snow_bunker' },
    // Mid Ruin flanking research crates around the Central Cryo-Monolith
    { col: 10.6, row: 15.8, wCells: 0.68, dCells: 0.68, h: 1.45, matKind: 'crate' },
    { col: 17.5, row: 16.2, wCells: 0.72, dCells: 0.65, h: 1.55, matKind: 'teal_container' },
    // Mid Bottom glacial barricade & crate pocket
    { col: 12.6, row: 21.8, wCells: 0.75, dCells: 0.6, h: 1.45, matKind: 'snow_bunker' },
    // B Servers internal cryo-server rack bank
    { col: 23.2, row: 6.8, wCells: 0.65, dCells: 0.85, h: 2.05, matKind: 'dark_stall' },
    // B Site central armored bunker & north container (kept off Site B center)
    { col: 23.7, row: 13.1, wCells: 1.15, dCells: 0.6, h: 1.8, matKind: 'snow_bunker' },
    { col: 27.4, row: 10.4, wCells: 0.65, dCells: 0.65, h: 1.95, matKind: 'teal_container' },
    // B Main staggered shipping containers breaking long East lane sightline
    { col: 27.3, row: 16.4, wCells: 0.72, dCells: 1.0, h: 2.0, matKind: 'red_container' },
    { col: 23.5, row: 20.4, wCells: 0.7, dCells: 0.7, h: 1.45, matKind: 'crate' },
  ],
  props: [
    { kind: 'truck', col: 13.3, row: 7.3, wCells: 0.8, dCells: 1.35, color: '#334155' },
    { kind: 'heli_pad', col: 15, row: 2, wCells: 2.4, dCells: 2.0 },
    { kind: 'cryo_tank', col: 2.0, row: 10.4, wCells: 0.75, dCells: 0.75, color: '#38bdf8' },
    { kind: 'radar_dome', col: 20.5, row: 2.0, wCells: 0.9, dCells: 0.9 },
    { kind: 'pillar', col: 25.5, row: 26.5, wCells: 0.7, dCells: 0.7 },
    { kind: 'pillar', col: 6.5, row: 27.5, wCells: 0.7, dCells: 0.7 },
  ],
  callouts: [
    { name: 'DEFENDER SPAWN', c0: 10, r0: 1, c1: 20, r1: 3 },
    { name: 'A ALLEY', c0: 2, r0: 3, c1: 11, r1: 5 },
    { name: 'A RAFTER', c0: 1, r0: 6, c1: 4, r1: 9 },
    { name: 'A TOWER', c0: 5, r0: 5, c1: 10, r1: 10 },
    { name: 'A SITE', c0: 1, r0: 10, c1: 6, r1: 14 },
    { name: 'A MAIN', c0: 1, r0: 15, c1: 5, r1: 19 },
    { name: 'A LOBBY', c0: 1, r0: 20, c1: 6, r1: 23 },
    { name: 'BREAKABLE BRIDGE', c0: 6, r0: 21, c1: 11, r1: 22 },
    { name: 'MID TRUCK', c0: 11, r0: 5, c1: 17, r1: 10 },
    { name: 'MID DOOR', c0: 13, r0: 11, c1: 17, r1: 14 },
    { name: 'MID TOP', c0: 7, r0: 13, c1: 13, r1: 15 },
    { name: 'MID RUIN', c0: 10, r0: 15, c1: 19, r1: 19 },
    { name: 'MID STAIRS', c0: 15, r0: 14, c1: 21, r1: 16 },
    { name: 'MID BOTTOM', c0: 11, r0: 20, c1: 19, r1: 25 },
    { name: 'B SERVERS', c0: 18, r0: 5, c1: 24, r1: 8 },
    { name: 'B BRIDGE', c0: 26, r0: 6, c1: 28, r1: 9 },
    { name: 'B CLIFF', c0: 18, r0: 9, c1: 22, r1: 13 },
    { name: 'B SITE', c0: 23, r0: 10, c1: 28, r1: 14 },
    { name: 'B MAIN', c0: 22, r0: 15, c1: 28, r1: 22 },
    { name: 'B LOBBY', c0: 22, r0: 23, c1: 28, r1: 27 },
    { name: 'ATTACKER SPAWN', c0: 6, r0: 27, c1: 22, r1: 31 },
  ],
  waypoints: [
    { id: 'ct_spawn', col: 15, row: 2, tag: 'ct', neighbors: ['a_alley', 'mid_truck', 'east_rim'] },
    { id: 'a_alley', col: 3, row: 3, tag: 'ct', neighbors: ['ct_spawn', 'a_rafter', 'a_tower_bridge'] },
    { id: 'a_rafter', col: 3, row: 8, tag: 'a', neighbors: ['a_alley', 'a_site'] },
    { id: 'a_tower_bridge', col: 8, row: 4, tag: 'a', neighbors: ['a_alley', 'a_tower_mid'] },
    { id: 'a_tower_mid', col: 9, row: 8, tag: 'a', neighbors: ['a_tower_bridge', 'a_tower_bot'] },
    { id: 'a_tower_bot', col: 8, row: 13, tag: 'mid', neighbors: ['a_tower_mid', 'a_site', 'mid_top'] },
    { id: 'a_site', col: 4, row: 12, tag: 'a', neighbors: ['a_rafter', 'a_tower_bot', 'a_main'] },
    { id: 'a_main', col: 3, row: 17, tag: 'a', neighbors: ['a_site', 'a_lobby'] },
    { id: 'a_lobby', col: 3, row: 21, tag: 't', neighbors: ['a_main', 'break_bridge', 'sw_rim'] },
    { id: 'sw_rim', col: 3, row: 25, tag: 't', neighbors: ['a_lobby', 't_spawn'] },
    { id: 'break_bridge', col: 8, row: 21, tag: 'mid', neighbors: ['a_lobby', 'mid_bottom'] },
    { id: 'mid_truck', col: 15, row: 6, tag: 'mid', neighbors: ['ct_spawn', 'mid_door', 'b_servers'] },
    { id: 'mid_door', col: 15, row: 12, tag: 'mid', neighbors: ['mid_truck', 'mid_top', 'mid_ruin', 'mid_stairs', 'b_cliff'] },
    { id: 'mid_top', col: 11, row: 13, tag: 'mid', neighbors: ['a_tower_bot', 'mid_door', 'mid_ruin'] },
    { id: 'mid_ruin', col: 12, row: 17, tag: 'mid', neighbors: ['mid_door', 'mid_top', 'mid_b_bridge', 'mid_bottom'] },
    { id: 'mid_b_bridge', col: 20, row: 18, tag: 'mid', neighbors: ['mid_ruin', 'b_main'] },
    { id: 'mid_bottom', col: 18, row: 21, tag: 'mid', neighbors: ['break_bridge', 'mid_ruin', 'center_spine'] },
    { id: 'center_spine', col: 18, row: 25, tag: 't', neighbors: ['mid_bottom', 't_spawn'] },
    { id: 'east_rim', col: 26, row: 5, tag: 'ct', neighbors: ['ct_spawn', 'b_bridge'] },
    { id: 'b_bridge', col: 27, row: 8, tag: 'b', neighbors: ['east_rim', 'b_site'] },
    { id: 'b_servers', col: 21, row: 7, tag: 'b', neighbors: ['mid_truck', 'b_cliff'] },
    { id: 'b_cliff', col: 21, row: 11, tag: 'b', neighbors: ['mid_door', 'b_servers', 'b_site'] },
    { id: 'b_site', col: 27, row: 12, tag: 'b', neighbors: ['b_bridge', 'b_cliff', 'b_main'] },
    { id: 'mid_stairs', col: 19, row: 15, tag: 'b', neighbors: ['mid_door', 'b_main'] },
    { id: 'b_main', col: 25, row: 18, tag: 'b', neighbors: ['b_site', 'mid_stairs', 'mid_b_bridge', 'b_lobby'] },
    { id: 'b_lobby', col: 27, row: 25, tag: 't', neighbors: ['b_main', 't_spawn'] },
    { id: 't_spawn', col: 14, row: 29, tag: 't', neighbors: ['sw_rim', 'center_spine', 'b_lobby'] },
  ],
};

const MAP_SOURCES: Record<SndMapId, GridMapSource> = {
  district9: DISTRICT9_SOURCE,
  coldfront: COLDFRONT_SOURCE,
  neonmarket: NEONMARKET_SOURCE,
};

const BLUEPRINT_CACHE: Partial<Record<SndMapId, SndMapBlueprint>> = {};

export function getSndBlueprint(mapId: SndMapId): SndMapBlueprint {
  if (!BLUEPRINT_CACHE[mapId]) {
    BLUEPRINT_CACHE[mapId] = compileGridMap(MAP_SOURCES[mapId]);
  }
  return BLUEPRINT_CACHE[mapId]!;
}

// =========================================================================
// COLLISION, PATHFINDING & VALIDATION HELPERS
// =========================================================================

export function resolveCircleWallCollisionRect(
  pos: { x: number; y?: number; z: number },
  radius: number,
  walls: WallObstacle[],
  halfX: number,
  halfZ: number,
): void {
  const maxX = halfX - radius;
  const maxZ = halfZ - radius;
  pos.x = Math.max(-maxX, Math.min(maxX, pos.x));
  pos.z = Math.max(-maxZ, Math.min(maxZ, pos.z));

  for (const w of walls) {
    if (w.box.max.y < 0.25) continue;
    const py = pos.y ?? 0;
    if (py >= w.box.max.y) continue;
    if (py + 1.75 < w.box.min.y) continue;
    if (w.walkableTop && w.box.max.y - py <= 0.58) continue;
    const minX = w.box.min.x;
    const wMaxX = w.box.max.x;
    const minZ = w.box.min.z;
    const wMaxZ = w.box.max.z;

    const closestX = Math.max(minX, Math.min(wMaxX, pos.x));
    const closestZ = Math.max(minZ, Math.min(wMaxZ, pos.z));
    const dx = pos.x - closestX;
    const dz = pos.z - closestZ;
    const distSq = dx * dx + dz * dz;

    if (distSq < radius * radius) {
      const dist = Math.sqrt(distSq);
      if (dist > 1e-5) {
        const push = radius - dist;
        pos.x += (dx / dist) * push;
        pos.z += (dz / dist) * push;
      } else {
        const penL = Math.abs(pos.x - minX);
        const penR = Math.abs(wMaxX - pos.x);
        const penT = Math.abs(pos.z - minZ);
        const penB = Math.abs(wMaxZ - pos.z);
        const m = Math.min(penL, penR, penT, penB);
        if (m === penL) pos.x = minX - radius;
        else if (m === penR) pos.x = wMaxX + radius;
        else if (m === penT) pos.z = minZ - radius;
        else pos.z = wMaxZ + radius;
      }
    }
  }

  pos.x = Math.max(-maxX, Math.min(maxX, pos.x));
  pos.z = Math.max(-maxZ, Math.min(maxZ, pos.z));
}

function dist2D(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function findWaypointPath(waypoints: SndWaypoint[], from: Vec3Like, to: Vec3Like): THREE.Vector3[] {
  if (waypoints.length === 0) return [];
  const byId = new Map<string, SndWaypoint>();
  for (const w of waypoints) byId.set(w.id, w);

  let start = waypoints[0];
  let end = waypoints[0];
  let bestS = Infinity;
  let bestE = Infinity;
  for (const w of waypoints) {
    const ds = dist2D(w.pos, from);
    if (ds < bestS) {
      bestS = ds;
      start = w;
    }
    const de = dist2D(w.pos, to);
    if (de < bestE) {
      bestE = de;
      end = w;
    }
  }
  if (start.id === end.id) return [new THREE.Vector3(end.pos.x, 0, end.pos.z)];

  const open = new Set<string>([start.id]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[start.id, 0]]);
  const fScore = new Map<string, number>([[start.id, dist2D(start.pos, end.pos)]]);

  while (open.size > 0) {
    let currentId = '';
    let bestF = Infinity;
    for (const id of open) {
      const f = fScore.get(id) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        currentId = id;
      }
    }
    if (!currentId) break;
    if (currentId === end.id) {
      const path: THREE.Vector3[] = [];
      let cur: string | undefined = currentId;
      while (cur) {
        const node = byId.get(cur);
        if (node) path.unshift(new THREE.Vector3(node.pos.x, 0, node.pos.z));
        cur = cameFrom.get(cur);
      }
      return path;
    }
    open.delete(currentId);
    const curNode = byId.get(currentId)!;
    const curG = gScore.get(currentId) ?? Infinity;
    for (const nbId of curNode.neighbors) {
      const nb = byId.get(nbId);
      if (!nb) continue;
      const tentativeG = curG + dist2D(curNode.pos, nb.pos);
      if (tentativeG < (gScore.get(nbId) ?? Infinity)) {
        cameFrom.set(nbId, currentId);
        gScore.set(nbId, tentativeG);
        fScore.set(nbId, tentativeG + dist2D(nb.pos, end.pos));
        open.add(nbId);
      }
    }
  }
  return [new THREE.Vector3(end.pos.x, 0, end.pos.z)];
}

// =========================================================================
// AUTOMATED VALIDATOR (No overlaps, 100% 1m-grid BFS reachability)
// =========================================================================

function isPointClearOnMap(x: number, z: number, bp: SndMapBlueprint, margin = 0.42): boolean {
  const { halfX, halfZ, cells, cellSize, cols, rows } = bp.grid;
  if (Math.abs(x) >= halfX - margin || Math.abs(z) >= halfZ - margin) return false;
  const c = Math.floor((x + halfX) / cellSize);
  const r = Math.floor((z + halfZ) / cellSize);
  if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
  if (!isWalkableCell(cells[r][c])) return false;

  for (const o of bp.obstacles) {
    const minX = o.x - o.w * 0.5 - margin;
    const maxX = o.x + o.w * 0.5 + margin;
    const minZ = o.z - o.d * 0.5 - margin;
    const maxZ = o.z + o.d * 0.5 + margin;
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return false;
  }

  for (const p of bp.props) {
    if (p.kind === 'heli_pad' || p.kind === 'lantern' || p.kind === 'arch_sign') continue;
    const pw = (p.w ?? 1.8) * 0.72;
    const pd = (p.d ?? 1.8) * 0.72;
    if (
      x >= p.x - pw * 0.5 - margin &&
      x <= p.x + pw * 0.5 + margin &&
      z >= p.z - pd * 0.5 - margin &&
      z <= p.z + pd * 0.5 + margin
    ) {
      return false;
    }
  }
  return true;
}

/** 2D ray vs solid obstacle check at player eye height (y = 1.65m) ignoring low void barriers. */
function hasClearLineOfSightOnBlueprint(a: Vec3Like, b: Vec3Like, bp: SndMapBlueprint, eyeY = 1.65): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.25) return true;
  const steps = Math.max(4, Math.ceil(dist / 0.45));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    for (const o of bp.obstacles) {
      if (o.matKind === 'void_barrier') continue;
      const topY = o.y + o.h * 0.5;
      if (topY < eyeY) continue;
      if (
        px >= o.x - o.w * 0.5 &&
        px <= o.x + o.w * 0.5 &&
        pz >= o.z - o.d * 0.5 &&
        pz <= o.z + o.d * 0.5
      ) {
        return false;
      }
    }
  }
  return true;
}

function bfsDistanceMeters(from: Vec3Like, to: Vec3Like, bp: SndMapBlueprint): number {
  const step = 1.0;
  const cols = Math.floor((bp.meta.halfX * 2) / step);
  const rows = Math.floor((bp.meta.halfZ * 2) / step);
  const toGrid = (p: Vec3Like): [number, number] => [
    Math.max(0, Math.min(cols - 1, Math.floor((p.x + bp.meta.halfX) / step))),
    Math.max(0, Math.min(rows - 1, Math.floor((p.z + bp.meta.halfZ) / step))),
  ];
  const toWorld = (gx: number, gz: number): [number, number] => [
    -bp.meta.halfX + (gx + 0.5) * step,
    -bp.meta.halfZ + (gz + 0.5) * step,
  ];

  const [sx, sz] = toGrid(from);
  const [tx, tz] = toGrid(to);
  const walkable = new Uint8Array(cols * rows);
  for (let gz = 0; gz < rows; gz++) {
    for (let gx = 0; gx < cols; gx++) {
      const [wx, wz] = toWorld(gx, gz);
      if (isPointClearOnMap(wx, wz, bp, 0.35)) walkable[gz * cols + gx] = 1;
    }
  }
  const dist = new Int32Array(cols * rows).fill(-1);
  const qx = new Int32Array(cols * rows);
  const qz = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  dist[sz * cols + sx] = 0;
  qx[tail] = sx;
  qz[tail] = sz;
  tail++;

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (head < tail) {
    const cx = qx[head];
    const cz = qz[head];
    head++;
    const d = dist[cz * cols + cx];
    if (cx === tx && cz === tz) return d * step;
    for (const [dx, dz] of dirs) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
      const idx = nz * cols + nx;
      if (dist[idx] !== -1 || walkable[idx] === 0) continue;
      dist[idx] = d + 1;
      qx[tail] = nx;
      qz[tail] = nz;
      tail++;
    }
  }
  return Infinity;
}

export function validateSndMapLayout(mapId: SndMapId): MapValidationReport {
  const bp = getSndBlueprint(mapId);
  const errors: string[] = [];

  if (bp.attackerSpawns.length < 5) {
    errors.push(`Need >= 5 attacker spawns, got ${bp.attackerSpawns.length}`);
  }
  if (bp.defenderSpawns.length < 5) {
    errors.push(`Need >= 5 defender spawns, got ${bp.defenderSpawns.length}`);
  }
  bp.attackerSpawns.forEach((s, idx) => {
    if (!isPointClearOnMap(s.x, s.z, bp, 0.42)) {
      errors.push(`Attacker spawn #${idx} overlaps wall/void at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
    }
  });
  bp.defenderSpawns.forEach((s, idx) => {
    if (!isPointClearOnMap(s.x, s.z, bp, 0.42)) {
      errors.push(`Defender spawn #${idx} overlaps wall/void at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
    }
  });
  if (!isPointClearOnMap(bp.siteA.pos.x, bp.siteA.pos.z, bp, 0.4)) {
    errors.push(`Site A center overlaps obstacle/void`);
  }
  if (!isPointClearOnMap(bp.siteB.pos.x, bp.siteB.pos.z, bp, 0.4)) {
    errors.push(`Site B center overlaps obstacle/void`);
  }
  if (!isPointClearOnMap(bp.midPos.x, bp.midPos.z, bp, 0.35)) {
    errors.push(`Mid center overlaps obstacle/void`);
  }

  for (const w of bp.waypoints) {
    if (!isPointClearOnMap(w.pos.x, w.pos.z, bp, 0.25)) {
      errors.push(`Waypoint ${w.id} is blocked at (${w.pos.x.toFixed(1)}, ${w.pos.z.toFixed(1)})`);
    }
    for (const nb of w.neighbors) {
      if (!bp.waypoints.some((x) => x.id === nb)) {
        errors.push(`Waypoint ${w.id} references missing neighbor ${nb}`);
      }
    }
  }

  const t0 = bp.attackerSpawns[0];
  const ct0 = bp.defenderSpawns[0];
  const tToADistM = bfsDistanceMeters(t0, bp.siteA.pos, bp);
  const tToBDistM = bfsDistanceMeters(t0, bp.siteB.pos, bp);
  const ctToADistM = bfsDistanceMeters(ct0, bp.siteA.pos, bp);
  const ctToBDistM = bfsDistanceMeters(ct0, bp.siteB.pos, bp);
  const rotateDist = bfsDistanceMeters(bp.siteA.pos, bp.siteB.pos, bp);
  const midDist = bfsDistanceMeters(t0, bp.midPos, bp);

  const aSiteReachableFromT = Number.isFinite(tToADistM);
  const bSiteReachableFromT = Number.isFinite(tToBDistM);
  const aSiteReachableFromCT = Number.isFinite(ctToADistM);
  const bSiteReachableFromCT = Number.isFinite(ctToBDistM);
  const siteRotateConnected = Number.isFinite(rotateDist);

  if (!aSiteReachableFromT) errors.push('Site A unreachable from Attacker Spawn');
  if (!bSiteReachableFromT) errors.push('Site B unreachable from Attacker Spawn');
  if (!aSiteReachableFromCT) errors.push('Site A unreachable from Defender Spawn');
  if (!bSiteReachableFromCT) errors.push('Site B unreachable from Defender Spawn');
  if (!siteRotateConnected) errors.push('Site A and Site B are disconnected');
  if (!Number.isFinite(midDist)) errors.push('Mid position unreachable from Attacker Spawn');

  let waypointsConnected = true;
  if (bp.waypoints.length > 0) {
    const byId = new Map(bp.waypoints.map((w) => [w.id, w]));
    const seen = new Set<string>([bp.waypoints[0].id]);
    const queue = [bp.waypoints[0].id];
    while (queue.length > 0) {
      const cur = byId.get(queue.shift()!);
      if (!cur) continue;
      for (const nb of cur.neighbors) {
        if (!seen.has(nb) && byId.has(nb)) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
    if (seen.size !== bp.waypoints.length) {
      waypointsConnected = false;
      errors.push(`Waypoint graph disconnected (${seen.size}/${bp.waypoints.length})`);
    }
  }

  let spawnLoSBlocked = true;
  for (let ai = 0; ai < bp.attackerSpawns.length; ai++) {
    for (let di = 0; di < bp.defenderSpawns.length; di++) {
      if (hasClearLineOfSightOnBlueprint(bp.attackerSpawns[ai], bp.defenderSpawns[di], bp, 1.68)) {
        spawnLoSBlocked = false;
        errors.push(`Unintended direct sightline between Attacker Spawn #${ai} and Defender Spawn #${di}`);
      }
    }
  }

  const crossSiteLoSBlocked = !hasClearLineOfSightOnBlueprint(bp.siteA.pos, bp.siteB.pos, bp, 1.68);
  if (!crossSiteLoSBlocked) {
    errors.push('Unintended cross-map sightline directly between Site A and Site B');
  }

  return {
    mapId,
    valid: errors.length === 0,
    errors,
    attackerSpawnCount: bp.attackerSpawns.length,
    defenderSpawnCount: bp.defenderSpawns.length,
    aSiteReachableFromT,
    bSiteReachableFromT,
    aSiteReachableFromCT,
    bSiteReachableFromCT,
    siteRotateConnected,
    waypointsConnected,
    spawnLoSBlocked,
    crossSiteLoSBlocked,
    obstacleCount: bp.obstacles.length,
    floorCount: bp.floors.length,
    ceilingCount: bp.ceilings.length,
    tToADistM: Math.round(tToADistM * 10) / 10,
    ctToADistM: Math.round(ctToADistM * 10) / 10,
    tToBDistM: Math.round(tToBDistM * 10) / 10,
    ctToBDistM: Math.round(ctToBDistM * 10) / 10,
  };
}

// =========================================================================
// 3D GEOMETRY & PBR ARCHITECTURAL MAP BUILDER
// =========================================================================

function buildMaterialPalette(meta: SndMapMeta) {
  const make = (
    kind: PBRSurfaceKind,
    color: string,
    rx: number,
    ry: number,
    rough: number,
    metal = 0.08,
    bumpScale = 0.045,
  ) => {
    const maps = createPBRSurface(kind, color, rx, ry);
    return new THREE.MeshStandardMaterial({
      map: maps.map,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.88, 0.88),
      bumpMap: maps.bumpMap,
      roughnessMap: maps.roughnessMap,
      roughness: rough,
      metalness: metal,
      bumpScale: bumpScale * 0.75,
    });
  };

  return {
    solid: make(meta.wallKind, meta.wallColor, 2, 2, meta.theme === 'snow' ? 0.65 : 0.86, 0.08),
    brick: make(
      'brick',
      meta.theme === 'urban' ? '#b38968' : '#3a4a5e',
      3,
      2,
      0.88,
      0.04,
    ),
    thin: new THREE.MeshStandardMaterial({
      color: meta.theme === 'night' ? '#334155' : '#854d0e',
      roughness: 0.72,
      metalness: 0.25,
    }),
    crate: make('crate', meta.crateColor, 1, 1, 0.76, 0.06),
    steel: make('gunmetal', meta.theme === 'snow' ? '#475569' : '#52525b', 2, 1, 0.38, 0.78),
    teal_container: make('cyber', '#115e59', 3, 1.5, 0.42, 0.65),
    red_container: make('cyber', '#7f1d1d', 3, 1.5, 0.44, 0.6),
    snow_bunker: make('concrete', '#78899c', 2, 1.5, 0.72, 0.14),
    dark_stall: make('cyber', '#1e2235', 2, 1.5, 0.52, 0.36),
    bridge: make('gunmetal', '#5b4282', 3, 1, 0.46, 0.62),
    bridge_rail: new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.45, metalness: 0.7 }),
    void_barrier: new THREE.MeshBasicMaterial({ visible: false }),
    trim: new THREE.MeshStandardMaterial({
      color: meta.theme === 'night' ? '#1e1b4b' : meta.theme === 'snow' ? '#94a3b8' : '#786855',
      roughness: 0.72,
      metalness: meta.theme === 'urban' ? 0.05 : 0.35,
    }),
    ceiling: new THREE.MeshStandardMaterial({
      color: meta.theme === 'night' ? '#181a2b' : meta.theme === 'snow' ? '#2c3a4c' : '#5c5346',
      roughness: 0.9,
      metalness: 0.08,
    }),
  };
}

function addSiteZoneVisual(
  group: THREE.Group,
  site: SiteZone,
  accentColor: string,
  theme: SndMapMeta['theme'] = 'urban',
): { ring: THREE.Mesh; pointLight: THREE.PointLight } {
  // 1. Multi-layered 3D octagonal stone/gunmetal outer plinth border (h = 0.036m)
  const outerCurb = new THREE.Mesh(
    new THREE.CylinderGeometry(site.radius + 0.14, site.radius + 0.22, 0.036, 16),
    new THREE.MeshStandardMaterial({
      color: theme === 'urban' ? '#786855' : theme === 'snow' ? '#475569' : '#1e1b4b',
      roughness: 0.72,
      metalness: 0.22,
    }),
  );
  outerCurb.position.set(site.pos.x, 0.018, site.pos.z);
  outerCurb.receiveShadow = true;
  group.add(outerCurb);

  // 2. Inlaid decorative floor platform / crimson-gold carpet or industrial steel decking (inspired by Image 2)
  const inlayMat = new THREE.MeshStandardMaterial({
    color: theme === 'urban' ? '#882924' : theme === 'snow' ? '#1e293b' : '#1e1b4b',
    roughness: theme === 'urban' ? 0.88 : 0.62,
    metalness: theme === 'urban' ? 0.04 : 0.35,
  });
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(site.radius - 0.16, site.radius - 0.12, 0.042, 16),
    inlayMat,
  );
  pad.position.set(site.pos.x, 0.021, site.pos.z);
  pad.receiveShadow = true;
  group.add(pad);

  // 3. Inner rectangular gold/cyan architectural border frame inside the bomb site
  const innerFrameW = site.radius * 1.15;
  const innerFrameMat = new THREE.MeshStandardMaterial({
    color: theme === 'urban' ? '#ca8a04' : accentColor,
    roughness: 0.38,
    metalness: 0.68,
  });
  for (const sgn of [-1, 1]) {
    const barX = new THREE.Mesh(new THREE.BoxGeometry(innerFrameW, 0.012, 0.11), innerFrameMat);
    barX.position.set(site.pos.x, 0.045, site.pos.z + sgn * (innerFrameW * 0.5));
    const barZ = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, innerFrameW), innerFrameMat);
    barZ.position.set(site.pos.x + sgn * (innerFrameW * 0.5), 0.045, site.pos.z);
    group.add(barX, barZ);
  }

  // 4. Four directional wayfinding floor chevron strips leading into the site center
  const chevronMat = new THREE.MeshBasicMaterial({
    color: accentColor,
    transparent: true,
    opacity: 0.78,
  });
  for (let dir = 0; dir < 4; dir++) {
    const ang = (dir * Math.PI) / 2;
    const dist = site.radius + 0.85;
    const chev = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.014, 0.95), chevronMat);
    chev.rotation.y = ang;
    chev.position.set(
      site.pos.x + Math.sin(ang) * dist,
      0.018,
      site.pos.z + Math.cos(ang) * dist,
    );
    group.add(chev);
  }

  const ringGeo = new THREE.RingGeometry(site.radius - 0.18, site.radius, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: accentColor,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.72,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(site.pos.x, 0.046, site.pos.z);
  group.add(ring);

  // 5. Corner holographic pylons with 3D armored base plinths
  const pylonBaseMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.4, metalness: 0.7 });
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2 + Math.PI / 4;
    const px = site.pos.x + Math.cos(ang) * (site.radius * 0.86);
    const pz = site.pos.z + Math.sin(ang) * (site.radius * 0.86);
    const basePlinth = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.18, 8), pylonBaseMat);
    basePlinth.position.set(px, 0.09, pz);
    group.add(basePlinth);

    const pylon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 1.35, 8),
      pylonBaseMat,
    );
    pylon.position.set(px, 0.675, pz);
    group.add(pylon);
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.22, 8),
      new THREE.MeshBasicMaterial({ color: accentColor }),
    );
    tip.position.set(px, 1.4, pz);
    group.add(tip);
  }

  // Painted site stencil letter on floor
  const letterCanvas = document.createElement('canvas');
  letterCanvas.width = 128;
  letterCanvas.height = 128;
  const ctx = letterCanvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, 104, 104);
  ctx.fillStyle = accentColor;
  ctx.font = 'bold 84px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(site.id, 64, 68);
  const stencilTex = new THREE.CanvasTexture(letterCanvas);
  const stencilMat = new THREE.MeshBasicMaterial({
    map: stencilTex,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  const stencilGeo = new THREE.PlaneGeometry(2.6, 2.6);
  stencilGeo.rotateX(-Math.PI / 2);
  const stencil = new THREE.Mesh(stencilGeo, stencilMat);
  stencil.position.set(site.pos.x, 0.049, site.pos.z);
  group.add(stencil);

  const pointLight = new THREE.PointLight(accentColor, 1.1, 16, 1.8);
  pointLight.position.set(site.pos.x, 3.3, site.pos.z);
  group.add(pointLight);

  return { ring, pointLight };
}

function registerPropCollider(
  mesh: THREE.Mesh,
  cx: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  walls: WallObstacle[],
  wallMeshes: THREE.Object3D[],
): void {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { isWall: true, wallType: 'solid' as WallType };
  const box = new THREE.Box3(
    new THREE.Vector3(cx - w * 0.5, 0, cz - d * 0.5),
    new THREE.Vector3(cx + w * 0.5, h, cz + d * 0.5),
  );
  walls.push({ mesh, box, wallType: 'solid' });
  wallMeshes.push(mesh);
}

function addProp(
  group: THREE.Group,
  prop: PropSpec,
  theme: SndMapMeta['theme'],
  walls: WallObstacle[],
  wallMeshes: THREE.Object3D[],
): void {
  if (prop.kind === 'fountain') {
    const stoneMat = new THREE.MeshStandardMaterial({
      color: theme === 'night' ? '#312e81' : '#b7ab98',
      roughness: 0.78,
      metalness: 0.08,
    });
    const r = Math.min(prop.w ?? 2.6, prop.d ?? 2.6) * 0.42;
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, 0.55, 16), stoneMat);
    basin.position.set(prop.x, 0.275, prop.z);
    group.add(basin);

    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.85, r * 0.85, 0.06, 16),
      new THREE.MeshStandardMaterial({
        color: prop.color ?? '#0ea5e9',
        emissive: prop.color ?? '#0369a1',
        emissiveIntensity: theme === 'night' ? 0.55 : 0.15,
        roughness: 0.12,
        metalness: 0.2,
      }),
    );
    water.position.set(prop.x, 0.53, prop.z);
    group.add(water);

    const spire = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.3, 1.55, 12), stoneMat);
    spire.position.set(prop.x, 1.05, prop.z);
    group.add(spire);
    registerPropCollider(basin, prop.x, prop.z, r * 1.85, 1.8, r * 1.85, walls, wallMeshes);
    wallMeshes.push(spire);
    return;
  }

  if (prop.kind === 'pillar') {
    const r = Math.min(prop.w ?? 1.7, prop.d ?? 1.7) * 0.42;
    const mat = new THREE.MeshStandardMaterial({
      color: theme === 'night' ? '#334155' : theme === 'snow' ? '#475569' : '#9c8f7e',
      roughness: 0.72,
      metalness: 0.2,
    });
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, 2.4, 12), mat);
    cyl.position.set(prop.x, 1.2, prop.z);
    group.add(cyl);
    registerPropCollider(cyl, prop.x, prop.z, r * 1.85, 2.4, r * 1.85, walls, wallMeshes);
    return;
  }

  if (prop.kind === 'heli_pad') {
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 24),
      new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.8, metalness: 0.2 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(prop.x, 0.025, prop.z);
    group.add(pad);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.15, 2.4, 24),
      new THREE.MeshBasicMaterial({ color: '#facc15', side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(prop.x, 0.035, prop.z);
    group.add(ring);
    return;
  }

  if (prop.kind === 'truck') {
    const g = new THREE.Group();
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(1.75, 1.5, 1.25),
      new THREE.MeshStandardMaterial({ color: prop.color ?? '#334155', roughness: 0.5, metalness: 0.45 }),
    );
    cab.position.set(0, 0.9, 1.0);
    g.add(cab);
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(1.85, 1.85, 2.1),
      new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.58, metalness: 0.35 }),
    );
    bed.position.set(0, 1.05, -0.75);
    g.add(bed);
    g.position.set(prop.x, 0, prop.z);
    group.add(g);
    registerPropCollider(bed, prop.x, prop.z, 1.85, 1.95, 3.25, walls, wallMeshes);
    wallMeshes.push(cab);
    return;
  }

  if (prop.kind === 'cryo_tank') {
    const r = Math.min(prop.w ?? 2.0, prop.d ?? 2.0) * 0.42;
    const tankMat = new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      roughness: 0.32,
      metalness: 0.72,
    });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2.45, 16), tankMat);
    tank.position.set(prop.x, 1.225, prop.z);
    group.add(tank);

    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), tankMat);
    dome.position.set(prop.x, 2.45, prop.z);
    group.add(dome);

    const glowMat = new THREE.MeshBasicMaterial({ color: prop.color ?? '#38bdf8' });
    for (const ry of [0.85, 1.65]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, 0.1, 16), glowMat);
      band.position.set(prop.x, ry, prop.z);
      group.add(band);
    }
    registerPropCollider(tank, prop.x, prop.z, r * 1.9, 2.75, r * 1.9, walls, wallMeshes);
    return;
  }

  if (prop.kind === 'radar_dome') {
    const r = Math.min(prop.w ?? 2.4, prop.d ?? 2.4) * 0.46;
    const baseMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.65, metalness: 0.45 });
    const domeMat = new THREE.MeshStandardMaterial({
      color: '#e2e8f0',
      roughness: 0.38,
      metalness: 0.25,
      flatShading: true,
    });
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.12, 0.75, 12), baseMat);
    plinth.position.set(prop.x, 0.375, prop.z);
    group.add(plinth);

    const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), domeMat);
    dome.position.set(prop.x, 0.95, prop.z);
    group.add(dome);
    registerPropCollider(plinth, prop.x, prop.z, r * 1.95, 2.1, r * 1.95, walls, wallMeshes);
    wallMeshes.push(dome);
    return;
  }

  if (prop.kind === 'lantern') {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.7, 0.45),
      new THREE.MeshBasicMaterial({ color: '#f472b6' }),
    );
    lamp.position.set(prop.x, 3.6, prop.z);
    group.add(lamp);
    const l = new THREE.PointLight('#e879f9', 1.4, 14, 1.8);
    l.position.set(prop.x, 3.2, prop.z);
    group.add(l);
  }
}

export function buildSndMap(mapId: SndMapId, lightingQuality: QualityTier = 'high'): BuiltSndMap {
  const bp = getSndBlueprint(mapId);
  const { meta, halfX, halfZ } = {
    meta: bp.meta,
    halfX: bp.meta.halfX,
    halfZ: bp.meta.halfZ,
  };

  const group = new THREE.Group();
  const walls: WallObstacle[] = [];
  const wallMeshes: THREE.Object3D[] = [];
  const palette = buildMaterialPalette(meta);

  // Ground textures
  const floorMaps = createPBRSurface(meta.floorKind, meta.floorColor, 16, 16);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorMaps.map,
    normalMap: floorMaps.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    bumpMap: floorMaps.bumpMap,
    roughnessMap: floorMaps.roughnessMap,
    roughness: meta.theme === 'snow' ? 0.85 : 0.78,
    metalness: 0.05,
    bumpScale: 0.03,
  });

  // 1. Floor slabs (+ deep abyss cliff walls & fog plane on void maps)
  if (bp.hasVoids) {
    // Deep glacial gorge bottom far below (visual only!)
    const gorgeFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(halfX * 3.4, halfZ * 3.4),
      new THREE.MeshStandardMaterial({
        color: '#06101f',
        roughness: 0.95,
        metalness: 0.1,
      }),
    );
    gorgeFloor.rotation.x = -Math.PI / 2;
    gorgeFloor.position.y = -13;
    group.add(gorgeFloor);

    // Abyss mist glow sheet
    const mist = new THREE.Mesh(
      new THREE.PlaneGeometry(halfX * 3.2, halfZ * 3.2),
      new THREE.MeshBasicMaterial({
        color: '#0c2745',
        transparent: true,
        opacity: 0.42,
      }),
    );
    mist.rotation.x = -Math.PI / 2;
    mist.position.y = -6.5;
    group.add(mist);

    const cliffMaps = createPBRSurface('concrete', '#253447', 4, 3);
    const cliffMat = new THREE.MeshStandardMaterial({
      map: cliffMaps.map,
      normalMap: cliffMaps.normalMap,
      normalScale: new THREE.Vector2(0.95, 0.95),
      bumpMap: cliffMaps.bumpMap,
      roughnessMap: cliffMaps.roughnessMap,
      roughness: 0.88,
      metalness: 0.12,
      bumpScale: 0.04,
    });

    for (const fl of bp.floors) {
      if (fl.kind === 'bridge') {
        const deck = new THREE.Mesh(new THREE.BoxGeometry(fl.w, 0.24, fl.d), palette.bridge);
        deck.position.set(fl.x, -0.12, fl.z);
        deck.receiveShadow = true;
        group.add(deck);

        // Under-bridge structural steel support girder
        const truss = new THREE.Mesh(
          new THREE.BoxGeometry(fl.w * 0.94, 0.42, fl.d * 0.94),
          palette.bridge_rail,
        );
        truss.position.set(fl.x, -0.45, fl.z);
        group.add(truss);

        // Raised safety curb beams along bridge edges
        const spanX = fl.w >= fl.d;
        for (const sgn of [-1, 1]) {
          const curb = new THREE.Mesh(
            spanX
              ? new THREE.BoxGeometry(fl.w, 0.22, 0.16)
              : new THREE.BoxGeometry(0.16, 0.22, fl.d),
            palette.bridge_rail,
          );
          curb.position.set(
            spanX ? fl.x : fl.x + sgn * (fl.w * 0.5 - 0.08),
            0.11,
            spanX ? fl.z + sgn * (fl.d * 0.5 - 0.08) : fl.z,
          );
          group.add(curb);
        }

        // Glowing tactical bridge strip down center
        const stripW = fl.w > fl.d ? fl.w * 0.92 : 0.26;
        const stripD = fl.w > fl.d ? 0.26 : fl.d * 0.92;
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(stripW, 0.03, stripD),
          new THREE.MeshBasicMaterial({ color: '#38bdf8' }),
        );
        strip.position.set(fl.x, 0.015, fl.z);
        group.add(strip);
      } else {
        // Walkable surface slab + seamless 100%-width cliff foundation down into gorge (zero cracks between rects!)
        const topSlab = new THREE.Mesh(new THREE.BoxGeometry(fl.w, 0.3, fl.d), floorMat);
        topSlab.position.set(fl.x, -0.15, fl.z);
        topSlab.receiveShadow = true;
        group.add(topSlab);

        const cliffBlock = new THREE.Mesh(new THREE.BoxGeometry(fl.w, 12.4, fl.d), cliffMat);
        cliffBlock.position.set(fl.x, -6.5, fl.z);
        group.add(cliffBlock);
      }
    }
  } else {
    const floorGeo = new THREE.PlaneGeometry(halfX * 2 + 8, halfZ * 2 + 8);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.receiveShadow = true;
    group.add(floorMesh);
  }

  // 2. Interior room ceilings ('I' cells), raised 3D interior floor platforms, ceiling rafters & framed doorway architraves
  const indoorFloorMaps = createPBRSurface(
    meta.theme === 'urban' ? 'tile' : meta.theme === 'snow' ? 'gunmetal' : 'cyber',
    meta.theme === 'urban' ? '#7c6f60' : meta.theme === 'snow' ? '#334155' : '#1e243b',
    4,
    4,
  );
  const indoorFloorMat = new THREE.MeshStandardMaterial({
    map: indoorFloorMaps.map,
    normalMap: indoorFloorMaps.normalMap,
    roughnessMap: indoorFloorMaps.roughnessMap,
    roughness: 0.58,
    metalness: meta.theme === 'urban' ? 0.08 : 0.35,
  });

  for (const ceil of bp.ceilings) {
    // Raised 3D interior floor platform (h = 0.042m) with chamfered threshold border
    const indoorFloorBorder = new THREE.Mesh(
      new THREE.BoxGeometry(ceil.w + 0.14, 0.032, ceil.d + 0.14),
      palette.trim,
    );
    indoorFloorBorder.position.set(ceil.x, 0.016, ceil.z);
    indoorFloorBorder.receiveShadow = true;
    group.add(indoorFloorBorder);

    const indoorFloorSlab = new THREE.Mesh(
      new THREE.BoxGeometry(ceil.w - 0.04, 0.042, ceil.d - 0.04),
      indoorFloorMat,
    );
    indoorFloorSlab.position.set(ceil.x, 0.021, ceil.z);
    indoorFloorSlab.receiveShadow = true;
    group.add(indoorFloorSlab);

    const slab = new THREE.Mesh(new THREE.BoxGeometry(ceil.w, 0.85, ceil.d), palette.ceiling);
    slab.position.set(ceil.x, 3.96, ceil.z);
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);

    // Exposed interior ceiling structural cross-beams
    const rafter = new THREE.Mesh(
      new THREE.BoxGeometry(ceil.w * 0.96, 0.16, 0.24),
      palette.trim,
    );
    rafter.position.set(ceil.x, 3.48, ceil.z);
    group.add(rafter);

    const roofCap = new THREE.Mesh(
      new THREE.BoxGeometry(ceil.w + 0.14, 0.18, ceil.d + 0.14),
      palette.trim,
    );
    roofCap.position.set(ceil.x, 4.47, ceil.z);
    group.add(roofCap);

    const lampBar = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(1.6, ceil.w * 0.55), 0.06, 0.24),
      new THREE.MeshBasicMaterial({ color: meta.theme === 'night' ? '#c084fc' : '#e2e8f0' }),
    );
    lampBar.position.set(ceil.x, 3.39, ceil.z);
    group.add(lampBar);
  }

  // Build framed doorway headers/lintels, vertical side jambs & threshold sills at every indoor ('I') to outdoor transition
  {
    const { cells, cols, rows, cellSize: cs } = bp.grid;
    const lintelH = 1.05;
    const lintelY = 3.05; // bottom at y = 2.525m (well above 1.72m head height), top merges into ceiling at 3.575m
    const cellX = (c: number) => -halfX + (c + 0.5) * cs;
    const cellZ = (r: number) => -halfZ + (r + 0.5) * cs;
    const isOutdoorWalk = (ch: string) => ch === '.' || ch === 'A' || ch === 'B' || ch === 'G';

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cells[r][c] !== 'I') continue;
        const cx = cellX(c);
        const cz = cellZ(r);
        // Check North/South transitions
        for (const dr of [-1, 1]) {
          const nr = r + dr;
          if (nr >= 0 && nr < rows && isOutdoorWalk(cells[nr][c])) {
            const ez = cz + dr * (cs * 0.5);
            const lintel = new THREE.Mesh(
              new THREE.BoxGeometry(cs, lintelH, 0.34),
              palette.solid,
            );
            lintel.position.set(cx, lintelY, ez);
            lintel.castShadow = true;
            lintel.receiveShadow = true;
            group.add(lintel);
            const trim = new THREE.Mesh(new THREE.BoxGeometry(cs, 0.14, 0.44), palette.trim);
            trim.position.set(cx, lintelY - lintelH * 0.5, ez);
            group.add(trim);

            // 3D threshold step sill on the floor at doorway entrance
            const sill = new THREE.Mesh(new THREE.BoxGeometry(cs, 0.048, 0.36), palette.trim);
            sill.position.set(cx, 0.024, ez);
            sill.receiveShadow = true;
            group.add(sill);
          }
        }
        // Check West/East transitions
        for (const dc of [-1, 1]) {
          const nc = c + dc;
          if (nc >= 0 && nc < cols && isOutdoorWalk(cells[r][nc])) {
            const ex = cx + dc * (cs * 0.5);
            const lintel = new THREE.Mesh(
              new THREE.BoxGeometry(0.34, lintelH, cs),
              palette.solid,
            );
            lintel.position.set(ex, lintelY, cz);
            lintel.castShadow = true;
            lintel.receiveShadow = true;
            group.add(lintel);
            const trim = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, cs), palette.trim);
            trim.position.set(ex, lintelY - lintelH * 0.5, cz);
            group.add(trim);

            const sill = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.048, cs), palette.trim);
            sill.position.set(ex, 0.024, cz);
            sill.receiveShadow = true;
            group.add(sill);
          }
        }
      }
    }
  }

  // 3. Walls, Cover Boxes & Chasm Barriers
  const snowCapMat =
    meta.theme === 'snow'
      ? (() => {
        const m = createPBRSurface('snow', '#e2ecf5', 2, 2);
        return new THREE.MeshStandardMaterial({
          map: m.map,
          bumpMap: m.bumpMap,
          roughnessMap: m.roughnessMap,
          roughness: 0.88,
          metalness: 0.02,
        });
      })()
      : null;

  const neonMat =
    meta.theme === 'night'
      ? new THREE.MeshBasicMaterial({ color: meta.accent })
      : null;

  for (const obs of bp.obstacles) {
    if (obs.matKind === 'void_barrier') {
      // Collision box blocks walking into void; mesh stays outside wallMeshes so bullets/LOS cross freely!
      const invisibleMesh = new THREE.Mesh(new THREE.BoxGeometry(obs.w, obs.h, obs.d), palette.void_barrier);
      invisibleMesh.position.set(obs.x, obs.y, obs.z);
      invisibleMesh.visible = false;
      const box = new THREE.Box3(
        new THREE.Vector3(obs.x - obs.w * 0.5, 0, obs.z - obs.d * 0.5),
        new THREE.Vector3(obs.x + obs.w * 0.5, obs.h, obs.z + obs.d * 0.5),
      );
      walls.push({ mesh: invisibleMesh, box, wallType: 'solid' });
      continue;
    }

    const mat =
      obs.matKind && palette[obs.matKind] ? palette[obs.matKind] : palette.solid;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(obs.w, obs.h, obs.d), mat);
    mesh.position.set(obs.x, obs.y, obs.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { isWall: true, wallType: obs.wallType };
    group.add(mesh);

    const box = new THREE.Box3(
      new THREE.Vector3(obs.x - obs.w * 0.5, Math.max(0, obs.y - obs.h * 0.5), obs.z - obs.d * 0.5),
      new THREE.Vector3(obs.x + obs.w * 0.5, obs.y + obs.h * 0.5, obs.z + obs.d * 0.5),
    );
    walls.push({ mesh, box, wallType: obs.wallType });
    wallMeshes.push(mesh);

    // Architectural trim / parapet / neon accent on solid buildings
    if (obs.trims && obs.h >= 3.5) {
      const capH = 0.24;
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(obs.w + 0.16, capH, obs.d + 0.16),
        snowCapMat ?? palette.trim,
      );
      cap.position.set(obs.x, obs.y + obs.h * 0.5 + capH * 0.5, obs.z);
      group.add(cap);

      const baseTrim = new THREE.Mesh(
        new THREE.BoxGeometry(obs.w + 0.1, 0.28, obs.d + 0.1),
        palette.trim,
      );
      baseTrim.position.set(obs.x, 0.14, obs.z);
      group.add(baseTrim);

      if (neonMat && obs.w > 3 && hash2d(obs.x, obs.z) > 0.45) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(obs.w + 0.08, 0.08, obs.d + 0.08), neonMat);
        strip.position.set(obs.x, 3.15, obs.z);
        group.add(strip);
      }
    }
  }

  // 4. Props (Mid Fountain, Truck, Heli-pad, Pillars, Cryo Tanks, Radar Dome, Neon Lanterns)
  for (const prop of bp.props) {
    addProp(group, prop, meta.theme, walls, wallMeshes);
  }

  // 5. Bomb Sites
  const aViz = addSiteZoneVisual(group, bp.siteA, '#facc15', meta.theme);
  const bViz = addSiteZoneVisual(group, bp.siteB, '#38bdf8', meta.theme);

  // 6. Decorative Non-Colliding Architecture & Animated Atmosphere
  // (Scene key/hemi/rim lighting is managed centrally by SndMatchController to avoid duplicate shadow maps)
  const envDetails = buildSndEnvDetails({
    theme: meta.theme,
    halfX,
    halfZ,
    obstacles: bp.obstacles,
    quality: lightingQuality,
  });
  group.add(envDetails.group);

  const skylineMat = new THREE.MeshStandardMaterial({
    color: meta.theme === 'night' ? '#0f172a' : meta.theme === 'snow' ? '#1e293b' : '#94a3b8',
    roughness: 0.9,
  });
  for (let i = 0; i < 20; i++) {
    const ang = (i / 20) * Math.PI * 2;
    const dist = Math.max(halfX, halfZ) + 22 + (i % 3) * 8;
    const h = 14 + (i % 5) * 6;
    const w = 8 + (i % 4) * 3;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skylineMat);
    tower.position.set(Math.cos(ang) * dist, h * 0.5 - 3, Math.sin(ang) * dist);
    group.add(tower);
  }

  const animate = (elapsedSec: number, dt = 0.016) => {
    const pulse = 0.55 + Math.sin(elapsedSec * 2.6) * 0.25;
    (aViz.ring.material as THREE.MeshBasicMaterial).opacity = pulse;
    (bViz.ring.material as THREE.MeshBasicMaterial).opacity = pulse;
    envDetails.update(elapsedSec, dt);
  };

  const dispose = () => {
    envDetails.dispose();
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) mat?.dispose();
      }
    });
  };

  return {
    meta,
    grid: bp.grid,
    callouts: bp.callouts,
    midPos: bp.midPos,
    group,
    walls,
    wallMeshes,
    halfX,
    halfZ,
    attackerSpawns: bp.attackerSpawns.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
    defenderSpawns: bp.defenderSpawns.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
    siteA: bp.siteA,
    siteB: bp.siteB,
    waypoints: bp.waypoints,
    siteARing: aViz.ring,
    siteBRing: bViz.ring,
    animate,
    dispose,
  };
}
