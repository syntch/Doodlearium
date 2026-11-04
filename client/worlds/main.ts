import type { WorldFile, WorldPack } from '../../shared/types.ts';
import { BIOMES, BIOME_NAMES, type Biome } from '../../shared/world/biomes.ts';
import { LOOKS } from '../../shared/world/looks.ts';
import { MAP_H, MAP_W, type MapStyle, type WorldDef } from '../../shared/world/places.ts';
import { changeWorld, connectLive, exportWorld, installWorld, loadWorlds, makeWorld, removeWorld, switchOff, type WorldChange } from '../shared/api.ts';
import { compareVersions } from '../../shared/versions.ts';
import { createMapPanel } from '../tank/mappanel.ts';

/**
 * The worlds page: every world on this server, with ✏️ Change, ⬆️ Export and 🗑️ Uninstall, like the gallery's
 * drawing packs, and the world maker: name it, pick its map's style, add places and drag them about.
 */

const MAX_PLACES = 16;
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const list = $<HTMLDivElement>('#list');
const note = $<HTMLParagraphElement>('#note');
const file = $<HTMLInputElement>('#file');
const editor = $<HTMLElement>('#editor');
const editorTitle = $<HTMLHeadingElement>('#editor-title');
const editorNote = $<HTMLParagraphElement>('#editor-note');
const iconInput = $<HTMLInputElement>('#icon');
const nameInput = $<HTMLInputElement>('#name');
const versionInput = $<HTMLInputElement>('#version');
const stylesEl = $<HTMLDivElement>('#styles');
const placesEl = $<HTMLDivElement>('#places');
const saveButton = $<HTMLButtonElement>('#save');
const addButton = $<HTMLButtonElement>('#add');

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const problem = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

let worlds: WorldPack[] = [];

// --- 🌍 the list -------------------------------------------------------------------------------------------

function renderList() {
  list.replaceChildren(
    ...worlds.map((w) => {
      const row = document.createElement('div');
      row.className = 'world';
      row.classList.toggle('off', !!w.off);
      const title = Object.assign(document.createElement('span'), { className: 'title', textContent: `${w.icon} ${w.name}` });
      const version = Object.assign(document.createElement('span'), { className: 'version', textContent: `v${w.version}` });
      const notes = [plural(w.places.length, 'place'), w.builtin ? 'built in' : w.installed ? 'installed' : 'made here'];
      if (w.exported && w.changed) notes.push('✨ changed since it was exported');
      if (w.off) notes.push('💤 switched off: its places are closed');
      const meta = Object.assign(document.createElement('span'), { className: 'meta', textContent: notes.join(' · ') });
      const button = (text: string, hint: string, onclick: () => void) => Object.assign(document.createElement('button'), { textContent: text, title: hint, onclick });
      const visit = Object.assign(document.createElement('a'), { className: 'button', href: `/tank/?world=${encodeURIComponent(w.id)}`, textContent: '🚀 Visit', title: `See ${w.name}'s map` });
      row.append(title, version, meta);
      if (!w.builtin) {
        // Off and on again: kept, but its places close (and creatures that only live there are away) while it's off.
        const power = button(
          w.off ? '✅ Switch on' : '💤 Switch off',
          w.off ? 'Open its places again' : 'Keep it, but close its places for now',
          async () => {
            power.disabled = true;
            try {
              await switchOff('worlds', w.id, !w.off);
              note.textContent = w.off ? `✅ ${w.name} is back on: its places are open again.` : `💤 ${w.name} is switched off. Screens there go back to Earth, and creatures that only live there are away until it's back on.`;
              await refresh();
            } catch (err) {
              power.disabled = false;
              note.textContent = problem(err, 'Switching it failed.');
            }
          },
        );
        power.setAttribute('aria-pressed', String(!w.off));
        row.append(power);
      }
      if (!w.off) row.append(visit);
      if (!w.builtin) row.append(button('✏️ Change', 'Rename it, or change its places', () => startEditing(w)));
      const nextUp = w.exported && w.changed ? ' (as a new version)' : '';
      const share = button('⬆️ Export', `Save it as a file to share${nextUp}`, async () => {
        share.disabled = true;
        try {
          await exportWorld(w.id);
          note.textContent = `⬆️ Saved ${w.name} to a file: send it to whoever you'd like to share it with.`;
        } catch (err) {
          note.textContent = problem(err, 'Exporting failed.');
        } finally {
          share.disabled = false;
        }
      });
      row.append(share);
      if (!w.builtin) {
        const remove = button(w.installed ? '🗑️ Uninstall' : '🗑️ Take apart', 'Remove this world: its creatures move to places that suit them in other worlds', async () => {
          if (!confirm(`${w.installed ? 'Uninstall' : 'Take apart'} ${w.name}? Its ${plural(w.places.length, 'place')} close, and the creatures there move to other worlds.`)) return;
          remove.disabled = true;
          try {
            await removeWorld(w.id);
            note.textContent = `🗑️ ${w.name} is gone.`;
            if (editing?.id === w.id) stopEditing();
            await refresh();
          } catch (err) {
            remove.disabled = false;
            note.textContent = problem(err, 'Removing the world failed.');
          }
        });
        remove.className = 'danger';
        row.append(remove);
      }
      return row;
    }),
  );
}

async function refresh() {
  worlds = await loadWorlds(true).catch(() => worlds);
  renderList();
}

// --- 📥 installing ------------------------------------------------------------------------------------------

$<HTMLButtonElement>('#install').onclick = () => file.click();
file.onchange = async () => {
  const f = file.files?.[0];
  file.value = '';
  if (!f) return;
  let text: string;
  let world: WorldFile;
  try {
    text = await f.text();
    world = JSON.parse(text);
    if (world?.format !== 'doodlearium-world' || !Array.isArray(world.places)) throw new Error();
  } catch {
    note.textContent = `${f.name} isn't a Doodlearium world.`;
    return;
  }
  const had = worlds.find((w) => w.id === world.id);
  let ask = `Install ${world.name} (version ${world.version}, ${plural(world.places.length, 'place')})?`;
  if (had) {
    const newer = compareVersions(world.version, had.version);
    ask =
      newer > 0
        ? `Update ${had.name} from version ${had.version} to ${world.version}?`
        : newer === 0
          ? `You already have version ${had.version} of ${had.name}. Install it again?`
          : `This is version ${world.version} of ${had.name}, older than the version ${had.version} you have. Install it anyway?`;
  }
  if (!confirm(ask)) return;
  note.textContent = `📥 Installing ${world.name}…`;
  try {
    const done = await installWorld(text);
    const parts = [done.opened && `${plural(done.opened, 'place')} opened`, done.closed && `${plural(done.closed, 'place')} closed`].filter(Boolean);
    note.textContent = `🌍 ${done.updated ? 'Updated' : 'Installed'} ${done.world.name} (version ${done.world.version})${parts.length ? `: ${parts.join(', ')}` : ''}. Give it some drawing packs on the Gallery page so creatures move in.`;
    await refresh();
  } catch (err) {
    note.textContent = problem(err, 'Installing failed.');
  }
};

// --- ✏️ the world maker ------------------------------------------------------------------------------------

interface Draft {
  /** A place it had keeps its id (so its creatures stay); new ones get one when it's saved. */
  id?: string;
  /** For the map preview and the list while editing. */
  key: string;
  name: string;
  biome: Biome;
  x: number;
  y: number;
  look?: string;
}
let editing: { id: string | null; style: MapStyle; places: Draft[] } | null = null;
let picked: string | null = null;
let keys = 0;

const STYLES: [MapStyle, string][] = [['islands', '🏝️ Islands in a sea'], ['space', '🌌 Planets in space']];
/** The places' kinds, with space's first on a space map. */
const kindsFor = (style: MapStyle) => (style === 'space' ? [...BIOMES.filter((b) => LOOKS[b]), ...BIOMES.filter((b) => !LOOKS[b])] : [...BIOMES]);

const panel = await createMapPanel($('#map'));

function startEditing(w: WorldPack | null) {
  editing = {
    id: w?.id ?? null,
    style: w?.mapStyle === 'space' ? 'space' : 'islands',
    places: (w?.places ?? []).map((p) => ({ id: p.id, key: `k${keys++}`, name: p.name, biome: p.biome, x: p.x, y: p.y, look: p.look })),
  };
  if (!w) {
    editing.places.push(draftAt(MAP_W * 0.35, MAP_H * 0.45, 'meadow'), draftAt(MAP_W * 0.62, MAP_H * 0.5, 'ocean'));
    editing.places[0].name = 'Sunny Island';
    editing.places[1].name = 'Coral Bay';
  }
  editorTitle.textContent = w ? `✏️ Changing ${w.name}` : '➕ A new world';
  iconInput.value = w?.icon ?? '🏝️';
  nameInput.value = w?.name ?? '';
  versionInput.value = w?.version ?? '1';
  versionInput.hidden = !w;
  editorNote.textContent = '';
  picked = null;
  editor.hidden = false;
  renderEditor();
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  nameInput.focus();
}

function stopEditing() {
  editing = null;
  editor.hidden = true;
}

function draftAt(x: number, y: number, biome: Biome): Draft {
  return { key: `k${keys++}`, name: 'A new place', biome, x: Math.round(x), y: Math.round(y) };
}

/** The draft as a world the map can draw. */
function draftWorld(): WorldDef {
  return {
    id: editing?.id ?? 'draft',
    name: nameInput.value || 'A new world',
    icon: iconInput.value,
    mapStyle: editing!.style,
    regions: [{ id: 'draft', name: '' }],
    places: editing!.places.map((p) => ({ id: p.key, name: p.name || '…', biome: p.biome, region: 'draft', x: p.x, y: p.y, look: p.look })),
  };
}

function redrawMap() {
  if (editing) panel.show(draftWorld()).setMarks(picked ? { [picked]: 'chosen' } : {});
}

function renderEditor() {
  if (!editing) return;
  const ed = editing;
  stylesEl.replaceChildren(
    ...STYLES.map(([style, label]) => {
      const b = Object.assign(document.createElement('button'), { textContent: label, type: 'button' });
      b.setAttribute('aria-pressed', String(ed.style === style));
      b.onclick = () => {
        ed.style = style;
        if (!editing!.id && ['🏝️', '🌌'].includes(iconInput.value)) iconInput.value = style === 'space' ? '🌌' : '🏝️';
        renderEditor();
      };
      return b;
    }),
  );
  placesEl.replaceChildren(
    ...ed.places.map((p) => {
      const row = document.createElement('div');
      row.className = `place${picked === p.key ? ' picked' : ''}`;
      row.dataset.key = p.key;
      const name = Object.assign(document.createElement('input'), { type: 'text', value: p.name, maxLength: 30, placeholder: 'Name the place' });
      name.setAttribute('aria-label', 'Place name');
      name.oninput = () => (p.name = name.value);
      name.onchange = redrawMap;
      name.onfocus = () => pick(p.key, false);
      const kind = document.createElement('select');
      kind.setAttribute('aria-label', 'Kind of place');
      kind.append(...kindsFor(ed.style).map((b) => Object.assign(document.createElement('option'), { value: b, textContent: BIOME_NAMES[b], selected: b === p.biome })));
      kind.onchange = () => {
        p.biome = kind.value as Biome;
        p.look = undefined;
        renderEditor();
      };
      row.append(name, kind);
      const looks = LOOKS[p.biome];
      if (looks) {
        const look = document.createElement('select');
        look.setAttribute('aria-label', 'Its colours');
        look.title = 'Its colours';
        look.append(...looks.map((l) => Object.assign(document.createElement('option'), { value: l.id, textContent: `🎨 ${l.name}`, selected: l.id === (p.look ?? looks[0].id) })));
        look.onchange = () => {
          p.look = look.value;
          redrawMap();
        };
        row.append(look);
      }
      const remove = Object.assign(document.createElement('button'), { textContent: '✕', title: 'Take this place out', type: 'button' });
      remove.disabled = ed.places.length <= 1;
      remove.onclick = () => {
        ed.places = ed.places.filter((q) => q !== p);
        renderEditor();
      };
      row.append(remove);
      return row;
    }),
  );
  addButton.disabled = ed.places.length >= MAX_PLACES;
  addButton.title = addButton.disabled ? `A world can have up to ${MAX_PLACES} places` : 'Add a place to the map';
  redrawMap();
}

/** Picks a place on the map or in the list: its porthole glows and its row is marked. */
function pick(key: string | null, scroll = true) {
  picked = key;
  for (const row of placesEl.querySelectorAll<HTMLDivElement>('.place')) row.classList.toggle('picked', row.dataset.key === key);
  panel.map?.setMarks(key ? { [key]: 'chosen' } : {});
  if (key && scroll) placesEl.querySelector<HTMLDivElement>(`[data-key="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

addButton.onclick = () => {
  if (!editing || editing.places.length >= MAX_PLACES) return;
  // Somewhere not on top of another place.
  let best = { x: MAP_W / 2, y: MAP_H / 2, room: -1 };
  for (let i = 0; i < 60; i++) {
    const x = 120 + Math.random() * (MAP_W - 240);
    const y = 110 + Math.random() * (MAP_H - 240);
    const room = Math.min(...editing.places.map((p) => Math.hypot(p.x - x, p.y - y)), 999);
    if (room > best.room) best = { x, y, room };
  }
  const draft = draftAt(best.x, best.y, editing.style === 'space' ? 'moon' : 'meadow');
  editing.places.push(draft);
  picked = draft.key;
  renderEditor();
  placesEl.querySelector<HTMLInputElement>(`[data-key="${draft.key}"] input`)?.select();
};

// Dragging places about on the map.
const clampX = (x: number) => Math.round(Math.min(MAP_W - 70, Math.max(70, x)));
const clampY = (y: number) => Math.round(Math.min(MAP_H - 100, Math.max(70, y)));
let drag: { key: string; dx: number; dy: number; moved: boolean; pointer: number } | null = null;
panel.canvas.addEventListener('pointerdown', (e) => {
  const at = panel.toMap(e.clientX, e.clientY);
  const key = panel.map?.placeAt(at.x, at.y);
  const p = editing?.places.find((q) => q.key === key);
  if (!p) return;
  drag = { key: p.key, dx: p.x - at.x, dy: p.y - at.y, moved: false, pointer: e.pointerId };
  panel.canvas.setPointerCapture(e.pointerId);
  pick(p.key, false);
});
panel.canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  const at = panel.toMap(e.clientX, e.clientY);
  const p = editing?.places.find((q) => q.key === drag!.key);
  if (!p) return;
  const x = clampX(at.x + drag.dx);
  const y = clampY(at.y + drag.dy);
  if (Math.hypot(x - p.x, y - p.y) > 3) drag.moved = true;
  if (!drag.moved) return;
  p.x = x;
  p.y = y;
  panel.map?.movePlace(p.key, x, y);
});
const endDrag = (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  // The map round it (its island, or its planet's glow) is drawn again where it ended up.
  if (drag.moved) redrawMap();
  // A tap (not a drag): show its row in the list.
  else pick(drag.key);
  drag = null;
};
panel.canvas.addEventListener('pointerup', endDrag);
panel.canvas.addEventListener('pointercancel', endDrag);

nameInput.onchange = redrawMap;
$<HTMLButtonElement>('#new').onclick = () => startEditing(null);
$<HTMLButtonElement>('#cancel').onclick = stopEditing;
saveButton.onclick = async () => {
  if (!editing) return;
  const name = nameInput.value.trim() || 'A new world';
  const world: WorldChange = {
    name,
    icon: iconInput.value.trim() || (editing.style === 'space' ? '🌌' : '🏝️'),
    mapStyle: editing.style,
    places: editing.places.map(({ id, name, biome, x, y, look }) => ({ ...(id && { id }), name: name.trim() || 'A place', biome, x: clampX(x), y: clampY(y), ...(look && { look }) })),
    ...(editing.id && versionInput.value.trim() && { version: versionInput.value.trim() }),
  };
  saveButton.disabled = true;
  try {
    const saved = editing.id ? await changeWorld(editing.id, world) : await makeWorld(world);
    note.textContent = `💾 Saved ${saved.name}. Press ⬆️ Export to make a file of it to share, or 🚀 Visit to see it.`;
    stopEditing();
    await refresh();
    note.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    editorNote.textContent = problem(err, 'Saving the world failed.');
  } finally {
    saveButton.disabled = false;
  }
};

await refresh();
connectLive(
  (msg) => {
    if (msg.type === 'worlds') void refresh();
  },
  () => void refresh(),
);
