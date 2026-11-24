'use strict';
// Shop: buying with coins, using items (chests, the Wheel of Fortune, buffs, city items). (Gift packages: friends.js.)
const { REPORT_TYPE } = require('../reports');
const world = require('../world');
const { CITY_TOKENS } = require('../itemUse');

module.exports = (game, H) => {
  // Items the client doesn't know (or knows differently): historic heroes added or changed by the sheet. Live sends
  // its newer items this way; with nothing to add the list is empty.
  H['common.getItemDefXml'] = (conn, d, cmd) => game.reply(conn, cmd, { itemXml: game.hh?.itemXml() || '<?xml version="1.0" encoding="UTF-8"?><itemdef><items/><special/><special2/></itemdef>' });
  H['shop.buy'] = (conn, d, cmd) => {
    const p = conn.player, err = game.items.buy(p, d.itemId, d.amount);
    if (err) return game.fail(conn, cmd, err[0], err[1]);
    game.store.touch();
    game.reply(conn, cmd, {});
    game.pushItems(p, [d.itemId]);
    game.pushPlayerInfo(p);
  };
  // After an item is used: tell the client everything that changed.
  const after = (conn, c, out, had, itemId) => {
    const p = conn.player;
    if (out.items.size) game.pushItems(p, [...out.items]);
    if (out.buffs) game.pushBuffs(p, had);
    if (out.coins || out.player) game.pushPlayerInfo(p);
    if (out.troops) game.pushTroops(c);
    for (const h of out.heroes) game.pushHero(c, h, 0);
    // A new city: the client asks for its name when an ordinary city (power level 4, as an amulet city is) arrives.
    if (out.newCastle){ game.push(p.id, 'server.CastleUpdate', { updateType: 0, castleBean: game.beans.castle(out.newCastle, p) }); game.pushPlayerInfo(p); }
    game.pushResources(c);
    // The award window can't show troops, heroes or new cities, so those get a report.
    if (out.troopText.length || out.note){
      const name = game.data.items[itemId]?.name || itemId;
      const lines = [out.note, out.troopText.length ? `${out.troopText.join(', ')} joined the army in ${c.name}.` : ''].filter(Boolean);
      game.reports.add(p, { type: REPORT_TYPE.OTHER, title: `${name}: ${out.text.length ? out.text.join(', ') : 'opened'}`.slice(0, 120), content: lines.join(' ') });
    }
    if (out.text.length) game.log.info(`${p.name} used ${game.data.items[itemId]?.name || itemId}: ${out.text.join(', ')}`);
  };
  H['shop.useGoods'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, now = game.now(), had = game.activeBuffs(p, now);
    const out = game.itemUse.use(p, c, d.itemId, now);
    if (Array.isArray(out)) return game.fail(conn, cmd, out[0], out[1]);
    game.store.touch();
    game.reply(conn, cmd, { itemBeans: game.itemUse.replyBeans(p, d.itemId, out), gamblingItemsBeans: out.wheel || [] });
    after(conn, c, out, had, d.itemId);
  };
  H['shop.useCastleGoods'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, now = game.now(), had = game.activeBuffs(p, now);
    const out = game.itemUse.useOnCastle(p, c, d.itemId, now);
    if (Array.isArray(out)) return game.fail(conn, cmd, out[0], out[1]);
    game.store.touch();
    game.reply(conn, cmd, {});
    after(conn, c, out, had, d.itemId);
  };
  // Angel items on another lord, Devil items on a city (charms.js).
  const charm = r => (conn, d, cmd) => {
    const p = conn.player, out = r(p, d);
    if (Array.isArray(out)) return game.fail(conn, cmd, out[0], out[1]);
    game.reply(conn, cmd, {});
    game.pushItems(p, out.items);
  };
  H['shop.useAngelItem'] = charm((p, d) => game.charms.useAngel(p, String(d.itemId || ''), d.playername, game.now()));
  const devil = charm((p, d) => game.charms.useDevil(p, String(d.itemId || ''), d.x, d.y, d.paramdata, game.now()));
  // The web client sends a Bronze, Silver or Gold Amulet here too, with the Target X and Y it asks for: the new city
  // is founded there (itemUse.cityToken).
  H['shop.useDevilItem'] = (conn, d, cmd) => {
    const itemId = String(d.itemId || ''), p = conn.player;
    if (!CITY_TOKENS[itemId]) return devil(conn, d, cmd);
    const c = game.castleFor(conn, d.castleId) || game.castlesOf(p)[0]; if (!c) return game.fail(conn, cmd, -30, 'You have no city.');
    if (!game.items.has(p, itemId)) return game.fail(conn, cmd, -44, `You don't have a ${game.items.name(itemId)}.`);
    const x = Math.floor(Number(d.x)), y = Math.floor(Number(d.y));
    if (!(x >= 0 && x < world.SIZE && y >= 0 && y < world.SIZE)) return game.fail(conn, cmd, -13, `Enter a spot on the map: X and Y from 0 to ${world.SIZE - 1}.`);
    const now = game.now(), had = game.activeBuffs(p, now), out = game.itemUse.use(p, c, itemId, now, undefined, { fieldId: world.idOf(x, y) });
    if (Array.isArray(out)) return game.fail(conn, cmd, out[0], out[1]);
    game.store.touch();
    game.reply(conn, cmd, { castleId: out.newCastle?.id, x, y });
    after(conn, c, out, had, itemId);
  };
  // Buying resources with cents (the city window's Buy button, GoldBuyResourceWin): "1 cent game coin(s) = N Food",
  // up to so much of each a day in each city ("For sale"). Rates and daily amounts: rules.buyResources (UNVERIFIED).
  const KINDS = ['food', 'wood', 'stone', 'iron'];
  const bought = (c, now) => { const day = game.npc.day(now); if (!c.bought || c.bought.day !== day) c.bought = { day, food: 0, wood: 0, stone: 0, iron: 0 }; return c.bought; };
  const R = () => game.rules.buyResources || {};
  const left = (c, k, now) => Math.max(0, (R().daily?.[k] ?? 0) - bought(c, now)[k]);
  H['shop.getBuyResourceInfo'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const now = game.now(), per = R().perCent || {};
    game.reply(conn, cmd, { buyResourceBean: { forFood: per.food || 0, forWood: per.wood || 0, forStone: per.stone || 0, forIron: per.iron || 0,
      foodRemain: left(c, 'food', now), woodRemain: left(c, 'wood', now), stoneRemain: left(c, 'stone', now), ironRemain: left(c, 'iron', now) } });
  };
  H['shop.buyResource'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, now = game.now(), per = R().perCent || {};
    const use = { food: d.foodUse, wood: d.woodUse, stone: d.stoneUse, iron: d.ironUse }, spend = {};
    let total = 0;
    for (const k of KINDS){
      const n = Math.floor(Number(use[k]) || 0);
      if (n < 0) return game.fail(conn, cmd, -1, 'Amounts cannot be negative.');
      if (n && n * (per[k] || 0) > left(c, k, now)) return game.fail(conn, cmd, -1, `${c.name} can buy only ${left(c, k, now).toLocaleString('en-US')} more ${k === 'wood' ? 'lumber' : k} today.`);
      if (n){ spend[k] = n; total += n; }
    }
    if (!total) return game.fail(conn, cmd, -1, 'No Resources Purchased.');
    if ((p.coins || 0) < total) return game.fail(conn, cmd, -28, `That costs ${total.toLocaleString('en-US')} cents; you have ${(p.coins || 0).toLocaleString('en-US')}.`);
    game.logic.settle(c, p, now);
    const b = bought(c, now);
    for (const [k, n] of Object.entries(spend)){ const got = n * (per[k] || 0); c.res[k] += got; b[k] += got; }
    p.coins -= total;
    game.store.touch();
    game.reply(conn, cmd, {});
    game.pushResources(c); game.pushPlayerInfo(p);
    game.log.info(`${p.name} bought resources for ${total} cents in ${c.name}`);
  };
  // Wheel of Fortune billboard: spins per lord today / yesterday.
  const board = day => Object.values(game.db.players).map(p => ({ p, n: p.spins?.[day] || 0 })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 20)
    .map((x, i) => ({ rank: i + 1, playerName: x.p.name, count: x.n, isReward: 0, itemsBeans: [] }));
  const day = off => new Date(game.now() - off * 86400000).toISOString().slice(0, 10);
  H['gamblingranking.getGamblingRankingToday'] = (conn, d, cmd) => game.reply(conn, cmd, { gamblingRankingBeans: board(day(0)), pageNo: 1, totalPage: 1 });
  H['gamblingranking.getGamblingRankingYesterday'] = (conn, d, cmd) => game.reply(conn, cmd, { gamblingRankingBeans: board(day(1)), pageNo: 1, totalPage: 1 });
  H['gamblingranking.getGamblingRankingReward'] = (conn, d, cmd) => game.fail(conn, cmd, -1, 'There are no billboard rewards on this server.');
};
