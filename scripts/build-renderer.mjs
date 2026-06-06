/* ============================================================
   Renderer build (esbuild).

   The renderer is plain React written as ES modules. esbuild bundles it,
   starting from renderer/main.jsx and following the import graph, into a
   single self-contained renderer/dist/app.js (production React, no in-browser
   Babel, no CDN, works offline). It also emits dist/index.html and dist/app.css.

   Usage:
     node scripts/build-renderer.mjs            one-off production build (minified)
     node scripts/build-renderer.mjs --dev      one-off dev build (sourcemaps, unminified)
     node scripts/build-renderer.mjs --watch    dev build that rebuilds on every save

   It also exports buildRenderer() so the dev runner (scripts/dev.mjs) can drive
   the watch build in-process alongside Electron.
   ============================================================ */
import esbuild from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rendererDir = join(root, 'renderer');
const outDir = join(rendererDir, 'dist');

const HTML = `<!DOCTYPE html>
<html lang="en" data-theme="indigo">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>House Budget</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="app.css" />
</head>
<body>
  <div id="root"></div>
  <script src="app.js"></script>
</body>
</html>
`;

/** Copy the static assets (CSS + HTML shell) into dist. */
function writeStatics() {
  copyFileSync(join(rendererDir, 'app.css'), join(outDir, 'app.css'));
  writeFileSync(join(outDir, 'index.html'), HTML, 'utf8');
}

/**
 * Build the renderer bundle.
 * @param {{ dev?: boolean, watch?: boolean }} opts
 * @returns {Promise<import('esbuild').BuildContext|void>} the watch context when watching
 */
export async function buildRenderer({ dev = false, watch = false } = {}) {
  mkdirSync(outDir, { recursive: true });

  /** @type {import('esbuild').BuildOptions} */
  const options = {
    entryPoints: [join(rendererDir, 'main.jsx')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120', // Electron 41 ships Chromium >= 134
    jsx: 'automatic', // auto-injects react/jsx-runtime; files don't import React for JSX
    minify: !dev,
    sourcemap: dev,
    define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
    legalComments: 'none',
    outfile: join(outDir, 'app.js'),
  };

  if (watch) {
    const ctx = await esbuild.context(options);
    writeStatics();
    await ctx.watch();
    console.log(`[renderer] watching for changes -> ${outDir}`);
    return ctx;
  }

  await esbuild.build(options);
  writeStatics();
  console.log(`[renderer] bundled (${dev ? 'dev' : 'production'}) -> ${outDir}`);
}

// Run as a CLI when invoked directly (not when imported by dev.mjs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const watch = process.argv.includes('--watch');
  const dev = watch || process.argv.includes('--dev');
  await buildRenderer({ dev, watch });
}
