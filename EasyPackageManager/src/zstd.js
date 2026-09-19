'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let _fzstd = null;
let _fzstdTried = false;

function getFzstd() {
  if (_fzstdTried) return _fzstd;
  _fzstdTried = true;
  try { _fzstd = require('fzstd'); }
  catch (_) { _fzstd = null; }
  return _fzstd;
}

function decompressZstd(buf) {
  const input = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);

  if (typeof zlib.zstdDecompressSync === 'function') {
    try { return zlib.zstdDecompressSync(input); }
    catch (_) {}
  }

  const fz = getFzstd();
  if (fz && typeof fz.decompress === 'function') {
    const out = fz.decompress(new Uint8Array(input));
    return Buffer.from(out);
  }

  throw new Error('zstd 解码不可用（Node 版本过低且 fzstd 未安装）');
}

function compressZstd(buf, level) {
  const input = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (typeof zlib.zstdCompressSync !== 'function') {
    throw new Error('需要 Node 22.15+ 才支持 zstd 压缩（当前 ' + process.version + '）');
  }
  return zlib.zstdCompressSync(input, { level: level || 3 });
}

function extractZstd(zstFile, destDir) {
  const { ensureDir } = require('./utils');
  ensureDir(destDir);

  const data = fs.readFileSync(zstFile);
  const out = decompressZstd(data);

  try {
    const extractor = require('./extractor');
    const n = extractor.extractTar(out, destDir, { strip: 0 });
    if (n > 0) return n;
  } catch (_) {}

  if (out.length >= 4 && out[0] === 0x50 && out[1] === 0x4B) {
    try {
      const extractor = require('./extractor');
      const n = extractor.extractZip(out, destDir, { strip: 0 });
      if (n > 0) return n;
    } catch (_) {}
  }

  let outName = 'content.bin';
  const base = path.basename(zstFile)
    .replace(/\.(zst|zstd|tzst)$/i, '')
    .replace(/\.(zip|tar|gz)$/i, '');
  if (base) outName = base;

  fs.writeFileSync(path.join(destDir, outName), out);
  return 1;
}

module.exports = { decompressZstd, compressZstd, extractZstd, getFzstd };
