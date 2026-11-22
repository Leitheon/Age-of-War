'use strict';
// The web client's Battle Calculator (army.calcBattle): a battle worked out with the server's own battle engine
// from what's typed in, with nothing changed in the world. Each side has troops, research levels (0-10: Military
// Tradition, Iron Working, Medicine, Archery, Compass, Horseback Riding), a hero's attack, intelligence and
// leadership, gear stars (the star set's life bonus), extra attack (amp) and life (end) in %, and the War Horn and
// Corselet; the defender also has fortifications, Walls and their endurance.
const TECH = { mt: 9, iw: 10, compass: 12, hbr: 13, archery: 14, medicine: 16 };
const FORTS = ['trap', 'abatis', 'arrowTower', 'rollingLogs', 'rockfall'];
const MAX = 2147483647;

module.exports = (game, H) => {
  const num = (v, max = MAX) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  const side = (s, defence) => {
    s = s && typeof s === 'object' ? s : {};
    const troops = {};
    for (const t of Object.values(game.data.troops)){ const n = num(s.troops?.[t.field]); if (n) troops[t.field] = n; }
    const p = { techs: {} };
    for (const [k, id] of Object.entries(TECH)) p.techs[id] = num(s[k], 10);
    const e = id => game.logic.techEffect(p, id);
    const count = Object.values(troops).reduce((a, n) => a + n, 0);
    const hero = { atk: num(s.heroAtt, 100000), int: num(s.heroInt, 100000), ldr: num(s.heroLdr, 100000) };
    // (the share of the army the hero leads in full, as combat.ledShare: (leadership x perPoint) x leadership troops)
    const r = game.rules.leadership, cap = r && r.enabled !== false && hero.ldr ? hero.ldr * (r.perPoint ?? 10) * hero.ldr : Infinity;
    const led = count <= cap ? 1 : (cap + (count - cap) * ((defence ? r.defenceShare : r.attackShare) || 0)) / count;
    let starLife = 0; const stars = num(s.stars, 15);
    for (const [need, life] of game.rules.starSetLife?.tiers || []) if (stars >= need) starLife = Math.max(starLife, life);
    const walls = defence ? num(s.walls, 21) : 0;
    const mods = {
      attack: e(TECH.mt) + hero.atk * game.rules.heroAttackPerPoint * led + (s.horn ? 20 : 0) + num(s.amp, 100000),
      defence: e(TECH.iw) + hero.int * game.rules.heroDefencePerIntelligence * led + (s.corselet ? 20 : 0),
      life: e(TECH.medicine) + starLife + num(s.end, 100000),
      range: e(TECH.archery) + game.combat.wallRange(walls), wall: game.combat.wallRange(walls),
      fortLife: defence ? Math.max(0, (Number(s.fortEndurance) || 1) - 1) * 100 : 0, speedFoot: e(TECH.compass), speedHorse: e(TECH.hbr),
    };
    const forts = {};
    if (defence) for (const k of FORTS){ const n = num(s.forts?.[k]); if (n) forts[k] = n; }
    return { troops, forts, mods, hero, count };
  };

  H['army.calcBattle'] = (conn, d, cmd) => {
    const a = side(d.attacker, false), def = side(d.defender, true);
    if (!a.count) return game.fail(conn, cmd, -1, 'Add some attacker troops.');
    const r = game.combat.fight({ troops: a.troops, mods: a.mods }, { troops: def.troops, forts: def.forts, mods: def.mods });
    const lost = rows => Object.fromEntries(rows.filter(x => x.lose > 0).map(x => [x.field, x.lose]));
    game.reply(conn, cmd, {
      result: r.attackerWon ? 1 : 0, round: r.round,
      attackLostTroop: lost(r.att), defendLostTroop: lost(r.def.filter(x => !x.fort && x.field !== 'arrowTower')), fortLostTroop: lost(r.def.filter(x => x.fort || x.field === 'arrowTower')),
      appliedHeroAtt: def.hero.atk, appliedHeroInt: def.hero.int, appliedHeroLdr: def.hero.ldr,
    });
  };
};
