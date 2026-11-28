'use strict';
const fs = require('fs');
const path = require('path');
const world = require('./world');
const { CastleLogic, STATUS, TROOP_MAX } = require('./castle');
const { TroopLogic } = require('./troops');
const { ResearchLogic } = require('./research');
const { Items } = require('./items');
const { Beans } = require('./beans');
const { HeroLogic, HERO_STATUS } = require('./heroes');
const { ArmyLogic, DIR } = require('./armies');
const { Combat } = require('./combat');
const { NpcLogic } = require('./npc');
const { FortLogic } = require('./forts');
const { Reports } = require('./reports');
const historic = require('./historic');
const { HistoricHeroLogic } = require('./historicHeroes');
const { EquipmentLogic } = require('./equipment');
const { ItemUse } = require('./itemUse');
const { QuestLogic } = require('./quests');
const { Mail } = require('./mail');
const { Market } = require('./market');
const { Policies } = require('./policies');
const { Colonies } = require('./colonies');
const { Commission } = require('./commission');
const { Friends } = require('./friends');
const { Packages } = require('./packages');
const { Charms } = require('./charms');
const { Gifts } = require('./gifts');
const { War } = require('./war');
const { Captives } = require('./captives');
const { Fame } = require('./fame');
const { Account, SECURITY } = require('./account');
const { BuildQueue } = require('./buildQueue');
const { Chat } = require('./chat');
const { Effort } = require('./effort');
const { Stratagems } = require('./stratagems');
const { Alliances } = require('./alliances');
const { Security, probeIn } = require('./security');
const { AdminPage } = require('./admin');
const { CLASS } = require('./combat');

const CLIENT_VERSION = '091103_11';
const OK = 1;
const STARTER_PACKS = ['player.box.present.2', 'player.box.present.4'];   // Newbies Package, Package for Lords
const LOGIN = { BAD_USER: -2, FULL: -3, NEED_PLAYER: -4 };
// Reads that are safe to answer with an empty result until they are implemented.
// (an "is" check must be isSomething: issueCommissionQuest is an action)
const READ_VERB = /^(get|receive|read|query|list|search|check|view|load|has|map|zone|all|my|show|find)/i, IS_VERB = /^[iI]s[A-Z]/;
// Writes that only record a preference or tutorial step; acknowledging them is harmless.
// (Every command this client sends now has a handler; these stay for safety.)
const HARMLESS = new Set(['common.step', 'common.setEventDone', 'common.addToFavorites', 'common.setReturnReport', 'common.setAutoHeal']);
// The front door (security review, Nov 28 2026, after a scanner's visit):
//  - JavaScript's own names (__proto__, constructor, toString...) as a key or a value anywhere in a message: the
//    commands look ids up in plain tables (data.items[itemId], c.buildings[positionId]...), where such a name finds
//    something built in instead of nothing. None of them did harm, but only by luck; no client sends these, so such a
//    message (or one absurdly deep or large) is refused before any command sees it.
//  - Speed: each connection may send RATE_BURST commands at once and RATE_PER_SEC a second after that (a busy
//    client sends a few); beyond it a command is refused, and a connection that keeps it up is closed.
const BUILT_IN = new Set(Object.getOwnPropertyNames(Object.prototype));
function poisoned(v, depth = 0, seen = { n: 0 }){
  if (++seen.n > 20000 || depth > 16) return true;
  if (typeof v === 'string') return BUILT_IN.has(v);
  if (!v || typeof v !== 'object') return false;
  for (const k of Object.keys(v)) if (BUILT_IN.has(k) || poisoned(v[k], depth + 1, seen)) return true;
  return false;
}
const RATE_BURST = 200, RATE_PER_SEC = 50, RATE_CLOSE = 2000;
// Commands no window sends get one line in unhandled.log each (UNHANDLED_MAX at most a run, their data cut short),
// and only from a signed-in lord: before, anyone could fill the disk with made-up command names.
const UNHANDLED_MAX = 300, UNHANDLED_DATA = 1000, CMD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,40}(\.[A-Za-z][A-Za-z0-9_]{0,60})?$/;
const HANDLER_FILES = ['account', 'castle', 'map', 'troops', 'shop', 'research', 'info', 'heroes', 'army', 'reports', 'field', 'forts', 'interior', 'npchero', 'city', 'equipment', 'quests', 'mail', 'market', 'capital', 'colony', 'war', 'fame', 'profile', 'signs', 'chat', 'effort', 'stratagem', 'alliance', 'commission', 'friends', 'common',
  // the web client's own commands (after the rest: they replace any of the same name)
  'auth', 'webmap', 'webstate', 'webshop', 'webreports', 'webauto', 'webmarket', 'webcalc', 'webmisc', 'webspeed'];

class Game {
  constructor({ store, data, rules, speed, protocol, log, logDir, faces, art, perf, site = '', version = '', welcome = {} }){
    this.version = version;
    this.welcome = { text: String(welcome.text ?? ''), link: String(welcome.link ?? '') };   // config.json's banner, until the admin page sets one
    this.site = String(site || '').replace(/\/$/, '');
    this.adminToken = require('crypto').randomBytes(12).toString('hex');   // the admin pages' links carry it (t=)
    this.perf = perf || null; this.store = store; this.data = data; this.rules = rules; this.protocol = protocol; this.log = log; this.clientVersion = CLIENT_VERSION;
    this.logic = new CastleLogic(data, rules, speed);
    this.troops = new TroopLogic(data, rules, this.logic);
    this.research = new ResearchLogic(data, rules, this.logic);
    this.items = new Items(data, rules);
    this.beans = new Beans(data, this.logic, this.items);
    this.heroes = new HeroLogic(data, rules, this.logic);
    this.armies = new ArmyLogic(this);
    this.combat = new Combat(data, rules);
    this.npc = new NpcLogic(rules, this.logic.speed);
    this.npc.portraits = data.portraits;   // (the generic hero portraits, for NPC heroes)
    this.forts = new FortLogic(data, rules, this.logic);
    this.reports = new Reports(this);
    this.faces = faces || null;       // which hero portraits exist on the art server (see http.js)
    this.art = art || null;           // other art the client couldn't get (see http.js)
    this.beans.game = this;
    this.equipment = new EquipmentLogic(this);
    this.logic.hooks = {
      mayor: (c, kind) => this.heroes.mayorBonus(c, kind),
      valleys: c => this.armies.valleyBonuses(c),
      salary: c => this.heroes.salary(c),
      upkeepRate: (p, now) => this.items.upkeepRate(p, now),
      trainBonus: (p, now) => this.items.trainBonus(p, now),
      themeBonus: (p, now) => this.items.castleThemeActive(p, now) ? 10 : 0,
      buildSlots: p => this.items.buildSlots(p),
      items: p => p?.items || {},
      tribute: (c, r, now) => this.colonies.tribute(c, r, now),
      guestUpkeep: c => this.armies.guestUpkeep(c), guestTroops: c => this.armies.guestTroops(c),
      plagued: (c, now) => this.charms?.plagued(c, now),
      // Achievements (effort.js): their bonuses, and what is produced.
      effort: (p, k) => this.effort?.bonus(p, k) || 0,
      produced: (p, k, n) => this.effort?.note(p, `produce:${k}`, n),
    };
    // Hero gear belongs to the lord's Workshop research; find the lord from the hero's city.
    this.heroes.ownerOf = h => { for (const c of Object.values(this.db.castles)) if (c.heroes?.includes(h)) return this.db.players[c.playerId]; return null; };
    this.heroes.gearOf = h => this.equipment.bonus(this.heroes.ownerOf(h), h);
    this.heroes.gearBeans = h => this.equipment.beans(this.heroes.ownerOf(h), h);
    // A hero leading an army shows as out (3), coming back (5) or stationed in a city being colonized (2, "Guard").
    this.heroes.statusOf = h => { if (h.status !== 3) return h.status; const a = Object.values(this.db.armies || {}).find(x => x.heroId === h.id); return !a ? 3 : a.direction === DIR.BACK ? 5 : a.direction === DIR.STAY ? 2 : 3; };
    this.combat.heroAttr = (h, k) => this.heroes.effective(h, k);
    this.combat.heroLeadership = h => this.heroes.leadership(h);
    this.combat.playerBuff = p => ({ ...this.items.battleBuff(p), life: this.charms.lifeBonus(p) });
    this.heroes.charmFactor = (h, now) => this.charms.heroFactor(h, now);
    this.heroes.charmBuffs = (h, now) => this.charms.heroBuffs(h, now);
    this.research.mayorBonus = c => this.heroes.mayorBonus(c, 'points:int');
    const hist = historic.build(data.historicNames || [], rules);
    for (const h of hist.values()) h.intro = data.historicIntros?.[h.name.trim()] || '';   // (the field window's description)
    world.setHistoric(hist, { flatRing: rules.historic?.flatRing ?? 1 });
    world.setValleyCycle({ enabled: rules.valleyCycle !== false, resetHourUTC: rules.dailyResetHourUTC || 0 });
    this.historicCount = hist.size;
    this.online = new Map();          // playerId -> Connection
    this.unhandledFile = path.join(logDir, 'unhandled.log');
    this.dataDir = logDir;
    this.mail = new Mail(this);
    this.market = new Market(this);
    this.policies = new Policies(this);
    this.colonies = new Colonies(this);
    this.commission = new Commission(this);
    this.friends = new Friends(this);
    this.packages = new Packages(this);
    this.charms = new Charms(this);
    this.gifts = new Gifts(this);
    this.war = new War(this);
    this.captives = new Captives(this);
    this.fame = new Fame(this);
    this.account = new Account(this);
    this.buildQueue = new BuildQueue(this);
    // HungerBuff: the client's "hungry" icon while one of the lord's cities is out of food and eating more than it
    // grows (on Age II nothing deserts, Fox; armies just can't march without food for the road).
    this.items.extraBuffs = (p, now) => { const c = this.hungryCity(p, now); return [...this.effort.buffs(p, now), ...this.charms.lordBuffs(p, now), ...(c ? [{ typeId: 'HungerBuff', endTime: now + 86400000, descName: `Hunger: ${c.name} has run out of food. Its troops can't march without food for the road.` }] : [])]; };
    this.hungerShown = new Map();
    this.chat = new Chat(this);
    this.security = new Security(this);   // accounts, bans, mutes, freezes, the activity and audit logs (0.1.69)
    this.admin = new AdminPage(this);         // the admin page (/admin)
    this.effort = new Effort(this);
    this.stratagems = new Stratagems(this);
    this.alliances = new Alliances(this);
    this.seenUnhandled = new Set();
    this.handlers = {};
    this.hh = new HistoricHeroLogic(this, logDir);
    this.itemUse = new ItemUse(this);
    this.quests = new QuestLogic(this);
    // Prestige for what is built, researched and trained (quests.prestigeFor).
    const gain = (c, cost, n = 1) => { const p = this.playerOf(c); if (p) p.prestige = (p.prestige || 0) + this.quests.prestigeFor(cost, n, p); };
    // Mayor XP (rules.mayorExp, DoA's Hero Experience page): the city's mayor gains mayorExp x (food + wood + stone +
    // iron + build seconds) for every building level, troop and wall defence the city finishes (the fractions kept).
    const mayor = (c, cost, n = 1) => {
      const rate = Number(this.rules.mayorExp) || 0, h = rate > 0 && cost && this.heroes.chief(c);
      if (!h) return;
      const total = (h.mayorFrac || 0) + rate * n * ['food', 'wood', 'stone', 'iron', 'time'].reduce((a, k) => a + (Number(cost[k]) || 0), 0), whole = Math.floor(total);
      h.mayorFrac = total - whole;
      if (whole > 0) this.heroes.gainExp(h, whole);
    };
    this.logic.hooks.built = (c, p, typeId, level) => { const L = this.data.buildings[typeId]?.levels[level - 1]; gain(c, L); mayor(c, L); };
    // Troops arrive a few at a time (troops.js), so the prestige for training keeps its fractions until they add up.
    this.troops.onDone = (c, type, num) => {
      const p = this.playerOf(c), t = this.data.troops[type];
      if (p){
        const raw = this.quests.prestigeFor(t, num), share = this.rules.prestige?.byTownHalls !== false ? raw / this.quests.townHalls(p) : raw;
        p.trainPrestige = (p.trainPrestige || 0) + share;
        const whole = Math.floor(p.trainPrestige + 1e-9);
        if (whole > 0){ p.prestige = (p.prestige || 0) + whole; p.trainPrestige -= whole; }
      }
      this.effort.note(p, `train:${t?.field}`, num);
      mayor(c, t, num);
    };
    this.troops.costCut = (p, typeId) => this.effort.bonus(p, { foot: 'infantry', mounted: 'cavalry', siege: 'machine' }[CLASS[typeId]] || 'none');
    this.items.onAdd = (p, id, n) => { if (/^hero\.loyalty\.\d$/.test(id)) this.effort.note(p, `medal:${id}`, n); };
    // an item bought at the moment it's used: the coins change (after the command's own reply)
    this.items.onBuy = p => setImmediate(() => this.pushPlayerInfo(p));
    // Defences are finished a few at a time too (forts.js): their prestige keeps its fractions with the troops'.
    this.forts.onDone = (c, type, num) => {
      const p = this.playerOf(c), f = this.data.forts[type];
      if (p){
        const raw = this.quests.prestigeFor(f, num), share = this.rules.prestige?.byTownHalls !== false ? raw / this.quests.townHalls(p) : raw;
        p.trainPrestige = (p.trainPrestige || 0) + share;
        const whole = Math.floor(p.trainPrestige + 1e-9);
        if (whole > 0){ p.prestige = (p.prestige || 0) + whole; p.trainPrestige -= whole; }
      }
      mayor(c, f, num);
    };
    for (const f of HANDLER_FILES) require('./handlers/' + f)(this, this.handlers);
    this.migrate();
    { const n = this.security.scrubProbes(); if (n) log.warn(`Removed ${n} kept line${n === 1 ? '' : 's'} with a security scanner's address (chat history, mail, alliance texts)`); }
    const placed = this.hh.seed();
    if (placed) log.info(`Placed ${placed} historic heroes in NPC cities`);
  }

  // Bring saves from older versions up to date.
  // 0.1.41: honor and prestige never go below 0 (Fox, Nov 24 2026); a lord saved below it is put at 0.
  floorStanding(p){
    let changed = false;
    for (const k of ['honor', 'prestige']) if (p[k] != null && !(p[k] >= 0)){ this.log.info(`${p.name}'s ${k} was ${p[k]}, now 0`); p[k] = 0; changed = true; }
    return changed;
  }
  migrate(){
    for (const p of Object.values(this.db.players)){
      if (p.coins == null) p.coins = this.rules.startCoins;
      if (this.floorStanding(p)) this.store.touch?.();
      if (this.equipment?.dropMountStars(p)){ this.log.info(`${p.name}'s mount had stars: removed (the mount holds none)`); this.store.touch?.(); }
      // (gear research is instant: one started under timed research finishes on the first tick)
      if (p.gearResearch && this.equipment?.instant() && p.gearResearch.endTime > this.now()){ p.gearResearch.endTime = this.now(); this.store.touch?.(); }
      p.items = p.items || {}; p.buffs = p.buffs || {}; p.techs = p.techs || {};
      if (p.research === undefined) p.research = null;
    }
    // 0.3.13: prestige for what older saves already built, and the starter packages (quests ask you to open them).
    for (const p of Object.values(this.db.players)){
      if (this.quests.upgrade(p)) this.log.info(`${p.name}'s quests were moved to the 0.3.15 quest list`);
      const got = this.quests.backfill(p);
      if (got) this.log.info(`${p.name} was credited ${got.toLocaleString('en-US')} prestige for what was already built, researched and trained`);
      if (!p.starterPacks){ p.starterPacks = 1; for (const id of STARTER_PACKS) this.items.add(p, id, 1); }
      // Before 0.3.13 hiring a historic hero left the finished quest behind, keeping the Quests button lit.
      for (const id of Object.keys(p.hhQuests || {})) if (this.db.hh?.[id]?.status === 'hired') delete p.hhQuests[id];
    }
    // 0.1.33: the Acquire Historic City quests count the Historic Cities a lord already holds.
    for (const c of Object.values(this.db.castles)){
      const h = world.historicAt(c.fieldId), p = this.db.players[c.playerId];
      if (h && p && (c.powerLevel ?? 4) < 4 && this.quests.flag(p, `captureHC${h.level}`)) this.store.touch?.();
    }
    // 0.1.28: the whole level 12 grid (Olathe at 99,99 ...) and the last two level 14s are on the map now. A lord's
    // city already on one of those spots stays; the Historic City shows there once that city moves away.
    for (const c of Object.values(this.db.castles)){
      const h = world.historicAt(c.fieldId);
      if (h && (c.powerLevel ?? 4) >= 4) this.log.info(`${c.name} stands where the Historic City ${h.name.trim()} (${h.x},${h.y}) would be; it shows there once the city moves`);
    }
    for (const c of Object.values(this.db.castles)){
      c.troops = c.troops || {}; c.forts = c.forts || {}; c.trainQ = c.trainQ || {}; c.heroes = c.heroes || []; c.valleys = c.valleys || []; c.fortQ = c.fortQ || [];
      // 0.1.38: troop counts never go below zero now (before, one wrapped to -2,147,483,648 past 2,147,483,647, as on
      // live, and bricked the city). A wrapped count gets back what it had (+2^32); any other below zero is 0.
      for (const [k, v] of Object.entries(c.troops)) if (v < 0){
        const now = v < -(2 ** 30) ? Math.min(TROOP_MAX, v + 2 ** 32) : 0;
        c.troops[k] = now; this.store.touch?.(); this.log.info(`${c.name}: ${k} was ${v.toLocaleString('en-US')} (wrapped past 2,147,483,647), now ${now.toLocaleString('en-US')}`);
      }
      if (this.heroes.migrate(c, this.db.players[c.playerId])) this.store.touch?.();
      // Heroes holding the experience for more levels (before rules.heroAutoLevel) go up now.
      for (const h of c.heroes){ const n = this.heroes.autoLevel(h); if (n){ this.store.touch?.(); this.log.info(`${c.name}: ${h.name} went up ${n} level${n > 1 ? 's' : ''} to ${h.level}`); } }
      if (this.ensureWalls(c)){ this.store.touch?.(); this.log.info(`${c.name} was given level ${this.rules.startWalls} Walls (every city has them now)`); }
      // 0.1.25: an amulet city (an ordinary city with a Rally Spot above 10) lets its fields go up to that level too.
      const rally = Object.values(c.buildings || {}).find(b => b.typeId === 29)?.level || 0;
      if (!c.fieldMax && (c.powerLevel ?? 4) >= 4 && rally > 10 && rally <= 14){ c.fieldMax = rally; this.store.touch?.(); this.log.info(`${c.name}: its fields can go up to level ${rally}, as its amulet's`); }
      // 0.1.31: an ordinary hero's base is his level-1 stats; the points his level brought move to added (his
      // totals stay). The level he was rolled for is worked out from his base (heroes.rolledLevel).
      let split = 0;
      for (const h of [...c.heroes, ...(c.inn?.offers || [])]) if (!h.historic && !h.ringHero && !h.lv1){ this.heroes.splitLevelPoints(h, this.heroes.rolledLevel(h)); split++; }
      if (split){ this.store.touch?.(); this.log.info(`${c.name}: ${split} hero${split > 1 ? 'es' : ''} given level-1 stats`); }
      // 0.3.28: the historic hero sheet had attack and intelligence swapped; hired heroes take the corrected stats.
      let fixed = 0;
      for (const h of [...c.heroes, ...(c.innHistoric || [])]) if (this.hh.sync(h)) fixed++;
      if (fixed){ this.store.touch?.(); this.log.info(`${c.name}: ${fixed} historic hero${fixed > 1 ? 'es' : ''} updated to the corrected stats`); }
      // Historic heroes hold 1 point a level, counting the first (0.1.43; from 0.3.61 they got 2 a level): the extra
      // come off (unspent first), and any short get theirs.
      let owed = 0;
      for (const h of [...c.heroes, ...(c.innHistoric || [])]) if (this.hh.owed(h)) owed++;
      if (owed){ this.store.touch?.(); this.log.info(`${c.name}: ${owed} historic hero${owed > 1 ? 'es' : ''} set to 1 point a level`); }
    }
    // ... and wild ones still waiting in NPC cities.
    for (const st of Object.values(this.db.hh || {})) if (st?.alloc && this.hh.topUp(st.alloc)) this.store.touch?.();
    this.db.armies = this.db.armies || {}; this.db.npc = this.db.npc || {};
    // 0.1.68: a Historic City a teleporter had moved goes back to its spot.
    this.returnMovedHistoric();
    // A city that a Historic City now occupies would hide it; move nothing, just warn.
    for (const c of Object.values(this.db.castles)) if (world.historicAt(c.fieldId)) this.log.warn(`${c.name} sits on a Historic City tile (${world.xy(c.fieldId).x},${world.xy(c.fieldId).y}).`);
  }

  // ---------- helpers ----------
  get db(){ return this.store.db; }
  now(){ return Date.now(); }
  castlesOf(p){ return p.castles.map(id => this.db.castles[id]).filter(Boolean); }
  playerOf(c){ return this.db.players[c.playerId]; }
  castleFor(conn, id){
    const p = conn.player; if (!p) return null;
    const c = this.db.castles[id];
    return c && c.playerId === p.id ? c : null;
  }
  // Look up the caller's city, bring it up to date, or answer with an error.
  castleOr(conn, cmd, id){
    const c = this.castleFor(conn, id);
    if (!c){ this.fail(conn, cmd, -30, 'That city is not yours.'); return null; }
    this.catchUp(c);
    return c;
  }
  catchUp(c){ this.completeDue(c, true); this.logic.settle(c, this.playerOf(c), this.now()); }
  reply(conn, cmd, data){ this.flushChanges(conn, cmd); this.observe(conn, cmd); conn.send(cmd, { ok: OK, ...data, packageId: this.packageFor(conn, cmd) }); }
  // The client numbers each request (data.packageId) and matches the reply by that number. Replies to one command
  // come back in order; a reply under another name (login's server.LoginResponse) answers the request being handled.
  notePackage(conn, cmd, data){
    const id = data && typeof data === 'object' ? data.packageId : undefined;
    conn.current = id == null ? null : { cmd, id, answered: false };
    if (id == null) return;
    (conn.packages ??= new Map());
    if (!conn.packages.has(cmd)) conn.packages.set(cmd, []);
    conn.packages.get(cmd).push(id);
  }
  packageFor(conn, cmd){
    const q = conn.packages?.get(cmd);
    if (q?.length){ const id = q.shift(); if (conn.current && conn.current.id === id) conn.current.answered = true; return id; }
    const cur = conn.current;
    if (cur && !cur.answered){ cur.answered = true; const q2 = conn.packages?.get(cur.cmd); if (q2){ const i = q2.indexOf(cur.id); if (i >= 0) q2.splice(i, 1); } return cur.id; }
    return 0;
  }
  // Quest targets that are actions rather than state ("levy gold", "rename a city"): noted when the command succeeds.
  observe(conn, cmd){
    const t = conn.tracking, p = conn.player;
    if (!t || t.cmd !== cmd || t.observed || !p) return;
    t.observed = true;
    const d = t.data || {}, flag = k => this.quests.flag(p, k), item = String(d.itemId || '');
    switch (cmd){
      case 'interior.pacifyPeople': flag(`pacify${Number(d.typeId)}`); break;
      case 'interior.taxation': flag(`levy${Number(d.typeId)}`); break;
      case 'city.modifyCastleName': flag('rename'); break;
      case 'city.modifyFlag': flag('flag'); break;
      case 'common.worldChat': flag('worldChat'); break;
      case 'hero.hireHero': flag('hire'); break;
      case 'hero.addPoint': case 'hero.addPoint2': flag('heroPoints'); break;
      case 'hero.refreshHerosListFromTavern': flag('refreshInn'); break;
      case 'castle.speedUpBuildCommand': if (item === 'consume.2.a') flag('guideBuild'); break;
      case 'tech.speedUpResearch': if (item === 'consume.2.b') flag('guideResearch'); break;
      // (the web client's shop buys with shop.buyPooled, and Halloween goods with shop.buyHalloween; Fox, Nov 28 2026)
      case 'shop.buy': case 'shop.buyPooled': case 'shop.buyHalloween': flag('buy'); break;
      // (the web client's Folk Hearsay lists the rumours and has no task to accept: opening it counts)
      case 'quest.accept': case 'npchero.getNpcHerosList': flag('hearsay'); break;
      case 'npchero.getNpcHeroInfroByID': flag('enquire'); break;
      case 'npchero.getNpcHerosListByMoney': flag('moreHearsay'); break;
      case 'npchero.getNpcHerosListByFilter': flag('heroSearch'); break;
      // (One Click Change: equipment.WearAllEquipmenttech; it listened for a command no client sends: Fox, Nov 28 2026)
      case 'equipment.WearAllEquipmenttech': case 'equipment.WearAll': flag('wearAll'); break;
      case 'shop.useGoods':
        if (/^player\.box\.gambling\.\d+$/.test(item)) flag('amulet');
        if (item === 'player.box.present.2') flag('newbiePack');
        if (item === 'player.box.present.4') flag('lordsPack');
        break;
    }
  }
  // Tell the client when a quest becomes ready to claim, so the Quests button lights up straight away.
  questNotice(p, c = null){
    if (!this.online.has(p.id)) return;
    c = c || this.castlesOf(p)[0]; if (!c) return;
    const s = this.quests.state(p), now = this.now();
    const ready = [...this.quests.finishedIds(p, c, now), ...Object.entries(this.hh.quests(p)).filter(([, q]) => q.done).map(([id]) => 'h' + id)];
    const fresh = ready.filter(id => !s.notified[id]);
    for (const id of Object.keys(s.notified)) if (!ready.includes(isNaN(id) ? id : Number(id))) delete s.notified[id];
    if (!fresh.length) return;
    for (const id of fresh) s.notified[id] = now;
    this.push(p.id, 'server.NewFinishedQuest', {});
  }
  fail(conn, cmd, code, msg){ this.flushChanges(conn, cmd); conn.send(cmd, { ok: code, packageId: this.packageFor(conn, cmd), errorMsg: msg, msg }); }
  // The client stores item counts and coins from server.ItemUpdate / PlayerInfoUpdate without redrawing, and
  // redraws the item list when a command's reply arrives. So whatever a command changed is sent before its
  // reply; pushes made after the reply then skip what was already sent.
  flushChanges(conn, cmd){
    const t = conn.tracking; if (!t || t.cmd !== cmd || t.flushed) return;
    t.flushed = true;
    const p = conn.player; if (!p) return;
    const ids = [...new Set([...Object.keys(t.items), ...Object.keys(p.items || {})])].filter(id => (t.items[id] || 0) !== (p.items?.[id] || 0));
    if (ids.length){ conn.send('server.ItemUpdate', { ok: OK, packageId: 0, items: ids.map(id => this.items.itemBean(p, id)) }); for (const id of ids) t.sent[id] = p.items?.[id] || 0; }
    if ((t.coins || 0) !== (p.coins || 0)){ this.pushPlayerInfo(p); t.sentCoins = p.coins || 0; }
  }
  push(playerId, cmd, data){ const conn = this.online.get(playerId); if (conn) conn.send(cmd, { ok: OK, packageId: 0, ...data }); }
  pushBuilding(c, pos){
    const b = c.buildings[pos]; if (!b) return;
    this.push(c.playerId, 'server.BuildComplate', { castleId: c.id, buildingBean: this.beans.building(pos, b) });
  }
  // Give up a city (handlers/city.js checks first): its heroes, troops, buildings and resources go; prisoners held
  // there go home, historic heroes back to the world; its valleys, colonies and trades end; the spot becomes a
  // barbarian city at the level the flat had when the city was founded (Fox: "Building a city on a flat, then
  // abandoning that city will produce a barbarian city that is the same level the flat was"; it stays until it is
  // taken or a War Teleporter lands on it). A Historic City's spot is the Historic City again.
  abandonCastle(p, c, now = this.now()){
    for (const r of [this.colonies.ofColony(c), ...this.colonies.ofSuzerain(c)].filter(Boolean)) this.colonies.drop(r);
    for (const v of [...(c.valleys || [])]) this.armies.giveUp(c, v);
    for (const h of [...this.heroes.list(c)]){
      if (h.capturedFrom && this.captives.releaseHome(h)) continue;
      if (h.historic) this.hh.release(h.historic);   // (a Historic City's ruler rules it again)
    }
    const m = this.market.db();
    for (const [id, o] of Object.entries(m.orders)) if (o.castleId === c.id) delete m.orders[id];
    for (const [id, s] of Object.entries(m.ships)) if (s.castleId === c.id) delete m.ships[id];
    p.castles = p.castles.filter(id => id !== c.id);
    delete this.db.castles[c.id];
    const id = c.fieldId, was = world.terrain(this.db.seed, id);
    delete this.db.npc?.[id];
    let level;
    if (world.historicAt(id) || was.type === world.T.NPC){ delete this.db.tiles[id]; level = world.tileAt(this.store, id).level; }
    else { level = Math.max(1, Math.min(10, c.flatLevel || world.naturalTile(this.db.seed, id, c.createdAt || now).level || 1)); this.db.tiles[id] = { type: world.T.NPC, level }; }
    this.store.touch();
    return { level };
  }
  // A Historic City never moves (handlers/city.js, 0.1.68), but before that a teleporter could move a lord's: each one
  // away from a Historic City's spot goes back to one, the Historic City of its name or else the nearest of its size
  // that no lord holds (the NPCs that took the spot again are gone), and the spot it leaves is as the map has it.
  // Returns the cities put back.
  returnMovedHistoric(){
    const back = [], fold = s => String(s || '').replace(/^﻿/, '').trim().toLowerCase();
    for (const c of Object.values(this.db.castles)){
      if ((c.powerLevel ?? 4) >= 4 || world.historicAt(c.fieldId)) continue;
      const held = new Set(Object.values(this.db.castles).map(o => o.fieldId)), at = world.xy(c.fieldId);
      const dist = id => { const b = world.xy(id); return Math.hypot(b.x - at.x, b.y - at.y); };
      const free = [...world.historicEntries()].filter(([id, h]) => h.powerLevel === c.powerLevel && !held.has(id)).sort((a, b) => dist(a[0]) - dist(b[0]));
      const home = free.find(([, h]) => fold(h.name) === fold(c.name)) || free[0];
      if (!home){ this.log.warn(`${c.name} (${at.x},${at.y}) is a Historic City away from its spot, and no free spot of its size is left to put it back on`); continue; }
      const [to, h] = home, from = c.fieldId;
      if (world.naturalTile(this.db.seed, from).type === world.T.FLAT) delete this.db.tiles[from];
      else this.db.tiles[from] = { type: world.T.FLAT, level: c.flatLevel || 1 };
      delete this.db.npc?.[to];
      this.db.tiles[to] = { type: world.T.CASTLE, level: 1, castleId: c.id, playerId: c.playerId };
      c.fieldId = to;
      this.store.touch?.();
      back.push(c);
      this.log.info(`${c.name}, a Historic City a teleporter had moved to (${at.x},${at.y}), is back on ${String(h.name).trim()}'s spot (${h.x},${h.y})`);
    }
    return back;
  }
  // A city of p's that is out of food and eating more than it grows, or null.
  hungryCity(p, now = this.now()){
    for (const c of this.castlesOf(p)){
      if ((c.res?.food || 0) >= 1) continue;
      const r = this.logic.rates(c, p, now);
      if (r.food - r.foodUpkeep < 0) return c;
    }
    return null;
  }
  // Show or clear the hungry icon when that changes.
  pushHunger(p, now = this.now()){
    const hungry = !!this.hungryCity(p, now);
    if (hungry === !!this.hungerShown.get(p.id)) return;
    this.hungerShown.set(p.id, hungry);
    const b = this.items.extraBuffs(p, now).find(x => x.typeId === 'HungerBuff');
    this.push(p.id, 'server.PlayerBuffUpdate', b ? { buffBean: b, updateType: 0 } : { buffBean: { typeId: 'HungerBuff', endTime: 0, descName: '' }, updateType: 1 });
  }
  // The Coordinates List (handlers/signs.js), with the cities' names as they are now.
  signs(p){ return (p.signs || []).map(s => ({ id: s.id, name: this.db.castles[s.castleId]?.name || s.name, x: s.x, y: s.y })); }
  pushResources(c){ this.logic.capRes(c); this.push(c.playerId, 'server.ResourceUpdate', { castleId: c.id, resource: this.beans.resource(c, this.playerOf(c)) }); }
  pushTroops(c){ this.push(c.playerId, 'server.TroopUpdate', { caslteId: c.id, troop: this.beans.troop(c) }); }
  // The Hospital window (Rally Spot): the wounded resting in a city and what curing them costs.
  pushInjured(c){ const w = this.armies.woundedWhole(c, this.now()); this.push(c.playerId, 'server.InjuredTroopUpdate', { castleId: c.id, goldNeed: this.armies.cureCost(w), troop: this.beans.troop({ troops: w }) }); }
  pushPlayerInfo(p){
    const t = this.online.get(p.id)?.tracking;
    if (t?.flushed && t.sentCoins === (p.coins || 0)) return;
    this.push(p.id, 'server.PlayerInfoUpdate', { playerInfo: this.beans.playerInfo(p, this.castlesOf(p)) });
  }
  pushItems(p, ids){
    const t = this.online.get(p.id)?.tracking;
    const send = t?.flushed ? ids.filter(id => t.sent[id] !== (p.items?.[id] || 0)) : ids;
    if (send.length) this.push(p.id, 'server.ItemUpdate', { items: send.map(id => this.items.itemBean(p, id)) });
  }
  // updateType: 0 add, 1 delete, 2 update. Only ever update or delete a hero the client already has.
  pushHero(c, h, updateType){ this.push(c.playerId, 'server.HeroUpdate', { castleId: c.id, updateType, hero: this.heroes.bean(h) }); }
  pushArmies(p){ this.push(p.id, 'server.SelfArmysUpdate', { armys: this.armies.beans(p) }); }
  // Other lords' armies on their way to p's cities (the Beacon Tower's warning; the Report window's Enemy tab).
  pushFriends(p){ if (p) this.push(p.id, 'server.FriendArmysUpdate', { armys: this.armies.friends(p) }); }
  pushEnemies(p){ if (p) this.push(p.id, 'server.EnemyArmysUpdate', { armys: this.armies.enemies(p) }); }
  // The lord whose city or valley an army is heading for, if it's someone else's.
  targetLord(a){ const c = this.armies.targetCity(a), q = c && this.db.players[c.playerId]; return q && q.id !== a.playerId ? q : null; }
  // Buffs that changed: added if the client didn't have them yet (`had`: ids active before), else updated.
  pushBuffs(p, had = new Set(), now = this.now()){
    for (const b of this.items.buffBeans(p, now)) this.push(p.id, 'server.PlayerBuffUpdate', { buffBean: b, updateType: had.has(b.typeId) ? 2 : 0 });
  }
  activeBuffs(p, now = this.now()){ return new Set(this.items.buffBeans(p, now).map(b => b.typeId)); }
  pushCastle(c, updateType = 2){ this.push(c.playerId, 'server.CastleUpdate', { updateType, castleBean: this.beans.castle(c, this.playerOf(c)) }); }

  // ---------- accounts ----------
  createPlayer(account, opts = {}){
    const now = this.now(), p = {
      id: this.store.id(), account: account.name, name: opts.userName || account.name, sex: opts.sex || 0,
      faceUrl: opts.faceUrl || (opts.sex ? 'images/icon/player/faceB1.jpg' : 'images/icon/player/faceA8.jpg'), flag: (opts.flag || account.name.slice(0, 1)).slice(0, 3),
      createdAt: now, lastLoginAt: now, prestige: 0, coins: this.rules.startCoins, techs: {}, items: {}, buffs: {}, research: null, castles: [],
      prestigeBackfill: 1, starterPacks: 1,
    };
    for (const id of STARTER_PACKS) p.items[id] = 1;
    // A mute or freeze the admin had put on the lord before a fresh start (wipeWorld) carries over to the new one.
    if (account.carry){ Object.assign(p, account.carry); delete account.carry; }
    this.db.players[p.id] = p;
    // The client always asks for "City Name" (EvonyClient's createNewPlayer), and the live game keeps it.
    const c = this.createCastle(p, { name: opts.castleName || 'City Name', now });
    account.playerId = p.id;
    this.store.touch();
    this.log.info(`New lord ${p.name} founded ${c.name} at (${world.xy(c.fieldId).x}, ${world.xy(c.fieldId).y})`);
    this.gifts.welcome(p, now);   // (gifts to the whole server still open to new lords: gifts.js)
    return p;
  }
  // ---------- the fresh start ----------
  // The admin page's Fresh start (Fox, Nov 28 2026: "how can I wipe the server (keeping player accounts) and prepare
  // for official release"): every account stays (its name, password, e-mail, sign-ins and any ban), so players sign
  // in as before and found a new lord and city, as on their first day. Everything in the world goes: lords, cities,
  // heroes, troops, items and coins, alliances and their war reports, mail and reports, armies, colonies, the market,
  // the Hall of Fame and its votes, chat and the newsboard, valleys, NPC and Historic Cities (back as they started).
  // Kept besides the accounts: the gifts to everyone (gifts.js), the admin's side (bans of addresses and browsers, allowed pairs, notes, the audit log,
  // the sign-up and password counts), the banner, sign-ins (sessions) and password reset links; and a lord's mute or
  // freeze goes to his next lord. newMap: a new map (the NPC cities, valleys and flats elsewhere); else the same one.
  freshWorld(db = this.db, { newMap = false, now = this.now() } = {}){
    const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
    const accounts = {};
    for (const [k, a0] of Object.entries(db.accounts || {})){
      const a = clone(a0), p = a.playerId != null ? db.players?.[a.playerId] : null, carry = {};
      for (const f of ['adminMute', 'frozen']) if (p && this.security.live(p[f], now)) carry[f] = clone(p[f]);
      delete a.playerId; a.playerId = null;
      if (Object.keys(carry).length) a.carry = carry; else delete a.carry;
      accounts[k] = a;
    }
    const fresh = { version: db.version ?? 1, seq: db.seq ?? 100, seed: newMap ? (Math.random() * 2 ** 31) | 0 : db.seed, accounts, players: {}, castles: {}, tiles: {},
      wipedAt: now, wipes: [...(db.wipes || []), { at: now, newMap: !!newMap, accounts: Object.keys(accounts).length, lords: Object.keys(db.players || {}).length }] };
    // (and the gifts to the whole server: one still open reaches every new lord on the new world)
    for (const k of ['security', 'sessions', 'resets', 'banner', 'gifts']) if (db[k] != null) fresh[k] = clone(db[k]);
    return fresh;
  }
  // Fresh start for real: the world as it was is saved in data/backups (world-before-wipe-<date>.json), the fresh
  // one written as world.json, and nothing more is saved; this.restart (server.js) then ends the program so the
  // autostart (run-server.bat) starts it again on the new world. Returns the backup's path.
  wipeWorld({ newMap = false } = {}){
    const now = this.now(), fs = require('fs'), path = require('path');
    const dir = this.backups?.dir || path.join(path.dirname(this.store.file), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, `world-before-wipe-${new Date(now).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`);
    fs.writeFileSync(backup, JSON.stringify(this.db));
    const fresh = this.freshWorld(this.db, { newMap, now });
    this.store.replaceAndHold(fresh);
    this.log.warn(`Fresh start: the world was wiped (${Object.keys(fresh.accounts).length} accounts kept${newMap ? ', a new map' : ''}); the old one is in ${backup}`);
    for (const conn of [...this.online.values()]) try { conn.send('kickout', { reason: 'The server is starting a fresh world. Sign in again in a minute to found your new city.' }); conn.close(); } catch (e){}
    return backup;
  }
  // A new city for a lord on a free flat tile, with the starting buildings and resources.
  // `start` overrides the first city's starting state (rules.start), as a city built on a flat does.
  createCastle(p, { name, now = this.now(), fieldId = world.findHome(this.store), start = {} } = {}){
    const r = { ...this.rules.start, ...start };
    const c = {
      id: this.store.id(), playerId: p.id, name: name || this.rules.newCityName || 'new', fieldId, icon: 0, createdAt: now, flatLevel: this.spotLevel(fieldId, now),
      res: { food: 0, wood: 0, stone: 0, iron: 0, gold: 0, ...r.resources }, resAt: now, pop: r.population, taxRate: r.taxRate, buildings: {}, troops: {}, forts: {}, trainQ: {}, heroes: [], valleys: [], fortQ: [],
    };
    if (r.productionRate != null){ const k = r.productionRate; c.commence = { food: k, wood: k, stone: k, iron: k }; }
    for (const [pos, [typeId, level]] of Object.entries(r.buildings)) c.buildings[pos] = { typeId, level, status: STATUS.NORMAL, startTime: 0, endTime: 0 };
    this.ensureWalls(c);
    c.pop = Math.min(c.pop, this.logic.popTarget(c));   // no more than the tax rate lets it hold
    p.castles.push(c.id);
    this.db.castles[c.id] = c;
    this.db.tiles[fieldId] = { type: world.T.CASTLE, level: 1, castleId: c.id, playerId: p.id };
    this.store.touch();
    return c;
  }
  // rules.startWalls: a city without Walls gets them at that level (see rules.js).
  ensureWalls(c){
    const lv = Number(this.rules.startWalls) || 0, w = c.buildings['-2'];
    if (lv <= 0 || (w && (w.level > 0 || w.status))) return false;
    c.buildings['-2'] = { typeId: 32, level: lv, status: STATUS.NORMAL, startTime: 0, endTime: 0 };
    return true;
  }
  // The level of the spot a city is founded or lands on (a flat's, or a barbarian city's), kept for when it is given up.
  spotLevel(id, now = this.now()){ const t = world.tileAt(this.store, id, now); return Math.max(1, Math.min(10, t.level || 1)); }
  // The client sends SHA1(password) on login and "SHA1=MD5" on register.
  // This server's address as players reach it (config.json's publicUrl, else host and httpPort).
  siteUrl(){ return this.site; }
  pwdHash(pwd){ return String(pwd).split('=')[0].toLowerCase(); }
  login(conn, user, pwd){
    const name = String(user || '').trim();
    if (!name) return this.fail(conn, 'server.LoginResponse', LOGIN.BAD_USER, 'Enter an account name.');
    let account = this.db.accounts[name.toLowerCase()];
    if (!account){
      // Local server: the first login with a new name creates the account.
      account = this.db.accounts[name.toLowerCase()] = { name, pwd: this.pwdHash(pwd), createdAt: this.now(), playerId: null };
      this.store.touch();
      this.log.info(`Created account ${name}`);
    } else if (account.pwd !== this.pwdHash(pwd)){
      return this.fail(conn, 'server.LoginResponse', LOGIN.BAD_USER, 'Wrong password for that account.');
    }
    const no = this.security.refusal(conn, account);   // (banned: security.js)
    if (no) return this.fail(conn, 'server.LoginResponse', LOGIN.BAD_USER, no);
    this.security.seen(account, conn, 'signin');
    const p = account.playerId ? this.db.players[account.playerId] : this.createPlayer(account);
    // On vacation (account.js): the client shows its Holiday window with the time left, and may call it off.
    if (this.account.vacation(p, this.now())){
      conn.holidayPlayer = p;
      return conn.send('server.LoginResponse', { ok: -100, packageId: 0, msg: this.account.vacationNote(p, this.now()), errorMsg: 'You are on vacation.' });
    }
    this.enter(conn, p);
    this.reply(conn, 'server.LoginResponse', { player: this.beans.player(p, this.castlesOf(p), this.now()) });
  }
  // Lord p comes into the game on conn (the account is checked): one connection per lord, so an older one is told
  // why and closed; then everything that happened while away is caught up.
  enter(conn, p){
    const old = this.online.get(p.id);
    if (old && old !== conn){ old.send('kickout', { reason: 'You have signed in from another location.' }); old.close(); }
    conn.player = p; this.online.set(p.id, conn);
    p.lastLoginAt = this.now();
    const castles = this.castlesOf(p);
    this.colonies.tick(this.now());
    this.moveArmies(this.now());
    for (const c of castles){ this.completeDue(c, false); this.logic.settle(c, p, this.now()); }
    this.store.touch();
    this.log.info(`${p.name} logged in from ${conn.ip}`);
    this.hungerShown.set(p.id, !!this.hungryCity(p, this.now()));   // the login bean carries the hungry icon
    this.effort.check(p, this.now(), false);
  }
  disconnect(conn){
    if (conn.player && this.online.get(conn.player.id) === conn){ this.online.delete(conn.player.id); this.log.info(`${conn.player.name} disconnected`); }
  }

  // ---------- timers ----------
  completeDue(c, notify = true){
    const p = this.playerOf(c), now = this.now();
    const changed = this.logic.completeDue(c, p, now);
    for (const pos of changed){ if (notify) this.pushBuilding(c, pos); this.logic.removeEmpty(c, pos); }
    // Building queues: the next queued building starts once a builder is free (when catching up, it may finish too).
    for (let i = 0; i < 20 && this.buildQueue.advance(c, p, now, notify); i++){
      const more = this.logic.completeDue(c, p, now);
      for (const pos of more){ if (notify) this.pushBuilding(c, pos); this.logic.removeEmpty(c, pos); }
      changed.push(...more);
      if (!more.length) break;
    }
    const trained = this.troops.completeDue(c, now);
    if (trained && notify) this.pushTroops(c);
    if (this.forts.completeDue(c, now)){ this.store.touch(); if (notify) this.push(c.playerId, 'server.FortificationsUpdate', { castleId: c.id, fortification: this.beans.forts(c) }); }
    const gr = this.equipment.completeDue(p, now);
    if (gr){
      this.push(p.id, 'server.EquipmentResearchCompleteUpdate', { castleId: gr.castleId, typeId: gr.type, level: gr.level });
      for (const pc of this.castlesOf(p)) for (const h of this.heroes.list(pc)) if (h.gear && Object.keys(h.gear).length) this.pushHero(pc, h, 2);
      this.store.touch();
    }
    const r = this.research.completeDue(p, now);
    if (r) p.prestige = (p.prestige || 0) + this.quests.prestigeFor(this.data.techs[r.techId]?.levels[r.level - 1], 1, p);
    if (r){
      this.push(p.id, 'server.ResearchCompleteUpdate', { castleId: r.castleId, typeId: r.techId, level: r.level });
      const rc = this.db.castles[r.castleId];
      if (rc) this.push(p.id, 'server.AcademyResearchUpdate', { castleId: rc.id, researchBean: this.research.bean(rc, p, r.techId) });
    }
    if (changed.length || trained || r){ this.store.touch(); if (notify) this.pushResources(c); }
  }
  nextDue(c){ const p = this.playerOf(c); return Math.min(this.logic.nextDue(c), this.buildQueue.due(c), this.troops.nextDue(c), this.forts.nextDue(c), p?.research ? p.research.endTime : Infinity, p?.gearResearch ? p.gearResearch.endTime : Infinity); }
  tick(){
    const now = this.now();
    for (const c of Object.values(this.db.castles)) if (this.nextDue(c) <= now) this.completeDue(c, true);
    this.war.tick(now);
    this.account.tick(now);
    this.colonies.tick(now);
    this.commission.tick(now);
    this.moveArmies(now);
    this.market.tick(now);
    this.webTick?.(now);   // Troop Goals and Coordinated Attacks (handlers/webauto.js)
    // Population, production and prestige grow on their own: look for newly finished quests now and then.
    if (now - (this.lastQuestScan || 0) > 20000){
      this.lastQuestScan = now;
      try { this.fame.roll(now); this.fame.checkAll(now); } catch (e){ this.log.error(`fame: ${e.stack || e.message}`); }
      for (const id of this.online.keys()){
        const p = this.db.players[id]; if (!p) continue;
        try { this.questNotice(p); } catch (e){ this.log.error(`quest check: ${e.message}`); }
        try { for (const c of this.castlesOf(p)) this.logic.settle(c, p, now); this.pushHunger(p, now); } catch (e){ this.log.error(`hunger check: ${e.message}`); }
        try { this.effort.check(p, now); } catch (e){ this.log.error(`achievements: ${e.stack || e.message}`); }
      }
    }
  }
  // Armies that reached their target or came home. Arrivals are processed in time order.
  moveArmies(now){
    this.armies.checkGuests(now);   // (allied troops whose stay is over)
    // Armies stationed in a city they are colonizing (direction STAY) wait for colonies.tick.
    const due = Object.values(this.db.armies || {}).filter(a => a.reachTime <= now && a.direction !== DIR.STAY).sort((x, y) => x.reachTime - y.reachTime);
    for (const a of due){
      if (this.db.armies[a.id] !== a || a.reachTime > now || a.direction === DIR.STAY) continue;
      const p = this.db.players[a.playerId];
      try {
        const c = this.db.castles[a.castleId];
        if (c) this.logic.settle(c, p, a.reachTime);
        if (a.direction === DIR.BACK){
          const r = this.armies.home(a);
          if (r){ this.pushTroops(r.c); this.pushResources(r.c); if (r.hero) this.pushHero(r.c, r.hero, 2); }
        } else {
          const hero = c ? this.heroes.find(c, a.heroId) : null, foe = this.armies.hostile(a) ? this.targetLord(a) : null;
          this.armies.arrive(a, a.reachTime);
          if (foe) this.pushEnemies(foe);
          // (The hero may have been captured, or moved to a conquered city, meanwhile.)
          if (hero && c && this.heroes.find(c, hero.id)) this.pushHero(c, hero, 2);
          if (c) this.pushResources(c);
        }
      } catch (e){
        this.log.error(`army ${a.id}: ${e.stack || e.message}`);
        if (this.db.armies[a.id] && this.db.armies[a.id].reachTime <= now) this.armies.home(a);
      }
      this.store.touch();
      if (p) this.pushArmies(p);
    }
  }

  // ---------- dispatch ----------
  handle(conn, cmd, data){
    cmd = String(cmd);
    if (!CMD_NAME.test(cmd) || BUILT_IN.has(cmd) || poisoned(data)) return this.fail(conn, cmd.slice(0, 80), -1, 'That request was refused.');
    // (a security scanner's probe: security.probe bans it)
    const probe = probeIn(data);
    if (probe){ this.security.probe(conn, probe, cmd); return this.fail(conn, cmd, -1, 'That request was refused.'); }
    if (this.overLimit(conn)) return this.fail(conn, cmd, -1, 'Too many requests at once. Slow down.');
    const h = Object.hasOwn(this.handlers, cmd) ? this.handlers[cmd] : null;
    this.notePackage(conn, cmd, data);
    const open = cmd === 'gameClient.version' || cmd === 'login' || cmd === 'register' || cmd.startsWith('login.') || cmd.startsWith('auth.') || (cmd === 'furlough.cancelFurlought' && conn.holidayPlayer);
    if (!open && !conn.player) return this.fail(conn, cmd, -1, 'Please log in first.');
    const p = conn.player;
    // "Once Vacation mode is activated, no operation of the game is allowed" (the client reloads the page after it).
    const isRead = v => READ_VERB.test(v) || IS_VERB.test(v);
    if (p && cmd !== 'furlough.cancelFurlought' && !isRead(cmd.split('.').pop()) && this.account.vacation(p, this.now())) return this.fail(conn, cmd, -1, 'You are on vacation: no operation of the game is allowed.');
    conn.tracking = p ? { cmd, data, items: { ...(p.items || {}) }, coins: p.coins || 0, sent: {}, flushed: false } : null;
    const started = this.perf?.now();
    try {
      if (h) return h(conn, data || {}, cmd);
      return this.unhandled(conn, cmd, data);
    } catch (e){
      this.log.error(`${cmd} failed: ${e.stack || e.message}`);
      this.fail(conn, cmd, -1, 'The server hit an error handling that. Check the server window for details.');
    } finally {
      conn.tracking = null; conn.current = null;
      // Anything that changes the game may finish a quest; reads and polls can't.
      if (p && h && !isRead(cmd.split('.').pop())){
        try { this.questNotice(p, this.castleFor(conn, data?.castleId)); } catch (e){ this.log.error(`quest check after ${cmd}: ${e.stack || e.message}`); }
      }
      if (this.perf) this.perf.record('cmd', cmd, this.perf.now() - started);
    }
  }
  // A lord's own limit for one kind of thing (chat lines, mails, bug reports): true when he has done it max times in
  // the last ms. Kept in memory: a restart lets him start over.
  limited(p, key, max, ms, now = Date.now()){
    const all = (this.limits ??= new Map()), k = `${p?.id}:${key}`, list = (all.get(k) || []).filter(t => t > now - ms);
    if (list.length >= max){ all.set(k, list); return true; }
    list.push(now); all.set(k, list);
    if (all.size > 20000) for (const [x, v] of all) if (!v.length || v[v.length - 1] < now - 3600e3) all.delete(x);
    return false;
  }
  // The speed limit (see RATE_BURST): true when conn has sent too much too fast. Wall-clock time, not the game's.
  // (rules.security.rateBurst and ratePerSec change them)
  overLimit(conn, now = Date.now()){
    const R = this.rules.security || {}, burst = R.rateBurst ?? RATE_BURST, perSec = R.ratePerSec ?? RATE_PER_SEC;
    const b = (conn.rate ??= { t: now, n: burst, dropped: 0 });
    b.n = Math.min(burst, b.n + Math.max(0, now - b.t) / 1000 * perSec); b.t = now;
    if (b.n >= 1){ b.n -= 1; if (b.n >= burst / 2) b.dropped = 0; return false; }
    b.dropped++;
    if (b.dropped === 1) this.log.warn(`Too many requests from ${conn.player?.name || 'a connection'} (${conn.ip || '?'}): refusing them`);
    if (b.dropped >= RATE_CLOSE){ this.log.warn(`Closed the connection of ${conn.player?.name || 'a connection'} (${conn.ip || '?'}): it kept sending too many requests`); try { conn.close(); } catch (e){} }
    return true;
  }
  unhandled(conn, cmd, data){
    // Logged once per command per run, so polling requests don't flood the file (see UNHANDLED_MAX).
    if (conn.player && !this.seenUnhandled.has(cmd) && this.seenUnhandled.size < UNHANDLED_MAX){
      this.seenUnhandled.add(cmd);
      const text = (JSON.stringify(data) || '').slice(0, UNHANDLED_DATA);
      this.log.warn(`Not implemented yet: ${cmd} ${text.slice(0, 300)}`);
      try { fs.appendFileSync(this.unhandledFile, JSON.stringify({ at: new Date().toISOString(), cmd, data: text }) + '\n'); } catch (e){}
    }
    const verb = cmd.split('.').pop();
    if (HARMLESS.has(cmd) || READ_VERB.test(verb) || IS_VERB.test(verb)) return this.reply(conn, cmd, this.emptyReply(cmd));
    this.fail(conn, cmd, -1, `This server doesn't support that yet (${cmd}).`);
  }
  // An empty but well-formed reply: every array the reply type declares is present and empty.
  emptyReply(cmd){
    const bean = this.protocol.replies[cmd]; const fields = bean && this.protocol.beans[bean]?.fields || {};
    const out = {};
    for (const [k, f] of Object.entries(fields)) if (f.array) out[k] = [];
    return out;
  }

  // ---------- local web pages ----------
  // The news ticker across the top of the screen: the client loads movingText.txt every 5 minutes and scrolls it
  // (nothing shows while it's empty). Set it from the debug menu, or edit data/movingText.txt.
  // The web client's banner across the top (welcome.js): its line and the link after it (the Discord invite). The
  // admin page sets it (kept in the world as db.banner); without that, config.json's welcomeText and welcomeLink.
  banner(){ const b = this.db.banner; return b ? { text: String(b.text ?? ''), link: String(b.link ?? '') } : { ...this.welcome }; }
  setBanner(text, link){
    if (text == null && link == null){ delete this.db.banner; this.store.touch(); return this.banner(); }
    const t = String(text ?? '').replace(/[\r\n]+/g, ' ').slice(0, 300), l = String(link ?? '').trim().slice(0, 300);
    this.db.banner = { text: t && !/\s$/.test(t) && l ? t + ' ' : t, link: l };
    this.store.touch(); return this.banner();
  }
  // welcome.js: the banner and the gold a coin is worth, read by the web client when it loads.
  welcomeJs(){
    const b = this.banner();
    // (and the sign-up form's Turnstile check, when it's on: turnstile.js)
    // (and what refreshing the Inn costs without a Hero Hunting, for its dialog: handlers/heroes.js)
    return `window.AOW_WELCOME=${JSON.stringify(b.text)};window.AOW_LINK=${JSON.stringify(b.link)};window.AOW_GOLD_PER_COIN=${Number(this.goldFinishRate?.()) || 0};`
      + `window.AOW_INN_GOLD=${Number(this.innRefreshGold?.()) || 0};`
      + (this.turnstile?.clientJs() || 'window.aowTurnstile=null;');
  }
  tickerFile(){ return path.join(this.dataDir, 'movingText.txt'); }
  ticker(){ try { return fs.readFileSync(this.tickerFile(), 'utf8').replace(/[\r\n]+/g, '   ').trim(); } catch (e){ return String(this.rules.newsTicker || ''); } }
  setTicker(text){ const t = String(text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500); fs.writeFileSync(this.tickerFile(), t); return t; }
  // The debug menu's Server speed section (src/perf.js): is the server keeping up, or is the lag in the client?
  perfHtml(name, esc){
    if (!this.perf) return '';
    const s = this.perf.summary(), ms = v => v >= 1000 ? (v / 1000).toFixed(1) + ' s' : v >= 10 ? Math.round(v) + ' ms' : v.toFixed(1) + ' ms';
    const held = v => Math.max(0, v - 20);           // the event-loop monitor samples every 20 ms
    const loopMax = s.loop ? held(s.loop.max) : 0, worst = Math.max(loopMax, s.all.max, s.tick.max, s.save.max);
    const slowCmd = s.cmds[0];
    const verdict = !s.all.n ? 'Nothing measured yet: play a while with this page closed, then reload it.'
      : worst < 150 ? `<span class="ok">The server is keeping up: its slowest moment was ${ms(worst)}, which you can't see in the game. If the game feels laggy, it's the client (Flash in Basilisk), not the server.</span>`
      : `<span class="bad">The server held things up for as long as ${ms(worst)}. While it does, every reply and update waits, so the game can stutter. What was slow is listed below; send this page to Claude.</span>`;
    const rows = [
      ['Answers', `${s.all.n.toLocaleString('en-US')} commands, ${ms(s.all.avg)} on average, slowest ${ms(s.all.max)}${slowCmd ? ` (${esc(slowCmd.cmd)})` : ''}`],
      ['Stalls', s.loop ? `typically ${ms(held(s.loop.p50))}, 99% of the time under ${ms(held(s.loop.p99))}, worst ${ms(loopMax)}` : 'not measured'],
      ['Timers (every second)', `${ms(s.tick.avg)} on average, slowest ${ms(s.tick.max)}`],
      ['Saving world.json', `${(s.save.bytes / 1048576).toFixed(1)} MB, ${s.save.n} saves, ${ms(s.save.avg)} on average, slowest ${ms(s.save.max)}`],
      ['Sent to clients', `${Math.round(s.sent.perMin)} messages a minute (${Math.round(s.sent.kbPerMin)} KB); most: ${s.sent.top.map(([c, n]) => `${esc(c)} ${n}`).join(', ') || 'none'}`],
      ['Art', `${s.art.cache} files from the cache, ${s.art.fetched} from the art server (${ms(s.art.fetchAvg)} on average, slowest ${ms(s.art.fetchMax)}), ${s.art.missing} missing`],
    ];
    const slowest = s.cmds.slice(0, 5).filter(c => c.max >= 20).map(c => `${esc(c.cmd)}: ${c.n} x, ${ms(c.avg)} avg, ${ms(c.max)} max`).join('<br>');
    const moments = s.slow.slice(0, 6).map(x => `${new Date(x.at).toTimeString().slice(0, 8)} ${esc(x.what)} ${ms(x.ms)}`).join('<br>');
    return `<h2>Server speed</h2><p>Measured over the last ${s.minutes < 2 ? Math.round(s.minutes * 60) + ' seconds' : Math.round(s.minutes) + ' minutes'}. ${verdict}</p>
      <table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      ${slowest ? `<p>Slowest commands:<br>${slowest}</p>` : ''}${moments ? `<p class="bad">Slow moments:<br>${moments}</p>` : ''}
      <p><a class="btn" href="?user=${encodeURIComponent(name)}&perf=reset">Start measuring again</a></p>`;
  }
  // "Get More Coins" in the client opens <addFund>&user=NAME. On this server that page is a small
  // owner's panel: add coins, or fill every city's resources. Turn it off with coinsPage: false.
  // The admin page (/admin, behind the admin password): admin.js.
  adminPage(query){ return this.admin.page(query); }
  coinsPage(query){
    const esc = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
    const n = v => Math.floor(v).toLocaleString('en-US');
    const name = String(query.get('user') || '');
    const acct = this.db.accounts[name.toLowerCase()], p = acct?.playerId ? this.db.players[acct.playerId] : null;
    let note = '';
    const eq = this.equipment, techIds = Object.keys(this.data.techs).map(Number), gearTypes = eq.types();
    // (changes only with the page's own token, t, so another site can't make the admin's browser do them)
    // (Fox, Nov 24 2026: resources and troops up to 2.145 billion at a time; the coins hidden for this version,
    // rules.debugCoins)
    const MAX = 2145000000, coinsOn = this.rules.debugCoins !== false;
    if (p && this.rules.coinsPage && query.get('t') === this.adminToken){
      const add = coinsOn ? Math.floor(Number(query.get('add'))) : 0;
      if (add > 0 && add <= 100000000){
        p.coins = (p.coins || 0) + add; this.store.touch(); this.pushPlayerInfo(p);
        note = `<p class="ok">Added ${n(add)} coins. They're already in your wallet in the game.</p>`;
        this.log.info(`Owner page: added ${add} coins to ${p.name}`);
      }
      // Items: "give" is an item id or name from the client's item table.
      const giveRaw = String(query.get('give') || '').trim();
      if (giveRaw){
        const n = Math.max(1, Math.min(9999, Math.floor(Number(query.get('n')) || 1)));
        const low = giveRaw.toLowerCase(), all = Object.values(this.data.items).filter(i => !/^hero\.taskitem\./.test(i.id));
        const it = this.data.items[giveRaw] || all.find(i => i.name.trim().toLowerCase() === low) || all.find(i => i.name.toLowerCase().includes(low));
        if (it){
          this.items.add(p, it.id, n); this.store.touch(); this.pushItems(p, [it.id]);
          note = `<p class="ok">Added ${n} x ${esc(it.name)} (${esc(it.id)}). Find it in My Items in the game.</p>`;
          this.log.info(`Owner page: gave ${p.name} ${n} x ${it.name}`);
        } else note = `<p class="bad">No item called "${esc(giveRaw)}".</p>`;
      }
      // Troops: "troop" is a troop's field name or "all", "tn" how many, "city" the city (any of his).
      const troopRaw = String(query.get('troop') || '').trim();
      if (troopRaw){
        const tn = Math.floor(Number(query.get('tn')) || 0), cs = this.castlesOf(p), c = cs.find(x => x.id === Number(query.get('city'))) || cs[0];
        const kinds = troopRaw === 'all' ? Object.values(this.data.troops) : Object.values(this.data.troops).filter(t => t.field === troopRaw);
        if (!c || !kinds.length || !(tn > 0 && tn <= MAX)) note = `<p class="bad">Pick a city, a kind of troop and an amount from 1 to ${n(MAX)}.</p>`;
        else {
          // (a count stops at 2,147,483,647 here: past it a city's count turns negative and bricks the city, as on live)
          const full = [];
          for (const t of kinds){ const have = c.troops[t.field] || 0; if (have + tn > TROOP_MAX) full.push(t.name); c.troops[t.field] = Math.min(TROOP_MAX, have + tn); }
          this.store.touch(); this.pushTroops(c);
          const what = troopRaw === 'all' ? 'of every kind of troop' : esc(kinds[0].name);
          note = `<p class="ok">Added ${n(tn)} ${what} to ${esc(c.name)}. They're already in the city in the game.</p>`
            + (full.length ? `<p class="bad">${full.map(esc).join(', ')} stopped at ${n(TROOP_MAX)}, the most a city can hold.</p>` : '');
          this.log.info(`Owner page: gave ${p.name} ${tn} ${troopRaw} in ${c.name}`);
        }
      }
      // Research and gear: "tech" (a research id or "all") to level "tl" 0-10; "gear" (a gear technology or "all")
      // to level "gl" 0-10; "star" (a gear technology or "all") to "sl" 0-15 stars, at most its level + 6 as in the
      // game. Gear levels are set before stars, so one link can max everything.
      const pick = (raw, all) => raw === 'all' ? all : all.filter(x => x === Number(raw));
      const said = [], changed = { tech: false, gear: false };
      const techRaw = String(query.get('tech') || '').trim();
      if (techRaw){
        const L = Math.floor(Number(query.get('tl'))), ids = pick(techRaw, techIds);
        if (!ids.length || !(L >= 0 && L <= 10)) said.push('<p class="bad">Pick a research topic and a level from 0 to 10.</p>');
        else {
          p.techs = p.techs || {};
          for (const id of ids){ if (L) p.techs[id] = L; else delete p.techs[id]; }
          if (p.research && ids.includes(p.research.techId) && p.research.level <= L) p.research = null;
          changed.tech = true;
          said.push(`<p class="ok">${ids.length > 1 ? 'All research' : esc(this.data.techs[ids[0]].name.trim())} is now level ${L}. Reopen the Academy to see it.</p>`);
          this.log.info(`Owner page: set ${p.name}'s research ${techRaw} to ${L}`);
        }
      }
      const gearRaw = String(query.get('gear') || '').trim();
      if (gearRaw){
        const L = Math.floor(Number(query.get('gl'))), types = pick(gearRaw, gearTypes);
        if (!types.length || !(L >= 0 && L <= 10)) said.push('<p class="bad">Pick a gear technology and a level from 0 to 10.</p>');
        else {
          for (const t of types){ const st = eq.state(p, t); st.lv = L; st.star = Math.min(st.star, eq.maxStar(p, t)); }   // (none on the mount)
          if (p.gearResearch && types.includes(p.gearResearch.type) && p.gearResearch.level <= L) p.gearResearch = null;
          changed.gear = true;
          said.push(`<p class="ok">${types.length > 1 ? 'All gear technologies are' : esc(eq.techs[types[0]].name) + ' is'} now level ${L}. Reopen the Workshop to see it.</p>`);
          this.log.info(`Owner page: set ${p.name}'s gear ${gearRaw} to level ${L}`);
        }
      }
      const starRaw = String(query.get('star') || '').trim();
      if (starRaw){
        const S = Math.floor(Number(query.get('sl'))), types = pick(starRaw, gearTypes);
        if (!types.length || !(S >= 0 && S <= 15)) said.push('<p class="bad">Pick a gear technology and 0 to 15 stars.</p>');
        else {
          const capped = [], none = [];
          for (const t of types){
            const L = eq.level(p, t);
            if (!L){ if (S) none.push(eq.techs[t].name); continue; }
            if (!eq.maxStar(p, t)) continue;   // (the mount holds no stars)
            const st = eq.state(p, t); st.star = Math.min(S, eq.maxStar(p, t));
            if (st.star < S) capped.push(`${eq.techs[t].name} (level ${L}: at most ${st.star})`);
          }
          changed.gear = true;
          said.push(`<p class="ok">${types.length > 1 ? 'All gear technologies' : esc(eq.techs[types[0]].name)}: ${S} star${S === 1 ? '' : 's'}.</p>`
            + (capped.length ? `<p class="bad">A gear level holds at most its level + 6 stars, so these got fewer: ${capped.map(esc).join(', ')}. Raise their level for more.</p>` : '')
            + (none.length ? `<p class="bad">Not researched yet, so no stars: ${none.map(esc).join(', ')}.</p>` : ''));
          this.log.info(`Owner page: set ${p.name}'s gear ${starRaw} to ${S} stars`);
        }
      }
      if (changed.tech || changed.gear){
        this.store.touch();
        for (const c of this.castlesOf(p)){
          this.pushResources(c);
          if (changed.gear) for (const h of this.heroes.list(c)) this.pushHero(c, h, 2);
        }
      }
      // A gift package (packages.js) for this lord or every lord: "pkg" its name, "pitems" lines of item * count.
      const pkgName = String(query.get('pkg') || '').trim();
      if (pkgName){
        const all = Object.values(this.data.items).filter(i => !/^hero\.taskitem\./.test(i.id)), items = [], bad = [];
        for (const line of String(query.get('pitems') || '').split(/[\r\n,]+/).map(x => x.trim()).filter(Boolean)){
          const m = line.match(/^(.*?)\s*(?:[*x×]\s*(\d+))?$/i), raw = (m?.[1] || line).trim(), low = raw.toLowerCase();
          const count = Math.max(1, Math.min(9999, Math.floor(Number(m?.[2]) || 1)));
          const it = this.data.items[raw] || all.find(i => i.name.trim().toLowerCase() === low) || all.find(i => i.name.toLowerCase().includes(low));
          if (it) items.push({ id: it.id, count }); else bad.push(raw);
        }
        if (bad.length || !items.length) said.push(`<p class="bad">${bad.length ? `No item called ${bad.map(b => `"${esc(b)}"`).join(', ')}.` : 'Put at least one item in the package.'}</p>`);
        else {
          const to = query.get('pall') ? Object.values(this.db.players) : [p], days = Math.max(0, Math.min(365, Math.floor(Number(query.get('pdays')) || 0)));
          for (const q of to) this.packages.give(q, pkgName, String(query.get('pdesc') || '').trim(), items, days);
          said.push(`<p class="ok">Sent "${esc(pkgName)}" (${items.map(x => `${x.count} x ${esc(this.items.name(x.id))}`).join(', ')}) to ${to.length > 1 ? `all ${to.length} lords` : esc(p.name)}. It's in the gift box beside the minimap.</p>`);
          this.log.info(`Owner page: sent the package ${pkgName} to ${to.length} lord(s)`);
        }
      }
      if (query.has('ticker')){
        const t = this.setTicker(query.get('ticker'));
        said.push(t ? `<p class="ok">The news ticker now reads "${esc(t)}". The game picks it up within 5 minutes (or log in again).</p>` : '<p class="ok">The news ticker is off.</p>');
        this.log.info(`Owner page: news ticker ${t ? 'set' : 'cleared'}`);
      }
      if (said.length) note += said.join('');
      if (query.get('perf') === 'reset' && this.perf){ this.perf.reset(); note += '<p class="ok">Server speed counters cleared. Play a while, then reload this page.</p>'; }
      const fill = Math.floor(Number(query.get('fill')));
      if (fill > 0 && fill <= MAX){
        const now = this.now();
        for (const c of this.castlesOf(p)){
          this.logic.settle(c, p, now);
          for (const k of ['food', 'wood', 'stone', 'iron', 'gold']) c.res[k] = (c.res[k] || 0) + fill;   // (Fox: added, not set)
          this.pushResources(c);
        }
        this.store.touch();
        note = `<p class="ok">Added ${n(fill)} food, lumber, stone, iron and gold to every city.</p>`;
        this.log.info(`Owner page: added ${fill} of each resource to ${p.name}'s cities`);
      }
    }
    const link = (q, label) => `<a class="btn" href="?user=${encodeURIComponent(name)}&t=${this.adminToken}&${q}">${label}</a>`;
    const levels = (max, sel) => Array.from({ length: max + 1 }, (_, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${i}</option>`).join('');
    const body = !this.rules.coinsPage ? '<p>This page is turned off on this server (coinsPage in data/rules.json).</p>'
      : !p ? '<p>Open this page from the <a href="/admin" style="color:#e6c27a">admin page</a> (Debug tools beside a lord).</p>'
      : (coinsOn ? `<p><b>${esc(p.name)}</b> has <b>${n(p.coins || 0)}</b> coins.</p>${note}
         <h2>Coins</h2><p>${[1000, 10000, 100000, 1000000].map(v => link('add=' + v, 'Add ' + n(v))).join(' ')}</p>
         <form><input type="hidden" name="user" value="${esc(name)}"><input type="hidden" name="t" value="${this.adminToken}"><input name="add" type="number" min="1" max="100000000" placeholder="Other amount"> <button class="btn">Add coins</button></form>`
         : `<p>Lord: <b>${esc(p.name)}</b></p>${note}`) + `
         <h2>Resources</h2><p>Adds this much food, lumber, stone, iron and gold to every city, up to ${n(MAX)} at a time. Amounts above a city's storage stay until you spend them.</p>
         <p>${[1000000, 10000000, 100000000, 1000000000, MAX].map(v => link('fill=' + v, '+' + n(v) + ' each')).join(' ')}</p>
         <form><input type="hidden" name="user" value="${esc(name)}"><input type="hidden" name="t" value="${this.adminToken}"><input name="fill" type="number" min="1" max="${MAX}" placeholder="Other amount"> <button class="btn">Add to each</button></form>
         <h2>Troops</h2><p>Adds troops to one of your cities, straight into its army, up to ${n(MAX)} at a time (a city holds at most ${n(TROOP_MAX)} of a kind).</p>
         <form><input type="hidden" name="user" value="${esc(name)}"><input type="hidden" name="t" value="${this.adminToken}"><select name="city">${this.castlesOf(p).map(c => { const { x, y } = world.xy(c.fieldId); return `<option value="${c.id}">${esc(c.name)} (${x},${y})</option>`; }).join('')}</select>
         <select name="troop"><option value="all">Every kind</option>${Object.values(this.data.troops).map(t => `<option value="${esc(t.field)}">${esc(t.name)}</option>`).join('')}</select>
         <input name="tn" type="number" min="1" max="${MAX}" value="10000" style="width:130px"> <button class="btn">Add troops</button></form>
         <h2>Research</h2><p>Sets research levels at once (they're shared by all your cities). Now: ${techIds.map(id => `${esc(this.data.techs[id].name.trim())} ${p.techs?.[id] || 0}`).join(', ')}.</p>
         <form><input type="hidden" name="user" value="${esc(name)}"><input type="hidden" name="t" value="${this.adminToken}"><select name="tech"><option value="all">All research</option>${techIds.map(id => `<option value="${id}">${esc(this.data.techs[id].name.trim())}</option>`).join('')}</select>
         <select name="tl">${levels(10, 10)}</select> <button class="btn">Set research</button></form>
         <h2>Gear and stars</h2><p>Sets the Workshop's gear technologies and their stars. A level holds at most level + 6 stars, and a hero wears at most one gear level per 10 hero levels.
           Star set: <b>${eq.setStars(p)}</b> (+${eq.setLife(p)}% troop life against NPC and Historic Cities).</p>
         <p>${gearTypes.map(t => `${esc(eq.techs[t].name)} ${eq.level(p, t)}${eq.star(p, t) ? ` (${eq.star(p, t)}★)` : ''}`).join(', ')}.</p>
         <form><input type="hidden" name="user" value="${esc(name)}"><input type="hidden" name="t" value="${this.adminToken}"><select name="gear"><option value="all">All gear</option>${gearTypes.map(t => `<option value="${t}">${esc(eq.techs[t].name)}</option>`).join('')}</select>
         <select name="gl">${levels(10, 10)}</select> <button class="btn">Set gear level</button></form>
         <form><input type="hidden" name="user" value="${esc(name)}"><input type="hidden" name="t" value="${this.adminToken}"><select name="star"><option value="all">All gear</option>${gearTypes.map(t => `<option value="${t}">${esc(eq.techs[t].name)}</option>`).join('')}</select>
         <select name="sl">${levels(15, 15)}</select> <button class="btn">Set stars</button></form>
         <p>${link('tech=all&tl=10&gear=all&gl=10&star=all&sl=15', 'Max everything (research 10, gear 10, 15 stars)')}</p>
         ${this.perfHtml(name, esc)}
         <h2>News ticker</h2><p>The scrolling line at the top of the game screen, for every lord. Leave it empty to turn it off.</p>
         <form><input type="hidden" name="user" value="${esc(name)}"><input type="hidden" name="t" value="${this.adminToken}"><input name="ticker" value="${esc(this.ticker())}" placeholder="Welcome to the server!" style="width:360px"> <button class="btn">Set ticker</button></form>
         <h2>Gift package</h2><p>Puts a package in the gift box beside the minimap (My Package Locker), to claim from there. One item per line, with * and a count.</p>
         <form><input type="hidden" name="user" value="${esc(name)}"><input type="hidden" name="t" value="${this.adminToken}"><input name="pkg" placeholder="Package name" value="Gift Package" style="width:260px"><br>
         <textarea name="pitems" rows="3" placeholder="Aries Amulet * 2&#10;Speaker * 10" style="width:360px;margin:6px 0;padding:7px;border-radius:4px;border:1px solid #666;background:#2b2722;color:#eee"></textarea><br>
         <input name="pdesc" placeholder="Description (optional)" style="width:260px"> <input name="pdays" type="number" min="0" max="365" placeholder="Days to claim (0 = no limit)" style="width:200px"><br>
         <label><input type="checkbox" name="pall" value="1" style="width:auto"> Every lord on the server</label> <button class="btn">Send package</button></form>
         <h2>Items</h2><p>Puts any item from the client's item table into your inventory, including event chests the shop doesn't sell. Type part of the name.</p>
         <form><input type="hidden" name="user" value="${esc(name)}"><input type="hidden" name="t" value="${this.adminToken}"><input name="give" list="itemlist" placeholder="Item name" style="width:260px"> <input name="n" type="number" min="1" max="9999" value="1" style="width:70px"> <button class="btn">Give</button>
         <datalist id="itemlist">${[...new Set(Object.values(this.data.items).filter(i => !/^hero\.taskitem\./.test(i.id)).map(i => i.name.trim()))].sort().map(x => `<option value="${esc(x)}">`).join('')}</datalist></form>`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Debug menu</title><style>body{font:15px Arial,sans-serif;background:#1d1a16;color:#eee;padding:40px;max-width:600px}
      h2{font-size:17px;margin:28px 0 6px;color:#e6c27a}input,select{padding:7px;border-radius:4px;border:1px solid #666;background:#2b2722;color:#eee;width:160px}select{width:auto;margin-right:4px}
      .btn{display:inline-block;background:#b8860b;color:#111;padding:8px 14px;border-radius:4px;text-decoration:none;font-weight:bold;margin:4px 6px 4px 0;border:0;cursor:pointer;font:bold 14px Arial,sans-serif}.ok{color:#9be29b}.bad{color:#f29b9b}
      table{border-collapse:collapse;font-size:14px}td{padding:4px 10px 4px 0;vertical-align:top}td:first-child{color:#e6c27a;white-space:nowrap}</style></head>
      <body><h1>Debug menu</h1><p>This is your local server, so ${coinsOn ? 'coins, ' : ''}resources, troops, items, research and gear are free here.</p>${body}</body></html>`;
  }
}

module.exports = { Game, CLIENT_VERSION, OK, LOGIN };
