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
const versionLib = require('./version');
const { log: log, color: color, rmrf: rmrf, clearScreen: clearScreen, formatBytes: formatBytes } = require('./utils');

function typeBadge(type) {
  if (type === 'setup') return color.yellow('[setup]');
  if (type === 'port') return color.green('[port]');
  return color.gray('[' + (type || '?') + ']');
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
    '      -a                               全字匹配',
    '      -na                              不全字匹配',
    '      -i <company>                     按公司搜索（可多次）',
    '      -ni <c1,c2>                      排除公司',
    '      -t <setup|port>                  按类型',
    '      -v <version>                     按版本（可多次）',
    '      -nv <v1,v2>                      排除版本',
    '      -av                              列出所有版本',
    '  epm get                              ' + t('helpCmdGet'),
    '  epm install <name> [version]         ' + t('helpCmdInstall'),
    '      -q                               静默',
    '      -k                               保留安装包',
    '      --no-run                         只下载不运行',
    '      -d <dir>                         下载到指定目录',
    '  epm update [name]                    ' + t('helpCmdUpdate'),
    '      --check                          只检查',
    '  epm version [name]                   ' + t('helpCmdVersion'),
    '  epm uninstall <name>                 ' + t('helpCmdUninstall'),
    '  epm add <name> <url>                 ' + t('helpCmdAdd'),
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

const NO_VALUE_FLAGS = ['q', 'k', 'a', 'na', 'av'];
const MULTI_VALUE_FLAGS = ['i', 'ni', 'v', 'nv'];
const SINGLE_VALUE_FLAGS = ['p', 'n', 'f', 'd', 't'];

function parseArgs(argv) {
  const args = { _: [], flags: {}, multi: {} };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === '--force') { args.flags.force = true; continue; }
    if (a === '--no-run') { args.flags['no-run'] = true; continue; }
    if (a === '--check') { args.flags.check = true; continue; }

    if (a.length >= 2 && a[0] === '-' && a[1] !== '-') {
      const key = a.slice(1);

      if (NO_VALUE_FLAGS.indexOf(key) !== -1) {
        args.flags[key] = true;
        continue;
      }

      if (MULTI_VALUE_FLAGS.indexOf(key) !== -1) {
        const next = argv[i + 1];
        if (next !== undefined && !(next[0] === '-' && next.length > 1)) {
          i++;
          if (!args.multi[key]) args.multi[key] = [];
          for (const v of next.split(',')) {
            const t = v.trim();
            if (t) args.multi[key].push(t);
          }
        }
        continue;
      }

      if (SINGLE_VALUE_FLAGS.indexOf(key) !== -1) {
        const next = argv[i + 1];
        if (next !== undefined && !(next[0] === '-' && next.length > 1)) {
          args.flags[key] = next;
          i++;
        } else {
          args.flags[key] = true;
        }
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
  'lang', 'pak', 'clear', 'cls', 'update', 'version', 'v', 'exit', 'quit', 'help'
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
      return installer.install(args._[1], args._[2], args.flags);

    case 'download':
      return downloader.download(args._[1], args._[2], args.flags);

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

    case 'temp':
      if (sub === 'clear') return clearTemp();
      log.error(i18n.t('tempUsage')); return;

    case 'set':
      return settings(args._.slice(1));

    case 'lang':
      return lang(args._.slice(1));

    case 'clear':
    case 'cls':
      clearScreen(); return;

    case 'update':
      return runUpdate(args);

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

/* ─────────────────────────────────────── list ── */

function listAvailable() {
  const pkgs = sources.listPackages();
  const st = sources.stats();
  if (!pkgs.length) {
    log.info(i18n.t('noAvailablePkgs'));
    log.info(i18n.t('runGetHint'));
    return;
  }
  console.log(i18n.t('availablePkgs') + ':  ' + st.pkgCount + ' packages, ' +
    st.releaseCount + ' releases, ' + st.fileCount + ' files');
  if (st.updatedAt) console.log(color.gray('  updated at ' + st.updatedAt));
  console.log('');

  for (const pkg of pkgs) {
    const co = (pkg.company && pkg.company !== 'null') ? color.gray('  company=' + pkg.company) : '';
    const lat = pkg.latest;
    console.log('  ' + color.cyan(pkg.name) + '  ' + typeBadge(pkg.type) + co);
    console.log('      v' + lat.version + '  ' + lat.fileName + '  ' +
      (lat.size ? color.gray('(' + formatBytes(lat.size) + ')') : ''));
    if (pkg.versions.length > 1) {
      console.log('      ' + color.gray('(' + pkg.versions.length + ' versions)'));
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
      let match = false;
      if (fullWord) match = pkg.name.toLowerCase() === lowerText;
      else match = pkg.name.toLowerCase().indexOf(lowerText) !== -1;
      if (!match) continue;
    }

    let matchedVersions = pkg.versions.slice();
    if (versions.length) {
      matchedVersions = matchedVersions.filter(function (v) {
        return versions.indexOf(v.version) !== -1;
      });
    }
    if (exclVersions.length) {
      matchedVersions = matchedVersions.filter(function (v) {
        return exclVersions.indexOf(v.version) === -1;
      });
    }
    if (!matchedVersions.length) continue;

    hits.push(Object.assign({}, pkg, {
      versions: allVersions ? matchedVersions : [matchedVersions[matchedVersions.length - 1]],
      latest: matchedVersions[matchedVersions.length - 1]
    }));
  }

  if (!hits.length) {
    log.info(i18n.t('noAvailablePkgs'));
    return;
  }

  const head = text ? '搜索 "' + text + '"' : '筛选';
  console.log(head + ':  ' + hits.length + ' packages');
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
    log.success(i18n.t('fetchPkgsOK') + ' ' + r.releases.length + ' releases');
  } catch (err) {
    log.error(i18n.t('fetchPkgsFail') + ': ' + err.message);
  }
}

/* ─────────────────────────────────────── update ── */

async function runUpdate(args) {
  const name = args._[1] || null;

  log.step(i18n.t('updateFetching'));
  try {
    const { fetchAll } = require('./update-lib');
    await fetchAll({});
  } catch (err) {
    log.error(i18n.t('fetchPkgsFail') + ': ' + err.message);
    return;
  }

  if (args.flags.check) return updateCheck(name);

  const n = await installer.updatePackage(name, args.flags);
  if (n === 0) log.success(i18n.t('updateAlreadyLatest'));
  else log.success(i18n.t('updateDone') + '  ' + n);
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

  if (reg) {
    console.log(color.cyan(name) + '  installed: v' + reg.version);
  }
  if (pkg) {
    console.log(color.cyan(pkg.name) + '  latest: v' + pkg.latest.version +
      '  (' + pkg.versions.length + ' versions)');
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

/* ─────────────────────────────────────── temp ── */

function clearTemp() {
  const tempdir = config.get('tempdir');
  if (!fs.existsSync(tempdir)) { log.info(i18n.t('tempDirNotExist') + ': ' + tempdir); return; }
  const entries = fs.readdirSync(tempdir).filter(function (n) {
    return n !== '.gitkeep' && n.indexOf('.epm.pids') !== 0;
  });
  for (const e of entries) rmrf(path.join(tempdir, e));
  log.success(i18n.t('tempCleared') + ' ' + tempdir + '  (' + entries.length + ' ' + i18n.t('itemsDeleted') + ')');
}

/* ─────────────────────────────────────── set ── */

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

/* ─────────────────────────────────────── lang ── */

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
  clearTemp: clearTemp,
  settings: settings,
  lang: lang,
  versionCommand: versionCommand,
  runUpdate: runUpdate
};
