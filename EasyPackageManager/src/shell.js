'use strict';

const { dispatch } = require('./cli');
const proc = require('./process');
const i18n = require('./i18n');
const versionLib = require('./version');
const { color } = require('./utils');

const MAX_HISTORY = 200;
const PROMPT = 'epm> ';

let inputBuf = '';
let cursorPos = 0;
let history = [];
let historyIdx = -1;
let stdinHandler = null;
let exiting = false;

/* ── 输入行渲染 ─────────────────────────────────────────────
 * 关键点：
 *  - 输入行永远在"当前行"（不清屏、不定位到最后一行）
 *  - console.log 前先清掉输入行，输出后重绘
 *  - 光标用相对移动，不用 \x1b[<row>;<col>H
 * ──────────────────────────────────────────────────────────── */

function drawInput() {
  if (exiting || !process.stdout.isTTY) return;
  let out = '\r\x1b[K';
  out += color.cyan(PROMPT) + inputBuf;
  const back = inputBuf.length - cursorPos;
  if (back > 0) out += '\x1b[' + back + 'D';
  out += '\x1b[?25h';
  process.stdout.write(out);
}

/* ── 劫持 console.* ──
 * 输入行会被清掉 -> 输出 -> 重绘
 * ──────────────────────────────────────────────────────────── */
let logHooked = false;
let origLog, origErr, origWarn;

function hookConsole() {
  if (logHooked) return;
  origLog = console.log;
  origErr = console.error;
  origWarn = console.warn;

  function wrap(orig) {
    return function () {
      if (process.stdout.isTTY && !exiting) {
        process.stdout.write('\r\x1b[K');   // 清当前输入行
      }
      orig.apply(console, arguments);
      if (process.stdout.isTTY && !exiting) {
        drawInput();                        // 重绘输入行
      }
    };
  }

  console.log = wrap(origLog);
  console.error = wrap(origErr);
  console.warn = wrap(origWarn);
  logHooked = true;
}

function unhookConsole() {
  if (!logHooked) return;
  console.log = origLog;
  console.error = origErr;
  console.warn = origWarn;
  logHooked = false;
}

/* ── 编辑操作 ── */
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
function move(d) { cursorPos = Math.max(0, Math.min(inputBuf.length, cursorPos + d)); }
function histUp() {
  if (!history.length) return;
  if (historyIdx < history.length - 1) {
    historyIdx++;
    inputBuf = history[history.length - 1 - historyIdx];
    cursorPos = inputBuf.length;
  }
}
function histDown() {
  if (historyIdx <= 0) { historyIdx = -1; inputBuf = ''; cursorPos = 0; return; }
  historyIdx--;
  inputBuf = history[history.length - 1 - historyIdx];
  cursorPos = inputBuf.length;
}

/* ── 命令执行 ── */
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
      console.error((e && e.message) || String(e));
    }
  }
}

/* ── 输入处理 ── */
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

      // ESC 序列
      if (code === 0x1B) {
        if (str[i + 1] === '[') {
          const k = str[i + 2];
          if (k === 'A') { histUp(); i += 3; continue; }
          if (k === 'B') { histDown(); i += 3; continue; }
          if (k === 'C') { move(1); i += 3; continue; }
          if (k === 'D') { move(-1); i += 3; continue; }
          if (k === 'H') { cursorPos = 0; i += 3; continue; }
          if (k === 'F') { cursorPos = inputBuf.length; i += 3; continue; }
          if (k === '3' && str[i + 3] === '~') { deleteChar(); i += 4; continue; }
          i += 3; continue;
        }
        i++; continue;
      }

      // 回车
      if (code === 0x0D || code === 0x0A) {
        i++;
        const cmd = inputBuf.trim();
        inputBuf = '';
        cursorPos = 0;

        // 清掉输入行
        if (process.stdout.isTTY) process.stdout.write('\r\x1b[K');

        if (!cmd) { drawInput(); continue; }

        history.push(cmd);
        if (history.length > MAX_HISTORY) history.shift();
        historyIdx = -1;

        console.log(color.cyan(PROMPT) + cmd);

        if (cmd === 'exit' || cmd === 'quit') {
          exiting = true;
          unhookConsole();
          if (global.__epm_exitNow) global.__epm_exitNow(0);
          return;
        }

        // 异步执行，不阻塞输入
        handleCommand(cmd).catch(function (e) {
          console.error((e && e.message) || String(e));
        });
        drawInput();
        continue;
      }

      // 退格
      if (code === 0x7F || code === 0x08) { i++; backspace(); continue; }

      // 控制字符
      if (code < 0x20) {
        i++;
        if (code === 0x03) {
          inputBuf = '';
          cursorPos = 0;
          const tasks = require('./tasks');
          if (tasks.count() > 0) {
            const killed = tasks.abortAll();
            process.stdout.write('\r\x1b[K');
            process.stdout.write('^C  中断 ' + killed.length + ' 个任务\n');
          } else {
            process.stdout.write('^C\n');
          }
        } else if (code === 0x04) {
          if (inputBuf.length === 0) process.stdout.write('^D\n');
          else deleteChar();
        } else if (code === 0x15) { inputBuf = ''; cursorPos = 0; }
        else if (code === 0x17) {
          const b = inputBuf.slice(0, cursorPos);
          const a = inputBuf.slice(cursorPos);
          const t = b.replace(/\S+\s*$/, '');
          inputBuf = t + a;
          cursorPos = t.length;
        }
        else if (code === 0x01) cursorPos = 0;
        else if (code === 0x05) cursorPos = inputBuf.length;
        continue;
      }

      // 普通字符（含多字节 UTF-8）
      const cp = str.codePointAt(i);
      const len = cp > 0xFFFF ? 2 : 1;
      insertStr(str.slice(i, i + len));
      i += len;
    }

    drawInput();
  };

  process.stdin.on('data', stdinHandler);
}

/* ── 主入口 ── */
function run() {
  return new Promise(function (resolve) {
    hookConsole();

    console.log('EasyPackageManager  v' + versionLib.getPkgVersion());
    console.log(i18n.t('helpUsage') + ': help / exit');
    console.log(i18n.t('helpMultiLine'));
    console.log('');

    attachInput();
    drawInput();

    global.__epm_cleanup = function () {
      unhookConsole();
      if (stdinHandler) {
        try { process.stdin.removeListener('data', stdinHandler); } catch (_) {}
        stdinHandler = null;
      }
      try { process.stdin.setRawMode(false); } catch (_) {}
      try { process.stdin.pause(); } catch (_) {}
      if (process.stdout.isTTY) process.stdout.write('\x1b[?25h\x1b[0m');
      resolve();
    };
  });
}

module.exports = { run };
