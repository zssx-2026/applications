'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const BLOCK = 512;

function readString(buf, off, len) {
  const s = buf.subarray(off, off + len);
  const e = s.indexOf(0);
  return s.subarray(0, e === -1 ? s.length : e).toString('utf8');
}

function readOctal(buf, off, len) {
  const s = readString(buf, off, len).trim();
  return s ? (parseInt(s, 8) || 0) : 0;
}

function isZero(buf, off) { for (let i = off; i < off + BLOCK; i++) if (buf[i] !== 0) return false; return true; }

function parseTar(buffer) {
  const entries = [];
  let off = 0;
  while (off + BLOCK <= buffer.length) {
    if (isZero(buffer, off)) break;
    const h = buffer.subarray(off, off + BLOCK);
    const size = readOctal(h, 124, 12);
    const tb = h[156];
    const type = tb === 0 ? '0' : String.fromCharCode(tb);
    let name = readString(h, 0, 100);
    const prefix = readString(h, 345, 155);
    if (prefix) name = prefix + '/' + name;
    const dataStart = off + BLOCK;
    const dataEnd = dataStart + size;
    const next = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    entries.push({ name: name, type: type, size: size, data: type === '0' ? buffer.subarray(dataStart, dataEnd) : null });
    off = next;
  }
  return entries;
}

function extractTarBuffer(tarBuffer, destDir, options) {
  options = options || {};
  const strip = options.strip == null ? 1 : Number(options.strip);
  const entries = parseTar(tarBuffer);
  const root = path.resolve(destDir);
  let written = 0;

  for (const e of entries) {
    let rel = e.name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (strip > 0) {
      const parts = rel.split('/').filter(Boolean);
      if (parts.length <= strip) continue;
      rel = parts.slice(strip).join('/');
    }
    if (!rel) continue;
    const target = path.resolve(root, rel);
    if (target !== root && target.indexOf(root + path.sep) !== 0) continue;
    if (e.type === '5') { fs.mkdirSync(target, { recursive: true }); written++; }
    else if (e.data) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, e.data); written++; }
  }
  return written;
}

function extractTarGz(buf, destDir, options) { return extractTarBuffer(zlib.gunzipSync(buf), destDir, options); }
function extractTar(buf, destDir, options) { return extractTarBuffer(buf, destDir, options); }

function findEOCD(buf) {
  const minLen = 22;
  const maxBack = Math.min(buf.length, 65536 + minLen);
  for (let i = buf.length - minLen; i >= buf.length - maxBack && i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function extractZip(buf, destDir, options) {
  options = options || {};
  const strip = options.strip == null ? 0 : Number(options.strip);
  const root = path.resolve(destDir);

  const eocd = findEOCD(buf);
  if (eocd === -1) throw new Error('Not a valid ZIP');

  const totalEntries = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  let written = 0;

  for (let n = 0; n < totalEntries; n++) {
    if (off + 46 > buf.length) break;
    if (buf.readUInt32LE(off) !== 0x02014b50) break;

    const compression = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');

    off += 46 + nameLen + extraLen + commentLen;

    if (localOffset + 30 > buf.length) continue;
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;

    let fileData;
    try {
      if (compression === 0) fileData = buf.subarray(dataStart, dataStart + compSize);
      else if (compression === 8) fileData = zlib.inflateRawSync(buf.subarray(dataStart, dataStart + compSize));
      else continue;
    } catch (_) { continue; }

    let rel = name.replace(/\\/g, '/');
    const isDir = rel.endsWith('/');
    if (isDir) rel = rel.slice(0, -1);

    if (strip > 0) {
      const parts = rel.split('/').filter(Boolean);
      if (parts.length <= strip) continue;
      rel = parts.slice(strip).join('/');
    }
    if (!rel) continue;

    const target = path.resolve(root, rel);
    if (target !== root && target.indexOf(root + path.sep) !== 0) continue;

    if (isDir) fs.mkdirSync(target, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, fileData);
    }
    written++;
  }

  return written;
}

function autoExtract(filePath, fileName, destDir, options) {
  const lower = (fileName || path.basename(filePath)).toLowerCase();
  const buf = fs.readFileSync(filePath);

  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) { extractTarGz(buf, destDir, options || { strip: 1 }); return true; }
  if (lower.endsWith('.tar')) { extractTar(buf, destDir, options || { strip: 1 }); return true; }
  if (lower.endsWith('.zip')) { extractZip(buf, destDir, options || { strip: 0 }); return true; }
  if (lower.endsWith('.gz')) {
    const out = path.join(destDir, path.basename(fileName, '.gz'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, zlib.gunzipSync(buf));
    return true;
  }
  return false;
}

module.exports = {
  parseTar: parseTar,
  extractTar: extractTar,
  extractTarGz: extractTarGz,
  extractZip: extractZip,
  autoExtract: autoExtract
};
