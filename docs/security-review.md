# Security review (November 2026)

A look at Doodlearium's security as a whole: who it answers, the grown-up PIN, every API route, the live screen connection, uploads, self-update, and how the pages show what the family types. Nothing was changed by the review itself. These notes are here to come back to.

**Short answer:** well built for a home network; not ready for the public internet.

## What's protecting it now

1. **Who gets an answer** (`server/security.ts`, `guard`): only private home-network addresses and Tailscale's (`access: "home"`), or only the PC's own networks (`"subnet"`). A router port forwarded by mistake still gets turned away, as long as the router keeps the visitor's own address (see *Router NAT* below).
2. **Requests from other websites:** anything that changes something must come from Doodlearium's own pages (the `Origin` / `Sec-Fetch-Site` check), and the server only answers to its own names (`allowedHost`). A web page open on a family laptop can't send requests to it, even dressed up with DNS rebinding.
3. **Grown-up PIN** (`requirePin`): ⬇️ Update now, deleting a drawing, and installing or uninstalling packs and worlds. Five wrong tries per address, then a five-minute wait. Pages remember a correct PIN for an hour (`client/shared/api.ts`), and ⚙️ → 🔒 Forget the PIN clears it sooner.
4. **Checked input** (`server/routes.ts`, `server/worlds.ts`, `server/text.ts`): every field has a size limit or a list of allowed values. Text has control and direction-flipping characters removed. Images must be real PNGs of at most 1024px. Drawing ids are looked up in the list before any file is touched, so paths can't be steered.
5. **No HTML injection found:** the pages show family text with `textContent` or draw it on the canvas. Every `innerHTML` in the client uses fixed strings.
6. **Limits and headers:** 300 changes and 30 uploads per address a minute; `nosniff`, `frame-ancestors 'self'`, `X-Frame-Options`, `Referrer-Policy`.

## Gaps, even at home

1. **Editing a drawing can destroy it without the PIN.** `PUT /api/drawings/:id` replaces the picture files and keeps no old copy. Anyone on the Wi-Fi can scribble over a drawing and save, and it's gone for good, while deleting the same drawing needs the PIN. Changing a world made on the server (`PUT /api/worlds/:id`) or taking one apart (`DELETE`, for worlds not installed from a file) is permanent too, also without the PIN.
   - **Idea:** keep the previous version of each edited drawing and world (for example `data/drawings/old/<id>.<time>.png` plus the old metadata) with an "↩ Undo changes" in the gallery. Kids keep editing freely and nothing is lost.
2. **No backups.** Everything is in `data/` on one PC. A failed disk, a bad update or a damaged data file loses it all.
   - **Idea:** a daily copy of `db.json`, `worlds.json`, `packs.json` and `history.jsonl` (keeping a week or two), and the drawings folder copied as new pictures arrive. It could go to another folder or drive set in `config.json`.
3. **A tunnel or proxy makes every visitor look like they're at home.** Something like Cloudflare Tunnel, ngrok or nginx running on the same PC connects from `127.0.0.1`, so every visitor passes the home-network check. Docker Desktop's port publishing (Windows and macOS) can do the same, since visitors arrive from a private gateway address. The name check blocks them at first, but adding the tunnel's name to `hosts` opens it to everyone.
   - **Idea:** notice proxy headers (`X-Forwarded-For`, `Forwarded`, `CF-Connecting-IP`) and refuse those visits unless the config says a proxy is trusted, and then check the forwarded address instead. Explain this in the config help and the README.

### Smaller things

- The PIN is compared with `===`, whose timing can leak hints (`crypto.timingSafeEqual` fixes that). The wrong-guess counts are kept in memory, so a restart resets them, and the map of addresses can grow without limit.
- Nothing limits how many live screen connections (`/ws`) there can be, or how fast `watch` messages arrive. Each `watch` sends that screen a roster.
- Storage has no overall cap: 30 uploads a minute of up to 8 MB each, stories of up to 50,000 characters, and history that keeps growing.
- Self-update (`scripts/start.mjs`) runs whatever is on the GitHub branch, including new npm packages (`npm ci` runs their install scripts). That's fine as long as the GitHub account has two-factor sign-in turned on and nobody else can push.
- The PNG check only reads the header. Files are served as `image/png` with `nosniff`, so a file that's really something else won't run, but the bytes are kept as they came.

## Why not the public internet

- **No logins:** anyone who found it could draw, edit, overwrite or switch off drawings, change the world, write stories and send every screen anywhere. The PIN only guards a few actions.
- **No HTTPS:** the PIN and everything else would travel unencrypted.
- **Everything is readable:** the kids' names as artists, every drawing and the whole history.
- **It can be filled up:** about 240 MB a minute from each address, with no cap on total disk use.
- **The PIN can be guessed:** the guess limit is per address, so a short PIN falls to guesses spread across many addresses.

For use away from home, **Tailscale** is the right answer: the server already accepts it, only devices you've signed in can reach it, the connection is encrypted, and nothing new is exposed. Real public hosting would need family logins (with sessions, not a header PIN), HTTPS, storage limits and backups first.

## Router NAT and the default gateway (to think about)

- **Normal port forwarding keeps the visitor's address.** A home router doing an ordinary port forward (destination NAT) passes the internet visitor's own public address through, so `access: "home"` turns them away. This is the usual case, and it's what the README describes.
- **Where it breaks: routers that also rewrite the source.** Some ISP gateways, some mesh systems and "NAT loopback / hairpin" set-ups also do source NAT on forwarded traffic, so every forwarded visitor arrives from the router's own LAN address and passes the check. Tunnels, proxies and Docker Desktop do the same thing (gap 3).
- **Idea: refuse the default gateway's address.** Visits from the PC's default gateway would be turned away or at least flagged, since a router hardly ever browses to a web page itself. Things to weigh:
  - Devices behind a second router in router (NAT) mode, such as a separate Wi-Fi router or a mesh node not in bridge mode, arrive from *that* router's address. That isn't the PC's default gateway, so they'd still work. If the PC itself sits behind that second router, though, its gateway *is* that router, and every device on the other side would be refused. That's the "split Wi-Fi / Ethernet" risk.
  - A router that bridges its Wi-Fi and Ethernet onto one subnet doesn't rewrite addresses between them, so it's unaffected.
  - Hairpin visits (a family device using the house's public address from inside) would be refused. That's probably fine, because the LAN address works.
  - Finding the gateway differs by platform (`route print` on Windows, `/proc/net/route` on Linux, `route -n get default` on macOS), and it can change, for example on a laptop.
  - **A gentler first step:** only *warn* in the server window (and maybe in ⚙️) the first time a visit comes from the gateway's address, explaining what it probably means. Refusing could be a `config.json` option once it's been seen to behave.
- **Also worth noting:** UPnP. The server never asks the router to open a port, but some other software on the PC might. A router setting to turn UPnP off closes that door.
