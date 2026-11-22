export type ArtStyleId =
  | 'clean'
  | 'pixel'
  | 'crt'
  | 'psx'
  | 'noir'
  | 'comic'
  | 'matrix'
  | 'vapor';

export interface ArtStylePreset {
  id: ArtStyleId;
  name: string;
  filter: string;
  pixelScale: number;
  scanlines: boolean;
  vignette: number;
}

export const ART_STYLES: ArtStylePreset[] = [
  { id: 'clean', name: 'CLEAN LOW POLY', filter: 'none', pixelScale: 1, scanlines: false, vignette: 0.2 },
  { id: 'pixel', name: 'PIXEL ART', filter: 'contrast(1.12) saturate(1.15)', pixelScale: 0.35, scanlines: false, vignette: 0.25 },
  { id: 'crt', name: 'CRT ARCADE', filter: 'contrast(1.18) saturate(1.22)', pixelScale: 0.65, scanlines: true, vignette: 0.45 },
  { id: 'psx', name: 'PSX 1998', filter: 'contrast(1.15) saturate(0.92)', pixelScale: 0.45, scanlines: false, vignette: 0.35 },
  { id: 'noir', name: 'NOIR', filter: 'grayscale(1) contrast(1.45) brightness(0.95)', pixelScale: 1, scanlines: false, vignette: 0.55 },
  { id: 'comic', name: 'COMIC POP', filter: 'contrast(1.38) saturate(1.55)', pixelScale: 0.85, scanlines: false, vignette: 0.18 },
  { id: 'matrix', name: 'MATRIX GREEN', filter: 'sepia(1) hue-rotate(78deg) saturate(2.4) contrast(1.2)', pixelScale: 0.75, scanlines: true, vignette: 0.4 },
  { id: 'vapor', name: 'VAPORWAVE', filter: 'hue-rotate(280deg) saturate(1.5) contrast(1.12)', pixelScale: 0.8, scanlines: true, vignette: 0.3 },
];

export type BountyTier = 'normal' | 'green' | 'red' | 'gold' | 'rainbow' | 'admin';

export const BOUNTY_PAY: Record<BountyTier, number> = {
  normal: 1,
  green: 2,
  red: 3,
  gold: 10,
  rainbow: 50,
  admin: 75,
};

export const BOUNTY_COLORS: Record<BountyTier, string> = {
  normal: '#e2e8f0',
  green: '#4ade80',
  red: '#f87171',
  gold: '#facc15',
  rainbow: '#f472b6',
  admin: '#ff1e56',
};

export const BALANCE = {
  creditsPerKill: 100, // $1.00 in cents
  startingCredits: 0,
  playerMaxHealth: 100,
  walkSpeed: 7.2,
  crouchSpeed: 0.52,
  jumpHeight: 1.55,
  gravity: 23,
  playerRespawnDelay: 2.2,
  playerSpawnProtection: 1.5,
  multiKillWindow: 2.8,

  // Style bonuses (additive multipliers on kill pay)
  headshotBonus: 1.0,
  noscopeBonus: 2.0,
  jumpshotBonus: 1.5,
  quickscopeBonus: 1.0,
  spinBonus: 2.0,
  flickBonus: 0.5,
  collateralBonus: 2.0,
  lastBulletBonus: 0.5,
  revengeBonus: 0.5,
  backtrackBonus: 1.5,
  blinkBonus: 1.0,
  winBonusShare: 0.5,
  winBonusMinKills: 2,

  // Bot baseline
  botMaxHealth: 100,
  botMoveSpeed: 4.1,
  botSightRange: 42,
  botReactionTime: 0.52,
  botFireInterval: 0.58,
  botDamage: 10,
  botHeadshotChance: 0.18,
  botHeadshotMultiplier: 2.0,
  botHitChanceNear: 0.52,
  botHitChanceFar: 0.16,

  // Cases
  caseDropChance: 0.08,
  legendaryPity: 20,
  duplicateRefund: [500, 1200, 2800, 8500, 30000] as const,

  // Prestige ("Fresh Clean Account")
  prestigeThresholdCents: 250_000, // $2,500 lifetime earned for 1st prestige (scales x3.5 per prestige)
  prestigeBonusPerLevel: 0.5, // +50% global cash per prestige level
};

export function formatMoney(cents: number): string {
  const neg = cents < 0;
  const dollars = Math.abs(cents) / 100;
  let out: string;
  if (dollars >= 1e12) out = `$${(dollars / 1e12).toFixed(2)}T`;
  else if (dollars >= 1e9) out = `$${(dollars / 1e9).toFixed(2)}B`;
  else if (dollars >= 1e6) out = `$${(dollars / 1e6).toFixed(2)}M`;
  else if (dollars >= 1e4) out = `$${(dollars / 1e3).toFixed(1)}K`;
  else if (dollars >= 100) out = `$${Math.round(dollars).toLocaleString('en-US')}`;
  else out = `$${dollars.toFixed(2)}`;
  return neg ? `-${out}` : out;
}

export function formatMoneyWhole(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1e6) return formatMoney(cents);
  if (dollars >= 10) return `$${Math.round(dollars).toLocaleString('en-US')}`;
  return `$${dollars.toFixed(2)}`;
}

export function prestigeCostCents(currentPrestige: number): number {
  return Math.round(BALANCE.prestigeThresholdCents * Math.pow(3.5, currentPrestige));
}
