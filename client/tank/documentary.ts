import { Container, Graphics, Text } from 'pixi.js';
import { motionOf } from '../../shared/types.ts';
import { Swimmer } from './behaviors/swimmer.ts';
import { clamp, type Creature, type World } from './world.ts';

const ZOOM = 1.9;
const FILM_SECONDS = 28;

const ABOUT: Record<string, string> = {
  curious: 'Curious: loves coming up to the glass',
  shy: 'Shy: keeps to the back, near the plants',
  easygoing: 'Easygoing: just goes with the flow',
  hunter: 'A hunter: little fish hide when it prowls',
  crawler: 'Walks the sand, looking for crumbs',
};

/**
 * Every few minutes the camera drifts in and follows one creature for a while, like a nature
 * documentary, with a name card in the corner. Everything in the tank lives inside `camera`.
 */
export class Documentary {
  /** Screen-space name card. */
  readonly card = new Container();
  private cardBack = new Graphics();
  private title = new Text({ text: '', style: { fontFamily: 'Trebuchet MS, sans-serif', fontWeight: 'bold', fill: 0xffffff } });
  private lines = new Text({ text: '', style: { fontFamily: 'Trebuchet MS, sans-serif', fill: 0xdff3ff } });
  private subject: Creature | null = null;
  private until = 0;
  private nextAt: number;
  private zoom = 1;
  private focus = { x: 0, y: 0 };

  constructor(
    private camera: Container,
    firstIn = 120 + Math.random() * 120,
  ) {
    this.nextAt = firstIn;
    this.card.addChild(this.cardBack, this.title, this.lines);
    this.card.alpha = 0;
  }

  /** True while filming, so other labels keep out of the way. */
  get filming() {
    return this.subject !== null;
  }

  /** Starts filming now (or the given creature). */
  start(world: World, candidates: Creature[], describe: (c: Creature) => string[]) {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    if (!pick) return;
    this.subject = pick;
    this.until = world.time + FILM_SECONDS;
    if (this.zoom < 1.05) this.focus = { x: pick.view.x, y: pick.view.y };
    const d = pick.drawing;
    const kind = pick instanceof Swimmer ? pick.personality : motionOf(d) === 'crawler' ? 'crawler' : '';
    this.title.text = `🎬 ${d.name}`;
    this.lines.text = [`drawn by ${d.artist}`, ...describe(pick), ABOUT[kind] ?? ''].filter(Boolean).join('\n');
  }

  update(dt: number, world: World, candidates: () => Creature[], describe: (c: Creature) => string[]) {
    if (this.subject && (this.subject.view.destroyed || world.time > this.until)) {
      this.subject = null;
      this.nextAt = world.time + 300 + Math.random() * 300;
    }
    if (!this.subject && world.time > this.nextAt) {
      this.start(world, candidates(), describe);
      if (!this.subject) this.nextAt = world.time + 60;
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
    if (shown > 0) this.layoutCard(world);
  }

  private layoutCard(world: World) {
    const size = Math.max(18, world.height * 0.034);
    this.title.style.fontSize = size * 1.3;
    this.lines.style.fontSize = size * 0.8;
    const pad = size * 0.7;
    this.title.position.set(pad, pad * 0.7);
    this.lines.position.set(pad, pad * 0.7 + this.title.height + size * 0.2);
    const w = Math.max(this.title.width, this.lines.width) + pad * 2;
    const h = this.lines.y + this.lines.height + pad * 0.8;
    this.cardBack.clear().roundRect(0, 0, w, h, size * 0.5).fill({ color: 0x06243b, alpha: 0.72 });
    this.card.position.set(world.width * 0.04, world.height - h - world.height * 0.05);
  }
}
