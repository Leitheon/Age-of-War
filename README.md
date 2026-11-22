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

## Accounts

Players register with a user name (3 to 16 characters), an e-mail address and a password (at least 6
characters), and sign in with the name or the address. Passwords are stored only as salted scrypt hashes, and
sign-in tokens only as hashes, so `world.json` holds nothing that signs anyone in.
