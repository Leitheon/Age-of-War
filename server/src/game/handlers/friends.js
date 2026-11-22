'use strict';
// Friends List and BlockList (friends.js), gift packages (packages.js).
module.exports = (game, H) => {
  const F = game.friends, K = game.packages;
  const lists = (conn, cmd, r) => Array.isArray(r) ? game.fail(conn, cmd, r[0], r[1]) : game.reply(conn, cmd, F.lists(conn.player));
  H['friend.addFriend'] = (conn, d, cmd) => lists(conn, cmd, F.add(conn.player, 'friend', d.player));
  H['friend.addBlock'] = (conn, d, cmd) => lists(conn, cmd, F.add(conn.player, 'block', d.player));
  H['friend.deleteFriend'] = (conn, d, cmd) => lists(conn, cmd, F.remove(conn.player, 'friend', d.player));
  H['friend.deleteBlock'] = (conn, d, cmd) => lists(conn, cmd, F.remove(conn.player, 'block', d.player));
  H['friend.isBlockMailPlayer'] = (conn, d, cmd) => lists(conn, cmd, F.blockMail(conn.player, d.mailId));

  H['common.getPackageNumber'] = (conn, d, cmd) => game.reply(conn, cmd, { number: K.waiting(conn.player) });
  H['common.getPackageList'] = (conn, d, cmd) => game.reply(conn, cmd, { packages: K.beans(conn.player) });
  H['common.getPackage'] = (conn, d, cmd) => {
    const p = conn.player, r = K.claim(p, d.ruleId);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.pushItems(p, r.items);
    game.reply(conn, cmd, {});
    K.pushNumber(p, game.now());
  };
};
