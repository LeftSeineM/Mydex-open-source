const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const size = 512;
const pixels = Buffer.alloc(size * size * 4);
const segments = [
  [151, 355, 151, 157], [151, 157, 256, 314],
  [256, 314, 361, 157], [361, 157, 361, 355]
];

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const index = (y * size + x) * 4;
    const inside = insideRoundedRect(x + .5, y + .5, 24, 24, 464, 464, 128);
    if (!inside) continue;
    const mix = Math.max(0, Math.min(1, (x + y - 48) / 880));
    pixels[index] = Math.round(41 * (1 - mix) + 17 * mix);
    pixels[index + 1] = Math.round(41 * (1 - mix) + 17 * mix);
    pixels[index + 2] = Math.round(38 * (1 - mix) + 16 * mix);
    pixels[index + 3] = 255;

    const mDistance = Math.min(...segments.map((segment) => lineDistance(x, y, ...segment)));
    if (mDistance < 21) {
      const shade = Math.max(0, Math.min(1, (x + y) / 1024));
      pixels[index] = Math.round(255 * (1 - shade) + 217 * shade);
      pixels[index + 1] = Math.round(255 * (1 - shade) + 216 * shade);
      pixels[index + 2] = Math.round(255 * (1 - shade) + 210 * shade);
    }

    const dotDistance = Math.hypot(x - 399, y - 111);
    if (dotDistance <= 22) {
      const inner = dotDistance <= 10;
      pixels[index] = inner ? 185 : 129;
      pixels[index + 1] = inner ? 180 : 120;
      pixels[index + 2] = 255;
    }
  }
}

const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y += 1) {
  const offset = y * (size * 4 + 1);
  raw[offset] = 0;
  pixels.copy(raw, offset + 1, y * size * 4, (y + 1) * size * 4);
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr(size, size)),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);
const target = path.join(__dirname, '..', 'assets', 'icon.png');
fs.writeFileSync(target, png);
console.log(`Generated ${target}`);

function insideRoundedRect(x, y, rx, ry, width, height, radius) {
  const nearestX = Math.max(rx + radius, Math.min(x, rx + width - radius));
  const nearestY = Math.max(ry + radius, Math.min(y, ry + height - radius));
  return Math.hypot(x - nearestX, y - nearestY) <= radius;
}

function lineDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1; const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function ihdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0); data.writeUInt32BE(height, 4);
  data[8] = 8; data[9] = 6; data[10] = 0; data[11] = 0; data[12] = 0;
  return data;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0); name.copy(output, 4); data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
