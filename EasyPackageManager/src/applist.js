'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const sources = require('./sources');

const APP_LIST_FILE = path.join(config.ROOT, 'applist.json');

/**
 * 生成 applist.json 内容
 */
function build() {
  const pkgs = sources.listPackages();
  const st = sources.stats();

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    count: pkgs.length,
    stats: {
      pkgCount: st.pkgCount,
      releaseCount: st.releaseCount,
      fileCount: st.fileCount,
      updatedAt: st.updatedAt
    },
    packages: pkgs.map(function (p) {
      return {
        name: p.name,
        type: p.type,
        company: p.company,
        latest: p.latest ? {
          version: p.latest.version,
          tag: p.latest.tag,
          fileName: p.latest.fileName,
          size: p.latest.size,
          url: p.latest.url,
          publishedAt: p.latest.publishedAt
        } : null,
        versions: (p.versions || []).map(function (v) {
          return {
            version: v.version,
            tag: v.tag,
            fileName: v.fileName,
            size: v.size,
            url: v.url,
            publishedAt: v.publishedAt
          };
        })
      };
    })
  };
}

/**
 * 保存到 ./applist.json
 * @returns {string} 文件路径
 */
function save() {
  const data = build();
  try {
    fs.writeFileSync(APP_LIST_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  } catch (_) {}
  return APP_LIST_FILE;
}

/**
 * 读取 applist.json
 */
function load() {
  try {
    return JSON.parse(fs.readFileSync(APP_LIST_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

module.exports = {
  APP_LIST_FILE: APP_LIST_FILE,
  build: build,
  save: save,
  load: load
};
