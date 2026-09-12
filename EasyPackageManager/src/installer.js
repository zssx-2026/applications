'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const platform = require('./platform');
const registry = require('./registry');
const sources = require('./sources');
const net = require('./net');
const extractor = require('./extractor');
const runner = require('./runner');
const i18n = require('./i18n');
const { ensureDir: ensureDir, rmrf: rmrf, copyDir: copyDir, log: log, formatBytes: formatBytes } = require('./utils');

async function install(nameOrPath, flags) {
  flags = flags || {};

  if (flags.p) {
    const localPath = typeof flags.p === 'string' ? flags.p : nameOrPath;
    if (!localPath) throw new Error(i18n.t('installUsage'));
    return installLocal(localPath, flags);
  }
  if (!nameOrPath) throw new Error(i18n.t('installUsage'));

  let name = nameOrPath;
  let wantFile = flags.f || null;
  const at = nameOrPath.indexOf('@');
  if (at !== -1) {
    name = nameOrPath.slice(0, at);
    wantFile = nameOrPath.slice(at + 1) || wantFile;
  }
  return installFromEpm(name, wantFile, flags);
}

async function installFromEpm(name, wantFile, flags) {
  let pkg = sources.find(name);

  if (!pkg && !wantFile) {
    const hit = sources.findByFile(name);
    if (hit) { pkg = hit.pkg; wantFile = hit.file.name; }
  }

  if (!pkg) throw new Error(i18n.t('pkgNotFound') + ': ' + name);
  if (!pkg.files || !pkg.files.length) throw new Error(name + ' ' + i18n.t('noFilesInPkg'));

  let asset;
  if (wantFile) {
    asset = pkg.files.find(function (f) { return f.name === wantFile; });
    if (!asset) {
      throw new Error(i18n.t('noFileInPkg') + ' ' + name + ': ' + wantFile + '\n  ' +
        i18n.t('availableFiles') + ': ' + pkg.files.map(function (f) { return f.name; }).join(', '));
    }
  } else {
    asset = platform.pickAsset(pkg.files, name);
    if (!asset) throw new Error(i18n.t('noSuitableFile') + ' (' + platform.platform + '/' + platform.arch + ')');
  }

  const isInstaller = runner.isInstallerType(asset.name);
  const downloadDir = flags.d
    ? path.resolve(flags.d)
    : (isInstaller ? config.get('tempdir') : config.get('installdir'));
  ensureDir(downloadDir);
  const dest = path.join(downloadDir, asset.name);

  if (!flags.q) {
    log.step(i18n.t('installingPkg') + ' ' + name + (pkg.version ? ' (' + pkg.version + ')' : ''));
    log.info(i18n.t('installingFile') + ': ' + asset.name + (asset.size ? ' (' + formatBytes(asset.size) + ')' : ''));
    log.info(i18n.t('installingPlatform') + ': ' + platform.platform + '/' + platform.arch);
  }

  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
    if (!flags.q) log.info(i18n.t('installingDownload') + ' ' + asset.url);
    await net.downloadWithRetry(asset.url, dest);
  } else if (!flags.q) {
    log.info(i18n.t('fileExistsSkipDownload') + ': ' + dest);
  }

  if (isInstaller) {
    if (flags['no-run']) {
      log.success(i18n.t('downloadDone') + ': ' + dest);
    } else {
      if (!flags.q) log.info(i18n.t('runningInstaller') + ' ' + asset.name);
      try {
        const code = await runner.runInstaller(dest, asset.name, flags);
        if (code === 0) log.success(i18n.t('installerDone'));
        else log.warn(i18n.t('installerExitCode') + ': ' + code);
      } catch (err) {
        log.error(i18n.t('installerFailed') + ': ' + err.message);
      }

      const keep = flags.k ? true : await runner.askYesNo(i18n.t('keepInstaller'), false);
      if (!keep) {
        try { fs.unlinkSync(dest); } catch (_) {}
        log.info(i18n.t('installerRemoved'));
      }
    }

    registry.add(name, {
      name: name, version: pkg.version || null, source: pkg.url || null,
      file: asset.name, path: dest, type: 'installer',
      installedAt: new Date().toISOString()
    });
    return;
  }

  const installdir = config.get('installdir');
  const finalDir = path.join(installdir, name);
  rmrf(finalDir);
  ensureDir(finalDir);

  if (!flags.q) log.info(i18n.t('installingExtract') + ' ' + finalDir);
  installFileInto(dest, asset.name, finalDir, flags);

  registry.add(name, {
    name: name, version: pkg.version || null, source: pkg.url || null,
    file: asset.name, path: finalDir, type: 'installed',
    installedAt: new Date().toISOString()
  });

  if (!flags.q) log.success(i18n.t('installingDone') + ' ' + name + ' -> ' + finalDir);
}

function installFileInto(srcFile, fileName, destDir, flags) {
  ensureDir(destDir);
  const lower = (fileName || '').toLowerCase();
  if (runner.isArchiveType(lower)) {
    const written = tryExtract(srcFile, fileName, destDir);
    if (written > 0) return;
  }
  copySingleFile(srcFile, fileName, destDir);
}

function tryExtract(srcFile, fileName, destDir) {
  const lower = (fileName || '').toLowerCase();
  const buf = fs.readFileSync(srcFile);
  try {
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return extractor.extractTarGz(buf, destDir, { strip: 1 });
    if (lower.endsWith('.tar')) return extractor.extractTar(buf, destDir, { strip: 1 });
    if (lower.endsWith('.zip')) return extractor.extractZip(buf, destDir, { strip: 0 });
    if (lower.endsWith('.gz')) {
      const out = path.join(destDir, path.basename(fileName, '.gz'));
      fs.writeFileSync(out, require('zlib').gunzipSync(buf));
      return 1;
    }
  } catch (_) { return -1; }
  return 0;
}

function copySingleFile(srcFile, fileName, destDir) {
  const target = path.join(destDir, fileName);
  ensureDir(path.dirname(target));
  fs.copyFileSync(srcFile, target);
  if (platform.isExecutable(fileName) || /\.(sh|bash|zsh|py|rb|pl)$/i.test(fileName)) platform.chmodExec(target);
}

async function installLocal(localPath, flags) {
  flags = flags || {};
  const fullPath = path.resolve(localPath);
  if (!fs.existsSync(fullPath)) throw new Error(i18n.t('pathNotExist') + ': ' + fullPath);

  const stat = fs.statSync(fullPath);
  const baseName = path.basename(fullPath);
  const name = flags.name || baseName.replace(/\.(tar\.gz|tgz|tar|zip|exe|msi|dmg|pkg|deb|rpm|appimage)$/i, '');

  if (stat.isFile() && runner.isInstallerType(baseName)) {
    if (!flags.q) log.step(i18n.t('runningInstaller') + ' ' + baseName);
    if (!flags['no-run']) {
      try {
        const code = await runner.runInstaller(fullPath, baseName, flags);
        if (code === 0) log.success(i18n.t('installerDone'));
        else log.warn(i18n.t('installerExitCode') + ': ' + code);
      } catch (err) { log.error(i18n.t('installerFailed') + ': ' + err.message); }
    } else {
      log.info(i18n.t('fileNotRun') + ': ' + fullPath);
    }
    registry.add(name, {
      name: name, version: null, source: 'local:' + fullPath,
      file: baseName, path: fullPath, type: 'installer',
      installedAt: new Date().toISOString()
    });
    return;
  }

  const installdir = config.get('installdir');
  const dest = path.join(installdir, name);
  if (!flags.q) log.step(i18n.t('installingFromLocal') + ' ' + name + ' <- ' + fullPath);
  ensureDir(installdir);
  rmrf(dest);
  ensureDir(dest);

  if (stat.isDirectory()) copyDir(fullPath, dest);
  else {
    if (runner.isArchiveType(baseName)) {
      const written = tryExtract(fullPath, baseName, dest);
      if (written <= 0) copySingleFile(fullPath, baseName, dest);
    } else copySingleFile(fullPath, baseName, dest);
  }

  registry.add(name, {
    name: name, version: null, source: 'local:' + fullPath,
    path: dest, type: 'installed', installedAt: new Date().toISOString()
  });
  if (!flags.q) log.success(i18n.t('installingDone') + ' ' + name + ' -> ' + dest);
}

async function addPackage(name, url, flags) {
  flags = flags || {};
  if (!name) throw new Error(i18n.t('addUsage'));
  if (!url) { log.warn(i18n.t('addNeedUrl')); return; }

  const tempdir = config.get('tempdir');
  ensureDir(tempdir);
  const urlPath = new URL(url).pathname;
  const fileName = flags.name || path.basename(urlPath) || name;
  const tmpFile = path.join(tempdir, fileName);

  log.step(i18n.t('addingPkg') + ' ' + name + ' <- ' + url);
  await net.downloadWithRetry(url, tmpFile);

  if (runner.isInstallerType(fileName) && !flags['no-run']) {
    try {
      const code = await runner.runInstaller(tmpFile, fileName, flags);
      if (code === 0) log.success(i18n.t('installerDone'));
      else log.warn(i18n.t('installerExitCode') + ': ' + code);
    } catch (err) { log.error(i18n.t('installerFailed') + ': ' + err.message); }
    const keep = flags.k ? true : await runner.askYesNo(i18n.t('keepInstaller'), false);
    if (!keep) { try { fs.unlinkSync(tmpFile); } catch (_) {} }
    registry.add(name, {
      name: name, version: null, source: url, file: fileName,
      path: keep ? tmpFile : '', type: 'installer',
      installedAt: new Date().toISOString()
    });
    return;
  }

  const installdir = config.get('installdir');
  const dest = path.join(installdir, name);
  rmrf(dest);
  ensureDir(dest);
  installFileInto(tmpFile, fileName, dest, flags);
  try { fs.unlinkSync(tmpFile); } catch (_) {}

  registry.add(name, {
    name: name, version: null, source: url, path: dest,
    type: 'added', installedAt: new Date().toISOString()
  });
  log.success(i18n.t('addingDone') + ' ' + name + ' -> ' + dest);
}

async function uninstall(name) {
  if (!name) throw new Error(i18n.t('uninstallUsage'));
  const info = registry.get(name);
  if (!info) throw new Error(i18n.t('notInstalled') + ': ' + name);

  if (info.type === 'installer') {
    if (info.path && fs.existsSync(info.path)) {
      const rm = await runner.askYesNo(i18n.t('removeDownloadedInstaller') + ' ' + info.path, false);
      if (rm) { try { fs.unlinkSync(info.path); } catch (_) {} log.info(i18n.t('deletedPath') + ' ' + info.path); }
    }
    registry.remove(name);
    log.success(i18n.t('uninstalled') + ' ' + name);
    log.info(i18n.t('installerUninstallHint'));
    return;
  }

  if (info.type !== 'registered' && info.path && fs.existsSync(info.path)) {
    rmrf(info.path);
    log.info(i18n.t('deletedPath') + ' ' + info.path);
  }
  registry.remove(name);
  log.success(i18n.t('uninstalled') + ' ' + name);
}

async function registerDisk(name, diskPath) {
  if (!name || !diskPath) throw new Error(i18n.t('redaddUsage'));
  const fullPath = path.resolve(diskPath);
  if (!fs.existsSync(fullPath)) throw new Error(i18n.t('pathNotExist') + ': ' + fullPath);
  registry.add(name, {
    name: name, version: null, source: 'disk', path: fullPath,
    type: 'registered', registeredAt: new Date().toISOString()
  });
  log.success(i18n.t('registered') + ' ' + name + ' -> ' + fullPath);
}

async function unregister(name) {
  if (!name) throw new Error(i18n.t('redelUsage'));
  const info = registry.get(name);
  if (!info) throw new Error(i18n.t('notRegistered') + ': ' + name);
  registry.remove(name);
  log.success(i18n.t('unregistered') + ' ' + name + ' (' + i18n.t('diskKeep') + ' ' + info.path + ')');
}

module.exports = {
  install: install, installFromEpm: installFromEpm, installLocal: installLocal,
  installFileInto: installFileInto,
  addPackage: addPackage, uninstall: uninstall,
  registerDisk: registerDisk, unregister: unregister
};
