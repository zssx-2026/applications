'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const VERSION_FILE = config.get('versionfile');

function parseVer(v) {
  if (!v) return [0, 0, 0, ''];
  const s = String(v).replace(/^v/i, '').trim();
  const m = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(.*)$/);
  if (!m) return [0, 0, 0, '', s];
  return [
    parseInt(m[1] || '0', 10),
    parseInt(m[2] || '0', 10),
    parseInt(m[3] || '0', 10),
    m[4] ? parseInt(m[4], 10) : 0,
    (m[5] || '').trim()
  ];
}

function compareVer(a, b) {
  const av = parseVer(a), bv = parseVer(b);
  for (let i = 0; i < 4; i++) {
    if (av[i] > bv[i]) return 1;
    if (av[i] < bv[i]) return -1;
  }
  if (av[4] && bv[4]) return av[4].localeCompare(bv[4]);
  if (av[4]) return 1;
  if (bv[4]) return -1;
  return 0;
}

function isValidVersion(v) {
  if (!v) return false;
  const s = String(v).replace(/^v/i, '');
  return /^\d+(?:\.\d+){0,3}(?:[.\-][\w]+)*$/.test(s);
}

function loadState() {
  try {
    const d = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    if (!d.packages || typeof d.packages !== 'object') d.packages = {};
    return d;
  } catch (_) {
    return { version: 1, packages: {} };
  }
}

function saveState(d) {
  d.version = 1;
  d.updatedAt = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(VERSION_FILE), { recursive: true });
    fs.writeFileSync(VERSION_FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');
  } catch (_) {}
}

function getCurrent(name) {
  const d = loadState();
  if (name) return d.packages[name] || null;
  return null;
}

function setCurrent(name, ver) {
  const d = loadState();
  d.packages[name] = {
    version: ver,
    installedAt: new Date().toISOString()
  };
  saveState(d);
}

function removeCurrent(name) {
  const d = loadState();
  delete d.packages[name];
  saveState(d);
}

function listInstalled() {
  const d = loadState();
  return Object.keys(d.packages).map(function (n) {
    return { name: n, version: d.packages[n].version, installedAt: d.packages[n].installedAt };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function getPkgVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(config.ROOT, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

module.exports = {
  parseVer: parseVer,
  compareVer: compareVer,
  isValidVersion: isValidVersion,
  loadState: loadState,
  saveState: saveState,
  getCurrent: getCurrent,
  setCurrent: setCurrent,
  removeCurrent: removeCurrent,
  listInstalled: listInstalled,
  getPkgVersion: getPkgVersion,
  VERSION_FILE: VERSION_FILE
};
