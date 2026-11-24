'use strict';
// Historic Cities: Atlantis (level 18), the 16 state capitals (16), the level 14 grid and the level 12 grid.
// Placement follows the live game (checked against Fox's grid in test/historic-grid.json and his checks of
// level 12s on the live server, Oct 2026). Each of the 16 states (200 x 200) has 1 capital, 8 level 14s and
// 121 level 12s (Fox, Nov 2026):
//   - names come from the client's own Historic City list (Lang2), in order;
//   - #0 is Atlantis at 0,0; #1-#16 are the capitals at 100,100 ... 700,700, row by row;
//   - #17-#160 fill the 12x12 level 14 grid every 66 tiles from 33,33, row by row. Names that appear again
//     later in the list (San Jose, Beirut) are held back for the level 12s. The 16 grid slots that sit on a
//     capital (99,99 / 297,99 / ...) use up a name but hold no city. That leaves the last two slots (693,759 and
//     759,759) without a name: they take the first names left over after the level 12s (a guess);
//   - the level 12 names are the held-back ones, then #161 onward, skipping names already used. They fill the
//     whole grid every 18 tiles from 9,9 (rules.historic.level12), row by row, 11 x 11 to a state: San Jose at
//     9,9, Olathe at 99,99 beside Washington, D.C. ... Hong Kong at 783,783. rules.historic.level12Clearance
//     above 0 would leave empty the grid tiles that close to a level 14 (none, as Fox describes it).
const world = require('./world');

// The client draws Historic City art and titles from powerLevel (EvonyAnimation / FieldInfoWin):
// 3 Village = level 12, 2 Town = 14, 1 Fort = 16, 0 City = 18. The tile itself is NPC level 10.
const POWER = { 12: 3, 14: 2, 16: 1, 18: 0 };
const TITLE = { 12: 'Village', 14: 'Town', 16: 'Fort', 18: 'City' };

const norm = n => n.replace(/^﻿/, '').trim().toLowerCase();
function uniqueKeepLast(list){
  const last = new Map(); list.forEach((n, i) => last.set(norm(n), i));
  return list.filter((n, i) => last.get(norm(n)) === i);
}

function build(names, rules){
  const cfg = rules.historic || {};
  const l12 = cfg.level12 || { x0: 9, y0: 9, step: 18 };
  const clearance = cfg.level12Clearance ?? 0;
  const out = new Map(), used = new Set();
  const lastIndex = new Map(); names.forEach((n, i) => lastIndex.set(norm(n), i));
  const add = (x, y, name, level) => {
    const id = world.idOf(x, y);
    if (name !== undefined && !out.has(id)) out.set(id, { id, x, y, name: String(name).replace(/^\uFEFF/, ''), level, powerLevel: POWER[level], title: TITLE[level] });
  };
  const take = name => { used.add(norm(name)); return name; };
  add(0, 0, take(names[0]), 18);
  for (let r = 0, i = 1; r < 4; r++) for (let c = 0; c < 4; c++, i++) add(100 + 200 * c, 100 + 200 * r, take(names[i]), 16);
  // Level 14 names: #17-#160, holding back names that appear again later in the list.
  const held = [], pool14 = [];
  for (let i = 17; i <= 160 && i < names.length; i++) (lastIndex.get(norm(names[i])) > i ? held : pool14).push(names[i]);
  const onCapital = k => k % 3 === 1;
  const unnamed14 = [];
  let k = 0;
  for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++){
    const name = pool14[k++], x = 33 + 66 * c, y = 33 + 66 * r;
    if (name !== undefined) take(name);
    if (onCapital(r) && onCapital(c)) continue;
    if (name === undefined) unnamed14.push([x, y]); else add(x, y, name, 14);
  }
  // Level 12 names: the held-back ones, then #161 onward, skipping names already used.
  const pool12 = [...held];
  for (const n of held) used.add(norm(n));
  for (let i = 161; i < names.length; i++){ const key = norm(names[i]); if (!used.has(key)){ used.add(key); pool12.push(names[i]); } }
  const cols = Math.max(0, Math.ceil((world.SIZE - l12.x0) / l12.step)), rows = Math.max(0, Math.ceil((world.SIZE - l12.y0) / l12.step));
  unnamed14.forEach(([x, y], i) => add(x, y, pool12[cols * rows + i], 14));
  if (cfg.level12Enabled === false) return out;
  const towns = [...out.values()].filter(h => h.level === 14);
  const crowded = (x, y) => clearance > 0 && towns.some(h => Math.hypot(h.x - x, h.y - y) <= clearance);
  k = 0;
  for (let y = l12.y0; y < world.SIZE; y += l12.step) for (let x = l12.x0; x < world.SIZE; x += l12.step){
    const name = pool12[k++];
    if (name === undefined) return out;
    if (!crowded(x, y)) add(x, y, name, 12);
  }
  return out;
}

module.exports = { build, POWER, TITLE, uniqueKeepLast, norm };
