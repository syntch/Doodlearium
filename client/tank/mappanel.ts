import { Application } from 'pixi.js';
import { MAP_H, MAP_W, type WorldDef } from '../../shared/world/places.ts';
import { WorldMap, type MapLooks } from './map.ts';

/** A world's map in a panel of a page (the world maker's preview, the draw page's place picker). */
export interface MapPanel {
  /** Draws a world's map (again, after it changed). */
  show(world: WorldDef): WorldMap;
  readonly map: WorldMap | null;
  /** A point on the page in map units. */
  toMap(clientX: number, clientY: number): { x: number; y: number };
  readonly canvas: HTMLCanvasElement;
  destroy(): void;
}

const noLooks: MapLooks = { use: () => null };

/** The whole map fits the panel (which should be about MAP_W × MAP_H in shape), centred. */
export async function createMapPanel(container: HTMLElement, looks: MapLooks = noLooks): Promise<MapPanel> {
  const app = new Application();
  await app.init({ resizeTo: container, antialias: true, background: 0x070b24, autoDensity: true, resolution: devicePixelRatio });
  container.append(app.canvas);
  let map: WorldMap | null = null;
  let time = 0;
  const fit = () => {
    if (!map) return;
    const s = Math.min(app.screen.width / MAP_W, app.screen.height / MAP_H);
    map.view.scale.set(s);
    map.view.position.set((app.screen.width - MAP_W * s) / 2, (app.screen.height - MAP_H * s) / 2);
  };
  // The panel may have been hidden (no size) when it was made: measure it again whenever it changes.
  new ResizeObserver(() => app.resize()).observe(container);
  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.1);
    time += dt;
    fit();
    map?.update(dt, time);
  });
  return {
    show(world) {
      const old = map;
      map = new WorldMap(looks, world);
      app.stage.addChild(map.view);
      old?.view.destroy({ children: true });
      app.resize();
      fit();
      return map;
    },
    get map() {
      return map;
    },
    toMap(clientX, clientY) {
      const box = app.canvas.getBoundingClientRect();
      const s = map?.view.scale.x ?? 1;
      return { x: (clientX - box.left - (map?.view.x ?? 0)) / s, y: (clientY - box.top - (map?.view.y ?? 0)) / s };
    },
    canvas: app.canvas,
    destroy() {
      app.destroy(true, { children: true });
    },
  };
}
