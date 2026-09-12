'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const LANG_DIR = path.join(config.ROOT, 'lang');

const FALLBACK = {
  cn: { unknownCommand: '未知或不可用的命令', inputEpmHelp: '，输入epm help查看帮助' },
  en: { unknownCommand: 'Unknown or unavailable command', inputEpmHelp: ', run "epm help" to see available commands' }
};

const DEFAULT_LANG = 'en';
const SYSTEM_ALIAS = { zh: 'cn', 'zh-cn': 'cn', 'zh-tw': 'cn', 'zh-hans': 'cn', 'zh-hant': 'cn' };

let cache = {};
let current = null;

function unescapeValue(v) {
  return String(v).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseLangText(text) {
  const dict = {};
  for (let raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] === '#' || line[0] === ';') continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
      value = unescapeValue(value.slice(1, -1));
    }
    dict[key] = value;
  }
  return dict;
}

function listLangs() {
  try {
    return fs.readdirSync(LANG_DIR)
      .filter(function (f) { return f.toLowerCase().endsWith('.lang'); })
      .map(function (f) { return f.slice(0, -5); })
      .sort();
  } catch (_) { return []; }
}

function langFile(name) { return path.join(LANG_DIR, name + '.lang'); }

function loadLang(name) {
  if (!name) return null;
  if (cache[name]) return cache[name];
  const f = langFile(name);
  if (!fs.existsSync(f)) return null;
  try {
    const dict = parseLangText(fs.readFileSync(f, 'utf8'));
    cache[name] = dict;
    return dict;
  } catch (_) { return null; }
}

function detectSystemLang() {
  const loc = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG ||
    (typeof Intl !== 'undefined' && Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().locale) || '';
  const lower = String(loc).toLowerCase();
  if (SYSTEM_ALIAS[lower]) return SYSTEM_ALIAS[lower];
  if (/^zh/i.test(lower)) return 'cn';
  if (/^en/i.test(lower)) return 'en';
  return DEFAULT_LANG;
}

function resolveName() {
  let explicit = '';
  try { explicit = config.get('lang') || ''; } catch (_) {}
  if (explicit && fs.existsSync(langFile(explicit))) return explicit;
  const sys = detectSystemLang();
  if (fs.existsSync(langFile(sys))) return sys;
  const all = listLangs();
  if (all.length) {
    if (all.indexOf(DEFAULT_LANG) !== -1) return DEFAULT_LANG;
    return all[0];
  }
  return sys;
}

function reload() { cache = {}; current = null; }
function currentName() { if (!current) current = resolveName(); return current; }

function t(key) {
  const dict = loadLang(currentName());
  if (dict && dict[key] != null) return dict[key];
  const sys = detectSystemLang();
  if (FALLBACK[sys] && FALLBACK[sys][key] != null) return FALLBACK[sys][key];
  if (FALLBACK[DEFAULT_LANG] && FALLBACK[DEFAULT_LANG][key] != null) return FALLBACK[DEFAULT_LANG][key];
  if (FALLBACK.cn[key] != null) return FALLBACK.cn[key];
  return key;
}

function all() { return loadLang(currentName()) || {}; }

function info(name) {
  const target = name || currentName();
  const dict = loadLang(target);
  if (!dict) return null;
  return {
    name: dict.name || target,
    displayName: dict.displayName || (dict.name || target),
    file: langFile(target)
  };
}

module.exports = {
  t: t, all: all, info: info, current: currentName,
  listLangs: listLangs, loadLang: loadLang, reload: reload,
  detectSystemLang: detectSystemLang, LANG_DIR: LANG_DIR,
  FALLBACK: FALLBACK, DEFAULT_LANG: DEFAULT_LANG
};
