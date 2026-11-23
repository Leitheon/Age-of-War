# Age of War

A small, self-hosted game server for the community that played the Evony Age II fan remake. The web client
(React, in `server/public/`) is the one the community already plays; the server is a fork of the Evony Age II
local server, with what this client adds on top: password accounts, a seeded world map, a gold shop, a pooled
state heartbeat, and its automation and market features.

## Folders

- `server/` — the game server (Node.js 18 or later, no packages to install).
  - `public/` — the web client: `index.html`, `assets/` (the built JavaScript and stylesheet), `sw.js`.
  - `src/` — the server. `src/game/handlers/` answers the client's commands; `auth.js`, `webmap.js`, `webstate.js`
    and `webshop.js` are this client's own.
  - `art/` — **not in git**: the game's pictures and fonts (`flash/`, `tiles/`, `_uiassets/`, `heroes/`, `fonts/`,
    `login-bg.jpg`, `mapTile.jpg`).
  - `client/` — **not in git**: `EvonyClient1921.swf`, which the server reads the game's data from (buildings,
    troops, research, items, quests).
  - `data/` — **not in git**: the world (`world.json`), the log, and `rules.json` if you change any rules.
  - `cache/` — **not in git**: Evony art fetched on demand from the Evony image server.

## Setting up

1. Install Node.js (the LTS version from nodejs.org).
2. Put `EvonyClient1921.swf` in `server/client/`.
3. Put the art folders in `server/art/`.
4. Optional: copy the `cache` folder from the Evony local server into `server/` too. It has the Evony pictures
   the art folders are missing (troop icons, tab icons), which the server otherwise fetches as they're needed.
5. Run `server/start.bat` (or `node src/server.js` in `server/`). Players open `http://<your address>:8090/`.

The first start writes `server/config.json` with a random admin password.

## Settings (`server/config.json`)

- `httpPort` — the port players connect to (8090).
- `publicUrl` — the address players use, e.g. `http://203.0.113.5:8090` or a tunnel's address. Password reset
  links are made with it.
- `welcomeText`, `welcomeLink` — the line across the top of the game screen, and a link after it (a Discord
  invite, say).
- `adminPassword` — the admin page's password (user name `admin`).
- `assetCdn` — where Evony art the art folders don't have comes from.

Game rules (speeds, prices, limits) are in `server/src/rules.js`; put the ones you change in
`server/data/rules.json`, which is merged over them.

## Admin

`http://<address>:8090/admin`, user `admin`, the password from `config.json`:

- every account, with its lord, e-mail, and when it was made and last signed in;
- **Reset link**: a one-day link that lets the player choose a new password (a local server sends no e-mail, so
  pass it on yourself). A player who uses "Forgot password?" gets one written in the server window too;
- **Close** / **Reopen** an account;
- **Debug tools** for a lord: coins, resources, troops, items, research, gear, gift packages, the news ticker.

## Letting other people in

**`server/docs/HOSTING.md`** walks through putting it on playageofwar.com: a Cloudflare Tunnel from this PC (HTTPS,
no router changes), and `install-autostart.bat` so the server starts with the PC and restarts if it stops.

In short:

Players need to reach `httpPort` (8090) on the PC running the server. Two ways:

- **Port forwarding**: forward TCP 8090 on your router to this PC, allow it through the Windows firewall, and set
  `publicUrl` to `http://<your public IP>:8090`. Simple, but it's plain HTTP: passwords (and the admin password)
  cross the internet unencrypted.
- **A tunnel with HTTPS** (Cloudflare Tunnel, playit.gg, ngrok...): it gives you an `https://` address that forwards
  to `http://localhost:8090`. Set `publicUrl` to that address. The client switches to a secure WebSocket by itself,
  and browsers also keep the game's art cached between visits (the service worker only runs on HTTPS).

## What the server does

Everything the client asks for has a handler. On top of the Evony server's game (buildings, research, troops,
heroes, marches and battles, valleys, NPC and Historic Cities, colonies, alliances, quests, mail, items):

- **Coordinated Attacks**: per-level attack presets for valleys and NPC cities; while on, each free army slot sends
  the preset with a free hero at the nearest target of a ticked level. Settings: `rules.automation` (`radius`,
  `dropShare`: the share of treasure it finds, 0.5).
- **Troop Goals**: 20 priority batches of troop targets, trained automatically across the city's Barracks.
- **The market**: lords' resource offers, filled piece by piece; deliveries take `rules.webMarket.deliveryMinutes`
  (30), or none with a Merchant Fleet. A city has one open offer per Marketplace level.
- **The shop**: items for gold from all of a lord's cities, account-bound gold first; price = the item's coin price
  times `rules.webShop.goldPerCoin` (10,000).
- **The speed-up window**: **Instant Complete** finishes the work with the cheapest set of the lord's Guidelines (by
  their shop prices); **Pay with Gold** finishes it for those Guidelines' price in gold (`rules.webShop.goldFinish`),
  account-bound gold first, then the city doing the work.
- **Cities**: at most 6 Cottages each (`rules.typeLimits`), which keeps population, and so tax gold, down, since
  there are no coins to buy gold with; and every city has Walls from level 1 (`rules.startWalls`), as the client has
  no empty spot to build them on.
- **The Battle Calculator**, **Build NPC** on a held flat (`rules.buildNpc.enabled`), **castle skins**, **mail
  attachments**, **alliance banner colours**, **Abandon Loyalty**, and the Reports window's filters and flags.

## Accounts

Players register with a user name (3 to 16 characters), an e-mail address and a password (at least 6
characters), and sign in with the name or the address. Passwords are stored only as salted scrypt hashes, and
sign-in tokens only as hashes, so `world.json` holds nothing that signs anyone in.
