'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');
const { ensureDir } = require('./utils');

function pidFile() {
  const dir = config.DATA_DIR || config.get('tempdir');
  try { ensureDir(dir); } catch (_) {}
  return path.join(dir, '.epm.pids.json');
}

function isAlive(pid) {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function readPids() {
  try {
    const data = JSON.parse(fs.readFileSync(pidFile(), 'utf8'));
    if (!Array.isArray(data)) return [];
    return data.filter(function (p) { return typeof p === 'number' && isAlive(p); });
  } catch (_) {
    return [];
  }
}

function writePids(pids) {
  try {
    const f = pidFile();
    if (!pids || !pids.length) {
      try { fs.unlinkSync(f); } catch (_) {}
      return;
    }
    fs.writeFileSync(f, JSON.stringify(pids), 'utf8');
  } catch (_) {}
}

function register() {
  const pid = process.pid;
  const pids = readPids().filter(function (p) { return p !== pid; });
  pids.push(pid);
  writePids(pids);
  return pid;
}

function unregister() {
  const pid = process.pid;
  writePids(readPids().filter(function (p) { return p !== pid; }));
}

function killOne(pid) {
  if (!pid || pid <= 0) return false;
  if (pid === process.pid) return false;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore', timeout: 3000 });
    } else {
      try { process.kill(-pid, 'SIGKILL'); }
      catch (_) { process.kill(pid, 'SIGKILL'); }
    }
    return true;
  } catch (_) {
    return false;
  }
}

function killAll() {
  const pids = readPids();
  const killed = [];
  for (const pid of pids) {
    if (pid === process.pid) continue;
    if (killOne(pid)) killed.push(pid);
  }
  return killed;
}

function exitAll(code) {
  if (typeof code !== 'number') code = 0;
  let killed = [];
  try { killed = killAll(); } catch (_) {}
  writePids([]);
  if (killed.length) {
    let i18n;
    try { i18n = require('./i18n'); } catch (_) {}
    const msg = i18n
      ? i18n.t('exitKilled') + ' ' + killed.length + ' ' + i18n.t('processUnit')
      : 'Terminated ' + killed.length + ' process(es)';
    console.log('\u001b[36mi\u001b[0m ' + msg);
  }
  process.exit(code);
}

module.exports = {
  register: register,
  unregister: unregister,
  killAll: killAll,
  killOne: killOne,
  exitAll: exitAll,
  isAlive: isAlive,
  pidFile: pidFile
};
