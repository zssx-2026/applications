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

/**
 * 询问 y/n
 * - 若在交互式 CLI 中（global.__epm_rl 存在），复用外层的 readline
 * - 否则（命令行直接运行）用 stdin.once('data')
 * 绝不创建新的 readline，避免把外层 readline 关闭
 */
function askYesNo(question, defaultYes) {
  return new Promise(function (resolve) {
    const hint = defaultYes ? ' [Y/n] ' : ' [y/N] ';
    const text = question + hint;

    // 交互式 CLI：用外层 readline
    if (global.__epm_rl && global.__epm_rl.question) {
      global.__epm_rl.question(text, function (ans) {
        const a = String(ans || '').trim().toLowerCase();
        if (!a) return resolve(Boolean(defaultYes));
        resolve(a === 'y' || a === 'yes');
      });
      return;
    }

    // 命令行模式：监听 stdin 一次
    process.stdout.write(text);

    let buf = '';
    let done = false;

    function onData(chunk) {
      if (done) return;
      buf += String(chunk);
      const idx = buf.indexOf('\n');
      if (idx === -1 && buf.indexOf('\r') === -1) return;

      done = true;
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);

      const line = buf.split(/[\r\n]/)[0].trim().toLowerCase();
      if (!line) return resolve(Boolean(defaultYes));
      resolve(line === 'y' || line === 'yes');
    }

    function onEnd() {
      if (done) return;
      done = true;
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      resolve(Boolean(defaultYes));
    }

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.resume();
  });
}

module.exports = {
  isInstallerType: isInstallerType,
  isArchiveType: isArchiveType,
  runInstaller: runInstaller,
  unlockFile: unlockFile,
  askYesNo: askYesNo
};
