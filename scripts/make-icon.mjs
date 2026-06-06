/* ============================================================
   Builds assets/icon.ico from assets/budget.png so the PNG stays the single
   source of truth for the app icon.

   electron-builder requires the Windows .ico to contain at least a 256x256
   image; naive PNG→ICO converters often keep only a small frame. This wraps
   the full-size PNG in an ICO container (PNG-compressed entry, valid on
   Windows Vista+), so the icon never loses resolution. Dependency-free.
   ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pngPath = join(root, 'assets', 'budget.png');
const icoPath = join(root, 'assets', 'icon.ico');

const png = readFileSync(pngPath);
if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('assets/budget.png is not a PNG');
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width < 256 || height < 256) {
  throw new Error(`assets/budget.png must be at least 256x256 (got ${width}x${height})`);
}

const ICONDIR = Buffer.alloc(6);
ICONDIR.writeUInt16LE(0, 0); // reserved
ICONDIR.writeUInt16LE(1, 2); // type: 1 = icon
ICONDIR.writeUInt16LE(1, 4); // image count

const ICONDIRENTRY = Buffer.alloc(16);
ICONDIRENTRY[0] = width >= 256 ? 0 : width; // 0 means 256
ICONDIRENTRY[1] = height >= 256 ? 0 : height;
ICONDIRENTRY[2] = 0; // palette colours
ICONDIRENTRY[3] = 0; // reserved
ICONDIRENTRY.writeUInt16LE(1, 4); // colour planes
ICONDIRENTRY.writeUInt16LE(32, 6); // bits per pixel
ICONDIRENTRY.writeUInt32LE(png.length, 8); // size of image data
ICONDIRENTRY.writeUInt32LE(ICONDIR.length + ICONDIRENTRY.length, 12); // offset to PNG

writeFileSync(icoPath, Buffer.concat([ICONDIR, ICONDIRENTRY, png]));
console.log(`icon.ico written (${width}x${height} PNG embedded) -> ${icoPath}`);
