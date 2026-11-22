import * as THREE from 'three';
import { WeaponSkin } from '../data/skins';
import { WeaponDef } from '../data/weapons';
import { buildExternalWeaponParts } from './externalWeaponModels';
import { createWeaponMaterialPalette, WeaponMaterialPalette } from './weaponMaterials';

export interface WeaponParts {
  slideOrBolt?: THREE.Object3D;
  boltHandle?: THREE.Object3D;
  pumpForend?: THREE.Object3D;
  magazine?: THREE.Object3D;
  chargingHandle?: THREE.Object3D;
  trigger?: THREE.Object3D;
  hammer?: THREE.Object3D;
  chamberRound?: THREE.Object3D;
  blade?: THREE.Object3D;
}

export interface WeaponAnchors {
  muzzle: THREE.Object3D;
  ejectionPort: THREE.Object3D;
  rightHandGrip: THREE.Vector3;
  leftHandRest: THREE.Vector3;
  leftHandFollowsPump?: boolean;
  leftHandMagOffset?: THREE.Vector3;
  leftHandBoltOffset?: THREE.Vector3;
  useLeftHand: boolean;
  hipOffset: THREE.Vector3;
  hipRotation: THREE.Euler;
  adsOffset: THREE.Vector3;
}

export interface WeaponRig {
  root: THREE.Group;
  weaponPivot: THREE.Group;
  parts: WeaponParts;
  anchors: WeaponAnchors;
  def: WeaponDef;
  onExternalLoaded?: () => void;
  dispose: () => void;
}

class ModelBuilder {
  private geos: THREE.BufferGeometry[] = [];
  private palette: WeaponMaterialPalette;

  constructor(palette: WeaponMaterialPalette) {
    this.palette = palette;
  }

  public track<T extends THREE.BufferGeometry>(geo: T): T {
    this.geos.push(geo);
    return geo;
  }

  private applyTriplanarUVs(geo: THREE.BufferGeometry, ox = 0, oy = 0, oz = 0, scale = 4.2): void {
    const pos = geo.getAttribute('position');
    if (!pos) return;
    let norm = geo.getAttribute('normal');
    if (!norm) {
      geo.computeVertexNormals();
      norm = geo.getAttribute('normal');
    }
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i) + ox;
      const vy = pos.getY(i) + oy;
      const vz = pos.getZ(i) + oz;
      const ax = norm ? Math.abs(norm.getX(i)) : 1;
      const ay = norm ? Math.abs(norm.getY(i)) : 0;
      const az = norm ? Math.abs(norm.getZ(i)) : 0;
      if (ax >= ay && ax >= az) {
        uv[i * 2] = -vz * scale;
        uv[i * 2 + 1] = vy * scale;
      } else if (ay >= ax && ay >= az) {
        uv[i * 2] = -vz * scale;
        uv[i * 2 + 1] = vx * scale;
      } else {
        uv[i * 2] = vx * scale;
        uv[i * 2 + 1] = vy * scale;
      }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  public box(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    rx = 0,
    ry = 0,
    rz = 0,
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    this.applyTriplanarUVs(geo, x, y, z);
    const m = new THREE.Mesh(this.track(geo), mat);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  }

  public cyl(
    parent: THREE.Object3D,
    rTop: number,
    rBot: number,
    len: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    segs = 14,
    rotX = Math.PI / 2,
    rotY = 0,
    rotZ = 0,
  ): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(rTop, rBot, len, segs);
    geo.rotateX(rotX);
    if (rotY) geo.rotateY(rotY);
    if (rotZ) geo.rotateZ(rotZ);
    this.applyTriplanarUVs(geo, x, y, z);
    const m = new THREE.Mesh(this.track(geo), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  /** Extrudes a 2D side silhouette specified in (z, y) coords, centered symmetrically on X. */
  public extrudeProfile(
    parent: THREE.Object3D,
    ptsZY: [number, number][],
    thickness: number,
    bevel = 0.0022,
    mat: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
  ): THREE.Mesh {
    const shape = new THREE.Shape();
    ptsZY.forEach(([pz, py], i) => {
      // Transform +Y2 = y, +X2 = -pz so after rotateY(+PI/2), Z = -X2 = pz!
      const sx = -pz;
      const sy = py;
      if (i === 0) shape.moveTo(sx, sy);
      else shape.lineTo(sx, sy);
    });
    shape.closePath();

    const innerDepth = Math.max(0.001, thickness - bevel * 2);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: innerDepth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 8,
    });
    geo.translate(0, 0, -innerDepth * 0.5);
    geo.rotateY(Math.PI / 2);
    geo.computeVertexNormals();
    this.applyTriplanarUVs(geo, x, y, z);
    this.track(geo);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  /** Revolves a [radius, forwardDistFromRear] profile pointing along -Z. */
  public latheBarrel(
    parent: THREE.Object3D,
    ptsRZ: [number, number][],
    x: number,
    y: number,
    zStart: number,
    mat: THREE.Material,
    segs = 16,
  ): THREE.Mesh {
    const v2 = ptsRZ.map(([r, zFwd]) => new THREE.Vector2(Math.max(0.0001, r), zFwd));
    const geo = new THREE.LatheGeometry(v2, segs);
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    this.applyTriplanarUVs(geo, x, y, zStart);
    this.track(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, zStart);
    parent.add(mesh);
    return mesh;
  }

  public addPicatinnyRail(
    parent: THREE.Object3D,
    startZ: number,
    endZ: number,
    y: number,
    width: number,
    mat: THREE.Material,
    step = 0.017,
  ): void {
    const len = Math.abs(endZ - startZ);
    const midZ = (startZ + endZ) * 0.5;
    this.box(parent, width * 0.78, 0.006, len, 0, y, midZ, mat);
    const lugGeo = this.track(new THREE.BoxGeometry(width, 0.0055, step * 0.52));
    const zMin = Math.min(startZ, endZ);
    const zMax = Math.max(startZ, endZ);
    for (let pz = zMin + step * 0.5; pz <= zMax - step * 0.3; pz += step) {
      const lug = new THREE.Mesh(lugGeo, mat);
      lug.position.set(0, y + 0.0045, pz);
      parent.add(lug);
    }
  }

  public addIronSights(
    parent: THREE.Object3D,
    rearZ: number,
    frontZ: number,
    topY: number,
    metalMat: THREE.Material,
    tritiumMat: THREE.Material,
  ): void {
    // Twin rear sight ears + glowing green tritium dots
    this.box(parent, 0.006, 0.011, 0.014, -0.0085, topY + 0.0055, rearZ, metalMat);
    this.box(parent, 0.006, 0.011, 0.014, 0.0085, topY + 0.0055, rearZ, metalMat);
    this.box(parent, 0.022, 0.004, 0.014, 0, topY + 0.001, rearZ, metalMat);
    this.box(parent, 0.0028, 0.0028, 0.002, -0.0085, topY + 0.007, rearZ + 0.0072, tritiumMat);
    this.box(parent, 0.0028, 0.0028, 0.002, 0.0085, topY + 0.007, rearZ + 0.0072, tritiumMat);

    // Front post + luminous tip
    this.box(parent, 0.0045, 0.013, 0.014, 0, topY + 0.006, frontZ, metalMat);
    this.box(parent, 0.003, 0.0032, 0.003, 0, topY + 0.01, frontZ + 0.0065, tritiumMat);
  }

  public addReflexOptic(
    parent: THREE.Object3D,
    z: number,
    topY: number,
    housingMat: THREE.Material,
    glassMat: THREE.Material,
    accentMat: THREE.Material,
  ): void {
    const g = new THREE.Group();
    g.position.set(0, topY, z);
    parent.add(g);

    // CNC mount riser + clamping screws
    this.box(g, 0.03, 0.012, 0.056, 0, 0.006, 0, housingMat);
    this.cyl(g, 0.003, 0.003, 0.034, 0, 0.006, -0.016, this.palette.brushedSteel, 8, 0, 0, Math.PI / 2);
    this.cyl(g, 0.003, 0.003, 0.034, 0, 0.006, 0.016, this.palette.brushedSteel, 8, 0, 0, Math.PI / 2);

    // Beveled protective hood walls + roof
    this.box(g, 0.005, 0.03, 0.048, -0.0155, 0.025, 0, housingMat);
    this.box(g, 0.005, 0.03, 0.048, 0.0155, 0.025, 0, housingMat);
    this.box(g, 0.036, 0.0055, 0.048, 0, 0.04, 0, accentMat);
    // Coated optical window + tiny crisp emitter dot
    this.box(g, 0.026, 0.024, 0.003, 0, 0.025, -0.008, glassMat);
    this.box(g, 0.0022, 0.0022, 0.002, 0, 0.025, -0.006, this.palette.tritium);
    // Side brightness turret
    this.cyl(g, 0.0065, 0.0065, 0.006, 0.02, 0.022, 0.01, accentMat, 10, 0, 0, Math.PI / 2);
  }

  public addSniperScope(
    parent: THREE.Object3D,
    z: number,
    topY: number,
    totalLen: number,
    tubeMat: THREE.Material,
    accentMat: THREE.Material,
    glassMat: THREE.Material,
  ): void {
    const g = new THREE.Group();
    g.position.set(0, topY, z);
    parent.add(g);

    const ringOffset = totalLen * 0.16;
    for (const rz of [-ringOffset, ringOffset]) {
      this.box(g, 0.028, 0.018, 0.022, 0, 0.009, rz, tubeMat);
      this.cyl(g, 0.0175, 0.0175, 0.022, 0, 0.03, rz, accentMat, 14);
      this.cyl(g, 0.003, 0.003, 0.032, 0, 0.009, rz, this.palette.brushedSteel, 8, 0, 0, Math.PI / 2);
    }

    // Lathe stepped scope body pointing toward -Z
    const half = totalLen * 0.5;
    this.latheBarrel(
      g,
      [
        [0.019, -half],
        [0.02, -half + 0.038],
        [0.014, -half + 0.058],
        [0.014, half - 0.085],
        [0.0225, half - 0.055],
        [0.0235, half],
      ],
      0,
      0.03,
      0,
      tubeMat,
      18,
    );

    // Objective & ocular anti-reflective coated lenses
    this.cyl(g, 0.0205, 0.0205, 0.003, 0, 0.03, -half - 0.001, glassMat, 16);
    this.cyl(g, 0.0165, 0.0165, 0.003, 0, 0.03, half + 0.001, glassMat, 16);

    // Tactical elevation & windage turrets + throw lever
    this.cyl(g, 0.0085, 0.0085, 0.014, 0, 0.048, -0.01, accentMat, 12, 0, 0, 0);
    this.cyl(g, 0.008, 0.008, 0.014, 0.019, 0.03, -0.01, accentMat, 12, 0, 0, Math.PI / 2);
    this.cyl(g, 0.0155, 0.0155, 0.016, 0, 0.03, half - 0.075, accentMat, 14);
  }

  public disposeAll(): void {
    for (const g of this.geos) g.dispose();
    this.palette.dispose();
  }
}

export function createWeaponRig(def: WeaponDef, skin?: WeaponSkin): WeaponRig {
  const palette = createWeaponMaterialPalette(def, skin);
  const b = new ModelBuilder(palette);

  const root = new THREE.Group();
  const weaponPivot = new THREE.Group();
  root.add(weaponPivot);

  let disposed = false;
  let extDispose: (() => void) | undefined;
  let notifyExternalLoaded: (() => void) | undefined;
  let anchorsRef: WeaponAnchors | null = null;
  const fallbackGroups: THREE.Object3D[] = [];

  const makeFallback = (parent: THREE.Object3D): THREE.Group => {
    const g = new THREE.Group();
    parent.add(g);
    fallbackGroups.push(g);
    return g;
  };

  const attachExternal = (
    weaponId: string,
    targets: {
      frame?: THREE.Object3D;
      slide?: THREE.Object3D;
      magazine?: THREE.Object3D;
      trigger?: THREE.Object3D;
      chargingHandle?: THREE.Object3D;
      blade?: THREE.Object3D;
    },
    onAfterAttach?: () => void,
  ): void => {
    void buildExternalWeaponParts(weaponId, skin).then((ext) => {
      if (!ext) return;
      if (disposed) {
        ext.dispose();
        return;
      }
      extDispose = ext.dispose;
      for (const fg of fallbackGroups) fg.visible = false;
      if (ext.frame && targets.frame) targets.frame.add(ext.frame);
      if (ext.slide && targets.slide) targets.slide.add(ext.slide);
      if (ext.magazine && targets.magazine) targets.magazine.add(ext.magazine);
      if (ext.trigger && targets.trigger) targets.trigger.add(ext.trigger);
      if (ext.chargingHandle && targets.chargingHandle) targets.chargingHandle.add(ext.chargingHandle);
      if (ext.blade && targets.blade) targets.blade.add(ext.blade);
      onAfterAttach?.();
      notifyExternalLoaded?.();
    });
  };

  const parts: WeaponParts = {};
  const muzzle = new THREE.Object3D();
  const ejectionPort = new THREE.Object3D();
  weaponPivot.add(muzzle);
  weaponPivot.add(ejectionPort);

  let rightHandGrip = new THREE.Vector3(0, -0.055, 0.065);
  let leftHandRest = new THREE.Vector3(-0.01, -0.02, -0.2);
  let leftHandFollowsPump = false;
  let leftHandMagOffset: THREE.Vector3 | undefined = new THREE.Vector3(0, -0.075, -0.08);
  let leftHandBoltOffset: THREE.Vector3 | undefined = new THREE.Vector3(-0.02, 0.04, 0.01);
  let useLeftHand = true;
  let hipOffset = new THREE.Vector3(0.22, -0.21, -0.4);
  let hipRotation = new THREE.Euler(0.01, -0.025, 0);
  let adsOffset = new THREE.Vector3(0, -0.09, -0.34);

  if (def.isMelee) {
    useLeftHand = false;
    rightHandGrip = new THREE.Vector3(-0.002, -0.006, 0.032);
    leftHandRest = new THREE.Vector3(-0.14, -0.08, -0.05);
    leftHandMagOffset = undefined;
    leftHandBoltOffset = undefined;
    hipOffset = new THREE.Vector3(0.19, -0.155, -0.34);
    hipRotation = new THREE.Euler(0.14, 0.22, -0.26);

    const bladeGroup = new THREE.Group();
    weaponPivot.add(bladeGroup);
    parts.blade = bladeGroup;
    const fallbackBlade = makeFallback(bladeGroup);

    // Chamfered combat tanto primary edge + fuller spine
    b.extrudeProfile(
      fallbackBlade,
      [
        [0.005, -0.012],
        [-0.22, -0.01],
        [-0.268, 0.012],
        [-0.215, 0.024],
        [0.005, 0.024],
      ],
      0.0085,
      0.0024,
      palette.camoBlade,
    );
    b.box(fallbackBlade, 0.0096, 0.007, 0.21, 0, 0.021, -0.105, palette.body);
    b.box(fallbackBlade, 0.0098, 0.004, 0.16, 0, 0.01, -0.105, palette.darkSteel);

    // CNC Crossguard + thumb ramp + sculpted rubber handle scales
    b.box(fallbackBlade, 0.044, 0.015, 0.018, 0, 0.006, 0.006, palette.accent);
    b.extrudeProfile(
      fallbackBlade,
      [
        [0.014, -0.012],
        [0.118, -0.016],
        [0.128, -0.002],
        [0.124, 0.014],
        [0.014, 0.016],
      ],
      0.022,
      0.0035,
      palette.rubber,
    );
    for (const hz of [0.036, 0.072, 0.104]) {
      b.cyl(fallbackBlade, 0.0035, 0.0035, 0.024, 0, 0.002, hz, palette.brushedSteel, 8, 0, 0, Math.PI / 2);
    }
    // Chamfered steel pommel ring
    b.cyl(fallbackBlade, 0.012, 0.012, 0.01, 0, -0.002, 0.132, palette.darkSteel, 12, 0, 0, Math.PI / 2);

    muzzle.position.set(0, -0.095, -0.165);
    ejectionPort.position.set(0.02, 0.01, -0.04);

    attachExternal('knife', { blade: bladeGroup });
  } else if (def.id === 'pistol') {
    hipOffset = new THREE.Vector3(0.20, -0.195, -0.35);
    adsOffset = new THREE.Vector3(0, -0.056, -0.29);
    rightHandGrip = new THREE.Vector3(0, -0.056, 0.056);
    leftHandRest = new THREE.Vector3(-0.025, -0.060, 0.052);
    leftHandMagOffset = new THREE.Vector3(0, -0.100, 0.066);
    leftHandBoltOffset = new THREE.Vector3(-0.018, 0.036, 0.035);

    const fallbackFrame = makeFallback(weaponPivot);

    // Polymer lower frame + underbarrel rail + trigger guard (procedural fallback while GLB loads)
    b.extrudeProfile(
      fallbackFrame,
      [
        [0.088, -0.005],
        [-0.145, -0.005],
        [-0.148, 0.016],
        [0.078, 0.016],
      ],
      0.032,
      0.0025,
      palette.polymer,
    );
    b.box(fallbackFrame, 0.024, 0.012, 0.055, 0, -0.011, -0.105, palette.polymer);
    // Ergonomic grip + wraparound stippled rubber grip panels
    b.extrudeProfile(
      fallbackFrame,
      [
        [0.03, 0.0],
        [0.078, 0.0],
        [0.104, -0.105],
        [0.054, -0.112],
      ],
      0.033,
      0.003,
      palette.polymer,
    );
    b.box(fallbackFrame, 0.036, 0.082, 0.038, 0, -0.056, 0.066, palette.rubber, -0.23);
    for (const sy of [-0.034, -0.076]) {
      b.cyl(fallbackFrame, 0.0032, 0.0032, 0.037, 0, sy, 0.066, palette.brushedSteel, 8, 0, 0, Math.PI / 2);
    }

    // Trigger guard + trigger + hammer
    b.box(fallbackFrame, 0.012, 0.005, 0.048, 0, -0.036, -0.002, palette.polymer);
    b.box(fallbackFrame, 0.012, 0.032, 0.006, 0, -0.02, -0.024, palette.polymer, 0.15);
    const triggerGroup = new THREE.Group();
    triggerGroup.position.set(0, 0.0033, -0.007);
    weaponPivot.add(triggerGroup);
    const fallbackTrigger = makeFallback(triggerGroup);
    b.box(fallbackTrigger, 0.006, 0.022, 0.007, 0, -0.021, 0.011, palette.accent, 0.28);
    parts.trigger = triggerGroup;

    const hammerGroup = new THREE.Group();
    hammerGroup.position.set(0, 0.015, 0.078);
    weaponPivot.add(hammerGroup);
    const fallbackHammer = makeFallback(hammerGroup);
    b.box(fallbackHammer, 0.008, 0.014, 0.012, 0, 0.006, 0.004, palette.darkSteel, -0.35);
    parts.hammer = hammerGroup;

    // Fixed inner match barrel & threaded muzzle
    b.latheBarrel(
      fallbackFrame,
      [
        [0.0085, 0.0],
        [0.0085, 0.175],
        [0.011, 0.177],
        [0.011, 0.194],
        [0.008, 0.195],
      ],
      0,
      0.029,
      0.01,
      palette.brushedSteel,
      14,
    );

    // Brass round visible inside ejection port
    const round = b.cyl(weaponPivot, 0.0048, 0.0048, 0.020, 0.003, 0.036, -0.018, palette.brass, 10);
    round.visible = false;
    parts.chamberRound = round;

    // Reciprocating Slide with front/rear serrations & 3-dot tritium sights
    const slide = new THREE.Group();
    weaponPivot.add(slide);
    parts.slideOrBolt = slide;
    const fallbackSlide = makeFallback(slide);
    b.extrudeProfile(
      fallbackSlide,
      [
        [0.082, 0.015],
        [-0.15, 0.015],
        [-0.152, 0.044],
        [-0.14, 0.048],
        [0.075, 0.048],
        [0.082, 0.038],
      ],
      0.034,
      0.0028,
      palette.body,
    );
    b.box(fallbackSlide, 0.022, 0.008, 0.042, 0.006, 0.045, -0.02, palette.darkSteel); // Recessed ejection port
    for (let sz = 0.04; sz <= 0.068; sz += 0.007) {
      b.box(fallbackSlide, 0.036, 0.024, 0.0026, 0, 0.031, sz, palette.darkSteel);
    }
    for (let sz = -0.125; sz <= -0.105; sz += 0.007) {
      b.box(fallbackSlide, 0.0355, 0.02, 0.0024, 0, 0.031, sz, palette.darkSteel);
    }
    b.addIronSights(fallbackSlide, 0.068, -0.138, 0.048, palette.darkSteel, palette.tritium);

    // Detachable Magazine with metal bumper baseplate
    const mag = new THREE.Group();
    weaponPivot.add(mag);
    parts.magazine = mag;
    const fallbackMag = makeFallback(mag);
    b.box(fallbackMag, 0.022, 0.105, 0.034, 0, -0.056, 0.066, palette.camoMag, -0.23);
    b.box(fallbackMag, 0.029, 0.013, 0.042, 0, -0.112, 0.079, palette.accent, -0.23);

    muzzle.position.set(0, 0.0356, -0.142);
    ejectionPort.position.set(0.015, 0.040, -0.018);

    attachExternal('pistol', { frame: weaponPivot, slide, magazine: mag, trigger: triggerGroup });
  } else if (def.id === 'smg') {
    hipOffset = new THREE.Vector3(0.21, -0.21, -0.39);
    adsOffset = new THREE.Vector3(0, -0.085, -0.33);
    rightHandGrip = new THREE.Vector3(0, -0.058, 0.062);
    leftHandRest = new THREE.Vector3(-0.016, -0.015, -0.165);
    leftHandMagOffset = new THREE.Vector3(0, -0.095, -0.084);
    leftHandBoltOffset = new THREE.Vector3(-0.028, 0.048, -0.175);

    const fallbackFrame = makeFallback(weaponPivot);

    // Upper monolithic receiver + top rail + micro reflex optic
    b.extrudeProfile(
      fallbackFrame,
      [
        [0.11, -0.005],
        [-0.22, -0.005],
        [-0.22, 0.056],
        [0.105, 0.056],
      ],
      0.044,
      0.003,
      palette.body,
    );
    b.addPicatinnyRail(fallbackFrame, 0.095, -0.195, 0.058, 0.022, palette.darkSteel);
    b.addReflexOptic(fallbackFrame, -0.02, 0.062, palette.darkSteel, palette.opticGlass, palette.accent);

    // Compact vented polymer forend + bottom handstop
    b.box(fallbackFrame, 0.042, 0.042, 0.13, 0, 0.015, -0.165, palette.camoFurniture);
    b.box(fallbackFrame, 0.024, 0.024, 0.03, 0, -0.014, -0.205, palette.accent, -0.28);

    // Integrated stepped suppressor via LatheGeometry
    b.latheBarrel(
      fallbackFrame,
      [
        [0.014, 0.0],
        [0.014, 0.04],
        [0.021, 0.045],
        [0.021, 0.178],
        [0.017, 0.184],
      ],
      0,
      0.024,
      -0.215,
      palette.darkSteel,
      16,
    );
    b.box(fallbackFrame, 0.022, 0.012, 0.045, 0, 0.024, -0.35, palette.accent);

    // Grip + trigger + folded skeleton stock bar
    b.box(fallbackFrame, 0.036, 0.112, 0.046, 0, -0.058, 0.068, palette.rubber, -0.22);
    b.box(fallbackFrame, 0.012, 0.006, 0.05, 0, -0.038, 0.008, palette.polymer);
    const triggerGroup = new THREE.Group();
    triggerGroup.position.set(0, -0.0174, 0.0127);
    weaponPivot.add(triggerGroup);
    const fallbackTrigger = makeFallback(triggerGroup);
    b.box(fallbackTrigger, 0.006, 0.022, 0.007, 0, -0.001, 0.001, palette.accent, 0.26);
    parts.trigger = triggerGroup;

    // Folded side-wire stock arm on left side
    b.box(fallbackFrame, 0.01, 0.016, 0.2, -0.028, 0.022, 0.01, palette.aluminum);
    b.box(fallbackFrame, 0.026, 0.065, 0.018, -0.014, 0.008, 0.122, palette.rubber);

    // Ejection port, bolt & left-side charging handle
    b.box(fallbackFrame, 0.008, 0.018, 0.048, 0.021, 0.032, -0.04, palette.darkSteel);
    const bolt = new THREE.Group();
    weaponPivot.add(bolt);
    parts.slideOrBolt = bolt;
    const fallbackBolt = makeFallback(bolt);
    b.box(fallbackBolt, 0.014, 0.016, 0.044, 0.016, 0.032, -0.04, palette.brushedSteel);

    const ch = new THREE.Group();
    weaponPivot.add(ch);
    parts.chargingHandle = ch;
    const fallbackCh = makeFallback(ch);
    b.cyl(fallbackCh, 0.0045, 0.0045, 0.026, -0.032, 0.036, -0.12, palette.accent, 10, 0, 0, Math.PI / 2);

    // Slanted stick magazine with floorplate
    const mag = new THREE.Group();
    weaponPivot.add(mag);
    parts.magazine = mag;
    const fallbackMag = makeFallback(mag);
    b.box(fallbackMag, 0.024, 0.175, 0.036, 0, -0.095, -0.092, palette.camoMag, -0.16);
    b.box(fallbackMag, 0.027, 0.014, 0.042, 0, -0.18, -0.078, palette.accent, -0.16);

    muzzle.position.set(0, 0.027, -0.270);
    ejectionPort.position.set(0.026, 0.044, -0.033);

    attachExternal('smg', {
      frame: weaponPivot,
      slide: bolt,
      magazine: mag,
      trigger: triggerGroup,
      chargingHandle: ch,
    });
  } else if (def.id === 'shotgun') {
    hipOffset = new THREE.Vector3(0.21, -0.22, -0.43);
    adsOffset = new THREE.Vector3(0, -0.072, -0.35);
    rightHandGrip = new THREE.Vector3(0, -0.056, 0.072);
    leftHandRest = new THREE.Vector3(-0.014, -0.006, -0.265);
    leftHandFollowsPump = true;
    leftHandMagOffset = new THREE.Vector3(-0.010, -0.020, -0.065);
    leftHandBoltOffset = new THREE.Vector3(0.030, 0.028, -0.092);

    const fallbackFrame = makeFallback(weaponPivot);

    // Steel receiver with ejection port & chrome bolt
    b.extrudeProfile(
      fallbackFrame,
      [
        [0.095, -0.014],
        [-0.145, -0.014],
        [-0.145, 0.05],
        [0.09, 0.05],
      ],
      0.046,
      0.003,
      palette.body,
    );
    b.box(fallbackFrame, 0.008, 0.022, 0.068, 0.023, 0.024, -0.05, palette.darkSteel);
    const bolt = new THREE.Group();
    weaponPivot.add(bolt);
    parts.slideOrBolt = bolt;
    const fallbackBolt = makeFallback(bolt);
    b.box(fallbackBolt, 0.012, 0.02, 0.062, 0.019, 0.024, -0.05, palette.brushedSteel);

    parts.chamberRound = b.cyl(weaponPivot, 0.0085, 0.0085, 0.045, 0.012, 0.023, -0.048, palette.redShell, 10);
    parts.chamberRound.visible = false;

    b.addPicatinnyRail(fallbackFrame, 0.06, -0.125, 0.052, 0.022, palette.darkSteel);
    b.addIronSights(fallbackFrame, 0.055, -0.585, 0.056, palette.darkSteel, palette.tritium);

    // Barrel + perforated upper heatshield + underbarrel tube + clamp
    b.latheBarrel(
      fallbackFrame,
      [
        [0.013, 0.0],
        [0.013, 0.43],
        [0.0145, 0.44],
        [0.0145, 0.465],
      ],
      0,
      0.034,
      -0.14,
      palette.darkSteel,
      16,
    );
    b.cyl(fallbackFrame, 0.0115, 0.0115, 0.41, 0, 0.004, -0.345, palette.darkSteel, 14);
    b.box(fallbackFrame, 0.028, 0.044, 0.02, 0, 0.019, -0.535, palette.accent); // Barrel clamp

    // Sliding ribbed polymer pump forend + twin steel action bars
    const pump = new THREE.Group();
    pump.position.set(0, -0.002, -0.255);
    weaponPivot.add(pump);
    parts.pumpForend = pump;
    const fallbackPump = makeFallback(pump);
    b.cyl(fallbackPump, 0.024, 0.025, 0.165, 0, 0, 0, palette.camoFurniture, 14);
    for (let pz = -0.068; pz <= 0.068; pz += 0.016) {
      b.cyl(fallbackPump, 0.026, 0.026, 0.008, 0, 0, pz, palette.rubber, 12);
    }
    b.box(fallbackPump, 0.005, 0.008, 0.14, -0.019, 0.012, 0.11, palette.brushedSteel);
    b.box(fallbackPump, 0.005, 0.008, 0.14, 0.019, 0.012, 0.11, palette.brushedSteel);

    // 4-shell tactical side-saddle on left receiver!
    for (let i = 0; i < 4; i++) {
      const sz = -0.08 + i * 0.028;
      b.cyl(fallbackFrame, 0.0085, 0.0085, 0.042, -0.03, 0.018, sz, palette.redShell, 10, 0, 0, 0);
      b.cyl(fallbackFrame, 0.009, 0.009, 0.01, -0.03, -0.003, sz, palette.brass, 10, 0, 0, 0);
    }

    // Polymer buttstock + pistol-grip angle + thick rubber recoil pad
    b.extrudeProfile(
      fallbackFrame,
      [
        [0.08, 0.02],
        [0.255, 0.025],
        [0.258, -0.065],
        [0.14, -0.04],
        [0.09, -0.085],
        [0.055, -0.085],
        [0.075, -0.015],
      ],
      0.04,
      0.003,
      palette.camoFurniture,
    );
    b.box(fallbackFrame, 0.041, 0.095, 0.016, 0, -0.02, 0.262, palette.rubber);
    b.box(fallbackFrame, 0.012, 0.005, 0.046, 0, -0.034, 0.02, palette.polymer);
    const triggerGroup = new THREE.Group();
    triggerGroup.position.set(0, -0.0086, 0.0277);
    weaponPivot.add(triggerGroup);
    const fallbackTrigger = makeFallback(triggerGroup);
    b.box(fallbackTrigger, 0.006, 0.02, 0.007, 0, -0.013, -0.002, palette.accent, 0.25);
    parts.trigger = triggerGroup;

    muzzle.position.set(0, 0.031, -0.530);
    ejectionPort.position.set(0.030, 0.028, -0.092);

    attachExternal(
      'shotgun',
      { frame: weaponPivot, slide: bolt, trigger: triggerGroup },
      () => {
        if (anchorsRef) anchorsRef.leftHandFollowsPump = false;
      },
    );
  } else if (def.id === 'ssg' || def.id === 'sniper') {
    const heavy = def.id === 'sniper';
    hipOffset = new THREE.Vector3(0.22, -0.22, heavy ? -0.46 : -0.44);
    adsOffset = new THREE.Vector3(0, -0.115, -0.38);
    rightHandGrip = new THREE.Vector3(0, heavy ? -0.050 : -0.056, heavy ? 0.075 : 0.068);
    leftHandRest = new THREE.Vector3(-0.014, heavy ? -0.015 : -0.012, heavy ? -0.25 : -0.24);
    leftHandMagOffset = new THREE.Vector3(0, heavy ? -0.090 : -0.095, -0.055);
    leftHandBoltOffset = new THREE.Vector3(heavy ? 0.036 : 0.032, heavy ? 0.032 : 0.034, heavy ? 0.030 : 0.028);

    const fallbackFrame = makeFallback(weaponPivot);

    // Thumbhole composite/polymer precision chassis stock
    const stockPts: [number, number][] = heavy
      ? [
          [0.285, -0.068],
          [0.285, 0.028],
          [0.13, 0.032],
          [0.11, 0.006],
          [-0.3, 0.008],
          [-0.31, -0.022],
          [-0.08, -0.025],
          [0.05, -0.025],
          [0.08, -0.092],
          [0.04, -0.092],
          [0.03, -0.035],
          [0.11, -0.055],
          [0.21, -0.055],
        ]
      : [
          [0.265, -0.06],
          [0.265, 0.025],
          [0.115, 0.028],
          [-0.26, 0.005],
          [-0.27, -0.02],
          [-0.06, -0.022],
          [0.055, -0.022],
          [0.08, -0.088],
          [0.042, -0.088],
          [0.025, -0.026],
          [0.13, -0.042],
        ];
    b.extrudeProfile(fallbackFrame, stockPts, heavy ? 0.048 : 0.044, 0.003, palette.body);
    // Adjustable cheek-riser & rubber recoil buttpad
    b.box(fallbackFrame, 0.042, 0.022, 0.11, 0, 0.042, heavy ? 0.21 : 0.195, palette.polymer);
    b.box(fallbackFrame, 0.048, 0.098, 0.018, 0, -0.018, heavy ? 0.292 : 0.272, palette.rubber);

    // Precision machined steel receiver + top Picatinny rail
    b.box(fallbackFrame, 0.042, 0.038, 0.2, 0, 0.028, -0.02, palette.darkSteel);
    b.addPicatinnyRail(fallbackFrame, 0.07, -0.11, 0.049, 0.024, palette.aluminum);
    b.addSniperScope(
      fallbackFrame,
      -0.025,
      0.051,
      heavy ? 0.34 : 0.27,
      palette.darkSteel,
      palette.accent,
      palette.opticGlass,
    );

    // Heavy fluted free-float barrel + precision muzzle brake
    const barrelLen = heavy ? 0.56 : 0.44;
    b.latheBarrel(
      fallbackFrame,
      [
        [0.016, 0.0],
        [0.016, 0.08],
        [0.012, 0.11],
        [heavy ? 0.0115 : 0.01, barrelLen],
      ],
      0,
      0.032,
      -0.115,
      palette.brushedSteel,
      16,
    );
    const brakeZ = -0.115 - barrelLen;
    if (heavy) {
      // Iconic dual-chamber rectangular baffled AWP brake
      b.box(fallbackFrame, 0.036, 0.028, 0.072, 0, 0.032, brakeZ - 0.034, palette.darkSteel);
      b.box(fallbackFrame, 0.038, 0.014, 0.016, 0, 0.032, brakeZ - 0.02, palette.accent);
      b.box(fallbackFrame, 0.038, 0.014, 0.016, 0, 0.032, brakeZ - 0.05, palette.accent);
      // Folded twin front bipod legs under forend
      b.cyl(fallbackFrame, 0.007, 0.007, 0.145, -0.022, -0.028, -0.22, palette.darkSteel, 10);
      b.cyl(fallbackFrame, 0.007, 0.007, 0.145, 0.022, -0.028, -0.22, palette.darkSteel, 10);
      b.cyl(fallbackFrame, 0.011, 0.011, 0.02, -0.022, -0.028, -0.145, palette.rubber, 10);
      b.cyl(fallbackFrame, 0.011, 0.011, 0.02, 0.022, -0.028, -0.145, palette.rubber, 10);
    } else {
      b.latheBarrel(
        fallbackFrame,
        [
          [0.013, 0.0],
          [0.015, 0.015],
          [0.015, 0.048],
          [0.012, 0.054],
        ],
        0,
        0.032,
        brakeZ,
        palette.accent,
        14,
      );
    }

    // Bolt carrier group kept at origin (0, 0, 0) so external GLB Slide aligns cleanly
    const boltGroup = new THREE.Group();
    weaponPivot.add(boltGroup);
    parts.slideOrBolt = boltGroup;
    const fallbackBolt = makeFallback(boltGroup);
    fallbackBolt.position.set(0, 0.032, 0.01);
    b.cyl(fallbackBolt, 0.011, 0.011, 0.12, 0, 0, 0.01, palette.brushedSteel, 12);

    const handlePivot = new THREE.Group();
    handlePivot.position.set(0, 0, 0.028);
    fallbackBolt.add(handlePivot);
    parts.boltHandle = handlePivot;
    b.box(handlePivot, 0.028, 0.008, 0.008, 0.016, 0, 0, palette.brushedSteel, 0, 0, -0.35);
    const knob = new THREE.Mesh(b.track(new THREE.SphereGeometry(0.011, 10, 10)), palette.accent);
    knob.position.set(0.032, -0.007, 0);
    handlePivot.add(knob);

    parts.chamberRound = b.cyl(weaponPivot, 0.006, 0.006, 0.042, 0.008, 0.032, -0.04, palette.brass, 10);
    parts.chamberRound.visible = false;

    // Detachable precision box magazine
    const mag = new THREE.Group();
    weaponPivot.add(mag);
    parts.magazine = mag;
    const fallbackMag = makeFallback(mag);
    b.box(fallbackMag, 0.03, heavy ? 0.092 : 0.068, 0.075, 0, -0.052, -0.055, palette.camoMag);
    b.box(fallbackMag, 0.034, 0.012, 0.08, 0, heavy ? -0.098 : -0.086, -0.055, palette.accent);

    b.box(fallbackFrame, 0.012, 0.005, 0.046, 0, -0.038, 0.018, palette.polymer);
    const triggerGroup = new THREE.Group();
    triggerGroup.position.set(0, heavy ? -0.0108 : -0.012, heavy ? 0.026 : 0.025);
    weaponPivot.add(triggerGroup);
    const fallbackTrigger = makeFallback(triggerGroup);
    b.box(fallbackTrigger, 0.006, 0.022, 0.007, 0, -0.01, -0.002, palette.accent, 0.25);
    parts.trigger = triggerGroup;

    muzzle.position.set(0, heavy ? 0.031 : 0.032, heavy ? -0.736 : -0.630);
    ejectionPort.position.set(0.030, heavy ? 0.035 : 0.036, heavy ? -0.030 : -0.035);

    if (heavy) {
      attachExternal('sniper', {
        frame: weaponPivot,
        slide: boltGroup,
        magazine: mag,
        trigger: triggerGroup,
      });
    } else {
      attachExternal('ssg', { frame: weaponPivot });
    }
  } else if (def.id === 'rifle') {
    // AK-Phantom: stamped steel receiver + Walnut wood handguard/buttstock + banana mag!
    hipOffset = new THREE.Vector3(0.21, -0.21, -0.43);
    adsOffset = new THREE.Vector3(0, -0.067, -0.34);
    rightHandGrip = new THREE.Vector3(0, -0.056, 0.060);
    leftHandRest = new THREE.Vector3(-0.014, -0.006, -0.215);
    leftHandMagOffset = new THREE.Vector3(0, -0.10, -0.095);
    leftHandBoltOffset = new THREE.Vector3(0.032, 0.035, -0.06);

    const fallbackFrame = makeFallback(weaponPivot);

    // Stamped receiver + ribbed dust cover + side selector lever
    b.box(fallbackFrame, 0.044, 0.048, 0.225, 0, 0.012, -0.02, palette.body);
    b.box(fallbackFrame, 0.038, 0.016, 0.2, 0, 0.04, -0.015, palette.darkSteel);
    for (let rz = -0.09; rz <= 0.055; rz += 0.024) {
      b.box(fallbackFrame, 0.04, 0.004, 0.006, 0, 0.049, rz, palette.darkSteel);
    }
    b.box(fallbackFrame, 0.006, 0.01, 0.058, 0.024, 0.02, -0.005, palette.accent, 0.14);

    // Oiled walnut wood buttstock with stamped steel buttplate
    b.extrudeProfile(
      fallbackFrame,
      [
        [0.09, 0.032],
        [0.275, 0.01],
        [0.278, -0.072],
        [0.09, -0.01],
      ],
      0.038,
      0.003,
      palette.camoWood,
    );
    b.box(fallbackFrame, 0.04, 0.084, 0.01, 0, -0.031, 0.28, palette.darkSteel);

    // Stippled dark pistol grip + trigger guard
    b.box(fallbackFrame, 0.034, 0.11, 0.044, 0, -0.06, 0.065, palette.rubber, -0.24);
    b.box(fallbackFrame, 0.012, 0.005, 0.044, 0, -0.032, 0.016, palette.darkSteel);
    const triggerGroup = new THREE.Group();
    triggerGroup.position.set(0, -0.009, 0.011);
    weaponPivot.add(triggerGroup);
    const fallbackTrigger = makeFallback(triggerGroup);
    b.box(fallbackTrigger, 0.006, 0.02, 0.007, 0, -0.011, 0.011, palette.accent, 0.28);
    parts.trigger = triggerGroup;

    // Walnut wood lower & upper vented handguards
    b.box(fallbackFrame, 0.044, 0.032, 0.165, 0, 0.005, -0.215, palette.camoWood);
    b.box(fallbackFrame, 0.036, 0.022, 0.145, 0, 0.033, -0.21, palette.camoWood);
    b.cyl(fallbackFrame, 0.01, 0.01, 0.17, 0, 0.036, -0.26, palette.darkSteel, 12); // Gas tube
    b.box(fallbackFrame, 0.022, 0.034, 0.026, 0, 0.027, -0.34, palette.darkSteel, -0.35); // Angled gas block

    // Heavy barrel + cleaning rod + hooded front sight + slant compensator
    b.latheBarrel(
      fallbackFrame,
      [
        [0.011, 0.0],
        [0.011, 0.34],
        [0.0135, 0.348],
        [0.0135, 0.39],
      ],
      0,
      0.018,
      -0.135,
      palette.darkSteel,
      14,
    );
    b.cyl(fallbackFrame, 0.0035, 0.0035, 0.28, 0, -0.002, -0.32, palette.brushedSteel, 8);
    b.addIronSights(fallbackFrame, -0.08, -0.465, 0.046, palette.darkSteel, palette.tritium);
    b.box(fallbackFrame, 0.008, 0.024, 0.02, 0, 0.036, -0.465, palette.darkSteel); // Hooded front post

    // Right-side reciprocating bolt carrier
    const bolt = new THREE.Group();
    weaponPivot.add(bolt);
    parts.slideOrBolt = bolt;
    const fallbackBolt = makeFallback(bolt);
    b.box(fallbackBolt, 0.012, 0.018, 0.072, 0.019, 0.024, -0.045, palette.brushedSteel);
    b.cyl(fallbackBolt, 0.005, 0.005, 0.022, 0.03, 0.024, -0.02, palette.brushedSteel, 10, 0, 0, Math.PI / 2);

    // True curved banana magazine via ExtrudeGeometry!
    const mag = new THREE.Group();
    weaponPivot.add(mag);
    parts.magazine = mag;
    const fallbackMag = makeFallback(mag);
    b.extrudeProfile(
      fallbackMag,
      [
        [-0.068, -0.008],
        [-0.125, -0.008],
        [-0.145, -0.095],
        [-0.175, -0.175],
        [-0.12, -0.19],
        [-0.088, -0.098],
      ],
      0.026,
      0.002,
      palette.camoMag,
    );
    b.box(fallbackMag, 0.03, 0.012, 0.062, 0, -0.184, -0.148, palette.accent, 0.42);

    muzzle.position.set(0, 0.022, -0.495);
    ejectionPort.position.set(0.028, 0.032, -0.075);

    attachExternal('rifle', {
      frame: weaponPivot,
      slide: bolt,
      magazine: mag,
      trigger: triggerGroup,
    });
  } else {
    // M4-X (Locust): Split AR-15 upper/lower receiver, brass deflector, CNC M-LOK shroud, angled foregrip, reflex optic, crane stock, curved PMAG
    hipOffset = new THREE.Vector3(0.21, -0.21, -0.43);
    adsOffset = new THREE.Vector3(0, -0.088, -0.34);
    rightHandGrip = new THREE.Vector3(0, -0.064, 0.064);
    leftHandRest = new THREE.Vector3(-0.014, -0.012, -0.235);
    leftHandMagOffset = new THREE.Vector3(0, -0.105, -0.075);
    leftHandBoltOffset = new THREE.Vector3(-0.010, 0.060, 0.080);

    const fallbackFrame = makeFallback(weaponPivot);

    // Upper & lower split AR receiver + brass deflector + magwell flare
    b.box(fallbackFrame, 0.042, 0.036, 0.215, 0, 0.028, -0.015, palette.body);
    b.box(fallbackFrame, 0.04, 0.032, 0.185, 0, -0.004, -0.01, palette.darkSteel);
    b.box(fallbackFrame, 0.014, 0.022, 0.022, 0.024, 0.026, -0.005, palette.darkSteel, 0, 0.35, 0); // Brass deflector
    b.box(fallbackFrame, 0.044, 0.038, 0.068, 0, -0.022, -0.082, palette.body); // Magwell

    // Continuous top Picatinny rail + holographic reflex optic
    b.addPicatinnyRail(fallbackFrame, 0.075, -0.32, 0.048, 0.022, palette.aluminum);
    b.addReflexOptic(fallbackFrame, -0.025, 0.052, palette.darkSteel, palette.opticGlass, palette.accent);

    // Free-float vented CNC aluminum M-LOK handguard + angled foregrip + compact PEQ module
    b.box(fallbackFrame, 0.042, 0.046, 0.21, 0, 0.02, -0.225, palette.camoFurniture);
    for (let vz = -0.305; vz <= -0.145; vz += 0.036) {
      b.box(fallbackFrame, 0.044, 0.014, 0.022, 0, 0.02, vz, palette.darkSteel);
    }
    b.box(fallbackFrame, 0.026, 0.034, 0.064, 0, -0.015, -0.245, palette.polymer, -0.32); // Angled foregrip
    b.box(fallbackFrame, 0.022, 0.022, 0.068, 0.026, 0.026, -0.265, palette.polymer); // Side PEQ box

    // Match barrel + 3-prong flash hider
    b.latheBarrel(
      fallbackFrame,
      [
        [0.011, 0.0],
        [0.011, 0.12],
        [0.0145, 0.126],
        [0.0145, 0.168],
        [0.0115, 0.172],
      ],
      0,
      0.024,
      -0.325,
      palette.darkSteel,
      14,
    );

    // Crane stock on buffer tube + rubber buttpad
    b.cyl(fallbackFrame, 0.016, 0.016, 0.18, 0, 0.02, 0.175, palette.aluminum, 12);
    b.extrudeProfile(
      fallbackFrame,
      [
        [0.12, 0.038],
        [0.27, 0.036],
        [0.272, -0.065],
        [0.165, -0.035],
        [0.12, 0.002],
      ],
      0.046,
      0.003,
      palette.camoFurniture,
    );
    b.box(fallbackFrame, 0.048, 0.098, 0.014, 0, -0.014, 0.275, palette.rubber);

    // Stippled grip + trigger + rear T-charging handle + bolt carrier
    b.box(fallbackFrame, 0.034, 0.108, 0.044, 0, -0.056, 0.06, palette.rubber, -0.24);
    b.box(fallbackFrame, 0.012, 0.005, 0.046, 0, -0.032, 0.01, palette.darkSteel);
    const triggerGroup = new THREE.Group();
    triggerGroup.position.set(0, -0.023, 0.012);
    weaponPivot.add(triggerGroup);
    const fallbackTrigger = makeFallback(triggerGroup);
    b.box(fallbackTrigger, 0.006, 0.02, 0.007, 0, 0.003, 0.004, palette.accent, 0.25);
    parts.trigger = triggerGroup;

    const ch = new THREE.Group();
    weaponPivot.add(ch);
    parts.chargingHandle = ch;
    const fallbackCh = makeFallback(ch);
    b.box(fallbackCh, 0.032, 0.01, 0.022, 0, 0.038, 0.09, palette.accent);

    const bolt = new THREE.Group();
    weaponPivot.add(bolt);
    parts.slideOrBolt = bolt;
    const fallbackBolt = makeFallback(bolt);
    b.box(fallbackBolt, 0.01, 0.018, 0.056, 0.018, 0.026, -0.042, palette.brushedSteel);

    // Curved ribbed PMAG
    const mag = new THREE.Group();
    weaponPivot.add(mag);
    parts.magazine = mag;
    const fallbackMag = makeFallback(mag);
    b.extrudeProfile(
      fallbackMag,
      [
        [-0.056, -0.022],
        [-0.108, -0.022],
        [-0.122, -0.102],
        [-0.14, -0.172],
        [-0.088, -0.18],
        [-0.068, -0.098],
      ],
      0.024,
      0.002,
      palette.camoMag,
    );
    b.box(fallbackMag, 0.028, 0.012, 0.056, 0, -0.175, -0.114, palette.accent, 0.28);

    muzzle.position.set(0, 0.033, -0.465);
    ejectionPort.position.set(0.026, 0.033, -0.055);

    attachExternal('m4', {
      frame: weaponPivot,
      chargingHandle: ch,
      magazine: mag,
      trigger: triggerGroup,
    });
  }

  anchorsRef = {
    muzzle,
    ejectionPort,
    rightHandGrip,
    leftHandRest,
    leftHandFollowsPump,
    leftHandMagOffset,
    leftHandBoltOffset,
    useLeftHand,
    hipOffset,
    hipRotation,
    adsOffset,
  };

  return {
    root,
    weaponPivot,
    parts,
    anchors: anchorsRef,
    def,
    get onExternalLoaded() {
      return notifyExternalLoaded;
    },
    set onExternalLoaded(fn: (() => void) | undefined) {
      notifyExternalLoaded = fn;
    },
    dispose: () => {
      disposed = true;
      extDispose?.();
      extDispose = undefined;
      b.disposeAll();
    },
  };
}

export function createWeaponMesh(def: WeaponDef, skin?: WeaponSkin): THREE.Group {
  return createWeaponRig(def, skin).root;
}
