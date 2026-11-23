'use strict';
// Finishing work with gold: the web client's "Pay with Gold" in its speed-up window sends itemId gold.speed to any
// speed-up command. It costs what finishing with coins would (items.coinsFor, the Guidelines' shop prices) times
// rules.webShop.goldPerCoin, the shop's rate, so it's the same as buying the speed-ups in the shop. Paid like the
// shop: the account-bound gold first, then the city doing the work, then the others, richest first.
// rules.webShop.goldFinish: false turns it off (the client then shows no Pay with Gold row: /welcome.js).
const GOLD = 'gold.speed';
const CMDS = ['castle.speedUpBuildCommand', 'castle.speedupBuildingQueue', 'tech.speedUpResearch', 'troop.accTroopProduce', 'fortifications.accTroopProduce'];

module.exports = (game, H) => {
  game.goldFinishRate = () => game.rules.webShop?.goldFinish === false ? 0 : Number(game.rules.webShop?.goldPerCoin) || 0;

  // The city whose work is being sped up, for paying from it first.
  let here = null;
  for (const cmd of CMDS){
    const orig = H[cmd]; if (!orig) continue;
    H[cmd] = (conn, d, c) => { here = game.db.castles[d?.castleId] || null; try { return orig(conn, d, c); } finally { here = null; } };
  }
  const pooled = p => {
    const now = game.now(), cs = game.castlesOf(p);
    for (const c of cs) game.logic.settle(c, p, now);
    return Math.floor(p.boundGold || 0) + cs.reduce((s, c) => s + Math.floor(c.res?.gold || 0), 0);
  };
  const pay = (p, gold, from) => {
    let left = gold;
    const bound = Math.floor(p.boundGold || 0), b = Math.min(bound, left);
    p.boundGold = bound - b; left -= b;
    const cs = game.castlesOf(p), first = from && cs.includes(from) ? [from] : [];
    const touched = [];
    for (const c of [...first, ...cs.filter(x => x !== from).sort((x, y) => (y.res?.gold || 0) - (x.res?.gold || 0))]){
      if (left <= 0) break;
      const take = Math.min(Math.floor(c.res.gold || 0), left);
      if (take > 0){ c.res.gold -= take; left -= take; touched.push(c); }
    }
    game.store.touch();
    for (const c of touched) game.pushResources(c);
    game.log.info(`${p.name} finished work for ${gold.toLocaleString('en-US')} gold`);
  };

  // The speed-up commands all ask items.speedup what an itemId does; gold.speed finishes, and is paid for when the
  // command applies it (reduce), so a command that then refuses costs nothing.
  const speedup = game.items.speedup.bind(game.items);
  game.items.speedup = (p, itemId, left, coins, table) => {
    if (itemId !== GOLD) return speedup(p, itemId, left, coins, table);
    const rate = game.goldFinishRate();
    if (!rate) return { err: 'Finishing with gold is turned off on this server.' };
    if (!(left > 0)) return { err: 'There is nothing left to finish.' };
    const gold = Math.max(1, coins) * rate, have = pooled(p), from = here;
    if (have < gold) return { err: `Finishing now costs ${gold.toLocaleString('en-US')} gold; your cities have ${have.toLocaleString('en-US')}.` };
    let paid = false;
    return { reduce: () => { if (!paid){ paid = true; pay(p, gold, from); } return 0; } };
  };
};
