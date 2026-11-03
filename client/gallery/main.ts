import { imageUrl, type CreatureType, type Drawing, type Pack, type PackFile, type SpeciesWhere } from '../../shared/types.ts';
import { BIOME_NAMES } from '../../shared/world/biomes.ts';
import { allWorlds, placeById, worldById } from '../../shared/world/places.ts';
import {
  changePack,
  connectLive,
  deleteDrawing,
  exportPack,
  fetchDrawings,
  fetchPacks,
  fetchPopulation,
  installPack,
  loadWorlds,
  makePack,
  removePack,
  setupFeedButton,
} from '../shared/api.ts';
import { compareVersions } from '../shared/versions.ts';

// Which worlds (and places) there are, before anything looks a place up.
await loadWorlds().catch(() => {});

setupFeedButton(document.querySelector<HTMLButtonElement>('#feed')!);

const FILTERS: { label: string; type: CreatureType | 'baby' | null }[] = [
  { label: 'Everything', type: null },
  { label: '🐟 Swimmers', type: 'swimmer' },
  { label: '🦀 Crawlers', type: 'crawler' },
  { label: '🐕 Land animals', type: 'walker' },
  { label: '🐦 Fliers', type: 'flier' },
  { label: '🌿 Plants', type: 'plant' },
  { label: '🪨 Decorations', type: 'decor' },
  { label: '🐣 Babies', type: 'baby' },
];

const grid = document.querySelector<HTMLDivElement>('#grid')!;
const empty = document.querySelector<HTMLParagraphElement>('#empty')!;
const filtersEl = document.querySelector<HTMLDivElement>('#filters')!;

let drawings: Drawing[] = [];
let population: Record<string, SpeciesWhere> = {};
let filter: CreatureType | 'baby' | null = null;
let packs: Pack[] = [];
/** Showing only one pack's drawings. */
let packFilter: string | null = null;
/** Choosing drawings for a pack: which pack (null: a new one) and which are ticked. */
let choosing: { pack: Pack | null; chosen: Set<string> } | null = null;

const filterButtons = FILTERS.map(({ label, type }) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => {
    filter = type;
    render();
  };
  filtersEl.append(b);
  return b;
});

const packFilterButton = document.createElement('button');
packFilterButton.setAttribute('aria-pressed', 'true');
packFilterButton.title = 'Show every pack again';
packFilterButton.onclick = () => {
  packFilter = null;
  render();
};
filtersEl.append(packFilterButton);

/** The drawings the filters show, newest first. */
function shownDrawings() {
  const pack = packs.find((p) => p.id === packFilter);
  return drawings
    .filter((d) => !filter || (filter === 'baby' ? !!d.parents : d.type === filter))
    .filter((d) => !pack || pack.drawings.includes(d.id))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function render() {
  filterButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(FILTERS[i].type === filter)));
  const pack = packs.find((p) => p.id === packFilter);
  packFilterButton.hidden = !pack;
  if (pack) packFilterButton.textContent = `📦 ${pack.name} ✕`;
  empty.hidden = drawings.length > 0;
  grid.classList.toggle('choosing', !!choosing);
  grid.replaceChildren(...shownDrawings().map(card));
  renderPacks();
  renderChooser();
}

function card(d: Drawing) {
  const el = document.createElement('article');
  el.className = 'card';
  if (choosing) {
    // Choosing drawings for a pack: a tap ticks it (or unticks it).
    const chosen = choosing.chosen;
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.className = 'tick';
    tick.tabIndex = -1;
    tick.checked = chosen.has(d.id);
    el.classList.toggle('chosen', tick.checked);
    el.tabIndex = 0;
    el.setAttribute('role', 'checkbox');
    el.setAttribute('aria-checked', String(tick.checked));
    const toggle = () => {
      if (chosen.has(d.id)) chosen.delete(d.id);
      else chosen.add(d.id);
      tick.checked = chosen.has(d.id);
      el.classList.toggle('chosen', tick.checked);
      el.setAttribute('aria-checked', String(tick.checked));
      renderChooser();
    };
    el.onclick = toggle;
    el.onkeydown = (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      toggle();
    };
    el.append(tick);
  }
  const art = document.createElement('div');
  art.className = 'art';
  const img = document.createElement('img');
  img.src = imageUrl(d);
  img.alt = d.name;
  img.loading = 'lazy';
  art.append(img);

  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = `${d.name}${d.nocturnal ? ' 🌙' : ''}${d.explorer ? ' 🧭' : ''}`;
  name.title = [d.nocturnal && 'Night creature: only comes out after dark', d.explorer && 'Explorer: travels from place to place, and puts on a show wherever it arrives'].filter(Boolean).join('. ');
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `by ${d.artist} · ${new Date(d.createdAt).toLocaleDateString()}`;
  const lines: HTMLElement[] = [name, meta];
  if (d.parents) {
    const names = d.parents.map((id) => drawings.find((p) => p.id === id)?.name ?? 'a fish that has gone');
    const baby = document.createElement('div');
    baby.className = 'meta';
    baby.textContent = `${(d.hatchAt ?? 0) > Date.now() ? '🥚 Hatching soon!' : '🐣'} Baby of ${names.join(' & ')}`;
    lines.push(baby);
  }
  const where = population[d.id];
  if (where) {
    // Where it lives: the original's place first (🏠), then wherever else there are more of it.
    const places = Object.entries(where.places).sort(([a, x], [b, y]) => Number(b === where.home) - Number(a === where.home) || y - x);
    const line = document.createElement('div');
    line.className = 'meta where';
    line.textContent = places
      .map(([id, n]) => {
        const p = placeById(id);
        const icon = p ? BIOME_NAMES[p.biome].split(' ')[0] : '';
        // An explorer is only ever passing through.
        const mark = id !== where.home ? '' : d.explorer ? ' (exploring) 🧭' : ' 🏠';
        return `${icon} ${p?.name ?? id}${n > 1 ? ` ×${n}` : ''}${mark}`;
      })
      .join(' · ');
    lines.push(line);
  }
  const inPacks = packs.filter((p) => p.drawings.includes(d.id));
  if (inPacks.length) {
    const line = document.createElement('div');
    line.className = 'meta';
    line.textContent = inPacks.map((p) => `📦 ${p.name}`).join(' · ');
    lines.push(line);
  }
  if (allWorlds().length > 1) {
    // Which worlds it lives in: its own choice, else its packs', else Earth.
    const own = d.worlds?.length ? d.worlds : [...new Set(inPacks.flatMap((p) => p.worlds ?? []))];
    const line = document.createElement('div');
    line.className = 'meta';
    line.textContent =
      // An explorer with no worlds picked visits them all.
      d.explorer && !own.length
        ? '🌌 Every world'
        : (own.length ? own : ['earth']).map((id) => worldById(id)).filter((w) => !!w).map((w) => `${w.icon} ${w.name}`).join(' · ');
    if (d.worlds?.length) line.title = 'Chosen for this drawing on the Draw page';
    lines.push(line);
  }

  const remove = document.createElement('button');
  remove.textContent = 'Remove';
  remove.onclick = async () => {
    if (!confirm(`Remove "${d.name}" from the world for good?`)) return;
    remove.disabled = true;
    try {
      await deleteDrawing(d.id);
      drawings = drawings.filter((x) => x.id !== d.id);
      render();
    } catch (err) {
      remove.disabled = false;
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const edit = document.createElement('a');
  edit.className = 'button';
  edit.href = `/draw/?edit=${d.id}`;
  edit.textContent = '✏️ Edit';
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(edit, remove);

  el.append(art, ...lines, actions);
  return el;
}

// --- 📦 drawing packs ---------------------------------------------------------------------------------------

const packList = document.querySelector<HTMLDivElement>('#pack-list')!;
const packsNote = document.querySelector<HTMLParagraphElement>('#packs-note')!;
const packFile = document.querySelector<HTMLInputElement>('#pack-file')!;
const chooser = document.querySelector<HTMLDivElement>('#choose')!;
const chooseName = document.querySelector<HTMLInputElement>('#choose-name')!;
const chooseVersion = document.querySelector<HTMLInputElement>('#choose-version')!;
const chooseCount = document.querySelector<HTMLSpanElement>('#choose-count')!;
const chooseSave = document.querySelector<HTMLButtonElement>('#choose-save')!;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const problem = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

function renderPacks() {
  packList.replaceChildren(
    ...packs
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((pack) => {
        const row = document.createElement('div');
        row.className = 'pack';
        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = pack.name;
        const version = document.createElement('span');
        version.className = 'version';
        version.textContent = `v${pack.version}`;
        const meta = document.createElement('span');
        meta.className = 'meta';
        const notes = [plural(pack.drawings.length, 'drawing'), pack.installed ? 'installed' : 'made here'];
        if (pack.exported && pack.changed) notes.push('✨ changed since it was exported');
        meta.textContent = notes.join(' · ');

        const button = (text: string, hint: string, onclick: () => void) => {
          const b = document.createElement('button');
          b.textContent = text;
          b.title = hint;
          b.onclick = onclick;
          return b;
        };
        const show = button(packFilter === pack.id ? '👀 Showing' : '👀 Show', 'Show only the drawings in this pack', () => {
          packFilter = packFilter === pack.id ? null : pack.id;
          render();
        });
        show.setAttribute('aria-pressed', String(packFilter === pack.id));
        const change = button('✏️ Change', 'Choose which drawings are in it, or rename it', () => startChoosing(pack));
        // Which worlds its drawings live in (unless a drawing has its own choice): a row of world chips.
        const homes = pack.worlds?.length ? pack.worlds : ['earth'];
        const worldsButton = button(
          homes.map((id) => worldById(id)?.icon ?? '').join(''),
          `Lives in: ${homes.map((id) => worldById(id)?.name ?? id).join(', ')}. Choose which worlds its drawings live in`,
          () => {
            worldsOpen = worldsOpen === pack.id ? null : pack.id;
            renderPacks();
          },
        );
        worldsButton.setAttribute('aria-expanded', String(worldsOpen === pack.id));
        if (allWorlds().length < 2) worldsButton.hidden = true;
        const nextUp = pack.exported && pack.changed ? ' (as a new version)' : '';
        const share = button('⬆️ Export', `Save it as a file to share${nextUp}`, async () => {
          share.disabled = true;
          try {
            await exportPack(pack.id);
            packsNote.textContent = `⬆️ Saved ${pack.name} to a file: send it to whoever you'd like to share it with.`;
          } catch (err) {
            packsNote.textContent = problem(err, 'Exporting failed.');
          } finally {
            share.disabled = false;
          }
        });
        const remove = button(
          pack.installed ? '🗑️ Uninstall' : '🗑️ Take apart',
          pack.installed ? 'Remove this pack and the drawings it brought' : 'Forget this pack (its drawings stay)',
          async () => {
            const sure = pack.installed
              ? `Uninstall ${pack.name}? The drawings it brought leave the world for good (ones you drew, or that another pack has too, stay).`
              : `Take ${pack.name} apart? Its drawings stay; only the pack goes.`;
            if (!confirm(sure)) return;
            remove.disabled = true;
            try {
              const removed = await removePack(pack.id);
              if (packFilter === pack.id) packFilter = null;
              packsNote.textContent = pack.installed ? `🗑️ Uninstalled ${pack.name} (${plural(removed, 'drawing')} went with it).` : `🗑️ ${pack.name} was taken apart.`;
              await refreshPacks();
            } catch (err) {
              remove.disabled = false;
              packsNote.textContent = problem(err, 'Removing the pack failed.');
            }
          },
        );
        remove.className = 'danger';
        row.append(title, version, meta, worldsButton, show, change, share, remove);
        if (worldsOpen === pack.id && allWorlds().length > 1) row.append(worldChips(pack, homes));
        return row;
      }),
  );
}

/** The pack whose world chips are open. */
let worldsOpen: string | null = null;

/** A chip for every world: tap to add the pack's drawings to it, or take them out (one world at least). */
function worldChips(pack: Pack, homes: string[]) {
  const chips = document.createElement('div');
  chips.className = 'world-chips';
  chips.append(Object.assign(document.createElement('span'), { className: 'meta', textContent: 'Lives in:' }));
  for (const w of allWorlds()) {
    const on = homes.includes(w.id);
    const chip = document.createElement('button');
    chip.textContent = `${on ? '✓ ' : ''}${w.icon} ${w.name}`;
    chip.setAttribute('aria-pressed', String(on));
    chip.disabled = on && homes.length === 1;
    chip.title = chip.disabled ? 'It has to live somewhere' : on ? `Take it out of ${w.name}` : `Its drawings move into ${w.name} too`;
    chip.onclick = async () => {
      const next = on ? homes.filter((id) => id !== w.id) : [...homes, w.id];
      chip.disabled = true;
      try {
        await changePack(pack.id, { worlds: next });
        const names = next.map((id) => worldById(id)?.name ?? id);
        const listed = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
        packsNote.textContent = `🌍 ${pack.name} lives in ${listed} now (drawings with their own worlds chosen stay where they are).`;
        await refreshPacks();
        refreshPopulationSoon();
      } catch (err) {
        packsNote.textContent = problem(err, 'Changing its worlds failed.');
        chip.disabled = false;
      }
    };
    chips.append(chip);
  }
  return chips;
}

function startChoosing(pack: Pack | null) {
  choosing = { pack, chosen: new Set(pack?.drawings ?? []) };
  chooseName.value = pack?.name ?? '';
  chooseVersion.value = pack?.version ?? '1';
  chooseVersion.hidden = !pack;
  if (pack) packFilter = null;
  render();
  chooser.scrollIntoView({ block: 'nearest' });
  chooseName.focus();
}

function renderChooser() {
  chooser.hidden = !choosing;
  if (!choosing) return;
  const n = choosing.chosen.size;
  chooseCount.textContent = n ? `${plural(n, 'drawing')} chosen` : 'Tap drawings to choose them';
  chooseSave.disabled = n === 0;
}

const stopChoosing = () => {
  choosing = null;
  render();
};

document.querySelector<HTMLButtonElement>('#pack-new')!.onclick = () => startChoosing(null);
document.querySelector<HTMLButtonElement>('#choose-cancel')!.onclick = stopChoosing;
document.querySelector<HTMLButtonElement>('#choose-all')!.onclick = () => {
  for (const d of shownDrawings()) choosing?.chosen.add(d.id);
  render();
};
document.querySelector<HTMLButtonElement>('#choose-none')!.onclick = () => {
  for (const d of shownDrawings()) choosing?.chosen.delete(d.id);
  render();
};
chooseSave.onclick = async () => {
  if (!choosing) return;
  const { pack, chosen } = choosing;
  const name = chooseName.value.trim() || 'My pack';
  chooseSave.disabled = true;
  try {
    const ids = [...chosen].filter((id) => drawings.some((d) => d.id === id));
    if (pack) await changePack(pack.id, { name, version: chooseVersion.value.trim() || pack.version, drawings: ids });
    else await makePack(name, ids);
    packsNote.textContent = `💾 Saved ${name}. Press ⬆️ Export to make a file of it to share.`;
    choosing = null;
    await refreshPacks();
  } catch (err) {
    packsNote.textContent = problem(err, 'Saving the pack failed.');
    renderChooser();
  }
};

document.querySelector<HTMLButtonElement>('#pack-install')!.onclick = () => packFile.click();
packFile.onchange = async () => {
  const file = packFile.files?.[0];
  packFile.value = '';
  if (!file) return;
  let text: string;
  let pack: PackFile;
  try {
    text = await file.text();
    pack = JSON.parse(text);
    if (pack?.format !== 'doodlearium-pack' || !Array.isArray(pack.drawings)) throw new Error();
  } catch {
    packsNote.textContent = `${file.name} isn't a Doodlearium drawing pack.`;
    return;
  }
  // What it'll do here: which drawings are new, which it updates, and which it takes out.
  const keyOf = (d: Drawing) => d.origin ?? d.id;
  const keys = new Set(pack.drawings.map((d) => d.key));
  const updates = drawings.filter((d) => keys.has(keyOf(d))).length;
  const had = packs.find((p) => p.id === pack.id);
  const others = new Set(packs.filter((p) => p !== had).flatMap((p) => p.drawings));
  const leaving = had ? drawings.filter((d) => had.drawings.includes(d.id) && d.origin && !keys.has(keyOf(d)) && !others.has(d.id)).length : 0;
  const fresh = pack.drawings.length - updates;
  const what = [fresh && plural(fresh, 'new drawing'), updates && `${updates} updated`, leaving && `${leaving} taken out`]
    .filter(Boolean)
    .join(', ');
  let ask = `Install ${pack.name} (version ${pack.version})? ${what}.`;
  if (had) {
    const newer = compareVersions(pack.version, had.version);
    ask =
      newer > 0
        ? `Update ${had.name} from version ${had.version} to ${pack.version}? ${what}.`
        : newer === 0
          ? `You already have version ${had.version} of ${had.name}. Install it again? ${what}.`
          : `This is version ${pack.version} of ${had.name}, older than the version ${had.version} you have. Install it anyway? ${what}.`;
  }
  if (!confirm(ask)) return;
  packsNote.textContent = `📥 Installing ${pack.name}…`;
  try {
    const done = await installPack(text);
    const parts = [done.added && `${done.added} new`, done.updated && `${done.updated} updated`, done.removed && `${done.removed} taken out`].filter(Boolean);
    packsNote.textContent = `📦 ${had ? 'Updated' : 'Installed'} ${done.pack.name} (version ${done.pack.version}): ${parts.join(', ') || 'nothing changed'}.`;
    await refresh();
  } catch (err) {
    packsNote.textContent = problem(err, 'Installing failed.');
  }
};

async function refreshPacks() {
  packs = await fetchPacks().catch(() => packs);
  if (choosing?.pack) choosing.pack = packs.find((p) => p.id === choosing!.pack!.id) ?? null;
  render();
}

async function refresh() {
  [drawings, population, packs] = await Promise.all([fetchDrawings(), fetchPopulation().catch(() => population), fetchPacks().catch(() => packs)]);
  render();
}

/** Who lives where changes as drawings come and go (and slowly by itself): look again shortly after. */
let populationTimer = 0;
function refreshPopulationSoon() {
  clearTimeout(populationTimer);
  populationTimer = window.setTimeout(async () => {
    population = await fetchPopulation().catch(() => population);
    render();
  }, 800);
}

void refresh();
connectLive(
  (msg) => {
    if (msg.type === 'drawing:added' || msg.type === 'drawing:updated') {
      drawings = [...drawings.filter((d) => d.id !== msg.drawing.id), msg.drawing];
    } else if (msg.type === 'drawing:removed') {
      drawings = drawings.filter((d) => d.id !== msg.id);
      choosing?.chosen.delete(msg.id);
    } else if (msg.type === 'packs' || msg.type === 'worlds') {
      void refreshPacks();
      return;
    } else {
      return;
    }
    render();
    refreshPopulationSoon();
  },
  () => void refresh(),
);
