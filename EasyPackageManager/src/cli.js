'use strict';

const path = require('path');
const fs = require('fs');
const config = require('./config');
const platform = require('./platform');
const registry = require('./registry');
const sources = require('./sources');
const installer = require('./installer');
const downloader = require('./downloader');
const pak = require('./pak');
const proc = require('./process');
const tasks = require('./tasks');
const i18n = require('./i18n');
const versionLib = require('./version');
const { log: log, color: color, rmrf: rmrf, clearScreen: clearScreen, formatBytes: formatBytes, link: link } = require('./utils');

function typeBadge(type) {
  if (type === 'setup') return color.yellow('[setup]');
  if (type === 'port') return color.green('[port]');
  return color.gray('[' + (type || '?') + ']');
}


/* ═══════════════ 彩色命令前缀 ═══════════════ */

const PC = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  brightYellow: '\x1b[93m',
  white: '\x1b[97m',
  gray: '\x1b[90m',
  bold: '\x1b[1m'
};

function paintCmd(kind, text) {
  const map = {
    error: PC.red,
    download: PC.cyan,
    list: PC.blue,
    update: PC.brightYellow,
    arg: PC.white
  };
  const color = map[kind] || PC.white;
  return color + text + PC.reset;
}

function highlightCmd(line) {
  // 高亮命令关键字 + 参数
  const parts = String(line).split(/\s+/);
  if (!parts.length) return line;
  const cmd = parts[0];
  const cmdColors = {
    install: PC.cyan, i: PC.cyan,
    list: PC.blue, ls: PC.blue,
    update: PC.brightYellow,
    get: PC.cyan, search: PC.blue, download: PC.cyan,
    version: PC.brightYellow, v: PC.brightYellow,
    task: PC.brightYellow,
    help: PC.white, exit: PC.white,
    remove: PC.red, uninstall: PC.red, rm: PC.red
  };
  const c = cmdColors[cmd] || PC.white;
  let out = PC.bold + c + cmd + PC.reset;
  for (let i = 1; i < parts.length; i++) {
    const a = parts[i];
    if (a.startsWith('-')) {
      out += ' ' + PC.gray + a + PC.reset;
    } else {
      out += ' ' + PC.white + a + PC.reset;
    }
  }
  return out;
}

function buildHelpText() {
  const t = i18n.t;
  return [
    t('helpTitle'),
    t('helpPlatform') + ': ' + platform.platform + '/' + platform.arch,
    '',
    t('helpUsage') + ':',
    '  epm cli                              ' + t('helpCmdCli'),
    '  epm list                             ' + t('helpCmdList'),
    '  epm list install                     ' + t('helpCmdListInstall'),
    '  epm search <keyword> [opts]          ' + t('helpCmdSearch'),
    '  epm get                              ' + t('helpCmdGet'),
    '  epm install <name> [version] [path]  ' + t('helpCmdInstall'),
    '      便携版可指定安装路径              ' + t('helpInstallPath'),
    '      -q / -k / --no-run / -d <dir>    install options',
    '  epm package update [name]            ' + t('helpCmdPackageUpdate'),
    '      --check                          ' + t('helpUpdateCheck'),
    '  epm update [--check]                 ' + t('helpCmdUpdate'),
    '  epm version [name]                   ' + t('helpCmdVersion'),
    '  epm plugin path                    ' + t('helpCmdPluginPath'),
    '  epm plugin search [kw]              ' + t('helpCmdPluginSearch'),
    '  epm plugin add <name1,name2,...>    ' + t('helpCmdPluginAdd'),
    '  epm plugin del <name1,name2,...>    ' + t('helpCmdPluginDel'),
    '  epm plugin update [names]           ' + t('helpCmdPluginUpdate'),
    '  epm plugin pack <zip> <name> <ver>  ' + t('helpCmdPluginPack'),
    '  epm plugin list                     ' + t('helpCmdPluginList'),
    '  epm task list                        ' + t('helpCmdTaskList'),
    '  epm task stop <id|all>               ' + t('helpCmdTaskStop'),
    '  epm web [start|stop|status]          ' + t('helpCmdWeb'),
    '      -p <port>                        ' + t('helpWebPort'),
    '      --fg                             前台运行（默认后台）',
    '  epm login                            ' + t('helpCmdLogin'),
    '  epm logout                           ' + t('helpCmdLogout'),
    '  epm release appname=X path=Y ...     ' + t('helpCmdRelease'),
    '  epm uninstall <name>                 ' + t('helpCmdUninstall'),
    '  epm add <name> <url>                 ' + t('helpCmdAdd'),
    '  epm redadd <name> <path>             ' + t('helpCmdRedadd'),
    '  epm redel <name>                     ' + t('helpCmdRedel'),
    '  epm pak list|add|del                 ' + t('helpCmdPakList'),
    '  epm temp clear                       ' + t('helpCmdTempClear'),
    '  epm set <name> [value]               ' + t('helpCmdSet'),
    '  epm set list                         ' + t('helpCmdSetList'),
    '  epm lang [list|get|set]              ' + t('helpCmdLang'),
    '  epm clear                            ' + t('helpCmdClear'),
    '  epm exit                             ' + t('helpCmdExit'),
    '  epm help                             ' + t('helpCmdHelp'),
    '',
    t('helpShellHeader') + ':',
    '  {}                                   多行命令，例: { list; install FreeArc }',
    '  exit / quit                          退出'
  ].join('\n');
}

function unknownCommand(cmd) {
  console.log(
    i18n.t('unknownCommand') +
    color.red('"' + cmd + '"') +
    color.yellow(i18n.t('inputEpmHelp'))
  );
}

const NO_VALUE_FLAGS = ['q', 'k', 'a', 'na', 'av'];
const MULTI_VALUE_FLAGS = ['i', 'ni', 'v', 'nv'];
const SINGLE_VALUE_FLAGS = ['p', 'n', 'f', 'd', 't', 'port'];

function parseArgs(argv) {
  const args = { _: [], flags: {}, multi: {} };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') { args.flags.force = true; continue; }
    if (a === '--no-run') { args.flags['no-run'] = true; continue; }
    if (a === '--check') { args.flags.check = true; continue; }
    if (a === '--daemon') { args.flags.daemon = true; continue; }
    if (a === '--fg' || a === '--foreground') { args.flags.fg = true; continue; }

    if (a.length >= 3 && a[0] === '-' && a[1] !== '-' && a.indexOf('=') !== -1) {
      const eq = a.indexOf('=');
      const key = a.slice(1, eq);
      const value = a.slice(eq + 1);
      if (SINGLE_VALUE_FLAGS.indexOf(key) !== -1) { args.flags[key] = value; continue; }
    }

    if (a.length >= 2 && a[0] === '-' && a[1] !== '-') {
      const key = a.slice(1);
      if (NO_VALUE_FLAGS.indexOf(key) !== -1) { args.flags[key] = true; continue; }
      if (MULTI_VALUE_FLAGS.indexOf(key) !== -1) {
        const next = argv[i + 1];
        if (next !== undefined && !(next[0] === '-' && next.length > 1)) {
          i++;
          if (!args.multi[key]) args.multi[key] = [];
          for (const v of next.split(',')) { const tt = v.trim(); if (tt) args.multi[key].push(tt); }
        }
        continue;
      }
      if (SINGLE_VALUE_FLAGS.indexOf(key) !== -1) {
        const next = argv[i + 1];
        if (next !== undefined && !(next[0] === '-' && next.length > 1)) { args.flags[key] = next; i++; }
        else args.flags[key] = true;
        continue;
      }
    }

    if (a.length > 2 && a.slice(0, 2) === '--') {
      const key = a.slice(2);
      const eq = key.indexOf('=');
      if (eq !== -1) args.flags[key.slice(0, eq)] = key.slice(eq + 1);
      else {
        const next = argv[i + 1];
        if (next !== undefined && !(next[0] === '-' && next.length > 1)) { args.flags[key] = next; i++; }
        else args.flags[key] = true;
      }
      continue;
    }

    args._.push(a);
  }
  return args;
}

const KNOWN_COMMANDS = [
  'cli', 'list', 'get', 'search', 'add', 'install', 'i', 'download',
  'uninstall', 'remove', 'rm', 'redadd', 'redel', 'temp', 'set',
  'lang', 'pak', 'clear', 'cls', 'update', 'package', 'version', 'v',
  'web', 'task', 'plugin', 'login', 'signup', 'logout', 'release',
  'exit', 'quit', 'help'
];

async function dispatch(argv) {
  const args = parseArgs(argv);
  if (!args._.length) { console.log(buildHelpText()); return; }

  const cmd = args._[0];
  const sub = args._[1];

  if (KNOWN_COMMANDS.indexOf(cmd) === -1) { unknownCommand(cmd); return; }

  switch (cmd) {
    case 'cli':
      return require('./shell').run();

    case 'list':
      if (sub === 'install' || sub === 'installed') return listInstalled();
      return listAvailable();

    case 'search':
      return searchPackages(args);

    case 'get':
      return getFromGithub();

    case 'add':
      return installer.addPackage(args._[1], args._[2], args.flags);

    case 'install':
    case 'i':
      return runInstall(args);

    case 'download':
      return runDownload(args);

    case 'uninstall':
    case 'remove':
    case 'rm':
      return installer.uninstall(args._[1]);

    case 'redadd':
      return installer.registerDisk(args._[1], args._[2]);

    case 'redel':
      return installer.unregister(args._[1]);

    case 'pak':
      return pakCommand(args._.slice(1), args.flags);

    case 'model':
      return modelCommand(args._.slice(1));

    case 'plugin':
      return pluginCommand(args._.slice(1), args.flags);

    case 'task':
      return taskCommand(args._.slice(1));

    case 'login':
      return require('./login').login();

    case 'logout': {
      const auth = require('./auth');
      const r = auth.logout();
      log[r ? 'success' : 'warn'](r ? i18n.t('logoutOK') : i18n.t('logoutNone'));
      return;
    }

    case 'release':
      return require('./release').release(args);

    case 'temp':
      if (sub === 'clear') return clearTemp();
      log.error(i18n.t('tempUsage')); return;

    case 'set':
      return settings(args._.slice(1));

    case 'lang':
      return lang(args._.slice(1));

    case 'web':
      return webCommand(args._.slice(1), args.flags);

    case 'clear':
    case 'cls':
      clearScreen(); return;

    case 'package':
      if (sub === 'update') {
        return packageUpdate(args._.slice(2), args.flags);
      }
      log.error('用法: epm package update [name] [--check]');
      return;

    case 'update':
      return selfUpdate(args);

    case 'version':
    case 'v':
      return versionCommand(args._.slice(1));

    case 'exit':
    case 'quit':
      return proc.exitAll(0);

    case 'help':
      console.log(buildHelpText()); return;
  }
}

/* ─────────────────────────────────────── self update ── */

async function selfUpdate(args) {
  return require('./self-update').updateSelf(args.flags);
}

/* ─────────────────────────────────────── package update ── */

async function packageUpdate(rest, flags) {
  const name = rest[0] || null;

  log.step(i18n.t('updateFetching'));
  try {
    const { fetchAll } = require('./update-lib');
    await fetchAll({});
  } catch (err) {
    log.error(i18n.t('fetchPkgsFail') + ': ' + err.message);
    return;
  }

  if (flags.check) return updateCheck(name);

  flags.q = true;

  log.step(i18n.t('updateStart'));
  const n = await installer.updatePackage(name, flags);
  if (n === 0) log.success(i18n.t('updateAlreadyLatest'));
  else log.success(i18n.t('updateDone') + '  ' + n + ' ' + i18n.t('updateUpdated'));
}

async function updateCheck(name) {
  const inst = registry.list();
  const targets = name ? inst.filter(function (p) { return p.name === name; }) : inst;
  if (!targets.length) { log.info(i18n.t('noInstalledPkgs')); return; }

  let count = 0;
  for (const t of targets) {
    const pkg = sources.find(t.name);
    if (!pkg || !pkg.latest) continue;
    if (versionLib.compareVer(pkg.latest.version, t.version) > 0) {
      console.log('  ' + color.cyan(t.name) + '  v' + t.version + ' -> v' + pkg.latest.version);
      count++;
    }
  }
  if (count === 0) log.success(i18n.t('updateAlreadyLatest'));
  else console.log('  ' + i18n.t('updatePlan') + ': ' + count);
}

/* ─────────────────────────────────────── web ── */

async function webCommand(rest, flags) {
  const web = require('./web');
  const sub = rest[0] || 'start';

  if (sub === 'stop') {
    const r = await web.stop();
    if (r.ok) log.success(i18n.t('webStopped') + ' (PID ' + r.pid + ')');
    else log.warn(i18n.t('webNotRunning'));
    return;
  }

  if (sub === 'status') {
    const s = web.status();
    if (s.running) {
      log.info(i18n.t('webRunning') + '  ' + i18n.t('webPortLabel') + ' ' + s.port + '  PID ' + s.pid);
      console.log('  ' + color.cyan('http://localhost:' + s.port + '/'));
    } else {
      log.info(i18n.t('webNotRunning'));
    }
    return;
  }

  const port = flags.p || flags.port || 7632;

  // 守护进程：由 startBackground 通过 spawn 启动，独立运行
  if (flags.daemon) {
    const r = await web.start({ port: port });
    if (r.ok) {
      web.writePid({ pid: process.pid, port: r.port, host: r.host || '127.0.0.1' });
      global.__epm_keepAlive = true;
    } else if (r.error === 'alreadyRunning') {
      // 端口已被占用，直接退出
    }
    return;
  }

  // 前台（--fg）
  if (flags.fg) {
    log.step(i18n.t('webStarting'));
    const r = await web.start({ port: port });
    if (r.ok) {
      web.writePid({ pid: process.pid, port: r.port, host: r.host || '127.0.0.1' });
      log.success(i18n.t('webStarted') + '  ' + i18n.t('webPortLabel') + ' ' + r.port);
      console.log('  ' + color.cyan('http://localhost:' + r.port + '/'));
      console.log('  ' + color.gray(i18n.t('webStopHint')));
    } else if (r.error === 'alreadyRunning') {
      log.warn(i18n.t('webAlreadyRunning') + ' ' + i18n.t('webPortLabel') + ' ' + r.port);
    } else {
      log.error(i18n.t('webStartFailed') + ': ' + (r.message || r.error));
    }
    return;
  }

  // 后台（默认）
  log.step(i18n.t('webStartingBg'));
  const r = await web.startBackground({ port: port });

  if (r.ok) {
    log.success(i18n.t('webStartedBg') + '  ' + i18n.t('webPortLabel') + ' ' + r.port + '  PID ' + r.pid);
    console.log('  ' + color.cyan('http://localhost:' + r.port + '/'));
    console.log('  ' + color.gray(i18n.t('webStopHint')));
  } else if (r.error === 'alreadyRunning') {
    log.warn(i18n.t('webAlreadyRunning') + '  ' + i18n.t('webPortLabel') + ' ' + r.port);
  } else if (r.error === 'invalidPort') {
    log.error(i18n.t('webInvalidPort') + ': ' + port);
  } else if (r.error === 'timeout') {
    log.error(i18n.t('webStartFailed') + ': timeout');
    log.info('可能原因：');
    console.log('  1. 端口 ' + port + ' 被其它进程占用');
    console.log('     运行: netstat -ano | findstr :' + port);
    console.log('  2. 上次 Web 进程没退干净');
    console.log('     运行: taskkill /F /IM epm.exe');
    console.log('  3. 查看子进程日志:');
    console.log('     type "%USERPROFILE%\\.epm\\temp\\.epm-web.log"');
  } else {
    log.error(i18n.t('webStartFailed') + ': ' + (r.message || r.error));
  }
}

/* ─────────────────────────────────────── task ── */

async function taskCommand(rest) {
  const sub = rest[0] || 'list';

  if (sub === 'list' || sub === 'ls') {
    const list = tasks.list();
    if (!list.length) { log.info(i18n.t('taskListEmpty')); return; }
    console.log(i18n.t('taskHeader') + ':  (' + list.length + ')');
    for (const t of list) {
      const label = t.type === 'download' ? i18n.t('taskDownload') : i18n.t('taskInstall');
      let line = '  #' + t.id + '  [' + label + ']  ' + t.name;
      if (t.type === 'download' && t.total > 0) {
        const pct = ((t.bytes / t.total) * 100).toFixed(1);
        line += '  ' + pct + '%  ' + formatBytes(t.bytes) + ' / ' + formatBytes(t.total);
      }
      console.log(line);
    }
    return;
  }

  if (sub === 'stop' || sub === 'kill') {
    const id = rest[1];
    if (!id || id === 'all') {
      const killed = tasks.abortAll();
      log.success(i18n.t('taskStopAll') + '  (' + killed.length + ')');
      return;
    }
    const r = tasks.abort(id);
    if (!r.ok) { log.error(i18n.t('taskNotFound') + ': #' + id); return; }
    log.success(i18n.t('taskStopped') + ': #' + r.task.id + '  ' + r.task.name);
    return;
  }

  log.error(i18n.t('taskUsage'));
}

/* ─────────────────────────────────────── install ── */

function splitNames(raw) {
  return String(raw || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}


/* ═══════════════ 安装错误显示 ═══════════════ */

function showInstallError(err) {
  const msg = (err && err.message) || String(err);
  log.error(msg);

  const sug = (err && err.suggest) || [];
  if (!sug.length) return;

  console.log('');
  console.log('  ' + (i18n.t('suggestHeader') !== 'suggestHeader'
    ? i18n.t('suggestHeader')
    : '你是不是想装:'));

  const historyCmds = [];
  for (let i = 0; i < sug.length; i++) {
    const n = sug[i];
    const cmd = 'install ' + n;
    historyCmds.push(cmd);

    const num = color.gray('  ' + (i + 1) + ') ');
    const nameText = link(n, 'epm ' + cmd);
    console.log(num + nameText);
  }

  // 加入历史，用户按 ↑ 就能翻出
  if (global.__epm_addHistory) {
    for (const c of historyCmds) {
      try { global.__epm_addHistory(c); } catch (_) {}
    }
    console.log('');
    console.log('  ' + color.gray(i18n.t('suggestHint') !== 'suggestHint'
      ? i18n.t('suggestHint')
      : '按 ↑ 选择命令执行'));
  }
}

async function runInstall(args) {
  const raw = args._[1];
  if (!raw) throw new Error(i18n.t('installUsage'));

  // 解析位置参数：<name> [version] [path]
  // 第二个参数是路径（含 / \ : 或 ~ 或 . 开头）时，直接作为 path
  let version = null;
  let installPath = null;

  const a2 = args._[2] || null;
  const a3 = args._[3] || null;

  function isPathLike(s) {
    if (!s) return false;
    if (/[\\/]/.test(s)) return true;
    if (/^[A-Za-z]:/.test(s)) return true;
    if (s === '~' || s.indexOf('~/') === 0 || s.indexOf('~\\') === 0) return true;
    if (s === '.' || s === '..' || s.indexOf('./') === 0 || s.indexOf('.\\') === 0) return true;
    return false;
  }

  if (a2) {
    if (isPathLike(a2)) {
      installPath = a2;
    } else {
      version = a2;
      if (a3) installPath = a3;
    }
  }

  const names = splitNames(raw);

  if (names.length <= 1) {
    try {
      return await installer.install(names[0] || raw, version, installPath, args.flags);
    } catch (err) {
      showInstallError(err);
      return;
    }
  }

  const total = names.length;
  console.log(i18n.t('installMultiple') + ':  ' + total);
  console.log('');

  let okN = 0, failN = 0;
  for (let i = 0; i < total; i++) {
    const n = names[i];
    console.log(color.cyan('[' + (i + 1) + '/' + total + '] ') + color.bold(n));
    try {
      await installer.install(n, version, installPath, args.flags);
      okN++;
    } catch (err) {
      failN++;
      showInstallError(err);
    }
    console.log('');
  }
  log.success(i18n.t('installBatchDone') + '  ' + okN + ' ok' + (failN ? ' / ' + failN + ' fail' : ''));
}

async function runDownload(args) {
  const raw = args._[1];
  if (!raw) throw new Error(i18n.t('downloadUsage'));
  const version = args._[2] || null;
  const names = splitNames(raw);

  if (names.length <= 1) {
    return downloader.download(names[0] || raw, version, args.flags);
  }

  const total = names.length;
  console.log(i18n.t('downloadMultiple') + ':  ' + total);
  console.log('');

  let okN = 0, failN = 0;
  for (let i = 0; i < total; i++) {
    const n = names[i];
    console.log(color.cyan('[' + (i + 1) + '/' + total + '] ') + color.bold(n));
    try { await downloader.download(n, version, args.flags); okN++; }
    catch (err) { failN++; log.error(n + ': ' + err.message); }
    console.log('');
  }
  log.success(i18n.t('downloadBatchDone') + '  ' + okN + ' ok' + (failN ? ' / ' + failN + ' fail' : ''));
}

/* ─────────────────────────────────────── list ── */

function listAvailable() {
  const pkgs = sources.listPackages();
  const st = sources.stats();
  if (!pkgs.length) {
    log.info(i18n.t('noAvailablePkgs'));
    log.info(i18n.t('runGetHint'));
    return;
  }
  console.log(i18n.t('availablePkgs') + ':  ' +
    st.pkgCount + ' ' + i18n.t('unitPackages') + ', ' +
    st.releaseCount + ' ' + i18n.t('unitReleases') + ', ' +
    st.fileCount + ' ' + i18n.t('unitFiles'));
  if (st.updatedAt) console.log(color.gray('  ' + i18n.t('updatedAt') + ' ' + st.updatedAt));
  console.log('');

  for (let i = 0; i < pkgs.length; i++) {
    const pkg = pkgs[i];
    const isLast = i === pkgs.length - 1;
    const branch = isLast ? '└─ ' : '├─ ';
    const co = (pkg.company && pkg.company !== 'null') ? color.gray('  ' + pkg.company) : '';
    console.log(branch + color.cyan(pkg.name) + '  ' + typeBadge(pkg.type) + co);

    const vs = pkg.versions;
    const pad = isLast ? '   ' : '│  ';
    for (let j = 0; j < vs.length; j++) {
      const v = vs[j];
      const vLast = j === vs.length - 1;
      const vb = vLast ? '└─ ' : '├─ ';
      const size = v.size ? color.gray(' (' + formatBytes(v.size) + ')') : '';
      const tag = (v === pkg.latest) ? color.green(' *') : '';
      console.log(pad + vb + 'v' + v.version + '  ' + v.fileName + size + tag);
    }
  }
}

function listInstalled() {
  const pkgs = registry.list();
  if (!pkgs.length) { log.info(i18n.t('noInstalledPkgs')); return; }
  console.log(i18n.t('installedPkgs') + ':');
  for (const p of pkgs) {
    const ver = p.version ? color.gray(' v' + p.version) : '';
    const type = p.type ? typeBadge(p.type) : '';
    const file = p.fileName ? color.dim(' (' + p.fileName + ')') : '';
    console.log('  ' + color.cyan(p.name) + ver + '  ' + type + file);
    if (p.path) console.log('    ' + color.gray(p.path));
  }
}

/* ─────────────────────────────────────── search ── */

function searchPackages(args) {
  const all = sources.listPackages();
  const text = args._.slice(1).join(' ');
  const lowerText = text.toLowerCase();
  const fullWord = Boolean(args.flags.a);
  const companies = args.multi.i || [];
  const exclCompanies = args.multi.ni || [];
  const versions = args.multi.v || [];
  const exclVersions = args.multi.nv || [];
  const type = args.flags.t || null;
  const allVersions = Boolean(args.flags.av);

  const hits = [];
  for (const pkg of all) {
    if (type && pkg.type !== type) continue;

    if (companies.length) {
      let m = false;
      for (const c of companies) {
        if (pkg.company.toLowerCase().indexOf(c.toLowerCase()) !== -1) { m = true; break; }
      }
      if (!m) continue;
    }
    if (exclCompanies.length) {
      let ex = false;
      for (const c of exclCompanies) {
        if (pkg.company.toLowerCase() === c.toLowerCase()) { ex = true; break; }
      }
      if (ex) continue;
    }

    if (text) {
      const m = fullWord ? pkg.name.toLowerCase() === lowerText
                         : pkg.name.toLowerCase().indexOf(lowerText) !== -1;
      if (!m) continue;
    }

    let mv = pkg.versions.slice();
    if (versions.length) mv = mv.filter(function (v) { return versions.indexOf(v.version) !== -1; });
    if (exclVersions.length) mv = mv.filter(function (v) { return exclVersions.indexOf(v.version) === -1; });
    if (!mv.length) continue;

    hits.push(Object.assign({}, pkg, {
      versions: allVersions ? mv : [mv[mv.length - 1]],
      latest: mv[mv.length - 1]
    }));
  }

  if (!hits.length) { log.info(i18n.t('noAvailablePkgs')); return; }

  const head = text ? i18n.t('searchHeader') + ' "' + text + '"' : i18n.t('filterHeader');
  console.log(head + ':  ' + hits.length + ' ' + i18n.t('unitPackages'));

  for (const p of hits) {
    const co = (p.company && p.company !== 'null') ? color.gray('  company=' + p.company) : '';
    console.log('');
    console.log('  ' + color.cyan(p.name) + '  ' + typeBadge(p.type) + co);
    for (const v of p.versions) {
      const size = v.size ? color.gray(' (' + formatBytes(v.size) + ')') : '';
      console.log('      v' + v.version + '  ' + v.fileName + size);
    }
  }
}

/* ─────────────────────────────────────── get ── */

async function getFromGithub() {
  log.step(i18n.t('fetchingPkgs'));
  try {
    const { fetchAll } = require('./update-lib');
    const r = await fetchAll({});
    if (!r.releases.length) { log.warn(i18n.t('noReleasesGot')); return; }
    log.success(i18n.t('fetchPkgsOK') + ' ' + r.releases.length + ' ' + i18n.t('unitReleases'));
    try {
      const f = require('./applist').save();
      console.log(color.gray('  ' + i18n.t('applistSaved') + ': ' + f));
    } catch (_) {}
  } catch (err) {
    log.error(i18n.t('fetchPkgsFail') + ': ' + err.message);
  }
}

/* ─────────────────────────────────────── version ── */

async function versionCommand(rest) {
  if (!rest.length) {
    console.log('EasyPackageManager  v' + versionLib.getPkgVersion());
    const inst = registry.list();
    if (inst.length) {
      console.log(i18n.t('installedPkgs') + ':');
      for (const p of inst) {
        console.log('  ' + color.cyan(p.name) + '  v' + (p.version || '?'));
      }
    }
    return;
  }

  const name = rest[0];
  const pkg = sources.find(name);
  const reg = registry.get(name);

  if (reg) console.log(color.cyan(name) + '  ' + i18n.t('versionInstalled') + ' v' + reg.version);
  if (pkg) {
    console.log(color.cyan(pkg.name) + '  ' + i18n.t('versionLatest') + ' v' + pkg.latest.version +
      '  (' + pkg.versions.length + ')');
    console.log(i18n.t('versionAll'));
    for (const v of pkg.versions) {
      const mark = (reg && reg.version === v.version) ? color.green(' *') : '';
      console.log('  v' + v.version + '  ' + v.fileName + mark);
    }
  } else if (!reg) {
    log.error(i18n.t('pkgNotFound') + ': ' + name);
  }
}

/* ─────────────────────────────────────── pak ── */




/* ═══════════════ plugin 命令 ═══════════════ */

async function pluginCommand(rest, flags) {
  flags = flags || {};
  const sub = rest[0] || 'search';
  const plugin = require('./plugin');

  if (sub === 'path') {
    const name = rest[1];
    if (name) {
      console.log(plugin.pluginPath(name));
    } else {
      console.log(plugin.PLUGIN_DIR);
    }
    return;
  }

  if (sub === 'search') {
    const kw = rest.slice(1).join(' ');
    const hits = plugin.search(kw);

    // 先确保有包列表
    if (!hits.length && !kw) {
      try {
        const { fetchAll } = require('./update-lib');
        log.step('拉取插件列表...');
        await fetchAll({});
      } catch (_) {}
      const again = plugin.search('');
      if (!again.length) {
        log.info('没有可用的插件');
        return;
      }
      return printPluginList(again);
    }

    if (!hits.length) { log.info('没有匹配的插件'); return; }
    return printPluginList(hits);
  }

  if (sub === 'add') {
    const arg = rest.slice(1).join(',');
    const names = arg.split(',').map(s => s.trim()).filter(Boolean);
    if (!names.length) { log.error('用法: epm plugin add <name1,name2,...>'); return; }

    // 如果找不到，先拉列表
    if (!plugin.findAvailable(names[0])) {
      try {
        const { fetchAll } = require('./update-lib');
        log.step('拉取插件列表...');
        await fetchAll({});
      } catch (_) {}
    }
    return plugin.add(names, {});
  }

  if (sub === 'del' || sub === 'remove') {
    const arg = rest.slice(1).join(',');
    const names = arg.split(',').map(s => s.trim()).filter(Boolean);
    if (!names.length) { log.error('用法: epm plugin del <name1,name2,...>'); return; }
    return plugin.del(names);
  }

  if (sub === 'update') {
    const arg = rest.slice(1).join(',');
    const names = arg ? arg.split(',').map(s => s.trim()).filter(Boolean) : null;
    return plugin.update(names);
  }

  if (sub === 'pack') {
    const zipPath = rest[1];
    const pname = rest[2];
    const pver = rest[3];
    const pco = rest[4] || 'null';
    const outDir = flags && flags.d ? flags.d : null;
    if (!zipPath || !pname || !pver) {
      log.error('用法: epm plugin pack <zip> <name> <version> [company] [-d <outdir>]');
      return;
    }
    try {
      const r = plugin.pack(zipPath, pname, pver, pco, outDir);
      log.success('已生成 ' + r.file);
      console.log('  输入: ' + formatBytes(r.sizeIn));
      console.log('  输出: ' + formatBytes(r.sizeOut) +
        '  (' + ((r.sizeOut / r.sizeIn) * 100).toFixed(1) + '%)');
      console.log('');
      console.log('  name.txt 内容:');
      console.log('    ' + r.nameTxt.trim());
    } catch (e) {
      log.error('打包失败: ' + e.message);
    }
    return;
  }

  if (sub === 'list') {
    const inst = plugin.listInstalled();
    if (!inst.length) { log.info('未安装任何插件'); return; }
    console.log('已安装插件:');
    for (const p of inst) {
      console.log('  ' + PC.cyan + p.name + PC.reset + '  v' + p.version +
        '  ' + PC.gray + p.path + PC.reset);
    }
    return;
  }

  log.error('用法: epm plugin [path|search|add|del|update|list]');
}

function printPluginList(list) {
  if (!list.length) { log.info('没有可用的插件'); return; }
  console.log('可用的插件:  ' + list.length);
  console.log('');
  for (const p of list) {
    const co = p.company && p.company !== 'null' ? PC.gray + '  ' + p.company + PC.reset : '';
    const inst = p.installed ? PC.green + '  [已安装 v' + p.installed.version + ']' + PC.reset : '';
    console.log('  ' + PC.cyan + p.name + PC.reset + co + inst);
    if (p.latest) {
      console.log('      v' + p.latest.version + '  ' + p.latest.fileName +
        '  ' + PC.gray + (p.latest.size ? formatBytes(p.latest.size) : '') + PC.reset);
    }
  }
}

async function pakCommand(rest, flags) {
  if (!rest.length || rest[0] === 'list') return pakList();
  const sub = rest[0];
  if (sub === 'add') {
    const name = rest[1], url = rest[2];
    if (!name || !url) { log.error(i18n.t('pakAddUsage')); return; }
    const r = pak.add(name, url, flags);
    if (!r.ok) {
      const key = r.error;
      const msg = i18n.t(key) !== key ? i18n.t(key) : key;
      log.error(msg);
      if (key === 'nameExists') log.warn(i18n.t('pakForceHint'));
      return;
    }
    log.success(i18n.t('pakAdded') + ': ' + r.pkg.name);
    return;
  }
  if (sub === 'del' || sub === 'delete' || sub === 'remove' || sub === 'rm') {
    const name = rest[1];
    if (!name) { log.error(i18n.t('pakDelUsage')); return; }
    const r = pak.remove(name);
    if (!r.ok) { log.error(i18n.t('pakNotFound') + ': ' + name); return; }
    log.success(i18n.t('pakRemoved') + ': ' + name);
    return;
  }
  log.error(i18n.t('pakListUsage'));
}

function pakList() {
  const all = pak.list();
  console.log(i18n.t('pakHeader') + ':  (' + all.length + ')');
  if (!all.length) { log.info(i18n.t('pakEmpty')); return; }
  console.log('');
  for (const p of all) {
    console.log('  ' + color.cyan(p.name));
    if (p.file) console.log('    ' + color.gray(i18n.t('pakFile') + ': ' + p.file));
    console.log('    ' + color.gray(i18n.t('pakUrl') + ': ' + p.url));
    console.log('');
  }
}

/* ─────────────────────────────────────── temp / set / lang ── */

function clearTemp() {
  const tempdir = config.get('tempdir');
  if (!fs.existsSync(tempdir)) { log.info(i18n.t('tempDirNotExist') + ': ' + tempdir); return; }
  const entries = fs.readdirSync(tempdir).filter(function (n) {
    return n !== '.gitkeep' && n.indexOf('.epm.pids') !== 0 && n.indexOf('.epm-web') !== 0;
  });
  for (const e of entries) rmrf(path.join(tempdir, e));
  log.success(i18n.t('tempCleared') + ' ' + tempdir + '  (' + entries.length + ')');
}

async function settings(rest) {
  if (!rest.length || rest[0] === 'list') {
    const all = config.list();
    console.log(i18n.t('settingsHeader') + ':');
    for (const k of Object.keys(all)) console.log('  ' + color.cyan(k) + ' = ' + all[k]);
    return;
  }
  const key = rest[0];
  if (rest.length === 1) { console.log(key + ' = ' + config.get(key)); return; }
  const value = rest.slice(1).join(' ');
  config.set(key, value);
  if (key === 'lang') i18n.reload();
  log.success(i18n.t('settingUpdated') + ' ' + key + ' = ' + value);
}

async function lang(rest) {
  if (!rest.length || rest[0] === 'list') return langList();
  const sub = rest[0];
  if (sub === 'get') {
    log.step(i18n.t('langGetting'));
    const { fetchLangs } = require('./langfetch');
    await fetchLangs({});
    return;
  }
  if (sub === 'set') {
    const name = rest[1];
    if (!name) { console.log(i18n.t('langUsage')); return; }
    const file = path.join(i18n.LANG_DIR, name + '.lang');
    if (!fs.existsSync(file)) { log.error(i18n.t('langNotFound') + ': ' + name); return; }
    config.set('lang', name);
    i18n.reload();
    log.success(i18n.t('langSetOK') + ': ' + name);
    return;
  }
  log.error(i18n.t('langUsage'));
}

function langList() {
  const cur = i18n.current();
  const all = i18n.listLangs();
  console.log(i18n.t('langCurrent') + ': ' + color.cyan(cur));
  if (!all.length) { log.warn(i18n.t('noAvailablePkgs')); return; }
  console.log(i18n.t('langAvailable') + ':');
  for (const name of all) {
    const meta = i18n.info(name);
    const display = meta && meta.displayName ? meta.displayName : name;
    const mark = (name === cur) ? color.green(' *') : '';
    console.log('  ' + color.cyan(name) + '  ' + color.gray(display) + mark);
  }
}

module.exports = {
  dispatch: dispatch,
  parseArgs: parseArgs,
  buildHelpText: buildHelpText,
  unknownCommand: unknownCommand,
  listAvailable: listAvailable,
  listInstalled: listInstalled,
  searchPackages: searchPackages,
  pakCommand: pakCommand,
  taskCommand: taskCommand,
  clearTemp: clearTemp,
  settings: settings,
  lang: lang,
  versionCommand: versionCommand,
  selfUpdate: selfUpdate,
  packageUpdate: packageUpdate,
  webCommand: webCommand
};
