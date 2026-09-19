'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const net = require('./net');
const auth = require('./auth');
const i18n = require('./i18n');
const config = require('./config');
const { log, color, formatBytes } = require('./utils');

const TAG = 'easypkgmgr';

function hdr() {
  const t = auth.getToken();
  if (!t) throw new Error(i18n.t('releaseNoAuth'));
  return {
    authorization: 'Bearer ' + t,
    accept: 'application/vnd.github+json',
    'user-agent': 'EasyPackageManager/1.0.0'
  };
}

function api(method, url, body) {
  return new Promise(function (resolve, reject) {
    const u = new URL(url);
    const h = Object.assign(hdr(), { 'content-type': 'application/json' });
    const d = body ? Buffer.from(JSON.stringify(body)) : null;
    if (d) h['content-length'] = d.length;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: method,
      headers: h
    }, function (r) {
      const c = [];
      r.on('data', function (x) { c.push(x); });
      r.on('end', function () { resolve({ status: r.statusCode, body: Buffer.concat(c) }); });
    });
    req.on('error', reject);
    if (d) req.write(d);
    req.end();
  });
}

function upload(user, rid, fp, fn) {
  return new Promise(function (resolve, reject) {
    const t = auth.getToken();
    const buf = fs.readFileSync(fp);
    const req = https.request({
      hostname: 'uploads.github.com',
      path: '/repos/' + user + '/' + TAG + '/releases/' + rid + '/assets?name=' + encodeURIComponent(fn),
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + t,
        'content-type': 'application/octet-stream',
        'content-length': buf.length,
        'user-agent': 'EasyPackageManager/1.0.0'
      }
    }, function (r) {
      const c = [];
      r.on('data', function (x) { c.push(x); });
      r.on('end', function () { resolve({ status: r.statusCode, body: Buffer.concat(c) }); });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

async function ensureRepo(user) {
  const r = await api('GET', 'https://api.github.com/repos/' + user + '/' + TAG);
  if (r.status === 200) return;
  log.step(i18n.t('releaseCreatingRepo'));
  const c = await api('POST', 'https://api.github.com/user/repos', {
    name: TAG,
    description: 'EasyPackageManager apps',
    private: false,
    auto_init: true
  });
  if (c.status >= 400) throw new Error('create repo failed: ' + c.status);
}

async function release(args) {
  // ═══════════════════════════════════════════════════════════════
  // 第一步：必须登录
  // ═══════════════════════════════════════════════════════════════
  const a = auth.load();
  if (!a || !a.token) {
    console.log('');
    log.error(i18n.t('releaseNoAuth'));
    console.log('');
    console.log('  ' + i18n.t('releaseLoginFirst'));
    console.log('  ' + color.cyan('epm login'));
    console.log('');
    return { ok: false, reason: 'no-auth' };
  }

  // 第二步：检查参数
  const p = args.flags;
  const meta = args._;

  const appname  = p.appname || meta[1];
  const filePath = p.path || meta[2];
  const version  = p.version || meta[3];
  const apptype  = (p.apptype || meta[4] || 'setup').toLowerCase();
  const company  = p.company || meta[5] || 'null';

  if (!appname || !filePath || !version || !apptype) {
    console.log(i18n.t('releaseUsage'));
    console.log('  epm release appname=<name> path=<file> version=<v1.0.0> apptype=<setup|port> company=<name>');
    return { ok: false, reason: 'usage' };
  }

  if (apptype !== 'setup' && apptype !== 'port') {
    log.error(i18n.t('releaseBadType'));
    return { ok: false, reason: 'bad-type' };
  }

  const full = path.resolve(filePath);
  if (!fs.existsSync(full)) {
    log.error(i18n.t('pathNotExist') + ': ' + full);
    return { ok: false, reason: 'file-not-found' };
  }

  const user = a.username;
  log.info(i18n.t('releaseLoggedAs') + ': ' + color.cyan(user));

  log.step(i18n.t('releaseEnsureRepo'));
  try { await ensureRepo(user); }
  catch (e) { log.error(e.message); return { ok: false, reason: 'repo' }; }

  const ver = version.replace(/^v/i, '');
  const fn = path.basename(full);

  log.step(i18n.t('releaseCreatingRelease') + ' v' + ver);
  const r = await api('POST', 'https://api.github.com/repos/' + user + '/' + TAG + '/releases', {
    tag_name: 'v' + ver,
    name: 'v' + ver,
    body: 'release v' + ver
  });
  if (r.status >= 400) {
    log.error('create release failed: ' + r.status);
    log.error(r.body.toString('utf8'));
    return { ok: false, reason: 'create-release' };
  }
  const rel = JSON.parse(r.body.toString('utf8'));

  log.step(i18n.t('releaseUploading') + ' ' + fn + ' (' + formatBytes(fs.statSync(full).size) + ')');
  const up = await upload(user, rel.id, full, fn);
  if (up.status >= 400) {
    log.error('upload failed: ' + up.status);
    log.error(up.body.toString('utf8'));
    return { ok: false, reason: 'upload' };
  }

  // name.txt
  let txt = '';
  try {
    const dl = await net.httpGetWithRetry(
      'https://raw.githubusercontent.com/' + user + '/' + TAG + '/v' + ver + '/name.txt'
    );
    if (dl.statusCode === 200) txt = dl.body.toString('utf8');
  } catch (_) {}

  txt += fn + ' v' + ver + ' ' + appname + ' ' + apptype + ' ' + company + '\n';

  const tmp = path.join(config.get('tempdir'), 'name.txt');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, txt, 'utf8');

  log.step(i18n.t('releaseUploading') + ' name.txt');
  const up2 = await upload(user, rel.id, tmp, 'name.txt');
  if (up2.status >= 400) log.warn('name.txt upload failed');

  log.success(i18n.t('releaseOK'));
  console.log('  ' + color.cyan('https://github.com/' + user + '/' + TAG + '/releases/tag/v' + ver));

  return { ok: true, version: ver, user: user };
}

module.exports = { release };
