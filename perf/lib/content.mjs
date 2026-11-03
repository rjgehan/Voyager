// Deterministic building blocks for the generated vault: a seeded PRNG, words, PNG and PDF writers.
import zlib from 'node:zlib';

/** mulberry32: a small, fast, seeded PRNG; the same seed always gives the same vault. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    /** Skewed towards 0: most picks land in the first tenth of 0..n-1 (hot notes, common words). */
    skewed: (n) => Math.min(n - 1, Math.floor(Math.pow(next(), 3) * n)),
  };
}

/** Common English words, so typical searches ("meeting notes", "budget") hit realistic numbers of notes. */
export const COMMON = (
  'project meeting notes budget review plan design idea research summary draft report weekly quarterly ' +
  'customer product launch roadmap team goal task deadline follow up decision question answer problem ' +
  'solution feature release bug fix test deploy server client garden recipe travel book reading health ' +
  'workout family finance invoice tax house car school learning course lecture paper article podcast ' +
  'video music photo trip hotel flight dinner lunch coffee morning evening weekend holiday birthday ' +
  'gift shopping list home office kitchen budget spreadsheet calendar schedule agenda minutes action ' +
  'owner status risk issue milestone sprint backlog retro demo feedback interview hiring onboarding ' +
  'process policy security privacy backup archive migration database index search performance memory ' +
  'network storage cloud mobile desktop browser editor markdown table chart graph canvas sheet'
).split(/\s+/);

/** A few thousand pronounceable made-up words: rare terms, so searches also hit small result sets. */
export function syntheticWords(count, random) {
  const onsets = ['b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'z',
    'br', 'cr', 'dr', 'gl', 'pl', 'st', 'tr', 'th', 'sh', 'ch'];
  const vowels = ['a', 'e', 'i', 'o', 'u', 'ai', 'ea', 'oo', 'ou'];
  const codas = ['', '', 'n', 'r', 's', 'l', 'm', 'x', 'nd', 'rt', 'st', 'ng'];
  const words = new Set();
  while (words.size < count) {
    let word = '';
    const syllables = 2 + random.int(2);
    for (let s = 0; s < syllables; s++) {
      word += random.pick(onsets) + random.pick(vowels) + (s === syllables - 1 ? random.pick(codas) : '');
    }
    words.add(word);
  }
  return [...words];
}

/** Fills `width x height` with a pattern (gradient, or noise for photo-like, incompressible images). */
export function png(width, height, random, noise) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const r0 = random.int(256);
  const g0 = random.int(256);
  const b0 = random.int(256);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      if (noise) {
        raw[o++] = random.int(256);
        raw[o++] = random.int(256);
        raw[o++] = random.int(256);
      } else {
        raw[o++] = (r0 + x) & 255;
        raw[o++] = (g0 + y) & 255;
        raw[o++] = (b0 + ((x * y) >> 6)) & 255;
      }
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A valid PDF 1.4 with one Helvetica text stream per page (text the server's PDF indexer extracts). */
export function pdf(pages) {
  const objects = [];
  const pageCount = pages.length;
  // 1: catalog, 2: pages, 3: font, then page and content objects in pairs.
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((lines, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    const escaped = lines.map((line) => `(${line.replace(/[\\()]/g, (c) => '\\' + c)}) Tj T*`).join('\n');
    const stream = `BT /F1 11 Tf 14 TL 50 750 Td\n${escaped}\nET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** The n-th key of the `fractional-indexing` sequence (a0, a1, ..., az, b00, b01, ...). */
export function orderKey(n) {
  if (n < 62) {
    return 'a' + BASE62[n];
  }
  const m = n - 62;
  return 'b' + BASE62[Math.floor(m / 62) % 62] + BASE62[m % 62];
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID for `time` with a deterministic random part. */
export function ulid(time, random) {
  let t = time;
  let head = '';
  for (let i = 0; i < 10; i++) {
    head = CROCKFORD[t % 32] + head;
    t = Math.floor(t / 32);
  }
  let tail = '';
  for (let i = 0; i < 16; i++) {
    tail += CROCKFORD[random.int(32)];
  }
  return head + tail;
}

/** Spreadsheet column letters for a 0-based index (0 -> A, 26 -> AA). */
export function column(index) {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}
