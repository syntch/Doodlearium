# 🐠 Doodlearium

A family digital aquarium where everything in the tank was drawn by the family. It runs on an always-on computer at home. Put the tank on the TV, and draw new creatures from any phone, tablet or PC on the home network.

There's one tank, and it lives on the server: every screen shows the same fish in the same places doing the same things, and life carries on while nobody's watching (and across restarts). Everything notable is written into a **history**, which can be turned into stories.

## Running it

```bash
npm install
npm start          # builds the client and serves everything on http://localhost:3000
```

The server prints its address on your network, for example `http://192.168.1.20:3000`. Open that address on other devices.

| Page | What it's for |
| --- | --- |
| `/tank/` | The aquarium. Double-click for full screen; click to drop food. Move the mouse (or tap) and buttons appear: **✏️ Draw**, **🖼️ Gallery** and **📖 History** to get around, **⚙️** for the tank controls (see below) and **🔇/🔊** (or the S key) for soft sounds. They hide again, with the cursor, when left alone. A **Coming up** card under the buttons lists what's about to happen (the next visitor, documentary, egg hatching or planned event); it stays on screen by itself in the last couple of minutes, so you know to gather round the TV. Point at a creature (or tap it) to see its name, who drew it and what it's like. The tank dims at night. The whole tank fits on any screen; a screen of a different shape sees more water above or sand below (a tall phone zooms in a little). See **Life in the tank** below for what goes on. |
| `/draw/` | Pick how it moves (see **Motion styles** below), draw it, then add it to the tank. It drops in live. **▶ Preview** shows it moving in a little tank while you draw (tap the preview to feed it). If the drawing's shape suits another style, a suggestion pops up. Tools: brush (with rainbow paint, and **invisible** paint that makes see-through holes, shown as a checkerboard), eraser, a **fill** bucket with materials (brick, stone, wood, bark, scales, stripes, dots, rainbow; **Turn** points scales up, down, left or right, and runs wood, bark, brick, stripes and rainbow across or up and down), **💡 Glow paint** (glows softly, brightest at night) and **🟣 Blacklight paint** (looks ordinary until the tank's blacklight goes on) for the brush and fill, **mirror** drawing, **⬚ Select** (paint over a part, or draw a loop around it, then drag it to move it, or make it bigger, smaller, turned, flipped, copied or deleted; extras on it come along), and **extras**. Extras are animated things pinned to a drawing: bubbles, sparkles, a glow, a googly eye, a waving flag and a propeller. The preview's **🟣 Blacklight** button shows blacklight paint glowing. **📷 Photo** turns a photo of a paper drawing into a drawing, removing the paper. You can also **paste** a picture (Ctrl+V, say after a Windows + Shift + S screenshot): on an empty page it's used like a photo, and on a drawing it lands on top, selected, ready to move and resize. A plain background around a pasted picture is cleared. **🌙 Night creature** makes it only come out after dark. |
| `/gallery/` | Every drawing ever made, babies included (**🐣 Babies** shows just those). **Edit** opens one in the draw page, for example to fix a fish that swims backwards. **Remove** deletes it. |
| `/history/` | Everything that's happened in the tank, day by day, with each creature's picture: new drawings, eggs and hatchings, babies growing up, visitors, documentary stars, chases, schools, puffer scares, big feeds, nightfall and holidays. Pick some days (or one creature) and tap **📖 Make a story prompt**: it writes a request for a story for a young reader, with the creatures and what they did, ready to copy and paste to Claude. Paste the finished story back with **✍️ Add a story** and it's kept at the top of the page, in big type for reading together. |

Every page has a **🍤 Feed** button that drops food into the tank.

## Life in the tank

- **Personalities.** Curious fish sometimes swim right up to the glass. Shy ones keep to the back and dart away from neighbours. Some of the bigger fish and eels are **hunters**: now and then one prowls after a smaller fish, and small fish scatter and hide behind the nearest plant or decoration. Nobody ever gets eaten. Every few minutes a few fish swim together as a school.
- **Feeding.** Fish race for food, look a little plumper for a while after eating, and a fish that's had its fill puffs out a little heart.
- **Sleepy nights.** After dark, day creatures drift down beside the plants (or to the bottom) and doze, swimming slowly with their blinking eyes closed, while night creatures come out. Food still wakes them up.
- **Eggs and babies.** When two 🐟 Fish have schooled together, they sometimes lay an egg. It sinks to the sand, and you can see the baby curled up inside. It wobbles more and more, then hatches after about 3 minutes. The baby takes after both parents: the front half from one, the tail from the other, their colours blending in the middle. It gets both parents' extras (googly eyes, flags, sparkles...), moving parts and glowing paint too. Its name is a mix of theirs, for example Bubbles + Nemo = Bubbmo. Babies hatch small and grow over their first week. Eggs are rare, at most one every 6 hours. Change that with the `EGG_GAP_MINUTES` setting (and the hatching time with `HATCH_SECONDS`) when starting the server, for example `EGG_GAP_MINUTES=120 npm start`. The tank shows the newest 6 babies, so they never crowd out the family's own drawings.
- **Documentary mode.** Every 5 to 10 minutes the camera slowly zooms in on one creature and follows it for half a minute, with a name card: who drew it, how long it's been in the tank and what it's like. The star swims up to the front, the rest of the tank dims around it like a spotlight, and it shows off: loop-the-loops, dashes, happy wiggles and streams of bubbles (puffers puff up, crawlers hop).
- **Visitors.** Rarely, something passes by: a whale far beyond the back wall, a diver, or (around Halloween) a friendly ghost.
- **Currents.** Now and then a gentle current sweeps through. Plants lean, bubbles and food drift, and fish get carried along a little.
- **Seasons**, by the date: snow in winter, glowing jack-o'-lanterns and spooky light around Halloween, twinkling lights in December, and hearts for Valentine's.

### Tank controls (⚙️)

The ⚙️ button on the tank opens a menu that works with a mouse or a finger, so a phone or tablet can run it too. It changes the **time of day**, the **holiday** decorations, turns the **blacklight** on or off, and makes things happen: a documentary, feeding, a school of fish, a current, puffers puffing, an egg (any time, skipping the usual wait) and visitors. There's only one tank, so whatever you pick shows on every screen: open the tank on your phone and control the TV. The menu shows what's on, and the time, holiday and blacklight stay as set (even after a restart) until changed back to 🕒 Real time, 📅 By the date and 💡 Off.

**⏰ Do it later** plans the next thing you pick for a time instead of now, say the whale at 7:30 pm or nightfall at bedtime. It shows in the **Coming up** card and the server does it on time, whether or not a screen is open.

Keys on the tank: D for a documentary, V for a visitor, B for the blacklight, S for sound.

For development, `npm run dev` runs the API on port 3000 and Vite with hot reload on http://localhost:5173.

Drawings are stored as PNG files in `data/drawings/`, with their details in `data/db.json`. The tank itself (where everyone is, the ⚙️ settings, planned events) is saved in `data/world.json` every 30 seconds and on shutdown, the history in `data/history.jsonl` and stories in `data/stories/`. Back up the `data/` folder to keep them.

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
| 🚢 Vessel | submarines, boats, robots | stays rigid and patrols in long, steady runs, now and then stopping to hover, puffing exhaust bubbles out of the back. It doesn't race the fish for food, but tidies up flakes that sink to the sand. Extras like propellers still animate |
| 🦀 Crawler | crabs, snails, starfish | walks along the sand with a bouncy step and eats food that lands there |
| 🌿 Plant | seaweed, coral | grows from the sand and sways |
| 🏰 Decoration | castles, chests, rocks | sits still on the sand |

Drawings made before motion styles existed keep working: fish become 🐟 Fish. To change a drawing's style, open it from the gallery with **Edit**.

## Moving parts

Any part of a drawing can move on its own, on top of the whole-body motion. With **⬚ Select**, tap a shape (or paint over a part) and press **✨ Animate**:

| Motion | Good for |
| --- | --- |
| 🪽 Pop-out | side fins and flaps: lifts up out of the paper where it's attached, uncovering a cut-out shadow |
| 🦋 Flap | tails, flippers: swings back and forth where it's attached |
| 🦪 Open & close | clams, mouths, lids: opens away from the rest of the drawing, holds, snaps shut and rests. The button on its chip picks how: **↪️** swings open (a mouth seen from the side), **↩️** swings the other way, or **⏫** lifts straight up, uncovering the dark inside (a clam seen from the front) |
| 🌀 Spin | propellers, wheels |
| 💓 Pulse | hearts, lights |
| 😉 Blink | eyes |

Each part's chip under the drawing has **▶** for its speed (normal, ⏩ fast, 🐢 slow) and **◐** for how far it moves (normal, ⬤ big, · small). Pop-out, Flap and Open & close show an orange line where the part is attached. It's found automatically, but if it's in the wrong place, tap **📍** on the part's chip under the drawing and draw a new line. Moving parts are saved with the drawing (as `<id>.parts.png` beside it) and come back when it's edited.

## How the shared tank works

The tank is split into a **brain** on the server and a **body** on each screen:

- **The brain** (`shared/sim/`, plain TypeScript with no graphics) decides where everyone goes and what happens: swimming, schools, hunting and hiding, food, sleep, eggs hatching, currents, the time of day. The server (`server/world.ts`) runs it ten times a second, always, in tank units (1600 × 900, the same for every screen), and picks the visitors and documentary stars. It sends every screen a small update ten times a second (each creature's position, size, turn, depth and swim rhythm), plus who's in the tank whenever that changes. It also writes notable moments into the history (`server/history.ts`).
- **The body** (`client/tank/`) draws it: `timeline.ts` draws a fifth of a second behind the server and blends between updates, so motion is smooth at full frame rate. The tail wave, bending, moving parts, extras, glow and bubbles are all worked out on the screen from that, so they look the same everywhere without being sent.
- Blending two parents into a baby takes a browser, so when it's time for an egg the server asks one open tank to make it (`egg:make`), which sends it back as a new drawing.
- The draw page's **▶ Preview** (`client/tank/mini.ts`) runs the same brain right in the browser, with one creature, so it needs no server and stays true to the TV.

## How the animation works

The motion style picks the brain (`shared/sim/tank.ts`) and the look (`client/tank/creatures.ts`):

- **Swimmers** (`shared/sim/swimmer.ts`, drawn by `behaviors/swimmer.ts`): every open-water style shares one brain: wandering, darting, chasing food, schools, glass visits and shyness, with each style's speed and way of moving in `shared/sim/styles.ts`. The body comes from a style in `bodies.ts`, which bends the drawing as a mesh. A fish's sine wave travels from head to tail and grows toward the tail, so any sideways drawing wags its tail; an eel's wave runs along its whole body; a jellyfish's bell squeezes while its tentacles lag behind. Extras ride the same bend. Swimmers turn around by squashing through zero width. All drawings are stored facing right; the draw page mirrors left-facing ones.
- **Crawlers** (`shared/sim/crawler.ts`, `behaviors/crawler.ts`): walk along the sand, pause, turn, and scuttle over to food on the sand.
- **Plants** (`behaviors/plant.ts`): rooted at the bottom (where `shared/sim/still.ts` planted them), swaying more toward the tip.
- **Decorations** (`behaviors/decor.ts`): sit still on the sand.
- **Puffers** are swimmers whose mesh can round out into a disc (`shape` in `behaviors/swimmer.ts`), with spikes drawn behind it.
- **Eggs** (`babies.ts`, `behaviors/egg.ts`): the tank blends the parents' pictures and asks the server for an egg (`POST /api/eggs`). The server saves the baby as a drawing with `parents` and `hatchAt`, and the tank shows it as an egg until then.
- **Glowing paint** (`glow.ts`): the draw page saves which pixels glow in a second image (`<id>.glow.png`: red for glow paint, green for blacklight paint). The tank lays a sharp and a blurred copy of those pixels over the creature, sharing its mesh so they bend with it, drawn above the night tint so they shine in the dark. Glowing paint on a moving part is cut out with the part and rides along with it.
- **The rest of tank life**: `documentary.ts`, `seasons.ts`, `events.ts` and `sounds.ts` (made on the fly, no sound files). The ⚙️ menu sends its commands to the server (`POST /api/tank`, or `POST /api/schedule` for later).
- **Moving parts** (`parts.ts`): drawings with parts are split when loaded into a body and one piece per part. Each piece animates around its hinge or middle and rides the body's bend, like extras do.

Random depth makes far-away things smaller and bluer. The tank shows the newest 40 swimmers, 10 crawlers, 24 plants, 14 decorations and 6 babies; older ones stay in the gallery.

A new visitor is a function in `events.ts` plus its entry in a pack in `VISITOR_PACKS` (`shared/sim/visitors.ts`): that's where themed packs (say, a space pack for a space fan) would go. A new swimming style is one entry each in `shared/sim/styles.ts` and `bodies.ts` plus a button on the draw page; a new kind of creature needs a motion in `shared/types.ts`, a brain in `shared/sim/`, a body in `behaviors/`, and a case in `Tank` and `createCreature`.
