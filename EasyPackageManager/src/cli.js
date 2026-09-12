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
const i18n = require('./i18n');
const classify = require('./classify');
const { log: log, color: color, rmrf: rmrf, clearScreen: clearScreen, formatBytes: formatBytes } = require('./utils');

function buildHelpText() {
  const t = i18n.t;
  return [
    t('helpTitle'),
    t('helpPlatform') + ': ' + platform.platform + '/' + platform.arch,
    '',
    t('helpUsage') + ':',
    '  epm run                              ' + t('helpCmdRun'),
    '  epm cli                              ' + t('helpCmdCli'),
    '  epm list                             ' + t('helpCmdList'),
    '  epm list install                     ' + t('helpCmdListInstall'),
    '  epm search <keyword>                 ' + t('helpCmdSearch'),
    '  epm get                              ' + t('helpCmdGet'),
    '  epm add <name> <url>                 ' + t('helpCmdAdd'),
    '  epm install <name>                   ' + t('helpCmdInstall'),
    '      name@file                        ' + t('helpCmdInstallFile'),
    '      -f <file>                        ' + t('helpCmdInstallF'),
    '      -p <path>                        ' + t('helpCmdInstallP'),
    '      -q                               ' + t('helpCmdInstallQ'),
    '      -k                               保留安装包',
    '      --no-run                         只下载不运行',
    '      -d <dir>                         下载到指定目录',
    '  epm download <name>[@file]           ' + t('helpCmdDownload'),
    '      -n <filename>                    ' + t('helpCmdDownloadN'),
    '  epm uninstall <name>                 ' + t('helpCmdUninstall'),
    '  epm redadd <name> <path>             ' + t('helpCmdRedadd'),
    '  epm redel <name>                     ' + t('helpCmdRedel'),
    '  epm pak list                         ' + t('helpCmdPakList'),
    '  epm pak add <name> <url>             ' + t('helpCmdPakAdd'),
    '  epm pak del <name>                   ' + t('helpCmdPakDel'),
    '  epm temp clear                       ' + t('helpCmdTempClear'),
    '  epm set <name> [value]               ' + t('helpCmdSet'),
    '  epm set list                         ' + t('helpCmdSetList'),
    '  epm lang                             ' + t('helpCmdLang'),
    '  epm lang list                        ' + t('helpCmdLangList'),
    '  epm lang get                         ' + t('helpCmdLangGet'),
    '  epm lang set <name>                  ' + t('helpCmdLangSet'),
    '  epm clear                            ' + t('helpCmdClear'),
    '  epm update                           ' + t('helpCmdUpdate'),
    '      --check                          ' + t('helpCmdUpdateCheck'),
    '      --run                            ' + t('helpCmdUpdateRun'),
    '      -d <dir>                         ' + t('helpCmdUpdateDir'),
    '  epm version                          ' + t('helpCmdVersion'),
    '  epm exit                             ' + t('helpCmdExit'),
    '  epm help                             ' + t('helpCmdHelp'),
    '',
    t('helpShellHeader') + ':',
    '  {}                                   ' + t('helpMultiLine'),
    '  exit / quit                          ' + t('helpExitHint')
  ].join('\n');
}

function unknownCommand(cmd) {
  console.log(
    i18n.t('unknownCommand') +
    color.red('"' + cmd + '"') +
    color.yellow(i18n.t('inputEpmHelp'))
  );
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-q') args.flags.q = true;
    else if (a === '-k') args.flags.k = true;
    else if (a === '--force') args.flags.force = true;
    else if (a === '--no-run') args.flags['no-run'] = true;
    else if (a === '-p' || a === '-n' || a === '-f' || a === '-d') {
      const key = a.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !(next.length > 1 && next[0] === '-')) { args.flags[key] = next; i++; }
      else args.flags[key] = true;
    } else if (a.length > 2 && a.slice(0, 2) === '--') {
      const key = a.slice(2);
      const eq = key.indexOf('=');
      if (eq !== -1) args.flags[key.slice(0, eq)] = key.slice(eq + 1);
      else {
        const next = argv[i + 1];
        if (next !== undefined && next[0] !== '-') { args.flags[key] = next; i++; }
        else args.flags[key] = true;
      }
    } else args._.push(a);
  }
  return args;
}

const KNOWN_COMMANDS = [
  'run', 'cli', 'list', 'get', 'search', 'add', 'install', 'i', 'download',
  'uninstall', 'remove', 'rm', 'redadd', 'redel', 'temp', 'set',
  'lang', 'pak', 'clear', 'cls', 'update', 'version', 'v', 'exit', 'quit', 'help'
];

async function dispatch(argv) {
  const args = parseArgs(argv);
  if (!args._.length) { console.log(buildHelpText()); return; }
  const cmd = args._[0];
  const sub = args._[1];
  if (KNOWN_COMMANDS.indexOf(cmd) === -1) { unknownCommand(cmd); return; }
  switch (cmd) {
    case 'run':
    case 'cli': return require('./shell').run();
    case 'list':
      if (sub === 'install' || sub === 'installed') return listInstalled();
      return listAvailable();
    case 'search': return searchPackages(args._.slice(1).join(' '));
    case 'get': return getFromGithub();
    case 'add': return installer.addPackage(args._[1], args._[2], args.flags);
    case 'install':
    case 'i': return installer.install(args._[1], args.flags);
    case 'download': return downloader.download(args._[1], args.flags);
    case 'uninstall':
    case 'remove':
    case 'rm': return installer.uninstall(args._[1]);
    case 'redadd': return installer.registerDisk(args._[1], args._[2]);
    case 'redel': return installer.unregister(args._[1]);
    case 'pak': return pakCommand(args._.slice(1), args.flags);
    case 'temp':
      if (sub === 'clear') return clearTemp();
      log.error(i18n.t('tempUsage')); return;
    case 'set': return settings(args._.slice(1));
    case 'lang': return lang(args._.slice(1));
    case 'clear':
    case 'cls': clearScreen(); return;
    case 'update': return runUpdate(args.flags);
    case 'version':
    case 'v': return showVersion();
    case 'exit':
    case 'quit': return proc.exitAll(0);
    case 'help': console.log(buildHelpText()); return;
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
    log.info(i18n.t('pakFile') + ': ' + r.pkg.file);
    log.info(i18n.t('pakUrl') + ': ' + r.pkg.url);
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
    if (p.addedAt) console.log('    ' + color.dim(i18n.t('pakAddedAt') + ': ' + p.addedAt));
    console.log('');
  }
}

function typeLabel(type) {
  const i18n = require('./i18n');
  const lang = i18n.current();
  const table = lang === 'en' ? classify.TYPE_LABEL_EN : classify.TYPE_LABEL;
  const txt = table[type] || type;
  if (type === 'installer') return color.yellow('[' + txt + ']');
  if (type === 'portable') return color.green('[' + txt + ']');
  if (type === 'archive') return color.cyan('[' + txt + ']');
  if (type === 'exe') return color.gray('[' + txt + ']');
  return color.dim('[' + txt + ']');
}

function listAvailable() {
  const pkgs = sources.listAvailable();
  const st = sources.stats();
  if (!pkgs.length) { log.info(i18n.t('noAvailablePkgs')); log.info(i18n.t('runGetHint')); return; }
  console.log(i18n.t('availablePkgs') + ':  ' + st.releaseCount + ' releases, ' + st.pakCount + ' local, ' + st.fileCount + ' files (' + formatBytes(st.totalSize) + ')');
  if (st.updatedAt) console.log(color.gray('  updated at ' + st.updatedAt));
  console.log('');
  for (const p of pkgs) {
    const isPak = p.type === 'pak';
    const flag = p.prerelease ? color.yellow(' ' + i18n.t('prereleaseTag')) : '';
    const local = isPak ? color.magenta(' ' + i18n.t('localTag')) : '';
    console.log('  ' + color.cyan(p.name) + ' ' + color.gray('(' + p.files.length + ' files)') + flag + local);
    if (p.publishedAt) console.log('    ' + color.gray(i18n.t('publishedAt') + ' ' + p.publishedAt));
    if (!p.files.length) { console.log('    ' + color.dim(i18n.t('noFiles'))); continue; }
    const picked = platform.pickAsset(p.files, p.name);
    for (const f of p.files) {
      const mark = (picked && f.name === picked.name) ? color.green(' ' + i18n.t('currentPlatformMark')) : '';
      const size = f.size ? color.gray(' (' + formatBytes(f.size) + ')') : '';
      const ftype = f.type || classify.classify(f.name);
      const label = typeLabel(ftype);
      console.log('      - ' + f.name + size + '  ' + label + mark);
    }
    console.log('');
  }
}

function searchPackages(keyword) {
  if (!keyword) { log.error('用法: epm search <keyword>'); return; }
  const hits = sources.search(keyword);
  if (!hits.length) { log.info(i18n.t('noAvailablePkgs')); return; }
  console.log('搜索 "' + keyword + '":  ' + hits.length + ' releases');
  for (const p of hits) {
    const local = p.type === 'pak' ? color.magenta(' ' + i18n.t('localTag')) : '';
    console.log('');
    console.log('  ' + color.cyan(p.name) + local);
    for (const f of p.files) {
      const lower = f.name.toLowerCase();
      const hl = lower.indexOf(String(keyword).toLowerCase()) !== -1 ? color.yellow(f.name) : f.name;
      const size = f.size ? color.gray(' (' + formatBytes(f.size) + ')') : '';
      const ftype = f.type || classify.classify(f.name);
      console.log('      - ' + hl + size + '  ' + typeLabel(ftype));
    }
  }
}

function listInstalled() {
  const pkgs = registry.list();
  if (!pkgs.length) { log.info(i18n.t('noInstalledPkgs')); return; }
  console.log(i18n.t('installedPkgs') + ':');
  for (const p of pkgs) {
    const tag = color.gray('[' + p.type + ']');
    const ver = p.version ? color.gray(' ' + p.version) : '';
    const file = p.file ? color.dim(' (' + p.file + ')') : '';
    console.log('  ' + color.cyan(p.name) + ' ' + tag + ver + file);
    console.log('    ' + p.path);
  }
}

function clearTemp() {
  const tempdir = config.get('tempdir');
  if (!fs.existsSync(tempdir)) { log.info(i18n.t('tempDirNotExist') + ': ' + tempdir); return; }
  const entries = fs.readdirSync(tempdir).filter(function (n) {
    return n !== '.gitkeep' && n.indexOf('.epm.pids') !== 0;
  });
  for (const e of entries) rmrf(path.join(tempdir, e));
  log.success(i18n.t('tempCleared') + ' ' + tempdir + '  (' + entries.length + ' ' + i18n.t('itemsDeleted') + ')');
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

async function getFromGithub() {
  log.step(i18n.t('fetchingPkgs'));
  try {
    const { fetchAll } = require('./update-lib');
    const r = await fetchAll({});
    if (!r.releases.length) { log.warn(i18n.t('noReleasesGot')); return; }
    log.success(i18n.t('fetchPkgsOK') + ' ' + r.releases.length + ' releases, ' + r.fileCount + ' files');
  } catch (err) {
    log.error(i18n.t('fetchPkgsFail') + ': ' + err.message);
    const cached = sources.listAvailable();
    if (cached.length) log.warn(i18n.t('fetchPkgsCached') + ' (' + cached.length + ')');
  }
}

async function runUpdate(flags) {
  flags = flags || {};
  const version = require('./version');
  const classify = require('./classify');
  const net = require('./net');
  const { fetchAll } = require('./update-lib');
  const { ensureDir: ensureDir } = require('./utils');

  log.step(i18n.t('updateFetching'));
  try {
    await fetchAll({});
  } catch (err) {
    log.error(i18n.t('fetchPkgsFail') + ': ' + err.message);
    return;
  }

  const all = sources.listAvailable();

  const validReleases = all.filter(function (p) {
    return version.isValidVersion(p.version);
  }).sort(function (a, b) {
    return version.compareVer(a.version, b.version);
  });

  if (!validReleases.length) {
    log.warn(i18n.t('updateNoReleases'));
    return;
  }

  const current = version.getCurrent();

  if (!current) {
    const latest = validReleases[validReleases.length - 1];
    log.info(i18n.t('updateFirstRun') + ': ' + latest.version);

    const targets = [];
    for (const f of latest.files) {
      const ftype = f.type || classify.classify(f.name);
      if (ftype === 'installer') targets.push({ release: latest, file: f });
    }

    if (!targets.length) {
      log.warn(i18n.t('updateNoSetup'));
      version.setCurrent(latest.version);
      return;
    }

    const dest = flags.d ? path.resolve(flags.d) : config.ROOT;
    ensureDir(dest);

    if (flags.check) {
      console.log(i18n.t('updatePlan') + ':  -> ' + latest.version);
      for (const t of targets) console.log('  ' + t.file.name);
      return;
    }

    let okN = 0, failN = 0;
    for (const t of targets) {
      const target = path.join(dest, t.file.name);
      if (!flags.q) log.info(t.release.version + '  ' + t.file.name);
      try {
        await net.downloadWithRetry(t.file.url, target);
        okN++;
        if (flags.run) {
          try {
            const runner = require('./runner');
            await runner.runInstaller(target, t.file.name, flags);
          } catch (err2) {
            log.error(i18n.t('installerFailed') + ': ' + err2.message);
          }
        }
      } catch (err3) {
        failN++;
        log.error(t.file.name + ': ' + err3.message);
      }
    }

    version.setCurrent(latest.version);
    log.success(i18n.t('updateDone') + '  ' + okN + ' ok' + (failN ? ' / ' + failN + ' fail' : ''));
    return;
  }

  const newer = validReleases.filter(function (p) {
    return version.compareVer(p.version, current) > 0;
  });

  if (!newer.length) {
    log.success(i18n.t('updateAlreadyLatest') + ': ' + current);
    return;
  }

  const targets = [];
  for (const rel of newer) {
    for (const f of rel.files) {
      const ftype = f.type || classify.classify(f.name);
      if (ftype === 'installer') targets.push({ release: rel, file: f });
    }
  }

  if (!targets.length) {
    log.warn(i18n.t('updateNoSetup'));
    version.setCurrent(newer[newer.length - 1].version);
    return;
  }

  const dest = flags.d ? path.resolve(flags.d) : config.ROOT;
  ensureDir(dest);

  if (flags.check) {
    console.log(i18n.t('updatePlan') + ':  ' + current + ' -> ' + newer[newer.length - 1].version);
    for (const t of targets) console.log('  ' + t.release.version + '  ' + t.file.name);
    return;
  }

  let okN = 0, failN = 0;
  for (const t of targets) {
    const target = path.join(dest, t.file.name);
    if (!flags.q) log.info(t.release.version + '  ' + t.file.name);
    try {
      await net.downloadWithRetry(t.file.url, target);
      okN++;
      if (flags.run) {
        try {
          const runner = require('./runner');
          await runner.runInstaller(target, t.file.name, flags);
        } catch (err2) {
          log.error(i18n.t('installerFailed') + ': ' + err2.message);
        }
      }
    } catch (err3) {
      failN++;
      log.error(t.file.name + ': ' + err3.message);
    }
  }

  version.setCurrent(newer[newer.length - 1].version);
  log.success(i18n.t('updateDone') + '  ' + okN + ' ok' + (failN ? ' / ' + failN + ' fail' : ''));
}

function showVersion() {
  const version = require('./version');
  const pkgVer = version.getPkgVersion();
  const state = version.loadState();

  console.log(i18n.t('versionLabel') + ': ' + color.cyan('v' + pkgVer));
  console.log(i18n.t('versionCurrent') + ': ' +
    (state.current ? color.green(state.current) : color.gray(i18n.t('versionNone'))));

  if (state.history && state.history.length) {
    console.log(i18n.t('versionHistory') + ':');
    const tail = state.history.slice(-5).reverse();
    for (const h of tail) {
      console.log('  ' + color.gray(h.installedAt) + '  ' + color.cyan(h.tag));
    }
  }
}

module.exports = {
  dispatch: dispatch, parseArgs: parseArgs,
  buildHelpText: buildHelpText, unknownCommand: unknownCommand,
  listAvailable: listAvailable, listInstalled: listInstalled,
  searchPackages: searchPackages, pakCommand: pakCommand, showVersion: showVersion,
  clearTemp: clearTemp, settings: settings, lang: lang
};
