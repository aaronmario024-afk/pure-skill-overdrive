import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAP_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const FILENAME_SAFE_RE = /^[a-zA-Z0-9_.-]{1,64}$/;

export function sanitizeMapId(rawId) {
  if (typeof rawId !== 'string') return null;
  const trimmed = rawId.trim();
  if (!trimmed || trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return null;
  }
  if (!MAP_ID_RE.test(trimmed) || trimmed.startsWith('_')) return null;
  return trimmed;
}

export function assertInsideRoot(rootDir, targetPath) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`PATH_TRAVERSAL_BLOCKED: ${targetPath}`);
  }
  return resolvedTarget;
}

export function atomicWriteFileSync(filePath, data, { backup = true } = {}) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const fd = fs.openSync(tmpPath, 'w');
  try {
    if (Buffer.isBuffer(data)) {
      fs.writeSync(fd, data, 0, data.length, 0);
    } else {
      const buf = Buffer.from(String(data), 'utf8');
      fs.writeSync(fd, buf, 0, buf.length, 0);
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  if (backup && fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    } catch {
      // ignore backup copy failures on first write
    }
  }
  fs.renameSync(tmpPath, filePath);
}

export function computeMapChecksum(mapDoc) {
  const copy = { ...mapDoc };
  delete copy.checksum;
  delete copy.thumbnails;
  const canonical = JSON.stringify(copy);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function validateMapDocumentStructure(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['Map payload must be a JSON object.'];
  }
  if (typeof doc.formatVersion !== 'number' || doc.formatVersion < 1) {
    errors.push('Missing or invalid formatVersion.');
  }
  if (!sanitizeMapId(doc.id)) {
    errors.push('Invalid map id (must match [a-zA-Z0-9_-]{1,64}).');
  }
  if (typeof doc.name !== 'string' || doc.name.trim().length < 1 || doc.name.trim().length > 80) {
    errors.push('Map name must be 1..80 characters.');
  }
  if (!doc.dimensions || typeof doc.dimensions.width !== 'number' || typeof doc.dimensions.depth !== 'number') {
    errors.push('Invalid map dimensions.');
  } else if (
    !Number.isFinite(doc.dimensions.width) ||
    !Number.isFinite(doc.dimensions.depth) ||
    doc.dimensions.width < 16 ||
    doc.dimensions.depth < 16 ||
    doc.dimensions.width > 400 ||
    doc.dimensions.depth > 400
  ) {
    errors.push('Map width/depth must be finite numbers between 16 and 400 meters.');
  }
  if (!Array.isArray(doc.objects)) {
    errors.push('Map objects must be an array.');
  } else {
    for (let i = 0; i < doc.objects.length; i++) {
      const o = doc.objects[i];
      if (!o || typeof o !== 'object' || typeof o.id !== 'string' || typeof o.assetId !== 'string') {
        errors.push(`Object #${i} is missing id or assetId.`);
        continue;
      }
      if (o.assetId.includes('..') || o.assetId.includes('/') || o.assetId.includes('\\')) {
        errors.push(`Object ${o.id} has unsafe assetId path.`);
      }
      for (const vecKey of ['position', 'rotation', 'scale']) {
        const v = o[vecKey];
        if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
          errors.push(`Object ${o.id} has invalid ${vecKey}.`);
        }
      }
    }
  }
  if (!doc.terrain || typeof doc.terrain !== 'object' || !Array.isArray(doc.terrain.heights)) {
    errors.push('Map terrain data is missing or invalid.');
  }
  if (!doc.lighting || typeof doc.lighting !== 'object') {
    errors.push('Map lighting configuration is missing.');
  }
  if (!doc.boundaries || typeof doc.boundaries !== 'object') {
    errors.push('Map boundaries configuration is missing.');
  }
  return errors;
}

export function validateImportPackage(pkg, knownAssetIds) {
  const errors = [];
  const warnings = [];
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return { valid: false, errors: ['Package root must be a valid JSON object.'], warnings, missingAssets: [] };
  }
  if (pkg.packageType !== 'pure-skill-custom-map') {
    errors.push(`Unsupported packageType: ${String(pkg.packageType ?? 'missing')}.`);
  }
  if (typeof pkg.packageVersion !== 'number' || pkg.packageVersion > 1) {
    errors.push(`Incompatible packageVersion: ${String(pkg.packageVersion ?? 'missing')}.`);
  }
  if (!pkg.map) {
    errors.push('Package does not contain a map document.');
    return { valid: false, errors, warnings, missingAssets: [] };
  }
  const structErrors = validateMapDocumentStructure(pkg.map);
  errors.push(...structErrors);

  if (typeof pkg.checksum === 'string' && pkg.checksum.length > 0 && structErrors.length === 0) {
    const expected = computeMapChecksum(pkg.map);
    if (pkg.checksum !== expected) {
      errors.push('Checksum verification failed — file appears corrupted or modified.');
    }
  }

  const missingAssets = [];
  if (Array.isArray(knownAssetIds) && knownAssetIds.length > 0 && Array.isArray(pkg.map.objects)) {
    const knownSet = new Set(knownAssetIds);
    for (const o of pkg.map.objects) {
      if (o && typeof o.assetId === 'string' && !knownSet.has(o.assetId)) {
        missingAssets.push(o.assetId);
      }
    }
    if (missingAssets.length > 0) {
      warnings.push(`Unknown/missing asset references: ${Array.from(new Set(missingAssets)).join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missingAssets: Array.from(new Set(missingAssets)),
  };
}

function readJsonSafeWithBackup(filePath) {
  const tryParse = (p) => {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    const errs = validateMapDocumentStructure(parsed);
    if (errs.length > 0) {
      throw new Error(errs.join('; '));
    }
    return parsed;
  };

  try {
    const primary = tryParse(filePath);
    if (primary) return { ok: true, data: primary, recoveredFromBackup: false };
    return { ok: false, error: 'NOT_FOUND' };
  } catch (primaryErr) {
    const bakPath = `${filePath}.bak`;
    try {
      const backup = tryParse(bakPath);
      if (backup) {
        return { ok: true, data: backup, recoveredFromBackup: true };
      }
    } catch {
      // ignore backup failure and report corrupted
    }
    return { ok: false, error: 'CORRUPTED_MAP_FILE', details: String(primaryErr) };
  }
}

function decodePngDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  return Buffer.from(m[1], 'base64');
}

function encodePngToDataUrl(pngPath) {
  if (!fs.existsSync(pngPath)) return undefined;
  const buf = fs.readFileSync(pngPath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function buildMetadataSummary(doc, mapDir, recoveredFromBackup = false) {
  const thumbPreview = path.join(mapDir, 'thumbnails', 'preview.png');
  const thumbTop = path.join(mapDir, 'thumbnails', 'topdown.png');
  const autosavePath = path.join(mapDir, 'autosave.json');
  let hasAutosave = false;
  let autosaveAt;
  if (fs.existsSync(autosavePath)) {
    try {
      const autoRaw = JSON.parse(fs.readFileSync(autosavePath, 'utf8'));
      if (autoRaw && autoRaw.savedAt) {
        hasAutosave = true;
        autosaveAt = autoRaw.savedAt;
      }
    } catch {
      // ignore broken autosave
    }
  }
  return {
    formatVersion: doc.formatVersion,
    id: doc.id,
    name: doc.name,
    description: doc.description || '',
    author: doc.author || 'Player',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    dimensions: doc.dimensions,
    environmentPreset: doc.environmentPreset,
    groundType: doc.groundType,
    supportedModes: doc.supportedModes || ['dm'],
    primaryMode: doc.primaryMode || (doc.supportedModes?.[0] ?? 'dm'),
    status: doc.status || 'draft',
    objectCount: Array.isArray(doc.objects) ? doc.objects.length : 0,
    hasThumbnail: Boolean(doc.thumbnails?.previewDataUrl || fs.existsSync(thumbPreview)),
    hasTopdown: Boolean(doc.thumbnails?.topdownDataUrl || fs.existsSync(thumbTop)),
    validationErrors: doc.validationSummary?.errors ?? 0,
    validationWarnings: doc.validationSummary?.warnings ?? 0,
    hasAutosave,
    autosaveAt,
    recoveredFromBackup,
  };
}

function readJsonBody(req, limitBytes = 24 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limitBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const txt = Buffer.concat(chunks).toString('utf8');
      if (!txt.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(txt));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export function createCustomMapsHandler(rootDir, opts = {}) {
  const customMapsRoot = path.resolve(opts.customMapsDir || path.join(rootDir, 'CustomMaps'));
  const libraryDir = path.join(customMapsRoot, '_library');
  fs.mkdirSync(customMapsRoot, { recursive: true });
  fs.mkdirSync(libraryDir, { recursive: true });

  const listAllMapsOnDisk = () => {
    const maps = [];
    const corruptedMaps = [];
    if (!fs.existsSync(customMapsRoot)) return { maps, corruptedMaps };
    const entries = fs.readdirSync(customMapsRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('_')) continue;
      const safeId = sanitizeMapId(ent.name);
      if (!safeId) continue;
      const mapDir = path.join(customMapsRoot, safeId);
      const mapFile = path.join(mapDir, 'map.json');
      if (!fs.existsSync(mapFile) && !fs.existsSync(`${mapFile}.bak`)) continue;
      const res = readJsonSafeWithBackup(mapFile);
      if (!res.ok) {
        corruptedMaps.push({ id: safeId, error: res.error, details: res.details });
        continue;
      }
      const doc = res.data;
      const meta = buildMetadataSummary(doc, mapDir, res.recoveredFromBackup);
      const previewUrl = encodePngToDataUrl(path.join(mapDir, 'thumbnails', 'preview.png')) || doc.thumbnails?.previewDataUrl;
      const topdownUrl = encodePngToDataUrl(path.join(mapDir, 'thumbnails', 'topdown.png')) || doc.thumbnails?.topdownDataUrl;
      maps.push({
        ...meta,
        previewDataUrl: previewUrl,
        topdownDataUrl: topdownUrl,
      });
    }
    maps.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return { maps, corruptedMaps };
  };

  const writeFullMapToDisk = (mapDoc) => {
    const safeId = sanitizeMapId(mapDoc.id);
    if (!safeId) throw new Error('INVALID_MAP_ID');
    const mapDir = assertInsideRoot(customMapsRoot, path.join(customMapsRoot, safeId));
    const thumbDir = path.join(mapDir, 'thumbnails');
    const objDir = path.join(mapDir, 'objects');
    const assetDir = path.join(mapDir, 'assets');
    fs.mkdirSync(thumbDir, { recursive: true });
    fs.mkdirSync(objDir, { recursive: true });
    fs.mkdirSync(assetDir, { recursive: true });

    const docToSave = {
      ...mapDoc,
      id: safeId,
      updatedAt: mapDoc.updatedAt || new Date().toISOString(),
    };

    const previewBuf = decodePngDataUrl(docToSave.thumbnails?.previewDataUrl);
    if (previewBuf) {
      atomicWriteFileSync(path.join(thumbDir, 'preview.png'), previewBuf, { backup: false });
    }
    const topBuf = decodePngDataUrl(docToSave.thumbnails?.topdownDataUrl);
    if (topBuf) {
      atomicWriteFileSync(path.join(thumbDir, 'topdown.png'), topBuf, { backup: false });
    }

    docToSave.checksum = computeMapChecksum(docToSave);
    const mapFile = path.join(mapDir, 'map.json');
    atomicWriteFileSync(mapFile, JSON.stringify(docToSave, null, 2), { backup: true });

    // Clean any leftover autosave after an explicit save
    const autoFile = path.join(mapDir, 'autosave.json');
    if (fs.existsSync(autoFile)) {
      try {
        fs.unlinkSync(autoFile);
      } catch {
        // ignore
      }
    }

    const metadata = buildMetadataSummary(docToSave, mapDir, false);
    atomicWriteFileSync(path.join(mapDir, 'metadata.json'), JSON.stringify(metadata, null, 2), { backup: false });
    return { doc: docToSave, metadata };
  };

  return async function handleCustomMapsReq(req, res, next) {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const pathname = decodeURIComponent(urlObj.pathname);
    if (!pathname.startsWith('/api/custom-maps')) {
      if (typeof next === 'function') next();
      return false;
    }

    try {
      const subPath = pathname.slice('/api/custom-maps'.length);

      // GET /api/custom-maps
      if ((subPath === '' || subPath === '/') && req.method === 'GET') {
        const listing = listAllMapsOnDisk();
        sendJson(res, 200, listing);
        return true;
      }

      // GET / PUT /api/custom-maps/_library
      if (subPath === '/_library') {
        const prefabsPath = path.join(libraryDir, 'prefabs.json');
        const matsPath = path.join(libraryDir, 'materials.json');
        if (req.method === 'GET') {
          let prefabs = [];
          let materialPresets = [];
          try {
            if (fs.existsSync(prefabsPath)) prefabs = JSON.parse(fs.readFileSync(prefabsPath, 'utf8'));
          } catch { prefabs = []; }
          try {
            if (fs.existsSync(matsPath)) materialPresets = JSON.parse(fs.readFileSync(matsPath, 'utf8'));
          } catch { materialPresets = []; }
          sendJson(res, 200, { prefabs, materialPresets });
          return true;
        }
        if (req.method === 'PUT') {
          const body = await readJsonBody(req);
          const prefabs = Array.isArray(body.prefabs) ? body.prefabs : [];
          const materialPresets = Array.isArray(body.materialPresets) ? body.materialPresets : [];
          atomicWriteFileSync(prefabsPath, JSON.stringify(prefabs, null, 2), { backup: true });
          atomicWriteFileSync(matsPath, JSON.stringify(materialPresets, null, 2), { backup: true });
          sendJson(res, 200, { ok: true, prefabsCount: prefabs.length, materialPresetsCount: materialPresets.length });
          return true;
        }
      }

      // POST /api/custom-maps/import
      if (subPath === '/import' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const pkg = body.package;
        const conflictMode = body.conflictMode || 'ask'; // 'ask' | 'rename' | 'overwrite'
        const knownAssetIds = Array.isArray(body.knownAssetIds) ? body.knownAssetIds : opts.knownAssetIds;
        const validation = validateImportPackage(pkg, knownAssetIds);
        if (!validation.valid) {
          sendJson(res, 400, {
            error: 'INVALID_MAP_PACKAGE',
            message: validation.errors.join(' | '),
            errors: validation.errors,
            warnings: validation.warnings,
            missingAssets: validation.missingAssets,
          });
          return true;
        }

        const { maps } = listAllMapsOnDisk();
        let incomingDoc = { ...pkg.map };
        const desiredId = sanitizeMapId(incomingDoc.id);
        const idExists = Boolean(desiredId && fs.existsSync(path.join(customMapsRoot, desiredId, 'map.json')));
        const nameExists = maps.some((m) => m.name.toLowerCase() === String(incomingDoc.name || '').trim().toLowerCase() && m.id !== desiredId);

        if ((idExists || nameExists) && conflictMode === 'ask') {
          sendJson(res, 409, {
            error: 'MAP_CONFLICT',
            message: idExists
              ? `A custom map with ID "${desiredId}" already exists.`
              : `A custom map named "${incomingDoc.name}" already exists.`,
            existingId: desiredId,
            existingName: incomingDoc.name,
            warnings: validation.warnings,
          });
          return true;
        }

        if ((idExists || nameExists) && conflictMode === 'rename') {
          let n = 2;
          let candidateName = `${incomingDoc.name} (${n})`;
          while (maps.some((m) => m.name.toLowerCase() === candidateName.toLowerCase())) {
            n++;
            candidateName = `${incomingDoc.name} (${n})`;
          }
          let candidateId = `${desiredId || 'imported'}_${n}`;
          while (fs.existsSync(path.join(customMapsRoot, candidateId))) {
            n++;
            candidateId = `${desiredId || 'imported'}_${n}`;
          }
          incomingDoc.id = candidateId;
          incomingDoc.name = candidateName;
        }

        incomingDoc.updatedAt = new Date().toISOString();
        const saved = writeFullMapToDisk(incomingDoc);

        // Merge any custom prefabs / material presets included in package without duplicating IDs
        if (Array.isArray(pkg.prefabs) && pkg.prefabs.length > 0) {
          const prefabsPath = path.join(libraryDir, 'prefabs.json');
          const cur = fs.existsSync(prefabsPath) ? JSON.parse(fs.readFileSync(prefabsPath, 'utf8')) : [];
          const byId = new Map(cur.map((p) => [p.id, p]));
          for (const p of pkg.prefabs) {
            if (p && p.id && !byId.has(p.id)) byId.set(p.id, p);
          }
          atomicWriteFileSync(prefabsPath, JSON.stringify([...byId.values()], null, 2), { backup: true });
        }
        if (Array.isArray(pkg.materialPresets) && pkg.materialPresets.length > 0) {
          const matsPath = path.join(libraryDir, 'materials.json');
          const cur = fs.existsSync(matsPath) ? JSON.parse(fs.readFileSync(matsPath, 'utf8')) : [];
          const byId = new Map(cur.map((p) => [p.id, p]));
          for (const m of pkg.materialPresets) {
            if (m && m.id && !byId.has(m.id)) byId.set(m.id, m);
          }
          atomicWriteFileSync(matsPath, JSON.stringify([...byId.values()], null, 2), { backup: true });
        }

        sendJson(res, 200, {
          ok: true,
          metadata: saved.metadata,
          map: saved.doc,
          warnings: validation.warnings,
          missingAssets: validation.missingAssets,
        });
        return true;
      }

      // Routes under /:id/...
      const parts = subPath.split('/').filter(Boolean);
      const rawId = parts[0];
      const safeId = sanitizeMapId(rawId);
      if (!safeId) {
        sendJson(res, 400, { error: 'INVALID_MAP_ID', message: 'Invalid or unsafe map ID path.' });
        return true;
      }

      const mapDir = assertInsideRoot(customMapsRoot, path.join(customMapsRoot, safeId));
      const mapFile = path.join(mapDir, 'map.json');
      const action = parts[1] || '';

      // GET /api/custom-maps/:id/thumbnail/:kind
      if (action === 'thumbnail' && req.method === 'GET') {
        const kind = parts[2] === 'topdown' ? 'topdown.png' : 'preview.png';
        const target = assertInsideRoot(mapDir, path.join(mapDir, 'thumbnails', kind));
        if (!fs.existsSync(target)) {
          res.statusCode = 404;
          res.end('Thumbnail not found');
          return true;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/png');
        fs.createReadStream(target).pipe(res);
        return true;
      }

      // GET /api/custom-maps/:id/export
      if (action === 'export' && req.method === 'GET') {
        const loaded = readJsonSafeWithBackup(mapFile);
        if (!loaded.ok) {
          sendJson(res, loaded.error === 'NOT_FOUND' ? 404 : 422, { error: loaded.error, message: 'Cannot export missing or corrupted map.' });
          return true;
        }
        const doc = loaded.data;
        const previewUrl = encodePngToDataUrl(path.join(mapDir, 'thumbnails', 'preview.png')) || doc.thumbnails?.previewDataUrl;
        const topUrl = encodePngToDataUrl(path.join(mapDir, 'thumbnails', 'topdown.png')) || doc.thumbnails?.topdownDataUrl;
        if (previewUrl || topUrl) {
          doc.thumbnails = { previewDataUrl: previewUrl, topdownDataUrl: topUrl, updatedAt: doc.thumbnails?.updatedAt };
        }
        let prefabs = [];
        let materialPresets = [];
        try {
          const pp = path.join(libraryDir, 'prefabs.json');
          if (fs.existsSync(pp)) {
            const usedPrefabs = new Set((doc.objects || []).map((o) => o.prefabId).filter(Boolean));
            const allP = JSON.parse(fs.readFileSync(pp, 'utf8'));
            prefabs = allP.filter((p) => usedPrefabs.has(p.id));
          }
          const mp = path.join(libraryDir, 'materials.json');
          if (fs.existsSync(mp)) materialPresets = JSON.parse(fs.readFileSync(mp, 'utf8'));
        } catch {
          // optional
        }
        const pkg = {
          packageType: 'pure-skill-custom-map',
          packageVersion: 1,
          exportedAt: new Date().toISOString(),
          checksum: computeMapChecksum(doc),
          map: doc,
          prefabs,
          materialPresets,
        };
        sendJson(res, 200, pkg);
        return true;
      }

      // Autosave endpoints: /api/custom-maps/:id/autosave
      if (action === 'autosave') {
        const autoFile = path.join(mapDir, 'autosave.json');
        if (req.method === 'GET') {
          if (!fs.existsSync(autoFile)) {
            sendJson(res, 404, { error: 'NO_AUTOSAVE' });
            return true;
          }
          try {
            const data = JSON.parse(fs.readFileSync(autoFile, 'utf8'));
            sendJson(res, 200, data);
          } catch {
            sendJson(res, 422, { error: 'CORRUPTED_AUTOSAVE' });
          }
          return true;
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          const errs = validateMapDocumentStructure(body);
          if (errs.length > 0) {
            sendJson(res, 400, { error: 'INVALID_AUTOSAVE', message: errs.join(' | ') });
            return true;
          }
          fs.mkdirSync(mapDir, { recursive: true });
          atomicWriteFileSync(autoFile, JSON.stringify({ savedAt: new Date().toISOString(), doc: body }), { backup: false });
          sendJson(res, 200, { ok: true, savedAt: new Date().toISOString() });
          return true;
        }
        if (req.method === 'DELETE') {
          if (fs.existsSync(autoFile)) fs.unlinkSync(autoFile);
          sendJson(res, 200, { ok: true });
          return true;
        }
      }

      // POST /api/custom-maps/:id/duplicate
      if (action === 'duplicate' && req.method === 'POST') {
        const loaded = readJsonSafeWithBackup(mapFile);
        if (!loaded.ok) {
          sendJson(res, 404, { error: loaded.error });
          return true;
        }
        const body = await readJsonBody(req);
        const { maps } = listAllMapsOnDisk();
        let copyName = (typeof body.name === 'string' && body.name.trim()) ? body.name.trim() : `${loaded.data.name} (Copy)`;
        let copyN = 2;
        while (maps.some((m) => m.name.toLowerCase() === copyName.toLowerCase())) {
          copyName = `${loaded.data.name} (Copy ${copyN++})`;
        }
        let copyId = `${safeId}_copy_${Date.now().toString(36).slice(-4)}`;
        while (fs.existsSync(path.join(customMapsRoot, copyId))) {
          copyId = `${safeId}_copy_${Date.now().toString(36)}_${copyN++}`;
        }
        const now = new Date().toISOString();
        const dupDoc = {
          ...loaded.data,
          id: copyId,
          name: copyName,
          createdAt: now,
          updatedAt: now,
        };
        const previewUrl = encodePngToDataUrl(path.join(mapDir, 'thumbnails', 'preview.png')) || loaded.data.thumbnails?.previewDataUrl;
        const topUrl = encodePngToDataUrl(path.join(mapDir, 'thumbnails', 'topdown.png')) || loaded.data.thumbnails?.topdownDataUrl;
        dupDoc.thumbnails = { previewDataUrl: previewUrl, topdownDataUrl: topUrl, updatedAt: loaded.data.thumbnails?.updatedAt };
        const saved = writeFullMapToDisk(dupDoc);
        sendJson(res, 200, { ok: true, metadata: saved.metadata, map: saved.doc });
        return true;
      }

      // PATCH /api/custom-maps/:id/rename
      if (action === 'rename' && req.method === 'PATCH') {
        const loaded = readJsonSafeWithBackup(mapFile);
        if (!loaded.ok) {
          sendJson(res, 404, { error: loaded.error });
          return true;
        }
        const body = await readJsonBody(req);
        const newName = typeof body.name === 'string' ? body.name.trim() : '';
        if (!newName || newName.length > 80) {
          sendJson(res, 400, { error: 'INVALID_NAME', message: 'New map name must be 1..80 characters.' });
          return true;
        }
        const { maps } = listAllMapsOnDisk();
        if (maps.some((m) => m.id !== safeId && m.name.toLowerCase() === newName.toLowerCase())) {
          sendJson(res, 409, { error: 'DUPLICATE_NAME', message: `Another map named "${newName}" already exists.` });
          return true;
        }
        const updatedDoc = { ...loaded.data, name: newName, updatedAt: new Date().toISOString() };
        const saved = writeFullMapToDisk(updatedDoc);
        sendJson(res, 200, { ok: true, metadata: saved.metadata, map: saved.doc });
        return true;
      }

      // GET /api/custom-maps/:id
      if (action === '' && req.method === 'GET') {
        const loaded = readJsonSafeWithBackup(mapFile);
        if (!loaded.ok) {
          sendJson(res, loaded.error === 'NOT_FOUND' ? 404 : 422, {
            error: loaded.error,
            message: loaded.error === 'CORRUPTED_MAP_FILE'
              ? `Map "${safeId}" has corrupted JSON and could not be recovered.`
              : `Map "${safeId}" not found.`,
          });
          return true;
        }
        const doc = loaded.data;
        const previewUrl = encodePngToDataUrl(path.join(mapDir, 'thumbnails', 'preview.png')) || doc.thumbnails?.previewDataUrl;
        const topUrl = encodePngToDataUrl(path.join(mapDir, 'thumbnails', 'topdown.png')) || doc.thumbnails?.topdownDataUrl;
        doc.thumbnails = { previewDataUrl: previewUrl, topdownDataUrl: topUrl, updatedAt: doc.thumbnails?.updatedAt };
        const metadata = buildMetadataSummary(doc, mapDir, loaded.recoveredFromBackup);
        let autosaveDoc = null;
        const autoFile = path.join(mapDir, 'autosave.json');
        if (fs.existsSync(autoFile)) {
          try {
            autosaveDoc = JSON.parse(fs.readFileSync(autoFile, 'utf8'));
          } catch {
            autosaveDoc = null;
          }
        }
        sendJson(res, 200, { map: doc, metadata, recoveredFromBackup: loaded.recoveredFromBackup, autosave: autosaveDoc });
        return true;
      }

      // PUT /api/custom-maps/:id
      if (action === '' && req.method === 'PUT') {
        const body = await readJsonBody(req);
        const docPayload = body.map || body;
        const createOnly = Boolean(body.createOnly);
        const docWithId = { ...docPayload, id: safeId };
        const errs = validateMapDocumentStructure(docWithId);
        if (errs.length > 0) {
          sendJson(res, 400, { error: 'VALIDATION_FAILED', message: errs.join(' | '), errors: errs });
          return true;
        }
        const { maps } = listAllMapsOnDisk();
        if (createOnly && fs.existsSync(mapFile)) {
          sendJson(res, 409, { error: 'DUPLICATE_ID', message: `Map "${safeId}" already exists.` });
          return true;
        }
        if (maps.some((m) => m.id !== safeId && m.name.toLowerCase() === docWithId.name.trim().toLowerCase())) {
          if (createOnly || !body.allowDuplicateName) {
            sendJson(res, 409, { error: 'DUPLICATE_NAME', message: `A map named "${docWithId.name}" already exists.` });
            return true;
          }
        }
        const saved = writeFullMapToDisk(docWithId);
        sendJson(res, 200, { ok: true, metadata: saved.metadata, map: saved.doc });
        return true;
      }

      // DELETE /api/custom-maps/:id
      if (action === '' && req.method === 'DELETE') {
        if (!fs.existsSync(mapDir)) {
          sendJson(res, 404, { error: 'NOT_FOUND' });
          return true;
        }
        fs.rmSync(mapDir, { recursive: true, force: true });
        sendJson(res, 200, { ok: true, id: safeId });
        return true;
      }

      sendJson(res, 404, { error: 'UNKNOWN_ROUTE' });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg === 'INVALID_JSON' ? 400 : msg === 'PAYLOAD_TOO_LARGE' ? 413 : 500;
      sendJson(res, status, { error: msg, message: msg });
      return true;
    }
  };
}

export { FILENAME_SAFE_RE };
