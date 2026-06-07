/**
 * Icon generator — rasterizes public/icon/stickyfix.svg into the extension PNGs
 * (16/32/48/128) plus a 256 PNG and a multi-size Windows .ico for the host
 * Desktop launcher shortcut.
 *
 * Dev-only tool. sharp + png-to-ico are intentionally NOT project dependencies
 * (the project ships pre-sized PNGs to avoid a native build dep — see CLAUDE.md).
 * This script expects them to be resolvable (run from a temp install dir via
 * `node --experimental-... ` or with NODE_PATH pointing at a throwaway install).
 *
 * Usage (from repo root, with sharp + png-to-ico installed somewhere on NODE_PATH):
 *   node scripts/gen-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// sharp + png-to-ico are loaded from a throwaway install dir (SFX_TOOLS) so they
// never become project dependencies (CLAUDE.md: ship pre-sized PNGs, no native dep).
const toolsBase = process.env.SFX_TOOLS;
if (!toolsBase) throw new Error('Set SFX_TOOLS to a dir containing node_modules/{sharp,png-to-ico}');
const req = createRequire(join(toolsBase, 'noop.cjs'));
const sharp = req('sharp');
const pngToIcoMod = req('png-to-ico');
const pngToIco = pngToIcoMod.default ?? pngToIcoMod;

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const iconDir = join(root, 'public', 'icon');
const svg = readFileSync(join(iconDir, 'stickyfix.svg'));

const pngSizes = [16, 32, 48, 128, 256];

const render = (size) =>
  sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

const buffers = {};
for (const size of pngSizes) {
  const buf = await render(size);
  buffers[size] = buf;
  writeFileSync(join(iconDir, `${size}.png`), buf);
  console.log(`wrote public/icon/${size}.png (${buf.length} bytes)`);
}

// Windows .ico for the Desktop launcher shortcut (register.ts IconLocation).
const ico = await pngToIco([buffers[16], buffers[32], buffers[48], buffers[128], buffers[256]]);
writeFileSync(join(iconDir, 'stickyfix.ico'), ico);
console.log(`wrote public/icon/stickyfix.ico (${ico.length} bytes)`);
