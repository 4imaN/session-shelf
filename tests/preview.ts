// Isolated UI verification fixture. Never used by the production application.
import path from 'node:path';
import { fixture } from './fixtures';
import { createHub } from '../src/server/hub';
const f = await fixture();
f.store.set('ownerKey', 'preview-only-key');
for (const s of f.engine.list())
  f.store.put({
    ...s,
    recap: {
      text:
        s.provider === 'codex'
          ? 'Task: Add keyboard navigation to the command palette.\nProgress: Arrow-key selection and Escape handling are in place. Focus returns to the search input.\nWhere to resume: Run the accessibility checks and verify screen-reader announcements.'
          : 'Task: Make the first-run experience feel clear and welcoming.\nProgress: The welcome screen and setup checklist are ready.\nWhere to resume: Check the layout on narrow screens.',
      provider: s.provider,
      hash: s.hash,
      partial: false,
      createdAt: new Date().toISOString(),
    },
  });
const hub = await createHub(f.engine, { port: 4318, uiDirectory: path.resolve('dist/ui') });
console.log('Isolated preview at ' + hub.origin + '; login: preview-only-key');
process.on('SIGTERM', async () => {
  await hub.close();
  f.engine.close();
  f.store.close();
  process.exit(0);
});
