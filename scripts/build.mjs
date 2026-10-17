import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

mkdirSync(resolve(ROOT, 'public'), { recursive: true });
mkdirSync(resolve(ROOT, 'dist'), { recursive: true });
mkdirSync(resolve(ROOT, '.build'), { recursive: true });

/** Pass 1: the runtime that gets injected into every generated document. */
export async function buildRuntime() {
  const out = resolve(ROOT, '.build/runtime.js');
  await build({
    entryPoints: [resolve(ROOT, 'kernel/injected/runtime.ts')],
    outfile: out,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2019'],
    minify: true,
    legalComments: 'none',
  });
  return readFileSync(out, 'utf8');
}

/** Pass 2: the kernel bundle, with the runtime inlined as a string. */
export async function buildKernel(runtimeSrc) {
  await build({
    entryPoints: [resolve(ROOT, 'kernel/index.ts')],
    outfile: resolve(ROOT, 'public/kernel.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: false,
    sourcemap: false,
    define: { __OS_RUNTIME__: JSON.stringify(runtimeSrc) },
  });
}

export async function buildServer() {
  await build({
    entryPoints: [resolve(ROOT, 'server/index.ts')],
    outfile: resolve(ROOT, 'dist/server.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node22'],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
}

export async function buildAll() {
  const rt = await buildRuntime();
  await buildKernel(rt);
  await buildServer();
  writeFileSync(resolve(ROOT, 'public/.built'), new Date().toISOString());
}

if (!watch) {
  await buildAll();
  rmSync(resolve(ROOT, '.build'), { recursive: true, force: true });
  process.stdout.write('built: public/kernel.js, dist/server.js\n');
}
