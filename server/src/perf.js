'use strict';
// Server speed: how long the server takes to answer each kind of command, the once-a-second tick and saving,
// how long the event loop was ever held up (a stall delays every reply and push), how much it sends, and how the
// art was served. Shown on the debug menu, so you can tell whether lag comes from the server or the client.
const { monitorEventLoopDelay } = require('perf_hooks');

const SLOW_MS = 250;
const stat = () => ({ n: 0, total: 0, max: 0 });
const add = (s, ms) => { s.n++; s.total += ms; if (ms > s.max) s.max = ms; };

class Perf {
  constructor(log){ this.log = log; this.reset(); }
  reset(){
    this.since = Date.now();
    this.cmds = new Map(); this.tick = stat(); this.save = stat(); this.saveBytes = 0;
    this.sent = { n: 0, bytes: 0, byCmd: new Map() }; this.art = { cache: 0, fetched: stat(), missing: 0 };
    this.slow = []; this.lastWarn = 0;
    try { this.loop?.disable(); this.loop = monitorEventLoopDelay({ resolution: 20 }); this.loop.enable(); } catch (e){ this.loop = null; }
  }
  now(){ return Number(process.hrtime.bigint()) / 1e6; }
  // kind: 'cmd' (name = the command), 'tick', 'save' or 'art'.
  record(kind, name, ms){
    if (kind === 'cmd'){ let s = this.cmds.get(name); if (!s) this.cmds.set(name, s = stat()); add(s, ms); }
    else if (kind === 'tick') add(this.tick, ms);
    else if (kind === 'save') add(this.save, ms);
    else if (kind === 'art') add(this.art.fetched, ms);
    if (ms >= SLOW_MS && kind !== 'art'){
      this.slow.unshift({ at: Date.now(), what: kind === 'cmd' ? name : kind, ms: Math.round(ms) }); this.slow.length = Math.min(this.slow.length, 12);
      if (Date.now() - this.lastWarn > 10000){ this.lastWarn = Date.now(); this.log?.warn(`Slow: ${kind === 'cmd' ? name : kind} took ${Math.round(ms)} ms`); }
    }
  }
  sentMsg(cmd, bytes){ this.sent.n++; this.sent.bytes += bytes; this.sent.byCmd.set(cmd, (this.sent.byCmd.get(cmd) || 0) + 1); }
  // A plain summary for the debug menu.
  summary(){
    const mins = Math.max(1 / 60, (Date.now() - this.since) / 60000), avg = s => s.n ? s.total / s.n : 0;
    const loop = this.loop ? { p50: this.loop.percentile(50) / 1e6, p99: this.loop.percentile(99) / 1e6, max: this.loop.max / 1e6 } : null;
    const cmds = [...this.cmds.entries()].map(([cmd, s]) => ({ cmd, n: s.n, avg: avg(s), max: s.max }));
    const all = cmds.reduce((a, c) => ({ n: a.n + c.n, total: a.total + c.avg * c.n, max: Math.max(a.max, c.max) }), { n: 0, total: 0, max: 0 });
    return { minutes: mins, loop, cmds: cmds.sort((a, b) => b.max - a.max), all: { n: all.n, avg: all.n ? all.total / all.n : 0, max: all.max },
      tick: { n: this.tick.n, avg: avg(this.tick), max: this.tick.max }, save: { n: this.save.n, avg: avg(this.save), max: this.save.max, bytes: this.saveBytes },
      sent: { n: this.sent.n, perMin: this.sent.n / mins, kbPerMin: this.sent.bytes / 1024 / mins, top: [...this.sent.byCmd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6) },
      art: { cache: this.art.cache, fetched: this.art.fetched.n, fetchAvg: avg(this.art.fetched), fetchMax: this.art.fetched.max, missing: this.art.missing },
      slow: this.slow };
  }
}

module.exports = { Perf, SLOW_MS };
