'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('./config');
const names = require('./names');
const classify = require('./classify');
const auth = require('./auth');

const URL_FILE = path.join(config.ROOT, 'url.json');
const SETTINGS_FILE = path.join(config.ROOT, 'settings.json');
const MAX_PAGES = 100;
const PER_PAGE = 100;

function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d; } }
function writeJson(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n', 'utf8'); }

function getNet() {
  const s = readJson(SETTINGS_FILE, {});
  const n = s.network || {};
  return {
    retries: n.retries == null ? 4 : n.retries,
    retryDelayMs: n.retryDelayMs == null ? 800 : n.retryDelayMs,
    timeoutMs: n.timeoutMs == null ? 30000 : n.timeoutMs
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function requestOnce(url, t) {
  return new Promise(function (resolve, reject) {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('bad url')); }
    const h = {
      'user-agent': 'EasyPackageManager/1.0.0',
      'accept': 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'accept-encoding': 'identity',
      'connection': 'close'
    };
    const token = auth.getToken();
    if (token) h.authorization = 'Bearer ' + token;
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'GET', headers: h
    }, function (res) {
      const c = [];
      res.on('data', x => c.push(x));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(t, () => req.destroy(new Error('Timeout')));
    req.end();
  });
}

async function retry(url, redirect) {
  if (redirect === undefined) redirect = 0;
  const net = getNet();
  let lastErr = null;
  for (let i = 0; i <= net.retries; i++) {
    try {
      const r = await requestOnce(url, net.timeoutMs);
      if ([301,302,303,307,308].indexOf(r.status) >= 0 && r.headers.location) {
        if (redirect > 6) throw new Error('too many redirects');
        return await retry(new URL(r.headers.location, url).toString(), redirect + 1);
      }
      if (r.status >= 500) {
        lastErr = new Error('HTTP ' + r.status);
        if (i < net.retries) { await sleep(net.retryDelayMs * Math.pow(2, i)); continue; }
        throw lastErr;
      }
      return r;
    } catch (e) {
      lastErr = e;
      if (i < net.retries) { await sleep(net.retryDelayMs * Math.pow(2, i)); continue; }
      throw e;
    }
  }
  throw lastErr || new Error('failed');
}

function normalize(r, repo) {
  const tag = r.tag_name || r.name || 'unknown';
  return {
    id: r.id, tag, name: r.name || tag,
    repo: repo || null,
    prerelease: !!r.prerelease, draft: !!r.draft,
    publishedAt: r.published_at, createdAt: r.created_at, htmlUrl: r.html_url,
    assets: (r.assets || []).map(a => ({
      id: a.id, name: a.name, size: a.size,
      contentType: a.content_type,
      downloadCount: a.download_count,
      createdAt: a.created_at, updatedAt: a.updated_at,
      type: classify.classify(a.name),
      url: a.browser_download_url
    }))
  };
}

function nextLink(h) {
  const l = h && (h.link || h.Link);
  if (!l) return null;
  for (const p of String(l).split(',')) {
    const m = p.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

async function fetchRepo(owner, repo) {
  const all = [], seen = new Set();
  let url = 'https://api.github.com/repos/' + owner + '/' + repo + '/releases?per_page=' + PER_PAGE + '&page=1';
  let page = 1;
  while (url && page <= MAX_PAGES) {
    const r = await retry(url);
    if (r.status === 404) return [];
    if (r.status === 403 || r.status === 429) throw new Error('rate limited');
    if (r.status >= 400) throw new Error('HTTP ' + r.status);
    let batch;
    try { batch = JSON.parse(r.body.toString('utf8')); } catch (e) { break; }
    if (!Array.isArray(batch) || !batch.length) break;
    for (const x of batch) {
      const k = String(x.id);
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(normalize(x, owner + '/' + repo));
    }
    const n = nextLink(r.headers);
    if (!n) break;
    url = n; page++;
  }
  return all;
}

async function fetchNameTxt(rel) {
  const a = (rel.assets || []).find(x => /^name\.txt$/i.test(x.name));
  if (!a) return null;
  try {
    const r = await retry(a.url);
    if (r.status >= 400) return null;
    const t = r.body.toString('utf8');
    return t && t.trim() ? t : null;
  } catch (_) { return null; }
}

function hasAppTag(rel) {
  return /application/i.test(String((rel && rel.tag) || '') + ' ' + String((rel && rel.name) || ''));
}

function hasPluginTag(rel) {
  return /plugin/i.test(String((rel && rel.tag) || '') + ' ' + String((rel && rel.name) || ''));
}

/* ═══════════════ 搜索所有含 easypkgmgr topic 的仓库 ═══════════════ */

async function searchEasypkgmgrRepos() {
  const found = new Set();
  try {
    const url = 'https://api.github.com/search/repositories?q=topic:easypkgmgr&per_page=100';
    const r = await retry(url);
    if (r.status === 200) {
      const data = JSON.parse(r.body.toString('utf8'));
      for (const item of (data.items || [])) {
        found.add(item.full_name);
      }
    }
  } catch (_) {}
  return Array.from(found);
}

async function fetchAll() {
  const urlData = readJson(URL_FILE, {});
  const owner = (urlData.source && urlData.source.owner) || 'zssx-2026';
  const mainRepo = owner + '/applications';

  console.log('[epm] ' + mainRepo + ' ...');

  // 1. 主仓库
  const mainReleases = await fetchRepo(owner, 'applications').catch(function (e) {
    console.log('[epm] ' + e.message);
    return [];
  });

  // 2. 搜索含 easypkgmgr topic 的仓库
  console.log('[epm] 搜索 easypkgmgr 仓库...');
  const extraRepos = await searchEasypkgmgrRepos();
  console.log('[epm]   找到 ' + extraRepos.length + ' 个');

  const allReleases = [];

  // 分类处理主仓库的 release
  for (const rel of mainReleases) {
    if (rel.draft) continue;
    if (hasAppTag(rel)) rel.kind = 'app';
    else if (hasPluginTag(rel)) rel.kind = 'plugin';
    else continue;

    const txt = await fetchNameTxt(rel);
    if (txt) {
      rel.nameTxt = { raw: txt, entries: names.parse(txt) };
    }
    allReleases.push(rel);
  }

  // 处理额外仓库
  for (const full of extraRepos) {
    if (full === mainRepo) continue;
    const [o, r] = full.split('/');
    console.log('[epm]   ' + full + ' ...');
    let rels;
    try { rels = await fetchRepo(o, r); }
    catch (e) { console.log('[epm]     ' + e.message); continue; }

    for (const rel of rels) {
      if (rel.draft) continue;
      if (hasAppTag(rel)) rel.kind = 'app';
      else if (hasPluginTag(rel)) rel.kind = 'plugin';
      else continue;

      const txt = await fetchNameTxt(rel);
      if (txt) {
        rel.nameTxt = { raw: txt, entries: names.parse(txt) };
      }
      allReleases.push(rel);
    }
  }

  // 应用列表
  const apps = allReleases.filter(r => r.kind === 'app');
  const plugins = allReleases.filter(r => r.kind === 'plugin');
  console.log('[epm] 应用: ' + apps.length + ' / 插件: ' + plugins.length);

  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    source: {
      owner, repo: 'applications',
      api: 'https://api.github.com/repos/' + owner + '/applications/releases',
      releases: 'https://github.com/' + owner + '/applications/releases'
    },
    releases: allReleases
  };

  writeJson(URL_FILE, next);
  return { releases: allReleases, apps: apps.length, plugins: plugins.length };
}

module.exports = { fetchAll, fetchRepo };
