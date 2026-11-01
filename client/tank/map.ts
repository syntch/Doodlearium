import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { MapSummary } from '../../shared/sim/protocol.ts';
import { WORLD_H, WORLD_W } from '../../shared/sim/world.ts';
import { BIOME_NAMES, shapeOf } from '../../shared/world/biomes.ts';
import { MAP_H, MAP_W, PLACES, REGIONS, type Place } from '../../shared/world/places.ts';
import { biomeBackdrop, sandColor } from './scene.ts';
import { TAU, seededRandom } from './world.ts';

/** A porthole's size on the map, in map units. */
export const PORTHOLE = 58;
const LOCKED = 38;

const SEA = 0x3b8fc4;
const LAND = 0x8cc56a;
const FONT = 'Trebuchet MS, sans-serif';

/** Where each region's name goes. */
const REGION_LABELS: Record<string, [number, number]> = {
  valley: [405, 448],
  coast: [860, 330],
  highlands: [230, 70],
};

/** The coastline, from the top right down to the bottom: land is to its left. */
const COAST: [number, number][] = [
  [1000, 160], [930, 200], [860, 260], [800, 330], [750, 385], [725, 430], [690, 480], [650, 545], [610, 615], [575, 700],
];

/** The river, from the Lake down to the sea. */
const RIVER: [number, number][] = [[430, 300], [500, 280], [575, 315], [640, 355], [700, 365], [762, 372]];

/** Pictures a place's creatures, so its porthole can show them bobbing about. */
export interface MapLooks {
  /** Starts loading a species' picture; give it back with release. */
  use(species: string): { texture: Promise<Texture | null>; release(): void } | null;
}

interface Swimmer {
  species: string;
  sprite: Sprite;
  release(): void;
  phase: number;
  speed: number;
  depth: number;
}

interface Porthole {
  place: Place;
  view: Container;
  inside: Container;
  count: Text;
  swimmers: Swimmer[];
  shown: string;
}

/**
 * The storybook map of the whole world: the sea and the coast, a river from the Lake, the highlands, and a
 * porthole for every place showing a few of the creatures that live there (places that aren't open yet are
 * greyed out). Drawn in map units (MAP_W × MAP_H); the tank page scales it, and zooms through a porthole
 * into its place.
 */
export class WorldMap {
  readonly view = new Container();
  private clouds: { node: Graphics; x: number; y: number; speed: number }[] = [];
  private waves = new Graphics();
  private portholes: Porthole[] = [];
  private note: Text;
  private noteFor = 0;
  /** A tap on a live place. */
  onPick: (place: string) => void = () => {};

  constructor(private looks: MapLooks) {
    // Clouds drift over the land, under the places (so they never hide a porthole).
    const clouds = new Container();
    this.view.addChild(this.drawLand(), this.waves, clouds);
    for (const p of PLACES) this.view.addChild(p.live ? this.livePorthole(p) : this.lockedPlace(p));
    for (const r of REGIONS) {
      const [x, y] = REGION_LABELS[r.id];
      const label = new Text({
        text: r.name,
        style: { fontFamily: FONT, fontSize: 22, fontStyle: 'italic', fontWeight: 'bold', fill: 0x24402a, letterSpacing: 2 },
        anchor: 0.5,
        alpha: 0.55,
      });
      label.position.set(x, y);
      this.view.addChild(label);
    }
    const rand = seededRandom('clouds');
    for (let i = 0; i < 4; i++) {
      const node = new Graphics();
      const s = rand(0.7, 1.2);
      for (const [dx, dy, r] of [[0, 0, 26], [24, -8, 22], [46, 2, 20], [-22, 4, 18]]) node.circle(dx * s, dy * s, r * s);
      node.fill({ color: 0xffffff, alpha: 0.75 });
      this.clouds.push({ node, x: rand(0, MAP_W), y: rand(40, MAP_H - 80), speed: rand(4, 9) });
      clouds.addChild(node);
    }
    this.note = new Text({
      text: '',
      style: { fontFamily: FONT, fontSize: 18, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0x2b3a2b, width: 4, join: 'round' }, align: 'center' },
      anchor: 0.5,
      alpha: 0,
    });
    this.view.addChild(this.note);
  }

  /** The middle of a place's porthole, in map units. */
  centre(place: string) {
    const p = PLACES.find((x) => x.id === place);
    return p ? { x: p.x, y: p.y } : { x: MAP_W / 2, y: MAP_H / 2 };
  }

  private drawLand() {
    const g = new Graphics();
    // The sea goes on forever, so a screen of any shape sees sea past the edges.
    g.rect(-3000, -3000, MAP_W + 6000, MAP_H + 6000).fill(SEA);
    const coast = COAST.flatMap(([x, y]) => [x, y]);
    g.poly([-3000, -3000, MAP_W + 3000, -3000, MAP_W + 3000, COAST[0][1], ...coast, COAST.at(-1)![0] - 40, MAP_H + 3000, -3000, MAP_H + 3000]).fill(LAND);
    // A sandy beach along the shore.
    g.moveTo(COAST[0][0], COAST[0][1]);
    for (const [x, y] of COAST.slice(1)) g.lineTo(x, y);
    g.stroke({ width: 22, color: 0xf0dca0, join: 'round', cap: 'round' });
    g.moveTo(COAST[0][0], COAST[0][1]);
    for (const [x, y] of COAST.slice(1)) g.lineTo(x + 6, y + 4);
    g.stroke({ width: 6, color: 0xffffff, alpha: 0.6, join: 'round' });

    const rand = seededRandom('map');
    // Misty highlands: soft hills, then a few tall ones with snowy tops.
    for (let i = 0; i < 14; i++) {
      const x = rand(60, 460);
      const y = rand(60, 210);
      const r = rand(40, 80);
      g.ellipse(x, y, r, r * 0.55).fill({ color: 0x6fa75a, alpha: 0.7 });
    }
    for (const [x, y, h] of [[240, 140, 70], [330, 120, 90], [400, 165, 60], [180, 110, 55]]) {
      g.poly([x - h * 0.8, y + h * 0.3, x, y - h * 0.7, x + h * 0.8, y + h * 0.3]).fill(0x7d8f80);
      g.poly([x - h * 0.25, y - h * 0.32, x, y - h * 0.7, x + h * 0.25, y - h * 0.32]).fill(0xf2f5f7);
    }
    g.ellipse(260, 190, 160, 22).fill({ color: 0xffffff, alpha: 0.25 });
    // The woods.
    for (let i = 0; i < 26; i++) {
      const x = rand(50, 230);
      const y = rand(200, 330);
      g.rect(x - 2, y, 4, 12).fill(0x6b4a2a);
      g.circle(x, y - 4, rand(9, 14)).fill(rand() < 0.5 ? 0x3f7d3a : 0x4f9446);
    }
    // The meadow's flowers.
    for (let i = 0; i < 40; i++) g.circle(rand(250, 420), rand(520, 640), 3).fill([0xffe36b, 0xffffff, 0xf6a8c8][Math.floor(rand(0, 3))]);
    // The farm's fields.
    for (let i = 0; i < 5; i++) g.rect(470 + (i % 3) * 38, 470 + Math.floor(i / 3) * 34, 34, 30).fill(i % 2 ? 0xd8c56a : 0xa5c75a);
    // The river from the Lake to the sea.
    g.moveTo(RIVER[0][0], RIVER[0][1]);
    for (let i = 1; i < RIVER.length - 1; i++) {
      const [x, y] = RIVER[i];
      const [nx, ny] = RIVER[i + 1];
      g.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    g.lineTo(...RIVER.at(-1)!);
    g.stroke({ width: 12, color: 0x4aa3d6, cap: 'round', join: 'round' });
    return g;
  }

  private livePorthole(place: Place) {
    const view = new Container();
    view.position.set(place.x, place.y);
    const R = PORTHOLE;
    // The water as it looks there: sky, water and the bottom, in the place's own colours.
    const shape = shapeOf(place.biome, WORLD_W, WORLD_H);
    const h = 256;
    const bg = new Sprite(biomeBackdrop(place.biome, h, (shape.waterTop / WORLD_H) * h, (shape.floorAt(WORLD_W / 2) / WORLD_H) * h));
    bg.anchor.set(0.5);
    bg.width = R * 2;
    bg.height = R * 2;
    const inside = new Container();
    const sand = new Graphics().ellipse(0, R * 0.95, R * 1.3, R * 0.35).fill(sandColor(place.biome));
    const mask = new Graphics().circle(0, 0, R).fill(0xffffff);
    const contents = new Container();
    contents.addChild(bg, sand, inside);
    contents.mask = mask;
    const glass = new Graphics().ellipse(-R * 0.35, -R * 0.45, R * 0.35, R * 0.16).fill({ color: 0xffffff, alpha: 0.25 });
    const ring = new Graphics().circle(0, 0, R + 4).stroke({ width: 10, color: 0xc9a227 }).circle(0, 0, R + 9).stroke({ width: 2, color: 0x7a5a10 });
    for (let i = 0; i < 8; i++) ring.circle(Math.cos((i / 8) * TAU) * (R + 4), Math.sin((i / 8) * TAU) * (R + 4), 2.6).fill(0x7a5a10);
    const banner = new Graphics();
    const name = new Text({ text: place.name, style: { fontFamily: FONT, fontSize: 17, fontWeight: 'bold', fill: 0x3b2a10 }, anchor: 0.5 });
    const count = new Text({ text: '', style: { fontFamily: FONT, fontSize: 13, fill: 0x5b4a2a }, anchor: 0.5 });
    const w = name.width + 30;
    banner.roundRect(-w / 2, R + 10, w, 40, 10).fill(0xfff4d6).stroke({ width: 2, color: 0xc9a227 });
    name.position.set(0, R + 23);
    count.position.set(0, R + 40);
    view.addChild(contents, mask, glass, ring, banner, name, count);
    view.eventMode = 'static';
    view.cursor = 'pointer';
    view.on('pointertap', () => this.onPick(place.id));
    this.portholes.push({ place, view, inside, count, swimmers: [], shown: '' });
    return view;
  }

  private lockedPlace(place: Place) {
    const view = new Container();
    view.position.set(place.x, place.y);
    const icon = BIOME_NAMES[place.biome].split(' ')[0];
    const g = new Graphics()
      .circle(0, 0, LOCKED + 4)
      .fill({ color: 0x5b6b55, alpha: 0.35 })
      .circle(0, 0, LOCKED)
      .fill({ color: 0xd9e6cf, alpha: 0.75 })
      .stroke({ width: 3, color: 0x8a9a80, alpha: 0.8 });
    const emoji = new Text({ text: icon, style: { fontSize: 34 }, anchor: 0.5, alpha: 0.55 });
    const label = new Text({
      text: `${place.name}\n🔒 coming soon`,
      style: { fontFamily: FONT, fontSize: 13, fontWeight: 'bold', fill: 0x3f4a3a, align: 'center' },
      anchor: { x: 0.5, y: 0 },
      alpha: 0.8,
    });
    label.position.set(0, LOCKED + 6);
    const backing = new Graphics().roundRect(-label.width / 2 - 6, LOCKED + 4, label.width + 12, label.height + 4, 8).fill({ color: 0xf4f8ee, alpha: 0.75 });
    view.addChild(g, emoji, backing, label);
    view.eventMode = 'static';
    view.cursor = 'pointer';
    view.on('pointertap', () => this.say(place, 'Nobody lives here yet.\nLand creatures are coming soon!'));
    return view;
  }

  /** A little note over a place, for a few seconds. */
  private say(place: Place, text: string) {
    this.note.text = text;
    this.note.position.set(place.x, place.y - LOCKED - 34);
    this.noteFor = 3;
  }

  /** Who lives where, from the server: each porthole shows a few of its kinds. */
  setSummary(summary: MapSummary) {
    for (const p of this.portholes) {
      const info = summary[p.place.id];
      p.count.text = info ? `${info.count} creature${info.count === 1 ? '' : 's'}` : '';
      const species = [...(info?.species ?? [])].sort().slice(0, 4);
      const key = species.join(',');
      if (key === p.shown) continue;
      p.shown = key;
      for (const s of p.swimmers) {
        s.sprite.destroy();
        s.release();
      }
      p.swimmers = [];
      species.forEach((id, i) => {
        const look = this.looks.use(id);
        if (!look) return;
        const sprite = new Sprite();
        sprite.anchor.set(0.5);
        sprite.visible = false;
        p.inside.addChild(sprite);
        const swimmer: Swimmer = { species: id, sprite, release: look.release, phase: i * 1.7, speed: 0.25 + (i % 3) * 0.08, depth: -0.45 + i * 0.28 };
        p.swimmers.push(swimmer);
        void look.texture.then((texture) => {
          if (!texture || sprite.destroyed) return;
          sprite.texture = texture;
          // About a third of the porthole across.
          const s = (PORTHOLE * 0.62) / Math.max(texture.width, texture.height * 1.4);
          sprite.scale.set(s);
          sprite.visible = true;
        });
      });
    }
  }

  update(dt: number, time: number) {
    for (const p of this.portholes) {
      for (const s of p.swimmers) {
        // Back and forth across the porthole, turning at each end.
        const t = time * s.speed + s.phase;
        s.sprite.x = Math.sin(t) * PORTHOLE * 0.55;
        s.sprite.y = s.depth * PORTHOLE + Math.sin(t * 2.3) * 4;
        s.sprite.scale.x = Math.abs(s.sprite.scale.x) * (Math.cos(t) >= 0 ? 1 : -1);
      }
    }
    for (const c of this.clouds) {
      c.x += c.speed * dt;
      if (c.x > MAP_W + 200) c.x = -200;
      c.node.position.set(c.x, c.y);
    }
    const g = this.waves.clear();
    for (let i = 0; i < 18; i++) {
      const rand = seededRandom(`wave${i}`);
      const x = rand(640, MAP_W + 100) + Math.sin(time * 0.4 + i) * 8;
      const y = rand(200, MAP_H + 60);
      // Only out at sea.
      if (x < 620 + (y - 160) * 0.25 + 60) continue;
      g.moveTo(x - 10, y).quadraticCurveTo(x - 5, y - 5, x, y).quadraticCurveTo(x + 5, y - 5, x + 10, y).stroke({ width: 2, color: 0xffffff, alpha: 0.45 });
    }
    this.noteFor = Math.max(0, this.noteFor - dt);
    this.note.alpha = Math.min(1, this.noteFor);
  }
}
