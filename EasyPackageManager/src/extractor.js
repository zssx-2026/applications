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
  return s ? parseInt(s, 8) || 0 : 0;
}

function isZero(buf, off) {
  for (let i = off; i < off + BLOCK; i++) if (buf[i] !== 0) return false;
  return true;
}

function parseTar(buffer) {
  const entries = [];
  let off = 0;
  while (off + BLOCK <= buffer.length) {
    if (isZero(buffer, off)) break;
    const h = buffer.subarray(off, off + BLOCK);
    const size = readOctal(h, 124, 12);
    const type = String.fromCharCode(h[156] || 48);
    let name = readString(h, 0, 100);
    const prefix = readString(h, 345, 155);
    if (prefix) name = prefix + '/' + name;
    const dataStart = off + BLOCK;
    const dataEnd = dataStart + size;
    const next = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    entries.push({ name, type, size, data: type === '0' ? buffer.subarray(dataStart, dataEnd) : null });
    off = next;
  }
  return entries;
}

function extractTarGz(buf, destDir) {
  const tar = zlib.gunzipSync(buf);
  const entries = parseTar(tar);
  const root = path.resolve(destDir);
  for (const e of entries) {
    let rel = e.name.replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = rel.split('/').filter(Boolean);
    if (parts.length <= 1) continue;
    rel = parts.slice(1).join('/');
    if (!rel) continue;
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) continue;
    if (e.type === '5') {
      fs.mkdirSync(target, { recursive: true });
    } else if (e.data) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, e.data);
    }
  }
}

module.exports = { extractTarGz };
