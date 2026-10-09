// Pi Room idle screen: polls /api/status and maps it to one of the states below.
// Keys: Enter = start the stream (or check again when it cannot start), R = check again.
// Ctrl+Alt+Fx is handled outside the browser by pi-console-keys.
"use strict";

const POLL_MS = 3000;      // normal refresh
const RETRY_MS = 2000;     // while the server is unreachable (boot, server restart)
const LAPTOP = "192.168.0.193";

const el = {
  body: document.body,
  state: document.getElementById("state"),
  detail: document.getElementById("detail"),
  action: document.getElementById("action"),
  actionLabel: document.getElementById("action-label"),
  note: document.getElementById("note"),
  clock: document.getElementById("clock"),
  pi: document.getElementById("pi"),
};

let status = null;        // last /api/status payload
let starting = false;     // Enter was pressed; waiting for systemd to take the screen
let pollTimer = null;
let checkedAt = null;     // time of the last manual check (R or Enter while it cannot start)

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
};

function capFor(key) {
  return document.querySelector('kbd[data-key="' + key + '"]');
}

document.addEventListener("keydown", (e) => {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
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
poll();
