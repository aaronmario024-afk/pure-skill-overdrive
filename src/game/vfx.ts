import * as THREE from 'three';
import { QualityTier } from './graphicsSettings';

export type ImpactSurfaceKind = 'concrete' | 'metal' | 'wood' | 'snow' | 'flesh' | 'generic';

interface TracerEntry {
  group: THREE.Group;
  coreMat: THREE.MeshBasicMaterial;
  haloMat: THREE.MeshBasicMaterial;
  age: number;
  ttl: number;
}

interface ParticleEntry {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  gravity: number;
  drag: number;
  age: number;
  ttl: number;
  growRate: number;
  baseOpacity: number;
}

interface DecalEntry {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  ttl: number;
}

interface CasingEntry {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  ttl: number;
}

interface ShockwaveEntry {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  ttl: number;
  maxScale: number;
}

function createBulletDecalTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 3, 32, 32, 30);
  grad.addColorStop(0.0, 'rgba(8,8,10,0.94)');
  grad.addColorStop(0.32, 'rgba(20,20,24,0.82)');
  grad.addColorStop(0.55, 'rgba(55,52,48,0.42)');
  grad.addColorStop(0.82, 'rgba(30,30,30,0.14)');
  grad.addColorStop(1.0, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  // Micro radial fractures around impact crater
  ctx.strokeStyle = 'rgba(12,12,14,0.6)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2 + 0.3;
    ctx.beginPath();
    ctx.moveTo(32 + Math.cos(ang) * 7, 32 + Math.sin(ang) * 7);
    ctx.lineTo(32 + Math.cos(ang) * 20, 32 + Math.sin(ang) * 20);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class VfxSystem {
  public readonly group = new THREE.Group();
  private quality: QualityTier;

  private tracers: TracerEntry[] = [];
  private particles: ParticleEntry[] = [];
  private decals: DecalEntry[] = [];
  private casings: CasingEntry[] = [];
  private shockwaves: ShockwaveEntry[] = [];

  private decalTex: THREE.CanvasTexture;
  private decalGeo = new THREE.PlaneGeometry(0.16, 0.16);
  private sparkGeo = new THREE.BoxGeometry(0.042, 0.042, 0.042);
  private smokeGeo = new THREE.IcosahedronGeometry(0.18, 1);
  private casingGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.042, 6);
  private ringGeo = new THREE.RingGeometry(0.35, 0.55, 24);

  constructor(scene: THREE.Scene, quality: QualityTier = 'high') {
    this.quality = quality;
    this.decalTex = createBulletDecalTexture();
    this.ringGeo.rotateX(-Math.PI / 2);
    scene.add(this.group);
  }

  public setQuality(quality: QualityTier): void {
    this.quality = quality;
  }

  private get caps() {
    if (this.quality === 'low') {
      return { tracers: 14, particles: 50, decals: 12, casings: 8 };
    }
    if (this.quality === 'medium') {
      return { tracers: 28, particles: 130, decals: 28, casings: 18 };
    }
    return { tracers: 48, particles: 250, decals: 54, casings: 34 };
  }

  public spawnTracer(from: THREE.Vector3, to: THREE.Vector3, colorHex = '#fde047', heavy = false): void {
    const dist = from.distanceTo(to);
    if (dist < 0.05) return;

    while (this.tracers.length >= this.caps.tracers) {
      const oldest = this.tracers.shift()!;
      this.group.remove(oldest.group);
      oldest.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
      });
      oldest.coreMat.dispose();
      oldest.haloMat.dispose();
    }

    const tracerGroup = new THREE.Group();
    const coreRadius = heavy ? 0.022 : 0.013;
    const coreGeo = new THREE.CylinderGeometry(coreRadius * 0.45, coreRadius, dist, 5, 1, true);
    coreGeo.rotateX(Math.PI / 2);
    const coreMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    tracerGroup.add(core);

    const haloMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    if (this.quality !== 'low') {
      const haloGeo = new THREE.CylinderGeometry(coreRadius * 1.4, coreRadius * 2.5, dist, 6, 1, true);
      haloGeo.rotateX(Math.PI / 2);
      const halo = new THREE.Mesh(haloGeo, haloMat);
      tracerGroup.add(halo);
    }

    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    tracerGroup.position.copy(mid);
    tracerGroup.lookAt(to);
    this.group.add(tracerGroup);

    this.tracers.push({ group: tracerGroup, coreMat, haloMat, age: 0, ttl: heavy ? 0.11 : 0.075 });
  }

  public spawnImpact(
    pos: THREE.Vector3,
    normal: THREE.Vector3,
    kind: ImpactSurfaceKind = 'concrete',
    isHeadshot = false,
  ): void {
    const count = this.quality === 'low' ? 3 : this.quality === 'medium' ? 6 : 10;
    const baseColor =
      kind === 'flesh'
        ? isHeadshot
          ? '#f87171'
          : '#dc2626'
        : kind === 'metal'
          ? '#fde047'
          : kind === 'snow'
            ? '#e2e8f0'
            : kind === 'wood'
              ? '#d97706'
              : '#cbd5e1';

    for (let i = 0; i < count; i++) {
      this.pushParticle({
        pos,
        vel: new THREE.Vector3(
          normal.x * (2.2 + Math.random() * 4.5) + (Math.random() - 0.5) * 4.2,
          normal.y * (2.2 + Math.random() * 4.5) + (Math.random() - 0.15) * 4.0,
          normal.z * (2.2 + Math.random() * 4.5) + (Math.random() - 0.5) * 4.2,
        ),
        color: kind === 'metal' && i % 2 === 0 ? '#ffffff' : baseColor,
        scale: kind === 'metal' ? 0.65 : 1.0,
        gravity: kind === 'snow' ? 6.5 : 13.5,
        drag: 2.2,
        ttl: 0.22 + Math.random() * 0.22,
        growRate: 0,
        emissive: kind === 'metal' || isHeadshot,
        opacity: 0.92,
      });
    }

    // Subtle dust puff on stone/concrete/wood/snow
    if (this.quality !== 'low' && kind !== 'flesh') {
      this.pushParticle({
        pos: pos.clone().addScaledVector(normal, 0.08),
        vel: normal.clone().multiplyScalar(0.85),
        color: kind === 'snow' ? '#f8fafc' : '#94a3b8',
        scale: 0.55,
        gravity: -0.4,
        drag: 3.5,
        ttl: 0.36,
        growRate: 2.2,
        emissive: false,
        opacity: 0.38,
        useSmokeGeo: true,
      });
    }
  }

  public spawnDecal(pos: THREE.Vector3, normal: THREE.Vector3, scale = 1.0): void {
    while (this.decals.length >= this.caps.decals) {
      const oldest = this.decals.shift()!;
      this.group.remove(oldest.mesh);
      oldest.mat.dispose();
    }
    const mat = new THREE.MeshBasicMaterial({
      map: this.decalTex,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const m = new THREE.Mesh(this.decalGeo, mat);
    m.position.copy(pos).addScaledVector(normal, 0.015);
    m.lookAt(pos.clone().add(normal));
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(scale);
    this.group.add(m);
    this.decals.push({ mesh: m, mat, age: 0, ttl: 14 });
  }

  public spawnShellCasing(
    origin: THREE.Vector3,
    rightDir: THREE.Vector3,
    upDir: THREE.Vector3,
    isShotgun = false,
  ): void {
    if (this.quality === 'low') return;
    while (this.casings.length >= this.caps.casings) {
      const oldest = this.casings.shift()!;
      this.group.remove(oldest.mesh);
      (oldest.mesh.material as THREE.Material).dispose();
    }
    const mat = new THREE.MeshStandardMaterial({
      color: isShotgun ? '#b91c1c' : '#d4a338',
      roughness: isShotgun ? 0.55 : 0.24,
      metalness: isShotgun ? 0.15 : 0.92,
    });
    const m = new THREE.Mesh(this.casingGeo, mat);
    m.position.copy(origin);
    if (isShotgun) m.scale.set(1.5, 1.35, 1.5);
    this.group.add(m);

    const vel = rightDir
      .clone()
      .multiplyScalar(1.8 + Math.random() * 1.1)
      .addScaledVector(upDir, 1.5 + Math.random() * 0.9);
    const spin = new THREE.Vector3(
      (Math.random() - 0.5) * 26,
      (Math.random() - 0.5) * 26,
      (Math.random() - 0.5) * 26,
    );
    this.casings.push({ mesh: m, vel, spin, age: 0, ttl: 1.9 });
  }

  public spawnExplosion(pos: THREE.Vector3, radius = 6): void {
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#fb923c',
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.position.copy(pos).setY(Math.max(0.06, pos.y + 0.06));
    this.group.add(ring);
    this.shockwaves.push({ mesh: ring, mat: ringMat, age: 0, ttl: 0.42, maxScale: radius * 1.8 });

    const sparkCount = this.quality === 'high' ? 28 : this.quality === 'medium' ? 18 : 10;
    for (let i = 0; i < sparkCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 4 + Math.random() * 11;
      this.pushParticle({
        pos,
        vel: new THREE.Vector3(Math.cos(a) * spd, 3 + Math.random() * 8, Math.sin(a) * spd),
        color: i % 3 === 0 ? '#fef08a' : '#f97316',
        scale: 1.35,
        gravity: 12,
        drag: 1.8,
        ttl: 0.4 + Math.random() * 0.35,
        growRate: 0,
        emissive: true,
        opacity: 0.95,
      });
    }

    const smokeCount = this.quality === 'high' ? 14 : 7;
    for (let i = 0; i < smokeCount; i++) {
      const a = Math.random() * Math.PI * 2;
      this.pushParticle({
        pos: pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.6, 0.4, Math.sin(a) * 0.6)),
        vel: new THREE.Vector3(Math.cos(a) * 1.4, 2.2 + Math.random() * 2.5, Math.sin(a) * 1.4),
        color: i % 2 === 0 ? '#334155' : '#475569',
        scale: 1.6,
        gravity: -0.9,
        drag: 2.0,
        ttl: 0.9 + Math.random() * 0.5,
        growRate: 2.6,
        emissive: false,
        opacity: 0.55,
        useSmokeGeo: true,
      });
    }
  }

  private pushParticle(opts: {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    color: string;
    scale: number;
    gravity: number;
    drag: number;
    ttl: number;
    growRate: number;
    emissive: boolean;
    opacity: number;
    useSmokeGeo?: boolean;
  }): void {
    while (this.particles.length >= this.caps.particles) {
      const oldest = this.particles.shift()!;
      this.group.remove(oldest.mesh);
      (oldest.mesh.material as THREE.Material).dispose();
    }
    const mat = new THREE.MeshBasicMaterial({
      color: opts.color,
      transparent: true,
      opacity: opts.opacity,
      depthWrite: !opts.useSmokeGeo,
      blending: opts.emissive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const m = new THREE.Mesh(opts.useSmokeGeo ? this.smokeGeo : this.sparkGeo, mat);
    m.position.copy(opts.pos);
    m.scale.setScalar(opts.scale);
    this.group.add(m);
    this.particles.push({
      mesh: m,
      vel: opts.vel,
      gravity: opts.gravity,
      drag: opts.drag,
      age: 0,
      ttl: opts.ttl,
      growRate: opts.growRate,
      baseOpacity: opts.opacity,
    });
  }

  public update(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.age += dt;
      const t = tr.age / tr.ttl;
      if (t >= 1) {
        this.group.remove(tr.group);
        tr.group.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
        });
        tr.coreMat.dispose();
        tr.haloMat.dispose();
        this.tracers.splice(i, 1);
      } else {
        tr.coreMat.opacity = 0.92 * (1 - t);
        tr.haloMat.opacity = 0.55 * (1 - t);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.ttl) {
        this.group.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      const dampFactor = Math.exp(-p.drag * dt);
      p.vel.multiplyScalar(dampFactor);
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.03) {
        p.mesh.position.y = 0.03;
        p.vel.y = Math.abs(p.vel.y) * 0.35;
      }
      if (p.growRate > 0) {
        p.mesh.scale.addScalar(p.growRate * dt);
      }
      const t = p.age / p.ttl;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.baseOpacity * (1 - t * t);
    }

    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.age += dt;
      if (c.age >= c.ttl) {
        this.group.remove(c.mesh);
        (c.mesh.material as THREE.Material).dispose();
        this.casings.splice(i, 1);
        continue;
      }
      c.vel.y -= 13.5 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      if (c.mesh.position.y < 0.025) {
        c.mesh.position.y = 0.025;
        c.vel.y = Math.abs(c.vel.y) * 0.36;
        c.vel.x *= 0.65;
        c.vel.z *= 0.65;
        c.spin.multiplyScalar(0.5);
      }
    }

    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.age += dt;
      if (d.age >= d.ttl) {
        this.group.remove(d.mesh);
        d.mat.dispose();
        this.decals.splice(i, 1);
      } else if (d.age > d.ttl * 0.75) {
        const remain = 1 - (d.age - d.ttl * 0.75) / (d.ttl * 0.25);
        d.mat.opacity = 0.88 * Math.max(0, remain);
      }
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.age += dt;
      const t = s.age / s.ttl;
      if (t >= 1) {
        this.group.remove(s.mesh);
        s.mat.dispose();
        this.shockwaves.splice(i, 1);
      } else {
        s.mesh.scale.setScalar(1 + t * s.maxScale);
        s.mat.opacity = 0.85 * (1 - t);
      }
    }
  }

  public clear(): void {
    for (const tr of this.tracers) {
      this.group.remove(tr.group);
      tr.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
      });
      tr.coreMat.dispose();
      tr.haloMat.dispose();
    }
    this.tracers.length = 0;

    for (const p of this.particles) {
      this.group.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.particles.length = 0;

    for (const d of this.decals) {
      this.group.remove(d.mesh);
      d.mat.dispose();
    }
    this.decals.length = 0;

    for (const c of this.casings) {
      this.group.remove(c.mesh);
      (c.mesh.material as THREE.Material).dispose();
    }
    this.casings.length = 0;

    for (const s of this.shockwaves) {
      this.group.remove(s.mesh);
      s.mat.dispose();
    }
    this.shockwaves.length = 0;
  }

  public dispose(): void {
    this.clear();
    this.decalTex.dispose();
    this.decalGeo.dispose();
    this.sparkGeo.dispose();
    this.smokeGeo.dispose();
    this.casingGeo.dispose();
    this.ringGeo.dispose();
    this.group.parent?.remove(this.group);
  }
}
