'use strict';

const fs = require('fs');
const path = require('path');

const net = require('./net');
const sources = require('./sources');
const i18n = require('./i18n');
const { ensureDir: ensureDir, log: log } = require('./utils');

const KEYWORD = 'epm lang';

function isLangRelease(rel) {
  const text = String((rel && rel.name || '') + ' ' + (rel && rel.version || '')).toLowerCase();
  return text.indexOf(KEYWORD) !== -1;
}

function findLangAssets(rel) {
  return (rel.files || []).filter(function (f) {
    return f.name && f.name.toLowerCase().endsWith('.lang');
  });
}

async function fetchLangs(flags) {
  flags = flags || {};
  const pkgs = sources.listAvailable();
  const hits = pkgs.filter(isLangRelease);

  if (!hits.length) {
    log.warn(i18n.t('langGetNone'));
    return 0;
  }

  ensureDir(i18n.LANG_DIR);

  let count = 0;
  const seen = new Set();

  for (const rel of hits) {
    const assets = findLangAssets(rel);
    for (const f of assets) {
      const fileName = path.basename(f.name);
      if (seen.has(fileName)) continue;
      seen.add(fileName);

      const dest = path.join(i18n.LANG_DIR, fileName);
      if (!flags.q) log.info('  ' + f.name + '  (' + rel.version + ')');

      try {
        await net.downloadWithRetry(f.url, dest);
        count++;
      } catch (err) {
        log.error(f.name + ': ' + err.message);
      }
    }
  }

  i18n.reload();

  if (count > 0) log.success(i18n.t('langGetOK') + ' (' + count + ')');
  else log.warn(i18n.t('langGetNone'));

  return count;
}

module.exports = { fetchLangs: fetchLangs, KEYWORD: KEYWORD };
