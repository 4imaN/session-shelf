# Verification

Checked locally on macOS ARM64 with Node 22.23.2.

- 19 automated tests pass: both log formats, duplicate events, incomplete/corrupt records, source preservation, missing-file recovery, stale recap hashes, settings validation, executable discovery, shell quoting, real summary subprocesses, real pseudo-terminal resume/input/resize, authentication, origin checks, pairing/relay/revocation, offline caching, and controller takeover.
- Production TypeScript and Vite builds pass.
- Dependency audit reports zero vulnerabilities.
- Browser checks cover login, session list, search, transcript display, settings persistence, pairing-code creation, narrow-screen layout, and theme persistence across reloads.
- Desktop startup and automatic authentication were checked against local history: 662 sessions discovered without modifying source logs.
- The reported Claude launcher failure is covered by a regression test. Discovery skips the non-executable Node 22 placeholder and selects the working Node 20 Claude binary. Its `--version` check succeeds.
- An unsigned ARM64 macOS DMG is generated under `release/`.
- The final packaged app launches successfully, authenticates automatically, displays the session list, and loads the dark theme and persistent desktop preference bridge.
- The isolated native smoke check (`node scripts/smoke-desktop.mjs`) confirms that the final packaged app opens its window and shuts down cleanly on request.

Not executed here: Windows/Linux installer runs, WSL runtime smoke tests, a real multi-computer Tailscale deployment, and paid/live-provider recap calls. The connector and terminal integration tests run on loopback using isolated fixtures and real local subprocesses. GitHub Actions contains native build/test jobs for macOS, Windows, and Linux; those jobs have not been run remotely from this workspace.
