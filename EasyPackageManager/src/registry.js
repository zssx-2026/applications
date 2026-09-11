'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, readJson, writeJson, ensureDir } = require('./utils');
const config = require('./config');

const REGISTRY_FILE = path.join(ROOT, config.get('registryFile', 'registry.json'));

function load() {
  return readJson(REGISTRY_FILE, { version: 1, packages: {} });
}

function save(data) {
  writeJson(REGISTRY_FILE, data);
}

function get(name) {
  return load().packages[name] || null;
}

function set(name, info) {
  const data = load();
  data.packages[name] = Object.assign({}, data.packages[name], info);
  save(data);
}

function remove(name) {
  const data = load();
  delete data.packages[name];
  save(data);
}

function list() {
  return Object.values(load().packages);
}

module.exports = { load, save, get, set, remove, list, REGISTRY_FILE };
