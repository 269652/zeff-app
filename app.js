// Zeff on the phone: your todos, ticked off here — live over WebRTC while the phone is at home with the PC
// (rtc.js), kept on the phone and queued while it's away. The queue goes to the PC when the phone is back:
// each change once (the PC remembers the ids it applied), in the order you made them.
import { connect, parsePairing } from "./rtc.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};

// ---------------------------------------------------------------------------------------------------------------------
// Words (English and German)
// ---------------------------------------------------------------------------------------------------------------------

const DE = navigator.language?.toLowerCase().startsWith("de");
const WORDS = {
  "Zeff on your phone": ["Zeff on your phone", "Zeff auf dem Handy"],
  welcome1: ["Your todos, ticked off here — straight to Zeff on your PC over your Wi-Fi, with no server in between.", "Deine Todos, hier abgehakt — direkt über dein WLAN zu Zeff auf deinem PC, ohne Server dazwischen."],
  setupNew: ["Set up Zeff on your PC", "Zeff auf dem PC einrichten"],
  setupHelp: ["Can't reach Zeff on your PC?", "Zeff auf dem PC nicht erreichbar?"],
  checksIntro: ["This phone looks for Zeff on your PC over the Wi-Fi. Check:", "Dieses Handy sucht Zeff auf deinem PC über das WLAN. Prüfe:"],
  check1: ["The PC is on and Zeff is running (the Zeff icon in the taskbar's tray).", "Der PC ist an und Zeff läuft (das Zeff-Symbol unten rechts in der Taskleiste)."],
  check2: ["This phone is on the same Wi-Fi as the PC (not on mobile data).", "Dieses Handy ist im selben WLAN wie der PC (nicht im Mobilfunk)."],
  check3: ["Windows lets phones in: Zeff icon → Phone — fix what it shows there (the Wi-Fi must be a private network, the firewall must allow Zeff).", "Windows lässt Handys herein: Zeff-Symbol → Phone — dort Angezeigtes beheben (das WLAN muss ein privates Netzwerk sein, die Firewall Zeff erlauben)."],
  check4: ["Still nothing: pair again (Zeff icon → Phone → Pair a phone) — the PC's address may have changed.", "Immer noch nichts: neu koppeln (Zeff-Symbol → Phone → Pair a phone) — die Adresse des PCs kann sich geändert haben."],
  "No Zeff on your PC yet?": ["No Zeff on your PC yet?", "Noch kein Zeff auf dem PC?"],
  install1: ["On your PC (Windows or Linux), download Zeff from getzeff.com.", "Lade Zeff auf deinem PC (Windows oder Linux) von getzeff.com herunter."],
  "Allow home network access": ["Allow home network access", "Zugriff aufs Heimnetz erlauben"],
  lnaPrompt: ["Chrome asks before a website may reach devices in your home network — Zeff on your PC is one. Allow it once, and the phone connects.", "Chrome fragt, bevor eine Website Geräte in deinem Heimnetz erreichen darf — Zeff auf deinem PC ist so eines. Einmal erlauben, dann verbindet sich das Handy."],
  lnaDenied: ["Chrome blocks this app from your home network, so it can't reach your PC. Allow it again: tap the icon left of the address → Permissions (Site settings) → Local network access → Allow, then reload.", "Chrome sperrt diese App für dein Heimnetz, darum erreicht sie deinen PC nicht. Wieder erlauben: auf das Symbol links neben der Adresse tippen → Berechtigungen (Website-Einstellungen) → Zugriff auf lokales Netzwerk → Zulassen, dann neu laden."],
  "Home network access": ["Home network access", "Heimnetz-Zugriff"],
  "This phone sends from": ["This phone sends from", "Das Handy sendet von"],
  Steps: ["Steps", "Ablauf"],
  "Last attempt": ["Last attempt", "Letzter Versuch"],
  "Download page": ["Download page", "Zum Download"],
  "Send the link to my PC": ["Send the link to my PC", "Link an meinen PC schicken"],
  linkCopied: ["Link copied", "Link kopiert"],
  install2: ["Unzip it and start Zeff (Zeff.exe on Windows). No other installation is needed; the Zeff icon appears in the taskbar's tray.", "Entpacken und Zeff starten (unter Windows Zeff.exe). Sonst ist nichts zu installieren; das Zeff-Symbol erscheint unten rechts in der Taskleiste."],
  install3: ["Click the Zeff icon → Phone → Pair a phone, and scan the code with this phone's camera.", "Auf das Zeff-Symbol klicken → Phone → Pair a phone, und den Code mit der Kamera dieses Handys scannen."],
  welcome4: ["Phone and PC need to be on the same Wi-Fi to connect. What you tick while away is sent when you're back home.", "Handy und PC müssen im selben WLAN sein. Was du unterwegs abhakst, wird gesendet, sobald du wieder zu Hause bist."],
  live: ["Live", "Verbunden"],
  connecting: ["Connecting …", "Verbinde …"],
  away: ["Not at home", "Nicht zu Hause"],
  denied: ["Unpaired — scan again", "Entkoppelt — neu scannen"],
  waiting: ["{n} waiting", "{n} wartend"],
  "Nothing open.": ["Nothing open.", "Nichts offen."],
  closed: ["Done lately ({n})", "Zuletzt erledigt ({n})"],
  synced: ["As of {time}", "Stand {time}"],
  never: ["Not synced yet", "Noch nicht abgeglichen"],
  "Flag important": ["Flag important", "Als wichtig markieren"],
  "will be sent": ["will be sent at home", "wird zu Hause gesendet"],
  due: ["due {d}", "fällig {d}"],
  Account: ["Account", "Konto"],
  locked: ["This account is locked on the PC (Zeff's lock) — its todos stay there.", "Dieses Konto ist am PC gesperrt (Zeffs Sperre) — seine Todos bleiben dort."],
};
const tr = (key, vars = {}) => (WORDS[key]?.[DE ? 1 : 0] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
document.documentElement.lang = DE ? "de" : "en";
for (const n of document.querySelectorAll("[data-t]")) n.textContent = tr(n.dataset.t);

// ---------------------------------------------------------------------------------------------------------------------
// What the phone keeps: the pairing, the todos as last seen, the changes not yet on the PC
// ---------------------------------------------------------------------------------------------------------------------

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`zeff.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`zeff.${key}`, JSON.stringify(value));
    } catch {
      // full or blocked: it lives on in memory until the page closes
    }
  },
};

// A pairing link (the QR code): kept, and taken out of the address bar — it holds this phone's secret.
const fromLink = parsePairing(location.hash);
if (fromLink) {
  store.set("pairing", fromLink);
  history.replaceState(null, "", location.pathname + location.search);
}
// Ask the browser to keep what we store (a phone low on space may otherwise clear it — and the queue with it).
navigator.storage?.persist?.().catch(() => {});

let pairing = store.get("pairing", null);
// Zeff's accounts: the one shown (null until the PC named one: the PC's own), the list for the switcher, which ones
// Zeff's lock guards. Each account's todos are kept apart ("snapshot:<id>"); the queue holds every account's
// changes, each with its account.
let account = store.get("account", null);
let accounts = store.get("accounts", []);
const lockedAccounts = new Set();
const EMPTY = { at: null, todos: [] };
const snapshotOf = (id) => (id ? store.get(`snapshot:${id}`, EMPTY) : EMPTY);
let snapshot = snapshotOf(account);
let outbox = store.get("outbox", []);
let conn = null;
let state = pairing ? "away" : "none";

const newId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** The todos as you see them: the PC's last word with your changes on top that it hasn't confirmed yet. */
function view() {
  const todos = new Map(snapshot.todos.map((t) => [t.id, { ...t }]));
  for (const op of outbox) {
    if ((op.account ?? null) !== account) continue;
    const t = todos.get(op.todoId);
    if (!t) continue;
    t.pending = true;
    if (op.kind === "status") {
      t.status = op.status;
      t.doneAt = op.status === "open" ? null : op.at;
    } else if (op.kind === "flag") t.flagged = op.flagged;
  }
  return [...todos.values()];
}

/** A change of yours: on the phone at once, to the PC now (live) or later (queued). */
function change(op) {
  outbox.push({ id: newId(), at: new Date().toISOString(), account, ...op });
  store.set("outbox", outbox);
  render();
  flush();
}

/** The queue to the PC: one message per account (each goes to its own account in Zeff). */
function flush() {
  if (!conn || !outbox.length) return;
  const byAccount = new Map();
  for (const op of outbox) byAccount.set(op.account ?? null, [...(byAccount.get(op.account ?? null) ?? []), op]);
  for (const [id, ops] of byAccount) conn.send({ t: "ops", account: id, ops });
}

/** Show another account: its todos as kept on the phone at once, the PC's fresh ones when connected. */
function switchTo(id) {
  if (id === account) return;
  account = id;
  store.set("account", id);
  snapshot = snapshotOf(id);
  render();
  conn?.send({ t: "account", id });
}

// ---------------------------------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------------------------------

const today = () => new Date().toLocaleDateString("sv-SE");
const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function todoItem(t) {
  const closed = t.status !== "open";
  const box = el("input", { type: "checkbox", checked: closed, onchange: () => change({ kind: "status", todoId: t.id, status: box.checked ? "done" : "open" }) });
  const meta = el("span", { className: "meta" });
  const bits = [];
  if (t.ticket) bits.push(document.createTextNode(t.ticket));
  if (t.due && !closed) bits.push(el("span", { className: t.due.slice(0, 10) <= today() ? "due-now" : "", textContent: tr("due", { d: fmtDay(t.due.slice(0, 10)) }) }));
  if (t.pending) bits.push(el("span", { className: "pending", textContent: tr("will be sent") }));
  bits.forEach((b, i) => meta.append(...(i ? [" · ", b] : [b])));
  const text = el("span", { className: "text" }, t.text, ...(bits.length ? [meta] : []));
  const star = el("button", {
    type: "button",
    textContent: t.flagged ? "★" : "☆",
    title: tr("Flag important"),
    ariaLabel: tr("Flag important"),
    onclick: () => change({ kind: "flag", todoId: t.id, flagged: !t.flagged }),
  });
  star.setAttribute("aria-pressed", String(!!t.flagged));
  return el("li", { className: `todo${closed ? " closed" : ""}` }, el("label", {}, box, text), star);
}

function render() {
  $("lna").hidden = !pairing || conn !== null || state !== "away" || lna === "granted";
  $("lnaText").textContent = tr(lna === "denied" ? "lnaDenied" : "lnaPrompt");
  // The button whenever it isn't granted: asking again costs nothing; where the browser can't say, it may still ask.
  $("lnaAllow").hidden = lna === "denied" || lna === "granted";
  const s = $("status");
  s.className = `status ${state === "none" ? "away" : state}`;
  const waiting = outbox.length ? ` · ${tr("waiting", { n: outbox.length })}` : "";
  $("statusText").textContent = state === "none" ? tr("away") : tr(state) + waiting;
  s.hidden = state === "none";
  $("welcome").hidden = !!pairing && state !== "denied";
  renderSetup();
  $("list").hidden = !pairing;
  renderAccounts();
  if (!pairing) return;
  const locked = account !== null && lockedAccounts.has(account);
  $("lockedNote").hidden = !locked;
  $("lockedNote").textContent = tr("locked");
  const all = locked ? [] : view();
  // Yours first; the flagged on top, then by when they're due, then the newest.
  const order = (a, b) => (b.flagged - a.flagged) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.id - a.id;
  const open = all.filter((t) => t.status === "open" && t.owner !== "other").sort(order);
  const waitingFor = all.filter((t) => t.status === "open" && t.owner === "other").sort(order);
  const done = all.filter((t) => t.status !== "open").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  $("open").replaceChildren(...[...open, ...waitingFor].map(todoItem));
  $("empty").hidden = locked || !snapshot.at || open.length + waitingFor.length > 0;
  $("empty").textContent = tr("Nothing open.");
  $("doneBox").hidden = !done.length;
  $("doneTitle").textContent = tr("closed", { n: done.length });
  $("done").replaceChildren(...done.map(todoItem));
  $("foot").textContent = snapshot.at
    ? `${pairing.name} · ${tr("synced", { time: new Date(snapshot.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) })}`
    : tr("never");
}

/**
 * Getting to Zeff: with no PC paired, how to get Zeff (download, start, pair) — open. Paired but the PC doesn't answer:
 * what to check, and the same steps — open while the phone has never reached Zeff (nothing to show), folded once it
 * has (away from home is normal: the todos are there, ticks wait). Hidden while connected or still trying.
 */
let setupMode = null;
function renderSetup() {
  const box = $("setup");
  const mode = !pairing ? "new" : state === "away" ? "help" : null;
  box.hidden = !mode;
  if (!mode) return void (setupMode = null);
  $("setupTitle").textContent = tr(mode === "new" ? "setupNew" : "setupHelp");
  $("checks").hidden = mode !== "help";
  $("lastError").hidden = mode !== "help" || !lastError;
  $("lastError").textContent = lastError ? `${tr("Last attempt")}: ${lastError}` : "";
  // The diagnosis: what the app knows about this phone and its last attempt (to read out or send).
  const chrome = /Chrome\/(\d+[.\d]*)/.exec(navigator.userAgent)?.[1] ?? navigator.userAgent.slice(0, 60);
  $("diag").hidden = mode !== "help";
  $("diag").textContent = [
    `App ${APP_VERSION} · Chrome ${chrome} · ${navigator.connection?.type ?? "?"}`,
    `${tr("Home network access")}: ${lna ?? "–"}`,
    `PC: ${pairing?.hosts.join(", ") ?? "–"} : ${pairing?.port ?? "–"}`,
    lastTrace ? `${tr("This phone sends from")}: ${lastTrace.candidates.join(" | ") || "–"}` : "",
    lastTrace ? `${tr("Steps")}: ${lastTrace.states.join(" → ") || "–"}` : "",
  ].filter(Boolean).join("\n");
  // Opened or folded when the situation changes — not over your own click on it.
  if (mode !== setupMode) box.open = mode === "new" || (!snapshot.at && !accounts.some((a) => snapshotOf(a.id).at));
  setupMode = mode;
}

// The download link to the PC: the phone's share sheet (mail, a messenger, nearby sharing) — else the clipboard.
const DOWNLOAD = "https://getzeff.com/#download";
$("shareLink").hidden = !navigator.share && !navigator.clipboard;
$("shareLink").onclick = async () => {
  try {
    if (navigator.share) await navigator.share({ title: "Zeff", url: DOWNLOAD });
    else {
      await navigator.clipboard.writeText(DOWNLOAD);
      $("shareLink").textContent = tr("linkCopied");
    }
  } catch {
    // the share sheet was closed
  }
};

/** The switcher: only with more than one account; each with its colour, a lock where Zeff's lock guards it. */
const COLORS = { indigo: "#6366f1", emerald: "#10b981", amber: "#f59e0b", rose: "#f43f5e", sky: "#0ea5e9", violet: "#8b5cf6" };
function renderAccounts() {
  const box = $("accountBox");
  box.hidden = !pairing || accounts.length < 2;
  if (box.hidden) return;
  const sel = $("account");
  sel.replaceChildren(...accounts.map((a) => el("option", { value: a.id, textContent: `${a.locked ? "🔒 " : ""}${a.name}`, selected: a.id === account })));
  $("accountDot").style.background = COLORS[accounts.find((a) => a.id === account)?.color] ?? "var(--muted)";
}
$("account").onchange = (e) => switchTo(e.target.value);

// ---------------------------------------------------------------------------------------------------------------------
// The connection: tried when the page opens, comes back to the front, the network changes — and every 20 s
// while it's away (at home the PC answers within a second; away nothing does, and that costs nothing)
// ---------------------------------------------------------------------------------------------------------------------

// Chrome's Local Network Access: a public website (this one) may reach devices in the home network — Zeff on the PC — only
// with the "local network" permission. Without it, WebRTC to the PC's address fails silently (a timeout; nothing reaches
// the PC). "granted" | "prompt" | "denied", or null where the browser has no such permission (nothing to ask).
let lna = null;
async function lnaPermission() {
  for (const name of ["local-network-access", "local-network"]) {
    try {
      const st = await navigator.permissions.query({ name });
      if (!st.__watched) {
        st.__watched = true;
        st.addEventListener("change", () => {
          lna = st.state;
          render();
          if (lna === "granted") tryConnect();
        });
      }
      return st.state;
    } catch {
      // not a permission this browser knows
    }
  }
  return null;
}

/**
 * Ask for it: a request to the PC that names the local network as its target is what makes Chrome ask you. The request
 * itself goes nowhere (nothing answers on that port) — only the permission matters.
 */
async function askLna() {
  if (!pairing) return;
  await Promise.allSettled(
    pairing.hosts.map((h) => fetch(`http://${h.includes(":") ? `[${h}]` : h}:${pairing.port}/`, { targetAddressSpace: "local", mode: "no-cors", cache: "no-store" })),
  );
  lna = await lnaPermission();
  render();
  tryConnect();
}

let trying = false;
let lastError = null;
let lastTrace = null;
const APP_VERSION = "8";
async function tryConnect() {
  if (!pairing || conn || trying || state === "denied") return;
  // (Tried either way: a browser may know the permission without enforcing it for WebRTC yet. The notice shows when it failed.)
  lna = await lnaPermission();
  trying = true;
  state = "connecting";
  render();
  try {
    const c = await connect(pairing);
    conn = c;
    state = "live";
    c.onMessage(onMessage);
    c.onClose(() => {
      if (conn !== c) return;
      conn = null;
      state = "away";
      render();
    });
    flush();
    c.send({ t: "sync", account });
  } catch (err) {
    state = err.message === "denied" ? "denied" : "away";
    lastError = `${new Date().toLocaleTimeString()} — ${err.detail ?? err.message}`;
    lastTrace = err.trace ?? null;
    if (state === "denied") {
      store.set("pairing", null);
      pairing = null;
    }
  } finally {
    trying = false;
    render();
  }
}

function setAccounts(list) {
  if (!Array.isArray(list) || !list.length) return;
  accounts = list.map(({ id, name, color, locked }) => ({ id, name, color, locked }));
  store.set("accounts", accounts);
  lockedAccounts.clear();
  for (const a of list) if (a.locked) lockedAccounts.add(a.id);
  // The account shown is gone (deleted on the PC): back to the PC's own.
  if (account && !accounts.some((a) => a.id === account)) switchTo(list.find((a) => a.current)?.id ?? accounts[0].id);
}

function onMessage(msg) {
  if (msg.t === "snapshot" && Array.isArray(msg.todos)) {
    setAccounts(msg.accounts);
    // The first answer names the account (the PC's own) when the phone hadn't picked one.
    if (account === null && msg.account) {
      account = msg.account;
      store.set("account", account);
      // Changes queued before any account was known are this one's.
      for (const op of outbox) op.account ??= account;
      store.set("outbox", outbox);
    }
    store.set(`snapshot:${msg.account}`, { at: msg.at, todos: msg.todos });
    if (msg.account === account) snapshot = { at: msg.at, todos: msg.todos };
    render();
  } else if (msg.t === "locked") {
    setAccounts(msg.accounts);
    if (msg.account) lockedAccounts.add(msg.account);
    render();
  } else if (msg.t === "applied" && Array.isArray(msg.results)) {
    // Done (or no longer needed) on the PC: off the queue. One that failed (or whose account is locked) stays for next time.
    const settled = new Set(msg.results.filter((r) => r.ok).map((r) => r.id));
    outbox = outbox.filter((op) => !settled.has(op.id));
    store.set("outbox", outbox);
    render();
  }
}

// A pairing link opened while the app is open (only the #… changes — no new page): take it as at the start.
addEventListener("hashchange", () => {
  const p = parsePairing(location.hash);
  if (!p) return;
  store.set("pairing", p);
  history.replaceState(null, "", location.pathname + location.search);
  pairing = p;
  conn?.close();
  conn = null;
  state = "away";
  render();
  tryConnect();
});

$("lnaAllow").onclick = () => askLna();

$("status").onclick = () => {
  if (conn) conn.send({ t: "sync" });
  else tryConnect();
};
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && tryConnect());
addEventListener("online", tryConnect);
setInterval(() => document.visibilityState === "visible" && tryConnect(), 20000);

// The service worker (the app offline). Chrome checks for a new one only now and then — an old app stayed on the phone
// through many reloads (2026-11-08). So we ask each time the app opens or comes back to the front, and when a new one
// takes over, the page loads once more: you see the new version at once (not while a pairing link is being read).
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return; // the first install: nothing old on screen
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker
    .register("sw.js", { updateViaCache: "none" })
    .then((reg) => {
      const check = () => reg.update().catch(() => {});
      check();
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
    })
    .catch(() => {});
}
render();
tryConnect();
