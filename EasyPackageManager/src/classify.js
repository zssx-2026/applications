'use strict';

const INSTALLER_KEYWORDS = [
  '_setup', '-setup', '.setup',
  '_installer', '-installer', '.installer',
  '_install.', '-install.', '.install.',
  '-install-', '_install-',
  'setup_', 'setup-', 'setup.',
  'install_', 'install-',
  '.msi'
];

const PORTABLE_KEYWORDS = [
  'portable', '_portable', '-portable', '.portable',
  'noinstall', 'no-install', 'no_install',
  'green', '_green', '-green', 'green_',
  'standalone'
];

const ARCHIVE_EXTS = [
  '.zip', '.tar.gz', '.tgz', '.tar', '.7z', '.rar', '.xz', '.bz2', '.gz'
];

function isInstaller(name) {
  const lower = String(name || '').toLowerCase();
  for (const k of INSTALLER_KEYWORDS) {
    if (lower.indexOf(k) !== -1) return true;
  }
  return false;
}

function isPortable(name) {
  const lower = String(name || '').toLowerCase();
  for (const k of PORTABLE_KEYWORDS) {
    if (lower.indexOf(k) !== -1) return true;
  }
  return false;
}

function isArchive(name) {
  const lower = String(name || '').toLowerCase();
  for (const e of ARCHIVE_EXTS) {
    if (lower.endsWith(e)) return true;
  }
  return false;
}

function isExe(name) {
  return /\.(exe|app|bin|run|appimage)$/i.test(String(name || ''));
}

function classify(fileName) {
  if (!fileName) return 'unknown';
  if (isInstaller(fileName)) return 'installer';
  if (isPortable(fileName)) return 'portable';
  if (isArchive(fileName)) return 'archive';
  if (isExe(fileName)) return 'exe';
  return 'unknown';
}

const TYPE_LABEL = {
  installer: '安装版',
  portable: '便携版',
  archive: '压缩包',
  exe: '可执行',
  unknown: '未知'
};

const TYPE_LABEL_EN = {
  installer: 'installer',
  portable: 'portable',
  archive: 'archive',
  exe: 'exe',
  unknown: 'unknown'
};

module.exports = {
  classify: classify,
  isInstaller: isInstaller,
  isPortable: isPortable,
  isArchive: isArchive,
  isExe: isExe,
  TYPE_LABEL: TYPE_LABEL,
  TYPE_LABEL_EN: TYPE_LABEL_EN
};
