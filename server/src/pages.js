'use strict';
// The sign-in screen's reference pages (DoA's /heroes, /npcs and /droptable), from the templates in pages/, with
// their numbers from this server's own rules and data:
//   /heroes              Historic Heroes (its list from /heroes.json and /heroes-status.json) and Experience & XP
//   /heroes.json         every historic hero: id, name, leadership, attack, politics, intelligence, bio
//   /heroes-status.json  { id: { k, t } }: owned (hired or held), barb (in a barbarian city), hc (rules a Historic
//                        City), or no rumors
//   /npcs                the NPC page (what's in a place is learned by scouting it)
//   /droptable           rules.battleDrops, as tables
//   /report              the battle report viewer: ?id= from a report's link, else a box to paste one into
//   /report.json         ?id=: that report (its XML as the game keeps it, the names of the items it turned up)
const fs = require('fs');
const path = require('path');
const world = require('./game/world');

const DIR = path.join(__dirname, '..', 'pages');
const HTML = 'text/html; charset=utf-8', JSON_T = 'application/json; charset=utf-8';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n0 = v => Math.round(v).toLocaleString('en-US');
const n2 = v => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const template = name => fs.readFileSync(path.join(DIR, name), 'utf8');
const fill = (html, vals) => html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vals ? vals[k] : m));
const TROOP_ORDER = [3, 2, 4, 5, 6, 7, 9, 8, 10, 11, 12, 13];   // as DoA's table

module.exports = game => {
  const R = () => game.rules;

  // Experience & XP: the level caps and the mayor's XP for each troop, from the rules and the client's troop table.
  const heroesPage = () => {
    const base = R().heroExpBase || 150, total = cap => { let t = 0; for (let L = 1; L < cap; L++) t += base * L * L; return t; };
    const capOrd = R().heroMaxLevel ?? 100, capHist = R().historicHeroes?.maxLevel ?? 150, rate = Number(R().mayorExp) || 0;
    const levelRows = [['Ordinary', capOrd], ['Historic', capHist]].map(([k, cap]) => `<tr><td>${k}</td><td>${cap}</td><td>${n0(total(cap))}</td></tr>`).join('');
    const max = total(capHist);
    const xpRows = TROOP_ORDER.map(id => game.data.troops[id]).filter(Boolean).map(t => {
      const res = t.food + t.wood + t.stone + t.iron, per = rate * (res + t.time);
      return `<tr><td>${esc(t.name)}</td><td>${n0(res)}</td><td>${n0(t.time)}</td><td>${per ? n2(per) : '—'}</td><td>${per ? n0(Math.ceil(max / per)) : '—'}</td></tr>`;
    }).join('');
    return { body: fill(template('heroes.html'), { EXP_BASE: String(base), LEVEL_ROWS: levelRows, XP_ROWS: xpRows, MAYOR_RATE: rate ? rate.toFixed(5) : '0' }), type: HTML };
  };

  const heroesJson = () => {
    const list = [...game.hh.roster.values()].map(h => ({ id: h.id, name: h.name, leadership: h.ldr || 0, attack: h.atk || 0, politics: h.pol || 0, intelligence: h.int || 0, bio: h.bio || '' }));
    return { body: JSON.stringify(list), type: JSON_T };
  };

  // Where each hero is, without the place: Enquire Details at the Inn is what tells that.
  const heroesStatus = () => {
    const out = {};
    for (const h of game.hh.roster.values()){
      const s = game.hh.state(h.id);
      if (!s) continue;
      if (s.status === 'hired' || s.status === 'seized'){
        const c = game.db.castles[s.castleId], p = c && game.db.players[c.playerId];
        out[h.id] = { k: 'owned', t: p ? `${s.status === 'hired' ? 'Serving' : 'Held by'} ${p.name}` : 'Owned' };
      } else if (s.status === 'free' && s.fieldId != null) out[h.id] = { k: 'barb', t: 'In a barbarian city' };
      // (a Historic City's ruler, rules.historic.rulers: while a lord holds the city, it waits to rule it again)
      else if (s.status === 'ruler'){ const hc = world.historicAt(s.fieldId); out[h.id] = { k: 'hc', t: game.hh.rulerAt(s.fieldId)?.id === h.id ? `Rules ${hc?.name}` : `Rules ${hc?.name} once it's free again` }; }
    }
    return { body: JSON.stringify(out), type: JSON_T };
  };

  // rules.battleDrops: an item's chance by the place and its level (armies.treasure reads it the same way).
  const dropPage = () => {
    const cfg = R().battleDrops || {}, items = cfg.items || {};
    const chance = (row, level) => {
      if (typeof row === 'number') return row;
      if (Array.isArray(row)) return row[Math.max(1, Math.min(row.length + 1, level)) - 1] || 0;
      if (row && typeof row === 'object'){ const at = Object.keys(row).map(Number).filter(l => l <= level).sort((a, b) => b - a)[0]; return at === undefined ? 0 : row[at]; }
      return 0;
    };
    const kinds = [['valley', 'Valleys and flats', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'Lv '], ['npc', 'Barbarian cities', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'Lv '],
      ['historic', 'Historic Cities', [12, 14, 16, 18], 'Lv '], ['pvp', "Lords' cities", [0], '']];
    const tables = cfg.enabled === false ? '<p class="sec-sub">Battles turn up no treasure on this server.</p>' : kinds.map(([k, title, levels, pre]) => {
      const rows = Object.entries(items).filter(([, t]) => t[k] != null).map(([id, t]) => [id, levels.map(L => chance(t[k], L))]).filter(([, cs]) => cs.some(c => c > 0));
      if (!rows.length) return '';
      const head = levels.map(L => `<th>${k === 'pvp' ? 'Chance' : pre + L}</th>`).join('');
      const body = rows.map(([id, cs]) => `<tr><td>${esc(game.items.name(id))}</td>${cs.map(c => `<td>${c ? c + '%' : '—'}</td>`).join('')}</tr>`).join('');
      return `<div class="sec-head"><h2>${title}</h2><span class="bar"></span></div><div class="tblwrap"><table><thead><tr><th>Item</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }).join('');
    return { body: fill(template('droptable.html'), { MIN_KILL: `${Math.round((cfg.minKillShare ?? 0) * 100)}%`, TABLES: tables }), type: HTML };
  };

  // A battle report a lord shared by its link (reports.js: share ids). Only what the report itself says.
  const reportJson = q => {
    const found = game.reports.find(q.get('id'));
    if (!found || !game.reports.shareable(found.r)) return { body: JSON.stringify({ ok: 0, error: 'This report is not available. The link may be wrong, or the report was deleted.' }), type: JSON_T };
    const r = found.r, items = {};
    for (const part of String(/\battackWinnerItems="([^"]*)"/.exec(r.content)?.[1] || '').split(',')){
      const id = part.split('=')[0].trim(); if (!id) continue;
      const it = game.data.items?.[id]; items[id] = { n: it?.name || id, i: it?.icon || '' };
    }
    return { body: JSON.stringify({ ok: 1, title: r.title || '', eventTime: r.eventTime || '', startPos: r.startPos || '', targetPos: r.targetPos || '', xml: r.content, items }), type: JSON_T };
  };

  return { '/report': () => ({ body: template('report.html'), type: HTML }), '/report.json': reportJson, '/heroes': heroesPage, '/heroes.json': heroesJson, '/heroes-status.json': heroesStatus, '/npcs': () => ({ body: template('npcs.html'), type: HTML }), '/droptable': dropPage };
};
