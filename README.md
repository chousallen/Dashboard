# Dashboard – Pi Room idle screen

A keyboard-driven status page shown full-screen on the room monitor by the Raspberry Pi when
nothing else (the laptop stream, the media player) owns the display. One viewer, couch distance,
one USB keyboard plugged into the Pi, no mouse.

```
pi-dashboard.service  (tty1)   cage ── cog --platform=wl ──► http://127.0.0.1:8766/
pi-dashboard-server.service    python3 bin/pi-dashboard-server
                               GET /            dashboard/index.html, style.css, app.js
                               GET /fonts/..    IBM Plex (fonts-ibm-plex, served locally)
                               GET /api/status  stream unit state, laptop ping, Sunshine state
                               POST /api/stream/start   sudo systemctl --no-block start moonlight-stream
```

What it shows: the background colour is the state (pine green = laptop ready, umber = laptop away,
slate = starting / error), one large sentence, one keycap. Keys: **Enter** starts or resumes the
laptop stream, **R** checks again. While the stream runs, **Ctrl+Alt+Shift+Q** on the Pi keyboard
quits it and the dashboard comes back by itself. **Ctrl+Alt+F3** text console, **Ctrl+Alt+F1**
dashboard (handled by `pi-console-keys` from the room-devices repo, not by the page).

## Install

On the Pi: `build/cog-pi.sh` once (rebuilds Ubuntu's `cog` browser with three small patches, see
`build/cog-patches/`), then `./install.sh`. The room-devices repo must be installed as well: its
`moonlight-stream.service` / `pi-player.service` hand the screen back to `pi-dashboard.service`,
and its `pi-console-keys` treats the dashboard as the idle unit.

Preview on any machine: `PI_DASHBOARD_MOCK=ready PI_DASHBOARD_DIR=dashboard bin/pi-dashboard-server`
then open http://127.0.0.1:8766/ (`MOCK` = ready | busy | nosunshine | away | failed).

## Extend

One probe function registered in `PROBES` (`bin/pi-dashboard-server`), one branch in `describe()`
and one entry in `KEYS` (`dashboard/app.js`). Keep every action as a keycap plus a verb phrase.

## Layout

- `dashboard/` – the page. `bin/pi-dashboard-server` – stdlib Python backend. `systemd/` – the two units.
- `build/cog-pi.sh`, `build/cog-patches/` – rebuild of `cog` 0.12.1 for jammy (`build/out/` is not committed).
