/**
 * Generates the PWA icon set with no image dependency.
 *
 * Writes minimal but fully valid PNGs (IHDR/IDAT/IEND, zlib-deflated RGBA
 * scanlines) so `npm run icons` is reproducible on any machine with Node.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const ACCENT = [47, 79, 143];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, pixelAt) {
  // Raw scanlines, each prefixed with filter byte 0 (None).
  const raw = Buffer.alloc(height * (1 + width * 4));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance from point to a line segment, for stroke drawing. */
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * A checkmark on a rounded square — the app's mark.
 * `inset` shrinks the artwork for maskable icons' safe zone.
 */
function makeIcon(size, { maskable = false } = {}) {
  const inset = maskable ? size * 0.1 : 0;
  const box = size - inset * 2;
  const radius = maskable ? 0 : size * 0.22;
  const stroke = box * 0.085;

  // Checkmark geometry in normalised box coordinates.
  const ax = inset + box * 0.28, ay = inset + box * 0.52;
  const bx = inset + box * 0.44, by = inset + box * 0.67;
  const cx = inset + box * 0.73, cy = inset + box * 0.35;

  return png(size, size, (x, y) => {
    const px = x + 0.5, py = y + 0.5;

    // Rounded-rect background (full-bleed when maskable).
    let inside;
    if (maskable) {
      inside = true;
    } else {
      const rx = Math.max(radius - px, px - (size - radius), 0);
      const ry = Math.max(radius - py, py - (size - radius), 0);
      inside = Math.hypot(rx, ry) <= radius;
    }
    if (!inside) return [0, 0, 0, 0];

    const d = Math.min(
      distToSegment(px, py, ax, ay, bx, by),
      distToSegment(px, py, bx, by, cx, cy),
    );
    // Antialias the stroke edge over one pixel.
    const t = Math.max(0, Math.min(1, (stroke / 2 + 0.5 - d)));
    const [r, g, b] = ACCENT;
    const [wr, wg, wb] = WHITE;
    return [
      Math.round(r + (wr - r) * t),
      Math.round(g + (wg - g) * t),
      Math.round(b + (wb - b) * t),
      255,
    ];
  });
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon-192.png'), makeIcon(192));
writeFileSync(join(OUT, 'icon-512.png'), makeIcon(512));
writeFileSync(join(OUT, 'icon-maskable-512.png'), makeIcon(512, { maskable: true }));
console.log('Wrote icon-192.png, icon-512.png, icon-maskable-512.png to public/icons');
