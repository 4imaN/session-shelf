import Database from 'better-sqlite3';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import type { Session } from '../shared/types';
export class Store {
  db: Database.Database;
  constructor(public directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new Database(path.join(directory, 'shelf.sqlite'));
    try {
      chmodSync(path.join(directory, 'shelf.sqlite'), 0o600);
    } catch {}
    this.db.pragma('journal_mode = WAL');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, device TEXT NOT NULL, value TEXT NOT NULL)',
    );
  }
  get<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key) as
      { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  set(key: string, value: unknown) {
    this.db.prepare('INSERT OR REPLACE INTO kv VALUES (?, ?)').run(key, JSON.stringify(value));
  }
  sessions(): Session[] {
    return (this.db.prepare('SELECT value FROM sessions').all() as { value: string }[]).map((r) =>
      JSON.parse(r.value),
    );
  }
  put(session: Session) {
    this.db
      .prepare('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)')
      .run(session.key, session.deviceId, JSON.stringify(session));
  }
  removeDevice(device: string) {
    this.db.prepare('DELETE FROM sessions WHERE device=?').run(device);
  }
  replaceDevice(device: string, sessions: Session[]) {
    this.db.transaction(() => {
      this.removeDevice(device);
      for (const s of sessions) this.put(s);
    })();
  }
  close() {
    this.db.close();
  }
}
