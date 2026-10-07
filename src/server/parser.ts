import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Message, Provider, Session } from '../shared/types';
export interface Parsed {
  session: Session;
  messages: Message[];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validId(id: string) {
  return uuid.test(id);
}
function content(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .filter((x) => ['text', 'input_text', 'output_text'].includes(x?.type))
    .map((x) => x.text || '')
    .join('\n');
}
export async function parseSession(
  file: string,
  provider: Provider,
  deviceId: string,
): Promise<Parsed | null> {
  let id = '',
    cwd = '',
    title = '',
    createdAt = '',
    updatedAt = '',
    subordinate = false;
  const canonical: Message[] = [],
    events: Message[] = [],
    seen = new Set<string>();
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    let r: any;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (!r || typeof r !== 'object') continue;
    const ts =
      typeof r.timestamp === 'string' && !Number.isNaN(Date.parse(r.timestamp))
        ? r.timestamp
        : undefined;
    if (ts) {
      createdAt ||= ts;
      if (!updatedAt || Date.parse(ts) > Date.parse(updatedAt)) updatedAt = ts;
    }
    if (provider === 'codex') {
      const p = r.payload;
      if (r.type === 'session_meta' && p) {
        id = p.id || id;
        cwd = p.cwd || cwd;
        subordinate ||= !!p.source?.subagent;
      }
      if (
        r.type === 'response_item' &&
        p?.type === 'message' &&
        ['user', 'assistant'].includes(p.role)
      ) {
        const text = content(p.content);
        if (
          text &&
          !/^<(environment_context|permissions instructions|user_instructions)>/.test(text) &&
          !text.startsWith('# AGENTS.md instructions')
        )
          canonical.push({ role: p.role, text, timestamp: ts });
      }
      if (r.type === 'event_msg' && ['user_message', 'agent_message'].includes(p?.type)) {
        const text = content(p.message);
        if (text)
          events.push({
            role: p.type === 'user_message' ? 'user' : 'assistant',
            text,
            timestamp: ts,
          });
      }
    } else {
      id = r.sessionId || id;
      cwd = r.cwd || cwd;
      subordinate ||= r.isSidechain === true;
      if (r.type === 'ai-title') title = r.aiTitle || title;
      if (r.type === 'custom-title') title = r.customTitle || title;
      if (['user', 'assistant'].includes(r.type) && r.message) {
        const text = content(r.message.content),
          dedup = r.uuid || `${r.type}:${ts}:${text}`;
        if (text && !seen.has(dedup) && !r.isMeta) {
          seen.add(dedup);
          canonical.push({ role: r.type, text, timestamp: ts });
        }
      }
    }
  }
  if (!validId(id) || !cwd || subordinate) return null;
  const messages = canonical.length ? canonical : events;
  if (!messages.length) return null;
  const first = messages.find((m) => m.role === 'user')?.text || 'Untitled session';
  title ||=
    first
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'Untitled session';
  const hash = createHash('sha256')
    .update(JSON.stringify(messages.map((m) => [m.role, m.text])))
    .digest('hex');
  return {
    session: {
      key: `${deviceId}:${provider}:${id}`,
      id,
      deviceId,
      provider,
      cwd,
      title,
      createdAt: createdAt || new Date(0).toISOString(),
      updatedAt: updatedAt || new Date(0).toISOString(),
      preview: messages.at(-1)!.text.slice(0, 350),
      messageCount: messages.length,
      hash,
      available: true,
    },
    messages,
  };
}
