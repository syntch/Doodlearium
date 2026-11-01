import { Application, Container, RenderLayer, Texture } from 'pixi.js';
import { Glow, type GlowTextures } from './glow.ts';
import { motionOf, type Drawing } from '../../shared/types.ts';
import { Swimmer } from './behaviors/swimmer.ts';
import { createCreature } from './creatures.ts';
import { Food } from './food.ts';
import type { Cutout } from './parts.ts';
import { Scene } from './scene.ts';
import { newWorld, type Creature } from './world.ts';

const FLOOR = 0.86;
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
 * A tiny tank running the real tank code with one creature, for the draw page.
 * The camera follows the creature around a tank the size of the panel.
 * Tapping it drops food, so feeding behaviour can be tried out too.
 */
export async function createPreview(container: HTMLElement): Promise<Preview> {
  const app = new Application();
  await app.init({ resizeTo: container, antialias: true, background: 0x0a3456, autoDensity: true, resolution: devicePixelRatio });
  container.append(app.canvas);

  const scene = new Scene();
  const food = new Food();
  const world = newWorld(scene, food);
  const creatureLayer = new Container({ sortableChildren: true });
  const nightLayer = new Container({ sortableChildren: true });
  food.view.zIndex = 500;
  creatureLayer.addChild(food.view);
  const glowLayer = new RenderLayer();
  app.stage.addChild(scene.back, creatureLayer, scene.front, nightLayer, glowLayer);
  // A handle for poking at the preview from the browser console, like the tank's.
  Object.assign(window, { doodlearium: { world, creature: () => creature } });

  let creature: Creature | null = null;
  let texture: Texture | null = null;
  let cutout: Cutout | null = null;
  let glow: Glow | null = null;

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
    world.width = width;
    world.height = height;
    world.floorY = height * FLOOR;
    app.stage.scale.set(ZOOM);
    scene.layout(world);
    place();
    follow(1);
  };

  /** Eases the camera toward the creature's middle, without showing past the tank's edges. */
  function follow(k: number) {
    if (!creature) return;
    // Bounds come back in screen pixels; turn their middle into tank coordinates.
    const b = creature.view.getBounds();
    const x = (b.x + b.width / 2 - app.stage.x) / ZOOM;
    const y = (b.y + b.height / 2 - app.stage.y) / ZOOM;
    const wantX = Math.min(0, Math.max(world.width * (1 - ZOOM), world.width / 2 - x * ZOOM));
    const wantY = Math.min(0, Math.max(world.height * (1 - ZOOM), world.height / 2 - y * ZOOM));
    app.stage.x += (wantX - app.stage.x) * k;
    app.stage.y += (wantY - app.stage.y) * k;
  }
  relayoutIfResized();

  app.canvas.addEventListener('pointerdown', (e) => {
    const rect = app.canvas.getBoundingClientRect();
    const screenX = ((e.clientX - rect.left) / rect.width) * world.width;
    food.drop(world, (screenX - app.stage.x) / ZOOM / world.width);
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
      // Carry on from where the previous version was, so redrawing doesn't make it jump around.
      const was = creature instanceof Swimmer ? { x: creature.x, y: creature.y, facing: creature.facing } : null;
      clear();
      texture = newTexture;
      cutout = newCutout;
      creature = createCreature(drawing, newTexture, world, false, newCutout?.pieces);
      if (was && creature instanceof Swimmer) Object.assign(creature, was);
      (drawing.nocturnal ? nightLayer : creatureLayer).addChild(creature.view);
      if (glowTextures && creature.body) glow = new Glow(creature.body, glowTextures, glowLayer, creature.moving);
      place();
      follow(1);
    },
    setBlacklight(on) {
      scene.blacklightOn = on;
    },
    destroy() {
      clear();
      app.destroy(true, { children: true });
    },
  };
}
