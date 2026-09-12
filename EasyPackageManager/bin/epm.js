#!/usr/bin/env node
'use strict';

const proc = require('../src/process');

proc.register();

process.on('exit', function () { try { proc.unregister(); } catch (_) {} });
process.on('SIGINT', function () { proc.exitAll(0); });
process.on('SIGTERM', function () { proc.exitAll(0); });

const { dispatch } = require('../src/cli');

dispatch(process.argv.slice(2))
  .then(function () { proc.unregister(); })
  .catch(function (err) {
    console.error('\u001b[31mx\u001b[0m ' + (err && err.stack ? err.stack : String(err)));
    proc.unregister();
    process.exit(1);
  });
