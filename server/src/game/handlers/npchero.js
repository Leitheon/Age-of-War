'use strict';
const { centsRate, fmt } = require('../nocents');
// Historic heroes at the Inn (Hearsay, Hero Search, Enquire Details, accept task) and their quests under
// Quests, Hero Quests. The logic lives in historicHeroes.js.
const { REPORT_TYPE } = require('../reports');

module.exports = (game, H) => {
  const hh = game.hh;
  const goldOr = (conn, cmd, c, gold, what) => {
    if ((c.res.gold || 0) < gold){ game.fail(conn, cmd, -1, `${what} costs ${gold.toLocaleString('en-US')} gold.`); return false; }
    c.res.gold -= gold; game.pushResources(c); return true;
  };
  H['npchero.getNpcHerosList'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    game.reply(conn, cmd, { simpleNpcHeros: hh.hearsay(conn.player, game.now()), npcHeros: [] });
    game.store.touch();
  };
  // "More Hearsay": a fresh set of rumours for 100 gold.
  H['npchero.getNpcHerosListByMoney'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    if (!goldOr(conn, cmd, c, hh.rules.moreHearsayGold, 'More hearsay')) return;
    game.reply(conn, cmd, { simpleNpcHeros: hh.hearsay(conn.player, game.now(), true), npcHeros: [] });
    game.store.touch();
  };
  // "Hero Search": find heroes by name for 1,000 gold.
  H['npchero.getNpcHerosListByFilter'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const text = String(d.filter || '').trim();
    if (!text) return game.fail(conn, cmd, -1, 'Type part of a hero\'s name to search for.');
    const found = hh.search(conn.player, text);
    if (!found.length) return game.fail(conn, cmd, -1, `Nobody at the Inn has heard of a hero called "${text}". The search was free.`);
    if (!goldOr(conn, cmd, c, hh.rules.searchGold, 'A hero search')) return;
    game.reply(conn, cmd, { simpleNpcHeros: found, npcHeros: [] });
    game.store.touch();
  };
  // "Enquire Details": the hero's exact location, portrait and a report, for 10 cents (with rules.noCents, their
  // worth in gold: nocents.js).
  H['npchero.getNpcHeroInfroByID'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, cents = hh.rules.detailsCents, rate = centsRate(game.rules), gold = cents * rate;
    if (rate && game.goldPool(p) < gold) return game.fail(conn, cmd, -28, `The innkeeper wants ${fmt(gold)} gold for the details.`);
    if (!rate && (p.coins || 0) < cents) return game.fail(conn, cmd, -28, `The innkeeper wants ${cents} cents for the details.`);
    const r = hh.details(p, Number(d.npcid));
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    if (rate) game.payGold(p, gold, c, 'Enquire Details'); else { p.coins -= cents; game.pushPlayerInfo(p); }
    game.pushItems(p, [r.item]);
    game.reply(conn, cmd, { simpleNpcHeros: [r.bean], npcHeros: [] });
    game.reports.add(p, { type: REPORT_TYPE.OTHER, title: `The innkeeper's news of ${r.bean.name}`,
      content: hh.rules.questFree
        ? `${r.bean.introduce2}\n\nYou now have ${r.bean.name}'s portrait. Win attacks on that NPC city until its loyalty falls to 0: taking the city with the portrait in hand captures the hero (the portrait is used up), who then waits in your Feasting Hall to be persuaded.`
        : `${r.bean.introduce2}\n\nYou now have ${r.bean.name}'s portrait, which you need to recruit the hero. Accept the hero's quest at the Inn, then win attacks on that NPC city until the hero's loyalty falls to 0.` });
    game.store.touch();
  };

  // ---------- quests ----------
  H['quest.accept'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleid ?? d.castleId); if (!c) return;
    const p = conn.player, id = Number(d.ncpid ?? d.npcid);
    const r = hh.accept(p, c, id);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.store.touch();
    game.reply(conn, cmd, { quests: [hh.questBean(p, id, game.now())], errorMsg: r.msg, msg: r.msg });
  };
  // Quest lists, claiming and abandoning are in handlers/quests.js.
};
