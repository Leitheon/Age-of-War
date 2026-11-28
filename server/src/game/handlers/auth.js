'use strict';
// Accounts for the web client: a user name, an e-mail address and a password, and the sign-in token the browser
// keeps so that a reload doesn't ask again (auth.resume).
//
// Passwords are kept only as a salted scrypt hash, sign-in and reset tokens only as a SHA-256 hash, so world.json
// holds nothing that signs anyone in. A local server sends no e-mail: a reset request writes a one-day reset link
// in the server window for the admin to pass on, and `node tools/reset-link.js <name>` makes one on request.
const crypto = require('crypto');
const { emailKey, netOf } = require('../security');

const NAME = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{1,14}[A-Za-z0-9_.]$/;          // 3 to 16 characters
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 24 * 3600 * 1000, MIN15 = 15 * 60 * 1000;

const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const hashPwd = (pwd, salt) => crypto.scryptSync(String(pwd), salt, 32).toString('hex');
const token = () => crypto.randomBytes(32).toString('hex');

// (security review, Nov 28 2026) One live link an account: a new one replaces the last, and expired ones go, so asking
// again and again doesn't grow the world file.
function makeReset(game, account, now = game.now()){
  const t = token(), resets = (game.db.resets ??= {}), name = account.name.toLowerCase();
  for (const [k, r] of Object.entries(resets)) if (r.account === name || !(r.until > now)) delete resets[k];
  resets[sha(t)] = { account: name, until: now + DAY };
  game.store.touch();
  return t;
}

module.exports = (game, H) => {
  const accounts = () => game.db.accounts;
  const sessions = () => (game.db.sessions ??= {});      // sha256(token) -> { account, at }
  const findByName = n => accounts()[String(n || '').trim().toLowerCase()] || null;
  const checkPwd = (a, pwd) => {
    if (!a?.scrypt) return false;
    const want = Buffer.from(a.scrypt.hash, 'hex'), got = Buffer.from(hashPwd(pwd, a.scrypt.salt), 'hex');
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  };
  const setPwd = (a, pwd) => { const salt = crypto.randomBytes(16).toString('hex'); a.scrypt = { salt, hash: hashPwd(pwd, salt) }; delete a.pwd; };
  const pwdProblem = pwd => String(pwd || '').length < 6 ? 'Passwords need at least 6 characters.' : String(pwd).length > 128 ? 'That password is too long.' : null;

  // Into the game as account a: the lord is made on the first sign-in. The reply carries the lord and his first city
  // (with his id and name on top too: the chat tells the lord's own lines by player.name). conn.web marks the
  // connection as this client's, which some pushes are shaped for (chat.js).
  // A banned account, or a banned address or browser, is refused with the reason and how long (security.js); every
  // sign-in is recorded (how: 'signin', or 'resume' for a reload).
  const enter = (conn, cmd, a, extra = {}, how = 'signin') => {
    const no = game.security.refusal(conn, a);
    if (no) return game.fail(conn, cmd, -2, no);
    game.security.seen(a, conn, how);
    const p = a.playerId ? game.db.players[a.playerId] : game.createPlayer(a);
    conn.web = true;
    game.enter(conn, p);
    const castles = game.castlesOf(p), now = game.now();
    const bean = game.beans.player(p, castles, now);
    const player = { ...bean, ...game.skinFields(p), id: p.id, playerId: p.id, name: p.name, userName: p.name, faceUrl: bean.playerInfo.faceUrl };
    game.reply(conn, cmd, { ...extra, player, castle: player.castles?.[0] ?? null, viewingLive: false });
  };
  // Sign-ins kept (security review, Nov 28 2026): at most SESSIONS_EACH an account (the oldest go), and none unused for
  // SESSION_DAYS. Before, each sign-in added one for good.
  const SESSIONS_EACH = 10, SESSION_DAYS = 60;
  const newSession = (conn, a) => {
    const t = token(), all = sessions(), name = a.name.toLowerCase(), now = game.now(), old = now - SESSION_DAYS * DAY;
    const mine = Object.entries(all).filter(([k, x]) => x.account === name).sort((x, y) => (y[1].at || 0) - (x[1].at || 0));
    for (const [k] of mine.slice(SESSIONS_EACH - 1)) delete all[k];
    if (Math.random() < 0.05) for (const [k, x] of Object.entries(all)) if (!((x.at || 0) > old)) delete all[k];
    all[sha(t)] = { account: name, at: now };
    conn.sessionKey = sha(t);
    game.store.touch();
    return t;
  };

  // Sign-ups (security.js): none from a banned address or browser, rules.security.signupsPerDay an address a day, one
  // e-mail box an account however it's written (name+tag@, Gmail's dots), and one account a browser.
  H['auth.register'] = (conn, d, cmd) => {
    const S = game.security, R = game.rules.security || {}, now = game.now();
    const name = String(d.username || '').trim(), email = String(d.email || '').trim().toLowerCase();
    if (!NAME.test(name)) return game.fail(conn, cmd, -11, 'User names are 3 to 16 letters, digits, spaces, dots, dashes or underscores.');
    if (!EMAIL.test(email) || email.length > 120) return game.fail(conn, cmd, -11, 'Enter a valid e-mail address.');
    const bad = pwdProblem(d.password);
    if (bad) return game.fail(conn, cmd, -11, bad);
    const no = S.refusal(conn, null, now);
    if (no) return game.fail(conn, cmd, -2, no);
    const perDay = R.signupsPerDay ?? 3, ipKey = `signup:${netOf(conn.ip)}`;   // (an IPv6 address counts as its /64)
    if (!conn.local && perDay > 0 && S.attempts(ipKey, DAY, now) >= perDay) return game.fail(conn, cmd, -11, 'Too many accounts have been made from your network today. Try again tomorrow.');
    if (findByName(name)) return game.fail(conn, cmd, -11, 'That user name is taken.');
    const key = emailKey(email);
    if (Object.values(accounts()).some(a => a.email === email || (a.email && emailKey(a.email) === key))) return game.fail(conn, cmd, -11, 'That e-mail address already has an account.');
    if (R.oneAccountPerBrowser !== false && !conn.local && conn.device && !S.db.allow['device:' + conn.device]){
      const others = S.othersOn(conn.device);
      if (others.length){
        S.activity({ type: 'signup-blocked', account: name, ids: others.map(n => accounts()[n]?.playerId).filter(Boolean), ip: conn.ip, device: conn.device, others }, now);
        game.log.info(`Sign-up of ${name} refused: this browser already has ${others.join(', ')}`);
        return game.fail(conn, cmd, -11, 'This browser already has an account on this server. One account per player: sign in with that one.');
      }
    }
    const a = accounts()[name.toLowerCase()] = { name, email, createdAt: now, playerId: null };
    setPwd(a, d.password);
    if (!conn.local) S.attempts(ipKey, DAY, now, true);
    S.seen(a, conn, 'signup', now);
    game.store.touch();
    game.log.info(`New account ${name}${conn.local ? '' : ` from ${conn.ip}`}`);
    game.reply(conn, cmd, {});
  };

  // (the sign-in box takes the user name or the e-mail address)
  // Wrong passwords: rules.security.failsPer15Min an address (an IPv6 /64), and an account, in 15 minutes; after that
  // sign-ins stop for the rest of the 15 minutes (each is in the activity log). A banned address or browser can't try
  // at all, and one guessing names that have no account is banned (security.guessed).
  H['auth.login'] = (conn, d, cmd) => {
    const S = game.security, now = game.now(), limit = game.rules.security?.failsPer15Min ?? 10;
    const typed = String(d.username || '').trim().toLowerCase();
    const a = findByName(typed) || (typed.includes('@') ? Object.values(accounts()).find(x => x.email === typed) : null);
    const barred = S.refusal(conn, null, now);
    if (barred) return game.fail(conn, cmd, -2, barred);
    const ipKey = `fail:${netOf(conn.ip)}`, acctKey = `failacct:${a ? a.name.toLowerCase() : typed}`;
    if (limit > 0 && ((!conn.local && S.attempts(ipKey, MIN15, now) >= limit) || S.attempts(acctKey, MIN15, now) >= limit))
      return game.fail(conn, cmd, -1, 'Too many wrong passwords. Try again in 15 minutes.');
    if (!a || !checkPwd(a, d.password)){
      if (!conn.local) S.attempts(ipKey, MIN15, now, true);
      S.attempts(acctKey, MIN15, now, true);
      const p = a?.playerId ? game.db.players[a.playerId] : null;
      S.activity({ type: 'signin-fail', account: a ? a.name : typed.slice(0, 40), ids: p ? [p.id] : [], ip: conn.ip, local: conn.local || undefined, device: conn.device || undefined }, now);
      if (!a) S.guessed(conn, typed, now);
      return game.fail(conn, cmd, -1, 'Wrong user name or password.');
    }
    const no = S.refusal(conn, a, now);   // (no session for a banned account)
    if (no) return game.fail(conn, cmd, -2, no);
    enter(conn, cmd, a, { sessionToken: newSession(conn, a) });
  };

  H['auth.resume'] = (conn, d, cmd) => {
    const s = sessions()[sha(d.sessionToken)], a = s && findByName(s.account);
    if (!a || !((s.at || 0) > game.now() - SESSION_DAYS * DAY)) return game.fail(conn, cmd, -1, 'Please sign in again.');
    s.at = game.now(); conn.sessionKey = sha(d.sessionToken);
    enter(conn, cmd, a, {}, 'resume');
  };

  H['auth.logout'] = (conn, d, cmd) => {
    if (conn.sessionKey){ delete sessions()[conn.sessionKey]; conn.sessionKey = null; game.store.touch(); }
    game.disconnect(conn); conn.player = null;
    game.reply(conn, cmd, {});
  };

  // No e-mail from a local server: the reset link goes to the server window for the admin to pass on. The client
  // says the same thing whether or not the address has an account.
  // (security review, Nov 28 2026: RESETS_PER_HOUR asks a network an hour; more are answered the same, and do nothing)
  const RESETS_PER_HOUR = 5;
  H['auth.requestReset'] = (conn, d, cmd) => {
    const S = game.security, key = `reset:${netOf(conn.ip)}`;
    if (!conn.local && S.attempts(key, 3600e3, game.now()) >= RESETS_PER_HOUR) return game.reply(conn, cmd, {});
    if (!conn.local) S.attempts(key, 3600e3, game.now(), true);
    const email = String(d.email || '').trim().toLowerCase();
    const a = email && Object.values(accounts()).find(x => x.email === email);
    if (a){
      const t = makeReset(game, a);
      game.log.info(`Password reset asked for ${a.name}: ${game.siteUrl()}/reset?token=${t} (good for a day; give it to the player)`);
    }
    game.reply(conn, cmd, {});
  };

  H['auth.resetPassword'] = (conn, d, cmd) => {
    const resets = (game.db.resets ??= {}), key = sha(d.token), r = resets[key];
    if (!r || r.until < game.now()) return game.fail(conn, cmd, -1, 'That reset link has expired. Ask for a new one.');
    const a = findByName(r.account);
    if (!a) return game.fail(conn, cmd, -1, 'That account no longer exists.');
    const bad = pwdProblem(d.newPassword);
    if (bad) return game.fail(conn, cmd, -11, bad);
    setPwd(a, d.newPassword);
    delete resets[key];
    for (const [k, s] of Object.entries(sessions())) if (s.account === a.name.toLowerCase()) delete sessions()[k];   // signed out everywhere
    game.store.touch();
    game.log.info(`Password changed for ${a.name}`);
    game.reply(conn, cmd, {});
  };
};

module.exports.makeReset = makeReset;
