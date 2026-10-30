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
| `/tank/` | The aquarium. Double-click for full screen. The cursor hides itself, and the tank dims at night. |
| `/draw/` | Draw a fish, plant or decoration, then add it to the tank. It drops in live. Tools: brush (with rainbow paint), eraser, a **fill** bucket with materials (brick, stone, bark, scales, stripes, dots, rainbow), **mirror** drawing, and **extras**. Extras are animated things pinned to a drawing: bubbles, sparkles, a glow, a googly eye, a waving flag and a propeller. |
| `/gallery/` | Every drawing ever made. **Edit** opens one in the draw page, for example to fix a fish that swims backwards. **Remove** deletes it. |

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

## How the animation works

Each drawing's type picks its behaviour (`client/tank/creatures.ts`):

- **Fish** (`behaviors/swimmer.ts`): the drawing becomes a mesh. A sine wave travels from head to tail and grows toward the tail, so any sideways drawing wags its tail. The fish wanders between random targets, sometimes darts, and turns around by squashing through zero width. All drawings are stored facing right; the draw page mirrors left-facing ones.
- **Plants** (`behaviors/plant.ts`): rooted at the bottom, swaying more toward the tip.
- **Decorations** (`behaviors/decor.ts`): sit still on the sand.

Random depth makes far-away things smaller and bluer. The tank shows the newest 40 fish, 24 plants and 14 decorations; older ones stay in the gallery.

A new kind of creature (crab, jellyfish, bird…) needs three things: a type in `shared/types.ts`, a behaviour class, and a case in `createCreature`.
