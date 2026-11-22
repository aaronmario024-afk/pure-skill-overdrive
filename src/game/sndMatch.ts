import * as THREE from 'three';
import { AcousticEnvState, probeAcousticEnvironment } from '../audio/acoustics';
import { sfx } from '../audio/sfx';
import { ART_STYLES, BALANCE, BOUNTY_COLORS, BOUNTY_PAY, formatMoney, formatMoneyWhole } from '../data/balance';
import { getSkin } from '../data/skins';
import { computeWeaponSpreadDeg, getWeaponDef, sampleSpreadOffsets, WeaponDef } from '../data/weapons';
import { ActiveCheatMods, MatchPayLine, MatchResult, store } from '../state/store';
import { applyCustomLightingToScene, buildCustomSndMap } from '../editor/customMapBuilder';
import { bakeCustomMapNavigation } from '../editor/navAndValidation';
import { CustomMapLaunchConfig } from '../editor/types';
import { BotEntity } from './bots';
import { updateCamoClock } from './camoTextures';
import { WallType } from './maps';
import { RagdollKillKind, RagdollManager } from './ragdoll';
import {
  canSndPierceWall,
  computeSndBotHitChance,
  computeSndFireInterval,
  computeSndKillPayout,
  computeSndMagSize,
  computeSndMovementParams,
  computeSndPiggyDeposit,
  computeSndShotDamage,
  rollSndEnemyBounty,
} from './sndCheatHelpers';
import {
  buildSndMap,
  BuiltSndMap,
  resolveCircleWallCollisionRect,
  SndMapId,
} from './sndMaps';
import {
  AiCombatantInput,
  AiDebugVisualizer,
  BOT_DIFFICULTIES,
  BotAIManager,
  NavGrid,
  navWallsFromBoxes,
  SndModeAdapter,
  WorldQueryApi,
} from './ai/index';
import {
  BombState,
  SndMatchAuthority,
  SndPlayerState,
  SndRules,
  TeamId,
  TeamSide,
} from './sndEngine';
import { createSndEnvironmentMap, createSndSkyDome } from './textures';
import { expDamp, FirstPersonCameraRig } from './cameraRig';
import { ViewModelController } from './viewmodel';

const BOT_CALLSIGNS = [
  'Vortex', 'Milo', 'Ghost', 'Kira', 'Astra', 'Volt', 'Spectre', 'Reaper', 'Apex_DE', 'Raven',
];

interface TracerFx {
  line: THREE.Line;
  dieAt: number;
}

interface ShellFx {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  dieAt: number;
  isShotgun: boolean;
  bounceCount: number;
  lastBounceAt: number;
}

interface ExplosionFx {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  born: number;
  life: number;
  maxRadius: number;
}

function resolveKillKind(def: WeaponDef, isHead: boolean, isExplosion: boolean): RagdollKillKind {
  if (isExplosion) return 'explosion';
  if (def.isMelee) return 'melee';
  if (isHead) return 'headshot';
  if (def.id === 'shotgun') return 'shotgun';
  if (def.id === 'sniper' || def.id === 'ssg') return 'sniper';
  return 'body';
}

interface BotAiActor {
  playerId: string;
  entity: BotEntity;
}

export class SndMatchController {
  private container: HTMLElement;
  private onExitToHub: () => void;
  private customMap: CustomMapLaunchConfig | null = null;
  private mods: ActiveCheatMods;
  private authority: SndMatchAuthority;
  private map: BuiltSndMap;

  // Three.js core
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private viewModel: ViewModelController;
  private cameraRig: FirstPersonCameraRig;
  private ragdolls: RagdollManager;
  private fxGroup = new THREE.Group();
  private ghostGroup = new THREE.Group();
  private raycaster = new THREE.Raycaster();

  // 3D Bomb & C4 Explosion FX
  private bombGroup = new THREE.Group();
  private bombLed: THREE.Mesh;
  private bombRing: THREE.Mesh;
  private bombExplosion: { mesh: THREE.Mesh; light: THREE.PointLight; age: number } | null = null;
  private nextBombBeepAt = 0;

  // Botanical / Tactical FX
  private tracers: TracerFx[] = [];
  private decals: THREE.Mesh[] = [];
  private casings: ShellFx[] = [];
  private dmgIndicators: { from: THREE.Vector3; until: number }[] = [];

  // Bot actors (9 bots for 5v5)
  private botActors = new Map<string, BotAiActor>();
  private aiManager!: BotAIManager;
  private aiDebug!: AiDebugVisualizer;
  private roundTargetSite: 'A' | 'B' = 'A';

  // Local Human Player State
  private readonly humanId = 'you';
  private pos = new THREE.Vector3(0, 0, 28);
  private vel = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private fovKick = 0;
  private eyeHeight = 1.68;
  private grounded = true;
  private crouching = false;
  private forwardInput = 0;
  private strafeInput = 0;
  private hopChain = 0;
  private hopGrace = 0;

  // Weapons & shooting
  private slots: { def: WeaponDef; ammo: number }[] = [];
  private slotIdx = 0;
  private nextFireAt = 0;
  private reloading = false;
  private reloadStart = 0;
  private reloadEnd = 0;
  private scoped = false;
  private firingHeld = false;
  private fireBufferUntil = 0;
  private shotBloom = 0;
  private crosshairSpreadPx = 0;
  private currentAcousticEnv: AcousticEnvState = {
    zone: 'outdoor_urban',
    enclosure: 0.35,
    wallProximity: 0.25,
    earlyGain: 0.34,
    reverbSend: 0.32,
    surface: 'concrete',
  };
  private nextAcousticProbeAt = 0;
  private hitmarkerUntil = 0;
  private hitmarkerHead = false;
  private hitmarkerKill = false;
  private hurtFlash = 0;
  private blinkFlash = 0;
  private interactHeld = false;
  private lastPlantBeepStep = -1;

  // Cheat & Progression Runtime State
  private dashUntil = 0;
  private blinkBonusUntil = 0;
  private volleyReadyAt = 0;
  private fireHoldTime = 0;
  private triggerHoverSince = 0;
  private missesSinceKill = 0;
  private headStreak = 0;
  private maxStreak = 0;
  private multiKill = 0;
  private lastKillAt = -10;
  private scopedAt = 0;
  private turnedRecently = 0;
  private lastKillerName = '';
  private bankCents = 0;
  private earnedKillCents = 0;
  private payBreakdown = new Map<string, { amount: number; color: string }>();
  private payFeed: { text: string; color: string; dieAt: number }[] = [];
  private casesDropped: string[] = [];
  private explosions: ExplosionFx[] = [];

  // Anti-Cheat / Suspicion State
  private heat = 0;
  private peakHeat = 0;
  private spoofCharges = 0;
  private adminsKilled = 0;
  private overwatchBotId: string | null = null;
  private banScanActive = false;
  private banScanEndAt = 0;
  private readonly banScanDuration = 8.5;
  private voteActive = false;
  private voteYes = 0;
  private voteNo = 0;
  private voteTotal = 5;
  private voteNeeded = 4;
  private voteEndAt = 0;
  private nextVoteBallotAt = 0;
  private nextVoteAllowedAt = 10;

  // Spectator State
  private spectateTargetId: string | null = null;
  private spectateMode: 'first' | 'third' | 'free' = 'first';
  private freeCamPos = new THREE.Vector3(0, 8, 0);
  private spectateOrbitYaw = 0;
  private spectateOrbitPitch = 0.28;
  private spectateCamYaw = 0;
  private spectateWeaponId: string | null = null;
  private minimapCanvas: HTMLCanvasElement | null = null;

  // Lifecycle & UI Overlays
  private running = true;
  private paused = false;
  private ended = false;
  private pointerLocked = false;
  private buyMenuOpen = false;
  private scoreboardOpen = false;
  private rafId = 0;
  private lastFrame = 0;
  private elapsed = 0;
  private lastBuyTickSec = -1;
  private keys = new Set<string>();

  private overlayCanvas: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private hudRoot: HTMLDivElement;
  private bannerEl: HTMLDivElement;
  private buyEl: HTMLDivElement;
  private scoreboardEl: HTMLDivElement;
  private killfeedEl: HTMLDivElement;
  private spectateBarEl: HTMLDivElement;
  private pauseEl: HTMLDivElement;
  private endEl: HTMLDivElement;
  private scopeEl: HTMLDivElement;
  private hurtEl: HTMLDivElement;
  private blinkEl: HTMLDivElement;
  private payfeedEl: HTMLDivElement;
  private voteEl: HTMLDivElement;
  private killFeed: { text: string; color: string; dieAt: number }[] = [];

  // Bound event listeners
  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;
  private onMouseMoveBound: (e: MouseEvent) => void;
  private onMouseDownBound: (e: MouseEvent) => void;
  private onMouseUpBound: (e: MouseEvent) => void;
  private onWheelBound: (e: WheelEvent) => void;
  private onPointerLockBound: () => void;
  private onResizeBound: () => void;
  private onContextMenuBound: (e: MouseEvent) => void;

  constructor(container: HTMLElement, onExitToHub: () => void, customMap?: CustomMapLaunchConfig) {
    this.container = container;
    this.onExitToHub = onExitToHub;
    this.customMap = customMap ?? null;
    this.mods = store.computeActiveMods();
    this.spoofCharges = this.mods.hwidSpoofCharges;
    this.heat = this.mods.baseHeatPerKill > 0
      ? Math.round(Math.max(0, 70 - store.data.trustFactor) * 0.35)
      : 0;
    this.peakHeat = this.heat;

    const cfg = store.data.sndConfig;
    const mapId: SndMapId = cfg.mapId;
    this.map = this.customMap ? buildCustomSndMap(this.customMap.document) : buildSndMap(mapId);

    const teamSize = this.customMap?.teamSize ?? cfg.teamSize;
    const roundsPerHalf = this.customMap?.roundsPerHalf ?? cfg.roundsPerHalf;
    const rules: Partial<SndRules> = {
      teamSize,
      roundsPerHalf,
      roundsToWin: roundsPerHalf + 1,
      overtimeEnabled: cfg.overtimeEnabled,
      friendlyFire: cfg.friendlyFire,
      buyPhaseDuration: this.customMap?.isTestPlay ? 4 : cfg.buyPhaseDuration,
      roundDuration: cfg.roundDuration,
    };
    const initialAttackers: TeamId =
      cfg.startingSide === 'attackers' ? 'teamA' :
      cfg.startingSide === 'defenders' ? 'teamB' :
      Math.random() < 0.5 ? 'teamA' : 'teamB';

    this.authority = new SndMatchAuthority([this.map.siteA, this.map.siteB], rules, initialAttackers);

    // Populate Human + Team Bots
    this.authority.addPlayer(this.humanId, 'Du', 'teamA', true, 14);
    for (let i = 1; i < teamSize; i++) {
      const pid = `ally_${i}`;
      this.authority.addPlayer(pid, `[A] ${BOT_CALLSIGNS[(i - 1) % BOT_CALLSIGNS.length]}`, 'teamA', false, 20 + i * 4);
    }
    for (let i = 0; i < teamSize; i++) {
      const pid = `enemy_${i}`;
      this.authority.addPlayer(pid, `[B] ${BOT_CALLSIGNS[(i + 4) % BOT_CALLSIGNS.length]}`, 'teamB', false, 18 + i * 5);
    }

    // DOM Setup
    this.container.innerHTML = '';
    const stage = document.createElement('div');
    stage.className = 'match-stage';
    this.container.appendChild(stage);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'match-webgl';
    stage.appendChild(this.renderer.domElement);
    this.applyArtStyle();

    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'match-overlay-canvas';
    this.overlayCanvas.width = window.innerWidth;
    this.overlayCanvas.height = window.innerHeight;
    stage.appendChild(this.overlayCanvas);
    this.octx = this.overlayCanvas.getContext('2d')!;

    this.hurtEl = document.createElement('div');
    this.hurtEl.className = 'match-hurt-flash';
    stage.appendChild(this.hurtEl);

    this.blinkEl = document.createElement('div');
    this.blinkEl.className = 'match-blink-flash';
    stage.appendChild(this.blinkEl);

    this.scopeEl = document.createElement('div');
    this.scopeEl.className = 'match-scope-overlay';
    this.scopeEl.innerHTML = `<div class="scope-ring"><div class="scope-h"></div><div class="scope-v"></div></div>`;
    stage.appendChild(this.scopeEl);

    this.hudRoot = document.createElement('div');
    this.hudRoot.className = 'match-hud';
    stage.appendChild(this.hudRoot);

    this.killfeedEl = document.createElement('div');
    this.killfeedEl.className = 'hud-killfeed';
    this.hudRoot.appendChild(this.killfeedEl);

    this.payfeedEl = document.createElement('div');
    this.payfeedEl.className = 'hud-payfeed';
    this.hudRoot.appendChild(this.payfeedEl);

    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'hud-banner';
    this.hudRoot.appendChild(this.bannerEl);

    this.voteEl = document.createElement('div');
    this.voteEl.className = 'hud-votekick hidden';
    this.hudRoot.appendChild(this.voteEl);

    this.spectateBarEl = document.createElement('div');
    this.spectateBarEl.className = 'snd-spectate-bar hidden';
    this.hudRoot.appendChild(this.spectateBarEl);

    // Top Competitive Scoreboard HUD + Cheat Status Stack + Player Stats
    const chrome = document.createElement('div');
    chrome.className = 'hud-chrome';
    chrome.innerHTML = `
      <div class="snd-top-bar">
        <div class="snd-team-box left">
          <div class="snd-pips" id="snd-pips-you"></div>
          <span class="snd-role-tag" id="snd-role-you">ATK</span>
          <span class="snd-score-num" id="snd-score-you">0</span>
        </div>
        <div class="snd-center-clock">
          <div class="snd-map-round" id="snd-round-label">${this.map.meta.name.toUpperCase()} · R1</div>
          <div class="snd-clock-val" id="snd-clock">--:--</div>
          <div class="snd-phase-pill" id="snd-phase-pill">WARMUP</div>
          <div class="hud-banscan hidden" id="snd-banscan"></div>
        </div>
        <div class="snd-team-box right">
          <span class="snd-score-num" id="snd-score-opp">0</span>
          <span class="snd-role-tag" id="snd-role-opp">DEF</span>
          <div class="snd-pips" id="snd-pips-opp"></div>
        </div>
      </div>
      <div class="snd-cheat-stack">
        <div class="hud-piggy hidden" id="snd-piggy">🐷 BANK: $0.00</div>
        <div class="hud-heat-wrap hidden" id="snd-heat-wrap">
          <div class="hud-heat-label"><span>ANTI-CHEAT HEAT</span><span id="snd-heat-pct">0%</span></div>
          <div class="hud-heat-track"><div class="hud-heat-fill" id="snd-heat-fill"></div></div>
          <div class="hud-heat-meta" id="snd-heat-meta"></div>
        </div>
        <div class="hud-active-cheats" id="snd-cheats"></div>
      </div>
      <div class="hud-streak hidden" id="snd-streak"></div>
      <div class="snd-interact-prompt hidden" id="snd-prompt"></div>
      <div class="hud-bottom-left-stats">
        <div class="snd-cash-tag" id="snd-cash">$800 · KEIN KEVLAR</div>
        <div class="hud-hp-box">
          <span class="hud-hp-label">HP</span>
          <span class="hud-hp-val" id="snd-hp">100</span>
          <div class="hud-hp-track"><div class="hud-hp-fill" id="snd-hp-fill"></div></div>
        </div>
        <div class="hud-speed-tag hidden" id="snd-speed"></div>
      </div>
      <div class="hud-bottom-right">
        <div class="hud-volley hidden" id="snd-volley"></div>
        <div class="hud-weapon-name" id="snd-weapon">HORNET</div>
        <div class="hud-ammo" id="snd-ammo">9 / 9</div>
        <div class="hud-slots" id="snd-slots"></div>
      </div>
    `;
    this.hudRoot.appendChild(chrome);
    this.renderActiveCheatPills();

    // Buy Menu Modal (B)
    this.buyEl = document.createElement('div');
    this.buyEl.className = 'snd-buy-overlay hidden';
    stage.appendChild(this.buyEl);

    // TAB Competitive Scoreboard Overlay
    this.scoreboardEl = document.createElement('div');
    this.scoreboardEl.className = 'snd-tab-board hidden';
    stage.appendChild(this.scoreboardEl);

    // Pause Overlay
    this.pauseEl = document.createElement('div');
    this.pauseEl.className = 'match-pause-overlay';
    this.pauseEl.innerHTML = `
      <div class="os-win-card pause-card">
        <div class="os-titlebar"><span>SEARCH & DESTROY — ${this.map.meta.name}</span></div>
        <div class="pause-body">
          <h2>${this.customMap?.isTestPlay ? `TEST PLAY: ${this.map.meta.name}` : this.map.meta.name} (${this.map.meta.sizeLabel})</h2>
          <p class="pause-hint">WASD Bewegen · Maus Schießen · R Nachladen · E Bombe Pflanzen/Entschärfen · G Bombe Droppen · B Buy-Menu · TAB Scoreboard · Y Inspizieren · ESC Pause</p>
          <div class="pause-actions">
            <button class="os-btn primary" id="snd-resume">KLICKEN ZUM SPIELEN</button>
            <button class="os-btn" id="snd-abort">${this.customMap?.isTestPlay ? 'ZURÜCK ZUM MAP EDITOR' : 'MATCH VERLASSEN'}</button>
          </div>
        </div>
      </div>
    `;
    stage.appendChild(this.pauseEl);

    this.endEl = document.createElement('div');
    this.endEl.className = 'match-end-overlay hidden';
    stage.appendChild(this.endEl);

    // Three.js Scene Setup
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(store.data.settings.fov, window.innerWidth / window.innerHeight, 0.08, 280);
    this.scene.add(this.camera);

    if (this.customMap) {
      applyCustomLightingToScene(this.scene, this.customMap.document.lighting, Math.max(this.map.halfX, this.map.halfZ));
      this.scene.environment = createSndEnvironmentMap(this.renderer, this.map.meta.theme);
    } else {
      this.scene.background = new THREE.Color(this.map.meta.skyColor);
      this.scene.fog = new THREE.FogExp2(this.map.meta.fogColor, this.map.meta.fogDensity);
      this.scene.environment = createSndEnvironmentMap(this.renderer, this.map.meta.theme);
      this.scene.add(createSndSkyDome(this.map.meta.theme));

      const hemi = new THREE.HemisphereLight(this.map.meta.hemiSky, this.map.meta.hemiGround, this.map.meta.hemiIntensity);
      this.scene.add(hemi);
      const sun = new THREE.DirectionalLight(this.map.meta.sunColor, this.map.meta.sunIntensity);
      sun.position.set(22, 34, 16);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.02;
      sun.shadow.camera.left = -45;
      sun.shadow.camera.right = 45;
      sun.shadow.camera.top = 48;
      sun.shadow.camera.bottom = -48;
      this.scene.add(sun);
    }

    this.scene.add(this.map.group);
    this.scene.add(this.ghostGroup);
    this.scene.add(this.fxGroup);

    // 3D C4 Bomb Prop
    const c4Body = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.14, 0.24),
      new THREE.MeshStandardMaterial({ color: '#3f4a3c', roughness: 0.72, metalness: 0.2 }),
    );
    c4Body.position.y = 0.07;
    const c4Pad = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.03, 0.12),
      new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.4 }),
    );
    c4Pad.position.set(0, 0.15, 0);
    this.bombLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 8),
      new THREE.MeshBasicMaterial({ color: '#ef4444' }),
    );
    this.bombLed.position.set(0.06, 0.17, -0.03);
    this.bombRing = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.62, 24),
      new THREE.MeshBasicMaterial({ color: '#facc15', side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
    );
    this.bombRing.rotation.x = -Math.PI / 2;
    this.bombRing.position.y = 0.025;
    this.bombGroup.add(c4Body, c4Pad, this.bombLed, this.bombRing);
    this.bombGroup.visible = false;
    this.scene.add(this.bombGroup);

    // ViewModel + Camera Rig + Ragdolls + Mechanical Sound Sync
    this.viewModel = new ViewModelController(this.camera);
    this.cameraRig = new FirstPersonCameraRig(store.data.settings.fov);
    this.ragdolls = new RagdollManager(this.scene, { maxCorpses: 16, corpseLifetimeSec: 180 });
    this.viewModel.setCallbacks({
      onMechSound: (ev, wid) => sfx.playWeaponMech(ev, wid),
      onEjectShell: (wid) => this.spawnShellCasing(wid),
      onCancelFoley: () => sfx.cancelWeaponFoley('player_weapon'),
    });

    // Spawn Bot Entities linked to authoritative players & Initialize Modular AI Brain
    const nav = this.customMap
      ? bakeCustomMapNavigation(this.customMap.document).navGrid
      : new NavGrid({
          halfX: this.map.halfX,
          halfZ: this.map.halfZ,
          walls: navWallsFromBoxes(this.map.walls.map((w) => w.box)),
          grid: this.map.grid,
          cellSize: 1.0,
          clearance: 0.54,
        });
    this.aiManager = new BotAIManager(nav, new SndModeAdapter(), store.data.settings.botDifficulty);
    this.aiDebug = new AiDebugVisualizer(this.hudRoot);

    let botNum = 0;
    for (const p of this.authority.players.values()) {
      if (p.isHuman) continue;
      const ent = new BotEntity(botNum, this.scene, this.ghostGroup, false);
      ent.name = p.name;
      this.botActors.set(p.id, {
        playerId: p.id,
        entity: ent,
      });
      this.aiManager.ensureAgent(p.id, botNum);
      botNum++;
    }

    // Bind events
    this.onKeyDownBound = (e) => this.onKeyDown(e);
    this.onKeyUpBound = (e) => this.onKeyUp(e);
    this.onMouseMoveBound = (e) => this.onMouseMove(e);
    this.onMouseDownBound = (e) => this.onMouseDown(e);
    this.onMouseUpBound = (e) => this.onMouseUp(e);
    this.onWheelBound = (e) => this.onWheel(e);
    this.onPointerLockBound = () => this.onPointerLockChange();
    this.onResizeBound = () => this.onResize();
    this.onContextMenuBound = (e) => e.preventDefault();

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    window.addEventListener('mousemove', this.onMouseMoveBound);
    window.addEventListener('mousedown', this.onMouseDownBound);
    window.addEventListener('mouseup', this.onMouseUpBound);
    window.addEventListener('wheel', this.onWheelBound, { passive: true });
    document.addEventListener('pointerlockchange', this.onPointerLockBound);
    window.addEventListener('resize', this.onResizeBound);
    this.container.addEventListener('contextmenu', this.onContextMenuBound);

    this.pauseEl.querySelector('#snd-resume')!.addEventListener('click', () => this.requestLock());
    this.pauseEl.querySelector('#snd-abort')!.addEventListener('click', () => this.abortToHub());

    // Start immediately
    this.authority.forceStartIfReady();
    this.processAuthorityEvents();
    this.syncHumanLoadout();

    this.lastFrame = performance.now();
    this.loop(this.lastFrame);
    this.requestLock();
  }

  private applyArtStyle(): void {
    const preset = ART_STYLES.find((a) => a.id === store.data.settings.artStyle) ?? ART_STYLES[0];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * preset.pixelScale);
    this.renderer.domElement.style.filter = preset.filter;
    this.renderer.domElement.style.imageRendering = preset.pixelScale < 0.7 ? 'pixelated' : 'auto';
  }

  private requestLock(): void {
    if (this.ended) return;
    try {
      this.renderer.domElement.requestPointerLock();
    } catch {
      // handled cleanly by pause overlay
    }
  }

  private onPointerLockChange(): void {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    if (!this.ended) {
      if (this.buyMenuOpen && !this.pointerLocked) {
        this.paused = false;
        this.pauseEl.classList.add('hidden');
        return;
      }
      this.paused = !this.pointerLocked;
      this.pauseEl.classList.toggle('hidden', this.pointerLocked);
      if (!this.pointerLocked) {
        this.firingHeld = false;
        this.keys.clear();
        this.interactHeld = false;
        sfx.cancelWeaponFoley('player_weapon');
      }
    }
  }

  // === Loadout Sync (Preserves CoD Camos, Ammo Cheats & Weapon Models!) ===
  private syncHumanLoadout(): void {
    const human = this.authority.players.get(this.humanId)!;
    const prevPrimary = this.slots.find((s) => !s.def.isSidearm && !s.def.isMelee)?.def.id ?? null;
    if (prevPrimary === human.primaryWeapon && this.slots.length > 0) return;

    this.slots = [];
    if (human.primaryWeapon) {
      const pDef = getWeaponDef(human.primaryWeapon);
      this.slots.push({ def: pDef, ammo: computeSndMagSize(pDef, this.mods) });
    }
    const secDef = getWeaponDef(human.secondaryWeapon);
    this.slots.push({ def: secDef, ammo: computeSndMagSize(secDef, this.mods) });
    const knifeDef = getWeaponDef('knife');
    this.slots.push({ def: knifeDef, ammo: 1 });
    this.switchSlot(0);
  }

  private renderActiveCheatPills(): void {
    const el = document.getElementById('snd-cheats');
    if (!el) return;
    const active: string[] = [];
    if (this.mods.hitboxOn) active.push(`HITBOX ${this.mods.headScale.toFixed(1)}x`);
    if (this.mods.recoilMult < 0.99) active.push(this.mods.recoilMult === 0 ? 'ZERO RECOIL' : 'NO RECOIL');
    if (this.mods.wallhackOn) active.push(this.mods.wallbangTier > 0 ? 'WALLHACK+WB' : 'WALLHACK');
    if (this.mods.aimbotOn) active.push(this.mods.volleyCount > 0 ? 'AIMBOT+VOLLEY' : 'AIMBOT');
    if (this.mods.triggerOn) active.push('TRIGGERBOT');
    if (this.mods.bhopOn) active.push(this.mods.bhopMoonhop ? 'MOONHOP' : 'BHOP');
    if (this.mods.speedMult > 1.01) active.push(this.mods.killBlink ? 'SPEED+BLINK' : 'SPEEDHACK');
    if (this.mods.damageMult > 1.01) active.push('RAGE');
    if (this.mods.piggyOn || this.mods.infiniteAmmo || this.mods.magMult > 1.01) {
      active.push(this.mods.piggyOn ? 'AMMO+PIGGY' : 'AMMO');
    }
    if (this.mods.spinbotOn) active.push('SPINBOT');
    if (this.mods.backtrackOn) active.push('BACKTRACK');
    if (this.mods.heatMult < 0.99) active.push('BYPASS');
    el.innerHTML = active.map((a) => `<span class="cheat-pill">${a}</span>`).join('');
  }

  private switchSlot(idx: number): void {
    if (idx < 0 || idx >= this.slots.length) return;
    this.viewModel.cancelReload(this.grounded);
    this.slotIdx = idx;
    this.reloading = false;
    this.scoped = false;
    const def = this.slots[idx].def;
    const skin = getSkin(store.data.equippedSkins[def.id]);
    this.viewModel.equip(def, skin);
    this.renderSlotsHud();
  }

  private renderSlotsHud(): void {
    const el = document.getElementById('snd-slots');
    if (!el) return;
    el.innerHTML = this.slots
      .map((s, i) => `<span class="hud-slot ${i === this.slotIdx ? 'active' : ''}">[${i + 1}] ${s.def.shortName}</span>`)
      .join('');
  }

  // === Input Handlers ===
  private onKeyDown(e: KeyboardEvent): void {
    if (this.ended) {
      if (e.code === 'Escape') this.abortToHub();
      return;
    }

    if (e.code === 'Tab') {
      e.preventDefault();
      this.scoreboardOpen = true;
      this.renderScoreboard();
      return;
    }

    if (e.code === 'KeyB') {
      e.preventDefault();
      if (this.authority.phase === 'buy_phase') {
        this.toggleBuyMenu(!this.buyMenuOpen);
      }
      return;
    }

    if (this.buyMenuOpen && e.code === 'Escape') {
      e.preventDefault();
      this.toggleBuyMenu(false);
      return;
    }

    // Buy Menu fast hotkeys even with mouse locked!
    if (this.authority.phase === 'buy_phase') {
      if (e.code === 'Enter' || e.code === 'F4') {
        this.toggleBuyMenu(false);
        this.authority.skipBuyPhase();
        return;
      }
      if (this.buyMenuOpen) {
        const hotkeyMap: Record<string, () => void> = {
          Digit1: () => this.humanBuyWeapon('smg'),
          Digit2: () => this.humanBuyWeapon('shotgun'),
          Digit3: () => this.humanBuyWeapon('ssg'),
          Digit4: () => this.humanBuyWeapon('rifle'),
          Digit5: () => this.humanBuyWeapon('m4'),
          Digit6: () => this.humanBuyWeapon('sniper'),
          KeyK: () => this.humanBuyArmor(false),
          KeyH: () => this.humanBuyArmor(true),
          KeyD: () => this.humanBuyKit(),
        };
        if (hotkeyMap[e.code]) {
          hotkeyMap[e.code]();
          return;
        }
      }
    }

    if (e.code === 'F2') {
      e.preventDefault();
      store.cycleArtStyle();
      this.applyArtStyle();
      return;
    }
    if (e.code === 'F3') {
      e.preventDefault();
      store.data.settings.aiDebugOverlay = !store.data.settings.aiDebugOverlay;
      store.notify();
      this.showBanner(`AI DEBUG OVERLAY: ${store.data.settings.aiDebugOverlay ? 'AN' : 'AUS'}`, '#38bdf8');
      return;
    }

    this.keys.add(e.code);

    const human = this.authority.players.get(this.humanId)!;
    if (!human.alive) {
      if (e.code === 'Space') {
        e.preventDefault();
        this.cycleSpectatorMode();
      } else if (e.code === 'KeyQ') {
        this.cycleSpectatorTarget(-1);
      } else if (e.code === 'KeyE') {
        this.cycleSpectatorTarget(1);
      }
      return;
    }

    if (!this.pointerLocked || this.buyMenuOpen) return;

    if (e.code === 'Digit1') this.switchSlot(0);
    else if (e.code === 'Digit2') this.switchSlot(1);
    else if (e.code === 'Digit3') this.switchSlot(2);
    else if (e.code === 'KeyR') this.startReload();
    else if (e.code === 'KeyY' || e.key.toLowerCase() === 'y' || e.code === 'KeyF') this.triggerWeaponInspect();
    else if (e.code === 'KeyG') this.authority.dropBomb(this.humanId);
    else if (e.code === 'KeyE') {
      this.interactHeld = true;
      this.tryStartInteract();
    }
  }

  private triggerWeaponInspect(): void {
    if (this.scoped) {
      this.scoped = false;
      this.viewModel.onScopeToggle(false);
    }
    this.viewModel.triggerInspect();
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    if (e.code === 'Tab') {
      this.scoreboardOpen = false;
      this.scoreboardEl.classList.add('hidden');
    }
    if (e.code === 'KeyE') {
      this.interactHeld = false;
      if (this.authority.bomb.interactorId === this.humanId) {
        this.authority.cancelPlant(this.humanId);
        this.authority.cancelDefuse(this.humanId);
      }
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.pointerLocked || this.paused || this.ended || this.buyMenuOpen) return;
    const sens = store.data.settings.sensitivity * (this.scoped ? 0.45 : 1);
    const human = this.authority.players.get(this.humanId)!;
    if (!human.alive) {
      this.spectateOrbitYaw -= e.movementX * sens;
      this.spectateOrbitPitch = THREE.MathUtils.clamp(this.spectateOrbitPitch + e.movementY * sens, -0.4, 1.15);
      this.yaw -= e.movementX * sens;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * sens, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
      return;
    }
    const dxDeg = (Math.abs(e.movementX) * sens * 180) / Math.PI;
    this.turnedRecently = Math.min(380, this.turnedRecently + dxDeg);
    this.yaw -= e.movementX * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * sens, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    this.viewModel.addLookSway(e.movementX, e.movementY);
  }

  private onMouseDown(e: MouseEvent): void {
    if (this.ended || !this.pointerLocked || this.buyMenuOpen) return;
    const human = this.authority.players.get(this.humanId)!;
    if (!human.alive) {
      if (e.button === 0) this.cycleSpectatorTarget(1);
      else if (e.button === 2) this.cycleSpectatorTarget(-1);
      return;
    }

    if (e.button === 0) {
      this.firingHeld = true;
      this.fireBufferUntil = this.elapsed + 0.052;
      this.tryShoot(false);
    } else if (e.button === 2) {
      const def = this.slots[this.slotIdx]?.def;
      if (def?.scope) {
        this.scoped = !this.scoped;
        if (this.scoped) this.scopedAt = this.elapsed;
        this.viewModel.onScopeToggle(this.scoped);
      }
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 0) {
      this.firingHeld = false;
      this.fireHoldTime = 0;
    }
  }

  private onWheel(e: WheelEvent): void {
    if (!this.pointerLocked || this.ended || this.buyMenuOpen) return;
    const human = this.authority.players.get(this.humanId)!;
    if (!human.alive) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    this.switchSlot((this.slotIdx + dir + this.slots.length) % this.slots.length);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.overlayCanvas.width = w;
    this.overlayCanvas.height = h;
  }

  // === Buy Menu Actions ===
  private toggleBuyMenu(open: boolean): void {
    if (open && this.authority.phase !== 'buy_phase') return;
    this.buyMenuOpen = open;
    this.buyEl.classList.toggle('hidden', !open);
    if (open) {
      this.firingHeld = false;
      this.keys.clear();
      if (document.pointerLockElement === this.renderer.domElement) {
        document.exitPointerLock();
      }
      this.renderBuyMenu();
    } else {
      this.paused = false;
      this.requestLock();
    }
  }

  private humanBuyWeapon(weaponId: string): void {
    if (this.authority.buyWeapon(this.humanId, weaponId)) {
      sfx.playUi('buy');
      this.syncHumanLoadout();
      this.renderBuyMenu();
    } else {
      sfx.playUi('deny');
    }
  }

  private humanBuyArmor(helmet: boolean): void {
    if (this.authority.buyArmor(this.humanId, helmet)) {
      sfx.playUi('buy');
      this.renderBuyMenu();
    } else {
      sfx.playUi('deny');
    }
  }

  private humanBuyKit(): void {
    if (this.authority.buyDefuseKit(this.humanId)) {
      sfx.playUi('buy');
      this.renderBuyMenu();
    } else {
      sfx.playUi('deny');
    }
  }

  private renderBuyMenu(): void {
    const human = this.authority.players.get(this.humanId)!;
    const eco = this.authority.rules.economy;
    const isDef = this.authority.sideOfTeam(human.team) === 'defenders';
    const buyGuns = [
      { id: 'smg', key: '1', name: 'Wasp MP-9' },
      { id: 'shotgun', key: '2', name: 'Viper-12' },
      { id: 'ssg', key: '3', name: 'Mantis SSG' },
      { id: 'rifle', key: '4', name: 'AK-Phantom' },
      { id: 'm4', key: '5', name: 'Locust M4-X' },
      { id: 'sniper', key: '6', name: 'AWP-Apex' },
    ];

    this.buyEl.innerHTML = `
      <div class="os-win-card snd-buy-card">
        <div class="os-titlebar"><span>TAKTISCHES BUY-MENU — ${isDef ? 'DEFENDERS (CT)' : 'ATTACKERS (T)'}</span><span>${Math.ceil(this.authority.phaseTimer)}s</span></div>
        <div class="snd-buy-body">
          <div class="snd-buy-head">
            <div>Guthaben: <strong style="color:#4ade80">$${human.money}</strong></div>
            <div>Waffe: <strong>${human.primaryWeapon ? getWeaponDef(human.primaryWeapon).name : 'Hornet .45'}</strong> · Rüstung: <strong>${human.armor}${human.hasHelmet ? ' + Helm' : ''}</strong></div>
          </div>
          <div class="snd-buy-grid">
            <div class="snd-buy-col">
              <div class="snd-col-title">WAFFEN</div>
              ${buyGuns
                .map((g) => {
                  const cost = eco.weaponCosts[g.id];
                  const owned = human.primaryWeapon === g.id;
                  const can = !owned && human.money >= cost;
                  return `<button class="snd-buy-btn ${owned ? 'owned' : can ? '' : 'poor'}" data-buy-gun="${g.id}">
                    <span>[${g.key}] ${g.name}</span>
                    <strong>${owned ? '✓ AKTIV' : `$${cost}`}</strong>
                  </button>`;
                })
                .join('')}
            </div>
            <div class="snd-buy-col">
              <div class="snd-col-title">AUSRÜSTUNG</div>
              <button class="snd-buy-btn ${human.armor >= 100 ? 'owned' : human.money >= eco.armorCost ? '' : 'poor'}" id="buy-kevlar">
                <span>[K] Kevlar Vest</span><strong>${human.armor >= 100 ? '✓ 100' : `$${eco.armorCost}`}</strong>
              </button>
              <button class="snd-buy-btn ${human.hasHelmet && human.armor >= 100 ? 'owned' : human.money >= eco.helmetCost ? '' : 'poor'}" id="buy-helmet">
                <span>[H] Kevlar + Helm</span><strong>${human.hasHelmet ? '✓ AKTIV' : `$${eco.helmetCost}`}</strong>
              </button>
              ${
                isDef
                  ? `<button class="snd-buy-btn ${human.hasDefuseKit ? 'owned' : human.money >= eco.defuseKitCost ? '' : 'poor'}" id="buy-kit">
                      <span>[D] Defuse Kit (3.5s)</span><strong>${human.hasDefuseKit ? '✓ AKTIV' : `$${eco.defuseKitCost}`}</strong>
                    </button>`
                  : `<div class="snd-kit-note">Attackers erhalten die C4-Bombe am Rundenstart.</div>`
              }
              <div class="snd-buy-actions">
                <button class="os-btn primary" id="buy-ready">[ENTER] BEREIT / SKIP</button>
                <button class="os-btn" id="buy-close">[B] SCHLIESSEN</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.buyEl.querySelectorAll<HTMLButtonElement>('[data-buy-gun]').forEach((b) => {
      b.addEventListener('click', () => this.humanBuyWeapon(b.dataset.buyGun!));
    });
    this.buyEl.querySelector('#buy-kevlar')?.addEventListener('click', () => this.humanBuyArmor(false));
    this.buyEl.querySelector('#buy-helmet')?.addEventListener('click', () => this.humanBuyArmor(true));
    this.buyEl.querySelector('#buy-kit')?.addEventListener('click', () => this.humanBuyKit());
    this.buyEl.querySelector('#buy-ready')!.addEventListener('click', () => {
      this.toggleBuyMenu(false);
      this.authority.skipBuyPhase();
    });
    this.buyEl.querySelector('#buy-close')!.addEventListener('click', () => this.toggleBuyMenu(false));
  }

  // === Main Loop ===
  private loop = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);
    updateCamoClock(now * 0.001);
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    store.tickBotFarm();

    if (!this.ended && (!this.paused || this.buyMenuOpen)) {
      this.stepSimulation(dt);
    }

    this.renderer.render(this.scene, this.camera);
    this.drawOverlay2D();
    this.updateHudDom();
  };

  private stepSimulation(dt: number): void {
    this.elapsed += dt;
    this.turnedRecently = Math.max(0, this.turnedRecently - dt * 260);
    this.map.animate(this.elapsed);

    // Sync 3D AudioListener & probe real-time indoor/outdoor acoustic zone
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    sfx.updateListener(this.camera.position, fwd, up);
    if (this.elapsed >= this.nextAcousticProbeAt) {
      this.nextAcousticProbeAt = this.elapsed + 0.1;
      this.currentAcousticEnv = probeAcousticEnvironment(this.camera.position, this.map.walls, {
        sndGrid: this.map.grid,
        theme: this.map.meta.theme,
      });
      sfx.setAcousticEnvironment(this.currentAcousticEnv);
    }

    this.stepAntiCheat(dt);
    if (this.ended) return;

    // Tick Authoritative State Machine
    this.authority.tick(dt);
    this.processAuthorityEvents();

    // Countdown tick audio in last 3s of buy_phase
    if (this.authority.phase === 'buy_phase') {
      const sec = Math.ceil(this.authority.phaseTimer);
      if (sec <= 3 && sec >= 1 && sec !== this.lastBuyTickSec) {
        this.lastBuyTickSec = sec;
        sfx.playSndEvent('buy_tick');
      }
      if (this.buyMenuOpen) {
        const timerSpan = this.buyEl.querySelector('.os-titlebar span:last-child');
        if (timerSpan) timerSpan.textContent = `${Math.max(0, sec)}s`;
      }
    } else {
      this.lastBuyTickSec = -1;
    }

    const human = this.authority.players.get(this.humanId)!;
    if (human.alive) {
      this.stepHumanMovement(dt);
      if (this.authority.phase === 'active') {
        this.stepAimbot(dt);
        this.stepHumanWeapon(dt);
        this.stepTriggerbot(dt);
        if (this.interactHeld && this.authority.bomb.interactorId !== this.humanId) {
          this.tryStartInteract();
        }
        // Plant keypad audio pulses while planting
        if (this.authority.bomb.state === 'planting' && this.authority.bomb.interactorId === this.humanId) {
          const step = Math.floor(this.authority.bomb.progress * 6);
          if (step !== this.lastPlantBeepStep) {
            this.lastPlantBeepStep = step;
            sfx.playSndEvent('plant_beep');
          }
        } else {
          this.lastPlantBeepStep = -1;
        }
      }
    } else {
      this.scopeEl.classList.remove('active');
      this.stepSpectatorCamera(dt);
    }

    this.stepSndBots(dt);
    this.ragdolls.update(
      dt,
      (pos, r) => resolveCircleWallCollisionRect(pos, r, this.map.walls, this.map.halfX, this.map.halfZ),
      (pos, speed) => sfx.playBodyThud(speed, this.computeStereoPan(pos)),
    );
    this.stepBombVisualsAndAudio(dt);
    this.stepFx(dt);
    if (this.blinkFlash > 0) {
      this.blinkFlash = Math.max(0, this.blinkFlash - dt * 3.5);
      this.blinkEl.style.opacity = String(this.blinkFlash);
    }
  }

  private processAuthorityEvents(): void {
    const events = this.authority.drainEvents();
    const human = this.authority.players.get(this.humanId)!;

    for (const ev of events) {
      if (ev.type === 'round_started') {
        this.roundTargetSite = Math.random() < 0.5 ? 'A' : 'B';
        this.spectateTargetId = null;
        this.spectateWeaponId = null;
        this.spawnAllRoundParticipants();
        this.lastBombBeepSetup();
        if (this.buyMenuOpen) this.toggleBuyMenu(false);
        const side = this.authority.sideOfTeam(human.team);
        this.showBanner(
          `RUNDE ${ev.round} — ${side === 'attackers' ? 'ATTACKERS (T): PLANTE AUF A ODER B' : 'DEFENDERS (CT): VERTEIDIGE A & B'}`,
          side === 'attackers' ? '#f59e0b' : '#38bdf8',
        );
      } else if (ev.type === 'phase_changed') {
        if (ev.phase === 'buy_phase') {
          sfx.playSndEvent('round_start');
          this.botBuyRound();
        } else if (ev.phase === 'active') {
          if (this.buyMenuOpen) this.toggleBuyMenu(false);
          this.showBanner('GO! RUNDE GESTARTET!', '#4ade80');
        } else if (ev.phase === 'match_end') {
          this.finishSndMatch();
        }
      } else if (ev.type === 'bomb_picked_up' && ev.playerId === this.humanId) {
        sfx.playSndEvent('bomb_pickup');
        this.showBanner('💣 DU TRÄGST JETZT DIE C4-BOMBE!', '#facc15');
      } else if (ev.type === 'bomb_planted') {
        sfx.playSndEvent('bomb_planted');
        this.nextBombBeepAt = this.elapsed + 0.8;
        this.aiManager.recordSound('bomb', ev.site, 'bomb_plant', ev.pos, 34, this.elapsed);
        this.showBanner(`💣 C4 AUF SITE ${ev.site} GEPLANTET! (35s)`, '#ef4444');
      } else if (ev.type === 'defuse_started') {
        this.aiManager.recordSound(ev.playerId, 'defenders', 'bomb_defuse', this.authority.bomb.pos, 26, this.elapsed);
        if (ev.playerId === this.humanId) sfx.playSndEvent('defuse_start');
      } else if (ev.type === 'bomb_defused') {
        sfx.playSndEvent('bomb_defused');
        this.showBanner(`✂ BOMBE AUF SITE ${ev.site} ENTSCHÄRFT!`, '#38bdf8');
      } else if (ev.type === 'bomb_detonated') {
        sfx.playSndEvent('bomb_detonate');
        this.triggerBombDetonationVfx(this.authority.bomb.pos);
        this.showBanner(`💥 SITE ${ev.site} DETONIERT!`, '#ff4500');
      } else if (ev.type === 'side_switched') {
        sfx.playSndEvent('side_switch');
        this.showBanner('⇄ SEITENWECHSEL! ROLLEN GETAUSCHT · $800 RESET', '#22d3ee');
      } else if (ev.type === 'overtime_started') {
        this.showBanner(`⚡ OVERTIME ${ev.overtimeIndex}! $10.000 STARTGELD!`, '#facc15');
      } else if (ev.type === 'round_ended') {
        const youWon = ev.summary.winnerTeam === human.team;
        sfx.playSndEvent(youWon ? 'round_win' : 'round_loss');
        const reasonTxt: Record<string, string> = {
          detonated: 'C4 Detonation',
          defused: 'C4 Entschärft',
          attackers_eliminated: 'Alle Angreifer eliminiert',
          defenders_eliminated: 'Alle Verteidiger eliminiert',
          time_expired: 'Rundenzeit abgelaufen',
        };
        this.showBanner(
          `${youWon ? '🏆 RUNDENSIEG!' : '💀 RUNDE VERLOREN'} · ${reasonTxt[ev.summary.reason]}`,
          youWon ? '#4ade80' : '#f87171',
        );
      } else if (ev.type === 'player_eliminated') {
        const atk = this.authority.players.get(ev.attackerId);
        const vic = this.authority.players.get(ev.victimId);
        const asst = ev.assistId ? this.authority.players.get(ev.assistId) : null;
        if (atk && vic) {
          const hs = ev.headshot ? ' [HS]' : '';
          const aStr = asst ? ` + ${asst.name}` : '';
          const col = atk.team === human.team ? '#4ade80' : '#f87171';
          this.pushKillFeed(`${atk.name}${aStr} [${getWeaponDef(ev.weaponId).shortName}${hs}] ${vic.name}`, col);
        }
        if (ev.victimId === this.humanId) {
          this.reloading = false;
          this.scoped = false;
          this.firingHeld = false;
          this.fireHoldTime = 0;
          this.triggerHoverSince = 0;
          this.headStreak = 0;
          this.hopChain = 0;
          this.dashUntil = 0;
          this.blinkBonusUntil = 0;
          if (atk && atk.id !== this.humanId) this.lastKillerName = atk.name;
          sfx.cancelWeaponFoley('player_weapon');
          this.enterSpectatorMode();
        }
      }
    }
  }

  private lastBombBeepSetup(): void {
    this.nextBombBeepAt = 0;
    if (this.bombExplosion) {
      this.scene.remove(this.bombExplosion.mesh);
      this.scene.remove(this.bombExplosion.light);
      this.bombExplosion.mesh.geometry.dispose();
      (this.bombExplosion.mesh.material as THREE.Material).dispose();
      this.bombExplosion = null;
    }
  }

  private spawnAllRoundParticipants(): void {
    this.ragdolls.clearAll();
    sfx.cancelWeaponFoley('player_weapon');
    for (const ex of this.explosions) {
      this.fxGroup.remove(ex.mesh);
      if (ex.light) this.fxGroup.remove(ex.light);
      ex.mesh.geometry.dispose();
      (ex.mesh.material as THREE.Material).dispose();
    }
    this.explosions = [];
    this.dashUntil = 0;
    this.blinkBonusUntil = 0;
    this.fireHoldTime = 0;
    this.triggerHoverSince = 0;
    this.overwatchBotId = null;
    this.banScanActive = false;
    this.voteActive = false;
    this.voteEl.classList.add('hidden');

    const atkSpawns = this.map.attackerSpawns;
    const defSpawns = this.map.defenderSpawns;
    let aIdx = 0;
    let dIdx = 0;

    for (const p of this.authority.players.values()) {
      const side = this.authority.sideOfTeam(p.team);
      const sp = side === 'attackers'
        ? atkSpawns[aIdx++ % atkSpawns.length]
        : defSpawns[dIdx++ % defSpawns.length];

      const spawnY = this.map.sampleGroundHeight ? this.map.sampleGroundHeight(sp.x, sp.z, sp.y) : 0;
      this.authority.updatePlayerPosition(p.id, { x: sp.x, y: spawnY, z: sp.z });

      if (p.isHuman) {
        this.pos.copy(sp);
        this.pos.y = spawnY;
        this.vel.set(0, 0, 0);
        this.yaw = Math.atan2(sp.x, sp.z);
        this.pitch = 0;
        this.recoilPitch = 0;
        this.recoilYaw = 0;
        this.fovKick = 0;
        this.fireBufferUntil = 0;
        this.cameraRig?.reset(store.data.settings.fov);
        this.grounded = true;
        this.crouching = false;
        this.reloading = false;
        this.scoped = false;
        this.scopeEl.classList.remove('active');
        this.viewModel.root.visible = true;
        this.syncHumanLoadout();
        for (const s of this.slots) s.ammo = computeSndMagSize(s.def, this.mods);
      } else {
        const actor = this.botActors.get(p.id);
        if (actor) {
          const spawnYaw = Math.atan2(-sp.x, -sp.z);
          const isFriendly = p.team === 'teamA';
          const bounty = isFriendly ? 'normal' : rollSndEnemyBounty(this.mods);
          actor.entity.spawn(sp, bounty, false, false, false, this.elapsed);
          actor.entity.applyTeamAppearance(side, isFriendly);
          actor.entity.yaw = spawnYaw;
        }
      }
    }
    const yawMap = new Map<string, number>();
    for (const [pid, actor] of this.botActors.entries()) yawMap.set(pid, actor.entity.yaw);
    this.aiManager.onRoundReset(yawMap);
  }

  private botBuyRound(): void {
    const adapter = this.aiManager.adapter as SndModeAdapter;
    const actors: AiCombatantInput[] = [];
    for (const pid of this.botActors.keys()) {
      const p = this.authority.players.get(pid);
      if (!p || !p.alive) continue;
      actors.push({
        id: pid,
        name: p.name,
        team: p.team,
        side: this.authority.sideOfTeam(p.team),
        isHuman: false,
        alive: p.alive,
        hp: p.hp,
        maxHp: 100,
        pos: p.pos,
        vel: { x: 0, y: 0, z: 0 },
        yaw: 0,
      });
    }
    adapter.performBotBuy(
      actors,
      (pid) => {
        const p = this.authority.players.get(pid);
        if (!p) return null;
        return {
          alive: p.alive,
          money: p.money,
          side: this.authority.sideOfTeam(p.team),
          primaryWeapon: p.primaryWeapon,
          armor: p.armor,
          hasHelmet: p.hasHelmet,
          hasDefuseKit: p.hasDefuseKit,
        };
      },
      (pid, wid) => this.authority.buyWeapon(pid, wid),
      (pid, helmet) => this.authority.buyArmor(pid, helmet),
      (pid) => this.authority.buyDefuseKit(pid),
    );
  }

  // === Human Movement, Shooting & Interaction ===
  private stepHumanMovement(dt: number): void {
    const snap = this.authority.getSnapshot();
    const slot = this.slots[this.slotIdx];
    const wishF = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const wishR = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this.forwardInput = wishF;
    this.strafeInput = wishR;
    this.crouching = this.keys.has('ControlLeft') || this.keys.has('KeyC');

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const dashActive = this.elapsed < this.dashUntil;
    const moveParams = computeSndMovementParams(slot.def, this.mods, this.crouching, this.hopChain, dashActive);

    if (snap.movementLocked) {
      this.vel.set(0, 0, 0);
    } else {
      const wishDir = new THREE.Vector3().addScaledVector(forward, wishF).addScaledVector(right, wishR);
      if (wishDir.lengthSq() > 0.001) wishDir.normalize();

      if (this.grounded) {
        if (this.keys.has('Space') && (this.mods.bhopOn || this.hopGrace <= 0)) {
          this.vel.y = Math.sqrt(2 * BALANCE.gravity * moveParams.jumpHeight);
          this.grounded = false;
          sfx.playJump();
          if (this.mods.bhopOn && wishDir.lengthSq() > 0.01) {
            this.hopChain = Math.min(this.mods.bhopChainCap, this.hopChain + 1);
            this.hopGrace = 0.25;
          }
        } else {
          this.vel.x = expDamp(this.vel.x, wishDir.x * moveParams.baseSpeed, 14, dt);
          this.vel.z = expDamp(this.vel.z, wishDir.z * moveParams.baseSpeed, 14, dt);
          if (this.hopGrace > 0) this.hopGrace -= dt;
          else this.hopChain = 0;
        }
      } else {
        if (wishDir.lengthSq() > 0.01) {
          this.vel.x = expDamp(this.vel.x, wishDir.x * moveParams.baseSpeed, moveParams.airControl, dt);
          this.vel.z = expDamp(this.vel.z, wishDir.z * moveParams.baseSpeed, moveParams.airControl, dt);
        }
        this.vel.y -= BALANCE.gravity * dt;
      }

      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.pos.y += this.vel.y * dt;
      const groundY = this.map.sampleGroundHeight ? this.map.sampleGroundHeight(this.pos.x, this.pos.z, this.pos.y) : 0;
      if (this.pos.y <= groundY) {
        this.pos.y = groundY;
        this.vel.y = 0;
        this.grounded = true;
      }
      resolveCircleWallCollisionRect(this.pos, 0.45, this.map.walls, this.map.halfX, this.map.halfZ);
      this.authority.updatePlayerPosition(this.humanId, { x: this.pos.x, y: this.pos.y, z: this.pos.z });
    }

    this.eyeHeight = expDamp(this.eyeHeight, this.crouching ? 1.15 : 1.68, 15, dt);
    this.recoilPitch = expDamp(this.recoilPitch, 0, 12, dt);
    this.recoilYaw = expDamp(this.recoilYaw, 0, 12, dt);
    this.fovKick = expDamp(this.fovKick, 0, 14, dt);

    const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    const liveSpread = computeWeaponSpreadDeg({
      def: slot.def,
      horizSpeed,
      maxMoveSpeed: moveParams.maxMoveSpeed,
      grounded: this.grounded,
      crouching: this.crouching,
      scoped: this.scoped,
      shotBloom: this.shotBloom,
      spreadMult: this.mods.spreadMult,
    });
    this.crosshairSpreadPx = expDamp(this.crosshairSpreadPx, Math.min(44, liveSpread.totalDeg * 4.2), 18, dt);

    const rigOut = this.cameraRig.update({
      dt,
      horizSpeed,
      maxSpeed: Math.max(1, BALANCE.walkSpeed * slot.def.moveSpeed),
      strafeInput: this.strafeInput,
      forwardInput: this.forwardInput,
      crouching: this.crouching,
      onGround: this.grounded,
      velY: this.vel.y,
      scoped: this.scoped,
      baseFov: store.data.settings.fov + moveParams.fovBoost,
      scopeFov: slot.def.scopeFov,
    });

    if (rigOut.landImpactSpeed > 0) {
      sfx.playLand(rigOut.landImpactSpeed);
    } else if (rigOut.stepTriggered) {
      const speedRatio = horizSpeed / Math.max(1, BALANCE.walkSpeed);
      sfx.playFootstep(this.currentAcousticEnv.surface, speedRatio, rigOut.stepParity);
    }

    const desiredFov = rigOut.fov + this.fovKick;
    if (Math.abs(this.camera.fov - desiredFov) > 0.02) {
      this.camera.fov = desiredFov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.set(
      this.pos.x + right.x * rigOut.offsetX,
      this.pos.y + this.eyeHeight + rigOut.eyeOffsetY,
      this.pos.z + right.z * rigOut.offsetX,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + this.recoilYaw + rigOut.yawOffset;
    this.camera.rotation.x = THREE.MathUtils.clamp(
      this.pitch + this.recoilPitch + rigOut.pitchOffset,
      -Math.PI / 2 + 0.03,
      Math.PI / 2 - 0.03,
    );
    this.camera.rotation.z = rigOut.rollOffset;
    this.scopeEl.classList.toggle('active', this.scoped);

    const relProg = this.reloading ? (this.elapsed - this.reloadStart) / Math.max(0.05, this.reloadEnd - this.reloadStart) : 0;
    this.viewModel.update(dt, {
      horizSpeed,
      forwardInput: this.forwardInput,
      strafeInput: this.strafeInput,
      grounded: this.grounded,
      velY: this.vel.y,
      crouching: this.crouching,
      reloading: this.reloading,
      reloadProgress: relProg,
      reloadDuration: Math.max(0.1, this.reloadEnd - this.reloadStart),
      scoped: this.scoped,
      ammo: slot.ammo,
      maxAmmo: computeSndMagSize(slot.def, this.mods),
      spinbot: this.mods.spinbotOn,
      fireInterval: slot.def.fireInterval,
    });
  }

  private tryStartInteract(): void {
    const human = this.authority.players.get(this.humanId)!;
    if (this.authority.phase !== 'active' || !human.alive) return;
    const side = this.authority.sideOfTeam(human.team);
    if (side === 'attackers') {
      this.authority.startPlant(this.humanId);
    } else {
      this.authority.startDefuse(this.humanId);
    }
  }

  private canReachPoint(origin: THREE.Vector3, dir: THREE.Vector3, dist: number, allowWallbang: boolean): boolean {
    this.raycaster.set(origin, dir);
    this.raycaster.far = dist;
    const hits = this.raycaster.intersectObjects(this.map.wallMeshes, false);
    if (hits.length === 0) return true;
    if (!allowWallbang || this.mods.wallbangMaxWalls <= 0) return false;
    let wallsCrossed = 0;
    const seenWalls = new Set<THREE.Object3D>();
    for (const h of hits) {
      if (seenWalls.has(h.object)) continue;
      seenWalls.add(h.object);
      const wt = (h.object.userData.wallType as WallType) ?? 'solid';
      if (!canSndPierceWall(wt, this.mods)) return false;
      wallsCrossed++;
      if (wallsCrossed > this.mods.wallbangMaxWalls) return false;
    }
    return true;
  }

  private stepAimbot(dt: number): void {
    if (!this.mods.aimbotOn) return;
    const eye = this.camera.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const maxCos = Math.cos((this.mods.aimbotFovDeg * Math.PI) / 180);

    let best: BotAiActor | null = null;
    let bestScore = -1e9;
    const hp = new THREE.Vector3();

    for (const actor of this.botActors.values()) {
      const ps = this.authority.players.get(actor.playerId);
      if (!ps || !ps.alive || actor.entity.isFriendly) continue;
      actor.entity.getHeadWorldPos(hp);
      const toH = hp.clone().sub(eye);
      const dist = toH.length();
      if (dist < 0.05) continue;
      const dir = toH.clone().divideScalar(dist);
      const dot = fwd.dot(dir);
      if (this.mods.aimbotFovDeg < 179 && dot < maxCos) continue;
      if (!this.canReachPoint(eye, dir, dist, this.mods.aimbotWallLock)) continue;
      const bountyWeight = this.mods.aimbotBountyPrio ? BOUNTY_PAY[actor.entity.bounty] * 100 : 0;
      const sc = bountyWeight + dot * 50 - dist * 0.25;
      if (sc > bestScore) {
        bestScore = sc;
        best = actor;
      }
    }
    if (!best) return;
    best.entity.getHeadWorldPos(hp);
    const dx = hp.x - eye.x;
    const dy = hp.y - eye.y;
    const dz = hp.z - eye.z;
    const ty = Math.atan2(-dx, -dz);
    const tp = Math.atan2(dy, Math.hypot(dx, dz));
    let yd = ty - this.yaw;
    while (yd > Math.PI) yd -= Math.PI * 2;
    while (yd < -Math.PI) yd += Math.PI * 2;
    const k = this.mods.aimbotSnap >= 0.99 ? 1 : 1 - Math.exp(-16 * dt);
    this.yaw += yd * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch + (tp - this.pitch) * k, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  }

  private stepHumanWeapon(dt: number): void {
    this.shotBloom = Math.max(0, this.shotBloom - dt * 4.5);
    const slot = this.slots[this.slotIdx];
    const maxMag = slot ? computeSndMagSize(slot.def, this.mods) : 1;

    if (this.reloading && this.elapsed >= this.reloadEnd) {
      this.reloading = false;
      if (slot) slot.ammo = maxMag;
    }
    if (this.firingHeld && slot) {
      this.fireHoldTime += dt;
      if (slot.def.fullAuto || this.mods.forceAuto) this.tryShoot(false);
    }
    if (this.elapsed <= this.fireBufferUntil && this.elapsed >= this.nextFireAt && !this.reloading) {
      this.tryShoot(false);
    }

    // Triggerbot Auto-Reload when no enemy visible
    if (this.mods.triggerAutoReload && !this.reloading && !this.mods.infiniteAmmo && slot && !slot.def.isMelee) {
      if (slot.ammo < maxMag * 0.4) {
        const anyEnemyVisible = Array.from(this.botActors.values()).some((a) => {
          const ps = this.authority.players.get(a.playerId);
          return ps && ps.alive && !a.entity.isFriendly && this.hasLineOfSight(this.camera.position, a.entity.getHeadWorldPos());
        });
        if (!anyEnemyVisible) this.startReload();
      }
    }
  }

  private stepTriggerbot(dt: number): void {
    if (!this.mods.triggerOn || this.reloading) {
      this.triggerHoverSince = 0;
      return;
    }
    const slot = this.slots[this.slotIdx];
    if (!slot) return;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const hit = this.traceWorldShot(this.camera.position, dir, slot.def.range, this.mods.triggerXray);
    if (
      hit?.botEntity &&
      !hit.botEntity.isFriendly &&
      (!this.mods.triggerHeadOnly || hit.isHead || this.mods.fullBodyHead)
    ) {
      this.triggerHoverSince += dt;
      if (this.triggerHoverSince >= this.mods.triggerDelay) {
        this.tryShoot(true);
      }
    } else {
      this.triggerHoverSince = 0;
    }
  }

  private startReload(): void {
    const slot = this.slots[this.slotIdx];
    if (!slot || slot.def.isMelee || this.reloading || this.mods.infiniteAmmo) return;
    if (slot.ammo >= computeSndMagSize(slot.def, this.mods)) return;
    this.reloading = true;
    this.scoped = false;
    this.reloadStart = this.elapsed;
    this.reloadEnd = this.elapsed + slot.def.reloadTime;
    this.viewModel.onReloadStart();
  }

  private tryShoot(fromTrigger = false): void {
    const human = this.authority.players.get(this.humanId)!;
    if (!human.alive || this.authority.phase !== 'active') return;
    if (this.authority.bomb.interactorId === this.humanId) return;

    const slot = this.slots[this.slotIdx];
    const def = slot.def;
    const maxMag = computeSndMagSize(def, this.mods);
    if (this.reloading) {
      const relProg = (this.elapsed - this.reloadStart) / Math.max(0.05, this.reloadEnd - this.reloadStart);
      if (relProg >= 0.91) {
        this.reloading = false;
        slot.ammo = maxMag;
      } else {
        return;
      }
    }
    const interval = computeSndFireInterval(def, this.mods, fromTrigger);
    if (this.elapsed < this.nextFireAt) return;
    this.fireBufferUntil = 0;

    if (!def.isMelee && !this.mods.infiniteAmmo) {
      if (slot.ammo <= 0) {
        this.viewModel.onDryFire();
        this.startReload();
        return;
      }
      slot.ammo -= 1;
    }
    const isLastBullet = !def.isMelee && !this.mods.infiniteAmmo && slot.ammo === 0;
    this.nextFireAt = this.elapsed + interval;

    sfx.playShot(def.soundType, this.currentAcousticEnv);
    this.viewModel.onFire(isLastBullet);
    this.aiManager.recordSound(this.humanId, human.team, 'gunshot', this.pos, def.isMelee ? 6 : 36, this.elapsed);
    if (!def.isMelee && def.id !== 'shotgun' && def.id !== 'ssg' && def.id !== 'sniper') {
      this.spawnShellCasing(def.id);
    }
    this.fovKick = Math.min(2.6, this.fovKick + (def.id === 'sniper' ? 1.8 : def.id === 'shotgun' ? 1.2 : 0.45));

    const recM = this.mods.recoilMult;
    const pitchKickRad = ((def.recoilKick * Math.PI) / 180) * recM;
    const yawKickRad = (((Math.random() * 2 - 1) * def.recoilYaw * Math.PI) / 180) * recM;
    this.recoilPitch += pitchKickRad * 0.55;
    this.recoilYaw += yawKickRad * 0.55;
    this.cameraRig.onFire(pitchKickRad * 0.65, yawKickRad * 0.65);

    const skin = getSkin(store.data.equippedSkins[def.id]);
    const isGoldBullet = this.mods.piggyGold && Math.random() < 1 / 15;
    const tracerColor = isGoldBullet ? '#facc15' : skin?.tracerColor ?? '#fef08a';
    const muzzle = this.scoped
      ? new THREE.Vector3(0, -0.06, -0.65).applyQuaternion(this.camera.quaternion).add(this.camera.position)
      : this.viewModel.getMuzzleWorldPos();

    // Aimbot Multi-Volley / Lobby Volley burst across living enemies!
    const volleyTriggered = !def.isMelee && this.mods.volleyCount > 0 && this.elapsed >= this.volleyReadyAt;
    if (volleyTriggered) {
      const targets = Array.from(this.botActors.values())
        .filter((a) => {
          const ps = this.authority.players.get(a.playerId);
          if (!ps || !ps.alive || a.entity.isFriendly) return false;
          const hpVec = a.entity.getHeadWorldPos();
          const dist = hpVec.distanceTo(this.camera.position);
          const dir = hpVec.sub(this.camera.position).normalize();
          return this.canReachPoint(this.camera.position, dir, dist, this.mods.aimbotWallLock);
        })
        .sort((a, b) => BOUNTY_PAY[b.entity.bounty] - BOUNTY_PAY[a.entity.bounty])
        .slice(0, this.mods.volleyCount);

      if (targets.length >= 2) {
        this.volleyReadyAt = this.elapsed + this.mods.volleyCooldown;
        this.showBanner(`⚡ AIMBOT VOLLEY x${targets.length}! ⚡`, '#c084fc');
        for (const t of targets) {
          if (this.authority.phase !== 'active') break;
          const hp = t.entity.getHeadWorldPos();
          this.spawnTracer(muzzle, hp, '#c084fc');
          this.applyHumanDamageToBot(t, def, true, false, false, hp, hp.distanceTo(this.camera.position), isLastBullet, true);
        }
        if (this.mods.piggyOn) {
          this.bankCents += computeSndPiggyDeposit(this.mods, true, isGoldBullet, this.fireHoldTime, store.getPrestigeMultiplier());
        }
        if (slot.ammo === 0 && !this.mods.infiniteAmmo) this.startReload();
        return;
      }
    }

    const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    const spread = computeWeaponSpreadDeg({
      def,
      horizSpeed,
      maxMoveSpeed: BALANCE.walkSpeed * def.moveSpeed * this.mods.speedMult,
      grounded: this.grounded,
      crouching: this.crouching,
      scoped: this.scoped,
      shotBloom: this.shotBloom,
      spreadMult: this.mods.spreadMult,
    });
    this.shotBloom = Math.min(def.maxSpread, this.shotBloom + def.spreadPerShot);

    let anyHit = false;
    let killsThisShot = 0;

    for (let p = 0; p < def.pellets; p++) {
      if (this.authority.phase !== 'active') break;
      const dir = new THREE.Vector3(0, 0, -1);
      if (spread.totalDeg > 0.001) {
        const off = sampleSpreadOffsets(spread.totalDeg, spread.moveErrorDeg + spread.airErrorDeg);
        dir.x += off.x;
        dir.y += off.y;
        dir.normalize();
      }
      dir.applyQuaternion(this.camera.quaternion);
      const hit = this.traceWorldShot(this.camera.position, dir, def.range, this.mods.wallbangTier > 0);
      const endPt = hit ? hit.point : this.camera.position.clone().addScaledVector(dir, Math.min(60, def.range));
      if (!def.isMelee) this.spawnTracer(muzzle, endPt, tracerColor);

      if (hit?.botEntity) {
        anyHit = true;
        const actor = Array.from(this.botActors.values()).find((a) => a.entity === hit.botEntity);
        if (actor) {
          const killed = this.applyHumanDamageToBot(
            actor,
            def,
            hit.isHead,
            hit.throughWall,
            hit.isBacktrack,
            hit.point,
            hit.distance,
            isLastBullet,
            false,
          );
          if (killed) killsThisShot++;
        }
      } else if (hit) {
        this.spawnSparks(hit.point, '#cbd5e1', 3);
        if (hit.normal) this.spawnDecal(hit.point, hit.normal);
      }
    }

    if (this.mods.piggyOn && !def.isMelee) {
      this.bankCents += computeSndPiggyDeposit(
        this.mods,
        anyHit,
        isGoldBullet,
        this.fireHoldTime,
        store.getPrestigeMultiplier(),
      );
    }

    if (anyHit) {
      if (killsThisShot >= 2) {
        const bonus = Math.round(BALANCE.creditsPerKill * 2.5 * BALANCE.collateralBonus * store.getPrestigeMultiplier());
        this.earnedKillCents += bonus;
        this.addPayBreakdown('Collateral', bonus, '#38bdf8');
        this.pushPayFeed(`+${formatMoney(bonus)} COLLATERAL!`, '#38bdf8');
      }
    } else {
      this.missesSinceKill++;
    }

    if (!def.isMelee && slot.ammo === 0 && !this.mods.infiniteAmmo) this.startReload();
  }

  private applyHumanDamageToBot(
    actor: BotAiActor,
    def: WeaponDef,
    hitIsHead: boolean,
    throughWall: boolean,
    isBacktrack: boolean,
    point: THREE.Vector3,
    distance: number,
    isLastBullet: boolean,
    fromVolley: boolean,
  ): boolean {
    const ps = this.authority.players.get(actor.playerId);
    if (!ps || !ps.alive) return false;
    const { finalHeadshot, damage } = computeSndShotDamage({
      def,
      mods: this.mods,
      isHead: hitIsHead,
      throughWall,
      isEnemyFriendly: actor.entity.isFriendly,
      isEnemyAdmin: actor.entity.isAdmin,
      isEnemyCheater: actor.entity.isCheaterBot,
      targetHp: ps.hp,
    });

    const res = this.authority.applyDamage(this.humanId, actor.playerId, damage, finalHeadshot, def.id);
    if (res.appliedDamage <= 0) return false;

    this.hitmarkerUntil = this.elapsed + 0.16;
    this.hitmarkerHead = finalHeadshot;
    this.hitmarkerKill = res.killed;
    actor.entity.flashTimer = 0.08;
    this.aiManager.onBotDamaged(actor.playerId, this.pos, this.elapsed);
    sfx.playHit(finalHeadshot || res.killed);
    this.spawnSparks(point, finalHeadshot ? '#facc15' : '#f87171', finalHeadshot ? 9 : 5);

    if (res.killed) {
      const snap = actor.entity.getRagdollSnapshot();
      this.ragdolls.spawnFromBot(snap, this.camera.position, resolveKillKind(def, finalHeadshot, false));
      actor.entity.root.visible = false;
      actor.entity.alive = false;
      actor.entity.clearGhosts();
      if (!actor.entity.isFriendly) {
        this.onHumanEnemyKill(
          actor,
          def,
          finalHeadshot,
          throughWall,
          isBacktrack,
          point,
          distance,
          isLastBullet,
          fromVolley,
        );
      }
    }
    return res.killed;
  }

  private onHumanEnemyKill(
    actor: BotAiActor,
    def: WeaponDef,
    isHead: boolean,
    throughWall: boolean,
    isBacktrack: boolean,
    point: THREE.Vector3,
    distance: number,
    isLastBullet: boolean,
    fromVolley: boolean,
    isExplosion = false,
  ): void {
    const ps = this.authority.players.get(actor.playerId);
    if (this.elapsed - this.lastKillAt <= BALANCE.multiKillWindow) this.multiKill += 1;
    else this.multiKill = 1;
    this.lastKillAt = this.elapsed;

    if (isHead && this.mods.hitboxOn) {
      this.headStreak += 1;
      this.maxStreak = Math.max(this.maxStreak, this.headStreak);
    } else if (!isHead) {
      this.headStreak = 0;
    }

    const skin = getSkin(store.data.equippedSkins[def.id]);
    sfx.playKill(this.headStreak || this.multiKill, skin?.killChime ?? 'default');

    const payout = computeSndKillPayout({
      def,
      mods: this.mods,
      prestigeMult: store.getPrestigeMultiplier(),
      bounty: actor.entity.bounty,
      isAdmin: actor.entity.isAdmin,
      isHead,
      headStreak: this.headStreak,
      throughWall,
      isBacktrack,
      scoped: this.scoped,
      scopedElapsed: this.elapsed - this.scopedAt,
      grounded: this.grounded,
      turnedRecently: this.turnedRecently,
      distance,
      hopChain: this.hopChain,
      missesSinceKill: this.missesSinceKill,
      multiKill: this.multiKill,
      blinkBonusActive: this.elapsed < this.blinkBonusUntil,
      isLastBullet,
      isRevenge: Boolean(ps && ps.name === this.lastKillerName),
    });

    this.earnedKillCents += payout.totalCents;
    for (const line of payout.lines) {
      this.addPayBreakdown(line.label, line.amount, line.color);
    }
    if (ps && ps.name === this.lastKillerName) this.lastKillerName = '';
    this.missesSinceKill = 0;

    if (this.mods.piggyOn && this.mods.piggyInterest > 0 && this.bankCents > 0) {
      this.bankCents *= 1 + this.mods.piggyInterest;
    }

    const feedColor = actor.entity.bounty !== 'normal' ? BOUNTY_COLORS[actor.entity.bounty] : '#4ade80';
    this.pushPayFeed(`+${formatMoney(payout.totalCents)} ${payout.tags.slice(0, 3).join(' · ')}`, feedColor);

    const dropChance = actor.entity.isAdmin
      ? 1.0
      : BALANCE.caseDropChance * (actor.entity.bounty === 'rainbow' ? 5 : 1);
    if (Math.random() < dropChance) {
      const dropped = actor.entity.isAdmin ? { id: 'overdrive', name: 'Overdrive Vault' } : store.rollCaseDrop();
      this.casesDropped.push(dropped.id);
      this.pushPayFeed(`📦 CASE DROP: ${dropped.name}!`, '#facc15');
      sfx.playUi('cash');
    }

    if (actor.entity.isAdmin) {
      this.adminsKilled += 1;
      this.heat = 20;
      this.overwatchBotId = null;
      this.banScanActive = false;
      this.showBanner(`👑 OVERWATCH ADMIN ELIMINIERT! +${formatMoney(payout.totalCents)} & OVERDRIVE CASE!`, '#facc15');
    } else {
      let heatAdd = this.mods.baseHeatPerKill;
      if (throughWall) heatAdd += 7;
      if (fromVolley) heatAdd += 14;
      if (isBacktrack) heatAdd += 6;
      if (this.mods.explodeOnKill) heatAdd += 8;
      if (isHead && this.headStreak >= 4) heatAdd += 4;
      this.heat = Math.min(100, this.heat + heatAdd * this.mods.heatMult);
      this.peakHeat = Math.max(this.peakHeat, this.heat);

      if (this.heat >= 55 && !this.voteActive && this.elapsed >= this.nextVoteAllowedAt && this.authority.phase === 'active') {
        this.triggerVoteKick();
      }
      if (this.heat >= 100 && this.authority.phase === 'active') {
        this.promoteOverwatchAdmin();
        if (!this.banScanActive) {
          this.banScanActive = true;
          this.banScanEndAt = this.elapsed + this.banScanDuration;
          this.showBanner('🚨 OVERWATCH BAN-SCAN GESTARTET (8.5s)!', '#ff1e56');
        }
      }
    }

    if (this.mods.killDash) {
      this.dashUntil = this.elapsed + 1.8;
    }

    if (this.mods.explodeOnKill && !isExplosion) {
      this.triggerCheatExplosion(actor.entity.pos.clone().add(new THREE.Vector3(0, 1, 0)), def, actor);
      if (isBacktrack && this.mods.backtrackChronoBlast) {
        this.triggerCheatExplosion(point.clone(), def, actor);
      }
    }

    if (this.mods.killBlink && this.authority.phase === 'active' && !isExplosion) {
      const next = Array.from(this.botActors.values())
        .filter((a) => {
          const aps = this.authority.players.get(a.playerId);
          return aps && aps.alive && !a.entity.isFriendly && a !== actor;
        })
        .sort((a, b) => a.entity.pos.distanceTo(this.pos) - b.entity.pos.distanceTo(this.pos))[0];

      if (next) {
        const behind = next.entity.pos
          .clone()
          .add(new THREE.Vector3(-Math.sin(next.entity.yaw) * 3.5, 0, -Math.cos(next.entity.yaw) * 3.5));
        resolveCircleWallCollisionRect(behind, 0.5, this.map.walls, this.map.halfX, this.map.halfZ);
        this.pos.copy(behind);
        this.authority.updatePlayerPosition(this.humanId, { x: this.pos.x, y: this.pos.y, z: this.pos.z });
        this.yaw = Math.atan2(-(next.entity.pos.x - this.pos.x), -(next.entity.pos.z - this.pos.z));
        this.blinkFlash = 0.55;
        this.blinkBonusUntil = this.elapsed + 3.0;
        sfx.playBlink();
      }
    }
  }

  private triggerCheatExplosion(center: THREE.Vector3, def: WeaponDef, sourceActor: BotAiActor): void {
    sfx.playExplosion();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#ff4500', transparent: true, opacity: 0.65 }),
    );
    mesh.position.copy(center);
    this.fxGroup.add(mesh);
    const light = new THREE.PointLight('#ff6b2b', 6, 14);
    light.position.copy(center).add(new THREE.Vector3(0, 0.4, 0));
    this.fxGroup.add(light);
    this.explosions.push({ mesh, light, born: this.elapsed, life: 0.36, maxRadius: this.mods.blastRadius });

    for (const other of this.botActors.values()) {
      if (other === sourceActor || other.entity.isFriendly) continue;
      const aps = this.authority.players.get(other.playerId);
      if (!aps || !aps.alive || this.authority.phase !== 'active') continue;
      const d = other.entity.pos.distanceTo(center);
      if (d <= this.mods.blastRadius) {
        const blastDmg = 95 * this.mods.blastDamageMult * (1 - d / (this.mods.blastRadius * 1.25));
        const res = this.authority.applyDamage(this.humanId, other.playerId, blastDmg, false, def.id);
        if (res.killed) {
          const snap = other.entity.getRagdollSnapshot();
          this.ragdolls.spawnFromBot(snap, center, 'explosion');
          other.entity.root.visible = false;
          other.entity.alive = false;
          other.entity.clearGhosts();
          this.onHumanEnemyKill(
            other,
            def,
            false,
            false,
            false,
            other.entity.getBodyWorldPos(),
            d,
            false,
            false,
            true,
          );
        }
      }
    }
  }

  private promoteOverwatchAdmin(): void {
    if (this.overwatchBotId) {
      const prevPs = this.authority.players.get(this.overwatchBotId);
      if (prevPs && prevPs.alive) return;
    }
    const candidate = Array.from(this.botActors.values()).find((a) => {
      const ps = this.authority.players.get(a.playerId);
      return ps && ps.alive && !a.entity.isFriendly;
    });
    if (!candidate) return;
    const cps = this.authority.players.get(candidate.playerId)!;
    this.overwatchBotId = candidate.playerId;
    const adminHp = this.mods.adminJammer ? 110 : 220;
    cps.hp = adminHp;
    candidate.entity.isAdmin = true;
    candidate.entity.bounty = 'admin';
    candidate.entity.maxHealth = adminHp;
    candidate.entity.health = adminHp;
    candidate.entity.root.scale.setScalar(1.45);
    candidate.entity.applyTeamAppearance(this.authority.sideOfTeam(cps.team), false);
    this.showBanner(`🚨 OVERWATCH ADMIN (${cps.name}) HAT DIE LOBBY BETRETEN!`, '#ff1e56');
    sfx.playVoteBallot(true);
  }

  private stepAntiCheat(dt: number): void {
    if (this.heat > 0) {
      this.heat = Math.max(0, this.heat - dt * (this.mods.heatMult < 0.9 ? 1.5 : 0.55));
    }

    if (this.voteActive) {
      while (this.voteActive && this.voteYes + this.voteNo < this.voteTotal && this.elapsed >= this.nextVoteBallotAt) {
        this.nextVoteBallotAt += 1.0;
        const yesProb = THREE.MathUtils.clamp(0.45 + (this.heat - 45) / 85, 0.2, 0.95);
        const isYes = Math.random() < yesProb;
        if (isYes) this.voteYes++;
        else this.voteNo++;
        sfx.playVoteBallot(isYes);
        this.renderVoteOverlay();
        if (this.voteYes >= this.voteNeeded) {
          this.voteActive = false;
          this.voteEl.classList.add('hidden');
          this.finishSndMatch('kicked');
          return;
        }
      }
      if (this.voteActive && (this.voteYes + this.voteNo >= this.voteTotal || this.elapsed >= this.voteEndAt)) {
        this.voteActive = false;
        this.voteEl.classList.add('hidden');
      }
    }

    if (this.banScanActive && this.elapsed >= this.banScanEndAt) {
      this.triggerBanAttempt('VAC OVERWATCH DETECTION');
    }
  }

  private triggerVoteKick(): void {
    this.nextVoteAllowedAt = this.elapsed + 18;
    if (this.mods.voteKickBlocker) {
      const bonus = Math.round(2500 * store.getPrestigeMultiplier());
      this.earnedKillCents += bonus;
      this.addPayBreakdown('Vote-Kick Troll', bonus, '#10b981');
      this.pushPayFeed(`+${formatMoney(bonus)} VOTE-KICK GEBLOCKT!`, '#10b981');
      sfx.playUi('buy');
      return;
    }
    this.voteActive = true;
    this.voteTotal = 5;
    this.voteNeeded = 4;
    this.voteYes = 1;
    this.voteNo = 0;
    this.voteEndAt = this.elapsed + 6.5;
    this.nextVoteBallotAt = this.elapsed + 1.0;
    this.renderVoteOverlay();
    this.voteEl.classList.remove('hidden');
    sfx.playVoteBallot(true);
  }

  private renderVoteOverlay(): void {
    const rem = this.voteTotal - (this.voteYes + this.voteNo);
    const pips = [
      ...Array.from({ length: this.voteYes }, () => '<span class="vk-pip yes">✓</span>'),
      ...Array.from({ length: this.voteNo }, () => '<span class="vk-pip no">✕</span>'),
      ...Array.from({ length: Math.max(0, rem) }, () => '<span class="vk-pip">·</span>'),
    ].join('');
    this.voteEl.innerHTML = `
      <div class="vk-title">⚠ VOTE KICK: DU</div>
      <div class="vk-sub">Grund: "Offensichtlicher Cheater (${Math.round(this.heat)}% Heat)"</div>
      <div class="vk-votes"><span class="vk-yes">JA: ${this.voteYes}</span> · <span class="vk-no">NEIN: ${this.voteNo}</span> · <span style="color:#94a3b8">Ziel ${this.voteNeeded}/${this.voteTotal}</span></div>
      <div class="vk-pips">${pips}</div>
    `;
  }

  private triggerBanAttempt(source: string): boolean {
    if (this.spoofCharges > 0) {
      this.spoofCharges -= 1;
      this.banScanActive = false;
      this.heat = 35;
      const human = this.authority.players.get(this.humanId);
      if (human && human.alive && human.hp <= 0) human.hp = 100;
      this.showBanner(`🛡 HWID SPOOFER BLOCKIERT ${source}! (${this.spoofCharges} ÜBRIG)`, '#10b981');
      sfx.playBlink();
      return true;
    }
    this.banScanActive = false;
    this.finishSndMatch('banned');
    return false;
  }

  private traceWorldShot(origin: THREE.Vector3, dir: THREE.Vector3, range: number, allowWallbang: boolean): {
    botEntity: BotEntity | null;
    isHead: boolean;
    isBacktrack: boolean;
    throughWall: boolean;
    point: THREE.Vector3;
    distance: number;
    normal?: THREE.Vector3;
  } | null {
    this.raycaster.set(origin, dir);
    this.raycaster.far = range;
    const targets: THREE.Object3D[] = [...this.map.wallMeshes];
    for (const a of this.botActors.values()) {
      targets.push(...a.entity.getRaycastTargets(this.mods.hitboxOn && !a.entity.isFriendly));
    }
    const hits = this.raycaster.intersectObjects(targets, false);
    let wallsCrossed = 0;
    const seen = new Set<THREE.Object3D>();
    for (const h of hits) {
      if (h.object.userData.isWall) {
        if (seen.has(h.object)) continue;
        seen.add(h.object);
        const wt = (h.object.userData.wallType as WallType) ?? 'solid';
        if (!allowWallbang || !canSndPierceWall(wt, this.mods) || wallsCrossed >= this.mods.wallbangMaxWalls) {
          const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
          return {
            botEntity: null,
            isHead: false,
            isBacktrack: false,
            throughWall: false,
            point: h.point,
            distance: h.distance,
            normal,
          };
        }
        wallsCrossed++;
        continue;
      }
      const botEntity = h.object.userData.bot as BotEntity | undefined;
      if (botEntity && botEntity.alive) {
        return {
          botEntity,
          isHead: !!h.object.userData.isHead,
          isBacktrack: !!h.object.userData.isBacktrackGhost,
          throughWall: wallsCrossed > 0,
          point: h.point,
          distance: h.distance,
        };
      }
    }
    return null;
  }

  // === 5v5 Modular AI Orchestration (Perception, Decision, NavGrid, Coordination, Recovery) ===
  private stepSndBots(dt: number): void {
    this.aiManager.difficulty = store.data.settings.botDifficulty;
    const isActive = this.authority.phase === 'active';
    const bomb = this.authority.bomb;
    const human = this.authority.players.get(this.humanId);

    const combatants: AiCombatantInput[] = [];
    for (const ps of this.authority.players.values()) {
      if (!ps.connected) continue;
      const actor = ps.isHuman ? null : this.botActors.get(ps.id);
      if (actor) {
        if (!ps.alive) {
          actor.entity.alive = false;
          actor.entity.root.visible = false;
          actor.entity.clearGhosts();
        } else {
          actor.entity.alive = true;
          const hideForFirstPersonSpec = Boolean(
            human && !human.alive && this.spectateMode === 'first' && this.spectateTargetId === actor.playerId,
          );
          actor.entity.root.visible = !hideForFirstPersonSpec;
          actor.entity.applyCheatVisuals(
            actor.entity.isFriendly ? 1.0 : this.mods.headScale,
            actor.entity.isFriendly ? false : this.mods.headBalloon,
            this.mods.headBoxColor,
            actor.entity.isFriendly ? false : this.mods.chams,
            store.data.settings.enemyOutlines,
            store.data.settings.outlineColor,
          );
          actor.entity.updateGhosts(
            this.elapsed,
            isActive && this.mods.backtrackOn && !actor.entity.isFriendly,
            this.mods.backtrackWindow,
          );
          actor.entity.updateLOD(this.camera.position);

          // Backtrack Lag-Switch Peek: freeze enemy bots for 0.7s on first spot!
          if (!actor.entity.isFriendly && isActive) {
            const seesHuman =
              human?.alive &&
              this.hasLineOfSight(actor.entity.getHeadWorldPos(), this.camera.position) &&
              actor.entity.pos.distanceTo(this.pos) <= BALANCE.botSightRange;
            if (seesHuman && actor.entity.seenPlayerSince === 0) {
              actor.entity.seenPlayerSince = this.elapsed;
              if (this.mods.backtrackFreezePeek) {
                actor.entity.freezeUntil = this.elapsed + 0.7;
              }
            } else if (!seesHuman) {
              actor.entity.seenPlayerSince = 0;
            }
          }
        }
      }

      const wDef = getWeaponDef(ps.primaryWeapon ?? ps.secondaryWeapon ?? 'pistol');
      const actorMaxHp = actor?.entity.isAdmin ? actor.entity.maxHealth : 100;
      combatants.push({
        id: ps.id,
        name: ps.name,
        team: ps.team,
        side: this.authority.sideOfTeam(ps.team),
        isHuman: ps.isHuman,
        alive: ps.alive,
        hp: ps.hp,
        maxHp: actorMaxHp,
        pos: ps.isHuman ? { x: this.pos.x, y: this.pos.y, z: this.pos.z } : (actor?.entity.pos ?? ps.pos),
        vel: ps.isHuman ? { x: this.vel.x, y: 0, z: this.vel.z } : (actor?.entity.actualVel ?? { x: 0, y: 0, z: 0 }),
        yaw: ps.isHuman ? this.yaw + Math.PI : (actor?.entity.yaw ?? 0),
        hasBomb: bomb.carrierId === ps.id,
        hasDefuseKit: ps.hasDefuseKit,
        weaponRange: wDef.range,
        fireInterval: wDef.fireInterval,
        damage: wDef.damage,
        isAdmin: actor?.entity.isAdmin ?? false,
        isCheater: actor?.entity.isCheaterBot ?? false,
        isRainbow: actor?.entity.bounty === 'rainbow',
        freezeUntil: actor?.entity.freezeUntil ?? 0,
      });
    }

    const worldApi: WorldQueryApi = {
      hasLineOfSight: (from, to) =>
        this.hasLineOfSight(new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z)),
      getTime: () => this.elapsed,
    };

    const cmds = this.aiManager.update(
      dt,
      this.elapsed,
      combatants,
      {
        phase: this.authority.phase,
        phaseTimer: this.authority.phaseTimer,
        attackersTeam: this.authority.attackersTeam,
        defendersTeam: this.authority.defendersTeam,
        siteA: this.map.siteA,
        siteB: this.map.siteB,
        midPos: this.map.midPos,
        bombState: bomb.state,
        bombSite: bomb.site,
        bombPos: bomb.pos,
        carrierId: bomb.carrierId,
        interactorId: bomb.interactorId,
        bombDetonateTimer: bomb.detonateTimer,
        roundTargetSite: this.roundTargetSite,
      },
      worldApi,
      BALANCE.botMoveSpeed,
    );

    for (const [pid, cmd] of cmds.entries()) {
      const actor = this.botActors.get(pid);
      const ps = this.authority.players.get(pid);
      if (!actor || !ps || !ps.alive) continue;

      if (!isActive) {
        actor.entity.applyLocomotion(dt, ps.pos, actor.entity.yaw, cmd.turnRateRadSec, false, false);
        continue;
      }

      const botGroundY = this.map.sampleGroundHeight ? this.map.sampleGroundHeight(cmd.nextPos.x, cmd.nextPos.z, actor.entity.pos.y) : 0;
      actor.entity.applyLocomotion(
        dt,
        cmd.nextPos,
        cmd.targetYaw,
        cmd.turnRateRadSec,
        cmd.isSpinVisual,
        cmd.isBunnyHop,
        false,
        botGroundY,
      );
      this.authority.updatePlayerPosition(ps.id, { x: cmd.nextPos.x, y: botGroundY, z: cmd.nextPos.z });

      const interacting = bomb.interactorId === ps.id;
      if (!interacting && cmd.wantsPlant) {
        this.authority.startPlant(ps.id);
      } else if (!interacting && cmd.wantsDefuse) {
        this.authority.startDefuse(ps.id);
      }

      if (cmd.shouldFire && cmd.targetActorId && cmd.aimPoint) {
        const vic = this.authority.players.get(cmd.targetActorId);
        if (vic && vic.alive && !(vic.isHuman && this.elapsed < actor.entity.freezeUntil)) {
          const aimVec = new THREE.Vector3(cmd.aimPoint.x, cmd.aimPoint.y, cmd.aimPoint.z);
          const dist = actor.entity.getHeadWorldPos().distanceTo(aimVec);
          this.onBotShootTarget(actor, vic, aimVec, dist);
        }
      }
    }
  }

  private getOccludingWalls(from: THREE.Vector3, to: THREE.Vector3): WallType[] {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.1) return [];
    dir.divideScalar(dist);
    this.raycaster.set(from, dir);
    this.raycaster.far = dist;
    const hits = this.raycaster.intersectObjects(this.map.wallMeshes, false);
    const seen = new Set<THREE.Object3D>();
    const out: WallType[] = [];
    for (const h of hits) {
      if (!h.object.userData.isWall || seen.has(h.object)) continue;
      seen.add(h.object);
      out.push((h.object.userData.wallType as WallType) ?? 'solid');
      if (out.length >= 4) break;
    }
    return out;
  }

  private computeStereoPan(sourcePos: THREE.Vector3): number {
    const dx = sourcePos.x - this.camera.position.x;
    const dz = sourcePos.z - this.camera.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return 0;
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    return THREE.MathUtils.clamp((dx * rightX + dz * rightZ) / len, -0.92, 0.92);
  }

  private onBotShootTarget(actor: BotAiActor, victim: SndPlayerState, targetPos: THREE.Vector3, dist: number): void {
    if (actor.entity.bounty === 'rainbow') return;
    const shooter = this.authority.players.get(actor.playerId)!;
    const weaponId = shooter.primaryWeapon ?? 'pistol';
    const def = getWeaponDef(weaponId);
    const diffCfg = BOT_DIFFICULTIES[store.data.settings.botDifficulty];

    actor.entity.onFireVisual();
    this.aiManager.recordSound(shooter.id, shooter.team, 'gunshot', actor.entity.pos, 36, this.elapsed);

    const human = this.authority.players.get(this.humanId);
    if (human && !human.alive && this.spectateMode === 'first' && this.spectateTargetId === actor.playerId) {
      this.viewModel.onFire(false);
    }
    const muzzle = actor.entity.getMuzzleWorldPos();
    const scatter = Math.max(0.18, (diffCfg.aimErrorDeg / 180) * dist * 0.55);
    const tracerEnd = targetPos.clone().add(
      new THREE.Vector3((Math.random() - 0.5) * scatter, (Math.random() - 0.5) * scatter, (Math.random() - 0.5) * scatter),
    );
    const tracerCol = actor.entity.isAdmin
      ? '#ff1e56'
      : this.authority.sideOfTeam(shooter.team) === 'attackers'
        ? '#fb923c'
        : '#38bdf8';
    this.spawnTracer(muzzle, tracerEnd, tracerCol);

    const camDist = muzzle.distanceTo(this.camera.position);
    if (camDist < 78) {
      const occ = this.getOccludingWalls(muzzle, this.camera.position);
      const srcEnv = probeAcousticEnvironment(muzzle, this.map.walls, {
        sndGrid: this.map.grid,
        theme: this.map.meta.theme,
      });
      const soundId = actor.entity.isAdmin ? 'sniper' : def.soundType;
      sfx.playSpatialShot(soundId, muzzle, camDist, occ, srcEnv.zone, this.computeStereoPan(muzzle), actor.entity.isAdmin);
    }

    const baseAcc = store.data.settings.botDifficulty === 'easy'
      ? 0.34
      : store.data.settings.botDifficulty === 'hard'
        ? 0.52
        : store.data.settings.botDifficulty === 'expert'
          ? 0.58
          : 0.44;
    let hitProb = THREE.MathUtils.clamp(baseAcc - dist * 0.0075, 0.12, 0.58);
    if (actor.entity.isAdmin) hitProb = 0.65;
    if (victim.isHuman) {
      hitProb = computeSndBotHitChance(hitProb, this.mods, Math.hypot(this.vel.x, this.vel.z), this.hopChain);
    }
    if (Math.random() > hitProb) return;

    const isHead = Math.random() < (store.data.settings.botDifficulty === 'expert' ? 0.24 : 0.16);
    const baseDmg = actor.entity.isAdmin ? Math.max(32, def.damage) : def.damage;
    const dmg = Math.min(48, baseDmg * (isHead ? 1.55 : 0.85));

    if (victim.isHuman && actor.entity.isAdmin) {
      const postArmor = victim.armor > 0 ? dmg * (isHead && victim.hasHelmet ? 0.8 : !isHead ? 0.75 : 1) : dmg;
      if (postArmor >= victim.hp) {
        if (this.triggerBanAttempt('OVERWATCH ADMIN')) return;
      }
    }

    const res = this.authority.applyDamage(shooter.id, victim.id, dmg, isHead, weaponId);

    if (victim.isHuman && res.appliedDamage > 0) {
      this.hurtFlash = 0.6;
      this.cameraRig.onHitFlinch(THREE.MathUtils.clamp(res.appliedDamage / 35, 0.35, 1.25));
      this.dmgIndicators.push({ from: actor.entity.pos.clone(), until: this.elapsed + 0.85 });
      sfx.playHurt();
    } else if (!victim.isHuman && res.appliedDamage > 0) {
      this.aiManager.onBotDamaged(victim.id, actor.entity.pos, this.elapsed);
      if (res.killed) {
        const vicActor = this.botActors.get(victim.id);
        if (vicActor) {
          const snap = vicActor.entity.getRagdollSnapshot();
          this.ragdolls.spawnFromBot(snap, actor.entity.pos, resolveKillKind(def, isHead, false));
          vicActor.entity.alive = false;
          vicActor.entity.root.visible = false;
          vicActor.entity.clearGhosts();
        }
      }
    }
  }

  private hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.05) return true;
    this.raycaster.set(from, dir.divideScalar(dist));
    this.raycaster.far = dist;
    const hits = this.raycaster.intersectObjects(this.map.wallMeshes, false);
    return hits.length === 0;
  }

  // === Spectator Mode ===
  private enterSpectatorMode(): void {
    this.spectateTargetId = null;
    this.cycleSpectatorTarget(1);
    if (!this.spectateTargetId) {
      this.spectateMode = 'free';
      this.freeCamPos.set(this.pos.x, Math.max(2.2, this.pos.y + 2.2), this.pos.z);
    } else {
      this.spectateMode = 'first';
    }
  }

  private getSpectatablePlayers(): SndPlayerState[] {
    const human = this.authority.players.get(this.humanId)!;
    return Array.from(this.authority.players.values()).filter(
      (p) => !p.isHuman && p.alive && p.connected && (this.authority.rules.spectateEnemiesAllowed || p.team === human.team),
    );
  }

  private cycleSpectatorTarget(dir: number): void {
    const list = this.getSpectatablePlayers();
    if (list.length === 0) {
      this.spectateTargetId = null;
      this.spectateMode = 'free';
      this.spectateWeaponId = null;
      return;
    }
    const curIdx = list.findIndex((p) => p.id === this.spectateTargetId);
    const nextIdx = curIdx < 0 ? 0 : (curIdx + dir + list.length) % list.length;
    this.spectateTargetId = list[nextIdx].id;
    const actor = this.botActors.get(this.spectateTargetId);
    if (actor) this.spectateCamYaw = actor.entity.yaw + Math.PI;
    this.spectateWeaponId = null;
    if (this.spectateMode === 'free') this.spectateMode = 'first';
  }

  private cycleSpectatorMode(): void {
    const list = this.getSpectatablePlayers();
    if (list.length === 0) {
      this.spectateMode = 'free';
      return;
    }
    if (this.spectateMode === 'first') this.spectateMode = 'third';
    else if (this.spectateMode === 'third') {
      this.spectateMode = 'free';
      this.freeCamPos.copy(this.camera.position);
    } else {
      this.spectateMode = 'first';
    }
  }

  private stepSpectatorCamera(dt: number): void {
    // Smoothly reset FOV when spectating after dying scoped
    const baseFov = store.data.settings.fov;
    if (Math.abs(this.camera.fov - baseFov) > 0.1) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, baseFov, Math.min(1, dt * 12));
      this.camera.updateProjectionMatrix();
    }

    const target = this.spectateTargetId ? this.authority.players.get(this.spectateTargetId) : null;
    if (this.spectateMode !== 'free' && (!target || !target.alive)) {
      this.cycleSpectatorTarget(1);
      if (!this.spectateTargetId) {
        this.spectateMode = 'free';
        this.freeCamPos.copy(this.camera.position);
      }
    }

    if (this.spectateMode === 'free' || !this.spectateTargetId) {
      this.viewModel.root.visible = false;
      const f = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
      const r = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
      const u = (this.keys.has('KeyE') ? 1 : 0) - (this.keys.has('ControlLeft') ? 1 : 0);
      const fwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
      this.freeCamPos.addScaledVector(fwd, f * 14 * dt).addScaledVector(right, r * 14 * dt);
      this.freeCamPos.y = THREE.MathUtils.clamp(this.freeCamPos.y + u * 10 * dt, 0.8, 22);
      this.freeCamPos.x = THREE.MathUtils.clamp(this.freeCamPos.x, -this.map.halfX + 1, this.map.halfX - 1);
      this.freeCamPos.z = THREE.MathUtils.clamp(this.freeCamPos.z, -this.map.halfZ + 1, this.map.halfZ - 1);
      this.camera.position.copy(this.freeCamPos);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      return;
    }

    const actor = this.botActors.get(this.spectateTargetId!);
    const specPlayer = this.authority.players.get(this.spectateTargetId!);
    if (!actor || !specPlayer) {
      this.viewModel.root.visible = false;
      return;
    }

    if (this.spectateMode === 'first') {
      // Hide spectated bot body/head/helmet/outlines so camera never clips inside skull!
      actor.entity.root.visible = false;

      // Shortest-angle slerp toward bot's look yaw
      const desiredYaw = actor.entity.yaw + Math.PI;
      let diff = ((desiredYaw - this.spectateCamYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (diff < -Math.PI) diff += Math.PI * 2;
      this.spectateCamYaw += diff * Math.min(1, dt * 14);

      this.camera.position.set(actor.entity.pos.x, actor.entity.pos.y + 1.62, actor.entity.pos.z);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(-0.04, this.spectateCamYaw, 0, 'YXZ');

      // Show first-person weapon viewmodel matching spectated player's gun
      const wid = specPlayer.primaryWeapon ?? specPlayer.secondaryWeapon ?? 'pistol';
      const wDef = getWeaponDef(wid);
      if (this.spectateWeaponId !== wid) {
        this.spectateWeaponId = wid;
        const skin = getSkin(store.data.equippedSkins[wid]);
        this.viewModel.equip(wDef, skin);
      }
      this.viewModel.root.visible = true;
      this.viewModel.update(dt, {
        horizSpeed: specPlayer.alive ? 3.2 : 0,
        forwardInput: specPlayer.alive ? 1 : 0,
        strafeInput: 0,
        grounded: true,
        velY: 0,
        crouching: false,
        reloading: false,
        reloadProgress: 0,
        reloadDuration: 1,
        scoped: false,
        ammo: wDef.magazineSize,
        maxAmmo: wDef.magazineSize,
        spinbot: false,
        fireInterval: wDef.fireInterval,
      });
    } else {
      this.viewModel.root.visible = false;
      actor.entity.root.visible = true;

      const dist = 3.5;
      const offset = new THREE.Vector3(
        Math.sin(this.spectateOrbitYaw) * Math.cos(this.spectateOrbitPitch) * dist,
        0.55 + Math.sin(this.spectateOrbitPitch) * dist,
        Math.cos(this.spectateOrbitYaw) * Math.cos(this.spectateOrbitPitch) * dist,
      );
      const lookAt = actor.entity.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
      const rayDir = offset.clone().normalize();
      const rayLen = offset.length();
      this.raycaster.set(lookAt, rayDir);
      this.raycaster.far = rayLen;
      const wallHits = this.raycaster.intersectObjects(this.map.wallMeshes, false);
      const safeDist = wallHits.length > 0 ? Math.max(0.75, wallHits[0].distance - 0.35) : rayLen;
      const finalPos = lookAt.clone().addScaledVector(rayDir, safeDist);
      finalPos.y = Math.max(0.65, finalPos.y);
      finalPos.x = THREE.MathUtils.clamp(finalPos.x, -this.map.halfX + 0.6, this.map.halfX - 0.6);
      finalPos.z = THREE.MathUtils.clamp(finalPos.z, -this.map.halfZ + 0.6, this.map.halfZ - 0.6);
      this.camera.position.copy(finalPos);
      this.camera.lookAt(lookAt);
    }
  }

  // === Bomb 3D Visuals & C4 Beep Timing ===
  private stepBombVisualsAndAudio(dt: number): void {
    const b = this.authority.bomb;
    const show3d = b.state === 'dropped' || b.state === 'planted' || b.state === 'defusing';
    this.bombGroup.visible = show3d;
    if (show3d) {
      this.bombGroup.position.set(b.pos.x, 0, b.pos.z);
      const isPlanted = b.state === 'planted' || b.state === 'defusing';
      this.bombRing.visible = b.state === 'dropped';
      (this.bombLed.material as THREE.MeshBasicMaterial).color.set(isPlanted ? '#ef4444' : '#facc15');
      if (isPlanted && this.authority.phase === 'active') {
        if (this.elapsed >= this.nextBombBeepAt) {
          const frac = THREE.MathUtils.clamp(b.detonateTimer / Math.max(1, b.detonateDuration), 0, 1);
          const interval = 0.14 + frac * 0.86;
          this.nextBombBeepAt = this.elapsed + interval;
          sfx.playSndEvent('bomb_beep');
          this.aiManager.recordSound('bomb', 'bomb', 'bomb_beep', b.pos, 24, this.elapsed);
          this.bombLed.scale.setScalar(1.8);
        } else {
          this.bombLed.scale.lerp(new THREE.Vector3(1, 1, 1), Math.min(1, dt * 16));
        }
      }
    }

    if (this.bombExplosion) {
      this.bombExplosion.age += dt;
      const u = Math.min(1, this.bombExplosion.age / 1.4);
      this.bombExplosion.mesh.scale.setScalar(1 + u * 22);
      (this.bombExplosion.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - u);
      this.bombExplosion.light.intensity = 14 * (1 - u);
      if (u >= 1) {
        this.scene.remove(this.bombExplosion.mesh);
        this.scene.remove(this.bombExplosion.light);
        this.bombExplosion.mesh.geometry.dispose();
        (this.bombExplosion.mesh.material as THREE.Material).dispose();
        this.bombExplosion = null;
      }
    }
  }

  private triggerBombDetonationVfx(at: { x: number; y: number; z: number }): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 16),
      new THREE.MeshBasicMaterial({ color: '#ff5500', transparent: true, opacity: 0.85 }),
    );
    mesh.position.set(at.x, 0.5, at.z);
    const light = new THREE.PointLight('#ff6b2b', 14, 38);
    light.position.set(at.x, 3, at.z);
    this.scene.add(mesh, light);
    this.bombExplosion = { mesh, light, age: 0 };
  }

  // === Tracers, Decals, Shell Casings ===
  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3, color: string): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    this.fxGroup.add(line);
    this.tracers.push({ line, dieAt: this.elapsed + 0.08 });
  }

  private spawnSparks(at: THREE.Vector3, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshBasicMaterial({ color }));
      m.position.copy(at);
      this.fxGroup.add(m);
      this.casings.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5 + 1, (Math.random() - 0.5) * 6),
        rotVel: new THREE.Vector3(6, 6, 6),
        dieAt: this.elapsed + 0.25,
        isShotgun: false,
        bounceCount: 99,
        lastBounceAt: 0,
      });
    }
  }

  private spawnDecal(point: THREE.Vector3, normal: THREE.Vector3): void {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(0.05, 8),
      new THREE.MeshBasicMaterial({ color: '#0f172a', depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
    m.position.copy(point).addScaledVector(normal, 0.012);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    this.fxGroup.add(m);
    this.decals.push(m);
    if (this.decals.length > 50) {
      const old = this.decals.shift()!;
      this.fxGroup.remove(old);
      old.geometry.dispose();
      (old.material as THREE.Material).dispose();
    }
  }

  private spawnShellCasing(weaponId: string): void {
    const isShotgun = weaponId === 'shotgun';
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(isShotgun ? 0.011 : 0.0075, isShotgun ? 0.011 : 0.0075, isShotgun ? 0.042 : 0.028, 7),
      new THREE.MeshStandardMaterial({ color: isShotgun ? '#991b1b' : '#d4a64a', metalness: isShotgun ? 0.1 : 0.9, roughness: isShotgun ? 0.44 : 0.22 }),
    );
    mesh.position.copy(this.scoped ? this.camera.position : this.viewModel.getEjectionWorldPos());
    this.fxGroup.add(mesh);
    this.casings.push({
      mesh,
      vel: new THREE.Vector3(1.8 + Math.random(), 1.5 + Math.random() * 0.8, 0.4).applyQuaternion(this.camera.quaternion),
      rotVel: new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18),
      dieAt: this.elapsed + 2.8,
      isShotgun,
      bounceCount: 0,
      lastBounceAt: -10,
    });
  }

  private stepFx(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      if (this.elapsed >= this.tracers[i].dieAt) {
        const t = this.tracers.splice(i, 1)[0];
        this.fxGroup.remove(t.line);
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
      }
    }
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i];
      const u = (this.elapsed - ex.born) / ex.life;
      if (u >= 1) {
        this.fxGroup.remove(ex.mesh);
        if (ex.light) this.fxGroup.remove(ex.light);
        ex.mesh.geometry.dispose();
        (ex.mesh.material as THREE.Material).dispose();
        this.explosions.splice(i, 1);
      } else {
        ex.mesh.scale.setScalar(0.5 + ex.maxRadius * u);
        (ex.mesh.material as THREE.MeshBasicMaterial).opacity = 0.65 * (1 - u);
        if (ex.light) ex.light.intensity = 6 * (1 - u);
      }
    }
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      if (this.elapsed >= c.dieAt) {
        this.fxGroup.remove(c.mesh);
        c.mesh.geometry.dispose();
        (c.mesh.material as THREE.Material).dispose();
        this.casings.splice(i, 1);
      } else {
        c.vel.y -= 15 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        if (c.mesh.position.y < 0.015) {
          c.mesh.position.y = 0.015;
          if (c.bounceCount < 3 && Math.abs(c.vel.y) > 0.35 && this.elapsed - c.lastBounceAt > 0.055) {
            c.bounceCount += 1;
            c.lastBounceAt = this.elapsed;
            sfx.playCasingClink(c.isShotgun, c.bounceCount, this.currentAcousticEnv.surface, this.computeStereoPan(c.mesh.position));
            const restit = c.bounceCount === 1 ? 0.45 : c.bounceCount === 2 ? 0.36 : 0.24;
            c.vel.y = Math.abs(c.vel.y) * restit;
            c.vel.x *= 0.68;
            c.vel.z *= 0.68;
            c.rotVel.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
          } else if (Math.abs(c.vel.y) < 0.25 && c.bounceCount >= 2) {
            c.vel.set(0, 0, 0);
            c.rotVel.multiplyScalar(0.5);
          } else {
            c.vel.y = Math.abs(c.vel.y) * 0.25;
            c.vel.x *= 0.65;
            c.vel.z *= 0.65;
          }
        }
        c.mesh.rotation.x += c.rotVel.x * dt;
        c.mesh.rotation.y += c.rotVel.y * dt;
        c.mesh.rotation.z += c.rotVel.z * dt;
      }
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    this.hurtEl.style.opacity = String(this.hurtFlash * 0.55);
  }

  // === 2D Overlay (Site Markers, Teammate Tags, Radial Plant/Defuse Ring, Crosshair) ===
  private drawOverlay2D(): void {
    const ctx = this.octx;
    const w = this.overlayCanvas.width;
    const h = this.overlayCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const human = this.authority.players.get(this.humanId)!;
    const mySide = this.authority.sideOfTeam(human.team);

    const projectBadge = (worldPos: THREE.Vector3, label: string, color: string) => {
      const p = worldPos.clone().project(this.camera);
      if (p.z > 1) return;
      const sx = THREE.MathUtils.clamp((p.x * 0.5 + 0.5) * w, 28, w - 28);
      const sy = THREE.MathUtils.clamp((-p.y * 0.5 + 0.5) * h, 70, h - 40);
      ctx.fillStyle = 'rgba(9,13,20,0.75)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.fillRect(sx - 18, sy - 12, 36, 20);
      ctx.strokeRect(sx - 18, sy - 12, 36, 20);
      ctx.fillStyle = color;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, sx, sy + 2);
    };

    projectBadge(new THREE.Vector3(this.map.siteA.pos.x, 2.6, this.map.siteA.pos.z), 'A', '#f59e0b');
    projectBadge(new THREE.Vector3(this.map.siteB.pos.x, 2.6, this.map.siteB.pos.z), 'B', '#38bdf8');

    const b = this.authority.bomb;
    if (b.state === 'dropped' && mySide === 'attackers') {
      projectBadge(new THREE.Vector3(b.pos.x, 1.4, b.pos.z), 'C4', '#facc15');
    } else if (b.state === 'planted' || b.state === 'defusing') {
      projectBadge(new THREE.Vector3(b.pos.x, 1.5, b.pos.z), 'C4!', '#ef4444');
    }

    // Friendly teammate icons + Rich 2D Enemy ESP (bounty color, HP bar, brackets, distance)
    for (const actor of this.botActors.values()) {
      const ps = this.authority.players.get(actor.playerId);
      if (!ps || !ps.alive) continue;
      if (actor.entity.isFriendly) {
        const hpPos = actor.entity.getHeadWorldPos().add(new THREE.Vector3(0, 0.45, 0));
        const p = hpPos.project(this.camera);
        if (p.z <= 1) {
          const sx = (p.x * 0.5 + 0.5) * w;
          const sy = (-p.y * 0.5 + 0.5) * h;
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = ps.id === b.carrierId ? '#facc15' : '#4ade80';
          ctx.fillText(`${ps.name}${ps.id === b.carrierId ? ' [C4]' : ''} (${Math.ceil(ps.hp)})`, sx, sy);
        }
      } else if (this.mods.espBoxes) {
        const scale = actor.entity.isAdmin ? 1.45 : 1;
        const top = new THREE.Vector3(actor.entity.pos.x, actor.entity.pos.y + 2.05 * scale, actor.entity.pos.z).project(this.camera);
        const bot = new THREE.Vector3(actor.entity.pos.x, actor.entity.pos.y, actor.entity.pos.z).project(this.camera);
        if (top.z <= 1 && bot.z <= 1) {
          const sx = (top.x * 0.5 + 0.5) * w;
          const syTop = (-top.y * 0.5 + 0.5) * h;
          const syBot = (-bot.y * 0.5 + 0.5) * h;
          const boxH = Math.max(18, syBot - syTop);
          const boxW = boxH * 0.55;
          const x = sx - boxW / 2;
          const y = syTop;

          const visible = this.hasLineOfSight(this.camera.position, actor.entity.getHeadWorldPos());
          const col = actor.entity.bounty === 'rainbow'
            ? `hsl(${(performance.now() * 0.25) % 360}, 95%, 60%)`
            : actor.entity.isAdmin
              ? '#ff1e56'
              : actor.entity.bounty === 'normal'
                ? (visible ? '#4ade80' : '#94a3b8')
                : BOUNTY_COLORS[actor.entity.bounty];

          const cLen = Math.min(12, boxW * 0.3);
          ctx.strokeStyle = col;
          ctx.lineWidth = actor.entity.bounty !== 'normal' ? 2.4 : 1.7;
          ctx.beginPath();
          ctx.moveTo(x, y + cLen); ctx.lineTo(x, y); ctx.lineTo(x + cLen, y);
          ctx.moveTo(x + boxW - cLen, y); ctx.lineTo(x + boxW, y); ctx.lineTo(x + boxW, y + cLen);
          ctx.moveTo(x, y + boxH - cLen); ctx.lineTo(x, y + boxH); ctx.lineTo(x + cLen, y + boxH);
          ctx.moveTo(x + boxW - cLen, y + boxH); ctx.lineTo(x + boxW, y + boxH); ctx.lineTo(x + boxW, y + boxH - cLen);
          ctx.stroke();

          const hpFrac = THREE.MathUtils.clamp(ps.hp / Math.max(1, actor.entity.maxHealth), 0, 1);
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(x - 6, y, 3, boxH);
          ctx.fillStyle = hpFrac > 0.5 ? '#4ade80' : hpFrac > 0.25 ? '#facc15' : '#ef4444';
          ctx.fillRect(x - 6, y + boxH * (1 - hpFrac), 3, boxH * hpFrac);

          const dist = Math.round(actor.entity.pos.distanceTo(this.pos));
          const badge = actor.entity.isAdmin
            ? '⚠ ADMIN 75x'
            : actor.entity.bounty !== 'normal'
              ? `★ ${BOUNTY_PAY[actor.entity.bounty]}x`
              : '';
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = col;
          ctx.fillText(`${ps.name}${badge ? ` ${badge}` : ''}`, sx, y - 5);
          ctx.font = '10px monospace';
          ctx.fillStyle = 'rgba(226,232,240,0.85)';
          ctx.fillText(`${dist}m`, sx, y + boxH + 11);
        }
      }
    }

    // Aimbot FOV Circle
    if (human.alive && this.mods.aimbotRing && this.mods.aimbotFovDeg < 179) {
      const fovRad = (this.camera.fov * Math.PI) / 180;
      const aimRad = (this.mods.aimbotFovDeg * Math.PI) / 180;
      const radiusPx = Math.min(h * 0.48, (Math.tan(aimRad / 2) / Math.tan(fovRad / 2)) * (h / 2));
      ctx.strokeStyle = 'rgba(192,132,252,0.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, radiusPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Crosshair (alive & unscoped)
    if (human.alive && !this.scoped && !this.buyMenuOpen) {
      const xh = store.data.settings.crosshair;
      const cx = w / 2;
      const cy = h / 2;
      const gap = xh.gap + (xh.dynamic ? this.crosshairSpreadPx : 0);
      const drawR = (rx: number, ry: number, rw: number, rh: number) => {
        if (xh.outline) {
          ctx.fillStyle = 'rgba(0,0,0,0.8)';
          ctx.fillRect(rx - 1, ry - 1, rw + 2, rh + 2);
        }
        ctx.fillStyle = xh.color;
        ctx.fillRect(rx, ry, rw, rh);
      };
      drawR(cx - gap - xh.length, cy - xh.thickness / 2, xh.length, xh.thickness);
      drawR(cx + gap, cy - xh.thickness / 2, xh.length, xh.thickness);
      drawR(cx - xh.thickness / 2, cy - gap - xh.length, xh.thickness, xh.length);
      drawR(cx - xh.thickness / 2, cy + gap, xh.thickness, xh.length);
      if (xh.dot) drawR(cx - xh.thickness / 2, cy - xh.thickness / 2, xh.thickness, xh.thickness);
    }

    // Radial Plant / Defuse Progress Ring
    if ((b.state === 'planting' || b.state === 'defusing') && b.interactorId === this.humanId) {
      const cx = w / 2;
      const cy = h / 2 + 65;
      ctx.beginPath();
      ctx.arc(cx, cy, 26, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(15,23,42,0.85)';
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 26, -Math.PI / 2, -Math.PI / 2 + b.progress * Math.PI * 2);
      ctx.strokeStyle = b.state === 'planting' ? '#f59e0b' : '#38bdf8';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.fillText(b.state === 'planting' ? `PLANTING ${Math.round(b.progress * 100)}%` : `DEFUSING ${Math.round(b.progress * 100)}%`, cx, cy + 42);
    }

    // Hitmarker X
    if (this.elapsed < this.hitmarkerUntil) {
      const cx = w / 2;
      const cy = h / 2;
      ctx.strokeStyle = this.hitmarkerKill ? '#facc15' : this.hitmarkerHead ? '#ef4444' : '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy - 12); ctx.lineTo(cx - 5, cy - 5);
      ctx.moveTo(cx + 12, cy - 12); ctx.lineTo(cx + 5, cy - 5);
      ctx.moveTo(cx - 12, cy + 12); ctx.lineTo(cx - 5, cy + 5);
      ctx.moveTo(cx + 12, cy + 12); ctx.lineTo(cx + 5, cy + 5);
      ctx.stroke();
    }

    // Directional Damage Arcs
    this.dmgIndicators = this.dmgIndicators.filter((d) => this.elapsed < d.until);
    if (this.dmgIndicators.length > 0 && human.alive) {
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      for (const ind of this.dmgIndicators) {
        const toSrc = new THREE.Vector3(ind.from.x - this.pos.x, 0, ind.from.z - this.pos.z).normalize();
        const ang = Math.atan2(-fwd.dot(toSrc), right.dot(toSrc));
        ctx.save();
        ctx.strokeStyle = 'rgba(239,68,68,0.85)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.16, ang - 0.34, ang + 0.34);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Live Top-Left Tactical Radar Minimap + Callout Label
    this.drawTacticalMinimap(ctx, human, mySide);

    // Optional Modular AI Debug Overlay [F3]
    this.aiDebug.render(store.data.settings.aiDebugOverlay, ctx, w, h, this.camera, this.aiManager);
  }

  private getCalloutAt(x: number, z: number): string {
    for (const c of this.map.callouts) {
      if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) return c.name;
    }
    return this.map.meta.name.toUpperCase();
  }

  private getMinimapCanvas(): HTMLCanvasElement {
    if (this.minimapCanvas) return this.minimapCanvas;
    const size = 156;
    const pad = 6;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const mctx = c.getContext('2d')!;
    mctx.fillStyle = 'rgba(9,13,20,0.88)';
    mctx.fillRect(0, 0, size, size);

    const g = this.map.grid;
    const scale = Math.min((size - pad * 2) / (g.halfX * 2), (size - pad * 2) / (g.halfZ * 2));
    const cellPx = g.cellSize * scale;
    const offX = (size - g.cols * cellPx) * 0.5;
    const offZ = (size - g.rows * cellPx) * 0.5;

    for (let r = 0; r < g.rows; r++) {
      for (let col = 0; col < g.cols; col++) {
        const ch = g.cells[r][col];
        if (ch === '#') {
          mctx.fillStyle = '#1e293b';
        } else if (ch === 'V') {
          mctx.fillStyle = '#070f21';
        } else if (ch === 'G') {
          mctx.fillStyle = '#7c3aed';
        } else if (ch === 'I') {
          mctx.fillStyle = '#475569';
        } else if (ch === 'A' || ch === 'B') {
          mctx.fillStyle = '#857d4a';
        } else {
          mctx.fillStyle = '#64748b';
        }
        mctx.fillRect(offX + col * cellPx, offZ + r * cellPx, Math.ceil(cellPx), Math.ceil(cellPx));
      }
    }

    const toPx = (wx: number, wz: number): [number, number] => [
      size * 0.5 + wx * scale,
      size * 0.5 + wz * scale,
    ];
    const [ax, ay] = toPx(this.map.siteA.pos.x, this.map.siteA.pos.z);
    const [bx, by] = toPx(this.map.siteB.pos.x, this.map.siteB.pos.z);
    mctx.font = 'bold 11px monospace';
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    mctx.fillStyle = '#facc15';
    mctx.fillText('A', ax, ay);
    mctx.fillStyle = '#38bdf8';
    mctx.fillText('B', bx, by);

    mctx.strokeStyle = 'rgba(148,163,184,0.45)';
    mctx.lineWidth = 1.5;
    mctx.strokeRect(1, 1, size - 2, size - 2);

    this.minimapCanvas = c;
    return c;
  }

  private drawTacticalMinimap(ctx: CanvasRenderingContext2D, human: SndPlayerState, mySide: TeamSide): void {
    const mapCanvas = this.getMinimapCanvas();
    const rx = 14;
    const ry = 14;
    const size = mapCanvas.width;
    ctx.drawImage(mapCanvas, rx, ry);

    const g = this.map.grid;
    const scale = Math.min((size - 12) / (g.halfX * 2), (size - 12) / (g.halfZ * 2));
    const toScreen = (wx: number, wz: number): [number, number] => [
      rx + size * 0.5 + wx * scale,
      ry + size * 0.5 + wz * scale,
    ];

    // Determine currently viewed subject (live human or spectated bot)
    const specPlayer =
      !human.alive && this.spectateMode !== 'free' && this.spectateTargetId
        ? this.authority.players.get(this.spectateTargetId)
        : null;
    const viewPlayer = human.alive ? human : specPlayer;
    const viewPos = viewPlayer ? viewPlayer.pos : this.camera.position;
    const viewEye = new THREE.Vector3(viewPos.x, 1.55, viewPos.z);

    // Bomb on radar
    const b = this.authority.bomb;
    if ((b.state === 'dropped' && mySide === 'attackers') || b.state === 'planted' || b.state === 'defusing') {
      const [bx, by] = toScreen(b.pos.x, b.pos.z);
      ctx.fillStyle = b.state === 'dropped' ? '#facc15' : '#ef4444';
      ctx.fillRect(bx - 3.5, by - 3.5, 7, 7);
    }

    // Teammates & LOS-visible Enemies on radar
    for (const ps of this.authority.players.values()) {
      if (!ps.alive || !ps.connected) continue;
      if (viewPlayer && ps.id === viewPlayer.id) continue;
      const sameSide = viewPlayer ? ps.team === viewPlayer.team : ps.team === human.team;
      if (sameSide) {
        const [px, py] = toScreen(ps.pos.x, ps.pos.z);
        ctx.fillStyle = ps.id === b.carrierId ? '#facc15' : '#4ade80';
        ctx.beginPath();
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (
        this.mods.wallhackOn ||
        this.hasLineOfSight(viewEye, new THREE.Vector3(ps.pos.x, 1.55, ps.pos.z))
      ) {
        const actor = this.botActors.get(ps.id);
        const [ex, ey] = toScreen(ps.pos.x, ps.pos.z);
        ctx.fillStyle = actor?.entity.isAdmin
          ? '#ff1e56'
          : actor && actor.entity.bounty !== 'normal'
            ? BOUNTY_COLORS[actor.entity.bounty]
            : '#ef4444';
        ctx.beginPath();
        ctx.arc(ex, ey, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Viewer / FreeCam arrow + FOV cone
    const [vx, vy] = toScreen(viewPos.x, viewPos.z);
    const camFwd = new THREE.Vector3();
    this.camera.getWorldDirection(camFwd);
    const ang = Math.atan2(camFwd.z, camFwd.x);

    ctx.save();
    ctx.translate(vx, vy);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(248,250,252,0.16)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 22, -0.52, 0.52);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(5.5, 0);
    ctx.lineTo(-4, -3.5);
    ctx.lineTo(-2.2, 0);
    ctx.lineTo(-4, 3.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Callout location bar right under radar
    const callout = this.getCalloutAt(viewPos.x, viewPos.z);
    ctx.fillStyle = 'rgba(9,13,20,0.86)';
    ctx.fillRect(rx, ry + size + 2, size, 18);
    ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx, ry + size + 2, size, 18);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(callout, rx + size * 0.5, ry + size + 11);
  }

  private updateHudDom(): void {
    const snap = this.authority.getSnapshot();
    const human = this.authority.players.get(this.humanId)!;
    const youSide = this.authority.sideOfTeam('teamA');
    const oppSide: TeamSide = youSide === 'attackers' ? 'defenders' : 'attackers';

    document.getElementById('snd-score-you')!.textContent = String(snap.score.teamA);
    document.getElementById('snd-score-opp')!.textContent = String(snap.score.teamB);
    const ry = document.getElementById('snd-role-you')!;
    const ro = document.getElementById('snd-role-opp')!;
    ry.textContent = youSide === 'attackers' ? 'T · ATK' : 'CT · DEF';
    ry.style.color = youSide === 'attackers' ? '#f59e0b' : '#38bdf8';
    ro.textContent = oppSide === 'attackers' ? 'T · ATK' : 'CT · DEF';
    ro.style.color = oppSide === 'attackers' ? '#f59e0b' : '#38bdf8';

    const renderPips = (team: TeamId, elId: string) => {
      const el = document.getElementById(elId);
      if (!el) return;
      el.innerHTML = this.authority
        .getTeamPlayers(team)
        .map((p) => `<span class="snd-pip ${p.alive ? 'alive' : 'dead'} ${p.id === snap.bomb.carrierId ? 'c4' : ''}"></span>`)
        .join('');
    };
    renderPips('teamA', 'snd-pips-you');
    renderPips('teamB', 'snd-pips-opp');

    const rLabel = document.getElementById('snd-round-label')!;
    rLabel.textContent = `${this.map.meta.name.toUpperCase()} · ${snap.overtimeIndex > 0 ? `OT${snap.overtimeIndex} ` : ''}R${snap.roundNumber}`;

    const clockEl = document.getElementById('snd-clock')!;
    const pillEl = document.getElementById('snd-phase-pill')!;
    const isPlanted = snap.bomb.state === 'planted' || snap.bomb.state === 'defusing';
    if (isPlanted && snap.phase === 'active') {
      clockEl.textContent = `${snap.bomb.detonateTimer.toFixed(1)}s`;
      clockEl.style.color = '#ef4444';
      pillEl.textContent = `💣 SITE ${snap.bomb.site} PLANTED`;
      pillEl.style.color = '#ef4444';
    } else {
      const s = Math.ceil(Math.max(0, snap.phaseTimer));
      clockEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      clockEl.style.color = '#f8fafc';
      pillEl.textContent = snap.phase.replace('_', ' ').toUpperCase();
      pillEl.style.color = snap.phase === 'buy_phase' ? '#facc15' : '#94a3b8';
    }

    // Context interact prompt
    const promptEl = document.getElementById('snd-prompt')!;
    if (human.alive && snap.phase === 'buy_phase') {
      promptEl.classList.remove('hidden');
      promptEl.textContent = '🛒 [B] BUY MENU · [ENTER] RUNDE STARTEN';
    } else if (human.alive && snap.phase === 'active') {
      if (youSide === 'attackers' && snap.bomb.carrierId === this.humanId && snap.bomb.state === 'carried') {
        const site = this.authority.getSiteAtPosition(human.pos);
        if (site) {
          promptEl.classList.remove('hidden');
          promptEl.textContent = `💣 HALTE [E] UM AUF SITE ${site.id} ZU PLANTEN`;
        } else {
          promptEl.classList.add('hidden');
        }
      } else if (youSide === 'defenders' && snap.bomb.state === 'planted' && Math.hypot(human.pos.x - snap.bomb.pos.x, human.pos.z - snap.bomb.pos.z) <= this.authority.rules.interactRadius) {
        promptEl.classList.remove('hidden');
        promptEl.textContent = `✂ HALTE [E] ZUM ENTSCHÄRFEN (${human.hasDefuseKit ? '3.5s KIT' : '5.0s'})`;
      } else {
        promptEl.classList.add('hidden');
      }
    } else {
      promptEl.classList.add('hidden');
    }

    // Bottom Left HP/Armor/Cash & Cheat HUD Elements
    document.getElementById('snd-cash')!.textContent =
      `$${human.money} · ${human.armor > 0 ? `🛡 ${Math.round(human.armor)}${human.hasHelmet ? '+H' : ''}` : 'KEIN KEVLAR'}${human.hasDefuseKit ? ' · ✂ KIT' : ''}${snap.bomb.carrierId === this.humanId ? ' · 💣 C4' : ''}`;
    document.getElementById('snd-hp')!.textContent = human.alive ? String(Math.ceil(human.hp)) : 'DEAD';
    (document.getElementById('snd-hp-fill') as HTMLDivElement).style.width = `${Math.max(0, human.hp)}%`;

    const pigEl = document.getElementById('snd-piggy');
    if (pigEl) {
      if (this.mods.piggyOn) {
        pigEl.classList.remove('hidden');
        pigEl.textContent = `🐷 BANK: ${formatMoney(this.bankCents)}${this.mods.piggyStorm && this.fireHoldTime >= 3 ? ' 🔥STORM 2x' : ''}`;
      } else {
        pigEl.classList.add('hidden');
      }
    }

    const heatWrap = document.getElementById('snd-heat-wrap');
    const heatPct = document.getElementById('snd-heat-pct');
    const heatFill = document.getElementById('snd-heat-fill');
    const heatMeta = document.getElementById('snd-heat-meta');
    if (heatWrap && heatPct && heatFill && heatMeta) {
      if (this.mods.baseHeatPerKill > 0 || this.heat > 0 || this.spoofCharges > 0) {
        heatWrap.classList.remove('hidden');
        const hVal = Math.round(this.heat);
        heatPct.textContent = `${hVal}%`;
        heatFill.style.width = `${hVal}%`;
        heatFill.style.background = hVal >= 80 ? '#ff1e56' : hVal >= 50 ? '#f59e0b' : '#4ade80';
        heatMeta.textContent = this.spoofCharges > 0 ? `🛡 HWID Spoof: ${this.spoofCharges}` : hVal >= 80 ? '⚠ OVERWATCH ALARM!' : '';
      } else {
        heatWrap.classList.add('hidden');
      }
    }

    const scanEl = document.getElementById('snd-banscan');
    if (scanEl) {
      if (this.banScanActive) {
        const rem = Math.max(0, this.banScanEndAt - this.elapsed);
        scanEl.classList.remove('hidden');
        scanEl.textContent = `🚨 BAN-SCAN: ${rem.toFixed(1)}s`;
      } else {
        scanEl.classList.add('hidden');
      }
    }

    const streakEl = document.getElementById('snd-streak');
    if (streakEl) {
      if (this.mods.hitboxOn && this.headStreak >= 2) {
        const mult = Math.min(this.mods.headStreakCap, 1 + (this.headStreak - 1) * this.mods.headStreakStep);
        streakEl.classList.remove('hidden');
        streakEl.innerHTML = `🔥 ${this.headStreak} HEADSHOT STREAK <span>x${mult.toFixed(2)}</span>`;
      } else {
        streakEl.classList.add('hidden');
      }
    }

    const speedEl = document.getElementById('snd-speed');
    if (speedEl) {
      const spdPct = Math.round((Math.hypot(this.vel.x, this.vel.z) / BALANCE.walkSpeed) * 100);
      if (this.mods.bhopOn || this.mods.speedMult > 1.01) {
        speedEl.classList.remove('hidden');
        speedEl.textContent = `SPEED ${spdPct}%${this.hopChain > 0 ? ` · HOP x${this.hopChain}` : ''}`;
      } else {
        speedEl.classList.add('hidden');
      }
    }

    const volEl = document.getElementById('snd-volley');
    if (volEl) {
      if (this.mods.volleyCount > 0) {
        volEl.classList.remove('hidden');
        const rem = Math.max(0, this.volleyReadyAt - this.elapsed);
        volEl.textContent = rem <= 0 ? '⚡ VOLLEY READY!' : `⚡ VOLLEY ${rem.toFixed(1)}s`;
        volEl.classList.toggle('ready', rem <= 0);
      } else {
        volEl.classList.add('hidden');
      }
    }

    const slot = this.slots[this.slotIdx];
    if (slot) {
      document.getElementById('snd-weapon')!.textContent = slot.def.name.toUpperCase();
      document.getElementById('snd-ammo')!.textContent = slot.def.isMelee
        ? 'MELEE'
        : this.reloading
          ? 'RELOADING...'
          : this.mods.infiniteAmmo
            ? '∞ / ∞'
            : `${slot.ammo} / ${computeSndMagSize(slot.def, this.mods)}`;
    }

    // Spectator Bar
    if (!human.alive && snap.phase !== 'match_end') {
      this.spectateBarEl.classList.remove('hidden');
      const specTarget = this.spectateTargetId ? this.authority.players.get(this.spectateTargetId) : null;
      this.spectateBarEl.innerHTML = `
        <div>👁 SPECTATING: <strong>${this.spectateMode === 'free' || !specTarget ? 'FREE CAMERA' : `${specTarget.name} (${Math.ceil(specTarget.hp)} HP · K ${specTarget.kills}/${specTarget.deaths})`}</strong></div>
        <div class="snd-spec-keys">[LMB/Q/E] Spieler wechseln · [SPACE] Kamera (${this.spectateMode.toUpperCase()}) · [TAB] Scoreboard</div>
      `;
    } else {
      this.spectateBarEl.classList.add('hidden');
    }

    const activePay = this.payFeed.filter((f) => f.dieAt > this.elapsed);
    if (activePay.length !== this.payFeed.length) {
      this.payFeed = activePay;
      this.payfeedEl.innerHTML = this.payFeed.map((f) => `<div class="payfeed-line" style="color:${f.color}">${f.text}</div>`).join('');
    }
    const activeKf = this.killFeed.filter((f) => f.dieAt > this.elapsed);
    if (activeKf.length !== this.killFeed.length) {
      this.killFeed = activeKf;
      this.killfeedEl.innerHTML = this.killFeed.map((f) => `<div class="killfeed-line" style="color:${f.color}">${f.text}</div>`).join('');
    }
    if (this.scoreboardOpen) this.renderScoreboard();
  }

  private addPayBreakdown(label: string, amount: number, color: string): void {
    const prev = this.payBreakdown.get(label);
    if (prev) prev.amount += amount;
    else this.payBreakdown.set(label, { amount, color });
  }

  private pushPayFeed(text: string, color: string): void {
    this.payFeed.push({ text, color, dieAt: this.elapsed + 2.6 });
    if (this.payFeed.length > 6) this.payFeed.shift();
    this.payfeedEl.innerHTML = this.payFeed.map((f) => `<div class="payfeed-line" style="color:${f.color}">${f.text}</div>`).join('');
  }

  private renderScoreboard(): void {
    this.scoreboardEl.classList.remove('hidden');
    const human = this.authority.players.get(this.humanId)!;
    const renderTeam = (team: TeamId, label: string, col: string) => {
      const list = this.authority.getTeamPlayers(team).sort((a, b) => b.score - a.score || b.kills - a.kills);
      return `<div class="snd-sb-team">
        <div class="snd-sb-th" style="color:${col}"><span>${label} (${this.authority.score[team]})</span><span>K</span><span>D</span><span>A</span><span>P/D</span><span>$</span><span>SCORE</span><span>PING</span></div>
        ${list
          .map(
            (p) => `<div class="snd-sb-row ${p.isHuman ? 'you' : ''} ${!p.alive ? 'dead' : ''}">
              <span>${!p.alive ? '💀 ' : ''}${p.name}${p.id === this.authority.bomb.carrierId ? ' 💣' : p.hasDefuseKit ? ' ✂' : ''}</span>
              <span>${p.kills}</span><span>${p.deaths}</span><span>${p.assists}</span>
              <span>${p.plants}/${p.defuses}</span><span>$${p.money}</span><span>${p.score}</span><span>${p.ping}ms</span>
            </div>`,
          )
          .join('')}
      </div>`;
    };
    this.scoreboardEl.innerHTML = `
      <div class="os-win-card snd-sb-card">
        <div class="os-titlebar"><span>SEARCH & DESTROY — ${this.map.meta.name.toUpperCase()} (RUNDE ${this.authority.roundNumber})</span></div>
        <div class="snd-sb-body">
          ${renderTeam('teamA', `DEIN TEAM (${this.authority.sideOfTeam(human.team).toUpperCase()})`, '#4ade80')}
          ${renderTeam('teamB', `GEGNER TEAM (${this.authority.sideOfTeam('teamB').toUpperCase()})`, '#f87171')}
        </div>
      </div>
    `;
  }

  private pushKillFeed(text: string, color: string): void {
    this.killFeed.push({ text, color, dieAt: this.elapsed + 5.0 });
    if (this.killFeed.length > 6) this.killFeed.shift();
    this.killfeedEl.innerHTML = this.killFeed.map((f) => `<div class="killfeed-line" style="color:${f.color}">${f.text}</div>`).join('');
  }

  private showBanner(text: string, color: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.style.color = color;
    this.bannerEl.classList.add('show');
    window.setTimeout(() => this.bannerEl.classList.remove('show'), 2500);
  }

  private finishSndMatch(reasonOverride?: 'banned' | 'kicked'): void {
    if (this.ended) return;
    this.ended = true;
    this.paused = true;
    this.firingHeld = false;
    this.voteEl.classList.add('hidden');
    this.scopeEl.classList.remove('active');
    if (document.pointerLockElement) document.exitPointerLock();

    const human = this.authority.players.get(this.humanId)!;
    const won = !reasonOverride && this.authority.winnerTeam === human.team;
    sfx.playSndEvent(won ? 'match_win' : 'match_loss');

    const prestigeMult = store.getPrestigeMultiplier();
    const objPay = Math.round((human.plants + human.defuses) * 1500 * prestigeMult);
    const roundPay = Math.round(this.authority.score.teamA * 1200 * prestigeMult);
    const winBonus = won ? Math.round(15000 * prestigeMult) : 0;
    const bankPay = Math.round(this.bankCents);

    this.addPayBreakdown(`Runden-Siege (${this.authority.score.teamA})`, roundPay, '#38bdf8');
    if (objPay > 0) this.addPayBreakdown(`Plants/Defuses (${human.plants}/${human.defuses})`, objPay, '#facc15');
    if (winBonus > 0) this.addPayBreakdown('🏆 SnD Match-Sieg', winBonus, '#facc15');
    if (bankPay > 0) this.addPayBreakdown('🐷 Piggy Bank', bankPay, '#f472b6');

    let totalCredits = Math.round(this.earnedKillCents + objPay + roundPay + winBonus + bankPay);
    if (reasonOverride === 'kicked') {
      const lost = Math.round(totalCredits * 0.2);
      if (lost > 0) {
        totalCredits -= lost;
        this.addPayBreakdown('👢 Vote-Kick Strafe (-20%)', -lost, '#f59e0b');
      }
    } else if (reasonOverride === 'banned') {
      const lost = Math.round(totalCredits * 0.4);
      if (lost > 0) {
        totalCredits -= lost;
        this.addPayBreakdown('🔨 VAC-Ban Beschlagnahme (-40%)', -lost, '#ff1e56');
      }
    }

    const breakdown: MatchPayLine[] = Array.from(this.payBreakdown.entries())
      .filter(([, v]) => Math.round(v.amount) !== 0)
      .map(([label, v]) => ({ label, amount: Math.round(v.amount), color: v.color }));

    if (won || human.kills >= 4) {
      this.casesDropped.push(store.rollCaseDrop().id);
    }

    const reason: MatchResult['reason'] = reasonOverride ?? (won ? 'snd_win' : 'snd_loss');
    const result: MatchResult = {
      modeId: 'snd',
      reason,
      duration: this.elapsed,
      kills: human.kills,
      deaths: human.deaths,
      headshots: human.headshots,
      maxStreak: this.maxStreak,
      place: won ? 1 : 2,
      players: this.authority.players.size,
      won,
      creditsEarned: totalCredits,
      bankPay,
      winBonus,
      roundBonus: roundPay,
      roundsHeld: this.authority.score.teamA,
      roundsLost: this.authority.score.teamB,
      adminsKilled: this.adminsKilled,
      casesDropped: this.casesDropped,
      breakdown,
      peakHeat: Math.round(this.peakHeat),
    };
    store.completeMatch(result);

    const headline = reasonOverride === 'banned'
      ? '🔨 VAC / OVERWATCH GEBANNT!'
      : reasonOverride === 'kicked'
        ? '👢 PER VOTE-KICK GEWORFEN!'
        : `${won ? '🏆 MATCH GEWONNEN!' : '💀 MATCH VERLOREN'} · ${this.authority.score.teamA} : ${this.authority.score.teamB}`;

    this.endEl.innerHTML = `
      <div class="os-win-card end-card">
        <div class="os-titlebar ${won ? '' : 'danger'}"><span>MATCH BEENDET — SEARCH & DESTROY (${this.map.meta.name})</span></div>
        <div class="end-body">
          <h2 style="color:${won ? '#facc15' : '#f87171'}">${headline}</h2>
          <div class="end-grid">
            <div class="end-board">
              <div class="end-sub">DEINE STATISTIK</div>
              <div class="lm-row"><span>Kills / Deaths / Assists</span><strong>${human.kills} / ${human.deaths} / ${human.assists}</strong></div>
              <div class="lm-row"><span>Headshots / Max Streak</span><strong>${human.headshots} / ${this.maxStreak}</strong></div>
              <div class="lm-row"><span>Plants / Defuses</span><strong>${human.plants} / ${human.defuses}</strong></div>
              <div class="lm-row"><span>Peak Heat / Admins</span><strong>${Math.round(this.peakHeat)}% / ${this.adminsKilled}</strong></div>
            </div>
            <div class="end-payout">
              <div class="end-sub">DESKTOP BELOHNUNG</div>
              ${breakdown.map((l) => `<div class="pay-row"><span>${l.label}</span><span style="color:${l.color}">${l.amount >= 0 ? '+' : '-'}${formatMoneyWhole(Math.abs(l.amount))}</span></div>`).join('')}
              <div class="pay-total"><span>GESAMT VERDIENT</span><span>+${formatMoneyWhole(totalCredits)}</span></div>
              ${this.casesDropped.length ? `<div class="end-drops">📦 ${this.casesDropped.length}x CASE DROP IM INVENTAR!</div>` : ''}
            </div>
          </div>
          <div class="end-actions">
            <button class="os-btn primary" id="snd-rematch">REMATCH</button>
            <button class="os-btn" id="snd-hub">ZURÜCK ZUM DESKTOP [ESC]</button>
          </div>
        </div>
      </div>
    `;
    this.endEl.classList.remove('hidden');
    this.endEl.querySelector('#snd-rematch')!.addEventListener('click', () => {
      const c = this.container;
      const cb = this.onExitToHub;
      const cm = this.customMap ?? undefined;
      this.dispose();
      new SndMatchController(c, cb, cm);
    });
    this.endEl.querySelector('#snd-hub')!.addEventListener('click', () => this.abortToHub());
  }

  private abortToHub(): void {
    this.dispose();
    this.onExitToHub();
  }

  public dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    window.removeEventListener('mousemove', this.onMouseMoveBound);
    window.removeEventListener('mousedown', this.onMouseDownBound);
    window.removeEventListener('mouseup', this.onMouseUpBound);
    window.removeEventListener('wheel', this.onWheelBound);
    document.removeEventListener('pointerlockchange', this.onPointerLockBound);
    window.removeEventListener('resize', this.onResizeBound);
    this.container.removeEventListener('contextmenu', this.onContextMenuBound);

    for (const t of this.tracers) {
      t.line.geometry.dispose();
      (t.line.material as THREE.Material).dispose();
    }
    for (const ex of this.explosions) {
      ex.mesh.geometry.dispose();
      (ex.mesh.material as THREE.Material).dispose();
    }
    for (const d of this.decals) {
      d.geometry.dispose();
      (d.material as THREE.Material).dispose();
    }
    for (const c of this.casings) {
      c.mesh.geometry.dispose();
      (c.mesh.material as THREE.Material).dispose();
    }
    this.viewModel.dispose();
    this.ragdolls.dispose();
    sfx.cancelWeaponFoley('player_weapon');
    sfx.cancelWeaponFoley('preview_weapon');
    this.aiDebug.dispose();
    for (const a of this.botActors.values()) a.entity.dispose(this.scene);
    this.map.dispose();
    this.renderer.dispose();
  }
}
