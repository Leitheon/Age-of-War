'use strict';
// Gift packages: the "My Package Locker" window (GiftFrame; "Evony holds various events or activities every now and
// then. By participating in these events, players may receive gift packages which include in-game resources and
// different items."). The box beside the minimap shows how many are waiting (common.getPackageNumber).
//   - common.getPackageList: PackageBeans, status 2 "Claim Now" (PACKAGE_STATUS_AVAIBLE) or 4 "Claimed"; the window
//     sorts them into unclaimed and claimed. (1 asks for a serial code, 3 "Insufficient requirement", 5 used: this
//     server gives neither serial codes nor conditional packages.)
//   - common.getPackage(ruleId, serial): claims package ruleId; its items go into Items.
// On this server packages come from the debug menu (a package for one lord or for every lord).
const pad = n => String(n).padStart(2, '0');
const dateTime = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const STATUS = { SERIAL: 1, AVAILABLE: 2, NOT_MET: 3, GOT: 4, USED: 5 };
const KEEP = 50;   // claimed packages kept in the locker

class Packages {
  constructor(game){ this.g = game; }
  list(p){ return p.packages || (p.packages = []); }
  live(p, now = this.g.now()){ return this.list(p).filter(k => k.status === STATUS.GOT || !k.expiresAt || k.expiresAt > now); }
  waiting(p, now = this.g.now()){ return this.live(p, now).filter(k => k.status === STATUS.AVAILABLE).length; }
  bean(k){
    const I = this.g.items;
    return { id: k.id, packageName: k.name, desc: k.desc || 'A gift from the server.', type: 0, isUseNow: 0, scores: 0, minMedal: 0, maxMedal: 0,
      status: k.status, provideTime: k.at, expiredTime: k.expiresAt || 0, claimedTime: k.claimedAt ? dateTime(k.claimedAt) : '',
      itemList: k.items.map(x => ({ id: x.id, name: I.name(x.id), count: x.count, minCount: 0, maxCount: 0 })) };
  }
  beans(p, now = this.g.now()){ return this.live(p, now).map(k => this.bean(k)); }
  // items: [{ id, count }] (item ids from the client's item table).
  give(p, name, desc, items, days, now = this.g.now()){
    p.packageSeq = (p.packageSeq || 0) + 1;
    const k = { id: p.packageSeq, name: String(name || 'Gift Package').slice(0, 60), desc: String(desc || '').slice(0, 300), items: items.map(x => ({ id: x.id, count: x.count })),
      at: now, expiresAt: days > 0 ? now + days * 86400000 : 0, status: STATUS.AVAILABLE };
    this.list(p).unshift(k);
    const got = this.list(p).filter(x => x.status === STATUS.GOT);
    if (got.length > KEEP){ const drop = new Set(got.slice(KEEP)); p.packages = this.list(p).filter(x => !drop.has(x)); }
    this.g.store.touch();
    this.pushNumber(p, now);
    return k;
  }
  // The box's count: the client listens for common.getPackageNumber replies (server.PackageList has no listener).
  pushNumber(p, now){ this.g.push(p.id, 'common.getPackageNumber', { number: this.waiting(p, now) }); }
  claim(p, ruleId, now = this.g.now()){
    const k = this.live(p, now).find(x => x.id === Number(ruleId));
    if (!k) return [-1, "That package isn't in your locker."];
    if (k.status === STATUS.GOT) return [-1, 'You have already claimed this package.'];
    if (k.status !== STATUS.AVAILABLE) return [-1, "This package can't be claimed."];
    for (const x of k.items) this.g.items.add(p, x.id, x.count);
    k.status = STATUS.GOT; k.claimedAt = now;
    this.g.store.touch();
    this.g.log.info(`${p.name} claimed the package ${k.name}`);
    return { items: k.items.map(x => x.id), pkg: k };
  }
}

module.exports = { Packages, PACKAGE_STATUS: STATUS };
