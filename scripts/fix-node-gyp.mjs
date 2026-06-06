/* ============================================================
   Teaches node-gyp's Visual Studio finder about VS major 18
   ("Visual Studio 2026"-era Build Tools). Stock node-gyp only maps majors
   15/16/17 -> VS 2017/2019/2022 and discards anything newer as "unknown",
   so a machine with only VS 18 installed fails with "Could not find any
   Visual Studio installation to use" even though the full C++ toolchain is
   present. VS 18 uses the same layout as 17, so we map it to year 2022.

   Idempotent + dependency-free. Run before electron-rebuild (the `rebuild`
   npm script does this automatically).
   ============================================================ */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ANCHOR = `    if (ret.versionMajor === 17) {
      ret.versionYear = 2022
      return ret
    }`;

const INJECT = `
    if (ret.versionMajor === 18) {
      ret.versionYear = 2022
      return ret
    }`;

/** Find every node-gyp find-visualstudio.js under node_modules. */
function findTargets(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      findTargets(full, out);
    } else if (e.name === 'find-visualstudio.js') {
      out.push(full);
    }
  }
  return out;
}

const nm = join(process.cwd(), 'node_modules');
if (!existsSync(nm)) {
  console.error('node_modules not found - run `npm install` first.');
  process.exit(1);
}

let patched = 0;
let already = 0;
for (const file of findTargets(nm)) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes(ANCHOR)) continue; // not the VS finder we expect
  if (src.includes('ret.versionMajor === 18')) {
    already++;
    continue;
  }
  writeFileSync(file, src.replace(ANCHOR, ANCHOR + INJECT), 'utf8');
  console.log('patched:', file);
  patched++;
}

console.log(`node-gyp VS18 patch: ${patched} patched, ${already} already up to date.`);
