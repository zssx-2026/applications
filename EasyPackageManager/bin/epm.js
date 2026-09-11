#!/usr/bin/env node
'use strict';

const { main } = require('../src/cli');

main(process.argv.slice(2)).catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
