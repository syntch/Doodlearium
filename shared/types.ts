/** Where a drawing lives: open water, walking on the sand, growing from the sand, or sitting on it. */
export const CREATURE_TYPES = ['swimmer', 'crawler', 'plant', 'decor'] as const;
export type CreatureType = (typeof CREATURE_TYPES)[number];

/** How a drawing moves. Picking a motion style also decides where it lives. */
export const MOTIONS = ['fish', 'puffer', 'eel', 'jelly', 'seahorse', 'flapper', 'vessel', 'crawler', 'plant', 'decor'] as const;
export type Motion = (typeof MOTIONS)[number];

export const habitatOf = (motion: Motion): CreatureType =>
  motion === 'crawler' || motion === 'plant' || motion === 'decor' ? motion : 'swimmer';

/** Drawings made before motion styles existed only have a type. */
export const motionOf = (d: { motion?: Motion; type: CreatureType }): Motion =>
  d.motion ?? (d.type === 'swimmer' ? 'fish' : d.type);

/** Animated extras pinned to a drawing; the tank brings them to life. */
export const ATTACHMENT_KINDS = ['bubbles', 'sparkles', 'glow', 'googly', 'flag', 'propeller'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
export const MAX_ATTACHMENTS = 24;

export interface Attachment {
  kind: AttachmentKind;
  /** Position as a fraction of the stored image's width and height (may stick out a little past 0..1). */
  x: number;
  y: number;
  /** Size multiplier, 0.25 to 3. */
  scale: number;
  /** '#rrggbb' or 'rainbow'. */
  color: string;
}

/** How a selected part of a drawing moves on its own, on top of the whole-body motion. */
export const PART_MOTIONS = ['popout', 'flap', 'chomp', 'spin', 'pulse', 'blink'] as const;
export type PartMotion = (typeof PART_MOTIONS)[number];
/** Motions that move around the line where the part is attached (rather than around its middle). */
export const isHinged = (m: PartMotion) => m === 'popout' || m === 'flap' || m === 'chomp';
export const MAX_PARTS = 8;

/**
 * An animated part. Which pixels belong to it is stored in a separate image (`partsUrl`), where a pixel's
 * red value is 30 × (its part's index + 1).
 */
export interface Part {
  motion: PartMotion;
  /** Where it's attached: a line from (x1, y1) to (x2, y2), as fractions of the image's width and height. */
  hinge: [number, number, number, number];
  /** How fast and how far it moves, 0.25 to 3 (1 = normal). */
  speed?: number;
  amount?: number;
  /** Open & close: opens the other way round from the way it would pick by itself. */
  flip?: boolean;
}

export const isAttachmentColor = (c: unknown): c is string =>
  typeof c === 'string' && (c === 'rainbow' || /^#[0-9a-f]{6}$/i.test(c));

/** Stored drawings always face right (the draw page mirrors left-facing ones on export). */
export interface Drawing {
  id: string;
  type: CreatureType;
  motion?: Motion;
  name: string;
  artist: string;
  createdAt: number;
  /** Set when the drawing has been edited; also busts the browser's image cache. */
  updatedAt?: number;
  width: number;
  height: number;
  attachments?: Attachment[];
  /** Night creatures only come out after dark. */
  nocturnal?: boolean;
  parts?: Part[];
  /** Babies: the two drawings that schooled together and laid the egg it hatched from. */
  parents?: [string, string];
  /** When a baby's egg hatches (until then the tank shows an egg). */
  hatchAt?: number;
  /** Where across the tank (0..1) the egg was laid. */
  nest?: number;
  /** Has glowing paint, marked in a separate image (`glowUrl`). */
  glow?: boolean;
}

export interface NewDrawing {
  motion: Motion;
  name: string;
  artist: string;
  /** PNG data URL. */
  image: string;
  attachments?: Attachment[];
  nocturnal?: boolean;
  parts?: Part[];
  /** PNG data URL, the same size as image, marking each part's pixels. */
  partsImage?: string;
  /** PNG data URL, the same size as image: red where the paint glows, green where it's blacklight paint. */
  glowImage?: string;
}

/** A baby made by the tank from two parents, sent to be laid as an egg. */
export interface NewEgg extends NewDrawing {
  parents: [string, string];
  nest: number;
}

/** Things the tank's ⚙️ menu can do, on one screen or every open tank. */
export const TANK_COMMANDS = ['time', 'season', 'blacklight', 'film', 'visit', 'current', 'school', 'egg', 'puff'] as const;
export type TankCommand = (typeof TANK_COMMANDS)[number];
export type TankCommandValue = string | number | boolean | null;

export type ServerMessage =
  | { type: 'drawing:added'; drawing: Drawing }
  | { type: 'drawing:updated'; drawing: Drawing }
  | { type: 'drawing:removed'; id: string }
  /** Feeding time: x is where across the tank (0..1) the food drops. */
  | { type: 'feed'; x: number }
  | { type: 'tank'; command: TankCommand; value: TankCommandValue };

/** Images are served with a long cache lifetime, so the version query makes edits show up. */
export const imageUrl = (d: Pick<Drawing, 'id' | 'createdAt' | 'updatedAt'>) =>
  `/drawings/${d.id}.png?v=${d.updatedAt ?? d.createdAt}`;
export const partsUrl = (d: Pick<Drawing, 'id' | 'createdAt' | 'updatedAt'>) =>
  `/drawings/${d.id}.parts.png?v=${d.updatedAt ?? d.createdAt}`;
export const glowUrl = (d: Pick<Drawing, 'id' | 'createdAt' | 'updatedAt'>) =>
  `/drawings/${d.id}.glow.png?v=${d.updatedAt ?? d.createdAt}`;
