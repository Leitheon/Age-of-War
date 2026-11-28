'use strict';
// Wall defenses. Costs, build time per unit and space per unit come from the client's fortification table;
// the Walls' space is level-1,000 / 3,000 / 6,000 ... 55,000 (its "limit" / 100, as the Walls description says).
// Construction speeds them up ("constructing speed of buildings and fortified units"), and the mayor's politics, as
// for buildings (Fox's recordings, Nov 2026: 3,395 of 3,418 live times exact; the rest were taken as the mayor
// changed). An order takes one unit's time, rounded down, times the number, as troops do.
// A batch hands its defences over one at a time, evenly over its build time, as troops do (Fox, Nov 27 2026: "wall
// defences that are built in batches should finish individually from their stack just as the troops do";
// rules.fortsOneByOne: false gives the whole batch at the end). The batch being built keeps num (still to come),
// total (ordered), began (when it started), startTime (when the last one was finished, or the batch began) and
// endTime (when the last will be).
// The list's conditionBean carries the wall space as population (the Walls window reads it so: "Wall space"), so its
// Max stops at the room left on the Walls, counting what's queued (Fox, Nov 27 2026).
const WALLS = 32, POS_WALLS = -2, TECH_CONSTRUCTION = 17;

class FortLogic {
  constructor(data, rules, castleLogic){ this.data = data; this.rules = rules; this.castle = castleLogic; this.speed = castleLogic.speed; }

  queue(c){ return c.fortQ || (c.fortQ = []); }
  space(c){ const L = this.castle.level(c, WALLS); return L ? this.castle.levelData(WALLS, L).limit / 100 : 0; }
  used(c){
    let s = 0;
    for (const f of Object.values(this.data.forts)) s += (c.forts?.[f.field] || 0) * f.space;
    for (const q of this.queue(c)) s += q.num * this.data.forts[q.type].space;
    return s;
  }
  unitSeconds(p, typeId, c = null){
    const pol = c ? Math.floor(this.castle.hooks?.mayor?.(c, 'points:pol') || 0) : 0;
    return this.data.forts[typeId].time / this.speed * Math.pow(this.rules.constructionStep ?? 0.9, this.castle.techLevel(p, TECH_CONSTRUCTION)) * Math.pow(this.rules.mayorStepPerPoint ?? 0.9986, pol);
  }
  condition(c, p, typeId, num = 1){
    const f = this.data.forts[typeId], buildings = [], techs = [];
    for (const [kind, id, level] of this.rules.fortUnlock[typeId] || []){
      if (kind === 'b'){ const cur = this.castle.level(c, id); buildings.push({ typeId: id, level, curLevel: cur, successFlag: cur >= level }); }
      else { const cur = this.castle.techLevel(p, id); techs.push({ id, level, curLevel: cur, successFlag: cur >= level }); }
    }
    return { buildings, techs, items: [], food: f.food * num, wood: f.wood * num, stone: f.stone * num, iron: f.iron * num, gold: 0, population: f.space * num,
      time: Math.max(1, Math.floor(this.unitSeconds(p, typeId, c) + 1e-9) * num), destructTime: 0 };
  }
  list(c, p){
    return Object.keys(this.data.forts).map(Number).sort((a, b) => a - b).map(typeId => {
      const cond = this.condition(c, p, typeId);
      return { typeId, permition: cond.buildings.every(b => b.successFlag) && cond.techs.every(t => t.successFlag), conditionBean: cond };
    });
  }
  produce(c, p, typeId, num, now){
    const f = this.data.forts[typeId]; num = Math.floor(Number(num));
    if (!f) return [-1, 'Unknown defense.'];
    if (!(num > 0)) return [-27, 'Choose how many to build.'];
    if (!this.castle.level(c, WALLS)) return [-30, 'Build Walls first.'];
    const wallsLevel = this.castle.level(c, WALLS);
    if (this.queue(c).length >= wallsLevel) return [-51, `Your level ${wallsLevel} Walls can queue ${wallsLevel} batch${wallsLevel > 1 ? 'es' : ''}.`];
    const cond = this.condition(c, p, typeId, num);
    const miss = cond.buildings.find(x => !x.successFlag) || cond.techs.find(x => !x.successFlag);
    if (miss) return [-8, miss.typeId ? `Requires ${this.castle.typeName(miss.typeId)} level ${miss.level}.` : `Requires ${this.data.techs[miss.id]?.name} level ${miss.level}.`];
    const free = this.space(c) - this.used(c);
    if (num * f.space > free) return [-1, `Not enough room on the Walls: ${free.toLocaleString('en-US')} space left, ${(num * f.space).toLocaleString('en-US')} needed.`];
    for (const k of ['food', 'wood', 'stone', 'iron']) if (c.res[k] < cond[k]) return [-1, `Not enough ${k === 'wood' ? 'lumber' : k}.`];
    this.castle.pay(c, cond);
    c.fortSeq = (c.fortSeq || 0) + 1;
    const q = this.queue(c), item = { queueId: c.fortSeq, type: typeId, num, total: num, costTime: cond.time, began: 0, startTime: 0, endTime: 0, cost: cond };
    q.push(item);
    if (q.length === 1) this.start(item, now);
    return null;
  }
  start(item, t){ item.began = item.startTime = t; item.endTime = t + item.costTime * 1000; }
  oneByOne(){ return this.rules.fortsOneByOne !== false; }
  cancel(c, queueId, now){
    const q = this.queue(c), i = q.findIndex(x => x.queueId === queueId);
    if (i < 0) return [-23, 'That batch is already finished.'];
    // what is still to come is paid back (the defences already built stay)
    const [item] = q.splice(i, 1), share = item.num / (item.total || item.num);
    this.castle.pay(c, item.cost, 1, this.rules.fortCancelRefundRate * share);
    if (i === 0 && q.length) this.start(q[0], now);
    return null;
  }
  demolish(c, typeId, num){
    const f = this.data.forts[typeId]; num = Math.floor(Number(num));
    if (!f || !(num > 0)) return [-27, 'Choose how many to tear down.'];
    if ((c.forts?.[f.field] || 0) < num) return [-29, `You only have ${c.forts?.[f.field] || 0} ${f.name}.`];
    c.forts[f.field] -= num;
    for (const k of ['food', 'wood', 'stone', 'iron']) c.res[k] += Math.floor(f[k] * num * this.rules.fortDemolishRefundRate);
    return null;
  }
  speedUp(c, queueId, reduce, now){
    const item = this.queue(c)[0];
    if (!item || item.queueId !== queueId) return [-23, 'Only the batch now being built can be sped up.'];
    item.endTime = Math.max(now, now + reduce(item.endTime - now));
    return null;
  }
  // Hand over every defence that is due; returns true if any were.
  completeDue(c, now){
    const q = this.queue(c), oneByOne = this.oneByOne(); let changed = false;
    while (q.length && q[0].endTime){
      const it = q[0], left = it.num;
      let n = left;
      if (it.endTime > now){
        if (!oneByOne || !(left > 1)) break;
        const per = (it.endTime - it.startTime) / left;
        n = Math.min(left - 1, Math.floor((now - it.startTime) / per + 1e-9));
        if (n <= 0) break;
        it.startTime += n * per;
      }
      it.num -= n;
      const field = this.data.forts[it.type].field;
      c.forts = c.forts || {};
      c.forts[field] = (c.forts[field] || 0) + n; changed = true; this.onDone?.(c, it.type, n);
      if (it.num > 0) break;
      q.shift();
      if (q.length) this.start(q[0], it.endTime);
    }
    return changed;
  }
  // When the next defence is due.
  nextDue(c){
    const it = this.queue(c)[0];
    if (!it?.endTime) return Infinity;
    return this.oneByOne() && it.num > 1 ? it.startTime + (it.endTime - it.startTime) / it.num : it.endTime;
  }
  // The Walls window always reads the first entry, so there is always one. It shows a countdown and a bar for an
  // entry with startTime and endTime (the batch being built: from when it began, over its whole time; the rest wait).
  queueBeans(c){
    return [{ positionId: POS_WALLS, allProduceQueue: this.queue(c).map(x => {
      const from = x.endTime ? (x.began || x.startTime) : 0;
      return { queueId: x.queueId, type: x.type, num: x.num, total: x.total || x.num, startTime: from, endTime: x.endTime || 0,
        costTime: x.endTime ? Math.max(1, Math.round((x.endTime - from) / 1000)) : x.costTime };
    }) }];
  }
}

module.exports = { FortLogic };
