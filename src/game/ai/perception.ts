import { BotMemory } from './memory';
import {
  AiCombatantInput,
  BotDifficultyConfig,
  PerceivedThreat,
  SoundEvent,
  Vec3,
  WorldQueryApi,
} from './types';

export class SoundBus {
  private events: SoundEvent[] = [];
  private seq = 0;

  public emit(ev: Omit<SoundEvent, 'id'>): void {
    this.events.push({ ...ev, id: `snd_${++this.seq}` });
    if (this.events.length > 64) this.events.shift();
  }

  public queryRecent(now: number, maxAgeSec = 4.0): SoundEvent[] {
    this.events = this.events.filter((e) => now - e.time <= maxAgeSec);
    return this.events;
  }

  public clear(): void {
    this.events = [];
  }
}

export class BotPerceptionSystem {
  public update(
    self: AiCombatantInput,
    allActors: AiCombatantInput[],
    isFfaMode: boolean,
    now: number,
    diff: BotDifficultyConfig,
    world: WorldQueryApi,
    soundBus: SoundBus,
    memory: BotMemory,
  ): { visibleEnemies: PerceivedThreat[]; visibleTeammates: AiCombatantInput[] } {
    const eyePos: Vec3 = { x: self.pos.x, y: self.pos.y + 1.68, z: self.pos.z };
    // Bot model faces +Z at yaw=0: forward = (sin(yaw), 0, cos(yaw))
    const fwdX = Math.sin(self.yaw);
    const fwdZ = Math.cos(self.yaw);
    const halfFovCos = Math.cos(((diff.fovDeg * 0.5) * Math.PI) / 180);
    const peripheralCos = Math.cos((85 * Math.PI) / 180);

    const aliveIds = new Set<string>();
    const visibleEnemies: PerceivedThreat[] = [];
    const visibleTeammates: AiCombatantInput[] = [];

    for (const other of allActors) {
      if (!other.alive || other.id === self.id) continue;
      aliveIds.add(other.id);

      const isFriendly = !isFfaMode && other.team === self.team;
      const otherEye: Vec3 = { x: other.pos.x, y: other.pos.y + 1.56, z: other.pos.z };
      const dx = otherEye.x - eyePos.x;
      const dz = otherEye.z - eyePos.z;
      const dist = Math.hypot(dx, dz);

      if (isFriendly) {
        if (dist <= 32 && world.hasLineOfSight(eyePos, otherEye)) {
          visibleTeammates.push(other);
          memory.teammates.set(other.id, { pos: { ...other.pos }, time: now });
        }
        continue;
      }

      if (dist > diff.sightRange) continue;

      let inFov = dist < 1.6;
      if (!inFov && dist > 1e-4) {
        const dot = (dx * fwdX + dz * fwdZ) / dist;
        inFov = dot >= halfFovCos || (dist <= 4.5 && dot >= peripheralCos);
      }
      if (!inFov) continue;

      if (!world.hasLineOfSight(eyePos, otherEye)) continue;

      const threat: PerceivedThreat = {
        actorId: other.id,
        pos: { ...other.pos },
        eyePos: otherEye,
        vel: { ...other.vel },
        distance: dist,
        lastSeenAt: now,
        visible: true,
        fromSound: false,
        confidence: 1.0,
        isHuman: other.isHuman,
      };
      visibleEnemies.push(threat);
      memory.upsertThreat(threat);
    }

    // Mark previously visible threats that are no longer directly seen as unseen
    const visSet = new Set(visibleEnemies.map((t) => t.actorId));
    for (const [id, th] of memory.enemies.entries()) {
      if (!visSet.has(id)) {
        th.visible = false;
      }
    }

    // Fair audio perception from recent gunshots, bomb beeps/plants, and loud footsteps
    const sounds = soundBus.queryRecent(now, 3.5);
    for (const ev of sounds) {
      if (ev.sourceId === self.id) continue;
      if (!isFfaMode && ev.team === self.team && ev.kind !== 'bomb_beep') continue;
      if (!aliveIds.has(ev.sourceId) && ev.kind !== 'bomb_beep') continue;
      if (visSet.has(ev.sourceId)) continue;

      const d = Math.hypot(ev.pos.x - self.pos.x, ev.pos.z - self.pos.z);
      const effectiveRadius = ev.radius * diff.hearingMult;
      if (d <= effectiveRadius) {
        const key = ev.kind === 'bomb_beep' ? 'sound_bomb' : ev.sourceId;
        const prev = memory.enemies.get(key);
        if (!prev || now - prev.lastSeenAt > 0.45) {
          // Deterministic slight spatial scatter so sound isn't wallhack pinpoint
          const jitterAngle = ((self.id.charCodeAt(0) + Math.floor(ev.time * 10)) % 360) * (Math.PI / 180);
          const jitterMag = Math.min(2.2, d * 0.08);
          memory.upsertThreat({
            actorId: key,
            pos: {
              x: ev.pos.x + Math.cos(jitterAngle) * jitterMag,
              y: 0,
              z: ev.pos.z + Math.sin(jitterAngle) * jitterMag,
            },
            eyePos: { x: ev.pos.x, y: 1.5, z: ev.pos.z },
            vel: { x: 0, y: 0, z: 0 },
            distance: d,
            lastSeenAt: ev.time,
            visible: false,
            fromSound: true,
            confidence: ev.kind === 'gunshot' ? 0.78 : 0.55,
            isHuman: false,
          });
        }
      }
    }

    // Memory decay & cleanup
    aliveIds.add('sound_bomb');
    memory.decay(now, diff.memoryDuration, aliveIds);

    visibleEnemies.sort((a, b) => a.distance - b.distance);
    return { visibleEnemies, visibleTeammates };
  }
}
