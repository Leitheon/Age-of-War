'use strict';
// Gifts to the whole server (Fox, Nov 28 2026: "I also need a way to gift items to the entire server at once. Since it
// is the holidays, I want players to get a holiday chest. Not just current players, but players that join in the next
// 30 days."). The admin page's Gifts tab sends an item (so many of it) to every lord at once, each with a mail in his
// System box saying so, and to every lord founded for `newDays` days after (when his lord is made). A lord gets each
// gift once. The gifts are kept through a Fresh start (game.freshWorld), so one still running reaches everyone again on
// the new world. The admin can stop one early (newcomers stop getting it).
const DAY = 86400e3, MAX_COUNT = 1000, MAX_DAYS = 365;

class Gifts {
  constructor(g){ this.g = g; }
  get list(){ return (this.g.db.gifts ??= []); }
  // An item by its id or its exact name ("Christmas Chest"); several with one name: the id is needed.
  find(text){
    const items = this.g.data.items || {}, t = String(text || '').trim();
    if (!t) return [null, 'Choose an item.'];
    if (items[t] && Object.hasOwn(items, t)) return [t, null];
    const same = Object.keys(items).filter(id => String(items[id].name || '').toLowerCase() === t.toLowerCase());
    if (same.length === 1) return [same[0], null];
    if (same.length > 1) return [null, `Several items are called ${t}: pick one from the list (${same.slice(0, 6).join(', ')}).`];
    return [null, `There is no item called ${t}.`];
  }
  name(id){ return this.g.data.items?.[id]?.name || id; }
  active(now = this.g.now()){ return this.list.filter(x => !x.stopped && x.until > now); }
  // Send: to every lord now, and to the lords founded in the next newDays days. Returns the gift, or [code, message].
  send({ item, count = 1, newDays = 30, title, text, by = 'admin' } = {}, now = this.g.now()){
    const [itemId, why] = this.find(item); if (!itemId) return [-1, why];
    count = Math.floor(Number(count)); newDays = Math.floor(Number(newDays));
    if (!(count >= 1 && count <= MAX_COUNT)) return [-1, `Give 1 to ${MAX_COUNT} of it.`];
    if (!(newDays >= 0 && newDays <= MAX_DAYS)) return [-1, `New players can get it for 0 to ${MAX_DAYS} days.`];
    const n = this.name(itemId), what = `${count > 1 ? count + ' × ' : ''}${n}`;
    const gift = { id: (this.list.reduce((m, x) => Math.max(m, x.id), 0) || 0) + 1, itemId, count, at: now, until: now + newDays * DAY, newDays, by,
      title: String(title || '').trim().slice(0, 60) || 'Happy holidays!',
      text: String(text || '').trim().slice(0, 600) || `The Age of War team sends you ${what}. You'll find it in My Items. Happy holidays!`,
      given: 0, stopped: false };
    this.list.push(gift);
    for (const p of Object.values(this.g.db.players || {})) this.give(p, gift, now);
    this.g.store.touch();
    this.g.log.info(`Gift to everyone: ${what} to ${gift.given} lord${gift.given === 1 ? '' : 's'}${newDays ? `, and to new lords for ${newDays} days` : ''}`);
    return gift;
  }
  give(p, gift, now = this.g.now()){
    if (!p || (p.gifts || []).includes(gift.id)) return false;
    (p.gifts ??= []).push(gift.id);
    this.g.items.add(p, gift.itemId, gift.count);
    this.g.mail?.system(p, gift.title, gift.text, now);
    gift.given++;
    this.g.pushItems?.(p, [gift.itemId]);
    return true;
  }
  // A new lord (game.createPlayer): every gift still open to newcomers.
  welcome(p, now = this.g.now()){
    let n = 0;
    for (const gift of this.active(now)) if (this.give(p, gift, now)) n++;
    if (n) this.g.store.touch();
    return n;
  }
  stop(id, now = this.g.now()){
    const gift = this.list.find(x => x.id === Number(id));
    if (!gift) return [-1, 'There is no such gift.'];
    if (gift.stopped || gift.until <= now) return [-1, 'New players already don\'t get that gift.'];
    gift.stopped = true; gift.stoppedAt = now; this.g.store.touch();
    return gift;
  }
}

module.exports = { Gifts };
