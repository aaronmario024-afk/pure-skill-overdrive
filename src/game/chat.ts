export type ChatTier = 'calm' | 'impressed' | 'sus' | 'accuse' | 'rage';

export interface ChatMessage {
  who: string;
  text: string;
  dead: boolean;
  system?: boolean;
  admin?: boolean;
  time: number;
}

const VICTIM_LINES: Record<ChatTier, string[]> = {
  calm: ['ns', 'nice shot', 'ugh', 'my bad', 'ich war am nachladen :(', 'lag', 'fair', 'woher kam das'],
  impressed: ['ok du bist stark', 'schon wieder?? lol', 'bro ist cracked', 'smurf?', 'wie schnell bist du bitte'],
  sus: ['??', 'bro was', 'wie hast du mich gesehen', 'das war sus', 'ok das war komisch', 'hmm'],
  accuse: ['AIMBOT', 'du hackst doch', 'reported', 'bro mach aus', 'das ist nicht legit', 'so offensichtlich lol', 'nice cheats'],
  rage: ['DEIN ERNST?!', 'ich nehme das auf', 'viel spaß mit dem ban', 'deinstalliere', 'WALLHACK + AIMBOT', 'ALLE REPORTEN!!'],
};

const BYSTANDER_LINES: Record<ChatTier, string[]> = {
  calm: ['gg', 'nice', 'wp', 'lol'],
  impressed: ['wer ist der typ', 'let him cook', 'er farmt uns komplett'],
  sus: ['spectatet ihn jemand?', 'bisschen sus ngl', 'der flick alter', 'entweder pro oder cheater'],
  accuse: ['er cheatet 100%', 'reportet ihn', 'hab spectatet, er lockt durch wände', 'ADMIN??'],
  rage: ['ALLE REPORTEN', 'VOTE KICK PLS', 'anticheat schläft??', 'ADMIN WACH AUF!!', 'ich leave, gl mit dem hacker'],
};

const REASON_LINES: Record<string, string[]> = {
  wallbang: ['DURCH DIE WAND??', 'ich war hinter deckung!', 'wallbang jedes mal? klar'],
  backtrack: ['ICH WAR SCHON UM DIE ECKE?!', 'was für ein backtrack lag!!', 'du hast meinen geist erschossen??'],
  blink: ['DER TELEPORTIERT SICH?!', 'woher kam der teleport', 'speedhack + blink lol'],
  spin: ['warum dreht er sich wie ein beyblade', 'SPINBOT IN MEINER LOBBY', 'ich treff ihn einfach nicht'],
  volley: ['HALBE LOBBY GLEICHZEITIG TOT??', 'wie hast du uns alle mit 1 schuss gekillt'],
  explode: ['WARUM EXPLODIEREN WIR?!', 'was für ein rage hack ist das bitte'],
  headshot: ['immer nur kopf huh', '100% headshots. komplett legit'],
  speed: ['warum rennst du so schnell', 'bunnyhop script lol', 'niemand bewegt sich so schnell'],
};

const SMALL_TALK = [
  ['laggt es bei euch auch?', 'ja mein ping ist 200', 'server steht im keller lol'],
  ['schon wieder diese map', 'beste map tbh', 'vote change nächste runde'],
  ['gl hf', 'glhf', 'hf'],
  ['erstes game heute, chillt mal', 'nö', 'skill issue'],
  ['noch ein game dann schlafen', 'sicher doch', 'berühmte letzte worte'],
];

export class MatchChatEngine {
  public messages: ChatMessage[] = [];
  private queue: { at: number; msg: Omit<ChatMessage, 'time'> }[] = [];
  private lastAmbient = 3;
  private lastPost = 0;

  public reset(): void {
    this.messages = [];
    this.queue = [];
    this.lastAmbient = 3 + Math.random() * 4;
    this.lastPost = 0;
  }

  public tierFor(heat: number): ChatTier {
    if (heat >= 80) return 'rage';
    if (heat >= 55) return 'accuse';
    if (heat >= 32) return 'sus';
    if (heat >= 14) return 'impressed';
    return 'calm';
  }

  public postSystem(text: string, admin = false): void {
    this.messages.push({ who: admin ? '[ADMIN]' : '[SERVER]', text, dead: false, system: true, admin, time: performance.now() });
    if (this.messages.length > 7) this.messages.shift();
  }

  public onPlayerKill(
    nowSec: number,
    victim: string,
    otherBot: string | null,
    heat: number,
    reason: string | null,
    kills: number,
    headshots: number,
  ): void {
    if (nowSec - this.lastPost < 2.2) return;
    const tier = this.tierFor(heat);
    const chance = tier === 'calm' ? 0.35 : tier === 'impressed' ? 0.5 : 0.72;
    if (Math.random() > chance) return;

    this.lastPost = nowSec;
    let line: string;
    if (reason && REASON_LINES[reason] && Math.random() < 0.7) {
      const pool = REASON_LINES[reason];
      line = pool[Math.floor(Math.random() * pool.length)];
    } else if (kills >= 5 && headshots / Math.max(1, kills) > 0.75 && Math.random() < 0.35) {
      line = `${headshots}/${kills} headshots bro. komplett legit`;
    } else {
      const pool = VICTIM_LINES[tier];
      line = pool[Math.floor(Math.random() * pool.length)];
    }
    this.queue.push({ at: nowSec + 0.6 + Math.random() * 0.6, msg: { who: victim, text: line, dead: true } });

    if (otherBot && (tier === 'sus' || tier === 'accuse' || tier === 'rage') && Math.random() < 0.55) {
      const bPool = BYSTANDER_LINES[tier];
      const bLine = bPool[Math.floor(Math.random() * bPool.length)];
      this.queue.push({ at: nowSec + 1.8 + Math.random() * 1.1, msg: { who: otherBot, text: bLine, dead: false } });
    }
  }

  public onPlayerDied(nowSec: number, killer: string, heat: number): void {
    const lines = heat >= 50
      ? ['wo ist dein aimbot jetzt??', 'ENDLICH', 'hab den hacker!', 'cheats am laggen?']
      : ['ez', 'gotcha', 'sit down', '1 tap', 'nt'];
    this.queue.push({
      at: nowSec + 0.5,
      msg: { who: killer, text: lines[Math.floor(Math.random() * lines.length)], dead: false },
    });
  }

  public tick(nowSec: number, botNames: string[]): boolean {
    let changed = false;
    while (this.queue.length > 0 && this.queue[0].at <= nowSec) {
      const item = this.queue.shift()!;
      this.messages.push({ ...item.msg, time: performance.now() });
      if (this.messages.length > 7) this.messages.shift();
      changed = true;
    }

    if (botNames.length >= 2 && nowSec >= this.lastAmbient) {
      this.lastAmbient = nowSec + 11 + Math.random() * 9;
      const thread = SMALL_TALK[Math.floor(Math.random() * SMALL_TALK.length)];
      thread.forEach((line, idx) => {
        const who = botNames[Math.floor(Math.random() * botNames.length)];
        this.queue.push({ at: nowSec + idx * 1.9, msg: { who, text: line, dead: false } });
      });
    }
    return changed;
  }
}
