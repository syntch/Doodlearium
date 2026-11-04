import { Container, Graphics, Text } from 'pixi.js';
import type { Show } from '../../shared/sim/protocol.ts';
import { ARRIVE_SECONDS, SHOWS, showSeconds } from '../../shared/sim/explorers.ts';
import { isSpace } from '../../shared/world/biomes.ts';
import type { EventLayers } from './events.ts';
import type { Sounds } from './sounds.ts';
import { TAU, clamp, lerp, sandY, seededRandom, type Creature, type World } from './world.ts';

/**
 * An explorer's arrival and show (see shared/sim/explorers.ts). It's dropped off from above (a balloon on
 * land, a big bubble in the water, a flying saucer out in space), then puts on its show: a big hello, a
 * parade, a dance party or a treasure hunt. The server says what and when; every screen draws it from the
 * same seed and start time. It runs after the creatures have drawn themselves, so it can carry the explorer,
 * and set everyone dancing, on top of where the simulation has them.
 */

const ease = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};
const emoji = (text: string, size: number) => new Text({ text, style: { fontSize: size }, anchor: 0.5 });
const CONFETTI = [0xff5d73, 0xffd23f, 0x4ecdc4, 0x7b6cf6, 0x6bd16b, 0xff9f45];
const LIGHTS = [0xff4fa3, 0x4fc3ff, 0xffe14f, 0x7dff6a];

interface Bit {
  node: Container;
  vx: number;
  vy: number;
  spin: number;
  life: number;
  age: number;
  /** Falls (confetti, coins) or floats up (notes). */
  gravity: number;
}

type Vehicle = 'balloon' | 'bubble' | 'saucer';

interface Running {
  show: Show;
  rand: (min?: number, max?: number) => number;
  root: Container;
  back: Container;
  vehicle: Container;
  kind: Vehicle;
  /** Where the explorer hangs from the vehicle, and how big the vehicle is. */
  carry: number;
  size: number;
  side: number;
  dropped: { x: number; y: number } | null;
  popped: boolean;
  beam: Graphics;
  banner: Text | null;
  bits: Bit[];
  emitIn: number;
  beat: number;
  /** The wave's hellos from the locals; the treasure chest; the disco ball and its lights. */
  hellos: { c: Creature; hand: Text; from: number }[];
  hand: Text | null;
  chest: { node: Container; lid: Graphics; x: number; y: number } | null;
  drops: number;
  ball: Graphics | null;
  lights: Graphics | null;
  dim: Graphics | null;
  /** Each dancer's own step, so they don't all bob as one. */
  steps: Map<Creature, number>;
  /** The conga: who's in the line (the explorer first), and where along its winding path it started. */
  line: Creature[] | null;
  s0: number;
}

export class Shows {
  private run: Running | null = null;

  constructor(
    private layers: EventLayers,
    private sounds: Sounds,
  ) {}

  /**
   * explorer: its creature, once it's on screen (after it has drawn itself this frame); others: everyone
   * else here who moves.
   */
  update(dt: number, world: World, show: Show | null | undefined, explorer: Creature | undefined, others: Creature[], name: string) {
    if ((show?.seed ?? -1) !== (this.run?.show.seed ?? -1)) {
      this.stop();
      if (show) this.run = this.begin(world, show);
    }
    const run = this.run;
    if (!run) return;
    const t = world.time - run.show.startedAt;
    if (t > showSeconds(run.show.kind) + 1) {
      this.stop();
      return;
    }
    this.arrive(run, world, t, explorer);
    const u = t - ARRIVE_SECONDS;
    if (u >= 0) {
      this.banner(run, world, u, name);
      if (run.show.kind === 'wave') this.wave(run, world, u, explorer, others);
      else if (run.show.kind === 'parade') this.parade(run, world, u, dt, explorer, others);
      else if (run.show.kind === 'party') this.party(run, world, u, dt, explorer, others);
      else if (run.show.kind === 'conga') this.conga(run, world, u, explorer, others);
      else this.treasure(run, world, u, explorer);
    }
    this.moveBits(run, dt);
  }

  /** The explorer's hello, once it's down: true just the once. */
  landed(world: World) {
    return Boolean(this.run && world.time - this.run.show.startedAt >= ARRIVE_SECONDS - 0.5);
  }

  get showing() {
    return this.run?.show ?? null;
  }

  private stop() {
    if (!this.run) return;
    for (const c of this.run.steps.keys()) if (!c.view.destroyed) c.view.skew.set(0, 0);
    this.run.root.destroy({ children: true });
    this.run.back.destroy({ children: true });
    this.run = null;
  }

  private begin(world: World, show: Show): Running {
    const rand = seededRandom(String(show.seed));
    const root = new Container();
    const back = new Container();
    this.layers.front.addChild(root);
    this.layers.back.addChild(back);
    const kind: Vehicle = isSpace(world.biome) ? 'saucer' : world.land ? 'balloon' : 'bubble';
    const size = world.height * (kind === 'bubble' ? 0.16 : 0.11);
    const vehicle = drawVehicle(kind, size, rand);
    const beam = new Graphics();
    root.addChild(beam, vehicle);
    // Joining partway through: it's already down.
    const late = world.time - show.startedAt > ARRIVE_SECONDS;
    vehicle.visible = !late;
    if (!late) this.sounds.whoosh();
    return {
      show, rand, root, back, vehicle, kind, size, side: rand() < 0.5 ? -1 : 1, beam,
      carry: kind === 'saucer' ? size * 0.75 : kind === 'balloon' ? size * 1.55 : 0,
      dropped: late ? { x: 0, y: 0 } : null, popped: late, banner: null, bits: [], emitIn: 0, beat: -1,
      hellos: [], hand: null, chest: null, drops: 0, ball: null, lights: null, dim: null, steps: new Map(),
      line: null, s0: 0,
    };
  }

  // --- the arrival: carried in from above, let down, and off goes the ride ---------------------------

  private arrive(run: Running, world: World, t: number, explorer: Creature | undefined) {
    const { vehicle, size, side, carry } = run;
    if (t > ARRIVE_SECONDS + 3) {
      vehicle.visible = false;
      return;
    }
    const real = explorer ? { x: explorer.view.x, y: explorer.view.y } : { x: world.width / 2, y: world.height * 0.6 };
    const hover = { x: real.x, y: real.y - carry - (run.kind === 'bubble' ? 0 : size * 0.4) };
    const start = { x: real.x + side * world.width * 0.6, y: -size * 2.5 };
    let at: { x: number; y: number };
    if (t < 4) at = { x: lerp(start.x, hover.x, ease(t / 4)), y: lerp(start.y, hover.y - size * 0.6, ease(t / 4)) };
    else if (t < 5.5) at = { x: hover.x, y: lerp(hover.y - size * 0.6, hover.y, ease((t - 4) / 1.5)) };
    else {
      const k = ease((t - 6) / 3);
      at = { x: lerp(hover.x, hover.x - side * world.width * 0.6, k), y: lerp(hover.y, -size * 3, k) };
    }
    vehicle.position.set(at.x, at.y + Math.sin(t * 2.5) * size * 0.04);
    vehicle.rotation = t < 5.5 ? Math.sin(t * 1.7) * 0.06 : 0;
    if (run.kind === 'bubble') {
      // The bubble pops to let it out.
      if (t >= 5.5 && !run.popped) {
        run.popped = true;
        world.scene.bubble(at.x, at.y, size * 0.2);
        for (let i = 0; i < 10; i++) world.scene.bubble(at.x + (Math.random() - 0.5) * size, at.y + (Math.random() - 0.5) * size, 3 + Math.random() * 6);
        this.sounds.plop();
      }
      vehicle.visible = t < 5.5;
    } else vehicle.visible = true;

    run.beam.clear();
    if (run.kind === 'saucer' && t > 3.6 && t < 6.2) {
      const a = Math.min(1, (t - 3.6) * 3, (6.2 - t) * 3) * 0.35;
      run.beam.poly([at.x - size * 0.25, at.y + size * 0.15, at.x + size * 0.25, at.y + size * 0.15, at.x + size * 0.7, real.y + 10, at.x - size * 0.7, real.y + 10]).fill({ color: 0xbff7ff, alpha: a });
    }

    if (!explorer || t > ARRIVE_SECONDS) return;
    const held = { x: at.x, y: at.y + carry + (run.kind === 'bubble' ? explorer.view.y - explorer.labelAnchor().y - 8 : 0) * 0.5 };
    if (t < 5.5) {
      explorer.view.position.set(held.x, held.y);
      explorer.view.alpha = 1;
      run.dropped = { ...held };
    } else if (run.dropped) {
      // Let go: it settles to where it really is.
      const k = ease((t - 5.5) / 1.5);
      explorer.view.position.set(lerp(run.dropped.x, real.x, k), lerp(run.dropped.y, real.y, k));
      explorer.view.alpha = 1;
    }
  }

  private banner(run: Running, world: World, u: number, name: string) {
    const info = SHOWS[run.show.kind];
    if (!run.banner) {
      run.banner = new Text({
        text: `${info.icon} ${name}'s ${info.title}!`,
        style: { fontFamily: 'Trebuchet MS, sans-serif', fontSize: world.height * 0.055, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0x2a1650, width: 7, join: 'round' } },
        anchor: 0.5,
      });
      run.root.addChild(run.banner);
      this.sounds.fanfare();
    }
    run.banner.position.set(world.width / 2, world.height * 0.3 + Math.sin(u * 2) * 4);
    run.banner.alpha = Math.min(1, u * 2, (6 - u) * 1.5);
    run.banner.scale.set(0.8 + 0.2 * ease(u * 2.5));
    run.banner.visible = u < 6;
  }

  // --- 👋 a big hello: it bounces and waves, and the locals wave back --------------------------------

  private wave(run: Running, world: World, u: number, explorer: Creature | undefined, others: Creature[]) {
    const seconds = SHOWS.wave.seconds;
    if (explorer) {
      if (!run.hand) run.root.addChild((run.hand = emoji('👋', world.height * 0.06)));
      const top = explorer.labelAnchor();
      if (u < seconds - 2) explorer.view.y -= Math.abs(Math.sin(u * 5)) * world.height * 0.02 * (u < 6 ? 1 : 0.4);
      run.hand.position.set(top.x + world.height * 0.06, top.y + 10);
      run.hand.rotation = Math.sin(u * 9) * 0.5;
      run.hand.alpha = Math.min(1, u * 2, seconds - u);
    }
    if (!run.hellos.length && others.length) {
      const picked = [...others].sort(() => run.rand() - 0.5).slice(0, 8);
      run.hellos = picked.map((c, i) => {
        const hand = emoji(i % 3 === 2 ? '❤️' : '👋', world.height * 0.035);
        hand.alpha = 0;
        run.root.addChild(hand);
        return { c, hand, from: 1.5 + i * 0.7 };
      });
    }
    for (const h of run.hellos) {
      if (h.c.view.destroyed) {
        h.hand.visible = false;
        continue;
      }
      const v = u - h.from;
      const a = h.c.labelAnchor();
      h.hand.position.set(a.x, a.y - Math.min(1, Math.max(0, v)) * 10);
      h.hand.rotation = Math.sin(u * 8 + h.from) * 0.4;
      h.hand.alpha = v < 0 ? 0 : Math.min(1, v * 3, 3.5 - v) * h.c.view.alpha;
    }
  }

  // --- 🎺 a parade: everyone falls in behind (the server sees to that), with confetti and music --------

  private parade(run: Running, world: World, u: number, dt: number, explorer: Creature | undefined, others: Creature[]) {
    const seconds = SHOWS.parade.seconds;
    const fading = Math.min(1, (seconds - u) / 3);
    run.emitIn -= dt;
    if (run.emitIn <= 0 && u < seconds - 3) {
      run.emitIn = 0.06;
      this.confetti(run, world);
      if (explorer && run.rand() < 0.15) this.note(run, explorer, world);
    }
    const beat = Math.floor(u / 0.3);
    if (beat !== run.beat && u < seconds - 3) {
      run.beat = beat;
      this.sounds.march(beat);
    }
    // Marching: a little bounce in every step.
    const march = (c: Creature, i: number, amount: number) => {
      c.view.y -= Math.abs(Math.sin(u * Math.PI * 3.3 + i)) * amount * fading;
    };
    if (explorer) {
      march(explorer, 0, world.height * 0.02);
      if (!run.hand) run.root.addChild((run.hand = emoji('🎺', world.height * 0.05)));
      const a = explorer.labelAnchor();
      run.hand.position.set(a.x, a.y - 14);
      run.hand.rotation = Math.sin(u * 6) * 0.15;
      run.hand.alpha = fading;
    }
    others.forEach((c, i) => march(c, i * 0.7, world.height * 0.01));
  }

  // --- 🪩 a dance party: a disco ball, coloured lights, and everyone dancing to the beat ----------------

  private party(run: Running, world: World, u: number, dt: number, explorer: Creature | undefined, others: Creature[]) {
    const seconds = SHOWS.party.seconds;
    const on = Math.min(1, u / 1.5, (seconds - u) / 2);
    const r = world.height * 0.055;
    if (!run.ball) {
      run.dim = new Graphics().rect(-50, -50, world.width + 100, world.height + 100).fill(0x0a0420);
      run.back.addChild(run.dim);
      run.lights = new Graphics();
      run.lights.blendMode = 'add';
      run.ball = new Graphics();
      run.root.addChild(run.lights, run.ball);
    }
    run.dim!.alpha = 0.35 * on;
    const bx = world.width / 2;
    const by = lerp(-r * 2, world.height * 0.13, ease(u / 2)) - (u > seconds - 2 ? ease((u - seconds + 2) / 2) * world.height * 0.3 : 0);
    // The ball: a grid of little mirrors that glint as it turns.
    const ball = run.ball;
    ball.clear().moveTo(bx, -10).lineTo(bx, by - r).stroke({ color: 0xcfcfe0, width: 2 }).circle(bx, by, r).fill(0x9aa0b8);
    const turn = u * 1.6;
    for (let row = -3; row <= 3; row++) {
      const lat = (row / 3.5) * (Math.PI / 2);
      const ry = by + Math.sin(lat) * r;
      const width = Math.cos(lat) * r;
      for (let k = 0; k < 10; k++) {
        const lon = ((k / 10) * TAU + turn) % TAU;
        if (Math.cos(lon) < 0) continue;
        const shine = 0.5 + 0.5 * Math.sin(lon * 3 + row + u * 4);
        ball.rect(bx + Math.sin(lon) * width - 3, ry - 3, 6, 6).fill(shine > 0.85 ? 0xffffff : shine > 0.5 ? 0xdde3f5 : 0x7d84a0);
      }
    }
    // Beams sweeping the floor.
    const lights = run.lights!;
    lights.clear();
    LIGHTS.forEach((color, i) => {
      const angle = Math.sin(u * (0.7 + i * 0.23) + i * 1.7) * 0.9;
      const floor = world.height * 0.95;
      const reach = floor - by;
      const x = bx + Math.tan(angle) * reach;
      const spread = reach * 0.12;
      lights.poly([bx - 4, by, bx + 4, by, x + spread, floor, x - spread, floor]).fill({ color, alpha: 0.16 * on });
      lights.ellipse(x, floor - 6, spread * 1.3, spread * 0.25).fill({ color, alpha: 0.25 * on });
    });
    // On the beat: everyone bobs and sways, and the explorer most of all.
    const beat = Math.floor(u / 0.5);
    if (beat !== run.beat && u < seconds - 2) {
      run.beat = beat;
      this.sounds.beat(beat);
      if (explorer && beat % 2 === 0) this.note(run, explorer, world);
    }
    const dance = (c: Creature, amount: number) => {
      let step = run.steps.get(c);
      if (step === undefined) run.steps.set(c, (step = run.rand()));
      const phase = (u * 2 + step * 0.5) * Math.PI;
      c.view.y -= Math.abs(Math.sin(phase)) * amount * on;
      c.view.skew.x = Math.sin(phase) * 0.12 * on;
    };
    others.forEach((c) => dance(c, world.height * 0.012));
    if (explorer) {
      dance(explorer, world.height * 0.03);
      explorer.view.rotation += Math.sin(u * Math.PI) * 0.15 * on;
    }
    for (let i = 0; i < Math.round(dt * 20 * on); i++) if (run.rand() < 0.5) this.confetti(run, world, true);
  }

  // --- 💃 a conga line: the locals fall in behind, single file, winding back and forth across the place ---
  // Cha, cha, cha… kick! Everyone steps on three beats and kicks out on the fourth, to alternate sides.

  private conga(run: Running, world: World, u: number, explorer: Creature | undefined, others: Creature[]) {
    const seconds = SHOWS.conga.seconds;
    const { width: W, height: H } = world;
    // The line goes round an oval: along the front one way, round, and back along the far side. Spaced by
    // distance along it, so nobody bunches up on the turns.
    const loop = congaLoop(W * 0.36, H * 0.12);
    if (!run.line) {
      // Not so many that the head catches up with the tail.
      const pool = [...others].sort(() => run.rand() - 0.5).slice(0, 8);
      run.line = explorer ? [explorer, ...pool] : pool;
      // The head of the line starts where the explorer landed (on the front of the oval).
      const a = Math.acos(clamp(((explorer?.view.x ?? W / 2) - W / 2) / (W * 0.36), -1, 1));
      run.s0 = loop.at(-a);
    }
    const ending = Math.min(1, (seconds - u) / 2.5);
    const head = run.s0 + u * H * 0.16;
    const gap = H * 0.13;
    const beats = u / 0.42;
    const beat = Math.floor(beats);
    if (beat !== run.beat && u < seconds - 2.5) {
      run.beat = beat;
      this.sounds.conga(beat);
      if (explorer && beat % 4 === 3) this.note(run, explorer, world);
    }
    const inBar = beats % 4;
    const kick = inBar >= 3 ? Math.sin((inBar - 3) * Math.PI) : 0;
    const side = Math.floor(beats / 4) % 2 ? 1 : -1;
    const farGround = (x: number) => sandY(world, 1, x) - H * 0.05;
    run.line.forEach((c, i) => {
      if (c.view.destroyed) return;
      // Each one joins just after the one in front, and they all wander off again at the end.
      const k = ease((u - i * 0.25) / 2) * ending;
      if (k <= 0) return;
      // Where it is round the oval: across (cos) and how far back (sin, -1 front .. 1 back).
      const angle = loop.angle(head - i * gap);
      const x = W / 2 + W * 0.36 * Math.cos(angle);
      const back = Math.sin(angle);
      const real = { x: c.view.x, y: c.view.y };
      let y: number;
      if (world.land) {
        // Along the ground; fliers dance along just above it.
        const flying = real.y < farGround(real.x);
        y = sandY(world, 0.3 + 0.2 * back, x) - (flying ? H * 0.08 : 0);
      } else if (real.y > world.floorAt(real.x) - H * 0.06) {
        // Crabs and snails conga along the bottom.
        y = sandY(world, 0.3 + 0.2 * back, x);
      } else {
        const top = Math.max(world.waterTop, H * 0.15);
        y = top + (world.floorAt(x) - top) * (0.5 - 0.15 * back);
      }
      const hop = Math.abs(Math.sin(beats * Math.PI)) * H * 0.008 * (1 - kick) + kick * H * (i === 0 ? 0.03 : 0.018);
      c.view.position.set(lerp(real.x, x, k), lerp(real.y, y, k) - hop * k);
      c.view.rotation += side * kick * 0.3 * k;
      // Facing the way the line is going.
      if (k > 0.5) c.view.scale.x = Math.abs(c.view.scale.x) * (Math.sin(angle) >= 0 ? 1 : -1);
    });
    if (u < seconds - 3 && run.rand() < 0.15) this.confetti(run, world);
  }

  // --- 💰 a treasure hunt: it digs, up comes a chest, and out spill snacks (the server drops them) --------

  private treasure(run: Running, world: World, u: number, explorer: Creature | undefined) {
    const seconds = SHOWS.treasure.seconds;
    if (!run.chest && explorer) {
      const x = clamp(explorer.view.x + world.height * 0.12, 80, world.width - 80);
      const y = sandY(world, 0.12, x);
      const node = new Container();
      const s = world.height * 0.07;
      const box = new Graphics()
        .roundRect(-s, -s * 0.9, s * 2, s * 0.9, s * 0.12)
        .fill(0x8a5a2b)
        .stroke({ color: 0x4b2c12, width: 3 })
        .rect(-s, -s * 0.55, s * 2, s * 0.14)
        .fill(0xe0b23a)
        .rect(-s * 0.12, -s * 0.7, s * 0.24, s * 0.32)
        .fill(0xffd75e);
      const lid = new Graphics()
        .roundRect(-s, -s * 0.55, s * 2, s * 0.55, s * 0.25)
        .fill(0x9c6834)
        .stroke({ color: 0x4b2c12, width: 3 })
        .rect(-s, -s * 0.3, s * 2, s * 0.12)
        .fill(0xe0b23a);
      lid.pivot.set(-s, 0);
      lid.position.set(-s, -s * 0.9);
      const mark = new Graphics()
        .moveTo(-s * 0.6, -s * 0.3)
        .lineTo(s * 0.6, s * 0.3)
        .moveTo(s * 0.6, -s * 0.3)
        .lineTo(-s * 0.6, s * 0.3)
        .stroke({ color: 0xd62828, width: 7, cap: 'round' });
      mark.label = 'mark';
      node.addChild(mark, box, lid);
      node.position.set(x, y);
      run.root.addChild(node);
      run.chest = { node, lid, x, y };
    }
    const chest = run.chest;
    if (!chest) return;
    const [mark, box, lid] = chest.node.children;
    // Digging, then up it comes.
    const rise = ease((u - 3) / 0.8);
    mark.alpha = 1 - rise;
    box.visible = lid.visible = u >= 3;
    box.scale.set(1, rise);
    lid.scale.set(1, rise);
    chest.node.alpha = Math.min(1, (seconds - u) / 2);
    if (explorer && u < 3) {
      explorer.view.rotation += Math.sin(u * 30) * 0.12;
      if (run.rand() < 0.5) this.dirt(run, chest.x - world.height * 0.06, chest.y, world);
    }
    lid.rotation = -ease((u - 3.6) / 0.6) * 1.9;
    if (u >= 3.6 && run.drops === 0) {
      run.drops = 1;
      this.sounds.chime();
    }
    // A burst of gold with each spill of snacks.
    const times = [4, 7, 10, 13];
    while (run.drops <= times.length && u >= times[run.drops - 1]) {
      run.drops++;
      this.sounds.coins();
      for (let i = 0; i < 16; i++) this.coin(run, chest.x, chest.y - world.height * 0.06, world);
    }
  }

  // --- bits that fly about ----------------------------------------------------------------------------

  private confetti(run: Running, world: World, glowing = false) {
    const g = new Graphics().rect(-5, -3, 10, 6).fill(CONFETTI[Math.floor(run.rand() * CONFETTI.length)]);
    if (glowing) g.alpha = 0.8;
    g.position.set(run.rand() * world.width, -10);
    run.root.addChild(g);
    run.bits.push({ node: g, vx: run.rand(-30, 30), vy: run.rand(60, 140), spin: run.rand(-6, 6), life: 7, age: 0, gravity: 10 });
  }

  private note(run: Running, explorer: Creature, world: World) {
    const n = emoji(run.rand() < 0.5 ? '🎵' : '🎶', world.height * 0.035);
    const a = explorer.labelAnchor();
    n.position.set(a.x + run.rand(-30, 30), a.y);
    run.root.addChild(n);
    run.bits.push({ node: n, vx: run.rand(-25, 25), vy: -60, spin: run.rand(-1, 1), life: 2.5, age: 0, gravity: 0 });
  }

  private coin(run: Running, x: number, y: number, world: World) {
    const c = run.rand() < 0.3 ? emoji('✨', world.height * 0.03) : new Graphics().circle(0, 0, 7).fill(0xffd23f).stroke({ color: 0xb8860b, width: 2 });
    c.position.set(x + run.rand(-20, 20), y);
    run.root.addChild(c);
    run.bits.push({ node: c, vx: run.rand(-160, 160), vy: run.rand(-420, -250), spin: run.rand(-8, 8), life: 1.6, age: 0, gravity: 600 });
  }

  private dirt(run: Running, x: number, y: number, world: World) {
    const d = new Graphics().circle(0, 0, run.rand(3, 6)).fill(world.land ? 0x7a5230 : 0xd9c08a);
    d.position.set(x, y - 4);
    run.root.addChild(d);
    run.bits.push({ node: d, vx: run.rand(-120, 40), vy: run.rand(-220, -120), spin: 0, life: 0.8, age: 0, gravity: 600 });
  }

  private moveBits(run: Running, dt: number) {
    for (let i = run.bits.length - 1; i >= 0; i--) {
      const b = run.bits[i];
      b.age += dt;
      b.vy += b.gravity * dt;
      b.node.x += (b.vx + Math.sin(b.age * 3 + i) * (b.gravity === 10 ? 30 : 0)) * dt;
      b.node.y += b.vy * dt;
      b.node.rotation += b.spin * dt;
      b.node.alpha = Math.min(b.node.alpha, (b.life - b.age) * 2);
      if (b.age > b.life) {
        b.node.destroy();
        run.bits.splice(i, 1);
      }
    }
  }
}

/**
 * An oval rx across and ry deep, measured by distance round it: at(angle) is how far round an angle is,
 * angle(distance) the way back (any distance, going round and round). x = cos, and sin is -1 at the front;
 * going round, the angle gets smaller, so the front row heads left and the back row right.
 */
function congaLoop(rx: number, ry: number) {
  const N = 240;
  const lengths = [0];
  for (let i = 1; i <= N; i++) {
    const a0 = ((i - 1) / N) * TAU;
    const a1 = (i / N) * TAU;
    lengths.push(lengths[i - 1] + Math.hypot(rx * (Math.cos(a1) - Math.cos(a0)), ry * (Math.sin(a1) - Math.sin(a0))));
  }
  const total = lengths[N];
  return {
    at(angle: number) {
      const a = (((-angle % TAU) + TAU) % TAU) / TAU;
      const i = Math.floor(a * N);
      return lerp(lengths[i], lengths[i + 1] ?? total, a * N - i);
    },
    angle(distance: number) {
      const d = ((distance % total) + total) % total;
      let lo = 0;
      let hi = N;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (lengths[mid] <= d) lo = mid;
        else hi = mid;
      }
      const f = (d - lengths[lo]) / (lengths[lo + 1] - lengths[lo] || 1);
      return -((lo + f) / N) * TAU;
    },
  };
}

/** The ride in: a striped balloon with a basket, a big shiny bubble, or a flying saucer. */
function drawVehicle(kind: Vehicle, s: number, rand: (min?: number, max?: number) => number): Container {
  const node = new Container();
  const g = new Graphics();
  if (kind === 'balloon') {
    const colors = [[0xff5d73, 0xffd23f], [0x4ecdc4, 0xffffff], [0x7b6cf6, 0xffb3e6]][Math.floor(rand() * 3)];
    g.ellipse(0, 0, s * 0.62, s * 0.72).fill(colors[0]);
    for (const k of [-0.36, 0, 0.36]) g.ellipse(s * k, 0, s * 0.09, s * 0.7).fill(colors[1]);
    g.moveTo(-s * 0.5, s * 0.45).lineTo(-s * 0.2, s * 1.2).moveTo(s * 0.5, s * 0.45).lineTo(s * 0.2, s * 1.2).stroke({ color: 0x5a4632, width: 2 });
    g.roundRect(-s * 0.24, s * 1.15, s * 0.48, s * 0.3, s * 0.05).fill(0xa8743f).stroke({ color: 0x5a3a1c, width: 2 });
    g.ellipse(-s * 0.22, -s * 0.3, s * 0.12, s * 0.2).fill({ color: 0xffffff, alpha: 0.35 });
  } else if (kind === 'bubble') {
    g.circle(0, 0, s).fill({ color: 0xcff6ff, alpha: 0.18 }).stroke({ color: 0xe8fbff, width: 3, alpha: 0.8 });
    g.ellipse(-s * 0.4, -s * 0.45, s * 0.22, s * 0.12).fill({ color: 0xffffff, alpha: 0.7 });
    g.circle(s * 0.5, s * 0.35, s * 0.06).fill({ color: 0xffffff, alpha: 0.5 });
  } else {
    g.ellipse(0, -s * 0.12, s * 0.36, s * 0.3).fill({ color: 0xaef3ff, alpha: 0.75 });
    g.ellipse(0, 0, s * 0.85, s * 0.24).fill(0x9aa3b5).stroke({ color: 0x5b6375, width: 2 });
    g.ellipse(0, s * 0.08, s * 0.5, s * 0.1).fill(0x6f7789);
    for (let i = 0; i < 6; i++) g.circle(-s * 0.6 + (i * s * 1.2) / 5, s * 0.02, s * 0.05).fill([0xffe14f, 0xff4fa3, 0x4fc3ff][i % 3]);
  }
  node.addChild(g);
  return node;
}
