/* ============================================================
   Production renderer build.

   The dev renderer (renderer/index.html) loads React, ReactDOM, Recharts and
   Babel-standalone from a CDN and transpiles the .jsx files in the browser on
   every launch. That is convenient for iteration but needs the network and is
   slow to start, so it is unsuitable for a packaged app.

   This script produces a self-contained, offline renderer under renderer/dist:
   it bundles React / ReactDOM / Recharts from node_modules and pre-transpiles
   every .jsx into one minified app.js (production React, no in-browser Babel).

   The .jsx files were written to run as classic <script> tags sharing one
   global scope (no import/export; they reference each other's top-level
   declarations and the React / Recharts globals directly). We preserve that
   exactly by concatenating them — in the same order index.html loads them —
   into a single esbuild module, prefixed by a shim that brings React, ReactDOM
   and Recharts into scope. Because esbuild puts them in one module scope, the
   cross-file references keep working unchanged.
   ============================================================ */
import esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rendererDir = join(root, 'renderer');
const outDir = join(rendererDir, 'dist');

/** Read the ordered list of .jsx files straight from index.html so this build
 *  stays in sync automatically when scripts are added/removed/reordered. */
function jsxLoadOrder() {
  const html = readFileSync(join(rendererDir, 'index.html'), 'utf8');
  const re = /<script[^>]*type=["']text\/babel["'][^>]*src=["']([^"']+\.jsx)["']/g;
  const files = [];
  let m;
  while ((m = re.exec(html)) !== null) files.push(m[1]);
  if (files.length === 0) throw new Error('No text/babel .jsx scripts found in index.html');
  return files;
}

/** The shim that makes the CDN globals (React, ReactDOM, Recharts) available as
 *  module-scope bindings, so the concatenated renderer code finds them. */
const SHIM = [
  "import React from 'react';",
  "import { createRoot } from 'react-dom/client';",
  "import * as Recharts from 'recharts';",
  'const ReactDOM = { createRoot };',
  '',
].join('\n');

const order = jsxLoadOrder();
const body = order
  .map((f) => `\n/* ---- ${f} ---- */\n` + readFileSync(join(rendererDir, f), 'utf8'))
  .join('\n;\n');

mkdirSync(outDir, { recursive: true });

await esbuild.build({
  stdin: {
    contents: SHIM + body,
    resolveDir: root, // so bare 'react' / 'recharts' resolve from node_modules
    loader: 'jsx',
    sourcefile: 'renderer-bundle.jsx',
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120', // Electron 41 ships Chromium ≥ 134
  jsx: 'transform', // classic React.createElement; React is in scope via the shim
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  outfile: join(outDir, 'app.js'),
});

copyFileSync(join(rendererDir, 'app.css'), join(outDir, 'app.css'));

const prodHtml = `<!DOCTYPE html>
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
writeFileSync(join(outDir, 'index.html'), prodHtml, 'utf8');

console.log(`renderer bundled (${order.length} files) -> ${outDir}`);
