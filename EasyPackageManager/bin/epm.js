#!/usr/bin/env node
'use strict';

const proc = require('../src/process');

proc.register();

// 屏蔽所有信号，交给 shell 内部处理
try { process.on('SIGINT', function () {}); } catch (_) {}
try { process.on('SIGTERM', function () {}); } catch (_) {}
try { process.on('SIGHUP', function () {}); } catch (_) {}
try { process.on('SIGBREAK', function () {}); } catch (_) {}
try { process.on('SIGQUIT', function () {}); } catch (_) {}

process.on('exit', function () { try { proc.unregister(); } catch (_) {} });

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
