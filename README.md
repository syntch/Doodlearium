# 🐠 Doodlearium

A family digital aquarium where everything in the tank was drawn by the family. It runs on an always-on computer at home. Put the tank on the TV, and draw new creatures from any phone, tablet or PC on the home network.

## Running it

```bash
npm install
npm start          # builds the client and serves everything on http://localhost:3000
```

The server prints its address on your network, for example `http://192.168.1.20:3000`. Open that address on other devices.

| Page | What it's for |
| --- | --- |
| `/tank/` | The aquarium. Double-click for full screen; click to drop food. The cursor hides itself, and the tank dims at night. Add `?hour=22` to the address to preview night (or any hour). |
| `/draw/` | Pick how it moves (see **Motion styles** below), draw it, then add it to the tank. It drops in live. **▶ Preview** shows it moving in a little tank while you draw (tap the preview to feed it). If the drawing's shape suits another style, a suggestion pops up. Tools: brush (with rainbow paint, and **invisible** paint that makes see-through holes, shown as a checkerboard), eraser, a **fill** bucket with materials (brick, stone, wood, bark, scales, stripes, dots, rainbow), **mirror** drawing, **⬚ Select** (paint over a part, or draw a loop around it, then drag it to move it, or make it bigger, smaller, turned, flipped, copied or deleted; extras on it come along), and **extras**. Extras are animated things pinned to a drawing: bubbles, sparkles, a glow, a googly eye, a waving flag and a propeller. **📷 Photo** turns a photo of a paper drawing into a drawing, removing the paper. **🌙 Night creature** makes it only come out after dark. |
| `/gallery/` | Every drawing ever made. **Edit** opens one in the draw page, for example to fix a fish that swims backwards. **Remove** deletes it. |

Every page has a **🍤 Feed** button that drops food into every open tank. Fish also have personalities: curious ones sometimes swim right up to the glass, shy ones keep to the back and dart away from neighbours, and every few minutes a few fish swim together as a school.

For development, `npm run dev` runs the API on port 3000 and Vite with hot reload on http://localhost:5173.

Drawings are stored as PNG files in `data/drawings/`, with their details in `data/db.json`. Back up the `data/` folder to keep them.

## Running it on the always-on server

The easiest setup is Docker, on any Linux VM or LXC container on the same machine as Home Assistant. Copy this folder over, leaving out `node_modules`, `dist` and `data`, then run:

```bash
docker compose up -d --build
```

It restarts on its own after reboots and crashes. Then open `http://<server-ip>:3000/tank/` on the TV.

- **Update** after changing the code: run `docker compose up -d --build` again. Drawings are kept.
- **Logs**: `docker compose logs -f`
- **Back up the drawings**: `docker run --rm -v doodlearium_doodlearium-data:/data -v "$PWD":/backup alpine tar czf /backup/doodlearium-backup.tgz -C /data .`
- **Use a different port**: change the left side of `"3000:3000"` in `compose.yaml`.

Without Docker, install Node 24 and run `npm ci && npm start` as a service (for example a systemd unit with `Restart=always`).

## Motion styles

The style picked on the draw page decides how a drawing moves and where it lives:

| Style | Good for | How it moves |
| --- | --- | --- |
| 🐟 Fish | most fish | wags its tail, wanders, sometimes darts; joins schools |
| 🐍 Eel | long skinny things: eels, snakes, worms | the whole body ripples in an S-wave |
| 🪼 Jellyfish | jellyfish, squid, balloons | pulses upward and sinks between pulses; tentacles trail. Draw the bell on top |
| 🦄 Seahorse | seahorses, anything upright | hovers upright and bobs, tail curling. Draw the head at the top |
| 🐢 Flapper | turtles, rays, birds, penguins | the top and bottom edges flap, then it glides |
| 🚢 Vessel | submarines, boats, robots | stays rigid; extras like propellers still animate |
| 🦀 Crawler | crabs, snails, starfish | walks along the sand with a bouncy step and eats food that lands there |
| 🌿 Plant | seaweed, coral | grows from the sand and sways |
| 🏰 Decoration | castles, chests, rocks | sits still on the sand |

Drawings made before motion styles existed keep working: fish become 🐟 Fish. To change a drawing's style, open it from the gallery with **Edit**.

## How the animation works

The motion style picks the behaviour (`client/tank/creatures.ts`):

- **Swimmers** (`behaviors/swimmer.ts`): every open-water style shares one brain: wandering, darting, chasing food, schools, glass visits and shyness. The body comes from a style in `bodies.ts`, which bends the drawing as a mesh. A fish's sine wave travels from head to tail and grows toward the tail, so any sideways drawing wags its tail; an eel's wave runs along its whole body; a jellyfish's bell squeezes while its tentacles lag behind. Extras ride the same bend. Swimmers turn around by squashing through zero width. All drawings are stored facing right; the draw page mirrors left-facing ones.
- **Crawlers** (`behaviors/crawler.ts`): walk along the sand, pause, turn, and scuttle over to food on the sand.
- **Plants** (`behaviors/plant.ts`): rooted at the bottom, swaying more toward the tip.
- **Decorations** (`behaviors/decor.ts`): sit still on the sand.

Random depth makes far-away things smaller and bluer. The tank shows the newest 40 swimmers, 10 crawlers, 24 plants and 14 decorations; older ones stay in the gallery.

A new swimming style is one entry in `bodies.ts` plus a button on the draw page; a new kind of creature needs a motion in `shared/types.ts`, a behaviour class, and a case in `createCreature`. The draw page's preview (`client/tank/mini.ts`) runs the same tank code, so it stays true to the TV.
