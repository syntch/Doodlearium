/**
 * Explorers: drawings marked 🧭 Explorer are one of a kind, and travel. Every so often one sets off for
 * another place (in any world it can live in), and when it gets there it arrives in style (a balloon, a
 * bubble or a flying saucer drops it off) and puts on a show for the locals. The server plans the trips
 * (server/world.ts), so they show on Coming up; every screen draws the show from the same seed and start
 * time (client/tank/shows.ts), like a visit.
 */

export const SHOW_KINDS = ['wave', 'parade', 'party', 'treasure'] as const;
export type ShowKind = (typeof SHOW_KINDS)[number];

export interface ShowInfo {
  icon: string;
  /** How long the show lasts, after the arrival. */
  seconds: number;
  /** For the history: "Rocky arrived at the Meadow and …". */
  text: string;
  /** For the banner on screen: "Rocky's …". */
  title: string;
}

export const SHOWS: Record<ShowKind, ShowInfo> = {
  wave: { icon: '👋', seconds: 14, text: 'waved hello to everyone', title: 'big hello' },
  parade: { icon: '🎺', seconds: 40, text: 'led a parade of the locals', title: 'parade' },
  party: { icon: '🪩', seconds: 40, text: 'threw a dance party', title: 'dance party' },
  treasure: { icon: '💰', seconds: 28, text: 'dug up a treasure chest full of snacks', title: 'treasure hunt' },
};

/** The arrival before the show: dropped off from above, then a moment to land. */
export const ARRIVE_SECONDS = 7;

export const showSeconds = (kind: ShowKind) => ARRIVE_SECONDS + SHOWS[kind].seconds;

/** How long an explorer stays in a place before setting off again (minutes). */
export const STAY_MINUTES: [number, number] = [25, 50];
