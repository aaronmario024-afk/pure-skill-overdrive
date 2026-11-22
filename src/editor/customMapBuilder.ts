import * as THREE from 'three';
import { ModeDef } from '../data/modes';
import { BuiltMap, WallObstacle } from '../game/maps';
import { BuiltSndMap, SndCalloutZone, SndMapMeta } from '../game/sndMaps';
import { buildAssetMesh, getCachedStandardMaterial } from './assetCatalog';
import { bakeCustomMapNavigation, extractObjectColliderBoxes } from './navAndValidation';
import { GROUND_MATERIAL_PRESETS } from './presets';
import { buildTerrainMesh, sampleMapSurfaceHeight } from './terrain';
import { CustomMapDocument, LightingConfig, MapObject } from './types';

function addObjectCollidersAndMeshes(
  obj: MapObject,
  group: THREE.Group,
  walls: WallObstacle[],
  wallMeshes: THREE.Object3D[],
): void {
  const objGroup = buildAssetMesh(obj, false);
  group.add(objGroup);

  if (obj.collision?.enabled) {
    objGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && child.userData.isWall) {
        wallMeshes.push(child);
      }
    });

    const colliders = extractObjectColliderBoxes(obj);
    for (const c of colliders) {
      // Create hidden precise box collider mesh if asset is multi-part like doorway
      const dummy = new THREE.Mesh();
      walls.push({
        mesh: dummy,
        box: c.box,
        wallType: c.wallType,
        walkableTop: c.walkableTop,
      });
    }
  }
}

function addPlacedLightsFromDoc(doc: CustomMapDocument, parent: THREE.Group): void {
  for (const obj of doc.objects) {
    if (!obj.visible || obj.category !== 'lighting' || !obj.lightProps) continue;
    const lp = obj.lightProps;
    const col = new THREE.Color(lp.color || '#ffffff');
    const pos = new THREE.Vector3(obj.position[0], obj.position[1], obj.position[2]);

    if (lp.lightType === 'point' || lp.lightType === 'area') {
      const pl = new THREE.PointLight(col, lp.intensity, lp.range || 24, lp.decay ?? 1.5);
      pl.position.copy(pos);
      parent.add(pl);
    } else if (lp.lightType === 'spot') {
      const sl = new THREE.SpotLight(
        col,
        lp.intensity,
        lp.range || 30,
        THREE.MathUtils.degToRad(Math.max(10, Math.min(85, lp.angleDeg || 42))),
        lp.penumbra ?? 0.45,
        lp.decay ?? 1.4,
      );
      sl.position.copy(pos);
      const dir = new THREE.Vector3(0, -1, 0).applyEuler(
        new THREE.Euler(
          THREE.MathUtils.degToRad(obj.rotation[0] || 0),
          THREE.MathUtils.degToRad(obj.rotation[1] || 0),
          THREE.MathUtils.degToRad(obj.rotation[2] || 0),
          'YXZ',
        ),
      );
      sl.target.position.copy(pos).addScaledVector(dir, 6);
      parent.add(sl);
      parent.add(sl.target);
    } else if (lp.lightType === 'directional') {
      const dl = new THREE.DirectionalLight(col, lp.intensity);
      dl.position.copy(pos);
      parent.add(dl);
    }
  }
}

function buildPerimeterWalls(
  doc: CustomMapDocument,
  group: THREE.Group,
  walls: WallObstacle[],
  wallMeshes: THREE.Object3D[],
): void {
  if (!doc.boundaries.encloseWalls) return;
  const { minX, maxX, minZ, maxZ, maxY } = doc.boundaries;
  const bh = Math.max(8, Math.min(18, maxY));
  const wX = maxX - minX;
  const dZ = maxZ - minZ;
  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const mat = getCachedStandardMaterial(GROUND_MATERIAL_PRESETS.concrete.material);

  const specs: Array<[number, number, number, number]> = [
    [cx, minZ - 0.5, wX + 2, 1],
    [cx, maxZ + 0.5, wX + 2, 1],
    [minX - 0.5, cz, 1, dZ + 2],
    [maxX + 0.5, cz, 1, dZ + 2],
  ];
  for (const [x, z, w, d] of specs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, bh, d), mat);
    m.position.set(x, bh * 0.5 - 2, z);
    m.receiveShadow = true;
    m.userData = { isWall: true, wallType: 'solid' };
    group.add(m);
    const box = new THREE.Box3().setFromCenterAndSize(m.position.clone(), new THREE.Vector3(w, bh, d));
    walls.push({ mesh: m, box, wallType: 'solid' });
    wallMeshes.push(m);
  }
}

export function applyCustomLightingToScene(
  scene: THREE.Scene,
  cfg: LightingConfig,
  boundsExtent = 48,
): { dispose: () => void } {
  scene.background = new THREE.Color(cfg.skyColor || '#4da6e8');
  scene.fog = new THREE.FogExp2(cfg.fogColor || cfg.skyColor, Math.max(0, cfg.fogDensity ?? 0.008));

  const created: THREE.Object3D[] = [];
  const hemi = new THREE.HemisphereLight(cfg.hemiSky, cfg.hemiGround, cfg.hemiIntensity);
  scene.add(hemi);
  created.push(hemi);

  if (cfg.ambientIntensity > 0.005) {
    const amb = new THREE.AmbientLight(cfg.ambientColor, cfg.ambientIntensity);
    scene.add(amb);
    created.push(amb);
  }

  const az = THREE.MathUtils.degToRad(cfg.sunAzimuthDeg || 38);
  const el = THREE.MathUtils.degToRad(Math.max(5, Math.min(89, cfg.sunElevationDeg || 52)));
  const dist = Math.max(40, boundsExtent * 1.1);
  const sun = new THREE.DirectionalLight(cfg.sunColor, cfg.sunIntensity);
  sun.position.set(
    Math.cos(el) * Math.sin(az) * dist,
    Math.sin(el) * dist,
    Math.cos(el) * Math.cos(az) * dist,
  );
  sun.castShadow = Boolean(cfg.sunCastShadow);
  if (sun.castShadow) {
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    const camSpan = Math.max(30, boundsExtent);
    sun.shadow.camera.left = -camSpan;
    sun.shadow.camera.right = camSpan;
    sun.shadow.camera.top = camSpan;
    sun.shadow.camera.bottom = -camSpan;
    sun.shadow.camera.far = dist * 3;
  }
  scene.add(sun);
  created.push(sun);

  return {
    dispose: () => {
      for (const l of created) {
        scene.remove(l);
      }
    },
  };
}

function disposeGroupResources(group: THREE.Group): void {
  group.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      m.geometry?.dispose();
    }
  });
}

export function buildCustomStandardMap(doc: CustomMapDocument, _mode: ModeDef): BuiltMap {
  const group = new THREE.Group();
  const walls: WallObstacle[] = [];
  const wallMeshes: THREE.Object3D[] = [];
  const halfExtent = Math.max(12, Math.max(doc.dimensions.width, doc.dimensions.depth) * 0.5);

  if (doc.terrain.enabled) {
    const terrainMesh = buildTerrainMesh(doc.terrain);
    group.add(terrainMesh);
  } else {
    // Invisible flat collision floor plane at y=0 if terrain disabled
    const fallbackFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(doc.dimensions.width, doc.dimensions.depth),
      getCachedStandardMaterial(GROUND_MATERIAL_PRESETS.concrete.material),
    );
    fallbackFloor.rotation.x = -Math.PI * 0.5;
    fallbackFloor.receiveShadow = true;
    group.add(fallbackFloor);
  }

  buildPerimeterWalls(doc, group, walls, wallMeshes);

  for (const obj of doc.objects) {
    if (!obj.visible) continue;
    if (obj.category === 'spawns' || obj.category === 'objectives' || obj.category === 'zones' || obj.category === 'lighting') {
      continue;
    }
    addObjectCollidersAndMeshes(obj, group, walls, wallMeshes);
  }

  addPlacedLightsFromDoc(doc, group);

  const atkSpawns = doc.objects
    .filter((o) => o.visible && (o.gameplayProps?.role === 'spawn_attacker' || o.gameplayProps?.role === 'spawn_ffa' || o.gameplayProps?.role === 'spawn_team_zone'))
    .map((o) => new THREE.Vector3(o.position[0], sampleMapSurfaceHeight(doc, o.position[0], o.position[2], o.position[1]), o.position[2]));
  const defSpawns = doc.objects
    .filter((o) => o.visible && (o.gameplayProps?.role === 'spawn_defender' || o.gameplayProps?.role === 'spawn_ffa'))
    .map((o) => new THREE.Vector3(o.position[0], sampleMapSurfaceHeight(doc, o.position[0], o.position[2], o.position[1]), o.position[2]));

  const playerSpawns = atkSpawns.length > 0 ? atkSpawns : [new THREE.Vector3(0, sampleMapSurfaceHeight(doc, 0, halfExtent * 0.45, 0), halfExtent * 0.45)];
  const botSpawns = defSpawns.length > 0 ? defSpawns : [new THREE.Vector3(0, sampleMapSurfaceHeight(doc, 0, -halfExtent * 0.45, 0), -halfExtent * 0.45)];

  const siteObj = doc.objects.find((o) => o.visible && (o.gameplayProps?.role === 'site_a' || o.gameplayProps?.role === 'capture_point' || o.gameplayProps?.role === 'hardpoint'));
  let sitePos: THREE.Vector3 | undefined;
  let siteRadius: number | undefined;
  let siteRing: THREE.Mesh | undefined;
  let siteBeaconLight: THREE.PointLight | undefined;

  if (siteObj) {
    const sy = sampleMapSurfaceHeight(doc, siteObj.position[0], siteObj.position[2], siteObj.position[1]);
    sitePos = new THREE.Vector3(siteObj.position[0], sy, siteObj.position[2]);
    siteRadius = Math.max(2.5, siteObj.gameplayProps?.radius ?? 5);
    siteRing = new THREE.Mesh(
      new THREE.RingGeometry(siteRadius - 0.35, siteRadius, 48),
      new THREE.MeshBasicMaterial({ color: '#facc15', side: THREE.DoubleSide, transparent: true, opacity: 0.72 }),
    );
    siteRing.rotation.x = -Math.PI * 0.5;
    siteRing.position.set(sitePos.x, sy + 0.05, sitePos.z);
    group.add(siteRing);

    siteBeaconLight = new THREE.PointLight('#ef4444', 2.2, 9);
    siteBeaconLight.position.set(sitePos.x, sy + 1.5, sitePos.z);
    group.add(siteBeaconLight);
  }

  const animate = (elapsedSec: number) => {
    if (siteRing) {
      const m = siteRing.material as THREE.MeshBasicMaterial;
      m.opacity = 0.56 + Math.sin(elapsedSec * 2.8) * 0.2;
    }
  };

  return {
    group,
    walls,
    wallMeshes,
    playerSpawns,
    botSpawns,
    sitePos,
    siteRadius,
    siteRing,
    siteBeaconLight,
    halfExtent,
    sampleGroundHeight: (x: number, z: number, curY?: number) => sampleMapSurfaceHeight(doc, x, z, curY),
    customLighting: doc.lighting,
    mapDisplayName: doc.name,
    animate,
    dispose: () => disposeGroupResources(group),
  };
}

export function buildCustomSndMap(doc: CustomMapDocument): BuiltSndMap {
  const group = new THREE.Group();
  const walls: WallObstacle[] = [];
  const wallMeshes: THREE.Object3D[] = [];
  const halfX = Math.max(12, doc.dimensions.width * 0.5);
  const halfZ = Math.max(12, doc.dimensions.depth * 0.5);

  if (doc.terrain.enabled) {
    group.add(buildTerrainMesh(doc.terrain));
  } else {
    const fallbackFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(doc.dimensions.width, doc.dimensions.depth),
      getCachedStandardMaterial(GROUND_MATERIAL_PRESETS.concrete.material),
    );
    fallbackFloor.rotation.x = -Math.PI * 0.5;
    fallbackFloor.receiveShadow = true;
    group.add(fallbackFloor);
  }

  buildPerimeterWalls(doc, group, walls, wallMeshes);

  for (const obj of doc.objects) {
    if (!obj.visible) continue;
    if (obj.category === 'spawns' || obj.category === 'objectives' || obj.category === 'zones' || obj.category === 'lighting') {
      continue;
    }
    addObjectCollidersAndMeshes(obj, group, walls, wallMeshes);
  }
  addPlacedLightsFromDoc(doc, group);

  const bake = bakeCustomMapNavigation(doc);

  const collectSpawns = (role: 'spawn_attacker' | 'spawn_defender', fallbackZ: number): THREE.Vector3[] => {
    const base = doc.objects
      .filter((o) => o.visible && o.gameplayProps?.role === role)
      .map((o) => new THREE.Vector3(o.position[0], sampleMapSurfaceHeight(doc, o.position[0], o.position[2], o.position[1]), o.position[2]));
    const seed = base[0] ?? new THREE.Vector3(0, sampleMapSurfaceHeight(doc, 0, fallbackZ, 0), fallbackZ);
    const out = [...base];
    let idx = 0;
    while (out.length < 5) {
      const offX = (idx - 2) * 1.8;
      out.push(new THREE.Vector3(seed.x + offX, seed.y, seed.z));
      idx++;
    }
    return out;
  };

  const attackerSpawns = collectSpawns('spawn_attacker', Math.max(6, halfZ - 6));
  const defenderSpawns = collectSpawns('spawn_defender', -Math.max(6, halfZ - 6));

  const siteAObj = doc.objects.find((o) => o.visible && o.gameplayProps?.role === 'site_a');
  const siteBObj = doc.objects.find((o) => o.visible && o.gameplayProps?.role === 'site_b');

  const siteAPos = siteAObj ? siteAObj.position : [-Math.min(12, halfX * 0.45), 0, -2];
  const siteBPos = siteBObj ? siteBObj.position : [Math.min(12, halfX * 0.45), 0, -2];
  const radA = Math.max(2.5, siteAObj?.gameplayProps?.radius ?? 4.5);
  const radB = Math.max(2.5, siteBObj?.gameplayProps?.radius ?? 4.5);

  const makeSiteRing = (x: number, y: number, z: number, radius: number, color: string): THREE.Mesh => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.3, radius, 40),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.72 }),
    );
    ring.rotation.x = -Math.PI * 0.5;
    ring.position.set(x, y + 0.05, z);
    group.add(ring);

    const crateMat = getCachedStandardMaterial({ kind: 'crate', color: '#854d0e', roughness: 0.85, metalness: 0.05, normalScale: 0.8, emissive: '#000000', emissiveIntensity: 0, textureScaleX: 1, textureScaleY: 1 });
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), crateMat);
    beacon.position.set(x, y + 0.45, z + 1.2);
    beacon.castShadow = true;
    beacon.receiveShadow = true;
    group.add(beacon);
    return ring;
  };

  const syA = sampleMapSurfaceHeight(doc, siteAPos[0], siteAPos[2], siteAPos[1]);
  const syB = sampleMapSurfaceHeight(doc, siteBPos[0], siteBPos[2], siteBPos[1]);
  const siteARing = makeSiteRing(siteAPos[0], syA, siteAPos[2], radA, '#facc15');
  const siteBRing = makeSiteRing(siteBPos[0], syB, siteBPos[2], radB, '#f97316');

  const theme: SndMapMeta['theme'] =
    doc.environmentPreset === 'snow' ? 'snow' :
    doc.environmentPreset === 'night_city' ? 'night' : 'urban';
  const maxDim = Math.max(doc.dimensions.width, doc.dimensions.depth);
  const sizeLabel: SndMapMeta['sizeLabel'] = maxDim <= 52 ? 'Small' : maxDim <= 76 ? 'Medium' : 'Large';

  const meta: SndMapMeta = {
    id: 'district9',
    name: doc.name,
    tagline: doc.description || 'Custom Map',
    description: `${doc.dimensions.width}m x ${doc.dimensions.depth}m Custom S&D Map`,
    sizeLabel,
    theme,
    accent: '#22c55e',
    halfX,
    halfZ,
    skyColor: doc.lighting.skyColor,
    fogColor: doc.lighting.fogColor,
    fogDensity: doc.lighting.fogDensity,
    hemiSky: doc.lighting.hemiSky,
    hemiGround: doc.lighting.hemiGround,
    hemiIntensity: doc.lighting.hemiIntensity,
    sunColor: doc.lighting.sunColor,
    sunIntensity: doc.lighting.sunIntensity,
    floorKind: doc.terrain.baseMaterial.kind,
    floorColor: doc.terrain.baseMaterial.color,
    wallKind: 'concrete',
    wallColor: '#475569',
    crateColor: '#9a5b25',
  };

  const callouts: SndCalloutZone[] = [
    { name: 'T Spawn', minX: -halfX, maxX: halfX, minZ: halfZ * 0.35, maxZ: halfZ },
    { name: 'CT Spawn', minX: -halfX, maxX: halfX, minZ: -halfZ, maxZ: -halfZ * 0.35 },
    { name: 'Site A', minX: -halfX, maxX: 0, minZ: -halfZ * 0.35, maxZ: halfZ * 0.35 },
    { name: 'Site B', minX: 0, maxX: halfX, minZ: -halfZ * 0.35, maxZ: halfZ * 0.35 },
  ];

  const animate = (elapsedSec: number) => {
    const pulse = 0.58 + Math.sin(elapsedSec * 3.0) * 0.18;
    (siteARing.material as THREE.MeshBasicMaterial).opacity = pulse;
    (siteBRing.material as THREE.MeshBasicMaterial).opacity = pulse;
  };

  return {
    meta,
    grid: bake.sndGrid,
    callouts,
    midPos: { x: 0, y: sampleMapSurfaceHeight(doc, 0, 0, 0), z: 0 },
    group,
    walls,
    wallMeshes,
    halfX,
    halfZ,
    attackerSpawns,
    defenderSpawns,
    siteA: { id: 'A', pos: { x: siteAPos[0], y: syA, z: siteAPos[2] }, radius: radA },
    siteB: { id: 'B', pos: { x: siteBPos[0], y: syB, z: siteBPos[2] }, radius: radB },
    waypoints: bake.waypoints,
    siteARing,
    siteBRing,
    sampleGroundHeight: (x: number, z: number, curY?: number) => sampleMapSurfaceHeight(doc, x, z, curY),
    customLighting: doc.lighting,
    animate,
    dispose: () => disposeGroupResources(group),
  };
}
