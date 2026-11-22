import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCustomMapsHandler } from './customMapsApi.mjs';
import { attachMultiplayerServer, getLanUrls } from './mpServer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT || 5173);
const handleCustomMaps = createCustomMapsHandler(rootDir);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

if (!fs.existsSync(distDir)) {
  console.error('[HOST] dist/ folder not found. Run "npm run build" first.');
  process.exit(1);
}

let mpCtrl;
let activePublicUrl = null;
const isLoopback = (req) => {
  const addr = req.socket?.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
};

const isLocalHostname = (hostHeader = '') => {
  const h = String(hostHeader).split(':')[0].trim().toLowerCase();
  if (!h || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m172 = /^172\.(\d+)\./.exec(h);
  return Boolean(m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31);
};

const envPublicUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '') || null;

const getCacheControl = (relPath, ext) => {
  if (ext === '.html') return 'no-cache';
  if (relPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (['.glb', '.m4a', '.mp4', '.png', '.jpg', '.svg', '.ico'].includes(ext)) {
    return 'public, max-age=86400';
  }
  return 'public, max-age=3600';
};

const resolvePublicUrl = (req) => {
  if (activePublicUrl) return { publicUrl: activePublicUrl, isPublicHosted: false };
  if (envPublicUrl) return { publicUrl: envPublicUrl, isPublicHosted: true };
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (protoHeader === 'https' && hostHeader && !isLocalHostname(hostHeader)) {
    return { publicUrl: `https://${hostHeader}`, isPublicHosted: true };
  }
  return { publicUrl: null, isPublicHosted: false };
};

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', `http://localhost:${port}`);
  if (reqUrl.pathname === '/healthz') {
    const stats = mpCtrl ? mpCtrl.getServerStats() : { activeLobbies: 0, connectedPlayers: 0 };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(
      JSON.stringify({
        ok: true,
        uptimeSec: Math.floor(process.uptime()),
        ...stats,
      }),
    );
    return;
  }
  if (reqUrl.pathname.startsWith('/api/custom-maps')) {
    await handleCustomMaps(req, res);
    return;
  }
  if (reqUrl.pathname === '/api/mp-tunnel' && req.method === 'POST') {
    if (!isLoopback(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Loopback only' }));
      return;
    }
    let body = '';
    req.on('data', (c) => {
      if (body.length < 4096) body += c.toString('utf8');
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const nextUrl = typeof parsed.publicUrl === 'string' && /^https:\/\/[a-z0-9.-]+/i.test(parsed.publicUrl.trim())
          ? parsed.publicUrl.trim().slice(0, 200)
          : null;
        activePublicUrl = nextUrl;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, publicUrl: activePublicUrl }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  if (reqUrl.pathname === '/api/mp-info') {
    const stats = mpCtrl ? mpCtrl.getServerStats() : { activeLobbies: 0, connectedPlayers: 0 };
    const { publicUrl, isPublicHosted } = resolvePublicUrl(req);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(
      JSON.stringify({
        port,
        lanUrls: getLanUrls(port),
        publicUrl,
        isPublicHosted,
        ...stats,
      }),
    );
    return;
  }

  let relPath = decodeURIComponent(reqUrl.pathname);
  if (relPath === '/') relPath = '/index.html';
  const safePath = path.normalize(path.join(distDir, relPath));
  if (!safePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let target = safePath;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    target = path.join(distDir, 'index.html');
    relPath = '/index.html';
  }
  const ext = path.extname(target).toLowerCase();
  const stat = fs.statSync(target);
  const baseHeaders = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': getCacheControl(relPath, ext),
    'Accept-Ranges': 'bytes',
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, {
      ...baseHeaders,
      'Content-Length': stat.size,
    });
    res.end();
    return;
  }

  const rangeHeader = req.headers.range;
  if (typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=')) {
    const [rawStart, rawEnd] = rangeHeader.slice('bytes='.length).split('-');
    let start = rawStart === '' ? NaN : Number(rawStart);
    let end = rawEnd === '' ? NaN : Number(rawEnd);
    if (Number.isNaN(start) && !Number.isNaN(end)) {
      start = Math.max(0, stat.size - end);
      end = stat.size - 1;
    } else if (!Number.isNaN(start) && Number.isNaN(end)) {
      end = stat.size - 1;
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end >= stat.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(target, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    ...baseHeaders,
    'Content-Length': stat.size,
  });
  fs.createReadStream(target).pipe(res);
});

mpCtrl = attachMultiplayerServer(server, { path: '/ws' });

const shutdown = (signal) => {
  console.log(`[HOST] Received ${signal}, shutting down cleanly...`);
  try {
    mpCtrl?.close();
  } catch {
    // ignore
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(port, '0.0.0.0', () => {
  console.log('\n=== PURE SKILL: OVERDRIVE — MULTIPLAYER HOST ===');
  console.log(`  Port:    ${port}`);
  if (envPublicUrl) {
    console.log(`  Public:  ${envPublicUrl}/`);
  } else {
    console.log(`  Local:   http://localhost:${port}/`);
    for (const u of getLanUrls(port)) {
      console.log(`  LAN:     ${u}`);
    }
    console.log('\n  Free Internet Tunnel (no signup/pay):');
    console.log(`    ssh -R 80:localhost:${port} nokey@localhost.run`);
    console.log(`    # or: cloudflared tunnel --url http://localhost:${port}\n`);
  }
});
