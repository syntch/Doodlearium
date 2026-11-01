import { Container, Graphics } from 'pixi.js';
import type { Visit } from '../../shared/sim/protocol.ts';
import { ALL_VISITORS } from '../../shared/sim/visitors.ts';
import { TAU, seededRandom, type World } from './world.ts';

/**
 * Rare visitors in the tank: a whale passing far behind the glass, a diver swimming by... The server
 * decides who comes and when (shared/sim/visitors.ts has the packs); every screen draws the visit from the
 * same seed and start time, so it's in the same place on all of them.
 *
 * Adding one: a TankEvent here and its entry in VISITOR_PACKS. Try one from the ⚙️ menu, or press V.
 */
export interface RunningEvent {
  /** t is seconds since the visit began; returns false once it's over. */
  update(dt: number, world: World, t: number): boolean;
  destroy(): void;
}

type Rand = (min?: number, max?: number) => number;

export interface EventLayers {
  /** Far away: behind every creature, in front of the water. */
  back: Container;
  /** Up close: in front of the creatures. */
  front: Container;
}

export interface TankEvent {
  name: string;
  /** rand is seeded by the visit, so every screen makes the same choices. */
  start(world: World, layers: EventLayers, rand: Rand, seconds: number): RunningEvent;
}

/** Moves a drawing across the tank from one side to the other over `seconds`, with a gentle bob. */
function crossing(node: Container, world: World, seconds: number, y: number, bob: number, rand: Rand) {
  const dir = rand() < 0.5 ? 1 : -1;
  const margin = node.width * 0.6 + 40;
  node.scale.x *= dir;
  return (elapsed: number) => {
    const t = elapsed / seconds;
    const x = dir > 0 ? -margin + (world.width + margin * 2) * t : world.width + margin - (world.width + margin * 2) * t;
    node.position.set(x, y + Math.sin(t * TAU * 2) * bob);
    return t < 1;
  };
}

const whale: TankEvent = {
  name: 'whale',
  start(world, layers, rand, seconds) {
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
    const move = crossing(node, world, seconds, world.height * 0.32, world.height * 0.02, rand);
    return {
      update(_dt, _world, t) {
        tail.scale.y = Math.cos(t * 0.9);
        return move(t);
      },
      destroy: () => node.destroy({ children: true }),
    };
  },
};

const diver: TankEvent = {
  name: 'diver',
  start(world, layers, rand, seconds) {
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
    const move = crossing(node, world, seconds, world.height * rand(0.3, 0.55), world.height * 0.03, rand);
    let bubbleIn = 1;
    return {
      update(dt, _world, t) {
        legs[0].rotation = Math.sin(t * 4) * 0.25;
        legs[1].rotation = -Math.sin(t * 4) * 0.25;
        bubbleIn -= dt;
        if (bubbleIn <= 0) {
          bubbleIn = 2.5 + Math.random();
          const p = node.toGlobal({ x: s * 0.32, y: -s * 0.1 });
          const at = world.scene.back.toLocal(p);
          for (let i = 0; i < 5; i++) world.scene.bubble(at.x + (Math.random() - 0.5) * 8, at.y - i * 6, 2 + Math.random() * 3);
        }
        return move(t);
      },
      destroy: () => node.destroy({ children: true }),
    };
  },
};

const ghost: TankEvent = {
  name: 'ghost',
  start(world, layers, rand, life) {
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
    const x0 = world.width * rand(0.2, 0.8);
    return {
      update(_dt, _world, time) {
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

const EVENTS: Record<string, TankEvent> = { whale, diver, ghost };

/** Shows the visit the simulation says is happening (if any), from where it's got to. */
export class Events {
  private running: RunningEvent | null = null;
  private seed = -1;
  private startedAt = 0;

  constructor(private layers: EventLayers) {}

  update(dt: number, world: World, visit: Visit | null) {
    if ((visit?.seed ?? -1) !== this.seed) {
      this.running?.destroy();
      this.running = null;
      this.seed = visit?.seed ?? -1;
      const event = visit && EVENTS[visit.name];
      const info = visit && ALL_VISITORS.find((v) => v.name === visit.name);
      if (event && info) {
        this.startedAt = visit.startedAt;
        this.running = event.start(world, this.layers, seededRandom(String(visit.seed)), info.seconds);
      }
    }
    if (this.running && !this.running.update(dt, world, Math.max(0, world.time - this.startedAt))) {
      this.running.destroy();
      this.running = null;
    }
  }
}
