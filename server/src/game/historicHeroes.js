'use strict';
// Historic heroes (Fox, Oct 2026). Each one waits in an NPC city somewhere on the map. At the Inn a lord hears
// rumours about them ("Hearsay"), can pay 100 gold for more rumours or 1,000 gold to search by name, and can pay
// 10 cents to "Enquire Details": the exact location, a report, and the hero's portrait, which is needed to
// recruit the hero. Every won attack on that NPC city lowers the city's loyalty; at 0 the attacker conquers it
// (Fox's live reports, Oct 23 2026), and with the quest accepted and the portrait in hand captures the hero, who
// waits in the Feasting Hall to be persuaded. Otherwise the hero gets away to another NPC city.
//
// Names, biographies and portraits come from the client (its hero.taskitem.N items; portrait
// images/icon/hero/N.png). Base stats (level 1) come from the hero sheet, src/data/historic-heroes.csv: for Age of
// War, DoA's hero list (Fox, Nov 2026: its 698 heroes, the client's 639 and the 59 DoA added, 700 to 758); a
// data/historic-heroes.csv next to world.json replaces it. Heroes the sheet doesn't cover get estimated stats.
//
// The sheet can also add heroes the client doesn't have (m3.128, for the mod): a row whose ID isn't one of the
// client's is a new hero, with its own Bio and Sex columns; its portrait is images/icon/hero/<ID>.png (art/heroes/
// or art/flash/images/icon/hero/; with none, http.js shows "portrait unknown"). A Bio column replaces a client
// hero's biography. With rules.historicHeroes.sheetDefines
// the sheet is the whole roster: its names, and only its heroes. Wherever a hero's name or biography isn't the
// client's own, the client is told (common.getItemDefXml, as live tells it about items newer than it is).
const fs = require('fs');
const path = require('path');
const world = require('./world');

const QUEST_BASE = 2000000;           // quest ids: QUEST_BASE + hero id; QUEST_BASE itself is the "Heros" quest type
// Live (Fox's screenshot, Oct 2026): every historic hero's quest pays this once the hero is captured.
const QUEST_AWARD = 'Aries Amulet*1, Beginner Guidelines*1, Population*30, Food*200, Lumber*1000, Stone*200, Iron*100';
const FEMALE = /^(Hildegard|Joan|Hypatia|Alix|Amy|Anna|Anne|Ann |Antonia|Arbella|Atia|Aurelia|Bess|Brunhilde|Catherine|Diane|Dhuoda|Edith|Eleanor|Elizabeth|Emma|Empress|Fredegund|Isabella|Jane|Jeanne|Kassia|Louise|Lucre|Margaret|Marguerite|Mary|Olga|Paulina|Petronilla|Philaenis|Queen|Theodora|Zorayda|Alfgifu|Elfthryth|Christina|Nancy|Punyaslok|Cuhtuhlatah|Sybil|Manuela|Deborah|Angelique|Wang Cong|Granuaile|Chand Bibi|Gao Guiying|Hannah|Charlotte|Rani)/;

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function lev(a, b){
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function parseCsv(text){
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (q){ if (ch === '"'){ if (text[i + 1] === '"'){ cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ','){ row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r'){ if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(c => c.trim())) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some(c => c.trim())) rows.push(row);
  return rows;
}
// A stable pseudo-random number in [0, 1) for estimated stats.
const hash = (id, salt) => { let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35); h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h ^= h >>> 15; return (h >>> 0) / 4294967296; };

// The roster: { id, name, bio, portrait, pol, int, atk, ldr, female, estimated, clientName, clientBio, added }
// opts.sheetDefines: only the sheet's heroes, under the sheet's names.
function loadRoster(data, csvFiles, opts = {}){
  const roster = new Map();
  for (const it of Object.values(data.items)){
    const m = /^hero\.taskitem\.(\d+)$/.exec(it.id); if (!m) continue;
    const id = Number(m[1]), name = it.name.trim();
    // (item: the client's own item id, which for heroes 1 to 9 is hero.taskitem.01 to .09)
    roster.set(id, { id, item: it.id, name, bio: it.desc.trim(), portrait: `images/icon/hero/${id}.png`, female: FEMALE.test(name), estimated: true, clientName: it.name, clientBio: it.desc });
  }
  const file = csvFiles.find(f => fs.existsSync(f));
  const unmatched = [], inSheet = new Set();
  if (file){
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    const head = rows.shift().map(h => fold(h));
    const col = k => head.findIndex(h => h.startsWith(k));
    // (Columns by their headings: Politics or Pol, Attack or Atk, Intelligence or Int, Leadership or Ldr.)
    const any = (...ks) => { for (const k of ks){ const i = col(k); if (i >= 0) return i; } return -1; };
    const iName = any('heroname', 'name') >= 0 ? any('heroname', 'name') : 0, iPol = any('politic', 'pol'), iInt = any('intel', 'int'), iAtk = any('attack', 'atk'), iLdr = any('leader', 'ldr');
    const iImg = col('image') >= 0 ? col('image') : head.indexOf('id'), iBio = col('bio') >= 0 ? col('bio') : col('descr'), iSex = col('sex') >= 0 ? col('sex') : col('gender');
    const byFold = new Map([...roster.values()].map(h => [fold(h.name), h]));
    const taken = new Set();
    const num = v => { const t = String(v ?? '').trim(), n = Number(t); return t !== '' && Number.isFinite(n) ? n : null; };
    for (const r of rows){
      const name = (r[iName] || '').trim(); if (!name) continue;
      let h = null; const img = num(r[iImg]);
      if (img != null && roster.has(img) && !taken.has(img)) h = roster.get(img);
      // A hero the client doesn't have: the row's ID is his.
      else if (img != null && Number.isSafeInteger(img) && img > 0 && !roster.has(img)){
        h = { id: img, item: `hero.taskitem.${img}`, name, bio: '', portrait: `images/icon/hero/${img}.png`, female: FEMALE.test(name), estimated: true, added: true };
        roster.set(img, h); byFold.set(fold(name), h);
      }
      if (!h){ const f = byFold.get(fold(name)); if (f && !taken.has(f.id)) h = f; }
      if (!h){
        let best = null, bd = 4; const fn = fold(name);
        for (const c of roster.values()){ if (taken.has(c.id)) continue; const d = lev(fn, fold(c.name)); if (d < bd){ bd = d; best = c; } }
        h = best;
      }
      if (!h){
        // A shortened name: "Diego Sarmiento de Acuna." for "Diego Sarmiento de Acuna. Conde de Gondomar".
        const fn = fold(name.replace(/\(.*\)/, ''));
        if (fn.length >= 8) h = [...roster.values()].find(c => !taken.has(c.id) && (fold(c.name).startsWith(fn) || fold(c.name.replace(/\(.*\)/, '')) === fn)) || null;
      }
      if (!h){ unmatched.push(name); continue; }
      taken.add(h.id); h.sheetName = name; inSheet.add(h.id);
      if (opts.sheetDefines || h.added) h.name = name;
      const bio = iBio >= 0 ? String(r[iBio] || '').trim() : '', sex = iSex >= 0 ? String(r[iSex] || '').trim().toUpperCase() : '';
      if (bio) h.bio = bio;
      if (sex) h.female = sex.startsWith('F') || sex.startsWith('W');
      const vals = { pol: num(r[iPol]), int: num(r[iInt]), atk: num(r[iAtk]), ldr: num(r[iLdr]) };
      for (const [k, v] of Object.entries(vals)) if (v != null) h[k] = v;
      h.estimated = Object.values(vals).some(v => v == null);
    }
  }
  if (opts.sheetDefines && file) for (const id of [...roster.keys()]) if (!inSheet.has(id)) roster.delete(id);
  // The client lists a few heroes twice (Ibn Khaldun, Meister Eckhart); the copy without a row gets the other's stats.
  for (const h of roster.values()){
    if (opts.sheetDefines) break;
    if (h.sheetName) continue;
    const twin = [...roster.values()].find(o => o !== h && o.sheetName && fold(o.name) === fold(h.name));
    if (twin){ for (const k of ['pol', 'int', 'atk', 'ldr']) if (twin[k] != null) h[k] = twin[k]; h.estimated = twin.estimated; h.sheetName = twin.sheetName; }
  }
  // Estimated stats for whatever the sheet doesn't give: 23-99 in each attribute, leadership 48-133, the
  // ranges the sheet shows.
  for (const h of roster.values()){
    h.pol ??= 23 + Math.floor(hash(h.id, 1) * 77);
    h.int ??= 23 + Math.floor(hash(h.id, 2) * 77);
    h.atk ??= 23 + Math.floor(hash(h.id, 3) * 77);
    h.ldr ??= 48 + Math.floor(hash(h.id, 4) * 86);
  }
  return { roster, file, unmatched };
}

const xmlAttr = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\r\n\t]+/g, ' ');
// The client's item for each hero whose name or biography isn't the client's own (or who is new to it), in the
// client's own form for hero.taskitem.N (as its item list has them; live sends items this way).
function heroItems(roster){
  const out = [];
  for (const h of roster.values()){
    if (!h.added && h.name === h.clientName?.trim() && h.bio === h.clientBio?.trim()) continue;
    out.push({ id: h.item, name: h.name, itemType: '任务', dayLimit: 0, userLimit: 0, desc: h.bio, itemDesc: h.name, iconUrl: h.portrait, price: 0 });
  }
  return out;
}
function itemXml(items){
  const rows = items.map(it => `<itemEum ${Object.entries(it).map(([k, v]) => `${k}="${xmlAttr(v)}"`).join(' ')}/>`);
  return `<?xml version="1.0" encoding="UTF-8"?><itemdef><items>${rows.join('')}</items><special/><special2/></itemdef>`;
}

// Takes n points off an allocation { pol, atk, int }, in proportion to each (largest remainders first).
function shrink(a, n){
  const keys = ['pol', 'atk', 'int'], have = keys.reduce((s, k) => s + Math.max(0, a[k] || 0), 0);
  if (!(n > 0) || !have){ return a; }
  const keep = Math.max(0, have - n), share = keys.map(k => Math.max(0, a[k] || 0) * keep / have), floor = share.map(Math.floor);
  let left = keep - floor.reduce((x, y) => x + y, 0);
  for (const i of [0, 1, 2].sort((x, y) => (share[y] - floor[y]) - (share[x] - floor[x]))){ if (left <= 0) break; floor[i]++; left--; }
  keys.forEach((k, i) => { a[k] = floor[i]; });
  return a;
}

class HistoricHeroLogic {
  constructor(game, dataDir){
    this.g = game;
    const r = game.rules?.historicHeroes || {}, sheet = path.basename(r.sheet || 'historic-heroes.csv');
    const { roster, file, unmatched } = loadRoster(game.data, [path.join(dataDir || '', sheet), path.join(__dirname, '..', 'data', sheet)], { sheetDefines: !!r.sheetDefines });
    this.roster = roster;
    this.source = file;
    this.unmatched = unmatched;
    this.byField = new Map();
    // Heroes the client doesn't know, or knows by another name or biography: the client is told (getItemDefXml),
    // and the server's own item list has them too.
    this.items = heroItems(roster);
    for (const it of this.items){ const had = game.data.items[it.id]; game.data.items[it.id] = { ...(had || {}), ...it }; }
  }
  // common.getItemDefXml: the client adds these to its item list (live sends its newer items this way).
  itemXml(){ return itemXml(this.items);
  }
  get rules(){ return this.g.rules.historicHeroes; }
  // A hero's portrait item: hero.taskitem.N, as the client names it (hero.taskitem.01 to .09 for heroes 1 to 9).
  item(id){ return this.roster.get(Number(id))?.item || `hero.taskitem.${id}`; }
  get db(){ return this.g.store.db; }
  state(id){ return this.db.hh[id]; }
  // Put every hero that isn't hired or waiting at an Inn into an NPC city. Run at startup.
  seed(){
    this.db.hh = this.db.hh || {};
    this.byField.clear();
    for (const [id, s] of Object.entries(this.db.hh)) if (s.status === 'free' && s.fieldId != null && this.roster.has(Number(id))) this.byField.set(s.fieldId, Number(id));
    // Before 0.1.17 heroes 1 to 9's portraits were given as hero.taskitem.1 to .9, which the client doesn't know.
    for (const p of Object.values(this.db.players || {})) for (const k of Object.keys(p.items || {})){
      const m = /^hero\.taskitem\.(\d+)$/.exec(k), to = m && this.item(Number(m[1]));
      if (to && to !== k){ p.items[to] = (p.items[to] || 0) + p.items[k]; delete p.items[k]; this.g.store.touch?.(); }
    }
    this.dropRemoved();
    this.seatRulers();
    this.placeRulers();
    let placed = 0;
    for (const h of this.roster.values()){
      const s = this.db.hh[h.id];
      if (s && s.status !== 'free') continue;
      if (s && s.fieldId != null && this.isNpcCity(s.fieldId)) continue;
      this.place(h.id); placed++;
    }
    if (placed) this.g.store.touch?.();
    return placed;
  }
  // Heroes taken off the hero sheet (Fox, Nov 2026: none from the American Civil War on) leave the map: no longer
  // in a barbarian city, in a lord's hearsay, quests or Enquire Details, and their portraits are taken back. One a
  // lord already hired or holds stays his (logged).
  dropRemoved(){
    const gone = id => !this.roster.has(Number(id));
    let n = 0;
    for (const [id, st] of Object.entries(this.db.hh)) if (gone(id) && (st.status === 'free' || st.status == null)){ delete this.db.hh[id]; n++; }
    for (const p of Object.values(this.db.players || {})){
      if (p.hearsay?.ids?.some(gone)){ p.hearsay.ids = p.hearsay.ids.filter(id => !gone(id)); n++; }
      for (const id of Object.keys(p.hhQuests || {})) if (gone(id)){ delete p.hhQuests[id]; n++; }
      for (const id of Object.keys(p.hhKnown || {})) if (gone(id)){ delete p.hhKnown[id]; n++; }
      for (const k of Object.keys(p.items || {})){ const m = /^hero\.taskitem\.(\d+)$/.exec(k); if (m && gone(m[1])){ delete p.items[k]; n++; } }
    }
    if (n) this.g.store.touch?.();
    const kept = Object.values(this.db.castles || {}).flatMap(c => (c.heroes || []).filter(h => h.historic != null && gone(h.historic)).map(h => h.name));
    if (kept.length) this.g.log?.info?.(`Historic heroes no longer on the hero sheet, still with the lords who have them: ${kept.join(', ')}`);
    return n;
  }
  // ---------- Historic City rulers (rules.historic.rulers) ----------
  // { heroId: fieldId } of the Historic Cities that have a ruler, by the names in the rules.
  rulers(){
    if (this._rulers) return this._rulers;
    const want = this.g.rules.historic?.rulers || {}, byName = new Map([...this.roster.values()].map(h => [fold(h.name), h.id]));
    const cities = new Map([...world.historicEntries()].map(([id, hc]) => [fold(hc.name), id]));
    const out = {};
    for (const [city, hero] of Object.entries(want)){
      const id = byName.get(fold(hero)), fid = cities.get(fold(city));
      if (id == null || fid == null){ this.g.log?.warn?.(`Historic City ruler ${hero} for ${city}: ${id == null ? 'no such hero' : 'no such city'}`); continue; }
      out[id] = fid;
    }
    return (this._rulers = out);
  }
  rulerLevel(){ return this.g.rules.historic?.rulerLevel || 1; }
  // Seat each ruler in his city, out of the barbarian cities and the Inn's rumours, unless a lord holds him. True if
  // any changed.
  seatRulers(){
    let n = 0;
    for (const [id, fid] of Object.entries(this.rulers())){
      const s = this.db.hh[id];
      if (s && s.status !== 'free' && s.status !== 'ruler'){ if (!this._told && s.status === 'hired'){ const h = this.roster.get(Number(id)), hc = world.historicAt(fid); this.g.log?.info?.(`${h?.name} rules ${hc?.name} once freed: a lord holds him now, so the city's King or Queen leads it meanwhile`); } continue; }
      if (s?.status === 'ruler' && s.fieldId === fid) continue;
      if (s?.fieldId != null && this.byField.get(s.fieldId) === Number(id)) this.byField.delete(s.fieldId);
      this.db.hh[id] = { status: 'ruler', fieldId: fid };
      n++;
    }
    this._told = true;
    if (n){ this.g.store.touch?.(); this.g.log?.info?.(`${n} historic hero${n > 1 ? 'es' : ''} now rule${n > 1 ? '' : 's'} Historic Cities (rules.historic.rulers)`); }
    return n;
  }
  // The historic hero ruling the Historic City at fieldId while it's in NPC hands, or null.
  rulerAt(fieldId){
    const t = world.tileAt(this.g.store, fieldId);
    if (t.type !== world.T.NPC || !world.historicAt(fieldId) || t.ownerCastle) return null;
    for (const [id, fid] of Object.entries(this.rulers())) if (fid === fieldId && this.state(id)?.status === 'ruler') return this.roster.get(Number(id)) || null;
    return null;
  }
  // The city's ruler as its defence knows him: the city's own hero numbers (base, from npc.ruler) under the ruling
  // hero's name and portrait; base as it is if no hero rules there.
  asRuler(fieldId, base){
    const h = base && this.rulerAt(fieldId);
    // (at the level historic heroes defend NPC cities at, rules.historicHeroes.level: 150)
    return h ? { ...base, level: this.rules.level || base.level, name: h.name, face: h.portrait, historic: h.id } : base;
  }
  // A ruler's base stats: rules.historic.rulerStats, or his own line in rulerStatsByHero.
  rulerStats(h){ return { pol: 125, atk: 125, int: 125, ldr: 175, ...(this.g.rules.historic?.rulerStats || {}), ...(h && this.g.rules.historic?.rulerStatsByHero?.[h.name] || {}) }; }
  isRuler(id){ return this.rulers()[id] != null; }
  // A hero's base stats: a ruler's are rules.historic.rulerStats (Fox, Nov 25 2026: 125 each, leadership 175; Poseidon
  // 150 each, leadership 200), any other's his sheet's.
  baseOf(h){ const r = this.isRuler(h.id) ? this.rulerStats(h) : h; return { pol: r.pol, atk: r.atk, int: r.int, ldr: r.ldr }; }
  // The lord who holds the city gets its ruler, there (Fox, Nov 24 2026: "lock them to their city. They cannot be
  // reinforced to another city, and they cannot be captured. They can be marched. Whomever owns the city gets to
  // use them from the city"): a hero of c's, bound to it (hero.bound, its field), loyal (100), needing no Feasting
  // Hall seat. Taken from NPC hands he starts at rulerLevel (1, as any historic hero taken from an NPC city), with
  // his points to place; a lord who takes the city from another lord gets him as he is (armies.takeCity).
  joinRuler(c, h, nextId){
    const b = this.baseOf(h), L = this.rulerLevel();
    const hero = { name: h.name, level: L, exp: 0, base: { pol: b.pol, atk: b.atk, int: b.int },
      added: { pol: 0, atk: 0, int: 0 }, points: this.pointsAt(L), face: h.portrait, sex: h.female, historic: h.id, leadership: b.ldr, infro: h.bio };
    Object.assign(hero, { id: nextId(), status: 0, loyalty: 100, bound: c.fieldId });
    this.g.heroes.list(c).push(hero);
    this.db.hh[h.id] = { status: 'bound', castleId: c.id, heroId: hero.id };
    return hero;
  }
  // At startup: every ruler where he belongs. One whose city a lord holds serves that lord there (also one taken
  // prisoner under 0.1.44, who is let go for it); one whose city is an NPC's rules it. True if any changed.
  placeRulers(){
    let n = 0;
    for (const [id, fid] of Object.entries(this.rulers())){
      const h = this.roster.get(Number(id)), s = this.state(id), t = world.tileAt(this.g.store, fid);
      const city = t.type === world.T.CASTLE ? this.db.castles[t.castleId] : null;
      const held = s?.castleId != null ? this.db.castles[s.castleId] : null, obj = held && this.g.heroes.find(held, s.heroId);
      if (s?.status === 'bound' && held && held === city && obj?.bound === fid) continue;
      if (s?.status === 'hired' && obj && obj.bound == null) continue;   // (hired from a barbarian city before 0.1.44: stays his lord's)
      if (s?.status === 'ruler' && !city) continue;
      if (obj && (s.status === 'seized' || s.status === 'bound')){ held.heroes = this.g.heroes.list(held).filter(x => x !== obj); this.g.pushHero?.(held, obj, 1); }
      this.db.hh[id] = { status: 'ruler', fieldId: fid };
      if (city) this.joinRuler(city, h, () => this.g.store.id());
      n++;
    }
    if (n) this.g.store.touch?.();
    return n;
  }
  isNpcCity(fieldId){
    const t = world.tileAt(this.g.store, fieldId);
    return t.type === world.T.NPC && !t.historic && !t.ownerCastle && (this.rules.npcLevels || []).includes(t.level);
  }
  place(id){
    const old = this.db.hh[id];
    if (old?.fieldId != null && this.byField.get(old.fieldId) === id) this.byField.delete(old.fieldId);
    for (let i = 0; i < 100000; i++){
      const fid = Math.floor(Math.random() * world.SIZE * world.SIZE);
      if (this.byField.has(fid) || !this.isNpcCity(fid)) continue;
      this.db.hh[id] = { status: 'free', fieldId: fid, alloc: this.randomAlloc() };
      this.byField.set(fid, id);
      return fid;
    }
    this.db.hh[id] = { status: 'free', fieldId: null };
    return null;
  }
  // A wild hero is level 150 (Fox, Nov 25 2026: "Historic heroes defending NPC cities should be level 150"; was 30),
  // with 1 point for each level after the first spread at random (live). Holy Water resets them so the owner can
  // place them.
  // (Live, Fox, Nov 24 2026: Gao Guiying at level 150 in the live hero ranking has 815 attack, her sheet's 96 + her
  // level points + 569.7 from 15 pieces of level 10 gear at 15 stars, so 1 point a level, not 2 as 0.3.61 to 0.1.42
  // had it; and "at level 1, heroes shouldn't have a stat point to distribute": 149 at 150, as a Ring hero's 2 a
  // level start after the first.)
  ppl(){ return this.rules.pointsPerLevel ?? 1; }
  // The points a historic hero holds at a level: one a level after the first.
  pointsAt(level){ return Math.max(0, (level || 1) - 1) * this.ppl(); }
  randomAlloc(){
    const a = { pol: 0, atk: 0, int: 0 }, keys = Object.keys(a);
    // (a level 30 hero comes with 29)
    for (let i = 0; i < this.pointsAt(this.rules.level || 1); i++) a[keys[Math.floor(Math.random() * 3)]]++;
    return a;
  }
  alloc(id){ const s = this.state(id); if (s.alloc) this.topUp(s.alloc); return s.alloc || (s.alloc = this.randomAlloc()); }
  // A wild hero's points to what his level brings: the missing ones spread at random, extra ones (from 0.3.61 to
  // 0.1.42, 2 a level) taken off in proportion. True if changed.
  topUp(a){
    const keys = ['pol', 'atk', 'int'], want = this.pointsAt(this.rules.level || 1);
    let have = keys.reduce((s, k) => s + (a[k] || 0), 0);
    if (have > want){ shrink(a, have - want); return true; }
    if (have >= want) return false;
    for (; have < want; have++){ const k = keys[Math.floor(Math.random() * 3)]; a[k] = (a[k] || 0) + 1; }
    return true;
  }
  // The free hero in this NPC city, or null.
  at(fieldId, now = Date.now()){
    const id = this.byField.get(fieldId); if (id == null) return null;
    const h = this.roster.get(id), s = this.state(id);
    return h && s?.status === 'free' ? h : null;
  }

  // The hero as the NPC city's defending commander: level 150, with his base stats plus his randomly spread points.
  defender(fieldId, now){
    const h = this.at(fieldId, now); if (!h) return null;
    const a = this.alloc(h.id);
    // (leadership: rules.defenderLeadership, 9999, Fox, Nov 25 2026; npc.mods gives the garrison his bonus by it)
    return { name: h.name, level: this.rules.level, face: h.portrait, attack: h.atk + a.atk, intelligence: h.int + a.int, historic: h.id,
      leadership: this.rules.defenderLeadership ?? 9999 };
  }
  where(fieldId){
    const { x, y } = world.xy(fieldId), t = world.tileAt(this.g.store, fieldId);
    return { x, y, level: t.level, zone: this.g.rules.zones[world.zoneOf(fieldId)] };
  }
  titleCase(z){ return String(z || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()); }
  // ---------- the Inn's "Hearsay" ----------
  simpleBean(h, p){
    const s = this.state(h.id), known = p.hhKnown?.[h.id];
    let where;
    if (s.status !== 'free' || s.fieldId == null) where = `Nobody knows where ${h.name} is right now.`;
    else {
      const w = this.where(s.fieldId);
      where = known ? `According to the innkeeper, ${h.name} is staying in the level ${w.level} NPC city at (${w.x},${w.y}) in ${this.titleCase(w.zone)}.`
        : `Rumour has it ${h.name} was last seen somewhere in ${this.titleCase(w.zone)}.`;
    }
    return { npcid: h.id, name: h.name, logourl: h.portrait, introduce: h.bio, introduce2: where };
  }
  free(){ return [...this.roster.values()].filter(h => this.state(h.id)?.status === 'free' && this.state(h.id).fieldId != null); }
  hearsay(p, now, fresh = false){
    const r = this.rules, keep = (p.hearsay?.ids || []).filter(id => this.roster.has(id) && this.state(id)?.status === 'free');
    if (fresh || !p.hearsay || now >= p.hearsay.until || keep.length < Math.min(r.hearsayCount, this.free().length)){
      const pool = this.free(), ids = [];
      while (ids.length < Math.min(r.hearsayCount, pool.length)){ const h = pool[Math.floor(Math.random() * pool.length)]; if (!ids.includes(h.id)) ids.push(h.id); }
      p.hearsay = { ids, until: now + r.hearsayRefreshMinutes * 60000 / this.g.logic.speed };
    }
    return p.hearsay.ids.map(id => this.simpleBean(this.roster.get(id), p));
  }
  search(p, text){
    const f = fold(text);
    return [...this.roster.values()].filter(h => fold(h.name).includes(f) && this.state(h.id)?.status === 'free').slice(0, 30).map(h => this.simpleBean(h, p));
  }
  // "Enquire Details": the exact location, the hero's portrait and a report.
  details(p, id){
    const h = this.roster.get(id), s = h && this.state(id);
    if (!h) return [-1, 'Nobody has heard of that hero.'];
    if (s.status !== 'free' || s.fieldId == null) return [-1, `${h.name} can't be found right now.`];
    p.hhKnown = p.hhKnown || {}; p.hhKnown[id] = true;
    const item = this.item(id);
    p.items[item] = Math.max(1, p.items[item] || 0);
    return { bean: this.simpleBean(h, p), item };
  }
  // ---------- quests (Quests > Hero Quests) ----------
  quests(p){ return p.hhQuests || (p.hhQuests = {}); }
  accept(p, c, id){
    const h = this.roster.get(id), s = h && this.state(id), q = this.quests(p);
    if (!h) return [-1, 'Nobody has heard of that hero.'];
    if (q[id]) return [-1, `You are already looking for ${h.name}. See Quests, Hero Quests.`];
    if (s.status !== 'free') return [-1, `${h.name} isn't waiting in an NPC city right now.`];
    if (Object.keys(q).length >= this.rules.maxQuests) return [-1, `You can hunt at most ${this.rules.maxQuests} historic heroes at a time. Abandon one in Quests, Hero Quests first.`];
    q[id] = { at: Date.now(), castleId: c.id, done: false };
    return { msg: `You accepted the quest to recruit ${h.name}. It's under Quests, Hero Quests.` };
  }
  questBean(p, id, now){
    const h = this.roster.get(id), q = this.quests(p)[id], s = this.state(id);
    const portrait = (p.items[this.item(id)] || 0) > 0;
    // The city's loyalty: each attack won there lowers it, and at 0 the city (and the hero) is yours.
    const tile = s.status === 'free' && s.fieldId != null ? world.tileAt(this.g.store, s.fieldId, now) : null;
    const loyalty = tile ? Math.floor(this.g.npc.state(this.db, tile, now).loyalty ?? 0) : 0;
    const w = tile && p.hhKnown?.[id] ? this.where(s.fieldId) : null;
    const targets = [
      { name: `Get ${h.name}'s portrait (Inn, Hearsay, Enquire Details, 10 cents)`, finished: portrait },
      { name: w ? `Conquer the NPC city at (${w.x},${w.y}): win attacks until its loyalty falls to 0 (now ${loyalty})` : `Find ${h.name} and conquer the NPC city: win attacks until its loyalty falls to 0`, finished: q.done },
    ];
    // The live game's own wording: "Catch Hero quest  William Cecil quest", "Capture and persuade quest ...".
    return { questId: QUEST_BASE + id, name: h.name, description: `Catch Hero quest  ${h.name} quest`, manual: `Capture and persuade quest ${h.name} quest`,
      award: 'Aries Amulet 1, Beginner Guidelines 1, Population 30, Food 200, Lumber 1000, Stone 200, Iron 100.', isFinish: !!q.done, isCard: false, islast: false, recommend: false, version: 0, targets };
  }
  award(){ return this.awardDef || (this.awardDef = this.g.quests.parseReward(QUEST_AWARD)); }
  // Live, all of a lord's hero quests sit in one "Heros" group (Quests, Hero Quests).
  questTypes(p){
    const q = Object.values(this.quests(p));
    return q.length ? [{ typeId: QUEST_BASE, mainId: 4, name: 'Heros', description: 'Heros', isFinish: q.some(x => x.done), recommend: false, version: 0 }] : [];
  }
  questBeans(p, now){ return Object.keys(this.quests(p)).map(id => this.questBean(p, Number(id), now)); }
  questOf(p, questOrType){ const id = Number(questOrType) - QUEST_BASE; return this.quests(p)[id] ? id : null; }
  abandon(p, questId){
    const id = this.questOf(p, questId); if (id == null) return [-1, 'No such quest.'];
    delete this.quests(p)[id];
    return {};
  }
  // ---------- battles ----------
  // The NPC city this hero waits in was conquered by lord p (Fox, Oct 23 2026). With the hero's quest accepted
  // and the portrait in hand the hero is captured: seize(template) puts the hero in a Feasting Hall to be
  // persuaded, which takes the portrait. Otherwise (or with no empty seat) the hero moves to another NPC city.
  // rules.historicHeroes.questFree (Age of War): no quest; the portrait alone captures the hero and is used up
  // then, so persuading takes only gold.
  conquered(fieldId, p, seize){
    const id = this.byField.get(fieldId); if (id == null) return null;
    const s = this.state(id), h = this.roster.get(id);
    if (!s || s.status !== 'free') return null;
    const free = !!this.rules.questFree, q = this.quests(p)[id], item = this.item(id), portrait = (p.items[item] || 0) > 0;
    if ((q || free) && portrait){
      const held = seize({ ...this.captive(h), ...(free ? {} : { persuadeItem: item }) });
      if (held){
        this.byField.delete(fieldId);
        this.db.hh[id] = { status: 'seized', castleId: held.castle.id, heroId: held.hero.id };
        if (q) q.done = true;
        if (free && this.g.items.take(p, item)) this.g.pushItems?.(p, [item]);
        return { hero: h, captive: held.hero, castle: held.castle };
      }
      this.place(id);
      return { hero: h, full: true };
    }
    this.place(id);
    return { hero: h, moved: true, needQuest: !q && !free, needPortrait: !portrait };
  }
  // A historic hero taken from an NPC city starts at level 1, with his sheet's stats and no points
  // (Fox, Nov 24 2026: "when a historic hero is captured from an NPC city, it will always be level 1 and must be
  // leveled up"; rules.historicHeroes.capturedLevel). One taken from a lord keeps his level and stats (captives.js).
  captive(h){
    const L = this.rules.capturedLevel ?? 1;
    return { ...this.offer(h), level: L, added: { pol: 0, atk: 0, int: 0 }, points: this.pointsAt(L) };
  }
  // The hero as a lord gets him from a Historic Hero item: level rules.itemLevel (30), his waiting points cut to that
  // level's in proportion (a wild hero waits at level 150 with 149).
  offer(h, alloc = this.randomAlloc()){
    const level = this.rules.itemLevel ?? 30, added = { ...alloc }, keys = ['pol', 'atk', 'int'];
    const over = keys.reduce((s, k) => s + (added[k] || 0), 0) - this.pointsAt(level);
    if (over > 0) shrink(added, over);
    return { name: h.name, level, exp: 0, base: { pol: h.pol, atk: h.atk, int: h.int }, added, points: 0,
      loyalty: this.rules.hiredLoyalty, face: h.portrait, sex: h.female, historic: h.id, leadership: h.ldr, infro: h.bio };
  }
  // A hired (or waiting) historic hero's base stats follow the sheet, so a corrected sheet reaches heroes already
  // hired. His own spent points (added) are untouched. True if anything changed.
  sync(hero){
    const h = hero?.historic != null && this.roster.get(hero.historic); if (!h) return false;
    const b = this.baseOf(h), base = { pol: b.pol, atk: b.atk, int: b.int };
    if (hero.base?.pol === base.pol && hero.base?.atk === base.atk && hero.base?.int === base.int && hero.leadership === b.ldr) return false;
    hero.base = base; hero.leadership = b.ldr;
    return true;
  }
  // A historic hero has 1 point for every level after the first (149 at level 150). Short of that, the missing
  // points are his to spend; over it (from 0.3.61 to 0.1.42 he got 2 a level: Fox, Nov 24 2026, "some heroes are
  // getting 2 points when leveling up"; to 0.1.46 one more for his first), the extra come off his unspent points
  // first, then off his attributes in proportion to where they went. True if anything changed.
  owed(hero){
    if (hero?.historic == null || hero.ringHero) return false;
    const want = this.pointsAt(hero.level), a = hero.added || (hero.added = { pol: 0, atk: 0, int: 0 });
    const have = (a.pol || 0) + (a.atk || 0) + (a.int || 0) + (hero.points || 0);
    if (have === want) return false;
    if (have < want){ hero.points = (hero.points || 0) + want - have; return true; }
    let cut = have - want;
    const fromFree = Math.min(hero.points || 0, cut); hero.points = (hero.points || 0) - fromFree; cut -= fromFree;
    if (cut > 0) shrink(a, cut);
    return true;
  }
  // Hiring the hero settles that hero's quest (it was the reward).
  hired(id, c, heroId, p = null){ this.db.hh[id] = { status: 'hired', castleId: c.id, heroId }; if (p) delete this.quests(p)[id]; }
  // A historic hero who leaves a lord goes back to an NPC city somewhere else; a Historic City's ruler to rule his
  // city again, when the lord gives the city up (the next lord to take it gets him at level 1).
  release(id){
    const fid = this.rulers()[id];
    if (fid != null){ this.db.hh[id] = { status: 'ruler', fieldId: fid }; return; }
    this.place(id);
  }
}

module.exports = { heroItems, itemXml, HistoricHeroLogic, loadRoster, parseCsv, QUEST_BASE, QUEST_AWARD };
