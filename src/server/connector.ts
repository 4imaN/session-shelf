import { WebSocket } from 'ws';
import { OperationSchema, type Operation } from '../shared/types';
import { Engine } from './engine';
interface Pair {
  url: string;
  id: string;
  token: string;
}
export function validateHubUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Use the hub origin only, without credentials or a path.');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  )
    throw new Error('Remote connectors require an HTTPS hub URL.');
  return url.origin;
}
export async function enroll(engine: Engine, url: string, code: string) {
  url = validateHubUrl(url);
  const res = await fetch(`${url}/api/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name: engine.device.name }),
    signal: AbortSignal.timeout(15000),
  });
  const body = (await res.json()) as any;
  if (!res.ok) throw new Error(body.error || 'Pairing failed');
  const pair: Pair = { url, id: body.id, token: body.token };
  engine.store.set('pair', pair);
  return pair;
}
export function connect(engine: Engine, onStatus: (s: string) => void = console.log) {
  const pair = engine.store.get<Pair>('pair');
  if (!pair) throw new Error('Pair this connector first with --hub URL --pair CODE.');
  let stopped = false,
    ws: WebSocket | undefined,
    retry: NodeJS.Timeout | undefined,
    delay = 1000;
  const send = (message: unknown) => {
    if (ws?.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 4 * 1024 * 1024) {
        ws.close(1013, 'Backpressure');
        return;
      }
      ws.send(JSON.stringify(message));
    }
  };
  const snapshot = () => send({ type: 'snapshot', device: engine.device, sessions: engine.list() });
  const terminal = (event: unknown) => send({ type: 'terminal', event });
  engine.on('changed', snapshot);
  engine.on('terminal', terminal);
  const start = () => {
    if (stopped) return;
    ws = new WebSocket(pair.url.replace(/^http/, 'ws') + '/connector', {
      headers: { Authorization: `Bearer ${pair.token}` },
      maxPayload: 256 * 1024,
    });
    ws.on('open', () => {
      delay = 1000;
      onStatus('Connected to ' + pair.url);
      snapshot();
    });
    ws.on('message', async (raw) => {
      let id: string | undefined;
      try {
        const m = JSON.parse(raw.toString());
        if (m.type !== 'rpc' || typeof m.id !== 'string') return;
        id = m.id;
        const op = OperationSchema.parse(m.operation);
        if ('key' in op) {
          const remoteKey = op.key;
          const prefix = pair.id + ':';
          if (!remoteKey.startsWith(prefix))
            throw new Error('Session belongs to a different computer');
          op.key = engine.device.id + ':' + remoteKey.slice(prefix.length);
        }
        const result = await engine.handle(op as Operation);
        send({ type: 'result', id, result });
      } catch (e) {
        if (id) send({ type: 'result', id, error: (e as Error).message });
      }
    });
    ws.on('error', (e) => onStatus('Connection unavailable: ' + e.message));
    ws.on('close', (code) => {
      if (stopped) return;
      if (code === 1008) {
        onStatus('Connector revoked. Pair again to reconnect.');
        stopped = true;
        return;
      }
      onStatus('Disconnected; retrying');
      retry = setTimeout(start, delay);
      delay = Math.min(delay * 2, 30000);
    });
  };
  start();
  const interval = setInterval(snapshot, 30000);
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    clearInterval(interval);
    engine.off('changed', snapshot);
    engine.off('terminal', terminal);
    ws?.close();
  };
}
