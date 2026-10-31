import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Drawing } from '../../../shared/types.ts';
import { TAU, depthOrder, depthScale, sandY, type Creature, type World } from '../world.ts';

const Z = 0.15;

/**
 * An egg resting on the sand until its baby hatches. It's see-through, so the baby is just visible
 * curled up inside, and it wobbles more and more as hatching gets close.
 */
export class Egg implements Creature {
  readonly view = new Container();
  private shell = new Graphics();
  private baby: Sprite;
  private x = 0;
  private y: number;
  private fall = 0;
  private r = 0;
  private wobble = Math.random() * TAU;
  readonly z = Z;

  constructor(
    readonly drawing: Drawing,
    texture: Texture,
    world: World,
    /** Laid just now: it sinks down from midwater instead of already lying on the sand. */
    sinking: boolean,
  ) {
    this.baby = new Sprite({ texture, anchor: 0.5, alpha: 0.4 });
    const mask = new Graphics();
    this.view.addChild(this.shell, this.baby, mask);
    this.baby.mask = mask;
    this.view.zIndex = depthOrder(Z);
    this.layout(world);
    this.y = sinking ? world.height * 0.45 : sandY(world, Z) - this.r * 1.3;
  }

  /** True once it's time to hatch. */
  get ready() {
    return Date.now() >= (this.drawing.hatchAt ?? 0);
  }

  /** Where the baby comes out. */
  get position() {
    return { x: this.view.x, y: this.view.y, z: Z };
  }

  layout(world: World) {
    this.r = world.height * 0.03 * depthScale(Z);
    this.x = (this.drawing.nest ?? 0.5) * world.width;
    const texture = this.baby.texture;
    this.baby.scale.set((this.r * 1.5) / Math.max(texture.width, texture.height));
    this.drawShell(this.baby.mask as Graphics, 0xffffff);
    this.drawShell(this.shell, eggColor(texture));
  }

  labelAnchor() {
    return { x: this.view.x, y: this.view.y - this.r * 1.6 - 8 };
  }

  update(dt: number, world: World) {
    const rest = sandY(world, Z) - this.r * 1.3;
    if (this.y < rest) {
      this.fall = Math.min(this.fall + world.height * 0.08 * dt, world.height * 0.12);
      this.y = Math.min(rest, this.y + this.fall * dt);
      if (this.y === rest) world.scene.burst(this.x, rest + this.r, 5);
    }
    // Wobbles in little fits, more often and harder in the last minute before hatching.
    const left = ((this.drawing.hatchAt ?? 0) - Date.now()) / 1000;
    const eager = left < 60 ? 1 - Math.max(0, left) / 60 : 0;
    this.wobble += dt * (2 + eager * 10);
    const fit = Math.max(0, Math.sin(this.wobble * 0.37)) ** 4;
    this.view.rotation = Math.sin(this.wobble * 3) * (0.05 + 0.2 * eager) * (0.3 + fit);
    this.view.position.set(this.x, this.y);
  }

  private drawShell(g: Graphics, color: number) {
    g.clear()
      .ellipse(0, 0, this.r, this.r * 1.3)
      .fill({ color, alpha: 0.85 })
      .stroke({ width: Math.max(1.5, this.r * 0.08), color: 0xffffff, alpha: 0.9 });
    if (g !== this.shell) return;
    // Speckles and a shine.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.4;
      g.circle(Math.cos(a) * this.r * 0.55, Math.sin(a) * this.r * 0.75, this.r * 0.1).fill({ color: 0xffffff, alpha: 0.5 });
    }
    g.ellipse(-this.r * 0.35, -this.r * 0.55, this.r * 0.18, this.r * 0.28).fill({ color: 0xffffff, alpha: 0.7 });
  }
}

/** A pale version of the baby's own colours. */
function eggColor(texture: Texture) {
  const source = texture.source.resource as CanvasImageSource | undefined;
  let r = 200, g = 220, b = 240;
  try {
    const c = Object.assign(document.createElement('canvas'), { width: 16, height: 16 }).getContext('2d', { willReadFrequently: true })!;
    if (source) c.drawImage(source, 0, 0, 16, 16);
    const px = c.getImageData(0, 0, 16, 16).data;
    let n = 0, sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      sr += px[i];
      sg += px[i + 1];
      sb += px[i + 2];
      n++;
    }
    if (n) [r, g, b] = [sr / n, sg / n, sb / n];
  } catch {}
  const pale = (v: number) => Math.round(v + (255 - v) * 0.55);
  return (pale(r) << 16) | (pale(g) << 8) | pale(b);
}
