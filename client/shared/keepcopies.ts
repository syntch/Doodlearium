import { leaveFullscreen } from './api.ts';

/**
 * Before a pack update replaces drawings the family has changed: asks which of them to keep as copies of
 * their own (all ticked to start with). Resolves to the ids to copy (maybe none, for "Just update"), or null
 * if they'd rather not update after all.
 */
export async function askKeepCopies(message: string, drawings: { id: string; name: string }[], go = 'update'): Promise<string[] | null> {
  await leaveFullscreen();
  const dialog = document.createElement('dialog');
  dialog.className = 'keep-copies';
  // Its own look, as the world screen doesn't load the shared page styles.
  const style = document.createElement('style');
  style.textContent = `
    .keep-copies { max-width: min(460px, calc(100vw - 32px)); padding: 18px 20px; border-radius: 14px; border: 0;
      background: #12405f; color: #f2f8fc; box-shadow: 0 12px 40px rgba(0,0,0,0.5);
      font: 15px/1.45 'Trebuchet MS', system-ui, sans-serif; }
    .keep-copies::backdrop { background: rgba(5, 20, 35, 0.55); }
    .keep-copies button { font: inherit; padding: 7px 14px; border-radius: 999px; border: 0; cursor: pointer;
      background: #1a5378; color: #f2f8fc; }
    .keep-copies button.primary { background: #ffcc4d; color: #2b2100; font-weight: bold; }
    .keep-copies button:disabled { opacity: 0.5; cursor: default; }
    .keep-copies input { accent-color: #ffcc4d; width: 18px; height: 18px; }`;
  dialog.append(style);
  const text = Object.assign(document.createElement('p'), { textContent: message });
  text.style.margin = '0 0 10px';
  const list = document.createElement('div');
  Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '40vh', overflowY: 'auto', margin: '0 0 14px' });
  const boxes = drawings.map((d) => {
    const label = document.createElement('label');
    Object.assign(label.style, { display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer' });
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true });
    label.append(box, d.name);
    list.append(label);
    return { box, id: d.id };
  });
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' });
  const button = (label: string, primary = false) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
    if (primary) b.className = 'primary';
    row.append(b);
    return b;
  };
  const cancel = button('Cancel');
  const plain = button(`Just ${go}`);
  const keep = button(`📄 Keep copies and ${go}`, true);
  const sync = () => (keep.disabled = !boxes.some((b) => b.box.checked));
  for (const b of boxes) b.box.onchange = sync;
  dialog.append(text, list, row);
  document.body.append(dialog);
  dialog.showModal();
  return new Promise((resolve) => {
    const done = (value: string[] | null) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.onclick = () => done(null);
    dialog.oncancel = () => done(null);
    plain.onclick = () => done([]);
    keep.onclick = () => done(boxes.filter((b) => b.box.checked).map((b) => b.id));
  });
}
