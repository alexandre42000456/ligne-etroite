// Génère les icônes PNG de l'application (sans dépendance) : node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(out, { recursive: true });

const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; ih[10] = 0; ih[11] = 0; ih[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const sdBox = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

function icon(N) {
  const buf = Buffer.alloc(N * N * 3);
  const layers = [
    // [sdf(u,v), couleur]
    [(u, v) => -1, '#3d4147'],
    [(u, v) => sdBox(u, v, 0.12, 0.5, 0.2, 0.6, 0), '#b0603c'],
    [(u, v) => sdBox(u, v, 0.12, 0.25, 0.2, 0.004, 0), '#8f4c2f'],
    [(u, v) => sdBox(u, v, 0.12, 0.72, 0.2, 0.004, 0), '#8f4c2f'],
    [(u, v) => sdBox(u, v, 0.88, 0.5, 0.2, 0.6, 0), '#7b8189'],
    [(u, v) => sdBox(u, v, 0.88, 0.45, 0.2, 0.004, 0), '#5f646b'],
    [(u, v) => sdBox(u, v, 0.3, 0.5, 0.025, 0.6, 0), '#d9d2c4'],
    [(u, v) => sdBox(u, v, 0.7, 0.5, 0.025, 0.6, 0), '#d9d2c4'],
    [(u, v) => sdBox(u, v, 0.52, 0.56, 0.135, 0.4, 0.05), '#1a1c20'],
    [(u, v) => sdBox(u, v, 0.5, 0.54, 0.13, 0.4, 0.05), '#ff9f00'],
    [(u, v) => sdBox(u, v, 0.5, 0.56, 0.105, 0.36, 0.04), '#f6f3ea'],
    [(u, v) => sdBox(u, v, 0.5, 0.165, 0.11, 0.022, 0.02), '#22303b'],
    [(u, v) => sdBox(u, v, 0.5, 0.52, 0.055, 0.09, 0.015), '#c9cbcf'],
    [(u, v) => sdBox(u, v, 0.5, 0.76, 0.04, 0.04, 0.01), '#c9cbcf'],
  ].map(([f, c]) => [f, hex(c)]);
  const aa = 1.2 / N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N;
    let col = [0, 0, 0];
    for (const [f, c] of layers) {
      const d = f(u, v);
      const a = Math.min(1, Math.max(0, 0.5 - d / aa));
      if (a > 0) col = col.map((k, i) => k * (1 - a) + c[i] * a);
    }
    const o = (y * N + x) * 3;
    buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2];
  }
  return png(N, N, buf);
}

for (const n of [180, 192, 512]) writeFileSync(join(out, `icon-${n}.png`), icon(n));
console.log('Icônes générées dans', out);
