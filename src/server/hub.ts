import express from 'express';
import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { Engine } from './engine';
import { OperationSchema, type Device, type Operation, type TerminalEvent } from '../shared/types';
const secret = () => randomBytes(32).toString('base64url');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function equal(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
interface Credential {
  id: string;
  tokenHash: string;
  name: string;
}
interface Remote {
  ws: WebSocket;
  device: Device;
  pending: Map<
    string,
    { resolve: (r: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >;
}
export interface HubOptions {
  port?: number;
  publicOrigin?: string;
  uiDirectory: string;
  devOrigin?: string;
}
export async function createHub(engine: Engine, options: HubOptions) {
  const app = express(),
    server = createServer(app),
    wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  const ownerKey = engine.store.get<string>('ownerKey') || secret();
  engine.store.set('ownerKey', ownerKey);
  const logins = new Map<string, number>(),
    attempts = new Map<string, { count: number; until: number }>(),
    pairings = new Map<string, number>(),
    remotes = new Map<string, Remote>();
  const terminals = new Map<string, WebSocket>();
  let origin = '';
  const credentials = () => engine.store.get<Credential[]>('connectors') || [];
  const known = () => engine.store.get<Device[]>('devices') || [];
  const saveKnown = (d: Device) =>
    engine.store.set('devices', [...known().filter((x) => x.id !== d.id), d]);
  const allowedOrigin = (req: IncomingMessage) =>
    [origin, options.publicOrigin, options.devOrigin]
      .filter(Boolean)
      .includes(req.headers.origin || '');
  const cookieToken = (req: IncomingMessage) => {
    const m = (req.headers.cookie || '').match(/(?:^|;\s*)shelf=([^;]+)/);
    return m?.[1] || '';
  };
  const authenticated = (req: IncomingMessage) => {
    const token = cookieToken(req);
    return !!token && (logins.get(hash(token)) || 0) > Date.now();
  };
  const send = (ws: WebSocket, msg: unknown) => {
    if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 2 * 1024 * 1024) {
        ws.close(1013, 'Connection too slow; reconnect');
        return;
      }
      ws.send(JSON.stringify(msg));
    }
  };
  async function dispatch(deviceId: string, op: Operation): Promise<any> {
    if (deviceId === engine.device.id) return engine.handle(op);
    const remote = remotes.get(deviceId);
    if (!remote) throw new Error('Computer is offline. Start its connector and reconnect.');
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(
        () => {
          remote.pending.delete(id);
          reject(new Error('Computer did not respond in time.'));
        },
        op.op === 'summarize' ? 190000 : 30000,
      );
      remote.pending.set(id, { resolve, reject, timer });
      send(remote.ws, { type: 'rpc', id, operation: op });
    });
  }
  function terminalEvent(deviceId: string, event: TerminalEvent) {
    const ws = terminals.get(`${deviceId}:${event.terminalId}`);
    if (ws) send(ws, event);
  }
  const onTerminal = (e: TerminalEvent) => terminalEvent(engine.device.id, e);
  engine.on('terminal', onTerminal);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const hosts = [origin, options.publicOrigin, options.devOrigin]
      .filter(Boolean)
      .map((s) => new URL(s!).host);
    if (!hosts.includes(req.headers.host || ''))
      return void res.status(403).json({ error: 'Unrecognized host' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
    );
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.get('/api/auth', (req, res) => res.json({ authenticated: authenticated(req) }));
  app.post('/api/login', (req, res) => {
    if (!allowedOrigin(req)) return void res.status(403).json({ error: 'Invalid request origin' });
    const ip = req.socket.remoteAddress || 'local',
      entry = attempts.get(ip);
    if (entry && entry.until > Date.now() && entry.count >= 10)
      return void res.status(429).json({ error: 'Too many attempts. Try again in ten minutes.' });
    if (typeof req.body.key !== 'string' || !equal(req.body.key, ownerKey)) {
      attempts.set(ip, {
        count: entry && entry.until > Date.now() ? entry.count + 1 : 1,
        until: Date.now() + 600000,
      });
      return void res.status(401).json({ error: 'Incorrect owner key' });
    }
    attempts.delete(ip);
    const token = secret();
    logins.set(hash(token), Date.now() + 7 * 86400000);
    const secure = req.headers.origin?.startsWith('https:') ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `shelf=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`,
    );
    res.json({ ok: true });
  });
  app.post('/api/enroll', (req, res) => {
    const body = z
      .object({ code: z.string().min(20).max(200), name: z.string().min(1).max(100) })
      .parse(req.body);
    const expiry = pairings.get(body.code);
    if (!expiry || expiry < Date.now())
      return void res.status(401).json({ error: 'Pairing code expired or invalid' });
    pairings.delete(body.code);
    const id = randomUUID(),
      token = secret();
    engine.store.set('connectors', [
      ...credentials(),
      { id, name: body.name, tokenHash: hash(token) },
    ]);
    res.json({ id, token });
  });
  app.use('/api', (req, res, next) => {
    if (!authenticated(req))
      return void res.status(401).json({ error: 'Sign in with your owner key' });
    if (req.method !== 'GET' && !allowedOrigin(req))
      return void res.status(403).json({ error: 'Invalid request origin' });
    next();
  });
  app.post('/api/logout', (req, res) => {
    logins.delete(hash(cookieToken(req)));
    for (const ws of terminals.values()) ws.close(1000, 'Signed out');
    res.setHeader('Set-Cookie', 'shelf=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });
  app.get('/api/state', (_req, res) => {
    const devices = [
      engine.device,
      ...credentials().map((c) => ({
        ...(known().find((d) => d.id === c.id) || {
          id: c.id,
          name: c.name,
          platform: 'unknown',
          environment: 'Awaiting connector',
          lastSeen: '',
        }),
        local: false,
        online: remotes.has(c.id),
      })),
    ];
    const sessions = engine.store
      .sessions()
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    res.json({ devices, sessions, warnings: engine.warnings, localDeviceId: engine.device.id });
  });
  app.post('/api/operation', async (req, res) => {
    const body = z.object({ deviceId: z.string(), operation: OperationSchema }).parse(req.body);
    res.json(await dispatch(body.deviceId, body.operation));
  });
  app.post('/api/pairing', (_req, res) => {
    const code = secret();
    pairings.set(code, Date.now() + 600000);
    res.json({
      code,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      hubUrl: options.publicOrigin || origin,
    });
  });
  app.delete('/api/connectors/:id', (req, res) => {
    const id = String(req.params.id);
    engine.store.set(
      'connectors',
      credentials().filter((c) => c.id !== id),
    );
    remotes.get(id)?.ws.close(1008, 'Revoked');
    remotes.delete(id);
    engine.store.removeDevice(id);
    engine.store.set(
      'devices',
      known().filter((d) => d.id !== id),
    );
    for (const [key, ws] of terminals)
      if (key.startsWith(id + ':')) {
        ws.close(1008, 'Computer removed');
        terminals.delete(key);
      }
    res.json({ ok: true });
  });
  if (existsSync(path.join(options.uiDirectory, 'index.html'))) {
    app.use(express.static(options.uiDirectory));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(options.uiDirectory, 'index.html')));
  } else
    app.get('/', (_req, res) =>
      res
        .type('text')
        .send('Run npm run build for the website, or open the Vite development server.'),
    );
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err instanceof z.ZodError ? 400 : 500).json({
      error: err instanceof z.ZodError ? 'Invalid request' : err.message || 'Request failed',
    });
  });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', origin);
    if (url.pathname === '/connector') {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const credential = credentials().find((c) => equal(c.tokenHash, hash(token)));
      if (!credential) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const remote: Remote = {
          ws,
          device: {
            id: credential.id,
            name: credential.name,
            platform: 'unknown',
            environment: 'unknown',
            local: false,
            online: true,
            lastSeen: new Date().toISOString(),
          },
          pending: new Map(),
        };
        remotes.get(credential.id)?.ws.close(1000, 'Replaced connection');
        remotes.set(credential.id, remote);
        ws.on('message', (raw) => {
          try {
            const m = JSON.parse(raw.toString());
            if (m.type === 'snapshot') {
              const data = z
                .object({
                  device: z.object({
                    name: z.string().max(100),
                    platform: z.string().max(50),
                    environment: z.string().max(100),
                  }),
                  sessions: z
                    .array(
                      z.object({
                        key: z.string(),
                        id: z.string().uuid(),
                        provider: z.enum(['codex', 'claude']),
                        title: z.string().max(1000),
                        cwd: z.string().max(4096),
                        updatedAt: z.string(),
                        createdAt: z.string(),
                        preview: z.string().max(1000),
                        messageCount: z.number(),
                        hash: z.string(),
                        available: z.boolean(),
                        recap: z
                          .object({
                            text: z.string().max(12000),
                            provider: z.enum(['codex', 'claude']),
                            hash: z.string(),
                            createdAt: z.string(),
                            partial: z.boolean(),
                          })
                          .optional(),
                      }),
                    )
                    .max(50000),
                })
                .parse(m);
              remote.device = {
                ...remote.device,
                ...data.device,
                lastSeen: new Date().toISOString(),
              };
              saveKnown(remote.device);
              const sessions = data.sessions.map((s) => ({
                ...s,
                deviceId: credential.id,
                key: `${credential.id}:${s.provider}:${s.id}`,
              }));
              engine.store.replaceDevice(credential.id, sessions);
            } else if (m.type === 'result' && typeof m.id === 'string') {
              const pending = remote.pending.get(m.id);
              if (pending) {
                clearTimeout(pending.timer);
                remote.pending.delete(m.id);
                m.error ? pending.reject(new Error(String(m.error))) : pending.resolve(m.result);
              }
            } else if (m.type === 'terminal') {
              const event = z
                .object({
                  terminalId: z.string().uuid(),
                  type: z.enum(['output', 'exit']),
                  data: z.string().max(200000).optional(),
                  code: z.number().optional(),
                })
                .parse(m.event);
              terminalEvent(credential.id, event);
            }
          } catch {
            ws.close(1008, 'Invalid connector message');
          }
        });
        ws.on('close', () => {
          if (remotes.get(credential.id) === remote) remotes.delete(credential.id);
          for (const p of remote.pending.values()) {
            clearTimeout(p.timer);
            p.reject(new Error('Computer disconnected'));
          }
          for (const [key, client] of terminals)
            if (key.startsWith(credential.id + ':'))
              client.close(1012, 'Computer disconnected; reconnect');
        });
      });
      return;
    }
    if (url.pathname !== '/terminal' || !authenticated(req) || !allowedOrigin(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const deviceId = url.searchParams.get('device') || '',
      terminalId = url.searchParams.get('id') || '',
      key = `${deviceId}:${terminalId}`;
    if (!z.string().uuid().safeParse(terminalId).success) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let ready = false;
      terminals.get(key)?.close(1000, 'Control moved to another browser');
      terminals.set(key, ws);
      // The client ignores pre-attach output and replays the current buffer.
      void dispatch(deviceId, { op: 'terminalAttach', terminalId })
        .then((result) => {
          if (ws.readyState === WebSocket.OPEN) {
            send(ws, { type: 'attached', ...result });
            ready = true;
          }
        })
        .catch((e) => {
          send(ws, { type: 'error', error: e.message });
          ws.close();
        });
      ws.on('message', (raw) => {
        try {
          if (!ready) throw new Error('Terminal is still attaching');
          if (!authenticated(req)) throw new Error('Login expired');
          const m = JSON.parse(raw.toString());
          const operation = OperationSchema.parse(
            m.type === 'input'
              ? { op: 'terminalInput', terminalId, data: m.data }
              : m.type === 'resize'
                ? { op: 'terminalResize', terminalId, cols: m.cols, rows: m.rows }
                : {},
          );
          void dispatch(deviceId, operation).catch((e) =>
            send(ws, { type: 'error', error: e.message }),
          );
        } catch (e) {
          send(ws, { type: 'error', error: (e as Error).message });
        }
      });
      ws.on('close', () => {
        if (terminals.get(key) === ws) terminals.delete(key);
      });
    });
  });
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if ((client as any).alive === false) {
        client.terminate();
        continue;
      }
      (client as any).alive = false;
      client.ping();
    }
  }, 30000);
  wss.on('connection', () => {});
  // noServer callbacks do not emit connection automatically.
  const upgrade = wss.handleUpgrade.bind(wss);
  wss.handleUpgrade = (req, socket, head, cb) =>
    upgrade(req, socket, head, (ws) => {
      (ws as any).alive = true;
      ws.on('pong', () => {
        (ws as any).alive = true;
      });
      cb(ws, req);
    });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4317, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 4317}`;
  return {
    app,
    server,
    origin,
    ownerKey,
    dispatch,
    close: async () => {
      clearInterval(heartbeat);
      engine.off('terminal', onTerminal);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
