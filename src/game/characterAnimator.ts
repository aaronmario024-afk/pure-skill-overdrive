import * as THREE from 'three';

export type CharacterAnimState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'strafe_left'
  | 'strafe_right'
  | 'backpedal'
  | 'turn_in_place'
  | 'airborne'
  | 'land'
  | 'interact'
  | 'eliminated';

export interface CharacterRigRefs {
  pelvisGroup: THREE.Group;
  spineGroup: THREE.Group;
  headGroup: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  elbowL?: THREE.Group;
  elbowR?: THREE.Group;
  gunGroup: THREE.Group;
  hipL: THREE.Group;
  kneeL: THREE.Group;
  ankleL: THREE.Group;
  hipR: THREE.Group;
  kneeR: THREE.Group;
  ankleR: THREE.Group;
  antenna?: THREE.Object3D;
}

export interface CharacterMotionInput {
  dt: number;
  worldVelX: number;
  worldVelZ: number;
  velY: number;
  yaw: number;
  yawDelta: number;
  pitch?: number;
  onGround: boolean;
  isInteracting?: boolean;
  alive: boolean;
}

interface PoseTarget {
  pelvisY: number;
  pelvisTiltX: number;
  pelvisTiltZ: number;
  pelvisRollY: number;
  spinePitch: number;
  spineYaw: number;
  spineRollZ: number;
  headPitch: number;
  headYaw: number;
  armLPitch: number;
  armLYaw: number;
  armRPitch: number;
  armRYaw: number;
  gunPitch: number;
  hipLPitch: number;
  hipLRoll: number;
  kneeLPitch: number;
  ankleLPitch: number;
  hipRPitch: number;
  hipRRoll: number;
  kneeRPitch: number;
  ankleRPitch: number;
}

const ZERO_POSE: PoseTarget = {
  pelvisY: 0.78,
  pelvisTiltX: 0,
  pelvisTiltZ: 0,
  pelvisRollY: 0,
  spinePitch: 0,
  spineYaw: 0,
  spineRollZ: 0,
  headPitch: 0,
  headYaw: 0,
  armLPitch: 0.35,
  armLYaw: 0.14,
  armRPitch: 0.38,
  armRYaw: -0.1,
  gunPitch: 0,
  hipLPitch: 0,
  hipLRoll: 0,
  kneeLPitch: 0,
  ankleLPitch: 0,
  hipRPitch: 0,
  hipRRoll: 0,
  kneeRPitch: 0,
  ankleRPitch: 0,
};

function lerpVal(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

export class CharacterAnimator {
  public state: CharacterAnimState = 'idle';
  public previousState: CharacterAnimState = 'idle';
  public gaitPhase = 0;
  public stateTime = 0;

  private idleClock = Math.random() * 6.28;
  private wasOnGround = true;
  private landTimer = 0;
  private smoothedYawRate = 0;
  private fireRecoil = 0;
  private hitFlinch = 0;
  private hitDir = 1;
  private deathProgress = 0;
  private deathSide = 1;
  private pose: PoseTarget = { ...ZERO_POSE };

  public triggerFireRecoil(strength = 1.0): void {
    this.fireRecoil = clamp(this.fireRecoil + 0.18 * strength, 0, 0.32);
  }

  public triggerHitFlinch(strength = 1.0): void {
    this.hitFlinch = clamp(this.hitFlinch + 0.28 * strength, 0, 0.42);
    this.hitDir = this.hitDir * -1;
  }

  public reset(): void {
    this.state = 'idle';
    this.previousState = 'idle';
    this.gaitPhase = 0;
    this.stateTime = 0;
    this.wasOnGround = true;
    this.landTimer = 0;
    this.smoothedYawRate = 0;
    this.fireRecoil = 0;
    this.hitFlinch = 0;
    this.deathProgress = 0;
    this.deathSide = Math.random() > 0.5 ? 1 : -1;
    this.pose = { ...ZERO_POSE };
  }

  public getDeathProgress(): number {
    return this.deathProgress;
  }

  private transitionTo(next: CharacterAnimState): void {
    if (next === this.state) return;
    this.previousState = this.state;
    this.state = next;
    this.stateTime = 0;
  }

  private classifyState(input: CharacterMotionInput, fwdSpeed: number, strafeSpeed: number, horizSpeed: number): CharacterAnimState {
    if (!input.alive) return 'eliminated';
    if (!input.onGround) return 'airborne';
    if (this.landTimer > 0) return 'land';
    if (input.isInteracting && horizSpeed < 1.3) return 'interact';
    if (horizSpeed < 0.38) {
      return Math.abs(this.smoothedYawRate) > 1.35 ? 'turn_in_place' : 'idle';
    }
    if (fwdSpeed < -0.9 && Math.abs(fwdSpeed) >= Math.abs(strafeSpeed) * 0.8) {
      return 'backpedal';
    }
    if (Math.abs(strafeSpeed) > Math.abs(fwdSpeed) * 1.1) {
      return strafeSpeed > 0 ? 'strafe_right' : 'strafe_left';
    }
    return horizSpeed > 3.8 ? 'run' : 'walk';
  }

  public update(rig: CharacterRigRefs | null, input: CharacterMotionInput): CharacterAnimState {
    const dt = clamp(input.dt, 0.0005, 0.08);
    this.idleClock += dt;
    this.stateTime += dt;

    // Ground contact / landing cushion detection
    if (!this.wasOnGround && input.onGround && input.alive) {
      this.landTimer = 0.24;
    }
    this.wasOnGround = input.onGround;
    if (this.landTimer > 0) {
      this.landTimer = Math.max(0, this.landTimer - dt);
    }

    // Transform world velocity into character local facing coordinates (+sin(yaw), +cos(yaw) forward in BotEntity +Z space)
    const sinY = Math.sin(input.yaw);
    const cosY = Math.cos(input.yaw);
    const fwdX = sinY;
    const fwdZ = cosY;
    const rightX = -cosY;
    const rightZ = sinY;

    const fwdSpeed = input.worldVelX * fwdX + input.worldVelZ * fwdZ;
    const strafeSpeed = input.worldVelX * rightX + input.worldVelZ * rightZ;
    const horizSpeed = Math.hypot(input.worldVelX, input.worldVelZ);

    const yawRate = clamp(input.yawDelta / dt, -14, 14);
    this.smoothedYawRate = lerpVal(this.smoothedYawRate, yawRate, 1 - Math.exp(-12 * dt));

    const nextState = this.classifyState(input, fwdSpeed, strafeSpeed, horizSpeed);
    this.transitionTo(nextState);

    // Secondary impulses decay smoothly
    this.fireRecoil *= Math.exp(-16 * dt);
    this.hitFlinch *= Math.exp(-10 * dt);

    // Advance phase deterministically according to locomotion speed
    if (this.state === 'walk' || this.state === 'run' || this.state === 'backpedal' || this.state === 'strafe_left' || this.state === 'strafe_right') {
      const sign = this.state === 'backpedal' ? -1 : 1;
      const cadence = clamp(horizSpeed * 2.1, 3.0, 14.5);
      this.gaitPhase = (this.gaitPhase + sign * cadence * dt) % (Math.PI * 2);
      if (this.gaitPhase < 0) this.gaitPhase += Math.PI * 2;
    } else if (this.state === 'turn_in_place') {
      this.gaitPhase = (this.gaitPhase + Math.abs(this.smoothedYawRate) * 2.6 * dt) % (Math.PI * 2);
    }

    const target: PoseTarget = { ...ZERO_POSE };
    const breath = Math.sin(this.idleClock * 2.1);

    if (this.state === 'eliminated') {
      this.deathProgress = clamp(this.deathProgress + dt / 0.68, 0, 1);
      const ease = 1 - Math.pow(1 - this.deathProgress, 2.2);
      target.pelvisY = lerpVal(0.78, 0.16, ease);
      target.pelvisTiltX = 1.38 * ease;
      target.pelvisRollY = 0.25 * this.deathSide * ease;
      target.pelvisTiltZ = 0.28 * this.deathSide * ease;
      target.spinePitch = 0.24 * ease;
      target.headPitch = -0.25 * ease;
      target.armLPitch = lerpVal(0.35, -0.55, ease);
      target.armRPitch = lerpVal(0.38, -0.45, ease);
      target.kneeLPitch = 0.72 * ease;
      target.kneeRPitch = 0.35 * ease;
    } else if (this.state === 'idle') {
      target.pelvisY = 0.78 + breath * 0.006;
      target.spinePitch = 0.03 + breath * 0.014;
      target.spineYaw = 0.06; // Tactical bladed stance
      target.hipLPitch = 0.05;
      target.kneeLPitch = 0.10;
      target.ankleLPitch = -0.05;
      target.hipRPitch = 0.04;
      target.kneeRPitch = 0.08;
      target.ankleRPitch = -0.04;
      target.armLPitch = 0.36 + breath * 0.015;
      target.armRPitch = 0.39 + breath * 0.015;
    } else if (this.state === 'walk' || this.state === 'run' || this.state === 'backpedal') {
      const isRun = this.state === 'run';
      const amp = isRun ? 0.78 : this.state === 'backpedal' ? 0.44 : 0.56;
      const pL = this.gaitPhase;
      const pR = this.gaitPhase + Math.PI;
      const sL = Math.sin(pL);
      const sR = Math.sin(pR);
      const cL = Math.cos(pL);
      const cR = Math.cos(pR);

      // Two-segment leg swing + knee bend ONLY during forward swing lift (negative c when swinging forward)
      target.hipLPitch = sL * amp;
      target.kneeLPitch = Math.max(0.06, (cL > 0 ? cL : -cL * 0.2) * (isRun ? 1.15 : 0.82));
      target.ankleLPitch = -sL * 0.22 - target.kneeLPitch * 0.35;

      target.hipRPitch = sR * amp;
      target.kneeRPitch = Math.max(0.06, (cR > 0 ? cR : -cR * 0.2) * (isRun ? 1.15 : 0.82));
      target.ankleRPitch = -sR * 0.22 - target.kneeRPitch * 0.35;

      // Double-frequency vertical stride bob + subtle weight shift
      const bob = Math.abs(Math.sin(this.gaitPhase));
      target.pelvisY = 0.78 - (1 - bob) * (isRun ? 0.055 : 0.03);
      target.pelvisTiltX = isRun ? 0.11 : this.state === 'backpedal' ? -0.06 : 0.05;
      target.pelvisTiltZ = sL * (isRun ? 0.045 : 0.025);

      // Upper torso stays weapon-stabilized with slight counter-twist
      target.spinePitch = isRun ? 0.12 : 0.05;
      target.spineYaw = -sL * (isRun ? 0.09 : 0.05);
      target.armLPitch = (isRun ? 0.48 : 0.38) + sR * 0.05;
      target.armRPitch = (isRun ? 0.50 : 0.40) + sR * 0.05;
      target.gunPitch = isRun ? -0.14 : -0.04;
    } else if (this.state === 'strafe_left' || this.state === 'strafe_right') {
      const dir = this.state === 'strafe_right' ? 1 : -1;
      const s = Math.sin(this.gaitPhase);
      const absS = Math.abs(s);

      target.hipLRoll = dir * s * 0.34;
      target.hipRRoll = -dir * s * 0.34;
      target.hipLPitch = 0.12 + absS * 0.18;
      target.hipRPitch = 0.12 + (1 - absS) * 0.18;
      target.kneeLPitch = 0.22 + Math.max(0, s) * 0.45;
      target.kneeRPitch = 0.22 + Math.max(0, -s) * 0.45;
      target.pelvisY = 0.75 + absS * 0.025;
      target.pelvisTiltZ = -dir * 0.08;
      target.spineRollZ = dir * 0.07; // Keep head/aim level while hips strafe
      target.spinePitch = 0.08;
    } else if (this.state === 'turn_in_place') {
      const step = Math.sin(this.gaitPhase);
      const sgn = this.smoothedYawRate >= 0 ? 1 : -1;
      target.pelvisRollY = step * 0.07 * sgn;
      target.hipLPitch = step * 0.18;
      target.hipRPitch = -step * 0.18;
      target.kneeLPitch = 0.18 + Math.max(0, step) * 0.28;
      target.kneeRPitch = 0.18 + Math.max(0, -step) * 0.28;
      target.pelvisY = 0.76 + Math.abs(step) * 0.015;
    } else if (this.state === 'airborne') {
      const rise = clamp(input.velY * 0.06, -0.35, 0.35);
      target.pelvisY = 0.81 + rise * 0.04;
      target.hipLPitch = 0.36;
      target.kneeLPitch = 0.68;
      target.ankleLPitch = 0.28;
      target.hipRPitch = -0.14;
      target.kneeRPitch = 0.42;
      target.ankleRPitch = 0.22;
      target.spinePitch = 0.10 - rise * 0.12;
      target.armLPitch = 0.48;
      target.armRPitch = 0.48;
    } else if (this.state === 'land') {
      const k = Math.sin((this.landTimer / 0.24) * Math.PI);
      target.pelvisY = 0.78 - k * 0.12;
      target.hipLPitch = 0.35 * k;
      target.kneeLPitch = 0.72 * k;
      target.ankleLPitch = -0.32 * k;
      target.hipRPitch = 0.35 * k;
      target.kneeRPitch = 0.72 * k;
      target.ankleRPitch = -0.32 * k;
      target.spinePitch = 0.16 * k;
    } else if (this.state === 'interact') {
      const sway = Math.sin(this.idleClock * 5.2);
      target.pelvisY = 0.66;
      target.pelvisTiltX = 0.24;
      target.spinePitch = 0.26;
      target.hipLPitch = 0.44;
      target.kneeLPitch = 0.76;
      target.hipRPitch = 0.22;
      target.kneeRPitch = 0.56;
      target.armLPitch = 0.75 + sway * 0.06;
      target.armRPitch = 0.72 - sway * 0.06;
      target.gunPitch = -0.38;
    }

    // Apply aim pitch, weapon fire recoil, and hit flinch cleanly on upper body
    if (this.state !== 'eliminated') {
      const aimPitch = clamp(input.pitch ?? 0, -0.75, 0.75);
      target.headPitch += aimPitch * 0.45 - this.hitFlinch * 0.75;
      target.spinePitch += aimPitch * 0.25 - this.hitFlinch * 0.45 + this.fireRecoil * 0.35;
      target.spineRollZ += this.hitFlinch * this.hitDir * 0.35;
      target.armLPitch += aimPitch * 0.6 + this.fireRecoil * 0.65;
      target.armRPitch += aimPitch * 0.6 + this.fireRecoil * 0.65;
      target.gunPitch += this.fireRecoil * 0.85;
    }

    // Smooth exponential joint blending across every degree of freedom
    const blendRate = this.state === 'eliminated' ? 18 : this.state === 'land' ? 24 : 14;
    const alpha = 1 - Math.exp(-blendRate * dt);
    (Object.keys(target) as (keyof PoseTarget)[]).forEach((k) => {
      this.pose[k] = lerpVal(this.pose[k], target[k], alpha);
    });

    if (rig) {
      rig.pelvisGroup.position.y = this.pose.pelvisY;
      rig.pelvisGroup.rotation.set(this.pose.pelvisTiltX, this.pose.pelvisRollY, this.pose.pelvisTiltZ);

      rig.spineGroup.rotation.set(this.pose.spinePitch, this.pose.spineYaw, this.pose.spineRollZ);
      rig.headGroup.rotation.set(this.pose.headPitch, this.pose.headYaw, 0);

      rig.armL.rotation.set(this.pose.armLPitch, this.pose.armLYaw, 0);
      rig.armR.rotation.set(this.pose.armRPitch, this.pose.armRYaw, 0);
      if (rig.elbowL && rig.elbowR) {
        const elbowFlex = (this.state === 'run' ? -0.16 : -0.04) - this.fireRecoil * 0.45;
        rig.elbowL.rotation.x = -0.42 + elbowFlex;
        rig.elbowR.rotation.x = -0.48 + elbowFlex;
      }
      rig.gunGroup.rotation.x = this.pose.gunPitch;

      // In BotEntity (+Z forward, -Y down):
      // - Negative X rotation swings a downward segment FORWARD (+Z, thigh flexion)
      // - Positive X rotation swings a downward segment BACKWARD (-Z, natural knee flexion)
      rig.hipL.rotation.set(-this.pose.hipLPitch, 0, this.pose.hipLRoll);
      rig.kneeL.rotation.x = Math.max(0, this.pose.kneeLPitch);
      rig.ankleL.rotation.x = this.pose.ankleLPitch;

      rig.hipR.rotation.set(-this.pose.hipRPitch, 0, this.pose.hipRRoll);
      rig.kneeR.rotation.x = Math.max(0, this.pose.kneeRPitch);
      rig.ankleR.rotation.x = this.pose.ankleRPitch;

      if (rig.antenna) {
        const swayMag = clamp(horizSpeed * 0.04, 0, 0.25);
        rig.antenna.rotation.x = -swayMag + Math.sin(this.gaitPhase) * swayMag * 0.5;
        rig.antenna.rotation.z = Math.cos(this.gaitPhase * 0.5) * 0.08 + this.smoothedYawRate * 0.02;
      }
    }

    return this.state;
  }
}
