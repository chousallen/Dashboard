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
                               POST /api/blank          sudo systemctl --no-block start pi-dashboard-blank
                               GET /img/radar0..5, /img/surface   cached CWA images
                               GET/POST/DELETE /api/alarms, POST /api/alarm/stop|test, POST /api/prefs
bin/pi-alarm                   command-line client for the alarms
pi-dashboard-blank.service     stops cage, holds DRM master with the CRTCs off (monitor asleep), any key -> pi-dashboard
```

What it shows: the background colour is the state (pine green = laptop ready, umber = laptop away,
slate = starting / error), one large sentence, one keycap. Keys: **Enter** starts or resumes the
laptop stream, **R** checks again. While the stream runs, **Ctrl+Alt+Shift+Q** on the Pi keyboard
quits it and the dashboard comes back by itself. After 10 minutes without a key the monitor is switched
off; any key brings the dashboard back (that key does nothing else). **Ctrl+Alt+F3** text console, **Ctrl+Alt+F1**
dashboard (handled by `pi-console-keys` from the room-devices repo, not by the page).

Panels (each one shown or hidden with its key; the choice survives restarts):
**W** weather (CWA forecast for Da'an District, rain chance per 3 hours; temperature and rain measured at the
NTU station), **E** radar echo (last hour, 10-minute steps, northern Taiwan, dot = Xuefu Village), **S** surface
weather map, **Y** YouBike at NTU 7th Men's Dorm. With every panel hidden the page looks as before.

Alarms: **A** opens the list (arrows choose, Enter changes or adds, Space on/off, Delete removes, Esc closes).
From a shell: `pi-alarm`, `pi-alarm add 07:30 weekdays`, `pi-alarm off 1`, `pi-alarm rm 1`, `pi-alarm stop`,
`pi-alarm test` (rings now). A ringing alarm plays on the 3.5 mm speaker, switches the monitor back on (unless the
stream or the player is using it), and stops on any key or after 10 minutes.

## Install

On the Pi: `build/cog-pi.sh` once (rebuilds Ubuntu's `cog` browser with three small patches, see
`build/cog-patches/`), then `./install.sh`. The weather panel needs a CWA (Central Weather Administration)
open-data key in `~/.config/pi-dashboard/cwa.key` (one line, mode 600, never in git). The room-devices repo must be installed as well: its
`moonlight-stream.service` / `pi-player.service` hand the screen back to `pi-dashboard.service`,
and its `pi-console-keys` treats the dashboard as the idle unit.

Preview on any machine: `PI_DASHBOARD_MOCK=ready PI_DASHBOARD_DIR=dashboard bin/pi-dashboard-server`
then open http://127.0.0.1:8766/ (`MOCK` = ready | busy | nosunshine | away | failed).

## Extend

One probe function registered in `PROBES` (`bin/pi-dashboard-server`), one branch in `describe()`
and one entry in `KEYS` (`dashboard/app.js`). Keep every action as a keycap plus a verb phrase.

## Layout

- `dashboard/` – the page. `bin/pi-dashboard-server` – stdlib Python backend. `bin/pi-dashboard-blank` – monitor-off
  watcher. `systemd/` – the three units.
- `build/cog-pi.sh`, `build/cog-patches/` – rebuild of `cog` 0.12.1 for jammy (`build/out/` is not committed).
