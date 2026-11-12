import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "assets");
const sizes = [16, 32, 48, 128];
const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function makeIcon(size) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const scale = size / 128;
  const thickness = Math.max(2.4 * scale, size >= 32 ? 7.2 * scale : 5.6 * scale);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    pixels[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / scale;
      const ny = (y + 0.5) / scale;
      const cornerDistance = Math.hypot(Math.max(0, 12 - Math.min(nx, 128 - nx)), Math.max(0, 12 - Math.min(ny, 128 - ny)));
      const transparent = cornerDistance > 12;
      const angle = Math.atan2(ny - 63.5, nx - 63.5);
      const distance = Math.hypot(nx - 63.5, ny - 63.5);
      const open = Math.abs(angle) < 0.72;
      const ring = !open && Math.abs(distance - 37) < thickness / scale / 2;
      const ax = nx - 91;
      const ay = ny - 63.5;
      const arrowStem = nx >= 78 && nx <= 91 && Math.abs(ay) <= 3.8;
      const arrowUpper = ax >= -8 && ax <= 0 && Math.abs(ay + ax) <= 2.8;
      const arrowLower = ax >= -8 && ax <= 0 && Math.abs(ay - ax) <= 2.8;
      const index = row + 1 + x * 4;
      if (transparent) { pixels[index + 3] = 0; continue; }
      const gradient = Math.max(0, Math.min(1, ny / 128));
      pixels[index] = Math.round(23 + 9 * gradient);
      pixels[index + 1] = Math.round(105 + 52 * gradient);
      pixels[index + 2] = Math.round(197 + 31 * gradient);
      pixels[index + 3] = 255;
      if (ring || arrowStem || arrowUpper || arrowLower) {
        pixels[index] = 245; pixels[index + 1] = 250; pixels[index + 2] = 255;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0))]);
}

await mkdir(output, { recursive: true });
for (const size of sizes) await writeFile(path.join(output, `icon-${size}.png`), makeIcon(size));
process.stdout.write(`Generated cTool icons: ${sizes.join(", ")} px\n`);
