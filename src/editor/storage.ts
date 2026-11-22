import { DEFAULT_MATERIAL_LIBRARY, deepClone } from './presets';
import {
  CUSTOM_MAP_PACKAGE_VERSION,
  CustomMapDocument,
  CustomMapMetadata,
  CustomMapPackage,
  EditorLibraryData,
  MaterialPreset,
  PrefabDef,
} from './types';

const FALLBACK_MAPS_KEY = 'pso_custom_maps_fallback_v1';
const FALLBACK_AUTOSAVES_KEY = 'pso_custom_maps_autosaves_v1';
const FALLBACK_LIB_KEY = 'pso_custom_maps_library_v1';

function isLocalHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m172 = /^172\.(\d+)\./.exec(h);
  return Boolean(m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31);
}

function useBrowserOnlyStorage(): boolean {
  return typeof window !== 'undefined' && !isLocalHost(window.location.hostname);
}

export interface CustomMapsListResponse {
  maps: Array<CustomMapMetadata & { previewDataUrl?: string; topdownDataUrl?: string }>;
  corruptedMaps: Array<{ id: string; error: string; details?: string }>;
  storageMode: 'disk' | 'local_fallback';
}

export interface LoadMapResponse {
  map: CustomMapDocument;
  metadata: CustomMapMetadata;
  recoveredFromBackup?: boolean;
  autosave?: { savedAt: string; doc: CustomMapDocument } | null;
}

export interface ImportConflictError {
  conflict: true;
  message: string;
  existingId?: string;
  existingName?: string;
  warnings: string[];
}

export interface ImportResult {
  ok: boolean;
  conflict?: boolean;
  message?: string;
  errors?: string[];
  warnings?: string[];
  missingAssets?: string[];
  metadata?: CustomMapMetadata;
  map?: CustomMapDocument;
}

function readLocalFallbackMaps(): Record<string, CustomMapDocument> {
  try {
    const raw = localStorage.getItem(FALLBACK_MAPS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CustomMapDocument>) : {};
  } catch {
    return {};
  }
}

function writeLocalFallbackMaps(maps: Record<string, CustomMapDocument>): void {
  try {
    localStorage.setItem(FALLBACK_MAPS_KEY, JSON.stringify(maps));
  } catch {
    // ignore quota issues
  }
}

function toMeta(doc: CustomMapDocument): CustomMapMetadata & { previewDataUrl?: string; topdownDataUrl?: string } {
  return {
    formatVersion: doc.formatVersion,
    id: doc.id,
    name: doc.name,
    description: doc.description,
    author: doc.author,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    dimensions: doc.dimensions,
    environmentPreset: doc.environmentPreset,
    groundType: doc.groundType,
    supportedModes: doc.supportedModes,
    primaryMode: doc.primaryMode,
    status: doc.status,
    objectCount: doc.objects.length,
    hasThumbnail: Boolean(doc.thumbnails?.previewDataUrl),
    hasTopdown: Boolean(doc.thumbnails?.topdownDataUrl),
    validationErrors: doc.validationSummary?.errors ?? 0,
    validationWarnings: doc.validationSummary?.warnings ?? 0,
    previewDataUrl: doc.thumbnails?.previewDataUrl,
    topdownDataUrl: doc.thumbnails?.topdownDataUrl,
  };
}

function readBrowserAutosave(id: string): { savedAt: string; doc: CustomMapDocument } | null {
  try {
    const raw = localStorage.getItem(FALLBACK_AUTOSAVES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string; savedAt?: string; doc?: CustomMapDocument };
    if (parsed && parsed.id === id && parsed.savedAt && parsed.doc) {
      return { savedAt: parsed.savedAt, doc: parsed.doc };
    }
  } catch {
    // ignore broken autosave
  }
  return null;
}

function clearBrowserAutosave(id: string): void {
  try {
    const raw = localStorage.getItem(FALLBACK_AUTOSAVES_KEY);
    if (raw && JSON.parse(raw).id === id) localStorage.removeItem(FALLBACK_AUTOSAVES_KEY);
  } catch {
    // ignore
  }
}

function readBrowserLibrary(): EditorLibraryData {
  try {
    const raw = localStorage.getItem(FALLBACK_LIB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as EditorLibraryData;
      return {
        prefabs: parsed.prefabs || [],
        materialPresets: parsed.materialPresets?.length ? parsed.materialPresets : deepClone(DEFAULT_MATERIAL_LIBRARY),
      };
    }
  } catch {
    // ignore
  }
  return { prefabs: [], materialPresets: deepClone(DEFAULT_MATERIAL_LIBRARY) };
}

function writeBrowserLibrary(lib: EditorLibraryData): void {
  try {
    localStorage.setItem(FALLBACK_LIB_KEY, JSON.stringify(lib));
  } catch {
    // ignore
  }
}

export async function listCustomMaps(): Promise<CustomMapsListResponse> {
  if (!useBrowserOnlyStorage()) {
    try {
      const res = await fetch('/api/custom-maps');
      if (res.ok) {
        const json = (await res.json()) as {
          maps: Array<CustomMapMetadata & { previewDataUrl?: string; topdownDataUrl?: string }>;
          corruptedMaps: Array<{ id: string; error: string; details?: string }>;
        };
        return { maps: json.maps || [], corruptedMaps: json.corruptedMaps || [], storageMode: 'disk' };
      }
    } catch {
      // fall through to localStorage fallback
    }
  }
  const all = Object.values(readLocalFallbackMaps())
    .map(toMeta)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { maps: all, corruptedMaps: [], storageMode: 'local_fallback' };
}

export async function loadCustomMap(id: string): Promise<LoadMapResponse> {
  if (!useBrowserOnlyStorage()) {
    try {
      const res = await fetch(`/api/custom-maps/${encodeURIComponent(id)}`);
      if (res.ok) {
        return (await res.json()) as LoadMapResponse;
      }
      const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
      if (res.status === 422 || res.status === 400) {
        throw new Error(err.message || 'Corrupted or invalid custom map file.');
      }
    } catch (e) {
      if (e instanceof Error && e.message.toLowerCase().includes('corrupt')) throw e;
    }
  }

  const fb = readLocalFallbackMaps()[id];
  if (fb) {
    return { map: deepClone(fb), metadata: toMeta(fb), autosave: readBrowserAutosave(id) };
  }
  throw new Error(`Custom map "${id}" could not be loaded.`);
}

export async function saveCustomMap(
  doc: CustomMapDocument,
  opts?: { createOnly?: boolean; allowDuplicateName?: boolean },
): Promise<{ ok: boolean; metadata: CustomMapMetadata; map: CustomMapDocument }> {
  const payload = {
    map: { ...doc, updatedAt: new Date().toISOString() },
    createOnly: Boolean(opts?.createOnly),
    allowDuplicateName: opts?.allowDuplicateName ?? true,
  };
  if (useBrowserOnlyStorage()) {
    const maps = readLocalFallbackMaps();
    if (opts?.createOnly && maps[doc.id]) {
      throw new Error(`Map "${doc.id}" already exists.`);
    }
    const cleanName = doc.name.trim().toLowerCase();
    const dupName = Object.values(maps).some((m) => m.id !== doc.id && m.name.trim().toLowerCase() === cleanName);
    if (dupName && (opts?.createOnly || opts?.allowDuplicateName === false)) {
      throw new Error(`A map named "${doc.name}" already exists.`);
    }
    const savedDoc = payload.map;
    maps[savedDoc.id] = savedDoc;
    writeLocalFallbackMaps(maps);
    clearBrowserAutosave(savedDoc.id);
    return { ok: true, metadata: toMeta(savedDoc), map: savedDoc };
  }
  try {
    const res = await fetch(`/api/custom-maps/${encodeURIComponent(doc.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.message || json.error || `Save failed (${res.status})`);
    }
    const maps = readLocalFallbackMaps();
    maps[json.map.id] = json.map;
    writeLocalFallbackMaps(maps);
    return json;
  } catch (err) {
    if (err instanceof Error && (err.message.includes('already exists') || err.message.includes('DUPLICATE') || err.message.includes('VALIDATION'))) {
      throw err;
    }
    // Offline fallback
    const savedDoc = payload.map;
    const maps = readLocalFallbackMaps();
    maps[savedDoc.id] = savedDoc;
    writeLocalFallbackMaps(maps);
    clearBrowserAutosave(savedDoc.id);
    return { ok: true, metadata: toMeta(savedDoc), map: savedDoc };
  }
}

export async function saveAutosave(doc: CustomMapDocument): Promise<void> {
  try {
    localStorage.setItem(FALLBACK_AUTOSAVES_KEY, JSON.stringify({ id: doc.id, savedAt: new Date().toISOString(), doc }));
  } catch {
    // ignore
  }
  if (useBrowserOnlyStorage()) return;
  try {
    await fetch(`/api/custom-maps/${encodeURIComponent(doc.id)}/autosave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
  } catch {
    // non-fatal
  }
}

export async function clearAutosave(id: string): Promise<void> {
  clearBrowserAutosave(id);
  if (useBrowserOnlyStorage()) return;
  try {
    await fetch(`/api/custom-maps/${encodeURIComponent(id)}/autosave`, { method: 'DELETE' });
  } catch {
    // ignore
  }
}

export async function duplicateCustomMap(id: string, name?: string): Promise<CustomMapDocument> {
  if (useBrowserOnlyStorage()) {
    const maps = readLocalFallbackMaps();
    const src = maps[id];
    if (!src) throw new Error('Map not found.');
    const allMaps = Object.values(maps);
    let copyName = name?.trim() || `${src.name} (Copy)`;
    let n = 2;
    while (allMaps.some((m) => m.name.toLowerCase() === copyName.toLowerCase())) {
      copyName = `${src.name} (Copy ${n++})`;
    }
    let copyId = `${id}_copy_${Date.now().toString(36).slice(-4)}`;
    while (maps[copyId]) {
      copyId = `${id}_copy_${Date.now().toString(36)}_${n++}`;
    }
    const now = new Date().toISOString();
    const dupDoc: CustomMapDocument = {
      ...deepClone(src),
      id: copyId,
      name: copyName,
      createdAt: now,
      updatedAt: now,
    };
    maps[copyId] = dupDoc;
    writeLocalFallbackMaps(maps);
    return dupDoc;
  }
  const res = await fetch(`/api/custom-maps/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || 'Duplicate failed.');
  return json.map as CustomMapDocument;
}

export async function renameCustomMap(id: string, newName: string): Promise<CustomMapDocument> {
  if (useBrowserOnlyStorage()) {
    const maps = readLocalFallbackMaps();
    const src = maps[id];
    if (!src) throw new Error('Map not found.');
    const trimmed = newName.trim();
    if (!trimmed || trimmed.length > 80) {
      throw new Error('New map name must be 1..80 characters.');
    }
    if (Object.values(maps).some((m) => m.id !== id && m.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`Another map named "${trimmed}" already exists.`);
    }
    const updated: CustomMapDocument = { ...src, name: trimmed, updatedAt: new Date().toISOString() };
    maps[id] = updated;
    writeLocalFallbackMaps(maps);
    return updated;
  }
  const res = await fetch(`/api/custom-maps/${encodeURIComponent(id)}/rename`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || 'Rename failed.');
  return json.map as CustomMapDocument;
}

export async function deleteCustomMap(id: string): Promise<void> {
  const maps = readLocalFallbackMaps();
  delete maps[id];
  writeLocalFallbackMaps(maps);
  clearBrowserAutosave(id);
  if (useBrowserOnlyStorage()) return;
  const res = await fetch(`/api/custom-maps/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message || 'Delete failed.');
  }
}

export async function exportCustomMapPackage(id: string): Promise<CustomMapPackage> {
  if (useBrowserOnlyStorage()) {
    const doc = readLocalFallbackMaps()[id];
    if (!doc) throw new Error('Cannot export missing map.');
    const lib = readBrowserLibrary();
    const usedPrefabs = new Set((doc.objects || []).map((o) => o.prefabId).filter(Boolean));
    return {
      packageType: 'pure-skill-custom-map',
      packageVersion: CUSTOM_MAP_PACKAGE_VERSION,
      exportedAt: new Date().toISOString(),
      checksum: 'browser-local',
      map: deepClone(doc),
      prefabs: lib.prefabs.filter((p) => usedPrefabs.has(p.id)),
      materialPresets: lib.materialPresets,
    };
  }
  const res = await fetch(`/api/custom-maps/${encodeURIComponent(id)}/export`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || 'Export failed.');
  return json as CustomMapPackage;
}

export async function importCustomMapPackage(
  rawJsonText: string,
  knownAssetIds: string[],
  conflictMode: 'ask' | 'rename' | 'overwrite' = 'ask',
): Promise<ImportResult> {
  let pkg: unknown;
  try {
    pkg = JSON.parse(rawJsonText);
  } catch {
    return { ok: false, message: 'Corrupted map file: invalid JSON syntax.', errors: ['Invalid JSON syntax.'] };
  }

  if (useBrowserOnlyStorage()) {
    const obj = pkg as Partial<CustomMapPackage>;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, message: 'Package root must be a valid JSON object.', errors: ['Invalid package root.'] };
    }
    if (obj.packageType !== 'pure-skill-custom-map' || typeof obj.packageVersion !== 'number' || obj.packageVersion > CUSTOM_MAP_PACKAGE_VERSION) {
      return { ok: false, message: 'Unsupported custom map package format.', errors: ['Unsupported package header.'] };
    }
    const m = obj.map;
    if (!m || typeof m.id !== 'string' || typeof m.name !== 'string' || !m.dimensions || !Array.isArray(m.objects) || !m.terrain || !Array.isArray(m.terrain.heights) || !m.lighting || !m.boundaries) {
      return { ok: false, message: 'Map package is missing required fields.', errors: ['Missing required map structure.'] };
    }
    const knownSet = new Set(knownAssetIds || []);
    const missingAssets = Array.from(new Set(m.objects.map((o) => o?.assetId).filter((a): a is string => Boolean(a) && knownSet.size > 0 && !knownSet.has(a))));
    const warnings = missingAssets.length > 0 ? [`Unknown/missing asset references: ${missingAssets.join(', ')}`] : [];

    const maps = readLocalFallbackMaps();
    const idExists = Boolean(maps[m.id]);
    const nameExists = Object.values(maps).some((ex) => ex.id !== m.id && ex.name.toLowerCase() === m.name.trim().toLowerCase());
    if ((idExists || nameExists) && conflictMode === 'ask') {
      return {
        ok: false,
        conflict: true,
        message: idExists ? `A custom map with ID "${m.id}" already exists.` : `A custom map named "${m.name}" already exists.`,
        warnings,
      };
    }

    const incomingDoc = deepClone(m);
    if ((idExists || nameExists) && conflictMode === 'rename') {
      let n = 2;
      let candidateName = `${incomingDoc.name} (${n})`;
      while (Object.values(maps).some((ex) => ex.name.toLowerCase() === candidateName.toLowerCase())) {
        n++;
        candidateName = `${incomingDoc.name} (${n})`;
      }
      let candidateId = `${incomingDoc.id || 'imported'}_${n}`;
      while (maps[candidateId]) {
        n++;
        candidateId = `${incomingDoc.id || 'imported'}_${n}`;
      }
      incomingDoc.id = candidateId;
      incomingDoc.name = candidateName;
    }
    incomingDoc.updatedAt = new Date().toISOString();
    maps[incomingDoc.id] = incomingDoc;
    writeLocalFallbackMaps(maps);

    if (Array.isArray(obj.prefabs) || Array.isArray(obj.materialPresets)) {
      const lib = readBrowserLibrary();
      if (Array.isArray(obj.prefabs)) {
        const pMap = new Map(lib.prefabs.map((p) => [p.id, p]));
        for (const p of obj.prefabs) if (p?.id && !pMap.has(p.id)) pMap.set(p.id, p);
        lib.prefabs = [...pMap.values()];
      }
      if (Array.isArray(obj.materialPresets)) {
        const mMap = new Map(lib.materialPresets.map((mp) => [mp.id, mp]));
        for (const mp of obj.materialPresets) if (mp?.id && !mMap.has(mp.id)) mMap.set(mp.id, mp);
        lib.materialPresets = [...mMap.values()];
      }
      writeBrowserLibrary(lib);
    }

    return { ok: true, metadata: toMeta(incomingDoc), map: incomingDoc, warnings, missingAssets };
  }

  const res = await fetch('/api/custom-maps/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ package: pkg, knownAssetIds, conflictMode }),
  });
  const json = await res.json();
  if (res.status === 409) {
    return {
      ok: false,
      conflict: true,
      message: json.message,
      warnings: json.warnings || [],
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      message: json.message || json.error || 'Import validation failed.',
      errors: json.errors || [json.message],
      warnings: json.warnings || [],
      missingAssets: json.missingAssets || [],
    };
  }
  return json as ImportResult;
}

export async function loadEditorLibrary(): Promise<EditorLibraryData> {
  if (!useBrowserOnlyStorage()) {
    try {
      const res = await fetch('/api/custom-maps/_library');
      if (res.ok) {
        const json = (await res.json()) as { prefabs?: PrefabDef[]; materialPresets?: MaterialPreset[] };
        return {
          prefabs: Array.isArray(json.prefabs) ? json.prefabs : [],
          materialPresets: Array.isArray(json.materialPresets) && json.materialPresets.length > 0
            ? json.materialPresets
            : deepClone(DEFAULT_MATERIAL_LIBRARY),
        };
      }
    } catch {
      // fallback
    }
  }
  return readBrowserLibrary();
}

export async function saveEditorLibrary(lib: EditorLibraryData): Promise<void> {
  writeBrowserLibrary(lib);
  if (useBrowserOnlyStorage()) return;
  try {
    await fetch('/api/custom-maps/_library', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lib),
    });
  } catch {
    // ignore
  }
}

export function triggerPackageDownload(pkg: CustomMapPackage): void {
  const safeFile = `${pkg.map.id || 'custom_map'}.psomap.json`;
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
