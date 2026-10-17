import { spawn } from 'node:child_process';
import { watch as fsWatch } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll } from './build.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
// SPEC §10.1: `npm run dev` boots on the mock engine at http://localhost:8790
env.DEFAULT_ENGINE = env.DEFAULT_ENGINE || 'mock';
env.PORT = env.PORT || '8790';

let child = null;
function start() {
  child = spawn(process.execPath, [resolve(ROOT, 'dist/server.js')], { stdio: 'inherit', env });
}
function restart() {
  if (child) child.kill('SIGTERM');
  start();
}

await buildAll();
start();

let t = null;
for (const dir of ['kernel', 'server', 'prompts']) {
  try {
    fsWatch(resolve(ROOT, dir), { recursive: true }, () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        try {
          await buildAll();
          process.stdout.write('{"event":"rebuilt"}\n');
          restart();
        } catch (e) {
          process.stdout.write('{"event":"build-failed","error":' + JSON.stringify(String(e)) + '}\n');
        }
      }, 180);
    });
  } catch {}
}

process.on('SIGINT', () => {
  child?.kill('SIGTERM');
  process.exit(0);
});
