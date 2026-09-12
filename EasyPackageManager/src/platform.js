'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

function isWindows() { return process.platform === 'win32'; }
function isMac() { return process.platform === 'darwin'; }
function isLinux() { return process.platform === 'linux'; }

function platformTokens() {
  const list = [];
  if (isWindows()) list.push('win32', 'windows', 'win', 'pc-windows');
  else if (isMac()) list.push('darwin', 'macos', 'mac', 'osx', 'apple');
  else if (isLinux()) list.push('linux', 'gnu', 'ubuntu', 'debian');
  return list;
}

function archTokens() {
  const arch = process.arch;
  const list = [arch];
  if (arch === 'x64') list.push('amd64', 'x86_64');
  if (arch === 'ia32') list.push('x86', 'i386', 'i686');
  if (arch === 'arm64') list.push('aarch64');
  if (arch === 'arm') list.push('armv7', 'armhf');
  return list;
}

function defaultInstallDir() {
  if (isWindows()) {
    const pf = process.env.ProgramFiles || process.env.PROGRAMFILES || 'C:\\Program Files';
    return path.join(pf, 'EasyPackageManager');
  }
  if (isMac()) return path.join(os.homedir(), 'Applications', 'EasyPackageManager');
  return path.join(os.homedir(), '.local', 'share', 'EasyPackageManager');
}

function isExecutable(fileName) {
  return /\.(exe|bat|cmd|com|msi|app|run|bin)$/i.test(fileName);
}

function chmodExec(file) {
  if (isWindows()) return;
  try { fs.chmodSync(file, 0o755); } catch (_) {}
}

function pickAsset(files, pkgName) {
  if (!files || !files.length) return null;
  if (files.length === 1) return files[0];

  const ptokens = platformTokens();
  const atokens = archTokens();

  for (const pt of ptokens) {
    for (const at of atokens) {
      const hit = files.find(function (f) {
        const n = f.name.toLowerCase();
        return n.indexOf(pt) !== -1 && n.indexOf(at) !== -1;
      });
      if (hit) return hit;
    }
  }

  for (const pt of ptokens) {
    const hit = files.find(function (f) { return f.name.toLowerCase().indexOf(pt) !== -1; });
    if (hit) return hit;
  }

  const universal = files.find(function (f) { return /\b(universal|all|noarch|any)\b/i.test(f.name); });
  if (universal) return universal;

  const others = ['win32', 'windows', 'darwin', 'macos', 'linux'];
  const mine = ptokens;
  const notMine = files.filter(function (f) {
    const n = f.name.toLowerCase();
    for (const o of others) {
      if (mine.indexOf(o) === -1 && n.indexOf(o) !== -1) return false;
    }
    return true;
  });
  if (notMine.length) return notMine[0];

  return files[0];
}

module.exports = {
  isWindows: isWindows, isMac: isMac, isLinux: isLinux,
  platformTokens: platformTokens, archTokens: archTokens,
  defaultInstallDir: defaultInstallDir,
  isExecutable: isExecutable, chmodExec: chmodExec,
  pickAsset: pickAsset,
  platform: process.platform, arch: process.arch
};
