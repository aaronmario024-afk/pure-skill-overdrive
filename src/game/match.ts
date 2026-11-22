import * as THREE from 'three';
import { AcousticEnvState, probeAcousticEnvironment } from '../audio/acoustics';
import { sfx } from '../audio/sfx';
import { ART_STYLES, BALANCE, BOUNTY_COLORS, BOUNTY_PAY, BountyTier, formatMoney } from '../data/balance';
import { getMode, ModeDef, ModeId } from '../data/modes';
import { getSkin } from '../data/skins';
import { getWeaponDef, WeaponDef, computeWeaponSpreadDeg, sampleSpreadOffsets } from '../data/weapons';
import {
  mp,
  MpBotKillEvent,
  MpBotSnapshot,
  MpDamageApplied,
  MpGuestBotHit,
  MpMatchEndPayload,
  MpMatchStartPayload,
  MpPeerFire,
  MpPeerState,
  MpPlayerKilled,
  MpPlayerRespawn,
} from '../net/multiplayer';
import { ActiveCheatMods, MatchPayLine, MatchResult, store } from '../state/store';
import { applyCustomLightingToScene, buildCustomStandardMap } from '../editor/customMapBuilder';
import { bakeCustomMapNavigation } from '../editor/navAndValidation';
import { CustomMapLaunchConfig } from '../editor/types';
import { BotEntity } from './bots';
import { MatchChatEngine } from './chat';
import { BuiltMap, buildMap, resolveCircleWallCollision, WallType } from './maps';
import { RagdollKillKind, RagdollManager } from './ragdoll';
import {
  AiCombatantInput,
  AiDebugVisualizer,
  BOT_DIFFICULTIES,
  BotAIManager,
  createModeAdapter,
  NavGrid,
  navWallsFromBoxes,
  WorldQueryApi,
} from './ai/index';
import { updateCamoClock } from './camoTextures';
import { expDamp, FirstPersonCameraRig } from './cameraRig';
import { createEnvironmentMap, createSkyDome } from './textures';
import { ViewModelController } from './viewmodel';

interface TracerFx {
  line: THREE.Line;
  dieAt: number;
}

interface ExplosionFx {
  mesh: THREE.Mesh;
  light?: THREE.PointLight;
  born: number;
  life: number;
  maxRadius: number;
}

interface SparkFx {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  dieAt: number;
}

interface ShellCasingFx {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  dieAt: number;
  isShotgun: boolean;
  bounceCount: number;
  lastBounceAt: number;
}

function resolveKillKind(def: WeaponDef, isHead: boolean, isExplosion: boolean): RagdollKillKind {
  if (isExplosion) return 'explosion';
  if (def.isMelee) return 'melee';
  if (isHead) return 'headshot';
  if (def.id === 'shotgun') return 'shotgun';
  if (def.id === 'sniper' || def.id === 'ssg') return 'sniper';
  return 'body';
}

interface DmgIndicator {
  fromPos: THREE.Vector3;
  until: number;
}

interface FeedItem {
  text: string;
  color: string;
  dieAt: number;
}

interface RemotePeerEntry {
  id: string;
  name: string;
  team: string;
  weaponId: string;
  skinId: string;
  entity: BotEntity;
  targetPos: THREE.Vector3;
  targetVel: THREE.Vector3;
  targetYaw: number;
  crouching: boolean;
  grounded: boolean;
  spinbot: boolean;
  hp: number;
  maxHp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  headshots: number;
}

export class MatchController {
  private container: HTMLElement;
  private mode: ModeDef;
  private mods: ActiveCheatMods;
  private onExitToHub: () => void;

  // Three.js core
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private map: BuiltMap;
  private viewModel: ViewModelController;
  private cameraRig: FirstPersonCameraRig;
  private ragdolls: RagdollManager;
  private ghostGroup = new THREE.Group();
  private fxGroup = new THREE.Group();

  // Overlays
  private overlayCanvas: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private hudRoot: HTMLDivElement;
  private pauseEl: HTMLDivElement;
  private endEl: HTMLDivElement;
  private chatEl: HTMLDivElement;
  private killfeedEl: HTMLDivElement;
  private payfeedEl: HTMLDivElement;
  private bannerEl: HTMLDivElement;
  private voteEl: HTMLDivElement;
  private scopeEl: HTMLDivElement;
  private hurtEl: HTMLDivElement;
  private blinkEl: HTMLDivElement;

  // Entities & FX
  private bots: BotEntity[] = [];
  private adminBot: BotEntity | null = null;
  private aiManager: BotAIManager | null = null;
  private aiDebug: AiDebugVisualizer | null = null;
  private tracers: TracerFx[] = [];
  private explosions: ExplosionFx[] = [];
  private sparks: SparkFx[] = [];
  private decals: THREE.Mesh[] = [];
  private casings: ShellCasingFx[] = [];
  private dmgIndicators: DmgIndicator[] = [];
  private raycaster = new THREE.Raycaster();

  // Player state
  private pos = new THREE.Vector3(0, 0, 10);
  private vel = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private fovKick = 0;
  private grounded = true;
  private crouching = false;
  private forwardInput = 0;
  private strafeInput = 0;
  private eyeHeight = 1.68;
  private health = 100;
  private alive = true;
  private respawnAt = 0;
  private spawnProtectUntil = 0;
  private dashUntil = 0;
  private hopChain = 0;
  private hopGrace = 0;
  private turnedRecently = 0;

  // Weapon state
  private slots: { def: WeaponDef; ammo: number }[] = [];
  private slotIdx = 0;
  private nextFireAt = 0;
  private reloading = false;
  private reloadStart = 0;
  private reloadEnd = 0;
  private scoped = false;
  private scopedAt = 0;
  private firingHeld = false;
  private fireHoldTime = 0;
  private fireBufferUntil = 0;
  private shotBloom = 0;
  private crosshairSpreadPx = 0;
  private currentAcousticEnv: AcousticEnvState = {
    zone: 'outdoor_urban',
    enclosure: 0.3,
    wallProximity: 0.2,
    earlyGain: 0.34,
    reverbSend: 0.32,
    surface: 'concrete',
  };
  private nextAcousticProbeAt = 0;
  private missesSinceKill = 0;
  private lastKillerName = '';
  private volleyReadyAt = 0;
  private triggerHoverSince = 0;

  // Match stats & systems
  private running = true;
  private ended = false;
  private paused = false;
  private pointerLocked = false;
  private rafId = 0;
  private lastFrame = 0;
  private elapsed = 0;
  private timeLeft = 30;
  private kills = 0;
  private deaths = 0;
  private headshots = 0;
  private headStreak = 0;
  private maxStreak = 0;
  private multiKill = 0;
  private lastKillAt = -10;
  private earnedCents = 0;
  private bankCents = 0;
  private adminsKilled = 0;
  private casesDropped: string[] = [];
  private breakdownMap = new Map<string, { amount: number; color: string }>();
  private payFeed: FeedItem[] = [];
  private killFeed: FeedItem[] = [];

  // Defend mode state
  private defendRound = 1;
  private roundsHeld = 0;
  private roundsLost = 0;
  private plantProgress = 0;
  private defendHurtThisRound = false;
  private roundIntermissionUntil = 0;

  // Anti-Cheat / Suspicion state
  private heat = 0;
  private peakHeat = 0;
  private spoofCharges = 0;
  private voteActive = false;
  private voteEndAt = 0;
  private nextVoteAllowedAt = 4;
  private voteYes = 0;
  private voteNo = 0;
  private voteTotal = 5;
  private voteNeeded = 4;
  private nextVoteBallotAt = 0;
  private banScanActive = false;
  private banScanEndAt = 0;
  private readonly banScanDuration = 8.5;
  private nextRainbowAt = 10;

  // Hitmarker
  private hitmarkerUntil = 0;
  private hitmarkerHead = false;
  private hitmarkerKill = false;
  private hurtFlash = 0;
  private blinkFlash = 0;

  // Multiplayer & Custom Map state
  private mpSession: MpMatchStartPayload | null = null;
  private customMap: CustomMapLaunchConfig | null = null;
  private mySpawnIdx = 0;
  private remotePeers = new Map<string, RemotePeerEntry>();
  private mirroredBots = new Map<number, BotEntity>();
  private mpUnsubs: (() => void)[] = [];
  private nextMpStateAt = 0;
  private nextBotsStateAt = 0;
  private tabHeld = false;
  private mpChatOpen = false;
  private mpBoardEl: HTMLDivElement | null = null;
  private mpChatWrapEl: HTMLDivElement | null = null;
  private mpChatInpEl: HTMLInputElement | null = null;

  // Input
  private keys = new Set<string>();
  private chat = new MatchChatEngine();
  private lastChatRenderCount = -1;

  // Bound event handlers
  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;
  private onMouseMoveBound: (e: MouseEvent) => void;
  private onMouseDownBound: (e: MouseEvent) => void;
  private onMouseUpBound: (e: MouseEvent) => void;
  private onWheelBound: (e: WheelEvent) => void;
  private onPointerLockBound: () => void;
  private onResizeBound: () => void;
  private onContextMenuBound: (e: MouseEvent) => void;

  constructor(
    container: HTMLElement,
    modeId: ModeId,
    onExitToHub: () => void,
    mpSession?: MpMatchStartPayload,
    customMap?: CustomMapLaunchConfig,
  ) {
    this.container = container;
    this.mpSession = mpSession ?? null;
    this.customMap = customMap ?? null;
    this.mode = getMode(modeId);
    this.mods = this.mpSession && !this.mpSession.rules.allowCheats
      ? store.computeCleanMods()
      : store.computeActiveMods();
    this.spoofCharges = this.mods.hwidSpoofCharges;
    this.onExitToHub = onExitToHub;
    this.timeLeft = this.mpSession
      ? this.mpSession.timeLeft
      : (this.customMap?.duration ?? this.mode.duration);
    if (this.mpSession) {
      const meInit = this.mpSession.players.find((p) => p.id === mp.clientId);
      this.mySpawnIdx = meInit?.spawnIdx ?? 0;
    }

    // Setup DOM wrapper
    this.container.innerHTML = '';
    const stage = document.createElement('div');
    stage.className = 'match-stage';
    this.container.appendChild(stage);

    // Three.js Renderer
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

    // 2D ESP / Crosshair / Aimbot FOV canvas
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'match-overlay-canvas';
    this.overlayCanvas.width = window.innerWidth;
    this.overlayCanvas.height = window.innerHeight;
    stage.appendChild(this.overlayCanvas);
    this.octx = this.overlayCanvas.getContext('2d')!;

    // Hurt / Blink / Scope overlays
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

    // HUD elements
    this.hudRoot = document.createElement('div');
    this.hudRoot.className = 'match-hud';
    stage.appendChild(this.hudRoot);

    this.killfeedEl = document.createElement('div');
    this.killfeedEl.className = 'hud-killfeed';
    this.hudRoot.appendChild(this.killfeedEl);

    this.payfeedEl = document.createElement('div');
    this.payfeedEl.className = 'hud-payfeed';
    this.hudRoot.appendChild(this.payfeedEl);

    this.chatEl = document.createElement('div');
    this.chatEl.className = 'hud-chat';
    this.hudRoot.appendChild(this.chatEl);

    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'hud-banner';
    this.hudRoot.appendChild(this.bannerEl);

    this.voteEl = document.createElement('div');
    this.voteEl.className = 'hud-votekick hidden';
    this.hudRoot.appendChild(this.voteEl);

    // Static HUD panels (updated each frame via IDs)
    const hudChrome = document.createElement('div');
    hudChrome.className = 'hud-chrome';
    hudChrome.innerHTML = `
      <div class="hud-top-center">
        <div class="hud-mode-tag">${this.mpSession ? `${this.mpSession.rules.matchType.toUpperCase()} (${this.mpSession.code})` : this.mode.name.toUpperCase()} · ${this.customMap ? this.customMap.document.name : this.mode.mapName}</div>
        <div class="hud-timer" id="hud-timer">--:--</div>
        <div class="hud-kd" id="hud-kd">K 0 · D 0</div>
        <div class="hud-defend-bar hidden" id="hud-defend"></div>
        <div class="hud-banscan hidden" id="hud-banscan"></div>
      </div>
      <div class="hud-top-left">
        <div class="hud-wallet" id="hud-wallet">$0.00</div>
        <div class="hud-piggy hidden" id="hud-piggy">🐷 BANK: $0.00</div>
        <div class="hud-heat-wrap">
          <div class="hud-heat-label"><span>ANTI-CHEAT HEAT</span><span id="hud-heat-pct">0%</span></div>
          <div class="hud-heat-track"><div class="hud-heat-fill" id="hud-heat-fill"></div></div>
          <div class="hud-heat-meta" id="hud-heat-meta"></div>
        </div>
        <div class="hud-active-cheats" id="hud-cheats"></div>
      </div>
      <div class="hud-streak hidden" id="hud-streak"></div>
      <div class="hud-bottom-left-stats">
        <div class="hud-hp-box">
          <span class="hud-hp-label">HP</span>
          <span class="hud-hp-val" id="hud-hp">100</span>
          <div class="hud-hp-track"><div class="hud-hp-fill" id="hud-hp-fill"></div></div>
        </div>
        <div class="hud-speed-tag hidden" id="hud-speed"></div>
      </div>
      <div class="hud-bottom-right">
        <div class="hud-volley hidden" id="hud-volley"></div>
        <div class="hud-weapon-name" id="hud-weapon">HORNET</div>
        <div class="hud-ammo" id="hud-ammo">9 / 9</div>
        <div class="hud-slots" id="hud-slots"></div>
      </div>
    `;
    this.hudRoot.appendChild(hudChrome);

    // Pause / Click-to-Lock Overlay
    this.pauseEl = document.createElement('div');
    this.pauseEl.className = 'match-pause-overlay';
    const mpControlsHint = this.mpSession ? ' · TAB Scoreboard · T Chat' : '';
    const mpEndBtn = this.mpSession && mp.isHost()
      ? `<button class="os-btn" id="btn-end-mp">MATCH FÜR ALLE BEENDEN</button>`
      : '';
    this.pauseEl.innerHTML = `
      <div class="os-win-card pause-card">
        <div class="os-titlebar"><span>FRAGNET.EXE — ${this.mpSession ? `${this.mpSession.code} (${this.mpSession.rules.matchType.toUpperCase()})` : this.customMap ? `${this.customMap.document.name} (${this.mode.name})` : this.mode.name}</span></div>
        <div class="pause-body">
          <h2>${this.mpSession ? `${this.mode.name} — MULTIPLAYER` : this.customMap?.isTestPlay ? `TEST PLAY: ${this.customMap.document.name}` : this.mode.name}</h2>
          <p class="pause-hint">WASD Bewegen · Space Springen/Bhop · Maus Zielen & Schießen · Rechtsklick Scope · R Nachladen · Y Inspizieren · 1/2/3 Waffen${mpControlsHint} · ESC Pause</p>
          <div class="pause-actions">
            <button class="os-btn primary" id="btn-resume">KLICKEN ZUM SPIELEN</button>
            ${mpEndBtn}
            <button class="os-btn" id="btn-hub">${this.mpSession ? 'ZURÜCK ZUR LOBBY' : this.customMap?.isTestPlay ? 'ZURÜCK ZUM MAP EDITOR' : 'ZURÜCK ZUM DESKTOP (Geld bleibt!)'}</button>
          </div>
        </div>
      </div>
    `;
    stage.appendChild(this.pauseEl);

    if (this.mpSession) {
      this.mpBoardEl = document.createElement('div');
      this.mpBoardEl.className = 'mp-scoreboard hidden';
      stage.appendChild(this.mpBoardEl);

      this.mpChatWrapEl = document.createElement('div');
      this.mpChatWrapEl.className = 'mp-chat-input-wrap hidden';
      this.mpChatWrapEl.innerHTML = `<input id="mp-chat-inp" type="text" maxlength="160" placeholder="Chat-Nachricht (Enter = Senden, Esc = Zurück)..." />`;
      stage.appendChild(this.mpChatWrapEl);
      this.mpChatInpEl = this.mpChatWrapEl.querySelector('#mp-chat-inp') as HTMLInputElement;
      this.mpChatInpEl.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') {
          ev.preventDefault();
          const txt = this.mpChatInpEl?.value.trim() ?? '';
          if (txt) mp.sendMatchChat(txt);
          this.closeMpChat(true);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          this.closeMpChat(true);
        }
      });
    }

    // End-of-Match Scoreboard Overlay
    this.endEl = document.createElement('div');
    this.endEl.className = 'match-end-overlay hidden';
    stage.appendChild(this.endEl);

    // Three.js Scene
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(store.data.settings.fov, window.innerWidth / window.innerHeight, 0.08, 280);
    this.scene.add(this.camera);

    if (this.customMap) {
      this.map = buildCustomStandardMap(this.customMap.document, this.mode);
      applyCustomLightingToScene(this.scene, this.customMap.document.lighting, this.map.halfExtent);
      this.scene.environment = createEnvironmentMap(this.renderer, this.mode.id);
    } else {
      this.scene.background = new THREE.Color(this.mode.skyColor);
      this.scene.fog = new THREE.FogExp2(this.mode.fogColor, this.mode.id === 'hvh' ? 0.017 : 0.014);
      this.scene.environment = createEnvironmentMap(this.renderer, this.mode.id);
      this.scene.add(createSkyDome(this.mode.id));

      const hemi = new THREE.HemisphereLight('#f8fafc', '#1e293b', this.mode.id === 'hvh' ? 0.52 : 0.78);
      this.scene.add(hemi);
      const dir = new THREE.DirectionalLight('#fff4e0', this.mode.id === 'hvh' ? 0.72 : 1.15);
      dir.position.set(18, 28, 14);
      dir.castShadow = true;
      dir.shadow.mapSize.set(2048, 2048);
      dir.shadow.bias = -0.0004;
      dir.shadow.normalBias = 0.02;
      dir.shadow.camera.left = -34;
      dir.shadow.camera.right = 34;
      dir.shadow.camera.top = 34;
      dir.shadow.camera.bottom = -34;
      this.scene.add(dir);

      const rim = new THREE.DirectionalLight(this.mode.id === 'hvh' ? '#22d3ee' : '#93c5fd', 0.35);
      rim.position.set(-20, 14, -18);
      this.scene.add(rim);

      this.map = buildMap(this.mode);
    }
    this.scene.add(this.map.group);
    this.scene.add(this.ghostGroup);
    this.scene.add(this.fxGroup);

    this.viewModel = new ViewModelController(this.camera);
    this.cameraRig = new FirstPersonCameraRig(store.data.settings.fov);
    this.ragdolls = new RagdollManager(this.scene, { maxCorpses: 16, corpseLifetimeSec: 15 });
    this.viewModel.setCallbacks({
      onMechSound: (ev, wid) => sfx.playWeaponMech(ev, wid),
      onEjectShell: (wid) => this.spawnShellCasing(wid),
      onCancelFoley: () => sfx.cancelWeaponFoley('player_weapon'),
    });
    this.initLoadout();
    this.spawnPlayer();
    this.initBots();
    if (this.mpSession) {
      this.initRemotePeers();
      this.bindMultiplayerEvents();
    }
    this.aiDebug = new AiDebugVisualizer(this.hudRoot);
    const shouldRunAi = this.mpSession
      ? mp.isHost() && this.mpSession.rules.botCount > 0 && !this.mode.isPractice
      : !this.mode.isPractice && this.bots.length > 0;
    if (shouldRunAi) {
      const nav = this.customMap
        ? bakeCustomMapNavigation(this.customMap.document).navGrid
        : new NavGrid({
            halfX: this.map.halfExtent,
            halfZ: this.map.halfExtent,
            walls: navWallsFromBoxes(this.map.walls.map((w) => w.box)),
            cellSize: 1.0,
            clearance: 0.54,
          });
      this.aiManager = new BotAIManager(
        nav,
        createModeAdapter(this.mode.id),
        store.data.settings.botDifficulty,
      );
      this.bots.forEach((b, idx) => {
        this.aiManager!.ensureAgent(`bot_${b.id}`, idx);
      });
    }
    this.renderActiveCheatPills();

    if (!this.mode.isPractice && store.data.trustFactor < 70) {
      this.heat = Math.round((70 - store.data.trustFactor) * 0.45);
      this.peakHeat = this.heat;
      this.chat.postSystem(
        `⚠ Niedriger Trust-Factor (${store.data.trustFactor}%) — Overwatch startet mit ${this.heat}% Basis-Heat!`,
        true,
      );
    }

    // Events
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

    this.pauseEl.querySelector('#btn-resume')!.addEventListener('click', () => this.requestLock());
    this.pauseEl.querySelector('#btn-end-mp')?.addEventListener('click', () => {
      mp.endMatch('host_ended');
    });
    this.pauseEl.querySelector('#btn-hub')!.addEventListener('click', () => this.finishMatch('disconnect'));

    this.lastFrame = performance.now();
    this.loop(this.lastFrame);

    // Attempt immediate pointer lock (works if launched directly from user click)
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
      // fallback handled by pause button
    }
  }

  private onPointerLockChange(): void {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    if (!this.ended) {
      this.paused = !this.pointerLocked || this.mpChatOpen;
      this.pauseEl.classList.toggle('hidden', this.pointerLocked || this.mpChatOpen);
      if (!this.pointerLocked) {
        this.firingHeld = false;
        this.keys.clear();
        sfx.cancelWeaponFoley('player_weapon');
      }
    }
  }

  private initLoadout(): void {
    const primary = getWeaponDef(store.data.equippedPrimary);
    const pistol = getWeaponDef('pistol');
    const knife = getWeaponDef('knife');
    this.slots = [];
    if (primary.id !== 'pistol' && primary.id !== 'knife') {
      this.slots.push({ def: primary, ammo: this.magSize(primary) });
    }
    this.slots.push({ def: pistol, ammo: this.magSize(pistol) });
    this.slots.push({ def: knife, ammo: 1 });
    this.switchSlot(0);
  }

  private magSize(def: WeaponDef): number {
    if (def.isMelee) return 1;
    return Math.max(1, Math.round(def.magazineSize * this.mods.magMult));
  }

  private currentSlot() {
    return this.slots[this.slotIdx];
  }

  private switchSlot(idx: number): void {
    if (idx < 0 || idx >= this.slots.length) return;
    this.viewModel.cancelReload(this.grounded);
    this.slotIdx = idx;
    this.reloading = false;
    this.scoped = false;
    const def = this.currentSlot().def;
    const skin = getSkin(store.data.equippedSkins[def.id]);
    this.viewModel.equip(def, skin);
    this.renderSlotsHud();
  }

  private renderSlotsHud(): void {
    const el = document.getElementById('hud-slots');
    if (!el) return;
    el.innerHTML = this.slots
      .map((s, i) => `<span class="hud-slot ${i === this.slotIdx ? 'active' : ''}">[${i + 1}] ${s.def.shortName}</span>`)
      .join('');
  }

  private renderActiveCheatPills(): void {
    const el = document.getElementById('hud-cheats');
    if (!el) return;
    const active: string[] = [];
    if (this.mods.hitboxOn) active.push(`HITBOX ${this.mods.headScale.toFixed(1)}x`);
    if (this.mods.wallhackOn) active.push(this.mods.wallbangTier > 0 ? 'WALLHACK+WB' : 'WALLHACK');
    if (this.mods.aimbotOn) active.push(this.mods.volleyCount > 0 ? 'AIMBOT+VOLLEY' : 'AIMBOT');
    if (this.mods.triggerOn) active.push('TRIGGERBOT');
    if (this.mods.bhopOn) active.push('BHOP');
    if (this.mods.speedMult > 1.01) active.push(this.mods.killBlink ? 'SPEED+BLINK' : 'SPEEDHACK');
    if (this.mods.recoilMult < 0.99) active.push('NO RECOIL');
    if (this.mods.piggyOn || this.mods.infiniteAmmo) active.push(this.mods.piggyOn ? 'AMMO+PIGGY' : 'AMMO');
    if (this.mods.spinbotOn) active.push('SPINBOT');
    if (this.mods.backtrackOn) active.push('BACKTRACK');
    if (this.mods.damageMult > 1.01) active.push(this.mods.explodeOnKill ? 'RAGE+NUKE' : 'RAGE');
    if (this.mods.heatMult < 0.99) active.push('BYPASS');
    el.innerHTML = active.length
      ? active.map((a) => `<span class="cheat-pill">${a}</span>`).join('')
      : `<span class="cheat-pill clean">CLEAN PLAYER</span>`;
  }

  private spawnPlayer(spawnIdxOverride?: number): void {
    const sp = this.mpSession
      ? this.map.playerSpawns[(spawnIdxOverride ?? this.mySpawnIdx) % this.map.playerSpawns.length]
      : this.map.playerSpawns[Math.floor(Math.random() * this.map.playerSpawns.length)];
    this.pos.copy(sp);
    this.pos.y = this.map.sampleGroundHeight ? this.map.sampleGroundHeight(sp.x, sp.z, sp.y) : 0;
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(-sp.x, -sp.z);
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.fovKick = 0;
    this.fireBufferUntil = 0;
    sfx.cancelWeaponFoley('player_weapon');
    this.cameraRig?.reset(store.data.settings.fov);
    this.health = BALANCE.playerMaxHealth;
    this.alive = true;
    this.spawnProtectUntil = this.elapsed + BALANCE.playerSpawnProtection;
    for (const s of this.slots) s.ammo = this.magSize(s.def);
    this.reloading = false;
  }

  private rollBounty(): BountyTier {
    if (!this.mods.wallhackOn) return 'normal';
    const r = Math.random();
    if (r < this.mods.goldChance) return 'gold';
    if (r < this.mods.goldChance + this.mods.redChance) return 'red';
    if (r < this.mods.goldChance + this.mods.redChance + this.mods.greenChance) return 'green';
    return 'normal';
  }

  private initBots(): void {
    this.bots = [];
    if (this.mpSession) {
      if (!mp.isHost() || this.mpSession.rules.botCount <= 0) {
        return;
      }
      for (let i = 0; i < this.mpSession.rules.botCount; i++) {
        const b = new BotEntity(i, this.scene, this.ghostGroup, false);
        const sp = this.map.botSpawns[i % this.map.botSpawns.length].clone();
        sp.x += (Math.random() - 0.5) * 2;
        sp.z += (Math.random() - 0.5) * 2;
        b.spawn(sp, this.rollBounty(), !!this.mode.cheaterBots, false, false, this.elapsed);
        this.bots.push(b);
      }
      return;
    }
    if (this.mode.isPractice) {
      const modes: ('immortal' | 'killable' | 'moving')[] = ['immortal', 'killable', 'moving'];
      const labels = ['IMMORTAL DUMMY', 'KILLABLE DUMMY', 'MOVING DUMMY'];
      this.map.botSpawns.forEach((sp, i) => {
        const b = new BotEntity(i, this.scene, this.ghostGroup, true);
        b.dummyMode = modes[i % 3];
        b.name = labels[i % 3];
        b.spawn(sp, 'normal', false, false, false, this.elapsed);
        this.bots.push(b);
      });
      return;
    }

    const targetBots = this.customMap?.botCount ?? this.mode.botCount;
    for (let i = 0; i < targetBots; i++) {
      const b = new BotEntity(i, this.scene, this.ghostGroup, false);
      const sp = this.map.botSpawns[i % this.map.botSpawns.length].clone();
      sp.x += (Math.random() - 0.5) * 2;
      sp.z += (Math.random() - 0.5) * 2;
      if (this.map.sampleGroundHeight) sp.y = this.map.sampleGroundHeight(sp.x, sp.z, sp.y);
      b.spawn(sp, this.rollBounty(), !!this.mode.cheaterBots, false, false, this.elapsed);
      this.bots.push(b);
    }

    if (this.mode.id === 'defend') {
      this.showBanner(`RUNDE 1 / ${this.mode.rounds} — VERTEIDIGE DIE SITE!`, '#facc15');
    }
  }

  private spawnAdminBoss(): void {
    if (this.adminBot && this.adminBot.alive) return;
    if (!this.adminBot) {
      this.adminBot = new BotEntity(99, this.scene, this.ghostGroup, false);
      this.adminBot.name = 'ADMIN_BANHAMMER';
      this.bots.push(this.adminBot);
    }
    const sp = this.pickFarSpawn();
    this.adminBot.spawn(sp, 'admin', false, true, this.mods.adminJammer, this.elapsed);
    this.aiManager?.ensureAgent(`bot_${this.adminBot.id}`, 99, 'aggressive');
    this.aiManager?.onBotRespawn(`bot_${this.adminBot.id}`, this.adminBot.yaw);
    sfx.playAdminAlarm();
    this.showBanner('⚠ SERVER-ADMIN IST BEIGETRETEN! TÖTE IHN FÜR 75x BOUNTY! ⚠', '#ff1e56');
    this.chat.postSystem('ADMIN_BANHAMMER joined the server to investigate reports!', true);
  }

  private pickFarSpawn(): THREE.Vector3 {
    let best = this.map.botSpawns[0];
    let bestD = -1;
    for (const sp of this.map.botSpawns) {
      const d = sp.distanceTo(this.pos) + Math.random() * 6;
      if (d > bestD) {
        bestD = d;
        best = sp;
      }
    }
    return best.clone();
  }

  // Input handlers
  private onKeyDown(e: KeyboardEvent): void {
    if (this.ended) {
      if (this.mpSession) {
        if (e.code === 'Escape') {
          this.dispose();
          this.onExitToHub();
        }
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        this.rematch();
      } else if (e.code === 'Escape') {
        this.dispose();
        this.onExitToHub();
      }
      return;
    }
    if (this.mpChatOpen) return;
    if (this.mpSession && e.code === 'Tab') {
      e.preventDefault();
      this.tabHeld = true;
      this.renderMpScoreboard();
      return;
    }
    if (e.code === 'F2') {
      e.preventDefault();
      const next = store.cycleArtStyle();
      const preset = ART_STYLES.find((a) => a.id === next)!;
      this.applyArtStyle();
      this.showBanner(`STYLE: ${preset.name}`, '#22d3ee');
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
    if (!this.pointerLocked) return;

    if (e.code === 'Digit1') this.switchSlot(0);
    else if (e.code === 'Digit2') this.switchSlot(1);
    else if (e.code === 'Digit3') this.switchSlot(2);
    else if (e.code === 'KeyR') this.startReload();
    else if (e.code === 'KeyY' || e.key.toLowerCase() === 'y' || e.code === 'KeyF') this.triggerWeaponInspect();
    else if (this.mpSession && e.code === 'KeyT') {
      e.preventDefault();
      this.openMpChat();
    }
  }

  private openMpChat(): void {
    if (!this.mpSession || !this.mpChatWrapEl || !this.mpChatInpEl) return;
    this.mpChatOpen = true;
    this.paused = true;
    this.firingHeld = false;
    this.keys.clear();
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
    this.pauseEl.classList.add('hidden');
    this.mpChatWrapEl.classList.remove('hidden');
    this.mpChatInpEl.value = '';
    this.mpChatInpEl.focus();
  }

  private closeMpChat(relock = false): void {
    this.mpChatOpen = false;
    this.mpChatWrapEl?.classList.add('hidden');
    if (relock && !this.ended) {
      this.requestLock();
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
      this.tabHeld = false;
      this.mpBoardEl?.classList.add('hidden');
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.pointerLocked || this.paused || this.ended) return;
    const sens = store.data.settings.sensitivity * (this.scoped ? 0.45 : 1);
    const dyaw = -e.movementX * sens;
    const dpitch = -e.movementY * sens;
    this.yaw += dyaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dpitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    this.turnedRecently += Math.abs((dyaw * 180) / Math.PI);
    this.viewModel.addLookSway(e.movementX, e.movementY);
  }

  private onMouseDown(e: MouseEvent): void {
    if (this.ended) return;
    if (!this.pointerLocked) return;
    if (e.button === 0) {
      this.firingHeld = true;
      this.fireBufferUntil = this.elapsed + 0.052;
      this.tryShoot(false);
    } else if (e.button === 2) {
      const def = this.currentSlot().def;
      if (def.scope) {
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
    if (!this.pointerLocked || this.ended) return;
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

  private startReload(): void {
    const slot = this.currentSlot();
    if (slot.def.isMelee || this.reloading || this.mods.infiniteAmmo) return;
    if (slot.ammo >= this.magSize(slot.def)) return;
    this.reloading = true;
    this.scoped = false;
    this.reloadStart = this.elapsed;
    this.reloadEnd = this.elapsed + slot.def.reloadTime;
    this.viewModel.onReloadStart();
  }

  // Main loop
  private loop = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);
    updateCamoClock(now * 0.001);
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    // Passive bot-farm still ticks in background!
    store.tickBotFarm();

    if (this.mpSession) {
      if (!this.ended) this.stepSimulation(dt);
    } else if (!this.paused && !this.ended) {
      this.stepSimulation(dt);
    }
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay2D();
    this.updateHudDom();
  };

  private stepSimulation(dt: number): void {
    this.elapsed += dt;
    this.turnedRecently = Math.max(0, this.turnedRecently - dt * 420);

    // Synchronize 3D AudioListener & probe real-time room/outdoor acoustic zone
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    sfx.updateListener(this.camera.position, fwd, up);
    if (this.elapsed >= this.nextAcousticProbeAt) {
      this.nextAcousticProbeAt = this.elapsed + 0.1;
      this.currentAcousticEnv = probeAcousticEnvironment(this.camera.position, this.map.walls, {
        theme: this.mode.id,
      });
      sfx.setAcousticEnvironment(this.currentAcousticEnv);
    }

    // Timer / Defend logic
    if (this.mpSession) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
    } else if (!this.mode.isPractice) {
      if (this.mode.id === 'defend') {
        this.stepDefendMode(dt);
      } else {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          this.finishMatch('timeup');
          return;
        }
      }
    }

    // Heat natural decay
    if (!this.mpSession && this.heat > 0) {
      this.heat = Math.max(0, this.heat - dt * (this.mods.heatMult < 0.9 ? 1.5 : 0.55));
    }

    // Live Vote-Kick ballots (Solo only)
    if (!this.mpSession && this.voteActive) {
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
          this.chat.postSystem(`VOTE-KICK BESTANDEN (${this.voteYes}/${this.voteTotal} JA)! Du wurdest vom Server geworfen.`, true);
          this.finishMatch('kicked');
          return;
        }
      }
      if (this.voteActive && (this.voteYes + this.voteNo >= this.voteTotal || this.elapsed >= this.voteEndAt)) {
        this.voteActive = false;
        this.voteEl.classList.add('hidden');
        this.chat.postSystem(`Vote-Kick fehlgeschlagen (${this.voteYes} JA / ${this.voteNo} NEIN · benötigt ${this.voteNeeded}).`);
      }
    }

    // Overwatch / VAC Ban-Scan timer at 100% Heat (Solo only)
    if (!this.mpSession && this.banScanActive && this.elapsed >= this.banScanEndAt) {
      this.triggerBanAttempt('VAC OVERWATCH DETECTION');
      if (this.ended) return;
    }

    // Defend site beacon pulse
    if (this.map.siteBeaconLight) {
      this.map.siteBeaconLight.intensity = 1.6 + Math.sin(this.elapsed * 5.2) * 1.1;
    }

    // Rainbow runner periodic spawn
    if (!this.mpSession && this.mods.rainbowOn && !this.mode.isPractice && this.elapsed >= this.nextRainbowAt) {
      this.nextRainbowAt = this.elapsed + 15;
      const normalAlive = this.bots.find((b) => b.alive && !b.isAdmin && b.bounty === 'normal');
      if (normalAlive) {
        normalAlive.bounty = 'rainbow';
        this.showBanner('🌈 RAINBOW RUNNER (50x PAY) GESPAWNT! 🌈', '#f472b6');
        sfx.playUi('cash');
      }
    }

    // Player respawn & local control
    if (!this.alive) {
      if (!this.mpSession && this.elapsed >= this.respawnAt) {
        this.spawnPlayer();
      }
    } else if (!this.paused && !this.mpChatOpen) {
      this.stepPlayerMovement(dt);
      this.stepAimbot(dt);
      this.stepWeapon(dt);
      this.stepTriggerbot(dt);
    }

    if (this.mpSession) {
      this.stepRemotePeers(dt);
      if (this.elapsed >= this.nextMpStateAt) {
        this.nextMpStateAt = this.elapsed + 0.04;
        const def = this.currentSlot().def;
        mp.sendPlayerState({
          x: this.pos.x,
          y: this.pos.y,
          z: this.pos.z,
          vx: this.vel.x,
          vy: this.vel.y,
          vz: this.vel.z,
          yaw: this.yaw + Math.PI,
          pitch: this.pitch,
          weaponId: def.id,
          skinId: store.data.equippedSkins[def.id] ?? '',
          crouching: this.crouching,
          grounded: this.grounded,
          spinbot: this.mods.spinbotOn,
        });
      }
      if (mp.isHost() && this.mpSession.rules.botCount > 0 && this.elapsed >= this.nextBotsStateAt) {
        this.nextBotsStateAt = this.elapsed + 0.066;
        mp.sendBotsState(
          this.bots.map((b) => ({
            id: b.id,
            name: b.name,
            x: b.pos.x,
            y: b.pos.y,
            z: b.pos.z,
            vx: b.actualVel.x,
            vy: b.hopVelY,
            vz: b.actualVel.z,
            yaw: b.yaw,
            hp: b.health,
            maxHp: b.maxHealth,
            alive: b.alive,
            bounty: b.bounty,
            isCheaterBot: b.isCheaterBot,
            isAdmin: b.isAdmin,
            isDummy: b.isDummy,
            spinVisual: b.isCheaterBot,
            onGround: b.onGround,
          })),
        );
      }
    }

    this.stepBots(dt);
    this.ragdolls.update(
      dt,
      (pos, r) => resolveCircleWallCollision(pos, r, this.map.walls, this.map.halfExtent),
      (pos, speed) => sfx.playBodyThud(speed, this.computeStereoPan(pos)),
    );
    this.stepFx(dt);

    // Chat updates
    const botNames = this.mpSession ? [] : this.bots.filter((b) => !b.isDummy).map((b) => b.name);
    if (this.chat.tick(this.elapsed, botNames) || this.chat.messages.length !== this.lastChatRenderCount) {
      this.renderChat();
    }

    // Flash decays
    if (this.hurtFlash > 0) {
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
      this.hurtEl.style.opacity = String(this.hurtFlash);
    }
    if (this.blinkFlash > 0) {
      this.blinkFlash = Math.max(0, this.blinkFlash - dt * 3.5);
      this.blinkEl.style.opacity = String(this.blinkFlash);
    }
  }

  private stepDefendMode(dt: number): void {
    if (this.roundIntermissionUntil > 0) {
      if (this.elapsed >= this.roundIntermissionUntil) {
        this.roundIntermissionUntil = 0;
        this.startNextDefendRound();
      }
      return;
    }

    this.timeLeft -= dt;
    const livingAttackers = this.bots.filter((b) => b.alive && !b.isAdmin);
    if (livingAttackers.length === 0) {
      this.endDefendRound(true);
      return;
    }

    // Check if any bot is on site planting
    const planting = livingAttackers.some(
      (b) => this.map.sitePos && b.pos.distanceTo(this.map.sitePos) <= (this.map.siteRadius ?? 5),
    );
    if (planting) {
      this.plantProgress += dt / 3.0;
      if (this.plantProgress >= 1) {
        this.endDefendRound(false);
        return;
      }
    } else {
      this.plantProgress = Math.max(0, this.plantProgress - dt * 0.6);
    }

    if (this.timeLeft <= 0) {
      this.endDefendRound(true);
    }
  }

  private endDefendRound(held: boolean): void {
    if (held) {
      this.roundsHeld += 1;
      const flawless = !this.defendHurtThisRound;
      const bonus = Math.round(
        BALANCE.creditsPerKill * this.mode.killPayMult * 3 * (flawless ? 1.5 : 1) * store.getPrestigeMultiplier(),
      );
      this.earnedCents += bonus;
      this.addBreakdown('Runden-Bonus', bonus, '#4ade80');
      this.pushPayFeed(`+${formatMoney(bonus)} ${flawless ? 'FLAWLESS HELD!' : 'RUNDE GEHALTEN!'}`, '#4ade80');
      this.showBanner(flawless ? 'FLAWLESS! SITE GEHALTEN!' : 'RUNDE GEHALTEN!', '#4ade80');
      sfx.playUi('cash');
    } else {
      this.roundsLost += 1;
      this.showBanner('SITE VERLOREN! BOMBE GEPLANTET!', '#f87171');
      sfx.playUi('deny');
    }

    if (this.defendRound >= (this.mode.rounds ?? 3)) {
      this.finishMatch(this.roundsHeld >= this.roundsLost ? 'held' : 'lost');
      return;
    }
    this.roundIntermissionUntil = this.elapsed + 2.4;
  }

  private startNextDefendRound(): void {
    this.defendRound += 1;
    this.timeLeft = this.mode.duration;
    this.plantProgress = 0;
    this.defendHurtThisRound = false;
    this.ragdolls.clearAll();
    this.spawnPlayer();
    this.bots.forEach((b, i) => {
      if (b.isAdmin) return;
      const sp = this.map.botSpawns[i % this.map.botSpawns.length].clone();
      b.spawn(sp, this.rollBounty(), false, false, false, this.elapsed);
    });
    this.aiManager?.onRoundReset();
    this.showBanner(`RUNDE ${this.defendRound} / ${this.mode.rounds}`, '#facc15');
  }

  private stepPlayerMovement(dt: number): void {
    const slot = this.currentSlot();
    const wishF = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const wishR = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this.forwardInput = wishF;
    this.strafeInput = wishR;
    this.crouching = this.keys.has('ControlLeft') || this.keys.has('KeyC');
    const jumpHeld = this.keys.has('Space');

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wishDir = new THREE.Vector3().addScaledVector(forward, wishF).addScaledVector(right, wishR);
    if (wishDir.lengthSq() > 0.001) wishDir.normalize();

    const dashMult = this.elapsed < this.dashUntil ? 2.0 : 1.0;
    const bhopMult = this.mods.bhopOn
      ? Math.min(this.mods.bhopTopSpeed, 1 + this.hopChain * (this.mods.bhopMoonhop ? 0.28 : 0.16))
      : 1.0;
    const baseSpeed =
      BALANCE.walkSpeed *
      slot.def.moveSpeed *
      this.mods.speedMult *
      dashMult *
      bhopMult *
      (this.crouching ? BALANCE.crouchSpeed : 1);

    if (this.grounded) {
      if (jumpHeld && (this.mods.bhopOn || this.hopGrace <= 0)) {
        const jumpH = BALANCE.jumpHeight * (this.mods.bhopMoonhop ? 1.8 : 1.0);
        this.vel.y = Math.sqrt(2 * BALANCE.gravity * jumpH);
        this.grounded = false;
        sfx.playJump();
        if (this.mods.bhopOn && wishDir.lengthSq() > 0.01) {
          this.hopChain = Math.min(this.mods.bhopChainCap, this.hopChain + 1);
          this.hopGrace = 0.25;
        }
      } else {
        this.vel.x = expDamp(this.vel.x, wishDir.x * baseSpeed, 14, dt);
        this.vel.z = expDamp(this.vel.z, wishDir.z * baseSpeed, 14, dt);
        if (this.hopGrace > 0) this.hopGrace -= dt;
        else this.hopChain = 0;
      }
    } else {
      const airControl = this.mods.bhopAirStrafe ? 10 : 3.2;
      if (wishDir.lengthSq() > 0.01) {
        this.vel.x = expDamp(this.vel.x, wishDir.x * baseSpeed, airControl, dt);
        this.vel.z = expDamp(this.vel.z, wishDir.z * baseSpeed, airControl, dt);
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

    resolveCircleWallCollision(this.pos, 0.45, this.map.walls, this.map.halfExtent);

    const targetEye = this.crouching ? 1.15 : 1.68;
    this.eyeHeight = expDamp(this.eyeHeight, targetEye, 15, dt);

    // Frame-rate-independent recoil recovery
    this.recoilPitch = expDamp(this.recoilPitch, 0, 12, dt);
    this.recoilYaw = expDamp(this.recoilYaw, 0, 12, dt);
    this.fovKick = expDamp(this.fovKick, 0, 14, dt);

    const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    const liveSpread = computeWeaponSpreadDeg({
      def: slot.def,
      horizSpeed,
      maxMoveSpeed: BALANCE.walkSpeed * slot.def.moveSpeed * this.mods.speedMult,
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
      baseFov: store.data.settings.fov + (bhopMult - 1) * 7,
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
      maxAmmo: this.magSize(slot.def),
      spinbot: this.mods.spinbotOn,
      fireInterval: slot.def.fireInterval,
    });
  }

  private stepAimbot(dt: number): void {
    if (!this.mods.aimbotOn) return;
    const eye = this.camera.position;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const maxCos = Math.cos((this.mods.aimbotFovDeg * Math.PI) / 180);

    let bestBot: BotEntity | null = null;
    let bestScore = -1e9;
    const headPos = new THREE.Vector3();

    const aimCandidates: BotEntity[] = [...this.bots];
    if (this.mpSession) {
      const skipCoopTeammates = this.mpSession.rules.matchType === 'coop' && !this.mpSession.rules.friendlyFire;
      if (!skipCoopTeammates) {
        for (const p of this.remotePeers.values()) aimCandidates.push(p.entity);
      }
    }

    for (const bot of aimCandidates) {
      if (!bot.alive) continue;
      bot.getHeadWorldPos(headPos);
      const toHead = headPos.clone().sub(eye);
      const dist = toHead.length();
      const dir = toHead.clone().divideScalar(dist);
      const dot = forward.dot(dir);
      if (this.mods.aimbotFovDeg < 179 && dot < maxCos) continue;

      if (!this.canReachPoint(eye, dir, dist, this.mods.aimbotWallLock)) continue;

      const bountyWeight = this.mods.aimbotBountyPrio ? BOUNTY_PAY[bot.bounty] * 100 : 0;
      const score = bountyWeight + dot * 50 - dist * 0.25;
      if (score > bestScore) {
        bestScore = score;
        bestBot = bot;
      }
    }

    if (!bestBot) return;
    bestBot.getHeadWorldPos(headPos);
    const dx = headPos.x - eye.x;
    const dy = headPos.y - eye.y;
    const dz = headPos.z - eye.z;
    const horiz = Math.hypot(dx, dz);
    const targetYaw = Math.atan2(-dx, -dz);
    const targetPitch = Math.atan2(dy, horiz);

    // Shortest angle diff
    let yawDiff = targetYaw - this.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    const pitchDiff = targetPitch - this.pitch;

    const k = this.mods.aimbotSnap >= 0.99 ? 1 : 1 - Math.exp(-16 * dt);
    this.yaw += yawDiff * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchDiff * k, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  }

  private stepWeapon(dt: number): void {
    this.shotBloom = Math.max(0, this.shotBloom - dt * 4.5);

    if (this.reloading && this.elapsed >= this.reloadEnd) {
      this.reloading = false;
      this.currentSlot().ammo = this.magSize(this.currentSlot().def);
    }

    if (this.firingHeld) {
      this.fireHoldTime += dt;
      const def = this.currentSlot().def;
      if (def.fullAuto || this.mods.forceAuto) {
        this.tryShoot(false);
      }
    }

    if (this.elapsed <= this.fireBufferUntil && this.elapsed >= this.nextFireAt && !this.reloading) {
      this.tryShoot(false);
    }

    // Triggerbot Auto-Reload when no bot visible
    if (this.mods.triggerAutoReload && !this.reloading && !this.mods.infiniteAmmo) {
      const slot = this.currentSlot();
      if (!slot.def.isMelee && slot.ammo < this.magSize(slot.def) * 0.4) {
        const anyVisible = this.bots.some((b) => b.alive && this.hasLineOfSight(this.camera.position, b.getHeadWorldPos()));
        if (!anyVisible) this.startReload();
      }
    }
  }

  private stepTriggerbot(dt: number): void {
    if (!this.mods.triggerOn || this.reloading) {
      this.triggerHoverSince = 0;
      return;
    }
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const hit = this.traceShot(this.camera.position, dir, this.currentSlot().def.range, this.mods.triggerXray);
    if (hit && hit.bot && (!this.mods.triggerHeadOnly || hit.isHead || this.mods.fullBodyHead)) {
      this.triggerHoverSince += dt;
      if (this.triggerHoverSince >= this.mods.triggerDelay) {
        this.tryShoot(true);
      }
    } else {
      this.triggerHoverSince = 0;
    }
  }

  private canPierce(wallType: WallType): boolean {
    if (this.mods.wallbangTier === 0) return false;
    if (this.mods.wallbangTier === 1) return wallType === 'thin';
    if (this.mods.wallbangTier === 2) return wallType === 'thin' || wallType === 'crate';
    return true;
  }

  private canReachPoint(origin: THREE.Vector3, dir: THREE.Vector3, dist: number, allowWallbang: boolean): boolean {
    this.raycaster.set(origin, dir);
    this.raycaster.far = dist;
    const hits = this.raycaster.intersectObjects(this.map.wallMeshes, false);
    if (hits.length === 0) return true;
    if (!allowWallbang || this.mods.wallbangMaxWalls <= 0) return false;
    let wallsCrossed = 0;
    for (const h of hits) {
      const wt = h.object.userData.wallType as WallType;
      if (!this.canPierce(wt)) return false;
      wallsCrossed++;
      if (wallsCrossed > this.mods.wallbangMaxWalls) return false;
    }
    return true;
  }

  private hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.05) return true;
    dir.divideScalar(dist);
    this.raycaster.set(from, dir);
    this.raycaster.far = dist;
    return this.raycaster.intersectObjects(this.map.wallMeshes, false).length === 0;
  }

  private traceShot(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    range: number,
    allowWallbang: boolean,
  ): {
    bot: BotEntity | null;
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
    const includeExpanded = this.mods.hitboxOn;
    for (const b of this.bots) {
      targets.push(...b.getRaycastTargets(includeExpanded));
    }
    if (this.mpSession) {
      const skipFriendly = this.mpSession.rules.matchType === 'coop' && !this.mpSession.rules.friendlyFire;
      if (!skipFriendly) {
        for (const p of this.remotePeers.values()) {
          if (p.alive) targets.push(...p.entity.getRaycastTargets(includeExpanded));
        }
      }
    }

    const hits = this.raycaster.intersectObjects(targets, false);
    let wallsCrossed = 0;
    const seenWalls = new Set<THREE.Object3D>();

    for (const h of hits) {
      if (h.object.userData.isWall) {
        if (seenWalls.has(h.object)) continue;
        seenWalls.add(h.object);
        const wt = h.object.userData.wallType as WallType;
        if (!allowWallbang || !this.canPierce(wt) || wallsCrossed >= this.mods.wallbangMaxWalls) {
          const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
          return { bot: null, isHead: false, isBacktrack: false, throughWall: false, point: h.point, distance: h.distance, normal };
        }
        wallsCrossed++;
        continue;
      }
      const bot = h.object.userData.bot as BotEntity | undefined;
      if (bot && bot.alive) {
        return {
          bot,
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

  private tryShoot(fromTrigger: boolean): void {
    if (!this.alive) return;
    const slot = this.currentSlot();
    const def = slot.def;
    if (this.reloading) {
      // Allow late-reload completion interrupt once round is chambered (91%+ reload progress)
      const relProg = (this.elapsed - this.reloadStart) / Math.max(0.05, this.reloadEnd - this.reloadStart);
      if (relProg >= 0.91) {
        this.reloading = false;
        slot.ammo = this.magSize(def);
      } else {
        return;
      }
    }
    const rpmBoost = this.mods.fireRateMult * (fromTrigger ? this.mods.triggerRapidTap : 1);
    const interval = def.fireInterval / rpmBoost;
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
    this.aiManager?.recordSound('human', 'human', 'gunshot', this.pos, def.isMelee ? 5 : 38, this.elapsed);
    if (!def.isMelee && def.id !== 'shotgun' && def.id !== 'ssg' && def.id !== 'sniper') {
      this.spawnShellCasing(def.id);
    }
    this.fovKick = Math.min(2.6, this.fovKick + (def.id === 'sniper' ? 1.8 : def.id === 'shotgun' ? 1.2 : 0.45));

    // Recoil kick + damped camera rig impulse
    const recM = this.mods.recoilMult;
    const pitchKickRad = ((def.recoilKick * Math.PI) / 180) * recM;
    const yawKickRad = (((Math.random() * 2 - 1) * def.recoilYaw * Math.PI) / 180) * recM;
    this.recoilPitch += pitchKickRad * 0.55;
    this.recoilYaw += yawKickRad * 0.55;
    this.cameraRig.onFire(pitchKickRad * 0.65, yawKickRad * 0.65);

    const skin = getSkin(store.data.equippedSkins[def.id]);
    const isGoldBullet = this.mods.piggyGold && Math.random() < 1 / 15;
    const tracerColor = isGoldBullet ? '#facc15' : skin?.tracerColor ?? '#fef08a';

    // Aimbot Volley burst check!
    const volleyTriggered = !def.isMelee && this.mods.volleyCount > 0 && this.elapsed >= this.volleyReadyAt;
    if (volleyTriggered) {
      const targets = this.bots
        .filter((b) => b.alive && this.canReachPoint(
          this.camera.position,
          b.getHeadWorldPos().sub(this.camera.position).normalize(),
          b.getHeadWorldPos().distanceTo(this.camera.position),
          this.mods.aimbotWallLock,
        ))
        .sort((a, b) => BOUNTY_PAY[b.bounty] - BOUNTY_PAY[a.bounty])
        .slice(0, this.mods.volleyCount);

      if (targets.length >= 2) {
        this.volleyReadyAt = this.elapsed + this.mods.volleyCooldown;
        this.showBanner(`⚡ AIMBOT VOLLEY x${targets.length}! ⚡`, '#c084fc');
        const muzzle = this.getMuzzleWorldPos();
        for (const t of targets) {
          const hp = t.getHeadWorldPos();
          this.spawnTracer(muzzle, hp, '#c084fc');
          this.applyDamageToBot(t, def, true, false, false, hp, hp.distanceTo(this.camera.position), isLastBullet, true);
        }
        if (slot.ammo === 0 && !this.mods.infiniteAmmo) this.startReload();
        return;
      }
    }

    // Normal / Pellet shooting
    const muzzle = this.getMuzzleWorldPos();
    let anyHit = false;
    let killsThisShot = 0;
    let mpShotEnd: THREE.Vector3 | null = null;

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

    for (let p = 0; p < def.pellets; p++) {
      const dir = new THREE.Vector3(0, 0, -1);
      if (spread.totalDeg > 0.001) {
        const off = sampleSpreadOffsets(spread.totalDeg, spread.moveErrorDeg + spread.airErrorDeg);
        dir.x += off.x;
        dir.y += off.y;
        dir.normalize();
      }
      dir.applyQuaternion(this.camera.quaternion);

      const res = this.traceShot(this.camera.position, dir, def.range, this.mods.wallbangTier > 0);
      const endPt = res ? res.point : this.camera.position.clone().addScaledVector(dir, Math.min(60, def.range));
      if (!mpShotEnd) mpShotEnd = endPt;
      if (!def.isMelee) this.spawnTracer(muzzle, endPt, tracerColor);

      if (res?.bot) {
        anyHit = true;
        const killed = this.applyDamageToBot(
          res.bot,
          def,
          res.isHead || this.mods.fullBodyHead,
          res.throughWall,
          res.isBacktrack,
          res.point,
          res.distance,
          isLastBullet,
          false,
        );
        if (killed) killsThisShot++;
      } else if (res) {
        this.spawnSparks(res.point, '#cbd5e1', 4);
        if (res.normal) this.spawnDecal(res.point, res.normal);
      }
    }

    if (this.mpSession && mpShotEnd) {
      mp.sendPlayerFire({
        from: { x: muzzle.x, y: muzzle.y, z: muzzle.z },
        to: { x: mpShotEnd.x, y: mpShotEnd.y, z: mpShotEnd.z },
        weaponId: def.id,
        soundType: def.soundType,
        color: tracerColor,
        isMelee: Boolean(def.isMelee),
      });
    }

    // Piggy Bank deposit!
    if (this.mods.piggyOn && !def.isMelee && !this.mode.isPractice) {
      const baseDeposit = BALANCE.creditsPerKill * this.mode.killPayMult * 0.15 * store.getPrestigeMultiplier();
      const hitM = anyHit ? this.mods.piggyHitMult : 1;
      const goldM = isGoldBullet ? 10 : 1;
      const stormM = this.mods.piggyStorm && this.fireHoldTime >= 3 ? 2 : 1;
      this.bankCents += baseDeposit * hitM * goldM * stormM;
    }

    if (anyHit) {
      if (killsThisShot >= 2) {
        const bonus = Math.round(BALANCE.creditsPerKill * this.mode.killPayMult * BALANCE.collateralBonus * store.getPrestigeMultiplier());
        this.earnedCents += bonus;
        this.addBreakdown('Collateral', bonus, '#38bdf8');
        this.pushPayFeed(`+${formatMoney(bonus)} COLLATERAL!`, '#38bdf8');
      }
    } else {
      this.missesSinceKill++;
    }

    if (!def.isMelee && slot.ammo === 0 && !this.mods.infiniteAmmo) {
      this.startReload();
    }
  }

  private applyDamageToBot(
    bot: BotEntity,
    def: WeaponDef,
    isHead: boolean,
    throughWall: boolean,
    isBacktrack: boolean,
    point: THREE.Vector3,
    distance: number,
    isLastBullet: boolean,
    fromVolley: boolean,
  ): boolean {
    let dmg = def.damage * this.mods.damageMult;
    if (isHead) dmg *= def.headshotMultiplier * this.mods.headDamageMult;
    if (throughWall) dmg *= this.mods.wallbangDamage;
    if (bot.isCheaterBot && this.mods.spinbotResolver) dmg *= 2.0;
    if (isHead && this.mods.oneTapHead && !bot.isAdmin) dmg = Math.max(dmg, bot.maxHealth + 10);

    bot.flashTimer = 0.08;
    (bot.bodyMesh.material as THREE.MeshStandardMaterial).color.set('#ffffff');
    this.spawnSparks(point, isHead ? '#facc15' : '#f87171', isHead ? 9 : 5);

    this.hitmarkerUntil = this.elapsed + 0.16;
    this.hitmarkerHead = isHead;
    this.hitmarkerKill = false;

    if (bot.remotePlayerId) {
      sfx.playHit(isHead);
      mp.sendPlayerHit({
        targetId: bot.remotePlayerId,
        damage: Math.round(dmg),
        isHead,
        weaponId: def.id,
        throughWall,
        point: { x: point.x, y: point.y, z: point.z },
      });
      return false;
    }

    if (this.mpSession && !mp.isHost()) {
      sfx.playHit(isHead);
      mp.sendGuestBotHit({
        botId: bot.id,
        damage: Math.round(dmg),
        isHead,
        weaponId: def.id,
        point: { x: point.x, y: point.y, z: point.z },
      });
      return false;
    }

    if (bot.isDummy && bot.dummyMode === 'immortal') {
      sfx.playHit(isHead);
      this.pushPayFeed(`${Math.round(dmg)} DMG ${isHead ? '(HEAD)' : ''}`, isHead ? '#facc15' : '#e2e8f0');
      return false;
    }

    bot.health -= dmg;
    if (bot.health > 0) {
      this.aiManager?.onBotDamaged(`bot_${bot.id}`, this.pos, this.elapsed);
      sfx.playHit(isHead);
      return false;
    }

    // BOT KILLED!
    this.hitmarkerKill = true;
    this.onBotKilled(bot, def, isHead, throughWall, isBacktrack, point, distance, isLastBullet, fromVolley);
    return true;
  }

  private onBotKilled(
    bot: BotEntity,
    def: WeaponDef,
    isHead: boolean,
    throughWall: boolean,
    isBacktrack: boolean,
    point: THREE.Vector3,
    distance: number,
    isLastBullet: boolean,
    fromVolley: boolean,
    impulseOrigin?: THREE.Vector3,
    isExplosion = false,
  ): void {
    const snap = bot.getRagdollSnapshot();
    this.ragdolls.spawnFromBot(snap, impulseOrigin ?? this.camera.position, resolveKillKind(def, isHead, isExplosion));

    bot.alive = false;
    bot.deaths += 1;
    bot.root.visible = false;
    bot.clearGhosts();
    this.spawnSparks(point, BOUNTY_COLORS[bot.bounty], 16);

    if (bot.isDummy) {
      bot.respawnAt = this.elapsed + 1.5;
      sfx.playKill(1);
      this.pushPayFeed(`DUMMY ELIMINATED ${isHead ? 'HEADSHOT' : ''}`, '#4ade80');
      return;
    }

    if ((this.mode.id !== 'defend' || Boolean(this.mpSession)) && !bot.isAdmin) {
      bot.respawnAt = this.elapsed + (this.mode.id === 'arena' ? 1.1 : 1.9);
    }

    this.kills += 1;
    if (isHead) this.headshots += 1;

    // Multi-kill
    if (this.elapsed - this.lastKillAt <= BALANCE.multiKillWindow) this.multiKill += 1;
    else this.multiKill = 1;
    this.lastKillAt = this.elapsed;

    // Headshot Streak
    if (isHead && this.mods.hitboxOn) {
      this.headStreak += 1;
      this.maxStreak = Math.max(this.maxStreak, this.headStreak);
    } else if (!isHead) {
      this.headStreak = 0;
    }

    const skin = getSkin(store.data.equippedSkins[def.id]);
    sfx.playKill(this.headStreak || this.multiKill, skin?.killChime ?? 'default');

    // Compute Kill Payout!
    const prestigeMult = store.getPrestigeMultiplier();
    let total = BALANCE.creditsPerKill * this.mode.killPayMult * def.killPay * prestigeMult;
    this.addBreakdown('Kills + Waffe', total, '#4ade80');
    const tags: string[] = [];

    // Bounty multiplier
    let bountyMult = BOUNTY_PAY[bot.bounty];
    if (bot.isAdmin && this.mods.adminJammer) bountyMult *= 2;
    if (bountyMult > 1) {
      const add = total * (bountyMult - 1);
      total += add;
      this.addBreakdown('Bounties', add, BOUNTY_COLORS[bot.bounty]);
      tags.push(`${bot.isAdmin ? 'ADMIN' : bot.bounty.toUpperCase()} ${bountyMult}x`);
    }

    // Headshot bonus + Hitbox HS Pay + Headshot Streak
    if (isHead) {
      const hsAdd = total * BALANCE.headshotBonus * this.mods.headshotPayMult;
      total += hsAdd;
      this.addBreakdown('Headshots', hsAdd, '#facc15');
      tags.push('HEADSHOT');

      if (this.mods.headStreakStep > 0 && this.headStreak > 1) {
        const streakMult = Math.min(this.mods.headStreakCap, 1 + (this.headStreak - 1) * this.mods.headStreakStep);
        const sAdd = total * (streakMult - 1);
        total += sAdd;
        this.addBreakdown('HS-Streak', sAdd, '#fb923c');
        tags.push(`STREAK x${streakMult.toFixed(2)}`);
      }
    }

    // Wallbang Pay
    if (throughWall) {
      const wbMult = this.mods.wallbangPayMult > 1 ? this.mods.wallbangPayMult : 1.35;
      const wAdd = total * (wbMult - 1);
      total += wAdd;
      this.addBreakdown('Wallbang', wAdd, '#4ade80');
      tags.push('WALLBANG');
    }

    // Backtrack Pay
    if (isBacktrack) {
      const btAdd = total * BALANCE.backtrackBonus;
      total += btAdd;
      this.addBreakdown('Backtrack', btAdd, '#22d3ee');
      tags.push('BACKTRACK +150%');
    }

    // Style & Cheat bonuses
    if (def.scope && !this.scoped) {
      const add = total * BALANCE.noscopeBonus;
      total += add;
      this.addBreakdown('Noscope', add, '#a855f7');
      tags.push('NOSCOPE');
    } else if (def.scope && this.scoped && this.elapsed - this.scopedAt < 0.45) {
      const add = total * BALANCE.quickscopeBonus;
      total += add;
      this.addBreakdown('Quickscope', add, '#c084fc');
      tags.push('QUICKSCOPE');
    }
    if (!this.grounded) {
      const add = total * BALANCE.jumpshotBonus;
      total += add;
      this.addBreakdown('Jumpshot', add, '#38bdf8');
      tags.push('JUMPSHOT');
    }
    if (this.mods.spinbotAuto360 || this.turnedRecently >= 260) {
      const add = total * BALANCE.spinBonus;
      total += add;
      this.addBreakdown('360 Spin', add, '#e879f9');
      tags.push('360°');
    }
    if (this.mods.longshotPayMult > 1 && distance >= 20) {
      const add = total * (this.mods.longshotPayMult - 1);
      total += add;
      this.addBreakdown('Longshot', add, '#38bdf8');
      tags.push(`LONGSHOT ${Math.round(distance)}m`);
    }
    if (this.mods.bhopPayPerHop > 0 && this.hopChain > 0) {
      const add = total * (this.hopChain * this.mods.bhopPayPerHop);
      total += add;
      this.addBreakdown('Hop-Chain', add, '#2dd4bf');
      tags.push(`BHOP x${this.hopChain}`);
    }
    if (this.mods.triggerCleanPay > 1 && this.missesSinceKill === 0) {
      const add = total * (this.mods.triggerCleanPay - 1);
      total += add;
      this.addBreakdown('Clean Kills', add, '#fb923c');
      tags.push('CLEAN');
    }
    if (this.mods.momentumPay && this.multiKill >= 2) {
      const mMult = Math.min(2.5, 1 + (this.multiKill - 1) * 0.45);
      const add = total * (mMult - 1);
      total += add;
      this.addBreakdown('Multi-Kill', add, '#fbbf24');
      tags.push(`MULTI x${this.multiKill}`);
    }
    if (isLastBullet) {
      const add = total * BALANCE.lastBulletBonus;
      total += add;
      this.addBreakdown('Last Bullet', add, '#f472b6');
      tags.push('LAST BULLET');
    }
    if (bot.name === this.lastKillerName) {
      const add = total * BALANCE.revengeBonus;
      total += add;
      this.addBreakdown('Revenge', add, '#f43f5e');
      tags.push('REVENGE');
      this.lastKillerName = '';
    }

    const paid = Math.round(total);
    this.earnedCents += paid;
    this.missesSinceKill = 0;

    // Piggy Bank compound interest on kill
    if (this.mods.piggyOn && this.mods.piggyInterest > 0 && this.bankCents > 0) {
      this.bankCents *= 1 + this.mods.piggyInterest;
    }

    // Pay feed + Kill feed
    this.pushPayFeed(`+${formatMoney(paid)}  ${tags.slice(0, 3).join(' · ')}`, bot.bounty !== 'normal' ? BOUNTY_COLORS[bot.bounty] : '#4ade80');
    this.pushKillFeed(`Du [${def.shortName}${isHead ? ' 🎯' : ''}${throughWall ? ' 🧱' : ''}] ${bot.name}`, bot.isAdmin ? '#ff1e56' : '#f8fafc');
    if (this.mpSession && mp.isHost()) {
      mp.sendBotKill({
        killerId: mp.clientId || '',
        killerName: store.data.playerName,
        botName: bot.name,
        weaponId: def.id,
        isHead,
      });
    }

    // Case drop roll!
    const dropChance = bot.isAdmin ? 1.0 : BALANCE.caseDropChance * (bot.bounty === 'rainbow' ? 5 : 1);
    if (Math.random() < dropChance) {
      const dropped = bot.isAdmin ? { id: 'overdrive', name: 'Overdrive Vault' } : store.rollCaseDrop();
      this.casesDropped.push(dropped.id);
      this.pushPayFeed(`📦 CASE DROP: ${dropped.name}!`, '#facc15');
      sfx.playUi('cash');
    }

    // Admin kill reward & Heat reset
    if (bot.isAdmin) {
      this.adminsKilled += 1;
      this.heat = 20;
      this.banScanActive = false;
      this.showBanner(`👑 ADMIN ELIMINIERT! +${formatMoney(paid)} & OVERDRIVE CASE!`, '#facc15');
      this.chat.postSystem('ADMIN_BANHAMMER was fragged and disconnected in shame!', true);
    } else {
      // Suspicion / Heat escalation
      let heatAdd = this.mods.baseHeatPerKill;
      if (throughWall) heatAdd += 7;
      if (fromVolley) heatAdd += 14;
      if (isBacktrack) heatAdd += 6;
      if (this.mods.explodeOnKill) heatAdd += 8;
      if (isHead && this.headStreak >= 4) heatAdd += 4;
      this.heat = Math.min(100, this.heat + heatAdd * this.mods.heatMult);
      this.peakHeat = Math.max(this.peakHeat, this.heat);

      // Chat reaction
      const reason =
        fromVolley ? 'volley' :
        this.mods.explodeOnKill ? 'explode' :
        throughWall ? 'wallbang' :
        isBacktrack ? 'backtrack' :
        this.mods.killBlink ? 'blink' :
        this.mods.spinbotOn ? 'spin' :
        this.mods.bhopOn && this.hopChain >= 3 ? 'speed' :
        isHead ? 'headshot' : null;
      const bystander = this.bots.find((b) => b !== bot && !b.isAdmin && !b.isDummy)?.name ?? null;
      this.chat.onPlayerKill(this.elapsed, bot.name, bystander, this.heat, reason, this.kills, this.headshots);

      // Vote-Kick trigger at 55%+ Heat
      if (this.heat >= 55 && !this.voteActive && this.elapsed >= this.nextVoteAllowedAt) {
        this.triggerVoteKick();
      }
      // Admin Boss + Overwatch Ban-Scan at 100% Heat!
      if (this.heat >= 100) {
        if (!this.adminBot || !this.adminBot.alive) {
          this.spawnAdminBoss();
        }
        if (!this.banScanActive) {
          this.banScanActive = true;
          this.banScanEndAt = this.elapsed + this.banScanDuration;
          this.chat.postSystem('🚨 VAC OVERWATCH: Automatischer Ban-Scan gestartet (8.5s)!', true);
        }
      }
    }

    // Speedhack Kill-Dash
    if (this.mods.killDash) {
      this.dashUntil = this.elapsed + 1.8;
    }

    // Rage Exploding Bots (+ Backtrack Chrono-Echo synergy!)
    if (this.mods.explodeOnKill) {
      this.triggerExplosion(bot.pos.clone().add(new THREE.Vector3(0, 1, 0)), def, bot);
      if (isBacktrack && this.mods.backtrackChronoBlast) {
        this.triggerExplosion(point.clone(), def, bot);
      }
    }

    // Speedhack Kill-Blink teleport behind next living bot!
    if (this.mods.killBlink) {
      const next = this.bots
        .filter((b) => b.alive && b !== bot)
        .sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos))[0];
      if (next) {
        const behind = next.pos.clone().add(new THREE.Vector3(-Math.sin(next.yaw) * 3.5, 0, -Math.cos(next.yaw) * 3.5));
        resolveCircleWallCollision(behind, 0.5, this.map.walls, this.map.halfExtent);
        this.pos.copy(behind);
        this.yaw = Math.atan2(-(next.pos.x - this.pos.x), -(next.pos.z - this.pos.z));
        this.blinkFlash = 0.55;
        sfx.playBlink();
      }
    }
  }

  private triggerVoteKick(): void {
    this.nextVoteAllowedAt = this.elapsed + 18;
    if (this.mods.voteKickBlocker) {
      const bonus = Math.round(2500 * store.getPrestigeMultiplier());
      this.earnedCents += bonus;
      this.addBreakdown('Vote-Kick Troll', bonus, '#10b981');
      this.pushPayFeed(`+${formatMoney(bonus)} VOTE-KICK GEBLOCKT!`, '#10b981');
      this.chat.postSystem('Vote-Kick gegen dich wurde von kernel_spoof.sys manipuliert (0/5 JA)!');
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

  private triggerBanAttempt(source: string): void {
    if (this.spoofCharges > 0) {
      this.spoofCharges -= 1;
      this.banScanActive = false;
      this.heat = 35;
      if (this.health <= 0) {
        this.health = 100;
        this.spawnProtectUntil = this.elapsed + 2.0;
      }
      this.showBanner(`🛡 HWID SPOOFER HAT DEN BAN ABGEWEHRT! (${this.spoofCharges} ÜBRIG)`, '#10b981');
      this.chat.postSystem(`[ANTI-CHEAT] ${source} blockiert via HWID Spoof (${this.spoofCharges} übrig).`, true);
      sfx.playBlink();
      return;
    }
    this.banScanActive = false;
    this.finishMatch('banned');
  }

  private triggerExplosion(center: THREE.Vector3, def: WeaponDef, sourceBot: BotEntity): void {
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

    for (const other of this.bots) {
      if (!other.alive || other === sourceBot) continue;
      const d = other.pos.distanceTo(center);
      if (d <= this.mods.blastRadius) {
        const blastDmg = 95 * this.mods.blastDamageMult * (1 - d / (this.mods.blastRadius * 1.25));
        other.health -= blastDmg;
        if (other.health <= 0) {
          this.onBotKilled(other, def, false, false, false, other.getBodyWorldPos(), d, false, false, center, true);
        }
      }
    }
  }

  private stepBots(dt: number): void {
    const playerEye = this.camera.position;

    if (this.mpSession && !mp.isHost()) {
      for (const bot of this.bots) {
        if (!bot.alive) continue;
        bot.applyCheatVisuals(
          this.mods.headScale,
          this.mods.headBalloon,
          this.mods.headBoxColor,
          this.mods.chams,
          store.data.settings.enemyOutlines,
          store.data.settings.outlineColor,
        );
        bot.updateLOD(playerEye);
        bot.updateGhosts(this.elapsed, this.mods.backtrackOn, this.mods.backtrackWindow);
        bot.applyRemotePose(
          dt,
          bot.pos.x,
          bot.pos.y,
          bot.pos.z,
          bot.actualVel.x,
          bot.hopVelY,
          bot.actualVel.z,
          bot.yaw,
          false,
          bot.onGround,
          bot.isCheaterBot,
        );
      }
      return;
    }

    for (const bot of this.bots) {
      if (!bot.alive) {
        if (bot.respawnAt > 0 && this.elapsed >= bot.respawnAt) {
          bot.respawnAt = 0;
          if (bot.isDummy) {
            bot.spawn(bot.dummyHome, 'normal', false, false, false, this.elapsed);
          } else {
            bot.spawn(this.pickFarSpawn(), this.rollBounty(), !!this.mode.cheaterBots, false, false, this.elapsed);
            this.aiManager?.onBotRespawn(`bot_${bot.id}`, bot.yaw);
          }
        }
        continue;
      }

      bot.applyCheatVisuals(
        this.mods.headScale,
        this.mods.headBalloon,
        this.mods.headBoxColor,
        this.mods.chams,
        store.data.settings.enemyOutlines,
        store.data.settings.outlineColor,
      );
      bot.updateLOD(playerEye);
      bot.updateGhosts(this.elapsed, this.mods.backtrackOn, this.mods.backtrackWindow);

      if (bot.isDummy) {
        bot.updateDummy(dt, this.elapsed);
      }
    }

    if (!this.aiManager || this.mode.isPractice) return;
    this.aiManager.difficulty = store.data.settings.botDifficulty;

    const isFfa = this.mpSession ? this.mpSession.rules.matchType !== 'coop' : this.aiManager.adapter.isFfa;
    const combatants: AiCombatantInput[] = [
      {
        id: 'human',
        name: store.data.playerName,
        team: isFfa ? 'human' : 'human',
        side: isFfa ? 'ffa' : 'defenders',
        isHuman: true,
        alive: this.alive,
        hp: this.health,
        maxHp: BALANCE.playerMaxHealth,
        pos: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
        vel: { x: this.vel.x, y: 0, z: this.vel.z },
        yaw: this.yaw + Math.PI,
      },
    ];
    if (this.mpSession) {
      for (const p of this.remotePeers.values()) {
        combatants.push({
          id: p.id,
          name: p.name,
          team: isFfa ? p.id : 'human',
          side: isFfa ? 'ffa' : 'defenders',
          isHuman: true,
          alive: p.alive,
          hp: p.hp,
          maxHp: p.maxHp,
          pos: { x: p.entity.pos.x, y: p.entity.pos.y, z: p.entity.pos.z },
          vel: { x: p.targetVel.x, y: 0, z: p.targetVel.z },
          yaw: p.entity.yaw,
        });
      }
    }

    const botById = new Map<string, BotEntity>();
    for (const b of this.bots) {
      const aid = `bot_${b.id}`;
      botById.set(aid, b);
      combatants.push({
        id: aid,
        name: b.name,
        team: isFfa ? aid : 'bots',
        side: isFfa ? 'ffa' : 'attackers',
        isHuman: false,
        alive: b.alive,
        hp: b.health,
        maxHp: b.maxHealth,
        pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
        vel: { x: b.actualVel.x, y: 0, z: b.actualVel.z },
        yaw: b.yaw,
        isAdmin: b.isAdmin,
        isCheater: b.isCheaterBot,
        isRainbow: b.bounty === 'rainbow',
        freezeUntil: b.freezeUntil,
        fireInterval: b.isCheaterBot ? 0.34 : b.isAdmin ? 0.38 : BALANCE.botFireInterval,
        weaponRange: BALANCE.botSightRange,
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
        phase: 'active',
        phaseTimer: this.timeLeft,
        attackersTeam: 'bots',
        defendersTeam: 'human',
        defendSitePos: this.map.sitePos ? { x: this.map.sitePos.x, y: 0, z: this.map.sitePos.z } : undefined,
        defendSiteRadius: this.map.siteRadius,
        intermissionActive: this.roundIntermissionUntil > 0,
        playerPos: this.alive ? { x: this.pos.x, y: this.pos.y, z: this.pos.z } : undefined,
      },
      worldApi,
      BALANCE.botMoveSpeed,
    );

    for (const [aid, cmd] of cmds.entries()) {
      const bot = botById.get(aid);
      if (!bot || !bot.alive) continue;

      // Preserve Backtrack Freeze-Peek cheat on first human spot!
      const seesHuman =
        this.alive &&
        this.hasLineOfSight(bot.getHeadWorldPos(), playerEye) &&
        bot.pos.distanceTo(this.pos) <= BALANCE.botSightRange;
      if (seesHuman && bot.seenPlayerSince === 0) {
        bot.seenPlayerSince = this.elapsed;
        if (this.mods.backtrackFreezePeek) bot.freezeUntil = this.elapsed + 0.7;
      } else if (!seesHuman) {
        bot.seenPlayerSince = 0;
      }

      const botGroundY = this.map.sampleGroundHeight ? this.map.sampleGroundHeight(cmd.nextPos.x, cmd.nextPos.z, bot.pos.y) : 0;
      bot.applyLocomotion(
        dt,
        cmd.nextPos,
        cmd.targetYaw,
        cmd.turnRateRadSec,
        cmd.isSpinVisual,
        cmd.isBunnyHop,
        false,
        botGroundY,
      );

      if (cmd.shouldFire && cmd.targetActorId && this.elapsed >= bot.freezeUntil) {
        this.aiManager.recordSound(
          aid,
          isFfa ? aid : 'bots',
          'gunshot',
          bot.pos,
          36,
          this.elapsed,
        );
        if (cmd.targetActorId === 'human') {
          this.onBotShootPlayer(bot);
        } else if (this.mpSession && this.remotePeers.has(cmd.targetActorId)) {
          const vic = this.remotePeers.get(cmd.targetActorId)!;
          if (vic.alive) this.onBotShootBot(bot, vic.entity);
        } else {
          const vic = botById.get(cmd.targetActorId);
          if (vic && vic.alive) this.onBotShootBot(bot, vic);
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

  private onBotShootBot(shooter: BotEntity, victim: BotEntity): void {
    shooter.onFireVisual();
    const from = shooter.getMuzzleWorldPos();
    const to = victim.getHeadWorldPos().add(
      new THREE.Vector3((Math.random() - 0.5) * 0.65, (Math.random() - 0.5) * 0.55, (Math.random() - 0.5) * 0.65),
    );
    const camDist = from.distanceTo(this.camera.position);
    if (camDist < 78) {
      const occ = this.getOccludingWalls(from, this.camera.position);
      const srcEnv = probeAcousticEnvironment(from, this.map.walls, { theme: this.mode.id });
      const soundId = shooter.isAdmin ? 'sniper' : shooter.isCheaterBot ? 'm4' : 'rifle';
      sfx.playSpatialShot(soundId, from, camDist, occ, srcEnv.zone, this.computeStereoPan(from), shooter.isAdmin);
    }
    this.spawnTracer(from, to, shooter.isCheaterBot ? '#e879f9' : '#fb923c');

    const dist = from.distanceTo(victim.pos);
    const diffCfg = BOT_DIFFICULTIES[store.data.settings.botDifficulty];
    const baseAcc = diffCfg.id === 'easy' ? 0.3 : diffCfg.id === 'hard' ? 0.48 : diffCfg.id === 'expert' ? 0.55 : 0.42;
    const hitChance = THREE.MathUtils.clamp(baseAcc - dist * 0.007, 0.14, 0.58);
    if (Math.random() > hitChance) return;

    const dmg = (shooter.isCheaterBot ? 18 : BALANCE.botDamage * 1.45) * (Math.random() < 0.2 ? 1.65 : 1);
    victim.health -= dmg;
    victim.flashTimer = 0.08;
    if (victim.health > 0) {
      this.aiManager?.onBotDamaged(`bot_${victim.id}`, shooter.pos, this.elapsed);
      return;
    }

    const snap = victim.getRagdollSnapshot();
    this.ragdolls.spawnFromBot(snap, shooter.pos, 'body');

    victim.alive = false;
    victim.deaths += 1;
    victim.root.visible = false;
    victim.clearGhosts();
    victim.respawnAt = this.elapsed + (this.mode.id === 'arena' ? 1.1 : 1.9);
    shooter.kills += 1;
    this.pushKillFeed(`${shooter.name} [🔫] ${victim.name}`, '#94a3b8');
  }

  private onBotShootPlayer(bot: BotEntity): void {
    bot.onFireVisual();
    const from = bot.getMuzzleWorldPos();
    const dist = from.distanceTo(this.camera.position);
    const occ = this.getOccludingWalls(from, this.camera.position);
    const srcEnv = probeAcousticEnvironment(from, this.map.walls, { theme: this.mode.id });
    const soundId = bot.isAdmin ? 'sniper' : bot.isCheaterBot ? 'm4' : 'rifle';
    sfx.playSpatialShot(soundId, from, dist, occ, srcEnv.zone, this.computeStereoPan(from), bot.isAdmin);

    const to = this.camera.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.65, (Math.random() - 0.5) * 0.55, (Math.random() - 0.5) * 0.65));
    this.spawnTracer(from, to, bot.isAdmin ? '#ff1e56' : bot.isCheaterBot ? '#e879f9' : '#fb923c');

    if (!this.alive || this.elapsed < this.spawnProtectUntil) return;

    let hitChance = THREE.MathUtils.lerp(BALANCE.botHitChanceNear, BALANCE.botHitChanceFar, THREE.MathUtils.clamp((dist - 5) / 28, 0, 1));
    if (bot.isCheaterBot) hitChance = Math.min(0.75, hitChance * 1.4);
    if (bot.isAdmin) hitChance = 0.65;

    // Evasion from cheats (Speedhack / Bhop / Spinbot)
    const speedNow = Math.hypot(this.vel.x, this.vel.z);
    if (this.mods.sprintDodge > 0 && speedNow > 5) hitChance *= 1 - this.mods.sprintDodge;
    if (this.mods.bhopDodge > 0 && this.hopChain >= 2) hitChance *= 1 - this.mods.bhopDodge;
    if (this.mods.spinbotDodge > 0) hitChance *= 1 - this.mods.spinbotDodge;

    if (Math.random() > hitChance) return;

    const dmg = (bot.isAdmin ? 34 : bot.isCheaterBot ? 16 : BALANCE.botDamage) * (Math.random() < BALANCE.botHeadshotChance ? 1.7 : 1);
    this.health -= dmg;
    this.defendHurtThisRound = true;
    this.hurtFlash = 0.65;
    this.cameraRig.onHitFlinch(THREE.MathUtils.clamp(dmg / 35, 0.35, 1.25));
    this.dmgIndicators.push({ fromPos: bot.pos.clone(), until: this.elapsed + 0.85 });
    sfx.playHurt();

    if (this.health <= 0) {
      this.health = 0;
      if (bot.isAdmin) {
        this.triggerBanAttempt('ADMIN_BANHAMMER');
        return;
      }

      this.alive = false;
      sfx.cancelWeaponFoley('player_weapon');
      this.deaths += 1;
      bot.kills += 1;
      this.headStreak = 0;
      this.hopChain = 0;
      this.lastKillerName = bot.name;
      this.respawnAt = this.elapsed + BALANCE.playerRespawnDelay;
      this.pushKillFeed(`${bot.name} [🔫] Du`, '#f87171');
      this.chat.onPlayerDied(this.elapsed, bot.name, this.heat);
    }
  }

  private getMuzzleWorldPos(): THREE.Vector3 {
    if (!this.scoped) return this.viewModel.getMuzzleWorldPos();
    const v = new THREE.Vector3(0.0, -0.06, -0.65);
    v.applyQuaternion(this.camera.quaternion).add(this.camera.position);
    return v;
  }

  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3, color: string): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geo, mat);
    this.fxGroup.add(line);
    this.tracers.push({ line, dieAt: this.elapsed + 0.085 });
  }

  private spawnSparks(at: THREE.Vector3, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.08),
        new THREE.MeshBasicMaterial({ color }),
      );
      m.position.copy(at);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 6 + 1, (Math.random() - 0.5) * 8);
      this.fxGroup.add(m);
      this.sparks.push({ mesh: m, vel, dieAt: this.elapsed + 0.25 + Math.random() * 0.2 });
    }
  }

  private spawnDecal(point: THREE.Vector3, normal: THREE.Vector3): void {
    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(0.055, 8),
      new THREE.MeshBasicMaterial({
        color: '#0f172a',
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    hole.position.copy(point).addScaledVector(normal, 0.012);
    hole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    this.fxGroup.add(hole);
    this.decals.push(hole);
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
      new THREE.CylinderGeometry(
        isShotgun ? 0.011 : 0.0075,
        isShotgun ? 0.011 : 0.0075,
        isShotgun ? 0.042 : 0.028,
        7,
      ),
      new THREE.MeshStandardMaterial({
        color: isShotgun ? '#991b1b' : '#d4a64a',
        metalness: isShotgun ? 0.1 : 0.9,
        roughness: isShotgun ? 0.44 : 0.22,
      }),
    );
    const start = !this.scoped
      ? this.viewModel.getEjectionWorldPos()
      : new THREE.Vector3(0.18, -0.1, -0.4).applyQuaternion(this.camera.quaternion).add(this.camera.position);
    mesh.position.copy(start);
    const vel = new THREE.Vector3(
      1.85 + Math.random() * 1.05,
      1.55 + Math.random() * 0.85,
      0.35 + Math.random() * 0.45,
    ).applyQuaternion(this.camera.quaternion);
    const rotVel = new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
    this.fxGroup.add(mesh);
    this.casings.push({ mesh, vel, rotVel, dieAt: this.elapsed + 2.8, isShotgun, bounceCount: 0, lastBounceAt: -10 });
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
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      if (this.elapsed >= sp.dieAt) {
        this.fxGroup.remove(sp.mesh);
        sp.mesh.geometry.dispose();
        (sp.mesh.material as THREE.Material).dispose();
        this.sparks.splice(i, 1);
      } else {
        sp.vel.y -= 18 * dt;
        sp.mesh.position.addScaledVector(sp.vel, dt);
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
  }

  // 2D Overlay: Wallhack ESP Boxes + Aimbot FOV Ring + Custom Crosshair + Hitmarker
  private drawOverlay2D(): void {
    const ctx = this.octx;
    const w = this.overlayCanvas.width;
    const h = this.overlayCanvas.height;
    ctx.clearRect(0, 0, w, h);

    // 1. Wallhack 2D ESP Boxes + Multiplayer Floating Nametags
    if (this.mpSession) {
      const tagW = new THREE.Vector3();
      const isCoop = this.mpSession.rules.matchType === 'coop';
      for (const peer of this.remotePeers.values()) {
        if (!peer.alive) continue;
        const headW = new THREE.Vector3(peer.entity.pos.x, peer.entity.pos.y + 2.08, peer.entity.pos.z);
        const visible = isCoop || this.mods.wallhackOn || this.hasLineOfSight(this.camera.position, headW);
        if (!visible) continue;
        tagW.copy(headW).project(this.camera);
        if (tagW.z > 1) continue;
        const sx = (tagW.x * 0.5 + 0.5) * w;
        const sy = (-tagW.y * 0.5 + 0.5) * h;
        const dist = Math.round(peer.entity.pos.distanceTo(this.pos));
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(2,6,23,0.75)';
        ctx.fillRect(sx - 44, sy - 24, 88, 18);
        ctx.fillStyle = isCoop ? '#4ade80' : '#38bdf8';
        ctx.fillText(`${peer.name} (${dist}m)`, sx, sy - 11);
        const hpFrac = Math.max(0, Math.min(1, peer.hp / peer.maxHp));
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(sx - 28, sy - 4, 56, 4);
        ctx.fillStyle = hpFrac > 0.5 ? '#4ade80' : hpFrac > 0.25 ? '#facc15' : '#ef4444';
        ctx.fillRect(sx - 28, sy - 4, 56 * hpFrac, 4);
      }
    }

    if (this.mods.espBoxes) {
      const topW = new THREE.Vector3();
      const botW = new THREE.Vector3();
      const espTargets: BotEntity[] = [...this.bots];
      if (this.mpSession) {
        for (const p of this.remotePeers.values()) {
          if (this.mpSession.rules.matchType !== 'coop') espTargets.push(p.entity);
        }
      }
      for (const bot of espTargets) {
        if (!bot.alive) continue;
        const scale = bot.isAdmin ? 1.45 : 1;
        topW.set(bot.pos.x, bot.pos.y + 2.05 * scale, bot.pos.z);
        botW.set(bot.pos.x, bot.pos.y, bot.pos.z);
        topW.project(this.camera);
        botW.project(this.camera);
        if (topW.z > 1 || botW.z > 1) continue;

        const sx = (topW.x * 0.5 + 0.5) * w;
        const syTop = (-topW.y * 0.5 + 0.5) * h;
        const syBot = (-botW.y * 0.5 + 0.5) * h;
        const boxH = Math.max(18, syBot - syTop);
        const boxW = boxH * 0.55;
        const x = sx - boxW / 2;
        const y = syTop;

        const visible = this.hasLineOfSight(this.camera.position, bot.getHeadWorldPos());
        const col = bot.bounty === 'rainbow'
          ? `hsl(${(performance.now() * 0.25) % 360}, 95%, 60%)`
          : bot.isAdmin ? '#ff1e56' : bot.bounty === 'normal' ? (visible ? '#4ade80' : '#94a3b8') : BOUNTY_COLORS[bot.bounty];

        // Corner brackets
        const cLen = Math.min(12, boxW * 0.3);
        ctx.strokeStyle = col;
        ctx.lineWidth = bot.bounty !== 'normal' ? 2.5 : 1.7;
        ctx.beginPath();
        // TL
        ctx.moveTo(x, y + cLen); ctx.lineTo(x, y); ctx.lineTo(x + cLen, y);
        // TR
        ctx.moveTo(x + boxW - cLen, y); ctx.lineTo(x + boxW, y); ctx.lineTo(x + boxW, y + cLen);
        // BL
        ctx.moveTo(x, y + boxH - cLen); ctx.lineTo(x, y + boxH); ctx.lineTo(x + cLen, y + boxH);
        // BR
        ctx.moveTo(x + boxW - cLen, y + boxH); ctx.lineTo(x + boxW, y + boxH); ctx.lineTo(x + boxW, y + boxH - cLen);
        ctx.stroke();

        // HP bar on left side
        const hpFrac = Math.max(0, bot.health / bot.maxHealth);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - 6, y, 3, boxH);
        ctx.fillStyle = hpFrac > 0.5 ? '#4ade80' : hpFrac > 0.25 ? '#facc15' : '#ef4444';
        ctx.fillRect(x - 6, y + boxH * (1 - hpFrac), 3, boxH * hpFrac);

        // Name & Bounty tag
        const dist = Math.round(bot.pos.distanceTo(this.pos));
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = col;
        const badge = bot.isAdmin ? '⚠ ADMIN 75x' : bot.bounty !== 'normal' ? `★ ${BOUNTY_PAY[bot.bounty]}x` : '';
        ctx.fillText(`${bot.name} ${badge}`, sx, y - 5);
        ctx.fillStyle = 'rgba(226,232,240,0.85)';
        ctx.font = '10px monospace';
        ctx.fillText(`${dist}m`, sx, y + boxH + 11);
      }
    }

    // 2. Aimbot FOV Ring
    if (this.mods.aimbotRing && this.mods.aimbotFovDeg < 179) {
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

    // 3. Crosshair
    if (!this.scoped && this.alive) {
      const xh = store.data.settings.crosshair;
      const cx = w / 2;
      const cy = h / 2;
      const dynGap = xh.dynamic ? this.crosshairSpreadPx : 0;
      const gap = xh.gap + dynGap;
      const len = xh.length;
      const th = xh.thickness;

      const drawRect = (rx: number, ry: number, rw: number, rh: number) => {
        if (xh.outline) {
          ctx.fillStyle = 'rgba(0,0,0,0.8)';
          ctx.fillRect(rx - 1, ry - 1, rw + 2, rh + 2);
        }
        ctx.fillStyle = xh.color;
        ctx.fillRect(rx, ry, rw, rh);
      };
      drawRect(cx - gap - len, cy - th / 2, len, th);
      drawRect(cx + gap, cy - th / 2, len, th);
      drawRect(cx - th / 2, cy - gap - len, th, len);
      drawRect(cx - th / 2, cy + gap, th, len);
      if (xh.dot) drawRect(cx - th / 2, cy - th / 2, th, th);
    }

    // 4. Hitmarker X
    if (this.elapsed < this.hitmarkerUntil) {
      const cx = w / 2;
      const cy = h / 2;
      ctx.strokeStyle = this.hitmarkerKill ? '#facc15' : this.hitmarkerHead ? '#ef4444' : '#ffffff';
      ctx.lineWidth = this.hitmarkerKill ? 3 : 2;
      const r1 = 6;
      const r2 = this.hitmarkerKill ? 15 : 12;
      ctx.beginPath();
      ctx.moveTo(cx - r2, cy - r2); ctx.lineTo(cx - r1, cy - r1);
      ctx.moveTo(cx + r2, cy - r2); ctx.lineTo(cx + r1, cy - r1);
      ctx.moveTo(cx - r2, cy + r2); ctx.lineTo(cx - r1, cy + r1);
      ctx.moveTo(cx + r2, cy + r2); ctx.lineTo(cx + r1, cy + r1);
      ctx.stroke();
    }

    // 5. Directional Damage Indicators
    this.dmgIndicators = this.dmgIndicators.filter((d) => this.elapsed < d.until);
    if (this.dmgIndicators.length > 0 && this.alive) {
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const cx = w / 2;
      const cy = h / 2;
      for (const ind of this.dmgIndicators) {
        const toSrc = new THREE.Vector3(ind.fromPos.x - this.pos.x, 0, ind.fromPos.z - this.pos.z);
        if (toSrc.lengthSq() < 1e-5) continue;
        toSrc.normalize();
        const fDot = fwd.dot(toSrc);
        const rDot = right.dot(toSrc);
        const ang = Math.atan2(-fDot, rDot);
        const alpha = THREE.MathUtils.clamp((ind.until - this.elapsed) / 0.85, 0, 1);
        ctx.save();
        ctx.strokeStyle = `rgba(239, 68, 68, ${(alpha * 0.9).toFixed(2)})`;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(w, h) * 0.16, ang - 0.34, ang + 0.34);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (this.aiManager && this.aiDebug) {
      this.aiDebug.render(store.data.settings.aiDebugOverlay, ctx, w, h, this.camera, this.aiManager);
    }
  }

  private updateHudDom(): void {
    const timerEl = document.getElementById('hud-timer');
    if (timerEl) {
      if (this.mode.isPractice) {
        timerEl.textContent = 'RANGE';
      } else {
        const s = Math.ceil(Math.max(0, this.timeLeft));
        timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }
    }

    const kdEl = document.getElementById('hud-kd');
    if (kdEl) kdEl.textContent = `K ${this.kills} · D ${this.deaths} · HS ${this.headshots}`;

    const defEl = document.getElementById('hud-defend');
    if (defEl) {
      if (this.mode.id === 'defend') {
        defEl.classList.remove('hidden');
        const plantPct = Math.round(this.plantProgress * 100);
        defEl.innerHTML = `RUNDE ${this.defendRound}/${this.mode.rounds} · <span style="color:#4ade80">GEHALTEN ${this.roundsHeld}</span> · <span style="color:#f87171">VERLOREN ${this.roundsLost}</span>${plantPct > 0 ? ` · <span style="color:#ff1e56">PLANTING ${plantPct}%</span>` : ''}`;
      } else {
        defEl.classList.add('hidden');
      }
    }

    const scanEl = document.getElementById('hud-banscan');
    if (scanEl) {
      if (this.banScanActive) {
        const rem = Math.max(0, this.banScanEndAt - this.elapsed);
        scanEl.classList.remove('hidden');
        scanEl.textContent = `🚨 VAC OVERWATCH BAN-SCAN: ${rem.toFixed(1)}s — TÖTE DEN ADMIN ODER FLIEGE!`;
      } else {
        scanEl.classList.add('hidden');
      }
    }

    const walEl = document.getElementById('hud-wallet');
    if (walEl) walEl.textContent = `${formatMoney(store.data.credits + this.earnedCents)} (+${formatMoney(this.earnedCents)})`;

    const pigEl = document.getElementById('hud-piggy');
    if (pigEl) {
      if (this.mods.piggyOn && !this.mode.isPractice) {
        pigEl.classList.remove('hidden');
        pigEl.textContent = `🐷 PIGGY BANK: ${formatMoney(this.bankCents)}${this.mods.piggyStorm && this.fireHoldTime >= 3 ? ' 🔥STORM 2x' : ''}`;
      } else {
        pigEl.classList.add('hidden');
      }
    }

    const heatPct = document.getElementById('hud-heat-pct');
    const heatFill = document.getElementById('hud-heat-fill');
    const heatMeta = document.getElementById('hud-heat-meta');
    if (heatPct && heatFill && heatMeta) {
      const h = Math.round(this.heat);
      heatPct.textContent = `${h}%`;
      heatFill.style.width = `${h}%`;
      heatFill.style.background = h >= 80 ? '#ff1e56' : h >= 50 ? '#f59e0b' : '#4ade80';
      heatMeta.textContent = this.spoofCharges > 0 ? `🛡 HWID Spoof: ${this.spoofCharges}` : h >= 80 ? '⚠ ADMIN WATCHING!' : '';
    }

    const streakEl = document.getElementById('hud-streak');
    if (streakEl) {
      if (this.mods.hitboxOn && this.headStreak >= 2) {
        const mult = Math.min(this.mods.headStreakCap, 1 + (this.headStreak - 1) * this.mods.headStreakStep);
        streakEl.classList.remove('hidden');
        streakEl.innerHTML = `🔥 ${this.headStreak} HEADSHOT STREAK <span>x${mult.toFixed(2)}</span>`;
      } else {
        streakEl.classList.add('hidden');
      }
    }

    const hpEl = document.getElementById('hud-hp');
    const hpFill = document.getElementById('hud-hp-fill');
    if (hpEl && hpFill) {
      hpEl.textContent = this.alive ? String(Math.ceil(this.health)) : `RESPAWN ${Math.max(0, this.respawnAt - this.elapsed).toFixed(1)}s`;
      hpFill.style.width = `${Math.max(0, this.health)}%`;
    }

    const speedEl = document.getElementById('hud-speed');
    if (speedEl) {
      const spdPct = Math.round((Math.hypot(this.vel.x, this.vel.z) / BALANCE.walkSpeed) * 100);
      if (this.mods.bhopOn || this.mods.speedMult > 1.01) {
        speedEl.classList.remove('hidden');
        speedEl.textContent = `SPEED ${spdPct}%${this.hopChain > 0 ? ` · HOP x${this.hopChain}` : ''}`;
      } else {
        speedEl.classList.add('hidden');
      }
    }

    const volEl = document.getElementById('hud-volley');
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

    const wEl = document.getElementById('hud-weapon');
    const aEl = document.getElementById('hud-ammo');
    const slot = this.currentSlot();
    if (wEl && aEl) {
      wEl.textContent = slot.def.name.toUpperCase();
      aEl.textContent = slot.def.isMelee
        ? 'MELEE'
        : this.reloading
          ? 'RELOADING...'
          : this.mods.infiniteAmmo
            ? '∞ / ∞'
            : `${slot.ammo} / ${this.magSize(slot.def)}`;
    }

    // Prune feed DOM
    const now = this.elapsed;
    const activePay = this.payFeed.filter((f) => f.dieAt > now);
    if (activePay.length !== this.payFeed.length) {
      this.payFeed = activePay;
      this.renderPayFeed();
    }
    const activeKf = this.killFeed.filter((f) => f.dieAt > now);
    if (activeKf.length !== this.killFeed.length) {
      this.killFeed = activeKf;
      this.renderKillFeed();
    }
  }

  private addBreakdown(label: string, amount: number, color: string): void {
    const prev = this.breakdownMap.get(label);
    if (prev) prev.amount += amount;
    else this.breakdownMap.set(label, { amount, color });
  }

  private pushPayFeed(text: string, color: string): void {
    this.payFeed.push({ text, color, dieAt: this.elapsed + 2.6 });
    if (this.payFeed.length > 6) this.payFeed.shift();
    this.renderPayFeed();
  }

  private renderPayFeed(): void {
    this.payfeedEl.innerHTML = this.payFeed
      .map((f) => `<div class="payfeed-line" style="color:${f.color}">${f.text}</div>`)
      .join('');
  }

  private pushKillFeed(text: string, color: string): void {
    this.killFeed.push({ text, color, dieAt: this.elapsed + 4.5 });
    if (this.killFeed.length > 5) this.killFeed.shift();
    this.renderKillFeed();
  }

  private renderKillFeed(): void {
    this.killfeedEl.innerHTML = this.killFeed
      .map((f) => `<div class="killfeed-line" style="color:${f.color}">${f.text}</div>`)
      .join('');
  }

  private renderChat(): void {
    this.lastChatRenderCount = this.chat.messages.length;
    this.chatEl.innerHTML = this.chat.messages
      .map(
        (m) => `<div class="chat-line ${m.admin ? 'admin' : m.system ? 'sys' : ''}">
          ${m.dead ? '<span class="chat-dead">*DEAD*</span> ' : ''}<span class="chat-who">${m.who}:</span> ${m.text}
        </div>`,
      )
      .join('');
  }

  private showBanner(text: string, color: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.style.color = color;
    this.bannerEl.classList.add('show');
    window.setTimeout(() => this.bannerEl.classList.remove('show'), 2600);
  }

  private initRemotePeers(): void {
    if (!this.mpSession) return;
    let idx = 0;
    for (const p of this.mpSession.players) {
      if (p.id === mp.clientId) continue;
      this.createRemotePeer(p.id, p.name, p.team, p.weaponId, p.skinId, p.spawnIdx, p.hp, p.alive, idx++);
    }
  }

  private createRemotePeer(
    id: string,
    name: string,
    team: string,
    weaponId: string,
    skinId: string,
    spawnIdx: number,
    hp: number,
    alive: boolean,
    idxHint: number,
  ): RemotePeerEntry {
    const existing = this.remotePeers.get(id);
    if (existing) return existing;

    const ent = new BotEntity(200 + idxHint, this.scene, this.ghostGroup, false);
    ent.name = name;
    const isCoop = this.mpSession?.rules.matchType === 'coop';
    const sp = this.map.playerSpawns[spawnIdx % this.map.playerSpawns.length].clone();
    ent.spawn(sp, 'normal', false, false, false, this.elapsed);
    ent.applyTeamAppearance(isCoop ? 'defenders' : 'attackers', isCoop);
    ent.setRemotePlayerId(id);
    ent.health = hp;
    ent.maxHealth = 100;
    ent.alive = alive;
    ent.root.visible = alive;

    const entry: RemotePeerEntry = {
      id,
      name,
      team,
      weaponId,
      skinId,
      entity: ent,
      targetPos: sp.clone(),
      targetVel: new THREE.Vector3(),
      targetYaw: Math.atan2(-sp.x, -sp.z),
      crouching: false,
      grounded: true,
      spinbot: false,
      hp,
      maxHp: 100,
      alive,
      kills: 0,
      deaths: 0,
      headshots: 0,
    };
    this.remotePeers.set(id, entry);
    return entry;
  }

  private bindMultiplayerEvents(): void {
    if (!this.mpSession) return;
    const isCoop = this.mpSession.rules.matchType === 'coop';

    this.mpUnsubs.push(
      mp.on<MpPeerState>('peer_state', (s) => {
        if (s.id === mp.clientId) return;
        let peer = this.remotePeers.get(s.id);
        if (!peer) {
          peer = this.createRemotePeer(
            s.id,
            s.name,
            isCoop ? 'human' : s.id,
            s.weaponId,
            s.skinId,
            0,
            s.hp,
            s.alive,
            this.remotePeers.size,
          );
        }
        peer.name = s.name;
        peer.entity.name = s.name;
        peer.targetPos.set(s.x, s.y, s.z);
        peer.targetVel.set(s.vx, s.vy, s.vz);
        peer.targetYaw = s.yaw;
        peer.crouching = s.crouching;
        peer.grounded = s.grounded;
        peer.spinbot = s.spinbot;
        peer.weaponId = s.weaponId;
        peer.skinId = s.skinId;
        peer.hp = s.hp;
        peer.alive = s.alive;
        peer.entity.health = s.hp;
        peer.entity.alive = s.alive;
        peer.entity.root.visible = s.alive;
      }),
      mp.on<MpPeerFire>('peer_fire', (f) => {
        const peer = this.remotePeers.get(f.id);
        if (peer) peer.entity.onFireVisual();
        const from = new THREE.Vector3(f.from.x, f.from.y, f.from.z);
        const to = new THREE.Vector3(f.to.x, f.to.y, f.to.z);
        if (!f.isMelee) this.spawnTracer(from, to, f.color || '#fef08a');
        const dist = from.distanceTo(this.camera.position);
        if (dist < 78) {
          const occ = this.getOccludingWalls(from, this.camera.position);
          const env = probeAcousticEnvironment(from, this.map.walls, { theme: this.mode.id });
          const sid = (
            ['knife', 'pistol', 'smg', 'shotgun', 'ssg', 'rifle', 'sniper', 'm4'].includes(f.soundType)
              ? f.soundType
              : 'rifle'
          ) as Parameters<typeof sfx.playSpatialShot>[0];
          sfx.playSpatialShot(sid, from, dist, occ, env.zone, this.computeStereoPan(from));
        }
      }),
      mp.on<MpDamageApplied>('damage_applied', (d) => {
        if (d.point) {
          this.spawnSparks(new THREE.Vector3(d.point.x, d.point.y, d.point.z), d.isHead ? '#facc15' : '#f87171', 6);
        }
        if (d.targetId === mp.clientId) {
          this.health = d.hp;
          this.hurtFlash = 0.65;
          this.cameraRig.onHitFlinch(THREE.MathUtils.clamp(d.damage / 35, 0.35, 1.25));
          sfx.playHurt();
          const atk = this.remotePeers.get(d.attackerId);
          if (atk) {
            this.dmgIndicators.push({ fromPos: atk.entity.pos.clone(), until: this.elapsed + 0.85 });
          }
        } else {
          const peer = this.remotePeers.get(d.targetId);
          if (peer) {
            peer.hp = d.hp;
            peer.entity.health = d.hp;
            peer.entity.flashTimer = 0.08;
            peer.entity.triggerHitFlinch(0.9);
          }
        }
      }),
      mp.on<MpPlayerKilled>('player_killed', (k) => {
        for (const [pid, sc] of Object.entries(k.scores)) {
          if (pid === mp.clientId) {
            this.kills = sc.kills;
            this.deaths = sc.deaths;
            this.headshots = sc.headshots;
          } else {
            const p = this.remotePeers.get(pid);
            if (p) {
              p.kills = sc.kills;
              p.deaths = sc.deaths;
              p.headshots = sc.headshots;
            }
          }
        }
        const wShort = getWeaponDef(k.weaponId).shortName;
        const isMeAtk = k.attackerId === mp.clientId;
        const isMeVic = k.targetId === mp.clientId;
        this.pushKillFeed(
          `${k.attackerName} [${wShort}${k.isHead ? ' 🎯' : ''}${k.throughWall ? ' 🧱' : ''}] ${k.targetName}`,
          isMeAtk ? '#4ade80' : isMeVic ? '#f87171' : '#f8fafc',
        );

        if (isMeAtk) {
          this.hitmarkerUntil = this.elapsed + 0.2;
          this.hitmarkerHead = k.isHead;
          this.hitmarkerKill = true;
          const killPay = Math.round(
            BALANCE.creditsPerKill * this.mode.killPayMult * (k.isHead ? 1.5 : 1.0) * store.getPrestigeMultiplier(),
          );
          this.earnedCents += killPay;
          this.addBreakdown('PvP Kills', killPay, '#4ade80');
          this.pushPayFeed(`+${formatMoney(killPay)} ${k.isHead ? 'HEADSHOT ' : ''}${k.targetName}`, '#4ade80');
          sfx.playKill(k.isHead ? 2 : 1, getSkin(store.data.equippedSkins[k.weaponId])?.killChime ?? 'default');
        }

        if (isMeVic) {
          this.alive = false;
          this.health = 0;
          this.lastKillerName = k.attackerName;
          this.reloading = false;
          sfx.cancelWeaponFoley('player_weapon');
          this.respawnAt = this.elapsed + (this.mpSession?.rules.matchType === 'duel' ? 1.3 : 2.0);
        } else {
          const peer = this.remotePeers.get(k.targetId);
          if (peer) {
            const atkPos =
              isMeAtk
                ? this.camera.position
                : this.remotePeers.get(k.attackerId)?.entity.pos ?? new THREE.Vector3();
            this.ragdolls.spawnFromBot(peer.entity.getRagdollSnapshot(), atkPos, k.isHead ? 'headshot' : 'body');
            peer.alive = false;
            peer.hp = 0;
            peer.entity.alive = false;
            peer.entity.root.visible = false;
            peer.entity.clearGhosts();
          }
        }
        if (this.tabHeld) this.renderMpScoreboard();
      }),
      mp.on<MpPlayerRespawn>('player_respawn', (r) => {
        if (r.targetId === mp.clientId) {
          this.mySpawnIdx = r.spawnIdx;
          this.spawnPlayer(r.spawnIdx);
        } else {
          const peer = this.remotePeers.get(r.targetId);
          if (peer) {
            const sp = this.map.playerSpawns[r.spawnIdx % this.map.playerSpawns.length].clone();
            peer.hp = r.hp;
            peer.alive = true;
            peer.targetPos.copy(sp);
            peer.entity.spawn(sp, 'normal', false, false, false, this.elapsed);
            peer.entity.applyTeamAppearance(isCoop ? 'defenders' : 'attackers', isCoop);
            peer.entity.setRemotePlayerId(peer.id);
          }
        }
      }),
      mp.on<{ timeLeft: number }>('match_timer', (m) => {
        this.timeLeft = m.timeLeft;
      }),
      mp.on<{ bots: MpBotSnapshot[] }>('bots_state', (msg) => {
        if (mp.isHost() || !Array.isArray(msg.bots)) return;
        const activeIds = new Set<number>();
        for (const bs of msg.bots) {
          activeIds.add(bs.id);
          let bot = this.mirroredBots.get(bs.id);
          if (!bot) {
            bot = new BotEntity(bs.id, this.scene, this.ghostGroup, bs.isDummy);
            bot.name = bs.name;
            bot.spawn(new THREE.Vector3(bs.x, bs.y, bs.z), bs.bounty, bs.isCheaterBot, bs.isAdmin, false, this.elapsed);
            this.mirroredBots.set(bs.id, bot);
          }
          const wasAlive = bot.alive;
          bot.name = bs.name;
          bot.health = bs.hp;
          bot.maxHealth = bs.maxHp;
          bot.alive = bs.alive;
          bot.bounty = bs.bounty;
          bot.isCheaterBot = bs.isCheaterBot;
          bot.isAdmin = bs.isAdmin;
          bot.onGround = bs.onGround;
          bot.pos.set(bs.x, bs.y, bs.z);
          bot.actualVel.set(bs.vx, 0, bs.vz);
          bot.hopVelY = bs.vy;
          bot.yaw = bs.yaw;
          bot.root.visible = bs.alive;
          if (wasAlive && !bs.alive) {
            this.ragdolls.spawnFromBot(bot.getRagdollSnapshot(), this.camera.position, 'body');
            bot.clearGhosts();
          }
        }
        this.bots = Array.from(this.mirroredBots.values());
      }),
      mp.on<MpGuestBotHit>('guest_bot_hit', (h) => {
        if (!mp.isHost()) return;
        const bot = this.bots.find((b) => b.id === h.botId);
        if (!bot || !bot.alive) return;
        bot.flashTimer = 0.08;
        (bot.bodyMesh.material as THREE.MeshStandardMaterial).color.set('#ffffff');
        if (h.point) {
          this.spawnSparks(new THREE.Vector3(h.point.x, h.point.y, h.point.z), h.isHead ? '#facc15' : '#f87171', 6);
        }
        bot.health -= h.damage;
        if (bot.health > 0) {
          const atkPos = this.remotePeers.get(h.attackerId)?.entity.pos ?? this.pos;
          this.aiManager?.onBotDamaged(`bot_${bot.id}`, atkPos, this.elapsed);
          return;
        }
        const atkPos = this.remotePeers.get(h.attackerId)?.entity.pos ?? this.camera.position;
        this.ragdolls.spawnFromBot(bot.getRagdollSnapshot(), atkPos, h.isHead ? 'headshot' : 'body');
        bot.alive = false;
        bot.deaths += 1;
        bot.root.visible = false;
        bot.clearGhosts();
        bot.respawnAt = this.elapsed + (this.mode.id === 'arena' ? 1.1 : 1.9);
        mp.sendBotKill({
          killerId: h.attackerId,
          killerName: h.attackerName,
          botName: bot.name,
          weaponId: h.weaponId,
          isHead: h.isHead,
        });
      }),
      mp.on<MpBotKillEvent>('bot_kill_event', (ev) => {
        for (const [pid, sc] of Object.entries(ev.scores)) {
          if (pid === mp.clientId) {
            this.kills = sc.kills;
            this.headshots = sc.headshots;
          } else {
            const p = this.remotePeers.get(pid);
            if (p) {
              p.kills = sc.kills;
              p.headshots = sc.headshots;
            }
          }
        }
        if (ev.killerId !== mp.clientId || !mp.isHost()) {
          const wShort = getWeaponDef(ev.weaponId).shortName;
          this.pushKillFeed(
            `${ev.killerName} [${wShort}${ev.isHead ? ' 🎯' : ''}] ${ev.botName}`,
            ev.killerId === mp.clientId ? '#4ade80' : '#f8fafc',
          );
          if (ev.killerId === mp.clientId) {
            const pay = Math.round(BALANCE.creditsPerKill * this.mode.killPayMult * store.getPrestigeMultiplier());
            this.earnedCents += pay;
            this.addBreakdown('Bot Kills', pay, '#4ade80');
            this.pushPayFeed(`+${formatMoney(pay)} ${ev.botName}`, '#4ade80');
            sfx.playKill(1);
          }
        }
      }),
      mp.on<{ fromName: string; text: string; dead: boolean }>('match_chat', (m) => {
        this.chat.messages.push({
          who: m.fromName,
          text: m.text,
          dead: m.dead,
          time: performance.now(),
        });
        if (this.chat.messages.length > 7) this.chat.messages.shift();
        this.renderChat();
      }),
      mp.on<{ id: string; name: string; newHostId: string }>('peer_left', (m) => {
        const peer = this.remotePeers.get(m.id);
        if (peer) {
          peer.entity.dispose(this.scene);
          this.remotePeers.delete(m.id);
        }
        if (this.mpSession) this.mpSession.hostId = m.newHostId;
        this.chat.postSystem(`${m.name} hat das Match verlassen.`);
        this.renderChat();
      }),
      mp.on<MpMatchEndPayload>('match_end', (end) => {
        this.finishMpMatch(end);
      }),
    );
  }

  private stepRemotePeers(dt: number): void {
    const playerEye = this.camera.position;
    for (const peer of this.remotePeers.values()) {
      if (!peer.alive) continue;
      peer.entity.applyCheatVisuals(
        this.mods.headScale,
        this.mods.headBalloon,
        this.mods.headBoxColor,
        this.mods.chams,
        store.data.settings.enemyOutlines,
        store.data.settings.outlineColor,
      );
      peer.entity.updateLOD(playerEye);
      peer.entity.updateGhosts(this.elapsed, this.mods.backtrackOn, this.mods.backtrackWindow);

      const lerpF = Math.min(1, dt * 16);
      const nx = THREE.MathUtils.lerp(peer.entity.pos.x, peer.targetPos.x, lerpF);
      const ny = THREE.MathUtils.lerp(peer.entity.pos.y, peer.targetPos.y, lerpF);
      const nz = THREE.MathUtils.lerp(peer.entity.pos.z, peer.targetPos.z, lerpF);
      peer.entity.applyRemotePose(
        dt,
        nx,
        ny,
        nz,
        peer.targetVel.x,
        peer.targetVel.y,
        peer.targetVel.z,
        peer.targetYaw,
        peer.crouching,
        peer.grounded,
        peer.spinbot,
      );
    }
  }

  private renderMpScoreboard(): void {
    if (!this.mpBoardEl || !this.mpSession) return;
    const rows = [
      {
        name: `${store.data.playerName} (Du)`,
        kills: this.kills,
        deaths: this.deaths,
        hs: this.headshots,
        role: mp.isHost() ? 'HOST' : 'PLAYER',
        you: true,
      },
      ...Array.from(this.remotePeers.values()).map((p) => ({
        name: p.name,
        kills: p.kills,
        deaths: p.deaths,
        hs: p.headshots,
        role: p.id === this.mpSession?.hostId ? 'HOST' : 'PLAYER',
        you: false,
      })),
    ].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

    this.mpBoardEl.innerHTML = `
      <div class="os-win-card mp-sb-card">
        <div class="os-titlebar"><span>SCOREBOARD — ${this.mpSession.code} (${this.mpSession.rules.matchType.toUpperCase()})</span></div>
        <div class="mp-sb-body">
          <div class="mp-sb-th"><span>SPIELER</span><span>KILLS</span><span>DEATHS</span><span>HS</span><span>ROLLE</span></div>
          ${rows
            .map(
              (r) => `<div class="mp-sb-row ${r.you ? 'you' : ''}">
                <span>${r.name}</span><span>${r.kills}</span><span>${r.deaths}</span><span>${r.hs}</span><span>${r.role}</span>
              </div>`,
            )
            .join('')}
        </div>
      </div>
    `;
    this.mpBoardEl.classList.remove('hidden');
  }

  private finishMpMatch(end: MpMatchEndPayload): void {
    if (this.ended) return;
    this.ended = true;
    this.paused = true;
    this.mpChatOpen = false;
    this.firingHeld = false;
    this.mpChatWrapEl?.classList.add('hidden');
    this.mpBoardEl?.classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    this.pauseEl.classList.add('hidden');
    this.scopeEl.classList.remove('active');

    if (this.earnedCents > 0) {
      store.addCredits(Math.round(this.earnedCents), true);
    }
    sfx.playUi('cash');

    const top = end.rankings[0];
    const iWon = top && top.id === mp.clientId;
    this.endEl.innerHTML = `
      <div class="os-win-card end-card">
        <div class="os-titlebar"><span>MULTIPLAYER SCOREBOARD — ${this.mpSession?.code ?? ''}</span></div>
        <div class="end-body">
          <h2 style="color:${iWon ? '#facc15' : '#38bdf8'}">${iWon ? '🏆 DU HAST GEWONNEN!' : top ? `🏆 GEWINNER: ${top.name}` : 'MATCH BEENDET'}</h2>
          <div class="end-board">
            <div class="end-sub">LOBBY-RANGLISTE (${end.reason})</div>
            ${end.rankings
              .map(
                (r, i) => `<div class="sb-row ${r.id === mp.clientId ? 'you' : ''}">
                  <span>#${i + 1}</span><span>${r.name}</span><span>${r.kills} K</span><span>${r.deaths} D (${r.headshots} HS)</span>
                </div>`,
              )
              .join('')}
          </div>
          <div class="pay-total"><span>CREDITS VERDIENT</span><span>+${formatMoney(Math.round(this.earnedCents))}</span></div>
          <div class="end-actions">
            <button class="os-btn primary" id="btn-mp-lobby">ZURÜCK ZUR LOBBY [ESC]</button>
          </div>
        </div>
      </div>
    `;
    this.endEl.classList.remove('hidden');
    this.endEl.querySelector('#btn-mp-lobby')!.addEventListener('click', () => {
      this.dispose();
      this.onExitToHub();
    });
  }

  private finishMatch(reason: MatchResult['reason']): void {
    if (this.mpSession) {
      this.dispose();
      this.onExitToHub();
      return;
    }
    if (this.ended) return;
    this.ended = true;
    this.paused = true;
    this.firingHeld = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.pauseEl.classList.add('hidden');
    this.scopeEl.classList.remove('active');

    if (this.mode.isPractice) {
      this.dispose();
      this.onExitToHub();
      return;
    }

    // Piggy Bank payout at match end!
    const bankPay = Math.round(this.bankCents);
    if (bankPay > 0) {
      this.earnedCents += bankPay;
      this.addBreakdown('🐷 Piggy Bank', bankPay, '#f472b6');
    }

    if (reason === 'kicked') {
      const lost = Math.round(this.earnedCents * 0.2);
      if (lost > 0) {
        this.earnedCents -= lost;
        this.addBreakdown('👢 Vote-Kick Strafe (-20%)', -lost, '#f59e0b');
      }
    } else if (reason === 'banned') {
      const lost = Math.round(this.earnedCents * 0.4);
      if (lost > 0) {
        this.earnedCents -= lost;
        this.addBreakdown('🔨 VAC-Ban Beschlagnahme (-40%)', -lost, '#ff1e56');
      }
    }

    // Compute ranking
    const rankings = [
      { name: 'Du', kills: this.kills, deaths: this.deaths, you: true },
      ...this.bots.filter((b) => !b.isDummy && !b.isAdmin).map((b) => ({ name: b.name, kills: b.kills, deaths: b.deaths, you: false })),
    ].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const place = rankings.findIndex((r) => r.you) + 1;
    const won = reason !== 'banned' && reason !== 'kicked' && reason !== 'lost' && place === 1 && this.kills >= BALANCE.winBonusMinKills;

    let winBonus = 0;
    if (won) {
      winBonus = Math.round(this.earnedCents * BALANCE.winBonusShare);
      this.earnedCents += winBonus;
      this.addBreakdown('🏆 #1 Win Bonus (+50%)', winBonus, '#facc15');
    }

    const breakdown: MatchPayLine[] = Array.from(this.breakdownMap.entries()).map(([label, v]) => ({
      label,
      amount: Math.round(v.amount),
      color: v.color,
    }));

    const result: MatchResult = {
      modeId: this.mode.id,
      reason,
      duration: this.elapsed,
      kills: this.kills,
      deaths: this.deaths,
      headshots: this.headshots,
      maxStreak: this.maxStreak,
      place,
      players: rankings.length,
      won,
      creditsEarned: Math.round(this.earnedCents),
      bankPay,
      winBonus,
      roundBonus: 0,
      roundsHeld: this.roundsHeld,
      roundsLost: this.roundsLost,
      adminsKilled: this.adminsKilled,
      casesDropped: this.casesDropped,
      breakdown,
      peakHeat: Math.round(this.peakHeat),
    };

    store.completeMatch(result);
    if (reason === 'banned') sfx.playAdminAlarm();
    else sfx.playUi('cash');

    const title =
      reason === 'banned' ? '🔨 VAC-BANNED! (-40% Payout · -30% Trust)' :
      reason === 'kicked' ? '👢 VOM SERVER GEKICKT! (-20% Payout · -12% Trust)' :
      reason === 'held' ? `🛡 SITE GEHALTEN (${this.roundsHeld}-${this.roundsLost})` :
      reason === 'lost' ? `💥 SITE VERLOREN (${this.roundsHeld}-${this.roundsLost})` :
      won ? '🏆 #1 — DU HAST GEWONNEN!' : `MATCH VORBEI · PLATZ #${place}/${rankings.length}`;

    this.endEl.innerHTML = `
      <div class="os-win-card end-card">
        <div class="os-titlebar ${reason === 'banned' || reason === 'kicked' ? 'danger' : ''}"><span>SCOREBOARD — ${this.mode.name}</span></div>
        <div class="end-body">
          <h2 style="color:${reason === 'banned' ? '#ff1e56' : reason === 'kicked' ? '#f59e0b' : won ? '#facc15' : '#f8fafc'}">${title}</h2>
          <div class="end-grid">
            <div class="end-board">
              <div class="end-sub">LOBBY-RANGLISTE</div>
              ${rankings
                .slice(0, 8)
                .map(
                  (r, i) => `<div class="sb-row ${r.you ? 'you' : ''}">
                    <span>#${i + 1}</span><span>${r.name}</span><span>${r.kills} K</span><span>${r.deaths} D</span>
                  </div>`,
                )
                .join('')}
            </div>
            <div class="end-payout">
              <div class="end-sub">AUSZAHLUNG (Prestige x${store.getPrestigeMultiplier().toFixed(1)})</div>
              ${breakdown
                .map((l) => `<div class="pay-row"><span>${l.label}</span><span style="color:${l.color}">${l.amount >= 0 ? '+' : '-'}${formatMoney(Math.abs(l.amount))}</span></div>`)
                .join('')}
              <div class="pay-total"><span>GESAMT VERDIENT</span><span>+${formatMoney(result.creditsEarned)}</span></div>
              <div class="pay-balance"><span>NEUES GUTHABEN</span><span>${formatMoney(store.data.credits)}</span></div>
              ${result.casesDropped.length ? `<div class="end-drops">📦 DROPS: ${result.casesDropped.length} Case(s) im Inventar!</div>` : ''}
            </div>
          </div>
          <div class="end-actions">
            <button class="os-btn primary" id="btn-rematch">REMATCH [SPACE]</button>
            <button class="os-btn" id="btn-end-hub">ZUM DESKTOP / SHOP [ESC]</button>
          </div>
        </div>
      </div>
    `;
    this.endEl.classList.remove('hidden');
    this.endEl.querySelector('#btn-rematch')!.addEventListener('click', () => this.rematch());
    this.endEl.querySelector('#btn-end-hub')!.addEventListener('click', () => {
      this.dispose();
      this.onExitToHub();
    });
  }

  private rematch(): void {
    const modeId = this.mode.id;
    const cb = this.onExitToHub;
    const cm = this.customMap ?? undefined;
    const c = this.container;
    this.dispose();
    new MatchController(c, modeId, cb, undefined, cm);
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
    this.aiDebug?.dispose();
    for (const u of this.mpUnsubs) u();
    this.mpUnsubs = [];
    for (const p of this.remotePeers.values()) p.entity.dispose(this.scene);
    this.remotePeers.clear();
    for (const b of this.bots) b.dispose(this.scene);
    this.renderer.dispose();
  }
}
