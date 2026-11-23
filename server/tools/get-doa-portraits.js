'use strict';
// Downloads DoA's portraits for the historic heroes that have none here (no art/heroes/<ID>.png and no
// art/flash/images/icon/hero/<ID>.png) from DoA's site, into art/heroes/<ID>.png. Nothing already there is
// replaced. Run it from the server folder: get-doa-portraits.bat, or node tools/get-doa-portraits.js
// [site ...] (default: https://dominionofages.com and https://dominionofages.com:9443).
// DoA's site has a portrait at /flash/images/icon/hero/<ID>.png, or by name for a few (Poseidon: poseidon.png).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHEET = path.join(ROOT, 'src', 'data', 'historic-heroes.csv');
const OUT = path.join(ROOT, 'art', 'heroes');
const SITES = process.argv.slice(2).length ? process.argv.slice(2) : ['https://dominionofages.com', 'https://dominionofages.com:9443'];
const BY_NAME = { 720: 'poseidon' };   // (portraits DoA's site has under a name instead of the number)
const { parseCsv } = require(path.join(ROOT, 'src', 'game', 'historicHeroes.js'));

const real = f => { try { const s = fs.statSync(f); return s.isFile() && s.size >= 100; } catch (e){ return false; } };
// A picture, not an error page: PNG, JPEG, GIF or WebP, and more than a blank pixel.
const isImage = b => b.length >= 100 && (b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) || (b[0] === 0xff && b[1] === 0xd8)
  || b.slice(0, 3).toString() === 'GIF' || (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP'));

async function grab(url){
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (Age of War portrait download)' } });
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return isImage(b) ? b : null;
  } catch (e){ return null; }
}

(async () => {
  const rows = parseCsv(fs.readFileSync(SHEET, 'utf8')); const head = rows.shift().map(h => h.trim().toLowerCase());
  const iName = head.findIndex(h => h.startsWith('hero name')), iId = head.findIndex(h => h.startsWith('image'));
  const want = rows.map(r => ({ id: Number(r[iId]), name: String(r[iName] || '').trim() }))
    .filter(h => Number.isSafeInteger(h.id) && h.id > 0)
    .filter(h => !real(path.join(OUT, `${h.id}.png`)) && !real(path.join(ROOT, 'art', 'flash', 'images', 'icon', 'hero', `${h.id}.png`)));
  if (!want.length){ console.log('Every hero has a portrait already.'); return; }
  console.log(`${want.length} heroes have no portrait here. Asking ${SITES.join(' and ')}...`);
  fs.mkdirSync(OUT, { recursive: true });
  const got = [], missing = [];
  for (const h of want){
    const files = [`${h.id}.png`, ...(BY_NAME[h.id] ? [`${BY_NAME[h.id]}.png`] : [])];
    let b = null, from = '';
    for (const site of SITES) for (const f of files){
      if (b) break;
      const url = `${site.replace(/\/$/, '')}/flash/images/icon/hero/${f}`;
      b = await grab(url); if (b) from = url;
    }
    if (b){ fs.writeFileSync(path.join(OUT, `${h.id}.png`), b); got.push(h); console.log(`  ${h.id} ${h.name}: saved (${from})`); }
    else { missing.push(h); console.log(`  ${h.id} ${h.name}: not found`); }
  }
  console.log(`\nSaved ${got.length} portraits in art\\heroes.` + (missing.length ? ` Still none for: ${missing.map(h => `${h.id} ${h.name}`).join(', ')}.` : ''));
  console.log('They show in the game at once; no restart needed.');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
