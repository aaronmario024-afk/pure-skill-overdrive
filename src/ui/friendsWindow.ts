import { sfx } from '../audio/sfx';
import { getMode } from '../data/modes';
import { mp } from '../net/multiplayer';
import { MpLobbyRules, MpMapMode, MpMatchType } from '../net/protocol';
import { store } from '../state/store';

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isLocalHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m172 = /^172\.(\d+)\./.exec(h);
  return Boolean(m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31);
}

function copyToClipboard(text: string, btn?: HTMLElement | null, doneLabel = 'KOPIERT!'): void {
  const prev = btn?.textContent ?? '';
  const markDone = () => {
    if (!btn) return;
    btn.textContent = doneLabel;
    window.setTimeout(() => {
      if (btn.isConnected) btn.textContent = prev;
    }, 1500);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(markDone).catch(() => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        markDone();
      } catch {
        // ignore
      }
    });
  } else {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      markDone();
    } catch {
      // ignore
    }
  }
}

export class FriendsWindowController {
  private host: HTMLDivElement | null = null;
  private unsubs: (() => void)[] = [];
  private presenceTimer = 0;
  private lastInLobbyState: boolean | null = null;
  private draftCode = '';
  private draftFriend = '';
  private draftChat = '';
  private draftName = store.data.playerName;

  public mount(el: HTMLDivElement): void {
    this.dispose();
    this.host = el;
    this.draftName = store.data.playerName;
    this.lastInLobbyState = Boolean(mp.lobby);

    el.innerHTML = `
      <div class="fr-app">
        <div class="fr-topbar">
          <div class="fr-id-group">
            <label for="fr-name-inp">DEIN NAME:</label>
            <input id="fr-name-inp" class="fr-inp" type="text" maxlength="18" value="${escHtml(this.draftName)}" placeholder="Spielername..." />
            <button class="os-btn small" id="fr-name-save">SPEICHERN</button>
          </div>
          <div class="fr-conn-pill" id="fr-conn-pill"></div>
        </div>

        <div id="fr-invites-slot"></div>
        <div class="fr-err hidden" id="fr-err-box"></div>

        <div class="fr-grid">
          <div class="fr-col">
            <div class="fr-section-head"><span>MULTIPLAYER LOBBY</span></div>
            <div id="fr-lobby-panel"></div>
          </div>

          <div class="fr-col">
            <div class="fr-section-head">
              <span>FREUNDE (${store.data.friends.length})</span>
              <button class="os-btn small" id="fr-refresh-pres" title="Online-Status aktualisieren">↻</button>
            </div>
            <div class="fr-add-row">
              <input id="fr-add-friend-inp" class="fr-inp" type="text" maxlength="18" value="${escHtml(this.draftFriend)}" placeholder="Freundesname eingeben..." />
              <button class="os-btn small primary" id="fr-add-friend-btn">+ HINZUFÜGEN</button>
            </div>
            <div class="fr-friends-list" id="fr-friends-list"></div>

            <div class="fr-share-box" id="fr-share-panel"></div>
          </div>
        </div>
      </div>
    `;

    const nameInp = el.querySelector('#fr-name-inp') as HTMLInputElement;
    nameInp.addEventListener('input', () => {
      this.draftName = nameInp.value;
    });
    const saveName = () => {
      store.setPlayerName(nameInp.value);
      this.draftName = store.data.playerName;
      nameInp.value = this.draftName;
      const wId = store.data.equippedPrimary || 'pistol';
      mp.updateProfile(this.draftName, wId, store.data.equippedSkins[wId] ?? '');
      sfx.playUi('buy');
    };
    el.querySelector('#fr-name-save')!.addEventListener('click', saveName);
    nameInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveName();
    });

    const addInp = el.querySelector('#fr-add-friend-inp') as HTMLInputElement;
    addInp.addEventListener('input', () => {
      this.draftFriend = addInp.value;
    });
    const doAddFriend = () => {
      if (store.addFriend(addInp.value)) {
        this.draftFriend = '';
        addInp.value = '';
        sfx.playUi('buy');
        this.renderFriendsList();
        this.requestPresence();
      } else {
        sfx.playUi('deny');
      }
    };
    el.querySelector('#fr-add-friend-btn')!.addEventListener('click', doAddFriend);
    addInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doAddFriend();
    });
    el.querySelector('#fr-refresh-pres')!.addEventListener('click', () => {
      sfx.playUi('click');
      this.requestPresence();
    });

    this.renderConnPill();
    this.renderInvites();
    this.renderError();
    this.renderLobbyShell(true);
    this.renderFriendsList();
    this.renderSharePanel();

    this.unsubs.push(
      mp.on('status', () => {
        this.renderConnPill();
        this.requestPresence();
        mp.fetchServerInfo();
      }),
      mp.on('pong', () => this.renderConnPill()),
      mp.on('lobby_state', () => {
        const nowIn = Boolean(mp.lobby);
        const switched = nowIn !== this.lastInLobbyState;
        this.lastInLobbyState = nowIn;
        if (switched) {
          this.renderLobbyShell(true);
        } else {
          this.patchInLobbyDynamic();
        }
        this.renderError();
        this.renderFriendsList();
      }),
      mp.on('lobby_chat', () => this.renderChatMessages()),
      mp.on('presence_update', () => this.renderFriendsList()),
      mp.on('lobby_invite', () => this.renderInvites()),
      mp.on('server_info', () => this.renderSharePanel()),
      mp.on('error', () => {
        sfx.playUi('deny');
        this.renderError();
      }),
    );

    mp.fetchServerInfo();
    this.requestPresence();
    this.presenceTimer = window.setInterval(() => {
      this.requestPresence();
      mp.fetchServerInfo();
    }, 4000);
  }

  private getShareBaseUrl(): string {
    if (!isLocalHostname(window.location.hostname)) {
      return window.location.origin;
    }
    const pub = mp.serverInfo?.publicUrl;
    if (pub) return pub.replace(/\/+$/, '');
    return mp.serverInfo?.lanUrls?.[0] || window.location.origin;
  }

  private requestPresence(): void {
    const names = store.data.friends.map((f) => f.name);
    if (names.length > 0 && mp.status === 'connected') {
      mp.queryPresence(names);
    }
  }

  private renderConnPill(): void {
    const pill = this.host?.querySelector('#fr-conn-pill');
    if (!pill) return;
    if (mp.status === 'connected') {
      pill.className = 'fr-conn-pill online';
      pill.textContent = `● SERVER ONLINE · ${mp.pingMs > 0 ? `${mp.pingMs}ms` : '...'}`;
    } else if (mp.status === 'connecting') {
      pill.className = 'fr-conn-pill wait';
      pill.textContent = '○ VERBINDE...';
    } else {
      pill.className = 'fr-conn-pill offline';
      pill.textContent = '● OFFLINE (Reconnect...)';
    }
  }

  private renderError(): void {
    const box = this.host?.querySelector('#fr-err-box');
    if (!box) return;
    if (mp.lastError) {
      box.classList.remove('hidden');
      box.textContent = `⚠ ${mp.lastError}`;
    } else {
      box.classList.add('hidden');
      box.textContent = '';
    }
  }

  private renderInvites(): void {
    const slot = this.host?.querySelector('#fr-invites-slot');
    if (!slot) return;
    if (!mp.pendingInvites.length) {
      slot.innerHTML = '';
      return;
    }
    const inv = mp.pendingInvites[0];
    slot.innerHTML = `
      <div class="fr-invite-toast">
        <span>📨 <b>${escHtml(inv.fromName)}</b> lädt dich in Lobby <code>${escHtml(inv.code)}</code> (${inv.matchType.toUpperCase()} · ${escHtml(getMode(inv.mapMode).name)}) ein!</span>
        <div class="fr-inv-btns">
          <button class="os-btn small primary" id="fr-inv-accept">BEITRETEN</button>
          <button class="os-btn small" id="fr-inv-dismiss">✕</button>
        </div>
      </div>
    `;
    slot.querySelector('#fr-inv-accept')?.addEventListener('click', () => {
      sfx.playUi('open');
      mp.joinLobby(inv.code);
    });
    slot.querySelector('#fr-inv-dismiss')?.addEventListener('click', () => {
      sfx.playUi('click');
      mp.dismissInvite(inv.code);
    });
  }

  private renderLobbyShell(forceRebuild = false): void {
    const panel = this.host?.querySelector('#fr-lobby-panel') as HTMLDivElement | null;
    if (!panel) return;

    const lob = mp.lobby;
    if (!lob) {
      if (!forceRebuild && panel.querySelector('#fr-create-btn')) return;
      panel.innerHTML = `
        <div class="fr-no-lobby">
          <button class="os-btn ready-btn" id="fr-create-btn">➕ LOBBY ERSTELLEN</button>
          <div class="fr-or-divider">— ODER MIT LOBBY-CODE BEITRETEN —</div>
          <div class="fr-join-row">
            <input id="fr-join-inp" class="fr-inp code-inp" type="text" maxlength="10" value="${escHtml(this.draftCode)}" placeholder="OVR-XXXX" />
            <button class="os-btn primary" id="fr-join-btn">▶ BEITRETEN</button>
          </div>
          <p class="dim" style="font-size:11px;margin:4px 0 0">
            Erstelle eine Lobby für <b>1v1 Duell</b>, <b>Free-for-All</b> oder <b>Co-op vs Bots</b>. Teile den Code oder Invite-Link mit deinem Freund!
          </p>
        </div>
      `;
      const joinInp = panel.querySelector('#fr-join-inp') as HTMLInputElement;
      joinInp.addEventListener('input', () => {
        this.draftCode = joinInp.value.toUpperCase();
      });
      const doJoin = () => {
        if (!joinInp.value.trim()) {
          sfx.playUi('deny');
          return;
        }
        sfx.playUi('open');
        mp.joinLobby(joinInp.value);
      };
      panel.querySelector('#fr-create-btn')!.addEventListener('click', () => {
        sfx.playUi('open');
        mp.createLobby();
      });
      panel.querySelector('#fr-join-btn')!.addEventListener('click', doJoin);
      joinInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doJoin();
      });
      return;
    }

    // Build stable in-lobby layout ONCE (subsequent updates patch sub-divs to preserve chat input focus)
    panel.innerHTML = `
      <div class="fr-lobby-wrap">
        <div class="fr-code-hero">
          <div>
            <div class="fr-code-lbl">LOBBY CODE</div>
            <div class="fr-code-val" id="fr-code-val">${escHtml(lob.code)}</div>
          </div>
          <div class="fr-code-actions">
            <button class="os-btn small" id="fr-copy-code">📋 CODE</button>
            <button class="os-btn small primary" id="fr-copy-link">🔗 INVITE-LINK</button>
          </div>
        </div>

        <div class="fr-members" id="fr-lobby-members"></div>
        <div class="fr-rules" id="fr-lobby-rules"></div>

        <div class="fr-chat">
          <div class="fr-chat-log" id="fr-chat-log"></div>
          <div class="fr-chat-input-row">
            <input id="fr-chat-inp" class="fr-inp" type="text" maxlength="160" value="${escHtml(this.draftChat)}" placeholder="Nachricht an Lobby..." />
            <button class="os-btn small" id="fr-chat-send">SENDEN</button>
          </div>
        </div>

        <div class="fr-lobby-footer" id="fr-lobby-footer"></div>
      </div>
    `;

    panel.querySelector('#fr-copy-code')!.addEventListener('click', (e) => {
      sfx.playUi('click');
      copyToClipboard(mp.lobby?.code ?? '', e.currentTarget as HTMLElement);
    });
    panel.querySelector('#fr-copy-link')!.addEventListener('click', (e) => {
      sfx.playUi('click');
      const code = mp.lobby?.code ?? '';
      const inviteUrl = `${this.getShareBaseUrl()}/?lobby=${encodeURIComponent(code)}`;
      copyToClipboard(inviteUrl, e.currentTarget as HTMLElement, 'LINK KOPIERT!');
    });

    const chatInp = panel.querySelector('#fr-chat-inp') as HTMLInputElement;
    chatInp.addEventListener('input', () => {
      this.draftChat = chatInp.value;
    });
    const sendChat = () => {
      if (!chatInp.value.trim()) return;
      mp.sendLobbyChat(chatInp.value);
      this.draftChat = '';
      chatInp.value = '';
      sfx.playUi('message');
    };
    panel.querySelector('#fr-chat-send')!.addEventListener('click', sendChat);
    chatInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChat();
    });

    this.patchInLobbyDynamic();
  }

  private patchInLobbyDynamic(): void {
    const panel = this.host?.querySelector('#fr-lobby-panel');
    const lob = mp.lobby;
    if (!panel || !lob) return;

    const codeEl = panel.querySelector('#fr-code-val');
    if (codeEl) codeEl.textContent = lob.code;

    const memBox = panel.querySelector('#fr-lobby-members');
    if (memBox) {
      memBox.innerHTML = `
        <div class="fr-sub-title">SPIELER (${lob.members.length}/8) ${lob.inMatch ? '<span class="fr-live-pill">LIVE IM MATCH</span>' : ''}</div>
        ${lob.members
          .map((m) => {
            const isMe = m.id === mp.clientId;
            const isFriend = store.data.friends.some((f) => f.name.toLowerCase() === m.name.toLowerCase());
            return `<div class="fr-member-row ${isMe ? 'me' : ''}">
              <span>${m.isHost ? '👑 ' : ''}${escHtml(m.name)}${isMe ? ' (Du)' : ''}</span>
              <span class="dim" style="font-size:10px">${escHtml(m.weaponId.toUpperCase())}</span>
              <span class="fr-rdy ${m.ready ? 'ok' : ''}">${m.isHost ? 'HOST' : m.ready ? 'BEREIT' : 'WARTET'}</span>
              ${!isMe && !isFriend ? `<button class="os-btn tiny" data-add-mem="${escHtml(m.name)}">+Freund</button>` : '<span></span>'}
            </div>`;
          })
          .join('')}
      `;
      memBox.querySelectorAll<HTMLButtonElement>('[data-add-mem]').forEach((b) => {
        b.addEventListener('click', () => {
          if (store.addFriend(b.dataset.addMem || '')) {
            sfx.playUi('buy');
            this.patchInLobbyDynamic();
            this.renderFriendsList();
            this.requestPresence();
          }
        });
      });
    }

    const rulesBox = panel.querySelector('#fr-lobby-rules');
    const isHost = mp.isHost();
    if (rulesBox) {
      const r = lob.rules;
      const dis = isHost ? '' : 'disabled';
      rulesBox.innerHTML = `
        <div class="fr-rules-grid">
          <label>Modus:
            <select id="fr-r-type" ${dis}>
              <option value="duel" ${r.matchType === 'duel' ? 'selected' : ''}>1v1 / PvP Duell</option>
              <option value="ffa" ${r.matchType === 'ffa' ? 'selected' : ''}>Free-for-All</option>
              <option value="coop" ${r.matchType === 'coop' ? 'selected' : ''}>Co-op vs Bots</option>
            </select>
          </label>
          <label>Map:
            <select id="fr-r-map" ${dis}>
              <option value="arena" ${r.mapMode === 'arena' ? 'selected' : ''}>Dockyard (1v1)</option>
              <option value="dm" ${r.mapMode === 'dm' ? 'selected' : ''}>Ice Foundry</option>
              <option value="defend" ${r.mapMode === 'defend' ? 'selected' : ''}>Sandkeep</option>
              <option value="hvh" ${r.mapMode === 'hvh' ? 'selected' : ''}>Cybergrid Neon</option>
              <option value="range" ${r.mapMode === 'range' ? 'selected' : ''}>Aim Range</option>
            </select>
          </label>
          <label>Bots:
            <select id="fr-r-bots" ${dis}>
              ${[0, 2, 4, 6].map((n) => `<option value="${n}" ${r.botCount === n ? 'selected' : ''}>${n === 0 ? '0 (Nur Spieler)' : `${n} Bots`}</option>`).join('')}
            </select>
          </label>
          <label>Dauer:
            <select id="fr-r-dur" ${dis}>
              ${[60, 120, 180, 300].map((s) => `<option value="${s}" ${r.durationSec === s ? 'selected' : ''}>${s / 60} Min (${s}s)</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="fr-rule-toggles">
          <button class="os-btn small ${r.allowCheats ? 'primary' : ''}" id="fr-r-cheats" ${dis}>Cheats: ${r.allowCheats ? 'AN' : 'AUS (Fair)'}</button>
          ${r.matchType === 'coop' ? `<button class="os-btn small ${r.friendlyFire ? 'primary' : ''}" id="fr-r-ff" ${dis}>Friendly Fire: ${r.friendlyFire ? 'AN' : 'AUS'}</button>` : ''}
        </div>
      `;

      if (isHost) {
        const pushRules = (patch: Partial<MpLobbyRules>) => {
          sfx.playUi('click');
          mp.updateSettings(patch);
        };
        rulesBox.querySelector('#fr-r-type')?.addEventListener('change', (e) => {
          const mt = (e.target as HTMLSelectElement).value as MpMatchType;
          const nextBots = mt === 'duel' ? 0 : mt === 'coop' && r.botCount === 0 ? 4 : r.botCount;
          pushRules({ matchType: mt, botCount: nextBots });
        });
        rulesBox.querySelector('#fr-r-map')?.addEventListener('change', (e) => {
          pushRules({ mapMode: (e.target as HTMLSelectElement).value as MpMapMode });
        });
        rulesBox.querySelector('#fr-r-bots')?.addEventListener('change', (e) => {
          pushRules({ botCount: Number((e.target as HTMLSelectElement).value) });
        });
        rulesBox.querySelector('#fr-r-dur')?.addEventListener('change', (e) => {
          pushRules({ durationSec: Number((e.target as HTMLSelectElement).value) });
        });
        rulesBox.querySelector('#fr-r-cheats')?.addEventListener('click', () => {
          pushRules({ allowCheats: !r.allowCheats });
        });
        rulesBox.querySelector('#fr-r-ff')?.addEventListener('click', () => {
          pushRules({ friendlyFire: !r.friendlyFire });
        });
      }
    }

    this.renderChatMessages();

    const footer = panel.querySelector('#fr-lobby-footer');
    if (footer) {
      const me = lob.members.find((m) => m.id === mp.clientId);
      const readyNow = me?.ready ?? true;
      footer.innerHTML = isHost
        ? `<button class="os-btn ready-btn" id="fr-start-match">🚀 MATCH STARTEN</button>
           <button class="os-btn" id="fr-leave-lobby">VERLASSEN</button>`
        : `<button class="os-btn ${readyNow ? 'primary' : ''}" id="fr-toggle-ready">${readyNow ? '✓ BEREIT' : 'NICHT BEREIT'}</button>
           <button class="os-btn" id="fr-leave-lobby">VERLASSEN</button>`;

      footer.querySelector('#fr-start-match')?.addEventListener('click', () => {
        sfx.playUi('open');
        mp.startMatch();
      });
      footer.querySelector('#fr-toggle-ready')?.addEventListener('click', () => {
        sfx.playUi('click');
        mp.setReady(!readyNow);
      });
      footer.querySelector('#fr-leave-lobby')!.addEventListener('click', () => {
        sfx.playUi('click');
        mp.leaveLobby();
      });
    }
  }

  private renderChatMessages(): void {
    const log = this.host?.querySelector('#fr-chat-log') as HTMLDivElement | null;
    if (!log) return;
    if (!mp.lobbyChat.length) {
      log.innerHTML = '<div class="dim" style="font-size:10px">[Lobby-Chat bereit]</div>';
      return;
    }
    log.innerHTML = mp.lobbyChat
      .map((m) => `<div><strong style="color:#38bdf8">${escHtml(m.from)}:</strong> ${escHtml(m.text)}</div>`)
      .join('');
    log.scrollTop = log.scrollHeight;
  }

  private renderFriendsList(): void {
    const list = this.host?.querySelector('#fr-friends-list');
    if (!list) return;
    const headCount = this.host?.querySelector('.fr-col:nth-child(2) .fr-section-head span');
    if (headCount) headCount.textContent = `FREUNDE (${store.data.friends.length})`;

    if (!store.data.friends.length) {
      list.innerHTML = `<div class="dim" style="font-size:11px;padding:8px">Noch keine Freunde gespeichert. Füge oben den Spielernamen deines Freundes hinzu!</div>`;
      return;
    }

    list.innerHTML = store.data.friends
      .map((f) => {
        const p = mp.presence[f.name];
        const statusCls = p?.inMatch ? 'match' : p?.inLobby ? 'lobby' : p?.online ? 'online' : 'off';
        const statusLabel = p?.inMatch
          ? `IM MATCH${p.lobbyCode ? ` (${escHtml(p.lobbyCode)})` : ''}`
          : p?.inLobby && p.lobbyCode
            ? `LOBBY ${escHtml(p.lobbyCode)}`
            : p?.online
              ? 'ONLINE'
              : 'OFFLINE';
        const canJoin = Boolean(p?.inLobby && p.lobbyCode && p.lobbyCode !== mp.lobby?.code);
        const canInvite = Boolean(mp.lobby);

        return `
          <div class="fr-friend-row">
            <div class="fr-friend-info">
              <span class="fr-dot ${statusCls}"></span>
              <div>
                <strong>${escHtml(f.name)}</strong>
                <small class="fr-st-txt ${statusCls}">${statusLabel}</small>
              </div>
            </div>
            <div class="fr-friend-acts">
              ${canJoin ? `<button class="os-btn tiny primary" data-fjoin="${escHtml(p.lobbyCode!)}">JOIN</button>` : ''}
              ${canInvite ? `<button class="os-btn tiny" data-finv="${escHtml(f.name)}" title="Einladen & Link kopieren">INVITE</button>` : ''}
              <button class="os-btn tiny" data-fdel="${escHtml(f.name)}" title="Entfernen">✕</button>
            </div>
          </div>
        `;
      })
      .join('');

    list.querySelectorAll<HTMLButtonElement>('[data-fjoin]').forEach((b) => {
      b.addEventListener('click', () => {
        sfx.playUi('open');
        mp.joinLobby(b.dataset.fjoin || '');
      });
    });
    list.querySelectorAll<HTMLButtonElement>('[data-finv]').forEach((b) => {
      b.addEventListener('click', () => {
        const name = b.dataset.finv || '';
        mp.inviteFriend(name);
        if (mp.lobby?.code) {
          copyToClipboard(`${this.getShareBaseUrl()}/?lobby=${encodeURIComponent(mp.lobby.code)}`, b, 'SENT!');
        }
        sfx.playUi('message');
      });
    });
    list.querySelectorAll<HTMLButtonElement>('[data-fdel]').forEach((b) => {
      b.addEventListener('click', () => {
        store.removeFriend(b.dataset.fdel || '');
        sfx.playUi('click');
        this.renderFriendsList();
      });
    });
  }

  private renderSharePanel(): void {
    const panel = this.host?.querySelector('#fr-share-panel');
    if (!panel) return;
    const info = mp.serverInfo;
    const isLiveInternet = !isLocalHostname(window.location.hostname) || Boolean(info?.isPublicHosted);

    if (isLiveInternet) {
      const baseOrigin = !isLocalHostname(window.location.hostname)
        ? window.location.origin
        : (info?.publicUrl || window.location.origin).replace(/\/+$/, '');
      const liveUrl = mp.lobby?.code
        ? `${baseOrigin}/?lobby=${encodeURIComponent(mp.lobby.code)}`
        : baseOrigin;

      panel.innerHTML = `
        <div class="fr-share-title">🌐 ONLINE IM INTERNET — FREUNDE EINLADEN</div>
        <div class="fr-share-row live">
          <span>${mp.lobby?.code ? 'Lobby-Link (Freunde):' : 'Spiel-URL:'}</span>
          <code>${escHtml(liveUrl)}</code>
          <button class="os-btn tiny primary" id="fr-copy-pub">COPY</button>
        </div>
        <div class="dim" style="font-size:10px;line-height:1.35">
          Schicke diesen Link an deine Freunde — sie können direkt im Browser beitreten!
        </div>
      `;
      panel.querySelector('#fr-copy-pub')?.addEventListener('click', (e) => {
        sfx.playUi('click');
        copyToClipboard(liveUrl, e.currentTarget as HTMLElement, 'LINK KOPIERT!');
      });
      return;
    }

    const publicUrl = info?.publicUrl || null;
    const lanUrl = info?.lanUrls?.[0] || window.location.origin;
    const port = info?.port || 5173;
    const tunnelCmd = `ssh -R 80:localhost:${port} nokey@localhost.run`;
    const fullFriendUrl = publicUrl && mp.lobby?.code
      ? `${publicUrl.replace(/\/+$/, '')}/?lobby=${encodeURIComponent(mp.lobby.code)}`
      : publicUrl;

    panel.innerHTML = `
      <div class="fr-share-title">🌐 KOSTENLOS ZUSAMMEN SPIELEN</div>
      ${fullFriendUrl ? `
        <div class="fr-share-row live">
          <span>Internet-Link (Freunde):</span>
          <code>${escHtml(fullFriendUrl)}</code>
          <button class="os-btn tiny primary" id="fr-copy-pub">COPY</button>
        </div>
      ` : ''}
      <div class="fr-share-row">
        <span>WLAN / LAN:</span>
        <code>${escHtml(lanUrl)}</code>
        <button class="os-btn tiny" id="fr-copy-lan">COPY</button>
      </div>
      ${!fullFriendUrl ? `
        <div class="fr-share-row">
          <span>Gratis Tunnel:</span>
          <code>${escHtml(tunnelCmd)}</code>
          <button class="os-btn tiny" id="fr-copy-tun">COPY</button>
        </div>
        <div class="dim" style="font-size:10px;line-height:1.35">
          Starte <b>Start-PureSkill-Multiplayer.bat</b> — der öffentliche Internet-Link erscheint dann direkt hier & wird automatisch in deine Zwischenablage kopiert!
        </div>
      ` : `
        <div class="dim" style="font-size:10px;line-height:1.35">
          Internet-Tunnel aktiv! Klicke <b>COPY</b> oder <b>INVITE-LINK</b> oben — auch als <code>FRIEND-LINK.txt</code> gespeichert.
        </div>
      `}
    `;

    panel.querySelector('#fr-copy-pub')?.addEventListener('click', (e) => {
      if (!fullFriendUrl) return;
      sfx.playUi('click');
      copyToClipboard(fullFriendUrl, e.currentTarget as HTMLElement);
    });
    panel.querySelector('#fr-copy-lan')?.addEventListener('click', (e) => {
      sfx.playUi('click');
      copyToClipboard(lanUrl, e.currentTarget as HTMLElement);
    });
    panel.querySelector('#fr-copy-tun')?.addEventListener('click', (e) => {
      sfx.playUi('click');
      copyToClipboard(tunnelCmd, e.currentTarget as HTMLElement);
    });
  }

  public dispose(): void {
    window.clearInterval(this.presenceTimer);
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.host = null;
  }
}
