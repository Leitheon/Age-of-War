'use strict';
// The 800x800 world. Tile id = y * 800 + x (from the client's Coordinate class).
// Terrain is derived from the world seed; only tiles that change (cities, occupied valleys) are stored.
const SIZE = 800;
const T = { FOREST: 1, DESERT: 2, HILL: 3, SWAMP: 4, GRASSLAND: 5, LAKE: 6, FLAT: 10, CASTLE: 11, NPC: 12 };

const xy = id => ({ x: id % SIZE, y: Math.floor(id / SIZE) });
const idOf = (x, y) => ((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE);
const zoneOf = id => { const { x, y } = xy(id); return Math.floor(y / 200) * 4 + Math.floor(x / 200); };

// The map is a pure function of the world seed, the same one the web client draws from (its common.mapSeed): a
// 64-bit SplitMix-style hash of (seed, x, y, salt) picks each tile's type and its level, so only changes (cities,
// held valleys) are stored, and the server and every browser agree on every tile.
const M64 = (1n << 64n) - 1n, SIGN = 1n << 63n, WRAP = 1n << 64n;
const GOLDEN = 0x9E3779B97F4A7C15n, MIX1 = 0xBF58476D1CE4E5B9n, MIX2 = 0x94D049BB133111EBn;
const wrap = v => ((v % SIZE) + SIZE) % SIZE;
function hash64(seed, x, y, salt){
  let r = (BigInt(seed) ^ (BigInt(wrap(x)) << 32n) ^ (BigInt(wrap(y)) & 0xffffffffn) ^ ((BigInt(salt) * GOLDEN) & M64)) & M64;
  r = ((r ^ (r >> 30n)) * MIX1) & M64;
  r = ((r ^ (r >> 27n)) * MIX2) & M64;
  r = (r ^ (r >> 31n)) & M64;
  return r >= SIGN ? r - WRAP : r;
}
function roll(seed, x, y, salt, mod){ let r = hash64(seed, x, y, salt) % BigInt(mod); if (r < 0n) r += BigInt(mod); return Number(r); }
// Per 1,000 tiles: 130 barbarian (NPC) cities, 520 flats, then grassland, forest, hill, desert, swamp and lake.
// The tiles around each Historic City are flats (Fox: for PvP, every Historic City has flats on all sides
// within rules.historic.flatRing tiles, except where another Historic City is, as 99,99 beside 100,100).
function terrain(seed, id){
  const { x, y } = xy(id), s = roll(seed, x, y, 1, 1000);
  if (ring.has(id)) return { type: T.FLAT, level: 1 + roll(seed, x, y, 2, 10) };
  const type = s < 130 ? T.NPC : s < 650 ? T.FLAT : s < 732 ? T.GRASSLAND : s < 814 ? T.FOREST : s < 880 ? T.HILL : s < 935 ? T.DESERT : s < 974 ? T.SWAMP : T.LAKE;
  return { type, level: 1 + roll(seed, x, y, 2, 10) };
}

// Valley levels cycle (the wiki's Valley page): every day at the daily reset each valley and flat goes up a level,
// from 10 back to 1. A valley someone holds keeps the level it was taken at (it's stored in db.tiles) and joins the
// cycle again when it's given up. Set at startup from the rules.
let cycle = { enabled: false, resetHourUTC: 0 };
function setValleyCycle(o){ cycle = { ...cycle, ...o }; }
const DAY = 86400000;
function cycleDay(now = Date.now()){ return Math.floor((now - (cycle.resetHourUTC || 0) * 3600000) / DAY); }
function cycledLevel(base, now){ return cycle.enabled ? ((base - 1 + cycleDay(now)) % 10 + 10) % 10 + 1 : base; }

// Historic Cities (see historic.js), set once at startup: fieldId -> { name, level, powerLevel, ... }
let historic = new Map(), ring = new Set(), ringSize = 0;
function setHistoric(map, { flatRing = 0 } = {}){
  historic = map; ring = new Set(); ringSize = Math.max(0, Math.floor(Number(flatRing) || 0));
  for (const h of map.values()) for (let dy = -ringSize; dy <= ringSize; dy++) for (let dx = -ringSize; dx <= ringSize; dx++){
    const id = idOf(h.x + dx, h.y + dy);
    if (!map.has(id)) ring.add(id);
  }
}
function flatRing(){ return ringSize; }
function historicAt(id){ return historic.get(id) || null; }
function historicEntries(){ return historic.entries(); }

// What the map itself has at id at a time, ignoring cities and anything saved there (an abandoned city's spot).
function naturalTile(seed, id, now = Date.now()){
  const t = terrain(seed, id);
  return { id, type: t.type, level: t.type === T.NPC ? t.level : cycledLevel(t.level, now) };
}
function tileAt(store, id, now = Date.now()){
  const saved = store.db.tiles[id];
  if (saved) return { id, ...saved };
  const h = historic.get(id);
  if (h) return { id, type: T.NPC, level: 10, historic: h };
  const t = terrain(store.db.seed, id);
  return { id, type: t.type, level: t.type === T.NPC ? t.level : cycledLevel(t.level, now) };
}

// A free flat tile for a new city, spiralling out from a random point.
function findHome(store){
  const cx = 100 + Math.floor(Math.random() * 600), cy = 100 + Math.floor(Math.random() * 600);
  for (let r = 0; r < 200; r++){
    for (let dx = -r; dx <= r; dx++) for (const dy of [-r, r]){
      for (const [x, y] of [[cx + dx, cy + dy], [cx + dy, cy + dx]]){
        const id = idOf(x, y), t = tileAt(store, id);
        if (t.type === T.FLAT && !store.db.tiles[id]) return id;
      }
    }
  }
  throw new Error('No free tile found for a new city');
}

// Two hex digits per tile for the map view: terrain type, then level (WorldMap.parserString / Tile.setFirstMap).
function tileCode(t){ return t.type.toString(16) + Math.max(0, Math.min(15, t.level || 0)).toString(16); }

module.exports = { SIZE, T, hash64, cycledLevel, xy, idOf, zoneOf, terrain, naturalTile, tileAt, findHome, tileCode, setHistoric, flatRing, historicAt, historicEntries, setValleyCycle, cycleDay };
