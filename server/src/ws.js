'use strict';
// WebSockets on the web server. A minimal RFC 6455 server: text and binary frames, fragments, ping/pong and close;
// no extensions.
//   /ws   the bridge for Ruffle (the Flash emulator). A browser page can't open a raw TCP socket, so Ruffle's
//         socketProxy setting sends the client's game socket over ws://<web server>/ws instead; this passes the
//         bytes to the game port and back unchanged, so the game server sees an ordinary connection.
//   /json the new JavaScript client (/play): the same {cmd, data} messages as the Flash client's AMF3, one JSON text
//         frame each, handled by the same game code (JsonConnection stands in for net.js's Connection).
const crypto = require('crypto');
const { clientOf, newDevice, deviceCookie, netOf } = require('./game/security');
const net = require('net');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_BUFFER = 4 * 1048576;
// (security review, Nov 28 2026) A /json message may be at most MAX_MESSAGE however many pieces it comes in (a
// message sent as endless pieces used to be gathered without limit, until the server ran out of memory; the client's
// are a few KB), and one network (an IPv6 /64 counts as one) may hold MAX_PER_NET connections at once.
const MAX_MESSAGE = 1048576, MAX_PER_NET = 30;
const perNet = new Map();

function frame(opcode, payload){
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : Buffer.alloc(10);
  if (n >= 65536){ head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, payload]);
}

// Reads client frames from buf; returns [frames, rest] or null when the stream is malformed.
function parse(buf, max = MAX_BUFFER){
  const out = [];
  let p = 0;
  while (buf.length - p >= 2){
    const b0 = buf[p], b1 = buf[p + 1], masked = b1 & 0x80;
    let len = b1 & 0x7f, q = p + 2;
    if (len === 126){ if (buf.length - q < 2) break; len = buf.readUInt16BE(q); q += 2; }
    else if (len === 127){ if (buf.length - q < 8) break; const big = buf.readBigUInt64BE(q); if (big > BigInt(max)) return null; len = Number(big); q += 8; }
    if (!masked) return null; // browsers always mask
    if (buf.length - q < 4 + len) break;
    const key = buf.subarray(q, q + 4), data = Buffer.from(buf.subarray(q + 4, q + 4 + len));
    for (let i = 0; i < data.length; i++) data[i] ^= key[i & 3];
    out.push({ opcode: b0 & 0x0f, fin: !!(b0 & 0x80), data });
    p = q + 4 + len;
  }
  return [out, buf.subarray(p)];
}

let jsonSeq = 0;
// One /json client. Has what game.js uses of a net.js Connection: id, player, ip, closed, send(cmd, data), close().
class JsonConnection {
  constructor(sock, ip, onMessage, onClose, log, perf){
    this.id = 'j' + (++jsonSeq); this.sock = sock; this.ip = ip; this.log = log; this.perf = perf; this.player = null; this.closed = false;
    this.onMessage = onMessage; this.onCloseCb = onClose; this.parts = []; this.partBytes = 0;
  }
  receive(f){
    // Text or binary frames, possibly split into a first frame and continuations (opcode 0) ending with fin.
    if (f.opcode !== 0){ this.parts = []; this.partBytes = 0; }
    this.parts.push(f.data); this.partBytes += f.data.length;
    if (this.partBytes > MAX_MESSAGE){ this.log?.warn?.(`conn ${this.id} (${this.ip}) sent a message over ${MAX_MESSAGE} bytes: closed`); this.parts = []; this.partBytes = 0; this.close(); try { this.sock.destroy(); } catch (e){} return; }
    if (!f.fin) return;
    const text = Buffer.concat(this.parts).toString('utf8'); this.parts = []; this.partBytes = 0;
    let msg;
    try { msg = JSON.parse(text); } catch (e){ this.log?.warn?.(`conn ${this.id} sent unreadable JSON`); return; }
    if (!msg || typeof msg.cmd !== 'string'){ this.log?.warn?.(`conn ${this.id} sent a message without cmd`); return; }
    this.onMessage(this, msg.cmd, msg.data ?? {});
  }
  send(cmd, data){
    if (this.closed || this.sock.destroyed) return;
    const body = Buffer.from(JSON.stringify({ cmd, data: data == null ? {} : data }), 'utf8');
    this.sock.write(frame(0x1, body));
    this.perf?.sentMsg(cmd, body.length);
  }
  close(){ if (this.closed) return; try { this.sock.end(frame(0x8, Buffer.alloc(0))); } catch (e){} }
  closed_(){ if (this.closed) return; this.closed = true; try { this.onCloseCb(this); } catch (e){ this.log?.error?.(`closing ${this.id}: ${e.message}`); } }
}

// Answers WebSocket upgrades on httpSrv: /ws bridges to the game server at host:port; /json (when json is given:
// { onMessage(conn, cmd, data), onClose(conn), perf }) talks to the game directly.
function attachSocketBridge(httpSrv, host, port, log, json = null){
  httpSrv.on('upgrade', (req, sock, first) => {
    const key = req.headers['sec-websocket-key'], url = req.url || '';
    // (/ws, the Flash client's bridge, only when that client is on, or in live mode: json.flashBridge)
    const isWs = (!json || json.flashBridge !== false) && /^\/ws\/?(\?.*)?$/.test(url), isJson = !!json && /^\/json\/?(\?.*)?$/.test(url);
    if ((!isWs && !isJson) || String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key){
      sock.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    // A /json client: who it is (its address, through the Cloudflare Tunnel too, and its browser), and a browser id
    // for a browser that has none yet, set on this handshake (security.js).
    const who = isJson ? clientOf(req, req.socket?.remoteAddress || sock.remoteAddress) : null;
    const block = who && !who.local ? netOf(who.ip) : null;
    if (block && (perNet.get(block) || 0) >= MAX_PER_NET){
      log?.warn?.(`Refused a connection from ${who.ip}: its network already has ${MAX_PER_NET} open`);
      sock.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return;
    }
    if (block){ perNet.set(block, (perNet.get(block) || 0) + 1); let gone = false; sock.once('close', () => { if (gone) return; gone = true; const n = (perNet.get(block) || 1) - 1; if (n > 0) perNet.set(block, n); else perNet.delete(block); }); }
    let cookie = '';
    if (who && !who.device){ who.device = newDevice(); cookie = 'Set-Cookie: ' + deviceCookie(who.device, who.https) + '\r\n'; }
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n' + cookie + '\r\n');
    sock.setNoDelay(true);
    if (isJson) return jsonSocket(sock, first, req, log, json, who);
    // (Live mode: to the official server, directly or through a proxy, upstream.js.)
    const game = json?.upstream ? json.upstream.open() : net.connect(port, host);
    game.setNoDelay(true);
    let buf = Buffer.alloc(0), closed = false;
    // Live mode: the battle capture reads the official server's side (battlelog.js), the recorder both (recorder.js).
    const { FrameReader } = require('./battlelog');
    const tap = json?.book ? json.book.tap('ruffle') : null, rec = json?.recorder ? json.recorder.session('ruffle') : null;
    const reader = tap || rec ? new FrameReader((c, d) => { tap?.heard(c, d); rec?.down(c, d); }, !!rec) : null;
    const sent = rec ? new FrameReader((c, d) => rec.up(c, d), true) : null;
    const close = () => {
      if (closed) return; closed = true;
      try { if (!sock.destroyed) sock.end(frame(0x8, Buffer.alloc(0))); } catch (e){}
      game.destroy(); rec?.close();
      log?.debug?.('Ruffle socket closed');
    };
    game.on('data', d => { if (!sock.destroyed) sock.write(frame(0x2, d)); if (reader) try { reader.push(d); } catch (e){} });
    game.on('close', close); game.on('error', close);
    sock.on('close', close); sock.on('error', close);
    const onData = d => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      if (buf.length > MAX_BUFFER){ close(); return; }
      const r = parse(buf);
      if (!r){ close(); return; }
      buf = r[1];
      for (const f of r[0]){
        if (f.opcode === 0x0 || f.opcode === 0x1 || f.opcode === 0x2){ game.write(f.data); if (sent) try { sent.push(f.data); } catch (e){} }
        else if (f.opcode === 0x8){ close(); return; }
        else if (f.opcode === 0x9) sock.write(frame(0xA, f.data));
      }
    };
    sock.on('data', onData);
    if (first?.length) onData(Buffer.from(first)); // frames that came in the same packet as the upgrade request
    log?.info?.('Ruffle connected (WebSocket bridge to the game server)');
  });
}

// A /json client: JSON {cmd, data} text frames to and from the game.
function jsonSocket(sock, first, req, log, json, who = clientOf(req, req.socket?.remoteAddress || sock.remoteAddress)){
  const conn = new JsonConnection(sock, who.ip, json.onMessage, json.onClose, log, json.perf);
  conn.local = who.local; conn.device = who.device; conn.ua = who.ua; conn.country = who.country || '';
  let buf = Buffer.alloc(0);
  const close = () => { if (!sock.destroyed) try { sock.end(frame(0x8, Buffer.alloc(0))); } catch (e){} conn.closed_(); };
  sock.on('close', () => conn.closed_()); sock.on('error', close);
  sock.on('end', close);   // (a browser gone without a close frame: the http server keeps half-open sockets, so end ours)
  const onData = d => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    if (buf.length > MAX_BUFFER){ close(); return; }
    const r = parse(buf);
    if (!r){ close(); return; }
    buf = r[1];
    for (const f of r[0]){
      if (f.opcode <= 0x2){ try { conn.receive(f); } catch (e){ log?.error?.(`${conn.id}: ${e.stack || e.message}`); } }
      else if (f.opcode === 0x8){ close(); return; }
      else if (f.opcode === 0x9) sock.write(frame(0xA, f.data));
    }
  };
  sock.on('data', onData);
  if (first?.length) onData(Buffer.from(first));
  log?.info?.('New client connected (/json)');
}

module.exports = { attachSocketBridge, frame, parse, JsonConnection };
