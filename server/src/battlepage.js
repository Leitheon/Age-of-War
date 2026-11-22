'use strict';
// /battles (live mode): the battle reports the capture has kept (battlelog.js), newest first, with what was known
// about the side this program saw, and the file to send for fitting the battle engine.
const NAMES = { peasants: 'Workers', militia: 'Warriors', scouter: 'Scouts', pikemen: 'Pikemen', swordsmen: 'Swordsmen', archer: 'Archers',
  carriage: 'Transporters', lightCavalry: 'Cavalry', heavyCavalry: 'Cataphracts', ballista: 'Ballistae', batteringRam: 'Rams', catapult: 'Catapults',
  trap: 'Traps', abatis: 'Abatis', arrowTower: 'Archer Towers', rollingLogs: 'Rolling Logs', rockfall: 'Trebuchets' };
const SOURCES = { bot: 'RoboEvony', client: 'New client', ruffle: 'Ruffle', link: 'Report link' };
const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const n = v => Number(v || 0).toLocaleString('en-US');
const when = ms => { const d = new Date(ms), p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

function units(s){
  const rows = [...Object.entries(s?.troops || {}), ...Object.entries(s?.forts || {})].filter(([, u]) => u.count > 0);
  if (!rows.length) return '<span class="dim">none</span>';
  return rows.map(([k, u]) => `<div class="u"><span>${esc(NAMES[k] || k)}</span><b>${n(u.count)}</b>${u.lose ? `<i>−${n(u.lose)}</i>` : '<i class="dim">−0</i>'}</div>`).join('');
}
function who(s){
  if (!s) return '';
  return `<div class="k">${esc(s.king || '—')}</div><div class="dim">${esc(s.pos)}</div>${s.hero ? `<div>${esc(s.hero)}${s.heroLevel ? ` <span class="dim">Lv ${s.heroLevel}</span>` : ''}</div>` : ''}`;
}
function known(r){
  const c = r.attacker || r.defender;
  if (!c) return r.source === 'link' ? '<span class="dim">report only</span>' : '<span class="dim">—</span>';
  const h = c.hero, chips = [];
  if (h) chips.push(`hero ${esc(h.name)} Lv ${h.level}: atk ${h.power ?? '?'}${h.powerAdded ? '+' + h.powerAdded : ''}, int ${h.stratagem ?? '?'}${h.stratagemAdded ? '+' + h.stratagemAdded : ''}${h.leadership ? `, ldr ${h.leadership}` : ''}`);
  if (c.techs){ const t = c.techs; chips.push(`research MT ${t[9] || 0} IW ${t[10] || 0} Arch ${t[14] || 0} Med ${t[16] || 0}`); }
  if (c.matched) chips.push('march');
  if (c.target?.level) chips.push(`target type ${c.target.type} Lv ${c.target.level}`);
  if (c.walls != null) chips.push(`Walls ${c.walls}`);
  // (only the buffs that could touch a battle; the file has them all)
  const live = [...(c.buffs || []), ...(c.cityBuffs || [])].filter(b => (!b.endTime || b.endTime > (c.reachTime || r.at)) && /attack|defen|life|health|troop|army|war|horn|corselet/i.test(`${b.typeId} ${b.descName || ''}`) && !/produc|procduce|hunger/i.test(b.typeId));
  if (live.length) chips.push(`buffs ${live.map(b => esc(b.descName || b.typeId)).join(', ')}`);
  return chips.length ? chips.map(x => `<span class="chip">${x}</span>`).join(' ') : '<span class="dim">nothing yet</span>';
}

function battlesPage(book, query){
  const all = book ? book.all() : [];
  const showScout = query?.get('scout') === '1';
  const list = all.filter(r => showScout || r.report?.kind === 'battle');
  const counts = {}; for (const r of all) if (r.report?.kind === 'battle') counts[r.source] = (counts[r.source] || 0) + 1;
  const withCtx = all.filter(r => r.report?.kind === 'battle' && (r.attacker?.hero || r.defender?.hero)).length;
  const rows = list.slice(0, 500).map(r => {
    const rep = r.report || {}, a = rep.attacker, d = rep.defender;
    const result = rep.kind === 'battle' ? (rep.won ? '<span class="won">Attacker won</span>' : '<span class="lost">Defender held</span>') : '<span class="dim">Scouting</span>';
    return `<tr><td class="t">${when(r.at)}<div class="dim">${esc(SOURCES[r.source] || r.source)}${r.lord ? ` · ${esc(r.lord)}${r.side ? ` (${r.side})` : ''}` : ''}</div></td>
<td>${rep.kind === 'battle' ? who(a) : esc(r.bean?.targetPos || '')}</td><td>${rep.kind === 'battle' ? units(a) : ''}</td>
<td>${rep.kind === 'battle' ? who(d) : ''}</td><td>${rep.kind === 'battle' ? units(d) : ''}</td>
<td class="c">${rep.rounds ?? ''}</td><td>${result}</td><td class="kn">${known(r)}</td>
<td><a href="/default.html?battle/${esc(r.key)}.xml" target="_blank">View</a></td></tr>`;
  }).join('\n');
  const src = Object.entries(counts).map(([k, v]) => `${esc(SOURCES[k] || k)} ${n(v)}`).join(' · ') || 'none yet';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Captured Battles</title>
<style>
:root{--bg:#fbf4e6;--panel:#fff;--ink:#3a2a14;--dim:#8a7558;--line:#e3d2b0;--accent:#a35a10;--won:#2f7d32;--lost:#b03a2e;--chip:#f3e5c8}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#1c1812;--panel:#26201a;--ink:#efe3cc;--dim:#a8957a;--line:#3d3326;--accent:#f0a24a;--won:#7cc47f;--lost:#ef7a6c;--chip:#3a2f22}}
:root[data-theme="dark"]{--bg:#1c1812;--panel:#26201a;--ink:#efe3cc;--dim:#a8957a;--line:#3d3326;--accent:#f0a24a;--won:#7cc47f;--lost:#ef7a6c;--chip:#3a2f22}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.4 system-ui,Segoe UI,Tahoma,sans-serif}
header{padding:20px 16px 8px;max-width:1500px;margin:0 auto}h1{margin:0 0 4px;font-size:22px}
.bar{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;margin:10px 0}
a{color:var(--accent)}.btn{display:inline-block;padding:6px 12px;border:1px solid var(--accent);border-radius:6px;text-decoration:none;font-weight:600}
.dim{color:var(--dim)}.note{max-width:900px;color:var(--dim);margin:6px 0}
main{padding:0 16px 40px;max-width:1500px;margin:0 auto;overflow-x:auto}
table{border-collapse:collapse;width:100%;background:var(--panel);border:1px solid var(--line)}
th,td{padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--dim);background:var(--panel);position:sticky;top:0}
td.t{white-space:nowrap}td.c{text-align:center}.k{font-weight:600}
.u{display:grid;grid-template-columns:auto auto auto;gap:0 8px;white-space:nowrap}.u b{text-align:right;font-weight:600}.u i{font-style:normal;color:var(--lost)}.u i.dim{color:var(--dim)}
.won{color:var(--won);font-weight:600}.lost{color:var(--lost);font-weight:600}
.kn{min-width:220px}.chip{display:inline-block;background:var(--chip);border-radius:4px;padding:1px 6px;margin:1px 0;font-size:12px}
</style></head><body>
<header><h1>Captured battles${book.server ? ` · ${esc(String(book.server).toUpperCase())}` : ''}</h1>
<div class="bar"><span><b>${n(Object.values(counts).reduce((x, y) => x + y, 0))}</b> battles: ${src}</span>
<span><b>${n(withCtx)}</b> with the hero known</span>
<a class="btn" href="/battles.jsonl" download>Download battles.jsonl</a>
<a href="/recordings">All recordings</a>
<a href="/battles${showScout ? '' : '?scout=1'}">${showScout ? 'Hide scouting reports' : 'Show scouting reports too'}</a></div>
<p class="note">Every battle report that comes through this program is kept in <code>data/battles.jsonl</code>: from RoboEvony (its Server set to this program's address), from the new client, and from report links. With each one goes what the game had told that connection about its side: the hero as he marched, research, buffs, the troops sent and the target's level. Send the file over to fit the battle engine against the live game.</p></header>
<main>${list.length ? `<table><thead><tr><th>Captured</th><th>Attacker</th><th>Troops (lost)</th><th>Defender</th><th>Troops (lost)</th><th>Rounds</th><th>Result</th><th>Known about our side</th><th></th></tr></thead><tbody>
${rows}</tbody></table>${list.length > 500 ? `<p class="dim">Showing the newest 500 of ${n(list.length)}.</p>` : ''}` : '<p class="dim">No battles yet. Open a battle report in the new client, let RoboEvony run through this program, or open a report link.</p>'}</main>
</body></html>`;
}

module.exports = { battlesPage };
