'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const { fixture } = require('./2026-10-16-fixtures.cjs');
const root = path.resolve(__dirname, '..');
const clientRequire = createRequire(path.join(root, 'client/package.json'));
const { parse } = clientRequire('@babel/parser');
const esbuild = clientRequire('esbuild');
const React = clientRequire('react');
const { renderToStaticMarkup } = clientRequire('react-dom/server');
const filename = path.join(root, 'client/src/pages/Progress.jsx');
const source = fs.readFileSync(filename, 'utf8');
const component = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.find((n) => n.type === 'ExportDefaultDeclaration').declaration;
const functions = component.body.body.filter((n) => n.type === 'FunctionDeclaration');
const handlers = functions.map((n) => source.slice(n.start, n.end)).join('\n');
const stateNames = component.body.body.flatMap((n) => n.declarations || []).filter((n) => n.init?.callee?.name === 'useState').map((n) => n.id.elements[0].name);
const unit = fixture().subjects[0].units[0];
const anotherUnit = fixture().subjects[0].units[3];
const error = (status = 503, code = 'QA_FAILURE') => Object.assign(new Error('테스트 오류'), { status, code });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const saved = { adjustment: { deleted: 0, adjusted: 0 } };

function harness(options = {}) {
  const state = { data: fixture(), busyUnit: null, err: null, toast: '', regen: false, refreshing: false, refreshError: null, failedAction: null, openSubjects: {} };
  const calls = [];
  const q = { setData(data) { state.data = data; }, reload() { throw Error('Do not unmount the page after a write'); } };
  const pending = { current: false };
  const scope = {
    q, pending,
    api: async (route, args = {}) => { calls.push({ route, ...args }); return options.api ? options.api(route, args) : fixture(); },
    apiWithConfirm: async (route, args) => { calls.push({ route, ...args }); return options.write ? options.write(route, args) : saved; },
  };
  for (const name of stateNames) {
    Object.defineProperty(scope, name, { get: () => state[name] });
    scope['set' + name[0].toUpperCase() + name.slice(1)] = (value) => { state[name] = typeof value === 'function' ? value(state[name]) : value; };
  }
  const h = vm.runInNewContext(handlers + '\n({' + functions.map((n) => n.id.name).join(',') + '})', scope);
  return { ...h, state, calls, pending };
}

test('same-tick duplicate saves issue one write and retain the lock through the refresh', async () => {
  const write = deferred(), read = deferred(), readStarted = deferred();
  const h = harness({ write: () => write.promise, api: () => { readStarted.resolve(); return read.promise; } });
  const first = h.setRate(unit, 50);
  await h.setRate(unit, 75);
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.busyUnit, unit.id);
  write.resolve(saved);
  await readStarted.promise;
  assert.equal(h.pending.current, true);
  assert.equal(h.state.refreshing, true);
  read.resolve(fixture()); await first;
  assert.equal(h.pending.current, false);
  assert.equal(h.state.busyUnit, null);
});

test('a different unit cannot steal the saving lock', async () => {
  const write = deferred();
  const h = harness({ write: () => write.promise });
  const first = h.setRate(unit, 50);
  await h.setRate(anotherUnit, 25);
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.busyUnit, unit.id);
  write.resolve(saved); await first;
});

test('regeneration is blocked during a unit save', async () => {
  const write = deferred();
  const h = harness({ write: () => write.promise });
  const first = h.setRate(unit, 50);
  await h.regenerate();
  assert.equal(h.calls.filter((x) => x.route === '/api/plans').length, 0);
  write.resolve(saved); await first;
});

test('unit saves and duplicate regeneration are blocked during regeneration', async () => {
  const post = deferred();
  const h = harness({ api: (route) => route === '/api/plans' ? post.promise : fixture() });
  const first = h.regenerate();
  await h.setRate(unit, 50); await h.regenerate();
  assert.equal(h.calls.length, 1);
  post.resolve({}); await first;
  assert.equal(h.state.regen, false);
});

test('failed saves retain confirmed data and remember the exact retry', async () => {
  const h = harness({ write: async () => { throw error(); } });
  const before = h.state.data;
  await h.setRate(anotherUnit, 75);
  assert.equal(h.state.data, before);
  assert.equal(h.state.err.status, 503);
  assert.equal(h.state.failedAction.unit.id, anotherUnit.id);
  assert.equal(h.state.failedAction.rate, 75);
  assert.equal(h.calls.length, 1);
  assert.equal(h.pending.current, false);
});

test('save retry uses the original unit, rate and confirmation contract', async () => {
  let tries = 0;
  const h = harness({ write: async () => { if (++tries === 1) throw error(); return saved; } });
  await h.setRate(anotherUnit, 75); await h.retrySave();
  const writes = h.calls.filter((x) => x.method === 'PUT');
  assert.equal(writes.length, 2);
  assert.equal(writes[1].body.unitId, anotherUnit.id);
  assert.equal(writes[1].body.rate, 75);
  assert.equal(writes[1].confirmKey, 'confirmDecrease');
  assert.equal(h.state.err, null);
  assert.equal(h.state.failedAction, null);
});

test('cancelled decrease is not shown as a failed save', async () => {
  const h = harness({ write: async () => { throw error(409, 'CONFIRM_DECREASE'); } });
  await h.setRate(unit, 0);
  assert.equal(h.state.err, null);
  assert.equal(h.state.failedAction, null);
  assert.equal(h.calls.length, 1);
});

test('unrelated 409 errors are not silently discarded', async () => {
  const h = harness({ write: async () => { throw error(409, 'OTHER_CONFLICT'); } });
  await h.setRate(unit, 50);
  assert.equal(h.state.err.code, 'OTHER_CONFLICT');
  assert.equal(h.state.failedAction.kind, 'rate');
});

test('successful save followed by failed read retains data and the success message', async () => {
  const h = harness({ api: async () => { throw error(0, 'NETWORK'); } });
  const before = h.state.data;
  await h.setRate(unit, 50);
  assert.equal(h.state.data, before);
  assert.equal(h.state.err, null);
  assert.equal(h.state.refreshError.code, 'NETWORK');
  assert.match(h.state.toast, /50%/);
  assert.equal(h.state.failedAction, null);
  const count = h.calls.length;
  await h.setRate(anotherUnit, 25); await h.regenerate();
  assert.equal(h.calls.length, count);
});

test('refresh retry makes only a GET and never repeats a successful save', async () => {
  let reads = 0;
  const fresh = fixture(); fresh.overall = 37;
  const h = harness({ api: async () => { if (++reads === 1) throw error(); return fresh; } });
  await h.setRate(unit, 50); await h.retryRefresh();
  assert.equal(h.calls.filter((x) => x.method === 'PUT').length, 1);
  assert.equal(h.calls.filter((x) => !x.method).length, 2);
  assert.equal(h.state.data, fresh);
  assert.equal(h.state.refreshError, null);
  assert.equal(h.pending.current, false);
});

test('refresh retries are also guarded against duplicate clicks', async () => {
  const read = deferred();
  const h = harness({ api: () => read.promise });
  const first = h.retryRefresh(); await h.retryRefresh();
  assert.equal(h.calls.length, 1);
  read.resolve(fixture()); await first;
});

test('failed refresh retry retains data and releases its lock', async () => {
  const h = harness({ api: async () => { throw error(); } });
  const before = h.state.data;
  await h.retryRefresh();
  assert.equal(h.state.data, before);
  assert.equal(h.state.refreshError.status, 503);
  assert.equal(h.state.refreshing, false);
  assert.equal(h.pending.current, false);
});

test('another arbitrary unit can be recorded after the first save completes', async () => {
  const h = harness();
  await h.setRate(unit, 50); await h.setRate(anotherUnit, 25);
  const writes = h.calls.filter((x) => x.method === 'PUT');
  assert.deepEqual(writes.map((x) => x.body.unitId), [unit.id, anotherUnit.id]);
});

test('task adjustment counts still come directly from the server response', async () => {
  const h = harness({ write: async () => ({ adjustment: { deleted: 3, adjusted: 2 } }) });
  await h.setRate(unit, 100);
  assert.match(h.state.toast, /3건.*2건/);
});

test('failed regeneration retries preserve its original API body', async () => {
  let attempts = 0;
  const h = harness({ api: async (route) => { if (route === '/api/plans' && ++attempts === 1) throw error(); return fixture(); } });
  await h.regenerate();
  assert.equal(h.state.failedAction.kind, 'regenerate');
  await h.retrySave();
  const posts = h.calls.filter((x) => x.route === '/api/plans');
  assert.equal(posts.length, 2);
  assert.equal(posts[1].method, 'POST');
  assert.equal(posts[1].body.confirmOverwrite, true);
  assert.equal(h.state.err, null);
});

test('successful regeneration with failed refresh is not regenerated again by read retry', async () => {
  let reads = 0;
  const h = harness({ api: async (route) => { if (route === '/api/plans') return {}; if (++reads === 1) throw error(); return fixture(); } });
  await h.regenerate(); await h.retryRefresh();
  assert.equal(h.calls.filter((x) => x.route === '/api/plans').length, 1);
  assert.equal(h.state.refreshError, null);
});

test('subject expansion state is independent and can retain an explicit closed first subject', () => {
  const h = harness();
  h.toggleSubject('qa-s2', true); h.toggleSubject('qa-s1', false);
  assert.equal(h.state.openSubjects['qa-s2'], true);
  assert.equal(h.state.openSubjects['qa-s1'], false);
  const before = h.state.openSubjects;
  h.toggleSubject('qa-s2', true);
  assert.equal(h.state.openSubjects, before);
});

function render(states = {}, query = {}) {
  const cache = new Map();
  const router = { Link: ({ to, children, ...rest }) => React.createElement('a', { href: to, ...rest }, children), useLocation: () => ({ pathname: '/progress' }) };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    let index = 0;
    const localRequire = (id) => {
      if (id === 'react' && file === filename) return { ...React, useRef: () => ({ current: false }), useState: (initial) => { const name = stateNames[index++]; return [Object.hasOwn(states, name) ? states[name] : initial, () => {}]; } };
      if (id === 'react-router-dom') return router;
      if (file === filename && id === '../hooks/useApi') return { useApi: () => ({ data: fixture(), loading: false, error: null, reload() {}, setData() {}, ...query }) };
      if (file === filename && id === '../api/client') return {};
      if (!id.startsWith('.')) return clientRequire(id);
      const base = path.resolve(path.dirname(file), id);
      return load([base, base + '.jsx', base + '.js'].find((p) => fs.existsSync(p) && fs.statSync(p).isFile()));
    };
    vm.runInNewContext(esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code, { module, exports: module.exports, require: localRequire, console }, { filename: file });
    return module.exports;
  }
  return renderToStaticMarkup(React.createElement(load(filename).default));
}

test('busy unit is announced and all six unit controls plus regeneration are disabled', () => {
  const html = render({ busyUnit: unit.id });
  assert.match(html, /저장 중/);
  assert.match(html, /aria-busy="true"/);
  assert.equal((html.match(/disabled=""/g) || []).length, 31);
});

test('refreshing preserves subject content and announces the refresh', () => {
  const html = render({ refreshing: true, busyUnit: unit.id });
  assert.match(html, /최신 진도를 불러오는 중/);
  assert.match(html, /요구사항 확인/);
  assert.equal((html.match(/disabled=""/g) || []).length, 31);
});

test('read failure after a successful write retains subjects and offers read retry', () => {
  const html = render({ refreshError: error(), toast: '진도를 저장했어요.' });
  assert.match(html, /저장은 완료됐지만 최신 진도를 불러오지 못했어요/);
  assert.match(html, /진도를 저장했어요/);
  assert.match(html, /다시 시도/);
  assert.match(html, /정보시스템 구축관리/);
  assert.equal((html.match(/disabled=""/g) || []).length, 31);
});

test('write failure offers retry without changing the confirmed selection', () => {
  const html = render({ err: error(), failedAction: { kind: 'rate', unit, rate: 50 } });
  assert.match(html, /다시 시도/);
  assert.match(html, /현재 25.0%/);
  assert.doesNotMatch(html, /disabled=""/);
});

test('401 retains the existing login guidance instead of a write retry', () => {
  const html = render({ err: error(401, 'UNAUTHORIZED'), failedAction: { kind: 'rate', unit, rate: 50 } });
  assert.match(html, /다시 로그인/);
  assert.doesNotMatch(html, />다시 시도</);
});

test('initial read failure retains the existing reload control', () => {
  const html = render({}, { data: null, error: error() });
  assert.match(html, /다시 시도/);
});

test('initial loading is still announced without rendering invalid data', () => {
  const html = render({}, { data: null, loading: true });
  assert.match(html, /aria-busy="true"/);
});

test('empty subject data has an explicit empty state', () => {
  assert.match(render({}, { data: fixture(true) }), /표시할 학습 단원이 없어요/);
});

test('progress owns its expansion state and its 0/25/50/75/100 controls', () => {
  const html = render({ openSubjects: { 'qa-s1': false, 'qa-s2': true } });
  assert.equal((html.match(/<details[^>]*open=""/g) || []).length, 1);
  assert.match(source, /const STEPS = \[0, 25, 50, 75, 100\]/);
  assert.match(html, /progress-page/);
});

test('touch sizing is scoped to Progress and all CSS outside approved page rules is unchanged', () => {
  const css = require('../2026-10-19-header-qa/2026-10-19-header-css.cjs').stripHeaderCSS(fs.readFileSync(path.join(root, 'client/src/styles.css'), 'utf8'));
  const rule = '.progress-page .unit-steps .seg-item {\n  min-height: 44px;\n}\n';
  assert.equal(css.split(rule).length, 2);
  const baseline = { hashes: { 'client/src/styles.css': 'b1cd815f8fa9696e375c5f9d2c4e312ff008adc9f1791ccdc723bc44779308dd' } };
  const wrongNotesRule = '.wrong-notes-page .seg-sm .seg-item,\n.wrong-notes-page .tag-picker .chip,\n.wrong-notes-page .note-actions .btn-sm {\n  min-height: 44px;\n}\n';
  assert.equal(css.split(wrongNotesRule).length, 2);
  const onboardingRule = '.onboarding .onboarding-fields {\n  border: 0;\n  padding: 0;\n  margin: 0;\n  min-width: 0;\n}\n.onboarding .seg-item,\n.onboarding .day {\n  min-height: 44px;\n}\n';
  assert.equal(css.split(onboardingRule).length, 2);
  assert.equal(crypto.createHash('sha256').update(css.replace(rule, '').replace(wrongNotesRule, '').replace(onboardingRule, '')).digest('hex'), baseline.hashes['client/src/styles.css']);
});
