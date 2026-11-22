import * as THREE from 'three';
import { WEAPONS, computeWeaponSpreadDeg, getWeaponDef } from '../data/weapons';
import { WeaponMechEvent } from '../audio/sfx';
import { BotEntity } from './bots';
import { FirstPersonCameraRig, expDamp } from './cameraRig';
import { getSculptedTorsoGeometry } from './characterModels';
import { RagdollKillKind, RagdollManager } from './ragdoll';
import { Spring1D, WEAPON_STATE_PRIORITY, WeaponAnimator, WeaponAnimContext } from './weaponAnimator';
import { createWeaponRig } from './weaponModels';

export interface FpVerifyResult {
  passed: boolean;
  totalChecks: number;
  passedChecks: number;
  details: string[];
}

function defaultCtx(overrides: Partial<WeaponAnimContext> = {}): WeaponAnimContext {
  return {
    horizSpeed: 0,
    forwardInput: 0,
    strafeInput: 0,
    grounded: true,
    velY: 0,
    crouching: false,
    reloading: false,
    reloadProgress: 0,
    reloadDuration: 2.0,
    scoped: false,
    ammo: 30,
    maxAmmo: 30,
    spinbot: false,
    fireInterval: 0.1,
    ...overrides,
  };
}

export function runFirstPersonFeelVerification(): FpVerifyResult {
  // Headless Node canvas shim for procedural weapon material textures
  if (typeof globalThis.document === 'undefined') {
    const noopCtx = new Proxy(
      {
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
        putImageData: () => {},
      },
      {
        get(target, prop) {
          if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
          return () => {};
        },
      },
    );
    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => ({
        width: 64,
        height: 64,
        getContext: () => noopCtx,
      }),
    };
  }

  const details: string[] = [];
  let totalChecks = 0;
  let passedChecks = 0;

  const check = (name: string, cond: boolean, info = '') => {
    totalChecks++;
    if (cond) {
      passedChecks++;
      details.push(`PASS: ${name}${info ? ` (${info})` : ''}`);
    } else {
      details.push(`FAIL: ${name}${info ? ` (${info})` : ''}`);
    }
  };

  // 1. Frame-rate independence of Spring1D across 20, 30, 60, 144, and 240 FPS
  {
    const fpsList = [20, 30, 60, 144, 240];
    const finalValues: number[] = [];
    const midValues: number[] = [];
    for (const fps of fpsList) {
      const s = new Spring1D(240, 22);
      s.impulse(2.4);
      const steps = Math.round(0.5 * fps);
      const dt = 0.5 / steps;
      let midVal = 0;
      for (let i = 0; i < steps; i++) {
        s.step(dt);
        if (Math.abs((i + 1) * dt - 0.1) < dt * 0.6) {
          midVal = s.value;
        }
      }
      midValues.push(midVal);
      finalValues.push(s.value);
    }
    const refMid = midValues[midValues.length - 1];
    const maxMidDiff = Math.max(...midValues.map((v) => Math.abs(v - refMid)));
    const maxFinalDiff = Math.max(...finalValues.map((v) => Math.abs(v - finalValues[finalValues.length - 1])));
    check(
      'Spring1D sub-stepped frame-rate independence (20..240 FPS)',
      maxMidDiff < 0.003 && maxFinalDiff < 0.0005,
      `maxMidDiff=${maxMidDiff.toExponential(2)}, maxFinalDiff=${maxFinalDiff.toExponential(2)}`,
    );
  }

  // 2. Frame-rate independence of expDamp across 30 FPS vs 240 FPS
  {
    let v30 = 0;
    for (let i = 0; i < 15; i++) v30 = expDamp(v30, 10, 14, 1 / 30);
    let v240 = 0;
    for (let i = 0; i < 120; i++) v240 = expDamp(v240, 10, 14, 1 / 240);
    const err = Math.abs(v30 - v240);
    check('Exact exponential damping invariance (30 FPS vs 240 FPS)', err < 1e-12, `err=${err.toExponential(2)}`);
  }

  // 3. FirstPersonCameraRig recoil & FOV frame-rate independence + footstep & landing phase events
  {
    const rig30 = new FirstPersonCameraRig(90);
    const rig240 = new FirstPersonCameraRig(90);
    rig30.onFire(0.048, 0.015);
    rig240.onFire(0.048, 0.015);

    let out30 = rig30.update({
      dt: 1 / 30,
      horizSpeed: 6.2,
      maxSpeed: 6.5,
      strafeInput: 1,
      forwardInput: 1,
      crouching: false,
      onGround: true,
      velY: 0,
      scoped: true,
      baseFov: 90,
      scopeFov: 42,
    });
    for (let i = 1; i < 15; i++) {
      out30 = rig30.update({
        dt: 1 / 30,
        horizSpeed: 6.2,
        maxSpeed: 6.5,
        strafeInput: 1,
        forwardInput: 1,
        crouching: false,
        onGround: true,
        velY: 0,
        scoped: true,
        baseFov: 90,
        scopeFov: 42,
      });
    }

    let out240 = rig240.update({
      dt: 1 / 240,
      horizSpeed: 6.2,
      maxSpeed: 6.5,
      strafeInput: 1,
      forwardInput: 1,
      crouching: false,
      onGround: true,
      velY: 0,
      scoped: true,
      baseFov: 90,
      scopeFov: 42,
    });
    for (let i = 1; i < 120; i++) {
      out240 = rig240.update({
        dt: 1 / 240,
        horizSpeed: 6.2,
        maxSpeed: 6.5,
        strafeInput: 1,
        forwardInput: 1,
        crouching: false,
        onGround: true,
        velY: 0,
        scoped: true,
        baseFov: 90,
        scopeFov: 42,
      });
    }

    const pitchDiff = Math.abs(out30.pitchOffset - out240.pitchOffset);
    const fovDiff = Math.abs(out30.fov - out240.fov);
    check(
      'FirstPersonCameraRig 30 FPS vs 240 FPS recoil & FOV invariance',
      pitchDiff < 0.001 && fovDiff < 0.01,
      `pitchDiff=${pitchDiff.toExponential(2)}, fovDiff=${fovDiff.toExponential(2)}`,
    );

    // Footstep phase synchronization & alternating parity test
    const walkRig = new FirstPersonCameraRig(90);
    const parities: number[] = [];
    for (let i = 0; i < 120; i++) {
      const o = walkRig.update({
        dt: 1 / 60,
        horizSpeed: 6.5,
        maxSpeed: 6.5,
        strafeInput: 0,
        forwardInput: 1,
        crouching: false,
        onGround: true,
        velY: 0,
        scoped: false,
        baseFov: 90,
      });
      if (o.stepTriggered) parities.push(o.stepParity);
    }
    const alternates = parities.length >= 4 && parities.every((p, idx) => idx === 0 || p !== parities[idx - 1]);
    check(
      'FirstPersonCameraRig stride-phase footstep triggers & L/R parity alternation',
      alternates,
      `steps=${parities.length}, parities=[${parities.join(',')}]`,
    );

    // Touchdown landing compression event test
    walkRig.update({
      dt: 1 / 60,
      horizSpeed: 5,
      maxSpeed: 6.5,
      strafeInput: 0,
      onGround: false,
      velY: -6.4,
      scoped: false,
      baseFov: 90,
    });
    const landOut = walkRig.update({
      dt: 1 / 60,
      horizSpeed: 5,
      maxSpeed: 6.5,
      strafeInput: 0,
      onGround: true,
      velY: 0,
      scoped: false,
      baseFov: 90,
    });
    check(
      'FirstPersonCameraRig landing impact event & vertical dip compression',
      Math.abs(landOut.landImpactSpeed - 6.4) < 1e-5 && landOut.eyeOffsetY < -0.02,
      `landImpactSpeed=${landOut.landImpactSpeed.toFixed(2)}, eyeOffsetY=${landOut.eyeOffsetY.toFixed(3)}`,
    );
  }

  // 4. WeaponAnimator Priority Hierarchy & Rapid Interruption Consistency
  {
    check(
      'Animation state priority table strictly ordered (equip > reload > melee > fire > airborne > move > idle > inspect)',
      WEAPON_STATE_PRIORITY.equip > WEAPON_STATE_PRIORITY.reload &&
        WEAPON_STATE_PRIORITY.reload > WEAPON_STATE_PRIORITY.melee &&
        WEAPON_STATE_PRIORITY.melee > WEAPON_STATE_PRIORITY.fire &&
        WEAPON_STATE_PRIORITY.fire > WEAPON_STATE_PRIORITY.airborne &&
        WEAPON_STATE_PRIORITY.airborne > WEAPON_STATE_PRIORITY.move &&
        WEAPON_STATE_PRIORITY.move > WEAPON_STATE_PRIORITY.idle &&
        WEAPON_STATE_PRIORITY.idle > WEAPON_STATE_PRIORITY.inspect,
    );

    const rifleDef = getWeaponDef('rifle');
    const rifleRig = createWeaponRig(rifleDef);
    const anim = new WeaponAnimator();
    const events: WeaponMechEvent[] = [];
    anim.setCallbacks({
      onMechSound: (ev) => events.push(ev),
    });
    anim.onEquip(rifleDef, rifleRig);

    // Step past equip
    for (let i = 0; i < 30; i++) anim.update(1 / 60, defaultCtx());
    check('WeaponAnimator transitions from equip -> idle cleanly', anim.state === 'idle');

    // Trigger inspect, step 10 frames, then interrupt with fire
    anim.triggerInspect();
    check('WeaponAnimator enters inspect state from idle', anim.state === 'inspect');
    let beforeFireOut = anim.update(1 / 60, defaultCtx());
    for (let i = 0; i < 8; i++) beforeFireOut = anim.update(1 / 60, defaultCtx());
    const handBeforeFire = beforeFireOut.leftHandTarget.clone();

    anim.onFire(false);
    const afterFireOut = anim.update(1 / 60, defaultCtx());
    const handJumpDist = afterFireOut.leftHandTarget.distanceTo(handBeforeFire);
    check(
      'WeaponAnimator fire immediately interrupts inspect without abrupt 1-frame hand IK snap',
      anim.state === 'fire' && handJumpDist < 0.04 && afterFireOut.triggerPullAlpha > 0,
      `state=${anim.state}, handDelta=${handJumpDist.toFixed(4)}, triggerPull=${afterFireOut.triggerPullAlpha.toFixed(2)}`,
    );

    // Reload start, mechanical event sequence, and reload cancellation on weapon switch / cancelReload
    events.length = 0;
    anim.onReloadStart();
    for (let i = 1; i <= 60; i++) {
      anim.update(1 / 60, defaultCtx({ reloading: true, reloadProgress: i / 60 }));
    }
    const hasAllReloadMechs =
      events.includes('mag_out') &&
      events.includes('mag_in') &&
      events.includes('bolt_pull') &&
      events.includes('bolt_release');
    check(
      'WeaponAnimator emits complete synchronized reload audio events (mag_out -> mag_in -> bolt_pull -> bolt_release)',
      hasAllReloadMechs,
      `events=[${events.join(',')}]`,
    );

    // Test mid-reload cancellation
    anim.onReloadStart();
    anim.update(1 / 60, defaultCtx({ reloading: true, reloadProgress: 0.35 }));
    anim.cancelReload(true, 5.2);
    check('WeaponAnimator cancelReload transitions cleanly to locomotion state', anim.state === 'move');

    // Test dry-fire event & impulse
    events.length = 0;
    anim.onDryFire();
    const dryOut = anim.update(1 / 60, defaultCtx({ ammo: 0 }));
    check(
      'WeaponAnimator onDryFire emits dry_fire sound and trigger squeeze',
      events.includes('dry_fire') && dryOut.triggerPullAlpha > 0,
    );
    rifleRig.dispose();
  }

  // 5. All-Weapon Stress & Camera Near-Plane Clipping Verification across 30/60/144/240 FPS
  {
    let allFinite = true;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const def of WEAPONS) {
      const rig = createWeaponRig(def);
      const anim = new WeaponAnimator();
      anim.onEquip(def, rig);

      for (let step = 0; step < 120; step++) {
        const dt = step % 4 === 0 ? 1 / 30 : step % 4 === 1 ? 1 / 60 : step % 4 === 2 ? 1 / 144 : 1 / 240;
        if (step === 25) anim.triggerInspect();
        if (step === 40) anim.onFire(step % 2 === 0);
        if (step === 65 && !def.isMelee) anim.onReloadStart();
        if (step === 95 && def.scope) anim.onScopeToggle(true);

        const reloading = !def.isMelee && step >= 65 && step < 90;
        const out = anim.update(
          dt,
          defaultCtx({
            horizSpeed: (step % 10) * 0.8,
            strafeInput: Math.sin(step * 0.2),
            forwardInput: Math.cos(step * 0.2),
            grounded: step % 17 !== 0,
            velY: step % 17 === 0 ? -4.5 : 0,
            crouching: step % 11 === 0,
            reloading,
            reloadProgress: reloading ? (step - 65) / 25 : 0,
            scoped: Boolean(def.scope && step >= 95),
            fireInterval: def.fireInterval,
          }),
        );

        const vals = [
          out.rootPos.x,
          out.rootPos.y,
          out.rootPos.z,
          out.rootRot.x,
          out.rootRot.y,
          out.rootRot.z,
          out.leftHandTarget.x,
          out.leftHandTarget.y,
          out.leftHandTarget.z,
          out.rightHandTarget.x,
          out.rightHandTarget.y,
          out.rightHandTarget.z,
          out.adsAlpha,
          out.triggerPullAlpha,
          out.gripTightenAlpha,
        ];
        if (!vals.every(Number.isFinite)) {
          allFinite = false;
        }
        minZ = Math.min(minZ, out.rootPos.z);
        maxZ = Math.max(maxZ, out.rootPos.z);
      }
      rig.dispose();
    }

    check(
      'All 8 weapons remain finite and free of camera near-plane clipping under rapid variable-FPS stress',
      allFinite && maxZ < -0.08 && minZ > -0.68,
      `zRange=[${minZ.toFixed(3)}, ${maxZ.toFixed(3)}]`,
    );
  }

  // 6. VALORANT Moving & Airborne Ballistic Spread Model
  {
    const rifle = getWeaponDef('rifle');
    const sniper = getWeaponDef('sniper');
    const m4 = getWeaponDef('m4');
    const maxRifle = 7.2 * rifle.moveSpeed;
    const maxSniper = 7.2 * sniper.moveSpeed;
    const maxM4 = 7.2 * m4.moveSpeed;

    const standRifle = computeWeaponSpreadDeg({ def: rifle, horizSpeed: 0, maxMoveSpeed: maxRifle, grounded: true, crouching: false, scoped: false, shotBloom: 0, spreadMult: 1 });
    const counterStrafeRifle = computeWeaponSpreadDeg({ def: rifle, horizSpeed: maxRifle * 0.25, maxMoveSpeed: maxRifle, grounded: true, crouching: false, scoped: false, shotBloom: 0, spreadMult: 1 });
    const runRifle = computeWeaponSpreadDeg({ def: rifle, horizSpeed: maxRifle, maxMoveSpeed: maxRifle, grounded: true, crouching: false, scoped: false, shotBloom: 0, spreadMult: 1 });
    const airRifle = computeWeaponSpreadDeg({ def: rifle, horizSpeed: maxRifle * 0.7, maxMoveSpeed: maxRifle, grounded: false, crouching: false, scoped: false, shotBloom: 0, spreadMult: 1 });
    const crouchRifle = computeWeaponSpreadDeg({ def: rifle, horizSpeed: 0, maxMoveSpeed: maxRifle, grounded: true, crouching: true, scoped: false, shotBloom: 0, spreadMult: 1 });

    const standSniper = computeWeaponSpreadDeg({ def: sniper, horizSpeed: 0, maxMoveSpeed: maxSniper, grounded: true, crouching: false, scoped: true, shotBloom: 0, spreadMult: 1 });
    const runSniper = computeWeaponSpreadDeg({ def: sniper, horizSpeed: maxSniper, maxMoveSpeed: maxSniper, grounded: true, crouching: false, scoped: true, shotBloom: 0, spreadMult: 1 });
    const airSniper = computeWeaponSpreadDeg({ def: sniper, horizSpeed: maxSniper * 0.5, maxMoveSpeed: maxSniper, grounded: false, crouching: false, scoped: true, shotBloom: 0, spreadMult: 1 });

    const runM4 = computeWeaponSpreadDeg({ def: m4, horizSpeed: maxM4, maxMoveSpeed: maxM4, grounded: true, crouching: false, scoped: false, shotBloom: 0, spreadMult: 1 });
    const cheatZero = computeWeaponSpreadDeg({ def: rifle, horizSpeed: maxRifle, maxMoveSpeed: maxRifle, grounded: false, crouching: false, scoped: false, shotBloom: 2.5, spreadMult: 0 });

    check(
      'VALORANT deadzone accuracy: stationary & counter-strafed (<=28%) have 0 move error',
      standRifle.moveErrorDeg === 0 && counterStrafeRifle.moveErrorDeg === 0 && standRifle.isAccurate && counterStrafeRifle.isAccurate && standSniper.moveErrorDeg === 0 && standSniper.isAccurate,
      `standRifle=${standRifle.totalDeg.toFixed(2)}, csRifle=${counterStrafeRifle.totalDeg.toFixed(2)}`,
    );
    check(
      'VALORANT running inaccuracy: full run heavily penalizes rifle, m4, and sniper',
      runRifle.totalDeg >= 6.5 && !runRifle.isAccurate && runM4.totalDeg >= 5.5 && !runM4.isAccurate && runSniper.totalDeg >= 9.0 && !runSniper.isAccurate,
      `runRifle=${runRifle.totalDeg.toFixed(2)}, runM4=${runM4.totalDeg.toFixed(2)}, runSniper=${runSniper.totalDeg.toFixed(2)}`,
    );
    check(
      'VALORANT jumping inaccuracy & crouch/cheat overrides behave accurately',
      airRifle.totalDeg >= 11.0 && airSniper.totalDeg >= 13.0 && crouchRifle.baseDeg < standRifle.baseDeg && cheatZero.totalDeg === 0,
      `airRifle=${airRifle.totalDeg.toFixed(2)}, airSniper=${airSniper.totalDeg.toFixed(2)}, crouchBase=${crouchRifle.baseDeg.toFixed(3)}`,
    );
  }

  // 7. Articulated Ragdoll & Corpse Physics, Anatomical Knee Safety & Resource Retention
  {
    const scene = new THREE.Scene();
    const ghostGroup = new THREE.Group();
    const bot = new BotEntity(1, scene, ghostGroup, false);
    const manager = new RagdollManager(scene, { maxCorpses: 4, corpseLifetimeSec: 15 });

    const kinds: RagdollKillKind[] = ['headshot', 'shotgun', 'explosion'];
    for (let i = 0; i < kinds.length; i++) {
      bot.spawn(new THREE.Vector3(i * 4, 0, 0), 'normal', false, false, false, 0);
      bot.flashTimer = 0.08;
      // Simulate killing-frame white flash on bodyMat to confirm snapshot uses baseBodyColor instead of #ffffff
      (bot.bodyMesh.material as THREE.MeshStandardMaterial).color.set('#ffffff');
      const snap = bot.getRagdollSnapshot();
      manager.spawnFromBot(snap, new THREE.Vector3(i * 4, 1.68, 5), kinds[i]);
    }

    for (let f = 0; f < 180; f++) {
      manager.update(1 / 60, (p, _r) => {
        p.x = THREE.MathUtils.clamp(p.x, -25, 25);
        p.z = THREE.MathUtils.clamp(p.z, -25, 25);
      });
    }

    let kneesValid = true;
    let settledOnGround = true;
    let allSleeping = true;
    for (const c of manager.corpses) {
      const [kl, kr] = c.getKneeAngles();
      if (kl < 0 || kr < 0 || !Number.isFinite(kl) || !Number.isFinite(kr)) kneesValid = false;
      if (c.pos.y < 0.12 || c.pos.y > 0.35 || !Number.isFinite(c.pos.y)) settledOnGround = false;
      if (!c.sleeping) allSleeping = false;
    }

    check(
      'Ragdoll corpses settle cleanly onto ground, sleep, and preserve positive knee flexion',
      manager.count === 3 && kneesValid && settledOnGround && allSleeping,
      `count=${manager.count}, kneesValid=${kneesValid}, settledOnGround=${settledOnGround}, sleeping=${allSleeping}`,
    );

    manager.clearAll();
    const sharedGeoIntact = (getSculptedTorsoGeometry().attributes.position?.count ?? 0) > 0;
    check(
      'RagdollManager clearAll removes all corpses without disposing shared characterModels geometries',
      manager.count === 0 && sharedGeoIntact,
    );
    manager.dispose();
    bot.dispose(scene);
  }

  // 8. All-Weapon Bespoke Inspect Choreography & Instant Interruptibility
  {
    let allInspectOk = true;
    let maxInspectZ = -Infinity;
    const missingAudio: string[] = [];

    for (const def of WEAPONS) {
      const rig = createWeaponRig(def);
      const anim = new WeaponAnimator();
      const firedEvents: WeaponMechEvent[] = [];
      anim.setCallbacks({ onMechSound: (ev) => firedEvents.push(ev) });
      anim.onEquip(def, rig);

      for (let i = 0; i < 30; i++) anim.update(1 / 60, defaultCtx({ fireInterval: def.fireInterval }));
      anim.triggerInspect();
      if (anim.state !== 'inspect') allInspectOk = false;

      let finite = true;
      for (let i = 0; i < 240; i++) {
        const out = anim.update(1 / 60, defaultCtx({ fireInterval: def.fireInterval }));
        if (!Number.isFinite(out.rootPos.z) || !Number.isFinite(out.pivotRot.y)) finite = false;
        maxInspectZ = Math.max(maxInspectZ, out.rootPos.z);
        if (i === 12 && !def.isMelee) {
          // Verify inspect yields immediately to fire interrupt
          const testAnim = new WeaponAnimator();
          testAnim.onEquip(def, rig);
          for (let k = 0; k < 30; k++) testAnim.update(1 / 60, defaultCtx());
          testAnim.triggerInspect();
          testAnim.update(1 / 60, defaultCtx());
          testAnim.onFire(false);
          if (testAnim.state !== 'fire') allInspectOk = false;
        }
      }
      if (!finite || firedEvents.length === 0) {
        allInspectOk = false;
        if (firedEvents.length === 0) missingAudio.push(def.id);
      }
      rig.dispose();
    }

    check(
      'All 8 weapons execute bespoke inspect animations cleanly, emit audio, and interrupt immediately',
      allInspectOk && maxInspectZ < -0.08 && missingAudio.length === 0,
      `maxInspectZ=${maxInspectZ.toFixed(3)}, missingAudio=[${missingAudio.join(',')}]`,
    );
  }

  return {
    passed: passedChecks === totalChecks,
    totalChecks,
    passedChecks,
    details,
  };
}
