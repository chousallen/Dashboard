// Pi Room idle screen: polls /api/status and maps it to one of the states below.
// Keys: Enter = start the stream (or check again when it cannot start), R = check again, B = monitor off now,
// W / E / S / Y = show or hide the weather, radar echo, surface map and YouBike panels (choice kept by the server),
// A = alarm list (its own keys while open). While an alarm rings, any key stops it and does nothing else.
// After IDLE_MS without a key the page asks the server to switch the monitor off (pi-dashboard-blank.service
// replaces this browser; any key starts it again). If the server cannot be reached the page goes black itself
// instead, and then the next key only wakes it (it is not acted on).
// Ctrl+Alt+Fx is handled outside the browser by pi-console-keys.
"use strict";

const POLL_MS = 3000;      // normal refresh
const RETRY_MS = 2000;     // while the server is unreachable (boot, server restart)
const LAPTOP = "192.168.0.193";
const IDLE_MS = 10 * 60 * 1000;   // switch the monitor off after this long without a key

const el = {
  body: document.body,
  state: document.getElementById("state"),
  detail: document.getElementById("detail"),
  action: document.getElementById("action"),
  actionLabel: document.getElementById("action-label"),
  note: document.getElementById("note"),
  clock: document.getElementById("clock"),
  pi: document.getElementById("pi"),
  nextAlarm: document.getElementById("next-alarm"),
};
const $ = (id) => document.getElementById(id);

const PANELS = ["weather", "radar", "surface", "youbike"];
const REPEATS = { once: "Once", daily: "Every day", weekdays: "Mon–Fri", weekends: "Sat–Sun" };
const RADAR_STEP_MS = 700;       // radar loop: time per frame; the newest frame stays 3 steps

let status = null;        // last /api/status payload
let starting = false;     // Enter was pressed; waiting for systemd to take the screen
let pollTimer = null;
let checkedAt = null;     // time of the last manual check (R or Enter while it cannot start)
let blank = false;        // page-side black screen (fallback when /api/blank failed); polling continues underneath
let idleTimer = null;
let hidden = null;        // panels the viewer hid; read once from the server's prefs, then owned by the page
let sheet = null;         // alarm list while open: { sel: row index, edit: null | { id, h, m, repeat, field } }
let radarFrames = [];
let radarIdx = 0;
let radarTimer = null;

function checkedNote() {
  return checkedAt ? " Checked at " + checkedAt + "." : "";
}

// ---- states ---------------------------------------------------------------
// Each state: the sentence, the second line, what Enter does ("start" | "check" | null).

function describe(s) {
  if (starting) {
    return { key: "starting", h: "Starting the stream", d: "The monitor switches to the laptop in a moment.", enter: null };
  }
  if (!s) {
    return { key: "checking", h: "Checking the laptop", d: "One moment.", enter: null };
  }
  if (s.stream && s.stream.active === "active") {
    return { key: "starting", h: "Stream is running", d: "This screen should be gone. Press Enter if it stays.", enter: "start" };
  }
  if (s.stream && s.stream.failed) {
    const when = s.stream.exited_at ? " at " + s.stream.exited_at : "";
    return {
      key: "failed",
      h: "The stream could not start",
      d: "Moonlight exited with " + s.stream.result + " (status " + s.stream.status + ")" + when + ". Press Enter to try again.",
      enter: "start",
    };
  }
  if (!s.laptop) {
    return { key: "away", h: "Laptop is away", d: "No answer from " + LAPTOP + ". Wake it, or join the router's Wi-Fi." + checkedNote(), enter: "check" };
  }
  if (!s.sunshine) {
    return { key: "away", h: "Laptop is here, Sunshine is not", d: "The laptop answers in " + s.laptop.rtt_ms + " ms, but Sunshine on port 47989 does not. Start it there, then press Enter.", enter: "check" };
  }
  if (s.sunshine.state && s.sunshine.state.endsWith("BUSY")) {
    // Sunshine keeps the desktop session open after a client leaves; Moonlight simply resumes it.
    return { key: "ready", h: "Laptop is ready", d: "Sunshine on " + (s.sunshine.hostname || LAPTOP) + " has a session open, " + s.laptop.rtt_ms + " ms away. Enter resumes it." + checkedNote(), enter: "start" };
  }
  return { key: "ready", h: "Laptop is ready", d: "Sunshine answers on " + (s.sunshine.hostname || LAPTOP) + ", " + s.laptop.rtt_ms + " ms away." + checkedNote(), enter: "start" };
}

function render() {
  const v = describe(status);
  el.body.dataset.state = v.key;
  el.state.textContent = v.h;
  el.detail.textContent = v.d;
  el.action.hidden = !v.enter;
  el.note.hidden = v.enter !== "start";
  el.actionLabel.textContent = v.enter === "start" ? "Start the stream" : "Check again";
  if (status && status.pi) {
    el.pi.textContent = status.pi.hostname + "  " + status.pi.ip;
  }
  if (!status) return;
  if (hidden === null && status.prefs) { hidden = new Set(status.prefs.hidden); applyPanels(); }
  renderWeather(status.weather);
  renderYoubike(status.youbike);
  renderRadar(status.radar);
  renderSurface(status.surface);
  renderAlarm(status.alarm);
}

// ---- panels ---------------------------------------------------------------
// Each feed is { data, at, error }: data is the last good value, error the last failed try (null when it worked).

function sourceLine(node, feed, text) {
  if (!feed || (!feed.data && !feed.error)) { node.textContent = "Loading…"; return false; }
  if (!feed.data) { node.textContent = "Could not load: " + feed.error + ". Retrying every minute."; return false; }
  node.textContent = text + (feed.error ? "  ·  last try failed, showing older data" : "");
  return true;
}

function renderWeather(f) {
  if (!sourceLine($("w-source"), f, f && f.data ? "CWA forecast for " + f.data.town + ", measured at " + f.data.obs.station + " " + f.data.obs.time : "")) return;
  const d = f.data, o = d.obs;
  $("w-temp").textContent = o.temp === null ? "–" : o.temp.toFixed(1) + " °C";
  $("w-sky").textContent = o.weather;
  $("w-rain").textContent = "Rain today " + mm(o.rain_today) + "  ·  last hour " + mm(o.rain_1h);
  const chart = $("w-chart");
  chart.replaceChildren(...d.slots.map((s, i) => {
    const col = document.createElement("div");
    col.className = "slot" + (i === 0 ? " current" : "");
    col.innerHTML = '<span class="pop"></span><span class="bar"><i></i></span><span class="hour"></span><span class="temp"></span>';
    col.querySelector(".pop").textContent = s.pop + "%";
    col.querySelector("i").style.height = Math.max(s.pop, 2) + "%";
    col.querySelector(".hour").textContent = i === 0 ? "now" : s.label;
    col.querySelector(".temp").textContent = s.temp === null || s.temp === undefined ? "" : s.temp + "°";
    col.title = s.weather;
    return col;
  }));
}

function mm(v) {
  return v === null ? "–" : v.toFixed(1) + " mm";
}

function renderYoubike(f) {
  if (!sourceLine($("y-source"), f, f && f.data ? "YouBike 2.0, updated " + f.data.time : "")) return;
  const d = f.data;
  $("y-name").textContent = "YouBike at " + d.name;
  $("y-bikes").textContent = d.bikes;
  $("y-bikes-unit").textContent = d.bikes === 1 ? "bike to rent" : "bikes to rent";
  $("y-docks").textContent = d.active ? d.docks + " empty docks, " + d.total + " in all" : "Station closed";
}

function renderRadar(f) {
  if (!sourceLine($("r-source"), f, "")) return;
  const srcs = f.data.frames.map((x) => x.src).join();
  if (srcs !== radarFrames.map((x) => x.src).join()) {
    // one <img> per frame, all kept in the page: switching src instead made WebKit reload and flash white
    radarFrames = f.data.frames;
    $("r-frames").replaceChildren(...radarFrames.map((x) => { const i = new Image(); i.src = x.src; return i; }));
    radarIdx = radarFrames.length - 1;
    showRadarFrame();
  }
}

function showRadarFrame() {
  clearTimeout(radarTimer);
  if (!radarFrames.length) return;
  const x = radarFrames[radarIdx], last = radarIdx === radarFrames.length - 1;
  [...$("r-frames").children].forEach((img, i) => img.classList.toggle("shown", i === radarIdx));
  $("r-stamp").textContent = x.time + (last ? " newest" : "");
  const err = status && status.radar && status.radar.error ? "  ·  last try failed, showing older data" : "";
  $("r-source").textContent = "Last hour, 10-minute steps, CWA  ·  dot = Xuefu Village" + err;
  radarTimer = setTimeout(() => { radarIdx = (radarIdx + 1) % radarFrames.length; showRadarFrame(); },
                          last ? 3 * RADAR_STEP_MS : RADAR_STEP_MS);
}

function renderSurface(f) {
  if (!sourceLine($("s-source"), f, f && f.data ? "CWA, updated " + f.data.time + "  ·  analysis time is printed on the map" : "")) return;
  if ($("s-img").getAttribute("src") !== f.data.src) $("s-img").src = f.data.src;
}

function applyPanels() {
  const shown = (p) => !hidden || !hidden.has(p);
  document.querySelectorAll("[data-panel]").forEach((n) => { n.hidden = !shown(n.dataset.panel); });
  document.querySelector(".column").hidden = !shown("weather") && !shown("youbike");
  document.querySelectorAll("[data-toggle]").forEach((n) => n.classList.toggle("off", !shown(n.dataset.toggle)));
  el.body.classList.toggle("with-panels", PANELS.some(shown));
}

function togglePanel(p) {
  if (hidden === null) hidden = new Set();
  if (hidden.has(p)) hidden.delete(p); else hidden.add(p);
  applyPanels();
  fetch("/api/prefs", { method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ hidden: [...hidden] }) }).catch(() => {});
}

// ---- alarms ---------------------------------------------------------------

function renderAlarm(a) {
  if (!a) return;
  el.nextAlarm.textContent = a.next ? "Alarm " + a.next.next : "No alarm set";
  $("ringing").hidden = !a.ringing;
  if (a.ringing) $("ring-time").textContent = a.ringing.time;
  if (sheet) renderSheet();
}

function alarmList() {
  return (status && status.alarm && status.alarm.alarms) || [];
}

async function alarmApi(method, path, body) {
  try {
    const r = await fetch(path, { method, headers: { "Content-Type": "application/json" },
                                  body: body ? JSON.stringify(body) : undefined });
    const v = await r.json();
    if (!r.ok) throw new Error(v.error || "HTTP " + r.status);
    if (status) status.alarm = v;
    $("alarm-error").textContent = "";
  } catch (e) {
    $("alarm-error").textContent = "Could not save: " + e.message + ". Try again.";
  }
  if (status) renderAlarm(status.alarm);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function renderSheet() {
  const list = alarmList();
  sheet.sel = Math.min(sheet.sel, list.length);
  const rows = list.map((a, i) => {
    const li = document.createElement("li");
    li.className = (i === sheet.sel ? "sel " : "") + (a.on ? "" : "off");
    if (sheet.edit && sheet.edit.id === a.id) li.append(editor());
    else li.innerHTML = '<span class="t"></span><span class="r"></span><span class="s"></span>';
    if (!(sheet.edit && sheet.edit.id === a.id)) {
      li.querySelector(".t").textContent = a.time;
      li.querySelector(".r").textContent = REPEATS[a.repeat];
      li.querySelector(".s").textContent = a.on ? "On, next " + a.next : "Off";
    }
    return li;
  });
  const add = document.createElement("li");
  add.className = "add" + (sheet.sel === list.length ? " sel" : "");
  if (sheet.edit && sheet.edit.id === null) add.append(editor());
  else add.textContent = "+ New alarm";
  $("alarm-list").replaceChildren(...rows, add);
  $("alarm-help").innerHTML = sheet.edit
    ? "<kbd>←</kbd><kbd>→</kbd> Hour, minute, repeat &nbsp; <kbd>↑</kbd><kbd>↓</kbd> Change &nbsp; <kbd>Enter</kbd> Save &nbsp; <kbd>Esc</kbd> Cancel"
    : "<kbd>↑</kbd><kbd>↓</kbd> Choose &nbsp; <kbd>Enter</kbd> " + (sheet.sel === list.length ? "Add" : "Change") +
      (sheet.sel < list.length ? " &nbsp; <kbd>Space</kbd> On/off &nbsp; <kbd>Delete</kbd> Remove" : "") +
      " &nbsp; <kbd>Esc</kbd> Close";
}

function editor() {
  const e = sheet.edit, span = document.createElement("span");
  span.className = "editor";
  [pad(e.h), pad(e.m), REPEATS[e.repeat]].forEach((txt, i) => {
    if (i === 1) span.append(":");
    const f = document.createElement("b");
    f.textContent = txt;
    if (i === e.field) f.className = "field";
    span.append(f);
    if (i === 1) span.append(" ");
  });
  return span;
}

function openSheet() {
  sheet = { sel: 0, edit: null };
  $("alarms").hidden = false;
  $("alarm-error").textContent = "";
  renderSheet();
}

function closeSheet() {
  sheet = null;
  $("alarms").hidden = true;
}

function sheetKey(key) {
  const list = alarmList(), e = sheet.edit;
  if (e) {
    const order = Object.keys(REPEATS);
    if (key === "ArrowLeft") e.field = (e.field + 2) % 3;
    else if (key === "ArrowRight") e.field = (e.field + 1) % 3;
    else if (key === "ArrowUp" || key === "ArrowDown") {
      const d = key === "ArrowUp" ? 1 : -1;
      if (e.field === 0) e.h = (e.h + d + 24) % 24;
      else if (e.field === 1) e.m = (e.m + d + 60) % 60;
      else e.repeat = order[(order.indexOf(e.repeat) + d + order.length) % order.length];
    } else if (key === "Enter") {
      const body = { time: pad(e.h) + ":" + pad(e.m), repeat: e.repeat, on: true };
      sheet.edit = null;
      alarmApi("POST", e.id === null ? "/api/alarms" : "/api/alarms/" + e.id, body);
    } else if (key === "Escape") sheet.edit = null;
    renderSheet();
    return;
  }
  const a = list[sheet.sel];
  if (key === "ArrowUp") sheet.sel = Math.max(0, sheet.sel - 1);
  else if (key === "ArrowDown") sheet.sel = Math.min(list.length, sheet.sel + 1);
  else if (key === "Enter") {
    const [h, m] = (a ? a.time : "07:00").split(":").map(Number);
    sheet.edit = { id: a ? a.id : null, h, m, repeat: a ? a.repeat : "once", field: 0 };
  } else if (key === " " && a) alarmApi("POST", "/api/alarms/" + a.id, { on: !a.on });
  else if ((key === "Delete" || key === "Backspace") && a) alarmApi("DELETE", "/api/alarms/" + a.id);
  else if (key === "Escape" || key === "a") { closeSheet(); return; }
  renderSheet();
}

// ---- polling --------------------------------------------------------------

async function poll() {
  clearTimeout(pollTimer);
  let delay = POLL_MS;
  try {
    const r = await fetch("/api/status", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    status = await r.json();
  } catch (e) {
    status = null;
    delay = RETRY_MS;
  }
  render();
  pollTimer = setTimeout(poll, delay);
}

async function startStream() {
  starting = true;
  render();
  try {
    const r = await fetch("/api/stream/start", { method: "POST" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    // systemd now stops this browser; if it does not within 8 s, show the status again
    setTimeout(() => { starting = false; poll(); }, 8000);
  } catch (e) {
    starting = false;
    status = null;
    render();
    pollTimer = setTimeout(poll, RETRY_MS);
  }
}

// ---- keys -----------------------------------------------------------------

function checkNow() {
  checkedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  poll();
}

const KEYS = {
  Enter: () => {
    const v = describe(status);
    if (v.enter === "start") startStream();
    else if (v.enter === "check") checkNow();
  },
  r: () => checkNow(),
  b: () => idle(),
  a: () => openSheet(),
  w: () => togglePanel("weather"),
  e: () => togglePanel("radar"),
  s: () => togglePanel("surface"),
  y: () => togglePanel("youbike"),
};

function capFor(key) {
  return document.querySelector('kbd[data-key="' + key + '"]');
}

// ---- idle blanking --------------------------------------------------------

function setBlank(on) {
  blank = on;
  el.body.classList.toggle("blank", on);
}

async function idle() {
  try {
    const r = await fetch("/api/blank", { method: "POST" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    // systemd now stops this browser and blanks the console; nothing more to do here
  } catch (e) {
    setBlank(true);
  }
}

function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(idle, IDLE_MS);
}

document.addEventListener("keydown", (e) => {
  touch();
  if (status && status.alarm && status.alarm.ringing) {
    // The key that stops the alarm is swallowed, like the waking key below.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) alarmApi("POST", "/api/alarm/stop");
    return;
  }
  if (blank) {
    // The waking key is swallowed so that Enter cannot start the stream from a dark screen.
    e.preventDefault();
    e.stopImmediatePropagation();
    setBlank(false);
  }
}, true);

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (sheet) {                        // the alarm list takes every key while open; held arrows repeat
    e.preventDefault();
    if (!e.repeat || key.startsWith("Arrow")) sheetKey(key);
    return;
  }
  if (e.repeat) return;
  const cap = capFor(key);
  if (cap) cap.classList.add("held");
  if (KEYS[key]) { e.preventDefault(); KEYS[key](); }
});
document.addEventListener("keyup", (e) => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const cap = capFor(key);
  if (cap) cap.classList.remove("held");
});

// ---- clock ----------------------------------------------------------------

function tick() {
  const now = new Date();
  const hm = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  el.clock.textContent = hm + "   " + day;
  el.clock.dateTime = now.toISOString();
}

tick();
setInterval(tick, 10000);
applyPanels();
touch();
poll();
