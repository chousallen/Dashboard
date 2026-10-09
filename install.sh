#!/bin/bash
# Install/refresh the Pi Room dashboard on the Pi. Idempotent. Run on the Pi as sallen (sudo rights).
# Assumes the room-devices repo is installed too: its moonlight-stream/pi-player units hand the screen back
# to pi-dashboard.service and its pi-console-keys treats pi-dashboard.service as the idle unit.
set -euo pipefail
cd "$(dirname "$0")"

echo "== packages (cage: one-window kiosk compositor; xwayland: cage exits without it; IBM Plex fonts)"
sudo apt-get install -y --no-install-recommends cage xwayland fonts-ibm-plex

echo "== cog (WPE WebKit kiosk browser): stock jammy 0.12.1 aborts under cage, install the local rebuild"
if ls build/out/cog_0.12.1-1+pi*_arm64.deb >/dev/null 2>&1; then
  sudo apt-get install -y ./build/out/cog_0.12.1-1+pi*_arm64.deb && sudo apt-mark hold cog >/dev/null
else
  echo "   no build/out/cog_*.deb - run build/cog-pi.sh first (takes a few minutes on the Pi)"; exit 1
fi

echo "== files and units"
sudo install -d /usr/local/share/pi-dashboard
sudo install -m644 dashboard/index.html dashboard/style.css dashboard/app.js /usr/local/share/pi-dashboard/
sudo install -m755 bin/pi-dashboard-server /usr/local/bin/
sudo install -m644 systemd/pi-dashboard.service systemd/pi-dashboard-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pi-dashboard-server.service
sudo systemctl disable moonlight.service 2>/dev/null || true     # Moonlight's own GUI stays as a manual fallback
sudo systemctl enable pi-dashboard.service
systemctl is-active pi-dashboard-server pi-dashboard | paste -sd' ' | sed 's/^/server dashboard: /'
echo "done. Show it now (stops a running stream): sudo systemctl start pi-dashboard.service"
