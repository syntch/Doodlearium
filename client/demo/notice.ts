/**
 * What the browser-only demo says about itself: that it's a demo, that nothing drawn leaves this browser,
 * and a way to start over.
 */
import { wipeFiles } from './node/fs.ts';

/** Forgets everything the demo has kept in this browser, and starts afresh. */
async function startOver() {
  if (!confirm('Start the demo over? Everything you drew or changed here is forgotten, and the world goes back to how it started.')) return;
  await wipeFiles();
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('doodlearium')) localStorage.removeItem(key);
  } catch {}
  location.reload();
}

function show() {
  // (The world page is all picture: the note is on the pages around it.)
  const main = document.querySelector('main');
  if (!main || document.querySelector('#demo-note')) return;
  const note = document.createElement('p');
  note.id = 'demo-note';
  note.style.cssText = 'max-width: 720px; margin: 28px auto 8px; padding: 12px 16px; border-radius: 14px; background: rgba(255, 255, 255, 0.08); color: inherit; font-size: 0.95rem; line-height: 1.5; text-align: center;';
  // The home page says it all, and offers to start over; the others just say where drawings go.
  if (document.querySelector('.choices')) {
    note.append(
      '🧪 This is a demo that runs entirely in your browser. What you draw stays on this device: nothing is uploaded or shared. The full Doodlearium runs on a computer at home, for every screen in the house. ',
    );
    const reset = Object.assign(document.createElement('button'), { textContent: '↺ Start the demo over', title: 'Forget everything drawn or changed here' });
    reset.style.marginLeft = '6px';
    reset.onclick = () => void startOver();
    note.append(reset);
  } else {
    note.append('🧪 Demo: what you draw stays in this browser. Nothing is uploaded or shared.');
  }
  main.append(note);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
else show();

/** A line across the page while the starter creatures move in (the first visit takes a moment). Returns a way to take it away. */
export function showBusy(text: string) {
  const note = document.createElement('div');
  note.textContent = text;
  note.style.cssText = 'position: fixed; left: 50%; top: 45%; transform: translate(-50%, -50%); z-index: 100000; padding: 14px 24px; border-radius: 16px; background: rgba(12, 32, 56, 0.9); color: #fff; font: 600 20px system-ui, sans-serif; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.3); pointer-events: none; text-align: center;';
  const add = () => document.body?.append(note);
  if (document.body) add();
  else document.addEventListener('DOMContentLoaded', add);
  return () => note.remove();
}
