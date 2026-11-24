'use strict';
const { centsRate, centsText } = require('../nocents');
// The web client's shop: tabs of items priced in gold, bought with the gold of all the lord's cities together
// (shop.buyPooled), account-bound gold spent first. Prices are each item's coin price in the client's item table
// times rules.webShop.goldPerCoin. Tabs by the item table's types (Fox: no Hot tab, and Treasure is "Items"). Items in
// rules.webShop.hidden are neither listed nor sold.
const TABS = [['宝物', 'Items'], ['加速', 'Speed Up'], ['生产', 'Produce'], ['宝箱', 'Chests'], ['计谋', 'Stratagems'], ['材料', 'Materials']];

module.exports = (game, H) => {
  const rate = () => Number(game.rules.webShop?.goldPerCoin) > 0 ? Number(game.rules.webShop.goldPerCoin) : 10000;
  const priceOf = it => Math.round(it.price * rate());
  const text = s => { const r = centsRate(game.rules); return r ? centsText(s, r) : s; };   // (no cents: nocents.js)
  const ware = it => ({ id: it.id, name: text(String(it.name || it.id).trim()), icon: it.icon || '', price: priceOf(it), desc: text(String(it.desc || '').trim()) });
  const hidden = () => new Set(game.rules.webShop?.hidden || []);
  const sells = (it, off = hidden()) => !!it && it.price > 0 && !/^hero\.taskitem\./.test(it.id) && !off.has(it.id);
  const forSale = () => { const off = hidden(); return Object.values(game.data.items).filter(i => sells(i, off)); };

  H['shop.getCatalog'] = (conn, d, cmd) => {
    const all = forSale(), tabs = [];
    for (const [id, name] of TABS){
      const items = all.filter(i => i.type === id);
      if (items.length) tabs.push({ id, name, items: items.map(ware) });
    }
    game.reply(conn, cmd, { tabs, halloweenEnabled: false });
  };

  // Gold from every city, the account-bound gold first, then the richest city's.
  H['shop.buyPooled'] = (conn, d, cmd) => {
    const p = conn.player, it = game.data.items[String(d.itemId || '')], n = Math.floor(Number(d.amount));
    if (!sells(it)) return game.fail(conn, cmd, -44, 'That item is not for sale.');
    if (!(n > 0) || n > 9999) return game.fail(conn, cmd, -40, 'Choose how many to buy.');
    const now = game.now(), castles = game.castlesOf(p);
    for (const c of castles) game.logic.settle(c, p, now);
    const cost = priceOf(it) * n, bound = Math.floor(p.boundGold || 0);
    const have = bound + castles.reduce((s, c) => s + Math.floor(c.res?.gold || 0), 0);
    if (have < cost) return game.fail(conn, cmd, -28, `That costs ${cost.toLocaleString('en-US')} gold; your cities have ${have.toLocaleString('en-US')}.`);
    let left = cost;
    const fromBound = Math.min(bound, left); p.boundGold = bound - fromBound; left -= fromBound;
    const touched = [];
    for (const c of [...castles].sort((a, b) => (b.res?.gold || 0) - (a.res?.gold || 0))){
      if (left <= 0) break;
      const take = Math.min(Math.floor(c.res.gold || 0), left);
      if (take > 0){ c.res.gold -= take; left -= take; touched.push(c); }
    }
    game.items.add(p, it.id, n);
    game.store.touch();
    game.log.info(`${p.name} bought ${n} ${String(it.name).trim()} for ${cost} gold`);
    game.reply(conn, cmd, { itemId: it.id, count: p.items[it.id] });
    game.pushItems(p, [it.id]);
    for (const c of touched) game.pushResources(c);
  };

  H['shop.buyHalloween'] = (conn, d, cmd) => game.fail(conn, cmd, -1, 'The Halloween shop is closed.');
};
