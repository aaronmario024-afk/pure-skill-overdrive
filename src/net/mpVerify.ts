// @ts-ignore - Node built-in used only when bundled via esbuild --platform=node
import http from 'node:http';
// @ts-ignore - runtime ESM server module tested via esbuild node bundle
import { attachMultiplayerServer, normalizeLobbyCode } from '../../server/mpServer.mjs';

export interface MpVerifyResult {
  passed: boolean;
  totalChecks: number;
  passedChecks: number;
  details: string[];
}

class TestWsClient {
  public id = '';
  public inbox: any[] = [];
  private ws: WebSocket;
  private waiters: Array<(msg: any) => boolean> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
  }

  public async waitOpen(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WS open timeout')), 4000);
      this.ws.addEventListener(
        'open',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
      this.ws.addEventListener(
        'error',
        (ev) => {
          clearTimeout(t);
          reject(ev);
        },
        { once: true },
      );
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'welcome') this.id = msg.id;
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        if (this.waiters[i](msg)) {
          this.waiters.splice(i, 1);
          return;
        }
      }
      this.inbox.push(msg);
    });
  }

  public send(obj: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(obj));
  }

  public async waitFor(pred: (msg: any) => boolean, label = 'msg', timeoutMs = 4000): Promise<any> {
    const idx = this.inbox.findIndex(pred);
    if (idx >= 0) {
      return this.inbox.splice(idx, 1)[0];
    }
    return await new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        const wi = this.waiters.indexOf(check);
        if (wi >= 0) this.waiters.splice(wi, 1);
        reject(new Error(`Timeout waiting for ${label}`));
      }, timeoutMs);
      const check = (msg: any) => {
        if (!pred(msg)) return false;
        clearTimeout(t);
        resolve(msg);
        return true;
      };
      this.waiters.push(check);
    });
  }

  public close(): void {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

export async function runMultiplayerVerification(): Promise<MpVerifyResult> {
  const details: string[] = [];
  let totalChecks = 0;
  let passedChecks = 0;

  const check = (name: string, cond: boolean, info = '') => {
    totalChecks++;
    if (cond) {
      passedChecks++;
      details.push(`PASS: ${name}${info ? ` (${info})` : ''}`);
    } else {
      details.push(`FAIL: ${name}${info ? ` (${info})` : ''}`);
    }
  };

  const server = http.createServer((_req: unknown, res: { writeHead: (code: number) => void; end: (body: string) => void }) => {
    res.writeHead(200);
    res.end('ok');
  });
  const mpHandle = attachMultiplayerServer(server, { path: '/ws' });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  const host = new TestWsClient(wsUrl);
  const friend = new TestWsClient(wsUrl);

  try {
    await Promise.all([host.waitOpen(), friend.waitOpen()]);
    host.send({ type: 'hello', playerName: 'HostAlpha', weaponId: 'rifle' });
    friend.send({ type: 'hello', playerName: 'FriendBeta', weaponId: 'm4' });
    const [hw, fw] = await Promise.all([
      host.waitFor((m) => m.type === 'welcome', 'host welcome'),
      friend.waitFor((m) => m.type === 'welcome', 'friend welcome'),
    ]);

    // 1. create_lobby generates OVR-XXXX code & lobby_state
    host.send({ type: 'create_lobby', playerName: 'HostAlpha', weaponId: 'rifle' });
    const lob1 = await host.waitFor((m) => m.type === 'lobby_state' && m.lobby, 'create_lobby');
    const code: string = lob1.lobby.code;
    check(
      'create_lobby generates formatted OVR-XXXX lobby code & assigns host',
      /^OVR-[A-Z0-9]{4}$/.test(code) && lob1.lobby.hostId === hw.id && lob1.lobby.members.length === 1,
      `code=${code}, host=${hw.id}`,
    );

    // 2. join_lobby with lowercase unformatted code (e.g. without OVR- dash)
    const rawSuffix = code.replace('OVR-', '').toLowerCase();
    const normCheck = normalizeLobbyCode(rawSuffix) === code;
    friend.send({ type: 'join_lobby', code: rawSuffix, playerName: 'FriendBeta', weaponId: 'm4' });
    const [hJoin, fJoin] = await Promise.all([
      host.waitFor((m) => m.type === 'lobby_state' && m.lobby?.members?.length === 2, 'host join state'),
      friend.waitFor((m) => m.type === 'lobby_state' && m.lobby?.members?.length === 2, 'friend join state'),
    ]);
    check(
      'join_lobby accepts lowercase unformatted code and syncs roster to both players',
      normCheck && hJoin.lobby.code === code && fJoin.lobby.members.length === 2,
      `raw=${rawSuffix}->${code}, members=${fJoin.lobby.members.map((m: any) => m.name).join(',')}`,
    );

    // 3. query_presence reports live online & inLobby status
    host.send({ type: 'query_presence', names: ['friendbeta', 'GhostUser'] });
    const pres = await host.waitFor((m) => m.type === 'presence_update', 'presence_update');
    const fb = pres.friends?.friendbeta;
    const gh = pres.friends?.GhostUser;
    check(
      'query_presence detects online friend in lobby (case-insensitive) and offline user',
      Boolean(fb?.online && fb?.inLobby && fb?.lobbyCode === code && gh && !gh.online),
      `friend=${JSON.stringify(fb)}`,
    );

    // 4. update_settings & lobby_chat sync cleanly
    host.send({
      type: 'update_settings',
      rules: { matchType: 'duel', mapMode: 'dm', botCount: 2, durationSec: 90, allowCheats: false },
    });
    const fRules = await friend.waitFor(
      (m) => m.type === 'lobby_state' && m.lobby?.rules?.mapMode === 'dm',
      'update_settings',
    );
    friend.send({ type: 'lobby_chat', text: 'Ready for 1v1!' });
    const hChat = await host.waitFor((m) => m.type === 'lobby_chat', 'lobby_chat');
    check(
      'update_settings and lobby_chat synchronize across lobby members',
      fRules.lobby.rules.allowCheats === false &&
        fRules.lobby.rules.botCount === 2 &&
        hChat.from === 'FriendBeta' &&
        hChat.text === 'Ready for 1v1!',
      `map=${fRules.lobby.rules.mapMode}, chat="${hChat.text}"`,
    );

    // 5. start_match launches both clients with distinct spawn indices
    host.send({ type: 'start_match' });
    const [hStart, fStart] = await Promise.all([
      host.waitFor((m) => m.type === 'match_start', 'host match_start'),
      friend.waitFor((m) => m.type === 'match_start', 'friend match_start'),
    ]);
    const hP = hStart.players.find((p: any) => p.id === hw.id);
    const fP = fStart.players.find((p: any) => p.id === fw.id);
    check(
      'start_match launches both clients with distinct spawn indices',
      hStart.code === code && fStart.code === code && hP && fP && hP.spawnIdx !== fP.spawnIdx,
      `hostSpawn=${hP?.spawnIdx}, friendSpawn=${fP?.spawnIdx}`,
    );

    // 6. player_state & player_fire relay cleanly
    host.send({
      type: 'player_state',
      x: 4.5,
      y: 0,
      z: -6.2,
      vx: 1.2,
      vy: 0,
      vz: 0,
      yaw: 1.1,
      pitch: -0.05,
      weaponId: 'rifle',
      skinId: '',
      crouching: false,
      grounded: true,
      spinbot: false,
    });
    host.send({
      type: 'player_fire',
      from: { x: 4.5, y: 1.5, z: -6.2 },
      to: { x: 0, y: 1.5, z: 4 },
      weaponId: 'rifle',
      soundType: 'rifle',
      color: '#fef08a',
      isMelee: false,
    });
    const [fState, fFire] = await Promise.all([
      friend.waitFor((m) => m.type === 'peer_state' && m.id === hw.id, 'peer_state'),
      friend.waitFor((m) => m.type === 'peer_fire' && m.id === hw.id, 'peer_fire'),
    ]);
    check(
      'player_state and player_fire relay accurately between peers',
      Math.abs(fState.x - 4.5) < 0.01 && fFire.weaponId === 'rifle' && fFire.soundType === 'rifle',
      `peerX=${fState.x}, fireWpn=${fFire.weaponId}`,
    );

    // 7. player_hit deducts authoritative HP, triggers player_killed, and schedules player_respawn
    // Wait briefly so 1800ms spawn protection expires
    await new Promise((r) => setTimeout(r, 1900));
    host.send({
      type: 'player_hit',
      targetId: fw.id,
      damage: 40,
      isHead: false,
      weaponId: 'rifle',
      throughWall: false,
      point: { x: 0, y: 1.2, z: 0 },
    });
    const dmg1 = await friend.waitFor((m) => m.type === 'damage_applied' && m.targetId === fw.id, 'dmg1');
    host.send({
      type: 'player_hit',
      targetId: fw.id,
      damage: 75,
      isHead: true,
      weaponId: 'rifle',
      throughWall: false,
      point: { x: 0, y: 1.6, z: 0 },
    });
    const [killedMsg, respawnMsg] = await Promise.all([
      friend.waitFor((m) => m.type === 'player_killed' && m.targetId === fw.id, 'player_killed'),
      friend.waitFor((m) => m.type === 'player_respawn' && m.targetId === fw.id, 'player_respawn', 4500),
    ]);
    check(
      'player_hit applies authoritative HP, emits player_killed with K/D scores, and triggers player_respawn',
      dmg1.hp === 60 &&
        killedMsg.attackerId === hw.id &&
        killedMsg.scores?.[hw.id]?.kills === 1 &&
        killedMsg.scores?.[fw.id]?.deaths === 1 &&
        respawnMsg.hp === 100,
      `dmg1Hp=${dmg1.hp}, kills=${killedMsg.scores?.[hw.id]?.kills}, respawnHp=${respawnMsg.hp}`,
    );

    // 8. bots_state (Host -> Guest) & guest_bot_hit (Guest -> Host) relay cleanly
    host.send({
      type: 'bots_state',
      bots: [
        {
          id: 0,
          name: 'Bot_Albert',
          x: 2,
          y: 0,
          z: -3,
          vx: 0,
          vy: 0,
          vz: 0,
          yaw: 0.4,
          hp: 100,
          maxHp: 100,
          alive: true,
          bounty: 'normal',
          isCheaterBot: false,
          isAdmin: false,
          isDummy: false,
          spinVisual: false,
          onGround: true,
        },
      ],
    });
    friend.send({
      type: 'guest_bot_hit',
      botId: 0,
      damage: 55,
      isHead: true,
      weaponId: 'm4',
      point: { x: 2, y: 1.6, z: -3 },
    });
    const [fBots, hGuestHit] = await Promise.all([
      friend.waitFor((m) => m.type === 'bots_state', 'bots_state'),
      host.waitFor((m) => m.type === 'guest_bot_hit', 'guest_bot_hit'),
    ]);
    check(
      'bots_state and guest_bot_hit relay cleanly between host and guest',
      fBots.bots?.length === 1 && fBots.bots[0].name === 'Bot_Albert' && hGuestHit.botId === 0 && hGuestHit.damage === 55,
      `bot=${fBots.bots?.[0]?.name}, guestHitDmg=${hGuestHit.damage}`,
    );

    // 9. end_match broadcasts ranked scoreboard and returns room to lobby cleanly
    host.send({ type: 'end_match', reason: 'host_ended' });
    const [hEnd, fEnd, fPostLobby] = await Promise.all([
      host.waitFor((m) => m.type === 'match_end', 'host match_end'),
      friend.waitFor((m) => m.type === 'match_end', 'friend match_end'),
      friend.waitFor((m) => m.type === 'lobby_state' && m.lobby && !m.lobby.inMatch, 'post match lobby_state'),
    ]);
    check(
      'end_match broadcasts ranked scoreboard and returns lobby to pre-match state',
      hEnd.rankings?.[0]?.id === hw.id &&
        fEnd.rankings?.length === 2 &&
        fPostLobby.lobby.inMatch === false,
      `winner=${hEnd.rankings?.[0]?.name}, inMatch=${fPostLobby.lobby.inMatch}`,
    );
  } finally {
    host.close();
    friend.close();
    mpHandle.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return {
    passed: passedChecks === totalChecks,
    totalChecks,
    passedChecks,
    details,
  };
}
