import type { Upcoming, UpcomingKind } from '../../shared/sim/protocol.ts';

/**
 * 🎯 Follow the action: a screen nobody's using flies to what's about to happen, wherever it is (other worlds
 * too), and stays to watch it. Each sort of happening is a must-see, worth it if nothing better is on, or
 * skipped; a must-see takes the screen away from a lesser one, never the other way round. The choices are
 * this screen's own (the TV might want different ones from a laptop).
 */

export type Priority = 'must' | 'nice' | 'skip';

export const PRIORITIES: { id: Priority; label: string; title: string }[] = [
  { id: 'must', label: '⭐ Must see', title: 'Always go, even from something else' },
  { id: 'nice', label: '👍 If nothing better', title: 'Go if nothing more exciting is on' },
  { id: 'skip', label: '✋ Skip', title: "Don't go for these" },
];

export const KIND_NAMES: Record<UpcomingKind, string> = {
  explorer: '🧭 Explorers arriving',
  planned: '⏰ Planned in ⚙️',
  visitor: '🛸 Visitors dropping by',
  egg: '🐣 Eggs hatching',
};

const DEFAULTS: Record<UpcomingKind, Priority> = { explorer: 'must', planned: 'must', visitor: 'nice', egg: 'skip' };

/** How long nobody has to touch the screen before it follows the action. */
export const FOLLOW_IDLE_MS = 60_000;
/** Setting off this long before it starts: out to the map, maybe a rocket trip, and back in. */
const LEAD_MS = 12_000;
/**
 * Things leave Coming up once they start, so one still listed after its time is running late, not over;
 * after this long it's given up on (a world went away, say).
 */
const LATE_MS = 60_000;

const KEY = 'doodlearium.follow';
const RANK: Record<Priority, number> = { must: 2, nice: 1, skip: 0 };

export interface FollowSettings {
  on: boolean;
  priorities: Record<UpcomingKind, Priority>;
}

export function loadFollow(): FollowSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<FollowSettings> | null;
    return { on: Boolean(saved?.on), priorities: { ...DEFAULTS, ...saved?.priorities } };
  } catch {
    return { on: false, priorities: { ...DEFAULTS } };
  }
}

export function saveFollow(settings: FollowSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}

/** What the screen is watching, and until when (ms since 1970). */
interface Watching {
  key: string;
  rank: number;
  until: number;
}

export class Follow {
  private watching: Watching | null = null;

  constructor(public settings: FollowSettings) {}

  /** Watching something right now (so documentaries leave the camera alone). */
  get busy() {
    return Boolean(this.watching && Date.now() < this.watching.until);
  }

  /** Someone's using the screen: whatever it was following is theirs now. */
  stop() {
    this.watching = null;
  }

  /**
   * Picks what to watch: the best happening about to start (or just started), soonest first among equals.
   * Returns a place to go to, or undefined to stay put.
   */
  next(upcoming: Upcoming[], here: string | null, canGo: (place: string) => boolean): string | undefined {
    const now = Date.now();
    if (this.watching && now >= this.watching.until) this.watching = null;
    const rankOf = (u: Upcoming) => RANK[this.settings.priorities[u.kind] ?? 'skip'];
    const best = upcoming
      .filter((u) => u.place && rankOf(u) > 0 && u.at <= now + LEAD_MS && u.at >= now - LATE_MS && canGo(u.place))
      .sort((a, b) => rankOf(b) - rankOf(a) || a.at - b.at)[0];
    if (!best) return undefined;
    const key = `${best.kind}:${best.place}:${best.at}`;
    const until = Math.max(best.at, now) + best.seconds * 1000 + 3000;
    if (this.watching?.key === key) {
      // Still waiting for it to start: watch on until it's been and gone.
      this.watching.until = Math.max(this.watching.until, until);
      return undefined;
    }
    // Only something more exciting takes the screen away from what it's watching.
    if (this.watching && rankOf(best) <= this.watching.rank) return undefined;
    this.watching = { key, rank: rankOf(best), until };
    return best.place === here ? undefined : best.place;
  }
}
