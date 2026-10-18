'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'client/package.json'));
const React = req('react');
const { transformSync } = req('esbuild');
const { renderToStaticMarkup } = req('react-dom/server');
const filename = path.join(root, 'client/src/pages/Recommend.jsx');
const cardsFile = path.join(root, 'client/src/components/StudyCards.jsx');
const material = { id: 'fixture-material', title: '개념 자료', type: 'blog', sourceName: '로컬 QA 출처', url: 'https://example.test/material' };
const rec = { id: 'fixture-newest', engine: 'ai', createdDate: '2026-10-18', feedback: null,
  topics: [{ title: '데이터베이스 개념 복습', subjectName: '데이터베이스 구축', reason: '진도가 낮은 단원을 복습해요.', materials: [material] }] };
const older = { ...rec, id: 'fixture-older', feedback: 'helpful' };
const fail = (status = 503) => Object.assign(new Error(status === 401 ? '다시 로그인해 주세요.' : '연결을 확인한 뒤 다시 시도해 주세요.'), { status });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function harness(options = {}) {
  const slots = [], effects = [], calls = [], cache = new Map();
  let cursor = 0, tree, queue = [], active = true, updatesAfterUnmount = 0, fetcher, retries = 0;
  const history = { data: { items: [rec, older] }, loading: false, error: null, ...options.query,
    reload() { retries++; }, setData(fn) { if (!active) updatesAfterUnmount++; history.data = typeof fn === 'function' ? fn(history.data) : fn; } };
  const hooks = {
    ...React,
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: initial };
      return [slots[i].value, v => { if (!active) updatesAfterUnmount++; slots[i].value = typeof v === 'function' ? v(slots[i].value) : v; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++, previous = effects[i];
      if (!previous || deps.some((v, j) => !Object.is(v, previous.deps[j]))) queue.push(() => {
        previous?.cleanup?.(); effects[i] = { deps, cleanup: fn() };
      });
    },
  };
  async function api(route, init = {}) {
    calls.push({ route, ...init });
    if (options.api) return options.api(route, init);
    return init.method === 'PATCH' ? { id: route.split('/').pop(), ...init.body } : { ...rec, id: 'fixture-generated', remainingToday: 8 };
  }
  function load(file, source) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    function localRequire(id) {
      if (id === 'react') return file === filename ? hooks : React;
      if (id === 'react-router-dom') return {
        Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children),
        useLocation: () => ({ pathname: '/recommend' }),
      };
      if (id === '../api/client') return { api };
      if (id === '../hooks/useApi') return { useApi: fn => { fetcher = fn; return history; } };
      if (!id.startsWith('.')) return req(id);
      const base = path.resolve(path.dirname(file), id), resolved = [base, base + '.jsx', base + '.js'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      return load(resolved);
    }
    const code = transformSync(source ?? fs.readFileSync(file, 'utf8'), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
    vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, console, setTimeout, clearTimeout, URLSearchParams }, { filename: file });
    return module.exports;
  }
  const Component = load(filename).default;
  function render() {
    cursor = 0; tree = Component(); const next = queue; queue = []; next.forEach(fn => fn()); return tree;
  }
  function find(type) {
    const result = [];
    function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (n.type === type || n.type?.name === type) result.push(n);
      React.Children.forEach(n.props?.children, walk); walk(n.props?.actions);
    }
    walk(tree); return result;
  }
  render();
  return {
    history, calls, render, find, load,
    html() { render(); return renderToStaticMarkup(tree); },
    request() { render(); return find('PageHeader')[0].props.actions.props.onClick(); },
    card(id = rec.id) { render(); return find('RecommendationCards').find(n => n.props.rec.id === id); },
    feedback(id, value) { return this.card(id).props.onFeedback(value); },
    unmount() { effects.forEach(e => e?.cleanup?.()); active = false; },
    fetch() { return fetcher(); },
    get retries() { return retries; },
    get updatesAfterUnmount() { return updatesAfterUnmount; },
  };
}

test('generation is single-flight even before React rerenders', async () => {
  const wait = deferred(), h = harness({ api: () => wait.promise });
  const pending = h.request(); await h.request(); await h.request();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].method, 'POST');
  assert.match(h.html(), /disabled="" aria-busy="true"/); assert.match(h.html(), /추천 생성 중/);
  wait.resolve({ ...rec, id: 'new', remainingToday: 9 }); await pending;
  h.render(); assert.equal(h.find('PageHeader')[0].props.actions.props.disabled, false);
});
test('generation success prepends without discarding older feedback or query metadata', async () => {
  const h = harness(); h.history.data.extra = 'retained'; await h.request();
  assert.deepEqual(Array.from(h.history.data.items, x => x.id), ['fixture-generated', rec.id, older.id]);
  assert.equal(h.history.data.items[2].feedback, 'helpful'); assert.equal(h.history.data.extra, 'retained');
  assert.match(h.html(), /오늘 남은 추천 횟수: 8회/);
});
test('generation failure retains confirmed records and has no automatic retry', async () => {
  const h = harness({ api: async () => { throw fail(); } }), before = h.history.data;
  await h.request(); assert.equal(h.history.data, before); assert.equal(h.calls.length, 1);
  assert.match(h.html(), /연결을 확인/); assert.match(h.html(), /최근 추천/); assert.doesNotMatch(h.html(), /오늘 남은 추천 횟수/);
});
test('explicit generation retry performs exactly one fresh request and clears its error', async () => {
  let count = 0; const h = harness({ api: async () => { if (++count === 1) throw fail(); return { ...rec, id: 'retry', remainingToday: 7 }; } });
  await h.request(); h.render(); await h.find('ErrorBox').find(n => n.props.error).props.onRetry();
  assert.equal(h.calls.length, 2); assert.equal(h.history.data.items[0].id, 'retry'); assert.doesNotMatch(h.html(), /연결을 확인/);
});
for (const status of [0, 401, 429, 503]) test('generation API error status ' + status + ' preserves confirmed data', async () => {
  const h = harness({ api: async () => { throw fail(status); } }); await h.request();
  assert.equal(h.history.data.items[0].id, rec.id); assert.equal(h.calls.length, 1);
  assert.match(h.html(), status === 401 ? /다시 로그인/ : /연결을 확인/);
});
test('quota display only changes after confirmed generation success', async () => {
  let count = 0; const h = harness({ api: async () => { if (++count === 2) throw fail(429); return { ...rec, id: 'first', remainingToday: 0 }; } });
  await h.request(); await h.request(); assert.match(h.html(), /오늘 남은 추천 횟수: 0회/);
});
for (const query of [{ loading: true }, { error: fail() }]) test('generation is blocked until the initial history read is usable: ' + Object.keys(query)[0], async () => {
  const h = harness({ query }); await h.request(); assert.equal(h.calls.length, 0);
  h.render(); assert.equal(h.find('PageHeader')[0].props.actions.props.disabled, true);
});
test('history fetch failure is not represented as empty history or stale recommendations', () => {
  const h = harness({ query: { error: fail() } }); const html = h.html();
  assert.match(html, /연결을 확인/); assert.doesNotMatch(html, /아직 받은 추천|최근 추천|이전 추천/);
  h.find('ErrorBox').find(n => n.props.error).props.onRetry(); assert.equal(h.retries, 1); assert.equal(h.calls.length, 0);
});
test('history loading retains the page heading but hides old cards and empty state', () => {
  const h = harness({ query: { loading: true } }); const html = h.html();
  assert.match(html, /<h1>AI 학습 추천/); assert.match(html, /aria-busy="true"/); assert.doesNotMatch(html, /최근 추천|아직 받은 추천/);
});
test('successful empty history has its own state and enabled generation', () => {
  const h = harness({ query: { data: { items: [] } } }); assert.match(h.html(), /아직 받은 추천/);
  assert.equal(h.find('PageHeader')[0].props.actions.props.disabled, false);
});
test('first generation pending does not also claim there are no recommendations', async () => {
  const wait = deferred(), h = harness({ query: { data: { items: [] } }, api: () => wait.promise });
  const pending = h.request(); assert.doesNotMatch(h.html(), /아직 받은 추천/);
  wait.resolve({ ...rec, remainingToday: 9 }); await pending;
});
test('feedback success updates only its existing record after confirmation', async () => {
  const wait = deferred(), h = harness({ api: () => wait.promise });
  const pending = h.feedback(rec.id, 'helpful'); assert.equal(h.history.data.items[0].feedback, null);
  assert.equal(h.card().props.feedbackBusy, true); assert.match(h.html(), /피드백 저장 중/);
  wait.resolve({ id: rec.id, feedback: 'helpful' }); await pending;
  assert.equal(h.history.data.items[0].feedback, 'helpful'); assert.equal(h.history.data.items[1].feedback, 'helpful');
  assert.equal(h.card().props.feedbackBusy, false);
});
test('same-card repeated or opposite feedback cannot overlap', async () => {
  const wait = deferred(), h = harness({ api: () => wait.promise });
  const pending = h.feedback(rec.id, 'helpful'); await h.feedback(rec.id, 'helpful'); await h.feedback(rec.id, 'not_helpful');
  assert.equal(h.calls.length, 1); wait.resolve({}); await pending;
});
test('different cards can save independently and out-of-order completion preserves both', async () => {
  const a = deferred(), b = deferred(), h = harness({ api: route => route.endsWith(older.id) ? b.promise : a.promise });
  const first = h.feedback(rec.id, 'helpful'), second = h.feedback(older.id, 'not_helpful');
  assert.equal(h.calls.length, 2); b.resolve({}); await second; a.resolve({}); await first;
  assert.deepEqual(h.history.data.items.map(x => x.feedback), ['helpful', 'not_helpful']);
});
test('feedback failure is caught, preserves selection and exposes a card-local retry', async () => {
  const h = harness({ api: async () => { throw fail(); } }); await h.feedback(older.id, 'not_helpful');
  assert.equal(h.history.data.items[1].feedback, 'helpful'); assert.equal(h.card().props.feedbackError, undefined);
  assert.equal(h.card(older.id).props.feedbackError.status, 503); assert.match(h.html(), /연결을 확인/);
  assert.equal(h.calls.length, 1); assert.equal(h.card(older.id).props.feedbackBusy, false);
});
test('retry uses the failed card ID and choice, without repeating generation', async () => {
  let count = 0; const h = harness({ api: async () => { if (++count === 1) throw fail(); return {}; } });
  await h.feedback(older.id, 'not_helpful'); await h.card(older.id).props.onRetryFeedback();
  assert.deepEqual(h.calls.map(x => [x.route, x.method, x.body.feedback]), [
    ['/api/recommendations/' + older.id, 'PATCH', 'not_helpful'], ['/api/recommendations/' + older.id, 'PATCH', 'not_helpful'],
  ]);
  assert.equal(h.history.data.items[1].feedback, 'not_helpful'); assert.equal(h.card(older.id).props.feedbackError, null);
});
test('changing a failed choice clears its obsolete retry and saves the new choice', async () => {
  let count = 0; const h = harness({ api: async () => { if (++count === 1) throw fail(); return {}; } });
  await h.feedback(rec.id, 'helpful'); await h.feedback(rec.id, 'not_helpful');
  assert.equal(h.card().props.onRetryFeedback, undefined); assert.equal(h.history.data.items[0].feedback, 'not_helpful');
});
test('feedback completing during generation does not lose the newly prepended record', async () => {
  const patch = deferred(), post = deferred(), h = harness({ api: (route, init) => init.method === 'PATCH' ? patch.promise : post.promise });
  const first = h.feedback(rec.id, 'helpful'), second = h.request();
  post.resolve({ ...rec, id: 'during-feedback', remainingToday: 8 }); await second; patch.resolve({}); await first;
  assert.deepEqual(Array.from(h.history.data.items, x => x.id), ['during-feedback', rec.id, older.id]);
  assert.equal(h.history.data.items[1].feedback, 'helpful');
});
test('generation completing after feedback preserves the changed older record', async () => {
  const post = deferred(), h = harness({ api: (route, init) => init.method === 'POST' ? post.promise : Promise.resolve({}) });
  const pending = h.request(); await h.feedback(older.id, 'not_helpful'); post.resolve({ ...rec, id: 'after-feedback', remainingToday: 8 }); await pending;
  assert.equal(h.history.data.items[2].feedback, 'not_helpful');
});
for (const method of ['POST', 'PATCH']) for (const reject of [false, true]) test('unmounted ' + method + ' ' + (reject ? 'failure' : 'success') + ' performs no late state updates', async () => {
  const wait = deferred(), h = harness({ api: () => wait.promise });
  const pending = method === 'POST' ? h.request() : h.feedback(rec.id, 'helpful');
  h.unmount(); if (reject) wait.reject(fail()); else wait.resolve({ ...rec, remainingToday: 9 }); await pending;
  assert.equal(h.updatesAfterUnmount, 0);
});
test('history contract remains the existing limit-10 GET', async () => {
  const h = harness(); await h.fetch(); assert.equal(h.calls[0].route, '/api/recommendations?limit=10'); assert.equal(h.calls[0].method, undefined);
});

function card(props = {}, before = false) {
  const h = harness();
  const file = before ? path.join(path.dirname(cardsFile), '2026-10-18-before-cards.jsx') : cardsFile;
  const source = before ? cp.execFileSync('git', ['show', '0b7bcf6:client/src/components/StudyCards.jsx'], { cwd: root, encoding: 'utf8' }) : undefined;
  const Component = h.load(file, source).RecommendationCards;
  return { element: Component({ rec, onFeedback() {}, ...props }), html: renderToStaticMarkup(React.createElement(Component, { rec, onFeedback() {}, ...props })) };
}
for (const feedback of [null, 'helpful', 'not_helpful']) test('default shared card markup remains identical for Home: ' + feedback, () => {
  assert.equal(card({ rec: { ...rec, feedback } }).html, card({ rec: { ...rec, feedback } }, true).html);
});
test('default Home feedback callbacks keep both original values', () => {
  const values = [], rendered = card({ onFeedback: value => values.push(value) });
  const group = React.Children.toArray(rendered.element.props.children).find(x => x?.props?.className === 'rec-feedback');
  const buttons = React.Children.toArray(group.props.children).filter(x => x?.type === 'button');
  buttons.forEach(x => x.props.onClick()); assert.deepEqual(values, ['helpful', 'not_helpful']);
});
test('busy card disables both choices, preserves pressed selection and announces progress', () => {
  const { html } = card({ rec: { ...rec, feedback: 'helpful' }, feedbackBusy: true });
  assert.equal((html.match(/disabled=""/g) || []).length, 2); assert.match(html, /aria-busy="true"/);
  assert.match(html, /aria-pressed="true"/); assert.match(html, /피드백 저장 중이에요/);
});
test('card error retry is hidden while busy and 401 uses login instead', () => {
  assert.doesNotMatch(card({ feedbackBusy: true, feedbackError: fail(), onRetryFeedback() {} }).html, /<button[^>]*>다시 시도<\/button>/);
  const html = card({ feedbackError: fail(401), onRetryFeedback() {} }).html;
  assert.match(html, /next=%2Frecommend/); assert.match(html, /다시 로그인/); assert.doesNotMatch(html, /다시 시도/);
});
test('read-only cards do not expose feedback progress, errors or controls', () => {
  const html = card({ onFeedback: undefined, feedbackBusy: true, feedbackError: fail() }).html;
  assert.doesNotMatch(html, /추천 피드백|피드백 저장 중|연결을 확인/);
});
test('reason, source, safe external links and fallback explanation remain intact', () => {
  const html = card({ rec: { ...rec, engine: 'rule', fallbackReason: 'timeout' } }).html;
  assert.match(html, /진도가 낮은 단원/); assert.match(html, /로컬 QA 출처/); assert.match(html, /규칙 기반 추천/);
  assert.match(html, /AI 응답이 지연·실패/); assert.match(html, /target="_blank" rel="noopener noreferrer"/);
});
