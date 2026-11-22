import * as THREE from 'three';
import { BALANCE, BOUNTY_COLORS, BountyTier } from '../data/balance';
import { CharacterAnimState, CharacterAnimator, CharacterRigRefs } from './characterAnimator';
import {
  buildExternalCharacterAsync,
  createExternalCharacterFromAsset,
  ExternalCharacterRig,
  getCachedCharacterAssetSync,
  preloadExternalCharacterModel,
} from './externalCharacterModel';
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
  OperatorVariantId,
} from './characterModels';
import { BuiltMap, resolveCircleWallCollision } from './maps';
import { createPBRSurface } from './textures';

const BOT_NAMES = [
  'xX_Kev1n_Xx', 'Milo_TV', 'n00bMaster', 'ZackAttack', 'SniperWolf',
  'TimmyTwoTap', 'PixelPete', 'FragLina', 'Vortex99', 'ShadowByte',
  'Lukas_DE', 'KiraAim', 'GigaChad04', 'CrispyDuck', 'TacticalBrot',
  'HeadshotHansi', 'LagLord', 'NeonFox', 'SweatySam', 'Bot_Albert',
];

export interface BacktrackGhost {
  time: number;
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
}

export interface BotRagdollSnapshot {
  pos: THREE.Vector3;
  yaw: number;
  vel: THREE.Vector3;
  scale: number;
  variantId: OperatorVariantId;
  bodyColor: string;
  emissiveColor: string;
  emissiveIntensity: number;
  visorEmissive: string;
  isAdmin: boolean;
  pose: {
    pelvisY: number;
    spine: THREE.Euler;
    head: THREE.Euler;
    hipL: THREE.Euler;
    kneeL: THREE.Euler;
    hipR: THREE.Euler;
    kneeR: THREE.Euler;
    armL: THREE.Euler;
    elbowL: THREE.Euler;
    armR: THREE.Euler;
    elbowR: THREE.Euler;
  };
}

export class BotEntity {
  public id: number;
  public name: string;
  public root = new THREE.Group();
  public bodyMesh: THREE.Mesh;
  public chestRigMesh: THREE.Mesh;
  public headGroup = new THREE.Group();
  public headMesh: THREE.Mesh;
  public helmetMesh: THREE.Mesh;
  public visorMesh: THREE.Mesh;
  public headHitboxMesh: THREE.Mesh;
  public balloonMesh: THREE.Mesh;
  public chamsMesh: THREE.Mesh;
  public legL = new THREE.Group();
  public legR = new THREE.Group();
  public pelvisGroup = new THREE.Group();
  public spineGroup = new THREE.Group();
  public armL = new THREE.Group();
  public armR = new THREE.Group();
  public elbowL = new THREE.Group();
  public elbowR = new THREE.Group();
  public hipL = new THREE.Group();
  public kneeL = new THREE.Group();
  public ankleL = new THREE.Group();
  public hipR = new THREE.Group();
  public kneeR = new THREE.Group();
  public ankleR = new THREE.Group();
  public gunGroup = new THREE.Group();
  public botMuzzleFlash: THREE.Mesh;
  public adminHammer?: THREE.Mesh;
  public readonly variantId: OperatorVariantId;
  public currentLodTier: 0 | 1 | 2 = 0;
  private lod0Details: THREE.Object3D[] = [];
  private lod1Details: THREE.Object3D[] = [];
  private extraHeadVisuals: THREE.Object3D[] = [];
  public readonly animator = new CharacterAnimator();
  private animRig: CharacterRigRefs;
  public eliminating = false;
  private elimElapsed = 0;

  private outlineMat: THREE.MeshBasicMaterial;
  private outlineMeshes: THREE.Mesh[] = [];
  private bodyMat: THREE.MeshStandardMaterial;
  private headMat: THREE.MeshStandardMaterial;
  private externalChar: ExternalCharacterRig | null = null;
  private proceduralVisuals: THREE.Object3D[] = [];
  private disposed = false;
  private lastOutlineEnabled = false;
  private lastOutlineColor = '#ff3b3b';
  private lastChamsEnabled = false;
  private lastChamsColor = '#4ade80';
  private lastBalloon = false;

  public pos = new THREE.Vector3();
  public vel = new THREE.Vector3();
  public actualVel = new THREE.Vector3();
  public actualSpeed = 0;
  public yaw = 0;
  public health = 100;
  public maxHealth = 100;
  public alive = true;
  public respawnAt = 0;
  public bounty: BountyTier = 'normal';
  public isCheaterBot = false;
  public isAdmin = false;
  public isDummy = false;
  public dummyMode: 'immortal' | 'killable' | 'moving' = 'killable';
  public dummyHome = new THREE.Vector3();
  public kills = 0;
  public deaths = 0;
  public teamSide: 'attackers' | 'defenders' | null = null;
  public isFriendly = false;
  public remotePlayerId: string | null = null;

  // AI timers (all in match-elapsed seconds!)
  public wanderTarget = new THREE.Vector3();
  public nextRepath = 0;
  public nextFire = 0;
  public seenPlayerSince = 0;
  public freezeUntil = 0;
  public flashTimer = 0;
  private muzzleFlashTimer = 0;
  private gunKick = 0;
  public walkPhase = 0;
  public hopVelY = 0;
  public onGround = true;

  // Backtrack ghost history
  public ghosts: BacktrackGhost[] = [];
  private lastGhostAt = 0;
  private ghostGroup: THREE.Group;

  constructor(id: number, scene: THREE.Scene, ghostGroup: THREE.Group, isDummy = false) {
    this.id = id;
    this.name = isDummy ? `DUMMY_${id + 1}` : BOT_NAMES[id % BOT_NAMES.length];
    this.isDummy = isDummy;
    this.ghostGroup = ghostGroup;
    this.variantId = ((id & 0x7fffffff) % 4) as OperatorVariantId;

    const palette = getCharacterMaterialPalette();
    const kevlarPbr = createPBRSurface('kevlar', '#3b82f6', 1, 1);

    this.bodyMat = new THREE.MeshStandardMaterial({
      map: kevlarPbr.map,
      normalMap: kevlarPbr.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      bumpMap: kevlarPbr.bumpMap,
      bumpScale: 0.02,
      roughnessMap: kevlarPbr.roughnessMap,
      roughness: 0.76,
      metalness: 0.08,
    });
    const helmetMat = palette.helmetShell.clone();
    const visorMat = new THREE.MeshStandardMaterial({
      color: '#020617',
      roughness: 0.10,
      metalness: 0.88,
      emissive: new THREE.Color('#0ea5e9'),
      emissiveIntensity: 0.35,
    });

    this.outlineMat = new THREE.MeshBasicMaterial({
      color: '#ff3b3b',
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: true,
    });

    const addOutline = (parent: THREE.Object3D, geo: THREE.BufferGeometry, scaleVec: THREE.Vector3) => {
      const m = new THREE.Mesh(geo, this.outlineMat);
      m.scale.copy(scaleVec);
      m.renderOrder = 0;
      parent.add(m);
      this.outlineMeshes.push(m);
      return m;
    };

    // Hierarchical Skeletal Structure: root -> pelvisGroup -> (hipL/R -> knee -> ankle, spineGroup -> chest/arms/head)
    this.pelvisGroup.position.set(0, 0.78, 0);
    this.root.add(this.pelvisGroup);

    const pelvisGeo = getSculptedPelvisGeometry();
    const pelvisMesh = new THREE.Mesh(pelvisGeo, palette.pantsFabric);
    pelvisMesh.castShadow = true;
    pelvisMesh.receiveShadow = true;
    this.pelvisGroup.add(pelvisMesh);
    this.proceduralVisuals.push(pelvisMesh);

    // Two-Segment Articulated Legs with Sculpted Anatomy, Fabric Wrinkles, Curved Knee Armor & Combat Boots
    const thighGeo = getSculptedThighGeometry();
    const calfGeo = getSculptedCalfGeometry();
    const cargoPocketGeo = new THREE.CapsuleGeometry(0.028, 0.11, 4, 8);

    const setupLeg = (side: -1 | 1, hip: THREE.Group, knee: THREE.Group, ankle: THREE.Group) => {
      hip.position.set(side * 0.145, -0.06, 0);
      this.pelvisGroup.add(hip);
      this.proceduralVisuals.push(hip);

      const thigh = new THREE.Mesh(thighGeo, palette.pantsFabric);
      thigh.castShadow = true;
      thigh.receiveShadow = true;
      hip.add(thigh);
      addOutline(thigh, thighGeo, new THREE.Vector3(1.11, 1.04, 1.11));

      // Side cargo trouser pocket
      const pocket = new THREE.Mesh(cargoPocketGeo, palette.pantsFabric);
      pocket.scale.set(0.55, 1.0, 1.15);
      pocket.position.set(side * 0.096, -0.18, 0.008);
      hip.add(pocket);
      this.lod1Details.push(pocket);

      knee.position.set(0, -0.34, 0);
      hip.add(knee);

      // Curved hardshell knee armor + retention straps
      const kneePad = buildCurvedJointPad(0.088, 0.115, palette, this.lod0Details);
      knee.add(kneePad);

      const calf = new THREE.Mesh(calfGeo, palette.pantsFabric);
      calf.castShadow = true;
      calf.receiveShadow = true;
      knee.add(calf);
      addOutline(calf, calfGeo, new THREE.Vector3(1.12, 1.04, 1.12));

      ankle.position.set(0, -0.29, 0);
      knee.add(ankle);

      const boot = buildSculptedCombatBoot(palette, this.lod0Details);
      ankle.add(boot);
    };

    setupLeg(-1, this.hipL, this.kneeL, this.ankleL);
    setupLeg(1, this.hipR, this.kneeR, this.ankleR);
    this.legL = this.hipL;
    this.legR = this.hipR;

    buildSculptedBattleBeltAndHolster(
      this.pelvisGroup,
      this.hipR,
      palette,
      this.lod0Details,
      this.lod1Details,
    );
    // Track belt/holster extras attached directly to pelvisGroup so external PS1 char hides them cleanly
    for (const child of this.pelvisGroup.children) {
      if (child !== this.spineGroup && child !== this.hipL && child !== this.hipR) {
        this.proceduralVisuals.push(child);
      }
    }

    // Spine hierarchy (origin at y = 0.88 world)
    this.spineGroup.position.set(0, 0.10, 0);
    this.pelvisGroup.add(this.spineGroup);

    // Sculpted Anatomical Torso / Combat Jacket (clickable body hitbox)
    const torsoGeo = getSculptedTorsoGeometry();
    this.bodyMesh = new THREE.Mesh(torsoGeo, this.bodyMat);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.bodyMesh.userData = { bot: this, isHead: false };
    this.spineGroup.add(this.bodyMesh);
    addOutline(this.bodyMesh, torsoGeo, new THREE.Vector3(1.09, 1.04, 1.12));

    // Sculpted Plate Carrier, MOLLE Pouches, Pauldrons, Radio, Assault Pack & Whip Antenna
    const { carrierGroup, primaryCarrierMesh, antennaMesh } = buildSculptedPlateCarrierAndGear(
      this.variantId,
      palette,
      this.bodyMat,
      this.lod0Details,
      this.lod1Details,
    );
    this.chestRigMesh = primaryCarrierMesh;
    this.spineGroup.add(carrierGroup);
    this.proceduralVisuals.push(carrierGroup);
    const antenna = antennaMesh;

    // Articulated Two-Segment Arms (Shoulder -> Upper Arm -> Elbow -> Forearm -> Multi-Fingered Gloved Hand)
    const upperArmGeo = getSculptedUpperArmGeometry();
    const forearmGeo = getSculptedForearmGeometry();

    const setupArm = (side: -1 | 1, shoulder: THREE.Group, elbow: THREE.Group) => {
      shoulder.position.set(side * 0.32, 0.50, 0.02);
      this.spineGroup.add(shoulder);
      this.proceduralVisuals.push(shoulder);

      const poseGroup = new THREE.Group();
      poseGroup.rotation.set(side < 0 ? -0.92 : -0.88, side < 0 ? 0.24 : -0.16, side * 0.14);
      shoulder.add(poseGroup);

      const upperArm = new THREE.Mesh(upperArmGeo, this.bodyMat);
      upperArm.castShadow = true;
      poseGroup.add(upperArm);
      addOutline(upperArm, upperArmGeo, new THREE.Vector3(1.13, 1.05, 1.13));

      elbow.position.set(0, -0.23, 0);
      elbow.rotation.x = side < 0 ? -0.42 : -0.48;
      poseGroup.add(elbow);

      const elbowPad = buildCurvedJointPad(0.062, 0.085, palette, this.lod0Details);
      elbowPad.rotation.y = Math.PI;
      elbow.add(elbowPad);

      const forearm = new THREE.Mesh(forearmGeo, this.bodyMat);
      forearm.castShadow = true;
      elbow.add(forearm);
      addOutline(forearm, forearmGeo, new THREE.Vector3(1.13, 1.05, 1.13));

      const hand = buildSculptedGlovedHand(side, palette, this.lod0Details);
      hand.position.set(0, -0.22, 0.01);
      hand.rotation.x = -Math.PI * 0.35;
      elbow.add(hand);
    };

    setupArm(-1, this.armL, this.elbowL);
    setupArm(1, this.armR, this.elbowR);

    // Detailed Third-Person Tactical Carbine + Muzzle Flash
    this.gunGroup.position.set(0.20, 0.29, 0.30);
    this.spineGroup.add(this.gunGroup);

    const stockTube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.18, 10), palette.gunmetal);
    stockTube.rotation.x = Math.PI / 2;
    stockTube.position.set(0, 0.01, -0.22);
    const stockButt = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.085, 4, 8), palette.rubberMatte);
    stockButt.position.set(0, -0.015, -0.31);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.088, 0.36), palette.gunmetal);
    const handguard = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.28, 8), palette.rigCordura);
    handguard.rotation.x = Math.PI / 2;
    handguard.position.set(0, 0.012, 0.26);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.32, 10), palette.gunmetal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.015, 0.45);
    const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.14, 12), palette.rubberMatte);
    suppressor.rotation.x = Math.PI / 2;
    suppressor.position.set(0, 0.015, 0.56);
    const optic = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.11, 10), palette.rubberMatte);
    optic.rotation.x = Math.PI / 2;
    optic.position.set(0, 0.072, 0.02);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.16, 0.064), palette.rigCordura);
    mag.position.set(0, -0.10, 0.06);
    mag.rotation.x = 0.22;
    this.gunGroup.add(stockTube, stockButt, receiver, handguard, barrel, suppressor, optic, mag);

    this.botMuzzleFlash = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.14, 0),
      new THREE.MeshBasicMaterial({ color: '#fde047', transparent: true, opacity: 0.92 }),
    );
    this.botMuzzleFlash.position.set(0, 0.015, 0.65);
    this.botMuzzleFlash.visible = false;
    this.gunGroup.add(this.botMuzzleFlash);

    // Sculpted Head, Neck, Face, High-Cut FAST Ballistic Helmet, Comms & Panoramic Visor (y = 1.72m world)
    this.headGroup.position.set(0, 0.84, 0);
    this.spineGroup.add(this.headGroup);

    const headAssembly = buildSculptedHeadAssembly(
      this.variantId,
      palette,
      helmetMat,
      visorMat,
      this.lod0Details,
      this.lod1Details,
    );
    this.headMesh = headAssembly.headMesh;
    this.headMat = (this.headMesh.material as THREE.MeshStandardMaterial).clone();
    this.headMesh.material = this.headMat;
    this.headMesh.userData = { bot: this, isHead: true };
    this.headGroup.add(this.headMesh);
    addOutline(this.headMesh, this.headMesh.geometry, new THREE.Vector3(1.12, 1.10, 1.12));

    this.helmetMesh = headAssembly.helmetMesh;
    this.headGroup.add(this.helmetMesh);
    this.proceduralVisuals.push(this.helmetMesh);
    addOutline(this.helmetMesh, this.helmetMesh.geometry, new THREE.Vector3(1.09, 1.09, 1.09));

    this.visorMesh = headAssembly.visorMesh;
    this.headGroup.add(this.visorMesh);
    this.proceduralVisuals.push(this.visorMesh);
    this.extraHeadVisuals = headAssembly.extraHeadVisuals;
    this.proceduralVisuals.push(...this.extraHeadVisuals);

    // Expanded Head Hitbox sphere (when Hitbox Expander is active)
    this.headHitboxMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 12, 10),
      new THREE.MeshBasicMaterial({ color: '#ef4444', wireframe: true, transparent: true, opacity: 0.55 }),
    );
    this.headHitboxMesh.userData = { bot: this, isHead: true };
    this.headHitboxMesh.visible = false;
    this.headGroup.add(this.headHitboxMesh);

    // Balloon Head cosmetic
    this.balloonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 16, 12),
      new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.2, metalness: 0.15, emissive: '#991b1b', emissiveIntensity: 0.35 }),
    );
    this.balloonMesh.userData = { bot: this, isHead: true };
    this.balloonMesh.visible = false;
    this.headGroup.add(this.balloonMesh);

    // Wallhack Chams silhouette (contoured capsule matching operator height)
    const chamsMat = new THREE.MeshBasicMaterial({
      color: '#4ade80',
      transparent: true,
      opacity: 0.36,
      depthTest: false,
      depthWrite: false,
    });
    this.chamsMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.24, 6, 14), chamsMat);
    this.chamsMesh.position.set(0, 0.08, 0);
    this.chamsMesh.renderOrder = 900;
    this.chamsMesh.visible = false;
    this.spineGroup.add(this.chamsMesh);

    this.animRig = {
      pelvisGroup: this.pelvisGroup,
      spineGroup: this.spineGroup,
      headGroup: this.headGroup,
      armL: this.armL,
      armR: this.armR,
      elbowL: this.elbowL,
      elbowR: this.elbowR,
      gunGroup: this.gunGroup,
      hipL: this.hipL,
      kneeL: this.kneeL,
      ankleL: this.ankleL,
      hipR: this.hipR,
      kneeR: this.kneeR,
      ankleR: this.ankleR,
      antenna,
    };

    scene.add(this.root);

    preloadExternalCharacterModel();
    const cachedChar = getCachedCharacterAssetSync();
    if (cachedChar) {
      const ext = createExternalCharacterFromAsset(cachedChar);
      if (ext) this.attachExternalCharacter(ext);
    } else {
      void buildExternalCharacterAsync().then((ext) => {
        if (!ext) return;
        if (this.disposed) {
          ext.dispose();
          return;
        }
        this.attachExternalCharacter(ext);
      });
    }
  }

  public attachExternalCharacter(ext: ExternalCharacterRig): void {
    if (this.externalChar) {
      this.externalChar.dispose();
    }
    this.externalChar = ext;

    for (const v of this.proceduralVisuals) v.visible = false;
    for (const m of this.outlineMeshes) m.visible = false;
    this.chamsMesh.visible = false;
    (this.bodyMesh.material as THREE.Material).visible = false;
    this.headMat.visible = false;

    ext.weaponMount.add(this.gunGroup);
    this.gunGroup.position.set(0, 0, this.gunKick);
    this.gunGroup.rotation.set(0, 0, 0);
    this.root.add(ext.root);

    this.syncExternalAppearance();
    ext.setHitFlash(this.flashTimer > 0);
    ext.setCheatVisuals(
      this.lastChamsEnabled && this.alive,
      this.lastChamsColor,
      this.lastOutlineEnabled && this.alive,
      this.lastOutlineColor,
      this.lastBalloon,
    );
  }

  private syncExternalAppearance(): void {
    if (!this.externalChar) return;
    const col = this.baseBodyColor();
    const isSpecial = (!this.teamSide || !this.isFriendly) && (this.isAdmin || this.bounty !== 'normal');
    this.externalChar.setAppearance(col, isSpecial ? col : '#000000', isSpecial ? 0.42 : 0);
  }

  private updateExternalAnim(
    dt: number,
    vx: number,
    vz: number,
    alive: boolean,
    explicitState?: CharacterAnimState,
  ): void {
    if (!this.externalChar) return;
    const horizSpeed = Math.hypot(vx, vz);
    const state =
      explicitState ??
      (!alive
        ? 'eliminated'
        : !this.onGround
          ? 'airborne'
          : horizSpeed > 3.8
            ? 'run'
            : horizSpeed > 0.38
              ? 'walk'
              : 'idle');
    this.externalChar.update({
      dt,
      state,
      horizSpeed,
      pitch: 0,
      alive,
      crouching: false,
      holdWeapon: alive,
    });
  }

  public spawn(
    at: THREE.Vector3,
    bounty: BountyTier,
    cheaterBot: boolean,
    isAdmin = false,
    adminWeakened = false,
    nowSec = 0,
  ): void {
    this.pos.copy(at);
    this.pos.y = 0;
    this.vel.set(0, 0, 0);
    this.actualVel.set(0, 0, 0);
    this.actualSpeed = 0;
    this.walkPhase = 0;
    this.hopVelY = 0;
    this.onGround = true;
    this.eliminating = false;
    this.elimElapsed = 0;
    this.animator.reset();
    this.animator.update(this.animRig, {
      dt: 0.016,
      worldVelX: 0,
      worldVelZ: 0,
      velY: 0,
      yaw: this.yaw,
      yawDelta: 0,
      onGround: true,
      alive: true,
    });
    this.wanderTarget.copy(at);
    this.dummyHome.copy(at);
    this.bounty = bounty;
    this.isCheaterBot = cheaterBot;
    this.isAdmin = isAdmin;
    this.alive = true;
    this.maxHealth = isAdmin ? (adminWeakened ? 220 : 450) : this.isDummy ? 100 : BALANCE.botMaxHealth;
    this.health = this.maxHealth;
    this.seenPlayerSince = 0;
    this.freezeUntil = 0;
    this.nextRepath = nowSec + 0.35;
    this.nextFire = nowSec + 0.45 + Math.random() * 0.4;
    this.lastGhostAt = nowSec;
    this.muzzleFlashTimer = 0;
    this.botMuzzleFlash.visible = false;
    this.root.visible = true;
    this.root.position.copy(this.pos);
    this.root.scale.setScalar(isAdmin ? 1.45 : 1.0);

    const col = this.baseBodyColor();
    this.bodyMat.color.set(col);
    this.bodyMat.emissive.set(bounty === 'normal' && !isAdmin ? '#000000' : col);
    this.bodyMat.emissiveIntensity = bounty === 'normal' && !isAdmin ? 0 : 0.42;
    (this.chamsMesh.material as THREE.MeshBasicMaterial).color.set(
      isAdmin ? '#ff1e56' : bounty === 'normal' ? '#4ade80' : BOUNTY_COLORS[bounty],
    );
    this.externalChar?.reset();
    this.syncExternalAppearance();

    if (isAdmin && !this.adminHammer) {
      this.adminHammer = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.35, 0.35),
        new THREE.MeshBasicMaterial({ color: '#ff1e56' }),
      );
      this.adminHammer.position.set(0, 2.55, 0);
      this.root.add(this.adminHammer);
    }
    if (this.adminHammer) this.adminHammer.visible = isAdmin;

    this.clearGhosts();
  }

  public setRemotePlayerId(peerId: string): void {
    this.remotePlayerId = peerId;
    this.bodyMesh.userData.remotePlayerId = peerId;
    this.headMesh.userData.remotePlayerId = peerId;
    this.headHitboxMesh.userData.remotePlayerId = peerId;
    this.balloonMesh.userData.remotePlayerId = peerId;
  }

  public applyRemotePose(
    dt: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    yaw: number,
    crouching: boolean,
    grounded: boolean,
    spinVisual = false,
  ): void {
    if (!this.alive) return;
    this.tickFlash(dt);

    const prevYaw = this.yaw;
    this.pos.set(x, y, z);
    this.actualVel.set(vx, vy, vz);
    this.actualSpeed = Math.hypot(vx, vz);
    this.onGround = grounded;

    if (spinVisual) {
      this.yaw += dt * 18;
    } else {
      let diff = yaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * Math.min(1, dt * 18);
    }

    let yawDelta = this.yaw - prevYaw;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;

    const st = this.animator.update(this.animRig, {
      dt,
      worldVelX: vx,
      worldVelZ: vz,
      velY: vy,
      yaw: this.yaw,
      yawDelta,
      onGround: grounded,
      isInteracting: false,
      alive: this.alive,
    });
    this.walkPhase = this.animator.gaitPhase;

    this.root.scale.y = THREE.MathUtils.lerp(this.root.scale.y, crouching ? 0.74 : 1.0, Math.min(1, dt * 16));
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.updateExternalAnim(dt, vx, vz, this.alive, st);
  }

  /**
   * Applies authoritative AI locomotion to the 3D bot rig, driving yaw smoothly and
   * synchronizing leg animations purely to actual post-collision displacement (never moonwalking).
   */
  public applyLocomotion(
    dt: number,
    nextPos: { x: number; y: number; z: number },
    targetYaw: number,
    turnRateRadSec: number,
    spinVisual = false,
    bunnyHop = false,
    isInteracting = false,
    groundY = 0,
  ): void {
    if (!this.alive) return;
    this.tickFlash(dt);

    const prevX = this.pos.x;
    const prevZ = this.pos.z;
    const prevYaw = this.yaw;
    this.pos.x = nextPos.x;
    this.pos.z = nextPos.z;

    if (bunnyHop) {
      if (this.onGround) {
        this.hopVelY = 7.4;
        this.onGround = false;
      }
      this.hopVelY -= 22 * dt;
      this.pos.y += this.hopVelY * dt;
      if (this.pos.y <= groundY) {
        this.pos.y = groundY;
        this.hopVelY = 0;
        this.onGround = true;
      }
    } else {
      this.pos.y = groundY;
      this.hopVelY = 0;
      this.onGround = true;
    }

    const invDt = dt > 1e-4 ? 1 / dt : 0;
    const vx = (this.pos.x - prevX) * invDt;
    const vz = (this.pos.z - prevZ) * invDt;
    this.actualVel.set(vx, 0, vz);
    const instSpeed = Math.hypot(vx, vz);
    this.actualSpeed = THREE.MathUtils.lerp(this.actualSpeed, instSpeed, Math.min(1, dt * 16));

    if (spinVisual) {
      this.yaw += dt * 18;
    } else {
      let diff = targetYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const maxStep = Math.max(0.5, turnRateRadSec) * dt;
      if (Math.abs(diff) <= maxStep) {
        this.yaw = targetYaw;
      } else {
        this.yaw += Math.sign(diff) * maxStep;
      }
    }

    let yawDelta = this.yaw - prevYaw;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;

    const st = this.animator.update(this.animRig, {
      dt,
      worldVelX: vx,
      worldVelZ: vz,
      velY: this.hopVelY,
      yaw: this.yaw,
      yawDelta,
      onGround: this.onGround,
      isInteracting,
      alive: this.alive,
    });
    this.walkPhase = this.animator.gaitPhase;

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.updateExternalAnim(dt, vx, vz, this.alive, st);
  }

  public triggerHitFlinch(strength = 1.0): void {
    if (!this.alive) return;
    this.animator.triggerHitFlinch(strength);
    this.externalChar?.triggerHitFlinch(strength);
  }

  public startElimination(): void {
    this.alive = false;
    this.eliminating = true;
    this.elimElapsed = 0;
    this.botMuzzleFlash.visible = false;
    this.headHitboxMesh.visible = false;
    this.balloonMesh.visible = false;
    this.chamsMesh.visible = false;
    for (const m of this.outlineMeshes) m.visible = false;
    this.externalChar?.setCheatVisuals(false, this.lastChamsColor, false, this.lastOutlineColor, false);
    this.clearGhosts();
    this.root.visible = true;
  }

  public stepElimination(dt: number): void {
    if (!this.eliminating) return;
    this.elimElapsed += dt;
    this.animator.update(this.animRig, {
      dt,
      worldVelX: 0,
      worldVelZ: 0,
      velY: 0,
      yaw: this.yaw,
      yawDelta: 0,
      onGround: true,
      alive: false,
    });
    this.updateExternalAnim(dt, 0, 0, false, 'eliminated');
    if (this.elimElapsed >= 1.15) {
      this.eliminating = false;
      this.root.visible = false;
    }
  }

  private baseBodyColor(): string {
    if (this.teamSide) {
      if (!this.isFriendly) {
        if (this.isAdmin) return '#ff1e56';
        if (this.bounty !== 'normal') return BOUNTY_COLORS[this.bounty];
      }
      return this.teamSide === 'defenders' ? '#2563eb' : '#b45309';
    }
    if (this.isAdmin) return '#ff1e56';
    if (this.bounty !== 'normal') return BOUNTY_COLORS[this.bounty];
    return this.isCheaterBot ? '#a855f7' : '#3b82f6';
  }

  public getRagdollSnapshot(): BotRagdollSnapshot {
    const bodyColor = this.baseBodyColor();
    const hasBountyGlow = (!this.teamSide || !this.isFriendly) && (this.isAdmin || this.bounty !== 'normal');
    const visorEmissive =
      this.teamSide === 'defenders'
        ? '#38bdf8'
        : this.teamSide === 'attackers'
          ? '#f59e0b'
          : '#0ea5e9';
    return {
      pos: this.pos.clone(),
      yaw: this.yaw,
      vel: this.actualVel.clone(),
      scale: this.isAdmin ? 1.45 : 1.0,
      variantId: this.variantId,
      bodyColor,
      emissiveColor: hasBountyGlow ? bodyColor : '#000000',
      emissiveIntensity: hasBountyGlow ? 0.42 : 0,
      visorEmissive,
      isAdmin: this.isAdmin,
      pose: {
        pelvisY: this.pelvisGroup.position.y,
        spine: this.spineGroup.rotation.clone(),
        head: this.headGroup.rotation.clone(),
        hipL: this.hipL.rotation.clone(),
        kneeL: this.kneeL.rotation.clone(),
        hipR: this.hipR.rotation.clone(),
        kneeR: this.kneeR.rotation.clone(),
        armL: this.armL.rotation.clone(),
        elbowL: this.elbowL.rotation.clone(),
        armR: this.armR.rotation.clone(),
        elbowR: this.elbowR.rotation.clone(),
      },
    };
  }

  public applyTeamAppearance(side: 'attackers' | 'defenders', isFriendly: boolean): void {
    this.teamSide = side;
    this.isFriendly = isFriendly;
    const col = this.baseBodyColor();
    this.bodyMat.color.set(col);
    const hasSpecial = !isFriendly && (this.isAdmin || this.bounty !== 'normal');
    this.bodyMat.emissive.set(hasSpecial ? col : '#000000');
    this.bodyMat.emissiveIntensity = hasSpecial ? 0.38 : 0;
    (this.visorMesh.material as THREE.MeshStandardMaterial).emissive.set(
      side === 'defenders' ? '#38bdf8' : '#f59e0b',
    );
    (this.chamsMesh.material as THREE.MeshBasicMaterial).color.set(
      isFriendly
        ? '#4ade80'
        : this.isAdmin
          ? '#ff1e56'
          : this.bounty !== 'normal'
            ? BOUNTY_COLORS[this.bounty]
            : '#f87171',
    );
    this.syncExternalAppearance();
  }

  public stepSndMove(
    dt: number,
    moveTarget: THREE.Vector3 | null,
    lookTarget: THREE.Vector3 | null,
    walls: BuiltMap['walls'],
    halfX: number,
    halfZ: number,
    speed = BALANCE.botMoveSpeed,
  ): void {
    if (!this.alive) return;
    this.tickFlash(dt);

    const moveDir = new THREE.Vector3();
    if (moveTarget) {
      moveDir.subVectors(moveTarget, this.pos);
      moveDir.y = 0;
      if (moveDir.lengthSq() > 0.08) moveDir.normalize();
      else moveDir.set(0, 0, 0);
    }

    const prevPos = this.pos.clone();
    this.pos.x += moveDir.x * speed * dt;
    this.pos.z += moveDir.z * speed * dt;
    const limitX = halfX - 0.5;
    const limitZ = halfZ - 0.5;
    this.pos.x = Math.max(-limitX, Math.min(limitX, this.pos.x));
    this.pos.z = Math.max(-limitZ, Math.min(limitZ, this.pos.z));
    for (const w of walls) {
      if (this.pos.y > w.box.max.y) continue;
      const cx = Math.max(w.box.min.x, Math.min(this.pos.x, w.box.max.x));
      const cz = Math.max(w.box.min.z, Math.min(this.pos.z, w.box.max.z));
      const dx = this.pos.x - cx;
      const dz = this.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.25) {
        if (d2 > 1e-5) {
          const d = Math.sqrt(d2);
          const push = 0.5 - d;
          this.pos.x += (dx / d) * push;
          this.pos.z += (dz / d) * push;
        }
      }
    }

    if (lookTarget) {
      this.yaw = Math.atan2(lookTarget.x - this.pos.x, lookTarget.z - this.pos.z);
    } else if (moveDir.lengthSq() > 0.01) {
      this.yaw = Math.atan2(moveDir.x, moveDir.z);
    }

    if (moveDir.lengthSq() > 0.01) {
      this.walkPhase += dt * speed * 2.1;
      const sL = Math.sin(this.walkPhase);
      const cL = Math.cos(this.walkPhase);
      this.hipL.rotation.x = -sL * 0.55;
      this.hipR.rotation.x = sL * 0.55;
      this.kneeL.rotation.x = Math.max(0.06, (cL > 0 ? cL : -cL * 0.2) * 0.85);
      this.kneeR.rotation.x = Math.max(0.06, (-cL > 0 ? -cL : cL * 0.2) * 0.85);
    } else {
      this.hipL.rotation.x = -0.05;
      this.hipR.rotation.x = -0.04;
      this.kneeL.rotation.x = 0.08;
      this.kneeR.rotation.x = 0.08;
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const invDt = dt > 1e-4 ? 1 / dt : 0;
    this.updateExternalAnim(dt, (this.pos.x - prevPos.x) * invDt, (this.pos.z - prevPos.z) * invDt, this.alive);
  }

  public getHeadWorldPos(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + 1.72 * (this.isAdmin ? 1.45 : 1), this.pos.z);
  }

  public getBodyWorldPos(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + 1.05 * (this.isAdmin ? 1.45 : 1), this.pos.z);
  }

  public getMuzzleWorldPos(out = new THREE.Vector3()): THREE.Vector3 {
    if (this.externalChar && this.root.parent) {
      this.root.updateMatrixWorld(true);
      return this.botMuzzleFlash.getWorldPosition(out);
    }
    const sc = this.isAdmin ? 1.45 : 1;
    const local = new THREE.Vector3(0.28 * sc, 1.2 * sc, 0.85 * sc);
    local.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    return out.copy(this.pos).add(local);
  }

  public onFireVisual(): void {
    this.muzzleFlashTimer = 0.075;
    this.botMuzzleFlash.visible = true;
    this.botMuzzleFlash.rotation.z = Math.random() * Math.PI;
    (this.botMuzzleFlash.material as THREE.MeshBasicMaterial).color.set(
      this.isAdmin ? '#ff1e56' : this.isCheaterBot ? '#e879f9' : '#fde047',
    );
    this.gunKick = -0.08;
    this.animator.triggerFireRecoil(1.0);
    this.externalChar?.triggerFireRecoil(1.0);
  }

  public applyCheatVisuals(
    headScale: number,
    balloon: boolean,
    boxColor: string,
    chams: boolean,
    showOutlines: boolean,
    defaultOutlineColor: string,
  ): void {
    const showExpanded = headScale > 1.01;
    this.headHitboxMesh.visible = showExpanded && !balloon && this.alive;
    this.headHitboxMesh.scale.setScalar(headScale);
    (this.headHitboxMesh.material as THREE.MeshBasicMaterial).color.set(boxColor);

    this.balloonMesh.visible = balloon && this.alive;
    this.balloonMesh.scale.setScalar(headScale * 0.95);
    (this.balloonMesh.material as THREE.MeshStandardMaterial).color.set(boxColor);

    const activeOutline = showOutlines || chams;
    const oCol =
      this.teamSide
        ? (this.isFriendly
          ? '#22c55e'
          : this.isAdmin
            ? '#ff0055'
            : this.bounty !== 'normal'
              ? BOUNTY_COLORS[this.bounty]
              : defaultOutlineColor)
        : this.isAdmin ? '#ff0055' :
          this.bounty !== 'normal' ? BOUNTY_COLORS[this.bounty] :
          this.isCheaterBot ? '#d946ef' :
          defaultOutlineColor;

    const chamsCol = this.teamSide
      ? (this.isFriendly
        ? '#4ade80'
        : this.isAdmin
          ? '#ff1e56'
          : this.bounty !== 'normal'
            ? BOUNTY_COLORS[this.bounty]
            : '#f87171')
      : this.isAdmin ? '#ff1e56' : this.bounty === 'normal' ? '#4ade80' : BOUNTY_COLORS[this.bounty];

    this.lastOutlineEnabled = activeOutline;
    this.lastOutlineColor = oCol;
    this.lastChamsEnabled = chams;
    this.lastChamsColor = chamsCol;
    this.lastBalloon = balloon;

    if (this.externalChar) {
      this.chamsMesh.visible = false;
      for (const m of this.outlineMeshes) m.visible = false;
      this.externalChar.setCheatVisuals(
        chams && this.alive,
        chamsCol,
        activeOutline && this.alive,
        oCol,
        balloon && this.alive,
      );
      return;
    }

    this.headMesh.visible = !balloon;
    this.helmetMesh.visible = !balloon;
    this.visorMesh.visible = !balloon;
    for (const hv of this.extraHeadVisuals) hv.visible = !balloon;

    this.chamsMesh.visible = chams && this.alive;

    if (this.bounty !== 'rainbow') {
      this.outlineMat.color.set(oCol);
    }

    const wantDepthTest = !chams;
    if (this.outlineMat.depthTest !== wantDepthTest) {
      this.outlineMat.depthTest = wantDepthTest;
      this.outlineMat.depthWrite = wantDepthTest;
      this.outlineMat.needsUpdate = true;
    }
    for (const m of this.outlineMeshes) {
      m.visible = activeOutline && this.alive;
      m.renderOrder = chams ? 901 : 0;
    }
  }

  /**
   * 3-Tier distance Level-of-Detail (LOD 0 < 16m, LOD 1 < 34m, LOD 2 >= 34m)
   * Culls sub-centimeter micro-details at medium/long distance while preserving smooth silhouettes.
   */
  public updateLOD(cameraPos: THREE.Vector3): void {
    if (!this.alive || this.externalChar) return;
    const distSq = this.pos.distanceToSquared(cameraPos);
    const nextTier: 0 | 1 | 2 = distSq < 16 * 16 ? 0 : distSq < 34 * 34 ? 1 : 2;
    if (nextTier === this.currentLodTier) return;
    this.currentLodTier = nextTier;
    const showLod0 = nextTier === 0;
    const showLod1 = nextTier <= 1;
    for (const obj of this.lod0Details) obj.visible = showLod0;
    for (const obj of this.lod1Details) obj.visible = showLod1;
  }

  public clearGhosts(): void {
    for (const g of this.ghosts) {
      this.ghostGroup.remove(g.mesh);
      g.mesh.geometry.dispose();
      (g.mesh.material as THREE.Material).dispose();
    }
    this.ghosts = [];
  }

  public updateGhosts(nowSec: number, enabled: boolean, windowSec: number): void {
    if (!enabled || !this.alive) {
      if (this.ghosts.length > 0) this.clearGhosts();
      return;
    }
    if (nowSec - this.lastGhostAt >= 0.16) {
      this.lastGhostAt = nowSec;
      const geo = new THREE.BoxGeometry(0.68, 1.82, 0.42);
      const mat = new THREE.MeshBasicMaterial({
        color: '#22d3ee',
        transparent: true,
        opacity: 0.32,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(this.pos.x, this.pos.y + 0.92, this.pos.z);
      mesh.rotation.y = this.yaw;
      mesh.userData = { bot: this, isHead: true, isBacktrackGhost: true };
      this.ghostGroup.add(mesh);
      this.ghosts.push({ time: nowSec, pos: this.pos.clone(), mesh });
    }
    while (this.ghosts.length > 0 && nowSec - this.ghosts[0].time > windowSec) {
      const old = this.ghosts.shift()!;
      this.ghostGroup.remove(old.mesh);
      old.mesh.geometry.dispose();
      (old.mesh.material as THREE.Material).dispose();
    }
    for (const g of this.ghosts) {
      const age = (nowSec - g.time) / Math.max(0.1, windowSec);
      (g.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0.06, 0.34 * (1 - age));
    }
  }

  public getRaycastTargets(includeExpandedHead: boolean): THREE.Object3D[] {
    if (!this.alive) return [];
    const list: THREE.Object3D[] = [this.bodyMesh, this.headMesh];
    if (includeExpandedHead) {
      if (this.balloonMesh.visible) list.push(this.balloonMesh);
      else list.push(this.headHitboxMesh);
    }
    for (const g of this.ghosts) list.push(g.mesh);
    return list;
  }

  public updateDummy(dt: number, nowSec: number): void {
    if (!this.alive) {
      if (this.eliminating) this.stepElimination(dt);
      return;
    }
    const prevX = this.pos.x;
    if (this.dummyMode === 'moving') {
      this.pos.x = this.dummyHome.x + Math.sin(nowSec * 2.2) * 4.5;
    }
    const vx = dt > 1e-4 ? (this.pos.x - prevX) / dt : 0;
    const st = this.animator.update(this.animRig, {
      dt,
      worldVelX: vx,
      worldVelZ: 0,
      velY: 0,
      yaw: this.yaw,
      yawDelta: 0,
      onGround: true,
      alive: this.alive,
    });
    this.walkPhase = this.animator.gaitPhase;
    this.root.position.copy(this.pos);
    this.updateExternalAnim(dt, vx, 0, this.alive, st);
    this.tickFlash(dt);
  }

  public tickFlash(dt: number): void {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.bodyMat.color.set(this.baseBodyColor());
      }
    }
    this.externalChar?.setHitFlash(this.flashTimer > 0);
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) this.botMuzzleFlash.visible = false;
    }
    if (Math.abs(this.gunKick) > 0.001) {
      this.gunKick = THREE.MathUtils.lerp(this.gunKick, 0, Math.min(1, dt * 16));
      this.gunGroup.position.z = (this.externalChar ? 0 : 0.30) + this.gunKick;
    }
    if (this.bounty === 'rainbow' && this.alive) {
      const hue = (performance.now() * 0.0012) % 1;
      const c = new THREE.Color().setHSL(hue, 0.95, 0.55);
      this.bodyMat.color.copy(c);
      this.bodyMat.emissive.copy(c);
      (this.chamsMesh.material as THREE.MeshBasicMaterial).color.copy(c);
      this.outlineMat.color.copy(c);
      if (this.externalChar) {
        const hex = `#${c.getHexString()}`;
        this.externalChar.setAppearance(hex, hex, 0.42);
      }
    }
    if (this.adminHammer && this.isAdmin) {
      this.adminHammer.rotation.y += dt * 4;
    }
  }

  public stepAi(
    dt: number,
    nowSec: number,
    playerPos: THREE.Vector3,
    playerAlive: boolean,
    canSeePlayer: boolean,
    map: BuiltMap,
    sitePos?: THREE.Vector3,
  ): boolean {
    if (!this.alive) return false;
    this.tickFlash(dt);

    const speed =
      this.bounty === 'rainbow' ? BALANCE.botMoveSpeed * 1.95 :
      this.isAdmin ? BALANCE.botMoveSpeed * 1.45 :
      this.isCheaterBot ? BALANCE.botMoveSpeed * 1.45 :
      BALANCE.botMoveSpeed;

    let moveDir = new THREE.Vector3();

    if (sitePos && !this.isAdmin) {
      moveDir.subVectors(sitePos, this.pos);
      moveDir.y = 0;
      if (moveDir.lengthSq() > 2.2) moveDir.normalize();
      else moveDir.set(0, 0, 0);
    } else if (this.bounty === 'rainbow') {
      if (nowSec >= this.nextRepath || this.pos.distanceTo(this.wanderTarget) < 2.2) {
        this.nextRepath = nowSec + 2.2;
        const h = map.halfExtent - 3;
        this.wanderTarget.set((Math.random() * 2 - 1) * h, 0, (Math.random() * 2 - 1) * h);
      }
      moveDir.subVectors(this.wanderTarget, this.pos);
      moveDir.y = 0;
      if (moveDir.lengthSq() > 0.1) moveDir.normalize();
    } else if (canSeePlayer && playerAlive && !this.isAdmin) {
      const toPlayer = new THREE.Vector3().subVectors(playerPos, this.pos);
      toPlayer.y = 0;
      const dist = toPlayer.length();
      toPlayer.normalize();
      const strafeSign = Math.sin(nowSec * 1.7 + this.id * 2.1) > 0 ? 1 : -1;
      const perp = new THREE.Vector3(-toPlayer.z * strafeSign, 0, toPlayer.x * strafeSign);
      if (dist > 13) moveDir.addScaledVector(toPlayer, 0.7).addScaledVector(perp, 0.6);
      else if (dist < 6) moveDir.addScaledVector(toPlayer, -0.5).addScaledVector(perp, 0.8);
      else moveDir.copy(perp);
      moveDir.normalize();
    } else if (this.isAdmin && playerAlive) {
      // Admin Boss relentlessly hunts down the player
      moveDir.subVectors(playerPos, this.pos);
      moveDir.y = 0;
      if (moveDir.lengthSq() > 4) moveDir.normalize();
      else moveDir.set(0, 0, 0);
    } else {
      if (nowSec >= this.nextRepath || this.pos.distanceTo(this.wanderTarget) < 2.5) {
        this.nextRepath = nowSec + 2.0 + Math.random() * 1.8;
        if (Math.random() < 0.75 && playerAlive) {
          this.wanderTarget.set(
            playerPos.x + (Math.random() - 0.5) * 9,
            0,
            playerPos.z + (Math.random() - 0.5) * 9,
          );
        } else {
          const h = map.halfExtent - 3;
          this.wanderTarget.set((Math.random() * 2 - 1) * h, 0, (Math.random() * 2 - 1) * h);
        }
      }
      moveDir.subVectors(this.wanderTarget, this.pos);
      moveDir.y = 0;
      if (moveDir.lengthSq() > 0.1) moveDir.normalize();
    }

    const prevPos = this.pos.clone();
    this.pos.x += moveDir.x * speed * dt;
    this.pos.z += moveDir.z * speed * dt;
    resolveCircleWallCollision(this.pos, 0.5, map.walls, map.halfExtent);

    if (this.isCheaterBot) {
      if (this.onGround) {
        this.hopVelY = 7.5;
        this.onGround = false;
      }
      this.hopVelY -= 22 * dt;
      this.pos.y += this.hopVelY * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.hopVelY = 0;
        this.onGround = true;
      }
    }

    if (this.isCheaterBot) {
      this.yaw += dt * 18;
    } else if (canSeePlayer && playerAlive) {
      this.yaw = Math.atan2(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
    } else if (moveDir.lengthSq() > 0.01) {
      this.yaw = Math.atan2(moveDir.x, moveDir.z);
    }

    if (moveDir.lengthSq() > 0.01) {
      this.walkPhase += dt * speed * 2.1;
      const sL = Math.sin(this.walkPhase);
      const cL = Math.cos(this.walkPhase);
      this.hipL.rotation.x = -sL * 0.55;
      this.hipR.rotation.x = sL * 0.55;
      this.kneeL.rotation.x = Math.max(0.06, (cL > 0 ? cL : -cL * 0.2) * 0.85);
      this.kneeR.rotation.x = Math.max(0.06, (-cL > 0 ? -cL : cL * 0.2) * 0.85);
    } else {
      this.hipL.rotation.x = -0.05;
      this.hipR.rotation.x = -0.04;
      this.kneeL.rotation.x = 0.08;
      this.kneeR.rotation.x = 0.08;
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const invDt = dt > 1e-4 ? 1 / dt : 0;
    this.updateExternalAnim(dt, (this.pos.x - prevPos.x) * invDt, (this.pos.z - prevPos.z) * invDt, this.alive);

    if (canSeePlayer && playerAlive && this.bounty !== 'rainbow' && nowSec >= this.freezeUntil) {
      if (this.seenPlayerSince === 0) this.seenPlayerSince = nowSec;
      const react = this.isCheaterBot ? 0.18 : this.isAdmin ? 0.22 : 0.34;
      const fireInt = this.isCheaterBot ? 0.32 : this.isAdmin ? 0.38 : BALANCE.botFireInterval;
      if (nowSec - this.seenPlayerSince >= react && nowSec >= this.nextFire) {
        this.nextFire = nowSec + fireInt * (0.85 + Math.random() * 0.3);
        return true;
      }
    } else {
      this.seenPlayerSince = 0;
    }
    return false;
  }

  public dispose(scene: THREE.Scene): void {
    this.disposed = true;
    this.externalChar?.dispose();
    this.externalChar = null;
    this.bodyMat.dispose();
    this.headMat.dispose();
    this.outlineMat.dispose();
    this.clearGhosts();
    scene.remove(this.root);
  }
}
