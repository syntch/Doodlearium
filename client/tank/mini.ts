import { Application, Container, Texture } from 'pixi.js';
import { motionOf, type Drawing } from '../../shared/types.ts';
import { Swimmer } from './behaviors/swimmer.ts';
import { createCreature } from './creatures.ts';
import { Food } from './food.ts';
import { Scene } from './scene.ts';
import type { Creature, World } from './world.ts';

const FLOOR = 0.86;
/** The preview is a small window into a smaller tank, so its creature is big enough to watch. */
const ZOOM = 1.6;

export interface Preview {
  /** Swaps in a new version of the drawing (the preview owns the texture from then on). */
  show(drawing: Drawing, texture: Texture): void;
  destroy(): void;
}

/**
 * A tiny tank running the real tank code with one creature, for the draw page.
 * Tapping it drops food, so feeding behaviour can be tried out too.
 */
export async function createPreview(container: HTMLElement): Promise<Preview> {
  const app = new Application();
  await app.init({ resizeTo: container, antialias: true, background: 0x0a3456, autoDensity: true, resolution: devicePixelRatio });
  container.append(app.canvas);

  const scene = new Scene();
  const food = new Food();
  const world: World = { width: 0, height: 0, floorY: 0, time: 0, scene, food, fish: [], school: null };
  const creatureLayer = new Container({ sortableChildren: true });
  const nightLayer = new Container({ sortableChildren: true });
  food.view.zIndex = 500;
  creatureLayer.addChild(food.view);
  app.stage.addChild(scene.back, creatureLayer, scene.front, nightLayer);
  // A handle for poking at the preview from the browser console, like the tank's.
  Object.assign(window, { doodlearium: { world, creature: () => creature } });

  let creature: Creature | null = null;
  let texture: Texture | null = null;

  /** Plants and decorations sit in the middle so they're easy to see. */
  const place = () => {
    if (!creature) return;
    creature.layout(world);
    const m = motionOf(creature.drawing);
    if (m === 'plant' || m === 'decor') creature.view.x = world.width / 2;
  };

  const size = { width: 0, height: 0 };
  const relayoutIfResized = () => {
    const { width, height } = app.screen;
    if (width === size.width && height === size.height) return;
    Object.assign(size, { width, height });
    world.width = width / ZOOM;
    world.height = height / ZOOM;
    world.floorY = world.height * FLOOR;
    app.stage.scale.set(ZOOM);
    scene.layout(world);
    place();
  };
  relayoutIfResized();

  app.canvas.addEventListener('pointerdown', (e) => {
    const rect = app.canvas.getBoundingClientRect();
    food.drop(world, (e.clientX - rect.left) / rect.width);
  });

  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.05);
    relayoutIfResized();
    world.time += dt;
    world.fish = creature instanceof Swimmer ? [creature] : [];
    scene.update(dt, world);
    food.update(dt, world);
    try {
      creature?.update(dt, world);
    } catch (err) {
      console.warn('Preview creature failed', err);
      clear();
    }
  });

  function clear() {
    creature?.view.destroy({ children: true });
    texture?.destroy(true);
    creature = null;
    texture = null;
  }

  return {
    show(drawing, newTexture) {
      clear();
      texture = newTexture;
      creature = createCreature(drawing, newTexture, world, false);
      (drawing.nocturnal ? nightLayer : creatureLayer).addChild(creature.view);
      place();
    },
    destroy() {
      clear();
      app.destroy(true, { children: true });
    },
  };
}
