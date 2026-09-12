'use strict';

const path = require('path');
const platform = require('./platform');
const pak = require('./pak');
const { readJson } = require('./utils');

const ROOT = path.resolve(__dirname, '..');
const URL_FILE = path.join(ROOT, 'url.json');

function loadUrls() { return readJson(URL_FILE, {}) || {}; }

function listAvailable() {
  const urls = loadUrls();
  const releases = urls.releases || [];

  const githubPkgs = releases.map(function (r) {
    return {
      name: r.tag || r.name,
      version: r.tag,
      releaseName: r.name || r.tag,
      url: r.htmlUrl,
      publishedAt: r.publishedAt,
      prerelease: Boolean(r.prerelease),
      draft: Boolean(r.draft),
      type: 'github',
      files: (r.assets || []).map(function (a) {
        return {
          name: a.name,
          url: a.url,
          size: a.size,
          contentType: a.contentType,
          downloadCount: a.downloadCount,
          updatedAt: a.updatedAt
        };
      })
    };
  });

  const pakPkgs = pak.list().map(function (p) {
    return {
      name: p.name,
      version: null,
      releaseName: p.name,
      url: p.url,
      publishedAt: p.addedAt || null,
      prerelease: false,
      draft: false,
      type: 'pak',
      files: [{
        name: p.file || p.name,
        url: p.url,
        size: null
      }]
    };
  });

  const map = new Map();
  for (const p of githubPkgs) map.set(p.name, p);
  for (const p of pakPkgs) map.set(p.name, p);

  return Array.from(map.values());
}

function find(name) {
  for (const p of listAvailable()) {
    if (p.name === name || p.version === name || p.releaseName === name) return p;
  }
  return null;
}

function findFuzzy(name) {
  const all = listAvailable();
  const lower = String(name).toLowerCase();
  for (const p of all) if (p.name.toLowerCase() === lower) return p;
  for (const p of all) if (p.name.toLowerCase().indexOf(lower) === 0) return p;
  for (const p of all) if (p.name.toLowerCase().indexOf(lower) !== -1) return p;
  return null;
}

function pickForCurrentPlatform(pkg) {
  if (!pkg || !pkg.files || !pkg.files.length) return null;
  return platform.pickAsset(pkg.files, pkg.name);
}

function stats() {
  const urls = loadUrls();
  const releases = urls.releases || [];
  const localPkgs = pak.list();
  let totalFiles = 0;
  let totalSize = 0;
  for (const r of releases) {
    const assets = r.assets || [];
    totalFiles += assets.length;
    for (const a of assets) if (a.size) totalSize += a.size;
  }
  return {
    releaseCount: releases.length,
    pakCount: localPkgs.length,
    fileCount: totalFiles + localPkgs.length,
    totalSize: totalSize,
    updatedAt: urls.updatedAt || null
  };
}

function search(keyword) {
  const lower = String(keyword || '').toLowerCase();
  const all = listAvailable();
  if (!lower) return all;
  return all.filter(function (p) {
    if (p.name.toLowerCase().indexOf(lower) !== -1) return true;
    for (const f of p.files) {
      if (f.name.toLowerCase().indexOf(lower) !== -1) return true;
    }
    return false;
  });
}

module.exports = {
  loadUrls: loadUrls,
  listAvailable: listAvailable,
  find: find,
  findFuzzy: findFuzzy,
  pickForCurrentPlatform: pickForCurrentPlatform,
  stats: stats,
  search: search,
  URL_FILE: URL_FILE
};
