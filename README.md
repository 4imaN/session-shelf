# Session Shelf

A private home for your Claude Code and Codex sessions. Browse past conversations, write brief AI recaps, and resume the original thread on its original computer.

The shared interface runs in a desktop app, a local browser, or a private remote website. Session files are read only. The app keeps its own index and recap cache in SQLite.

Dark mode is the default, with a charcoal palette and warm amber accents. Use the sun/moon button for a quick switch, or choose Light, Dark, or System in Settings. Desktop preferences persist across launches; browser preferences are saved per website origin.

## Run locally

Use **Node.js 22.12 or newer** (Node 22 LTS recommended). Install Claude Code and/or Codex and sign into each tool normally before resuming or generating recaps.

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4317**. Enter the owner key printed in the terminal. Keep this key private: it authorizes reading sessions and controlling coding-tool terminals on connected computers. Login cookies expire after seven days and are invalidated when the service restarts.

The initial scan may take a while for large session histories. Subsequent scans reuse cached file signatures. Changes are watched and reconciled every five seconds. Missing sources appear as notices; configure them in Settings.

The website resumes sessions in a browser terminal. Closing/detaching the terminal view leaves its process running; Reconnect reattaches to it. Another browser taking control disconnects the previous controller. Stop terminal ends the process. Restarting the service ends managed processes; you can resume their saved conversations again.

### Desktop

```sh
npm run build
npx electron-builder install-app-deps
npm run desktop
```

Electron requires native modules built for Electron, while the standalone service requires them built for Node. To switch the same checkout back to web development, run `npm rebuild better-sqlite3 node-pty` first. Separate checkouts avoid rebuilding back and forth.

Desktop Resume opens macOS Terminal, Windows Terminal (PowerShell fallback), or a detected Linux terminal. Set a Linux terminal executable in Settings if detection fails. Desktop login is automatic through a restricted preload bridge.

```sh
npm run package
```

The installer is written to `release/`: DMG on macOS, NSIS installer on Windows, AppImage on Linux. Builds are unsigned unless you supply electron-builder signing credentials. Windows and Linux builds must be built and tested on those platforms; the included GitHub Actions matrix performs native builds when run in your repository.

## Your private remote website

Choose one computer as the **hub**. Install Tailscale on the hub, coding computers, and devices used to access the website. Keep the hub online. Configure Tailscale access controls so only your owner devices can reach this service.

On the hub, use the HTTPS address assigned by Tailscale:

```sh
npm start -- --public-origin https://YOUR-HUB.YOUR-TAILNET.ts.net
```

In another terminal on the hub:

```sh
tailscale serve --bg http://127.0.0.1:4317
```

Follow Tailscale's HTTPS setup prompts if needed. Use **Serve**, not Funnel: this application is intended for a private network, not public hosting. [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve).

Open the HTTPS address from a device on your tailnet, enter the hub's owner key, and choose **Computers → Connect a computer or WSL**. Run the generated command from the Session Shelf installation on the other computer:

```sh
npm start -- --connector --hub https://YOUR-HUB.YOUR-TAILNET.ts.net --pair ONE_TIME_CODE
```

Pairing codes expire after ten minutes and work once. Pairing stores a revocable credential in that connector's app data. Later starts only need:

```sh
npm start -- --connector
```

Connectors initiate outbound authenticated WebSocket connections. The hub never needs an inbound port on coding computers. Remove a computer in the website to revoke its credential and remove its cached sessions; source conversations remain on that computer. A revoked connector must be paired again.

The hub caches titles, project paths, timestamps, previews, and recaps. Full transcripts are fetched when opened. CLI credentials remain on each coding computer. Offline sessions remain browsable in the cache but cannot be resumed until their connector returns.

### Windows and WSL

For the Windows connector ZIP and double-click setup/pairing launchers, follow [WINDOWS-SETUP.md](WINDOWS-SETUP.md). On macOS, rebuild the transfer package with `npm run build && node scripts/package-windows-connector.mjs`. This is a Node-based connector package, not a native Windows installer.

Native Windows runs the same Node service and Electron app. Install a native CLI or provide its executable path in Settings. Standard npm-installed Codex/Claude wrappers are resolved to their Node entrypoint without passing commands through `cmd.exe`.

For WSL, install Node 22 and the relevant CLIs **inside each distribution**, sign in there, and run a separate connector inside that distribution. Pair each with the hub. Its Linux home directory, tool login, and project paths are used directly; Windows and WSL histories stay distinct. A WSL environment appears as `WSL · distribution-name`.

Browser Resume works through that distribution's pseudo-terminal. Desktop Resume for a WSL connector uses Windows Terminal and `wsl.exe`; Windows Terminal must be installed for that route. Native Windows does not silently scan or start every distribution.

## Recaps and settings

Choose **Codex** or **Claude** separately for each computer in Settings. Manual generation is the default. Conversation excerpts are sent to the selected provider and consume that provider's usage, using the tool's existing authentication.

Recaps describe the task, progress, and where to resume. Long conversations use the first 8,000 and last 40,000 characters and are labeled partial. A changed conversation makes a cached recap stale. Recaps are AI-generated aids, not authoritative completion reports.

Automatic mode queues new/changed sessions and waits at least one minute after recorded activity. It does not backfill existing history. Only one recap runs per computer. Failures are not retried repeatedly; use Summarize to retry. Jobs time out after three minutes.

Recap jobs run independently of the original session, in a temporary directory, without session persistence. Codex uses read-only sandboxing, disabled shell/agent tools, and ignored custom config/rules. Claude uses safe mode, no tools, and no MCP servers. Recent CLI versions supporting these switches are required; unsupported flags or login issues produce an error instead of weakening restrictions. Custom Codex provider configurations are not currently supported for recaps because user config is excluded.

Default sources:

| Tool | Source |
| --- | --- |
| Codex | `$CODEX_HOME/sessions` or `~/.codex/sessions` |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects` or `~/.claude/projects` |

Choose absolute source folders and executable paths in Settings. Subagent/sidechain sessions are excluded. Parsing adapters support the observed JSONL layouts and skip unknown records; provider format changes may require adapter updates.

Standalone app data defaults to `~/.session-shelf`. Override with `--data /absolute/path` or `SHELF_DATA_DIR`. Electron uses its platform app-data directory. Do not point multiple running services at the same app-data directory.

## Development and verification

### Desktop terminal preferences

Settings → Desktop terminal detects installed Ghostty, cmux, and Muxy terminals alongside the system launcher and a custom executable option. Unavailable integrations are disabled; Rescan terminals checks again after installation. Your choice is saved per computer and is never silently replaced. Browser resumes continue using the embedded terminal. The selected terminal receives the original project directory and saved session ID; missing integrations report errors rather than silently opening another terminal.

- Muxy: install the CLI through Muxy → Install CLI. The [documented CLI](https://muxy.app/docs/features/muxy-cli) opens the project and runs the resume command in a fresh split; no existing pane receives pasted commands. This adapter requires on-device verification with Muxy installed.

- Ghostty: macOS uses its [AppleScript API](https://ghostty.org/docs/features/applescript), requiring Ghostty 1.3+ and macOS Automation permission. Linux uses its documented [`-e` command arguments](https://ghostty.org/docs/config/reference). Install standalone Ghostty; cmux's bundled compatibility shim is not a standalone Ghostty installation.
- cmux: macOS launches cmux and creates a fresh workspace using `cmux new-workspace --cwd ... --command ...`. The cmux CLI must be installed and its socket accessible. Existing panes are not reused or overwritten.
- Custom: provide an executable and its run-command flag (`-e`, `--`, or `-x`). It must accept the command and each argument separately; terminals requiring a single command string or special IPC need their own adapter.
- Optional tmux: wraps the resume command in a named `tmux new-session -A` session, allowing reconnection. Requires tmux on macOS, Linux, or WSL (not native Windows).

Terminal argument safety, backwards-compatible defaults, and a real custom-launcher subprocess are covered by tests. Ghostty/cmux GUI launch and Windows/Linux runtime behavior still require on-device verification.

```sh
npm test
npm run typecheck
npm run build
```

For live UI work, run `npm run dev` and `npm run dev:ui` in separate terminals, then open `http://127.0.0.1:5173`. The normal login key is printed by the backend. Do not expose Vite to your tailnet. The built website is served by the standalone service.

Tests cover provider parsing, incomplete records, source preservation, stale recaps, safe resume arguments, authentication/origin enforcement, connector enrollment/relay/revocation, offline caching, and terminal controller takeover. Test fixtures use temporary directories and do not launch paid model calls.

The workflow produces native installers on macOS, Windows, and Linux. WSL and real authenticated CLI resume require runtime smoke tests in their respective environments; passing mocked process tests alone does not establish those integrations.

## Architecture

`src/server` contains the SQLite store, provider parsing, indexing engine, process launchers, hub, and connector. `src/shared` defines validated operations and session types. `src/ui` is the shared React interface. `src/electron` is the restricted desktop shell.

Browser clients use authenticated `/api/state`, `/api/operation`, and connector-management endpoints. Operations accept session IDs, not arbitrary terminal commands. Browser terminal traffic uses `/terminal`; connector RPC and terminal output use `/connector`. Servers bind to loopback and validate browser origins and hosts. Tailscale supplies private transport; the owner key supplies application authentication.

No cloud account system, public sharing, web-chat import, session deletion, or cross-computer conversation migration is included.
