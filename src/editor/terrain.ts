import * as THREE from 'three';
import { getAssetDefinition, getCachedStandardMaterial } from './assetCatalog';
import { GROUND_MATERIAL_PRESETS } from './presets';
import { CustomMapDocument, GroundTypeId, MapObject, TerrainData } from './types';

export type TerrainBrushMode = 'raise' | 'lower' | 'flatten' | 'smooth' | 'slope';
export type TerrainFalloffMode = 'smooth' | 'linear' | 'sharp';

export interface TerrainBrushStroke {
  mode: TerrainBrushMode;
  worldX: number;
  worldZ: number;
  radius: number;
  strength: number;
  falloff: TerrainFalloffMode;
  smoothness: number;
  targetHeight?: number;
  slopeStart?: [number, number, number];
}

export function createInitialTerrain(
  width: number,
  depth: number,
  groundType: GroundTypeId,
  cellSize = 2,
): TerrainData {
  const cols = Math.max(4, Math.round(width / cellSize) + 1);
  const rows = Math.max(4, Math.round(depth / cellSize) + 1);
  const preset = GROUND_MATERIAL_PRESETS[groundType] ?? GROUND_MATERIAL_PRESETS.concrete;
  return {
    enabled: groundType !== 'none',
    cols,
    rows,
    cellSize,
    width,
    depth,
    heights: new Array<number>(cols * rows).fill(0),
    baseMaterial: { ...preset.material },
  };
}

export function syncTerrainGeometry(mesh: THREE.Mesh, terrain: TerrainData): void {
  const geom = mesh.geometry as THREE.BufferGeometry;
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
  const expected = terrain.cols * terrain.rows;
  if (posAttr.count !== expected) return;

  // PlaneGeometry in Three.js has width segments along X and height segments along Y before X-rotation (-90deg),
  // which maps local (x, y, z) after -PI/2 X rotation -> (x, z_height, -y_row).
  // Vertex order: row r from 0..rows-1 (local +y to -y => world -Z to +Z), col c from 0..cols-1 (world -X to +X).
  for (let r = 0; r < terrain.rows; r++) {
    for (let c = 0; c < terrain.cols; c++) {
      const idx = r * terrain.cols + c;
      const h = terrain.heights[idx] ?? 0;
      posAttr.setZ(idx, h); // local Z becomes world +Y after rotation.x = -PI/2
    }
  }
  posAttr.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
}

export function buildTerrainMesh(terrain: TerrainData): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(
    terrain.width,
    terrain.depth,
    Math.max(1, terrain.cols - 1),
    Math.max(1, terrain.rows - 1),
  );
  const mat = getCachedStandardMaterial(terrain.baseMaterial);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI * 0.5;
  mesh.receiveShadow = true;
  mesh.visible = terrain.enabled;
  mesh.userData = { isTerrain: true };
  syncTerrainGeometry(mesh, terrain);
  return mesh;
}

function computeFalloffWeight(distRatio: number, falloff: TerrainFalloffMode): number {
  const t = Math.max(0, Math.min(1, 1 - distRatio));
  if (falloff === 'linear') return t;
  if (falloff === 'sharp') return t > 0 ? Math.pow(t, 0.35) : 0;
  // smoothstep
  return t * t * (3 - 2 * t);
}

export function applyTerrainBrush(terrain: TerrainData, stroke: TerrainBrushStroke): boolean {
  if (!terrain.enabled) return false;
  const cols = terrain.cols;
  const rows = terrain.rows;
  const halfW = terrain.width * 0.5;
  const halfD = terrain.depth * 0.5;
  const stepX = terrain.width / Math.max(1, cols - 1);
  const stepZ = terrain.depth / Math.max(1, rows - 1);
  const radius = Math.max(0.5, stroke.radius);

  const minC = Math.max(0, Math.floor((stroke.worldX - radius + halfW) / stepX));
  const maxC = Math.min(cols - 1, Math.ceil((stroke.worldX + radius + halfW) / stepX));
  const minR = Math.max(0, Math.floor((stroke.worldZ - radius + halfD) / stepZ));
  const maxR = Math.min(rows - 1, Math.ceil((stroke.worldZ + radius + halfD) / stepZ));

  const snapshot = stroke.mode === 'smooth' ? [...terrain.heights] : null;
  let changed = false;

  for (let r = minR; r <= maxR; r++) {
    const wz = -halfD + r * stepZ;
    for (let c = minC; c <= maxC; c++) {
      const wx = -halfW + c * stepX;
      const d = Math.hypot(wx - stroke.worldX, wz - stroke.worldZ);
      if (d > radius) continue;

      const w = computeFalloffWeight(d / radius, stroke.falloff);
      if (w <= 0) continue;

      const idx = r * cols + c;
      const cur = terrain.heights[idx] ?? 0;
      let next = cur;

      if (stroke.mode === 'raise') {
        next = cur + stroke.strength * w;
      } else if (stroke.mode === 'lower') {
        next = cur - stroke.strength * w;
      } else if (stroke.mode === 'flatten') {
        const target = stroke.targetHeight ?? 0;
        const alpha = Math.min(1, stroke.strength * 0.45 * w);
        next = cur + (target - cur) * alpha;
      } else if (stroke.mode === 'smooth' && snapshot) {
        let sum = 0;
        let cnt = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
              sum += snapshot[nr * cols + nc] ?? 0;
              cnt++;
            }
          }
        }
        const avg = cnt > 0 ? sum / cnt : cur;
        const alpha = Math.min(1, stroke.smoothness * w * Math.max(0.25, stroke.strength));
        next = cur + (avg - cur) * alpha;
      } else if (stroke.mode === 'slope' && stroke.slopeStart) {
        const [sx, sy, sz] = stroke.slopeStart;
        const targetY = stroke.targetHeight ?? sy;
        const dx = stroke.worldX - sx;
        const dz = stroke.worldZ - sz;
        const lenSq = dx * dx + dz * dz;
        if (lenSq > 0.01) {
          const proj = Math.max(0, Math.min(1, ((wx - sx) * dx + (wz - sz) * dz) / lenSq));
          const slopeH = sy + (targetY - sy) * proj;
          const alpha = Math.min(1, 0.65 * w);
          next = cur + (slopeH - cur) * alpha;
        }
      }

      next = Math.max(-12, Math.min(24, Number(next.toFixed(4))));
      if (Math.abs(next - cur) > 1e-5) {
        terrain.heights[idx] = next;
        changed = true;
      }
    }
  }
  return changed;
}

export function sampleTerrainHeight(terrain: TerrainData, wx: number, wz: number): number {
  if (!terrain.enabled || terrain.cols < 2 || terrain.rows < 2) return 0;
  const halfW = terrain.width * 0.5;
  const halfD = terrain.depth * 0.5;
  const u = Math.max(0, Math.min(1, (wx + halfW) / terrain.width)) * (terrain.cols - 1);
  const v = Math.max(0, Math.min(1, (wz + halfD) / terrain.depth)) * (terrain.rows - 1);

  const c0 = Math.floor(u);
  const r0 = Math.floor(v);
  const c1 = Math.min(terrain.cols - 1, c0 + 1);
  const r1 = Math.min(terrain.rows - 1, r0 + 1);
  const tx = u - c0;
  const tz = v - r0;

  const h00 = terrain.heights[r0 * terrain.cols + c0] ?? 0;
  const h10 = terrain.heights[r0 * terrain.cols + c1] ?? 0;
  const h01 = terrain.heights[r1 * terrain.cols + c0] ?? 0;
  const h11 = terrain.heights[r1 * terrain.cols + c1] ?? 0;

  const hx0 = h00 + (h10 - h00) * tx;
  const hx1 = h01 + (h11 - h01) * tx;
  return hx0 + (hx1 - hx0) * tz;
}

/**
 * Evaluates both the sculpted heightfield terrain and any walkable modular structures
 * (floors, platforms, ground slabs, stairs, ramps) under world position (wx, wz).
 */
export function sampleMapSurfaceHeight(
  doc: CustomMapDocument,
  wx: number,
  wz: number,
  currentY = 0,
): number {
  let bestY = doc.terrain.enabled ? sampleTerrainHeight(doc.terrain, wx, wz) : 0;

  for (const obj of doc.objects) {
    if (!obj.visible || !obj.collision?.enabled || !obj.collision.walkableTop) continue;
    const def = getAssetDefinition(obj.assetId);
    if (!def) continue;

    // Transform world (wx, wz) into object-local coordinates using inverse Y rotation
    const dx = wx - obj.position[0];
    const dz = wz - obj.position[2];
    const yawRad = THREE.MathUtils.degToRad(obj.rotation[1] || 0);
    const cosY = Math.cos(-yawRad);
    const sinY = Math.sin(-yawRad);
    const lx = dx * cosY - dz * sinY;
    const lz = dx * sinY + dz * cosY;

    const sx = Math.abs(obj.scale[0] || 1);
    const sy = Math.abs(obj.scale[1] || 1);
    const sz = Math.abs(obj.scale[2] || 1);
    const hw = def.boundsSize[0] * sx * 0.5;
    const h = def.boundsSize[1] * sy;
    const hd = def.boundsSize[2] * sz * 0.5;

    if (Math.abs(lx) > hw + 0.15 || Math.abs(lz) > hd + 0.15) continue;

    let surfY = obj.position[1] + h;
    if (def.isRamp || def.isStairs) {
      // Slope/stairs ascend from local +hd (bottom, 0) to local -hd (top, h)
      const t = Math.max(0, Math.min(1, (hd - lz) / Math.max(0.05, hd * 2)));
      if (def.isStairs) {
        const steps = obj.assetId === 'gnd_steps' ? 4 : 8;
        surfY = obj.position[1] + (Math.ceil(t * steps) / steps) * h;
      } else {
        surfY = obj.position[1] + t * h;
      }
    }

    // Only step onto surfaces within step-up range of current feet Y (prevents teleporting onto high roofs)
    if (surfY <= currentY + (doc.navigation.maxStepHeight ?? 0.65) + 0.18 && surfY > bestY) {
      bestY = surfY;
    }
  }

  return bestY;
}
