'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), cp = require('node:child_process');
const assert = require('node:assert/strict'), { test } = require('node:test'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'client/package.json'));
const React = req('react'), { transformSync } = req('esbuild'), { renderToStaticMarkup } = req('react-dom/server'), { parse } = req('@babel/parser');
const filename = path.join(root, 'client/src/pages/Home.jsx'), source = fs.readFileSync(filename, 'utf8');
const material = { id: 'fixture-material', type: 'blog', title: '개념 자료', sourceName: '로컬 QA 출처', url: 'https://example.test/material' };
const rec = { id: 'fixture-old', engine: 'ai', createdDate: '2026-10-18', feedback: 'helpful',
  topics: [{ title: '기존 추천 주제', reason: '진도가 낮은 단원을 복습해요.', materials: [material] }] };
const fresh = { ...rec, id: 'fixture-new', feedback: null, topics: [{ ...rec.topics[0], title: '새 추천 주제' }] };
const fail = status => Object.assign(new Error('연결을 확인한 뒤 다시 시도해 주세요.'), { status: status ?? 503 });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function harness(options = {}) {
  const slots = [], effects = [], cache = new Map(), calls = [], fetchers = [];
  let cursor = 0, queryCursor = 0, queue = [], active = true, updatesAfterUnmount = 0, tree, reloads = 0;
  const today = { data: { today: '2026-10-18', exam: { type: 'written', date: '2026-11-13', dday: 26 }, tasks: [], isStudyDay: false, nextStudyDate: '2026-10-19' }, loading: false, error: null };
  const recs = { data: { items: [rec], marker: 'retained' }, loading: false, error: null, ...options.query,
    setData(update) { if (!active) updatesAfterUnmount++; recs.data = typeof update === 'function' ? update(recs.data) : update; }, reload() { reloads++; } };
  const queries = [today, { data: { overall: 0, remainingMinutes: 120, subjects: [] } }, { data: { nextReview: [] } }, recs];
  const hooks = {
    ...React,
    useState(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: initial }; return [slots[i].value, v => { if (!active) updatesAfterUnmount++; slots[i].value = typeof v === 'function' ? v(slots[i].value) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) queue.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
  };
  async function api(route, init = {}) { calls.push({ route, ...init }); return options.api ? options.api(route, init) : init.method === 'POST' ? fresh : {}; }
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    function localRequire(id) {
      if (id === 'react') return file === filename ? hooks : React;
      if (id === 'react-router-dom') return { Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children), useNavigate: () => () => {}, useLocation: () => ({ pathname: '/' }) };
      if (id === '../api/client') return { api };
      if (id === '../context/AuthContext') return { useAuth: () => ({ user: { uid: 'fixture-home' }, migrated: false, clearMigrated() {} }) };
      if (id === '../lib/guest') return { loadGuest: () => null };
      if (id === '../components/SignupPrompt') return { default: () => null, __esModule: true };
      if (id === '../hooks/useApi') return { useApi: fn => { const i = queryCursor++; fetchers[i] = fn; return queries[i]; } };
      if (!id.startsWith('.')) return req(id);
      const base = path.resolve(path.dirname(file), id), resolved = [base, base + '.jsx', base + '.js'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      return load(resolved);
    }
    const code = transformSync(fs.readFileSync(file, 'utf8') + (file === filename ? '\nexport { MemberHome };' : ''), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
    vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, console, URLSearchParams, setTimeout, clearTimeout }, { filename: file });
    return module.exports;
  }
  const MemberHome = load(filename).MemberHome;
  function render() { cursor = 0; queryCursor = 0; tree = MemberHome(); const next = queue; queue = []; next.forEach(fn => fn()); return tree; }
  function find(type, node = tree) { const out = []; function walk(n) { if (!n || typeof n !== 'object') return; if (n.type === type || n.type?.name === type) out.push(n); React.Children.forEach(n.props?.children, walk); } walk(node); return out; }
  function section() { return find('section').find(n => n.props['aria-labelledby'] === 'rec-h'); }
  render();
  return {
    recs, calls, render, find, section,
    card() { render(); return find('RecommendationCards', section())[0]; },
    request() { render(); return find('button', section())[0].props.onClick(); },
    feedback(value) { return this.card().props.onFeedback(value); },
    html() { render(); return renderToStaticMarkup(tree); },
    retryGeneration() { render(); return find('ErrorBox', section())[0].props.onRetry(); },
    fetchRecs() { return fetchers[3](); },
    unmount() { effects.forEach(e => e?.cleanup?.()); active = false; },
    get reloads() { return reloads; }, get updatesAfterUnmount() { return updatesAfterUnmount; },
  };
}

test('same-tick generation is single-flight and disables its button', async () => {
  const wait = deferred(), h = harness({ api: () => wait.promise }); const first = h.request(); await h.request(); await h.request();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].method, 'POST'); assert.match(h.html(), /추천 생성 중/);
  assert.equal(h.find('button', h.section())[0].props.disabled, true);
  wait.resolve(fresh); await first; h.render(); assert.equal(h.find('button', h.section())[0].props.disabled, false);
});
test('successful generation replaces only the latest item and retains query metadata', async () => {
  const h = harness(); await h.request(); assert.equal(h.recs.data.items.length, 1); assert.equal(h.recs.data.items[0].id, fresh.id); assert.equal(h.recs.data.marker, 'retained');
});
for (const status of [0, 401, 429, 503]) test('generation failure ' + status + ' preserves the confirmed recommendation', async () => {
  const h = harness({ api: async () => { throw fail(status); } }), before = h.recs.data; await h.request();
  assert.equal(h.recs.data, before); assert.match(h.html(), /기존 추천 주제/); assert.equal(h.calls.length, 1);
  assert.match(h.html(), status === 401 ? /다시 로그인/ : /연결을 확인/);
});
test('explicit generation retry clears its error without automatic extra calls', async () => {
  let tries = 0; const h = harness({ api: async () => { if (++tries === 1) throw fail(); return fresh; } });
  await h.request(); assert.equal(h.calls.length, 1); await h.retryGeneration(); assert.equal(h.calls.length, 2);
  assert.equal(h.recs.data.items[0].id, fresh.id); assert.doesNotMatch(h.html(), /연결을 확인/);
});
for (const query of [{ loading: true }, { error: fail() }, { data: null, loading: false }]) test('initial history read blocks generation: ' + Object.keys(query)[0], async () => {
  const h = harness({ query }); await h.request(); assert.equal(h.calls.length, 0); assert.equal(h.card(), undefined);
  assert.equal(h.find('button', h.section())[0].props.disabled, true);
});
test('history error has a GET-only retry and no misleading no-history hint', async () => {
  const h = harness({ query: { error: fail() } }); assert.match(h.html(), /연결을 확인/); assert.doesNotMatch(h.html(), /남은 기간, 진도, 취약 유형을 바탕으로/);
  h.find('ErrorBox', h.section()).find(n => n.props.error).props.onRetry(); assert.equal(h.reloads, 1); assert.equal(h.calls.length, 0);
  await h.fetchRecs(); assert.equal(h.calls[0].route, '/api/recommendations?limit=1'); assert.equal(h.calls[0].method, undefined);
});
test('successful empty history displays the existing hint, but not while generating', async () => {
  const wait = deferred(), h = harness({ query: { data: { items: [] } }, api: () => wait.promise });
  assert.match(h.html(), /남은 기간, 진도, 취약 유형을 바탕으로/); const pending = h.request(); assert.doesNotMatch(h.html(), /남은 기간, 진도, 취약 유형을 바탕으로/);
  wait.resolve(fresh); await pending; assert.match(h.html(), /새 추천 주제/);
});
test('same-card feedback is single-flight and preserves confirmed selection while pending', async () => {
  const wait = deferred(), h = harness({ api: () => wait.promise }); const first = h.feedback('not_helpful'); await h.feedback('helpful');
  assert.equal(h.calls.length, 1); assert.equal(h.card().props.feedbackBusy, true); assert.equal(h.recs.data.items[0].feedback, 'helpful');
  assert.match(h.html(), /피드백 저장 중/); wait.resolve({}); await first;
  assert.equal(h.card().props.feedbackBusy, false); assert.equal(h.recs.data.items[0].feedback, 'not_helpful');
});
test('feedback failure is caught and retries the same ID and failed choice', async () => {
  let tries = 0; const h = harness({ api: async () => { if (++tries === 1) throw fail(); return {}; } });
  await h.feedback('not_helpful'); assert.equal(h.recs.data.items[0].feedback, 'helpful'); assert.match(h.html(), /연결을 확인/);
  await h.card().props.onRetryFeedback(); assert.equal(h.recs.data.items[0].feedback, 'not_helpful');
  assert.deepEqual(h.calls.map(c => [c.route, c.method, c.body.feedback]), [
    ['/api/recommendations/' + rec.id, 'PATCH', 'not_helpful'], ['/api/recommendations/' + rec.id, 'PATCH', 'not_helpful'],
  ]); assert.equal(h.card().props.feedbackError, null);
});
test('choosing another feedback after failure replaces the obsolete retry choice', async () => {
  let tries = 0; const h = harness({ api: async () => { if (++tries === 1) throw fail(); return {}; } });
  await h.feedback('not_helpful'); await h.feedback('helpful'); assert.equal(h.card().props.onRetryFeedback, undefined); assert.equal(h.recs.data.items[0].feedback, 'helpful');
});
test('late old feedback cannot replace a newly generated recommendation', async () => {
  const wait = deferred(), h = harness({ api: (route, init) => init.method === 'PATCH' ? wait.promise : Promise.resolve(fresh) });
  const first = h.feedback('not_helpful'); await h.request(); assert.equal(h.recs.data.items[0].id, fresh.id);
  wait.resolve({}); await first; assert.equal(h.recs.data.items[0].id, fresh.id); assert.equal(h.recs.data.items[0].feedback, null);
  assert.equal(h.card().props.feedbackBusy, false); assert.equal(h.card().props.feedbackError, undefined);
});
test('late old feedback failure is not shown on a newly generated recommendation', async () => {
  const wait = deferred(), h = harness({ api: (route, init) => init.method === 'PATCH' ? wait.promise : Promise.resolve(fresh) });
  const first = h.feedback('not_helpful'); await h.request(); wait.reject(fail()); await first;
  assert.equal(h.recs.data.items[0].id, fresh.id); assert.equal(h.card().props.feedbackError, undefined); assert.doesNotMatch(h.html(), /연결을 확인/);
});
test('new recommendation feedback can save while old feedback is pending', async () => {
  const old = deferred(); const h = harness({ api: (route, init) => init.method === 'POST' ? Promise.resolve(fresh) : route.endsWith(rec.id) ? old.promise : Promise.resolve({}) });
  const first = h.feedback('not_helpful'); await h.request(); await h.feedback('helpful');
  old.resolve({}); await first; assert.equal(h.recs.data.items[0].id, fresh.id); assert.equal(h.recs.data.items[0].feedback, 'helpful');
  assert.equal(h.calls.filter(c => c.method === 'PATCH').length, 2);
});
test('generation completing after a feedback save still becomes the latest', async () => {
  const wait = deferred(), h = harness({ api: (route, init) => init.method === 'POST' ? wait.promise : Promise.resolve({}) });
  const first = h.request(); await h.feedback('not_helpful'); wait.resolve(fresh); await first;
  assert.equal(h.recs.data.items[0].id, fresh.id); assert.equal(h.recs.data.items[0].feedback, null);
});
test('generation failure does not discard successful feedback', async () => {
  const wait = deferred(), h = harness({ api: (route, init) => init.method === 'POST' ? wait.promise : Promise.resolve({}) });
  const first = h.request(); await h.feedback('not_helpful'); wait.reject(fail()); await first;
  assert.equal(h.recs.data.items[0].id, rec.id); assert.equal(h.recs.data.items[0].feedback, 'not_helpful');
});
for (const method of ['POST', 'PATCH']) for (const rejects of [false, true]) test('unmounted ' + method + ' ' + (rejects ? 'failure' : 'success') + ' does not update state', async () => {
  const wait = deferred(), h = harness({ api: () => wait.promise }); const first = method === 'POST' ? h.request() : h.feedback('not_helpful');
  h.unmount(); if (rejects) wait.reject(fail()); else wait.resolve(fresh); await first; assert.equal(h.updatesAfterUnmount, 0);
});
test('401 feedback uses the existing login recovery UI', async () => {
  const h = harness({ api: async () => { throw fail(401); } }); await h.feedback('not_helpful');
  assert.match(h.html(), /next=%2F/); assert.match(h.html(), /다시 로그인/); assert.equal(h.recs.data.items[0].feedback, 'helpful');
});

const before = cp.execFileSync('git', ['show', '2f11e50:client/src/pages/Home.jsx'], { cwd: root, encoding: 'utf8' });
function declarations(s) { return parse(s, { sourceType: 'module', plugins: ['jsx'] }).program.body.map(n => n.declaration || n); }
function functionCode(s, name) { const n = declarations(s).find(n => n.id?.name === name); return s.slice(n.start, n.end); }
for (const name of ['Home', 'GuestHome', 'useScrollTo']) test(name + ' remains byte-for-byte unchanged', () => { assert.equal(functionCode(source, name), functionCode(before, name)); });
for (const label of ['today-h', 'prog-h', 'weak-h']) test('unrelated home section remains unchanged: ' + label, () => {
  function sectionCode(s) {
    let found; function visit(n) { if (!n || typeof n !== 'object') return; if (n.type === 'JSXElement' && n.openingElement.attributes.some(a => a.name?.name === 'aria-labelledby' && a.value?.value === label)) found = n; for (const v of Object.values(n)) if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object') visit(v); }
    visit(declarations(s).find(n => n.id?.name === 'MemberHome')); assert.ok(found); return s.slice(found.start, found.end);
  }
  assert.equal(sectionCode(source), sectionCode(before));
});
test('task writes and summary refresh behavior remain unchanged', () => {
  function code(s) { const member = declarations(s).find(n => n.id?.name === 'MemberHome'); const n = member.body.body.flatMap(n => n.declarations || []).find(n => n.id.name === 'updateTask'); return s.slice(n.start, n.end); }
  assert.equal(code(source), code(before));
});
