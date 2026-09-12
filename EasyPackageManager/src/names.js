'use strict';

function parse(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const fileName = parts[0];
    let version = parts[1] || '';
    if (/^v/i.test(version)) version = version.slice(1);
    const name = parts[2];
    const type = (parts[3] || '').toLowerCase();
    const company = parts[4] || 'null';
    if (type !== 'setup' && type !== 'port') continue;
    out.push({ fileName: fileName, version: version, name: name, type: type, company: company });
  }
  return out;
}

module.exports = { parse: parse };
