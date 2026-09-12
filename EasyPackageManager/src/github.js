'use strict';

const net = require('./net');
const config = require('./config');

async function api(pathOrUrl) {
  const base = config.get('github.apiBase') || 'https://api.github.com';
  const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : base + pathOrUrl;
  const res = await net.httpGetWithRetry(url, {
    headers: { 'accept': 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
  });
  if (res.statusCode === 404) return null;
  if (res.statusCode === 401) throw new Error('GitHub auth failed');
  if (res.statusCode === 403 || res.statusCode === 429) throw new Error('GitHub API rate limited');
  if (res.statusCode >= 400) throw new Error('GitHub API HTTP ' + res.statusCode);
  return JSON.parse(res.body.toString('utf8'));
}

module.exports = {
  api: api,
  getRepo: function (o, r) { return api('/repos/' + o + '/' + r); },
  getRelease: function (o, r, tag) {
    return tag ? api('/repos/' + o + '/' + r + '/releases/tags/' + encodeURIComponent(tag))
               : api('/repos/' + o + '/' + r + '/releases/latest');
  }
};
