'use strict';

const path = require('path');
const config = require('./config');
const versionLib = require('./version');
const { readJson } = require('./utils');

const URL_FILE = path.join(config.ROOT, 'url.json');

function loadUrls() { return readJson(URL_FILE, {}) || {}; }

/**
 * 构建包列表：从所有 release 的 name.txt 聚合
 */
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
        htmlUrl: rel.htmlUrl
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

function find(name) {
  if (!name) return null;
  const lower = String(name).toLowerCase();
  for (const p of listPackages()) {
    if (p.name === name) return p;
  }
  for (const p of listPackages()) {
    if (p.name.toLowerCase() === lower) return p;
  }
  return null;
}

function stats() {
  const urls = loadUrls();
  const releases = urls.releases || [];
  const pkgs = listPackages();
  let fileCount = 0;
  for (const r of releases) {
    fileCount += (r.assets || []).length;
  }
  return {
    releaseCount: releases.length,
    pkgCount: pkgs.length,
    fileCount: fileCount,
    updatedAt: urls.updatedAt || null
  };
}

/**
 * 高级搜索
 * opts: { text, fullWord, company, excludeCompanies, version, excludeVersions, type, allVersions, caseSensitive }
 */
function search(opts) {
  opts = opts || {};
  const text = opts.text || '';
  const lowerText = text.toLowerCase();
  const company = opts.company || null;
  const version = opts.version || null;
  const type = opts.type || null;
  const exclC = opts.excludeCompanies || [];
  const exclV = opts.excludeVersions || [];
  const all = listPackages();

  const results = [];

  for (const pkg of all) {
    // 类型过滤
    if (type && pkg.type !== type) continue;

    // 公司过滤
    if (company) {
      if (pkg.company.toLowerCase().indexOf(company.toLowerCase()) === -1) continue;
    }
    if (exclC.length) {
      let excl = false;
      for (const c of exclC) {
        if (pkg.company.toLowerCase() === c.toLowerCase()) { excl = true; break; }
      }
      if (excl) continue;
    }

    // 文本匹配
    let textMatch = true;
    if (text) {
      if (opts.fullWord) {
        textMatch = (pkg.name === text) ||
                    (pkg.name.toLowerCase() === lowerText && !opts.caseSensitive);
      } else {
        textMatch = pkg.name.toLowerCase().indexOf(lowerText) !== -1;
      }
    }

    // 版本匹配 + 排除
    const matchedVersions = pkg.versions.filter(function (v) {
      if (version && v.version !== version) return false;
      for (const ev of exclV) {
        if (v.version === ev) return false;
      }
      return true;
    });

    if (!matchedVersions.length) continue;
    if (!textMatch) continue;

    results.push(Object.assign({}, pkg, {
      versions: opts.allVersions ? matchedVersions : [matchedVersions[matchedVersions.length - 1]],
      latest: matchedVersions[matchedVersions.length - 1]
    }));
  }

  return results;
}

module.exports = {
  loadUrls: loadUrls,
  listPackages: listPackages,
  find: find,
  stats: stats,
  search: search,
  URL_FILE: URL_FILE
};
