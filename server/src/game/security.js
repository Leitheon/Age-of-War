'use strict';
// Security and the admin's powers (0.1.69; Fox, Nov 27 2026: "I want to restrict players from making alt accounts.
// It is time to implement security measures, and build out the admin page so I can investigate people's activity
// and take punitive action if needed"):
//   - Each browser carries its own id (the aow_d cookie: ws.js sets it on the game's WebSocket handshake, http.js on
//     the game page), and every sign-in records the account's address (behind the Cloudflare Tunnel, the
//     CF-Connecting-IP header), browser id and browser (User-Agent).
//   - One account per browser: a browser that already has an account can't sign up another, unless the admin
//     allowed that browser (a household's shared computer). Accounts that share a browser, or used the same address
//     within rules.security.linkDays, are linked on the admin page; the admin can mark a pair as allowed.
//   - E-mail aliases (name+tag@..., dots in a Gmail name) count as the same address.
//   - Sign-ups (rules.security.signupsPerDay an address) and wrong passwords (failsPer15Min an address or an
//     account) are throttled. The server's own computer (a connection from 127.0.0.1 not through the tunnel) is
//     exempt from the browser rule, the throttles and the address links.
//   - Bans (an account, an address or a browser; for a time or for good, with a reason the player is shown), chat
//     mutes, freezes (no transports, reinforcements or market trades with other lords), and taking back resources,
//     troops and items. Every admin action goes in the audit log (db.security.audit).
//   - The activity log (data/activity/YYYY-MM.jsonl; in memory when there's no data folder): sign-ups, sign-ins and
//     wrong passwords, transfers between lords (transports, reinforcements, market trades, policies) and battles
//     between lords.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const MIN = 60e3, DAY = 86400e3;
const KEEP = 40;                                     // addresses and browsers kept on an account (the most recent)
const DEVICE = /^[0-9a-f]{32}$/;
const when = t => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

// The address a request really came from. Through the Cloudflare Tunnel every connection arrives from cloudflared
// on this computer, with the player's own address in CF-Connecting-IP (or X-Forwarded-For); those headers are
// believed only from this computer, where nobody else can set them.
function loopback(ip){ return /^(127\.|::1$|::ffff:127\.)/.test(String(ip || '')); }
function clean(ip){ return String(ip || '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, ''); }
// The network an address belongs to, for the limits and bans: an IPv4 address is itself; an IPv6 address stands for
// its /64, the block one home connection or one rented server is given, inside which its owner can change address at
// will (Nov 28 2026: the scanner came back from 2a02:c207:2362:2888::1, a rented server at Contabo). Written with the
// first four groups, as 2a02:c207:2362:2888::/64; anything that isn't a plain address comes back as it was.
function netOf(ip){
  const s = clean(ip).toLowerCase().replace(/%.*$/, '');
  if (!s.includes(':') || s.includes('/') || s.includes('.')) return s;
  const halves = s.split('::'); if (halves.length > 2) return s;
  const head = halves[0] ? halves[0].split(':') : [], tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const parts = halves.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
  if (parts.length !== 8 || !parts.every(x => /^[0-9a-f]{1,4}$/.test(x))) return s;
  return parts.slice(0, 4).map(x => parseInt(x, 16).toString(16)).join(':') + '::/64';
}
function clientOf(req, sockIp){
  const peer = clean(sockIp), h = req?.headers || {};
  const fwd = loopback(peer) ? (h['cf-connecting-ip'] || String(h['x-forwarded-for'] || '').split(',')[0]) : '';
  const ip = clean(fwd) || peer;
  const device = (String(h.cookie || '').match(/(?:^|;\s*)aow_d=([0-9a-f]{32})/) || [])[1] || null;
  const https = /https/i.test(String(h['x-forwarded-proto'] || '')) || /https/i.test(String(h['cf-visitor'] || ''));
  return { ip, local: loopback(peer) && !clean(fwd), device, ua: String(h['user-agent'] || '').slice(0, 300), https };
}
const newDevice = () => crypto.randomBytes(16).toString('hex');
const deviceCookie = (id, https) => `aow_d=${id}; Max-Age=315360000; Path=/; SameSite=Lax; HttpOnly${https ? '; Secure' : ''}`;

// The same mailbox however it's dressed up: lower case, no +tag, and for Gmail no dots (googlemail.com is gmail.com).
function emailKey(e){
  const s = String(e || '').trim().toLowerCase(), at = s.lastIndexOf('@');
  if (at < 1) return s;
  let local = s.slice(0, at).split('+')[0], domain = s.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

class Security {
  constructor(game){ this.g = game; this.tries = new Map(); this.mem = []; this.seq = 0; }
  get rules(){ return this.g.rules.security || {}; }
  get db(){
    const s = (this.g.db.security ??= {});
    s.devices ??= {}; s.bans ??= {}; s.bans.ip ??= {}; s.bans.device ??= {}; s.allow ??= {}; s.audit ??= []; s.notes ??= {};
    return s;
  }
  touch(){ this.g.store.touch(); }
  accountOf(p){ return Object.values(this.g.db.accounts || {}).find(a => a.playerId === p?.id) || null; }
  playerOf(a){ return a?.playerId ? this.g.db.players[a.playerId] || null : null; }
  account(name){ return this.g.db.accounts?.[String(name || '').trim().toLowerCase()] || null; }

  // ---------- who is connecting ----------
  // A sign-in (or sign-up) by account a on connection conn: its address, browser and browser id, kept on the account
  // (the KEEP most recent of each) and in the activity log.
  seen(a, conn, how = 'signin', now = this.g.now()){
    const s = (a.seen ??= { ips: {}, devices: {} });
    const add = (map, key) => {
      if (!key) return;
      const e = (map[key] ??= { first: now, n: 0 }); e.last = now; e.n++;
      const keys = Object.keys(map);
      if (keys.length > KEEP) delete map[keys.reduce((x, y) => (map[x].last <= map[y].last ? x : y))];
    };
    if (!conn?.local) add(s.ips, conn?.ip);
    add(s.devices, conn?.device);
    if (conn?.ua) s.ua = conn.ua;
    if (conn?.device) (this.db.devices[conn.device] ??= { first: now, accounts: {} }).accounts[a.name.toLowerCase()] = now;
    this.touch();
    const p = this.playerOf(a);
    this.activity({ type: how, account: a.name, ids: p ? [p.id] : [], lord: p?.name, ip: conn?.ip, local: conn?.local || undefined, device: conn?.device || undefined, ua: conn?.ua || undefined }, now);
  }
  // The other accounts that have been signed into on browser `device`.
  othersOn(device, name = ''){
    const d = this.db.devices[device], me = String(name).toLowerCase();
    return d ? Object.keys(d.accounts).filter(n => n !== me && this.g.db.accounts?.[n]) : [];
  }
  // How many attempts under key came within the last ms (add: counting one more now). Kept with the world (db.tries),
  // so a restart doesn't start them over (Nov 28 2026: one address made 5 accounts in a day past the limit of 3, the
  // count lost each time the server was restarted for an update).
  attempts(key, ms, now = this.g.now(), add = false){
    const tries = (this.db.tries ??= {});
    if (this.tries.size){ for (const [k, v] of this.tries) tries[k] = [...(tries[k] || []), ...v]; this.tries.clear(); }
    const list = (tries[key] || []).filter(t => t > now - ms);
    if (add) list.push(now);
    if (list.length) tries[key] = list.slice(-200); else delete tries[key];
    if (add) this.touch();
    // (now and then, drop the keys nothing has been counted under for a day)
    if (add && Math.random() < 0.02) for (const [k, v] of Object.entries(tries)) if (!v.length || v[v.length - 1] < now - 86400000) delete tries[k];
    return list.length;
  }

  // ---------- bans ----------
  // A ban, mute or freeze is { until (ms; null: for good), reason, at }.
  live(b, now = this.g.now()){ return !!b && (b.until == null || b.until > now); }
  span(b){ return b.until == null ? 'permanently' : `until ${when(b.until)} UTC`; }
  banOf(a, now = this.g.now()){
    if (this.live(a?.ban, now)) return a.ban;
    const p = this.playerOf(a);
    return a?.closed || p?.banned ? { until: null, reason: a.ban?.reason || '' } : null;   // (closed before 0.1.69: for good)
  }
  // The ids of the lords whose accounts are banned now.
  bannedIds(now = this.g.now()){
    const out = new Set();
    for (const a of Object.values(this.g.db.accounts || {})) if (a.playerId && this.banOf(a, now)) out.add(a.playerId);
    return out;
  }
  // Why connection conn may not sign in as account a (a null: sign up), or null.
  refusal(conn, a, now = this.g.now()){
    const why = (what, b) => `${what} ${this.span(b)}${b.reason ? `. Reason: ${b.reason}` : '.'}`;
    const ab = a && this.banOf(a, now);
    if (ab) return why('This account is banned', ab);
    const ib = conn?.ip && !conn.local ? this.ipBan(conn.ip, now)?.[1] : null;
    if (ib) return why('Your network address is banned', ib);
    const db = conn?.device ? this.db.bans.device[conn.device] : null;
    if (this.live(db, now)) return why('This browser is banned', db);
    return null;
  }
  // Sign the lord of account a out everywhere (kicked with `reason` if online).
  kick(a, reason){
    for (const [k, s] of Object.entries(this.g.db.sessions || {})) if (s.account === a.name.toLowerCase()) delete this.g.db.sessions[k];
    const p = this.playerOf(a), conn = p && this.g.online.get(p.id);
    if (conn){ conn.send('kickout', { reason }); conn.close(); this.g.online.delete(p.id); }
    this.touch();
  }
  ban(a, until, reason, now = this.g.now()){
    a.ban = { until: until ?? null, reason: String(reason || ''), at: now };
    this.kick(a, `This account is banned ${this.span(a.ban)}${a.ban.reason ? `. Reason: ${a.ban.reason}` : '.'}`);
  }
  unban(a){
    delete a.ban; delete a.closed;
    const p = this.playerOf(a); if (p) delete p.banned;
    this.touch();
  }
  // The live ban on address ip, on it or on its network (netOf: an IPv6 /64), as [key, ban]; or null.
  ipBan(ip, now = this.g.now()){
    for (const k of new Set([ip, netOf(ip)])) if (k && this.live(this.db.bans.ip[k], now)) return [k, this.db.bans.ip[k]];
    return null;
  }
  // A ban on an address or a browser (kind 'ip' or 'device'); whoever is online on it is signed out. An IPv6 address
  // is banned with its /64 (netOf). Returns the key it was banned under.
  banKey(kind, key, until, reason, now = this.g.now()){
    if (kind === 'ip') key = netOf(key);
    const b = this.db.bans[kind][key] = { until: until ?? null, reason: String(reason || ''), at: now };
    for (const conn of [...this.g.online.values()]){
      if ((kind === 'ip' ? netOf(conn.ip) : conn.device) !== key || (kind === 'ip' && conn.local)) continue;
      const a = this.accountOf(conn.player);
      if (a) this.kick(a, `${kind === 'ip' ? 'Your network address' : 'This browser'} is banned ${this.span(b)}${b.reason ? `. Reason: ${b.reason}` : '.'}`);
    }
    this.touch();
    return key;
  }
  // Name guessing (rules.security.autoBan; Fox, Nov 28 2026: "can these be auto-banned?", of a scanner trying account
  // names one after another: aowtest, victim_aow, xalgorix_a2, aowreset1 ...). Wrong passwords for unknownNames
  // different names that have no account, from one network (netOf) within `minutes`, ban the network for `days`, and
  // the accounts made from it in the last accountsHours with it. A player mistyping his own name doesn't come near it.
  // Called for each sign-in with a name that has no account; returns what was banned, or null.
  guessed(conn, name, now = this.g.now()){
    const R = this.rules.autoBan || {}, need = R.unknownNames ?? 5;
    if (!(need > 0) || !conn?.ip || conn.local) return null;
    const net = netOf(conn.ip), ms = (R.minutes ?? 15) * 60e3, all = (this.db.guesses ??= {});
    const list = [...(all[net] || []).filter(e => e.t > now - ms), { t: now, name: String(name || '').slice(0, 40) }].slice(-50);
    all[net] = list; this.touch();
    if (Math.random() < 0.05) for (const [k, v] of Object.entries(all)) if (!v.length || v[v.length - 1].t < now - ms) delete all[k];
    const names = [...new Set(list.map(e => e.name))];
    if (names.length < need || this.ipBan(conn.ip, now)) return null;
    delete all[net];
    const until = R.days > 0 ? now + R.days * 86400e3 : null, since = now - (R.accountsHours ?? 24) * 3600e3, accounts = [];
    this.banKey('ip', net, until, 'Automatic: guessing account names', now);
    for (const a of Object.values(this.g.db.accounts || {})){
      if (!(a.createdAt > since) || this.banOf(a, now) || !Object.keys(a.seen?.ips || {}).some(ip => netOf(ip) === net)) continue;
      this.ban(a, until, 'Automatic: made from a network guessing account names', now); accounts.push(a.name);
    }
    const shown = names.map(n => n || '(blank)'), list6 = shown.slice(0, 8).join(', ') + (shown.length > 8 ? ' ...' : '');
    this.audit('automatically banned the address', net, `${this.span({ until })}, for trying ${names.length} account names that don't exist (${list6})${accounts.length ? `; its new accounts banned too: ${accounts.join(', ')}` : ''}`, now);
    this.activity({ type: 'autoban', ip: conn.ip, net, names: shown.slice(0, 20), banned: accounts, until, device: conn.device || undefined }, now);
    this.g.log.warn(`Banned ${net} automatically ${this.span({ until })}: it tried ${names.length} account names that don't exist (${list6})${accounts.length ? `; its new accounts ${accounts.join(', ')} too` : ''}`);
    return { net, names, accounts, until };
  }
  unbanKey(kind, key){ delete this.db.bans[kind][key]; this.touch(); }

  // ---------- mutes and freezes (on the lord) ----------
  muteOf(p, now = this.g.now()){ return this.live(p?.adminMute, now) ? p.adminMute : null; }
  mute(p, until, reason, now = this.g.now()){
    p.adminMute = { until: until ?? null, reason: String(reason || ''), at: now };
    this.g.chat.system(p.id, `You are muted ${this.span(p.adminMute)}${p.adminMute.reason ? `. Reason: ${p.adminMute.reason}` : '.'}`);
    this.touch();
  }
  unmute(p){ delete p.adminMute; this.touch(); }
  frozenOf(p, now = this.g.now()){ return this.live(p?.frozen, now) ? p.frozen : null; }
  // Frozen: no transports or reinforcements to or from other lords, and no market trades; his market orders are
  // called off (what they held comes back).
  freeze(p, until, reason, now = this.g.now()){
    p.frozen = { until: until ?? null, reason: String(reason || ''), at: now };
    const M = this.g.market;
    for (const o of Object.values(M.db().orders)) if (o.playerId === p.id){ const c = this.g.db.castles[o.castleId]; if (c){ M.cancel(c, p, o.id); this.g.pushResources(c); } }
    this.g.chat.system(p.id, `Your account is frozen ${this.span(p.frozen)}: no transports, reinforcements or market trades with other lords${p.frozen.reason ? `. Reason: ${p.frozen.reason}` : '.'}`);
    this.touch();
  }
  unfreeze(p){ delete p.frozen; this.touch(); }
  // Why lord p can't move goods or troops to or from lord q (q null: the market), or null.
  frozenWhy(p, q = null, now = this.g.now()){
    if (this.frozenOf(p, now)) return `Your account is frozen ${this.span(p.frozen)}: no transports, reinforcements or market trades with other lords.`;
    if (q && q.id !== p.id && this.frozenOf(q, now)) return `${q.name} can't receive transports or reinforcements right now.`;
    return null;
  }

  // ---------- taking back ----------
  // Take resources ({food: n, ...}), troops ({field: n}) from city c and items ({itemId: n}) from lord p, never below
  // zero. Returns what was actually taken.
  takeBack(p, c, { res = {}, troops = {}, items = {} } = {}){
    const took = { res: {}, troops: {}, items: {} }, g = this.g;
    if (c){
      g.logic.settle(c, p, g.now());
      for (const [k, n] of Object.entries(res)){ const t = Math.min(Math.max(0, Math.floor(n)), Math.floor(c.res[k] || 0)); if (t){ c.res[k] -= t; took.res[k] = t; } }
      for (const [k, n] of Object.entries(troops)){ const t = Math.min(Math.max(0, Math.floor(n)), c.troops[k] || 0); if (t){ c.troops[k] -= t; took.troops[k] = t; } }
      g.pushResources(c); g.pushTroops(c);
    }
    for (const [id, n] of Object.entries(items)){
      const t = Math.min(Math.max(0, Math.floor(n)), p.items?.[id] || 0);
      if (t && g.items.take(p, id, t)) took.items[id] = t;
    }
    if (Object.keys(took.items).length) g.pushItems(p, Object.keys(took.items));
    this.touch();
    return took;
  }

  // ---------- linked accounts ----------
  pairKey(a, b){ return 'pair:' + [String(a).toLowerCase(), String(b).toLowerCase()].sort().join('|'); }
  allowed(a, b){ return !!this.db.allow[this.pairKey(a, b)]; }
  // Accounts linked to account a: those signed into on a browser a used (browsers), and those that used an address a
  // used, both within rules.security.linkDays (addresses). Allowed pairs are marked, not dropped.
  links(a, now = this.g.now()){
    const me = a.name.toLowerCase(), out = new Map(), since = now - (this.rules.linkDays ?? 30) * DAY;
    const entry = n => { const b = this.g.db.accounts[n]; if (!out.has(n)) out.set(n, { account: b, browsers: [], addresses: [], allowed: this.allowed(me, n) }); return out.get(n); };
    for (const dev of Object.keys(a.seen?.devices || {})) for (const n of this.othersOn(dev, me)) entry(n).browsers.push(dev);
    const mine = Object.entries(a.seen?.ips || {}).filter(([, e]) => e.last >= since).map(([ip]) => ip);
    if (mine.length) for (const [n, b] of Object.entries(this.g.db.accounts || {})){
      if (n === me) continue;
      for (const ip of mine){ const e = b.seen?.ips?.[ip]; if (e && e.last >= since) entry(n).addresses.push(ip); }
    }
    return [...out.values()].filter(l => l.browsers.length || l.addresses.length)
      .sort((x, y) => y.browsers.length - x.browsers.length || y.addresses.length - x.addresses.length);
  }
  // Groups of accounts linked by browsers or addresses (allowed pairs left out), most suspicious first.
  groups(now = this.g.now()){
    const names = Object.keys(this.g.db.accounts || {}), parent = new Map(names.map(n => [n, n]));
    const find = n => { while (parent.get(n) !== n){ parent.set(n, parent.get(parent.get(n))); n = parent.get(n); } return n; };
    const edges = [];
    for (const n of names) for (const l of this.links(this.g.db.accounts[n], now)){
      const m = l.account.name.toLowerCase();
      if (m <= n || l.allowed) continue;
      edges.push({ a: n, b: m, browsers: l.browsers.length, addresses: l.addresses.length });
      parent.set(find(n), find(m));
    }
    const groups = new Map();
    for (const e of edges){ const r = find(e.a); if (!groups.has(r)) groups.set(r, { names: new Set(), edges: [] }); const gr = groups.get(r); gr.names.add(e.a); gr.names.add(e.b); gr.edges.push(e); }
    return [...groups.values()].map(gr => ({ names: [...gr.names], edges: gr.edges, browsers: gr.edges.some(e => e.browsers) }))
      .sort((x, y) => Number(y.browsers) - Number(x.browsers) || y.names.length - x.names.length);
  }

  // ---------- the logs ----------
  dir(){ return this.g.dataDir ? path.join(this.g.dataDir, 'activity') : null; }
  // One event in the activity log: { type, ids (the lords it concerns), ... }.
  activity(ev, now = this.g.now()){
    const line = { t: now, n: ++this.seq, ...ev };
    this.mem.push(line); if (this.mem.length > 5000) this.mem.splice(0, this.mem.length - 5000);
    const dir = this.dir(); if (!dir) return line;
    try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, new Date(now).toISOString().slice(0, 7) + '.jsonl'), JSON.stringify(line) + '\n'); }
    catch (e){ this.g.log.warn(`The activity log couldn't be written: ${e.message}`); }
    return line;
  }
  // The newest events first: of lord ids (any side) or account names, of types, at most max, from the last months.
  events({ ids = null, accounts = null, types = null, max = 300, months = 3 } = {}){
    let lines = [];
    const dir = this.dir();
    if (dir && fs.existsSync(dir)){
      const files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort().reverse().slice(0, months);
      for (const f of files){
        for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')){ if (!l) continue; try { lines.push(JSON.parse(l)); } catch (e){} }
      }
    } else lines = [...this.mem];
    const idSet = ids && new Set(ids.map(Number)), accSet = accounts && new Set(accounts.map(s => String(s).toLowerCase()));
    return lines.filter(e => (!types || types.includes(e.type))
        && (!idSet && !accSet || (idSet && (e.ids || []).some(i => idSet.has(i))) || (accSet && e.account && accSet.has(String(e.account).toLowerCase()))))
      .sort((x, y) => y.t - x.t || (y.n || 0) - (x.n || 0)).slice(0, max);
  }
  // An admin action, in the audit log (the newest rules.security.auditMax kept) and the server window.
  audit(action, target, detail = '', now = this.g.now()){
    const list = this.db.audit;
    list.push({ t: now, action, target: String(target || ''), detail: String(detail || '') });
    const max = this.rules.auditMax ?? 5000; if (list.length > max) list.splice(0, list.length - max);
    this.touch();
    this.g.log.info(`Admin: ${action}${target ? ' ' + target : ''}${detail ? ` (${detail})` : ''}`);
  }
}

module.exports = { Security, clientOf, newDevice, deviceCookie, emailKey, DEVICE, loopback, netOf };
