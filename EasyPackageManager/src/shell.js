'use strict';

const { dispatch } = require('./cli');
const proc = require('./process');
const tasks = require('./tasks');
const i18n = require('./i18n');
const versionLib = require('./version');
const platform = require('./platform');
const { color: color, formatBytes: formatBytes } = require('./utils');

const MAX_LEFT = 2000;
const MAX_HISTORY = 200;
const PROMPT_LEN = 5; // 'epm> '.length

let leftBuf = [];
let inputBuf = '';
let cursorPos = 0;
let history = [];
let historyIdx = -1;
let renderTimer = null;
let renderLock = false;
let inputWatcher = null;
let onResize = null;
let submitted = false;

/* ══════════════════════════════════════════════════ ANSI 工具 */

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLen(s) {
  return stripAnsi(s).length;
}

function truncTo(s, w) {
  if (visibleLen(s) <= w) return s;
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

function padTo(s, w) {
  const v = visibleLen(s);
  if (v >= w) return s;
  return s + ' '.repeat(w - v);
}

function padTrunc(s, w) {
  if (visibleLen(s) > w) return truncTo(s, w);
  return padTo(s, w);
}

function pushLine(line) {
  const str = String(line == null ? '' : line).replace(/\r/g, '');
  for (const ln of str.split('\n')) {
    leftBuf.push(ln);
    if (leftBuf.length > MAX_LEFT) leftBuf.shift();
  }
}

/* ══════════════════════════════════════════════════ 任务面板 */

function humanSpeed(bps) {
  if (!isFinite(bps) || bps <= 0) return '0 B/s';
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let v = bps, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(i === 0 ? 0 : 2) + ' ' + u[i];
}

function buildTaskLines(taskList, width) {
  const out = [];
  const header = i18n.t('taskHeader') !== 'taskHeader' ? i18n.t('taskHeader') : 'Tasks';
  out.push(color.bold(header) + color.gray(' (' + taskList.length + ')'));
  out.push('');

  for (const t of taskList) {
    const icon = t.type === 'download' ? color.cyan('▼') : color.yellow('■');
    const dlLabel = i18n.t('taskDownload') !== 'taskDownload' ? i18n.t('taskDownload') : 'download';
    const inLabel = i18n.t('taskInstall') !== 'taskInstall' ? i18n.t('taskInstall') : 'install';
    const label = (t.type === 'download' ? dlLabel : inLabel);

    out.push(icon + ' ' + color.bold(t.name));
    out.push('  ' + color.gray('[' + label + ']'));

    if (t.type === 'download') {
      const pct = t.total > 0 ? Math.min(t.bytes / t.total, 1) : 0;
      const barW = Math.max(10, Math.min(width - 6, 30));
      const filled = Math.round(barW * pct);
      const bar = color.green('█'.repeat(filled)) + ' '.repeat(Math.max(0, barW - filled));
      const pctStr = t.total > 0 ? (pct * 100).toFixed(0).padStart(3) + '%' : ' --%';
      out.push('  ' + bar + ' ' + pctStr);

      const elapsed = Math.max(0.1, (Date.now() - t.started) / 1000);
      const speed = humanSpeed(t.bytes / elapsed);
      const sizeStr = t.total > 0
        ? formatBytes(t.bytes) + ' / ' + formatBytes(t.total)
        : formatBytes(t.bytes);
      out.push('  ' + color.gray(sizeStr + '  ' + speed));
    } else {
      out.push('  ' + color.gray('...'));
    }

    out.push('');
  }

  return out;
}

/* ══════════════════════════════════════════════════ 渲染 */

function render() {
  if (renderLock) return;
  if (!process.stdout.isTTY) return;

  renderLock = true;
  try {
    const W = process.stdout.columns || 80;
    const H = process.stdout.rows || 24;

    const taskList = tasks.list();
    const hasTasks = taskList.length > 0;

    const leftW = hasTasks ? Math.max(30, Math.floor(W * 0.58)) : W;
    const rightW = hasTasks ? W - leftW - 1 : 0;

    let out = '';
    out += '\x1b[?25l';    // 隐藏光标
    out += '\x1b[1;1H';    // 光标移到 (1,1)
    out += '\x1b[J';       // 清到屏幕末尾

    // ── 标题栏 ──
    const title = ' EasyPackageManager  v' + versionLib.getPkgVersion() +
                  '  ' + platform.platform + '  ' + i18n.current() +
                  (hasTasks ? '  ·  ' + taskList.length + ' ' +
                    (i18n.t('taskRunningUnit') !== 'taskRunningUnit'
                      ? i18n.t('taskRunningUnit') : 'task(s)') : '') +
                  ' ';
    const tlen = visibleLen(title);
    out += color.cyan(title) + color.gray('─'.repeat(Math.max(0, W - tlen))) + '\n';

    // ── 内容区 ──
    // 总行数分配：1 标题 + contentH 内容 + 1 分隔线 + 1 输入 = H
    const contentH = Math.max(3, H - 3);
    const leftLines = leftBuf.slice(-contentH);
    const rightLines = hasTasks ? buildTaskLines(taskList, rightW) : [];

    for (let i = 0; i < contentH; i++) {
      const l = leftLines[i] || '';
      if (hasTasks) {
        out += padTrunc(l, leftW) + color.gray('│') + padTrunc(rightLines[i] || '', rightW) + '\n';
      } else {
        out += truncTo(l, W) + '\n';
      }
    }

    // ── 分隔线 ──
    out += color.gray('─'.repeat(W)) + '\n';

    // ── 输入行 ──
    out += color.cyan('epm> ') + inputBuf;

    // ── 光标定位（输入行是第 H 行，列 = 5 + cursorPos + 1） ──
    const cursorCol = PROMPT_LEN + cursorPos + 1;
    out += '\x1b[' + H + ';' + cursorCol + 'H';
    out += '\x1b[?25h';   // 显示光标

    process.stdout.write(out);
  } finally {
    renderLock = false;
  }
}

function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(function () {
    renderTimer = null;
    render();
  }, 60);
}

/* ══════════════════════════════════════════════════ 命令提交 */

async function submitCommand(cmd) {
  const raw = cmd.trim();
  if (!raw) { render(); return; }

  pushLine(color.cyan('epm> ') + raw);
  render();

  if (raw === 'exit' || raw === 'quit') {
    cleanup();
    proc.exitAll(0);
    return;
  }

  let commands;
  if (raw[0] === '{' && raw[raw.length - 1] === '}') {
    commands = raw.slice(1, -1).split(';').map(function (s) { return s.trim(); }).filter(Boolean);
  } else {
    commands = [raw];
  }

  for (const c of commands) {
    try {
      const argv = c.split(/\s+/);
      if (argv[0] === 'epm') argv.shift();
      await dispatch(argv);
    } catch (err) {
      pushLine(color.red('x') + ' ' + ((err && err.message) || String(err)));
    }
  }

  render();
}

/* ══════════════════════════════════════════════════ 编辑器辅助 */

function insertStr(s) {
  inputBuf = inputBuf.slice(0, cursorPos) + s + inputBuf.slice(cursorPos);
  cursorPos += s.length;
}

function backspace() {
  if (cursorPos > 0) {
    const before = inputBuf.slice(0, cursorPos);
    const after = inputBuf.slice(cursorPos);
    // 处理多字节字符
    const chars = Array.from(before);
    chars.pop();
    inputBuf = chars.join('') + after;
    cursorPos = chars.join('').length;
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

function moveCursor(delta) {
  cursorPos = Math.max(0, Math.min(inputBuf.length, cursorPos + delta));
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

function killLineBefore() {
  inputBuf = inputBuf.slice(cursorPos);
  cursorPos = 0;
}

function killLineAfter() {
  inputBuf = inputBuf.slice(0, cursorPos);
}

function killWordBefore() {
  const before = inputBuf.slice(0, cursorPos);
  const after = inputBuf.slice(cursorPos);
  const trimmed = before.replace(/\S+\s*$/, '');
  inputBuf = trimmed + after;
  cursorPos = trimmed.length;
}

/* ══════════════════════════════════════════════════ 输入处理 */

function attachInput() {
  process.stdin.setEncoding('utf8');

  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(true); } catch (_) {}
  }
  process.stdin.resume();

  inputWatcher = function (data) {
    const str = String(data);
    let i = 0;

    while (i < str.length) {
      const ch = str[i];
      const code = ch.charCodeAt(0);

      // ── ESC 序列 ──
      if (code === 0x1B) {
        if (str[i + 1] === '[') {
          const key = str[i + 2];
          // 检查是否是 \x1b[N~ 形式
          if (key === '3' && str[i + 3] === '~') {
            deleteChar();
            i += 4;
            scheduleRender();
            continue;
          }
          if (key === 'H') { cursorPos = 0; i += 3; scheduleRender(); continue; }
          if (key === 'F') { cursorPos = inputBuf.length; i += 3; scheduleRender(); continue; }
          if (key === 'A') { historyUp(); i += 3; scheduleRender(); continue; }
          if (key === 'B') { historyDown(); i += 3; scheduleRender(); continue; }
          if (key === 'C') { moveCursor(1); i += 3; scheduleRender(); continue; }
          if (key === 'D') { moveCursor(-1); i += 3; scheduleRender(); continue; }
          // 未知序列，跳过 3 个
          i += 3;
          continue;
        }
        // 单独 ESC
        i++;
        continue;
      }

      // ── 回车 ──
      if (code === 0x0D || code === 0x0A) {
        i++;
        const cmd = inputBuf;
        inputBuf = '';
        cursorPos = 0;
        if (cmd.trim()) {
          history.push(cmd.trim());
          if (history.length > MAX_HISTORY) history.shift();
          historyIdx = -1;
        }
        submitted = true;
        submitCommand(cmd);
        continue;
      }

      // ── 退格 ──
      if (code === 0x7F || code === 0x08) {
        i++;
        backspace();
        scheduleRender();
        continue;
      }

      // ── 控制字符 ──
      if (code < 0x20) {
        i++;
        if (code === 0x03) {
          // Ctrl+C：清空输入，显示提示
          inputBuf = '';
          cursorPos = 0;
          const hint = i18n.t('hotkeyExitHint') !== 'hotkeyExitHint'
            ? i18n.t('hotkeyExitHint') : 'use exit or quit to leave';
          pushLine(color.gray('^C  (' + hint + ')'));
          scheduleRender();
        } else if (code === 0x04) {
          // Ctrl+D
          if (inputBuf.length === 0) {
            const hint = i18n.t('hotkeyExitHint') !== 'hotkeyExitHint'
              ? i18n.t('hotkeyExitHint') : 'use exit or quit to leave';
            pushLine(color.gray('^D  (' + hint + ')'));
          } else {
            deleteChar();
          }
          scheduleRender();
        } else if (code === 0x0C) {
          // Ctrl+L：清屏
          leftBuf = [];
          scheduleRender();
        } else if (code === 0x15) {
          // Ctrl+U
          killLineBefore();
          scheduleRender();
        } else if (code === 0x0B) {
          // Ctrl+K
          killLineAfter();
          scheduleRender();
        } else if (code === 0x17) {
          // Ctrl+W
          killWordBefore();
          scheduleRender();
        } else if (code === 0x01) {
          // Ctrl+A
          cursorPos = 0;
          scheduleRender();
        } else if (code === 0x05) {
          // Ctrl+E
          cursorPos = inputBuf.length;
          scheduleRender();
        }
        continue;
      }

      // ── 普通字符（含多字节 UTF-8） ──
      // 判断是否是多字节 UTF-8 起始字节
      const cp = str.codePointAt(i);
      const charLen = cp > 0xFFFF ? 2 : 1;
      const c = str.slice(i, i + charLen);
      insertStr(c);
      i += charLen;
      scheduleRender();
    }
  };

  process.stdin.on('data', inputWatcher);
}

function detachInput() {
  if (inputWatcher) {
    try { process.stdin.removeListener('data', inputWatcher); } catch (_) {}
    inputWatcher = null;
  }
  try { process.stdin.pause(); } catch (_) {}
  try { process.stdin.setRawMode(false); } catch (_) {}
}

/* ══════════════════════════════════════════════════ 生命周期 */

function cleanup() {
  detachInput();

  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?25h\x1b[0m');
  }

  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
  tasks.off(scheduleRender);

  if (onResize) {
    try { process.stdout.removeListener('resize', onResize); } catch (_) {}
  }

  proc.unregister();
}

function run() {
  return new Promise(function (resolve) {
    const origLog = console.log;
    const origErr = console.error;
    const origWarn = console.warn;

    function wrap() {
      const text = Array.from(arguments).map(function (a) {
        return typeof a === 'string' ? a : String(a);
      }).join(' ');
      pushLine(text);
      scheduleRender();
    }

    console.log = wrap;
    console.error = wrap;
    console.warn = wrap;

    onResize = function () { scheduleRender(); };
    process.stdout.on('resize', onResize);
    tasks.on(scheduleRender);

    // 屏蔽进程信号（避免 Ctrl+C 之类直接退出）
    try { process.on('SIGINT', function () {}); } catch (_) {}
    try { process.on('SIGTERM', function () {}); } catch (_) {}
    try { process.on('SIGHUP', function () {}); } catch (_) {}

    // 窗口尺寸为 0 时（非 TTY）降级
    if (!process.stdout.isTTY) {
      // 非 TTY，直接执行一次空 render 后按普通模式跑
      // 这里用 simple 模式，等命令处理完后再 resolve
      const rl = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.on('line', async function (line) {
        const cmd = line.trim();
        if (cmd === 'exit' || cmd === 'quit') { rl.close(); proc.exitAll(0); return; }
        if (!cmd) return;
        let cmds = [cmd];
        if (cmd[0] === '{' && cmd[cmd.length - 1] === '}') {
          cmds = cmd.slice(1, -1).split(';').map(function (s) { return s.trim(); }).filter(Boolean);
        }
        for (const c of cmds) {
          try {
            const argv = c.split(/\s+/);
            if (argv[0] === 'epm') argv.shift();
            await dispatch(argv);
          } catch (err) {
            console.error((err && err.message) || String(err));
          }
        }
      });
      rl.on('close', function () {
        console.log = origLog;
        console.error = origErr;
        console.warn = origWarn;
        resolve();
      });
      return;
    }

    attachInput();
    render();

    // 提供正常 resolve 的路径（如果不是通过 exit 命令退出的）
    global.__epm_cleanup = function () {
      cleanup();
      console.log = origLog;
      console.error = origErr;
      console.warn = origWarn;
      resolve();
    };
  });
}

module.exports = { run: run };
