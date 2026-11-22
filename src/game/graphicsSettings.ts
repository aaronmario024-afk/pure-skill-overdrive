export type GraphicsPresetId = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type ShadowQuality = 'off' | 'low' | 'medium' | 'high';
export type TextureQuality = 'low' | 'medium' | 'high';
export type AntiAliasingMode = 'off' | 'fxaa' | 'smaa';
export type QualityTier = 'low' | 'medium' | 'high';

export interface GraphicsSettings {
  preset: GraphicsPresetId;
  renderScale: number;
  shadowQuality: ShadowQuality;
  textureQuality: TextureQuality;
  antiAliasing: AntiAliasingMode;
  postProcessing: boolean;
  bloom: boolean;
  colorGrading: boolean;
  effectsQuality: QualityTier;
  lightingQuality: QualityTier;
  viewDistance: number;
  fpsCap: number;
  showPerfHud: boolean;
}

export const GRAPHICS_PRESETS: Record<Exclude<GraphicsPresetId, 'custom'>, GraphicsSettings> = {
  low: {
    preset: 'low',
    renderScale: 0.75,
    shadowQuality: 'off',
    textureQuality: 'low',
    antiAliasing: 'off',
    postProcessing: false,
    bloom: false,
    colorGrading: false,
    effectsQuality: 'low',
    lightingQuality: 'low',
    viewDistance: 85,
    fpsCap: 0,
    showPerfHud: false,
  },
  medium: {
    preset: 'medium',
    renderScale: 0.85,
    shadowQuality: 'low',
    textureQuality: 'medium',
    antiAliasing: 'fxaa',
    postProcessing: true,
    bloom: false,
    colorGrading: true,
    effectsQuality: 'medium',
    lightingQuality: 'medium',
    viewDistance: 110,
    fpsCap: 0,
    showPerfHud: false,
  },
  high: {
    preset: 'high',
    renderScale: 1.0,
    shadowQuality: 'medium',
    textureQuality: 'high',
    antiAliasing: 'fxaa',
    postProcessing: true,
    bloom: true,
    colorGrading: true,
    effectsQuality: 'high',
    lightingQuality: 'high',
    viewDistance: 135,
    fpsCap: 0,
    showPerfHud: false,
  },
  ultra: {
    preset: 'ultra',
    renderScale: 1.15,
    shadowQuality: 'high',
    textureQuality: 'high',
    antiAliasing: 'smaa',
    postProcessing: true,
    bloom: true,
    colorGrading: true,
    effectsQuality: 'high',
    lightingQuality: 'high',
    viewDistance: 160,
    fpsCap: 0,
    showPerfHud: false,
  },
};

export function cloneGraphicsSettings(src: GraphicsSettings): GraphicsSettings {
  return { ...src };
}

export function resolveGraphicsPreset(
  preset: Exclude<GraphicsPresetId, 'custom'>,
  showPerfHud = false,
  fpsCap = 0,
): GraphicsSettings {
  const base = GRAPHICS_PRESETS[preset] ?? GRAPHICS_PRESETS.high;
  return {
    ...base,
    showPerfHud,
    fpsCap,
  };
}

export function detectMatchingPreset(s: GraphicsSettings): GraphicsPresetId {
  const keys: Exclude<GraphicsPresetId, 'custom'>[] = ['low', 'medium', 'high', 'ultra'];
  for (const id of keys) {
    const p = GRAPHICS_PRESETS[id];
    if (
      Math.abs(s.renderScale - p.renderScale) < 0.01 &&
      s.shadowQuality === p.shadowQuality &&
      s.textureQuality === p.textureQuality &&
      s.antiAliasing === p.antiAliasing &&
      s.postProcessing === p.postProcessing &&
      s.bloom === p.bloom &&
      s.colorGrading === p.colorGrading &&
      s.effectsQuality === p.effectsQuality &&
      s.lightingQuality === p.lightingQuality &&
      s.viewDistance === p.viewDistance
    ) {
      return id;
    }
  }
  return 'custom';
}

export function mergeGraphicsSettings(partial?: Partial<GraphicsSettings> | null): GraphicsSettings {
  const def = cloneGraphicsSettings(GRAPHICS_PRESETS.high);
  if (!partial) return def;
  const merged: GraphicsSettings = {
    preset: partial.preset ?? def.preset,
    renderScale: typeof partial.renderScale === 'number' ? Math.max(0.5, Math.min(1.5, partial.renderScale)) : def.renderScale,
    shadowQuality: partial.shadowQuality ?? def.shadowQuality,
    textureQuality: partial.textureQuality ?? def.textureQuality,
    antiAliasing: partial.antiAliasing ?? def.antiAliasing,
    postProcessing: typeof partial.postProcessing === 'boolean' ? partial.postProcessing : def.postProcessing,
    bloom: typeof partial.bloom === 'boolean' ? partial.bloom : def.bloom,
    colorGrading: typeof partial.colorGrading === 'boolean' ? partial.colorGrading : def.colorGrading,
    effectsQuality: partial.effectsQuality ?? def.effectsQuality,
    lightingQuality: partial.lightingQuality ?? def.lightingQuality,
    viewDistance: typeof partial.viewDistance === 'number' ? Math.max(60, Math.min(200, partial.viewDistance)) : def.viewDistance,
    fpsCap: typeof partial.fpsCap === 'number' ? Math.max(0, partial.fpsCap) : def.fpsCap,
    showPerfHud: typeof partial.showPerfHud === 'boolean' ? partial.showPerfHud : def.showPerfHud,
  };
  if (merged.preset !== 'custom') {
    merged.preset = detectMatchingPreset(merged);
  }
  return merged;
}

export function getShadowMapSize(q: ShadowQuality): number {
  switch (q) {
    case 'off': return 0;
    case 'low': return 512;
    case 'medium': return 1024;
    case 'high': return 2048;
  }
}

export function getTextureResolution(q: TextureQuality): number {
  switch (q) {
    case 'low': return 256;
    case 'medium': return 512;
    case 'high': return 768;
  }
}

export function getTextureAnisotropy(q: TextureQuality): number {
  switch (q) {
    case 'low': return 1;
    case 'medium': return 4;
    case 'high': return 8;
  }
}
