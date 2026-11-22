import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  LeftHandPoseId,
  RightHandPoseId,
  WeaponAnimContext,
  WeaponAnimOutput,
} from './weaponAnimator';
import { WeaponRig } from './weaponModels';

export const FPS_ARMS_GLB_URL = '/models/fps_arms.glb';

export type FingerCurlTuple = [number, number, number]; // [MCP/CMC pitch, PIP/MCP pitch, DIP/IP pitch]

export interface FingerSpec {
  curl: FingerCurlTuple;
  yaw?: number;
  roll?: number;
}

export interface HandPoseSpec {
  /** Desired finger-forward direction (-Z_hand) in weaponPivot space. */
  fwdDir: [number, number, number];
  /** Desired dorsal-knuckle normal (+Y_hand) in weaponPivot space (palm faces -dorsalDir). */
  dorsalDir: [number, number, number];
  thumb: FingerSpec;
  index: FingerSpec;
  middle: FingerSpec;
  ring: FingerSpec;
  pinky: FingerSpec;
}

export interface WeaponHandCalibration {
  rightAnchorOffset: [number, number, number]; // in weaponPivot space added to anchors.rightHandGrip
  rightContactLocal: [number, number, number]; // in canonical R_Hand space placed onto anchor
  rightGripCurlScale: number;
  rightIndexCurlDelta: [number, number, number];
  leftAnchorOffset: [number, number, number]; // in weaponPivot space added to anchors.leftHandRest
  leftContactLocal: [number, number, number]; // in canonical L_Hand space placed onto anchor
  leftCurlScale: number;
}

const DEFAULT_CAL: WeaponHandCalibration = {
  // Contact at thumb-index web of right palm so palm hugs right backstrap & Index tip sits dead-center on trigger
  rightAnchorOffset: [0.027, 0.028, 0.004],
  rightContactLocal: [-0.024, -0.022, -0.098],
  rightGripCurlScale: 1.0,
  rightIndexCurlDelta: [0, 0, 0],
  leftAnchorOffset: [-0.010, -0.002, 0.006],
  leftContactLocal: [0.010, -0.022, -0.070],
  leftCurlScale: 1.0,
};

/**
 * Per-weapon hand & finger calibration matched to each GLB weapon's exact grip, trigger, handguard, or ring.
 * Anchors place the palm hollow onto backstrap/forend while aligning dorsal/forward hand axes cleanly.
 */
export const WEAPON_HAND_CALIBRATION: Record<string, WeaponHandCalibration> = {
  pistol: {
    ...DEFAULT_CAL,
    rightAnchorOffset: [0.026, 0.026, 0.002],
    rightContactLocal: [-0.024, -0.022, -0.098],
    rightGripCurlScale: 0.96,
    rightIndexCurlDelta: [0.04, 0.02, 0.0],
    leftAnchorOffset: [-0.012, 0.004, 0.022],
    leftContactLocal: [0.014, -0.020, -0.076],
    leftCurlScale: 0.98,
  },
  smg: {
    ...DEFAULT_CAL,
    rightAnchorOffset: [0.027, 0.028, 0.002],
    rightContactLocal: [-0.024, -0.022, -0.098],
    rightGripCurlScale: 1.0,
    leftAnchorOffset: [-0.008, 0.010, 0.008],
    leftContactLocal: [0.010, -0.022, -0.070],
    leftCurlScale: 0.96,
  },
  rifle: {
    ...DEFAULT_CAL,
    rightAnchorOffset: [0.027, 0.030, 0.004],
    rightContactLocal: [-0.024, -0.022, -0.098],
    rightGripCurlScale: 1.02,
    leftAnchorOffset: [-0.010, 0.004, 0.006],
    leftContactLocal: [0.010, -0.022, -0.070],
    leftCurlScale: 1.0,
  },
  m4: {
    ...DEFAULT_CAL,
    rightAnchorOffset: [0.027, 0.032, 0.002],
    rightContactLocal: [-0.024, -0.022, -0.098],
    rightGripCurlScale: 0.98,
    leftAnchorOffset: [-0.008, 0.010, 0.006],
    leftContactLocal: [0.010, -0.022, -0.070],
    leftCurlScale: 0.94,
  },
  shotgun: {
    ...DEFAULT_CAL,
    rightAnchorOffset: [0.027, 0.028, -0.002],
    rightContactLocal: [-0.024, -0.022, -0.096],
    rightGripCurlScale: 1.0,
    leftAnchorOffset: [-0.010, 0.000, 0.008],
    leftContactLocal: [0.010, -0.022, -0.070],
    leftCurlScale: 0.98,
  },
  ssg: {
    ...DEFAULT_CAL,
    rightAnchorOffset: [0.026, 0.030, 0.002],
    rightContactLocal: [-0.024, -0.022, -0.098],
    rightGripCurlScale: 1.04,
    leftAnchorOffset: [-0.010, -0.002, 0.006],
    leftContactLocal: [0.010, -0.022, -0.070],
    leftCurlScale: 0.94,
  },
  sniper: {
    ...DEFAULT_CAL,
    rightAnchorOffset: [0.027, 0.026, -0.004],
    rightContactLocal: [-0.024, -0.022, -0.096],
    rightGripCurlScale: 1.04,
    leftAnchorOffset: [-0.010, -0.002, 0.004],
    leftContactLocal: [0.010, -0.022, -0.070],
    leftCurlScale: 0.92,
  },
  knife: {
    ...DEFAULT_CAL,
    // Keep R_Index2 anchored centered on Karambit finger ring (0, 0, 0) while aligning handle along +X_hand
    rightAnchorOffset: [0.002, 0.002, -0.030],
    rightContactLocal: [-0.039, -0.014, -0.126],
    rightGripCurlScale: 1.0,
    leftAnchorOffset: [0, 0, 0],
    leftContactLocal: [0.014, -0.020, -0.068],
  },
};

export const RIGHT_POSES: Record<RightHandPoseId, HandPoseSpec> = {
  grip: {
    // Fingers extend forward along receiver (-Z) with knuckles RIGHT (+X); palm hugs right/back tang
    fwdDir: [-0.06, 0.04, -0.997],
    dorsalDir: [0.92, 0.34, -0.06],
    // Right thumb wraps high (+yaw -> UP) and across left tang (-curl -> inward)
    thumb: { curl: [-0.24, -0.32, -0.22], yaw: 0.16, roll: 0.14 },
    index: { curl: [0.22, -0.08, -0.34], yaw: -0.02 },
    middle: { curl: [-0.46, -0.64, -0.40], yaw: 0.02 },
    ring: { curl: [-0.50, -0.66, -0.42], yaw: 0.0 },
    pinky: { curl: [-0.54, -0.68, -0.44], yaw: -0.02 },
  },
  bolt_cycle: {
    fwdDir: [-0.36, 0.14, -0.92],
    dorsalDir: [0.58, 0.78, -0.12],
    thumb: { curl: [-0.24, -0.42, -0.30], yaw: 0.10, roll: 0.24 },
    index: { curl: [-0.34, -0.58, -0.44], yaw: 0.08 },
    middle: { curl: [-0.38, -0.56, -0.40], yaw: 0.02 },
    ring: { curl: [-0.46, -0.62, -0.42], yaw: -0.02 },
    pinky: { curl: [-0.48, -0.62, -0.42], yaw: -0.05 },
  },
  karambit_hold: {
    // +X_hand = dorsal x (-fwd) aligns right along the curved Karambit handle (0, -0.82, -0.57)
    fwdDir: [-0.16, 0.48, -0.86],
    dorsalDir: [0.92, 0.34, -0.18],
    thumb: { curl: [-0.22, -0.32, -0.22], yaw: 0.14, roll: 0.14 },
    index: { curl: [-0.24, -0.62, -0.46], yaw: 0.02 },
    middle: { curl: [-0.44, -0.62, -0.44], yaw: 0.0 },
    ring: { curl: [-0.48, -0.64, -0.46], yaw: -0.02 },
    pinky: { curl: [-0.52, -0.66, -0.46], yaw: -0.04 },
  },
  karambit_spin: {
    fwdDir: [-0.16, 0.50, -0.85],
    dorsalDir: [0.90, 0.36, -0.18],
    thumb: { curl: [0.18, 0.12, 0.06], yaw: 0.34, roll: -0.12 },
    index: { curl: [-0.22, -0.58, -0.42], yaw: 0.02 },
    middle: { curl: [0.36, 0.26, 0.16], yaw: 0.0 },
    ring: { curl: [0.40, 0.28, 0.18], yaw: -0.04 },
    pinky: { curl: [0.44, 0.30, 0.20], yaw: -0.08 },
  },
};

export const LEFT_POSES: Record<LeftHandPoseId, HandPoseSpec> = {
  // Under-barrel foregrip cradle: palm faces UP-RIGHT cradling bottom-left; fingers wrap horizontally beneath rail
  foregrip: {
    fwdDir: [0.72, 0.08, -0.69],
    dorsalDir: [-0.36, -0.92, -0.14],
    thumb: { curl: [0.06, -0.14, -0.10], yaw: 0.22, roll: 0.18 },
    index: { curl: [-0.30, -0.44, -0.32], yaw: 0.04 },
    middle: { curl: [-0.34, -0.48, -0.36], yaw: 0.0 },
    ring: { curl: [-0.36, -0.50, -0.38], yaw: -0.02 },
    pinky: { curl: [-0.38, -0.52, -0.38], yaw: -0.04 },
  },
  // Two-handed thumbs-forward pistol support grip on left side of grip
  pistol_support: {
    fwdDir: [0.28, -0.08, -0.95],
    dorsalDir: [-0.90, -0.36, -0.22],
    thumb: { curl: [0.14, 0.04, 0.0], yaw: 0.08, roll: 0.16 },
    index: { curl: [-0.36, -0.52, -0.36], yaw: 0.04 },
    middle: { curl: [-0.42, -0.58, -0.40], yaw: 0.0 },
    ring: { curl: [-0.46, -0.60, -0.42], yaw: -0.02 },
    pinky: { curl: [-0.48, -0.62, -0.42], yaw: -0.04 },
  },
  // Gripping detachable magazine during reload
  mag_grab: {
    fwdDir: [0.42, 0.14, -0.89],
    dorsalDir: [-0.90, -0.18, -0.38],
    thumb: { curl: [-0.14, -0.32, -0.22], yaw: -0.48, roll: 0.36 },
    index: { curl: [-0.34, -0.48, -0.34], yaw: 0.02 },
    middle: { curl: [-0.38, -0.52, -0.36], yaw: 0.0 },
    ring: { curl: [-0.40, -0.54, -0.38], yaw: -0.02 },
    pinky: { curl: [-0.42, -0.56, -0.38], yaw: -0.04 },
  },
  // Thumb + Index/Middle pinch on charging handle or slide
  bolt_pinch: {
    fwdDir: [0.48, -0.18, -0.86],
    dorsalDir: [-0.45, 0.85, -0.26],
    thumb: { curl: [-0.22, -0.38, -0.26], yaw: -0.44, roll: 0.38 },
    index: { curl: [-0.40, -0.60, -0.46], yaw: 0.06 },
    middle: { curl: [-0.44, -0.58, -0.42], yaw: 0.02 },
    ring: { curl: [-0.50, -0.64, -0.44], yaw: -0.02 },
    pinky: { curl: [-0.52, -0.66, -0.44], yaw: -0.04 },
  },
  // Feeding shotgun shells under receiver port
  shell_load: {
    fwdDir: [0.48, 0.42, -0.77],
    dorsalDir: [-0.62, -0.78, -0.06],
    thumb: { curl: [-0.10, -0.24, -0.18], yaw: -0.40, roll: 0.34 },
    index: { curl: [-0.28, -0.42, -0.30], yaw: 0.02 },
    middle: { curl: [-0.44, -0.58, -0.40], yaw: 0.0 },
    ring: { curl: [-0.48, -0.62, -0.42], yaw: -0.02 },
    pinky: { curl: [-0.50, -0.64, -0.44], yaw: -0.04 },
  },
  // Off-hand guard during melee swing
  guard: {
    fwdDir: [0.32, 0.08, -0.94],
    dorsalDir: [-0.72, 0.65, -0.24],
    thumb: { curl: [-0.04, -0.16, -0.12], yaw: -0.24, roll: 0.22 },
    index: { curl: [0.06, -0.12, -0.12], yaw: 0.04 },
    middle: { curl: [0.0, -0.16, -0.14], yaw: 0.0 },
    ring: { curl: [-0.06, -0.20, -0.16], yaw: -0.02 },
    pinky: { curl: [-0.10, -0.22, -0.18], yaw: -0.04 },
  },
};

export interface ArmBoneMap {
  root: THREE.Object3D;
  forearm: THREE.Object3D;
  upperArm: THREE.Object3D;
  hand: THREE.Object3D;
  thumb: [THREE.Object3D, THREE.Object3D, THREE.Object3D];
  index: [THREE.Object3D, THREE.Object3D, THREE.Object3D];
  middle: [THREE.Object3D, THREE.Object3D, THREE.Object3D];
  ring: [THREE.Object3D, THREE.Object3D, THREE.Object3D];
  pinky: [THREE.Object3D, THREE.Object3D, THREE.Object3D];
  allJoints: THREE.Object3D[];
}

function collectArmBones(scope: THREE.Object3D, prefix: 'L' | 'R'): ArmBoneMap | null {
  const get = (suffix: string): THREE.Object3D | undefined =>
    scope.getObjectByName(`${prefix}_${suffix}`);
  const names = [
    'Root', 'Forearm', 'UpperArm', 'Hand',
    'Thumb1', 'Thumb2', 'Thumb3',
    'Index1', 'Index2', 'Index3',
    'Middle1', 'Middle2', 'Middle3',
    'Ring1', 'Ring2', 'Ring3',
    'Pinky1', 'Pinky2', 'Pinky3',
  ];
  const allJoints: THREE.Object3D[] = [];
  for (const n of names) {
    const b = get(n);
    if (!b) return null;
    allJoints.push(b);
  }
  return {
    root: allJoints[0],
    forearm: allJoints[1],
    upperArm: allJoints[2],
    hand: allJoints[3],
    thumb: [allJoints[4], allJoints[5], allJoints[6]],
    index: [allJoints[7], allJoints[8], allJoints[9]],
    middle: [allJoints[10], allJoints[11], allJoints[12]],
    ring: [allJoints[13], allJoints[14], allJoints[15]],
    pinky: [allJoints[16], allJoints[17], allJoints[18]],
    allJoints,
  };
}

function expDamp(cur: number, target: number, lambda: number, dt: number): number {
  if (dt <= 0) return target;
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}

function lerpVec3Tuple(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [
    THREE.MathUtils.lerp(a[0], b[0], t),
    THREE.MathUtils.lerp(a[1], b[1], t),
    THREE.MathUtils.lerp(a[2], b[2], t),
  ];
}

function lerpPose(a: HandPoseSpec, b: HandPoseSpec, t: number): HandPoseSpec {
  const l = THREE.MathUtils.lerp;
  const lerpFinger = (fa: FingerSpec, fb: FingerSpec): FingerSpec => ({
    curl: lerpVec3Tuple(fa.curl, fb.curl, t),
    yaw: l(fa.yaw ?? 0, fb.yaw ?? 0, t),
    roll: l(fa.roll ?? 0, fb.roll ?? 0, t),
  });
  return {
    fwdDir: lerpVec3Tuple(a.fwdDir, b.fwdDir, t),
    dorsalDir: lerpVec3Tuple(a.dorsalDir, b.dorsalDir, t),
    thumb: lerpFinger(a.thumb, b.thumb),
    index: lerpFinger(a.index, b.index),
    middle: lerpFinger(a.middle, b.middle),
    ring: lerpFinger(a.ring, b.ring),
    pinky: lerpFinger(a.pinky, b.pinky),
  };
}

export class FpsArmRig {
  public readonly leftRoot: THREE.Object3D;
  public readonly rightRoot: THREE.Object3D;
  public readonly leftMesh: THREE.SkinnedMesh;
  public readonly rightMesh: THREE.SkinnedMesh;
  public readonly leftBones: ArmBoneMap;
  public readonly rightBones: ArmBoneMap;
  private clonedMats: THREE.Material[];
  private initialized = false;

  // Scratch math objects to avoid per-frame allocations
  private tmpTarget = new THREE.Vector3();
  private tmpContact = new THREE.Vector3();
  private tmpShoulder = new THREE.Vector3();
  private tmpWrist = new THREE.Vector3();
  private tmpZ = new THREE.Vector3();
  private tmpX = new THREE.Vector3();
  private tmpY = new THREE.Vector3();
  private tmpHandFwd = new THREE.Vector3();
  private tmpHandUp = new THREE.Vector3();
  private tmpHandRight = new THREE.Vector3();
  private tmpMat4 = new THREE.Matrix4();
  private tmpHandQuat = new THREE.Quaternion();
  private tmpForearmQuat = new THREE.Quaternion();
  private tmpHandRelQuat = new THREE.Quaternion();
  private tmpPivotQuat = new THREE.Quaternion();

  constructor(
    leftRoot: THREE.Object3D,
    rightRoot: THREE.Object3D,
    leftMesh: THREE.SkinnedMesh,
    rightMesh: THREE.SkinnedMesh,
    leftBones: ArmBoneMap,
    rightBones: ArmBoneMap,
    clonedMats: THREE.Material[],
  ) {
    this.leftRoot = leftRoot;
    this.rightRoot = rightRoot;
    this.leftMesh = leftMesh;
    this.rightMesh = rightMesh;
    this.leftBones = leftBones;
    this.rightBones = rightBones;
    this.clonedMats = clonedMats;
  }

  /**
   * Computes exact hand orientation in weaponPivot space (so fingers/palms never drift with shoulder angle),
   * places the contact point onto the weapon anchor, and rolls the forearm seamlessly to match the wrist
   * so there is zero wrist twisting!
   */
  private alignHandAndArm(
    armRoot: THREE.Object3D,
    bones: ArmBoneMap,
    targetPivotLocal: THREE.Vector3,
    contactLocal: readonly [number, number, number],
    shoulderPos: THREE.Vector3,
    rig: WeaponRig,
    pose: HandPoseSpec,
    lambda: number,
    dt: number,
    instant: boolean,
  ): void {
    this.tmpPivotQuat.setFromEuler(rig.weaponPivot.rotation);

    // Build orthonormal hand basis in weaponPivot space -> ViewModel root space
    // Canonical hand axes: -Z = fwdDir, +Y = dorsalDir, +X = Y x Z
    this.tmpHandFwd.set(pose.fwdDir[0], pose.fwdDir[1], pose.fwdDir[2]).normalize();
    this.tmpHandUp.set(pose.dorsalDir[0], pose.dorsalDir[1], pose.dorsalDir[2]).normalize();
    this.tmpZ.copy(this.tmpHandFwd).negate();
    this.tmpHandRight.crossVectors(this.tmpHandUp, this.tmpZ);
    if (this.tmpHandRight.lengthSq() < 1e-6) this.tmpHandRight.set(1, 0, 0);
    else this.tmpHandRight.normalize();
    this.tmpHandUp.crossVectors(this.tmpZ, this.tmpHandRight).normalize();

    this.tmpMat4.makeBasis(this.tmpHandRight, this.tmpHandUp, this.tmpZ);
    this.tmpHandQuat.setFromRotationMatrix(this.tmpMat4);
    this.tmpHandQuat.premultiply(this.tmpPivotQuat);

    // Anchor target world pos -> subtract rotated palm contact offset -> exact wrist position!
    this.tmpTarget.copy(targetPivotLocal).applyQuaternion(this.tmpPivotQuat).add(rig.weaponPivot.position);
    this.tmpContact.set(contactLocal[0], contactLocal[1], contactLocal[2]).applyQuaternion(this.tmpHandQuat);
    this.tmpWrist.copy(this.tmpTarget).sub(this.tmpContact);

    // Align forearm (+Z toward shoulder), projecting hand +Y dorsal onto plane perp to forearm Z for twist-free wrist!
    this.tmpZ.copy(shoulderPos).sub(this.tmpWrist);
    if (this.tmpZ.lengthSq() < 1e-6) this.tmpZ.set(0, 0, 1);
    else this.tmpZ.normalize();

    // Rotate hand up vector into ViewModel space and orthogonalize against forearm +Z
    this.tmpHandUp.set(0, 1, 0).applyQuaternion(this.tmpHandQuat);
    this.tmpY.copy(this.tmpHandUp).addScaledVector(this.tmpZ, -this.tmpHandUp.dot(this.tmpZ));
    if (this.tmpY.lengthSq() < 1e-4) this.tmpY.set(0, 1, 0);
    else this.tmpY.normalize();

    this.tmpX.crossVectors(this.tmpY, this.tmpZ).normalize();
    this.tmpY.crossVectors(this.tmpZ, this.tmpX).normalize();

    this.tmpMat4.makeBasis(this.tmpX, this.tmpY, this.tmpZ);
    this.tmpForearmQuat.setFromRotationMatrix(this.tmpMat4);

    // Local Hand rotation = inverse(qForearm) * targetHandQuat (always small natural wrist angle!)
    this.tmpHandRelQuat.copy(this.tmpForearmQuat).invert().multiply(this.tmpHandQuat);

    armRoot.position.copy(this.tmpWrist);
    armRoot.quaternion.copy(this.tmpForearmQuat);
    if (instant || !this.initialized) {
      bones.hand.quaternion.copy(this.tmpHandRelQuat);
    } else {
      const alpha = 1 - Math.exp(-lambda * dt);
      bones.hand.quaternion.slerp(this.tmpHandRelQuat, alpha);
    }

    // Subtle natural upper-arm drop toward shoulder so the sleeve stays cleanly behind near plane
    bones.upperArm.rotation.set(-0.22, 0, 0);
  }

  private applyFingerPose(
    bones: ArmBoneMap,
    sideSign: 1 | -1,
    pose: HandPoseSpec,
    curlScale: number,
    lambda: number,
    dt: number,
    instant: boolean,
    indexDelta: readonly [number, number, number] = [0, 0, 0],
    gripDelta = 0,
  ): void {
    const dampRot = (obj: THREE.Object3D, rx: number, ry: number, rz: number) => {
      if (instant || !this.initialized) {
        obj.rotation.set(rx, ry, rz);
      } else {
        obj.rotation.set(
          expDamp(obj.rotation.x, rx, lambda, dt),
          expDamp(obj.rotation.y, ry, lambda, dt),
          expDamp(obj.rotation.z, rz, lambda, dt),
        );
      }
    };

    dampRot(
      bones.thumb[0],
      pose.thumb.curl[0] * curlScale,
      sideSign * (pose.thumb.yaw ?? 0),
      sideSign * (pose.thumb.roll ?? 0),
    );
    dampRot(bones.thumb[1], pose.thumb.curl[1] * curlScale, 0, 0);
    dampRot(bones.thumb[2], pose.thumb.curl[2] * curlScale, 0, 0);

    const driveFinger = (
      chain: [THREE.Object3D, THREE.Object3D, THREE.Object3D],
      f: FingerSpec,
      cScale: number,
      d0 = 0,
      d1 = 0,
      d2 = 0,
    ) => {
      dampRot(chain[0], f.curl[0] * cScale + d0, sideSign * (f.yaw ?? 0), sideSign * (f.roll ?? 0));
      dampRot(chain[1], f.curl[1] * cScale + d1, 0, 0);
      dampRot(chain[2], f.curl[2] * cScale + d2, 0, 0);
    };

    driveFinger(bones.index, pose.index, 1.0, indexDelta[0], indexDelta[1], indexDelta[2]);
    driveFinger(bones.middle, pose.middle, curlScale, -gripDelta * 0.14, -gripDelta * 0.18, -gripDelta * 0.12);
    driveFinger(bones.ring, pose.ring, curlScale, -gripDelta * 0.14, -gripDelta * 0.18, -gripDelta * 0.12);
    driveFinger(bones.pinky, pose.pinky, curlScale, -gripDelta * 0.14, -gripDelta * 0.18, -gripDelta * 0.12);
  }

  public update(
    dt: number,
    rig: WeaponRig,
    out: WeaponAnimOutput,
    ctx: WeaponAnimContext,
    instant = false,
  ): void {
    const id = rig.def.id;
    const cal = WEAPON_HAND_CALIBRATION[id] ?? DEFAULT_CAL;
    const isMelee = Boolean(rig.def.isMelee);

    // ---- Right Arm ----
    let rPose: HandPoseSpec;
    if (isMelee) {
      rPose = lerpPose(RIGHT_POSES.karambit_hold, RIGHT_POSES.karambit_spin, out.knifeSpinOpenAlpha);
    } else {
      rPose = RIGHT_POSES.grip;
    }
    if (out.rightHandPose === 'bolt_cycle') {
      rPose = RIGHT_POSES.bolt_cycle;
    }

    const rTarget = out.rightHandTarget.clone();
    if (out.rightHandPose !== 'bolt_cycle') {
      rTarget.x += cal.rightAnchorOffset[0];
      rTarget.y += cal.rightAnchorOffset[1];
      rTarget.z += cal.rightAnchorOffset[2];
    }

    this.tmpShoulder.set(0.11, isMelee ? -0.15 : -0.11, 0.42);
    this.alignHandAndArm(
      this.rightRoot,
      this.rightBones,
      rTarget,
      cal.rightContactLocal,
      this.tmpShoulder,
      rig,
      rPose,
      instant ? 200 : 24,
      dt,
      instant,
    );

    const trig = out.triggerPullAlpha;
    const rightIndexDelta: [number, number, number] =
      isMelee || out.rightHandPose === 'bolt_cycle'
        ? [0, 0, 0]
        : [
            cal.rightIndexCurlDelta[0] - trig * 0.18,
            cal.rightIndexCurlDelta[1] - trig * 0.36,
            cal.rightIndexCurlDelta[2] - trig * 0.40,
          ];

    this.applyFingerPose(
      this.rightBones,
      1,
      rPose,
      isMelee ? 1.0 : cal.rightGripCurlScale,
      instant ? 200 : 24,
      dt,
      instant,
      rightIndexDelta,
      out.gripTightenAlpha,
    );

    // ---- Left Arm ----
    if (out.leftHandWeight > 0.04) {
      this.leftRoot.visible = true;
      const lPose = LEFT_POSES[out.leftHandPose] ?? LEFT_POSES.foregrip;
      const isDefaultLeft =
        out.leftHandPose === 'foregrip' || out.leftHandPose === 'pistol_support';

      const lTarget = out.leftHandTarget.clone();
      lTarget.y -= (1 - out.leftHandWeight) * 0.16;
      if (isDefaultLeft) {
        lTarget.x += cal.leftAnchorOffset[0];
        lTarget.y += cal.leftAnchorOffset[1];
        lTarget.z += cal.leftAnchorOffset[2];
      }

      if (out.leftHandPose === 'pistol_support') {
        this.tmpShoulder.set(-0.20, -0.14 - (1 - out.leftHandWeight) * 0.25, 0.38);
      } else {
        this.tmpShoulder.set(-0.24, -0.18 - (1 - out.leftHandWeight) * 0.25, 0.22);
      }
      this.alignHandAndArm(
        this.leftRoot,
        this.leftBones,
        lTarget,
        cal.leftContactLocal,
        this.tmpShoulder,
        rig,
        lPose,
        instant ? 200 : 22,
        dt,
        instant,
      );

      const reloadFlex = ctx.reloading ? Math.sin(ctx.reloadProgress * Math.PI * 2) * 0.12 : 0;
      const cScale = (isDefaultLeft ? cal.leftCurlScale : 1.0) + reloadFlex * 0.25;
      this.applyFingerPose(
        this.leftBones,
        -1,
        lPose,
        cScale,
        instant ? 200 : 22,
        dt,
        instant,
        [0, 0, 0],
        out.gripTightenAlpha * 0.65,
      );
    } else {
      this.leftRoot.visible = false;
    }

    this.initialized = true;
  }

  public dispose(): void {
    this.leftRoot.removeFromParent();
    this.rightRoot.removeFromParent();
    for (const m of this.clonedMats) m.dispose();
    this.clonedMats.length = 0;
  }
}

export function createFpsArmRigFromScene(scene: THREE.Object3D): FpsArmRig | null {
  const leftSrc = scene.getObjectByName('LeftArmRoot');
  const rightSrc = scene.getObjectByName('RightArmRoot');
  if (!leftSrc || !rightSrc) return null;

  const leftRoot = cloneSkeleton(leftSrc);
  const rightRoot = cloneSkeleton(rightSrc);

  const leftBones = collectArmBones(leftRoot, 'L');
  const rightBones = collectArmBones(rightRoot, 'R');
  if (!leftBones || !rightBones) return null;

  let leftMesh: THREE.SkinnedMesh | null = null;
  let rightMesh: THREE.SkinnedMesh | null = null;
  const clonedMats: THREE.Material[] = [];

  const prepSide = (root: THREE.Object3D, isLeft: boolean) => {
    root.traverse((obj) => {
      const sk = obj as THREE.SkinnedMesh;
      if (!sk.isMesh) return;
      sk.frustumCulled = false;
      sk.castShadow = false;
      sk.receiveShadow = true;

      const srcMats = Array.isArray(sk.material) ? sk.material : [sk.material];
      const nextMats = srcMats.map((raw) => {
        const m = raw.clone();
        clonedMats.push(m);
        if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          const std = m as THREE.MeshStandardMaterial;
          std.envMapIntensity = 1.25;
          std.roughness = Math.min(0.92, Math.max(0.45, std.roughness || 0.78));
        }
        return m;
      });
      sk.material = Array.isArray(sk.material) ? nextMats : nextMats[0];

      if (sk.isSkinnedMesh) {
        if (isLeft) leftMesh = sk;
        else rightMesh = sk;
      }
    });
  };

  prepSide(leftRoot, true);
  prepSide(rightRoot, false);

  if (!leftMesh || !rightMesh) {
    for (const m of clonedMats) m.dispose();
    return null;
  }

  return new FpsArmRig(
    leftRoot,
    rightRoot,
    leftMesh,
    rightMesh,
    leftBones,
    rightBones,
    clonedMats,
  );
}

let cachedArmsPromise: Promise<THREE.Group | null> | null = null;

export function preloadFpsArmsModel(): void {
  if (typeof window === 'undefined') return;
  if (!cachedArmsPromise) {
    const loader = new GLTFLoader();
    cachedArmsPromise = loader
      .loadAsync(FPS_ARMS_GLB_URL)
      .then((gltf) => gltf.scene)
      .catch((err) => {
        console.warn('[armRig] Failed to load fps_arms.glb:', err);
        return null;
      });
  }
}

export async function buildExternalFpsArms(): Promise<FpsArmRig | null> {
  if (typeof window === 'undefined') return null;
  preloadFpsArmsModel();
  const scene = await cachedArmsPromise;
  if (!scene) return null;
  return createFpsArmRigFromScene(scene);
}
