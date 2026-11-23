'use strict';
// Local server for the Evony Flash client (EvonyClient1921.swf, version 091103_11).
const fs = require('fs');
const path = require('path');
const gamedata = require('./gamedata');
const { loadRules } = require('./rules');
const { Store } = require('./store');
const { Game } = require('./game/game');
const { startPolicyServer, startGameServer } = require('./net');
const { startHttp, createFacePool, createArtLog } = require('./http');
const { Perf } = require('./perf');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG = {
  host: '127.0.0.1', httpPort: 8090, gamePort: 9443, policyPort: 843,
  assetCdn: 'http://e2.eimg.us', speed: 1, clientFile: 'client/EvonyClient1921.swf',
  dataDir: 'data', cacheDir: 'cache', logLevel: 'info', serverName: 'Age of War',
  // The line across the top of the game screen, and the link after it (a Discord invite, say).
  welcomeText: 'Welcome to Age of War! ', welcomeLink: '',
};

function makeLog(level, file){
  const order = { debug: 0, info: 1, warn: 2, error: 3 }, min = order[level] ?? 1;
  const out = (lvl, msg) => {
    if (order[lvl] < min) return;
    const line = `${new Date().toISOString().replace('T', ' ').slice(0, 19)} ${lvl.toUpperCase().padEnd(5)} ${msg}`;
    (lvl === 'error' ? console.error : console.log)(line);
    try { fs.appendFileSync(file, line + '\n'); } catch (e){}
  };
  return { debugOn: min === 0, debug: m => out('debug', m), info: m => out('info', m), warn: m => out('warn', m), error: m => out('error', m) };
}

// Live mode (node src/server.js --live, or "mode": "live" in config.json): the new client on an official server
// (config.json's "live": host, port...). Only the web side runs here; see live.js.
const LIVE_DEFAULTS = { server: 'na62', host: '216.66.17.168', port: 443, passwordAsTyped: true, logMessages: false, botPort: 9444, captureBattles: true,
  record: { enabled: true, maxMBPerDay: 4096 }, upstream: { direct: 15, proxies: [] } };

// Which settings file: config.json, or another one named after --config (e.g. --config config-cc2.json, the live
// client on CC2: its own ports and data folder, so it runs beside the NA62 one). Relative to the program's folder.
function configFile(overrides, argv = process.argv){
  const i = argv.indexOf('--config'), named = overrides.configFile || (i > 0 ? argv[i + 1] : '');
  return { file: path.resolve(ROOT, named || 'config.json'), named: !!named };
}

function main(overrides = {}){
  const { file: cfgFile, named } = configFile(overrides);
  if (named && !fs.existsSync(cfgFile)){ if (overrides.embedded) throw new Error(`No settings file ${cfgFile}`); console.error(`No settings file ${cfgFile} (--config).`); process.exit(1); }
  const cfg = { ...DEFAULT_CONFIG, ...(fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {}), ...overrides };
  if (process.argv.includes('--live')) cfg.mode = 'live';
  // The admin page's password (/admin and the debug menu): made on the first start and kept in config.json.
  if (!cfg.adminPassword && !overrides.embedded){
    cfg.adminPassword = require('crypto').randomBytes(9).toString('base64').replace(/[+/=]/g, 'x');
    try { const saved = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {}; saved.adminPassword = cfg.adminPassword; fs.writeFileSync(cfgFile, JSON.stringify(saved, null, 2) + '\n'); } catch (e){}
  }
  const dataDir = path.resolve(ROOT, cfg.dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const log = makeLog(cfg.logLevel, path.join(dataDir, 'server.log'));
  if (cfg.mode === 'live') return mainLive(cfg, log, overrides, cfgFile, named);

  let data;
  try { data = gamedata.load(path.resolve(ROOT, cfg.clientFile)); }
  catch (e){ log.error(e.message); process.exit(1); }
  log.info(`Loaded ${Object.keys(data.buildings).length} buildings, ${Object.keys(data.techs).length} research topics, ${Object.keys(data.troops).length} troop types from the client`);

  const protocol = JSON.parse(fs.readFileSync(path.join(ROOT, 'protocol.json'), 'utf8'));
  const perf = new Perf(log);
  const store = new Store(dataDir, log, perf);
  const rules = loadRules(dataDir, log);
  const faces = createFacePool(path.resolve(ROOT, cfg.cacheDir || 'cache'));
  const art = createArtLog(path.resolve(ROOT, cfg.cacheDir || 'cache'), log);
  const game = new Game({ store, data, rules, speed: cfg.speed, protocol, log, logDir: dataDir, faces, art, perf, site: cfg.publicUrl || `http://${cfg.host}:${cfg.httpPort}` });
  log.info(`Placed ${game.historicCount.toLocaleString('en-US')} Historic Cities on the map`);
  game.legacyLogin = !!cfg.legacyLogin;

  // The Flash client's game and policy ports: off unless "flashClient": true (players use the web client).
  const policySrv = cfg.flashClient ? startPolicyServer(cfg.policyPort, log) : null;
  const onMessage = (conn, cmd, payload) => { if (log.debugOn) log.debug(`<- ${cmd} ${JSON.stringify(payload)?.slice(0, 200)}`); game.handle(conn, cmd, payload); };
  const onClose = conn => game.disconnect(conn);
  const gameSrv = cfg.flashClient ? startGameServer(cfg.gamePort, onMessage, onClose, log, perf) : null;
  const httpSrv = startHttp({ ...cfg, buildingQueue: rules.buildQueue?.enabled !== false }, ROOT, log, { '/coins': q => game.coinsPage(q), '/admin': q => game.adminPage(q),
    '/welcome.js': () => ({ body: `window.AOW_WELCOME=${JSON.stringify(String(cfg.welcomeText ?? ''))};window.AOW_LINK=${JSON.stringify(String(cfg.welcomeLink ?? ''))};window.AOW_GOLD_PER_COIN=${Number(game.goldFinishRate?.()) || 0};`, type: 'text/javascript; charset=utf-8' }),
    '/movingText.txt': () => ({ body: game.ticker(), type: 'text/plain; charset=utf-8' }), ...require('./pages')(game) }, faces, art, perf, { onMessage, onClose });
  const ticker = setInterval(() => { const t = perf.now(); try { game.tick(); } catch (e){ log.error('tick: ' + (e.stack || e.message)); } perf.record('tick', null, perf.now() - t); }, 1000);
  if (cfg.speed !== 1) log.info(`Game speed is ${cfg.speed}x`);
  perf.reset();   // start measuring now: loading the client's data and placing the map held things up, as it should

  const close = () => { clearInterval(ticker); try { perf.loop?.disable(); } catch (e){} clearInterval(store.timer); for (const s of [policySrv, gameSrv, httpSrv]) try { s.close(); } catch (e){} try { store.flush(); } catch (e){} };
  if (!overrides.embedded){
    const stop = () => { close(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    process.on('uncaughtException', e => { log.error('Unexpected error: ' + (e.stack || e.message)); try { store.flush(); } catch (x){} });
  }
  return { game, store, cfg, close, perf };
}

function mainLive(cfg, log, overrides, cfgFile = '', named = false){
  const { liveRelay, PAGES } = require('./live');
  const live = { ...LIVE_DEFAULTS, ...(cfg.live || {}) };
  for (const k of ['record', 'upstream']) live[k] = { ...LIVE_DEFAULTS[k], ...(cfg.live?.[k] || {}) };
  // Where the server's battle reports are (its report links): battle<server>.evony.com, as battlena62.evony.com.
  const sname = String(live.server || '').trim().toLowerCase();
  if (!live.reportHost) live.reportHost = /^[a-z0-9-]{1,30}$/.test(sname) ? `battle${sname}.evony.com` : 'battlena62.evony.com';
  // Which official server: its address from its config.xml (live.lookup; connections wait for it), else live.host.
  live.configName = path.basename(cfgFile);
  live.relookup = () => (live.lookup = require('./live').lookupServer(live, log));
  live.relookup();
  if (!fs.existsSync(path.resolve(ROOT, cfg.clientFile))) log.warn(`${cfg.clientFile} is missing: the new client reads the game's data, text and art from it.`);
  const faces = createFacePool(path.resolve(ROOT, cfg.cacheDir || 'cache'));
  const art = createArtLog(path.resolve(ROOT, cfg.cacheDir || 'cache'), log);
  log.info(`Live mode: the new client plays on the official server${live.server ? ` ${String(live.server).toUpperCase()}` : ` at ${live.host}:${live.port}`} (nothing is played on this PC)${named ? ` (settings: ${path.basename(cfgFile)})` : ''}`);
  // Battle capture (battlelog.js): the reports that pass through, with what each connection knew, in data/battles.jsonl.
  let book = null;
  if (live.captureBattles !== false){
    const { BattleBook } = require('./battlelog');
    book = new BattleBook(path.resolve(ROOT, cfg.dataDir), log); book.server = sname;
    book.importCache(path.resolve(ROOT, cfg.cacheDir || 'cache'), live.reportHost);
    log.info(`Battle capture: ${book.keys.size.toLocaleString('en-US')} report${book.keys.size === 1 ? '' : 's'} kept so far (http://${cfg.host}:${cfg.httpPort}/battles)`);
  }
  // The recorder (recorder.js): every message to and from the official server, both ways, in data/recordings.
  let recorder = null;
  if (live.record.enabled !== false){
    const { Recorder } = require('./recorder');
    try { recorder = new Recorder(path.resolve(ROOT, cfg.dataDir), log, { ...live.record, server: sname }); log.info(`Recording everything that passes to the official server in ${recorder.dir} (http://${cfg.host}:${cfg.httpPort}/recordings)`); }
    catch (e){ log.warn(`The recorder couldn't start: ${e.message}`); }
  }
  // Connections to the official server, past its limit per address through SOCKS5 proxies (upstream.js).
  const { Upstream } = require('./upstream');
  const upstream = new Upstream(live, log);
  const np = upstream.proxies().length;
  if (np) log.info(`Connections to the official server: the first ${live.upstream.direct} direct, then through ${np} prox${np === 1 ? 'y' : 'ies'}`);
  const relay = liveRelay(live, log, book, recorder, upstream);
  // Each bot account's city ids (botcities.js), for the auto-login kit's fill-bot-scripts: /bot-cities.json.
  const { BotCities } = require('./botcities');
  const cities = live.botPort ? new BotCities(path.resolve(ROOT, cfg.dataDir), log, sname) : null;
  const pages = cities ? { ...PAGES, '/bot-cities.json': () => ({ body: JSON.stringify(cities.all()), type: 'application/json; charset=utf-8' }) } : PAGES;
  const httpSrv = startHttp({ ...cfg, live, bridge: { host: live.host, port: live.port } }, ROOT, log, pages, faces, art, null, relay);
  // RoboEvony's way in (its Server field set to this program's address): config.xml names this port.
  const botSrv = live.botPort ? require('./battlelog').startBotPort(live, book, log, cfg.httpPort, recorder, upstream, cities) : null;
  const close = () => { for (const s of [httpSrv, botSrv]) try { s?.close(); } catch (e){} try { recorder?.close(); } catch (e){} try { cities?.flush(); } catch (e){} };
  if (!overrides.embedded){ const stop = () => { close(); process.exit(0); }; process.on('SIGINT', stop); process.on('SIGTERM', stop); }
  return { cfg, close, live, book, recorder, upstream, cities };
}

if (require.main === module) main();
module.exports = { main, configFile };
