import { getMode, ModeId, MODES } from '../data/modes';
import {
  ASSET_CATALOG,
  AssetDefinition,
  getAssetDefinition,
} from './assetCatalog';
import {
  EditorViewport,
  EditorToolMode,
  TerrainToolSettings,
} from './editorViewport';
import {
  EditorClipboard,
  EditorHistory,
  EditorStateSnapshot,
  SelectionHistory,
} from './history';
import {
  bakeCustomMapNavigation,
  CustomNavBakeResult,
  validateCustomMap,
} from './navAndValidation';
import {
  createUniqueId,
  deepClone,
  GROUND_MATERIAL_PRESETS,
  LIGHTING_PRESETS,
  slugifyMapId,
} from './presets';
import {
  clearAutosave,
  loadEditorLibrary,
  saveAutosave,
  saveCustomMap,
  saveEditorLibrary,
} from './storage';
import {
  CustomMapDocument,
  CustomMapLaunchConfig,
  EditorTestSnapshot,
  GroundTypeId,
  LightingPresetId,
  MapGroup,
  MapObject,
  MaterialCategory,
  MaterialOverride,
  MaterialPreset,
  ObjectCategory,
  PrefabDef,
  ValidationIssue,
} from './types';

type RightTab = 'inspector' | 'material' | 'lighting' | 'terrain' | 'gameplay' | 'validate';
type LeftTab = 'hierarchy' | 'assets';

const HIERARCHY_GROUPS: Array<{ id: ObjectCategory; label: string; icon: string }> = [
  { id: 'buildings', label: 'Buildings & Structure', icon: '🏛️' },
  { id: 'geometry', label: 'Geometry Primitives', icon: '🧊' },
  { id: 'environment', label: 'Environment & Nature', icon: '🌲' },
  { id: 'props', label: 'Props & Details', icon: '📦' },
  { id: 'lighting', label: 'Lighting', icon: '💡' },
  { id: 'spawns', label: 'Spawn Points', icon: '🚩' },
  { id: 'objectives', label: 'Objectives & Sites', icon: '💣' },
  { id: 'zones', label: 'Gameplay Zones', icon: '🛡️' },
];

export class MapEditorController {
  private container: HTMLElement;
  private doc: CustomMapDocument;
  private onExit: () => void;
  private onTestMap: (snapshot: EditorTestSnapshot, launchConfig: CustomMapLaunchConfig) => void;

  private rootEl!: HTMLDivElement;
  private viewport!: EditorViewport;

  private history = new EditorHistory(100);
  private clipboard = new EditorClipboard();
  private selHistory = new SelectionHistory();

  private selectedIds: string[] = [];
  private toolMode: EditorToolMode = 'select';
  private rightTab: RightTab = 'inspector';
  private leftTab: LeftTab = 'assets';
  private assetCategory = 'All';
  private assetSearch = '';
  private hierarchySearch = '';
  private matCategoryFilter: 'All' | MaterialCategory = 'All';
  private activeMaterialDraft: MaterialOverride;

  private prefabs: PrefabDef[] = [];
  private materialPresets: MaterialPreset[] = [];
  private editingPrefabId: string | null = null;

  private lastBake: CustomNavBakeResult | null = null;
  private validationIssues: ValidationIssue[] = [];
  private dirty = false;
  private saving = false;
  private statusText = 'Ready — Select an asset to place or click an object to edit.';
  private lastAutosaveAt = '';

  private gridVisible = true;
  private boundsVisible = true;
  private navMeshVisible = false;
  private viewMode: 'perspective' | 'topdown' = 'perspective';
  private gridSnap = true;
  private translateSnap = 0.5;
  private rotateSnapDeg = 15;
  private scaleSnap = 0.1;

  private terrainSettings: TerrainToolSettings = {
    mode: 'raise',
    radius: 4.5,
    strength: 0.35,
    falloff: 'smooth',
    smoothness: 0.5,
    targetHeight: 0,
  };

  private autosaveTimer = 0;
  private perfTimer = 0;
  private disposed = false;

  private onKeyDownBound: (e: KeyboardEvent) => void;

  constructor(
    container: HTMLElement,
    doc: CustomMapDocument,
    onExit: () => void,
    onTestMap: (snapshot: EditorTestSnapshot, launchConfig: CustomMapLaunchConfig) => void,
    restoreSnapshot?: EditorTestSnapshot,
    autosaveCandidate?: { savedAt: string; doc: CustomMapDocument } | null,
  ) {
    this.container = container;
    this.doc = restoreSnapshot ? deepClone(restoreSnapshot.document) : deepClone(doc);
    this.onExit = onExit;
    this.onTestMap = onTestMap;
    this.activeMaterialDraft = deepClone(this.doc.terrain.baseMaterial);

    if (restoreSnapshot) {
      this.dirty = restoreSnapshot.dirty;
      this.selectedIds = [...restoreSnapshot.selectedIds];
      this.history.restoreSnapshots(restoreSnapshot.historyEntries, restoreSnapshot.historyIndex);
    }

    this.buildShellDom();

    const vpHost = this.rootEl.querySelector('#ed-viewport-host') as HTMLDivElement;
    this.viewport = new EditorViewport(
      vpHost,
      this.doc,
      {
        onSelectIds: (ids, append) => this.selectIds(ids, append),
        onObjectsTransformed: (label, beforeDoc) => {
          const snapBefore: EditorStateSnapshot = { document: beforeDoc, selectedIds: [...this.selectedIds] };
          const snapAfter: EditorStateSnapshot = { document: deepClone(this.doc), selectedIds: [...this.selectedIds] };
          this.history.push(label, snapBefore, snapAfter);
          this.markDirty();
          this.refreshInspectorPanel();
          this.updateToolbarState();
        },
        onPlaceRequested: (items) => this.handlePlacedItems(items),
        onTerrainChanged: (beforeHeights, afterHeights) => {
          const beforeDoc = deepClone(this.doc);
          beforeDoc.terrain.heights = beforeHeights;
          const afterDoc = deepClone(this.doc);
          afterDoc.terrain.heights = afterHeights;
          this.history.push('Sculpt Terrain', { document: beforeDoc, selectedIds: [...this.selectedIds] }, { document: afterDoc, selectedIds: [...this.selectedIds] });
          this.doc.navigation.dirty = true;
          this.markDirty();
          this.updateToolbarState();
        },
        onPlacementCancelled: () => {
          this.setToolMode('select');
        },
        onStatusUpdate: (txt) => {
          this.setStatus(txt);
        },
      },
      restoreSnapshot?.cameraState,
    );

    if (this.selectedIds.length > 0) {
      this.viewport.setSelectedIds(this.selectedIds);
    }

    this.runValidation(false);
    this.renderLeftPanel();
    this.renderRightPanel();
    this.updateToolbarState();

    void loadEditorLibrary().then((lib) => {
      if (this.disposed) return;
      this.prefabs = lib.prefabs;
      this.materialPresets = lib.materialPresets;
      this.renderLeftPanel();
      this.renderRightPanel();
    });

    if (autosaveCandidate && !restoreSnapshot) {
      this.showAutosaveRecoveryBanner(autosaveCandidate);
    }

    this.onKeyDownBound = (e) => this.handleKeyDown(e);
    window.addEventListener('keydown', this.onKeyDownBound);

    this.autosaveTimer = window.setInterval(() => {
      if (this.dirty && !this.saving) {
        void saveAutosave(this.doc).then(() => {
          this.lastAutosaveAt = new Date().toTimeString().slice(0, 5);
          this.updateToolbarState();
        });
      }
    }, 30_000);

    this.perfTimer = window.setInterval(() => {
      const p = this.viewport.getPerfStats();
      const el = this.rootEl.querySelector('#ed-perf-badge');
      if (el) el.textContent = `${p.fps} FPS · ${p.objects} obj · ${Math.round(p.triangles / 1000)}k tris`;
    }, 500);
  }

  private buildShellDom(): void {
    this.container.innerHTML = '';
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'ed-shell';
    this.rootEl.innerHTML = `
      <header class="ed-toolbar">
        <div class="ed-tb-group ed-tb-brand">
          <span class="ed-logo">MAP STUDIO</span>
          <span class="ed-map-title" id="ed-map-title"></span>
          <span class="ed-autosave-pill" id="ed-autosave-pill">Saved</span>
        </div>

        <div class="ed-tb-group">
          <button class="ed-btn" data-tool="select" title="Select (Q)">↖ Select</button>
          <button class="ed-btn" data-tool="translate" title="Move Gizmo (W)">✥ Move</button>
          <button class="ed-btn" data-tool="rotate" title="Rotate Gizmo (E)">⟳ Rotate</button>
          <button class="ed-btn" data-tool="scale" title="Scale Gizmo (R)">⤢ Scale</button>
          <button class="ed-btn" data-tool="terrain" title="Terrain Brush (B)">⛰ Terrain</button>
        </div>

        <div class="ed-tb-group">
          <button class="ed-btn" id="ed-snap-toggle" title="Toggle Grid Snap (G)">⊞ Snap</button>
          <select class="ed-select" id="ed-snap-pos" title="Position Snap Step">
            <option value="0.25">0.25m</option>
            <option value="0.5" selected>0.5m</option>
            <option value="1">1.0m</option>
            <option value="2">2.0m</option>
          </select>
          <select class="ed-select" id="ed-snap-rot" title="Rotation Snap Step">
            <option value="5">5°</option>
            <option value="15" selected>15°</option>
            <option value="45">45°</option>
            <option value="90">90°</option>
          </select>
          <select class="ed-select" id="ed-snap-scale" title="Scale Snap Step">
            <option value="0.05">0.05x</option>
            <option value="0.1" selected>0.1x</option>
            <option value="0.25">0.25x</option>
            <option value="0.5">0.5x</option>
          </select>
        </div>

        <div class="ed-tb-group">
          <button class="ed-btn" id="ed-undo" title="Undo (Ctrl+Z)">↶ Undo</button>
          <button class="ed-btn" id="ed-redo" title="Redo (Ctrl+Y)">↷ Redo</button>
          <button class="ed-btn" id="ed-dup" title="Duplicate (Ctrl+D)">⧉ Dup</button>
          <button class="ed-btn" id="ed-group" title="Group Selected Objects">▣ Group</button>
          <button class="ed-btn danger" id="ed-delete" title="Delete Selected (Del)">🗑 Del</button>
        </div>

        <div class="ed-tb-group">
          <button class="ed-btn" id="ed-view-mode" title="Perspective / Top-Down Orthographic (T)">👁 Persp</button>
          <button class="ed-btn" id="ed-focus" title="Focus Selected Object (F)">⌖ Focus</button>
          <button class="ed-btn active" id="ed-grid-vis" title="Toggle Grid">#</button>
          <button class="ed-btn active" id="ed-bounds-vis" title="Toggle Boundaries">▢</button>
          <button class="ed-btn" id="ed-nav-vis" title="Toggle NavMesh Preview">🧭 Nav</button>
        </div>

        <div class="ed-tb-group ed-tb-right">
          <span class="ed-perf-badge" id="ed-perf-badge">60 FPS</span>
          <button class="ed-btn" id="ed-thumb" title="Capture Map Thumbnail">📷 Thumb</button>
          <button class="ed-btn primary" id="ed-save" title="Save Map (Ctrl+S)">💾 Save</button>
          <button class="ed-btn" id="ed-save-as" title="Save Copy As...">Save As</button>
          <button class="ed-btn accent" id="ed-test" title="Test Map in Live Match">▶ Test Map</button>
          <button class="ed-btn danger" id="ed-exit" title="Return to Main Menu">✕ Exit</button>
        </div>
      </header>

      <div id="ed-recovery-banner" class="ed-recovery-banner hidden"></div>

      <main class="ed-workspace">
        <aside class="ed-dock ed-dock-left">
          <div class="ed-dock-tabs">
            <button class="ed-tab-btn" data-ltab="assets">Asset Browser & Prefabs</button>
            <button class="ed-tab-btn" data-ltab="hierarchy">Hierarchy (<span id="ed-obj-count">0</span>)</button>
          </div>
          <div class="ed-dock-body" id="ed-left-body"></div>
        </aside>

        <section class="ed-viewport-wrap">
          <div id="ed-viewport-host" class="ed-viewport-host"></div>
          <div class="ed-viewport-hud">
            <span id="ed-status-bar">Ready</span>
            <span class="ed-hint-keys">RMB+WASD Fly · Alt+LMB Orbit · MMB Pan · Wheel Zoom · [ / ] Rotate Preview</span>
          </div>
        </section>

        <aside class="ed-dock ed-dock-right">
          <div class="ed-dock-tabs">
            <button class="ed-tab-btn" data-rtab="inspector">Props</button>
            <button class="ed-tab-btn" data-rtab="material">Mat</button>
            <button class="ed-tab-btn" data-rtab="lighting">Light</button>
            <button class="ed-tab-btn" data-rtab="terrain">Terrain</button>
            <button class="ed-tab-btn" data-rtab="gameplay">Modes</button>
            <button class="ed-tab-btn" data-rtab="validate">Check <span id="ed-val-badge" class="ed-mini-badge">0</span></button>
          </div>
          <div class="ed-dock-body" id="ed-right-body"></div>
        </aside>
      </main>
    `;
    this.container.appendChild(this.rootEl);

    // Wire toolbar events
    this.rootEl.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
      b.addEventListener('click', () => this.setToolMode(b.dataset.tool as EditorToolMode));
    });
    this.rootEl.querySelector('#ed-snap-toggle')!.addEventListener('click', () => {
      this.gridSnap = !this.gridSnap;
      this.viewport.setSnapConfig({ enabled: this.gridSnap });
      this.updateToolbarState();
    });
    this.rootEl.querySelector('#ed-snap-pos')!.addEventListener('change', (e) => {
      this.translateSnap = Number((e.target as HTMLSelectElement).value);
      this.viewport.setSnapConfig({ translateStep: this.translateSnap });
    });
    this.rootEl.querySelector('#ed-snap-rot')!.addEventListener('change', (e) => {
      this.rotateSnapDeg = Number((e.target as HTMLSelectElement).value);
      this.viewport.setSnapConfig({ rotateStepDeg: this.rotateSnapDeg });
    });
    this.rootEl.querySelector('#ed-snap-scale')!.addEventListener('change', (e) => {
      this.scaleSnap = Number((e.target as HTMLSelectElement).value);
      this.viewport.setSnapConfig({ scaleStep: this.scaleSnap });
    });

    this.rootEl.querySelector('#ed-undo')!.addEventListener('click', () => this.undo());
    this.rootEl.querySelector('#ed-redo')!.addEventListener('click', () => this.redo());
    this.rootEl.querySelector('#ed-dup')!.addEventListener('click', () => this.duplicateSelected());
    this.rootEl.querySelector('#ed-group')!.addEventListener('click', () => this.groupSelected());
    this.rootEl.querySelector('#ed-delete')!.addEventListener('click', () => this.deleteSelected());

    this.rootEl.querySelector('#ed-view-mode')!.addEventListener('click', () => {
      this.viewMode = this.viewport.toggleViewMode();
      this.updateToolbarState();
    });
    this.rootEl.querySelector('#ed-focus')!.addEventListener('click', () => this.focusSelected());
    this.rootEl.querySelector('#ed-grid-vis')!.addEventListener('click', () => {
      this.gridVisible = !this.gridVisible;
      this.viewport.setHelpersVisibility({ grid: this.gridVisible });
      this.updateToolbarState();
    });
    this.rootEl.querySelector('#ed-bounds-vis')!.addEventListener('click', () => {
      this.boundsVisible = !this.boundsVisible;
      this.viewport.setHelpersVisibility({ boundaries: this.boundsVisible });
      this.updateToolbarState();
    });
    this.rootEl.querySelector('#ed-nav-vis')!.addEventListener('click', () => {
      this.toggleNavOverlay();
    });

    this.rootEl.querySelector('#ed-thumb')!.addEventListener('click', () => this.captureThumbnailsNow(true));
    this.rootEl.querySelector('#ed-save')!.addEventListener('click', () => void this.saveCurrentMap());
    this.rootEl.querySelector('#ed-save-as')!.addEventListener('click', () => this.openSaveAsModal());
    this.rootEl.querySelector('#ed-test')!.addEventListener('click', () => this.openTestPlayModal());
    this.rootEl.querySelector('#ed-exit')!.addEventListener('click', () => this.handleExitRequested());

    this.rootEl.querySelectorAll<HTMLButtonElement>('[data-ltab]').forEach((b) => {
      b.addEventListener('click', () => {
        this.leftTab = b.dataset.ltab as LeftTab;
        this.renderLeftPanel();
      });
    });
    this.rootEl.querySelectorAll<HTMLButtonElement>('[data-rtab]').forEach((b) => {
      b.addEventListener('click', () => {
        this.rightTab = b.dataset.rtab as RightTab;
        if (this.rightTab === 'terrain') this.setToolMode('terrain');
        this.renderRightPanel();
      });
    });
  }

  private showAutosaveRecoveryBanner(auto: { savedAt: string; doc: CustomMapDocument }): void {
    const el = this.rootEl.querySelector('#ed-recovery-banner') as HTMLDivElement;
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = `
      <span>⚠ Autosave recovery found from ${new Date(auto.savedAt).toLocaleString()}. Restore unsaved changes?</span>
      <div>
        <button class="ed-btn primary" id="ed-rec-restore">Restore Autosave</button>
        <button class="ed-btn" id="ed-rec-discard">Discard</button>
      </div>
    `;
    el.querySelector('#ed-rec-restore')!.addEventListener('click', () => {
      const before = deepClone(this.doc);
      this.doc = deepClone(auto.doc);
      this.history.push('Restore Autosave', { document: before, selectedIds: [] }, { document: deepClone(this.doc), selectedIds: [] });
      this.viewport.rebuildAll(this.doc);
      this.markDirty();
      el.classList.add('hidden');
      this.renderLeftPanel();
      this.renderRightPanel();
      this.setStatus('Autosave restored.');
    });
    el.querySelector('#ed-rec-discard')!.addEventListener('click', () => {
      void clearAutosave(this.doc.id);
      el.classList.add('hidden');
    });
  }

  private setStatus(txt: string): void {
    this.statusText = txt;
    const el = this.rootEl.querySelector('#ed-status-bar');
    if (el) el.textContent = txt;
  }

  private markDirty(): void {
    this.dirty = true;
    this.doc.updatedAt = new Date().toISOString();
    this.updateToolbarState();
  }

  private updateToolbarState(): void {
    const titleEl = this.rootEl.querySelector('#ed-map-title');
    if (titleEl) {
      titleEl.textContent = `${this.doc.name}${this.dirty ? ' *' : ''} (${this.doc.dimensions.width}×${this.doc.dimensions.depth}m)`;
    }
    const autoEl = this.rootEl.querySelector('#ed-autosave-pill');
    if (autoEl) {
      autoEl.textContent = this.saving
        ? 'Saving...'
        : this.dirty
          ? (this.lastAutosaveAt ? `Unsaved · Auto ${this.lastAutosaveAt}` : 'Unsaved')
          : 'Saved on Disk';
      autoEl.className = `ed-autosave-pill ${this.dirty ? 'dirty' : 'clean'}`;
    }

    const objCountEl = this.rootEl.querySelector('#ed-obj-count');
    if (objCountEl) objCountEl.textContent = String(this.doc.objects.length);

    this.rootEl.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === this.toolMode);
    });
    this.rootEl.querySelector('#ed-snap-toggle')?.classList.toggle('active', this.gridSnap);
    this.rootEl.querySelector('#ed-grid-vis')?.classList.toggle('active', this.gridVisible);
    this.rootEl.querySelector('#ed-bounds-vis')?.classList.toggle('active', this.boundsVisible);
    this.rootEl.querySelector('#ed-nav-vis')?.classList.toggle('active', this.navMeshVisible);

    const viewBtn = this.rootEl.querySelector('#ed-view-mode');
    if (viewBtn) viewBtn.textContent = this.viewMode === 'topdown' ? '👁 Top-Down' : '👁 Persp';

    const undoBtn = this.rootEl.querySelector('#ed-undo') as HTMLButtonElement | null;
    const redoBtn = this.rootEl.querySelector('#ed-redo') as HTMLButtonElement | null;
    if (undoBtn) {
      undoBtn.disabled = !this.history.canUndo();
      undoBtn.title = this.history.canUndo() ? `Undo ${this.history.getUndoLabel()} (Ctrl+Z)` : 'Nothing to Undo';
    }
    if (redoBtn) {
      redoBtn.disabled = !this.history.canRedo();
      redoBtn.title = this.history.canRedo() ? `Redo ${this.history.getRedoLabel()} (Ctrl+Y)` : 'Nothing to Redo';
    }

    const valBadge = this.rootEl.querySelector('#ed-val-badge');
    if (valBadge) {
      const errs = this.doc.validationSummary.errors;
      const warns = this.doc.validationSummary.warnings;
      valBadge.textContent = errs > 0 ? `${errs}E` : warns > 0 ? `${warns}W` : '✓';
      valBadge.className = `ed-mini-badge ${errs > 0 ? 'err' : warns > 0 ? 'warn' : 'ok'}`;
    }
  }

  public setToolMode(mode: EditorToolMode): void {
    this.toolMode = mode;
    this.viewport.setToolMode(mode);
    if (mode === 'terrain') {
      this.viewport.setTerrainSettings(this.terrainSettings);
      this.setStatus(`Terrain Sculpt: ${this.terrainSettings.mode.toUpperCase()} — Drag on terrain to sculpt.`);
    } else if (mode !== 'place') {
      this.setStatus(`Tool: ${mode.toUpperCase()}`);
    }
    this.updateToolbarState();
  }

  private commitDocEdit(label: string, mutator: (doc: CustomMapDocument) => void, rebuild = false): void {
    const beforeDoc = deepClone(this.doc);
    const beforeSel = [...this.selectedIds];
    mutator(this.doc);
    const afterDoc = deepClone(this.doc);
    const afterSel = [...this.selectedIds];
    this.history.push(label, { document: beforeDoc, selectedIds: beforeSel }, { document: afterDoc, selectedIds: afterSel });
    if (rebuild) {
      this.viewport.rebuildAll(this.doc);
    }
    this.markDirty();
    this.renderLeftPanel();
    this.renderRightPanel();
    this.updateToolbarState();
  }

  private handlePlacedItems(items: MapObject[]): void {
    this.commitDocEdit(`Place ${items.length === 1 ? items[0].name : `${items.length} Objects`}`, (doc) => {
      for (const item of items) {
        doc.objects.push(item);
        this.viewport.addOrReplaceObjectMesh(item);
      }
      this.selectedIds = items.map((i) => i.id);
      this.selHistory.push(this.selectedIds);
      doc.navigation.dirty = true;
    });
    this.viewport.setSelectedIds(this.selectedIds);
    this.setStatus(`Placed ${items[0].name}. Hold Shift while clicking to place more.`);
  }

  private selectIds(ids: string[], append: boolean): void {
    if (append) {
      const next = new Set(this.selectedIds);
      for (const id of ids) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      this.selectedIds = Array.from(next);
    } else {
      this.selectedIds = [...ids];
    }
    this.selHistory.push(this.selectedIds);
    this.viewport.setSelectedIds(this.selectedIds);
    if (this.selectedIds.length === 1) {
      const selObj = this.doc.objects.find((o) => o.id === this.selectedIds[0]);
      if (selObj?.material) this.activeMaterialDraft = deepClone(selObj.material);
    }
    this.renderLeftPanel();
    this.renderRightPanel();
  }

  private undo(): void {
    const res = this.history.undo();
    if (!res) return;
    this.doc = deepClone(res.state.document);
    this.selectedIds = [...res.state.selectedIds];
    this.viewport.rebuildAll(this.doc);
    this.viewport.setSelectedIds(this.selectedIds);
    this.markDirty();
    this.renderLeftPanel();
    this.renderRightPanel();
    this.setStatus(`Undid: ${res.label}`);
  }

  private redo(): void {
    const res = this.history.redo();
    if (!res) return;
    this.doc = deepClone(res.state.document);
    this.selectedIds = [...res.state.selectedIds];
    this.viewport.rebuildAll(this.doc);
    this.viewport.setSelectedIds(this.selectedIds);
    this.markDirty();
    this.renderLeftPanel();
    this.renderRightPanel();
    this.setStatus(`Redid: ${res.label}`);
  }

  private duplicateSelected(): void {
    const sel = this.doc.objects.filter((o) => this.selectedIds.includes(o.id));
    if (sel.length === 0) return;
    this.commitDocEdit(`Duplicate ${sel.length} Object(s)`, (doc) => {
      const created: string[] = [];
      for (const orig of sel) {
        const copy = deepClone(orig);
        copy.id = createUniqueId('obj');
        copy.name = `${orig.name} Copy`;
        copy.locked = false;
        copy.position = [Number((orig.position[0] + 1.5).toFixed(3)), orig.position[1], Number((orig.position[2] + 1.5).toFixed(3))];
        doc.objects.push(copy);
        this.viewport.addOrReplaceObjectMesh(copy);
        created.push(copy.id);
      }
      this.selectedIds = created;
      doc.navigation.dirty = true;
    });
    this.viewport.setSelectedIds(this.selectedIds);
  }

  private deleteSelected(): void {
    if (this.selectedIds.length === 0) return;
    const toDelete = new Set(this.selectedIds);
    this.commitDocEdit(`Delete ${toDelete.size} Object(s)`, (doc) => {
      doc.objects = doc.objects.filter((o) => {
        if (toDelete.has(o.id)) {
          this.viewport.removeObjectMesh(o.id);
          return false;
        }
        return true;
      });
      this.selectedIds = [];
      doc.navigation.dirty = true;
    });
    this.viewport.setSelectedIds([]);
  }

  private groupSelected(): void {
    if (this.selectedIds.length === 0) return;
    const gName = window.prompt('Group name:', `Group ${this.doc.groups.length + 1}`);
    if (!gName || !gName.trim()) return;
    const newGroup: MapGroup = {
      id: createUniqueId('grp'),
      name: gName.trim(),
      collapsed: false,
      visible: true,
      locked: false,
    };
    this.commitDocEdit(`Group into "${newGroup.name}"`, (doc) => {
      doc.groups.push(newGroup);
      for (const o of doc.objects) {
        if (this.selectedIds.includes(o.id)) o.groupId = newGroup.id;
      }
    });
  }

  private focusSelected(): void {
    if (this.selectedIds.length === 0) {
      this.viewport.focusOnPosition([0, 0, 0], 24);
      return;
    }
    const obj = this.doc.objects.find((o) => o.id === this.selectedIds[0]);
    if (obj) this.viewport.focusOnPosition(obj.position, 8);
  }

  private toggleNavOverlay(): void {
    this.navMeshVisible = !this.navMeshVisible;
    if (this.navMeshVisible) {
      this.lastBake = bakeCustomMapNavigation(this.doc);
      this.doc.navigation.lastBuiltAt = new Date().toISOString();
      this.doc.navigation.walkableCells = this.lastBake.walkableCells;
      this.doc.navigation.blockedCells = this.lastBake.blockedCells;
      this.doc.navigation.componentCount = this.lastBake.componentCount;
      this.doc.navigation.dirty = false;
    }
    this.viewport.setHelpersVisibility({ navMesh: this.navMeshVisible, bake: this.lastBake });
    this.updateToolbarState();
    if (this.rightTab === 'validate') this.renderRightPanel();
  }

  private runValidation(showSwitchStatus = true): void {
    const res = validateCustomMap(this.doc);
    this.lastBake = res.bakeResult;
    this.validationIssues = res.issues;
    this.doc.validationSummary = res.summary;
    this.doc.navigation.lastBuiltAt = new Date().toISOString();
    this.doc.navigation.walkableCells = res.bakeResult.walkableCells;
    this.doc.navigation.blockedCells = res.bakeResult.blockedCells;
    this.doc.navigation.componentCount = res.bakeResult.componentCount;
    this.doc.navigation.dirty = false;
    this.doc.status = res.summary.errors > 0 ? 'errors' : res.summary.warnings > 0 ? 'warnings' : 'valid';
    if (this.navMeshVisible) {
      this.viewport.setHelpersVisibility({ navMesh: true, bake: this.lastBake });
    }
    this.updateToolbarState();
    if (showSwitchStatus) {
      this.setStatus(`Validation: ${res.summary.errors} errors, ${res.summary.warnings} warnings, ${res.summary.infos} info.`);
    }
  }

  private captureThumbnailsNow(notify = false): void {
    const thumbs = this.viewport.captureThumbnails();
    this.doc.thumbnails = {
      previewDataUrl: thumbs.previewDataUrl,
      topdownDataUrl: thumbs.topdownDataUrl,
      updatedAt: new Date().toISOString(),
    };
    this.markDirty();
    if (notify) this.setStatus('Captured updated 3D & top-down map thumbnails.');
  }

  private async saveCurrentMap(): Promise<boolean> {
    if (this.saving) return false;
    this.saving = true;
    this.updateToolbarState();
    try {
      this.runValidation(false);
      const thumbs = this.viewport.captureThumbnails();
      this.doc.thumbnails = {
        previewDataUrl: thumbs.previewDataUrl,
        topdownDataUrl: thumbs.topdownDataUrl,
        updatedAt: new Date().toISOString(),
      };
      const res = await saveCustomMap(this.doc, { allowDuplicateName: true });
      this.doc = deepClone(res.map);
      this.viewport.setDocumentRef(this.doc);
      this.dirty = false;
      await clearAutosave(this.doc.id);
      this.setStatus(`Map "${this.doc.name}" saved persistently to CustomMaps/${this.doc.id}/`);
      this.updateToolbarState();
      if (this.rightTab === 'validate') this.renderRightPanel();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus(`Save error: ${msg}`);
      window.alert(`Could not save map: ${msg}`);
      return false;
    } finally {
      this.saving = false;
      this.updateToolbarState();
    }
  }

  private openSaveAsModal(): void {
    const newName = window.prompt('Save Copy As — New Map Name:', `${this.doc.name} v2`);
    if (!newName || !newName.trim()) return;
    const oldId = this.doc.id;
    const oldName = this.doc.name;
    this.doc.id = `${slugifyMapId(newName)}_${Date.now().toString(36).slice(-4)}`;
    this.doc.name = newName.trim();
    this.doc.createdAt = new Date().toISOString();
    void this.saveCurrentMap().then((ok) => {
      if (!ok) {
        this.doc.id = oldId;
        this.doc.name = oldName;
        this.updateToolbarState();
      }
    });
  }

  private handleExitRequested(): void {
    if (this.dirty) {
      const saveFirst = window.confirm('You have unsaved changes. Save before exiting the Map Editor?');
      if (saveFirst) {
        void this.saveCurrentMap().then(() => this.onExit());
        return;
      }
    }
    this.onExit();
  }

  private openTestPlayModal(): void {
    this.runValidation(false);
    const modal = document.createElement('div');
    modal.className = 'ed-modal-backdrop';
    const modeOpts = this.doc.supportedModes.length > 0 ? this.doc.supportedModes : ['dm', 'snd', 'arena'];
    modal.innerHTML = `
      <div class="ed-modal">
        <div class="ed-modal-head">
          <span>▶ Test Map in Live Game</span>
          <button class="ed-btn" id="ed-tm-close">✕</button>
        </div>
        <div class="ed-modal-body">
          <p class="dim">Your current editor state (including unsaved edits & undo history) is snapshotted and restored intact when you exit the test match.</p>
          ${this.doc.validationSummary.errors > 0 ? `<div class="ed-warn-box">⚠ ${this.doc.validationSummary.errors} validation error(s) found. Temporary fallback spawns may be used if spawns are missing.</div>` : ''}
          <label>Game Mode:
            <select class="ed-input" id="ed-tm-mode">
              ${MODES.map((m) => `<option value="${m.id}" ${m.id === (this.doc.primaryMode || modeOpts[0]) ? 'selected' : ''}>${m.name} (${m.id.toUpperCase()})</option>`).join('')}
            </select>
          </label>
          <label>Bot Count (0 = Solo Walkaround):
            <input class="ed-input" id="ed-tm-bots" type="number" min="0" max="12" value="2" />
          </label>
        </div>
        <div class="ed-modal-foot">
          <button class="ed-btn" id="ed-tm-cancel">Cancel</button>
          <button class="ed-btn primary" id="ed-tm-launch">▶ Launch Test Match</button>
        </div>
      </div>
    `;
    this.rootEl.appendChild(modal);
    modal.querySelector('#ed-tm-close')!.addEventListener('click', () => modal.remove());
    modal.querySelector('#ed-tm-cancel')!.addEventListener('click', () => modal.remove());
    modal.querySelector('#ed-tm-launch')!.addEventListener('click', () => {
      const modeId = (modal.querySelector('#ed-tm-mode') as HTMLSelectElement).value as ModeId;
      const botCount = Math.max(0, Math.min(12, Number((modal.querySelector('#ed-tm-bots') as HTMLInputElement).value) || 0));
      modal.remove();
      const hist = this.history.exportSnapshots();
      const snapshot: EditorTestSnapshot = {
        document: deepClone(this.doc),
        dirty: this.dirty,
        selectedIds: [...this.selectedIds],
        cameraState: this.viewport.getCameraState(),
        historyEntries: hist.entries,
        historyIndex: hist.index,
      };
      this.onTestMap(snapshot, {
        document: deepClone(this.doc),
        modeId,
        botCount,
        teamSize: Math.max(1, Math.min(5, Math.floor(botCount / 2) + 1)),
        roundsPerHalf: 4,
        isTestPlay: true,
      });
    });
  }

  private renderLeftPanel(): void {
    this.rootEl.querySelectorAll<HTMLButtonElement>('[data-ltab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.ltab === this.leftTab);
    });
    const body = this.rootEl.querySelector('#ed-left-body') as HTMLDivElement;
    if (!body) return;

    if (this.leftTab === 'assets') {
      const cats: string[] = ['All', 'Geometry', 'Architecture', 'Ground', 'Environment', 'Industrial', 'Urban', 'Interior', 'Lighting', 'Gameplay', 'Prefabs'];
      const q = this.assetSearch.trim().toLowerCase();
      const filteredAssets = ASSET_CATALOG.filter((a) => {
        if (this.assetCategory !== 'All' && this.assetCategory !== 'Prefabs' && a.browserCategory !== this.assetCategory) return false;
        if (!q) return true;
        return a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.tags.some((t) => t.includes(q));
      });
      const filteredPrefabs = this.prefabs.filter((p) => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));

      body.innerHTML = `
        <div class="ed-panel-pad">
          <input class="ed-input" id="ed-asset-search" type="search" placeholder="Search assets & prefabs..." value="${this.escapeHtml(this.assetSearch)}" />
          <div class="ed-cat-pills">
            ${cats.map((c) => `<button class="ed-pill ${this.assetCategory === c ? 'active' : ''}" data-acat="${c}">${c}</button>`).join('')}
          </div>
          <div class="ed-prefab-actions">
            <button class="ed-btn primary full" id="ed-save-prefab" ${this.selectedIds.length === 0 ? 'disabled' : ''}>+ Save Selected (${this.selectedIds.length}) as Prefab</button>
          </div>
        </div>
        <div class="ed-scroll-list">
          ${this.assetCategory === 'All' || this.assetCategory === 'Prefabs' ? `
            <div class="ed-sec-title">PREFABS (${filteredPrefabs.length})</div>
            ${filteredPrefabs.length === 0 ? `<div class="ed-empty-note">Select objects and save a reusable Prefab.</div>` : filteredPrefabs.map((p) => `
              <div class="ed-asset-card prefab" data-place-prefab="${p.id}">
                <div>
                  <strong>📦 ${this.escapeHtml(p.name)}</strong>
                  <small>${p.items.length} objects · ${this.escapeHtml(p.category)}</small>
                </div>
                <div class="ed-card-btns">
                  <button class="ed-mini-btn" data-edit-prefab="${p.id}" title="Overwrite Prefab from current selection">↻</button>
                  <button class="ed-mini-btn danger" data-del-prefab="${p.id}" title="Delete Prefab">✕</button>
                </div>
              </div>
            `).join('')}
          ` : ''}
          ${this.assetCategory !== 'Prefabs' ? `
            <div class="ed-sec-title">GAME ASSETS (${filteredAssets.length})</div>
            <div class="ed-asset-grid">
              ${filteredAssets.map((a) => `
                <button class="ed-asset-tile" data-place-asset="${a.id}" title="${this.escapeHtml(a.description)}">
                  <span class="ed-at-cat">${a.browserCategory}</span>
                  <strong>${this.escapeHtml(a.name)}</strong>
                </button>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;

      const searchInp = body.querySelector('#ed-asset-search') as HTMLInputElement;
      searchInp.addEventListener('input', () => {
        this.assetSearch = searchInp.value;
        this.renderLeftPanel();
        const again = this.rootEl.querySelector('#ed-asset-search') as HTMLInputElement | null;
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      });
      body.querySelectorAll<HTMLButtonElement>('[data-acat]').forEach((b) => {
        b.addEventListener('click', () => {
          this.assetCategory = b.dataset.acat!;
          this.renderLeftPanel();
        });
      });
      body.querySelector('#ed-save-prefab')?.addEventListener('click', () => this.saveSelectionAsPrefab());
      body.querySelectorAll<HTMLButtonElement>('[data-place-asset]').forEach((b) => {
        b.addEventListener('click', () => {
          const aid = b.dataset.placeAsset!;
          this.toolMode = 'place';
          this.viewport.startPlacement({ kind: 'asset', assetId: aid });
          this.updateToolbarState();
          this.setStatus(`Placement ready: ${getAssetDefinition(aid)?.name} — Click viewport to place, Q/E rotate, Esc cancel.`);
        });
      });
      body.querySelectorAll<HTMLElement>('[data-place-prefab]').forEach((el) => {
        el.addEventListener('click', (ev) => {
          if ((ev.target as HTMLElement).closest('button')) return;
          const pid = el.dataset.placePrefab!;
          const prefab = this.prefabs.find((p) => p.id === pid);
          if (!prefab) return;
          this.toolMode = 'place';
          this.viewport.startPlacement({ kind: 'prefab', prefab });
          this.updateToolbarState();
          this.setStatus(`Placing Prefab: ${prefab.name} — Click viewport to place.`);
        });
      });
      body.querySelectorAll<HTMLButtonElement>('[data-edit-prefab]').forEach((b) => {
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.editingPrefabId = b.dataset.editPrefab!;
          this.saveSelectionAsPrefab(this.editingPrefabId);
        });
      });
      body.querySelectorAll<HTMLButtonElement>('[data-del-prefab]').forEach((b) => {
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const pid = b.dataset.delPrefab!;
          this.prefabs = this.prefabs.filter((p) => p.id !== pid);
          void saveEditorLibrary({ prefabs: this.prefabs, materialPresets: this.materialPresets });
          this.renderLeftPanel();
        });
      });
      return;
    }

    // HIERARCHY VIEW
    const hq = this.hierarchySearch.trim().toLowerCase();
    const matchObj = (o: MapObject) => !hq || o.name.toLowerCase().includes(hq) || o.assetId.toLowerCase().includes(hq);

    body.innerHTML = `
      <div class="ed-panel-pad">
        <div class="ed-row-gap">
          <input class="ed-input" id="ed-hier-search" type="search" placeholder="Filter hierarchy..." value="${this.escapeHtml(this.hierarchySearch)}" />
          <button class="ed-btn" id="ed-sel-back" ${!this.selHistory.canBack() ? 'disabled' : ''} title="Previous Selection">◀</button>
          <button class="ed-btn" id="ed-sel-fwd" ${!this.selHistory.canForward() ? 'disabled' : ''} title="Next Selection">▶</button>
        </div>
      </div>
      <div class="ed-scroll-list">
        ${this.doc.groups.map((grp) => {
          const items = this.doc.objects.filter((o) => o.groupId === grp.id && matchObj(o));
          return `
            <div class="ed-hier-group">
              <div class="ed-hier-ghead" data-ghead="${grp.id}">
                <span>📁 ${this.escapeHtml(grp.name)} (${items.length})</span>
                <button class="ed-mini-btn" data-gsel="${grp.id}" title="Select Group Objects">Sel</button>
              </div>
              ${items.map((o) => this.renderHierarchyItem(o)).join('')}
            </div>
          `;
        }).join('')}
        ${HIERARCHY_GROUPS.map((cat) => {
          const items = this.doc.objects.filter((o) => !o.groupId && o.category === cat.id && matchObj(o));
          if (items.length === 0) return '';
          return `
            <div class="ed-hier-group">
              <div class="ed-hier-ghead">${cat.icon} ${cat.label} (${items.length})</div>
              ${items.map((o) => this.renderHierarchyItem(o)).join('')}
            </div>
          `;
        }).join('')}
      </div>
    `;

    const hSearch = body.querySelector('#ed-hier-search') as HTMLInputElement;
    hSearch.addEventListener('input', () => {
      this.hierarchySearch = hSearch.value;
      this.renderLeftPanel();
      const again = this.rootEl.querySelector('#ed-hier-search') as HTMLInputElement | null;
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    });
    body.querySelector('#ed-sel-back')?.addEventListener('click', () => {
      const prev = this.selHistory.back();
      if (prev) {
        this.selectedIds = prev;
        this.viewport.setSelectedIds(prev);
        this.renderLeftPanel();
        this.renderRightPanel();
      }
    });
    body.querySelector('#ed-sel-fwd')?.addEventListener('click', () => {
      const nxt = this.selHistory.forward();
      if (nxt) {
        this.selectedIds = nxt;
        this.viewport.setSelectedIds(nxt);
        this.renderLeftPanel();
        this.renderRightPanel();
      }
    });
    body.querySelectorAll<HTMLButtonElement>('[data-gsel]').forEach((b) => {
      b.addEventListener('click', () => {
        const gid = b.dataset.gsel!;
        const ids = this.doc.objects.filter((o) => o.groupId === gid).map((o) => o.id);
        this.selectIds(ids, false);
      });
    });
    body.querySelectorAll<HTMLElement>('[data-hobj]').forEach((row) => {
      row.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).closest('button')) return;
        const oid = row.dataset.hobj!;
        this.selectIds([oid], ev.shiftKey);
      });
      row.addEventListener('dblclick', () => {
        const oid = row.dataset.hobj!;
        const obj = this.doc.objects.find((o) => o.id === oid);
        if (obj) this.viewport.focusOnPosition(obj.position, 7);
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-hren]').forEach((b) => {
      b.addEventListener('click', () => {
        const oid = b.dataset.hren!;
        const cur = this.doc.objects.find((x) => x.id === oid);
        if (!cur) return;
        const nextName = window.prompt('Rename Object:', cur.name);
        if (!nextName || !nextName.trim()) return;
        this.commitDocEdit('Rename Object', (doc) => {
          const o = doc.objects.find((x) => x.id === oid);
          if (o) o.name = nextName.trim();
        });
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-hvis]').forEach((b) => {
      b.addEventListener('click', () => {
        const oid = b.dataset.hvis!;
        this.commitDocEdit('Toggle Visibility', (doc) => {
          const o = doc.objects.find((x) => x.id === oid);
          if (o) {
            o.visible = !o.visible;
            this.viewport.syncObjectTransformOnly(o);
          }
        });
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-hlock]').forEach((b) => {
      b.addEventListener('click', () => {
        const oid = b.dataset.hlock!;
        this.commitDocEdit('Toggle Lock', (doc) => {
          const o = doc.objects.find((x) => x.id === oid);
          if (o) o.locked = !o.locked;
        });
        this.viewport.setSelectedIds(this.selectedIds);
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-hdel]').forEach((b) => {
      b.addEventListener('click', () => {
        this.selectedIds = [b.dataset.hdel!];
        this.deleteSelected();
      });
    });
  }

  private renderHierarchyItem(o: MapObject): string {
    const sel = this.selectedIds.includes(o.id);
    return `
      <div class="ed-hier-item ${sel ? 'selected' : ''}" data-hobj="${o.id}">
        <span class="ed-hi-name">${this.escapeHtml(o.name)}</span>
        <div class="ed-hi-btns">
          <button class="ed-mini-btn" data-hren="${o.id}" title="Rename">Aa</button>
          <button class="ed-mini-btn" data-hvis="${o.id}" title="Hide/Show">${o.visible ? '👁' : '🚫'}</button>
          <button class="ed-mini-btn" data-hlock="${o.id}" title="Lock/Unlock">${o.locked ? '🔒' : '🔓'}</button>
          <button class="ed-mini-btn danger" data-hdel="${o.id}" title="Delete">✕</button>
        </div>
      </div>
    `;
  }

  private saveSelectionAsPrefab(overwriteId?: string | null): void {
    const sel = this.doc.objects.filter((o) => this.selectedIds.includes(o.id));
    if (sel.length === 0) {
      window.alert('Select at least 1 object first to save as a Prefab.');
      return;
    }
    const existing = overwriteId ? this.prefabs.find((p) => p.id === overwriteId) : undefined;
    const name = existing
      ? existing.name
      : window.prompt('Prefab Name:', `${sel[0].name} Prefab`);
    if (!name || !name.trim()) return;

    // Normalize item positions around selection center
    const cx = sel.reduce((a, o) => a + o.position[0], 0) / sel.length;
    const minY = Math.min(...sel.map((o) => o.position[1]));
    const cz = sel.reduce((a, o) => a + o.position[2], 0) / sel.length;

    const items = sel.map((o) => {
      const c = deepClone(o);
      const { id: _id, groupId: _gid, ...rest } = c;
      rest.position = [
        Number((o.position[0] - cx).toFixed(3)),
        Number((o.position[1] - minY).toFixed(3)),
        Number((o.position[2] - cz).toFixed(3)),
      ];
      return rest;
    });

    const now = new Date().toISOString();
    if (existing) {
      existing.items = items;
      existing.updatedAt = now;
      this.editingPrefabId = null;
    } else {
      this.prefabs.unshift({
        id: createUniqueId('prefab'),
        name: name.trim(),
        description: `${items.length} modular object(s)`,
        category: 'Custom Prefabs',
        createdAt: now,
        updatedAt: now,
        items,
      });
    }
    void saveEditorLibrary({ prefabs: this.prefabs, materialPresets: this.materialPresets });
    this.setStatus(`Saved Prefab "${name.trim()}" (${items.length} objects).`);
    this.renderLeftPanel();
  }

  private refreshInspectorPanel(): void {
    if (this.rightTab === 'inspector') this.renderRightPanel();
  }

  private renderRightPanel(): void {
    this.rootEl.querySelectorAll<HTMLButtonElement>('[data-rtab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.rtab === this.rightTab);
    });
    const body = this.rootEl.querySelector('#ed-right-body') as HTMLDivElement;
    if (!body) return;

    if (this.rightTab === 'inspector') this.renderInspectorTab(body);
    else if (this.rightTab === 'material') this.renderMaterialTab(body);
    else if (this.rightTab === 'lighting') this.renderLightingTab(body);
    else if (this.rightTab === 'terrain') this.renderTerrainTab(body);
    else if (this.rightTab === 'gameplay') this.renderGameplayTab(body);
    else this.renderValidationTab(body);
  }

  private renderInspectorTab(body: HTMLDivElement): void {
    if (this.selectedIds.length === 0) {
      body.innerHTML = `<div class="ed-empty-note">Click an object in the 3D viewport or Hierarchy to inspect its properties.</div>`;
      return;
    }
    if (this.selectedIds.length > 1) {
      body.innerHTML = `
        <div class="ed-panel-pad">
          <div class="ed-sec-title">${this.selectedIds.length} OBJECTS SELECTED</div>
          <p class="dim">Use Move/Rotate/Scale gizmos, Material tab ("Apply to Selected"), Duplicate, or Group.</p>
          <div class="ed-btn-stack">
            <button class="ed-btn" id="ed-mi-dup">⧉ Duplicate Selection</button>
            <button class="ed-btn" id="ed-mi-grp">▣ Create Group</button>
            <button class="ed-btn primary" id="ed-mi-prefab">+ Save as Prefab</button>
            <button class="ed-btn danger" id="ed-mi-del">🗑 Delete Selection</button>
          </div>
        </div>
      `;
      body.querySelector('#ed-mi-dup')?.addEventListener('click', () => this.duplicateSelected());
      body.querySelector('#ed-mi-grp')?.addEventListener('click', () => this.groupSelected());
      body.querySelector('#ed-mi-prefab')?.addEventListener('click', () => this.saveSelectionAsPrefab());
      body.querySelector('#ed-mi-del')?.addEventListener('click', () => this.deleteSelected());
      return;
    }

    const obj = this.doc.objects.find((o) => o.id === this.selectedIds[0]);
    if (!obj) return;
    const def = getAssetDefinition(obj.assetId);

    body.innerHTML = `
      <div class="ed-panel-pad ed-form">
        <div class="ed-sec-title">OBJECT: ${this.escapeHtml(def?.name || obj.assetId)}</div>
        <label>Name
          <input class="ed-input" id="inp-name" type="text" value="${this.escapeHtml(obj.name)}" />
        </label>
        <div class="ed-grid-2">
          <label>Category
            <select class="ed-input" id="inp-cat">
              ${HIERARCHY_GROUPS.map((g) => `<option value="${g.id}" ${obj.category === g.id ? 'selected' : ''}>${g.label}</option>`).join('')}
            </select>
          </label>
          <label>State
            <select class="ed-input" id="inp-static">
              <option value="true" ${obj.isStatic ? 'selected' : ''}>Static</option>
              <option value="false" ${!obj.isStatic ? 'selected' : ''}>Dynamic</option>
            </select>
          </label>
        </div>

        <div class="ed-sec-title">TRANSFORM</div>
        <div class="ed-vec-row"><span>Pos</span>
          <input class="ed-num" id="px" type="number" step="0.1" value="${obj.position[0]}" />
          <input class="ed-num" id="py" type="number" step="0.1" value="${obj.position[1]}" />
          <input class="ed-num" id="pz" type="number" step="0.1" value="${obj.position[2]}" />
        </div>
        <div class="ed-vec-row"><span>Rot°</span>
          <input class="ed-num" id="rx" type="number" step="5" value="${obj.rotation[0]}" />
          <input class="ed-num" id="ry" type="number" step="5" value="${obj.rotation[1]}" />
          <input class="ed-num" id="rz" type="number" step="5" value="${obj.rotation[2]}" />
        </div>
        <div class="ed-vec-row"><span>Scale</span>
          <input class="ed-num" id="sx" type="number" step="0.1" min="0.05" value="${obj.scale[0]}" />
          <input class="ed-num" id="sy" type="number" step="0.1" min="0.05" value="${obj.scale[1]}" />
          <input class="ed-num" id="sz" type="number" step="0.1" min="0.05" value="${obj.scale[2]}" />
        </div>

        <div class="ed-sec-title">COLLISION & VISIBILITY</div>
        <div class="ed-check-row">
          <label><input type="checkbox" id="inp-vis" ${obj.visible ? 'checked' : ''} /> Visible</label>
          <label><input type="checkbox" id="inp-lock" ${obj.locked ? 'checked' : ''} /> Locked</label>
        </div>
        <div class="ed-check-row">
          <label><input type="checkbox" id="inp-col" ${obj.collision.enabled ? 'checked' : ''} /> Collision</label>
          <label><input type="checkbox" id="inp-walk" ${obj.collision.walkableTop ? 'checked' : ''} /> Walkable Top</label>
        </div>
        <label>Surface / Bullet Penetration
          <select class="ed-input" id="inp-walltype">
            <option value="solid" ${obj.collision.wallType === 'solid' ? 'selected' : ''}>Solid (Blocks Bullets)</option>
            <option value="crate" ${obj.collision.wallType === 'crate' ? 'selected' : ''}>Crate (Penetrable)</option>
            <option value="thin" ${obj.collision.wallType === 'thin' ? 'selected' : ''}>Thin Wallbang</option>
          </select>
        </label>

        ${obj.lightProps ? `
          <div class="ed-sec-title">LIGHT PROPERTIES (${obj.lightProps.lightType.toUpperCase()})</div>
          <div class="ed-grid-2">
            <label>Color <input type="color" id="lp-color" value="${obj.lightProps.color}" /></label>
            <label>Intensity <input class="ed-input" id="lp-int" type="number" step="0.5" min="0" value="${obj.lightProps.intensity}" /></label>
            <label>Range <input class="ed-input" id="lp-range" type="number" step="1" min="1" value="${obj.lightProps.range}" /></label>
            <label>Cone Angle° <input class="ed-input" id="lp-ang" type="number" step="5" min="5" max="85" value="${obj.lightProps.angleDeg}" /></label>
          </div>
        ` : ''}

        ${obj.gameplayProps ? `
          <div class="ed-sec-title">GAMEPLAY CONFIG (${obj.gameplayProps.role})</div>
          <div class="ed-grid-2">
            <label>Label <input class="ed-input" id="gp-label" type="text" value="${this.escapeHtml(obj.gameplayProps.label || '')}" /></label>
            <label>Zone Radius (m) <input class="ed-input" id="gp-rad" type="number" step="0.5" min="1" value="${obj.gameplayProps.radius ?? 4.5}" /></label>
          </div>
        ` : ''}
      </div>
    `;

    const bindVal = (sel: string, apply: (el: HTMLInputElement | HTMLSelectElement) => void, label: string, rebuildMesh = false) => {
      body.querySelector(sel)?.addEventListener('change', (ev) => {
        this.commitDocEdit(label, (doc) => {
          const target = doc.objects.find((x) => x.id === obj.id);
          if (!target) return;
          apply(ev.target as HTMLInputElement | HTMLSelectElement);
          Object.assign(target, obj);
          if (rebuildMesh) this.viewport.addOrReplaceObjectMesh(target);
          else this.viewport.syncObjectTransformOnly(target);
          doc.navigation.dirty = true;
        });
      });
    };

    bindVal('#inp-name', (e) => { obj.name = e.value.trim() || obj.name; }, 'Rename Object');
    bindVal('#inp-cat', (e) => { obj.category = e.value as ObjectCategory; }, 'Change Category');
    bindVal('#inp-static', (e) => { obj.isStatic = e.value === 'true'; }, 'Toggle Static');
    bindVal('#px', (e) => { obj.position[0] = Number(e.value) || 0; }, 'Edit Position');
    bindVal('#py', (e) => { obj.position[1] = Number(e.value) || 0; }, 'Edit Position');
    bindVal('#pz', (e) => { obj.position[2] = Number(e.value) || 0; }, 'Edit Position');
    bindVal('#rx', (e) => { obj.rotation[0] = Number(e.value) || 0; }, 'Edit Rotation');
    bindVal('#ry', (e) => { obj.rotation[1] = Number(e.value) || 0; }, 'Edit Rotation');
    bindVal('#rz', (e) => { obj.rotation[2] = Number(e.value) || 0; }, 'Edit Rotation');
    bindVal('#sx', (e) => { obj.scale[0] = Math.max(0.05, Number(e.value) || 1); }, 'Edit Scale');
    bindVal('#sy', (e) => { obj.scale[1] = Math.max(0.05, Number(e.value) || 1); }, 'Edit Scale');
    bindVal('#sz', (e) => { obj.scale[2] = Math.max(0.05, Number(e.value) || 1); }, 'Edit Scale');
    bindVal('#inp-vis', (e) => { obj.visible = (e as HTMLInputElement).checked; }, 'Toggle Visible');
    bindVal('#inp-lock', (e) => { obj.locked = (e as HTMLInputElement).checked; }, 'Toggle Locked');
    bindVal('#inp-col', (e) => { obj.collision.enabled = (e as HTMLInputElement).checked; }, 'Toggle Collision', true);
    bindVal('#inp-walk', (e) => { obj.collision.walkableTop = (e as HTMLInputElement).checked; }, 'Toggle Walkable Top');
    bindVal('#inp-walltype', (e) => { obj.collision.wallType = e.value as MapObject['collision']['wallType']; }, 'Change WallType', true);

    if (obj.lightProps) {
      bindVal('#lp-color', (e) => { obj.lightProps!.color = e.value; }, 'Edit Light Color', true);
      bindVal('#lp-int', (e) => { obj.lightProps!.intensity = Math.max(0, Number(e.value) || 0); }, 'Edit Light Intensity', true);
      bindVal('#lp-range', (e) => { obj.lightProps!.range = Math.max(1, Number(e.value) || 10); }, 'Edit Light Range', true);
      bindVal('#lp-ang', (e) => { obj.lightProps!.angleDeg = Math.max(5, Math.min(85, Number(e.value) || 45)); }, 'Edit Light Angle', true);
    }
    if (obj.gameplayProps) {
      bindVal('#gp-label', (e) => { obj.gameplayProps!.label = e.value; }, 'Edit Objective Label');
      bindVal('#gp-rad', (e) => { obj.gameplayProps!.radius = Math.max(1, Number(e.value) || 4); }, 'Edit Zone Radius', true);
    }
  }

  private renderMaterialTab(body: HTMLDivElement): void {
    const cats: Array<'All' | MaterialCategory> = ['All', 'Concrete', 'Asphalt', 'Metal', 'Wood', 'Glass', 'Plastic', 'Fabric', 'Stone', 'Dirt', 'Snow'];
    const filtered = this.materialPresets.filter((p) => this.matCategoryFilter === 'All' || p.category === this.matCategoryFilter);
    const d = this.activeMaterialDraft;

    body.innerHTML = `
      <div class="ed-panel-pad ed-form">
        <div class="ed-sec-title">MATERIAL PARAMETERS (${this.selectedIds.length} selected)</div>
        <div class="ed-mat-preview" style="background:${d.color};box-shadow:inset 0 0 18px rgba(0,0,0,0.45), 0 0 12px ${d.emissiveIntensity > 0 ? d.emissive : 'transparent'}">
          <span>${d.kind.toUpperCase()} · R:${d.roughness.toFixed(2)} M:${d.metalness.toFixed(2)}</span>
        </div>
        <div class="ed-grid-2">
          <label>Base Color <input type="color" id="mat-col" value="${d.color}" /></label>
          <label>Emissive <input type="color" id="mat-em" value="${d.emissive}" /></label>
        </div>
        <label>Roughness: <strong id="lbl-r">${d.roughness.toFixed(2)}</strong>
          <input type="range" id="mat-rough" min="0" max="1" step="0.02" value="${d.roughness}" />
        </label>
        <label>Metallic: <strong id="lbl-m">${d.metalness.toFixed(2)}</strong>
          <input type="range" id="mat-metal" min="0" max="1" step="0.02" value="${d.metalness}" />
        </label>
        <label>Normal Strength: <strong id="lbl-n">${d.normalScale.toFixed(2)}</strong>
          <input type="range" id="mat-norm" min="0" max="2" step="0.05" value="${d.normalScale}" />
        </label>
        <label>Emissive Intensity: <strong id="lbl-ei">${d.emissiveIntensity.toFixed(2)}</strong>
          <input type="range" id="mat-emint" min="0" max="3" step="0.05" value="${d.emissiveIntensity}" />
        </label>
        <div class="ed-grid-2">
          <label>Tile X <input class="ed-input" id="mat-tx" type="number" min="1" max="32" value="${d.textureScaleX}" /></label>
          <label>Tile Y <input class="ed-input" id="mat-ty" type="number" min="1" max="32" value="${d.textureScaleY}" /></label>
        </div>
        <div class="ed-row-gap">
          <button class="ed-btn primary" id="mat-apply" ${this.selectedIds.length === 0 ? 'disabled' : ''}>Apply to Selected</button>
          <button class="ed-btn" id="mat-save-preset">Save Preset</button>
        </div>

        <div class="ed-sec-title">MATERIAL LIBRARY</div>
        <div class="ed-cat-pills">
          ${cats.map((c) => `<button class="ed-pill ${this.matCategoryFilter === c ? 'active' : ''}" data-mcat="${c}">${c}</button>`).join('')}
        </div>
        <div class="ed-mat-grid">
          ${filtered.map((p) => `
            <button class="ed-mat-chip" data-mpreset="${p.id}">
              <span class="ed-swatch" style="background:${p.material.color}"></span>
              <span>${this.escapeHtml(p.name)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    const applyDraftToSelection = () => {
      if (this.selectedIds.length === 0) return;
      const matCopy = deepClone(this.activeMaterialDraft);
      this.commitDocEdit(`Apply Material (${matCopy.kind})`, (doc) => {
        for (const id of this.selectedIds) {
          const target = doc.objects.find((o) => o.id === id);
          if (target) {
            target.material = deepClone(matCopy);
            this.viewport.addOrReplaceObjectMesh(target);
          }
        }
      });
    };

    body.querySelector('#mat-col')!.addEventListener('input', (e) => { this.activeMaterialDraft.color = (e.target as HTMLInputElement).value; });
    body.querySelector('#mat-em')!.addEventListener('input', (e) => { this.activeMaterialDraft.emissive = (e.target as HTMLInputElement).value; });
    body.querySelector('#mat-rough')!.addEventListener('input', (e) => {
      this.activeMaterialDraft.roughness = Number((e.target as HTMLInputElement).value);
      body.querySelector('#lbl-r')!.textContent = this.activeMaterialDraft.roughness.toFixed(2);
    });
    body.querySelector('#mat-metal')!.addEventListener('input', (e) => {
      this.activeMaterialDraft.metalness = Number((e.target as HTMLInputElement).value);
      body.querySelector('#lbl-m')!.textContent = this.activeMaterialDraft.metalness.toFixed(2);
    });
    body.querySelector('#mat-norm')!.addEventListener('input', (e) => {
      this.activeMaterialDraft.normalScale = Number((e.target as HTMLInputElement).value);
      body.querySelector('#lbl-n')!.textContent = this.activeMaterialDraft.normalScale.toFixed(2);
    });
    body.querySelector('#mat-emint')!.addEventListener('input', (e) => {
      this.activeMaterialDraft.emissiveIntensity = Number((e.target as HTMLInputElement).value);
      body.querySelector('#lbl-ei')!.textContent = this.activeMaterialDraft.emissiveIntensity.toFixed(2);
    });
    body.querySelector('#mat-tx')!.addEventListener('change', (e) => { this.activeMaterialDraft.textureScaleX = Math.max(1, Number((e.target as HTMLInputElement).value) || 1); });
    body.querySelector('#mat-ty')!.addEventListener('change', (e) => { this.activeMaterialDraft.textureScaleY = Math.max(1, Number((e.target as HTMLInputElement).value) || 1); });

    body.querySelector('#mat-apply')!.addEventListener('click', applyDraftToSelection);
    body.querySelector('#mat-save-preset')!.addEventListener('click', () => {
      const name = window.prompt('Custom Material Preset Name:', 'Custom Finish');
      if (!name || !name.trim()) return;
      this.materialPresets.unshift({
        id: createUniqueId('matp'),
        name: name.trim(),
        category: this.matCategoryFilter === 'All' ? 'Concrete' : this.matCategoryFilter,
        material: deepClone(this.activeMaterialDraft),
        isCustom: true,
      });
      void saveEditorLibrary({ prefabs: this.prefabs, materialPresets: this.materialPresets });
      this.renderRightPanel();
    });

    body.querySelectorAll<HTMLButtonElement>('[data-mcat]').forEach((b) => {
      b.addEventListener('click', () => {
        this.matCategoryFilter = b.dataset.mcat as 'All' | MaterialCategory;
        this.renderRightPanel();
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-mpreset]').forEach((b) => {
      b.addEventListener('click', () => {
        const preset = this.materialPresets.find((p) => p.id === b.dataset.mpreset);
        if (!preset) return;
        this.activeMaterialDraft = deepClone(preset.material);
        applyDraftToSelection();
        this.renderRightPanel();
      });
    });
  }

  private renderLightingTab(body: HTMLDivElement): void {
    const l = this.doc.lighting;
    body.innerHTML = `
      <div class="ed-panel-pad ed-form">
        <div class="ed-sec-title">LIGHTING PRESETS</div>
        <div class="ed-preset-grid">
          ${(Object.keys(LIGHTING_PRESETS) as LightingPresetId[]).map((pid) => `
            <button class="ed-btn ${l.preset === pid ? 'primary' : ''}" data-lpreset="${pid}">${LIGHTING_PRESETS[pid].label}</button>
          `).join('')}
        </div>

        <div class="ed-sec-title">SUN, SKY & ATMOSPHERE</div>
        <div class="ed-grid-2">
          <label>Sky Color <input type="color" id="l-sky" value="${l.skyColor}" /></label>
          <label>Fog Color <input type="color" id="l-fogc" value="${l.fogColor}" /></label>
          <label>Sun Color <input type="color" id="l-sunc" value="${l.sunColor}" /></label>
          <label>Ambient <input type="color" id="l-ambc" value="${l.ambientColor}" /></label>
        </div>
        <label>Sun Intensity (${l.sunIntensity.toFixed(2)})
          <input type="range" id="l-suni" min="0" max="3" step="0.05" value="${l.sunIntensity}" />
        </label>
        <label>Sun Azimuth° (${l.sunAzimuthDeg}°)
          <input type="range" id="l-suna" min="-180" max="180" step="5" value="${l.sunAzimuthDeg}" />
        </label>
        <label>Sun Elevation° (${l.sunElevationDeg}°)
          <input type="range" id="l-sune" min="5" max="88" step="2" value="${l.sunElevationDeg}" />
        </label>
        <label>Hemisphere Fill (${l.hemiIntensity.toFixed(2)})
          <input type="range" id="l-hemi" min="0" max="2" step="0.05" value="${l.hemiIntensity}" />
        </label>
        <label>Fog Density (${l.fogDensity.toFixed(4)})
          <input type="range" id="l-fogd" min="0" max="0.04" step="0.001" value="${l.fogDensity}" />
        </label>
        <label><input type="checkbox" id="l-shadow" ${l.sunCastShadow ? 'checked' : ''} /> Sun Casts Shadows</label>

        <div class="ed-sec-title">ADD SCENE LIGHT OBJECTS</div>
        <div class="ed-grid-2">
          <button class="ed-btn" data-place-lt="light_point">+ Point Light</button>
          <button class="ed-btn" data-place-lt="light_spot">+ Spotlight</button>
          <button class="ed-btn" data-place-lt="light_directional">+ Dir Light</button>
          <button class="ed-btn" data-place-lt="light_area">+ Area Light</button>
        </div>
      </div>
    `;

    body.querySelectorAll<HTMLButtonElement>('[data-lpreset]').forEach((b) => {
      b.addEventListener('click', () => {
        const pid = b.dataset.lpreset as LightingPresetId;
        this.commitDocEdit(`Lighting Preset: ${LIGHTING_PRESETS[pid].label}`, (doc) => {
          doc.lighting = deepClone(LIGHTING_PRESETS[pid].config);
        });
        this.viewport.syncLighting();
      });
    });

    const bindL = (id: string, fn: (val: HTMLInputElement) => void) => {
      body.querySelector(id)?.addEventListener('change', (ev) => {
        this.commitDocEdit('Update Lighting', (doc) => {
          fn(ev.target as HTMLInputElement);
          Object.assign(doc.lighting, l);
        });
        this.viewport.syncLighting();
      });
    };
    bindL('#l-sky', (e) => { l.skyColor = e.value; });
    bindL('#l-fogc', (e) => { l.fogColor = e.value; });
    bindL('#l-sunc', (e) => { l.sunColor = e.value; });
    bindL('#l-ambc', (e) => { l.ambientColor = e.value; });
    bindL('#l-suni', (e) => { l.sunIntensity = Number(e.value); });
    bindL('#l-suna', (e) => { l.sunAzimuthDeg = Number(e.value); });
    bindL('#l-sune', (e) => { l.sunElevationDeg = Number(e.value); });
    bindL('#l-hemi', (e) => { l.hemiIntensity = Number(e.value); });
    bindL('#l-fogd', (e) => { l.fogDensity = Number(e.value); });
    bindL('#l-shadow', (e) => { l.sunCastShadow = e.checked; });

    body.querySelectorAll<HTMLButtonElement>('[data-place-lt]').forEach((b) => {
      b.addEventListener('click', () => {
        this.toolMode = 'place';
        this.viewport.startPlacement({ kind: 'asset', assetId: b.dataset.placeLt! });
        this.updateToolbarState();
      });
    });
  }

  private renderTerrainTab(body: HTMLDivElement): void {
    const t = this.doc.terrain;
    const s = this.terrainSettings;
    body.innerHTML = `
      <div class="ed-panel-pad ed-form">
        <div class="ed-sec-title">TERRAIN HEIGHTFIELD</div>
        <label><input type="checkbox" id="t-enabled" ${t.enabled ? 'checked' : ''} /> Terrain Enabled</label>
        <label>Ground Surface Material
          <select class="ed-input" id="t-ground-mat">
            ${(Object.keys(GROUND_MATERIAL_PRESETS) as GroundTypeId[]).filter((g) => g !== 'none').map((g) => `
              <option value="${g}" ${this.doc.groundType === g ? 'selected' : ''}>${GROUND_MATERIAL_PRESETS[g].label}</option>
            `).join('')}
          </select>
        </label>

        <div class="ed-sec-title">SCULPTING BRUSH</div>
        <div class="ed-cat-pills">
          ${(['raise', 'lower', 'flatten', 'smooth', 'slope'] as const).map((m) => `
            <button class="ed-pill ${s.mode === m ? 'active' : ''}" data-tmode="${m}">${m.toUpperCase()}</button>
          `).join('')}
        </div>
        <button class="ed-btn primary full" id="t-activate-brush">⛰ Activate Brush in Viewport</button>
        <label>Brush Radius (${s.radius.toFixed(1)}m)
          <input type="range" id="t-rad" min="1" max="16" step="0.5" value="${s.radius}" />
        </label>
        <label>Strength (${s.strength.toFixed(2)})
          <input type="range" id="t-str" min="0.05" max="1.5" step="0.05" value="${s.strength}" />
        </label>
        <label>Smoothness (${s.smoothness.toFixed(2)})
          <input type="range" id="t-sm" min="0.1" max="1.0" step="0.05" value="${s.smoothness}" />
        </label>
        <label>Falloff Curve
          <select class="ed-input" id="t-falloff">
            <option value="smooth" ${s.falloff === 'smooth' ? 'selected' : ''}>Smooth (Bell)</option>
            <option value="linear" ${s.falloff === 'linear' ? 'selected' : ''}>Linear (Cone)</option>
            <option value="sharp" ${s.falloff === 'sharp' ? 'selected' : ''}>Sharp (Plateau)</option>
          </select>
        </label>
        <label>Target Flatten / Slope Height (m)
          <input class="ed-input" id="t-flat-h" type="number" step="0.5" value="${s.targetHeight}" />
        </label>
        <button class="ed-btn danger full" id="t-reset-flat">Reset Entire Terrain Flat (0m)</button>
      </div>
    `;

    body.querySelector('#t-enabled')!.addEventListener('change', (e) => {
      this.commitDocEdit('Toggle Terrain', (doc) => {
        doc.terrain.enabled = (e.target as HTMLInputElement).checked;
      });
      this.viewport.syncTerrainVerticesOnly();
    });
    body.querySelector('#t-ground-mat')!.addEventListener('change', (e) => {
      const g = (e.target as HTMLSelectElement).value as GroundTypeId;
      this.commitDocEdit(`Terrain Material: ${g}`, (doc) => {
        doc.groundType = g;
        doc.terrain.baseMaterial = deepClone(GROUND_MATERIAL_PRESETS[g].material);
      });
      this.viewport.syncTerrainFull();
    });
    body.querySelectorAll<HTMLButtonElement>('[data-tmode]').forEach((b) => {
      b.addEventListener('click', () => {
        this.terrainSettings.mode = b.dataset.tmode as TerrainToolSettings['mode'];
        this.viewport.setTerrainSettings(this.terrainSettings);
        this.setToolMode('terrain');
        this.renderRightPanel();
      });
    });
    body.querySelector('#t-activate-brush')!.addEventListener('click', () => this.setToolMode('terrain'));
    body.querySelector('#t-rad')!.addEventListener('input', (e) => {
      this.terrainSettings.radius = Number((e.target as HTMLInputElement).value);
      this.viewport.setTerrainSettings(this.terrainSettings);
      this.renderRightPanel();
    });
    body.querySelector('#t-str')!.addEventListener('input', (e) => {
      this.terrainSettings.strength = Number((e.target as HTMLInputElement).value);
      this.viewport.setTerrainSettings(this.terrainSettings);
    });
    body.querySelector('#t-sm')!.addEventListener('input', (e) => {
      this.terrainSettings.smoothness = Number((e.target as HTMLInputElement).value);
      this.viewport.setTerrainSettings(this.terrainSettings);
    });
    body.querySelector('#t-falloff')!.addEventListener('change', (e) => {
      this.terrainSettings.falloff = (e.target as HTMLSelectElement).value as TerrainToolSettings['falloff'];
      this.viewport.setTerrainSettings(this.terrainSettings);
    });
    body.querySelector('#t-flat-h')!.addEventListener('change', (e) => {
      this.terrainSettings.targetHeight = Number((e.target as HTMLInputElement).value) || 0;
      this.viewport.setTerrainSettings(this.terrainSettings);
    });
    body.querySelector('#t-reset-flat')!.addEventListener('click', () => {
      this.commitDocEdit('Reset Terrain Flat', (doc) => {
        doc.terrain.heights.fill(0);
      });
      this.viewport.syncTerrainVerticesOnly();
    });
  }

  private renderGameplayTab(body: HTMLDivElement): void {
    const isSnd = this.doc.supportedModes.includes('snd');
    const isDefend = this.doc.supportedModes.includes('defend');
    const atkCnt = this.doc.objects.filter((o) => o.gameplayProps?.role === 'spawn_attacker').length;
    const defCnt = this.doc.objects.filter((o) => o.gameplayProps?.role === 'spawn_defender').length;
    const ffaCnt = this.doc.objects.filter((o) => o.gameplayProps?.role === 'spawn_ffa').length;
    const siteACnt = this.doc.objects.filter((o) => o.gameplayProps?.role === 'site_a').length;
    const siteBCnt = this.doc.objects.filter((o) => o.gameplayProps?.role === 'site_b').length;

    body.innerHTML = `
      <div class="ed-panel-pad ed-form">
        <div class="ed-sec-title">SUPPORTED GAME MODES</div>
        <div class="ed-mode-checks">
          ${MODES.map((m) => `
            <label><input type="checkbox" data-mode-chk="${m.id}" ${this.doc.supportedModes.includes(m.id) ? 'checked' : ''} /> ${m.name}</label>
          `).join('')}
        </div>
        <label>Primary / Default Mode
          <select class="ed-input" id="gp-primary-mode">
            ${this.doc.supportedModes.map((id) => `<option value="${id}" ${id === this.doc.primaryMode ? 'selected' : ''}>${getMode(id).name}</option>`).join('')}
          </select>
        </label>

        <div class="ed-sec-title">PLACE GAMEPLAY MARKERS (MODE ADAPTIVE)</div>
        <div class="ed-btn-stack">
          ${isSnd ? `
            <button class="ed-btn" data-place-gp="gp_spawn_attacker">🚩 Place Attacker Spawn (Placed: ${atkCnt})</button>
            <button class="ed-btn" data-place-gp="gp_spawn_defender">🛡️ Place Defender Spawn (Placed: ${defCnt})</button>
            <button class="ed-btn" data-place-gp="gp_site_a">💣 Place Objective Site A (Placed: ${siteACnt})</button>
            <button class="ed-btn" data-place-gp="gp_site_b">💣 Place Objective Site B (Placed: ${siteBCnt})</button>
            <button class="ed-btn" data-place-gp="gp_interaction_zone">⚙ Interaction Zone</button>
          ` : `
            <button class="ed-btn" data-place-gp="gp_spawn_attacker">🚩 Player Spawn (Placed: ${atkCnt})</button>
            <button class="ed-btn" data-place-gp="gp_spawn_defender">🤖 Enemy / Bot Spawn (Placed: ${defCnt})</button>
            <button class="ed-btn" data-place-gp="gp_spawn_ffa">✦ FFA Spawn Point (Placed: ${ffaCnt})</button>
            ${isDefend ? `<button class="ed-btn" data-place-gp="gp_site_a">💣 Defense Site A (Placed: ${siteACnt})</button>` : ''}
            <button class="ed-btn" data-place-gp="gp_capture_point">⚑ Capture Point</button>
            <button class="ed-btn" data-place-gp="gp_hardpoint">◈ Hardpoint Zone</button>
          `}
          <button class="ed-btn" data-place-gp="gp_spawn_team_zone">⬜ Team Spawn Zone</button>
          <button class="ed-btn" data-place-gp="gp_boundary">🚧 Map Boundary Marker</button>
          <button class="ed-btn" data-place-gp="gp_spectator_boundary">🎥 Spectator Boundary</button>
        </div>

        <div class="ed-sec-title">MAP BOUNDARIES</div>
        <div class="ed-grid-2">
          <label>Half Width (X) <input class="ed-input" id="b-hx" type="number" min="12" max="150" value="${this.doc.boundaries.maxX}" /></label>
          <label>Half Depth (Z) <input class="ed-input" id="b-hz" type="number" min="12" max="150" value="${this.doc.boundaries.maxZ}" /></label>
          <label>Max Height (Y) <input class="ed-input" id="b-hy" type="number" min="6" max="60" value="${this.doc.boundaries.maxY}" /></label>
          <label>Spec Margin <input class="ed-input" id="b-sm" type="number" min="0" max="30" value="${this.doc.boundaries.spectatorMargin}" /></label>
        </div>
        <label><input type="checkbox" id="b-enclose" ${this.doc.boundaries.encloseWalls ? 'checked' : ''} /> Enclose Perimeter Walls</label>
      </div>
    `;

    body.querySelectorAll<HTMLInputElement>('[data-mode-chk]').forEach((chk) => {
      chk.addEventListener('change', () => {
        const mId = chk.dataset.modeChk as ModeId;
        this.commitDocEdit('Toggle Supported Game Mode', (doc) => {
          if (chk.checked && !doc.supportedModes.includes(mId)) {
            doc.supportedModes.push(mId);
          } else if (!chk.checked && doc.supportedModes.length > 1) {
            doc.supportedModes = doc.supportedModes.filter((x) => x !== mId);
            if (!doc.supportedModes.includes(doc.primaryMode)) doc.primaryMode = doc.supportedModes[0];
          }
        });
      });
    });
    body.querySelector('#gp-primary-mode')?.addEventListener('change', (e) => {
      this.commitDocEdit('Set Primary Mode', (doc) => {
        doc.primaryMode = (e.target as HTMLSelectElement).value as ModeId;
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-place-gp]').forEach((b) => {
      b.addEventListener('click', () => {
        this.toolMode = 'place';
        this.viewport.startPlacement({ kind: 'asset', assetId: b.dataset.placeGp! });
        this.updateToolbarState();
      });
    });

    const applyBounds = () => {
      const hx = Math.max(12, Math.min(150, Number((body.querySelector('#b-hx') as HTMLInputElement).value) || 28));
      const hz = Math.max(12, Math.min(150, Number((body.querySelector('#b-hz') as HTMLInputElement).value) || 28));
      const hy = Math.max(6, Math.min(60, Number((body.querySelector('#b-hy') as HTMLInputElement).value) || 14));
      const sm = Math.max(0, Number((body.querySelector('#b-sm') as HTMLInputElement).value) || 6);
      const enclose = (body.querySelector('#b-enclose') as HTMLInputElement).checked;
      this.commitDocEdit('Update Map Boundaries', (doc) => {
        doc.boundaries = { minX: -hx, maxX: hx, minZ: -hz, maxZ: hz, maxY: hy, encloseWalls: enclose, spectatorMargin: sm };
        doc.dimensions = { width: hx * 2, depth: hz * 2, maxHeight: hy };
        doc.navigation.dirty = true;
      });
      this.viewport.syncBoundariesVisual();
    };
    ['#b-hx', '#b-hz', '#b-hy', '#b-sm', '#b-enclose'].forEach((id) => {
      body.querySelector(id)?.addEventListener('change', applyBounds);
    });
  }

  private renderValidationTab(body: HTMLDivElement): void {
    const nav = this.doc.navigation;
    const sum = this.doc.validationSummary;
    body.innerHTML = `
      <div class="ed-panel-pad ed-form">
        <div class="ed-sec-title">NAVIGATION & AI MESH</div>
        <div class="ed-nav-stats">
          <span>Walkable: <strong>${nav.walkableCells ?? 0}</strong></span>
          <span>Blocked: <strong>${nav.blockedCells ?? 0}</strong></span>
          <span>Islands: <strong>${nav.componentCount ?? 0}</strong></span>
        </div>
        <div class="ed-row-gap">
          <button class="ed-btn primary" id="val-rebake">🧭 Regenerate NavMesh</button>
          <button class="ed-btn ${this.navMeshVisible ? 'active' : ''}" id="val-vis-nav">${this.navMeshVisible ? 'Hide Overlay' : 'Show NavMesh'}</button>
        </div>

        <div class="ed-sec-title">MAP VALIDATION (${sum.errors} Errors · ${sum.warnings} Warn · ${sum.infos} Info)</div>
        <button class="ed-btn full" id="val-run">✔ Run Full Validation</button>
        <div class="ed-val-list">
          ${this.validationIssues.length === 0
            ? `<div class="ed-ok-box">✓ Map passed all geometry, collision, spawn, objective, and navigation checks!</div>`
            : this.validationIssues.map((iss, idx) => `
              <button class="ed-val-item ${iss.severity}" data-vidx="${idx}">
                <span class="ed-val-sev">${iss.severity.toUpperCase()}</span>
                <span class="ed-val-msg">${this.escapeHtml(iss.message)}</span>
              </button>
            `).join('')}
        </div>
      </div>
    `;

    body.querySelector('#val-rebake')!.addEventListener('click', () => {
      this.runValidation(true);
      this.renderRightPanel();
    });
    body.querySelector('#val-vis-nav')!.addEventListener('click', () => {
      this.toggleNavOverlay();
      this.renderRightPanel();
    });
    body.querySelector('#val-run')!.addEventListener('click', () => {
      this.runValidation(true);
      this.renderRightPanel();
    });
    body.querySelectorAll<HTMLButtonElement>('[data-vidx]').forEach((b) => {
      b.addEventListener('click', () => {
        const iss = this.validationIssues[Number(b.dataset.vidx)];
        if (!iss) return;
        if (iss.objectId) this.selectIds([iss.objectId], false);
        if (iss.focusPos) this.viewport.focusOnPosition(iss.focusPos, 8);
      });
    });
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
      return;
    }
    if (this.viewport.isFlying()) {
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.code === 'KeyZ') { e.preventDefault(); this.undo(); return; }
      if (e.code === 'KeyY') { e.preventDefault(); this.redo(); return; }
      if (e.code === 'KeyS') { e.preventDefault(); void this.saveCurrentMap(); return; }
      if (e.code === 'KeyD') { e.preventDefault(); this.duplicateSelected(); return; }
      if (e.code === 'KeyC') {
        e.preventDefault();
        const sel = this.doc.objects.filter((o) => this.selectedIds.includes(o.id));
        const n = this.clipboard.copy(sel);
        this.setStatus(`Copied ${n} object(s).`);
        return;
      }
      if (e.code === 'KeyV') {
        e.preventDefault();
        const pasted = this.clipboard.paste([1.5, 0, 1.5]);
        if (pasted.length > 0) this.handlePlacedItems(pasted);
        return;
      }
    }

    if (e.code === 'Delete' || e.code === 'Backspace') {
      e.preventDefault();
      this.deleteSelected();
    } else if (e.code === 'KeyQ') {
      if (this.toolMode === 'place') this.viewport.rotatePreview(-this.rotateSnapDeg);
      else this.setToolMode('select');
    } else if (e.code === 'KeyW') {
      if (this.toolMode !== 'place') this.setToolMode('translate');
    } else if (e.code === 'KeyE') {
      if (this.toolMode === 'place') this.viewport.rotatePreview(this.rotateSnapDeg);
      else this.setToolMode('rotate');
    } else if (e.code === 'KeyR') {
      this.setToolMode('scale');
    } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
      if (this.toolMode === 'place') this.viewport.scalePreview(0.1);
    } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
      if (this.toolMode === 'place') this.viewport.scalePreview(-0.1);
    } else if (e.code === 'KeyB') {
      this.setToolMode('terrain');
      this.rightTab = 'terrain';
      this.renderRightPanel();
    } else if (e.code === 'KeyF') {
      this.focusSelected();
    } else if (e.code === 'KeyT') {
      this.viewMode = this.viewport.toggleViewMode();
      this.updateToolbarState();
    } else if (e.code === 'KeyG') {
      this.gridSnap = !this.gridSnap;
      this.viewport.setSnapConfig({ enabled: this.gridSnap });
      this.updateToolbarState();
    } else if (e.code === 'BracketLeft') {
      this.viewport.rotatePreview(-this.rotateSnapDeg);
    } else if (e.code === 'BracketRight') {
      this.viewport.rotatePreview(this.rotateSnapDeg);
    } else if (e.code === 'Escape') {
      if (this.toolMode === 'place') {
        this.viewport.clearPlacementPreview();
        this.setToolMode('select');
      } else {
        this.selectIds([], false);
      }
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  public dispose(): void {
    this.disposed = true;
    clearInterval(this.autosaveTimer);
    clearInterval(this.perfTimer);
    window.removeEventListener('keydown', this.onKeyDownBound);
    this.viewport.dispose();
  }
}
