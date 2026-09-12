'use strict';

const path = require('path');
const platform = require('./platform');
const sources = require('./sources');
const net = require('./net');
const i18n = require('./i18n');
const { ensureDir: ensureDir, log: log, formatBytes: formatBytes } = require('./utils');

async function download(name, flags) {
  flags = flags || {};
  if (!name) throw new Error(i18n.t('downloadUsage'));

  let pkgName = name;
  let wantFile = flags.f || null;
  const at = name.indexOf('@');
  if (at !== -1) { pkgName = name.slice(0, at); wantFile = name.slice(at + 1) || wantFile; }

  let pkg = sources.find(pkgName);
  if (!pkg && !wantFile) {
    const hit = sources.findByFile(pkgName);
    if (hit) { pkg = hit.pkg; wantFile = hit.file.name; }
  }
  if (!pkg) throw new Error(i18n.t('pkgNotFound') + ': ' + pkgName);
  if (!pkg.files || !pkg.files.length) throw new Error(pkgName + ' ' + i18n.t('noFilesInPkg'));

  let asset;
  if (wantFile) {
    asset = pkg.files.find(function (f) { return f.name === wantFile; });
    if (!asset) {
      throw new Error(i18n.t('noFileInPkg') + ' ' + pkgName + ': ' + wantFile + '\n  ' +
        i18n.t('availableFiles') + ': ' + pkg.files.map(function (f) { return f.name; }).join(', '));
    }
  } else {
    asset = platform.pickAsset(pkg.files, pkgName);
  }

  const outName = flags.n || asset.name;
  const dest = path.resolve(process.cwd(), outName);

  log.step(i18n.t('downloadStep') + ' ' + pkgName + ' / ' + asset.name);
  if (asset.size) log.info(i18n.t('downloadSize') + ': ' + formatBytes(asset.size));
  ensureDir(path.dirname(dest));
  await net.downloadWithRetry(asset.url, dest);
  log.success(i18n.t('downloadDone') + ': ' + dest);
}

module.exports = { download: download };
