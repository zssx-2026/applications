'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const github = require('./github');
const registry = require('./registry');
const { extractTarGz } = require('./extractor');
const config = require('./config');

const {
  ROOT, DOWNLOAD_TEMP,
  ensureDir, rmrf, download, log, color
} = require('./utils');

function parseSource(input) {
  const raw = String(input || '').trim();
  const url = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+))?/i);
  if (url) {
    return { owner: url[1], repo: url[2].replace(/\.git$/, ''), ref: url[3] || null, name: url[2] };
  }
  const m = raw.match(/^([^/]+)\/([^@#]+)(?:@([^#]+))?(?:#(.+))?$/);
  if (!m) throw new Error(`无法解析: ${input}`);
  return { owner: m[1], repo: m[2].replace(/\.git$/, ''), ref: m[3] || null, subpath: m[4] || null, name: m[2] };
}

async function install(spec, options = {}) {
  const src = parseSource(spec);
  const name = options.name || src.name;
  const pkgDir = path.join(ROOT, config.get('installDir', 'packages'), name);

  log.step(`安装 ${color.bold(name)} (${src.owner}/${src.repo}${src.ref ? '@' + src.ref : ''})`);

  const repo = await github.getRepo(src.owner, src.repo);
  if (!repo) throw new Error(`仓库不存在: ${src.owner}/${src.repo}`);

  const ref = src.ref || repo.default_branch;
  const tarUrl = `https://codeload.github.com/${src.owner}/${src.repo}/tar.gz/${ref}`;
  const tmp = path.join(DOWNLOAD_TEMP, `${name}-${Date.now()}.tar.gz`);

  ensureDir(DOWNLOAD_TEMP);
  ensureDir(path.dirname(pkgDir));

  log.info('下载源码包...');
  await download(tarUrl, tmp);

  log.info('解压...');
  rmrf(pkgDir);
  ensureDir(pkgDir);
  const buf = fs.readFileSync(tmp);
  extractTarGz(buf, pkgDir);
  rmrf(tmp);

  // 简单 bin 支持
  const binDir = path.join(ROOT, config.get('binDir', '.bin'));
  ensureDir(binDir);
  const pkgJson = path.join(pkgDir, 'package.json');
  if (fs.existsSync(pkgJson)) {
    try {
      const meta = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
      if (meta.bin) {
        const bins = typeof meta.bin === 'string' ? { [name]: meta.bin } : meta.bin;
        for (const [binName, rel] of Object.entries(bins)) {
          const target = path.join(pkgDir, rel);
          if (!fs.existsSync(target)) continue;
          const shim = path.join(binDir, binName);
          fs.writeFileSync(shim, `#!/bin/sh\nexec node "${target}" "$@"\n`);
          fs.chmodSync(shim, 0o755);
        }
      }
    } catch {}
  }

  registry.set(name, {
    name,
    source: `${src.owner}/${src.repo}`,
    ref,
    version: ref,
    dir: pkgDir,
    installedAt: new Date().toISOString()
  });

  log.success(`已安装 ${name} -> ${pkgDir}`);
}

function uninstall(name) {
  const info = registry.get(name);
  if (!info) throw new Error(`未安装: ${name}`);
  rmrf(info.dir);
  const binDir = path.join(ROOT, config.get('binDir', '.bin'));
  const shim = path.join(binDir, name);
  try { if (fs.existsSync(shim)) fs.unlinkSync(shim); } catch {}
  registry.remove(name);
  log.success(`已卸载 ${name}`);
}

module.exports = { install, uninstall, parseSource };
