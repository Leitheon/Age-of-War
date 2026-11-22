'use strict';
// Battle capture (live mode, m3.111), for fitting the battle engine to the live game. Every battle and scouting
// report that passes through this program on its way from the official server is kept in data/battles.jsonl, one
// JSON line each:
//   - to the new client (/json, the live relay),
//   - to RoboEvony through the bot port (live.botPort; the bot's Server field set to this program's address),
//   - to the Flash client in Ruffle (/ws),
//   - opened from a battle report link (/logfile/...; the report alone, nothing else is known).
// With each report goes what the official server had told that connection about the side it played: for an attack,
// the hero as he marched (his bean: attack, intelligence, leadership, equipment, buffs), the research levels and
// stars, the lord's and the city's buffs, the troops that marched, and the target's type and level on the map;
// for a defence, the city's heroes, research, buffs, Walls and defences. The report gives each side's troops, losses
// and the rounds. Together they are what the engine is fitted against (and what /battles shows).
// Nothing here changes what passes through. The bot port hands on every byte as it came, and only the official
// server's answers are read: the bot's own messages, its login among them, are never decoded. No account name,
// password or e-mail address is kept, only the lord's name, heroes, research, buffs, cities' defences and reports.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const net = require('net');
const amf3 = require('./amf3');

const SIZE = 800;           // the world (tile id = y x 800 + x, the client's Coordinate class)
const MAX_FRAME = 16 * 1048576;
const ARMY_DAYS = 3;        // marches are remembered this long for their reports
const UNIT = { 2: 'peasants', 3: 'militia', 4: 'scouter', 5: 'pikemen', 6: 'swordsmen', 7: 'archer', 8: 'carriage', 9: 'lightCavalry',
  10: 'heavyCavalry', 11: 'ballista', 12: 'batteringRam', 13: 'catapult', 14: 'trap', 15: 'abatis', 16: 'arrowTower', 17: 'rollingLogs', 18: 'rockfall' };
const FORT = new Set(['trap', 'abatis', 'arrowTower', 'rollingLogs', 'rockfall']);
const WALLS = 32;
const MISSION = { 3: 'scout', 5: 'attack', 7: 'colonize', 10: 'antiColonial' };
// Never kept, at any depth (and anything that looks like an e-mail address).
const SECRET = /^(user|userName|pwd|password|pass|newPassword|oldPassword|email|emailAddress|mail|accountName|account|key|sid|session_key|secret|facebook_id|fbFriendName|digiId)$/i;
const EMAIL = /[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}/gi;

// What the capture reads from the official server's answers (nothing else is decoded).
const HEARD = ['server.LoginResponse', 'server.HeroUpdate', 'server.PlayerBuffUpdate', 'server.CastleBuffUpdate', 'tech.getResearchList',
  'server.ResearchCompleteUpdate', 'server.AcademyResearchUpdate', 'server.FortificationsUpdate', 'server.TroopUpdate', 'server.BuildComplate',
  'server.CastleUpdate', 'server.SelfArmysUpdate', 'common.mapInfo', 'report.'];
const HEARD_BYTES = HEARD.map(s => Buffer.from(s, 'latin1'));
const isHeard = cmd => HEARD.some(h => cmd.startsWith(h));

// A copy without secrets (and without Functions, cycles or very deep nesting).
function clean(v, d = 0){
  if (typeof v === 'string') return v.replace(EMAIL, '***');
  if (v === null || typeof v !== 'object' || d > 8) return typeof v === 'object' ? null : v;
  if (Array.isArray(v)) return v.map(x => clean(x, d + 1));
  const o = {}; for (const [k, x] of Object.entries(v)) if (!SECRET.test(k) && typeof x !== 'function') o[k] = clean(x, d + 1);
  return o;
}

// ---------- the report XML ----------
// The reports are plain XML (elements and attributes, no text): a small reader does.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);
function parseXml(s){
  const root = { name: '#', attrs: {}, kids: [] }, stack = [root];
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>/g;
  let m;
  while ((m = re.exec(s))){
    if (!m[2]) continue;
    if (m[1]){ if (stack.length > 1) stack.pop(); continue; }
    const attrs = {}; for (const a of m[3].matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unesc(a[2] ?? a[3]);
    const el = { name: m[2], attrs, kids: [] };
    stack[stack.length - 1].kids.push(el);
    if (!m[4]) stack.push(el);
  }
  return root.kids[0] || null;
}
const find = (el, name) => { if (!el) return null; if (el.name === name) return el; for (const k of el.kids){ const f = find(k, name); if (f) return f; } return null; };
const num = v => v == null || v === '' || !Number.isFinite(+v) ? undefined : +v;
const yes = v => v === 'true' || v === '1';
const posXY = s => { const m = /\((\d+)\s*,\s*(\d+)\)\s*$/.exec(String(s || '')); return m ? { x: +m[1], y: +m[2] } : null; };
const unitName = id => UNIT[id] || `type${id}`;

// A report's numbers: kind, each side's troops (count and lose, by field name; defences under forts), rounds, result.
function readReport(xml){
  const root = parseXml(String(xml || ''));
  if (!root) return null;
  const b = find(root, 'battleReport');
  if (b){
    const side = el => {
      if (!el) return null;
      const a = el.attrs, troops = {}, forts = {};
      for (const u of el.kids) if (u.name === 'troopUnit'){ const f = unitName(u.attrs.typeId); (FORT.has(f) ? forts : troops)[f] = { count: num(u.attrs.count) || 0, lose: num(u.attrs.lose) || 0 }; }
      return { king: a.king || '', pos: a.castlePos || '', hero: a.heroName || '', heroLevel: num(a.heroLevel), troops, forts };
    };
    const a = b.attrs, back = {};
    for (const t of find(b, 'backTroop')?.kids || []) for (const i of t.kids) if (i.name === 'troopInfo') back[unitName(i.attrs.typeId)] = { remain: num(i.attrs.remain), injured: num(i.attrs.injured) };
    return { kind: 'battle', isAttack: yes(a.isAttack), won: yes(a.isAttackSuccess), rounds: num(a.round), heroExp: num(a.heroExp), injuredPer: num(a.injuredPer),
      attacker: side(find(b, 'attackTroop')), defender: side(find(b, 'defendTroop')), back: Object.keys(back).length ? back : undefined };
  }
  const s = find(root, 'scoutReport');
  if (s){
    const info = find(s, 'scoutInfo'), list = (name, item, key = 'count') => {
      const el = find(info, name); if (!el) return undefined;
      const o = {}; for (const k of el.kids) if (k.name === item) o[k.name === 'techType' ? k.attrs.type : unitName(k.attrs.typeId)] = k.attrs[key] != null && Number.isFinite(+k.attrs[key]) ? +k.attrs[key] : k.attrs[key];
      return o;
    };
    const walls = (find(info, 'buildings')?.kids || []).find(k => +k.attrs.type === WALLS);
    return { kind: 'scout', isAttack: yes(s.attrs.isAttack), found: s.attrs.isFound != null ? yes(s.attrs.isFound) : undefined, success: s.attrs.isSuccess != null ? yes(s.attrs.isSuccess) : undefined,
      hero: info?.attrs.heroName || undefined, heroLevel: num(info?.attrs.heroLevel), troops: list('troops', 'troopStrType'), forts: list('fortifications', 'fortificationsType'),
      techs: list('techs', 'techType', 'level'), walls: walls ? String(walls.attrs.levels) : undefined };
  }
  return { kind: root.kids[0]?.name || root.name };
}

// ---------- one connection's view of its lord ----------
class Tap {
  constructor(book, source){
    this.book = book; this.source = source; this.lord = ''; this.castles = new Map(); this.techs = null; this.buffs = new Map();
    this.armies = new Map(); this.tiles = null;
  }
  // An answer or message from the official server, as plain JSON (live.plain).
  heard(cmd, d){
    if (typeof cmd !== 'string' || !d || typeof d !== 'object' || !isHeard(cmd)) return;
    try { this.take(cmd, d); } catch (e){ this.book.log?.debug?.(`battle capture: ${cmd}: ${e.message}`); }
  }
  castle(id){ return this.castles.get(Number(id)); }
  take(cmd, d){
    switch (cmd){
      case 'server.LoginResponse': {
        if (d.ok !== undefined && d.ok !== 1 || !d.player) return;
        const p = d.player;
        this.lord = String(p.playerInfo?.userName || '');
        this.castles.clear();
        for (const c of p.castles || []) this.setCastle(c);
        this.buffs = new Map((p.buffs || []).filter(b => b?.typeId).map(b => [b.typeId, b]));
        return;
      }
      case 'server.CastleUpdate':
        if (d.castleBean?.id == null) return;
        if (d.updateType === 1) this.castles.delete(Number(d.castleBean.id)); else this.setCastle(d.castleBean, true);
        return;
      case 'server.HeroUpdate': {
        const c = this.castle(d.castleId), h = d.hero; if (!c || h?.id == null) return;
        if (d.updateType === 1) c.heroes.delete(h.id); else c.heroes.set(h.id, d.updateType === 2 ? { ...c.heroes.get(h.id), ...h } : h);
        return;
      }
      case 'server.PlayerBuffUpdate': this.buff(this.buffs, d); return;
      case 'server.CastleBuffUpdate': { const c = this.castle(d.castleid ?? d.castleId); if (c) this.buff(c.buffs, d); return; }
      case 'tech.getResearchList':
        if (!Array.isArray(d.acailableResearchBeans)) return;
        this.techs = this.techs || new Map();
        for (const r of d.acailableResearchBeans) this.tech(r);
        return;
      case 'server.AcademyResearchUpdate': if (d.researchBean) this.tech(d.researchBean); return;
      case 'server.ResearchCompleteUpdate': if (this.techs && d.typeId != null) this.techs.set(Number(d.typeId), { ...this.techs.get(Number(d.typeId)), level: Number(d.level) || 0 }); return;
      case 'server.FortificationsUpdate': { const c = this.castle(d.castleId); if (c && d.fortification) c.forts = d.fortification; return; }
      case 'server.TroopUpdate': { const c = this.castle(d.caslteId ?? d.castleId); if (c && d.troop) c.troop = d.troop; return; }
      case 'server.BuildComplate': {
        const c = this.castle(d.castleId), b = d.buildingBean; if (!c || !b) return;
        c.buildings.set(Number(b.positionId), { typeId: b.typeId, level: b.level });
        return;
      }
      case 'server.SelfArmysUpdate': this.marches(d.armys || []); return;
    }
    if (cmd.startsWith('common.mapInfo')) return this.map(d);
    if (cmd.startsWith('report.')) for (const r of [d.report, ...(Array.isArray(d.reports) ? d.reports : [])])
      if (r && typeof r.content === 'string' && r.content.includes('<reportData')) this.book.report(this, r);
  }
  setCastle(c, merge = false){
    const id = Number(c.id), old = merge ? this.castles.get(id) : null;
    const buildings = old && !c.buildings ? old.buildings : new Map((c.buildings || []).map(b => [Number(b.positionId), { typeId: b.typeId, level: b.level }]));
    this.castles.set(id, { id, name: c.name ?? old?.name, fieldId: c.fieldId ?? old?.fieldId, heroes: c.heros ? new Map(c.heros.map(h => [h.id, h])) : old?.heroes || new Map(),
      troop: c.troop || old?.troop, forts: c.fortification || old?.forts, buildings, buffs: c.buffs ? new Map(c.buffs.filter(b => b?.typeId).map(b => [b.typeId, b])) : old?.buffs || new Map() });
  }
  buff(map, d){ const b = d.buffBean; if (!b?.typeId) return; if (d.updateType === 1) map.delete(b.typeId); else map.set(b.typeId, b); }
  tech(r){ if (r?.typeId == null) return; this.techs = this.techs || new Map(); this.techs.set(Number(r.typeId), { level: Number(r.level) || 0, star: Number(r.enhancedstarlv) || 0 }); }
  map(d){
    const s = d.mapStr; if (typeof s !== 'string') return;
    const x1 = d.x1 | 0, y1 = d.y1 | 0, x2 = d.x2 | 0, y2 = d.y2 | 0;
    if (x2 < x1 || y2 < y1 || (x2 - x1 + 1) * (y2 - y1 + 1) * 2 > s.length) return;
    this.tiles = this.tiles || new Uint8Array(SIZE * SIZE);
    let i = 0;
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++, i += 2){
      const t = parseInt(s[i], 16), L = parseInt(s[i + 1], 16);
      if (t >= 0 && L >= 0) this.tiles[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)] = (t << 4) | L;
    }
  }
  tile(fieldId){
    const id = Number(fieldId); if (!(id >= 0 && id < SIZE * SIZE)) return null;
    const v = this.tiles?.[id];
    return { fieldId: id, x: id % SIZE, y: Math.floor(id / SIZE), ...(v ? { type: v >> 4, level: v & 15 } : {}) };
  }
  // What the side had: research, the lord's buffs and the city's (each with its end time).
  state(c){
    const techs = this.techs ? Object.fromEntries([...this.techs].filter(([, t]) => t.level > 0).map(([id, t]) => [id, t.level])) : null;
    const stars = this.techs ? Object.fromEntries([...this.techs].filter(([, t]) => t.star > 0).map(([id, t]) => [id, t.star])) : null;
    const buffs = [...this.buffs.values()].map(b => ({ typeId: b.typeId, endTime: b.endTime, descName: b.descName }));
    const cityBuffs = c ? [...c.buffs.values()].map(b => ({ typeId: b.typeId, endTime: b.endTime, descName: b.descName })) : [];
    return { techs, techStars: stars && Object.keys(stars).length ? stars : undefined, buffs, cityBuffs };
  }
  // Each march as it sets out: the hero as he left, the troops, the state of research and buffs, the target tile.
  marches(list){
    const now = Date.now();
    for (const [id, a] of this.armies) if (now - a.seenAt > ARMY_DAYS * 86400000) this.armies.delete(id);
    for (const a of list){
      if (a?.armyId == null || this.armies.has(a.armyId) || a.direction !== 1 || !MISSION[a.missionType]) continue;
      const c = [...this.castles.values()].find(x => x.fieldId === a.startFieldId);
      const hero = c ? c.heroes.get(a.heroid) || [...c.heroes.values()].find(h => h.name === a.hero) : null;
      const troops = {}; for (const [k, n] of Object.entries(a.troop || {})) if (+n > 0) troops[k] = +n;
      this.armies.set(a.armyId, {
        seenAt: now, armyId: a.armyId, mission: MISSION[a.missionType], castleId: c?.id, castle: c?.name, from: a.startPosName, to: a.targetPosName,
        startTime: a.startTime, reachTime: a.reachTime, heroName: a.hero || '', heroLevel: a.heroLevel, troops,
        hero: hero ? clean(hero) : null, target: this.tile(a.targetFieldId), ...this.state(c),
      });
    }
  }
  // The march a report is about: same hero, the same troops, arriving nearest the report.
  march(side){
    const want = Object.entries(side.troops).filter(([, u]) => u.count > 0);
    let best = null;
    for (const a of this.armies.values()){
      if ((a.heroName || '') !== (side.hero || '')) continue;
      const k = Object.keys(a.troops);
      if (k.length !== want.length || !want.every(([f, u]) => a.troops[f] === u.count)) continue;
      const d = Math.abs((a.reachTime || a.seenAt) - Date.now());
      if (!best || d < best.d) best = { a, d };
    }
    return best?.a || null;
  }
  heroNamed(name){ if (!name) return null; for (const c of this.castles.values()) for (const h of c.heroes.values()) if (h.name === name) return clean(h); return null; }
  // A defending city as it is now (the report has its troops and defences before the battle).
  defence(side){
    const xy = posXY(side.pos); if (!xy) return null;
    const c = [...this.castles.values()].find(x => x.fieldId === xy.y * SIZE + xy.x); if (!c) return null;
    const hero = side.hero ? [...c.heroes.values()].find(h => h.name === side.hero) : null;
    const walls = Math.max(0, ...[...c.buildings.values()].filter(b => b.typeId === WALLS).map(b => b.level || 0));
    return { castleId: c.id, castle: c.name, hero: hero ? clean(hero) : null, walls, fortsNow: c.forts ? clean(c.forts) : undefined, ...this.state(c) };
  }
}

// ---------- the book: data/battles.jsonl ----------
class BattleBook {
  constructor(dir, log){
    this.file = path.join(dir, 'battles.jsonl'); this.log = log; this.keys = new Map(); this.saved = 0;
    try {
      for (const line of fs.readFileSync(this.file, 'utf8').split('\n')){
        if (!line.trim()) continue;
        try { const r = JSON.parse(line); if (r.key) this.keys.set(r.key, r.score || 0); } catch (e){}
      }
    } catch (e){}
  }
  tap(source){ return new Tap(this, source); }
  // The same report (the same side's copy) has the same key wherever it was seen.
  keyOf(xml){ return crypto.createHash('sha1').update(String(xml).replace(/\s+reportUrl="[^"]*"/g, '').replace(/>\s+</g, '><').trim()).digest('hex').slice(0, 20); }
  // Kept if new, or if this sighting knows more about it (the last line for a key is the one that counts).
  save(rec){
    const had = this.keys.get(rec.key);
    if (had !== undefined && had >= rec.score) return false;
    this.keys.set(rec.key, rec.score);
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.appendFileSync(this.file, JSON.stringify(rec) + '\n'); this.saved++; }
    catch (e){ this.log?.warn?.(`Couldn't save a battle report in ${this.file}: ${e.message}`); return false; }
    return true;
  }
  // A report from a connection, with what it knew about its lord.
  report(tap, bean){
    const xml = bean.content, rep = readReport(xml);
    if (!rep || (rep.kind !== 'battle' && rep.kind !== 'scout')) return;
    const rec = { v: 1, key: this.keyOf(xml), source: tap.source, at: Date.now(), lord: tap.lord || undefined,
      bean: { id: bean.id, type: bean.type, armyType: bean.armyType, title: bean.title, startPos: bean.startPos, targetPos: bean.targetPos, eventTime: bean.eventTime },
      report: rep };
    if (rep.kind === 'battle' && tap.lord){
      // (A report with no march seen, as when the bot started after the army left: the hero and research as they
      // are now, marked matched: false.)
      if (rep.attacker?.king === tap.lord){ rec.side = 'attack'; const a = tap.march(rep.attacker); rec.attacker = a ? { matched: true, ...a } : { matched: false, hero: tap.heroNamed(rep.attacker.hero), ...tap.state(null) }; }
      else if (rep.defender?.king === tap.lord){ rec.side = 'defence'; rec.defender = tap.defence(rep.defender) || { ...tap.state(null) }; }
    } else if (rep.kind === 'scout' && tap.lord) rec.side = rep.isAttack ? 'attack' : 'defence';
    const ctx = rec.attacker || rec.defender;
    rec.score = 1 + (ctx?.hero ? 2 : 0) + (ctx?.techs ? 2 : 0) + (ctx?.matched ? 1 : 0) + (ctx?.target?.level ? 1 : 0) + (ctx?.walls != null ? 1 : 0);
    rec.xml = xml;
    if (rec.attacker) rec.attacker = clean(rec.attacker);
    if (rec.defender) rec.defender = clean(rec.defender);
    if (this.save(rec)) this.logSaved(rec);
  }
  // A report opened from a link (/logfile/...): the report alone.
  link(p, host, xml){
    const rep = readReport(xml);
    if (!rep || rep.kind !== 'battle' && rep.kind !== 'scout') return false;
    const rec = { v: 1, key: this.keyOf(xml), source: 'link', at: Date.now(), url: `http://${host}/default.html?${String(p).replace(/^\//, '')}`, report: rep, score: 0, xml };
    const ok = this.save(rec); if (ok) this.logSaved(rec);
    return ok;
  }
  // The reports already opened from links (cache/logfile for NA62's, cache/logfile-<host> for another server's), once.
  importCache(cacheDir, host){
    const top = path.join(cacheDir, reportCacheName(host)); let n = 0;
    const walk = d => { let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e){} for (const e of list){ const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.xml$/i.test(e.name)) try {
      const xml = fs.readFileSync(f, 'utf8'); if (this.keys.has(this.keyOf(xml))) continue;
      const rel = path.relative(cacheDir, f).split(path.sep).join('/'), rep = readReport(xml);
      if (rep && (rep.kind === 'battle' || rep.kind === 'scout') && this.save({ v: 1, key: this.keyOf(xml), source: 'link', at: fs.statSync(f).mtimeMs, url: `http://${host}/default.html?${rel}`, report: rep, score: 0, xml })) n++;
    } catch (e){} } };
    walk(top);
    if (n) this.log?.info?.(`Battle capture: added ${n} report${n > 1 ? 's' : ''} you had opened from links (cache/logfile)`);
    return n;
  }
  logSaved(rec){
    const r = rec.report, a = r.attacker, d = r.defender, ctx = rec.attacker || rec.defender;
    const sum = s => Object.values(s?.troops || {}).reduce((t, u) => t + u.count, 0).toLocaleString('en-US');
    const what = r.kind === 'battle' ? `${a?.king || '?'}${a?.hero ? `'s ${a.hero}` : ''} (${sum(a)}) vs ${[d?.king, d?.pos || rec.bean?.targetPos].filter(Boolean).join(' ') || '?'} (${sum(d)}): ${r.rounds ?? '?'} rounds, ${r.won ? 'attacker won' : 'defender held'}`
      : `scouting ${rec.bean?.targetPos || ''}`;
    const known = !ctx ? '' : [ctx.hero ? 'hero' : '', ctx.techs ? 'research' : '', ctx.matched ? 'march' : '', ctx.target?.level ? `target level ${ctx.target.level}` : '', ctx.walls != null ? `Walls ${ctx.walls}` : ''].filter(Boolean).join(', ');
    this.log?.info?.(`Battle saved (${rec.source}): ${what}${known ? ` [${known}]` : ''}`);
  }
  // Every report kept (the last line for each), newest first.
  all(){
    const by = new Map();
    let text = ''; try { text = fs.readFileSync(this.file, 'utf8'); } catch (e){ return []; }
    for (const line of text.split('\n')){ if (!line.trim()) continue; try { const r = JSON.parse(line); if (r.key) by.set(r.key, r); } catch (e){} }
    return [...by.values()].sort((a, b) => (b.at || 0) - (a.at || 0));
  }
}

// ---------- reading a game socket's bytes ----------
// The official server's side of a connection, read as it goes by: 4-byte length (top bit: zlib), AMF3 {cmd, data}.
// Only frames naming a command the capture uses are decoded, unless all is set (the recorder: every frame, either
// way). A Flash policy request or answer ('<...\0') is skipped.
class FrameReader {
  constructor(onMessage, all = false){ this.buf = null; this.onMessage = onMessage; this.dead = false; this.all = all; }
  push(d){
    if (this.dead) return;
    this.buf = this.buf ? Buffer.concat([this.buf, d]) : d;
    while (this.buf && this.buf.length){
      if (this.buf[0] === 0x3c){ const z = this.buf.indexOf(0); if (z < 0){ if (this.buf.length > 65536) this.stop(); return; } this.buf = this.buf.subarray(z + 1); continue; }
      if (this.buf.length < 4) return;
      const word = this.buf.readUInt32BE(0), len = word & 0x7fffffff;
      if (len > MAX_FRAME){ this.stop(); return; }
      if (this.buf.length < 4 + len) return;
      let body = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      try {
        if (word >>> 31) body = zlib.inflateSync(body);
        if (!this.all && !HEARD_BYTES.some(h => body.indexOf(h) >= 0)) continue;
        const msg = amf3.decode(body);
        if (msg && typeof msg.cmd === 'string' && (this.all || isHeard(msg.cmd))) this.onMessage(msg.cmd, require('./live').plain(msg.data));
      } catch (e){}
    }
    if (this.buf && !this.buf.length) this.buf = null;
  }
  stop(){ this.dead = true; this.buf = null; }
}

// ---------- the bot port ----------
// RoboEvony (patched to take an address as its server) typed with this program's address reads config.xml here,
// which names this port as the game server. Each connection is handed to the official server byte for byte
// (directly or through a proxy: upstream.js), and read as it goes by: the official server's side for the battle
// capture, both sides for the recorder (recorder.js).
// cities (botcities.js): which city ids each account has, for the auto-login kit; null for none.
function startBotPort(live, book, log, httpPort = 8081, recorder = null, upstream = null, cities = null){
  const POLICY = require('./net').POLICY_XML;
  const { Upstream } = require('./upstream');
  const ups = upstream || new Upstream(live, log);
  const NAME = String(live.server || '').toUpperCase() || 'the official server';
  let inGame = 0;   // bots logged in through this port now
  const srv = net.createServer(bot => {
    bot.setNoDelay(true);
    let up = null, closed = false, first = true, rec = null, toBot = null, fromBot = null, lord = '', acct = '';
    const tap = book ? book.tap('bot') : null;
    // How each bot's login went, in the window: with 50 accounts, which are in and which need something. Only the
    // lord's name is shown, never the account (its email) or password.
    const loginNote = x => {
      const ok = x?.ok;
      if (ok === 1 && x.player){
        if (!lord) inGame++;
        lord = String(x.player.playerInfo?.userName || '?').replace(/[\x00-\x1f]/g, ' ').slice(0, 40);
        const n = (x.player.castles || []).length;
        if (acct) cities?.set(acct, lord, (x.player.castles || []).map(c => c?.id));
        log.info(`Bot logged in on ${NAME}: lord ${lord}, ${n} cit${n === 1 ? 'y' : 'ies'} (${inGame} bot${inGame === 1 ? '' : 's'} in now)`);
      } else if (ok === -4) log.warn(`A bot's account has no lord on ${NAME} yet: the server wants a city founded before it can play (the bot window says which account).`);
      else if (ok !== undefined) log.warn(`A bot's login on ${NAME} was refused (${ok}): ${String(x.errorMsg || x.msg || 'no reason given').replace(/[\x00-\x1f]/g, ' ').slice(0, 120)}`);
    };
    const close = () => { if (closed) return; closed = true; bot.destroy(); up?.destroy(); rec?.close(); if (lord) inGame--; log.info(`RoboEvony disconnected from the bot port${lord ? ` (lord ${lord}; ${inGame} bot${inGame === 1 ? '' : 's'} in now)` : ''}`); };
    bot.on('error', close); bot.on('close', close);
    bot.on('data', d => {
      if (first){
        first = false;
        // A Flash policy request on this port is answered here (the official server isn't asked).
        if (d[0] === 0x3c && /^<policy-file-request\/>/.test(d.toString('latin1', 0, 23))){ closed = true; bot.end(POLICY); return; }
        rec = recorder ? recorder.session('bot') : null;
        toBot = new FrameReader((cmd, x) => {
          if (cmd === 'server.LoginResponse') loginNote(x);
          else if (cmd === 'server.CastleUpdate' && acct && x?.castleBean?.id != null) x.updateType === 1 ? cities?.remove(acct, x.castleBean.id) : cities?.add(acct, x.castleBean.id);
          tap?.heard(cmd, x); rec?.down(cmd, x);
        }, !!rec);
        // The bot's side: for the recorder, and for which account this is (only a hash of its name, for cities).
        if (rec || cities) fromBot = new FrameReader((cmd, x) => {
          if (cmd === 'login' && cities && x?.user != null){ acct = require('./botcities').key(x.user); if (!rec) fromBot.stop(); }
          rec?.up(cmd, x);
        }, true);
        up = ups.open();
        up.setNoDelay(true);
        up.setTimeout(20000, () => { log.warn(`Bot port: no answer from the official server at ${live.host}:${live.port} (${up.via})`); close(); });
        up.on('up', () => { up.setTimeout(0); log.info(`RoboEvony connected to the bot port: passing it to the official server at ${live.host}:${live.port} (${up.via})`); });
        up.on('data', x => { if (!bot.destroyed && !bot.write(x)) up.pause(); try { toBot?.push(x); } catch (e){} });
        up.on('error', e => { log.warn(`Bot port: official server ${live.host ? `${live.host}:${live.port}` : NAME}: ${e.code || e.message}`); close(); });
        up.on('close', close);
        bot.on('drain', () => up.resume());
        up.on('drain', () => bot.resume());
      }
      if (up && !up.write(d)) bot.pause();
      try { fromBot?.push(d); } catch (e){}
    });
  });
  srv.on('error', e => log.error(`The bot port ${live.botPort} couldn't open: ${e.code || e.message} (set live.botPort in config.json)`));
  srv.listen(live.botPort, () => log.info(`Bot port ${live.botPort}: in RoboEvony, set Server to this program's address (e.g. 127.0.0.1:${httpPort})`));
  return srv;
}

// Where reports opened from links are kept, by their report host: cache/logfile is NA62's (all the reports kept
// before CC2 was played), another server's go in cache/logfile-<host>, so a copy on CC2 sharing the cache (for the
// art) never takes NA62's reports for its own.
const NA62_REPORTS = 'battlena62.evony.com';
const reportCacheName = host => { const h = String(host || NA62_REPORTS).toLowerCase(); return h === NA62_REPORTS ? 'logfile' : `logfile-${h.replace(/[^a-z0-9.-]/g, '')}`; };

module.exports = { BattleBook, Tap, FrameReader, readReport, parseXml, startBotPort, clean, reportCacheName };
