import { Container, Graphics } from 'pixi.js';
import { TAU, type World } from './world.ts';

/**
 * Rare happenings in the tank: a whale passing far behind the glass, a diver swimming by...
 *
 * Events come in packs, so themed sets can be swapped in and out (say, a space pack when someone's into
 * space). Adding one is a function that builds a RunningEvent; add it to a pack in EVENT_PACKS, and pick
 * packs with `/tank/?events=ocean,spooky`. Try one straight away with `/tank/?event=whale`, or press V on
 * the tank for a random one.
 */
export interface RunningEvent {
  /** Returns false once the event is over. */
  update(dt: number, world: World): boolean;
  destroy(): void;
}

export interface EventLayers {
  /** Far away: behind every creature, in front of the water. */
  back: Container;
  /** Up close: in front of the creatures. */
  front: Container;
}

export interface TankEvent {
  name: string;
  /** How often it's picked compared with others in play (1 = normal). */
  weight: number;
  start(world: World, layers: EventLayers): RunningEvent;
}

/** Moves a drawing across the tank from one side to the other over `seconds`, with a gentle bob. */
function crossing(node: Container, world: World, seconds: number, y: number, bob: number) {
  const dir = Math.random() < 0.5 ? 1 : -1;
  const margin = node.width * 0.6 + 40;
  let t = 0;
  node.scale.x *= dir;
  return (dt: number) => {
    t += dt / seconds;
    const x = dir > 0 ? -margin + (world.width + margin * 2) * t : world.width + margin - (world.width + margin * 2) * t;
    node.position.set(x, y + Math.sin(t * TAU * 2) * bob);
    return t < 1;
  };
}

const whale: TankEvent = {
  name: 'whale',
  weight: 1,
  start(world, layers) {
    // A huge, dim silhouette far beyond the back wall.
    const node = new Container();
    const s = world.width * 0.5;
    const body = new Graphics()
      .ellipse(0, 0, s * 0.5, s * 0.14)
      .fill(0x0b2f4a)
      .poly([s * 0.1, s * 0.08, -s * 0.02, s * 0.2, -s * 0.12, s * 0.09])
      .fill(0x0b2f4a);
    const tail = new Graphics().poly([0, 0, -s * 0.2, -s * 0.12, -s * 0.15, 0, -s * 0.2, s * 0.12]).fill(0x0b2f4a);
    tail.position.set(-s * 0.46, 0);
    node.addChild(tail, body);
    node.alpha = 0.32;
    layers.back.addChild(node);
    const move = crossing(node, world, 45, world.height * 0.32, world.height * 0.02);
    let time = 0;
    return {
      update(dt) {
        time += dt;
        tail.scale.y = Math.cos(time * 0.9);
        return move(dt);
      },
      destroy: () => node.destroy({ children: true }),
    };
  },
};

const diver: TankEvent = {
  name: 'diver',
  weight: 1,
  start(world, layers) {
    const node = new Container();
    const s = world.height * 0.2;
    const color = 0x0d3550;
    const legs = [new Graphics(), new Graphics()];
    for (const leg of legs) {
      leg.roundRect(-s * 0.45, -s * 0.03, s * 0.45, s * 0.06, s * 0.03).fill(color).poly([-s * 0.45, -s * 0.05, -s * 0.62, -s * 0.1, -s * 0.62, s * 0.08, -s * 0.45, s * 0.05]).fill(color);
      leg.position.set(-s * 0.3, 0);
    }
    const body = new Graphics()
      .roundRect(-s * 0.32, -s * 0.07, s * 0.55, s * 0.14, s * 0.07)
      .fill(color)
      .roundRect(-s * 0.2, -s * 0.15, s * 0.32, s * 0.09, s * 0.04)
      .fill(0x174866)
      .circle(s * 0.3, -s * 0.02, s * 0.09)
      .fill(color)
      .roundRect(s * 0.32, -s * 0.07, s * 0.07, s * 0.06, s * 0.02)
      .fill(0x6fa7c4);
    node.addChild(...legs, body);
    node.alpha = 0.5;
    layers.back.addChild(node);
    const move = crossing(node, world, 30, world.height * (0.3 + Math.random() * 0.25), world.height * 0.03);
    let time = 0;
    let bubbleIn = 1;
    return {
      update(dt) {
        time += dt;
        legs[0].rotation = Math.sin(time * 4) * 0.25;
        legs[1].rotation = -Math.sin(time * 4) * 0.25;
        bubbleIn -= dt;
        if (bubbleIn <= 0) {
          bubbleIn = 2.5 + Math.random();
          const p = node.toGlobal({ x: s * 0.32, y: -s * 0.1 });
          const at = world.scene.back.toLocal(p);
          for (let i = 0; i < 5; i++) world.scene.bubble(at.x + (Math.random() - 0.5) * 8, at.y - i * 6, 2 + Math.random() * 3);
        }
        return move(dt);
      },
      destroy: () => node.destroy({ children: true }),
    };
  },
};

const ghost: TankEvent = {
  name: 'ghost',
  weight: 1.5,
  start(world, layers) {
    // A friendly little ghost rises from the sand, drifts about, and fades away.
    const node = new Container();
    const s = world.height * 0.09;
    const g = new Graphics();
    const draw = (t: number) => {
      const pts: number[] = [];
      pts.push(-s * 0.5, 0);
      for (let i = 0; i <= 8; i++) {
        const x = -s * 0.5 + (s * i) / 8;
        pts.push(x, s * 0.6 + Math.sin(t * 5 + i * 1.6) * s * 0.06 + (i % 2 ? -s * 0.08 : 0));
      }
      pts.push(s * 0.5, 0);
      g.clear()
        .arc(0, 0, s * 0.5, Math.PI, 0)
        .poly(pts)
        .fill({ color: 0xffffff, alpha: 0.75 })
        .ellipse(-s * 0.17, -s * 0.08, s * 0.07, s * 0.1)
        .fill(0x1b1b2a)
        .ellipse(s * 0.17, -s * 0.08, s * 0.07, s * 0.1)
        .fill(0x1b1b2a)
        .ellipse(0, s * 0.12, s * 0.08, s * 0.06)
        .fill(0x1b1b2a);
    };
    node.addChild(g);
    layers.front.addChild(node);
    const x0 = world.width * (0.2 + Math.random() * 0.6);
    let time = 0;
    const life = 22;
    return {
      update(dt) {
        time += dt;
        draw(time);
        const t = time / life;
        node.position.set(x0 + Math.sin(time * 0.5) * world.width * 0.12, world.floorY - t * world.height * 0.6 + Math.sin(time * 1.7) * s * 0.2);
        node.alpha = Math.min(1, time / 2, (life - time) / 3) * 0.85;
        return time < life;
      },
      destroy: () => node.destroy({ children: true }),
    };
  },
};

export const EVENT_PACKS: Record<string, TankEvent[]> = {
  ocean: [whale, diver],
  spooky: [ghost],
};

/** Runs the packs in play, one event at a time, every several minutes. */
export class Events {
  private running: RunningEvent | null = null;
  private nextAt: number;

  constructor(
    private layers: EventLayers,
    private packs: string[],
    firstIn = 360 + Math.random() * 360,
  ) {
    this.nextAt = firstIn;
  }

  private get pool() {
    return this.packs.flatMap((p) => EVENT_PACKS[p] ?? []);
  }

  /** Starts an event now: a named one, or a random one from the packs in play. */
  trigger(world: World, name?: string) {
    const all = name ? Object.values(EVENT_PACKS).flat().filter((e) => e.name === name) : this.pool;
    const total = all.reduce((s, e) => s + e.weight, 0);
    let roll = Math.random() * total;
    const event = all.find((e) => (roll -= e.weight) <= 0) ?? all[0];
    if (!event) return;
    this.running?.destroy();
    this.running = event.start(world, this.layers);
  }

  update(dt: number, world: World) {
    if (this.running && !this.running.update(dt, world)) {
      this.running.destroy();
      this.running = null;
      this.nextAt = world.time + 360 + Math.random() * 480;
    }
    if (!this.running && world.time > this.nextAt) this.trigger(world);
  }
}
