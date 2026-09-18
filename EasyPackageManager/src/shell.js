'use strict';

const { dispatch } = require('./cli');
const proc = require('./process');
const tasks = require('./tasks');
const i18n = require('./i18n');
const versionLib = require('./version');
const { color, formatBytes } = require('./utils');

let inputBuf = '';
let cursorPos = 0;
let history = [];
let historyIdx = -1;
const MAX_HISTORY = 200;
let stdinHandler = null;
let refreshTimer = null;
let exiting = false;
let scrollRegionActive = false;
let lastPanelH = 0;
let lastTaskCount = 0;

function t(key, fallback) {
  const v = i18n.t(key);
  return v === key ? (fallback || key) : v;
}

/* ═══════════════════════════════════════ ANSI helpers */

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

function vlen(s) {
  return stripAnsi(s).length;
}

function truncTo(s, w) {
  if (vlen(s) <= w) return s;
  let visible = 0, i = 0;
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

function humanSpeed(bps) {
  if (!isFinite(bps) || bps <= 0) return '0 B/s';
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let v = bps, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(i === 0 ? 0 : 2) + ' ' + u[i];
}

/* ═══════════════════════════════════════ 面板布局 */

function getH() { return process.stdout.rows || 24; }
function getW() { return process.stdout.columns || 80; }

function getPanelHeight() {
  if (tasks.count() === 0) return 0;
  // 每个任务 1 行，最多显示 3 个 + 标题 1 + 分隔 1 + 输入 1
  const n = Math.min(tasks.count(), 3);
  return n + 3;
}

function getScrollBottom() {
  const H = getH();
  const panelH = getPanelHeight();
  if (panelH === 0) return H;
  return Math.max(3, H - panelH);
}

/* ═══════════════════════════════════════ 滚动区域管理 */

function updateScrollRegion() {
  if (!process.stdout.isTTY) return;
  const H = getH();
  const panelH = getPanelHeight();
  const active = panelH > 0;

  if (!active) {
    // 没有任务：重置滚动区域为整个屏幕
    if (scrollRegionActive) {
      process.stdout.write(`\x1b[r`); // 重置
      scrollRegionActive = false;
      lastPanelH = 0;
    }
    return;
  }

  if (!scrollRegionActive || lastPanelH !== panelH) {
    const scrollBottom = H - panelH;
    process.stdout.write(`\x1b[1;${scrollBottom}r`); // 设置滚动区域
    process.stdout.write(`\x1b[${scrollBottom};1H`); // 光标移到底部
    scrollRegionActive = true;
    lastPanelH = panelH;
  }
}

/* ═══════════════════════════════════════ 面板绘制 */

function buildTaskLines(width) {
  const out = [];
  const list = tasks.list();

  out.push(color.bold(t('taskHeader', 'Tasks')) + color.gray(' (' + list.length + ')'));

  for (const tk of list.slice(0, 3)) {
    const icon = tk.type === 'download' ? color.cyan('▼') : color.yellow('■');
    const label = tk.type === 'download'
      ? t('taskDownload', 'download')
      : t('taskInstall', 'install');
    let line = icon + ' ' + color.bold(tk.name) + ' ' + color.gray('[' + label + ']');

    if (tk.type === 'download') {
      const pct = tk.total > 0 ? Math.min(tk.bytes / tk.total, 1) : 0;
      const barW = Math.max(8, Math.min(width - 55, 20));
      const filled = Math.round(barW * pct);
      const bar = color.green('█'.repeat(filled)) + ' '.repeat(barW - filled);
      const pctStr = tk.total > 0 ? (pct * 100).toFixed(0).padStart(3) + '%' : ' --%';
      const elapsed = Math.max(0.1, (Date.now() - tk.started) / 1000);
      const speed = humanSpeed(tk.bytes / elapsed);
      const sizeStr = tk.total > 0
        ? formatBytes(tk.bytes) + '/' + formatBytes(tk.total)
        : formatBytes(tk.bytes);
      line += '  ' + bar + ' ' + pctStr + ' ' + color.gray(sizeStr + '  ' + speed);
    } else {
      line += '  ' + color.gray('...');
    }
    out.push(line);
  }

  if (list.length > 3) {
    out.push(color.gray('  + ' + (list.length - 3) + ' more'));
  }

  return out;
}

function drawPanel() {
  if (!process.stdout.isTTY) return;
  if (exiting) return;

  const H = getH();
  const W = getW();
  const panelH = getPanelHeight();

  if (panelH === 0) return;

  const scrollBottom = H - panelH;
  let out = '';

  // 分隔线（panel 上方一行）
  out += `\x1b[${scrollBottom + 1};1H\x1b[K` + color.gray('─'.repeat(W));

  // 任务列表
  const taskLines = buildTaskLines(W);
  const taskAreaH = panelH - 2; // 去掉分隔线 + 输入行
  for (let i = 0; i < taskAreaH; i++) {
    out += `\x1b[${scrollBottom + 2 + i};1H\x1b[K`;
    if (i < taskLines.length) {
      out += truncTo(taskLines[i], W);
    }
  }

  // 输入行（最后一行）
  out += `\x1b[${H};1H\x1b[K` + color.cyan('epm> ') + inputBuf;
  const cursorCol = 5 + cursorPos + 1;
  out += `\x1b[${H};${cursorCol}H\x1b[?25h`;

  process.stdout.write(out);
}

/* ═══════════════════════════════════════ 日志输出 */

function logLine(text) {
  if (exiting) return;

  if (!process.stdout.isTTY) {
    process.stdout.write(text + '\n');
    return;
  }

  updateScrollRegion();

  const H = getH();
  const panelH = getPanelHeight();

  if (panelH === 0) {
    // 无任务：直接输出
    process.stdout.write(text + '\n');
    return;
  }

  // 有任务：在滚动区域内输出
  const scrollBottom = H - panelH;
  process.stdout.write(`\x1b[${scrollBottom};1H\x1b[K`);
  process.stdout.write(text);
  process.stdout.write('\n');
  // 光标自动滚动

  drawPanel();
}

/* ═══════════════════════════════════════ 输入处理 */

function insertStr(s) {
  inputBuf = inputBuf.slice(0, cursorPos) + s + inputBuf.slice(cursorPos);
  cursorPos += s.length;
}
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
function moveCursor(d) {
  cursorPos = Math.max(0, Math.min(inputBuf.length, cursorPos + d));
}
function historyUp() {
  if (!history.length) return;
  if (historyIdx < history.length - 1) {
    historyIdx++;
    inputBuf = history[history.length - 1 - historyIdx];
    cursorPos = inputBuf.length;
  }
}
function historyDown() {
  if (historyIdx <= 0) {
    historyIdx = -1;
    inputBuf = '';
    cursorPos = 0;
    return;
  }
  historyIdx--;
  inputBuf = history[history.length - 1 - historyIdx];
  cursorPos = inputBuf.length;
}

async function handleCommand(cmd) {
  let commands;
  if (cmd[0] === '{' && cmd[cmd.length - 1] === '}') {
    commands = cmd.slice(1, -1).split(';').map(s => s.trim()).filter(Boolean);
  } else {
    commands = [cmd];
  }
  for (const c of commands) {
    try {
      const argv = c.split(/\s+/);
      if (argv[0] === 'epm') argv.shift();
      await dispatch(argv);
    } catch (err) {
      logLine(color.red('x') + ' ' + ((err && err.message) || String(err)));
    }
  }
}

function attachInput() {
  process.stdin.setEncoding('utf8');
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(true); } catch (_) {}
  }
  process.stdin.resume();

  stdinHandler = function (data) {
    const str = String(data);
    let i = 0;

    while (i < str.length) {
      const code = str.charCodeAt(i);

      if (code === 0x1B) {
        if (str[i + 1] === '[') {
          const k = str[i + 2];
          if (k === 'A') { historyUp(); i += 3; continue; }
          if (k === 'B') { historyDown(); i += 3; continue; }
          if (k === 'C') { moveCursor(1); i += 3; continue; }
          if (k === 'D') { moveCursor(-1); i += 3; continue; }
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

        if (cmd) {
          history.push(cmd);
          if (history.length > MAX_HISTORY) history.shift();
          historyIdx = -1;
          logLine(color.cyan('epm> ') + cmd);

          if (cmd === 'exit' || cmd === 'quit') {
            exiting = true;
            if (global.__epm_cleanup) global.__epm_cleanup();
            proc.exitAll(0);
            return;
          }

          handleCommand(cmd);
        }
        drawPanel();
        continue;
      }

      if (code === 0x7F || code === 0x08) {
        i++;
        backspace();
        drawPanel();
        continue;
      }

      if (code < 0x20) {
        i++;
        if (code === 0x03) {
          inputBuf = '';
          cursorPos = 0;
          logLine(color.gray('^C'));
        } else if (code === 0x04) {
          if (inputBuf.length === 0) {
            logLine(color.gray('^D  (use exit to quit)'));
          } else {
            deleteChar();
          }
        } else if (code === 0x15) {
          inputBuf = '';
          cursorPos = 0;
        } else if (code === 0x17) {
          const before = inputBuf.slice(0, cursorPos);
          const after = inputBuf.slice(cursorPos);
          const trimmed = before.replace(/\S+\s*$/, '');
          inputBuf = trimmed + after;
          cursorPos = trimmed.length;
        } else if (code === 0x01) {
          cursorPos = 0;
        } else if (code === 0x05) {
          cursorPos = inputBuf.length;
        }
        drawPanel();
        continue;
      }

      const cp = str.codePointAt(i);
      const len = cp > 0xFFFF ? 2 : 1;
      insertStr(str.slice(i, i + len));
      i += len;
    }

    drawPanel();
  };

  process.stdin.on('data', stdinHandler);
}

/* ═══════════════════════════════════════ 主入口 */

function run() {
  return new Promise(function (resolve) {
    const origLog = console.log;
    const origErr = console.error;
    const origWarn = console.warn;

    function wrap() {
      const s = Array.from(arguments).map(a => typeof a === 'string' ? a : String(a)).join(' ');
      logLine(s);
    }

    console.log = wrap;
    console.error = wrap;
    console.warn = wrap;

    try { process.on('SIGINT', function () {}); } catch (_) {}
    try { process.on('SIGTERM', function () {}); } catch (_) {}
    try { process.on('SIGHUP', function () {}); } catch (_) {}
    try { process.on('SIGBREAK', function () {}); } catch (_) {}

    // 欢迎
    logLine('EasyPackageManager  v' + versionLib.getPkgVersion());
    logLine(i18n.t('helpUsage') + ': help / exit');
    logLine(i18n.t('helpMultiLine'));
    logLine('');

    attachInput();
    drawPanel();

    // 100ms 刷新任务面板
    refreshTimer = setInterval(function () {
      const now = tasks.count();
      if (now > 0 || now !== lastTaskCount) {
        updateScrollRegion();
        drawPanel();
      }
      lastTaskCount = now;
    }, 100);

    global.__epm_cleanup = function () {
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
      if (stdinHandler) {
        try { process.stdin.removeListener('data', stdinHandler); } catch (_) {}
        stdinHandler = null;
      }
      try { process.stdin.setRawMode(false); } catch (_) {}
      try { process.stdin.pause(); } catch (_) {}
      if (process.stdout.isTTY) {
        process.stdout.write('\x1b[r\x1b[?25h\x1b[0m');
      }
      console.log = origLog;
      console.error = origErr;
      console.warn = origWarn;
      resolve();
    };
  });
}

module.exports = { run: run };
