'use strict';
// Which cities each RoboEvony account has, learned on the bot port as the bots log in (and found new towns), so the
// auto-login kit can fill in each city's Script and Goals tabs without anyone opening 50 bots (Fox's CA7 accounts,
// Nov 2026). The bot keeps those tabs per city id (Flash local storage "citytab<id>" and "citygoals<id>"), and only
// the official server's answers say which ids an account has.
//
// Kept in <dataDir>/bot-cities.json and served at /bot-cities.json. An account is known only by key(): a hash of its
// name, which the kit works out from its own accounts list. The name (an e-mail address) is never written.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const key = user => crypto.createHash('sha256').update('evony-bot:' + String(user ?? '').trim().toLowerCase(), 'utf8').digest('hex');

class BotCities {
  constructor(dir, log, server = ''){
    this.file = path.join(dir, 'bot-cities.json'); this.log = log; this.server = String(server || '').toLowerCase(); this.timer = null;
    this.accounts = {};
    try { const d = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (d && typeof d.accounts === 'object') this.accounts = d.accounts; } catch (e){}
  }
  // On a login: the lord's name and every city id it has now.
  set(k, lord, ids){
    if (!/^[0-9a-f]{64}$/.test(String(k))) return;
    this.accounts[k] = { lord: String(lord || '').slice(0, 40), castles: [...new Set((ids || []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0))], at: new Date().toISOString() };
    this.save();
  }
  // A town founded or taken (server.CastleUpdate), or lost.
  add(k, id){
    const r = this.accounts[k]; id = Number(id);
    if (!r || !Number.isSafeInteger(id) || id <= 0 || r.castles.includes(id)) return;
    r.castles.push(id); r.at = new Date().toISOString(); this.save();
  }
  remove(k, id){
    const r = this.accounts[k]; id = Number(id);
    if (!r || !r.castles.includes(id)) return;
    r.castles = r.castles.filter(c => c !== id); r.at = new Date().toISOString(); this.save();
  }
  all(){ return { server: this.server, accounts: this.accounts }; }
  save(){ if (this.timer) return; this.timer = setTimeout(() => this.flush(), 1000); this.timer.unref?.(); }
  flush(){
    clearTimeout(this.timer); this.timer = null;
    try { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.all(), null, 1)); fs.renameSync(this.file + '.tmp', this.file); }
    catch (e){ this.log?.warn?.(`Couldn't save ${this.file}: ${e.code || e.message}`); }
  }
}

module.exports = { BotCities, key };
