import * as THREE from 'three';
import { BotRagdollSnapshot } from './bots';
import {
  buildCurvedJointPad,
  buildSculptedBattleBeltAndHolster,
  buildSculptedCombatBoot,
  buildSculptedGlovedHand,
  buildSculptedHeadAssembly,
  buildSculptedPlateCarrierAndGear,
  getCharacterMaterialPalette,
  getSculptedCalfGeometry,
  getSculptedForearmGeometry,
  getSculptedPelvisGeometry,
  getSculptedThighGeometry,
  getSculptedTorsoGeometry,
  getSculptedUpperArmGeometry,
} from './characterModels';
import {
  createExternalCharacterFromAsset,
  ExternalCharacterRig,
  getCachedCharacterAssetSync,
} from './externalCharacterModel';
import { createPBRSurface } from './textures';

export type RagdollKillKind = 'headshot' | 'body' | 'shotgun' | 'sniper' | 'explosion' | 'melee';

export type WallResolver = (pos: THREE.Vector3, radius: number) => void;

export interface RagdollManagerOptions {
  maxCorpses?: number;
  corpseLifetimeSec?: number;
}

interface JointAxis {
  angle: number;
  vel: number;
  target: number;
  min: number;
  max: number;
  stiffness: number;
  damping: number;
}

function stepJoint(j: JointAxis, dt: number): number {
  const force = (j.target - j.angle) * j.stiffness;
  j.vel += force * dt;
  j.vel *= Math.exp(-j.damping * dt);
  j.angle += j.vel * dt;
  if (j.angle < j.min) {
    j.angle = j.min;
    if (j.vel < 0) j.vel *= -0.18;
  } else if (j.angle > j.max) {
    j.angle = j.max;
    if (j.vel > 0) j.vel *= -0.18;
  }
  return j.angle;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

let cachedKevlarPbr: ReturnType<typeof createPBRSurface> | null = null;
function getKevlarMaps(): ReturnType<typeof createPBRSurface> {
  if (!cachedKevlarPbr) {
    cachedKevlarPbr = createPBRSurface('kevlar', '#ffffff', 1, 1);
  }
  return cachedKevlarPbr;
}

export class RagdollCorpse {
  public readonly root = new THREE.Group();
  public readonly pelvisGroup = new THREE.Group();
  public readonly spineGroup = new THREE.Group();
  public readonly headGroup = new THREE.Group();
  public readonly hipL = new THREE.Group();
  public readonly kneeL = new THREE.Group();
  public readonly ankleL = new THREE.Group();
  public readonly hipR = new THREE.Group();
  public readonly kneeR = new THREE.Group();
  public readonly ankleR = new THREE.Group();
  public readonly armL = new THREE.Group();
  public readonly elbowL = new THREE.Group();
  public readonly armR = new THREE.Group();
  public readonly elbowR = new THREE.Group();
  public readonly gunGroup = new THREE.Group();

  public pos = new THREE.Vector3();
  public vel = new THREE.Vector3();
  public sleeping = false;
  public age = 0;

  private readonly scale: number;
  private readonly restHeight: number;
  private sleepTimer = 0;
  private impactCount = 0;

  private pelvisPitch: number;
  private pelvisPitchVel: number;
  private targetPelvisPitch: number;

  private pelvisRoll: number;
  private pelvisRollVel: number;
  private targetPelvisRoll: number;

  private pelvisYaw: number;
  private pelvisYawVel: number;

  private spineX: JointAxis;
  private spineZ: JointAxis;
  private headX: JointAxis;
  private headZ: JointAxis;
  private hipLX: JointAxis;
  private hipLZ: JointAxis;
  private kneeLX: JointAxis;
  private hipRX: JointAxis;
  private hipRZ: JointAxis;
  private kneeRX: JointAxis;
  private armLX: JointAxis;
  private armLZ: JointAxis;
  private elbowLX: JointAxis;
  private armRX: JointAxis;
  private armRZ: JointAxis;
  private elbowRX: JointAxis;

  private gunPos = new THREE.Vector3();
  private gunVel = new THREE.Vector3();
  private gunRotVel = new THREE.Vector3();
  private gunSleeping = false;

  // Track ONLY per-corpse cloned materials & non-cached weapon geometries (NEVER dispose characterModels cached geos!)
  private ownedMaterials: THREE.Material[] = [];
  private ownedGeos: THREE.BufferGeometry[] = [];
  private bodyMat: THREE.MeshStandardMaterial;
  private externalChar: ExternalCharacterRig | null = null;

  constructor(snap: BotRagdollSnapshot, impulseDir: THREE.Vector3, killKind: RagdollKillKind) {
    this.scale = snap.scale;
    this.restHeight = 0.165 * this.scale;
    this.pos.set(snap.pos.x, Math.max(this.restHeight, snap.pos.y + snap.pose.pelvisY * this.scale), snap.pos.z);

    const palette = getCharacterMaterialPalette();
    const kevlar = getKevlarMaps();

    this.bodyMat = new THREE.MeshStandardMaterial({
      color: snap.bodyColor,
      emissive: new THREE.Color(snap.emissiveColor),
      emissiveIntensity: snap.emissiveIntensity,
      map: kevlar.map,
      normalMap: kevlar.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      bumpMap: kevlar.bumpMap,
      bumpScale: 0.02,
      roughnessMap: kevlar.roughnessMap,
      roughness: 0.78,
      metalness: 0.08,
    });
    const helmetMat = palette.helmetShell.clone();
    const visorMat = new THREE.MeshStandardMaterial({
      color: '#020617',
      roughness: 0.14,
      metalness: 0.84,
      emissive: new THREE.Color(snap.visorEmissive),
      emissiveIntensity: 0.15,
    });
    this.ownedMaterials.push(this.bodyMat, helmetMat, visorMat);

    // Dummy LOD collectors (discarded; keep silhouette crisp at LOD1 detail)
    const lod0: THREE.Object3D[] = [];
    const lod1: THREE.Object3D[] = [];

    // 1. Pelvis rig at local origin (0,0,0) so root rotates around center of mass
    this.root.add(this.pelvisGroup);
    const pelvisMesh = new THREE.Mesh(getSculptedPelvisGeometry(), palette.pantsFabric);
    pelvisMesh.castShadow = true;
    pelvisMesh.receiveShadow = true;
    this.pelvisGroup.add(pelvisMesh);

    const thighGeo = getSculptedThighGeometry();
    const calfGeo = getSculptedCalfGeometry();

    const buildLeg = (side: -1 | 1, hip: THREE.Group, knee: THREE.Group, ankle: THREE.Group) => {
      hip.position.set(side * 0.145, -0.06, 0);
      this.pelvisGroup.add(hip);
      const thigh = new THREE.Mesh(thighGeo, palette.pantsFabric);
      thigh.castShadow = true;
      hip.add(thigh);

      knee.position.set(0, -0.34, 0);
      hip.add(knee);
      knee.add(buildCurvedJointPad(0.088, 0.115, palette, lod0));

      const calf = new THREE.Mesh(calfGeo, palette.pantsFabric);
      calf.castShadow = true;
      knee.add(calf);

      ankle.position.set(0, -0.29, 0);
      knee.add(ankle);
      ankle.add(buildSculptedCombatBoot(palette, lod0));
    };

    buildLeg(-1, this.hipL, this.kneeL, this.ankleL);
    buildLeg(1, this.hipR, this.kneeR, this.ankleR);
    buildSculptedBattleBeltAndHolster(this.pelvisGroup, this.hipR, palette, lod0, lod1);

    // 2. Spine + Plate Carrier + Head Assembly
    this.spineGroup.position.set(0, 0.10, 0);
    this.pelvisGroup.add(this.spineGroup);

    const torsoMesh = new THREE.Mesh(getSculptedTorsoGeometry(), this.bodyMat);
    torsoMesh.castShadow = true;
    torsoMesh.receiveShadow = true;
    this.spineGroup.add(torsoMesh);

    const { carrierGroup } = buildSculptedPlateCarrierAndGear(
      snap.variantId,
      palette,
      this.bodyMat,
      lod0,
      lod1,
    );
    this.spineGroup.add(carrierGroup);

    const upperArmGeo = getSculptedUpperArmGeometry();
    const forearmGeo = getSculptedForearmGeometry();

    const buildArm = (side: -1 | 1, shoulder: THREE.Group, elbow: THREE.Group) => {
      shoulder.position.set(side * 0.32, 0.50, 0.02);
      this.spineGroup.add(shoulder);

      const poseGroup = new THREE.Group();
      poseGroup.rotation.set(side < 0 ? -0.92 : -0.88, side < 0 ? 0.24 : -0.16, side * 0.14);
      shoulder.add(poseGroup);

      const upper = new THREE.Mesh(upperArmGeo, this.bodyMat);
      upper.castShadow = true;
      poseGroup.add(upper);

      elbow.position.set(0, -0.23, 0);
      elbow.rotation.x = side < 0 ? -0.42 : -0.48;
      poseGroup.add(elbow);

      const epad = buildCurvedJointPad(0.062, 0.085, palette, lod0);
      epad.rotation.y = Math.PI;
      elbow.add(epad);

      const fore = new THREE.Mesh(forearmGeo, this.bodyMat);
      fore.castShadow = true;
      elbow.add(fore);

      const hand = buildSculptedGlovedHand(side, palette, lod0);
      hand.position.set(0, -0.22, 0.01);
      hand.rotation.x = -Math.PI * 0.35;
      elbow.add(hand);
    };

    buildArm(-1, this.armL, this.elbowL);
    buildArm(1, this.armR, this.elbowR);

    this.headGroup.position.set(0, 0.84, 0);
    this.spineGroup.add(this.headGroup);
    const headAssembly = buildSculptedHeadAssembly(snap.variantId, palette, helmetMat, visorMat, lod0, lod1);
    this.headGroup.add(headAssembly.headMesh, headAssembly.helmetMesh, headAssembly.visorMesh);

    for (const d of lod0) d.visible = false;

    this.root.scale.setScalar(this.scale);
    this.root.rotation.order = 'YXZ';

    // When the PS1 external character is cached, hide procedural body parts and attach rigged corpse mesh
    const cachedAsset = getCachedCharacterAssetSync();
    if (cachedAsset) {
      const ext = createExternalCharacterFromAsset(cachedAsset);
      if (ext) {
        this.externalChar = ext;
        for (const child of this.pelvisGroup.children) {
          child.visible = false;
        }
        ext.root.position.set(0, -0.94, 0);
        ext.setAppearance(snap.bodyColor, snap.emissiveColor, snap.emissiveIntensity);
        this.pelvisGroup.add(ext.root);
      }
    }

    // 3. Dropped Carbine Prop (detaches and clatters on ground beside corpse)
    const recGeo = new THREE.BoxGeometry(0.055, 0.085, 0.35);
    const barGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.34, 8);
    barGeo.rotateX(Math.PI / 2);
    const magGeo = new THREE.BoxGeometry(0.032, 0.15, 0.06);
    this.ownedGeos.push(recGeo, barGeo, magGeo);

    const gRec = new THREE.Mesh(recGeo, palette.gunmetal);
    gRec.castShadow = true;
    const gBar = new THREE.Mesh(barGeo, palette.gunmetal);
    gBar.position.set(0, 0.014, 0.31);
    const gMag = new THREE.Mesh(magGeo, palette.rigCordura);
    gMag.position.set(0, -0.095, 0.05);
    gMag.rotation.x = 0.2;
    this.gunGroup.add(gRec, gBar, gMag);
    this.gunGroup.scale.setScalar(this.scale);

    // Compute world knockback direction projected onto horizontal plane
    const dir = impulseDir.clone();
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) {
      dir.set(-Math.sin(snap.yaw), 0, -Math.cos(snap.yaw));
    } else {
      dir.normalize();
    }

    // Kill-type velocity & angular impulse profiles
    const speedMap: Record<RagdollKillKind, [number, number]> = {
      headshot: [4.3, 1.55],
      body: [2.6, 0.72],
      shotgun: [6.8, 2.25],
      sniper: [7.6, 2.1],
      explosion: [9.4, 4.6],
      melee: [1.9, 0.55],
    };
    const [horizSpd, upSpd] = speedMap[killKind];
    this.vel.copy(snap.vel).multiplyScalar(0.45).addScaledVector(dir, horizSpd * (0.85 + Math.random() * 0.3));
    this.vel.y = upSpd * (0.85 + Math.random() * 0.3);

    // Determine fall direction in bot's local +Z forward frame:
    // +Z forward -> hit pushing backward (-Z) falls supine (pelvisPitch -> -PI/2);
    // hit pushing forward (+Z) falls prone (pelvisPitch -> +PI/2).
    const botFwdX = Math.sin(snap.yaw);
    const botFwdZ = Math.cos(snap.yaw);
    const pushForwardDot = dir.x * botFwdX + dir.z * botFwdZ;
    const fallBackward = pushForwardDot < 0.15;

    this.pelvisYaw = snap.yaw;
    this.pelvisYawVel = (Math.random() - 0.5) * (killKind === 'explosion' ? 7.5 : killKind === 'melee' ? 4.8 : 2.8);

    this.pelvisPitch = 0;
    this.targetPelvisPitch = fallBackward ? -(Math.PI / 2 - 0.08) : Math.PI / 2 - 0.08;
    const pitchImpulse = (killKind === 'headshot' || killKind === 'sniper' || killKind === 'shotgun' ? 6.2 : 4.2) * (fallBackward ? -1 : 1);
    this.pelvisPitchVel = pitchImpulse;

    const sideSign = Math.random() > 0.5 ? 1 : -1;
    this.pelvisRoll = 0;
    this.targetPelvisRoll = sideSign * (0.18 + Math.random() * 0.34);
    this.pelvisRollVel = sideSign * (1.8 + Math.random() * 2.2);

    // Articulated limb springs initialized smoothly from the live death frame pose
    const p = snap.pose;
    const isSupine = fallBackward;
    const s = sideSign;

    this.spineX = {
      angle: p.spine.x,
      vel: isSupine ? (killKind === 'headshot' ? -4.5 : -2.2) : 2.4,
      target: isSupine ? -0.18 : 0.24,
      min: -0.55,
      max: 0.65,
      stiffness: 34,
      damping: 6.5,
    };
    this.spineZ = {
      angle: p.spine.z,
      vel: s * 1.4,
      target: s * 0.14,
      min: -0.45,
      max: 0.45,
      stiffness: 28,
      damping: 6,
    };
    this.headX = {
      angle: p.head.x,
      vel: killKind === 'headshot' ? (isSupine ? -10.5 : 8.0) : (isSupine ? -3.5 : 2.5),
      target: isSupine ? -0.32 : 0.25,
      min: -0.78,
      max: 0.65,
      stiffness: 42,
      damping: 6.8,
    };
    this.headZ = {
      angle: p.head.z,
      vel: -s * (killKind === 'headshot' ? 5.2 : 2.0),
      target: -s * 0.28,
      min: -0.65,
      max: 0.65,
      stiffness: 32,
      damping: 6.2,
    };

    // Hips & Knees (strictly enforce knee.rotation.x >= 0.04 so knees NEVER invert backward!)
    this.hipLX = {
      angle: -p.hipL.x,
      vel: 1.8 + Math.random() * 1.8,
      target: isSupine ? 0.18 + Math.random() * 0.22 : -0.05,
      min: -0.65,
      max: 0.95,
      stiffness: 28,
      damping: 6.5,
    };
    this.hipLZ = {
      angle: p.hipL.z,
      vel: -1.4,
      target: -0.18 - Math.random() * 0.15,
      min: -0.62,
      max: 0.15,
      stiffness: 26,
      damping: 6.2,
    };
    this.kneeLX = {
      angle: Math.max(0.05, p.kneeL.x),
      vel: 2.8,
      target: 0.28 + Math.random() * 0.45,
      min: 0.04,
      max: 2.15,
      stiffness: 32,
      damping: 6.8,
    };

    this.hipRX = {
      angle: -p.hipR.x,
      vel: -1.2 + Math.random() * 1.5,
      target: isSupine ? 0.08 + Math.random() * 0.16 : -0.1,
      min: -0.65,
      max: 0.95,
      stiffness: 28,
      damping: 6.5,
    };
    this.hipRZ = {
      angle: p.hipR.z,
      vel: 1.5,
      target: 0.22 + Math.random() * 0.16,
      min: -0.15,
      max: 0.62,
      stiffness: 26,
      damping: 6.2,
    };
    this.kneeRX = {
      angle: Math.max(0.05, p.kneeR.x),
      vel: 2.0,
      target: 0.16 + Math.random() * 0.32,
      min: 0.04,
      max: 2.15,
      stiffness: 32,
      damping: 6.8,
    };

    // Arms fling open naturally onto ground from torso velocity
    this.armLX = {
      angle: p.armL.x,
      vel: isSupine ? -4.2 : 3.2,
      target: isSupine ? 0.42 + Math.random() * 0.45 : 0.78,
      min: -0.85,
      max: 1.45,
      stiffness: 24,
      damping: 5.5,
    };
    this.armLZ = {
      angle: p.armL.z,
      vel: -3.6,
      target: -(0.52 + Math.random() * 0.48),
      min: -1.35,
      max: 0.25,
      stiffness: 24,
      damping: 5.6,
    };
    this.elbowLX = {
      angle: p.elbowL.x,
      vel: -1.5,
      target: -(0.22 + Math.random() * 0.45),
      min: -1.65,
      max: -0.08,
      stiffness: 26,
      damping: 6.0,
    };

    this.armRX = {
      angle: p.armR.x,
      vel: isSupine ? -3.4 : 2.8,
      target: isSupine ? 0.25 + Math.random() * 0.42 : 0.65,
      min: -0.85,
      max: 1.45,
      stiffness: 24,
      damping: 5.5,
    };
    this.armRZ = {
      angle: p.armR.z,
      vel: 3.8,
      target: 0.56 + Math.random() * 0.46,
      min: -0.25,
      max: 1.35,
      stiffness: 24,
      damping: 5.6,
    };
    this.elbowRX = {
      angle: p.elbowR.x,
      vel: -1.8,
      target: -(0.28 + Math.random() * 0.5),
      min: -1.65,
      max: -0.08,
      stiffness: 26,
      damping: 6.0,
    };

    // Dropped rifle ejects outward from right hand
    this.gunPos.set(snap.pos.x + botFwdX * 0.32 * this.scale, snap.pos.y + 1.08 * this.scale, snap.pos.z + botFwdZ * 0.32 * this.scale);
    this.gunVel.set(
      this.vel.x * 0.55 + (Math.random() - 0.5) * 2.8,
      1.6 + Math.random() * 1.4,
      this.vel.z * 0.55 + (Math.random() - 0.5) * 2.8,
    );
    this.gunRotVel.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 14);
    this.gunGroup.rotation.set(0, snap.yaw, Math.PI * 0.5);

    this.syncTransforms();
  }

  public getKneeAngles(): [number, number] {
    return [this.kneeL.rotation.x, this.kneeR.rotation.x];
  }

  private syncTransforms(): void {
    this.root.position.copy(this.pos);
    this.root.rotation.set(this.pelvisPitch, this.pelvisYaw, this.pelvisRoll, 'YXZ');

    this.spineGroup.rotation.set(this.spineX.angle, 0, this.spineZ.angle);
    this.headGroup.rotation.set(this.headX.angle, 0, this.headZ.angle);

    this.hipL.rotation.set(-this.hipLX.angle, 0, this.hipLZ.angle);
    this.kneeL.rotation.x = Math.max(0, this.kneeLX.angle);

    this.hipR.rotation.set(-this.hipRX.angle, 0, this.hipRZ.angle);
    this.kneeR.rotation.x = Math.max(0, this.kneeRX.angle);

    this.armL.rotation.set(this.armLX.angle, 0, this.armLZ.angle);
    this.elbowL.rotation.x = this.elbowLX.angle;

    this.armR.rotation.set(this.armRX.angle, 0, this.armRZ.angle);
    this.elbowR.rotation.x = this.elbowRX.angle;

    this.gunGroup.position.copy(this.gunPos);

    if (this.externalChar) {
      this.externalChar.applyRagdollPose({
        spineX: this.spineX.angle,
        spineZ: this.spineZ.angle,
        headX: this.headX.angle,
        headZ: this.headZ.angle,
        hipLX: this.hipLX.angle,
        hipLZ: this.hipLZ.angle,
        kneeLX: Math.max(0, this.kneeLX.angle),
        hipRX: this.hipRX.angle,
        hipRZ: this.hipRZ.angle,
        kneeRX: Math.max(0, this.kneeRX.angle),
        armLX: this.armLX.angle,
        armLZ: this.armLZ.angle,
        elbowLX: this.elbowLX.angle,
        armRX: this.armRX.angle,
        armRZ: this.armRZ.angle,
        elbowRX: this.elbowRX.angle,
      });
    }
  }

  public step(
    dt: number,
    resolveWalls: WallResolver,
    onImpact?: (pos: THREE.Vector3, speed: number) => void,
  ): void {
    const h = Math.min(dt, 0.045);
    this.age += h;

    // Step dropped weapon prop
    if (!this.gunSleeping) {
      this.gunVel.y -= 22 * h;
      this.gunPos.addScaledVector(this.gunVel, h);
      resolveWalls(this.gunPos, 0.22 * this.scale);
      const gunRestY = 0.055 * this.scale;
      if (this.gunPos.y <= gunRestY) {
        this.gunPos.y = gunRestY;
        if (Math.abs(this.gunVel.y) > 0.7) {
          this.gunVel.y = Math.abs(this.gunVel.y) * 0.28;
          this.gunVel.x *= 0.58;
          this.gunVel.z *= 0.58;
          this.gunRotVel.multiplyScalar(0.55);
        } else {
          this.gunVel.set(0, 0, 0);
          this.gunRotVel.set(0, 0, 0);
          this.gunSleeping = true;
        }
      }
      this.gunGroup.position.copy(this.gunPos);
      this.gunGroup.rotation.x += this.gunRotVel.x * h;
      this.gunGroup.rotation.y += this.gunRotVel.y * h;
      this.gunGroup.rotation.z += this.gunRotVel.z * h;
    }

    if (this.sleeping) return;

    // Pelvis rigid-body gravity & linear integration
    this.vel.y -= 22 * h;
    this.pos.addScaledVector(this.vel, h);

    // Wall collision bounce detection
    const preWallX = this.pos.x;
    const preWallZ = this.pos.z;
    resolveWalls(this.pos, 0.42 * this.scale);
    const pushX = this.pos.x - preWallX;
    const pushZ = this.pos.z - preWallZ;
    if (pushX * pushX + pushZ * pushZ > 1e-5) {
      const nLen = Math.hypot(pushX, pushZ);
      const nx = pushX / nLen;
      const nz = pushZ / nLen;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn < 0) {
        const wallImp = Math.abs(vn);
        this.vel.x -= 1.3 * vn * nx;
        this.vel.z -= 1.3 * vn * nz;
        this.vel.multiplyScalar(0.72);
        this.pelvisYawVel += (Math.random() - 0.5) * 3.0;
        if (wallImp > 1.8 && this.impactCount < 3) {
          this.impactCount++;
          onImpact?.(this.pos, wallImp);
        }
      }
    }

    // Ground collision bounce & friction
    if (this.pos.y <= this.restHeight) {
      this.pos.y = this.restHeight;
      const impactDown = -this.vel.y;
      if (impactDown > 1.6 && this.impactCount < 3) {
        this.impactCount++;
        onImpact?.(this.pos, impactDown);
      }
      if (impactDown > 1.1) {
        this.vel.y = impactDown * 0.22;
      } else {
        this.vel.y = 0;
      }
      const friction = Math.exp(-9.5 * h);
      this.vel.x *= friction;
      this.vel.z *= friction;
    }

    // Whole-body pitch/roll/yaw collapse springs
    const fallStiff = this.pos.y <= this.restHeight + 0.08 ? 46 : 22;
    const fallDamp = this.pos.y <= this.restHeight + 0.08 ? 9.5 : 5.0;
    this.pelvisPitchVel += (this.targetPelvisPitch - this.pelvisPitch) * fallStiff * h;
    this.pelvisPitchVel *= Math.exp(-fallDamp * h);
    this.pelvisPitch = clamp(this.pelvisPitch + this.pelvisPitchVel * h, -Math.PI * 0.54, Math.PI * 0.54);

    this.pelvisRollVel += (this.targetPelvisRoll - this.pelvisRoll) * 32 * h;
    this.pelvisRollVel *= Math.exp(-8.0 * h);
    this.pelvisRoll = clamp(this.pelvisRoll + this.pelvisRollVel * h, -Math.PI * 0.48, Math.PI * 0.48);

    this.pelvisYawVel *= Math.exp(-6.5 * h);
    this.pelvisYaw += this.pelvisYawVel * h;

    // Articulated limb springs
    stepJoint(this.spineX, h);
    stepJoint(this.spineZ, h);
    stepJoint(this.headX, h);
    stepJoint(this.headZ, h);
    stepJoint(this.hipLX, h);
    stepJoint(this.hipLZ, h);
    stepJoint(this.kneeLX, h);
    stepJoint(this.hipRX, h);
    stepJoint(this.hipRZ, h);
    stepJoint(this.kneeRX, h);
    stepJoint(this.armLX, h);
    stepJoint(this.armLZ, h);
    stepJoint(this.elbowLX, h);
    stepJoint(this.armRX, h);
    stepJoint(this.armRZ, h);
    stepJoint(this.elbowRX, h);

    this.syncTransforms();

    const linSpeed = this.vel.length();
    const angSpeed = Math.abs(this.pelvisPitchVel) + Math.abs(this.pelvisRollVel) + Math.abs(this.pelvisYawVel);
    if (this.pos.y <= this.restHeight + 0.02 && linSpeed < 0.08 && angSpeed < 0.12 && this.gunSleeping) {
      this.sleepTimer += h;
      if (this.sleepTimer >= 0.4) {
        this.sleeping = true;
      }
    } else {
      this.sleepTimer = 0;
    }
  }

  public applyFadeOut(fadeFrac: number): void {
    const f = clamp(fadeFrac, 0, 1);
    this.root.position.y = this.pos.y - f * 0.38 * this.scale;
    this.gunGroup.position.y = this.gunPos.y - f * 0.25 * this.scale;
  }

  public dispose(): void {
    this.externalChar?.dispose();
    this.externalChar = null;
    this.root.removeFromParent();
    this.gunGroup.removeFromParent();
    for (const m of this.ownedMaterials) m.dispose();
    for (const g of this.ownedGeos) g.dispose();
    this.ownedMaterials.length = 0;
    this.ownedGeos.length = 0;
  }
}

export class RagdollManager {
  private group = new THREE.Group();
  private list: RagdollCorpse[] = [];
  private maxCorpses: number;
  private lifetimeSec: number;

  constructor(scene: THREE.Scene, opts: RagdollManagerOptions = {}) {
    this.maxCorpses = opts.maxCorpses ?? 16;
    this.lifetimeSec = opts.corpseLifetimeSec ?? 15;
    scene.add(this.group);
  }

  public get count(): number {
    return this.list.length;
  }

  public get corpses(): readonly RagdollCorpse[] {
    return this.list;
  }

  public spawnFromBot(
    snap: BotRagdollSnapshot,
    impulseOrigin: THREE.Vector3,
    killKind: RagdollKillKind,
  ): RagdollCorpse {
    while (this.list.length >= this.maxCorpses) {
      const oldest = this.list.shift()!;
      oldest.dispose();
    }
    const impulseDir = new THREE.Vector3(
      snap.pos.x - impulseOrigin.x,
      0,
      snap.pos.z - impulseOrigin.z,
    );
    if (impulseDir.lengthSq() < 1e-4) {
      impulseDir.set(-Math.sin(snap.yaw), 0, -Math.cos(snap.yaw));
    } else {
      impulseDir.normalize();
    }

    const corpse = new RagdollCorpse(snap, impulseDir, killKind);
    this.group.add(corpse.root, corpse.gunGroup);
    this.list.push(corpse);
    return corpse;
  }

  public update(
    dt: number,
    resolveWalls: WallResolver,
    onImpact?: (pos: THREE.Vector3, speed: number) => void,
  ): void {
    const fadeStart = Math.max(0.5, this.lifetimeSec - 0.8);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.step(dt, resolveWalls, onImpact);
      if (c.age >= this.lifetimeSec) {
        c.dispose();
        this.list.splice(i, 1);
      } else if (c.age >= fadeStart) {
        c.applyFadeOut((c.age - fadeStart) / 0.8);
      }
    }
  }

  public clearAll(): void {
    for (const c of this.list) c.dispose();
    this.list.length = 0;
  }

  public dispose(): void {
    this.clearAll();
    this.group.removeFromParent();
  }
}
