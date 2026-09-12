'use strict';

const readline = require('readline');
const { dispatch } = require('./cli');
const proc = require('./process');
const i18n = require('./i18n');
const tui = require('./tui');
const { color: color } = require('./utils');

function run() {
  return new Promise(function (resolve) {
    // ── 挂接 console，把输出重定向到 TUI 缓冲区 ──
    const origLog = console.log;
    const origErr = console.error;
    const origWarn = console.warn;

    let capturing = true;

    function capture(args) {
      if (!capturing) return;
      const line = Array.from(args).map(function (a) {
        return typeof a === 'string' ? a : String(a);
      }).join(' ');
      tui.push(line);
    }

    console.log = function () { capture(arguments); };
    console.error = function () { capture(arguments); };
    console.warn = function () { capture(arguments); };

    function restoreConsole() {
      console.log = origLog;
      console.error = origErr;
      console.warn = origWarn;
    }

    // ── 创建 readline ──
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: color.cyan('epm> '),
      terminal: true
    });

    global.__epm_rl = rl;

    tui.clear();

    // 首次绘制
    tui.draw();
    rl.prompt();

    // ── 处理输入行 ──
    rl.on('line', async function (line) {
      const raw = line.trim();

      if (!raw) {
        // 空输入：清屏 + 重绘
        tui.draw();
        rl.prompt();
        return;
      }

      if (raw === 'exit' || raw === 'quit') {
        restoreConsole();
        rl.close();
        proc.exitAll(0);
        return;
      }

      // 记录命令到日志
      tui.push(color.cyan('epm> ') + raw);

      let commands;
      if (raw[0] === '{' && raw[raw.length - 1] === '}') {
        commands = raw.slice(1, -1).split(';').map(function (s) { return s.trim(); }).filter(Boolean);
      } else {
        commands = [raw];
      }

      for (const cmd of commands) {
        try {
          const argv = cmd.split(/\s+/);
          if (argv[0] === 'epm') argv.shift();
          await dispatch(argv);
        } catch (err) {
          tui.push(color.red('x') + ' ' + ((err && err.message) || String(err)));
        }
      }

      // 命令完成：清屏重绘 TUI
      tui.draw();
      rl.prompt();
    });

    rl.on('close', function () {
      global.__epm_rl = null;
      restoreConsole();
      proc.unregister();
      resolve();
    });

    // 窗口尺寸变化时重绘
    process.stdout.on('resize', function () {
      if (global.__epm_rl) tui.draw();
    });
  });
}

module.exports = { run: run };
