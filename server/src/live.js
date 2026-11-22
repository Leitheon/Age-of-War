'use strict';
// Live mode: the new client (/play) on an official Evony server. The web side works as usual (the client, your SWF,
// the art cache), but nothing is played here: each /json connection from the browser opens a game socket to the
// official server and this passes the messages across, turning the client's JSON {cmd, data} into the Flash
// client's frames (4-byte length + AMF3 {cmd, data}) and the server's frames back into JSON. What reaches the
// official server is what the Flash client would have sent: the new client sends the same commands with the same
// fields, starting with gameClient.version "091103_11"; anonymous objects, whole numbers as AMF3 integers, as
// Flash writes them.
// Your password goes to the official server and nowhere else: it is never written to the log.
const net = require('net');
const zlib = require('zlib');
const amf3 = require('./amf3');

const MAX_MESSAGE = 16 * 1048576;
// Fields never shown in the log, at any depth.
const SECRET = /^(user|userName|pwd|password|pass|newPassword|oldPassword|email|mail|accountName|account|key|sid|session_key|secret)$/i;

// AMF3 values as plain JSON: Dates as milliseconds (how the client keeps every time), Dictionaries as objects, an
// array that only has named entries as an object; a reference back to an enclosing object (JSON can't) as null.
function plain(v, stack = new Set()){
  if (v === null || typeof v !== 'object') return typeof v === 'number' && !Number.isFinite(v) ? null : v;
  if (v instanceof Date) return v.getTime();
  if (Buffer.isBuffer(v)) return [...v];
  if (stack.has(v)) return null;
  stack.add(v);
  let out;
  if (v instanceof Map){ out = {}; for (const [k, x] of v) out[String(k)] = plain(x, stack); }
  else if (Array.isArray(v)){
    const named = Object.keys(v).filter(k => !/^\d+$/.test(k));
    if (named.length && !v.length){ out = {}; for (const k of named) out[k] = plain(v[k], stack); }
    else out = Array.from(v, x => plain(x, stack));
  } else { out = {}; for (const k of Object.keys(v)) out[k] = plain(v[k], stack); }
  stack.delete(v);
  return out;
}
// A message for the log: secrets blanked, cut short.
function shown(data){
  const hide = (v, d) => {
    if (v === null || typeof v !== 'object' || d > 6) return v;
    if (Array.isArray(v)) return v.slice(0, 20).map(x => hide(x, d + 1));
    const o = {}; for (const [k, x] of Object.entries(v)) o[k] = SECRET.test(k) ? '***' : hide(x, d + 1); return o;
  };
  const s = JSON.stringify(hide(data, 0)) ?? '';
  return s.length > 300 ? s.slice(0, 300) + '...' : s;
}

// One browser connection's game socket to the official server.
class LiveLink {
  // tap: the battle capture's view of this connection (battlelog.js), or null. rec: its recorder (recorder.js), or
  // null. upstream: how it reaches the official server (upstream.js: directly or through a proxy).
  constructor(conn, live, log, tap = null, rec = null, upstream = null){
    this.conn = conn; this.log = log; this.live = live; this.buf = Buffer.alloc(0); this.queue = []; this.ready = false; this.closed = false;
    this.tap = tap; this.rec = rec; this.swallow = 0;
    this.sock = (upstream || new (require('./upstream').Upstream)(live, log)).open();
    this.sock.setNoDelay(true);
    this.sock.setTimeout(20000, () => { if (!this.ready){ log.warn(`No answer from the official server at ${live.host}:${live.port} (${this.sock.via}).`); this.sock.destroy(); } });
    this.sock.on('up', () => {
      this.ready = true; this.sock.setTimeout(0);
      log.info(`Connected to the official server at ${live.host}:${live.port} (${this.sock.via})`);
      for (const b of this.queue) this.sock.write(b);
      this.queue = [];
    });
    this.sock.on('data', d => this.receive(d));
    this.sock.on('error', e => log.warn(`Official server ${live.host ? `${live.host}:${live.port}` : String(live.server || '').toUpperCase()}: ${e.code || e.message}`));
    this.sock.on('close', () => { if (!this.closed) log.info('The official server closed the game connection'); this.closed = true; this.rec?.close(); conn.close(); });
  }
  send(cmd, data){
    if (this.closed) return;
    if (this.live.logMessages) this.log.info(`-> ${cmd} ${cmd === 'login' || cmd === 'register' ? '' : shown(data)}`);
    this.write(cmd, data);
  }
  write(cmd, data){
    this.rec?.up(cmd, data);
    const body = amf3.encode({ cmd, data: data == null ? {} : data }), head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const frame = Buffer.concat([head, body]);
    if (this.ready) this.sock.write(frame); else this.queue.push(frame);
  }
  receive(d){
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 4){
      const word = this.buf.readUInt32BE(0), len = word & 0x7fffffff, zipped = word >>> 31 === 1;
      if (len > MAX_MESSAGE){ this.log.warn(`The official server sent an oversized message (${len} bytes); disconnecting`); this.sock.destroy(); return; }
      if (this.buf.length < 4 + len) return;
      let body = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      let msg;
      try { if (zipped) body = zlib.inflateSync(body); msg = amf3.decode(body); }
      catch (e){ this.log.warn(`Skipped a message from the official server that couldn't be read: ${e.message}`); continue; }
      if (!msg || typeof msg.cmd !== 'string'){ this.log.warn('Skipped a message from the official server without a command'); continue; }
      if (this.live.logMessages) this.log.info(`<- ${msg.cmd} ${shown(msg.data)}`);
      const data = plain(msg.data);
      this.rec?.down(msg.cmd, data);
      if (this.tap){
        this.tap.heard(msg.cmd, data);
        // The battle capture needs the research levels, which the client only asks for when the Academy opens: once
        // logged in, this asks for them as the Academy does, and keeps the answer from the client.
        if (msg.cmd === 'tech.getResearchList' && this.swallow > 0){ this.swallow--; continue; }
        const cid = msg.cmd === 'server.LoginResponse' && data?.ok === 1 ? data.player?.castles?.[0]?.id : undefined;
        if (cid != null && !this.askedResearch){ this.askedResearch = true; this.swallow++; this.write('tech.getResearchList', { castleId: cid }); }
      }
      this.conn.send(msg.cmd, data);
    }
  }
  close(){ if (!this.closed){ this.closed = true; this.sock.destroy(); this.rec?.close(); this.log.info('Game connection closed (the browser left)'); } }
}

// The /json handlers (ws.js): every browser connection gets its own game socket, opened with its first message.
// book: the battle capture (battlelog.js), recorder: recorder.js, or null; upstream: upstream.js. Ruffle's socket
// bridge (ws.js) uses the last three too.
function liveRelay(live, log, book = null, recorder = null, upstream = null){
  const links = new WeakMap();
  upstream = upstream || new (require('./upstream').Upstream)(live, log);
  return {
    onMessage(conn, cmd, data){
      let link = links.get(conn);
      if (!link){
        link = new LiveLink(conn, live, log, book ? book.tap('client') : null, recorder ? recorder.session('client') : null, upstream);
        links.set(conn, link); log.info(`New client: connecting it to the official server at ${live.host}:${live.port}`);
      }
      link.send(cmd, data);
    },
    onClose(conn){ links.get(conn)?.close(); },
    book, recorder, upstream,
  };
}

// The pages the local game would serve.
const PAGES = {
  '/coins': () => '<!doctype html><meta charset="utf-8"><title>Coins</title><body style="font:15px sans-serif;margin:40px">' +
    '<p>Coins are bought on the official site, not through this client.</p>',
  '/movingText.txt': () => ({ body: '', type: 'text/plain; charset=utf-8' }),
};

// live.server ('na62'): where that server's game socket is, from its config.xml, as RoboEvony and the official
// site find it (http://na62.evony.com/config.xml, <server>). The official servers are told apart only by address:
// the same login on another one's address plays there (Fox's bot on 216.66.17.168 found itself on CC2). Every
// connection to the official server waits for the answer (upstream.js); if it can't be had, live.host is used, or with
// live.lookupRequired (CA7's copy) nothing connects until it can.
// Returns a promise that always settles.
function lookupServer(live, log){
  const name = String(live.server || '').trim().toLowerCase();
  if (!name) return Promise.resolve(null);
  if (!/^[a-z0-9-]{1,30}$/.test(name)){
    if (live.lookupRequired){ live.lookupFailed = `live.server "${live.server}" isn't a server name like ca7`; log.error(`${live.lookupFailed}: nothing will connect.`); }
    else log.warn(`live.server "${live.server}" isn't a server name like na62: using live.host ${live.host}`);
    return Promise.resolve(null);
  }
  const url = String(live.configUrl || 'http://{server}.evony.com/config.xml').replace('{server}', name);
  const NAME = name.toUpperCase(), fallback = `${live.host}:${live.port}`;
  return new Promise(resolve => {
    // live.lookupRequired (config-ca7.json): no falling back to live.host, which may be another server's. Nothing
    // connects until the address is found; the next connection tries again (live.relookup, upstream.js).
    const fail = why => {
      live.lookupAt = Date.now();
      if (live.lookupRequired){ live.lookupFailed = `${NAME}'s address couldn't be found at ${url} (${why})`; log.error(`${live.lookupFailed}: nothing will connect until it is (it tries again when something connects), or set live.host in ${live.configName || 'the settings file'} and turn off live.lookupRequired.`); }
      else log.warn(`Couldn't find ${NAME}'s address at ${url} (${why}): using live.host ${fallback}. Check it is ${NAME}'s before logging in.`);
      resolve(null);
    };
    let req;
    try { req = require(/^https:/.test(url) ? 'https' : 'http').get(url, { timeout: 10000 }, res => {
      if (res.statusCode !== 200){ res.resume(); return fail(`HTTP ${res.statusCode}`); }
      const chunks = []; let size = 0;
      res.on('data', d => { size += d.length; if (size < 65536) chunks.push(d); });
      res.on('end', () => {
        const xml = Buffer.concat(chunks).toString('utf8');
        const id = (xml.match(/<serverID>\s*([^<]*?)\s*<\/serverID>/i) || [])[1] || '';
        const at = (xml.match(/<server>\s*([^<\s]+)\s*<\/server>/i) || [])[1] || '';
        if (id && id.toUpperCase() !== NAME) return fail(`it names server ${id}`);
        const m = at.match(/^\[?([^\]]+?)\]?(?::(\d+))?$/);
        if (!m || !/^[A-Za-z0-9.:-]+$/.test(m[1])) return fail('no server address in it');
        const was = fallback;
        live.host = m[1]; if (m[2]) live.port = Number(m[2]);
        live.lookupFailed = null; live.lookupAt = Date.now();
        const now = `${live.host}:${live.port}`;
        log.info(`${NAME} is at ${now} (from ${url})${now !== was ? `; config.json's live.host ${was} isn't used` : ''}`);
        resolve(now);
      });
      res.on('error', e => fail(e.code || e.message));
    }); } catch (e){ return fail(e.message); }
    req.on('timeout', () => req.destroy(new Error('no answer in 10 seconds')));
    req.on('error', e => fail(e.code || e.message));
  });
}

module.exports = { lookupServer, liveRelay, plain, shown, PAGES, LiveLink };
