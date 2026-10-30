/** Where a drawing lives: open water, walking on the sand, growing from the sand, or sitting on it. */
export const CREATURE_TYPES = ['swimmer', 'crawler', 'plant', 'decor'] as const;
export type CreatureType = (typeof CREATURE_TYPES)[number];

/** How a drawing moves. Picking a motion style also decides where it lives. */
export const MOTIONS = ['fish', 'eel', 'jelly', 'seahorse', 'flapper', 'vessel', 'crawler', 'plant', 'decor'] as const;
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
}

export interface NewDrawing {
  motion: Motion;
  name: string;
  artist: string;
  /** PNG data URL. */
  image: string;
  attachments?: Attachment[];
  nocturnal?: boolean;
}

export type ServerMessage =
  | { type: 'drawing:added'; drawing: Drawing }
  | { type: 'drawing:updated'; drawing: Drawing }
  | { type: 'drawing:removed'; id: string }
  /** Feeding time: x is where across the tank (0..1) the food drops. */
  | { type: 'feed'; x: number };

/** Images are served with a long cache lifetime, so the version query makes edits show up. */
export const imageUrl = (d: Pick<Drawing, 'id' | 'createdAt' | 'updatedAt'>) =>
  `/drawings/${d.id}.png?v=${d.updatedAt ?? d.createdAt}`;
