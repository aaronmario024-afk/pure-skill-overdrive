export type ModeId = 'range' | 'arena' | 'snd' | 'defend' | 'dm' | 'hvh';

export interface ModeDef {
  id: ModeId;
  name: string;
  mapName: string;
  tagline: string;
  description: string;
  cost: number; // cents, 0 = unlocked
  duration: number; // seconds (or per round for defend)
  rounds?: number;
  botCount: number;
  killPayMult: number;
  accent: string;
  skyColor: string;
  fogColor: string;
  floorColor: string;
  wallColor: string;
  thinWallColor: string;
  crateColor: string;
  cheaterBots?: boolean;
  isPractice?: boolean;
}

export const MODES: ModeDef[] = [
  {
    id: 'range',
    name: 'Shooting Range',
    mapName: 'tr_aimlab',
    tagline: 'Freies Training & DPS-Test',
    description: 'Unsterbliche, zerstörbare & strafende Dummies. Teste Waffen, Recoil und Cheats ohne Risiko.',
    cost: 0,
    duration: 9999,
    botCount: 0,
    killPayMult: 0,
    accent: '#94a3b8',
    skyColor: '#1e293b',
    fogColor: '#1e293b',
    floorColor: '#334155',
    wallColor: '#475569',
    thinWallColor: '#64748b',
    crateColor: '#b45309',
    isPractice: true,
  },
  {
    id: 'arena',
    name: '1v1 Arena',
    mapName: 'aim_dockyard',
    tagline: 'Du gegen 1 Bot · Schnelle Duells',
    description: 'Symmetrische Dockyard-Arena. Perfekt um die ersten Dollars für Hitbox Expander zu verdienen.',
    cost: 0,
    duration: 25,
    botCount: 1,
    killPayMult: 1.0,
    accent: '#38bdf8',
    skyColor: '#38bdf8',
    fogColor: '#7dd3fc',
    floorColor: '#64748b',
    wallColor: '#475569',
    thinWallColor: '#94a3b8',
    crateColor: '#c2410c',
  },
  {
    id: 'snd',
    name: 'Search & Destroy (5v5)',
    mapName: 'District 9 / Cold Front / Neon Market',
    tagline: 'Rundenbasiert · Buy-Phase · Bombe A/B · Spectator',
    description: 'Kompetitiver 5v5 Taktik-Modus wie CS/CoD! Wähle aus 3 Maps, kaufe Waffen mit Match-Cash, plante/entschärfe auf Site A oder B und spiele bis 13 mit Seitenwechsel & Overtime.',
    cost: 0,
    duration: 95,
    rounds: 24,
    botCount: 9,
    killPayMult: 3.5,
    accent: '#22c55e',
    skyColor: '#38bdf8',
    fogColor: '#94a3b8',
    floorColor: '#475569',
    wallColor: '#64748b',
    thinWallColor: '#94a3b8',
    crateColor: '#9a5b25',
  },
  {
    id: 'defend',
    name: 'Site Defense',
    mapName: 'def_sandkeep',
    tagline: 'Halte die Bombe · 3 Runden à 30s',
    description: '4 Angreifer stürmen die Site. Töte alle bevor einer in 3s plantet! Flawless-Runden zahlen 1.5x.',
    cost: 25_000, // $250
    duration: 30,
    rounds: 3,
    botCount: 4,
    killPayMult: 3.0,
    accent: '#f59e0b',
    skyColor: '#f59e0b',
    fogColor: '#fcd34d',
    floorColor: '#d6b485',
    wallColor: '#a68256',
    thinWallColor: '#c7a474',
    crateColor: '#854d0e',
  },
  {
    id: 'dm',
    name: '8-Player Deathmatch',
    mapName: 'dm_icefoundry',
    tagline: 'Chaos pur · 7 Bots · Wallbang-Wände',
    description: 'Klassische Ice-Map mit dünnen Wallbang-Trennwänden, Kisten und Dauerfeuer. Jeder Kill zahlt 4x!',
    cost: 250_000, // $2,500
    duration: 50,
    botCount: 7,
    killPayMult: 4.5,
    accent: '#22d3ee',
    skyColor: '#0ea5e9',
    fogColor: '#bae6fd',
    floorColor: '#cbd5e1',
    wallColor: '#475569',
    thinWallColor: '#7dd3fc',
    crateColor: '#0284c7',
  },
  {
    id: 'hvh',
    name: 'HvH: Hack vs. Hack',
    mapName: 'hvh_cybergrid',
    tagline: 'Gegner-Bots cheaten auch! · 10x Pay',
    description: 'Rivalisierende Spinbot- & Bunnyhop-Bots im Neon-Grid. Extreme Cash-Multiplikatoren — nur für echte Rage-Configs!',
    cost: 2_500_000, // $25,000
    duration: 60,
    botCount: 8,
    killPayMult: 11.0,
    accent: '#f43f5e',
    skyColor: '#09090b',
    fogColor: '#1e1b4b',
    floorColor: '#18181b',
    wallColor: '#312e81',
    thinWallColor: '#a21caf',
    crateColor: '#be123c',
    cheaterBots: true,
  },
];

export function getMode(id: ModeId): ModeDef {
  return MODES.find((m) => m.id === id) ?? MODES[1];
}
