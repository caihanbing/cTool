import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const unpacked = path.join(dist, "ctool-2.0.0-unpacked");
const zipPath = path.join(dist, "ctool-2.0.0.zip");
if (!path.resolve(unpacked).startsWith(path.resolve(dist) + path.sep)) throw new Error("Refusing to write outside the package output directory.");
const files = ["manifest.json", "LICENSE", "README.md", "PRIVACY.md", "CHANGELOG.md", "docs/compatibility/curl.md"];
const directories = ["assets", "background", "popup", "src"];
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3 || manifest.version !== "2.0.0") throw new Error("The package must be a Manifest V3 cTool 2.0.0 build.");
if (manifest.permissions.includes("downloads")) throw new Error("The downloads permission is not used by the extension and must not be requested.");

async function walk(folder, prefix = "") {
  const output = [];
  for (const item of await readdir(folder, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in the release package: ${path.join(folder, item.name)}`);
    const absolute = path.join(folder, item.name);
    const relative = path.posix.join(prefix, item.name);
    if (item.isDirectory()) output.push(...await walk(absolute, relative));
    else if (item.isFile()) output.push({ absolute, relative });
  }
  return output;
}

const entries = [];
for (const file of files) {
  const absolute = path.join(root, ...file.split("/"));
  await readFile(absolute);
  entries.push({ absolute, relative: file });
}
for (const directory of directories) entries.push(...await walk(path.join(root, directory), directory));
for (const entry of entries) {
  if (/(^|\/)(node_modules|tests?|test-results|coverage|\.git)(\/|$)/i.test(entry.relative)) throw new Error(`Forbidden release content: ${entry.relative}`);
  if (/\.(?:map|log|tmp)$/i.test(entry.relative)) throw new Error(`Unexpected build artifact: ${entry.relative}`);
  if (/\.(?:html|js|mjs|css)$/i.test(entry.relative)) {
    const source = await readFile(entry.absolute, "utf8");
    if (/<script[^>]+src=["']https?:\/\//i.test(source) || /@import\s+(?:url\()?\s*["']?https?:\/\//i.test(source) || /from\s+["']https?:\/\//i.test(source)) {
      throw new Error(`Remote code is not allowed in the extension package: ${entry.relative}`);
    }
  }
}

await rm(unpacked, { recursive: true, force: true });
await mkdir(unpacked, { recursive: true });
for (const entry of entries) {
  const destination = path.join(unpacked, ...entry.relative.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(entry.absolute, destination);
}

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
const localParts = [];
const centralParts = [];
let offset = 0;
for (const entry of entries) {
  const name = Buffer.from(entry.relative.replaceAll("\\", "/"), "utf8");
  const contents = await readFile(entry.absolute);
  const compressed = deflateRawSync(contents, { level: 9 });
  const checksum = crc32(contents);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(contents.length, 22); local.writeUInt16LE(name.length, 26);
  localParts.push(local, name, compressed);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(contents.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
  centralParts.push(central, name);
  offset += local.length + name.length + compressed.length;
}
const centralDirectory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(offset, 16);
await mkdir(dist, { recursive: true });
await writeFile(zipPath, Buffer.concat([...localParts, centralDirectory, end]));

const packedNames = entries.map(({ relative }) => relative);
if (packedNames.some((name) => /(^|\/)(tests?|node_modules|test-results)(\/|$)/i.test(name))) throw new Error("The release ZIP includes development-only files.");
process.stdout.write(`Packaged ${entries.length} allowlisted files.\n`);
process.stdout.write(`Unpacked: ${path.relative(root, unpacked)}\nZIP: ${path.relative(root, zipPath)}\n`);
