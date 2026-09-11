'use strict';

const installer = require('./installer');
const registry = require('./registry');
const { log, color } = require('./utils');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) { args[key] = next; i++; }
      else args[key] = true;
    } else if (a.startsWith('-')) {
      args[a.slice(1)] = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0] || 'help';

  switch (cmd) {
    case 'install':
    case 'i': {
      const spec = args._[1];
      if (!spec) throw new Error('用法: epm install <owner/repo[@ref]>');
      await installer.install(spec, args);
      break;
    }
    case 'uninstall':
    case 'remove':
    case 'rm': {
      const name = args._[1];
      if (!name) throw new Error('用法: epm uninstall <name>');
      installer.uninstall(name);
      break;
    }
    case 'list':
    case 'ls': {
      const list = registry.list();
      if (!list.length) { log.info('没有已安装的包'); break; }
      for (const pkg of list) {
        console.log(`${color.cyan(pkg.name)}  ${pkg.version || ''}  ${color.gray(pkg.source || '')}`);
      }
      break;
    }
    case 'update': {
      require('child_process').execFileSync(process.execPath, ['update.js'], { stdio: 'inherit' });
      break;
    }
    case 'help':
    default:
      console.log(`
EasyPackageManager (epm)

用法:
  epm install <owner/repo[@ref]> [--name <name>] [--dir <dir>]
  epm uninstall <name>
  epm list
  epm update
  epm help
`);
      break;
  }
}

module.exports = { main };
