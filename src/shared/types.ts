import { z } from 'zod';
export const Provider = z.enum(['codex', 'claude']);
export type Provider = z.infer<typeof Provider>;
export interface Message {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
}
export interface Recap {
  text: string;
  provider: Provider;
  hash: string;
  createdAt: string;
  partial: boolean;
}
export interface Session {
  key: string;
  id: string;
  deviceId: string;
  provider: Provider;
  title: string;
  cwd: string;
  updatedAt: string;
  createdAt: string;
  preview: string;
  messageCount: number;
  hash: string;
  recap?: Recap;
  available: boolean;
}
export interface Device {
  id: string;
  name: string;
  platform: string;
  environment: string;
  online: boolean;
  local: boolean;
  lastSeen: string;
}
export const SettingsSchema = z.object({
  summaryProvider: Provider.nullable().default(null),
  automatic: z.boolean().default(false),
  codexRoot: z.string().max(4096),
  claudeRoot: z.string().max(4096),
  codexExecutable: z.string().max(4096).default('codex'),
  claudeExecutable: z.string().max(4096).default('claude'),
  terminalExecutable: z.string().max(4096).default(''),
  desktopTerminal: z.enum(['system', 'ghostty', 'cmux', 'muxy', 'custom']).default('system'),
  terminalFlag: z.enum(['-e', '--', '-x']).default('-e'),
  useTmux: z.boolean().default(false),
  deviceName: z.string().min(1).max(100),
});
export type Settings = z.infer<typeof SettingsSchema>;
export interface TerminalOption {
  id: Settings['desktopTerminal'];
  name: string;
  available: boolean;
  detail: string;
}
export const OperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('transcript'), key: z.string() }),
  z.object({ op: z.literal('summarize'), key: z.string() }),
  z.object({ op: z.literal('resume'), key: z.string(), mode: z.enum(['desktop', 'browser']) }),
  z.object({ op: z.literal('refresh') }),
  z.object({ op: z.literal('settings') }),
  z.object({ op: z.literal('detectTerminals') }),
  z.object({ op: z.literal('saveSettings'), settings: SettingsSchema }),
  z.object({ op: z.literal('terminalAttach'), terminalId: z.string() }),
  z.object({ op: z.literal('terminalInput'), terminalId: z.string(), data: z.string().max(65536) }),
  z.object({
    op: z.literal('terminalResize'),
    terminalId: z.string(),
    cols: z.number().int().min(10).max(500),
    rows: z.number().int().min(2).max(300),
  }),
  z.object({ op: z.literal('terminalStop'), terminalId: z.string() }),
]);
export type Operation = z.infer<typeof OperationSchema>;
export interface TerminalEvent {
  terminalId: string;
  type: 'output' | 'exit';
  data?: string;
  code?: number;
}
