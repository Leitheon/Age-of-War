'use strict';
// Age of War has no cents (the game's coins): rules.noCents turns every amount of cents a lord would get or pay into
// gold at the shop's rate (rules.webShop.goldPerCoin, 10,000 gold a cent), and this rewrites text that mentions
// cents ("Includes: 10 amulets, 100 cents." -> "Includes: 10 amulets, 1,000,000 gold."). Also used by the release
// tools to rewrite the web client's item table the same way.
const fmt = n => Math.round(n).toLocaleString('en-US');

function centsText(text, rate){
  if (text == null) return text;
  return String(text)
    // "50 cents", "10 Cents", "50 cents game coins", "100 Cent game coin(s)"
    .replace(/(\d[\d,]*)\s*cents?\b(?:\s+game\s+coin(?:\(s\)|s)?)?/gi, (m, n) => `${fmt(Number(n.replace(/,/g, '')) * rate)} gold`)
    // a name with no number: "Cent game coin(s)", "Cents Package", "Cents"
    .replace(/\bcents?\s+game\s+coin\(s\)|\bcents?(?:\s+game\s+coins?)?\b/gi, m => (m[0] === 'C' ? 'Gold' : 'gold'));
}

// Gold a cent is worth with rules.noCents on, else 0 (cents stay cents).
const centsRate = rules => rules?.noCents ? (Number(rules.webShop?.goldPerCoin) || 10000) : 0;

module.exports = { centsText, centsRate, fmt };
