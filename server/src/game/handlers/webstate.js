'use strict';
// The web client's heartbeat. Every 5 seconds it sends common.step and takes the answer as the lord's current state:
// his cities (whole), items, armies, wars, buffs, coins, unread reports and mail, truce, and the city order he set.
const { EFFORT_BUFF } = require('../effort');
const DAY = 86400000;
// The achievements' bonuses (effort.js), which the web client keeps off its buff bar under their own names: under the
// client's Ach* names it shows them, with what each does at the lord's level. [Ach name, bonus key, text]
const ACH = {
  gold: ['AchGoldBuff', 'Gold income +N%'], food: ['AchFoodBuff', 'Food production +N%'], wood: ['AchWoodBuff', 'Lumber production +N%'],
  stone: ['AchStoneBuff', 'Stone production +N%'], iron: ['AchIronBuff', 'Iron production +N%'], infantry: ['AchInfantryBuff', 'Infantry training cost -N%'],
  cavalry: ['AchCavalryBuff', 'Cavalry training cost -N%'], machine: ['AchMechanicsBuff', 'Siege engine training cost -N%'], build: ['AchConstructBuff', 'Construction cost -N%'],
  grievance: ['AchGrievanceBuff', 'Grievance fades N% faster'], drops: ['AchTreasureBuff', 'Treasure from battles +N%'], wounded: ['AchWoundedBuff', 'Troops wounded instead of killed +N%'],
};
const ACH_OF = Object.fromEntries(Object.entries(EFFORT_BUFF).map(([key, typeId]) => [typeId, [...ACH[key], key]]));
module.exports = (game, H) => {
  const ORDER = /^\d+(,\d+)*$/;
  // The buff bar (Fox, Nov 28 2026: "Players should be able to see the icon of all the buffs they have"): every timed
  // bonus, the achievements' bonuses, and a new lord's two builders for his first 72 hours (items.buildSlots), under
  // the Compass's icon until the later of the two ends. Lasting ones (achievements, a permanent Publicity Ambassador)
  // and hunger, which lasts until there's food, show without a countdown.
  const buffs = (p, now) => {
    const out = [];
    for (const x of game.items.buffBeans(p, now)){
      const ach = ACH_OF[x.typeId];
      if (ach){ out.push({ typeId: ach[0], descName: `Achievements: ${ach[1].replace('N', game.effort.bonus(p, ach[2]))}` }); continue; }
      const y = x.typeId === 'doubleBuilding' ? { ...x, typeId: 'DoubleBuildingBuff' } : { ...x };   // (the web client's icon for Gundulf's Compass)
      if (y.typeId === 'HungerBuff' || y.endTime - now > 365 * DAY) delete y.endTime;
      out.push(y);
    }
    const fresh = game.items.newLordDoubleUntil(p);
    if (fresh > now){
      const d = out.find(x => x.typeId === 'DoubleBuildingBuff');
      if (!d) out.push({ typeId: 'DoubleBuildingBuff', endTime: fresh, descName: `Two buildings at once (a new lord's first ${game.rules.newPlayerDoubleBuildHours ?? 72} hours)` });
      else if (d.endTime < fresh) d.endTime = fresh;
    }
    return out;
  };
  game.webBuffs = buffs;
  const state = (p, now) => {
    const b = game.beans, castles = game.castlesOf(p);
    // Protected: a Truce Agreement or a Dream Truce's window (to its end), else Beginner's Protection (with when it runs
    // out, for the buff bar; patch-buff-bar.py).
    const dream = game.account.dreamWindows(p).find(([a, e]) => now >= a && now < e);
    const truceUntil = Math.max(0, p.buffs?.PlayerPeaceBuff || 0, dream ? dream[1] : 0);
    const BP = game.rules.beginnerProtection || {}, protectUntil = truceUntil > now ? 0 : game.war.beginnerUntil(p, now);
    return {
      serverTime: now, castles: castles.map(c => b.castle(c, p)), cityOrder: p.cityOrder || '',
      items: game.items.itemBeans(p), selfArmys: game.armies.beans(p), enemyArmys: game.armies.enemies(p),
      declaredWarBeans: game.war.beans(p, now), playerBuffs: buffs(p, now),
      ...b.reportCounts(p), ...b.mailCounts(p),
      // (the web client's last tab is Other, where its Automation tab was: webreports.js)
      newReportCount_automation: game.reports.unread(p).other_count,
      coins: p.coins || 0, boundGold: Math.floor(p.boundGold || 0),
      playerState: truceUntil > now ? 1 : protectUntil ? 2 : 0,
      truceUntil: truceUntil > now ? truceUntil : 0, truceCooldownUntil: Math.max(0, p.truceCooldownUntil || 0),
      protectUntil, protectNote: protectUntil ? `Beginner's Protection: no one can attack or scout you until it runs out${BP.townHall ? `, or until one of your Town Halls reaches level ${BP.townHall}` : ''}` : '',
    };
  };
  game.webState = state;

  H['common.step'] = (conn, d, cmd) => {
    const p = conn.player, now = game.now();
    // (the Flash client's tutorial saved its step here; 999 is done)
    const n = Math.floor(Number(d.tutorialStepId));
    if (Number.isFinite(n) && n >= 0 && n <= 100000){ p.tutorialStep = n; game.store.touch(); }
    for (const c of game.castlesOf(p)){ game.completeDue(c, true); game.logic.settle(c, p, now); }
    game.reply(conn, cmd, state(p, now));
    // The first heartbeat comes once the game screen (and its chat) is up: the chat's recent lines then.
    if (!conn.chatBacklog){ conn.chatBacklog = true; game.chat.backlog(conn); }
  };

  // The order of the city list (dragged in the client): city ids, comma-separated.
  H['common.setCityOrder'] = (conn, d, cmd) => {
    const p = conn.player, mine = new Set(game.castlesOf(p).map(c => c.id));
    const order = String(d.order || '');
    if (order && (!ORDER.test(order) || order.split(',').some(id => !mine.has(Number(id))))) return game.fail(conn, cmd, -1, 'That isn\'t a list of your cities.');
    p.cityOrder = order; game.store.touch();
    game.reply(conn, cmd, { cityOrder: order });
  };
};
