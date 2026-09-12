'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('./config');
const names = require('./names');
const classify = require('./classify');

const URL_FILE = path.join(config.ROOT, 'url.json');
const SETTINGS_FILE = path.join(config.ROOT, 'settings.json');
const MAX_PAGES = 100;
const PER_PAGE = 100;

function t(key, fallback) {
  try { return require('./i18n').t(key); } catch (_) { return fallback || key; }
}

function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d; } }
function writeJson(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n', 'utf8'); }

function getToken() {
  const s = readJson(SETTINGS_FILE, {});
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || (s.github && s.github.token) || '';
}

function getNet() {
  const s = readJson(SETTINGS_FILE, {});
  const n = s.network || {};
  return {
    retries: n.retries == null ? 4 : n.retries,
    retryDelayMs: n.retryDelayMs == null ? 800 : n.retryDelayMs,
    timeoutMs: n.timeoutMs == null ? 30000 : n.timeoutMs
  };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function requestOnce(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('Invalid URL: ' + url)); }
    const headers = {
      'user-agent': 'EasyPackageManager/1.0.0',
      'accept': 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'accept-encoding': 'identity',
      'connection': 'close'
    };
    const token = getToken();
    if (token) headers.authorization = 'Bearer ' + token;
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'GET', headers: headers
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }); });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, function () { req.destroy(new Error('Timeout')); });
    req.end();
  });
}

async function requestWithRetry(url, redirect) {
  if (redirect === undefined) redirect = 0;
  const net = getNet();
  let lastErr = null;
  for (let attempt = 0; attempt <= net.retries; attempt++) {
    try {
      const res = await requestOnce(url, net.timeoutMs);
      if ([301,302,303,307,308].indexOf(res.status) >= 0 && res.headers.location) {
        if (redirect > 6) throw new Error('Too many redirects');
        return await requestWithRetry(new URL(res.headers.location, url).toString(), redirect + 1);
      }
      if (res.status >= 500) {
        lastErr = new Error('HTTP ' + res.status);
        if (attempt < net.retries) {
          await sleep(net.retryDelayMs * Math.pow(2, attempt)); continue;
        }
        throw lastErr;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < net.retries) {
        await sleep(net.retryDelayMs * Math.pow(2, attempt)); continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Request failed');
}

function normalize(r) {
  const tag = r.tag_name || r.name || 'unknown';
  return {
    id: r.id, tag: tag, name: r.name || tag,
    prerelease: Boolean(r.prerelease), draft: Boolean(r.draft),
    publishedAt: r.published_at, createdAt: r.created_at, htmlUrl: r.html_url,
    assets: (r.assets || []).map(function (a) {
      return {
        id: a.id, name: a.name, size: a.size,
        contentType: a.content_type,
        downloadCount: a.download_count,
        createdAt: a.created_at, updatedAt: a.updated_at,
        type: classify.classify(a.name),
        url: a.browser_download_url
      };
    })
  };
}

function parseNextLink(headers) {
  const link = headers && (headers.link || headers.Link);
  if (!link) return null;
  for (const p of String(link).split(',')) {
    const m = p.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

async function fetchAllReleases(owner, repo) {
  const all = [];
  const seen = new Set();
  let url = 'https://api.github.com/repos/' + owner + '/' + repo + '/releases?per_page=' + PER_PAGE + '&page=1';
  let page = 1;
  while (url && page <= MAX_PAGES) {
    console.log(t('logFetchingPage') + ' ' + page + ' ...');
    const res = await requestWithRetry(url);
    if (res.status === 404) throw new Error(t('errRepoNotFound') + ': ' + owner + '/' + repo);
    if (res.status === 403 || res.status === 429) throw new Error(t('errApiRateLimit'));
    if (res.status >= 400) throw new Error('HTTP ' + res.status);
    let batch;
    try { batch = JSON.parse(res.body.toString('utf8')); }
    catch (e) { throw new Error(t('errParseResponse') + ': ' + e.message); }
    if (!Array.isArray(batch) || !batch.length) break;
    for (const r of batch) {
      const key = String(r.id);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(normalize(r));
    }
    const next = parseNextLink(res.headers);
    if (!next) break;
    url = next; page++;
  }
  return all;
}

async function fetchNameTxt(rel) {
  const asset = (rel.assets || []).find(function (a) {
    return /^name\.txt$/i.test(a.name);
  });
  if (!asset) return null;
  try {
    const res = await requestWithRetry(asset.url);
    if (res.status >= 400) return null;
    const txt = res.body.toString('utf8');
    if (!txt || !txt.trim()) return null;
    return txt;
  } catch (_) {
    return null;
  }
}

function isApplicationTag(tag) {
  return /application/i.test(String(tag || ''));
}

async function fetchAll(options) {
  options = options || {};
  const urlData = readJson(URL_FILE, {});
  const owner = (urlData.source && urlData.source.owner) || 'zssx-2026';
  const repo = (urlData.source && urlData.source.repo) || 'applications';

  if (options.offline) {
    const releases = urlData.releases || [];
    return { offline: true, releases: releases, fileCount: 0 };
  }

  const all = await fetchAllReleases(owner, repo);
  const visible = all.filter(function (r) { return !r.draft; });
  const apps = visible.filter(function (r) { return isApplicationTag(r.tag); });

  console.log(t('logReleasesWithTag') + ' ' + apps.length);

  for (const rel of apps) {
    const txt = await fetchNameTxt(rel);
    if (txt) {
      rel.nameTxt = { raw: txt, entries: names.parse(txt) };
      console.log(t('logNameTxt') + ' ' + rel.tag + ': ' + rel.nameTxt.entries.length + ' ' + t('logEntries'));
    } else {
      console.log(t('logNameTxtMissing') + ' ' + rel.tag);
    }
  }

  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    source: {
      owner: owner, repo: repo,
      api: 'https://api.github.com/repos/' + owner + '/' + repo + '/releases',
      releases: 'https://github.com/' + owner + '/' + repo + '/releases'
    },
    releases: apps
  };

  writeJson(URL_FILE, next);
  return { releases: apps, fileCount: apps.length };
}

module.exports = { fetchAll: fetchAll, fetchAllReleases: fetchAllReleases };
