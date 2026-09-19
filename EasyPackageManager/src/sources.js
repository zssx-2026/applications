'use strict';

const path = require('path');
const config = require('./config');
const versionLib = require('./version');
const { readJson } = require('./utils');
const pinyin = require('./pinyin');

const URL_FILE = path.join(config.ROOT, 'url.json');

function loadUrls() { return readJson(URL_FILE, {}) || {}; }

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[_\-\.\/\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function listPackages() {
  const urls = loadUrls();
  const releases = urls.releases || [];
  const map = new Map();

  for (const rel of releases) {
    const nt = rel.nameTxt;
    if (!nt || !nt.entries) continue;
    for (const e of nt.entries) {
      if (!map.has(e.name)) {
        map.set(e.name, { name: e.name, type: e.type, company: e.company, versions: [] });
      }
      const pkg = map.get(e.name);
      const asset = (rel.assets || []).find(function (a) { return a.name === e.fileName; });
      pkg.versions.push({
        version: e.version, tag: rel.tag, fileName: e.fileName,
        type: e.type, company: e.company,
        url: asset ? asset.url : null,
        size: asset ? asset.size : 0,
        assetType: asset ? asset.type : 'unknown',
        publishedAt: rel.publishedAt, htmlUrl: rel.htmlUrl, repo: rel.repo || null
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
  for (const p of listPackages()) if (p.name === name) return p;
  for (const p of listPackages()) if (p.name.toLowerCase() === String(name).toLowerCase()) return p;
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
  for (const p of all) for (const f of p.versions) if (f.fileName.toLowerCase() === lower) return { pkg: p, file: f };
  for (const p of all) for (const f of p.versions) if (f.fileName.toLowerCase().indexOf(lower) !== -1) return { pkg: p, file: f };
  return null;
}

function pickForCurrentPlatform(pkg) {
  if (!pkg || !pkg.versions || !pkg.versions.length) return null;
  try {
    const platform = require('./platform');
    return platform.pickAsset(pkg.versions, pkg.name);
  } catch (_) { return pkg.latest; }
}

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

/* ═══════════════ 智能搜索 ═══════════════ */

function search(opts) {
  opts = opts || {};
  const text = String(opts.text || '').trim();
  const type = opts.type || null;
  const company = opts.company || null;
  const exclC = opts.excludeCompanies || [];
  const version = opts.version || null;
  const exclV = opts.excludeVersions || [];
  const fullWord = opts.fullWord;
  const allVersions = opts.allVersions;

  const tokens = tokenize(text);
  const lowerText = text.toLowerCase();

  const results = [];
  for (const pkg of listPackages()) {
    if (type && pkg.type !== type) continue;
    if (company && pkg.company.toLowerCase().indexOf(company.toLowerCase()) === -1) continue;
    if (exclC.length) {
      let ex = false;
      for (const c of exclC) if (pkg.company.toLowerCase() === c.toLowerCase()) { ex = true; break; }
      if (ex) continue;
    }

    if (text) {
      const pname = pkg.name.toLowerCase();
      const ptokens = tokenize(pkg.name);
      let match = false;

      if (fullWord) {
        match = pname === lowerText;
      } else if (tokens.length > 1) {
        match = tokens.every(function (t) {
          return pname.indexOf(t) !== -1 ||
                 ptokens.some(function (pt) { return pt.indexOf(t) === 0; }) ||
                 pinyin.pyMatch(pkg.name, t);
        });
      } else {
        match = pname.indexOf(lowerText) !== -1 || pinyin.pyMatch(pkg.name, lowerText);
      }

      if (!match) continue;
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

/* ═══════════════ 智能 suggest ═══════════════ */

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

function similarity(input, target, display) {
  const a = String(input).toLowerCase();
  const b = String(target).toLowerCase();
  const at = tokenize(a);
  const bt = tokenize(b);

  if (a === b) return 0;
  if (b.indexOf(a) === 0) return 0.5 - a.length * 0.05;
  if (b.indexOf(a) !== -1) return 1.0 - a.length * 0.1;
  if (a.indexOf(b) !== -1) return 1.5;

  if (at.length > 1) {
    const allMatch = at.every(function (t) {
      return b.indexOf(t) !== -1 || bt.some(function (x) { return x.indexOf(t) === 0; });
    });
    if (allMatch) return 1.5 + (10 - Math.min(at.length, 10)) * 0.1;
  }

  if (at.length === 1) {
    const t = at[0];
    if (bt.some(function (x) { return x.indexOf(t) === 0; })) {
      return 2.0 - t.length * 0.1;
    }
  }

  // 拼音匹配
  if (display && pinyin.pyMatch(display, a)) {
    return 2.5 - Math.min(a.length, 10) * 0.05;
  }

  const d = editDistance(a, b);
  const maxLen = Math.max(a.length, b.length) || 1;
  return 3.0 + (d / maxLen) * 5.0;
}

function suggest(name, limit) {
  if (!name) return [];
  limit = limit || 5;
  const all = listPackages();
  if (!all.length) return [];

  const scored = all.map(function (p) {
    return { name: p.name, score: similarity(name, p.name, p.name) };
  });

  scored.sort(function (a, b) { return a.score - b.score; });

  const best = scored[0].score;
  const TOLERANCE = 0.05;
  const top = scored.filter(function (s) { return s.score - best <= TOLERANCE; });

  if (best > 5) return top.slice(0, 3);
  return top.slice(0, limit);
}

module.exports = {
  loadUrls, listPackages, find, findFuzzy, findByFile,
  pickForCurrentPlatform, stats, search, suggest, tokenize, URL_FILE
};
