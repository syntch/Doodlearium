// Runs Doodlearium and keeps it running (this is what `npm start` does): builds the pages, starts the
// server, starts it again if it stops unexpectedly, and does the ⚙️ menu's 🔄 Update when the server asks
// for one by stopping with exit code 75. Plain Node, so it works before anything's installed or built.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UPDATE_EXIT = 75;
const RESULT_FILE = join(ROOT, 'data', 'update.json');

/** Runs a command to the end, showing its output; returns whether it worked and the last of what it said. */
function run(command, args) {
  console.log(`> ${command} ${args.join(' ')}`);
  // npm is a .cmd script on Windows, which needs a shell (the commands here are all fixed, nothing typed in).
  const shell = command === 'npm' && process.platform === 'win32';
  const result = shell
    ? spawnSync([command, ...args].join(' '), { cwd: ROOT, encoding: 'utf8', shell })
    : spawnSync(command, args, { cwd: ROOT, encoding: 'utf8' });
  const said = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(said);
  // What went wrong, briefly: the lines that say error (or else the last few), without colour codes.
  const lines = said.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n');
  const errors = lines.filter((l) => /error|fatal|ERR!/i.test(l) && !/^\s+at /.test(l));
  return { ok: result.status === 0, out: (result.stdout ?? '').trim(), tail: (errors.length ? errors.slice(0, 3) : lines.slice(-4)).join('\n') };
}

const build = () => run('npm', ['run', 'build']);

function remember(result) {
  mkdirSync(dirname(RESULT_FILE), { recursive: true });
  writeFileSync(RESULT_FILE, JSON.stringify({ at: Date.now(), ...result }, null, 2));
  console.log(result.ok ? `Updated: ${result.message}` : `Update didn't work: ${result.message}`);
}

/** Gets the new version from GitHub and builds it; if that goes wrong, goes back to the one before. */
function update() {
  const from = run('git', ['rev-parse', 'HEAD']).out;
  const pull = run('git', ['pull', '--ff-only']);
  if (!pull.ok) return remember({ ok: false, message: `Couldn't get the new version (nothing changed).\n${pull.tail}`, from });
  const to = run('git', ['rev-parse', 'HEAD']).out;
  if (to === from) return remember({ ok: true, message: 'Already up to date.', from, to });
  const changes = run('git', ['log', '--format=%s', `${from}..${to}`]).out.split('\n').filter(Boolean);
  const newPackages = Boolean(run('git', ['diff', '--name-only', from, to, '--', 'package-lock.json']).out);
  const installed = newPackages ? run('npm', ['ci']) : { ok: true };
  const built = installed.ok ? build() : installed;
  if (built.ok) {
    return remember({ ok: true, message: `${changes.length} new change${changes.length === 1 ? '' : 's'}.`, from, to, changes });
  }
  // Back to how it was (keeping anything changed by hand), so the world carries on as before.
  run('git', ['reset', '--keep', from]);
  if (newPackages) run('npm', ['ci']);
  build();
  remember({ ok: false, message: `The new version wouldn't build, so the old one is still running.\n${built.tail}`, from, to });
}

let stopping = false;
let server = null;
const crashes = [];

function start() {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, DOODLEARIUM_LAUNCHER: '1' },
  });
  server.on('exit', (code, signal) => {
    if (code === UPDATE_EXIT) {
      console.log('Updating Doodlearium...');
      update();
      return start();
    }
    if (stopping || code === 0) process.exit(0);
    // Stopped unexpectedly: start again (but not over and over if it keeps failing straight away).
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0] > 60_000) crashes.shift();
    if (crashes.length >= 5) {
      console.error('The server keeps stopping: giving up. Check the messages above.');
      process.exit(1);
    }
    console.error(`The server stopped (${signal ?? `code ${code}`}); starting it again in 3 seconds...`);
    setTimeout(start, 3000);
  });
}

// Ctrl+C reaches the server too, which saves the world and stops; then so does this. A service manager's
// SIGTERM only reaches this, so it's passed on.
process.on('SIGINT', () => (stopping = true));
process.on('SIGTERM', () => {
  stopping = true;
  server?.kill('SIGTERM');
});

if (!build().ok) {
  console.error("The pages wouldn't build. Try `npm install`, then `npm start` again.");
  process.exit(1);
}
start();
