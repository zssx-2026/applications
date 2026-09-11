'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DOWNLOAD_TEMP = path.join(ROOT, '.download_temp');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmrf(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function httpGet(url, redirect = 0) {
  return new Promise((resolve, reject) => {
    if (redirect > 6) return reject(new Error('重定向次数过多'));
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(url, {
      headers: { 'user-agent': 'EasyPackageManager/1.0.0' }
    }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(httpGet(new URL(res.headers.location, url).toString(), redirect + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(180000, () => req.destroy(new Error('请求超时')));
  });
}

async function download(url, dest) {
  const res = await httpGet(url);
  if (res.status >= 400) throw new Error(`下载失败 HTTP ${res.status}`);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, res.body);
  return dest;
}

const color = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  blue: s => `\x1b[34m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  gray: s => `\x1b[90m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`
};

const log = {
  info: m => console.log(`${color.cyan('i')} ${m}`),
  success: m => console.log(`${color.green('+')} ${m}`),
  warn: m => console.log(`${color.yellow('!')} ${m}`),
  error: m => console.error(`${color.red('x')} ${m}`),
  step: m => console.log(`${color.blue('>')} ${m}`)
};

module.exports = {
  ROOT, DOWNLOAD_TEMP,
  ensureDir, rmrf, readJson, writeJson,
  httpGet, download,
  color, log
};
