# Dashboard – facts for future work

Pi Room idle screen for the Raspberry Pi 4B (Ubuntu Server 22.04, no desktop, DRM/KMS only, one USB keyboard).
Companion repo: `~/room-devices` (Moonlight/Sunshine stream, media player, `pi-console-keys`, audio). Its units
`moonlight-stream.service` / `pi-player.service` start `pi-dashboard.service` in `ExecStopPost`, and
`pi-console-keys` has `MENU = "pi-dashboard.service"`. Only one unit may own DRM: every display unit
`Conflicts=` + `After=` the others (`Conflicts=` alone gives no ordering).

## Units / files
- `pi-dashboard.service` (tty1, `PAMName=login` gives cage a logind seat0 session = DRM master + libinput keyboard as
  `sallen`): `cage -d -- cog --platform=wl http://127.0.0.1:8766/`. cage = one-window wlroots kiosk compositor,
  cog = WPE WebKit kiosk browser as its only client. `Wants=`/`After=pi-dashboard-server.service` (else a cold boot
  can show a refused-connection page; `app.js` also retries every 2 s). `ExecStop` TERMs cog first (cage's child),
  `SuccessExitStatus=ABRT` + `LimitCORE=0` because cage 0.1.4 aborts in its own teardown after the client exits.
- `pi-dashboard-server.service` (always on, no DRM): `bin/pi-dashboard-server`, stdlib Python 3.10, 127.0.0.1:8766.
  Static from `/usr/local/share/pi-dashboard/`, fonts from `/usr/share/fonts-ibm-plex/woff2/`, `/api/status`
  refreshed by a thread every 3 s (`systemctl show moonlight-stream`, `ping -c1 -W1 192.168.0.193`, Sunshine
  `http://192.168.0.193:47989/serverinfo`), `POST /api/stream/start` = `sudo -n systemctl --no-block start
  moonlight-stream.service` (sallen has NOPASSWD sudo). Sends `Cache-Control: no-cache` on everything but fonts:
  WPE caches to `~/.cache/cog` and otherwise keeps an old `app.js` across unit restarts.
- Page: `dashboard/index.html`, `style.css`, `app.js`. Body `data-state` = checking | ready | away | busy | starting |
  failed; background hue follows it. Keycaps (`<kbd data-key>`) light while held. `describe()` maps status to
  sentence/detail/Enter action; `PROBES` + `describe()` + `KEYS` are the three extension points.

## Facts learned (2026-10-09/10)
- `cog --platform=drm` is a dead end on the Pi 4: cog 0.12.1 becomes DRM master and loads the page, but the first
  commit fails ("failed to schedule a page flip: Invalid argument") because its buffer is AR24 with modifier
  `0x700000000000006` (Broadcom tiled; `/sys/kernel/debug/dri/1/framebuffer`), which vc4 cannot scan out
  (meta-webkit #275). `disable-atomic-modesetting` does not help. Nothing reaches the journal unless the unit sets
  `StandardOutput=journal` (`StandardInput=tty` sends stderr to the VT).
- jammy `cage` 0.1.4 needs the `xwayland` package even though nothing uses X: without `/usr/bin/Xwayland` it logs
  "Cannot create XWayland server" and exits before spawning its client (looks like a hang in `wait4` on `(sd-pam)`).
- Stock jammy `cog` 0.12.1 aborts under cage: "listener function for opcode 4 of wl_output is NULL" (wlroots 0.15
  offers wl_output v4, cog's listener has v2 handlers). `build/cog-pi.sh` rebuilds the jammy source package on the
  Pi as `cog 0.12.1-1+pi1` (`apt-mark hold cog`) with `build/cog-patches/`: 0001 = upstream 0.12.3 fix
  (bind wl_output `MIN(2, version)`, dmabuf `MIN(3, version)`), 0002/0003 = explicit `<xkbcommon/xkbcommon.h>` /
  `<stdio.h>` includes (libwpewebkit 2.36 headers no longer pull them in; upstream commit 07defeb). The build needs
  `debhelper`, `libxkbcommon-dev`, the `.orig.tar.xz.asc` next to the dsc, and `PATH=/usr/bin:...` first because a
  pip-installed CMake 4.x in `~/.local` rejects the project.
- Sunshine `/serverinfo` stays `SUNSHINE_SERVER_BUSY` with a `currentgame` id after the Pi client leaves (desktop
  session stays open; Moonlight resumes it), so BUSY is not "another client" and must not block Enter.
- `pi-screen stop` / `systemctl stop moonlight-stream` end with `Result=timeout` or `signal` (Moonlight ignores
  SIGTERM, 5 s, then SIGKILL); only `exit-code` / `core-dump` means the stream failed to start.
- cog 0.12.1 has no device/renderer selector; env vars are only `COG_PLATFORM_DRM_VIDEO_MODE`, `_MODE_MAX`, `_CURSOR`.
- Verified on the monitor 2026-10-10: fonts, R, Enter -> stream, Ctrl+Alt+Shift+Q -> dashboard back by itself,
  Ctrl+Alt+F3/F1. Untested: appearance at boot without a login (both units enabled, `graphical.target`).

## Commands
- State: `systemctl is-active pi-dashboard pi-dashboard-server moonlight-stream`; `curl -s 127.0.0.1:8766/api/status`.
- Logs: `journalctl -u pi-dashboard` (cage + cog), `journalctl -u pi-dashboard-server` ("start stream: ok").
- Show the dashboard (stops a running stream): `sudo systemctl start pi-dashboard`. Old Moonlight GUI: `sudo systemctl start moonlight`.
- Is cage drawing: `sudo cat /sys/kernel/debug/dri/1/framebuffer | grep -E 'allocated|modifier'` shows `cage` with `modifier=0x0`.
