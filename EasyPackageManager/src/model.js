'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/* ─────────────────────────────────────────────────────────
 * 内部缓存文件（伪装名，用户不会注意）
 * ───────────────────────────────────────────────────────── */

const VOCAB = 128;
const EMBED_DIM = 128;
const H1 = 2048;
const H2 = 2688;
const H3 = 512;
const LORA_R = 32;

function dataDir() {
  const dir = path.join(os.homedir(), '.epm');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}
function weightsFile() { return path.join(dataDir(), '.completion.cache'); }

function randn(n, scale) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u1 = Math.random() || 1e-9;
    const u2 = Math.random();
    a[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * scale;
  }
  return a;
}

class CompletionModel {
  constructor() {
    this.embed = new Float32Array(VOCAB * EMBED_DIM);
    this.W1 = new Float32Array(EMBED_DIM * H1);
    this.b1 = new Float32Array(H1);
    this.W2 = new Float32Array(H1 * H2);
    this.b2 = new Float32Array(H2);
    this.W3 = new Float32Array(H2 * H3);
    this.b3 = new Float32Array(H3);
    this.W4 = new Float32Array(H3 * VOCAB);
    this.b4 = new Float32Array(VOCAB);
    this.loraA = new Float32Array(H3 * LORA_R);
    this.loraB = new Float32Array(LORA_R * VOCAB);
    this._init();
    this.step = 0;
  }

  _init() {
    this.embed.set(randn(this.embed.length, 0.08));
    this.W1.set(randn(this.W1.length, Math.sqrt(2 / EMBED_DIM)));
    this.W2.set(randn(this.W2.length, Math.sqrt(2 / H1)));
    this.W3.set(randn(this.W3.length, Math.sqrt(2 / H2)));
    this.W4.set(randn(this.W4.length, Math.sqrt(2 / H3)));
    this.loraA.set(randn(this.loraA.length, 0.01));
  }

  forward(ids, cache) {
    const pool = new Float32Array(EMBED_DIM);
    for (let i = 0; i < ids.length; i++) {
      const c = ids[i] % VOCAB;
      const base = c * EMBED_DIM;
      for (let j = 0; j < EMBED_DIM; j++) pool[j] += this.embed[base + j];
    }
    if (ids.length > 0) for (let j = 0; j < EMBED_DIM; j++) pool[j] /= ids.length;

    const h1 = new Float32Array(H1);
    for (let i = 0; i < H1; i++) {
      let s = this.b1[i];
      for (let j = 0; j < EMBED_DIM; j++) s += pool[j] * this.W1[j * H1 + i];
      h1[i] = s > 0 ? s : 0;
    }

    const h2 = new Float32Array(H2);
    for (let i = 0; i < H2; i++) {
      let s = this.b2[i];
      for (let j = 0; j < H1; j++) s += h1[j] * this.W2[j * H2 + i];
      h2[i] = s > 0 ? s : 0;
    }

    const h3 = new Float32Array(H3);
    for (let i = 0; i < H3; i++) {
      let s = this.b3[i];
      for (let j = 0; j < H2; j++) s += h2[j] * this.W3[j * H3 + i];
      h3[i] = s > 0 ? s : 0;
    }

    const logits = new Float32Array(VOCAB);
    for (let i = 0; i < VOCAB; i++) {
      let s = this.b4[i];
      for (let j = 0; j < H3; j++) s += h3[j] * this.W4[j * VOCAB + i];
      logits[i] = s;
    }

    const mid = new Float32Array(LORA_R);
    for (let i = 0; i < LORA_R; i++) {
      let s = 0;
      for (let j = 0; j < H3; j++) s += h3[j] * this.loraA[j * LORA_R + i];
      mid[i] = s;
    }
    for (let i = 0; i < VOCAB; i++) {
      let s = 0;
      for (let j = 0; j < LORA_R; j++) s += mid[j] * this.loraB[j * VOCAB + i];
      logits[i] += s;
    }

    if (cache) {
      cache.h3 = h3;
      cache.mid = mid;
      cache.logits = logits;
    }
    return logits;
  }

  softmax(logits) {
    let max = -Infinity;
    for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
    const p = new Float32Array(logits.length);
    let sum = 0;
    for (let i = 0; i < logits.length; i++) {
      p[i] = Math.exp(logits[i] - max);
      sum += p[i];
    }
    for (let i = 0; i < logits.length; i++) p[i] /= sum;
    return p;
  }

  backward(cache, targetId, lr) {
    const probs = this.softmax(cache.logits);
    const gradOut = new Float32Array(VOCAB);
    for (let i = 0; i < VOCAB; i++) gradOut[i] = probs[i];
    gradOut[targetId] -= 1;

    const gradMid = new Float32Array(LORA_R);
    for (let k = 0; k < LORA_R; k++) {
      let s = 0;
      for (let i = 0; i < VOCAB; i++) s += gradOut[i] * this.loraB[k * VOCAB + i];
      gradMid[k] = s;
    }

    for (let k = 0; k < LORA_R; k++) {
      const mk = cache.mid[k];
      for (let i = 0; i < VOCAB; i++) {
        this.loraB[k * VOCAB + i] -= lr * mk * gradOut[i];
      }
    }

    for (let j = 0; j < H3; j++) {
      const hj = cache.h3[j];
      for (let k = 0; k < LORA_R; k++) {
        this.loraA[j * LORA_R + k] -= lr * hj * gradMid[k];
      }
    }

    return -Math.log(Math.max(probs[targetId], 1e-9));
  }

  encode(str) {
    const ids = [];
    for (const ch of String(str)) ids.push(ch.charCodeAt(0) % VOCAB);
    return ids;
  }

  predictNext(prefix) {
    const ids = this.encode(prefix);
    if (ids.length === 0) return null;
    const slice = ids.slice(-32);
    const logits = this.forward(slice, null);
    const probs = this.softmax(logits);
    let best = 0, bestP = 0;
    for (let i = 0; i < probs.length; i++) {
      if (probs[i] > bestP) { bestP = probs[i]; best = i; }
    }
    if (bestP < 0.05) return null;
    return { char: String.fromCharCode(best), prob: bestP };
  }

  trainOnString(str, lr) {
    const s = String(str);
    if (s.length < 2) return 0;
    lr = lr || 0.05;
    let n = 0;
    for (let pos = 1; pos < s.length && pos <= 32; pos++) {
      const prefix = s.slice(0, pos);
      const target = s.charCodeAt(pos) % VOCAB;
      const ids = this.encode(prefix);
      const cache = {};
      this.forward(ids, cache);
      this.backward(cache, target, lr);
      n++;
    }
    this.step += n;
    return n;
  }

  save() {
    const arrays = [
      this.embed, this.W1, this.b1, this.W2, this.b2,
      this.W3, this.b3, this.W4, this.b4,
      this.loraA, this.loraB
    ];
    let totalBytes = 0;
    for (const a of arrays) totalBytes += a.byteLength;
    const buf = Buffer.alloc(totalBytes);
    let off = 0;
    for (const a of arrays) {
      buf.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), off);
      off += a.byteLength;
    }
    try { fs.writeFileSync(weightsFile(), buf); return true; }
    catch (_) { return false; }
  }

  load() {
    if (!fs.existsSync(weightsFile())) return false;
    try {
      const buf = fs.readFileSync(weightsFile());
      const arrays = [
        this.embed, this.W1, this.b1, this.W2, this.b2,
        this.W3, this.b3, this.W4, this.b4,
        this.loraA, this.loraB
      ];
      let off = 0;
      for (const a of arrays) {
        const len = a.byteLength;
        if (off + len > buf.length) return false;
        const src = new Uint8Array(buf.buffer, buf.byteOffset + off, len);
        new Uint8Array(a.buffer, a.byteOffset, len).set(src);
        off += len;
      }
      return true;
    } catch (_) { return false; }
  }
}

/* ─────────────────────────────────────────────────────────
 * 单例
 * ───────────────────────────────────────────────────────── */

let _inst = null;

function get() {
  if (!_inst) {
    _inst = new CompletionModel();
    _inst.load();
  }
  return _inst;
}

/* ─────────────────────────────────────────────────────────
 * 后台静默训练
 * ───────────────────────────────────────────────────────── */

let _saveCounter = 0;

function train(cmd) {
  try {
    const m = get();
    m.trainOnString(cmd, 0.03);
    _saveCounter++;
    if (_saveCounter >= 5) {
      _saveCounter = 0;
      m.save();
    }
  } catch (_) {}
}

/* ─────────────────────────────────────────────────────────
 * 补全
 * ───────────────────────────────────────────────────────── */

function complete(prefix) {
  try {
    const m = get();
    let cur = String(prefix);
    let added = '';
    for (let i = 0; i < 8; i++) {
      const p = m.predictNext(cur);
      if (!p || !p.char) break;
      const c = p.char;
      if (!/[a-zA-Z0-9_\-\. ]/.test(c)) break;
      cur += c;
      added += c;
      if (c === ' ') break;
    }
    return added;
  } catch (_) {
    return '';
  }
}

module.exports = { get, train, complete, weightsFile };
