'use strict';
// Web server for the launch page, config2.xml, your copy of the client, and game art.
// Art the client asks for (images/..., other .swf modules) is fetched once from the asset CDN
// in config.json and kept in the cache folder, the same way your browser cache would hold it.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const TYPES = { '.html': 'text/html; charset=utf-8', '.xml': 'text/xml; charset=utf-8', '.swf': 'application/x-shockwave-flash', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain', '.mp3': 'audio/mpeg', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.map': 'application/json' };
const typeOf = p => TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream';
const xmlEsc = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

function config2(cfg){
  const base = `http://${cfg.host}:${cfg.httpPort}/`;
  const v = {
    debugMode: 'true', server: cfg.host, port: cfg.gamePort, security: `xmlsocket://${cfg.host}:${cfg.policyPort}`,
    serverID: cfg.serverId || 'local', serverAlias: cfg.serverName || 'Local', homePage: base, Language: 'English', MultiLanguage: 'false',
    FrameCount: 300, RunSeconds: 5, ButtonFlag: 'true', Facebook: 0, AbTestFlag: 'true', AttackFlag: 'false', BuildingQueueFlag: cfg.buildingQueue === false ? 'false' : 'true',
    ScaleHouse: 0, ScaleTownHall: 0, Coord: '', SID: '', movingText: base + 'movingText.txt', movingTxt: '', Offer: '', ServerState: '', proclamation: '', NewsRSS: '',
    acount: '', password: '', addFund: base + 'coins?from=game', GiftKey: '', forum: base, allianceForum: base, help: base, AccountProtect: base, PreminumRewardPage: base,
    IEvonyPage: base, SendGift: base, AddNeighbor: base, VisitEmpire: base, NeighborList: base, RecentActivities: base, FbAction: base, FbEventAction: base,
    FbLinkAccount: base, FbUprisingUrl: base, CheckServerState: base, MiniFavorable: base, coeRegUrl: base,
  };
  // Live mode (live.js): the new client is on an official server; LoginPt sends the password as typed, as the Flash
  // client did when the official site started it with pt=1.
  if (cfg.live){ v.Live = 'true'; v.LoginPt = cfg.live.passwordAsTyped === false ? 'false' : 'true'; v.serverAlias = cfg.live.name || 'Official server'; }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n' + Object.entries(v).map(([k, x]) => `  <${k}>${xmlEsc(x)}</${k}>`).join('\n') + '\n</config>\n';
}
const CROSSDOMAIN = '<?xml version="1.0"?>\n<cross-domain-policy>\n  <allow-access-from domain="*"/>\n</cross-domain-policy>\n';

// Hero portraits are images/icon/hero/N.png on the art server. Which numbers exist isn't known up front, so
// numbers that turn out to be missing are remembered (cache/hero-faces.json) and the hero generator skips them;
// meanwhile a missing portrait is answered with the "portrait unknown" picture (public/images/hero-unknown.png:
// the numbered portraits are all historic heroes', so another one would show the wrong person).
const UNKNOWN_FACE = path.join(__dirname, '..', 'public', 'images', 'hero-unknown.png');
function createFacePool(cacheDir){
  const file = path.join(cacheDir, 'hero-faces.json');
  let missing = new Set();
  try { missing = new Set(JSON.parse(fs.readFileSync(file, 'utf8')).missing || []); } catch (e){}
  const dir = path.join(cacheDir, 'images', 'icon', 'hero');
  const known = () => { try { return fs.readdirSync(dir).map(f => /^(\d+)\.png$/.exec(f)).filter(Boolean).map(m => Number(m[1])); } catch (e){ return []; } };
  return {
    missing: n => missing.has(n),
    markMissing(n){ if (missing.has(n)) return; missing.add(n); try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ missing: [...missing].sort((a, b) => a - b) })); } catch (e){} },
    anyKnown(){ const k = known(); return k.length ? k[Math.floor(Math.random() * k.length)] : null; },
    fallbackFile(n){ if (fs.existsSync(UNKNOWN_FACE)) return UNKNOWN_FACE; const k = known().filter(x => x !== n); return k.length ? path.join(dir, `${k[n % k.length]}.png`) : null; },
  };
}

// The battle report link userscript (live/firefox/evony-reports.user.js, with the address filled in).
function userscript(here){
  return String.raw`// ==UserScript==
// @name         Evony battle reports without Flash
// @description  Sends Evony battle report links (battle*.evony.com/default.html?logfile/...) to the Evony client on this PC.
// @version      1.2
// @match        *://*.evony.com/default.html*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(function(){
  var here = ${JSON.stringify(here)};
  // each server's reports in its own copy of the live client (start-cc2.bat runs CC2's on 8082, start-ca7.bat CA7's on 8083)
  var copies = { 'battlecc2.evony.com': 'http://127.0.0.1:8082', 'battleca7.evony.com': 'http://127.0.0.1:8083' };
  var host = location.hostname.toLowerCase();
  var m = /(logfile\/[0-9a-f\/]+\.xml)/i.exec(location.search);
  if (m && /^battle[a-z0-9]*\.evony\.com$/.test(host)) location.replace((copies[host] || here) + '/default.html?' + m[1] + '&host=' + host);
})();
`;
}

// opts.fresh: a connection of its own, closed after (not one kept open from an earlier fetch, which the far end or
// something on the way may have dropped without a word: the fetch would then wait out its timeout).
// opts.timeout: how long the other end may stay silent, in ms.
function fetchUpstream(url, depth = 0, opts = {}){
  return new Promise((resolve, reject) => {
    const o = { headers: { 'User-Agent': 'Mozilla/5.0 (local Evony server asset cache)' }, timeout: opts.timeout ?? 20000 };
    if (opts.fresh){ o.agent = false; o.headers.Connection = 'close'; }
    const req = http.get(url, o, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && depth < 3){
        res.resume(); return resolve(fetchUpstream(new URL(res.headers.location, url).toString(), depth + 1, opts));
      }
      if (res.statusCode !== 200){ res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// The live servers' config.xml, as RoboEvony reads it: serverID (must match what was typed), server (the game
// socket, host:port), SID and serverAlias.
function botConfig(cfg, hostHeader){
  const asked = String(hostHeader || `${cfg.host}:${cfg.httpPort}`);
  const host = asked.replace(/:\d+$/, '').replace(/^\[|\]$/g, '') || cfg.host;
  const x = v => String(v).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  // Live mode: the bot port, which hands the bot on to the official server (and keeps its battle reports).
  const port = cfg.live ? cfg.live.botPort || cfg.gamePort : cfg.gamePort, alias = cfg.live ? cfg.live.name || 'Official server' : cfg.serverName || 'Local';
  return `<?xml version="1.0" encoding="utf-8"?>\n<config>\n  <serverID>${x(asked)}</serverID>\n  <serverAlias>${x(alias)}</serverAlias>\n` +
    `  <server>${x(host)}:${port}</server>\n  <port>${port}</port>\n  <SID></SID>\n</config>\n`;
}

// Art the client asked for that neither cache/ nor the art server has. Logged once per file, so you can see
// what's missing, and used to keep items without an icon off the Wheel of Fortune. A 404 from the art server
// is remembered in cache/missing-art.json; other failures (no connection) only until the server restarts.
function createArtLog(cacheDir, log){
  const file = path.join(cacheDir, 'missing-art.json');
  let gone = new Set();
  try { gone = new Set(JSON.parse(fs.readFileSync(file, 'utf8')).missing || []); } catch (e){}
  const failed = new Map();   // file -> when the art server couldn't be reached for it (tried again after RETRY_MS)
  const RETRY_MS = 10 * 60000;
  const key = rel => String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  const failedNow = k => { const t = failed.get(k); if (t && Date.now() - t > RETRY_MS) failed.delete(k); return failed.has(k); };
  return {
    has: rel => !!rel && (gone.has(key(rel)) || failedNow(key(rel))),
    mark(rel, why){
      const k = key(rel);
      if (gone.has(k) || failedNow(k)) return;
      if (/HTTP 404|not cached/.test(why)){
        gone.add(k);
        try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ missing: [...gone].sort() }, null, 1)); } catch (e){}
      } else failed.set(k, Date.now());
      log.info(`Missing art: ${k} (${why})`);
    },
  };
}

// pages: { '/path': (URLSearchParams) => html or { body, type } } for pages the game itself serves (the coins page,
// the news ticker's movingText.txt).
// json: { onMessage, onClose } for the new client's /json socket (ws.js).
const ADMIN_PAGES = new Set(['/admin', '/coins']);
function adminOk(cfg, req){
  if (!cfg.adminPassword) return false;
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  const want = Buffer.from('admin:' + cfg.adminPassword), got = Buffer.from(Buffer.from(m[1], 'base64').toString('utf8'));
  return want.length === got.length && require('crypto').timingSafeEqual(want, got);
}

function startHttp(cfg, root, log, pages = {}, faces = null, art = null, perf = null, json = null){
  const pub = path.join(root, 'public'), cache = path.resolve(root, cfg.cacheDir || 'cache');
  // The game's art (flash/, tiles/, _uiassets/, heroes/, fonts/ and the two backgrounds): kept out of git, in art/.
  const artDir = path.resolve(root, cfg.artDir || 'art');
  const clientFile = path.resolve(root, cfg.clientFile);
  const inflight = new Map();
  const send = (res, code, body, type) => { res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-cache' }); res.end(body); };
  // (the client's /assets/ files have the build's hash in their names, so they never change; art changes rarely)
  const cacheFor = file => file.includes(path.sep + 'assets' + path.sep) ? 'public, max-age=31536000, immutable' : file.startsWith(artDir + path.sep) ? 'public, max-age=86400' : 'no-cache';
  const sendFile = (res, file) => fs.readFile(file, (e, b) => e ? send(res, 404, 'Not found', 'text/plain') : (res.writeHead(200, { 'Content-Type': typeOf(file), 'Content-Length': b.length, 'Cache-Control': cacheFor(file) }), res.end(b)));

  // /logfile/<date>/<xx>/<xx>/<hash>.xml from the official report host: only battle*.evony.com, only that shape of path.
  const reportXml = async (res, p, query) => {
    const m = /^\/logfile\/(\d{8})\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{32})\.xml$/i.exec(p);
    if (!m) return send(res, 404, 'Not a battle report.', 'text/plain');
    const host = String(query.get('host') || cfg.live?.reportHost || cfg.reportHost || 'battlena62.evony.com').toLowerCase();
    if (!/^battle[a-z]{0,8}\d{0,4}\.evony\.com$/.test(host)) return send(res, 400, 'Battle reports come from a battle*.evony.com host.', 'text/plain');
    const file = path.join(cache, require('./battlelog').reportCacheName(host), m[1], m[2].toLowerCase(), m[3].toLowerCase(), m[4].toLowerCase() + '.xml');
    if (fs.existsSync(file)) return sendFile(res, file);
    try {
      const b = await fetchReport(host, p);
      const head = b.toString('utf8', 0, 300);
      if (!/^\s*</.test(head) || /<(!doctype\s+)?html/i.test(head)) return send(res, 404, `${host} has no report there.`, 'text/plain');
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, b);
      // (kept with this server's battles only if it is this server's report: a CC2 link opened in the NA62 copy is
      // shown, and the CC2 copy keeps it when it next starts, from the cache)
      try { if (!cfg.live?.reportHost || host === String(cfg.live.reportHost).toLowerCase()) json?.book?.link(p, host, b.toString('utf8')); } catch (e){}
      res.writeHead(200, { 'Content-Type': TYPES['.xml'], 'Content-Length': b.length }); res.end(b);
    } catch (e){ send(res, 502, `Couldn't get the report from ${host} (${e.message}).`, 'text/plain'); }
  };
  // A report from the official host: each try on a fresh connection, three tries (12 seconds of silence ends one), and
  // pages asking for the same report at once share the fetch. Each fetch is logged with how long it took.
  const reportFetches = new Map();
  const fetchReport = (host, p) => {
    const key = p.toLowerCase();
    if (!reportFetches.has(key)) reportFetches.set(key, (async () => {
      const t0 = Date.now(), secs = () => ((Date.now() - t0) / 1000).toFixed(1);
      for (let n = 1; ; n++){
        try {
          const b = await fetchUpstream(`http://${host}${p}`, 0, { fresh: true, timeout: cfg.reportTimeoutMs || 12000 });
          log.info(`Battle report ${p.slice(9)} from ${host}: ${b.length} bytes in ${secs()} s${n > 1 ? ` (try ${n})` : ''}`);
          return b;
        } catch (e){
          if (n >= 3 || /^HTTP 4/.test(e.message)){ log.info(`Battle report ${p.slice(9)} from ${host}: ${e.message} after ${secs()} s, ${n} tr${n > 1 ? 'ies' : 'y'}`); throw e; }
          log.info(`Battle report ${p.slice(9)} from ${host}: ${e.message} after ${secs()} s, trying again`);
          await new Promise(r => setTimeout(r, 1000 * n));
        }
      }
    })().finally(() => reportFetches.delete(key)));
    return reportFetches.get(key);
  };

  // The official battle report viewer, WarReport.swf, which the report page reads its look from: your copy in the
  // client folder, else the one fetched once from the official download host (warReportUrl) and kept in the cache.
  // Without it the page shows the report in the game's own report view.
  let warFailed = 0;
  const warReport = async res => {
    for (const f of [path.join(path.dirname(clientFile), 'WarReport.swf'), path.join(cache, 'WarReport.swf')]) if (fs.existsSync(f)) return sendFile(res, f);
    if (Date.now() - warFailed < 10 * 60000) return send(res, 404, 'No WarReport.swf.', 'text/plain');
    const url = cfg.warReportUrl || 'http://download1.evony.com/WarReport.swf';
    try {
      const b = await fetchUpstream(url);
      if (!/^[CFZ]WS/.test(b.toString('latin1', 0, 3))) throw new Error('not a SWF');
      fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(path.join(cache, 'WarReport.swf'), b);
      log.info(`Saved the battle report viewer (${url}) in the cache`);
      res.writeHead(200, { 'Content-Type': TYPES['.swf'], 'Content-Length': b.length }); res.end(b);
    } catch (e){ warFailed = Date.now(); log.info(`No battle report viewer: ${url}: ${e.message} (put WarReport.swf in the client folder)`); send(res, 404, 'No WarReport.swf.', 'text/plain'); }
  };

  const srv = http.createServer(async (req, res) => {
    let p, query;
    try { const u = new URL(req.url, 'http://x'); p = decodeURIComponent(u.pathname); query = u.searchParams; } catch (e){ return send(res, 400, 'Bad path', 'text/plain'); }
    // Flex's HTTPService turns a GET with an XML content type into a POST, so RoboEvony POSTs for config.xml.
    if (p === '/config.xml' && req.method === 'POST'){ req.resume(); return send(res, 200, botConfig(cfg, req.headers.host), TYPES['.xml']); }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    // The game. /reset?token=... is the password reset form, which the client draws from the same page.
    if (p === '/' || p === '/index.html' || p === '/reset' || p === '/reset/') return sendFile(res, path.join(pub, 'index.html'));
    // The new JavaScript client (client-js, built into public/play): no Flash needed.
    if (p === '/play' || p === '/play/') return fs.existsSync(path.join(pub, 'play', 'index.html')) ? sendFile(res, path.join(pub, 'play', 'index.html'))
      : send(res, 404, 'The new client is not built yet (public/play is missing).', 'text/plain');
    // The admin page and the debug menu: only with the admin password (config.json's adminPassword, user "admin").
    if (ADMIN_PAGES.has(p) && !adminOk(cfg, req)){
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Server admin", charset="UTF-8"', 'Content-Type': 'text/plain' });
      return res.end(cfg.adminPassword ? 'The admin password is in config.json (adminPassword); the user name is admin.' : 'Set adminPassword in config.json first.');
    }
    // (a page returns its HTML, or { body, type })
    if (pages[p]){ try { const r = pages[p](query); return typeof r === 'string' ? send(res, 200, r, TYPES['.html']) : send(res, 200, r.body, r.type); } catch (e){ log.error(`${p}: ${e.message}`); return send(res, 500, 'Server error', 'text/plain'); } }
    if (p === '/config2.xml') return send(res, 200, config2(cfg), TYPES['.xml']);
    // Battle report links. The official site's battle*.evony.com/default.html?logfile/<date>/<xx>/<xx>/<hash>.xml
    // needs Flash; here the same address (only the host changes) is the new client drawing the report, and
    // /logfile/... is the report's XML, fetched once from the official report host (?host=, else reportHost) and
    // kept in cache/logfile.
    if (p === '/default.html') return fs.existsSync(path.join(pub, 'play', 'index.html')) ? sendFile(res, path.join(pub, 'play', 'index.html'))
      : send(res, 404, 'The new client is not built yet (public/play is missing).', 'text/plain');
    if (/^\/logfile\//i.test(p)) return reportXml(res, p, query);
    // Live mode: the recorder (recorder.js): its page and its files, an hour each.
    if (json?.recorder){
      if (p === '/recordings') return send(res, 200, require('./recorder').recordingsPage(json.recorder, json.upstream), TYPES['.html']);
      const rf = p.match(/^\/recordings\/([^/]+)$/);
      let file = null; try { file = rf && json.recorder.file(decodeURIComponent(rf[1])); } catch (e){}
      if (rf) return file && fs.existsSync(file)
        ? (res.writeHead(200, { 'Content-Type': /\.gz$/.test(file) ? 'application/gzip' : 'application/x-ndjson; charset=utf-8', 'Content-Disposition': `attachment; filename="${path.basename(file)}"`, 'Cache-Control': 'no-cache' }), fs.createReadStream(file).pipe(res))
        : send(res, 404, 'No such recording.', 'text/plain');
    }
    // Live mode: the battle capture (battlelog.js): the list, the file, and each kept report for the report page.
    if (json?.book){
      if (p === '/battles') return send(res, 200, require('./battlepage').battlesPage(json.book, query), TYPES['.html']);
      if (p === '/battles.jsonl') return fs.existsSync(json.book.file)
        ? (res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': 'attachment; filename="battles.jsonl"', 'Cache-Control': 'no-cache' }), fs.createReadStream(json.book.file).pipe(res))
        : send(res, 200, '', 'application/x-ndjson; charset=utf-8');
      const kept = /^\/battle\/([0-9a-f]{20})\.xml$/.exec(p);
      if (kept){ const r = json.book.all().find(x => x.key === kept[1]); return r?.xml ? send(res, 200, r.xml, TYPES['.xml']) : send(res, 404, 'That battle isn\'t kept here.', 'text/plain'); }
    }
    if (p.toLowerCase() === '/warreport.swf') return warReport(res);
    // For Firefox (no unsigned extensions): a userscript for Violentmonkey or Tampermonkey that sends battle report
    // links here. Opening this address with one of them installed offers to install it, with this server's address.
    if (p === '/evony-reports.user.js') return send(res, 200, userscript(`http://${cfg.host}:${cfg.httpPort}`), 'text/javascript; charset=utf-8');
    // RoboEvony (patched to take an address as its server): it reads config.xml from the address you type and
    // expects serverID to repeat it, then connects to <server>, here host:port.
    if (p === '/config.xml') return send(res, 200, botConfig(cfg, req.headers.host), TYPES['.xml']);
    if (p === '/crossdomain.xml') return send(res, 200, CROSSDOMAIN, TYPES['.xml']);
    if (p.toLowerCase() === '/' + path.basename(clientFile).toLowerCase()) return sendFile(res, clientFile);
    let rel = path.normalize(p).replace(/^([/\\])+/, '');
    if (rel.startsWith('..') || path.isAbsolute(rel)) return send(res, 400, 'Bad path', 'text/plain');
    const local = path.join(pub, rel);
    if (local.startsWith(pub + path.sep) && fs.existsSync(local) && fs.statSync(local).isFile()) return sendFile(res, local);
    const artFile = path.join(artDir, rel);
    // A historic hero's portrait (images/icon/hero/N.png) that art/flash/ doesn't have may be in DoA's own folder,
    // art/heroes/N.png (the only place the heroes DoA added, 700 and up, have one). One that art/flash/ has only as
    // a blank 1-pixel stand-in is "portrait unknown".
    const doaFace = /^(?:flash[\\/])?images[\\/]icon[\\/]hero[\\/](\d+)\.png$/.exec(rel);
    if (artFile.startsWith(artDir + path.sep) && fs.existsSync(artFile) && fs.statSync(artFile).isFile()){
      if (doaFace && fs.statSync(artFile).size < 100 && fs.existsSync(UNKNOWN_FACE)) return sendFile(res, UNKNOWN_FACE);
      return sendFile(res, artFile);
    }
    if (doaFace){ const f = path.join(artDir, 'heroes', `${Number(doaFace[1])}.png`); if (fs.existsSync(f)) return sendFile(res, f); }
    // Not in art/: this client's /flash/... is the Evony client's own images/..., from the cache or the Evony art
    // server (assetCdn), the same as the Evony server's.
    // Nothing else goes there: any other address that isn't a file here is simply not found.
    if (/^flash[\\/]/.test(rel)) rel = rel.slice(6);
    else if (!/^images[\\/]/.test(rel)) return send(res, 404, 'Not found', 'text/plain');
    const cached = path.join(cache, rel);
    if (!cached.startsWith(cache + path.sep)) return send(res, 400, 'Bad path', 'text/plain');
    if (fs.existsSync(cached)){ if (perf) perf.art.cache++; return sendFile(res, cached); }
    // Art the art server doesn't have (or couldn't be reached for, in the last 10 minutes) is answered at once
    // instead of asking it again every time the client wants that file.
    const heroFace = /^images[\\/]icon[\\/]hero[\\/](\d+)\.png$/.exec(rel);
    if (heroFace && faces?.missing(Number(heroFace[1]))){ const alt = faces.fallbackFile(Number(heroFace[1])); if (alt){ if (perf) perf.art.cache++; return sendFile(res, alt); } }
    // (with no art server to ask, a portrait nobody has here is "portrait unknown" too)
    if (heroFace && !cfg.assetCdn && faces){ const alt = faces.fallbackFile(Number(heroFace[1])); if (alt) return sendFile(res, alt); }
    if (art?.has(rel)){ if (perf) perf.art.missing++; return send(res, 404, 'Not found', 'text/plain'); }
    if (!cfg.assetCdn){ art?.mark(rel, 'not cached, and no assetCdn is set'); if (perf) perf.art.missing++; return send(res, 404, 'Not found', 'text/plain'); }
    const fetchStart = perf?.now();
    try {
      if (!inflight.has(rel)){
        inflight.set(rel, fetchUpstream(cfg.assetCdn.replace(/\/$/, '') + '/' + rel.split(path.sep).map(encodeURIComponent).join('/'))
          .then(b => { fs.mkdirSync(path.dirname(cached), { recursive: true }); fs.writeFileSync(cached, b); return b; })
          .finally(() => setTimeout(() => inflight.delete(rel), 1000)));
      }
      const b = await inflight.get(rel);
      if (perf) perf.record('art', rel, perf.now() - fetchStart);
      res.writeHead(200, { 'Content-Type': typeOf(rel), 'Content-Length': b.length }); res.end(b);
    } catch (e){
      if (perf){ perf.art.missing++; perf.record('art', rel, perf.now() - fetchStart); }
      log.debug(`asset ${rel}: ${e.message}`);
      if (!/^images[\\/]icon[\\/]hero[\\/]/.test(rel)) art?.mark(rel, `art server: ${e.message}`);
      const hero = /^images[\\/]icon[\\/]hero[\\/](\d+)\.png$/.exec(rel);
      // (a portrait the art server hasn't got, or couldn't be asked for just now, is "portrait unknown" meanwhile)
      if (hero && faces){
        if (/HTTP 404/.test(e.message)) faces.markMissing(Number(hero[1]));
        const alt = faces.fallbackFile(Number(hero[1]));
        if (alt) return sendFile(res, alt);
      }
      send(res, 404, 'Not found', 'text/plain');
    }
  });
  srv.on('error', e => { log.error(`Web server could not listen on port ${cfg.httpPort}: ${e.code || e.message}`); process.exitCode = 1; });
  // Ruffle (no Flash needed): /ruffle.html runs the client in any modern browser, its game socket over /ws.
  // (in live mode the Ruffle bridge goes to the official server too)
  require('./ws').attachSocketBridge(srv, cfg.bridge?.host || '127.0.0.1', cfg.bridge?.port || cfg.gamePort, log, json ? { ...json, perf } : null);
  srv.listen(cfg.httpPort, () => log.info(`${cfg.serverName || 'Age of War'} is running: players open ${cfg.publicUrl || `http://${cfg.host}:${cfg.httpPort}`}/ in a browser; the admin page is /admin (user admin, password in config.json)`));
  return srv;
}

module.exports = { startHttp, config2, botConfig, createFacePool, createArtLog };
