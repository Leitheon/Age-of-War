'use strict';
// Automatic backups of the world (Fox, Nov 28 2026: "I want the server to backup every 3 hours, and save 3 days of
// backups"). Every rules.backups.everyHours the world is saved and a copy of data/world.json goes in data/backups as
// world-auto-YYYY-MM-DD-HH-MM.json (the time in UTC); copies older than keepDays are deleted. The admin page's Fresh
// start makes its own copy (world-before-wipe-...), which is never deleted. The clock is the computer's (not the game's
// speed), and a restart doesn't start the count over: the next copy is due everyHours after the newest one, so a
// server that was off longer than that makes one as it starts. everyHours 0 turns backups off.
// To go back to a copy: stop the server, put the copy in the data folder as world.json, and start it again.
const fs = require('fs'), path = require('path');

const AUTO = /^world-auto-(\d{4})-(\d\d)-(\d\d)-(\d\d)-(\d\d)\.json$/, WIPE = /^world-before-wipe-(\d{4})-(\d\d)-(\d\d)-(\d\d)-(\d\d)\.json$/;
const stamp = t => new Date(t).toISOString().slice(0, 16).replace(/[:T]/g, '-');

class Backups {
  constructor(store, opts = {}, log, clock = Date.now){
    this.store = store; this.log = log; this.clock = clock;
    this.dir = path.join(path.dirname(store.file), 'backups');
    this.every = Math.max(0, Number(opts.everyHours ?? 3)) * 3600e3;
    this.keep = Math.max(0, Number(opts.keepDays ?? 3)) * 86400e3;
    this.last = this.list().find(b => b.auto)?.at || 0;
    this.failedAt = 0;
  }
  // Every copy in data/backups, newest first: { name, file, at (when it was made), kb, auto }.
  list(){
    let names = []; try { names = fs.readdirSync(this.dir); } catch (e){}
    return names.map(name => {
      const m = name.match(AUTO) || name.match(WIPE); if (!m) return null;
      const file = path.join(this.dir, name);
      let kb = 0; try { kb = Math.round(fs.statSync(file).size / 1024); } catch (e){}
      return { name, file, at: Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]), kb, auto: AUTO.test(name) };
    }).filter(Boolean).sort((x, y) => y.at - x.at || (y.name < x.name ? -1 : 1));
  }
  // When the next copy is due (null: backups are off).
  next(){ return this.every ? Math.max(this.last + this.every, this.clock()) : null; }
  // Checked every minute (server.js). Not after a Fresh start: the server is about to restart on the new world.
  tick(now = this.clock()){
    if (!this.every || this.store.held || now - this.last < this.every) return null;
    if (this.failedAt && now - this.failedAt < 10 * 60e3) return null;      // (after a failure, try again in 10 minutes)
    try { return this.make(now); }
    catch (e){ this.failedAt = now; this.log.error(`Backup failed: ${e.message}`); return null; }
  }
  make(now = this.clock()){
    this.store.flush();
    if (!fs.existsSync(this.store.file)) return null;                    // (nothing saved yet)
    fs.mkdirSync(this.dir, { recursive: true });
    const name = `world-auto-${stamp(now)}.json`, file = path.join(this.dir, name), tmp = file + '.tmp';
    fs.copyFileSync(this.store.file, tmp);
    fs.renameSync(tmp, file);
    this.last = now; this.failedAt = 0;
    const gone = this.prune(now);
    this.log.info(`Backed up the world to ${name}${gone ? ` (${gone} older than ${this.keep / 86400e3} days deleted)` : ''}`);
    return file;
  }
  prune(now = this.clock()){
    let n = 0;
    for (const b of this.list()) if (b.auto && now - b.at > this.keep){ try { fs.rmSync(b.file, { force: true }); n++; } catch (e){} }
    return n;
  }
}

module.exports = { Backups };
