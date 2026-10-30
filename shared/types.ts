export const CREATURE_TYPES = ['swimmer', 'plant', 'decor'] as const;
export type CreatureType = (typeof CREATURE_TYPES)[number];

/** Stored drawings always face right (the draw page mirrors left-facing ones on export). */
export interface Drawing {
  id: string;
  type: CreatureType;
  name: string;
  artist: string;
  createdAt: number;
  /** Set when the drawing has been edited; also busts the browser's image cache. */
  updatedAt?: number;
  width: number;
  height: number;
}

export interface NewDrawing {
  type: CreatureType;
  name: string;
  artist: string;
  /** PNG data URL. */
  image: string;
}

export type ServerMessage =
  | { type: 'drawing:added'; drawing: Drawing }
  | { type: 'drawing:updated'; drawing: Drawing }
  | { type: 'drawing:removed'; id: string };

/** Images are served with a long cache lifetime, so the version query makes edits show up. */
export const imageUrl = (d: Pick<Drawing, 'id' | 'createdAt' | 'updatedAt'>) =>
  `/drawings/${d.id}.png?v=${d.updatedAt ?? d.createdAt}`;
