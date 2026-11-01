import { imageUrl, motionOf, type Drawing, type HistoryEntry, type Motion, type SpeciesWhere, type Story } from '../../shared/types.ts';
import { REGIONS, placeById, placeName } from '../../shared/world/places.ts';
import { connectLive, fetchDrawings, fetchHistory, fetchPopulation, fetchStories, saveStory } from '../shared/api.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const fromInput = $<HTMLInputElement>('#from');
const toInput = $<HTMLInputElement>('#to');
const whoSelect = $<HTMLSelectElement>('#who');
const timeline = $<HTMLDivElement>('#timeline');
const empty = $<HTMLParagraphElement>('#empty');

const DAY = 86_400_000;
/** Every drawing, by id, for names and thumbnails. */
const drawings = new Map<string, Drawing>();
/** Where each species lives, for the story prompt. */
let population: Record<string, SpeciesWhere> = {};
let entries: HistoryEntry[] = [];

/** yyyy-mm-dd in local time, for date inputs. */
const dateValue = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOf = (value: string) => new Date(`${value}T00:00:00`).getTime();

/** The stretch of history picked: from the start of the first day to the end of the last. */
function range() {
  const from = fromInput.value ? startOf(fromInput.value) : 0;
  const to = toInput.value ? startOf(toInput.value) + DAY - 1 : Date.now();
  return { from, to, who: whoSelect.value || undefined };
}

const now = new Date();
toInput.value = dateValue(now);
fromInput.value = dateValue(new Date(now.getTime() - 6 * DAY));

async function load() {
  const [all, history] = await Promise.all([fetchDrawings(), fetchHistory(range())]);
  population = await fetchPopulation().catch(() => population);
  for (const d of all) drawings.set(d.id, d);
  entries = history;
  render();
}

function fillWho() {
  const chosen = whoSelect.value;
  const names = [...drawings.values()].filter((d) => !d.hatchAt || d.hatchAt < Date.now()).sort((a, b) => a.name.localeCompare(b.name));
  whoSelect.replaceChildren(
    new Option('Everyone', ''),
    ...names.map((d) => new Option(`${d.name} (by ${d.artist})`, d.id)),
  );
  whoSelect.value = chosen;
}

const dayTitle = (at: number) => new Date(at).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Newest day first; each day reads in order, like a diary. */
function render() {
  const days = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const key = new Date(e.at).toDateString();
    days.set(key, [...(days.get(key) ?? []), e]);
  }
  empty.hidden = entries.length > 0;
  timeline.replaceChildren(
    ...[...days.values()].reverse().map((list) => {
      const section = document.createElement('section');
      section.className = 'day';
      const h = document.createElement('h2');
      h.textContent = dayTitle(list[0].at);
      section.append(h, ...list.map(eventRow));
      return section;
    }),
  );
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
    const img = Object.assign(document.createElement('img'), { src: imageUrl(d), alt: d.name, title: `${d.name} by ${d.artist}`, loading: 'lazy' });
    thumbs.append(img);
  }
  row.append(time, thumbs, text);
  return row;
}

for (const input of [fromInput, toInput, whoSelect]) input.onchange = () => void load();

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
  decor: 'a decoration on the sand',
};

function describe(d: Drawing) {
  const bits = [`${d.name}: ${STYLES[motionOf(d)]}, drawn by ${d.artist}`];
  if (d.parents) bits.push(`baby of ${d.parents.map((id) => drawings.get(id)?.name ?? 'a fish that has since left').join(' and ')}`);
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
};

/** The places a story happens in. */
function describePlace(id: string) {
  const p = placeById(id)!;
  const region = REGIONS.find((r) => r.id === p.region)?.name;
  return `- ${p.name}: ${BIOME_WORDS[p.biome] ?? p.biome}${region ? `, in ${region}` : ''}`;
}

function storyPrompt() {
  const { who } = range();
  // The days that actually have happenings in them.
  const from = entries[0].at;
  const to = entries[entries.length - 1].at;
  const cast = new Set(entries.flatMap((e) => e.who));
  const people = [...cast].map((id) => drawings.get(id)).filter((d): d is Drawing => Boolean(d));
  const star = who ? drawings.get(who) : undefined;
  const span = dayTitle(from) === dayTitle(to) ? `on ${dayTitle(from)}` : `from ${dayTitle(from)} to ${dayTitle(to)}`;
  return [
    `Please write a short story for a young reader about what happened in our family's aquarium, Doodlearium, ${span}.`,
    '',
    "Doodlearium is a little underwater world on our TV, with a lake, a pond, the ocean and a beach. Every creature in it was drawn by someone in our family (the artist's name is given), so they'll love seeing their creatures as characters.",
    'Each drawing is a kind of creature: the one that was drawn has its own name, and there can be more of its kind around the world, called things like "a Clowny".',
    star ? `The story is about ${star.name}.` : '',
    '',
    'Please:',
    '- Make it about 600 to 900 words, in short paragraphs, with words a young reader can mostly read on their own.',
    '- Use the real events below in order, and fill in the gaps with gentle, funny, curious moments. It is fine to imagine what the creatures were thinking.',
    '- Give each creature a bit of personality that matches what it did.',
    '- Keep it kind: chases end with everyone safe, nobody gets eaten except fish food.',
    '- Put the title on the first line.',
    '',
    'The places:',
    ...[...new Set(entries.map((e) => e.place).filter((p) => placeById(p)))].map(describePlace),
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
  if (!entries.length) {
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
  const { from, to, who } = range();
  const e = msg.entry;
  if (e.at < from || (toInput.value !== dateValue(new Date()) && e.at > to) || (who && !e.who.includes(who))) return;
  entries.push(e);
  render();
});

await load();
fillWho();
await loadStories();
