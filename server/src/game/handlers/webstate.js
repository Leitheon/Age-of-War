'use strict';
// The web client's heartbeat. Every 5 seconds it sends common.step and takes the answer as the lord's current state:
// his cities (whole), items, armies, wars, buffs, coins, unread reports and mail, truce, and the city order he set.
module.exports = (game, H) => {
  const ORDER = /^\d+(,\d+)*$/;
  const state = (p, now) => {
    const b = game.beans, castles = game.castlesOf(p);
    const truceUntil = Math.max(0, p.buffs?.PlayerPeaceBuff || 0);
    return {
      serverTime: now, castles: castles.map(c => b.castle(c, p)), cityOrder: p.cityOrder || '',
      items: game.items.itemBeans(p), selfArmys: game.armies.beans(p), enemyArmys: game.armies.enemies(p),
      declaredWarBeans: game.war.beans(p, now), playerBuffs: game.items.buffBeans(p, now),
      ...b.reportCounts(p), ...b.mailCounts(p),
      coins: p.coins || 0, boundGold: Math.floor(p.boundGold || 0),
      playerState: truceUntil > now ? 1 : game.war.beginner(p, now) ? 2 : 0,
      truceUntil: truceUntil > now ? truceUntil : 0, truceCooldownUntil: Math.max(0, p.truceCooldownUntil || 0),
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
