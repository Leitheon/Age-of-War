'use strict';
// The web client's two automations, each per city and running on the server while the lord is away:
//
// Troop Goals (troopgoal.*): up to 20 batches of target counts, each with a priority. The lowest-numbered batch not
//   yet met is the running one (with any others of the same priority); each troop type short of the target (in the
//   city, marching and queued together) gets an even share of what the city can pay for, across its Barracks.
//
// Coordinated Attacks (automation.*): an attack preset (troops of each type) for each valley level and NPC city
//   level, and the levels ticked to farm. While it's on, each free army slot of the Rally Spot sends the preset with
//   a free hero (not one left out) at the nearest unheld valley (of the types allowed) or NPC city of a ticked level.
//   Its reports go to the Automation tab (or nowhere, with No Report), a valley it takes can be given up at once,
//   and it finds less treasure (rules.automation.dropShare).
//
// Troop arrays are 12 long in the client's order (troopOrder below), not by type id.
const world = require('../world');
const { HERO_STATUS } = require('../heroes');

const ORDER = [2, 3, 4, 5, 6, 7, 9, 10, 8, 11, 12, 13];          // Worker, Warrior, Scout, Pikeman, Swordsman, Archer, Cavalry, Cataphract, Transporter, Ballista, Ram, Catapult
const VALLEY_TYPES = [1, 2, 3, 4, 5, 6, 10];
const BATCHES = 20, MAX_TROOPS = 99999999, MAX_PRESET = 9999999;
const OCCUPY = 5;

module.exports = (game, H) => {
  const data = game.data, field = t => data.troops[t].field;
  const int = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  const row12 = (v, max) => ORDER.map((_, i) => int(Array.isArray(v) ? v[i] : 0, max));
  const cfg = () => game.rules.automation || {};

  // ---------- troop goals ----------
  const goal = c => c.troopGoal || (c.troopGoal = { batches: [], useWorkingPop: false, enabled: false });
  const counts = c => {
    const q = game.troops.queues(c), out = { inCity: [], queued: [], marching: [], training: [] };
    const away = game.armies.fromCastle(c);
    ORDER.forEach((t, i) => {
      const f = field(t);
      out.inCity[i] = Math.max(0, Math.floor(c.troops[f] || 0));
      out.queued[i] = Object.values(q).reduce((s, list) => s + list.filter(x => x.type === t).reduce((a, x) => a + (x.num || 0), 0), 0);
      out.marching[i] = away.reduce((s, a) => s + (a.troops?.[f] || 0), 0);
      out.training[i] = Object.values(q).some(list => list[0]?.type === t);
    });
    return out;
  };
  // The running priority: the lowest priority number with a batch not yet met (in the city, marching and queued
  // together). Batches of the same priority run together; for each troop type the highest of their targets counts.
  const running = (c, n = counts(c)) => {
    const have = i => n.inCity[i] + n.marching[i] + n.queued[i];
    const live = goal(c).batches.filter(b => b.targets.some(x => x > 0)).sort((a, b) => a.priority - b.priority);
    const first = live.find(b => b.targets.some((x, i) => have(i) < x));
    if (!first) return null;
    const same = live.filter(b => b.priority === first.priority);
    return { priority: first.priority, targets: ORDER.map((_, i) => Math.max(...same.map(b => b.targets[i] || 0))) };
  };
  // How many of a troop type the city can pay for now.
  const affordable = (c, p, typeId) => {
    const one = game.troops.condition(c, p, typeId, 1);
    let n = Infinity;
    for (const k of ['food', 'wood', 'stone', 'iron', 'gold']) if (one[k] > 0) n = Math.min(n, Math.floor((c.res[k] || 0) / one[k]));
    if (one.population > 0) n = Math.min(n, Math.floor((c.pop || 0) / one.population));
    return Number.isFinite(n) ? n : 0;
  };
  // Each type short of its target gets an even share of what the city can pay for, spread evenly across the
  // Barracks with room in their queues (as a manual order with "Distribute evenly" would be).
  const trainTick = (c, p, now) => {
    const g = goal(c);
    if (!g.enabled) return;
    const n = counts(c), b = running(c, n);
    if (!b) return;
    const short = ORDER.map((t, i) => ({ t, need: b.targets[i] - (n.inCity[i] + n.marching[i] + n.queued[i]) })).filter(x => x.need > 0);
    let queued = false;
    for (const [k, x] of short.entries()){
      const share = Math.floor(affordable(c, p, x.t) / (short.length - k));
      const num = Math.min(x.need, share);
      if (num <= 0) continue;
      const err = game.troops.produce(c, p, 0, x.t, num, now, false);
      if (err && /full|busy/i.test(err[1])) break;   // every Barracks' queue is full
      if (!err) queued = true;
    }
    if (queued){ game.store.touch(); game.pushResources(c); }
  };

  const goalReply = c => {
    const g = goal(c), n = counts(c), b = running(c, n);
    return { batches: g.batches, troopOrder: ORDER, useWorkingPop: !!g.useWorkingPop, enabled: !!g.enabled, running: g.enabled && b ? b.priority : 0, ...n };
  };
  H['troopgoal.getConfig'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (c) game.reply(conn, cmd, goalReply(c)); };
  H['troopgoal.saveConfig'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    if (!Array.isArray(d.batches) || d.batches.length > BATCHES) return game.fail(conn, cmd, -1, `Up to ${BATCHES} batches.`);
    const batches = d.batches.map((b, i) => ({ priority: Math.max(1, Math.min(BATCHES, Math.floor(Number(b?.priority)) || i + 1)), targets: row12(b?.targets, MAX_TROOPS) }));
    const cities = d.applyAll ? game.castlesOf(conn.player) : [c];
    for (const x of cities){ const g = goal(x); g.batches = batches.map(b => ({ ...b, targets: [...b.targets] })); g.useWorkingPop = !!d.useWorkingPop; }
    game.store.touch();
    game.reply(conn, cmd, { applied: cities.length, ...goalReply(c) });
  };
  H['troopgoal.setEnabled'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const g = goal(c);
    if (d.enabled && !game.troops.barracks(c).length) return game.fail(conn, cmd, -30, 'Build a Barracks first.');
    g.enabled = !!d.enabled; game.store.touch();
    if (g.enabled) trainTick(c, conn.player, game.now());
    game.reply(conn, cmd, { enabled: g.enabled, running: goalReply(c).running });
  };

  // ---------- coordinated attacks ----------
  const auto = c => c.automation || (c.automation = { valley: [], npc: [], checked: [], autoAbandonValley: false, noReport: false, enabled: false, excluded: [] });
  const presetOf = (a, slot) => slot < 10 ? row12(a.valley[slot], MAX_PRESET) : row12(a.npc[slot - 10], MAX_PRESET);
  const sum = r => r.reduce((s, x) => s + x, 0);
  const autoReply = (c, p) => {
    const a = auto(c);
    return { valley: Array.from({ length: 10 }, (_, i) => row12(a.valley[i], MAX_PRESET)), npc: Array.from({ length: 10 }, (_, i) => row12(a.npc[i], MAX_PRESET)),
      checked: Array.from({ length: 20 }, (_, i) => (a.checked[i] ? 1 : 0)), autoAbandonValley: !!a.autoAbandonValley, noReport: !!a.noReport, enabled: !!a.enabled,
      marchLimit: game.armies.rallyLevel(c) ? game.armies.troopLimit(c, p, false, game.now()) : 0,
      heroes: game.heroes.list(c).filter(h => h.status !== HERO_STATUS.SEIZED).map(h => ({ id: h.id, name: h.name, level: h.level, excluded: (a.excluded || []).includes(h.id) })),
      valleyTypesOff: p.autoValleyTypesOff || [] };
  };
  H['automation.getConfig'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (c) game.reply(conn, cmd, autoReply(c, conn.player)); };
  H['automation.saveConfig'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const a = auto(c), p = conn.player;
    if (Array.isArray(d.valley)) a.valley = Array.from({ length: 10 }, (_, i) => row12(d.valley[i], MAX_PRESET));
    if (Array.isArray(d.npc)) a.npc = Array.from({ length: 10 }, (_, i) => row12(d.npc[i], MAX_PRESET));
    if (Array.isArray(d.checked)) a.checked = Array.from({ length: 20 }, (_, i) => !!Number(d.checked[i]));
    if (d.autoAbandonValley !== undefined) a.autoAbandonValley = !!d.autoAbandonValley;
    if (d.noReport !== undefined) a.noReport = !!d.noReport;
    if (Array.isArray(d.valleyTypesOff)) p.autoValleyTypesOff = [...new Set(d.valleyTypesOff.map(Number).filter(t => VALLEY_TYPES.includes(t)))];
    // A ticked level needs a preset, within the march limit.
    const limit = game.armies.rallyLevel(c) ? game.armies.troopLimit(c, p, false, game.now()) : 0;
    a.checked = a.checked.map((on, i) => on && sum(presetOf(a, i)) > 0 && (!limit || sum(presetOf(a, i)) <= limit));
    game.store.touch();
    game.reply(conn, cmd, autoReply(c, p));
  };
  H['automation.setEnabled'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const a = auto(c);
    if (d.enabled){
      if (!game.armies.rallyLevel(c)) return game.fail(conn, cmd, -13, 'Build a Rally Spot to send armies.');
      if (!a.checked.some(Boolean)) return game.fail(conn, cmd, -1, 'Tick at least one target with a preset first.');
    }
    a.enabled = !!d.enabled; game.store.touch();
    game.log.info(`${conn.player.name}: Coordinated Attacks ${a.enabled ? 'on' : 'off'} in ${c.name}`);
    game.reply(conn, cmd, { enabled: a.enabled });
  };
  H['automation.setHeroExcluded'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const a = auto(c), id = Number(d.heroId);
    if (!game.heroes.find(c, id)) return game.fail(conn, cmd, -1, 'That hero isn\'t in this city.');
    a.excluded = (a.excluded || []).filter(x => x !== id);
    if (d.excluded) a.excluded.push(id);
    game.store.touch(); game.reply(conn, cmd, { heroId: id, excluded: !!d.excluded });
  };

  // The nearest target for one of the ticked slots the city has the troops for, searching rings outward.
  const findTarget = (c, p, a, now) => {
    const limit = game.armies.troopLimit(c, p, false, now), off = new Set(p.autoValleyTypesOff || []);
    const ready = Array.from({ length: 20 }, (_, i) => {
      if (!a.checked[i]) return null;
      const pre = presetOf(a, i), n = sum(pre);
      if (!n || n > limit || pre.some((x, k) => x > (c.troops[field(ORDER[k])] || 0))) return null;
      return pre;
    });
    if (!ready.some(Boolean)) return null;
    const taken = new Set(Object.values(game.armies.list()).filter(x => x.playerId === p.id).map(x => x.target));
    const { x: cx, y: cy } = world.xy(c.fieldId), R = Math.max(1, Math.min(60, Number(cfg().radius) || 25));
    for (let r = 1; r <= R; r++){
      const ring = [];
      for (let dx = -r; dx <= r; dx++) for (const dy of (Math.abs(dx) === r ? Array.from({ length: 2 * r + 1 }, (_, k) => k - r) : [-r, r])) ring.push([dx, dy]);
      ring.sort((u, v) => (u[0] ** 2 + u[1] ** 2) - (v[0] ** 2 + v[1] ** 2));
      for (const [dx, dy] of ring){
        const id = world.idOf(cx + dx, cy + dy);
        if (taken.has(id)) continue;
        const t = world.tileAt(game.store, id, now);
        let slot = -1;
        if (t.type === world.T.NPC && !t.historic && t.level >= 1 && t.level <= 10) slot = 9 + t.level;
        else if (VALLEY_TYPES.includes(t.type) && !t.ownerCastle && !t.castleId && !off.has(t.type) && t.level >= 1 && t.level <= 10
          && (t.type !== world.T.FLAT || game.rules.flatsConquerable)) slot = t.level - 1;
        if (slot >= 0 && ready[slot]) return { id, slot, preset: ready[slot] };
      }
    }
    return null;
  };
  const attackTick = (c, p, now) => {
    const a = auto(c);
    if (!a.enabled) return;
    const rally = game.armies.rallyLevel(c);
    if (!rally || game.armies.fromCastle(c).length >= rally * game.rules.rallyArmiesPerLevel) return;
    const hero = game.heroes.list(c).find(h => h.status === HERO_STATUS.FREE && !(a.excluded || []).includes(h.id));
    if (!hero) return;
    const target = findTarget(c, p, a, now);
    if (!target) return;
    const troops = {}; target.preset.forEach((n, i) => { if (n > 0) troops[field(ORDER[i])] = n; });
    const r = game.armies.send(c, p, { missionType: OCCUPY, targetPoint: target.id, heroId: hero.id, troops }, now);
    if (Array.isArray(r)){ game.log.debug?.(`Coordinated Attacks from ${c.name}: ${r[1]}`); return; }
    r.army.auto = { noReport: !!a.noReport, abandon: !!a.autoAbandonValley };
    game.store.touch();
    game.pushTroops(c); game.pushHero(c, r.hero || hero, 2); game.pushArmies(p);
  };

  // Every few seconds: each city's troop goals, then one attack per city with automation on.
  let last = 0;
  game.webTick = now => {
    if (now >= last && now - last < (Number(cfg().tickMs) || 5000)) return;   // (and if the clock went back, carry on)
    last = now;
    for (const c of Object.values(game.db.castles)){
      const p = game.db.players[c.playerId];
      if (!p || p.banned) continue;
      try { trainTick(c, p, now); attackTick(c, p, now); }
      catch (e){ game.log.error(`automation in ${c.name}: ${e.stack || e.message}`); }
    }
  };
};
