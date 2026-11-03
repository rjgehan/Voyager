#!/usr/bin/env node
/*
 * Renders every icon the apps ship from the two drawings next to this file (BRAND.md):
 *
 *   voyager.svg        the icon, 1024 full bleed: the Golden Record on deep space
 *   voyager-small.svg  the same icon for 16 to 48 px: one groove band, a lighter label, a bigger hole
 *
 *   node scripts/brand/render-icons.mjs                  (npm ci in e2e/ first: it uses its Playwright)
 *   node scripts/brand/render-icons.mjs --preview out.png   also a sheet (and out.html) showing it in place
 *   node scripts/brand/render-icons.mjs --into some/dir      writes the files under that folder instead, to compare
 *
 *   frontend/public/favicon.svg                 voyager-small.svg on a rounded tile
 *   docs/images/icon.svg                        voyager.svg on a rounded tile (README, BRAND.md, the demo's logo)
 *   frontend/public/apple-touch-icon.png        180, full bleed and opaque (iOS rounds the corners itself
 *                                               and paints transparency black)
 *   frontend/public/icon-192.png, icon-512.png  rounded tile, for "any" in the manifest
 *   frontend/public/icon-maskable-512.png       full bleed: the disc is well inside the 80% safe zone
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

/*
 * --preview out.png: one sheet, 2400 px wide, with the icon where people will see it, each at its real
 * size in pixels: large (512), full bleed under a maskable circle, on an iPhone Home Screen (drawn at
 * 2×, so the icon is 120 px), in a dark and a light browser tab bar at 16 px (100%) and 32 px (200%),
 * and on a dark and a light Windows 11 taskbar at 100% (24 px) and 150% (36 px). The page itself is
 * written next to the PNG, as out.html.
 */
const previewAt = process.argv.indexOf('--preview');
if (previewAt > 0) {
  const out = process.argv[previewAt + 1];
  const dataUrl = async (svg, size, opaque) => 'data:image/png;base64,' + (await pngOf(svg, size, opaque)).toString('base64');
  const big = await dataUrl(roundIcon, 512);
  const bleed = await dataUrl(ICON, 320, true);
  const touch = await dataUrl(ICON, 180, true);
  const s16 = await dataUrl(roundSmall, 16);
  const s24 = await dataUrl(roundSmall, 24);
  const s32 = await dataUrl(roundSmall, 32);
  const s36 = await dataUrl(roundSmall, 36);
  const s48 = await dataUrl(roundSmall, 48);

  // Neutral stand-ins for other apps: a flat grey-blue tile and a plain white glyph, no real product's mark.
  const glyphs = {
    clock: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
    cloud: '<path d="M7 17h10a4 4 0 0 0 0-8 6 6 0 0 0-11 1.5A3.3 3.3 0 0 0 7 17z" fill="#fff"/>',
    grid: '<g fill="#fff"><rect x="5" y="5" width="6" height="6" rx="1.5"/><rect x="13" y="5" width="6" height="6" rx="1.5"/><rect x="5" y="13" width="6" height="6" rx="1.5"/><rect x="13" y="13" width="6" height="6" rx="1.5"/></g>',
    camera: '<path d="M5 8h3l1.5-2h5L16 8h3v10H5z" fill="#fff"/><circle cx="12" cy="13" r="3" fill="#8a8f98"/>',
    mail: '<rect x="4" y="6.5" width="16" height="11" rx="2" fill="#fff"/><path d="M4.5 7.5l7.5 6 7.5-6" fill="none" stroke="#6b7787" stroke-width="1.6"/>',
    chat: '<path d="M5 6h14v9H10l-4 3v-3H5z" fill="#fff"/>',
    music: '<path d="M9 17V7l9-2v10" fill="none" stroke="#fff" stroke-width="2"/><circle cx="7" cy="17" r="2.4" fill="#fff"/><circle cx="16" cy="15" r="2.4" fill="#fff"/>',
    map: '<path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z" fill="#fff"/><path d="M9 4v14M15 6v14" stroke="#9aa3ad" stroke-width="1.2"/>',
    gear: '<circle cx="12" cy="12" r="6.5" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="3 2.1"/><circle cx="12" cy="12" r="3" fill="#fff"/>',
    folder: '<path d="M4 7h6l2 2h8v9H4z" fill="#fff"/>',
    globe: '<circle cx="12" cy="12" r="7.5" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M4.5 12h15M12 4.5c3 3 3 12 0 15M12 4.5c-3 3-3 12 0 15" fill="none" stroke="#fff" stroke-width="1.5"/>',
    search: '<circle cx="10.5" cy="10.5" r="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14.5 14.5L19 19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    start: '<g fill="currentColor"><rect x="4" y="4" width="7.5" height="7.5" rx="1"/><rect x="12.5" y="4" width="7.5" height="7.5" rx="1"/><rect x="4" y="12.5" width="7.5" height="7.5" rx="1"/><rect x="12.5" y="12.5" width="7.5" height="7.5" rx="1"/></g>',
  };
  const tile = (bg, glyph, size, radius = 0.225) =>
    `<span class="gen" style="width:${size}px;height:${size}px;border-radius:${size * radius}px;background:${bg}"><svg viewBox="0 0 24 24" width="${size * 0.62}" height="${size * 0.62}">${glyphs[glyph]}</svg></span>`;
  const neutral = [
    ['linear-gradient(#9aa1ab,#6f7681)', 'clock', 'Clock'], ['linear-gradient(#8fb3d9,#5f86b3)', 'cloud', 'Weather'],
    ['linear-gradient(#a7adb6,#7c838e)', 'grid', 'Utilities'], ['linear-gradient(#b4b8bf,#8a8f98)', 'camera', 'Camera'],
    ['linear-gradient(#93a3b8,#6b7787)', 'mail', 'Mail'], ['linear-gradient(#a2b6a8,#71877a)', 'chat', 'Messages'],
    ['linear-gradient(#b7a9b5,#887a88)', 'music', 'Music'], ['linear-gradient(#b8c0c8,#9aa3ad)', 'map', 'Maps'],
    ['linear-gradient(#a6a6ab,#7d7d84)', 'gear', 'Settings'], ['linear-gradient(#a9b9c9,#7f93a8)', 'folder', 'Files'],
    ['linear-gradient(#9fb0c4,#71839a)', 'globe', 'Browser'],
  ];
  const app = (icon, label) => `<div class="app">${icon}<span>${label}</span></div>`;
  const home = [
    ...neutral.slice(0, 5).map(([bg, g, l]) => app(tile(bg, g, 120), l)),
    app(`<img src="${touch}" width="120" height="120" class="ios">`, 'Voyager'),
    ...neutral.slice(5, 11).map(([bg, g, l]) => app(tile(bg, g, 120), l)),
  ].join('');

  const tabbar = (dark, scale) => {
    const fav = scale === 1 ? s16 : s32;
    const z = (n) => n * scale;
    const c = dark
      ? { bar: '#202124', tab: '#35363a', fg: '#e8eaed', dim: '#9aa0a6', field: '#282828' }
      : { bar: '#dee1e6', tab: '#ffffff', fg: '#202124', dim: '#5f6368', field: '#f1f3f4' };
    const other = `<svg viewBox="0 0 24 24" width="${z(16)}" height="${z(16)}" style="color:${c.dim}">${glyphs.search}</svg>`;
    return `<div class="browser" style="background:${c.bar};color:${c.fg};font-size:${z(12)}px;width:${z(360)}px">
        <div class="tabs" style="padding:${z(8)}px ${z(8)}px 0;gap:${z(2)}px">
          <span class="tab" style="background:${c.tab};padding:${z(8)}px ${z(12)}px;border-radius:${z(8)}px ${z(8)}px 0 0;gap:${z(8)}px;width:${z(170)}px"><img src="${fav}" width="${z(16)}" height="${z(16)}">Voyager<b style="margin-left:auto;color:${c.dim}">×</b></span>
          <span class="tab" style="padding:${z(8)}px ${z(12)}px;gap:${z(8)}px;width:${z(150)}px;color:${c.dim}">${other}Search results<b style="margin-left:auto">×</b></span>
        </div>
        <div class="omni" style="background:${c.tab};padding:${z(6)}px ${z(10)}px"><span style="background:${c.field};border-radius:${z(14)}px;padding:${z(5)}px ${z(14)}px;color:${c.dim}">notes.example.ts.net</span></div>
      </div>`;
  };

  const taskbar = (dark, scale) => {
    const z = (n) => Math.round(n * scale);
    const size = z(24);
    const img = scale === 1 ? s24 : s36;
    const c = dark
      ? { bg: 'rgba(32,32,36,0.97)', fg: '#ffffff', pill: '#9aa0a6', on: '#aa89f8', hover: 'rgba(255,255,255,0.08)' }
      : { bg: 'rgba(238,238,242,0.97)', fg: '#1f1f1f', pill: '#8a8a8a', on: '#7a4fe0', hover: 'rgba(0,0,0,0.05)' };
    const slot = (inner, state = '') =>
      `<span class="slot" style="width:${z(40)}px;height:${z(40)}px;border-radius:${z(4)}px;${state === 'on' ? `background:${c.hover}` : ''}">${inner}${state ? `<i style="width:${z(state === 'on' ? 16 : 6)}px;height:${z(3)}px;background:${state === 'on' ? c.on : c.pill};bottom:${z(1)}px"></i>` : ''}</span>`;
    const glyph = (name) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="color:${c.fg}">${glyphs[name]}</svg>`;
    const gen = (i) => tile(neutral[i][0], neutral[i][1], size, 0.2);
    return `<div class="taskbar" style="background:${c.bg};color:${c.fg};height:${z(48)}px;font-size:${z(12)}px">
        <div class="center" style="gap:${z(4)}px">${slot(glyph('start'))}${slot(glyph('search'))}${slot(gen(9), 'run')}${slot(gen(10), 'run')}${slot(gen(4))}${slot(`<img src="${img}" width="${size}" height="${size}">`, 'on')}${slot(gen(2))}</div>
        <div class="clock" style="right:${z(14)}px;line-height:1.3">14:05<br>03/11/2026</div>
      </div>`;
  };

  const zoom = (src, px, k) => `<img class="px" src="${src}" width="${px * k}" height="${px * k}">`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Voyager icon</title><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: 2400px; padding: 56px 64px 64px; background: #f4f2f8; font: 17px/1.45 'Segoe UI', system-ui, sans-serif; color: #2b2540; }
    h1 { font-size: 34px; margin: 0 0 6px; letter-spacing: -0.3px; }
    .lede { margin: 0 0 40px; color: #6b6480; max-width: 1500px; }
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1.2px; color: #7a7290; margin: 0 0 18px; font-weight: 600; }
    .grid { display: grid; grid-template-columns: 560px 836px minmax(0, 1fr); gap: 40px; align-items: start; }
    .card { background: #fff; border-radius: 22px; padding: 28px; box-shadow: 0 1px 2px rgba(30,20,60,.06), 0 8px 30px rgba(30,20,60,.06); }
    figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    figcaption { font-size: 14px; color: #6b6480; text-align: center; }
    .big img { filter: drop-shadow(0 18px 36px rgba(43,26,118,.3)); }
    .mask { position: relative; width: 320px; height: 320px; }
    .mask img { display: block; border-radius: 50%; }
    .mask::after { content: ''; position: absolute; inset: 32px; border-radius: 50%; border: 2px dashed rgba(255,255,255,.75); }
    .row { display: flex; gap: 36px; align-items: flex-end; justify-content: center; }
    .phone { width: 780px; max-width: 100%; margin: 0 auto; border-radius: 100px; padding: 20px; background: #1b1b1f; box-shadow: 0 30px 70px rgba(20,10,50,.28); }
    .screen { border-radius: 80px; height: 1240px; padding: 150px 56px 0; position: relative; overflow: hidden;
      background: radial-gradient(800px 600px at 20% 10%, #cfd8e3, transparent 70%), radial-gradient(900px 700px at 90% 90%, #a3afc0, transparent 70%), linear-gradient(#bcc6d2, #8e9aab); }
    .status { position: absolute; top: 38px; left: 92px; right: 84px; display: flex; justify-content: space-between; font: 600 34px -apple-system, 'Segoe UI', sans-serif; color: #111; }
    .island { position: absolute; top: 28px; left: 50%; width: 250px; height: 72px; margin-left: -125px; background: #000; border-radius: 40px; }
    .apps { display: grid; grid-template-columns: repeat(4, 120px); justify-content: space-between; row-gap: 52px; }
    .app { display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .app > span:last-child { font: 500 24px -apple-system, 'SF Pro Text', 'Segoe UI', sans-serif; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,.35); }
    .ios { border-radius: 27px; display: block; }
    .gen { display: inline-flex; align-items: center; justify-content: center; flex: none; }
    .dock { position: absolute; left: 28px; right: 28px; bottom: 28px; height: 184px; border-radius: 64px; background: rgba(255,255,255,.3); display: flex; justify-content: space-around; align-items: center; padding: 0 28px; }
    .browser { border-radius: 10px 10px 0 0; overflow: hidden; }
    .tabs { display: flex; align-items: flex-end; } .tab { display: inline-flex; align-items: center; white-space: nowrap; }
    .tab b { font-weight: 400; } .omni { display: flex; } .omni span { flex: 1; }
    .stack { display: flex; flex-direction: column; gap: 18px; }
    .px { image-rendering: pixelated; border: 1px solid #e3dff0; }
    .taskbar { position: relative; display: flex; align-items: center; justify-content: center; border-radius: 0 0 10px 10px; }
    .center { display: flex; } .slot { position: relative; display: inline-flex; align-items: center; justify-content: center; }
    .slot i { position: absolute; left: 50%; transform: translateX(-50%); border-radius: 3px; }
    .clock { position: absolute; text-align: right; }
    .desk { padding: 70px 0 0; border-radius: 10px; overflow: hidden; background: linear-gradient(135deg, #cfd8e6, #9fb0c8); }
    .desk.dark { background: linear-gradient(135deg, #2c3442, #151a22); }
  </style></head><body>
    <h1>Voyager: the Golden Record</h1>
    <p class="lede">Every image is at its real size in pixels. From 48 px down the icon is the simplified drawing (one darker groove band, a lighter label, a bigger spindle hole); 16 and 32 px are also shown 8× larger, pixel for pixel.</p>
    <div class="grid">
      <div class="stack">
        <div class="card big"><h2>512 px, rounded tile</h2><figure><img src="${big}" width="512" height="512"></figure></div>
        <div class="card"><h2>Full bleed under a maskable circle</h2><div class="row">
          <figure><div class="mask"><img src="${bleed}" width="320" height="320"></div><figcaption>Dashed: the 80% safe zone</figcaption></figure>
        </div></div>
        <div class="card"><h2>Small sizes</h2><div class="row">
          <figure><img src="${touch}" width="180" height="180" style="border-radius:40px"><figcaption>180</figcaption></figure>
          <figure><img src="${s48}" width="48" height="48"><figcaption>48</figcaption></figure>
          <figure><img src="${s32}" width="32" height="32"><figcaption>32</figcaption></figure>
          <figure><img src="${s16}" width="16" height="16"><figcaption>16</figcaption></figure>
        </div><div class="row" style="margin-top:26px">
          <figure>${zoom(s32, 32, 8)}<figcaption>32 px, 8×</figcaption></figure>
          <figure>${zoom(s16, 16, 8)}<figcaption>16 px, 8×</figcaption></figure>
        </div></div>
      </div>
      <div class="card"><h2>iPhone Home Screen, at 2× (the icon is 120 px)</h2>
        <div class="phone"><div class="screen"><div class="island"></div><div class="status"><span>9:41</span><span>100%</span></div>
          <div class="apps">${home}</div>
          <div class="dock">${[0, 4, 5, 10].map((i) => tile(neutral[i][0], neutral[i][1], 120)).join('')}</div>
        </div></div>
      </div>
      <div class="stack">
        <div class="card"><h2>Browser tab, 16 px (100%)</h2><div class="stack">${tabbar(true, 1)}${tabbar(false, 1)}</div></div>
        <div class="card"><h2>Browser tab, 32 px (200%, a hi-DPI screen)</h2><div class="stack">${tabbar(true, 2)}${tabbar(false, 2)}</div></div>
        <div class="card"><h2>Windows 11 taskbar, 100% (24 px) and 150% (36 px)</h2><div class="stack">
          <div class="desk dark">${taskbar(true, 1)}</div>
          <div class="desk">${taskbar(false, 1)}</div>
          <div class="desk dark">${taskbar(true, 1.5)}</div>
          <div class="desk">${taskbar(false, 1.5)}</div>
        </div></div>
      </div>
    </div>
  </body></html>`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out.replace(/\.png$/i, '') + '.html', html);
  await page.setViewportSize({ width: 2400, height: 1200 });
  await page.setContent(html);
  await page.waitForLoadState('load');
  writeFileSync(out, await page.screenshot({ fullPage: true }));
  console.log(`preview  ${out} (and .html)`);
}

await browser.close();
