'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const platform = require('./platform');

function isInstallerType(fileName) {
  return /\.(exe|msi|dmg|pkg|deb|rpm|appimage|bat|cmd|sh|run)$/i.test(fileName);
}

function isArchiveType(fileName) {
  return /\.(tar\.gz|tgz|tar|zip|gz|7z|rar|xz|bz2)$/i.test(fileName);
}

function unlockFile(filePath) {
  if (process.platform !== 'win32') return;
  try { fs.unlinkSync(filePath + ':Zone.Identifier'); } catch (_) {}
}

function spawnWait(cmd, args, opts) {
  return new Promise(function (resolve, reject) {
    let child;
    try {
      child = spawn(cmd, args || [], Object.assign({
        stdio: 'inherit',
        windowsHide: false
      }, opts || {}));
    } catch (err) { return reject(err); }
    child.on('error', reject);
    child.on('close', function (code) { resolve(code == null ? 0 : code); });
  });
}

async function runInstaller(filePath, fileName, flags) {
  flags = flags || {};
  const lower = (fileName || filePath).toLowerCase();
  const p = platform.platform;
  const abs = path.resolve(filePath);

  if (!fs.existsSync(abs)) throw new Error('File not found: ' + abs);

  unlockFile(abs);

  const cwd = path.dirname(abs);

  if (p === 'win32') {
    if (lower.endsWith('.msi')) return await spawnWait('msiexec', ['/i', abs], { cwd: cwd });
    if (lower.endsWith('.bat') || lower.endsWith('.cmd')) return await spawnWait('cmd', ['/c', abs], { cwd: cwd });
    if (lower.endsWith('.exe')) return await spawnWait('cmd', ['/c', abs], { cwd: cwd });
    return await spawnWait('cmd', ['/c', 'start', '""', '/wait', abs]);
  }

  if (p === 'darwin') {
    if (lower.endsWith('.dmg') || lower.endsWith('.pkg')) return await spawnWait('open', [abs]);
    if (lower.endsWith('.sh') || lower.endsWith('.run')) {
      try { fs.chmodSync(abs, 0o755); } catch (_) {}
      return await spawnWait('bash', [abs]);
    }
    return await spawnWait('open', [abs]);
  }

  if (p === 'linux') {
    if (lower.endsWith('.deb')) {
      try { return await spawnWait('xdg-open', [abs]); } catch (_) {}
      return await spawnWait('dpkg', ['-i', abs]);
    }
    if (lower.endsWith('.rpm')) {
      try { return await spawnWait('xdg-open', [abs]); } catch (_) {}
      return await spawnWait('rpm', ['-i', abs]);
    }
    if (lower.endsWith('.appimage') || lower.endsWith('.sh') || lower.endsWith('.run')) {
      try { fs.chmodSync(abs, 0o755); } catch (_) {}
      return await spawnWait(abs, []);
    }
    return await spawnWait('xdg-open', [abs]);
  }

  try { fs.chmodSync(abs, 0o755); } catch (_) {}
  return await spawnWait(abs, []);
}

function askYesNo(question, defaultYes) {
  return new Promise(function (resolve) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const hint = defaultYes ? ' [Y/n] ' : ' [y/N] ';
    rl.question(question + hint, function (ans) {
      rl.close();
      const a = String(ans || '').trim().toLowerCase();
      if (!a) return resolve(Boolean(defaultYes));
      resolve(a === 'y' || a === 'yes');
    });
  });
}

module.exports = {
  isInstallerType: isInstallerType,
  isArchiveType: isArchiveType,
  runInstaller: runInstaller,
  unlockFile: unlockFile,
  askYesNo: askYesNo
};
