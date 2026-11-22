import { defineConfig, Plugin } from 'vite';
import { createCustomMapsHandler } from './server/customMapsApi.mjs';
import { attachMultiplayerServer, getLanUrls } from './server/mpServer.mjs';

function multiplayerServerPlugin(): Plugin {
  return {
    name: 'pure-skill-multiplayer',
    configureServer(server) {
      let mpHandle: ReturnType<typeof attachMultiplayerServer> | null = null;
      if (server.httpServer) {
        mpHandle = attachMultiplayerServer(server.httpServer, { path: '/ws' });
      }
      const customMapsMiddleware = createCustomMapsHandler(process.cwd());
      server.middlewares.use('/api/custom-maps', (req, res, next) => {
        // Restore full /api/custom-maps prefix when mounted on a subpath in Connect
        const origUrl = req.url || '/';
        req.url = origUrl.startsWith('/api/custom-maps') ? origUrl : `/api/custom-maps${origUrl === '/' ? '' : origUrl}`;
        void customMapsMiddleware(req, res, next);
      });
      let activePublicUrl: string | null = null;
      const isLoopback = (req: { socket?: { remoteAddress?: string } }) => {
        const addr = req.socket?.remoteAddress || '';
        return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
      };
      server.middlewares.use('/api/mp-tunnel', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        if (!isLoopback(req)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Loopback only' }));
          return;
        }
        let body = '';
        req.on('data', (c: Buffer) => {
          if (body.length < 4096) body += c.toString('utf8');
        });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}') as { publicUrl?: unknown };
            activePublicUrl =
              typeof parsed.publicUrl === 'string' && /^https:\/\/[a-z0-9.-]+/i.test(parsed.publicUrl.trim())
                ? parsed.publicUrl.trim().slice(0, 200)
                : null;
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true, publicUrl: activePublicUrl }));
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
      });
      server.middlewares.use('/api/mp-info', (_req, res) => {
        const port = typeof server.config.server.port === 'number' ? server.config.server.port : 5173;
        const stats = mpHandle ? mpHandle.getServerStats() : { activeLobbies: 0, connectedPlayers: 0 };
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            port,
            lanUrls: getLanUrls(port),
            publicUrl: activePublicUrl,
            ...stats,
          }),
        );
      });
    },
  };
}

export default defineConfig({
  plugins: [multiplayerServerPlugin()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    open: false,
  },
  build: {
    target: 'es2022',
  },
});
