import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { loadHistory } from './history.ts';
import { api } from './routes.ts';
import { accessNote, guard, securityHeaders } from './security.ts';
import { DRAWINGS_DIR, loadStore } from './store.ts';
import { onConnect, onWatch, startWorld } from './world.ts';
import { attachWebSocket } from './ws.ts';

const PORT = Number(process.env.PORT ?? 3000);
const DIST_DIR = join(import.meta.dirname, '..', 'dist');

await loadStore();
await loadHistory();
await startWorld();

const app = express();
app.disable('x-powered-by');
app.use(securityHeaders, guard);
app.use('/api', api);
app.use('/drawings', express.static(DRAWINGS_DIR, { maxAge: '1y', immutable: true }));
if (existsSync(DIST_DIR)) app.use(express.static(DIST_DIR));

const server = createServer(app);
attachWebSocket(server, { onConnect, onWatch });

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((net) => net && net.family === 'IPv4' && !net.internal)
    .map((net) => `http://${net!.address}:${PORT}`);
  console.log(`Doodlearium server on http://localhost:${PORT}`);
  console.log(accessNote());
  if (existsSync(DIST_DIR)) {
    for (const url of lan) console.log(`  on your network: ${url}`);
  } else {
    console.log('  (no built client found — use `npm run dev` and open the Vite URL, or `npm start`)');
  }
});
