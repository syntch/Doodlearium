import { Application, Container, RenderLayer, Texture } from 'pixi.js';
import type { Drawing } from '../../shared/types.ts';
import { packFlake } from '../../shared/sim/protocol.ts';
import { Tank } from '../../shared/sim/tank.ts';
import { WORLD_H, WORLD_W } from '../../shared/sim/world.ts';
import { Glow, type GlowTextures } from './glow.ts';
import { createCreature } from './creatures.ts';
import { Food } from './food.ts';
import type { Cutout } from './parts.ts';
import { Scene } from './scene.ts';
import type { Creature, World } from './world.ts';

/** The camera shows part of the tank, close up, so the creature is big enough to watch. */
const ZOOM = 2;

export interface Preview {
  /** Swaps in a new version of the drawing (the preview owns the texture, or cutout, from then on). */
  show(drawing: Drawing, texture: Texture, cutout?: Cutout | null, glow?: GlowTextures | null): void;
  /** Turns the preview tank's blacklight on or off. */
  setBlacklight(on: boolean): void;
  destroy(): void;
}

/**
 * A tiny tank for the draw page with one creature. It runs the tank's own simulation right here in the
 * browser (no server needed) and draws it with the tank's own code; the camera follows the creature.
 * Tapping it drops food, so feeding behaviour can be tried out too.
 */
export async function createPreview(container: HTMLElement): Promise<Preview> {
  const app = new Application();
  await app.init({ resizeTo: container, antialias: true, background: 0x0a3456, autoDensity: true, resolution: devicePixelRatio });
  container.append(app.canvas);

  const tank = new Tank();
  // Always daytime in the preview, whatever the clock says, so the drawing is easy to see.
  tank.hour = 12;
  const scene = new Scene();
  const food = new Food();
  const world: World = { width: WORLD_W, height: WORLD_H, floorY: tank.world.floorY, time: 0, scene, current: 0 };
  const creatureLayer = new Container({ sortableChildren: true });
  const nightLayer = new Container({ sortableChildren: true });
  food.view.zIndex = 500;
  creatureLayer.addChild(food.view);
  const glowLayer = new RenderLayer();
  const camera = new Container();
  camera.addChild(scene.back, creatureLayer, scene.front, nightLayer, glowLayer);
  app.stage.addChild(camera);
  // A handle for poking at the preview from the browser console, like the tank's.
  Object.assign(window, { doodlearium: { tank, world, creature: () => creature } });

  let creature: Creature | null = null;
  let id = '';
  let texture: Texture | null = null;
  let cutout: Cutout | null = null;
  let glow: Glow | null = null;

  /** The simulation's version of the creature. */
  const sim = () => tank.creatures.get(id);

  /** Plants and decorations sit in the middle so they're easy to see. */
  const centre = () => {
    const c = sim();
    if (c && (c.kind === 'plant' || c.kind === 'decor')) c.pose.x = WORLD_W / 2;
  };

  /** Tank units to the screen: the panel is filled at ZOOM times the size the tank would fit at. */
  let scale = 1;
  const size = { width: 0, height: 0 };
  const relayoutIfResized = () => {
    const { width, height } = app.screen;
    if (width === size.width && height === size.height) return;
    Object.assign(size, { width, height });
    scale = Math.min(width / WORLD_W, height / WORLD_H) * ZOOM;
    camera.scale.set(scale);
    scene.layout(world);
    follow(1);
  };

  /** Eases the camera toward the creature, without showing past the tank's edges. */
  function follow(k: number) {
    const c = sim();
    if (!c || !creature) return;
    const { width, height } = size;
    const wantX = Math.min(0, Math.max(width - WORLD_W * scale, width / 2 - c.pose.x * scale));
    const wantY = Math.min(0, Math.max(height - WORLD_H * scale, height / 2 - c.pose.y * scale));
    camera.x += (wantX - camera.x) * k;
    camera.y += (wantY - camera.y) * k;
  }
  relayoutIfResized();

  app.canvas.addEventListener('pointerdown', (e) => {
    const at = camera.toLocal({ x: e.clientX - app.canvas.getBoundingClientRect().left, y: e.clientY - app.canvas.getBoundingClientRect().top });
    tank.food.drop(tank.world, Math.min(1, Math.max(0, at.x / WORLD_W)));
  });

  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.05);
    relayoutIfResized();
    tank.step(dt);
    for (const e of tank.world.effects) scene.play(e);
    tank.world.effects.length = 0;
    tank.world.notes.length = 0;
    world.time = tank.world.time;
    world.current = tank.world.current;
    scene.darkness = tank.darkness;
    scene.blacklight = tank.blacklight;
    scene.update(dt, world);
    food.draw(tank.food.flakes.map(packFlake), world.time);
    const c = sim();
    try {
      if (c && creature) creature.update(dt, world, c.pose);
      glow?.update(0.4 + scene.darkness * 1.2 + scene.blacklight * 0.3, scene.blacklight * 1.1);
      follow(Math.min(1, dt * 3));
    } catch (err) {
      console.warn('Preview creature failed', err);
      clear();
    }
  });

  function clear() {
    glow?.destroy();
    glow = null;
    creature?.view.destroy({ children: true });
    if (cutout) cutout.destroy();
    else texture?.destroy(true);
    creature = null;
    texture = null;
    cutout = null;
  }

  return {
    show(drawing, newTexture, newCutout = null, glowTextures = null) {
      clear();
      texture = newTexture;
      cutout = newCutout;
      // Night creatures come out in the preview too, so they can be seen by day.
      const simDrawing = { ...drawing, nocturnal: false, updatedAt: Date.now() };
      // The same id carries on from where the previous version was, so redrawing doesn't make it jump around.
      if (id === drawing.id && tank.creatures.has(id)) tank.replace(simDrawing);
      else {
        if (id) tank.remove(id);
        tank.add(simDrawing, false);
      }
      id = drawing.id;
      centre();
      const kind = sim()!.kind;
      creature = createCreature(drawing, kind, newTexture, newCutout?.pieces);
      (drawing.nocturnal ? nightLayer : creatureLayer).addChild(creature.view);
      if (glowTextures && creature.body) glow = new Glow(creature.body, glowTextures, glowLayer, creature.moving);
      follow(1);
    },
    setBlacklight(on) {
      tank.blacklightOn = on;
    },
    destroy() {
      clear();
      app.destroy(true, { children: true });
    },
  };
}
