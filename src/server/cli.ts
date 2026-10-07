import { parseArgs } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store';
import { Engine } from './engine';
import { createHub } from './hub';
import { connect, enroll, validateHubUrl } from './connector';
const { values } = parseArgs({
  options: {
    port: { type: 'string' },
    data: { type: 'string' },
    connector: { type: 'boolean' },
    hub: { type: 'string' },
    pair: { type: 'string' },
    'public-origin': { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'Session Shelf\n  --port 4317 --data DIRECTORY\n  --public-origin https://computer.tailnet.ts.net\n  --connector [--hub URL --pair CODE]\nLocal browser login uses the owner key printed at startup.',
  );
  process.exit(0);
}
const directory =
  values.data || process.env.SHELF_DATA_DIR || path.join(os.homedir(), '.session-shelf');
const store = new Store(directory),
  engine = new Engine(store);
await engine.start();
let close: () => Promise<void> | void;
if (values.connector) {
  if (values.hub && values.pair) await enroll(engine, values.hub, values.pair);
  close = connect(engine);
} else {
  const port = Number(values.port || 4317);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  const publicOrigin = values['public-origin']
    ? validateHubUrl(values['public-origin'])
    : undefined;
  const hub = await createHub(engine, {
    port,
    publicOrigin,
    uiDirectory: fileURLToPath(new URL('../ui', import.meta.url)),
    devOrigin: process.env.NODE_ENV === 'production' ? undefined : 'http://127.0.0.1:5173',
  });
  console.log(
    `Session Shelf: ${hub.origin}\nOwner key: ${hub.ownerKey}\nKeep this key private. Data: ${directory}`,
  );
  close = hub.close;
}
const shutdown = async () => {
  await engine.close();
  await close();
  store.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
