'use strict';

const { httpGet } = require('./utils');
const config = require('./config');

function headers() {
  const h = {
    'user-agent': 'EasyPackageManager/1.0.0',
    'accept': 'application/vnd.github+json'
  };
  const token = process.env.GITHUB_TOKEN || config.get('github.token');
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function api(pathOrUrl) {
  const url = /^https?:\/\//.test(pathOrUrl)
    ? pathOrUrl
    : `https://api.github.com${pathOrUrl}`;
  const res = await httpGet(url, 0, headers());
  if (res.status === 404) return null;
  if (res.status >= 400) throw new Error(`GitHub API HTTP ${res.status}`);
  return JSON.parse(res.body.toString('utf8'));
}

const getRepo = (owner, repo) => api(`/repos/${owner}/${repo}`);
const getRelease = (owner, repo, tag) =>
  tag ? api(`/repos/${owner}/${repo}/releases/tags/${tag}`)
      : api(`/repos/${owner}/${repo}/releases/latest`);

module.exports = { headers, api, getRepo, getRelease };
