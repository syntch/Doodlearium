/**
 * Builds the browser-only demo (`npm run build:demo`, into dist-demo/): the same pages, but with no server
 * behind them. The server's own code is bundled into the pages and runs there instead (see
 * client/demo/transport.ts); this file is where it gets pointed at browser stand-ins for what it would use
 * on a computer at home. The result is plain files that work from any folder of any website, or in a frame.
 *
 * It starts with the packs and worlds in bundled/, and nothing else: data/ (a family's own drawings and
 * world) is never read here.
 */
import { dirname, resolve } from 'node:path';
import { defineConfig, normalizePath, type Plugin } from 'vite';

const root = import.meta.dirname;
const client = resolve(root, 'client');
const at = (path: string) => normalizePath(resolve(root, path));

/** Packages (and parts of Node) the server's code imports, and what it gets in the page instead. */
const PACKAGES: Record<string, string> = {
  'node:fs/promises': at('client/demo/node/fs.ts'),
  'node:path': at('client/demo/node/path.ts'),
  'node:crypto': at('client/demo/node/crypto.ts'),
  express: at('client/demo/express.ts'),
  ws: at('client/demo/ws.ts'),
};

/** Files swapped whole: how the pages reach the server, and the parts of the server that make no sense in a page. */
const FILES = new Map([
  [at('client/shared/transport.ts'), at('client/demo/transport.ts')],
  [at('server/security.ts'), at('client/demo/security.ts')],
  [at('server/update.ts'), at('client/demo/update.ts')],
  [at('server/history.ts'), at('client/demo/history.ts')],
]);

function runInThePage(): Plugin {
  return {
    name: 'doodlearium-demo',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source in PACKAGES) return PACKAGES[source];
      if (!importer || !source.startsWith('.')) return null;
      const file = normalizePath(resolve(dirname(importer.split('?')[0]), source));
      // (The stand-in for transport.ts borrows a type from the real one.)
      return importer.startsWith(at('client/demo/')) ? null : (FILES.get(file) ?? null);
    },
    // Anything on a page marked data-needs-server (joining from other devices, updates, installing files)
    // is left out of the demo.
    transformIndexHtml: (html) => html.replace('</head>', '  <style>[data-needs-server] { display: none !important; }</style>\n  </head>'),
  };
}

export default defineConfig({
  root: client,
  base: './',
  plugins: [runInThePage()],
  build: {
    outDir: resolve(root, 'dist-demo'),
    emptyOutDir: true,
    rollupOptions: {
      // (No History page: the demo's world only lives while a page is open, so there's little to look back on.)
      input: {
        home: resolve(client, 'index.html'),
        tank: resolve(client, 'tank/index.html'),
        draw: resolve(client, 'draw/index.html'),
        gallery: resolve(client, 'gallery/index.html'),
        worlds: resolve(client, 'worlds/index.html'),
      },
    },
  },
});
