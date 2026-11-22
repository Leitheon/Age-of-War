# Hosting Age of War at playageofwar.com

The server runs on your PC; a Cloudflare Tunnel carries players' connections to it, with HTTPS, without opening any
port on your router. Cloudflare also caches the game's pictures, so your home connection mostly carries the game
itself. Free apart from the domain.

The catch: the game is up only while the PC is on and awake. Moving to a rented server later is a matter of copying
the server folder (the world is `server/data/world.json`).

## 1. The domain

Buy `playageofwar.com` in the Cloudflare dashboard (**Domain Registration** > **Register Domains**). Bought there,
it's on Cloudflare already. (Bought elsewhere, add it to Cloudflare and change its nameservers to the two Cloudflare
gives you; a tunnel needs Cloudflare to answer for the domain.)

## 2. The server

1. Unzip the release, put the art in `server\art` and `EvonyClient1921.swf` in `server\client`.
2. Run `start.bat` once, so it writes `config.json`, then close it.
3. In `config.json` set `"publicUrl": "https://playageofwar.com"` (password reset links use it). If the community
   has a Discord, put its invite in `"welcomeLink"`.
4. Right-click `install-autostart.bat` > **Run as administrator**. From now on the server starts by itself 30 seconds
   after the PC starts, even before anyone signs in to Windows, and starts again if it ever stops. (Don't also run
   `start.bat` while it's running: they'd fight over the port. `remove-autostart.bat` undoes it.)
5. Check `http://localhost:8090/` opens the game on this PC.

If Windows asks whether Node.js may use the network, it doesn't need public networks: the tunnel reaches the server
from this PC.

## 3. The tunnel

1. In the Cloudflare dashboard go to **Networking** > **Tunnels** > **Create Tunnel**, name it `age-of-war`, and
   create it.
2. Under **Setup Environment** pick **Windows**. Install `cloudflared` from the link it gives, then open Command
   Prompt as administrator and run the command it shows: `cloudflared.exe service install <token>`. That installs it
   as a Windows service, so it also starts with the PC.
3. When the tunnel shows **Healthy**, select **Continue**.
4. Under **Routes** > **Add route** > **Published application**: hostname `playageofwar.com` (no subdomain),
   service URL `http://localhost:8090`. Add a second one for `www`, the same service URL.
5. In the domain's **Network** settings, make sure **WebSockets** is on (the game's connection is one).

Open `https://playageofwar.com`: the sign-in page should come up. Register, sign in, and look at the map.

## 4. Keeping it up

- **Power**: set the PC never to sleep (Settings > System > Power). Restarts for Windows updates are fine: the
  server and the tunnel both come back by themselves.
- **Backups**: copy `server\data\world.json` somewhere else now and then (it's the whole world: accounts, cities,
  everything). Copy it while the server runs; it's written whole every few seconds.
- **The admin page** is `https://playageofwar.com/admin` (user `admin`, the password in `config.json`). To keep
  everyone else from even reaching it, Cloudflare Zero Trust can put a sign-in in front of `/admin` and `/coins`
  (**Access** > **Applications** > a self-hosted application for those paths, allowing only your e-mail).
- **Players' addresses**: behind the tunnel every connection comes from this PC, so the server's log shows
  `127.0.0.1` for everyone.
