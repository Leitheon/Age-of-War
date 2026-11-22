'use strict';
// The web client's map. It draws the terrain itself from the world seed (common.mapSeed, world.js has the same
// generator) and asks only for what the seed can't tell it (common.mapDelta): lords' cities, and tiles whose type or
// level has changed (a held valley keeps the level it was taken at).
const world = require('../world');

module.exports = (game, H) => {
  const MAX_TILES = 40000;
  const resetDay = () => game.rules.valleyCycle !== false ? world.cycleDay(game.now()) : 0;

  // A lord's city as the map shows it: the MapCastleBean plus its level (the art), its skin and its alliance's flag.
  const cityOnMap = (conn, t) => {
    const b = game.mapBean(conn, t), c = game.db.castles[t.castleId], p = c && game.db.players[c.playerId], a = p && game.alliances.of(p);
    return { ...b, fieldId: t.id, level: c ? Math.max(1, game.logic.townHall(c)) : 1, castleSkin: !p ? '' : (c.powerLevel ?? 4) < 4 ? p.historicSkin || '' : p.castleSkin || '',
      allianceFlagColor: a?.flagColor || '', allianceFlagTextColor: a?.flagTextColor || '' };
  };

  H['common.mapSeed'] = (conn, d, cmd) => {
    const historic = [];
    for (const [id, h] of world.historicEntries()){ const { x, y } = world.xy(id); historic.push({ x, y, level: h.level, power: h.powerLevel ?? 4, name: h.name || '' }); }
    game.reply(conn, cmd, { seed: String(game.db.seed), size: world.SIZE, resetDay: resetDay(), historic });
  };

  H['common.mapDelta'] = (conn, d, cmd) => {
    const x1 = d.x1 | 0, y1 = d.y1 | 0, x2 = d.x2 | 0, y2 = d.y2 | 0;
    if (x2 < x1 || y2 < y1 || (x2 - x1 + 1) * (y2 - y1 + 1) > MAX_TILES) return game.fail(conn, cmd, -1, 'That map area is too large.');
    const castles = [], overrides = [], seen = new Set();
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++){
      const id = world.idOf(x, y);
      if (seen.has(id)) continue;
      seen.add(id);
      const saved = game.db.tiles[id];
      if (!saved) continue;
      const t = { id, ...saved };
      if (t.type === world.T.CASTLE) castles.push(cityOnMap(conn, t));
      else {
        const natural = world.naturalTile(game.db.seed, id, game.now());
        if (t.type !== natural.type || t.level !== natural.level) overrides.push([id, t.type, t.level]);
      }
    }
    game.reply(conn, cmd, { castles, overrides, resetDay: resetDay() });
  };
};
