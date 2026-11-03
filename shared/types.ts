import type { Frame, MapSummary, RosterEntry, Upcoming } from './sim/protocol.ts';
import type { Biome } from './world/biomes.ts';
import type { WorldDef } from './world/places.ts';

/** Where a drawing lives: open water, walking on the sand, growing from the sand, or sitting on it. */
export const CREATURE_TYPES = ['swimmer', 'crawler', 'plant', 'decor', 'walker', 'flier'] as const;
export type CreatureType = (typeof CREATURE_TYPES)[number];

/** How a drawing moves. Picking a motion style also decides where it lives. */
export const MOTIONS = [
  'fish', 'puffer', 'eel', 'jelly', 'seahorse', 'flapper', 'vessel', 'crawler', 'plant', 'decor',
  'walker', 'hopper', 'slitherer', 'flier', 'waterfowl',
] as const;
export type Motion = (typeof MOTIONS)[number];

/** Land animals that get about on the ground (walking, hopping or slithering). */
export const LAND_MOTIONS: Motion[] = ['walker', 'hopper', 'slitherer'];

export const habitatOf = (motion: Motion): CreatureType =>
  motion === 'crawler' || motion === 'plant' || motion === 'decor' || motion === 'flier'
    ? motion
    : motion === 'waterfowl'
      ? 'flier'
    : LAND_MOTIONS.includes(motion)
      ? 'walker'
      : 'swimmer';

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
export const PART_MOTIONS = ['popout', 'flap', 'chomp', 'spin', 'pulse', 'blink', 'leg'] as const;
export type PartMotion = (typeof PART_MOTIONS)[number];
/** Motions that move around the line where the part is attached (rather than around its middle). */
export const isHinged = (m: PartMotion) => m === 'popout' || m === 'flap' || m === 'chomp' || m === 'leg';
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
  /** Open & close, seen from the front: lifts straight off the rest (a clam's top shell) instead of swinging. */
  lift?: boolean;
  /**
   * What shows where it was, as it moves, has been painted (in a separate image, `behindUrl`). Otherwise
   * a shadow of it is left there, like the hole left when a paper cut-out lifts.
   */
  behind?: boolean;
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
  /**
   * A drawing is a species: the world fills its places with as many as suit them. Where it can live
   * (unset: the usual places for its style, see shared/world/biomes.ts).
   */
  habitats?: Biome[];
  /** Comes in a school (or later, a flock or herd). Unset: fish do, others don't. */
  group?: boolean;
  /** The place the named original lives (unset: wherever suits it). */
  home?: string;
  /** Roughly how big its kind grows (unset: medium). Each one still varies around it. */
  size?: SpeciesSize;
  /**
   * Came in a drawing pack: its id where it was first drawn, so a newer version of the pack updates it
   * rather than adding it again (see server/packs.ts).
   */
  origin?: string;
  /** The worlds it lives in (unset: its packs' worlds, or Earth). */
  worlds?: string[];
  /** Exactly where it lives, tapped on the map (unset: wherever suits it in its worlds). */
  places?: string[];
  /**
   * An explorer: one of a kind (never copies), who travels from place to place, and world to world, and
   * puts on a show wherever it arrives (see shared/sim/explorers.ts).
   */
  explorer?: boolean;
}

/** A named group of drawings to share with another Doodlearium (see server/packs.ts). */
export interface Pack {
  /** The same everywhere the pack goes, so installing a newer version updates it. */
  id: string;
  name: string;
  /** Goes up by itself when it's exported with changes (1, 2, 3... or 1.4, 1.5...). */
  version: string;
  /** The drawings in it here. */
  drawings: string[];
  /** Installed from a pack file (rather than put together here): uninstalling it removes its drawings. */
  installed: boolean;
  createdAt: number;
  updatedAt: number;
  /** The last export: which version, and what was in it (to tell whether anything has changed since). */
  exported?: { version: string; at: number; signature: string };
  /** Sent with the list: something's changed since the last export (so the next one is a new version). */
  changed?: boolean;
  /** The worlds its drawings live in (unless a drawing says otherwise). Unset: Earth. */
  worlds?: string[];
}

/** One drawing in a pack file: its details as the draw page sends them, and its key (see Drawing.origin). */
export interface PackFileDrawing extends NewDrawing {
  key: string;
  /** A baby's parents' keys (kept when they're in the pack too). */
  parents?: [string, string];
}

/** What's saved in a .doodlepack file. */
export interface PackFile {
  format: 'doodlearium-pack';
  formatVersion: 1;
  id: string;
  name: string;
  version: string;
  exportedAt: number;
  /** The worlds it was given to, by id: where those are installed, it goes there too. */
  worlds?: string[];
  drawings: PackFileDrawing[];
}

/** A world on this server: Earth (built in), or one made here or installed from a .doodleworld file. */
export interface WorldPack extends WorldDef {
  /** Goes up by itself when it's exported with changes, like a pack's. */
  version: string;
  /** Installed from a file (rather than made here). */
  installed: boolean;
  /** Earth: always here. */
  builtin?: boolean;
  createdAt: number;
  updatedAt: number;
  exported?: { version: string; at: number; signature: string };
  /** Sent with the list: something's changed since the last export. */
  changed?: boolean;
}

/** What's saved in a .doodleworld file. */
export interface WorldFile extends WorldDef {
  format: 'doodlearium-world';
  formatVersion: 1;
  version: string;
  exportedAt: number;
}

/** What installing a pack did. */
export interface PackInstall {
  pack: Pack;
  added: number;
  updated: number;
  removed: number;
}

export type SpeciesSize = 'small' | 'big';

export interface NewDrawing {
  motion: Motion;
  name: string;
  artist: string;
  /** PNG data URL. */
  image: string;
  attachments?: Attachment[];
  nocturnal?: boolean;
  explorer?: boolean;
  parts?: Part[];
  /** PNG data URL, the same size as image, marking each part's pixels. */
  partsImage?: string;
  /** PNG data URL, the same size as image: red where the paint glows, green where it's blacklight paint. */
  glowImage?: string;
  /** PNG data URL, the same size as image: what's painted behind the parts that have `behind`. */
  behindImage?: string;
  habitats?: Biome[];
  group?: boolean;
  home?: string;
  size?: SpeciesSize;
  worlds?: string[];
  places?: string[];
}

/** A baby made by the tank from two parents, sent to be laid as an egg (in the place the parents are). */
export interface NewEgg extends NewDrawing {
  parents: [string, string];
  nest: number;
  place?: string;
}

/** Things the tank's ⚙️ menu can do (to the one shared tank), now or at a set time. */
export const TANK_COMMANDS = ['time', 'season', 'blacklight', 'film', 'visit', 'current', 'school', 'egg', 'puff', 'rain', 'snow', 'rainbow', 'explorer'] as const;
export type TankCommand = (typeof TANK_COMMANDS)[number];
export type TankCommandValue = string | number | boolean | null;

/** Where a species lives (GET /api/population): its original's place, and how many of it are in each place. */
export interface SpeciesWhere {
  home: string;
  places: Record<string, number>;
}

/** What a screen tells the server: which place it's showing (null: the map), so it gets that place's news. */
export type ClientMessage = { type: 'watch'; place: string | null };

export type ServerMessage =
  | { type: 'drawing:added'; drawing: Drawing }
  | { type: 'drawing:updated'; drawing: Drawing }
  | { type: 'drawing:removed'; id: string }
  /** A drawing pack was made, changed, installed or removed. */
  | { type: 'packs' }
  /** A world was made, changed, installed or removed: its places may have opened or closed. */
  | { type: 'worlds'; worlds: WorldDef[] }
  /** Feeding time: x is where across the tank (0..1) the food drops (screens play the plops). */
  | { type: 'feed'; x: number }
  /** Who's in the place being watched, and how it looks right now (see shared/sim/protocol.ts). */
  | { type: 'roster'; place: string; creatures: RosterEntry[] }
  | { type: 'frame'; frame: Frame }
  /** Every place at a glance, about once a second. */
  | { type: 'map'; places: MapSummary; species: Record<string, number> }
  /** Every screen should go to this place (someone picked 📺 in the ⚙️ menu). */
  | { type: 'show'; place: string }
  /** The server would like a screen to blend two parents into a baby and lay its egg (see babies.ts). */
  | { type: 'egg:make'; parents: [string, string]; nest: number; place: string; now: boolean }
  | { type: 'upcoming'; items: Upcoming[] }
  | { type: 'history'; entry: HistoryEntry }
  /** Sent on connecting: which run of the server this is. A different one after a restart means new pages. */
  | { type: 'hello'; version: string }
  /** The server is stopping to update itself (it'll be back in a minute or so). */
  | { type: 'updating' };

/** What happened the last time the server updated itself (data/update.json, written by scripts/start.mjs). */
export interface UpdateResult {
  at: number;
  ok: boolean;
  message: string;
  from?: string;
  to?: string;
  /** What's new: the changes' one-line descriptions. */
  changes?: string[];
  announced?: boolean;
}

/** The ⚙️ menu's 🔄 Update: whether it can, the version running, and what's new on GitHub (when checked). */
export interface UpdateInfo {
  can: boolean;
  why?: string;
  version?: { hash: string; date: string; subject: string };
  changes?: string[];
  /** Files changed by hand on the server, which might get in the way. */
  dirty?: boolean;
  error?: string;
  last?: UpdateResult;
}

/** Something that happened in the world, written down for the history page (and stories). */
export interface HistoryEntry {
  /** When (ms since 1970). */
  at: number;
  type: string;
  /** Where in the world (just the lake, for now). */
  place: string;
  /** The drawings it was about. */
  who: string[];
  text: string;
}

/** A story written from the history, pasted back in to keep. */
export interface Story {
  id: string;
  title: string;
  text: string;
  createdAt: number;
  /** The stretch of history it's about (ms since 1970). */
  from: number;
  to: number;
}

/** Images are served with a long cache lifetime, so the version query makes edits show up. */
export const imageUrl = (d: Pick<Drawing, 'id' | 'createdAt' | 'updatedAt'>) =>
  `/drawings/${d.id}.png?v=${d.updatedAt ?? d.createdAt}`;
export const partsUrl = (d: Pick<Drawing, 'id' | 'createdAt' | 'updatedAt'>) =>
  `/drawings/${d.id}.parts.png?v=${d.updatedAt ?? d.createdAt}`;
export const glowUrl = (d: Pick<Drawing, 'id' | 'createdAt' | 'updatedAt'>) =>
  `/drawings/${d.id}.glow.png?v=${d.updatedAt ?? d.createdAt}`;
export const behindUrl = (d: Pick<Drawing, 'id' | 'createdAt' | 'updatedAt'>) =>
  `/drawings/${d.id}.behind.png?v=${d.updatedAt ?? d.createdAt}`;
