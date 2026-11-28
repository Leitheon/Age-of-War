'use strict';
// Stand-in icons for the buff bar (Age of War's own drawings, 24 x 24 SVG). Fox, Nov 28 2026: "the recipient is not
// getting the icons on their buff bar". The client asks for its buff icons under /flash/images/EmbedImages/buffer/
// (pictures the Flash client had built in, so no art server has them) and /flash/images/icon/ (the shop's, which
// DoA's art has only as blank 1-pixel files), so a buff showed as an empty square with its time. http.js sends one
// of these when neither the art folders, the cache nor the Evony art server has the real picture (marked no-store,
// so the real one is used as soon as it turns up). Keys: the path under /flash/.

const INK = '#24160a';
const svg = (id, top, bottom, edge, glyph, extraDefs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><title>${id}</title><defs>` +
  `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>${extraDefs}</defs>` +
  `<rect x=".5" y=".5" width="23" height="23" rx="4" fill="url(#bg)" stroke="${edge}"/>` +
  `<path d="M2.5 2.5h19a1 1 0 0 1 1 1v6c-6 1.6-13 1.6-21 0v-6a1 1 0 0 1 1-1z" fill="#fff" opacity=".14"/>` +
  `<g stroke="${INK}" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke">${glyph}</g></svg>`;

// ---------- glyphs ----------
const wheat = (c = '#f6d55c') => `<path d="M12 20V6" fill="none" stroke="#c9a23c" stroke-width="1.6"/>` +
  [[10, 8.5, -35], [14, 8.5, 35], [10, 11.6, -35], [14, 11.6, 35], [10, 14.7, -35], [14, 14.7, 35]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="1.5" ry="2.6" transform="rotate(${r} ${x} ${y})" fill="${c}"/>`).join('') +
  `<ellipse cx="12" cy="5.2" rx="1.4" ry="2.4" fill="${c}"/>`;
const logs = `${[[8, 14.5], [16, 14.5], [12, 8.2]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.6" fill="#e9c48e"/><circle cx="${x}" cy="${y}" r="1.7" fill="none" stroke="#a8743f" stroke-width=".9"/><circle cx="${x}" cy="${y}" r=".5" fill="#a8743f" stroke="none"/>`).join('')}`;
const stone = `<path d="M4.5 16 6.5 8.5 12 5 18 7 19.5 14.5 14 18z" fill="#e1e5ea"/><path d="M12 5 13 11 19.5 14.5M13 11 6.5 8.5M13 11 14 18" fill="none" stroke="#8d96a0" stroke-width=".9"/>`;
const ingot = `<path d="M3.5 16h17l-2.2-5.5H5.7z" fill="#a9b8c9"/><path d="M5.7 10.5h12.6L16 6.5H8z" fill="#dfe7f0"/>`;
const coins = `${[15.2, 12.4, 9.6].map(y => `<path d="M6 ${y}v1.6c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V${y}" fill="#e7b531"/><ellipse cx="12" cy="${y}" rx="6" ry="2.2" fill="#ffe58a"/>`).join('')}<ellipse cx="12" cy="9.6" rx="3" ry="1" fill="none" stroke="#c9952a" stroke-width=".8"/>`;
const sword = `<path d="M18.5 3.8 20.2 5.5 10.3 15.4 8.6 13.7z" fill="#f2f4f6"/><path d="M6.6 12.6l4.8 4.8" fill="none" stroke="#e8b931" stroke-width="2.2"/><path d="M8.1 16 5.2 18.9" fill="none" stroke="#7a4a1c" stroke-width="2"/><circle cx="4.6" cy="19.5" r="1.3" fill="#e8b931"/>`;
const shieldPath = 'M12 3.8 18.6 6.3V11c0 4-3 6.6-6.6 8.2C8.4 17.6 5.4 15 5.4 11V6.3z';
const shield = (fill = '#e9eef5', rim = '#e8b931') => `<path d="${shieldPath}" fill="${fill}"/><path d="M12 5.4 17 7.3V11c0 3-2.2 5.2-5 6.5-2.8-1.3-5-3.5-5-6.5V7.3z" fill="none" stroke="${rim}" stroke-width="1"/>`;
const cross = (fill = '#fff') => `<path d="M10 4.5h4v4h4v4h-4v4h-4v-4H6v-4h4z" fill="${fill}"/>`;
const heartPath = 'M12 18.6C6.4 14.8 4.6 11.7 4.6 9c0-2.6 2-4.4 4.1-4.4 1.5 0 2.6.8 3.3 2 .7-1.2 1.8-2 3.3-2 2.1 0 4.1 1.8 4.1 4.4 0 2.7-1.8 5.8-7.4 9.6z';
const heartPlus = `<path d="${heartPath}" fill="#fff4f6"/><path d="M12 8.6v5.2M9.4 11.2h5.2" fill="none" stroke="#c9375f" stroke-width="1.8" paint-order="normal"/>`;
const helmet = `<path d="M3 8.5h3.5M2.2 11.3h3.6M3 14.1h3.5" fill="none" stroke="#e7f2fb" stroke-width="1.3"/><path d="M8 14.5c0-5.2 2.8-9 6.5-9s6.5 3.8 6.5 9z" fill="#dfe7f0"/><path d="M7 14.5h15v2H7z" fill="#e8b931"/><path d="M14.5 5.5v9" fill="none" stroke="#9aa9b8" stroke-width=".9"/>`;
const bowl = (fill = '#f2e2c4') => `<path d="M4.5 11.5h15c0 3.6-3.2 6.5-7.5 6.5s-7.5-2.9-7.5-6.5z" fill="${fill}"/><path d="M4.5 11.5h15" fill="none"/>`;
const steam = `<path d="M9.5 9.5c-1.2-1.4.8-2.4-.3-4M14.5 9.5c-1.2-1.4.8-2.4-.3-4" fill="none" stroke="#fff" stroke-width="1.2" paint-order="normal"/>`;
const hammer = (x, y, r, hx, hy) => `<path d="M${x} ${y}L${hx} ${hy}" fill="none" stroke="#8a5a2b" stroke-width="1.8"/><rect x="-4" y="-1.9" width="8" height="3.8" rx=".8" transform="translate(${hx} ${hy}) rotate(${r})" fill="#c9d3dd"/>`;
const card = `<rect x="3.5" y="6" width="17" height="12" rx="2" fill="#f4efff"/><path d="M3.5 9h17" fill="none" stroke="#7a4fc2" stroke-width="1.6" paint-order="normal"/><path d="m15.5 11 .9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill="#e8b931"/>`;
const castle = `<circle cx="18" cy="5.6" r="3.2" fill="#f39a2b"/><path d="M4.5 19V10h2V8h2v2h2V8h3v2h2V8h2v2h2v9h-4.5v-3.5c0-1.3-1.1-2.3-2.5-2.3s-2.5 1-2.5 2.3V19z" fill="#20142c" stroke="#e9d9f5" stroke-width=".9"/>`;
const flag = `<path d="M7 4v16" fill="none" stroke="#7a4a1c" stroke-width="1.6"/><path d="M7.6 5c2.6-1 4.6 1.4 7.4.5 1.4-.4 2.6-.8 3.6-.4v6.6c-2.4-.6-4.4.9-6.9.4-1.5-.3-2.8-.4-4.1 0z" fill="#fff"/>`;
const swords = `<path d="M5.5 5.5 16 16M18.5 5.5 8 16" fill="none" stroke="#eef1f4" stroke-width="2"/><path d="M14 18.5 18.5 14M10 18.5 5.5 14" fill="none" stroke="#e8b931" stroke-width="1.8"/><path d="M17.2 17.2l2.3 2.3M6.8 17.2l-2.3 2.3" fill="none" stroke="#7a4a1c" stroke-width="1.8"/>`;
const hourglass = `<path d="M7 4h10M7 20h10" fill="none" stroke="#c9a36b" stroke-width="1.8"/><path d="M8 4.6c0 4.4 3 5.4 3 7.4s-3 3-3 7.4h8c0-4.4-3-5.4-3-7.4s3-3 3-7.4z" fill="#eef3f7"/><path d="M9.2 18.6c.6-2.2 2.8-2.6 2.8-4.2 0 1.6 2.2 2 2.8 4.2z" fill="#e8b931" stroke="none"/>`;
const sprout = `<ellipse cx="12" cy="18.6" rx="5.5" ry="1.5" fill="#7a4a1c"/><path d="M12 18.4V11" fill="none" stroke="#2f6b1a" stroke-width="1.6"/><path d="M12 13.2C8.2 13.2 6 10.6 6 7.4c3.6 0 6 2.4 6 5.8zM12 11.2c0-3.6 2.6-6.2 6.2-6.2 0 3.6-2.6 6.2-6.2 6.2z" fill="#d9f5b0"/>`;
const crown = `<path d="M5 15.5 4 7.4l4.4 3.4L12 4.8l3.6 6 4.4-3.4-1 8.1z" fill="#ffe27a"/><path d="M5 15.5h14v2.6H5z" fill="#e8b931"/><circle cx="12" cy="16.8" r=".9" fill="#c9375f" stroke="none"/>`;
const horn = `<path d="M4.5 9.5h3.5l8-4.6v13.2l-8-4.6H4.5z" fill="#fff6e0"/><path d="M7 13.5 8 18h2.2l-.8-4.1" fill="#fff6e0"/><path d="M18.2 8.5c1.2 1 1.2 5 0 6" fill="none" stroke="#fff" stroke-width="1.2" paint-order="normal"/>`;
const moon = `<circle cx="10.6" cy="11.4" r="6.6" fill="#f6e7a8" mask="url(#cut)"/><path d="m17.2 4.4.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5zM18.6 11.2l.4.9.9.4-.9.4-.4.9-.4-.9-.9-.4.9-.4z" fill="#fff" stroke="none"/>`;
const moonCut = `<mask id="cut"><rect width="24" height="24" fill="#fff"/><circle cx="14.4" cy="8.6" r="5.4" fill="#000"/></mask>`;
const padlock = `<path d="M8.6 11V7.6c0-2.2 1.5-3.6 3.6-3.6s3.6 1.4 3.6 3.2" fill="none" stroke="#dfe7f0" stroke-width="2"/><rect x="5.8" y="10.8" width="12.4" height="8.4" rx="1.6" fill="#e8b931"/><circle cx="12" cy="14.4" r="1.3" fill="${INK}" stroke="none"/><path d="M12 15v2" fill="none" stroke="${INK}" stroke-width="1.2" paint-order="normal"/>`;
const boot = `<path d="M8.6 7.8C6 6.4 3.4 7 2.4 8.8c1.6.1 2.6.6 2.2 1.6 1.6 0 2.6.6 2.4 1.6 1 0 1.6.3 1.6 1z" fill="#ffffff"/><path d="M5.6 9.6l3 .8M6.6 11.8l2 .4" fill="none" stroke="#9fd6f2" stroke-width=".8" paint-order="normal"/><path d="M9 4.6h5v7.6l4.4 1.4c1.4.5 1.6 3.7 0 3.7H9z" fill="#f6d78c"/><path d="M9 15.2h11" fill="none" stroke="#a8743f" stroke-width=".9" paint-order="normal"/>`;
const flask = `<path d="M10 4h4v4.4l4.4 8c.7 1.4-.3 3-1.9 3H7.5c-1.6 0-2.6-1.6-1.9-3l4.4-8z" fill="#effbf8"/><path d="M7.2 14.2h9.6l1.6 2.2c.7 1.4-.3 3-1.9 3H7.5c-1.6 0-2.6-1.6-1.9-3z" fill="#ffd34d" stroke="none"/><path d="m18.6 3.6.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5zM5.4 5.4l.4.9.9.4-.9.4-.4.9-.4-.9-.9-.4.9-.4z" fill="#fff" stroke="none"/>`;
const skull = `<path d="M12 4c-4.4 0-7 3-7 6.6 0 2.4 1.3 4 3 4.8V18h8v-2.6c1.7-.8 3-2.4 3-4.8C19 7 16.4 4 12 4z" fill="#efe3c8"/><circle cx="9.3" cy="10.6" r="1.8" fill="#2a0c12" stroke="none"/><circle cx="14.7" cy="10.6" r="1.8" fill="#2a0c12" stroke="none"/><path d="m12 12.6-.9 1.6h1.8z" fill="#2a0c12" stroke="none"/><path d="M10.6 16v2M13.4 16v2" fill="none" stroke="#2a0c12" stroke-width=".9" paint-order="normal"/>`;
const spiral = `<path d="M12.4 11.4c1 0 1.4 1 .8 1.6-.8.8-2.3.4-2.5-.8-.3-1.6 1.2-2.6 2.6-2.4 2 .3 2.9 2.2 2.3 4-.8 2.2-3.6 3-5.6 1.7-2.2-1.4-2.5-4.6-.9-6.6 1.9-2.3 5.6-2.5 7.9-.4" fill="none" stroke="#f3e3bd" stroke-width="1.7"/><path d="M18.6 9.4l-1.8-2.6-1 3" fill="none" stroke="#f3e3bd" stroke-width="1.4"/>`;
const goblet = `<path d="M6.5 4.5h11c0 5-2 7.5-5.5 7.8C8.5 12 6.5 9.5 6.5 4.5z" fill="#efe3c8"/><path d="M7 6.4h10c-.3 2.8-1.9 4.4-5 4.6-3.1-.2-4.7-1.8-5-4.6z" fill="#8fd14f" stroke="none"/><path d="M12 12.3V17" fill="none" stroke="#efe3c8" stroke-width="1.6"/><path d="M8.4 18.5h7.2" fill="none" stroke="#efe3c8" stroke-width="1.8"/><path d="M18.6 9.6c.8 1.4 1.4 2.2 1.4 3 0 .8-.6 1.4-1.4 1.4s-1.4-.6-1.4-1.4c0-.8.6-1.6 1.4-3z" fill="#8fd14f"/>`;
const gate = `<path d="M4.6 19.4V10c0-3.6 3-6 6.8-6.2v15.6zM19.4 19.4V10c0-3.6-3-6-6.8-6.2l1.2 3.4-1.6 3 1.8 3.2-1.4 2.6.8 3.4z" fill="#8a5a2b"/><path d="M7.4 8v11M10 6.2v13.2M15 7v12.4M17.4 8.4v11" fill="none" stroke="#c9d3dd" stroke-width=".9" paint-order="normal"/>`;

// ---------- the icons, by the path the client asks for ----------
const BUFFER = 'images/EmbedImages/buffer/', ICON = 'images/icon/';
const GOLD = ['#f2cf63', '#9a6c0c', '#6b4a06'], BRONZE = ['#d39a62', '#7c4a22', '#5a3416'], SILVER = ['#dfe6ec', '#7d8a96', '#56606a'];
const ICONS = {
  [BUFFER + 'food.png']: svg('Food production', '#86b84a', '#46731b', '#2f4f12', wheat()),
  [BUFFER + 'lumber.png']: svg('Lumber production', '#b17d48', '#6a4220', '#4a2d14', logs),
  [BUFFER + 'stone.png']: svg('Stone production', '#98a1ab', '#545c66', '#3a4048', stone),
  [BUFFER + 'iron.png']: svg('Iron production', '#6585a5', '#2f4a64', '#213447', ingot),
  [BUFFER + 'gold.png']: svg('Tax revenue', '#e0ae2c', '#916408', '#664604', coins),
  [BUFFER + 'attack.png']: svg('Troop attack', '#cc4434', '#781c13', '#55130d', sword),
  [BUFFER + 'defence.png']: svg('Troop defence', '#3a7cc4', '#1a4073', '#122d52', shield()),
  [BUFFER + 'penicillin.png']: svg('Fewer battle losses', '#36ab9b', '#1a6158', '#11443e', cross()),
  [BUFFER + 'peace.png']: svg('Protected', '#5aaee0', '#286796', '#1b4869', flag),
  [BUFFER + 'nopeace.png']: svg('Not protected', '#9a4242', '#4f1d1d', '#371313', swords),
  [BUFFER + 'cooldownpeace.png']: svg('Truce cooldown', '#98a1ab', '#545c66', '#3a4048', hourglass),
  [BUFFER + 'newPlayer.png']: svg("Beginner's Protection", '#74c450', '#397a21', '#285616', sprout),
  [ICON + 'cooker.png']: svg('Troop upkeep -50%', '#e0974a', '#8a4f19', '#613711', bowl() + steam),
  [ICON + 'shop/StopTroopsUpkeep.png']: svg('No troop upkeep', '#47b67f', '#1f6b45', '#154a30', bowl() + `<path d="M6 17.6 18 6.4" fill="none" stroke="#fff" stroke-width="1.6"/>`),
  [ICON + 'hungry.png']: svg('Hunger', '#c4513a', '#6b2213', '#4b170d', bowl('#e8d3ae') + `<path d="M12 4.4v3.6" fill="none" stroke="#fff" stroke-width="2"/><circle cx="12" cy="9.6" r="1" fill="#fff"/>`),
  [ICON + 'doubleBuilding.png']: svg('Two buildings at once', '#96765a', '#55402b', '#3b2c1d', hammer(5.5, 19, 45, 15.6, 8.4) + hammer(18.5, 19, -45, 8.4, 8.4)),
  [ICON + 'player/emcardbuff.png']: svg('Membership', '#8558cc', '#46297c', '#311c57', card),
  [ICON + 'topvotes.png']: svg('Governor', '#b98f30', '#6a4e12', '#4a370c', crown),
  [ICON + 'gold24.jpg']: svg('Dream Truce', '#33447a', '#131b3a', '#0d1229', moon, moonCut),
  [ICON + 'Copper24.jpg']: svg('Security code being removed', '#98a1ab', '#4b525a', '#33383e', padlock),
  [ICON + 'shop/HalloweenCastle_S.png']: svg('Haunted Castle', '#6a4590', '#2a1840', '#1d102d', castle),
  [ICON + 'shop/fleetfeet.png']: svg('Fleet Feet', '#62c6f4', '#2276ad', '#18537a', boot),
  [ICON + 'shop/enduranceoftheimmortas.png']: svg('Endurance of the Immortals', '#eeb83f', '#9c6810', '#6e490b', shield('#fff7df', '#c97f12') + `<path d="M12 15.6c-2.6-1.8-3.4-3.2-3.4-4.4 0-1.2.9-2 1.9-2 .7 0 1.2.4 1.5.9.3-.5.8-.9 1.5-.9 1 0 1.9.8 1.9 2 0 1.2-.8 2.6-3.4 4.4z" fill="#d9415f" stroke="none"/>`),
  [ICON + 'shop/alchemistsamplifier.png']: svg("Alchemist's Amplifier", '#4cc7ad', '#1d7563', '#145245', flask),
  [ICON + 'shop/opportunistsplague.png']: svg("Opportunist's Plague", '#64242f', '#250a10', '#16060a', skull),
  [ICON + 'shop/lostinthewastes.png']: svg('Lost in the Wastes', '#7a5627', '#2e1d09', '#1f1406', spiral),
  [ICON + 'shop/poisonedfeast.png']: svg('Poisoned Feast', '#46246a', '#1b0b2b', '#12071d', goblet),
  [ICON + 'shop/brokengates.png']: svg('Broken Gates', '#6a2424', '#270b0b', '#1a0707', gate),
  // (buffs the client had no icon for; patch-buff-icons.py points it here)
  [ICON + 'aow/healbonus.png']: svg('Healing bonus', '#de6084', '#8a2443', '#611930', heartPlus),
  [ICON + 'aow/trainspeed.png']: svg('Recruiting speed', '#4596dc', '#1d5689', '#143c60', helmet),
};
// The Publicity Ambassadors' horns: bronze, silver and gold.
for (const [file, [top, bottom, edge], what] of [['jt', BRONZE, 'Bronze'], ['by', SILVER, 'Silver'], ['hj', GOLD, 'Gold']])
  for (const end of ['_15', '_infinite']) ICONS[`${ICON}player/${file}${end}.png`] = svg(`${what} Publicity Ambassador`, top, bottom, edge, horn);

module.exports = { BUFF_ICONS: ICONS };
