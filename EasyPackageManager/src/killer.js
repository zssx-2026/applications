'use strict';

/**
 * 结束与包名相关的进程
 * - Windows: taskkill /F /IM <name>.exe
 * - Unix:    pkill -f <name>
 */

const { execFileSync } = require('child_process');
const platform = require('./platform');
const { log: log, color: color } = require('./utils');

/**
 * 生成可能的进程名候选
 * 比如 pkg.name = "FreeArc"，fileName = "FreeArc_x64_Setup.exe"
 *   → 候选: ["FreeArc", "FreeArc.exe", "FreeArc_x64", "FreeArc_x64.exe"]
 */
function buildCandidates(pkg) {
  const set = new Set();
  const add = function (s) {
    if (!s) return;
    s = String(s).trim();
    if (!s) return;
    set.add(s);
    if (platform.isWindows()) set.add(s + '.exe');
    else set.add(s.toLowerCase());
  };

  if (pkg.name) {
    add(pkg.name);
    add(pkg.name.toLowerCase());
  }

  if (pkg.fileName) {
    // 去掉安装/便携后缀，得到基础名
    let base = String(pkg.fileName)
      .replace(/\.(exe|msi|zip|tar\.gz|tgz|tar|7z|rar)$/i, '')
      .replace(/[_.-](x64|x86|amd64|arm64|32|64)$/i, '')
      .replace(/[_.-](setup|installer|install|portable|port|green|noinstall|standalone)$/i, '');
    add(base);
  }

  return Array.from(set);
}

/**
 * 按名字 kill 一个进程（忽略失败）
 */
function killByName(name) {
  try {
    if (platform.isWindows()) {
      // Windows: 名字不含空格时用 /IM 直接匹配
      execFileSync('taskkill', ['/F', '/IM', name], { stdio: 'ignore' });
      return true;
    } else {
      // Unix: pkill -f
      execFileSync('pkill', ['-f', name], { stdio: 'ignore' });
      return true;
    }
  } catch (_) {
    // taskkill 找不到进程会返回非 0，不是错误
    return false;
  }
}

/**
 * 结束与包相关的所有进程
 * @returns {number} 成功 kill 的候选数（有输出即代表杀到东西，但 taskkill 会一起吞掉）
 */
function killPackage(pkg) {
  if (!pkg) return 0;
  const candidates = buildCandidates(pkg);
  let count = 0;

  for (const name of candidates) {
    if (killByName(name)) count++;
  }

  return count;
}

/**
 * 结束后等待一小会儿让系统释放文件句柄
 */
function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

async function killAndWait(pkg, ms) {
  const n = killPackage(pkg);
  if (n > 0) await sleep(ms == null ? 800 : ms);
  return n;
}

module.exports = {
  buildCandidates: buildCandidates,
  killPackage: killPackage,
  killAndWait: killAndWait,
  killByName: killByName,
  sleep: sleep
};
