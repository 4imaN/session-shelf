import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDown,
  ArrowRight,
  Check,
  Command,
  Copy,
  Folder,
  Globe,
  Layers3,
  LogOut,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Sun,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Device,
  Message,
  Operation,
  Session,
  Settings,
  TerminalOption,
} from '../shared/types';
import './style.css';
import './theme.css';
import './layout.css';
import { useTheme, type Theme } from './theme';
declare global {
  interface Window {
    shelfDesktop?: {
      login: () => Promise<string>;
      getTheme: () => Promise<Theme>;
      setTheme: (theme: Theme) => Promise<void>;
    };
  }
}
interface State {
  devices: Device[];
  sessions: Session[];
  warnings: string[];
  localDeviceId: string;
}
async function api<T>(url: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(url, {
    method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const operation = <T,>(deviceId: string, op: Operation) =>
  api<T>('/api/operation', { deviceId, operation: op });
const folderName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd;
function relative(value: string) {
  const delta = Math.max(0, Date.now() - Date.parse(value)),
    minutes = Math.floor(delta / 60000);
  return minutes < 1
    ? 'Just now'
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : minutes < 10080
          ? `${Math.floor(minutes / 1440)}d ago`
          : new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function ToolMark({ provider }: { provider: string }) {
  return (
    <span className={`tool-mark ${provider}`} aria-label={provider}>
      {provider === 'claude' ? <span>✳</span> : <Command size={15} />}
    </span>
  );
}
function App() {
  const { theme, resolved, changeTheme } = useTheme();
  const [auth, setAuth] = useState<boolean | null>(null),
    [key, setKey] = useState(''),
    [error, setError] = useState('');
  const [state, setState] = useState<State>({
    devices: [],
    sessions: [],
    warnings: [],
    localDeviceId: '',
  });
  const [selected, setSelected] = useState(''),
    [query, setQuery] = useState(''),
    [provider, setProvider] = useState('all'),
    [device, setDevice] = useState('all'),
    [project, setProject] = useState('');
  const [tab, setTab] = useState<'recap' | 'conversation'>('recap'),
    [messages, setMessages] = useState<Message[]>([]),
    [loadingTranscript, setLoadingTranscript] = useState(false);
  const [settingsDevice, setSettingsDevice] = useState(''),
    [showComputers, setShowComputers] = useState(false),
    [busy, setBusy] = useState(''),
    [notice, setNotice] = useState('');
  const [terminal, setTerminal] = useState<{ id: string; device: string; title: string } | null>(
      null,
    ),
    [visible, setVisible] = useState(80);
  const search = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const s = await api<State>('/api/state');
    setState(s);
  }, []);
  const login = async (value: string) => {
    try {
      await api('/api/login', { key: value });
      setAuth(true);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void api<{ authenticated: boolean }>('/api/auth')
      .then(async (r) => {
        if (!r.authenticated && window.shelfDesktop) await login(await window.shelfDesktop.login());
        else setAuth(r.authenticated);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!auth) return;
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => void load().catch((e) => setError(e.message)), 5000);
    return () => clearInterval(timer);
  }, [auth, load]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);
  const filtered = useMemo(
    () =>
      state.sessions.filter(
        (s) =>
          (provider === 'all' || s.provider === provider) &&
          (device === 'all' || s.deviceId === device) &&
          (!project || s.cwd === project) &&
          (!query ||
            [s.title, s.cwd, s.preview, s.recap?.text || '']
              .join(' ')
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [state.sessions, provider, device, project, query],
  );
  useEffect(() => {
    setVisible(80);
  }, [query, provider, device, project]);
  const current = state.sessions.find((s) => s.key === selected) || filtered[0];
  const currentDevice = state.devices.find((d) => d.id === current?.deviceId);
  const online = !!currentDevice?.online && !!current?.available;
  const projects = useMemo(
    () =>
      [
        ...new Set(
          state.sessions.filter((s) => device === 'all' || s.deviceId === device).map((s) => s.cwd),
        ),
      ].sort((a, b) => folderName(a).localeCompare(folderName(b))),
    [state.sessions, device],
  );
  useEffect(() => {
    setMessages([]);
    setTab('recap');
  }, [current?.key]);
  useEffect(() => {
    if (tab !== 'conversation' || !current || !online) return;
    let cancelled = false;
    setLoadingTranscript(true);
    void operation<Message[]>(current.deviceId, { op: 'transcript', key: current.key })
      .then((m) => {
        if (!cancelled) setMessages(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingTranscript(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, current?.key, current?.hash, online]);
  const task = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const resume = () =>
    current &&
    task('resume', async () => {
      const mode = window.shelfDesktop ? 'desktop' : 'browser';
      const r = await operation<{ terminalId?: string }>(current.deviceId, {
        op: 'resume',
        key: current.key,
        mode,
      });
      if (r.terminalId)
        setTerminal({ id: r.terminalId, device: current.deviceId, title: current.title });
      else setNotice('Opened the original session in Terminal.');
    });
  if (auth === null)
    return (
      <div className="boot">
        <Logo />
        <p>{error || 'Opening your shelf…'}</p>
      </div>
    );
  if (!auth)
    return (
      <main className="login-page">
        <div className="login-art">
          <div className="large-symbol">↳</div>
          <span className="eyebrow">A LITTLE CONTINUITY</span>
          <h1>
            Good work deserves
            <br />a place to come back to.
          </h1>
          <p>
            Your Claude and Codex conversations.
            <br />
            One quiet place to pick things up.
          </p>
        </div>
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault();
            void login(key);
          }}
        >
          <Logo />
          <h2>Welcome back.</h2>
          <p>Enter the owner key shown by your Session Shelf service.</p>
          <label>
            Owner key
            <input
              autoFocus
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary" type="submit">
            Open my shelf <ArrowRight size={16} />
          </button>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <span className="private-note">
            <span className="dot" /> Your private workspace
          </span>
        </form>
      </main>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <button
          className={`nav-item ${!project ? 'active' : ''}`}
          onClick={() => {
            setProject('');
            setSelected('');
          }}
        >
          <Layers3 size={17} />
          All sessions<span>{state.sessions.length}</span>
        </button>
        <button className="nav-item" onClick={() => setShowComputers(true)}>
          <Monitor size={17} />
          Computers<span>{state.devices.length}</span>
        </button>
        <div className="nav-label projects-label">
          PROJECTS <Folder size={13} />
        </div>
        <div className="projects">
          {projects.slice(0, 100).map((p) => (
            <button
              title={p}
              className={`nav-item ${project === p ? 'active' : ''}`}
              key={p}
              onClick={() => {
                setProject(p);
                setSelected('');
              }}
            >
              <Folder size={15} />
              <span className="project-name">{folderName(p)}</span>
            </button>
          ))}
          {!projects.length && (
            <p className="sidebar-hint">Your projects will appear here when sessions are found.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="dot" />
            {state.devices.filter((d) => d.online).length} computer
            {state.devices.filter((d) => d.online).length !== 1 ? 's' : ''} connected
          </div>
          <button className="nav-item" onClick={() => setSettingsDevice(state.localDeviceId)}>
            <Settings2 size={16} />
            Settings
          </button>
          {!window.shelfDesktop && (
            <button
              className="nav-item"
              onClick={() => void api('/api/logout', {}).then(() => setAuth(false))}
            >
              <LogOut size={16} />
              Lock workspace
            </button>
          )}
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <h1>{project ? folderName(project) : 'Sessions'}</h1>
          <div className="top-actions">
            <button
              className="icon-button"
              title={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
              aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
              onClick={() => changeTheme(resolved === 'dark' ? 'light' : 'dark')}
            >
              {resolved === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() =>
                void task('refresh', async () => {
                  const devices = state.devices.filter((d) => d.online);
                  const results = await Promise.allSettled(
                    devices.map((d) => operation(d.id, { op: 'refresh' })),
                  );
                  await load();
                  const failure = results.find((r) => r.status === 'rejected');
                  if (failure?.status === 'rejected') throw failure.reason;
                })
              }
            >
              <RefreshCw size={15} className={busy === 'refresh' ? 'spin' : ''} />
              Refresh
            </button>
          </div>
        </header>
        {error && (
          <div className="banner error" role="alert">
            {error}
            <button onClick={() => setError('')} aria-label="Dismiss error">
              <X size={15} />
            </button>
          </div>
        )}
        {notice && (
          <div className="banner" role="status">
            {notice}
            <button onClick={() => setNotice('')} aria-label="Dismiss notification">
              <X size={15} />
            </button>
          </div>
        )}
        {state.warnings.length > 0 && (
          <details className="warnings">
            <summary>
              {state.warnings.length} source notice{state.warnings.length !== 1 ? 's' : ''}
            </summary>
            {state.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </details>
        )}
        <div className="toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              ref={search}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected('');
              }}
              placeholder="Search sessions…"
              aria-label="Search sessions"
            />
            <kbd>⌘ K</kbd>
          </div>
          <select
            aria-label="Filter by tool"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setSelected('');
            }}
          >
            <option value="all">All tools</option>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
          <select
            aria-label="Filter by computer"
            value={device}
            onChange={(e) => {
              setDevice(e.target.value);
              setProject('');
              setSelected('');
            }}
          >
            <option value="all">All computers</option>
            {state.devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="results-label">
          <span>
            {filtered.length} session{filtered.length !== 1 ? 's' : ''}
          </span>
          <span>
            Last active <ArrowDown size={12} />
          </span>
        </div>
        <div className="session-layout">
          <section className="session-list" aria-label="Sessions">
            {filtered.slice(0, visible).map((s) => {
              const d = state.devices.find((d) => d.id === s.deviceId);
              return (
                <button
                  key={s.key}
                  className={`session-row ${s.key === current?.key ? 'selected' : ''}`}
                  onClick={() => setSelected(s.key)}
                  aria-pressed={s.key === current?.key}
                >
                  <div className="row-top">
                    <span className="tool-label">
                      <ToolMark provider={s.provider} />
                      {s.provider === 'claude' ? 'Claude Code' : 'Codex'}
                    </span>
                    <time title={new Date(s.updatedAt).toLocaleString()}>
                      {relative(s.updatedAt)}
                    </time>
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.recap?.text || s.preview}</p>
                  <div className="row-bottom">
                    <span>
                      <Folder size={12} />
                      {folderName(s.cwd)}
                    </span>
                    <span className={!d?.online ? 'offline-label' : ''}>
                      {!d?.online ? 'Offline' : ''}
                      {s.key === current?.key && <ArrowRight size={13} />}
                    </span>
                  </div>
                </button>
              );
            })}
            {visible < filtered.length && (
              <button className="load-more" onClick={() => setVisible((v) => v + 80)}>
                Show more sessions
              </button>
            )}
            {!filtered.length && (
              <div className="empty-list">
                <Layers3 size={32} />
                <h3>{query ? 'Nothing on this shelf yet.' : 'A fresh shelf.'}</h3>
                <p>
                  {query
                    ? 'Try another word or clear your filters.'
                    : 'Your saved Claude and Codex sessions will appear here. Check source folders in Settings or connect another computer.'}
                </p>
                <button
                  className="secondary"
                  onClick={() => setSettingsDevice(state.localDeviceId)}
                >
                  Open settings
                </button>
              </div>
            )}
          </section>
          <section className="detail-pane" aria-label="Session details">
            {current ? (
              <>
                <div className="detail-meta">
                  <span className="tool-label">
                    <ToolMark provider={current.provider} />
                    {current.provider === 'claude' ? 'Claude Code' : 'Codex'}
                  </span>
                </div>
                <h2>{current.title}</h2>
                <div className="detail-context">
                  <span>
                    <Folder size={14} />
                    {folderName(current.cwd)}
                  </span>
                  <span>
                    <Monitor size={14} />
                    {currentDevice?.name || 'Unknown computer'}
                  </span>
                </div>
                <div className="tabs">
                  <button
                    className={tab === 'recap' ? 'active' : ''}
                    onClick={() => setTab('recap')}
                  >
                    <Sparkles size={14} />
                    Recap
                  </button>
                  <button
                    className={tab === 'conversation' ? 'active' : ''}
                    onClick={() => setTab('conversation')}
                  >
                    Conversation <span>{current.messageCount}</span>
                  </button>
                </div>
                <div className="detail-content">
                  {tab === 'recap' ? (
                    <>
                      {current.recap ? (
                        <>
                          <div className="recap-top">
                            {current.recap.hash !== current.hash && (
                              <span className="stale">New activity</span>
                            )}
                          </div>
                          <RecapText text={current.recap.text} />
                          <div className="recap-attribution">
                            <Sparkles size={12} />
                            {current.recap.provider === 'claude' ? 'Claude' : 'Codex'} ·{' '}
                            {relative(current.recap.createdAt)}
                            {current.recap.partial ? ' · Partial conversation' : ''}
                          </div>
                        </>
                      ) : (
                        <div className="recap-empty">
                          <h3>No recap yet</h3>
                          <p>Summarize the task, progress, and where to pick up.</p>
                          <span>Choose your recap provider in Settings.</span>
                        </div>
                      )}
                      <button
                        className="summary-button"
                        disabled={!online || !!busy}
                        onClick={() =>
                          void task('summary', async () => {
                            await operation(current.deviceId, {
                              op: 'summarize',
                              key: current.key,
                            });
                            await load();
                          })
                        }
                      >
                        <Sparkles size={15} className={busy === 'summary' ? 'pulse' : ''} />
                        {busy === 'summary'
                          ? 'Writing your recap…'
                          : current.recap
                            ? 'Refresh recap'
                            : 'Summarize session'}
                      </button>
                      <details className="project-info" key={current.key}>
                        <summary>Session details</summary>
                        <span className="eyebrow">WORKING DIRECTORY</span>
                        <code>{current.cwd}</code>
                        <span className="eyebrow">SESSION</span>
                        <code>{current.id}</code>
                        <p>Started {new Date(current.createdAt).toLocaleString()}</p>
                      </details>
                    </>
                  ) : (
                    <div className="transcript">
                      {!online ? (
                        <p>
                          This computer or session source is unavailable. Reconnect to read the
                          conversation.
                        </p>
                      ) : loadingTranscript ? (
                        <p>Loading conversation…</p>
                      ) : (
                        messages.map((m, i) => (
                          <article key={i} className={`message ${m.role}`}>
                            <div>
                              {m.role === 'user'
                                ? 'You'
                                : current.provider === 'claude'
                                  ? 'Claude'
                                  : 'Codex'}
                              <span>{m.timestamp ? relative(m.timestamp) : ''}</span>
                            </div>
                            <pre>{m.text}</pre>
                          </article>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <div className="resume-footer">
                  {!online && (
                    <div>
                      <span className={`dot ${online ? '' : 'offline'}`} />
                      {online
                        ? 'Continue the original conversation'
                        : !current.available
                          ? 'Session file unavailable'
                          : 'Computer offline'}
                    </div>
                  )}
                  <button
                    className="primary"
                    disabled={!online || !!busy}
                    onClick={() => void resume()}
                  >
                    <TerminalSquare size={17} />
                    {busy === 'resume' ? 'Opening…' : 'Resume session'}
                    <ArrowRight size={17} />
                  </button>
                  <p>
                    {window.shelfDesktop
                      ? 'Opens in your selected terminal'
                      : 'Opens a terminal here in your browser'}
                  </p>
                </div>
              </>
            ) : (
              <div className="detail-placeholder">
                <span>↳</span>
                <h2>Your next chapter starts here.</h2>
                <p>Select a session to find your place.</p>
              </div>
            )}
          </section>
        </div>
      </main>
      {settingsDevice && (
        <SettingsDialog
          device={state.devices.find((d) => d.id === settingsDevice)!}
          close={() => setSettingsDevice('')}
          saved={() => void load()}
          theme={theme}
          changeTheme={changeTheme}
        />
      )}
      {showComputers && (
        <ComputersDialog
          state={state}
          close={() => setShowComputers(false)}
          settings={(id) => {
            setShowComputers(false);
            setSettingsDevice(id);
          }}
          refresh={load}
        />
      )}
      {terminal && <BrowserTerminal session={terminal} close={() => setTerminal(null)} />}
    </div>
  );
}
function Logo() {
  return (
    <div className="logo">
      <span className="logo-icon">
        <i />
        <i />
        <i />
      </span>
      <span>
        session<span className="logo-light">shelf</span>
      </span>
    </div>
  );
}
function RecapText({ text }: { text: string }) {
  return (
    <div className="recap-text">
      {text
        .split(/\n+/)
        .filter(Boolean)
        .map((line, i) => {
          const clean = line.replace(/^#{1,4}\s*/, '').replace(/\*\*/g, '');
          const match = clean.match(/^(Task|Progress|Where to resume)\s*:\s*(.*)$/i);
          return match ? (
            <section key={i}>
              <h4>{match[1]}</h4>
              <p>{match[2]}</p>
            </section>
          ) : (
            <p key={i}>{clean}</p>
          );
        })}
    </div>
  );
}
function Modal({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={close}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function SettingsDialog({
  device,
  close,
  saved,
  theme,
  changeTheme,
}: {
  device: Device;
  close: () => void;
  saved: () => void;
  theme: Theme;
  changeTheme: (theme: Theme) => void;
}) {
  const [settings, setSettings] = useState<Settings>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [terminals, setTerminals] = useState<TerminalOption[]>([]);
  const [detecting, setDetecting] = useState(false);
  const detect = useCallback(async () => {
    setDetecting(true);
    try {
      setTerminals(await operation<TerminalOption[]>(device.id, { op: 'detectTerminals' }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDetecting(false);
    }
  }, [device.id]);
  useEffect(() => {
    void detect();
  }, [detect]);
  useEffect(() => {
    void operation<Settings>(device.id, { op: 'settings' })
      .then(setSettings)
      .catch((e) => setError(e.message));
  }, [device.id]);
  const update = (field: keyof Settings, value: unknown) =>
    setSettings((s) => (s ? { ...s, [field]: value } : s));
  return (
    <Modal title="Make it your shelf" close={close}>
      <p className="modal-intro">
        Settings for {device.name} · {device.environment}
      </p>
      <div className="appearance-section">
        <h3>Appearance</h3>
        <p className="field-note">A little more light, or a quieter dark. Saved on this device.</p>
        <div className="theme-options" role="group" aria-label="Color theme">
          {(['light', 'dark', 'system'] as Theme[]).map((option) => (
            <button
              type="button"
              key={option}
              className={theme === option ? 'selected' : ''}
              aria-pressed={theme === option}
              onClick={() => changeTheme(option)}
            >
              {option === 'light' ? (
                <Sun size={17} />
              ) : option === 'dark' ? (
                <Moon size={17} />
              ) : (
                <Monitor size={17} />
              )}
              {option[0].toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {settings ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void operation(device.id, { op: 'saveSettings', settings })
              .then(() => {
                saved();
                close();
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Computer name
            <input
              value={settings.deviceName}
              onChange={(e) => update('deviceName', e.target.value)}
              required
            />
          </label>
          <div className="form-section">
            <Sparkles size={17} />
            <h3>Brief recaps</h3>
          </div>
          <label>
            Write recaps with
            <select
              value={settings.summaryProvider || ''}
              onChange={(e) => update('summaryProvider', e.target.value || null)}
            >
              <option value="">Choose a provider</option>
              <option value="codex">Codex</option>
              <option value="claude">Claude</option>
            </select>
          </label>
          <p className="field-note">
            Conversation excerpts are sent to this provider using the login on this computer and
            consume its model usage.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.automatic}
              onChange={(e) => update('automatic', e.target.checked)}
            />
            Automatically recap new activity
          </label>
          <p className="field-note">
            Waits one minute after activity. Existing history is summarized when you ask.
          </p>
          <div className="form-section">
            <Folder size={17} />
            <h3>Session folders</h3>
          </div>
          <label>
            Codex sessions
            <input
              value={settings.codexRoot}
              onChange={(e) => update('codexRoot', e.target.value)}
              required
            />
          </label>
          <label>
            Claude projects
            <input
              value={settings.claudeRoot}
              onChange={(e) => update('claudeRoot', e.target.value)}
              required
            />
          </label>
          <div className="form-section">
            <Monitor size={17} />
            <h3>Desktop terminal</h3>
          </div>
          <label>
            Open sessions with
            <select
              value={settings.desktopTerminal || 'system'}
              onChange={(e) => update('desktopTerminal', e.target.value)}
            >
              {!terminals.length && (
                <option value={settings.desktopTerminal}>
                  {settings.desktopTerminal} · checking installed terminals…
                </option>
              )}
              {terminals.map((t) => (
                <option key={t.id} value={t.id} disabled={!t.available}>
                  {t.name}
                  {t.available ? '' : ' · unavailable'}
                </option>
              ))}
            </select>
          </label>
          <p className="field-note">
            {terminals.find((t) => t.id === settings.desktopTerminal)?.detail}
          </p>
          <button
            type="button"
            className="secondary"
            disabled={detecting}
            onClick={() => void detect()}
          >
            {detecting ? 'Checking…' : 'Rescan terminals'}
          </button>
          <p className="field-note">
            Used by the desktop app on this computer. Website sessions open in the browser.
          </p>
          {settings.desktopTerminal === 'custom' && (
            <>
              <label>
                Terminal executable
                <input
                  value={settings.terminalExecutable}
                  placeholder="/path/to/terminal"
                  onChange={(e) => update('terminalExecutable', e.target.value)}
                  required
                />
              </label>
              <label>
                Run-command flag
                <select
                  value={settings.terminalFlag || '-e'}
                  onChange={(e) => update('terminalFlag', e.target.value)}
                >
                  <option value="-e">-e</option>
                  <option value="--">--</option>
                  <option value="-x">-x</option>
                </select>
              </label>
              <p className="field-note">
                Requires a terminal that accepts an executable and separate arguments after this
                flag.
              </p>
            </>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.useTmux || false}
              onChange={(e) => update('useTmux', e.target.checked)}
            />
            Run inside tmux
          </label>
          <p className="field-note">
            Requires tmux on macOS, Linux, or WSL. Reconnects to the same named tmux session.
          </p>
          <details className="advanced">
            <summary>CLI executable paths</summary>
            <label>
              Codex
              <input
                value={settings.codexExecutable}
                onChange={(e) => update('codexExecutable', e.target.value)}
                required
              />
            </label>
            <label>
              Claude
              <input
                value={settings.claudeExecutable}
                onChange={(e) => update('claudeExecutable', e.target.value)}
                required
              />
            </label>
          </details>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save settings'}
              <Check size={16} />
            </button>
          </div>
        </form>
      ) : (
        !error && <p>Loading settings…</p>
      )}
    </Modal>
  );
}
function ComputersDialog({
  state,
  close,
  settings,
  refresh,
}: {
  state: State;
  close: () => void;
  settings: (id: string) => void;
  refresh: () => Promise<void>;
}) {
  const [pair, setPair] = useState<{ code: string; hubUrl: string; expiresAt: string }>(),
    [error, setError] = useState(''),
    [copied, setCopied] = useState(false);
  return (
    <Modal title="Your connected computers" close={close}>
      <p className="modal-intro">Your sessions stay on the computer where they started.</p>
      {state.devices.map((d) => (
        <div className="computer-row" key={d.id}>
          <span className="computer-icon">
            <Monitor size={22} />
          </span>
          <div>
            <strong>{d.name}</strong>
            <small>
              <span className={`dot ${d.online ? '' : 'offline'}`} />
              {d.environment} · {d.online ? 'Online' : 'Offline'}
              {d.local ? ' · This computer' : ''}
            </small>
          </div>
          <button
            title="Computer settings"
            className="icon-button"
            disabled={!d.online}
            onClick={() => settings(d.id)}
          >
            <Settings2 size={16} />
          </button>
          {!d.local && (
            <button
              title="Remove computer"
              className="icon-button"
              onClick={() => {
                if (confirm(`Disconnect ${d.name}? Its local sessions will remain intact.`))
                  void api(`/api/connectors/${d.id}`, undefined, 'DELETE')
                    .then(refresh)
                    .catch((e) => setError(e.message));
              }}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      ))}
      <button
        className="secondary add-computer"
        onClick={() =>
          void api<typeof pair>('/api/pairing', {})
            .then(setPair)
            .catch((e) => setError(e.message))
        }
      >
        <Plus size={16} />
        Connect a computer or WSL
      </button>
      {pair && (
        <div className="pairing">
          <h3>Run on the other computer</h3>
          <p>
            From its Session Shelf installation, run this command. The code expires in ten minutes.
          </p>
          <code>
            npm start -- --connector --hub {pair.hubUrl} --pair {pair.code}
          </code>
          <button
            className="secondary"
            onClick={() =>
              void navigator.clipboard
                .writeText(`npm start -- --connector --hub ${pair.hubUrl} --pair ${pair.code}`)
                .then(() => setCopied(true))
                .catch(() => setError('Clipboard unavailable. Select and copy the command.'))
            }
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy command'}
          </button>
          {pair.hubUrl.startsWith('http:') && (
            <p className="field-note">
              This hub is local-only. For another computer, restart it with your Tailscale HTTPS
              address using --public-origin, then create a new code.
            </p>
          )}
          <p className="field-note">
            For WSL, run a connector inside each distribution you want to add.
          </p>
        </div>
      )}
      <div className="help-note">
        <Globe size={17} />
        <p>
          Remote access uses your private Tailscale network. Keep the hub and connectors running to
          resume from anywhere.
        </p>
      </div>
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}
function BrowserTerminal({
  session,
  close,
}: {
  session: { id: string; device: string; title: string };
  close: () => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    [status, setStatus] = useState('Connecting…'),
    [retry, setRetry] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    let dispose = () => {},
      cancelled = false;
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      await import('@xterm/xterm/css/xterm.css');
      if (cancelled || !container.current) return;
      const term = new Terminal({
          cursorBlink: true,
          fontSize: 13,
          fontFamily: '"SFMono-Regular", Consolas, monospace',
          theme: { background: '#191d1b', foreground: '#eceee9' },
        }),
        fit = new FitAddon();
      term.loadAddon(fit);
      term.open(container.current);
      fit.fit();
      let ready = false;
      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/terminal?device=${encodeURIComponent(session.device)}&id=${session.id}`,
      );
      const send = (m: unknown) => {
        if (ws.readyState === WebSocket.OPEN && ready) ws.send(JSON.stringify(m));
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'attached') {
          term.reset();
          term.write(m.buffer || '');
          ready = true;
          setStatus(m.exited ? `Exited (${m.code})` : 'Connected');
          send({ type: 'resize', cols: term.cols, rows: term.rows });
          term.focus();
        } else if (m.type === 'output' && ready) term.write(m.data);
        else if (m.type === 'exit') setStatus(`Exited (${m.code})`);
        else if (m.type === 'error') setError(m.error);
      };
      ws.onclose = (e) => {
        setStatus(
          e.code === 1000 && e.reason ? e.reason : 'Disconnected · session remains on its computer',
        );
      };
      ws.onerror = () => setError('Connection failed. Check the computer and your login.');
      const input = term.onData((data) => send({ type: 'input', data }));
      const observer = new ResizeObserver(() => {
        fit.fit();
        send({ type: 'resize', cols: term.cols, rows: term.rows });
      });
      observer.observe(container.current);
      dispose = () => {
        ws.close();
        observer.disconnect();
        input.dispose();
        term.dispose();
      };
    })().catch((e) => setError(e.message));
    return () => {
      cancelled = true;
      dispose();
    };
  }, [session.id, session.device, retry]);
  return (
    <Modal title="Continue your session" close={close} wide>
      <div className="terminal-heading">
        <span>{session.title}</span>
        <small>{status}</small>
      </div>
      <div className="terminal-container" ref={container} />
      {error && <p className="error-text">{error}</p>}
      <div className="terminal-actions">
        <p>Closing this window keeps the terminal running.</p>
        <button
          className="secondary"
          onClick={() => {
            setError('');
            setRetry((r) => r + 1);
          }}
        >
          Reconnect
        </button>
        <button
          className="secondary"
          onClick={() => {
            if (confirm('Stop the running terminal? You can resume its saved conversation later.'))
              void operation(session.device, { op: 'terminalStop', terminalId: session.id })
                .then(close)
                .catch((e) => setError(e.message));
          }}
        >
          Stop terminal
        </button>
        <button className="primary" onClick={close}>
          Detach
        </button>
      </div>
    </Modal>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
