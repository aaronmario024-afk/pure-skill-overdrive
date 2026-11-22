import * as THREE from 'three';
import { ModeId } from '../data/modes';
import { QualityTier } from './graphicsSettings';
import { createPBRSurface } from './textures';

export interface EnvDetailsHandle {
  group: THREE.Group;
  update: (elapsedSec: number, dt: number) => void;
  dispose: () => void;
}

export interface SimpleBoxSpec {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  wallType: string;
  matKind?: string;
  material?: string;
}

function hash2d(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function createContactAoTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 16, 64, 64, 64);
  grad.addColorStop(0.0, 'rgba(0,0,0,0.46)');
  grad.addColorStop(0.62, 'rgba(0,0,0,0.32)');
  grad.addColorStop(0.85, 'rgba(0,0,0,0.12)');
  grad.addColorStop(1.0, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function createNeonSignTexture(text: string, borderHex: string, fillHex: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#090b16';
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = borderHex;
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 244, 84);
  ctx.fillStyle = fillHex;
  ctx.font = 'bold 34px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 49);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSkylineWindowGridTexture(theme: 'urban' | 'snow' | 'night' | 'sandstone' | 'cyber'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle =
    theme === 'urban'
      ? '#94a3b8'
      : theme === 'sandstone'
        ? '#85684a'
        : theme === 'snow'
          ? '#1e293b'
          : '#0f172a';
  ctx.fillRect(0, 0, 256, 512);

  const cols = 6;
  const rows = 14;
  const padX = 12;
  const padY = 14;
  const cellW = (256 - padX * 2) / cols;
  const cellH = (512 - padY * 2) / rows;

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const h = hash2d(col * 7 + 3, r * 11 + 5);
      if (theme === 'night' || theme === 'cyber') {
        ctx.fillStyle = h > 0.68 ? '#38bdf8' : h > 0.45 ? '#fde047' : h > 0.28 ? '#e879f9' : '#1e293b';
      } else if (theme === 'snow') {
        ctx.fillStyle = h > 0.62 ? '#7dd3fc' : h > 0.35 ? '#334155' : '#0f172a';
      } else {
        ctx.fillStyle = h > 0.55 ? '#334155' : h > 0.25 ? '#475569' : '#e2e8f0';
      }
      ctx.fillRect(padX + col * cellW + 4, padY + r * cellH + 4, cellW - 8, cellH - 10);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addAtmosphericMotes(
  group: THREE.Group,
  halfX: number,
  halfZ: number,
  count: number,
  colorHex: string,
  size: number,
  fallSpeed: number,
): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (hash2d(i, 3) - 0.5) * halfX * 1.9;
    positions[i * 3 + 1] = 0.6 + hash2d(i, 9) * 9.5;
    positions[i * 3 + 2] = (hash2d(i, 17) - 0.5) * halfZ * 1.9;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: colorHex,
    size,
    transparent: true,
    opacity: fallSpeed > 0.5 ? 0.58 : 0.34,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.userData = { fallSpeed, halfX, halfZ };
  group.add(pts);
  return pts;
}

/**
 * Adds a 3D multi-layered sidewalk plinth, chamfered stone curb, hazard tactile paving strip,
 * and recessed cast-iron drainage grates around the base of a solid building structure.
 */
function addLayeredSidewalkAndCurb(
  group: THREE.Group,
  obs: SimpleBoxSpec,
  sidewalkMat: THREE.Material,
  curbMat: THREE.Material,
  hazardMat: THREE.Material,
  grateMat: THREE.Material,
): void {
  const apronMargin = 0.44;
  const swW = obs.w + apronMargin * 2;
  const swD = obs.d + apronMargin * 2;

  // 1. Outer chamfered curb foundation (h = 0.044m)
  const curbBase = new THREE.Mesh(new THREE.BoxGeometry(swW + 0.10, 0.044, swD + 0.10), curbMat);
  curbBase.position.set(obs.x, 0.022, obs.z);
  curbBase.receiveShadow = true;
  group.add(curbBase);

  // 2. Raised concrete sidewalk slab (h = 0.056m)
  const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(swW, 0.056, swD), sidewalkMat);
  sidewalk.position.set(obs.x, 0.028, obs.z);
  sidewalk.receiveShadow = true;
  group.add(sidewalk);

  // 3. Yellow / cyan tactile warning paving strip along longer building facades
  const wideX = obs.w >= obs.d;
  for (const sgn of [-1, 1]) {
    const tactile = new THREE.Mesh(
      wideX
        ? new THREE.BoxGeometry(Math.max(0.8, obs.w * 0.82), 0.008, 0.11)
        : new THREE.BoxGeometry(0.11, 0.008, Math.max(0.8, obs.d * 0.82)),
      hazardMat,
    );
    if (wideX) {
      tactile.position.set(obs.x, 0.059, obs.z + sgn * (obs.d * 0.5 + apronMargin - 0.11));
    } else {
      tactile.position.set(obs.x + sgn * (obs.w * 0.5 + apronMargin - 0.11), 0.059, obs.z);
    }
    group.add(tactile);

    // 4. Recessed cast-iron storm drain grate in road gutter outside the curb
    const grate = new THREE.Mesh(
      wideX ? new THREE.BoxGeometry(0.52, 0.018, 0.24) : new THREE.BoxGeometry(0.24, 0.018, 0.52),
      grateMat,
    );
    if (wideX) {
      grate.position.set(obs.x, 0.009, obs.z + sgn * (obs.d * 0.5 + apronMargin + 0.22));
    } else {
      grate.position.set(obs.x + sgn * (obs.w * 0.5 + apronMargin + 0.22), 0.009, obs.z);
    }
    group.add(grate);
  }
}

/**
 * Adds multi-scale 3D architectural depth to a solid building block:
 * - Two-tier foundation plinth + colored water-table band
 * - Corner & bay structural pilasters (columns) with capitals
 * - Projecting upper cornice frieze with 3D dentil/corbel blocks
 * - Recessed multi-pane windows with 3D sills, lintels & cross-mullions
 * - Color-blocked cladding / louver vent panels
 * - Cantilevered 2nd-story balconies with soffit lights & handrails (at y >= 3.18m)
 * - Rooftop safety guardrails, cascading greenery planters or industrial pipe manifolds
 */
function addBuildingArchitecturalDepth(opts: {
  group: THREE.Group;
  obs: SimpleBoxSpec;
  theme: 'urban' | 'snow' | 'night' | 'sandstone' | 'cyber';
  pilasterMat: THREE.Material;
  accentBandMat: THREE.Material;
  claddingMat: THREE.Material;
  frameMat: THREE.Material;
  glassMat: THREE.Material;
  foliageMat: THREE.Material;
  bannerMat: THREE.Material;
  pipeMat: THREE.Material;
  junctionMat: THREE.Material;
  seed: number;
  allowBalcony: boolean;
  allowRooftopRail: boolean;
}): void {
  const {
    group,
    obs,
    theme,
    pilasterMat,
    accentBandMat,
    claddingMat,
    frameMat,
    glassMat,
    foliageMat,
    bannerMat,
    pipeMat,
    junctionMat,
    seed,
    allowBalcony,
    allowRooftopRail,
  } = opts;
  const wideX = obs.w >= obs.d;
  const topY = obs.y + obs.h * 0.5;

  // 1. Stepped foundation water-table accent band around base (y = 0.34m, inspired by Image 1)
  const accentBand = new THREE.Mesh(
    new THREE.BoxGeometry(obs.w + 0.13, 0.09, obs.d + 0.13),
    accentBandMat,
  );
  accentBand.position.set(obs.x, 0.34, obs.z);
  group.add(accentBand);

  // 2. Corner & mid-wall vertical structural pilasters (3D columns with capital blocks)
  const cornerX = [-obs.w * 0.5 + 0.11, obs.w * 0.5 - 0.11];
  const cornerZ = [-obs.d * 0.5 + 0.11, obs.d * 0.5 - 0.11];
  for (const cx of cornerX) {
    for (const cz of cornerZ) {
      const pilaster = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, obs.h - 0.1, 0.26),
        pilasterMat,
      );
      pilaster.position.set(obs.x + cx, obs.h * 0.5, obs.z + cz);
      pilaster.castShadow = true;
      group.add(pilaster);
    }
  }

  // Intermediate pilasters every ~3.4m along the primary facade
  const spanLen = wideX ? obs.w : obs.d;
  const numBays = Math.max(1, Math.min(4, Math.floor(spanLen / 3.2)));
  if (numBays >= 2) {
    for (let b = 1; b < numBays; b++) {
      const offset = -spanLen * 0.5 + (b / numBays) * spanLen;
      for (const sgn of [-1, 1]) {
        const midPil = new THREE.Mesh(
          wideX
            ? new THREE.BoxGeometry(0.22, obs.h - 0.15, 0.10)
            : new THREE.BoxGeometry(0.10, obs.h - 0.15, 0.22),
          pilasterMat,
        );
        if (wideX) {
          midPil.position.set(obs.x + offset, obs.h * 0.5, obs.z + sgn * (obs.d * 0.5 + 0.03));
        } else {
          midPil.position.set(obs.x + sgn * (obs.w * 0.5 + 0.03), obs.h * 0.5, obs.z + offset);
        }
        group.add(midPil);
      }
    }
  }

  // 3. Upper Cornice Frieze & Rhythmic 3D Dentil / Corbel Molding (inspired by Image 2)
  const corniceY = topY - 0.26;
  const cornice = new THREE.Mesh(
    new THREE.BoxGeometry(obs.w + 0.20, 0.14, obs.d + 0.20),
    pilasterMat,
  );
  cornice.position.set(obs.x, corniceY, obs.z);
  group.add(cornice);

  // Dentil blocks under the cornice along primary facade
  const dentilCount = Math.min(8, Math.max(3, Math.floor(spanLen / 1.1)));
  for (let dIdx = 0; dIdx < dentilCount; dIdx++) {
    const dPos = -spanLen * 0.42 + (dIdx / Math.max(1, dentilCount - 1)) * (spanLen * 0.84);
    for (const sgn of [-1, 1]) {
      const dentil = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.16), pilasterMat);
      if (wideX) {
        dentil.position.set(obs.x + dPos, corniceY - 0.11, obs.z + sgn * (obs.d * 0.5 + 0.05));
      } else {
        dentil.position.set(obs.x + sgn * (obs.w * 0.5 + 0.05), corniceY - 0.11, obs.z + dPos);
      }
      group.add(dentil);
    }
  }

  // 4. Color-Blocked Architectural Cladding Panel & Recessed Louver Vents (inspired by Image 3)
  if (spanLen >= 3.0 && seed > 0.28) {
    const panelLen = Math.min(2.6, spanLen * 0.45);
    const panelH = 1.35;
    const panelY = 2.15;
    const faceSign = seed > 0.64 ? 1 : -1;
    const cladding = new THREE.Mesh(
      wideX ? new THREE.BoxGeometry(panelLen, panelH, 0.045) : new THREE.BoxGeometry(0.045, panelH, panelLen),
      claddingMat,
    );
    if (wideX) {
      cladding.position.set(obs.x, panelY, obs.z + faceSign * (obs.d * 0.5 + 0.022));
    } else {
      cladding.position.set(obs.x + faceSign * (obs.w * 0.5 + 0.022), panelY, obs.z);
    }
    group.add(cladding);

    // 3 vertical louver vent slots inset on the cladding panel
    for (const lOff of [-0.45, 0, 0.45]) {
      const louver = new THREE.Mesh(
        wideX ? new THREE.BoxGeometry(0.18, 0.68, 0.06) : new THREE.BoxGeometry(0.06, 0.68, 0.18),
        frameMat,
      );
      if (wideX) {
        louver.position.set(obs.x + lOff, panelY, obs.z + faceSign * (obs.d * 0.5 + 0.028));
      } else {
        louver.position.set(obs.x + faceSign * (obs.w * 0.5 + 0.028), panelY, obs.z + lOff);
      }
      group.add(louver);
    }
  }

  // 5. Deeply Framed Multi-Pane Windows with Sill, Lintel & Cross-Mullions (inspired by Image 1)
  if (obs.w >= 2.8 && obs.d >= 1.8) {
    const winW = 1.18;
    const winH = 0.92;
    const winY = 2.72;
    for (const sign of [-1, 1]) {
      // Projecting lower window sill & upper lintel
      const sill = new THREE.Mesh(
        wideX ? new THREE.BoxGeometry(winW + 0.24, 0.09, 0.12) : new THREE.BoxGeometry(0.12, 0.09, winW + 0.24),
        pilasterMat,
      );
      const lintel = new THREE.Mesh(
        wideX ? new THREE.BoxGeometry(winW + 0.26, 0.12, 0.12) : new THREE.BoxGeometry(0.12, 0.12, winW + 0.26),
        pilasterMat,
      );
      const sash = new THREE.Mesh(
        wideX ? new THREE.BoxGeometry(winW + 0.14, winH + 0.14, 0.05) : new THREE.BoxGeometry(0.05, winH + 0.14, winW + 0.14),
        frameMat,
      );
      const pane = new THREE.Mesh(
        wideX ? new THREE.BoxGeometry(winW, winH, 0.06) : new THREE.BoxGeometry(0.06, winH, winW),
        glassMat,
      );
      // Center vertical & horizontal mullion bars
      const mullionV = new THREE.Mesh(
        wideX ? new THREE.BoxGeometry(0.04, winH, 0.075) : new THREE.BoxGeometry(0.075, winH, 0.04),
        frameMat,
      );
      const mullionH = new THREE.Mesh(
        wideX ? new THREE.BoxGeometry(winW, 0.04, 0.075) : new THREE.BoxGeometry(0.075, 0.04, winW),
        frameMat,
      );

      if (wideX) {
        const fz = obs.z + sign * (obs.d * 0.5 + 0.02);
        sill.position.set(obs.x, winY - winH * 0.5 - 0.04, fz + sign * 0.03);
        lintel.position.set(obs.x, winY + winH * 0.5 + 0.05, fz + sign * 0.03);
        sash.position.set(obs.x, winY, fz);
        pane.position.set(obs.x, winY, fz + sign * 0.01);
        mullionV.position.set(obs.x, winY, fz + sign * 0.015);
        mullionH.position.set(obs.x, winY, fz + sign * 0.015);
      } else {
        const fx = obs.x + sign * (obs.w * 0.5 + 0.02);
        sill.position.set(fx + sign * 0.03, winY - winH * 0.5 - 0.04, obs.z);
        lintel.position.set(fx + sign * 0.03, winY + winH * 0.5 + 0.05, obs.z);
        sash.position.set(fx, winY, obs.z);
        pane.position.set(fx + sign * 0.01, winY, obs.z);
        mullionV.position.set(fx + sign * 0.015, winY, obs.z);
        mullionH.position.set(fx + sign * 0.015, winY, obs.z);
      }
      group.add(sill, lintel, sash, pane, mullionV, mullionH);
    }
  }

  // 6. Cantilevered 2nd-Story Balcony Overhang with Guardrail & Soffit Downlight (y = 3.22m, above head height!)
  if (allowBalcony && obs.h >= 4.4 && spanLen >= 4.2) {
    const balcLen = Math.min(3.4, spanLen * 0.58);
    const balcDepth = 0.52;
    const balcY = 3.22;
    const sgn = seed > 0.5 ? 1 : -1;

    const deck = new THREE.Mesh(
      wideX ? new THREE.BoxGeometry(balcLen, 0.14, balcDepth) : new THREE.BoxGeometry(balcDepth, 0.14, balcLen),
      pilasterMat,
    );
    const railTop = new THREE.Mesh(
      wideX ? new THREE.BoxGeometry(balcLen, 0.05, 0.05) : new THREE.BoxGeometry(0.05, 0.05, balcLen),
      frameMat,
    );
    const soffitLamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.04, 0.14),
      new THREE.MeshBasicMaterial({ color: theme === 'night' || theme === 'cyber' ? '#38bdf8' : '#fef08a' }),
    );

    if (wideX) {
      const bz = obs.z + sgn * (obs.d * 0.5 + balcDepth * 0.5);
      deck.position.set(obs.x, balcY, bz);
      railTop.position.set(obs.x, balcY + 0.58, bz + sgn * (balcDepth * 0.5 - 0.04));
      soffitLamp.position.set(obs.x, balcY - 0.08, bz);
    } else {
      const bx = obs.x + sgn * (obs.w * 0.5 + balcDepth * 0.5);
      deck.position.set(bx, balcY, obs.z);
      railTop.position.set(bx + sgn * (balcDepth * 0.5 - 0.04), balcY + 0.58, obs.z);
      soffitLamp.position.set(bx, balcY - 0.08, obs.z);
    }
    deck.castShadow = true;
    group.add(deck, railTop, soffitLamp);
  }

  // 7. Theme-Specific Storytelling Architecture:
  //    - Urban / Sandstone: Cascading rooftop ivy foliage & draped crimson wall banners (Image 2)
  //    - Snow / Night / Cyber: Industrial pipe manifolds & orange power junction boxes (Image 3)
  if ((theme === 'urban' || theme === 'sandstone') && seed > 0.38) {
    // Cascading rooftop ivy / foliage cluster hanging over upper building corner
    const sx = seed > 0.68 ? 1 : -1;
    const sz = seed > 0.52 ? 1 : -1;
    const cornerXPos = obs.x + sx * (obs.w * 0.5 - 0.25);
    const cornerZPos = obs.z + sz * (obs.d * 0.5 + 0.06);
    for (let f = 0; f < 4; f++) {
      const leafCluster = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.28 - f * 0.04, 0),
        foliageMat,
      );
      leafCluster.scale.set(1.3, 1.4, 0.65);
      leafCluster.position.set(cornerXPos + (f % 2) * 0.16, topY - f * 0.34, cornerZPos);
      leafCluster.castShadow = true;
      group.add(leafCluster);
    }

    // Draped crimson/gold architectural banner between upper pilasters (y = 3.35m)
    if (spanLen >= 3.5) {
      const banner = new THREE.Mesh(
        wideX ? new THREE.BoxGeometry(1.45, 0.52, 0.05) : new THREE.BoxGeometry(0.05, 0.52, 1.45),
        bannerMat,
      );
      if (wideX) {
        banner.position.set(obs.x, 3.45, obs.z + sz * (obs.d * 0.5 + 0.04));
      } else {
        banner.position.set(obs.x + sx * (obs.w * 0.5 + 0.04), 3.45, obs.z);
      }
      group.add(banner);
    }
  } else if (seed > 0.34) {
    // Industrial double conduit pipe cluster + orange/cyan power junction box (Image 3)
    const sgn = seed > 0.62 ? 1 : -1;
    for (const pOff of [-0.08, 0.08]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, obs.h - 0.2, 8), pipeMat);
      if (wideX) {
        pipe.position.set(obs.x + obs.w * 0.32 + pOff, obs.h * 0.5, obs.z + sgn * (obs.d * 0.5 + 0.045));
      } else {
        pipe.position.set(obs.x + sgn * (obs.w * 0.5 + 0.045), obs.h * 0.5, obs.z + obs.d * 0.32 + pOff);
      }
      group.add(pipe);
    }
    const jBox = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.44, 0.14), junctionMat);
    if (wideX) {
      jBox.position.set(obs.x + obs.w * 0.32, 2.25, obs.z + sgn * (obs.d * 0.5 + 0.07));
    } else {
      jBox.position.set(obs.x + sgn * (obs.w * 0.5 + 0.07), 2.25, obs.z + obs.d * 0.32);
    }
    group.add(jBox);
  }

  // 8. Rooftop Safety Guardrail Fencing (inspired by Image 1)
  if (allowRooftopRail && obs.h >= 4.2 && spanLen >= 3.2) {
    const railY = topY + 0.48;
    const topBar = new THREE.Mesh(
      wideX ? new THREE.BoxGeometry(obs.w * 0.85, 0.04, 0.04) : new THREE.BoxGeometry(0.04, 0.04, obs.d * 0.85),
      frameMat,
    );
    if (wideX) {
      topBar.position.set(obs.x, railY, obs.z + (seed > 0.5 ? 1 : -1) * (obs.d * 0.5 - 0.08));
    } else {
      topBar.position.set(obs.x + (seed > 0.5 ? 1 : -1) * (obs.w * 0.5 - 0.08), railY, obs.z);
    }
    group.add(topBar);
  }
}

/**
 * Adds sagging overhead catenary power/telemetry cables spanning high (y = 4.6m..5.5m)
 * between nearby tall buildings (inspired by Image 3).
 */
function addOverheadCatenaryCables(
  group: THREE.Group,
  tallBuildings: SimpleBoxSpec[],
  cableMat: THREE.Material,
  maxCables = 10,
): void {
  let count = 0;
  for (let i = 0; i < tallBuildings.length && count < maxCables; i++) {
    const a = tallBuildings[i];
    for (let j = i + 1; j < tallBuildings.length && count < maxCables; j++) {
      const b = tallBuildings[j];
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist < 6.5 || dist > 16.5) continue;
      count++;

      const yA = Math.min(a.h, 5.2) - 0.35;
      const yB = Math.min(b.h, 5.2) - 0.35;
      const midX = (a.x + b.x) * 0.5;
      const midZ = (a.z + b.z) * 0.5;
      const sagY = Math.min(yA, yB) - 0.65;

      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(a.x, yA, a.z),
        new THREE.Vector3(midX, sagY, midZ),
        new THREE.Vector3(b.x, yB, b.z),
      );
      const tubeGeo = new THREE.TubeGeometry(curve, 10, 0.028, 5, false);
      const cable = new THREE.Mesh(tubeGeo, cableMat);
      group.add(cable);
    }
  }
}

export function buildStandardEnvDetails(opts: {
  modeId: ModeId;
  halfExtent: number;
  boxes: SimpleBoxSpec[];
  quality: QualityTier;
}): EnvDetailsHandle {
  const { modeId, halfExtent, boxes, quality } = opts;
  const group = new THREE.Group();
  const fans: THREE.Object3D[] = [];
  const rotators: THREE.Object3D[] = [];
  const motes: THREE.Points[] = [];
  const extraTextures: THREE.Texture[] = [];

  const aoTex = createContactAoTexture();
  extraTextures.push(aoTex);
  const aoMat = new THREE.MeshBasicMaterial({
    map: aoTex,
    transparent: true,
    depthWrite: false,
  });
  const aoGeo = new THREE.PlaneGeometry(1, 1);
  aoGeo.rotateX(-Math.PI / 2);

  // Contact AO mats underneath obstacles
  for (const b of boxes) {
    if (b.wallType === 'void_barrier') continue;
    const ao = new THREE.Mesh(aoGeo, aoMat);
    ao.position.set(b.x, 0.012, b.z);
    ao.scale.set(b.w, 1, b.d);
    group.add(ao);
  }

  if (quality !== 'low') {
    const themeTag: 'urban' | 'snow' | 'night' | 'sandstone' | 'cyber' =
      modeId === 'defend'
        ? 'sandstone'
        : modeId === 'dm'
          ? 'snow'
          : modeId === 'hvh'
            ? 'cyber'
            : 'urban';

    const steelMaps = createPBRSurface('painted_metal', modeId === 'hvh' ? '#1e1b4b' : '#334155', 1, 1);
    const frameMat = new THREE.MeshStandardMaterial({
      map: steelMaps.map,
      normalMap: steelMaps.normalMap,
      roughnessMap: steelMaps.roughnessMap,
      roughness: 0.45,
      metalness: 0.65,
    });
    const ventBladeMat = new THREE.MeshStandardMaterial({
      color: '#64748b',
      roughness: 0.38,
      metalness: 0.72,
    });
    const sidewalkMat = new THREE.MeshStandardMaterial({
      color: modeId === 'defend' ? '#8c7355' : modeId === 'hvh' ? '#1e1b4b' : '#475569',
      roughness: 0.82,
      metalness: 0.08,
    });
    const curbMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.72,
      metalness: 0.18,
    });
    const hazardMat = new THREE.MeshStandardMaterial({
      color: modeId === 'hvh' ? '#f43f5e' : '#eab308',
      roughness: 0.55,
      metalness: 0.15,
    });
    const pilasterMat = new THREE.MeshStandardMaterial({
      color: modeId === 'defend' ? '#a68966' : modeId === 'hvh' ? '#312e81' : '#64748b',
      roughness: 0.76,
      metalness: 0.14,
    });
    const claddingMat = new THREE.MeshStandardMaterial({
      color: modeId === 'dm' ? '#0284c7' : modeId === 'hvh' ? '#701a75' : '#b45309',
      roughness: 0.52,
      metalness: 0.28,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      roughness: 0.08,
      metalness: 0.85,
    });
    const foliageMat = new THREE.MeshStandardMaterial({
      color: '#3f6212',
      roughness: 0.88,
      metalness: 0.02,
    });
    const bannerMat = new THREE.MeshStandardMaterial({
      color: '#991b1b',
      roughness: 0.82,
      metalness: 0.05,
    });
    const junctionMat = new THREE.MeshStandardMaterial({
      color: '#ea580c',
      roughness: 0.45,
      metalness: 0.35,
    });

    // 1. Multi-layered ground walkways, sidewalks, curbs, storm drains & manhole covers
    const innerSolids = boxes.slice(4).filter((b) => b.wallType === 'solid' && b.h >= 2.5);
    for (const b of innerSolids) {
      addLayeredSidewalkAndCurb(group, b, sidewalkMat, curbMat, hazardMat, frameMat);
      addBuildingArchitecturalDepth({
        group,
        obs: { ...b, y: b.y + b.h * 0.5 },
        theme: themeTag,
        pilasterMat,
        accentBandMat: hazardMat,
        claddingMat,
        frameMat,
        glassMat,
        foliageMat,
        bannerMat,
        pipeMat: frameMat,
        junctionMat,
        seed: hash2d(b.x, b.z),
        allowBalcony: false,
        allowRooftopRail: true,
      });
    }

    // Center & lane 3D paved ground panels + cast-iron manhole covers
    const manholeGeo = new THREE.CylinderGeometry(0.42, 0.44, 0.024, 16);
    for (const [mx, mz] of [
      [-6.5, -6.5],
      [6.5, -6.5],
      [-6.5, 6.5],
      [6.5, 6.5],
    ]) {
      const mh = new THREE.Mesh(manholeGeo, frameMat);
      mh.position.set(mx, 0.012, mz);
      group.add(mh);
    }

    // Overhead structural steel trusses / hangar beams high at y = 6.2 (zero interference)
    for (let z = -halfExtent + 8; z <= halfExtent - 8; z += 14) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(halfExtent * 1.98, 0.36, 0.42),
        frameMat,
      );
      beam.position.set(0, 6.45, z);
      group.add(beam);
    }

    // Perimeter HVAC vent fans on outer boundary wall at y = 3.6
    for (const side of [-1, 1]) {
      for (const offset of [-10, 10]) {
        const housing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 0.18), frameMat);
        housing.position.set(offset, 3.6, side * (halfExtent - 0.1));
        group.add(housing);

        const rotor = new THREE.Group();
        rotor.position.set(offset, 3.6, side * (halfExtent - 0.22));
        for (let bIdx = 0; bIdx < 4; bIdx++) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.16, 0.04), ventBladeMat);
          blade.rotation.z = (bIdx * Math.PI) / 4;
          rotor.add(blade);
        }
        group.add(rotor);
        fans.push(rotor);
      }
    }

    // Exterior multi-story skyline towers with illuminated window grids & rooftop penthouses
    const winGridTex = createSkylineWindowGridTexture(themeTag);
    extraTextures.push(winGridTex);
    const silhouetteMat = new THREE.MeshStandardMaterial({
      map: winGridTex,
      roughness: 0.72,
      metalness: 0.22,
    });
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2;
      const dist = halfExtent + 18 + (i % 3) * 9;
      const h = 12 + (i % 4) * 6;
      const w = 7 + (i % 3) * 3;
      const tx = Math.cos(ang) * dist;
      const tz = Math.sin(ang) * dist;
      const mass = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), silhouetteMat);
      mass.position.set(tx, h * 0.5 - 2, tz);
      group.add(mass);

      // Upper penthouse setback tier
      const pent = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, 2.4, w * 0.62), frameMat);
      pent.position.set(tx, h - 0.8, tz);
      group.add(pent);
    }

    if (modeId === 'defend') {
      // Tactical rotating radar dish on outer depot corner outside play bounds
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 3.2, 10), frameMat);
      mast.position.set(-halfExtent - 3, 5.2, -halfExtent - 3);
      group.add(mast);
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.25, 0.45, 14), ventBladeMat);
      dish.rotation.x = Math.PI * 0.35;
      dish.position.set(-halfExtent - 3, 6.8, -halfExtent - 3);
      group.add(dish);
      rotators.push(dish);
    }
  }

  const moteCount = quality === 'high' ? 140 : quality === 'medium' ? 75 : 30;
  const moteColor =
    modeId === 'dm'
      ? '#e0f2fe'
      : modeId === 'hvh'
        ? '#f472b6'
        : modeId === 'defend'
          ? '#fde68a'
          : '#cbd5e1';
  motes.push(
    addAtmosphericMotes(
      group,
      halfExtent,
      halfExtent,
      moteCount,
      moteColor,
      modeId === 'dm' ? 0.16 : 0.09,
      modeId === 'dm' ? 1.1 : 0.22,
    ),
  );

  const update = (elapsedSec: number, dt: number) => {
    for (const f of fans) {
      f.rotation.z = elapsedSec * 5.2;
    }
    for (const r of rotators) {
      r.rotation.y = elapsedSec * 0.9;
    }
    for (const pts of motes) {
      const pos = pts.geometry.attributes['position'] as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const { fallSpeed, halfZ } = pts.userData as { fallSpeed: number; halfZ: number };
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] -= fallSpeed * dt;
        arr[i] += Math.sin(elapsedSec * 0.7 + i) * 0.18 * dt;
        if (arr[i + 1] < 0.3) {
          arr[i + 1] = 9.8;
        }
        if (arr[i + 2] > halfZ) arr[i + 2] -= halfZ * 2;
      }
      pos.needsUpdate = true;
    }
  };

  const dispose = () => {
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.Points).isPoints) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) mat?.dispose();
      }
    });
    for (const t of extraTextures) t.dispose();
  };

  return { group, update, dispose };
}

export function buildSndEnvDetails(opts: {
  theme: 'urban' | 'snow' | 'night';
  halfX: number;
  halfZ: number;
  obstacles: SimpleBoxSpec[];
  quality: QualityTier;
}): EnvDetailsHandle {
  const { theme, halfX, halfZ, obstacles, quality } = opts;
  const group = new THREE.Group();
  const fans: THREE.Object3D[] = [];
  const rotators: THREE.Object3D[] = [];
  const beaconMats: THREE.MeshBasicMaterial[] = [];
  const motes: THREE.Points[] = [];
  const extraTextures: THREE.Texture[] = [];

  const aoTex = createContactAoTexture();
  extraTextures.push(aoTex);
  const aoMat = new THREE.MeshBasicMaterial({
    map: aoTex,
    transparent: true,
    depthWrite: false,
  });
  const aoGeo = new THREE.PlaneGeometry(1, 1);
  aoGeo.rotateX(-Math.PI / 2);

  // 1. Contact AO shadows grounding every solid structure & cover crate
  for (const obs of obstacles) {
    if (obs.wallType === 'void_barrier' || obs.matKind === 'void_barrier') continue;
    const bottomY = obs.y - obs.h * 0.5;
    if (bottomY > 0.25) continue;
    const ao = new THREE.Mesh(aoGeo, aoMat);
    ao.position.set(obs.x, 0.014, obs.z);
    ao.scale.set(obs.w + 0.35, 1, obs.d + 0.35);
    group.add(ao);
  }

  if (quality !== 'low') {
    const metalMaps = createPBRSurface('painted_metal', theme === 'night' ? '#1e293b' : '#475569', 1, 1);
    const frameMat = new THREE.MeshStandardMaterial({
      map: metalMaps.map,
      normalMap: metalMaps.normalMap,
      roughnessMap: metalMaps.roughnessMap,
      roughness: 0.42,
      metalness: 0.68,
    });
    const glassMaps = createPBRSurface('glass', theme === 'night' ? '#0f172a' : '#334155', 1, 1);
    const glassMat = new THREE.MeshStandardMaterial({
      map: glassMaps.map,
      normalMap: glassMaps.normalMap,
      roughness: 0.08,
      metalness: 0.82,
      envMapIntensity: 1.4,
    });
    const fanMat = new THREE.MeshStandardMaterial({
      color: '#94a3b8',
      roughness: 0.35,
      metalness: 0.78,
    });
    const pipeMat = new THREE.MeshStandardMaterial({
      color: theme === 'urban' ? '#78716c' : theme === 'snow' ? '#64748b' : '#312e81',
      roughness: 0.48,
      metalness: 0.65,
    });

    const sidewalkMaps = createPBRSurface(
      theme === 'urban' ? 'stone' : 'concrete',
      theme === 'urban' ? '#9c9284' : theme === 'snow' ? '#8294a8' : '#333952',
      2,
      2,
    );
    const sidewalkMat = new THREE.MeshStandardMaterial({
      map: sidewalkMaps.map,
      normalMap: sidewalkMaps.normalMap,
      roughnessMap: sidewalkMaps.roughnessMap,
      roughness: 0.82,
      metalness: 0.06,
    });
    const curbMat = new THREE.MeshStandardMaterial({
      color: theme === 'urban' ? '#57534e' : '#1e293b',
      roughness: 0.75,
      metalness: 0.15,
    });
    const hazardMat = new THREE.MeshStandardMaterial({
      color: theme === 'night' ? '#38bdf8' : '#eab308',
      roughness: 0.52,
      metalness: 0.16,
    });
    const pilasterMat = new THREE.MeshStandardMaterial({
      map: sidewalkMaps.map,
      normalMap: sidewalkMaps.normalMap,
      color: theme === 'urban' ? '#b0a292' : theme === 'snow' ? '#64748b' : '#2e344e',
      roughness: 0.78,
      metalness: 0.12,
    });
    const claddingMat = new THREE.MeshStandardMaterial({
      color: theme === 'urban' ? '#b45309' : theme === 'snow' ? '#0284c7' : '#4f46e5',
      roughness: 0.48,
      metalness: 0.28,
    });
    const foliageMat = new THREE.MeshStandardMaterial({
      color: '#4d7c0f',
      roughness: 0.86,
      metalness: 0.02,
    });
    const bannerMat = new THREE.MeshStandardMaterial({
      color: '#991b1b',
      roughness: 0.80,
      metalness: 0.06,
    });
    const junctionMat = new THREE.MeshStandardMaterial({
      color: theme === 'night' ? '#d946ef' : '#ea580c',
      roughness: 0.42,
      metalness: 0.35,
    });

    let acBudget = 0;
    let neonBudget = 0;
    let balconyBudget = 0;
    const neonTexts = ['A1 CAFE', 'CYBERNET', 'RAMEN 24H', 'BAZAAR', 'ARCADE'];
    const neonColors: [string, string][] = [
      ['#38bdf8', '#e0f2fe'],
      ['#f43f5e', '#ffe4e6'],
      ['#a855f7', '#f3e8ff'],
      ['#22d3ee', '#cffafe'],
    ];
    const tallBuildings: SimpleBoxSpec[] = [];

    for (const obs of obstacles) {
      if (obs.wallType !== 'solid' || obs.matKind === 'void_barrier' || obs.h < 3.6) continue;
      if (Math.abs(obs.x) > halfX - 1.5 || Math.abs(obs.z) > halfZ - 1.5) continue;

      const seed = hash2d(obs.x, obs.z);
      const wideX = obs.w >= obs.d;
      tallBuildings.push(obs);

      // 1. Multi-layered 3D sidewalk apron, stone curb, yellow/cyan hazard strip & gutter drain grates
      if (obs.w >= 2.2 && obs.d >= 2.2) {
        addLayeredSidewalkAndCurb(group, obs, sidewalkMat, curbMat, hazardMat, frameMat);
      }

      // 2. Full 3D architectural facade depth (pilasters, cornice dentils, framed windows, balconies, ivy/pipes)
      const allowBalcony = balconyBudget < (quality === 'high' ? 10 : 5) && seed > 0.42;
      if (allowBalcony && obs.h >= 4.4 && Math.max(obs.w, obs.d) >= 4.2) {
        balconyBudget++;
      }
      addBuildingArchitecturalDepth({
        group,
        obs,
        theme,
        pilasterMat,
        accentBandMat: hazardMat,
        claddingMat,
        frameMat,
        glassMat,
        foliageMat,
        bannerMat,
        pipeMat,
        junctionMat,
        seed,
        allowBalcony,
        allowRooftopRail: quality === 'high',
      });

      // 3. Wall-mounted AC vents with spinning fan blades above head height (y = 3.1m)
      if (seed > 0.52 && acBudget < (quality === 'high' ? 12 : 6)) {
        acBudget++;
        const sign = seed > 0.76 ? 1 : -1;
        const acBox = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 0.24), frameMat);
        const rotor = new THREE.Group();
        for (let b = 0; b < 3; b++) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.09, 0.02), fanMat);
          blade.rotation.z = (b * Math.PI) / 3;
          rotor.add(blade);
        }
        if (wideX) {
          const fz = obs.z + sign * (obs.d * 0.5 + 0.12);
          acBox.position.set(obs.x + (seed - 0.65) * 1.4, 3.1, fz);
          rotor.position.set(acBox.position.x, 3.1, fz + sign * 0.13);
        } else {
          const fx = obs.x + sign * (obs.w * 0.5 + 0.12);
          acBox.rotation.y = Math.PI / 2;
          acBox.position.set(fx, 3.1, obs.z + (seed - 0.65) * 1.4);
          rotor.rotation.y = Math.PI / 2;
          rotor.position.set(fx + sign * 0.13, 3.1, acBox.position.z);
        }
        group.add(acBox, rotor);
        fans.push(rotor);
      }

      // 4. Theme-specific rooftop & high facade landmarks
      if (theme === 'urban' && seed > 0.62 && obs.h >= 4.2) {
        const roofUnit = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.65, 0.85), frameMat);
        roofUnit.position.set(obs.x, obs.h + 0.32, obs.z);
        group.add(roofUnit);
      } else if (theme === 'snow' && seed > 0.58 && obs.h >= 4.2) {
        const topY = obs.y + obs.h * 0.5 + 0.24;
        const beaconMat = new THREE.MeshBasicMaterial({ color: '#f97316' });
        beaconMats.push(beaconMat);
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.22, 10), beaconMat);
        beacon.position.set(obs.x, topY + 0.11, obs.z);
        group.add(beacon);
      } else if (theme === 'night' && seed > 0.45 && neonBudget < 10) {
        const idx = neonBudget % neonTexts.length;
        const [bCol, fCol] = neonColors[neonBudget % neonColors.length];
        neonBudget++;
        const signTex = createNeonSignTexture(neonTexts[idx], bCol, fCol);
        extraTextures.push(signTex);
        const signMat = new THREE.MeshStandardMaterial({
          map: signTex,
          emissiveMap: signTex,
          emissive: new THREE.Color('#ffffff'),
          emissiveIntensity: 1.15,
          roughness: 0.35,
          metalness: 0.2,
        });
        const signMesh = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.65, 0.08), signMat);
        const sign = seed > 0.72 ? 1 : -1;
        if (wideX) {
          signMesh.position.set(obs.x, 3.05, obs.z + sign * (obs.d * 0.5 + 0.06));
        } else {
          signMesh.rotation.y = Math.PI / 2;
          signMesh.position.set(obs.x + sign * (obs.w * 0.5 + 0.06), 3.05, obs.z);
        }
        group.add(signMesh);
      }
    }

    // 5. Overhead Catenary Power / Telemetry Cables drooping across streets between tall buildings (Image 3)
    addOverheadCatenaryCables(
      group,
      tallBuildings,
      curbMat,
      quality === 'high' ? 12 : 6,
    );

    // 6. Street Manhole Covers & Paved Plaza Floor Inlay Borders
    const manholeGeo = new THREE.CylinderGeometry(0.42, 0.44, 0.024, 16);
    for (const [mx, mz] of [
      [-8.5, -8.5],
      [8.5, -8.5],
      [-8.5, 8.5],
      [8.5, 8.5],
      [0, -12.5],
      [0, 12.5],
    ]) {
      if (Math.abs(mx) < halfX - 4 && Math.abs(mz) < halfZ - 4) {
        const mh = new THREE.Mesh(manholeGeo, frameMat);
        mh.position.set(mx, 0.014, mz);
        group.add(mh);
      }
    }

    // Theme signature centerpiece perimeter visuals (zero collision overlap)
    if (theme === 'snow') {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 5.5, 10), frameMat);
      mast.position.set(halfX - 2.5, 6.2, -halfZ + 2.5);
      group.add(mast);
      const radarArm = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.24, 0.42), fanMat);
      radarArm.position.set(halfX - 2.5, 9.0, -halfZ + 2.5);
      group.add(radarArm);
      rotators.push(radarArm);
    } else if (theme === 'night') {
      const puddleMat = new THREE.MeshStandardMaterial({
        color: '#0b1220',
        roughness: 0.05,
        metalness: 0.35,
        envMapIntensity: 1.6,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      });
      const puddlePositions = [
        [-4.5, -2.5, 2.8, 1.9],
        [5.2, 4.1, 3.1, 2.2],
        [0.4, 9.8, 2.5, 1.7],
        [-7.8, 6.4, 2.6, 2.0],
        [7.4, -7.2, 3.0, 2.1],
      ];
      for (const [px, pz, sx, sz] of puddlePositions) {
        const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 20), puddleMat);
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.set(px, 0.018, pz);
        puddle.scale.set(sx, sz, 1);
        group.add(puddle);
      }
    }
  }

  // Atmospheric falling snow / warm dust motes / cyber mist
  const moteCount = quality === 'high' ? 180 : quality === 'medium' ? 95 : 40;
  const moteCol = theme === 'snow' ? '#e2e8f0' : theme === 'night' ? '#38bdf8' : '#fde68a';
  const moteSize = theme === 'snow' ? 0.14 : 0.08;
  const moteSpeed = theme === 'snow' ? 1.45 : theme === 'night' ? 0.85 : 0.25;
  motes.push(addAtmosphericMotes(group, halfX, halfZ, moteCount, moteCol, moteSize, moteSpeed));

  const update = (elapsedSec: number, dt: number) => {
    for (const f of fans) {
      f.rotation.z = elapsedSec * 5.6;
    }
    for (const r of rotators) {
      r.rotation.y = elapsedSec * 1.05;
    }
    for (let i = 0; i < beaconMats.length; i++) {
      const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * 3.8 + i);
      beaconMats[i].color.setRGB(0.95, 0.25 + pulse * 0.45, 0.06);
    }
    for (const pts of motes) {
      const pos = pts.geometry.attributes['position'] as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const { fallSpeed } = pts.userData as { fallSpeed: number };
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] -= fallSpeed * dt;
        arr[i] += Math.sin(elapsedSec * 0.8 + i) * 0.24 * dt;
        if (arr[i + 1] < 0.25) {
          arr[i + 1] = 10.0;
        }
      }
      pos.needsUpdate = true;
    }
  };

  const dispose = () => {
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.Points).isPoints) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) mat?.dispose();
      }
    });
    for (const t of extraTextures) t.dispose();
  };

  return { group, update, dispose };
}
