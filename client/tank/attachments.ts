import { Container, Graphics, MeshPlane, Point, Sprite, Texture } from 'pixi.js';
import type { Attachment, AttachmentKind } from '../../shared/types.ts';
import { TAU, type World } from './world.ts';

/** How far the drawing's own animation moves a point at (u, v), in texture pixels. */
export type Deform = (u: number, v: number) => { dx: number; dy: number };

interface Part {
  node: Container;
  update(dt: number, world: World): void;
}

/** Size of a scale-1 extra in texture pixels, roughly matching its marker on the draw page. */
const UNIT = 75;

/**
 * The animated extras pinned to one drawing. Lives inside the creature's view, in the same
 * coordinates as its texture, so extras move, flip and tilt with the creature.
 */
export class Attachments {
  readonly container = new Container();
  private parts: { attachment: Attachment; part: Part }[] = [];

  constructor(
    list: Attachment[] | undefined,
    private texW: number,
    private texH: number,
    /** Texture point that sits at the view's origin (the mesh pivot or sprite anchor). */
    private origin: { x: number; y: number },
  ) {
    for (const attachment of list ?? []) {
      const part = PARTS[attachment.kind](attachment, UNIT * attachment.scale);
      this.container.addChild(part.node);
      this.parts.push({ attachment, part });
    }
  }

  update(dt: number, world: World, deform?: Deform) {
    for (const { attachment: a, part } of this.parts) {
      const { dx, dy } = deform?.(a.x, a.y) ?? { dx: 0, dy: 0 };
      part.node.position.set(a.x * this.texW - this.origin.x + dx, a.y * this.texH - this.origin.y + dy);
      part.update(dt, world);
    }
  }
}

// --- colours -------------------------------------------------------------

function hue(h: number) {
  const k = (n: number) => (n + h / 30) % 12;
  // HSL with saturation 0.85 and lightness 0.6: l - s * min(l, 1 - l) * ...
  const f = (n: number) => 0.6 - 0.34 * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}
/** A colour for this moment: rainbow cycles through hues over time. */
const colorAt = (color: string, time: number, offset = 0) =>
  color === 'rainbow' ? hue((time * 60 + offset) % 360) : parseInt(color.slice(1), 16);

// --- the extras ------------------------------------------------------------

const PARTS: Record<AttachmentKind, (a: Attachment, size: number) => Part> = {
  bubbles(a) {
    const node = new Container();
    let timer = Math.random();
    return {
      node,
      update(dt, world) {
        timer -= dt;
        if (timer > 0) return;
        timer = (0.25 + Math.random() * 0.7) / Math.sqrt(a.scale);
        // Into tank units: the tank is scaled to fit the screen (and zoomed by the documentary camera).
        const p = world.scene.front.toLocal(node.getGlobalPosition());
        world.scene.bubble(p.x + (Math.random() - 0.5) * 6, p.y, (1.5 + Math.random() * 3.5) * Math.sqrt(a.scale));
      },
    };
  },

  sparkles(a, size) {
    const node = new Container();
    const g = new Graphics();
    node.addChild(g);
    const sparks: { x: number; y: number; age: number; life: number; r: number; hue: number }[] = [];
    let timer = 0;
    return {
      node,
      update(dt, world) {
        timer -= dt;
        if (timer <= 0 && sparks.length < 10) {
          timer = 0.12 + Math.random() * 0.25;
          const angle = Math.random() * TAU;
          const dist = Math.random() * size * 0.9;
          sparks.push({
            x: Math.cos(angle) * dist,
            y: Math.sin(angle) * dist,
            age: 0,
            life: 0.6 + Math.random() * 0.8,
            r: size * (0.12 + Math.random() * 0.14),
            hue: Math.random() * 360,
          });
        }
        g.clear();
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i];
          s.age += dt;
          if (s.age >= s.life) {
            sparks.splice(i, 1);
            continue;
          }
          const k = Math.sin((s.age / s.life) * Math.PI);
          const r = s.r * k;
          const w = r * 0.28;
          // Four-pointed star.
          g.poly([s.x, s.y - r, s.x + w, s.y - w, s.x + r, s.y, s.x + w, s.y + w, s.x, s.y + r, s.x - w, s.y + w, s.x - r, s.y, s.x - w, s.y - w])
            .fill({ color: a.color === 'rainbow' ? hue(s.hue) : colorAt(a.color, world.time), alpha: 0.95 });
          g.circle(s.x, s.y, w * 0.8).fill({ color: 0xffffff, alpha: k });
        }
      },
    };
  },

  glow(a, size) {
    const node = new Container();
    const halo = new Sprite({ texture: glowTexture(), anchor: 0.5 });
    halo.blendMode = 'add';
    halo.width = halo.height = size * 3;
    const core = new Sprite({ texture: glowTexture(), anchor: 0.5 });
    core.width = core.height = size * 0.9;
    node.addChild(halo, core);
    const phase = Math.random() * TAU;
    return {
      node,
      update(_dt, world) {
        const pulse = 0.5 + 0.5 * Math.sin(world.time * 2 + phase);
        halo.tint = colorAt(a.color, world.time);
        halo.alpha = 0.45 + 0.35 * pulse;
        core.alpha = 0.7 + 0.3 * pulse;
      },
    };
  },

  googly(_a, size) {
    const node = new Container();
    const r = size * 0.5;
    const eye = new Graphics()
      .circle(0, 0, r)
      .fill(0xffffff)
      .stroke({ width: Math.max(1.5, r * 0.12), color: 0x111111 });
    const pupil = new Graphics().circle(0, 0, r * 0.5).fill(0x111111);
    const shine = new Graphics().circle(-r * 0.15, -r * 0.15, r * 0.12).fill(0xffffff);
    pupil.addChild(shine);
    node.addChild(eye, pupil);

    const maxOffset = r * 0.45;
    const pos = { x: 0, y: maxOffset };
    const vel = { x: 0, y: 0 };
    let prev: Point | null = null;
    let prevVel = { x: 0, y: 0 };
    const toLocalDir = (center: Point, gx: number, gy: number) => {
      const p = node.toLocal({ x: center.x + gx, y: center.y + gy });
      const len = Math.hypot(p.x, p.y);
      return len > 1e-6 && Number.isFinite(len) ? { x: p.x / len, y: p.y / len } : null;
    };
    return {
      node,
      update(dt) {
        if (dt <= 0) return;
        const center = node.getGlobalPosition();
        const gVel = prev ? { x: (center.x - prev.x) / dt, y: (center.y - prev.y) / dt } : { x: 0, y: 0 };
        const acc = { x: (gVel.x - prevVel.x) / dt, y: (gVel.y - prevVel.y) / dt };
        prev = center;
        prevVel = gVel;
        const down = toLocalDir(center, 0, 1);
        if (!down) return; // the creature is mid-turn and paper thin
        // The pupil hangs toward gravity and swings against the creature's acceleration.
        const accLen = Math.hypot(acc.x, acc.y);
        const accDir = accLen > 1 ? toLocalDir(center, acc.x, acc.y) : null;
        const push = accDir ? Math.min(1.2, accLen / 400) : 0;
        let tx = (down.x - (accDir?.x ?? 0) * push) * maxOffset;
        let ty = (down.y - (accDir?.y ?? 0) * push) * maxOffset;
        const tLen = Math.hypot(tx, ty);
        if (tLen > maxOffset) {
          tx = (tx / tLen) * maxOffset;
          ty = (ty / tLen) * maxOffset;
        }
        const k = Math.min(dt, 0.05);
        vel.x += ((tx - pos.x) * 60 - vel.x * 5) * k;
        vel.y += ((ty - pos.y) * 60 - vel.y * 5) * k;
        pos.x += vel.x * k;
        pos.y += vel.y * k;
        const len = Math.hypot(pos.x, pos.y);
        if (len > maxOffset) {
          pos.x = (pos.x / len) * maxOffset;
          pos.y = (pos.y / len) * maxOffset;
          vel.x *= -0.4;
          vel.y *= -0.4;
        }
        pupil.position.set(pos.x, pos.y);
      },
    };
  },

  flag(a, size) {
    const node = new Container();
    const poleHeight = size * 1.5;
    const pole = new Graphics()
      .moveTo(0, 0)
      .lineTo(0, -poleHeight)
      .stroke({ width: Math.max(2, size * 0.07), color: 0x5b4a3a, cap: 'round' })
      .circle(0, -poleHeight, size * 0.07)
      .fill(0xffd60a);
    const texture = flagTexture(a.color);
    // The cloth trails to the left of the pole: behind a right-facing fish.
    const cloth = new MeshPlane({ texture, verticesX: 10, verticesY: 3 });
    cloth.pivot.set(texture.width, 0);
    cloth.scale.set((size * 1.1) / texture.width);
    cloth.position.set(0, -poleHeight + size * 0.05);
    node.addChild(cloth, pole);
    const buffer = cloth.geometry.getAttribute('aPosition').buffer;
    const rest = (buffer.data as Float32Array).slice();
    const phase = Math.random() * TAU;
    return {
      node,
      update(_dt, world) {
        const p = buffer.data as Float32Array;
        for (let i = 0; i < p.length; i += 2) {
          const fromPole = 1 - rest[i] / texture.width; // 0 at the pole, 1 at the free end
          const wave = Math.sin(world.time * 5 + phase - fromPole * 5);
          p[i + 1] = rest[i + 1] + texture.height * 0.18 * fromPole * wave;
          p[i] = rest[i] + texture.width * 0.04 * fromPole * Math.cos(world.time * 5 + phase - fromPole * 5);
        }
        buffer.update();
      },
    };
  },

  propeller(a, size) {
    const node = new Container();
    const rotor = new Graphics();
    const blades = 3;
    for (let i = 0; i < blades; i++) {
      const angle = (i / blades) * TAU;
      const color = a.color === 'rainbow' ? hue(i * 120) : parseInt(a.color.slice(1), 16);
      // An ellipse pointing outward from the hub at this angle.
      const points: number[] = [];
      for (let s = 0; s < 16; s++) {
        const t = (s / 16) * TAU;
        const along = size * 0.32 * (1 + Math.cos(t));
        const across = size * 0.13 * Math.sin(t);
        points.push(Math.cos(angle) * along - Math.sin(angle) * across, Math.sin(angle) * along + Math.cos(angle) * across);
      }
      rotor.poly(points).fill(color).stroke({ width: Math.max(1, size * 0.03), color: 0x222222, alpha: 0.6 });
    }
    rotor.circle(0, 0, size * 0.12).fill(0x8d99ae).stroke({ width: Math.max(1, size * 0.03), color: 0x333333 });
    node.addChild(rotor);
    return {
      node,
      update(dt) {
        rotor.rotation += dt * 9;
      },
    };
  },
};

// --- textures ----------------------------------------------------------------

let glowTex: Texture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  glowTex = Texture.from(canvas);
  return glowTex;
}

const flagTextures = new Map<string, Texture>();
function flagTexture(color: string) {
  let tex = flagTextures.get(color);
  if (tex) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  if (color === 'rainbow') {
    ['#e63946', '#ff8c1a', '#ffd60a', '#52b788', '#3a86ff', '#8338ec'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(0, (i * 64) / 6, 96, 64 / 6 + 1);
    });
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 96, 64);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(48, 32, 13, 0, TAU);
    ctx.fill();
  }
  tex = Texture.from(canvas);
  flagTextures.set(color, tex);
  return tex;
}
