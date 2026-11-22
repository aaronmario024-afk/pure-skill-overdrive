import * as THREE from 'three';
import { NavGrid, NavWallBox } from '../game/ai/navigation';
import { WallObstacle } from '../game/maps';
import { SndMapGrid, SndWaypoint } from '../game/sndMaps';
import { getAssetDefinition } from './assetCatalog';
import { createUniqueId } from './presets';
import { sampleMapSurfaceHeight, sampleTerrainHeight } from './terrain';
import { CustomMapDocument, MapObject, ValidationIssue, ValidationSummary } from './types';

export interface CustomNavBakeResult {
  navGrid: NavGrid;
  sndGrid: SndMapGrid;
  waypoints: SndWaypoint[];
  walkableCells: number;
  blockedCells: number;
  componentCount: number;
  mainComponentId: number;
  wallBoxes: NavWallBox[];
  slopeBlockedIndices: Set<number>;
}

function rotateLocalBoxToWorld(
  obj: MapObject,
  localCenter: [number, number, number],
  localSize: [number, number, number],
): THREE.Box3 {
  const pos = new THREE.Vector3(obj.position[0], obj.position[1], obj.position[2]);
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(obj.rotation[0] || 0),
    THREE.MathUtils.degToRad(obj.rotation[1] || 0),
    THREE.MathUtils.degToRad(obj.rotation[2] || 0),
    'YXZ',
  );
  const quat = new THREE.Quaternion().setFromEuler(euler);
  const scl = new THREE.Vector3(Math.abs(obj.scale[0] || 1), Math.abs(obj.scale[1] || 1), Math.abs(obj.scale[2] || 1));
  const mat = new THREE.Matrix4().compose(pos, quat, scl);

  const lc = new THREE.Vector3(localCenter[0], localCenter[1], localCenter[2]);
  const hs = new THREE.Vector3(localSize[0] * 0.5, localSize[1] * 0.5, localSize[2] * 0.5);
  const localBox = new THREE.Box3(lc.clone().sub(hs), lc.clone().add(hs));
  return localBox.applyMatrix4(mat);
}

export function extractObjectColliderBoxes(
  obj: MapObject,
): Array<{ box: THREE.Box3; wallType: 'solid' | 'thin' | 'crate'; walkableTop: boolean; isRampOrStairs: boolean }> {
  if (!obj.visible || !obj.collision?.enabled) return [];
  const def = getAssetDefinition(obj.assetId);
  if (!def || def.localColliders.length === 0) return [];

  const results: Array<{ box: THREE.Box3; wallType: 'solid' | 'thin' | 'crate'; walkableTop: boolean; isRampOrStairs: boolean }> = [];
  for (const lc of def.localColliders) {
    const worldBox = rotateLocalBoxToWorld(obj, lc.center, lc.size);
    results.push({
      box: worldBox,
      wallType: obj.collision.wallType || def.defaultCollision.wallType,
      walkableTop: Boolean(obj.collision.walkableTop || lc.walkableTop),
      isRampOrStairs: Boolean(def.isRamp || def.isStairs),
    });
  }
  return results;
}

export function buildWallObstaclesFromDoc(doc: CustomMapDocument): { walls: WallObstacle[]; wallBoxes: NavWallBox[] } {
  const walls: WallObstacle[] = [];
  const wallBoxes: NavWallBox[] = [];

  for (const obj of doc.objects) {
    const cols = extractObjectColliderBoxes(obj);
    for (const c of cols) {
      // Ramps/stairs should let players walk onto them instead of pushing horizontally as solid walls
      if (!c.isRampOrStairs) {
        const dummyMesh = new THREE.Mesh();
        walls.push({
          mesh: dummyMesh,
          box: c.box,
          wallType: c.wallType,
          walkableTop: c.walkableTop,
        });
        // Skip thin low floor slabs or overhead lintels from blocking ground nav cells
        if (c.box.max.y > 0.35 && c.box.min.y < 1.85) {
          wallBoxes.push({
            minX: c.box.min.x,
            maxX: c.box.max.x,
            minZ: c.box.min.z,
            maxZ: c.box.max.z,
            maxY: c.box.max.y,
          });
        }
      }
    }
  }
  return { walls, wallBoxes };
}

export function bakeCustomMapNavigation(doc: CustomMapDocument): CustomNavBakeResult {
  const halfX = Math.max(8, (doc.boundaries.maxX - doc.boundaries.minX) * 0.5 || doc.dimensions.width * 0.5);
  const halfZ = Math.max(8, (doc.boundaries.maxZ - doc.boundaries.minZ) * 0.5 || doc.dimensions.depth * 0.5);
  const cellSize = Math.max(0.75, Math.min(2.5, doc.navigation.cellSize || 1.0));
  const clearance = Math.max(0.3, Math.min(1.0, doc.navigation.agentRadius || 0.54));

  const { wallBoxes } = buildWallObstaclesFromDoc(doc);

  // Also detect steep terrain slope cells that block walking
  const cols = Math.max(4, Math.round((halfX * 2) / cellSize));
  const rows = Math.max(4, Math.round((halfZ * 2) / cellSize));
  const maxTan = Math.tan(THREE.MathUtils.degToRad(Math.max(15, Math.min(75, doc.navigation.maxSlopeDeg || 45))));
  const slopeBlockedIndices = new Set<number>();

  if (doc.terrain.enabled) {
    for (let gz = 0; gz < rows; gz++) {
      for (let gx = 0; gx < cols; gx++) {
        const wx = -halfX + (gx + 0.5) * cellSize;
        const wz = -halfZ + (gz + 0.5) * cellSize;
        const hL = sampleTerrainHeight(doc.terrain, wx - cellSize * 0.5, wz);
        const hR = sampleTerrainHeight(doc.terrain, wx + cellSize * 0.5, wz);
        const hU = sampleTerrainHeight(doc.terrain, wx, wz - cellSize * 0.5);
        const hD = sampleTerrainHeight(doc.terrain, wx, wz + cellSize * 0.5);
        const slopeX = Math.abs(hR - hL) / cellSize;
        const slopeZ = Math.abs(hD - hU) / cellSize;
        if (Math.max(slopeX, slopeZ) > maxTan) {
          slopeBlockedIndices.add(gz * cols + gx);
          wallBoxes.push({
            minX: wx - cellSize * 0.48,
            maxX: wx + cellSize * 0.48,
            minZ: wz - cellSize * 0.48,
            maxZ: wz + cellSize * 0.48,
            maxY: 3.0,
          });
        }
      }
    }
  }

  const navGrid = new NavGrid({
    halfX,
    halfZ,
    walls: wallBoxes,
    cellSize,
    clearance,
  });

  // Find dominant connected component
  const compSizes = new Map<number, number>();
  for (let i = 0; i < navGrid.componentId.length; i++) {
    const cid = navGrid.componentId[i];
    if (cid > 0) compSizes.set(cid, (compSizes.get(cid) ?? 0) + 1);
  }
  let mainComponentId = 1;
  let maxCompSize = -1;
  for (const [cid, sz] of compSizes.entries()) {
    if (sz > maxCompSize) {
      maxCompSize = sz;
      mainComponentId = cid;
    }
  }

  // Generate SndMapGrid string rows
  const gridCells: string[] = [];
  for (let r = 0; r < navGrid.rows; r++) {
    let rowStr = '';
    for (let c = 0; c < navGrid.cols; c++) {
      rowStr += navGrid.blocked[r * navGrid.cols + c] ? '#' : '.';
    }
    gridCells.push(rowStr);
  }
  const sndGrid: SndMapGrid = {
    cols: navGrid.cols,
    rows: navGrid.rows,
    cellSize: navGrid.cellSize,
    halfX: navGrid.halfX,
    halfZ: navGrid.halfZ,
    cells: gridCells,
  };

  // Sample sparse connected waypoints for SndModeAdapter / findWaypointPath
  const waypoints: SndWaypoint[] = [];
  const stride = Math.max(3, Math.round(6 / navGrid.cellSize));
  for (let r = 2; r < navGrid.rows - 2; r += stride) {
    for (let c = 2; c < navGrid.cols - 2; c += stride) {
      if (!navGrid.isCellWalkable(c, r)) continue;
      if (navGrid.componentId[r * navGrid.cols + c] !== mainComponentId) continue;
      const p = navGrid.cellCenter(c, r);
      const y = sampleMapSurfaceHeight(doc, p.x, p.z, 0);
      waypoints.push({ id: `wp_${c}_${r}`, pos: { x: p.x, y, z: p.z }, neighbors: [] });
    }
  }
  // Ensure spawns & objectives also appear in waypoint graph
  for (const obj of doc.objects) {
    if (obj.category === 'spawns' || obj.category === 'objectives') {
      const nearest = navGrid.findNearestWalkable(obj.position[0], obj.position[2], 6);
      if (nearest) {
        waypoints.push({
          id: `wp_gp_${obj.id}`,
          pos: { x: nearest.x, y: obj.position[1], z: nearest.z },
          neighbors: [],
        });
      }
    }
  }
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      const a = waypoints[i];
      const b = waypoints[j];
      if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) <= 13 && navGrid.hasWalkableLine(a.pos, b.pos, 0.25)) {
        a.neighbors.push(b.id);
        b.neighbors.push(a.id);
      }
    }
  }

  return {
    navGrid,
    sndGrid,
    waypoints,
    walkableCells: navGrid.walkableCount,
    blockedCells: navGrid.blocked.length - navGrid.walkableCount,
    componentCount: compSizes.size,
    mainComponentId,
    wallBoxes,
    slopeBlockedIndices,
  };
}

export function buildNavMeshOverlay(bake: CustomNavBakeResult, doc: CustomMapDocument): THREE.Group {
  const g = new THREE.Group();
  g.name = '__navmesh_overlay__';
  const grid = bake.navGrid;
  const total = grid.cols * grid.rows;
  if (total === 0) return g;

  const boxGeo = new THREE.PlaneGeometry(grid.cellSize * 0.86, grid.cellSize * 0.86);
  boxGeo.rotateX(-Math.PI * 0.5);
  const mat = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const inst = new THREE.InstancedMesh(boxGeo, mat, total);
  const dummy = new THREE.Object3D();
  const cWalk = new THREE.Color('#22c55e');
  const cIsland = new THREE.Color('#f59e0b');
  const cBlock = new THREE.Color('#ef4444');

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const idx = r * grid.cols + c;
      const p = grid.cellCenter(c, r);
      const y = sampleTerrainHeight(doc.terrain, p.x, p.z) + 0.06;
      dummy.position.set(p.x, y, p.z);
      dummy.updateMatrix();
      inst.setMatrixAt(idx, dummy.matrix);
      if (grid.blocked[idx]) {
        inst.setColorAt(idx, cBlock);
      } else if (grid.componentId[idx] !== bake.mainComponentId) {
        inst.setColorAt(idx, cIsland);
      } else {
        inst.setColorAt(idx, cWalk);
      }
    }
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  g.add(inst);
  return g;
}

export function validateCustomMap(
  doc: CustomMapDocument,
  existingBake?: CustomNavBakeResult,
): { issues: ValidationIssue[]; summary: ValidationSummary; bakeResult: CustomNavBakeResult } {
  const bakeResult = existingBake ?? bakeCustomMapNavigation(doc);
  const issues: ValidationIssue[] = [];
  const push = (issue: Omit<ValidationIssue, 'id'>) => {
    issues.push({ ...issue, id: createUniqueId('val') });
  };

  const { minX, maxX, minZ, maxZ, maxY, encloseWalls } = doc.boundaries;
  const nav = bakeResult.navGrid;

  if (!encloseWalls) {
    push({
      severity: 'warning',
      code: 'OPEN_BOUNDARIES',
      category: 'boundary',
      message: 'Perimeter walls are disabled (boundaries are open beyond playable edge).',
      focusPos: [0, 2, minZ],
    });
  }

  // Per-object validation: assets, transforms, bounds, collision, floating
  const solidColliders: Array<{ obj: MapObject; box: THREE.Box3 }> = [];

  for (const obj of doc.objects) {
    const def = getAssetDefinition(obj.assetId);
    if (!def) {
      push({
        severity: 'error',
        code: 'MISSING_ASSET',
        category: 'asset',
        message: `Object "${obj.name}" references unknown assetId "${obj.assetId}".`,
        objectId: obj.id,
        focusPos: obj.position,
      });
      continue;
    }

    const badTransform =
      !obj.position.every(Number.isFinite) ||
      !obj.rotation.every(Number.isFinite) ||
      !obj.scale.every((s) => Number.isFinite(s) && Math.abs(s) > 0.01);
    if (badTransform) {
      push({
        severity: 'error',
        code: 'INVALID_TRANSFORM',
        category: 'collision',
        message: `Object "${obj.name}" has non-finite or zero scale transform.`,
        objectId: obj.id,
        focusPos: [0, 1, 0],
      });
      continue;
    }

    const [px, py, pz] = obj.position;
    const isGameplay = obj.category === 'spawns' || obj.category === 'objectives';
    if (px < minX || px > maxX || pz < minZ || pz > maxZ || py < -15 || py > maxY + 4) {
      push({
        severity: isGameplay ? 'error' : 'warning',
        code: 'OUT_OF_BOUNDS',
        category: 'boundary',
        message: `${isGameplay ? 'Gameplay object' : 'Object'} "${obj.name}" is outside map boundaries (${px.toFixed(1)}, ${py.toFixed(1)}, ${pz.toFixed(1)}).`,
        objectId: obj.id,
        focusPos: obj.position,
      });
    }

    if (
      (obj.category === 'buildings' || obj.category === 'geometry') &&
      obj.assetId !== 'mod_trim' &&
      !obj.collision.enabled
    ) {
      push({
        severity: 'warning',
        code: 'MISSING_COLLISION',
        category: 'collision',
        message: `Structural object "${obj.name}" has collision disabled.`,
        objectId: obj.id,
        focusPos: obj.position,
      });
    }

    // Floating check (ignore lights, roofs, ceilings, trim)
    const canFloatNaturally =
      obj.category === 'lighting' ||
      obj.category === 'zones' ||
      obj.assetId.includes('roof') ||
      obj.assetId.includes('ceiling') ||
      obj.assetId === 'mod_trim' ||
      obj.assetId === 'mod_platform' ||
      obj.assetId === 'gnd_metal_platform' ||
      obj.assetId === 'ind_catwalk';
    if (!canFloatNaturally) {
      const groundH = doc.terrain.enabled ? sampleTerrainHeight(doc.terrain, px, pz) : 0;
      if (py - groundH > 0.75) {
        // Check if supported by another collider below
        const hasSupportBelow = doc.objects.some((other) => {
          if (other.id === obj.id || !other.visible || !other.collision?.enabled) return false;
          const cols = extractObjectColliderBoxes(other);
          return cols.some((c) => px >= c.box.min.x - 0.5 && px <= c.box.max.x + 0.5 && pz >= c.box.min.z - 0.5 && pz <= c.box.max.z + 0.5 && Math.abs(c.box.max.y - py) < 0.7);
        });
        if (!hasSupportBelow) {
          push({
            severity: 'warning',
            code: 'FLOATING_OBJECT',
            category: 'collision',
            message: `"${obj.name}" appears to be floating ${(py - groundH).toFixed(1)}m above ground.`,
            objectId: obj.id,
            focusPos: obj.position,
          });
        }
      }
    }

    if (obj.collision.enabled && (obj.category === 'geometry' || obj.category === 'props')) {
      for (const c of extractObjectColliderBoxes(obj)) {
        solidColliders.push({ obj, box: c.box });
      }
    }
  }

  // Exact overlap check for props/geometry (>85% identical centers)
  for (let i = 0; i < solidColliders.length; i++) {
    for (let j = i + 1; j < solidColliders.length; j++) {
      const a = solidColliders[i];
      const b = solidColliders[j];
      if (a.obj.id === b.obj.id) continue;
      if (a.box.intersectsBox(b.box)) {
        const ca = a.box.getCenter(new THREE.Vector3());
        const cb = b.box.getCenter(new THREE.Vector3());
        if (ca.distanceTo(cb) < 0.35) {
          push({
            severity: 'warning',
            code: 'OVERLAPPING_OBJECTS',
            category: 'collision',
            message: `"${a.obj.name}" and "${b.obj.name}" are heavily overlapping at the same coordinates.`,
            objectId: a.obj.id,
            focusPos: [ca.x, ca.y, ca.z],
          });
        }
      }
    }
  }

  // Navigation checks
  if (bakeResult.walkableCells === 0) {
    push({
      severity: 'error',
      code: 'NO_NAV_DATA',
      category: 'navigation',
      message: 'Navigation bake found 0 walkable cells! Remove obstacles or enable terrain.',
      focusPos: [0, 2, 0],
    });
  } else if (bakeResult.componentCount > 1) {
    push({
      severity: 'warning',
      code: 'DISCONNECTED_NAV',
      category: 'navigation',
      message: `NavMesh contains ${bakeResult.componentCount} disconnected walkable islands. Connect areas with doorways or ramps.`,
      focusPos: [0, 2, 0],
    });
  }
  if (doc.navigation.dirty) {
    push({
      severity: 'info',
      code: 'NAV_STALE',
      category: 'navigation',
      message: 'Navigation summary was outdated and has been freshly evaluated.',
    });
  }

  // Gameplay objects & mode-specific rules
  const atkSpawns = doc.objects.filter((o) => o.visible && o.gameplayProps?.role === 'spawn_attacker');
  const defSpawns = doc.objects.filter((o) => o.visible && o.gameplayProps?.role === 'spawn_defender');
  const ffaSpawns = doc.objects.filter((o) => o.visible && o.gameplayProps?.role === 'spawn_ffa');
  const teamZones = doc.objects.filter((o) => o.visible && o.gameplayProps?.role === 'spawn_team_zone');
  const siteA = doc.objects.filter((o) => o.visible && o.gameplayProps?.role === 'site_a');
  const siteB = doc.objects.filter((o) => o.visible && o.gameplayProps?.role === 'site_b');
  const capturePts = doc.objects.filter((o) => o.visible && (o.gameplayProps?.role === 'capture_point' || o.gameplayProps?.role === 'hardpoint'));

  const validateSpawnWalkability = (sp: MapObject, label: string) => {
    const p = { x: sp.position[0], y: sp.position[1], z: sp.position[2] };
    if (!nav.isWalkable(p.x, p.z)) {
      push({
        severity: 'error',
        code: 'SPAWN_BLOCKED',
        category: 'gameplay',
        message: `${label} "${sp.name}" is inside an obstacle, steep slope, or outside boundaries.`,
        objectId: sp.id,
        focusPos: sp.position,
      });
    }
    return p;
  };

  const atkPts = atkSpawns.map((s) => ({ obj: s, pos: validateSpawnWalkability(s, 'Attacker spawn') }));
  const defPts = defSpawns.map((s) => ({ obj: s, pos: validateSpawnWalkability(s, 'Defender spawn') }));
  const ffaPts = ffaSpawns.map((s) => ({ obj: s, pos: validateSpawnWalkability(s, 'FFA spawn') }));

  // Check overlapping spawns
  const allSpawns = [...atkSpawns, ...defSpawns, ...ffaSpawns];
  for (let i = 0; i < allSpawns.length; i++) {
    for (let j = i + 1; j < allSpawns.length; j++) {
      const a = allSpawns[i];
      const b = allSpawns[j];
      const d = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);
      if (d < 0.85) {
        push({
          severity: 'warning',
          code: 'OVERLAPPING_SPAWNS',
          category: 'gameplay',
          message: `Spawn "${a.name}" overlaps spawn "${b.name}".`,
          objectId: a.id,
          focusPos: a.position,
        });
      }
    }
  }

  const isSnd = doc.supportedModes.includes('snd');
  const isDefend = doc.supportedModes.includes('defend');
  const hasStandardCombat = doc.supportedModes.some((m) => m === 'dm' || m === 'arena' || m === 'hvh' || m === 'range');

  if (isSnd) {
    if (atkSpawns.length === 0 && teamZones.length === 0) {
      push({ severity: 'error', code: 'SND_NO_ATTACKER_SPAWN', category: 'gameplay', message: 'Search & Destroy requires at least 1 Attacker Spawn.' });
    } else if (atkSpawns.length < 5) {
      push({ severity: 'info', code: 'SND_FEW_ATK', category: 'gameplay', message: `Only ${atkSpawns.length} Attacker Spawn(s) placed; 5+ recommended for 5v5 S&D.` });
    }
    if (defSpawns.length === 0 && teamZones.length === 0) {
      push({ severity: 'error', code: 'SND_NO_DEFENDER_SPAWN', category: 'gameplay', message: 'Search & Destroy requires at least 1 Defender Spawn.' });
    } else if (defSpawns.length < 5) {
      push({ severity: 'info', code: 'SND_FEW_DEF', category: 'gameplay', message: `Only ${defSpawns.length} Defender Spawn(s) placed; 5+ recommended for 5v5 S&D.` });
    }
    if (siteA.length === 0) {
      push({ severity: 'error', code: 'SND_NO_SITE_A', category: 'gameplay', message: 'Search & Destroy requires Objective Site A.' });
    }
    if (siteB.length === 0) {
      push({ severity: 'error', code: 'SND_NO_SITE_B', category: 'gameplay', message: 'Search & Destroy requires Objective Site B.' });
    }

    for (const siteObj of [...siteA, ...siteB]) {
      const sp = { x: siteObj.position[0], y: siteObj.position[1], z: siteObj.position[2] };
      const rad = siteObj.gameplayProps?.radius ?? 4.5;
      if (rad < 2.0) {
        push({
          severity: 'error',
          code: 'INVALID_SITE_RADIUS',
          category: 'gameplay',
          message: `Objective "${siteObj.name}" has interaction radius ${rad.toFixed(1)}m (< 2.0m minimum).`,
          objectId: siteObj.id,
          focusPos: siteObj.position,
        });
      }
      if (!nav.isWalkable(sp.x, sp.z)) {
        push({
          severity: 'error',
          code: 'SITE_BLOCKED',
          category: 'gameplay',
          message: `Objective "${siteObj.name}" center is not walkable!`,
          objectId: siteObj.id,
          focusPos: siteObj.position,
        });
      }
      if (atkPts[0] && !nav.arePointsConnected(atkPts[0].pos, sp)) {
        push({
          severity: 'error',
          code: 'SITE_UNREACHABLE_T',
          category: 'navigation',
          message: `Objective "${siteObj.name}" is unreachable from Attacker Spawn "${atkPts[0].obj.name}".`,
          objectId: siteObj.id,
          focusPos: siteObj.position,
        });
      }
      if (defPts[0] && !nav.arePointsConnected(defPts[0].pos, sp)) {
        push({
          severity: 'error',
          code: 'SITE_UNREACHABLE_CT',
          category: 'navigation',
          message: `Objective "${siteObj.name}" is unreachable from Defender Spawn "${defPts[0].obj.name}".`,
          objectId: siteObj.id,
          focusPos: siteObj.position,
        });
      }
    }
  }

  if (isDefend && siteA.length === 0 && capturePts.length === 0) {
    push({
      severity: 'error',
      code: 'DEFEND_NO_SITE',
      category: 'gameplay',
      message: 'Site Defense mode requires an Objective Site A or Capture Point.',
    });
  }

  if (hasStandardCombat) {
    const playerPool = [...atkPts, ...ffaPts];
    const enemyPool = [...defPts, ...ffaPts];
    if (playerPool.length === 0) {
      push({ severity: 'error', code: 'NO_PLAYER_SPAWN', category: 'gameplay', message: 'Place at least 1 Player / Attacker / FFA Spawn.' });
    }
    if (enemyPool.length === 0) {
      push({ severity: 'error', code: 'NO_BOT_SPAWN', category: 'gameplay', message: 'Place at least 1 Bot / Defender / FFA Spawn.' });
    }
    if (playerPool[0] && enemyPool[0] && !nav.arePointsConnected(playerPool[0].pos, enemyPool[0].pos)) {
      push({
        severity: 'error',
        code: 'SPAWNS_DISCONNECTED',
        category: 'navigation',
        message: `Spawn "${playerPool[0].obj.name}" cannot reach "${enemyPool[0].obj.name}" on the NavMesh.`,
        objectId: enemyPool[0].obj.id,
        focusPos: enemyPool[0].obj.position,
      });
    }
  }

  if (doc.lighting.sunIntensity <= 0.05 && !doc.objects.some((o) => o.category === 'lighting' && o.visible)) {
    push({
      severity: 'warning',
      code: 'DARK_SCENE',
      category: 'lighting',
      message: 'Sun intensity is very low and no extra light sources are placed.',
    });
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const infos = issues.filter((i) => i.severity === 'info').length;

  const summary: ValidationSummary = {
    valid: errors === 0,
    errors,
    warnings,
    infos,
    lastValidatedAt: new Date().toISOString(),
  };
  return { issues, summary, bakeResult };
}
