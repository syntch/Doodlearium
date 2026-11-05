/*
 * Runs before anything else on every page, written in old JavaScript on purpose so even very old browsers
 * (smart TVs, game consoles) can read it. If the browser can't run Doodlearium, it says so kindly instead
 * of leaving a blue page or crashing. "Try anyway" hides the message for this visit.
 */
(function () {
  var missing = [];
  try {
    // Newer JavaScript the pages are written in (if this can't be read, nothing else can be either).
    new Function('class A { static #p = 1; static { A.#p ??= 2; } m() { return this?.x; } } return async () => { for await (const x of []) {} };');
  } catch (e) {
    missing.push('newer JavaScript');
  }
  if (!Array.prototype.findLast || !Array.prototype.at || typeof structuredClone !== 'function') missing.push('newer JavaScript');
  if (!window.HTMLDialogElement || !window.WebSocket || !window.Promise) missing.push('pop-up boxes and live updates');
  try {
    var canvas = document.createElement('canvas');
    if (!(canvas.getContext('webgl2') || canvas.getContext('webgl'))) missing.push('WebGL graphics');
  } catch (e) {
    missing.push('WebGL graphics');
  }
  try {
    if (sessionStorage.getItem('doodlearium-try-anyway')) return;
  } catch (e) {}
  if (!missing.length) return;

  // Keep the same reason only once.
  var reasons = [];
  for (var i = 0; i < missing.length; i++) if (reasons.indexOf(missing[i]) < 0) reasons.push(missing[i]);

  function show() {
    var style = document.createElement('style');
    style.textContent =
      'body > *:not(#old-browser) { display: none !important; }' +
      '#old-browser { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 2147483647; overflow: auto;' +
      ' background: #0a3456; color: #f2f8fc; font: 20px/1.5 "Trebuchet MS", sans-serif; text-align: center; padding: 8vh 24px; }' +
      '#old-browser h1 { font-size: 34px; margin: 0 0 12px; }' +
      '#old-browser p { max-width: 640px; margin: 0 auto 14px; }' +
      '#old-browser .why { font-size: 15px; opacity: 0.7; }' +
      '#old-browser button { font: inherit; font-size: 16px; margin-top: 18px; padding: 8px 18px; border: 0; border-radius: 999px;' +
      ' background: #1a5378; color: #f2f8fc; cursor: pointer; }';
    var box = document.createElement('div');
    box.id = 'old-browser';
    function line(tag, text, cls) {
      var el = document.createElement(tag);
      el.appendChild(document.createTextNode(text));
      if (cls) el.className = cls;
      box.appendChild(el);
      return el;
    }
    line('div', '🐠', '').style.fontSize = '64px';
    line('h1', 'This browser is too old for Doodlearium');
    line('p', 'The fish need a newer web browser to swim. Try a computer, phone or tablet with an up-to-date Firefox, Chrome, Edge or Safari.');
    line('p', 'To see it on a TV, plug a laptop into the TV, or cast a Chrome tab to it.');
    line('p', 'This browser is missing: ' + reasons.join(', ') + '.', 'why');
    var anyway = line('button', 'Try anyway');
    anyway.onclick = function () {
      try {
        sessionStorage.setItem('doodlearium-try-anyway', '1');
      } catch (e) {}
      location.reload();
    };
    document.head.appendChild(style);
    document.body.appendChild(box);
  }
  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show);
})();
