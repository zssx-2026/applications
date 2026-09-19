'use strict';

const net = require('./net');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const auth = require('./auth');
const i18n = require('./i18n');
const versionLib = require('./version');
const { color, log, formatBytes } = require('./utils');

/**
 * 从 applications 仓库拉所有 tag 匹配 vX.Y.Z 的 release
 */
async function fetchSelfReleases() {
  const headers = {
    'accept': 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'EasyPackageManager/1.0.0'
  };
  const token = auth.getToken();
  if (token) headers.authorization = 'Bearer ' + token;

  const url = 'https://api.github.com/repos/zssx-2026/applications/releases?per_page=100';
  const res = await net.httpGetWithRetry(url, { headers: headers });
  if (res.statusCode === 404) throw new Error('repo not found');
  if (res.statusCode >= 400) throw new Error('HTTP ' + res.statusCode);

  let arr;
  try { arr = JSON.parse(res.body.toString('utf8')); }
  catch (e) { throw new Error('parse error'); }
  if (!Array.isArray(arr)) return [];

  const out = [];
  for (const r of arr) {
    if (r.draft) continue;
    const tag = r.tag_name || '';
    if (!/^v\d+\.\d+(\.\d+)?$/i.test(tag)) continue;
    out.push({
      tag: tag,
      version: tag.replace(/^v/i, ''),
      name: r.name || tag,
      htmlUrl: r.html_url,
      publishedAt: r.published_at,
      body: (r.body || '').slice(0, 500),
      assets: (r.assets || []).map(function (a) {
        return {
          name: a.name,
          size: a.size,
          url: a.browser_download_url
        };
      })
    });
  }
  out.sort(function (a, b) { return versionLib.compareVer(a.version, b.version); });
  return out;
}

/**
 * EPM 自身更新检查
 */
async function updateSelf(flags) {
  flags = flags || {};
  const current = versionLib.getPkgVersion();

  log.step(i18n.t('selfUpdateFetching'));

  let rels;
  try { rels = await fetchSelfReleases(); }
  catch (e) { log.error(i18n.t('fetchPkgsFail') + ': ' + e.message); return; }

  if (!rels.length) {
    log.info(i18n.t('selfUpdateNone'));
    console.log('  ' + i18n.t('selfUpdateCurrent') + ': v' + current);
    return;
  }

  const latest = rels[rels.length - 1];
  const latestVer = latest.version;

  console.log('  ' + i18n.t('selfUpdateCurrent') + ': ' + color.cyan('v' + current));
  console.log('  ' + i18n.t('selfUpdateLatest') + ':  ' + color.cyan('v' + latestVer));

  if (versionLib.compareVer(latestVer, current) <= 0) {
    console.log('');
    log.success(i18n.t('selfUpdateUpToDate'));
    return;
  }

  console.log('');
  log.warn(i18n.t('selfUpdateFound'));

  if (latest.publishedAt) {
    console.log('  ' + color.gray(latest.publishedAt));
  }
  if (latest.htmlUrl) {
    console.log('  ' + color.gray(latest.htmlUrl));
  }

  if (latest.assets && latest.assets.length) {
    console.log('');
    console.log('  ' + i18n.t('selfUpdateAssets') + ':');
    for (const a of latest.assets) {
      console.log('    - ' + a.name + '  ' + color.gray('(' + formatBytes(a.size) + ')'));
    }
  }

  console.log('');

  if (flags.check) {
    log.info(i18n.t('selfUpdateCheckOnly'));
    return;
  }

  // 找安装包
  const setup = (latest.assets || []).find(function (a) {
    return /\.(exe|msi)$/i.test(a.name) && /setup|installer/i.test(a.name);
  }) || (latest.assets || []).find(function (a) {
    return /\.exe$/i.test(a.name);
  });

  if (!setup) {
    log.warn(i18n.t('selfUpdateNoInstaller'));
    console.log('  ' + color.gray(latest.htmlUrl));
    return;
  }

  // 下载到临时目录
  const tmpdir = config.get('tempdir');
  fs.mkdirSync(tmpdir, { recursive: true });
  const dest = path.join(tmpdir, setup.name);

  log.step(i18n.t('selfUpdateDownloading') + ' ' + setup.name);
  try {
    await net.downloadWithRetry(setup.url, dest, {});
  } catch (e) {
    log.error(i18n.t('selfUpdateDownloadFailed') + ': ' + e.message);
    return;
  }

  log.success(i18n.t('selfUpdateDownloaded') + ': ' + dest);
  console.log('');
  log.info(i18n.t('selfUpdateRunHint') + ':');
  console.log('  ' + color.cyan(dest));
}

module.exports = { updateSelf: updateSelf, fetchSelfReleases: fetchSelfReleases };
