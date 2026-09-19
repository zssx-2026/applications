'use strict';

const path = require('path');
const config = require('./config');
const versionLib = require('./version');
const { readJson } = require('./utils');

const URL_FILE = path.join(config.ROOT, 'url.json');

function loadUrls() {
  return readJson(URL_FILE, {}) || {};
}

/* ═══════════════ 包列表 ═══════════════ */

function listPackages() {
  const urls = loadUrls();
  const releases = urls.releases || [];
  const map = new Map();

  for (const rel of releases) {
    const nt = rel.nameTxt;
    if (!nt || !nt.entries) continue;
    for (const e of nt.entries) {
      if (!map.has(e.name)) {
        map.set(e.name, {
          name: e.name,
          type: e.type,
          company: e.company,
          versions: []
        });
      }
      const pkg = map.get(e.name);
      const asset = (rel.assets || []).find(function (a) { return a.name === e.fileName; });
      pkg.versions.push({
        version: e.version,
        tag: rel.tag,
        fileName: e.fileName,
        type: e.type,
        company: e.company,
        url: asset ? asset.url : null,
        size: asset ? asset.size : 0,
        assetType: asset ? asset.type : 'unknown',
        publishedAt: rel.publishedAt,
        htmlUrl: rel.htmlUrl,
        repo: rel.repo || null
      });
    }
  }

  for (const pkg of map.values()) {
    pkg.versions.sort(function (a, b) { return versionLib.compareVer(a.version, b.version); });
    pkg.latest = pkg.versions[pkg.versions.length - 1];
  }

  return Array.from(map.values()).sort(function (a, b) {
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

/* ═══════════════ 查找 ═══════════════ */

function find(name) {
  if (!name) return null;
  for (const p of listPackages()) {
    if (p.name === name) return p;
  }
  for (const p of listPackages()) {
    if (p.name.toLowerCase() === String(name).toLowerCase()) return p;
  }
  return null;
}

function findFuzzy(name) {
  const all = listPackages();
  const lower = String(name || '').toLowerCase();
  for (const p of all) if (p.name.toLowerCase() === lower) return p;
  for (const p of all) if (p.name.toLowerCase().indexOf(lower) === 0) return p;
  for (const p of all) if (p.name.toLowerCase().indexOf(lower) !== -1) return p;
  return null;
}

function findByFile(name) {
  if (!name) return null;
  const lower = String(name).toLowerCase();
  const all = listPackages();
  for (const p of all) {
    for (const f of p.versions) {
      if (f.fileName.toLowerCase() === lower) return { pkg: p, file: f };
    }
  }
  for (const p of all) {
    for (const f of p.versions) {
      if (f.fileName.toLowerCase().indexOf(lower) !== -1) return { pkg: p, file: f };
    }
  }
  return null;
}

/* ═══════════════ 平台选择 ═══════════════ */

function pickForCurrentPlatform(pkg) {
  if (!pkg || !pkg.versions || !pkg.versions.length) return null;
  try {
    const platform = require('./platform');
    return platform.pickAsset(pkg.versions, pkg.name);
  } catch (_) {
    return pkg.latest;
  }
}

/* ═══════════════ 统计 ═══════════════ */

function stats() {
  const urls = loadUrls();
  const releases = urls.releases || [];
  const pkgs = listPackages();
  let fileCount = 0;
  for (const r of releases) fileCount += (r.assets || []).length;
  return {
    releaseCount: releases.length,
    pkgCount: pkgs.length,
    fileCount: fileCount,
    updatedAt: urls.updatedAt || null
  };
}

/* ═══════════════ 搜索 ═══════════════ */

function search(opts) {
  opts = opts || {};
  const text = (opts.text || '').toLowerCase();
  const type = opts.type || null;
  const company = opts.company || null;
  const exclC = opts.excludeCompanies || [];
  const version = opts.version || null;
  const exclV = opts.excludeVersions || [];
  const fullWord = opts.fullWord;
  const allVersions = opts.allVersions;

  const results = [];
  for (const pkg of listPackages()) {
    if (type && pkg.type !== type) continue;

    if (company && pkg.company.toLowerCase().indexOf(company.toLowerCase()) === -1) continue;
    if (exclC.length) {
      let ex = false;
      for (const c of exclC) {
        if (pkg.company.toLowerCase() === c.toLowerCase()) { ex = true; break; }
      }
      if (ex) continue;
    }

    if (text) {
      const m = fullWord
        ? pkg.name.toLowerCase() === text
        : pkg.name.toLowerCase().indexOf(text) !== -1;
      if (!m) continue;
    }

    let mv = pkg.versions.slice();
    if (version) mv = mv.filter(function (v) { return v.version === version; });
    if (exclV.length) mv = mv.filter(function (v) { return exclV.indexOf(v.version) === -1; });
    if (!mv.length) continue;

    results.push(Object.assign({}, pkg, {
      versions: allVersions ? mv : [mv[mv.length - 1]],
      latest: mv[mv.length - 1]
    }));
  }
  return results;
}

/* ═══════════════ 拼写建议 ═══════════════ */

function editDistance(a, b) {
  a = String(a).toLowerCase();
  b = String(b).toLowerCase();
  const alen = a.length, blen = b.length;
  if (alen === 0) return blen;
  if (blen === 0) return alen;
  const prev = new Array(blen + 1);
  const cur = new Array(blen + 1);
  for (let j = 0; j <= blen; j++) prev[j] = j;
  for (let i = 1; i <= alen; i++) {
    cur[0] = i;
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= blen; j++) prev[j] = cur[j];
  }
  return prev[blen];
}

function suggest(name, limit) {
  if (!name) return [];
  limit = limit || 3;
  const all = listPackages();
  const lower = String(name).toLowerCase();
  const scored = [];

  for (const p of all) {
    const pname = p.name.toLowerCase();
    if (pname === lower) continue;

    const d = editDistance(lower, pname);
    let subBonus = 0;
    if (pname.indexOf(lower) !== -1) subBonus = -2;
    else if (lower.indexOf(pname) !== -1) subBonus = -2;

    let prefixBonus = 0;
    const plen = Math.min(lower.length, pname.length);
    for (let i = 0; i < plen; i++) {
      if (lower[i] !== pname[i]) break;
      prefixBonus -= 0.2;
    }

    scored.push({
      name: p.name,
      distance: Math.max(0, d + subBonus + prefixBonus)
    });
  }

  scored.sort(function (a, b) { return a.distance - b.distance; });
  return scored.slice(0, limit);
}

/* ═══════════════ 导出 ═══════════════ */

module.exports = {
  loadUrls: loadUrls,
  listPackages: listPackages,
  find: find,
  findFuzzy: findFuzzy,
  findByFile: findByFile,
  pickForCurrentPlatform: pickForCurrentPlatform,
  stats: stats,
  search: search,
  suggest: suggest,
  URL_FILE: URL_FILE
};
