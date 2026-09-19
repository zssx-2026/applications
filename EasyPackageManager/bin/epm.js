#!/usr/bin/env node
'use strict';

const path = require('path');
const proc = require('../src/process');
proc.register();

['SIGINT','SIGTERM','SIGHUP','SIGBREAK','SIGQUIT'].forEach(function (s) {
  try { process.on(s, function () {}); } catch (_) {}
});

let exiting = false;

global.__epm_exitNow = function (c) {
  if (exiting) return;
  exiting = true;
  try { proc.unregister(); } catch (_) {}
  process.exit(typeof c === 'number' ? c : 0);
};

process.on('exit', function () { try { proc.unregister(); } catch (_) {} });

/* ══════════════════════════════════════════════════════════════
 * 解析 argv
 *
 * 普通 node: process.argv = [node.exe, script.js, ...args]
 *            → slice(2)
 *
 * SEA exe:   process.argv = [execPath, 用户原始输入的程序名, ...args]
 *            例：["D:\...\epm.exe", "dist\\epm.exe", "web"]
 *            注意 argv[1] 是用户字面输入，不等于 execPath
 *            → 要循环过滤掉头部"看起来像程序名"的项
 * ══════════════════════════════════════════════════════════════ */

function parseArgs() {
  const isNodeExe = /(^|[\\/])node(\.exe)?$/i.test(process.execPath);
  if (isNodeExe) return process.argv.slice(2);

  let args = process.argv.slice(1);
  const execBase = path.basename(process.execPath).toLowerCase();

  // 循环去掉开头的"程序名"参数
  while (args.length > 0) {
    const a = String(args[0]);
    const base = path.basename(a).toLowerCase();
    if (base === execBase) { args.shift(); continue; }
    break;
  }

  return args;
}

const args = parseArgs();

if (process.env.EPM_DEBUG) {
  console.error('[epm-debug] execPath=' + process.execPath);
  console.error('[epm-debug] argv=' + JSON.stringify(process.argv));
  console.error('[epm-debug] args=' + JSON.stringify(args));
}

async function main() {
  if (args.length === 0) {
    await require('../src/shell').run();
    global.__epm_exitNow(0);
    return;
  }

  await require('../src/cli').dispatch(args);

  if (global.__epm_keepAlive) return;

  global.__epm_exitNow(0);
}

main().catch(function (e) {
  console.error('\u001b[31mx\u001b[0m ' + (e && e.stack ? e.stack : String(e)));
  if (global.__epm_keepAlive) return;
  global.__epm_exitNow(1);
});
