/* ============================================================
   Dev runner: one command for the whole dev loop.

   1. Compiles the main/preload TypeScript once (tsc).
   2. Starts the renderer bundle in esbuild watch mode (rebuilds on save).
   3. Launches Electron.

   Edit a renderer .jsx, save, then press Ctrl+R in the app window to reload
   (the bundle is already rebuilt by the watcher). Edit main/preload TypeScript
   and you'll need to restart this command, since tsc only runs once here.
   ============================================================ */
import { spawn } from 'node:child_process';
import { buildRenderer } from './build-renderer.mjs';

/** Run a command to completion, inheriting stdio. */
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`))
    );
  });
}

// 1. Compile main + preload TypeScript.
await run('npm', ['run', 'build']);

// 2. Start the renderer watch build (stays running in this process).
const ctx = await buildRenderer({ dev: true, watch: true });

// 3. Launch Electron; shut the watcher down when the app exits.
const electron = spawn('npx', ['electron', '.'], { stdio: 'inherit', shell: true });
electron.on('exit', async (code) => {
  await ctx?.dispose();
  process.exit(code ?? 0);
});
