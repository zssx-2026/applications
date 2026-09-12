'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

function file() { return config.get('registryfile'); }

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (!d.packages) d.packages = {};
    return d;
  } catch (_) { return { version: 1, packages: {} }; }
}

function save(d) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(d, null, 2) + '\n', 'utf8');
  } catch (_) {}
}

function get(n) { return load().packages[n] || null; }
function has(n) { return Boolean(get(n)); }

function add(n, info) {
  const d = load();
  d.packages[n] = Object.assign({}, d.packages[n], info, { name: n });
  save(d);
  return d.packages[n];
}

function remove(n) {
  const d = load();
  const existed = Boolean(d.packages[n]);
  delete d.packages[n];
  save(d);
  return existed;
}

function list() {
  return Object.values(load().packages).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
}

module.exports = { load: load, save: save, get: get, has: has, add: add, remove: remove, list: list, file: file };
