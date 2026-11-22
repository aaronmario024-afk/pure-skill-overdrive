export interface CameraRigInput {
  dt: number;
  horizSpeed: number;
  maxSpeed: number;
  strafeInput: number;
  forwardInput?: number;
  crouching?: boolean;
  onGround: boolean;
  velY: number;
  scoped: boolean;
  baseFov: number;
  scopeFov?: number;
}

export interface CameraRigOutput {
  eyeOffsetY: number;
  offsetX: number;
  pitchOffset: number;
  yawOffset: number;
  rollOffset: number;
  fov: number;
  stepTriggered: boolean;
  stepParity: number;
  landImpactSpeed: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

export function expDamp(cur: number, target: number, lambda: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}

export class FirstPersonCameraRig {
  private bobPhase = 0;
  private idleClock = 0;
  private wasOnGround = true;
  private prevVelY = 0;
  private stepParity = 0;

  private bobWeight = 0;
  private currentRoll = 0;
  private forwardPitch = 0;
  private landDip = 0;
  private landPitch = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private recoilVelPitch = 0;
  private flinchRoll = 0;
  private currentFov = 82;

  constructor(initialFov = 82) {
    this.currentFov = initialFov;
  }

  public onFire(pitchKick: number, yawKick: number): void {
    this.recoilVelPitch += clamp(pitchKick, 0.004, 0.095) * 14;
    this.recoilPitch = clamp(this.recoilPitch + pitchKick * 0.42, 0, 0.14);
    this.recoilYaw = clamp(this.recoilYaw + yawKick * 0.55, -0.06, 0.06);
  }

  public onHitFlinch(strength = 1.0): void {
    const dir = this.flinchRoll >= 0 ? -1 : 1;
    this.flinchRoll = clamp(this.flinchRoll + dir * 0.032 * strength, -0.065, 0.065);
    this.recoilPitch = clamp(this.recoilPitch + 0.014 * strength, 0, 0.14);
  }

  public onLand(impactSpeed: number): void {
    const mag = clamp(impactSpeed * 0.015, 0.015, 0.13);
    this.landDip = Math.max(this.landDip, mag);
    this.landPitch = Math.max(this.landPitch, mag * 0.28);
  }

  public reset(baseFov = 82): void {
    this.bobPhase = 0;
    this.bobWeight = 0;
    this.currentRoll = 0;
    this.forwardPitch = 0;
    this.landDip = 0;
    this.landPitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilVelPitch = 0;
    this.flinchRoll = 0;
    this.wasOnGround = true;
    this.prevVelY = 0;
    this.stepParity = 0;
    this.currentFov = baseFov;
  }

  public update(input: CameraRigInput): CameraRigOutput {
    const dt = clamp(input.dt, 0.0002, 0.08);
    this.idleClock += dt;

    // Detect touchdown impact seamlessly
    let landImpactSpeed = 0;
    if (!this.wasOnGround && input.onGround && this.prevVelY < -2.2) {
      landImpactSpeed = Math.abs(this.prevVelY);
      this.onLand(landImpactSpeed);
    }
    this.wasOnGround = input.onGround;
    this.prevVelY = input.velY;

    const speedRatio = clamp(input.horizSpeed / Math.max(0.5, input.maxSpeed), 0, 1.35);
    const groundMoving = input.onGround ? speedRatio : 0;
    this.bobWeight = expDamp(this.bobWeight, groundMoving, 12, dt);

    let stepTriggered = false;
    if (this.bobWeight > 0.02) {
      const prevPhase = this.bobPhase;
      const phaseRate = (6.2 + speedRatio * 4.4) * (input.crouching ? 0.82 : 1.0);
      const nextPhaseUnwrapped = prevPhase + dt * phaseRate;
      this.bobPhase = nextPhaseUnwrapped % (Math.PI * 2);

      // Footstep plants occur at the two vertical troughs of sin(2 * bobPhase), i.e. 3*PI/4 and 7*PI/4
      if (input.onGround && this.bobWeight > 0.22 && speedRatio > 0.18) {
        const troughA = Math.PI * 0.75;
        const troughB = Math.PI * 1.75;
        const crossedA =
          (prevPhase < troughA && nextPhaseUnwrapped >= troughA) ||
          (prevPhase < troughA + Math.PI * 2 && nextPhaseUnwrapped >= troughA + Math.PI * 2);
        const crossedB =
          (prevPhase < troughB && nextPhaseUnwrapped >= troughB) ||
          (prevPhase < troughB + Math.PI * 2 && nextPhaseUnwrapped >= troughB + Math.PI * 2);
        if (crossedA || crossedB) {
          stepTriggered = true;
          this.stepParity = (this.stepParity + 1) % 2;
        }
      }
    }

    // ADS & crouch reduce camera bob & roll significantly for precision aiming
    const crouchScale = input.crouching ? 0.58 : 1.0;
    const adsScale = (input.scoped ? 0.25 : 1.0) * crouchScale;

    // Natural subtle breathing + figure-eight stride bob
    const breathPitch = Math.sin(this.idleClock * 1.85) * 0.0015 * adsScale;
    const bobVert = Math.sin(this.bobPhase * 2) * 0.024 * this.bobWeight * adsScale;
    const bobHoriz = Math.cos(this.bobPhase) * 0.014 * this.bobWeight * adsScale;
    const bobRoll = Math.cos(this.bobPhase) * 0.004 * this.bobWeight * adsScale;

    // Tactile landing spring recovery
    this.landDip = expDamp(this.landDip, 0, 13.5, dt);
    this.landPitch = expDamp(this.landPitch, 0, 15.5, dt);

    // Subtle forward/backward acceleration pitch & lateral strafe bank
    const targetFwdPitch = -clamp(input.forwardInput ?? 0, -1, 1) * 0.0045 * adsScale;
    this.forwardPitch = expDamp(this.forwardPitch, targetFwdPitch, 11, dt);

    const targetRoll = -clamp(input.strafeInput, -1, 1) * 0.015 * adsScale + this.flinchRoll + bobRoll;
    this.currentRoll = expDamp(this.currentRoll, targetRoll, 13, dt);
    this.flinchRoll = expDamp(this.flinchRoll, 0, 11.5, dt);

    // Sub-stepped second-order damped camera recoil kick (100% frame-rate-independent across 20..240 FPS)
    const stiffness = 135;
    const damping = 22;
    const maxSubStep = 1 / 240;
    let rem = dt;
    while (rem > 1e-6) {
      const h = rem > maxSubStep ? maxSubStep : rem;
      const accel = -stiffness * this.recoilPitch - damping * this.recoilVelPitch;
      this.recoilVelPitch += accel * h;
      this.recoilPitch = Math.max(-0.02, this.recoilPitch + this.recoilVelPitch * h);
      rem -= h;
    }
    this.recoilYaw = expDamp(this.recoilYaw, 0, 14, dt);

    // Dynamic FOV (subtle widen at high speed, smooth scope zoom)
    const sprintKick = !input.scoped && input.onGround && speedRatio > 0.85 ? (speedRatio - 0.85) * 3.6 : 0;
    const targetFov = input.scoped ? (input.scopeFov ?? Math.min(48, input.baseFov * 0.48)) : input.baseFov + sprintKick;
    this.currentFov = expDamp(this.currentFov, targetFov, input.scoped ? 18 : 11, dt);

    return {
      eyeOffsetY: bobVert - this.landDip,
      offsetX: bobHoriz,
      pitchOffset: breathPitch + this.forwardPitch + this.recoilPitch - this.landPitch,
      yawOffset: this.recoilYaw,
      rollOffset: this.currentRoll,
      fov: this.currentFov,
      stepTriggered,
      stepParity: this.stepParity,
      landImpactSpeed,
    };
  }
}
