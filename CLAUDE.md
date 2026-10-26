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
- Idle: after `IDLE_MS` (`app.js`) without a key, or at once on the B key, the page POSTs `/api/blank`; the server starts
  `pi-dashboard-blank.service` (root), which `Conflicts=` the display units (so cage stops first, and a stream or
  player start stops the watcher; it is deliberately absent from pi-dashboard's `After=`, a mutual `After=` makes
  `systemctl restart pi-dashboard` fail with "Transaction order is cyclic"). The script opens `/dev/dri/card1`,
  `drmSetMaster`, `drmModeSetCrtc(fd, crtc, 0, 0, 0, NULL, 0, NULL)` on every CRTC (libdrm via ctypes), and keeps
  the fd open while it waits for the first `EV_KEY` press on any `/dev/input/event*` (raw evdev, same loop as
  `pi-console-keys`); then closes the fd (fbcon takes the display back) and `systemctl --no-block start pi-dashboard`.
  The wake key goes to the empty console (getty@tty1 is masked), not to the page. If `/api/blank` fails, the page
  goes black by itself (body class `blank`) and a capture-phase keydown listener wakes it, swallowing that key.
- Why DRM master and not a console blank: `setterm --blank force` on tty1 (with cage stopped) does give DPMS off, but
  the ASUS VY229HE drops its hotplug line ~7 s into standby; the kernel logs "status updated from connected to
  disconnected" and `drm_fb_helper_hotplug_event` re-probes and re-enables the output, so the console came back by
  itself (seen 2026-10-10 with `drm.debug=0x4`). The fbdev helper skips that restore while another process holds DRM
  master. `video=HDMI-A-1:...D` does not prevent the event, and Ubuntu's 5.15 raspi `vc4.ko` has no `force_hotplug`
  parameter (only `tv_norm`, `fkms_max_refresh_rate`).
- Dead ends for monitor off: cage 0.1.4 has no idle/blank flag (getopt `dhm:rsv`) and no
  `wlr-output-power-management` (so `wlopm` cannot work; it does offer `org_kde_kwin_idle`); `vcgencmd display_power`
  only works under fkms, not the full `vc4-kms-v3d` driver used here; a console blank while cage is DRM master does
  nothing (`dpms` stays `On`). `systemctl stop moonlight-stream pi-dashboard` in one command fails with
  "Transaction order is cyclic" (the stream's `ExecStopPost` starts the dashboard); stop them one at a time.

- Ctrl+Alt+F3..F6 on the dashboard (`pi-console-keys`, ~/room-devices) shows a Pi console while cage + cog keep running
  on tty1 (logind moves DRM master); Ctrl+Alt+F1 returns to the same page. While a console is in front the page gets
  no keys, so `/api/blank` answers 409 unless `/sys/class/tty/tty0/active` is `tty1`, and `app.js` then restarts its
  idle timer instead of going black.

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

## Outside data (2026-10-23)
- CWA key: `~/.config/pi-dashboard/cwa.key`. `F-D0047-061` (Taipei districts, 3 days) with `LocationName=大安區`:
  path `records.Locations[0].Location[0].WeatherElement[]`, `ElementName` in Chinese (`溫度` hourly `DataTime`,
  `3小時降雨機率` / `天氣現象` with `StartTime`/`EndTime`), values are strings. Station `A0A010` 臺灣大學 (0.8 km) is in
  both `O-A0001-001` (`WeatherElement.AirTemperature`) and `O-A0002-001` (`RainfallElement.Now` = since midnight,
  `Past1hr`, ...); `-99` = no data.
- Radar: `https://www.cwa.gov.tw/Data/radar/CV1_TW_3600_YYYYMMDDHHMM.png` (10-min frames, past hour fetchable, no
  key); newest time from `cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-A0058-003.json`. 3600x3600,
  lon 118-124, lat 20.5-26.5, linear (600 px/degree, checked against the Wufenshan radar dot). ffmpeg crops it (no
  PIL on the Pi). Surface map: `https://www.cwa.gov.tw/Data/fcst_img/SFCcombo.jpg` (728x531, `Last-Modified` = upload,
  the analysis time is only printed on the image).
- YouBike: `tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json`, flat array, `sno` 500101031 =
  臺大男七舍前; fields `available_rent_bikes`, `available_return_bikes`, `Quantity`, `mday`. At 04:2x on 2026-10-23 it
  reported 0 bikes and 0 docks for all 1822 stations (feed-side, not ours).

## Commands
- State: `systemctl is-active pi-dashboard pi-dashboard-server moonlight-stream`; `curl -s 127.0.0.1:8766/api/status`.
- Logs: `journalctl -u pi-dashboard` (cage + cog), `journalctl -u pi-dashboard-server` ("start stream: ok", "feed
  radar: ...", "alarm 07:30: ringing").
- Screenshot of the monitor (cage offers screencopy): `XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 grim
  -s 0.5 out.png`. The page must be reloaded to pick up new files: `sudo systemctl restart pi-dashboard`.
- Test an alarm without noise: runtime drop-in `/run/systemd/system/pi-dashboard-server.service.d/x.conf` with
  `Environment=PI_DASHBOARD_ALARM_SOUND=<silent.wav>`, daemon-reload, restart the server, `pi-alarm test`; remove it after.
  The server needs `XDG_RUNTIME_DIR=/run/user/1000` (in its unit) for paplay to reach sallen's PipeWire.
- Show the dashboard (stops a running stream): `sudo systemctl start pi-dashboard`. Old Moonlight GUI: `sudo systemctl start moonlight`.
- Is cage drawing: `sudo cat /sys/kernel/debug/dri/1/framebuffer | grep -E 'allocated|modifier'` shows `cage` with `modifier=0x0`.
- Monitor state: `cat /sys/class/drm/card1-HDMI-A-1/enabled` (`disabled` while pi-dashboard-blank is active) and
  `dpms`. DRM debug: `echo 0x4 | sudo tee /sys/module/drm/parameters/debug` (KMS; hotplug shows in `journalctl -k`),
  `echo 0` to turn it off. To test the
  wake without touching the keyboard there is no `evemu` on the Pi; a stdlib uinput script works (open `/dev/uinput`,
  ioctl `0x40045564` EV_KEY, `0x40045565` key, write `struct uinput_user_dev` = `80sHHHHi` + 1024 zero bytes, ioctl
  `0x5501`, sleep 3 s for the watcher's rescan, write `llHHi` key events, ioctl `0x5502`).
