import { readdir, stat } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Store } from './store';
import { parseSession } from './parser';
import { detectTerminals, launchDesktop, summarize, Terminals } from './processes';
import {
  SettingsSchema,
  type Device,
  type Operation,
  type Session,
  type Settings,
  type Provider,
} from '../shared/types';
async function* files(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    if (e.isSymbolicLink() || e.name === 'subagents') continue;
    const f = path.join(root, e.name);
    if (e.isDirectory()) yield* files(f);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield f;
  }
}
export class Engine extends EventEmitter {
  device: Device;
  settings: Settings;
  terminals = new Terminals();
  warnings: string[] = [];
  paths = new Map<string, string>();
  signatures = new Map<string, string>();
  summaryJobs = new Map<string, Promise<unknown>>();
  private scanJob?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private debounce?: NodeJS.Timeout;
  private watchers: FSWatcher[] = [];
  private autoQueue = new Set<string>();
  private automaticBusy = false;
  private initialized = false;
  private closed = false;
  private abort = new AbortController();
  constructor(public store: Store) {
    super();
    const id = store.get<string>('deviceId') || randomUUID();
    store.set('deviceId', id);
    this.settings = SettingsSchema.parse(
      store.get('settings') || {
        codexRoot: path.join(
          process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
          'sessions',
        ),
        claudeRoot: path.join(
          process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
          'projects',
        ),
        deviceName: os.hostname(),
      },
    );
    this.device = {
      id,
      name: this.settings.deviceName,
      platform: process.platform,
      environment: process.env.WSL_DISTRO_NAME
        ? `WSL · ${process.env.WSL_DISTRO_NAME}`
        : process.platform,
      online: true,
      local: true,
      lastSeen: new Date().toISOString(),
    };
    const index = store.get<{ paths: [string, string][]; signatures: [string, string][] }>(
      'fileIndex',
    );
    if (index) {
      this.paths = new Map(index.paths);
      this.signatures = new Map(index.signatures);
    }
    this.terminals.on('event', (e) => this.emit('terminal', e));
  }
  list() {
    return this.store.sessions().filter((s) => s.deviceId === this.device.id);
  }
  async start() {
    await this.scan();
    this.watchRoots();
    this.timer = setInterval(
      () =>
        void this.scan().catch((e) => {
          this.warnings = [e.message];
        }),
      5000,
    );
  }
  private watchRoots() {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    for (const root of [this.settings.codexRoot, this.settings.claudeRoot])
      try {
        const watcher = watch(root, { recursive: true }, () => {
          if (this.debounce) clearTimeout(this.debounce);
          this.debounce = setTimeout(() => {
            if (!this.closed)
              void this.scan().catch((e) => {
                this.warnings = [e.message];
              });
          }, 750);
        });
        watcher.on('error', () => watcher.close());
        this.watchers.push(watcher);
      } catch {
        /* Polling also discovers missing folders when they appear. */
      }
  }
  async scan() {
    if (this.closed) return;
    if (this.scanJob) return this.scanJob;
    this.scanJob = this.doScan().finally(() => {
      this.scanJob = undefined;
    });
    return this.scanJob;
  }
  private async doScan() {
    const found = new Set<string>();
    this.warnings = [];
    let changed = false;
    const previous = new Map(this.list().map((s) => [s.key, s]));
    for (const provider of ['codex', 'claude'] as Provider[]) {
      const root = provider === 'codex' ? this.settings.codexRoot : this.settings.claudeRoot;
      try {
        for await (const file of files(root)) {
          if (this.closed) return;
          found.add(file);
          try {
            const info = await stat(file),
              sig = `${info.size}:${info.mtimeMs}`;
            if (this.signatures.get(file) === sig) continue;
            const parsed = await parseSession(file, provider, this.device.id);
            this.signatures.set(file, sig);
            if (!parsed) continue;
            const old = previous.get(parsed.session.key);
            this.paths.set(parsed.session.key, file);
            parsed.session.recap = old?.recap;
            this.store.put(parsed.session);
            changed = true;
            if (this.initialized && old?.hash !== parsed.session.hash && this.settings.automatic)
              this.autoQueue.add(parsed.session.key);
          } catch (e) {
            this.warnings.push(`Could not read ${path.basename(file)}: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        this.warnings.push(`${provider}: ${(e as Error).message}`);
      }
    }
    for (const s of this.list()) {
      const file = this.paths.get(s.key);
      if (!file || !found.has(file)) {
        if (s.available) {
          s.available = false;
          this.store.put(s);
          changed = true;
        }
        if (file) this.signatures.delete(file);
      }
    }
    this.initialized = true;
    if (changed) {
      this.store.set('fileIndex', { paths: [...this.paths], signatures: [...this.signatures] });
      this.emit('changed');
    }
    if (!this.automaticBusy && !this.closed) void this.runAutomatic();
  }
  private async runAutomatic() {
    if (!this.settings.automatic || !this.settings.summaryProvider) return;
    this.automaticBusy = true;
    try {
      for (const key of this.autoQueue) {
        if (this.closed || !this.settings.automatic) break;
        const s = this.list().find((s) => s.key === key);
        if (!s || Date.now() - Date.parse(s.updatedAt) < 60000) continue;
        this.autoQueue.delete(key);
        try {
          await this.recap(key);
        } catch (e) {
          this.warnings.push((e as Error).message);
        }
      }
    } finally {
      this.automaticBusy = false;
    }
  }
  get(key: string) {
    const session = this.list().find((s) => s.key === key);
    if (!session?.available || !this.paths.has(key))
      throw new Error('Session source is unavailable. Refresh or check its configured folder.');
    return session;
  }
  async transcript(key: string) {
    const session = this.get(key);
    const p = await parseSession(this.paths.get(key)!, session.provider, this.device.id);
    if (!p) throw new Error('Session could not be read.');
    return p.messages;
  }
  async recap(key: string) {
    if (this.closed) throw new Error('Service is shutting down');
    if (this.summaryJobs.has(key)) return this.summaryJobs.get(key);
    if (!this.settings.summaryProvider)
      throw new Error('Choose a recap provider in Settings first.');
    if (this.summaryJobs.size)
      throw new Error('A recap is already running on this computer. Try again when it finishes.');
    const provider = this.settings.summaryProvider,
      session = this.get(key);
    const job = (async () => {
      const recap = await summarize(
        session,
        await this.transcript(key),
        provider,
        this.settings,
        this.abort.signal,
      );
      if (this.closed) throw new Error('Service is shutting down');
      const current = this.list().find((s) => s.key === key) || session;
      this.store.put({ ...current, recap });
      this.emit('changed');
      return recap;
    })().finally(() => this.summaryJobs.delete(key));
    this.summaryJobs.set(key, job);
    return job;
  }
  async handle(op: Operation): Promise<any> {
    switch (op.op) {
      case 'transcript':
        return this.transcript(op.key);
      case 'summarize':
        return this.recap(op.key);
      case 'refresh':
        await this.scan();
        return { warnings: this.warnings };
      case 'settings':
        return this.settings;
      case 'detectTerminals':
        return detectTerminals();
      case 'saveSettings': {
        const next = SettingsSchema.parse(op.settings);
        if (!path.isAbsolute(next.codexRoot) || !path.isAbsolute(next.claudeRoot))
          throw new Error('Session directories must be absolute paths.');
        if (next.automatic && !next.summaryProvider)
          throw new Error('Select a provider before enabling automatic recaps.');
        const rootsChanged =
          next.codexRoot !== this.settings.codexRoot ||
          next.claudeRoot !== this.settings.claudeRoot;
        this.settings = next;
        this.store.set('settings', next);
        this.device.name = next.deviceName;
        if (rootsChanged) {
          this.paths.clear();
          this.signatures.clear();
          this.initialized = false;
          this.watchRoots();
        }
        await this.scan();
        this.emit('changed');
        return next;
      }
      case 'resume': {
        const session = this.get(op.key);
        if (op.mode === 'desktop') {
          await launchDesktop(session, this.settings);
          return { opened: true };
        }
        return { terminalId: await this.terminals.start(session, this.settings) };
      }
      case 'terminalAttach':
        return this.terminals.attach(op.terminalId);
      case 'terminalInput':
        this.terminals.input(op.terminalId, op.data);
        return {};
      case 'terminalResize':
        this.terminals.resize(op.terminalId, op.cols, op.rows);
        return {};
      case 'terminalStop':
        this.terminals.stop(op.terminalId);
        return {};
    }
  }
  async close() {
    this.closed = true;
    this.abort.abort();
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    for (const w of this.watchers) w.close();
    this.terminals.close();
    await Promise.allSettled([this.scanJob, ...this.summaryJobs.values()]);
  }
}
