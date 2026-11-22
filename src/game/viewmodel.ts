import * as THREE from 'three';
import { WeaponSkin } from '../data/skins';
import { WeaponDef } from '../data/weapons';
import { buildExternalFpsArms, FpsArmRig, preloadFpsArmsModel } from './armRig';
import { createLoftedProfileGeometry } from './characterModels';
import { preloadExternalWeaponModels } from './externalWeaponModels';
import { createArmMaterials } from './weaponMaterials';
import { createWeaponMesh, createWeaponRig, WeaponRig } from './weaponModels';
import { WeaponAnimCallbacks, WeaponAnimContext, WeaponAnimator } from './weaponAnimator';

export { createWeaponMesh, createWeaponRig };

let cachedMuzzleTex: THREE.CanvasTexture | null = null;

function getMuzzleFlashTexture(): THREE.CanvasTexture {
  if (cachedMuzzleTex) return cachedMuzzleTex;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;

  ctx.clearRect(0, 0, size, size);

  // Outer warm plasma glow
  const outer = ctx.createRadialGradient(cx, cy, 2, cx, cy, 58);
  outer.addColorStop(0, 'rgba(255, 255, 255, 1)');
  outer.addColorStop(0.22, 'rgba(254, 240, 138, 0.92)');
  outer.addColorStop(0.5, 'rgba(251, 146, 60, 0.48)');
  outer.addColorStop(1, 'rgba(251, 146, 60, 0)');
  ctx.fillStyle = outer;
  ctx.fillRect(0, 0, size, size);

  // Starburst directional petals
  const petals = 8;
  for (let i = 0; i < petals; i++) {
    const ang = (i / petals) * Math.PI * 2 + (i % 2) * 0.12;
    const len = i % 2 === 0 ? 58 : 42;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    g.addColorStop(0.45, 'rgba(253, 224, 71, 0.65)');
    g.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -4.5);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  cachedMuzzleTex = new THREE.CanvasTexture(canvas);
  cachedMuzzleTex.colorSpace = THREE.SRGBColorSpace;
  return cachedMuzzleTex;
}

interface ArmInstance {
  group: THREE.Group;
  fingers: THREE.Object3D;
  geos: THREE.BufferGeometry[];
}

function buildArticulatedArm(isLeft: boolean): ArmInstance {
  const mats = createArmMaterials();
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const sideSign = isLeft ? -1 : 1;

  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g);
    return g;
  };

  // 1. Sculpted anatomical gloved palm & dorsal metacarpal contour at wrist origin (0, 0, 0)
  const palmGeo = track(new THREE.SphereGeometry(0.032, 16, 12));
  const palm = new THREE.Mesh(palmGeo, mats.glove);
  palm.scale.set(0.95, 0.68, 1.24);
  palm.position.set(sideSign * 0.008, -0.003, 0.016);
  group.add(palm);

  // Molded carbon-fiber dorsal knuckle armor pods (4 individual contoured knuckle domes + bridge plate)
  const knucklePlate = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.008, 0.008, 0.056, 10)),
    mats.knuckle,
  );
  knucklePlate.rotation.z = Math.PI / 2;
  knucklePlate.position.set(sideSign * 0.008, 0.017, -0.003);
  group.add(knucklePlate);

  const podGeo = track(new THREE.SphereGeometry(0.0075, 10, 8));
  const fingerXOffsets = [-0.020, -0.007, 0.007, 0.020];
  for (let i = 0; i < 4; i++) {
    const pod = new THREE.Mesh(podGeo, mats.knuckle);
    pod.scale.set(0.95, 0.72, 1.15);
    pod.position.set(sideSign * 0.008 + fingerXOffsets[i], 0.020, -0.005);
    group.add(pod);
  }

  // 2. Four individually sculpted, multi-segment articulated fingers (proximal + middle + distal phalanges)
  const fingers = new THREE.Group();
  fingers.position.set(sideSign * 0.006, -0.008, -0.018);
  fingers.rotation.x = 0.45;
  group.add(fingers);

  const proxGeo = track(new THREE.CapsuleGeometry(0.0066, 0.020, 5, 10));
  const midGeo = track(new THREE.CapsuleGeometry(0.0059, 0.016, 5, 10));
  const distGeo = track(new THREE.CapsuleGeometry(0.0052, 0.012, 5, 10));
  const fingerScales = [0.96, 1.04, 1.0, 0.86];

  for (let i = 0; i < 4; i++) {
    const fx = fingerXOffsets[i] * -sideSign;
    const sc = fingerScales[i];
    const isTrigger = !isLeft && i === 0;

    const prox = new THREE.Mesh(proxGeo, mats.glove);
    prox.scale.setScalar(sc);
    prox.position.set(fx, 0, -0.008);
    prox.rotation.x = isTrigger ? 1.12 : 1.38;
    fingers.add(prox);

    const mid = new THREE.Mesh(midGeo, mats.glove);
    mid.scale.setScalar(sc);
    mid.position.set(fx, -0.008, isTrigger ? -0.024 : -0.021);
    mid.rotation.x = isTrigger ? 1.48 : 2.15;
    fingers.add(mid);

    const dist = new THREE.Mesh(distGeo, mats.knuckle);
    dist.scale.setScalar(sc);
    dist.position.set(fx, -0.018, isTrigger ? -0.032 : -0.015);
    dist.rotation.x = isTrigger ? 1.85 : 2.75;
    fingers.add(dist);
  }

  // 3. Two-segment articulated opposing thumb (thenar base + distal phalanx)
  const thenarGeo = track(new THREE.CapsuleGeometry(0.0095, 0.022, 5, 10));
  const thenar = new THREE.Mesh(thenarGeo, mats.glove);
  thenar.position.set(-sideSign * 0.021, 0.004, -0.002);
  thenar.rotation.set(-1.15, sideSign * 0.42, sideSign * 0.25);
  group.add(thenar);

  const thumbTipGeo = track(new THREE.CapsuleGeometry(0.0076, 0.018, 5, 10));
  const thumbTip = new THREE.Mesh(thumbTipGeo, mats.knuckle);
  thumbTip.position.set(-sideSign * 0.026, 0.012, -0.022);
  thumbTip.rotation.set(-1.45, sideSign * 0.18, 0);
  group.add(thumbTip);

  // 4. Contoured neoprene wrist cuff & velcro strap with metallic buckle
  const cuffGeo = track(new THREE.CylinderGeometry(0.032, 0.036, 0.048, 16));
  cuffGeo.rotateX(Math.PI / 2);
  const cuff = new THREE.Mesh(cuffGeo, mats.knuckle);
  cuff.position.set(sideSign * 0.004, -0.002, 0.066);
  group.add(cuff);

  const strapRingGeo = track(new THREE.TorusGeometry(0.035, 0.0045, 6, 18));
  const strapRing = new THREE.Mesh(strapRingGeo, mats.glove);
  strapRing.position.set(sideSign * 0.004, -0.002, 0.056);
  group.add(strapRing);

  if (isLeft) {
    // 5. Left-wrist 3D tactical GPS chronometer with machined bezel & illuminated telemetry dial
    const watchGroup = new THREE.Group();
    watchGroup.position.set(-0.020, 0.024, 0.072);
    watchGroup.rotation.z = 0.36;

    const bezel = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.017, 0.018, 0.009, 16)),
      mats.knuckle,
    );
    watchGroup.add(bezel);

    const watchFace = new THREE.Mesh(
      track(new THREE.CircleGeometry(0.014, 16)),
      new THREE.MeshBasicMaterial({ color: '#38bdf8' }),
    );
    watchFace.rotation.x = -Math.PI / 2;
    watchFace.position.set(0, 0.005, 0);
    watchGroup.add(watchFace);
    group.add(watchGroup);
  }

  // 6. Sculpted combat-shirt forearm sleeve with natural fabric wrinkle folds extending toward shoulder (+Z)
  const sleeveProfileGeo = track(
    createLoftedProfileGeometry(
      0.39,
      0.195,
      [
        { t: 0.0, rx: 0.035, rz: 0.033, foldAmp: 0.0025, foldFreq: 7 },
        { t: 0.22, rx: 0.041, rz: 0.039, foldAmp: 0.0032, foldFreq: 6 },
        { t: 0.58, rx: 0.049, rz: 0.046, foldAmp: 0.0028, foldFreq: 5 },
        { t: 0.85, rx: 0.053, rz: 0.050, foldAmp: 0.0035, foldFreq: 6 },
        { t: 1.0, rx: 0.051, rz: 0.048 },
      ],
      16,
      2,
    ),
  );
  sleeveProfileGeo.rotateX(Math.PI / 2);
  const sleeve = new THREE.Mesh(sleeveProfileGeo, mats.sleeve);
  sleeve.position.set(sideSign * 0.004, -0.003, 0.27);
  group.add(sleeve);

  // Curved forearm velcro morale patch
  const patchGeo = track(
    new THREE.CylinderGeometry(
      0.049,
      0.046,
      0.056,
      12,
      1,
      true,
      sideSign < 0 ? -Math.PI * 0.72 : Math.PI * 0.28,
      Math.PI * 0.44,
    ),
  );
  patchGeo.rotateX(Math.PI / 2);
  const patch = new THREE.Mesh(patchGeo, mats.knuckle);
  patch.position.set(sideSign * 0.004, -0.002, 0.23);
  group.add(patch);

  return { group, fingers, geos };
}

export class ViewModelController {
  public root = new THREE.Group();
  private camera: THREE.Camera;
  private rig: WeaponRig | null = null;
  private animator = new WeaponAnimator();

  private leftArm: ArmInstance;
  private rightArm: ArmInstance;
  private externalArms: FpsArmRig | null = null;
  private disposed = false;
  private muzzleFlashGroup = new THREE.Group();
  private muzzleFlashMat: THREE.MeshBasicMaterial;
  private muzzleFlashGeos: THREE.BufferGeometry[] = [];
  private muzzleLight: THREE.PointLight;
  private muzzleTimer = 0;

  private tempHandPos = new THREE.Vector3();
  private tempShoulder = new THREE.Vector3();
  private tempZ = new THREE.Vector3();
  private tempX = new THREE.Vector3();
  private tempY = new THREE.Vector3();
  private tempMat4 = new THREE.Matrix4();
  private readonly upHint = new THREE.Vector3(0, 1, 0);

  constructor(camera: THREE.Camera) {
    this.camera = camera;
    camera.add(this.root);
    preloadExternalWeaponModels();
    preloadFpsArmsModel();

    this.leftArm = buildArticulatedArm(true);
    this.rightArm = buildArticulatedArm(false);
    this.root.add(this.leftArm.group, this.rightArm.group);

    void buildExternalFpsArms().then((arms) => {
      if (!arms) return;
      if (this.disposed) {
        arms.dispose();
        return;
      }
      this.externalArms = arms;
      this.leftArm.group.visible = false;
      this.rightArm.group.visible = false;
      this.root.add(arms.leftRoot, arms.rightRoot);
    });

    // Crossed-plane radial starburst muzzle flash
    const flashTex = getMuzzleFlashTexture();
    this.muzzleFlashMat = new THREE.MeshBasicMaterial({
      map: flashTex,
      color: '#fef08a',
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const planeA = new THREE.PlaneGeometry(0.18, 0.18);
    const planeB = new THREE.PlaneGeometry(0.22, 0.12);
    planeB.rotateY(Math.PI / 2);
    const planeC = new THREE.PlaneGeometry(0.22, 0.12);
    planeC.rotateY(Math.PI / 2);
    planeC.rotateZ(Math.PI / 2);
    this.muzzleFlashGeos.push(planeA, planeB, planeC);

    const mA = new THREE.Mesh(planeA, this.muzzleFlashMat);
    const mB = new THREE.Mesh(planeB, this.muzzleFlashMat);
    mB.position.z = -0.07;
    const mC = new THREE.Mesh(planeC, this.muzzleFlashMat);
    mC.position.z = -0.07;
    this.muzzleFlashGroup.add(mA, mB, mC);
    this.muzzleFlashGroup.visible = false;

    this.muzzleLight = new THREE.PointLight('#fde047', 0, 7.5);
  }

  public setCallbacks(cbs: WeaponAnimCallbacks): void {
    this.animator.setCallbacks(cbs);
  }

  public equip(def: WeaponDef, skin?: WeaponSkin): void {
    if (this.rig) {
      this.muzzleFlashGroup.removeFromParent();
      this.muzzleLight.removeFromParent();
      this.root.remove(this.rig.root);
      this.rig.dispose();
    }

    this.rig = createWeaponRig(def, skin);
    this.root.add(this.rig.root);
    this.rig.anchors.muzzle.add(this.muzzleFlashGroup);
    this.rig.anchors.muzzle.add(this.muzzleLight);

    const flashColor = skin?.tracerColor ?? '#fef08a';
    this.muzzleFlashMat.color.set(flashColor);
    this.muzzleLight.color.set(flashColor);
    this.muzzleFlashGroup.visible = false;
    this.muzzleLight.intensity = 0;
    this.muzzleTimer = 0;

    this.animator.onEquip(def, this.rig);
  }

  public onFire(isLastBullet = false): void {
    if (!this.rig) return;
    this.animator.onFire(isLastBullet);
    if (this.rig.def.isMelee) return;

    const isSuppressed = this.rig.def.id === 'smg';
    this.muzzleTimer = 0.042;
    this.muzzleFlashGroup.visible = true;
    this.muzzleFlashGroup.rotation.z = Math.random() * Math.PI * 2;
    const baseScale = isSuppressed ? 0.48 : this.rig.def.id === 'sniper' || this.rig.def.id === 'shotgun' ? 1.25 : 0.92;
    this.muzzleFlashGroup.scale.setScalar(baseScale * (0.85 + Math.random() * 0.35));
    this.muzzleLight.intensity = isSuppressed ? 0.95 : 2.6;
  }

  public onReloadStart(): void {
    this.animator.onReloadStart();
  }

  public onDryFire(): void {
    this.animator.onDryFire();
  }

  public cancelReload(grounded = true, horizSpeed = 0): void {
    this.animator.cancelReload(grounded, horizSpeed);
  }

  public onScopeToggle(scoped: boolean): void {
    this.animator.onScopeToggle(scoped);
  }

  public triggerInspect(): void {
    this.animator.triggerInspect();
  }

  public addLookSway(dx: number, dy: number): void {
    this.animator.addLookSway(dx, dy);
  }

  private alignArm(
    arm: ArmInstance,
    targetLocal: THREE.Vector3,
    shoulderPos: THREE.Vector3,
    rig: WeaponRig,
    rollRad = 0,
  ): void {
    this.tempHandPos.copy(targetLocal).applyEuler(rig.weaponPivot.rotation).add(rig.weaponPivot.position);
    arm.group.position.copy(this.tempHandPos);

    this.tempZ.copy(shoulderPos).sub(this.tempHandPos);
    if (this.tempZ.lengthSq() < 1e-5) return;
    this.tempZ.normalize();

    this.tempX.crossVectors(this.upHint, this.tempZ);
    if (this.tempX.lengthSq() < 1e-4) this.tempX.set(1, 0, 0);
    else this.tempX.normalize();

    this.tempY.crossVectors(this.tempZ, this.tempX).normalize();
    this.tempMat4.makeBasis(this.tempX, this.tempY, this.tempZ);
    arm.group.quaternion.setFromRotationMatrix(this.tempMat4);
    if (rollRad !== 0) arm.group.rotateZ(rollRad);
  }

  public update(dt: number, ctx: WeaponAnimContext): void {
    if (!this.rig) return;
    const out = this.animator.update(dt, ctx);

    this.root.visible = !ctx.scoped || out.adsAlpha < 0.88;
    this.root.position.copy(out.rootPos);
    this.root.rotation.copy(out.rootRot);
    this.rig.weaponPivot.position.copy(out.pivotPos);
    this.rig.weaponPivot.rotation.copy(out.pivotRot);

    // Update arms: prefer rigged fps_arms.glb when loaded, else procedural articulated arms
    const isMelee = !!this.rig.def.isMelee;
    if (this.externalArms) {
      this.leftArm.group.visible = false;
      this.rightArm.group.visible = false;
      this.externalArms.update(dt, this.rig, out, ctx);
    } else {
      this.rightArm.group.visible = true;
      this.tempShoulder.set(0.14, -0.25, 0.35);
      this.alignArm(this.rightArm, out.rightHandTarget, this.tempShoulder, this.rig, isMelee ? -0.75 : 0);

      // Animate right-hand trigger finger squeeze, Karambit spin finger release & grip flexion
      this.rightArm.fingers.rotation.x = 0.45 + out.gripTightenAlpha * 0.16;
      const rChildren = this.rightArm.fingers.children;
      if (rChildren.length >= 3) {
        rChildren[0].rotation.x = 1.12 + out.triggerPullAlpha * 0.28;
        rChildren[1].rotation.x = 1.48 + out.triggerPullAlpha * 0.36;
        rChildren[2].rotation.x = 1.85 + out.triggerPullAlpha * 0.42;
        const baseCurl = [1.38, 2.15, 2.75];
        const spinOpen = isMelee ? out.knifeSpinOpenAlpha * 0.55 : 0;
        for (let k = 3; k < rChildren.length; k++) {
          rChildren[k].rotation.x = baseCurl[k % 3] - spinOpen;
        }
      }

      if (out.leftHandWeight > 0.04) {
        this.leftArm.group.visible = true;
        this.tempShoulder.set(-0.28, -0.22 - (1 - out.leftHandWeight) * 0.25, 0.28);
        const loweredLeft = out.leftHandTarget.clone();
        loweredLeft.y -= (1 - out.leftHandWeight) * 0.16;
        this.alignArm(this.leftArm, loweredLeft, this.tempShoulder, this.rig);

        // Subtle left-hand finger curl adjustment during reload / foregrip hold
        const reloadFlex = ctx.reloading ? Math.sin(ctx.reloadProgress * Math.PI * 2) * 0.14 : 0;
        this.leftArm.fingers.rotation.x = 0.45 + reloadFlex + out.gripTightenAlpha * 0.12;
      } else {
        this.leftArm.group.visible = false;
      }
    }

    // Frame-rate-independent muzzle flash & dynamic light decay
    this.muzzleLight.intensity *= Math.exp(-38 * dt);
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) this.muzzleFlashGroup.visible = false;
    }
  }

  public getMuzzleWorldPos(out = new THREE.Vector3()): THREE.Vector3 {
    if (!this.rig) return out.set(0, 0, 0);
    this.camera.updateMatrixWorld(true);
    return this.rig.anchors.muzzle.getWorldPosition(out);
  }

  public getEjectionWorldPos(out = new THREE.Vector3()): THREE.Vector3 {
    if (!this.rig) return out.set(0, 0, 0);
    this.camera.updateMatrixWorld(true);
    return this.rig.anchors.ejectionPort.getWorldPosition(out);
  }

  public dispose(): void {
    this.disposed = true;
    this.muzzleFlashGroup.removeFromParent();
    this.muzzleLight.removeFromParent();
    if (this.externalArms) {
      this.externalArms.dispose();
      this.externalArms = null;
    }
    if (this.rig) {
      this.root.remove(this.rig.root);
      this.rig.dispose();
      this.rig = null;
    }
    for (const g of this.leftArm.geos) g.dispose();
    for (const g of this.rightArm.geos) g.dispose();
    for (const g of this.muzzleFlashGeos) g.dispose();
    this.muzzleFlashMat.dispose();
  }
}
