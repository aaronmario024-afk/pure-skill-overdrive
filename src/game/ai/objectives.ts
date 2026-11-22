import { ObjectiveInfo, Vec3 } from './types';

export class ObjectiveManager {
  public objectives: ObjectiveInfo[] = [];
  public version = 0;
  private lastHash = '';

  public update(nextObjectives: ObjectiveInfo[]): boolean {
    this.objectives = nextObjectives;
    const hash = nextObjectives
      .map(
        (o) =>
          `${o.id}:${o.kind}:${o.active ? 1 : 0}:${o.contested ? 1 : 0}:${o.requiresInteraction ? 1 : 0}:${Math.round(o.pos.x)}_${Math.round(o.pos.z)}`,
      )
      .join('|');
    if (hash !== this.lastHash) {
      this.lastHash = hash;
      this.version++;
      return true;
    }
    return false;
  }

  public getPrimaryActive(): ObjectiveInfo | null {
    return this.objectives.find((o) => o.active) ?? null;
  }

  public getByKind(kind: ObjectiveInfo['kind']): ObjectiveInfo | null {
    return this.objectives.find((o) => o.kind === kind && o.active) ?? this.objectives.find((o) => o.kind === kind) ?? null;
  }

  public getClosest(pos: Vec3, kind?: ObjectiveInfo['kind']): ObjectiveInfo | null {
    let best: ObjectiveInfo | null = null;
    let bestD = Infinity;
    for (const o of this.objectives) {
      if (!o.active) continue;
      if (kind && o.kind !== kind) continue;
      const d = Math.hypot(o.pos.x - pos.x, o.pos.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }
}
