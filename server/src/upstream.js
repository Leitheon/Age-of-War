'use strict';
// Live mode's connections to the official server. It takes only so many connections from one address (15, Fox), so
// with more than that going through this program (RoboEvony accounts on the bot port, the new client, Ruffle) the
// rest can go out through SOCKS5 proxies (live.upstream): the first `direct` straight from this PC, then each proxy
// in turn up to its `max`. A proxy's user name and password go to that proxy and nowhere else: they are never
// written to the log, and errors name only the proxy's address.
const net = require('net');
const { Duplex } = require('stream');

// A connection to the official server as the rest of the program sees it, direct or through a proxy: what it
// writes waits until the official server can be talked to, and nothing a proxy says reaches it. Emits 'up' then.
// (It may also wait for the server's address to be looked up first: live.lookup.)
class Link extends Duplex {
  constructor(){ super(); this.raw = null; this.isUp = false; this.waiting = []; this.nd = false; this.timer = null; this.via = 'waiting'; }
  _write(chunk, enc, cb){ if (this.isUp) this.raw.write(chunk, cb); else this.waiting.push([chunk, cb]); }
  _final(cb){ if (this.isUp) this.raw.end(cb); else { this.raw?.destroy(); cb(); } }
  _read(){ if (this.isUp) this.raw.resume(); }
  _destroy(err, cb){ clearTimeout(this.timer); this.raw?.destroy(); for (const [, w] of this.waiting) w(err || new Error('closed')); this.waiting = []; cb(err); }
  setNoDelay(v = true){ this.nd = v; this.raw?.setNoDelay(v); return this; }
  // (Only to notice an official server that never answers: one timer, 0 clears it.)
  setTimeout(ms, fn){ clearTimeout(this.timer); this.timer = null; if (fn) this.once('timeout', fn); if (ms > 0) this.timer = setTimeout(() => this.emit('timeout'), ms); return this; }
  attach(raw, wrap = e => e){
    this.raw = raw; raw.setNoDelay(this.nd);
    raw.on('error', e => this.destroy(wrap(e)));
    raw.on('close', () => this.destroy());
    if (this.destroyed) raw.destroy();
    return raw;
  }
  ready(rest){
    if (this.destroyed) return;
    this.isUp = true;
    if (rest?.length) this.push(rest);
    this.raw.on('data', d => { if (!this.push(d)) this.raw.pause(); });
    this.raw.on('end', () => this.push(null));
    for (const [c, cb] of this.waiting) this.raw.write(c, cb);
    this.waiting = [];
    this.emit('up');
  }
}

// RFC 1928 and 1929: the greeting, a user name and password if the proxy wants one, then CONNECT host:port.
// done(err) or done(null, bytes that came after the proxy's answer).
function socks5(raw, host, port, proxy, done){
  const auth = proxy.user != null && proxy.user !== '';
  let buf = Buffer.alloc(0), step = 'method', over = false;
  const finish = (err, rest) => { if (over) return; over = true; raw.removeListener('data', on); done(err, rest); };
  const request = () => {
    const ip = net.isIPv4(host), name = Buffer.from(String(host));
    const addr = ip ? Buffer.from(host.split('.').map(Number)) : Buffer.concat([Buffer.from([name.length]), name]);
    const pb = Buffer.alloc(2); pb.writeUInt16BE(port);
    raw.write(Buffer.concat([Buffer.from([5, 1, 0, ip ? 1 : 3]), addr, pb]));
    step = 'reply';
  };
  const on = d => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    if (step === 'method'){
      if (buf.length < 2) return;
      if (buf[0] !== 5) return finish(new Error('it isn\'t a SOCKS5 proxy'));
      const m = buf[1]; buf = buf.subarray(2);
      if (m === 2 && auth){
        const u = Buffer.from(String(proxy.user)), pw = Buffer.from(String(proxy.pass ?? proxy.password ?? ''));
        raw.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([pw.length]), pw]));
        step = 'auth';
      } else if (m === 0) request();
      else return finish(new Error(m === 2 ? 'it wants a user name and password (set user and pass)' : 'it accepts none of our sign-in methods'));
    }
    if (step === 'auth'){
      if (buf.length < 2) return;
      if (buf[1] !== 0) return finish(new Error('it refused the user name or password'));
      buf = buf.subarray(2); request();
    }
    if (step === 'reply'){
      if (buf.length < 5) return;
      if (buf[1] !== 0) return finish(new Error(`it couldn't reach the official server (SOCKS reply ${buf[1]})`));
      const atyp = buf[3], len = atyp === 1 ? 10 : atyp === 4 ? 22 : atyp === 3 ? 7 + buf[4] : 0;
      if (!len) return finish(new Error('it answered in a way this program doesn\'t know'));
      if (buf.length < len) return;
      finish(null, buf.subarray(len));
    }
  };
  raw.on('data', on);
  raw.write(Buffer.from(auth ? [5, 2, 0, 2] : [5, 1, 0]));
}

class Upstream {
  constructor(live, log){ this.live = live; this.log = log; this.direct = 0; this.through = new Map(); this.warned = 0; }
  get cfg(){ return this.live.upstream || {}; }
  proxies(){ return (this.cfg.proxies || []).filter(p => p && p.host); }
  // Where the next connection goes: direct while there is room, then the first proxy with room. With every one
  // full, direct anyway (the official server may well refuse it).
  pick(){
    const list = this.proxies(), directMax = this.cfg.direct ?? 15;
    if (!list.length || this.direct < directMax) return null;
    const p = list.find(x => (this.through.get(x) || 0) < (x.max ?? 15));
    if (!p && Date.now() - this.warned > 60000){
      this.warned = Date.now();
      this.log.warn(`All ${directMax} direct connections and every proxy's are in use: this one goes direct, and the official server may refuse it (live.upstream in config.json).`);
    }
    return p || null;
  }
  // A socket to the official server: emits 'up' when it can be talked to, and 'error' and 'close' as usual. While
  // the official server's address is being looked up (live.lookup), it waits for that first.
  open(){
    const s = new Link();
    const go = () => {
      if (s.destroyed) return;
      if (this.live.lookupRequired && (this.live.lookupFailed || !this.live.host)) return s.destroy(new Error(this.live.lookupFailed || 'no server address yet'));
      const { host, port } = this.live, via = this.pick();
      if (!via){
        this.direct++;
        s.attach(net.connect({ host, port })).once('connect', () => s.ready());
      } else {
        this.through.set(via, (this.through.get(via) || 0) + 1);
        const where = `${via.host}:${via.port || 1080}`;
        const raw = s.attach(net.connect({ host: via.host, port: via.port || 1080 }), e => e.message?.startsWith('proxy ') ? e : new Error(`proxy ${where}: ${e.code || e.message}`));
        raw.once('connect', () => socks5(raw, host, port, via, (err, rest) => err ? s.destroy(new Error(`proxy ${where}: ${err.message}`)) : s.ready(rest)));
      }
      let done = false;
      s.on('close', () => { if (done) return; done = true; if (via) this.through.set(via, this.through.get(via) - 1); else this.direct--; });
      s.via = via ? `proxy ${via.host}:${via.port || 1080}` : 'direct';
    };
    // A lookup that failed (live.lookupRequired) is tried again, at most every 30 seconds, before this one goes.
    if (this.live.lookupFailed && this.live.relookup && Date.now() - (this.live.lookupAt || 0) > 30000){ this.live.lookupAt = Date.now(); this.live.relookup(); }
    if (this.live.lookup && typeof this.live.lookup.then === 'function') this.live.lookup.then(go, go); else go();
    return s;
  }
  // How the connections stand, for the log and the recordings page.
  status(){
    return { direct: this.direct, directMax: this.cfg.direct ?? 15, proxies: this.proxies().map(p => ({ at: `${p.host}:${p.port || 1080}`, used: this.through.get(p) || 0, max: p.max ?? 15 })) };
  }
}

module.exports = { Upstream, Link, socks5 };
