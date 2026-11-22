export type SkinRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export const RARITY_ORDER: SkinRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export const RARITY_META: Record<SkinRarity, { name: string; color: string; glow: string; refund: number }> = {
  common: { name: 'Common', color: '#94a3b8', glow: 'rgba(148,163,184,0.35)', refund: 500 },
  uncommon: { name: 'Uncommon', color: '#38bdf8', glow: 'rgba(56,189,248,0.45)', refund: 1200 },
  rare: { name: 'Rare', color: '#818cf8', glow: 'rgba(129,140,248,0.55)', refund: 2800 },
  epic: { name: 'Epic', color: '#e879f9', glow: 'rgba(232,121,249,0.65)', refund: 8500 },
  legendary: { name: 'Legendary', color: '#facc15', glow: 'rgba(250,204,21,0.85)', refund: 30000 },
};

export type CamoPatternId =
  | 'interstellar'
  | 'dark_matter'
  | 'dark_aether'
  | 'radiant'
  | 'polyatomic'
  | 'atomic'
  | 'virus'
  | 'ice'
  | 'gold'
  | 'diamond'
  | 'damascus'
  | 'obsidian'
  | 'platinum'
  | 'crimson_circuit'
  | 'bloodthirsty'
  | 'nuketown'
  | 'red_tiger'
  | 'tiger_stripe'
  | 'snake_skin'
  | 'ghillie';

export interface WeaponSkin {
  id: string;
  weaponId: string; // 'universal' applies to every weapon
  name: string;
  subtitle: string;
  pattern: CamoPatternId;
  animated?: boolean;
  rarity: SkinRarity;
  bodyColor: string;
  accentColor: string;
  emissiveColor?: string;
  metallic?: number;
  swatchCss: string;
  tracerColor: string;
  killChime: 'default' | 'plasma' | 'chiptune' | 'crystal' | 'zap' | 'koto' | 'abyss';
}

export interface CaseDef {
  id: string;
  name: string;
  subtitle: string;
  buyPrice: number; // 0 = drop only or buyable
  sellPrice: number;
  dropWeight: number;
  bodyColor: string;
  trimColor: string;
  odds: [number, number, number, number, number]; // C, U, R, E, L
}

export const CASES: CaseDef[] = [
  {
    id: 'basic',
    name: 'Basic Crate',
    subtitle: 'Droppt von Kills (50/20/22/6.5/1.5%)',
    buyPrice: 2_500, // $25
    sellPrice: 1_000, // $10
    dropWeight: 75,
    bodyColor: '#56603c',
    trimColor: '#c2ae6e',
    odds: [50, 20, 22, 6.5, 1.5],
  },
  {
    id: 'neon',
    name: '0-Day Neon Case',
    subtitle: 'Höhere Rare/Epic-Chancen',
    buyPrice: 25_000, // $250
    sellPrice: 10_000,
    dropWeight: 20,
    bodyColor: '#1e1b4b',
    trimColor: '#22d3ee',
    odds: [25, 28, 28, 14, 5],
  },
  {
    id: 'overdrive',
    name: 'Overdrive Vault',
    subtitle: 'Massiv erhöhte Mastery/Legendary-Chance!',
    buyPrice: 250_000, // $2,500
    sellPrice: 100_000,
    dropWeight: 5,
    bodyColor: '#450a0a',
    trimColor: '#facc15',
    odds: [5, 15, 32, 30, 18],
  },
];

export const SKINS: WeaponSkin[] = [
  // === LEGENDARY (6 Animated Mastery Camos) ===
  {
    id: 'camo_interstellar',
    weaponId: 'universal',
    name: 'Interstellar',
    subtitle: 'Animated Cosmic Nebula',
    pattern: 'interstellar',
    animated: true,
    rarity: 'legendary',
    bodyColor: '#1e1b4b',
    accentColor: '#38bdf8',
    emissiveColor: '#7c3aed',
    metallic: 0.72,
    swatchCss: 'linear-gradient(135deg, #090d24 0%, #5b21b6 45%, #06b6d4 85%, #e879f9 100%)',
    tracerColor: '#38bdf8',
    killChime: 'plasma',
  },
  {
    id: 'camo_dark_matter',
    weaponId: 'universal',
    name: 'Dark Matter',
    subtitle: 'Animated Plasma Void',
    pattern: 'dark_matter',
    animated: true,
    rarity: 'legendary',
    bodyColor: '#090514',
    accentColor: '#c026d3',
    emissiveColor: '#9333ea',
    metallic: 0.75,
    swatchCss: 'linear-gradient(135deg, #05020a 0%, #581c87 50%, #e879f9 78%, #1e1b4b 100%)',
    tracerColor: '#e879f9',
    killChime: 'abyss',
  },
  {
    id: 'camo_dark_aether',
    weaponId: 'universal',
    name: 'Dark Aether',
    subtitle: 'Animated Dimensional Storm',
    pattern: 'dark_aether',
    animated: true,
    rarity: 'legendary',
    bodyColor: '#1b0b38',
    accentColor: '#a855f7',
    emissiveColor: '#7e22ce',
    metallic: 0.68,
    swatchCss: 'linear-gradient(135deg, #120626 0%, #7e22ce 48%, #c084fc 82%, #14072b 100%)',
    tracerColor: '#c084fc',
    killChime: 'crystal',
  },
  {
    id: 'camo_radiant',
    weaponId: 'universal',
    name: 'Radiant Prism',
    subtitle: 'Animated Aurora Iridescence',
    pattern: 'radiant',
    animated: true,
    rarity: 'legendary',
    bodyColor: '#3b0764',
    accentColor: '#22d3ee',
    emissiveColor: '#ec4899',
    metallic: 0.85,
    swatchCss: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 35%, #ec4899 68%, #f59e0b 100%)',
    tracerColor: '#f472b6',
    killChime: 'plasma',
  },
  {
    id: 'camo_polyatomic',
    weaponId: 'universal',
    name: 'Polyatomic',
    subtitle: 'Animated Crystal Mosaic',
    pattern: 'polyatomic',
    animated: true,
    rarity: 'legendary',
    bodyColor: '#2e1065',
    accentColor: '#a855f7',
    emissiveColor: '#8b5cf6',
    metallic: 0.78,
    swatchCss: 'conic-gradient(from 30deg, #1e1b4b, #7c3aed, #c084fc, #311068, #6d28d9, #1e1b4b)',
    tracerColor: '#a855f7',
    killChime: 'crystal',
  },
  {
    id: 'camo_atomic',
    weaponId: 'universal',
    name: 'Atomic Surge',
    subtitle: 'Animated Reactor Plasma',
    pattern: 'atomic',
    animated: true,
    rarity: 'legendary',
    bodyColor: '#052e16',
    accentColor: '#84cc16',
    emissiveColor: '#65a30d',
    metallic: 0.65,
    swatchCss: 'linear-gradient(135deg, #052e16 0%, #22c55e 45%, #bef264 78%, #14532d 100%)',
    tracerColor: '#a3e635',
    killChime: 'zap',
  },

  // === EPIC (2 Animated + 3 Iconic Mastery Finishes) ===
  {
    id: 'camo_virus',
    weaponId: 'universal',
    name: 'Virus 0-Day',
    subtitle: 'Animated Toxic Matrix',
    pattern: 'virus',
    animated: true,
    rarity: 'epic',
    bodyColor: '#090d0a',
    accentColor: '#4ade80',
    emissiveColor: '#22c55e',
    metallic: 0.52,
    swatchCss: 'linear-gradient(135deg, #090d0a 25%, #166534 55%, #4ade80 72%, #090d0a 100%)',
    tracerColor: '#4ade80',
    killChime: 'chiptune',
  },
  {
    id: 'camo_ice',
    weaponId: 'universal',
    name: 'Glacier Ice',
    subtitle: 'Animated Frozen Crystal',
    pattern: 'ice',
    animated: true,
    rarity: 'epic',
    bodyColor: '#0c4a6e',
    accentColor: '#7dd3fc',
    emissiveColor: '#0284c7',
    metallic: 0.6,
    swatchCss: 'linear-gradient(135deg, #082f49 0%, #0284c7 45%, #e0f2fe 78%, #0369a1 100%)',
    tracerColor: '#7dd3fc',
    killChime: 'crystal',
  },
  {
    id: 'camo_diamond',
    weaponId: 'universal',
    name: 'Diamond',
    subtitle: 'Faceted Gem Encrusted',
    pattern: 'diamond',
    animated: true,
    rarity: 'epic',
    bodyColor: '#e2e8f0',
    accentColor: '#f8fafc',
    metallic: 0.94,
    swatchCss: 'linear-gradient(135deg, #94a3b8 0%, #ffffff 36%, #cbd5e1 62%, #f8fafc 100%)',
    tracerColor: '#f8fafc',
    killChime: 'crystal',
  },
  {
    id: 'camo_gold',
    weaponId: 'universal',
    name: '24K Gold',
    subtitle: 'Filigree Forged Gold',
    pattern: 'gold',
    animated: true,
    rarity: 'epic',
    bodyColor: '#ca8a04',
    accentColor: '#fef08a',
    metallic: 0.96,
    swatchCss: 'linear-gradient(135deg, #713f12 0%, #eab308 42%, #fef08a 68%, #854d0e 100%)',
    tracerColor: '#facc15',
    killChime: 'plasma',
  },
  {
    id: 'camo_damascus',
    weaponId: 'universal',
    name: 'Damascus',
    subtitle: 'Layered Titanium Waves',
    pattern: 'damascus',
    rarity: 'epic',
    bodyColor: '#1e3a8a',
    accentColor: '#ef4444',
    metallic: 0.88,
    swatchCss: 'repeating-linear-gradient(45deg, #0f2454 0 8px, #2563eb 8px 14px, #dc2626 14px 18px)',
    tracerColor: '#60a5fa',
    killChime: 'koto',
  },

  // === RARE (4 High-Contrast Tactical & Textured Finishes) ===
  {
    id: 'camo_obsidian',
    weaponId: 'universal',
    name: 'Obsidian',
    subtitle: 'Volcanic Faceted Glass',
    pattern: 'obsidian',
    rarity: 'rare',
    bodyColor: '#12141a',
    accentColor: '#475569',
    metallic: 0.42,
    swatchCss: 'linear-gradient(135deg, #05070a 0%, #1e2430 48%, #090b10 52%, #334155 100%)',
    tracerColor: '#94a3b8',
    killChime: 'abyss',
  },
  {
    id: 'camo_platinum',
    weaponId: 'universal',
    name: 'Platinum',
    subtitle: 'Liquid Mirror Steel',
    pattern: 'platinum',
    rarity: 'rare',
    bodyColor: '#d4dce6',
    accentColor: '#f8fafc',
    metallic: 0.96,
    swatchCss: 'linear-gradient(135deg, #64748b 0%, #f1f5f9 45%, #94a3b8 72%, #e2e8f0 100%)',
    tracerColor: '#e2e8f0',
    killChime: 'crystal',
  },
  {
    id: 'camo_crimson_circuit',
    weaponId: 'universal',
    name: 'Crimson Pro',
    subtitle: 'Carbon & Esports Crimson',
    pattern: 'crimson_circuit',
    rarity: 'rare',
    bodyColor: '#18181b',
    accentColor: '#ef4444',
    metallic: 0.48,
    swatchCss: 'linear-gradient(135deg, #09090b 35%, #dc2626 60%, #18181b 82%, #f43f5e 100%)',
    tracerColor: '#f43f5e',
    killChime: 'zap',
  },
  {
    id: 'camo_bloodthirsty',
    weaponId: 'universal',
    name: 'Bloodthirsty',
    subtitle: 'Chalk Matte & Wet Crimson',
    pattern: 'bloodthirsty',
    rarity: 'rare',
    bodyColor: '#e2e8f0',
    accentColor: '#b91c1c',
    metallic: 0.14,
    swatchCss: 'radial-gradient(circle at 30% 35%, #991b1b 22%, #e2e8f0 48%, #b91c1c 82%)',
    tracerColor: '#ef4444',
    killChime: 'koto',
  },

  // === UNCOMMON (3 Classic Striping & Retro Finishes) ===
  {
    id: 'camo_nuketown',
    weaponId: 'universal',
    name: "Nuketown '54",
    subtitle: 'Retro Atomic Turquoise & Orange',
    pattern: 'nuketown',
    rarity: 'uncommon',
    bodyColor: '#14b8a6',
    accentColor: '#ea580c',
    metallic: 0.34,
    swatchCss: 'linear-gradient(125deg, #06b6d4 0 42%, #fef3c7 42% 48%, #ea580c 48% 100%)',
    tracerColor: '#fb923c',
    killChime: 'chiptune',
  },
  {
    id: 'camo_red_tiger',
    weaponId: 'universal',
    name: 'Red Tiger',
    subtitle: 'Classic COD4 Stripes',
    pattern: 'red_tiger',
    rarity: 'uncommon',
    bodyColor: '#991b1b',
    accentColor: '#ef4444',
    metallic: 0.38,
    swatchCss: 'repeating-linear-gradient(125deg, #18181b 0 9px, #dc2626 9px 17px, #7f1d1d 17px 22px)',
    tracerColor: '#ef4444',
    killChime: 'default',
  },
  {
    id: 'camo_tiger_stripe',
    weaponId: 'universal',
    name: 'Tiger Stripe',
    subtitle: 'Satin Gold & Charcoal',
    pattern: 'tiger_stripe',
    rarity: 'uncommon',
    bodyColor: '#a16207',
    accentColor: '#facc15',
    metallic: 0.44,
    swatchCss: 'repeating-linear-gradient(125deg, #111827 0 9px, #ca8a04 9px 16px, #e5c370 16px 21px)',
    tracerColor: '#fde047',
    killChime: 'default',
  },

  // === COMMON (2 Tactical Camo Textures) ===
  {
    id: 'camo_snake_skin',
    weaponId: 'universal',
    name: 'Snake Skin',
    subtitle: 'Embossed Reptile Scales',
    pattern: 'snake_skin',
    rarity: 'common',
    bodyColor: '#78716c',
    accentColor: '#d6d3d1',
    metallic: 0.16,
    swatchCss: 'radial-gradient(circle, #a8a29e 28%, #44403c 68%, #292524 100%)',
    tracerColor: '#fde047',
    killChime: 'default',
  },
  {
    id: 'camo_ghillie',
    weaponId: 'universal',
    name: 'All Ghillied Up',
    subtitle: 'Pripyat Woodland Burlap',
    pattern: 'ghillie',
    rarity: 'common',
    bodyColor: '#4d5c32',
    accentColor: '#84cc16',
    metallic: 0.08,
    swatchCss: 'linear-gradient(135deg, #364123 0%, #5c6b3c 50%, #7a724d 100%)',
    tracerColor: '#bef264',
    killChime: 'default',
  },
];

const LEGACY_SKIN_MAP: Record<string, string> = {
  pistol_primer: 'camo_platinum',
  pistol_checkpoint: 'camo_nuketown',
  pistol_deepsea: 'camo_ice',
  pistol_aurora: 'camo_radiant',
  smg_dustbowl: 'camo_snake_skin',
  smg_hornet: 'camo_tiger_stripe',
  smg_candychrome: 'camo_radiant',
  smg_nyaan: 'camo_dark_aether',
  smg_plasma: 'camo_interstellar',
  shotgun_rust: 'camo_red_tiger',
  shotgun_ocean: 'camo_ice',
  shotgun_lava: 'camo_crimson_circuit',
  ssg_marsh: 'camo_ghillie',
  ssg_bamboo: 'camo_tiger_stripe',
  ssg_viper: 'camo_virus',
  ssg_damascus: 'camo_damascus',
  rifle_jungle: 'camo_ghillie',
  rifle_frost: 'camo_ice',
  rifle_bloodmoon: 'camo_dark_matter',
  sniper_midnight: 'camo_obsidian',
  sniper_phoenix: 'camo_crimson_circuit',
  sniper_galaxy: 'camo_polyatomic',
  m4_woodland: 'camo_ghillie',
  m4_halftone: 'camo_bloodthirsty',
  m4_spaceracer: 'camo_diamond',
  m4_opal: 'camo_atomic',
  m4_gold: 'camo_gold',
  knife_crimson: 'camo_red_tiger',
  knife_doppler: 'camo_virus',
};

export function migrateSkinId(id: string): string {
  return LEGACY_SKIN_MAP[id] ?? id;
}

export function getSkin(id: string | undefined): WeaponSkin | undefined {
  if (!id) return undefined;
  const canonical = migrateSkinId(id);
  return SKINS.find((s) => s.id === canonical);
}

export function getCase(id: string): CaseDef {
  return CASES.find((c) => c.id === id) ?? CASES[0];
}
