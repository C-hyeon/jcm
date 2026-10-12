'use strict';
/**
 * 테스트용 인메모리 Firestore/Auth 대역.
 * 실제 데이터 연동 검증은 Firebase Emulator로 하되(README), CI·로컬에서 에뮬레이터 없이도
 * 라우트의 쿼리·트랜잭션·병합 쓰기·하위 컬렉션 삭제 흐름을 검증하기 위해 사용한다.
 */
const crypto = require('crypto');

class Increment {
  constructor(n) {
    this.n = n;
  }
}
class ServerTimestamp {}
const FieldValue = { increment: (n) => new Increment(n), serverTimestamp: () => new ServerTimestamp() };

const isPlain = (v) => v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && !(v instanceof Increment) && !(v instanceof ServerTimestamp);
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function resolve(value, prev) {
  if (value instanceof Increment) return (typeof prev === 'number' ? prev : 0) + value.n;
  if (value instanceof ServerTimestamp) return new Date();
  if (Array.isArray(value)) return value.map((v) => resolve(v));
  if (isPlain(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = resolve(v, prev?.[k]);
    return out;
  }
  return value;
}
function deepMerge(prev, data) {
  const out = { ...(prev || {}) };
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : resolve(v, out[k]);
  }
  return out;
}

class DocSnap {
  constructor(ref, data) {
    this.ref = ref;
    this.id = ref.id;
    this._d = data;
    this.exists = data !== undefined;
  }
  data() {
    return clone(this._d);
  }
}

class DocRef {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split('/').pop();
  }
  collection(name) {
    return new CollRef(this.db, `${this.path}/${name}`);
  }
  async get() {
    return new DocSnap(this, clone(this.db.store.get(this.path)));
  }
  async set(data, opts) {
    this.db._set(this.path, data, opts);
  }
  async update(data) {
    this.db._update(this.path, data);
  }
  async delete() {
    this.db.store.delete(this.path);
  }
}

const OPS = {
  '==': (a, b) => a === b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
};

class Query {
  constructor(db, path, q = { filters: [], order: [], limit: null, after: null }) {
    this.db = db;
    this.path = path;
    this.q = q;
  }
  _with(patch) {
    return new Query(this.db, this.path, { ...this.q, ...patch });
  }
  where(f, op, v) {
    return this._with({ filters: [...this.q.filters, [f, op, v]] });
  }
  orderBy(f, dir = 'asc') {
    return this._with({ order: [...this.q.order, [f, dir]] });
  }
  limit(n) {
    return this._with({ limit: n });
  }
  startAfter(snap) {
    return this._with({ after: snap.id });
  }
  async get() {
    const prefix = `${this.path}/`;
    let docs = [...this.db.store.entries()]
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .map(([p, d]) => new DocSnap(new DocRef(this.db, p), clone(d)));
    for (const [f, op, v] of this.q.filters) docs = docs.filter((s) => s._d[f] !== undefined && OPS[op](s._d[f], v));
    for (const [f] of this.q.order) docs = docs.filter((s) => s._d[f] !== undefined);
    if (this.q.order.length) {
      docs.sort((a, b) => {
        for (const [f, dir] of this.q.order) {
          const x = a._d[f];
          const y = b._d[f];
          if (x < y) return dir === 'desc' ? 1 : -1;
          if (x > y) return dir === 'desc' ? -1 : 1;
        }
        return 0;
      });
    }
    if (this.q.after) docs = docs.slice(docs.findIndex((d) => d.id === this.q.after) + 1);
    if (this.q.limit != null) docs = docs.slice(0, this.q.limit);
    return { docs, size: docs.length, empty: !docs.length, forEach: (fn) => docs.forEach(fn) };
  }
}

class CollRef extends Query {
  doc(id) {
    return new DocRef(this.db, `${this.path}/${id || crypto.randomBytes(10).toString('hex')}`);
  }
}

class Writer {
  constructor(db) {
    this.db = db;
    this.ops = [];
  }
  set(ref, data, opts) {
    this.ops.push(() => this.db._set(ref.path, data, opts));
    return this;
  }
  update(ref, data) {
    this.ops.push(() => this.db._update(ref.path, data));
    return this;
  }
  delete(ref) {
    this.ops.push(() => this.db.store.delete(ref.path));
    return this;
  }
  async commit() {
    this.ops.forEach((op) => op());
  }
}
class Tx extends Writer {
  async get(ref) {
    return ref instanceof DocRef ? ref.get() : ref.get();
  }
}

class FakeFirestore {
  constructor() {
    this.store = new Map();
  }
  settings() {}
  collection(name) {
    return new CollRef(this, name);
  }
  batch() {
    const b = new Writer(this);
    if (this.batchLimitCheck) {
      const orig = b.commit.bind(b);
      b.commit = async () => {
        if (b.ops.length > 500) throw new Error('batch over 500');
        return orig();
      };
    }
    return b;
  }
  async runTransaction(fn) {
    const tx = new Tx(this);
    const r = await fn(tx);
    await tx.commit();
    return r;
  }
  async recursiveDelete(ref) {
    for (const k of [...this.store.keys()]) if (k === ref.path || k.startsWith(`${ref.path}/`)) this.store.delete(k);
  }
  _set(path, data, opts) {
    const prev = this.store.get(path);
    this.store.set(path, opts?.merge ? deepMerge(prev, data) : resolve(data, undefined));
  }
  _update(path, data) {
    const prev = this.store.get(path);
    if (prev === undefined) throw new Error(`NOT_FOUND: ${path}`);
    const next = { ...prev };
    for (const [k, v] of Object.entries(data)) if (v !== undefined) next[k] = resolve(v, prev[k]);
    this.store.set(path, next);
  }
}

const firestore = new FakeFirestore();
firestore.batchLimitCheck = true;

// 토큰 형식: "test:<uid>[:admin][:stale]"
const deleted = new Set();
const fakeAuth = {
  async verifyIdToken(token) {
    const [p, uid, ...flags] = String(token).split(':');
    if (p !== 'test' || !uid || deleted.has(uid)) throw new Error('invalid');
    const now = Math.floor(Date.now() / 1000);
    return { uid, email: `${uid}@jcm.test`, admin: flags.includes('admin'), auth_time: flags.includes('stale') ? now - 3600 : now, firebase: { sign_in_provider: 'password' } };
  },
  async deleteUser(uid) {
    deleted.add(uid);
  },
};

module.exports = { db: () => firestore, auth: () => fakeAuth, FieldValue, FieldPath: {}, Timestamp: {}, _store: firestore.store };
