'use strict';
// World state kept in one JSON file (data/world.json), saved every few seconds and on exit.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dataDir, log, perf = null){
    this.file = path.join(dataDir, 'world.json'); this.log = log; this.perf = perf; this.dirty = false;
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = { version: 1, seq: 100, seed: (Math.random() * 2 ** 31) | 0, accounts: {}, players: {}, castles: {}, tiles: {} };
    if (fs.existsSync(this.file)){
      try { this.db = { ...this.db, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; }
      catch (e){
        const bad = this.file + '.unreadable-' + Date.now();
        fs.copyFileSync(this.file, bad);
        log.error(`world.json could not be read (${e.message}). A copy was kept as ${path.basename(bad)}; starting a fresh world.`);
      }
    }
    this.timer = setInterval(() => this.flush(), 5000);
    this.timer.unref?.();
  }
  id(){ this.dirty = true; return ++this.db.seq; }
  touch(){ this.dirty = true; }
  flush(){
    if (!this.dirty || this.held) return;
    const tmp = this.file + '.tmp', t = this.perf?.now();
    const text = JSON.stringify(this.db);
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, this.file);
    this.dirty = false;
    if (this.perf){ this.perf.saveBytes = text.length; this.perf.record('save', null, this.perf.now() - t); }
  }
  // Write `db` as the world now and save nothing more (the admin page's fresh start, game.wipeWorld: the server
  // restarts on the new file, and what's still in memory is thrown away).
  replaceAndHold(db){
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, this.file);
    this.held = true; this.dirty = false;
  }
}

module.exports = { Store };
