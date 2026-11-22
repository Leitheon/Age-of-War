'use strict';
// The web client's market: resources traded between lords at the prices they set.
//
// An offer gives one resource (gold, wood, food, iron, stone) for another, and what it gives is held by the market
// from the moment it's posted. Posting first buys from the offers already there at the poster's price or better
// (cheapest first); what's left waits on the board, where any number of lords can take part of it until it's
// filled or cancelled. Goods travel: each side's share arrives at its city after rules.webMarket.deliveryMinutes
// (30), or at once with a Merchant Fleet. A city has as many open offers as its Marketplace's level.
//
// fill() is the client's own rounding (its Confirm Trade preview), so both always agree on a trade's amounts.
const RES = ['gold', 'wood', 'food', 'iron', 'stone'];
const MARKETPLACE = 23, FLEET = 'consume.transaction.1', MAX = 1e12;

// What a taker gets (take, of the offer's giveResource) and pays (pay, of its wantResource) offering to pay up to n.
function fill(o, n){
  const s = BigInt(o.giveAmount || 0), a = BigInt(o.wantAmount || 0), l = BigInt(o.filledGive || 0), r = BigInt(o.filledWant || 0), i = s - l, left = a - r;
  if (s <= 0n || a <= 0n) return { take: 0, pay: 0 };
  let c = BigInt(Math.max(0, Math.floor(Number(n) || 0)));
  if (c > left) c = left;
  let d = (r + c) * s / a - l;
  if (d > i) d = i;
  if (d <= 0n) return { take: 0, pay: 0 };
  const h = ((l + d) * a + s - 1n) / s;
  return h >= a ? { take: Number(i), pay: Number(left) } : { take: Number(d), pay: Number(h - r) };
}

module.exports = (game, H) => {
  const M = () => game.db.webMarket || (game.db.webMarket = { seq: 0, offers: [], shipments: [] });
  const cfg = () => game.rules.webMarket || {};
  const level = c => game.logic.level(c, MARKETPLACE);
  const limitOf = c => level(c) * (Number(cfg().offersPerLevel) || 1);
  const remaining = o => ({ remainingGive: o.giveAmount - o.filledGive, remainingWant: o.wantAmount - o.filledWant });
  const view = o => ({ id: o.id, playerName: o.playerName, cityName: o.cityName, giveResource: o.giveResource, giveAmount: o.giveAmount, wantResource: o.wantResource,
    wantAmount: o.wantAmount, filledGive: o.filledGive, filledWant: o.filledWant, ...remaining(o), createdAt: o.createdAt });
  // Cheapest for a taker first: the least of the wanted resource per unit given.
  const cheaper = (a, b) => (a.wantAmount * b.giveAmount) - (b.wantAmount * a.giveAmount) || a.id - b.id;
  const open = () => M().offers.filter(o => o.filledGive < o.giveAmount && o.filledWant < o.wantAmount);
  const touch = ids => { game.store.touch(); for (const id of new Set(ids)) game.push(id, 'server.TradesUpdate', {}); };

  // Goods on their way to a city.
  const ship = (playerId, castleId, resource, amount, now) => {
    if (amount <= 0) return;
    const m = M(), mins = Number(cfg().deliveryMinutes) || 30;
    m.shipments.push({ id: ++m.seq, playerId, castleId, resource, amount, endTime: now + Math.round(mins * 60000 / Math.max(1, game.logic.speed || 1)) });
  };
  const deliver = (sh, now) => {
    const c = game.db.castles[sh.castleId];
    M().shipments = M().shipments.filter(x => x !== sh);
    if (!c || c.playerId !== sh.playerId) return;   // (the city changed hands meanwhile)
    game.logic.settle(c, game.db.players[c.playerId], now);
    c.res[sh.resource] = (c.res[sh.resource] || 0) + sh.amount;
    game.pushResources(c);
    game.push(sh.playerId, 'server.TransingTradeUpdate', {});
  };
  // (called from the game's tick)
  const prevTick = game.webTick;
  let last = 0;
  game.webTick = now => {
    prevTick?.(now);
    if (now >= last && now - last < 1000) return;   // (and if the clock went back, carry on)
    last = now;
    const due = M().shipments.filter(s => s.endTime <= now);
    for (const s of due) deliver(s, now);
    if (due.length) game.store.touch();
  };

  // A taker in city c pays up to n of offer o's wanted resource (already taken from c).
  const trade = (o, c, p, n, now) => {
    const f = fill(o, n);
    if (!f.take || !f.pay) return f;
    o.filledGive += f.take; o.filledWant += f.pay;
    ship(p.id, c.id, o.giveResource, f.take, now);
    ship(o.playerId, o.castleId, o.wantResource, f.pay, now);
    return f;
  };

  H['market.getMarket'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, now = game.now();
    game.logic.settle(c, p, now);
    const fg = RES.includes(d.filterGive) ? d.filterGive : 'any', fr = RES.includes(d.filterReceive) ? d.filterReceive : 'any';
    // (the board is seen as the taker: "you give" is what an offer wants, "you receive" what it gives)
    const board = open().filter(o => o.playerId !== p.id && (fg === 'any' || o.wantResource === fg) && (fr === 'any' || o.giveResource === fr)
      && (!d.affordableOnly || (c.res[o.wantResource] || 0) >= remaining(o).remainingWant)).sort(cheaper);
    const pairs = new Map();
    for (const o of board){ const k = o.wantResource + '>' + o.giveResource; const g = pairs.get(k); if (g) g.pairCount++; else pairs.set(k, { ...view(o), pairCount: 1 }); }
    const cheapest = [...pairs.values()].sort((a, b) => RES.indexOf(a.wantResource) - RES.indexOf(b.wantResource) || RES.indexOf(a.giveResource) - RES.indexOf(b.giveResource));
    game.reply(conn, cmd, {
      orderLimit: limitOf(c), marketLevel: level(c), filterGive: fg, filterReceive: fr, affordableOnly: !!d.affordableOnly,
      cheapest, matches: board.slice(0, 200).map(view),
      myOffers: open().filter(o => o.castleId === c.id).sort((a, b) => b.id - a.id).map(view),
      shipments: M().shipments.filter(s => s.playerId === p.id).sort((a, b) => a.endTime - b.endTime).map(s => ({ ...s, cityName: game.db.castles[s.castleId]?.name || '' })),
    });
  };

  H['market.postOffer'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, now = game.now(), give = d.giveResource, want = d.wantResource;
    const gAmt = Math.floor(Number(d.giveAmount)), wAmt = Math.floor(Number(d.wantAmount));
    if (!RES.includes(give) || !RES.includes(want) || give === want) return game.fail(conn, cmd, -1, 'Give and receive must be different resources.');
    if (!(gAmt > 0) || !(wAmt > 0) || gAmt > MAX || wAmt > MAX) return game.fail(conn, cmd, -1, 'Enter an amount for both sides.');
    if (!level(c)) return game.fail(conn, cmd, -1, 'Build a Marketplace to trade.');
    if (open().filter(o => o.castleId === c.id).length >= limitOf(c)) return game.fail(conn, cmd, -1, `This Marketplace allows ${limitOf(c)} open offers. Upgrade it for more.`);
    game.logic.settle(c, p, now);
    if ((c.res[give] || 0) < gAmt) return game.fail(conn, cmd, -1, `You don't have ${gAmt.toLocaleString('en-US')} ${give}.`);
    c.res[give] -= gAmt;   // held by the market
    // Buy from offers at this price or better: they give what this one wants, for at most gAmt/wAmt of it each.
    let left = gAmt, got = 0, spent = 0, fills = 0; const touched = [p.id];
    for (const o of open().filter(o => o.playerId !== p.id && o.giveResource === want && o.wantResource === give && o.wantAmount * wAmt <= gAmt * o.giveAmount).sort(cheaper)){
      if (left <= 0 || got >= wAmt) break;
      // pay no more than what's left, nor more than buying the rest of what's wanted at this offer's price costs
      const restCost = Math.ceil((wAmt - got) * o.wantAmount / o.giveAmount);
      const f = trade(o, c, p, Math.min(left, restCost), now);
      if (!f.pay) continue;
      left -= f.pay; spent += f.pay; got += f.take; fills++; touched.push(o.playerId);
    }
    let offer = null;
    if (got < wAmt && left > 0){
      const m = M();
      offer = { id: ++m.seq, playerId: p.id, castleId: c.id, playerName: p.name, cityName: c.name, giveResource: give, giveAmount: left, wantResource: want,
        wantAmount: Math.max(1, wAmt - got), filledGive: 0, filledWant: 0, createdAt: now };
      m.offers.push(offer);
    } else c.res[give] += left;   // filled: what wasn't needed comes back
    M().offers = M().offers.filter(o => o.filledGive < o.giveAmount && o.filledWant < o.wantAmount);
    game.log.info(`${p.name} offered ${gAmt} ${give} for ${wAmt} ${want}${fills ? `: bought ${got} from ${fills} offer${fills > 1 ? 's' : ''}` : ''}`);
    touch(touched); game.pushResources(c);
    game.reply(conn, cmd, { matched: { fills, bought: got, spent }, offer: offer ? view(offer) : null });
  };

  H['market.acceptOffer'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, now = game.now(), o = open().find(x => x.id === Number(d.offerId));
    if (!o) return game.fail(conn, cmd, -1, 'that offer is no longer available');
    if (o.playerId === p.id) return game.fail(conn, cmd, -1, 'That is your own offer.');
    if (!level(c)) return game.fail(conn, cmd, -1, 'Build a Marketplace to trade.');
    game.logic.settle(c, p, now);
    const f = fill(o, d.payAmount);
    if (!f.take || !f.pay) return game.fail(conn, cmd, -1, 'Enter how much to pay.');
    if ((c.res[o.wantResource] || 0) < f.pay) return game.fail(conn, cmd, -1, `You don't have ${f.pay.toLocaleString('en-US')} ${o.wantResource}.`);
    c.res[o.wantResource] -= f.pay;
    trade(o, c, p, f.pay, now);
    M().offers = M().offers.filter(x => x.filledGive < x.giveAmount && x.filledWant < x.wantAmount);
    game.log.info(`${p.name} bought ${f.take} ${o.giveResource} from ${o.playerName} for ${f.pay} ${o.wantResource}`);
    touch([p.id, o.playerId]); game.pushResources(c);
    game.reply(conn, cmd, { take: f.take, pay: f.pay });
  };

  H['market.cancelOffer'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, o = open().find(x => x.id === Number(d.offerId) && x.playerId === p.id);
    if (!o) return game.fail(conn, cmd, -1, 'That offer is no longer open.');
    const back = o.giveAmount - o.filledGive, home = game.db.castles[o.castleId];
    M().offers = M().offers.filter(x => x !== o);
    if (home && home.playerId === p.id){ game.logic.settle(home, p, game.now()); home.res[o.giveResource] += back; game.pushResources(home); }
    touch([p.id]);
    game.reply(conn, cmd, { returned: back });
  };

  H['market.speedUp'] = (conn, d, cmd) => {
    const p = conn.player, now = game.now(), s = M().shipments.find(x => x.id === Number(d.shipmentId) && x.playerId === p.id);
    if (!s) return game.fail(conn, cmd, -1, 'That delivery has arrived.');
    if (!game.items.take(p, FLEET)) return game.fail(conn, cmd, -44, 'You need a Merchant Fleet item.');
    deliver(s, now); game.store.touch();
    game.pushItems(p, [FLEET]);
    game.reply(conn, cmd, {});
  };
};

module.exports.fill = fill;
