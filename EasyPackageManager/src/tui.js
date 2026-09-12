'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const platform = require('./platform');
const i18n = require('./i18n');
const { color } = require('./utils');

const MAX_LOG = 2000;
let lines = [];

function clear() { lines = []; }

function push(line) {
  const s = String(line).replace(/\r/g, '');
  lines.push(s);
  if (lines.length > MAX_LOG) lines.shift();
}

function getAll() { return lines.slice(); }
function size() { return lines.length; }

function pkgVersion() {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(config.ROOT, 'package.json'), 'utf8'));
    return p.version || '?';
  } catch (_) { return '?'; }
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLen(s) {
  return stripAnsi(s).length;
}

function pad(s, w) {
  const v = visibleLen(s);
  if (v >= w) return s;
  return s + ' '.repeat(w - v);
}

function truncate(s, w) {
  const plain = stripAnsi(s);
  if (plain.length <= w) return s;
  // 有 ANSI 时简单裁剪会破坏颜色，直接返回前半部分
  // 简单做法：按可见长度截断
  let visible = 0;
  let i = 0;
  const out = [];
  while (i < s.length && visible < w - 1) {
    if (s[i] === '\x1b') {
      const m = s.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (m) { out.push(m[0]); i += m[0].length; continue; }
    }
    out.push(s[i]);
    visible++;
    i++;
  }
  out.push('\x1b[0m…');
  return out.join('');
}

function draw() {
  const W = process.stdout.columns || 80;
  const H = process.stdout.rows || 24;

  let out = '\x1b[2J\x1b[H';

  // ── 标题栏 ──
  const titleTxt = ' EasyPackageManager  v' + pkgVersion() +
                   '  ' + platform.platform + '/' + platform.arch +
                   '  ' + i18n.current() + ' ';
  const titleVis = visibleLen(titleTxt);
  const titleBar = titleVis < W
    ? color.cyan(titleTxt) + color.gray('─'.repeat(W - titleVis))
    : color.cyan(truncate(titleTxt, W));
  out += titleBar + '\n';

  // ── 日志区 ──
  const maxLog = Math.max(5, H - 4);
  const show = lines.slice(-maxLog);
  for (const l of show) {
    out += truncate(l, W) + '\n';
  }

  // ── 底部分隔线 ──
  out += color.gray('─'.repeat(W)) + '\n';

  process.stdout.write(out);
}

module.exports = {
  clear: clear,
  push: push,
  getAll: getAll,
  size: size,
  draw: draw,
  stripAnsi: stripAnsi,
  visibleLen: visibleLen
};
