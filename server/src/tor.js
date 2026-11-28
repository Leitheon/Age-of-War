'use strict';
// Tor exits (Fox, Nov 28 2026: ten bot accounts in ten minutes, each from another Tor exit, so no per-address limit
// could hold them). The Tor Project publishes the addresses its exits leave from, one a line, at TOR_LIST; it's
// fetched when the server starts and every REFRESH_HOURS, and kept in data/tor-exits.txt so a restart without the
// internet still knows them. (Cloudflare also marks a Tor visitor's country T1, in the CF-IPCountry header, when its
// IP Geolocation is on: ws.js notes that on the connection.) What's refused is rules.security.blockTor (security.js).
const fs = require('fs'), https = require('https');

const TOR_LIST = 'https://check.torproject.org/torbulkexitlist', REFRESH_HOURS = 1, MAX_BYTES = 4 * 1048576;
const ADDRESS = /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i;

class TorExits {
  constructor(file, log){
    this.file = file; this.log = log; this.set = new Set(); this.at = 0; this.timer = null;
    try {
      const text = fs.readFileSync(file, 'utf8');
      this.load(text);
      this.at = fs.statSync(file).mtimeMs;
    } catch (e){}
  }
  load(text){
    const list = String(text).split(/\r?\n/).map(l => l.trim().toLowerCase()).filter(l => l && !l.startsWith('#') && ADDRESS.test(l));
    if (list.length) this.set = new Set(list);
    return list.length;
  }
  has(ip){ return !!ip && this.set.has(String(ip).toLowerCase().replace(/^::ffff:/, '')); }
  get size(){ return this.set.size; }
  // Fetch the list now (once at a time); keeps the last one if this fails.
  refresh(){
    if (this.busy) return this.busy;
    this.busy = new Promise(resolve => {
      const req = https.get(TOR_LIST, { timeout: 20000, headers: { 'User-Agent': 'AgeOfWar-server' } }, res => {
        if (res.statusCode !== 200){ res.resume(); this.log.warn(`Tor exit list: HTTP ${res.statusCode}; keeping the last one (${this.size} addresses)`); return resolve(false); }
        const parts = []; let n = 0;
        res.on('data', d => { n += d.length; if (n > MAX_BYTES) req.destroy(new Error('too big')); else parts.push(d); });
        res.on('end', () => {
          const text = Buffer.concat(parts).toString('utf8'), count = this.load(text);
          if (count){ this.at = Date.now(); try { fs.writeFileSync(this.file, text); } catch (e){} this.log.info(`Tor exit list: ${count} addresses`); }
          resolve(count > 0);
        });
      });
      req.on('timeout', () => req.destroy(new Error('timed out')));
      req.on('error', e => { this.log.warn(`Tor exit list: ${e.message}; keeping the last one (${this.size} addresses)`); resolve(false); });
    }).finally(() => { this.busy = null; });
    return this.busy;
  }
  start(){
    if (Date.now() - this.at > REFRESH_HOURS * 3600e3 / 2) this.refresh();
    this.timer = setInterval(() => this.refresh(), REFRESH_HOURS * 3600e3); this.timer.unref?.();
  }
  stop(){ clearInterval(this.timer); }
}

module.exports = { TorExits, TOR_LIST };
