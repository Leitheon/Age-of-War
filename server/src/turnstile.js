'use strict';
// Cloudflare Turnstile on the sign-up form (Fox, Nov 28 2026, after bots made ten accounts in ten minutes: "let's set
// up Turnstile"). Turnstile is Cloudflare's free check that a visitor is a person. config.json's
//   "turnstile": { "siteKey": "...", "secretKey": "..." }
// turns it on: the sign-up form shows the check (the site key goes to the page with /welcome: game.welcomeJs), the
// form sends the token it gives, and auth.register asks Cloudflare whether that token is good (SITEVERIFY) before
// making the account. Without both keys nothing changes. A token is good once, for 5 minutes. If Cloudflare can't be
// asked, the sign-up is refused (try again), never let through. Sign-ups on the server's own computer (localhost)
// skip the check: a widget only works on the hostnames it was made for.
const https = require('https'), crypto = require('crypto');

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify', MAX_TOKEN = 2048;

class Turnstile {
  constructor(cfg = {}, log){
    this.siteKey = String(cfg?.siteKey || '').trim();
    this.secret = String(cfg?.secretKey || '').trim();
    this.log = log;
  }
  get on(){ return !!(this.siteKey && this.secret); }
  // Is `token` (from the widget) good? Resolves { ok, codes } (Cloudflare's error-codes, or 'unreachable').
  verify(token, ip){
    token = String(token || '');
    if (!token) return Promise.resolve({ ok: false, codes: ['missing-input-response'] });
    if (token.length > MAX_TOKEN) return Promise.resolve({ ok: false, codes: ['invalid-input-response'] });
    const body = new URLSearchParams({ secret: this.secret, response: token, idempotency_key: crypto.randomUUID() });
    if (ip) body.set('remoteip', ip);
    const data = body.toString();
    return new Promise(resolve => {
      const req = https.request(SITEVERIFY, { method: 'POST', timeout: 10000, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } }, res => {
        const parts = []; let n = 0;
        res.on('data', d => { n += d.length; if (n < 65536) parts.push(d); });
        res.on('end', () => {
          let r = null; try { r = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (e){}
          if (!r){ this.log?.warn(`Turnstile: Cloudflare answered HTTP ${res.statusCode} without a result`); return resolve({ ok: false, codes: ['unreachable'] }); }
          const codes = Array.isArray(r['error-codes']) ? r['error-codes'].map(String) : [];
          if (codes.some(c => /input-secret/.test(c))) this.log?.warn('Turnstile: Cloudflare says the secret key in config.json is wrong');
          resolve({ ok: r.success === true, codes });
        });
      });
      req.on('timeout', () => req.destroy(new Error('timed out')));
      req.on('error', e => { this.log?.warn(`Turnstile: couldn't reach Cloudflare (${e.message})`); resolve({ ok: false, codes: ['unreachable'] }); });
      req.end(data);
    });
  }
  // The script /welcome adds when the check is on: window.aowTurnstile, which the sign-up form uses (patch-turnstile.py).
  //  mount(el): the form's box for the check (React calls it with null when the form goes); token(); reset() after a
  //  try (a token is good once); needed(): false on the server's own computer, where the widget can't work.
  clientJs(){
    if (!this.on) return 'window.aowTurnstile=null;';
    return `window.AOW_TURNSTILE=${JSON.stringify(this.siteKey)};window.aowTurnstile=(function(){`
      + `var local=/^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname),key=local?'':window.AOW_TURNSTILE,id=null,el=null,token='',loading=null;`
      + `function load(){if(window.turnstile)return Promise.resolve();if(loading)return loading;loading=new Promise(function(ok,no){var s=document.createElement('script');`
      + `s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;s.onload=ok;s.onerror=function(){loading=null;no()};document.head.appendChild(s)});return loading}`
      + `function draw(){if(!el||!window.turnstile||id!==null)return;try{id=window.turnstile.render(el,{sitekey:key,size:'flexible',theme:'light',action:'signup',`
      + `callback:function(t){token=t},'expired-callback':function(){token=''},'error-callback':function(){token=''}})}catch(e){el.textContent='The security check could not start. Reload the page.'}}`
      + `return{needed:function(){return!!key},token:function(){return token},`
      + `reset:function(){token='';if(id!==null&&window.turnstile){try{window.turnstile.reset(id)}catch(e){}}},`
      + `mount:function(node){if(!key||node===el)return;if(id!==null&&window.turnstile){try{window.turnstile.remove(id)}catch(e){}}id=null;token='';el=node;`
      + `if(node)load().then(draw,function(){if(el)el.textContent='The security check could not load. Check your connection and reload the page.'})}}})();`;
  }
}

module.exports = { Turnstile, SITEVERIFY };
