// The service worker of app.getzeff.com — two jobs:
//
// 1. The app itself (index.html and /_zc/…) on the phone, so it opens without a network. Network first, past the
//    browser's HTTP cache (GitHub Pages lets it keep files 10 minutes); our copy only when the server doesn't answer.
//    A page opened at any address (/todos, /chat …) is the app: it shows Zeff at that address.
//
// 2. Zeff itself in the app's frame: every request the frame makes (its pages, scripts, data, Server Actions, the live
//    events) is handed to the app's page, which asks Zeff on the PC through its WebRTC connection and streams the
//    answer back here. The frame's address stays app.getzeff.com/… — Zeff's own paths.
const CACHE = "zeff-companion-v12";
const SHELL = ["/", "/_zc/app.js", "/_zc/rtc.js", "/_zc/frame.js", "/_zc/app.css", "/_zc/manifest.webmanifest", "/_zc/icon.svg", "/_zc/icon-192.png", "/_zc/apple-touch-icon.png"];
const WAIT_MS = 4000;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((f) => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** One of the app's own files: from the server (fresh), else our copy. */
async function shellFile(e, key) {
  const cache = await caches.open(CACHE);
  const fresh = fetch(key, { cache: "no-cache" }).then((res) => {
    if (res.ok) e.waitUntil(cache.put(key, res.clone()));
    return res;
  });
  try {
    return await Promise.race([fresh, new Promise((_, no) => setTimeout(() => no(new Error("slow")), WAIT_MS))]);
  } catch {
    const hit = await cache.match(key);
    if (hit) return hit;
    try {
      return await fresh;
    } catch {
      return new Response("Offline", { status: 503 });
    }
  }
}

const notConnected = () =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:24px;color:#555">Zeff isn't connected right now.</body>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
  );

/** The app's page that holds the connection (the top window; the one in front first). */
async function connectionPage() {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const tops = all.filter((c) => c.frameType === "top-level" && new URL(c.url).origin === location.origin);
  return tops.find((c) => c.focused) ?? tops.find((c) => c.visibilityState === "visible") ?? tops[0] ?? null;
}

let seq = 0;

/** A Zeff page for the frame: /_zc/frame.js first thing in its <head> (see there). */
function withFrameScript(body) {
  const tag = new TextEncoder().encode('<script src="/_zc/frame.js"></script>');
  let done = false;
  let held = new Uint8Array(0);
  const find = (bytes) => {
    // "<head" … ">" — after the tag's end.
    const text = new TextDecoder().decode(bytes);
    const at = text.search(/<head[^>]*>/i);
    if (at < 0) return -1;
    const end = text.indexOf(">", at) + 1;
    return new TextEncoder().encode(text.slice(0, end)).length;
  };
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, c) {
        if (done) return c.enqueue(chunk);
        const all = new Uint8Array(held.length + chunk.length);
        all.set(held);
        all.set(chunk, held.length);
        const at = find(all);
        if (at < 0 && all.length < 64 * 1024) return void (held = all);
        done = true;
        if (at < 0) return c.enqueue(all);
        c.enqueue(all.subarray(0, at));
        c.enqueue(tag);
        c.enqueue(all.subarray(at));
      },
      flush(c) {
        if (!done && held.length) c.enqueue(held);
      },
    }),
  );
}

/** A request of the frame → the page → Zeff on the PC; the answer as it streams in. */
async function throughZeff(e) {
  const page = await connectionPage();
  if (!page) return notConnected();
  const req = e.request;
  const url = new URL(req.url);
  const body = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer();
  const headers = {};
  req.headers.forEach((v, k) => (headers[k] = v));
  // What a browser sends on its own (not visible here): Zeff's lock and its routing read them.
  headers["sec-fetch-site"] = "same-origin";
  headers["sec-fetch-dest"] = req.destination || "empty";
  headers["sec-fetch-mode"] = req.mode;
  if (req.referrer && req.referrer !== "about:client") headers.referer = req.referrer;
  const { port1, port2 } = new MessageChannel();
  const id = `${Date.now().toString(36)}-${++seq}`;
  page.postMessage({ t: "zeff-fetch", id, method: req.method, path: url.pathname + url.search, headers, body }, body ? [port2, body] : [port2]);
  return new Promise((resolve) => {
    let ctl;
    let headed = false;
    const stream = new ReadableStream({
      start: (c) => (ctl = c),
      cancel: () => port1.postMessage({ t: "abort" }),
    });
    req.signal?.addEventListener?.("abort", () => port1.postMessage({ t: "abort" }));
    port1.onmessage = ({ data }) => {
      if (data.t === "head") {
        headed = true;
        const noBody = req.method === "HEAD" || [101, 204, 205, 304].includes(data.status);
        const html = req.destination === "iframe" && data.headers.some(([k, v]) => k === "content-type" && /text\/html/i.test(v));
        resolve(new Response(noBody ? null : html ? withFrameScript(stream) : stream, { status: data.status, statusText: data.statusText, headers: data.headers }));
      } else if (data.t === "body") ctl.enqueue(new Uint8Array(data.chunk));
      else if (data.t === "end") {
        try {
          ctl.close();
        } catch {}
        port1.close();
      } else if (data.t === "error") {
        if (!headed) resolve(data.status === 503 ? notConnected() : new Response(data.message ?? "Error", { status: data.status ?? 502 }));
        else
          try {
            ctl.error(new Error(data.message));
          } catch {}
        port1.close();
      }
    };
  });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const req = e.request;
  // The app's own files.
  if (url.pathname.startsWith("/_zc/") || url.pathname === "/sw.js") return e.respondWith(shellFile(e, url.pathname));
  // A page opened in the browser's window (not the frame): the app, which then shows Zeff at this address.
  if (req.mode === "navigate" && req.destination === "document") return e.respondWith(shellFile(e, "/"));
  // Everything the frame asks for — its page itself (destination "iframe") and all it loads: Zeff, through the connection.
  e.respondWith(
    (async () => {
      if (req.destination === "iframe") return throughZeff(e);
      const client = e.clientId ? await self.clients.get(e.clientId) : null;
      if (client?.frameType === "nested") return throughZeff(e);
      // The app's page itself asking (an update check of "/"): the server.
      return fetch(req);
    })(),
  );
});
