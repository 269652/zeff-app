// The app's files on the phone, so it opens without a network (away from home): served from the cache, and
// fetched anew in the background whenever there is one — the next start has the new version.
const CACHE = "zeff-companion-v3";
const FILES = ["./", "index.html", "app.js", "rtc.js", "app.css", "manifest.webmanifest", "icon.svg", "icon-192.png", "apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
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
  // The page itself under any address (the pairing link's #… never reaches us; a ?query might): the cached index.
  const key = e.request.mode === "navigate" ? "index.html" : e.request;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(key);
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => null);
      if (hit) {
        e.waitUntil(fresh);
        return hit;
      }
      return (await fresh) ?? new Response("Offline", { status: 503 });
    }),
  );
});
