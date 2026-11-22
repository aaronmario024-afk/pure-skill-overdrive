import * as THREE from 'three';
import { WeaponMechEvent } from '../audio/sfx';
import { WeaponDef } from '../data/weapons';
import { WeaponRig } from './weaponModels';

export type WeaponAnimState =
  | 'equip'
  | 'idle'
  | 'move'
  | 'airborne'
  | 'fire'
  | 'reload'
  | 'inspect'
  | 'melee';

/**
 * Centralized animation priority hierarchy.
 * Higher-priority states can interrupt lower-priority states seamlessly,
 * while equal or lower-priority states only transition when the active state completes
 * or explicitly yields (e.g., weapon switch equip or reload cancellation).
 */
export const WEAPON_STATE_PRIORITY: Record<WeaponAnimState, number> = {
  equip: 60,
  reload: 50,
  melee: 45,
  fire: 40,
  airborne: 20,
  move: 15,
  idle: 10,
  inspect: 5,
};

export interface WeaponAnimContext {
  horizSpeed: number;
  forwardInput: number;
  strafeInput: number;
  grounded: boolean;
  velY: number;
  crouching: boolean;
  reloading: boolean;
  reloadProgress: number;
  reloadDuration: number;
  scoped: boolean;
  ammo: number;
  maxAmmo: number;
  spinbot: boolean;
  fireInterval: number;
}

export interface WeaponAnimCallbacks {
  onMechSound?: (event: WeaponMechEvent, weaponId: string) => void;
  onEjectShell?: (weaponId: string) => void;
  onCancelFoley?: () => void;
}

export type LeftHandPoseId =
  | 'foregrip'
  | 'pistol_support'
  | 'mag_grab'
  | 'bolt_pinch'
  | 'shell_load'
  | 'guard';

export type RightHandPoseId =
  | 'grip'
  | 'bolt_cycle'
  | 'karambit_hold'
  | 'karambit_spin';

export interface WeaponAnimOutput {
  rootPos: THREE.Vector3;
  rootRot: THREE.Euler;
  pivotPos: THREE.Vector3;
  pivotRot: THREE.Euler;
  leftHandTarget: THREE.Vector3;
  rightHandTarget: THREE.Vector3;
  leftHandWeight: number;
  adsAlpha: number;
  triggerPullAlpha: number;
  gripTightenAlpha: number;
  knifeSpinOpenAlpha: number;
  leftHandPose: LeftHandPoseId;
  rightHandPose: RightHandPoseId;
}

interface Pose {
  rootPos: THREE.Vector3;
  rootRot: THREE.Euler;
  pivotPos: THREE.Vector3;
  pivotRot: THREE.Euler;
}

function makePose(): Pose {
  return {
    rootPos: new THREE.Vector3(),
    rootRot: new THREE.Euler(),
    pivotPos: new THREE.Vector3(),
    pivotRot: new THREE.Euler(),
  };
}

function copyPose(dst: Pose, src: Pose): void {
  dst.rootPos.copy(src.rootPos);
  dst.rootRot.copy(src.rootRot);
  dst.pivotPos.copy(src.pivotPos);
  dst.pivotRot.copy(src.pivotRot);
}

function smootherstep(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function expDamp(cur: number, target: number, lambda: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}

function lerpEuler(a: THREE.Euler, b: THREE.Euler, t: number, out: THREE.Euler): void {
  out.set(
    THREE.MathUtils.lerp(a.x, b.x, t),
    THREE.MathUtils.lerp(a.y, b.y, t),
    THREE.MathUtils.lerp(a.z, b.z, t),
  );
}

export class Spring1D {
  public value = 0;
  public velocity = 0;
  public target = 0;
  public stiffness: number;
  public damping: number;

  constructor(stiffness: number, damping: number) {
    this.stiffness = stiffness;
    this.damping = damping;
  }

  public impulse(dv: number): void {
    this.velocity += dv;
  }

  /**
   * Unconditionally stable, frame-rate-independent sub-stepped semi-implicit Euler integration.
   * Guarantees identical trajectories at 20 FPS, 60 FPS, 144 FPS, and 240 FPS.
   */
  public step(dt: number): number {
    const maxSubStep = 1 / 240;
    let rem = THREE.MathUtils.clamp(dt, 0, 0.12);
    while (rem > 1e-6) {
      const h = rem > maxSubStep ? maxSubStep : rem;
      const force = (this.target - this.value) * this.stiffness;
      this.velocity += force * h;
      this.velocity *= Math.exp(-this.damping * h);
      this.value += this.velocity * h;
      rem -= h;
    }
    return this.value;
  }

  public reset(): void {
    this.value = 0;
    this.velocity = 0;
    this.target = 0;
  }
}

class Spring3D {
  public x: Spring1D;
  public y: Spring1D;
  public z: Spring1D;

  constructor(stiffness: number, damping: number) {
    this.x = new Spring1D(stiffness, damping);
    this.y = new Spring1D(stiffness, damping);
    this.z = new Spring1D(stiffness, damping);
  }

  public impulse(ix: number, iy: number, iz: number): void {
    this.x.impulse(ix);
    this.y.impulse(iy);
    this.z.impulse(iz);
  }

  public step(dt: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(this.x.step(dt), this.y.step(dt), this.z.step(dt));
    return out;
  }

  public reset(): void {
    this.x.reset();
    this.y.reset();
    this.z.reset();
  }
}

export class WeaponAnimator {
  private rig: WeaponRig | null = null;
  private def: WeaponDef | null = null;
  private callbacks: WeaponAnimCallbacks = {};
  private restTransforms = new Map<THREE.Object3D, { pos: THREE.Vector3; rot: THREE.Euler }>();

  public state: WeaponAnimState = 'equip';
  private stateTime = 0;
  private blendDur = 0.1;
  private blendElapsed = 0.1;
  private fromPose = makePose();
  private curBasePose = makePose();
  private tempStatePose = makePose();

  private idleClock = 0;
  private bobPhase = 0;
  private slashParity = 0;
  private prevGrounded = true;
  private lastVelY = 0;
  private slideLockedBack = false;
  private adsAlpha = 0;

  private firedStateEvents = new Set<string>();
  private firedCycleEvents = new Set<string>();

  // Post-shot mechanical cycles
  private shotAnimClock = 99;
  private boltCycleKind: 'none' | 'pump' | 'bolt' = 'none';
  private boltCycleClock = 0;
  private boltCycleDur = 0.4;
  private boltCycleDelay = 0.2;
  private inspectDur = 3.4;

  // Physics springs
  private recoilPosSpring = new Spring3D(240, 22);
  private recoilRotSpring = new Spring3D(220, 20);
  private swayPosSpring = new Spring3D(140, 18);
  private swayRotSpring = new Spring3D(130, 16);
  private landingY = new Spring1D(160, 14);
  private strafeRoll = 0;

  private outPos = new THREE.Vector3();
  private outRot = new THREE.Euler();
  private outPivotPos = new THREE.Vector3();
  private outPivotRot = new THREE.Euler();
  private leftHandTarget = new THREE.Vector3();
  private rightHandTarget = new THREE.Vector3();
  private smoothedLeftHand = new THREE.Vector3();
  private smoothedRightHand = new THREE.Vector3();
  private smoothedLeftWeight = 1;
  private handTargetsInitialized = false;

  public setCallbacks(cbs: WeaponAnimCallbacks): void {
    this.callbacks = cbs;
  }

  public get currentAdsAlpha(): number {
    return this.adsAlpha;
  }

  public canInterrupt(next: WeaponAnimState, force = false): boolean {
    if (force) return true;
    return WEAPON_STATE_PRIORITY[next] >= WEAPON_STATE_PRIORITY[this.state];
  }

  public onEquip(def: WeaponDef, rig: WeaponRig): void {
    if (this.def) {
      this.callbacks.onCancelFoley?.();
      if (this.def.id !== def.id) {
        this.callbacks.onMechSound?.('holster', this.def.id);
      }
    }
    this.def = def;
    this.rig = rig;
    this.restTransforms.clear();
    for (const part of Object.values(rig.parts)) {
      if (part) {
        this.restTransforms.set(part, { pos: part.position.clone(), rot: part.rotation.clone() });
      }
    }

    const heavy = def.id === 'sniper' || def.id === 'shotgun' ? 0.72 : def.id === 'rifle' || def.id === 'ssg' ? 0.85 : 1.05;
    this.recoilPosSpring.x.stiffness = this.recoilPosSpring.y.stiffness = this.recoilPosSpring.z.stiffness = 240 * heavy;
    this.recoilPosSpring.x.damping = this.recoilPosSpring.y.damping = this.recoilPosSpring.z.damping = 21 * heavy;
    this.recoilRotSpring.x.stiffness = this.recoilRotSpring.y.stiffness = this.recoilRotSpring.z.stiffness = 220 * heavy;
    this.recoilRotSpring.x.damping = this.recoilRotSpring.y.damping = this.recoilRotSpring.z.damping = 19 * heavy;

    this.recoilPosSpring.reset();
    this.recoilRotSpring.reset();
    this.swayPosSpring.reset();
    this.swayRotSpring.reset();
    this.landingY.reset();

    this.slideLockedBack = false;
    this.shotAnimClock = 99;
    this.boltCycleKind = 'none';
    this.firedCycleEvents.clear();
    this.adsAlpha = 0;
    this.smoothedLeftHand.copy(rig.anchors.leftHandRest);
    this.smoothedRightHand.copy(rig.anchors.rightHandGrip);
    this.smoothedLeftWeight = rig.anchors.useLeftHand ? 1 : 0;
    this.handTargetsInitialized = true;

    this.state = 'equip';
    this.stateTime = 0;
    this.blendDur = 0.06;
    this.blendElapsed = 0.06;
    this.firedStateEvents.clear();
    this.fromPose.rootPos.set(0.05, -0.24, 0.08);
    this.fromPose.rootRot.set(-0.55, -0.15, 0.35);
    this.fromPose.pivotPos.set(0, 0, 0);
    this.fromPose.pivotRot.set(0, 0, 0);
  }

  public onDryFire(): void {
    if (!this.def) return;
    this.callbacks.onMechSound?.('dry_fire', this.def.id);
    this.recoilPosSpring.impulse(0, 0.025, 0.08);
    this.recoilRotSpring.impulse(0.18, 0, 0);
    this.shotAnimClock = 0;
  }

  public cancelReload(grounded = true, horizSpeed = 0): void {
    if (this.state !== 'reload') return;
    this.callbacks.onCancelFoley?.();
    this.boltCycleKind = 'none';
    this.firedCycleEvents.clear();
    this.setState(grounded ? (horizSpeed > 0.6 ? 'move' : 'idle') : 'airborne', 0.1, true);
  }

  private setState(next: WeaponAnimState, blendDur: number, force = false): void {
    if (this.state === next) return;
    if (!this.canInterrupt(next, force)) return;
    copyPose(this.fromPose, this.curBasePose);
    this.state = next;
    this.stateTime = 0;
    this.blendDur = Math.max(0.04, blendDur);
    this.blendElapsed = 0;
    this.firedStateEvents.clear();
  }

  private fireStateOnce(key: string, progress: number, threshold: number, event: WeaponMechEvent): void {
    if (progress >= threshold && !this.firedStateEvents.has(key)) {
      this.firedStateEvents.add(key);
      this.callbacks.onMechSound?.(event, this.def?.id ?? 'rifle');
    }
  }

  private fireCycleOnce(key: string, progress: number, threshold: number, fn: () => void): void {
    if (progress >= threshold && !this.firedCycleEvents.has(key)) {
      this.firedCycleEvents.add(key);
      fn();
    }
  }

  public onFire(isLastBullet = false): void {
    if (!this.def || !this.rig) return;
    const id = this.def.id;

    if (this.def.isMelee) {
      if (this.state === 'inspect' || this.state === 'equip') {
        this.callbacks.onCancelFoley?.();
      }
      this.slashParity = (this.slashParity + 1) % 2;
      copyPose(this.fromPose, this.curBasePose);
      this.state = 'melee';
      this.stateTime = 0;
      this.blendDur = 0.05;
      this.blendElapsed = 0;
      this.firedStateEvents.clear();
      return;
    }

    if (this.state === 'inspect' || this.state === 'equip') {
      this.callbacks.onCancelFoley?.();
      this.setState('fire', 0.06, true);
    } else if (this.state !== 'reload') {
      copyPose(this.fromPose, this.curBasePose);
      this.state = 'fire';
      this.stateTime = 0;
      this.blendDur = 0.05;
      this.blendElapsed = 0.05;
    }

    this.shotAnimClock = 0;
    if (id === 'pistol' && isLastBullet) this.slideLockedBack = true;

    // Class-tuned physical recoil impulses
    const kickZ =
      id === 'sniper' ? 1.85 :
      id === 'shotgun' ? 1.65 :
      id === 'ssg' ? 1.35 :
      id === 'rifle' ? 0.95 :
      id === 'pistol' ? 0.78 :
      id === 'm4' ? 0.72 : 0.56;
    const kickPitch =
      id === 'sniper' ? 2.6 :
      id === 'shotgun' ? 2.4 :
      id === 'pistol' ? 1.9 :
      id === 'rifle' ? 1.45 :
      id === 'm4' ? 1.05 : 0.85;

    this.recoilPosSpring.impulse(
      (Math.random() - 0.5) * 0.14 * kickZ,
      0.24 * kickZ,
      kickZ,
    );
    this.recoilRotSpring.impulse(
      kickPitch,
      (Math.random() - 0.5) * 0.65,
      (Math.random() - 0.5) * 0.9,
    );

    if (id === 'shotgun') {
      this.boltCycleKind = 'pump';
      this.boltCycleDelay = 0.18;
      this.boltCycleClock = -0.18;
      this.boltCycleDur = 0.38;
      this.firedCycleEvents.clear();
    } else if (id === 'ssg' || id === 'sniper') {
      this.boltCycleKind = 'bolt';
      this.boltCycleDelay = 0.22;
      this.boltCycleClock = -0.22;
      this.boltCycleDur = id === 'sniper' ? 0.76 : 0.52;
      this.firedCycleEvents.clear();
    }
  }

  public onReloadStart(): void {
    this.callbacks.onCancelFoley?.();
    this.boltCycleKind = 'none';
    this.firedCycleEvents.clear();
    this.setState('reload', 0.12, true);
  }

  public onScopeToggle(scoped: boolean): void {
    if (!this.def?.scope) return;
    if (this.state === 'inspect') {
      this.setState('idle', 0.08, true);
    }
    if (scoped && !this.reloadingLocked()) {
      this.callbacks.onMechSound?.('scope_click', this.def.id);
    }
  }

  private reloadingLocked(): boolean {
    return this.state === 'reload';
  }

  public triggerInspect(): void {
    if (!this.def || this.state === 'reload' || this.state === 'equip' || this.state === 'melee') return;
    if (this.state === 'inspect') {
      this.setState('idle', 0.14, true);
      return;
    }
    const durMap: Record<string, number> = {
      knife: 5.8,
      pistol: 3.3,
      smg: 3.2,
      shotgun: 3.6,
      ssg: 3.8,
      rifle: 3.6,
      m4: 3.5,
      sniper: 3.8,
    };
    this.inspectDur = durMap[this.def.id] ?? 3.5;
    this.callbacks.onMechSound?.(this.def.isMelee ? 'knife_spin' : 'inspect_whoosh', this.def.id);
    this.setState('inspect', 0.14, true);
  }

  public addLookSway(dx: number, dy: number): void {
    const sx = THREE.MathUtils.clamp(-dx * 0.012, -0.5, 0.5);
    const sy = THREE.MathUtils.clamp(dy * 0.012, -0.5, 0.5);
    this.swayPosSpring.impulse(sx * 0.09, sy * 0.09, 0);
    this.swayRotSpring.impulse(sy * 0.16, sx * 0.22, sx * 0.28);
  }

  public update(dt: number, ctx: WeaponAnimContext): WeaponAnimOutput {
    const rig = this.rig!;
    const def = this.def!;
    const id = def.id;

    this.idleClock += dt;
    this.stateTime += dt;
    this.shotAnimClock += dt;
    if (this.blendElapsed < this.blendDur) {
      this.blendElapsed = Math.min(this.blendDur, this.blendElapsed + dt);
    }

    // Landing compression detection
    if (ctx.grounded && !this.prevGrounded && this.lastVelY < -2.2) {
      const impact = THREE.MathUtils.clamp(-this.lastVelY * 0.032, 0.08, 0.42);
      this.landingY.impulse(-impact);
    }
    this.prevGrounded = ctx.grounded;
    this.lastVelY = ctx.velY;

    if (!ctx.reloading && this.state === 'reload') {
      this.slideLockedBack = false;
      this.setState(ctx.grounded ? (ctx.horizSpeed > 0.6 ? 'move' : 'idle') : 'airborne', 0.14, true);
    } else if (ctx.reloading && this.state !== 'reload') {
      this.onReloadStart();
    }
    if (ctx.ammo > 0 && this.slideLockedBack && this.shotAnimClock > 0.15) {
      this.slideLockedBack = false;
    }

    // Automatic state progression
    if (this.state === 'equip' && this.stateTime >= 0.34) {
      this.setState(ctx.grounded ? (ctx.horizSpeed > 0.6 ? 'move' : 'idle') : 'airborne', 0.12, true);
    } else if (this.state === 'melee' && this.stateTime >= 0.38) {
      this.setState('idle', 0.12, true);
    } else if (this.state === 'fire' && this.stateTime >= Math.max(0.14, def.fireInterval * 0.9)) {
      this.setState(ctx.grounded ? (ctx.horizSpeed > 0.6 ? 'move' : 'idle') : 'airborne', 0.14, true);
    } else if (this.state === 'inspect' && this.stateTime >= this.inspectDur) {
      this.setState('idle', 0.16, true);
    } else if (this.state === 'idle' || this.state === 'move' || this.state === 'airborne') {
      const nextLoc = !ctx.grounded ? 'airborne' : ctx.horizSpeed > 0.65 ? 'move' : 'idle';
      if (nextLoc !== this.state) {
        this.setState(nextLoc, 0.12, true);
      }
    }

    // Reset articulated parts cleanly to authored rest poses
    for (const [obj, rest] of this.restTransforms.entries()) {
      obj.position.copy(rest.pos);
      obj.rotation.copy(rest.rot);
    }

    // Default hand targets in weaponPivot space
    this.rightHandTarget.copy(rig.anchors.rightHandGrip);
    this.leftHandTarget.copy(rig.anchors.leftHandRest);
    let leftWeight = rig.anchors.useLeftHand ? 1 : 0;
    let knifeSpinOpen = 0;

    // Reset temp state pose
    this.tempStatePose.rootPos.set(0, 0, 0);
    this.tempStatePose.rootRot.set(0, 0, 0);
    this.tempStatePose.pivotPos.set(0, 0, 0);
    this.tempStatePose.pivotRot.set(0, 0, 0);

    const crouchScale = ctx.crouching ? 0.5 : 1;
    const breatheX = Math.sin(this.idleClock * 1.15) * 0.002 + Math.sin(this.idleClock * 2.1 + 0.8) * 0.0008;
    const breatheY = Math.cos(this.idleClock * 1.65) * 0.0022 * crouchScale;

    if (this.state === 'equip') {
      const u = THREE.MathUtils.clamp(this.stateTime / 0.34, 0, 1);
      const ease = smootherstep(u);
      const settle = Math.sin(u * Math.PI) * 0.015;
      this.fireStateOnce('eq1', u, 0.05, 'equip_rustle');
      this.fireStateOnce('eq2', u, 0.52, def.isMelee ? 'knife_draw' : 'equip_rack');
      this.tempStatePose.rootPos.set((1 - ease) * 0.05, (1 - ease) * -0.18 + settle, (1 - ease) * 0.06);
      this.tempStatePose.rootRot.set((1 - ease) * -0.45, (1 - ease) * -0.14, (1 - ease) * 0.28);
      if (def.isMelee) {
        knifeSpinOpen = Math.sin(u * Math.PI) * 0.65;
        if (rig.parts.blade) {
          rig.parts.blade.rotation.x += (1 - ease) * -Math.PI * 2;
        }
      }
      if (rig.parts.chargingHandle && !def.isMelee) {
        const pull = u > 0.45 && u < 0.85 ? Math.sin(((u - 0.45) / 0.4) * Math.PI) * 0.045 : 0;
        rig.parts.chargingHandle.position.z += pull;
      }
    } else if (this.state === 'idle' || this.state === 'fire') {
      this.tempStatePose.rootPos.set(breatheX, breatheY, 0);
      this.tempStatePose.rootRot.set(breatheY * 1.4, breatheX * 1.1, 0);
    } else if (this.state === 'move') {
      const weightPace = id === 'sniper' || id === 'shotgun' ? 0.86 : def.isMelee ? 1.12 : 1.0;
      this.bobPhase += dt * (5.6 + ctx.horizSpeed * 0.42) * weightPace;
      const amp = Math.min(1, ctx.horizSpeed / 6.5) * crouchScale;
      const bx = Math.cos(this.bobPhase * 0.5) * 0.011 * amp;
      const by = Math.abs(Math.sin(this.bobPhase)) * -0.012 * amp;
      const bz = Math.sin(this.bobPhase) * 0.006 * amp;
      this.tempStatePose.rootPos.set(bx + breatheX * 0.4, by, bz);
      this.tempStatePose.rootRot.set(
        Math.sin(this.bobPhase) * 0.018 * amp,
        Math.cos(this.bobPhase * 0.5) * 0.016 * amp,
        0,
      );
    } else if (this.state === 'airborne') {
      const lagY = THREE.MathUtils.clamp(-ctx.velY * 0.0042, -0.042, 0.032);
      this.tempStatePose.rootPos.set(0, lagY, 0.01);
      this.tempStatePose.rootRot.set(lagY * 2.2, 0, -0.04);
    } else if (this.state === 'melee') {
      const u = THREE.MathUtils.clamp(this.stateTime / 0.38, 0, 1);
      const whip = Math.sin(Math.pow(u, 0.65) * Math.PI);
      const dir = this.slashParity === 0 ? 1 : -1;
      leftWeight = whip * 0.4;
      this.tempStatePose.rootPos.set(-0.08 * whip * dir, -0.04 * whip, -0.22 * whip);
      this.tempStatePose.rootRot.set(-0.35 * whip, 1.05 * whip * dir, 0.65 * whip * dir);
      if (rig.parts.blade) {
        rig.parts.blade.rotation.x -= Math.sin(whip * Math.PI) * 0.28;
      }
    } else if (this.state === 'inspect') {
      const u = THREE.MathUtils.clamp(this.stateTime / this.inspectDur, 0, 1);
      const enter = smootherstep(Math.min(1, u / 0.18));
      const exit = smootherstep(Math.max(0, (u - 0.82) / 0.18));
      const active = enter * (1 - exit);

      if (id === 'knife') {
        // 5.8s multi-stage Karambit finger-ring spin & dual-side steel bevel showcase
        leftWeight = 0;
        const heroIn = smootherstep(Math.min(1, u / 0.11));
        const heroOut = smootherstep(Math.max(0, (u - 0.89) / 0.11));
        const poseEnv = heroIn * (1 - heroOut);

        this.fireStateOnce('insp_k1', u, 0.05, 'knife_spin');
        this.fireStateOnce('insp_k2', u, 0.13, 'knife_spin');
        this.fireStateOnce('insp_k3', u, 0.23, 'inspect_whoosh');
        this.fireStateOnce('insp_k4', u, 0.34, 'equip_rustle');
        this.fireStateOnce('insp_k5', u, 0.51, 'knife_spin');
        this.fireStateOnce('insp_k6', u, 0.60, 'inspect_whoosh');
        this.fireStateOnce('insp_k7', u, 0.68, 'equip_rustle');
        this.fireStateOnce('insp_k8', u, 0.82, 'knife_spin');
        this.fireStateOnce('insp_k9', u, 0.93, 'knife_draw');

        let bladeRotX = 0;
        let wristFlickX = 0;
        let catchBump = 0;
        let showY = 0.72;
        let showZ = -0.44;
        let showX = 0.18;

        if (u < 0.11) {
          knifeSpinOpen = smootherstep(u / 0.11);
        } else if (u < 0.34) {
          // Stage 2: 3-revolution forward finger-ring twirl
          knifeSpinOpen = 1;
          const spin1 = smootherstep((u - 0.11) / 0.23);
          bladeRotX = spin1 * Math.PI * 6;
          wristFlickX = Math.sin(spin1 * Math.PI * 6) * 0.09;
        } else if (u < 0.50) {
          // Stage 3: Crisp palm catch + right-side bevel showcase
          const catchFrac = smootherstep(Math.min(1, (u - 0.34) / 0.045));
          const openPrep = smootherstep(Math.max(0, (u - 0.46) / 0.04));
          knifeSpinOpen = Math.max(openPrep, 1 - catchFrac);
          bladeRotX = Math.PI * 6;
          if (u < 0.42) catchBump = Math.sin(((u - 0.34) / 0.08) * Math.PI) * 0.14;
          const drift = smootherstep((u - 0.34) / 0.16);
          showY = 0.72 + Math.sin(drift * Math.PI) * 0.08;
          showZ = -0.44 - Math.sin(drift * Math.PI) * 0.06;
        } else if (u < 0.68) {
          // Stage 4: 2-revolution reverse counter-spin while rolling to opposite face
          knifeSpinOpen = 1;
          const spin2 = smootherstep((u - 0.50) / 0.18);
          bladeRotX = Math.PI * 6 - spin2 * Math.PI * 4;
          wristFlickX = Math.sin(spin2 * Math.PI * 4) * -0.09;
          showX = THREE.MathUtils.lerp(0.18, 0.24, spin2);
          showY = THREE.MathUtils.lerp(0.72, -0.82, spin2);
          showZ = THREE.MathUtils.lerp(-0.44, 0.52, spin2);
        } else if (u < 0.82) {
          // Stage 5: Catch + slow opposite-side bevel showcase
          const catchFrac = smootherstep(Math.min(1, (u - 0.68) / 0.045));
          const openPrep = smootherstep(Math.max(0, (u - 0.78) / 0.04));
          knifeSpinOpen = Math.max(openPrep, 1 - catchFrac);
          bladeRotX = Math.PI * 2;
          if (u < 0.76) catchBump = Math.sin(((u - 0.68) / 0.08) * Math.PI) * 0.14;
          const sway = smootherstep((u - 0.68) / 0.14);
          showX = THREE.MathUtils.lerp(0.24, 0.16, sway);
          showY = THREE.MathUtils.lerp(-0.82, -0.58, sway);
          showZ = THREE.MathUtils.lerp(0.52, 0.26, sway);
        } else {
          // Stage 6: Final 1-revolution whip spin + crisp combat catch settle
          const spin3 = smootherstep(Math.min(1, (u - 0.82) / 0.11));
          const closeFinal = smootherstep(Math.max(0, (u - 0.92) / 0.05));
          knifeSpinOpen = u < 0.92 ? 1 : 1 - closeFinal;
          bladeRotX = Math.PI * 2 + spin3 * Math.PI * 2;
          wristFlickX = Math.sin(spin3 * Math.PI * 2) * 0.10;
          if (u >= 0.92 && u < 0.98) {
            catchBump = Math.sin(((u - 0.92) / 0.06) * Math.PI) * 0.12;
          }
          showX = THREE.MathUtils.lerp(0.16, 0.0, spin3);
          showY = THREE.MathUtils.lerp(-0.58, 0.0, spin3);
          showZ = THREE.MathUtils.lerp(0.26, 0.0, spin3);
        }

        if (rig.parts.blade) {
          rig.parts.blade.rotation.x += bladeRotX;
        }
        this.tempStatePose.rootPos.set(-0.085 * poseEnv, 0.055 * poseEnv, 0.025 * poseEnv);
        this.tempStatePose.pivotRot.set(
          showX * poseEnv + wristFlickX - catchBump,
          showY * poseEnv,
          showZ * poseEnv,
        );
      } else if (id === 'pistol') {
        // Tactical press-check + dual-side slide/camo showcase
        leftWeight = 1.0;
        this.fireStateOnce('insp_p1', u, 0.24, 'press_check');
        this.fireStateOnce('insp_p2', u, 0.58, 'inspect_whoosh');
        const flip = smootherstep(Math.max(0, (u - 0.48) / 0.25));
        const sideMix = THREE.MathUtils.lerp(1, -0.9, flip);
        const checkWave = u >= 0.22 && u <= 0.45 ? Math.sin(((u - 0.22) / 0.23) * Math.PI) : 0;
        this.tempStatePose.rootPos.set(-0.068 * active, 0.036 * active, 0.012 * active);
        this.tempStatePose.pivotRot.set(0.14 * active, 0.52 * active * sideMix, -0.34 * active * sideMix);
        if (rig.parts.slideOrBolt) rig.parts.slideOrBolt.position.z += checkWave * 0.022;
        if (rig.parts.chamberRound) rig.parts.chamberRound.visible = checkWave > 0.25;
        if (rig.anchors.leftHandBoltOffset) {
          this.leftHandTarget.lerp(rig.anchors.leftHandBoltOffset, Math.min(1, checkWave * 1.15));
          this.leftHandTarget.z += checkWave * 0.022;
        }
      } else if (id === 'shotgun') {
        // Loading-port roll + half-pump chamber peek
        leftWeight = 0.92;
        this.fireStateOnce('insp_s1', u, 0.32, 'press_check');
        this.fireStateOnce('insp_s2', u, 0.52, 'pump_fwd');
        this.fireStateOnce('insp_s3', u, 0.68, 'inspect_whoosh');
        const flip = smootherstep(Math.max(0, (u - 0.56) / 0.24));
        const sideMix = THREE.MathUtils.lerp(1, -0.78, flip);
        const pumpWave = u >= 0.30 && u <= 0.54 ? Math.sin(((u - 0.30) / 0.24) * Math.PI) : 0;
        this.tempStatePose.rootPos.set(-0.072 * active, 0.028 * active, 0.020 * active);
        this.tempStatePose.pivotRot.set(0.18 * active, 0.58 * active * sideMix, -0.58 * active * sideMix);
        if (rig.parts.pumpForend) rig.parts.pumpForend.position.z += pumpWave * 0.042;
        if (rig.parts.slideOrBolt) rig.parts.slideOrBolt.position.z += pumpWave * 0.032;
        if (rig.parts.chamberRound) rig.parts.chamberRound.visible = pumpWave > 0.25;
        this.leftHandTarget.z += pumpWave * 0.042;
      } else if (id === 'ssg' || id === 'sniper') {
        // Deliberate marksman inspection with cam bolt lift & lock check
        leftWeight = 0.85;
        this.fireStateOnce('insp_b1', u, 0.32, 'bolt_lift');
        this.fireStateOnce('insp_b2', u, 0.54, 'bolt_lock');
        this.fireStateOnce('insp_b3', u, 0.68, 'inspect_whoosh');
        const sweep = smootherstep(Math.max(0, (u - 0.55) / 0.24));
        const sideMix = THREE.MathUtils.lerp(1, -0.82, sweep);
        const boltWave = u >= 0.30 && u <= 0.56 ? Math.sin(((u - 0.30) / 0.26) * Math.PI) : 0;
        this.tempStatePose.rootPos.set(-0.082 * active, 0.026 * active, 0.022 * active);
        this.tempStatePose.pivotRot.set(0.12 * active, 0.66 * active * sideMix, -0.24 * active * sideMix);
        if (rig.parts.boltHandle) rig.parts.boltHandle.rotation.z += boltWave * 0.72;
        if (rig.parts.slideOrBolt) rig.parts.slideOrBolt.position.z += boltWave * 0.026;
        if (rig.parts.chamberRound) rig.parts.chamberRound.visible = boltWave > 0.35;
        if (rig.anchors.leftHandMagOffset) {
          this.leftHandTarget.lerp(rig.anchors.leftHandMagOffset, active * 0.45);
        }
      } else {
        // Rifle (AK-Phantom), M4 (Locust M4-X), SMG (Wasp MP-9)
        leftWeight = 0.88;
        this.fireStateOnce('insp_r1', u, id === 'rifle' ? 0.30 : 0.28, 'press_check');
        this.fireStateOnce('insp_r2', u, 0.58, 'inspect_whoosh');
        const flip = smootherstep(Math.max(0, (u - 0.46) / 0.25));
        const sideMix = THREE.MathUtils.lerp(1, -0.88, flip);
        const checkWave = u >= 0.26 && u <= 0.45 ? Math.sin(((u - 0.26) / 0.19) * Math.PI) : 0;
        const cantY = id === 'smg' ? 0.58 : 0.64;
        const rollZ = id === 'm4' ? -0.36 : id === 'smg' ? -0.44 : -0.30;
        this.tempStatePose.rootPos.set(-0.076 * active, 0.032 * active, 0.018 * active);
        this.tempStatePose.pivotRot.set(0.14 * active, cantY * active * sideMix, rollZ * active * sideMix + Math.sin(u * Math.PI * 2.5) * 0.035 * active);
        if (rig.parts.chargingHandle) rig.parts.chargingHandle.position.z += checkWave * 0.028;
        if (rig.parts.slideOrBolt) rig.parts.slideOrBolt.position.z += checkWave * 0.028;
        if (rig.anchors.leftHandMagOffset && id === 'rifle') {
          this.leftHandTarget.lerp(rig.anchors.leftHandMagOffset, Math.min(1, checkWave * 0.9 + active * 0.35));
        } else if (rig.anchors.leftHandBoltOffset && (id === 'm4' || id === 'smg')) {
          this.leftHandTarget.lerp(rig.anchors.leftHandBoltOffset, Math.min(1, checkWave * 0.85));
        }
      }
    } else if (this.state === 'reload') {
      const p = THREE.MathUtils.clamp(ctx.reloadProgress, 0, 1);
      if (id === 'shotgun') {
        const tilt = Math.sin(smootherstep(Math.min(1, p / 0.18)) * (Math.PI / 2)) * (1 - smootherstep(Math.max(0, (p - 0.82) / 0.18)));
        this.tempStatePose.rootPos.set(-0.035 * tilt, -0.055 * tilt, 0.01);
        this.tempStatePose.rootRot.set(0.24 * tilt, 0.15 * tilt, -0.56 * tilt);
        this.fireStateOnce('sg0', p, 0.06, 'equip_rustle');
        this.fireStateOnce('sg1', p, 0.24, 'shell_insert');
        this.fireStateOnce('sg2', p, 0.44, 'shell_insert');
        this.fireStateOnce('sg3', p, 0.64, 'shell_insert');
        this.fireStateOnce('sg4', p, 0.77, 'pump_back');
        this.fireStateOnce('sg5', p, 0.89, 'pump_fwd');
        this.fireStateOnce('sg6', p, 0.95, 'reload_end');

        if (p < 0.74 && rig.anchors.leftHandMagOffset) {
          const shellPulse = Math.abs(Math.sin(p * Math.PI * 4.5));
          this.leftHandTarget.lerp(rig.anchors.leftHandMagOffset, Math.min(1, tilt * (0.75 + shellPulse * 0.25)));
        } else if (rig.parts.pumpForend) {
          const uPump = THREE.MathUtils.clamp((p - 0.76) / 0.18, 0, 1);
          const pumpZ = Math.sin(uPump * Math.PI) * 0.09;
          rig.parts.pumpForend.position.z += pumpZ;
          this.leftHandTarget.copy(rig.anchors.leftHandRest);
          this.leftHandTarget.z += pumpZ;
        }
      } else {
        // Weapon-specific synchronized detachable-magazine reload sequences
        const enter = smootherstep(Math.min(1, p / 0.2));
        const exit = smootherstep(Math.max(0, (p - 0.88) / 0.12));
        const cant = enter * (1 - exit);
        this.tempStatePose.rootPos.set(-0.032 * cant, -0.048 * cant, 0.015 * cant);
        this.tempStatePose.rootRot.set(0.18 * cant, 0.14 * cant, 0.42 * cant);

        if (id === 'pistol') {
          this.fireStateOnce('p1', p, 0.12, 'mag_release');
          this.fireStateOnce('p2', p, 0.21, 'mag_out');
          this.fireStateOnce('p_grab', p, 0.43, 'equip_rustle');
          this.fireStateOnce('p3', p, 0.62, 'mag_in');
          this.fireStateOnce('p4', p, 0.78, 'bolt_release');
          this.fireStateOnce('p5', p, 0.92, 'reload_end');
        } else if (id === 'm4') {
          this.fireStateOnce('m1', p, 0.14, 'mag_release');
          this.fireStateOnce('m2', p, 0.20, 'mag_out');
          this.fireStateOnce('m_grab', p, 0.43, 'equip_rustle');
          this.fireStateOnce('m3', p, 0.60, 'mag_in');
          this.fireStateOnce('m4', p, 0.70, 'mag_slap');
          this.fireStateOnce('m5', p, 0.80, 'bolt_release');
          this.fireStateOnce('m6', p, 0.92, 'reload_end');
        } else if (id === 'ssg' || id === 'sniper') {
          this.fireStateOnce('sn1', p, 0.15, 'mag_release');
          this.fireStateOnce('sn2', p, 0.22, 'mag_out');
          this.fireStateOnce('sn_grab', p, 0.43, 'equip_rustle');
          this.fireStateOnce('sn3', p, 0.62, 'mag_in');
          this.fireStateOnce('sn4', p, 0.73, 'bolt_lift');
          this.fireStateOnce('sn5', p, 0.79, 'bolt_pull');
          this.fireStateOnce('sn6', p, 0.87, 'bolt_lock');
          this.fireStateOnce('sn7', p, 0.94, 'reload_end');
        } else {
          // AK-Phantom ('rifle') & Wasp MP-9 ('smg')
          this.fireStateOnce('rel0', p, 0.15, 'mag_release');
          this.fireStateOnce('rel1', p, 0.22, 'mag_out');
          this.fireStateOnce('rel_grab', p, 0.43, 'equip_rustle');
          this.fireStateOnce('rel2', p, 0.62, 'mag_in');
          this.fireStateOnce('rel3', p, 0.74, 'bolt_pull');
          this.fireStateOnce('rel4', p, 0.85, 'bolt_release');
          this.fireStateOnce('rel5', p, 0.93, 'reload_end');
        }

        if (rig.parts.magazine) {
          let magDrop = 0;
          if (p >= 0.2 && p < 0.46) {
            magDrop = smootherstep((p - 0.2) / 0.26);
          } else if (p >= 0.46 && p < 0.7) {
            magDrop = 1 - smootherstep((p - 0.46) / 0.24);
          }
          rig.parts.magazine.position.y -= magDrop * 0.23;
          rig.parts.magazine.position.z += magDrop * 0.025;
        }

        if (p < 0.71 && rig.anchors.leftHandMagOffset) {
          const blend = smootherstep(Math.min(1, p / 0.18)) * (1 - smootherstep(Math.max(0, (p - 0.66) / 0.08)));
          this.leftHandTarget.lerp(rig.anchors.leftHandMagOffset, blend);
          if (rig.parts.magazine && p >= 0.2 && p < 0.68) {
            this.leftHandTarget.y += (rig.parts.magazine.position.y - (this.restTransforms.get(rig.parts.magazine)?.pos.y ?? 0));
          }
        } else if (p >= 0.71 && p < 0.92 && rig.anchors.leftHandBoltOffset) {
          const bWave = Math.sin(((p - 0.71) / 0.21) * Math.PI);
          this.leftHandTarget.lerp(rig.anchors.leftHandBoltOffset, Math.min(1, bWave * 1.4));
          const boltPull = p >= 0.74 && p <= 0.86 ? Math.sin(((p - 0.74) / 0.12) * Math.PI) * 0.055 : 0;
          if (rig.parts.chargingHandle) rig.parts.chargingHandle.position.z += boltPull;
          if (rig.parts.slideOrBolt) rig.parts.slideOrBolt.position.z += boltPull;
          this.leftHandTarget.z += boltPull;
          if (p >= 0.84) this.slideLockedBack = false;
        }
      }
    }

    // State cross-fade interpolation
    const blendT = smootherstep(this.blendElapsed / this.blendDur);
    this.curBasePose.rootPos.lerpVectors(this.fromPose.rootPos, this.tempStatePose.rootPos, blendT);
    lerpEuler(this.fromPose.rootRot, this.tempStatePose.rootRot, blendT, this.curBasePose.rootRot);
    this.curBasePose.pivotPos.lerpVectors(this.fromPose.pivotPos, this.tempStatePose.pivotPos, blendT);
    lerpEuler(this.fromPose.pivotRot, this.tempStatePose.pivotRot, blendT, this.curBasePose.pivotRot);

    // Post-shot mechanical weapon action cycles (slide blowback / pump / bolt-action)
    if (id === 'pistol') {
      if (rig.parts.slideOrBolt) {
        let slideBack = this.slideLockedBack ? 0.044 : 0;
        if (!this.slideLockedBack && this.shotAnimClock < 0.11) {
          slideBack = Math.sin((this.shotAnimClock / 0.11) * Math.PI) * 0.046;
        }
        rig.parts.slideOrBolt.position.z += slideBack;
      }
      if (rig.parts.chamberRound) {
        rig.parts.chamberRound.visible = this.shotAnimClock < 0.07 || this.slideLockedBack;
      }
      if (rig.parts.hammer && this.shotAnimClock < 0.14) {
        rig.parts.hammer.rotation.x -= Math.sin((this.shotAnimClock / 0.14) * Math.PI) * 0.45;
      }
    } else if (id === 'smg' || id === 'rifle' || id === 'm4') {
      if (rig.parts.slideOrBolt && this.shotAnimClock < 0.085) {
        rig.parts.slideOrBolt.position.z += Math.sin((this.shotAnimClock / 0.085) * Math.PI) * 0.052;
      }
    }

    if (rig.parts.trigger && this.shotAnimClock < 0.12 && !def.isMelee) {
      rig.parts.trigger.rotation.x -= Math.sin((this.shotAnimClock / 0.12) * Math.PI) * 0.35;
    }

    if (this.boltCycleKind === 'pump' && this.state !== 'reload') {
      this.boltCycleClock += dt;
      if (this.boltCycleClock >= 0) {
        const u = THREE.MathUtils.clamp(this.boltCycleClock / this.boltCycleDur, 0, 1);
        this.fireCycleOnce('pback', u, 0.05, () => this.callbacks.onMechSound?.('pump_back', id));
        this.fireCycleOnce('peject', u, 0.45, () => this.callbacks.onEjectShell?.(id));
        this.fireCycleOnce('pfwd', u, 0.65, () => this.callbacks.onMechSound?.('pump_fwd', id));
        const pumpTravel = Math.sin(u * Math.PI) * 0.095;
        if (rig.parts.pumpForend) rig.parts.pumpForend.position.z += pumpTravel;
        if (rig.parts.slideOrBolt) rig.parts.slideOrBolt.position.z += pumpTravel * 0.72;
        if (rig.parts.chamberRound) rig.parts.chamberRound.visible = u > 0.25 && u < 0.7;
        if (rig.anchors.leftHandFollowsPump) this.leftHandTarget.z += pumpTravel;
        this.curBasePose.rootRot.z -= Math.sin(u * Math.PI) * 0.08;
        if (u >= 1) this.boltCycleKind = 'none';
      }
    } else if (this.boltCycleKind === 'bolt' && this.state !== 'reload') {
      this.boltCycleClock += dt;
      if (this.boltCycleClock >= 0) {
        const u = THREE.MathUtils.clamp(this.boltCycleClock / this.boltCycleDur, 0, 1);
        this.fireCycleOnce('blift', u, 0.04, () => this.callbacks.onMechSound?.('bolt_lift', id));
        this.fireCycleOnce('bpull', u, 0.24, () => this.callbacks.onMechSound?.('bolt_pull', id));
        this.fireCycleOnce('beject', u, 0.46, () => this.callbacks.onEjectShell?.(id));
        this.fireCycleOnce('brel', u, 0.68, () => this.callbacks.onMechSound?.('bolt_release', id));
        this.fireCycleOnce('block', u, 0.88, () => this.callbacks.onMechSound?.('bolt_lock', id));

        let lift = 0;
        if (u < 0.22) lift = smootherstep(u / 0.22);
        else if (u < 0.82) lift = 1;
        else lift = 1 - smootherstep((u - 0.82) / 0.18);

        let pull = 0;
        if (u >= 0.2 && u < 0.5) pull = smootherstep((u - 0.2) / 0.3);
        else if (u >= 0.5 && u < 0.82) pull = 1 - smootherstep((u - 0.5) / 0.32);

        if (rig.parts.slideOrBolt) rig.parts.slideOrBolt.position.z += pull * 0.075;
        if (rig.parts.boltHandle) rig.parts.boltHandle.rotation.z += lift * 0.95;
        if (rig.parts.chamberRound) rig.parts.chamberRound.visible = pull > 0.3;

        // Right hand smoothly cycles the bolt knob!
        if (rig.anchors.leftHandBoltOffset) {
          const handWave = Math.sin(u * Math.PI);
          const boltHand = rig.anchors.leftHandBoltOffset.clone();
          boltHand.z += pull * 0.075;
          boltHand.y += lift * 0.025;
          this.rightHandTarget.lerp(boltHand, Math.min(1, handWave * 1.35));
        }
        this.curBasePose.rootRot.z -= Math.sin(u * Math.PI) * 0.14;
        if (u >= 1) this.boltCycleKind = 'none';
      }
    }

    // ADS interpolation (frame-rate-independent exponential scope transition)
    const targetAds = ctx.scoped && !ctx.reloading ? 1 : 0;
    this.adsAlpha = expDamp(this.adsAlpha, targetAds, 16, dt);

    // Step additive sub-stepped physics springs
    const recPos = this.recoilPosSpring.step(dt, new THREE.Vector3());
    const recRot = this.recoilRotSpring.step(dt, new THREE.Vector3());
    const swayPos = this.swayPosSpring.step(dt, new THREE.Vector3());
    const swayRot = this.swayRotSpring.step(dt, new THREE.Vector3());
    const landOff = this.landingY.step(dt);
    const crouchTilt = ctx.crouching && !ctx.scoped ? -0.025 : 0;
    this.strafeRoll = expDamp(this.strafeRoll, -ctx.strafeInput * 0.042 + crouchTilt, 12, dt);

    // Clamp sway & recoil carefully to guarantee zero camera near-plane clipping
    const safeRecZ = THREE.MathUtils.clamp(recPos.z, -0.02, 0.052);
    const safeSwayX = THREE.MathUtils.clamp(swayPos.x, -0.026, 0.026);
    const safeSwayY = THREE.MathUtils.clamp(swayPos.y, -0.026, 0.026);

    const hipPos = rig.anchors.hipOffset;
    const adsPos = rig.anchors.adsOffset;
    const baseOffsetX = THREE.MathUtils.lerp(hipPos.x, adsPos.x, this.adsAlpha);
    const baseOffsetY = THREE.MathUtils.lerp(hipPos.y, adsPos.y, this.adsAlpha);
    const baseOffsetZ = THREE.MathUtils.lerp(hipPos.z, adsPos.z, this.adsAlpha);

    const bobDamp = 1 - this.adsAlpha * 0.72;

    this.outPos.set(
      baseOffsetX + (this.curBasePose.rootPos.x + safeSwayX) * bobDamp + recPos.x,
      baseOffsetY + (this.curBasePose.rootPos.y + safeSwayY + landOff) * bobDamp + recPos.y,
      baseOffsetZ + this.curBasePose.rootPos.z + safeRecZ,
    );

    const spinJitter = ctx.spinbot ? Math.sin(this.idleClock * 30) * 0.05 : 0;
    this.outRot.set(
      rig.anchors.hipRotation.x + this.curBasePose.rootRot.x * bobDamp + swayRot.x * bobDamp + recRot.x * 0.09,
      rig.anchors.hipRotation.y + this.curBasePose.rootRot.y * bobDamp + swayRot.y * bobDamp + recRot.y * 0.06 + spinJitter,
      rig.anchors.hipRotation.z + this.curBasePose.rootRot.z + (swayRot.z + this.strafeRoll) * bobDamp + recRot.z * 0.07,
    );

    this.outPivotPos.copy(this.curBasePose.pivotPos);
    this.outPivotRot.copy(this.curBasePose.pivotRot);

    // Frame-rate-independent IK hand target smoothing so rapid state interrupts never snap hands
    if (!this.handTargetsInitialized) {
      this.smoothedLeftHand.copy(this.leftHandTarget);
      this.smoothedRightHand.copy(this.rightHandTarget);
      this.smoothedLeftWeight = leftWeight;
      this.handTargetsInitialized = true;
    } else {
      const handAlpha = 1 - Math.exp(-28 * dt);
      this.smoothedLeftHand.lerp(this.leftHandTarget, handAlpha);
      this.smoothedRightHand.lerp(this.rightHandTarget, handAlpha);
      this.smoothedLeftWeight = expDamp(this.smoothedLeftWeight, leftWeight, 22, dt);
    }

    // Compute semantic left/right skeletal hand poses for rigged FPS arms
    let rightHandPose: RightHandPoseId = def.isMelee
      ? knifeSpinOpen > 0.25
        ? 'karambit_spin'
        : 'karambit_hold'
      : 'grip';
    if (this.boltCycleKind === 'bolt' && this.boltCycleClock >= 0 && this.state !== 'reload') {
      rightHandPose = 'bolt_cycle';
    }

    let leftHandPose: LeftHandPoseId = def.isMelee
      ? 'guard'
      : id === 'pistol'
        ? 'pistol_support'
        : 'foregrip';
    if (this.state === 'reload') {
      const p = THREE.MathUtils.clamp(ctx.reloadProgress, 0, 1);
      if (id === 'shotgun') {
        leftHandPose = p < 0.74 ? 'shell_load' : 'foregrip';
      } else if (p < 0.71) {
        leftHandPose = 'mag_grab';
      } else if (p < 0.92) {
        leftHandPose = 'bolt_pinch';
      }
    } else if (this.state === 'inspect') {
      const u = THREE.MathUtils.clamp(this.stateTime / this.inspectDur, 0, 1);
      if (id === 'pistol' && u >= 0.20 && u <= 0.47) {
        leftHandPose = 'bolt_pinch';
      } else if (id === 'rifle' && u >= 0.24 && u <= 0.47) {
        leftHandPose = 'mag_grab';
      } else if ((id === 'm4' || id === 'smg') && u >= 0.24 && u <= 0.47) {
        leftHandPose = 'bolt_pinch';
      } else if ((id === 'ssg' || id === 'sniper') && u >= 0.28 && u <= 0.58) {
        leftHandPose = 'mag_grab';
      }
    }

    // Compute finger articulation drivers (trigger squeeze & recoil grip tension)
    const triggerPullAlpha =
      !def.isMelee && this.shotAnimClock < 0.13
        ? Math.sin((this.shotAnimClock / 0.13) * Math.PI)
        : 0;
    const gripTightenAlpha = THREE.MathUtils.clamp(
      triggerPullAlpha * 0.75 + Math.min(1, Math.abs(recPos.z) * 18) * 0.55 + (this.state === 'melee' ? 0.65 : 0),
      0,
      1,
    );

    return {
      rootPos: this.outPos,
      rootRot: this.outRot,
      pivotPos: this.outPivotPos,
      pivotRot: this.outPivotRot,
      leftHandTarget: this.smoothedLeftHand,
      rightHandTarget: this.smoothedRightHand,
      leftHandWeight: this.smoothedLeftWeight * (1 - this.adsAlpha),
      adsAlpha: this.adsAlpha,
      triggerPullAlpha,
      gripTightenAlpha,
      knifeSpinOpenAlpha: knifeSpinOpen,
      leftHandPose,
      rightHandPose,
    };
  }
}
