/* ============================================================
   Renderer build (esbuild).

   The renderer is plain React written as ES modules. esbuild bundles it,
   starting from renderer/main.jsx and following the import graph, into a
   single self-contained renderer/dist/app.js (production React, no in-browser
   Babel, no CDN, works offline). It also emits dist/index.html and dist/app.css
   with the dist/styles/ folder that app.css imports,
   and copies the bundled IBM Plex fonts, plus their OFL.txt licence, into
   dist/fonts. The licence has to travel with the binaries (SIL OFL 1.1
   section 2), and build.files in package.json only ships renderer/dist/**,
   so it has to actually land there rather than stay behind in assets/fonts.
   No CDN, works offline: now true of the whole renderer, not just the JS
   bundle.

   Usage:
     node scripts/build-renderer.mjs            one-off production build (minified)
     node scripts/build-renderer.mjs --dev      one-off dev build (sourcemaps, unminified)
     node scripts/build-renderer.mjs --watch    dev build that rebuilds on every save

   It also exports buildRenderer() so the dev runner (scripts/dev.mjs) can drive
   the watch build in-process alongside Electron.
   ============================================================ */
import esbuild from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync, readdirSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rendererDir = join(root, 'renderer');
const outDir = join(rendererDir, 'dist');

/* data-theme is set here as well as in main.jsx so the first paint, before
   React mounts, is already the default theme rather than an unstyled board.
   main.jsx overwrites the attribute with the persisted choice; keep this value
   in step with DEFAULT_THEME_ID in renderer/lib/theme.js. */
const HTML = `<!DOCTYPE html>
<html lang="en" data-theme="obsidian">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>House Budget</title>
  <link rel="stylesheet" href="app.css" />
</head>
<body>
  <div id="root"></div>
  <script src="app.js"></script>
</body>
</html>
`;

/** Copy the static assets (CSS + HTML shell + bundled fonts) into dist. */
function writeStatics() {
  /* app.css is a manifest of @imports now, so the folder it points at has to
     travel with it. The browser resolves each @import against app.css's own
     location, so dist/styles/ has to mirror renderer/styles/ exactly - and
     tokens.css's font url()s are ../fonts/, relative to itself. */
  copyFileSync(join(rendererDir, 'app.css'), join(outDir, 'app.css'));
  const styleSrc = join(rendererDir, 'styles');
  const styleOut = join(outDir, 'styles');
  mkdirSync(styleOut, { recursive: true });
  for (const f of readdirSync(styleSrc).filter((n) => n.endsWith('.css'))) {
    copyFileSync(join(styleSrc, f), join(styleOut, f));
  }
  writeFileSync(join(outDir, 'index.html'), HTML, 'utf8');
  const fontSrc = join(root, 'assets', 'fonts');
  const fontOut = join(outDir, 'fonts');
  mkdirSync(fontOut, { recursive: true });
  for (const f of readdirSync(fontSrc).filter((n) => n.endsWith('.woff2') || n.endsWith('.txt'))) {
    copyFileSync(join(fontSrc, f), join(fontOut, f));
  }
}

/* Keep dist/app.css in step with renderer/app.css while watching. esbuild only
   watches the JS import graph, and the stylesheet is copied rather than
   bundled, so without this a stylesheet edit never reaches dist (and so never
   reaches the app). The whole renderer directory is watched rather than the one
   file because editors save by replacing the file, which drops a watch bound to
   the old inode; changes to anything else there are filtered out, dist/app.css
   included, so the copy cannot re-trigger itself. Only app.css is copied, not
   the full writeStatics(): rewriting index.html and the fonts would touch
   mtimes the app's hot reload is watching, costing a reload per save. */
function watchCss() {
  let timer = null;
  watch(rendererDir, (_event, filename) => {
    if (filename !== 'app.css') return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      copyFileSync(join(rendererDir, 'app.css'), join(outDir, 'app.css'));
      console.log('[renderer] app.css -> dist');
    }, 50);
  });
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
    watchCss();
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
