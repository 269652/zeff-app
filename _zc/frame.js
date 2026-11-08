// Loaded first in every Zeff page shown in the app's frame (the service worker puts it at the top of <head>).
//
// Next's development server keeps a WebSocket open for live reloading (/_next/…). The app's connection carries
// requests, not sockets — tried, it fails, and Next reloads the page again and again trying to get it back. So here
// it gets a quiet stand-in that stays "connecting": nothing reloads, the pages work (they don't need it; a new
// version of Zeff shows with the next page load). Every other socket is a real one.
(() => {
  const Real = window.WebSocket;
  if (!Real || Real.__zeffQuiet) return;
  class QuietSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      this.readyState = 0; // CONNECTING, for good
      this.protocol = "";
      this.extensions = "";
      this.bufferedAmount = 0;
      this.binaryType = "blob";
      this.onopen = this.onmessage = this.onerror = this.onclose = null;
    }
    send() {}
    close() {
      this.readyState = 3;
    }
  }
  function ZeffWebSocket(url, protocols) {
    try {
      const u = new URL(url, location.href);
      if (u.host === location.host && u.pathname.startsWith("/_next/")) return new QuietSocket(u.href);
    } catch {}
    return protocols === undefined ? new Real(url) : new Real(url, protocols);
  }
  ZeffWebSocket.prototype = Real.prototype;
  Object.assign(ZeffWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, __zeffQuiet: true });
  window.WebSocket = ZeffWebSocket;
})();
