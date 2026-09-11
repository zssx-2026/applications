#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;
const URL_FILE = path.join(ROOT, 'url.json');
const SETTINGS_FILE = path.join(ROOT, 'settings.json');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function getToken() {
  const settings = readJson(SETTINGS_FILE, {});
  return process.env.GITHUB_TOKEN
    || process.env.GH_TOKEN
    || (settings.github && settings.github.token)
    || '';
}

function request(url, redirect = 0) {
  return new Promise((resolve, reject) => {
    if (redirect > 6) return reject(new Error('重定向次数过多'));
    const u = new URL(url);
    const headers = {
      'user-agent': 'EasyPackageManager/1.0.0',
      'accept': 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28'
    };
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;

    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(request(new URL(res.headers.location, url).toString(), redirect + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('请求超时')));
    req.end();
  });
}

async function fetchReleases(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`;
  const res = await request(url);
  if (res.status === 404) throw new Error('仓库不存在');
  if (res.status === 403) throw new Error('API 限流，请设置 GITHUB_TOKEN');
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.body.toString('utf8'));
}

function normalize(release) {
  const tag = release.tag_name || release.name || 'unknown';
  return {
    id: release.id,
    tag,
    name: release.name || tag,
    prerelease: Boolean(release.prerelease),
    draft: Boolean(release.draft),
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
    tarballUrl: release.tarball_url,
    zipballUrl: release.zipball_url,
    assets: (release.assets || []).map(a => ({
      name: a.name,
      size: a.size,
      url: a.browser_download_url
    }))
  };
}

async function main() {
  const force = process.argv.includes('--force');
  const check = process.argv.includes('--check');
  const urlData = readJson(URL_FILE, {});
  const owner = urlData.source?.owner || 'zssx-2026';
  const repo = urlData.source?.repo || 'applications';

  const settings = readJson(SETTINGS_FILE, {});
  const interval = (settings.update?.intervalHours || 6) * 3600 * 1000;
  const last = urlData.updatedAt ? new Date(urlData.updatedAt).getTime() : 0;

  if (!force && Date.now() - last < interval) {
    console.log('[epm] 使用缓存 url.json，跳过更新');
    return;
  }

  console.log(`[epm] 正在获取 ${owner}/${repo} releases ...`);
  const releases = await fetchReleases(owner, repo);
  const normalized = releases.filter(r => !r.draft).map(normalize);
  const stable = normalized.filter(r => !r.prerelease);
  const latest = stable[0] || normalized[0] || null;

  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    source: {
      owner,
      repo,
      api: `https://api.github.com/repos/${owner}/${repo}/releases`,
      releases: `https://github.com/${owner}/${repo}/releases`,
      latest: `https://github.com/${owner}/${repo}/releases/latest`
    },
    latest,
    releases: normalized.slice(0, 30)
  };

  if (!check) {
    writeJson(URL_FILE, next);
    console.log('[epm] url.json 已更新');
  } else {
    console.log(JSON.stringify({ latest: latest?.tag }, null, 2));
  }
}

main().catch(err => {
  console.error('[epm] 更新失败:', err.message);
  process.exit(1);
});
