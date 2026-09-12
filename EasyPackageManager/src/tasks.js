'use strict';

let tasks = [];
let nextId = 1;
const listeners = [];

function emit() {
  for (const fn of listeners) {
    try { fn(); } catch (_) {}
  }
}

function register(name, type) {
  const t = {
    id: nextId++,
    name: name || 'unnamed',
    type: type || 'task',
    status: 'running',
    bytes: 0,
    total: 0,
    started: Date.now(),
    ended: null,
    error: null,
    aborted: false,
    abortFn: null
  };
  tasks.push(t);
  emit();
  return t;
}

function unregister(t) {
  if (!t) return;
  const i = tasks.indexOf(t);
  if (i >= 0) {
    tasks.splice(i, 1);
    emit();
  }
}

function list() { return tasks.slice(); }
function count() { return tasks.length; }

function get(id) {
  const n = Number(id);
  return tasks.find(function (x) { return x.id === n; }) || null;
}

function abort(id) {
  const t = get(id);
  if (!t) return { ok: false, error: 'notFound', id: Number(id) };
  t.aborted = true;
  if (typeof t.abortFn === 'function') {
    try { t.abortFn(); } catch (_) {}
  }
  return { ok: true, task: t };
}

function abortAll() {
  const ids = tasks.map(function (t) { return t.id; });
  const killed = [];
  for (const id of ids) {
    const r = abort(id);
    if (r.ok) killed.push(id);
  }
  return killed;
}

function on(fn) {
  if (typeof fn === 'function') listeners.push(fn);
}

function off(fn) {
  const i = listeners.indexOf(fn);
  if (i >= 0) listeners.splice(i, 1);
}

module.exports = {
  register: register,
  unregister: unregister,
  list: list,
  count: count,
  get: get,
  abort: abort,
  abortAll: abortAll,
  on: on,
  off: off
};
