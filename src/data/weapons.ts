export interface WeaponDef {
  id: string;
  name: string;
  shortName: string;
  role: string;
  sortOrder: number;
  cost: number; // cents
  killPay: number;
  moveSpeed: number;
  isSidearm?: boolean;
  isMelee?: boolean;
  startsOwned?: boolean;
  damage: number;
  heavyDamage?: number;
  headshotMultiplier: number;
  pellets: number;
  fireInterval: number; // seconds
  fullAuto: boolean;
  range: number;
  pierceBodies: boolean;
  magazineSize: number;
  reloadTime: number;
  recoilKick: number; // degrees pitch
  recoilYaw: number;
  spread: number; // degrees
  spreadPerShot: number;
  maxSpread: number;
  moveSpread: number;
  airSpread: number;
  scope: boolean;
  scopeFov: number;
  noscopeSpread: number;
  color: string;
  accentColor: string;
  soundType: 'knife' | 'pistol' | 'smg' | 'shotgun' | 'ssg' | 'rifle' | 'sniper' | 'm4';
  requires?: string;
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'pistol',
    name: 'Hornet .45',
    shortName: 'HORNET',
    role: 'Sidearm (immer dabei)',
    sortOrder: 0,
    cost: 0,
    killPay: 1.0,
    moveSpeed: 1.0,
    isSidearm: true,
    startsOwned: true,
    damage: 24,
    headshotMultiplier: 2.2,
    pellets: 1,
    fireInterval: 0.18,
    fullAuto: false,
    range: 150,
    pierceBodies: false,
    magazineSize: 9,
    reloadTime: 1.25,
    recoilKick: 0.9,
    recoilYaw: 0.3,
    spread: 0.25,
    spreadPerShot: 0.35,
    maxSpread: 2.6,
    moveSpread: 2.8,
    airSpread: 7.5,
    scope: false,
    scopeFov: 75,
    noscopeSpread: 0.25,
    color: '#475569',
    accentColor: '#eab308',
    soundType: 'pistol',
  },
  {
    id: 'smg',
    name: 'Wasp MP-9',
    shortName: 'WASP',
    role: 'High-RPM SMG',
    sortOrder: 1,
    cost: 10_000, // $100
    killPay: 1.35,
    moveSpeed: 0.97,
    damage: 16,
    headshotMultiplier: 2.0,
    pellets: 1,
    fireInterval: 0.072,
    fullAuto: true,
    range: 130,
    pierceBodies: false,
    magazineSize: 30,
    reloadTime: 1.45,
    recoilKick: 0.65,
    recoilYaw: 0.45,
    spread: 0.55,
    spreadPerShot: 0.22,
    maxSpread: 3.4,
    moveSpread: 3.1,
    airSpread: 7.0,
    scope: false,
    scopeFov: 75,
    noscopeSpread: 0.55,
    color: '#334155',
    accentColor: '#38bdf8',
    soundType: 'smg',
  },
  {
    id: 'shotgun',
    name: 'Viper-12',
    shortName: 'VIPER',
    role: '8-Pellet Pump Shotgun',
    sortOrder: 2,
    cost: 60_000, // $600
    killPay: 1.8,
    moveSpeed: 0.93,
    damage: 15,
    headshotMultiplier: 1.6,
    pellets: 8,
    fireInterval: 0.72,
    fullAuto: false,
    range: 48,
    pierceBodies: false,
    magazineSize: 6,
    reloadTime: 1.9,
    recoilKick: 3.2,
    recoilYaw: 0.9,
    spread: 4.4,
    spreadPerShot: 0.5,
    maxSpread: 6.5,
    moveSpread: 3.4,
    airSpread: 6.5,
    scope: false,
    scopeFov: 75,
    noscopeSpread: 4.4,
    color: '#57534e',
    accentColor: '#f97316',
    soundType: 'shotgun',
  },
  {
    id: 'ssg',
    name: 'Mantis SSG',
    shortName: 'MANTIS',
    role: 'Leichte Bolt-Action Sniper',
    sortOrder: 3,
    cost: 300_000, // $3,000
    killPay: 2.5,
    moveSpeed: 0.94,
    damage: 78,
    headshotMultiplier: 2.2,
    pellets: 1,
    fireInterval: 0.68,
    fullAuto: false,
    range: 300,
    pierceBodies: true,
    magazineSize: 10,
    reloadTime: 2.1,
    recoilKick: 2.8,
    recoilYaw: 0.4,
    spread: 0.03,
    spreadPerShot: 0.2,
    maxSpread: 1.2,
    moveSpread: 6.5,
    airSpread: 9.0,
    scope: true,
    scopeFov: 32,
    noscopeSpread: 4.8,
    color: '#3f6212',
    accentColor: '#a3e635',
    soundType: 'ssg',
  },
  {
    id: 'rifle',
    name: 'AK-Phantom',
    shortName: 'PHANTOM',
    role: 'Heavy Assault Rifle',
    sortOrder: 4,
    cost: 600_000, // $6,000
    killPay: 3.6,
    moveSpeed: 0.89,
    damage: 32,
    headshotMultiplier: 2.8,
    pellets: 1,
    fireInterval: 0.105,
    fullAuto: true,
    range: 220,
    pierceBodies: false,
    magazineSize: 28,
    reloadTime: 1.65,
    recoilKick: 1.15,
    recoilYaw: 0.55,
    spread: 0.22,
    spreadPerShot: 0.28,
    maxSpread: 3.8,
    moveSpread: 6.8,
    airSpread: 11.5,
    scope: false,
    scopeFov: 75,
    noscopeSpread: 0.22,
    color: '#78350f',
    accentColor: '#ef4444',
    soundType: 'rifle',
  },
  {
    id: 'sniper',
    name: 'AWP-Apex',
    shortName: 'APEX',
    role: 'One-Shot Heavy Sniper',
    sortOrder: 5,
    cost: 1_500_000, // $15,000
    killPay: 5.5,
    moveSpeed: 0.85,
    damage: 135,
    headshotMultiplier: 2.5,
    pellets: 1,
    fireInterval: 1.15,
    fullAuto: false,
    range: 350,
    pierceBodies: true,
    magazineSize: 5,
    reloadTime: 2.35,
    recoilKick: 4.5,
    recoilYaw: 0.6,
    spread: 0.01,
    spreadPerShot: 0.2,
    maxSpread: 1.0,
    moveSpread: 9.5,
    airSpread: 13.5,
    scope: true,
    scopeFov: 22,
    noscopeSpread: 7.2,
    color: '#1e3a2f',
    accentColor: '#22d3ee',
    soundType: 'sniper',
  },
  {
    id: 'm4',
    name: 'Locust M4-X',
    shortName: 'LOCUST',
    role: 'Präzisions-Endgame-Rifle',
    sortOrder: 6,
    cost: 5_000_000, // $50,000
    killPay: 8.5,
    moveSpeed: 0.91,
    damage: 34,
    headshotMultiplier: 2.6,
    pellets: 1,
    fireInterval: 0.082,
    fullAuto: true,
    range: 240,
    pierceBodies: false,
    magazineSize: 32,
    reloadTime: 1.4,
    recoilKick: 0.72,
    recoilYaw: 0.32,
    spread: 0.16,
    spreadPerShot: 0.16,
    maxSpread: 2.4,
    moveSpread: 5.8,
    airSpread: 10.5,
    scope: false,
    scopeFov: 75,
    noscopeSpread: 0.16,
    color: '#1e293b',
    accentColor: '#a855f7',
    soundType: 'm4',
  },
  {
    id: 'knife',
    name: 'Tactical Knife',
    shortName: 'KNIFE',
    role: 'Melee (Schnelles Laufen)',
    sortOrder: 100,
    cost: 0,
    killPay: 1.5,
    moveSpeed: 1.14,
    isMelee: true,
    startsOwned: true,
    damage: 45,
    heavyDamage: 80,
    headshotMultiplier: 1.5,
    pellets: 1,
    fireInterval: 0.42,
    fullAuto: true,
    range: 3.1,
    pierceBodies: false,
    magazineSize: 1,
    reloadTime: 0.5,
    recoilKick: 0,
    recoilYaw: 0,
    spread: 0,
    spreadPerShot: 0,
    maxSpread: 0,
    moveSpread: 0,
    airSpread: 0,
    scope: false,
    scopeFov: 75,
    noscopeSpread: 0,
    color: '#cbd5e1',
    accentColor: '#f43f5e',
    soundType: 'knife',
  },
];

export interface SpreadInput {
  def: WeaponDef;
  horizSpeed: number;
  maxMoveSpeed: number;
  grounded: boolean;
  crouching: boolean;
  scoped: boolean;
  shotBloom: number;
  spreadMult: number;
}

export interface SpreadResult {
  totalDeg: number;
  baseDeg: number;
  moveErrorDeg: number;
  airErrorDeg: number;
  isAccurate: boolean;
}

/**
 * Computes VALORANT-style tactical ballistic spread:
 * pinpoint accuracy below the counter-strafe deadzone (<= 28% max speed),
 * heavy inaccuracy ramp when running or airborne, and crouch precision bonus.
 */
export function computeWeaponSpreadDeg(input: SpreadInput): SpreadResult {
  const { def, horizSpeed, maxMoveSpeed, grounded, crouching, scoped, shotBloom, spreadMult } = input;
  if (def.isMelee || spreadMult <= 0.0001) {
    return { totalDeg: 0, baseDeg: 0, moveErrorDeg: 0, airErrorDeg: 0, isAccurate: true };
  }

  const speedFrac = horizSpeed / Math.max(0.5, maxMoveSpeed);
  let moveErrorDeg = 0;
  let airErrorDeg = 0;

  if (!grounded) {
    airErrorDeg = def.airSpread;
    moveErrorDeg = def.moveSpread * Math.min(1.2, speedFrac * 0.6);
  } else if (speedFrac > 0.28) {
    const u = Math.min(1.35, Math.max(0, (speedFrac - 0.28) / (0.85 - 0.28)));
    const ramp = Math.pow(u, 0.85);
    moveErrorDeg = def.moveSpread * ramp * (crouching ? 0.42 : 1.0);
  }

  let baseDeg = def.scope && !scoped ? def.noscopeSpread : def.spread;
  if (grounded && crouching && (!def.scope || scoped)) {
    baseDeg *= 0.78;
  }

  const totalDeg = (baseDeg + shotBloom + moveErrorDeg + airErrorDeg) * spreadMult;
  const isAccurate = (moveErrorDeg + airErrorDeg) * spreadMult < 0.15;
  return { totalDeg, baseDeg, moveErrorDeg, airErrorDeg, isAccurate };
}

/**
 * Samples true circular cone ray offsets; biases distribution outward when moving/airborne
 * so full-running shots deviate off-center like VALORANT rather than sneaking bullseyes.
 */
export function sampleSpreadOffsets(spreadDeg: number, moveAirErrorDeg: number): { x: number; y: number } {
  if (spreadDeg <= 0.0001) return { x: 0, y: 0 };
  const angle = Math.random() * Math.PI * 2;
  const rNorm = moveAirErrorDeg > 0.4 ? Math.pow(Math.random(), 0.48) : Math.sqrt(Math.random());
  const coneRad = ((spreadDeg * Math.PI) / 180) * rNorm;
  const tanR = Math.tan(coneRad);
  return { x: Math.cos(angle) * tanR, y: Math.sin(angle) * tanR };
}

export function getWeaponDef(id: string): WeaponDef {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
}
