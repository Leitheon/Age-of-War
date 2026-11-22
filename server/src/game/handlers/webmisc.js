'use strict';
// The web client's smaller additions: alliance banner colours, castle skins, items attached to mail, and raising a
// barbarian city on a flat the lord holds.
const world = require('../world');

const FLAG = ['', 'green', 'blue', 'white', 'orange'], TEXT = ['', 'white', 'yellow', 'red', 'blue', 'green'];
const SKINS = { castle: ['', 'alpha', 'halloween', 'pumpkin'], historic: ['', 'hollow'] };
const SKIN_ITEM = /^player\.castle\.skin\.([a-z]+)$/;

module.exports = (game, H) => {
  // ---------- alliance banner ----------
  H['alliance.setAllianceFlagColor'] = (conn, d, cmd) => {
    const p = conn.player, a = game.alliances.of(p);
    if (!a) return game.fail(conn, cmd, -1, 'You are not in an alliance.');
    if (![4, 5].includes(game.alliances.rank(p))) return game.fail(conn, cmd, -1, 'Only the Host or the Vice Host can change the banner.');
    const color = String(d.color || ''), text = String(d.textColor || '');
    if (!FLAG.includes(color) || !TEXT.includes(text)) return game.fail(conn, cmd, -1, 'Choose a colour from the list.');
    a.flagColor = color; a.flagTextColor = text; game.store.touch();
    game.reply(conn, cmd, { flagColor: color, flagTextColor: text });
  };

  // ---------- castle skins ----------
  // A lord's unlocked skins (castleSkins, comma-separated), the one his ordinary cities wear and the one his
  // Historic Cities wear. Each is unlocked by using its item (player.castle.skin.<name>).
  game.skinFields = p => ({ castleSkin: p.castleSkin || '', historicSkin: p.historicSkin || '', castleSkins: (p.castleSkins || []).join(',') });
  H['city.setCastleSkin'] = (conn, d, cmd) => {
    const p = conn.player, historic = !!d.historic, skin = String(d.skin || '');
    if (!SKINS[historic ? 'historic' : 'castle'].includes(skin)) return game.fail(conn, cmd, -1, 'That skin isn\'t for those cities.');
    if (skin && !(p.castleSkins || []).includes(skin)) return game.fail(conn, cmd, -1, 'Use the skin\'s item first to unlock it.');
    if (skin && historic && !game.castlesOf(p).some(c => (c.powerLevel ?? 4) < 4)) return game.fail(conn, cmd, -1, 'You can hold this skin, but it can be worn only after you own a historic city.');
    if (historic) p.historicSkin = skin; else p.castleSkin = skin;
    game.store.touch();
    const f = game.skinFields(p);
    game.reply(conn, cmd, f);
    for (const conn2 of game.online.values()) conn2.send('server.CastleSkin', { ok: 1, packageId: 0, ownerPlayerId: p.id, castleSkin: f.castleSkin, historicSkin: f.historicSkin });
  };
  // Using a skin's item unlocks it (the item table these come from is the web client's, not the Flash client's).
  const useGoods = H['shop.useGoods'];
  H['shop.useGoods'] = (conn, d, cmd) => {
    const m = SKIN_ITEM.exec(String(d.itemId || ''));
    if (!m) return useGoods(conn, d, cmd);
    const p = conn.player;
    if (!game.items.take(p, d.itemId)) return game.fail(conn, cmd, -44, 'You don\'t have that item.');
    p.castleSkins = [...new Set([...(p.castleSkins || []), m[1]])];
    game.store.touch(); game.pushItems(p, [d.itemId]);
    game.reply(conn, cmd, { ...game.skinFields(p), msg: 'Skin unlocked: choose it from your city on the world map.' });
  };

  // ---------- mail attachments ----------
  // A mail may carry an item (mail.attachment: { itemId, qty }); the receiver claims it once.
  H['mail.claimAttachment'] = (conn, d, cmd) => {
    const p = conn.player, m = game.mail.find(p, d.mailId);
    if (!m) return game.fail(conn, cmd, -1, 'That mail has been deleted.');
    if (!m.attachment) return game.fail(conn, cmd, -1, 'There is nothing attached to that mail.');
    if (m.attachment.claimed) return game.fail(conn, cmd, -1, 'You already received that.');
    m.attachment.claimed = true;
    game.items.add(p, m.attachment.itemId, m.attachment.qty || 1);
    game.store.touch(); game.pushItems(p, [m.attachment.itemId]);
    game.reply(conn, cmd, { name: game.items.name(m.attachment.itemId), itemId: m.attachment.itemId, qty: m.attachment.qty || 1 });
  };

  // ---------- barbarian cities on a held flat ----------
  // The lord gives up a flat one of his cities holds, and a barbarian city of the chosen level (1-10) rises there.
  H['city.buildNpc'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    if (game.rules.buildNpc?.enabled === false) return game.fail(conn, cmd, -1, 'Raising barbarian cities is turned off on this server.');
    const id = Number(d.fieldId), level = Math.floor(Number(d.level));
    if (!(level >= 1 && level <= 10)) return game.fail(conn, cmd, -1, 'Choose a level from 1 to 10.');
    const t = world.tileAt(game.store, id, game.now());
    if (t.type !== world.T.FLAT || !(c.valleys || []).includes(id)) return game.fail(conn, cmd, -1, 'This city must hold the flat first.');
    if (Object.values(game.armies.list()).some(a => a.target === id)) return game.fail(conn, cmd, -1, 'An army is on its way there.');
    const r = game.armies.giveUp(c, id);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.db.tiles[id] = { type: world.T.NPC, level };
    game.store.touch();
    game.push(c.playerId, 'server.CastleFieldUpdate', { castleId: c.id, updateType: 1, bean: r.bean });
    game.pushResources(c);
    game.log.info(`${conn.player.name} raised a level ${level} barbarian city at (${world.xy(id).x},${world.xy(id).y})`);
    game.reply(conn, cmd, { fieldId: id, level });
  };
};
