'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const PAK_FILE = path.join(config.ROOT, 'pak.json');

const RESERVED = [
  'epm', 'pak', 'help', 'list', 'install', 'i', 'add', 'del', 'delete',
  'update', 'exit', 'quit', 'clear', 'set', 'lang', 'get', 'search',
  'download', 'uninstall', 'remove', 'rm', 'redadd', 'redel', 'temp', 'run', 'cli'
];

function empty() { return { version: 1, updatedAt: null, packages: {} }; }

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(PAK_FILE, 'utf8'));
    if (!d.packages || typeof d.packages !== 'object') d.packages = {};
    return d;
  } catch (_) { return empty(); }
}

function save(d) {
  d.version = d.version || 1;
  d.updatedAt = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(PAK_FILE), { recursive: true });
    fs.writeFileSync(PAK_FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');
  } catch (_) {}
  return d;
}

function list() {
  return Object.values(load().packages).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
}

function get(name) { return load().packages[name] || null; }
function has(name) { return Boolean(get(name)); }

function validateName(name) {
  if (!name || typeof name !== 'string') return { ok: false, error: 'nameEmpty' };
  name = name.trim();
  if (!name) return { ok: false, error: 'nameEmpty' };
  if (name.length > 64) return { ok: false, error: 'nameTooLong' };
  if (!/^[a-zA-Z]/.test(name)) return { ok: false, error: 'nameMustStartWithLetter' };
  if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(name)) return { ok: false, error: 'nameInvalidChars' };
  if (/[._-]$/.test(name)) return { ok: false, error: 'nameInvalidChars' };
  if (name.indexOf('..') !== -1) return { ok: false, error: 'nameInvalidChars' };
  if (RESERVED.indexOf(name.toLowerCase()) !== -1) return { ok: false, error: 'nameReserved' };
  return { ok: true, name: name };
}

function validateUrl(url) {
  if (!url || typeof url !== 'string') return { ok: false, error: 'urlEmpty' };
  url = url.trim();
  if (!url) return { ok: false, error: 'urlEmpty' };
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'urlProtocol' };
    return { ok: true, url: u.toString() };
  } catch (_) { return { ok: false, error: 'urlInvalid' }; }
}

function add(name, url, flags) {
  flags = flags || {};
  const nc = validateName(name);
  if (!nc.ok) return { ok: false, error: nc.error, kind: 'name' };
  name = nc.name;
  const uc = validateUrl(url);
  if (!uc.ok) return { ok: false, error: uc.error, kind: 'url' };
  url = uc.url;
  const data = load();
  if (data.packages[name] && !flags.force) return { ok: false, error: 'nameExists', kind: 'name' };
  let fileName = '';
  try { fileName = path.basename(new URL(url).pathname); } catch (_) {}
  if (!fileName) fileName = name;
  data.packages[name] = { name: name, url: url, file: fileName, addedAt: new Date().toISOString() };
  save(data);
  return { ok: true, pkg: data.packages[name] };
}

function remove(name) {
  if (!name) return { ok: false, error: 'notFound' };
  const data = load();
  if (!data.packages[name]) return { ok: false, error: 'notFound' };
  const pkg = data.packages[name];
  delete data.packages[name];
  save(data);
  return { ok: true, pkg: pkg };
}

module.exports = {
  PAK_FILE: PAK_FILE, empty: empty, load: load, save: save,
  list: list, get: get, has: has,
  validateName: validateName, validateUrl: validateUrl,
  add: add, remove: remove, RESERVED: RESERVED
};
