// The phone's end of the WebRTC connection to Zeff on the PC — no signaling server: the pairing (from the
// QR code) has the PC's address, its UDP port and its certificate's fingerprint, so we write the PC's
// answer ourselves. Our offer stays as the browser made it (browsers no longer let a page rewrite its ICE
// ufrag and password); the PC learns our password from the ufrag we give it — "zeff2<our password>" — which
// our first STUN check carries (libp2p's WebRTC Direct v2; see launcher/lib/companion/host.js). The browser
// checks the PC's certificate against the fingerprint; we prove ourselves with an HMAC of the PC's challenge
// and our device secret.

const UFRAG_PREFIX = "zeff2";
const PART = 60 * 1024;
const MAX_MESSAGE = 256 * 1024;

/** The PC's answer, as it will be: ufrag "zeff2<our password>", our password as its own, its fingerprint, it the DTLS server. */
function pcAnswer({ host, port, fingerprint }, ourPwd) {
  const ip = host.includes(":") ? "IP6" : "IP4";
  return [
    "v=0",
    `o=- 0 0 IN ${ip} ${host}`,
    "s=-",
    `c=IN ${ip} ${host}`,
    "t=0 0",
    "a=group:BUNDLE 0",
    `m=application ${port} UDP/DTLS/SCTP webrtc-datachannel`,
    "a=mid:0",
    "a=setup:passive",
    `a=ice-ufrag:${UFRAG_PREFIX}${ourPwd}`,
    `a=ice-pwd:${ourPwd}`,
    `a=fingerprint:sha-256 ${fingerprint}`,
    "a=sctp-port:5000",
    `a=max-message-size:${MAX_MESSAGE}`,
    `a=candidate:1 1 UDP 2130706431 ${host} ${port} typ host`,
    "a=end-of-candidates",
    "",
  ].join("\r\n");
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hmac(secretB64, text) {
  const key = await crypto.subtle.importKey("raw", unb64(secretB64), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}

function frames(msg) {
  const text = JSON.stringify(msg);
  if (text.length <= PART) return [text];
  const id = Math.random().toString(36).slice(2, 10);
  const n = Math.ceil(text.length / PART);
  return Array.from({ length: n }, (_, i) => JSON.stringify({ t: "part", id, i, n, d: text.slice(i * PART, (i + 1) * PART) }));
}

function assembler() {
  const open = new Map();
  return (text) => {
    const msg = JSON.parse(text);
    if (msg.t !== "part") return msg;
    const parts = open.get(msg.id) ?? [];
    parts[msg.i] = msg.d;
    open.set(msg.id, parts);
    if (parts.filter((p) => p !== undefined).length < msg.n) return null;
    open.delete(msg.id);
    return JSON.parse(parts.join(""));
  };
}

/**
 * Connect to one of the pairing's addresses and prove ourselves. Resolves with
 * { send(msg), close(), onMessage(fn), onClose(fn) } once the PC said welcome; rejects on a timeout or "denied".
 */
export async function connectTo(pairing, host, timeoutMs = 8000) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dc = pc.createDataChannel("zeff", { negotiated: true, id: 0 });
  // What happened, for the app's diagnosis: our own candidates (where we send from), the ICE and connection states in turn.
  const t0 = Date.now();
  const trace = { candidates: [], states: [] };
  const note = (what) => trace.states.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${what}`);
  pc.addEventListener("icecandidate", (e) => {
    if (e.candidate?.candidate) {
      const parts = e.candidate.candidate.split(" ");
      trace.candidates.push(`${parts[7] ?? "?"} ${parts[2]?.toLowerCase() ?? ""} ${parts[4] ?? ""}`);
    } else if (!e.candidate) note("gathering done");
  });
  pc.addEventListener("iceconnectionstatechange", () => note(`ice ${pc.iceConnectionState}`));
  pc.addEventListener("connectionstatechange", () => note(`conn ${pc.connectionState}`));
  const fail = (message) => Object.assign(new Error(message), { trace });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const ufrag = /a=ice-ufrag:([^\r\n]+)/.exec(offer.sdp)?.[1];
  const pwd = /a=ice-pwd:([^\r\n]+)/.exec(offer.sdp)?.[1];
  if (!ufrag || !pwd) throw new Error("no ICE credentials in the offer");
  await pc.setRemoteDescription({ type: "answer", sdp: pcAnswer({ host, port: pairing.port, fingerprint: pairing.fingerprint }, pwd) });

  const read = assembler();
  const listeners = { message: [], close: [] };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      dc.close();
    } catch {}
    try {
      pc.close();
    } catch {}
    for (const fn of listeners.close) fn();
  };
  const conn = {
    host,
    send(msg) {
      if (closed || dc.readyState !== "open") return false;
      for (const f of frames(msg)) dc.send(f);
      return true;
    },
    close,
    onMessage: (fn) => listeners.message.push(fn),
    onClose: (fn) => listeners.close.push(fn),
  };

  return new Promise((resolve, reject) => {
    let welcomed = false;
    const timer = setTimeout(() => {
      if (!welcomed) {
        close();
        reject(fail("timeout"));
      }
    }, timeoutMs);
    pc.addEventListener("connectionstatechange", () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        if (!welcomed) {
          clearTimeout(timer);
          reject(fail(pc.connectionState));
        }
        close();
      }
    });
    dc.addEventListener("close", close);
    dc.addEventListener("message", async (e) => {
      let msg;
      try {
        msg = read(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data));
      } catch {
        return;
      }
      if (!msg) return;
      if (welcomed) return listeners.message.forEach((fn) => fn(msg));
      if (msg.t === "hello") {
        dc.send(JSON.stringify({ t: "auth", device: pairing.device, mac: await hmac(pairing.secret, `${msg.nonce}|${ufrag}`) }));
      } else if (msg.t === "welcome") {
        welcomed = true;
        clearTimeout(timer);
        resolve(conn);
      } else if (msg.t === "denied") {
        clearTimeout(timer);
        close();
        reject(new Error("denied"));
      }
    });
  });
}

/**
 * Try the pairing's addresses (a PC can have several: Wi-Fi, cable, a VPN) all at once — the first that answers
 * wins, the others are closed. "denied" (this phone was unpaired) wins over a timeout.
 */
export async function connect(pairing, timeoutMs = 6000) {
  if (!pairing.hosts.length) throw new Error("no address");
  const tries = pairing.hosts.map((host) => connectTo(pairing, host, timeoutMs));
  try {
    const first = await Promise.any(tries);
    for (const t of tries) t.then((c) => c !== first && c.close(), () => {});
    return first;
  } catch (agg) {
    const errs = agg.errors ?? [agg];
    const denied = errs.find((e) => e.message === "denied");
    if (denied) throw denied;
    // What each address said ("192.168.178.23: timeout") — shown in the app's help.
    const err = new Error(errs[0]?.message ?? "failed");
    err.detail = pairing.hosts.map((h, i) => `${h}: ${errs[i]?.message ?? "?"}`).join(" · ");
    err.trace = errs.find((e) => e.trace)?.trace ?? null;
    throw err;
  }
}

/** The certificate's fingerprint as SDP writes it ("AB:CD:…") from the link's base64url bytes (or as it is, if already so). */
function fingerprintOf(f) {
  if (f.includes(":")) return f;
  const bytes = unb64(f.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(f.length / 4) * 4, "="));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
}

/** A pairing from the QR code's link: https://app.getzeff.com/#p=<base64url JSON {h:[hosts], p:port, f:fingerprint (base64url bytes), d:device, s:secret, n:name}>. */
export function parsePairing(hash) {
  const m = /(?:^#|&)p=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    const j = JSON.parse(new TextDecoder().decode(unb64(m[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(m[1].length / 4) * 4, "="))));
    if (!Array.isArray(j.h) || !j.p || !j.f || !j.d || !j.s) return null;
    return { hosts: j.h, port: j.p, fingerprint: fingerprintOf(j.f), device: j.d, secret: j.s, name: j.n ?? "Zeff" };
  } catch {
    return null;
  }
}
