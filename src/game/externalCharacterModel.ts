import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CharacterAnimState } from './characterAnimator';

export const PS1_CHARACTER_GLB_URL = '/models/ps1_character.glb';
export const PS1_CHARACTER_SCALE = 0.75; // 2.51m native -> 1.88m tactical soldier height

export interface CachedCharacterAsset {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export interface CharacterExternalMotion {
  dt: number;
  state: CharacterAnimState;
  horizSpeed: number;
  pitch: number;
  alive: boolean;
  crouching: boolean;
  holdWeapon?: boolean;
}

export interface RagdollBonePoseInput {
  spineX: number;
  spineZ: number;
  headX: number;
  headZ: number;
  hipLX: number;
  hipLZ: number;
  kneeLX: number;
  hipRX: number;
  hipRZ: number;
  kneeRX: number;
  armLX: number;
  armLZ: number;
  elbowLX: number;
  armRX: number;
  armRZ: number;
  elbowRX: number;
}

interface CharacterBones {
  pelvis: THREE.Object3D | null;
  spineMid: THREE.Object3D | null;
  chest: THREE.Object3D | null;
  neck: THREE.Object3D | null;
  head: THREE.Object3D | null;
  upperArmL: THREE.Object3D | null;
  upperArmL2: THREE.Object3D | null;
  forearmL: THREE.Object3D | null;
  forearmL2: THREE.Object3D | null;
  handL: THREE.Object3D | null;
  upperArmR: THREE.Object3D | null;
  upperArmR2: THREE.Object3D | null;
  forearmR: THREE.Object3D | null;
  forearmR2: THREE.Object3D | null;
  handR: THREE.Object3D | null;
  thighL: THREE.Object3D | null;
  shinL: THREE.Object3D | null;
  footL: THREE.Object3D | null;
  thighR: THREE.Object3D | null;
  shinR: THREE.Object3D | null;
  footR: THREE.Object3D | null;
  all: THREE.Object3D[];
}

let cachedPromise: Promise<CachedCharacterAsset | null> | null = null;
let cachedSyncAsset: CachedCharacterAsset | null = null;

export function setCachedCharacterAssetForTest(asset: CachedCharacterAsset | null): void {
  cachedSyncAsset = asset;
}

export function getCachedCharacterAssetSync(): CachedCharacterAsset | null {
  return cachedSyncAsset;
}

export function preloadExternalCharacterModel(): void {
  if (typeof window === 'undefined') return;
  if (!cachedPromise) {
    const loader = new GLTFLoader();
    cachedPromise = loader
      .loadAsync(PS1_CHARACTER_GLB_URL)
      .then((gltf) => {
        const asset: CachedCharacterAsset = {
          scene: gltf.scene,
          animations: gltf.animations || [],
        };
        cachedSyncAsset = asset;
        return asset;
      })
      .catch((err) => {
        console.warn('[externalCharacterModel] Failed to load ps1_character.glb:', err);
        return null;
      });
  }
}

export async function buildExternalCharacterAsync(): Promise<ExternalCharacterRig | null> {
  if (typeof window === 'undefined') return null;
  preloadExternalCharacterModel();
  const asset = await cachedPromise;
  if (!asset) return null;
  return createExternalCharacterFromAsset(asset);
}

function collectCharacterBones(root: THREE.Object3D): CharacterBones {
  const byName = (n: string) => root.getObjectByName(n) ?? null;
  const bones: CharacterBones = {
    pelvis: byName('DEF-spine_05'),
    spineMid: byName('DEF-spine.002_07'),
    chest: byName('DEF-spine.003_08'),
    neck: byName('DEF-spine.004_09'),
    head: byName('DEF-spine.006_011'),
    upperArmL: byName('DEF-upper_arm.L_0144'),
    upperArmL2: byName('DEF-upper_arm.L.001_0145'),
    forearmL: byName('DEF-forearm.L_0146'),
    forearmL2: byName('DEF-forearm.L.001_0147'),
    handL: byName('DEF-hand.L_0148'),
    upperArmR: byName('DEF-upper_arm.R_0175'),
    upperArmR2: byName('DEF-upper_arm.R.001_0176'),
    forearmR: byName('DEF-forearm.R_0177'),
    forearmR2: byName('DEF-forearm.R.001_0178'),
    handR: byName('DEF-hand.R_0179'),
    thighL: byName('DEF-thigh.L_071'),
    shinL: byName('DEF-shin.L_073'),
    footL: byName('DEF-foot.L_075'),
    thighR: byName('DEF-thigh.R_090'),
    shinR: byName('DEF-shin.R_092'),
    footR: byName('DEF-foot.R_094'),
    all: [],
  };
  for (const [k, v] of Object.entries(bones)) {
    if (k !== 'all' && v) bones.all.push(v as THREE.Object3D);
  }
  return bones;
}

export class ExternalCharacterRig {
  public readonly root = new THREE.Group();
  public readonly modelGroup = new THREE.Group();
  public readonly mesh: THREE.SkinnedMesh;
  public readonly outlineMesh: THREE.SkinnedMesh;
  public readonly chamsMesh: THREE.SkinnedMesh;
  public readonly weaponMount = new THREE.Group();
  public readonly bones: CharacterBones;
  public readonly mixer: THREE.AnimationMixer;

  private readonly mat: THREE.MeshStandardMaterial;
  private readonly outlineMat: THREE.MeshBasicMaterial;
  private readonly chamsMat: THREE.MeshBasicMaterial;
  private readonly restPositions = new Map<THREE.Object3D, THREE.Vector3>();
  private readonly restQuats = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly restScales = new Map<THREE.Object3D, THREE.Vector3>();
  private readonly idleQuats = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly ragdollBaseLocal = new Map<THREE.Object3D, THREE.Matrix4>();
  private readonly idleAction: THREE.AnimationAction | null;
  private readonly walkAction: THREE.AnimationAction | null;
  private activeClip: 'idle' | 'walk' | 'none' = 'none';

  private baseColor = new THREE.Color('#ffffff');
  private baseEmissive = new THREE.Color('#000000');
  private baseEmissiveInt = 0;
  private hitFlashing = false;
  private fireRecoil = 0;
  private hitFlinch = 0;
  private hitDir = 1;
  private elimProgress = 0;
  private crouchLerp = 0;

  // Scratch math
  private tmpV1 = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpV3 = new THREE.Vector3();
  private tmpV4 = new THREE.Vector3();
  private tmpQ1 = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpQ3 = new THREE.Quaternion();
  private tmpQ4 = new THREE.Quaternion();

  constructor(clonedScene: THREE.Object3D, clips: THREE.AnimationClip[], skinnedMesh: THREE.SkinnedMesh) {
    this.modelGroup.scale.setScalar(PS1_CHARACTER_SCALE);
    this.modelGroup.position.set(0, 0.006, 0);
    this.modelGroup.add(clonedScene);
    this.root.add(this.modelGroup);
    this.root.add(this.weaponMount);

    this.mesh = skinnedMesh;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    const origMat = (Array.isArray(skinnedMesh.material) ? skinnedMesh.material[0] : skinnedMesh.material) as THREE.MeshStandardMaterial;
    this.mat = origMat.clone();
    this.mat.roughness = 0.84;
    this.mat.metalness = 0.06;
    this.mat.envMapIntensity = 1.05;
    skinnedMesh.material = this.mat;

    // Raw Cube_Material_0 vertex coords span Y=[0..11.495], so 1 raw unit ≈ 0.163m world -> 0.145 ≈ 2.4cm outline
    this.outlineMat = new THREE.MeshBasicMaterial({
      color: '#ff3b3b',
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: true,
    });
    this.outlineMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed += normalize(objectNormal) * 0.145;',
      );
    };
    this.outlineMesh = new THREE.SkinnedMesh(this.mesh.geometry, this.outlineMat);
    this.outlineMesh.name = 'PS1CharOutline';
    this.outlineMesh.frustumCulled = false;
    this.outlineMesh.visible = false;
    this.mesh.parent?.add(this.outlineMesh);
    this.outlineMesh.bind(this.mesh.skeleton, this.mesh.bindMatrix);

    this.chamsMat = new THREE.MeshBasicMaterial({
      color: '#4ade80',
      transparent: true,
      opacity: 0.38,
      depthTest: false,
      depthWrite: false,
    });
    this.chamsMesh = new THREE.SkinnedMesh(this.mesh.geometry, this.chamsMat);
    this.chamsMesh.name = 'PS1CharChams';
    this.chamsMesh.frustumCulled = false;
    this.chamsMesh.renderOrder = 900;
    this.chamsMesh.visible = false;
    this.mesh.parent?.add(this.chamsMesh);
    this.chamsMesh.bind(this.mesh.skeleton, this.mesh.bindMatrix);

    this.bones = collectCharacterBones(this.modelGroup);
    for (const b of this.bones.all) {
      this.restPositions.set(b, b.position.clone());
      this.restQuats.set(b, b.quaternion.clone());
      this.restScales.set(b, b.scale.clone());
    }

    this.mixer = new THREE.AnimationMixer(this.modelGroup);
    const findClip = (n: string) => clips.find((c) => c.name === n || c.name.endsWith(`|${n}`)) ?? null;
    const idleClip = findClip('Idle');
    const walkClip = findClip('Walk');
    this.idleAction = idleClip ? this.mixer.clipAction(idleClip) : null;
    this.walkAction = walkClip ? this.mixer.clipAction(walkClip) : null;

    if (this.idleAction) {
      this.idleAction.play();
      this.mixer.update(0);
      this.activeClip = 'idle';
    }
    this.root.updateMatrixWorld(true);
    for (const b of this.bones.all) {
      this.idleQuats.set(b, b.quaternion.clone());
      this.ragdollBaseLocal.set(b, b.matrix.clone());
    }

    // Default chest-level weapon hold transform inside root space
    this.weaponMount.position.set(-0.14, 1.24, 0.34);
  }

  public triggerFireRecoil(strength = 1.0): void {
    this.fireRecoil = Math.min(0.32, this.fireRecoil + 0.18 * strength);
  }

  public triggerHitFlinch(strength = 1.0): void {
    this.hitFlinch = Math.min(0.42, this.hitFlinch + 0.28 * strength);
    this.hitDir = -this.hitDir;
  }

  public reset(): void {
    this.fireRecoil = 0;
    this.hitFlinch = 0;
    this.elimProgress = 0;
    this.crouchLerp = 0;
    this.hitFlashing = false;
    this.modelGroup.position.set(0, 0.006, 0);
    this.modelGroup.rotation.set(0, 0, 0);
    this.modelGroup.scale.setScalar(PS1_CHARACTER_SCALE);
    if (this.bones.head) this.bones.head.scale.setScalar(1);
    if (this.idleAction) {
      this.walkAction?.stop();
      this.idleAction.reset().setEffectiveWeight(1).play();
      this.activeClip = 'idle';
      this.mixer.update(0);
    }
  }

  public setAppearance(tintHex: string, emissiveHex: string, emissiveIntensity: number): void {
    const tint = new THREE.Color(tintHex);
    // Soft blend preserves the PS1 pixel/camo surface shading while distinguishing teams & tiers
    this.baseColor.set('#ffffff').lerp(tint, 0.36);
    this.baseEmissive.set(emissiveHex);
    this.baseEmissiveInt = emissiveIntensity;
    if (!this.hitFlashing) {
      this.mat.color.copy(this.baseColor);
      this.mat.emissive.copy(this.baseEmissive);
      this.mat.emissiveIntensity = this.baseEmissiveInt;
    }
  }

  public setHitFlash(active: boolean): void {
    if (this.hitFlashing === active) return;
    this.hitFlashing = active;
    if (active) {
      this.mat.color.set('#ffffff');
      this.mat.emissive.set('#ffffff');
      this.mat.emissiveIntensity = 0.78;
    } else {
      this.mat.color.copy(this.baseColor);
      this.mat.emissive.copy(this.baseEmissive);
      this.mat.emissiveIntensity = this.baseEmissiveInt;
    }
  }

  public setCheatVisuals(
    chams: boolean,
    chamsColor: string,
    outline: boolean,
    outlineColor: string,
    hideHeadForBalloon: boolean,
  ): void {
    this.chamsMesh.visible = chams;
    this.chamsMat.color.set(chamsColor);

    this.outlineMesh.visible = outline || chams;
    this.outlineMat.color.set(outlineColor);
    const wantDepth = !chams;
    if (this.outlineMat.depthTest !== wantDepth) {
      this.outlineMat.depthTest = wantDepth;
      this.outlineMat.depthWrite = wantDepth;
      this.outlineMat.needsUpdate = true;
    }
    if (this.bones.head) {
      this.bones.head.scale.setScalar(hideHeadForBalloon ? 0.001 : 1);
    }
  }

  private switchClip(target: 'idle' | 'walk', timeScale = 1): void {
    const nextAct = target === 'walk' ? this.walkAction : this.idleAction;
    const prevAct = this.activeClip === 'walk' ? this.walkAction : this.idleAction;
    if (!nextAct) return;
    nextAct.timeScale = timeScale;
    if (this.activeClip === target) return;
    nextAct.enabled = true;
    nextAct.setEffectiveWeight(1);
    nextAct.reset().play();
    if (prevAct && prevAct !== nextAct) {
      prevAct.crossFadeTo(nextAct, 0.14, true);
    }
    this.activeClip = target;
  }

  /** Applies a world-space delta rotation cleanly onto a bone whose parent may have arbitrary Rigify basis. */
  private applyWorldDeltaRotation(bone: THREE.Object3D, deltaWorldQ: THREE.Quaternion): void {
    bone.getWorldQuaternion(this.tmpQ1);
    if (bone.parent) {
      bone.parent.getWorldQuaternion(this.tmpQ2);
      this.tmpQ2.invert();
    } else {
      this.tmpQ2.identity();
    }
    bone.quaternion.copy(this.tmpQ2).multiply(deltaWorldQ).multiply(this.tmpQ1).normalize();
  }

  /** Analytical 2-bone triangle IK overriding arm chains in root space so hands grip the rifle cleanly. */
  private solveArmIK(
    upper: THREE.Object3D | null,
    upperTwist: THREE.Object3D | null,
    forearm: THREE.Object3D | null,
    foreTwist: THREE.Object3D | null,
    hand: THREE.Object3D | null,
    targetWorld: THREE.Vector3,
    poleDirWorld: THREE.Vector3,
  ): void {
    if (!upper || !forearm || !hand) return;

    // Reset Rigify walk clip stretch/translation/twist on the arm chain so IK rotates rigid segments cleanly
    for (const b of [upper, upperTwist, forearm, foreTwist, hand]) {
      if (!b) continue;
      const rp = this.restPositions.get(b);
      const rs = this.restScales.get(b);
      if (rp) b.position.copy(rp);
      if (rs) b.scale.copy(rs);
    }
    if (upperTwist) {
      const rq = this.restQuats.get(upperTwist);
      if (rq) upperTwist.quaternion.copy(rq);
    }
    if (foreTwist) {
      const rq = this.restQuats.get(foreTwist);
      if (rq) foreTwist.quaternion.copy(rq);
    }
    this.root.updateMatrixWorld(true);

    const S = upper.getWorldPosition(this.tmpV1);
    const E = forearm.getWorldPosition(this.tmpV2);
    const H = hand.getWorldPosition(this.tmpV3);

    const l1 = S.distanceTo(E);
    const l2 = E.distanceTo(H);
    if (l1 < 1e-4 || l2 < 1e-4) return;

    const toT = this.tmpV4.subVectors(targetWorld, S);
    const dist = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 0.02, l1 + l2 - 0.015);
    const dir = toT.normalize();

    const cosA = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));

    // Orthogonalize elbow pole hint against shoulder->target axis
    const bendDir = poleDirWorld.clone().addScaledVector(dir, -poleDirWorld.dot(dir));
    if (bendDir.lengthSq() < 1e-5) bendDir.set(0, -1, 0);
    else bendDir.normalize();

    const eDes = S.clone()
      .addScaledVector(dir, l1 * cosA)
      .addScaledVector(bendDir, l1 * sinA);

    // Step 1: Rotate upperArm so current elbow direction -> desired elbow direction
    const curUpperDir = E.clone().sub(S).normalize();
    const desUpperDir = eDes.sub(S).normalize();
    this.tmpQ3.setFromUnitVectors(curUpperDir, desUpperDir);
    this.applyWorldDeltaRotation(upper, this.tmpQ3);
    upper.updateMatrixWorld(true);

    // Step 2: Rotate forearm so updated hand reaches targetWorld cleanly
    const eNew = forearm.getWorldPosition(this.tmpV2);
    const hNew = hand.getWorldPosition(this.tmpV3);
    const curForeDir = hNew.sub(eNew);
    const desForeDir = this.tmpV4.subVectors(targetWorld, eNew);
    if (curForeDir.lengthSq() > 1e-6 && desForeDir.lengthSq() > 1e-6) {
      curForeDir.normalize();
      desForeDir.normalize();
      this.tmpQ3.setFromUnitVectors(curForeDir, desForeDir);
      this.applyWorldDeltaRotation(forearm, this.tmpQ3);
      forearm.updateMatrixWorld(true);
    }
  }

  public update(input: CharacterExternalMotion): void {
    const dt = THREE.MathUtils.clamp(input.dt, 0.0005, 0.08);
    this.fireRecoil *= Math.exp(-16 * dt);
    this.hitFlinch *= Math.exp(-10 * dt);

    if (!input.alive) {
      this.elimProgress = Math.min(1, this.elimProgress + dt / 0.68);
      const ease = 1 - Math.pow(1 - this.elimProgress, 2.2);
      if (this.activeClip !== 'none') {
        this.walkAction?.stop();
        this.idleAction?.stop();
        this.activeClip = 'none';
      }
      for (const [b, iq] of this.idleQuats.entries()) {
        b.quaternion.copy(iq);
      }
      this.modelGroup.rotation.set(ease * 1.46, 0, ease * 0.18);
      this.modelGroup.position.set(0, 0.14 * ease, 0);
      this.root.updateMatrixWorld(true);
      return;
    }

    this.elimProgress = 0;
    this.crouchLerp = THREE.MathUtils.lerp(this.crouchLerp, input.crouching ? 1 : 0, Math.min(1, dt * 16));
    this.modelGroup.rotation.set(0, 0, 0);
    this.modelGroup.position.set(0, 0.006 - this.crouchLerp * 0.26, 0);

    const moving = input.state === 'walk' || input.state === 'run' || input.state === 'backpedal' ||
      input.state === 'strafe_left' || input.state === 'strafe_right';
    if (moving) {
      const sign = input.state === 'backpedal' ? -1 : 1;
      const rate = THREE.MathUtils.clamp(Math.max(input.horizSpeed, 2.2) / 3.2, 0.72, 1.95);
      this.switchClip('walk', sign * rate);
    } else {
      this.switchClip('idle', 1.0);
    }

    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);

    // Subtle procedural upper-body aim pitch & combat flinch in root space (root X = lateral, Y = up, Z = forward)
    this.root.getWorldQuaternion(this.tmpQ4);
    const rightAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.tmpQ4);
    const fwdAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(this.tmpQ4);

    if (this.bones.chest) {
      const chestPitch = THREE.MathUtils.clamp(input.pitch * 0.35 - this.hitFlinch * 0.42 + this.fireRecoil * 0.32, -0.5, 0.5);
      const chestRoll = this.hitFlinch * this.hitDir * 0.32;
      this.tmpQ3.setFromAxisAngle(rightAxis, chestPitch);
      const qRoll = new THREE.Quaternion().setFromAxisAngle(fwdAxis, chestRoll);
      this.tmpQ3.multiply(qRoll);
      this.applyWorldDeltaRotation(this.bones.chest, this.tmpQ3);
    }
    if (this.bones.head) {
      const headPitch = THREE.MathUtils.clamp(input.pitch * 0.45 - this.hitFlinch * 0.55, -0.65, 0.65);
      this.tmpQ3.setFromAxisAngle(rightAxis, headPitch);
      this.applyWorldDeltaRotation(this.bones.head, this.tmpQ3);
    }
    this.root.updateMatrixWorld(true);

    // Track chest position & aim pitch cleanly for rifle placement, then lock BOTH hands onto rifle with 2-bone IK
    let chestAnchorY = 1.24 - this.crouchLerp * 0.26;
    let chestAnchorZ = 0.20;
    if (this.bones.chest) {
      const cw = this.bones.chest.getWorldPosition(this.tmpV1);
      this.root.worldToLocal(cw);
      chestAnchorY = cw.y - 0.12;
      chestAnchorZ = cw.z + 0.22;
    }
    this.weaponMount.position.set(-0.10, chestAnchorY, chestAnchorZ);
    this.weaponMount.rotation.set(
      THREE.MathUtils.clamp(-input.pitch * 0.65, -0.55, 0.55) - this.fireRecoil * 0.55,
      0.04,
      0,
    );
    this.root.updateMatrixWorld(true);

    if (input.holdWeapon !== false) {
      const rGripWorld = new THREE.Vector3(0.0, -0.04, -0.07).applyMatrix4(this.weaponMount.matrixWorld);
      const lHandguardWorld = new THREE.Vector3(0.02, -0.02, 0.14).applyMatrix4(this.weaponMount.matrixWorld);

      const poleR = new THREE.Vector3(-0.62, -0.62, -0.48).normalize().applyQuaternion(this.tmpQ4);
      const poleL = new THREE.Vector3(0.62, -0.68, -0.38).normalize().applyQuaternion(this.tmpQ4);

      this.solveArmIK(
        this.bones.upperArmR,
        this.bones.upperArmR2,
        this.bones.forearmR,
        this.bones.forearmR2,
        this.bones.handR,
        rGripWorld,
        poleR,
      );
      this.solveArmIK(
        this.bones.upperArmL,
        this.bones.upperArmL2,
        this.bones.forearmL,
        this.bones.forearmL2,
        this.bones.handL,
        lHandguardWorld,
        poleL,
      );
      this.root.updateMatrixWorld(true);
    }
  }

  /** Drives the PS1 skeleton from RagdollCorpse's physics spring body while maintaining natural joint bends. */
  public applyRagdollPose(p: RagdollBonePoseInput): void {
    // Restore standing Idle pose cleanly first, then overlay physics joint rotations in character-local space
    for (const [b, iq] of this.idleQuats.entries()) {
      b.quaternion.copy(iq);
    }
    this.modelGroup.rotation.set(0, 0, 0);
    this.modelGroup.position.set(0, 0.006, 0);
    this.root.updateMatrixWorld(true);

    this.root.getWorldQuaternion(this.tmpQ4);
    const rx = new THREE.Vector3(1, 0, 0).applyQuaternion(this.tmpQ4);
    const rz = new THREE.Vector3(0, 0, 1).applyQuaternion(this.tmpQ4);

    const rotWorld = (bone: THREE.Object3D | null, pitchX: number, rollZ: number) => {
      if (!bone) return;
      this.tmpQ3.setFromAxisAngle(rx, pitchX);
      if (Math.abs(rollZ) > 1e-4) {
        const qr = new THREE.Quaternion().setFromAxisAngle(rz, rollZ);
        this.tmpQ3.multiply(qr);
      }
      this.applyWorldDeltaRotation(bone, this.tmpQ3);
      bone.updateMatrixWorld(true);
    };

    rotWorld(this.bones.chest, p.spineX * 0.65, p.spineZ * 0.65);
    rotWorld(this.bones.head, p.headX, p.headZ);

    rotWorld(this.bones.thighL, -p.hipLX, p.hipLZ);
    rotWorld(this.bones.shinL, p.kneeLX, 0);
    rotWorld(this.bones.thighR, -p.hipRX, p.hipRZ);
    rotWorld(this.bones.shinR, p.kneeRX, 0);

    rotWorld(this.bones.upperArmL, p.armLX, p.armLZ);
    rotWorld(this.bones.forearmL, p.elbowLX, 0);
    rotWorld(this.bones.upperArmR, p.armRX, p.armRZ);
    rotWorld(this.bones.forearmR, p.elbowRX, 0);
  }

  public dispose(): void {
    this.mixer.stopAllAction();
    this.outlineMesh.removeFromParent();
    this.chamsMesh.removeFromParent();
    this.root.removeFromParent();
    this.mat.dispose();
    this.outlineMat.dispose();
    this.chamsMat.dispose();
  }
}

export function createExternalCharacterFromAsset(asset: CachedCharacterAsset): ExternalCharacterRig | null {
  const cloned = cloneSkeleton(asset.scene);
  let skinned: THREE.SkinnedMesh | null = null;
  cloned.traverse((obj) => {
    const sk = obj as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh && !skinned) {
      skinned = sk;
    }
  });
  if (!skinned) return null;
  return new ExternalCharacterRig(cloned, asset.animations, skinned);
}
