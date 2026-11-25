'use strict';
// Troop training. Each barracks has its own queue; batches run one after another.
// Costs, population, upkeep and per-unit time come from the client's troop table.
// A batch hands its troops over one at a time, evenly over its training time (Fox, m3.103: 1,000 warriors at 3
// seconds each arrive one every 3 seconds; the live game gave all 1,000 at the end, rules.troopsOneByOne: false).
// The batch in training keeps num (troops still to come: what the queue shows), total (troops ordered), startTime
// (when the last one arrived, or the batch began) and endTime (when the last will): the next one is due
// (endTime - startTime) / num after startTime.
const { TYPE, addTroops, TROOP_MAX } = require('./castle');
const TECH_MILITARY_SCIENCE = 8, TECH_METAL_CASTING = 5;
// Metal Casting "enhances production speed of mechanics": Transporter, Ballista, Battering Ram, Catapult.
const MECHANICS = new Set([8, 11, 12, 13]);

class TroopLogic {
  constructor(data, rules, castleLogic){ this.data = data; this.rules = rules; this.castle = castleLogic; this.speed = castleLogic.speed; }

  deps(c, p, list){
    const buildings = [], techs = [];
    for (const [kind, id, level] of list || []){
      if (kind === 'b'){ const cur = this.castle.level(c, id); buildings.push({ typeId: id, level, curLevel: cur, successFlag: cur >= level }); }
      else { const cur = this.castle.techLevel(p, id); techs.push({ id, level, curLevel: cur, successFlag: cur >= level }); }
    }
    return { buildings, techs };
  }
  // One troop's training time, as live works it out (Fox's recordings, Nov 2026: 396 of 396 Barracks list times and
  // 6,081 of 6,087 orders exact): the client's base time x 0.9 a level of Military Science, or of Metal Casting
  // instead for Transporters, Ballistae, Rams and Catapults (live counts only Metal Casting for them), x 0.9986 a
  // whole point of the mayor's attack (gear and buffs included). An order takes this, rounded down, times the
  // number. The Barracks' level doesn't matter (levels 4 to 10 alike).
  unitSeconds(c, p, typeId){
    const t = this.data.troops[typeId];
    const barracks = this.castle.level(c, TYPE.BARRACKS);
    const mech = MECHANICS.has(Number(typeId)), tech = mech ? TECH_METAL_CASTING : TECH_MILITARY_SCIENCE;
    const step = mech ? (this.rules.metalCastingStep ?? this.rules.militaryScienceStep) : this.rules.militaryScienceStep, L = this.castle.techLevel(p, tech);
    const science = step ? Math.pow(step, L) : 1 / (1 + this.castle.techEffect(p, tech) / 100);
    const barracksBonus = (this.rules.trainingSpeedPerBarracksLevel || 0) * Math.max(0, barracks - 1);
    // The mayor's attack: each whole point takes rules.mayorStepPerPoint off what is left.
    const atk = Math.floor(this.castle.hooks?.mayor?.(c, 'attack') || 0);
    const mayor = atk > 0 ? Math.pow(this.rules.mayorStepPerPoint ?? 0.9986, atk) : 1;
    const item = this.castle.hooks?.trainBonus?.(p, Date.now()) || 0;   // (Christmas Gift: +10% speed)
    return t.time / this.speed * science * mayor / (1 + barracksBonus + item);
  }
  condition(c, p, typeId, num = 1){
    const t = this.data.troops[typeId];
    const { buildings, techs } = this.deps(c, p, this.rules.troopUnlock[typeId]);
    const cut = 1 - (this.costCut?.(p, typeId) || 0) / 100;   // the achievements' infantry, cavalry and mechanics bonuses
    return { buildings, techs, items: [], food: Math.round(t.food * cut) * num, wood: Math.round(t.wood * cut) * num, stone: Math.round(t.stone * cut) * num, iron: Math.round(t.iron * cut) * num, gold: 0,
      population: t.population * num, time: Math.max(1, Math.floor(this.unitSeconds(c, p, typeId) + 1e-9) * num), destructTime: 0 };
  }
  unlocked(cond){ return cond.buildings.every(b => b.successFlag) && cond.techs.every(t => t.successFlag); }
  produceList(c, p){
    return Object.keys(this.data.troops).map(Number).sort((a, b) => a - b).map(typeId => {
      const cond = this.condition(c, p, typeId, 1);
      return { typeId, permition: this.unlocked(cond), conditionBean: cond };
    });
  }

  queues(c){ return c.trainQ || (c.trainQ = {}); }
  barracks(c){ return Object.entries(c.buildings).filter(([, b]) => b.typeId === TYPE.BARRACKS && b.level > 0).map(([pos, b]) => ({ pos: Number(pos), level: b.level })); }
  queueLimit(c, pos){ const b = c.buildings[pos]; return b ? Math.max(1, this.castle.levelData(b.typeId, b.level)?.limit || b.level) : 0; }

  // Train num troops in the barracks at pos, or (pos 0: the recruit window's "spread production evenly across
  // the barracks") split evenly over every barracks with room in its queue, or with toIdle ("only to idle
  // barracks") over those with nothing queued. Returns an error or null.
  produce(c, p, pos, typeId, num, now, toIdle = false){
    const t = this.data.troops[typeId];
    if (!t) return [-1, 'Unknown troop type.'];
    num = Math.floor(Number(num));
    if (!(num > 0)) return [-27, 'Choose how many to train.'];
    const all = this.barracks(c);
    if (!all.length) return [-30, 'You need a Barracks to train troops.'];
    const queued = b => (this.queues(c)[b.pos] || []).length;
    let targets;
    if (!pos){
      targets = all.filter(b => toIdle ? queued(b) === 0 : queued(b) < this.queueLimit(c, b.pos))
        .sort((a, b) => queued(a) - queued(b) || a.pos - b.pos);
      if (!targets.length) return toIdle ? [-1, 'Every Barracks is busy.'] : [-51, "Every Barracks' queue is full."];
    } else {
      const b = c.buildings[pos];
      if (!b || b.typeId !== TYPE.BARRACKS || b.level === 0) return [-30, 'There is no Barracks there.'];
      const limit = this.queueLimit(c, pos);
      if (queued({ pos }) >= limit) return [-51, `This Barracks can queue ${limit} batch${limit > 1 ? 'es' : ''}. Upgrade it to queue more.`];
      targets = [{ pos }];
    }
    // (A city holds at most TROOP_MAX of a type: 9,999,999,999. Live let a count wrap negative; not here.)
    if ((c.troops[t.field] || 0) + num > TROOP_MAX) return [-1, `A city can hold at most ${TROOP_MAX.toLocaleString('en-US')} of each troop type.`];
    const cond = this.condition(c, p, typeId, num);
    const missB = cond.buildings.find(x => !x.successFlag), missT = cond.techs.find(x => !x.successFlag);
    if (missB) return [-8, `Requires ${this.castle.typeName(missB.typeId)} level ${missB.level}.`];
    if (missT) return [-9, `Requires ${this.data.techs[missT.id]?.name || 'research'} level ${missT.level}.`];
    for (const k of ['food', 'wood', 'stone', 'iron']) if (c.res[k] < cond[k]) return [-1, `Not enough ${k === 'wood' ? 'lumber' : k}.`];
    if (Math.floor(c.pop) < cond.population) return [-10, `Not enough idle population (${cond.population} needed).`];
    // Each barracks gets an even share (the first ones one more while the remainder lasts); the shares' costs add up
    // to the whole order's.
    const k = Math.min(targets.length, num), each = Math.floor(num / k), extra = num % k;
    for (let i = 0; i < k; i++) this.enqueue(c, p, targets[i].pos, typeId, each + (i < extra ? 1 : 0), now);
    return null;
  }
  enqueue(c, p, pos, typeId, num, now){
    const cond = this.condition(c, p, typeId, num);
    this.castle.pay(c, cond);
    c.pop -= cond.population;
    c.trainSeq = (c.trainSeq || 0) + 1;
    const q = this.queues(c)[pos] || (this.queues(c)[pos] = []);
    const item = { queueId: c.trainSeq, type: typeId, num, total: num, costTime: cond.time, startTime: 0, endTime: 0, cost: cond };
    q.push(item);
    if (q.length === 1){ item.startTime = now; item.endTime = now + item.costTime * 1000; }
  }
  // Call off a batch: what is still to come is paid back (the troops already trained stay).
  cancel(c, pos, queueId, now){
    const q = this.queues(c)[pos]; const i = q ? q.findIndex(x => x.queueId === queueId) : -1;
    if (i < 0) return [-23, 'That training batch is already finished.'];
    const [item] = q.splice(i, 1), share = item.num / (item.total || item.num);
    this.castle.pay(c, item.cost, 1, this.rules.troopCancelRefundRate * share);
    c.pop += Math.round(item.cost.population * share);
    if (i === 0 && q.length){ q[0].startTime = now; q[0].endTime = now + q[0].costTime * 1000; }
    return null;
  }
  // Shorten the batch now in training. Returns an error or null.
  speedUp(c, pos, queueId, reduce, now){
    const q = this.queues(c)[pos]; const item = q && q[0];
    if (!item || item.queueId !== queueId) return [-23, 'Only the batch now in training can be sped up.'];
    item.endTime = Math.max(now, reduce(item.endTime - now) + now);
    return null;
  }
  // Hand over every troop that is due; returns true if troops changed.
  completeDue(c, now){
    let changed = false;
    const oneByOne = this.rules.troopsOneByOne !== false;
    for (const q of Object.values(this.queues(c))){
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
        const field = this.data.troops[it.type].field;
        c.troops[field] = addTroops(c.troops[field], n);
        changed = true; this.onDone?.(c, it.type, n);
        if (it.num > 0) break;
        q.shift();
        if (q.length){ q[0].startTime = it.endTime; q[0].endTime = it.endTime + q[0].costTime * 1000; }
      }
    }
    return changed;
  }
  // When the next troop is due anywhere in the city.
  nextDue(c){
    let t = Infinity;
    const oneByOne = this.rules.troopsOneByOne !== false;
    for (const q of Object.values(this.queues(c))){
      const it = q[0]; if (!it?.endTime) continue;
      t = Math.min(t, oneByOne && it.num > 1 ? it.startTime + (it.endTime - it.startTime) / it.num : it.endTime);
    }
    return t;
  }
  queueBeans(c){
    return this.barracks(c).map(({ pos }) => ({
      positionId: pos,
      // (the batch in training counts only the time its troops still to come take)
      allProduceQueue: (this.queues(c)[pos] || []).map(x => ({ queueId: x.queueId, type: x.type, num: x.num,
        costTime: x.endTime ? Math.max(0, Math.ceil((x.endTime - x.startTime) / 1000 - 1e-6)) : x.costTime, endTime: x.endTime || 0 })),
    }));
  }
}

module.exports = { TroopLogic };
