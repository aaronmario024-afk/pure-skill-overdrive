import { sfx } from '../audio/sfx';
import { getMode, ModeId, MODES } from '../data/modes';
import { KNOWN_ASSET_IDS } from '../editor/assetCatalog';
import {
  createNewCustomMapDocument,
  ENVIRONMENT_PRESETS,
  GROUND_MATERIAL_PRESETS,
  LIGHTING_PRESETS,
} from '../editor/presets';
import {
  deleteCustomMap,
  duplicateCustomMap,
  exportCustomMapPackage,
  importCustomMapPackage,
  listCustomMaps,
  loadCustomMap,
  renameCustomMap,
  saveCustomMap,
  triggerPackageDownload,
} from '../editor/storage';
import {
  CustomMapDocument,
  CustomMapLaunchConfig,
  CustomMapMetadata,
  EnvironmentPresetId,
  GroundTypeId,
  LightingPresetId,
} from '../editor/types';

export interface CustomMapsTabCallbacks {
  onOpenEditor: (
    doc: CustomMapDocument,
    autosave?: { savedAt: string; doc: CustomMapDocument } | null,
  ) => void;
  onPlayCustomMap: (launchCfg: CustomMapLaunchConfig) => void;
}

type SortKey = 'updated_desc' | 'name_asc' | 'created_desc' | 'size_desc';
type StatusFilter = 'all' | 'valid' | 'warnings' | 'errors' | 'draft';

export class CustomMapsTabController {
  private callbacks: CustomMapsTabCallbacks;
  private hostEl: HTMLDivElement | null = null;
  private maps: Array<CustomMapMetadata & { previewDataUrl?: string; topdownDataUrl?: string }> = [];
  private corruptedMaps: Array<{ id: string; error: string; details?: string }> = [];
  private loading = false;

  private searchQuery = '';
  private sortBy: SortKey = 'updated_desc';
  private modeFilter: 'all' | ModeId = 'all';
  private statusFilter: StatusFilter = 'all';
  private previewTopdownIds = new Set<string>();
  private mounted = false;

  constructor(callbacks: CustomMapsTabCallbacks) {
    this.callbacks = callbacks;
  }

  public mount(host: HTMLDivElement): void {
    this.hostEl = host;
    this.mounted = true;
    this.render();
    void this.refreshList();
  }

  public dispose(): void {
    this.mounted = false;
    this.hostEl = null;
  }

  public async refreshList(): Promise<void> {
    this.loading = true;
    this.render();
    const res = await listCustomMaps();
    if (!this.mounted) return;
    this.maps = res.maps;
    this.corruptedMaps = res.corruptedMaps;
    this.loading = false;
    this.render();
  }

  private getFilteredSortedMaps() {
    const q = this.searchQuery.trim().toLowerCase();
    const filtered = this.maps.filter((m) => {
      if (this.modeFilter !== 'all' && !m.supportedModes.includes(this.modeFilter)) return false;
      if (this.statusFilter !== 'all' && m.status !== this.statusFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.environmentPreset.toLowerCase().includes(q)
      );
    });

    filtered.sort((a, b) => {
      if (this.sortBy === 'name_asc') return a.name.localeCompare(b.name);
      if (this.sortBy === 'created_desc') return b.createdAt.localeCompare(a.createdAt);
      if (this.sortBy === 'size_desc') {
        return b.dimensions.width * b.dimensions.depth - a.dimensions.width * a.dimensions.depth;
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    return filtered;
  }

  private render(): void {
    if (!this.hostEl) return;
    const filtered = this.getFilteredSortedMaps();

    this.hostEl.innerHTML = `
      <div class="cm-wrap">
        <div class="cm-topbar">
          <div class="cm-actions">
            <button class="os-btn primary" id="cm-create">+ CREATE NEW MAP</button>
            <button class="os-btn" id="cm-import">📥 IMPORT MAP</button>
            <button class="os-btn" id="cm-refresh">↻ REFRESH</button>
            <input type="file" id="cm-import-file" accept=".json,.psomap.json" class="hidden" />
          </div>
          <div class="cm-filters">
            <input class="cm-input" id="cm-search" type="search" placeholder="Search custom maps..." value="${this.esc(this.searchQuery)}" />
            <select class="cm-select" id="cm-filter-mode">
              <option value="all" ${this.modeFilter === 'all' ? 'selected' : ''}>All Modes</option>
              ${MODES.map((m) => `<option value="${m.id}" ${this.modeFilter === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}
            </select>
            <select class="cm-select" id="cm-filter-status">
              <option value="all" ${this.statusFilter === 'all' ? 'selected' : ''}>All Status</option>
              <option value="valid" ${this.statusFilter === 'valid' ? 'selected' : ''}>Ready (Valid)</option>
              <option value="warnings" ${this.statusFilter === 'warnings' ? 'selected' : ''}>Warnings</option>
              <option value="errors" ${this.statusFilter === 'errors' ? 'selected' : ''}>Errors</option>
              <option value="draft" ${this.statusFilter === 'draft' ? 'selected' : ''}>Draft</option>
            </select>
            <select class="cm-select" id="cm-sort">
              <option value="updated_desc" ${this.sortBy === 'updated_desc' ? 'selected' : ''}>Last Modified</option>
              <option value="name_asc" ${this.sortBy === 'name_asc' ? 'selected' : ''}>Name (A-Z)</option>
              <option value="created_desc" ${this.sortBy === 'created_desc' ? 'selected' : ''}>Created Date</option>
              <option value="size_desc" ${this.sortBy === 'size_desc' ? 'selected' : ''}>Map Size</option>
            </select>
          </div>
        </div>

        ${this.corruptedMaps.length > 0 ? `
          <div class="cm-corrupt-banner">
            ⚠ Skipped ${this.corruptedMaps.length} corrupted map folder(s): ${this.corruptedMaps.map((c) => this.esc(c.id)).join(', ')}
          </div>
        ` : ''}

        <div class="cm-content">
          ${this.loading && this.maps.length === 0 ? `
            <div class="cm-empty"><h3>Loading Custom Maps...</h3></div>
          ` : filtered.length === 0 ? `
            <div class="cm-empty">
              <div class="cm-empty-icon">🗺️</div>
              <h3>${this.maps.length === 0 ? 'No Custom Maps Created Yet' : 'No Maps Match Your Search / Filters'}</h3>
              <p class="dim">Design your own arenas, buildings, terrain hills, Search & Destroy bombsites, and AI navigation meshes directly inside the game.</p>
              <div class="cm-actions">
                <button class="os-btn primary" id="cm-empty-create">+ CREATE YOUR FIRST MAP</button>
                <button class="os-btn" id="cm-empty-import">📥 IMPORT .PSOMAP.JSON</button>
              </div>
            </div>
          ` : `
            <div class="cm-grid">
              ${filtered.map((m) => this.renderCard(m)).join('')}
            </div>
          `}
        </div>
      </div>
    `;

    this.hostEl.querySelector('#cm-create')?.addEventListener('click', () => this.openCreateModal());
    this.hostEl.querySelector('#cm-empty-create')?.addEventListener('click', () => this.openCreateModal());
    this.hostEl.querySelector('#cm-refresh')?.addEventListener('click', () => void this.refreshList());

    const fileInput = this.hostEl.querySelector('#cm-import-file') as HTMLInputElement;
    const triggerFile = () => fileInput.click();
    this.hostEl.querySelector('#cm-import')?.addEventListener('click', triggerFile);
    this.hostEl.querySelector('#cm-empty-import')?.addEventListener('click', triggerFile);
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      void f.text().then((txt) => this.handleImportText(txt));
      fileInput.value = '';
    });

    const searchInp = this.hostEl.querySelector('#cm-search') as HTMLInputElement;
    searchInp.addEventListener('input', () => {
      this.searchQuery = searchInp.value;
      this.render();
      const again = this.hostEl?.querySelector('#cm-search') as HTMLInputElement | null;
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    });
    this.hostEl.querySelector('#cm-filter-mode')?.addEventListener('change', (e) => {
      this.modeFilter = (e.target as HTMLSelectElement).value as 'all' | ModeId;
      this.render();
    });
    this.hostEl.querySelector('#cm-filter-status')?.addEventListener('change', (e) => {
      this.statusFilter = (e.target as HTMLSelectElement).value as StatusFilter;
      this.render();
    });
    this.hostEl.querySelector('#cm-sort')?.addEventListener('change', (e) => {
      this.sortBy = (e.target as HTMLSelectElement).value as SortKey;
      this.render();
    });

    // Card action bindings
    this.hostEl.querySelectorAll<HTMLButtonElement>('[data-cm-play]').forEach((b) => {
      b.addEventListener('click', () => void this.openPlayModal(b.dataset.cmPlay!));
    });
    this.hostEl.querySelectorAll<HTMLButtonElement>('[data-cm-edit]').forEach((b) => {
      b.addEventListener('click', () => void this.openInEditor(b.dataset.cmEdit!));
    });
    this.hostEl.querySelectorAll<HTMLButtonElement>('[data-cm-dup]').forEach((b) => {
      b.addEventListener('click', async () => {
        try {
          sfx.playUi('click');
          await duplicateCustomMap(b.dataset.cmDup!);
          await this.refreshList();
        } catch (err) {
          window.alert(err instanceof Error ? err.message : String(err));
        }
      });
    });
    this.hostEl.querySelectorAll<HTMLButtonElement>('[data-cm-ren]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = b.dataset.cmRen!;
        const cur = this.maps.find((m) => m.id === id);
        const nextName = window.prompt('Rename Custom Map:', cur?.name || '');
        if (!nextName || !nextName.trim()) return;
        try {
          await renameCustomMap(id, nextName.trim());
          await this.refreshList();
        } catch (err) {
          window.alert(err instanceof Error ? err.message : String(err));
        }
      });
    });
    this.hostEl.querySelectorAll<HTMLButtonElement>('[data-cm-exp]').forEach((b) => {
      b.addEventListener('click', async () => {
        try {
          const pkg = await exportCustomMapPackage(b.dataset.cmExp!);
          triggerPackageDownload(pkg);
        } catch (err) {
          window.alert(err instanceof Error ? err.message : String(err));
        }
      });
    });
    this.hostEl.querySelectorAll<HTMLButtonElement>('[data-cm-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = b.dataset.cmDel!;
        const cur = this.maps.find((m) => m.id === id);
        if (!window.confirm(`Delete custom map "${cur?.name || id}" permanently?`)) return;
        try {
          await deleteCustomMap(id);
          await this.refreshList();
        } catch (err) {
          window.alert(err instanceof Error ? err.message : String(err));
        }
      });
    });
    this.hostEl.querySelectorAll<HTMLButtonElement>('[data-cm-toggle-view]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.cmToggleView!;
        if (this.previewTopdownIds.has(id)) this.previewTopdownIds.delete(id);
        else this.previewTopdownIds.add(id);
        this.render();
      });
    });
  }

  private renderCard(m: CustomMapMetadata & { previewDataUrl?: string; topdownDataUrl?: string }): string {
    const showTop = this.previewTopdownIds.has(m.id) && Boolean(m.topdownDataUrl);
    const imgUrl = showTop ? m.topdownDataUrl : m.previewDataUrl;
    const statusLabel =
      m.status === 'valid' ? 'READY' :
      m.status === 'warnings' ? `WARNINGS (${m.validationWarnings})` :
      m.status === 'errors' ? `ERRORS (${m.validationErrors})` : 'DRAFT';

    return `
      <div class="cm-card">
        <div class="cm-thumb-wrap">
          ${imgUrl
            ? `<img class="cm-thumb" src="${imgUrl}" alt="${this.esc(m.name)}" />`
            : `<div class="cm-thumb-fallback"><span>${this.esc(m.environmentPreset.toUpperCase())}</span><small>${m.dimensions.width}×${m.dimensions.depth}m</small></div>`}
          <span class="cm-status ${m.status}">${statusLabel}</span>
          ${m.hasAutosave ? `<span class="cm-auto-tag">AUTOSAVE</span>` : ''}
          ${m.topdownDataUrl ? `<button class="cm-view-flip" data-cm-toggle-view="${m.id}">${showTop ? '3D' : '2D Top'}</button>` : ''}
        </div>
        <div class="cm-card-body">
          <div class="cm-card-title">${this.esc(m.name)}</div>
          <div class="cm-card-desc">${this.esc(m.description || 'No description')}</div>
          <div class="cm-card-meta">
            <span>Size: <strong>${m.dimensions.width}×${m.dimensions.depth}m</strong></span>
            <span>Objects: <strong>${m.objectCount}</strong></span>
          </div>
          <div class="cm-card-dates">
            Created ${new Date(m.createdAt).toLocaleDateString()} · Edited ${new Date(m.updatedAt).toLocaleDateString()}
          </div>
          <div class="cm-mode-pills">
            ${m.supportedModes.map((id) => `<span class="cm-mpill">${id.toUpperCase()}</span>`).join('')}
          </div>
          <div class="cm-card-actions">
            <button class="os-btn primary small" data-cm-play="${m.id}">▶ Play</button>
            <button class="os-btn small" data-cm-edit="${m.id}">✎ Editor</button>
            <button class="os-btn small" data-cm-dup="${m.id}" title="Duplicate">⧉</button>
            <button class="os-btn small" data-cm-ren="${m.id}" title="Rename">Aa</button>
            <button class="os-btn small" data-cm-exp="${m.id}" title="Export Package">📤</button>
            <button class="os-btn danger small" data-cm-del="${m.id}" title="Delete">🗑</button>
          </div>
        </div>
      </div>
    `;
  }

  private async openInEditor(id: string): Promise<void> {
    try {
      const loaded = await loadCustomMap(id);
      sfx.playUi('open');
      this.callbacks.onOpenEditor(loaded.map, loaded.autosave ?? null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  private async openPlayModal(id: string): Promise<void> {
    try {
      const loaded = await loadCustomMap(id);
      const doc = loaded.map;
      const overlay = document.createElement('div');
      overlay.className = 'cm-modal-backdrop';
      overlay.innerHTML = `
        <div class="cm-modal">
          <div class="os-titlebar"><span>▶ Play Custom Map — ${this.esc(doc.name)}</span><button class="os-x" id="cmp-x">✕</button></div>
          <div class="cm-modal-body">
            ${doc.validationSummary.errors > 0 ? `<div class="ed-warn-box">⚠ This map currently has ${doc.validationSummary.errors} validation error(s). You can still launch it, or open it in the Editor to fix spawns/objectives.</div>` : ''}
            <label>Select Game Mode
              <select class="cm-select" id="cmp-mode">
                ${doc.supportedModes.map((mid) => `<option value="${mid}" ${mid === doc.primaryMode ? 'selected' : ''}>${getMode(mid).name}</option>`).join('')}
              </select>
            </label>
            <div id="cmp-mode-opts"></div>
          </div>
          <div class="cm-modal-foot">
            <button class="os-btn" id="cmp-cancel">Cancel</button>
            <button class="os-btn primary" id="cmp-go">▶ START MATCH</button>
          </div>
        </div>
      `;
      this.hostEl?.appendChild(overlay);

      const modeSel = overlay.querySelector('#cmp-mode') as HTMLSelectElement;
      const optsBox = overlay.querySelector('#cmp-mode-opts') as HTMLDivElement;
      const renderModeOpts = () => {
        const m = modeSel.value as ModeId;
        if (m === 'snd') {
          optsBox.innerHTML = `
            <div class="cm-grid-2">
              <label>Team Size <select class="cm-select" id="cmp-ts"><option value="3">3v3</option><option value="4">4v4</option><option value="5" selected>5v5</option></select></label>
              <label>Half Length <select class="cm-select" id="cmp-mr"><option value="4">MR4 (First to 5)</option><option value="6" selected>MR6 (First to 7)</option><option value="12">MR12 (First to 13)</option></select></label>
            </div>
          `;
        } else {
          const defBots = getMode(m).botCount;
          const defDur = getMode(m).duration;
          optsBox.innerHTML = `
            <div class="cm-grid-2">
              <label>Bot Count <input class="cm-input" id="cmp-bots" type="number" min="0" max="12" value="${defBots}" /></label>
              <label>Duration (sec) <input class="cm-input" id="cmp-dur" type="number" min="15" max="600" value="${Math.min(600, defDur)}" /></label>
            </div>
          `;
        }
      };
      renderModeOpts();
      modeSel.addEventListener('change', renderModeOpts);
      overlay.querySelector('#cmp-x')!.addEventListener('click', () => overlay.remove());
      overlay.querySelector('#cmp-cancel')!.addEventListener('click', () => overlay.remove());
      overlay.querySelector('#cmp-go')!.addEventListener('click', () => {
        const modeId = modeSel.value as ModeId;
        const botCount = Number((overlay.querySelector('#cmp-bots') as HTMLInputElement | null)?.value ?? 4);
        const duration = Number((overlay.querySelector('#cmp-dur') as HTMLInputElement | null)?.value ?? 60);
        const teamSize = Number((overlay.querySelector('#cmp-ts') as HTMLSelectElement | null)?.value ?? 5);
        const roundsPerHalf = Number((overlay.querySelector('#cmp-mr') as HTMLSelectElement | null)?.value ?? 6);
        overlay.remove();
        this.callbacks.onPlayCustomMap({
          document: doc,
          modeId,
          botCount,
          duration,
          teamSize,
          roundsPerHalf,
          isTestPlay: false,
        });
      });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  private openCreateModal(): void {
    const overlay = document.createElement('div');
    overlay.className = 'cm-modal-backdrop';
    overlay.innerHTML = `
      <div class="cm-modal cm-modal-wide">
        <div class="os-titlebar"><span>+ Create New Custom Map</span><button class="os-x" id="cmc-x">✕</button></div>
        <div class="cm-modal-body">
          <div class="cm-grid-2">
            <label>Map Name <input class="cm-input" id="cmc-name" type="text" maxlength="64" value="New Arena" /></label>
            <label>Dimensions
              <select class="cm-select" id="cmc-size">
                <option value="44x44">Small (44 × 44m)</option>
                <option value="64x64" selected>Medium (64 × 64m)</option>
                <option value="84x84">Large (84 × 84m)</option>
                <option value="108x108">XL (108 × 108m)</option>
              </select>
            </label>
          </div>
          <label>Map Description <input class="cm-input" id="cmc-desc" type="text" maxlength="160" value="Tactical custom map created in Pure Skill Map Studio." /></label>
          <div class="cm-grid-3">
            <label>Environment Preset
              <select class="cm-select" id="cmc-env">
                ${ENVIRONMENT_PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}
              </select>
            </label>
            <label>Starting Ground Type
              <select class="cm-select" id="cmc-ground">
                ${(Object.keys(GROUND_MATERIAL_PRESETS) as GroundTypeId[]).map((g) => `<option value="${g}">${GROUND_MATERIAL_PRESETS[g].label}</option>`).join('')}
              </select>
            </label>
            <label>Initial Lighting Preset
              <select class="cm-select" id="cmc-light">
                ${(Object.keys(LIGHTING_PRESETS) as LightingPresetId[]).map((l) => `<option value="${l}">${LIGHTING_PRESETS[l].label}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="cm-preset-desc" id="cmc-env-desc">${ENVIRONMENT_PRESETS[0].description}</div>
          <div>
            <div class="dim" style="margin-bottom:4px">Available Game Modes:</div>
            <div class="cm-mode-checks">
              ${MODES.map((m) => `
                <label><input type="checkbox" data-cmc-mode="${m.id}" ${['dm', 'arena', 'snd'].includes(m.id) ? 'checked' : ''} /> ${m.name}</label>
              `).join('')}
            </div>
          </div>
          <div class="cm-error-msg hidden" id="cmc-err"></div>
        </div>
        <div class="cm-modal-foot">
          <button class="os-btn" id="cmc-cancel">Cancel</button>
          <button class="os-btn primary" id="cmc-submit">Create & Open in Editor ▶</button>
        </div>
      </div>
    `;
    this.hostEl?.appendChild(overlay);

    const envSel = overlay.querySelector('#cmc-env') as HTMLSelectElement;
    const gndSel = overlay.querySelector('#cmc-ground') as HTMLSelectElement;
    const lgtSel = overlay.querySelector('#cmc-light') as HTMLSelectElement;
    const descBox = overlay.querySelector('#cmc-env-desc') as HTMLDivElement;

    envSel.addEventListener('change', () => {
      const p = ENVIRONMENT_PRESETS.find((x) => x.id === envSel.value);
      if (p) {
        gndSel.value = p.defaultGround;
        lgtSel.value = p.defaultLighting;
        descBox.textContent = p.description;
      }
    });

    overlay.querySelector('#cmc-x')!.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#cmc-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#cmc-submit')!.addEventListener('click', async () => {
      const name = (overlay.querySelector('#cmc-name') as HTMLInputElement).value.trim();
      const desc = (overlay.querySelector('#cmc-desc') as HTMLInputElement).value.trim();
      const [wStr, dStr] = (overlay.querySelector('#cmc-size') as HTMLSelectElement).value.split('x');
      const modes = Array.from(overlay.querySelectorAll<HTMLInputElement>('[data-cmc-mode]:checked')).map((c) => c.dataset.cmcMode as ModeId);
      const errBox = overlay.querySelector('#cmc-err') as HTMLDivElement;
      if (!name) {
        errBox.textContent = 'Please enter a map name.';
        errBox.classList.remove('hidden');
        return;
      }
      if (modes.length === 0) {
        errBox.textContent = 'Select at least one supported game mode.';
        errBox.classList.remove('hidden');
        return;
      }

      const newDoc = createNewCustomMapDocument({
        name,
        description: desc,
        width: Number(wStr) || 64,
        depth: Number(dStr) || 64,
        environmentPreset: envSel.value as EnvironmentPresetId,
        groundType: gndSel.value as GroundTypeId,
        lightingPreset: lgtSel.value as LightingPresetId,
        supportedModes: modes,
      });

      try {
        await saveCustomMap(newDoc, { createOnly: true, allowDuplicateName: false });
        overlay.remove();
        sfx.playUi('open');
        this.callbacks.onOpenEditor(newDoc, null);
      } catch (err) {
        errBox.textContent = err instanceof Error ? err.message : String(err);
        errBox.classList.remove('hidden');
      }
    });
  }

  private async handleImportText(rawText: string, conflictMode: 'ask' | 'rename' | 'overwrite' = 'ask'): Promise<void> {
    const res = await importCustomMapPackage(rawText, KNOWN_ASSET_IDS, conflictMode);
    if (res.conflict) {
      const choice = window.prompt(
        `${res.message}\nType "rename" to import as a copy, "overwrite" to replace existing, or Cancel:`,
        'rename',
      );
      if (choice === 'rename' || choice === 'overwrite') {
        await this.handleImportText(rawText, choice);
      }
      return;
    }
    if (!res.ok) {
      window.alert(`Import rejected:\n${(res.errors || [res.message]).join('\n')}`);
      return;
    }
    if (res.warnings && res.warnings.length > 0) {
      window.alert(`Imported with warnings:\n${res.warnings.join('\n')}`);
    }
    await this.refreshList();
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
