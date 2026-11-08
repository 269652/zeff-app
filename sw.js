// The app's files on the phone, so it opens without a network (away from home).
//
// Network first: with a network every file comes fresh from the server — past the browser's HTTP cache too
// (GitHub Pages lets it keep files 10 minutes; served from there, a new version reached the phone only by chance,
// 2026-11-08). The copy in our cache is renewed each time and used only when the server doesn't answer in time.
const CACHE = "zeff-companion-v8";
const FILES = ["./", "index.html", "app.js", "rtc.js", "app.css", "manifest.webmanifest", "icon.svg", "icon-192.png", "apple-touch-icon.png"];
const WAIT_MS = 4000;

self.addEventListener("install", (e) => {
  // cache: "reload" — from the server, not from the browser's HTTP cache.
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
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

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // The page itself under any address (the pairing link's #… never reaches us; a ?query might): index.html.
  const navigate = e.request.mode === "navigate";
  const key = navigate ? "index.html" : url.pathname.replace(/^.*\//, "") || "index.html";
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const fresh = fetch(navigate ? "index.html" : e.request.url, { cache: "no-cache" }).then((res) => {
        if (res.ok) e.waitUntil(cache.put(key, res.clone()));
        return res;
      });
      try {
        // The server's answer — unless it takes too long (a weak signal) or there is no network: then our copy.
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
    })(),
  );
});
