'use strict';
// Chat commands (chat.js has the rules). A refused message's reply makes the Flash client take the sender's line
// back out and show why; the web client ignores the reply, so it also gets a "(Not sent: ...)" line (chat.refused).
module.exports = (game, H) => {
  const C = game.chat;
  const answer = (conn, cmd, r, where) => {
    if (!Array.isArray(r)) return game.reply(conn, cmd, {});
    C.refused(conn, where, r[1]);
    game.fail(conn, cmd, r[0], r[1]);
  };
  // (security review, Nov 28 2026) A lord sends at most rules.chat.linesPer10s lines (8) in 10 seconds, all channels
  // together; more come back as "(Not sent: ...)".
  const FAST = [-1, 'You are sending messages too fast. Wait a few seconds.'];
  const paced = fn => conn => game.limited(conn.player, 'chat', game.rules.chat?.linesPer10s ?? 8, 10000) ? FAST : fn();
  H['common.worldChat'] = (conn, d, cmd) => answer(conn, cmd, paced(() => C.world(conn.player, d.msg, d.languageType, game.now()))(conn), 'world');
  H['common.channelChat'] = (conn, d, cmd) => answer(conn, cmd, paced(() => C.channel(conn.player, d.channel, d.sendMsg, d.languageType, game.now()))(conn), 'world');
  H['common.privateChat'] = (conn, d, cmd) => answer(conn, cmd, paced(() => C.whisper(conn.player, d.targetName, d.msg, game.now()))(conn), 'whisper');
  H['common.allianceChat'] = (conn, d, cmd) => answer(conn, cmd, paced(() => C.alliance(conn.player, d.msg, d.languageType, game.now()))(conn), 'alliance');
  H['common.denyPlayerSpeak'] = (conn, d, cmd) => answer(conn, cmd, C.mute(conn.player, d.playername, d.time, game.now()), 'world');
};
