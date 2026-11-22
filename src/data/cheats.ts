export type CheatCategoryId =
  | 'hitbox'
  | 'norecoil'
  | 'wallhack'
  | 'bunnyhop'
  | 'speedhack'
  | 'bypass'
  | 'triggerbot'
  | 'ammo'
  | 'aimbot'
  | 'spinbot'
  | 'backtrack'
  | 'rage';

export interface CheatNodeDef {
  id: string;
  cheatId: CheatCategoryId;
  name: string;
  kind: 'upgrade' | 'feature' | 'synergy';
  requires?: string; // optionId in same cheat, or 'cheatId:optionId'
  synergyWith?: string; // second prerequisite 'cheatId' or 'cheatId:optionId'
  cost: number; // cents
  tip: string; // Supports <head>, <pay>, <green>, <red>, <gold>, <rainbow>, <bank>, <heat>, <b>
  statLabel?: string;
  before?: string;
  after?: string;
  col: number; // grid col offset relative to cheat root (-2..2)
  row: number; // grid depth (1..6)
}

export interface CheatTuneDef {
  id: string;
  label: string;
  kind: 'choice' | 'swatch' | 'toggle';
  choices?: { value: string; label: string }[];
  swatches?: string[];
  defaultValue: string;
}

export interface CheatDef {
  id: CheatCategoryId;
  name: string;
  file: string;
  tab: 'aim' | 'visuals' | 'movement' | 'weapons' | 'stealth' | 'rage';
  color: string;
  licenseCost: number; // cents
  tagline: string;
  tip: string;
  heatPerKill: number; // base suspicion heat added when blatantly active
  tunes: CheatTuneDef[];
  nodes: CheatNodeDef[];
}

export const CHEATS: CheatDef[] = [
  // 1. HITBOX EXPANDER
  {
    id: 'hitbox',
    name: 'Hitbox Expander',
    file: 'hitbox_v3.dll',
    tab: 'aim',
    color: '#ef4444',
    licenseCost: 1_000, // $10
    tagline: 'Größere Köpfe. Gleiches Aim.',
    tip: 'Vergrößert <head>Kopf-Hitboxen</head> auf <b>1.6x</b>. Aufeinanderfolgende <head>Headshot-Kills</head> starten eine <head>Streak</head>: <b>+15%</b> <pay>Pay</pay> pro Kill (max <b>2x</b>).',
    heatPerKill: 5.0,
    tunes: [
      { id: 'look', label: 'Kopf-Optik', kind: 'choice', choices: [{ value: 'box', label: 'Hitbox-Rahmen' }, { value: 'balloon', label: 'Ballon-Kopf' }], defaultValue: 'box' },
      { id: 'color', label: 'Box-Farbe', kind: 'swatch', swatches: ['#ef4444', '#facc15', '#22d3ee', '#a855f7', '#4ade80'], defaultValue: '#ef4444' },
    ],
    nodes: [
      { id: 'headsize', cheatId: 'hitbox', name: 'Head Size I', kind: 'upgrade', cost: 2_000, tip: '<head>Köpfe</head> werden noch größer.', before: '1.6x', after: '2.1x', col: -1, row: 1 },
      { id: 'headdmg', cheatId: 'hitbox', name: 'Head Damage', kind: 'upgrade', requires: 'headsize', cost: 3_500, tip: 'Mehr <head>Headshot</head>-Schaden mit jeder Waffe.', before: '1.0x', after: '1.35x', col: -2, row: 2 },
      { id: 'headsize2', cheatId: 'hitbox', name: 'Head Size II', kind: 'upgrade', requires: 'headsize', cost: 6_000, tip: 'Gigantische <head>Kopf-Hitbox</head>.', before: '2.1x', after: '2.8x', col: -1, row: 2 },
      { id: 'fullbody', cheatId: 'hitbox', name: 'Full Body Head', kind: 'feature', requires: 'headsize2', cost: 22_000, tip: '<b>Jeder Treffer</b> am Körper zählt als <head>Headshot</head>!', col: -1, row: 3 },

      { id: 'hsbonus', cheatId: 'hitbox', name: 'Headshot Pay', kind: 'upgrade', cost: 1_500, tip: '<head>Headshot</head>-Kills <pay>zahlen mehr</pay>.', before: '1.0x', after: '1.5x', col: 1, row: 1 },
      { id: 'streakcap', cheatId: 'hitbox', name: 'Streak Cap I', kind: 'upgrade', requires: 'hsbonus', cost: 8_000, tip: 'Höheres Maximum für deine <head>Headshot-Streak</head>.', before: '2x', after: '3x', col: 1, row: 2 },
      { id: 'streakstep', cheatId: 'hitbox', name: 'Streak Step', kind: 'upgrade', requires: 'streakcap', cost: 15_000, tip: 'Deine <head>Streak</head> wächst schneller pro Kill.', before: '+15%', after: '+25%', col: 1, row: 3 },
      { id: 'streakcap2', cheatId: 'hitbox', name: 'Streak Cap II', kind: 'upgrade', requires: 'streakstep', cost: 60_000, tip: 'Noch höheres <head>Streak</head>-Cap.', before: '3x', after: '6x', col: 1, row: 4 },
      { id: 'streakcap3', cheatId: 'hitbox', name: 'Streak Cap III', kind: 'upgrade', requires: 'streakcap2', cost: 220_000, tip: 'Brutales <head>Streak</head>-Cap für Endgame-Farming.', before: '6x', after: '12x', col: 1, row: 5 },
    ],
  },

  // 2. NO RECOIL
  {
    id: 'norecoil',
    name: 'No Recoil',
    file: 'laser_rc.dll',
    tab: 'weapons',
    color: '#38bdf8',
    licenseCost: 15_000, // $150
    tagline: 'Laser-Präzision ohne Streuung.',
    tip: 'Reduziert den Rückstoß deiner Waffen um <b>55%</b>.',
    heatPerKill: 3.5,
    tunes: [],
    nodes: [
      { id: 'recoil', cheatId: 'norecoil', name: 'Zero Recoil', kind: 'upgrade', cost: 25_000, tip: 'Rückstoß sinkt komplett auf <b>0%</b>.', before: '-55%', after: '-100%', col: -1, row: 1 },
      { id: 'nospread', cheatId: 'norecoil', name: 'No Spread', kind: 'feature', requires: 'recoil', cost: 55_000, tip: '<b>Jede Kugel</b> trifft exakt in die Mitte — auch beim Laufen & Springen!', col: -1, row: 2 },
      { id: 'longshot', cheatId: 'norecoil', name: 'Longshot Pay', kind: 'feature', cost: 35_000, tip: 'Kills aus <b>20m+</b> Entfernung zahlen <pay>2.5x</pay>.', col: 1, row: 1 },
    ],
  },

  // 3. WALLHACK & BOUNTY ESP
  {
    id: 'wallhack',
    name: 'Wallhack + ESP',
    file: 'xray_esp.dll',
    tab: 'visuals',
    color: '#4ade80',
    licenseCost: 25_000, // $250
    tagline: 'Sieh alle Bots & Bounties durch Wände.',
    tip: 'Zeigt <b>ESP-Boxen & Chams</b> durch Wände. Schaltet <green>Grüne (2x)</green> und <red>Rote (3x)</red> Bounty-Bots frei.',
    heatPerKill: 4.5,
    tunes: [
      { id: 'chams', label: 'Chams-Umriss', kind: 'toggle', defaultValue: '1' },
      { id: 'boxes', label: '2D ESP-Boxen', kind: 'toggle', defaultValue: '1' },
    ],
    nodes: [
      { id: 'greenrate', cheatId: 'wallhack', name: 'Green Spawns', kind: 'upgrade', cost: 30_000, tip: 'Mehr <green>grüne</green> Bots (<pay>2x Pay</pay>).', before: '18%', after: '38%', col: -1, row: 1 },
      { id: 'redrate', cheatId: 'wallhack', name: 'Red Spawns', kind: 'upgrade', requires: 'greenrate', cost: 65_000, tip: 'Mehr <red>rote</red> Bots (<pay>3x Pay</pay>).', before: '8%', after: '24%', col: -1, row: 2 },
      { id: 'gold', cheatId: 'wallhack', name: 'Gold Bounty', kind: 'feature', requires: 'redrate', cost: 140_000, tip: 'Seltene <gold>Gold-Bots</gold> spawnen und zahlen <pay>10x</pay>!', col: -1, row: 3 },
      { id: 'goldrate', cheatId: 'wallhack', name: 'Gold Spawns', kind: 'upgrade', requires: 'gold', cost: 280_000, tip: 'Mehr <gold>Gold-Bots</gold> pro Match.', before: '5%', after: '15%', col: -1, row: 4 },
      { id: 'rainbow', cheatId: 'wallhack', name: 'Rainbow Runner', kind: 'feature', requires: 'goldrate', cost: 650_000, tip: 'Spawnt rasende <rainbow>Rainbow-Bots</rainbow> mit <pay>50x Pay</pay>!', col: -1, row: 5 },

      { id: 'wallbang', cheatId: 'wallhack', name: 'Wallbang', kind: 'feature', cost: 45_000, tip: 'Kugeln durchschlagen <b>dünne Wände</b> (<b>60%</b> Schaden).', col: 1, row: 1 },
      { id: 'damage', cheatId: 'wallhack', name: 'Full Wall Dmg', kind: 'upgrade', requires: 'wallbang', cost: 90_000, tip: 'Kein Schadensverlust mehr durch Wände.', before: '60%', after: '100%', col: 1, row: 2 },
      { id: 'thickwalls', cheatId: 'wallhack', name: 'Thick Crates', kind: 'feature', requires: 'damage', cost: 160_000, tip: 'Durchschlägt jetzt auch <b>Kisten & Säulen</b>.', col: 1, row: 3 },
      { id: 'allwalls', cheatId: 'wallhack', name: 'All Walls Pierce', kind: 'feature', requires: 'thickwalls', cost: 420_000, tip: 'Durchschlägt <b>ALLE Wände</b> (bis zu 3 Lagen)!', col: 1, row: 4 },
      { id: 'wallpay', cheatId: 'wallhack', name: 'Wallbang Pay', kind: 'upgrade', requires: 'allwalls', cost: 750_000, tip: 'Kills durch Wände <pay>zahlen massiv mehr</pay>.', before: '1.0x', after: '2.5x', col: 1, row: 5 },
    ],
  },

  // 4. BUNNYHOP
  {
    id: 'bunnyhop',
    name: 'Bunnyhop',
    file: 'bhop_script.dll',
    tab: 'movement',
    color: '#2dd4bf',
    licenseCost: 35_000, // $350
    tagline: 'Halte Leertaste. Fliege über die Map.',
    tip: '<b>Leertaste halten</b> springt automatisch weiter und baut pro Hop mehr Tempo auf (<b>Hop-Chain</b>).',
    heatPerKill: 4.0,
    tunes: [],
    nodes: [
      { id: 'topspeed', cheatId: 'bunnyhop', name: 'Hyper Speed', kind: 'upgrade', cost: 45_000, tip: 'Höheres maximales Hop-Tempo.', before: '1.6x', after: '2.4x', col: -1, row: 1 },
      { id: 'airstrafe', cheatId: 'bunnyhop', name: 'Air Strafe', kind: 'feature', requires: 'topspeed', cost: 80_000, tip: '<b>Kein Tempoverlust</b> bei Kurven in der Luft.', col: -1, row: 2 },
      { id: 'moonhop', cheatId: 'bunnyhop', name: 'Moonhop', kind: 'feature', requires: 'airstrafe', cost: 180_000, tip: 'Springe <b>1.8x höher</b> und bis zu <b>3.2x Tempo</b>!', col: -1, row: 3 },

      { id: 'hoppay', cheatId: 'bunnyhop', name: 'Hop Chain Pay', kind: 'feature', cost: 60_000, tip: 'Jeder Hop in Folge addiert <b>+25%</b> <pay>Kill-Pay</pay> (max 5 Hops).', col: 1, row: 1 },
      { id: 'chaincap', cheatId: 'bunnyhop', name: 'Chain Cap+', kind: 'upgrade', requires: 'hoppay', cost: 140_000, tip: 'Hop-Pay stapelt bis zu <b>12 Hops</b> (<b>+300%</b>!).', before: '5 Hops', after: '12 Hops', col: 1, row: 2 },
      { id: 'dodge', cheatId: 'bunnyhop', name: 'Speed Dodge', kind: 'feature', requires: 'chaincap', cost: 240_000, tip: 'Im hohen Tempo treffen Bots dich <b>50% seltener</b>.', col: 1, row: 3 },
    ],
  },

  // 5. SPEEDHACK + BLINK
  {
    id: 'speedhack',
    name: 'Speedhack',
    file: 'timewarp.dll',
    tab: 'movement',
    color: '#fbbf24',
    licenseCost: 45_000, // $450
    tagline: 'Lauf schneller als der Server tickt.',
    tip: '<b>+20%</b> Grund-Lauftempo.',
    heatPerKill: 5.5,
    tunes: [],
    nodes: [
      { id: 'speed', cheatId: 'speedhack', name: 'Turbo Speed', kind: 'upgrade', cost: 55_000, tip: 'Noch schnelleres Lauftempo.', before: '+20%', after: '+65%', col: -1, row: 1 },
      { id: 'killdash', cheatId: 'speedhack', name: 'Kill Dash', kind: 'feature', requires: 'speed', cost: 110_000, tip: 'Nach jedem Kill: <b>2x Tempo</b> für <b>1.8s</b>.', col: -1, row: 2 },
      { id: 'blink', cheatId: 'speedhack', name: 'Kill Blink', kind: 'feature', requires: 'killdash', cost: 320_000, tip: '<b>Teleportiert dich</b> nach einem Kill direkt zum nächsten Bot (<b>+100% Blink-Pay</b>)!', col: -1, row: 3 },

      { id: 'dodge', cheatId: 'speedhack', name: 'Sprint Evasion', kind: 'feature', cost: 70_000, tip: 'Beim Bewegen verfehlen Bots dich <b>45% häufiger</b>.', col: 1, row: 1 },
      { id: 'momentum', cheatId: 'speedhack', name: 'Momentum Pay', kind: 'feature', requires: 'dodge', cost: 160_000, tip: 'Schnelle Multi-Kills zahlen bis zu <pay>2.5x</pay>!', col: 1, row: 2 },
    ],
  },

  // 6. ANTI-CHEAT BYPASS & SPOOFER (NEW!)
  {
    id: 'bypass',
    name: 'Anti-Cheat Bypass',
    file: 'kernel_spoof.sys',
    tab: 'stealth',
    color: '#10b981',
    licenseCost: 40_000, // $400
    tagline: 'Bleib unter dem Radar der Admins.',
    tip: 'Senkt generierte <heat>Suspicion/Heat</heat> um <b>35%</b> und verlangsamt Bot-Reports.',
    heatPerKill: -4.0,
    tunes: [],
    nodes: [
      { id: 'smooth', cheatId: 'bypass', name: 'Fake-Legit Smooth', kind: 'upgrade', cost: 65_000, tip: 'Tarnung für Aimbot & Wallbangs: <b>-65%</b> <heat>Heat</heat>.', before: '-35%', after: '-65%', col: -1, row: 1 },
      { id: 'votekick', cheatId: 'bypass', name: 'Vote-Kick Blocker', kind: 'feature', requires: 'smooth', cost: 140_000, tip: 'Blockiert automatische <b>Vote-Kicks</b> der Bots komplett und zahlt <pay>+$25 Troll-Bonus</pay>!', col: -1, row: 2 },
      { id: 'hwid', cheatId: 'bypass', name: 'HWID Spoofer', kind: 'feature', requires: 'votekick', cost: 350_000, tip: 'Überlebt bis zu <b>2 Admin-Ban-Treffer</b> pro Match ohne Disconnect!', col: -1, row: 3 },
      { id: 'jammer', cheatId: 'bypass', name: 'Admin Jammer', kind: 'feature', requires: 'hwid', cost: 750_000, tip: '<b>Boss-Admins</b> spawnen mit <b>50% weniger HP</b> und doppeltem <pay>Bounty (150x)</pay>!', col: -1, row: 4 },
    ],
  },

  // 7. TRIGGERBOT
  {
    id: 'triggerbot',
    name: 'Triggerbot',
    file: 'auto_trig.dll',
    tab: 'aim',
    color: '#fb923c',
    licenseCost: 60_000, // $600
    tagline: 'Schießt im Millisekunden-Fenster.',
    tip: 'Feuert automatisch, sobald dein Fadenkreuz über einem Bot ist (<b>120ms</b> Reaktion).',
    heatPerKill: 6.5,
    tunes: [
      { id: 'headwait', label: 'Nur auf Kopf warten', kind: 'toggle', defaultValue: '0' },
    ],
    nodes: [
      { id: 'reaction', cheatId: 'triggerbot', name: '0ms Reaction', kind: 'upgrade', cost: 75_000, tip: 'Reaktionszeit sinkt auf <b>Sofort (15ms)</b>.', before: '120ms', after: '15ms', col: -1, row: 1 },
      { id: 'rapidtap', cheatId: 'triggerbot', name: 'Rapid-Tap Overclock', kind: 'feature', requires: 'reaction', cost: 180_000, tip: 'Feuert <b>+35% schneller</b> als das Waffen-RPM-Limit.', col: -1, row: 2 },
      { id: 'xray', cheatId: 'triggerbot', name: 'X-Ray Trigger', kind: 'synergy', requires: 'rapidtap', synergyWith: 'wallhack:wallbang', cost: 360_000, tip: '<b>SYNERGIE</b>: Feuert automatisch durch durchschlagbare Wände!', col: -1, row: 3 },

      { id: 'autoreload', cheatId: 'triggerbot', name: 'Auto-Reload', kind: 'feature', cost: 60_000, tip: 'Lädt automatisch nach, wenn kein Bot im Blickfeld ist.', col: 1, row: 1 },
      { id: 'clean', cheatId: 'triggerbot', name: 'Clean Kills Pay', kind: 'feature', requires: 'autoreload', cost: 130_000, tip: 'Kills ohne vorherigen Fehlschuss zahlen <pay>2.0x</pay>!', col: 1, row: 2 },
    ],
  },

  // 8. AMMO & PIGGY BANK
  {
    id: 'ammo',
    name: 'Ammo + Piggy Bank',
    file: 'inf_ammo.dll',
    tab: 'weapons',
    color: '#f472b6',
    licenseCost: 80_000, // $800
    tagline: 'Jede Kugel druckt Geld.',
    tip: '<b>+50%</b> Magazingröße für alle Waffen.',
    heatPerKill: 2.5,
    tunes: [],
    nodes: [
      { id: 'magazine', cheatId: 'ammo', name: 'Drum Mag', kind: 'upgrade', cost: 90_000, tip: 'Verdreifacht deine Magazingröße.', before: '+50%', after: '+200%', col: -1, row: 1 },
      { id: 'infinite', cheatId: 'ammo', name: 'Infinite Ammo', kind: 'feature', requires: 'magazine', cost: 240_000, tip: '<b>Unendliche Munition</b> — nie wieder nachladen!', col: -1, row: 2 },

      { id: 'piggy', cheatId: 'ammo', name: 'Piggy Bank', kind: 'feature', cost: 100_000, tip: 'Jeder Schuss legt <b>15% Kill-Pay</b> ins <bank>Sparschwein</bank> (Auszahlung am Match-Ende).', col: 1, row: 1 },
      { id: 'hit', cheatId: 'ammo', name: 'Hit Deposit 3x', kind: 'feature', requires: 'piggy', cost: 180_000, tip: 'Treffer zahlen <b>3x</b> so viel ins <bank>Sparschwein</bank>!', col: 1, row: 2 },
      { id: 'gold', cheatId: 'ammo', name: 'Gold Bullets', kind: 'feature', requires: 'hit', cost: 340_000, tip: '<b>1 von 15 Kugeln</b> ist <gold>Gold</gold>: <b>10x</b> ins <bank>Sparschwein</bank>!', col: 0, row: 3 },
      { id: 'interest', cheatId: 'ammo', name: 'Kill Interest', kind: 'feature', requires: 'hit', cost: 380_000, tip: 'Jeder Kill verzinst dein <bank>Sparschwein</bank> um <pay>+10%</pay>!', col: 1, row: 3 },
      { id: 'compound', cheatId: 'ammo', name: 'Compound +25%', kind: 'upgrade', requires: 'interest', cost: 900_000, tip: 'Exponentieller Zinseszins pro Kill im <bank>Sparschwein</bank>!', before: '+10%', after: '+25%', col: 1, row: 4 },
      { id: 'storm', cheatId: 'ammo', name: 'Fire Storm', kind: 'feature', requires: 'gold', cost: 620_000, tip: '<b>3s Dauerfeuer</b>: doppelte Einzahlungen ins <bank>Sparschwein</bank>!', col: 0, row: 4 },
    ],
  },

  // 9. AIMBOT + VOLLEY
  {
    id: 'aimbot',
    name: 'Aimbot + Volley',
    file: 'aimlock_pro.dll',
    tab: 'aim',
    color: '#c084fc',
    licenseCost: 120_000, // $1,200
    tagline: 'Dein Fadenkreuz klebt an Köpfen.',
    tip: 'Zieht dein Aim automatisch auf den nächsten sichtbaren <head>Kopf</head> im <b>18° FOV-Kreis</b>.',
    heatPerKill: 10.0,
    tunes: [
      { id: 'ring', label: 'FOV-Ring anzeigen', kind: 'toggle', defaultValue: '1' },
      { id: 'mode', label: 'Modus', kind: 'choice', choices: [{ value: 'legit', label: 'Smooth (Legit)' }, { value: 'rage', label: 'Snap (Blatant)' }], defaultValue: 'legit' },
    ],
    nodes: [
      { id: 'fov', cheatId: 'aimbot', name: 'Wide FOV', kind: 'upgrade', cost: 140_000, tip: 'Größerer Aimbot-Erfassungsbereich.', before: '18°', after: '42°', col: -1, row: 1 },
      { id: 'snap', cheatId: 'aimbot', name: 'Instant Snap', kind: 'upgrade', requires: 'fov', cost: 240_000, tip: 'Lockt blitzschnell auf das Ziel ein.', before: 'Smooth', after: '1-Frame', col: -1, row: 2 },
      { id: 'fullscreen', cheatId: 'aimbot', name: '360° Fullscreen', kind: 'feature', requires: 'snap', cost: 520_000, tip: 'Lock-Bereich: <b>kompletter Bildschirm (360°)</b>!', col: -1, row: 3 },
      { id: 'walllock', cheatId: 'aimbot', name: 'Wall-Lock', kind: 'synergy', requires: 'fullscreen', synergyWith: 'wallhack:wallbang', cost: 880_000, tip: '<b>SYNERGIE</b>: Lockt Ziele auch durch durchschlagbare Wände!', col: -1, row: 4 },

      { id: 'lock', cheatId: 'aimbot', name: 'Bounty Priority', kind: 'feature', cost: 160_000, tip: 'Zielt immer zuerst auf den <pay>wertvollsten Bot</pay> (Rainbow > Gold > Red > Green).', col: 1, row: 1 },
      { id: 'volley', cheatId: 'aimbot', name: 'Multi-Volley', kind: 'feature', requires: 'lock', cost: 380_000, tip: 'Alle <b>8s</b>: Dein nächster Schuss <head>headshottet 3 Bots</head> gleichzeitig!', col: 1, row: 2 },
      { id: 'volleyrate', cheatId: 'aimbot', name: 'Fast Volley', kind: 'upgrade', requires: 'volley', cost: 680_000, tip: 'Volley lädt doppelt so schnell auf.', before: '8s', after: '3.5s', col: 1, row: 3 },
      { id: 'volleyall', cheatId: 'aimbot', name: 'Lobby Volley', kind: 'feature', requires: 'volleyrate', cost: 1_600_000, tip: 'Volley trifft <b>JEDEN Bot in Sichtweite</b> auf einmal!', col: 1, row: 4 },
    ],
  },

  // 10. SPINBOT / ANTI-AIM (NEW!)
  {
    id: 'spinbot',
    name: 'Spinbot / Anti-Aim',
    file: 'antiaim_360.dll',
    tab: 'stealth',
    color: '#e879f9',
    licenseCost: 250_000, // $2,500
    tagline: 'Unmöglicher Winkel. Unantastbar.',
    tip: 'Desynchronisiert deine Hitbox: Bots treffen dich <b>50% seltener</b> und dein Modell rotiert wie ein Beyblade.',
    heatPerKill: 11.0,
    tunes: [],
    nodes: [
      { id: 'jitter', cheatId: 'spinbot', name: 'Desync Jitter', kind: 'upgrade', cost: 340_000, tip: 'Bots treffen dich <b>80% seltener</b>!', before: '50%', after: '80%', col: -1, row: 1 },
      { id: 'autospin', cheatId: 'spinbot', name: 'Auto-360 Pay', kind: 'feature', requires: 'jitter', cost: 620_000, tip: 'Jeder Kill zählt automatisch als <b>360° Spin-Kill</b> (<pay>+200% Pay</pay>)!', col: -1, row: 2 },
      { id: 'deflect', cheatId: 'spinbot', name: 'HvH Resolver', kind: 'feature', requires: 'autospin', cost: 1_200_000, tip: 'Knackt gegnerische Spinbots im <b>HvH-Modus</b> (+100% Schaden gegen Cheater-Bots)!', col: -1, row: 3 },
    ],
  },

  // 11. BACKTRACK / LAG-SWITCH (NEW!)
  {
    id: 'backtrack',
    name: 'Backtrack / Lag',
    file: 'chrono_lag.dll',
    tab: 'visuals',
    color: '#22d3ee',
    licenseCost: 400_000, // $4,000
    tagline: 'Schieß auf ihre Vergangenheit.',
    tip: 'Bots hinterlassen leuchtende <b>Zeitgeister (0.8s)</b>. Ein Treffer auf einen Geist zählt als <pay>BACKTRACK-KILL (+150%)</pay>!',
    heatPerKill: 8.5,
    tunes: [],
    nodes: [
      { id: 'window', cheatId: 'backtrack', name: 'Long Ghost 1.6s', kind: 'upgrade', cost: 520_000, tip: 'Längere Zeitgeist-Spur für riesige Zielzonen.', before: '0.8s', after: '1.6s', col: -1, row: 1 },
      { id: 'freeze', cheatId: 'backtrack', name: 'Lag-Switch Peek', kind: 'feature', requires: 'window', cost: 920_000, tip: 'Wenn dich ein Bot sieht, friert seine Reaktion für <b>0.7s</b> ein!', col: -1, row: 2 },
      { id: 'chronoblast', cheatId: 'backtrack', name: 'Chrono-Echo', kind: 'synergy', requires: 'freeze', synergyWith: 'rage:explode', cost: 2_200_000, tip: '<b>SYNERGIE</b>: Backtrack-Kills lösen doppelte Explosionen an Geist & Bot aus!', col: -1, row: 3 },
    ],
  },

  // 12. RAGE MODE
  {
    id: 'rage',
    name: 'RAGE OVERDRIVE',
    file: 'rage_god.dll',
    tab: 'rage',
    color: '#ff1e56',
    licenseCost: 1_500_000, // $15,000
    tagline: 'Komplette Lobby-Auslöschung.',
    tip: '<b>+50%</b> Waffenschaden. Entfesselt explosive Kettenreaktionen & God-Feuerrate.',
    heatPerKill: 14.0,
    tunes: [],
    nodes: [
      { id: 'damage', cheatId: 'rage', name: 'Mega Damage', kind: 'upgrade', cost: 1_800_000, tip: 'Massiv mehr Waffenschaden.', before: '+50%', after: '+200%', col: -1, row: 1 },
      { id: 'onetap', cheatId: 'rage', name: 'One-Tap God', kind: 'feature', requires: 'damage', cost: 3_200_000, tip: '<head>Headshots</head> töten <b>IMMER mit einem Schuss</b> (auch durch Wände)!', col: -1, row: 2 },
      { id: 'explode', cheatId: 'rage', name: 'Exploding Bots', kind: 'feature', requires: 'onetap', cost: 5_000_000, tip: 'Getötete Bots <b>explodieren</b> und lösen Kettenreaktionen aus!', col: -1, row: 3 },
      { id: 'blastRadius', cheatId: 'rage', name: 'Nuke Blast', kind: 'upgrade', requires: 'explode', cost: 9_000_000, tip: 'Doppelter Explosionsradius & Explosionsschaden.', before: '7m', after: '15m', col: -1, row: 4 },

      { id: 'rapid', cheatId: 'rage', name: 'Hyper Fire', kind: 'upgrade', cost: 2_000_000, tip: 'Feuerrate extrem beschleunigt.', before: '1.0x', after: '1.7x', col: 1, row: 1 },
      { id: 'fireRate', cheatId: 'rage', name: 'Minigun RPM', kind: 'upgrade', requires: 'rapid', cost: 4_500_000, tip: 'Absurde Feuerrate auf jeder Waffe.', before: '1.7x', after: '2.8x', col: 1, row: 2 },
      { id: 'auto', cheatId: 'rage', name: 'Full-Auto All', kind: 'feature', requires: 'fireRate', cost: 7_500_000, tip: '<b>Jede Waffe</b> (auch Sniper & Shotgun) wird vollautomatisch!', col: 1, row: 3 },
    ],
  },
];

export interface BotFarmRigDef {
  id: string;
  name: string;
  desc: string;
  baseCost: number; // cents
  costMult: number;
  centsPerSec: number;
  killsPerMin: number;
  icon: string;
}

export const BOT_FARM_RIGS: BotFarmRigDef[] = [
  { id: 'laptop', name: 'Alter XP-Laptop', desc: 'Ein AFK-Bot mit Aim-Macro in 1v1-Lobbys.', baseCost: 5_000, costMult: 1.25, centsPerSec: 25, killsPerMin: 12, icon: '💻' },
  { id: 'vm', name: 'VM-Cluster (4x)', desc: '4 virtuelle Instanzen farmen rund um die Uhr.', baseCost: 45_000, costMult: 1.28, centsPerSec: 220, killsPerMin: 55, icon: '🖥️' },
  { id: 'ragerig', name: 'Rage-Farm Rack', desc: 'Spinbot-Squads räumen Deathmatch-Server leer.', baseCost: 350_000, costMult: 1.32, centsPerSec: 1_900, killsPerMin: 240, icon: '⚡' },
  { id: 'cloud', name: '0-Day Botnet Cloud', desc: 'Hunderte Headless-Clients weltweit.', baseCost: 2_800_000, costMult: 1.35, centsPerSec: 16_500, killsPerMin: 1200, icon: '🌐' },
  { id: 'quantum', name: 'Quantum HvH Core', desc: 'Spielt 10.000 Matches pro Sekunde in Simulation.', baseCost: 25_000_000, costMult: 1.4, centsPerSec: 165_000, killsPerMin: 9999, icon: '☢️' },
];

export function getCheatDef(id: CheatCategoryId): CheatDef {
  return CHEATS.find((c) => c.id === id) ?? CHEATS[0];
}
