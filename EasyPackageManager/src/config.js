'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const platform = require('./platform');

function detectRoot() {
  if (process.env.EPM_ROOT) {
    try { return path.resolve(process.env.EPM_ROOT); } catch (_) {}
  }
  const exec = process.execPath || '';
  const isNodeExe = /(^|[\\/])node(\.exe)?$/i.test(exec);
  if (isNodeExe) return path.resolve(__dirname, '..');
  return path.dirname(exec);
}

const ROOT = detectRoot();

const DATA_DIR = process.env.EPM_HOME
  ? path.resolve(process.env.EPM_HOME)
  : path.join(os.homedir(), '.epm');

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}

const SETTINGS_FILE = path.join(ROOT, 'settings.json');

const DEFAULTS = {
  tempdir: '',
  installdir: '',
  registryfile: '',
  lang: '',
  'network.retries': 4,
  'network.retryDelayMs': 800,
  'network.timeoutMs': 30000,
  'github.token': '',
  'github.apiBase': 'https://api.github.com'
};

function loadRaw() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch (_) { return {}; }
}

function saveRaw(d) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');
  } catch (_) {}
}

function resolvePath(p) {
  if (!p) return p;
  if (p === '~' || p.indexOf('~/') === 0 || p.indexOf('~\\') === 0) {
    return path.join(os.homedir(), p.slice(1).replace(/^[\\/]/, ''));
  }
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

function get(key) {
  const raw = loadRaw();

  if (key === 'tempdir') {
    return raw.tempdir ? resolvePath(raw.tempdir) : path.join(DATA_DIR, 'temp');
  }
  if (key === 'installdir') {
    return raw.installdir ? resolvePath(raw.installdir) : platform.defaultInstallDir();
  }
  if (key === 'registryfile') {
    return raw.registryfile ? resolvePath(raw.registryfile) : path.join(DATA_DIR, 'registry.json');
  }
  if (key === 'versionfile') {
    return path.join(DATA_DIR, 'versions.json');
  }
  if (key === 'lang') return raw.lang || '';
  if (key === 'github.token') return (raw.github && raw.github.token) || '';
  if (key === 'github.apiBase') return (raw.github && raw.github.apiBase) || DEFAULTS['github.apiBase'];
  if (key.indexOf('network.') === 0) {
    const sub = key.slice(8);
    return (raw.network && raw.network[sub] != null) ? raw.network[sub] : DEFAULTS[key];
  }
  return raw[key];
}

function set(key, value) {
  const raw = loadRaw();
  if (key === 'tempdir' || key === 'installdir' || key === 'registryfile' || key === 'lang') {
    raw[key] = value;
  } else if (key.indexOf('github.') === 0) {
    if (!raw.github) raw.github = {};
    raw.github[key.slice(7)] = value;
  } else if (key.indexOf('network.') === 0) {
    if (!raw.network) raw.network = {};
    let v = value;
    if (key === 'network.retries' || key === 'network.retryDelayMs' || key === 'network.timeoutMs') v = Number(value);
    raw.network[key.slice(8)] = v;
  } else {
    raw[key] = value;
  }
  saveRaw(raw);
}

function list() {
  const raw = loadRaw();
  let i18n = null;
  try { i18n = require('./i18n'); } catch (_) {}
  let langDisplay;
  if (raw.lang) langDisplay = raw.lang;
  else if (i18n) langDisplay = i18n.current() + ' (' + i18n.t('langFollowSystem') + ')';
  else langDisplay = '';
  return {
    tempdir: get('tempdir'),
    installdir: get('installdir'),
    registryfile: get('registryfile'),
    lang: langDisplay,
    'network.retries': get('network.retries'),
    'network.retryDelayMs': get('network.retryDelayMs'),
    'network.timeoutMs': get('network.timeoutMs'),
    'github.token': (raw.github && raw.github.token) || '',
    'github.apiBase': (raw.github && raw.github.apiBase) || DEFAULTS['github.apiBase']
  };
}

module.exports = { get, set, list, ROOT, DATA_DIR, SETTINGS_FILE };
