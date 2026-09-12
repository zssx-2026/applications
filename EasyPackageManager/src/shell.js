'use strict';

const readline = require('readline');
const { dispatch } = require('./cli');
const proc = require('./process');
const i18n = require('./i18n');
const { color: color, log: log } = require('./utils');

function run() {
  return new Promise(function (resolve) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: color.cyan('epm> '),
      terminal: true
    });

    console.log('EasyPackageManager');
    console.log(i18n.t('helpUsage') + ': help / exit');
    console.log(i18n.t('helpMultiLine'));
    console.log('');
    rl.prompt();

    rl.on('line', async function (line) {
      const raw = line.trim();
      if (!raw) { rl.prompt(); return; }
      if (raw === 'exit' || raw === 'quit') { rl.close(); proc.exitAll(0); return; }

      let commands;
      if (raw[0] === '{' && raw[raw.length - 1] === '}') {
        commands = raw.slice(1, -1).split(';').map(function (s) { return s.trim(); }).filter(Boolean);
      } else {
        commands = [raw];
      }

      for (const cmd of commands) {
        try {
          const argv = cmd.split(/\s+/);
          if (argv[0] === 'epm') argv.shift();
          await dispatch(argv);
        } catch (err) {
          log.error((err && err.message) || String(err));
        }
      }
      rl.prompt();
    });

    rl.on('close', function () { proc.unregister(); resolve(); });
  });
}

module.exports = { run: run };
