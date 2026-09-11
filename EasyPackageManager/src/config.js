'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS_FILE = path.join(ROOT, 'settings.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function get(key, fallback = null) {
  const cfg = load();
  return key.split('.').reduce((o, k) => (o ? o[k] : undefined), cfg) ?? fallback;
}

module.exports = { load, get, ROOT, SETTINGS_FILE };
