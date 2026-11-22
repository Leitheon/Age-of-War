'use strict';
// Accounts for the web client: a user name, an e-mail address and a password, and the sign-in token the browser
// keeps so that a reload doesn't ask again (auth.resume).
//
// Passwords are kept only as a salted scrypt hash, sign-in and reset tokens only as a SHA-256 hash, so world.json
// holds nothing that signs anyone in. A local server sends no e-mail: a reset request writes a one-day reset link
// in the server window for the admin to pass on, and `node tools/reset-link.js <name>` makes one on request.
const crypto = require('crypto');

const NAME = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{1,14}[A-Za-z0-9_.]$/;          // 3 to 16 characters
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 24 * 3600 * 1000;

const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const hashPwd = (pwd, salt) => crypto.scryptSync(String(pwd), salt, 32).toString('hex');
const token = () => crypto.randomBytes(32).toString('hex');

function makeReset(game, account, now = game.now()){
  const t = token();
  (game.db.resets ??= {})[sha(t)] = { account: account.name.toLowerCase(), until: now + DAY };
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

  // Into the game as account a: the lord is made on the first sign-in. The reply carries the lord and his first city.
  const enter = (conn, cmd, a, extra = {}) => {
    const p = a.playerId ? game.db.players[a.playerId] : game.createPlayer(a);
    if (a.closed || p.banned) return game.fail(conn, cmd, -2, 'This account is closed.');
    game.enter(conn, p);
    const castles = game.castlesOf(p), now = game.now();
    const player = game.beans.player(p, castles, now);
    game.reply(conn, cmd, { ...extra, player, castle: player.castles?.[0] ?? null, viewingLive: false });
  };
  const newSession = (conn, a) => {
    const t = token();
    sessions()[sha(t)] = { account: a.name.toLowerCase(), at: game.now() };
    conn.sessionKey = sha(t);
    game.store.touch();
    return t;
  };

  H['auth.register'] = (conn, d, cmd) => {
    const name = String(d.username || '').trim(), email = String(d.email || '').trim().toLowerCase();
    if (!NAME.test(name)) return game.fail(conn, cmd, -11, 'User names are 3 to 16 letters, digits, spaces, dots, dashes or underscores.');
    if (!EMAIL.test(email) || email.length > 120) return game.fail(conn, cmd, -11, 'Enter a valid e-mail address.');
    const bad = pwdProblem(d.password);
    if (bad) return game.fail(conn, cmd, -11, bad);
    if (findByName(name)) return game.fail(conn, cmd, -11, 'That user name is taken.');
    if (Object.values(accounts()).some(a => a.email === email)) return game.fail(conn, cmd, -11, 'That e-mail address already has an account.');
    const a = accounts()[name.toLowerCase()] = { name, email, createdAt: game.now(), playerId: null };
    setPwd(a, d.password);
    game.store.touch();
    game.log.info(`New account ${name}`);
    game.reply(conn, cmd, {});
  };

  // (the sign-in box takes the user name or the e-mail address)
  H['auth.login'] = (conn, d, cmd) => {
    const typed = String(d.username || '').trim().toLowerCase();
    const a = findByName(typed) || (typed.includes('@') ? Object.values(accounts()).find(x => x.email === typed) : null);
    if (!a || !checkPwd(a, d.password)) return game.fail(conn, cmd, -1, 'Wrong user name or password.');
    enter(conn, cmd, a, { sessionToken: newSession(conn, a) });
  };

  H['auth.resume'] = (conn, d, cmd) => {
    const s = sessions()[sha(d.sessionToken)], a = s && findByName(s.account);
    if (!a) return game.fail(conn, cmd, -1, 'Please sign in again.');
    s.at = game.now(); conn.sessionKey = sha(d.sessionToken);
    enter(conn, cmd, a);
  };

  H['auth.logout'] = (conn, d, cmd) => {
    if (conn.sessionKey){ delete sessions()[conn.sessionKey]; conn.sessionKey = null; game.store.touch(); }
    game.disconnect(conn); conn.player = null;
    game.reply(conn, cmd, {});
  };

  // No e-mail from a local server: the reset link goes to the server window for the admin to pass on. The client
  // says the same thing whether or not the address has an account.
  H['auth.requestReset'] = (conn, d, cmd) => {
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
