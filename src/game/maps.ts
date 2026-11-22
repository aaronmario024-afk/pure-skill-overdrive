import * as THREE from 'three';
import { ModeDef, ModeId } from '../data/modes';
import { createPBRSurface } from './textures';

export type WallType = 'thin' | 'crate' | 'solid';

export interface WallObstacle {
  mesh: THREE.Mesh;
  box: THREE.Box3;
  wallType: WallType;
  walkableTop?: boolean;
}

export interface StandardBoxSpec {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  wallType: WallType;
}

export interface StandardMapLayout {
  modeId: ModeId;
  halfExtent: number;
  boxes: StandardBoxSpec[];
  playerSpawns: Array<{ x: number; y: number; z: number }>;
  botSpawns: Array<{ x: number; y: number; z: number }>;
  sitePos?: { x: number; y: number; z: number };
  siteRadius?: number;
}

export function getStandardMapLayout(modeId: ModeId): StandardMapLayout {
  const halfExtent = modeId === 'arena' ? 18 : modeId === 'range' ? 22 : 28;
  const bh = 10; // Increased wall height to prevent camera peeking over edges
  const boxes: StandardBoxSpec[] = [
    { x: 0, y: 0, z: -halfExtent - 0.5, w: halfExtent * 2 + 2, h: bh, d: 1, wallType: 'solid' },
    { x: 0, y: 0, z: halfExtent + 0.5, w: halfExtent * 2 + 2, h: bh, d: 1, wallType: 'solid' },
    { x: -halfExtent - 0.5, y: 0, z: 0, w: 1, h: bh, d: halfExtent * 2 + 2, wallType: 'solid' },
    { x: halfExtent + 0.5, y: 0, z: 0, w: 1, h: bh, d: halfExtent * 2 + 2, wallType: 'solid' },
  ];

  if (modeId === 'range') {
    boxes.push(
      { x: -7, y: 0, z: -4, w: 3.6, h: 2.8, d: 0.35, wallType: 'thin' },
      { x: 7, y: 0, z: -4, w: 2.2, h: 2.2, d: 2.2, wallType: 'crate' },
      { x: 0, y: 0, z: 4, w: 8, h: 1.1, d: 0.5, wallType: 'solid' },
    );
    return {
      modeId,
      halfExtent,
      boxes,
      playerSpawns: [{ x: 0, y: 0, z: 8 }],
      botSpawns: [
        { x: -6, y: 0, z: -10 },
        { x: 0, y: 0, z: -11 },
        { x: 6, y: 0, z: -10 },
      ],
    };
  }

  if (modeId === 'arena') {
    boxes.push(
      { x: 0, y: 0, z: 0, w: 4.2, h: 2.6, d: 2.2, wallType: 'crate' },
      { x: -7.5, y: 0, z: 0, w: 0.4, h: 3.2, d: 5.5, wallType: 'thin' },
      { x: 7.5, y: 0, z: 0, w: 0.4, h: 3.2, d: 5.5, wallType: 'thin' },
      { x: -5, y: 0, z: -6.5, w: 2.2, h: 2.2, d: 2.2, wallType: 'crate' },
      { x: 5, y: 0, z: -6.5, w: 2.2, h: 2.2, d: 2.2, wallType: 'crate' },
      { x: -5, y: 0, z: 6.5, w: 2.2, h: 2.2, d: 2.2, wallType: 'crate' },
      { x: 5, y: 0, z: 6.5, w: 2.2, h: 2.2, d: 2.2, wallType: 'crate' },
      // Full-height spawn protection bulkheads + wing shields blocking diagonal spawn peeks
      { x: 0, y: 0, z: -11, w: 6.4, h: 2.8, d: 1.2, wallType: 'solid' },
      { x: 0, y: 0, z: 11, w: 6.4, h: 2.8, d: 1.2, wallType: 'solid' },
      { x: -10.5, y: 0, z: -9.2, w: 3.6, h: 2.8, d: 1.0, wallType: 'solid' },
      { x: 10.5, y: 0, z: -9.2, w: 3.6, h: 2.8, d: 1.0, wallType: 'solid' },
      { x: -10.5, y: 0, z: 9.2, w: 3.6, h: 2.8, d: 1.0, wallType: 'solid' },
      { x: 10.5, y: 0, z: 9.2, w: 3.6, h: 2.8, d: 1.0, wallType: 'solid' },
    );
    return {
      modeId,
      halfExtent,
      boxes,
      playerSpawns: [{ x: 0, y: 0, z: 14.5 }],
      botSpawns: [
        { x: 0, y: 0, z: -14.5 },
        { x: -12, y: 0, z: -12.5 },
        { x: 12, y: 0, z: -12.5 },
      ],
    };
  }

  if (modeId === 'defend') {
    boxes.push(
      { x: -3.8, y: 0, z: 10, w: 2.2, h: 2.0, d: 2.2, wallType: 'crate' },
      { x: 3.8, y: 0, z: 10, w: 2.2, h: 2.2, d: 2.2, wallType: 'crate' },
      { x: 0, y: 0, z: 6.2, w: 3.6, h: 2.8, d: 0.9, wallType: 'solid' },
      { x: -11, y: 0, z: 2, w: 10, h: 3.8, d: 1.2, wallType: 'solid' },
      { x: 11, y: 0, z: 2, w: 10, h: 3.8, d: 1.2, wallType: 'solid' },
      { x: 0, y: 0, z: -2, w: 5.5, h: 3.0, d: 0.4, wallType: 'thin' },
      { x: -5.2, y: 0, z: -6.5, w: 3.2, h: 2.8, d: 1.0, wallType: 'solid' },
      { x: 5.2, y: 0, z: -6.5, w: 3.2, h: 2.8, d: 1.0, wallType: 'solid' },
      { x: -8, y: 0, z: -10, w: 0.45, h: 3.2, d: 6, wallType: 'thin' },
      { x: 8, y: 0, z: -10, w: 0.45, h: 3.2, d: 6, wallType: 'thin' },
      { x: 0, y: 0, z: -13, w: 3.2, h: 2.6, d: 3.0, wallType: 'crate' },
      { x: -15.5, y: 0, z: -15.5, w: 4.2, h: 2.8, d: 1.1, wallType: 'solid' },
      { x: 15.5, y: 0, z: -15.5, w: 4.2, h: 2.8, d: 1.1, wallType: 'solid' },
    );
    return {
      modeId,
      halfExtent,
      boxes,
      sitePos: { x: 0, y: 0, z: 12 },
      siteRadius: 5.2,
      playerSpawns: [{ x: 0, y: 0, z: 15.2 }],
      botSpawns: [
        { x: -18, y: 0, z: -20 },
        { x: -6, y: 0, z: -22 },
        { x: 6, y: 0, z: -22 },
        { x: 18, y: 0, z: -20 },
      ],
    };
  }

  // dm / hvh shared Icefoundry/Cybergrid layout
  boxes.push(
    { x: 0, y: 0, z: 0, w: 3.2, h: 3.2, d: 3.2, wallType: 'crate' },
    { x: -9, y: 0, z: 0, w: 0.4, h: 3.5, d: 8.5, wallType: 'thin' },
    { x: 9, y: 0, z: 0, w: 0.4, h: 3.5, d: 8.5, wallType: 'thin' },
    { x: 0, y: 0, z: -9, w: 8.5, h: 3.5, d: 0.4, wallType: 'thin' },
    { x: 0, y: 0, z: 9, w: 8.5, h: 3.5, d: 0.4, wallType: 'thin' },
  );
  for (const [cx, cz] of [[-15, -15], [15, -15], [-15, 15], [15, 15]]) {
    boxes.push(
      { x: cx, y: 0, z: cz, w: 3.2, h: 4.2, d: 3.2, wallType: 'solid' },
      { x: cx * 0.55, y: 0, z: cz * 0.85, w: 2.2, h: 2.1, d: 2.2, wallType: 'crate' },
    );
  }
  boxes.push(
    { x: -19, y: 0, z: 0, w: 5, h: 3.2, d: 0.4, wallType: 'thin' },
    { x: 19, y: 0, z: 0, w: 5, h: 3.2, d: 0.4, wallType: 'thin' },
    { x: 0, y: 0, z: -19, w: 0.4, h: 3.2, d: 5, wallType: 'thin' },
    { x: 0, y: 0, z: 19, w: 0.4, h: 3.2, d: 5, wallType: 'thin' },
    // Perimeter spawn sightline partitions preventing adjacent spawn peeking
    { x: -11, y: 0, z: 22.2, w: 1.2, h: 3.2, d: 3.4, wallType: 'solid' },
    { x: 11, y: 0, z: 22.2, w: 1.2, h: 3.2, d: 3.4, wallType: 'solid' },
    { x: -11, y: 0, z: -22.2, w: 1.2, h: 3.2, d: 3.4, wallType: 'solid' },
    { x: 11, y: 0, z: -22.2, w: 1.2, h: 3.2, d: 3.4, wallType: 'solid' },
    { x: -22.2, y: 0, z: -11, w: 3.4, h: 3.2, d: 1.2, wallType: 'solid' },
    { x: 22.2, y: 0, z: -11, w: 3.4, h: 3.2, d: 1.2, wallType: 'solid' },
    { x: -22.2, y: 0, z: 11, w: 3.4, h: 3.2, d: 1.2, wallType: 'solid' },
    { x: 22.2, y: 0, z: 11, w: 3.4, h: 3.2, d: 1.2, wallType: 'solid' },
  );
  const spawns = [
    { x: 0, y: 0, z: 23 },
    { x: 0, y: 0, z: -23 },
    { x: 23, y: 0, z: 0 },
    { x: -23, y: 0, z: 0 },
    { x: 21, y: 0, z: 21 },
    { x: -21, y: 0, z: 21 },
    { x: 21, y: 0, z: -21 },
    { x: -21, y: 0, z: -21 },
    { x: -12, y: 0, z: 12 },
    { x: 12, y: 0, z: -12 },
  ];
  return {
    modeId,
    halfExtent,
    boxes,
    playerSpawns: spawns,
    botSpawns: spawns,
  };
}

import { buildStandardEnvDetails } from './envDetails';
import { QualityTier } from './graphicsSettings';

export interface BuiltMap {
  group: THREE.Group;
  walls: WallObstacle[];
  wallMeshes: THREE.Object3D[];
  playerSpawns: THREE.Vector3[];
  botSpawns: THREE.Vector3[];
  sitePos?: THREE.Vector3;
  siteRadius?: number;
  siteRing?: THREE.Mesh;
  siteBeaconLight?: THREE.PointLight;
  halfExtent: number;
  sampleGroundHeight?: (x: number, z: number, currentY?: number) => number;
  customLighting?: unknown;
  mapDisplayName?: string;
  animate?: (elapsedSec: number, dt: number) => void;
  dispose?: () => void;
}

function makePaintedFloorStripes(half: number, modeId: string): THREE.Group {
  const g = new THREE.Group();
  const stripeMat = new THREE.MeshStandardMaterial({
    color: modeId === 'hvh' ? '#f43f5e' : modeId === 'defend' ? '#f59e0b' : '#eab308',
    roughness: 0.75,
    metalness: 0.1,
    emissive: modeId === 'hvh' ? new THREE.Color('#be123c') : new THREE.Color('#000000'),
    emissiveIntensity: modeId === 'hvh' ? 0.55 : 0,
  });

  const curbMat = new THREE.MeshStandardMaterial({
    color: modeId === 'defend' ? '#6b533b' : modeId === 'hvh' ? '#1e1b4b' : '#334155',
    roughness: 0.72,
    metalness: 0.2,
  });
  const plinthMat = new THREE.MeshStandardMaterial({
    color: modeId === 'defend' ? '#882924' : modeId === 'hvh' ? '#17153b' : '#1e293b',
    roughness: 0.78,
    metalness: 0.12,
  });

  if (modeId === 'range') {
    // 3D Raised concrete firing-line platform behind the firing desk (z = 4..10)
    const boothCurb = new THREE.Mesh(new THREE.BoxGeometry(14.4, 0.036, 7.4), curbMat);
    boothCurb.position.set(0, 0.018, 7.2);
    boothCurb.receiveShadow = true;
    g.add(boothCurb);

    const boothSlab = new THREE.Mesh(new THREE.BoxGeometry(14.0, 0.044, 7.0), plinthMat);
    boothSlab.position.set(0, 0.022, 7.2);
    boothSlab.receiveShadow = true;
    g.add(boothSlab);

    // Distance lines at 10m, 20m, 25m from firing desk (z=4) with raised 3D curb strips
    for (const [z, label] of [[-6, '10M'], [-16, '20M'], [-21, '25M']] as const) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(half * 1.4, 0.022, 0.22), stripeMat);
      strip.position.set(0, 0.011, z);
      g.add(strip);

      const c = document.createElement('canvas');
      c.width = 128; c.height = 64;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#facc15';
      ctx.font = 'bold 38px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, 64, 44);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 1.1),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
      );
      sign.rotation.x = -Math.PI / 2;
      sign.position.set(-half * 0.6, 0.026, z + 0.8);
      g.add(sign);
    }
  } else {
    // 3D Multi-layered center arena platform inlay + chamfered lane curb markings
    const centerCurb = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.032, 10.6), curbMat);
    centerCurb.position.set(0, 0.016, 0);
    centerCurb.receiveShadow = true;
    g.add(centerCurb);

    const centerSlab = new THREE.Mesh(new THREE.BoxGeometry(10.1, 0.040, 10.1), plinthMat);
    centerSlab.position.set(0, 0.020, 0);
    centerSlab.receiveShadow = true;
    g.add(centerSlab);

    const midLine = new THREE.Mesh(new THREE.BoxGeometry(half * 1.75, 0.024, 0.22), stripeMat);
    midLine.position.set(0, 0.022, 0);
    g.add(midLine);
  }
  return g;
}

export function buildMap(mode: ModeDef, lightingQuality: QualityTier = 'high'): BuiltMap {
  const group = new THREE.Group();
  const walls: WallObstacle[] = [];
  const wallMeshes: THREE.Object3D[] = [];
  const half = mode.id === 'arena' ? 18 : mode.id === 'range' ? 22 : 28;

  const floorKind =
    mode.id === 'defend' ? 'sandstone' :
    mode.id === 'dm' ? 'ice' :
    mode.id === 'hvh' ? 'cyber' : 'asphalt';
  const wallKind =
    mode.id === 'defend' ? 'sandstone' :
    mode.id === 'hvh' ? 'cyber' : 'concrete';

  const floorPbr = createPBRSurface(floorKind, mode.floorColor, half / 2, half / 2);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorPbr.map,
    normalMap: floorPbr.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    bumpMap: floorPbr.bumpMap,
    bumpScale: 0.03,
    roughnessMap: floorPbr.roughnessMap,
    roughness: mode.id === 'dm' ? 0.42 : 0.88,
    metalness: mode.id === 'hvh' ? 0.35 : mode.id === 'dm' ? 0.18 : 0.06,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  group.add(makePaintedFloorStripes(half, mode.id));

  const solidPbr = createPBRSurface(wallKind, mode.wallColor, 2, 1);
  const solidMat = new THREE.MeshStandardMaterial({
    map: solidPbr.map,
    normalMap: solidPbr.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    bumpMap: solidPbr.bumpMap,
    bumpScale: 0.04,
    roughnessMap: solidPbr.roughnessMap,
    roughness: 0.82,
    metalness: mode.id === 'hvh' ? 0.35 : 0.08,
  });

  const thinPbr = createPBRSurface('plywood', mode.thinWallColor, 2, 1);
  const thinMat = new THREE.MeshStandardMaterial({
    map: thinPbr.map,
    normalMap: thinPbr.normalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    bumpMap: thinPbr.bumpMap,
    bumpScale: 0.035,
    roughnessMap: thinPbr.roughnessMap,
    roughness: 0.65,
    metalness: 0.22,
    emissive: mode.id === 'hvh' ? new THREE.Color('#701a75') : new THREE.Color('#000000'),
    emissiveIntensity: mode.id === 'hvh' ? 0.3 : 0,
  });

  const cratePbr = createPBRSurface('crate', mode.crateColor, 1, 1);
  const crateMat = new THREE.MeshStandardMaterial({
    map: cratePbr.map,
    normalMap: cratePbr.normalMap,
    normalScale: new THREE.Vector2(0.95, 0.95),
    bumpMap: cratePbr.bumpMap,
    bumpScale: 0.045,
    roughnessMap: cratePbr.roughnessMap,
    roughness: 0.72,
    metalness: 0.15,
  });

  const steelPbr = createPBRSurface('gunmetal', '#1e293b', 1, 1);
  const steelMat = new THREE.MeshStandardMaterial({
    map: steelPbr.map,
    normalMap: steelPbr.normalMap,
    roughnessMap: steelPbr.roughnessMap,
    bumpMap: steelPbr.bumpMap,
    bumpScale: 0.025,
    roughness: 0.45,
    metalness: 0.72,
  });
  const copingMat = new THREE.MeshStandardMaterial({
    color: mode.id === 'defend' ? '#92704a' : mode.id === 'hvh' ? '#4c1d95' : '#334155',
    roughness: 0.68,
    metalness: 0.2,
  });

  const addBox = (x: number, y: number, z: number, w: number, h: number, d: number, wallType: WallType) => {
    const mat = wallType === 'thin' ? thinMat : wallType === 'crate' ? crateMat : solidMat;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { isWall: true, wallType };
    group.add(mesh);
    const box = new THREE.Box3().setFromCenterAndSize(mesh.position.clone(), new THREE.Vector3(w, h, d));
    walls.push({ mesh, box, wallType });
    wallMeshes.push(mesh);

    // Decorative architectural trims (not colliders/raycast walls)
    if (wallType === 'solid' && h >= 1.2) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, 0.14, d + 0.14), copingMat);
      cap.position.set(x, y + h + 0.04, z);
      cap.receiveShadow = true;
      group.add(cap);

      const skirt = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.22, d + 0.08), steelMat);
      skirt.position.set(x, y + 0.11, z);
      group.add(skirt);
    } else if (wallType === 'thin') {
      // Steel frame posts on thin wallbang panels
      const spanX = w >= d;
      const post1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, h + 0.08, 0.16), steelMat);
      const post2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, h + 0.08, 0.16), steelMat);
      if (spanX) {
        post1.position.set(x - w / 2, y + h / 2, z);
        post2.position.set(x + w / 2, y + h / 2, z);
      } else {
        post1.position.set(x, y + h / 2, z - d / 2);
        post2.position.set(x, y + h / 2, z + d / 2);
      }
      group.add(post1, post2);
    }
  };

  const layout = getStandardMapLayout(mode.id);
  const bh = 10; // Increased wall height to prevent camera peeking over edges

  for (const boxSpec of layout.boxes) {
    addBox(boxSpec.x, boxSpec.y, boxSpec.z, boxSpec.w, boxSpec.h, boxSpec.d, boxSpec.wallType);
  }

  // Corner Steel Towers + Floodlight Fixtures (decorative atmosphere)
  const lampEmissive = new THREE.MeshBasicMaterial({
    color: mode.id === 'hvh' ? '#f43f5e' : mode.id === 'defend' ? '#fef08a' : '#e0f2fe',
  });
  for (const [cx, cz] of [
    [-half + 0.8, -half + 0.8],
    [half - 0.8, -half + 0.8],
    [-half + 0.8, half - 0.8],
    [half - 0.8, half - 0.8],
  ]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.55, 8.5, 0.55), steelMat);
    pole.position.set(cx, 4.25, cz);
    pole.castShadow = true;
    group.add(pole);

    const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 0.8), steelMat);
    head.position.set(cx, 8.6, cz);
    head.lookAt(0, 0, 0);
    group.add(head);

    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.15), lampEmissive);
    bulb.position.set(0, -0.1, 0.38);
    head.add(bulb);
  }

  // Structural perimeter pilasters every 9m
  for (let p = -half + 6; p <= half - 6; p += 9) {
    for (const [px, pz, sx, sz] of [
      [p, -half + 0.18, 0.7, 0.35],
      [p, half - 0.18, 0.7, 0.35],
      [-half + 0.18, p, 0.35, 0.7],
      [half - 0.18, p, 0.35, 0.7],
    ]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(sx, bh, sz), steelMat);
      col.position.set(px, bh / 2, pz);
      group.add(col);
    }
  }

  const playerSpawns = layout.playerSpawns.map((s) => new THREE.Vector3(s.x, s.y, s.z));
  const botSpawns = layout.botSpawns.map((s) => new THREE.Vector3(s.x, s.y, s.z));
  let sitePos: THREE.Vector3 | undefined;
  let siteRadius: number | undefined;
  let siteRing: THREE.Mesh | undefined;
  let siteBeaconLight: THREE.PointLight | undefined;

  if (layout.sitePos && layout.siteRadius) {
    sitePos = new THREE.Vector3(layout.sitePos.x, layout.sitePos.y, layout.sitePos.z);
    siteRadius = layout.siteRadius;
    const ringGeo = new THREE.RingGeometry(siteRadius - 0.35, siteRadius, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#facc15', side: THREE.DoubleSide, transparent: true, opacity: 0.72 });
    siteRing = new THREE.Mesh(ringGeo, ringMat);
    siteRing.rotation.x = -Math.PI / 2;
    siteRing.position.set(sitePos.x, 0.05, sitePos.z);
    group.add(siteRing);

    // 3D Bomb Terminal Crate at sitePos (offset +1.35m in Z inside the 5.2m ring so sitePos center remains walkable, with full physical collision!)
    const termZ = sitePos.z + 1.35;
    const terminal = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 0.9), steelMat);
    terminal.position.set(sitePos.x, 0.5, termZ);
    terminal.castShadow = true;
    terminal.receiveShadow = true;
    terminal.userData = { isWall: true, wallType: 'solid' as WallType };
    group.add(terminal);
    const termBox = new THREE.Box3().setFromCenterAndSize(
      terminal.position.clone(),
      new THREE.Vector3(1.1, 1.0, 0.9),
    );
    walls.push({ mesh: terminal, box: termBox, wallType: 'solid' });
    wallMeshes.push(terminal);

    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.38, 0.05),
      new THREE.MeshBasicMaterial({ color: '#ef4444' }),
    );
    screen.position.set(sitePos.x, 0.75, termZ - 0.46);
    group.add(screen);

    siteBeaconLight = new THREE.PointLight('#ef4444', 2.2, 9);
    siteBeaconLight.position.set(sitePos.x, 1.5, termZ);
    group.add(siteBeaconLight);
  }

  const envDetails = buildStandardEnvDetails({
    modeId: mode.id,
    halfExtent: half,
    boxes: layout.boxes,
    quality: lightingQuality,
  });
  group.add(envDetails.group);

  const animate = (elapsedSec: number, dt: number) => {
    envDetails.update(elapsedSec, dt);
    if (siteRing) {
      const m = siteRing.material as THREE.MeshBasicMaterial;
      m.opacity = 0.56 + Math.sin(elapsedSec * 2.8) * 0.2;
    }
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

  return { group, walls, wallMeshes, playerSpawns, botSpawns, sitePos, siteRadius, siteRing, siteBeaconLight, halfExtent: half, animate, dispose };
}

export function resolveCircleWallCollision(
  pos: THREE.Vector3,
  radius: number,
  walls: WallObstacle[],
  halfExtent: number,
): void {
  const limit = halfExtent - radius;
  pos.x = Math.max(-limit, Math.min(limit, pos.x));
  pos.z = Math.max(-limit, Math.min(limit, pos.z));

  for (const w of walls) {
    if (pos.y > w.box.max.y) continue;
    if (pos.y + 1.75 < w.box.min.y) continue;
    if (w.walkableTop && w.box.max.y - pos.y <= 0.58) continue;
    const cx = Math.max(w.box.min.x, Math.min(pos.x, w.box.max.x));
    const cz = Math.max(w.box.min.z, Math.min(pos.z, w.box.max.z));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      if (distSq > 0.00001) {
        const dist = Math.sqrt(distSq);
        const push = radius - dist;
        pos.x += (dx / dist) * push;
        pos.z += (dz / dist) * push;
      } else {
        const px1 = Math.abs(pos.x - w.box.min.x);
        const px2 = Math.abs(w.box.max.x - pos.x);
        const pz1 = Math.abs(pos.z - w.box.min.z);
        const pz2 = Math.abs(w.box.max.z - pos.z);
        const m = Math.min(px1, px2, pz1, pz2);
        if (m === px1) pos.x = w.box.min.x - radius;
        else if (m === px2) pos.x = w.box.max.x + radius;
        else if (m === pz1) pos.z = w.box.min.z - radius;
        else pos.z = w.box.max.z + radius;
      }
    }
  }
}

export interface StandardMapValidationReport {
  modeId: ModeId;
  valid: boolean;
  errors: string[];
  halfExtent: number;
  obstacleCount: number;
  playerSpawnCount: number;
  botSpawnCount: number;
  allSpawnsReachable: boolean;
  spawnLoSProtected: boolean;
}

export function validateStandardMapLayout(modeId: ModeId): StandardMapValidationReport {
  const layout = getStandardMapLayout(modeId);
  const errors: string[] = [];
  const half = layout.halfExtent;
  const innerBoxes = layout.boxes.slice(4); // Exclude 4 outer perimeter walls

  const isClear = (x: number, z: number, margin = 0.48): boolean => {
    if (Math.abs(x) >= half - margin || Math.abs(z) >= half - margin) return false;
    for (const b of innerBoxes) {
      if (
        x >= b.x - b.w * 0.5 - margin &&
        x <= b.x + b.w * 0.5 + margin &&
        z >= b.z - b.d * 0.5 - margin &&
        z <= b.z + b.d * 0.5 + margin
      ) {
        return false;
      }
    }
    return true;
  };

  layout.playerSpawns.forEach((s, i) => {
    if (!isClear(s.x, s.z, 0.52)) {
      errors.push(`Player spawn #${i} overlaps obstacle/boundary at (${s.x}, ${s.z})`);
    }
  });
  layout.botSpawns.forEach((s, i) => {
    if (!isClear(s.x, s.z, 0.52)) {
      errors.push(`Bot spawn #${i} overlaps obstacle/boundary at (${s.x}, ${s.z})`);
    }
  });
  if (layout.sitePos && !isClear(layout.sitePos.x, layout.sitePos.z, 0.45)) {
    errors.push(`Objective sitePos overlaps obstacle at (${layout.sitePos.x}, ${layout.sitePos.z})`);
  }

  // 1m grid BFS connectivity check from playerSpawns[0] to all botSpawns & sitePos
  const cols = half * 2;
  const rows = half * 2;
  const toGrid = (p: { x: number; z: number }): [number, number] => [
    Math.max(0, Math.min(cols - 1, Math.floor(p.x + half))),
    Math.max(0, Math.min(rows - 1, Math.floor(p.z + half))),
  ];
  const walkable = new Uint8Array(cols * rows);
  for (let gz = 0; gz < rows; gz++) {
    for (let gx = 0; gx < cols; gx++) {
      if (isClear(-half + gx + 0.5, -half + gz + 0.5, 0.38)) {
        walkable[gz * cols + gx] = 1;
      }
    }
  }
  const visited = new Uint8Array(cols * rows);
  const [sx, sz] = toGrid(layout.playerSpawns[0]);
  const q: number[] = [sz * cols + sx];
  visited[sz * cols + sx] = 1;
  while (q.length > 0) {
    const cur = q.shift()!;
    const cx = cur % cols;
    const cz = (cur - cx) / cols;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
      const idx = nz * cols + nx;
      if (!visited[idx] && walkable[idx]) {
        visited[idx] = 1;
        q.push(idx);
      }
    }
  }

  let allSpawnsReachable = true;
  for (const s of [...layout.playerSpawns, ...layout.botSpawns]) {
    const [gx, gz] = toGrid(s);
    if (!visited[gz * cols + gx]) {
      allSpawnsReachable = false;
      errors.push(`Spawn (${s.x}, ${s.z}) is disconnected from main playable nav component`);
    }
  }

  // Spawn-to-spawn line-of-sight protection (for competitive modes arena & defend)
  let spawnLoSProtected = true;
  if (modeId === 'arena' || modeId === 'defend') {
    for (const ps of layout.playerSpawns) {
      for (const bs of layout.botSpawns) {
        const dx = bs.x - ps.x;
        const dz = bs.z - ps.z;
        const dist = Math.hypot(dx, dz);
        const steps = Math.max(4, Math.ceil(dist / 0.4));
        let blocked = false;
        for (let i = 1; i < steps; i++) {
          const t = i / steps;
          const px = ps.x + dx * t;
          const pz = ps.z + dz * t;
          for (const b of innerBoxes) {
            if (b.h < 1.65) continue;
            if (
              px >= b.x - b.w * 0.5 &&
              px <= b.x + b.w * 0.5 &&
              pz >= b.z - b.d * 0.5 &&
              pz <= b.z + b.d * 0.5
            ) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
        if (!blocked) {
          spawnLoSProtected = false;
          errors.push(`Unblocked spawn-to-spawn LOS between (${ps.x},${ps.z}) and (${bs.x},${bs.z})`);
        }
      }
    }
  }

  return {
    modeId,
    valid: errors.length === 0,
    errors,
    halfExtent: half,
    obstacleCount: layout.boxes.length,
    playerSpawnCount: layout.playerSpawns.length,
    botSpawnCount: layout.botSpawns.length,
    allSpawnsReachable,
    spawnLoSProtected,
  };
}
