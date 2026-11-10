// Generates the PWA icons (PNG) and favicon (SVG) without external dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BG = [30, 64, 175];
const BG2 = [59, 130, 246];
const FG = [255, 255, 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function png(size, { maskable = false, rounded = true } = {}) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = rounded && !maskable ? size * 0.22 : 0;
  const pad = maskable ? size * 0.2 : size * 0.12; // safe zone for maskable icons
  const s = size - pad * 2;
  // letter K strokes (in unit square)
  const segs = [
    [0.28, 0.2, 0.28, 0.8],
    [0.72, 0.2, 0.3, 0.52],
    [0.42, 0.44, 0.74, 0.8],
  ];
  const w = 0.085 * s;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      // rounded rect alpha
      const cx = Math.max(r - x, 0, x - (size - 1 - r));
      const cy = Math.max(r - y, 0, y - (size - 1 - r));
      const inside = r === 0 || Math.hypot(cx, cy) <= r;
      const t = (x + y) / (2 * size);
      let col = BG.map((v, k) => Math.round(v + (BG2[k] - v) * t));
      const ux = (x - pad) / s, uy = (y - pad) / s;
      const d = Math.min(...segs.map(([ax, ay, bx, by]) => distSeg(ux * s, uy * s, ax * s, ay * s, bx * s, by * s)));
      if (d < w) col = FG;
      else if (d < w + 1) col = col.map((v, k) => Math.round(v + (FG[k] - v) * (w + 1 - d)));
      raw[i] = col[0];
      raw[i + 1] = col[1];
      raw[i + 2] = col[2];
      raw[i + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(join(out, 'pwa-192.png'), png(192));
writeFileSync(join(out, 'pwa-512.png'), png(512));
writeFileSync(join(out, 'pwa-maskable-512.png'), png(512, { maskable: true }));
writeFileSync(join(out, 'apple-touch-icon.png'), png(180, { rounded: false }));
writeFileSync(
  join(out, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e40af"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><path d="M21 16v32M45 16 22 34M30 30l18 18" stroke="#fff" stroke-width="6.5" stroke-linecap="round" fill="none"/></svg>`,
);
writeFileSync(join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log('Icons generated in public/');
