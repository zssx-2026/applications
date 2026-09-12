'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { ensureDir: ensureDir } = require('./utils');

function getRetries() { return Number(config.get('network.retries')) || 4; }
function getRetryDelay() { return Number(config.get('network.retryDelayMs')) || 800; }
function getTimeout() { return Number(config.get('network.timeoutMs')) || 30000; }

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function authHeaders(extra) {
  const h = Object.assign({
    'user-agent': 'EasyPackageManager/1.0.0',
    'accept': '*/*',
    'accept-encoding': 'identity',
    'connection': 'close'
  }, extra || {});
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || config.get('github.token');
  if (token) h.authorization = 'Bearer ' + token;
  return h;
}

function requestOnce(url, options) {
  options = options || {};
  return new Promise(function (resolve, reject) {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('Invalid URL: ' + url)); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: Object.assign(authHeaders(), options.headers || {})
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(getTimeout(), function () { req.destroy(new Error('Timeout (' + getTimeout() + 'ms)')); });
    req.end();
  });
}

async function httpGetWithRetry(url, options, redirect) {
  options = options || {};
  redirect = redirect || 0;
  if (redirect > 6) throw new Error('Too many redirects: ' + url);

  const retries = getRetries();
  const baseDelay = getRetryDelay();
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await requestOnce(url, options);
      if ([301,302,303,307,308].indexOf(res.statusCode) >= 0 && res.headers.location) {
        return await httpGetWithRetry(new URL(res.headers.location, url).toString(), options, redirect + 1);
      }
      if (res.statusCode >= 500) {
        lastErr = new Error('HTTP ' + res.statusCode + ': ' + url);
        if (attempt < retries) {
          const wait = baseDelay * Math.pow(2, attempt);
          console.log('\u001b[33m!\u001b[0m HTTP ' + res.statusCode + ', retry in ' + wait + 'ms (' + (attempt + 1) + '/' + retries + ')');
          await sleep(wait);
          continue;
        }
        throw lastErr;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const wait = baseDelay * Math.pow(2, attempt);
        console.log('\u001b[33m!\u001b[0m ' + err.message + ', retry in ' + wait + 'ms (' + (attempt + 1) + '/' + retries + ')');
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Request failed');
}

async function downloadWithRetry(url, dest, options) {
  options = options || {};
  const retries = getRetries();
  const baseDelay = getRetryDelay();
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await requestOnce(url, options);
      if (res.statusCode >= 400) {
        if (res.statusCode >= 500 && attempt < retries) {
          lastErr = new Error('HTTP ' + res.statusCode);
          const wait = baseDelay * Math.pow(2, attempt);
          console.log('\u001b[33m!\u001b[0m HTTP ' + res.statusCode + ', retry in ' + wait + 'ms (' + (attempt + 1) + '/' + retries + ')');
          await sleep(wait);
          continue;
        }
        throw new Error('HTTP ' + res.statusCode + ': ' + url);
      }
      ensureDir(path.dirname(dest));
      fs.writeFileSync(dest, res.body);
      return dest;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const wait = baseDelay * Math.pow(2, attempt);
        console.log('\u001b[33m!\u001b[0m ' + err.message + ', retry in ' + wait + 'ms (' + (attempt + 1) + '/' + retries + ')');
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Download failed');
}

module.exports = { authHeaders: authHeaders, httpGetWithRetry: httpGetWithRetry, downloadWithRetry: downloadWithRetry, sleep: sleep };
