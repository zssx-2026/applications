'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const VERSION_FILE = path.join(config.ROOT, '.epm-versions.json');

function parseVer(v) {
  if (!v) return [0, 0, 0];
  const s = String(v).replace(/^v/i, '');
  const m = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return [0, 0, 0];
  return [
    parseInt(m[1] || '0', 10),
    parseInt(m[2] || '0', 10),
    parseInt(m[3] || '0', 10)
  ];
}

function compareVer(a, b) {
  const av = parseVer(a), bv = parseVer(b);
  for (let i = 0; i < 3; i++) {
    if (av[i] > bv[i]) return 1;
    if (av[i] < bv[i]) return -1;
  }
  return 0;
}

function isValidVersion(v) {
  if (!v) return false;
  const s = String(v).replace(/^v/i, '');
  if (!/^\d+(?:\.\d+){0,2}$/.test(s)) return false;
  return true;
}

function loadState() {
  try {
    const d = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    if (!Array.isArray(d.history)) d.history = [];
    return d;
  } catch (_) {
    return { current: null, history: [] };
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

function getCurrent() {
  return loadState().current || null;
}

function setCurrent(tag) {
  const d = loadState();
  d.current = tag;
  d.history.push({ tag: tag, installedAt: new Date().toISOString() });
  d.history = d.history.slice(-30);
  saveState(d);
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
  getPkgVersion: getPkgVersion,
  VERSION_FILE: VERSION_FILE
};
