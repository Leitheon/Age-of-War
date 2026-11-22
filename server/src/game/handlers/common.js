'use strict';
// The small commands: the tutorial's step, the Turn off return reports setting, Add to favorites, the Newsboard,
// and clear answers for what this server doesn't have (Facebook features, guest accounts, the GM tools, and commands
// no window of this client sends).
module.exports = (game, H) => {
  const say = msg => (conn, d, cmd) => game.fail(conn, cmd, -1, msg);
  const okEmpty = (conn, d, cmd) => game.reply(conn, cmd, {});
  // The tutorial (GuideStep) saves each step; 999 is done. A lord who leaves halfway picks it up again at login.
  H['common.step'] = (conn, d, cmd) => {
    const n = Math.floor(Number(d.tutorialStepId));
    if (Number.isFinite(n) && n >= 0 && n <= 100000){ conn.player.tutorialStep = n; game.store.touch(); }
    okEmpty(conn, d, cmd);
  };
  // Reports' "Turn off return reports". (The server keeps the setting; it writes no separate return reports.)
  H['common.setReturnReport'] = (conn, d, cmd) => { conn.player.returnReport = !!d.returnReport; game.store.touch(); okEmpty(conn, d, cmd); };
  // The "Add to favorites" quest's button (the page itself can only suggest Ctrl+D).
  H['common.addToFavorites'] = (conn, d, cmd) => { game.quests.flag(conn.player, 'favorite'); okEmpty(conn, d, cmd); };
  // Random events (RandomEventWin): Accept says the event is done. Event 1, the only one shown to a lord without
  // Facebook, gives an Aries Amulet once a day (rules.dailyEvent), as live: Fox's recordings (Nov 2026) have 85
  // claims, each the lord's first of the day and each answered by one Amulet just after. The rest give nothing.
  H['common.setEventDone'] = (conn, d, cmd) => {
    const p = conn.player, id = Math.floor(Number(d?.id)), now = game.now(), r = game.rules.dailyEvent || {};
    if (!(id >= 1 && id <= 41)) return okEmpty(conn, d, cmd);
    const times = p.eventTimes || (p.eventTimes = {});
    const due = id === 1 && r.enabled !== false && r.item && game.npc.day(times[1] || 0) < game.npc.day(now);
    if (id !== 1 || due){ times[id] = now; game.store.touch(); }
    okEmpty(conn, d, cmd);
    if (due){ game.items.add(p, r.item, r.count || 1); game.pushItems(p, [r.item]); }
  };
  // The server-merge peace (PlayerPeaceUniteServerBuff): this server never merges, but the command is honoured.
  H['common.delUniteServerPeaceStatus'] = (conn, d, cmd) => {
    const p = conn.player, now = game.now(), had = game.activeBuffs(p, now);
    if (p.buffs?.PlayerPeaceUniteServerBuff){ delete p.buffs.PlayerPeaceUniteServerBuff; game.store.touch(); }
    okEmpty(conn, d, cmd);
    game.pushBuffs(p, had, now);
  };
  // The Newsboard (NoticeWin): the server's announcements to everyone.
  H['mail.getAllTVMsg'] = (conn, d, cmd) => game.reply(conn, cmd, { tvBeans: game.chat.newsBeans() });
  H['quest.AllowRegister'] = okEmpty;
  H['common.saveUnregisteredPlayer'] = say('There are no guest accounts on this server: your account is already saved.');
  // Sent by no window of this client.
  H['common.changeName'] = say("Lords can't be renamed on this server.");
  H['common.deleteUserAndRestart'] = say("Restarting isn't available on this server. Make a new account from the login page instead.");
  H['stratagem.useStratagem'] = say("Use stratagems from a city's or an army's Stratagem button.");
  H['quest.awardPacket'] = say('Claim quest rewards from the Quests window.');
  // The GM tools: the debug menu ("Get More Coins") does the same jobs on this server.
  for (const c of ['addBuilding', 'addHero', 'addItems', 'removeBuilding', 'removeHero', 'removeItem', 'setResources', 'setTechnology'])
    H['gamemaster.' + c] = say('The GM tools aren\'t on this server. Use the debug menu (the "Get More Coins" button) instead.');
  // Facebook.
  const fb = say("Facebook features aren't available on this server.");
  for (const c of ['common.facebookConnect', 'hero.hireFacebookFriendHero', 'hero.setHeroFacebookId', 'visit.deleteComment', 'visit.helpIncreaseProduction', 'visit.markCommentAsRead', 'visit.visitorComment']) H[c] = fb;
  H['visit.getAllVisitorComments'] = (conn, d, cmd) => game.reply(conn, cmd, game.emptyReply(cmd));
  H['visit.getVisitorComments'] = (conn, d, cmd) => game.reply(conn, cmd, game.emptyReply(cmd));
  H['visit.getHelpedPlayers'] = (conn, d, cmd) => game.reply(conn, cmd, game.emptyReply(cmd));
};
