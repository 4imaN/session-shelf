import { afterEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { fixture } from './fixtures';
import { createHub } from '../src/server/hub';
import { connect, enroll } from '../src/server/connector';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
async function setup() {
  const f = await fixture();
  const hub = await createHub(f.engine, { port: 0, uiDirectory: f.dir });
  cleanups.push(async () => {
    await hub.close();
    f.engine.close();
    f.store.close();
    await rm(f.dir, { recursive: true, force: true });
  });
  const res = await fetch(hub.origin + '/api/login', {
    method: 'POST',
    headers: { Origin: hub.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: hub.ownerKey }),
  });
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  const request = (route: string, body?: unknown, method?: string) =>
    fetch(hub.origin + route, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { Cookie: cookie, Origin: hub.origin, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  return { ...f, hub, cookie, request };
}
it('requires authentication and validates mutation origins', async () => {
  const f = await setup();
  expect((await fetch(f.hub.origin + '/api/state')).status).toBe(401);
  expect(
    (
      await fetch(f.hub.origin + '/api/operation', {
        method: 'POST',
        headers: {
          Cookie: f.cookie,
          Origin: 'https://evil.example',
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
    ).status,
  ).toBe(403);
  const state = await (await f.request('/api/state')).json();
  expect(state.sessions).toHaveLength(2);
  expect(
    (
      await f.request('/api/operation', {
        deviceId: f.engine.device.id,
        operation: { op: 'arbitraryCommand', command: 'bad' },
      })
    ).status,
  ).toBe(400);
});
it('returns transcripts without exposing file-access operations', async () => {
  const f = await setup();
  const result = await f.request('/api/operation', {
    deviceId: f.engine.device.id,
    operation: { op: 'transcript', key: f.engine.list()[0].key },
  });
  expect(result.status).toBe(200);
  expect((await result.json()).length).toBe(2);
  const unavailable = await f.request('/api/operation', {
    deviceId: f.engine.device.id,
    operation: { op: 'transcript', key: '../../etc/passwd' },
  });
  expect(unavailable.status).toBe(500);
});
it('pairs once, relays remote transcripts, caches offline sessions, and revokes access', async () => {
  const f = await setup(),
    remote = await fixture();
  cleanups.push(async () => {
    remote.engine.close();
    remote.store.close();
    await rm(remote.dir, { recursive: true, force: true });
  });
  const pairing = await (await f.request('/api/pairing', {})).json();
  const pair = await enroll(remote.engine, f.hub.origin, pairing.code);
  await expect(enroll(remote.engine, f.hub.origin, pairing.code)).rejects.toThrow(
    'expired or invalid',
  );
  const disconnect = connect(remote.engine, () => {});
  cleanups.push(async () => disconnect());
  await expect
    .poll(async () => {
      const s = await (await f.request('/api/state')).json();
      return s.sessions.length;
    })
    .toBe(4);
  const state = await (await f.request('/api/state')).json();
  const session = state.sessions.find((s: any) => s.deviceId === pair.id);
  expect(session.key.startsWith(pair.id + ':')).toBe(true);
  const transcript = await (
    await f.request('/api/operation', {
      deviceId: pair.id,
      operation: { op: 'transcript', key: session.key },
    })
  ).json();
  expect(transcript).toHaveLength(2);
  disconnect();
  await expect
    .poll(async () => {
      const s = await (await f.request('/api/state')).json();
      return s.devices.find((d: any) => d.id === pair.id).online;
    })
    .toBe(false);
  expect((await (await f.request('/api/state')).json()).sessions).toHaveLength(4);
  expect((await f.request('/api/connectors/' + pair.id, undefined, 'DELETE')).status).toBe(200);
  expect((await (await f.request('/api/state')).json()).sessions).toHaveLength(2);
});
it('reattaches one terminal controller and preserves process on disconnect', async () => {
  const f = await setup(),
    terminalId = '44444444-4444-4444-8444-444444444444';
  let killed = false,
    input = '';
  f.engine.terminals.sessions.set(terminalId, {
    key: f.engine.list()[0].key,
    buffer: 'previous output',
    exited: false,
    pty: {
      write: (s: string) => {
        input += s;
      },
      resize: () => {},
      kill: () => {
        killed = true;
      },
    } as any,
  });
  const url =
    f.hub.origin.replace('http', 'ws') + `/terminal?device=${f.engine.device.id}&id=${terminalId}`;
  const first = new WebSocket(url, { headers: { Cookie: f.cookie, Origin: f.hub.origin } });
  const firstMessage = once(first, 'message');
  await once(first, 'open');
  expect(JSON.parse(String((await firstMessage)[0])).buffer).toBe('previous output');
  first.send(JSON.stringify({ type: 'input', data: 'hello' }));
  await expect.poll(() => input).toBe('hello');
  const closed = once(first, 'close');
  const second = new WebSocket(url, { headers: { Cookie: f.cookie, Origin: f.hub.origin } });
  const secondMessage = once(second, 'message');
  await once(second, 'open');
  await secondMessage;
  await closed;
  expect(killed).toBe(false);
  second.close();
  await once(second, 'close');
  expect(killed).toBe(false);
});
