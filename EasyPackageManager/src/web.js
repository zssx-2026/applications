'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const sources = require('./sources');
const registry = require('./registry');
const i18n = require('./i18n');
const versionLib = require('./version');
const platform = require('./platform');
const { color } = require('./utils');

let server = null;
let currentPort = null;

function sendJson(res, code, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*'
  });
  res.end(body);
}

function sendHtml(res, code, html) {
  res.writeHead(code, {
    'content-type': 'text/html; charset=utf-8'
  });
  res.end(html);
}

function sendText(res, code, text) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function indexHtml() {
  const st = sources.stats();
  const t = i18n.t;
  return [
    '<!doctype html>',
    '<html lang="' + (i18n.current() === 'cn' ? 'zh-CN' : 'en') + '">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>EasyPackageManager</title>',
    '<style>',
    'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:24px;background:#f6f8fa;color:#24292f}',
    'h1{margin:0 0 8px;font-size:20px}',
    '.sub{color:#57606a;margin-bottom:24px}',
    '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}',
    '.card{background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:16px}',
    '.card h3{margin:0 0 8px;font-size:12px;color:#57606a;text-transform:uppercase;letter-spacing:.5px}',
    '.card .v{font-size:24px;font-weight:600}',
    '.links{background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:16px}',
    '.links a{display:block;padding:8px 0;color:#0969da;text-decoration:none;border-bottom:1px solid #eaeef2}',
    '.links a:last-child{border-bottom:0}',
    '.links a:hover{color:#0550ae}',
    'code{background:#eaeef2;padding:2px 6px;border-radius:4px;font-size:13px}',
    '</style>',
    '</head>',
    '<body>',
    '<h1>EasyPackageManager</h1>',
    '<div class="sub">v' + versionLib.getPkgVersion() + '  ·  ' + platform.platform + '/' + platform.arch + '  ·  ' + i18n.current() + '</div>',
    '<div class="grid">',
    '<div class="card"><h3>' + htmlEscape(t('availablePkgs')) + '</h3><div class="v">' + st.pkgCount + '</div></div>',
    '<div class="card"><h3>' + htmlEscape(t('listReleaseUnit')) + '</h3><div class="v">' + st.releaseCount + '</div></div>',
    '<div class="card"><h3>' + htmlEscape(t('listFileUnit')) + '</h3><div class="v">' + st.fileCount + '</div></div>',
    '<div class="card"><h3>' + htmlEscape(t('installedPkgs')) + '</h3><div class="v">' + registry.list().length + '</div></div>',
    '</div>',
    '<div class="links">',
    '<a href="/api/version">GET /api/version</a>',
    '<a href="/api/packages">GET /api/packages</a>',
    '<a href="/api/installed">GET /api/installed</a>',
    '<a href="/api/search?q=free">GET /api/search?q=...</a>',
    '<a href="/api/lang">GET /api/lang</a>',
    '</div>',
    '<p style="margin-top:24px;color:#57606a;font-size:13px">' + htmlEscape(t('webApiHint')) + '</p>',
    '</body>',
    '</html>'
  ].join('\n');
}

function handle(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const q = u.searchParams;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*' });
    res.end();
    return;
  }

  if (p === '/' || p === '/index.html') {
    return sendHtml(res, 200, indexHtml());
  }

  if (p === '/api/version') {
    const pkgVer = versionLib.getPkgVersion();
    const state = versionLib.loadState();
    return sendJson(res, 200, {
      epm: pkgVer,
      platform: platform.platform,
      arch: platform.arch,
      lang: i18n.current(),
      installed: registry.list(),
      packages: Object.keys(state.packages || {})
    });
  }

  if (p === '/api/packages') {
    const list = sources.listPackages();
    const st = sources.stats();
    return sendJson(res, 200, {
      count: list.length,
      stats: st,
      packages: list.map(function (p) {
        return {
          name: p.name,
          type: p.type,
          company: p.company,
          latest: p.latest ? {
            version: p.latest.version,
            fileName: p.latest.fileName,
            size: p.latest.size,
            url: p.latest.url
          } : null,
          versions: p.versions.map(function (v) {
            return {
              version: v.version,
              fileName: v.fileName,
              size: v.size,
              url: v.url,
              publishedAt: v.publishedAt
            };
          })
        };
      })
    });
  }

  if (p === '/api/installed') {
    const list = registry.list();
    return sendJson(res, 200, {
      count: list.length,
      packages: list
    });
  }

  if (p === '/api/search') {
    const q2 = q.get('q') || '';
    const t = q.get('t') || null;
    const i = q.get('i') || null;
    const hits = sources.search({
      text: q2,
      type: t,
      company: i,
      allVersions: q.get('av') === '1'
    });
    return sendJson(res, 200, {
      query: q2,
      count: hits.length,
      packages: hits.map(function (p) {
        return {
          name: p.name,
          type: p.type,
          company: p.company,
          versions: p.versions.map(function (v) {
            return {
              version: v.version,
              fileName: v.fileName,
              size: v.size,
              url: v.url
            };
          })
        };
      })
    });
  }

  if (p === '/api/lang') {
    const list = i18n.listLangs();
    return sendJson(res, 200, {
      current: i18n.current(),
      available: list
    });
  }

  sendJson(res, 404, { error: 'not found', path: p });
}

function start(opts) {
  opts = opts || {};
  if (server) {
    return Promise.resolve({
      ok: false,
      error: 'alreadyRunning',
      port: currentPort
    });
  }

  const port = parseInt(opts.port || 3800, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return Promise.resolve({ ok: false, error: 'invalidPort', port: opts.port });
  }

  return new Promise(function (resolve) {
    const s = http.createServer(handle);

    s.on('error', function (err) {
      server = null;
      currentPort = null;
      resolve({ ok: false, error: err.code || 'listenError', message: err.message });
    });

    s.listen(port, function () {
      server = s;
      currentPort = port;
      resolve({ ok: true, port: port });
    });
  });
}

function stop() {
  return new Promise(function (resolve) {
    if (!server) return resolve({ ok: false, error: 'notRunning' });
    const s = server;
    server = null;
    currentPort = null;
    s.close(function () {
      resolve({ ok: true });
    });
  });
}

function status() {
  return { running: !!server, port: currentPort };
}

module.exports = {
  start: start,
  stop: stop,
  status: status
};
