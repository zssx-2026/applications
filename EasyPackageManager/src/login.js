'use strict';

const { spawn } = require('child_process');
const net = require('./net');
const auth = require('./auth');
const i18n = require('./i18n');
const { color, log } = require('./utils');

const SCOPES = 'repo,read:user,user:email';
const APP_NAME = 'EasyPackageManager';

/**
 * 生成 token 创建 URL（预填 scopes + description）
 */
function buildTokenUrl() {
  return 'https://github.com/settings/tokens/new'
    + '?scopes=' + encodeURIComponent(SCOPES)
    + '&description=' + encodeURIComponent(APP_NAME + ' (' + new Date().toISOString().slice(0, 10) + ')');
}

/**
 * 跨平台打开浏览器
 */
function openBrowser(url) {
  return new Promise(function (resolve) {
    let cmd, args;

    if (process.platform === 'win32') {
      cmd = 'cmd';
      args = ['/c', 'start', '""', url];
    } else if (process.platform === 'darwin') {
      cmd = 'open';
      args = [url];
    } else {
      cmd = 'xdg-open';
      args = [url];
    }

    try {
      const child = spawn(cmd, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.on('error', function () { resolve(false); });
      child.unref();
      // 不等进程真正结束，直接返回成功
      resolve(true);
    } catch (_) {
      resolve(false);
    }
  });
}

/**
 * 交互式读取一行
 */
function ask(question) {
  return new Promise(function (resolve) {
    const rl = global.__epm_rl;
    if (rl && rl.question) {
      rl.question(question, function (a) { resolve(String(a || '')); });
      return;
    }
    process.stdout.write(question);
    let buf = '';
    function onData(c) {
      buf += String(c);
      const i = buf.indexOf('\n');
      if (i === -1 && buf.indexOf('\r') === -1) return;
      process.stdin.removeListener('data', onData);
      resolve(buf.split(/[\r\n]/)[0]);
    }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

async function verifyToken(token) {
  const res = await net.httpGetWithRetry('https://api.github.com/user', {
    headers: {
      authorization: 'Bearer ' + token,
      accept: 'application/vnd.github+json'
    }
  });
  if (res.statusCode === 200) {
    try { return JSON.parse(res.body.toString('utf8')); }
    catch (_) { return {}; }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════
 * login —— 自动打开浏览器到 token 创建页
 * ══════════════════════════════════════════════════════════════ */

async function login() {
  const existing = auth.load();
  if (existing && existing.token) {
    log.info(i18n.t('loginAlready') + ': ' + (existing.username || '?'));
    return;
  }

  const url = buildTokenUrl();

  console.log('');
  console.log('  ' + i18n.t('loginHint'));
  console.log('');
  console.log('  ' + color.gray('1. ') + i18n.t('loginStep1'));
  console.log('  ' + color.gray('2. ') + i18n.t('loginStep2'));
  console.log('  ' + color.gray('3. ') + i18n.t('loginStep3'));
  console.log('');
  console.log('  ' + i18n.t('loginUrl') + ':');
  console.log('  ' + color.cyan(url));
  console.log('');

  // 自动打开浏览器
  const opened = await openBrowser(url);
  if (opened) {
    log.info(i18n.t('loginOpened'));
  } else {
    log.warn(i18n.t('loginOpenFailed'));
    console.log('  ' + i18n.t('loginOpenManually'));
  }
  console.log('');

  const token = (await ask(color.cyan(i18n.t('loginToken')) + ': ')).trim();
  if (!token) {
    log.error(i18n.t('loginCancelled'));
    return;
  }

  // 简单格式检查
  if (!/^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)/.test(token)) {
    log.warn(i18n.t('loginTokenFormat'));
  }

  log.step(i18n.t('loginVerifying'));
  const user = await verifyToken(token);
  if (!user) {
    log.error(i18n.t('loginFailed'));
    return;
  }

  auth.save({
    token: token,
    username: user.login,
    email: user.email || '',
    scopes: SCOPES,
    loggedAt: new Date().toISOString()
  });

  log.success(i18n.t('loginOK') + ': ' + color.cyan(user.login));
}

module.exports = { login, ask, verifyToken, buildTokenUrl, openBrowser };
