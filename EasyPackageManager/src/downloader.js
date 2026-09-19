'use strict';

const path = require('path');
const sources = require('./sources');
const net = require('./net');
const i18n = require('./i18n');
const { ensureDir: ensureDir, log: log, formatBytes: formatBytes } = require('./utils');

async function download(name, version, flags) {
  flags = flags || {};
  if (!name) throw new Error(i18n.t('downloadUsage'));

  const pkg = sources.find(name);
  if (!pkg) throw new Error(i18n.t('pkgNotFound') + ': ' + name);

  let target;
  if (version) {
    target = pkg.versions.find(function (v) { return v.version === version; });
    if (!target) throw new Error(i18n.t('versionNotFound') + ': ' + name + '@' + version);
  } else {
    target = pkg.latest;
  }
  if (!target) throw new Error(name + ' ' + i18n.t('noFilesInPkg'));

  const outName = flags.n || target.fileName;
  const dest = path.resolve(process.cwd(), outName);

  log.step(i18n.t('downloadStep') + ' ' + pkg.name + ' v' + target.version);
  if (target.size) log.info(i18n.t('downloadSize') + ': ' + formatBytes(target.size));
  ensureDir(path.dirname(dest));
  await net.downloadWithRetry(target.url, dest, { expectedSize: target.size });
  log.success(i18n.t('downloadDone') + ': ' + dest);
}

module.exports = { download: download };
