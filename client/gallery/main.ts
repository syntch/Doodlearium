import { imageUrl, type CreatureType, type Drawing } from '../../shared/types.ts';
import { connectLive, deleteDrawing, fetchDrawings } from '../shared/api.ts';

const FILTERS: { label: string; type: CreatureType | null }[] = [
  { label: 'Everything', type: null },
  { label: '🐟 Fish', type: 'swimmer' },
  { label: '🌿 Plants', type: 'plant' },
  { label: '🪨 Decorations', type: 'decor' },
];

const grid = document.querySelector<HTMLDivElement>('#grid')!;
const empty = document.querySelector<HTMLParagraphElement>('#empty')!;
const filtersEl = document.querySelector<HTMLDivElement>('#filters')!;

let drawings: Drawing[] = [];
let filter: CreatureType | null = null;

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

function render() {
  filterButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(FILTERS[i].type === filter)));
  const shown = drawings
    .filter((d) => !filter || d.type === filter)
    .sort((a, b) => b.createdAt - a.createdAt);
  empty.hidden = drawings.length > 0;
  grid.replaceChildren(...shown.map(card));
}

function card(d: Drawing) {
  const el = document.createElement('article');
  el.className = 'card';
  const art = document.createElement('div');
  art.className = 'art';
  const img = document.createElement('img');
  img.src = imageUrl(d);
  img.alt = d.name;
  img.loading = 'lazy';
  art.append(img);

  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = d.name;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `by ${d.artist} · ${new Date(d.createdAt).toLocaleDateString()}`;

  const remove = document.createElement('button');
  remove.textContent = 'Remove';
  remove.onclick = async () => {
    if (!confirm(`Remove "${d.name}" from the tank for good?`)) return;
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

  el.append(art, name, meta, actions);
  return el;
}

async function refresh() {
  drawings = await fetchDrawings();
  render();
}

void refresh();
connectLive(
  (msg) => {
    if (msg.type === 'drawing:added' || msg.type === 'drawing:updated') {
      drawings = [...drawings.filter((d) => d.id !== msg.drawing.id), msg.drawing];
    } else {
      drawings = drawings.filter((d) => d.id !== msg.id);
    }
    render();
  },
  () => void refresh(),
);
