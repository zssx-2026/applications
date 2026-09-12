'use strict';

const fs = require('fs');
const path = require('path');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }
function rmrf(t) { if (!t) return; try { fs.rmSync(t, { recursive: true, force: true }); } catch (_) {} }

function copyDir(src, dest) {
  ensureDir(dest);
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d === undefined ? null : d; } }
function writeJson(f, d) { ensureDir(path.dirname(f)); fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n', 'utf8'); }

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
function wrap(code) { return function (t) { return useColor ? '\u001b[' + code + 'm' + t + '\u001b[0m' : String(t); }; }
const color = {
  red: wrap(31), green: wrap(32), yellow: wrap(33), blue: wrap(34),
  magenta: wrap(35), cyan: wrap(36), gray: wrap(90), bold: wrap(1), dim: wrap(2)
};

const log = {
  info: function (m) { console.log(color.cyan('i') + ' ' + m); },
  success: function (m) { console.log(color.green('+') + ' ' + m); },
  warn: function (m) { console.log(color.yellow('!') + ' ' + m); },
  error: function (m) { console.error(color.red('x') + ' ' + m); },
  step: function (m) { console.log(color.blue('>') + ' ' + m); }
};

function formatBytes(b) {
  if (b == null) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(b), i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
}

function clearScreen() { process.stdout.write('\u001b[2J\u001b[0;0H'); }

module.exports = {
  ensureDir: ensureDir, rmrf: rmrf, copyDir: copyDir,
  readJson: readJson, writeJson: writeJson,
  color: color, log: log, formatBytes: formatBytes, clearScreen: clearScreen
};
