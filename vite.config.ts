import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const client = resolve(import.meta.dirname, 'client');
const serverPort = Number(process.env.PORT ?? 3000);

export default defineConfig({
  root: client,
  server: {
    host: true,
    proxy: {
      '/api': `http://localhost:${serverPort}`,
      '/drawings': `http://localhost:${serverPort}`,
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: resolve(client, 'index.html'),
        tank: resolve(client, 'tank/index.html'),
        draw: resolve(client, 'draw/index.html'),
        gallery: resolve(client, 'gallery/index.html'),
      },
    },
  },
});
