import { AudioOutputMode, sfx } from '../audio/sfx';
import { ART_STYLES, formatMoney, formatMoneyWhole, prestigeCostCents } from '../data/balance';
import { BOT_FARM_RIGS, CHEATS } from '../data/cheats';
import { getMode, ModeId, MODES } from '../data/modes';
import { CASES, getSkin, RARITY_META, SKINS } from '../data/skins';
import { getWeaponDef, WEAPONS } from '../data/weapons';
import { BOT_DIFFICULTIES, BotDifficultyId } from '../game/ai/types';
import {
  AntiAliasingMode,
  GraphicsPresetId,
  QualityTier,
  ShadowQuality,
  TextureQuality,
} from '../game/graphicsSettings';
import { getSndMapMeta, SND_MAP_LIST, SndMapId } from '../game/sndMaps';
import { mp } from '../net/multiplayer';
import { MpMatchStartPayload } from '../net/protocol';
import { store } from '../state/store';
import { GunPreview3D, openCaseReelModal } from './caseOpener';
import { CustomMapsTabController } from './customMapsTab';
import { FriendsWindowController } from './friendsWindow';
import { renderCheatShop } from './skillTree';
import { CustomMapDocument, CustomMapLaunchConfig } from '../editor/types';

type WinId = 'fragnet' | 'friends' | 'shop' | 'loader' | 'botfarm' | 'account' | 'settings';
export type FragTab = 'play' | 'modes' | 'custom_maps' | 'armory' | 'cases' | 'crosshair';

interface WinState {
  id: WinId;
  title: string;
  icon: string;
  open: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export class DesktopHub {
  private container: HTMLElement;
  private onLaunchMatch: (modeId: ModeId, mpSession?: MpMatchStartPayload) => void;
  private onOpenEditor: (doc: CustomMapDocument, autosave?: { savedAt: string; doc: CustomMapDocument } | null) => void;
  private onPlayCustomMap: (cfg: CustomMapLaunchConfig) => void;
  private unsub: () => void;
  private mpUnsubs: (() => void)[] = [];
  private friendsCtrl = new FriendsWindowController();
  private customMapsCtrl: CustomMapsTabController;
  private timerId = 0;
  private gunPreview: GunPreview3D | null = null;
  private zTop = 20;

  private fragTab: FragTab = 'play';
  private shopTab = 'all';
  private armoryWeaponId = 'pistol';
  private armoryPreviewSkinId: string | null = null;
  private selectedCaseId = 'basic';
  private startMenuOpen = false;
  private farmLog: string[] = ['[BOTFARM] Bereit. Kaufe dein erstes Rig für passives Einkommen!'];

  private windows: Record<WinId, WinState> = {
    fragnet: { id: 'fragnet', title: 'FRAGNET.EXE — Kill to Earn', icon: '🎯', open: true, x: 92, y: 20, w: 880, h: 580, z: 15 },
    friends: { id: 'friends', title: 'FRIENDS.EXE — Friends & Lobby Code', icon: '👥', open: false, x: 118, y: 34, w: 820, h: 550, z: 16 },
    shop: { id: 'shop', title: 'WebWobble — 0DAY-HAX.NET', icon: '🌐', open: false, x: 150, y: 42, w: 860, h: 560, z: 14 },
    loader: { id: 'loader', title: 'INJECTOR.EXE — Cheat Loader', icon: '💉', open: false, x: 240, y: 74, w: 540, h: 470, z: 13 },
    botfarm: { id: 'botfarm', title: 'BOTFARM.EXE — Idle VM Cluster', icon: '🤖', open: false, x: 280, y: 90, w: 560, h: 460, z: 12 },
    account: { id: 'account', title: 'ACCOUNT.EXE — Anti-Cheat & Prestige', icon: '🛡️', open: false, x: 260, y: 80, w: 540, h: 440, z: 11 },
    settings: { id: 'settings', title: 'SETTINGS.EXE — NULL/OS 99', icon: '⚙️', open: false, x: 300, y: 48, w: 520, h: 540, z: 10 },
  };

  private keyHandler: (e: KeyboardEvent) => void;

  constructor(
    container: HTMLElement,
    onLaunchMatch: (modeId: ModeId, mpSession?: MpMatchStartPayload) => void,
    openFriendsOnStart = false,
    onOpenEditor?: (doc: CustomMapDocument, autosave?: { savedAt: string; doc: CustomMapDocument } | null) => void,
    onPlayCustomMap?: (cfg: CustomMapLaunchConfig) => void,
    initialFragTab: FragTab = 'play',
  ) {
    this.container = container;
    this.onLaunchMatch = onLaunchMatch;
    this.onOpenEditor = onOpenEditor ?? (() => {});
    this.onPlayCustomMap = onPlayCustomMap ?? (() => {});
    this.fragTab = initialFragTab;
    this.customMapsCtrl = new CustomMapsTabController({
      onOpenEditor: (doc, autosave) => this.onOpenEditor(doc, autosave),
      onPlayCustomMap: (cfg) => this.onPlayCustomMap(cfg),
    });
    this.armoryWeaponId = store.data.equippedPrimary || 'pistol';

    const eqSkin = store.data.equippedSkins[this.armoryWeaponId] ?? '';
    mp.connect(store.data.playerName, this.armoryWeaponId, eqSkin);

    if (mp.pendingJoinCode || openFriendsOnStart || mp.lobby) {
      this.windows.friends.open = true;
      this.windows.friends.z = ++this.zTop;
    }

    const tryConsumeInviteLink = () => {
      if (mp.status === 'connected' && mp.pendingJoinCode) {
        const code = mp.consumePendingJoinCode();
        if (code) mp.joinLobby(code);
      }
    };

    this.mpUnsubs.push(
      mp.on('welcome', tryConsumeInviteLink),
      mp.on('lobby_invite', () => {
        if (!this.windows.friends.open && mp.pendingInvites.length > 0) {
          this.openWindow('friends');
        }
      }),
      mp.on<MpMatchStartPayload>('match_start', (payload) => {
        this.onLaunchMatch(payload.rules.mapMode as ModeId, payload);
      }),
    );

    this.renderShell();
    this.renderAllWindows();
    tryConsumeInviteLink();
    this.unsub = store.subscribe(() => {
      const wId = store.data.equippedPrimary || 'pistol';
      mp.updateProfile(store.data.playerName, wId, store.data.equippedSkins[wId] ?? '');
      this.refreshDynamic();
    });

    this.timerId = window.setInterval(() => {
      const gained = store.tickBotFarm();
      this.updateClockAndWallet();
      if (gained > 0 && this.windows.botfarm.open && Math.random() < 0.35) {
        const rate = store.getBotFarmRatePerSec();
        this.farmLog.unshift(`[VM] +${formatMoney(rate)}/s · Bot-Farm räumt Lobby leer...`);
        if (this.farmLog.length > 8) this.farmLog.pop();
        const logEl = this.container.querySelector('#farm-log');
        if (logEl) logEl.innerHTML = this.farmLog.map((l) => `<div>${l}</div>`).join('');
      }
    }, 500);

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.code === 'F1') {
        e.preventDefault();
        store.data.devInfinite = !store.data.devInfinite;
        sfx.playUi('click');
        store.notify();
      } else if (e.code === 'F2') {
        e.preventDefault();
        store.cycleArtStyle();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  private renderShell(): void {
    this.container.innerHTML = `
      <div class="crt-shell" id="crt-shell">
        <div class="crt-bezel">
          <div class="crt-screen" id="crt-screen">
            <div class="crt-scanlines"></div>
            <div class="desktop-icons" id="desktop-icons">
              <button class="desk-icon" data-win="fragnet"><span>🎯</span><label>FRAGNET.EXE</label></button>
              <button class="desk-icon" id="desk-custom-maps"><span>🗺️</span><label>CUSTOM MAPS</label></button>
              <button class="desk-icon" data-win="friends"><span>👥</span><label>FRIENDS.EXE</label></button>
              <button class="desk-icon" data-win="shop"><span>🌐</span><label>0DAY-HAX.NET</label></button>
              <button class="desk-icon" data-win="loader"><span>💉</span><label>INJECTOR.EXE</label></button>
              <button class="desk-icon" data-win="botfarm"><span>🤖</span><label>BOTFARM.EXE</label></button>
              <button class="desk-icon" data-win="account"><span>🛡️</span><label>ACCOUNT.EXE</label></button>
              <button class="desk-icon" data-win="settings"><span>⚙️</span><label>SETTINGS.EXE</label></button>
            </div>
            <div class="desktop-windows" id="desktop-windows"></div>
            <div class="start-menu hidden" id="start-menu">
              <div class="sm-side">NULL/OS 99</div>
              <div class="sm-list">
                <button data-win="fragnet">🎯 FRAGNET.EXE (Play)</button>
                <button id="sm-custom-maps">🗺️ CUSTOM MAPS (Map Editor)</button>
                <button data-win="friends">👥 FRIENDS.EXE (Lobby &amp; Freunde)</button>
                <button data-win="shop">🌐 0DAY-HAX.NET (Cheat-Shop)</button>
                <button data-win="loader">💉 INJECTOR.EXE (Config)</button>
                <button data-win="botfarm">🤖 BOTFARM.EXE (Idle Farm)</button>
                <button data-win="account">🛡️ ACCOUNT.EXE (Prestige)</button>
                <button data-win="settings">⚙️ SETTINGS.EXE</button>
                <hr />
                <button id="sm-dev">🧪 Dev-Modus (F1)</button>
              </div>
            </div>
            <div class="os-taskbar">
              <button class="start-btn" id="btn-start">⊞ START</button>
              <div class="task-list" id="task-list"></div>
              <div class="task-tray">
                <span class="tray-rate" id="tray-rate"></span>
                <span class="tray-wallet" id="tray-wallet">$0.00</span>
                <span class="tray-clock" id="tray-clock">12:00</span>
              </div>
            </div>
          </div>
          <div class="crt-brand">PURE SKILL: OVERDRIVE // CRT-9900 <span class="crt-led"></span></div>
        </div>
      </div>
    `;

    this.container.querySelectorAll<HTMLButtonElement>('.desk-icon[data-win]').forEach((btn) => {
      btn.addEventListener('click', () => this.openWindow(btn.dataset.win as WinId));
    });
    const openCustomMapsTab = () => {
      this.startMenuOpen = false;
      this.container.querySelector('#start-menu')!.classList.add('hidden');
      this.fragTab = 'custom_maps';
      this.openWindow('fragnet');
    };
    this.container.querySelector('#desk-custom-maps')?.addEventListener('click', openCustomMapsTab);
    this.container.querySelector('#sm-custom-maps')?.addEventListener('click', openCustomMapsTab);
    this.container.querySelector('#btn-start')!.addEventListener('click', () => {
      this.startMenuOpen = !this.startMenuOpen;
      this.container.querySelector('#start-menu')!.classList.toggle('hidden', !this.startMenuOpen);
      sfx.playUi('click');
    });
    this.container.querySelectorAll<HTMLButtonElement>('#start-menu [data-win]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.startMenuOpen = false;
        this.container.querySelector('#start-menu')!.classList.add('hidden');
        this.openWindow(btn.dataset.win as WinId);
      });
    });
    this.container.querySelector('#sm-dev')!.addEventListener('click', () => {
      this.startMenuOpen = false;
      this.container.querySelector('#start-menu')!.classList.add('hidden');
      store.data.devInfinite = !store.data.devInfinite;
      store.notify();
    });

    this.applyDesktopArtStyle();
    this.updateClockAndWallet();
  }

  private applyDesktopArtStyle(): void {
    const screen = this.container.querySelector('#crt-screen') as HTMLDivElement | null;
    if (!screen) return;
    const preset = ART_STYLES.find((a) => a.id === store.data.settings.artStyle) ?? ART_STYLES[0];
    screen.style.filter = preset.id === 'clean' ? 'none' : preset.filter;
  }

  private openWindow(id: WinId): void {
    const win = this.windows[id];
    win.open = true;
    win.z = ++this.zTop;
    sfx.playUi('open');
    this.renderAllWindows();
  }

  private closeWindow(id: WinId): void {
    this.windows[id].open = false;
    sfx.playUi('click');
    this.renderAllWindows();
  }

  private focusWindow(id: WinId): void {
    this.windows[id].z = ++this.zTop;
    const el = this.container.querySelector(`.os-window[data-win="${id}"]`) as HTMLElement | null;
    if (el) el.style.zIndex = String(this.windows[id].z);
    this.container.querySelectorAll('.os-window').forEach((w) => w.classList.remove('focused'));
    el?.classList.add('focused');
  }

  private updateClockAndWallet(): void {
    const now = new Date();
    const clk = this.container.querySelector('#tray-clock');
    if (clk) clk.textContent = now.toTimeString().slice(0, 5);
    const wal = this.container.querySelector('#tray-wallet');
    if (wal) wal.textContent = store.data.devInfinite ? '$∞ (DEV)' : formatMoney(store.data.credits);
    const rateEl = this.container.querySelector('#tray-rate');
    if (rateEl) {
      const rate = store.getBotFarmRatePerSec();
      rateEl.textContent = rate > 0 ? `+${formatMoney(rate)}/s` : '';
    }
  }

  private refreshDynamic(): void {
    this.applyDesktopArtStyle();
    this.updateClockAndWallet();
    this.renderAllWindows();
  }

  private renderAllWindows(): void {
    const prevShopScroll = this.container.querySelector('#hax-trees-scroll')?.scrollTop ?? 0;

    if (this.gunPreview) {
      this.gunPreview.dispose();
      this.gunPreview = null;
    }
    this.friendsCtrl.dispose();
    this.customMapsCtrl.dispose();

    const screen = this.container.querySelector('#crt-screen') as HTMLDivElement | null;
    const maxW = Math.max(400, (screen?.clientWidth ?? 1280) - 16);
    const maxH = Math.max(320, (screen?.clientHeight ?? 760) - 48);

    const host = this.container.querySelector('#desktop-windows') as HTMLDivElement;
    const tasks = this.container.querySelector('#task-list') as HTMLDivElement;
    if (!host || !tasks) return;
    host.innerHTML = '';
    tasks.innerHTML = '';

    const highestZ = Math.max(...Object.values(this.windows).filter((w) => w.open).map((w) => w.z), 0);

    for (const win of Object.values(this.windows)) {
      if (!win.open) continue;

      const clampedW = Math.min(win.w, maxW);
      const clampedH = Math.min(win.h, maxH);
      win.x = Math.max(4, Math.min(win.x, Math.max(4, maxW - clampedW)));
      win.y = Math.max(4, Math.min(win.y, Math.max(4, maxH - clampedH)));

      // Taskbar button
      const tb = document.createElement('button');
      tb.className = `task-btn ${win.z === highestZ ? 'active' : ''}`;
      tb.textContent = `${win.icon} ${win.title.split('—')[0].trim()}`;
      tb.addEventListener('click', () => this.focusWindow(win.id));
      tasks.appendChild(tb);

      // Window frame
      const el = document.createElement('div');
      el.className = `os-window ${win.z === highestZ ? 'focused' : ''}`;
      el.dataset.win = win.id;
      el.style.left = `${win.x}px`;
      el.style.top = `${win.y}px`;
      el.style.width = `${clampedW}px`;
      el.style.height = `${clampedH}px`;
      el.style.zIndex = String(win.z);

      el.innerHTML = `
        <div class="os-titlebar" data-drag="${win.id}">
          <span>${win.icon} ${win.title}</span>
          <div class="os-win-btns">
            <button class="os-x" data-close="${win.id}">✕</button>
          </div>
        </div>
        <div class="os-win-content"></div>
      `;

      el.addEventListener('mousedown', () => this.focusWindow(win.id));
      el.querySelector(`[data-close="${win.id}"]`)!.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeWindow(win.id);
      });

      // Dragging
      const bar = el.querySelector('.os-titlebar') as HTMLDivElement;
      bar.addEventListener('mousedown', (e) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        const startX = e.clientX;
        const startY = e.clientY;
        const origX = win.x;
        const origY = win.y;
        const onMove = (me: MouseEvent) => {
          win.x = Math.max(0, origX + (me.clientX - startX));
          win.y = Math.max(0, origY + (me.clientY - startY));
          el.style.left = `${win.x}px`;
          el.style.top = `${win.y}px`;
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });

      const content = el.querySelector('.os-win-content') as HTMLDivElement;
      this.fillWindowContent(win.id, content);
      host.appendChild(el);
    }

    if (prevShopScroll > 0) {
      const nextShopScroll = this.container.querySelector('#hax-trees-scroll');
      if (nextShopScroll) nextShopScroll.scrollTop = prevShopScroll;
    }
  }

  private fillWindowContent(id: WinId, content: HTMLDivElement): void {
    switch (id) {
      case 'fragnet':
        this.renderFragnet(content);
        break;
      case 'friends':
        this.friendsCtrl.mount(content);
        break;
      case 'shop':
        renderCheatShop(
          content,
          this.shopTab,
          (t) => {
            this.shopTab = t;
            this.renderAllWindows();
          },
          () => this.openWindow('loader'),
        );
        break;
      case 'loader':
        this.renderLoader(content);
        break;
      case 'botfarm':
        this.renderBotFarm(content);
        break;
      case 'account':
        this.renderAccount(content);
        break;
      case 'settings':
        this.renderSettings(content);
        break;
    }
  }

  // 1. FRAGNET.EXE
  private renderFragnet(el: HTMLDivElement): void {
    const totalCases = Object.values(store.data.caseStock).reduce((a, b) => a + b, 0);
    el.innerHTML = `
      <div class="frag-app">
        <div class="frag-topbar">
          <div class="frag-brand">FRAGNET</div>
          <div class="frag-tabs">
            <button class="frag-tab ${this.fragTab === 'play' ? 'active' : ''}" data-ft="play">PLAY</button>
            <button class="frag-tab ${this.fragTab === 'modes' ? 'active' : ''}" data-ft="modes">MODES</button>
            <button class="frag-tab ${this.fragTab === 'custom_maps' ? 'active' : ''}" data-ft="custom_maps">CUSTOM MAPS</button>
            <button class="frag-tab ${this.fragTab === 'armory' ? 'active' : ''}" data-ft="armory">ARMORY</button>
            <button class="frag-tab ${this.fragTab === 'cases' ? 'active' : ''}" data-ft="cases">CASES ${totalCases > 0 ? `<span class="badge">${totalCases}</span>` : ''}</button>
            <button class="frag-tab ${this.fragTab === 'crosshair' ? 'active' : ''}" data-ft="crosshair">CROSSHAIR</button>
          </div>
          <div class="frag-cash">${store.data.devInfinite ? '$∞' : formatMoney(store.data.credits)}</div>
        </div>
        <div class="frag-body" id="frag-body"></div>
      </div>
    `;
    el.querySelectorAll<HTMLButtonElement>('.frag-tab').forEach((b) => {
      b.addEventListener('click', () => {
        this.fragTab = b.dataset.ft as FragTab;
        sfx.playUi('click');
        this.renderAllWindows();
      });
    });

    const body = el.querySelector('#frag-body') as HTMLDivElement;
    if (this.fragTab === 'play') this.renderFragPlay(body);
    else if (this.fragTab === 'modes') this.renderFragModes(body);
    else if (this.fragTab === 'custom_maps') this.customMapsCtrl.mount(body);
    else if (this.fragTab === 'armory') this.renderFragArmory(body);
    else if (this.fragTab === 'cases') this.renderFragCases(body);
    else this.renderFragCrosshair(body);
  }

  private renderFragPlay(body: HTMLDivElement): void {
    const mode = getMode(store.data.selectedMode);
    const primary = getWeaponDef(store.data.equippedPrimary);
    const activeCheats = CHEATS.filter((c) => store.isCheatEnabled(c.id));
    const lm = store.data.lastMatch;
    const sc = store.data.sndConfig;
    const isSnd = mode.id === 'snd';
    const selMap = getSndMapMeta(sc.mapId);

    body.innerHTML = `
      <div class="play-grid">
        <div class="play-main">
          <div class="mode-hero" style="border-color:${mode.accent}">
            <div class="mh-map">${isSnd ? `${selMap.name.toUpperCase()} (${selMap.sizeLabel})` : mode.mapName}</div>
            <div class="mh-title" style="color:${mode.accent}">${mode.name}</div>
            <div class="mh-tag">${isSnd ? selMap.tagline : mode.tagline}</div>
            <div class="mh-stats">
              <span>Pay: <strong>x${mode.killPayMult.toFixed(1)}</strong></span>
              <span>Dauer: <strong>${isSnd ? `${sc.roundDuration}s/R` : `${mode.duration}s`}</strong></span>
              <span>Teams: <strong>${isSnd ? `${sc.teamSize}v${sc.teamSize}` : `${mode.botCount} Bots`}</strong></span>
              <span>Prestige: <strong>x${store.getPrestigeMultiplier().toFixed(1)}</strong></span>
            </div>
          </div>

          ${
            isSnd
              ? `<div class="snd-lobby-box">
                  <div class="snd-map-picker">
                    ${SND_MAP_LIST.map((m) => `
                      <button class="snd-map-card ${m.id === sc.mapId ? 'active' : ''}" data-snd-map="${m.id}" style="border-color:${m.id === sc.mapId ? m.accent : '#334155'}">
                        <strong style="color:${m.accent}">${m.name}</strong>
                        <small>${m.sizeLabel} · ${m.theme.toUpperCase()}</small>
                      </button>
                    `).join('')}
                  </div>
                  <div class="snd-rules-row">
                    <label>Halbzeit:
                      <select id="snd-mr">
                        <option value="4" ${sc.roundsPerHalf === 4 ? 'selected' : ''}>MR4 (First to 5)</option>
                        <option value="6" ${sc.roundsPerHalf === 6 ? 'selected' : ''}>MR6 (First to 7)</option>
                        <option value="12" ${sc.roundsPerHalf === 12 ? 'selected' : ''}>MR12 Comp (First to 13)</option>
                      </select>
                    </label>
                    <label>Teams:
                      <select id="snd-size">
                        <option value="3" ${sc.teamSize === 3 ? 'selected' : ''}>3v3</option>
                        <option value="4" ${sc.teamSize === 4 ? 'selected' : ''}>4v4</option>
                        <option value="5" ${sc.teamSize === 5 ? 'selected' : ''}>5v5</option>
                      </select>
                    </label>
                    <label>Startseite:
                      <select id="snd-side">
                        <option value="attackers" ${sc.startingSide === 'attackers' ? 'selected' : ''}>Attackers (T)</option>
                        <option value="defenders" ${sc.startingSide === 'defenders' ? 'selected' : ''}>Defenders (CT)</option>
                        <option value="random" ${sc.startingSide === 'random' ? 'selected' : ''}>Zufall</option>
                      </select>
                    </label>
                    <button class="os-btn small ${sc.overtimeEnabled ? 'primary' : ''}" id="snd-ot">OT: ${sc.overtimeEnabled ? 'AN' : 'AUS'}</button>
                    <button class="os-btn small ${sc.friendlyFire ? 'primary' : ''}" id="snd-ff">FF: ${sc.friendlyFire ? 'AN' : 'AUS'}</button>
                  </div>
                </div>`
              : `<div class="play-loadout">
                  <div>Primärwaffe: <strong>${primary.name}</strong> (x${primary.killPay.toFixed(2)} Pay)</div>
                  <div>Aktive Cheats (${activeCheats.length}):
                    ${activeCheats.length ? activeCheats.map((c) => `<span class="mini-pill" style="border-color:${c.color};color:${c.color}">${c.name}</span>`).join('') : '<span class="dim">Keine — Clean Player</span>'}
                  </div>
                </div>`
          }

          <div class="snd-rules-row" style="margin:2px 0">
            <label>🤖 Bot-KI Schwierigkeit:
              <select id="play-bot-diff">
                ${(Object.keys(BOT_DIFFICULTIES) as BotDifficultyId[])
                  .map((id) => `<option value="${id}" ${store.data.settings.botDifficulty === id ? 'selected' : ''}>${BOT_DIFFICULTIES[id].label}</option>`)
                  .join('')}
              </select>
            </label>
            <button class="os-btn small ${store.data.settings.aiDebugOverlay ? 'primary' : ''}" id="play-ai-debug">AI-Debug (F3): ${store.data.settings.aiDebugOverlay ? 'AN' : 'AUS'}</button>
          </div>

          <div class="play-cta-row">
            <button class="os-btn ready-btn" id="btn-ready">▶ ${isSnd ? `SND STARTEN (${selMap.name.toUpperCase()})` : 'READY — MATCH STARTEN'}</button>
            <button class="os-btn primary" id="btn-go-friends">👥 MIT FREUNDEN</button>
            ${!isSnd ? `<button class="os-btn" id="btn-quick-snd">💣 S&amp;D (5v5)</button>` : ''}
            <button class="os-btn" id="btn-range">🎯 RANGE</button>
          </div>
          <div class="play-shortcuts">
            <button class="os-btn small" id="btn-go-shop">🌐 0DAY-HAX.NET (Cheats kaufen)</button>
            <button class="os-btn small" id="btn-go-loader">💉 INJECTOR.EXE</button>
            <button class="os-btn small" id="btn-go-farm">🤖 BOTFARM.EXE</button>
          </div>
        </div>

        <div class="play-side">
          <div class="side-card">
            <div class="side-title">LETZTES MATCH</div>
            ${
              lm
                ? `<div class="lm-row"><span>Modus</span><strong>${getMode(lm.modeId).name}</strong></div>
                   <div class="lm-row"><span>Ergebnis</span><strong>${lm.won ? '🏆 #1 Sieg' : lm.reason === 'banned' ? '🔨 BANNED' : lm.reason === 'kicked' ? '👢 KICKED' : lm.reason === 'snd_loss' ? '💀 Niederlage' : `Platz #${lm.place}/${lm.players}`}</strong></div>
                   <div class="lm-row"><span>K / D / HS</span><strong>${lm.kills} / ${lm.deaths} / ${lm.headshots}</strong></div>
                   <div class="lm-row"><span>Verdient</span><strong style="color:#4ade80">+${formatMoney(lm.creditsEarned)}</strong></div>
                   <div class="lm-row"><span>Peak Heat</span><strong>${lm.peakHeat}%</strong></div>`
                : `<p class="dim">Noch kein Match gespielt.<br>Teste <b>Search & Destroy</b> auf District 9, Cold Front & Neon Market oder spiele 1v1 Arena!</p>`
            }
          </div>
          <div class="side-card">
            <div class="side-title">ACCOUNT-STATS</div>
            <div class="lm-row"><span>Matches</span><strong>${store.data.matchesPlayed}</strong></div>
            <div class="lm-row"><span>Total Kills</span><strong>${store.data.totalKills}</strong></div>
            <div class="lm-row"><span>Trust Factor</span><strong style="color:${store.data.trustFactor > 50 ? '#4ade80' : '#f87171'}">${store.data.trustFactor}%</strong></div>
            <div class="lm-row"><span>Prestige</span><strong style="color:#facc15">Lv. ${store.data.prestigeLevel} (x${store.getPrestigeMultiplier().toFixed(1)})</strong></div>
          </div>
        </div>
      </div>
    `;

    body.querySelectorAll<HTMLButtonElement>('[data-snd-map]').forEach((b) => {
      b.addEventListener('click', () => {
        store.data.sndConfig.mapId = b.dataset.sndMap as SndMapId;
        sfx.playUi('click');
        store.notify();
      });
    });
    body.querySelector('#snd-mr')?.addEventListener('change', (e) => {
      store.data.sndConfig.roundsPerHalf = Number((e.target as HTMLSelectElement).value);
      store.notify();
    });
    body.querySelector('#snd-size')?.addEventListener('change', (e) => {
      store.data.sndConfig.teamSize = Number((e.target as HTMLSelectElement).value);
      store.notify();
    });
    body.querySelector('#snd-side')?.addEventListener('change', (e) => {
      store.data.sndConfig.startingSide = (e.target as HTMLSelectElement).value as typeof sc.startingSide;
      store.notify();
    });
    body.querySelector('#snd-ot')?.addEventListener('click', () => {
      store.data.sndConfig.overtimeEnabled = !store.data.sndConfig.overtimeEnabled;
      sfx.playUi('click');
      store.notify();
    });
    body.querySelector('#snd-ff')?.addEventListener('click', () => {
      store.data.sndConfig.friendlyFire = !store.data.sndConfig.friendlyFire;
      sfx.playUi('click');
      store.notify();
    });

    body.querySelector('#play-bot-diff')?.addEventListener('change', (e) => {
      store.data.settings.botDifficulty = (e.target as HTMLSelectElement).value as BotDifficultyId;
      sfx.playUi('click');
      store.notify();
    });
    body.querySelector('#play-ai-debug')?.addEventListener('click', () => {
      store.data.settings.aiDebugOverlay = !store.data.settings.aiDebugOverlay;
      sfx.playUi('click');
      store.notify();
    });

    body.querySelector('#btn-ready')!.addEventListener('click', () => {
      sfx.playUi('click');
      this.onLaunchMatch(store.data.selectedMode);
    });
    body.querySelector('#btn-go-friends')?.addEventListener('click', () => this.openWindow('friends'));
    body.querySelector('#btn-quick-snd')?.addEventListener('click', () => {
      store.selectMode('snd');
    });
    body.querySelector('#btn-range')!.addEventListener('click', () => {
      sfx.playUi('click');
      this.onLaunchMatch('range');
    });
    body.querySelector('#btn-go-shop')!.addEventListener('click', () => this.openWindow('shop'));
    body.querySelector('#btn-go-loader')!.addEventListener('click', () => this.openWindow('loader'));
    body.querySelector('#btn-go-farm')!.addEventListener('click', () => this.openWindow('botfarm'));
  }

  private renderFragModes(body: HTMLDivElement): void {
    body.innerHTML = `<div class="modes-grid">
      ${MODES.filter((m) => !m.isPractice)
        .map((m) => {
          const unlocked = store.data.unlockedModes.includes(m.id);
          const selected = store.data.selectedMode === m.id;
          return `<div class="mode-card ${selected ? 'selected' : ''}" style="border-color:${selected ? m.accent : '#334155'}">
            <div class="mc-top">
              <span class="mc-map">${m.mapName}</span>
              <span class="mc-pay" style="color:${m.accent}">x${m.killPayMult.toFixed(1)} PAY</span>
            </div>
            <div class="mc-name" style="color:${m.accent}">${m.name}</div>
            <div class="mc-desc">${m.description}</div>
            <div class="mc-meta">${m.botCount} Bots · ${m.duration}s${m.rounds ? ` × ${m.rounds} Runden` : ''}</div>
            ${
              unlocked
                ? `<button class="os-btn ${selected ? 'primary' : ''}" data-pick-mode="${m.id}">${selected ? '✓ AUSGEWÄHLT' : 'AUSWÄHLEN'}</button>`
                : `<button class="os-btn ${store.canAfford(m.cost) ? 'primary' : ''}" data-buy-mode="${m.id}">FREISCHALTEN · ${formatMoneyWhole(m.cost)}</button>`
            }
          </div>`;
        })
        .join('')}
    </div>`;

    body.querySelectorAll<HTMLButtonElement>('[data-pick-mode]').forEach((b) => {
      b.addEventListener('click', () => store.selectMode(b.dataset.pickMode as ModeId));
    });
    body.querySelectorAll<HTMLButtonElement>('[data-buy-mode]').forEach((b) => {
      b.addEventListener('click', () => store.buyMode(b.dataset.buyMode as ModeId));
    });
  }

  private renderFragArmory(body: HTMLDivElement): void {
    const def = getWeaponDef(this.armoryWeaponId);
    const owned = store.data.ownedWeapons.includes(def.id);
    const equipped = store.data.equippedPrimary === def.id || def.isSidearm || def.isMelee;
    const skins = SKINS.filter((s) => s.weaponId === def.id || s.weaponId === 'universal');
    const equippedSkinId = store.data.equippedSkins[def.id];
    const activePreviewId = this.armoryPreviewSkinId ?? equippedSkinId;
    const previewSkin = getSkin(activePreviewId);

    body.innerHTML = `
      <div class="armory-grid">
        <div class="armory-list">
          ${WEAPONS.map((w) => {
            const ow = store.data.ownedWeapons.includes(w.id);
            const eq = store.data.equippedPrimary === w.id;
            return `<button class="arm-item ${w.id === def.id ? 'active' : ''}" data-wid="${w.id}">
              <div><strong>${w.name}</strong><small>${ow ? (eq ? 'AUSGERÜSTET' : 'Im Besitz') : formatMoneyWhole(w.cost)}</small></div>
              <span class="arm-pay">x${w.killPay.toFixed(2)}</span>
            </button>`;
          }).join('')}
        </div>
        <div class="armory-detail">
          <div class="arm-preview-wrap">
            <div id="arm-3d" class="arm-3d"></div>
            <div class="arm-drag-hint">Ziehen zum Drehen</div>
          </div>
          <div class="arm-head">
            <div>
              <h3>${def.name}</h3>
              <div class="dim">${def.role} · Kill-Pay <strong style="color:#4ade80">x${def.killPay.toFixed(2)}</strong></div>
            </div>
            <div>
              ${
                owned
                  ? equipped
                    ? `<span class="arm-tag">✓ AKTIV IM LOADOUT</span>`
                    : `<button class="os-btn primary" id="arm-equip">AUSRÜSTEN</button>`
                  : `<button class="os-btn primary" id="arm-buy">KAUFEN · ${formatMoneyWhole(def.cost)}</button>`
              }
            </div>
          </div>
          <div class="arm-stats">
            <div><span>Schaden</span><strong>${def.damage} (HS x${def.headshotMultiplier})</strong></div>
            <div><span>Feuerrate</span><strong>${Math.round(60 / def.fireInterval)} RPM ${def.fullAuto ? '(Auto)' : '(Semi)'}</strong></div>
            <div><span>Magazin</span><strong>${def.isMelee ? '—' : `${def.magazineSize} · ${def.reloadTime}s`}</strong></div>
            <div><span>Tempo</span><strong>${Math.round(def.moveSpeed * 100)}%</strong></div>
          </div>
          <div class="arm-skins">
            <div class="arm-skins-head">
              <div class="arm-skins-title">CAMOS (aus Cases · Klick für 3D-Vorschau):</div>
              ${equippedSkinId ? `<button class="os-btn small" id="arm-skin-all">Auf alle Waffen</button>` : ''}
            </div>
            <div class="skin-row">
              <button class="skin-chip ${!activePreviewId ? 'active' : ''}" data-skin="">Original</button>
              ${skins
                .map((s) => {
                  const has = store.data.ownedSkins.includes(s.id);
                  const rm = RARITY_META[s.rarity];
                  const isEq = equippedSkinId === s.id && !this.armoryPreviewSkinId;
                  const isPrev = this.armoryPreviewSkinId === s.id;
                  return `<button class="skin-chip ${isEq ? 'active' : ''} ${isPrev ? 'previewing' : ''} ${!has ? 'locked' : ''} ${s.animated ? 'is-anim' : ''}" data-skin="${s.id}" style="border-color:${rm.color}" title="${s.subtitle} (${rm.name})">
                    <span class="swatch-mini" style="background:${s.swatchCss}"></span>
                    <span>${s.name}</span>
                    ${s.animated ? `<span class="skin-anim-tag">✦</span>` : ''}
                  </button>`;
                })
                .join('')}
            </div>
            <div class="skin-preview-note" id="arm-preview-note">
              ${
                this.armoryPreviewSkinId && previewSkin
                  ? `🔒 3D-Vorschau: <strong>${previewSkin.name}</strong> (${previewSkin.subtitle}) — Öffne Cases zum Freischalten!`
                  : ''
              }
            </div>
          </div>
        </div>
      </div>
    `;

    const host3d = body.querySelector('#arm-3d') as HTMLDivElement;
    this.gunPreview = new GunPreview3D(host3d, 380, 175);
    this.gunPreview.show(def, previewSkin);

    body.querySelectorAll<HTMLButtonElement>('[data-wid]').forEach((b) => {
      b.addEventListener('click', () => {
        this.armoryWeaponId = b.dataset.wid!;
        this.armoryPreviewSkinId = null;
        sfx.playUi('click');
        this.renderAllWindows();
      });
    });
    body.querySelector('#arm-buy')?.addEventListener('click', () => store.buyWeapon(def.id));
    body.querySelector('#arm-equip')?.addEventListener('click', () => store.equipWeapon(def.id));
    body.querySelector('#arm-skin-all')?.addEventListener('click', () => {
      if (equippedSkinId) store.equipSkinAllWeapons(equippedSkinId);
    });
    body.querySelectorAll<HTMLButtonElement>('[data-skin]').forEach((b) => {
      b.addEventListener('click', () => {
        const sid = b.dataset.skin || null;
        if (!sid) {
          this.armoryPreviewSkinId = null;
          store.equipSkin(def.id, null);
          return;
        }
        if (store.data.ownedSkins.includes(sid)) {
          this.armoryPreviewSkinId = null;
          store.equipSkin(def.id, sid);
        } else {
          this.armoryPreviewSkinId = sid;
          const prevSkin = getSkin(sid);
          if (this.gunPreview && prevSkin) {
            this.gunPreview.show(def, prevSkin);
          }
          sfx.playUi('click');
          body.querySelectorAll<HTMLButtonElement>('[data-skin]').forEach((c) => {
            c.classList.toggle('previewing', c.dataset.skin === sid);
            c.classList.remove('active');
          });
          const noteEl = body.querySelector('#arm-preview-note');
          if (noteEl && prevSkin) {
            noteEl.innerHTML = `🔒 3D-Vorschau: <strong>${prevSkin.name}</strong> (${prevSkin.subtitle}) — Öffne Cases zum Freischalten!`;
          }
        }
      });
    });
  }

  private renderFragCases(body: HTMLDivElement): void {
    const cdef = CASES.find((c) => c.id === this.selectedCaseId) ?? CASES[0];
    const stock = store.data.caseStock[cdef.id] || 0;
    body.innerHTML = `
      <div class="cases-layout">
        <div class="cases-rack">
          ${CASES.map((c) => {
            const st = store.data.caseStock[c.id] || 0;
            return `<button class="case-tab ${c.id === cdef.id ? 'active' : ''}" data-cid="${c.id}" style="border-left:5px solid ${c.trimColor}">
              <div><strong>${c.name}</strong><small>${c.subtitle}</small></div>
              <span class="case-stock">${st}x</span>
            </button>`;
          }).join('')}
          <div class="cases-meta">
            <div>Geöffnet: <strong>${store.data.casesOpened}</strong></div>
            <div>Sammlung: <strong>${store.data.ownedSkins.length}/${SKINS.length}</strong></div>
            <div>Legendary-Pity: <strong>${store.data.casesSinceLegendary}/20</strong></div>
          </div>
        </div>
        <div class="case-stage-card">
          <div class="case-box-art" style="background:${cdef.bodyColor};border-color:${cdef.trimColor}">
            <span>📦</span>
            <strong>${cdef.name}</strong>
            <small>${stock} IM INVENTAR</small>
          </div>
          <div class="case-odds">
            <span style="color:#94a3b8">C ${cdef.odds[0]}%</span>
            <span style="color:#38bdf8">U ${cdef.odds[1]}%</span>
            <span style="color:#818cf8">R ${cdef.odds[2]}%</span>
            <span style="color:#e879f9">E ${cdef.odds[3]}%</span>
            <span style="color:#facc15">L ${cdef.odds[4]}%</span>
          </div>
          <div class="case-btns">
            <button class="os-btn primary" id="btn-case-open" ${stock <= 0 ? 'disabled' : ''}>ÖFFNEN (${stock})</button>
            <button class="os-btn" id="btn-case-buy">KAUFEN · ${formatMoneyWhole(cdef.buyPrice)}</button>
            <button class="os-btn" id="btn-case-sell" ${stock <= 0 ? 'disabled' : ''}>VERKAUFEN · ${formatMoneyWhole(cdef.sellPrice)}</button>
          </div>
          <div class="recent-drops">
            <div class="dim">Letzte Drops:</div>
            <div class="rd-list">
              ${
                store.data.recentDrops.length
                  ? store.data.recentDrops
                      .slice(0, 8)
                      .map((sid) => {
                        const s = getSkin(sid);
                        if (!s) return '';
                        return `<span class="rd-chip" style="border-color:${RARITY_META[s.rarity].color};color:${RARITY_META[s.rarity].color}">${s.name}</span>`;
                      })
                      .join('')
                  : '<span class="dim">Noch keine Drops</span>'
              }
            </div>
          </div>
        </div>
      </div>
    `;

    body.querySelectorAll<HTMLButtonElement>('[data-cid]').forEach((b) => {
      b.addEventListener('click', () => {
        this.selectedCaseId = b.dataset.cid!;
        sfx.playUi('click');
        this.renderAllWindows();
      });
    });
    body.querySelector('#btn-case-buy')!.addEventListener('click', () => store.buyCase(cdef.id));
    body.querySelector('#btn-case-sell')!.addEventListener('click', () => store.sellCase(cdef.id));
    body.querySelector('#btn-case-open')!.addEventListener('click', () => {
      const drop = store.openCase(cdef.id);
      if (drop) openCaseReelModal(this.container, cdef.id, drop, () => this.renderAllWindows());
    });
  }

  private renderFragCrosshair(body: HTMLDivElement): void {
    const xh = store.data.settings.crosshair;
    const colors = ['#4ade80', '#facc15', '#22d3ee', '#ffffff', '#f472b6', '#ef4444'];
    body.innerHTML = `
      <div class="xh-layout">
        <div class="xh-preview">
          <div class="xh-line h" style="width:${xh.length}px;height:${xh.thickness}px;background:${xh.color};transform:translateX(${-xh.gap - xh.length / 2}px)"></div>
          <div class="xh-line h" style="width:${xh.length}px;height:${xh.thickness}px;background:${xh.color};transform:translateX(${xh.gap + xh.length / 2}px)"></div>
          <div class="xh-line v" style="width:${xh.thickness}px;height:${xh.length}px;background:${xh.color};transform:translateY(${-xh.gap - xh.length / 2}px)"></div>
          <div class="xh-line v" style="width:${xh.thickness}px;height:${xh.length}px;background:${xh.color};transform:translateY(${xh.gap + xh.length / 2}px)"></div>
          ${xh.dot ? `<div class="xh-line" style="width:${xh.thickness}px;height:${xh.thickness}px;background:${xh.color}"></div>` : ''}
        </div>
        <div class="xh-controls">
          <div class="set-row"><span>Farbe</span><div class="swatches">${colors.map((c) => `<button class="swatch ${xh.color === c ? 'active' : ''}" style="background:${c}" data-xhc="${c}"></button>`).join('')}</div></div>
          <div class="set-row"><span>Länge (${xh.length})</span><input type="range" min="2" max="18" value="${xh.length}" id="xh-len" /></div>
          <div class="set-row"><span>Dicke (${xh.thickness})</span><input type="range" min="1" max="5" value="${xh.thickness}" id="xh-th" /></div>
          <div class="set-row"><span>Lücke (${xh.gap})</span><input type="range" min="0" max="14" value="${xh.gap}" id="xh-gap" /></div>
          <div class="set-row"><span>Center Dot</span><button class="os-btn small" id="xh-dot">${xh.dot ? 'AN' : 'AUS'}</button></div>
          <div class="set-row"><span>Outline</span><button class="os-btn small" id="xh-out">${xh.outline ? 'AN' : 'AUS'}</button></div>
          <div class="set-row"><span>Dynamisch</span><button class="os-btn small" id="xh-dyn">${xh.dynamic ? 'AN' : 'AUS'}</button></div>
        </div>
      </div>
    `;
    body.querySelectorAll<HTMLButtonElement>('[data-xhc]').forEach((b) => {
      b.addEventListener('click', () => {
        store.data.settings.crosshair.color = b.dataset.xhc!;
        store.notify();
      });
    });
    body.querySelector('#xh-len')!.addEventListener('input', (e) => {
      store.data.settings.crosshair.length = Number((e.target as HTMLInputElement).value);
      store.notify();
    });
    body.querySelector('#xh-th')!.addEventListener('input', (e) => {
      store.data.settings.crosshair.thickness = Number((e.target as HTMLInputElement).value);
      store.notify();
    });
    body.querySelector('#xh-gap')!.addEventListener('input', (e) => {
      store.data.settings.crosshair.gap = Number((e.target as HTMLInputElement).value);
      store.notify();
    });
    body.querySelector('#xh-dot')!.addEventListener('click', () => {
      store.data.settings.crosshair.dot = !store.data.settings.crosshair.dot;
      store.notify();
    });
    body.querySelector('#xh-out')!.addEventListener('click', () => {
      store.data.settings.crosshair.outline = !store.data.settings.crosshair.outline;
      store.notify();
    });
    body.querySelector('#xh-dyn')!.addEventListener('click', () => {
      store.data.settings.crosshair.dynamic = !store.data.settings.crosshair.dynamic;
      store.notify();
    });
  }

  // 2. INJECTOR.EXE
  private renderLoader(el: HTMLDivElement): void {
    const ownedCheats = CHEATS.filter((c) => store.ownsCheat(c.id));
    el.innerHTML = `
      <div class="loader-app">
        <div class="loader-presets">
          <span>PRESET:</span>
          <button class="os-btn small" data-pre="off">OFF (Clean)</button>
          <button class="os-btn small" data-pre="legit">LEGIT (Low Heat)</button>
          <button class="os-btn small primary" data-pre="rage">RAGE (All On)</button>
        </div>
        <div class="loader-list">
          ${
            ownedCheats.length === 0
              ? `<div class="empty-msg">Keine Cheats installiert.<br><button class="os-btn primary" id="ldr-go-shop">Auf 0DAY-HAX.NET kaufen &gt;&gt;</button></div>`
              : ownedCheats
                  .map((c) => {
                    const st = store.data.cheats[c.id];
                    const tunesHtml = c.tunes
                      .map((t) => {
                        const val = st.tunes[t.id] ?? t.defaultValue;
                        if (t.kind === 'swatch') {
                          return `<div class="tune-row"><span>${t.label}</span><div class="swatches">${t.swatches!
                            .map((sw) => `<button class="swatch ${val === sw ? 'active' : ''}" style="background:${sw}" data-tune="${c.id}:${t.id}:${sw}"></button>`)
                            .join('')}</div></div>`;
                        }
                        if (t.kind === 'choice') {
                          return `<div class="tune-row"><span>${t.label}</span><div>${t.choices!
                            .map((ch) => `<button class="os-btn small ${val === ch.value ? 'primary' : ''}" data-tune="${c.id}:${t.id}:${ch.value}">${ch.label}</button>`)
                            .join('')}</div></div>`;
                        }
                        return `<div class="tune-row"><span>${t.label}</span><button class="os-btn small ${val === '1' ? 'primary' : ''}" data-tune="${c.id}:${t.id}:${val === '1' ? '0' : '1'}">${val === '1' ? 'AN' : 'AUS'}</button></div>`;
                      })
                      .join('');
                    return `<div class="loader-item" style="border-left:4px solid ${c.color}">
                      <div class="li-top">
                        <div><strong style="color:${c.color}">${c.name}</strong> <small>${c.file} · ${st.boughtNodes.length}/${c.nodes.length} Nodes</small></div>
                        <button class="os-btn small ${st.enabled ? 'primary' : ''}" data-toggle="${c.id}">${st.enabled ? 'INJECTED' : 'OFF'}</button>
                      </div>
                      ${tunesHtml}
                    </div>`;
                  })
                  .join('')
          }
        </div>
      </div>
    `;

    el.querySelector('#ldr-go-shop')?.addEventListener('click', () => this.openWindow('shop'));
    el.querySelectorAll<HTMLButtonElement>('[data-pre]').forEach((b) => {
      b.addEventListener('click', () => store.applyLoaderPreset(b.dataset.pre as 'off' | 'legit' | 'rage'));
    });
    el.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((b) => {
      b.addEventListener('click', () => {
        const cid = b.dataset.toggle as typeof CHEATS[number]['id'];
        store.setCheatEnabled(cid, !store.data.cheats[cid].enabled);
      });
    });
    el.querySelectorAll<HTMLButtonElement>('[data-tune]').forEach((b) => {
      b.addEventListener('click', () => {
        const [cid, tid, val] = b.dataset.tune!.split(':');
        store.setCheatTune(cid as typeof CHEATS[number]['id'], tid, val);
      });
    });
  }

  // 3. BOTFARM.EXE (Idle Farm Window!)
  private renderBotFarm(el: HTMLDivElement): void {
    const rate = store.getBotFarmRatePerSec();
    el.innerHTML = `
      <div class="farm-app">
        <div class="farm-header">
          <div>
            <div class="dim">PASSIVES EINKOMMEN (läuft auch während Matches & Offline!)</div>
            <div class="farm-rate">${formatMoney(rate)} / Sekunde</div>
          </div>
          <div class="farm-total">Gesamt gefarmt:<br><strong>${formatMoney(store.data.botFarmEarned)}</strong></div>
        </div>
        <div class="farm-terminal" id="farm-log">
          ${this.farmLog.map((l) => `<div>${l}</div>`).join('')}
        </div>
        <div class="farm-rigs">
          ${BOT_FARM_RIGS.map((r) => {
            const count = store.data.botFarmRigs[r.id] || 0;
            const cost = store.getRigCost(r.id);
            const income = r.centsPerSec * store.getPrestigeMultiplier();
            return `<div class="rig-row">
              <div class="rig-info">
                <strong>${r.icon} ${r.name} <span class="rig-cnt">x${count}</span></strong>
                <small>${r.desc} · +${formatMoney(income)}/s</small>
              </div>
              <button class="os-btn small ${store.canAfford(cost) ? 'primary' : ''}" data-rig="${r.id}">KAUFEN · ${formatMoneyWhole(cost)}</button>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
    el.querySelectorAll<HTMLButtonElement>('[data-rig]').forEach((b) => {
      b.addEventListener('click', () => {
        if (store.buyBotFarmRig(b.dataset.rig!)) {
          this.farmLog.unshift(`[BOTFARM] Neues Rig gestartet: ${b.dataset.rig!.toUpperCase()}!`);
        }
      });
    });
  }

  // 4. ACCOUNT.EXE (Anti-Cheat Status + Prestige!)
  private renderAccount(el: HTMLDivElement): void {
    const req = prestigeCostCents(store.data.prestigeLevel);
    const prog = Math.min(100, Math.round((store.data.runEarned / req) * 100));
    const canP = store.canPrestige();

    el.innerHTML = `
      <div class="acct-app">
        <div class="acct-card">
          <h3>ACCOUNT STATUS</h3>
          <div class="lm-row"><span>Trust Factor</span><strong style="color:${store.data.trustFactor > 50 ? '#4ade80' : '#ff1e56'}">${store.data.trustFactor}%</strong></div>
          <div class="lm-row"><span>Admin-Bans erhalten</span><strong>${store.data.totalBans}</strong></div>
          <div class="lm-row"><span>Aktuelles Prestige-Level</span><strong style="color:#facc15">Level ${store.data.prestigeLevel} (x${store.getPrestigeMultiplier().toFixed(1)} Cash)</strong></div>
          <div class="lm-row"><span>Lifetime Verdient</span><strong>${formatMoney(store.data.lifetimeEarned)}</strong></div>
        </div>
        <div class="acct-card prestige-card">
          <h3>🪪 NEUEN CLEAN-ACCOUNT KAUFEN (PRESTIGE)</h3>
          <p class="dim">Zu viel Heat? Kauf dir einen brandneuen Clean-Account! Setzt Guthaben, Waffen, Cheats & Bot-Farm zurück, aber du behältst <b>alle Skins</b> und erhältst dauerhaft:</p>
          <ul class="prestige-perks">
            <li><strong style="color:#4ade80">+50% dauerhafter Cash-Multiplikator</strong> (neu: x${(store.getPrestigeMultiplier() + 0.5).toFixed(1)})</li>
            <li><strong style="color:#38bdf8">+15% höheres Epic/Legendary Case-Glück</strong></li>
            <li><strong style="color:#facc15">Trust Factor zurück auf 100% + Gratis Neon/Overdrive Cases!</strong></li>
          </ul>
          <div class="prestige-bar-wrap">
            <div class="prestige-bar-label"><span>Run-Verdienst benötigt:</span><span>${formatMoney(store.data.runEarned)} / ${formatMoney(req)} (${prog}%)</span></div>
            <div class="hud-heat-track"><div class="hud-heat-fill" style="width:${prog}%;background:#facc15"></div></div>
          </div>
          <button class="os-btn ${canP ? 'primary' : ''}" id="btn-prestige" ${canP ? '' : 'disabled'}>
            ${canP ? '✨ PRESTIGE JETZT AUSLÖSEN!' : `NOCH ${formatMoney(Math.max(0, req - store.data.runEarned))} VERDIENEN`}
          </button>
        </div>
      </div>
    `;
    el.querySelector('#btn-prestige')!.addEventListener('click', () => {
      if (store.canPrestige() && window.confirm('Wirklich neuen Clean-Account (Prestige) starten? Alle Skins bleiben erhalten!')) {
        store.doPrestige();
      }
    });
  }

  // 5. SETTINGS.EXE
  private renderSettings(el: HTMLDivElement): void {
    const s = store.data.settings;
    el.innerHTML = `
      <div class="set-app">
        <div class="set-sec">
          <h4>STEUERUNG & GRAFIK</h4>
          <div class="set-row"><span>Maus-Sensitivität (${(s.sensitivity * 1000).toFixed(1)})</span><input type="range" min="0.5" max="6" step="0.1" value="${(s.sensitivity * 1000).toFixed(1)}" id="set-sens" /></div>
          <div class="set-row"><span>Sichtfeld FOV (${s.fov}°)</span><input type="range" min="65" max="110" step="1" value="${s.fov}" id="set-fov" /></div>
          <div class="set-row"><span>Grafik-Preset (<b id="gfx-preset-label">${s.graphics.preset.toUpperCase()}</b>)</span>
            <div class="gfx-preset-row">
              ${(['low', 'medium', 'high', 'ultra'] as Exclude<GraphicsPresetId, 'custom'>[])
                .map((p) => `<button class="os-btn small gfx-preset-btn ${s.graphics.preset === p ? 'primary' : ''}" data-preset="${p}">${p.toUpperCase()}</button>`)
                .join('')}
            </div>
          </div>
          <div class="set-row"><span>Render Scale</span>
            <select id="set-gfx-scale">
              ${[0.75, 0.85, 1.0, 1.15].map((v) => `<option value="${v}" ${Math.abs(s.graphics.renderScale - v) < 0.02 ? 'selected' : ''}>${Math.round(v * 100)}%</option>`).join('')}
            </select>
          </div>
          <div class="set-row"><span>Schattenqualität</span>
            <select id="set-gfx-shadows">
              <option value="off" ${s.graphics.shadowQuality === 'off' ? 'selected' : ''}>AUS</option>
              <option value="low" ${s.graphics.shadowQuality === 'low' ? 'selected' : ''}>Niedrig (512px)</option>
              <option value="medium" ${s.graphics.shadowQuality === 'medium' ? 'selected' : ''}>Mittel (1024px)</option>
              <option value="high" ${s.graphics.shadowQuality === 'high' ? 'selected' : ''}>Hoch (2048px)</option>
            </select>
          </div>
          <div class="set-row"><span>Texturqualität</span>
            <select id="set-gfx-tex">
              <option value="low" ${s.graphics.textureQuality === 'low' ? 'selected' : ''}>Niedrig (256px)</option>
              <option value="medium" ${s.graphics.textureQuality === 'medium' ? 'selected' : ''}>Mittel (512px)</option>
              <option value="high" ${s.graphics.textureQuality === 'high' ? 'selected' : ''}>Hoch (768px)</option>
            </select>
          </div>
          <div class="set-row"><span>Anti-Aliasing</span>
            <select id="set-gfx-aa">
              <option value="off" ${s.graphics.antiAliasing === 'off' ? 'selected' : ''}>AUS</option>
              <option value="fxaa" ${s.graphics.antiAliasing === 'fxaa' ? 'selected' : ''}>FXAA</option>
              <option value="smaa" ${s.graphics.antiAliasing === 'smaa' ? 'selected' : ''}>SMAA (Ultra)</option>
            </select>
          </div>
          <div class="set-row"><span>Post-Processing</span>
            <button class="os-btn small ${s.graphics.postProcessing ? 'primary' : ''}" id="set-gfx-pp">${s.graphics.postProcessing ? 'AN' : 'AUS'}</button>
          </div>
          <div class="set-row"><span>Bloom</span>
            <button class="os-btn small ${s.graphics.bloom ? 'primary' : ''}" id="set-gfx-bloom">${s.graphics.bloom ? 'AN' : 'AUS'}</button>
          </div>
          <div class="set-row"><span>Color Grading</span>
            <button class="os-btn small ${s.graphics.colorGrading ? 'primary' : ''}" id="set-gfx-grade">${s.graphics.colorGrading ? 'AN' : 'AUS'}</button>
          </div>
          <div class="set-row"><span>Effekte & Partikel</span>
            <select id="set-gfx-fx">
              <option value="low" ${s.graphics.effectsQuality === 'low' ? 'selected' : ''}>Niedrig</option>
              <option value="medium" ${s.graphics.effectsQuality === 'medium' ? 'selected' : ''}>Mittel</option>
              <option value="high" ${s.graphics.effectsQuality === 'high' ? 'selected' : ''}>Hoch</option>
            </select>
          </div>
          <div class="set-row"><span>Beleuchtung</span>
            <select id="set-gfx-light">
              <option value="low" ${s.graphics.lightingQuality === 'low' ? 'selected' : ''}>Niedrig</option>
              <option value="medium" ${s.graphics.lightingQuality === 'medium' ? 'selected' : ''}>Mittel</option>
              <option value="high" ${s.graphics.lightingQuality === 'high' ? 'selected' : ''}>Hoch</option>
            </select>
          </div>
          <div class="set-row"><span>Sichtweite</span>
            <select id="set-gfx-dist">
              ${[85, 110, 135, 160].map((v) => `<option value="${v}" ${s.graphics.viewDistance === v ? 'selected' : ''}>${v}m</option>`).join('')}
            </select>
          </div>
          <div class="set-row"><span>FPS Limit</span>
            <select id="set-gfx-fps">
              <option value="0" ${s.graphics.fpsCap === 0 ? 'selected' : ''}>Unbegrenzt</option>
              <option value="60" ${s.graphics.fpsCap === 60 ? 'selected' : ''}>60 FPS</option>
              <option value="120" ${s.graphics.fpsCap === 120 ? 'selected' : ''}>120 FPS</option>
              <option value="144" ${s.graphics.fpsCap === 144 ? 'selected' : ''}>144 FPS</option>
            </select>
          </div>
          <div class="set-row"><span>Performance HUD</span>
            <button class="os-btn small ${s.graphics.showPerfHud ? 'primary' : ''}" id="set-gfx-hud">${s.graphics.showPerfHud ? 'AN' : 'AUS'}</button>
          </div>
          <div class="set-row"><span>Art-Style (F2)</span>
            <select id="set-style">
              ${ART_STYLES.map((a) => `<option value="${a.id}" ${a.id === s.artStyle ? 'selected' : ''}>${a.name}</option>`).join('')}
            </select>
          </div>
          <div class="set-row"><span>Bot-KI Schwierigkeit</span>
            <select id="set-bot-diff">
              ${(Object.keys(BOT_DIFFICULTIES) as BotDifficultyId[])
                .map((id) => `<option value="${id}" ${s.botDifficulty === id ? 'selected' : ''}>${BOT_DIFFICULTIES[id].label}</option>`)
                .join('')}
            </select>
          </div>
          <div class="set-row"><span>AI Debug Overlay (F3)</span>
            <button class="os-btn small ${s.aiDebugOverlay ? 'primary' : ''}" id="set-ai-debug">${s.aiDebugOverlay ? 'AN' : 'AUS'}</button>
          </div>
          <div class="set-row"><span>Gegner-Outlines (3D)</span>
            <button class="os-btn small ${s.enemyOutlines ? 'primary' : ''}" id="set-outlines">${s.enemyOutlines ? 'AN' : 'AUS'}</button>
          </div>
          <div class="set-row"><span>Outline-Farbe</span>
            <div class="outline-swatches">
              ${['#ff3b3b', '#facc15', '#22d3ee', '#e879f9', '#ffffff']
                .map((col) => `<button class="outline-swatch ${s.outlineColor === col ? 'active' : ''}" data-ocol="${col}" style="background:${col}" title="${col}"></button>`)
                .join('')}
            </div>
          </div>
        </div>
        <div class="set-sec">
          <h4>AUDIO & WAFFEN-MIXER</h4>
          <div class="set-row"><span>Output Mode</span>
            <select id="set-audio-out">
              <option value="headphones" ${s.audioOutputMode === 'headphones' ? 'selected' : ''}>Headphones (3D HRTF)</option>
              <option value="speakers" ${s.audioOutputMode === 'speakers' ? 'selected' : ''}>Speakers (Stereo)</option>
              <option value="night" ${s.audioOutputMode === 'night' ? 'selected' : ''}>Night Mode (Compressed)</option>
            </select>
          </div>
          <div class="set-row"><span>Master (<b id="lbl-vol-master">${Math.round(s.masterVol * 100)}</b>%)</span><input type="range" min="0" max="1" step="0.05" value="${s.masterVol}" id="set-vol-m" /></div>
          <div class="set-row"><span>Waffen & Schüsse (<b id="lbl-vol-wpn">${Math.round(s.weaponsVol * 100)}</b>%)</span><input type="range" min="0" max="1" step="0.05" value="${s.weaponsVol}" id="set-vol-w" /></div>
          <div class="set-row"><span>Bewegung & Schritte (<b id="lbl-vol-mov">${Math.round(s.movementVol * 100)}</b>%)</span><input type="range" min="0" max="1" step="0.05" value="${s.movementVol}" id="set-vol-mv" /></div>
          <div class="set-row"><span>Umgebung & Hall (<b id="lbl-vol-env">${Math.round(s.environmentVol * 100)}</b>%)</span><input type="range" min="0" max="1" step="0.05" value="${s.environmentVol}" id="set-vol-env" /></div>
          <div class="set-row"><span>Effekte / Hits (<b id="lbl-vol-sfx">${Math.round(s.sfxVol * 100)}</b>%)</span><input type="range" min="0" max="1" step="0.05" value="${s.sfxVol}" id="set-vol-s" /></div>
          <div class="set-row"><span>Objectives / C4 (<b id="lbl-vol-obj">${Math.round(s.objectivesVol * 100)}</b>%)</span><input type="range" min="0" max="1" step="0.05" value="${s.objectivesVol}" id="set-vol-obj" /></div>
          <div class="set-row"><span>UI Sounds (<b id="lbl-vol-ui">${Math.round(s.uiVol * 100)}</b>%)</span><input type="range" min="0" max="1" step="0.05" value="${s.uiVol}" id="set-vol-u" /></div>
          <div class="set-row"><span>Voice / Ansagen (<b id="lbl-vol-voice">${Math.round(s.voiceVol * 100)}</b>%)</span><input type="range" min="0" max="1" step="0.05" value="${s.voiceVol}" id="set-vol-v" /></div>
          <div class="set-row"><span>Musik (<b id="lbl-vol-mus">${Math.round(s.musicVol * 100)}</b>%)</span><input type="range" min="0" max="1" step="0.05" value="${s.musicVol}" id="set-vol-mu" /></div>
          <div style="margin-top:4px;font-size:11px;color:#94a3b8">WAFFEN-AUDIO PREVIEW (Schuss & Synchron-Reload):</div>
          <div class="slot-row" style="gap:4px">
            ${WEAPONS.map((w) => `<div style="display:flex;gap:2px;background:#0f172a;padding:3px 5px;border:1px solid #334155;align-items:center;font-size:10px">
              <span style="min-width:52px;font-weight:700">${w.shortName}</span>
              <button class="os-btn small" data-aud-shot="${w.soundType}" title="Schuss testen">SHOT</button>
              <button class="os-btn small" data-aud-rel="${w.id}" title="Reload testen">REL</button>
            </div>`).join('')}
          </div>
        </div>
        <div class="set-sec">
          <h4>SPIELSTAND-SLOTS & SANDBOX</h4>
          <div class="slot-row">
            ${[0, 1, 2]
              .map((i) => {
                const sum = store.getSlotSummary(i);
                return `<button class="os-btn small ${store.slot === i ? 'primary' : ''}" data-slot="${i}">Slot ${i + 1}${sum.exists ? ` (${formatMoneyWhole(sum.credits)})` : ' (Neu)'}</button>`;
              })
              .join('')}
          </div>
          <div class="slot-row" style="margin-top:8px">
            <button class="os-btn small ${store.data.devInfinite ? 'primary' : ''}" id="set-dev">DEV INFINITE $: ${store.data.devInfinite ? 'AN' : 'AUS'}</button>
            <button class="os-btn small" id="set-add-cases">+5 Cases (Dev)</button>
            <button class="os-btn small" id="set-unlock-camos">Alle Camos (Dev)</button>
            <button class="os-btn small danger" id="set-wipe">Slot löschen</button>
          </div>
        </div>
      </div>
    `;

    el.querySelector('#set-sens')!.addEventListener('input', (e) => {
      store.data.settings.sensitivity = Number((e.target as HTMLInputElement).value) / 1000;
      store.notify();
    });
    el.querySelector('#set-fov')!.addEventListener('input', (e) => {
      store.data.settings.fov = Number((e.target as HTMLInputElement).value);
      store.notify();
    });
    const syncGfxControls = () => {
      const g = store.data.settings.graphics;
      const lbl = el.querySelector('#gfx-preset-label');
      if (lbl) lbl.textContent = g.preset.toUpperCase();
      el.querySelectorAll('.gfx-preset-btn').forEach((btn) => {
        const p = (btn as HTMLElement).dataset.preset;
        btn.classList.toggle('primary', g.preset === p);
      });
      const setSel = (id: string, val: string) => {
        const node = el.querySelector(id) as HTMLSelectElement | null;
        if (node) node.value = val;
      };
      setSel('#set-gfx-scale', String(g.renderScale));
      setSel('#set-gfx-shadows', g.shadowQuality);
      setSel('#set-gfx-tex', g.textureQuality);
      setSel('#set-gfx-aa', g.antiAliasing);
      setSel('#set-gfx-fx', g.effectsQuality);
      setSel('#set-gfx-light', g.lightingQuality);
      setSel('#set-gfx-dist', String(g.viewDistance));
      setSel('#set-gfx-fps', String(g.fpsCap));
      const setToggle = (id: string, on: boolean) => {
        const b = el.querySelector(id) as HTMLButtonElement | null;
        if (!b) return;
        b.classList.toggle('primary', on);
        b.textContent = on ? 'AN' : 'AUS';
      };
      setToggle('#set-gfx-pp', g.postProcessing);
      setToggle('#set-gfx-bloom', g.bloom);
      setToggle('#set-gfx-grade', g.colorGrading);
      setToggle('#set-gfx-hud', g.showPerfHud);
    };

    el.querySelectorAll('.gfx-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = (btn as HTMLElement).dataset.preset as Exclude<GraphicsPresetId, 'custom'>;
        store.applyGraphicsPreset(p);
        syncGfxControls();
      });
    });
    el.querySelector('#set-gfx-scale')?.addEventListener('change', (e) => {
      store.updateGraphicsSetting('renderScale', Number((e.target as HTMLSelectElement).value));
      syncGfxControls();
    });
    el.querySelector('#set-gfx-shadows')?.addEventListener('change', (e) => {
      store.updateGraphicsSetting('shadowQuality', (e.target as HTMLSelectElement).value as ShadowQuality);
      syncGfxControls();
    });
    el.querySelector('#set-gfx-tex')?.addEventListener('change', (e) => {
      store.updateGraphicsSetting('textureQuality', (e.target as HTMLSelectElement).value as TextureQuality);
      syncGfxControls();
    });
    el.querySelector('#set-gfx-aa')?.addEventListener('change', (e) => {
      store.updateGraphicsSetting('antiAliasing', (e.target as HTMLSelectElement).value as AntiAliasingMode);
      syncGfxControls();
    });
    el.querySelector('#set-gfx-pp')?.addEventListener('click', () => {
      store.updateGraphicsSetting('postProcessing', !store.data.settings.graphics.postProcessing);
      syncGfxControls();
    });
    el.querySelector('#set-gfx-bloom')?.addEventListener('click', () => {
      store.updateGraphicsSetting('bloom', !store.data.settings.graphics.bloom);
      syncGfxControls();
    });
    el.querySelector('#set-gfx-grade')?.addEventListener('click', () => {
      store.updateGraphicsSetting('colorGrading', !store.data.settings.graphics.colorGrading);
      syncGfxControls();
    });
    el.querySelector('#set-gfx-fx')?.addEventListener('change', (e) => {
      store.updateGraphicsSetting('effectsQuality', (e.target as HTMLSelectElement).value as QualityTier);
      syncGfxControls();
    });
    el.querySelector('#set-gfx-light')?.addEventListener('change', (e) => {
      store.updateGraphicsSetting('lightingQuality', (e.target as HTMLSelectElement).value as QualityTier);
      syncGfxControls();
    });
    el.querySelector('#set-gfx-dist')?.addEventListener('change', (e) => {
      store.updateGraphicsSetting('viewDistance', Number((e.target as HTMLSelectElement).value));
      syncGfxControls();
    });
    el.querySelector('#set-gfx-fps')?.addEventListener('change', (e) => {
      store.updateGraphicsSetting('fpsCap', Number((e.target as HTMLSelectElement).value));
      syncGfxControls();
    });
    el.querySelector('#set-gfx-hud')?.addEventListener('click', () => {
      store.updateGraphicsSetting('showPerfHud', !store.data.settings.graphics.showPerfHud);
      syncGfxControls();
    });

    el.querySelector('#set-style')!.addEventListener('change', (e) => {
      store.data.settings.artStyle = (e.target as HTMLSelectElement).value as typeof s.artStyle;
      store.notify();
    });
    el.querySelector('#set-bot-diff')?.addEventListener('change', (e) => {
      store.data.settings.botDifficulty = (e.target as HTMLSelectElement).value as BotDifficultyId;
      sfx.playUi('click');
      store.notify();
    });
    el.querySelector('#set-ai-debug')?.addEventListener('click', () => {
      store.data.settings.aiDebugOverlay = !store.data.settings.aiDebugOverlay;
      sfx.playUi('click');
      store.notify();
    });
    el.querySelector('#set-outlines')!.addEventListener('click', () => {
      store.data.settings.enemyOutlines = !store.data.settings.enemyOutlines;
      sfx.playUi('click');
      store.notify();
    });
    el.querySelectorAll<HTMLButtonElement>('[data-ocol]').forEach((btn) => {
      btn.addEventListener('click', () => {
        store.data.settings.outlineColor = btn.dataset.ocol!;
        sfx.playUi('click');
        store.notify();
      });
    });
    el.querySelector('#set-audio-out')?.addEventListener('change', (e) => {
      store.data.settings.audioOutputMode = (e.target as HTMLSelectElement).value as AudioOutputMode;
      store.syncAudio();
      sfx.playUi('click');
      store.notify();
    });

    const bindVolSlider = (
      inputSel: string,
      lblSel: string,
      field:
        | 'masterVol'
        | 'weaponsVol'
        | 'movementVol'
        | 'environmentVol'
        | 'sfxVol'
        | 'objectivesVol'
        | 'uiVol'
        | 'voiceVol'
        | 'musicVol',
    ) => {
      const inp = el.querySelector(inputSel) as HTMLInputElement | null;
      const lbl = el.querySelector(lblSel);
      if (!inp) return;
      inp.addEventListener('input', () => {
        const val = Number(inp.value);
        store.data.settings[field] = val;
        if (lbl) lbl.textContent = String(Math.round(val * 100));
        store.syncAudio();
        store.save();
      });
      inp.addEventListener('change', () => store.notify());
    };

    bindVolSlider('#set-vol-m', '#lbl-vol-master', 'masterVol');
    bindVolSlider('#set-vol-w', '#lbl-vol-wpn', 'weaponsVol');
    bindVolSlider('#set-vol-mv', '#lbl-vol-mov', 'movementVol');
    bindVolSlider('#set-vol-env', '#lbl-vol-env', 'environmentVol');
    bindVolSlider('#set-vol-s', '#lbl-vol-sfx', 'sfxVol');
    bindVolSlider('#set-vol-obj', '#lbl-vol-obj', 'objectivesVol');
    bindVolSlider('#set-vol-u', '#lbl-vol-ui', 'uiVol');
    bindVolSlider('#set-vol-v', '#lbl-vol-voice', 'voiceVol');
    bindVolSlider('#set-vol-mu', '#lbl-vol-mus', 'musicVol');

    el.querySelectorAll<HTMLButtonElement>('[data-aud-shot]').forEach((b) => {
      b.addEventListener('click', () => sfx.playShot(b.dataset.audShot as typeof WEAPONS[number]['soundType']));
    });
    el.querySelectorAll<HTMLButtonElement>('[data-aud-rel]').forEach((b) => {
      b.addEventListener('click', () => sfx.playReloadPreview(b.dataset.audRel!));
    });
    el.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) => {
      b.addEventListener('click', () => {
        store.loadSlot(Number(b.dataset.slot!));
        this.renderAllWindows();
      });
    });
    el.querySelector('#set-dev')!.addEventListener('click', () => {
      store.data.devInfinite = !store.data.devInfinite;
      store.notify();
    });
    el.querySelector('#set-add-cases')!.addEventListener('click', () => {
      store.addCaseToStock('basic', 2);
      store.addCaseToStock('neon', 2);
      store.addCaseToStock('overdrive', 1);
      sfx.playUi('cash');
      store.notify();
    });
    el.querySelector('#set-unlock-camos')!.addEventListener('click', () => {
      store.unlockAllSkins();
    });
    el.querySelector('#set-wipe')!.addEventListener('click', () => {
      if (window.confirm('Aktuellen Spielstand wirklich komplett löschen?')) {
        store.resetCurrentSlot();
      }
    });
  }

  public dispose(): void {
    this.unsub();
    for (const u of this.mpUnsubs) u();
    this.mpUnsubs = [];
    this.friendsCtrl.dispose();
    this.customMapsCtrl.dispose();
    clearInterval(this.timerId);
    window.removeEventListener('keydown', this.keyHandler);
    if (this.gunPreview) this.gunPreview.dispose();
  }
}
