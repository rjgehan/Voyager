#!/usr/bin/env node
/*
 * Renders every icon the apps ship from the two drawings next to this file (BRAND.md):
 *
 *   voyager.svg        the icon, 1024 full bleed: the pale blue dot in a sunbeam
 *   voyager-small.svg  the same icon for 16 to 48 px: a wider, brighter beam and a bigger dot
 *
 *   node scripts/brand/render-icons.mjs                  (npm ci in e2e/ first: it uses its Playwright)
 *   node scripts/brand/render-icons.mjs --preview out.png   also a sheet at 1024, 180, 32 and 16 px
 *   node scripts/brand/render-icons.mjs --into some/dir      writes the files under that folder instead, to compare
 *
 *   frontend/public/favicon.svg                 voyager-small.svg on a rounded tile
 *   docs/images/icon.svg                        voyager.svg on a rounded tile (README, BRAND.md, the demo's logo)
 *   frontend/public/apple-touch-icon.png        180, full bleed and opaque (iOS rounds the corners itself
 *                                               and paints transparency black)
 *   frontend/public/icon-192.png, icon-512.png  rounded tile, for "any" in the manifest
 *   frontend/public/icon-maskable-512.png       full bleed: the dot is well inside the 80% safe zone
 *   desktop/build/icon.png                      1024 rounded tile (electron-builder makes the macOS icns)
 *   desktop/build/icon.ico                      Windows: 16 to 48 px from voyager-small.svg, 64 to 256 from
 *   desktop/src/pages/icon.ico                  voyager.svg (the exe, the window and the tray)
 *   desktop/src/pages/icon.png                  256 rounded tile (setup and offline pages, notifications)
 *   desktop/src/pages/icon-small.png            64, voyager-small.svg rounded (the macOS menu bar, at 18)
 *   clipper/icons/icon-16.png … icon-128.png    the extension's toolbar and store sizes
 *
 * Each image is the SVG drawn on a canvas in headless Edge or Chrome (Playwright's channel; PW_CHANNEL
 * picks one, `chromium` for Playwright's own build), read back as pixels and written here, so the PNGs
 * and the icon file need no image library. No new dependencies.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const ICON = readFileSync(join(here, 'voyager.svg'), 'utf8');
const SMALL = readFileSync(join(here, 'voyager-small.svg'), 'utf8');
/** The tile's corner radius, as a share of its side (the web app's icons and the desktop app). */
const ROUND = 0.225;

const { chromium } = createRequire(join(repo, 'e2e', 'package.json'))('@playwright/test');

// ---------------------------------------------------------------- files

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * A PNG of `size`² RGBA pixels: RGB (colour type 2) when `opaque`, RGBA (6) otherwise. Each row takes
 * the filter that leaves the smallest residuals (the usual heuristic), which keeps gradients small.
 */
function png(rgba, size, opaque) {
  const channels = opaque ? 3 : 4;
  const stride = size * channels;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      if (opaque && rgba[from + 3] !== 255) throw new Error(`pixel ${x},${y} of a ${size} px opaque icon is not opaque`);
      for (let c = 0; c < channels; c++) row[x * channels + c] = rgba[from + c];
    }
    rows.push(row);
  }
  const raw = Buffer.alloc(size * (stride + 1));
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < size; y++) {
    const cur = rows[y];
    const up = y > 0 ? rows[y - 1] : Buffer.alloc(stride);
    let best = Infinity;
    for (let filter = 0; filter < 5; filter++) {
      let cost = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? cur[i - channels] : 0;
        const b = up[i];
        const c = i >= channels ? up[i - channels] : 0;
        const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
        const v = (cur[i] - predictor) & 0xff;
        candidate[i] = v;
        cost += v < 128 ? v : 256 - v;
      }
      if (cost < best) {
        best = cost;
        raw[y * (stride + 1)] = filter;
        candidate.copy(raw, y * (stride + 1) + 1);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A 32-bit BMP icon image (what every Windows tool reads): BGRA rows bottom-up, then an empty AND mask. */
function dib(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // the XOR image and the AND mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = ((size - 1 - y) * size + x) * 4;
      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

/** An .ico: BMP images below 256 px, PNG at 256 (as Windows' own icons are stored). */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  const bodies = images.map(({ size, rgba }, i) => {
    const body = size >= 256 ? png(rgba, size, false) : dib(rgba, size);
    const at = 6 + 16 * i;
    head[at] = size >= 256 ? 0 : size;
    head[at + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(body.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += body.length;
    return body;
  });
  return Buffer.concat([head, ...bodies]);
}

/** The drawing on a tile with rounded corners (transparent outside them), marked as generated. */
function rounded(svg, source) {
  const [, w] = /viewBox="0 0 (\d+) \d+"/.exec(svg);
  const r = (Number(w) * ROUND).toFixed(2);
  return svg
    .replace(/<!--[\s\S]*?-->/, `<!-- Voyager's icon (BRAND.md), made by scripts/brand/render-icons.mjs from ${source}: edit that file. -->`)
    .replace('<defs>', `<defs>\n    <clipPath id="tile"><rect width="${w}" height="${w}" rx="${r}"/></clipPath>`)
    .replace(/(<\/defs>)([\s\S]*)(<\/svg>)/, `$1\n  <g clip-path="url(#tile)">$2</g>\n$3`);
}

const intoAt = process.argv.indexOf('--into');
const outRoot = intoAt > 0 ? process.argv[intoAt + 1] : repo;

function write(rel, bytes) {
  const file = join(outRoot, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  console.log(`${String(bytes.length).padStart(7)} B  ${rel}`);
}

// ---------------------------------------------------------------- render

async function launch() {
  const asked = process.env.PW_CHANNEL;
  const channels = asked ? [asked === 'chromium' ? undefined : asked] : ['msedge', 'chrome', undefined];
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel });
    } catch (e) {
      if (channel === channels.at(-1)) throw e;
    }
  }
}

const browser = await launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');

/** The SVG drawn at `size`² on a canvas: its RGBA pixels. */
async function pixels(svg, size) {
  const data = await page.evaluate(
    async ({ svg, size }) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, size, size);
      return Array.from(ctx.getImageData(0, 0, size, size).data);
    },
    { svg, size },
  );
  return Buffer.from(data);
}

const roundIcon = rounded(ICON, 'voyager.svg');
const roundSmall = rounded(SMALL, 'voyager-small.svg');
const pngOf = async (svg, size, opaque = false) => png(await pixels(svg, size), size, opaque);

write('frontend/public/favicon.svg', Buffer.from(roundSmall));
write('docs/images/icon.svg', Buffer.from(roundIcon));
write('frontend/public/apple-touch-icon.png', await pngOf(ICON, 180, true));
write('frontend/public/icon-192.png', await pngOf(roundIcon, 192));
write('frontend/public/icon-512.png', await pngOf(roundIcon, 512));
write('frontend/public/icon-maskable-512.png', await pngOf(ICON, 512, true));

const icoImages = [];
for (const size of [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]) {
  icoImages.push({ size, rgba: await pixels(size <= 48 ? roundSmall : roundIcon, size) });
}
const icoFile = ico(icoImages);
write('desktop/build/icon.ico', icoFile);
write('desktop/src/pages/icon.ico', icoFile);
write('desktop/build/icon.png', await pngOf(roundIcon, 1024));
write('desktop/src/pages/icon.png', await pngOf(roundIcon, 256));
write('desktop/src/pages/icon-small.png', await pngOf(roundSmall, 64));

for (const size of [16, 32, 48, 128]) {
  write(`clipper/icons/icon-${size}.png`, await pngOf(size <= 48 ? roundSmall : roundIcon, size));
}

// ---------------------------------------------------------------- preview sheet

const previewAt = process.argv.indexOf('--preview');
if (previewAt > 0) {
  const out = process.argv[previewAt + 1];
  const dataUrl = async (svg, size, opaque) => 'data:image/png;base64,' + (await pngOf(svg, size, opaque)).toString('base64');
  const big = await dataUrl(ICON, 1024, true);
  const touch = await dataUrl(ICON, 180, true);
  const fav32 = await dataUrl(roundSmall, 32);
  const fav16 = await dataUrl(roundSmall, 16);
  const tab = (bg, fg, border) => `
      <div class="tabbar" style="background:${bg};color:${fg};border-color:${border}">
        <span class="tab" style="background:${bg === '#202124' ? '#35363a' : '#ffffff'}"><img src="${fav16}" width="16" height="16"> Voyager</span>
      </div>`;
  await page.setViewportSize({ width: 1560, height: 1160 });
  await page.setContent(`<!doctype html><html><head><style>
    body { margin: 0; padding: 40px 48px; background: #f4f2f8; font: 15px/1.4 'Segoe UI', system-ui, sans-serif; color: #2b2540; }
    h1 { font-size: 22px; margin: 0 0 4px; } p { margin: 0 0 28px; color: #6b6480; }
    .row { display: flex; align-items: flex-end; gap: 44px; }
    figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; }
    figcaption { font-size: 13px; color: #6b6480; }
    .px { image-rendering: pixelated; }
    .side { display: flex; flex-direction: column; gap: 26px; }
    .tabbar { width: 230px; padding: 8px 8px 0; border-bottom: 1px solid; }
    .tab { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 8px 8px 0 0; font-size: 13px; }
  </style></head><body>
    <h1>Voyager: the pale blue dot</h1>
    <p>Each image at its real size in pixels. 32 and 16 px use the simplified drawing (wider beam, bigger dot); they are also shown 8× larger, pixel for pixel.</p>
    <div class="row">
      <figure><img src="${big}" width="1024" height="1024"><figcaption>1024 px (iPhone, macOS, README)</figcaption></figure>
      <div class="side">
        <figure><img src="${touch}" width="180" height="180"><figcaption>180 px (iPhone Home Screen)</figcaption></figure>
        <div class="row" style="gap:28px">
          <figure><img src="${fav32}" width="32" height="32"><figcaption>32 px</figcaption></figure>
          <figure><img src="${fav16}" width="16" height="16"><figcaption>16 px</figcaption></figure>
        </div>
        <div class="row" style="gap:20px">
          <figure><img class="px" src="${fav32}" width="256" height="256"><figcaption>32 px, 8×</figcaption></figure>
          <figure><img class="px" src="${fav16}" width="128" height="128"><figcaption>16 px, 8×</figcaption></figure>
        </div>
        <figure>${tab('#202124', '#e8eaed', '#3c4043')}${tab('#dee1e6', '#202124', '#c4c7cc')}<figcaption>16 px in a dark and a light tab bar</figcaption></figure>
      </div>
    </div>
  </body></html>`);
  await page.waitForLoadState('load');
  const shot = await page.screenshot({ fullPage: true });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, shot);
  console.log(`preview  ${out}`);
}

await browser.close();
