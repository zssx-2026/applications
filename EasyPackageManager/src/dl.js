'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, execSync } = require('child_process');

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ═══════════════════ 格式化 ═══════════════════ */

function humanSpeed(bps) {
  if (!isFinite(bps) || bps <= 0) return '0B/s';
  if (bps >= 1073741824) return (bps / 1073741824).toFixed(2) + 'GB/s';
  if (bps >= 1048576) return (bps / 1048576).toFixed(2) + 'MB/s';
  if (bps >= 1024) return (bps / 1024).toFixed(2) + 'KB/s';
  return bps.toFixed(0) + 'B/s';
}

function humanSize(n) {
  if (n == null || n === 0) return '0B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(n), i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v.toFixed(0) : v.toFixed(v < 10 ? 1 : 0)) + u[i];
}

function humanEta(sec) {
  if (!isFinite(sec) || sec < 0 || sec > 604800) return '--:--';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  return m + ':' + String(ss).padStart(2, '0');
}

/* ═══════════════════ 进度条 ═══════════════════ */

function createBar() {
  if (global.__epm_shell) return null;
  if (!process.stdout.isTTY) return null;
  let startedAt = 0;
  let lastDraw = 0;
  const window = [];
  const WINDOW_MS = 3000;

  function draw(recv, total) {
    const now = Date.now();
    if (now - lastDraw < 80) return;
    lastDraw = now;

    window.push({ t: now, b: recv });
    while (window.length && now - window[0].t > WINDOW_MS) window.shift();

    let speed = 0;
    if (window.length >= 2) {
      const first = window[0], last = window[window.length - 1];
      const dt = (last.t - first.t) / 1000;
      if (dt > 0) speed = (last.b - first.b) / dt;
    } else if (startedAt > 0) {
      const dt = (now - startedAt) / 1000;
      if (dt > 0) speed = recv / dt;
    }

    const pct = total > 0 ? Math.min(recv / total, 1) : 0;
    const eta = (total > 0 && speed > 0 && recv < total) ? (total - recv) / speed : 0;

    const cols = process.stdout.columns || 80;
    const head = humanSpeed(speed) + '  Total:' + humanSize(total) + '  ETA:' + humanEta(eta) + '  ' +
                 Math.floor(pct * 100) + '%  ';
    const barW = Math.max(10, cols - head.length - 4);
    const filled = Math.round(barW * pct);
    const bar = '█'.repeat(filled);

    // 有输入行时，进度条写在输入行上方
    if (global.__epm_rl) {
      // 保存光标 -> 上移一行 -> 清行 -> 写 -> 下移回来 -> 恢复光标
      process.stdout.write('\x1b7' + '\x1b[A' + '\r\x1b[K' +
        head + '\u001b[32m' + bar + '\u001b[0m' + '\x1b[B' + '\x1b8');
    } else {
      process.stdout.write('\r\x1b[K' + head + '\u001b[32m' + bar + '\u001b[0m');
    }
  }

  return {
    start: function () { startedAt = Date.now(); },
    update: draw,
    done: function (recv, total) { draw(recv, total); process.stdout.write('\n'); },
    abort: function () { process.stdout.write('\r\x1b[K'); }
  };
}

/* ═══════════════════ HEAD 请求 ═══════════════════ */

function requestHead(url, redirect) {
  if (redirect === undefined) redirect = 0;
  return new Promise(function (resolve, reject) {
    if (redirect > 6) return reject(new Error('Too many redirects'));
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'HEAD',
      headers: { 'user-agent': 'EasyPackageManager/1.0.0', 'accept': '*/*' }
    }, function (res) {
      if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0 && res.headers.location) {
        res.resume();
        return resolve(requestHead(new URL(res.headers.location, url).toString(), redirect + 1));
      }
      resolve({
        status: res.statusCode,
        size: parseInt(res.headers['content-length'] || '0', 10) || 0,
        acceptRanges: String(res.headers['accept-ranges'] || '').toLowerCase() === 'bytes'
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, function () { req.destroy(new Error('HEAD timeout')); });
    req.end();
  });
}

/* ═══════════════════ 定位 aria2c.exe ═══════════════════ */

function findAria2c() {
  // 1. exe 同目录
  const exeDir = path.dirname(process.execPath);
  const p1 = path.join(exeDir, 'aria2c.exe');
  if (fs.existsSync(p1)) return p1;

  // 2. config.ROOT 的 bin/
  try {
    const config = require('./config');
    const p2 = path.join(config.ROOT, 'aria2c.exe');
    if (fs.existsSync(p2)) return p2;
    const p3 = path.join(config.ROOT, 'bin', 'aria2c.exe');
    if (fs.existsSync(p3)) return p3;
  } catch (_) {}

  // 3. 项目根 bin/
  const p4 = path.resolve(__dirname, '..', 'bin', 'aria2c.exe');
  if (fs.existsSync(p4)) return p4;

  // 4. PATH
  try {
    const out = execSync('where aria2c.exe', { encoding: 'utf8', windowsHide: true, timeout: 2000 });
    const first = out.split(/\r?\n/)[0].trim();
    if (first && fs.existsSync(first)) return first;
  } catch (_) {}

  return null;
}

/* ═══════════════════ aria2c 下载 ═══════════════════ */

async function downloadViaAria2(aria2Path, url, dest, task, bar, threads) {
  const dir = path.dirname(dest);
  const file = path.basename(dest);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}

  let expected = 0;
  try { expected = (await requestHead(url)).size || 0; } catch (_) {}

  const N = Math.max(2, Math.min(threads || 16, 32));

  const args = [
    '-x', String(N),                     // 每服务器最大连接数
    '-s', String(N),                     // 分片数
    '-k', '1M',                          // 每片最小 1M
    '--console-log-level=warn',          // 只输出警告
    '--summary-interval=0',              // 关闭 aria2c 自带进度
    '--allow-overwrite=true',
    '--auto-file-renaming=false',
    '--max-tries=5',
    '--retry-wait=3',
    '-d', dir,
    '-o', file,
    url
  ];

  return new Promise(function (resolve, reject) {
    let child;
    try {
      child = spawn(aria2Path, args, {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      });
    } catch (e) {
      return reject(new Error('aria2c spawn failed: ' + e.message));
    }

    let stderrBuf = '';

    child.on('error', function (err) {
      reject(new Error('aria2c launch failed: ' + err.message));
    });

    if (child.stderr) {
      child.stderr.on('data', function (chunk) {
        stderrBuf += String(chunk);
        if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-2048);
      });
    }

    bar && bar.start();

    // 轮询文件大小（aria2c 会生成 .aria2 控制文件 + 真实文件）
    const start = Date.now();
    const MAX_WAIT = 6 * 3600 * 1000;

    const poll = setInterval(function () {
      try {
        if (!fs.existsSync(dest)) return;
        const size = fs.statSync(dest).size;
        if (task) task.bytes = size;
        bar && bar.update(size, expected);
      } catch (_) {}
    }, 500);

    // 暴露中断函数
    if (task) {
      task.abortFn = function () {
        try { child.kill('SIGKILL'); } catch (_) {}
      };
    }

    child.on('exit', function (code) {
      clearInterval(poll);
      if (task) task.abortFn = null;

      if (code !== 0) {
        const msg = stderrBuf.trim().split(/\r?\n/).pop() || ('exit code ' + code);
        return reject(new Error('aria2c 失败: ' + msg));
      }

      let finalSize = 0;
      try { finalSize = fs.statSync(dest).size; } catch (_) {}

      if (expected > 0 && finalSize !== expected) {
        return reject(new Error('文件不完整: ' + finalSize + '/' + expected));
      }

      if (task) task.bytes = finalSize;
      bar && bar.done(finalSize, expected || finalSize);
      resolve(dest);
    });

    // 超时保护
    setTimeout(function () {
      if (child.exitCode === null) {
        try { child.kill(); } catch (_) {}
      }
    }, MAX_WAIT);
  });
}

/* ═══════════════════ 单段/多段 HTTP 下载（aria2c 不可用时兜底） ═══════════════════ */

function downloadSegment(url, dest, startByte, endByte, redirect, onData) {
  if (redirect === undefined) redirect = 0;
  return new Promise(function (resolve, reject) {
    if (redirect > 6) return reject(new Error('Too many redirects'));
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'http:' ? http : https;
    const headers = {
      'user-agent': 'EasyPackageManager/1.0.0',
      'accept': '*/*',
      'accept-encoding': 'identity'
    };
    if (startByte != null) headers.range = 'bytes=' + startByte + '-' + endByte;

    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'GET',
      headers: headers
    }, function (res) {
      if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0 && res.headers.location) {
        res.resume();
        return resolve(downloadSegment(url, dest, startByte, endByte, redirect + 1, onData));
      }
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const ws = fs.createWriteStream(dest, startByte != null ? { flags: 'a' } : {});
      res.on('data', function (chunk) { onData && onData(chunk.length); });
      res.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(600000, function () { req.destroy(new Error('Timeout')); });
    req.end();
  });
}

async function downloadMultiThread(url, dest, task, bar, threads) {
  const head = await requestHead(url);
  if (head.status >= 400) throw new Error('HTTP ' + head.status);
  const total = head.size || 0;

  if (task) task.total = total;
  bar && bar.start();

  if (!head.acceptRanges || !total || total < 4 * 1024 * 1024) {
    let recv = 0;
    await downloadSegment(url, dest, null, null, 0, function (n) {
      recv += n;
      if (task) task.bytes = recv;
      bar && bar.update(recv, total);
    });
    bar && bar.done(recv, total);
    return dest;
  }

  // 记录分段请求，供 abort 调用
  const activeReqs = [];
  if (task) {
    task.abortFn = function () {
      for (const r of activeReqs) {
        try { r.destroy(new Error('Aborted')); } catch (_) {}
      }
    };
  }

  const N = Math.max(2, Math.min(threads || 8, 16));
  const segSize = Math.ceil(total / N);
  const parts = [];
  for (let i = 0; i < N; i++) {
    const start = i * segSize;
    const end = Math.min(start + segSize - 1, total - 1);
    if (start >= total) break;
    parts.push({ start: start, end: end, tmp: dest + '.part' + i });
  }

  let doneBytes = 0;
  const progress = parts.map(function () { return 0; });

  await Promise.all(parts.map(function (p, i) {
    return downloadSegment(url, p.tmp, p.start, p.end, 0, function (n) {
      progress[i] += n;
      doneBytes = progress.reduce(function (a, b) { return a + b; }, 0);
      if (task) task.bytes = doneBytes;
      bar && bar.update(doneBytes, total);
    });
  }));

  const wfd = fs.createWriteStream(dest);
  for (const p of parts) {
    await new Promise(function (resolve, reject) {
      const rfd = fs.createReadStream(p.tmp);
      rfd.pipe(wfd, { end: false });
      rfd.on('end', resolve);
      rfd.on('error', reject);
    });
    try { fs.unlinkSync(p.tmp); } catch (_) {}
  }
  wfd.end();
  await new Promise(function (r) { wfd.on('finish', r); });

  bar && bar.done(total, total);
  return dest;
}

/* ═══════════════════ 对外入口 ═══════════════════ */

async function download(url, dest, options) {
  options = options || {};
  const task = options.task || null;
  const showBar = options.progress !== false;
  const threads = options.threads || 16;
  const expected = Number(options.expectedSize) || 0;

  try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch (_) {}

  // ═══ 完整性校验：文件存在且大小匹配才跳过 ═══
  if (fs.existsSync(dest)) {
    const curSize = fs.statSync(dest).size;
    if (expected > 0 && curSize === expected) {
      if (task) { task.bytes = curSize; task.total = curSize; }
      return dest;
    }
    if (expected > 0 && curSize !== expected) {
      if (showBar) console.log('  残文件大小 ' + humanSize(curSize) + ' ≠ ' + humanSize(expected) + '，删除重下');
      try { fs.unlinkSync(dest); } catch (_) {}
    }
    if (expected === 0 && curSize > 0) {
      if (task) { task.bytes = curSize; task.total = curSize; }
      return dest;
    }
  }

  const bar = showBar ? createBar() : null;

  // ═══ 优先 aria2c ═══
  const aria2Path = findAria2c();
  if (aria2Path) {
    if (showBar) console.log('  使用 aria2c (' + threads + ' 线程)');
    try {
      return await downloadViaAria2(aria2Path, url, dest, task, bar, threads);
    } catch (e) {
      if (showBar) console.log('  aria2c 失败，回退多线程: ' + e.message);
      try { fs.unlinkSync(dest); } catch (_) {}
      try { fs.unlinkSync(dest + '.aria2'); } catch (_) {}
    }
  } else {
    if (showBar) console.log('  aria2c.exe 未找到，使用内置多线程');
  }

  // ═══ 回退多线程 ═══
  const r = await downloadMultiThread(url, dest, task, bar, threads);

  if (expected > 0) {
    const finalSize = fs.statSync(dest).size;
    if (finalSize !== expected) {
      try { fs.unlinkSync(dest); } catch (_) {}
      throw new Error('下载文件不完整: ' + finalSize + '/' + expected);
    }
  }
  return r;
}

module.exports = {
  download: download,
  findAria2c: findAria2c
};
