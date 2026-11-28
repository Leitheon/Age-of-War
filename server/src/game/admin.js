'use strict';
// The admin page (/admin, behind the admin password; 0.1.69): look into accounts and act on them (security.js).
//   Overview: what needs a look (linked accounts, refused sign-ups, wrong passwords), the newest accounts.
//   Accounts: every account with its state; a search box finds an account, a lord or an address.
//   Player: an account's lord, cities, sign-ins (addresses and browsers), linked accounts and activity; ban, mute,
//     freeze, sign out, take back resources, troops and items, a password reset link, notes, the debug menu.
//   Linked accounts: groups sharing a browser or an address; a pair can be marked allowed (a household).
//   Activity: the activity log, by kind and lord. Bans: address and browser bans, allowed browsers and pairs.
//   Audit log: every admin action.
//   Items: every item in the game's item table, with what it does, what a chest opens to here, its gold-shop price,
//          a link to gift it, and the whole list as a spreadsheet file.
//   Gifts: an item to every lord at once, and to new lords for so many days (gifts.js).
//   Backups: the automatic copies of the world (backups.js) and the ones made before a fresh start.
//   Fresh start: wipe the world and keep the accounts (game.wipeWorld), with a copy of the old world kept.
//   Banner (on the overview): the line scrolling across the top of the game and its link (game.banner).
// Actions are forms POSTed with the page's token (t); each one is in the audit log, then the page reloads (303).
const world = require('./world');
const { netOf } = require('./security');
const { centsRate, centsText } = require('./nocents');
// The item table's categories (the shop's tabs: webshop.js), in English.
const ITEM_KIND = { '宝物': 'Items', '加速': 'Speed-ups', '生产': 'Production', '宝箱': 'Chests', '计谋': 'Stratagems', '材料': 'Materials' };
const KINDS = ['Items', 'Speed-ups', 'Production', 'Chests', 'Stratagems', 'Materials', 'Hero items', 'Equipment', 'Other'];

const DUR = [['1h', '1 hour', 3600e3], ['6h', '6 hours', 6 * 3600e3], ['1d', '1 day', 86400e3], ['3d', '3 days', 3 * 86400e3],
  ['7d', '7 days', 7 * 86400e3], ['30d', '30 days', 30 * 86400e3], ['perm', 'Permanent', null]];
const RES = ['food', 'wood', 'stone', 'iron', 'gold'];
// The Christmas items the game has (the Gifts tab's list): each opens in Age of War (itemUse.js).
const HOLIDAY_ITEMS = ['player.box.present.money.113', 'player.box.present.money.299', 'player.box.present.money.449', 'player.box.present.money.365',
  'player.box.present.money.298', 'player.box.present.money.246', 'player.box.present.money.119', 'player.item.christmasgift2013', 'player.christmas.gift',
  'player.box.present.christmas.a', 'player.box.present.christmas.b', 'player.box.present.christmas.c', 'player.box.present.money.22',
  'player.box.present.money.23', 'player.box.present.money.36', 'player.santa.stoptoopsupkeep', 'player.snowball.pile'];
const TYPES = [['', 'Everything'], ['signin,resume', 'Sign-ins'], ['signin-fail', 'Wrong passwords'], ['signup', 'Sign-ups'], ['signup-blocked,refused', 'Refused sign-ups'],
  ['autoban,probe', 'Automatic bans'], ['transport', 'Transports'], ['reinforce', 'Reinforcements'], ['market', 'Market trades'], ['policy', 'Policies'], ['battle', 'Battles']];
const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const when = t => t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '';
const num = n => Math.floor(Number(n) || 0).toLocaleString('en-US');
const short = id => id ? String(id).slice(0, 8) : '';

class AdminPage {
  constructor(game){ this.g = game; }
  get S(){ return this.g.security; }
  get tok(){ return this.g.adminToken; }
  acct(name){ return this.g.db.accounts?.[String(name || '').trim().toLowerCase()] || null; }
  // The account of a lord, by his name or id.
  acctOfLord(x){
    const accs = Object.values(this.g.db.accounts || {});
    if (typeof x === 'number') return accs.find(a => a.playerId === x) || null;
    const low = String(x || '').toLowerCase();
    return accs.find(a => a.playerId && this.g.db.players[a.playerId]?.name.toLowerCase() === low) || null;
  }
  troopName(f){ return Object.values(this.g.data.troops).find(t => t.field === f)?.name || f; }
  list(obj, name = k => k){ return Object.entries(obj || {}).filter(([, n]) => n > 0).map(([k, n]) => `${num(n)} ${name(k)}`).join(', ') || 'nothing'; }
  res(obj){ return this.list(obj, k => (k === 'wood' ? 'lumber' : k)); }
  troops(obj){ return this.list(obj, f => this.troopName(f)); }
  duration(code){ const d = DUR.find(x => x[0] === code); return d ? d : DUR[2]; }

  // ---------- links and pieces ----------
  url(q){ return '?' + new URLSearchParams(q).toString(); }
  link(q, label, cls = ''){ return `<a${cls ? ` class="${cls}"` : ''} href="${esc(this.url(q))}">${label}</a>`; }
  who(a, label){ return a ? this.link({ view: 'player', name: a.name }, esc(label ?? a.name)) : esc(label || '?'); }
  lord(name){ const a = this.acctOfLord(name); return a ? this.who(a, name) : esc(name || '?'); }
  form(action, fields, inner, opts = {}){
    const hidden = Object.entries({ t: this.tok, action, ...fields }).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
    return `<form method="post" class="${opts.inline ? 'inline' : 'box'}"${opts.confirm ? ` onsubmit="return confirm(${esc(JSON.stringify(opts.confirm))})"` : ''}>${hidden}${inner}</form>`;
  }
  durSelect(name = 'dur', def = '1d'){ return `<select name="${name}">${DUR.map(([v, l]) => `<option value="${v}"${v === def ? ' selected' : ''}>${l}</option>`).join('')}</select>`; }
  badges(a, now){
    const p = a.playerId ? this.g.db.players[a.playerId] : null, S = this.S, out = [];
    if (p && this.g.online.has(p.id)) out.push('<span class="b on">online</span>');
    const ban = S.banOf(a, now); if (ban) out.push(`<span class="b bad" title="${esc(ban.reason)}">banned ${ban.until == null ? 'for good' : 'to ' + when(ban.until)}</span>`);
    const m = p && S.muteOf(p, now); if (m) out.push(`<span class="b warn" title="${esc(m.reason)}">muted ${m.until == null ? 'for good' : 'to ' + when(m.until)}</span>`);
    const f = p && S.frozenOf(p, now); if (f) out.push(`<span class="b warn" title="${esc(f.reason)}">frozen ${f.until == null ? 'for good' : 'to ' + when(f.until)}</span>`);
    return out.join(' ');
  }
  // One activity line as words.
  describe(e){
    const L = n => this.lord(n), acc = n => { const a = this.acct(n); return a ? this.who(a) : esc(n); };
    const dev = e.device ? ` <span class="dim">browser ${esc(short(e.device))}</span>` : '', ip = e.ip ? ` <span class="dim">${esc(e.ip)}${e.local ? ' (this PC)' : ''}</span>` : '';
    switch (e.type){
      case 'signup': return `${acc(e.account)} signed up from${ip}${dev}`;
      case 'signin': return `${acc(e.account)} signed in${ip}${dev}`;
      case 'resume': return `${acc(e.account)} came back (reload)${ip}${dev}`;
      case 'signin-fail': return `Wrong password for ${acc(e.account)} from${ip}${dev}`;
      case 'signup-blocked': return `<span class="bad">Sign-up of ${esc(e.account)} refused</span>: the browser already has ${(e.others || []).map(acc).join(', ')}${ip}${dev}`;
      case 'refused': return `<span class="bad">Refused ${esc(e.account || '?')}</span>: ${esc(e.why || '')}${ip}${dev}`;
      case 'probe': return `<span class="bad">Banned a security scanner</span>${e.account ? ` (${acc(e.account)})` : ''}: it sent ${esc(e.host)} (${esc(e.cmd)}); its network ${esc(e.net || '?')}${e.device ? ' and browser' : ''} banned${ip}${dev}`;
      case 'autoban': return `<span class="bad">Banned ${esc(e.net)} automatically</span> ${e.until ? 'until ' + when(e.until) : 'for good'}: it tried ${num((e.names || []).length)} account names that don't exist (${esc((e.names || []).slice(0, 8).join(', '))}${(e.names || []).length > 8 ? ' ...' : ''})${(e.banned || []).length ? `; its new accounts banned too: ${e.banned.map(acc).join(', ')}` : ''}${ip}${dev}`;
      case 'transport': {
        const back = this.acctOfLord(e.to), q = { view: 'player', name: back?.name || '', tb_city: e.toCityId || '' };
        for (const [k, n] of Object.entries(e.res || {})) q['tb_' + k] = n;
        return `${L(e.from)} (${esc(e.fromCity || '?')}) sent ${this.res(e.res)} to ${L(e.to)} (${esc(e.toCity || '?')})${back && e.toCityId ? ` ${this.link(q, 'take back', 'mini')}` : ''}`;
      }
      case 'reinforce': return `${L(e.from)} stationed ${this.troops(e.troops)}${Object.keys(e.res || {}).length ? ` and ${this.res(e.res)}` : ''} in ${L(e.to)}'s ${esc(e.toCity || '?')}`;
      case 'market': return `${L(e.seller)} sold ${num(e.amount)} ${esc(e.res === 'wood' ? 'lumber' : e.res)} to ${L(e.buyer)} at ${esc(e.price)} gold each (${num(e.total)} gold)`;
      case 'policy': return `${L(e.to)} used ${esc(e.policy)} on ${L(e.from)}'s ${esc(e.fromCity || '?')}: ${num(e.amount)} ${esc(e.what || '')}`;
      case 'battle': return `${L(e.attacker)} ${e.kind === 'colonize' ? 'tried to colonize' : e.kind === 'colony' ? 'fought' : 'attacked'} ${L(e.defender)}'s ${esc(e.defenderCity || '?')} ${e.at ? `(${esc(e.at)})` : ''}: `
        + `<b>${e.won ? 'won' : 'lost'}</b> in ${e.rounds} round${e.rounds === 1 ? '' : 's'}; the attacker lost ${this.troops(e.attLost)}, the defender ${this.troops(e.defLost)}`
        + `${e.loot ? `; loot ${this.res(e.loot)}` : ''}${e.conquered ? '; <b>city taken</b>' : ''}`;
      default: return esc(JSON.stringify(e));
    }
  }
  eventsTable(list){
    if (!list.length) return '<p class="dim">Nothing yet.</p>';
    return `<table><tr><th>When (UTC)</th><th>What</th></tr>${list.map(e => `<tr><td class="nw">${when(e.t)}</td><td>${this.describe(e)}</td></tr>`).join('')}</table>`;
  }

  // ---------- actions ----------
  act(q){
    const g = this.g, S = this.S, now = g.now(), action = q.get('action'), name = q.get('name') || '';
    const a = this.acct(name), p = a?.playerId ? g.db.players[a.playerId] : null, reason = String(q.get('reason') || '').trim().slice(0, 300);
    const back = (note, extra = {}) => ({ redirect: this.url({ view: q.get('back') || (a ? 'player' : 'home'), ...(a ? { name: a.name } : {}), ...extra, note }) });
    const [, label, ms] = this.duration(q.get('dur')), until = ms == null ? null : now + ms, span = ms == null ? 'permanently' : `for ${label.toLowerCase()}`;
    const needA = ['ban', 'unban', 'mute', 'unmute', 'freeze', 'unfreeze', 'kick', 'takeback', 'note', 'reset'];
    if (needA.includes(action) && !a) return back(`There is no account called ${name}.`);
    if (['mute', 'unmute', 'freeze', 'unfreeze', 'takeback'].includes(action) && !p) return back(`${a.name} has no lord yet.`);
    switch (action){
      case 'ban': {
        S.ban(a, until, reason, now);
        const also = [];
        if (q.get('ips')) for (const ip of Object.keys(a.seen?.ips || {})){ const k = S.banKey('ip', ip, until, reason, now); if (!also.includes(k)) also.push(k); }
        if (q.get('devices')) for (const d of Object.keys(a.seen?.devices || {})){ S.banKey('device', d, until, reason, now); also.push('browser ' + short(d)); }
        S.audit('banned', a.name, `${span}${reason ? ': ' + reason : ''}${also.length ? `; also ${also.join(', ')}` : ''}`);
        return back(`${a.name} is banned ${span}${also.length ? `, with ${also.length} address${also.length === 1 ? '' : 'es and browsers'}` : ''}.`);
      }
      case 'unban': S.unban(a); S.audit('lifted the ban on', a.name); return back(`${a.name} can sign in again.`);
      // Every account at an e-mail domain (Fox, Nov 28 2026: ten bot accounts @agentmail.to), with their browsers.
      case 'bandomain': {
        const dom = String(q.get('domain') || '').trim().toLowerCase().replace(/^.*@/, '');
        if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) return back('Enter an e-mail domain, such as agentmail.to.');
        const hit = this.atDomain(dom).filter(x => !S.banOf(x, now));
        let browsers = 0;
        for (const x of hit){
          S.ban(x, until, reason || `E-mail at ${dom}`, now);
          if (q.get('devices')) for (const d of Object.keys(x.seen?.devices || {})){ S.banKey('device', d, until, reason || `E-mail at ${dom}`, now); browsers++; }
        }
        S.audit('banned every account at', dom, `${hit.length} account${hit.length === 1 ? '' : 's'} ${span}${browsers ? `, with ${browsers} browser${browsers === 1 ? '' : 's'}` : ''}${reason ? ': ' + reason : ''}${hit.length ? ` (${hit.slice(0, 30).map(x => x.name).join(', ')}${hit.length > 30 ? ' ...' : ''})` : ''}`);
        return back(hit.length ? `Banned ${hit.length} account${hit.length === 1 ? '' : 's'} at ${dom} ${span}${browsers ? `, with ${browsers} browser${browsers === 1 ? '' : 's'}` : ''}.` : `No account at ${dom} is left to ban.`);
      }
      case 'mute': S.mute(p, until, reason, now); S.audit('muted', a.name, `${span}${reason ? ': ' + reason : ''}`); return back(`${p.name} is muted ${span}.`);
      case 'unmute': S.unmute(p); S.audit('unmuted', a.name); return back(`${p.name} can chat again.`);
      case 'freeze': S.freeze(p, until, reason, now); S.audit('froze', a.name, `${span}${reason ? ': ' + reason : ''}`); return back(`${p.name} is frozen ${span}: no transports, reinforcements or market trades with other lords.`);
      case 'unfreeze': S.unfreeze(p); S.audit('unfroze', a.name); return back(`${p.name} can trade again.`);
      case 'kick': S.kick(a, 'You have been signed out by the server admin.'); S.audit('signed out', a.name); return back(`${a.name} is signed out.`);
      case 'note': { const t = String(q.get('text') || '').slice(0, 4000); if (t) S.db.notes[a.name.toLowerCase()] = { text: t, at: now }; else delete S.db.notes[a.name.toLowerCase()]; S.touch(); S.audit('wrote a note on', a.name); return back('Note saved.'); }
      case 'takeback': {
        const c = g.castlesOf(p).find(x => x.id === Number(q.get('city')));
        const res = {}, troops = {}, items = {};
        for (const k of RES){ const n = Math.floor(Number(String(q.get('r_' + k) || '').replace(/[, ]/g, '')) || 0); if (n > 0) res[k] = n; }
        const tf = q.get('troop'), tn = Math.floor(Number(String(q.get('tn') || '').replace(/[, ]/g, '')) || 0); if (tf && tn > 0) troops[tf] = tn;
        const itRaw = String(q.get('item') || '').trim(), itN = Math.max(1, Math.floor(Number(q.get('in')) || 1));
        if (itRaw){
          const low = itRaw.toLowerCase(), owned = Object.keys(p.items || {}).filter(id => p.items[id] > 0);
          const id = owned.find(i => i === itRaw) || owned.find(i => g.items.name(i).trim().toLowerCase() === low) || owned.find(i => g.items.name(i).toLowerCase().includes(low));
          if (!id) return back(`${p.name} has no item "${itRaw}".`);
          items[id] = itN;
        }
        if ((Object.keys(res).length || Object.keys(troops).length) && !c) return back('Pick one of his cities to take resources or troops from.');
        const took = S.takeBack(p, c, { res, troops, items });
        const said = [Object.keys(took.res).length && this.res(took.res), Object.keys(took.troops).length && this.troops(took.troops),
          Object.keys(took.items).length && this.list(took.items, id => g.items.name(id))].filter(Boolean).join('; ');
        S.audit('took back from', a.name, (said || 'nothing') + (c ? ` (${c.name})` : '') + (reason ? ': ' + reason : ''));
        return back(said ? `Took ${said} from ${p.name}${c ? ` (${c.name})` : ''}.` : 'Nothing was taken: he had none of that.');
      }
      case 'banip': case 'bandevice': {
        const kind = action === 'banip' ? 'ip' : 'device', key = String(q.get('key') || '').trim();
        if (!key || (kind === 'device' && !/^[0-9a-f]{32}$/.test(key))) return back(kind === 'ip' ? 'Enter an address.' : 'That is not a browser id.');
        const k = S.banKey(kind, key, until, reason, now);   // (an IPv6 address: its /64)
        S.audit(kind === 'ip' ? 'banned the address' : 'banned the browser', k, `${span}${reason ? ': ' + reason : ''}`);
        return back(`${kind === 'ip' ? k : 'Browser ' + short(k)} is banned ${span}.`);
      }
      case 'unbanip': case 'unbandevice': {
        const kind = action === 'unbanip' ? 'ip' : 'device', key = String(q.get('key') || '');
        S.unbanKey(kind, key); S.audit(kind === 'ip' ? 'lifted the ban on the address' : 'lifted the ban on the browser', key);
        return back('Ban lifted.');
      }
      case 'allowpair': case 'disallowpair': {
        const x = String(q.get('a') || ''), y = String(q.get('b') || ''), k = S.pairKey(x, y);
        if (action === 'allowpair') S.db.allow[k] = { at: now, note: reason }; else delete S.db.allow[k];
        S.touch(); S.audit(action === 'allowpair' ? 'allowed the pair' : 'no longer allows the pair', `${x} & ${y}`, reason);
        return back(action === 'allowpair' ? `${x} and ${y} are allowed to share.` : `${x} and ${y} are linked again.`);
      }
      case 'banner': {
        if (q.get('default')){
          g.setBanner(null, null); S.audit('set the banner back to config.json\'s', '');
          return back('The banner is back to config.json\'s (welcomeText, welcomeLink). Players see it the next time they load the game.');
        }
        const link = String(q.get('link') || '').trim();
        if (link && !/^https?:\/\/\S+$/i.test(link)) return back('The link must start with https:// (or http://), with no spaces.');
        const b = g.setBanner(q.get('text'), link);
        S.audit('set the banner to', b.text + b.link);
        return back('Banner saved. Players see it the next time they load the game (or press F5).');
      }
      // A gift to everyone (gifts.js).
      case 'gift': {
        const g2 = g.gifts.send({ item: q.get('item'), count: q.get('count'), newDays: q.get('days'), title: q.get('title'), text: q.get('text') }, now);
        if (Array.isArray(g2)) return { redirect: this.url({ view: 'gifts', item: q.get('item') || '', note: g2[1] }) };
        const what = `${g2.count > 1 ? g2.count + ' × ' : ''}${g.gifts.name(g2.itemId)}`;
        S.audit('sent a gift to everyone', what, `${g2.given} lord${g2.given === 1 ? '' : 's'} now${g2.newDays ? `, and new lords until ${when(g2.until)} UTC` : ''}`);
        return { redirect: this.url({ view: 'gifts', note: `Sent ${what} to ${num(g2.given)} lord${g2.given === 1 ? '' : 's'}${g2.newDays ? `; new lords get it until ${when(g2.until)} UTC` : ''}.` }) };
      }
      case 'stopgift': {
        const g2 = g.gifts.stop(q.get('id'), now);
        if (Array.isArray(g2)) return { redirect: this.url({ view: 'gifts', note: g2[1] }) };
        S.audit('stopped the gift to new lords', g.gifts.name(g2.itemId), `after ${g2.given} lords`);
        return { redirect: this.url({ view: 'gifts', note: `New lords no longer get ${g.gifts.name(g2.itemId)}.` }) };
      }
      // The fresh start (game.wipeWorld): only with WIPE typed in the box. The server restarts on the new world.
      case 'wipe': {
        const again = note => ({ redirect: this.url({ view: 'wipe', note }) });
        if (String(q.get('confirm') || '').trim() !== 'WIPE') return again('Nothing was wiped: type WIPE (in capitals) in the box to confirm.');
        const newMap = !!q.get('newMap'), db = g.db;
        S.audit('wiped the world (fresh start)', '', `${num(Object.keys(db.accounts || {}).length)} accounts kept, ${num(Object.keys(db.players || {}).length)} lords and ${num(Object.keys(db.castles || {}).length)} cities cleared${newMap ? ', a new map' : ''}`);
        let backup;
        try { backup = g.wipeWorld({ newMap }); }
        catch (e){ g.log.error('Fresh start: ' + e.message); return again('Nothing was wiped: ' + e.message); }
        if (g.restart) setTimeout(() => g.restart(), 1500);
        return this.wipedPage(backup, !!g.restart);
      }
      case 'allowdevice': case 'disallowdevice': {
        const key = String(q.get('key') || ''), k = 'device:' + key;
        if (!/^[0-9a-f]{32}$/.test(key)) return back('That is not a browser id.');
        if (action === 'allowdevice') S.db.allow[k] = { at: now, note: reason }; else delete S.db.allow[k];
        S.touch(); S.audit(action === 'allowdevice' ? 'allowed more accounts on the browser' : 'no longer allows more accounts on the browser', key, reason);
        return back(action === 'allowdevice' ? `Browser ${short(key)} may sign up more accounts.` : `Browser ${short(key)} is back to one account.`);
      }
    }
    return back('Unknown action.');
  }

  // ---------- views ----------
  home(now){
    const S = this.S, accs = Object.values(this.g.db.accounts || {}), day = now - 86400e3;
    const banned = accs.filter(a => S.banOf(a, now)).length, ps = accs.map(a => a.playerId && this.g.db.players[a.playerId]).filter(Boolean);
    const groups = S.groups(now), recent = S.events({ max: 2000, months: 1 }).filter(e => e.t >= day);
    const fails = recent.filter(e => e.type === 'signin-fail'), refused = recent.filter(e => e.type === 'signup-blocked' || e.type === 'refused'), autos = recent.filter(e => e.type === 'autoban'), probes = recent.filter(e => e.type === 'probe');
    const byIp = new Map(); for (const e of fails) if (e.ip) byIp.set(e.ip, (byIp.get(e.ip) || 0) + 1);
    const noisy = [...byIp].filter(([, n]) => n >= 5).sort((x, y) => y[1] - x[1]);
    const stat = (n, l, q) => `<div class="stat">${q ? this.link(q, `<b>${num(n)}</b>`) : `<b>${num(n)}</b>`}<span>${l}</span></div>`;
    const newest = [...accs].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0)).slice(0, 10);
    return `<div class="stats">${stat(accs.length, 'accounts', { view: 'accounts' })}${stat(this.g.online.size, 'online now', { view: 'accounts', show: 'online' })}
      ${stat(banned, 'banned', { view: 'accounts', show: 'banned' })}${stat(ps.filter(p => S.muteOf(p, now)).length, 'muted', { view: 'accounts', show: 'muted' })}
      ${stat(ps.filter(p => S.frozenOf(p, now)).length, 'frozen', { view: 'accounts', show: 'frozen' })}${stat(groups.length, 'linked groups', { view: 'alts' })}
      ${stat(recent.filter(e => e.type === 'signup').length, 'sign-ups today', { view: 'activity', type: 'signup' })}${stat(fails.length, 'wrong passwords today', { view: 'activity', type: 'signin-fail' })}</div>
      <h2>Needs a look</h2>
      ${groups.length ? `<p>${groups.filter(x => x.browsers).length} group${groups.filter(x => x.browsers).length === 1 ? '' : 's'} sharing a browser, ${groups.filter(x => !x.browsers).length} sharing only an address. ${this.link({ view: 'alts' }, 'See them')}.</p>
        <ul>${groups.slice(0, 5).map(gr => `<li>${gr.browsers ? '<span class="b bad">same browser</span> ' : '<span class="b warn">same address</span> '}${gr.names.map(n => this.who(this.acct(n))).join(', ')}</li>`).join('')}</ul>` : '<p class="dim">No accounts share a browser or an address.</p>'}
      ${probes.length ? `<p class="bad"><b>${probes.length}</b> security scanner${probes.length === 1 ? ' was' : 's were'} banned automatically today for sending a testing service's address: ${probes.map(e => esc(e.account || e.net || e.ip || '?')).join(', ')}. ${this.link({ view: 'activity', type: 'autoban,probe' }, 'See them')}.</p>` : ''}
      ${autos.length ? `<p class="bad"><b>${autos.length}</b> network${autos.length === 1 ? ' was' : 's were'} banned automatically today for guessing account names: ${autos.map(e => esc(e.net)).join(', ')}. ${this.link({ view: 'activity', type: 'autoban,probe' }, 'See them')}.</p>` : ''}
      ${refused.length ? `<p><b>${refused.length}</b> sign-up${refused.length === 1 ? ' or sign-in was' : 's or sign-ins were'} refused today (a browser that already has an account, a throwaway e-mail, Tor). ${this.link({ view: 'activity', type: 'signup-blocked,refused' }, 'See them')}.</p>` : ''}
      ${noisy.length ? `<p class="bad">Many wrong passwords today from: ${noisy.map(([ip, n]) => `${esc(ip)} (${n})`).join(', ')}.</p>` : ''}
      <h2>Newest accounts</h2>${this.accountsTable(newest, now)}
      ${this.bannerForm()}`;
  }
  // The banner scrolling across the top of the game: its line and the link after it (game.banner).
  bannerForm(){
    const b = this.g.banner(), own = !!this.g.db.banner;
    return `<h2>Banner</h2><p class="dim">The line that scrolls across the top of the game, and a link after it (your Discord invite). Players see a change the next time they load the game.</p>
      <p>Now: ${esc(b.text)}${b.link ? `<a href="${esc(b.link)}" target="_blank" rel="noopener">${esc(b.link)}</a>` : ''}${b.text || b.link ? '' : '<span class="dim">(empty: no banner text)</span>'}${own ? '' : ' <span class="dim">(from config.json)</span>'}</p>
      ${this.form('banner', {}, `<input name="text" value="${esc(b.text)}" placeholder="Welcome to Age of War! Join us on Discord:" size="52"> <input name="link" value="${esc(b.link)}" placeholder="https://discord.gg/..." size="32"> <button>Save banner</button>`)}
      ${own ? this.form('banner', { default: 1 }, '<button class="ghost">Use config.json\'s banner</button>', { inline: true }) : ''}
      ${this.loginMapNote()}`;
  }
  // The sign-in page's background picture (art/login-map.jpg): found, or where to put it; and an upload, so no one has
  // to find the folder (Fox, Nov 27 2026: a private window still showed the drawn map after 0.1.74).
  loginMapNote(){
    const m = this.g.loginMap?.(); if (!m) return '';
    let kb = 0; try { kb = Math.round(require('fs').statSync(m.file).size / 1024); } catch (e){}
    return `<h2>Sign-in page background</h2>` + (m.file
      ? `<p>Showing <b>${esc(m.file)}</b> (${num(kb)} KB). <a href="/login-map" target="_blank" rel="noopener">See it</a>. Upload another to change it; players see it within a day (or with F5).</p>`
      : `<p class="bad">No picture found, so the page shows the drawn map. Upload login-map.jpg below (or put it in <b>${esc(m.dir)}</b>).</p>`)
      + `<form class="box" id="lm-form"><input type="file" id="lm-file" accept="image/jpeg,image/png"> <button>Upload picture</button> <span id="lm-msg" class="dim">A JPEG or PNG, up to 8 MB; about 1920 x 1200 looks best.</span></form>
      <script>document.getElementById('lm-form').addEventListener('submit', async e => {
        e.preventDefault(); const f = document.getElementById('lm-file').files[0], msg = document.getElementById('lm-msg');
        if (!f){ msg.textContent = 'Choose the picture first.'; return; }
        msg.textContent = 'Uploading ' + f.name + '...';
        try {
          const r = await fetch('/admin/login-map?t=${this.tok}', { method: 'POST', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream' } });
          const j = await r.json().catch(() => ({ ok: false, msg: 'The server answered ' + r.status + '.' }));
          if (j.ok) location.href = '?note=' + encodeURIComponent(j.msg); else msg.textContent = j.msg;
        } catch (err){ msg.textContent = 'The upload failed: ' + err.message; }
      });</script>`;
  }
  // The upload (http.js /admin/login-map): the page's token, a real JPEG or PNG; saved as art/login-map.jpg (or .png),
  // the other login-map pictures in art/ removed so it's the one shown.
  saveLoginMap(q, body){
    if (!Buffer.isBuffer(body)) return { redirect: '/admin' };   // (a plain visit: back to the admin page)
    if (q.get('t') !== this.tok) return { ok: false, msg: 'That page had expired (the server restarted). Reload it and try again.' };
    const jpg = body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff, png = body.length > 8 && body.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!jpg && !png) return { ok: false, msg: 'That isn\'t a JPEG or PNG picture.' };
    const fs = require('fs'), path = require('path'), m = this.g.loginMap(), dir = m.dir;
    fs.mkdirSync(dir, { recursive: true });
    for (const n of fs.readdirSync(dir)) if (/^login-map.*\.(jpe?g|png)$/i.test(n)) fs.rmSync(path.join(dir, n), { force: true });
    const file = path.join(dir, png ? 'login-map.png' : 'login-map.jpg');
    fs.writeFileSync(file, body);
    this.S.audit('uploaded the sign-in background', path.basename(file), `${num(Math.round(body.length / 1024))} KB`);
    return { ok: true, msg: `Sign-in background saved as ${file}. Open the sign-in page in a private window to see it.` };
  }
  accountsTable(accs, now){
    const S = this.S;
    return `<table><tr><th>User name</th><th>Lord</th><th>E-mail</th><th>Made (UTC)</th><th>Last in (UTC)</th><th>Last address</th><th>Linked</th><th></th></tr>${accs.map(a => {
      const p = a.playerId ? this.g.db.players[a.playerId] : null, links = S.links(a, now).filter(l => !l.allowed);
      const lastIp = Object.entries(a.seen?.ips || {}).sort((x, y) => y[1].last - x[1].last)[0]?.[0] || '';
      const shared = links.some(l => l.browsers.length);
      return `<tr><td>${this.who(a)}</td><td>${esc(p?.name || '')}</td><td>${esc(a.email || '')}</td><td class="nw">${when(a.createdAt)}</td><td class="nw">${when(p?.lastLoginAt)}</td>
        <td>${esc(lastIp)}</td><td>${links.length ? `<span class="b ${shared ? 'bad' : 'warn'}">${links.length}${shared ? ' (browser)' : ''}</span>` : ''}</td><td>${this.badges(a, now)}</td></tr>`;
    }).join('')}</table>`;
  }
  accounts(q, now){
    const S = this.S, find = String(q.get('q') || '').trim().toLowerCase(), show = q.get('show') || '';
    let accs = Object.values(this.g.db.accounts || {});
    if (find) accs = accs.filter(a => {
      const p = a.playerId ? this.g.db.players[a.playerId] : null;
      return a.name.toLowerCase().includes(find) || (p && p.name.toLowerCase().includes(find)) || String(a.email || '').includes(find)
        || Object.keys(a.seen?.ips || {}).some(ip => ip.startsWith(find)) || Object.keys(a.seen?.devices || {}).some(d => d.startsWith(find));
    });
    const P = a => a.playerId ? this.g.db.players[a.playerId] : null;
    if (show === 'online') accs = accs.filter(a => P(a) && this.g.online.has(P(a).id));
    if (show === 'banned') accs = accs.filter(a => S.banOf(a, now));
    if (show === 'muted') accs = accs.filter(a => P(a) && S.muteOf(P(a), now));
    if (show === 'frozen') accs = accs.filter(a => P(a) && S.frozenOf(P(a), now));
    accs.sort((x, y) => (P(y)?.lastLoginAt || y.createdAt || 0) - (P(x)?.lastLoginAt || x.createdAt || 0));
    return `<h2>Accounts${show ? ` (${esc(show)})` : ''}${find ? ` matching "${esc(find)}"` : ''}: ${accs.length}</h2>${this.accountsTable(accs, now)}`;
  }
  player(q, now){
    const g = this.g, S = this.S, a = this.acct(q.get('name'));
    if (!a) return `<p class="bad">There is no account called ${esc(q.get('name'))}.</p>`;
    const p = a.playerId ? g.db.players[a.playerId] : null, cities = p ? g.castlesOf(p) : [], al = p && g.alliances.of(p);
    const ban = S.banOf(a, now), mute = p && S.muteOf(p, now), frozen = p && S.frozenOf(p, now), note = S.db.notes[a.name.toLowerCase()];
    const reason = '<input name="reason" placeholder="Reason (the player sees it)" size="34">';
    const links = S.links(a, now);
    const ips = Object.entries(a.seen?.ips || {}).sort((x, y) => y[1].last - x[1].last), devs = Object.entries(a.seen?.devices || {}).sort((x, y) => y[1].last - x[1].last);
    const ipRow = ([ip, e]) => { const hit = S.ipBan(ip, now), b = hit?.[1], net = netOf(ip);
      const others = Object.values(g.db.accounts).filter(o => o !== a && o.seen?.ips?.[ip]);
      return `<tr><td>${esc(ip)}</td><td class="nw">${when(e.first)}</td><td class="nw">${when(e.last)}</td><td>${e.n}</td><td>${others.map(o => this.who(o)).join(', ')}</td>
        <td>${b ? `<span class="b bad">banned${hit[0] !== ip ? ' (' + esc(hit[0]) + ')' : ''} ${b.until == null ? 'for good' : 'to ' + when(b.until)}</span> ${this.form('unbanip', { key: hit[0], name: a.name }, '<button>Lift</button>', { inline: true })}`
        : this.form('banip', { key: ip, name: a.name }, `${this.durSelect('dur', '7d')}<input name="reason" placeholder="Reason" size="14"><button>Ban address</button>`, { inline: true, confirm: net !== ip ? `Ban ${net}, the whole network this IPv6 address is in? Everyone signing in from it is refused.` : `Ban ${ip}? Everyone signing in from it is refused.` })}</td></tr>`; };
    const devRow = ([d, e]) => { const b = S.live(S.db.bans.device[d], now) ? S.db.bans.device[d] : null, others = S.othersOn(d, a.name), allowed = !!S.db.allow['device:' + d];
      return `<tr><td title="${esc(d)}">${esc(short(d))}</td><td class="nw">${when(e.first)}</td><td class="nw">${when(e.last)}</td><td>${e.n}</td><td>${others.map(n => this.who(this.acct(n))).join(', ')}</td>
        <td>${b ? `<span class="b bad">banned ${b.until == null ? 'for good' : 'to ' + when(b.until)}</span> ${this.form('unbandevice', { key: d, name: a.name }, '<button>Lift</button>', { inline: true })}`
        : this.form('bandevice', { key: d, name: a.name }, `${this.durSelect('dur', 'perm')}<input name="reason" placeholder="Reason" size="14"><button>Ban browser</button>`, { inline: true, confirm: 'Ban this browser?' })}
        ${this.form(allowed ? 'disallowdevice' : 'allowdevice', { key: d, name: a.name }, `<button class="ghost">${allowed ? 'Back to one account' : 'Allow more accounts'}</button>`, { inline: true })}</td></tr>`; };
    const pre = k => esc(q.get('tb_' + k) || '');
    const events = S.events({ ids: p ? [p.id] : null, accounts: [a.name], max: 150 });
    return `<h2>${esc(a.name)}${p && p.name !== a.name ? ` <span class="dim">lord ${esc(p.name)}</span>` : ''} ${this.badges(a, now)}</h2>
      <table class="facts"><tr><td>E-mail</td><td>${esc(a.email || '')}</td></tr><tr><td>Made</td><td>${when(a.createdAt)} UTC</td></tr>
        <tr><td>Last in</td><td>${when(p?.lastLoginAt)} UTC</td></tr><tr><td>Browser</td><td class="dim">${esc(a.seen?.ua || '')}</td></tr>
        ${p ? `<tr><td>Alliance</td><td>${esc(al?.name || 'none')}</td></tr><tr><td>Prestige / honor</td><td>${num(p.prestige)} / ${num(p.honor)}</td></tr>
        <tr><td>Cities</td><td>${cities.map(c => { const { x, y } = world.xy(c.fieldId); return `<b>${esc(c.name)}</b> (${x},${y})${c.powerLevel != null && c.powerLevel < 4 ? ' <span class="b">Historic City</span>' : ''}: ${this.res(Object.fromEntries(RES.map(k => [k, c.res?.[k] || 0])))}; troops ${num(Object.values(c.troops || {}).reduce((s, n) => s + n, 0))}`; }).join('<br>') || 'none'}</td></tr>` : ''}
        ${ban ? `<tr><td>Banned</td><td class="bad">${ban.until == null ? 'for good' : 'until ' + when(ban.until) + ' UTC'}${ban.reason ? ': ' + esc(ban.reason) : ''}</td></tr>` : ''}
        ${mute ? `<tr><td>Muted</td><td>${mute.until == null ? 'for good' : 'until ' + when(mute.until) + ' UTC'}${mute.reason ? ': ' + esc(mute.reason) : ''}</td></tr>` : ''}
        ${frozen ? `<tr><td>Frozen</td><td>${frozen.until == null ? 'for good' : 'until ' + when(frozen.until) + ' UTC'}${frozen.reason ? ': ' + esc(frozen.reason) : ''}</td></tr>` : ''}</table>
      <h3>Act</h3><div class="acts">
        ${ban ? this.form('unban', { name: a.name }, '<b>Banned.</b> <button>Lift the ban</button>')
          : this.form('ban', { name: a.name }, `<b>Ban</b> ${this.durSelect('dur', '7d')} ${reason}<br><label><input type="checkbox" name="devices" value="1"> and his browsers</label> <label><input type="checkbox" name="ips" value="1"> and his addresses</label> <button class="red">Ban</button>`, { confirm: `Ban ${a.name}?` })}
        ${p ? (mute ? this.form('unmute', { name: a.name }, '<b>Muted.</b> <button>Unmute</button>') : this.form('mute', { name: a.name }, `<b>Mute chat</b> ${this.durSelect('dur', '1d')} ${reason} <button>Mute</button>`)) : ''}
        ${p ? (frozen ? this.form('unfreeze', { name: a.name }, '<b>Frozen.</b> <button>Unfreeze</button>') : this.form('freeze', { name: a.name }, `<b>Freeze</b> (no transports, reinforcements or market trades with other lords) ${this.durSelect('dur', '7d')} ${reason} <button>Freeze</button>`)) : ''}
        ${this.form('kick', { name: a.name }, '<button class="ghost">Sign him out now</button>', { inline: true })}
        ${this.form('reset', { name: a.name }, '<button class="ghost">Password reset link</button>', { inline: true })}
        ${p ? `<a class="btn ghost" href="/coins?user=${encodeURIComponent(p.name)}">Debug menu</a>` : ''}</div>
      ${p ? `<h3 id="takeback">Take back</h3>${this.form('takeback', { name: a.name }, `From <select name="city">${cities.map(c => `<option value="${c.id}"${String(c.id) === q.get('tb_city') ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
          ${RES.map(k => `<label>${k === 'wood' ? 'lumber' : k} <input name="r_${k}" size="11" value="${pre(k)}"></label>`).join(' ')}<br>
          <label>troops <select name="troop"><option value=""></option>${Object.values(g.data.troops).map(t => `<option value="${t.field}">${esc(t.name)}</option>`).join('')}</select></label> <input name="tn" size="11" placeholder="how many">
          <label>item <input name="item" size="22" placeholder="item name or id"></label> <input name="in" size="5" value="1"><br>${reason.replace('the player sees it', 'for the log')} <button class="red">Take back</button>`, { confirm: 'Take these back?' })}` : ''}
      <h3>Notes</h3>${this.form('note', { name: a.name }, `<textarea name="text" rows="3" cols="90" placeholder="Only you see these.">${esc(note?.text || '')}</textarea><br><button class="ghost">Save note</button>${note ? ` <span class="dim">${when(note.at)} UTC</span>` : ''}`)}
      <h3>Linked accounts</h3>${links.length ? `<table><tr><th>Account</th><th>Lord</th><th>Same browser</th><th>Same address (last ${this.S.rules.linkDays ?? 30} days)</th><th></th></tr>${links.map(l => {
        const lp = l.account.playerId ? g.db.players[l.account.playerId] : null;
        return `<tr><td>${this.who(l.account)} ${this.badges(l.account, now)}</td><td>${esc(lp?.name || '')}</td><td>${l.browsers.length ? `<span class="b bad">${l.browsers.length}</span>` : ''}</td><td>${l.addresses.map(esc).join(', ')}</td>
          <td>${this.form(l.allowed ? 'disallowpair' : 'allowpair', { a: a.name, b: l.account.name, name: a.name }, l.allowed ? '<span class="b on">allowed</span> <button class="ghost">Undo</button>' : '<input name="reason" placeholder="Why (household...)" size="16"><button class="ghost">Allow</button>', { inline: true })}</td></tr>`;
      }).join('')}</table>` : '<p class="dim">No other account shares a browser or an address with this one.</p>'}
      <h3>Addresses</h3>${ips.length ? `<table><tr><th>Address</th><th>First (UTC)</th><th>Last (UTC)</th><th>Times</th><th>Other accounts</th><th></th></tr>${ips.map(ipRow).join('')}</table>` : '<p class="dim">None recorded yet (addresses are recorded from 0.1.69 on).</p>'}
      <h3>Browsers</h3>${devs.length ? `<table><tr><th>Browser</th><th>First (UTC)</th><th>Last (UTC)</th><th>Times</th><th>Other accounts</th><th></th></tr>${devs.map(devRow).join('')}</table>` : '<p class="dim">None recorded yet.</p>'}
      <h3>Activity</h3>${this.eventsTable(events)}`;
  }
  alts(now){
    const groups = this.S.groups(now);
    if (!groups.length) return '<h2>Linked accounts</h2><p class="dim">No accounts share a browser or an address (pairs you allowed are left out).</p>';
    return `<h2>Linked accounts: ${groups.length} group${groups.length === 1 ? '' : 's'}</h2><p class="dim">Accounts signed into on the same browser, or from the same address in the last ${this.S.rules.linkDays ?? 30} days. A shared browser is strong evidence; a shared address can be a household, shared Wi-Fi or a mobile network. Allowed pairs are left out.</p>
      ${groups.map(gr => `<div class="group"><p>${gr.browsers ? '<span class="b bad">same browser</span>' : '<span class="b warn">same address</span>'} ${gr.names.map(n => { const a = this.acct(n), p = a?.playerId ? this.g.db.players[a.playerId] : null; return `${this.who(a)}${p ? ` <span class="dim">(${esc(p.name)})</span>` : ''} ${this.badges(a, now)}`; }).join(' · ')}</p>
        <table>${gr.edges.map(e => `<tr><td>${esc(this.acct(e.a)?.name)} &amp; ${esc(this.acct(e.b)?.name)}</td><td>${e.browsers ? `<span class="b bad">${e.browsers} browser${e.browsers === 1 ? '' : 's'}</span>` : ''} ${e.addresses ? `${e.addresses} address${e.addresses === 1 ? '' : 'es'}` : ''}</td>
          <td>${this.form('allowpair', { a: this.acct(e.a)?.name, b: this.acct(e.b)?.name, back: 'alts' }, '<input name="reason" placeholder="Why (household...)" size="16"><button class="ghost">Allow</button>', { inline: true })}</td></tr>`).join('')}</table></div>`).join('')}`;
  }
  activity(q){
    const type = q.get('type') || '', who = String(q.get('who') || '').trim(), max = Math.min(2000, Math.max(20, Number(q.get('max')) || 300));
    let ids = null, accounts = null;
    if (who){ const a = this.acct(who) || this.acctOfLord(who); if (a){ ids = a.playerId ? [a.playerId] : null; accounts = [a.name]; } else accounts = [who]; }
    const list = this.S.events({ types: type ? type.split(',') : null, ids, accounts, max, months: 6 });
    return `<h2>Activity</h2><form class="inline"><input type="hidden" name="view" value="activity"><select name="type">${TYPES.map(([v, l]) => `<option value="${v}"${v === type ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input name="who" value="${esc(who)}" placeholder="account or lord"> <select name="max">${[100, 300, 1000, 2000].map(n => `<option${n === max ? ' selected' : ''}>${n}</option>`).join('')}</select> <button>Show</button></form>${this.eventsTable(list)}`;
  }
  // Accounts whose e-mail is at domain dom, or a domain under it.
  atDomain(dom){ return Object.values(this.g.db.accounts || {}).filter(a => { const d = String(a.email || '').toLowerCase().split('@').pop(); return d === dom || d.endsWith('.' + dom); }); }
  // E-mail domains of the accounts made in the last week, most first (the Bans tab): [domain, made, banned, blocked].
  domains(now){
    const count = new Map();
    for (const a of Object.values(this.g.db.accounts || {})){
      if (!(a.createdAt > now - 7 * 86400e3) || !a.email) continue;
      const d = a.email.toLowerCase().split('@').pop(), c = count.get(d) || [0, 0];
      c[0]++; if (this.S.banOf(a, now)) c[1]++; count.set(d, c);
    }
    return [...count].sort((x, y) => y[1][0] - x[1][0]).slice(0, 12).map(([d, [n, b]]) => [d, n, b, this.S.emailBlocked('x@' + d)]);
  }
  bans(now){
    const S = this.S, live = obj => Object.entries(obj).filter(([, b]) => S.live(b, now));
    const doms = this.domains(now), tor = this.g.tor, torMode = this.g.rules.security?.blockTor ?? 'all';
    const accountsOn = (kind, key) => Object.values(this.g.db.accounts).filter(a => kind === 'ip' ? Object.keys(a.seen?.ips || {}).some(ip => ip === key || netOf(ip) === key) : a.seen?.devices?.[key]);
    const table = (kind, rows) => rows.length ? `<table><tr><th>${kind === 'ip' ? 'Address' : 'Browser'}</th><th>Until (UTC)</th><th>Reason</th><th>Accounts seen on it</th><th></th></tr>${rows.map(([k, b]) => `<tr><td title="${esc(k)}">${esc(kind === 'ip' ? k : short(k))}</td><td>${b.until == null ? 'for good' : when(b.until)}</td><td>${esc(b.reason)}</td>
      <td>${accountsOn(kind, k).map(a => this.who(a)).join(', ')}</td><td>${this.form(kind === 'ip' ? 'unbanip' : 'unbandevice', { key: k, back: 'bans' }, '<button>Lift</button>', { inline: true })}</td></tr>`).join('')}</table>` : '<p class="dim">None.</p>';
    const allows = Object.entries(S.db.allow);
    return `<h2>Banned addresses</h2>${table('ip', live(S.db.bans.ip))}${this.form('banip', { back: 'bans' }, `<input name="key" placeholder="address" size="20"> ${this.durSelect('dur', '7d')} <input name="reason" placeholder="Reason" size="24"> <button class="red">Ban address</button>`)}
      <p class="dim">An IPv6 address is banned with its whole /64, the block one connection or one rented server is given (its owner can change the rest of the address at will). A network that tries ${num(this.g.rules.security?.autoBan?.unknownNames ?? 5)} account names that don't exist within ${num(this.g.rules.security?.autoBan?.minutes ?? 15)} minutes is banned automatically (rules.security.autoBan).</p>
      <h2>Banned browsers</h2>${table('device', live(S.db.bans.device))}
      <h2>E-mail domains</h2>
      <p>Sign-ups with a throwaway e-mail service are refused (${num((this.g.rules.security?.blockedEmailDomains || []).length + (this.g.rules.security?.moreBlockedEmailDomains || []).length)} domains, such as agentmail.to: rules.security.blockedEmailDomains; add more as moreBlockedEmailDomains in data/rules.json). Accounts made before that are still there: ban them here.</p>
      ${doms.length ? `<table><tr><th>Domain (accounts made this week)</th><th>Accounts</th><th>Banned</th><th></th></tr>${doms.map(([d, n, b, blocked]) => `<tr><td>${esc(d)}${blocked ? ' <span class="b bad">throwaway</span>' : ''}</td><td>${num(n)}</td><td>${num(b)}</td><td>${n > b && (blocked || n - b >= 2) && !/^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|aol|proton|protonmail)\./.test(d) ? this.form('bandomain', { domain: d, dur: 'perm', devices: '1', back: 'bans' }, `<button class="red">Ban all ${num(n - b)}</button>`, { inline: true, confirm: `Ban every account with an e-mail at ${d} (${n - b}) for good, with their browsers?` }) : ''}</td></tr>`).join('')}</table>` : '<p class="dim">No accounts were made this week.</p>'}
      ${this.form('bandomain', { back: 'bans' }, `<input name="domain" placeholder="e-mail domain, such as agentmail.to" size="30"> ${this.durSelect('dur', 'perm')} <input name="reason" placeholder="Reason" size="20"> <label><input type="checkbox" name="devices" value="1" checked> and their browsers</label> <button class="red">Ban every account at it</button>`, { confirm: 'Ban every account with an e-mail at this domain?' })}
      <h2>Tor</h2>
      <p>${torMode ? `Tor can't ${torMode === 'signup' ? 'make accounts here (it can still sign in)' : 'sign up or sign in here'}` : '<span class="bad">Tor is let in</span>'} (rules.security.blockTor: 'all', 'signup' or false). The server knows <b>${num(tor?.size || 0)}</b> Tor exit addresses${tor?.at ? `, from ${when(tor.at)} UTC` : ''}; it fetches Tor's own list every hour. With Cloudflare's IP Geolocation on (Network in its dashboard), it also sees the visitors Cloudflare marks as Tor.</p>
      <h2>Allowed</h2>${allows.length ? `<table><tr><th>What</th><th>Since (UTC)</th><th>Why</th><th></th></tr>${allows.map(([k, v]) => {
        const [kind, rest] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
        const what = kind === 'device' ? `Browser ${esc(short(rest))} may hold more accounts` : `${rest.split('|').map(n => this.who(this.acct(n), n)).join(' &amp; ')} may share`;
        const undo = kind === 'device' ? this.form('disallowdevice', { key: rest, back: 'bans' }, '<button class="ghost">Undo</button>', { inline: true })
          : this.form('disallowpair', { a: rest.split('|')[0], b: rest.split('|')[1], back: 'bans' }, '<button class="ghost">Undo</button>', { inline: true });
        return `<tr><td>${what}</td><td>${when(v.at)}</td><td>${esc(v.note || '')}</td><td>${undo}</td></tr>`;
      }).join('')}</table>` : '<p class="dim">Nothing allowed yet: households sharing a computer or a network can be allowed from a player\'s page.</p>'}`;
  }
  // ---------- every item (Fox, Nov 28 2026: "do I have an accessible database of all the items and their
  // descriptions?") ----------
  kindOf(it){ return ITEM_KIND[it.type] || (/^hero\./.test(it.id) ? 'Hero items' : /^equipment\./.test(it.id) ? 'Equipment' : 'Other'); }
  // The gold shop's price (as webshop.js prices it), or 0 when the shop doesn't list it.
  shopGold(it){
    const W = this.g.rules.webShop || {}, coins = W.prices?.[it.id] != null ? Number(W.prices[it.id]) || 0 : Number(it.price) || 0;
    const rate = Number(W.goldPerCoin) > 0 ? Number(W.goldPerCoin) : 10000;
    if (!(coins > 0) || /^hero\.taskitem\./.test(it.id) || (W.hidden || []).includes(it.id) || !ITEM_KIND[it.type]) return 0;
    return Math.round(coins * rate);
  }
  // An item's text as players see it (cents read as gold where the server has no cents: nocents.js).
  itemText(t){ const r = centsRate(this.g.rules); return String(t || '').replace(/\r/g, '').trim() && (r ? centsText(String(t).trim(), r) : String(t).trim()); }
  // The items matching the search (q: find, kind), by name; for the tab and the file.
  itemRows(q){
    const items = this.g.data.items || {}, term = String(q.get('find') || '').trim().toLowerCase(), kind = q.get('kind') || '';
    return Object.values(items).filter(it => (!kind || this.kindOf(it) === kind) && (!term || [it.id, it.name, it.desc].some(x => String(x || '').toLowerCase().includes(term))))
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)) || a.id.localeCompare(b.id));
  }
  opensTo(it){
    if (it.type !== '宝箱') return '';
    const keys = this.g.itemUse?.keysFor?.get(it.id), items = this.g.data.items || {};
    return this.holds(it.id) + (keys?.length ? ` (needs ${[...new Set(keys.map(k => items[k]?.name || k))].join(' or ')})` : '');
  }
  itemsView(q){
    const items = this.g.data.items || {}, rows = this.itemRows(q), per = 100, pages = Math.max(1, Math.ceil(rows.length / per));
    const page = Math.min(pages, Math.max(1, Math.floor(Number(q.get('page')) || 1))), shown = rows.slice((page - 1) * per, page * per);
    const find = q.get('find') || '', kind = q.get('kind') || '', nav = n => this.link({ view: 'items', find, kind, page: n }, n === page ? `<b>${n}</b>` : String(n));
    return `<h2>Items</h2>
      <p>Every item in the game's item table (<b>${num(Object.keys(items).length)}</b>): what it does, what a chest gives when opened here, and its price in the gold shop. "Gift" puts it in the Gifts tab's form.</p>
      <form method="get" class="inline"><input type="hidden" name="view" value="items"><input name="find" value="${esc(find)}" placeholder="name, ID or words in the description" size="34">
        <select name="kind"><option value="">Every kind</option>${KINDS.map(k => `<option${k === kind ? ' selected' : ''}>${k}</option>`).join('')}</select> <button>Find</button>
        ${find || kind ? this.link({ view: 'items' }, 'Show all') : ''} · <a href="${esc(this.url({ view: 'items', find, kind, format: 'csv' }))}">Download ${find || kind ? 'these' : 'all'} as a spreadsheet file (.csv)</a></form>
      <p class="dim">${num(rows.length)} item${rows.length === 1 ? '' : 's'}${pages > 1 ? `, page ${page} of ${pages}` : ''}.</p>
      ${shown.length ? `<table><tr><th>Item</th><th>Kind</th><th>What it does</th><th>Gold shop</th><th></th></tr>${shown.map(it => {
        const opens = this.opensTo(it), gold = this.shopGold(it);
        return `<tr><td><b>${esc(this.itemText(it.name) || it.id)}</b><br><span class="dim">${esc(it.id)}</span></td><td class="nw">${this.kindOf(it)}</td>
          <td>${esc(this.itemText(it.desc))}${opens ? `${this.itemText(it.desc) ? '<br>' : ''}<span class="dim">Opens to: ${esc(opens)}</span>` : ''}</td><td class="nw">${gold ? num(gold) : ''}</td>
          <td>${this.link({ view: 'gifts', item: it.id }, 'Gift')}</td></tr>`; }).join('')}</table>` : '<p class="dim">Nothing matches.</p>'}
      ${pages > 1 ? `<p>Pages: ${Array.from({ length: pages }, (_, i) => nav(i + 1)).join(' ')}</p>` : ''}`;
  }
  // The same list as a spreadsheet file (UTF-8 with a byte-order mark, so Excel reads the names right).
  itemsCsv(q){
    const cell = v => { const t = String(v ?? ''); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = [['ID', 'Name', 'Kind', 'What it does', 'Opens to', 'Gold shop price'].join(',')];
    for (const it of this.itemRows(q)) lines.push([it.id, this.itemText(it.name), this.kindOf(it), this.itemText(it.desc), this.opensTo(it), this.shopGold(it) || ''].map(cell).join(','));
    return { body: '\ufeff' + lines.join('\r\n') + '\r\n', type: 'text/csv; charset=utf-8', filename: 'age-of-war-items.csv' };
  }
  // ---------- gifts to everyone (gifts.js) ----------
  // What a chest gives when opened here (itemUse's chest reader), in a line: its sets, or one random prize; a buff
  // item says what it does.
  holds(id){
    const items = this.g.data.items || {}, sets = this.g.itemUse?.chests?.sets(id) || [];
    const n = e => e.min == null ? '' : `${num(e.min)}${e.max != null && e.max !== e.min ? '–' + num(e.max) : ''} `;
    const one = e => e.kind === 'res' ? `${n(e)}${e.key === 'wood' ? 'lumber' : e.key}` : e.kind === 'eachres' ? `${n(e)}of each resource` : e.kind === 'cents' ? `${n(e)}cents${this.g.rules.noCents !== false ? ' (paid as gold)' : ''}`
      : e.kind === 'troop' ? `${n(e)}${e.key}` : e.kind === 'medal' ? `${n(e)}random medal` : `${e.count ?? e.min ?? 1} ${items[e.id]?.name || e.id}`;
    if (sets.length) return (sets.length > 1 ? `One of ${sets.length}: ` : '') + sets.map(set => set.map(one).join(', ')).join('; or ');
    if (items[id]?.type === '宝箱' || /^player\.box\.|^player\.item\./.test(id) && !ITEM_KIND[items[id]?.type]) return 'One random prize, as from an Amulet spin (gold, resources or an item).';
    return String(items[id]?.desc || '').slice(0, 220);
  }
  giftsView(q, now){
    const G2 = this.g.gifts, items = this.g.data.items || {}, lords = Object.keys(this.g.db.players || {}).length;
    const pick = q.get('item') || '', picked = pick && items[pick] ? pick : '';
    const days = [[0, 'nobody new'], [7, '7 days'], [14, '14 days'], [30, '30 days'], [60, '60 days'], [90, '90 days']];
    const holiday = HOLIDAY_ITEMS.filter(id => items[id]);
    const list = [...G2.list].reverse();
    return `<h2>Gifts to everyone</h2>
      <p>Sends an item to every lord at once (<b>${num(lords)}</b> now). Each one finds it in My Items, with a mail in his System box saying so. Lords founded in the days after get it too, when they start. Each lord gets a gift once. A gift still open to new lords carries on after a Fresh start.</p>
      ${this.form('gift', {}, `<table class="facts">
        <tr><td>Item</td><td><input name="item" list="aow-items" size="40" value="${esc(picked)}" placeholder="type a name, such as Christmas Chest" autocomplete="off">${picked ? ` <b>${esc(items[picked].name)}</b>` : ''}</td></tr>
        <tr><td>How many</td><td><input name="count" type="number" min="1" max="1000" value="1" style="width:70px"> each</td></tr>
        <tr><td>New lords</td><td>also get it for <select name="days">${days.map(([d, l]) => `<option value="${d}"${d === 30 ? ' selected' : ''}>${l}</option>`).join('')}</select> after today</td></tr>
        <tr><td>Mail title</td><td><input name="title" size="40" maxlength="60" placeholder="Happy holidays!"></td></tr>
        <tr><td>Mail text</td><td><textarea name="text" rows="3" cols="60" maxlength="600" placeholder="The Age of War team sends you (the item). You'll find it in My Items. Happy holidays!"></textarea></td></tr>
      </table><button class="red">Send to everyone</button>`, { confirm: `Send this to all ${lords} lords now, and to new lords for the days chosen?` })}
      <datalist id="aow-items">${Object.keys(items).sort((x, y) => String(items[x].name).localeCompare(String(items[y].name))).map(id => `<option value="${esc(id)}">${esc(items[id].name || id)}</option>`).join('')}</datalist>
      <h3>Holiday items</h3>
      <p class="dim">The Christmas items the game has, and what opening one gives. Choose one to put it in the form.</p>
      <table><tr><th>Item</th><th>What opening one gives here</th><th></th></tr>${holiday.map(id => `<tr><td class="nw">${esc(items[id].name)}</td><td>${esc(this.holds(id))}</td><td>${this.link({ view: 'gifts', item: id }, 'Choose')}</td></tr>`).join('')}</table>
      <h3>Sent</h3>
      ${list.length ? `<table><tr><th>Item</th><th>Each</th><th>Sent (UTC)</th><th>New lords get it</th><th>Lords given</th><th></th></tr>${list.map(x => {
        const open = !x.stopped && x.until > now;
        return `<tr><td>${esc(G2.name(x.itemId))}</td><td>${num(x.count)}</td><td class="nw">${when(x.at)}</td><td class="nw">${open ? `until ${when(x.until)}` : x.stopped ? `stopped ${when(x.stoppedAt)}` : x.newDays ? `ended ${when(x.until)}` : 'no'}</td><td>${num(x.given)}</td>
          <td>${open ? this.form('stopgift', { id: x.id }, '<button class="ghost">Stop for new lords</button>', { inline: true, confirm: 'New lords will no longer get this gift. Lords who have it keep it.' }) : ''}</td></tr>`; }).join('')}</table>` : '<p class="dim">Nothing sent yet.</p>'}`;
  }
  // ---------- backups (backups.js) ----------
  backupDir(){ return this.g.backups?.dir || require('path').join(require('path').dirname(this.g.store.file), 'backups'); }
  backupsView(){
    const B = this.g.backups, list = B ? B.list() : [], world = require('path').join(require('path').dirname(this.g.store.file), 'world.json');
    const every = B?.every ? B.every / 3600e3 : 0, keep = B ? B.keep / 86400e3 : 0;
    const total = list.reduce((s, b) => s + b.kb, 0);
    return `<h2>Backups</h2>
      <p>${every ? `Every ${num(every)} hour${every === 1 ? '' : 's'} a copy of the world goes in <b>${esc(B.dir)}</b>, and copies older than ${num(keep)} day${keep === 1 ? '' : 's'} are deleted (rules.backups in data/rules.json). Last: ${B.last ? when(B.last) + ' UTC' : 'none yet'}. Next: ${when(B.next())} UTC.`
        : '<span class="bad">Automatic backups are off (rules.backups.everyHours is 0).</span>'} Copies made by a Fresh start stay until you delete them.</p>
      <p>To go back to a copy: stop the server, put the copy in place of <b>${esc(world)}</b> (renamed to world.json), and start the server again. Everything since that copy is lost.</p>
      ${list.length ? `<table><tr><th>Made (UTC)</th><th>Kind</th><th>File</th><th>Size</th></tr>${list.map(b => `<tr><td class="nw">${when(b.at)}</td><td>${b.auto ? 'Automatic' : 'Before a fresh start'}</td><td>${esc(b.name)}</td><td class="nw">${num(b.kb)} KB</td></tr>`).join('')}</table>
        <p class="dim">${num(list.length)} cop${list.length === 1 ? 'y' : 'ies'}, ${total < 1024 ? `${num(total)} KB` : `${num(Math.round(total / 1024))} MB`} in all.</p>`
        : '<p class="dim">None yet. The first is made a few seconds after the server starts.</p>'}`;
  }
  // ---------- the fresh start ----------
  wipe(){
    const db = this.g.db, n = (x, one, many = one + 's') => { const k = Object.keys(x || {}).length; return `<b>${num(k)}</b> ${k === 1 ? one : many}`; }, path = require('path'), world = path.join(path.dirname(this.g.store.file), 'world.json'), b = { dir: this.backupDir() };
    const armies = Object.keys(db.armies || {}).length, colonies = Object.keys(db.colonies || {}).length;
    return `<h2>Fresh start</h2>
      <p>Wipes the world for a new beginning and keeps every account. Players sign in with the same name and password as before and found a new lord and city, as on their first day.</p>
      <table class="facts">
        <tr><td>Kept</td><td>${n(db.accounts, 'account')}: names, passwords, e-mails, sign-ins and bans. Your side too: banned addresses and browsers, allowed pairs, notes, the audit log, the banner and the sign-in background, and gifts to everyone (one still open to new lords reaches everyone on the new world). A muted or frozen lord's next lord is muted or frozen for the time left.</td></tr>
        <tr><td>Cleared</td><td>${n(db.players, 'lord')} and ${n(db.castles, 'city', 'cities')}, with their heroes, troops, items, coins, mail and reports; ${n(db.alliances, 'alliance')} and their war reports${armies ? `; ${n(db.armies, 'army', 'armies')} out` : ''}${colonies ? `; ${n(db.colonies, 'colony', 'colonies')}` : ''}; the market, the Hall of Fame and its votes, chat and the newsboard. Valleys, NPC cities and Historic Cities go back to how they started.</td></tr>
        <tr><td>Backup</td><td>Before anything is cleared, the whole world is copied to <b>${esc(b.dir)}</b>. To undo the wipe, stop the server, put that file in place of <b>${esc(world)}</b> (renamed to world.json), and start the server again.</td></tr>
        <tr><td>Restart</td><td>The server restarts on the new world. With the autostart (install-autostart.bat) it's back by itself in about 15 seconds. If you run it from start.bat, its window stops: close it and run start.bat again. Everyone online is signed out with a note to come back in a minute.</td></tr>
      </table>
      ${this.form('wipe', {}, `<label><input type="checkbox" name="newMap" value="1"> Draw a new map too (the NPC cities, valleys and flats in new places)</label><br>
        <input name="confirm" placeholder="Type WIPE to confirm" size="22" autocomplete="off"> <button class="red">Wipe the world</button>`, { confirm: 'Wipe the world and keep only the accounts? Every lord and city goes. A backup is kept.' })}
      <p class="dim">Every copy, from wipes and the automatic ones, is on the ${this.link({ view: 'backups' }, 'Backups')} tab.</p>`;
  }
  // What the admin sees after the wipe, while the server restarts: it opens the admin page once the server is back.
  wipedPage(backup, restarts){
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Server admin</title><style>
      body{font:14px Arial,sans-serif;background:#1d1a16;color:#eee;margin:0;padding:20px 24px 60px;max-width:760px}h1{margin:0 0 14px;font-size:22px}b{color:#f0c96a}.dim{color:#9a9186}
      .note{background:#2f3d2c;border:1px solid #4f6b49;padding:9px 12px;border-radius:5px}</style></head><body><h1>The world is wiped</h1>
      <p class="note">A copy of the old world is in <b>${esc(backup)}</b>.</p>
      ${restarts ? `<p>The server is restarting on the new world. With the autostart it's back in about 15 seconds, and this page opens the admin page by itself.</p>
      <p>If you run the server from start.bat, its window has stopped: close it and run start.bat again.</p><p class="dim" id="w">Waiting for the server...</p>
      <script>setTimeout(function poll(){ fetch('/admin', { cache: 'no-store' }).then(r => { if (r.ok) location.href = '/admin?note=' + encodeURIComponent('Fresh start done: the new world is running.'); else setTimeout(poll, 3000); }, () => setTimeout(poll, 3000)); }, 6000);</script>`
        : '<p>Start the server again to run the new world.</p>'}</body></html>`;
  }
  audit(){
    const list = [...this.S.db.audit].reverse().slice(0, 1000);
    return `<h2>Audit log</h2>${list.length ? `<table><tr><th>When (UTC)</th><th>Action</th></tr>${list.map(x => `<tr><td class="nw">${when(x.t)}</td><td>${esc(x.action)} <b>${esc(x.target)}</b>${x.detail ? ` <span class="dim">${esc(x.detail)}</span>` : ''}</td></tr>`).join('')}</table>` : '<p class="dim">No admin actions yet.</p>'}`;
  }

  // ---------- the page ----------
  page(q){
    const g = this.g, now = g.now(), ok = q.get('t') === this.tok;
    if (q.get('view') === 'items' && q.get('format') === 'csv' && !q.get('_post')) return this.itemsCsv(q);
    let note = q.get('note') ? `<p class="note">${esc(q.get('note'))}</p>` : '';
    if (q.get('_post')){
      if (!ok) note = '<p class="note bad">That form had expired (the server restarted). Try again.</p>';
      else if (q.get('action') === 'reset'){
        const a = this.acct(q.get('name'));
        if (a){
          const t = require('./handlers/auth').makeReset(g, a), url = `${g.siteUrl()}/reset?token=${t}`;
          this.S.audit('made a password reset link for', a.name);
          note = `<p class="note">Reset link for <b>${esc(a.name)}</b>, good for a day. Send it to the player:<br><input readonly value="${esc(url)}" style="width:100%" onclick="this.select()"></p>`;
        }
      } else return this.act(q);
    }
    const view = q.get('view') || 'home';
    const body = view === 'accounts' ? this.accounts(q, now) : view === 'player' ? this.player(q, now) : view === 'alts' ? this.alts(now)
      : view === 'activity' ? this.activity(q) : view === 'bans' ? this.bans(now) : view === 'audit' ? this.audit() : view === 'wipe' ? this.wipe() : view === 'backups' ? this.backupsView() : view === 'gifts' ? this.giftsView(q, now) : view === 'items' ? this.itemsView(q) : this.home(now);
    const nav = [['home', 'Overview'], ['accounts', 'Accounts'], ['alts', 'Linked accounts'], ['activity', 'Activity'], ['bans', 'Bans'], ['audit', 'Audit log'], ['items', 'Items'], ['gifts', 'Gifts'], ['backups', 'Backups'], ['wipe', 'Fresh start']]
      .map(([v, l]) => this.link({ view: v }, l, v === view ? 'tab on' : 'tab')).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Server admin</title><style>
      body{font:14px Arial,sans-serif;background:#1d1a16;color:#eee;margin:0;padding:20px 24px 60px}h1{margin:0 0 4px;font-size:22px}h2{color:#e6c27a;font-size:18px;margin:26px 0 10px}h3{color:#e6c27a;font-size:15px;margin:22px 0 8px}
      a{color:#f0c96a}input,select,textarea,button{font:13px Arial,sans-serif;padding:5px 7px;border-radius:4px;border:1px solid #5a5248;background:#2b2722;color:#eee;margin:2px 3px 2px 0}
      button,.btn{display:inline-block;background:#b8860b;color:#111;border:0;font-weight:bold;cursor:pointer;text-decoration:none;padding:5px 10px;border-radius:4px}button.red{background:#c0473a;color:#fff}
      button.ghost,.btn.ghost{background:#3a342c;color:#eee}.nav{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:14px 0 6px;border-bottom:1px solid #3a342c;padding-bottom:8px}
      .tab{padding:6px 11px;border-radius:4px;text-decoration:none;color:#ddd}.tab.on{background:#3a342c;color:#f0c96a}.nav form{margin-left:auto}
      table{border-collapse:collapse;font-size:13px;margin:4px 0 8px}th,td{padding:5px 12px 5px 0;text-align:left;vertical-align:top;border-bottom:1px solid #34302a}th{color:#e6c27a;font-weight:normal}
      .facts td:first-child{color:#aaa;white-space:nowrap}.nw{white-space:nowrap}.dim{color:#9a9186}.bad{color:#f29b9b}.ok{color:#9be29b}
      .b{display:inline-block;font-size:11px;padding:1px 6px;border-radius:9px;background:#4a4238;color:#eee;margin:0 2px}.b.on{background:#2f5d33}.b.bad{background:#7a2e27}.b.warn{background:#7a5a17}
      .note{background:#2f3d2c;border:1px solid #4f6b49;padding:9px 12px;border-radius:5px}.note.bad{background:#4a2723;border-color:#7a3a33}
      .stats{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0}.stat{background:#2b2722;border:1px solid #3a342c;border-radius:6px;padding:10px 14px;min-width:110px}.stat b{font-size:22px;display:block}.stat span{color:#aaa;font-size:12px}.stat a{text-decoration:none}
      form.box{background:#24211d;border:1px solid #3a342c;border-radius:6px;padding:9px 11px;margin:6px 0}form.inline{display:inline}.acts form.inline{margin-right:6px}
      .group{background:#24211d;border:1px solid #3a342c;border-radius:6px;padding:4px 12px;margin:10px 0}a.mini{font-size:11px;background:#3a342c;padding:1px 6px;border-radius:9px;text-decoration:none;margin-left:6px}
      </style></head><body><h1>Server admin</h1><div class="dim">Age of War ${esc(g.version || '?')}${g.rules.battlePrestige?.losses ? ' <span class="bad">(data/rules.json turns prestige losses on)</span>' : ''} · ${Object.keys(g.db.accounts || {}).length} accounts, ${g.online.size} online</div>
      <div class="nav">${nav}<form class="inline"><input type="hidden" name="view" value="accounts"><input name="q" placeholder="account, lord, e-mail or address" size="28" value="${esc(view === 'accounts' ? q.get('q') || '' : '')}"><button>Find</button></form></div>
      ${note}${body}</body></html>`;
  }
}

module.exports = { AdminPage };
