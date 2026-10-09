#!/bin/bash
# Rebuild jammy's cog 0.12.1 (WPE WebKit kiosk browser) on the Pi with build/cog-patches/ applied, as a
# proper .deb (0.12.1-1+piN). Run ON THE PI from a checkout: pi/../build/cog-pi.sh. Output: build/out/cog_*.deb.
# Why: stock 0.12.1 aborts under cage/wlroots 0.15 (wl_output v4), fixed upstream only in 0.12.3+.
set -euo pipefail
export PATH=/usr/bin:/bin:$PATH    # a pip-installed cmake 4.x in ~/.local breaks this CMake 3.x project
cd "$(dirname "$0")"
REV=${PKG_REV:-pi1}
OUT=$PWD/out; WORK=$PWD/out/cog-build
POOL=http://archive.ubuntu.com/ubuntu/pool/universe/c/cog

sudo apt-get install -y --no-install-recommends devscripts debhelper dpkg-dev fakeroot build-essential cmake \
  libcairo-dev libdrm-dev libgbm-dev libinput-dev libwayland-dev libwpebackend-fdo-1.0-dev libwpewebkit-1.0-dev libxkbcommon-dev wayland-protocols

rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"
for f in cog_0.12.1.orig.tar.xz cog_0.12.1.orig.tar.xz.asc cog_0.12.1-1.debian.tar.xz cog_0.12.1-1.dsc; do curl -fsSLO "$POOL/$f"; done
dpkg-source -x cog_0.12.1-1.dsc src >/dev/null
cd src
mkdir -p debian/patches
for p in ../../../cog-patches/*.patch; do
  cp "$p" debian/patches/; echo "$(basename "$p")" >> debian/patches/series
  patch -p1 < "$p"
done
DEBEMAIL=room-devices@localhost DEBFULLNAME=room-devices dch -v "0.12.1-1+$REV" --distribution jammy \
  "Local rebuild: bind wl_output/dmabuf at supported versions (cog 0.12.3 fix) so cog -P wl runs under cage/wlroots 0.15"
dpkg-buildpackage -b -uc -us -nc
mkdir -p "$OUT"; cp ../cog_*.deb "$OUT/"
ls -l "$OUT"/cog_*.deb
echo "install: sudo apt-get install $OUT/cog_0.12.1-1+${REV}_arm64.deb && sudo apt-mark hold cog"
