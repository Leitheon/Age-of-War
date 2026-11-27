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
    `mapTile.jpg`, and `login-map.jpg`, the sign-in page's background: the game's map round Atlantis).
  - `tools/login-page/` — the sign-in page's look: `build.py` writes `login.css`, the fonts (Cinzel and Alegreya Sans,
    SIL Open Font License) and a drawn map (shown when `art/login-map.jpg` is missing) into `public/assets/`.
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
- `welcomeText`, `welcomeLink` — the line across the top of the game screen, and a link after it, until the admin
  page's Banner box sets them. Left out, they're "Welcome to Age of War! Join us on Discord: " and the server's
  Discord invite; `""` turns the link off.
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
  name and portrait, and is out of the barbarian cities and the Inn's rumours. He is bound to his city: whoever
  takes it from the NPCs gets him there at level 1 (125 in each stat, leadership 175; Poseidon 150 and 200), to lead its armies out
  (attack, scout, transport) but never to reinforce or found another city, be dismissed or be captured; another lord
  taking the city takes him as he is, and a city given up has him rule it again. The website's Heroes page shows where.
- **Be an Evonian**: the quest window has its Add to favorites button.
- **Player interaction items show** (`charms.js`): Fleet Feet, Endurance of the Immortals and Alchemist's Amplifier
  appear in the receiving lord's buff bar, and Opportunist's Plague, Lost in the Wastes, Poisoned Feast and Broken
  Gates in the bar of the city they hit, with their stacks and time left. The march window counts Fleet Feet and Lost
  in the Wastes (`army.getTroopParam`'s `marchCharmFactor`). The angel items' Lord name box asks for another lord's
  name (it said "blank = yourself", which was refused), and Broken Gates on your own city frees its gates (the web
  client asks no Open or Close; it held them open).
- **A sign-in page of its own** (`server/tools/login-page/`): the page where players sign in and register shows the
  game's own map round Atlantis (`art/login-map.jpg`, a screenshot from the client, 1920 x 1200), Atlantis left of
  the panel on any screen and below it on a phone, with the free fonts Cinzel and Alegreya Sans; none of DoA's art
  (its battle painting and Trajan Pro lettering) or its smoke and embers. The website's Heroes, NPCs and Drop Table
  links sit in a row at the top left. The "Entering the realm" screen after it shows the same map. The picture is
  found under a download's name too ("login-map (1).jpg", a .png) or beside the server's files; the server log and the
  admin page's overview say which file it shows, or where to put one.
- **The Discord invite on the banner**: the line scrolling across the top of the game screen ends with the server's
  Discord invite, a link that opens in a new tab (the line slows down while the mouse is over it). The admin page's
  Banner box (on the overview) changes the line and the link; players see it the next time they load the game. The
  game page loads it from `/welcome`, which the offline cache never keeps (it had kept `/welcome.js` like the art, so
  a browser went on showing the line it first saw).
- **Security and the admin page** (`server/src/game/security.js`, `admin.js`; `rules.security`):
  - One account per browser: each browser gets an id (the `aow_d` cookie), and a browser that already has an account
    can't sign up another, unless you allow it on the admin page (a household's shared computer).
  - Every sign-in records the account's address (the real one behind the Cloudflare Tunnel, from `CF-Connecting-IP`)
    and browser. Accounts sharing a browser, or an address within 30 days, are linked on the admin page.
  - E-mail aliases (`name+tag@`, dots in a Gmail name) count as the same address. Sign-ups are limited to 3 an address
    a day; 10 wrong passwords in 15 minutes stop sign-ins from that address, and to that account, for 15 minutes.
    The server's own computer is exempt.
  - The admin page (`/admin`): an overview of what needs a look; every account; a player's sign-ins, addresses,
    browsers, linked accounts, cities and activity; bans (an account, an address or a browser; for a time or for
    good, with a reason the player is shown), chat mutes, freezes (no transports, reinforcements or market trades
    with other lords), signing out, taking back resources, troops and items, password reset links and notes.
  - The activity log (`data/activity/YYYY-MM.jsonl`): sign-ups, sign-ins, wrong passwords, refused sign-ups,
    transports, reinforcements, market trades and policies between lords, and battles between lords. Every admin
    action is in the audit log.
- **Historic Cities never move**: no teleporter (Adv City, City, War or Pioneer Express) moves a Historic City a lord
  holds, and the item is kept. One a teleporter had moved before goes back to its spot when the server starts (the
  Historic City of its name, or else the nearest free one of its size).
- **Battles as on CC2** (Fox's 24 live tests, Nov 26 2026): a defending city's Scouts stay inside
  (`rules.battle.scoutsStay`), so attackers meet its Cavalry, in the live number of rounds; traps don't go off against
  siege troops or Transporters; between two lords 20% of the attacker's losses and 40% of the defender's come back
  wounded (`rules.wounded.lords`; 10% against NPCs and valleys).
- **One policy a lord's city every 24 hours** (`policies.targetHours`): a lord's city takes one Historic City policy a
  day, whoever issues it; NPC cities take any number.
- **Historic City policies on lords' cities**: the map's field window shows Policies on another lord's city (it showed
  them only on barbarian cities), for a Historic City you're in that reaches it and is above its level.
- **No undraftable numbers**: Draft and Disarmament, from a Historic City or on a colony, always take the biggest branch
  (`draft.undraftable`; true brings back live's 32-bit wrap and its "There are no troops in the city").
- **The city panel's troop counts fit their cells**: a long count gets a smaller font and is narrowed slightly. A troop's
  icon there opens the Disband window for that troop.
- **Attack any lord's city without a war** (`war.required` false; the web client has no Declare War): not your alliance's
  or a friendly alliance's, not in Truce or on vacation, and Beginner's Protection holds both ways.
- **Alliance Diplomacy**: the Manage pages show their messages (a refusal such as the 24-hour wait between relation changes
  showed nothing), Diplomacy says what it set and lists Neutral alliances too.
- **The Reports scroll flashes red under attack**: while an enemy army marches on a city whose Beacon Tower sees it, the
  main menu's Reports scroll flashes red (a red copy made in the browser from the menu's own icon), beside its "!".
- **Honor as live**: (worth killed - worth lost) / 8 for the winner, / 2 for the loser, but the loser never gains
  (`honor.loserGains`), and the report shows what was taken, honor stopping at 0 (Fox's CC2 reports).
- **The mount holds no stars**: Star on it is refused, saved mount stars are dropped, and the star set counts the other 13.
- **The Walls window shows build times**: each defense's time for one, and the time for the quantity typed.
- **Gear research is instant** (`gear.instantResearch`): a gear level is done the moment its research starts (materials and
  buildings still needed); a research left running from before finishes at startup. With timed research off, the Workshop
  shows research under way: "Researching Lv.N" with the time left, Speed Up and Cancel (the materials back).
- **Stars above 11 are 33% likelier** (`gear.starBoost`): from 11 stars up the success chance is 1.33 times live's
  (four Flawless gems: 66.5% for the 12th star, 59.9% after); the star window shows the same.
- **11-star gear is announced**: raising gear to 11 stars or more puts a [System] line in everyone's chat and on the
  Newsboard (`gear.announceStar`).
- **Wars and Historic City captures are announced**: an alliance setting another hostile, and a Historic City taken (from
  the NPCs or a lord), put a [System] line in everyone's chat and on the Newsboard (`announce`). Announcements to everyone
  show in World chat as well as the System tab.
- **King and Queen**: 101 in each base stat and leadership 26, growing 1 a level (`royalHero`); ones hired before are
  brought to it, their points kept. The royal helms' texts say so.
- **Historic heroes defend NPC cities at level 150**: a wild one in a barbarian city with his sheet's stats and 149
  points spread at random, a Historic City's ruler with the city's own numbers; a Historic Hero item still gives one at
  level 30 (`historicHeroes.level`, `historicHeroes.itemLevel`). One in a barbarian city has 9999 leadership
  (`historicHeroes.defenderLeadership`) and leads the whole garrison by it.
- **No experience items at the highest level**: Anabasis, Epitome of Military Science and On War don't work on a hero at
  his highest level (100, a Ring hero 120, a historic hero 150), and the item is kept.
- **Alliance War Reports** (the Military tab, renamed as RoboEvony has it): lists the members' attacks on NPC Historic
  Cities too, their opponent "[HISTORIC CITY]" (not barbarian cities or valleys), and a report opened there shows its outcome and troops (it showed every battle as a defeat with none).
- **Historic heroes taken from NPC cities start at level 1**, with their sheet's stats and no points, and must be levelled up
  (`historicHeroes.capturedLevel`); a hero taken from another lord keeps his level and stats.
- **Historic heroes get 1 point a level after the first** (none at level 1, 149 at 150), as
  live: Gao Guiying at 150 in the live ranking is her sheet + 150 + her gear. Ring heroes keep 2 a level. Heroes saved
  with more lose the extra at startup, unspent points first, then in proportion to where they went.
- **My Items**: the Angel and Devil items (Fleet Feet ... Broken Gates, used on another lord or his city) are under
  the Stratagem tab with the stratagems.
- **No world boss**: the web client's built-in Pumpkin Warden (a figure on the map at 0,2) is turned off; the
  server has no world boss.
- **Troops and resources**: a city holds 0 to 9,999,999,999 of each troop type (training past it is refused;
  troops arriving stop there, and a city already past it is brought down to it) and up to 100,000,000,000,000 of each resource. Troops eat a tenth of the live game's
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
