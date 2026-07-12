# Hacker's Lair

A frameless Windows desktop console for managing your coding projects. Its local
Node service stays hidden in the background, while Electron provides a custom
in-app titlebar, window controls, and scrolling—there is no external browser or
Windows title strip around the console. Three views:

- **Projects** — every project in your `/Code` folder, showing whether it's
  running, with **one Start/Stop button per project** that brings up (or takes
  down) *all* of its components — frontend *and* backend — at once. If a
  component crashes on startup, its row turns red with **errored** and the actual
  error message, plus a "full log" link — so you can see exactly which side
  (front or back) failed and why. Each start is logged to `logs/<project>--<component>.log`.
- **Port Signals** — everything listening on a localhost port, with friendly labels
  for dev servers, one-click Stop, and a Start button to relaunch things you
  stopped.
- **Scripts** — starts and stops the AutoIt macros configured in `scripts.json`.

Windows 11 only. The local service uses `netstat`, `tasklist`, and `taskkill`;
the desktop host uses Electron; managed project UIs open in Firefox.

All clickable localhost ports are opened explicitly in **Firefox**, regardless
of the Hacker's Lair desktop host or the Windows default-browser setting. Set
`FIREFOX_PATH` only if Firefox is installed
outside its standard Windows location.

## Install (recommended)

Run once to register it with Windows:

```
powershell -ExecutionPolicy Bypass -File install.ps1
```

Then press the **Windows key**, type **Hacker's Lair**, and hit Enter — or use
the Desktop icon. It starts the server silently (no console window) and opens a
maximized frameless app window. It also **auto-starts the service in the
background when you log in**, so later launches appear immediately. Closing the
app window does not stop the service.

Remove the shortcuts with `uninstall.ps1`. Re-run `install.ps1` if you move this folder.

## Run manually (alternative)

```
npm start
```

This starts the hidden service if needed and opens the desktop window. For
server-only debugging, use `npm run server`; the local UI remains available at
`http://localhost:4949`.

## Projects config

`projects.json` defines each project and its components:

```json
{
  "name": "incident-sim",
  "type": "Node monorepo",
  "components": [
    { "name": "backend",  "role": "backend",  "cwd": "...\\incident-sim\\backend",  "command": "npm run dev", "port": 4000, "match": "...\\incident-sim\\backend" },
    { "name": "frontend", "role": "frontend", "cwd": "...\\incident-sim\\frontend", "command": "npm run dev", "port": 5173, "match": "...\\incident-sim\\frontend" }
  ]
}
```

- `command` is run in `cwd` to start the component (detached, hidden).
- `match` is a substring searched in running processes' command lines to detect
  whether the component is up and to stop it — usually the component's folder
  path, or a distinctive token (e.g. `facefusion.py`) when the path isn't in the
  command line. Matching on the command line (not the port) means several apps
  that default to the same port (e.g. many Next.js apps on :3000) are still told
  apart correctly.
- The server re-reads this file on every request, so edits apply immediately.

Agents working in `/Code` are told (via `../AGENTS.md`) to keep this file in sync
when a project's port or start command changes.

## Files

| File | Purpose |
|---|---|
| `server.js` | Local HTTP service + all APIs (no dependencies) |
| `desktop.js` / `preload.js` | Frameless desktop window + restricted window-control bridge |
| `public/index.html` | The Lair Console UI (Targets + Port Signals + Scripts) |
| `projects.json` | Your projects and how to start/detect them |
| `launcher.vbs` | Silent service launcher + standalone app-window launcher (`boot` = service only) |
| `install.ps1` / `uninstall.ps1` | Register/remove shortcuts + auto-start |
| `make-icon.ps1` / `icon.ico` | App icon |
| `package.json` / `package-lock.json` | Electron desktop dependency and pinned install |
| `stopped.json` | Remembers processes you stopped so they can be restarted |
