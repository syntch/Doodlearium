import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { motionOf, type Drawing } from '../../shared/types.ts';
import type { Personality } from '../../shared/sim/creature.ts';
import { clamp, type Creature, type World } from './world.ts';

const ZOOM = 1.9;

const ABOUT: Record<string, string> = {
  curious: 'Curious: loves coming up to the glass',
  shy: 'Shy: keeps to the back, near the plants',
  easygoing: 'Easygoing: just goes with the flow',
  hunter: 'A hunter: little fish hide when it prowls',
  crawler: 'Walks the sand, looking for crumbs',
};

/** A line about what the creature is like, if there's something to say. */
export function aboutOf(drawing: Drawing, personality?: Personality) {
  return ABOUT[motionOf(drawing) === 'crawler' ? 'crawler' : (personality ?? '')] ?? '';
}

/** A screen's size in pixels. */
export interface Screen {
  width: number;
  height: number;
}

/**
 * Every few minutes the camera drifts in and follows one creature for a while, like a nature
 * documentary, with a name card in the corner. The server picks who (and when), so every screen films the
 * same star. Everything in the tank lives inside `camera`, in tank units.
 */
export class Documentary {
  /** Screen-space name card. */
  readonly card = new Container();
  /** Dims everything but a circle around the star, so it's clear who's being filmed. Goes under the card. */
  readonly spotlight = new Sprite({ texture: spotlightTexture(), anchor: 0.5 });
  private cardBack = new Graphics();
  private title = new Text({ text: '', style: { fontFamily: 'Trebuchet MS, sans-serif', fontWeight: 'bold', fill: 0xffffff } });
  private lines = new Text({ text: '', style: { fontFamily: 'Trebuchet MS, sans-serif', fill: 0xdff3ff } });
  private subject: Creature | null = null;
  private zoom = 1;
  private focus = { x: 0, y: 0 };

  constructor(private camera: Container) {
    this.card.addChild(this.cardBack, this.title, this.lines);
    this.card.alpha = 0;
    this.spotlight.alpha = 0;
  }

  /** True while filming, so other labels keep out of the way. */
  get filming() {
    return this.subject !== null;
  }

  /**
   * subject is who's being filmed (null: nobody); lines are what the name card says about them.
   * screen is the screen's size, for the card.
   */
  update(
    dt: number,
    world: World,
    screen: Screen,
    subject: Creature | null,
    lines: (c: Creature) => string[],
    nameOf = (c: Creature) => c.drawing.name,
  ) {
    if (subject?.view.destroyed) subject = null;
    if (subject !== this.subject) {
      this.subject = subject;
      if (subject) {
        if (this.zoom < 1.05) this.focus = { x: subject.view.x, y: subject.view.y };
        this.title.text = `🎬 ${nameOf(subject)}`;
        this.lines.text = [`drawn by ${subject.drawing.artist}`, ...lines(subject)].filter(Boolean).join('\n');
      }
    }

    // Ease the zoom in and out slowly, and follow smoothly.
    const want = this.subject ? ZOOM : 1;
    this.zoom += (want - this.zoom) * Math.min(1, dt * 0.5);
    if (Math.abs(want - this.zoom) < 0.002) this.zoom = want;
    if (this.subject) {
      const k = Math.min(1, dt * 1.5);
      this.focus.x += (this.subject.view.x - this.focus.x) * k;
      this.focus.y += (this.subject.view.y - this.focus.y) * k;
    }
    const z = this.zoom;
    this.camera.scale.set(z);
    this.camera.position.set(
      clamp(world.width / 2 - this.focus.x * z, world.width - world.width * z, 0),
      clamp(world.height / 2 - this.focus.y * z, world.height - world.height * z, 0),
    );

    // The card fades in once the camera has mostly arrived.
    const shown = this.subject ? clamp((z - 1) / (ZOOM - 1) * 1.6 - 0.6, 0, 1) : Math.min(this.card.alpha, clamp((z - 1) / (ZOOM - 1), 0, 1));
    this.card.alpha = shown;
    if (shown > 0) this.layoutCard(screen);
    this.spotlight.alpha = shown * 0.85;
    if (this.subject && shown > 0) {
      const b = this.subject.view.getBounds();
      // The texture's clear middle is 2.5% of its radius: make that a bit bigger than the star.
      const radius = Math.max(b.width, b.height) * 0.62 + 20;
      this.spotlight.position.set(b.x + b.width / 2, b.y + b.height / 2);
      this.spotlight.width = this.spotlight.height = (radius / 0.025) * 2;
    }
  }

  private layoutCard(screen: Screen) {
    const size = Math.max(18, screen.height * 0.034);
    this.title.style.fontSize = size * 1.3;
    this.lines.style.fontSize = size * 0.8;
    const pad = size * 0.7;
    this.title.position.set(pad, pad * 0.7);
    this.lines.position.set(pad, pad * 0.7 + this.title.height + size * 0.2);
    const w = Math.max(this.title.width, this.lines.width) + pad * 2;
    const h = this.lines.y + this.lines.height + pad * 0.8;
    this.cardBack.clear().roundRect(0, 0, w, h, size * 0.5).fill({ color: 0x06243b, alpha: 0.72 });
    this.card.position.set(screen.width * 0.04, screen.height - h - screen.height * 0.05);
  }
}

/** Clear in the middle, softly darker outside: a spotlight seen from the dark. */
function spotlightTexture() {
  const canvas = Object.assign(document.createElement('canvas'), { width: 1024, height: 1024 });
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(512, 512, 0, 512, 512, 512);
  grad.addColorStop(0, 'rgba(2, 13, 36, 0)');
  grad.addColorStop(0.025, 'rgba(2, 13, 36, 0)');
  grad.addColorStop(0.07, 'rgba(2, 13, 36, 0.6)');
  grad.addColorStop(1, 'rgba(2, 13, 36, 0.6)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);
  return Texture.from(canvas);
}
