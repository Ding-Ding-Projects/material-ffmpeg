import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const output = resolve('resources/app-icon.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const lengthSquared = vx * vx + vy * vy;
  const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSquared));
  return Math.hypot(px - (ax + amount * vx), py - (ay + amount * vy));
}

function render(size) {
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(stride * size);
  const radius = size * 0.23;
  const half = size / 2;
  const teal = [94, 234, 212, 255];
  const ink = [6, 41, 37, 255];
  const strokes = [
    [0.29, 0.72, 0.29, 0.28],
    [0.29, 0.28, 0.5, 0.57],
    [0.5, 0.57, 0.71, 0.28],
    [0.71, 0.28, 0.71, 0.72]
  ];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.max(Math.abs(x + 0.5 - half) - (half - radius), 0);
      const dy = Math.max(Math.abs(y + 0.5 - half) - (half - radius), 0);
      const inside = dx * dx + dy * dy <= radius * radius;
      const offset = y * stride + 1 + x * 4;
      if (!inside) continue;
      let color = teal;
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      if (strokes.some(([ax, ay, bx, by]) => distanceToSegment(nx, ny, ax, ay, bx, by) <= 0.055)) color = ink;
      raw.set(color, offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const images = sizes.map((size) => ({ size, png: render(size) }));
const iconHeader = Buffer.alloc(6 + images.length * 16);
iconHeader.writeUInt16LE(0, 0);
iconHeader.writeUInt16LE(1, 2);
iconHeader.writeUInt16LE(images.length, 4);
let offset = iconHeader.length;
images.forEach(({ size, png }, index) => {
  const entry = 6 + index * 16;
  iconHeader[entry] = size === 256 ? 0 : size;
  iconHeader[entry + 1] = size === 256 ? 0 : size;
  iconHeader.writeUInt16LE(1, entry + 4);
  iconHeader.writeUInt16LE(32, entry + 6);
  iconHeader.writeUInt32LE(png.length, entry + 8);
  iconHeader.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});

await mkdir(dirname(output), { recursive: true });
await writeFile(output, Buffer.concat([iconHeader, ...images.map(({ png }) => png)]));
console.log(`[icon] Generated ${sizes.join(', ')} px application icon: ${output}`);
