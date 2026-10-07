# Connect your Windows computer to Session Shelf

This package is a Node-based connector, not a Windows desktop installer. It indexes Windows Claude/Codex sessions and connects them to your Mac hub. You browse and resume them from the hub website. Keep both computers awake and the connector running. Windows runtime testing is still required.

## 1. Prepare the Mac hub

Install Tailscale on both computers and sign into the same private network. Do not enable Funnel or expose router ports. See the [Tailscale Serve guide](https://tailscale.com/docs/features/tailscale-serve).

The current Electron app is local-only. Use the standalone hub website for pairing (it has separate settings and pairing credentials from the desktop app). On the Mac, in the Session Shelf project folder, run:

```sh
npm rebuild better-sqlite3 node-pty
npm start -- --public-origin https://YOUR-MAC.YOUR-TAILNET.ts.net
```

Use Node.js 22.12+ for these commands. In a second terminal run:

```sh
tailscale serve --bg http://127.0.0.1:4317
```

Use your actual Tailscale HTTPS hostname, not the placeholder. Follow any HTTPS enablement prompts. Leave the first terminal running. Open the HTTPS address and log in with the owner key printed by the hub. Do not share this owner key with the connector or send it in chat. The desktop app and standalone hub should never use the same data directory concurrently.

## 2. Prepare Windows

1. Install Node.js 22.12 or newer from nodejs.org and Tailscale. Reopen terminals after installation.
2. Install and sign into the coding CLIs you use on Windows. Their existing sessions must live on this Windows computer.
3. Copy `Session-Shelf-Windows-Connector.zip` to Windows. Right-click → Extract All. Keep the extracted folder in a permanent location, such as Documents. Do not run from inside the ZIP.
4. Double-click `Setup.cmd`. It downloads dependencies and installs Windows-native modules; an internet connection is required. No administrator privileges should normally be needed.

If a native dependency cannot download a compatible prebuilt binary, npm may require Python and Visual Studio Build Tools with C++ support. Preserve the setup error for troubleshooting. Never copy the Mac `node_modules` folder to Windows.

## 3. Pair once

1. Open the Mac's HTTPS hub address on Windows to confirm connectivity.
2. On that website choose **Computers → Connect a computer or WSL** to generate a fresh one-time code (expires after ten minutes).
3. Double-click `Pair-Windows.cmd`. Enter the HTTPS hub address and pairing code when prompted.
4. Keep the connector window open. Windows should appear online under Computers. Choose its settings to adjust session folders or the computer name.

Pairing grants the hub access to this computer's indexed sessions and coding-tool terminals. Only pair with your own trusted hub. Credentials are stored under `%USERPROFILE%\.session-shelf`; don't share that folder.

## 4. Reconnect and add a desktop shortcut

After pairing, double-click `Start-Connector.cmd` (no new code needed). Right-click that file → Show more options → Send to → Desktop (create shortcut), or use Create shortcut and move it to the Desktop. Do not move the actual launcher out of its folder.

Closing the connector window or pressing Ctrl+C disconnects Windows and ends terminals managed by that connector. This setup does not install a background service or automatically run at login.

Use the hub's browser Resume button to run the saved session on Windows. For sessions inside WSL, run a separate Linux connector inside that distribution as described in README.md; the Windows connector does not import WSL sessions.

## Troubleshooting

- Cannot open the HTTPS address: verify both computers are online in Tailscale, the Mac hub and Serve are running, and your Tailscale access rules allow the connection.
- Pairing expired: generate a new code and run Pair-Windows.cmd again.
- Windows is offline: run Start-Connector.cmd and inspect its error. Removing Windows in Computers revokes the credential; pair again to restore access.
- No sessions: set the Windows source paths in that computer's Settings. Default folders are `%USERPROFILE%\.codex\sessions` and `%USERPROFILE%\.claude\projects` unless provider environment variables override them.
- CLI not found: install/sign into the CLI on Windows and configure its executable path in Settings.

The repository's GitHub Actions Windows job can build an unsigned desktop `.exe` on a Windows runner. That installer is separate from this connector package and does not automatically pair to your Mac.
