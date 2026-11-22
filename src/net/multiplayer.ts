import {
  MpBotKillEvent,
  MpBotSnapshot,
  MpChatItem,
  MpDamageApplied,
  MpGuestBotHit,
  MpInfoResponse,
  MpInviteNotice,
  MpLobbyRules,
  MpLobbyState,
  MpMatchEndPayload,
  MpMatchStartPayload,
  MpPeerFire,
  MpPeerState,
  MpPlayerKilled,
  MpPlayerRespawn,
  MpPresenceEntry,
  MpVec3,
} from './protocol';

export type MpConnStatus = 'disconnected' | 'connecting' | 'connected';

type ListenerFn = (payload: any) => void;

export class MultiplayerClient {
  public status: MpConnStatus = 'disconnected';
  public clientId: string | null = null;
  public pingMs = 0;
  public lobby: MpLobbyState | null = null;
  public lobbyChat: MpChatItem[] = [];
  public presence: Record<string, MpPresenceEntry> = {};
  public pendingInvites: MpInviteNotice[] = [];
  public lastError: string | null = null;
  public pendingJoinCode: string | null = null;
  public activeMatch: MpMatchStartPayload | null = null;
  public serverInfo: MpInfoResponse | null = null;

  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<ListenerFn>>();
  private shouldConnect = false;
  private reconnectDelay = 1500;
  private reconnectTimer = 0;
  private pingTimer = 0;
  private pingSentAt = 0;
  private profile = {
    playerName: 'Player',
    weaponId: 'pistol',
    skinId: '',
  };

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const lobbyParam = params.get('lobby');
        if (lobbyParam && lobbyParam.trim().length >= 4) {
          this.pendingJoinCode = lobbyParam.trim().toUpperCase();
        }
      } catch {
        // ignore URL parse error
      }
    }
  }

  public on<T = unknown>(event: string, fn: (payload: T) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as ListenerFn);
    return () => {
      set?.delete(fn as ListenerFn);
    };
  }

  private emit(event: string, payload: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch {
        // ignore listener failure
      }
    }
  }

  public isHost(): boolean {
    return Boolean(this.lobby && this.clientId && this.lobby.hostId === this.clientId);
  }

  public consumePendingJoinCode(): string | null {
    const code = this.pendingJoinCode;
    this.pendingJoinCode = null;
    if (code && typeof window !== 'undefined' && typeof window.history?.replaceState === 'function') {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('lobby');
        window.history.replaceState({}, '', url.toString());
      } catch {
        // ignore
      }
    }
    return code;
  }

  public connect(playerName: string, weaponId = 'pistol', skinId = ''): void {
    this.profile = {
      playerName: playerName.trim() || 'Player',
      weaponId: weaponId || 'pistol',
      skinId: skinId || '',
    };
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    this.shouldConnect = true;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendRaw({ type: 'hello', ...this.profile });
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;

    this.openSocket();
  }

  private openSocket(): void {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    window.clearTimeout(this.reconnectTimer);
    this.status = 'connecting';
    this.emit('status', this.status);

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    let sock: WebSocket;
    try {
      sock = new WebSocket(wsUrl);
    } catch {
      this.status = 'disconnected';
      this.emit('status', this.status);
      this.scheduleReconnect();
      return;
    }
    this.ws = sock;

    sock.addEventListener('open', () => {
      if (this.ws !== sock) return;
      this.reconnectDelay = 1500;
      this.status = 'connected';
      this.lastError = null;
      this.sendRaw({ type: 'hello', ...this.profile });
      this.startPingLoop();
      this.emit('status', this.status);
    });

    sock.addEventListener('message', (ev) => {
      if (this.ws !== sock || typeof ev.data !== 'string') return;
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      this.handleMessage(msg);
    });

    sock.addEventListener('close', () => {
      if (this.ws !== sock) return;
      this.ws = null;
      window.clearInterval(this.pingTimer);
      this.status = 'disconnected';
      this.emit('status', this.status);
      if (this.shouldConnect) {
        this.scheduleReconnect();
      }
    });

    sock.addEventListener('error', () => {
      // handled cleanly by close listener
    });
  }

  private scheduleReconnect(): void {
    window.clearTimeout(this.reconnectTimer);
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(5000, Math.round(this.reconnectDelay * 1.5));
    this.reconnectTimer = window.setTimeout(() => {
      if (this.shouldConnect && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
        this.openSocket();
      }
    }, delay);
  }

  private startPingLoop(): void {
    window.clearInterval(this.pingTimer);
    this.pingSentAt = performance.now();
    this.sendRaw({ type: 'ping', t: this.pingSentAt });
    this.pingTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.pingSentAt = performance.now();
        this.sendRaw({ type: 'ping', t: this.pingSentAt });
      }
    }, 5000);
  }

  private handleMessage(msg: any): void {
    const type = String(msg.type || '');
    if (type === 'welcome') {
      this.clientId = String(msg.id || '');
      if (this.lobby?.code) {
        this.sendRaw({ type: 'join_lobby', code: this.lobby.code, ...this.profile });
      }
      this.emit('welcome', msg);
      return;
    }

    if (type === 'pong') {
      this.pingMs = Math.max(1, Math.round(performance.now() - Number(msg.t || this.pingSentAt)));
      this.emit('pong', this.pingMs);
      return;
    }

    if (type === 'error') {
      this.lastError = String(msg.message || 'Serverfehler');
      this.emit('error', this.lastError);
      return;
    }

    if (type === 'lobby_state') {
      this.lobby = (msg.lobby as MpLobbyState | null) ?? null;
      if (this.lobby) {
        this.lobbyChat = [...(this.lobby.chat ?? [])];
        this.lastError = null;
      } else {
        this.lobbyChat = [];
        this.activeMatch = null;
      }
      this.emit('lobby_state', this.lobby);
      return;
    }

    if (type === 'lobby_chat') {
      const item: MpChatItem = {
        id: Number(msg.id || Date.now()),
        from: String(msg.from || 'Player'),
        text: String(msg.text || ''),
        ts: Number(msg.ts || Date.now()),
      };
      this.lobbyChat.push(item);
      if (this.lobbyChat.length > 30) this.lobbyChat.shift();
      this.emit('lobby_chat', item);
      return;
    }

    if (type === 'presence_update') {
      this.presence = { ...(msg.friends ?? {}) };
      this.emit('presence_update', this.presence);
      return;
    }

    if (type === 'lobby_invite') {
      const inv: MpInviteNotice = {
        fromName: String(msg.fromName || 'Friend'),
        code: String(msg.code || ''),
        matchType: msg.matchType || 'duel',
        mapMode: msg.mapMode || 'arena',
      };
      if (inv.code) {
        this.pendingInvites = [
          inv,
          ...this.pendingInvites.filter((p) => p.code !== inv.code || p.fromName !== inv.fromName),
        ].slice(0, 4);
        this.emit('lobby_invite', inv);
      }
      return;
    }

    if (type === 'match_start') {
      const payload = msg as MpMatchStartPayload;
      this.activeMatch = payload;
      this.emit('match_start', payload);
      return;
    }

    if (type === 'match_end') {
      const payload = msg as MpMatchEndPayload;
      this.activeMatch = null;
      this.emit('match_end', payload);
      return;
    }

    this.emit(type, msg);
  }

  public dismissInvite(code: string): void {
    this.pendingInvites = this.pendingInvites.filter((i) => i.code !== code);
    this.emit('lobby_invite', null);
  }

  public disconnect(): void {
    this.shouldConnect = false;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.pingTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.status = 'disconnected';
    this.lobby = null;
    this.lobbyChat = [];
    this.activeMatch = null;
    this.emit('status', this.status);
  }

  private sendRaw(obj: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  public createLobby(rules?: Partial<MpLobbyRules>): void {
    this.lastError = null;
    this.sendRaw({ type: 'create_lobby', ...this.profile, rules });
  }

  public joinLobby(code: string): void {
    this.lastError = null;
    this.dismissInvite(code);
    this.sendRaw({ type: 'join_lobby', code: code.trim(), ...this.profile });
  }

  public leaveLobby(): void {
    this.lastError = null;
    this.sendRaw({ type: 'leave_lobby' });
    this.lobby = null;
    this.lobbyChat = [];
    this.activeMatch = null;
    this.emit('lobby_state', null);
  }

  public setReady(ready: boolean): void {
    this.sendRaw({ type: 'update_profile', ready });
  }

  public updateProfile(name: string, weaponId: string, skinId = ''): void {
    this.profile = {
      playerName: name.trim() || this.profile.playerName,
      weaponId: weaponId || this.profile.weaponId,
      skinId: skinId || '',
    };
    this.sendRaw({ type: 'hello', ...this.profile });
    if (this.lobby) {
      this.sendRaw({ type: 'update_profile', ...this.profile });
    }
  }

  public updateSettings(rules: Partial<MpLobbyRules>): void {
    this.sendRaw({ type: 'update_settings', rules });
  }

  public sendLobbyChat(text: string): void {
    const clean = text.trim();
    if (!clean) return;
    this.sendRaw({ type: 'lobby_chat', text: clean });
  }

  public inviteFriend(name: string): void {
    const clean = name.trim();
    if (!clean) return;
    this.sendRaw({ type: 'invite_friend', targetName: clean });
  }

  public queryPresence(names: string[]): void {
    if (!names.length) return;
    this.sendRaw({ type: 'query_presence', names });
  }

  public startMatch(): void {
    this.lastError = null;
    this.sendRaw({ type: 'start_match' });
  }

  public endMatch(reason = 'host_ended'): void {
    this.sendRaw({ type: 'end_match', reason });
  }

  public sendPlayerState(state: Omit<MpPeerState, 'id' | 'name' | 'alive' | 'hp'>): void {
    this.sendRaw({ type: 'player_state', ...state });
  }

  public sendPlayerFire(fire: Omit<MpPeerFire, 'id'>): void {
    this.sendRaw({ type: 'player_fire', ...fire });
  }

  public sendPlayerHit(hit: {
    targetId: string;
    damage: number;
    isHead: boolean;
    weaponId: string;
    throughWall: boolean;
    point?: MpVec3;
  }): void {
    this.sendRaw({ type: 'player_hit', ...hit });
  }

  public sendBotsState(bots: MpBotSnapshot[]): void {
    this.sendRaw({ type: 'bots_state', bots });
  }

  public sendGuestBotHit(hit: Omit<MpGuestBotHit, 'attackerId' | 'attackerName'>): void {
    this.sendRaw({ type: 'guest_bot_hit', ...hit });
  }

  public sendBotKill(data: {
    killerId: string;
    killerName: string;
    botName: string;
    weaponId: string;
    isHead: boolean;
  }): void {
    this.sendRaw({ type: 'bot_kill_broadcast', ...data });
  }

  public sendMatchChat(text: string): void {
    const clean = text.trim();
    if (!clean) return;
    this.sendRaw({ type: 'match_chat', text: clean });
  }

  public async fetchServerInfo(): Promise<MpInfoResponse | null> {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
    try {
      const res = await fetch('/api/mp-info');
      if (!res.ok) return null;
      const data = (await res.json()) as MpInfoResponse;
      this.serverInfo = data;
      this.emit('server_info', data);
      return data;
    } catch {
      return null;
    }
  }
}

export const mp = new MultiplayerClient();

export type {
  MpBotKillEvent,
  MpBotSnapshot,
  MpDamageApplied,
  MpGuestBotHit,
  MpMatchEndPayload,
  MpMatchStartPayload,
  MpPeerFire,
  MpPeerState,
  MpPlayerKilled,
  MpPlayerRespawn,
};
