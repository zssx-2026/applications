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
const killer = require('./killer');
const versionLib = require('./version');
const i18n = require('./i18n');
const { ensureDir: ensureDir, rmrf: rmrf, log: log, formatBytes: formatBytes } = require('./utils');

async function install(name, version, flags) {
  flags = flags || {};
  if (!name) throw new Error(i18n.t('installUsage'));

  const pkg = sources.find(name);
  if (!pkg) throw new Error(i18n.t('pkgNotFound') + ': ' + name);

  let target;
  if (version) {
    target = pkg.versions.find(function (v) { return v.version === version; });
    if (!target) {
      throw new Error(i18n.t('versionNotFound') + ': ' + name + '@' + version +
        '\n  ' + i18n.t('versionAvailable') + ': ' +
        pkg.versions.map(function (v) { return v.version; }).join(', '));
    }
  } else {
    target = pkg.latest;
    if (!target) throw new Error(name + ' ' + i18n.t('noFilesInPkg'));
  }

  if (!target.url) throw new Error(target.fileName + ' ' + i18n.t('pkgNoDownloadUrl'));

  const isInstaller = target.assetType === 'installer' ||
                      runner.isInstallerType(target.fileName);

  if (!flags.q) {
    log.step(i18n.t('installingPkg') + ' ' + pkg.name + ' v' + target.version +
             '  ' + target.fileName);
    if (target.company && target.company !== 'null') {
      log.info('company: ' + target.company);
    }
    log.info(i18n.t('installingPlatform') + ': ' + platform.platform + '/' + platform.arch);
  }

  // ── 安装前结束相关进程 ──
  const tryKill = flags.kill !== false;
  if (tryKill) {
    const n = await killer.killAndWait({
      name: pkg.name,
      fileName: target.fileName
    }, 800);
    if (n > 0 && !flags.q) {
      log.info(i18n.t('killedProcess') + ' ' + pkg.name);
    }
  }

  const tmpdir = config.get('tempdir');
  const installdir = config.get('installdir');
  ensureDir(tmpdir);
  ensureDir(installdir);

  const downloadDir = isInstaller ? tmpdir : path.join(installdir, pkg.name);
  ensureDir(downloadDir);
  const dest = path.join(downloadDir, target.fileName);

  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
    if (!flags.q) log.info(i18n.t('installingDownload') + ' ' + target.url);
    await net.downloadWithRetry(target.url, dest);
  }

  if (isInstaller) {
    if (flags['no-run']) {
      log.success(i18n.t('downloadDone') + ': ' + dest);
    } else {
      if (!flags.q) log.info(i18n.t('runningInstaller') + ' ' + target.fileName);
      try {
        const code = await runner.runInstaller(dest, target.fileName, flags);
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
  } else {
    log.info(i18n.t('installingExtract') + ' ' + downloadDir);
    if (runner.isArchiveType(target.fileName)) {
      try {
        const buf = fs.readFileSync(dest);
        const lower = target.fileName.toLowerCase();
        if (lower.endsWith('.zip')) extractor.extractZip(buf, downloadDir, { strip: 0 });
        else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) extractor.extractTarGz(buf, downloadDir, { strip: 1 });
        else if (lower.endsWith('.tar')) extractor.extractTar(buf, downloadDir, { strip: 1 });
      } catch (err) {
        log.error('extract failed: ' + err.message);
      }
      try { fs.unlinkSync(dest); } catch (_) {}
    }
    log.success(i18n.t('installingDone') + ' ' + pkg.name + ' -> ' + downloadDir);
  }

  registry.add(pkg.name, {
    name: pkg.name,
    version: target.version,
    company: target.company,
    type: target.type,
    fileName: target.fileName,
    source: target.htmlUrl || null,
    path: isInstaller ? dest : downloadDir,
    installedAt: new Date().toISOString()
  });

  versionLib.setCurrent(pkg.name, target.version);
}

async function uninstall(name) {
  if (!name) throw new Error(i18n.t('uninstallUsage'));
  const info = registry.get(name);
  if (!info) throw new Error(i18n.t('notInstalled') + ': ' + name);

  await killer.killAndWait({ name: name, fileName: info.fileName }, 500);

  if (info.path && fs.existsSync(info.path)) {
    try {
      const stat = fs.statSync(info.path);
      if (stat.isDirectory()) rmrf(info.path);
      else fs.unlinkSync(info.path);
      log.info(i18n.t('deletedPath') + ' ' + info.path);
    } catch (_) {}
  }
  registry.remove(name);
  versionLib.removeCurrent(name);
  log.success(i18n.t('uninstalled') + ' ' + name);
}

/**
 * 更新已安装的包
 * 自动静默 + 自动结束进程
 */
async function updatePackage(name, flags) {
  flags = Object.assign({ q: true }, flags || {});
  // update 强制静默
  flags.q = true;

  const installed = registry.list();
  if (!installed.length) {
    log.info(i18n.t('noInstalledPkgs'));
    return 0;
  }

  const targets = name
    ? installed.filter(function (p) { return p.name === name; })
    : installed;

  if (name && !targets.length) throw new Error(i18n.t('notInstalled') + ': ' + name);

  let count = 0;
  for (const inst of targets) {
    const pkg = sources.find(inst.name);
    if (!pkg || !pkg.latest) {
      log.warn(i18n.t('pkgNotFound') + ': ' + inst.name);
      continue;
    }
    if (versionLib.compareVer(pkg.latest.version, inst.version) <= 0) {
      log.info('  ' + inst.name + ' v' + inst.version + '  ' + i18n.t('updateAlreadyLatest'));
      continue;
    }

    log.info('  ' + inst.name + ' v' + inst.version + ' -> v' + pkg.latest.version);

    // 结束进程
    const n = await killer.killAndWait({
      name: inst.name,
      fileName: pkg.latest.fileName
    }, 800);
    if (n > 0) log.info('  ' + i18n.t('killedProcess') + ' ' + inst.name);

    // 静默安装
    await install(pkg.name, pkg.latest.version, {
      q: true,
      k: false,
      'no-run': false,
      kill: false   // 已经在外面 kill 过了
    });
    count++;
  }
  return count;
}

async function addPackage(name, url, flags) {
  flags = flags || {};
  if (!name) throw new Error(i18n.t('addUsage'));
  if (!url) { log.warn(i18n.t('addNeedUrl')); return; }

  const tempdir = config.get('tempdir');
  ensureDir(tempdir);
  const urlPath = new URL(url).pathname;
  const fileName = path.basename(urlPath) || name;
  const dest = path.join(tempdir, fileName);

  log.step(i18n.t('addingPkg') + ' ' + name + ' <- ' + url);
  await net.downloadWithRetry(url, dest);

  const isInstaller = runner.isInstallerType(fileName);

  if (isInstaller && !flags['no-run']) {
    try {
      const code = await runner.runInstaller(dest, fileName, flags);
      if (code === 0) log.success(i18n.t('installerDone'));
      else log.warn(i18n.t('installerExitCode') + ': ' + code);
    } catch (err) {
      log.error(i18n.t('installerFailed') + ': ' + err.message);
    }
    const keep = flags.k ? true : await runner.askYesNo(i18n.t('keepInstaller'), false);
    if (!keep) { try { fs.unlinkSync(dest); } catch (_) {} }
  }

  registry.add(name, {
    name: name, version: null, source: url, path: dest,
    type: isInstaller ? 'installer' : 'added',
    installedAt: new Date().toISOString()
  });
  log.success(i18n.t('addingDone') + ' ' + name);
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
  install: install,
  uninstall: uninstall,
  updatePackage: updatePackage,
  addPackage: addPackage,
  registerDisk: registerDisk,
  unregister: unregister
};
