'use strict';
// Live mode's recorder (live.record): every message between the official server and what this program passes to
// it (the new client, Ruffle, RoboEvony on the bot port), both ways, decoded to JSON lines in data/recordings, one
// file an hour (UTC), gzipped once the hour is over. It is what the engine gets fitted to: build and training
// times, costs, policies, rewards, whatever the live game answered.
//   {"t":<ms>,"s":"b3.k3x9","src":"bot","ev":"open","srv":"cc2"}    a connection (b bot, c new client, r Ruffle; .k3x9 the run; srv the server)
//   {"t":<ms>,"s":"b3","ev":"login","lord":"Name"}                   who it plays
//   {"t":<ms>,"s":"b3","d":">","cmd":"castle.newBuilding","data":{...}}   to the official server (">") or from it ("<")
//   {"t":<ms>,"s":"b3","ev":"close"}
// Secrets never reach the file: login, register, the Security Code, passwords and e-mail commands are written
// without their data, every field named like a password, account, user name, e-mail or session key is dropped at
// any depth, and anything that looks like an e-mail address is blanked (battlelog.clean). Chat and players' mail
// aren't recorded (live.record.skip).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream');
const { clean } = require('./battlelog');

const SKIP = ['common.allianceChat', 'common.channelChat', 'common.privateChat', 'common.worldChat', 'server.AllianceChatMsg', 'server.ChannelChatMsg',
  'server.PrivateChatMessage', 'server.WorldChatMsg', 'mail.sendMail', 'mail.readMail'];
const BLANK = /^login$|register|securitycode|password|email/i;
// (A file's name starts with the server it was recorded on, as cc2_2026-11-17_15.jsonl.gz: live.server.)
const FILE = /^(?:[a-z0-9-]{1,30}_)?\d{4}-\d{2}-\d{2}_\d{2}\.jsonl(\.gz)?$/;
const SOURCES = { bot: 'b', client: 'c', ruffle: 'r' };
const hourOf = ms => new Date(ms).toISOString().slice(0, 13).replace('T', '_');

class Recorder {
  constructor(dataDir, log, opts = {}, now = Date.now){
    this.dir = path.join(dataDir, 'recordings'); this.log = log; this.now = now;
    this.server = /^[a-z0-9-]{1,30}$/.test(String(opts.server || '')) ? String(opts.server) : '';
    this.prefix = this.server ? `${this.server}_` : '';
    this.skip = new Set(opts.skip ?? SKIP);
    this.maxBytes = (opts.maxMBPerDay ?? 4096) * 1048576;
    this.n = 0; this.run = Math.floor(now() / 1000).toString(36).slice(-4); this.out = null; this.hour = null; this.day = null; this.dayBytes = 0; this.full = false; this.broken = false;
    this.since = now(); this.lines = 0; this.bytes = 0; this.byCmd = new Map(); this.sessions = new Map();
    fs.mkdirSync(this.dir, { recursive: true });
    this.packOld();
  }
  // Every finished hour gzipped (left over from an earlier run, or just finished).
  packOld(){
    const cur = `${this.prefix}${this.hour || hourOf(this.now())}.jsonl`;   // (this hour's file is carried on)
    for (const f of fs.readdirSync(this.dir)) if (/\.jsonl$/.test(f) && f !== cur && FILE.test(f)) this.pack(path.join(this.dir, f));
  }
  pack(file){
    if (!fs.existsSync(file) || fs.existsSync(file + '.gz')) return;
    pipeline(fs.createReadStream(file), zlib.createGzip(), fs.createWriteStream(file + '.gz'), err => {
      if (err){ this.log.warn(`Recorder: couldn't gzip ${path.basename(file)}: ${err.message}`); try { fs.unlinkSync(file + '.gz'); } catch (e){} return; }
      try { fs.unlinkSync(file); } catch (e){}
    });
  }
  // A connection's recorder: up() for what goes to the official server, down() for what comes back.
  session(source){
    // (b12.k3x9: the 12th connection since this program started, then the start's own tag, so a later run's b12
    // can't be mistaken for this one in the files.)
    const s = { id: `${SOURCES[source] || 'x'}${++this.n}.${this.run}`, src: source, lord: '', msgs: 0, open: true, at: this.now() };
    s.up = (cmd, data) => this.put(s, '>', cmd, data);
    s.down = (cmd, data) => this.put(s, '<', cmd, data);
    s.close = () => { if (!s.open) return; s.open = false; this.line({ t: this.now(), s: s.id, ev: 'close' }); };
    this.sessions.set(s.id, s);
    if (this.sessions.size > 200) for (const [id, x] of this.sessions) if (!x.open){ this.sessions.delete(id); if (this.sessions.size <= 200) break; }
    this.line({ t: s.at, s: s.id, src: source, ev: 'open', ...(this.server ? { srv: this.server } : {}) });
    return s;
  }
  put(s, d, cmd, data){
    if (typeof cmd !== 'string' || this.skip.has(cmd)) return;
    const t = this.now();
    if (d === '<' && cmd === 'server.LoginResponse' && data?.ok === 1){
      const lord = String(data.player?.playerInfo?.userName || '');
      if (lord && lord !== s.lord){ s.lord = lord; this.line({ t, s: s.id, ev: 'login', lord }); }
    }
    let body;
    try { body = BLANK.test(cmd) ? undefined : clean(data); } catch (e){ body = null; }
    s.msgs++;
    const n = this.line({ t, s: s.id, d, cmd, data: body });
    const k = `${d} ${cmd}`, c = this.byCmd.get(k) || { n: 0, bytes: 0 };
    c.n++; c.bytes += n; this.byCmd.set(k, c);
  }
  line(o){
    if (this.broken) return 0;
    const t = o.t || this.now(), hour = hourOf(t), day = hour.slice(0, 10);
    if (day !== this.day){ this.day = day; this.dayBytes = 0; this.full = false; }
    if (this.full) return 0;
    let str;
    try { str = JSON.stringify(o) + '\n'; } catch (e){ return 0; }
    if (this.dayBytes + str.length > this.maxBytes){
      this.full = true;
      this.log.warn(`Recorder: today's ${Math.round(this.maxBytes / 1048576)} MB are written; nothing more is recorded until midnight UTC (live.record.maxMBPerDay).`);
      return 0;
    }
    if (hour !== this.hour){
      const was = this.out && path.join(this.dir, `${this.prefix}${this.hour}.jsonl`);
      if (this.out){ this.out.end(() => this.pack(was)); }
      this.hour = hour;
      this.out = fs.createWriteStream(path.join(this.dir, `${this.prefix}${hour}.jsonl`), { flags: 'a' });
      this.out.on('error', e => { this.broken = true; this.log.error(`Recorder: can't write ${this.dir}: ${e.message}. Recording stopped.`); });
    }
    this.out.write(str);
    this.dayBytes += str.length; this.bytes += str.length; this.lines++;
    return str.length;
  }
  files(){
    try { return fs.readdirSync(this.dir).filter(f => FILE.test(f)).sort().reverse().map(f => ({ name: f, size: fs.statSync(path.join(this.dir, f)).size })); }
    catch (e){ return []; }
  }
  file(name){ return FILE.test(String(name)) ? path.join(this.dir, name) : null; }
  close(){ for (const s of this.sessions.values()) s.close(); if (this.out){ const was = path.join(this.dir, `${this.prefix}${this.hour}.jsonl`); this.out.end(); this.out = null; return was; } return null; }
}

// ---------- /recordings ----------
const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const n = v => Number(v || 0).toLocaleString('en-US');
const size = b => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const SRC = { bot: 'RoboEvony', client: 'New client', ruffle: 'Ruffle' };
const ago = ms => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

function recordingsPage(rec, upstream){
  const now = rec.now(), files = rec.files(), sessions = [...rec.sessions.values()].sort((a, b) => b.at - a.at);
  const cmds = [...rec.byCmd.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 60);
  const up = upstream?.status();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live Recordings</title>
<style>
:root{--bg:#fbf4e6;--panel:#fff;--ink:#3a2a14;--dim:#8a7558;--line:#e3d2b0;--accent:#a35a10;--ok:#2f7d32;--warn:#b03a2e}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#1c1812;--panel:#26201a;--ink:#efe3cc;--dim:#a8957a;--line:#3d3326;--accent:#f0a24a;--ok:#7cc47f;--warn:#ef7a6c}}
:root[data-theme="dark"]{--bg:#1c1812;--panel:#26201a;--ink:#efe3cc;--dim:#a8957a;--line:#3d3326;--accent:#f0a24a;--ok:#7cc47f;--warn:#ef7a6c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,Segoe UI,Tahoma,sans-serif}
header,main{max-width:1100px;margin:0 auto;padding:20px 16px 4px}h1{margin:0 0 4px;font-size:22px}h2{font-size:15px;margin:22px 0 8px}
a{color:var(--accent)}.dim{color:var(--dim)}.warn{color:var(--warn);font-weight:600}.ok{color:var(--ok);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
table{border-collapse:collapse;width:100%;background:var(--panel);border:1px solid var(--line)}
th,td{padding:6px 9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--dim)}
td.r{text-align:right;white-space:nowrap}code{font-size:13px}.wrap{overflow-x:auto}
</style></head><body>
<header><h1>Live recordings${rec.server ? ` · ${esc(rec.server.toUpperCase())}` : ''}</h1>
<p>${rec.broken ? '<span class="warn">Stopped: the folder can\'t be written.</span>' : rec.full ? `<span class="warn">Today's ${size(rec.maxBytes)} are written; recording resumes at midnight UTC.</span>` : '<span class="ok">Recording</span>'}
 · ${n(rec.lines)} messages (${size(rec.bytes)}) since this program started, ${ago(now - rec.since)} ago · today ${size(rec.dayBytes)} of ${size(rec.maxBytes)}
 · <a href="/battles">Captured battles</a></p>
<p class="dim">Everything RoboEvony (Server set to this program's address), the new client and Ruffle exchange with the official server, both ways, in <code>${esc(rec.dir)}</code>: an hour a file, gzipped when the hour is over. Passwords, the Security Code, account names, e-mail addresses and session keys are never written; chat and players' mail aren't recorded. Send the files over to fit the engine.</p>
${up ? `<p class="dim">Connections to the official server: ${up.direct} of ${up.directMax} direct${up.proxies.map(p => ` · ${p.used} of ${p.max} through ${esc(p.at)}`).join('')}.</p>` : ''}
</header><main>
<div class="grid"><div>
<h2>Connections</h2>
${sessions.length ? `<div class="wrap"><table><thead><tr><th>Id</th><th>From</th><th>Lord</th><th>Messages</th><th></th></tr></thead><tbody>
${sessions.slice(0, 80).map(s => `<tr><td>${esc(s.id)}</td><td>${esc(SRC[s.src] || s.src)}</td><td>${esc(s.lord || '—')}</td><td class="r">${n(s.msgs)}</td><td class="dim">${s.open ? 'connected' : 'closed'}, ${ago(now - s.at)} ago</td></tr>`).join('\n')}
</tbody></table></div>` : '<p class="dim">None yet. Point RoboEvony\'s Server at this program, or play in the new client.</p>'}
<h2>Files</h2>
${files.length ? `<div class="wrap"><table><thead><tr><th>Hour (UTC)</th><th>Size</th><th></th></tr></thead><tbody>
${files.slice(0, 200).map(f => `<tr><td><code>${esc(f.name)}</code></td><td class="r">${size(f.size)}</td><td><a href="/recordings/${esc(f.name)}" download>Download</a></td></tr>`).join('\n')}
</tbody></table></div>` : '<p class="dim">No files yet.</p>'}
</div><div>
<h2>Most frequent messages</h2>
${cmds.length ? `<div class="wrap"><table><thead><tr><th>Message</th><th>Count</th><th>Size</th></tr></thead><tbody>
${cmds.map(([k, c]) => `<tr><td><code>${esc(k)}</code></td><td class="r">${n(c.n)}</td><td class="r">${size(c.bytes)}</td></tr>`).join('\n')}
</tbody></table></div>` : '<p class="dim">Nothing recorded since this program started.</p>'}
</div></div></main></body></html>`;
}

module.exports = { Recorder, recordingsPage, SKIP, BLANK };
