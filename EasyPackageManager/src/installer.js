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
const tasks = require('./tasks');
const versionLib = require('./version');
const i18n = require('./i18n');
const { ensureDir, rmrf, copyDir, log, formatBytes } = require('./utils');

/**
 * 安装
 * @param {string} name
 * @param {string} version     版本号，null 为最新
 * @param {string} customPath  自定义安装路径（port/archive 生效），null 用默认
 * @param {object} flags
 */
async function install(name, version, customPath, flags) {
  // 兼容旧调用 install(name, version, flags)
  if (customPath && typeof customPath === 'object' && flags === undefined) {
    flags = customPath;
    customPath = null;
  }
  flags = flags || {};

  if (!name) throw new Error(i18n.t('installUsage'));

  const pkg = sources.find(name);
  if (!pkg) {
    let hint = '';
    try {
      const sug = sources.suggest(name, 3);
      if (sug && sug.length) {
        const names = sug.map(function (s) { return s.name; });
        hint = '\n  \u4f60\u662f\u4e0d\u662f\u60f3\u88c5: ' + names.join(' / ') + ' ?';
      }
    } catch (_) {}
    throw new Error(i18n.t('pkgNotFound') + ': ' + name + hint);
  }

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

  log.step(i18n.t('installingPkg') + ' ' + pkg.name + ' v' + target.version +
           '  ' + target.fileName);
  if (target.company && target.company !== 'null') log.info('company: ' + target.company);
  log.info(i18n.t('installingPlatform') + ': ' + platform.platform + '/' + platform.arch);
  if (customPath && !isInstaller) {
    log.info('安装路径: ' + path.resolve(customPath));
  }

  // 结束相关进程
  if (flags.kill !== false) {
    const n = await killer.killAndWait({ name: pkg.name, fileName: target.fileName }, 800);
    if (n > 0) log.info(i18n.t('killedProcess') + ' ' + pkg.name);
  }

  const tempdir = config.get('tempdir');
  ensureDir(tempdir);
  const dlDest = path.join(tempdir, target.fileName);

  // 下载（含完整性校验）
  let needDownload = true;
  if (fs.existsSync(dlDest)) {
    const curSize = fs.statSync(dlDest).size;
    if (target.size && curSize === target.size) {
      log.info(i18n.t('fileExistsSkipDownload') + ': ' + dlDest);
      needDownload = false;
    } else if (target.size && curSize !== target.size) {
      log.info('残文件 ' + formatBytes(curSize) + ' ≠ ' + formatBytes(target.size) + '，删除重下');
      try { fs.unlinkSync(dlDest); } catch (_) {}
    }
  }

  if (needDownload) {
    log.info(i18n.t('installingDownload') + ' ' + target.url);
    const dlTask = tasks.register(pkg.name, 'download');
    try {
      await net.downloadWithRetry(target.url, dlDest, {
        task: dlTask,
        progress: !flags.q,
        expectedSize: target.size
      });
    } finally {
      tasks.unregister(dlTask);
    }
  }

  // ═══ 安装程序 ═══
  if (isInstaller) {
    if (flags['no-run']) {
      log.success(i18n.t('downloadDone') + ': ' + dlDest);
    } else {
      log.info(i18n.t('runningInstaller') + ' ' + target.fileName);
      const instTask = tasks.register(pkg.name, 'install');
      try {
        const code = await runner.runInstaller(dlDest, target.fileName, flags);
        if (code === 0) log.success(i18n.t('installerDone'));
        else log.warn(i18n.t('installerExitCode') + ': ' + code);
      } catch (err) {
        log.error(i18n.t('installerFailed') + ': ' + err.message);
      } finally {
        tasks.unregister(instTask);
      }
      const keep = !!flags.k;
      if (!keep) {
        try { fs.unlinkSync(dlDest); } catch (_) {}
        log.info(i18n.t('installerRemoved'));
      }
    }

    registry.add(pkg.name, {
      name: pkg.name, version: target.version, company: target.company,
      type: target.type, fileName: target.fileName,
      source: target.htmlUrl || null,
      path: flags.k ? dlDest : '',
      installedAt: new Date().toISOString()
    });
    versionLib.setCurrent(pkg.name, target.version);
    return;
  }

  // ═══ 便携版 / 压缩包 ═══
  let finalDir;
  if (customPath) {
    const resolved = path.resolve(customPath);
    // 如果用户给的目录名已经是 pkg 名，直接用；否则拼一层 pkg.name
    const base = path.basename(resolved).toLowerCase();
    if (base === pkg.name.toLowerCase()) {
      finalDir = resolved;
    } else {
      finalDir = path.join(resolved, pkg.name);
    }
  } else {
    finalDir = path.join(config.get('installdir'), pkg.name);
  }

  rmrf(finalDir);
  ensureDir(finalDir);

  log.info(i18n.t('installingExtract') + ' ' + finalDir);

  if (runner.isArchiveType(target.fileName)) {
    try {
      const buf = fs.readFileSync(dlDest);
      const lower = target.fileName.toLowerCase();
      if (lower.endsWith('.zip')) extractor.extractZip(buf, finalDir, { strip: 0 });
      else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) extractor.extractTarGz(buf, finalDir, { strip: 1 });
      else if (lower.endsWith('.tar')) extractor.extractTar(buf, finalDir, { strip: 1 });
    } catch (err) {
      log.error('解压失败: ' + err.message);
    }
  } else {
    // 单文件（portable .exe 之类）
    const dst = path.join(finalDir, target.fileName);
    fs.copyFileSync(dlDest, dst);
    try { platform.chmodExec(dst); } catch (_) {}
  }

  try { fs.unlinkSync(dlDest); } catch (_) {}

  registry.add(pkg.name, {
    name: pkg.name, version: target.version, company: target.company,
    type: target.type, fileName: target.fileName,
    source: target.htmlUrl || null,
    path: finalDir,
    installedAt: new Date().toISOString()
  });
  versionLib.setCurrent(pkg.name, target.version);

  log.success(i18n.t('installingDone') + ' ' + pkg.name + ' -> ' + finalDir);
}

/* ═══════════ 卸载 ═══════════ */

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

/* ═══════════ 更新 ═══════════ */

async function updatePackage(name, flags) {
  flags = Object.assign({ q: true }, flags || {});
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

    // 保留原安装路径
    const customPath = inst.path || null;

    const n = await killer.killAndWait({
      name: inst.name,
      fileName: pkg.latest.fileName
    }, 800);
    if (n > 0) log.info('  ' + i18n.t('killedProcess') + ' ' + inst.name);

    await install(pkg.name, pkg.latest.version, customPath, {
      q: true, k: false, 'no-run': false, kill: false
    });
    count++;
  }
  return count;
}

/* ═══════════ 从 URL 添加 ═══════════ */

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

  const dlTask = tasks.register(name, 'download');
  try {
    await net.downloadWithRetry(url, dest, { task: dlTask, progress: !flags.q });
  } finally {
    tasks.unregister(dlTask);
  }

  const isInstaller = runner.isInstallerType(fileName);

  if (isInstaller && !flags['no-run']) {
    const instTask = tasks.register(name, 'install');
    try {
      const code = await runner.runInstaller(dest, fileName, flags);
      if (code === 0) log.success(i18n.t('installerDone'));
      else log.warn(i18n.t('installerExitCode') + ': ' + code);
    } catch (err) {
      log.error(i18n.t('installerFailed') + ': ' + err.message);
    } finally {
      tasks.unregister(instTask);
    }
    if (!flags.k) { try { fs.unlinkSync(dest); } catch (_) {} }
  }

  registry.add(name, {
    name: name, version: null, source: url, path: dest,
    type: isInstaller ? 'installer' : 'added',
    installedAt: new Date().toISOString()
  });
  log.success(i18n.t('addingDone') + ' ' + name);
}

/* ═══════════ 磁盘注册 ═══════════ */

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
