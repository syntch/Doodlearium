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
| `/tank/` | The aquarium. Double-click for full screen; click to drop food. Move the mouse (or tap) and buttons appear: **✏️ Draw** and **🖼️ Gallery** to get around, **⚙️** for the tank controls (see below) and **🔇/🔊** (or the S key) for soft sounds. They hide again, with the cursor, when left alone. Point at a creature (or tap it) to see its name, who drew it and what it's like. The tank dims at night. See **Life in the tank** below for what goes on. |
| `/draw/` | Pick how it moves (see **Motion styles** below), draw it, then add it to the tank. It drops in live. **▶ Preview** shows it moving in a little tank while you draw (tap the preview to feed it). If the drawing's shape suits another style, a suggestion pops up. Tools: brush (with rainbow paint, and **invisible** paint that makes see-through holes, shown as a checkerboard), eraser, a **fill** bucket with materials (brick, stone, wood, bark, scales, stripes, dots, rainbow; **Turn** points scales up, down, left or right, and runs wood, bark, brick, stripes and rainbow across or up and down), **💡 Glow paint** (glows softly, brightest at night) and **🟣 Blacklight paint** (looks ordinary until the tank's blacklight goes on) for the brush and fill, **mirror** drawing, **⬚ Select** (paint over a part, or draw a loop around it, then drag it to move it, or make it bigger, smaller, turned, flipped, copied or deleted; extras on it come along), and **extras**. Extras are animated things pinned to a drawing: bubbles, sparkles, a glow, a googly eye, a waving flag and a propeller. The preview's **🟣 Blacklight** button shows blacklight paint glowing. **📷 Photo** turns a photo of a paper drawing into a drawing, removing the paper. **🌙 Night creature** makes it only come out after dark. |
| `/gallery/` | Every drawing ever made, babies included (**🐣 Babies** shows just those). **Edit** opens one in the draw page, for example to fix a fish that swims backwards. **Remove** deletes it. |

Every page has a **🍤 Feed** button that drops food into every open tank.

## Life in the tank

- **Personalities.** Curious fish sometimes swim right up to the glass. Shy ones keep to the back and dart away from neighbours. Some of the bigger fish and eels are **hunters**: now and then one prowls after a smaller fish, and small fish scatter and hide behind the nearest plant or decoration. Nobody ever gets eaten. Every few minutes a few fish swim together as a school.
- **Feeding.** Fish race for food, look a little plumper for a while after eating, and a fish that's had its fill puffs out a little heart.
- **Sleepy nights.** After dark, day creatures drift down beside the plants (or to the bottom) and doze, swimming slowly with their blinking eyes closed, while night creatures come out. Food still wakes them up.
- **Eggs and babies.** When two 🐟 Fish have schooled together, they sometimes lay an egg. It sinks to the sand, and you can see the baby curled up inside. It wobbles more and more, then hatches after about 3 minutes. The baby takes after both parents: the front half from one, the tail from the other, their colours blending in the middle. It gets both parents' extras (googly eyes, flags, sparkles...), moving parts and glowing paint too. Its name is a mix of theirs, for example Bubbles + Nemo = Bubbmo. Babies hatch small and grow over their first week. Eggs are rare, at most one every 6 hours however many tanks are open. Change that with the `EGG_GAP_MINUTES` setting (and the hatching time with `HATCH_SECONDS`) when starting the server, for example `EGG_GAP_MINUTES=120 npm start`. The tank shows the newest 6 babies, so they never crowd out the family's own drawings.
- **Documentary mode.** Every 5 to 10 minutes the camera slowly zooms in on one creature and follows it for half a minute, with a name card: who drew it, how long it's been in the tank and what it's like. The star swims up to the front, the rest of the tank dims around it like a spotlight, and it shows off: loop-the-loops, dashes, happy wiggles and streams of bubbles (puffers puff up, crawlers hop).
- **Visitors.** Rarely, something passes by: a whale far beyond the back wall, a diver, or (around Halloween) a friendly ghost.
- **Currents.** Now and then a gentle current sweeps through. Plants lean, bubbles and food drift, and fish get carried along a little.
- **Seasons**, by the date: snow in winter, glowing jack-o'-lanterns and spooky light around Halloween, twinkling lights in December, and hearts for Valentine's.

### Tank controls (⚙️)

The ⚙️ button on the tank opens a menu that works with a mouse or a finger, so a phone or tablet can run it too. It changes the **time of day**, the **holiday** decorations, turns the **blacklight** on or off, and makes things happen: a documentary, feeding, a school of fish, a current, puffers puffing, an egg (any time, skipping the usual wait) and visitors. With **📺 Change every open tank** ticked (the default), whatever you pick happens on every screen showing the tank, so you can open the tank on your phone and control the TV. Time, holiday and blacklight go back to normal when the tank page reloads.

To try things out by address instead:

| Add to the address | What it does |
| --- | --- |
| `?hour=22` | Pretends it's that hour, to see night (or any time of day) |
| `?date=2026-12-20` | Pretends it's that date, to see the seasons |
| `?doc` | Starts documentary mode after a few seconds (or press D any time) |
| `?event=whale` | Brings a visitor straight away: `whale`, `diver` or `ghost` (or press V for a random one) |
| `?events=ocean,spooky` | Picks which packs of visitors can appear |
| `?blacklight` | Starts with the blacklight on (or press B any time) |

Combine them with `&`, for example `/tank/?hour=22&date=2026-10-31`.

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
| 🐟 Fish | most fish | wags its tail, wanders, sometimes darts; joins schools and lays eggs |
| 🐡 Puffer | puffer fish, anything round | swims like a fish, but now and then (and whenever a hunter comes near) blows up into a spiky ball, the spikes the colour of the drawing, and tumbles slowly about before shrinking back |
| 🐍 Eel | long skinny things: eels, snakes, worms | the whole body ripples in an S-wave |
| 🪼 Jellyfish | jellyfish, squid, balloons | pulses upward and sinks between pulses; tentacles trail. Draw the bell on top |
| 🦄 Seahorse | seahorses, anything upright | hovers upright and bobs, tail curling. Draw the head at the top |
| 🐢 Glider | turtles, rays, birds, penguins | sails along in long, smooth swoops, its edges rippling. For flapping flippers or wings, make them moving parts (**⬚ Select → ✨ Animate → 🦋 Flap**) |
| 🚢 Vessel | submarines, boats, robots | stays rigid; extras like propellers still animate |
| 🦀 Crawler | crabs, snails, starfish | walks along the sand with a bouncy step and eats food that lands there |
| 🌿 Plant | seaweed, coral | grows from the sand and sways |
| 🏰 Decoration | castles, chests, rocks | sits still on the sand |

Drawings made before motion styles existed keep working: fish become 🐟 Fish. To change a drawing's style, open it from the gallery with **Edit**.

## Moving parts

Any part of a drawing can move on its own, on top of the whole-body motion. With **⬚ Select**, tap a shape (or paint over a part) and press **✨ Animate**:

| Motion | Good for |
| --- | --- |
| 🪽 Pop-out | side fins and flaps: lifts up out of the paper where it's attached, uncovering a cut-out shadow |
| 🦋 Flap | tails, jaws, flippers: swings back and forth where it's attached |
| 🌀 Spin | propellers, wheels |
| 💓 Pulse | hearts, lights |
| 😉 Blink | eyes |

Each part's chip under the drawing has **▶** for its speed (normal, ⏩ fast, 🐢 slow) and **◐** for how far it moves (normal, ⬤ big, · small). Pop-out and Flap show an orange line where the part is attached. It's found automatically, but if it's in the wrong place, tap **📍** on the part's chip under the drawing and draw a new line. Moving parts are saved with the drawing (as `<id>.parts.png` beside it) and come back when it's edited.

## How the animation works

The motion style picks the behaviour (`client/tank/creatures.ts`):

- **Swimmers** (`behaviors/swimmer.ts`): every open-water style shares one brain: wandering, darting, chasing food, schools, glass visits and shyness. The body comes from a style in `bodies.ts`, which bends the drawing as a mesh. A fish's sine wave travels from head to tail and grows toward the tail, so any sideways drawing wags its tail; an eel's wave runs along its whole body; a jellyfish's bell squeezes while its tentacles lag behind. Extras ride the same bend. Swimmers turn around by squashing through zero width. All drawings are stored facing right; the draw page mirrors left-facing ones.
- **Crawlers** (`behaviors/crawler.ts`): walk along the sand, pause, turn, and scuttle over to food on the sand.
- **Plants** (`behaviors/plant.ts`): rooted at the bottom, swaying more toward the tip.
- **Decorations** (`behaviors/decor.ts`): sit still on the sand.
- **Puffers** are swimmers whose mesh can round out into a disc (`shape` in `behaviors/swimmer.ts`), with spikes drawn behind it.
- **Eggs** (`babies.ts`, `behaviors/egg.ts`): the tank blends the parents' pictures and asks the server for an egg (`POST /api/eggs`). The server saves the baby as a drawing with `parents` and `hatchAt`, and every tank shows it as an egg until then.
- **Glowing paint** (`glow.ts`): the draw page saves which pixels glow in a second image (`<id>.glow.png`: red for glow paint, green for blacklight paint). The tank lays a sharp and a blurred copy of those pixels over the creature, sharing its mesh so they bend with it, drawn above the night tint so they shine in the dark.
- **The rest of tank life**: `documentary.ts`, `seasons.ts`, `events.ts` and `sounds.ts` (made on the fly, no sound files). The ⚙️ menu sends its commands through the server (`POST /api/tank`) to every open tank.
- **Moving parts** (`parts.ts`): drawings with parts are split when loaded into a body and one piece per part. Each piece animates around its hinge or middle and rides the body's bend, like extras do.

Random depth makes far-away things smaller and bluer. The tank shows the newest 40 swimmers, 10 crawlers, 24 plants, 14 decorations and 6 babies; older ones stay in the gallery.

A new visitor is a function in `events.ts`, added to a pack in `EVENT_PACKS`: that's where themed packs (say, a space pack for a space fan) would go. A new swimming style is one entry in `bodies.ts` plus a button on the draw page; a new kind of creature needs a motion in `shared/types.ts`, a behaviour class, and a case in `createCreature`. The draw page's preview (`client/tank/mini.ts`) runs the same tank code, so it stays true to the TV.
