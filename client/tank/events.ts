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

const ducks: TankEvent = {
  name: 'ducks',
  start(world, layers, rand, seconds) {
    // A mother duck and her ducklings paddle across the top of the pond, feet kicking away under the water.
    const node = new Container();
    const s = world.height * 0.075;
    const parts: { duck: Container; head: Container; feet: Graphics[]; r: number }[] = [];
    [1, 0.55, 0.5, 0.45].forEach((size, i) => {
      const duck = new Container();
      const r = s * size;
      const [coat, wingColor] = i ? [0xf2cf48, 0xd9ad2b] : [0x9a7650, 0x6e5236];
      // Feet first, so the body covers the tops of the legs.
      const feet: Graphics[] = [];
      for (const k of [0, 1]) {
        const foot = new Graphics()
          .moveTo(0, 0).lineTo(0, r * 0.45).stroke({ width: Math.max(2, r * 0.08), color: 0xe08a1e, cap: 'round' })
          .poly([-r * 0.05, r * 0.42, r * 0.3, r * 0.47, -r * 0.05, r * 0.56]).fill(0xf29a2e);
        foot.position.set(-r * 0.05 + k * r * 0.15, r * 0.2);
        feet.push(foot);
        duck.addChild(foot);
      }
      const body = new Graphics()
        // The tail, perked up at the back.
        .poly([-r * 0.75, -r * 0.2, -r * 1.15, -r * 0.55, -r * 0.95, -r * 0.05]).fill(coat)
        .ellipse(0, -r * 0.1, r * 0.9, r * 0.42).fill(coat)
        // A folded wing.
        .ellipse(-r * 0.15, -r * 0.2, r * 0.5, r * 0.22).fill(wingColor)
        .poly([-r * 0.55, -r * 0.25, -r * 0.85, -r * 0.35, -r * 0.5, -r * 0.08]).fill(wingColor)
        // The neck.
        .roundRect(r * 0.42, -r * 0.85, r * 0.3, r * 0.7, r * 0.15).fill(coat);
      // Under the waterline the body looks a little blue.
      const wet = new Graphics().ellipse(0, -r * 0.1, r * 0.9, r * 0.42).fill({ color: 0x3f7f86, alpha: 0.35 });
      const mask = new Graphics().rect(-r * 1.2, 0, r * 2.4, r).fill(0xffffff);
      wet.mask = mask;
      const head = new Container();
      head.addChild(
        new Graphics()
          .circle(0, 0, r * 0.3).fill(i ? coat : 0x2f6b3a)
          .poly([r * 0.2, -r * 0.06, r * 0.55, r * 0.02, r * 0.5, r * 0.08, r * 0.2, r * 0.1]).fill(0xf29a2e)
          .circle(r * 0.1, -r * 0.08, Math.max(1.5, r * 0.06)).fill(0x1b1b1b)
          .circle(r * 0.12, -r * 0.1, Math.max(0.6, r * 0.02)).fill(0xffffff),
      );
      head.position.set(r * 0.6, -r * 0.9);
      if (!i) body.ellipse(r * 0.57, -r * 0.6, r * 0.17, r * 0.05).fill(0xffffff); // her white collar
      duck.addChild(body, wet, mask, head);
      duck.position.set(-i * s * 1.6 - (i ? s * 0.5 : 0), 0);
      node.addChild(duck);
      parts.push({ duck, head, feet, r });
    });
    layers.front.addChild(node);
    const move = crossing(node, world, seconds, world.waterTop, 1.5, rand);
    return {
      update(_dt, _world, t) {
        parts.forEach(({ duck, head, feet, r }, i) => {
          // Ducklings paddle faster, and everyone bobs and nods.
          const pace = i ? 12 : 8;
          feet.forEach((f, k) => (f.rotation = Math.sin(t * pace + k * Math.PI) * 0.7));
          duck.y = Math.sin(t * 2.2 + i * 1.3) * r * 0.05;
          duck.rotation = Math.sin(t * 2.2 + i * 1.3 + 1) * 0.04;
          head.rotation = Math.max(0, Math.sin(t * 1.4 + i * 2)) * 0.35;
        });
        return move(t);
      },
      destroy: () => node.destroy({ children: true }),
    };
  },
};

const heron: TankEvent = {
  name: 'heron',
  start(world, layers, rand, seconds) {
    // A heron stands over the water: now and then its long neck plunges in after a fish.
    const node = new Container();
    const s = world.height * 0.3;
    const neck = new Graphics();
    node.addChild(neck);
    layers.front.addChild(node);
    const x = world.width * rand(0.25, 0.75);
    const strikes = [0.2, 0.5, 0.78].map((f) => f * seconds + rand(-1, 1));
    let splashed = -1;
    return {
      update(_dt, _world, t) {
        // How far in: 0 hovering above the water, 1 a full plunge.
        const dip = Math.max(0, ...strikes.map((at) => Math.max(0, 1 - Math.abs(t - at) / 0.9)));
        const reach = world.waterTop - s * 0.25 + dip * s * 0.85;
        const sway = Math.sin(t * 0.8) * s * 0.05;
        neck.clear()
          .moveTo(x + sway, -s)
          .quadraticCurveTo(x + s * 0.15 + sway, (reach - s) / 2, x + sway * 0.5, reach)
          .stroke({ width: s * 0.07, color: 0x9aa7b3, cap: 'round' })
          .ellipse(x + sway * 0.5, reach, s * 0.07, s * 0.05)
          .fill(0xb5c0ca)
          .poly([x + sway * 0.5 - s * 0.02, reach, x + sway * 0.5 + s * 0.02, reach, x + sway * 0.5, reach + s * 0.22])
          .fill(0xe0a630)
          .circle(x + sway * 0.5 + s * 0.025, reach - s * 0.01, s * 0.01)
          .fill(0x1b1b1b);
        const striking = strikes.findIndex((at) => Math.abs(t - at) < 0.3);
        if (striking >= 0 && striking !== splashed) {
          splashed = striking;
          world.scene.burst(x, world.waterTop + 10, 10);
        }
        node.alpha = Math.min(1, t / 1.5, (seconds - t) / 1.5);
        return t < seconds;
      },
      destroy: () => node.destroy({ children: true }),
    };
  },
};

const gulls: TankEvent = {
  name: 'gulls',
  start(world, layers, rand, seconds) {
    // Seagulls flap across the sky; one dives into the sea and pops back up.
    const node = new Container();
    const s = world.height * 0.05;
    const birds = [0, 1, 2].map((i) => {
      const g = new Graphics();
      g.position.set(-i * s * 3, (i % 2) * s * 1.2 - i * s * 0.3);
      node.addChild(g);
      return g;
    });
    layers.front.addChild(node);
    const y = Math.max(s * 1.5, world.waterTop * 0.4);
    const move = crossing(node, world, seconds, y, s * 0.3, rand);
    const diveAt = seconds * rand(0.35, 0.55);
    let splashed = false;
    return {
      update(_dt, _world, t) {
        birds.forEach((g, i) => {
          const flap = Math.sin(t * 7 + i * 1.7) * s * 0.45;
          g.clear()
            .moveTo(-s, -flap).quadraticCurveTo(-s * 0.4, -s * 0.5 - flap * 0.4, 0, 0).quadraticCurveTo(s * 0.4, -s * 0.5 - flap * 0.4, s, -flap)
            .stroke({ width: s * 0.16, color: 0xf7f7f7, cap: 'round', join: 'round' })
            .ellipse(0, s * 0.05, s * 0.28, s * 0.14)
            .fill(0xffffff)
            .poly([s * 0.26, 0, s * 0.42, s * 0.05, s * 0.26, s * 0.1])
            .fill(0xf0b030);
        });
        // The middle gull dives: down through the surface and back up.
        const d = Math.max(0, 1 - Math.abs(t - diveAt) / 1.4);
        birds[1].y = s * 1.2 - s * 0.3 + d * (world.waterTop + s * 1.2 - y);
        if (!splashed && d > 0.85) {
          splashed = true;
          const at = world.scene.back.toLocal(birds[1].toGlobal({ x: 0, y: 0 }));
          world.scene.burst(at.x, world.waterTop + 10, 18);
        }
        return move(t);
      },
      destroy: () => node.destroy({ children: true }),
    };
  },
};

const tractor: TankEvent = {
  name: 'tractor',
  start(world, layers, rand, seconds) {
    // The farmer's little tractor chugs across the back of the field, puffing smoke.
    const node = new Container();
    const s = world.height * 0.11;
    const smoke = new Graphics();
    const body = new Graphics()
      // The bonnet and the cab.
      .roundRect(-s * 0.1, -s * 0.75, s * 0.85, s * 0.42, s * 0.08).fill(0x3e9b3a)
      .roundRect(-s * 0.7, -s * 1.25, s * 0.65, s * 0.92, s * 0.06).fill(0x3e9b3a)
      .roundRect(-s * 0.6, -s * 1.15, s * 0.45, s * 0.38, s * 0.04).fill(0xcfe9f5)
      .rect(-s * 0.78, -s * 1.32, s * 0.82, s * 0.1).fill(0x2f7a2c)
      // The exhaust pipe and a headlight.
      .rect(s * 0.42, -s * 1.05, s * 0.07, s * 0.32).fill(0x444444)
      .circle(s * 0.74, -s * 0.6, s * 0.06).fill(0xfff2a8);
    const wheel = (r: number, x: number) => {
      const w = new Graphics().circle(0, 0, r).fill(0x2b2b2b).circle(0, 0, r * 0.55).fill(0xf2c230);
      w.rect(-r * 0.08, -r * 0.55, r * 0.16, r * 1.1).rect(-r * 0.55, -r * 0.08, r * 1.1, r * 0.16).fill(0xd9a91f);
      w.position.set(x, -r);
      return w;
    };
    const back = wheel(s * 0.42, -s * 0.38);
    const front = wheel(s * 0.24, s * 0.55);
    node.addChild(smoke, body, back, front);
    // Far back in the field, behind everyone.
    const z = 0.85;
    node.scale.set(0.8);
    layers.back.addChild(node);
    const groundY = world.floorAt(world.width / 2) + (1 - z) * world.height * (world.groundDepth ?? 0.1) + 4;
    const move = crossing(node, world, seconds, groundY, 0, rand);
    const puffs: { x: number; y: number; age: number }[] = [];
    let puffIn = 0;
    return {
      update(dt, _world, t) {
        // Chug, chug: a little bounce, wheels turning, and puffs of smoke drifting up and back.
        body.y = Math.abs(Math.sin(t * 9)) * -s * 0.03;
        back.rotation = front.rotation = t * 4;
        front.rotation *= 0.42 / 0.24;
        puffIn -= dt;
        if (puffIn <= 0) {
          puffIn = 0.5;
          puffs.push({ x: s * 0.45, y: -s * 1.1, age: 0 });
        }
        smoke.clear();
        for (const p of puffs) {
          p.age += dt;
          p.x -= dt * s * 0.5;
          p.y -= dt * s * 0.6;
          smoke.circle(p.x, p.y, s * (0.08 + p.age * 0.12)).fill({ color: 0xdddddd, alpha: Math.max(0, 0.6 - p.age * 0.25) });
        }
        while (puffs.length && puffs[0].age > 2.4) puffs.shift();
        return move(t);
      },
      destroy: () => node.destroy({ children: true }),
    };
  },
};

const kite: TankEvent = {
  name: 'kite',
  start(world, layers, rand, seconds) {
    // Someone's kite dances across the sky over the meadow, its tail of bows fluttering and its string
    // running down to whoever's flying it, just out of sight.
    const node = new Container();
    const s = world.height * 0.09;
    const colors = [[0xff5a5a, 0xffd34d], [0x4da6ff, 0xffe066], [0xb36bff, 0x6bff9e]][Math.floor(rand(0, 3))];
    const string = new Graphics();
    const tail = new Graphics();
    const kite = new Graphics()
      .poly([0, -s, s * 0.6, -s * 0.15, 0, s * 0.9, -s * 0.6, -s * 0.15]).fill(colors[0])
      .poly([0, -s, s * 0.6, -s * 0.15, 0, -s * 0.15]).fill(colors[1])
      .poly([0, s * 0.9, -s * 0.6, -s * 0.15, 0, -s * 0.15]).fill(colors[1])
      .moveTo(0, -s).lineTo(0, s * 0.9).moveTo(-s * 0.6, -s * 0.15).lineTo(s * 0.6, -s * 0.15)
      .stroke({ width: 2, color: 0x5a3b1e, alpha: 0.7 });
    node.addChild(string, tail, kite);
    layers.front.addChild(node);
    const y = world.height * rand(0.16, 0.26);
    const move = crossing(node, world, seconds, y, s * 0.4, rand);
    return {
      update(_dt, _world, t) {
        // Tugging and swaying in the wind.
        kite.rotation = Math.sin(t * 1.7) * 0.25 + Math.sin(t * 4.1) * 0.06;
        kite.y = Math.sin(t * 2.3) * s * 0.25;
        const tip = { x: kite.x + Math.sin(-kite.rotation) * s * 0.9, y: kite.y + Math.cos(kite.rotation) * s * 0.9 };
        tail.clear().moveTo(tip.x, tip.y);
        const pts: { x: number; y: number }[] = [];
        for (let i = 1; i <= 6; i++) {
          const p = { x: tip.x - i * s * 0.18 + Math.sin(t * 6 - i) * s * 0.12, y: tip.y + i * s * 0.25 };
          tail.lineTo(p.x, p.y);
          pts.push(p);
        }
        tail.stroke({ width: 2, color: 0x5a3b1e, alpha: 0.8 });
        pts.forEach((p, i) => {
          if (i % 2) return;
          tail.poly([p.x - s * 0.13, p.y - s * 0.07, p.x, p.y, p.x - s * 0.13, p.y + s * 0.07]).fill(colors[i % 4 ? 1 : 0]);
          tail.poly([p.x + s * 0.13, p.y - s * 0.07, p.x, p.y, p.x + s * 0.13, p.y + s * 0.07]).fill(colors[i % 4 ? 1 : 0]);
        });
        // The string sags down and back to the flyer, off the bottom of the screen.
        const end = { x: -world.width * 0.35, y: world.height - y + 80 };
        string.clear().moveTo(0, kite.y + s * 0.1).quadraticCurveTo(end.x * 0.3, end.y * 0.75, end.x, end.y).stroke({ width: 1.5, color: 0xf7f2e6, alpha: 0.85 });
        node.alpha = Math.min(1, t / 2, (seconds - t) / 2);
        return move(t);
      },
      destroy: () => node.destroy({ children: true }),
    };
  },
};

const EVENTS: Record<string, TankEvent> = { whale, diver, ghost, ducks, heron, gulls, tractor, kite };

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
