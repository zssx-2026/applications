#!/usr/bin/env node
'use strict';

const { fetchAll } = require('./src/update-lib');

async function main() {
  const offline = process.argv.indexOf('--offline') !== -1;
  if (offline) { console.log('[epm] offline mode'); return; }
  console.log('[epm] fetching releases ...');
  try {
    const r = await fetchAll({ offline: false });
    console.log('[epm] url.json updated');
    console.log('[epm] ' + r.releases.length + ' releases, ' + r.fileCount + ' files total');
    if (r.latest) console.log('[epm] latest version: ' + r.latest.tag);
  } catch (err) {
    console.error('[epm] update failed: ' + err.message);
    process.exit(2);
  }
}

main();
