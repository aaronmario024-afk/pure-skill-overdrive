import * as THREE from 'three';
import { BotAIManager } from './brain';
import { BotDebugSnapshot, Vec3 } from './types';

export class AiDebugVisualizer {
  private panelEl: HTMLDivElement;
  private tmpVec = new THREE.Vector3();

  constructor(hudRoot: HTMLElement) {
    this.panelEl = document.createElement('div');
    this.panelEl.className = 'ai-debug-panel hidden';
    hudRoot.appendChild(this.panelEl);
  }

  public render(
    enabled: boolean,
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    camera: THREE.PerspectiveCamera,
    ai: BotAIManager,
  ): void {
    this.panelEl.classList.toggle('hidden', !enabled);
    if (!enabled) return;

    const snapshots = ai.getAllDebugSnapshots();
    const project = (p: Vec3, yOffset = 0.2): [number, number] | null => {
      this.tmpVec.set(p.x, p.y + yOffset, p.z).project(camera);
      if (this.tmpVec.z > 1) return null;
      return [(this.tmpVec.x * 0.5 + 0.5) * w, (-this.tmpVec.y * 0.5 + 0.5) * h];
    };

    // Draw Map Boundary & Sampled Walkable NavMesh Nodes (Phase 15 Map & Nav Debug Overlay)
    {
      const hx = ai.nav.halfX;
      const hz = ai.nav.halfZ;
      const corners: Vec3[] = [
        { x: -hx, y: 0, z: -hz },
        { x: hx, y: 0, z: -hz },
        { x: hx, y: 0, z: hz },
        { x: -hx, y: 0, z: hz },
      ];
      ctx.save();
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = project(corners[i], 0.1);
        const b = project(corners[(i + 1) % 4], 0.1);
        if (a && b) {
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
        }
      }
      ctx.stroke();

      // Sample NavGrid cells near camera to visualize walkable green vs blocked red collision geometry
      const camX = camera.position.x;
      const camZ = camera.position.z;
      const [cgx, cgz] = ai.nav.worldToCell(camX, camZ);
      const rad = 11;
      for (let dz = -rad; dz <= rad; dz += 2) {
        for (let dx = -rad; dx <= rad; dx += 2) {
          const gx = cgx + dx;
          const gz = cgz + dz;
          if (gx < 0 || gz < 0 || gx >= ai.nav.cols || gz >= ai.nav.rows) continue;
          const cPos = ai.nav.cellCenter(gx, gz);
          const sp = project(cPos, 0.05);
          if (!sp) continue;
          const walk = ai.nav.isCellWalkable(gx, gz);
          ctx.fillStyle = walk ? 'rgba(74, 222, 128, 0.42)' : 'rgba(248, 113, 113, 0.52)';
          ctx.fillRect(sp[0] - 2, sp[1] - 2, 4, 4);
        }
      }
      ctx.restore();
    }

    // Draw Objective Markers & Zone Radii
    for (const obj of ai.objectives.objectives) {
      if (!obj.active) continue;
      const sc = project(obj.pos, 0.8);
      if (!sc) continue;
      ctx.save();
      ctx.strokeStyle = obj.contested ? '#facc15' : '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(sc[0] - 12, sc[1] - 12, 24, 24);
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(`${obj.id.toUpperCase()} (r=${obj.radius.toFixed(1)}m)`, sc[0], sc[1] - 16);
      ctx.restore();
    }

    // Draw Bot Navigation Paths, Destinations, and Role/Stuck Labels
    for (const s of snapshots) {
      if (!s.alive) continue;
      const col =
        s.stuckClass === 'blocked_obstacle' || s.stuckClass === 'blocked_teammate' || s.stuckClass === 'nav_failed'
          ? '#ef4444'
          : s.side === 'attackers'
            ? '#fb923c'
            : s.side === 'defenders'
              ? '#38bdf8'
              : '#c084fc';

      if (s.pathPoints.length > 0 && s.pathIndex < s.pathPoints.length) {
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        const p0 = project(s.pos, 0.15);
        let started = false;
        if (p0) {
          ctx.moveTo(p0[0], p0[1]);
          started = true;
        }
        for (let i = s.pathIndex; i < s.pathPoints.length; i++) {
          const pp = project(s.pathPoints[i], 0.15);
          if (!pp) continue;
          if (!started) {
            ctx.moveTo(pp[0], pp[1]);
            started = true;
          } else {
            ctx.lineTo(pp[0], pp[1]);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Waypoint nodes
        for (let i = s.pathIndex; i < s.pathPoints.length; i++) {
          const pp = project(s.pathPoints[i], 0.15);
          if (!pp) continue;
          ctx.fillStyle = col;
          ctx.fillRect(pp[0] - 2.5, pp[1] - 2.5, 5, 5);
        }
        ctx.restore();
      }

      if (s.destination) {
        const dp = project(s.destination, 0.15);
        if (dp) {
          ctx.save();
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(dp[0], dp[1], 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      const hp = project(s.pos, 2.25);
      if (hp) {
        ctx.save();
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(9,13,20,0.8)';
        const txt = `${s.name} [${s.role}/${s.profile[0].toUpperCase()}] ${s.action} v=${s.speed.toFixed(1)}`;
        const tw = ctx.measureText(txt).width + 8;
        ctx.fillRect(hp[0] - tw / 2, hp[1] - 12, tw, 15);
        ctx.fillStyle = col;
        ctx.fillText(txt, hp[0], hp[1] - 1);
        if (s.recoveryLevel > 0) {
          ctx.fillStyle = '#facc15';
          ctx.fillText(`STUCK:${s.stuckClass} L${s.recoveryLevel}`, hp[0], hp[1] - 16);
        }
        ctx.restore();
      }
    }

    this.renderPanelTable(ai, snapshots);
  }

  private renderPanelTable(ai: BotAIManager, snapshots: BotDebugSnapshot[]): void {
    const rows = snapshots
      .map((s) => {
        const stuckTag =
          s.recoveryLevel > 0
            ? `<span style="color:#f87171">${s.stuckClass}(L${s.recoveryLevel})</span>`
            : `<span style="color:#94a3b8">${s.stuckClass}</span>`;
        const destStr = s.destination
          ? `${Math.round(s.destination.x)},${Math.round(s.destination.z)}`
          : '-';
        return `<tr class="${s.alive ? '' : 'dead'}">
          <td>${s.name}</td>
          <td>${s.role}</td>
          <td>${s.profile}</td>
          <td>${s.action}(${s.priority.toFixed(2)})</td>
          <td>${s.pathStatus}:${destStr}</td>
          <td>${s.speed.toFixed(1)}</td>
          <td>${stuckTag}</td>
          <td>V:${s.visibleEnemyCount} H:${s.heardEnemyCount}</td>
          <td title="${s.lastTransitionReason}">${s.lastRecovery !== 'none' ? s.lastRecovery : s.lastTransitionReason}</td>
        </tr>`;
      })
      .join('');

    this.panelEl.innerHTML = `
      <div class="ai-dbg-head">AI DEBUG [F3] · Mode: ${ai.adapter.modeId.toUpperCase()} · Diff: ${ai.difficulty.toUpperCase()} · NavCells: ${ai.nav.walkableCount}</div>
      <table>
        <thead><tr><th>Bot</th><th>Role</th><th>Profile</th><th>Action</th><th>Nav:Dest</th><th>Spd</th><th>Stuck</th><th>Percep</th><th>Reason / Recovery</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  public dispose(): void {
    this.panelEl.remove();
  }
}
