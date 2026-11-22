import { PathStatus, Vec3 } from './types';

export interface NavWallBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
}

export interface NavGridLayout {
  cols: number;
  rows: number;
  cellSize: number;
  halfX: number;
  halfZ: number;
  cells: string[];
}

export interface NavGridConfig {
  halfX: number;
  halfZ: number;
  walls: NavWallBox[];
  grid?: NavGridLayout;
  cellSize?: number;
  clearance?: number;
}

export interface NavPenaltyZone {
  x: number;
  z: number;
  radius: number;
  cost: number;
}

export interface NavPathResult {
  status: PathStatus;
  points: Vec3[];
  goal: Vec3;
  partial: boolean;
}

class MinHeap {
  private nodes: number[] = [];
  private scores: Float32Array;

  constructor(scores: Float32Array) {
    this.scores = scores;
  }

  public get size(): number {
    return this.nodes.length;
  }

  public clear(): void {
    this.nodes.length = 0;
  }

  public push(idx: number): void {
    this.nodes.push(idx);
    this.siftUp(this.nodes.length - 1);
  }

  public pop(): number {
    const top = this.nodes[0];
    const last = this.nodes.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(i: number): void {
    const score = this.scores[this.nodes[i]];
    const node = this.nodes[i];
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pNode = this.nodes[p];
      if (score >= this.scores[pNode]) break;
      this.nodes[i] = pNode;
      i = p;
    }
    this.nodes[i] = node;
  }

  private siftDown(i: number): void {
    const len = this.nodes.length;
    const node = this.nodes[i];
    const score = this.scores[node];
    while (true) {
      const l = (i << 1) + 1;
      if (l >= len) break;
      const r = l + 1;
      let best = l;
      let bestScore = this.scores[this.nodes[l]];
      if (r < len && this.scores[this.nodes[r]] < bestScore) {
        best = r;
        bestScore = this.scores[this.nodes[r]];
      }
      if (score <= bestScore) break;
      this.nodes[i] = this.nodes[best];
      i = best;
    }
    this.nodes[i] = node;
  }
}

export class NavGrid {
  public readonly halfX: number;
  public readonly halfZ: number;
  public readonly cellSize: number;
  public readonly cols: number;
  public readonly rows: number;
  public readonly clearance: number;
  private readonly walls: NavWallBox[];
  private readonly rawGrid?: NavGridLayout;

  /** 0 = walkable, 1 = blocked */
  public readonly blocked: Uint8Array;
  /** Soft proximity penalty near walls so paths hug corridor centerlines */
  public readonly proximityCost: Float32Array;
  /** Connected component ID (> 0) for instant island / reachability queries */
  public readonly componentId: Int32Array;
  public readonly walkableCount: number;

  // Reusable scratch buffers for zero-GC A*
  private readonly gScore: Float32Array;
  private readonly fScore: Float32Array;
  private readonly cameFrom: Int32Array;
  private readonly stateArr: Uint8Array;
  private readonly dirtyList: number[] = [];
  private readonly heap: MinHeap;

  constructor(cfg: NavGridConfig) {
    this.halfX = cfg.halfX;
    this.halfZ = cfg.halfZ;
    this.cellSize = cfg.cellSize ?? 1.0;
    this.clearance = cfg.clearance ?? 0.54;
    this.walls = cfg.walls;
    this.rawGrid = cfg.grid;

    this.cols = Math.max(4, Math.round((this.halfX * 2) / this.cellSize));
    this.rows = Math.max(4, Math.round((this.halfZ * 2) / this.cellSize));
    const total = this.cols * this.rows;

    this.blocked = new Uint8Array(total);
    this.proximityCost = new Float32Array(total);
    this.componentId = new Int32Array(total);
    this.gScore = new Float32Array(total);
    this.fScore = new Float32Array(total);
    this.cameFrom = new Int32Array(total).fill(-1);
    this.stateArr = new Uint8Array(total);
    this.heap = new MinHeap(this.fScore);

    let walkCnt = 0;
    for (let gz = 0; gz < this.rows; gz++) {
      for (let gx = 0; gx < this.cols; gx++) {
        const idx = gz * this.cols + gx;
        const p = this.cellCenter(gx, gz);
        if (!this.computePointClear(p.x, p.z, this.clearance)) {
          this.blocked[idx] = 1;
        } else {
          walkCnt++;
        }
      }
    }
    this.walkableCount = walkCnt;

    // Proximity penalty near blocked cells
    for (let gz = 0; gz < this.rows; gz++) {
      for (let gx = 0; gx < this.cols; gx++) {
        const idx = gz * this.cols + gx;
        if (this.blocked[idx]) continue;
        let nearBlocked = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            const nx = gx + dx;
            const nz = gz + dz;
            if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows || this.blocked[nz * this.cols + nx]) {
              nearBlocked++;
            }
          }
        }
        if (nearBlocked > 0) {
          this.proximityCost[idx] = nearBlocked * 0.45;
        }
      }
    }

    // Flood-fill connected components for instant O(1) disconnected checks
    let comp = 0;
    const queue = new Int32Array(total);
    for (let i = 0; i < total; i++) {
      if (this.blocked[i] || this.componentId[i] !== 0) continue;
      comp++;
      let h = 0;
      let t = 0;
      queue[t++] = i;
      this.componentId[i] = comp;
      while (h < t) {
        const cur = queue[h++];
        const cx = cur % this.cols;
        const cz = (cur - cx) / this.cols;
        const nbs = [
          [cx + 1, cz],
          [cx - 1, cz],
          [cx, cz + 1],
          [cx, cz - 1],
        ];
        for (const [nx, nz] of nbs) {
          if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
          const nIdx = nz * this.cols + nx;
          if (!this.blocked[nIdx] && this.componentId[nIdx] === 0) {
            this.componentId[nIdx] = comp;
            queue[t++] = nIdx;
          }
        }
      }
    }
  }

  private computePointClear(wx: number, wz: number, margin: number): boolean {
    if (Math.abs(wx) > this.halfX - margin || Math.abs(wz) > this.halfZ - margin) return false;
    if (this.rawGrid) {
      const c = Math.floor((wx + this.rawGrid.halfX) / this.rawGrid.cellSize);
      const r = Math.floor((wz + this.rawGrid.halfZ) / this.rawGrid.cellSize);
      if (c < 0 || r < 0 || c >= this.rawGrid.cols || r >= this.rawGrid.rows) return false;
      const ch = this.rawGrid.cells[r]?.[c] ?? '#';
      if (ch === '#' || ch === 'V') return false;
    }
    for (const w of this.walls) {
      if (w.maxY < 0.35) continue;
      if (
        wx >= w.minX - margin &&
        wx <= w.maxX + margin &&
        wz >= w.minZ - margin &&
        wz <= w.maxZ + margin
      ) {
        return false;
      }
    }
    return true;
  }

  public worldToCell(wx: number, wz: number): [number, number] {
    const gx = Math.max(0, Math.min(this.cols - 1, Math.floor((wx + this.halfX) / this.cellSize)));
    const gz = Math.max(0, Math.min(this.rows - 1, Math.floor((wz + this.halfZ) / this.cellSize)));
    return [gx, gz];
  }

  public cellCenter(gx: number, gz: number): Vec3 {
    return {
      x: -this.halfX + (gx + 0.5) * this.cellSize,
      y: 0,
      z: -this.halfZ + (gz + 0.5) * this.cellSize,
    };
  }

  public isCellWalkable(gx: number, gz: number): boolean {
    if (gx < 0 || gz < 0 || gx >= this.cols || gz >= this.rows) return false;
    return this.blocked[gz * this.cols + gx] === 0;
  }

  public isWalkable(wx: number, wz: number): boolean {
    if (Math.abs(wx) >= this.halfX - 0.3 || Math.abs(wz) >= this.halfZ - 0.3) return false;
    const [gx, gz] = this.worldToCell(wx, wz);
    return this.isCellWalkable(gx, gz) && this.computePointClear(wx, wz, 0.38);
  }

  public findNearestWalkable(wx: number, wz: number, maxRadiusCells = 20): Vec3 | null {
    const [sx, sz] = this.worldToCell(wx, wz);
    if (this.isCellWalkable(sx, sz)) return this.cellCenter(sx, sz);

    let bestDist = Infinity;
    let best: Vec3 | null = null;
    for (let r = 1; r <= maxRadiusCells; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = sx + dx;
          const nz = sz + dz;
          if (!this.isCellWalkable(nx, nz)) continue;
          const c = this.cellCenter(nx, nz);
          const d = Math.hypot(c.x - wx, c.z - wz);
          if (d < bestDist) {
            bestDist = d;
            best = c;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  public arePointsConnected(a: Vec3, b: Vec3): boolean {
    const sa = this.findNearestWalkable(a.x, a.z);
    const sb = this.findNearestWalkable(b.x, b.z);
    if (!sa || !sb) return false;
    const [ax, az] = this.worldToCell(sa.x, sa.z);
    const [bx, bz] = this.worldToCell(sb.x, sb.z);
    const ca = this.componentId[az * this.cols + ax];
    const cb = this.componentId[bz * this.cols + bx];
    return ca > 0 && ca === cb;
  }

  /** Continuous clearance line check across NavGrid + perpendicular thickness. */
  public hasWalkableLine(a: Vec3, b: Vec3, halfWidth = 0.28): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1) return this.isWalkable(b.x, b.z);
    const nx = -dz / dist;
    const nz = dx / dist;
    const steps = Math.max(2, Math.ceil(dist / 0.4));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      if (!this.isWalkable(px, pz)) return false;
      if (halfWidth > 0) {
        if (!this.isWalkable(px + nx * halfWidth, pz + nz * halfWidth)) return false;
        if (!this.isWalkable(px - nx * halfWidth, pz - nz * halfWidth)) return false;
      }
    }
    return true;
  }

  public findPath(
    from: Vec3,
    to: Vec3,
    options?: { penaltyZones?: NavPenaltyZone[]; maxNodes?: number; allowPartial?: boolean },
  ): NavPathResult {
    const startSnap = this.isWalkable(from.x, from.z) ? { x: from.x, y: 0, z: from.z } : this.findNearestWalkable(from.x, from.z);
    const goalSnap = this.findNearestWalkable(to.x, to.z);
    if (!startSnap || !goalSnap) {
      return { status: 'failed', points: [], goal: { ...to }, partial: false };
    }

    const [sx, sz] = this.worldToCell(startSnap.x, startSnap.z);
    const [tx, tz] = this.worldToCell(goalSnap.x, goalSnap.z);
    const startIdx = sz * this.cols + sx;
    const goalIdx = tz * this.cols + tx;

    if (startIdx === goalIdx || this.hasWalkableLine(startSnap, goalSnap, 0.3)) {
      return {
        status: 'ok',
        points: [{ x: goalSnap.x, y: 0, z: goalSnap.z }],
        goal: { x: goalSnap.x, y: 0, z: goalSnap.z },
        partial: false,
      };
    }

    // Disconnected component check
    const startComp = this.componentId[startIdx];
    const goalComp = this.componentId[goalIdx];
    const disconnected = startComp === 0 || goalComp === 0 || startComp !== goalComp;
    if (disconnected && options?.allowPartial === false) {
      return { status: 'failed', points: [], goal: goalSnap, partial: false };
    }

    // Clear dirty A* cells
    this.heap.clear();
    for (const idx of this.dirtyList) {
      this.stateArr[idx] = 0;
      this.cameFrom[idx] = -1;
    }
    this.dirtyList.length = 0;

    const heuristic = (ax: number, az: number): number => {
      const dx = Math.abs(ax - tx);
      const dz = Math.abs(az - tz);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };

    this.gScore[startIdx] = 0;
    this.fScore[startIdx] = heuristic(sx, sz);
    this.stateArr[startIdx] = 1;
    this.cameFrom[startIdx] = -1;
    this.dirtyList.push(startIdx);
    this.heap.push(startIdx);

    let bestPartialIdx = startIdx;
    let bestPartialH = heuristic(sx, sz);
    const maxNodes = options?.maxNodes ?? 4000;
    const penalties = options?.penaltyZones ?? [];
    let expanded = 0;
    let found = false;

    const dirs: Array<[number, number, number]> = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, Math.SQRT2],
      [1, -1, Math.SQRT2],
      [-1, 1, Math.SQRT2],
      [-1, -1, Math.SQRT2],
    ];

    while (this.heap.size > 0 && expanded < maxNodes) {
      const cur = this.heap.pop();
      if (this.stateArr[cur] === 2) continue;
      this.stateArr[cur] = 2;
      expanded++;

      if (cur === goalIdx) {
        found = true;
        break;
      }

      const cx = cur % this.cols;
      const cz = (cur - cx) / this.cols;
      const curH = heuristic(cx, cz);
      if (curH < bestPartialH) {
        bestPartialH = curH;
        bestPartialIdx = cur;
      }

      const curG = this.gScore[cur];

      for (const [dx, dz, stepCost] of dirs) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!this.isCellWalkable(nx, nz)) continue;

        // Guard diagonal corner cutting
        if (dx !== 0 && dz !== 0) {
          if (!this.isCellWalkable(cx + dx, cz) || !this.isCellWalkable(cx, cz + dz)) continue;
        }

        const nIdx = nz * this.cols + nx;
        if (this.stateArr[nIdx] === 2) continue;

        let zonePenalty = 0;
        if (penalties.length > 0) {
          const nc = this.cellCenter(nx, nz);
          for (const pz of penalties) {
            if (Math.hypot(nc.x - pz.x, nc.z - pz.z) <= pz.radius) {
              zonePenalty += pz.cost;
            }
          }
        }

        const tentativeG = curG + stepCost + this.proximityCost[nIdx] + zonePenalty;
        if (this.stateArr[nIdx] === 0 || tentativeG < this.gScore[nIdx]) {
          this.gScore[nIdx] = tentativeG;
          this.fScore[nIdx] = tentativeG + heuristic(nx, nz);
          this.cameFrom[nIdx] = cur;
          if (this.stateArr[nIdx] === 0) {
            this.dirtyList.push(nIdx);
          }
          this.stateArr[nIdx] = 1;
          this.heap.push(nIdx);
        }
      }
    }

    const endIdx = found ? goalIdx : options?.allowPartial !== false ? bestPartialIdx : -1;
    if (endIdx < 0 || endIdx === startIdx && !found) {
      return { status: 'failed', points: [], goal: goalSnap, partial: false };
    }

    const rawPoints: Vec3[] = [];
    let walk: number = endIdx;
    while (walk >= 0 && walk !== startIdx) {
      const gx = walk % this.cols;
      const gz = (walk - gx) / this.cols;
      rawPoints.unshift(this.cellCenter(gx, gz));
      walk = this.cameFrom[walk];
    }

    if (rawPoints.length === 0) {
      return {
        status: found ? 'ok' : 'partial',
        points: [{ ...goalSnap }],
        goal: goalSnap,
        partial: !found,
      };
    }

    // String-pulling path smoothing so movement follows straight lines cleanly around corners
    const smoothed: Vec3[] = [];
    let anchor: Vec3 = startSnap;
    let i = 0;
    while (i < rawPoints.length) {
      let furthest = i;
      for (let j = rawPoints.length - 1; j > i; j--) {
        if (this.hasWalkableLine(anchor, rawPoints[j], 0.26)) {
          furthest = j;
          break;
        }
      }
      smoothed.push(rawPoints[furthest]);
      anchor = rawPoints[furthest];
      i = furthest + 1;
    }

    return {
      status: found ? 'ok' : 'partial',
      points: smoothed,
      goal: goalSnap,
      partial: !found,
    };
  }

  public resolvePositionCollision(pos: Vec3, radius = 0.48): void {
    const maxX = this.halfX - radius;
    const maxZ = this.halfZ - radius;
    pos.x = Math.max(-maxX, Math.min(maxX, pos.x));
    pos.z = Math.max(-maxZ, Math.min(maxZ, pos.z));

    for (const w of this.walls) {
      if (pos.y > w.maxY) continue;
      const cx = Math.max(w.minX, Math.min(w.maxX, pos.x));
      const cz = Math.max(w.minZ, Math.min(w.maxZ, pos.z));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = radius - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
        } else {
          // Inside box fallback: push out along nearest edge
          const penL = Math.abs(pos.x - w.minX);
          const penR = Math.abs(w.maxX - pos.x);
          const penT = Math.abs(pos.z - w.minZ);
          const penB = Math.abs(w.maxZ - pos.z);
          const m = Math.min(penL, penR, penT, penB);
          if (m === penL) pos.x = w.minX - radius;
          else if (m === penR) pos.x = w.maxX + radius;
          else if (m === penT) pos.z = w.minZ - radius;
          else pos.z = w.maxZ + radius;
        }
      }
    }

    pos.x = Math.max(-maxX, Math.min(maxX, pos.x));
    pos.z = Math.max(-maxZ, Math.min(maxZ, pos.z));

    // Safeguard against landing directly over a Void cell on chasm maps
    if (this.rawGrid) {
      const c = Math.floor((pos.x + this.rawGrid.halfX) / this.rawGrid.cellSize);
      const r = Math.floor((pos.z + this.rawGrid.halfZ) / this.rawGrid.cellSize);
      const ch = this.rawGrid.cells[r]?.[c];
      if (ch === 'V') {
        const snap = this.findNearestWalkable(pos.x, pos.z, 6);
        if (snap) {
          pos.x = snap.x;
          pos.z = snap.z;
        }
      }
    }
  }

  public getNearestWallNormal(pos: Vec3, probeDist = 0.9): Vec3 | null {
    let bestDist = probeDist;
    let nx = 0;
    let nz = 0;
    let found = false;

    for (const w of this.walls) {
      if (w.maxY < 0.35) continue;
      const cx = Math.max(w.minX, Math.min(w.maxX, pos.x));
      const cz = Math.max(w.minZ, Math.min(w.maxZ, pos.z));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < bestDist && d > 1e-4) {
        bestDist = d;
        nx = dx / d;
        nz = dz / d;
        found = true;
      }
    }
    return found ? { x: nx, y: 0, z: nz } : null;
  }

  public sampleTacticalAnchors(targetCount = 24, nearFilter?: Vec3, minSpacing = 6.5): Vec3[] {
    const candidates: Vec3[] = [];
    for (let gz = 2; gz < this.rows - 2; gz += 3) {
      for (let gx = 2; gx < this.cols - 2; gx += 3) {
        const idx = gz * this.cols + gx;
        if (this.blocked[idx]) continue;
        // Prefer open cells with zero wall adjacency
        if (this.proximityCost[idx] > 0.5) continue;
        const c = this.cellCenter(gx, gz);
        if (nearFilter && !this.arePointsConnected(nearFilter, c)) continue;
        if (candidates.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < minSpacing)) continue;
        candidates.push(c);
        if (candidates.length >= targetCount) return candidates;
      }
    }
    return candidates;
  }
}

export function navWallsFromBoxes(
  boxes: Array<{ min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }>,
): NavWallBox[] {
  return boxes.map((b) => ({
    minX: b.min.x,
    maxX: b.max.x,
    minZ: b.min.z,
    maxZ: b.max.z,
    maxY: b.max.y,
  }));
}
