import os from 'node:os';
import { createWsServer } from './wsCore.mjs';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VALID_MATCH_TYPES = new Set(['duel', 'ffa', 'coop']);
const VALID_MAP_MODES = new Set(['arena', 'dm', 'defend', 'hvh', 'range']);

export function normalizeLobbyCode(raw) {
  const alnum = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!alnum) return '';
  if (alnum.startsWith('OVR') && alnum.length === 7) {
    return `OVR-${alnum.slice(3)}`;
  }
  if (alnum.length === 4) {
    return `OVR-${alnum}`;
  }
  if (alnum.length >= 6) {
    return `${alnum.slice(0, 3)}-${alnum.slice(3, 7)}`;
  }
  return alnum;
}

export function getLanUrls(port = 5173) {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const info of list) {
      if (info.family === 'IPv4' && !info.internal) {
        urls.push(`http://${info.address}:${port}/`);
      }
    }
  }
  return urls;
}

function sanitizeName(raw, fallback = 'Player') {
  const cleaned = String(raw || '').replace(/[^\w\s.\-äöüÄÖÜß]/g, '').trim().slice(0, 18);
  return cleaned.length >= 2 ? cleaned : fallback;
}

function defaultRules() {
  return {
    matchType: 'duel',
    mapMode: 'arena',
    botCount: 0,
    durationSec: 120,
    allowCheats: true,
    friendlyFire: false,
  };
}

function sanitizeRules(prev, next) {
  const merged = { ...prev, ...(next && typeof next === 'object' ? next : {}) };
  const matchType = VALID_MATCH_TYPES.has(merged.matchType) ? merged.matchType : prev.matchType;
  const mapMode = VALID_MAP_MODES.has(merged.mapMode) ? merged.mapMode : prev.mapMode;
  const botCount = Math.max(0, Math.min(8, Math.round(Number(merged.botCount) || 0)));
  const durationSec = Math.max(30, Math.min(600, Math.round(Number(merged.durationSec) || 120)));
  return {
    matchType,
    mapMode,
    botCount,
    durationSec,
    allowCheats: Boolean(merged.allowCheats),
    friendlyFire: Boolean(merged.friendlyFire),
  };
}

export function attachMultiplayerServer(httpServer, opts = {}) {
  const path = opts.path || '/ws';
  const clients = new Map();
  const lobbies = new Map();
  let nextClientNum = 1;
  let nextChatId = 1;

  const generateCode = () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      let suffix = '';
      for (let i = 0; i < 4; i++) {
        suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      const code = `OVR-${suffix}`;
      if (!lobbies.has(code)) return code;
    }
    return `OVR-${String(Date.now()).slice(-4)}`;
  };

  const serializeLobby = (lobby) => ({
    code: lobby.code,
    hostId: lobby.hostId,
    inMatch: lobby.inMatch,
    rules: { ...lobby.rules },
    members: Array.from(lobby.members.values()).map((m) => ({
      id: m.id,
      name: m.name,
      weaponId: m.weaponId,
      skinId: m.skinId,
      ready: m.ready,
      isHost: m.id === lobby.hostId,
      kills: m.kills,
      deaths: m.deaths,
      headshots: m.headshots,
    })),
    chat: lobby.chat.slice(-20),
  });

  const broadcastLobby = (lobby, msgObj, excludeId = null) => {
    const raw = JSON.stringify(msgObj);
    for (const m of lobby.members.values()) {
      if (excludeId && m.id === excludeId) continue;
      m.ws.send(raw);
    }
  };

  const emitLobbyState = (lobby) => {
    broadcastLobby(lobby, { type: 'lobby_state', lobby: serializeLobby(lobby) });
  };

  const buildMatchPlayers = (lobby) => {
    let idx = 0;
    return Array.from(lobby.members.values()).map((m) => ({
      id: m.id,
      name: m.name,
      weaponId: m.weaponId,
      skinId: m.skinId,
      team: lobby.rules.matchType === 'coop' ? 'human' : m.id,
      spawnIdx: m.spawnIdx ?? idx++,
      hp: m.hp,
      alive: m.alive,
      kills: m.kills,
      deaths: m.deaths,
      headshots: m.headshots,
    }));
  };

  const buildScoreMap = (lobby) => {
    const scores = {};
    for (const m of lobby.members.values()) {
      scores[m.id] = {
        name: m.name,
        kills: m.kills,
        deaths: m.deaths,
        headshots: m.headshots,
      };
    }
    return scores;
  };

  const clearLobbyTimers = (lobby) => {
    if (lobby.timerHandle) {
      clearInterval(lobby.timerHandle);
      lobby.timerHandle = null;
    }
    for (const t of lobby.respawnTimers.values()) {
      clearTimeout(t);
    }
    lobby.respawnTimers.clear();
  };

  const finishMatchForLobby = (lobby, reason = 'timeup') => {
    if (!lobby.inMatch) return;
    clearLobbyTimers(lobby);
    lobby.inMatch = false;

    const rankings = Array.from(lobby.members.values())
      .map((m) => ({
        id: m.id,
        name: m.name,
        kills: m.kills,
        deaths: m.deaths,
        headshots: m.headshots,
        isHost: m.id === lobby.hostId,
      }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

    broadcastLobby(lobby, {
      type: 'match_end',
      reason,
      rankings,
    });
    emitLobbyState(lobby);
  };

  const leaveLobby = (client) => {
    if (!client.lobbyCode) return;
    const lobby = lobbies.get(client.lobbyCode);
    client.lobbyCode = null;
    if (!lobby) return;

    const respTimer = lobby.respawnTimers.get(client.id);
    if (respTimer) {
      clearTimeout(respTimer);
      lobby.respawnTimers.delete(client.id);
    }
    lobby.members.delete(client.id);

    if (lobby.members.size === 0) {
      clearLobbyTimers(lobby);
      lobbies.delete(lobby.code);
      return;
    }

    if (lobby.hostId === client.id) {
      const nextHost = lobby.members.values().next().value;
      if (nextHost) lobby.hostId = nextHost.id;
    }

    broadcastLobby(lobby, {
      type: 'peer_left',
      id: client.id,
      name: client.name,
      newHostId: lobby.hostId,
    });
    emitLobbyState(lobby);
  };

  const wsServer = createWsServer(httpServer, {
    path,
    onConnection: (ws) => {
      const client = {
        id: `p_${nextClientNum++}`,
        ws,
        name: `Player_${1000 + Math.floor(Math.random() * 9000)}`,
        weaponId: 'pistol',
        skinId: '',
        ready: false,
        lobbyCode: null,
        kills: 0,
        deaths: 0,
        headshots: 0,
        hp: 100,
        alive: true,
        spawnIdx: 0,
        spawnProtectUntil: 0,
      };
      clients.set(client.id, client);

      ws.onMessage((raw) => {
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object') return;
        const type = msg.type;

        if (type === 'hello') {
          if (msg.playerName) client.name = sanitizeName(msg.playerName, client.name);
          if (typeof msg.weaponId === 'string' && msg.weaponId) client.weaponId = msg.weaponId;
          if (typeof msg.skinId === 'string') client.skinId = msg.skinId;
          ws.sendJson({ type: 'welcome', id: client.id, serverTime: Date.now() });
          if (client.lobbyCode) {
            const lobby = lobbies.get(client.lobbyCode);
            if (lobby) emitLobbyState(lobby);
          }
          return;
        }

        if (type === 'ping') {
          ws.sendJson({ type: 'pong', t: msg.t ?? 0, serverTime: Date.now() });
          return;
        }

        if (type === 'query_presence') {
          const names = Array.isArray(msg.names) ? msg.names : [];
          const result = {};
          const byLower = new Map();
          for (const c of clients.values()) {
            const key = c.name.toLowerCase();
            if (!byLower.has(key)) byLower.set(key, c);
          }
          for (const n of names) {
            const rawName = String(n || '').trim();
            if (!rawName) continue;
            const match = byLower.get(rawName.toLowerCase());
            if (!match) {
              result[rawName] = {
                online: false,
                inLobby: false,
                inMatch: false,
                lobbyCode: null,
                playerName: rawName,
              };
            } else {
              const lob = match.lobbyCode ? lobbies.get(match.lobbyCode) : null;
              result[rawName] = {
                online: true,
                inLobby: Boolean(lob),
                inMatch: Boolean(lob?.inMatch),
                lobbyCode: lob ? lob.code : null,
                playerName: match.name,
              };
            }
          }
          ws.sendJson({ type: 'presence_update', friends: result });
          return;
        }

        if (type === 'create_lobby') {
          leaveLobby(client);
          if (msg.playerName) client.name = sanitizeName(msg.playerName, client.name);
          if (typeof msg.weaponId === 'string' && msg.weaponId) client.weaponId = msg.weaponId;
          if (typeof msg.skinId === 'string') client.skinId = msg.skinId;
          client.ready = true;
          client.kills = 0;
          client.deaths = 0;
          client.headshots = 0;

          const code = generateCode();
          const rules = sanitizeRules(defaultRules(), msg.rules);
          const lobby = {
            code,
            hostId: client.id,
            inMatch: false,
            matchSeed: 1,
            timeLeft: rules.durationSec,
            rules,
            members: new Map([[client.id, client]]),
            chat: [],
            timerHandle: null,
            respawnTimers: new Map(),
          };
          lobbies.set(code, lobby);
          client.lobbyCode = code;
          emitLobbyState(lobby);
          return;
        }

        if (type === 'join_lobby') {
          const code = normalizeLobbyCode(msg.code);
          const targetLobby = lobbies.get(code);
          if (!targetLobby) {
            ws.sendJson({ type: 'error', message: `Lobby "${code || msg.code}" nicht gefunden.` });
            return;
          }
          if (targetLobby.members.size >= 8 && !targetLobby.members.has(client.id)) {
            ws.sendJson({ type: 'error', message: 'Lobby ist voll (max. 8 Spieler).' });
            return;
          }
          if (client.lobbyCode !== code) {
            leaveLobby(client);
          }
          if (msg.playerName) client.name = sanitizeName(msg.playerName, client.name);
          if (typeof msg.weaponId === 'string' && msg.weaponId) client.weaponId = msg.weaponId;
          if (typeof msg.skinId === 'string') client.skinId = msg.skinId;
          client.ready = true;
          client.kills = 0;
          client.deaths = 0;
          client.headshots = 0;
          client.hp = 100;
          client.alive = true;
          client.spawnIdx = targetLobby.members.size;
          client.spawnProtectUntil = Date.now() + 1800;
          client.lobbyCode = code;
          targetLobby.members.set(client.id, client);

          emitLobbyState(targetLobby);
          if (targetLobby.inMatch) {
            ws.sendJson({
              type: 'match_start',
              code: targetLobby.code,
              hostId: targetLobby.hostId,
              rules: { ...targetLobby.rules },
              matchSeed: targetLobby.matchSeed,
              timeLeft: targetLobby.timeLeft,
              players: buildMatchPlayers(targetLobby),
            });
          }
          return;
        }

        if (type === 'leave_lobby') {
          leaveLobby(client);
          ws.sendJson({ type: 'lobby_state', lobby: null });
          return;
        }

        const lobby = client.lobbyCode ? lobbies.get(client.lobbyCode) : null;
        if (!lobby) return;

        if (type === 'update_profile') {
          if (msg.playerName) client.name = sanitizeName(msg.playerName, client.name);
          if (typeof msg.weaponId === 'string' && msg.weaponId) client.weaponId = msg.weaponId;
          if (typeof msg.skinId === 'string') client.skinId = msg.skinId;
          if (typeof msg.ready === 'boolean') client.ready = msg.ready;
          emitLobbyState(lobby);
          return;
        }

        if (type === 'update_settings') {
          if (lobby.hostId !== client.id) return;
          lobby.rules = sanitizeRules(lobby.rules, msg.rules);
          emitLobbyState(lobby);
          return;
        }

        if (type === 'lobby_chat') {
          const text = String(msg.text || '').trim().slice(0, 180);
          if (!text) return;
          const entry = { id: nextChatId++, from: client.name, text, ts: Date.now() };
          lobby.chat.push(entry);
          if (lobby.chat.length > 30) lobby.chat.shift();
          broadcastLobby(lobby, { type: 'lobby_chat', ...entry });
          return;
        }

        if (type === 'invite_friend') {
          const targetLower = String(msg.targetName || '').trim().toLowerCase();
          if (!targetLower) return;
          for (const other of clients.values()) {
            if (other.id !== client.id && other.name.toLowerCase() === targetLower) {
              other.ws.sendJson({
                type: 'lobby_invite',
                fromName: client.name,
                code: lobby.code,
                matchType: lobby.rules.matchType,
                mapMode: lobby.rules.mapMode,
              });
            }
          }
          return;
        }

        if (type === 'start_match') {
          if (lobby.hostId !== client.id) return;
          clearLobbyTimers(lobby);
          lobby.inMatch = true;
          lobby.matchSeed = Math.floor(Math.random() * 1_000_000);
          lobby.timeLeft = lobby.rules.durationSec;
          const nowMs = Date.now();
          let sIdx = 0;
          for (const m of lobby.members.values()) {
            m.kills = 0;
            m.deaths = 0;
            m.headshots = 0;
            m.hp = 100;
            m.alive = true;
            m.spawnIdx = sIdx++;
            m.spawnProtectUntil = nowMs + 1800;
          }

          broadcastLobby(lobby, {
            type: 'match_start',
            code: lobby.code,
            hostId: lobby.hostId,
            rules: { ...lobby.rules },
            matchSeed: lobby.matchSeed,
            timeLeft: lobby.timeLeft,
            players: buildMatchPlayers(lobby),
          });
          emitLobbyState(lobby);

          lobby.timerHandle = setInterval(() => {
            if (!lobby.inMatch) {
              clearLobbyTimers(lobby);
              return;
            }
            lobby.timeLeft = Math.max(0, lobby.timeLeft - 1);
            broadcastLobby(lobby, { type: 'match_timer', timeLeft: lobby.timeLeft });
            if (lobby.timeLeft <= 0) {
              finishMatchForLobby(lobby, 'timeup');
            }
          }, 1000);
          if (typeof lobby.timerHandle.unref === 'function') lobby.timerHandle.unref();
          return;
        }

        if (type === 'player_state') {
          if (!lobby.inMatch) return;
          broadcastLobby(
            lobby,
            {
              type: 'peer_state',
              id: client.id,
              name: client.name,
              x: Number(msg.x) || 0,
              y: Number(msg.y) || 0,
              z: Number(msg.z) || 0,
              vx: Number(msg.vx) || 0,
              vy: Number(msg.vy) || 0,
              vz: Number(msg.vz) || 0,
              yaw: Number(msg.yaw) || 0,
              pitch: Number(msg.pitch) || 0,
              weaponId: typeof msg.weaponId === 'string' ? msg.weaponId : client.weaponId,
              skinId: typeof msg.skinId === 'string' ? msg.skinId : client.skinId,
              crouching: Boolean(msg.crouching),
              grounded: msg.grounded !== false,
              alive: client.alive,
              hp: client.hp,
              spinbot: Boolean(msg.spinbot),
            },
            client.id,
          );
          return;
        }

        if (type === 'player_fire') {
          if (!lobby.inMatch) return;
          broadcastLobby(
            lobby,
            {
              type: 'peer_fire',
              id: client.id,
              from: msg.from,
              to: msg.to,
              weaponId: String(msg.weaponId || 'pistol'),
              soundType: String(msg.soundType || 'pistol'),
              color: String(msg.color || '#fef08a'),
              isMelee: Boolean(msg.isMelee),
            },
            client.id,
          );
          return;
        }

        if (type === 'player_hit') {
          if (!lobby.inMatch) return;
          const target = lobby.members.get(String(msg.targetId || ''));
          if (!target || target.id === client.id || !target.alive) return;
          if (Date.now() < target.spawnProtectUntil) return;
          if (lobby.rules.matchType === 'coop' && !lobby.rules.friendlyFire) return;

          const dmg = Math.max(1, Math.min(500, Number(msg.damage) || 0));
          target.hp = Math.max(0, target.hp - dmg);
          const isHead = Boolean(msg.isHead);
          const weaponId = String(msg.weaponId || 'pistol');
          const throughWall = Boolean(msg.throughWall);

          broadcastLobby(lobby, {
            type: 'damage_applied',
            attackerId: client.id,
            targetId: target.id,
            damage: dmg,
            hp: target.hp,
            isHead,
            weaponId,
            point: msg.point,
          });

          if (target.hp <= 0) {
            target.alive = false;
            client.kills += 1;
            target.deaths += 1;
            if (isHead) client.headshots += 1;

            broadcastLobby(lobby, {
              type: 'player_killed',
              attackerId: client.id,
              attackerName: client.name,
              targetId: target.id,
              targetName: target.name,
              weaponId,
              isHead,
              throughWall,
              point: msg.point,
              scores: buildScoreMap(lobby),
            });

            const respawnDelayMs = lobby.rules.matchType === 'duel' ? 1300 : 2000;
            const prevT = lobby.respawnTimers.get(target.id);
            if (prevT) clearTimeout(prevT);
            const rt = setTimeout(() => {
              lobby.respawnTimers.delete(target.id);
              if (!lobby.inMatch || !lobby.members.has(target.id)) return;
              target.hp = 100;
              target.alive = true;
              target.spawnIdx = (target.spawnIdx + 1) % 8;
              target.spawnProtectUntil = Date.now() + 1800;
              broadcastLobby(lobby, {
                type: 'player_respawn',
                targetId: target.id,
                spawnIdx: target.spawnIdx,
                hp: 100,
              });
            }, respawnDelayMs);
            if (typeof rt.unref === 'function') rt.unref();
            lobby.respawnTimers.set(target.id, rt);
          }
          return;
        }

        if (type === 'bots_state') {
          if (!lobby.inMatch || lobby.hostId !== client.id) return;
          broadcastLobby(lobby, { type: 'bots_state', bots: msg.bots }, client.id);
          return;
        }

        if (type === 'guest_bot_hit') {
          if (!lobby.inMatch) return;
          const host = lobby.members.get(lobby.hostId);
          if (!host || host.id === client.id) return;
          host.ws.sendJson({
            type: 'guest_bot_hit',
            attackerId: client.id,
            attackerName: client.name,
            botId: Number(msg.botId),
            damage: Math.max(1, Math.min(2000, Number(msg.damage) || 0)),
            isHead: Boolean(msg.isHead),
            weaponId: String(msg.weaponId || 'pistol'),
            point: msg.point,
          });
          return;
        }

        if (type === 'bot_kill_broadcast') {
          if (!lobby.inMatch || lobby.hostId !== client.id) return;
          const killer = lobby.members.get(String(msg.killerId || ''));
          if (killer) {
            killer.kills += 1;
            if (msg.isHead) killer.headshots += 1;
          }
          broadcastLobby(lobby, {
            type: 'bot_kill_event',
            killerId: String(msg.killerId || ''),
            killerName: String(msg.killerName || 'Player'),
            botName: String(msg.botName || 'Bot'),
            weaponId: String(msg.weaponId || 'pistol'),
            isHead: Boolean(msg.isHead),
            scores: buildScoreMap(lobby),
          });
          return;
        }

        if (type === 'match_chat') {
          if (!lobby.inMatch) return;
          const text = String(msg.text || '').trim().slice(0, 180);
          if (!text) return;
          broadcastLobby(lobby, {
            type: 'match_chat',
            fromId: client.id,
            fromName: client.name,
            text,
            dead: !client.alive,
          });
          return;
        }

        if (type === 'end_match') {
          if (lobby.hostId !== client.id) return;
          finishMatchForLobby(lobby, String(msg.reason || 'host_ended'));
        }
      });

      ws.onClose(() => {
        leaveLobby(client);
        clients.delete(client.id);
      });
    },
  });

  return {
    getServerStats() {
      return {
        activeLobbies: lobbies.size,
        connectedPlayers: clients.size,
      };
    },
    close() {
      for (const lobby of lobbies.values()) {
        clearLobbyTimers(lobby);
      }
      lobbies.clear();
      wsServer.close();
      clients.clear();
    },
  };
}
