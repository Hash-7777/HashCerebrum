import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const iconDir = new URL('../src-tauri/icons/', import.meta.url);

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

function isInEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function makePng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const bg = [10, 14, 20, 255];
  const shell = [17, 22, 31, 255];
  const teal = [95, 179, 168, 255];
  const tealDark = [74, 145, 140, 255];
  const tealBase = [64, 132, 132, 255];
  const bone = [230, 236, 243, 255];

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;

    for (let x = 0; x < size; x += 1) {
      const i = row + 1 + x * 4;
      let color = bg;
      const cx = size / 2;
      const cy = size / 2;
      const dx = x - cx;
      const dy = y - cy;
      const r = size * 0.42;
      const inDisc = dx * dx + dy * dy <= r * r;

      if (inDisc) color = shell;
      if (isInEllipse(x, y, size * 0.42, size * 0.47, size * 0.17, size * 0.25)) color = teal;
      if (isInEllipse(x, y, size * 0.58, size * 0.47, size * 0.17, size * 0.25)) color = tealDark;
      if (isInEllipse(x, y, size * 0.5, size * 0.61, size * 0.24, size * 0.13)) color = tealBase;
      if (Math.abs(x - size * 0.5) < Math.max(1, size * 0.012) && y > size * 0.27 && y < size * 0.66) color = bg;
      if (inDisc && Math.abs(dx * 0.7 + dy) < size * 0.012 && y < size * 0.42) color = bone;

      raw[i] = color[0];
      raw[i + 1] = color[1];
      raw[i + 2] = color[2];
      raw[i + 3] = color[3];
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const dir = Buffer.alloc(16);
  dir[0] = 0;
  dir[1] = 0;
  dir[2] = 0;
  dir[3] = 0;
  dir.writeUInt16LE(1, 4);
  dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(png.length, 8);
  dir.writeUInt32LE(22, 12);

  return Buffer.concat([header, dir, png]);
}

function icnsChunk(type, data) {
  const head = Buffer.alloc(8);
  head.write(type, 0, 4, 'ascii');
  head.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([head, data]);
}

function makeIcns(png128, png256) {
  const body = Buffer.concat([icnsChunk('ic07', png128), icnsChunk('ic08', png256)]);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

await mkdir(iconDir, { recursive: true });

const png32 = makePng(32);
const png128 = makePng(128);
const png256 = makePng(256);

await writeFile(new URL('32x32.png', iconDir), png32);
await writeFile(new URL('128x128.png', iconDir), png128);
await writeFile(new URL('128x128@2x.png', iconDir), png256);
await writeFile(new URL('icon.ico', iconDir), makeIco(png256));
await writeFile(new URL('icon.icns', iconDir), makeIcns(png128, png256));
