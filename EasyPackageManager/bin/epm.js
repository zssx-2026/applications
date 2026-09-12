#!/usr/bin/env node
'use strict';

const proc = require('../src/process');

proc.register();

process.on('exit', function () { try { proc.unregister(); } catch (_) {} });
process.on('SIGINT', function () { proc.exitAll(0); });
process.on('SIGTERM', function () { proc.exitAll(0); });

const args = process.argv.slice(2);

async function main() {
  if (args.length === 0) {
    await require('../src/shell').run();
    proc.unregister();
    return;
  }
  const { dispatch } = require('../src/cli');
  await dispatch(args);
  proc.unregister();
}

main().catch(function (err) {
  console.error('\u001b[31mx\u001b[0m ' + (err && err.stack ? err.stack : String(err)));
  try { proc.unregister(); } catch (_) {}
  process.exit(1);
});
