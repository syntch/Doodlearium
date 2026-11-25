import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { MapSummary } from '../../shared/sim/protocol.ts';
import { WORLD_H, WORLD_W } from '../../shared/sim/world.ts';
import { BIOME_NAMES, shapeOf } from '../../shared/world/biomes.ts';
import { lookOf } from '../../shared/world/looks.ts';
import { MAP_H, MAP_W, type Place, type WorldDef } from '../../shared/world/places.ts';
import { biomeBackdrop, sandColor } from './scene.ts';
import { ringHalf } from './spacescene.ts';
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
  use(species: string): { texture: Promise<Texture | null>; release(): void; stand: Stand } | null;
}

/** Plants and decorations stay put on the bottom, walkers and crawlers go along it, the rest swim or fly. */
export type Stand = 'still' | 'walks' | 'swims';

interface Swimmer {
  species: string;
  stand: Stand;
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
  /** A glow round it when it's chosen (the place picker on the draw page). */
  glow: Graphics;
}

/** How the place picker shows a place: chosen, free to choose, or not suited to the drawing. */
export type Mark = 'chosen' | 'free' | 'unsuited';

/** Space maps: the dark between the stars. */
const SPACE = 0x070b24;

/**
 * The storybook map of one world, with a porthole for every place showing a few of the creatures that live
 * there. Earth's is drawn by hand (the sea and the coast, a river from the Lake, the highlands); other worlds
 * are islands in a sea, or planets among the stars, laid out around their places. Drawn in map units
 * (MAP_W × MAP_H); the tank page scales it, and zooms through a porthole into its place.
 */
export class WorldMap {
  readonly view = new Container();
  private clouds: { node: Graphics; x: number; y: number; speed: number }[] = [];
  private waves = new Graphics();
  private twinkles = new Graphics();
  private portholes: Porthole[] = [];
  private note: Text;
  private noteFor = 0;
  /** A tap on a live place. */
  onPick: (place: string) => void = () => {};

  constructor(
    private looks: MapLooks,
    readonly world: WorldDef,
  ) {
    const space = world.mapStyle === 'space';
    // Clouds drift over the land, under the places (so they never hide a porthole).
    const clouds = new Container();
    this.view.addChild(world.mapStyle === 'earth' ? this.drawLand() : space ? this.drawSpace() : this.drawIslands(), space ? this.twinkles : this.waves, clouds);
    for (const p of world.places) this.view.addChild(this.livePorthole(p));
    for (const r of world.mapStyle === 'earth' ? world.regions : []) {
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
    for (let i = 0; i < (space ? 0 : 4); i++) {
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
    const p = this.world.places.find((x) => x.id === place);
    return p ? { x: p.x, y: p.y } : { x: MAP_W / 2, y: MAP_H / 2 };
  }

  /**
   * What a tall phone should see: the middle of the places and how wide they spread (Earth's open places
   * span about 780 map units, around 555, 400).
   */
  frame() {
    if (this.world.mapStyle === 'earth') return { x: 555, y: 400, span: 780 };
    const xs = this.world.places.map((p) => p.x);
    const ys = this.world.places.map((p) => p.y);
    const span = Math.min(MAP_W, Math.max(420, Math.max(...xs) - Math.min(...xs) + PORTHOLE * 4));
    return { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2, span };
  }

  /** Islands in a sea: one for each place, grown from its id so it never changes, a little sandy beach round each. */
  private drawIslands() {
    const g = new Graphics();
    g.rect(-3000, -3000, MAP_W + 6000, MAP_H + 6000).fill(SEA);
    for (const pass of ['sand', 'land'] as const) {
      for (const p of this.world.places) {
        const rand = seededRandom(`island:${p.id}`);
        const water = shapeOf(p.biome, WORLD_W, WORLD_H).waterTop < WORLD_H * 0.5 && p.biome !== 'seashore';
        // Water places are lagoons: a ring of land round a pool.
        for (let i = 0; i < 6; i++) {
          const a = rand(0, TAU);
          const d = rand(0, 46);
          const r = rand(56, 84) + (pass === 'sand' ? 14 : 0);
          g.ellipse(p.x + Math.cos(a) * d, p.y + 24 + Math.sin(a) * d * 0.6, r, r * 0.72);
        }
        g.fill(pass === 'sand' ? 0xf0dca0 : water ? 0x9fd07a : LAND);
        if (pass === 'land' && !water) {
          for (let i = 0; i < 7; i++) {
            const x = p.x + rand(-70, 70);
            const y = p.y + rand(-50, 70);
            g.rect(x - 1.5, y, 3, 9).fill(0x6b4a2a);
            g.circle(x, y - 3, rand(6, 10)).fill(rand() < 0.5 ? 0x3f7d3a : 0x5aa04e);
          }
        }
      }
    }
    return g;
  }

  /** Space: stars, soft nebula clouds, and a planet (or a station's ring) for each place. */
  private drawSpace() {
    const g = new Graphics();
    g.rect(-3000, -3000, MAP_W + 6000, MAP_H + 6000).fill(SPACE);
    const rand = seededRandom(`space:${this.world.id}`);
    for (const [color, n] of [[0x6a3aa8, 5], [0x2a6ab8, 4], [0xb83a8a, 3]] as const) {
      for (let i = 0; i < n; i++) g.ellipse(rand(-100, MAP_W + 100), rand(-60, MAP_H + 60), rand(140, 300), rand(70, 150)).fill({ color, alpha: 0.12 });
    }
    for (let i = 0; i < 260; i++) g.circle(rand(-400, MAP_W + 400), rand(-300, MAP_H + 300), rand(0.6, 2)).fill({ color: 0xffffff, alpha: rand(0.3, 0.9) });
    for (const p of this.world.places) {
      const look = lookOf(p.biome, p.look);
      const color = look?.ground[0] ?? 0x5ea0d8;
      const r = PORTHOLE + 26;
      if (p.biome === 'station') {
        // A station: a wheel of lights round the porthole.
        g.circle(p.x, p.y, r + 6).stroke({ width: 8, color: 0x8a94aa });
        for (let i = 0; i < 12; i++) g.circle(p.x + Math.cos((i / 12) * TAU) * (r + 6), p.y + Math.sin((i / 12) * TAU) * (r + 6), 3).fill(look?.accent ?? 0xffd34a);
      } else if (p.biome === 'space') {
        // Open space: a glowing swirl.
        for (let i = 4; i > 0; i--) g.circle(p.x, p.y, r + i * 10).fill({ color: look?.accent ?? 0xff7ad9, alpha: 0.06 });
      } else {
        // A planet or a moon, lit from the top left, with a ring for some.
        const ring = seededRandom(`ring:${p.id}`)() < 0.4 ? { width: 5, color: look?.accent ?? 0xffffff, alpha: 0.7 } : null;
        if (ring) ringHalf(g, p.x, p.y + 6, r * 1.6, r * 0.32, false, ring);
        g.circle(p.x, p.y, r).fill(color);
        g.circle(p.x + r * 0.25, p.y + r * 0.25, r * 0.85).fill({ color: 0x000000, alpha: 0.18 });
        if (ring) ringHalf(g, p.x, p.y + 6, r * 1.6, r * 0.32, true, ring);
      }
    }
    return g;
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
    const bg = new Sprite(biomeBackdrop(place.biome, h, (shape.waterTop / WORLD_H) * h, (shape.floorAt(WORLD_W / 2) / WORLD_H) * h, place.look));
    bg.anchor.set(0.5);
    bg.width = R * 2;
    bg.height = R * 2;
    const inside = new Container();
    const sand = new Graphics().ellipse(0, R * 0.95, R * 1.3, R * 0.35).fill(sandColor(place.biome, place.look));
    const mask = new Graphics().circle(0, 0, R).fill(0xffffff);
    const contents = new Container();
    contents.addChild(bg, sand, inside);
    contents.mask = mask;
    const glass = new Graphics().ellipse(-R * 0.35, -R * 0.45, R * 0.35, R * 0.16).fill({ color: 0xffffff, alpha: 0.25 });
    // Brass portholes on Earth's seas; silver ones out in space.
    const [metal, rivet] = this.world.mapStyle === 'space' ? [0xb8c4d8, 0x4a5468] : [0xc9a227, 0x7a5a10];
    const ring = new Graphics().circle(0, 0, R + 4).stroke({ width: 10, color: metal }).circle(0, 0, R + 9).stroke({ width: 2, color: rivet });
    for (let i = 0; i < 8; i++) ring.circle(Math.cos((i / 8) * TAU) * (R + 4), Math.sin((i / 8) * TAU) * (R + 4), 2.6).fill(rivet);
    const banner = new Graphics();
    const name = new Text({ text: place.name, style: { fontFamily: FONT, fontSize: 17, fontWeight: 'bold', fill: 0x3b2a10 }, anchor: 0.5 });
    const count = new Text({ text: '', style: { fontFamily: FONT, fontSize: 13, fill: 0x5b4a2a }, anchor: 0.5 });
    const w = name.width + 30;
    banner.roundRect(-w / 2, R + 10, w, 40, 10).fill(0xfff4d6).stroke({ width: 2, color: metal });
    name.position.set(0, R + 23);
    count.position.set(0, R + 40);
    const glow = new Graphics().circle(0, 0, R + 18).stroke({ width: 12, color: 0xffd34a, alpha: 0.9 }).circle(0, 0, R + 28).stroke({ width: 8, color: 0xffd34a, alpha: 0.35 });
    glow.visible = false;
    view.addChild(glow, contents, mask, glass, ring, banner, name, count);
    view.eventMode = 'static';
    view.cursor = 'pointer';
    view.on('pointertap', () => this.onPick(place.id));
    this.portholes.push({ place, view, inside, count, swimmers: [], shown: '', glow });
    return view;
  }

  /** A little note over a place, for a few seconds. */
  private say(place: Place, text: string) {
    this.note.text = text;
    this.note.position.set(place.x, place.y - LOCKED - 34);
    this.noteFor = 3;
  }

  /** The place whose porthole is at a point (in map units), if any. */
  placeAt(x: number, y: number) {
    return this.portholes.find((p) => Math.hypot(p.view.x - x, p.view.y - y) < PORTHOLE + 10)?.place.id;
  }

  /** Moves a place's porthole while the world maker drags it (the map round it is redrawn once it's let go). */
  movePlace(id: string, x: number, y: number) {
    this.portholes.find((p) => p.place.id === id)?.view.position.set(x, y);
  }

  /** The place picker: a glow round the chosen places, and the ones that don't suit the drawing faded. */
  setMarks(marks: Record<string, Mark>) {
    for (const p of this.portholes) {
      const mark = marks[p.place.id] ?? 'free';
      p.glow.visible = mark === 'chosen';
      p.view.alpha = mark === 'unsuited' ? 0.35 : 1;
      p.view.cursor = mark === 'unsuited' ? 'not-allowed' : 'pointer';
    }
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
        const swimmer: Swimmer = {
          species: id,
          stand: look.stand,
          sprite,
          release: look.release,
          phase: i * 1.7,
          speed: (0.25 + (i % 3) * 0.08) * (look.stand === 'walks' ? 0.6 : 1),
          depth: -0.45 + i * 0.28,
        };
        // On the bottom: standing on the sand, at the bottom of the picture.
        if (look.stand !== 'swims') sprite.anchor.set(0.5, 1);
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
        // Back and forth across the porthole, turning at each end (on the sand for walkers; plants stay put).
        const t = s.stand === 'still' ? s.phase : time * s.speed + s.phase;
        s.sprite.x = Math.sin(t) * PORTHOLE * 0.55;
        s.sprite.y = s.stand === 'swims' ? s.depth * PORTHOLE + Math.sin(t * 2.3) * 4 : PORTHOLE * (0.7 + s.depth * 0.06);
        s.sprite.scale.x = Math.abs(s.sprite.scale.x) * (Math.cos(t) >= 0 ? 1 : -1);
      }
    }
    for (const c of this.clouds) {
      c.x += c.speed * dt;
      if (c.x > MAP_W + 200) c.x = -200;
      c.node.position.set(c.x, c.y);
    }
    if (this.world.mapStyle === 'space') {
      // A few stars twinkle.
      const t = this.twinkles.clear();
      for (let i = 0; i < 40; i++) {
        const rand = seededRandom(`twinkle${i}`);
        const x = rand(-100, MAP_W + 100);
        const y = rand(-60, MAP_H + 60);
        const a = 0.5 + 0.5 * Math.sin(time * rand(1, 3) + i);
        t.circle(x, y, 1.6 + a).fill({ color: 0xffffff, alpha: a * 0.9 });
      }
    } else {
      const g = this.waves.clear();
      const islands = this.world.mapStyle === 'islands';
      for (let i = 0; i < (islands ? 30 : 18); i++) {
        const rand = seededRandom(`wave${i}`);
        const x = (islands ? rand(-50, MAP_W + 50) : rand(640, MAP_W + 100)) + Math.sin(time * 0.4 + i) * 8;
        const y = islands ? rand(-20, MAP_H + 20) : rand(200, MAP_H + 60);
        // Only out at sea.
        if (islands ? this.world.places.some((p) => Math.hypot(x - p.x, (y - p.y - 24) / 0.72) < 120) : x < 620 + (y - 160) * 0.25 + 60) continue;
        g.moveTo(x - 10, y).quadraticCurveTo(x - 5, y - 5, x, y).quadraticCurveTo(x + 5, y - 5, x + 10, y).stroke({ width: 2, color: 0xffffff, alpha: 0.45 });
      }
    }
    this.noteFor = Math.max(0, this.noteFor - dt);
    this.note.alpha = Math.min(1, this.noteFor);
  }
}
