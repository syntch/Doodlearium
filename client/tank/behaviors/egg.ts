import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Drawing } from '../../../shared/types.ts';
import type { Pose } from '../../../shared/sim/creature.ts';
import { TAU, depthOrder, type Creature, type World } from '../world.ts';

/**
 * An egg resting on the sand until its baby hatches. It's see-through, so the baby is just visible
 * curled up inside, and it wobbles more and more as hatching gets close (the pose's effort).
 */
export class Egg implements Creature {
  readonly view = new Container();
  private shell = new Graphics();
  private baby: Sprite;
  private mask = new Graphics();
  private r = 0;
  private wobble = Math.random() * TAU;

  constructor(
    readonly drawing: Drawing,
    texture: Texture,
  ) {
    this.baby = new Sprite({ texture, anchor: 0.5, alpha: 0.4 });
    this.view.addChild(this.shell, this.baby, this.mask);
    this.baby.mask = this.mask;
  }

  labelAnchor() {
    return { x: this.view.x, y: this.view.y - this.r * 1.6 - 8 };
  }

  update(dt: number, _world: World, pose: Pose) {
    if (pose.sx !== this.r) {
      // The pose's scale is the egg's radius.
      this.r = pose.sx;
      const texture = this.baby.texture;
      this.baby.scale.set((this.r * 1.5) / Math.max(texture.width, texture.height));
      this.drawShell(this.mask, 0xffffff);
      this.drawShell(this.shell, eggColor(texture));
      this.view.zIndex = depthOrder(pose.z);
    }
    // Wobbles in little fits, more often and harder in the last minute before hatching.
    const eager = pose.effort;
    this.wobble += dt * (2 + eager * 10);
    const fit = Math.max(0, Math.sin(this.wobble * 0.37)) ** 4;
    this.view.rotation = Math.sin(this.wobble * 3) * (0.05 + 0.2 * eager) * (0.3 + fit);
    this.view.position.set(pose.x, pose.y);
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
