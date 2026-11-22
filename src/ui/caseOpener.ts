import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import { formatMoneyWhole } from '../data/balance';
import { getCase, RARITY_META, SKINS, WeaponSkin } from '../data/skins';
import { getWeaponDef, WeaponDef } from '../data/weapons';
import { updateCamoClock } from '../game/camoTextures';
import { createStudioEnvironmentMap } from '../game/weaponMaterials';
import { createWeaponRig, WeaponRig } from '../game/weaponModels';
import { CaseDropResult, store } from '../state/store';

export class GunPreview3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private holder = new THREE.Group();
  private currentRig: WeaponRig | null = null;
  private raf = 0;
  private alive = true;
  private dragYaw = 0.55;
  private dragPitch = 0.14;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private onWinMouseUp: () => void;
  private onWinMouseMove: (e: MouseEvent) => void;

  constructor(host: HTMLElement, width = 300, height = 190) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.innerHTML = '';
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.environment = createStudioEnvironmentMap(this.renderer);
    this.camera = new THREE.PerspectiveCamera(34, width / height, 0.05, 20);
    this.camera.position.set(0, 0.04, 1.02);

    this.scene.add(new THREE.HemisphereLight('#f8fafc', '#1e293b', 0.85));
    const key = new THREE.DirectionalLight('#fff4e0', 1.45);
    key.position.set(2.4, 3.2, 2.2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#7dd3fc', 0.85);
    rim.position.set(-2.4, 1.2, -2.0);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight('#cbd5e1', 0.35);
    fill.position.set(0, -2.2, 1.5);
    this.scene.add(fill);

    this.scene.add(this.holder);

    const dom = this.renderer.domElement;
    dom.style.cursor = 'grab';
    dom.addEventListener('mousedown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      dom.style.cursor = 'grabbing';
    });
    this.onWinMouseUp = () => {
      this.dragging = false;
      dom.style.cursor = 'grab';
    };
    this.onWinMouseMove = (e: MouseEvent) => {
      if (!this.dragging) return;
      this.dragYaw += (e.clientX - this.lastX) * 0.015;
      this.dragPitch = THREE.MathUtils.clamp(this.dragPitch + (e.clientY - this.lastY) * 0.012, -0.6, 0.7);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    };
    window.addEventListener('mouseup', this.onWinMouseUp);
    window.addEventListener('mousemove', this.onWinMouseMove);

    this.tick();
  }

  public show(def: WeaponDef, skin?: WeaponSkin): void {
    this.holder.clear();
    if (this.currentRig) {
      this.currentRig.dispose();
      this.currentRig = null;
    }
    const rig = createWeaponRig(def, skin);
    this.currentRig = rig;
    const scale =
      def.id === 'sniper' || def.id === 'ssg' ? 0.96 :
      def.id === 'rifle' || def.id === 'm4' || def.id === 'shotgun' ? 1.18 :
      def.id === 'smg' ? 1.48 : 1.85;
    rig.root.scale.setScalar(scale);

    const centerRig = () => {
      if (this.currentRig !== rig) return;
      rig.root.position.set(0, 0, 0);
      const box = new THREE.Box3().setFromObject(rig.root);
      const center = box.getCenter(new THREE.Vector3());
      rig.root.position.sub(center);
    };
    centerRig();
    rig.onExternalLoaded = centerRig;

    this.holder.add(rig.root);
  }

  private tick = (): void => {
    if (!this.alive) return;
    this.raf = requestAnimationFrame(this.tick);
    updateCamoClock(performance.now() * 0.001);
    if (!this.dragging) this.dragYaw += 0.008;
    this.holder.rotation.y = this.dragYaw;
    this.holder.rotation.x = this.dragPitch;
    this.renderer.render(this.scene, this.camera);
  };

  public dispose(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('mouseup', this.onWinMouseUp);
    window.removeEventListener('mousemove', this.onWinMouseMove);
    this.holder.clear();
    if (this.currentRig) {
      this.currentRig.dispose();
      this.currentRig = null;
    }
    this.renderer.dispose();
  }
}

export function openCaseReelModal(
  parent: HTMLElement,
  caseId: string,
  drop: CaseDropResult,
  onDone: () => void,
): void {
  const cdef = getCase(caseId);
  const modal = document.createElement('div');
  modal.className = 'case-modal-backdrop';

  const totalCards = 48;
  const winIdx = 38;
  const strip: WeaponSkin[] = [];
  for (let i = 0; i < totalCards; i++) {
    strip.push(i === winIdx ? drop.skin : store.drawSkinFromCase(caseId));
  }

  const cardW = 132;
  const gap = 8;
  const stride = cardW + gap;

  modal.innerHTML = `
    <div class="os-win-card case-modal">
      <div class="os-titlebar"><span>UNBOXING — ${cdef.name.toUpperCase()}</span></div>
      <div class="case-reel-stage">
        <div class="case-pointer"></div>
        <div class="case-reel-viewport" id="case-vp">
          <div class="case-reel-track" id="case-track">
            ${strip
              .map((s) => {
                const rm = RARITY_META[s.rarity];
                const gunLabel = s.weaponId === 'universal' ? 'UNIVERSAL' : getWeaponDef(s.weaponId).shortName;
                return `<div class="reel-card" style="border-color:${rm.color};background:linear-gradient(180deg, #111827 0%, ${rm.glow} 100%)">
                  <div class="rc-swatch ${s.animated ? 'is-anim' : ''}" style="background:${s.swatchCss};border-bottom:4px solid ${s.accentColor}"></div>
                  <div class="rc-gun">${gunLabel} ${s.animated ? '✦' : ''}</div>
                  <div class="rc-name">${s.name}</div>
                  <div class="rc-rar" style="color:${rm.color}">${rm.name.toUpperCase()}</div>
                </div>`;
              })
              .join('')}
          </div>
        </div>
        <div class="case-reveal-panel hidden" id="case-reveal"></div>
        <div class="case-modal-actions" id="case-actions">
          <button class="os-btn" id="btn-case-skip">SKIP &raquo;</button>
        </div>
      </div>
    </div>
  `;

  parent.appendChild(modal);

  const vp = modal.querySelector('#case-vp') as HTMLDivElement;
  const track = modal.querySelector('#case-track') as HTMLDivElement;
  const reveal = modal.querySelector('#case-reveal') as HTMLDivElement;
  const actions = modal.querySelector('#case-actions') as HTMLDivElement;

  const vpCenter = vp.clientWidth / 2 || 310;
  const jitter = (Math.random() - 0.5) * (cardW * 0.55);
  const targetX = winIdx * stride + cardW / 2 - vpCenter + jitter;

  const startTime = performance.now();
  const duration = 3600;
  let lastTickIdx = -1;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    track.style.transform = `translateX(${-targetX}px)`;
    const rm = RARITY_META[drop.skin.rarity];
    const isUniversal = drop.skin.weaponId === 'universal';
    const w = isUniversal ? null : getWeaponDef(drop.skin.weaponId);
    sfx.playCaseReveal(drop.skin.rarity);

    reveal.classList.remove('hidden');
    reveal.style.borderColor = rm.color;
    reveal.style.boxShadow = `0 0 28px ${rm.glow}`;
    reveal.innerHTML = `
      <div class="rev-rar" style="color:${rm.color}">${rm.name.toUpperCase()} ${drop.skin.animated ? '· ✦ ANIMATED' : ''} ${drop.duplicate ? '· DUPLIKAT' : '· NEUE CAMO!'}</div>
      <div class="rev-title">${w ? `${w.name} — ` : ''}${drop.skin.name}</div>
      <div class="rev-sub">${drop.duplicate ? `Erstattung: +${formatMoneyWhole(drop.refund)}` : `${drop.skin.subtitle} · Tracer: ${drop.skin.tracerColor} · Chime: ${drop.skin.killChime.toUpperCase()}`}</div>
    `;

    const ownsGun = isUniversal || store.data.ownedWeapons.includes(drop.skin.weaponId);
    const equipTargetWeapon = isUniversal ? (store.data.equippedPrimary || 'pistol') : drop.skin.weaponId;
    const remaining = store.data.caseStock[caseId] || 0;
    actions.innerHTML = `
      ${ownsGun ? `<button class="os-btn primary" id="btn-case-equip">${isUniversal ? 'AUF AKTIVE WAFFE' : 'SOFORT AUSRÜSTEN'}</button>` : `<span class="rev-note">Kaufe ${w?.name ?? ''} in der Armory zum Ausrüsten</span>`}
      ${isUniversal ? `<button class="os-btn" id="btn-case-equip-all">AUF ALLE WAFFEN</button>` : ''}
      ${remaining > 0 ? `<button class="os-btn" id="btn-case-again">NOCHMAL (${remaining})</button>` : ''}
      <button class="os-btn" id="btn-case-close">SCHLIESSEN</button>
    `;

    actions.querySelector('#btn-case-equip')?.addEventListener('click', () => {
      store.equipSkin(equipTargetWeapon, drop.skin.id);
      modal.remove();
      onDone();
    });
    actions.querySelector('#btn-case-equip-all')?.addEventListener('click', () => {
      store.equipSkinAllWeapons(drop.skin.id);
      modal.remove();
      onDone();
    });
    actions.querySelector('#btn-case-again')?.addEventListener('click', () => {
      const next = store.openCase(caseId);
      modal.remove();
      if (next) openCaseReelModal(parent, caseId, next, onDone);
      else onDone();
    });
    actions.querySelector('#btn-case-close')!.addEventListener('click', () => {
      modal.remove();
      onDone();
    });
  };

  modal.querySelector('#btn-case-skip')!.addEventListener('click', finish);

  const step = (now: number) => {
    if (finished) return;
    const t = Math.min(1, (now - startTime) / duration);
    // Quartic ease-out for satisfying CS-case crawl!
    const ease = 1 - Math.pow(1 - t, 4.2);
    const x = targetX * ease;
    track.style.transform = `translateX(${-x}px)`;
    const idx = Math.floor((x + vpCenter) / stride);
    if (idx !== lastTickIdx) {
      lastTickIdx = idx;
      sfx.playUi('tick');
    }
    if (t >= 1) finish();
    else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
