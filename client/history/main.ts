import { imageUrl, motionOf, type Drawing, type HistoryEntry, type Motion, type SpeciesWhere, type Story } from '../../shared/types.ts';
import { allWorlds, placeById, placeName, worldOf } from '../../shared/world/places.ts';
import { lookOf } from '../../shared/world/looks.ts';
import { connectLive, loadWorlds, fetchDrawings, fetchHistory, fetchPopulation, fetchStories, saveStory } from '../shared/api.ts';

// Which worlds (and places) there are, before anything looks a place up.
await loadWorlds(true).catch(() => {});

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const fromInput = $<HTMLInputElement>('#from');
const toInput = $<HTMLInputElement>('#to');
const timeline = $<HTMLDivElement>('#timeline');
const empty = $<HTMLParagraphElement>('#empty');

const DAY = 86_400_000;
/** Every drawing, by id, for names and thumbnails. */
const drawings = new Map<string, Drawing>();
/** Where each species lives, for the story prompt. */
let population: Record<string, SpeciesWhere> = {};
let entries: HistoryEntry[] = [];
/** The one creature picked (unset: everyone). */
let who: string | undefined;

/** yyyy-mm-dd in local time, for date inputs. */
const dateValue = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOf = (value: string) => new Date(`${value}T00:00:00`).getTime();

/** The stretch of history picked: from the start of the first day to the end of the last. */
function range() {
  const from = fromInput.value ? startOf(fromInput.value) : 0;
  const to = toInput.value ? startOf(toInput.value) + DAY - 1 : Date.now();
  return { from, to, who };
}

const now = new Date();
toInput.value = dateValue(now);
fromInput.value = dateValue(new Date(now.getTime() - 6 * DAY));

async function load() {
  const [all, history] = await Promise.all([fetchDrawings(), fetchHistory(range())]);
  population = await fetchPopulation().catch(() => population);
  for (const d of all) drawings.set(d.id, d);
  entries = [...history, ...birthdays(range())].sort((a, b) => a.at - b.at);
  render();
}

/**
 * 🎂 Birthdays: each of the family's creatures (not ones that came with Doodlearium) has one every month for
 * its first year, then every year, counted from when it was drawn (or, for a baby, hatched).
 */
function birthdays({ from, to, who }: { from: number; to: number; who?: string }): HistoryEntry[] {
  const list: HistoryEntry[] = [];
  const end = Math.min(to, Date.now());
  for (const d of drawings.values()) {
    if (d.artist === 'Doodlearium' || (who && d.id !== who)) continue;
    const born = new Date(d.parents ? (d.hatchAt ?? d.createdAt) : d.createdAt);
    for (let months = 1; months <= 12 * 50; months += months < 12 ? 1 : 12) {
      const day = new Date(born);
      day.setMonth(born.getMonth() + months);
      // The 31st in a short month: the last day of that month instead.
      if (day.getDate() !== born.getDate()) day.setDate(0);
      const at = day.getTime();
      if (at > end) break;
      if (at < from) continue;
      const years = Math.floor(months / 12);
      const age = years ? `${years} year${years > 1 ? 's' : ''}` : `${months} month${months > 1 ? 's' : ''}`;
      const by = d.parents ? '' : ` (drawn by ${d.artist})`;
      list.push({ at, type: 'birthday', place: population[d.id]?.home ?? '', who: [d.id], text: `🎂 Happy birthday, ${d.name}! ${d.name}${by} is ${age} old today.` });
    }
  }
  return list;
}

// --- 👥 who: a searchable grid of every creature, by artist ----------------------------------------------

const whoButton = $<HTMLButtonElement>('#who');
const picker = $<HTMLDivElement>('#who-picker');
const search = $<HTMLInputElement>('#who-search');
const whoList = $<HTMLDivElement>('#who-list');

const thumb = (d: Drawing) => Object.assign(document.createElement('img'), { src: imageUrl(d), alt: '', loading: 'lazy' });

/** The button says who's picked. */
function fillWho() {
  const d = who ? drawings.get(who) : undefined;
  whoButton.replaceChildren(
    ...(d ? [thumb(d), d.name] : ['👥 Everyone']),
    Object.assign(document.createElement('span'), { className: 'caret', textContent: '▾' }),
  );
  whoButton.title = d ? `${d.name} by ${d.artist}` : 'Pick a creature to see just its story';
  if (!picker.hidden) fillPicker();
}

function pick(id: string | undefined) {
  who = id;
  openPicker(false);
  fillWho();
  void load();
}

/** Everyone that's hatched, grouped by artist (the family first, then what came with packs), filtered by the search. */
function fillPicker() {
  const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (d: Drawing) => words.every((w) => `${d.name} ${d.artist}`.toLowerCase().includes(w));
  const hatched = [...drawings.values()].filter((d) => (!d.hatchAt || d.hatchAt < Date.now()) && matches(d));
  const artists = new Map<string, Drawing[]>();
  for (const d of hatched.sort((a, b) => a.name.localeCompare(b.name))) artists.set(d.artist, [...(artists.get(d.artist) ?? []), d]);
  const order = [...artists.keys()].sort((a, b) => Number(a === 'Doodlearium') - Number(b === 'Doodlearium') || a.localeCompare(b));
  const top: HTMLElement[] = [];
  if (!words.length) {
    const everyone = Object.assign(document.createElement('button'), { textContent: '👥 Everyone' });
    everyone.setAttribute('aria-pressed', String(!who));
    everyone.onclick = () => pick(undefined);
    const grid = Object.assign(document.createElement('div'), { className: 'grid' });
    grid.style.marginTop = '10px';
    grid.append(everyone);
    top.push(grid);
  }
  whoList.replaceChildren(
    ...top,
    ...order.flatMap((artist) => {
      const grid = Object.assign(document.createElement('div'), { className: 'grid' });
      for (const d of artists.get(artist)!) {
        const b = document.createElement('button');
        b.title = `${d.name} by ${d.artist}`;
        b.setAttribute('aria-pressed', String(d.id === who));
        b.append(thumb(d), Object.assign(document.createElement('span'), { textContent: d.name }));
        b.onclick = () => pick(d.id);
        grid.append(b);
      }
      const title = artist === 'Doodlearium' ? 'Came with Doodlearium' : `Drawn by ${artist}`;
      return [Object.assign(document.createElement('h3'), { textContent: `${title} (${artists.get(artist)!.length})` }), grid];
    }),
    ...(hatched.length ? [] : [Object.assign(document.createElement('p'), { className: 'none', textContent: 'Nobody by that name.' })]),
  );
}

function openPicker(open: boolean) {
  picker.hidden = !open;
  whoButton.setAttribute('aria-expanded', String(open));
  if (!open) return;
  search.value = '';
  fillPicker();
  search.focus();
}
whoButton.onclick = () => openPicker(picker.hidden === true);
search.oninput = () => fillPicker();
// Enter picks the only match; Escape closes.
search.onkeydown = (e) => {
  if (e.key === 'Escape') openPicker(false);
  if (e.key !== 'Enter') return;
  const buttons = whoList.querySelectorAll<HTMLButtonElement>('.grid button');
  if (buttons.length === 1) buttons[0].click();
};
addEventListener('pointerdown', (e) => {
  if (!picker.hidden && !(e.target as Element).closest('.who')) openPicker(false);
});

// --- what's shown: which worlds, and which kinds of happening ---------------------------------------------

/** Kinds of happening, from the server's history types; anything new counts as creature doings. */
const KINDS = [
  { id: 'family', label: '🍼 Eggs & babies', types: ['egg', 'hatch', 'grown'] },
  { id: 'birthdays', label: '🎂 Birthdays', types: ['birthday'] },
  { id: 'explorers', label: '🧭 Explorers & travels', types: ['explorer', 'travels'] },
  { id: 'doings', label: '🐟 Creature doings', types: ['school', 'scare', 'chase', 'feed', 'documentary', 'night-out'] },
  { id: 'new', label: '🎨 New drawings & worlds', types: ['joined', 'pack', 'world', 'update'] },
  { id: 'visitors', label: '🛸 Visitors', types: ['visitor'] },
  { id: 'weather', label: '🌦️ Weather & days', types: ['weather', 'night', 'morning', 'holiday', 'blacklight'] },
] as const;
type KindId = (typeof KINDS)[number]['id'];
const kindOf = (type: string): KindId => KINDS.find((k) => (k.types as readonly string[]).includes(type))?.id ?? 'doings';

const SHOWN_KEY = 'doodlearium.history.shown';
/** Visitors and weather are most of the history, so they start hidden. */
let hiddenKinds = new Set<KindId>(['visitors', 'weather']);
/** Worlds left out (none: every world). */
let hiddenWorlds = new Set<string>();
try {
  const saved = JSON.parse(localStorage.getItem(SHOWN_KEY) ?? 'null') as { kinds?: KindId[]; worlds?: string[] } | null;
  if (saved?.kinds) hiddenKinds = new Set(saved.kinds);
  if (saved?.worlds) hiddenWorlds = new Set(saved.worlds);
} catch {}
const saveShown = () => {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify({ kinds: [...hiddenKinds], worlds: [...hiddenWorlds] }));
  } catch {}
};

/** Whether a happening is shown: its kind is on, and it's in a world that's on (or happened everywhere). */
const isShown = (e: HistoryEntry) => !hiddenKinds.has(kindOf(e.type)) && (!placeById(e.place) || !hiddenWorlds.has(worldOf(e.place).id));
const shownEntries = () => entries.filter(isShown);

function chip(label: string, on: boolean, toggle: () => void) {
  const b = Object.assign(document.createElement('button'), { className: 'chip', textContent: label });
  b.setAttribute('aria-pressed', String(on));
  b.onclick = () => {
    toggle();
    saveShown();
    renderChips();
    render();
  };
  return b;
}

const flip = <T,>(set: Set<T>, value: T) => (set.has(value) ? set.delete(value) : set.add(value));

function renderChips() {
  const worlds = allWorlds();
  const worldChips = $<HTMLDivElement>('#world-chips');
  worldChips.hidden = worlds.length < 2;
  worldChips.replaceChildren(
    Object.assign(document.createElement('span'), { className: 'chips-label', textContent: 'Worlds' }),
    ...worlds.map((w) => chip(`${w.icon} ${w.name}`, !hiddenWorlds.has(w.id), () => flip(hiddenWorlds, w.id))),
  );
  $<HTMLDivElement>('#kind-chips').replaceChildren(
    Object.assign(document.createElement('span'), { className: 'chips-label', textContent: 'Show' }),
    ...KINDS.map((k) => chip(k.label, !hiddenKinds.has(k.id), () => flip(hiddenKinds, k.id))),
  );
}

const dayTitle = (at: number) => new Date(at).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Newest day first; each day reads in order, like a diary. Hidden happenings fold into quiet lines. */
function render() {
  const days = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const key = new Date(e.at).toDateString();
    days.set(key, [...(days.get(key) ?? []), e]);
  }
  empty.hidden = entries.some(isShown);
  empty.textContent = entries.length
    ? 'Nothing to show on these days with those choices. Try turning on more of the kinds above.'
    : 'Nothing has happened on these days yet. Give it time, or feed the fish!';
  timeline.replaceChildren(
    ...[...days.values()]
      .reverse()
      .filter((list) => list.some(isShown))
      .map((list) => {
        const section = document.createElement('section');
        section.className = 'day';
        const h = document.createElement('h2');
        h.textContent = dayTitle(list[0].at);
        section.append(h);
        let run: HistoryEntry[] = [];
        const fold = () => {
          if (run.length) section.append(folded(run));
          run = [];
        };
        for (const e of list) {
          if (isShown(e)) {
            fold();
            section.append(eventRow(e));
          } else run.push(e);
        }
        fold();
        return section;
      }),
  );
}

/** "＋ 6 more: 🛸 visitors, 🌦️ weather and days": tap to turn those kinds on. */
function folded(run: HistoryEntry[]) {
  const kinds = [...new Set(run.map((e) => kindOf(e.type)))].filter((k) => hiddenKinds.has(k));
  const names = kinds.map((k) => KINDS.find((x) => x.id === k)!.label.toLowerCase().replace(/&/g, 'and'));
  const b = Object.assign(document.createElement('button'), {
    className: 'folded',
    textContent: `＋ ${run.length} more${names.length ? `: ${names.join(', ')}` : ' in other worlds'}`,
    title: kinds.length ? 'Show these kinds' : 'Turn the other worlds back on to see these',
  });
  b.onclick = () => {
    if (kinds.length) for (const k of kinds) hiddenKinds.delete(k);
    else hiddenWorlds.clear();
    saveShown();
    renderChips();
    render();
  };
  return b;
}

function eventRow(e: HistoryEntry) {
  const row = document.createElement('div');
  row.className = 'event';
  const time = document.createElement('time');
  time.textContent = clock(e.at);
  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = e.text;
  const thumbs = document.createElement('div');
  thumbs.className = 'thumbs';
  for (const id of e.who.slice(0, 3)) {
    const d = drawings.get(id);
    if (!d) continue;
    const img = Object.assign(document.createElement('img'), { src: imageUrl(d), alt: d.name, title: `${d.name} by ${d.artist}: tap to see just its story`, loading: 'lazy' });
    // Tap a face to see just that creature's story.
    img.style.cursor = 'pointer';
    img.onclick = () => {
      pick(id);
      scrollTo({ top: 0, behavior: 'smooth' });
    };
    thumbs.append(img);
  }
  row.append(time, thumbs, text);
  return row;
}

for (const input of [fromInput, toInput]) input.onchange = () => void load();


// --- making a story ----------------------------------------------------------------------------------

const STYLES: Record<Motion, string> = {
  fish: 'a fish',
  puffer: 'a puffer fish (puffs up into a spiky ball)',
  eel: 'an eel',
  jelly: 'a jellyfish',
  seahorse: 'a seahorse',
  flapper: 'a glider (sails along like a ray or a turtle)',
  vessel: 'a little submarine or boat (tidies up food from the sand)',
  crawler: 'a crawler that walks the sand (a crab, snail, starfish...)',
  plant: 'a plant',
  decor: 'a decoration',
  walker: 'an animal that walks about on land',
  hopper: 'an animal that hops about on land',
  slitherer: 'an animal that slithers along the ground',
  flier: 'a flying animal',
  waterfowl: 'a water bird that flies and paddles about on the water (a duck, goose or swan)',
};

function describe(d: Drawing) {
  // Drawings from the packs that come with Doodlearium are signed "Doodlearium", not by someone in the family.
  const by = d.artist === 'Doodlearium' ? 'one of the creatures that came with Doodlearium' : `drawn by ${d.artist}`;
  const bits = [`${d.name}: ${STYLES[motionOf(d)]}, ${by}`];
  if (d.explorer) bits.push('an explorer: the only one of its kind, who travels from place to place and world to world and puts on a show wherever it arrives');
  if (d.parents) bits.push(`baby of ${d.parents.map((id) => drawings.get(id)?.name ?? 'a creature that has since left').join(' and ')}`);
  if (d.nocturnal) bits.push('only comes out at night');
  if (d.glow) bits.push('has glowing paint');
  const where = population[d.id];
  if (where?.home) bits.push(`${d.name} lives at ${placeName(where.home)}`);
  const others = Object.entries(where?.places ?? {}).reduce((n, [, count]) => n + count, 0) - 1;
  if (others > 0) {
    const places = Object.keys(where!.places).map(placeName).join(', ');
    bits.push(`there ${others === 1 ? 'is 1 more' : `are ${others} more`} of its kind around the world (at ${places}), called "a ${d.name}"`);
  }
  const days = Math.max(0, Math.floor((Date.now() - d.createdAt) / DAY));
  bits.push(days < 1 ? 'new to the world' : `in the world for ${days} day${days === 1 ? '' : 's'}`);
  return `- ${bits.join('; ')}`;
}

const BIOME_WORDS: Record<string, string> = {
  lake: 'a sparkling lake',
  pond: 'a small, green lily pond with reeds',
  ocean: 'the big, deep ocean',
  seashore: 'the shallow sea by a sandy beach',
  meadow: 'a sunny meadow of long grass and wildflowers, with a little pond at one side',
  farm: 'a farm with a red barn, a fence, hay bales and a ploughed field',
  hills: 'green rolling hills',
  forest: 'quiet woods full of tall trees, ferns and toadstools',
  space: 'open space among the stars, with drifting asteroids and swirly nebula clouds, where creatures float as if swimming',
  station: 'a space station, a city under a big roof with glowing signs, market stalls and windows onto the stars',
  moon: 'a rocky moon with craters and a big planet in the sky, where hoppers bounce high and slow',
  garden: 'an alien garden of giant glowing plants and floating spores under two suns',
};

/** The places a story happens in, with the world each is in. */
function describePlace(id: string) {
  const p = placeById(id)!;
  const world = worldOf(id);
  const look = lookOf(p.biome, p.look);
  const region = world.regions.length > 1 ? world.regions.find((r) => r.id === p.region)?.name : undefined;
  const kind = `${BIOME_WORDS[p.biome] ?? p.biome}${look ? ` (${look.name.toLowerCase()})` : ''}`;
  return `- ${p.name}, in the ${world.name} world${region ? `, ${region}` : ''}: ${kind}`;
}

function storyPrompt() {
  // What's shown is what the story's about (visitors left out if they're hidden, say).
  const entries = shownEntries();
  // The days that actually have happenings in them.
  const from = entries[0].at;
  const to = entries[entries.length - 1].at;
  const cast = new Set(entries.flatMap((e) => e.who));
  const people = [...cast].map((id) => drawings.get(id)).filter((d): d is Drawing => Boolean(d));
  const star = who ? drawings.get(who) : undefined;
  const span = dayTitle(from) === dayTitle(to) ? `on ${dayTitle(from)}` : `from ${dayTitle(from)} to ${dayTitle(to)}`;
  const places = [...new Set(entries.map((e) => e.place).filter((p) => placeById(p)))];
  const worlds = [...new Set(places.map((p) => worldOf(p).name))];
  const these = worlds.length > 1 ? `This story visits ${worlds.length} worlds: ${worlds.slice(0, -1).join(', ')} and ${worlds.at(-1)}.` : worlds.length ? `This story happens in the ${worlds[0]} world.` : '';
  const family = people.some((d) => d.artist !== 'Doodlearium');
  return [
    `Please write a short story for a young reader about what happened in Doodlearium, our family's world of drawings, ${span}.`,
    '',
    "Doodlearium is a living picture on our TV made of whole worlds you can travel between in a little rocket, each with its own places to zoom into (the ones in this story are described below). Creatures swim, walk, hop and fly there, grow up, make friends, lay eggs and visit each other's places. Day turns to night, the seasons change, and the weather comes and goes.",
    family ? "Most of the creatures were drawn by someone in our family (the artist's name is given), so they'll love seeing their creatures as characters. A few came with Doodlearium itself." : "These creatures came with Doodlearium itself, ready for our family to meet.",
    'Each drawing is a kind of creature: the one that was drawn has its own name, and there can be more of its kind around, called things like "a Clowny". Explorers are different: there is only ever one of each, and they travel between places and worlds putting on shows.',
    these,
    star ? `The story is about ${star.name}.` : '',
    '',
    'Please:',
    '- Make it about 600 to 900 words, in short paragraphs, with words a young reader can mostly read on their own.',
    '- Use the real events below in order, and fill in the gaps with gentle, funny, curious moments. It is fine to imagine what the creatures were thinking.',
    '- Give each creature a bit of personality that matches what it did.',
    '- Keep it kind: chases end with everyone safe, nobody gets eaten except fish food and seeds.',
    ...(worlds.length > 1 ? ['- When the story moves to another world, show the trip (a rocket ride, a zoom across the stars).'] : []),
    '- Put the title on the first line.',
    '',
    'The places:',
    ...places.map(describePlace),
    '',
    'The creatures:',
    ...people.map(describe),
    '',
    'What happened:',
    ...entries.map((e) => `- ${new Date(e.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}: ${e.text}`),
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n');
}

const promptPanel = $<HTMLElement>('#prompt-panel');
const promptText = $<HTMLTextAreaElement>('#prompt');
const promptStatus = $<HTMLSpanElement>('#prompt-status');
const storyPanel = $<HTMLElement>('#story-panel');

$<HTMLButtonElement>('#make-prompt').onclick = () => {
  if (!shownEntries().length) {
    promptPanel.hidden = false;
    promptText.value = '';
    promptStatus.textContent = 'Nothing happened on these days to tell a story about. Try more days.';
    return;
  }
  storyPanel.hidden = true;
  promptPanel.hidden = false;
  promptText.value = storyPrompt();
  promptStatus.textContent = '';
  promptPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
$<HTMLButtonElement>('#close-prompt').onclick = () => (promptPanel.hidden = true);

$<HTMLButtonElement>('#copy-prompt').onclick = async () => {
  try {
    // The clipboard needs a secure page (localhost is; the TV's network address isn't), so fall back.
    await navigator.clipboard.writeText(promptText.value);
  } catch {
    promptText.select();
    document.execCommand('copy');
  }
  promptStatus.textContent = '📋 Copied! Paste it to Claude.';
};

$<HTMLButtonElement>('#add-story').onclick = () => {
  promptPanel.hidden = true;
  storyPanel.hidden = false;
  $<HTMLSpanElement>('#story-status').textContent = '';
  storyPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $<HTMLTextAreaElement>('#story-text').focus();
};
$<HTMLButtonElement>('#close-story').onclick = () => (storyPanel.hidden = true);

$<HTMLButtonElement>('#save-story').onclick = async () => {
  const status = $<HTMLSpanElement>('#story-status');
  const textArea = $<HTMLTextAreaElement>('#story-text');
  const titleInput = $<HTMLInputElement>('#story-title');
  let text = textArea.value.trim();
  if (!text) {
    status.textContent = 'Paste the story in first.';
    return;
  }
  let title = titleInput.value.trim();
  if (!title) {
    // The prompt asks for the title on the first line (maybe as a markdown heading).
    const [first, ...rest] = text.split('\n');
    title = first.replace(/^[#*\s]+|[*\s]+$/g, '').slice(0, 120);
    text = rest.join('\n').trim() || text;
  }
  // Kept with the days it tells of (or the days picked, if there's nothing in them).
  const from = entries[0]?.at ?? range().from;
  const to = entries.at(-1)?.at ?? range().to;
  try {
    await saveStory({ title, text, from, to });
    textArea.value = '';
    titleInput.value = '';
    storyPanel.hidden = true;
    await loadStories();
  } catch (err) {
    status.textContent = `Couldn't save it: ${(err as Error).message}`;
  }
};

async function loadStories() {
  const stories = await fetchStories();
  $<HTMLElement>('#stories-section').hidden = !stories.length;
  $<HTMLDivElement>('#stories').replaceChildren(...stories.map(storyCard));
}

function storyCard(s: Story) {
  const details = document.createElement('details');
  details.className = 'story';
  const summary = document.createElement('summary');
  const when = new Date(s.from).toDateString() === new Date(s.to).toDateString()
    ? dayTitle(s.from)
    : `${dayTitle(s.from)} – ${dayTitle(s.to)}`;
  summary.append(s.title, Object.assign(document.createElement('small'), { textContent: when }));
  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = s.text;
  details.append(summary, text);
  return details;
}

// New happenings show up as they happen, if they're in the days being looked at.
connectLive((msg) => {
  if (msg.type === 'drawing:added' || msg.type === 'drawing:updated') {
    drawings.set(msg.drawing.id, msg.drawing);
    fillWho();
  }
  if (msg.type !== 'history') return;
  const { from, to } = range();
  const e = msg.entry;
  if (e.at < from || (toInput.value !== dateValue(new Date()) && e.at > to) || (who && !e.who.includes(who))) return;
  entries.push(e);
  render();
});

renderChips();
fillWho();
await load();
fillWho();
await loadStories();
