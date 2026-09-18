'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { ensureDir: ensureDir } = require('./utils');

function t(key, fallback) {
  try { return require('./i18n').t(key); } catch (_) { return fallback || key; }
}

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
    req.setTimeout(getTimeout(), function () { req.destroy(new Error('Timeout')); });
    req.end();
  });
}

function retryLog(msg, attempt, total) {
  console.log('\u001b[33m!\u001b[0m ' + msg + ' (' + (attempt + 1) + '/' + total + ')');
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
          retryLog(t('logRetryHttp') + ' HTTP ' + res.statusCode, attempt, retries);
          await sleep(baseDelay * Math.pow(2, attempt)); continue;
        }
        throw lastErr;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        retryLog(t('logRetryErr') + ' ' + err.message, attempt, retries);
        await sleep(baseDelay * Math.pow(2, attempt)); continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Request failed');
}

/* ══════════════════════════════════════════════ 下载（不直接输出进度） */

function downloadOnce(url, dest, redirect, options) {
  if (redirect === undefined) redirect = 0;
  options = options || {};

  return new Promise(function (resolve, reject) {
    if (redirect > 6) return reject(new Error('Too many redirects: ' + url));
    if (options.task && options.task.aborted) {
      return reject(new Error('Aborted: ' + url));
    }

    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('Invalid URL: ' + url)); }

    const lib = u.protocol === 'http:' ? http : https;
    let currentReq = null;

    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'GET',
      headers: Object.assign(authHeaders(), options.headers || {})
    }, function (res) {
      if ([301,302,303,307,308].indexOf(res.statusCode) >= 0 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(downloadOnce(next, dest, redirect + 1, options));
      }
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ': ' + url));
      }

      ensureDir(path.dirname(dest));
      const ws = fs.createWriteStream(dest);

      const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
      let bytes = 0;

      // 只更新 task，不直接输出
      if (options.task) {
        options.task.total = total;
        options.task.bytes = 0;
      }

      res.on('data', function (c) {
        bytes += c.length;
        if (options.task) options.task.bytes = bytes;
      });

      res.pipe(ws);

      ws.on('finish', function () {
        if (bytes === 0) return reject(new Error('Downloaded 0 bytes: ' + url));
        if (options.task) {
          options.task.total = total || bytes;
          options.task.bytes = bytes;
        }
        resolve(dest);
      });
      ws.on('error', reject);
      res.on('error', reject);
    });

    currentReq = req;

    if (options.task) {
      options.task.abortFn = function () {
        try { if (currentReq) currentReq.destroy(new Error('Aborted')); } catch (_) {}
      };
    }

    req.on('error', reject);
    req.setTimeout(600000, function () { req.destroy(new Error('Timeout')); });
    req.end();
  });
}

async function downloadWithRetry(url, dest, options) {
  options = options || {};
  const retries = getRetries();
  const baseDelay = getRetryDelay();
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await downloadOnce(url, dest, 0, options);
    } catch (err) {
      lastErr = err;
      try { fs.unlinkSync(dest); } catch (_) {}
      if (err && /Aborted/.test(err.message)) throw err;
      if (attempt < retries) {
        retryLog(t('logRetryErr') + ' ' + err.message, attempt, retries);
        await sleep(baseDelay * Math.pow(2, attempt)); continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Download failed');
}

module.exports = {
  authHeaders: authHeaders,
  httpGetWithRetry: httpGetWithRetry,
  downloadWithRetry: downloadWithRetry,
  sleep: sleep
};
