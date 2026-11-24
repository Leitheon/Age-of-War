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
- **Debug tools** for a lord: resources and troops (up to 2,145,000,000 at a time), items, research, gear, gift packages, the news ticker. The coins section is hidden for now
  (`debugCoins` in `data/rules.json` brings it back).

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
- **The shop** (tabs Items, Speed Up, Produce, Chests, Stratagems, Materials): items for gold from all of a lord's cities, account-bound gold first; price = the item's coin price
  times `rules.webShop.goldPerCoin` (10,000).
- **No cents** (`rules.noCents`): whatever gave cents (quests, chests, the Amulet wheel) gives their worth in gold at
  the shop's rate, and whatever cost cents (Enquire Details, a Hero Hunting or a Bernini's Hammer bought on the spot)
  costs gold.
- **Heroes** level up by themselves once they have the experience, with their attribute points
  (`rules.heroAutoLevel`), and the **Inn** puts a new hero in a hired one's place at once (`rules.innRestock`).
- **Historic Cities** show their introductions from the client's own city list. Each of the 16 states has its capital,
  8 level 14s and 121 level 12s (every 18 tiles from 9,9: Olathe at 99,99 beside Washington, D.C.), and every Historic
  City has flats on all sides, except where another Historic City is (`rules.historic.flatRing`).
- **Historic heroes** need no quest (`rules.historicHeroes.questFree`): Enquire Details at the Inn gives the hero's
  place and portrait, and taking that NPC city with the portrait in hand captures the hero, using the portrait up.
- **The hero list is DoA's, up to the American Civil War**: 689 historic heroes, the client's 639 and 50 of the 59
  DoA added (700 to 758), with DoA's stats, in `server/src/data/historic-heroes.csv`. Heroes from the Civil War on
  are left out (Lincoln, Macdonald, Griffin, Yaa Asantewaa, Churchill, Hitler, Stalin, Escobar, Napoleon Dynamite).
  A hero taken off the sheet leaves the barbarian cities and the Inn's hearsay, and his portrait is taken back.
- **Hero portraits** are Evony's originals wherever there is one (`server/cache/images/icon/hero/`, or fetched
  from the Evony art server, `assetCdn`, and kept there); otherwise DoA's (`art/flash/images/icon/hero/`, then
  `art/heroes/`); otherwise a "portrait unknown" picture. DoA's and the unknown one are never kept by browsers, so
  an Evony original shows as soon as the server has it. For a hero with no portrait at all, put `<ID>.png` in
  `art/heroes/`. `server/get-doa-portraits.bat` downloads DoA's portraits, from DoA's site, for every hero that has
  none here (the heroes DoA added are at `/flash/images/icon/hero/<ID>.png` there, Poseidon at `poseidon.png`).
- **The shop** leaves out the items in `rules.webShop.hidden` (76 of them: Speakers, Rituals of Pact, Truce
  Agreements, Publicity Ambassadors, keys and lockboxes, holiday chests...) and won't sell them; they still work
  wherever else they turn up.
- **The admin page's resource buttons add** to what each city has (they used to raise it to that amount).
- **Rank and title names** are Evony's again (DoA had renamed them): Civilian, Lieutenant, Captain, Major, Colonel,
  General; Civilian, Knight, Baronet, Baron, Viscount, Earl, Marquis, Duke, Furstin, Prinzessin.
- **Bronze, Silver and Gold Amulets** found a city somewhere random, as the item says, with a level 10 Town Hall and
  Walls, a Rally Spot at the amulet's level (11, 12 or 14) and one Farm, Sawmill, Quarry and Ironmine at that level;
  fields built there can be upgraded up to that level too (`fieldMax`).
- **Items** do what their descriptions say from My Items (every item was tried as the web client uses it): Holy Water (5 pieces) opens into 5, Treat
  and Trick Tokens give an Angel or a Devil item, a Bronze/Silver/Golden Key opens its lockbox, chests read their
  full contents list, Speech Text, Civil Code, the Dream Truce (starts now), the Truce Agreement (no password check),
  the Pioneer Express Teleport and the Christmas Gift's healing and training bonuses work, and holiday treats whose
  descriptions say what they do but not how much get a day of it (`rules.eventItemBuffs`).
- **Farming NPC 1-5**: transporters stay back while anything else in their army still fights
  (`rules.battle.transportersHoldBack`), so ballistae and transporters take an NPC 1-5 without losses, and NPC 1-5's
  troops fight without Medicine (`rules.npcMedicineFrom`): as in the community farming guide, about 450 ballistae
  with maxed research and 550 with less take an NPC 5 with no losses. **Valleys** taken, lost or given up show on the
  map at once.
- **Battle report links**: every battle report ends with a link, `<site>/report?id=...`, that opens it on the site's
  report viewer for anyone it's given to (while the report is kept); `/report` on its own asks for a link to be pasted.
- **Pay with Gold** in the speed-up window costs the shop price of the most efficient (cheapest) Guidelines that would
  finish the work, whatever the lord owns; Instant Complete uses only the lord's own items.
- **Level-1 stats**: the Inn and the Feasting Hall show each hero's level-1 politics, attack and intelligence in
  brackets, without points or gear ("140 (90)"). An ordinary hero's base is his level-1 stats and the points his
  level brought are his to spend again with Holy Water, as a historic hero's.
- **Recruit Hero**: the pink gem button above the two beside the lord's portrait opens Recruit Hero, as in the live
  game: pick the hero's portrait, name him, roll politics, attack and intelligence (lock up to two, reset 3 times a
  day free, then gold), and a Legendary Ring makes the hero. The Acquire Historic City quests (City Expansion) give a Legendary Ring each for capturing a
  level 12, 14, 16 and 18 Historic City: four at most.
- **Player Info** (click the portrait) is laid out as the live game's: the lord's details with Change buttons, and
  every hero he has, sortable by any column, with a Select box for up to 3 champions. Any lord can see them from
  the Champions button on that lord's cities (Hero Attributes: portraits, stats and gear). It has the live game's
  frame, its title on the red banner. Every window's X sits on its frame's silver tab, whatever the window's size.
- **Historic City rulers**: Poseidon rules Atlantis and a famous hero each capital (`historic.rulers`: Napoleon in
  Paris, Caesar in Rome, Saladin in Jerusalem ...). He leads its defence with the city's own hero numbers under his
  name and portrait, is out of the barbarian cities and the Inn's rumours, and is taken prisoner (level 100) when the
  city falls; freed, he goes back to rule it. The website's Heroes page shows where each rules.
- **Historic heroes get 1 point a level** (counting the first: 150 at level 150; wild ones at 30 come with 30), as
  live: Gao Guiying at 150 in the live ranking is her sheet + 150 + her gear. Ring heroes keep 2 a level. Heroes saved
  with more lose the extra at startup, unspent points first, then in proportion to where they went.
- **My Items**: the Angel and Devil items (Fleet Feet ... Broken Gates, used on another lord or his city) are under
  the Stratagem tab with the stratagems.
- **No world boss**: the web client's built-in Pumpkin Warden (a figure on the map at 0,2) is turned off; the
  server has no world boss.
- **Troops and resources**: a city holds 0 to 1,000,000,000,000 of each troop type (training past it is refused;
  troops arriving stop there) and up to 100,000,000,000,000 of each resource. Troops eat a tenth of the live game's
  upkeep (`troopUpkeep`), at home, on the march and in camp, and live's 32-bit overflows are gone: no troop count wraps
  negative and bricks a city, and no troop type's upkeep flips to feed the city.
- **Prestige and honor**: prestige is never lost (live took it for lost troops and for leaving an alliance:
  `battlePrestige.losses` and `alliances.quitPrestigeRate`, off here). Honor can be lost in battle but stops at 0.
  Neither has a cap. The server's first log line says which version is running (so does the admin page), and it
  warns if `data/rules.json` turns either prestige loss back on. (With losses on, the loser pays only for his own troops gone for good: not those Penicillin
  saves or the wounded, who come back healed.)
- **Prisoners** take no Feasting Hall seat (`rules.prisonersNeedNoSeat`): a city with a Feasting Hall captures a hero
  however full it is, and persuading one waits for a free seat.
- **Reports**: the last tab is Other (it was Automation), with the Other reports (a city founded, the innkeeper's
  news, charms...); the automation's battles are in Army with the rest. Delete All deletes everything the tab shows
  except flagged reports. There are no reports for a hero captured or getting away, for what an opened item gave or
  for reinforcements reaching a city, and battle subjects start with Victory or Defeat (`rules.reports`). Each
  report's values are sent the way this client reads them.
- **Chat**: World and Alliance chat of the last 48 hours (`rules.chat.historyHours`) is kept through restarts and
  shown on signing in. **Flags** take up to 4 characters (`rules.flagLength`).
- **The sign-in screen's pages**: `/heroes` (every historic hero, with DoA's stats from the hero sheet and where each is:
  serving or held by a lord, in a barbarian city, or no rumors; and the experience tables), `/npcs` and
  `/droptable` (the battle drop chances, from `rules.battleDrops`). The pages are in `server/pages/`.
- **Mayor XP** (`rules.mayorExp`): a city's mayor gains 0.1622 x (food + wood + stone + iron + build seconds) for
  every building level, troop and wall defence the city finishes.
- **The speed-up window**: **Instant Complete** finishes the work with the cheapest set of the lord's Guidelines (by
  their shop prices); **Pay with Gold** finishes it for those Guidelines' price in gold (`rules.webShop.goldFinish`),
  account-bound gold first, then the city doing the work.
- **Cities**: at most 6 Cottages each (`rules.typeLimits`), which keeps population, and so tax gold, down, since
  there are no coins to buy gold with; a conquered barbarian city comes with six, the other Cottage plots empty
  (`rules.npcConquest.layout.keepCottages`). Every city has Walls from level 1 (`rules.startWalls`), as the client
  has no empty spot to build them on. **Full Demolish** (Dynamite) takes a whole building down
  (`rules.dynamiteFullDemolish`).
- **No Capture** (the march window's box), against the game only (no lord's city, valley or flat): a won attack takes
  the loot but no valley, flat or city, and the target is full again for the next wave. An NPC city's loyalty still falls; at 0 it isn't taken, its hero (a historic hero
  with the portrait in hand) is a prisoner in the attacking city's Feasting Hall, and the city starts afresh.
- **The Battle Calculator**, **Build NPC** on a held flat (`rules.buildNpc.enabled`), **castle skins**, **mail
  attachments**, **alliance banner colours**, **Abandon Loyalty**, and the Reports window's filters and flags.

## Accounts

Players register with a user name (3 to 16 characters), an e-mail address and a password (at least 6
characters), and sign in with the name or the address. Passwords are stored only as salted scrypt hashes, and
sign-in tokens only as hashes, so `world.json` holds nothing that signs anyone in.
