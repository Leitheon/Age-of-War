'use strict';
// Chat (the client's ChatFrame): the World channel, the Beginners' channel, whispers, and the Governor's mute.
//   - "Speaker: Used while speaking in World channel": each World message uses one Speaker (the client asks for
//     one in the Beginners' channel too, so it uses one there as well). The Governor talks free; the client checks
//     the same flag (bdenyotherplayer).
//   - "You cannot speak in world chat until the Beginner's Protection expires": a lord under beginner's protection
//     has the Beginners' channel ("In Beginner chat you can communicate with all the players of this server").
//   - The Governor shows as "Governor <name>" (fame.chatName); the client paints any name with "Gove" in it orange.
//     From a lord's name in the chat he can mute him for 30 minutes ("You have muted X for 30 mins.").
//   - Publicity Ambassador badges (the PlayerSpeakerBuf_* buffs) put their icon before the name (ownitemid 1-6).
//   - Alliance chat: "In Alliance chat, you can communicate with the members of your own alliance" (no Speaker).
//   - A lord on someone's blocklist (friends.js) doesn't reach him by whisper or alliance chat; world chat can't be
//     blocked.
// Messages go to the other lords online; the Flash client shows the sender's own line itself.
//
// The web client (a connection signed in through auth.js, conn.web) is different: it shows only what the server
// sends, so its sender gets his own line back too; World and Beginners' lines both come as server.ChannelChatMsg
// (with channel), whispers carry toUser so that the sender's copy reads "To X", and text is plain (it draws it as
// text, not HTML). Its World chat needs no Speaker and is open to beginners (rules.chat.webFree), and it doesn't show
// refusals, so a refused line comes back to the sender as a "(Not sent: ...)" line in the chat. On signing in it
// gets the last rules.chat.history World and Alliance lines (kept in db.chatLog; whispers aren't kept).
const SPEAKER = 'consume.1.a';
const BADGES = [['PlayerSpeakerBuf_GPAP', 6], ['PlayerSpeakerBuf_GPAP_15', 5], ['PlayerSpeakerBuf_SPAP', 4], ['PlayerSpeakerBuf_SPAP_15', 3], ['PlayerSpeakerBuf_BPAP', 2], ['PlayerSpeakerBuf_BPAP_15', 1]];
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

class Chat {
  constructor(game){ this.g = game; }
  get rules(){ return this.g.rules.chat || {}; }
  badge(p, now = this.g.now()){ for (const [b, n] of BADGES) if (this.g.logic.buffActive(p, b, now)) return n; return 0; }
  clean(msg){ return String(msg ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, this.rules.maxLength ?? 300); }
  web(id){ return !!this.g.online.get(id)?.web; }
  // One line to each of ids: the web client's form to web connections, the Flash client's (HTML-escaped) to the rest;
  // the sender's own copy only to a web sender.
  deliver(ids, from, [flashCmd, flashLine], [webCmd, webLine]){
    for (const id of ids){
      if (this.web(id)) this.g.push(id, webCmd, webLine);
      else if (id !== from) this.g.push(id, flashCmd, { ...flashLine, msg: esc(flashLine.msg) });
    }
  }
  // The last lines of the World channel and of each alliance's chat, for lords who sign in later.
  remember(key, line){
    const log = (this.g.db.chatLog ??= {}), list = (log[key] ??= []), max = this.rules.history ?? 50;
    list.push({ fromUser: line.fromUser, msg: line.msg, time: line.time });
    if (list.length > max) list.splice(0, list.length - max);
    this.g.store.touch();
  }
  backlog(conn){
    const p = conn.player, log = this.g.db.chatLog || {}, a = this.g.alliances.of(p);
    if (!p || !conn.web) return;
    for (const l of log.world || []) conn.send('server.ChannelChatMsg', { ok: 1, packageId: 0, channel: 'world', ...l });
    if (a) for (const l of log['alliance:' + a.id] || []) conn.send('server.AllianceChatMsg', { ok: 1, packageId: 0, ...l });
  }
  // A refused line, back to a web sender (the client drops the refusal itself): in the tab he wrote in.
  refused(conn, where, why){
    if (!conn.web || !conn.player) return;
    const line = { msg: `(Not sent: ${why})`, time: this.g.now() };
    if (where !== 'alliance') this.g.push(conn.player.id, 'server.ChannelChatMsg', { channel: 'world', ...line });
    if (where !== 'world') this.g.push(conn.player.id, 'server.AllianceChatMsg', line);
  }
  muted(p, now = this.g.now()){ return (p.mutedUntil || 0) > now ? p.mutedUntil : 0; }
  // A lord by the name the chat shows (the Governor's carries "Governor "/"Governess " in front).
  byName(name){
    const m = this.g.mail;
    return m.playerByName(name) || m.playerByName(String(name || '').trim().replace(/^Govern(or|ess)\s+/i, ''));
  }
  // Why p can't talk in the World or Beginners' channel, or null; takes the Speaker when he can.
  speak(p, channel, now){
    const until = this.muted(p, now);
    if (until) return [-1, `You have been muted for ${Math.ceil((until - now) / 60000)} more minutes.`];
    if (this.web(p.id) && this.rules.webFree !== false) return null;
    if (channel === 'world' && this.g.war.beginner(p, now) && this.rules.beginnersInWorld !== true) return [-1, "You cannot speak in world chat until the Beginner's Protection expires."];
    if (this.g.fame.isGovernor(p, now) || this.rules.speakers === false) return null;
    // A Speaker, or else one out of a Speaker package (10 or 100), the rest becoming Speakers.
    const I = this.g.items;
    if (I.take(p, SPEAKER)){ this.g.pushItems(p, [SPEAKER]); return null; }
    for (const [id, n] of [['consume.1.b', 10], ['consume.1.c', 100]]) if (I.take(p, id)){ I.add(p, SPEAKER, n - 1); this.g.pushItems(p, [id, SPEAKER]); return null; }
    return [-44, 'You have insufficient Speakers to chat in World channel. Please purchase Speakers in the Shop.'];
  }
  world(p, msg, lang, now){
    const text = this.clean(msg); if (!text) return [-1, 'You cannot send a blank message.'];
    const why = this.speak(p, 'world', now); if (why) return why;
    const line = { channel: 'world', fromUser: this.g.fame.chatName(p), msg: text, languageType: Number(lang) || 0, ownitemid: this.badge(p, now) };
    this.deliver([...this.g.online.keys()], p.id, ['server.WorldChatMsg', line], ['server.ChannelChatMsg', { ...line, time: now }]);
    this.remember('world', { ...line, time: now });
    this.g.log.info(`[World] ${line.fromUser}: ${text}`);
    return {};
  }
  channel(p, channel, msg, lang, now){
    channel = String(channel || '');
    if (channel === 'world') return this.world(p, msg, lang, now);
    if (channel !== 'beginner') return [-1, 'There is no such channel.'];
    const text = this.clean(msg); if (!text) return [-1, 'You cannot send a blank message.'];
    const why = this.speak(p, channel, now); if (why) return why;
    const line = { channel, fromUser: this.g.fame.chatName(p), msg: text, languageType: Number(lang) || 0, ownitemid: this.badge(p, now) };
    this.deliver([...this.g.online.keys()], p.id, ['server.ChannelChatMsg', line], ['server.ChannelChatMsg', { ...line, time: now }]);
    this.g.log.info(`[Beginners] ${line.fromUser}: ${text}`);
    return {};
  }
  alliance(p, msg, lang, now){
    const a = this.g.alliances.of(p); if (!a) return [-1, 'You are not in an alliance.'];
    const text = this.clean(msg); if (!text) return [-1, 'You cannot send a blank message.'];
    const until = this.muted(p, now); if (until) return [-1, `You have been muted for ${Math.ceil((until - now) / 60000)} more minutes.`];
    const line = { fromUser: this.g.fame.chatName(p), msg: text, languageType: Number(lang) || 0, ownitemid: this.badge(p, now) };
    const ids = a.members.filter(id => id === p.id || (this.g.online.has(id) && !this.g.friends.blocked(this.g.db.players[id], p)));
    this.deliver(ids, p.id, ['server.AllianceChatMsg', line], ['server.AllianceChatMsg', { ...line, time: now }]);
    this.remember('alliance:' + a.id, { ...line, time: now });
    this.g.quests.flag(p, 'allianceChat');
    return {};
  }
  whisper(p, name, msg, now){
    const to = this.byName(name);
    if (!to) return [-3, `There is no lord called ${String(name || '').trim()}.`];
    if (to.id === p.id) return [-1, 'Unable talk to yourself'];
    const text = this.clean(msg); if (!text) return [-1, 'You cannot send a blank message.'];
    const until = this.muted(p, now); if (until) return [-1, `You have been muted for ${Math.ceil((until - now) / 60000)} more minutes.`];
    if (!this.g.online.has(to.id)) return [-3, `${to.name} is not online. Send a letter instead.`];
    const line = { fromUser: p.name, msg: text, chatType: 0, ownitemid: this.badge(p, now) };
    const ids = this.g.friends.blocked(to, p) ? [p.id] : [to.id, p.id];   // (on his blocklist: it never reaches him)
    this.deliver(ids, p.id, ['server.PrivateChatMessage', line], ['server.PrivateChatMessage', { ...line, toUser: to.name, time: now }]);
    return {};
  }
  // The Governor's mute (the client asks for 30 minutes).
  mute(p, name, minutes, now){
    if (!this.g.fame.isGovernor(p, now)) return [-42, 'Only the Governor can mute other lords.'];
    const q = this.byName(name);
    if (!q) return [-41, `There is no lord called ${String(name || '').trim()}.`];
    if (q.id === p.id) return [-1, 'You cannot mute yourself.'];
    const mins = Math.max(1, Math.min(24 * 60, Math.round(Number(minutes) || 30)));
    q.mutedUntil = now + mins * 60000;
    this.g.store.touch();
    this.system(q.id, `${this.g.fame.chatName(p)} has muted you for ${mins} minutes.`);
    this.g.log.info(`${p.name} muted ${q.name} for ${mins} minutes`);
    return {};
  }
  // A "[System]" line in the chat, for one lord or (id null) everyone online. Announcements to everyone also go on
  // the Newsboard (NoticeWin, mail.getAllTVMsg), which keeps the last rules.chat.newsboard of them (default 50).
  system(id, msg){
    const data = { msg: esc(String(msg)), sender: '', alliance: false, noSenderSystemInfo: false, tV: false, tVContext: '' };
    for (const to of id == null ? [...this.g.online.keys()] : [id]) this.g.push(to, 'server.SystemInfoMsg', data);
    if (id == null) this.news(msg);
  }
  news(msg, now = this.g.now()){
    const db = this.g.db, list = db.newsboard || (db.newsboard = []), max = this.rules.newsboard ?? 50;
    list.push({ msg: esc(String(msg)), time: now });
    if (list.length > max) list.splice(0, list.length - max);
    this.g.store.touch();
  }
  // Oldest first: the window reverses them.
  newsBeans(){ return (this.g.db.newsboard || []).map(x => ({ msg: x.msg, time: x.time })); }
}

module.exports = { Chat, SPEAKER };
