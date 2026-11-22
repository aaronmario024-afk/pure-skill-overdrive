import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] || process.env.PORT || 5173);
const linkFilePath = path.resolve(process.argv[3] || path.join(process.cwd(), '..', 'FRIEND-LINK.txt'));

let currentPublicUrl = null;
let sshProc = null;
let shuttingDown = false;
let reconnectTimer = null;

function copyClipboard(text) {
  if (!text) return false;
  try {
    const res = spawnSync('clip', [], { input: text, encoding: 'utf8', windowsHide: true });
    if (res.status === 0) return true;
  } catch {
    // fallback below
  }
  try {
    const ps = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', 'Set-Clipboard -Value $args[0]', '--', text],
      { encoding: 'utf8', windowsHide: true },
    );
    return ps.status === 0;
  } catch {
    return false;
  }
}

async function reportTunnelUrl(url) {
  try {
    await fetch(`http://127.0.0.1:${port}/api/mp-tunnel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicUrl: url }),
    });
  } catch {
    // Server might still be shutting down or unreachable
  }
}

function writeLinkFile(url) {
  try {
    const content = [
      url,
      '',
      '--- HOW TO INVITE YOUR FRIEND ---',
      '1. Send the https:// link above (it is already copied to your clipboard!).',
      '2. Inside the game open FRIENDS.EXE -> click + CREATE LOBBY -> click "INVITE-LINK"',
      '   to automatically copy the direct link with your Lobby Code (https://.../?lobby=OVR-XXXX).',
      '3. Keep the game server window & tunnel window open while playing.',
      '',
    ].join('\r\n');
    fs.writeFileSync(linkFilePath, content, 'utf8');
  } catch {
    // ignore file write issues
  }
}

function extractTunnelUrl(text) {
  const matches = text.match(/https:\/\/[a-z0-9.-]+\.(?:lhr\.life|localhost\.run)\b/gi);
  if (!matches) return null;
  for (const m of matches) {
    const lower = m.toLowerCase();
    if (lower.includes('admin.localhost.run')) continue;
    if (lower === 'https://localhost.run') continue;
    return m;
  }
  return null;
}

function printReadyBanner(url, copied) {
  console.log('\n================================================================');
  console.log('  INTERNET FRIEND LINK READY!');
  console.log('================================================================');
  console.log(`  Send this link to your friend:`);
  console.log(`    ${url}`);
  console.log('');
  console.log(copied
    ? '  [COPIED!] Link is ALREADY in your Windows Clipboard — press Ctrl+V!'
    : `  [SAVED]   Open "${path.basename(linkFilePath)}" to copy cleanly.`);
  console.log('  In-Game:  FRIENDS.EXE -> INVITE-LINK now copies the full https:// link!');
  console.log('');
  console.log('  Controls: [C] Re-Copy Link  |  [O] Open Notepad Link  |  [R] Reconnect  |  [Q] Quit');
  console.log('================================================================\n');
}

function handleTunnelChunk(raw) {
  const txt = raw.toString('utf8');
  const found = extractTunnelUrl(txt);
  if (found && found !== currentPublicUrl) {
    currentPublicUrl = found;
    const copied = copyClipboard(found);
    writeLinkFile(found);
    void reportTunnelUrl(found);
    printReadyBanner(found, copied);
    return;
  }
  for (const line of txt.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean) continue;
    if (/permission denied|connection refused|closed by remote|error|fatal|timeout|could not/i.test(clean)) {
      console.log(`[TUNNEL] ${clean}`);
    }
  }
}

function startSshTunnel() {
  if (shuttingDown) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (sshProc) {
    try { sshProc.kill(); } catch { /* ignore */ }
    sshProc = null;
  }

  console.log('[TUNNEL] Connecting to localhost.run (wait ~2 seconds for link)...');
  sshProc = spawn(
    'ssh',
    [
      '-T',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-R', `80:localhost:${port}`,
      'nokey@localhost.run',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );

  sshProc.stdout?.on('data', handleTunnelChunk);
  sshProc.stderr?.on('data', handleTunnelChunk);
  sshProc.on('exit', (code) => {
    sshProc = null;
    if (shuttingDown) return;
    console.log(`[TUNNEL] Disconnected (code ${code ?? 'unknown'}). Reconnecting in 2s... (Press Q to quit)`);
    reconnectTimer = setTimeout(startSshTunnel, 2000);
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch { /* ignore */ }
  }
  if (sshProc) {
    try { sshProc.kill(); } catch { /* ignore */ }
    sshProc = null;
  }
  await reportTunnelUrl(null);
  process.exit(exitCode);
}

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (buf) => {
    const ch = buf.toString('utf8');
    if (ch === '\u0003' || ch.toLowerCase() === 'q') {
      console.log('\n[TUNNEL] Closing friend tunnel...');
      void shutdown(0);
      return;
    }
    const lower = ch.toLowerCase();
    if (lower === 'c') {
      if (currentPublicUrl) {
        const ok = copyClipboard(currentPublicUrl);
        console.log(ok ? `[COPIED] ${currentPublicUrl}` : `[WARN] Could not access clipboard — check ${linkFilePath}`);
      } else {
        console.log('[WAIT] Tunnel URL not ready yet...');
      }
    } else if (lower === 'o') {
      if (currentPublicUrl) writeLinkFile(currentPublicUrl);
      spawn('notepad.exe', [linkFilePath], { detached: true, stdio: 'ignore' }).unref();
      console.log(`[OPENED] ${linkFilePath}`);
    } else if (lower === 'r') {
      console.log('[TUNNEL] Restarting tunnel for a fresh link...');
      currentPublicUrl = null;
      void reportTunnelUrl(null);
      startSshTunnel();
    }
  });
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('SIGHUP', () => void shutdown(0));

startSshTunnel();
