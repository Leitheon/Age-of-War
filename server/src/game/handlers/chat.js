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
  H['common.worldChat'] = (conn, d, cmd) => answer(conn, cmd, C.world(conn.player, d.msg, d.languageType, game.now()), 'world');
  H['common.channelChat'] = (conn, d, cmd) => answer(conn, cmd, C.channel(conn.player, d.channel, d.sendMsg, d.languageType, game.now()), 'world');
  H['common.privateChat'] = (conn, d, cmd) => answer(conn, cmd, C.whisper(conn.player, d.targetName, d.msg, game.now()), 'whisper');
  H['common.allianceChat'] = (conn, d, cmd) => answer(conn, cmd, C.alliance(conn.player, d.msg, d.languageType, game.now()), 'alliance');
  H['common.denyPlayerSpeak'] = (conn, d, cmd) => answer(conn, cmd, C.mute(conn.player, d.playername, d.time, game.now()), 'world');
};
