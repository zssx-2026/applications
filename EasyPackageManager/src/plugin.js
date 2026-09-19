'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const net = require('./net');
const sources = require('./sources');
const i18n = require('./i18n');
const zstd = require('./zstd');
const { log, ensureDir, rmrf, formatBytes } = require('./utils');

const PLUGIN_DIR = path.join(config.DATA_DIR, 'plugins');
const PLUGIN_REG = path.join(config.DATA_DIR, 'plugins.json');

const FORMATS = {
  '.tar.zst': 'zstd', '.tzst': 'zstd', '.zstd': 'zstd', '.zst': 'zstd',
  '.tar.gz': 'targz', '.tgz': 'targz',
  '.zip': 'zip',
  '.tar': 'tar',
  '.gz': 'gzip'
};

function detectFormat(fileName) {
  const lower = String(fileName || '').toLowerCase();
  const exts = Object.keys(FORMATS).sort((a, b) => b.length - a.length);
  for (const ext of exts) {
    if (lower.endsWith(ext)) return FORMATS[ext];
  }
  return null;
}

/* ═══════════════ 注册表 ═══════════════ */

function loadReg() {
  try { return JSON.parse(fs.readFileSync(PLUGIN_REG, 'utf8')); }
  catch (_) { return { version: 1, plugins: {} }; }
}

function saveReg(d) {
  ensureDir(path.dirname(PLUGIN_REG));
  fs.writeFileSync(PLUGIN_REG, JSON.stringify(d, null, 2) + '\n', 'utf8');
}

function listInstalled() {
  return Object.values(loadReg().plugins || {}).sort((a, b) => a.name.localeCompare(b.name));
}

function getInstalled(name) {
  return (loadReg().plugins || {})[name] || null;
}

function setInstalled(name, info) {
  const reg = loadReg();
  reg.plugins[name] = Object.assign({}, reg.plugins[name], info, { name });
  saveReg(reg);
}

function removeInstalled(name) {
  const reg = loadReg();
  const existed = Boolean(reg.plugins[name]);
  delete reg.plugins[name];
  saveReg(reg);
  return existed;
}

/* ═══════════════ 可用插件 ═══════════════ */

function listAvailable() {
  const urls = sources.loadUrls();
  const releases = urls.releases || [];
  const map = new Map();

  for (const rel of releases) {
    if (rel.kind !== 'plugin') continue;
    const nt = rel.nameTxt;
    if (!nt || !nt.entries) continue;

    for (const e of nt.entries) {
      if (!map.has(e.name)) {
        map.set(e.name, { name: e.name, type: e.type, company: e.company, versions: [] });
      }
      const pkg = map.get(e.name);
      const asset = (rel.assets || []).find(a => a.name === e.fileName);
      pkg.versions.push({
        version: e.version,
        tag: rel.tag,
        fileName: e.fileName,
        size: asset ? asset.size : 0,
        url: asset ? asset.url : null,
        htmlUrl: rel.htmlUrl,
        publishedAt: rel.publishedAt,
        repo: rel.repo,
        format: detectFormat(e.fileName)
      });
    }
  }

  for (const p of map.values()) {
    p.versions.sort((a, b) => {
      const va = String(a.version).split('.').map(n => parseInt(n, 10) || 0);
      const vb = String(b.version).split('.').map(n => parseInt(n, 10) || 0);
      const len = Math.max(va.length, vb.length);
      for (let i = 0; i < len; i++) {
        const x = va[i] || 0, y = vb[i] || 0;
        if (x !== y) return x - y;
      }
      return 0;
    });
    p.latest = p.versions[p.versions.length - 1];
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function findAvailable(name) {
  if (!name) return null;
  const all = listAvailable();
  for (const p of all) if (p.name === name) return p;
  for (const p of all) if (p.name.toLowerCase() === name.toLowerCase()) return p;
  return null;
}

/* ═══════════════ 解压 ═══════════════ */

function extractAny(filePath, fileName, destDir) {
  const fmt = detectFormat(fileName);
  ensureDir(destDir);

  if (fmt === 'zstd') return zstd.extractZstd(filePath, destDir);

  const extractor = require('./extractor');
  const buf = fs.readFileSync(filePath);

  if (fmt === 'zip') return extractor.extractZip(buf, destDir, { strip: 0 });
  if (fmt === 'targz') return extractor.extractTarGz(buf, destDir, { strip: 0 });
  if (fmt === 'tar') return extractor.extractTar(buf, destDir, { strip: 0 });
  if (fmt === 'gzip') {
    const zlib = require('zlib');
    const out = zlib.gunzipSync(buf);
    fs.writeFileSync(path.join(destDir, path.basename(fileName, '.gz')), out);
    return 1;
  }

  fs.copyFileSync(filePath, path.join(destDir, path.basename(fileName)));
  return 1;
}

/* ═══════════════ 安装 ═══════════════ */

async function add(names, flags) {
  flags = flags || {};
  if (!names || !names.length) {
    log.error('用法: epm plugin add <name1,name2,...>');
    return;
  }

  ensureDir(PLUGIN_DIR);

  let okN = 0, failN = 0;
  for (const name of names) {
    try {
      const pkg = findAvailable(name);
      if (!pkg) { log.error('插件未找到: ' + name); failN++; continue; }
      const target = pkg.latest;
      if (!target || !target.url) { log.error('插件无下载: ' + name); failN++; continue; }

      const fmt = target.format || detectFormat(target.fileName) || 'raw';
      log.step('安装插件 ' + pkg.name + ' v' + target.version + '  [' + fmt + ']');

      const tmpdir = config.get('tempdir');
      ensureDir(tmpdir);
      const tmp = path.join(tmpdir, target.fileName);

      const tasks = require('./tasks');
      const dlTask = tasks.register('plugin:' + pkg.name, 'download');
      try {
        await net.downloadWithRetry(target.url, tmp, {
          task: dlTask, progress: !flags.q, expectedSize: target.size
        });
      } finally { tasks.unregister(dlTask); }

      const dest = path.join(PLUGIN_DIR, pkg.name);
      rmrf(dest);
      ensureDir(dest);

      const n = extractAny(tmp, target.fileName, dest);
      try { fs.unlinkSync(tmp); } catch (_) {}

      setInstalled(pkg.name, {
        name: pkg.name, version: target.version, repo: target.repo,
        fileName: target.fileName, format: fmt, path: dest,
        installedAt: new Date().toISOString()
      });

      log.success('已安装 ' + pkg.name + ' -> ' + dest + '  (' + n + ' 文件)');
      okN++;
    } catch (e) {
      failN++;
      log.error(name + ': ' + ((e && e.message) || String(e)));
    }
  }

  if (names.length > 1) {
    log.info('完成: ' + okN + ' ok' + (failN ? ' / ' + failN + ' fail' : ''));
  }
}

async function del(names) {
  if (!names || !names.length) {
    log.error('用法: epm plugin del <name1,...>');
    return;
  }
  for (const name of names) {
    const info = getInstalled(name);
    if (!info) { log.warn('未安装: ' + name); continue; }
    if (info.path && fs.existsSync(info.path)) {
      try { rmrf(info.path); } catch (_) {}
    }
    removeInstalled(name);
    log.success('已删除插件 ' + name);
  }
}

async function update(names) {
  ensureDir(PLUGIN_DIR);
  const installed = listInstalled();
  if (!installed.length) { log.info('未安装任何插件'); return; }

  const targets = (names && names.length)
    ? installed.filter(p => names.indexOf(p.name) !== -1)
    : installed;

  if (names && names.length && !targets.length) { log.warn('没有匹配的插件'); return; }

  try {
    const { fetchAll } = require('./update-lib');
    await fetchAll({});
  } catch (_) {}

  let okN = 0, skipN = 0;
  for (const inst of targets) {
    const pkg = findAvailable(inst.name);
    if (!pkg || !pkg.latest) { log.warn('  未找到 ' + inst.name); skipN++; continue; }
    if (pkg.latest.version === inst.version) {
      log.info('  ' + inst.name + ' v' + inst.version + '  已是最新');
      skipN++;
      continue;
    }
    log.info('  ' + inst.name + ' v' + inst.version + ' -> v' + pkg.latest.version);
    await add([inst.name], { q: true });
    okN++;
  }
  log.success('更新完成: ' + okN + ' 更新' + (skipN ? ' / ' + skipN + ' 跳过' : ''));
}

function search(keyword) {
  const all = listAvailable();
  const installedMap = {};
  for (const p of listInstalled()) installedMap[p.name] = p;
  const withInst = p => Object.assign({}, p, { installed: installedMap[p.name] || null });

  if (!keyword) return all.map(withInst);

  const lower = String(keyword).toLowerCase();
  return all.filter(p =>
    p.name.toLowerCase().indexOf(lower) !== -1 ||
    (p.company && p.company.toLowerCase().indexOf(lower) !== -1)
  ).map(withInst);
}

/* ═══════════════ pack：ZIP → ZST ═══════════════ */

function pack(zipPath, name, version, company, outDir) {
  if (!zipPath || !fs.existsSync(zipPath)) throw new Error('ZIP 文件不存在: ' + zipPath);
  if (!name) throw new Error('插件名不能为空');
  if (!version) throw new Error('版本不能为空');

  const fullZip = path.resolve(zipPath);
  const stat = fs.statSync(fullZip);
  if (!stat.isFile()) throw new Error('必须是文件');

  const fd = fs.openSync(fullZip, 'r');
  const head = Buffer.alloc(4);
  fs.readSync(fd, head, 0, 4, 0);
  fs.closeSync(fd);

  if (!(head[0] === 0x50 && head[1] === 0x4B)) {
    throw new Error('不是有效的 ZIP 文件（应以 PK 开头）');
  }

  const ver = String(version).replace(/^v/i, '');
  const outName = name + '-' + ver + '.zst';
  const target = path.join(outDir || process.cwd(), outName);

  const zipBuf = fs.readFileSync(fullZip);
  const zstBuf = zstd.compressZstd(zipBuf, 3);
  fs.writeFileSync(target, zstBuf);

  return {
    file: target,
    name: name,
    version: ver,
    company: company || 'null',
    sizeIn: stat.size,
    sizeOut: zstBuf.length,
    nameTxt: path.basename(fullZip) + ' v' + ver + ' ' + name + ' plugin ' + (company || 'null') + '\n'
  };
}

function pluginPath(name) {
  if (!name) return PLUGIN_DIR;
  return path.join(PLUGIN_DIR, name);
}

module.exports = {
  PLUGIN_DIR, PLUGIN_REG,
  listInstalled, getInstalled,
  listAvailable, findAvailable,
  add, del, update, search,
  pack, pluginPath, detectFormat
};
