import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/server/store';
import { Engine } from '../src/server/engine';
export const id = '11111111-1111-4111-8111-111111111111';
export const claudeId = '22222222-2222-4222-8222-222222222222';
export function codexLines(cwd: string, sessionId = id) {
  return [
    { type: 'session_meta', timestamp: '2026-09-14T08:00:00Z', payload: { id: sessionId, cwd } },
    {
      type: 'response_item',
      timestamp: '2026-09-14T08:00:01Z',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Add keyboard navigation to the command palette' }],
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-09-14T08:00:01Z',
      payload: { type: 'user_message', message: 'Add keyboard navigation to the command palette' },
    },
    {
      type: 'response_item',
      timestamp: '2026-09-14T08:02:00Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'Arrow keys now move through results. Focus returns to the input on Escape. The accessibility checks are next.',
          },
        ],
      },
    },
  ];
}
export async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shelf-test-')),
    codex = path.join(dir, 'codex'),
    claude = path.join(dir, 'claude'),
    cwd = path.join(dir, "project with 'quotes' & spaces");
  await Promise.all([mkdir(codex), mkdir(claude), mkdir(cwd)]);
  const file = path.join(codex, 'session.jsonl');
  await writeFile(
    file,
    codexLines(cwd)
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n',
  );
  await writeFile(
    path.join(claude, 'session.jsonl'),
    [
      {
        type: 'user',
        sessionId: claudeId,
        cwd,
        uuid: 'u1',
        timestamp: '2026-09-14T07:00:00Z',
        message: { content: 'Refine the onboarding flow and empty states' },
      },
      {
        type: 'assistant',
        sessionId: claudeId,
        cwd,
        uuid: 'a1',
        timestamp: '2026-09-14T07:03:00Z',
        message: {
          content: [
            {
              type: 'text',
              text: 'The welcome screen and checklist are ready. Still need to check narrow screens.',
            },
          ],
        },
      },
      { type: 'ai-title', sessionId: claudeId, aiTitle: 'Refining the first-run experience' },
    ]
      .map((r) => JSON.stringify(r))
      .join('\n'),
  );
  const store = new Store(path.join(dir, 'data'));
  store.set('settings', { codexRoot: codex, claudeRoot: claude, deviceName: 'Studio Mac' });
  const engine = new Engine(store);
  await engine.scan();
  return { dir, codex, claude, cwd, file, store, engine };
}
