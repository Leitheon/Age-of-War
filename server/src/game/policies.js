'use strict';
const { addTroops } = require('./castle');
// Historic City policies (the map's Policies button; the client's PoliciesView and its own texts). A lord who holds
// a Historic City can use it on another lord's city or an NPC city within its draft area:
//   Tax Imposition          "draw 30% of its gold reserve"
//   Population Redeployment "Draw 50% of idle population of target city to currently visiting city"
//   Food Levy               "draw 20% of its food stock"
//   Draft                   "Despatch 5% of one specific branch of troops to currently visiting city"
//   Disarmament             "Disarm 10% of one specific branch of troops"
// Policies only go down: a Historic City can't use them on another of its level or higher. Draft and Disarmament
// can't be used on a Historic City that nobody holds (the client offers only the first
// three there). The client lets nobody pick the branch: the server picks it (taken(), below; the same for a
// colony's Draft and Disarmament), and with rules.draft.undraftable (off in Age of War) a city at an undraftable
// number has "There are no troops in the city". Draft area and uses a day: rules.policies (Evony Advanced Guide). Uses
// come back at the daily reset.
const world = require('./world');
const { REPORT_TYPE } = require('./reports');

const KIND = {
  tax: { name: 'Tax Imposition', share: 0.3 },
  population: { name: 'Population Redeployment', share: 0.5 },
  food: { name: 'Food Levy', share: 0.2 },
  draft: { name: 'Draft', share: 0.05, troops: true },
  disarm: { name: 'Disarmament', share: 0.1, troops: true },
};
// A captured Historic City's level from its power level (FieldConstants: 3 Village ... 0 City).
const LEVEL_OF_POWER = { 3: 12, 2: 14, 1: 16, 0: 18 };

class Policies {
  constructor(game){ this.g = game; }
  get rules(){ return this.g.rules.policies || {}; }
  level(c){ return LEVEL_OF_POWER[c.powerLevel ?? 4] || 0; }
  today(now){ return this.g.npc.day(now); }
  used(c, now){ const s = c.policies; return s && s.day === this.today(now) ? s.used : 0; }
  perDay(c){ return this.rules.perDay?.[this.level(c)] ?? 0; }
  left(c, now){ return Math.max(0, this.perDay(c) - this.used(c, now)); }
  share(kind){ return this.rules.share?.[kind] ?? KIND[kind].share; }
  // Miles in any direction (the map wraps around).
  inRange(c, fieldId){
    const L = this.level(c), r = this.rules.range?.[L]; if (r == null) return false;
    const a = world.xy(c.fieldId), b = world.xy(fieldId), wrap = d => Math.min(d, world.SIZE - d);
    return Math.max(wrap(Math.abs(a.x - b.x)), wrap(Math.abs(a.y - b.y))) <= r;
  }
  // Idle population: people not needed in the fields (the Town Hall's Available Labor less Required Labor).
  idle(c){
    const f = this.g.logic.fieldsOf(c), rate = this.g.logic.commence(c);
    const demand = Object.keys(f).reduce((a, k) => a + f[k].labour * rate[k] / 100, 0);
    return Math.max(0, (c.pop || 0) - demand);
  }
  // The branch a Draft or Disarmament takes, here and on a colony, or null when there are no troops to take.
  // It is the branch with the most troops (rules.draft.pick 'count'; 'worth': the one worth most, count x its
  // experience value, rules.troopExp). Then its worth is worked out as the live server does, in a 32-bit int: past
  // 2,147,483,647 it wraps negative, and nothing can be taken. Those are the Evony Advanced Guide's undraftable
  // numbers, 2^31 / the experience value: 9,544,371 Workers can be drafted, 9,544,372 to 19,088,743 can't, 19,088,744
  // can again. Fox's colony S1 on live (Nov 11 2026): its biggest branch, 1,100,300,000 Battering Rams (also its most
  // valuable), is undraftable, and a Draft found no troops to draft though six of its other branches aren't, so a
  // branch at an undraftable number isn't simply skipped (RoboEvony's guess: it marks the branch worth most among the
  // draftable ones). Whether the branch is the most numerous or the most valuable, S1 can't tell (UNVERIFIED: 'count',
  // the old lore of covering with Warriors). rules.draft.anyBlocks: one undraftable branch anywhere shields the city
  // (the guide's reading, UNVERIFIED). Age of War has none of this (Fox, Nov 25 2026: "I don't want there to be any
  // undraftable numbers"): with rules.draft.undraftable off, the biggest branch is always taken.
  taken(troops){
    const r = this.g.rules.draft || {}, exp = this.g.rules.troopExp || {};
    const worth = (t, n) => r.undraftable ? Math.imul(Math.min(n, 2147483647), exp[t.id] ?? 1) : 1;   // (as the live server's int)
    let best = null, top = 0, blocked = false;
    for (const t of Object.values(this.g.data.troops)){
      const n = Math.floor(Number(troops?.[t.field]) || 0); if (n <= 0) continue;
      if (worth(t, n) <= 0) blocked = true;
      const by = r.pick === 'worth' ? n * (exp[t.id] ?? 1) : n;
      if (by > top){ top = by; best = t; }
    }
    if (!best || (r.anyBlocks && blocked)) return null;
    return worth(best, Math.floor(Number(troops[best.field]))) > 0 ? best.field : null;
  }
  // What live says then (Fox's colony Draft, Nov 17 2026); the day's policy is used up all the same (Fox, S1).
  // (Disarmament, and a city with no troops at all, get the same answer here: UNVERIFIED.)
  noTroops(kind){ return 'There are no troops in the city'; }
  troopName(field){ return Object.values(this.g.data.troops).find(t => t.field === field)?.name || field; }

  // When a lord's city last took a policy (db.policyTargets, by city id), and how long it must still wait (ms; 0 if
  // it can take one now).
  targetWait(key, now){
    const ms = (this.rules.targetHours ?? 24) * 3600e3, last = this.g.db.policyTargets?.[key];
    return ms > 0 && last != null && now - last < ms ? last + ms - now : 0;
  }
  markTarget(key, now){
    const ms = (this.rules.targetHours ?? 24) * 3600e3, map = this.g.db.policyTargets || (this.g.db.policyTargets = {});
    for (const [k, at] of Object.entries(map)) if (now - at >= ms) delete map[k];   // (those free again)
    map[key] = now;
  }
  use(c, p, kind, targetFieldId, now = this.g.now()){
    const g = this.g, k = KIND[kind], target = Number(targetFieldId);
    if (!this.level(c)) return [-1, 'Policies can only be issued from a Historic City you hold.'];
    if (!(target >= 0 && target < world.SIZE * world.SIZE)) return [-1, 'That map location does not exist.'];
    if (!this.left(c, now)) return [-1, `Your Historic City has used all its ${this.perDay(c)} policies today. They come back after the daily maintenance.`];
    if (!this.inRange(c, target)) return [-1, `That city is outside your draft area (${this.rules.range?.[this.level(c)]} miles in any direction).`];
    const tile = world.tileAt(g.store, target, now);
    let dc = null, dp = null, st = null;
    if (tile.type === world.T.CASTLE){
      dc = g.db.castles[tile.castleId]; dp = dc && g.db.players[dc.playerId];
      if (!dc || !dp) return [-1, 'There is no city there.'];
      if (dp.id === p.id) return [-1, 'Policies are for other lords\' cities.'];
      g.logic.settle(dc, dp, now);
    } else if (tile.type === world.T.NPC){
      if (tile.historic && k.troops) return [-1, `${k.name} can't be used on a Historic City.`];
      st = g.npc.state(g.db, tile, now);
    } else return [-1, 'Policies can only be used on a city.'];
    // Policies only go down (Fox, live, Nov 2026): never on a Historic City of the same level or higher, so only
    // Atlantis (18) reaches a state capital (16). (The message is ours: live's words UNVERIFIED.)
    const targetLevel = dc ? this.level(dc) : tile.historic?.level || 0;
    if (targetLevel && targetLevel >= this.level(c)) return [-1, `Policies can only be used on cities below your Historic City's level (${this.level(c)}); that is a level ${targetLevel} Historic City.`];
    // One policy a lord's city every rules.policies.targetHours (24), whoever issues it; NPC cities any number.
    const key = dc ? `c${dc.id}` : null, wait = key ? this.targetWait(key, now) : 0;
    if (wait > 0) return [-1, `${dc.name} has already had a policy used on it in the last ${this.rules.targetHours} hours. Try again in ${wait >= 3600e3 ? `${Math.ceil(wait / 3600e3)} hours` : `${Math.ceil(wait / 60e3)} minutes`}.`];
    g.logic.settle(c, p, now);
    const share = this.share(kind), stores = dc ? dc.res : st.res || {}, troops = dc ? dc.troops : st.troops || {};
    let amount = 0, armyType = '';
    if (kind === 'tax' || kind === 'food'){
      const res = kind === 'tax' ? 'gold' : 'food';
      amount = Math.floor((stores[res] || 0) * share);
      stores[res] = (stores[res] || 0) - amount; c.res[res] = (c.res[res] || 0) + amount;
    } else if (kind === 'population'){
      amount = Math.floor((dc ? this.idle(dc) : g.npc.survey(tile).population) * share);
      if (dc) dc.pop -= amount;
      c.pop = (c.pop || 0) + amount;
    } else {
      const field = this.taken(troops);
      if (!field){ c.policies = { day: this.today(now), used: this.used(c, now) + 1 }; g.store.touch(); return [-1, this.noTroops(kind)]; }
      amount = Math.floor(troops[field] * share); armyType = this.troopName(field);
      troops[field] -= amount;
      if (kind === 'draft') c.troops[field] = addTroops(c.troops[field], amount);
    }
    c.policies = { day: this.today(now), used: this.used(c, now) + 1 };
    if (key) this.markTarget(key, now);
    if (st) g.npc.save(g.db, tile, st, now);
    const here = g.armies.placeName(target), what = this.what(kind, amount, armyType);
    if (dc && dp) g.security.activity({ type: 'policy', ids: [p.id, dp.id], from: dp.name, fromCity: dc.name, fromCityId: dc.id, to: p.name, toCity: c.name, toCityId: c.id,
      policy: k.name, amount, what: kind === 'tax' ? 'gold' : kind === 'food' ? 'food' : kind === 'population' ? 'population' : armyType }, now);
    if (dc){
      g.pushResources(dc); g.pushTroops(dc);
      g.reports.add(dp, { type: REPORT_TYPE.OTHER, startPos: g.armies.placeName(c.fieldId), targetPos: here, title: `${p.name} used ${k.name} on ${dc.name}`,
        content: `<reportData><policyReport detail="${esc(`${p.name} issued ${k.name} from ${c.name} on your city ${dc.name}: ${what.lost}.`)}"/></reportData>` });
    }
    g.reports.add(p, { type: REPORT_TYPE.OTHER, startPos: g.armies.placeName(c.fieldId), targetPos: here, title: `${k.name} on ${here}`,
      content: `<reportData><policyReport detail="${esc(`${k.name} from ${c.name} on ${here}: ${what.got}.`)}"/></reportData>` });
    g.store.touch(); g.pushResources(c); g.pushTroops(c);
    g.log.info(`${p.name} used ${k.name} from ${c.name} on ${here}: ${what.got}`);
    return { amount, armyType, castleId: c.id, targetFieldId: target };
  }
  what(kind, n, type){
    const N = n.toLocaleString('en-US');
    return {
      tax: { got: `acquired ${N} gold`, lost: `${N} gold taken` },
      population: { got: `${N} people moved here`, lost: `${N} people taken` },
      food: { got: `acquired ${N} food`, lost: `${N} food taken` },
      draft: { got: `${N} ${type} joined the army`, lost: `${N} ${type} taken` },
      disarm: { got: `${N} ${type} disbanded`, lost: `${N} ${type} disbanded` },
    }[kind];
  }
}
const esc = s => String(s).replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));

module.exports = { Policies, POLICY_KIND: KIND, LEVEL_OF_POWER };
