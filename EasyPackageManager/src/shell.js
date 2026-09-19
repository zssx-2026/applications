'use strict';

const { dispatch } = require('./cli');
const proc = require('./process');
const tasks = require('./tasks');
const i18n = require('./i18n');
const config = require('./config');
const versionLib = require('./version');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
  gray: '\x1b[90m',
  brightCyan: '\x1b[96m', brightWhite: '\x1b[97m',
  brightGreen: '\x1b[92m', brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m', brightRed: '\x1b[91m'
};

const MAX_HISTORY = 200;
const PROMPT = 'epm> ';
const PROMPT_COL = 5;

let inputBuf = '';
let cursorPos = 0;
let history = [];
let historyIdx = -1;
let stdinHandler = null;
let exiting = false;
let scrollRegionOn = false;
let scrollBottom = 0;
let tickTimer = null;
let origLog, origErr, origWarn;

function vlen(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, '').length; }

function fmtSpeed(bps) {
  if (!isFinite(bps) || bps <= 0) return '0B/s';
  if (bps >= 1073741824) return (bps / 1073741824).toFixed(2) + 'GB/s';
  if (bps >= 1048576) return (bps / 1048576).toFixed(2) + 'MB/s';
  if (bps >= 1024) return (bps / 1024).toFixed(1) + 'KB/s';
  return bps.toFixed(0) + 'B/s';
}
function fmtSize(n) {
  if (n == null || n === 0) return '0B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v.toFixed(0) : v.toFixed(v < 10 ? 1 : 0)) + u[i];
}
function fmtEta(sec) {
  if (!isFinite(sec) || sec < 0 || sec > 86400) return '--:--';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  return m + ':' + String(ss).padStart(2, '0');
}

/* ═══════════ 滚动区 ═══════════ */

function setupScrollRegion() {
  if (!process.stdout.isTTY) return;
  const H = process.stdout.rows || 24;
  if (H < 6) { scrollRegionOn = false; return; }
  scrollBottom = H - 2;
  process.stdout.write('\x1b[1;' + scrollBottom + 'r');
  process.stdout.write('\x1b[' + scrollBottom + ';1H');
  scrollRegionOn = true;
}

function restoreScrollRegion() {
  if (!scrollRegionOn) return;
  process.stdout.write('\x1b[r');
  scrollRegionOn = false;
}

function scrollOutput(text) {
  if (!scrollRegionOn) {
    process.stdout.write(String(text) + '\n');
    return;
  }
  const lines = String(text).split('\n');
  for (const line of lines) {
    process.stdout.write('\x1b[' + scrollBottom + ';1H');
    process.stdout.write('\r\x1b[K');
    process.stdout.write(line);
    process.stdout.write('\n');
  }
}

/* ═══════════ 状态行 ═══════════ */

function buildStatusLine() {
  const list = tasks.list();
  if (!list.length) return '';
  const W = process.stdout.columns || 80;
  const t = list[0];
  const extra = list.length > 1 ? C.gray + ' (+' + (list.length - 1) + ')' + C.reset : '';

  if (t.type === 'download') {
    const pct = t.total > 0 ? Math.min(t.bytes / t.total, 1) : 0;
    const done = t.total > 0 && t.bytes >= t.total;
    const elapsed = Math.max(0.1, (Date.now() - t.started) / 1000);
    const speed = elapsed > 0 ? t.bytes / elapsed : 0;
    const speedStr = done ? '完成中' : fmtSpeed(speed);
    const totalStr = fmtSize(t.total);
    const etaStr = (done || speed <= 0) ? '--:--' : fmtEta((t.total - t.bytes) / speed);
    const pctStr = Math.floor(pct * 100) + '%';

    const head = C.brightGreen + '▼' + C.reset + ' ' +
      C.bold + C.brightWhite + t.name + C.reset + extra + '  ' +
      C.brightCyan + speedStr + C.reset + '  ' +
      C.gray + 'Total:' + C.reset + C.brightWhite + totalStr + C.reset + '  ' +
      C.gray + 'ETA:' + C.reset + C.brightWhite + etaStr + C.reset + '  ' +
      C.brightYellow + pctStr + C.reset + '  ';

    const headLen = vlen(head);
    const barW = Math.max(8, W - headLen - 1);
    const filled = done ? barW : Math.round(barW * pct);
    const barColor = done ? C.brightYellow : C.brightGreen;
    const bar = barColor + (done ? '▓' : '█').repeat(filled) + C.reset;
    return head + bar;
  }
  return C.yellow + '■' + C.reset + ' ' +
    C.bold + C.brightWhite + t.name + C.reset + extra + '  ' +
    C.brightYellow + '[安装中...]' + C.reset;
}

function drawBottom() {
  if (!process.stdout.isTTY || !scrollRegionOn) return;
  const H = process.stdout.rows || 24;

  process.stdout.write('\x1b[' + (H - 1) + ';1H\x1b[K');
  const status = buildStatusLine();
  if (status) process.stdout.write(status);

  process.stdout.write('\x1b[' + H + ';1H\x1b[K');
  process.stdout.write(C.brightCyan + PROMPT + C.reset);
  process.stdout.write(C.brightWhite + inputBuf + C.reset);

  const col = PROMPT_COL + cursorPos + 1;
  process.stdout.write('\x1b[' + H + ';' + col + 'H');
  process.stdout.write('\x1b[?25h');
}

/* ═══════════ 快捷键 ═══════════ */

const HOTKEY_DEFS = {
  'ctrl+x': { type: 'byte', value: 0x18 },
  'ctrl+q': { type: 'byte', value: 0x11 },
  'ctrl+b': { type: 'byte', value: 0x02 },
  'ctrl+alt+c': { type: 'combo', mods: [6, 7], keys: [99, 67] },
  'ctrl+alt+x': { type: 'combo', mods: [6, 7], keys: [120, 88] },
  'ctrl+shift+x': { type: 'combo', mods: [5, 7], keys: [120, 88] },
  'ctrl+shift+c': { type: 'combo', mods: [5, 7], keys: [99, 67] }
};

function getHotkey() {
  let raw = '';
  try { raw = config.get('hotkey') || ''; } catch (_) {}
  return String(raw).toLowerCase().trim() || 'ctrl+x';
}

function matchHotkey(str, i, key) {
  const def = HOTKEY_DEFS[key];
  if (!def) return -1;
  if (def.type === 'byte') {
    if (str.charCodeAt(i) === def.value) return 1;
    return -1;
  }
  if (str[i] !== '\x1b' || str[i + 1] !== '[') return -1;
  const rest = str.slice(i + 2, i + 30);
  let km = rest.match(/^(\d+);(\d+)u/);
  if (km) {
    const k = parseInt(km[1], 10), m = parseInt(km[2], 10);
    if (def.keys.indexOf(k) !== -1 && def.mods.indexOf(m) !== -1) return 2 + km[0].length;
  }
  let xm = rest.match(/^27;(\d+);(\d+)~/);
  if (xm) {
    const m = parseInt(xm[1], 10), k = parseInt(xm[2], 10);
    if (def.mods.indexOf(m) !== -1 && def.keys.indexOf(k) !== -1) return 2 + xm[0].length;
  }
  return -1;
}

/* ═══════════ 编辑 ═══════════ */

function insertStr(s) { inputBuf = inputBuf.slice(0, cursorPos) + s + inputBuf.slice(cursorPos); cursorPos += s.length; }
function backspace() {
  if (cursorPos > 0) {
    const before = Array.from(inputBuf.slice(0, cursorPos));
    const after = inputBuf.slice(cursorPos);
    before.pop();
    const b = before.join('');
    inputBuf = b + after;
    cursorPos = b.length;
  }
}
function deleteChar() {
  if (cursorPos < inputBuf.length) {
    const before = inputBuf.slice(0, cursorPos);
    const after = Array.from(inputBuf.slice(cursorPos));
    after.shift();
    inputBuf = before + after.join('');
  }
}
function move(d) { cursorPos = Math.max(0, Math.min(inputBuf.length, cursorPos + d)); }
function histUp() {
  if (!history.length) return;
  if (historyIdx < history.length - 1) { historyIdx++; inputBuf = history[history.length - 1 - historyIdx]; cursorPos = inputBuf.length; }
}
function histDown() {
  if (historyIdx <= 0) { historyIdx = -1; inputBuf = ''; cursorPos = 0; return; }
  historyIdx--;
  inputBuf = history[history.length - 1 - historyIdx];
  cursorPos = inputBuf.length;
}

function killAllTasks() {
  if (tasks.count() === 0) return 0;
  return tasks.abortAll().length;
}

async function handleCommand(cmd) {
  let cmds;
  if (cmd[0] === '{' && cmd[cmd.length - 1] === '}') {
    cmds = cmd.slice(1, -1).split(';').map(function (s) { return s.trim(); }).filter(Boolean);
  } else {
    cmds = [cmd];
  }
  for (const c of cmds) {
    try {
      const argv = c.split(/\s+/);
      if (argv[0] === 'epm') argv.shift();
      await dispatch(argv);
    } catch (e) {
      scrollOutput(C.red + 'x' + C.reset + ' ' + ((e && e.message) || String(e)));
    }
  }
}

/* ═══════════ 输入 ═══════════ */

function attachInput() {
  process.stdin.setEncoding('utf8');
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(true); } catch (_) {}
  }
  process.stdin.resume();

  stdinHandler = function (data) {
    const str = String(data);
    const hotkey = getHotkey();
    let i = 0;

    while (i < str.length) {
      const code = str.charCodeAt(i);

      if (code === 0x1B) {
        const hkLen = matchHotkey(str, i, hotkey);
        if (hkLen > 0) {
          const n = killAllTasks();
          scrollOutput(C.brightYellow + '⌨ ' + hotkey.toUpperCase() + C.reset +
            (n > 0 ? '  ' + C.green + '中断 ' + n + ' 个任务' + C.reset
                   : '  ' + C.gray + '无运行中的任务' + C.reset));
          i += hkLen;
          continue;
        }
        if (str[i + 1] === '[') {
          const k = str[i + 2];
          if (k === 'A') { histUp(); i += 3; continue; }
          if (k === 'B') { histDown(); i += 3; continue; }
          if (k === 'C') { move(1); i += 3; continue; }
          if (k === 'D') { move(-1); i += 3; continue; }
          if (k === 'H') { cursorPos = 0; i += 3; continue; }
          if (k === 'F') { cursorPos = inputBuf.length; i += 3; continue; }
          if (k === '3' && str[i + 3] === '~') { deleteChar(); i += 4; continue; }
          i += 3;
          continue;
        }
        i++;
        continue;
      }

      if (code === 0x0D || code === 0x0A) {
        i++;
        const cmd = inputBuf.trim();
        inputBuf = '';
        cursorPos = 0;
        if (!cmd) { drawBottom(); continue; }

        history.push(cmd);
        if (history.length > MAX_HISTORY) history.shift();
        historyIdx = -1;

        // 后台异步训练（不阻塞）
        setImmediate(function () {
          try {
            const model = require('./model');
            const m = model.get();
            const n = m.trainOnString(cmd, 0.03);
            // 每 5 步保存一次
            if (m.step % 5 === 0) m.save();
          } catch (_) {}
        });

        let painted = cmd;
        try {
          const cli = require('./cli');
          if (cli.highlightCmd) painted = cli.highlightCmd(cmd);
        } catch (_) {}
        scrollOutput(C.brightCyan + PROMPT + C.reset + painted);

        if (cmd === 'exit' || cmd === 'quit') {
          exiting = true;
          try {
            const H = process.stdout.rows || 24;
            process.stdout.write('\x1b[r');
            process.stdout.write('\x1b[' + (H - 1) + ';1H');
            process.stdout.write('\x1b[J');
            process.stdout.write('\x1b[?25h');
          } catch (_) {}
          if (global.__epm_exitNow) global.__epm_exitNow(0);
          return;
        }

        handleCommand(cmd).catch(function (e) {
          scrollOutput(C.red + 'x' + C.reset + ' ' + ((e && e.message) || String(e)));
        });
        drawBottom();
        continue;
      }

      if (code === 0x09) {           // Tab
        i++;
        try {
          const parts = inputBuf.split(/\s+/);
          const partial = parts[parts.length - 1] || '';

          // 命令名补全
          if (parts.length === 1) {
            const cmds = ['install', 'list', 'search', 'get', 'update',
                          'download', 'uninstall', 'version', 'web', 'lang',
                          'set', 'task', 'help', 'exit', 'package', 'login',
                          'logout', 'release'];
            const hits = cmds.filter(function (c) { return c.indexOf(partial) === 0; });
            if (hits.length === 1 && partial.length > 0) {
              insertStr(hits[0].slice(partial.length));
              continue;
            }
          }

          // 包名补全
          if (parts.length >= 2 && partial.length > 0) {
            const sources = require('./sources');
            const pkgs = sources.listPackages();
            const hits = pkgs.filter(function (p) {
              return p.name.toLowerCase().indexOf(partial.toLowerCase()) === 0;
            });
            if (hits.length === 1) {
              insertStr(hits[0].name.slice(partial.length));
              continue;
            }
            // 唯一前缀 → 全补
            if (hits.length > 1) {
              // 找公共前缀
              let common = hits[0].name;
              for (let k = 1; k < hits.length; k++) {
                let j = 0;
                while (j < common.length && j < hits[k].name.length &&
                       common[j].toLowerCase() === hits[k].name[j].toLowerCase()) j++;
                common = common.slice(0, j);
              }
              if (common.length > partial.length) {
                insertStr(common.slice(partial.length));
                continue;
              }
            }
          }

          // 兜底：模型补全（完全隐藏）
          const model = require('./model');
          const added = model.complete(inputBuf);
          if (added) insertStr(added);
        } catch (_) {}
        continue;
      }

      if (code === 0x7F || code === 0x08) { i++; backspace(); continue; }

      if (code < 0x20) {
        const hk = HOTKEY_DEFS[hotkey];
        if (hk && hk.type === 'byte' && code === hk.value) {
          const n = killAllTasks();
          scrollOutput(C.brightYellow + '⌨ ' + hotkey.toUpperCase() + C.reset +
            (n > 0 ? '  ' + C.green + '中断 ' + n + ' 个任务' + C.reset
                   : '  ' + C.gray + '无运行中的任务' + C.reset));
          i++;
          continue;
        }
        i++;
        if (code === 0x03) {
          if (inputBuf.length > 0) {
            inputBuf = ''; cursorPos = 0;
            scrollOutput(C.gray + '^C  已清空输入，下载继续' + C.reset);
          } else {
            scrollOutput(C.gray + '^C  (' + hotkey.toUpperCase() + ' 中断任务)' + C.reset);
          }
        }
        else if (code === 0x04) {
          if (inputBuf.length === 0) scrollOutput(C.gray + '^D' + C.reset);
          else deleteChar();
        }
        else if (code === 0x15) { inputBuf = ''; cursorPos = 0; }
        else if (code === 0x17) {
          const b = inputBuf.slice(0, cursorPos);
          const a = inputBuf.slice(cursorPos);
          const t = b.replace(/\S+\s*$/, '');
          inputBuf = t + a; cursorPos = t.length;
        }
        else if (code === 0x01) cursorPos = 0;
        else if (code === 0x05) cursorPos = inputBuf.length;
        else if (code === 0x0B) inputBuf = inputBuf.slice(0, cursorPos);
        else if (code === 0x0C) { process.stdout.write('\x1b[2J'); setupScrollRegion(); }
        continue;
      }

      const cp = str.codePointAt(i);
      const len = cp > 0xFFFF ? 2 : 1;
      insertStr(str.slice(i, i + len));
      i += len;
    }
    drawBottom();
  };

  process.stdin.on('data', stdinHandler);
}

/* ═══════════ 主入口 ═══════════ */

function run() {
  return new Promise(function (resolve) {
    origLog = console.log;
    origErr = console.error;
    origWarn = console.warn;
    global.__epm_shell = true;

    function wrap() {
      const text = Array.from(arguments).map(function (a) {
        return typeof a === 'string' ? a : String(a);
      }).join(' ');
      scrollOutput(text);
    }
    console.log = wrap;
    console.error = wrap;
    console.warn = wrap;

    scrollOutput(C.brightCyan + 'EasyPackageManager' + C.reset + '  ' +
      C.gray + 'v' + versionLib.getPkgVersion() + C.reset);
    scrollOutput(C.gray + i18n.t('helpUsage') + ': ' +
      C.brightWhite + 'help' + C.reset + ' / ' + C.brightWhite + 'exit' + C.reset);
    scrollOutput(C.gray + (i18n.t('helpMultiLine') || '多行命令，例: { list; install FreeArc }') + C.reset);
    const hk = getHotkey().toUpperCase();
    scrollOutput(C.gray + '  ' +
      C.brightYellow + 'Ctrl+C' + C.reset + C.gray + ' 清空输入 · ' + C.reset +
      C.brightYellow + hk + C.reset + C.gray + ' 中断任务 · ' + C.reset +
      C.brightYellow + 'epm set hotkey <key>' + C.reset + C.gray + ' 切换 · ' + C.reset +
      C.brightYellow + 'Tab' + C.reset + C.gray + ' 补全' + C.reset);
    scrollOutput('');

    setupScrollRegion();
    attachInput();
    drawBottom();

    tickTimer = setInterval(function () {
      if (!exiting && tasks.count() > 0) drawBottom();
    }, 300);

    process.stdout.on('resize', function () {
      setupScrollRegion();
      drawBottom();
    });

    global.__epm_addHistory = function (cmd) {
      if (!cmd) return;
      const s = String(cmd).trim();
      if (!s) return;
      history.push(s);
      if (history.length > MAX_HISTORY) history.shift();
      historyIdx = -1;
    };

    global.__epm_cleanup = function () {
      if (tickTimer) clearInterval(tickTimer);
      if (stdinHandler) {
        try { process.stdin.removeListener('data', stdinHandler); } catch (_) {}
        stdinHandler = null;
      }
      try { process.stdin.setRawMode(false); } catch (_) {}
      try { process.stdin.pause(); } catch (_) {}
      try {
        const H = process.stdout.rows || 24;
        process.stdout.write('\x1b[r');
        process.stdout.write('\x1b[' + (H - 1) + ';1H');
        process.stdout.write('\x1b[J');
        process.stdout.write('\x1b[?25h\x1b[0m');
      } catch (_) {}
      console.log = origLog;
      console.error = origErr;
      console.warn = origWarn;
      global.__epm_shell = false;
      resolve();
    };
  });
}

module.exports = { run: run };
